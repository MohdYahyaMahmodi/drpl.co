/*************************************************************
 * Basic main.js to show device name & discovered peers
 * and remove them in real-time upon close
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
    // Check if it's a laptop or desktop based on screen width
    return window.innerWidth <= 1366 ? 'laptop' : 'desktop';
  }
  return 'desktop'; // Default fallback
}

/*************************************************************
 * ServerConnection: manages our WebSocket -> server
 *************************************************************/
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
      // Introduce our device type
      this.send({
        type: 'introduce',
        name: { deviceType: this.deviceType }
      });
    };

    this.socket.onmessage = (message) => {
      const data = JSON.parse(message.data);
      this.handleMessage(data);
    };

    // If the socket closes, we reconnect after 3s
    this.socket.onclose = () => {
      console.log('[ServerConnection] WebSocket closed; reconnect in 3s');
      setTimeout(() => this.connect(), 3000);
    };

    // Log any errors
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
        // Show in the UI
        const deviceNameElem = document.getElementById('device-name');
        if (deviceNameElem) {
          deviceNameElem.textContent = this.displayName;
        }
        break;
      }
      case 'peers': {
        window.dispatchEvent(new CustomEvent('peers', { detail: msg.peers }));
        break;
      }
      case 'peer-joined': {
        window.dispatchEvent(new CustomEvent('peer-joined', { detail: msg.peer }));
        break;
      }
      case 'peer-left': {
        window.dispatchEvent(new CustomEvent('peer-left', { detail: msg.peerId }));
        break;
      }
      case 'peer-updated': {
        window.dispatchEvent(new CustomEvent('peer-updated', { detail: msg.peer }));
        break;
      }
      case 'ping': {
        this.send({ type: 'pong' });
        break;
      }
      default:
        console.log('[ServerConnection] Unknown message type:', msg.type);
    }
  }
}

/*************************************************************
 * DOM logic: keep track of peers, show them with icons
 *************************************************************/
document.addEventListener('DOMContentLoaded', () => {
  console.log('[main.js] DOMContentLoaded');
  let peers = {};

  // Create a new server connection with deviceType
  const deviceType = detectDeviceType();
  console.log('[main.js] Device type is:', deviceType);
  const serverConnection = new ServerConnection(deviceType);

  // UI references
  const peerListElement = document.getElementById('peer-list');
  const noPeersMessage = document.getElementById('no-peers-message');

  // For icons
  function getDeviceIcon(deviceType) {
    switch (deviceType) {
      case 'mobile':  return 'fa-mobile-alt';
      case 'tablet':  return 'fa-tablet-alt';
      case 'laptop':  // fallthrough
      case 'desktop': return 'fa-desktop';
      default:        return 'fa-question-circle';
    }
  }

  function updatePeerList() {
    console.log('[updatePeerList] peers:', peers);

    peerListElement.innerHTML = '';
    const peerIds = Object.keys(peers);

    if (peerIds.length === 0) {
      noPeersMessage.style.display = 'block';
    } else {
      noPeersMessage.style.display = 'none';
      peerIds.forEach((pid) => {
        const peer = peers[pid];

        // bigger top/bottom padding and bigger font
        const btn = document.createElement('button');
        btn.className = 'peer-button w-full py-[15px] text-xl bg-[#333533] text-white rounded-lg hover:bg-[#242423] transition-colors';

        // Icon
        const iconEl = document.createElement('i');
        iconEl.classList.add('fas', getDeviceIcon(peer.name.type), 'peer-device-icon', 'text-white');

        // Span for text
        const textSpan = document.createElement('span');
        textSpan.textContent = peer.name.displayName;

        btn.appendChild(iconEl);
        btn.appendChild(textSpan);

        // Optional click action
        btn.addEventListener('click', () => {
          console.log('[updatePeerList] clicked peer:', peer);
          alert('Clicked on ' + peer.name.displayName);
        });

        peerListElement.appendChild(btn);
      });
    }
  }

  // Listen for custom events
  window.addEventListener('peers', (evt) => {
    console.log('[event:peers]', evt.detail);
    peers = {};
    evt.detail.forEach((p) => {
      if (p.id !== serverConnection.id) {
        peers[p.id] = p;
      }
    });
    updatePeerList();
  });

  window.addEventListener('peer-joined', (evt) => {
    const newPeer = evt.detail;
    console.log('[event:peer-joined]', newPeer);
    if (newPeer.id !== serverConnection.id) {
      peers[newPeer.id] = newPeer;
      updatePeerList();
    }
  });

  window.addEventListener('peer-left', (evt) => {
    const peerId = evt.detail;
    console.log('[event:peer-left]', peerId);
    if (peers[peerId]) {
      delete peers[peerId];
      updatePeerList();
    }
  });

  window.addEventListener('peer-updated', (evt) => {
    const updatedPeer = evt.detail;
    console.log('[event:peer-updated]', updatedPeer);
    peers[updatedPeer.id] = updatedPeer;
    updatePeerList();
  });
});
