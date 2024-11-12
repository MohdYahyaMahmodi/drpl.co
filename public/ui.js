// Word lists for generating device names
const adjectives = ['Red', 'Blue', 'Green', 'Purple', 'Golden', 'Silver', 'Crystal', 'Cosmic', 'Electric', 'Mystic'];
const nouns = ['Wolf', 'Eagle', 'Lion', 'Phoenix', 'Dragon', 'Tiger', 'Falcon', 'Panther', 'Hawk', 'Bear'];

// Utility functions
function generateDeviceName() {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj} ${noun}`;
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

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function appData() {
    return {
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
            // Setup WebSocket connection
            FileTransfer.setupWebSocket(this.deviceName, this.deviceType);

            // Basic connection events
            FileTransfer.on('registered', ({ peerId }) => {
                console.log('Registered with peer ID:', peerId);
            });

            FileTransfer.on('peers', (peers) => {
                this.peers = peers;
            });

            // File request handling
            FileTransfer.on('incoming-file-request', (details) => {
                this.receivingDetails = details;
                this.showIncomingRequest = true;
                toastr.info(
                    `${this.getPeerName(details.peer.id) || 'A user'} wants to send you files.`,
                    'Incoming File Transfer'
                );
            });

            // Transfer status events
            FileTransfer.on('transfer-initialized', ({ transferStatus, transferDetails }) => {
                this.transferStatus = transferStatus;
                this.transferDetails = transferDetails;
                this.transferProgress = 0;
                this.showProgress = true;
            });

            FileTransfer.on('transfer-status', ({ transferStatus, transferDetails, transferProgress }) => {
                this.transferStatus = transferStatus;
                this.transferDetails = transferDetails;
                this.transferProgress = transferProgress;
                this.showProgress = true;
            });

            FileTransfer.on('transfer-progress', ({ transferStatus, transferDetails, transferProgress }) => {
                this.transferStatus = transferStatus;
                this.transferDetails = transferDetails;
                this.transferProgress = transferProgress;
                this.showProgress = true;
            });

            // Chunk handling events
            FileTransfer.on('chunk-error', ({ fileName, chunkIndex, error }) => {
                toastr.error(
                    `Error transferring part of file ${fileName}. Retrying...`,
                    'Transfer Error'
                );
                console.error('Chunk error:', error);
            });

            FileTransfer.on('chunk-retry', ({ fileName, chunkIndex, attempt }) => {
                if (attempt > 1) {
                    toastr.warning(
                        `Retrying transfer for ${fileName} (Attempt ${attempt})`,
                        'Retrying Transfer'
                    );
                }
            });

            FileTransfer.on('chunk-retry-limit-exceeded', ({ fileName }) => {
                toastr.error(
                    `Failed to transfer ${fileName} after multiple attempts. Please try again.`,
                    'Transfer Failed'
                );
                this.showProgress = false;
            });

            // Transfer state events
            FileTransfer.on('transfer-paused', ({ reason }) => {
                this.transferStatus = 'Transfer paused: ' + reason;
                toastr.info(reason, 'Transfer Paused');
            });

            FileTransfer.on('transfer-resumed', () => {
                toastr.success('Transfer resumed', 'Transfer Resumed');
            });

            FileTransfer.on('transfer-complete', ({ transferStatus, transferDetails, receivedFiles }) => {
                this.transferStatus = transferStatus;
                this.transferDetails = transferDetails;
                this.receivedFiles = receivedFiles || this.receivedFiles;
                this.showProgress = false;
                this.isReceivingFile = false;
                
                if (receivedFiles && receivedFiles.length > 0) {
                    this.showFilePreview = true;
                    this.currentFileIndex = 0;
                }
                
                const fileCount = receivedFiles ? receivedFiles.length : this.selectedFiles.length;
                const filesWord = fileCount === 1 ? 'file' : 'files';
                toastr.success(
                    `Successfully transferred ${fileCount} ${filesWord}`,
                    'Transfer Complete'
                );
                
                this.selectedFiles = [];
                this.selectedPeer = null;
            });

            FileTransfer.on('transfer-declined', ({ message }) => {
                this.transferStatus = message;
                toastr.error(message, 'Transfer Declined');
                setTimeout(() => {
                    this.showProgress = false;
                }, 2000);
            });

            // Connection status events
            FileTransfer.on('connection-status', ({ status }) => {
                switch(status) {
                    case 'slow':
                        toastr.warning(
                            'Connection appears to be slow. Transfer may take longer.',
                            'Slow Connection'
                        );
                        break;
                    case 'unstable':
                        toastr.warning(
                            'Connection is unstable. Transfer may pause.',
                            'Unstable Connection'
                        );
                        break;
                    case 'restored':
                        toastr.success('Connection restored.', 'Connection Status');
                        break;
                }
            });

            FileTransfer.on('peer-disconnected', (peerId) => {
                this.peers = this.peers.filter(peer => peer.id !== peerId);
                console.log('Peer disconnected:', peerId);
                toastr.error(`Peer ${this.getPeerName(peerId)} disconnected.`, 'Peer Disconnected');
            });

            // Error handling
            FileTransfer.on('error', ({ message, error, fatal }) => {
                if (fatal) {
                    toastr.error(message, 'Fatal Error');
                    this.showProgress = false;
                    this.showFileTransfer = false;
                    this.selectedFiles = [];
                    this.selectedPeer = null;
                } else {
                    toastr.error(message, 'Error');
                }
                console.error('Transfer error:', error);
            });

            FileTransfer.on('transfer-error-recoverable', ({ message }) => {
                toastr.warning(message, 'Transfer Warning');
            });

            // Window event listeners
            window.addEventListener('resize', () => {
                this.deviceType = detectDeviceType();
            });

            window.addEventListener('beforeunload', () => {
                FileTransfer.cleanupConnections();
            });

            // Configure Toastr
            toastr.options = {
                closeButton: true,
                progressBar: true,
                positionClass: "toast-bottom-right",
                preventDuplicates: true,
                timeOut: 5000,
                extendedTimeOut: 2000,
                newestOnTop: false,
                className: 'file-transfer-toast'
            };
        },

        // UI interaction methods
        handleFileDrop(event) {
            event.preventDefault();
            this.isDragging = false;
            this.selectedFiles = Array.from(event.dataTransfer.files);
        },

        handleFileSelect(event) {
            this.selectedFiles = Array.from(event.target.files);
        },

        async selectPeer(peer) {
            this.selectedPeer = peer;
            this.showFileTransfer = true;
            this.selectedFiles = [];

            if (!FileTransfer.peerConnections.has(peer.id)) {
                try {
                    const pc = await FileTransfer.createPeerConnection(peer.id);
                    const channel = pc.createDataChannel('fileTransfer', {
                        ordered: true,
                        maxRetransmits: null
                    });
                    FileTransfer.setupDataChannel(channel, peer.id);

                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    const socket = FileTransfer.getSocket();
                    socket.emit('signal', {
                        target: peer.id,
                        signal: pc.localDescription
                    });
                } catch (error) {
                    console.error('Error setting up peer connection:', error);
                    this.showFileTransfer = false;
                    toastr.error('Failed to set up connection. Please try again.', 'Connection Error');
                }
            }
        },

        async sendFiles() {
            if (this.selectedFiles.length === 0 || !this.selectedPeer) return;

            const totalSize = this.selectedFiles.reduce((acc, file) => acc + file.size, 0);
            const MAX_RECOMMENDED_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

            if (totalSize > MAX_RECOMMENDED_SIZE) {
                const confirmed = await new Promise(resolve => {
                    toastr.options = {
                        timeOut: 0,
                        extendedTimeOut: 0,
                        closeButton: true,
                        closeHtml: `
                            <button class="btn-primary mr-2">Continue</button>
                            <button>Cancel</button>
                        `,
                        onCloseClick: () => resolve(false),
                        onclick: () => resolve(true)
                    };
                    toastr.warning(
                        'This is a large transfer and might take a while. Continue?',
                        'Large Transfer'
                    );
                });

                if (!confirmed) return;
            }

            this.proceedWithTransfer();
        },

        proceedWithTransfer() {
            FileTransfer.setSelectedFiles(this.selectedFiles);
            FileTransfer.setSelectedPeer(this.selectedPeer);

            const socket = FileTransfer.getSocket();
            socket.emit('file-request', {
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

        acceptTransfer() {
            this.showIncomingRequest = false;
            const socket = FileTransfer.getSocket();
            socket.emit('file-response', {
                target: this.receivingDetails.peer.id,
                accepted: true
            });

            this.showProgress = true;
            this.transferStatus = 'Receiving Files...';
            this.transferProgress = 0;
            toastr.success('Accepted file transfer request.', 'Transfer Accepted');
        },

        rejectTransfer() {
            this.showIncomingRequest = false;
            this.isReceivingFile = false;
            const socket = FileTransfer.getSocket();
            socket.emit('file-response', {
                target: this.receivingDetails.peer.id,
                accepted: false
            });
            toastr.info('Rejected file transfer request.', 'Transfer Rejected');
        },

        getPeerName(peerId) {
            const peer = this.peers.find(p => p.id === peerId);
            return peer ? peer.name : peerId;
        },

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

        downloadFile(file) {
            if (!file || !file.url) return;
            const a = document.createElement('a');
            a.href = file.url;
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        },

        async downloadAllFilesAsZip() {
            if (this.receivedFiles.length === 0) return;

            try {
                const zip = new JSZip();
                const filePromises = this.receivedFiles.map(async (file) => {
                    const arrayBuffer = await file.blob.arrayBuffer();
                    zip.file(file.name, arrayBuffer, {
                        binary: true,
                        compression: "DEFLATE",
                        compressionOptions: {
                            level: 6
                        }
                    });
                });

                await Promise.all(filePromises);

                const content = await zip.generateAsync({
                    type: 'blob',
                    compression: "DEFLATE",
                    compressionOptions: {
                        level: 6
                    },
                    comment: "Created with FileDrop",
                    mimeType: "application/zip",
                    platform: "UNIX"
                });

                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'files.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

            } catch (error) {
                console.error('Error creating zip file:', error);
                toastr.error(
                    'Failed to create zip file. Please try downloading files individually.',
                    'Download Error'
                );
            }
        },

        cleanup() {
            FileTransfer.cleanupConnections();
        }
    };
}