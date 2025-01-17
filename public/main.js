/*************************************************************
 * main.js
 * Implements:
 *  - Discovery and display of peers
 *  - "Choose Action" (Send Files or Send Message)
 *  - Request/Accept/Decline flow with "Always Accept" option
 *  - Send Message + Incoming Message modals
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
       * Additional Transfer & Messaging
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

  // Modals
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

  // Info & Author modals references
  const infoButton = document.getElementById('info-button');
  const authorButton = document.getElementById('author-button');
  const infoModal = document.getElementById('info-modal');
  const authorModal = document.getElementById('author-modal');
  const infoModalClose = document.getElementById('info-modal-close');
  const infoModalBackdrop = document.getElementById('info-modal-backdrop');
  const authorModalClose = document.getElementById('author-modal-close');
  const authorModalBackdrop = document.getElementById('author-modal-backdrop');

  // We'll store the ID of the "active peer" we are interacting with
  let currentRecipientId = null;
  let currentRequesterId = null;

  // We'll store the mode for the current transfer ("files" or "message")
  let currentMode = null;

  // A map to store "always accept" decisions for this session: { peerId: true/false }
  const autoAcceptMap = {};

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

        // Click => show "choose action" modal
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
  // 1) SENDER triggers "transfer-request" with a chosen mode
  function sendTransferRequest(mode) {
    if (!currentRecipientId) return;
    currentMode = mode;
    // Show "waiting" modal
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

  // 2) RECEIVER sees "transfer-request" event
  window.addEventListener('transfer-request', (e) => {
    const msg = e.detail;
    console.log('[transfer-request] Received from', msg.sender, 'mode=', msg.mode);

    currentRequesterId = msg.sender;
    currentMode = msg.mode; // "files" or "message"
    const fromName = msg.fromDisplayName || 'Unknown';

    // If we have autoAccept for this sender, skip the request
    if (autoAcceptMap[currentRequesterId]) {
      // Immediately accept
      serverConnection.send({
        type: 'transfer-accept',
        to: currentRequesterId,
        mode: currentMode
      });
      // If mode is "files", do nothing special right now
      // If mode is "message", we wait for them to send the actual message
      return;
    }

    // Otherwise, show the incoming request modal
    incomingRequestText.textContent = `${fromName} wants to send ${currentMode === 'files' ? 'files' : 'a message'}.`;
    incomingRequestModal.style.display = 'flex';
    alwaysAcceptCheckbox.checked = false;
  });

  // 3) ACCEPT or DECLINE
  // Incoming side => Decline
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

  // Incoming side => Accept
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
    }
    incomingRequestModal.style.display = 'none';

    // If it's "files", we basically wait for them to send files (not fully implemented)
    // If it's "message", we also wait for them to send the actual text
    currentRequesterId = null;
  });

  // 4) SENDER sees "transfer-accept" or "transfer-decline"
  window.addEventListener('transfer-accept', (e) => {
    const msg = e.detail;
    console.log('[transfer-accept] from', msg.sender, 'mode=', msg.mode);

    // The other side accepted, hide waiting modal
    waitingResponseModal.style.display = 'none';

    if (msg.mode === 'files') {
      alert('They accepted file transfer! (Not implemented yet.)');
    } else if (msg.mode === 'message') {
      // Show the "send message" modal
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
   * "Send Message" flow
   **********************************************************/
  // Once the receiving side accepted with mode="message", the SENDER sees the "send-message-modal".
  // SENDER types a message => send "send-message" to the receiver.
  sendMessageBtn.addEventListener('click', () => {
    if (!currentRecipientId) return;
    const text = messageInput.value.trim();
    if (!text) return;

    // Send the message to the other peer
    serverConnection.send({
      type: 'send-message',
      to: currentRecipientId,
      text,
      fromName: serverConnection.displayName
    });

    // Close the modal
    sendMessageModal.style.display = 'none';
    messageInput.value = '';
    currentRecipientId = null;
    currentMode = null;
  });

  // Cancel sending the message
  sendMessageCancel.addEventListener('click', () => {
    sendMessageModal.style.display = 'none';
    messageInput.value = '';
    currentRecipientId = null;
    currentMode = null;
  });

  // 5) RECEIVER sees "incoming-message"
  window.addEventListener('incoming-message', (e) => {
    const msg = e.detail;
    console.log('[incoming-message] from', msg.sender, 'text=', msg.text);

    const fromName = msg.fromName || 'Unknown';
    incomingMessageHeader.textContent = `Message from ${fromName}`;
    incomingMessageText.textContent = msg.text || '';
    // Store the sender in a var so we can respond back
    currentRequesterId = msg.sender;
    incomingMessageModal.style.display = 'flex';
  });

  // Close the incoming message
  incomingMessageClose.addEventListener('click', () => {
    incomingMessageModal.style.display = 'none';
    currentRequesterId = null;
  });

  // "Respond Back" => Show the "send-message-modal" again in reverse
  incomingMessageRespond.addEventListener('click', () => {
    // We'll send a message back to whoever just wrote us
    if (!currentRequesterId) return;
    currentRecipientId = currentRequesterId;
    currentRequesterId = null;

    // Hide the incoming message so user can type
    incomingMessageModal.style.display = 'none';
    sendMessageModal.style.display = 'flex';
  });

  /***********************************************************
   * CHOOSE ACTION MODAL: "Send Files" or "Send Message"
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
   * WAITING / CANCEL 
   **********************************************************/
  waitingResponseBackdrop.addEventListener('click', () => {
    waitingResponseModal.style.display = 'none';
    if (currentRecipientId) {
      // Cancel
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

  // Incoming request backdrop => close
  incomingBackdrop.addEventListener('click', () => {
    incomingRequestModal.style.display = 'none';
  });

  // Send message backdrop => close
  sendMessageBackdrop.addEventListener('click', () => {
    sendMessageModal.style.display = 'none';
    currentRecipientId = null;
    currentMode = null;
  });

  // Incoming message backdrop => close
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
