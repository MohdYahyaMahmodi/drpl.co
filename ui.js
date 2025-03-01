// Helper functions
const $ = id => document.getElementById(id);
const isURL = text => /^((https?:\/\/|www)[^\s]+)/g.test(text.toLowerCase());
const isDownloadSupported = typeof document.createElement('a').download !== 'undefined';

// UI classes
class DrplUI {
    constructor() {
        this.currentPeer = null;
        this.initializeEvents();
        this.initializeDialogs();
        this.initializeSounds();
    }

    initializeEvents() {
        Events.on('peer-joined', e => this.onPeerJoined(e.detail));
        Events.on('peer-left', e => this.onPeerLeft(e.detail));
        Events.on('peers', e => this.onPeers(e.detail));
        Events.on('display-name', e => this.onDisplayName(e.detail));
        Events.on('file-progress', e => this.onFileProgress(e.detail));
        Events.on('file-received', e => this.onFileReceived(e.detail));
        Events.on('text-received', e => this.onTextReceived(e.detail));
        Events.on('notify-user', e => this.showToast(e.detail));
        Events.on('file-sent', () => this.playSentSound());
        Events.on('text-sent', () => this.playSentSound());
        Events.on('file-transfer-complete', () => this.onFileTransferComplete());
        Events.on('peer-connection-established', peerId => this.onPeerConnected(peerId));
        
        // Add these new event handlers
        Events.on('file-send-start', e => this.handleFileSendStart(e.detail.files, e.detail.to));
        Events.on('file-receive-start', e => this.handleFileReceiveStart(e.detail.header, e.detail.from));
    }

    initializeDialogs() {
        // Initialize dialogs
        this.dialogs = {
            receive: new ReceiveDialog(),
            sendText: new SendTextDialog(),
            receiveText: new ReceiveTextDialog(),
            action: new ActionDialog(),
            transferProgress: new TransferProgressDialog() // Add new progress dialog
        };
    }

    initializeSounds() {
        this.sentSound = $('sent-sound');
    }

    playSentSound() {
        if (this.sentSound) {
            this.sentSound.currentTime = 0;
            this.sentSound.play().catch(err => console.log('Sound play failed:', err));
        }
    }

    onPeerJoined(peer) {
        if ($(peer.id)) return; // Peer already exists
        this.createPeerElement(peer);
    }

    onPeers(peers) {
        this.clearPeers();
        peers.forEach(peer => this.onPeerJoined(peer));
    }

    onPeerLeft(peerId) {
        const peerElement = $(peerId);
        if (peerElement) {
            peerElement.remove();
        }
    }

    onPeerConnected(peerId) {
        const peerElement = $(peerId);
        if (peerElement) {
            peerElement.classList.add('connected');
        }
    }

    onDisplayName(data) {
        const displayNameElement = $('display-name');
        
        // Clear existing content
        displayNameElement.innerHTML = '';
        
        // Create text node
        const textNode = document.createTextNode('You are known as: ');
        displayNameElement.appendChild(textNode);
        
        // Create span for the display name
        const nameSpan = document.createElement('span');
        nameSpan.textContent = data.displayName;
        displayNameElement.appendChild(nameSpan);
    }

    onFileProgress(progress) {
        const peerId = progress.sender;
        const peerElement = $(peerId);
        if (!peerElement) return;
        
        // Update the peer element progress for visual feedback
        this.setPeerProgress(peerElement, progress.progress);
        
        // Also update the progress dialog
        this.dialogs.transferProgress.updateProgress(peerId, progress.progress, progress.bytesTransferred);
    }

    onFileReceived(file) {
        // Add the file to the receive dialog
        this.dialogs.receive.addFile(file);
        
        // End the transfer in the progress dialog
        this.dialogs.transferProgress.endTransfer(file.sender);
    }

    onFileTransferComplete() {
        // File transfer completed, update UI if needed
        console.log("File transfer completed");
        
        // Ensure the progress dialog is properly updated or hidden
        setTimeout(() => {
            this.dialogs.transferProgress.checkAndHideIfDone();
        }, 500);
    }

    onTextReceived(message) {
        this.dialogs.receiveText.showText(message.text, message.sender);
    }

    showToast(message) {
        const toast = $('toast');
        toast.textContent = message;
        toast.classList.add('active');
        
        setTimeout(() => {
            toast.classList.remove('active');
        }, 3000);
    }

    clearPeers() {
        $('peers').innerHTML = '';
    }

    createPeerElement(peer) {
        const peerElement = document.createElement('div');
        peerElement.className = 'peer';
        peerElement.id = peer.id;
        
        const deviceType = this.getDeviceType(peer.name);
        const deviceIcon = this.getDeviceIcon(deviceType);
        
        peerElement.innerHTML = `
            <div class="peer-icon">
                <i class="${deviceIcon}"></i>
            </div>
            <div class="progress-circle"></div>
            <div class="peer-name">${peer.name.displayName}</div>
            <div class="peer-device">${peer.name.deviceName}</div>
        `;
        
        peerElement.addEventListener('click', () => {
            this.currentPeer = peer.id;
            this.dialogs.action.show(peer.name.displayName);
        });
        
        $('peers').appendChild(peerElement);
    }

    getDeviceType(name) {
        if (name.type === 'mobile') return 'mobile';
        if (name.type === 'tablet') return 'tablet';
        return 'desktop';
    }

    getDeviceIcon(type) {
        switch (type) {
            case 'mobile':
                return 'fas fa-mobile-alt';
            case 'tablet':
                return 'fas fa-tablet-alt';
            default:
                return 'fas fa-desktop';
        }
    }

    setPeerProgress(peerElement, progress) {
        if (progress > 0) {
            peerElement.setAttribute('transfer', 'true');
        }
        
        const progressCircle = peerElement.querySelector('.progress-circle');
        progressCircle.style.setProperty('--progress', `${progress * 100}%`);
        
        // Add percentage text
        const percentage = Math.round(progress * 100);
        progressCircle.setAttribute('data-progress', percentage);
        
        if (progress >= 1) {
            setTimeout(() => {
                peerElement.removeAttribute('transfer');
            }, 500);
        }
    }

    // Handle transfer start events
    handleFileSendStart(files, peerId) {
        // Start the transfer progress dialog
        this.dialogs.transferProgress.startTransfer(
            peerId, 
            files.length > 1 ? `${files.length} files` : files[0].name,
            files.length,
            files.length > 0 ? files[0].size : 0
        );
    }

    handleFileReceiveStart(fileHeader, peerId) {
        // Start the transfer progress dialog for receiving
        this.dialogs.transferProgress.startReceiving(
            peerId,
            fileHeader.name,
            fileHeader.size
        );
    }
}

// Dialog classes
class Dialog {
    constructor(id) {
        this.element = $(id);
        this.setupCloseButtons();
    }

    setupCloseButtons() {
        const closeButtons = this.element.querySelectorAll('[id^="close-"]');
        closeButtons.forEach(button => {
            button.addEventListener('click', () => this.hide());
        });
    }

    show() {
        this.element.classList.add('active');
    }

    hide() {
        this.element.classList.remove('active');
    }
}

// Enhanced ReceiveDialog with carousel and multi-file support
class ReceiveDialog extends Dialog {
    constructor() {
        super('receive-dialog');
        this.files = [];
        this.currentIndex = 0;
        this.objectUrls = {}; // Store URLs to prevent memory leaks
        this._setupCarousel();
        this._setupDownloadButtons();
        this._setupKeyboardNavigation();
        this._setupTouchNavigation();
    }

    _setupCarousel() {
        // Navigation buttons - using direct DOM event attachment
        const prevButton = $('carousel-prev');
        const nextButton = $('carousel-next');
        
        prevButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showPreviousFile();
            return false;
        });
        
        nextButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showNextFile();
            return false;
        });
        
        // Item container
        this.carouselContainer = this.element.querySelector('.carousel-item-container');
    }

    _setupDownloadButtons() {
        // Current file download
        $('download-current').addEventListener('click', () => {
            if (this.files.length > 0) {
                this.downloadFile(this.files[this.currentIndex]);
            }
        });
        
        // Download all as zip
        $('download-all').addEventListener('click', () => {
            this.downloadAllFiles();
        });
    }
    
    _setupKeyboardNavigation() {
        // Add keyboard navigation support
        this._keyHandler = (e) => {
            // Only process if dialog is active
            if (!this.element.classList.contains('active')) return;
            
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                this.showPreviousFile();
                e.preventDefault();
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                this.showNextFile();
                e.preventDefault();
            } else if (e.key === 'Escape') {
                this.hide();
                e.preventDefault();
            }
        };
        
        window.addEventListener('keydown', this._keyHandler);
    }
    
    _setupTouchNavigation() {
        // Add touch navigation support
        let startX, startY;
        
        this.carouselContainer.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });
        
        this.carouselContainer.addEventListener('touchend', (e) => {
            if (!startX || !startY) return;
            
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            
            const diffX = startX - endX;
            const diffY = startY - endY;
            
            // Horizontal swipe detection with threshold
            if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
                if (diffX > 0) {
                    // Swipe left, go to next
                    this.showNextFile();
                } else {
                    // Swipe right, go to previous
                    this.showPreviousFile();
                }
            }
            
            startX = null;
            startY = null;
        }, { passive: true });
    }

    // Add a file to the carousel
    addFile(file) {
        // Add to files array
        this.files.push(file);
        
        // Update file counter
        this._updateFileCounter();
        
        // Create object URL for the file
        if (!this.objectUrls[file.name]) {
            this.objectUrls[file.name] = URL.createObjectURL(file.blob);
        }
        
        // If this is the first file, display it and show the dialog
        if (this.files.length === 1) {
            this.currentIndex = 0;
            this.show();
            this.displayCurrentFile();
        } else {
            // Just refresh the navigation if already showing
            this._updateNavButtons();
            
            // Notify user about multiple files
            if (this.files.length === 2) {
                Events.fire('notify-user', 'Multiple files received. Use arrows to navigate.');
            }
        }
    }
    
    // Show the file at the current index
    displayCurrentFile() {
        if (this.files.length === 0) return;
        
        const file = this.files[this.currentIndex];
        let url = this.objectUrls[file.name];
        
        if (!url) {
            url = URL.createObjectURL(file.blob);
            this.objectUrls[file.name] = url;
        }
        
        // Clear the container with a fade effect
        this.carouselContainer.classList.add('fade-out');
        
        setTimeout(() => {
            // Clear container after fade
            this.carouselContainer.innerHTML = '';
            
            // Create file display element
            const fileItem = document.createElement('div');
            fileItem.className = 'carousel-item';
            
            // File info
            const fileInfo = document.createElement('div');
            fileInfo.className = 'file-info';
            
            const fileName = document.createElement('div');
            fileName.className = 'file-name';
            fileName.textContent = file.name;
            
            const fileSize = document.createElement('div');
            fileSize.className = 'file-size';
            fileSize.textContent = this._formatFileSize(file.size);
            
            fileInfo.appendChild(fileName);
            fileInfo.appendChild(fileSize);
            fileItem.appendChild(fileInfo);
            
            // Preview if it's an image
            if (file.mime.startsWith('image/')) {
                const preview = document.createElement('div');
                preview.className = 'preview';
                
                const image = document.createElement('img');
                image.src = url;
                image.alt = file.name;
                image.className = 'carousel-image';
                
                preview.appendChild(image);
                fileItem.appendChild(preview);
            } else {
                // Icon for non-image files
                const fileIcon = document.createElement('div');
                fileIcon.className = 'file-icon';
                
                const icon = document.createElement('i');
                icon.className = this._getFileIconClass(file.mime);
                
                fileIcon.appendChild(icon);
                fileItem.appendChild(fileIcon);
            }
            
            // Add to container
            this.carouselContainer.appendChild(fileItem);
            
            // Fade back in
            this.carouselContainer.classList.remove('fade-out');
            this.carouselContainer.classList.add('fade-in');
            
            // Update counter and navigation buttons
            this._updateFileCounter();
            this._updateNavButtons();
            
            // Remove fade-in class after animation completes
            setTimeout(() => {
                this.carouselContainer.classList.remove('fade-in');
            }, 300);
        }, 150); // Slight delay to allow fade-out animation
    }
    
    // Show the next file in the carousel
    showNextFile() {
        if (this.currentIndex < this.files.length - 1) {
            this.currentIndex++;
            this.displayCurrentFile();
            return true;
        }
        return false;
    }
    
    // Show the previous file in the carousel
    showPreviousFile() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.displayCurrentFile();
            return true;
        }
        return false;
    }
    
    // Update file counter display
    _updateFileCounter() {
        const currentElement = $('current-file');
        const totalElement = $('total-files');
        
        if (currentElement && totalElement) {
            currentElement.textContent = this.files.length > 0 ? this.currentIndex + 1 : 0;
            totalElement.textContent = this.files.length;
        }
    }
    
    // Update navigation button states
    _updateNavButtons() {
        const prevButton = $('carousel-prev');
        const nextButton = $('carousel-next');
        
        if (!prevButton || !nextButton) return;
        
        // Remove disabled state first
        prevButton.classList.remove('disabled');
        nextButton.classList.remove('disabled');
        prevButton.removeAttribute('disabled');
        nextButton.removeAttribute('disabled');
        
        // Only apply disabled state if actually at the end
        if (this.currentIndex <= 0) {
            prevButton.classList.add('disabled');
            prevButton.setAttribute('disabled', 'disabled');
        }
        
        if (this.currentIndex >= this.files.length - 1) {
            nextButton.classList.add('disabled');
            nextButton.setAttribute('disabled', 'disabled');
        }
    }
    
    // Get appropriate icon class based on file type
    _getFileIconClass(mimeType) {
        if (mimeType.startsWith('image/')) {
            return 'fas fa-file-image fa-4x';
        } else if (mimeType.startsWith('video/')) {
            return 'fas fa-file-video fa-4x';
        } else if (mimeType.startsWith('audio/')) {
            return 'fas fa-file-audio fa-4x';
        } else if (mimeType.startsWith('text/')) {
            return 'fas fa-file-alt fa-4x';
        } else if (mimeType.includes('pdf')) {
            return 'fas fa-file-pdf fa-4x';
        } else if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') || mimeType.includes('gz')) {
            return 'fas fa-file-archive fa-4x';
        } else if (mimeType.includes('word') || mimeType.includes('doc')) {
            return 'fas fa-file-word fa-4x';
        } else if (mimeType.includes('excel') || mimeType.includes('sheet') || mimeType.includes('xls')) {
            return 'fas fa-file-excel fa-4x';
        } else if (mimeType.includes('powerpoint') || mimeType.includes('presentation') || mimeType.includes('ppt')) {
            return 'fas fa-file-powerpoint fa-4x';
        } else {
            return 'fas fa-file fa-4x';
        }
    }
    
    // Download a single file
    downloadFile(file) {
        let url = this.objectUrls[file.name];
        if (!url) {
            url = URL.createObjectURL(file.blob);
            this.objectUrls[file.name] = url;
        }
        
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Don't revoke URL here, as we might need it again
    }
    
    // Download all files as a ZIP
    async downloadAllFiles() {
        if (!window.JSZip) {
            Events.fire('notify-user', 'ZIP functionality not available');
            return;
        }
        
        if (this.files.length === 0) return;
        
        // Show loading toast
        Events.fire('notify-user', 'Preparing ZIP file...');
        
        try {
            const zip = new JSZip();
            
            // Add all files to the ZIP
            for (const file of this.files) {
                // Add file to zip with its name
                zip.file(file.name, file.blob);
            }
            
            // Generate the ZIP file
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            
            // Create download link
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `drpl_files_${new Date().toISOString().slice(0, 10)}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Clean up
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            
            // Show success message
            Events.fire('notify-user', 'ZIP file created successfully');
        } catch (error) {
            console.error('Error creating ZIP file:', error);
            Events.fire('notify-user', 'Error creating ZIP file');
        }
    }
    
    _formatFileSize(bytes) {
        if (bytes >= 1e9) {
            return (Math.round(bytes / 1e8) / 10) + ' GB';
        } else if (bytes >= 1e6) {
            return (Math.round(bytes / 1e5) / 10) + ' MB';
        } else if (bytes > 1000) {
            return Math.round(bytes / 1000) + ' KB';
        } else {
            return bytes + ' Bytes';
        }
    }
    
    // Reset the dialog when hiding
    hide() {
        super.hide();
    }
    
    // Clear all files (called when needed)
    clearFiles() {
        // Revoke all object URLs first to prevent memory leaks
        Object.values(this.objectUrls).forEach(url => {
            URL.revokeObjectURL(url);
        });
        
        this.files = [];
        this.objectUrls = {};
        this.currentIndex = 0;
        this._updateFileCounter();
        this._updateNavButtons();
        this.carouselContainer.innerHTML = '';
    }
    
    // Show the dialog and display the first file
    show() {
        super.show();
        
        // Make sure buttons are properly updated when showing
        this._updateNavButtons();
    }
    
    // Clean up resources when the component is destroyed
    destroy() {
        // Remove event listeners
        window.removeEventListener('keydown', this._keyHandler);
        
        // Revoke object URLs
        Object.values(this.objectUrls).forEach(url => {
            URL.revokeObjectURL(url);
        });
    }
}

class SendTextDialog extends Dialog {
    constructor() {
        super('send-text-dialog');
        this.setupSendButton();
    }

    setupSendButton() {
        $('send-text-button').addEventListener('click', () => {
            const text = $('text-input').textContent;
            if (!text.trim()) return;
            
            Events.fire('send-text', {
                text: text,
                to: this.peerId
            });
            
            // Fire event for sound
            Events.fire('text-sent');
            
            $('text-input').textContent = '';
            this.hide();
        });
        
        // Add enter key support
        const textInput = $('text-input');
        textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                $('send-text-button').click();
            }
        });
    }

    show(peerId) {
        this.peerId = peerId;
        super.show();
        setTimeout(() => $('text-input').focus(), 100);
    }
}

// Enhanced ReceiveTextDialog with reply functionality
class ReceiveTextDialog extends Dialog {
    constructor() {
        super('receive-text-dialog');
        this.setupCopyButton();
        this.setupReplyButton();
    }

    setupCopyButton() {
        $('copy-text').addEventListener('click', () => {
            this.copyText();
        });
    }

    setupReplyButton() {
        $('reply-button').addEventListener('click', () => {
            this.sendReply();
        });

        // Add enter key support for reply input
        const replyInput = $('reply-input');
        replyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendReply();
            }
        });
    }

    showText(text, senderId) {
        const textElement = $('received-text');
        textElement.innerHTML = '';
        
        // Store the sender ID for replying
        this.currentSender = senderId;
        
        if (isURL(text)) {
            const link = document.createElement('a');
            link.href = text.startsWith('http') ? text : `http://${text}`;
            link.target = '_blank';
            link.textContent = text;
            textElement.appendChild(link);
        } else {
            textElement.textContent = text;
        }
        
        this.text = text;
        
        // Clear the reply input
        $('reply-input').textContent = '';
        
        // Show the dialog
        this.show();
        
        // Focus on the reply input
        setTimeout(() => $('reply-input').focus(), 300);
    }

    sendReply() {
        const reply = $('reply-input').textContent.trim();
        if (!reply || !this.currentSender) return;
        
        // Send the reply message to the original sender
        Events.fire('send-text', {
            text: reply,
            to: this.currentSender
        });
        
        // Play sent sound
        Events.fire('text-sent');
        
        // Clear the reply input
        $('reply-input').textContent = '';
        
        // Show confirmation
        Events.fire('notify-user', 'Reply sent');
        
        // Hide dialog
        this.hide();
    }

    copyText() {
        if (!navigator.clipboard) {
            this.legacyCopy();
            return;
        }
        
        navigator.clipboard.writeText(this.text)
            .then(() => Events.fire('notify-user', 'Text copied to clipboard'))
            .catch(err => console.error('Could not copy text:', err));
    }

    legacyCopy() {
        const textArea = document.createElement('textarea');
        textArea.value = this.text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = 0;
        document.body.appendChild(textArea);
        textArea.select();
        
        try {
            document.execCommand('copy');
            Events.fire('notify-user', 'Text copied to clipboard');
        } catch (err) {
            console.error('Could not copy text:', err);
        }
        
        document.body.removeChild(textArea);
    }
}

class ActionDialog extends Dialog {
    constructor() {
        super('action-dialog');
        this.setupActionButtons();
    }

    setupActionButtons() {
        $('send-file-button').addEventListener('click', () => {
            this.hide();
            this.selectFiles();
        });
        
        $('send-text-action').addEventListener('click', () => {
            this.hide();
            // Show send text dialog
            drplUI.dialogs.sendText.show(drplUI.currentPeer);
        });
        
        $('file-input').addEventListener('change', e => {
            const files = e.target.files;
            if (!files.length) return;
            
            Events.fire('files-selected', {
                files: files,
                to: drplUI.currentPeer
            });
            
            // Fire event for sound
            Events.fire('file-sent');
            
            e.target.value = null; // Reset input
        });
    }

    show(peerName) {
        $('action-title').textContent = `Connect with ${peerName}`;
        super.show();
    }

    selectFiles() {
        $('file-input').click();
    }
}

// Updated Transfer Progress Dialog with close button and improved closing behavior
class TransferProgressDialog extends Dialog {
    constructor() {
        super('transfer-progress-dialog');
        this.reset();
        this.activeTransfers = {};
        this.lastUpdateTime = Date.now();
        this.lastBytes = 0;
        this.setupEscapeKey();
        this.setupManualClose();
    }
    
    setupEscapeKey() {
        // Add keyboard Escape key support
        this._keyHandler = (e) => {
            // Only process if dialog is active
            if (!this.element.classList.contains('active')) return;
            
            if (e.key === 'Escape') {
                this.hide();
                e.preventDefault();
            }
        };
        
        window.addEventListener('keydown', this._keyHandler);
    }
    
    setupManualClose() {
        // Add event listener to the close button
        const closeButton = $('close-transfer');
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                this.hide();
            });
        }
    }
    
    reset() {
        this.totalFiles = 0;
        this.currentFile = 0;
        this.fileName = '';
        this.progress = 0;
    }
    
    startTransfer(peerId, fileName, fileCount = 1, fileSize = 0) {
        this.activeTransfers[peerId] = {
            totalFiles: fileCount,
            currentFile: 1,
            fileName: fileName,
            progress: 0,
            fileSize: fileSize,
            bytesTransferred: 0,
            startTime: Date.now(),
            lastUpdateTime: Date.now(),
            lastBytes: 0
        };
        
        // Set dialog title based on transfer direction
        $('transfer-title').textContent = 'Sending File' + (fileCount > 1 ? 's' : '');
        
        this.updateUI(peerId);
        this.show();
    }
    
    startReceiving(peerId, fileName, fileSize = 0) {
        this.activeTransfers[peerId] = {
            totalFiles: 1, // We might not know the total count yet
            currentFile: 1,
            fileName: fileName,
            progress: 0,
            fileSize: fileSize,
            bytesTransferred: 0,
            startTime: Date.now(),
            lastUpdateTime: Date.now(),
            lastBytes: 0,
            isReceiving: true
        };
        
        // Set dialog title for receiving
        $('transfer-title').textContent = 'Receiving File';
        
        this.updateUI(peerId);
        this.show();
    }
    
    updateProgress(peerId, progress, bytesTransferred = 0) {
        if (!this.activeTransfers[peerId]) return;
        
        const transfer = this.activeTransfers[peerId];
        transfer.progress = progress;
        
        // Update bytes transferred if provided
        if (bytesTransferred > 0) {
            transfer.bytesTransferred = bytesTransferred;
        }
        
        // Calculate transfer speed
        const now = Date.now();
        const timeDiff = (now - transfer.lastUpdateTime) / 1000; // Convert to seconds
        
        if (timeDiff > 0.5) { // Update every 500ms
            const bytesDiff = transfer.bytesTransferred - transfer.lastBytes;
            const speed = bytesDiff / timeDiff; // Bytes per second
            
            transfer.speed = speed;
            transfer.lastUpdateTime = now;
            transfer.lastBytes = transfer.bytesTransferred;
        }
        
        this.updateUI(peerId);
        
        // Auto-close if transfer completed
        if (progress >= 1) {
            // Mark the transfer as completed
            transfer.completed = true;
            
            // Check if all transfers are completed
            this.checkAndHideIfDone();
        }
    }
    
    checkAndHideIfDone() {
        // Check if all active transfers are completed
        const allCompleted = Object.values(this.activeTransfers).every(transfer => 
            transfer.completed || transfer.progress >= 1
        );
        
        if (allCompleted && Object.keys(this.activeTransfers).length > 0) {
            // Give a short delay to show completion state before closing
            setTimeout(() => {
                this.hide();
                this.activeTransfers = {}; // Clear the transfers
            }, 1500);
        }
    }
    
    nextFile(peerId, fileName) {
        if (!this.activeTransfers[peerId]) return;
        
        this.activeTransfers[peerId].currentFile++;
        this.activeTransfers[peerId].progress = 0;
        
        if (fileName) {
            this.activeTransfers[peerId].fileName = fileName;
        }
        
        this.updateUI(peerId);
    }
    
    updateUI(peerId) {
        const transfer = this.activeTransfers[peerId];
        if (!transfer) return;
        
        $('current-transfer-file').textContent = transfer.currentFile;
        $('total-transfer-files').textContent = transfer.totalFiles;
        $('transfer-filename').textContent = transfer.fileName || '';
        
        const percentage = Math.round(transfer.progress * 100);
        document.querySelector('.progress-percentage').textContent = `${percentage}%`;
        
        // Update transfer speed if available
        if (transfer.speed !== undefined) {
            $('transfer-speed').textContent = this._formatSpeed(transfer.speed);
        }
    }
    
    _formatSpeed(bytesPerSecond) {
        if (bytesPerSecond >= 1e6) {
            return (Math.round(bytesPerSecond / 1e5) / 10) + ' MB/s';
        } else if (bytesPerSecond >= 1e3) {
            return Math.round(bytesPerSecond / 1e3) + ' KB/s';
        } else {
            return Math.round(bytesPerSecond) + ' B/s';
        }
    }
    
    endTransfer(peerId) {
        if (!this.activeTransfers[peerId]) return;
        
        // Mark this transfer as completed
        this.activeTransfers[peerId].completed = true;
        this.activeTransfers[peerId].progress = 1;
        
        // Update the UI to show 100%
        this.updateUI(peerId);
        
        // Check if we should hide the dialog
        this.checkAndHideIfDone();
    }
    
    // Override the hide method to ensure we clean up properly
    hide() {
        super.hide();
        // Clean up on hide
        setTimeout(() => {
            this.activeTransfers = {};
        }, 300);
    }
    
    // Clean up resources when the component is destroyed
    destroy() {
        // Remove event listeners
        window.removeEventListener('keydown', this._keyHandler);
    }
}

// Initialize the UI
let drplUI;
document.addEventListener('DOMContentLoaded', () => {
    drplUI = new DrplUI();
    
    // Use the NotificationManager if available
    if (window.NotificationManager) {
        window.notificationHandler = window.NotificationManager.init();
    }
    
    // Initialize background animation
    if (window.BackgroundAnimation) {
        window.backgroundAnimation = new BackgroundAnimation();
    }
    
    // Expose UI to window for debugging
    window.drplUI = drplUI;
});