// Constants
const CHUNK_SIZE = 16 * 1024; // 16KB chunks
const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB buffer threshold
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// Word lists for generating device names
const adjectives = ['Red', 'Blue', 'Green', 'Purple', 'Golden', 'Silver', 'Crystal', 'Cosmic', 'Electric', 'Mystic'];
const nouns = ['Wolf', 'Eagle', 'Lion', 'Phoenix', 'Dragon', 'Tiger', 'Falcon', 'Panther', 'Hawk', 'Bear'];

class FileTransferHandler {
    constructor() {
        this.activeTransfers = new Map();
        this.chunkBuffer = new Map();
    }

    initializeTransfer(fileId, metadata) {
        this.activeTransfers.set(fileId, {
            metadata,
            receivedChunks: new Map(),
            expectedChunks: Math.ceil(metadata.size / CHUNK_SIZE),
            receivedSize: 0,
            status: 'initialized',
            retryCount: 0
        });
    }

    async handleChunk(fileId, chunk, sequence) {
        const transfer = this.activeTransfers.get(fileId);
        if (!transfer) {
            throw new Error(`No active transfer found for file ${fileId}`);
        }

        // Buffer management
        if (this.chunkBuffer.size > 100) {
            this.chunkBuffer.clear();
        }

        // Store chunk with sequence number
        transfer.receivedChunks.set(sequence, chunk);
        transfer.receivedSize += chunk.byteLength;

        // Verify chunk integrity
        if (!this.verifyChunk(chunk)) {
            return {
                status: 'retry',
                sequence,
                reason: 'chunk_verification_failed'
            };
        }

        // Check if we have all chunks
        if (this.isTransferComplete(transfer)) {
            return await this.finalizeTransfer(fileId);
        }

        return {
            status: 'success',
            sequence,
            receivedSize: transfer.receivedSize,
            progress: (transfer.receivedSize / transfer.metadata.size) * 100
        };
    }

    verifyChunk(chunk) {
        return chunk && chunk.byteLength > 0 && chunk.byteLength <= CHUNK_SIZE;
    }

    isTransferComplete(transfer) {
        if (!transfer) return false;
        
        const expectedChunks = transfer.expectedChunks;
        const receivedChunks = transfer.receivedChunks.size;
        
        if (receivedChunks !== expectedChunks) return false;
        
        for (let i = 0; i < expectedChunks; i++) {
            if (!transfer.receivedChunks.has(i)) return false;
        }
        
        return transfer.receivedSize === transfer.metadata.size;
    }

    async finalizeTransfer(fileId) {
        const transfer = this.activeTransfers.get(fileId);
        if (!transfer) throw new Error('Transfer not found');

        try {
            const sortedChunks = Array.from(transfer.receivedChunks.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([_, chunk]) => chunk);

            const blob = new Blob(sortedChunks, {
                type: transfer.metadata.type || 'application/octet-stream'
            });

            if (Math.abs(blob.size - transfer.metadata.size) > CHUNK_SIZE) {
                if (transfer.retryCount < MAX_RETRIES) {
                    transfer.retryCount++;
                    return {
                        status: 'retry_transfer',
                        reason: 'size_mismatch',
                        attempt: transfer.retryCount
                    };
                }
                throw new Error(`Size verification failed after ${MAX_RETRIES} attempts`);
            }

            return {
                status: 'complete',
                blob,
                metadata: transfer.metadata,
                size: blob.size
            };

        } catch (error) {
            console.error('Transfer finalization error:', error);
            return {
                status: 'error',
                error: error.message
            };
        } finally {
            this.cleanup(fileId);
        }
    }

    cleanup(fileId) {
        this.activeTransfers.delete(fileId);
        this.chunkBuffer.delete(fileId);
    }

    getProgress(fileId) {
        const transfer = this.activeTransfers.get(fileId);
        if (!transfer) return null;

        return {
            receivedSize: transfer.receivedSize,
            totalSize: transfer.metadata.size,
            progress: (transfer.receivedSize / transfer.metadata.size) * 100,
            chunksReceived: transfer.receivedChunks.size,
            totalChunks: transfer.expectedChunks
        };
    }
}

// Utility functions
function generateDeviceName() {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj} ${noun}`;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
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

// Configure toastr
toastr.options = {
    "closeButton": true,
    "progressBar": true,
    "positionClass": "toast-bottom-right",
    "preventDuplicates": true,
    "timeOut": "5000",
};

// Main application
function appData() {
    const transferHandler = new FileTransferHandler();

    return {
        // State
        socket: null,
        peerId: null,
        peerConnections: new Map(),
        dataChannels: new Map(),
        peers: [],
        selectedFiles: [],
        selectedPeer: null,
        deviceName: generateDeviceName(),
        deviceType: detectDeviceType(),
        
        // UI state
        showInfo: false,
        showAuthor: false,
        showFileTransfer: false,
        showProgress: false,
        showIncomingRequest: false,
        showFilePreview: false,
        isDragging: false,
        
        // Transfer state
        transferProgress: 0,
        transferStatus: '',
        transferDetails: '',
        isReceivingFile: false,
        receivingDetails: null,
        currentFileIndex: 0,
        receivedFiles: [],
        
        // Initialize
        init() {
            this.setupWebSocket();
            this.setupEventListeners();
        },

        setupEventListeners() {
            window.addEventListener('resize', () => {
                this.deviceType = detectDeviceType();
            });

            window.addEventListener('beforeunload', (event) => {
                if (this.isReceivingFile || this.showProgress) {
                    event.preventDefault();
                    event.returnValue = '';
                }
                this.cleanupConnections();
            });
        },

        setupWebSocket() {
            const socketProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            const socketUrl = `${socketProtocol}://${window.location.hostname}:${window.location.port}`;

            this.socket = io(socketUrl, {
                path: '/socket.io',
                transports: ['websocket'],
                secure: socketProtocol === 'wss',
            });

            this.setupSocketEvents();
        },

        setupSocketEvents() {
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
            });

            this.socket.on('signal', this.handleSignaling.bind(this));
            this.socket.on('file-request', this.handleIncomingRequest.bind(this));
            this.socket.on('file-response', this.handleFileResponse.bind(this));
            
            this.socket.on('peer-disconnected', (peerId) => {
                const disconnectedPeer = this.peers.find(p => p.id === peerId);
                this.peers = this.peers.filter(peer => peer.id !== peerId);
                
                if (this.isReceivingFile && this.receivingDetails?.peer?.id === peerId) {
                    this.handleTransferError(new Error('Peer disconnected during transfer'));
                }
                
                if (disconnectedPeer) {
                    toastr.error(`${disconnectedPeer.name} disconnected.`, 'Peer Disconnected');
                }
            });
        },

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
                toastr.error('Connection error. Please try again.', 'Signaling Error');
            }
        },

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
                this.setupDataChannel(event.channel, peerId);
            };

            pc.onconnectionstatechange = () => {
                console.log(`Connection state with ${this.getPeerName(peerId)}: ${pc.connectionState}`);
                if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
                    this.handlePeerDisconnection(peerId);
                }
            };

            this.peerConnections.set(peerId, pc);
            return pc;
        },

        setupDataChannel(channel, peerId) {
            channel.binaryType = 'arraybuffer';
            channel.bufferedAmountLowThreshold = MAX_BUFFER_SIZE;

            channel.onopen = () => {
                console.log(`Data channel opened with peer ${this.getPeerName(peerId)}`);
                this.dataChannels.set(peerId, channel);
            };

            channel.onclose = () => {
                console.log(`Data channel closed with peer ${this.getPeerName(peerId)}`);
                this.dataChannels.delete(peerId);
                if (this.isReceivingFile || this.showProgress) {
                    this.handleTransferError(new Error('Connection closed'));
                }
            };

            channel.onerror = (error) => {
                console.error(`Data channel error with peer ${this.getPeerName(peerId)}:`, error);
                toastr.error('Connection error occurred.', 'Data Channel Error');
            };

            channel.onmessage = async (event) => {
                try {
                    if (typeof event.data === 'string') {
                        const message = JSON.parse(event.data);
                        await this.handleDataChannelMessage(message, peerId);
                    } else {
                        await this.handleFileChunk(event.data, peerId);
                    }
                } catch (error) {
                    console.error('Error handling message:', error);
                    this.handleTransferError(error);
                }
            };

            return channel;
        },

        async handleDataChannelMessage(message, peerId) {
            console.log(`Received message type ${message.type}:`, message);

            switch (message.type) {
                case 'transfer-start':
                    await this.initializeTransfer(message);
                    break;
                case 'file-metadata':
                    await this.initializeFileReceiving(message, peerId);
                    break;
                case 'chunk-metadata':
                    // Store metadata for next chunk
                    this.currentChunkMetadata = message;
                    break;
                case 'file-end':
                    await this.finalizeFile(message.name);
                    break;
                case 'transfer-error':
                    this.handleTransferError(new Error(message.error));
                    break;
            }
        },

        async handleFileChunk(chunk, peerId) {
            if (!this.isReceivingFile || !this.currentReceivingFileName) {
                return;
            }

            try {
                const result = await transferHandler.handleChunk(
                    this.currentReceivingFileName,
                    chunk,
                    this.currentChunkMetadata?.sequence
                );

                if (result.status === 'retry') {
                    await this.requestChunkRetry(peerId, result.sequence);
                } else if (result.status === 'complete') {
                    await this.handleTransferComplete(result);
                } else if (result.status === 'success') {
                    this.updateTransferProgress(result.progress);
                }

            } catch (error) {
                console.error('Error handling chunk:', error);
                this.handleTransferError(error);
            }
        },

        async requestChunkRetry(peerId, sequence) {
            const channel = this.dataChannels.get(peerId);
            if (channel) {
                await this.sendMessage(channel, {
                    type: 'chunk-retry',
                    sequence: sequence,
                    fileName: this.currentReceivingFileName
                });
            }
        },

        async initializeTransfer(metadata) {
            this.fileChunks = new Map();
            this.receivedFiles = [];
            this.transferProgress = 0;
            this.currentFileIndex = 0;
            this.totalTransferSize = metadata.totalSize;
            this.totalTransferFiles = metadata.totalFiles;
            this.transferStatus = 'Preparing to receive files...';
            console.log(`Initialized transfer: ${metadata.totalFiles} files, ${metadata.totalSize} bytes`);
        },

        async initializeFileReceiving(metadata, peerId) {
            const { file, fileNumber, totalFiles } = metadata;
            
            this.currentReceivingFileName = file.name;
            transferHandler.initializeTransfer(file.name, file);
            
            this.transferStatus = `Receiving file ${fileNumber} of ${totalFiles}`;
            this.transferDetails = `${file.name} (${formatFileSize(file.size)})`;
            
            console.log(`Initialized receiving file ${fileNumber}: ${file.name} (${file.size} bytes)`);
            
            const channel = this.dataChannels.get(peerId);
            if (channel) {
                await this.sendMessage(channel, {
                    type: 'ready-for-file',
                    fileName: file.name
                });
            }
        },

        async handleTransferComplete(result) {
            const { blob, metadata } = result;
            const url = URL.createObjectURL(blob);
            
            this.receivedFiles.push({
                name: metadata.name,
                size: blob.size,
                type: metadata.type,
                preview: metadata.type?.startsWith('image/') ? url : null,
                url: url,
                blob: blob
            });
            
            this.currentFileIndex = this.receivedFiles.length - 1;
            
            if (this.receivedFiles.length === this.totalTransferFiles) {
                this.transferStatus = 'Transfer Complete!';
                this.transferDetails = 'All files received successfully';
                
                setTimeout(() => {
                    this.showProgress = false;
                    this.isReceivingFile = false;
                    this.showFilePreview = true;
                    toastr.success('Files received successfully.', 'Transfer Complete');
                }, 1000);
            }
        },

        handleTransferError(error) {
            console.error('Transfer error:', error);
            this.transferAborted = true;
            this.isReceivingFile = false;
            this.showProgress = false;
            transferHandler.cleanup(this.currentReceivingFileName);
            toastr.error('File transfer failed. Please try again.', 'Transfer Error');
        },

        async sendFiles() {
            if (!this.selectedFiles.length || !this.selectedPeer) return;

            try {
                const channel = await this.getDataChannel(this.selectedPeer.id);
                if (!channel) throw new Error('No data channel available');

                // Send transfer start metadata
                await this.sendMessage(channel, {
                    type: 'transfer-start',
                    totalFiles: this.selectedFiles.length,
                    totalSize: this.selectedFiles.reduce((acc, file) => acc + file.size, 0)
                });

                for (let i = 0; i < this.selectedFiles.length; i++) {
                    const file = this.selectedFiles[i];
                    const fileNumber = i + 1;

                    // Send file metadata
                    await this.sendMessage(channel, {
                        type: 'file-metadata',
                        file: {
                            name: file.name,
                            size: file.size,
                            type: file.type
                        },
                        fileNumber,
                        totalFiles: this.selectedFiles.length
                    });

                    // Send file chunks
                    const chunks = await this.createFileChunks(file);
                    for (let j = 0; j < chunks.length; j++) {
                        await this.sendChunk(channel, chunks[j], j, file);
                        
                        // Update progress
                        const progress = ((i * file.size + (j + 1) * CHUNK_SIZE) / this.getTotalSize()) * 100;
                        this.updateTransferProgress(progress);
                    }

                    // Send file end marker
                    await this.sendMessage(channel, {
                        type: 'file-end',
                        name: file.name,
                        fileNumber,
                        totalFiles: this.selectedFiles.length
                    });
                }

            } catch (error) {
                console.error('Error sending files:', error);
                this.handleTransferError(error);
            }
        },

        async createFileChunks(file) {
            const chunks = [];
            let offset = 0;
            
            while (offset < file.size) {
                const chunk = file.slice(offset, offset + CHUNK_SIZE);
                chunks.push(await chunk.arrayBuffer());
                offset += CHUNK_SIZE;
            }
            
            return chunks;
        },

        async sendChunk(channel, chunk, sequence, file) {
            // Send chunk metadata
            await this.sendMessage(channel, {
                type: 'chunk-metadata',
                sequence,
                size: chunk.byteLength
            });

            // Send the actual chunk
            await new Promise((resolve, reject) => {
                const send = () => {
                    try {
                        if (channel.bufferedAmount > MAX_BUFFER_SIZE) {
                            setTimeout(send, 100);
                            return;
                        }
                        channel.send(chunk);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };
                send();
            });
        },

        async sendMessage(channel, message) {
            return new Promise((resolve, reject) => {
                try {
                    channel.send(JSON.stringify(message));
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        },

        async getDataChannel(peerId) {
            let channel = this.dataChannels.get(peerId);
            if (channel?.readyState === 'open') return channel;

            const pc = this.peerConnections.get(peerId);
            if (!pc) return null;

            channel = pc.createDataChannel('fileTransfer', {
                ordered: true,
                maxRetransmits: MAX_RETRIES
            });

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Data channel connection timeout'));
                }, 10000);

                channel.onopen = () => {
                    clearTimeout(timeout);
                    this.dataChannels.set(peerId, channel);
                    resolve(channel);
                };

                channel.onerror = (error) => {
                    clearTimeout(timeout);
                    reject(error);
                };

                this.setupDataChannel(channel, peerId);
            });
        },

        handlePeerDisconnection(peerId) {
            this.peerConnections.delete(peerId);
            this.dataChannels.delete(peerId);
            
            if (this.selectedPeer?.id === peerId) {
                this.selectedPeer = null;
                this.showFileTransfer = false;
            }
        },

        updateTransferProgress(progress) {
            this.transferProgress = Math.min(100, Math.round(progress));
        },

        getTotalSize() {
            return this.selectedFiles.reduce((acc, file) => acc + file.size, 0);
        },

        // File preview methods
        getCurrentFile() {
            return this.receivedFiles[this.currentFileIndex] || null;
        },

        isImageFile(file) {
            return file?.type?.startsWith('image/') || false;
        },

        getFileIcon(file) {
            const type = file?.type || '';
            if (type.startsWith('image/')) return 'fas fa-image';
            if (type.startsWith('video/')) return 'fas fa-video';
            if (type.startsWith('audio/')) return 'fas fa-music';
            if (type.startsWith('text/')) return 'fas fa-file-alt';
            if (type.includes('pdf')) return 'fas fa-file-pdf';
            if (type.includes('word')) return 'fas fa-file-word';
            if (type.includes('excel')) return 'fas fa-file-excel';
            if (type.includes('zip')) return 'fas fa-file-archive';
            return 'fas fa-file';
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

        hasFiles() {
            return this.receivedFiles.length > 0;
        },

        getPeerName(peerId) {
            return this.peers.find(p => p.id === peerId)?.name || peerId;
        },

        // Cleanup
        cleanupConnections() {
            this.dataChannels.forEach(channel => channel.close());
            this.dataChannels.clear();
            
            this.peerConnections.forEach(pc => pc.close());
            this.peerConnections.clear();
            
            this.receivedFiles.forEach(file => {
                if (file.url) URL.revokeObjectURL(file.url);
            });
            
            if (this.socket) this.socket.close();
        }
    };
}