import process from 'process';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import parser from 'ua-parser-js';

/*************************************************************
 * server.js
 *  - Maintains peer discovery in "rooms" by IP
 *  - Forwards "signal" messages for WebRTC offer/answer/ICE
 *  - Extended keep-alive to avoid timeouts
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

// A simple function to produce a consistent displayName
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
      hash |= 0; // Convert to 32bit integer
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
app.use(express.static('public')); // Serve the static files from ./public

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
    peer.socket.on('message', msg => this._onMessage(peer, msg));
    peer.socket.on('close', () => this._leaveRoom(peer));
    peer.socket.on('error', console.error);

    // send display name to the new peer
    this._send(peer, {
      type: 'display-name',
      message: {
        peerId: peer.id,
        displayName: peer.name.displayName,
        deviceName: peer.name.deviceName
      }
    });

    this._keepAlive(peer);
  }

  _onMessage(sender, message) {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (e) {
      return; // malformed
    }

    switch (msg.type) {
      case 'disconnect':
        this._leaveRoom(sender);
        break;
      case 'pong':
        sender.lastBeat = Date.now();
        break;
      case 'signal': {
        // WebRTC signaling => forward to the intended peer
        if (!this._rooms[sender.ip]) return;
        const recipientId = msg.to;
        const recipient = this._rooms[sender.ip][recipientId];
        if (!recipient) return;
        delete msg.to;
        msg.sender = sender.id;
        this._send(recipient, msg);
        break;
      }
      default:
        // ignoring other message types
        break;
    }
  }

  _joinRoom(peer) {
    if (!this._rooms[peer.ip]) {
      this._rooms[peer.ip] = {};
    }

    // tell existing peers that this new peer joined
    for (const otherPeerId in this._rooms[peer.ip]) {
      const otherPeer = this._rooms[peer.ip][otherPeerId];
      this._send(otherPeer, {
        type: 'peer-joined',
        peer: peer.getInfo()
      });
    }

    // let the new peer know about existing peers
    const otherPeersInfo = [];
    for (const otherPeerId in this._rooms[peer.ip]) {
      otherPeersInfo.push(this._rooms[peer.ip][otherPeerId].getInfo());
    }
    this._send(peer, { type: 'peers', peers: otherPeersInfo });

    // add to the room
    this._rooms[peer.ip][peer.id] = peer;
  }

  _leaveRoom(peer) {
    if (!this._rooms[peer.ip] || !this._rooms[peer.ip][peer.id]) return;
    this._cancelKeepAlive(peer);
    delete this._rooms[peer.ip][peer.id];
    peer.socket.terminate();
    if (!Object.keys(this._rooms[peer.ip]).length) {
      delete this._rooms[peer.ip];
    } else {
      // notify others
      for (const pid in this._rooms[peer.ip]) {
        this._send(this._rooms[peer.ip][pid], { type: 'peer-left', peerId: peer.id });
      }
    }
  }

  _send(peer, msg) {
    if (peer.socket.readyState === peer.socket.OPEN) {
      peer.socket.send(JSON.stringify(msg));
    }
  }

  _keepAlive(peer) {
    this._cancelKeepAlive(peer);
    const timeout = 30000; // 30s
    if (!peer.lastBeat) peer.lastBeat = Date.now();
    if (Date.now() - peer.lastBeat > 2 * timeout) {
      this._leaveRoom(peer);
      return;
    }
    this._send(peer, { type: 'ping' });
    peer.timerId = setTimeout(() => this._keepAlive(peer), timeout);
  }

  _cancelKeepAlive(peer) {
    if (peer && peer.timerId) {
      clearTimeout(peer.timerId);
    }
  }
}

class Peer {
  constructor(socket, request) {
    this.socket = socket;
    this._setIP(request);
    this._setPeerId(request);
    this._setName(request);
    this.rtcSupported = true; // for demonstration
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
      const match = cookies.match(/peerid=([^;]+)/);
      if (match) {
        this.id = match[1];
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

const port = process.env.PORT || 3002;
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  new DrplServer(wss);
});
