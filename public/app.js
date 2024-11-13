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

// File transfer chunk size and partition size
const CHUNK_SIZE = 64 * 1024; // 64 KB
const PARTITION_SIZE = 1 * 1024 * 1024; // 1 MB

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
        messagePromises: new Map(), // Stores pending promises for messages

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

            // Add heartbeat response handler
            this.socket.on('heartbeat', () => {
                this.socket.emit('heartbeat-response');
            });

            // Add handler for peer disconnection
            this.socket.on('peer-disconnected', (peerId) => {
                this.peers = this.peers.filter(p => p.id !== peerId);
            });
        },

        // WebSocket setup and management
        setupWebSocket() {
            // Use the current window location to determine the socket URL
            const socketProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            const socketUrl = `${socketProtocol}://${window.location.hostname}:${window.location.port}`;

            // Initialize the socket connection
            this.socket = io(socketUrl, {
                path: '/socket.io',
                transports: ['websocket'],
                secure: socketProtocol === 'wss',
            });

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
                const disconnectedPeer = this.peers.find(p => p.id === peerId);
                this.peers = this.peers.filter(peer => peer.id !== peerId);
                console.log('Peer disconnected:', disconnectedPeer ? disconnectedPeer.name : peerId);
                toastr.error(`Peer ${disconnectedPeer ? disconnectedPeer.name : peerId} disconnected.`, 'Peer Disconnected');
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
                toastr.error('Error during signaling. Please refresh and try again.', 'Signaling Error');
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
                console.log(`Connection state with ${this.getPeerName(peerId)}: ${pc.connectionState}`);
                if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
                    this.peerConnections.delete(peerId);
                    toastr.error(`Connection with peer ${this.getPeerName(peerId)} closed.`, 'Connection Closed');
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
                    console.log(`Data channel opened with peer ${this.getPeerName(peerId)}`);
                    this.dataChannels.set(peerId, channel);
                    resolve();
                });

                channel.addEventListener('error', (error) => {
                    console.error(`Data channel error with peer ${this.getPeerName(peerId)}:`, error);
                    toastr.error(`Data channel error with peer ${this.getPeerName(peerId)}.`, 'Data Channel Error');
                    reject(error);
                });
            });

            this.dataChannelPromises.set(peerId, openPromise);

            channel.addEventListener('close', () => {
                console.log(`Data channel closed with peer ${this.getPeerName(peerId)}`);
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
                    const channel = pc.createDataChannel('fileTransfer', {
                        ordered: true,
                        maxRetransmits: null // Ensure reliable ordered delivery
                    });
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
                    toastr.error('Failed to set up connection. Please try again.', 'Connection Error');
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
            toastr.info(`${this.getPeerName(peer) || 'A user'} wants to send you files.`, 'Incoming File Transfer');
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
                toastr.error('Recipient declined the file transfer.', 'Transfer Declined');
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

            const totalFiles = this.selectedFiles.length;
            const totalSize = this.selectedFiles.reduce((acc, file) => acc + file.size, 0);

            console.log(`Starting file transfer to ${this.getPeerName(peerId)}. Total files: ${totalFiles}, Total size: ${totalSize}`);

            // Send total transfer metadata
            channel.send(JSON.stringify({
                type: 'transfer-start',
                totalFiles: totalFiles,
                totalSize: totalSize
            }));

            // Process files sequentially
            for (let i = 0; i < this.selectedFiles.length; i++) {
                const file = this.selectedFiles[i];
                const fileNumber = i + 1;

                console.log(`Sending file ${fileNumber} of ${totalFiles}: ${file.name} (${file.size} bytes)`);

                // Update status for sender
                this.transferStatus = `Sending file ${fileNumber} of ${totalFiles}`;
                this.transferDetails = `${file.name} (${formatFileSize(file.size)})`;

                // Send individual file metadata
                channel.send(JSON.stringify({
                    type: 'file-metadata',
                    file: {
                        name: file.name,
                        size: file.size,
                        type: file.type
                    },
                    fileNumber: fileNumber,
                    totalFiles: totalFiles
                }));

                // Wait for receiver to be ready
                console.log(`Waiting for receiver to be ready for file: ${file.name}`);
                await this.waitForMessage('ready-for-file', message => message.fileName === file.name);
                console.log(`Receiver is ready for file: ${file.name}`);

                // Send file in partitions
                let offset = 0;
                let fileTransferred = 0;

                while (offset < file.size) {
                    // Determine partition size
                    const partitionSize = Math.min(PARTITION_SIZE, file.size - offset);
                    const partitionEnd = offset + partitionSize;

                    console.log(`Starting new partition from offset ${offset} to ${partitionEnd} for ${file.name}`);

                    while (offset < partitionEnd) {
                        const chunkSize = Math.min(CHUNK_SIZE, partitionEnd - offset);
                        const chunk = file.slice(offset, offset + chunkSize);
                        const buffer = await chunk.arrayBuffer();

                        channel.send(buffer);
                        offset += buffer.byteLength;
                        fileTransferred += buffer.byteLength;

                        // Update progress for current file
                        const fileProgress = Math.round((fileTransferred / file.size) * 100);
                        this.transferProgress = Math.round((fileTransferred + this.getCompletedFilesSize(i)) / totalSize * 100);
                        this.transferDetails = `File ${fileNumber}/${totalFiles}: ${file.name} - ${fileProgress}%`;

                        // Optional: Log progress
                        console.log(`Sent chunk: ${offset}/${file.size} bytes (${fileProgress}%)`);
                    }

                    // Send partition end message
                    console.log(`Sending partition-end message at offset ${offset} for ${file.name}`);
                    channel.send(JSON.stringify({
                        type: 'partition-end',
                        fileName: file.name,
                        offset: offset
                    }));

                    // Wait for receiver's acknowledgment
                    console.log(`Waiting for partition-received acknowledgment for offset ${offset} of ${file.name}`);
                    await this.waitForMessage('partition-received', message => message.fileName === file.name && message.offset === offset);
                    console.log(`Partition ending at offset ${offset} acknowledged by receiver.`);
                }

                // Send end-of-file marker
                console.log(`Sending file-end message for ${file.name}`);
                channel.send(JSON.stringify({
                    type: 'file-end',
                    name: file.name,
                    fileNumber: fileNumber,
                    totalFiles: totalFiles
                }));

                // Wait for file completion acknowledgment
                console.log(`Waiting for file-received acknowledgment for ${file.name}`);
                await this.waitForMessage('file-received', message => message.fileName === file.name);
                console.log(`File ${file.name} acknowledged as received by receiver.`);
            }

            // All files sent
            this.transferStatus = 'Transfer Complete!';
            this.transferDetails = `All ${totalFiles} files sent successfully`;
            console.log('All files sent successfully.');
            setTimeout(() => {
                this.showProgress = false;
                this.selectedFiles = [];
                toastr.success('Files sent successfully.', 'Transfer Complete');
            }, 2000);
        },

        getCompletedFilesSize(currentIndex) {
            return this.selectedFiles
                .slice(0, currentIndex)
                .reduce((acc, file) => acc + file.size, 0);
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
                    toastr.error('Failed to open data channel.', 'Connection Error');
                    return null;
                }
            } else {
                console.error('No data channel or open promise found for peer', peerId);
                toastr.error('No data channel found for peer.', 'Connection Error');
                return null;
            }
        },

        // Wait for specific message type
        waitForMessage(type, condition) {
            return new Promise(resolve => {
                this.messagePromises.set(type, { resolve, condition });
            });
        },

        // File receiving
        handleDataChannelMessage(message, peerId) {
            try {
                const parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;
                console.log(`Received message of type ${parsedMessage.type}:`, parsedMessage);

                // Check for pending promises
                const pending = this.messagePromises.get(parsedMessage.type);
                if (pending) {
                    if (!pending.condition || pending.condition(parsedMessage)) {
                        this.messagePromises.delete(parsedMessage.type);
                        pending.resolve(parsedMessage);
                        return;
                    }
                }

                switch (parsedMessage.type) {
                    case 'transfer-start':
                        this.initializeTransfer(parsedMessage);
                        break;
                    case 'file-metadata':
                        this.initializeFileReceiving(parsedMessage, peerId);
                        break;
                    case 'partition-end':
                        this.handlePartitionEnd(parsedMessage, peerId);
                        break;
                    case 'file-end':
                        this.finalizeFile(parsedMessage.name);
                        break;
                    default:
                        console.log('Unknown message type:', parsedMessage.type);
                }
            } catch (error) {
                console.error('Error handling data channel message:', error);
            }
        },

        initializeTransfer(metadata) {
            this.fileChunks.clear();
            this.receivedFiles = [];
            this.transferProgress = 0;
            this.currentFileIndex = 0;
            this.totalTransferSize = metadata.totalSize;
            this.totalTransferFiles = metadata.totalFiles;
            this.transferStatus = 'Preparing to receive files...';
            console.log(`Initialized transfer: ${metadata.totalFiles} files, ${metadata.totalSize} bytes`);
        },

        initializeFileReceiving(metadata, peerId) {
            try {
                const { file, fileNumber, totalFiles } = metadata;

                // Set up for new file
                this.currentReceivingFileName = file.name;
                this.fileChunks.set(file.name, {
                    chunks: [],
                    size: 0,
                    metadata: file,
                    isComplete: false,
                    expectedSize: file.size
                });

                this.transferStatus = `Receiving file ${fileNumber} of ${totalFiles}`;
                this.transferDetails = `${file.name} (${formatFileSize(file.size)})`;

                console.log(`Initialized receiving of file ${fileNumber}: ${file.name} (${file.size} bytes)`);

                // Send ready signal
                const channel = this.dataChannels.get(peerId);
                if (channel) {
                    channel.send(JSON.stringify({
                        type: 'ready-for-file',
                        fileName: file.name
                    }));
                    console.log(`Sent ready-for-file for ${file.name}`);
                }

            } catch (error) {
                console.error('Error initializing file receiving:', error);
                toastr.error('Failed to initialize file transfer', 'Transfer Error');
            }
        },

        handlePartitionEnd(message, peerId) {
            const { fileName, offset } = message;
            const fileData = this.fileChunks.get(fileName);

            if (!fileData) {
                console.error(`No file data found for ${fileName}`);
                return;
            }

            // Send acknowledgment to sender
            const channel = this.dataChannels.get(peerId);
            if (channel) {
                channel.send(JSON.stringify({
                    type: 'partition-received',
                    fileName: fileName,
                    offset: offset
                }));
                console.log(`Sent partition-received acknowledgment for offset ${offset} of ${fileName}`);
            } else {
                console.error('No data channel found for peer', peerId);
            }
        },

        finalizeFile(fileName) {
            try {
                const fileData = this.fileChunks.get(fileName);
                if (!fileData) {
                    console.error(`No file data found for ${fileName}`);
                    return;
                }

                // Verify size before creating blob
                const totalSize = fileData.size;
                if (totalSize !== fileData.expectedSize) {
                    console.warn(`Size mismatch for ${fileName}: expected ${fileData.expectedSize}, got ${totalSize}`);
                    // Wait for more data if necessary
                    return;
                }

                // Create blob
                const blob = new Blob(fileData.chunks, {
                    type: fileData.metadata.type || 'application/octet-stream'
                });

                // Final size check
                if (blob.size !== fileData.expectedSize) {
                    console.warn(`Blob size mismatch for ${fileName}: expected ${fileData.expectedSize}, got ${blob.size}`);
                }

                const url = URL.createObjectURL(blob);
                const completeFile = {
                    name: fileName,
                    size: fileData.size,
                    type: fileData.metadata.type,
                    preview: fileData.metadata.type?.startsWith('image/') ? url : null,
                    url: url,
                    blob: blob
                };

                this.receivedFiles.push(completeFile);
                fileData.isComplete = true;

                // Clean up chunks to free memory
                this.fileChunks.delete(fileName);

                // Send acknowledgment
                const channel = this.dataChannels.get(this.receivingDetails.peer.id);
                if (channel) {
                    channel.send(JSON.stringify({
                        type: 'file-received',
                        fileName: fileName
                    }));
                    console.log(`Sent file-received acknowledgment for ${fileName}`);
                }

                // Check if all files are complete
                if (this.receivedFiles.length === this.totalTransferFiles) {
                    this.transferStatus = 'Transfer Complete!';
                    this.transferDetails = 'All files received successfully';
                    console.log('All files received successfully.');

                    setTimeout(() => {
                        this.showProgress = false;
                        this.isReceivingFile = false;
                        this.showFilePreview = true;
                        toastr.success('Files received successfully.', 'Transfer Complete');
                    }, 1000);
                }

            } catch (error) {
                console.error(`Error finalizing file ${fileName}:`, error);
                toastr.error(`Failed to process file ${fileName}`, 'File Error');
            }
        },

        handleFileChunk(chunk, peerId) {
            try {
                // Check if we're in receiving state
                if (!this.isReceivingFile) {
                    console.warn('Received chunk but transfer not initialized');
                    return;
                }

                // Get current file data
                const fileData = this.fileChunks.get(this.currentReceivingFileName);
                if (!fileData) {
                    console.error('No file data found for:', this.currentReceivingFileName);
                    return;
                }

                // Process chunk
                fileData.chunks.push(chunk);
                fileData.size += chunk.byteLength;

                // Update progress
                const totalReceived = this.receivedFiles.reduce((acc, file) => acc + file.size, 0) + fileData.size;
                const totalSize = this.totalTransferSize;

                const fileProgress = Math.round((fileData.size / fileData.expectedSize) * 100);
                this.transferProgress = Math.round((totalReceived / totalSize) * 100);

                this.transferDetails = `File ${fileData.metadata.name}: ${fileProgress}% (${formatFileSize(fileData.size)} of ${formatFileSize(fileData.expectedSize)})`;
                this.transferStatus = `Overall Progress: ${this.transferProgress}%`;

                // Note: Do not finalize the file here; wait for 'file-end' message

            } catch (error) {
                console.error('Error handling file chunk:', error);
                toastr.error('Error processing file chunk', 'Transfer Error');
            }
        },

        resetTransferState() {
            this.isReceivingFile = false;
            this.currentReceivingFileName = null;
            this.fileChunks.clear();
            this.transferProgress = 0;
            this.transferStatus = '';
            this.transferDetails = '';
            this.fileQueue = [];
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
