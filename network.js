// Events handling
class Events {
  static fire(type, detail) {
    window.dispatchEvent(new CustomEvent(type, { detail: detail }));
  }

  static on(type, callback) {
    return window.addEventListener(type, callback);
  }

  static off(type, callback) {
    return window.removeEventListener(type, callback);
  }
}

// Server connection
class ServerConnection {
  constructor() {
    this._connect();
    Events.on('beforeunload', () => this._disconnect());
    Events.on('pagehide', () => this._disconnect());
    document.addEventListener('visibilitychange', () => this._onVisibilityChange());
  }

  _connect() {
    clearTimeout(this._reconnectTimer);
    if (this._isConnected() || this._isConnecting()) return;
    
    const ws = new WebSocket(this._endpoint());
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      console.log('Server connected');
      Events.fire('notify-user', 'Connected to server');
    };
    ws.onmessage = e => this._onMessage(e.data);
    ws.onclose = () => this._onDisconnect();
    ws.onerror = e => {
      console.error('WebSocket error:', e);
      // Don't disconnect immediately - let onclose handle it
    };
    this._socket = ws;
  }

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

  send(message) {
    if (!this._isConnected()) return;
    try {
      this._socket.send(JSON.stringify(message));
    } catch (e) {
      console.error('Error sending message to server:', e);
    }
  }

  _endpoint() {
    // Use secure WebSockets if page is loaded over HTTPS
    const protocol = location.protocol.startsWith('https') ? 'wss' : 'ws';
    const webrtc = window.RTCPeerConnection ? '/webrtc' : '/fallback';
    const host = location.host || window.location.host;
    return `${protocol}://${host}/server${webrtc}`;
  }

  _disconnect() {
    if (!this._socket) return;
    try {
      this.send({ type: 'disconnect' });
      this._socket.onclose = null;
      this._socket.close();
    } catch (e) {
      console.error('Error disconnecting from server:', e);
    }
  }

  _onDisconnect() {
    console.log('Server disconnected');
    Events.fire('notify-user', 'Connection lost. Reconnecting in 5 seconds...');
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._connect(), 5000);
  }

  _onVisibilityChange() {
    if (document.hidden) return;
    this._connect();
  }

  _isConnected() {
    return this._socket && this._socket.readyState === WebSocket.OPEN;
  }

  _isConnecting() {
    return this._socket && this._socket.readyState === WebSocket.CONNECTING;
  }
}

// Peer handling
class Peer {
  constructor(serverConnection, peerId) {
    this._server = serverConnection;
    this._peerId = peerId;
    this._filesQueue = [];
    this._busy = false;
    this._transferActive = false;
    this._messageQueue = [];
    this._lastPongTime = Date.now();
  }

  sendJSON(message) {
    // Queue message if we can't send it right now
    if (!this._isChannelReady()) {
      this._queueMessage(JSON.stringify(message));
      return;
    }
    
    this._send(JSON.stringify(message));
  }

  _queueMessage(message) {
    // Only queue string messages (JSON), not binary
    if (typeof message === 'string') {
      this._messageQueue.push(message);
      console.log(`Message queued for peer ${this._peerId}. Queue size: ${this._messageQueue.length}`);
    }
  }

  _processQueue() {
    if (!this._isChannelReady() || this._messageQueue.length === 0) return;
    
    console.log(`Processing message queue (${this._messageQueue.length} items) for peer ${this._peerId}`);
    
    // Process all queued messages
    while (this._messageQueue.length > 0 && this._isChannelReady()) {
      const message = this._messageQueue.shift();
      this._send(message);
    }
  }

  sendFiles(files) {
    // Add files to the queue
    for (let i = 0; i < files.length; i++) {
      this._filesQueue.push(files[i]);
    }
    
    // If not currently sending a file, start the process
    if (!this._busy) {
      this._dequeueFile();
    }
  }

  _dequeueFile() {
    if (!this._filesQueue.length) {
      this._busy = false;
      return;
    }
    
    // Don't start a new transfer if the channel isn't ready
    if (!this._isChannelReady()) {
      console.log('Channel not ready for file transfer, waiting...');
      
      // Retry after a short delay
      setTimeout(() => {
        if (this._isChannelReady()) {
          this._dequeueFile();
        } else {
          console.log('Channel still not ready, delaying file transfer');
        }
      }, 2000);
      
      return;
    }
    
    this._busy = true;
    this._transferActive = true;
    const file = this._filesQueue.shift();
    
    console.log(`Starting file transfer: ${file.name} (${this._formatFileSize(file.size)})`);
    this._sendFile(file);
  }

  _formatFileSize(bytes) {
    if (bytes >= 1e9) {
      return (Math.round(bytes / 1e8) / 10) + ' GB';
    } else if (bytes >= 1e6) {
      return (Math.round(bytes / 1e5) / 10) + ' MB';
    } else if (bytes > 1000) {
      return Math.round(bytes / 1000) + ' KB';
    } else {
      return bytes + ' Bytes';
    }
  }

  _sendFile(file) {
    const header = {
      type: 'header',
      name: file.name,
      mime: file.type,
      size: file.size
    };
    
    this.sendJSON(header);
    
    // Wait a bit before starting the chunking process
    setTimeout(() => {
      this._chunker = new FileChunker(
        file,
        chunk => this._send(chunk),
        offset => this._onPartitionEnd(offset)
      );
      
      this._chunker.nextPartition();
    }, 300);
  }

  _onPartitionEnd(offset) {
    this.sendJSON({ type: 'partition', offset: offset });
  }

  _onReceivedPartitionEnd(message) {
    this.sendJSON({ type: 'partition-received', offset: message.offset });
  }

  _sendNextPartition() {
    if (!this._chunker) return;
    
    if (this._chunker.isFileEnd()) {
      console.log('File transfer completed');
      this._chunker = null;
      return;
    }
    
    this._chunker.nextPartition();
  }

  _sendProgress(progress) {
    this.sendJSON({ type: 'progress', progress: progress });
  }

  _onMessage(message) {
    // Keep connection alive whenever we receive a message
    this._lastPongTime = Date.now();
    
    if (typeof message !== 'string') {
      this._onChunkReceived(message);
      return;
    }
    
    try {
      message = JSON.parse(message);
      
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
        case 'ping':
          this.sendJSON({ type: 'pong' });
          break;
        case 'pong':
          // Update connection status
          this._lastPongTime = Date.now();
          break;
      }
    } catch (e) {
      console.error('Error processing peer message:', e);
    }
  }

  _onFileHeader(header) {
    this._lastProgress = 0;
    console.log(`Receiving file: ${header.name} (${this._formatFileSize(header.size)})`);
    
    this._digester = new FileDigester({
      name: header.name,
      mime: header.mime,
      size: header.size
    }, file => this._onFileReceived(file));
  }

  _onChunkReceived(chunk) {
    if (!chunk || !chunk.byteLength) return;
    
    if (!this._digester) {
      console.error('Received chunk but no file digester available');
      return;
    }
    
    this._digester.unchunk(chunk);
    const progress = this._digester.progress;
    this._onDownloadProgress(progress);

    // Notify sender about our progress occasionally
    if (progress - this._lastProgress < 0.01) return;
    this._lastProgress = progress;
    this._sendProgress(progress);
  }

  _onDownloadProgress(progress) {
    Events.fire('file-progress', { sender: this._peerId, progress: progress });
  }

  _onFileReceived(proxyFile) {
    console.log(`File received: ${proxyFile.name} (${this._formatFileSize(proxyFile.size)})`);
    Events.fire('file-received', proxyFile);
    this.sendJSON({ type: 'transfer-complete' });
  }

  _onTransferCompleted() {
    this._onDownloadProgress(1);
    this._transferActive = false;
    
    // Important: Delay before starting the next file
    // to ensure connection stays stable
    setTimeout(() => {
      this._busy = false;
      this._dequeueFile();
      Events.fire('file-transfer-complete');
      Events.fire('notify-user', 'File transfer completed');
    }, 1000);
  }

  sendText(text) {
    try {
      const unescaped = btoa(unescape(encodeURIComponent(text)));
      this.sendJSON({ type: 'text', text: unescaped });
    } catch (e) {
      console.error('Error encoding text message:', e);
      // Send as plain text if encoding fails
      this.sendJSON({ type: 'text', text: text });
    }
  }

  _onTextReceived(message) {
    try {
      const escaped = decodeURIComponent(escape(atob(message.text)));
      Events.fire('text-received', { text: escaped, sender: this._peerId });
    } catch (e) {
      console.error('Error decoding text message:', e);
      // If decoding fails, use the raw text
      Events.fire('text-received', { text: message.text, sender: this._peerId });
    }
  }
  
  // Keep the connection alive
  startKeepAlive() {
    this._stopKeepAlive();
    this._lastPongTime = Date.now();
    
    // Set a longer interval to avoid frequent pings
    this._keepAliveInterval = setInterval(() => {
      const now = Date.now();
      
      // Only send ping if we haven't received any message in a while
      // and we're not in the middle of a file transfer
      if ((now - this._lastPongTime > 30000) && !this._transferActive && this._isChannelReady()) {
        console.log(`Sending keep-alive ping to peer ${this._peerId}`);
        this.sendJSON({ type: 'ping' });
      }
      
      // Check if connection is dead (no response for 60 seconds and not transferring)
      if ((now - this._lastPongTime > 60000) && !this._transferActive) {
        console.log(`Connection to peer ${this._peerId} may be dead, attempting to refresh`);
        this.refresh();
      }
    }, 15000); // Check every 15 seconds
  }
  
  _stopKeepAlive() {
    if (this._keepAliveInterval) {
      clearInterval(this._keepAliveInterval);
      this._keepAliveInterval = null;
    }
  }
  
  // Check if the channel is ready for sending
  _isChannelReady() {
    // This method should be implemented by subclasses (RTCPeer and WSPeer)
    return false;
  }
}

// RTCPeer for WebRTC connections
class RTCPeer extends Peer {
  constructor(serverConnection, peerId) {
    super(serverConnection, peerId);
    this._reconnectAttempts = 0;
    this._connectionTimeout = null;
    
    if (!peerId) return; // We will listen for a caller
    
    this._connect(peerId, true);
    this.startKeepAlive();
  }

  _connect(peerId, isCaller) {
    // Clear any pending connection timeout
    if (this._connectionTimeout) {
      clearTimeout(this._connectionTimeout);
      this._connectionTimeout = null;
    }
    
    if (!this._conn) this._openConnection(peerId, isCaller);

    if (isCaller) {
      this._openChannel();
    } else {
      this._conn.ondatachannel = e => this._onChannelOpened(e);
    }
    
    // Set a timeout for connection establishment
    this._connectionTimeout = setTimeout(() => {
      if (!this._isChannelReady()) {
        console.log(`Connection timeout for peer ${this._peerId}, retrying...`);
        this._reconnect();
      }
    }, 15000); // 15 second timeout
  }

  _openConnection(peerId, isCaller) {
    this._isCaller = isCaller;
    this._peerId = peerId;
    
    // Create new RTCPeerConnection with updated config
    console.log(`Creating new RTCPeerConnection for peer ${peerId}`);
    this._conn = new RTCPeerConnection(RTCPeer.config);
    
    // Set up event handlers
    this._conn.onicecandidate = e => this._onIceCandidate(e);
    this._conn.onconnectionstatechange = e => this._onConnectionStateChange(e);
    this._conn.oniceconnectionstatechange = e => this._onIceConnectionStateChange(e);
  }

  _openChannel() {
    try {
      console.log(`Opening data channel to peer ${this._peerId}`);
      const channel = this._conn.createDataChannel('data-channel', { 
        ordered: true
      });
      
      channel.onopen = e => this._onChannelOpened(e);
      channel.onclose = () => this._onChannelClosed();
      channel.onerror = e => this._onChannelError(e);
      
      this._conn.createOffer()
        .then(d => this._onDescription(d))
        .catch(e => this._onError(e));
    } catch (e) {
      console.error('Error creating data channel:', e);
      this._reconnect();
    }
  }

  _onDescription(description) {
    if (!this._conn) {
      console.error('No connection when setting local description');
      return;
    }
    
    this._conn.setLocalDescription(description)
      .then(() => this._sendSignal({ sdp: description }))
      .catch(e => this._onError(e));
  }

  _onIceCandidate(event) {
    if (!event.candidate) return;
    this._sendSignal({ ice: event.candidate });
  }

  onServerMessage(message) {
    // Reset connection timeout as we received a signaling message
    if (this._connectionTimeout) {
      clearTimeout(this._connectionTimeout);
      this._connectionTimeout = null;
    }
    
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
        .catch(e => {
          // Not fatal, can happen in normal operation
          console.log('Error adding ICE candidate:', e);
        });
    }
  }

  _onChannelOpened(event) {
    console.log('Data channel opened with', this._peerId);
    
    // Clear connection timeout
    if (this._connectionTimeout) {
      clearTimeout(this._connectionTimeout);
      this._connectionTimeout = null;
    }
    
    const channel = event.channel || event.target;
    channel.binaryType = 'arraybuffer';
    
    // Set up event handlers
    channel.onmessage = e => this._onMessage(e.data);
    channel.onclose = () => this._onChannelClosed();
    channel.onerror = e => this._onChannelError(e);
    
    this._channel = channel;
    this._reconnectAttempts = 0;
    
    // Start keep-alive mechanism
    this.startKeepAlive();
    
    // Process any queued messages
    this._processQueue();
    
    // Fire connection established event
    Events.fire('peer-connection-established', this._peerId);
  }

  _onChannelError(event) {
    console.error(`Channel error with peer ${this._peerId}:`, event);
    
    // Don't attempt immediate reconnection - let onclose handle it
    // as the channel will likely close after an error
  }

  _onChannelClosed() {
    console.log(`Data channel closed with peer ${this._peerId}`);
    this._stopKeepAlive();
    
    // Don't reconnect during active transfers
    if (this._transferActive) {
      console.log('Not reconnecting during active transfer');
      return;
    }
    
    this._reconnect();
  }

  _reconnect() {
    // Only try to reconnect if we were the caller
    if (!this._isCaller) {
      console.log('Not reconnecting as we are not the caller');
      return;
    }
    
    // Limit reconnection attempts
    if (this._reconnectAttempts >= 5) {
      console.log('Max reconnection attempts reached');
      return;
    }
    
    this._reconnectAttempts++;
    
    // Try to reestablish connection with exponential backoff
    const delay = Math.min(30000, 1000 * Math.pow(2, this._reconnectAttempts));
    console.log(`Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);
    
    setTimeout(() => {
      // Clean up old connection
      if (this._channel) {
        this._channel.onclose = null;
        this._channel.onmessage = null;
        this._channel.onerror = null;
      }
      
      if (this._conn) {
        this._conn.onicecandidate = null;
        this._conn.onconnectionstatechange = null;
        this._conn.oniceconnectionstatechange = null;
        this._conn.ondatachannel = null;
        this._conn.close();
      }
      
      this._channel = null;
      this._conn = null;
      
      // Create new connection
      this._connect(this._peerId, true);
    }, delay);
  }

  _onConnectionStateChange() {
    console.log(`Connection state changed for peer ${this._peerId}:`, this._conn.connectionState);
    
    switch (this._conn.connectionState) {
      case 'connected':
        this._reconnectAttempts = 0;
        break;
      case 'disconnected':
        if (!this._transferActive) {
          console.log('Connection disconnected, will attempt to recover');
          // Don't immediately close the channel, as it might recover
        }
        break;
      case 'failed':
        console.log('Connection failed, cleaning up');
        this._conn = null;
        this._onChannelClosed();
        break;
    }
  }

  _onIceConnectionStateChange() {
    console.log(`ICE connection state for peer ${this._peerId}:`, this._conn.iceConnectionState);
    
    if (this._conn.iceConnectionState === 'failed') {
      console.error('ICE gathering failed');
      
      // Try to restart ICE if possible
      if (this._conn.restartIce) {
        console.log('Attempting to restart ICE');
        this._conn.restartIce();
      } else {
        console.log('ICE restart not supported, will attempt reconnection');
        this._reconnect();
      }
    }
  }

  _onError(error) {
    console.error(`RTCPeer error with ${this._peerId}:`, error);
    
    // Some errors are fatal and require reconnection
    if (error.name === 'NotFoundError' || 
        error.name === 'NotReadableError' || 
        error.name === 'AbortError') {
      console.log('Fatal error detected, attempting reconnection');
      this._reconnect();
    }
  }

  _send(message) {
    if (!this._isChannelReady()) {
      if (typeof message === 'string') {
        // Queue string messages for retry
        this._queueMessage(message);
      }
      return;
    }
    
    try {
      this._channel.send(message);
    } catch (e) {
      console.error(`Error sending message to peer ${this._peerId}:`, e);
      
      // For non-binary messages, queue for retry
      if (typeof message === 'string') {
        this._queueMessage(message);
      }
      
      // Channel may be broken, attempt to refresh
      this.refresh();
    }
  }

  _sendSignal(signal) {
    signal.type = 'signal';
    signal.to = this._peerId;
    this._server.send(signal);
  }

  refresh() {
    // Check if channel is open, otherwise create one
    if (this._isChannelReady()) return;
    
    console.log(`Refreshing connection to peer ${this._peerId}`);
    this._connect(this._peerId, this._isCaller);
  }

  _isChannelReady() {
    return this._channel && this._channel.readyState === 'open';
  }

  _isConnecting() {
    return this._channel && this._channel.readyState === 'connecting';
  }
  
  // Clean up when peer is removed
  destroy() {
    console.log(`Destroying peer connection with ${this._peerId}`);
    this._stopKeepAlive();
    
    if (this._connectionTimeout) {
      clearTimeout(this._connectionTimeout);
      this._connectionTimeout = null;
    }
    
    if (this._channel) {
      this._channel.onclose = null;
      this._channel.onmessage = null;
      this._channel.onerror = null;
      try {
        this._channel.close();
      } catch (e) {
        console.error('Error closing channel:', e);
      }
    }
    
    if (this._conn) {
      this._conn.onicecandidate = null;
      this._conn.onconnectionstatechange = null;
      this._conn.oniceconnectionstatechange = null;
      this._conn.ondatachannel = null;
      try {
        this._conn.close();
      } catch (e) {
        console.error('Error closing connection:', e);
      }
    }
    
    this._channel = null;
    this._conn = null;
  }
}

// WebRTC configuration with additional STUN servers and more robust settings
RTCPeer.config = {
  'sdpSemantics': 'unified-plan',
  'iceServers': [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302'
      ]
    }
  ],
  'iceCandidatePoolSize': 10,
  'bundlePolicy': 'max-bundle',
  'rtcpMuxPolicy': 'require'
};

// WSPeer for fallback when WebRTC is not available
class WSPeer extends Peer {
  constructor(serverConnection, peerId) {
    super(serverConnection, peerId);
    this._connected = true; // WSPeer is always "connected" through the server
    this.startKeepAlive();
  }
  
  _send(message) {
    if (typeof message === 'string') {
      // For JSON messages
      const jsonMessage = { to: this._peerId };
      try {
        Object.assign(jsonMessage, JSON.parse(message));
        this._server.send(jsonMessage);
      } catch (e) {
        console.error('Error parsing message for WSPeer:', e);
        
        // Send as raw message if parsing fails
        this._server.send({
          to: this._peerId,
          type: 'message',
          message: message
        });
      }
    } else {
      // For binary messages (files)
      console.error('Binary messages not supported in WSPeer mode');
      // Notify user that file sending isn't available in fallback mode
      Events.fire('notify-user', 'File sending not available in compatibility mode');
    }
  }
  
  _isChannelReady() {
    return this._connected;
  }
  
  destroy() {
    this._connected = false;
    this._stopKeepAlive();
  }
}

// Manage all peers
class PeersManager {
  constructor(serverConnection) {
    this.peers = {};
    this._server = serverConnection;
    
    Events.on('signal', e => this._onMessage(e.detail));
    Events.on('peers', e => this._onPeers(e.detail));
    Events.on('files-selected', e => this._onFilesSelected(e.detail));
    Events.on('send-text', e => this._onSendText(e.detail));
    Events.on('peer-left', e => this._onPeerLeft(e.detail));
  }

  _onMessage(message) {
    if (!this.peers[message.sender]) {
      this.peers[message.sender] = new RTCPeer(this._server);
    }
    this.peers[message.sender].onServerMessage(message);
  }

  _onPeers(peers) {
    peers.forEach(peer => {
      if (this.peers[peer.id]) {
        this.peers[peer.id].refresh();
        return;
      }
      
      if (window.RTCPeerConnection && peer.rtcSupported) {
        this.peers[peer.id] = new RTCPeer(this._server, peer.id);
      } else {
        this.peers[peer.id] = new WSPeer(this._server, peer.id);
      }
    });
  }

  _onFilesSelected(message) {
    if (!this.peers[message.to]) {
      console.error('Peer not found:', message.to);
      Events.fire('notify-user', 'Peer no longer available');
      return;
    }
    
    this.peers[message.to].sendFiles(message.files);
  }

  _onSendText(message) {
    if (!this.peers[message.to]) {
      console.error('Peer not found:', message.to);
      Events.fire('notify-user', 'Peer no longer available');
      return;
    }
    
    this.peers[message.to].sendText(message.text);
  }

  _onPeerLeft(peerId) {
    const peer = this.peers[peerId];
    
    if (!peer) return;
    
    // Properly clean up the peer connection
    peer.destroy();
    delete this.peers[peerId];
  }
}

// File chunking for sending files
class FileChunker {
  constructor(file, onChunk, onPartitionEnd) {
    // Smaller chunk size for better reliability
    this._chunkSize = 32768; // 32 KB (half the original size)
    this._maxPartitionSize = 1048576; // 1 MB
    this._offset = 0;
    this._partitionSize = 0;
    this._file = file;
    this._onChunk = onChunk;
    this._onPartitionEnd = onPartitionEnd;
    this._reader = new FileReader();
    this._reader.addEventListener('load', e => this._onChunkRead(e.target.result));
    this._reader.addEventListener('error', e => this._onReadError(e));
  }

  nextPartition() {
    this._partitionSize = 0;
    this._readChunk();
  }

  _readChunk() {
    try {
      const chunk = this._file.slice(this._offset, this._offset + this._chunkSize);
      this._reader.readAsArrayBuffer(chunk);
    } catch (e) {
      console.error('Error reading file chunk:', e);
      // Wait and retry
      setTimeout(() => this._readChunk(), 1000);
    }
  }

  _onChunkRead(chunk) {
    this._offset += chunk.byteLength;
    this._partitionSize += chunk.byteLength;
    
    try {
      this._onChunk(chunk);
    } catch (e) {
      console.error('Error processing chunk:', e);
      // Wait and retry the whole partition
      this._offset -= this._partitionSize;
      this._partitionSize = 0;
      setTimeout(() => this.nextPartition(), 2000);
      return;
    }
    
    if (this.isFileEnd()) return;
    
    if (this._isPartitionEnd()) {
      this._onPartitionEnd(this._offset);
      return;
    }
    
    // Add a small delay between chunks to prevent overwhelming the connection
    setTimeout(() => this._readChunk(), 0);
  }

  _onReadError(error) {
    console.error('Error reading file:', error);
    
    // Wait and retry
    setTimeout(() => {
      if (!this.isFileEnd()) {
        this._readChunk();
      }
    }, 2000);
  }

  _isPartitionEnd() {
    return this._partitionSize >= this._maxPartitionSize;
  }

  isFileEnd() {
    return this._offset >= this._file.size;
  }

  get progress() {
    return this._offset / this._file.size;
  }
}

// File receiving and assembly
class FileDigester {
  constructor(meta, callback) {
    this._buffer = [];
    this._bytesReceived = 0;
    this._size = meta.size;
    this._mime = meta.mime || 'application/octet-stream';
    this._name = meta.name;
    this._callback = callback;
  }

  unchunk(chunk) {
    if (!chunk) {
      console.error('Received empty chunk');
      return;
    }
    
    try {
      this._buffer.push(chunk);
      this._bytesReceived += chunk.byteLength || chunk.size;
      this.progress = this._bytesReceived / this._size;
      
      // Handle edge cases
      if (isNaN(this.progress)) this.progress = 1;
      if (this.progress > 1) this.progress = 1;
      
      // File is complete
      if (this._bytesReceived >= this._size) {
        console.log(`File assembly complete: ${this._name} (${this._bytesReceived} bytes)`);
        this._assembleFile();
      }
    } catch (e) {
      console.error('Error processing file chunk:', e);
    }
  }
  
  _assembleFile() {
    try {
      // Create the final file blob
      let blob = new Blob(this._buffer, { type: this._mime });
      
      // Call the callback with file information
      this._callback({
        name: this._name,
        mime: this._mime,
        size: this._size,
        blob: blob
      });
      
      // Clear buffer to free memory
      this._buffer = [];
    } catch (e) {
      console.error('Error assembling file:', e);
    }
  }
}

// Start the application
document.addEventListener('DOMContentLoaded', () => {
  const server = new ServerConnection();
  const peers = new PeersManager(server);
  
  // Expose to window for debugging
  window.drplNetwork = {
    server: server,
    peers: peers
  };
});