// Utility constants and functions
const CHUNK_SIZE = 64 * 1024; // 64 KB
const PARTITION_SIZE = 1 * 1024 * 1024; // 1 MB

// Randomly generate device name for identification
function generateDeviceName() {
  const adjectives = ['Red', 'Blue', 'Green', 'Golden', 'Silver'];
  const nouns = ['Wolf', 'Eagle', 'Lion', 'Phoenix', 'Dragon'];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
}

// Format file sizes
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function appData() {
  return {
    socket: null,
    peers: [],
    deviceName: generateDeviceName(),
    showFileTransfer: false,
    transferProgress: 0,
    transferStatus: '',
    showProgress: false,
    selectedFiles: [],
    peerConnections: new Map(),
    dataChannels: new Map(),
    fileChunks: new Map(),
    currentFileIndex: 0,
    receivedFiles: [],

    init() {
      this.setupSocket();
      window.addEventListener('beforeunload', this.cleanup.bind(this));
    },

    setupSocket() {
      // Initialize socket connection
      this.socket = io();

      this.socket.on('connect', () => {
        this.socket.emit('register', { deviceName: this.deviceName });
      });

      this.socket.on('registered', ({ peerId }) => {
        this.peerId = peerId;
        this.socket.emit('discover');
      });

      this.socket.on('peers', (peerList) => {
        this.peers = peerList.filter(peer => peer.id !== this.peerId);
      });

      this.socket.on('signal', this.handleSignaling.bind(this));
      this.socket.on('file-request', this.handleIncomingRequest.bind(this));
      this.socket.on('file-response', this.handleFileResponse.bind(this));
    },

    async handleSignaling({ peer, signal }) {
      if (!this.peerConnections.has(peer)) {
        await this.createPeerConnection(peer);
      }
      const pc = this.peerConnections.get(peer);
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socket.emit('signal', { target: peer, signal: pc.localDescription });
      } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
      } else if (signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal));
      }
    },

    async createPeerConnection(peerId) {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.socket.emit('signal', { target: peerId, signal: event.candidate });
        }
      };

      pc.ondatachannel = (event) => {
        const channel = event.channel;
        channel.binaryType = 'arraybuffer';
        channel.onmessage = (event) => this.handleChunkReceived(event.data, peerId);
      };

      this.peerConnections.set(peerId, pc);
      return pc;
    },

    async handleIncomingRequest({ peerId, files }) {
      this.incomingFiles = files;
      this.showIncomingRequest = true;
      this.incomingPeer = peerId;
    },

    async sendFiles(peer) {
      const pc = await this.createPeerConnection(peer.id);
      const channel = pc.createDataChannel('fileTransfer', { ordered: true });
      channel.binaryType = 'arraybuffer';

      channel.onopen = () => {
        this.selectedFiles.forEach(file => this.sendFile(channel, file));
      };

      await pc.setLocalDescription(await pc.createOffer());
      this.socket.emit('signal', { target: peer.id, signal: pc.localDescription });
    },

    async sendFile(channel, file) {
      this.transferStatus = `Sending ${file.name}...`;
      let offset = 0;
      while (offset < file.size) {
        const chunk = file.slice(offset, offset + CHUNK_SIZE);
        const buffer = await chunk.arrayBuffer();
        channel.send(buffer);
        offset += buffer.byteLength;
        this.transferProgress = Math.round((offset / file.size) * 100);
      }
      channel.send(JSON.stringify({ type: 'file-end', fileName: file.name }));
      this.transferStatus = `Sent ${file.name}`;
    },

    handleChunkReceived(chunk, peerId) {
      if (typeof chunk === 'string') {
        const message = JSON.parse(chunk);
        if (message.type === 'file-end') {
          this.saveReceivedFile(peerId, message.fileName);
        }
      } else {
        this.storeChunk(chunk, peerId);
      }
    },

    storeChunk(chunk, peerId) {
      if (!this.fileChunks.has(peerId)) {
        this.fileChunks.set(peerId, []);
      }
      this.fileChunks.get(peerId).push(chunk);
    },

    saveReceivedFile(peerId, fileName) {
      const chunks = this.fileChunks.get(peerId);
      const blob = new Blob(chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      this.fileChunks.delete(peerId);
    },

    cleanup() {
      this.socket.disconnect();
      this.peerConnections.forEach(pc => pc.close());
    }
  };
}
