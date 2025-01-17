/*************************************************************
 * Basic main.js: 
 * 1. Show device name & discovered peers 
 * 2. Let user click on a peer => request file transfer
 * 3. Show "incoming request" modal on the receiving side
 * 4. Show "waiting response" modal on the sending side
 *************************************************************/

/** 
 * detectDeviceType: Tells the server what type of device we are 
 * so it can show an appropriate icon to others.
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
       * Additional Transfer messages
       ************************************************/
      case 'transfer-request':
        // Another peer is asking to send files
        window.dispatchEvent(new CustomEvent('transfer-request', { detail: msg }));
        break;
      case 'transfer-accept':
        // The remote accepted
        window.dispatchEvent(new CustomEvent('transfer-accept', { detail: msg }));
        break;
      case 'transfer-decline':
        // The remote declined
        window.dispatchEvent(new CustomEvent('transfer-decline', { detail: msg }));
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

  // Transfer modals references
  const incomingRequestModal = document.getElementById('incoming-request-modal');
  const incomingBackdrop = document.getElementById('incoming-request-backdrop');
  const incomingRequestText = document.getElementById('incoming-request-text');
  const incomingDeclineBtn = document.getElementById('incoming-decline-button');
  const incomingAcceptBtn = document.getElementById('incoming-accept-button');

  const waitingResponseModal = document.getElementById('waiting-response-modal');
  const waitingResponseBackdrop = document.getElementById('waiting-response-backdrop');
  const waitingResponseText = document.getElementById('waiting-response-text');
  const waitingCancelBtn = document.getElementById('waiting-cancel-button');

  // Info & Author modals references
  const infoButton = document.getElementById('info-button');
  const authorButton = document.getElementById('author-button');
  
  const infoModal = document.getElementById('info-modal');
  const authorModal = document.getElementById('author-modal');
  
  const infoModalClose = document.getElementById('info-modal-close');
  const infoModalBackdrop = document.getElementById('info-modal-backdrop');
  
  const authorModalClose = document.getElementById('author-modal-close');
  const authorModalBackdrop = document.getElementById('author-modal-backdrop');

  // We'll store the ID of the "active peer" we are trying to send to
  let currentRecipientId = null;

  // We'll store the ID of who is requesting us
  let currentRequesterId = null;

  // Handle new peer list
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

        // Click => request file transfer from this peer
        btn.addEventListener('click', () => {
          console.log('[UI] clicked peer => request transfer to:', peer.name.displayName);
          currentRecipientId = peer.id;
          // Show "waiting" modal
          waitingResponseText.textContent = `Waiting for ${peer.name.displayName} to accept...`;
          waitingResponseModal.style.display = 'flex';

          // Send request message to them
          serverConnection.send({
            type: 'transfer-request',
            to: peer.id,
            fromDisplayName: serverConnection.displayName
          });
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

  // Transfer Request
  window.addEventListener('transfer-request', (e) => {
    const msg = e.detail; 
    console.log('[transfer-request] Received from', msg.sender);

    // The "sender" field is the ID of the peer requesting
    currentRequesterId = msg.sender;

    // We also have msg.fromDisplayName for convenience
    const fromName = msg.fromDisplayName || 'Unknown';
    incomingRequestText.textContent = `${fromName} wants to transfer files.`;
    
    // Show incoming request modal
    incomingRequestModal.style.display = 'flex';
  });

  // Transfer Accept
  window.addEventListener('transfer-accept', (e) => {
    const msg = e.detail;
    console.log('[transfer-accept] from', msg.sender);

    // The other side accepted, hide waiting modal
    waitingResponseModal.style.display = 'none';
    alert('They accepted! Start sending files now (not yet implemented).');
    currentRecipientId = null;
  });

  // Transfer Decline
  window.addEventListener('transfer-decline', (e) => {
    const msg = e.detail;
    console.log('[transfer-decline] from', msg.sender);

    // The other side declined
    waitingResponseModal.style.display = 'none';
    alert('They declined the file transfer.');
    currentRecipientId = null;
  });

  /***********************************************************
   * MODAL EVENTS
   **********************************************************/
  // Info & Author modals
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

  // Incoming Request Modal
  incomingBackdrop.addEventListener('click', () => {
    incomingRequestModal.style.display = 'none';
  });
  incomingDeclineBtn.addEventListener('click', () => {
    // Send decline
    if (currentRequesterId) {
      serverConnection.send({
        type: 'transfer-decline',
        to: currentRequesterId
      });
    }
    incomingRequestModal.style.display = 'none';
    currentRequesterId = null;
  });
  incomingAcceptBtn.addEventListener('click', () => {
    // Send accept
    if (currentRequesterId) {
      serverConnection.send({
        type: 'transfer-accept',
        to: currentRequesterId
      });
    }
    incomingRequestModal.style.display = 'none';
    currentRequesterId = null;
    alert('Accepted! We can now receive files (not yet implemented).');
  });

  // Waiting Response Modal
  waitingResponseBackdrop.addEventListener('click', () => {
    waitingResponseModal.style.display = 'none';
    // Possibly send a cancel if you want
    if (currentRecipientId) {
      serverConnection.send({
        type: 'transfer-decline',
        to: currentRecipientId
      });
      currentRecipientId = null;
    }
  });
  waitingCancelBtn.addEventListener('click', () => {
    waitingResponseModal.style.display = 'none';
    // Possibly send a "cancel" message
    if (currentRecipientId) {
      serverConnection.send({
        type: 'transfer-decline',
        to: currentRecipientId
      });
      currentRecipientId = null;
    }
  });
});
