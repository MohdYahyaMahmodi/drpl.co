import process from 'process';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import parser from 'ua-parser-js';

/*************************************************************
 * server.js
 *  - Maintains peer discovery in "rooms" by IP
 *  - Relays messages: "signal" for WebRTC, plus "transfer-request",
 *    "transfer-accept", "transfer-decline", etc. 
 *  - Generates a random display name from ID for each peer
 *************************************************************/

// Word lists for generating random display names
const adjectivesList = [
  'Red', 'Blue', 'Green', 'Purple', 'Golden', 'Silver',
  'Crystal', 'Cosmic', 'Electric', 'Mystic', 'Shadow', 'Radiant',
  'Midnight', 'Solar', 'Lunar', 'Cobalt', 'Verdant', 'Scarlet',
  'Azure', 'Thunder'
];
const nounsList = [
  'Wolf', 'Eagle', 'Lion', 'Phoenix', 'Dragon', 'Tiger',
  'Falcon', 'Panther', 'Hawk', 'Bear', 'Serpent', 'Leopard',
  'Raven', 'Shark', 'Cheetah', 'Pegasus', 'Minotaur', 'Orca',
  'Griffin', 'Octopus'
];

// Generate a nice codename
function getDisplayName(id) {
  const hash1 = (id + 'adjective').hashCode();
  const hash2 = (id + 'noun').hashCode();
  const adjective = adjectivesList[Math.abs(hash1) % adjectivesList.length];
  const noun = nounsList[Math.abs(hash2) % nounsList.length];
  return `${adjective} ${noun}`;
}

// Extend String prototype for hashing
Object.defineProperty(String.prototype, 'hashCode', {
  value: function() {
    let hash = 0;
    for (let i = 0; i < this.length; i++) {
      const chr = this.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0; // Convert to 32-bit int
    }
    return hash;
  }
});

process.on('SIGINT', () => {
  console.info('SIGINT Received, exiting...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.info('SIGTERM Received, exiting...');
  process.exit(0);
});

const app = express();
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

class DrplServer {
  constructor(wss) {
    this._wss = wss;
    this._rooms = {}; // { ip: { peerId: Peer } }

    this._wss.on('connection', (socket, request) => this._onConnection(new Peer(socket, request)));
    this._wss.on('headers', (headers, response) => this._onHeaders(headers, response));
    console.log('Drpl.co server is running.');
  }

  _onHeaders(headers, response) {
    if (!response.headers.cookie || !response.headers.cookie.includes('peerid=')) {
      response.peerId = Peer.uuid();
      headers.push('Set-Cookie: peerid=' + response.peerId + '; SameSite=Strict; Secure');
    }
  }

  _onConnection(peer) {
    this._joinRoom(peer);

    peer.socket.on('message', data => this._onMessage(peer, data));
    peer.socket.on('close', () => this._leaveRoom(peer));
    peer.socket.on('error', console.error);

    // Immediately send this peer's random codename
    this._send(peer, {
      type: 'display-name',
      message: {
        peerId: peer.id,
        displayName: peer.name.displayName,
        deviceName: peer.name.deviceName
      }
    });
  }

  _onMessage(sender, data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return; // ignore malformed JSON
    }

    switch (msg.type) {
      case 'introduce': {
        // no-op except we might store deviceType if needed
        sender.name.type = msg.name.deviceType;
        // after joining, we can send an updated "peer-updated" if we wish
        this._notifyPeersAboutUpdate(sender);
        // also send the peer list to the new user
        this._sendPeersList(sender);
        break;
      }
      case 'signal': {
        // forward to the intended peer for WebRTC
        const recipient = this._getRecipient(sender.ip, msg.to);
        if (recipient) {
          delete msg.to;
          msg.sender = sender.id;
          this._send(recipient, msg);
        }
        break;
      }
      case 'transfer-request':
      case 'transfer-accept':
      case 'transfer-decline':
      case 'transfer-cancel':
      case 'send-message':
      case 'pong':
      case 'disconnect':
      case 'transfer-complete':
      case 'transfer-error': {
        // Just forward to the "to" peer
        const recipient = this._getRecipient(sender.ip, msg.to);
        if (recipient) {
          delete msg.to;
          msg.sender = sender.id;
          this._send(recipient, msg);
        }
        break;
      }
      default:
        // ignoring unrecognized
        break;
    }
  }

  _getRecipient(ip, peerId) {
    if (!this._rooms[ip]) return null;
    return this._rooms[ip][peerId] || null;
  }

  _joinRoom(peer) {
    if (!this._rooms[peer.ip]) this._rooms[peer.ip] = {};

    // notify existing peers that this new peer joined
    for (const otherPeerId in this._rooms[peer.ip]) {
      const otherPeer = this._rooms[peer.ip][otherPeerId];
      this._send(otherPeer, {
        type: 'peer-joined',
        peer: peer.getInfo()
      });
    }

    // send the new peer a list of existing peers
    this._sendPeersList(peer);

    // add new peer
    this._rooms[peer.ip][peer.id] = peer;
  }

  _sendPeersList(peer) {
    const peersArray = [];
    for (const pid in this._rooms[peer.ip]) {
      if (pid !== peer.id) {
        peersArray.push(this._rooms[peer.ip][pid].getInfo());
      }
    }
    this._send(peer, { type: 'peers', peers: peersArray });
  }

  _notifyPeersAboutUpdate(peer) {
    // if you want to broadcast that a peer's info changed
    const room = this._rooms[peer.ip];
    if (!room) return;
    for (const pid in room) {
      if (pid !== peer.id) {
        this._send(room[pid], {
          type: 'peer-updated',
          peer: peer.getInfo()
        });
      }
    }
  }

  _leaveRoom(peer) {
    if (!this._rooms[peer.ip] || !this._rooms[peer.ip][peer.id]) return;
    delete this._rooms[peer.ip][peer.id];
    peer.socket.terminate();

    if (!Object.keys(this._rooms[peer.ip]).length) {
      delete this._rooms[peer.ip];
    } else {
      // notify others
      for (const pid in this._rooms[peer.ip]) {
        this._send(this._rooms[peer.ip][pid], {
          type: 'peer-left',
          peerId: peer.id
        });
      }
    }
  }

  _send(peer, msg) {
    if (peer.socket.readyState === peer.socket.OPEN) {
      peer.socket.send(JSON.stringify(msg));
    }
  }
}

class Peer {
  constructor(socket, request) {
    this.socket = socket;
    this._setIP(request);
    this._setPeerId(request);
    this._setName(request);
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
      const ck = request.headers.cookie || '';
      const match = ck.match(/peerid=([^;]+)/);
      this.id = match ? match[1] : Peer.uuid();
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
      rtcSupported: true
    };
  }

  static uuid() {
    let uuid = '';
    for (let i = 0; i < 32; i++) {
      const random = (Math.random() * 16) | 0;
      if (i === 8 || i === 12 || i === 16 || i === 20) uuid += '-';
      if (i === 12) {
        uuid += '4';
      } else if (i === 16) {
        uuid += (random & 3) | 8;
      } else {
        uuid += random.toString(16);
      }
    }
    return uuid;
  }
}

server.listen(process.env.PORT || 3002, () => {
  console.log(`Server listening on port ${process.env.PORT || 3002}`);
  new DrplServer(wss);
});
