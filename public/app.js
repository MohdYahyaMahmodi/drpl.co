// Word lists for generating device names
const adjectives = ['Red', 'Blue', 'Green', 'Purple', 'Golden', 'Silver', 'Crystal', 'Cosmic', 'Electric', 'Mystic'];
const nouns = ['Wolf', 'Eagle', 'Lion', 'Phoenix', 'Dragon', 'Tiger', 'Falcon', 'Panther', 'Hawk', 'Bear'];

// Utility functions
function generateDeviceName() {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj} ${noun}`;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function detectDeviceType() {
    const userAgent = navigator.userAgent.toLowerCase();
    if (/(iphone|ipod|android.*mobile|webos|blackberry)/.test(userAgent)) {
        return 'mobile';
    } else if (/(ipad|android(?!.*mobile))/.test(userAgent)) {
        return 'tablet';
    } else if (/(macintosh|windows|linux)/.test(userAgent)) {
        return window.innerWidth <= 1366 ? 'laptop' : 'desktop';
    }
    return 'desktop';
}

// File transfer chunk size (16KB for compatibility)
const CHUNK_SIZE = 16384; // 16KB

// Main application data and logic
function appData() {
    return {
        // WebRTC and networking
        socket: null,
        peerId: null,
        peerConnections: new Map(), // Stores RTCPeerConnection objects
        dataChannels: new Map(), // Stores RTCDataChannel objects
        dataChannelPromises: new Map(), // Stores promises that resolve when data channels open
        fileChunks: new Map(), // Stores incoming file chunks

        // UI state
        peers: [],
        deviceName: generateDeviceName(),
        deviceType: detectDeviceType(),
        showInfo: false,
        showAuthor: false,
        showFileTransfer: false,
        showProgress: false,
        showIncomingRequest: false,
        showFilePreview: false,
        isDragging: false,

        // File transfer state
        selectedFiles: [],
        selectedPeer: null,
        transferProgress: 0,
        transferStatus: '',
        transferDetails: '',
        isReceivingFile: false,
        receivingDetails: null,
        currentFileIndex: 0,
        receivedFiles: [],

        // Initialize the application
        init() {
            this.setupWebSocket();
            window.addEventListener('resize', () => {
                this.deviceType = detectDeviceType();
            });

            // Handle page unload
            window.addEventListener('beforeunload', () => {
                this.cleanupConnections();
            });

            // Set Toastr options
            toastr.options = {
                "closeButton": true,
                "progressBar": true,
                "positionClass": "toast-bottom-right",
                "preventDuplicates": true,
                "timeOut": "5000",
            };
        },

        // WebSocket setup and management
        setupWebSocket() {
            this.socket = io(window.location.origin);

            this.socket.on('connect', () => {
                console.log('Connected to signaling server');
                this.socket.emit('register', {
                    deviceName: this.deviceName,
                    deviceType: this.deviceType
                });
            });

            this.socket.on('registered', ({ peerId }) => {
                this.peerId = peerId;
                this.socket.emit('discover');
            });

            this.socket.on('peers', (peerList) => {
                this.peers = peerList.filter(peer => peer.id !== this.peerId);
                console.log('Updated peers:', this.peers);
            });

            this.socket.on('signal', this.handleSignaling.bind(this));
            this.socket.on('file-request', this.handleIncomingRequest.bind(this));
            this.socket.on('file-response', this.handleFileResponse.bind(this));

            // Handle peer disconnection
            this.socket.on('peer-disconnected', (peerId) => {
                this.peers = this.peers.filter(peer => peer.id !== peerId);
                console.log('Peer disconnected:', peerId);
            });
        },

        // WebRTC signaling
        async handleSignaling({ peer, signal }) {
            try {
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
            } catch (error) {
                console.error('Signaling error:', error);
            }
        },

        // WebRTC peer connection setup
        async createPeerConnection(peerId) {
            const pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            });

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    this.socket.emit('signal', {
                        target: peerId,
                        signal: event.candidate
                    });
                }
            };

            pc.ondatachannel = (event) => {
                const channel = event.channel;
                this.setupDataChannel(channel, peerId);
            };

            pc.onconnectionstatechange = () => {
                console.log(`Connection state with ${peerId}: ${pc.connectionState}`);
                if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
                    this.peerConnections.delete(peerId);
                }
            };

            this.peerConnections.set(peerId, pc);
            return pc;
        },

        // WebRTC data channel setup
        setupDataChannel(channel, peerId) {
            channel.binaryType = 'arraybuffer';

            // Create a promise that resolves when the data channel is open
            const openPromise = new Promise((resolve, reject) => {
                channel.addEventListener('open', () => {
                    console.log(`Data channel opened with peer ${peerId}`);
                    this.dataChannels.set(peerId, channel);
                    resolve();
                });

                channel.addEventListener('error', (error) => {
                    console.error(`Data channel error with peer ${peerId}:`, error);
                    toastr.error(`Data channel error with peer ${peerId}.`, 'Data Channel Error');
                    reject(error);
                });
            });

            this.dataChannelPromises.set(peerId, openPromise);

            channel.addEventListener('close', () => {
                console.log(`Data channel closed with peer ${peerId}`);
                this.dataChannels.delete(peerId);
                this.dataChannelPromises.delete(peerId);
            });

            channel.addEventListener('message', (event) => {
                if (typeof event.data === 'string') {
                    const message = JSON.parse(event.data);
                    this.handleDataChannelMessage(message, peerId);
                } else {
                    this.handleFileChunk(event.data, peerId);
                }
            });
        },

        // File transfer initialization
        async selectPeer(peer) {
            this.selectedPeer = peer;
            this.showFileTransfer = true;
            this.selectedFiles = [];

            if (!this.peerConnections.has(peer.id)) {
                try {
                    const pc = await this.createPeerConnection(peer.id);
                    const channel = pc.createDataChannel('fileTransfer');
                    this.setupDataChannel(channel, peer.id);

                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    this.socket.emit('signal', {
                        target: peer.id,
                        signal: pc.localDescription
                    });
                } catch (error) {
                    console.error('Error setting up peer connection:', error);
                    this.showFileTransfer = false;
                }
            }
        },

        // File selection handlers
        handleFileDrop(event) {
            event.preventDefault();
            this.isDragging = false;
            this.selectedFiles = Array.from(event.dataTransfer.files);
        },

        handleFileSelect(event) {
            this.selectedFiles = Array.from(event.target.files);
        },

        // Send file request to receiver
        async sendFiles() {
            if (this.selectedFiles.length === 0 || !this.selectedPeer) return;

            // Send file request via signaling server
            this.socket.emit('file-request', {
                target: this.selectedPeer.id,
                files: this.selectedFiles.map(file => ({
                    name: file.name,
                    size: file.size,
                    type: file.type
                }))
            });

            this.transferStatus = 'Waiting for recipient to accept...';
            this.showProgress = true;
            this.showFileTransfer = false;
        },

        // Handle incoming file request
        handleIncomingRequest(data) {
            const { peer, files } = data;
            const totalSize = files.reduce((acc, file) => acc + file.size, 0);

            this.isReceivingFile = true;
            this.receivingDetails = {
                peer: this.peers.find(p => p.id === peer) || { id: peer },
                fileCount: files.length,
                totalSize: totalSize,
                files: files
            };

            this.showIncomingRequest = true;
            console.log('Incoming file request from', peer, files);
            toastr.info(`${this.receivingDetails.peer.name} wants to send you files.`, 'Incoming File Transfer');
        },

        // Handle file response from receiver
        async handleFileResponse(data) {
            if (data.accepted) {
                console.log('Recipient accepted the file transfer');
                this.transferStatus = 'Recipient accepted. Preparing to send files...';

                // Now start the actual file transfer
                await this.startFileTransfer();
            } else {
                console.log('Recipient declined the file transfer');
                this.transferStatus = 'Recipient declined the transfer.';
                toastr.info('Recipient declined the file transfer.', 'Transfer Declined');
                setTimeout(() => {
                    this.showProgress = false;
                }, 2000);
            }
        },

        // Accept the incoming file transfer
        acceptTransfer() {
            this.showIncomingRequest = false;

            // Ensure the data channel is set up
            if (!this.peerConnections.has(this.receivingDetails.peer.id)) {
                // Since the sender initiated the connection, we should have a peer connection by now
                console.log('No peer connection found, cannot accept transfer.');
                toastr.error('No peer connection found, cannot accept transfer.', 'Error');
                return;
            }

            this.showProgress = true;
            this.transferStatus = 'Receiving Files...';
            this.transferProgress = 0;

            // Send acceptance to sender
            this.socket.emit('file-response', {
                target: this.receivingDetails.peer.id,
                accepted: true
            });

            toastr.success('Accepted file transfer request.', 'Transfer Accepted');
        },

        // Reject the incoming file transfer
        rejectTransfer() {
            this.showIncomingRequest = false;
            this.isReceivingFile = false;
            this.receivingDetails = null;

            // Send rejection to sender
            this.socket.emit('file-response', {
                target: this.receivingDetails.peer.id,
                accepted: false
            });

            toastr.info('Rejected file transfer request.', 'Transfer Rejected');
        },

        // Start the actual file transfer after acceptance
        async startFileTransfer() {
            const peerId = this.selectedPeer.id;

            // Wait for data channel to open
            const channel = await this.waitForDataChannel(peerId);
            if (!channel) {
                console.error('Data channel is not open');
                this.transferStatus = 'Failed to send files.';
                toastr.error('Data channel is not open. Failed to send files.', 'Transfer Failed');
                return;
            }

            const totalSize = this.selectedFiles.reduce((acc, file) => acc + file.size, 0);
            let transferredTotal = 0;

            // Send file metadata first
            channel.send(JSON.stringify({
                type: 'file-metadata',
                files: this.selectedFiles.map(file => ({
                    name: file.name,
                    size: file.size,
                    type: file.type
                })),
                totalSize: totalSize
            }));

            // Set buffer thresholds
            channel.bufferedAmountLowThreshold = 1024 * 1024; // 1MB

            for (const file of this.selectedFiles) {
                this.transferDetails = `Sending ${file.name}`;
                let offset = 0;

                while (offset < file.size) {
                    const chunkSize = Math.min(CHUNK_SIZE, file.size - offset);
                    const chunk = file.slice(offset, offset + chunkSize);

                    const buffer = await chunk.arrayBuffer();

                    // Flow control: wait if bufferedAmount is high
                    if (channel.bufferedAmount > 16 * 1024 * 1024) { // 16MB buffer limit
                        await new Promise(resolve => {
                            channel.addEventListener('bufferedamountlow', resolve, { once: true });
                        });
                    }

                    channel.send(buffer);
                    offset += buffer.byteLength;
                    transferredTotal += buffer.byteLength;

                    // Update progress
                    this.transferProgress = Math.round((transferredTotal / totalSize) * 100);
                    this.transferDetails = `${this.transferProgress}% complete (${formatFileSize(transferredTotal)} of ${formatFileSize(totalSize)})`;
                }

                // Send end-of-file marker
                channel.send(JSON.stringify({
                    type: 'file-end',
                    name: file.name
                }));
            }

            this.transferStatus = 'Transfer Complete!';
            this.transferDetails = 'All files sent successfully';

            setTimeout(() => {
                this.showProgress = false;
                this.selectedFiles = [];
                toastr.success('Files sent successfully.', 'Transfer Complete');
            }, 2000);
        },

        // Wait for the data channel to be open
        async waitForDataChannel(peerId) {
            let channel = this.dataChannels.get(peerId);

            if (channel && channel.readyState === 'open') {
                return channel;
            }

            const openPromise = this.dataChannelPromises.get(peerId);
            if (openPromise) {
                try {
                    await openPromise;
                    channel = this.dataChannels.get(peerId);
                    return channel;
                } catch (error) {
                    console.error('Failed to open data channel', error);
                    return null;
                }
            } else {
                console.error('No data channel or open promise found for peer', peerId);
                return null;
            }
        },

        // File receiving
        handleDataChannelMessage(message, peerId) {
            switch (message.type) {
                case 'file-metadata':
                    this.initializeFileReceiving(message, peerId);
                    break;
                case 'file-end':
                    this.finalizeFile(message.name);
                    break;
                default:
                    console.log('Unknown message type:', message.type);
            }
        },

        initializeFileReceiving(metadata, peerId) {
            this.fileChunks.clear();
            this.receivedFiles = [];
            this.transferProgress = 0;
            this.transferStatus = 'Receiving Files...';
            this.showProgress = true;
            this.isReceivingFile = true;

            metadata.files.forEach(file => {
                this.fileChunks.set(file.name, {
                    chunks: [],
                    size: 0,
                    metadata: file
                });
            });

            this.receivingDetails = {
                totalSize: metadata.totalSize
            };
            console.log('Initialized file receiving:', metadata);
        },

        handleFileChunk(chunk, peerId) {
            // Identify which file the chunk belongs to
            const fileNames = Array.from(this.fileChunks.keys());
            const currentFileName = fileNames[0];
            const currentFile = this.fileChunks.get(currentFileName);

            if (currentFile) {
                currentFile.chunks.push(chunk);
                currentFile.size += chunk.byteLength;

                // Update progress
                const totalReceived = Array.from(this.fileChunks.values())
                    .reduce((acc, file) => acc + file.size, 0);
                const totalSize = this.receivingDetails.totalSize;

                this.transferProgress = Math.round((totalReceived / totalSize) * 100);
                this.transferDetails = `${this.transferProgress}% complete (${formatFileSize(totalReceived)} of ${formatFileSize(totalSize)})`;

                // Check if file is completely received
                if (currentFile.size >= currentFile.metadata.size) {
                    this.finalizeFile(currentFileName);
                }
            }
        },

        finalizeFile(fileName) {
            const fileData = this.fileChunks.get(fileName);
            if (!fileData) return;

            const blob = new Blob(fileData.chunks, { type: fileData.metadata.type });
            const url = URL.createObjectURL(blob);

            this.receivedFiles.push({
                name: fileName,
                size: fileData.size,
                type: fileData.metadata.type,
                preview: this.isImageFile(fileData.metadata) ? url : null,
                url: url
            });

            this.fileChunks.delete(fileName);
            console.log(`File received: ${fileName}`);

            // Check if all files are received
            if (this.fileChunks.size === 0) {
                this.transferStatus = 'Transfer Complete!';
                this.transferDetails = 'Files received successfully';

                setTimeout(() => {
                    this.showProgress = false;
                    this.isReceivingFile = false;
                    this.showFilePreview = true;
                    toastr.success('Files received successfully.', 'Transfer Complete');
                }, 1000);
            }
        },

        // Utility methods
        isImageFile(file) {
            return file?.type?.startsWith('image/');
        },

        getFileIcon(file) {
            const type = file?.type || '';
            if (type.startsWith('image/')) return 'fas fa-image';
            if (type.startsWith('video/')) return 'fas fa-video';
            if (type.startsWith('audio/')) return 'fas fa-music';
            if (type.startsWith('text/')) return 'fas fa-file-alt';
            if (type.includes('pdf')) return 'fas fa-file-pdf';
            if (type.includes('word')) return 'fas fa-file-word';
            if (type.includes('excel') || type.includes('spreadsheet')) return 'fas fa-file-excel';
            if (type.includes('zip') || type.includes('rar')) return 'fas fa-file-archive';
            if (type.includes('powerpoint') || type.includes('presentation')) return 'fas fa-file-powerpoint';
            return 'fas fa-file';
        },

        // File preview navigation
        getCurrentFile() {
            return this.receivedFiles[this.currentFileIndex] || {};
        },

        nextFile() {
            if (this.currentFileIndex < this.receivedFiles.length - 1) {
                this.currentFileIndex++;
            }
        },

        prevFile() {
            if (this.currentFileIndex > 0) {
                this.currentFileIndex--;
            }
        },

        // File download handling
        downloadFile(file) {
            if (!file || !file.url) return;

            const a = document.createElement('a');
            a.href = file.url;
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        },

        // Connection cleanup
        cleanupConnections() {
            // Close all data channels
            this.dataChannels.forEach(channel => {
                channel.close();
            });
            this.dataChannels.clear();

            // Close all peer connections
            this.peerConnections.forEach(pc => {
                pc.close();
            });
            this.peerConnections.clear();

            // Clean up file chunks and received files
            this.fileChunks.clear();
            this.receivedFiles.forEach(file => {
                if (file.url) {
                    URL.revokeObjectURL(file.url);
                }
            });

            // Close socket connection
            if (this.socket) {
                this.socket.close();
            }
        }
    };
}
