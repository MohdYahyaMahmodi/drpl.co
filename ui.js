// Helper functions
const $ = id => document.getElementById(id);
const isURL = text => /^((https?:\/\/|www)[^\s]+)/g.test(text.toLowerCase());
const isDownloadSupported = typeof document.createElement('a').download !== 'undefined';

// Security helper to prevent XSS attacks
const sanitizeText = (text) => {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

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
    }

    initializeDialogs() {
        // Initialize dialogs
        this.dialogs = {
            receive: new ReceiveDialog(),
            sendText: new SendTextDialog(),
            receiveText: new ReceiveTextDialog(),
            action: new ActionDialog()
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
        
        // We don't close dialogs when peers leave, files should still be accessible
        // This comment is intentionally left here to document the change
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
        
        this.setPeerProgress(peerElement, progress.progress);
    }

    onFileReceived(file) {
        this.dialogs.receive.addFile(file);
    }

    onTextReceived(message) {
        this.dialogs.receiveText.showText(message.text, message.sender);
    }

    showToast(message) {
        const toast = $('toast');
        toast.textContent = sanitizeText(message);
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
        
        // Use sanitized values to prevent XSS
        const displayName = sanitizeText(peer.name.displayName);
        const deviceName = sanitizeText(peer.name.deviceName);
        
        peerElement.innerHTML = `
            <div class="peer-icon">
                <i class="${deviceIcon}"></i>
            </div>
            <div class="progress-circle"></div>
            <div class="peer-name">${displayName}</div>
            <div class="peer-device">${deviceName}</div>
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
        
        if (progress >= 1) {
            setTimeout(() => {
                peerElement.removeAttribute('transfer');
            }, 500);
        }
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
        this._setupCarousel();
        this._setupDownloadButtons();
        this._setupTouchEvents();
    }

    _setupCarousel() {
        // Navigation buttons - using onclick instead of addEventListener for better compatibility
        const prevButton = $('carousel-prev');
        const nextButton = $('carousel-next');
        
        prevButton.onclick = () => this.showPreviousFile();
        nextButton.onclick = () => this.showNextFile();
        
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
        
        // Close button
        $('close-receive').addEventListener('click', () => {
            this.hide();
        });
    }

    _setupTouchEvents() {
        // Add touch swipe support for mobile
        let touchStartX = 0;
        let touchEndX = 0;
        
        this.carouselContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        
        this.carouselContainer.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            this._handleSwipe(touchStartX, touchEndX);
        }, { passive: true });
    }
    
    _handleSwipe(startX, endX) {
        const threshold = 50; // Minimum pixel distance for a swipe
        
        if (startX - endX > threshold) {
            // Swipe left, show next file
            this.showNextFile();
        } else if (endX - startX > threshold) {
            // Swipe right, show previous file
            this.showPreviousFile();
        }
    }

    // Add a file to the carousel
    addFile(file) {
        // Add to files array
        this.files.push(file);
        
        // If this is the first file, display it
        if (this.files.length === 1) {
            this.show();
            this.displayCurrentFile();
        } else {
            // Just update counter if dialog is already visible
            this._updateFileCounter();
        }
    }
    
    // Show the file at the current index
    displayCurrentFile() {
        if (this.files.length === 0) return;
        
        const file = this.files[this.currentIndex];
        if (!file) {
            console.error('No file found at index', this.currentIndex);
            return;
        }
        
        const url = URL.createObjectURL(file.blob);
        
        // Clear the container
        this.carouselContainer.innerHTML = '';
        
        // Create file display element
        const fileItem = document.createElement('div');
        fileItem.className = 'carousel-item';
        
        // File info
        const fileInfo = document.createElement('div');
        fileInfo.className = 'file-info';
        
        const fileName = document.createElement('div');
        fileName.className = 'file-name';
        fileName.textContent = sanitizeText(file.name);
        
        const fileSize = document.createElement('div');
        fileSize.className = 'file-size';
        fileSize.textContent = this._formatFileSize(file.size);
        
        fileInfo.appendChild(fileName);
        fileInfo.appendChild(fileSize);
        fileItem.appendChild(fileInfo);
        
        // Extract file extension
        const fileExt = this._getFileExtension(file.name);
        
        // Preview if it's an image
        if (file.mime.startsWith('image/')) {
            const preview = document.createElement('div');
            preview.className = 'preview';
            
            const image = document.createElement('img');
            image.src = url;
            image.alt = sanitizeText(file.name);
            image.className = 'carousel-image';
            
            preview.appendChild(image);
            fileItem.appendChild(preview);
        } else {
            // Icon for non-image files
            const fileIcon = document.createElement('div');
            fileIcon.className = 'file-icon';
            
            const iconContainer = document.createElement('div');
            iconContainer.className = 'file-type-container';
            
            const icon = document.createElement('i');
            icon.className = this._getFileIconClass(file.mime);
            
            // Add file extension display
            const extLabel = document.createElement('div');
            extLabel.className = 'file-extension';
            extLabel.textContent = fileExt ? fileExt.toUpperCase() : 'FILE';
            
            iconContainer.appendChild(icon);
            fileIcon.appendChild(iconContainer);
            fileIcon.appendChild(extLabel);
            fileItem.appendChild(fileIcon);
        }
        
        // Add to container
        this.carouselContainer.appendChild(fileItem);
        
        // Update navigation buttons
        this._updateFileCounter();
        this._updateNavButtons();
    }
    
    // Show the next file in the carousel
    showNextFile() {
        if (this.currentIndex < this.files.length - 1) {
            this.currentIndex++;
            this.displayCurrentFile();
        }
    }
    
    // Show the previous file in the carousel
    showPreviousFile() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.displayCurrentFile();
        }
    }
    
    // Update file counter display
    _updateFileCounter() {
        if (!this.files.length) return;
        
        const currentElem = $('current-file');
        const totalElem = $('total-files');
        
        if (currentElem && totalElem) {
            currentElem.textContent = this.currentIndex + 1;
            totalElem.textContent = this.files.length;
        }
    }
    
    // Update navigation button states
    _updateNavButtons() {
        const prevButton = $('carousel-prev');
        const nextButton = $('carousel-next');
        
        if (!prevButton || !nextButton) return;
        
        // Use a simpler approach - just set disabled attribute and let CSS handle the styling
        if (this.currentIndex <= 0) {
            prevButton.setAttribute('disabled', 'disabled');
        } else {
            prevButton.removeAttribute('disabled');
        }
        
        if (this.currentIndex >= this.files.length - 1) {
            nextButton.setAttribute('disabled', 'disabled');
        } else {
            nextButton.removeAttribute('disabled');
        }
    }
    
    // Get file extension
    _getFileExtension(filename) {
        if (!filename || typeof filename !== 'string') return '';
        const parts = filename.split('.');
        return parts.length > 1 ? parts.pop().toLowerCase() : '';
    }
    
    // Get appropriate icon class based on file type
    _getFileIconClass(mimeType) {
        if (!mimeType) return 'fas fa-file fa-4x';
        
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
        } else if (mimeType.includes('executable') || mimeType.includes('application/x-msdownload')) {
            return 'fas fa-file-code fa-4x';
        } else {
            return 'fas fa-file fa-4x';
        }
    }
    
    // Download a single file
    downloadFile(file) {
        if (!file || !file.blob) {
            console.error('Invalid file object:', file);
            return;
        }
        
        const url = URL.createObjectURL(file.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Clean up the URL object
        setTimeout(() => URL.revokeObjectURL(url), 100);
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
            setTimeout(() => URL.revokeObjectURL(url), 100);
            
            // Show success message
            Events.fire('notify-user', 'ZIP file created successfully');
        } catch (error) {
            console.error('Error creating ZIP file:', error);
            Events.fire('notify-user', 'Error creating ZIP file');
        }
    }
    
    _formatFileSize(bytes) {
        if (!bytes || isNaN(bytes)) return '0 Bytes';
        
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
        
        // Don't reset the files, just close the dialog
        // This allows reopening the dialog to see the files again
    }
    
    // Clear all files (called when a new session starts)
    clearFiles() {
        this.files = [];
        this.currentIndex = 0;
        this._updateFileCounter();
        if (this.carouselContainer) {
            this.carouselContainer.innerHTML = '';
        }
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
            link.rel = 'noopener noreferrer'; // Security best practice
            link.textContent = sanitizeText(text);
            textElement.appendChild(link);
        } else {
            textElement.textContent = sanitizeText(text);
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
        $('action-title').textContent = `Connect with ${sanitizeText(peerName)}`;
        super.show();
    }

    selectFiles() {
        $('file-input').click();
    }
}

// Notifications class
class Notifications {
    constructor() {
        // Check if the browser supports notifications
        if (!('Notification' in window)) return;
        
        // Initialize notification permissions
        this.checkPermission();
        
        // Setup notification event listeners
        Events.on('text-received', e => this.textNotification(e.detail));
        Events.on('file-received', e => this.fileNotification(e.detail));
    }
    
    checkPermission() {
        if (Notification.permission === 'granted') {
            this.hasPermission = true;
        } else if (Notification.permission !== 'denied') {
            // We need to ask for permission
            this.requestPermission();
        }
    }
    
    requestPermission() {
        Notification.requestPermission()
            .then(permission => {
                if (permission === 'granted') {
                    this.hasPermission = true;
                    this.notify('drpl.co', 'Notifications enabled');
                }
            });
    }
    
    notify(title, body, data = {}) {
        if (!this.hasPermission) return;
        if (document.visibilityState === 'visible') return;
        
        const notification = new Notification(sanitizeText(title), {
            body: sanitizeText(body),
            icon: 'favicon.png',
            data: data
        });
        
        notification.onclick = () => {
            window.focus();
            notification.close();
            
            if (data.action) {
                data.action();
            }
        };
        
        // Auto-close after 5 seconds
        setTimeout(() => notification.close(), 5000);
        
        return notification;
    }
    
    textNotification(data) {
        if (document.visibilityState === 'visible') return;
        
        const text = data.text;
        if (isURL(text)) {
            this.notify('New Link Received', text, {
                action: () => window.open(text, '_blank')
            });
        } else {
            this.notify('New Message', text.substring(0, 50) + (text.length > 50 ? '...' : ''), {
                action: () => drplUI.dialogs.receiveText.showText(text, data.sender)
            });
        }
    }
    
    fileNotification(file) {
        if (document.visibilityState === 'visible') return;
        
        this.notify('File Received', sanitizeText(file.name), {
            action: () => {
                drplUI.dialogs.receive.show();
            }
        });
    }
}

// Initialize the UI
let drplUI;
document.addEventListener('DOMContentLoaded', () => {
    drplUI = new DrplUI();
    new Notifications();
});