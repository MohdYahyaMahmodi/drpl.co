// Word lists for generating device names
const adjectives = ['Red', 'Blue', 'Green', 'Purple', 'Golden', 'Silver', 'Crystal', 'Cosmic', 'Electric', 'Mystic'];
const nouns = ['Wolf', 'Eagle', 'Lion', 'Phoenix', 'Dragon', 'Tiger', 'Falcon', 'Panther', 'Hawk', 'Bear'];

// Constants for file transfer
const CHUNK_SIZE = 16 * 1024; // 16 KB chunks for better handling
const MAX_BUFFER_SIZE = 1024 * 1024; // 1 MB buffer threshold
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second delay between retries

const CHUNK_SEQUENCE = new Map(); // To track chunk sequences

// Utility functions
function generateDeviceName() {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj} ${noun}`;
}

function calculateTotalSize(chunks) {
    return chunks.reduce((total, chunk) => total + (chunk.byteLength || chunk.size || 0), 0);
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

// Helper function for sending file chunks with buffer management
async function sendFileChunk(channel, chunk, sequenceNumber = null) {
    return new Promise((resolve, reject) => {
        const sendChunk = () => {
            try {
                if (channel.bufferedAmount > MAX_BUFFER_SIZE) {
                    setTimeout(sendChunk, 100);
                    return;
                }

                // If it's a binary chunk, wrap it with metadata
                if (chunk instanceof ArrayBuffer) {
                    const metadata = {
                        sequence: sequenceNumber,
                        size: chunk.byteLength,
                        isLast: false
                    };
                    
                    // Send metadata first
                    channel.send(JSON.stringify({ type: 'chunk-metadata', ...metadata }));
                    // Then send the actual chunk
                    channel.send(chunk);
                } else {
                    channel.send(chunk);
                }
                resolve();
            } catch (error) {
                if (retryCount < MAX_RETRIES) {
                    setTimeout(() => {
                        sendFileChunk(channel, chunk, sequenceNumber)
                            .then(resolve)
                            .catch(reject);
                    }, RETRY_DELAY);
                } else {
                    reject(new Error(`Failed to send chunk after ${MAX_RETRIES} attempts`));
                }
            }
        };

        sendChunk();
    });
}

// Helper function to verify file integrity
function verifyFileIntegrity(chunks, expectedSize, fileName) {
    const totalSize = calculateTotalSize(chunks);
    console.log(`File ${fileName} verification:`, {
        actualSize: totalSize,
        expectedSize: expectedSize,
        difference: Math.abs(totalSize - expectedSize),
        chunksCount: chunks.length
    });
    // Allow for small differences (within 1KB) due to potential byte counting variations
    return Math.abs(totalSize - expectedSize) <= 1024;
}

// Main application data and logic
function appData() {
    return {
        // WebRTC and networking
        socket: null,
        peerId: null,
        peerConnections: new Map(),
        dataChannels: new Map(),
        dataChannelPromises: new Map(),
        fileChunks: new Map(),
        messagePromises: new Map(),
        transferAborted: false,

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
        retryQueue: new Map(),
        fileSequences: new Map(),

        // Initialize the application
        init() {
            this.setupWebSocket();
            window.addEventListener('resize', () => {
                this.deviceType = detectDeviceType();
            });

            // Handle page unload
            window.addEventListener('beforeunload', (event) => {
                if (this.isReceivingFile || this.showProgress) {
                    event.preventDefault();
                    event.returnValue = '';
                }
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
            const socketProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            const socketUrl = `${socketProtocol}://${window.location.hostname}:${window.location.port}`;

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

            this.socket.on('peer-disconnected', (peerId) => {
                const disconnectedPeer = this.peers.find(p => p.id === peerId);
                this.peers = this.peers.filter(peer => peer.id !== peerId);
                if (this.isReceivingFile && this.receivingDetails?.peer?.id === peerId) {
                    this.handleTransferError(new Error('Peer disconnected during transfer'));
                }
                console.log('Peer disconnected:', disconnectedPeer ? disconnectedPeer.name : peerId);
                toastr.error(`Peer ${disconnectedPeer ? disconnectedPeer.name : peerId} disconnected.`, 'Peer Disconnected');
            });
        },

        // WebRTC signaling and connection handling
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
                this.handleTransferError(error);
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
                if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
                    this.peerConnections.delete(peerId);
                    if (this.isReceivingFile || this.showProgress) {
                        this.handleTransferError(new Error('Connection lost'));
                    }
                }
            };

            this.peerConnections.set(peerId, pc);
            return pc;
        },

        setupDataChannel(channel, peerId) {
            channel.binaryType = 'arraybuffer';
            channel.bufferedAmountLowThreshold = MAX_BUFFER_SIZE;

            const openPromise = new Promise((resolve, reject) => {
                channel.addEventListener('open', () => {
                    console.log(`Data channel opened with peer ${this.getPeerName(peerId)}`);
                    this.dataChannels.set(peerId, channel);
                    resolve(channel);
                });

                channel.addEventListener('error', (error) => {
                    console.error(`Data channel error with peer ${this.getPeerName(peerId)}:`, error);
                    toastr.error('Connection error occurred.', 'Data Channel Error');
                    reject(error);
                });

                // Set timeout for connection
                setTimeout(() => {
                    reject(new Error('Data channel connection timeout'));
                }, 30000); // 30 second timeout
            });

            this.dataChannelPromises.set(peerId, openPromise);

            channel.addEventListener('close', () => {
                console.log(`Data channel closed with peer ${this.getPeerName(peerId)}`);
                this.dataChannels.delete(peerId);
                this.dataChannelPromises.delete(peerId);
                if (this.isReceivingFile || this.showProgress) {
                    this.handleTransferError(new Error('Connection closed'));
                }
            });

            channel.addEventListener('message', async (event) => {
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
            });

            return channel;
        },

        // File transfer initialization
        async selectPeer(peer) {
            this.selectedPeer = peer;
            this.showFileTransfer = true;
            this.selectedFiles = [];
            this.transferAborted = false;

            if (!this.peerConnections.has(peer.id)) {
                try {
                    const pc = await this.createPeerConnection(peer.id);
                    const channel = pc.createDataChannel('fileTransfer', {
                        ordered: true,
                        maxRetransmits: MAX_RETRIES
                    });
                    await this.setupDataChannel(channel, peer.id);

                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    this.socket.emit('signal', {
                        target: peer.id,
                        signal: pc.localDescription
                    });
                } catch (error) {
                    console.error('Error setting up peer connection:', error);
                    this.showFileTransfer = false;
                    toastr.error('Failed to establish connection.', 'Connection Error');
                }
            }
        },

        handleFileDrop(event) {
            event.preventDefault();
            this.isDragging = false;
            this.selectedFiles = Array.from(event.dataTransfer.files);
        },

        handleFileSelect(event) {
            this.selectedFiles = Array.from(event.target.files);
        },

        // File transfer error handling
        handleTransferError(error) {
            console.error('Transfer error:', error);
            this.transferAborted = true;
            this.isReceivingFile = false;
            this.showProgress = false;
            this.fileChunks.clear();
            toastr.error('File transfer failed. Please try again.', 'Transfer Error');
        },

        // Send file request
        async sendFiles() {
            if (this.selectedFiles.length === 0 || !this.selectedPeer) return;

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
            this.transferAborted = false;
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

        // Handle file transfer response
        async handleFileResponse(data) {
            if (data.accepted) {
                console.log('Recipient accepted the file transfer');
                this.transferStatus = 'Recipient accepted. Preparing to send files...';
                await this.startFileTransfer();
            } else {
                console.log('Recipient declined the file transfer');
                this.transferStatus = 'Recipient declined the transfer.';
                this.transferAborted = true;
                toastr.error('Recipient declined the file transfer.', 'Transfer Declined');
                setTimeout(() => {
                    this.showProgress = false;
                }, 2000);
            }
        },

        // File transfer acceptance/rejection
        acceptTransfer() {
            this.showIncomingRequest = false;
            if (!this.peerConnections.has(this.receivingDetails.peer.id)) {
                console.log('No peer connection found, cannot accept transfer.');
                toastr.error('Connection not found.', 'Error');
                return;
            }

            this.showProgress = true;
            this.transferStatus = 'Receiving Files...';
            this.transferProgress = 0;
            this.transferAborted = false;

            this.socket.emit('file-response', {
                target: this.receivingDetails.peer.id,
                accepted: true
            });

            toastr.success('Accepted file transfer request.', 'Transfer Accepted');
        },

        rejectTransfer() {
            this.showIncomingRequest = false;
            this.isReceivingFile = false;
            this.transferAborted = true;

            this.socket.emit('file-response', {
                target: this.receivingDetails.peer.id,
                accepted: false
            });

            toastr.info('Rejected file transfer request.', 'Transfer Rejected');
        },

        // Core file transfer logic
        async startFileTransfer() {
            const peerId = this.selectedPeer.id;
            const channel = await this.waitForDataChannel(peerId);
            
            if (!channel || this.transferAborted) {
                console.error('Data channel is not open or transfer aborted');
                this.handleTransferError(new Error('Connection not available'));
                return;
            }

            try {
                const totalFiles = this.selectedFiles.length;
                const totalSize = this.selectedFiles.reduce((acc, file) => acc + file.size, 0);

                console.log(`Starting file transfer to ${this.getPeerName(peerId)}. Files: ${totalFiles}, Size: ${totalSize}`);

                // Send transfer metadata
                await sendFileChunk(channel, JSON.stringify({
                    type: 'transfer-start',
                    totalFiles: totalFiles,
                    totalSize: totalSize
                }));

                // Process files sequentially
                for (let i = 0; i < this.selectedFiles.length; i++) {
                    if (this.transferAborted) break;

                    const file = this.selectedFiles[i];
                    const fileNumber = i + 1;
                    console.log(`Sending file ${fileNumber}/${totalFiles}: ${file.name} (${file.size} bytes)`);

                    // Update status
                    this.transferStatus = `Sending file ${fileNumber} of ${totalFiles}`;
                    this.transferDetails = `${file.name} (${formatFileSize(file.size)})`;

                    // Send file metadata
                    await sendFileChunk(channel, JSON.stringify({
                        type: 'file-metadata',
                        file: {
                            name: file.name,
                            size: file.size,
                            type: file.type
                        },
                        fileNumber: fileNumber,
                        totalFiles: totalFiles
                    }));

                    // Wait for receiver ready signal
                    await this.waitForMessage('ready-for-file', message => message.fileName === file.name);

                    // Send file chunks
                    let offset = 0;
                    let retryCount = 0;
                    let sequence = 0;
                    while (offset < file.size && !this.transferAborted) {
                        try {
                            const chunkSize = Math.min(CHUNK_SIZE, file.size - offset);
                            const chunk = file.slice(offset, offset + chunkSize);
                            const buffer = await chunk.arrayBuffer();
                    
                            // Send chunk with sequence number
                            await sendFileChunk(channel, buffer, sequence);
                            offset += buffer.byteLength;
                    
                            // Update progress
                            const fileProgress = Math.round((offset / file.size) * 100);
                            const totalProgress = Math.round((offset + this.getCompletedFilesSize(i)) / totalSize * 100);
                            
                            this.transferProgress = totalProgress;
                            this.transferDetails = `File ${fileNumber}/${totalFiles}: ${file.name} - ${fileProgress}%`;
                    
                            sequence++;
                            retryCount = 0;
                        } catch (error) {
                            console.error(`Error sending chunk at offset ${offset}:`, error);
                            
                            if (retryCount >= MAX_RETRIES) {
                                throw new Error(`Failed to send file chunk after ${MAX_RETRIES} attempts`);
                            }
                    
                            retryCount++;
                            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                            continue;
                        }
                    }

                    if (this.transferAborted) break;

                    // Send file completion marker
                    await sendFileChunk(channel, JSON.stringify({
                        type: 'file-end',
                        name: file.name,
                        fileNumber: fileNumber,
                        totalFiles: totalFiles
                    }));

                    // Wait for completion acknowledgment
                    await this.waitForMessage('file-received', message => message.fileName === file.name);
                }

                if (!this.transferAborted) {
                    // Transfer complete
                    this.transferStatus = 'Transfer Complete!';
                    this.transferDetails = `All ${totalFiles} files sent successfully`;
                    console.log('File transfer completed successfully');
                    
                    setTimeout(() => {
                        this.showProgress = false;
                        this.selectedFiles = [];
                        toastr.success('Files sent successfully.', 'Transfer Complete');
                    }, 2000);
                }

            } catch (error) {
                console.error('File transfer error:', error);
                this.handleTransferError(error);
            }
        },

        // Handle incoming file chunks
        async handleFileChunk(chunk, peerId) {
            try {
                if (!this.isReceivingFile || this.transferAborted) {
                    console.warn('Received chunk but transfer not active');
                    return;
                }
        
                const fileData = this.fileChunks.get(this.currentReceivingFileName);
                if (!fileData) {
                    console.error('No file data found for:', this.currentReceivingFileName);
                    return;
                }
        
                // Track sequence for this file
                if (!this.fileSequences.has(this.currentReceivingFileName)) {
                    this.fileSequences.set(this.currentReceivingFileName, {
                        expectedSequence: 0,
                        chunks: new Map()
                    });
                }
        
                const sequenceData = this.fileSequences.get(this.currentReceivingFileName);
        
                // If this is metadata for the next chunk
                if (typeof chunk === 'string') {
                    try {
                        const metadata = JSON.parse(chunk);
                        if (metadata.type === 'chunk-metadata') {
                            sequenceData.expectedMetadata = metadata;
                            return;
                        }
                    } catch (e) {
                        // Not JSON metadata, continue processing as chunk
                    }
                }
        
                // If we have metadata for this chunk
                if (sequenceData.expectedMetadata) {
                    const metadata = sequenceData.expectedMetadata;
                    
                    // Verify chunk size
                    if (chunk.byteLength !== metadata.size) {
                        throw new Error(`Chunk size mismatch: expected ${metadata.size}, got ${chunk.byteLength}`);
                    }
        
                    // Store chunk with sequence number
                    fileData.chunks[metadata.sequence] = chunk;
                    fileData.size += chunk.byteLength;
        
                    sequenceData.expectedMetadata = null;
                } else {
                    // Fallback for chunks without metadata
                    fileData.chunks.push(chunk);
                    fileData.size += chunk.byteLength;
                }
        
                // Update progress
                const totalReceived = this.receivedFiles.reduce((acc, file) => acc + file.size, 0) + fileData.size;
                const totalSize = this.totalTransferSize;
        
                const fileProgress = Math.round((fileData.size / fileData.expectedSize) * 100);
                this.transferProgress = Math.round((totalReceived / totalSize) * 100);
        
                this.transferDetails = `${fileData.metadata.name}: ${fileProgress}% (${formatFileSize(fileData.size)} of ${formatFileSize(fileData.expectedSize)})`;
                this.transferStatus = `Overall Progress: ${this.transferProgress}%`;
        
                // Check if we have all chunks
                if (fileData.size === fileData.expectedSize) {
                    // Sort chunks by sequence number if available
                    if (fileData.chunks instanceof Map) {
                        fileData.chunks = Array.from(fileData.chunks.values());
                    }
                    await this.finalizeFile(this.currentReceivingFileName);
                }
        
            } catch (error) {
                console.error('Error handling file chunk:', error);
                this.handleTransferError(error);
            }
        },

        // File completion handling
        async finalizeFile(fileName) {
            try {
                const fileData = this.fileChunks.get(fileName);
                if (!fileData || this.transferAborted) return;

                // Initialize retry mechanism
                let retryCount = 0;
                const maxRetries = 3;
                const retryDelay = 1000; // 1 second between retries
                let success = false;

                while (retryCount < maxRetries && !success) {
                    try {
                        // Verify final size with logging
                        const totalSize = calculateTotalSize(fileData.chunks);
                        console.log(`Attempt ${retryCount + 1} - Finalizing file ${fileName}:`, {
                            receivedSize: totalSize,
                            expectedSize: fileData.expectedSize,
                            chunksCount: fileData.chunks.length,
                            difference: Math.abs(totalSize - fileData.expectedSize)
                        });

                        // Allow for small size differences (up to one chunk size)
                        const sizeDifference = Math.abs(totalSize - fileData.expectedSize);
                        if (sizeDifference > CHUNK_SIZE) {
                            if (retryCount < maxRetries - 1) {
                                console.log(`Size difference too large (${sizeDifference} bytes), retrying...`);
                                retryCount++;
                                await new Promise(resolve => setTimeout(resolve, retryDelay));
                                continue;
                            } else {
                                throw new Error(`Size mismatch for ${fileName}: expected ${fileData.expectedSize}, got ${totalSize}`);
                            }
                        }

                        // Organize chunks if they're stored with sequence numbers
                        let finalChunks = fileData.chunks;
                        if (fileData.chunks instanceof Map) {
                            finalChunks = Array.from(fileData.chunks.values());
                        }

                        // Create blob with explicit type
                        const blob = new Blob(finalChunks, {
                            type: fileData.metadata.type || 'application/octet-stream'
                        });

                        // Verify blob size
                        console.log(`Blob created for ${fileName}:`, {
                            blobSize: blob.size,
                            expectedSize: fileData.expectedSize,
                            type: fileData.metadata.type,
                            difference: Math.abs(blob.size - fileData.expectedSize)
                        });

                        if (Math.abs(blob.size - fileData.expectedSize) > CHUNK_SIZE) {
                            if (retryCount < maxRetries - 1) {
                                console.log(`Blob size mismatch (${blob.size} vs ${fileData.expectedSize}), retrying...`);
                                retryCount++;
                                await new Promise(resolve => setTimeout(resolve, retryDelay));
                                continue;
                            } else {
                                throw new Error(`Blob size mismatch for ${fileName}: expected ${fileData.expectedSize}, got ${blob.size}`);
                            }
                        }

                        // Create the file object
                        const url = URL.createObjectURL(blob);
                        const completeFile = {
                            name: fileName,
                            size: blob.size,
                            type: fileData.metadata.type,
                            preview: fileData.metadata.type?.startsWith('image/') ? url : null,
                            url: url,
                            blob: blob
                        };

                        // Add to received files
                        this.receivedFiles.push(completeFile);
                        this.currentFileIndex = this.receivedFiles.length - 1;
                        fileData.isComplete = true;

                        // Clean up chunks and sequence data
                        this.fileChunks.delete(fileName);
                        this.fileSequences?.delete(fileName);

                        // Send acknowledgment with retry
                        const channel = this.dataChannels.get(this.receivingDetails.peer.id);
                        if (channel) {
                            let ackSent = false;
                            let ackRetries = 0;
                            const maxAckRetries = 3;

                            while (!ackSent && ackRetries < maxAckRetries) {
                                try {
                                    await sendFileChunk(channel, JSON.stringify({
                                        type: 'file-received',
                                        fileName: fileName,
                                        size: blob.size,
                                        status: 'success'
                                    }));
                                    ackSent = true;
                                } catch (error) {
                                    console.warn(`Failed to send acknowledgment, attempt ${ackRetries + 1}/${maxAckRetries}`);
                                    ackRetries++;
                                    if (ackRetries < maxAckRetries) {
                                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                                    }
                                }
                            }

                            if (!ackSent) {
                                console.error('Failed to send file acknowledgment after all retries');
                            }
                        }

                        // All verifications passed
                        success = true;

                        // Check if all files are complete
                        if (this.receivedFiles.length === this.totalTransferFiles) {
                            console.log('All files processed successfully:', {
                                receivedCount: this.receivedFiles.length,
                                totalExpected: this.totalTransferFiles
                            });

                            this.transferStatus = 'Transfer Complete!';
                            this.transferDetails = 'All files received successfully';

                            setTimeout(() => {
                                this.showProgress = false;
                                this.isReceivingFile = false;
                                this.showFilePreview = true;
                                toastr.success('Files received successfully.', 'Transfer Complete');
                            }, 1000);
                        }

                    } catch (retryError) {
                        console.warn(`Attempt ${retryCount + 1} failed:`, retryError);
                        if (retryCount < maxRetries - 1) {
                            retryCount++;
                            await new Promise(resolve => setTimeout(resolve, retryDelay));
                        } else {
                            throw retryError;
                        }
                    }
                }

            } catch (error) {
                console.error(`Error finalizing file ${fileName}:`, error);
                this.handleTransferError(error);

                // Try to notify sender of failure
                try {
                    const channel = this.dataChannels.get(this.receivingDetails.peer.id);
                    if (channel) {
                        await sendFileChunk(channel, JSON.stringify({
                            type: 'file-received',
                            fileName: fileName,
                            status: 'error',
                            error: error.message
                        }));
                    }
                } catch (notifyError) {
                    console.error('Failed to notify sender of error:', notifyError);
                }
            }
        },

        // Data channel message handling
        async handleDataChannelMessage(message, peerId) {
            try {
                console.log(`Received message type ${message.type}:`, message);

                // Check for pending promises
                const pending = this.messagePromises.get(message.type);
                if (pending) {
                    if (!pending.condition || pending.condition(message)) {
                        this.messagePromises.delete(message.type);
                        pending.resolve(message);
                        return;
                    }
                }

                // Handle different message types
                switch (message.type) {
                    case 'transfer-start':
                        await this.initializeTransfer(message);
                        break;
                    case 'file-metadata':
                        await this.initializeFileReceiving(message, peerId);
                        break;
                    case 'file-end':
                        await this.finalizeFile(message.name);
                        break;
                    default:
                        console.log('Unknown message type:', message.type);
                }
            } catch (error) {
                console.error('Error handling data channel message:', error);
                this.handleTransferError(error);
            }
        },

        // Transfer initialization
        async initializeTransfer(metadata) {
            this.fileChunks.clear();
            this.receivedFiles = [];
            this.transferProgress = 0;
            this.currentFileIndex = 0;
            this.totalTransferSize = metadata.totalSize;
            this.totalTransferFiles = metadata.totalFiles;
            this.transferStatus = 'Preparing to receive files...';
            console.log(`Initialized transfer: ${metadata.totalFiles} files, ${metadata.totalSize} bytes`);
        },

        async initializeFileReceiving(metadata, peerId) {
            try {
                const { file, fileNumber, totalFiles } = metadata;

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

                console.log(`Initialized receiving file ${fileNumber}: ${file.name} (${file.size} bytes)`);

                // Send ready signal
                const channel = this.dataChannels.get(peerId);
                if (channel) {
                    await sendFileChunk(channel, JSON.stringify({
                        type: 'ready-for-file',
                        fileName: file.name
                    }));
                }

            } catch (error) {
                console.error('Error initializing file receiving:', error);
                this.handleTransferError(error);
            }
        },

        // Helper methods
        async waitForDataChannel(peerId) {
            let channel = this.dataChannels.get(peerId);
            if (channel?.readyState === 'open') return channel;

            const openPromise = this.dataChannelPromises.get(peerId);
            if (!openPromise) {
                console.error('No data channel promise found');
                return null;
            }

            try {
                await openPromise;
                return this.dataChannels.get(peerId);
            } catch (error) {
                console.error('Failed to open data channel:', error);
                return null;
            }
        },

        waitForMessage(type, condition) {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.messagePromises.delete(type);
                    reject(new Error(`Timeout waiting for message type: ${type}`));
                }, 30000);

                this.messagePromises.set(type, {
                    resolve: (message) => {
                        clearTimeout(timeout);
                        resolve(message);
                    },
                    condition: condition
                });
            });
        },

        getCompletedFilesSize(currentIndex) {
            return this.selectedFiles
                .slice(0, currentIndex)
                .reduce((acc, file) => acc + file.size, 0);
        },

        // UI helper methods
        getCurrentFile() {
            if (!this.receivedFiles || this.receivedFiles.length === 0) {
                return null;
            }
            return this.receivedFiles[this.currentFileIndex] || this.receivedFiles[0];
        },
        
        isImageFile(file) {
            if (!file) return false;
            return file.type?.startsWith('image/') || false;
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
            return this.receivedFiles && this.receivedFiles.length > 0;
        },
        
        getFileCount() {
            return this.receivedFiles?.length || 0;
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
            if (type.includes('powerpoint')) return 'fas fa-file-powerpoint';
            return 'fas fa-file';
        },

        getPeerName(peerId) {
            const peer = this.peers.find(p => p.id === peerId);
            return peer ? peer.name : peerId;
        },

        // Cleanup
        cleanupConnections() {
            this.dataChannels.forEach(channel => channel.close());
            this.dataChannels.clear();
            
            this.peerConnections.forEach(pc => pc.close());
            this.peerConnections.clear();
            
            this.fileChunks.clear();
            this.receivedFiles.forEach(file => {
                if (file.url) URL.revokeObjectURL(file.url);
            });
            
            if (this.socket) this.socket.close();
        }
    };
}