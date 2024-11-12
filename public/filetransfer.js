// filetransfer.js

const CHUNK_SIZE = 64 * 1024; // 64 KB
const MAX_BUFFERED_AMOUNT = 16 * 1024 * 1024; // 16 MB

const fileTransfer = {
    app: null,
    socket: null,
    peerId: null,
    peerConnections: {},
    dataChannels: {},
    fileReceivers: {},

    init(appInstance) {
        this.app = appInstance;
        this.setupWebSocket();
    },

    setupWebSocket() {
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connected to signaling server');
            this.socket.emit('register', {
                deviceName: this.app.deviceName,
                deviceType: this.app.deviceType
            });
        });

        this.socket.on('registered', ({ peerId }) => {
            this.peerId = peerId;
            this.socket.emit('discover');
        });

        this.socket.on('peers', (peerList) => {
            this.app.peers = peerList.filter(peer => peer.id !== this.peerId);
            console.log('Updated peers:', this.app.peers);
        });

        this.socket.on('signal', this.handleSignaling.bind(this));
        this.socket.on('file-request', this.handleIncomingRequest.bind(this));
        this.socket.on('file-response', this.handleFileResponse.bind(this));

        this.socket.on('peer-disconnected', (peerId) => {
            delete this.peerConnections[peerId];
            delete this.dataChannels[peerId];
            this.app.peers = this.app.peers.filter(peer => peer.id !== peerId);
            toastr.error(`Peer ${peerId} disconnected`, 'Peer Disconnected');
        });
    },

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
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
                delete this.peerConnections[peerId];
                delete this.dataChannels[peerId];
                toastr.error(`Connection with peer ${peerId} closed`, 'Connection Closed');
            }
        };

        this.peerConnections[peerId] = pc;
        return pc;
    },

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

    connectToPeer(peer) {
        if (!this.peerConnections[peer.id]) {
            const pc = this.createPeerConnection(peer.id);
            const channel = pc.createDataChannel('fileTransfer');
            this.setupDataChannel(peer.id, channel);
            pc.createOffer().then(offer => {
                pc.setLocalDescription(offer).then(() => {
                    this.socket.emit('signal', { target: peer.id, signal: pc.localDescription });
                });
            });
        }
    },

    sendFiles(files, selectedPeer) {
        this.socket.emit('file-request', {
            target: selectedPeer.id,
            files: files.map(file => ({
                name: file.name,
                size: file.size,
                type: file.type
            }))
        });
    },

    handleIncomingRequest({ peerId, files }) {
        const totalSize = files.reduce((acc, file) => acc + file.size, 0);
        this.app.receivingDetails = {
            peerId,
            files,
            fileCount: files.length,
            totalSize: totalSize
        };
        this.app.showIncomingRequest = true;
        toastr.info(`Incoming file request from ${peerId}`, 'File Request');
    },

    acceptTransfer() {
        const peerId = this.app.receivingDetails.peerId;
        this.socket.emit('file-response', {
            target: peerId,
            accepted: true
        });

        // Initialize file receiver
        this.fileReceivers[peerId] = {
            files: [],
            currentFile: null,
            totalFiles: this.app.receivingDetails.fileCount,
            totalSize: this.app.receivingDetails.totalSize,
            receivedSize: 0
        };
    },

    rejectTransfer() {
        const peerId = this.app.receivingDetails.peerId;
        this.socket.emit('file-response', {
            target: peerId,
            accepted: false
        });
    },

    async handleFileResponse({ accepted }) {
        if (accepted) {
            this.app.transferStatus = 'Recipient accepted. Starting transfer...';
            await this.startFileTransfer();
        } else {
            this.app.transferStatus = 'Recipient declined the transfer.';
            toastr.error('Recipient declined the file transfer.', 'Transfer Declined');
            setTimeout(() => {
                this.app.showProgress = false;
            }, 2000);
        }
    },

    async startFileTransfer() {
        const peerId = this.app.selectedPeer.id;
        const channel = this.dataChannels[peerId];

        if (!channel || channel.readyState !== 'open') {
            this.app.transferStatus = 'Data channel is not open.';
            toastr.error('Data channel is not open.', 'Transfer Failed');
            return;
        }

        const totalFiles = this.app.selectedFiles.length;
        const totalSize = this.app.selectedFiles.reduce((acc, file) => acc + file.size, 0);

        let transferredSize = 0;

        for (let i = 0; i < totalFiles; i++) {
            const file = this.app.selectedFiles[i];
            this.app.transferStatus = `Sending file ${i + 1} of ${totalFiles}: ${file.name}`;
            this.app.transferDetails = '';

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
                this.app.transferProgress = totalProgress;
            });

            transferredSize += file.size;
        }

        this.app.transferStatus = 'Transfer Complete!';
        this.app.transferProgress = 100;
        toastr.success('Files sent successfully.', 'Transfer Complete');

        setTimeout(() => {
            this.app.showProgress = false;
        }, 2000);
    },

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

    receiveFileChunk(peerId, chunk) {
        const receiver = this.fileReceivers[peerId];
        const file = receiver.currentFile;

        file.receivedChunks.push(chunk);
        file.receivedSize += chunk.byteLength;

        const progress = (file.receivedSize / file.size) * 100;
        const totalProgress = ((receiver.receivedSize + file.receivedSize) / receiver.totalSize) * 100;
        this.app.transferProgress = totalProgress;

        this.app.transferStatus = `Receiving: ${file.name}`;
        this.app.transferDetails = `Progress: ${progress.toFixed(2)}%`;

        if (file.receivedSize === file.size) {
            this.finalizeReceivedFile(peerId, file.name);
        }
    },

    finalizeReceivedFile(peerId, fileName) {
        const receiver = this.fileReceivers[peerId];
        const file = receiver.currentFile;

        const blob = new Blob(file.receivedChunks, { type: file.fileType });
        const url = URL.createObjectURL(blob);

        this.app.receivedFiles.push({
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
            this.app.transferStatus = 'All files received';
            toastr.success('All files received successfully', 'Transfer Complete');
            this.app.showProgress = false;
            this.app.showFilePreview = true;
        }
    },

    cleanupConnections() {
        for (const peerId in this.peerConnections) {
            this.peerConnections[peerId].close();
        }
        this.peerConnections = {};
        this.dataChannels = {};
        if (this.socket) {
            this.socket.disconnect();
        }
    }
};
