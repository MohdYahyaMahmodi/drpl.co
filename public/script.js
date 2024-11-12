// Constants for file transfer
const CHUNK_SIZE = 64 * 1024; // 64 KB
const MAX_BUFFERED_AMOUNT = 16 * 1024 * 1024; // 16 MB

// Utility functions
function generateDeviceName() {
    const adjectives = ['Red', 'Blue', 'Green', 'Purple', 'Golden', 'Silver', 'Crystal', 'Cosmic', 'Electric', 'Mystic'];
    const nouns = ['Wolf', 'Eagle', 'Lion', 'Phoenix', 'Dragon', 'Tiger', 'Falcon', 'Panther', 'Hawk', 'Bear'];
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

// Main application data and logic
function appData() {
    return {
        // WebRTC and networking
        socket: null,
        peerId: null,
        peers: [],
        peerConnections: {},
        dataChannels: {},
        fileReceivers: {},

        // UI state
        deviceName: generateDeviceName(),
        deviceType: detectDeviceType(),
        selectedFiles: [],
        selectedPeer: null,
        showInfo: false,
        showAuthor: false,
        showFileTransfer: false,
        showProgress: false,
        isDragging: false,
        transferProgress: 0,
        transferStatus: '',
        transferDetails: '',
        isReceivingFile: false,
        receivedFiles: [],
        showIncomingRequest: false,
        receivingDetails: null,
        showFilePreview: false,
        currentFileIndex: 0,

        // Initialize the application
        init() {
            this.setupWebSocket();
            window.addEventListener('beforeunload', () => {
                this.cleanupConnections();
            });
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
            this.socket = io();

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
                delete this.peerConnections[peerId];
                delete this.dataChannels[peerId];
                this.peers = this.peers.filter(peer => peer.id !== peerId);
                toastr.error(`Peer ${peerId} disconnected`, 'Peer Disconnected');
            });
        },

        // WebRTC signaling
        async handleSignaling({ peerId, signal }) {
            let pc = this.peerConnections[peerId];

            if (!pc) {
                pc = this.createPeerConnection(peerId);
            }

            if (signal.type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(signal));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.socket.emit('signal', { target: peerId, signal: pc.localDescription });
            } else if (signal.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(signal));
            } else if (signal.candidate) {
                await pc.addIceCandidate(new RTCIceCandidate(signal));
            }
        },

        // WebRTC peer connection setup
        createPeerConnection(peerId) {
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
                this.setupDataChannel(peerId, event.channel);
            };

            pc.onconnectionstatechange = () => {
                console.log(`Connection state with ${peerId}: ${pc.connectionState}`);
                if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                    delete this.peerConnections[peerId];
                    delete this.dataChannels[peerId];
                    toastr.error(`Connection with peer ${peerId} closed`, 'Connection Closed');
                }
            };

            this.peerConnections[peerId] = pc;
            return pc;
        },

        // Data channel setup
        setupDataChannel(peerId, channel) {
            channel.binaryType = 'arraybuffer';
            this.dataChannels[peerId] = channel;

            channel.onopen = () => {
                console.log(`Data channel with ${peerId} is open`);
            };

            channel.onmessage = (event) => {
                this.handleDataChannelMessage(peerId, event.data);
            };

            channel.onclose = () => {
                console.log(`Data channel with ${peerId} is closed`);
            };

            channel.onerror = (error) => {
                console.error(`Data channel error with ${peerId}:`, error);
                toastr.error(`Data channel error with peer ${peerId}`, 'Data Channel Error');
            };
        },

        // Selecting a peer to send files
        async selectPeer(peer) {
            this.selectedPeer = peer;
            this.showFileTransfer = true;
            this.selectedFiles = [];

            if (!this.peerConnections[peer.id]) {
                const pc = this.createPeerConnection(peer.id);
                const channel = pc.createDataChannel('fileTransfer');
                this.setupDataChannel(peer.id, channel);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                this.socket.emit('signal', { target: peer.id, signal: pc.localDescription });
            }
        },

        // Handling file selection
        handleFileDrop(event) {
            event.preventDefault();
            this.isDragging = false;
            this.selectedFiles = Array.from(event.dataTransfer.files);
        },

        handleFileSelect(event) {
            this.selectedFiles = Array.from(event.target.files);
        },

        // Sending files
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
        },

        // Handling incoming file request
        handleIncomingRequest({ peerId, files }) {
            this.receivingDetails = {
                peerId,
                files
            };
            this.showIncomingRequest = true;
            toastr.info(`Incoming file request from ${peerId}`, 'File Request');
        },

        // Accepting the file transfer
        acceptTransfer() {
            this.showIncomingRequest = false;
            this.showProgress = true;
            this.transferStatus = 'Preparing to receive files...';

            this.socket.emit('file-response', {
                target: this.receivingDetails.peerId,
                accepted: true
            });

            // Initialize file receiver
            this.fileReceivers[this.receivingDetails.peerId] = {
                files: [],
                currentFile: null,
                totalFiles: this.receivingDetails.files.length,
                totalSize: this.receivingDetails.files.reduce((acc, file) => acc + file.size, 0),
                receivedSize: 0
            };
        },

        // Rejecting the file transfer
        rejectTransfer() {
            this.showIncomingRequest = false;
            this.socket.emit('file-response', {
                target: this.receivingDetails.peerId,
                accepted: false
            });
            toastr.info('File transfer rejected', 'Transfer Rejected');
        },

        // Handling file response from receiver
        async handleFileResponse({ accepted }) {
            if (accepted) {
                this.transferStatus = 'Recipient accepted. Starting transfer...';
                await this.startFileTransfer();
            } else {
                this.transferStatus = 'Recipient declined the transfer.';
                toastr.error('Recipient declined the file transfer.', 'Transfer Declined');
                setTimeout(() => {
                    this.showProgress = false;
                }, 2000);
            }
        },

        // Starting file transfer
        async startFileTransfer() {
            const peerId = this.selectedPeer.id;
            const channel = this.dataChannels[peerId];

            if (!channel || channel.readyState !== 'open') {
                this.transferStatus = 'Data channel is not open.';
                toastr.error('Data channel is not open.', 'Transfer Failed');
                return;
            }

            const totalFiles = this.selectedFiles.length;
            const totalSize = this.selectedFiles.reduce((acc, file) => acc + file.size, 0);

            let transferredSize = 0;

            for (let i = 0; i < totalFiles; i++) {
                const file = this.selectedFiles[i];
                this.transferStatus = `Sending file ${i + 1} of ${totalFiles}: ${file.name}`;
                this.transferDetails = '';

                // Send file metadata
                const metadata = {
                    type: 'file-metadata',
                    name: file.name,
                    size: file.size,
                    fileType: file.type
                };
                channel.send(JSON.stringify(metadata));

                await this.sendFileData(channel, file, (progress) => {
                    const totalProgress = ((transferredSize + (file.size * progress)) / totalSize) * 100;
                    this.transferProgress = totalProgress;
                });

                transferredSize += file.size;
            }

            this.transferStatus = 'Transfer Complete!';
            this.transferProgress = 100;
            toastr.success('Files sent successfully.', 'Transfer Complete');

            setTimeout(() => {
                this.showProgress = false;
            }, 2000);
        },

        // Sending file data with backpressure handling
        async sendFileData(channel, file, onProgress) {
            return new Promise(async (resolve) => {
                let offset = 0;
                const fileReader = new FileReader();

                fileReader.onerror = (error) => {
                    console.error('FileReader error:', error);
                    toastr.error('Error reading file.', 'Transfer Error');
                    resolve();
                };

                fileReader.onload = async (event) => {
                    const buffer = event.target.result;
                    let isReady = channel.bufferedAmount <= MAX_BUFFERED_AMOUNT;

                    if (!isReady) {
                        await new Promise(res => {
                            const checkBuffer = () => {
                                if (channel.bufferedAmount <= MAX_BUFFERED_AMOUNT) {
                                    res();
                                } else {
                                    setTimeout(checkBuffer, 100);
                                }
                            };
                            checkBuffer();
                        });
                    }

                    channel.send(buffer);
                    offset += buffer.byteLength;

                    const progress = offset / file.size;
                    onProgress(progress);

                    if (offset < file.size) {
                        readSlice(offset);
                    } else {
                        channel.send(JSON.stringify({ type: 'file-complete', name: file.name }));
                        resolve();
                    }
                };

                const readSlice = (o) => {
                    const slice = file.slice(o, o + CHUNK_SIZE);
                    fileReader.readAsArrayBuffer(slice);
                };

                readSlice(0);
            });
        },

        // Handling incoming messages on data channel
        async handleDataChannelMessage(peerId, data) {
            if (typeof data === 'string') {
                const message = JSON.parse(data);

                if (message.type === 'file-metadata') {
                    this.prepareReceiveFile(peerId, message);
                } else if (message.type === 'file-complete') {
                    this.finalizeReceivedFile(peerId, message.name);
                }
            } else {
                this.receiveFileChunk(peerId, data);
            }
        },

        // Preparing to receive a file
        prepareReceiveFile(peerId, metadata) {
            const receiver = this.fileReceivers[peerId];
            receiver.currentFile = {
                name: metadata.name,
                size: metadata.size,
                fileType: metadata.fileType,
                receivedChunks: [],
                receivedSize: 0
            };
        },

        // Receiving file chunks
        receiveFileChunk(peerId, chunk) {
            const receiver = this.fileReceivers[peerId];
            const file = receiver.currentFile;

            file.receivedChunks.push(chunk);
            file.receivedSize += chunk.byteLength;

            const progress = (file.receivedSize / file.size) * 100;
            const totalProgress = ((receiver.receivedSize + file.receivedSize) / receiver.totalSize) * 100;
            this.transferProgress = totalProgress;

            this.transferStatus = `Receiving: ${file.name}`;
            this.transferDetails = `Progress: ${progress.toFixed(2)}%`;

            if (file.receivedSize === file.size) {
                this.finalizeReceivedFile(peerId, file.name);
            }
        },

        // Finalizing received file
        finalizeReceivedFile(peerId, fileName) {
            const receiver = this.fileReceivers[peerId];
            const file = receiver.currentFile;

            const blob = new Blob(file.receivedChunks, { type: file.fileType });
            const url = URL.createObjectURL(blob);

            this.receivedFiles.push({
                name: file.name,
                size: file.size,
                type: file.fileType,
                url,
                blob,
                preview: file.fileType.startsWith('image/') ? url : null
            });

            receiver.files.push(file);
            receiver.receivedSize += file.size;
            receiver.currentFile = null;

            if (receiver.files.length === receiver.totalFiles) {
                this.transferStatus = 'All files received';
                toastr.success('All files received successfully', 'Transfer Complete');
                this.showProgress = false;
                this.showFilePreview = true;
            }
        },

        // Cleaning up connections
        cleanupConnections() {
            for (const peerId in this.peerConnections) {
                this.peerConnections[peerId].close();
            }
            this.peerConnections = {};
            this.dataChannels = {};
            if (this.socket) {
                this.socket.disconnect();
            }
        },

        // Utility methods
        formatFileSize,
        getCurrentFile() {
            return this.receivedFiles[this.currentFileIndex] || {};
        },
        isImageFile(file) {
            return file?.type?.startsWith('image/');
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
            const a = document.createElement('a');
            a.href = file.url;
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        },
        async downloadAllFilesAsZip() {
            const zip = new JSZip();
            for (const file of this.receivedFiles) {
                zip.file(file.name, file.blob);
            }
            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'files.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };
}
