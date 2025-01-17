/*************************************************************
 * main.js
 * 1) Adds a "transfer-cancel" message for real-time cancel
 * 2) Closes modals if peer leaves or if server disconnects
 * 3) Ensures no overlapping modals
 *************************************************************/

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
      this.send({ type: 'introduce', name: { deviceType: this.deviceType } });
    };

    this.socket.onmessage = (message) => {
      const data = JSON.parse(message.data);
      this.handleMessage(data);
    };

    this.socket.onclose = () => {
      console.log('[ServerConnection] WebSocket closed');
      // Show "Server Disconnected" modal
      const serverModal = document.getElementById('server-disconnected-modal');
      if (serverModal) {
        serverModal.style.display = 'flex';
      }
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
      case 'transfer-cancel':
        window.dispatchEvent(new CustomEvent('transfer-cancel', { detail: msg }));
        break;
      case 'send-message':
        window.dispatchEvent(new CustomEvent('incoming-message', { detail: msg }));
        break;
      case 'transfer-complete':
        window.dispatchEvent(new CustomEvent('transfer-complete', { detail: msg }));
        break;
      case 'transfer-error':
        window.dispatchEvent(new CustomEvent('transfer-error', { detail: msg }));
        break;

      default:
        console.log('[ServerConnection] Unknown message type:', msg.type);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  let peers = {};
  let currentRecipientId = null;
  let currentRequesterId = null;
  let currentMode = null; // "files" or "message"
  const autoAcceptMap = {};

  const deviceType = detectDeviceType();
  const serverConnection = new ServerConnection(deviceType);

  // -- Grab references to modals/elements --
  const peerListElement = document.getElementById('peer-list');
  const noPeersMessage = document.getElementById('no-peers-message');

  const chooseActionModal = document.getElementById('choose-action-modal');
  const chooseActionBackdrop = document.getElementById('choose-action-backdrop');
  const chooseActionDeviceName = document.getElementById('choose-action-device-name');
  const chooseActionSendFilesBtn = document.getElementById('choose-action-send-files');
  const chooseActionSendMessageBtn = document.getElementById('choose-action-send-message');

  const incomingRequestModal = document.getElementById('incoming-request-modal');
  const incomingBackdrop = document.getElementById('incoming-request-backdrop');
  const incomingRequestText = document.getElementById('incoming-request-text');
  const incomingDeclineBtn = document.getElementById('incoming-decline-button');
  const incomingAcceptBtn = document.getElementById('incoming-accept-button');
  const alwaysAcceptCheckbox = document.getElementById('always-accept-checkbox');

  const waitingResponseModal = document.getElementById('waiting-response-modal');
  const waitingResponseBackdrop = document.getElementById('waiting-response-backdrop');
  const waitingResponseText = document.getElementById('waiting-response-text');
  const waitingCancelBtn = document.getElementById('waiting-cancel-button');

  const receivingStatusModal = document.getElementById('receiving-status-modal');
  const receivingStatusBackdrop = document.getElementById('receiving-status-backdrop');
  const receivingStatusText = document.getElementById('receiving-status-text');

  const sendMessageModal = document.getElementById('send-message-modal');
  const sendMessageBackdrop = document.getElementById('send-message-backdrop');
  const sendMessageCancel = document.getElementById('send-message-cancel');
  const sendMessageBtn = document.getElementById('send-message-button');
  const messageInput = document.getElementById('message-input');

  const incomingMessageModal = document.getElementById('incoming-message-modal');
  const incomingMessageBackdrop = document.getElementById('incoming-message-backdrop');
  const incomingMessageHeader = document.getElementById('incoming-message-header');
  const incomingMessageText = document.getElementById('incoming-message-text');
  const incomingMessageClose = document.getElementById('incoming-message-close');
  const incomingMessageRespond = document.getElementById('incoming-message-respond');

  const transferCompleteModal = document.getElementById('transfer-complete-modal');
  const transferCompleteBackdrop = document.getElementById('transfer-complete-backdrop');
  const transferCompleteTitle = document.getElementById('transfer-complete-title');
  const transferCompleteText = document.getElementById('transfer-complete-text');
  const transferCompleteClose = document.getElementById('transfer-complete-close');

  const peerLostModal = document.getElementById('peer-lost-modal');
  const peerLostBackdrop = document.getElementById('peer-lost-backdrop');
  const peerLostClose = document.getElementById('peer-lost-close');

  const serverDisconnectedModal = document.getElementById('server-disconnected-modal');
  const serverDisconnectedClose = document.getElementById('server-disconnected-close');

  // Info & Author modals
  const infoButton = document.getElementById('info-button');
  const authorButton = document.getElementById('author-button');
  const infoModal = document.getElementById('info-modal');
  const infoModalClose = document.getElementById('info-modal-close');
  const infoModalBackdrop = document.getElementById('info-modal-backdrop');
  const authorModal = document.getElementById('author-modal');
  const authorModalClose = document.getElementById('author-modal-close');
  const authorModalBackdrop = document.getElementById('author-modal-backdrop');

  // --- Utility to close all modals if needed ---
  function closeAllModals() {
    [
      chooseActionModal, 
      incomingRequestModal, 
      waitingResponseModal, 
      receivingStatusModal, 
      sendMessageModal, 
      incomingMessageModal, 
      transferCompleteModal
    ].forEach(m => m.style.display = 'none');
  }

  // --- Update Peer List ---
  function updatePeerList() {
    peerListElement.innerHTML = '';
    const peerIds = Object.keys(peers);

    if (peerIds.length === 0) {
      noPeersMessage.style.display = 'block';
    } else {
      noPeersMessage.style.display = 'none';
      peerIds.forEach(pid => {
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
          currentRecipientId = peer.id;
          chooseActionDeviceName.textContent = `Send to ${peer.name.displayName}`;
          chooseActionModal.style.display = 'flex';
        });

        peerListElement.appendChild(btn);
      });
    }
  }

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
  window.addEventListener('peers', e => {
    peers = {};
    e.detail.forEach(p => {
      if (p.id !== serverConnection.id) {
        peers[p.id] = p;
      }
    });
    updatePeerList();
  });

  window.addEventListener('peer-joined', e => {
    const newPeer = e.detail;
    if (newPeer.id !== serverConnection.id) {
      peers[newPeer.id] = newPeer;
      updatePeerList();
    }
  });

  window.addEventListener('peer-left', e => {
    const peerId = e.detail;
    if (peers[peerId]) {
      delete peers[peerId];
      updatePeerList();
    }
    // If we are in the middle of a flow with that peer, close everything and show "Peer Lost"
    if (peerId === currentRecipientId || peerId === currentRequesterId) {
      closeAllModals();
      peerLostModal.style.display = 'flex';
      currentRecipientId = null;
      currentRequesterId = null;
      currentMode = null;
    }
  });

  window.addEventListener('peer-updated', e => {
    const updatedPeer = e.detail;
    peers[updatedPeer.id] = updatedPeer;
    updatePeerList();
  });

  /***********************************************************
   * TRANSFER FLOW
   **********************************************************/
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

  // On receiving side
  window.addEventListener('transfer-request', e => {
    const msg = e.detail;
    const fromName = msg.fromDisplayName || 'Unknown';
    currentRequesterId = msg.sender;
    currentMode = msg.mode;

    // If we already have a flow, let's close out everything
    closeAllModals();

    if (autoAcceptMap[currentRequesterId]) {
      // auto-accept
      serverConnection.send({
        type: 'transfer-accept',
        to: currentRequesterId,
        mode: currentMode
      });
      showReceivingStatus(fromName, currentMode);
      return;
    }

    incomingRequestText.textContent = `${fromName} wants to send ${
      currentMode === 'files' ? 'files' : 'a message'
    }.`;
    incomingRequestModal.style.display = 'flex';
    alwaysAcceptCheckbox.checked = false;
  });

  // On the receiving side => user clicks decline
  incomingDeclineBtn.addEventListener('click', () => {
    if (currentRequesterId) {
      serverConnection.send({ type: 'transfer-decline', to: currentRequesterId });
    }
    incomingRequestModal.style.display = 'none';
    currentRequesterId = null;
    currentMode = null;
  });

  // On the receiving side => user clicks accept
  incomingAcceptBtn.addEventListener('click', () => {
    if (currentRequesterId) {
      if (alwaysAcceptCheckbox.checked) {
        autoAcceptMap[currentRequesterId] = true;
      }
      serverConnection.send({ type: 'transfer-accept', to: currentRequesterId, mode: currentMode });

      const fromName = peers[currentRequesterId]?.name?.displayName || 'Unknown';
      showReceivingStatus(fromName, currentMode);
    }
    incomingRequestModal.style.display = 'none';
    currentRequesterId = null;
  });

  // On the sender side => sees accept
  window.addEventListener('transfer-accept', e => {
    const msg = e.detail;
    waitingResponseModal.style.display = 'none';
    if (msg.mode === 'files') {
      alert('They accepted file transfer! (Not implemented yet.)');
    } else if (msg.mode === 'message') {
      sendMessageModal.style.display = 'flex';
    }
  });

  // On the sender side => sees decline
  window.addEventListener('transfer-decline', e => {
    waitingResponseModal.style.display = 'none';
    alert('They declined the transfer.');
    currentRecipientId = null;
    currentMode = null;
  });

  // On either side => sees "transfer-cancel"
  window.addEventListener('transfer-cancel', e => {
    const msg = e.detail;
    // If the other side canceled, we close any "waiting" or "receiving" modals
    closeAllModals();
    // Optionally show a small message or alert
    alert('The other device canceled the transfer.');
    currentRecipientId = null;
    currentRequesterId = null;
    currentMode = null;
  });

  // CANCEL FROM SENDER => send "transfer-cancel" to the peer
  function cancelSenderFlow() {
    if (currentRecipientId) {
      serverConnection.send({ type: 'transfer-cancel', to: currentRecipientId });
    }
    closeAllModals();
    currentRecipientId = null;
    currentMode = null;
  }

  // CANCEL FROM RECEIVER => we could do similarly if the receiver changes its mind mid-flow

  /***********************************************************
   * "Receiving Status" (Receiver side)
   **********************************************************/
  function showReceivingStatus(senderName, mode) {
    receivingStatusText.textContent = `Waiting for ${senderName} to send ${
      mode === 'files' ? 'files' : 'a message'
    }...`;
    receivingStatusModal.style.display = 'flex';
  }
  function hideReceivingStatus() {
    receivingStatusModal.style.display = 'none';
  }

  /***********************************************************
   * SEND MESSAGE FLOW (sender side)
   **********************************************************/
  sendMessageBtn.addEventListener('click', () => {
    if (!currentRecipientId) return;
    const text = messageInput.value.trim();
    if (!text) {
      // No text => optional: do nothing or auto-cancel
      return;
    }
    serverConnection.send({
      type: 'send-message',
      to: currentRecipientId,
      text,
      fromName: serverConnection.displayName
    });
    sendMessageModal.style.display = 'none';
    messageInput.value = '';
    // We remain in a state until the receiver acknowledges
    // but we do not strictly need to wait. We'll just let them respond with "transfer-complete"
  });

  sendMessageCancel.addEventListener('click', () => {
    // CANCEL => tell the receiver
    cancelSenderFlow();
    messageInput.value = '';
  });

  /***********************************************************
   * INCOMING MESSAGE (receiver side)
   **********************************************************/
  window.addEventListener('incoming-message', e => {
    hideReceivingStatus();

    const msg = e.detail;
    const fromName = msg.fromName || 'Unknown';
    incomingMessageHeader.textContent = `Message from ${fromName}`;
    incomingMessageText.textContent = msg.text || '';
    currentRequesterId = msg.sender;
    incomingMessageModal.style.display = 'flex';

    // Acknowledge => "transfer-complete"
    serverConnection.send({
      type: 'transfer-complete',
      to: msg.sender,
      status: 'ok',
      fromName: serverConnection.displayName
    });
  });

  incomingMessageClose.addEventListener('click', () => {
    incomingMessageModal.style.display = 'none';
    currentRequesterId = null;
  });

  incomingMessageRespond.addEventListener('click', () => {
    currentRecipientId = currentRequesterId;
    currentRequesterId = null;
    incomingMessageModal.style.display = 'none';
    sendMessageModal.style.display = 'flex';
  });

  /***********************************************************
   * TRANSFER COMPLETE (sender side)
   **********************************************************/
  window.addEventListener('transfer-complete', e => {
    const msg = e.detail;
    transferCompleteTitle.textContent = 'Transfer Complete';
    const fromName = msg.fromName || 'the receiver';
    transferCompleteText.textContent = `Your message has been delivered to ${fromName}.`;
    transferCompleteModal.style.display = 'flex';
  });

  window.addEventListener('transfer-error', e => {
    const msg = e.detail;
    transferCompleteTitle.textContent = 'Transfer Error';
    const fromName = msg.fromName || 'the receiver';
    transferCompleteText.textContent = `There was an error sending to ${fromName}. Please try again.`;
    transferCompleteModal.style.display = 'flex';
  });

  /***********************************************************
   * CANCEL FROM WAITING / SENDER
   **********************************************************/
  waitingResponseBackdrop.addEventListener('click', () => {
    cancelSenderFlow();
  });
  waitingCancelBtn.addEventListener('click', () => {
    cancelSenderFlow();
  });

  /***********************************************************
   * CHOOSE ACTION MODAL
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
   * BACKDROP CLICKS & CANCELS
   **********************************************************/
  // Incoming request backdrop => decline
  incomingBackdrop.addEventListener('click', () => {
    // For usability, let's do the same as clicking Decline
    if (currentRequesterId) {
      serverConnection.send({ type: 'transfer-decline', to: currentRequesterId });
    }
    incomingRequestModal.style.display = 'none';
    currentRequesterId = null;
    currentMode = null;
  });

  // Receiving status backdrop => optional
  receivingStatusBackdrop.addEventListener('click', () => {
    // Could do a receiver-side cancel if you want
    // e.g. "transfer-cancel" => sender
  });

  // If the user closes the send-message backdrop => also send a cancel
  sendMessageBackdrop.addEventListener('click', () => {
    cancelSenderFlow();
    messageInput.value = '';
  });

  // Incoming message backdrop => just close
  incomingMessageBackdrop.addEventListener('click', () => {
    incomingMessageModal.style.display = 'none';
  });

  // Transfer complete backdrop => close
  transferCompleteBackdrop.addEventListener('click', () => {
    transferCompleteModal.style.display = 'none';
  });
  transferCompleteClose.addEventListener('click', () => {
    transferCompleteModal.style.display = 'none';
  });

  // Peer lost
  peerLostBackdrop.addEventListener('click', () => {
    peerLostModal.style.display = 'none';
  });
  peerLostClose.addEventListener('click', () => {
    peerLostModal.style.display = 'none';
  });

  // Server disconnected
  serverDisconnectedClose.addEventListener('click', () => {
    serverDisconnectedModal.style.display = 'none';
  });

  /***********************************************************
   * Info & Author Modals
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
