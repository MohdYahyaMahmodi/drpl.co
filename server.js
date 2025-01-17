// server.js
import process from 'process';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import parser from 'ua-parser-js';
import WebSocket from 'ws';

// Word lists for generating random display names
const adjectivesList = [
  'Red','Blue','Green','Purple','Golden','Silver',
  'Crystal','Cosmic','Electric','Mystic','Shadow','Radiant',
  'Midnight','Solar','Lunar','Cobalt','Verdant','Scarlet',
  'Azure','Thunder'
];

const nounsList = [
  'Wolf','Eagle','Lion','Phoenix','Dragon','Tiger',
  'Falcon','Panther','Hawk','Bear','Serpent','Leopard',
  'Raven','Shark','Cheetah','Pegasus','Minotaur','Orca',
  'Griffin','Octopus'
];

// Generate a displayName for a given peerId
function getDisplayName(id) {
  const hash1 = (id + 'adjective').hashCode();
  const hash2 = (id + 'noun').hashCode();
  const adjective = adjectivesList[Math.abs(hash1) % adjectivesList.length];
  const noun = nounsList[Math.abs(hash2) % nounsList.length];
  return `${adjective} ${noun}`;
}

// Extend String prototype for quick hash
Object.defineProperty(String.prototype, 'hashCode', {
  value: function() {
    let hash = 0, i, chr;
    for (i = 0; i < this.length; i++) {
      chr = this.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0;
    }
    return hash;
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.info('SIGINT Received, exiting...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.info('SIGTERM Received, exiting...');
  process.exit(0);
});

// Create Express app
const app = express();
// Serve static files from 'public' folder
app.use(express.static('public'));

// Create an HTTP server from express
const server = http.createServer(app);

// Create a WebSocket server
const wss = new WebSocketServer({ server });

class FileDropServer {
  constructor(wss) {
    this._wss = wss;
    this._rooms = {}; // key: ip, value: { peerId -> Peer }

    this._wss.on('connection', (socket, request) =>
      this._onConnection(new Peer(socket, request))
    );
    this._wss.on('headers', (headers, response) =>
      this._onHeaders(headers, response)
    );

    console.log('Drpl.co server is running');
  }

  _onHeaders(headers, response) {
    // If no cookie => set peerId cookie
    if (!response.headers.cookie || !response.headers.cookie.includes('peerid=')) {
      response.peerId = Peer.uuid();
      headers.push(
        'Set-Cookie: peerid=' + response.peerId + '; SameSite=Strict; Secure'
      );
    }
  }

  _onConnection(peer) {
    this._joinRoom(peer);
    peer.socket.on('message', (msg) => this._onMessage(peer, msg));
    peer.socket.on('close', () => this._leaveRoom(peer));
    peer.socket.on('error', console.error);

    // Send them their displayName right away
    this._send(peer, {
      type: 'display-name',
      message: {
        peerId: peer.id,
        displayName: peer.name.displayName,
        deviceName: peer.name.deviceName
      }
    });

    // Start keepAlive
    this._keepAlive(peer);
  }

  _onMessage(sender, message) {
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    switch (parsed.type) {
      case 'introduce':
        // The client told us its device type
        sender.name.type = parsed.name.deviceType;
        // Notify other peers in same IP
        this._notifyPeersAboutUpdate(sender);
        // Send updated peers list to sender
        this._sendPeersList(sender);
        break;
      case 'disconnect':
        this._leaveRoom(sender);
        break;
      case 'pong':
        sender.lastBeat = Date.now();
        break;
      default:
        // If a "to" field => route to that peer in same IP
        if (parsed.to && this._rooms[sender.ip]) {
          const targetId = parsed.to;
          const targetPeer = this._rooms[sender.ip][targetId];
          if (!targetPeer) return;
          delete parsed.to;
          parsed.sender = sender.id; 
          this._send(targetPeer, parsed);
        }
        break;
    }
  }

  _joinRoom(peer) {
    if (!this._rooms[peer.ip]) {
      this._rooms[peer.ip] = {};
    }
    // Notify existing peers
    for (const otherId in this._rooms[peer.ip]) {
      const otherPeer = this._rooms[peer.ip][otherId];
      this._send(otherPeer, {
        type: 'peer-joined',
        peer: peer.getInfo()
      });
    }
    // Send existing peers to new peer
    this._sendPeersList(peer);

    this._rooms[peer.ip][peer.id] = peer;
  }

  _leaveRoom(peer) {
    if (!this._rooms[peer.ip] || !this._rooms[peer.ip][peer.id]) return;
    this._cancelKeepAlive(peer);
    
    delete this._rooms[peer.ip][peer.id];
    peer.socket.terminate(); // close socket

    if (Object.keys(this._rooms[peer.ip]).length === 0) {
      delete this._rooms[peer.ip];
    } else {
      // Notify others
      for (const pid in this._rooms[peer.ip]) {
        const p = this._rooms[peer.ip][pid];
        this._send(p, {
          type: 'peer-left',
          peerId: peer.id
        });
      }
    }
  }

  _notifyPeersAboutUpdate(sender) {
    const room = this._rooms[sender.ip];
    if (!room) return;
    for (const pid in room) {
      if (pid !== sender.id) {
        this._send(room[pid], {
          type: 'peer-updated',
          peer: sender.getInfo()
        });
      }
    }
  }

  _sendPeersList(peer) {
    // Send a "peers" event with all others
    const room = this._rooms[peer.ip];
    const otherPeers = [];
    for (const pid in room) {
      if (pid !== peer.id) {
        otherPeers.push(room[pid].getInfo());
      }
    }
    this._send(peer, {
      type: 'peers',
      peers: otherPeers
    });
  }

  _send(peer, msg) {
    if (!peer || peer.socket.readyState !== WebSocket.OPEN) return;
    peer.socket.send(JSON.stringify(msg), err => {
      if (err) console.error('WS send error:', err);
    });
  }

  _keepAlive(peer) {
    this._cancelKeepAlive(peer);
    const timeout = 5000;
    if (!peer.lastBeat) {
      peer.lastBeat = Date.now();
    }
    if (Date.now() - peer.lastBeat > 2*timeout) {
      this._leaveRoom(peer);
      return;
    }
    this._send(peer, { type: 'ping' });
    peer.timerId = setTimeout(() => this._keepAlive(peer), timeout);
  }

  _cancelKeepAlive(peer) {
    if (peer.timerId) {
      clearTimeout(peer.timerId);
    }
  }
}

class Peer {
  constructor(socket, request) {
    this.socket = socket;
    this._setIP(request);
    this._setPeerId(request);
    this.rtcSupported = true; 
    this._setName(request);
    this.timerId = 0;
    this.lastBeat = Date.now();
  }

  _setIP(request) {
    if (request.headers['x-forwarded-for']) {
      this.ip = request.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
    } else {
      this.ip = request.socket.remoteAddress;
    }
    if (this.ip === '::1' || this.ip === '::ffff:127.0.0.1') {
      this.ip = '127.0.0.1';
    }
  }

  _setPeerId(request) {
    if (request.peerId) {
      this.id = request.peerId;
    } else {
      const cookies = request.headers.cookie || '';
      const m = cookies.match(/peerid=([^;]+)/);
      if (m) {
        this.id = m[1];
      } else {
        this.id = Peer.uuid();
      }
    }
  }

  _setName(request) {
    const ua = parser(request.headers['user-agent']);
    let deviceName = '';

    if (ua.os && ua.os.name) {
      deviceName = ua.os.name.replace('Mac OS', 'Mac') + ' ';
    }
    if (ua.device.model) {
      deviceName += ua.device.model;
    } else {
      deviceName += ua.browser.name || '';
    }
    if (!deviceName) deviceName = 'Unknown Device';

    const displayName = getDisplayName(this.id);
    this.name = {
      model: ua.device.model,
      os: ua.os.name,
      browser: ua.browser.name,
      type: ua.device.type || 'desktop',
      deviceName,
      displayName
    };
  }

  getInfo() {
    return {
      id: this.id,
      name: this.name,
      rtcSupported: this.rtcSupported
    };
  }

  static uuid() {
    let uuid = '';
    for (let i=0; i<32; i++) {
      const rnd = (Math.random()*16)|0;
      if (i===8 || i===12 || i===16 || i===20) uuid += '-';
      if (i===12) {
        uuid += '4';
      } else if (i===16) {
        uuid += (rnd & 3 | 8).toString(16);
      } else {
        uuid += rnd.toString(16);
      }
    }
    return uuid;
  }
}

// Start server
const port = process.env.PORT || 3002;
server.listen(port, () => {
  console.log('Server listening on port', port);
  new FileDropServer(wss);
});
