/*************************************************************
 * main.js
 *
 * Major Updates:
 *  1) closeAllModals() to ensure old modals hide before showing a new one
 *  2) Fix message send bug after "Respond Back" by reusing the same event
 *  3) Add "batch-header" for multi-file receiving with "File X of Y"
 *  4) Add console logs for chunk sending & receiving
 *  5) Add a simple buffer check to avoid saturating the data channel
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
      textSpan.textContent = p.info.name.displayName;

      btn.appendChild(iconEl);
      btn.appendChild(textSpan);

      btn.addEventListener('click', () => {
        window.currentRecipientId = p.info.id;
        closeAllModals();
        document.getElementById('choose-action-device-name').textContent =
          'Send to ' + p.info.name.displayName;
        document.getElementById('choose-action-modal').style.display = 'flex';
      });

      peerListElement.appendChild(btn);
    });
  }

  // Called when we get a "signal" from the server => setRemoteDescription or ICE
  _onSignal(msg) {
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
    if (!peerObj.rtp) {
      peerObj.rtp = new RTCPeerConnectionWrapper(this.server, fromId);
    }
    peerObj.rtp.handleSignal(msg);
  }

  /*********************************************************
   * The "transfer-request" flow
   *********************************************************/
  _onTransferRequest(msg) {
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
      console.log('[transfer-request] auto-accept for', fromName);
      this.server.send({
        type: 'transfer-accept',
        to: fromId,
        mode: msg.mode
      });
      closeAllModals();
      document.getElementById('receiving-status-text').textContent = `Waiting for ${fromName} to send ${msg.mode === 'files' ? 'files' : 'a message'}...`;
      document.getElementById('receiving-status-modal').style.display = 'flex';
      return;
    }

    console.log('[transfer-request] from', fromName, 'mode=', msg.mode);
    closeAllModals();
    const incModal = document.getElementById('incoming-request-modal');
    const incText = document.getElementById('incoming-request-text');
    incText.textContent = `${fromName} wants to send ${msg.mode === 'files' ? 'files' : 'a message'}.`;
    incModal.style.display = 'flex';

    const acceptBtn = document.getElementById('incoming-accept-button');
    const declineBtn = document.getElementById('incoming-decline-button');
    const autoChk = document.getElementById('always-accept-checkbox');

    function handleAccept() {
      incModal.style.display = 'none';
      if (autoChk.checked) peerObj.autoAccept = true;
      console.log('[transfer-request] user accepted from', fromName);
      Evt.off('click-accept', handleAccept);
      Evt.off('click-decline', handleDecline);

      // show receiving status
      document.getElementById('receiving-status-text').textContent = `Waiting for ${fromName} to send ${msg.mode === 'files' ? 'files' : 'a message'}...`;
      document.getElementById('receiving-status-modal').style.display = 'flex';

      // Send accept
      peerObj.autoAccept = autoChk.checked;
      setTimeout(() => {
        // short delay to ensure UI is up
        console.log('[transfer-request] sending transfer-accept to', fromName);
        Evt.fire('transfer-accept-local', { fromId, mode: msg.mode }); // local event if you want
        // or just do server
        peerObj.autoAccept = autoChk.checked;
        autoChk.checked = false;
        Evt.off('click-accept', handleAccept);
        Evt.off('click-decline', handleDecline);

        // do actual server send
        this.server.send({
          type: 'transfer-accept',
          to: fromId,
          mode: msg.mode
        });
      }, 100);
    }

    function handleDecline() {
      console.log('[transfer-request] user declined from', fromName);
      incModal.style.display = 'none';
      Evt.off('click-accept', handleAccept);
      Evt.off('click-decline', handleDecline);
      autoChk.checked = false;
      this.server.send({ type: 'transfer-decline', to: fromId });
    }
    // Because we keep re-assigning these, let's do them once
    acceptBtn.onclick = handleAccept.bind(this);
    declineBtn.onclick = handleDecline.bind(this);
  }

  _onTransferAccept(msg) {
    // sender side => hide "waiting-response-modal"
    closeAllModals();
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
    console.log('[transfer-accept] from', peerObj.info.name.displayName, 'mode=', mode);

    if (!peerObj.rtp) {
      peerObj.rtp = new RTCPeerConnectionWrapper(this.server, fromId, true);
    }

    if (mode === 'files') {
      document.getElementById('send-files-modal').style.display = 'flex';
    } else if (mode === 'message') {
      document.getElementById('send-message-modal').style.display = 'flex';
    }
  }

  _onTransferDecline(msg) {
    closeAllModals();
    alert('They declined the transfer.');
  }

  _onTransferCancel(msg) {
    closeAllModals();
    alert('The other device canceled the transfer.');
  }

  // fallback or no-op
  _onSendMessage(msg) {
    console.log('[send-message fallback? not used]', msg);
  }

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
 **********************************************************/
class RTCPeerConnectionWrapper {
  constructor(server, remoteId, isCaller = false) {
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
      Evt.fire('rtc-data', { fromId: this.remoteId, data: evt.data });
    };
    dc.onclose = () => {
      console.log('[RTC] dataChannel closed with', this.remoteId);
    };
  }

  /**
   * Attempt to safely send data, checking bufferedAmount
   * so we don't saturate the link
   */
  async sendData(data) {
    if (!this.dc || this.dc.readyState !== 'open') {
      console.warn('[RTC] Channel not open, cannot send');
      return;
    }
    // Wait for bufferedAmount to be below a threshold
    while (this.dc.bufferedAmount > 1024 * 1024) {
      // wait
      console.log('[RTC] bufferedAmount =', this.dc.bufferedAmount, ' waiting...');
      await new Promise((res) => setTimeout(res, 50));
    }
    this.dc.send(data);
  }
}

/***********************************************************
 * Close all modals to ensure old ones hide before new open
 **********************************************************/
function closeAllModals() {
  const modals = [
    'choose-action-modal',
    'incoming-request-modal',
    'waiting-response-modal',
    'receiving-status-modal',
    'send-message-modal',
    'incoming-message-modal',
    'transfer-complete-modal',
    'peer-lost-modal',
    'send-files-modal',
    'receiving-files-modal',
    'file-preview-modal'
  ];
  for (const m of modals) {
    document.getElementById(m).style.display = 'none';
  }
}

/***********************************************************
 * Main script
 **********************************************************/
document.addEventListener('DOMContentLoaded', () => {
  const deviceType = detectDeviceType();
  const server = new ServerConnection(deviceType);
  const peersMgr = new PeersManager(server);

  // We'll store ephemeral state
  let currentRecipientId = null;

  /***********************************************************
   * "Choose Action" modal
   **********************************************************/
  const chooseActionModal = document.getElementById('choose-action-modal');
  const chooseActionBackdrop = document.getElementById('choose-action-backdrop');
  const chooseActionSendFilesBtn = document.getElementById('choose-action-send-files');
  const chooseActionSendMsgBtn = document.getElementById('choose-action-send-message');

  chooseActionSendFilesBtn.addEventListener('click', () => {
    closeAllModals();
    if (!window.currentRecipientId) return;
    currentRecipientId = window.currentRecipientId;
    console.log('[choose-action] user chose "Send Files" to', currentRecipientId);

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
    closeAllModals();
    if (!window.currentRecipientId) return;
    currentRecipientId = window.currentRecipientId;
    console.log('[choose-action] user chose "Send Message" to', currentRecipientId);

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

  // Cancel from waiting or backdrop
  const waitingRespModal = document.getElementById('waiting-response-modal');
  const waitingCancelBtn = document.getElementById('waiting-cancel-button');
  const waitingBackdrop = document.getElementById('waiting-response-backdrop');
  function cancelFlow() {
    console.log('[waiting-response] user canceled');
    closeAllModals();
    server.send({ type: 'transfer-cancel', to: currentRecipientId });
  }
  waitingCancelBtn.onclick = cancelFlow;
  waitingBackdrop.onclick = cancelFlow;

  /***********************************************************
   * SENDING MESSAGES
   **********************************************************/
  const sendMsgModal = document.getElementById('send-message-modal');
  const sendMsgBackdrop = document.getElementById('send-message-backdrop');
  const sendMsgCancelBtn = document.getElementById('send-message-cancel');
  const sendMsgBtn = document.getElementById('send-message-button');
  const messageInput = document.getElementById('message-input');

  function cancelMessage() {
    console.log('[send-message] user canceled');
    closeAllModals();
    server.send({ type: 'transfer-cancel', to: currentRecipientId });
    messageInput.value = '';
  }

  sendMsgCancelBtn.onclick = cancelMessage;
  sendMsgBackdrop.onclick = cancelMessage;

  sendMsgBtn.onclick = async () => {
    const text = messageInput.value.trim();
    if (!text || !currentRecipientId) return;
    console.log('[send-message] sending text to', currentRecipientId, text);
    const rtpw = peersMgr.ensureRTCPeer(currentRecipientId, true);
    const obj = { type: 'text', text: btoa(unescape(encodeURIComponent(text))) };

    if (!rtpw.dc || rtpw.dc.readyState !== 'open') {
      console.warn('[send-message] datachannel not open, cannot send');
      return;
    }
    await rtpw.sendData(JSON.stringify(obj));
    messageInput.value = '';
    closeAllModals();

    document.getElementById('transfer-complete-title').textContent = 'Transfer Complete';
    document.getElementById('transfer-complete-text').textContent =
      `Your message has been delivered.`;
    document.getElementById('transfer-complete-modal').style.display = 'flex';
  };

  // If we receive text from the data channel
  Evt.on('rtc-data', (e) => {
    const { data, fromId } = e.detail;
    if (typeof data === 'string') {
      // Possibly JSON
      let obj;
      try {
        obj = JSON.parse(data);
      } catch {
        // plain text
        return;
      }
      if (obj.type === 'text') {
        console.log('[rtc-data text] from', fromId, ' =>', obj);
        const decoded = decodeURIComponent(escape(atob(obj.text)));
        closeAllModals();
        document.getElementById('incoming-message-header').textContent =
          `Message from ${peersMgr.peers[fromId]?.info.name.displayName || 'Unknown'}`;
        document.getElementById('incoming-message-text').textContent = decoded;
        document.getElementById('incoming-message-modal').style.display = 'flex';

        // send "transfer-complete" so sender sees a success
        server.send({
          type: 'transfer-complete',
          to: fromId
        });
      }
    }
  });

  // "incoming-message-modal" => close or respond
  document.getElementById('incoming-message-close').onclick = () => {
    closeAllModals();
  };
  document.getElementById('incoming-message-respond').onclick = () => {
    closeAllModals();
    document.getElementById('send-message-modal').style.display = 'flex';
  };

  /***********************************************************
   * SENDING FILES
   **********************************************************/
  const sendFilesModal = document.getElementById('send-files-modal');
  const sendFilesBackdrop = document.getElementById('send-files-backdrop');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const selectedFilesContainer = document.getElementById('selected-files-container');
  const sendFilesCancelBtn = document.getElementById('send-files-cancel');
  const startFileTransferBtn = document.getElementById('start-file-transfer');
  let selectedFiles = [];

  function cancelFileSending() {
    console.log('[send-files] user canceled');
    closeAllModals();
    server.send({ type: 'transfer-cancel', to: currentRecipientId });
    selectedFiles = [];
    renderSelectedFiles();
  }

  dropZone.onclick = () => fileInput.click();
  dropZone.ondragover = (e) => {
    e.preventDefault();
    dropZone.classList.add('bg-gray-100');
  };
  dropZone.ondragleave = (e) => {
    e.preventDefault();
    dropZone.classList.remove('bg-gray-100');
  };
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.classList.remove('bg-gray-100');
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  };
  fileInput.onchange = (e) => {
    handleFiles(e.target.files);
  };

  function handleFiles(files) {
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
    selectedFiles.forEach((file, idx) => {
      const div = document.createElement('div');
      div.className = 'selected-file-item';
      const span = document.createElement('span');
      span.className = 'selected-file-name';
      span.textContent = file.name;
      const trash = document.createElement('i');
      trash.className = 'fas fa-trash text-red-500 cursor-pointer';
      trash.onclick = () => {
        selectedFiles.splice(idx, 1);
        renderSelectedFiles();
      };
      div.appendChild(span);
      div.appendChild(trash);
      selectedFilesContainer.appendChild(div);
    });
  }

  sendFilesCancelBtn.onclick = cancelFileSending;
  sendFilesBackdrop.onclick = cancelFileSending;

  startFileTransferBtn.onclick = async () => {
    if (!currentRecipientId || !selectedFiles.length) return;
    console.log('[send-files] starting transfer to', currentRecipientId);
    closeAllModals();

    // We'll chunk the files over the datachannel
    const rtpw = peersMgr.ensureRTCPeer(currentRecipientId, true);

    // 0) send a "batch-header" so receiver knows how many files total
    const total = selectedFiles.length;
    rtpw.sendData(JSON.stringify({ type: 'batch-header', total }));

    // 1) For each file
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      console.log(`[SENDING FILE] #${i+1}/${total} => ${file.name}`);
      // a) send "header"
      await rtpw.sendData(
        JSON.stringify({
          type: 'header',
          name: file.name,
          size: file.size,
          mime: file.type
        })
      );

      // b) chunk
      const chunkSize = 65536;
      let offset = 0;
      while (offset < file.size) {
        // check data channel buffer
        const slice = file.slice(offset, offset + chunkSize);
        const buffer = await slice.arrayBuffer();
        offset += buffer.byteLength;
        console.log(
          `[CHUNK SENDING] file=${file.name} offset=${offset}/${file.size} size=${buffer.byteLength}`
        );
        await rtpw.sendData(buffer);
      }

      // c) done
      await rtpw.sendData(JSON.stringify({ type: 'done' }));
      console.log(`[SENDING FILE] done => ${file.name}`);
    }

    console.log('[send-files] all files done, showing success modal');
    selectedFiles = [];
    renderSelectedFiles();

    document.getElementById('transfer-complete-title').textContent = 'Transfer Complete';
    document.getElementById('transfer-complete-text').textContent =
      `Your file(s) have been delivered.`;
    document.getElementById('transfer-complete-modal').style.display = 'flex';
  };

  /***********************************************************
   * RECEIVING FILES
   **********************************************************/
  const receivingFilesModal = document.getElementById('receiving-files-modal');
  const fileProgressList = document.getElementById('file-progress-list');
  let incomingFileBatch = { total: 0, currentIndex: 0 };
  let incomingFileDigester = null;
  let receivedFiles = [];

  Evt.on('rtc-data', (e) => {
    const { data, fromId } = e.detail;
    if (typeof data !== 'string') {
      // Must be a chunk
      if (incomingFileDigester) {
        incomingFileDigester.chunks.push(data);
        incomingFileDigester.bytes += data.byteLength;
        console.log(
          `[CHUNK RECEIVED] file=${incomingFileDigester.name} chunkSize=${data.byteLength} totalReceived=${incomingFileDigester.bytes}/${incomingFileDigester.size}`
        );
        const pct = Math.floor((incomingFileDigester.bytes / incomingFileDigester.size) * 100);
        if (incomingFileDigester._bar) {
          incomingFileDigester._bar.style.width = pct + '%';
          incomingFileDigester._barLabel.textContent =
            `${pct}% (File ${incomingFileBatch.currentIndex}/${incomingFileBatch.total})`;
        }
      }
      return;
    }

    // It's a string => maybe JSON
    let obj;
    try {
      obj = JSON.parse(data);
    } catch {
      return;
    }

    if (obj.type === 'batch-header') {
      // total files
      incomingFileBatch.total = obj.total;
      incomingFileBatch.currentIndex = 0;
      console.log('[rtc-data] batch-header => total files =', obj.total);
      receivingFilesModal.style.display = 'flex';
      return;
    }

    if (obj.type === 'header') {
      incomingFileBatch.currentIndex++;
      console.log(`[RECEIVING] file #${incomingFileBatch.currentIndex}/${incomingFileBatch.total}: ${obj.name}`);
      closeAllModals();
      receivingFilesModal.style.display = 'flex';

      incomingFileDigester = {
        name: obj.name,
        size: obj.size,
        mime: obj.mime,
        chunks: [],
        bytes: 0,
        index: incomingFileBatch.currentIndex
      };
      // create progress bar
      const container = document.createElement('div');
      container.className = 'w-full mb-4';
      const label = document.createElement('p');
      label.className = 'text-sm mb-1 text-[#333533]';
      label.textContent = `${obj.name} (File ${incomingFileBatch.currentIndex}/${incomingFileBatch.total})`;

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
      incomingFileDigester._barLabel = label;

      // hide "receiving-status-modal"
      document.getElementById('receiving-status-modal').style.display = 'none';
    } else if (obj.type === 'done') {
      if (!incomingFileDigester) return;
      console.log('[RECEIVING] done =>', incomingFileDigester.name);
      const { name, mime, size, chunks } = incomingFileDigester;
      const blob = new Blob(chunks, { type: mime });
      receivedFiles.push({ name, blob });

      incomingFileDigester = null;

      // auto-open preview
      document.getElementById('file-preview-modal').style.display = 'flex';
      renderFilePreview(receivedFiles.length - 1);

      // signal "transfer-complete"
      server.send({
        type: 'transfer-complete',
        to: fromId
      });
    }
  });

  /***********************************************************
   * FILE PREVIEW
   **********************************************************/
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
  document.getElementById('prev-file-btn').onclick = () => {
    if (currentFileIndex > 0) {
      currentFileIndex--;
      renderFilePreview(currentFileIndex);
    }
  };
  document.getElementById('next-file-btn').onclick = () => {
    if (currentFileIndex < receivedFiles.length - 1) {
      currentFileIndex++;
      renderFilePreview(currentFileIndex);
    }
  };
  document.getElementById('file-preview-close').onclick = () => {
    filePreviewModal.style.display = 'none';
  };
  document.getElementById('file-preview-backdrop').onclick = () => {
    filePreviewModal.style.display = 'none';
  };

  // Download buttons
  document.getElementById('download-current-file').onclick = () => {
    if (!receivedFiles.length) return;
    const { name, blob } = receivedFiles[currentFileIndex];
    triggerDownload(name, blob);
  };
  document.getElementById('download-all-files').onclick = () => {
    receivedFiles.forEach((f) => triggerDownload(f.name, f.blob));
  };

  function triggerDownload(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /***********************************************************
   * TRANSFER COMPLETE
   **********************************************************/
  Evt.on('transfer-complete', (e) => {
    console.log('[transfer-complete] from remote => show success');
    document.getElementById('transfer-complete-title').textContent = 'Transfer Complete';
    document.getElementById('transfer-complete-text').textContent =
      'Your transfer is complete!';
    document.getElementById('transfer-complete-modal').style.display = 'flex';
  });
  document.getElementById('transfer-complete-close').onclick = () => {
    closeAllModals();
  };
  document.getElementById('transfer-complete-backdrop').onclick = () => {
    closeAllModals();
  };

  /***********************************************************
   * Peer Lost
   **********************************************************/
  document.getElementById('peer-lost-close').onclick = () => {
    closeAllModals();
  };
  document.getElementById('peer-lost-backdrop').onclick = () => {
    closeAllModals();
  };

  /***********************************************************
   * Server Disconnected
   **********************************************************/
  document.getElementById('server-disconnected-close').onclick = () => {
    closeAllModals();
  };

  /***********************************************************
   * Info & Author modals
   **********************************************************/
  document.getElementById('info-button').onclick = () => {
    closeAllModals();
    document.getElementById('info-modal').style.display = 'flex';
  };
  document.getElementById('info-modal-close').onclick = () => {
    document.getElementById('info-modal').style.display = 'none';
  };
  document.getElementById('info-modal-backdrop').onclick = () => {
    document.getElementById('info-modal').style.display = 'none';
  };

  document.getElementById('author-button').onclick = () => {
    closeAllModals();
    document.getElementById('author-modal').style.display = 'flex';
  };
  document.getElementById('author-modal-close').onclick = () => {
    document.getElementById('author-modal').style.display = 'none';
  };
  document.getElementById('author-modal-backdrop').onclick = () => {
    document.getElementById('author-modal').style.display = 'none';
  };
});

/***********************************************************
 * Helper to close all modals forcibly
 **********************************************************/
function closeAllModals() {
  const modals = [
    'choose-action-modal',
    'incoming-request-modal',
    'waiting-response-modal',
    'receiving-status-modal',
    'send-message-modal',
    'incoming-message-modal',
    'transfer-complete-modal',
    'peer-lost-modal',
    'send-files-modal',
    'receiving-files-modal',
    'file-preview-modal'
  ];
  for (const m of modals) {
    document.getElementById(m).style.display = 'none';
  }
}
