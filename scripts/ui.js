////////////////////////////////////////////////////////////////////////////////
// SHORTCUTS
////////////////////////////////////////////////////////////////////////////////

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.body.querySelector(sel);
const isURL = (text) => /^((https?:\/\/|www)[^\s]+)/gi.test(text.toLowerCase());
window.isDownloadSupported = typeof document.createElement('a').download !== 'undefined';
window.isProductionEnvironment = !window.location.host.startsWith('localhost');
window.iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

////////////////////////////////////////////////////////////////////////////////
// UI: Listen for display name
////////////////////////////////////////////////////////////////////////////////

Events.on('display-name', (e) => {
  const msg = e.detail.message;
  const el = $('displayName');
  el.textContent = 'You are known as ' + msg.displayName;
  el.title = msg.deviceName;
});

////////////////////////////////////////////////////////////////////////////////
// PEERS UI
////////////////////////////////////////////////////////////////////////////////

class PeersUI {
  constructor() {
    Events.on('peer-joined', e => this._onPeerJoined(e.detail));
    Events.on('peer-left', e => this._onPeerLeft(e.detail));
    Events.on('peers', e => this._onPeers(e.detail));
    Events.on('file-progress', e => this._onFileProgress(e.detail));
    Events.on('paste', e => this._onPaste(e.detail));

    // Drag/Drop prevent default
    Events.on('dragover', e => e.preventDefault());
    Events.on('drop', e => e.preventDefault());
  }

  _onPeerJoined(peer) {
    if ($(peer.id)) return;
    const peerUI = new PeerUI(peer);
    $$('x-peers').appendChild(peerUI.$el);
    setTimeout(() => window.animateBackground(false), 1750);
  }

  _onPeers(peers) {
    this._clearPeers();
    peers.forEach(peer => this._onPeerJoined(peer));
  }

  _onPeerLeft(peerId) {
    const el = $(peerId);
    if (!el) return;
    el.remove();
  }

  _clearPeers() {
    $$('x-peers').innerHTML = '';
  }

  _onFileProgress({ sender, progress }) {
    const el = $(sender);
    if (!el) return;
    el.ui.setProgress(progress);
  }

  _onPaste(e) {
    // If someone pastes an image?
    // Not fully implemented here
  }
}

class PeerUI {
  constructor(peer) {
    this._peer = peer;
    this._initDom();
    this._bindListeners();
  }

  _initDom() {
    const el = document.createElement('x-peer');
    el.id = this._peer.id;
    el.innerHTML = this.html();
    el.ui = this;

    // Depending on device type, pick icon
    const iconEl = el.querySelector('.peer-icon');
    if (iconEl) {
      let iconClass = 'fa-desktop';
      const deviceType = this._peer.name.device.type;
      if (deviceType === 'mobile') {
        iconClass = 'fa-mobile-screen-button';
      } else if (deviceType === 'tablet') {
        iconClass = 'fa-tablet';
      }
      iconEl.classList.add(iconClass);
    }

    el.querySelector('.name').textContent = this._peer.name.displayName;
    el.querySelector('.device-name').textContent = this._peer.name.device.deviceName || '';
    this.$el = el;
    this.$progress = el.querySelector('.progress');
  }

  html() {
    return `
      <label class="column center" title="Click to send files or right-click to send text">
        <input type="file" multiple>
        <div class="peer-icon-wrap">
          <i class="fa-solid peer-icon" style="color:#fff; font-size:24px;"></i>
        </div>
        <div class="progress">
          <div class="circle"></div>
          <div class="circle right"></div>
        </div>
        <div class="name font-subheading"></div>
        <div class="device-name font-body2"></div>
        <div class="status font-body2"></div>
      </label>
    `;
  }

  _bindListeners() {
    const input = this.$el.querySelector('input[type="file"]');
    input.addEventListener('change', (e) => this._onFilesSelected(e));
    
    // drag events
    this.$el.addEventListener('drop', (e) => this._onDrop(e));
    this.$el.addEventListener('dragover', (e) => this._onDragOver(e));
    this.$el.addEventListener('dragleave', (e) => this._onDragEnd(e));
    this.$el.addEventListener('dragend', (e) => this._onDragEnd(e));

    // contextmenu => right-click
    this.$el.addEventListener('contextmenu', (e) => this._onRightClick(e));

    // long press on touch
    this.$el.addEventListener('touchstart', (e) => this._onTouchStart(e));
    this.$el.addEventListener('touchend', (e) => this._onTouchEnd(e));
  }

  _onFilesSelected(e) {
    const files = e.target.files;
    Events.fire('files-selected', { files, to: this._peer.id });
    e.target.value = null; // reset
  }

  setProgress(progress) {
    if (progress > 0) {
      this.$el.setAttribute('transfer', '1');
    }
    if (progress > 0.5) {
      this.$progress.classList.add('over50');
    } else {
      this.$progress.classList.remove('over50');
    }
    const degrees = `rotate(${360 * progress}deg)`;
    this.$progress.style.setProperty('--progress', degrees);

    if (progress >= 1) {
      this.setProgress(0);
      this.$el.removeAttribute('transfer');
    }
  }

  _onDrop(e) {
    e.preventDefault();
    const { files } = e.dataTransfer;
    Events.fire('files-selected', { files, to: this._peer.id });
    this._onDragEnd();
  }
  _onDragOver(e) {
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
    this._touchTimer = setTimeout(() => this._onTouchEnd(), 610);
  }
  _onTouchEnd(e) {
    if (Date.now() - this._touchStart < 500) {
      clearTimeout(this._touchTimer);
    } else {
      if (e) e.preventDefault();
      Events.fire('text-recipient', this._peer.id);
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
// SEND TEXT DIALOG
////////////////////////////////////////////////////////////////////////////////

class SendTextDialog extends Dialog {
  constructor() {
    super('sendTextDialog');
    Events.on('text-recipient', (e) => this._onRecipient(e.detail));
    this.$text = this.$el.querySelector('#textInput');
    const form = this.$el.querySelector('form');
    form.addEventListener('submit', (e) => this._send(e));
  }

  _onRecipient(recipient) {
    this._recipient = recipient;
    this.show();
    // highlight text
    const range = document.createRange();
    range.selectNodeContents(this.$text);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  _send(e) {
    e.preventDefault();
    Events.fire('send-text', {
      to: this._recipient,
      text: this.$text.innerText
    });
  }
}

////////////////////////////////////////////////////////////////////////////////
// RECEIVE TEXT DIALOG
////////////////////////////////////////////////////////////////////////////////

class ReceiveTextDialog extends Dialog {
  constructor() {
    super('receiveTextDialog');
    Events.on('text-received', e => this._onText(e.detail));
    this.$text = this.$el.querySelector('#text');
    const copyBtn = this.$el.querySelector('#copy');
    copyBtn.addEventListener('click', () => this._onCopy());
  }

  _onText({ text }) {
    this.$text.innerHTML = '';
    if (isURL(text)) {
      const a = document.createElement('a');
      a.href = text;
      a.target = '_blank';
      a.textContent = text;
      this.$text.appendChild(a);
    } else {
      this.$text.textContent = text;
    }
    this.show();
    window.blop.play();
  }

  async _onCopy() {
    await navigator.clipboard.writeText(this.$text.textContent);
    Events.fire('notify-user', 'Copied to clipboard');
  }
}

////////////////////////////////////////////////////////////////////////////////
// RECEIVE FILE DIALOG
////////////////////////////////////////////////////////////////////////////////

class ReceiveDialog extends Dialog {
  constructor() {
    super('receiveDialog');
    this._filesQueue = [];
    Events.on('file-received', (e) => {
      this._nextFile(e.detail);
      window.blop.play();
    });
  }

  _nextFile(file) {
    if (file) this._filesQueue.push(file);
    if (this._busy) return;
    this._busy = true;
    const next = this._filesQueue.shift();
    if (next) this._displayFile(next);
  }

  _dequeueFile() {
    if (!this._filesQueue.length) {
      this._busy = false;
      return;
    }
    setTimeout(() => {
      this._busy = false;
      this._nextFile();
    }, 300);
  }

  _displayFile(file) {
    const a = this.$el.querySelector('#download');
    const url = URL.createObjectURL(file.blob);
    a.href = url;
    a.download = file.name;

    // If the user has autoDownload unchecked => show dialog
    // If it is checked => automatically click "save"
    const autoCheckbox = this.$el.querySelector('#autoDownload');
    if (!autoCheckbox.checked) {
      // auto download
      a.click();
      this._dequeueFile();
      return;
    }

    // If it's an image, show a small preview
    if (file.mime.startsWith('image/')) {
      this.$el.querySelector('.preview').style.visibility = 'inherit';
      this.$el.querySelector('#img-preview').src = url;
    }
    this.$el.querySelector('#fileName').textContent = file.name;
    this.$el.querySelector('#fileSize').textContent = this._formatFileSize(file.size);
    this.show();

    if (!window.isDownloadSupported) {
      a.target = '_blank';
      const reader = new FileReader();
      reader.onload = () => { a.href = reader.result; };
      reader.readAsDataURL(file.blob);
    }
  }

  hide() {
    this.$el.querySelector('.preview').style.visibility = 'hidden';
    this.$el.querySelector('#img-preview').src = '';
    super.hide();
    this._dequeueFile();
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
}

////////////////////////////////////////////////////////////////////////////////
// DIALOG BASE
////////////////////////////////////////////////////////////////////////////////

class Dialog {
  constructor(id) {
    this.$el = $(id);
    if (!this.$el) return;
    this.$el.querySelectorAll('[close]').forEach(btn => {
      btn.addEventListener('click', () => this.hide());
    });
    this.$autoFocus = this.$el.querySelector('[autofocus]');
  }
  show() {
    this.$el.setAttribute('show', 1);
    if (this.$autoFocus) this.$autoFocus.focus();
  }
  hide() {
    this.$el.removeAttribute('show');
    document.activeElement.blur();
    window.blur();
  }
}

////////////////////////////////////////////////////////////////////////////////
// TOAST NOTIFICATIONS
////////////////////////////////////////////////////////////////////////////////

class Toast extends Dialog {
  constructor() {
    super('toast');
    Events.on('notify-user', (e) => this._onNotify(e.detail));
  }
  _onNotify(message) {
    this.$el.textContent = message;
    this.show();
    setTimeout(() => this.hide(), 3000);
  }
}

////////////////////////////////////////////////////////////////////////////////
// DESKTOP NOTIFICATIONS
////////////////////////////////////////////////////////////////////////////////

class Notifications {
  constructor() {
    if (!('Notification' in window)) return;

    if (Notification.permission !== 'granted') {
      this.$button = $('notification');
      if (this.$button) {
        this.$button.removeAttribute('hidden');
        this.$button.addEventListener('click', () => this._requestPermission());
      }
    }

    Events.on('text-received', e => this._messageNotification(e.detail.text));
    Events.on('file-received', e => this._downloadNotification(e.detail.name));
  }

  _requestPermission() {
    Notification.requestPermission().then(permission => {
      if (permission !== 'granted') {
        Events.fire('notify-user', 'Notifications blocked. Check browser settings.');
        return;
      }
      this._notify('Notifications enabled', 'drpl.co can now show notifications');
      if (this.$button) {
        this.$button.setAttribute('hidden', 1);
      }
    });
  }

  _notify(title, body) {
    const config = {
      body,
      icon: 'images/favicon-96x96.png'
    };
    let notification;
    try {
      notification = new Notification(title, config);
    } catch (e) {
      if (window.serviceWorker && window.serviceWorker.showNotification) {
        window.serviceWorker.showNotification(title, config);
      }
    }
    return notification;
  }

  _messageNotification(text) {
    if (document.visibilityState !== 'visible') {
      if (isURL(text)) {
        const n = this._notify(text, 'Click to open link');
        if (n) {
          n.onclick = () => { window.open(text, '_blank'); };
        }
      } else {
        const n = this._notify('Received text', 'Tap to copy');
        if (n) {
          n.onclick = () => {
            n.close();
            if (navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text);
              this._notify('Copied text to clipboard', '');
            }
          };
        }
      }
    }
  }

  _downloadNotification(filename) {
    if (document.visibilityState !== 'visible') {
      const n = this._notify(filename, 'Click to download');
      if (!n) return;
      n.onclick = () => {
        n.close();
        const el = document.querySelector('x-dialog [download]');
        if (el) el.click();
      };
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
// NETWORK STATUS
////////////////////////////////////////////////////////////////////////////////

class NetworkStatusUI {
  constructor() {
    window.addEventListener('offline', () => this._showOfflineMessage());
    window.addEventListener('online', () => this._showOnlineMessage());
    if (!navigator.onLine) {
      this._showOfflineMessage();
    }
  }
  _showOfflineMessage() {
    Events.fire('notify-user', 'You are offline');
  }
  _showOnlineMessage() {
    Events.fire('notify-user', 'You are back online');
  }
}

////////////////////////////////////////////////////////////////////////////////
// WEB SHARE TARGET
////////////////////////////////////////////////////////////////////////////////

class WebShareTargetUI {
  constructor() {
    const parsedUrl = new URL(window.location);
    const title = parsedUrl.searchParams.get('title');
    const text = parsedUrl.searchParams.get('text');
    const url = parsedUrl.searchParams.get('url');

    let shareTargetText = title ? title : '';
    shareTargetText += text ? (shareTargetText ? ' ' + text : text) : '';
    if (url) {
      shareTargetText = url;
    }
    if (!shareTargetText) return;
    window.shareTargetText = shareTargetText;
    history.pushState({}, '', '/');
  }
}

////////////////////////////////////////////////////////////////////////////////
// DRPL APP
////////////////////////////////////////////////////////////////////////////////

class DrplCo {
  constructor() {
    window.addEventListener('load', () => {
      this.receiveDialog = new ReceiveDialog();
      this.sendTextDialog = new SendTextDialog();
      this.receiveTextDialog = new ReceiveTextDialog();
      this.toast = new Toast();
      this.notifications = new Notifications();
      this.networkStatus = new NetworkStatusUI();
      this.webShareTarget = new WebShareTargetUI();
      this.peersUI = new PeersUI();
    });

    // Initialize fancy background
    window.addEventListener('load', () => this._initBackground());
  }

  _initBackground() {
    const c = document.createElement('canvas');
    document.body.appendChild(c);
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.position = 'absolute';
    c.style.zIndex = -1;
    c.style.top = 0;
    c.style.left = 0;
    const ctx = c.getContext('2d');
    let w, h, x0, y0, dw;
    let step = 0;
    let loading = true;

    function init() {
      w = window.innerWidth;
      h = window.innerHeight;
      c.width = w;
      c.height = h;
      let offset = h > 380 ? 100 : 65;
      offset = h > 800 ? 116 : offset;
      x0 = w / 2;
      y0 = h - offset;
      dw = Math.max(w, h, 1000) / 13;
      drawCircles();
    }

    function drawCircle(radius) {
      ctx.beginPath();
      const color = Math.round(197 * (1 - radius / Math.max(w, h)));
      ctx.strokeStyle = `rgba(${color},${color},${color},0.1)`;
      ctx.arc(x0, y0, radius, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.lineWidth = 2;
    }

    function drawCircles() {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) {
        drawCircle(dw * i + (step % dw));
      }
      step += 1;
    }

    function animate() {
      if (loading || step % dw < dw - 5) {
        requestAnimationFrame(() => {
          drawCircles();
          animate();
        });
      }
    }

    window.animateBackground = function(l) {
      loading = l;
      animate();
    };

    window.onresize = init;
    init();
    animate();
  }
}

// Instantiate
const drplCo = new DrplCo();
