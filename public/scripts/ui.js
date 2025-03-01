/**
 * drpl.co - UI Javascript
 * Handles user interface interactions, file displays, and user feedback
 */

// Helper functions for common tasks
const $ = id => document.getElementById(id);
const isURL = text => /^((https?:\/\/|www)[^\s]+)/g.test(text.toLowerCase());
const isDownloadSupported = typeof document.createElement('a').download !== 'undefined';

/**
 * Main UI Controller
 * Central class that manages user interface and events
 */
class DrplUI {
    constructor() {
        this.currentPeer = null;
        this.initializeEvents();
        this.initializeDialogs();
        this.initializeSounds();
    }

    /**
     * Set up event listeners for peer and file interactions
     */
    initializeEvents() {
        // Peer discovery and management events
        Events.on('peer-joined', e => this.onPeerJoined(e.detail));
        Events.on('peer-left', e => this.onPeerLeft(e.detail));
        Events.on('peers', e => this.onPeers(e.detail));
        Events.on('display-name', e => this.onDisplayName(e.detail));
        Events.on('peer-connection-established', peerId => this.onPeerConnected(peerId));
        
        // File transfer events
        Events.on('file-progress', e => this.onFileProgress(e.detail));
        Events.on('file-received', e => this.onFileReceived(e.detail));
        Events.on('file-transfer-complete', () => this.onFileTransferComplete());
        Events.on('file-send-start', e => this.handleFileSendStart(e.detail.files, e.detail.to));
        Events.on('file-receive-start', e => this.handleFileReceiveStart(e.detail.header, e.detail.from));
        
        // Text messaging events
        Events.on('text-received', e => this.onTextReceived(e.detail));
        
        // UI notification events
        Events.on('notify-user', e => this.showToast(e.detail));
        Events.on('file-sent', () => this.playSentSound());
        Events.on('text-sent', () => this.playSentSound());
        
        // Add refresh button events
        if ($('refresh-connection')) {
            $('refresh-connection').addEventListener('click', () => {
                this.refreshConnections();
                Events.fire('notify-user', 'Refreshing connections...');
            });
        }
        
        // Add manual page refresh button for PWA users
        if ($('manual-refresh')) {
            $('manual-refresh').addEventListener('click', () => {
                window.location.reload();
            });
        }
    }

    /**
     * Initialize all dialog components
     */
    initializeDialogs() {
        this.dialogs = {
            receive: new ReceiveDialog(),
            sendText: new SendTextDialog(),
            receiveText: new ReceiveTextDialog(),
            action: new ActionDialog(),
            transferProgress: new TransferProgressDialog()
        };
    }

    /**
     * Initialize sound effects for user feedback
     */
    initializeSounds() {
        this.sentSound = $('sent-sound');
    }

    /**
     * Play sound effect when an item is sent
     */
    playSentSound() {
        if (this.sentSound) {
            this.sentSound.currentTime = 0;
            this.sentSound.play().catch(err => console.log('Sound play failed:', err));
        }
    }

    /**
     * Handle when a new peer joins the network
     * @param {Object} peer - Peer information
     */
    onPeerJoined(peer) {
        if ($(peer.id)) return; // Peer already exists
        this.createPeerElement(peer);
    }

    /**
     * Handle multiple peers being discovered
     * @param {Array} peers - List of peers
     */
    onPeers(peers) {
        this.clearPeers();
        peers.forEach(peer => this.onPeerJoined(peer));
    }

    /**
     * Handle when a peer leaves the network
     * @param {string} peerId - ID of the departing peer
     */
    onPeerLeft(peerId) {
        const peerElement = $(peerId);
        if (peerElement) {
            peerElement.remove();
        }
    }

    /**
     * Handle successful connection to a peer
     * @param {string} peerId - ID of the connected peer
     */
    onPeerConnected(peerId) {
        const peerElement = $(peerId);
        if (peerElement) {
            peerElement.classList.add('connected');
        }
    }

    /**
     * Update display name information
     * @param {Object} data - Display name data
     */
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

    /**
     * Update progress indicators during file transfer
     * @param {Object} progress - Progress data
     */
    onFileProgress(progress) {
        const peerId = progress.sender;
        const peerElement = $(peerId);
        if (!peerElement) return;
        
        // Update the peer element progress for visual feedback
        this.setPeerProgress(peerElement, progress.progress);
        
        // Also update the progress dialog
        this.dialogs.transferProgress.updateProgress(peerId, progress.progress, progress.bytesTransferred);
    }

    /**
     * Handle a completed file reception
     * @param {Object} file - The received file
     */
    onFileReceived(file) {
        // Add the file to the receive dialog
        this.dialogs.receive.addFile(file);
        
        // End the transfer in the progress dialog
        this.dialogs.transferProgress.endTransfer(file.sender);
    }

    /**
     * Handle when a file transfer completes
     */
    onFileTransferComplete() {
        console.log("File transfer completed");
        
        // Ensure the progress dialog is properly updated or hidden
        setTimeout(() => {
            this.dialogs.transferProgress.checkAndHideIfDone();
        }, 500);
    }

    /**
     * Handle received text messages
     * @param {Object} message - The received message
     */
    onTextReceived(message) {
        this.dialogs.receiveText.showText(message.text, message.sender);
    }

    /**
     * Display a toast notification to the user
     * @param {string} message - Message to display
     */
    showToast(message) {
        const toast = $('toast');
        toast.textContent = message;
        toast.classList.add('active');
        
        setTimeout(() => {
            toast.classList.remove('active');
        }, 3000);
    }

    /**
     * Clear all peers from the display
     */
    clearPeers() {
        $('peers').innerHTML = '';
    }

    /**
     * Create and display a peer element
     * @param {Object} peer - Peer data 
     */
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

    /**
     * Determine device type from peer information
     * @param {Object} name - Peer name information
     * @returns {string} Device type
     */
    getDeviceType(name) {
        if (name.type === 'mobile') return 'mobile';
        if (name.type === 'tablet') return 'tablet';
        return 'desktop';
    }

    /**
     * Get appropriate icon for device type
     * @param {string} type - Device type
     * @returns {string} FontAwesome icon class
     */
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

    /**
     * Update progress indicator on peer element
     * @param {Element} peerElement - DOM element for the peer
     * @param {number} progress - Progress value (0-1)
     */
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

    /**
     * Handle initiation of file sending
     * @param {Array} files - Files to send
     * @param {string} peerId - Target peer ID
     */
    handleFileSendStart(files, peerId) {
        // Start the transfer progress dialog
        this.dialogs.transferProgress.startTransfer(
            peerId, 
            files.length > 1 ? `${files.length} files` : files[0].name,
            files.length,
            files.length > 0 ? files[0].size : 0
        );
    }

    /**
     * Handle start of file reception
     * @param {Object} fileHeader - File metadata
     * @param {string} peerId - Source peer ID
     */
    handleFileReceiveStart(fileHeader, peerId) {
        // Start the transfer progress dialog for receiving
        this.dialogs.transferProgress.startReceiving(
            peerId,
            fileHeader.name,
            fileHeader.size
        );
    }
    
    /**
     * Refresh all peer connections
     * Used to maintain connectivity without requiring page refresh
     */
    refreshConnections() {
        // Refresh all peer connections
        if (window.drplNetwork && window.drplNetwork.peers) {
            if (window.drplNetwork.peers.refreshAllPeers) {
                window.drplNetwork.peers.refreshAllPeers();
            } else {
                // Fallback to individual peer refresh
                for (const peerId in window.drplNetwork.peers.peers) {
                    const peer = window.drplNetwork.peers.peers[peerId];
                    if (peer && peer.refresh) {
                        peer.refresh();
                    }
                }
            }
        }
        
        // Reconnect to server if needed
        if (window.drplNetwork && window.drplNetwork.server) {
            window.drplNetwork.server._connect();
        }
    }
}

/**
 * Base Dialog Class
 * Parent class for all modal dialogs
 */
class Dialog {
    /**
     * @param {string} id - DOM ID of the dialog
     */
    constructor(id) {
        this.element = $(id);
        this.setupCloseButtons();
    }

    /**
     * Set up event listeners for close buttons
     */
    setupCloseButtons() {
        const closeButtons = this.element.querySelectorAll('[id^="close-"]');
        closeButtons.forEach(button => {
            button.addEventListener('click', () => this.hide());
        });
    }

    /**
     * Show the dialog
     */
    show() {
        this.element.classList.add('active');
    }

    /**
     * Hide the dialog
     */
    hide() {
        this.element.classList.remove('active');
        
        // Refresh connections when dialog closes
        if (window.drplUI) {
            setTimeout(() => {
                window.drplUI.refreshConnections();
            }, 300);
        }
    }
}

/**
 * ReceiveDialog - Enhanced dialog for displaying received files
 * Features carousel navigation and file previews
 */
class ReceiveDialog extends Dialog {
    constructor() {
        super('receive-dialog');
        this.files = [];
        this.currentIndex = 0;
        this.objectUrls = {}; // Store URLs to prevent memory leaks
        this.isTransitioning = false; // Flag to prevent rapid clicking
        this._setupCarousel();
        this._setupDownloadButtons();
        this._setupKeyboardNavigation();
        this._setupTouchNavigation();
    }

    /**
     * Set up carousel navigation controls
     */
    _setupCarousel() {
        // Navigation buttons - using direct DOM event attachment
        const prevButton = $('carousel-prev');
        const nextButton = $('carousel-next');
        
        // Add mousedown event to prevent default behavior completely
        prevButton.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        
        nextButton.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        
        // Add click handlers with improved event handling
        prevButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Prevent interaction during transitions
            if (this.isTransitioning) return;
            
            this.showPreviousFile();
            return false;
        });
        
        nextButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Prevent interaction during transitions
            if (this.isTransitioning) return;
            
            this.showNextFile();
            return false;
        });
        
        // Item container
        this.carouselContainer = this.element.querySelector('.carousel-item-container');
    }

    /**
     * Set up download buttons
     */
    _setupDownloadButtons() {
        // Current file download
        $('download-current').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (this.files.length > 0) {
                this.downloadFile(this.files[this.currentIndex]);
            }
        });
        
        // Download all as zip
        $('download-all').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            this.downloadAllFiles();
        });
    }
    
    /**
     * Set up keyboard navigation
     */
    _setupKeyboardNavigation() {
        // Add keyboard navigation support
        this._keyHandler = (e) => {
            // Only process if dialog is active and not transitioning
            if (!this.element.classList.contains('active') || this.isTransitioning) return;
            
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                this.showPreviousFile();
                e.preventDefault();
                e.stopPropagation();
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                this.showNextFile();
                e.preventDefault();
                e.stopPropagation();
            } else if (e.key === 'Escape') {
                this.hide();
                e.preventDefault();
                e.stopPropagation();
            }
        };
        
        // Use a separate event listener for this dialog's keyboard navigation
        document.addEventListener('keydown', this._keyHandler, true); // Use capture phase
    }
    
    /**
     * Set up touch navigation for mobile devices
     */
    _setupTouchNavigation() {
        // Add touch navigation support for mobile devices
        let startX, startY;
        let isSwiping = false;
        
        // We need to listen on the dialog container level instead of just the carousel
        const dialogContent = this.element.querySelector('.dialog-content');
        
        dialogContent.addEventListener('touchstart', (e) => {
            // Don't start a swipe if we're in transition
            if (this.isTransitioning) return;
            
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isSwiping = true;
            
            // Prevent default only when needed
            if (e.target.closest('.carousel-item-container')) {
                // We're touching inside the carousel
                e.stopPropagation();
            }
        }, { passive: true });
        
        dialogContent.addEventListener('touchmove', (e) => {
            // Detect horizontal swipe and prevent page scroll if needed
            if (!isSwiping || !startX || !startY) return;
            
            const currentX = e.touches[0].clientX;
            const currentY = e.touches[0].clientY;
            
            const diffX = startX - currentX;
            const diffY = startY - currentY;
            
            // If horizontal swipe is more significant than vertical, prevent default scrolling
            if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) {
                e.preventDefault();
            }
        }, { passive: false }); // Need passive: false to be able to preventDefault
        
        dialogContent.addEventListener('touchend', (e) => {
            if (!isSwiping || this.isTransitioning || !startX || !startY) {
                isSwiping = false;
                return;
            }
            
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
                
                // Prevent other handlers if we're handling this as a swipe
                e.preventDefault();
                e.stopPropagation();
            }
            
            // Reset
            startX = null;
            startY = null;
            isSwiping = false;
        }, { passive: false }); // Need passive: false to be able to preventDefault
    }

    /**
     * Add a file to the carousel
     * @param {Object} file - File to add
     */
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
    
    /**
     * Display the currently selected file
     */
    displayCurrentFile() {
        if (this.files.length === 0) return;
        
        // Set transition flag
        this.isTransitioning = true;
        
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
                // Release transition lock
                this.isTransitioning = false;
            }, 300);
        }, 150); // Slight delay to allow fade-out animation
    }
    
    /**
     * Navigate to the next file
     * @returns {boolean} True if navigation was successful
     */
    showNextFile() {
        if (this.isTransitioning) return false;
        
        if (this.currentIndex < this.files.length - 1) {
            this.currentIndex++;
            this.displayCurrentFile();
            return true;
        }
        return false;
    }
    
    /**
     * Navigate to the previous file
     * @returns {boolean} True if navigation was successful
     */
    showPreviousFile() {
        if (this.isTransitioning) return false;
        
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.displayCurrentFile();
            return true;
        }
        return false;
    }
    
    /**
     * Update the file counter display
     */
    _updateFileCounter() {
        const currentElement = $('current-file');
        const totalElement = $('total-files');
        
        if (currentElement && totalElement) {
            currentElement.textContent = this.files.length > 0 ? this.currentIndex + 1 : 0;
            totalElement.textContent = this.files.length;
        }
    }
    
    /**
     * Update navigation button states
     */
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
    
    /**
     * Get appropriate icon class based on file type
     * @param {string} mimeType - MIME type of the file
     * @returns {string} FontAwesome icon class
     */
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
    
    /**
     * Download a single file
     * @param {Object} file - File to download
     */
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
    
    /**
     * Download all files as a ZIP archive
     */
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
    
    /**
     * Format file size for display
     * @param {number} bytes - Size in bytes
     * @returns {string} Formatted size string
     */
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
    
    /**
     * Override hide method to prevent hiding during transitions
     */
    hide() {
        // Only allow hiding if not in transition
        if (this.isTransitioning) return;
        
        super.hide();
    }
    
    /**
     * Override show method to ensure we're not in transition
     */
    show() {
        this.isTransitioning = false;
        super.show();
        
        // Make sure buttons are properly updated when showing
        this._updateNavButtons();
    }
    
    /**
     * Clear all files (used when resetting the dialog)
     */
    clearFiles() {
        // Revoke all object URLs first to prevent memory leaks
        Object.values(this.objectUrls).forEach(url => {
            URL.revokeObjectURL(url);
        });
        
        this.files = [];
        this.objectUrls = {};
        this.currentIndex = 0;
        this.isTransitioning = false;
        this._updateFileCounter();
        this._updateNavButtons();
        this.carouselContainer.innerHTML = '';
    }
    
    /**
     * Clean up resources when the component is destroyed
     */
    destroy() {
        // Remove event listeners
        document.removeEventListener('keydown', this._keyHandler, true);
        
        // Revoke object URLs
        Object.values(this.objectUrls).forEach(url => {
            URL.revokeObjectURL(url);
        });
    }
}

/**
 * SendTextDialog - Dialog for sending text messages
 */
class SendTextDialog extends Dialog {
    constructor() {
        super('send-text-dialog');
        this.setupSendButton();
    }

    /**
     * Set up the send button and keyboard shortcuts
     */
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

    /**
     * Show the dialog for a specific peer
     * @param {string} peerId - Target peer ID
     */
    show(peerId) {
        this.peerId = peerId;
        super.show();
        setTimeout(() => $('text-input').focus(), 100);
    }
    
    /**
     * Override hide to refresh connection after sending text
     */
    hide() {
        super.hide();
        
        // Refresh the specific peer connection if available
        if (window.drplUI && window.drplUI.currentPeer && window.drplNetwork && window.drplNetwork.peers) {
            const peer = window.drplNetwork.peers.peers[window.drplUI.currentPeer];
            if (peer && peer.refresh) {
                setTimeout(() => peer.refresh(), 300);
            }
        }
    }
}

/**
 * ReceiveTextDialog - Dialog for displaying received messages with reply option
 */
class ReceiveTextDialog extends Dialog {
    constructor() {
        super('receive-text-dialog');
        this.setupCopyButton();
        this.setupReplyButton();
    }

    /**
     * Set up the copy to clipboard button
     */
    setupCopyButton() {
        $('copy-text').addEventListener('click', () => {
            this.copyText();
        });
    }

    /**
     * Set up the reply button and keyboard shortcuts
     */
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

    /**
     * Display received text message
     * @param {string} text - Message text
     * @param {string} senderId - ID of the sender
     */
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

    /**
     * Send a reply to the received message
     */
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

    /**
     * Copy text to clipboard
     */
    copyText() {
        if (!navigator.clipboard) {
            this.legacyCopy();
            return;
        }
        
        navigator.clipboard.writeText(this.text)
            .then(() => Events.fire('notify-user', 'Text copied to clipboard'))
            .catch(err => console.error('Could not copy text:', err));
    }

    /**
     * Fallback copy method for browsers without clipboard API
     */
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
    
    /**
     * Override hide to refresh the connection to the sender
     */
    hide() {
        super.hide();
        
        // Refresh connection to the sender if available
        if (this.currentSender && window.drplNetwork && window.drplNetwork.peers) {
            const peer = window.drplNetwork.peers.peers[this.currentSender];
            if (peer && peer.refresh) {
                setTimeout(() => peer.refresh(), 300);
            }
        }
    }
}

/**
 * ActionDialog - Dialog for selecting actions to perform with a peer
 */
class ActionDialog extends Dialog {
    constructor() {
        super('action-dialog');
        this.setupActionButtons();
    }

    /**
     * Set up action buttons for sending files and messages
     */
    setupActionButtons() {
        $('send-file-button').addEventListener('click', () => {
            this.hide();
            this.selectFiles();
        });
        
        $('send-text-action').addEventListener('click', () => {
            this.hide();
            // Show send text dialog
            if (window.drplUI && window.drplUI.dialogs) {
                window.drplUI.dialogs.sendText.show(window.drplUI.currentPeer);
            }
        });
        
        $('file-input').addEventListener('change', e => {
            const files = e.target.files;
            if (!files.length) return;
            
            Events.fire('files-selected', {
                files: files,
                to: window.drplUI.currentPeer
            });
            
            // Fire event for sound
            Events.fire('file-sent');
            
            e.target.value = null; // Reset input
        });
    }

    /**
     * Show the dialog with peer name
     * @param {string} peerName - Name of the peer
     */
    show(peerName) {
        $('action-title').textContent = `Connect with ${peerName}`;
        super.show();
    }

    /**
     * Trigger file selection dialog
     */
    selectFiles() {
        $('file-input').click();
    }
    
    /**
     * Override hide to ensure the peer connection stays alive
     */
    hide() {
        super.hide();
        
        // Refresh the specific peer connection
        if (window.drplUI && window.drplUI.currentPeer && window.drplNetwork && window.drplNetwork.peers) {
            const peer = window.drplNetwork.peers.peers[window.drplUI.currentPeer];
            if (peer && peer.refresh) {
                setTimeout(() => peer.refresh(), 300);
            }
        }
    }
}

/**
 * TransferProgressDialog - Dialog for displaying file transfer progress
 */
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
    
    /**
     * Set up escape key to close dialog
     */
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
    
    /**
     * Set up manual close button
     */
    setupManualClose() {
        // Add event listener to the close button
        const closeButton = $('close-transfer');
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                this.hide();
            });
        }
    }
    
    /**
     * Reset transfer state
     */
    reset() {
        this.totalFiles = 0;
        this.currentFile = 0;
        this.fileName = '';
        this.progress = 0;
    }
    
    /**
     * Initialize dialog for sending files
     * @param {string} peerId - Target peer ID
     * @param {string} fileName - File name
     * @param {number} fileCount - Number of files
     * @param {number} fileSize - Size of first file
     */
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
    
    /**
     * Initialize dialog for receiving files
     * @param {string} peerId - Source peer ID
     * @param {string} fileName - File name
     * @param {number} fileSize - File size
     */
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
    
    /**
     * Update progress for an active transfer
     * @param {string} peerId - Peer ID
     * @param {number} progress - Progress (0-1)
     * @param {number} bytesTransferred - Bytes transferred
     */
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
    
    /**
     * Check if all transfers are complete and hide dialog if so
     */
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
    
    /**
     * Move to next file in multi-file transfer
     * @param {string} peerId - Peer ID
     * @param {string} fileName - Name of next file
     */
    nextFile(peerId, fileName) {
        if (!this.activeTransfers[peerId]) return;
        
        this.activeTransfers[peerId].currentFile++;
        this.activeTransfers[peerId].progress = 0;
        
        if (fileName) {
            this.activeTransfers[peerId].fileName = fileName;
        }
        
        this.updateUI(peerId);
    }
    
    /**
     * Update UI elements with current transfer state
     * @param {string} peerId - Peer ID
     */
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
    
    /**
     * Format transfer speed for display
     * @param {number} bytesPerSecond - Transfer speed
     * @returns {string} Formatted speed string
     */
    _formatSpeed(bytesPerSecond) {
        if (bytesPerSecond >= 1e6) {
            return (Math.round(bytesPerSecond / 1e5) / 10) + ' MB/s';
        } else if (bytesPerSecond >= 1e3) {
            return Math.round(bytesPerSecond / 1e3) + ' KB/s';
        } else {
            return Math.round(bytesPerSecond) + ' B/s';
        }
    }
    
    /**
     * Mark a transfer as complete
     * @param {string} peerId - Peer ID 
     */
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
    
    /**
     * Override hide method to ensure clean-up and connection refresh
     */
    hide() {
        super.hide();
        
        // Clean up on hide
        setTimeout(() => {
            this.activeTransfers = {};
            
            // Refresh all connections after transfer completes
            if (window.drplUI) {
                window.drplUI.refreshConnections();
            }
        }, 300);
    }
    
    /**
     * Clean up resources
     */
    destroy() {
        // Remove event listeners
        window.removeEventListener('keydown', this._keyHandler);
    }
}

// Initialize the UI when the DOM is fully loaded
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
    
    // Add manual refresh button for PWA users
    if ($('manual-refresh')) {
        $('manual-refresh').addEventListener('click', () => {
            window.location.reload();
        });
    }
    
    // Set up periodic connection refresh in the background
    // This helps maintain connections even during periods of inactivity
    setInterval(() => {
        if (window.drplUI) {
            window.drplUI.refreshConnections();
        }
    }, 60000); // Every minute
    
    // Expose UI to window for debugging
    window.drplUI = drplUI;
});