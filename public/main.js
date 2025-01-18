/*************************************************************
 * main.js
 *
 * Major Features:
 *  - Peer discovery via WebSockets
 *  - WebRTC for file and message transfer (fast, direct P2P)
 *  - Snapdrop-like chunking over the RTC data channel
 *  - The server is only used for signaling (offer/answer/ICE)
 *************************************************************/

window.isRtcSupported = !!(
  window.RTCPeerConnection ||
  window.mozRTCPeerConnection ||
  window.webkitRTCPeerConnection
);

function detectDeviceType() {
  const ua = navigator.userAgent.toLowerCase();
  if (/mobile|iphone|ipod|blackberry|android.*mobile/.test(ua)) {
    return 'mobile';
  } else if (/ipad|android(?!.*mobile)/.test(ua)) {
    return 'tablet';
  }
  return 'desktop';
}

//
// Simple Event Emitter
//
const Evt = {
  on(event, fn) {
    window.addEventListener(event, fn, false);
  },
  off(event, fn) {
    window.removeEventListener(event, fn, false);
  },
  fire(event, detail) {
    window.dispatchEvent(new CustomEvent(event, { detail }));
  }
};

//
// A small wrapper for the WebSocket to talk to our server
//
class ServerConnection {
  constructor(deviceType) {
    this.deviceType = deviceType;
    this.socket = null;
    this.id = null;
    this.displayName = null;
    this.connect();
  }

  connect() {
    const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const endpoint = protocol + location.host; // same host
    this.socket = new WebSocket(endpoint);
    this.socket.onopen = () => {
      console.log('[WS] Connected');
      // Introduce ourselves
      this.send({ type: 'introduce', name: { deviceType: this.deviceType } });
    };
    this.socket.onclose = () => {
      console.log('[WS] Disconnected');
      Evt.fire('server-disconnected');
    };
    this.socket.onerror = err => {
      console.error('[WS] Error', err);
    };
    this.socket.onmessage = e => this._onMessage(e);
  }

  _onMessage(e) {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch (err) {
      console.error('[WS] Malformed message', e.data);
      return;
    }

    switch (msg.type) {
      case 'display-name':
        this.id = msg.message.peerId;
        this.displayName = msg.message.displayName;
        document.getElementById('device-name').textContent = this.displayName;
        break;
      case 'peers':
        Evt.fire('peers', msg.peers);
        break;
      case 'peer-joined':
        Evt.fire('peer-joined', msg.peer);
        break;
      case 'peer-left':
        Evt.fire('peer-left', msg.peerId);
        break;
      case 'ping':
        this.send({ type: 'pong' });
        break;
      case 'peer-updated':
        // Could handle updates if needed
        break;
      case 'signal':
        // WebRTC signaling
        Evt.fire('signal', msg);
        break;
      default:
        console.log('[WS] Unknown message:', msg);
        break;
    }
  }

  send(msg) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }
}

//
// The RTCPeer is in charge of creating a data channel with one peer
// and sending/receiving files/messages directly over that channel.
//
class RTCPeer {
  constructor(server, peerId) {
    this.server = server; // our ServerConnection
    this.peerId = peerId; // remote peer
    this.pc = null;
    this.channel = null;
    this.filesQueue = [];
    this.sendingFile = false;
    // If we are the "caller," we create the offer. If "callee," wait for an offer.
    if (peerId) {
      // we are the "caller"
      this._initPeerConnection(true);
    }
  }

  // For the callee, we do not create an offer until we get an inbound signal.
  handleSignal(msg) {
    if (!this.pc) {
      // we are the callee
      this._initPeerConnection(false);
    }
    if (msg.sdp) {
      this._onRemoteDescription(msg.sdp);
    } else if (msg.ice) {
      this._onRemoteIceCandidate(msg.ice);
    }
  }

  _initPeerConnection(isCaller) {
    this.pc = new RTCPeerConnection(RTCPeer.iceConfig);
    this.pc.onicecandidate = e => this._onIceCandidate(e);
    this.pc.onconnectionstatechange = e => this._onConnectionStateChange();
    this.pc.oniceconnectionstatechange = e => this._onIceConnectionStateChange();

    if (isCaller) {
      // create data channel
      this.channel = this.pc.createDataChannel('drpl-data');
      this._setupChannel(this.channel);
      // create offer
      this.pc
        .createOffer()
        .then(desc => {
          return this.pc.setLocalDescription(desc);
        })
        .then(() => {
          this._sendSignal({ sdp: this.pc.localDescription });
        })
        .catch(console.error);
    } else {
      // we are callee => wait for ondatachannel
      this.pc.ondatachannel = evt => {
        this.channel = evt.channel;
        this._setupChannel(this.channel);
      };
    }
  }

  _onIceCandidate(e) {
    if (!e.candidate) return;
    this._sendSignal({ ice: e.candidate });
  }
  _onConnectionStateChange() {
    console.log('[RTC] connectionState =', this.pc.connectionState);
    if (this.pc.connectionState === 'failed') {
      // handle failure
    }
  }
  _onIceConnectionStateChange() {
    console.log('[RTC] iceConnectionState =', this.pc.iceConnectionState);
  }
  _onRemoteDescription(sdp) {
    const desc = new RTCSessionDescription(sdp);
    this.pc
      .setRemoteDescription(desc)
      .then(() => {
        if (desc.type === 'offer') {
          return this.pc
            .createAnswer()
            .then(answer => {
              return this.pc.setLocalDescription(answer);
            })
            .then(() => {
              this._sendSignal({ sdp: this.pc.localDescription });
            });
        }
      })
      .catch(console.error);
  }
  _onRemoteIceCandidate(ice) {
    this.pc.addIceCandidate(new RTCIceCandidate(ice)).catch(console.error);
  }
  _sendSignal(obj) {
    obj.type = 'signal';
    obj.to = this.peerId;
    this.server.send(obj);
  }

  _setupChannel(channel) {
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      console.log('[RTC] Data channel open with peer', this.peerId);
      // If we have files queued, start sending
      this._tryDequeueFile();
    };
    channel.onmessage = e => this._onData(e.data);
    channel.onclose = () => {
      console.log('[RTC] Data channel closed', this.peerId);
    };
  }

  /********************************************************************
   * Sending text
   ********************************************************************/
  sendText(text) {
    if (!this.channel || this.channel.readyState !== 'open') {
      console.log('[RTC] Channel not open yet, queue text?');
      return;
    }
    const payload = { type: 'text', text: btoa(unescape(encodeURIComponent(text))) };
    this.channel.send(JSON.stringify(payload));
  }

  /********************************************************************
   * Sending files
   ********************************************************************/
  sendFiles(files) {
    for (const f of files) {
      this.filesQueue.push(f);
    }
    this._tryDequeueFile();
  }

  _tryDequeueFile() {
    if (!this.channel || this.channel.readyState !== 'open') return;
    if (this.sendingFile) return;
    if (!this.filesQueue.length) return;
    const file = this.filesQueue.shift();
    this.sendingFile = true;
    this._sendFile(file).then(() => {
      console.log('[RTC] Sent file completely:', file.name);
      this.sendingFile = false;
      // send "transfer-complete"
      Evt.fire('transfer-complete', { fromName: 'the receiver' });
      this._tryDequeueFile();
    });
  }

  async _sendFile(file) {
    // 1) Send a header
    const headerMsg = JSON.stringify({
      type: 'header',
      name: file.name,
      size: file.size,
      mime: file.type
    });
    this.channel.send(headerMsg);

    // 2) Read the file in chunks and send
    const chunkSize = 65536; // 64KB
    let offset = 0;
    while (offset < file.size) {
      const slice = file.slice(offset, offset + chunkSize);
      const buffer = await slice.arrayBuffer();
      this.channel.send(buffer);
      offset += buffer.byteLength;
      const progress = offset / file.size;
      Evt.fire('file-sending-progress', { file, progress });
      // small delay to allow the channel buffer to clear
      await new Promise(res => setTimeout(res, 0));
    }
    // 3) Send a final sentinel
    const doneMsg = JSON.stringify({ type: 'done' });
    this.channel.send(doneMsg);
  }

  /********************************************************************
   * Receiving data
   ********************************************************************/
  _onData(data) {
    if (typeof data === 'string') {
      // Could be JSON or text
      this._onStringData(data);
    } else {
      // It's an ArrayBuffer => file chunk
      if (this._incomingFileDigester) {
        this._incomingFileDigester.unchunk(data);
        const progress = this._incomingFileDigester.progress;
        Evt.fire('file-progress', { progress });
      }
    }
  }

  _onStringData(str) {
    let obj;
    try {
      obj = JSON.parse(str);
    } catch {
      // maybe it's plain text
      obj = { type: 'text-plain', text: str };
    }

    switch (obj.type) {
      case 'header':
        this._incomingFileDigester = new FileDigester(obj);
        Evt.fire('incoming-file', obj); // start progress bar
        break;
      case 'done':
        if (this._incomingFileDigester) {
          this._incomingFileDigester.finish();
          const fileObj = this._incomingFileDigester.fileObj;
          this._incomingFileDigester = null;
          // Fire an event to let UI know a file was fully received
          Evt.fire('file-received', fileObj);
        }
        break;
      case 'text':
        // decode text
        const decoded = decodeURIComponent(escape(atob(obj.text)));
        Evt.fire('rtc-text-received', { text: decoded, sender: this.peerId });
        break;
      default:
        // unknown or we ignore
        console.log('[RTC] Unknown message:', obj);
    }
  }
}

// Basic data structure for reassembling a file
class FileDigester {
  constructor({ name, mime, size }) {
    this.name = name;
    this.mime = mime || 'application/octet-stream';
    this.size = size;
    this.chunks = [];
    this.receivedBytes = 0;
  }
  unchunk(chunk) {
    this.chunks.push(chunk);
    this.receivedBytes += chunk.byteLength;
  }
  get progress() {
    if (!this.size) return 0;
    return this.receivedBytes / this.size;
  }
  finish() {
    const blob = new Blob(this.chunks, { type: this.mime });
    this.fileObj = {
      name: this.name,
      mime: this.mime,
      size: this.size,
      blob
    };
  }
}

RTCPeer.iceConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

//
// The manager that tracks multiple peers
//
class PeersManager {
  constructor(server) {
    this.server = server;
    this.peers = {}; // key = peerId, value = RTCPeer
    Evt.on('peers', e => this._onPeers(e.detail));
    Evt.on('peer-joined', e => this._onPeerJoined(e.detail));
    Evt.on('peer-left', e => this._onPeerLeft(e.detail));
    Evt.on('signal', e => this._onSignal(e.detail));
  }

  _onPeers(peersArray) {
    peersArray.forEach(peerInfo => {
      this._ensurePeer(peerInfo.id, true);
    });
    // Fire a custom “all peers updated” event
    Evt.fire('updated-peers', this.getPeerList());
  }

  _onPeerJoined(peerInfo) {
    this._ensurePeer(peerInfo.id, true);
    Evt.fire('updated-peers', this.getPeerList());
  }

  _onPeerLeft(peerId) {
    if (this.peers[peerId]) {
      delete this.peers[peerId];
    }
    Evt.fire('updated-peers', this.getPeerList());
  }

  _onSignal(msg) {
    const sender = msg.sender;
    const peer = this._ensurePeer(sender, false);
    peer.handleSignal(msg);
  }

  _ensurePeer(id, isCaller) {
    if (id === this.server.id) return null; // skip ourselves
    if (!this.peers[id]) {
      const newPeer = isCaller
        ? new RTCPeer(this.server, id) // we create the channel
        : new RTCPeer(this.server, null); // we wait for an offer
      newPeer.peerId = id;
      this.peers[id] = newPeer;
    }
    return this.peers[id];
  }

  getPeerList() {
    return Object.keys(this.peers);
  }

  getPeerById(id) {
    return this.peers[id];
  }
}

// Once DOM is loaded, we hook up all your modals and logic
document.addEventListener('DOMContentLoaded', () => {
  const deviceType = detectDeviceType();
  const serverConnection = new ServerConnection(deviceType);
  const peersManager = new PeersManager(serverConnection);

  //
  // Basic UI references
  //
  const peerListElement = document.getElementById('peer-list');
  const noPeersMessage = document.getElementById('no-peers-message');

  //
  // We'll store info about who is "currentRecipientId"
  //
  let currentRecipientId = null;

  //
  // Handle "peers" updated => rebuild the peer list
  //
  Evt.on('updated-peers', e => {
    const peerIds = e.detail;
    if (!peerIds.length) {
      noPeersMessage.style.display = 'block';
      peerListElement.innerHTML = '';
      return;
    }
    noPeersMessage.style.display = 'none';
    peerListElement.innerHTML = '';
    peerIds.forEach(pid => {
      // Snapdrop calls them "peer" in a single object, we can do similarly
      const peerObj = peersManager.getPeerById(pid);
      // We do not know the actual displayName from the server unless we store it in a global list.
      // For demonstration, let's say we just show the peerId or something.
      // You can store the 'name' from the "peer-joined" event. For now, just do "Peer <id.slice(...)>"
      // Or store the name in an external map if you want. We'll keep it simpler.

      // But we *did* get some info from the server's "peer-joined" or "peers" event if we wanted to store it.
      // For a simpler approach, let's just show "Peer X" or "ID: X".

      const btn = document.createElement('button');
      btn.className =
        'peer-button w-full py-[15px] text-xl bg-[#333533] text-white rounded-lg hover:bg-[#242423] transition-colors';
      const iconEl = document.createElement('i');
      iconEl.classList.add('fas', 'fa-desktop', 'peer-device-icon', 'text-white');
      const textSpan = document.createElement('span');
      textSpan.textContent = `Peer: ${pid.slice(0, 6)}...`;
      btn.appendChild(iconEl);
      btn.appendChild(textSpan);
      btn.addEventListener('click', () => {
        currentRecipientId = pid;
        document.getElementById('choose-action-device-name').textContent = `Send to ${pid}`;
        document.getElementById('choose-action-modal').style.display = 'flex';
      });
      peerListElement.appendChild(btn);
    });
  });

  //
  // Very similar logic for "Send Files" or "Send Message" as in your code
  //
  const chooseActionModal = document.getElementById('choose-action-modal');
  const chooseActionBackdrop = document.getElementById('choose-action-backdrop');
  const chooseActionSendFilesBtn = document.getElementById('choose-action-send-files');
  const chooseActionSendMessageBtn = document.getElementById('choose-action-send-message');

  chooseActionSendFilesBtn.addEventListener('click', () => {
    chooseActionModal.style.display = 'none';
    document.getElementById('send-files-modal').style.display = 'flex';
  });
  chooseActionSendMessageBtn.addEventListener('click', () => {
    chooseActionModal.style.display = 'none';
    document.getElementById('send-message-modal').style.display = 'flex';
  });
  chooseActionBackdrop.addEventListener('click', () => {
    chooseActionModal.style.display = 'none';
  });

  //
  // Sending text
  //
  const sendMessageModal = document.getElementById('send-message-modal');
  const messageInput = document.getElementById('message-input');
  const sendMessageCancel = document.getElementById('send-message-cancel');
  const sendMessageBtn = document.getElementById('send-message-button');
  sendMessageCancel.addEventListener('click', () => {
    sendMessageModal.style.display = 'none';
    messageInput.value = '';
  });
  sendMessageBtn.addEventListener('click', () => {
    const text = messageInput.value.trim();
    if (!currentRecipientId || !text) return;
    const peer = peersManager.getPeerById(currentRecipientId);
    if (!peer) return;
    peer.sendText(text);

    // We can show "transfer-complete" if you like
    Evt.fire('transfer-complete', { fromName: 'the receiver' });

    sendMessageModal.style.display = 'none';
    messageInput.value = '';
  });

  //
  // If we receive text from the peer, we show it
  //
  Evt.on('rtc-text-received', e => {
    const { text, sender } = e.detail;
    const incomingMsgModal = document.getElementById('incoming-message-modal');
    document.getElementById('incoming-message-header').textContent = `Message from ${sender}`;
    document.getElementById('incoming-message-text').textContent = text;
    incomingMsgModal.style.display = 'flex';
  });
  document.getElementById('incoming-message-close').addEventListener('click', () => {
    document.getElementById('incoming-message-modal').style.display = 'none';
  });
  document.getElementById('incoming-message-respond').addEventListener('click', () => {
    document.getElementById('incoming-message-modal').style.display = 'none';
    document.getElementById('send-message-modal').style.display = 'flex';
  });

  //
  // Sending Files
  //
  const sendFilesModal = document.getElementById('send-files-modal');
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  const selectedFilesContainer = document.getElementById('selected-files-container');
  const startFileTransferBtn = document.getElementById('start-file-transfer');
  const sendFilesCancelBtn = document.getElementById('send-files-cancel');
  let selectedFiles = [];

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('bg-gray-100');
  });
  dropZone.addEventListener('dragleave', e => {
    e.preventDefault();
    dropZone.classList.remove('bg-gray-100');
  });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('bg-gray-100');
    handleSelectedFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', e => {
    handleSelectedFiles(e.target.files);
  });

  function handleSelectedFiles(files) {
    for (const f of files) {
      selectedFiles.push(f);
    }
    renderSelectedFiles();
  }
  function renderSelectedFiles() {
    selectedFilesContainer.innerHTML = '';
    if (!selectedFiles.length) {
      startFileTransferBtn.disabled = true;
      return;
    }
    startFileTransferBtn.disabled = false;
    selectedFiles.forEach((file, i) => {
      const div = document.createElement('div');
      div.className = 'selected-file-item';
      const span = document.createElement('span');
      span.className = 'selected-file-name';
      span.textContent = file.name;
      const removeIcon = document.createElement('i');
      removeIcon.className = 'fas fa-trash text-red-500 cursor-pointer';
      removeIcon.addEventListener('click', () => {
        selectedFiles.splice(i, 1);
        renderSelectedFiles();
      });
      div.appendChild(span);
      div.appendChild(removeIcon);
      selectedFilesContainer.appendChild(div);
    });
  }

  sendFilesCancelBtn.addEventListener('click', () => {
    sendFilesModal.style.display = 'none';
    selectedFiles = [];
    renderSelectedFiles();
  });

  startFileTransferBtn.addEventListener('click', () => {
    if (!currentRecipientId || !selectedFiles.length) return;
    const peer = peersManager.getPeerById(currentRecipientId);
    if (!peer) return;
    // Send them
    peer.sendFiles(selectedFiles);
    sendFilesModal.style.display = 'none';
    selectedFiles = [];
    renderSelectedFiles();
  });

  //
  // Receiving Files
  //
  const receivingFilesModal = document.getElementById('receiving-files-modal');
  const fileProgressList = document.getElementById('file-progress-list');
  Evt.on('incoming-file', e => {
    // e.detail => { name, size, mime }
    receivingFilesModal.style.display = 'flex';
    const fileInfo = e.detail;
    const container = document.createElement('div');
    container.className = 'w-full mb-4';
    const label = document.createElement('p');
    label.textContent = fileInfo.name;
    label.className = 'text-sm mb-1 text-[#333533]';
    const progressBarContainer = document.createElement('div');
    progressBarContainer.className = 'file-progress-bar-container';
    const progressBar = document.createElement('div');
    progressBar.className = 'file-progress-bar';
    progressBar.style.width = '0%';
    progressBarContainer.appendChild(progressBar);
    container.appendChild(label);
    container.appendChild(progressBarContainer);
    fileProgressList.appendChild(container);

    // store a reference to update later
    fileInfo._progressBar = progressBar;
  });

  Evt.on('file-progress', e => {
    const progress = e.detail.progress;
    // if we wanted, we could track multiple files. For brevity, let's just update the last bar
    // or you can store them in an array keyed by name, etc.
    // We'll do a simple approach: find the last child in fileProgressList
    const last = fileProgressList.lastElementChild;
    if (!last) return;
    const bar = last.querySelector('.file-progress-bar');
    if (bar) bar.style.width = Math.floor(progress * 100) + '%';
  });

  // When the file is fully received
  let receivedFiles = [];
  Evt.on('file-received', e => {
    const { name, blob } = e.detail;
    receivedFiles.push({ name, blob });
    console.log('[RTC] Received file =>', name);

    // Optionally close the receiving modal if you want after a short time
    // Or if user is receiving multiple files, keep it open until they are all done.
    // Let's keep it open until user closes. If you want it auto-close, do:
    // receivingFilesModal.style.display = 'none';
  });

  // If you want a "File Preview" modal, we can attach it once all files done,
  // but Snapdrop just auto-triggers a download. We'll do your "Preview" approach:
  const filePreviewModal = document.getElementById('file-preview-modal');
  const filePreviewContent = document.getElementById('file-preview-content');
  let currentPreviewIndex = 0;

  // Let's override the old "file-transfer-finished" approach with a simple button to open a preview
  // or do it after each file is done, etc. We'll keep it simpler: once we get a new file, show the preview.
  Evt.on('file-received', () => {
    // Show the preview for the newly added file
    filePreviewModal.style.display = 'flex';
    currentPreviewIndex = receivedFiles.length - 1;
    renderPreviewSlide(currentPreviewIndex);
  });

  function renderPreviewSlide(i) {
    if (i < 0 || i >= receivedFiles.length) return;
    filePreviewContent.innerHTML = '';
    const { name, blob } = receivedFiles[i];
    // check if image
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) {
      const imgUrl = URL.createObjectURL(blob);
      const imgEl = document.createElement('img');
      imgEl.src = imgUrl;
      imgEl.className = 'max-w-full max-h-[400px] object-contain';
      filePreviewContent.appendChild(imgEl);
    } else {
      const icon = document.createElement('i');
      icon.className = 'fas fa-file fa-5x mb-2';
      filePreviewContent.appendChild(icon);
      const p = document.createElement('p');
      p.textContent = name;
      filePreviewContent.appendChild(p);
    }
  }

  document.getElementById('prev-file-btn').addEventListener('click', () => {
    currentPreviewIndex = Math.max(0, currentPreviewIndex - 1);
    renderPreviewSlide(currentPreviewIndex);
  });
  document.getElementById('next-file-btn').addEventListener('click', () => {
    currentPreviewIndex = Math.min(receivedFiles.length - 1, currentPreviewIndex + 1);
    renderPreviewSlide(currentPreviewIndex);
  });
  document.getElementById('file-preview-close').addEventListener('click', () => {
    filePreviewModal.style.display = 'none';
    receivedFiles = []; // clear so user doesn't keep them
    fileProgressList.innerHTML = ''; // also clear old progress
    receivingFilesModal.style.display = 'none';
  });
  document.getElementById('file-preview-backdrop').addEventListener('click', () => {
    filePreviewModal.style.display = 'none';
    receivedFiles = [];
    fileProgressList.innerHTML = '';
    receivingFilesModal.style.display = 'none';
  });

  // Download buttons
  document.getElementById('download-current-file').addEventListener('click', () => {
    if (!receivedFiles.length) return;
    const fileObj = receivedFiles[currentPreviewIndex];
    triggerDownload(fileObj);
  });
  document.getElementById('download-all-files').addEventListener('click', () => {
    receivedFiles.forEach(f => triggerDownload(f));
  });

  function triggerDownload(fileObj) {
    const url = URL.createObjectURL(fileObj.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileObj.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  //
  // If user or server disconnect => show modal
  //
  Evt.on('server-disconnected', () => {
    const modal = document.getElementById('server-disconnected-modal');
    modal.style.display = 'flex';
  });
  document.getElementById('server-disconnected-close').addEventListener('click', () => {
    document.getElementById('server-disconnected-modal').style.display = 'none';
  });

  //
  // Info & Author modals
  //
  document.getElementById('info-button').addEventListener('click', () => {
    document.getElementById('info-modal').style.display = 'flex';
  });
  document.getElementById('info-modal-close').addEventListener('click', () => {
    document.getElementById('info-modal').style.display = 'none';
  });
  document.getElementById('info-modal-backdrop').addEventListener('click', () => {
    document.getElementById('info-modal').style.display = 'none';
  });

  document.getElementById('author-button').addEventListener('click', () => {
    document.getElementById('author-modal').style.display = 'flex';
  });
  document.getElementById('author-modal-close').addEventListener('click', () => {
    document.getElementById('author-modal').style.display = 'none';
  });
  document.getElementById('author-modal-backdrop').addEventListener('click', () => {
    document.getElementById('author-modal').style.display = 'none';
  });

  //
  // That's it! The result is Snapdrop-like behavior using WebRTC data channels.
  //
});
