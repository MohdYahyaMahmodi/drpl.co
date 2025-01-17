/*************************************************************
 * main.js:
 * 1) When you click a peer => show "Choose Action" (Send Files/Message)
 * 2) If "Send Message": we check if that peer is trusted by the receiver
 *    - If not, receiver sees incoming request + "Always accept" checkbox
 *    - If accepted, sender sees Compose Message modal
 *    - Sender sends the message => receiver sees a Received Message modal
 *    - Receiver can respond => sender sees Received Message modal, etc.
 *************************************************************/

/** 
 * detectDeviceType
 */
function detectDeviceType() {
  const ua = navigator.userAgent.toLowerCase();
  if (/(iphone|ipod|android.*mobile|webos|blackberry)/.test(ua)) {
    return 'mobile';
  } else if (/(ipad|android(?!.*mobile))/.test(ua)) {
    return 'tablet';
  } else if (/(macintosh|windows|linux)/.test(ua)) {
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
    this.socket = new WebSocket(endpoint);

    this.socket.onopen = () => {
      this.send({ type: 'introduce', name: { deviceType: this.deviceType } });
    };

    this.socket.onmessage = (message) => {
      const data = JSON.parse(message.data);
      this.handleMessage(data);
    };

    this.socket.onclose = () => {
      setTimeout(() => this.connect(), 3000);
    };

    this.socket.onerror = (err) => {
      console.error('[ServerConnection] error:', err);
    };
  }

  send(msg) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'display-name':
        this.id = msg.message.peerId;
        this.displayName = msg.message.displayName;
        document.getElementById('device-name').textContent = this.displayName;
        break;
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
      
      // Our custom message types
      case 'transfer-request':
        window.dispatchEvent(new CustomEvent('transfer-request', { detail: msg }));
        break;
      case 'transfer-accept':
        window.dispatchEvent(new CustomEvent('transfer-accept', { detail: msg }));
        break;
      case 'transfer-decline':
        window.dispatchEvent(new CustomEvent('transfer-decline', { detail: msg }));
        break;

      // For messages
      case 'compose-allowed':
        // The receiver ok'd us to compose a message (or is auto-trusted)
        window.dispatchEvent(new CustomEvent('compose-allowed', { detail: msg }));
        break;
      case 'message-deliver':
        // We got an actual chat message
        window.dispatchEvent(new CustomEvent('message-deliver', { detail: msg }));
        break;

      default:
        console.log('[ServerConnection] unknown type:', msg.type);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {

  const serverConnection = new ServerConnection(detectDeviceType());
  let peers = {};
  // For "Always accept" logic: store a set of trusted senders
  let trustedSenders = new Set();

  // References
  const peerList = document.getElementById('peer-list');
  const noPeersMsg = document.getElementById('no-peers-message');

  // Choose Action Modal
  const chooseActionModal = document.getElementById('choose-action-modal');
  const chooseActionBackdrop = document.getElementById('choose-action-backdrop');
  const chooseActionPeerName = document.getElementById('choose-action-peer-name');
  const chooseSendFilesBtn = document.getElementById('choose-send-files');
  const chooseSendMessageBtn = document.getElementById('choose-send-message');

  // Incoming Request Modal
  const incomingModal = document.getElementById('incoming-request-modal');
  const incomingBackdrop = document.getElementById('incoming-request-backdrop');
  const incomingText = document.getElementById('incoming-request-text');
  const incomingDeclineBtn = document.getElementById('incoming-decline-button');
  const incomingAcceptBtn = document.getElementById('incoming-accept-button');
  const alwaysAcceptCheckbox = document.getElementById('always-accept-checkbox');

  // Waiting Response Modal
  const waitingModal = document.getElementById('waiting-response-modal');
  const waitingBackdrop = document.getElementById('waiting-response-backdrop');
  const waitingText = document.getElementById('waiting-response-text');
  const waitingCancelBtn = document.getElementById('waiting-cancel-button');

  // Compose Message Modal (sender)
  const composeMsgModal = document.getElementById('compose-message-modal');
  const composeMsgBackdrop = document.getElementById('compose-message-backdrop');
  const composeMsgTextarea = document.getElementById('compose-message-textarea');
  const composeMsgCancel = document.getElementById('compose-message-cancel');
  const composeMsgSend = document.getElementById('compose-message-send');

  // Received Message Modal (receiver)
  const receivedMsgModal = document.getElementById('received-message-modal');
  const receivedMsgBackdrop = document.getElementById('received-message-backdrop');
  const receivedMsgContainer = document.getElementById('received-message-container');
  const receivedMsgClose = document.getElementById('received-message-close');
  const receivedMsgRespond = document.getElementById('received-message-respond');

  // Respond Message Modal (receiver)
  const respondMsgModal = document.getElementById('respond-message-modal');
  const respondMsgBackdrop = document.getElementById('respond-message-backdrop');
  const respondMsgTextarea = document.getElementById('respond-message-textarea');
  const respondMsgCancel = document.getElementById('respond-message-cancel');
  const respondMsgSend = document.getElementById('respond-message-send');

  // Info & Author Modal references
  const infoButton = document.getElementById('info-button');
  const authorButton = document.getElementById('author-button');
  const infoModal = document.getElementById('info-modal');
  const infoModalClose = document.getElementById('info-modal-close');
  const infoModalBackdrop = document.getElementById('info-modal-backdrop');
  const authorModal = document.getElementById('author-modal');
  const authorModalClose = document.getElementById('author-modal-close');
  const authorModalBackdrop = document.getElementById('author-modal-backdrop');

  // State
  let currentRecipient = null;  // The peer we want to send to
  let currentAction = null;     // "files" or "message"
  let currentRequester = null;  // The peer who wants to send to us
  let currentMessageSender = null;  // The peer who last sent us a message

  /** 
   * Called when we get an updated peers list
   */
  function updatePeerList() {
    peerList.innerHTML = '';
    const pids = Object.keys(peers);
    if (pids.length === 0) {
      noPeersMsg.style.display = 'block';
    } else {
      noPeersMsg.style.display = 'none';
      pids.forEach(pid => {
        const peer = peers[pid];
        const btn = document.createElement('button');
        btn.className = 'peer-button w-full py-[15px] text-xl bg-[#333533] text-white rounded-lg hover:bg-[#242423] transition-colors';

        const icon = document.createElement('i');
        icon.classList.add('fas', getDeviceIcon(peer.name.type), 'peer-device-icon', 'text-white');
        const txt = document.createElement('span');
        txt.textContent = peer.name.displayName;

        btn.appendChild(icon);
        btn.appendChild(txt);

        btn.addEventListener('click', () => {
          // Show "Choose action" modal
          currentRecipient = peer;
          currentAction = null;
          chooseActionPeerName.textContent = peer.name.displayName;
          chooseActionModal.style.display = 'flex';
        });

        peerList.appendChild(btn);
      });
    }
  }

  // Listen for peers events
  window.addEventListener('peers', (evt) => {
    peers = {};
    evt.detail.forEach(p => {
      if (p.id !== serverConnection.id) {
        peers[p.id] = p;
      }
    });
    updatePeerList();
  });

  window.addEventListener('peer-joined', (evt) => {
    const newPeer = evt.detail;
    if (newPeer.id !== serverConnection.id) {
      peers[newPeer.id] = newPeer;
      updatePeerList();
    }
  });

  window.addEventListener('peer-left', (evt) => {
    const pid = evt.detail;
    if (peers[pid]) {
      delete peers[pid];
      updatePeerList();
    }
  });

  window.addEventListener('peer-updated', (evt) => {
    const up = evt.detail;
    peers[up.id] = up;
    updatePeerList();
  });

  /************************************************
   * CHOOSE ACTION MODAL
   ************************************************/
  chooseActionBackdrop.addEventListener('click', () => {
    chooseActionModal.style.display = 'none';
  });
  chooseSendFilesBtn.addEventListener('click', () => {
    // We won't implement files yet; just close modal
    alert('Sending files is not implemented yet.');
    chooseActionModal.style.display = 'none';
  });
  chooseSendMessageBtn.addEventListener('click', () => {
    // Send a "request" to the peer for messaging
    currentAction = 'message';
    chooseActionModal.style.display = 'none';

    // Show waiting on our side
    waitingText.textContent = `Waiting for ${currentRecipient.name.displayName} to accept...`;
    waitingModal.style.display = 'flex';

    // Send request
    serverConnection.send({
      type: 'transfer-request',
      to: currentRecipient.id,
      fromDisplayName: serverConnection.displayName,
      requestKind: 'message'
    });
  });

  /************************************************
   * INCOMING REQUEST
   ************************************************/
  window.addEventListener('transfer-request', (evt) => {
    const msg = evt.detail;
    currentRequester = msg.sender;  // the ID
    currentAction = msg.requestKind; // "message" or "files"
    const fromName = msg.fromDisplayName || 'Unknown';

    // If we've "always accept" from them, skip
    if (trustedSenders.has(currentRequester)) {
      // We automatically accept
      handleAccept(currentRequester, currentAction);
      return;
    }

    // Otherwise, show the incoming modal
    if (currentAction === 'message') {
      incomingText.textContent = `${fromName} wants to send you a message.`;
    } else {
      incomingText.textContent = `${fromName} wants to send files.`;
    }
    incomingModal.style.display = 'flex';
  });

  function handleAccept(senderId, action) {
    // Mark as accepted, no more waiting
    incomingModal.style.display = 'none';

    // If "always accept" is checked, add to trustedSenders
    if (alwaysAcceptCheckbox.checked) {
      trustedSenders.add(senderId);
    }

    // Let the sender know we accepted
    serverConnection.send({
      type: 'transfer-accept',
      to: senderId,
      acceptedKind: action
    });

    if (action === 'message') {
      // We do nothing until they actually send the message
      // We'll handle that in "message-deliver"
    } else {
      // The file transfer flow would go here
    }
    currentRequester = null;
  }

  incomingBackdrop.addEventListener('click', () => {
    incomingModal.style.display = 'none';
    currentRequester = null;
  });
  incomingDeclineBtn.addEventListener('click', () => {
    // decline
    if (currentRequester) {
      serverConnection.send({ 
        type: 'transfer-decline', 
        to: currentRequester 
      });
    }
    incomingModal.style.display = 'none';
    currentRequester = null;
  });
  incomingAcceptBtn.addEventListener('click', () => {
    handleAccept(currentRequester, currentAction);
  });

  /************************************************
   * WAITING RESPONSE
   ************************************************/
  window.addEventListener('transfer-accept', (evt) => {
    // The other side accepted
    const msg = evt.detail;
    waitingModal.style.display = 'none';
    // If it's a "message" acceptance
    if (msg.acceptedKind === 'message') {
      // Show the Compose Message modal
      composeMsgTextarea.value = '';
      composeMsgModal.style.display = 'flex';
    } else {
      alert('They accepted for file transfer (not implemented).');
    }
  });
  window.addEventListener('transfer-decline', (evt) => {
    // The other side declined
    waitingModal.style.display = 'none';
    composeMsgModal.style.display = 'none';
    alert('They declined your request.');
    currentRecipient = null;
    currentAction = null;
  });
  waitingBackdrop.addEventListener('click', () => {
    waitingModal.style.display = 'none';
    // Possibly let them know we canceled
    if (currentRecipient) {
      serverConnection.send({
        type: 'transfer-decline',
        to: currentRecipient.id
      });
    }
  });
  waitingCancelBtn.addEventListener('click', () => {
    waitingModal.style.display = 'none';
    if (currentRecipient) {
      serverConnection.send({
        type: 'transfer-decline',
        to: currentRecipient.id
      });
    }
  });

  /************************************************
   * COMPOSE MESSAGE FLOW
   ************************************************/
  composeMsgBackdrop.addEventListener('click', () => {
    composeMsgModal.style.display = 'none';
  });
  composeMsgCancel.addEventListener('click', () => {
    composeMsgModal.style.display = 'none';
  });
  composeMsgSend.addEventListener('click', () => {
    // Send message
    const content = composeMsgTextarea.value.trim();
    if (!content) {
      alert('Cannot send empty message.');
      return;
    }
    if (!currentRecipient) {
      alert('No recipient?');
      composeMsgModal.style.display = 'none';
      return;
    }

    // Send over WS
    serverConnection.send({
      type: 'message-deliver',
      to: currentRecipient.id,
      content: content,
      fromDisplayName: serverConnection.displayName
    });

    composeMsgModal.style.display = 'none';
    alert('Message sent!');
    // Reset states
    currentRecipient = null;
    currentAction = null;
  });

  /************************************************
   * RECEIVED MESSAGE
   ************************************************/
  window.addEventListener('message-deliver', (evt) => {
    const msg = evt.detail;
    // They delivered text
    const text = msg.content || '';
    const fromName = msg.fromDisplayName || 'Unknown';
    currentMessageSender = msg.sender; // so we can respond back

    receivedMsgContainer.textContent = text;
    receivedMsgModal.style.display = 'flex';
  });

  receivedMsgBackdrop.addEventListener('click', () => {
    receivedMsgModal.style.display = 'none';
  });
  receivedMsgClose.addEventListener('click', () => {
    receivedMsgModal.style.display = 'none';
  });
  receivedMsgRespond.addEventListener('click', () => {
    receivedMsgModal.style.display = 'none';
    // Open respond modal
    respondMsgTextarea.value = '';
    respondMsgModal.style.display = 'flex';
  });

  /************************************************
   * RESPOND MESSAGE FLOW
   ************************************************/
  respondMsgBackdrop.addEventListener('click', () => {
    respondMsgModal.style.display = 'none';
  });
  respondMsgCancel.addEventListener('click', () => {
    respondMsgModal.style.display = 'none';
  });
  respondMsgSend.addEventListener('click', () => {
    const content = respondMsgTextarea.value.trim();
    if (!content) {
      alert('Cannot send empty response.');
      return;
    }
    if (!currentMessageSender) {
      alert('No sender to respond to?');
      respondMsgModal.style.display = 'none';
      return;
    }
    // Send response
    serverConnection.send({
      type: 'message-deliver',
      to: currentMessageSender,
      content: content,
      fromDisplayName: serverConnection.displayName
    });
    respondMsgModal.style.display = 'none';
    alert('Response sent!');
  });

  /************************************************
   * INFO & AUTHOR
   ************************************************/
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
