/*************************************************************
 * Basic app.js to show device name & discovered peers
 *************************************************************/

// Helper function: detect device type (still used to tell server about our device)
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
   * Minimal "ServerConnection" class — only for receiving a name
   * and notifying us about peers.
   *************************************************************/
  class ServerConnection {
    constructor(deviceType) {
      console.log('[ServerConnection] constructor called with deviceType:', deviceType);
      this.id = null;
      this.socket = null;
      this.deviceType = deviceType;
      this.displayName = '';
      this.connect();
    }
  
    connect() {
      const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
      const endpoint = protocol + location.host;
      console.log('[ServerConnection] Attempting to connect to:', endpoint);
  
      this.socket = new WebSocket(endpoint);
  
      this.socket.onopen = () => {
        console.log('[ServerConnection] WebSocket connected');
        // Introduce our device type to server
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
        console.log('[ServerConnection] WebSocket closed. Reconnecting in 3s...');
        setTimeout(() => this.connect(), 3000);
      };
  
      this.socket.onerror = (error) => {
        console.error('[ServerConnection] WebSocket error:', error);
      };
    }
  
    send(message) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify(message));
      }
    }
  
    handleMessage(message) {
      console.log('[ServerConnection] Received message:', message);
  
      switch (message.type) {
        case 'display-name': {
          // The server gives us an ID and display name
          this.id = message.message.peerId;
          this.displayName = message.message.displayName;
  
          // Update the UI so the user sees their generated name
          const deviceNameElem = document.getElementById('device-name');
          if (deviceNameElem) {
            deviceNameElem.textContent = this.displayName;
          }
          break;
        }
  
        case 'peers': {
          // Full list of peers
          window.dispatchEvent(new CustomEvent('peers', { detail: message.peers }));
          break;
        }
  
        case 'peer-joined': {
          // A new peer has joined
          window.dispatchEvent(new CustomEvent('peer-joined', { detail: message.peer }));
          break;
        }
  
        case 'peer-left': {
          // A peer left
          window.dispatchEvent(new CustomEvent('peer-left', { detail: message.peerId }));
          break;
        }
  
        case 'peer-updated': {
          // A peer updated (maybe changed device type)
          window.dispatchEvent(new CustomEvent('peer-updated', { detail: message.peer }));
          break;
        }
  
        case 'ping': {
          // Basic keep-alive
          this.send({ type: 'pong' });
          break;
        }
  
        default:
          console.log('[ServerConnection] Unknown message type:', message.type);
      }
    }
  }
  
  /*************************************************************
   * Minimal DOM logic — just keep track of peers and show them
   *************************************************************/
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[app.js] DOMContentLoaded');
    let peers = {};
  
    // Create a new server connection
    const deviceType = detectDeviceType();
    console.log('[app.js] Detected deviceType:', deviceType);
    const serverConnection = new ServerConnection(deviceType);
  
    // Grab references for UI elements
    const peerListElement = document.getElementById('peer-list');
    const noPeersMessage = document.getElementById('no-peers-message');
  
    // Simple function to update the peer list
    function updatePeerList() {
      console.log('[updatePeerList] Called with peers:', peers);
  
      // Clear existing buttons
      peerListElement.innerHTML = '';
  
      const peerIds = Object.keys(peers);
      if (peerIds.length === 0) {
        noPeersMessage.style.display = 'block';
      } else {
        noPeersMessage.style.display = 'none';
        // Create a button for each peer
        peerIds.forEach((pid) => {
          const peer = peers[pid];
          // Make a simple button with the peer's displayName
          const btn = document.createElement('button');
          btn.className = 'w-full px-6 py-4 bg-[#333533] text-white rounded-lg hover:bg-[#242423] transition-colors';
          btn.style.marginTop = '8px';
  
          // The button text can be the peer's displayName
          btn.textContent = peer.name.displayName + ' (' + (peer.name.type || 'desktop') + ')';
  
          // For now, no click action needed
          btn.addEventListener('click', () => {
            console.log('[updatePeerList] Clicked peer button:', peer);
            alert('Clicked peer: ' + peer.name.displayName);
          });
  
          peerListElement.appendChild(btn);
        });
      }
    }
  
    /***********************************************************
     * Listen for custom events from the server
     ***********************************************************/
  
    // Initially we might get a full list of peers
    window.addEventListener('peers', (e) => {
      console.log('[event:peers] Received full peer list:', e.detail);
      // Build the local peers object
      peers = {};
      e.detail.forEach((p) => {
        if (p.id !== serverConnection.id) {
          peers[p.id] = p;
        }
      });
      updatePeerList();
    });
  
    // If a new peer joins
    window.addEventListener('peer-joined', (e) => {
      const newPeer = e.detail;
      console.log('[event:peer-joined] Peer joined:', newPeer);
      if (newPeer.id !== serverConnection.id) {
        peers[newPeer.id] = newPeer;
        updatePeerList();
      }
    });
  
    // If a peer leaves
    window.addEventListener('peer-left', (e) => {
      const peerId = e.detail;
      console.log('[event:peer-left] Peer left with ID:', peerId);
      if (peers[peerId]) {
        delete peers[peerId];
        updatePeerList();
      }
    });
  
    // If a peer updates
    window.addEventListener('peer-updated', (e) => {
      const updatedPeer = e.detail;
      console.log('[event:peer-updated] Updated peer:', updatedPeer);
      peers[updatedPeer.id] = updatedPeer;
      updatePeerList();
    });
  
    // Done. The rest of the code from the old version (file transfers, etc.) is omitted.
  });
  