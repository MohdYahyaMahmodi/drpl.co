/**
 * Drpl.co - WebRTC File Transfer Application
 * Version 7.0.0
 * 
 * Major improvements:
 * 1. Adaptive chunking based on network conditions
 * 2. Better buffer management for data channels
 * 3. Improved progress reporting with speed and ETA
 * 4. Auto-reconnection for WebSocket and WebRTC
 * 5. Better error handling and recovery
 * 6. Modern UI with improved feedback
 * 7. StreamSaver.js for handling large files
 */

// Configuration
const CONFIG = {
  // WebRTC configuration
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ],
  
  // File transfer settings
  initialChunkSize: 65536,   // Initial chunk size (64KB)
  minChunkSize: 16384,       // Minimum chunk size (16KB)
  maxChunkSize: 262144,      // Maximum chunk size (256KB)
  bufferThreshold: 1048576,  // 1MB buffer threshold
  
  // Reconnection settings
  wsReconnectDelay: 2000,    // WebSocket reconnect delay in ms
  maxReconnectAttempts: 10,  // Maximum WebSocket reconnect attempts
  
  // UI settings
  uiUpdateInterval: 500,     // UI update interval in ms
  speedAverageWindow: 5      // Number of samples for speed calculation
};

// Utility event bus
const EventBus = {
  _events: {},
  
  on(eventName, callback) {
    if (!this._events[eventName]) {
      this._events[eventName] = [];
    }
    this._events[eventName].push(callback);
    return this;
  },
  
  off(eventName, callback) {
    if (this._events[eventName]) {
      if (callback) {
        this._events[eventName] = this._events[eventName].filter(cb => cb !== callback);
      } else {
        delete this._events[eventName];
      }
    }
    return this;
  },
  
  emit(eventName, ...args) {
    if (this._events[eventName]) {
      this._events[eventName].forEach(callback => {
        try {
          callback(...args);
        } catch (error) {
          console.error(`Error in event handler for ${eventName}:`, error);
        }
      });
    }
    return this;
  }
};

// Utility functions
const Utils = {
  /**
   * Detect device type from user agent
   */
  detectDeviceType() {
    const ua = navigator.userAgent.toLowerCase();
    if (/mobile|iphone|ipod|blackberry|android.*mobile/.test(ua)) {
      return 'mobile';
    } else if (/ipad|android(?!.*mobile)/.test(ua)) {
      return 'tablet';
    }
    return 'desktop';
  },
  
  /**
   * Generate a UUID
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },
  
  /**
   * Format bytes to human-readable format
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  },
  
  /**
   * Format transfer speed
   */
  formatSpeed(bytesPerSecond) {
    return this.formatBytes(bytesPerSecond) + '/s';
  },
  
  /**
   * Format time remaining
   */
  formatTimeRemaining(seconds) {
    if (!isFinite(seconds) || seconds < 0) {
      return 'calculating...';
    }
    
    if (seconds < 60) {
      return `${Math.ceil(seconds)}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = Math.ceil(seconds % 60);
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  },
  
  /**
   * Throttle function execution
   */
  throttle(func, delay) {
    let lastCall = 0;
    return function(...args) {
      const now = new Date().getTime();
      if (now - lastCall < delay) {
        return;
      }
      lastCall = now;
      return func(...args);
    };
  },
  
  /**
   * Get file icon based on MIME type or extension
   */
  getFileIcon(file) {
    const mime = file.type || '';
    const name = file.name || '';
    const extension = name.split('.').pop().toLowerCase();
    
    // Icons by type
    if (mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(name)) {
      return 'fa-file-image';
    } else if (mime.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/i.test(name)) {
      return 'fa-file-video';
    } else if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac)$/i.test(name)) {
      return 'fa-file-audio';
    } else if (mime.startsWith('text/') || /\.(txt|md|csv|json|xml|log)$/i.test(name)) {
      return 'fa-file-alt';
    } else if (/\.(pdf)$/i.test(name)) {
      return 'fa-file-pdf';
    } else if (/\.(doc|docx)$/i.test(name)) {
      return 'fa-file-word';
    } else if (/\.(xls|xlsx)$/i.test(name)) {
      return 'fa-file-excel';
    } else if (/\.(ppt|pptx)$/i.test(name)) {
      return 'fa-file-powerpoint';
    } else if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) {
      return 'fa-file-archive';
    } else if (/\.(js|py|java|c|cpp|h|cs|php|html|css)$/i.test(name)) {
      return 'fa-file-code';
    }
    
    // Default icon
    return 'fa-file';
  },
  
  /**
   * Show a modal
   */
  showModal(modalId) {
    UIManager.closeAllModals();
    document.getElementById(modalId).style.display = 'flex';
  },
  
  /**
   * Hide a modal
   */
  hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
  },
  
  /**
   * Show error modal with message
   */
  showError(message) {
    document.getElementById('error-message').textContent = message;
    this.showModal('error-modal');
  },
  
  /**
   * Log with timestamp
   */
  log(message, ...args) {
    const timestamp = new Date().toISOString().substring(11, 19);
    console.log(`[${timestamp}] ${message}`, ...args);
  }
};

/**
 * Server connection manager
 */
class ServerConnection {
  constructor() {
    this.socket = null;
    this.id = null;
    this.displayName = null;
    this.deviceType = Utils.detectDeviceType();
    this.connected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    
    // Connect to server
    this.connect();
    
    // Setup auto-reconnect
    EventBus.on('window-focus', () => {
      if (!this.connected && !this.reconnectTimer) {
        this.reconnect();
      }
    });
  }
  
  /**
   * Connect to WebSocket server
   */
  connect() {
    Utils.log('Connecting to server...');
    
    // Update UI
    this.updateConnectionStatus('connecting');
    
    // Create WebSocket connection
    const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const endpoint = protocol + location.host;
    this.socket = new WebSocket(endpoint);
    
    // Setup event handlers
    this.socket.onopen = () => this.handleOpen();
    this.socket.onmessage = (event) => this.handleMessage(event);
    this.socket.onerror = (error) => this.handleError(error);
    this.socket.onclose = () => this.handleClose();
  }
  
  /**
   * Handle WebSocket open event
   */
  handleOpen() {
    Utils.log('Connected to server');
    this.connected = true;
    this.reconnectAttempts = 0;
    
    // Update UI
    this.updateConnectionStatus('online');
    
    // Hide reconnect modal if shown
    if (document.getElementById('server-disconnected-modal').style.display === 'flex') {
      Utils.hideModal('server-disconnected-modal');
    }
    
    // Introduce ourselves
    this.send({
      type: 'introduce',
      name: { deviceType: this.deviceType }
    });
    
    // Notify system about connection
    EventBus.emit('server-connected');
  }
  
  /**
   * Handle WebSocket message event
   */
  handleMessage(event) {
    let message;
    
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      Utils.log('Failed to parse message:', error);
      return;
    }
    
    // Handle different message types
    switch (message.type) {
      case 'display-name':
        this.id = message.message.peerId;
        this.displayName = message.message.displayName;
        
        // Update UI
        const deviceNameElem = document.getElementById('device-name');
        if (deviceNameElem) {
          deviceNameElem.textContent = this.displayName;
        }
        break;
        
      case 'peers':
        EventBus.emit('peers-list', message.peers);
        break;
        
      case 'peer-joined':
        EventBus.emit('peer-joined', message.peer);
        break;
        
      case 'peer-left':
        EventBus.emit('peer-left', message.peerId);
        break;
        
      case 'peer-updated':
        EventBus.emit('peer-updated', message.peer);
        break;
        
      case 'signal':
      case 'transfer-request':
      case 'transfer-accept':
      case 'transfer-decline':
      case 'transfer-cancel':
      case 'send-message':
      case 'transfer-complete':
      case 'transfer-error':
        // Forward these events
        EventBus.emit(message.type, message);
        break;
        
      case 'ping':
        this.send({ type: 'pong' });
        break;
        
      default:
        Utils.log('Unknown message type:', message.type);
    }
  }
  
  /**
   * Handle WebSocket error event
   */
  handleError(error) {
    Utils.log('WebSocket error:', error);
    this.updateConnectionStatus('offline');
  }
  
  /**
   * Handle WebSocket close event
   */
  handleClose() {
    Utils.log('Disconnected from server');
    this.connected = false;
    
    // Update UI
    this.updateConnectionStatus('offline');
    
    // Show disconnection modal
    document.getElementById('reconnect-attempt').textContent = 
      `Reconnect attempt: ${this.reconnectAttempts + 1}`;
    Utils.showModal('server-disconnected-modal');
    
    // Try to reconnect
    this.reconnect();
    
    // Notify system about disconnection
    EventBus.emit('server-disconnected');
  }
  
  /**
   * Try to reconnect to the server
   */
  reconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    if (this.reconnectAttempts >= CONFIG.maxReconnectAttempts) {
      Utils.log('Max reconnect attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    document.getElementById('reconnect-attempt').textContent = 
      `Reconnect attempt: ${this.reconnectAttempts}`;
    
    Utils.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, CONFIG.wsReconnectDelay);
  }
  
  /**
   * Update connection status in UI
   */
  updateConnectionStatus(status) {
    const indicator = document.getElementById('connection-indicator');
    const text = document.getElementById('connection-text');
    
    if (!indicator || !text) return;
    
    // Remove all status classes
    indicator.classList.remove('connection-online', 'connection-connecting', 'connection-offline');
    
    // Add appropriate class and text
    switch (status) {
      case 'online':
        indicator.classList.add('connection-online');
        text.textContent = 'Connected';
        break;
      case 'connecting':
        indicator.classList.add('connection-connecting');
        text.textContent = 'Connecting...';
        break;
      case 'offline':
        indicator.classList.add('connection-offline');
        text.textContent = 'Disconnected';
        break;
    }
  }
  
  /**
   * Send a message to the server
   */
  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
      return true;
    }
    return false;
  }
}

/**
 * WebRTC connection wrapper
 */
class RTCPeerConnection {
  constructor(peerId, isCaller = false) {
    this.peerId = peerId;
    this.isCaller = isCaller;
    this.connection = null;
    this.dataChannel = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.retryCount = 0;
    this.maxRetries = 3;
    
    // Setup connection
    this.initialize();
  }
  
  /**
   * Initialize WebRTC connection
   */
  initialize() {
    Utils.log(`Initializing WebRTC connection ${this.isCaller ? 'as caller' : 'as receiver'}`);
    
    // Create RTCPeerConnection
    this.connection = new RTCPeerConnection({
      iceServers: CONFIG.iceServers
    });
    
    // Set up event handlers
    this.connection.onicecandidate = (event) => {
      if (event.candidate) {
        EventBus.emit('ice-candidate', {
          to: this.peerId,
          ice: event.candidate
        });
      }
    };
    
    this.connection.onconnectionstatechange = () => {
      Utils.log(`WebRTC connection state: ${this.connection.connectionState}`);
      
      switch (this.connection.connectionState) {
        case 'connected':
          this.isConnected = true;
          this.isConnecting = false;
          EventBus.emit('webrtc-connected', this.peerId);
          break;
          
        case 'disconnected':
        case 'failed':
          this.isConnected = false;
          EventBus.emit('webrtc-disconnected', this.peerId);
          
          // Only show peer lost modal if we were previously connected
          if (this.isConnected) {
            Utils.showModal('peer-lost-modal');
          }
          break;
          
        case 'closed':
          this.isConnected = false;
          EventBus.emit('webrtc-closed', this.peerId);
          break;
      }
    };
    
    this.connection.onicegatheringstatechange = () => {
      Utils.log(`ICE gathering state: ${this.connection.iceGatheringState}`);
    };
    
    this.connection.oniceconnectionstatechange = () => {
      Utils.log(`ICE connection state: ${this.connection.iceConnectionState}`);
      
      if (this.connection.iceConnectionState === 'failed' && this.retryCount < this.maxRetries) {
        Utils.log('ICE connection failed, retrying...');
        this.retryCount++;
        this.restartIce();
      }
    };
    
    // If we're the caller, create the data channel
    if (this.isCaller) {
      this.dataChannel = this.connection.createDataChannel('drpl');
      this.setupDataChannel();
      
      // Create offer
      this.createOffer();
    } else {
      // If we're the receiver, wait for the data channel
      this.connection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
    }
  }
  
  /**
   * Setup data channel event handlers
   */
  setupDataChannel() {
    this.dataChannel.binaryType = 'arraybuffer';
    
    this.dataChannel.onopen = () => {
      Utils.log(`Data channel open with ${this.peerId}`);
      EventBus.emit('data-channel-open', this.peerId);
    };
    
    this.dataChannel.onclose = () => {
      Utils.log(`Data channel closed with ${this.peerId}`);
      EventBus.emit('data-channel-close', this.peerId);
    };
    
    this.dataChannel.onerror = (error) => {
      Utils.log(`Data channel error with ${this.peerId}:`, error);
      EventBus.emit('data-channel-error', { peerId: this.peerId, error });
    };
    
    this.dataChannel.onmessage = (event) => {
      EventBus.emit('data-channel-message', { 
        peerId: this.peerId, 
        data: event.data 
      });
    };
  }
  
  /**
   * Create an offer as the caller
   */
  async createOffer() {
    if (!this.isCaller) return;
    
    try {
      this.isConnecting = true;
      const offer = await this.connection.createOffer();
      await this.connection.setLocalDescription(offer);
      
      EventBus.emit('sdp-offer', {
        to: this.peerId,
        sdp: this.connection.localDescription
      });
    } catch (error) {
      Utils.log('Error creating offer:', error);
      this.isConnecting = false;
    }
  }
  
  /**
   * Handle incoming SDP
   */
  async handleSDP(sdp) {
    try {
      const desc = new RTCSessionDescription(sdp);
      
      await this.connection.setRemoteDescription(desc);
      
      // If this is an offer, create an answer
      if (desc.type === 'offer') {
        const answer = await this.connection.createAnswer();
        await this.connection.setLocalDescription(answer);
        
        EventBus.emit('sdp-answer', {
          to: this.peerId,
          sdp: this.connection.localDescription
        });
      }
    } catch (error) {
      Utils.log('Error handling SDP:', error);
    }
  }
  
  /**
   * Handle incoming ICE candidate
   */
  async handleICECandidate(candidate) {
    try {
      await this.connection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      Utils.log('Error adding ICE candidate:', error);
    }
  }
  
  /**
   * Restart ICE negotiation
   */
  async restartIce() {
    if (!this.isCaller) return;
    
    try {
      Utils.log('Restarting ICE negotiation');
      const offer = await this.connection.createOffer({ iceRestart: true });
      await this.connection.setLocalDescription(offer);
      
      EventBus.emit('sdp-offer', {
        to: this.peerId,
        sdp: this.connection.localDescription
      });
    } catch (error) {
      Utils.log('Error restarting ICE:', error);
    }
  }
  
  /**
   * Send data over the data channel
   */
  async sendData(data) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return Promise.reject(new Error('Data channel not open'));
    }
    
    // Wait if the buffer is too large
    while (this.dataChannel.bufferedAmount > CONFIG.bufferThreshold) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    try {
      this.dataChannel.send(data);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
  
  /**
   * Close the connection
   */
  close() {
    if (this.dataChannel) {
      this.dataChannel.close();
    }
    
    if (this.connection) {
      this.connection.close();
    }
    
    this.isConnected = false;
    this.isConnecting = false;
  }
}

/**
 * Peer Manager
 */
class PeerManager {
  constructor() {
    this.peers = new Map();
    
    // Set up event listeners
    EventBus.on('peers-list', (peers) => this.handlePeersList(peers));
    EventBus.on('peer-joined', (peer) => this.handlePeerJoined(peer));
    EventBus.on('peer-left', (peerId) => this.handlePeerLeft(peerId));
    EventBus.on('peer-updated', (peer) => this.handlePeerUpdated(peer));
    
    // WebRTC signaling
    EventBus.on('signal', (message) => this.handleSignal(message));
    EventBus.on('ice-candidate', (data) => this.sendSignal(data));
    EventBus.on('sdp-offer', (data) => this.sendSignal(data));
    EventBus.on('sdp-answer', (data) => this.sendSignal(data));
    
    // Transfer requests
    EventBus.on('transfer-request', (message) => this.handleTransferRequest(message));
    EventBus.on('transfer-accept', (message) => this.handleTransferAccept(message));
    EventBus.on('transfer-decline', (message) => this.handleTransferDecline(message));
    EventBus.on('transfer-cancel', (message) => this.handleTransferCancel(message));
    EventBus.on('send-message', (message) => this.handleSendMessage(message));
  }
  
  /**
   * Handle list of peers
   */
  handlePeersList(peers) {
    // Clear existing peers
    this.peers.clear();
    
    // Add new peers
    peers.forEach(peer => {
      this.peers.set(peer.id, {
        info: peer,
        rtc: null,
        autoAccept: false
      });
    });
    
    this.updateUI();
  }
  
  /**
   * Handle peer joined event
   */
  handlePeerJoined(peer) {
    this.peers.set(peer.id, {
      info: peer,
      rtc: null,
      autoAccept: false
    });
    
    this.updateUI();
  }
  
  /**
   * Handle peer left event
   */
  handlePeerLeft(peerId) {
    const peer = this.peers.get(peerId);
    
    if (peer && peer.rtc) {
      peer.rtc.close();
    }
    
    this.peers.delete(peerId);
    this.updateUI();
  }
  
  /**
   * Handle peer updated event
   */
  handlePeerUpdated(peer) {
    if (this.peers.has(peer.id)) {
      const existingPeer = this.peers.get(peer.id);
      this.peers.set(peer.id, {
        ...existingPeer,
        info: peer
      });
    } else {
      this.peers.set(peer.id, {
        info: peer,
        rtc: null,
        autoAccept: false
      });
    }
    
    this.updateUI();
  }
  
  /**
   * Send signal to server
   */
  sendSignal(data) {
    const { to, ...content } = data;
    
    EventBus.emit('send-to-server', {
      type: 'signal',
      to,
      ...content
    });
  }
  
  /**
   * Handle signal from server
   */
  handleSignal(message) {
    const { sender, sdp, ice } = message;
    
    // Get or create peer
    const peer = this.getOrCreatePeer(sender);
    
    // Create RTCPeerConnection if it doesn't exist
    if (!peer.rtc) {
      peer.rtc = new RTCPeerConnection(sender);
    }
    
    // Handle SDP or ICE candidates
    if (sdp) {
      peer.rtc.handleSDP(sdp);
    } else if (ice) {
      peer.rtc.handleICECandidate(ice);
    }
  }
  
  /**
   * Handle transfer request
   */
  handleTransferRequest(message) {
    const { sender, mode } = message;
    const peer = this.getOrCreatePeer(sender);
    const peerName = peer.info.name?.displayName || 'Unknown Device';
    
    // Check if auto-accept is enabled for this peer
    if (peer.autoAccept) {
      Utils.log(`Auto-accepting ${mode} transfer from ${peerName}`);
      
      EventBus.emit('send-to-server', {
        type: 'transfer-accept',
        to: sender,
        mode
      });
      
      // Show receiving status modal
      document.getElementById('receiving-status-text').textContent = 
        `Waiting for ${peerName} to send ${mode === 'files' ? 'files' : 'a message'}...`;
      Utils.showModal('receiving-status-modal');
      
      return;
    }
    
    // Show transfer request modal
    Utils.log(`Transfer request from ${peerName} (${mode})`);
    
    const requestText = document.getElementById('incoming-request-text');
    requestText.textContent = `${peerName} wants to send ${mode === 'files' ? 'files' : 'a message'}.`;
    
    // Get buttons
    const acceptBtn = document.getElementById('incoming-accept-button');
    const declineBtn = document.getElementById('incoming-decline-button');
    const autoAcceptCheck = document.getElementById('always-accept-checkbox');
    
    // Reset checkbox
    autoAcceptCheck.checked = false;
    
    // Set up button handlers
    const handleAccept = () => {
      Utils.log(`Accepted ${mode} transfer from ${peerName}`);
      
      // Set auto-accept if checked
      if (autoAcceptCheck.checked) {
        peer.autoAccept = true;
      }
      
      // Hide modal
      Utils.hideModal('incoming-request-modal');
      
      // Show receiving status modal
      document.getElementById('receiving-status-text').textContent = 
        `Waiting for ${peerName} to send ${mode === 'files' ? 'files' : 'a message'}...`;
      Utils.showModal('receiving-status-modal');
      
      // Send accept message
      EventBus.emit('send-to-server', {
        type: 'transfer-accept',
        to: sender,
        mode
      });
    };
    
    const handleDecline = () => {
      Utils.log(`Declined ${mode} transfer from ${peerName}`);
      
      // Hide modal
      Utils.hideModal('incoming-request-modal');
      
      // Send decline message
      EventBus.emit('send-to-server', {
        type: 'transfer-decline',
        to: sender
      });
    };
    
    // Remove existing event listeners
    const newAcceptBtn = acceptBtn.cloneNode(true);
    const newDeclineBtn = declineBtn.cloneNode(true);
    
    acceptBtn.parentNode.replaceChild(newAcceptBtn, acceptBtn);
    declineBtn.parentNode.replaceChild(newDeclineBtn, declineBtn);
    
    // Add new event listeners
    newAcceptBtn.addEventListener('click', handleAccept);
    newDeclineBtn.addEventListener('click', handleDecline);
    
    // Show the modal
    Utils.showModal('incoming-request-modal');
  }
  
  /**
   * Handle transfer accept
   */
  handleTransferAccept(message) {
    const { sender, mode } = message;
    const peer = this.getOrCreatePeer(sender);
    
    Utils.log(`Transfer accepted by ${peer.info.name?.displayName || 'Unknown'} (${mode})`);
    
    // Hide waiting response modal
    Utils.hideModal('waiting-response-modal');
    
    // Initialize WebRTC connection if needed
    if (!peer.rtc) {
      peer.rtc = new RTCPeerConnection(sender, true);
    }
    
    // Show the appropriate modal based on mode
    if (mode === 'files') {
      Utils.showModal('send-files-modal');
    } else if (mode === 'message') {
      Utils.showModal('send-message-modal');
    }
    
    // Store the current recipient
    window.currentRecipientId = sender;
  }
  
  /**
   * Handle transfer decline
   */
  handleTransferDecline(message) {
    const { sender } = message;
    const peer = this.peers.get(sender);
    const peerName = peer?.info.name?.displayName || 'Unknown';
    
    Utils.log(`Transfer declined by ${peerName}`);
    
    // Hide waiting response modal
    Utils.hideModal('waiting-response-modal');
    
    // Show error message
    Utils.showError(`${peerName} declined your transfer request.`);
  }
  
  /**
   * Handle transfer cancel
   */
  handleTransferCancel(message) {
    const { sender } = message;
    const peer = this.peers.get(sender);
    const peerName = peer?.info.name?.displayName || 'Unknown';
    
    Utils.log(`Transfer cancelled by ${peerName}`);
    
    // Hide all transfer-related modals
    UIManager.closeAllModals();
    
    // Show error message
    Utils.showError(`${peerName} cancelled the transfer.`);
  }
  
  /**
   * Handle send message
   */
  handleSendMessage(message) {
    Utils.log('Send message event (not used directly):', message);
  }
  
  /**
   * Get or create a peer object
   */
  getOrCreatePeer(peerId) {
    if (!this.peers.has(peerId)) {
      this.peers.set(peerId, {
        info: { id: peerId, name: { displayName: 'Unknown Device' } },
        rtc: null,
        autoAccept: false
      });
    }
    
    return this.peers.get(peerId);
  }
  
  /**
   * Get a WebRTC connection to a peer
   */
  getConnection(peerId, createIfMissing = false, asCaller = false) {
    const peer = this.getOrCreatePeer(peerId);
    
    if (!peer.rtc && createIfMissing) {
      peer.rtc = new RTCPeerConnection(peerId, asCaller);
    }
    
    return peer.rtc;
  }
  
  /**
   * Update the peer list UI
   */
  updateUI() {
    const peerListElement = document.getElementById('peer-list');
    const noPeersMessage = document.getElementById('no-peers-message');
    
    // Convert peers map to array
    const peersArray = Array.from(this.peers.values());
    
    if (peersArray.length === 0) {
      noPeersMessage.style.display = 'block';
      peerListElement.innerHTML = '';
      return;
    }
    
    noPeersMessage.style.display = 'none';
    peerListElement.innerHTML = '';
    
    // Create UI elements for each peer
    peersArray.forEach(peer => {
      const button = document.createElement('button');
      button.className = 
        'peer-button w-full py-[15px] text-xl bg-[#333533] text-white rounded-lg hover:bg-[#242423] transition-colors';
      
      const icon = document.createElement('i');
      icon.className = 'fas fa-desktop peer-device-icon text-white';
      
      // Choose icon based on device type
      if (peer.info.name && peer.info.name.type) {
        if (peer.info.name.type === 'mobile') {
          icon.className = 'fas fa-mobile-alt peer-device-icon text-white';
        } else if (peer.info.name.type === 'tablet') {
          icon.className = 'fas fa-tablet-alt peer-device-icon text-white';
        }
      }
      
      const text = document.createElement('span');
      text.textContent = peer.info.name?.displayName || 'Unknown Device';
      
      button.appendChild(icon);
      button.appendChild(text);
      
      button.addEventListener('click', () => {
        window.currentRecipientId = peer.info.id;
        document.getElementById('choose-action-device-name').textContent = 
          'Send to ' + (peer.info.name?.displayName || 'Unknown Device');
        Utils.showModal('choose-action-modal');
      });
      
      peerListElement.appendChild(button);
    });
  }
}

/**
 * File Transfer Manager
 */
class FileTransferManager {
  constructor() {
    // File transfer state
    this.selectedFiles = [];
    this.receivedFiles = [];
    this.currentTransfer = null;
    
    // Performance monitoring
    this.transferSpeed = 0;
    this.speedSamples = [];
    this.lastTransferredBytes = 0;
    this.transferStartTime = 0;
    this.adaptiveChunkSize = CONFIG.initialChunkSize;
    
    // UI update timer
    this.uiUpdateTimer = null;
    
    // For receiving files
    this.incomingFileBuffer = null;
    this.incomingFileMeta = null;
    this.incomingFileWritableStream = null;
    
    // Set up event listeners
    this.setupEventListeners();
  }
  
  /**
   * Set up event listeners
   */
  setupEventListeners() {
    // Data channel events
    EventBus.on('data-channel-message', (data) => this.handleDataChannelMessage(data));
    
    // Setup UI elements
    this.setupFileSendUI();
    this.setupFileReceiveUI();
    this.setupFilePreviewUI();
  }
  
  /**
   * Setup file sending UI elements
   */
  setupFileSendUI() {
    // Get UI elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const selectedFilesContainer = document.getElementById('selected-files-container');
    const startFileTransferBtn = document.getElementById('start-file-transfer');
    
    // Setup drop zone
    dropZone.addEventListener('click', () => fileInput.click());
    
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drop-zone-active');
    });
    
    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drop-zone-active');
    });
    
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drop-zone-active');
      
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        this.handleSelectedFiles(e.dataTransfer.files);
      }
    });
    
    // Setup file input
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length) {
        this.handleSelectedFiles(e.target.files);
      }
    });
    
    // Send files button
    startFileTransferBtn.addEventListener('click', () => this.startFileTransfer());
    
    // Cancel button
    document.getElementById('send-files-cancel').addEventListener('click', () => {
      this.cancelFileTransfer();
    });
    
    // Sending cancel button
    document.getElementById('sending-cancel-button').addEventListener('click', () => {
      this.cancelFileTransfer();
    });
  }
  
  /**
   * Setup file receiving UI elements
   */
  setupFileReceiveUI() {
    // Cancel button
    document.getElementById('receiving-cancel-button').addEventListener('click', () => {
      this.cancelFileReceiving();
    });
  }
  
  /**
   * Setup file preview UI elements
   */
  setupFilePreviewUI() {
    // Buttons
    document.getElementById('prev-file-btn').addEventListener('click', () => {
      this.showPreviousFile();
    });
    
    document.getElementById('next-file-btn').addEventListener('click', () => {
      this.showNextFile();
    });
    
    document.getElementById('download-current-file').addEventListener('click', () => {
      this.downloadCurrentFile();
    });
    
    document.getElementById('download-all-files').addEventListener('click', () => {
      this.downloadAllFiles();
    });
  }
  
  /**
   * Handle files selected by the user
   */
  handleSelectedFiles(fileList) {
    // Add files to the list
    for (const file of fileList) {
      // Check if file already exists in the list
      const exists = this.selectedFiles.some(f => 
        f.name === file.name && 
        f.size === file.size && 
        f.lastModified === file.lastModified
      );
      
      if (!exists) {
        this.selectedFiles.push(file);
      }
    }
    
    // Update UI
    this.renderSelectedFiles();
  }
  
  /**
   * Render selected files in the UI
   */
  renderSelectedFiles() {
    const container = document.getElementById('selected-files-container');
    const startButton = document.getElementById('start-file-transfer');
    
    // Clear container
    container.innerHTML = '';
    
    // Check if there are files
    if (this.selectedFiles.length === 0) {
      startButton.disabled = true;
      return;
    }
    
    // Enable start button
    startButton.disabled = false;
    
    // Add file items
    this.selectedFiles.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'selected-file-item';
      
      // Icon
      const icon = document.createElement('i');
      icon.className = `fas ${Utils.getFileIcon(file)} mr-2`;
      
      // Filename and size
      const nameSpan = document.createElement('span');
      nameSpan.className = 'selected-file-name';
      nameSpan.textContent = file.name;
      
      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'selected-file-size';
      sizeSpan.textContent = Utils.formatBytes(file.size);
      
      // Remove button
      const removeBtn = document.createElement('i');
      removeBtn.className = 'fas fa-times selected-file-remove';
      removeBtn.addEventListener('click', () => {
        this.selectedFiles.splice(index, 1);
        this.renderSelectedFiles();
      });
      
      // Add elements to item
      const leftContainer = document.createElement('div');
      leftContainer.className = 'flex items-center';
      leftContainer.appendChild(icon);
      leftContainer.appendChild(nameSpan);
      
      const rightContainer = document.createElement('div');
      rightContainer.className = 'flex items-center';
      rightContainer.appendChild(sizeSpan);
      rightContainer.appendChild(removeBtn);
      
      item.appendChild(leftContainer);
      item.appendChild(rightContainer);
      
      container.appendChild(item);
    });
  }
  
  /**
   * Start the file transfer process
   */
  async startFileTransfer() {
    if (!window.currentRecipientId || this.selectedFiles.length === 0) {
      return;
    }
    
    const peerId = window.currentRecipientId;
    
    Utils.log(`Starting file transfer to ${peerId} (${this.selectedFiles.length} files)`);
    
    // Hide send files modal
    Utils.hideModal('send-files-modal');
    
    // Show sending files modal
    Utils.showModal('sending-files-modal');
    
    // Set up transfer state
    this.currentTransfer = {
      peerId,
      files: [...this.selectedFiles],
      currentFileIndex: 0,
      totalBytes: this.selectedFiles.reduce((total, file) => total + file.size, 0),
      sentBytes: 0,
      fileBytesSent: 0,
      startTime: Date.now(),
      fileStartTime: Date.now(),
      status: 'starting'
    };
    
    // Reset speed calculation
    this.transferSpeed = 0;
    this.speedSamples = [];
    this.lastTransferredBytes = 0;
    this.transferStartTime = Date.now();
    this.adaptiveChunkSize = CONFIG.initialChunkSize;
    
    // Start UI updates
    this.startUIUpdates();
    
    try {
      // Get WebRTC connection
      const connection = PeerManager.prototype.getConnection(peerId, true, true);
      
      // Send batch header
      await connection.sendData(JSON.stringify({
        type: 'batch-header',
        total: this.selectedFiles.length,
        totalSize: this.currentTransfer.totalBytes
      }));
      
      // Start sending files
      await this.sendNextFile();
      
    } catch (error) {
      Utils.log('Error starting file transfer:', error);
      this.handleTransferError('Failed to start file transfer: ' + error.message);
    }
  }
  
  /**
   * Send the next file in the transfer queue
   */
  async sendNextFile() {
    if (!this.currentTransfer) return;
    
    const { peerId, files, currentFileIndex } = this.currentTransfer;
    
    // Check if we've sent all files
    if (currentFileIndex >= files.length) {
      this.completeTransfer();
      return;
    }
    
    // Get current file
    const file = files[currentFileIndex];
    
    Utils.log(`Sending file ${currentFileIndex + 1}/${files.length}: ${file.name} (${Utils.formatBytes(file.size)})`);
    
    try {
      // Get WebRTC connection
      const connection = PeerManager.prototype.getConnection(peerId, true, true);
      
      // Send file header
      await connection.sendData(JSON.stringify({
        type: 'header',
        name: file.name,
        size: file.size,
        mime: file.type,
        lastModified: file.lastModified,
        index: currentFileIndex
      }));
      
      // Update transfer state
      this.currentTransfer.status = 'transferring';
      this.currentTransfer.fileBytesSent = 0;
      this.currentTransfer.fileStartTime = Date.now();
      
      // Update UI
      document.getElementById('sending-file-name').textContent = 
        `Sending ${file.name} (${currentFileIndex + 1}/${files.length})`;
      
      // Send file data
      const chunkSize = this.adaptiveChunkSize;
      const fileReader = new FileReader();
      let offset = 0;
      
      const readNextChunk = () => {
        const slice = file.slice(offset, offset + chunkSize);
        fileReader.readAsArrayBuffer(slice);
      };
      
      fileReader.onload = async (e) => {
        try {
          const chunk = e.target.result;
          
          // Send chunk
          await connection.sendData(chunk);
          
          // Update progress
          offset += chunk.byteLength;
          this.currentTransfer.fileBytesSent += chunk.byteLength;
          this.currentTransfer.sentBytes += chunk.byteLength;
          
          // Check if we've sent the entire file
          if (offset >= file.size) {
            // Send done message
            await connection.sendData(JSON.stringify({ type: 'done' }));
            
            // Move to next file
            this.currentTransfer.currentFileIndex++;
            this.currentTransfer.fileBytesSent = 0;
            
            // Send next file
            setTimeout(() => this.sendNextFile(), 100);
          } else {
            // Adapt chunk size based on transfer speed
            this.updateAdaptiveChunkSize();
            
            // Read next chunk
            readNextChunk();
          }
        } catch (error) {
          Utils.log('Error sending chunk:', error);
          this.handleTransferError('Failed to send file: ' + error.message);
        }
      };
      
      fileReader.onerror = (error) => {
        Utils.log('Error reading file:', error);
        this.handleTransferError('Failed to read file: ' + error);
      };
      
      // Start reading
      readNextChunk();
      
    } catch (error) {
      Utils.log('Error sending file:', error);
      this.handleTransferError('Failed to send file: ' + error.message);
    }
  }
  
  /**
   * Update adaptive chunk size based on transfer speed
   */
  updateAdaptiveChunkSize() {
    // Only adjust every 5 chunks
    if (this.speedSamples.length < 5) return;
    
    const avgSpeed = this.transferSpeed;
    
    // Increase chunk size if transfer is fast
    if (avgSpeed > 1024 * 1024 * 10 && this.adaptiveChunkSize < CONFIG.maxChunkSize) {
      this.adaptiveChunkSize = Math.min(this.adaptiveChunkSize * 1.2, CONFIG.maxChunkSize);
    }
    // Decrease chunk size if transfer is slow
    else if (avgSpeed < 1024 * 1024 && this.adaptiveChunkSize > CONFIG.minChunkSize) {
      this.adaptiveChunkSize = Math.max(this.adaptiveChunkSize * 0.8, CONFIG.minChunkSize);
    }
  }
  
  /**
   * Handle data channel message
   */
  handleDataChannelMessage(data) {
    const { peerId, data: messageData } = data;
    
    // If it's a string, try to parse as JSON
    if (typeof messageData === 'string') {
      try {
        const message = JSON.parse(messageData);
        this.handleJsonMessage(peerId, message);
      } catch (error) {
        Utils.log('Error parsing message:', error);
      }
    } 
    // If it's binary data, it's a file chunk
    else {
      this.handleFileChunk(peerId, messageData);
    }
  }
  
  /**
   * Handle JSON messages
   */
  handleJsonMessage(peerId, message) {
    switch (message.type) {
      case 'batch-header':
        this.handleBatchHeader(peerId, message);
        break;
        
      case 'header':
        this.handleFileHeader(peerId, message);
        break;
        
      case 'done':
        this.handleFileDone(peerId);
        break;
        
      case 'text':
        this.handleTextMessage(peerId, message);
        break;
        
      default:
        Utils.log('Unknown message type:', message.type);
    }
  }
  
  /**
   * Handle batch header message
   */
  handleBatchHeader(peerId, message) {
    const { total, totalSize } = message;
    
    Utils.log(`Receiving ${total} files (${Utils.formatBytes(totalSize)})`);
    
    // Hide receiving status modal
    Utils.hideModal('receiving-status-modal');
    
    // Show receiving files modal
    Utils.showModal('receiving-files-modal');
    
    // Setup receiving state
    this.incomingFileBuffer = null;
    this.incomingFileMeta = null;
    this.incomingFileWritableStream = null;
    
    // Reset received files
    this.receivedFiles = [];
    
    // Setup transfer state
    this.currentTransfer = {
      peerId,
      totalFiles: total,
      receivedFiles: 0,
      totalBytes: totalSize || 0,
      receivedBytes: 0,
      fileReceivedBytes: 0,
      startTime: Date.now(),
      fileStartTime: Date.now(),
      status: 'receiving'
    };
    
    // Reset speed calculation
    this.transferSpeed = 0;
    this.speedSamples = [];
    this.lastTransferredBytes = 0;
    this.transferStartTime = Date.now();
    
    // Start UI updates
    this.startUIUpdates();
    
    // Update UI
    document.getElementById('receiving-file-count').textContent = 
      `File 0 of ${total}`;
    document.getElementById('receiving-total-bytes').textContent = 
      Utils.formatBytes(totalSize || 0);
  }
  
  /**
   * Handle file header message
   */
  async handleFileHeader(peerId, message) {
    const { name, size, mime, index } = message;
    
    Utils.log(`Receiving file: ${name} (${Utils.formatBytes(size)})`);
    
    // Create file buffer or writable stream depending on file size
    if (size > 50 * 1024 * 1024) {
      // For large files (>50MB), use StreamSaver.js
      try {
        const fileStream = streamSaver.createWriteStream(name, { 
          size, 
          type: mime || 'application/octet-stream' 
        });
        
        this.incomingFileBuffer = null;
        this.incomingFileWritableStream = fileStream.getWriter();
      } catch (error) {
        Utils.log('Error creating write stream:', error);
        // Fall back to in-memory buffer
        this.incomingFileBuffer = [];
        this.incomingFileWritableStream = null;
      }
    } else {
      // For smaller files, use in-memory buffer
      this.incomingFileBuffer = [];
      this.incomingFileWritableStream = null;
    }
    
    // Set current file metadata
    this.incomingFileMeta = {
      name,
      size,
      mime: mime || 'application/octet-stream',
      index: index || this.currentTransfer.receivedFiles,
      receivedBytes: 0
    };
    
    // Update transfer state
    this.currentTransfer.fileReceivedBytes = 0;
    this.currentTransfer.fileStartTime = Date.now();
    
    // Update UI
    document.getElementById('receiving-file-name').textContent = 
      `Receiving ${name} (${this.currentTransfer.receivedFiles + 1}/${this.currentTransfer.totalFiles})`;
  }
  
  /**
   * Handle file chunk
   */
  async handleFileChunk(peerId, chunk) {
    if (!this.incomingFileMeta) return;
    
    // Update received bytes
    const byteLength = chunk.byteLength;
    this.incomingFileMeta.receivedBytes += byteLength;
    this.currentTransfer.fileReceivedBytes += byteLength;
    this.currentTransfer.receivedBytes += byteLength;
    
    // Store the chunk
    if (this.incomingFileWritableStream) {
      // Store to file stream
      try {
        await this.incomingFileWritableStream.write(new Uint8Array(chunk));
      } catch (error) {
        Utils.log('Error writing to stream:', error);
        this.handleTransferError('Failed to write file chunk: ' + error.message);
      }
    } else {
      // Store in memory
      this.incomingFileBuffer.push(chunk);
    }
  }
  
  /**
   * Handle file done message
   */
  async handleFileDone(peerId) {
    if (!this.incomingFileMeta) return;
    
    const { name, size, mime, receivedBytes } = this.incomingFileMeta;
    
    Utils.log(`File received: ${name} (${Utils.formatBytes(receivedBytes)}/${Utils.formatBytes(size)})`);
    
    // Create blob if using in-memory buffer
    let blob = null;
    
    if (this.incomingFileWritableStream) {
      try {
        // Close the write stream
        await this.incomingFileWritableStream.close();
        this.incomingFileWritableStream = null;
        
        // For streamed files, we don't have the blob in memory
        blob = null;
      } catch (error) {
        Utils.log('Error closing write stream:', error);
      }
    } else {
      // Create blob from chunks
      blob = new Blob(this.incomingFileBuffer, { type: mime });
    }
    
    // Add to received files
    this.receivedFiles.push({
      name,
      size,
      mime,
      blob,
      url: blob ? URL.createObjectURL(blob) : null
    });
    
    // Update transfer state
    this.currentTransfer.receivedFiles++;
    
    // Reset current file
    this.incomingFileBuffer = null;
    this.incomingFileMeta = null;
    
    // Send transfer complete when all files are received
    if (this.currentTransfer.receivedFiles >= this.currentTransfer.totalFiles) {
      this.completeReceiving();
    }
    
    // Notify sender of successful file receipt
    EventBus.emit('send-to-server', {
      type: 'transfer-complete',
      to: peerId
    });
  }
  
  /**
   * Handle text message
   */
  handleTextMessage(peerId, message) {
    const peer = PeerManager.prototype.getOrCreatePeer(peerId);
    const peerName = peer.info.name?.displayName || 'Unknown Device';
    
    // Decode text
    const decodedText = decodeURIComponent(escape(atob(message.text)));
    
    Utils.log(`Received text message from ${peerName}`);
    
    // Hide receiving status modal
    Utils.hideModal('receiving-status-modal');
    
    // Show incoming message modal
    document.getElementById('incoming-message-header').textContent = 
      `Message from ${peerName}`;
    document.getElementById('incoming-message-text').textContent = decodedText;
    Utils.showModal('incoming-message-modal');
    
    // Store the sender ID for responding
    window.currentRecipientId = peerId;
    
    // Send transfer complete
    EventBus.emit('send-to-server', {
      type: 'transfer-complete',
      to: peerId
    });
  }
  
  /**
   * Send text message
   */
  async sendTextMessage(text, peerId) {
    if (!text || !peerId) return;
    
    Utils.log(`Sending text message to ${peerId}`);
    
    try {
      // Get WebRTC connection
      const connection = PeerManager.prototype.getConnection(peerId, true, true);
      
      // Encode text
      const encodedText = btoa(unescape(encodeURIComponent(text)));
      
      // Send message
      await connection.sendData(JSON.stringify({
        type: 'text',
        text: encodedText
      }));
      
      return true;
    } catch (error) {
      Utils.log('Error sending text message:', error);
      return false;
    }
  }
  
  /**
   * Complete the file transfer process
   */
  completeTransfer() {
    Utils.log('File transfer completed');
    
    // Stop UI updates
    this.stopUIUpdates();
    
    // Hide sending modal
    Utils.hideModal('sending-files-modal');
    
    // Show transfer complete modal
    document.getElementById('transfer-complete-title').textContent = 'Transfer Complete';
    document.getElementById('transfer-complete-text').textContent = 
      `Successfully sent ${this.currentTransfer.files.length} file(s).`;
    Utils.showModal('transfer-complete-modal');
    
    // Reset transfer state
    this.currentTransfer = null;
    this.selectedFiles = [];
    
    // Update send files UI
    this.renderSelectedFiles();
  }
  
  /**
   * Complete the file receiving process
   */
  completeReceiving() {
    Utils.log('File receiving completed');
    
    // Stop UI updates
    this.stopUIUpdates();
    
    // Hide receiving modal
    Utils.hideModal('receiving-files-modal');
    
    // Show file preview modal
    this.renderFilePreview();
    Utils.showModal('file-preview-modal');
    
    // Reset transfer state
    this.currentTransfer = null;
  }
  
  /**
   * Handle transfer error
   */
  handleTransferError(errorMessage) {
    Utils.log('Transfer error:', errorMessage);
    
    // Stop UI updates
    this.stopUIUpdates();
    
    // Hide all transfer modals
    UIManager.closeAllModals();
    
    // Show error modal
    Utils.showError(errorMessage);
    
    // Reset transfer state
    this.currentTransfer = null;
    
    // If this was a receive error, reset incoming file state
    this.incomingFileBuffer = null;
    this.incomingFileMeta = null;
    if (this.incomingFileWritableStream) {
      this.incomingFileWritableStream.abort();
      this.incomingFileWritableStream = null;
    }
  }
  
  /**
   * Cancel file transfer (sender side)
   */
  cancelFileTransfer() {
    if (!this.currentTransfer) return;
    
    Utils.log('Cancelling file transfer');
    
    // Send cancel message
    EventBus.emit('send-to-server', {
      type: 'transfer-cancel',
      to: this.currentTransfer.peerId
    });
    
    // Stop UI updates
    this.stopUIUpdates();
    
    // Hide send files and sending files modals
    Utils.hideModal('send-files-modal');
    Utils.hideModal('sending-files-modal');
    
    // Reset transfer state
    this.currentTransfer = null;
  }
  
  /**
   * Cancel file receiving (receiver side)
   */
  cancelFileReceiving() {
    if (!this.currentTransfer) return;
    
    Utils.log('Cancelling file receiving');
    
    // Send cancel message
    EventBus.emit('send-to-server', {
      type: 'transfer-cancel',
      to: this.currentTransfer.peerId
    });
    
    // Stop UI updates
    this.stopUIUpdates();
    
    // Hide receiving files modal
    Utils.hideModal('receiving-files-modal');
    
    // Reset transfer state
    this.currentTransfer = null;
    
    // Reset incoming file state
    this.incomingFileBuffer = null;
    this.incomingFileMeta = null;
    if (this.incomingFileWritableStream) {
      this.incomingFileWritableStream.abort();
      this.incomingFileWritableStream = null;
    }
  }
  
  /**
   * Start UI updates for transfer
   */
  startUIUpdates() {
    if (this.uiUpdateTimer) {
      clearInterval(this.uiUpdateTimer);
    }
    
    this.uiUpdateTimer = setInterval(() => {
      this.updateTransferUI();
    }, CONFIG.uiUpdateInterval);
  }
  
  /**
   * Stop UI updates
   */
  stopUIUpdates() {
    if (this.uiUpdateTimer) {
      clearInterval(this.uiUpdateTimer);
      this.uiUpdateTimer = null;
    }
  }
  
  /**
   * Update transfer UI
   */
  updateTransferUI() {
    if (!this.currentTransfer) return;
    
    // Calculate transfer speed
    const currentTime = Date.now();
    const elapsedSeconds = (currentTime - this.transferStartTime) / 1000;
    
    // Only update if at least 100ms has passed
    if (elapsedSeconds >= 0.1) {
      let bytesTransferred;
      let totalBytes;
      
      if (this.currentTransfer.status === 'transferring') {
        // Sending
        bytesTransferred = this.currentTransfer.sentBytes;
        totalBytes = this.currentTransfer.totalBytes;
        
        // Calculate bytes per second
        const bytesPerSecond = (bytesTransferred - this.lastTransferredBytes) / elapsedSeconds;
        
        // Add to samples
        this.speedSamples.push(bytesPerSecond);
        if (this.speedSamples.length > CONFIG.speedAverageWindow) {
          this.speedSamples.shift();
        }
        
        // Calculate average speed
        this.transferSpeed = this.speedSamples.reduce((a, b) => a + b, 0) / this.speedSamples.length;
        
        // Update UI
        document.getElementById('sending-speed').textContent = 
          `Speed: ${Utils.formatSpeed(this.transferSpeed)}`;
        
        // Calculate ETA
        const remainingBytes = totalBytes - bytesTransferred;
        const eta = remainingBytes / this.transferSpeed;
        document.getElementById('sending-eta').textContent = 
          `ETA: ${Utils.formatTimeRemaining(eta)}`;
        
        // Update progress
        const progress = (bytesTransferred / totalBytes) * 100;
        document.getElementById('sending-progress-bar').style.width = `${progress}%`;
        
        // Update bytes counter
        document.getElementById('sending-bytes').textContent = 
          Utils.formatBytes(bytesTransferred);
        document.getElementById('sending-total-bytes').textContent = 
          Utils.formatBytes(totalBytes);
        
        // Reset for next calculation
        this.lastTransferredBytes = bytesTransferred;
        this.transferStartTime = currentTime;
      } else if (this.currentTransfer.status === 'receiving') {
        // Receiving
        bytesTransferred = this.currentTransfer.receivedBytes;
        totalBytes = this.currentTransfer.totalBytes;
        
        // Calculate bytes per second
        const bytesPerSecond = (bytesTransferred - this.lastTransferredBytes) / elapsedSeconds;
        
        // Add to samples
        this.speedSamples.push(bytesPerSecond);
        if (this.speedSamples.length > CONFIG.speedAverageWindow) {
          this.speedSamples.shift();
        }
        
        // Calculate average speed
        this.transferSpeed = this.speedSamples.reduce((a, b) => a + b, 0) / this.speedSamples.length;
        
        // Update UI
        document.getElementById('receiving-speed').textContent = 
          `Speed: ${Utils.formatSpeed(this.transferSpeed)}`;
        
        // Calculate ETA
        const remainingBytes = totalBytes - bytesTransferred;
        const eta = remainingBytes / this.transferSpeed;
        document.getElementById('receiving-eta').textContent = 
          `ETA: ${Utils.formatTimeRemaining(eta)}`;
        
        // Update overall progress
        const progress = (bytesTransferred / totalBytes) * 100;
        document.getElementById('receiving-overall-progress').style.width = `${progress}%`;
        
        // Update bytes counter
        document.getElementById('receiving-bytes').textContent = 
          Utils.formatBytes(bytesTransferred);
        document.getElementById('receiving-total-bytes').textContent = 
          Utils.formatBytes(totalBytes);
        
        // Update file count
        document.getElementById('receiving-file-count').textContent = 
          `File ${this.currentTransfer.receivedFiles + 1} of ${this.currentTransfer.totalFiles}`;
        
        // Reset for next calculation
        this.lastTransferredBytes = bytesTransferred;
        this.transferStartTime = currentTime;
      }
    }
  }
  
  /**
   * Render file preview
   */
  renderFilePreview(index = 0) {
    if (this.receivedFiles.length === 0) return;
    
    // Ensure index is within bounds
    index = Math.max(0, Math.min(index, this.receivedFiles.length - 1));
    
    // Store current index
    this.currentFileIndex = index;
    
    // Get file
    const file = this.receivedFiles[index];
    
    // Render file list
    this.renderFileList();
    
    // Render preview content
    const previewContent = document.getElementById('file-preview-content');
    previewContent.innerHTML = '';
    
    // Check if it's an image
    if (/^image\//i.test(file.mime) && file.url) {
      // Image preview
      const img = document.createElement('img');
      img.src = file.url;
      img.className = 'max-w-full max-h-[300px] object-contain';
      previewContent.appendChild(img);
    } 
    // Check if it's a video
    else if (/^video\//i.test(file.mime) && file.url) {
      // Video preview
      const video = document.createElement('video');
      video.src = file.url;
      video.className = 'max-w-full max-h-[300px] object-contain';
      video.controls = true;
      previewContent.appendChild(video);
    }
    // Check if it's audio
    else if (/^audio\//i.test(file.mime) && file.url) {
      // Audio preview
      const audio = document.createElement('audio');
      audio.src = file.url;
      audio.className = 'w-full';
      audio.controls = true;
      previewContent.appendChild(audio);
    }
    // Other file types
    else {
      // Generic file icon
      const container = document.createElement('div');
      container.className = 'flex flex-col items-center justify-center';
      
      const icon = document.createElement('i');
      icon.className = `fas ${Utils.getFileIcon(file)} text-6xl mb-4 text-gray-600`;
      
      const nameElem = document.createElement('div');
      nameElem.className = 'text-lg font-medium text-center mb-2';
      nameElem.textContent = file.name;
      
      const sizeElem = document.createElement('div');
      sizeElem.className = 'text-sm text-gray-500';
      sizeElem.textContent = Utils.formatBytes(file.size);
      
      container.appendChild(icon);
      container.appendChild(nameElem);
      container.appendChild(sizeElem);
      
      previewContent.appendChild(container);
    }
    
    // Update navigation buttons
    document.getElementById('prev-file-btn').disabled = index === 0;
    document.getElementById('next-file-btn').disabled = index === this.receivedFiles.length - 1;
  }
  
  /**
   * Render file list
   */
  renderFileList() {
    const fileListContainer = document.getElementById('file-list-preview');
    fileListContainer.innerHTML = '';
    
    this.receivedFiles.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = `file-preview-item ${index === this.currentFileIndex ? 'active' : ''}`;
      
      // Icon
      const icon = document.createElement('i');
      icon.className = `fas ${Utils.getFileIcon(file)} mr-2`;
      
      // Filename and size
      const nameSpan = document.createElement('span');
      nameSpan.textContent = file.name;
      
      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'text-xs text-gray-500 ml-2';
      sizeSpan.textContent = Utils.formatBytes(file.size);
      
      // Add elements to item
      item.appendChild(icon);
      item.appendChild(nameSpan);
      item.appendChild(sizeSpan);
      
      // Add click handler
      item.addEventListener('click', () => {
        this.renderFilePreview(index);
      });
      
      fileListContainer.appendChild(item);
    });
  }
  
  /**
   * Show previous file
   */
  showPreviousFile() {
    if (this.currentFileIndex > 0) {
      this.renderFilePreview(this.currentFileIndex - 1);
    }
  }
  
  /**
   * Show next file
   */
  showNextFile() {
    if (this.currentFileIndex < this.receivedFiles.length - 1) {
      this.renderFilePreview(this.currentFileIndex + 1);
    }
  }
  
  /**
   * Download current file
   */
  downloadCurrentFile() {
    if (this.receivedFiles.length === 0 || this.currentFileIndex >= this.receivedFiles.length) {
      return;
    }
    
    const file = this.receivedFiles[this.currentFileIndex];
    
    if (file.url) {
      // We have the blob in memory
      const a = document.createElement('a');
      a.href = file.url;
      a.download = file.name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      // Streamed files can't be downloaded again from memory
      Utils.showError('This file was streamed directly to disk and cannot be downloaded again.');
    }
  }
  
  /**
   * Download all files
   */
  downloadAllFiles() {
    this.receivedFiles.forEach((file, index) => {
      if (file.url) {
        // Wait a bit between downloads
        setTimeout(() => {
          const a = document.createElement('a');
          a.href = file.url;
          a.download = file.name;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }, index * 500);
      }
    });
    
    // Notify about streamed files
    const streamedFiles = this.receivedFiles.filter(f => !f.url);
    if (streamedFiles.length > 0) {
      Utils.showError(`${streamedFiles.length} file(s) were streamed directly to disk and cannot be downloaded again.`);
    }
  }
}

/**
 * UI Manager
 */
const UIManager = {
  /**
   * Initialize UI
   */
  init() {
    // Set up modal closers
    this.setupModals();
    
    // Set up info and author modals
    this.setupInfoAuthorModals();
    
    // Set up action selection
    this.setupActionSelection();
    
    // Set up message send/receive UI
    this.setupMessageUI();
    
    // Set up window focus detection
    window.addEventListener('focus', () => {
      EventBus.emit('window-focus');
    });
    
    // Close errors
    document.getElementById('error-modal-close').addEventListener('click', () => {
      Utils.hideModal('error-modal');
    });
    
    // Close peer lost
    document.getElementById('peer-lost-close').addEventListener('click', () => {
      Utils.hideModal('peer-lost-modal');
    });
    
    // Server reconnection
    document.getElementById('server-reconnect-button').addEventListener('click', () => {
      EventBus.emit('reconnect-server');
    });
    
    document.getElementById('server-disconnected-close').addEventListener('click', () => {
      Utils.hideModal('server-disconnected-modal');
    });
    
    // Close transfer complete
    document.getElementById('transfer-complete-close').addEventListener('click', () => {
      Utils.hideModal('transfer-complete-modal');
    });
  },
  
  /**
   * Setup modals
   */
  setupModals() {
    // Modal backdrops
    document.querySelectorAll('[id$="-backdrop"]').forEach(backdrop => {
      backdrop.addEventListener('click', () => {
        // Get the parent modal ID
        const modalId = backdrop.id.replace('-backdrop', '');
        Utils.hideModal(modalId);
      });
    });
  },
  
  /**
   * Setup info and author modals
   */
  setupInfoAuthorModals() {
    // Info modal
    document.getElementById('info-button').addEventListener('click', () => {
      Utils.showModal('info-modal');
    });
    
    document.getElementById('info-modal-close').addEventListener('click', () => {
      Utils.hideModal('info-modal');
    });
    
    // Author modal
    document.getElementById('author-button').addEventListener('click', () => {
      Utils.showModal('author-modal');
    });
    
    document.getElementById('author-modal-close').addEventListener('click', () => {
      Utils.hideModal('author-modal');
    });
  },
  
  /**
   * Setup action selection
   */
  setupActionSelection() {
    // Choose action buttons
    document.getElementById('choose-action-backdrop').addEventListener('click', () => {
      Utils.hideModal('choose-action-modal');
    });
    
    document.getElementById('choose-action-send-files').addEventListener('click', () => {
      if (!window.currentRecipientId) return;
      
      const peerId = window.currentRecipientId;
      const peer = PeerManager.prototype.getOrCreatePeer(peerId);
      const peerName = peer.info.name?.displayName || 'Unknown Device';
      
      // Show waiting response modal
      document.getElementById('waiting-response-text').textContent = 
        `Waiting for ${peerName} to accept...`;
      Utils.showModal('waiting-response-modal');
      
      // Send transfer request
      EventBus.emit('send-to-server', {
        type: 'transfer-request',
        to: peerId,
        mode: 'files'
      });
    });
    
    document.getElementById('choose-action-send-message').addEventListener('click', () => {
      if (!window.currentRecipientId) return;
      
      const peerId = window.currentRecipientId;
      const peer = PeerManager.prototype.getOrCreatePeer(peerId);
      const peerName = peer.info.name?.displayName || 'Unknown Device';
      
      // Show waiting response modal
      document.getElementById('waiting-response-text').textContent = 
        `Waiting for ${peerName} to accept...`;
      Utils.showModal('waiting-response-modal');
      
      // Send transfer request
      EventBus.emit('send-to-server', {
        type: 'transfer-request',
        to: peerId,
        mode: 'message'
      });
    });
    
    // Waiting modal cancel
    document.getElementById('waiting-cancel-button').addEventListener('click', () => {
      if (!window.currentRecipientId) return;
      
      // Send cancel
      EventBus.emit('send-to-server', {
        type: 'transfer-cancel',
        to: window.currentRecipientId
      });
      
      Utils.hideModal('waiting-response-modal');
    });
  },
  
  /**
   * Setup message UI
   */
  setupMessageUI() {
    // Send message modal
    document.getElementById('send-message-backdrop').addEventListener('click', () => {
      this.cancelMessageSending();
    });
    
    document.getElementById('send-message-cancel').addEventListener('click', () => {
      this.cancelMessageSending();
    });
    
    document.getElementById('send-message-button').addEventListener('click', () => {
      this.sendMessage();
    });
    
    // Press Enter to send
    document.getElementById('message-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    
    // Incoming message modal
    document.getElementById('incoming-message-backdrop').addEventListener('click', () => {
      Utils.hideModal('incoming-message-modal');
    });
    
    document.getElementById('incoming-message-close').addEventListener('click', () => {
      Utils.hideModal('incoming-message-modal');
    });
    
    document.getElementById('incoming-message-respond').addEventListener('click', () => {
      Utils.hideModal('incoming-message-modal');
      Utils.showModal('send-message-modal');
    });
  },
  
  /**
   * Send message
   */
  async sendMessage() {
    const messageInput = document.getElementById('message-input');
    const text = messageInput.value.trim();
    
    if (!text || !window.currentRecipientId) return;
    
    // Send message
    const success = await FileTransferManager.prototype.sendTextMessage(text, window.currentRecipientId);
    
    if (success) {
      // Reset input
      messageInput.value = '';
      
      // Hide modal
      Utils.hideModal('send-message-modal');
      
      // Show transfer complete
      document.getElementById('transfer-complete-title').textContent = 'Message Sent';
      document.getElementById('transfer-complete-text').textContent = 'Your message has been delivered.';
      Utils.showModal('transfer-complete-modal');
    } else {
      Utils.showError('Failed to send message. Please try again.');
    }
  },
  
  /**
   * Cancel message sending
   */
  cancelMessageSending() {
    if (!window.currentRecipientId) return;
    
    // Send cancel
    EventBus.emit('send-to-server', {
      type: 'transfer-cancel',
      to: window.currentRecipientId
    });
    
    // Reset input
    document.getElementById('message-input').value = '';
    
    // Hide modal
    Utils.hideModal('send-message-modal');
  },
  
  /**
   * Close all modals
   */
  closeAllModals() {
    document.querySelectorAll('[id$="-modal"]').forEach(modal => {
      modal.style.display = 'none';
    });
  }
};

/**
 * Main Application
 */
class DrplApp {
  constructor() {
    // Initialize components
    this.server = null;
    this.peerManager = null;
    this.fileTransferManager = null;
    
    // Setup global server event proxy
    EventBus.on('send-to-server', (data) => {
      if (this.server) {
        this.server.send(data);
      }
    });
    
    // Setup reconnect event
    EventBus.on('reconnect-server', () => {
      if (this.server) {
        this.server.reconnect();
      }
    });
    
    // Initialize UI
    UIManager.init();
    
    // Initialize connection
    this.init();
  }
  
  /**
   * Initialize application
   */
  init() {
    // Set global currentRecipientId
    window.currentRecipientId = null;
    
    // Create server connection
    this.server = new ServerConnection();
    
    // Create peer manager
    this.peerManager = new PeerManager();
    
    // Create file transfer manager
    this.fileTransferManager = new FileTransferManager();
  }
}

// Start application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new DrplApp();
});