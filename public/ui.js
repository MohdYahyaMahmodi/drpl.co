// ui.js

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
            FileTransfer.setupWebSocket(this.deviceName, this.deviceType);

            // Listen to events from FileTransfer
            FileTransfer.on('registered', ({ peerId }) => {
                // Do something with peerId
                // this.peerId = peerId; // not in UI
            });

            FileTransfer.on('peers', (peers) => {
                this.peers = peers;
            });

            FileTransfer.on('incoming-file-request', (details) => {
                this.receivingDetails = details;
                this.showIncomingRequest = true;
                toastr.info(`${this.getPeerName(details.peer.id) || 'A user'} wants to send you files.`, 'Incoming File Transfer');
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
            });

            FileTransfer.on('transfer-complete', ({ transferStatus, transferDetails, receivedFiles }) => {
                this.transferStatus = transferStatus;
                this.transferDetails = transferDetails;
                this.receivedFiles = receivedFiles || this.receivedFiles;
                this.showProgress = false;
                this.isReceivingFile = false;
                this.showFilePreview = true;
                toastr.success('File transfer complete.', 'Transfer Complete');
            });

            FileTransfer.on('transfer-declined', ({ message }) => {
                this.transferStatus = message;
                toastr.error(message, 'Transfer Declined');
                setTimeout(() => {
                    this.showProgress = false;
                }, 2000);
            });

            FileTransfer.on('peer-disconnected', (peerId) => {
                // Update peers list
                this.peers = this.peers.filter(peer => peer.id !== peerId);
                console.log('Peer disconnected:', peerId);
                // Show toastr message
                toastr.error(`Peer ${peerId} disconnected.`, 'Peer Disconnected');
            });

            FileTransfer.on('error', ({ message }) => {
                toastr.error(message, 'Error');
            });

            window.addEventListener('resize', () => {
                this.deviceType = detectDeviceType();
            });

            // Handle page unload
            window.addEventListener('beforeunload', () => {
                FileTransfer.cleanupConnections();
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

        // UI interaction methods

        // File selection handlers
        handleFileDrop(event) {
            event.preventDefault();
            this.isDragging = false;
            this.selectedFiles = Array.from(event.dataTransfer.files);
        },

        handleFileSelect(event) {
            this.selectedFiles = Array.from(event.target.files);
        },

        // Select peer and set up connection
        async selectPeer(peer) {
            this.selectedPeer = peer;
            this.showFileTransfer = true;
            this.selectedFiles = [];

            if (!FileTransfer.peerConnections.has(peer.id)) {
                try {
                    const pc = await FileTransfer.createPeerConnection(peer.id);
                    const channel = pc.createDataChannel('fileTransfer', {
                        ordered: true,
                        maxRetransmits: null // Ensure reliable ordered delivery
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

        // Send files
        async sendFiles() {
            if (this.selectedFiles.length === 0 || !this.selectedPeer) return;

            FileTransfer.setSelectedFiles(this.selectedFiles);
            FileTransfer.setSelectedPeer(this.selectedPeer);

            const socket = FileTransfer.getSocket();
            // Send file request via signaling server
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

        // Accept or reject transfer
        acceptTransfer() {
            this.showIncomingRequest = false;

            // Send acceptance to sender
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

            // Send rejection to sender
            const socket = FileTransfer.getSocket();
            socket.emit('file-response', {
                target: this.receivingDetails.peer.id,
                accepted: false
            });

            toastr.info('Rejected file transfer request.', 'Transfer Rejected');
        },

        // Helper methods
        getPeerName(peerId) {
            const peer = this.peers.find(p => p.id === peerId);
            return peer ? peer.name : peerId;
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

        async downloadAllFilesAsZip() {
            if (this.receivedFiles.length === 0) return;

            try {
                const zip = new JSZip();

                // Create a promise for each file to be added to the zip
                const filePromises = this.receivedFiles.map(async (file) => {
                    // Convert blob to array buffer to ensure binary data integrity
                    const arrayBuffer = await file.blob.arrayBuffer();

                    // Add file to zip with binary flag
                    zip.file(file.name, arrayBuffer, {
                        binary: true,
                        compression: "DEFLATE",
                        compressionOptions: {
                            level: 6 // Balanced compression level
                        }
                    });
                });

                // Wait for all files to be added to the zip
                await Promise.all(filePromises);

                // Generate the zip file with explicit options
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

                // Create and trigger download
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'files.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                // Clean up
                URL.revokeObjectURL(url);

            } catch (error) {
                console.error('Error creating zip file:', error);
                toastr.error('Failed to create zip file. Please try downloading files individually.', 'Download Error');
            }
        },

        // Cleanup on unload
        cleanup() {
            FileTransfer.cleanupConnections();
        }

    };
}
