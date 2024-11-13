// app.js

// Word lists for generating device names (not used in this version but kept for reference)
const adjectivesList = ['Red', 'Blue', 'Green', 'Purple', 'Golden', 'Silver', 'Crystal', 'Cosmic', 'Electric', 'Mystic'];
const nounsList = ['Wolf', 'Eagle', 'Lion', 'Phoenix', 'Dragon', 'Tiger', 'Falcon', 'Panther', 'Hawk', 'Bear'];

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
        // Check if it's a laptop or desktop based on screen size
        return window.innerWidth <= 1366 ? 'laptop' : 'desktop';
    }
    return 'desktop'; // Default fallback
}

document.addEventListener('DOMContentLoaded', function() {
    let peers = {};
    let deviceType = detectDeviceType();
    let selectedPeer = null;
    let selectedFiles = [];
    let isDragging = false;
    let transferProgress = 0;
    let transferStatus = '';
    let transferDetails = '';
    let isReceivingFile = false;
    let receivingDetails = null;
    let currentFileIndex = 0;
    let receivedFiles = [];

    // Update device type on resize
    window.addEventListener('resize', function() {
        deviceType = detectDeviceType();
    });

    // Top buttons
    document.getElementById('info-button').addEventListener('click', function() {
        document.getElementById('info-modal').style.display = 'flex';
    });

    document.getElementById('author-button').addEventListener('click', function() {
        document.getElementById('author-modal').style.display = 'flex';
    });

    // Modal close buttons
    // Info Modal
    document.getElementById('info-modal-close').addEventListener('click', function() {
        document.getElementById('info-modal').style.display = 'none';
    });
    document.getElementById('info-modal-backdrop').addEventListener('click', function() {
        document.getElementById('info-modal').style.display = 'none';
    });

    // Author Modal
    document.getElementById('author-modal-close').addEventListener('click', function() {
        document.getElementById('author-modal').style.display = 'none';
    });
    document.getElementById('author-modal-backdrop').addEventListener('click', function() {
        document.getElementById('author-modal').style.display = 'none';
    });

    // Initialize server connection
    const serverConnection = new ServerConnection(deviceType);
    const peersManager = new PeersManager(serverConnection);

    function updatePeerList() {
        const peerListElement = document.getElementById('peer-list');
        const noPeersMessage = document.getElementById('no-peers-message');

        peerListElement.innerHTML = '';

        const peerIds = Object.keys(peers);
        if (peerIds.length === 0) {
            noPeersMessage.style.display = 'block';
        } else {
            noPeersMessage.style.display = 'none';

            peerIds.forEach(function(peerId) {
                const peer = peers[peerId];
                const button = document.createElement('button');
                button.className = 'w-full px-6 py-4 bg-[#333533] text-white rounded-lg hover:bg-[#242423] transition-colors flex items-center justify-between';
                
                // Add click event
                button.addEventListener('click', function() {
                    selectPeer(peer);
                });

                const innerDiv = document.createElement('div');
                innerDiv.className = 'flex items-center space-x-4';

                const icon = document.createElement('i');
                icon.className = 'text-2xl';
                if (peer.name.type === 'mobile') {
                    icon.classList.add('fas', 'fa-mobile-alt');
                } else if (peer.name.type === 'laptop') {
                    icon.classList.add('fas', 'fa-laptop');
                } else if (peer.name.type === 'desktop') {
                    icon.classList.add('fas', 'fa-desktop');
                } else if (peer.name.type === 'tablet') {
                    icon.classList.add('fas', 'fa-tablet-alt');
                } else {
                    icon.classList.add('fas', 'fa-question-circle');
                }

                const textDiv = document.createElement('div');
                textDiv.className = 'text-left';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'block text-lg';
                nameSpan.textContent = peer.name.displayName || 'Unknown';

                const idSpan = document.createElement('span');
                idSpan.className = 'block text-sm opacity-75';
                idSpan.textContent = peer.name.deviceName;

                textDiv.appendChild(nameSpan);
                textDiv.appendChild(idSpan);

                innerDiv.appendChild(icon);
                innerDiv.appendChild(textDiv);

                const chevronIcon = document.createElement('i');
                chevronIcon.className = 'fas fa-chevron-right opacity-50';

                button.appendChild(innerDiv);
                button.appendChild(chevronIcon);

                peerListElement.appendChild(button);
            });
        }
    }

    function selectPeer(peer) {
        selectedPeer = peer;
        selectedFiles = [];
        showFileTransferModal();
    }

    function showFileTransferModal() {
        document.getElementById('file-transfer-modal').style.display = 'flex';
        document.getElementById('send-files-button').disabled = true;
        document.getElementById('selected-files-container').style.display = 'none';
        document.getElementById('selected-files-list').innerHTML = '';
    }

    // File Transfer Modal Events
    document.getElementById('file-transfer-modal-close').addEventListener('click', function() {
        document.getElementById('file-transfer-modal').style.display = 'none';
    });
    document.getElementById('file-transfer-modal-backdrop').addEventListener('click', function() {
        document.getElementById('file-transfer-modal').style.display = 'none';
    });
    document.getElementById('file-transfer-cancel-button').addEventListener('click', function() {
        document.getElementById('file-transfer-modal').style.display = 'none';
    });

    // File Drop Area Events
    const fileDropArea = document.getElementById('file-drop-area');

    fileDropArea.addEventListener('dragover', function(event) {
        event.preventDefault();
        isDragging = true;
        fileDropArea.classList.add('bg-[#333533]', 'bg-opacity-5');
    });

    fileDropArea.addEventListener('dragleave', function(event) {
        event.preventDefault();
        isDragging = false;
        fileDropArea.classList.remove('bg-[#333533]', 'bg-opacity-5');
    });

    fileDropArea.addEventListener('drop', function(event) {
        event.preventDefault();
        isDragging = false;
        fileDropArea.classList.remove('bg-[#333533]', 'bg-opacity-5');
        handleFileDrop(event);
    });

    function handleFileDrop(event) {
        selectedFiles = Array.from(event.dataTransfer.files);
        updateSelectedFilesList();
    }

    // File Input Change Event
    document.getElementById('file-input').addEventListener('change', function(event) {
        selectedFiles = Array.from(event.target.files);
        updateSelectedFilesList();
    });

    function updateSelectedFilesList() {
        const selectedFilesContainer = document.getElementById('selected-files-container');
        const selectedFilesList = document.getElementById('selected-files-list');
        const sendFilesButton = document.getElementById('send-files-button');

        selectedFilesList.innerHTML = '';

        if (selectedFiles.length > 0) {
            selectedFilesContainer.style.display = 'block';
            sendFilesButton.disabled = false;

            selectedFiles.forEach(function(file, index) {
                const li = document.createElement('li');
                li.className = 'flex justify-between items-center p-2 bg-gray-50 rounded';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'text-[#333533] truncate flex-1 mr-2';
                nameSpan.textContent = file.name;

                const sizeSpan = document.createElement('span');
                sizeSpan.className = 'text-[#333533] opacity-75';
                sizeSpan.textContent = formatFileSize(file.size);

                const deleteButton = document.createElement('button');
                deleteButton.className = 'text-red-500 hover:text-red-600 transition-colors';
                deleteButton.innerHTML = '<i class="fas fa-trash-alt"></i>';
                deleteButton.addEventListener('click', function() {
                    selectedFiles.splice(index, 1);
                    updateSelectedFilesList();
                });

                const infoDiv = document.createElement('div');
                infoDiv.className = 'flex items-center space-x-3';
                infoDiv.appendChild(sizeSpan);
                infoDiv.appendChild(deleteButton);

                li.appendChild(nameSpan);
                li.appendChild(infoDiv);

                selectedFilesList.appendChild(li);
            });
        } else {
            selectedFilesContainer.style.display = 'none';
            sendFilesButton.disabled = true;
        }
    }

    // Send Files Button Event
    document.getElementById('send-files-button').addEventListener('click', function() {
        sendFiles();
    });

    function sendFiles() {
        if (selectedFiles.length === 0) return;

        document.getElementById('file-transfer-modal').style.display = 'none';
        // Show "Waiting for confirmation" modal
        transferStatus = 'Waiting for confirmation from receiving device...';
        transferDetails = '';
        transferProgress = 0;
        showProgressModal();
        updateProgressModal();

        peersManager.sendFiles(selectedPeer.id, selectedFiles);
    }

    // Modify showProgressModal and updateProgressModal
    function showProgressModal() {
        document.getElementById('progress-modal').style.display = 'flex';
        document.getElementById('progress-bar-container').style.display = 'none'; // Hide progress bar initially
        document.getElementById('progress-icon').className = 'fas fa-spinner fa-spin text-4xl text-[#333533] mb-4';
    }

    function updateProgressModal() {
        document.getElementById('transfer-status').textContent = transferStatus;
        document.getElementById('transfer-details').textContent = transferDetails;

        if (transferProgress > 0) {
            document.getElementById('progress-bar-container').style.display = 'block';
            document.getElementById('progress-bar').style.width = transferProgress + '%';
        } else {
            document.getElementById('progress-bar-container').style.display = 'none';
        }
    }

    function hideProgressModal() {
        document.getElementById('progress-modal').style.display = 'none';
    }

    // Handle incoming file offers
    window.addEventListener('incoming-file-offer', function(e) {
        const data = e.detail;
        handleIncomingFileOffer(data.peerId, data.fileInfo, data.senderName);
    });

    function handleIncomingFileOffer(peerId, fileInfo, senderName) {
        isReceivingFile = true;
        receivingDetails = {
            peer: peers[peerId],
            fileCount: fileInfo.fileCount,
            totalSize: fileInfo.totalSize,
            senderName: senderName || peers[peerId].name.displayName
        };
        showIncomingRequestModal();
    }

    function showIncomingRequestModal() {
        document.getElementById('incoming-request-modal').style.display = 'flex';
        document.getElementById('incoming-peer-id').textContent = receivingDetails.senderName;
        document.getElementById('incoming-file-count').textContent = receivingDetails.fileCount;
        document.getElementById('incoming-total-size').textContent = formatFileSize(receivingDetails.totalSize);
    }

    document.getElementById('accept-transfer-button').addEventListener('click', function() {
        acceptTransfer();
    });

    document.getElementById('reject-transfer-button').addEventListener('click', function() {
        rejectTransfer();
    });

    document.getElementById('incoming-request-modal-backdrop').addEventListener('click', function() {
        rejectTransfer();
    });

    function acceptTransfer() {
        document.getElementById('incoming-request-modal').style.display = 'none';
        // Send 'file-accept' message to the sender
        peersManager.acceptTransfer(receivingDetails.peer.id);
        // Show "Transferring" modal
        transferStatus = 'Transferring...';
        transferDetails = '';
        transferProgress = 0;
        showProgressModal();
        updateProgressModal();
    }

    function rejectTransfer() {
        document.getElementById('incoming-request-modal').style.display = 'none';
        // Inform the sender that the transfer was rejected
        peersManager.rejectTransfer(receivingDetails.peer.id);
    }

    // Handle transfer declined
    window.addEventListener('transfer-declined', function(e) {
        const data = e.detail;
        handleTransferDeclined(data.peerId);
    });

    function handleTransferDeclined(peerId) {
        // Hide progress modal
        hideProgressModal();
        // Show alert or notification
        alert('Transfer was declined by the receiving device.');
    }

    // Handle transfer accepted
    window.addEventListener('transfer-accepted', function(e) {
        const data = e.detail;
        handleTransferAccepted(data.peerId);
    });

    function handleTransferAccepted(peerId) {
        // Start transferring files
        transferStatus = 'Transferring...';
        transferDetails = '';
        transferProgress = 0;
        updateProgressModal();
        peersManager.startFileTransfer(peerId);
    }

    // Handle file transfer progress events
    window.addEventListener('file-progress', function(e) {
        const data = e.detail;
        transferProgress = Math.round(data.progress * 100);
        transferDetails = `${transferProgress}% complete`;
        updateProgressModal();
        if (transferProgress >= 100) {
            transferStatus = 'Transfer Complete!';
            transferDetails = '';
            document.getElementById('progress-icon').className = 'fas fa-check-circle text-4xl text-green-500 mb-4';
            updateProgressModal();
            setTimeout(() => {
                hideProgressModal();
                if (isReceivingFile) {
                    showFilePreviewModal();
                }
            }, 2000);
        }
    });

    window.addEventListener('file-received', function(e) {
        const file = e.detail;
        receivedFiles.push(file);
    });

    function isImageFile(file) {
        return file?.type?.startsWith('image/');
    }

    function showFilePreviewModal() {
        document.getElementById('file-preview-modal').style.display = 'flex';
        currentFileIndex = 0;
        updateFilePreview();
    }

    document.getElementById('file-preview-modal-close').addEventListener('click', function() {
        document.getElementById('file-preview-modal').style.display = 'none';
    });
    document.getElementById('file-preview-modal-backdrop').addEventListener('click', function() {
        document.getElementById('file-preview-modal').style.display = 'none';
    });

    function updateFilePreview() {
        const file = getCurrentFile();
        const filePreviewContainer = document.getElementById('file-preview-container');
        const currentFileName = document.getElementById('current-file-name');
        const currentFileSize = document.getElementById('current-file-size');
        const prevFileButton = document.getElementById('prev-file-button');
        const nextFileButton = document.getElementById('next-file-button');
        const filePagination = document.getElementById('file-pagination');

        filePreviewContainer.innerHTML = '';
        currentFileName.textContent = file.name;
        currentFileSize.textContent = formatFileSize(file.size);

        if (isImageFile(file)) {
            const img = document.createElement('img');
            img.src = URL.createObjectURL(file.blob);
            img.className = 'max-h-full max-w-full object-contain';
            filePreviewContainer.appendChild(img);
        } else {
            const div = document.createElement('div');
            div.className = 'text-center';
            const icon = document.createElement('i');
            icon.className = getFileIcon(file);
            icon.classList.add('text-6xl', 'text-[#333533]', 'mb-4');
            const nameP = document.createElement('p');
            nameP.className = 'text-[#333533]';
            nameP.textContent = file.name;
            const typeP = document.createElement('p');
            typeP.className = 'text-sm text-gray-500';
            typeP.textContent = file.type;
            div.appendChild(icon);
            div.appendChild(nameP);
            div.appendChild(typeP);
            filePreviewContainer.appendChild(div);
        }

        // Update navigation buttons
        prevFileButton.style.display = currentFileIndex > 0 ? 'block' : 'none';
        nextFileButton.style.display = currentFileIndex < receivedFiles.length - 1 ? 'block' : 'none';

        // Update pagination dots
        filePagination.innerHTML = '';
        receivedFiles.forEach(function(_, index) {
            const dot = document.createElement('button');
            dot.className = 'w-2 h-2 rounded-full transition-colors';
            if (currentFileIndex === index) {
                dot.classList.add('bg-[#333533]');
            } else {
                dot.classList.add('bg-gray-300');
            }
            dot.addEventListener('click', function() {
                currentFileIndex = index;
                updateFilePreview();
            });
            filePagination.appendChild(dot);
        });
    }

    function getCurrentFile() {
        return receivedFiles[currentFileIndex] || {};
    }

    function getFileIcon(file) {
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
    }

    document.getElementById('prev-file-button').addEventListener('click', function() {
        if (currentFileIndex > 0) {
            currentFileIndex--;
            updateFilePreview();
        }
    });

    document.getElementById('next-file-button').addEventListener('click', function() {
        if (currentFileIndex < receivedFiles.length - 1) {
            currentFileIndex++;
            updateFilePreview();
        }
    });

    document.getElementById('download-file-button').addEventListener('click', function() {
        downloadFile(getCurrentFile());
    });

    function downloadFile(file) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file.blob);
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // Event handlers for PeersManager events
    window.addEventListener('peers', function(e) {
        const peerList = e.detail;
        peers = {};
        peerList.forEach(function(peer) {
            if (peer.id !== serverConnection.id) {
                peers[peer.id] = peer;
            }
        });
        updatePeerList();
    });

    window.addEventListener('peer-joined', function(e) {
        const peer = e.detail;
        if (peer.id !== serverConnection.id) {
            peers[peer.id] = peer;
            updatePeerList();
        }
    });

    window.addEventListener('peer-left', function(e) {
        const peerId = e.detail;
        delete peers[peerId];
        updatePeerList();
    });

    window.addEventListener('peer-updated', function(e) {
        const updatedPeer = e.detail;
        peers[updatedPeer.id] = updatedPeer;
        updatePeerList();
    });

    // Additional classes and logic for ServerConnection, PeersManager, and RTCPeer

    class ServerConnection {
        constructor(deviceType) {
            this.id = null;
            this.socket = null;
            this.deviceType = deviceType;
            this.connect();
        }

        connect() {
            const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
            const endpoint = protocol + location.host;
            this.socket = new WebSocket(endpoint);

            this.socket.onopen = () => {
                console.log('Connected to signaling server');
                // Send device info to server
                this.send({
                    type: 'introduce',
                    name: {
                        deviceType: this.deviceType
                    }
                });
            };

            this.socket.onmessage = (message) => {
                const data = JSON.parse(message.data);
                this.handleMessage(data);
            };

            this.socket.onclose = () => {
                console.log('Disconnected from signaling server');
                setTimeout(() => this.connect(), 3000); // Reconnect after 3 seconds
            };

            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        }

        send(message) {
            if (this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify(message));
            }
        }

        handleMessage(message) {
            switch (message.type) {
                case 'display-name':
                    this.id = message.message.peerId;
                    this.displayName = message.message.displayName;
                    this.deviceName = message.message.deviceName;
                    // Update UI to show the displayName from the server
                    document.getElementById('device-name').textContent = this.displayName;
                    break;
                case 'peers':
                    window.dispatchEvent(new CustomEvent('peers', { detail: message.peers }));
                    break;
                case 'peer-joined':
                    window.dispatchEvent(new CustomEvent('peer-joined', { detail: message.peer }));
                    break;
                case 'peer-left':
                    window.dispatchEvent(new CustomEvent('peer-left', { detail: message.peerId }));
                    break;
                case 'peer-updated':
                    window.dispatchEvent(new CustomEvent('peer-updated', { detail: message.peer }));
                    break;
                case 'signal':
                    window.dispatchEvent(new CustomEvent('signal', { detail: message }));
                    break;
                case 'file-offer':
                    window.dispatchEvent(new CustomEvent('file-offer', { detail: message }));
                    break;
                case 'file-accept':
                    window.dispatchEvent(new CustomEvent('file-accept', { detail: message }));
                    break;
                case 'file-decline':
                    window.dispatchEvent(new CustomEvent('file-decline', { detail: message }));
                    break;
                case 'ping':
                    this.send({ type: 'pong' });
                    break;
                default:
                    console.log('Unknown message type:', message.type);
                    break;
            }
        }
    }

    class PeersManager {
        constructor(serverConnection) {
            this.serverConnection = serverConnection;
            this.peers = {};
            this.filesToSend = null;

            window.addEventListener('signal', (e) => this.handleSignal(e.detail));
            window.addEventListener('peer-left', (e) => this.handlePeerLeft(e.detail));
            window.addEventListener('file-offer', (e) => this.handleFileOffer(e.detail));
            window.addEventListener('file-accept', (e) => this.handleFileAccept(e.detail));
            window.addEventListener('file-decline', (e) => this.handleFileDecline(e.detail));
        }

        handleSignal(message) {
            const fromPeerId = message.sender;
            const peer = this.getOrCreatePeer(fromPeerId, false); // Not initiator

            if (message.sdp) {
                peer.setRemoteDescription(message.sdp);
            } else if (message.ice) {
                peer.addIceCandidate(message.ice);
            }
        }

        handlePeerLeft(peerId) {
            if (this.peers[peerId]) {
                this.peers[peerId].close();
                delete this.peers[peerId];
            }
        }

        getOrCreatePeer(peerId, isInitiator = false) {
            if (!this.peers[peerId]) {
                this.peers[peerId] = new RTCPeer(this.serverConnection, peerId, isInitiator);
            }
            return this.peers[peerId];
        }

        sendFiles(peerId, files) {
            const totalSize = files.reduce((acc, file) => acc + file.size, 0);
            const fileInfo = {
                fileCount: files.length,
                totalSize: totalSize
            };
            // Save files to send later
            this.filesToSend = { peerId: peerId, files: files };
            // Send file-offer message
            this.serverConnection.send({
                type: 'file-offer',
                to: peerId,
                senderName: this.serverConnection.displayName,
                fileInfo: fileInfo
            });
        }

        acceptTransfer(peerId) {
            this.serverConnection.send({
                type: 'file-accept',
                to: peerId
            });
        }

        rejectTransfer(peerId) {
            this.serverConnection.send({
                type: 'file-decline',
                to: peerId
            });
        }

        handleFileOffer(message) {
            const fromPeerId = message.sender;
            const peer = this.getOrCreatePeer(fromPeerId, false); // Not initiator
            peer.handleFileOffer(message);
        }

        handleFileAccept(message) {
            const fromPeerId = message.sender;
            const peer = this.getOrCreatePeer(fromPeerId, true); // Initiator
            peer.handleFileAccept(message);
        }

        handleFileDecline(message) {
            const fromPeerId = message.sender;
            const peer = this.peers[fromPeerId];
            if (peer) {
                peer.handleFileDecline();
            }
        }

        startFileTransfer(peerId) {
            const peer = this.getOrCreatePeer(peerId, true); // Initiator
            const files = this.filesToSend.files;
            peer.sendFiles(files);
        }
    }

    class RTCPeer {
        constructor(serverConnection, peerId, isInitiator) {
            this.serverConnection = serverConnection;
            this.peerId = peerId;
            this.isInitiator = isInitiator;
            this.pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' }
                ]
            });
            this.channel = null;
            this.fileReceiver = null;
            this.fileSender = null;

            this.pc.onicecandidate = (event) => {
                if (event.candidate) {
                    this.serverConnection.send({
                        type: 'signal',
                        to: this.peerId,
                        ice: event.candidate
                    });
                }
            };

            this.pc.ondatachannel = (event) => {
                this.channel = event.channel;
                this.setupDataChannel();
            };

            if (this.isInitiator) {
                // Do not create data channel here; wait for acceptance
            }
        }

        createOffer() {
            this.pc.createOffer().then((offer) => {
                return this.pc.setLocalDescription(offer);
            }).then(() => {
                this.serverConnection.send({
                    type: 'signal',
                    to: this.peerId,
                    sdp: this.pc.localDescription
                });
            }).catch(console.error);
        }

        setRemoteDescription(sdp) {
            this.pc.setRemoteDescription(new RTCSessionDescription(sdp)).then(() => {
                if (sdp.type === 'offer') {
                    return this.pc.createAnswer().then((answer) => {
                        return this.pc.setLocalDescription(answer);
                    }).then(() => {
                        this.serverConnection.send({
                            type: 'signal',
                            to: this.peerId,
                            sdp: this.pc.localDescription
                        });
                    });
                }
            }).catch(console.error);
        }

        addIceCandidate(candidate) {
            this.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
        }

        setupDataChannel() {
            this.channel.onopen = () => {
                console.log('Data channel opened with', this.peerId);
                if (this.fileSender && this.fileSender.hasFiles()) {
                    this.fileSender.sendNextFile();
                }
            };

            this.channel.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            this.channel.onerror = (error) => {
                console.error('Data channel error:', error);
            };

            this.channel.onclose = () => {
                console.log('Data channel closed with', this.peerId);
            };
        }

        handleMessage(message) {
            if (typeof message === 'string') {
                const data = JSON.parse(message);
                if (data.type === 'file-header') {
                    // Start receiving a file
                    this.fileReceiver = new FileReceiver(data.fileInfo, this.channel);
                } else if (data.type === 'transfer-complete') {
                    // File transfer completed
                    window.dispatchEvent(new CustomEvent('file-received', { detail: this.fileReceiver.file }));
                }
            } else {
                // Binary data (file chunks)
                if (this.fileReceiver) {
                    this.fileReceiver.receiveChunk(message);
                    const progress = this.fileReceiver.getProgress();
                    window.dispatchEvent(new CustomEvent('file-progress', { detail: { progress: progress } }));
                }
            }
        }

        sendFiles(files) {
            this.fileSender = new FileSender(files, this.channel);

            if (this.channel && this.channel.readyState === 'open') {
                this.fileSender.sendNextFile();
            } else {
                this.channel.onopen = () => {
                    this.fileSender.sendNextFile();
                };
            }
        }

        handleFileOffer(message) {
            const fileInfo = message.fileInfo;
            const senderName = message.senderName;
            // Notify UI to show accept/decline modal
            window.dispatchEvent(new CustomEvent('incoming-file-offer', { detail: { peerId: this.peerId, fileInfo: fileInfo, senderName: senderName } }));
        }

        handleFileAccept(message) {
            // Start the RTCPeerConnection and begin sending files
            this.startConnection();
            // Notify UI that transfer is accepted
            window.dispatchEvent(new CustomEvent('transfer-accepted', { detail: { peerId: this.peerId } }));
        }

        handleFileDecline() {
            // Notify UI that transfer was declined
            window.dispatchEvent(new CustomEvent('transfer-declined', { detail: { peerId: this.peerId } }));
        }

        startConnection() {
            if (this.isInitiator) {
                if (!this.channel) {
                    this.channel = this.pc.createDataChannel('fileTransfer');
                    this.setupDataChannel();
                }
                this.createOffer();
            }
        }

        acceptTransfer() {
            // Logic to accept transfer
            this.startConnection();
        }

        close() {
            if (this.channel) {
                this.channel.close();
            }
            if (this.pc) {
                this.pc.close();
            }
        }
    }

    class FileSender {
        constructor(files, channel) {
            this.files = files;
            this.channel = channel;
            this.fileIndex = 0;
            this.chunkSize = 16 * 1024; // 16 KB
        }

        hasFiles() {
            return this.fileIndex < this.files.length;
        }

        sendNextFile() {
            if (this.fileIndex >= this.files.length) {
                return;
            }
            const file = this.files[this.fileIndex];
            const fileInfo = {
                name: file.name,
                size: file.size,
                type: file.type
            };
            this.channel.send(JSON.stringify({ type: 'file-header', fileInfo: fileInfo }));
            this.sendFileChunks(file);
        }

        sendFileChunks(file) {
            const reader = new FileReader();
            let offset = 0;

            reader.onload = (event) => {
                this.channel.send(event.target.result);
                offset += event.target.result.byteLength;

                const progress = offset / file.size;
                window.dispatchEvent(new CustomEvent('file-progress', { detail: { progress: progress } }));

                if (offset < file.size) {
                    readSlice();
                } else {
                    this.channel.send(JSON.stringify({ type: 'transfer-complete' }));
                    this.fileIndex++;
                    this.sendNextFile();
                }
            };

            const readSlice = () => {
                const slice = file.slice(offset, offset + this.chunkSize);
                reader.readAsArrayBuffer(slice);
            };

            readSlice();
        }
    }

    class FileReceiver {
        constructor(fileInfo, channel) {
            this.fileInfo = fileInfo;
            this.channel = channel;
            this.receivedBuffers = [];
            this.receivedSize = 0;
        }

        receiveChunk(chunk) {
            this.receivedBuffers.push(chunk);
            this.receivedSize += chunk.byteLength;
        }

        getProgress() {
            return this.receivedSize / this.fileInfo.size;
        }

        get file() {
            const blob = new Blob(this.receivedBuffers, { type: this.fileInfo.type });
            return {
                name: this.fileInfo.name,
                size: this.fileInfo.size,
                type: this.fileInfo.type,
                blob: blob
            };
        }
    }
});
