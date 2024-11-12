// filetransfer.js

// Constants
const CHUNK_SIZE = 16 * 1024; // 16KB chunks - smaller for better flow control
const MAX_BUFFER_SIZE = 1 * 1024 * 1024; // 1MB buffer limit
const PARTITION_SIZE = 1 * 1024 * 1024; // 1 MB

// Utility functions
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// FileTransfer module
var FileTransfer = (function() {
    // Private variables
    var socket = null;
    var peerId = null;
    var peerConnections = new Map();
    var dataChannels = new Map();
    var dataChannelPromises = new Map();
    var fileChunks = new Map();
    var messagePromises = new Map();

    // State variables
    var selectedFiles = [];
    var selectedPeer = null;
    var transferProgress = 0;
    var transferStatus = '';
    var transferDetails = '';
    var isReceivingFile = false;
    var receivingDetails = null;
    var currentFileIndex = 0;
    var receivedFiles = [];
    var currentReceivingFileName = null;
    var totalTransferSize = 0;
    var totalTransferFiles = 0;

    // Event emitter
    var eventListeners = {};

    function on(event, listener) {
        if (!eventListeners[event]) {
            eventListeners[event] = [];
        }
        eventListeners[event].push(listener);
    }

    function emit(event, data) {
        if (eventListeners[event]) {
            eventListeners[event].forEach(function(listener) {
                listener(data);
            });
        }
    }

    // Setup WebSocket connection
    function setupWebSocket(deviceName, deviceType) {
        // Use the current window location to determine the socket URL
        const socketProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const socketUrl = `${socketProtocol}://${window.location.hostname}:${window.location.port}`;

        // Initialize the socket connection
        socket = io(socketUrl, {
            path: '/socket.io',
            transports: ['websocket'],
            secure: socketProtocol === 'wss',
        });

        socket.on('connect', () => {
            console.log('Connected to signaling server');
            socket.emit('register', {
                deviceName: deviceName,
                deviceType: deviceType
            });
        });

        socket.on('registered', ({ peerId: id }) => {
            peerId = id;
            socket.emit('discover');
            emit('registered', { peerId });
        });

        socket.on('peers', (peerList) => {
            const peers = peerList.filter(peer => peer.id !== peerId);
            console.log('Updated peers:', peers);
            emit('peers', peers);
        });

        socket.on('signal', handleSignaling);
        socket.on('file-request', handleIncomingRequest);
        socket.on('file-response', handleFileResponse);

        // Handle peer disconnection
        socket.on('peer-disconnected', (disconnectedPeerId) => {
            console.log('Peer disconnected:', disconnectedPeerId);
            emit('peer-disconnected', disconnectedPeerId);
        });
    }

    // Handle signaling messages
    async function handleSignaling({ peer, signal }) {
        try {
            if (!peerConnections.has(peer)) {
                await createPeerConnection(peer);
            }

            const pc = peerConnections.get(peer);

            if (signal.type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(signal));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit('signal', { target: peer, signal: pc.localDescription });
            } else if (signal.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(signal));
            } else if (signal.candidate) {
                await pc.addIceCandidate(new RTCIceCandidate(signal));
            }
        } catch (error) {
            console.error('Signaling error:', error);
            emit('error', { message: 'Signaling error', error });
        }
    }

    // Create a new peer connection
    async function createPeerConnection(peerId) {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('signal', {
                    target: peerId,
                    signal: event.candidate
                });
            }
        };

        pc.ondatachannel = (event) => {
            const channel = event.channel;
            setupDataChannel(channel, peerId);
        };

        pc.onconnectionstatechange = () => {
            console.log(`Connection state with peer ${peerId}: ${pc.connectionState}`);
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
                peerConnections.delete(peerId);
                emit('peer-connection-closed', peerId);
            }
        };

        peerConnections.set(peerId, pc);
        return pc;
    }

    // Setup data channel
    function setupDataChannel(channel, peerId) {
        channel.binaryType = 'arraybuffer';

        // Create a promise that resolves when the data channel is open
        const openPromise = new Promise((resolve, reject) => {
            channel.addEventListener('open', () => {
                console.log(`Data channel opened with peer ${peerId}`);
                dataChannels.set(peerId, channel);
                resolve();
            });

            channel.addEventListener('error', (error) => {
                console.error(`Data channel error with peer ${peerId}:`, error);
                reject(error);
            });
        });

        dataChannelPromises.set(peerId, openPromise);

        channel.addEventListener('close', () => {
            console.log(`Data channel closed with peer ${peerId}`);
            dataChannels.delete(peerId);
            dataChannelPromises.delete(peerId);
        });

        channel.addEventListener('message', (event) => {
            if (typeof event.data === 'string') {
                const message = JSON.parse(event.data);
                handleDataChannelMessage(message, peerId);
            } else {
                handleFileChunk(event.data, peerId);
            }
        });
    }

    // Handle incoming file request
    function handleIncomingRequest(data) {
        const { peer, files } = data;
        const totalSize = files.reduce((acc, file) => acc + file.size, 0);

        isReceivingFile = true;
        receivingDetails = {
            peer: { id: peer }, // The UI can resolve peer name
            fileCount: files.length,
            totalSize: totalSize,
            files: files
        };

        emit('incoming-file-request', receivingDetails);
    }

    // Handle file response from receiver
    async function handleFileResponse(data) {
        if (data.accepted) {
            console.log('Recipient accepted the file transfer');
            transferStatus = 'Recipient accepted. Preparing to send files...';

            // Now start the actual file transfer
            await startFileTransfer();
        } else {
            console.log('Recipient declined the file transfer');
            transferStatus = 'Recipient declined the transfer.';
            emit('transfer-declined', { message: 'Recipient declined the file transfer.' });
        }
    }

    // Start file transfer
    async function startFileTransfer() {
        const peerId = selectedPeer.id;
        const channel = await waitForDataChannel(peerId);
        
        if (!channel) {
            throw new Error('Data channel is not open');
        }
    
        const totalFiles = selectedFiles.length;
        const totalSize = selectedFiles.reduce((acc, file) => acc + file.size, 0);
    
        // Send transfer metadata
        channel.send(JSON.stringify({
            type: 'transfer-start',
            totalFiles,
            totalSize
        }));
    
        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            await sendFile(file, i + 1, totalFiles, channel);
        }
    }

    async function sendFile(file, fileNumber, totalFiles, channel) {
        // Send file metadata
        channel.send(JSON.stringify({
            type: 'file-metadata',
            file: {
                name: file.name,
                size: file.size,
                type: file.type
            },
            fileNumber,
            totalFiles
        }));
    
        // Wait for receiver ready signal
        await waitForMessage('ready-for-file', msg => msg.fileName === file.name);
    
        // Read file as ArrayBuffer
        const buffer = await file.arrayBuffer();
        const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);
        
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const start = chunkIndex * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
            const chunk = buffer.slice(start, end);
    
            // Flow control - wait if buffer is full
            while (channel.bufferedAmount > MAX_BUFFER_SIZE) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
    
            // Send chunk with sequence number
            channel.send(JSON.stringify({
                type: 'chunk-start',
                fileName: file.name,
                chunkIndex,
                totalChunks
            }));
            
            channel.send(chunk);
    
            // Update progress
            const progress = (chunkIndex + 1) / totalChunks;
            updateProgress(file, fileNumber, totalFiles, progress);
            
            // Wait for chunk acknowledgment
            await waitForMessage('chunk-received', 
                msg => msg.fileName === file.name && msg.chunkIndex === chunkIndex);
        }
    
        // Send file completion marker
        channel.send(JSON.stringify({
            type: 'file-complete',
            fileName: file.name,
            fileNumber,
            totalFiles
        }));
    
        // Wait for file completion acknowledgment
        await waitForMessage('file-received', msg => msg.fileName === file.name);
    }

    function getCompletedFilesSize(currentIndex) {
        return selectedFiles
            .slice(0, currentIndex)
            .reduce((acc, file) => acc + file.size, 0);
    }

    // Wait for the data channel to be open
    async function waitForDataChannel(peerId) {
        let channel = dataChannels.get(peerId);

        if (channel && channel.readyState === 'open') {
            return channel;
        }

        const openPromise = dataChannelPromises.get(peerId);
        if (openPromise) {
            try {
                await openPromise;
                channel = dataChannels.get(peerId);
                return channel;
            } catch (error) {
                console.error('Failed to open data channel', error);
                emit('error', { message: 'Failed to open data channel' });
                return null;
            }
        } else {
            console.error('No data channel or open promise found for peer', peerId);
            emit('error', { message: 'No data channel found for peer' });
            return null;
        }
    }

    // Wait for specific message type
    function waitForMessage(type, condition) {
        return new Promise(resolve => {
            messagePromises.set(type, { resolve, condition });
        });
    }

    // Handle messages received on data channel
    function handleDataChannelMessage(message, peerId) {
        try {
            const parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;
            console.log(`Received message of type ${parsedMessage.type}:`, parsedMessage);

            // Check for pending promises
            const pending = messagePromises.get(parsedMessage.type);
            if (pending) {
                if (!pending.condition || pending.condition(parsedMessage)) {
                    messagePromises.delete(parsedMessage.type);
                    pending.resolve(parsedMessage);
                    return;
                }
            }

            switch (parsedMessage.type) {
                case 'transfer-start':
                    initializeTransfer(parsedMessage);
                    break;
                case 'file-metadata':
                    initializeFileReceiving(parsedMessage, peerId);
                    break;
                case 'partition-end':
                    handlePartitionEnd(parsedMessage, peerId);
                    break;
                case 'file-end':
                    finalizeFile(parsedMessage.name, peerId);
                    break;
                default:
                    console.log('Unknown message type:', parsedMessage.type);
            }
        } catch (error) {
            console.error('Error handling data channel message:', error);
            emit('error', { message: 'Error handling data channel message', error });
        }
    }

    // Initialize transfer
    function initializeTransfer(metadata) {
        fileChunks.clear();
        receivedFiles = [];
        transferProgress = 0;
        currentFileIndex = 0;
        totalTransferSize = metadata.totalSize;
        totalTransferFiles = metadata.totalFiles;
        transferStatus = 'Preparing to receive files...';
        console.log(`Initialized transfer: ${metadata.totalFiles} files, ${metadata.totalSize} bytes`);

        emit('transfer-initialized', {
            transferStatus,
            transferDetails: '',
            transferProgress
        });
    }

    // Initialize file receiving
    function initializeFileReceiving(metadata, peerId) {
        try {
            const { file, fileNumber, totalFiles } = metadata;

            // Set up for new file
            currentReceivingFileName = file.name;
            fileChunks.set(file.name, {
                chunks: [],
                size: 0,
                metadata: file,
                isComplete: false,
                expectedSize: file.size
            });

            transferStatus = `Receiving file ${fileNumber} of ${totalFiles}`;
            transferDetails = `${file.name} (${formatFileSize(file.size)})`;

            console.log(`Initialized receiving of file ${fileNumber}: ${file.name} (${file.size} bytes)`);

            // Send ready signal
            const channel = dataChannels.get(peerId);
            if (channel) {
                channel.send(JSON.stringify({
                    type: 'ready-for-file',
                    fileName: file.name
                }));
                console.log(`Sent ready-for-file for ${file.name}`);
            }

            emit('transfer-status', {
                transferStatus,
                transferDetails,
                transferProgress
            });

        } catch (error) {
            console.error('Error initializing file receiving:', error);
            emit('error', { message: 'Failed to initialize file transfer', error });
        }
    }

    // Handle partition end
    function handlePartitionEnd(message, peerId) {
        const { fileName, offset } = message;
        const fileData = fileChunks.get(fileName);

        if (!fileData) {
            console.error(`No file data found for ${fileName}`);
            return;
        }

        // Send acknowledgment to sender
        const channel = dataChannels.get(peerId);
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
    }

    // Finalize file
    function finalizeFile(fileName, peerId) {
        try {
            const fileData = fileChunks.get(fileName);
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

            receivedFiles.push(completeFile);
            fileData.isComplete = true;

            // Clean up chunks to free memory
            fileChunks.delete(fileName);

            // Send acknowledgment
            const channel = dataChannels.get(peerId);
            if (channel) {
                channel.send(JSON.stringify({
                    type: 'file-received',
                    fileName: fileName
                }));
                console.log(`Sent file-received acknowledgment for ${fileName}`);
            }

            // Update progress
            const totalReceived = receivedFiles.reduce((acc, file) => acc + file.size, 0);
            transferProgress = Math.round((totalReceived / totalTransferSize) * 100);
            transferStatus = `Receiving files... (${transferProgress}%)`;
            transferDetails = '';

            emit('transfer-progress', {
                transferStatus,
                transferDetails,
                transferProgress
            });

            // Check if all files are complete
            if (receivedFiles.length === totalTransferFiles) {
                transferStatus = 'Transfer Complete!';
                transferDetails = 'All files received successfully';
                console.log('All files received successfully.');

                emit('transfer-complete', {
                    transferStatus,
                    transferDetails,
                    receivedFiles
                });
            }

        } catch (error) {
            console.error(`Error finalizing file ${fileName}:`, error);
            emit('error', { message: `Failed to process file ${fileName}`, error });
        }
    }

    // Handle file chunk
    function handleFileChunk(data, metadata) {
        const fileData = fileChunks.get(metadata.fileName);
        if (!fileData) return;
    
        const chunk = new Uint8Array(data);
        fileData.chunks[metadata.chunkIndex] = chunk;
        fileData.receivedChunks++;
    
        // Calculate progress
        const progress = fileData.receivedChunks / metadata.totalChunks;
        updateProgress(fileData.metadata, metadata.fileNumber, metadata.totalFiles, progress);
    
        // Check if file is complete
        if (fileData.receivedChunks === metadata.totalChunks) {
            finalizeFile(metadata.fileName);
        }
    }

    function updateProgress(file, fileNumber, totalFiles, progress) {
        const fileProgress = Math.round(progress * 100);
        const transferDetails = `File ${fileNumber}/${totalFiles}: ${file.name} - ${fileProgress}%`;
        
        emit('transfer-progress', {
            transferStatus: `Transferring file ${fileNumber} of ${totalFiles}`,
            transferDetails,
            transferProgress: fileProgress
        });
    }

    // Cleanup connections
    function cleanupConnections() {
        // Close all data channels
        dataChannels.forEach(channel => {
            channel.close();
        });
        dataChannels.clear();

        // Close all peer connections
        peerConnections.forEach(pc => {
            pc.close();
        });
        peerConnections.clear();

        // Clean up file chunks and received files
        fileChunks.clear();
        receivedFiles.forEach(file => {
            if (file.url) {
                URL.revokeObjectURL(file.url);
            }
        });
        receivedFiles = [];

        // Close socket connection
        if (socket) {
            socket.close();
        }
    }

    // Expose public methods and variables
    return {
        on: on,
        emit: emit,
        setupWebSocket: setupWebSocket,
        createPeerConnection: createPeerConnection,
        setupDataChannel: setupDataChannel,
        handleSignaling: handleSignaling,
        getSocket: function() { return socket; },
        getPeerId: function() { return peerId; },
        peerConnections: peerConnections,
        dataChannels: dataChannels,
        dataChannelPromises: dataChannelPromises,
        fileChunks: fileChunks,
        messagePromises: messagePromises,
        cleanupConnections: cleanupConnections,

        // State variables
        setSelectedFiles: function(files) { selectedFiles = files; },
        getSelectedFiles: function() { return selectedFiles; },
        setSelectedPeer: function(peer) { selectedPeer = peer; },
        getSelectedPeer: function() { return selectedPeer; },
        getTransferStatus: function() { return transferStatus; },
        getTransferDetails: function() { return transferDetails; },
        getTransferProgress: function() { return transferProgress; },
        getReceivingDetails: function() { return receivingDetails; },
        isReceiving: function() { return isReceivingFile; },
        getReceivedFiles: function() { return receivedFiles; },
    };

})();
