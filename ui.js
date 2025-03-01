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
    }

    onDisplayName(data) {
        $('display-name').textContent = `You are known as: ${data.displayName}`;
    }

    onFileProgress(progress) {
        const peerId = progress.sender;
        const peerElement = $(peerId);
        if (!peerElement) return;
        
        this.setPeerProgress(peerElement, progress.progress);
    }

    onFileReceived(file) {
        this.dialogs.receive.showFile(file);
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

class ReceiveDialog extends Dialog {
    constructor() {
        super('receive-dialog');
        this.setupDownloadButton();
        this._filesQueue = [];
    }

    setupDownloadButton() {
        $('download').addEventListener('click', () => {
            this.hide();
        });
    }

    showFile(file) {
        this._filesQueue.push(file);
        if (this._busy) return;
        this._displayNextFile();
    }

    _displayNextFile() {
        if (!this._filesQueue.length) return;
        
        this._busy = true;
        const file = this._filesQueue.shift();
        this._displayFile(file);
    }

    _displayFile(file) {
        const url = URL.createObjectURL(file.blob);
        const download = $('download');
        download.href = url;
        download.download = file.name;
        
        $('file-name').textContent = file.name;
        $('file-size').textContent = this._formatFileSize(file.size);
        
        // Show image preview if it's an image
        const preview = this.element.querySelector('.preview');
        if (file.mime.startsWith('image/')) {
            preview.style.display = 'block';
            $('img-preview').src = url;
        } else {
            preview.style.display = 'none';
        }
        
        this.show();
        
        // Auto-download on iOS as it doesn't support the download attribute
        if (!isDownloadSupported) {
            download.target = '_blank';
            const reader = new FileReader();
            reader.onload = () => download.href = reader.result;
            reader.readAsDataURL(file.blob);
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

    hide() {
        super.hide();
        setTimeout(() => {
            this._busy = false;
            if (this._filesQueue.length) {
                this._displayNextFile();
            }
        }, 300);
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

class ReceiveTextDialog extends Dialog {
    constructor() {
        super('receive-text-dialog');
        this.setupCopyButton();
    }

    setupCopyButton() {
        $('copy-text').addEventListener('click', () => {
            this.copyText();
            this.hide();
        });
    }

    showText(text, senderId) {
        const textElement = $('received-text');
        textElement.innerHTML = '';
        
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
        this.show();
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

// Initialize the UI
let drplUI;
document.addEventListener('DOMContentLoaded', () => {
    drplUI = new DrplUI();
});