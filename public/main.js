/*************************************************************
 * main.js
 *
 * Major Features:
 *  - Shows each peer by codename (e.g. "Green Tiger")
 *  - WebSocket: discover peers, send "transfer-request" 
 *  - Upon accept, we do a WebRTC data channel for actual file transfer
 *  - The existing "Incoming Transfer" modals now work properly
 *************************************************************/

// A small event bus
const Evt = {
  on(evt, fn) {
    window.addEventListener(evt, fn, false);
  },
  off(evt, fn) {
    window.removeEventListener(evt, fn, false);
  },
  fire(evt, detail) {
    window.dispatchEvent(new CustomEvent(evt, { detail }));
  }
};

function detectDeviceType() {
  const ua = navigator.userAgent.toLowerCase();
  if (/mobile|iphone|ipod|blackberry|android.*mobile/.test(ua)) {
    return 'mobile';
  } else if (/ipad|android(?!.*mobile)/.test(ua)) {
    return 'tablet';
  }
  return 'desktop';
}

/***********************************************************
 * Our global server connection
 **********************************************************/
class ServerConnection {
  constructor(deviceType) {
    this.socket = null;
    this.id = null; // our own peerId
    this.displayName = null; // e.g. "Green Tiger"
    this.deviceType = deviceType;
    this.connect();
  }

  connect() {
    const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const endpoint = protocol + location.host;
    this.socket = new WebSocket(endpoint);

    this.socket.onopen = () => {
      console.log('[WS] open');
      // Introduce ourselves
      this.send({ type: 'introduce', name: { deviceType: this.deviceType } });
    };
    this.socket.onerror = (err) => {
      console.error('[WS] error:', err);
    };
    this.socket.onclose = () => {
      console.log('[WS] closed');
      document.getElementById('server-disconnected-modal').style.display = 'flex';
    };
    this.socket.onmessage = (evt) => this._onMessage(evt);
  }

  _onMessage(evt) {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'display-name': {
        // This is our own ID & codename
        this.id = msg.message.peerId;
        this.displayName = msg.message.displayName;
        const deviceNameElem = document.getElementById('device-name');
        if (deviceNameElem) deviceNameElem.textContent = this.displayName;
        break;
      }
      case 'peers':
        Evt.fire('server-peers', msg.peers);
        break;
      case 'peer-joined':
        Evt.fire('server-peer-joined', msg.peer);
        break;
      case 'peer-left':
        Evt.fire('server-peer-left', msg.peerId);
        break;
      case 'peer-updated':
        Evt.fire('server-peer-updated', msg.peer);
        break;
      case 'ping':
        this.send({ type: 'pong' });
        break;
      case 'signal':
      case 'transfer-request':
      case 'transfer-accept':
      case 'transfer-decline':
      case 'transfer-cancel':
      case 'send-message':
      case 'transfer-complete':
      case 'transfer-error': {
        // Forward to your code
        Evt.fire(msg.type, msg);
        break;
      }
      default:
        console.log('[WS] unknown type:', msg);
        break;
    }
  }

  send(obj) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(obj));
    }
  }
}

/***********************************************************
 * A container for all known peers
 **********************************************************/
class PeersManager {
  constructor(server) {
    this.server = server;
    // Map of peerId => { info, rtp: RTCPeer or null, autoAccept: false }
    this.peers = {};

    // Listen for server events
    Evt.on('server-peers', (e) => this._onPeersList(e.detail));
    Evt.on('server-peer-joined', (e) => this._onPeerJoined(e.detail));
    Evt.on('server-peer-left', (e) => this._onPeerLeft(e.detail));
    Evt.on('server-peer-updated', (e) => this._onPeerUpdated(e.detail));

    // Listen for WebRTC signals
    Evt.on('signal', (e) => this._onSignal(e.detail));

    // The user’s “transfer-request” flow
    Evt.on('transfer-request', (e) => this._onTransferRequest(e.detail));
    Evt.on('transfer-accept', (e) => this._onTransferAccept(e.detail));
    Evt.on('transfer-decline', (e) => this._onTransferDecline(e.detail));
    Evt.on('transfer-cancel', (e) => this._onTransferCancel(e.detail));

    // text messages
    Evt.on('send-message', (e) => this._onSendMessage(e.detail));
  }

  _onPeersList(peersArr) {
    // peersArr => array of { id, name { displayName, ...}, rtcSupported }
    peersArr.forEach((p) => {
      this.peers[p.id] = {
        info: p,
        rtp: null,
        autoAccept: false
      };
    });
    this._updateUI();
  }

  _onPeerJoined(peerInfo) {
    this.peers[peerInfo.id] = {
      info: peerInfo,
      rtp: null,
      autoAccept: false
    };
    this._updateUI();
  }

  _onPeerLeft(peerId) {
    delete this.peers[peerId];
    this._updateUI();
  }

  _onPeerUpdated(peerInfo) {
    if (!this.peers[peerInfo.id]) {
      this.peers[peerInfo.id] = { info: peerInfo, rtp: null, autoAccept: false };
    } else {
      this.peers[peerInfo.id].info = peerInfo;
    }
    this._updateUI();
  }

  _updateUI() {
    const peers = Object.values(this.peers);
    const peerListElement = document.getElementById('peer-list');
    const noPeersMessage = document.getElementById('no-peers-message');

    if (!peers.length) {
      noPeersMessage.style.display = 'block';
      peerListElement.innerHTML = '';
      return;
    }
    noPeersMessage.style.display = 'none';
    peerListElement.innerHTML = '';

    peers.forEach((p) => {
      const btn = document.createElement('button');
      btn.className =
        'peer-button w-full py-[15px] text-xl bg-[#333533] text-white rounded-lg hover:bg-[#242423] transition-colors';

      const iconEl = document.createElement('i');
      iconEl.classList.add('fas', 'fa-desktop', 'peer-device-icon', 'text-white');
      const textSpan = document.createElement('span');
      // show the codename from p.info.name.displayName
      textSpan.textContent = p.info.name.displayName;

      btn.appendChild(iconEl);
      btn.appendChild(textSpan);

      btn.addEventListener('click', () => {
        // open "choose action" modal
        window.currentRecipientId = p.info.id;
        const modal = document.getElementById('choose-action-modal');
        document.getElementById('choose-action-device-name').textContent =
          'Send to ' + p.info.name.displayName;
        modal.style.display = 'flex';
      });

      peerListElement.appendChild(btn);
    });
  }

  // Called when we get a "signal" from the server => setRemoteDescription or ICE
  _onSignal(msg) {
    const fromId = msg.sender;
    let peerObj = this.peers[fromId];
    if (!peerObj) {
      // create
      peerObj = {
        info: { id: fromId, name: { displayName: '??' } },
        rtp: null,
        autoAccept: false
      };
      this.peers[fromId] = peerObj;
    }
    if (!peerObj.rtp) {
      peerObj.rtp = new RTCPeerConnectionWrapper(this.server, fromId);
    }
    peerObj.rtp.handleSignal(msg);
  }

  /*********************************************************
   * The "transfer-request" flow
   *********************************************************/
  _onTransferRequest(msg) {
    // receiving side => show "Incoming Transfer" unless autoAccept is set
    const fromId = msg.sender;
    let peerObj = this.peers[fromId];
    if (!peerObj) {
      peerObj = {
        info: { id: fromId, name: { displayName: '??' } },
        rtp: null,
        autoAccept: false
      };
      this.peers[fromId] = peerObj;
    }
    const fromName = peerObj.info.name?.displayName || 'Unknown';

    if (peerObj.autoAccept) {
      // auto-accept
      this.server.send({
        type: 'transfer-accept',
        to: fromId,
        mode: msg.mode
      });
      // show "receiving-status-modal"
      document.getElementById('incoming-request-modal').style.display = 'none';
      const statModal = document.getElementById('receiving-status-modal');
      const statText = document.getElementById('receiving-status-text');
      statText.textContent = `Waiting for ${fromName} to send ${msg.mode === 'files' ? 'files' : 'a message'}...`;
      statModal.style.display = 'flex';
      return;
    }

    // show "incoming-request-modal"
    const incModal = document.getElementById('incoming-request-modal');
    const incText = document.getElementById('incoming-request-text');
    incText.textContent = `${fromName} wants to send ${msg.mode === 'files' ? 'files' : 'a message'}.`;
    incModal.style.display = 'flex';

    // Accept or decline
    const acceptBtn = document.getElementById('incoming-accept-button');
    const declineBtn = document.getElementById('incoming-decline-button');
    const autoChk = document.getElementById('always-accept-checkbox');

    const handleAccept = () => {
      incModal.style.display = 'none';
      if (autoChk.checked) peerObj.autoAccept = true;

      this.server.send({
        type: 'transfer-accept',
        to: fromId,
        mode: msg.mode
      });
      // show "receiving-status-modal"
      const statModal = document.getElementById('receiving-status-modal');
      const statText = document.getElementById('receiving-status-text');
      statText.textContent = `Waiting for ${fromName} to send ${msg.mode === 'files' ? 'files' : 'a message'}...`;
      statModal.style.display = 'flex';

      acceptBtn.removeEventListener('click', handleAccept);
      declineBtn.removeEventListener('click', handleDecline);
    };

    const handleDecline = () => {
      incModal.style.display = 'none';
      this.server.send({
        type: 'transfer-decline',
        to: fromId
      });
      acceptBtn.removeEventListener('click', handleAccept);
      declineBtn.removeEventListener('click', handleDecline);
    };

    acceptBtn.addEventListener('click', handleAccept);
    declineBtn.addEventListener('click', handleDecline);
  }

  _onTransferAccept(msg) {
    // sender side => hide "waiting-response-modal", open RTCPeer
    const fromId = msg.sender;
    const mode = msg.mode;
    let peerObj = this.peers[fromId];
    if (!peerObj) {
      peerObj = {
        info: { id: fromId, name: { displayName: '??' } },
        rtp: null,
        autoAccept: false
      };
      this.peers[fromId] = peerObj;
    }
    document.getElementById('waiting-response-modal').style.display = 'none';

    // create the RTCPeer if not existing
    if (!peerObj.rtp) {
      peerObj.rtp = new RTCPeerConnectionWrapper(this.server, fromId, true);
    }

    if (mode === 'files') {
      // show "send-files-modal"
      document.getElementById('send-files-modal').style.display = 'flex';
    } else if (mode === 'message') {
      // show "send-message-modal"
      document.getElementById('send-message-modal').style.display = 'flex';
    }
  }

  _onTransferDecline(msg) {
    // sender side => hide waiting modal
    document.getElementById('waiting-response-modal').style.display = 'none';
    alert('They declined the transfer.');
  }

  _onTransferCancel(msg) {
    // either side => close modals
    alert('The other device canceled the transfer.');
    document.getElementById('waiting-response-modal').style.display = 'none';
    document.getElementById('send-files-modal').style.display = 'none';
    document.getElementById('send-message-modal').style.display = 'none';
    document.getElementById('receiving-status-modal').style.display = 'none';
  }

  /*********************************************************
   * If we see "send-message" directly from the server, that
   * might be a fallback—but we're using WebRTC. In your code,
   * you might actually just do "incoming-message" 
   * if you want a fallback. We'll do minimal handling here.
   *********************************************************/
  _onSendMessage(msg) {
    // (If you did actual fallback text over WS. 
    // For pure WebRTC, you can ignore. Or display "Message from X"?)
  }

  // Helper to retrieve or create an RTCPeerConnection
  ensureRTCPeer(peerId, isCaller) {
    let p = this.peers[peerId];
    if (!p) {
      p = {
        info: { id: peerId, name: { displayName: '??' } },
        rtp: null,
        autoAccept: false
      };
      this.peers[peerId] = p;
    }
    if (!p.rtp) {
      p.rtp = new RTCPeerConnectionWrapper(this.server, peerId, isCaller);
    }
    return p.rtp;
  }
}

/***********************************************************
 * A thin wrapper that sets up a data channel for file xfers
 * or text messages (like Snapdrop). 
 * We do not open the channel until we actually need it, 
 * or if we are the "caller" we open immediately.
 **********************************************************/
class RTCPeerConnectionWrapper {
  constructor(server, remoteId, isCaller=false) {
    this.server = server;
    this.remoteId = remoteId;
    this.pc = null;
    this.dc = null;
    this._init(isCaller);
  }

  _init(isCaller) {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.server.send({
          type: 'signal',
          to: this.remoteId,
          ice: e.candidate
        });
      }
    };
    this.pc.onconnectionstatechange = () => {
      console.log('[RTC] connectionState =', this.pc.connectionState);
      if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
        // Let user know
        document.getElementById('peer-lost-modal').style.display = 'flex';
      }
    };
    this.pc.oniceconnectionstatechange = () => {
      console.log('[RTC] iceConnectionState =', this.pc.iceConnectionState);
    };

    if (isCaller) {
      this.dc = this.pc.createDataChannel('drpl');
      this._setupDataChannel(this.dc);
      this.pc
        .createOffer()
        .then((desc) => this.pc.setLocalDescription(desc))
        .then(() => {
          this.server.send({
            type: 'signal',
            to: this.remoteId,
            sdp: this.pc.localDescription
          });
        });
    } else {
      // wait for ondatachannel
      this.pc.ondatachannel = (evt) => {
        this.dc = evt.channel;
        this._setupDataChannel(this.dc);
      };
    }
  }

  handleSignal(msg) {
    if (msg.sdp) {
      this._onRemoteDesc(msg.sdp);
    } else if (msg.ice) {
      this.pc.addIceCandidate(new RTCIceCandidate(msg.ice)).catch(console.error);
    }
  }

  _onRemoteDesc(sdp) {
    const desc = new RTCSessionDescription(sdp);
    this.pc
      .setRemoteDescription(desc)
      .then(() => {
        if (desc.type === 'offer') {
          // create answer
          return this.pc
            .createAnswer()
            .then((ans) => this.pc.setLocalDescription(ans))
            .then(() => {
              this.server.send({
                type: 'signal',
                to: this.remoteId,
                sdp: this.pc.localDescription
              });
            });
        }
      })
      .catch(console.error);
  }

  _setupDataChannel(dc) {
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      console.log('[RTC] dataChannel open with', this.remoteId);
    };
    dc.onmessage = (evt) => {
      // The actual file or text chunk
      Evt.fire('rtc-data', { fromId: this.remoteId, data: evt.data });
    };
    dc.onclose = () => {
      console.log('[RTC] dataChannel closed with', this.remoteId);
    };
  }

  sendData(data) {
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(data);
    }
  }
}

/***********************************************************
 * We'll keep the same "transfer-request" approach for 
 * sending files and messages, but the actual bits go 
 * over the data channel in Snapdrop style. 
 **********************************************************/
document.addEventListener('DOMContentLoaded', () => {
  const deviceType = detectDeviceType();
  const server = new ServerConnection(deviceType);
  const peersMgr = new PeersManager(server);

  // We'll store some ephemeral states
  let currentMode = null; // 'files' or 'message'
  let currentRecipientId = null;

  // Hook up the "choose action" modal
  const chooseActionModal = document.getElementById('choose-action-modal');
  const chooseActionBackdrop = document.getElementById('choose-action-backdrop');
  const chooseActionSendFilesBtn = document.getElementById('choose-action-send-files');
  const chooseActionSendMsgBtn = document.getElementById('choose-action-send-message');

  chooseActionSendFilesBtn.addEventListener('click', () => {
    chooseActionModal.style.display = 'none';
    // Send a "transfer-request" for files
    if (!window.currentRecipientId) return;
    currentRecipientId = window.currentRecipientId;
    currentMode = 'files';

    // show "waiting-response-modal"
    document.getElementById('waiting-response-modal').style.display = 'flex';
    const peerName = peersMgr.peers[currentRecipientId]?.info.name.displayName || 'Unknown';
    document.getElementById('waiting-response-text').textContent =
      `Waiting for ${peerName} to accept...`;

    server.send({
      type: 'transfer-request',
      to: currentRecipientId,
      fromDisplayName: server.displayName,
      mode: 'files'
    });
  });

  chooseActionSendMsgBtn.addEventListener('click', () => {
    chooseActionModal.style.display = 'none';
    if (!window.currentRecipientId) return;
    currentRecipientId = window.currentRecipientId;
    currentMode = 'message';

    // show "waiting-response-modal"
    document.getElementById('waiting-response-modal').style.display = 'flex';
    const peerName = peersMgr.peers[currentRecipientId]?.info.name.displayName || 'Unknown';
    document.getElementById('waiting-response-text').textContent =
      `Waiting for ${peerName} to accept...`;

    server.send({
      type: 'transfer-request',
      to: currentRecipientId,
      fromDisplayName: server.displayName,
      mode: 'message'
    });
  });
  chooseActionBackdrop.addEventListener('click', () => {
    chooseActionModal.style.display = 'none';
  });

  // CANCEL from waiting or backdrop
  const waitingRespModal = document.getElementById('waiting-response-modal');
  const waitingCancelBtn = document.getElementById('waiting-cancel-button');
  const waitingBackdrop = document.getElementById('waiting-response-backdrop');
  function cancelFlow() {
    waitingRespModal.style.display = 'none';
    server.send({ type: 'transfer-cancel', to: currentRecipientId });
  }
  waitingCancelBtn.addEventListener('click', cancelFlow);
  waitingBackdrop.addEventListener('click', cancelFlow);

  // On the receiving side, after accepting, we show "receiving-status-modal" 
  // => done in the PeersManager. The user can also implement a "cancel" if they want.

  // If "transfer-cancel" => see `_onTransferCancel` in PeersManager to hide modals.

  /***********************************************************
   * SENDING MESSAGES once accepted
   ***********************************************************/
  const sendMsgModal = document.getElementById('send-message-modal');
  const sendMsgBackdrop = document.getElementById('send-message-backdrop');
  const sendMsgCancelBtn = document.getElementById('send-message-cancel');
  const sendMsgBtn = document.getElementById('send-message-button');
  const messageInput = document.getElementById('message-input');

  sendMsgCancelBtn.addEventListener('click', () => {
    sendMsgModal.style.display = 'none';
    server.send({ type: 'transfer-cancel', to: currentRecipientId });
  });
  sendMsgBackdrop.addEventListener('click', () => {
    sendMsgModal.style.display = 'none';
    server.send({ type: 'transfer-cancel', to: currentRecipientId });
  });
  sendMsgBtn.addEventListener('click', () => {
    const text = messageInput.value.trim();
    if (!text || !currentRecipientId) return;
    const rtpw = peersMgr.ensureRTCPeer(currentRecipientId, true);
    // We'll send "type: 'text', text" as JSON
    const obj = { type: 'text', text: btoa(unescape(encodeURIComponent(text))) };
    if (rtpw.dc && rtpw.dc.readyState === 'open') {
      rtpw.dc.send(JSON.stringify(obj));
    }
    messageInput.value = '';
    sendMsgModal.style.display = 'none';
    // show "transfer-complete" modal?
    document.getElementById('transfer-complete-title').textContent = 'Transfer Complete';
    document.getElementById('transfer-complete-text').textContent =
      `Your message has been delivered.`;
    document.getElementById('transfer-complete-modal').style.display = 'flex';
  });

  // If we receive text from the data channel, show "incoming-message-modal"
  Evt.on('rtc-data', (e) => {
    const { data, fromId } = e.detail;
    if (typeof data === 'string') {
      try {
        const obj = JSON.parse(data);
        if (obj.type === 'text') {
          const decoded = decodeURIComponent(escape(atob(obj.text)));
          // show "incoming-message-modal"
          const incMsgModal = document.getElementById('incoming-message-modal');
          document.getElementById('incoming-message-header').textContent =
            `Message from ${peersMgr.peers[fromId]?.info.name.displayName || 'Unknown'}`;
          document.getElementById('incoming-message-text').textContent = decoded;
          incMsgModal.style.display = 'flex';

          // Hide "receiving-status-modal"
          document.getElementById('receiving-status-modal').style.display = 'none';

          // We can also send a "transfer-complete" if we want:
          server.send({
            type: 'transfer-complete',
            to: fromId
          });
        } else if (obj.type === 'header' || obj.type === 'done') {
          // handled in the file logic below
        }
      } catch {
        // plain text?
      }
    } else {
      // array buffer => file chunk => handled in next section
    }
  });

  // "incoming-message-modal" => close or respond
  document.getElementById('incoming-message-close').addEventListener('click', () => {
    document.getElementById('incoming-message-modal').style.display = 'none';
  });
  document.getElementById('incoming-message-respond').addEventListener('click', () => {
    document.getElementById('incoming-message-modal').style.display = 'none';
    document.getElementById('send-message-modal').style.display = 'flex';
  });

  /***********************************************************
   * SENDING FILES once accepted
   ***********************************************************/
  const sendFilesModal = document.getElementById('send-files-modal');
  const sendFilesBackdrop = document.getElementById('send-files-backdrop');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const selectedFilesContainer = document.getElementById('selected-files-container');
  const sendFilesCancelBtn = document.getElementById('send-files-cancel');
  const startFileTransferBtn = document.getElementById('start-file-transfer');
  let selectedFiles = [];

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (evt) => {
    evt.preventDefault();
    dropZone.classList.add('bg-gray-100');
  });
  dropZone.addEventListener('dragleave', (evt) => {
    evt.preventDefault();
    dropZone.classList.remove('bg-gray-100');
  });
  dropZone.addEventListener('drop', (evt) => {
    evt.preventDefault();
    dropZone.classList.remove('bg-gray-100');
    if (evt.dataTransfer.files && evt.dataTransfer.files.length) {
      handleFiles(evt.dataTransfer.files);
    }
  });
  fileInput.addEventListener('change', (evt) => {
    handleFiles(evt.target.files);
  });

  function handleFiles(files) {
    for (let i = 0; i < files.length; i++) {
      selectedFiles.push(files[i]);
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
    selectedFiles.forEach((file, idx) => {
      const div = document.createElement('div');
      div.className = 'selected-file-item';
      const span = document.createElement('span');
      span.className = 'selected-file-name';
      span.textContent = file.name;
      const trash = document.createElement('i');
      trash.className = 'fas fa-trash text-red-500 cursor-pointer';
      trash.addEventListener('click', () => {
        selectedFiles.splice(idx, 1);
        renderSelectedFiles();
      });
      div.appendChild(span);
      div.appendChild(trash);
      selectedFilesContainer.appendChild(div);
    });
  }

  sendFilesCancelBtn.addEventListener('click', () => {
    sendFilesModal.style.display = 'none';
    server.send({ type: 'transfer-cancel', to: currentRecipientId });
    selectedFiles = [];
  });
  sendFilesBackdrop.addEventListener('click', () => {
    sendFilesModal.style.display = 'none';
    server.send({ type: 'transfer-cancel', to: currentRecipientId });
    selectedFiles = [];
  });

  startFileTransferBtn.addEventListener('click', () => {
    if (!currentRecipientId || !selectedFiles.length) return;
    sendFilesModal.style.display = 'none';

    // We'll chunk the files over the datachannel
    const rtpw = peersMgr.ensureRTCPeer(currentRecipientId, true);
    // For each file => do Snapdrop style chunking
    (async function sendAll() {
      for (const file of selectedFiles) {
        // 1) send a "header"
        const header = JSON.stringify({
          type: 'header',
          name: file.name,
          size: file.size,
          mime: file.type
        });
        rtpw.sendData(header);

        // 2) chunk
        const chunkSize = 65536;
        let offset = 0;
        while (offset < file.size) {
          const slice = file.slice(offset, offset + chunkSize);
          const buffer = await slice.arrayBuffer();
          rtpw.sendData(buffer);
          offset += buffer.byteLength;
          // small pause
          await new Promise((res) => setTimeout(res, 0));
        }

        // 3) done
        const doneMsg = JSON.stringify({ type: 'done' });
        rtpw.sendData(doneMsg);
      }
      // show "transfer-complete" for the user
      document.getElementById('transfer-complete-title').textContent = 'Transfer Complete';
      document.getElementById('transfer-complete-text').textContent =
        `Your file(s) have been delivered.`;
      document.getElementById('transfer-complete-modal').style.display = 'flex';
    })();

    selectedFiles = [];
    renderSelectedFiles();
  });

  // Receiving side: if we see "rtc-data" with "header"/"done" or chunk => reassemble
  const receivingFilesModal = document.getElementById('receiving-files-modal');
  const fileProgressList = document.getElementById('file-progress-list');
  let incomingFileDigester = null;
  let receivedFiles = [];

  Evt.on('rtc-data', (e) => {
    const { data, fromId } = e.detail;
    if (typeof data === 'string') {
      // maybe JSON?
      let obj;
      try {
        obj = JSON.parse(data);
      } catch {
        return;
      }
      if (obj.type === 'header') {
        // open receiving-files-modal
        receivingFilesModal.style.display = 'flex';
        incomingFileDigester = {
          name: obj.name,
          size: obj.size,
          mime: obj.mime,
          chunks: [],
          bytes: 0
        };
        // create a progress bar
        const container = document.createElement('div');
        container.className = 'w-full mb-4';
        const label = document.createElement('p');
        label.className = 'text-sm mb-1 text-[#333533]';
        label.textContent = obj.name;
        const barC = document.createElement('div');
        barC.className = 'file-progress-bar-container';
        const bar = document.createElement('div');
        bar.className = 'file-progress-bar';
        bar.style.width = '0%';
        barC.appendChild(bar);
        container.appendChild(label);
        container.appendChild(barC);
        fileProgressList.appendChild(container);
        incomingFileDigester._bar = bar;

        // hide "receiving-status-modal"
        document.getElementById('receiving-status-modal').style.display = 'none';
      } else if (obj.type === 'done') {
        if (!incomingFileDigester) return;
        // finalize
        const { name, mime, size, chunks } = incomingFileDigester;
        const blob = new Blob(chunks, { type: mime });
        receivedFiles.push({ name, blob });

        // reset
        incomingFileDigester = null;

        // open file-preview-modal automatically:
        const fpModal = document.getElementById('file-preview-modal');
        fpModal.style.display = 'flex';
        renderFilePreview(receivedFiles.length - 1);

        // we can also send "transfer-complete" to the sender
        server.send({
          type: 'transfer-complete',
          to: fromId
        });
      }
    } else {
      // array buffer => chunk
      if (incomingFileDigester) {
        incomingFileDigester.chunks.push(data);
        incomingFileDigester.bytes += data.byteLength;
        const pct = Math.floor((incomingFileDigester.bytes / incomingFileDigester.size) * 100);
        if (incomingFileDigester._bar) {
          incomingFileDigester._bar.style.width = pct + '%';
        }
      }
    }
  });

  // file-preview logic
  const filePreviewModal = document.getElementById('file-preview-modal');
  const filePreviewContent = document.getElementById('file-preview-content');
  let currentFileIndex = 0;
  function renderFilePreview(i) {
    if (i < 0 || i >= receivedFiles.length) return;
    currentFileIndex = i;
    filePreviewContent.innerHTML = '';
    const { name, blob } = receivedFiles[i];
    // if image
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) {
      const imgUrl = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = imgUrl;
      img.className = 'max-w-full max-h-[400px] object-contain';
      filePreviewContent.appendChild(img);
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
    if (currentFileIndex > 0) {
      currentFileIndex--;
      renderFilePreview(currentFileIndex);
    }
  });
  document.getElementById('next-file-btn').addEventListener('click', () => {
    if (currentFileIndex < receivedFiles.length - 1) {
      currentFileIndex++;
      renderFilePreview(currentFileIndex);
    }
  });
  document.getElementById('file-preview-close').addEventListener('click', () => {
    filePreviewModal.style.display = 'none';
    // clear if you like
  });
  document.getElementById('file-preview-backdrop').addEventListener('click', () => {
    filePreviewModal.style.display = 'none';
  });

  // Download buttons
  document.getElementById('download-current-file').addEventListener('click', () => {
    if (!receivedFiles.length) return;
    const { name, blob } = receivedFiles[currentFileIndex];
    triggerDownload(name, blob);
  });
  document.getElementById('download-all-files').addEventListener('click', () => {
    receivedFiles.forEach((f) => triggerDownload(f.name, f.blob));
  });

  function triggerDownload(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Transfer complete modal
  Evt.on('transfer-complete', (e) => {
    // if I'm the sender, show a success
    document.getElementById('transfer-complete-title').textContent = 'Transfer Complete';
    document.getElementById('transfer-complete-text').textContent =
      'Your transfer is complete!';
    document.getElementById('transfer-complete-modal').style.display = 'flex';
  });
  const tcClose = document.getElementById('transfer-complete-close');
  const tcBackdrop = document.getElementById('transfer-complete-backdrop');
  tcClose.addEventListener('click', () => {
    document.getElementById('transfer-complete-modal').style.display = 'none';
  });
  tcBackdrop.addEventListener('click', () => {
    document.getElementById('transfer-complete-modal').style.display = 'none';
  });

  // Peer lost modal
  document.getElementById('peer-lost-close').addEventListener('click', () => {
    document.getElementById('peer-lost-modal').style.display = 'none';
  });
  document.getElementById('peer-lost-backdrop').addEventListener('click', () => {
    document.getElementById('peer-lost-modal').style.display = 'none';
  });

  // server-disconnected
  document.getElementById('server-disconnected-close').addEventListener('click', () => {
    document.getElementById('server-disconnected-modal').style.display = 'none';
  });

  // Info & Author modals
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
});
