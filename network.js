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
    ws.onopen = () => console.log('Server connected');
    ws.onmessage = e => this._onMessage(e.data);
    ws.onclose = () => this._onDisconnect();
    ws.onerror = e => console.error('WebSocket error:', e);
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
    this._socket.send(JSON.stringify(message));
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
    this.send({ type: 'disconnect' });
    this._socket.onclose = null;
    this._socket.close();
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
  }

  sendJSON(message) {
    this._send(JSON.stringify(message));
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
    
    this._busy = true;
    this._transferActive = true;
    const file = this._filesQueue.shift();
    this._sendFile(file);
  }

  _sendFile(file) {
    this.sendJSON({
      type: 'header',
      name: file.name,
      mime: file.type,
      size: file.size
    });
    
    this._chunker = new FileChunker(
      file,
      chunk => this._send(chunk),
      offset => this._onPartitionEnd(offset)
    );
    
    this._chunker.nextPartition();
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
      this._chunker = null;
      return;
    }
    
    this._chunker.nextPartition();
  }

  _sendProgress(progress) {
    this.sendJSON({ type: 'progress', progress: progress });
  }

  _onMessage(message) {
    if (typeof message !== 'string') {
      this._onChunkReceived(message);
      return;
    }
    
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
        case 'ping':
          this.sendJSON({ type: 'pong' });
          break;
        case 'pong':
          // Update connection status
          this._lastPong = Date.now();
          break;
      }
    } catch (e) {
      console.error('Error processing peer message:', e);
    }
  }

  _onFileHeader(header) {
    this._lastProgress = 0;
    this._digester = new FileDigester({
      name: header.name,
      mime: header.mime,
      size: header.size
    }, file => this._onFileReceived(file));
  }

  _onChunkReceived(chunk) {
    if (!chunk.byteLength) return;
    
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
    }, 500);
  }

  sendText(text) {
    const unescaped = btoa(unescape(encodeURIComponent(text)));
    this.sendJSON({ type: 'text', text: unescaped });
  }

  _onTextReceived(message) {
    const escaped = decodeURIComponent(escape(atob(message.text)));
    Events.fire('text-received', { text: escaped, sender: this._peerId });
  }
  
  // Keep the connection alive
  startKeepAlive() {
    this._stopKeepAlive();
    this._lastPong = Date.now();
    
    this._keepAliveInterval = setInterval(() => {
      // Check if we haven't received a pong in a long time
      if (Date.now() - this._lastPong > 10000 && !this._transferActive) {
        this.sendJSON({ type: 'ping' });
      }
    }, 5000);
  }
  
  _stopKeepAlive() {
    if (this._keepAliveInterval) {
      clearInterval(this._keepAliveInterval);
      this._keepAliveInterval = null;
    }
  }
}

// RTCPeer for WebRTC connections
class RTCPeer extends Peer {
  constructor(serverConnection, peerId) {
    super(serverConnection, peerId);
    this._reconnectAttempts = 0;
    
    if (!peerId) return; // We will listen for a caller
    
    this._connect(peerId, true);
    this.startKeepAlive();
  }

  _connect(peerId, isCaller) {
    if (!this._conn) this._openConnection(peerId, isCaller);

    if (isCaller) {
      this._openChannel();
    } else {
      this._conn.ondatachannel = e => this._onChannelOpened(e);
    }
  }

  _openConnection(peerId, isCaller) {
    this._isCaller = isCaller;
    this._peerId = peerId;
    
    // Create new RTCPeerConnection with updated config
    this._conn = new RTCPeerConnection(RTCPeer.config);
    this._conn.onicecandidate = e => this._onIceCandidate(e);
    this._conn.onconnectionstatechange = e => this._onConnectionStateChange(e);
    this._conn.oniceconnectionstatechange = e => this._onIceConnectionStateChange(e);
  }

  _openChannel() {
    const channel = this._conn.createDataChannel('data-channel', { 
      ordered: true
    });
    
    channel.onopen = e => this._onChannelOpened(e);
    channel.onclose = () => this._onChannelClosed();
    channel.onerror = e => console.error('Channel error:', e);
    
    this._conn.createOffer()
      .then(d => this._onDescription(d))
      .catch(e => this._onError(e));
  }

  _onDescription(description) {
    this._conn.setLocalDescription(description)
      .then(() => this._sendSignal({ sdp: description }))
      .catch(e => this._onError(e));
  }

  _onIceCandidate(event) {
    if (!event.candidate) return;
    this._sendSignal({ ice: event.candidate });
  }

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

  _onChannelOpened(event) {
    console.log('Data channel opened with', this._peerId);
    const channel = event.channel || event.target;
    channel.binaryType = 'arraybuffer';
    channel.onmessage = e => this._onMessage(e.data);
    channel.onclose = () => this._onChannelClosed();
    channel.onerror = e => console.error('Channel error:', e);
    
    this._channel = channel;
    this._reconnectAttempts = 0;
    
    // Start keep-alive mechanism
    this.startKeepAlive();
    
    // Fire connection established event
    Events.fire('peer-connection-established', this._peerId);
  }

  _onChannelClosed() {
    console.log('Data channel closed with', this._peerId);
    this._stopKeepAlive();
    
    // Only try to reopen if we were the caller and not during an active transfer
    if (!this._isCaller || this._transferActive) return;
    
    // Limit reconnection attempts
    if (this._reconnectAttempts >= 3) {
      console.log('Max reconnection attempts reached');
      return;
    }
    
    this._reconnectAttempts++;
    
    // Try to reestablish connection with exponential backoff
    const delay = 1000 * Math.pow(2, this._reconnectAttempts - 1);
    console.log(`Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);
    
    setTimeout(() => {
      this._connect(this._peerId, true);
    }, delay);
  }

  _onConnectionStateChange() {
    console.log('Connection state changed:', this._conn.connectionState);
    
    switch (this._conn.connectionState) {
      case 'connected':
        this._reconnectAttempts = 0;
        break;
      case 'disconnected':
        if (!this._transferActive) {
          this._onChannelClosed();
        }
        break;
      case 'failed':
        this._conn = null;
        this._onChannelClosed();
        break;
    }
  }

  _onIceConnectionStateChange() {
    console.log('ICE connection state:', this._conn.iceConnectionState);
    
    if (this._conn.iceConnectionState === 'failed') {
      console.error('ICE gathering failed');
      
      // Try to restart ICE if possible
      if (this._conn.restartIce) {
        this._conn.restartIce();
      }
    }
  }

  _onError(error) {
    console.error('RTCPeer error:', error);
  }

  _send(message) {
    if (!this._channel || this._channel.readyState !== 'open') {
      this.refresh();
      // Queue the message for retry
      if (typeof message === 'string') {
        setTimeout(() => this._send(message), 500);
      }
      return;
    }
    
    try {
      this._channel.send(message);
    } catch (e) {
      console.error('Send error:', e);
      // For non-binary messages, try to recover
      if (typeof message === 'string') {
        setTimeout(() => this._send(message), 1000);
      }
    }
  }

  _sendSignal(signal) {
    signal.type = 'signal';
    signal.to = this._peerId;
    this._server.send(signal);
  }

  refresh() {
    // Check if channel is open, otherwise create one
    if (this._isConnected() || this._isConnecting()) return;
    this._connect(this._peerId, this._isCaller);
  }

  _isConnected() {
    return this._channel && this._channel.readyState === 'open';
  }

  _isConnecting() {
    return this._channel && this._channel.readyState === 'connecting';
  }
  
  // Clean up when peer is removed
  destroy() {
    this._stopKeepAlive();
    
    if (this._channel) {
      this._channel.onclose = null;
      this._channel.onmessage = null;
      this._channel.onerror = null;
      this._channel.close();
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
  }
}

// WebRTC configuration with additional STUN servers
RTCPeer.config = {
  'sdpSemantics': 'unified-plan',
  'iceServers': [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302'
      ]
    }
  ],
  'iceCandidatePoolSize': 5
};

// WSPeer for fallback when WebRTC is not available
class WSPeer extends Peer {
  constructor(serverConnection, peerId) {
    super(serverConnection, peerId);
    this.startKeepAlive();
  }
  
  _send(message) {
    message.to = this._peerId;
    this._server.send(message);
  }
  
  destroy() {
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
      return;
    }
    
    this.peers[message.to].sendFiles(message.files);
  }

  _onSendText(message) {
    if (!this.peers[message.to]) {
      console.error('Peer not found:', message.to);
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
    this._chunkSize = 64000; // 64 KB
    this._maxPartitionSize = 1e6; // 1 MB
    this._offset = 0;
    this._partitionSize = 0;
    this._file = file;
    this._onChunk = onChunk;
    this._onPartitionEnd = onPartitionEnd;
    this._reader = new FileReader();
    this._reader.addEventListener('load', e => this._onChunkRead(e.target.result));
  }

  nextPartition() {
    this._partitionSize = 0;
    this._readChunk();
  }

  _readChunk() {
    const chunk = this._file.slice(this._offset, this._offset + this._chunkSize);
    this._reader.readAsArrayBuffer(chunk);
  }

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
    this._buffer.push(chunk);
    this._bytesReceived += chunk.byteLength || chunk.size;
    this.progress = this._bytesReceived / this._size;
    if (isNaN(this.progress)) this.progress = 1;

    if (this._bytesReceived < this._size) return;
    
    // We are done, create the final file
    let blob = new Blob(this._buffer, { type: this._mime });
    this._callback({
      name: this._name,
      mime: this._mime,
      size: this._size,
      blob: blob
    });
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