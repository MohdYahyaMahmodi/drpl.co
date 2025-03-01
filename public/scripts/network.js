/**
 * drpl.co - Network Javascript
 * Handles WebRTC connections, WebSocket fallback, and file transfer operations
 */

// ======================================================================
// EVENT HANDLING
// ======================================================================

/**
 * Events - Centralized event management system
 */
class Events {
    /**
     * Fire an event with optional detail data
     * @param {string} type - Event type name
     * @param {any} detail - Data to pass with the event
     */
    static fire(type, detail) {
        window.dispatchEvent(new CustomEvent(type, { detail: detail }));
    }
  
    /**
     * Register an event listener
     * @param {string} type - Event type to listen for
     * @param {Function} callback - Function to call when event fires
     * @returns {Function} - The event listener for removal
     */
    static on(type, callback) {
        return window.addEventListener(type, callback);
    }
  
    /**
     * Remove an event listener
     * @param {string} type - Event type
     * @param {Function} callback - Callback to remove
     */
    static off(type, callback) {
        return window.removeEventListener(type, callback);
    }
}
  
// ======================================================================
// SERVER CONNECTION
// ======================================================================

/**
 * ServerConnection - Manages the WebSocket connection to the signaling server
 */
class ServerConnection {
    constructor() {
        this._socket = null;
        this._reconnectTimer = null;
        
        // Set up connection and event listeners
        this._connect();
        
        // Handle page lifecycle events
        Events.on('beforeunload', () => this._disconnect());
        Events.on('pagehide', () => this._disconnect());
        document.addEventListener('visibilitychange', () => this._onVisibilityChange());
    }
  
    /**
     * Establish WebSocket connection to the server
     * @private
     */
    _connect() {
        clearTimeout(this._reconnectTimer);
        
        // Don't reconnect if already connected or connecting
        if (this._isConnected() || this._isConnecting()) return;
        
        const ws = new WebSocket(this._endpoint());
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => console.log('Server connected');
        ws.onmessage = e => this._onMessage(e.data);
        ws.onclose = () => this._onDisconnect();
        ws.onerror = e => console.error('WebSocket error:', e);
        this._socket = ws;
    }
  
    /**
     * Process incoming WebSocket messages
     * @param {string|ArrayBuffer} msg - Message data
     * @private
     */
    _onMessage(msg) {
        try {
            msg = JSON.parse(msg);
            console.log('Server message:', msg);
            
            switch (msg.type) {
                case 'peers':
                    Events.fire('peers', msg.peers);
                    break;
                case 'peer-joined':
                    Events.fire('peer-joined', msg.peer);
                    break;
                case 'peer-left':
                    Events.fire('peer-left', msg.peerId);
                    break;
                case 'signal':
                    Events.fire('signal', msg);
                    break;
                case 'ping':
                    this.send({ type: 'pong' });
                    break;
                case 'display-name':
                    Events.fire('display-name', msg.message);
                    break;
                default:
                    console.error('Unknown message type:', msg.type);
            }
        } catch (e) {
            console.error('Error processing message:', e);
        }
    }
  
    /**
     * Send message to the server
     * @param {Object} message - Message to send (will be stringified)
     */
    send(message) {
        if (!this._isConnected()) return;
        this._socket.send(JSON.stringify(message));
    }
  
    /**
     * Determine the WebSocket endpoint based on current protocol
     * @returns {string} - WebSocket endpoint URL
     * @private
     */
    _endpoint() {
        // Use secure WebSockets if page is loaded over HTTPS
        const protocol = location.protocol.startsWith('https') ? 'wss' : 'ws';
        const webrtc = window.RTCPeerConnection ? '/webrtc' : '/fallback';
        const host = location.host || window.location.host;
        return `${protocol}://${host}/server${webrtc}`;
    }
  
    /**
     * Gracefully disconnect from the server
     * @private
     */
    _disconnect() {
        if (!this._socket) return;
        this.send({ type: 'disconnect' });
        this._socket.onclose = null; // Prevent reconnect on intentional close
        this._socket.close();
    }
  
    /**
     * Handle unexpected disconnection
     * @private
     */
    _onDisconnect() {
        console.log('Server disconnected');
        Events.fire('notify-user', 'Connection lost. Reconnecting in 5 seconds...');
        
        // Schedule reconnection attempt
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(() => this._connect(), 5000);
    }
  
    /**
     * Handle page visibility changes
     * @private
     */
    _onVisibilityChange() {
        if (document.hidden) return;
        this._connect(); // Reconnect when page becomes visible
    }
  
    /**
     * Check if connection is open
     * @returns {boolean} - True if connected
     * @private
     */
    _isConnected() {
        return this._socket && this._socket.readyState === WebSocket.OPEN;
    }
  
    /**
     * Check if connection is in progress
     * @returns {boolean} - True if connecting
     * @private
     */
    _isConnecting() {
        return this._socket && this._socket.readyState === WebSocket.CONNECTING;
    }
}
  
// ======================================================================
// PEER COMMUNICATION
// ======================================================================

/**
 * Peer - Base class for peer-to-peer communication
 */
class Peer {
    /**
     * @param {ServerConnection} serverConnection - Server connection for signaling
     * @param {string} peerId - ID of the remote peer
     */
    constructor(serverConnection, peerId) {
        this._server = serverConnection;
        this._peerId = peerId;
        this._filesQueue = [];
        this._busy = false;
    }
  
    /**
     * Send a JSON message to the peer
     * @param {Object} message - Message to send
     */
    sendJSON(message) {
        this._send(JSON.stringify(message));
    }
  
    /**
     * Queue and send files to the peer
     * @param {FileList|Array<File>} files - Files to send
     */
    sendFiles(files) {
        // Queue all files
        for (let i = 0; i < files.length; i++) {
            this._filesQueue.push(files[i]);
        }
        
        // Start sending if not already busy
        if (this._busy) return;
        this._dequeueFile();
    }
  
    /**
     * Process the next file in the queue
     * @private
     */
    _dequeueFile() {
        if (!this._filesQueue.length) return;
        
        this._busy = true;
        const file = this._filesQueue.shift();
        this._sendFile(file);
    }
  
    /**
     * Send a file to the peer
     * @param {File} file - File to send
     * @private
     */
    _sendFile(file) {
        // Send file metadata header
        this.sendJSON({
            type: 'header',
            name: file.name,
            mime: file.type,
            size: file.size
        });
        
        // Initialize file chunker for transfer
        this._chunker = new FileChunker(
            file,
            chunk => this._send(chunk),
            offset => this._onPartitionEnd(offset)
        );
        
        // Start sending the first partition
        this._chunker.nextPartition();
    }
  
    /**
     * Handle completion of a file partition
     * @param {number} offset - Current file offset
     * @private
     */
    _onPartitionEnd(offset) {
        this.sendJSON({ type: 'partition', offset: offset });
    }
  
    /**
     * Process partition-received acknowledgment
     * @param {Object} message - Partition received message
     * @private
     */
    _onReceivedPartitionEnd(message) {
        this.sendJSON({ type: 'partition-received', offset: message.offset });
    }
  
    /**
     * Send the next file partition
     * @private
     */
    _sendNextPartition() {
        if (!this._chunker || this._chunker.isFileEnd()) return;
        this._chunker.nextPartition();
    }
  
    /**
     * Send progress update to receiver
     * @param {number} progress - Progress value (0-1)
     * @private
     */
    _sendProgress(progress) {
        this.sendJSON({ type: 'progress', progress: progress });
    }
  
    /**
     * Process incoming peer messages
     * @param {string|ArrayBuffer} message - Received message
     * @private
     */
    _onMessage(message) {
        // Handle binary data (file chunk)
        if (typeof message !== 'string') {
            this._onChunkReceived(message);
            return;
        }
        
        // Handle JSON messages
        try {
            message = JSON.parse(message);
            console.log('Peer message:', message);
            
            switch (message.type) {
                case 'header':
                    this._onFileHeader(message);
                    break;
                case 'partition':
                    this._onReceivedPartitionEnd(message);
                    break;
                case 'partition-received':
                    this._sendNextPartition();
                    break;
                case 'progress':
                    this._onDownloadProgress(message.progress);
                    break;
                case 'transfer-complete':
                    this._onTransferCompleted();
                    break;
                case 'text':
                    this._onTextReceived(message);
                    break;
                case 'heartbeat':
                    // Just acknowledge heartbeats
                    this.sendJSON({ type: 'heartbeat-ack' });
                    break;
                case 'heartbeat-ack':
                    // Received acknowledgment of our heartbeat
                    break;
            }
        } catch (e) {
            console.error('Error processing peer message:', e);
        }
    }
  
    /**
     * Process file header to start receiving a file
     * @param {Object} header - File metadata
     * @private
     */
    _onFileHeader(header) {
        this._lastProgress = 0;
        
        // Initialize file digester to assemble received chunks
        this._digester = new FileDigester({
            name: header.name,
            mime: header.mime,
            size: header.size,
            sender: this._peerId
        }, file => this._onFileReceived(file));
        
        // Fire event to show progress dialog
        Events.fire('file-receive-start', {
            header: header,
            from: this._peerId
        });
    }
  
    /**
     * Process received file chunk
     * @param {ArrayBuffer} chunk - File data chunk
     * @private
     */
    _onChunkReceived(chunk) {
        if (!chunk.byteLength) return;
        
        // Add chunk to file digester
        this._digester.unchunk(chunk);
        
        // Calculate and report progress
        const progress = this._digester.progress;
        const bytesTransferred = this._digester ? Math.floor(this._digester.progress * this._digester._size) : 0;
        this._onDownloadProgress(progress, bytesTransferred);
  
        // Notify sender about our progress occasionally (1% increments)
        if (progress - this._lastProgress < 0.01) return;
        this._lastProgress = progress;
        this._sendProgress(progress);
    }
  
    /**
     * Handle download progress updates
     * @param {number} progress - Progress value (0-1)
     * @param {number} bytesTransferred - Bytes received so far
     * @private
     */
    _onDownloadProgress(progress, bytesTransferred = 0) {
        Events.fire('file-progress', { 
            sender: this._peerId, 
            progress: progress,
            bytesTransferred: bytesTransferred 
        });
    }
  
    /**
     * Handle completed file reception
     * @param {Object} proxyFile - Assembled file data
     * @private
     */
    _onFileReceived(proxyFile) {
        Events.fire('file-received', proxyFile);
        this.sendJSON({ type: 'transfer-complete' });
        Events.fire('file-transfer-complete');
    }
  
    /**
     * Handle transfer completion acknowledgment
     * @private
     */
    _onTransferCompleted() {
        this._onDownloadProgress(1);
        this._busy = false;
        this._dequeueFile(); // Process next file in queue
        Events.fire('notify-user', 'File transfer completed.');
        Events.fire('file-transfer-complete');
    }
  
    /**
     * Send text message to peer
     * @param {string} text - Text to send
     */
    sendText(text) {
        // Base64 encode the text to support all character types
        const unescaped = btoa(unescape(encodeURIComponent(text)));
        this.sendJSON({ type: 'text', text: unescaped });
    }
  
    /**
     * Process received text message
     * @param {Object} message - Text message object
     * @private
     */
    _onTextReceived(message) {
        // Decode the base64 text
        const escaped = decodeURIComponent(escape(atob(message.text)));
        Events.fire('text-received', { text: escaped, sender: this._peerId });
    }
}
  
// ======================================================================
// WEBRTC PEER IMPLEMENTATION
// ======================================================================

/**
 * RTCPeer - WebRTC implementation of peer connection
 */
class RTCPeer extends Peer {
    /**
     * @param {ServerConnection} serverConnection - Server connection for signaling
     * @param {string} peerId - ID of the remote peer (optional for answering peers)
     */
    constructor(serverConnection, peerId) {
        super(serverConnection, peerId);
        
        // Initialize heartbeat interval
        this._heartbeatInterval = null;
        
        if (!peerId) return; // We will listen for a caller
        this._connect(peerId, true);
    }
  
    /**
     * WebRTC configuration options
     */
    static config = {
        'sdpSemantics': 'unified-plan',
        'iceServers': [
            {
                urls: 'stun:stun.l.google.com:19302'
            }
        ]
    };
  
    /**
     * Establish or configure a WebRTC connection
     * @param {string} peerId - ID of the remote peer
     * @param {boolean} isCaller - True if this peer is initiating the connection
     * @private
     */
    _connect(peerId, isCaller) {
        if (!this._conn) this._openConnection(peerId, isCaller);
  
        if (isCaller) {
            this._openChannel();
        } else {
            this._conn.ondatachannel = e => this._onChannelOpened(e);
        }
    }
  
    /**
     * Initialize a new RTCPeerConnection
     * @param {string} peerId - ID of the remote peer
     * @param {boolean} isCaller - True if this peer is initiating the connection
     * @private
     */
    _openConnection(peerId, isCaller) {
        this._isCaller = isCaller;
        this._peerId = peerId;
        this._conn = new RTCPeerConnection(RTCPeer.config);
        
        // Set up event handlers
        this._conn.onicecandidate = e => this._onIceCandidate(e);
        this._conn.onconnectionstatechange = e => this._onConnectionStateChange(e);
        this._conn.oniceconnectionstatechange = e => this._onIceConnectionStateChange(e);
    }
  
    /**
     * Create and configure the data channel
     * @private
     */
    _openChannel() {
        const channel = this._conn.createDataChannel('data-channel', { 
            ordered: true
        });
        
        channel.onopen = e => this._onChannelOpened(e);
        
        // Create and send offer
        this._conn.createOffer()
            .then(d => this._onDescription(d))
            .catch(e => this._onError(e));
    }
  
    /**
     * Process local session description
     * @param {RTCSessionDescription} description - Session description
     * @private
     */
    _onDescription(description) {
        this._conn.setLocalDescription(description)
            .then(() => this._sendSignal({ sdp: description }))
            .catch(e => this._onError(e));
    }
  
    /**
     * Handle ICE candidate events
     * @param {RTCPeerConnectionIceEvent} event - ICE candidate event
     * @private
     */
    _onIceCandidate(event) {
        if (!event.candidate) return;
        this._sendSignal({ ice: event.candidate });
    }
  
    /**
     * Process signaling messages from the server
     * @param {Object} message - Signaling message
     */
    onServerMessage(message) {
        if (!this._conn) this._connect(message.sender, false);
  
        if (message.sdp) {
            this._conn.setRemoteDescription(new RTCSessionDescription(message.sdp))
                .then(() => {
                    if (message.sdp.type === 'offer') {
                        return this._conn.createAnswer()
                            .then(d => this._onDescription(d));
                    }
                })
                .catch(e => this._onError(e));
        } else if (message.ice) {
            this._conn.addIceCandidate(new RTCIceCandidate(message.ice))
                .catch(e => this._onError(e));
        }
    }
  
    /**
     * Handle data channel open event
     * @param {RTCDataChannelEvent|Event} event - Channel event
     * @private
     */
    _onChannelOpened(event) {
        console.log('Data channel opened with', this._peerId);
        
        const channel = event.channel || event.target;
        channel.binaryType = 'arraybuffer';
        channel.onmessage = e => this._onMessage(e.data);
        channel.onclose = () => this._onChannelClosed();
        this._channel = channel;
        
        // Start heartbeat to keep connection alive
        this._startHeartbeat();
        
        // Notify that the connection is established
        Events.fire('peer-connection-established', this._peerId);
    }
  
    /**
     * Start sending heartbeat messages to keep the connection alive
     * @private
     */
    _startHeartbeat() {
        // Clear any existing heartbeat
        this._stopHeartbeat();
        
        // Send heartbeat every 10 seconds
        this._heartbeatInterval = setInterval(() => {
            if (this._isConnected()) {
                this.sendJSON({ type: 'heartbeat' });
            } else if (!this._isConnecting()) {
                this.refresh();
            }
        }, 10000);
    }
    
    /**
     * Stop the heartbeat messages
     * @private
     */
    _stopHeartbeat() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
    }
  
    /**
     * Handle data channel close
     * @private
     */
    _onChannelClosed() {
        console.log('Data channel closed with', this._peerId);
        
        // Stop heartbeat when channel closes
        this._stopHeartbeat();
        
        if (!this._isCaller) return;
        this._connect(this._peerId, true); // Reopen the channel
    }
  
    /**
     * Monitor connection state changes
     * @private
     */
    _onConnectionStateChange() {
        console.log('Connection state changed:', this._conn.connectionState);
        
        switch (this._conn.connectionState) {
            case 'disconnected':
                this._onChannelClosed();
                break;
            case 'failed':
                this._conn = null;
                this._onChannelClosed();
                break;
        }
    }
  
    /**
     * Monitor ICE connection state changes
     * @private
     */
    _onIceConnectionStateChange() {
        console.log('ICE connection state:', this._conn.iceConnectionState);
        
        if (this._conn.iceConnectionState === 'failed') {
            console.error('ICE gathering failed');
        }
    }
  
    /**
     * Handle WebRTC errors
     * @param {Error} error - Error object
     * @private
     */
    _onError(error) {
        console.error('RTCPeer error:', error);
    }
  
    /**
     * Send data through the data channel
     * @param {string|ArrayBuffer} message - Data to send
     * @private
     */
    _send(message) {
        if (!this._channel) return this.refresh();
        this._channel.send(message);
    }
  
    /**
     * Send signaling data via the server
     * @param {Object} signal - Signal data
     * @private
     */
    _sendSignal(signal) {
        signal.type = 'signal';
        signal.to = this._peerId;
        this._server.send(signal);
    }
  
    /**
     * Attempt to restore connection if needed
     */
    refresh() {
        // Check if channel is open, otherwise create one
        if (this._isConnected() || this._isConnecting()) return;
        this._connect(this._peerId, this._isCaller);
    }
  
    /**
     * Check if data channel is connected
     * @returns {boolean} - True if connected
     * @private
     */
    _isConnected() {
        return this._channel && this._channel.readyState === 'open';
    }
  
    /**
     * Check if data channel is connecting
     * @returns {boolean} - True if connecting
     * @private
     */
    _isConnecting() {
        return this._channel && this._channel.readyState === 'connecting';
    }
    
    /**
     * Clean up resources when connection is destroyed
     */
    destroy() {
        this._stopHeartbeat();
        if (this._channel) {
            this._channel.onclose = null;
            this._channel.close();
        }
        if (this._conn) {
            this._conn.close();
            this._conn = null;
        }
    }
}
  
// ======================================================================
// WEBSOCKET FALLBACK PEER
// ======================================================================

/**
 * WSPeer - WebSocket fallback implementation of peer connection
 */
class WSPeer extends Peer {
    /**
     * @param {ServerConnection} serverConnection - Server connection for signaling
     * @param {string} peerId - ID of the remote peer
     */
    constructor(serverConnection, peerId) {
        super(serverConnection, peerId);
    }
    
    /**
     * Send data via the server
     * @param {string|ArrayBuffer} message - Data to send
     * @private
     */
    _send(message) {
        message.to = this._peerId;
        this._server.send(message);
    }
    
    /**
     * Refresh connection if needed
     */
    refresh() {
        // For WebSocket peers, just make sure server connection is active
        if (this._server) {
            this._server._connect();
        }
    }
}
  
// ======================================================================
// PEER MANAGEMENT
// ======================================================================

/**
 * PeersManager - Manages all peer connections
 */
class PeersManager {
    /**
     * @param {ServerConnection} serverConnection - Server connection for signaling
     */
    constructor(serverConnection) {
        this.peers = {};
        this._server = serverConnection;
        
        // Set up event listeners
        Events.on('signal', e => this._onMessage(e.detail));
        Events.on('peers', e => this._onPeers(e.detail));
        Events.on('files-selected', e => this._onFilesSelected(e.detail));
        Events.on('send-text', e => this._onSendText(e.detail));
        Events.on('peer-left', e => this._onPeerLeft(e.detail));
    }
  
    /**
     * Handle signaling messages
     * @param {Object} message - Signaling message
     * @private
     */
    _onMessage(message) {
        if (!this.peers[message.sender]) {
            this.peers[message.sender] = new RTCPeer(this._server);
        }
        this.peers[message.sender].onServerMessage(message);
    }
  
    /**
     * Handle peer discovery updates
     * @param {Array} peers - List of available peers
     * @private
     */
    _onPeers(peers) {
        peers.forEach(peer => {
            if (this.peers[peer.id]) {
                this.peers[peer.id].refresh();
                return;
            }
            
            // Create appropriate peer type based on capabilities
            if (window.RTCPeerConnection && peer.rtcSupported) {
                this.peers[peer.id] = new RTCPeer(this._server, peer.id);
            } else {
                this.peers[peer.id] = new WSPeer(this._server, peer.id);
            }
        });
    }
  
    /**
     * Handle file selection for sending
     * @param {Object} message - File selection message
     * @private
     */
    _onFilesSelected(message) {
        // Fire event to show progress dialog
        Events.fire('file-send-start', {
            files: message.files,
            to: message.to
        });
        
        // Then send files
        this.peers[message.to].sendFiles(message.files);
    }
  
    /**
     * Handle text message sending
     * @param {Object} message - Text message object
     * @private
     */
    _onSendText(message) {
        this.peers[message.to].sendText(message.text);
    }
  
    /**
     * Handle peer disconnection
     * @param {string} peerId - ID of departing peer
     * @private
     */
    _onPeerLeft(peerId) {
        const peer = this.peers[peerId];
        if (!peer) return;
        
        // Clean up peer resources if available
        if (peer.destroy) {
            peer.destroy();
        } else if (peer._conn) {
            peer._conn.close();
        }
        
        delete this.peers[peerId];
    }
    
    /**
     * Refresh all peer connections
     */
    refreshAllPeers() {
        for (const peerId in this.peers) {
            if (this.peers[peerId].refresh) {
                this.peers[peerId].refresh();
            }
        }
    }
}
  
// ======================================================================
// FILE HANDLING
// ======================================================================

/**
 * FileChunker - Splits file into chunks for transmission
 */
class FileChunker {
    /**
     * @param {File} file - File to chunk
     * @param {Function} onChunk - Callback for each chunk
     * @param {Function} onPartitionEnd - Callback for partition completion
     */
    constructor(file, onChunk, onPartitionEnd) {
        this._chunkSize = 64000; // 64 KB chunk size
        this._maxPartitionSize = 1e6; // 1 MB partition size
        this._offset = 0;
        this._partitionSize = 0;
        this._file = file;
        this._onChunk = onChunk;
        this._onPartitionEnd = onPartitionEnd;
        
        // Set up file reader
        this._reader = new FileReader();
        this._reader.addEventListener('load', e => this._onChunkRead(e.target.result));
    }
  
    /**
     * Start reading the next partition of the file
     */
    nextPartition() {
        this._partitionSize = 0;
        this._readChunk();
    }
  
    /**
     * Read a chunk from the current offset
     * @private
     */
    _readChunk() {
        const chunk = this._file.slice(this._offset, this._offset + this._chunkSize);
        this._reader.readAsArrayBuffer(chunk);
    }
  
    /**
     * Process a read chunk
     * @param {ArrayBuffer} chunk - File data chunk
     * @private
     */
    _onChunkRead(chunk) {
        this._offset += chunk.byteLength;
        this._partitionSize += chunk.byteLength;
        this._onChunk(chunk);
        
        if (this.isFileEnd()) return;
        
        if (this._isPartitionEnd()) {
            this._onPartitionEnd(this._offset);
            return;
        }
        
        this._readChunk();
    }
  
    /**
     * Check if current partition is complete
     * @returns {boolean} - True if partition is complete
     * @private
     */
    _isPartitionEnd() {
        return this._partitionSize >= this._maxPartitionSize;
    }
  
    /**
     * Check if entire file has been read
     * @returns {boolean} - True if file is complete
     */
    isFileEnd() {
        return this._offset >= this._file.size;
    }
  
    /**
     * Get current progress
     * @returns {number} - Progress value (0-1)
     */
    get progress() {
        return this._offset / this._file.size;
    }
}
  
/**
 * FileDigester - Assembles received file chunks
 */
class FileDigester {
    /**
     * @param {Object} meta - File metadata
     * @param {Function} callback - Callback for completed file
     */
    constructor(meta, callback) {
        this._buffer = [];
        this._bytesReceived = 0;
        this._size = meta.size;
        this._mime = meta.mime || 'application/octet-stream';
        this._name = meta.name;
        this._sender = meta.sender;
        this._callback = callback;
        this.progress = 0;
    }
  
    /**
     * Add a chunk to the file buffer
     * @param {ArrayBuffer} chunk - File data chunk
     */
    unchunk(chunk) {
        this._buffer.push(chunk);
        this._bytesReceived += chunk.byteLength || chunk.size;
        this.progress = this._bytesReceived / this._size;
        
        // Handle potential NaN from incorrect size
        if (isNaN(this.progress)) this.progress = 1;
  
        if (this._bytesReceived < this._size) return;
        
        // We are done, create the final file
        let blob = new Blob(this._buffer, { type: this._mime });
        this._callback({
            name: this._name,
            mime: this._mime,
            size: this._size,
            blob: blob,
            sender: this._sender
        });
    }
}
  
// ======================================================================
// INITIALIZATION
// ======================================================================

/**
 * Initialize the application when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', () => {
    const server = new ServerConnection();
    const peers = new PeersManager(server);
    
    // Make available for debugging
    window.drplNetwork = { server, peers };
});