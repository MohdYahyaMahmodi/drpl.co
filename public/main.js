/*************************************************************
 * main.js
 * Enhanced:
 *  - "receiving-status-modal": shows "Waiting for XXX..." 
 *    on the receiver side after Accept
 *  - Once the sender actually sends a message, we hide 
 *    the receiving-status-modal and show the incoming message.
 *************************************************************/

/** 
 * detectDeviceType: Tells the server what type of device we are
 */
function detectDeviceType() {
  const userAgent = navigator.userAgent.toLowerCase();
  if (/(iphone|ipod|android.*mobile|webos|blackberry)/.test(userAgent)) {
    return 'mobile';
  } else if (/(ipad|android(?!.*mobile))/.test(userAgent)) {
    return 'tablet';
  } else if (/(macintosh|windows|linux)/.test(userAgent)) {
    return window.innerWidth <= 1366 ? 'laptop' : 'desktop';
  }
  return 'desktop'; 
}

class ServerConnection {
  constructor(deviceType) {
    console.log('[ServerConnection] constructor with deviceType:', deviceType);
    this.id = null;
    this.socket = null;
    this.deviceType = deviceType;
    this.displayName = '';
    this.connect();
  }

  connect() {
    const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const endpoint = protocol + location.host;
    console.log('[ServerConnection] Attempting to connect:', endpoint);

    this.socket = new WebSocket(endpoint);

    this.socket.onopen = () => {
      console.log('[ServerConnection] WebSocket open');
      this.send({
        type: 'introduce',
        name: { deviceType: this.deviceType }
      });
    };

    this.socket.onmessage = (message) => {
      const data = JSON.parse(message.data);
      this.handleMessage(data);
    };

    this.socket.onclose = () => {
      console.log('[ServerConnection] WebSocket closed; reconnect in 3s');
      setTimeout(() => this.connect(), 3000);
    };

    this.socket.onerror = (err) => {
      console.error('[ServerConnection] WebSocket error:', err);
    };
  }

  send(msg) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  handleMessage(msg) {
    console.log('[ServerConnection] Received message:', msg);

    switch (msg.type) {
      case 'display-name': {
        this.id = msg.message.peerId;
        this.displayName = msg.message.displayName;
        const deviceNameElem = document.getElementById('device-name');
        if (deviceNameElem) deviceNameElem.textContent = this.displayName;
        break;
      }
      case 'peers':
        window.dispatchEvent(new CustomEvent('peers', { detail: msg.peers }));
        break;
      case 'peer-joined':
        window.dispatchEvent(new CustomEvent('peer-joined', { detail: msg.peer }));
        break;
      case 'peer-left':
        window.dispatchEvent(new CustomEvent('peer-left', { detail: msg.peerId }));
        break;
      case 'peer-updated':
        window.dispatchEvent(new CustomEvent('peer-updated', { detail: msg.peer }));
        break;
      case 'ping':
        this.send({ type: 'pong' });
        break;

      /************************************************
       * Transfer & Messaging
       ************************************************/
      case 'transfer-request':
        window.dispatchEvent(new CustomEvent('transfer-request', { detail: msg }));
        break;
      case 'transfer-accept':
        window.dispatchEvent(new CustomEvent('transfer-accept', { detail: msg }));
        break;
      case 'transfer-decline':
        window.dispatchEvent(new CustomEvent('transfer-decline', { detail: msg }));
        break;
      case 'send-message':
        // A message is being delivered
        window.dispatchEvent(new CustomEvent('incoming-message', { detail: msg }));
        break;
      
      default:
        console.log('[ServerConnection] Unknown message type:', msg.type);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('[main.js] DOMContentLoaded');
  let peers = {};

  // Create server connection
  const deviceType = detectDeviceType();
  const serverConnection = new ServerConnection(deviceType);

  // Peer list references
  const peerListElement = document.getElementById('peer-list');
  const noPeersMessage = document.getElementById('no-peers-message');

  // Choose Action Modal
  const chooseActionModal = document.getElementById('choose-action-modal');
  const chooseActionBackdrop = document.getElementById('choose-action-backdrop');
  const chooseActionDeviceName = document.getElementById('choose-action-device-name');
  const chooseActionSendFilesBtn = document.getElementById('choose-action-send-files');
  const chooseActionSendMessageBtn = document.getElementById('choose-action-send-message');

  // Incoming Request Modal
  const incomingRequestModal = document.getElementById('incoming-request-modal');
  const incomingBackdrop = document.getElementById('incoming-request-backdrop');
  const incomingRequestText = document.getElementById('incoming-request-text');
  const incomingDeclineBtn = document.getElementById('incoming-decline-button');
  const incomingAcceptBtn = document.getElementById('incoming-accept-button');
  const alwaysAcceptCheckbox = document.getElementById('always-accept-checkbox');

  // Waiting for Response Modal (sender side)
  const waitingResponseModal = document.getElementById('waiting-response-modal');
  const waitingResponseBackdrop = document.getElementById('waiting-response-backdrop');
  const waitingResponseText = document.getElementById('waiting-response-text');
  const waitingCancelBtn = document.getElementById('waiting-cancel-button');

  // Receiving Status Modal (receiver side)
  const receivingStatusModal = document.getElementById('receiving-status-modal');
  const receivingStatusBackdrop = document.getElementById('receiving-status-backdrop');
  const receivingStatusText = document.getElementById('receiving-status-text');

  // Send Message Modal (sender side)
  const sendMessageModal = document.getElementById('send-message-modal');
  const sendMessageBackdrop = document.getElementById('send-message-backdrop');
  const sendMessageCancel = document.getElementById('send-message-cancel');
  const sendMessageBtn = document.getElementById('send-message-button');
  const messageInput = document.getElementById('message-input');

  // Incoming Message Modal (receiver side)
  const incomingMessageModal = document.getElementById('incoming-message-modal');
  const incomingMessageBackdrop = document.getElementById('incoming-message-backdrop');
  const incomingMessageHeader = document.getElementById('incoming-message-header');
  const incomingMessageText = document.getElementById('incoming-message-text');
  const incomingMessageClose = document.getElementById('incoming-message-close');
  const incomingMessageRespond = document.getElementById('incoming-message-respond');

  // Info & Author Modals
  const infoButton = document.getElementById('info-button');
  const authorButton = document.getElementById('author-button');
  const infoModal = document.getElementById('info-modal');
  const infoModalClose = document.getElementById('info-modal-close');
  const infoModalBackdrop = document.getElementById('info-modal-backdrop');
  const authorModal = document.getElementById('author-modal');
  const authorModalClose = document.getElementById('author-modal-close');
  const authorModalBackdrop = document.getElementById('author-modal-backdrop');

  // Tracking variables
  let currentRecipientId = null;
  let currentRequesterId = null;
  let currentMode = null; // "files" or "message"
  const autoAcceptMap = {}; // { peerId: true/false }

  /***********************************************************
   * Update Peer List
   **********************************************************/
  function updatePeerList() {
    peerListElement.innerHTML = '';
    const peerIds = Object.keys(peers);

    if (peerIds.length === 0) {
      noPeersMessage.style.display = 'block';
    } else {
      noPeersMessage.style.display = 'none';
      peerIds.forEach((pid) => {
        const peer = peers[pid];
        const btn = document.createElement('button');
        btn.className = 'peer-button w-full py-[15px] text-xl bg-[#333533] text-white rounded-lg hover:bg-[#242423] transition-colors';

        const iconEl = document.createElement('i');
        iconEl.classList.add('fas', getDeviceIcon(peer.name.type), 'peer-device-icon', 'text-white');
        const textSpan = document.createElement('span');
        textSpan.textContent = peer.name.displayName;

        btn.appendChild(iconEl);
        btn.appendChild(textSpan);

        btn.addEventListener('click', () => {
          console.log('[UI] clicked peer => open Choose Action modal for:', peer.name.displayName);
          currentRecipientId = peer.id;
          chooseActionDeviceName.textContent = `Send to ${peer.name.displayName}`;
          chooseActionModal.style.display = 'flex';
        });

        peerListElement.appendChild(btn);
      });
    }
  }

  // Icon helper
  function getDeviceIcon(type) {
    switch (type) {
      case 'mobile':  return 'fa-mobile-alt';
      case 'tablet':  return 'fa-tablet-alt';
      case 'laptop':  
      case 'desktop': return 'fa-desktop';
      default:        return 'fa-question-circle';
    }
  }

  /***********************************************************
   * SERVER EVENT HANDLERS
   **********************************************************/
  window.addEventListener('peers', (e) => {
    peers = {};
    e.detail.forEach((p) => {
      if (p.id !== serverConnection.id) {
        peers[p.id] = p;
      }
    });
    updatePeerList();
  });

  window.addEventListener('peer-joined', (e) => {
    const newPeer = e.detail;
    if (newPeer.id !== serverConnection.id) {
      peers[newPeer.id] = newPeer;
      updatePeerList();
    }
  });

  window.addEventListener('peer-left', (e) => {
    const peerId = e.detail;
    if (peers[peerId]) {
      delete peers[peerId];
      updatePeerList();
    }
  });

  window.addEventListener('peer-updated', (e) => {
    const updatedPeer = e.detail;
    peers[updatedPeer.id] = updatedPeer;
    updatePeerList();
  });

  /***********************************************************
   * Transfer Request Flow
   **********************************************************/
  // SENDER => initiate request
  function sendTransferRequest(mode) {
    if (!currentRecipientId) return;
    currentMode = mode;

    const peerName = peers[currentRecipientId]?.name?.displayName || 'Unknown';
    waitingResponseText.textContent = `Waiting for ${peerName} to accept...`;
    waitingResponseModal.style.display = 'flex';

    serverConnection.send({
      type: 'transfer-request',
      to: currentRecipientId,
      fromDisplayName: serverConnection.displayName,
      mode
    });
  }

  // RECEIVER => handle incoming request
  window.addEventListener('transfer-request', (e) => {
    const msg = e.detail;
    console.log('[transfer-request] from', msg.sender, 'mode=', msg.mode);

    currentRequesterId = msg.sender;
    currentMode = msg.mode; 
    const fromName = msg.fromDisplayName || 'Unknown';

    if (autoAcceptMap[currentRequesterId]) {
      // auto-accept
      serverConnection.send({
        type: 'transfer-accept',
        to: currentRequesterId,
        mode: currentMode
      });
      // Show receiving-status-modal right away
      showReceivingStatus(fromName, currentMode);
      return;
    }

    // Otherwise, show the incoming-request-modal
    incomingRequestText.textContent = `${fromName} wants to send ${currentMode === 'files' ? 'files' : 'a message'}.`;
    incomingRequestModal.style.display = 'flex';
    alwaysAcceptCheckbox.checked = false;
  });

  // RECEIVER => Accept or Decline
  incomingDeclineBtn.addEventListener('click', () => {
    if (currentRequesterId) {
      serverConnection.send({
        type: 'transfer-decline',
        to: currentRequesterId
      });
    }
    incomingRequestModal.style.display = 'none';
    currentRequesterId = null;
    currentMode = null;
  });

  incomingAcceptBtn.addEventListener('click', () => {
    if (currentRequesterId) {
      if (alwaysAcceptCheckbox.checked) {
        autoAcceptMap[currentRequesterId] = true;
      }
      serverConnection.send({
        type: 'transfer-accept',
        to: currentRequesterId,
        mode: currentMode
      });

      // Show "receiving-status-modal" to indicate we are waiting
      const fromName = peers[currentRequesterId]?.name?.displayName || 'Unknown';
      showReceivingStatus(fromName, currentMode);
    }
    incomingRequestModal.style.display = 'none';
    // We'll remain in receivingStatusModal until the actual message (or file) arrives
    currentRequesterId = null;
  });

  // SENDER => sees accept or decline
  window.addEventListener('transfer-accept', (e) => {
    const msg = e.detail;
    console.log('[transfer-accept] from', msg.sender, 'mode=', msg.mode);

    waitingResponseModal.style.display = 'none';

    if (msg.mode === 'files') {
      alert('They accepted file transfer! (Not implemented yet.)');
      // or show your own "Send files" UI.
    } else if (msg.mode === 'message') {
      // Show send-message-modal
      sendMessageModal.style.display = 'flex';
    }
  });

  window.addEventListener('transfer-decline', (e) => {
    const msg = e.detail;
    console.log('[transfer-decline] from', msg.sender);
    waitingResponseModal.style.display = 'none';
    alert('They declined the transfer.');
    currentRecipientId = null;
    currentMode = null;
  });

  /***********************************************************
   * Receiving Status Modal
   **********************************************************/
  function showReceivingStatus(senderName, mode) {
    let typeLabel = (mode === 'files') ? 'files' : 'a message';
    receivingStatusText.textContent = `Waiting for ${senderName} to send ${typeLabel}...`;
    receivingStatusModal.style.display = 'flex';
  }
  function hideReceivingStatus() {
    receivingStatusModal.style.display = 'none';
  }

  receivingStatusBackdrop.addEventListener('click', () => {
    // If you want, you could hide or have a "Cancel Receiving" button. 
    // For now, we just keep the user in this state until something arrives.
  });

  /***********************************************************
   * "Send Message" flow (SENDER side)
   **********************************************************/
  sendMessageBtn.addEventListener('click', () => {
    if (!currentRecipientId) return;
    const text = messageInput.value.trim();
    if (!text) return;

    serverConnection.send({
      type: 'send-message',
      to: currentRecipientId,
      text,
      fromName: serverConnection.displayName
    });

    sendMessageModal.style.display = 'none';
    messageInput.value = '';
    currentRecipientId = null;
    currentMode = null;
  });

  sendMessageCancel.addEventListener('click', () => {
    sendMessageModal.style.display = 'none';
    messageInput.value = '';
    currentRecipientId = null;
    currentMode = null;
  });

  // RECEIVER => sees "incoming-message"
  window.addEventListener('incoming-message', (e) => {
    const msg = e.detail;
    console.log('[incoming-message] from', msg.sender, 'text=', msg.text);
    
    // Hide the receiving-status-modal if it's open
    hideReceivingStatus();

    const fromName = msg.fromName || 'Unknown';
    incomingMessageHeader.textContent = `Message from ${fromName}`;
    incomingMessageText.textContent = msg.text || '';
    currentRequesterId = msg.sender; // store so we can respond

    incomingMessageModal.style.display = 'flex';
  });

  // "Close" or "Respond Back"
  incomingMessageClose.addEventListener('click', () => {
    incomingMessageModal.style.display = 'none';
    currentRequesterId = null;
  });
  incomingMessageRespond.addEventListener('click', () => {
    // We'll respond back to the same peer
    currentRecipientId = currentRequesterId;
    currentRequesterId = null;

    incomingMessageModal.style.display = 'none';
    sendMessageModal.style.display = 'flex';
  });

  /***********************************************************
   * Choose Action Modal
   **********************************************************/
  chooseActionSendFilesBtn.addEventListener('click', () => {
    chooseActionModal.style.display = 'none';
    sendTransferRequest('files');
  });
  chooseActionSendMessageBtn.addEventListener('click', () => {
    chooseActionModal.style.display = 'none';
    sendTransferRequest('message');
  });
  chooseActionBackdrop.addEventListener('click', () => {
    chooseActionModal.style.display = 'none';
  });

  /***********************************************************
   * Waiting / Cancel
   **********************************************************/
  waitingResponseBackdrop.addEventListener('click', () => {
    waitingResponseModal.style.display = 'none';
    if (currentRecipientId) {
      // Cancel from sender side
      serverConnection.send({
        type: 'transfer-decline',
        to: currentRecipientId
      });
      currentRecipientId = null;
      currentMode = null;
    }
  });
  waitingCancelBtn.addEventListener('click', () => {
    waitingResponseModal.style.display = 'none';
    if (currentRecipientId) {
      serverConnection.send({
        type: 'transfer-decline',
        to: currentRecipientId
      });
      currentRecipientId = null;
      currentMode = null;
    }
  });

  incomingBackdrop.addEventListener('click', () => {
    incomingRequestModal.style.display = 'none';
  });

  sendMessageBackdrop.addEventListener('click', () => {
    sendMessageModal.style.display = 'none';
    currentRecipientId = null;
    currentMode = null;
  });

  incomingMessageBackdrop.addEventListener('click', () => {
    incomingMessageModal.style.display = 'none';
    currentRequesterId = null;
  });

  /***********************************************************
   * Info & Author modals
   **********************************************************/
  infoButton.addEventListener('click', () => {
    infoModal.style.display = 'flex';
  });
  infoModalClose.addEventListener('click', () => {
    infoModal.style.display = 'none';
  });
  infoModalBackdrop.addEventListener('click', () => {
    infoModal.style.display = 'none';
  });

  authorButton.addEventListener('click', () => {
    authorModal.style.display = 'flex';
  });
  authorModalClose.addEventListener('click', () => {
    authorModal.style.display = 'none';
  });
  authorModalBackdrop.addEventListener('click', () => {
    authorModal.style.display = 'none';
  });
});
