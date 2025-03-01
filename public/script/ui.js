// UI Utility Functions
const $ = id => document.getElementById(id);
const $$ = query => document.querySelector(query);
const isURL = text => /^((https?:\/\/|www)[^\s]+)/g.test(text.toLowerCase());

// Browser feature detection
window.isDownloadSupported = (typeof document.createElement('a').download !== 'undefined');
window.isProductionEnvironment = !window.location.host.startsWith('localhost');
window.iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// Set display name when received from server
Events.on('display-name', e => {
    const me = e.detail.message;
    const $displayName = $('displayName');
    $displayName.textContent = 'You are known as ' + me.displayName;
    $displayName.title = me.deviceName;
});

class PeersUI {
    constructor() {
        this._peers = $('peers');
        this._template = $('peer-template');
        
        Events.on('peer-joined', e => this._onPeerJoined(e.detail));
        Events.on('peer-left', e => this._onPeerLeft(e.detail));
        Events.on('peers', e => this._onPeers(e.detail));
        Events.on('file-progress', e => this._onFileProgress(e.detail));
        Events.on('paste', e => this._onPaste(e));
    }

    _onPeerJoined(peer) {
        if ($(peer.id)) return; // peer already exists
        const peerUI = new PeerUI(peer, this._template);
        this._peers.appendChild(peerUI.$el);
        setTimeout(() => window.animateBackground(false), 1750); // Stop animation
    }

    _onPeers(peers) {
        this._clearPeers();
        peers.forEach(peer => this._onPeerJoined(peer));
    }

    _onPeerLeft(peerId) {
        const $peer = $(peerId);
        if (!$peer) return;
        $peer.remove();
    }

    _onFileProgress(progress) {
        const peerId = progress.sender || progress.recipient;
        const $peer = $(peerId);
        if (!$peer) return;
        $peer.ui.setProgress(progress.progress);
    }

    _clearPeers() {
        this._peers.innerHTML = '';
    }

    _onPaste(e) {
        const files = e.clipboardData.files || e.clipboardData.items
            .filter(i => i.type.indexOf('image') > -1)
            .map(i => i.getAsFile());
        
        const peers = document.querySelectorAll('.peer');
        // Only send to the only peer if there's only one
        if (files.length > 0 && peers.length === 1) {
            Events.fire('files-selected', {
                files: files,
                to: peers[0].id
            });
        }
    }
}

class PeerUI {
    constructor(peer, template) {
        this._peer = peer;
        this._initDom(template);
        this._bindListeners();
    }

    _initDom(template) {
        const el = document.createElement('div');
        el.innerHTML = template.innerHTML;
        el.id = this._peer.id;
        el.className = 'peer';
        el.ui = this;
        
        // Set peer icon based on device type
        const iconEl = el.querySelector('.peer-icon i');
        iconEl.className = this._getIconClass();
        
        // Set peer name and device
        el.querySelector('.peer-name').textContent = this._displayName();
        el.querySelector('.peer-device').textContent = this._deviceName();
        
        this.$el = el;
        this.$progress = el.querySelector('.progress-circle-overlay');
    }

    _bindListeners() {
        this.$el.querySelector('input').addEventListener('change', e => this._onFilesSelected(e));
        this.$el.addEventListener('drop', e => this._onDrop(e));
        this.$el.addEventListener('dragend', e => this._onDragEnd(e));
        this.$el.addEventListener('dragleave', e => this._onDragEnd(e));
        this.$el.addEventListener('dragover', e => this._onDragOver(e));
        this.$el.addEventListener('contextmenu', e => this._onRightClick(e));
        this.$el.addEventListener('touchstart', e => this._onTouchStart(e));
        this.$el.addEventListener('touchend', e => this._onTouchEnd(e));
        
        // Prevent browser's default file drop behavior
        Events.on('dragover', e => e.preventDefault());
        Events.on('drop', e => e.preventDefault());
    }

    _displayName() {
        return this._peer.name.displayName;
    }

    _deviceName() {
        return this._peer.name.deviceName;
    }

    _getIconClass() {
        const device = this._peer.name.device || this._peer.name;
        if (device.type === 'mobile') {
            return 'fas fa-mobile-alt';
        }
        if (device.type === 'tablet') {
            return 'fas fa-tablet-alt';
        }
        return 'fas fa-laptop';
    }

    _onFilesSelected(e) {
        const $input = e.target;
        const files = $input.files;
        Events.fire('files-selected', {
            files: files,
            to: this._peer.id
        });
        $input.value = null; // reset input
    }

    setProgress(progress) {
        if (progress > 0) {
            this.$el.setAttribute('transfer', '1');
        }
        
        // Update progress circle via CSS variable
        this.$progress.style.setProperty('--progress', (progress * 100) + '%');
        
        if (progress >= 1) {
            setTimeout(() => {
                this.setProgress(0);
                this.$el.removeAttribute('transfer');
            }, 1000);
        }
    }

    _onDrop(e) {
        e.preventDefault();
        const files = e.dataTransfer.files;
        Events.fire('files-selected', {
            files: files,
            to: this._peer.id
        });
        this._onDragEnd();
    }

    _onDragOver() {
        this.$el.setAttribute('drop', '1');
    }

    _onDragEnd() {
        this.$el.removeAttribute('drop');
    }

    _onRightClick(e) {
        e.preventDefault();
        Events.fire('text-recipient', this._peer.id);
    }

    _onTouchStart(e) {
        this._touchStart = Date.now();
        this._touchTimer = setTimeout(_ => this._onTouchEnd(), 610);
    }

    _onTouchEnd(e) {
        if (Date.now() - this._touchStart < 500) {
            clearTimeout(this._touchTimer);
        } else { // this was a long tap
            if (e) e.preventDefault();
            Events.fire('text-recipient', this._peer.id);
        }
    }
}

class Dialog {
    constructor(id) {
        this.$el = $(id);
        this.$overlay = this.$el.querySelector('.dialog-overlay');
        this.$content = this.$el.querySelector('.dialog-content');
        
        // Set up close buttons
        this.$el.querySelectorAll('[close]').forEach(el => {
            el.addEventListener('click', () => this.hide());
        });
        
        // Close on overlay click
        this.$overlay.addEventListener('click', () => this.hide());
        
        // Find autofocus element if any
        this.$autoFocus = this.$el.querySelector('[autofocus]');
    }

    show() {
        this.$el.setAttribute('show', '1');
        if (this.$autoFocus) this.$autoFocus.focus();
    }

    hide() {
        this.$el.removeAttribute('show');
        document.activeElement.blur();
    }
}

class ReceiveDialog extends Dialog {
    constructor() {
        super('receiveDialog');
        Events.on('file-received', e => {
            this._nextFile(e.detail);
            $('notification-sound').play();
        });
        this._filesQueue = [];
        this.$preview = this.$el.querySelector('.file-preview');
        this.$preview.style.display = 'none';
    }

    _nextFile(nextFile) {
        if (nextFile) this._filesQueue.push(nextFile);
        if (this._busy) return;
        this._busy = true;
        const file = this._filesQueue.shift();
        this._displayFile(file);
    }

    _dequeueFile() {
        if (!this._filesQueue.length) { // nothing to do
            this._busy = false;
            return;
        }
        // dequeue next file
        setTimeout(() => {
            this._busy = false;
            this._nextFile();
        }, 300);
    }

    _displayFile(file) {
        const $a = this.$el.querySelector('#download');
        const url = URL.createObjectURL(file.blob);
        $a.href = url;
        $a.download = file.name;

        // Auto download if option is unchecked
        if (this._autoDownload()) {
            $a.click();
            return;
        }
        
        // Show image preview for images
        if (file.mime.split('/')[0] === 'image') {
            this.$preview.style.display = 'flex';
            this.$el.querySelector("#img-preview").src = url;
        } else {
            this.$preview.style.display = 'none';
        }

        this.$el.querySelector('#fileName').textContent = file.name;
        this.$el.querySelector('#fileSize').textContent = this._formatFileSize(file.size);
        this.show();

        // Fallback for iOS
        if (!window.isDownloadSupported) {
            $a.target = '_blank';
            const reader = new FileReader();
            reader.onload = e => $a.href = reader.result;
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
        this.$preview.style.display = 'none';
        this.$el.querySelector("#img-preview").src = "";
        super.hide();
        this._dequeueFile();
    }

    _autoDownload() {
        return !this.$el.querySelector('#autoDownload').checked;
    }
}

class SendTextDialog extends Dialog {
    constructor() {
        super('sendTextDialog');
        Events.on('text-recipient', e => this._onRecipient(e.detail));
        this.$text = this.$el.querySelector('#textInput');
        
        // Submit on form submit (send button click)
        const form = this.$el.querySelector('form');
        form.addEventListener('submit', e => {
            e.preventDefault();
            this._send();
        });
    }

    _onRecipient(recipient) {
        this._recipient = recipient;
        this._handleShareTargetText();
        this.show();

        // Select all text
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(this.$text);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    _handleShareTargetText() {
        if (!window.shareTargetText) return;
        this.$text.textContent = window.shareTargetText;
        window.shareTargetText = '';
    }

    _send() {
        Events.fire('send-text', {
            to: this._recipient,
            text: this.$text.innerText
        });
        this.hide();
        this.$text.innerText = '';
    }
}

class ReceiveTextDialog extends Dialog {
    constructor() {
        super('receiveTextDialog');
        Events.on('text-received', e => this._onText(e.detail));
        this.$text = this.$el.querySelector('#text');
        const $copy = this.$el.querySelector('#copy');
        $copy.addEventListener('click', () => this._onCopy());
    }

    _onText(e) {
        this.$text.innerHTML = '';
        const text = e.text;
        if (isURL(text)) {
            const $a = document.createElement('a');
            $a.href = text;
            $a.target = '_blank';
            $a.textContent = text;
            this.$text.appendChild($a);
        } else {
            this.$text.textContent = text;
        }
        this.show();
        $('notification-sound').play();
    }

    async _onCopy() {
        await navigator.clipboard.writeText(this.$text.textContent);
        Events.fire('notify-user', 'Copied to clipboard');
    }
}

class Toast {
    constructor() {
        this.$el = $('toast');
        this.$message = $('toast-message');
        Events.on('notify-user', e => this._onNotify(e.detail));
    }

    _onNotify(message) {
        this.$message.textContent = message;
        this.$el.setAttribute('show', '1');
        clearTimeout(this._timerId);
        this._timerId = setTimeout(() => {
            this.$el.removeAttribute('show');
        }, 3000);
    }
}

class Notifications {
    constructor() {
        // Check if the browser supports notifications
        if (!('Notification' in window)) return;

        // Check notification permissions
        if (Notification.permission !== 'granted') {
            this.$button = $('notification');
            this.$button.removeAttribute('hidden');
            this.$button.addEventListener('click', () => this._requestPermission());
        }
        
        Events.on('text-received', e => this._messageNotification(e.detail.text));
        Events.on('file-received', e => this._downloadNotification(e.detail.name));
    }

    _requestPermission() {
        Notification.requestPermission(permission => {
            if (permission !== 'granted') {
                Events.fire('notify-user', Notifications.PERMISSION_ERROR || 'Error');
                return;
            }
            this._notify('Notifications enabled!');
            this.$button.setAttribute('hidden', '1');
        });
    }

    _notify(message, body) {
        const config = {
            body: body,
            icon: '/images/favicon.png',
        };
        
        let notification;
        try {
            notification = new Notification(message, config);
        } catch (e) {
            // Android doesn't support "new Notification" if service worker is installed
            if (!serviceWorker || !serviceWorker.showNotification) return;
            notification = serviceWorker.showNotification(message, config);
        }

        // Close notification when page becomes visible
        const visibilitychangeHandler = () => {                             
            if (document.visibilityState === 'visible') {    
                notification.close();
                Events.off('visibilitychange', visibilitychangeHandler);
            }                                                       
        };                                                                                
        Events.on('visibilitychange', visibilitychangeHandler);

        return notification;
    }

    _messageNotification(message) {
        if (document.visibilityState !== 'visible') {
            if (isURL(message)) {
                const notification = this._notify('New Link', message);
                this._bind(notification, () => window.open(message, '_blank', null, true));
            } else {
                const notification = this._notify('New Message', message);
                this._bind(notification, () => this._copyText(message, notification));
            }
        }
    }

    _downloadNotification(message) {
        if (document.visibilityState !== 'visible') {
            const notification = this._notify('File Received', message);
            if (!window.isDownloadSupported) return;
            this._bind(notification, () => this._download(notification));
        }
    }

    _download(notification) {
        document.querySelector('.dialog [download]').click();
        notification.close();
    }

    _copyText(message, notification) {
        notification.close();
        if (!navigator.clipboard.writeText(message)) return;
        this._notify('Copied text to clipboard');
    }

    _bind(notification, handler) {
        if (notification.then) {
            notification.then(() => {
                serviceWorker.getNotifications().then(notifications => {
                    serviceWorker.addEventListener('notificationclick', handler);
                });
            });
        } else {
            notification.onclick = handler;
        }
    }
}

class NetworkStatusUI {
    constructor() {
        window.addEventListener('offline', () => this._showOfflineMessage(), false);
        window.addEventListener('online', () => this._showOnlineMessage(), false);
        if (!navigator.onLine) this._showOfflineMessage();
    }

    _showOfflineMessage() {
        Events.fire('notify-user', 'You are offline');
    }

    _showOnlineMessage() {
        Events.fire('notify-user', 'You are back online');
    }
}

class WebShareTargetUI {
    constructor() {
        const parsedUrl = new URL(window.location);
        const title = parsedUrl.searchParams.get('title');
        const text = parsedUrl.searchParams.get('text');
        const url = parsedUrl.searchParams.get('url');

        let shareTargetText = title ? title : '';
        shareTargetText += text ? shareTargetText ? ' ' + text : text : '';

        // Share just the URL if provided
        if(url) shareTargetText = url;

        if (!shareTargetText) return;
        window.shareTargetText = shareTargetText;
        history.pushState({}, 'URL Rewrite', '/');
        console.log('Shared Target Text:', '"' + shareTargetText + '"');
    }
}

class AboutUI {
    constructor() {
        this.$about = $('about');
        this.$aboutBtn = $('about-btn');
        this.$closeBtn = this.$about.querySelector('.close-btn');
        
        this.$aboutBtn.addEventListener('click', () => this.show());
        this.$closeBtn.addEventListener('click', () => this.hide());
        this.$about.querySelector('.about-overlay').addEventListener('click', () => this.hide());
    }
    
    show() {
        this.$about.setAttribute('show', '1');
    }
    
    hide() {
        this.$about.removeAttribute('show');
    }
}

class Drpl {
    constructor() {
        const server = new ServerConnection();
        const peers = new PeersManager(server);
        
        // Initialize UI components
        this._peersUI = new PeersUI();
        this._receiveDialog = new ReceiveDialog();
        this._sendTextDialog = new SendTextDialog();
        this._receiveTextDialog = new ReceiveTextDialog();
        this._toast = new Toast();
        this._notifications = new Notifications();
        this._networkStatus = new NetworkStatusUI();
        this._webShareTarget = new WebShareTargetUI();
        this._aboutUI = new AboutUI();
        
        // Initialize background animation
        this._initBackground();
        
        // Handle install button
        this._initInstallButton();
    }
    
    _initBackground() {
        // Create canvas for background animation
        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas);
        
        // Set canvas style
        canvas.style.position = 'absolute';
        canvas.style.zIndex = '-1';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        
        const ctx = canvas.getContext('2d');
        let x0, y0, w, h, dw;
        
        function init() {
            w = window.innerWidth;
            h = window.innerHeight;
            canvas.width = w;
            canvas.height = h;
            const offset = h > 380 ? 100 : 65;
            x0 = w / 2;
            y0 = h - offset;
            dw = Math.max(w, h, 1000) / 13;
            drawCircles();
        }
        
        function drawCircle(radius) {
            ctx.beginPath();
            const alpha = 0.1 * (1 - radius / Math.max(w, h));
            ctx.strokeStyle = `rgba(79, 70, 229, ${alpha})`;
            ctx.arc(x0, y0, radius, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.lineWidth = 2;
        }
        
        let step = 0;
        
        function drawCircles() {
            ctx.clearRect(0, 0, w, h);
            for (let i = 0; i < 8; i++) {
                drawCircle(dw * i + step % dw);
            }
            step += 1;
        }
        
        let loading = true;
        
        function animate() {
            if (loading || step % dw < dw - 5) {
                requestAnimationFrame(() => {
                    drawCircles();
                    animate();
                });
            }
        }
        
        // Initialize and start animation
        window.animateBackground = function(l) {
            loading = l;
            animate();
        };
        
        // Handle window resize
        window.addEventListener('resize', init);
        
        // Initialize and start animation
        init();
        animate();
    }
    
    _initInstallButton() {
        window.addEventListener('beforeinstallprompt', e => {
            if (window.matchMedia('(display-mode: standalone)').matches) {
                // Don't display install banner when installed
                return e.preventDefault();
            } else {
                const btn = $('install');
                btn.hidden = false;
                btn.onclick = () => e.prompt();
                return e.preventDefault();
            }
        });
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const drpl = new Drpl();
    
    // Initialize service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(serviceWorker => {
                console.log('Service Worker registered');
                window.serviceWorker = serviceWorker;
            });
    }
    
    // Fix for Safari audio
    document.body.addEventListener('click', () => {
        document.body.removeEventListener('click', null);
        if (!(/.*Version.*Safari.*/.test(navigator.userAgent))) return;
        $('notification-sound').play();
    }, { once: true });
});

// Error message for notifications permission
Notifications.PERMISSION_ERROR = `
Notifications permission has been blocked
as you have dismissed the permission prompt several times.
This can be reset in Page Info by clicking the lock icon next to the URL.`;