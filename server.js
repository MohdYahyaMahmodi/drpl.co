// server.js
import process from 'process';
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import parser from 'ua-parser-js';

// Word lists for generating random display names
const adjectivesList = [
  'Red', 'Blue', 'Green', 'Purple', 'Golden', 'Silver',
  'Crystal', 'Cosmic', 'Electric', 'Mystic'
];
const nounsList = [
  'Wolf', 'Eagle', 'Lion', 'Phoenix', 'Dragon',
  'Tiger', 'Falcon', 'Panther', 'Hawk', 'Bear'
];

// Helper function to generate displayName based on peer ID
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

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.info('SIGINT Received, exiting...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.info('SIGTERM Received, exiting...');
  process.exit(0);
});

// Express app
const app = express();
app.use(express.static('.')); // Serve static files (index.html, app.js, etc.)

// Create HTTP server from express
const server = http.createServer(app);

// Create a WebSocket server on top of the same HTTP server
const wss = new WebSocketServer({ server });

class FileDropServer {
  constructor(wss) {
    this._wss = wss;
    this._rooms = {};

    this._wss.on('connection', (socket, request) =>
      this._onConnection(new Peer(socket, request))
    );
    this._wss.on('headers', (headers, response) =>
      this._onHeaders(headers, response)
    );

    console.log('FileDrop server is running');
  }

  _onConnection(peer) {
    this._joinRoom(peer);
    peer.socket.on('message', (msg) => this._onMessage(peer, msg));
    peer.socket.on('close', () => this._leaveRoom(peer));
    peer.socket.on('error', console.error);
    this._keepAlive(peer);

    // Send displayName/deviceName (plus ID) to the connecting peer
    this._send(peer, {
      type: 'display-name',
      message: {
        peerId: peer.id,
        displayName: peer.name.displayName,
        deviceName: peer.name.deviceName
      }
    });
  }

  _onHeaders(headers, response) {
    // The 'headers' event can set cookies if needed. We'll set a random peerid if none.
    if (!response.headers.cookie || response.headers.cookie.indexOf('peerid=') === -1) {
      response.peerId = Peer.uuid();
      headers.push(
        'Set-Cookie: peerid=' + response.peerId + '; SameSite=Strict; Secure'
      );
    }
  }

  _onMessage(sender, message) {
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch (e) {
      return;
    }

    switch (parsed.type) {
      case 'introduce':
        // The client told us its device type
        sender.name.type = parsed.name.deviceType;
        // Notify others in the same room that 'sender' updated
        this._notifyPeersAboutUpdate(sender);
        // Send the updated peer list to the sender
        this._sendPeersList(sender);
        break;

      case 'disconnect':
        this._leaveRoom(sender);
        break;

      case 'pong':
        sender.lastBeat = Date.now();
        break;

      default:
        // Relay message to intended recipient if "to" is specified
        if (parsed.to && this._rooms[sender.ip]) {
          const recipientId = parsed.to;
          const recipient = this._rooms[sender.ip][recipientId];
          if (!recipient) return;
          delete parsed.to;
          parsed.sender = sender.id;
          this._send(recipient, parsed);
        }
        break;
    }
  }

  _joinRoom(peer) {
    if (!this._rooms[peer.ip]) {
      this._rooms[peer.ip] = {};
    }

    // Notify existing peers that this new peer joined
    for (const otherPeerId in this._rooms[peer.ip]) {
      const otherPeer = this._rooms[peer.ip][otherPeerId];
      this._send(otherPeer, {
        type: 'peer-joined',
        peer: peer.getInfo()
      });
    }

    // Send the existing list to the new peer
    this._sendPeersList(peer);

    this._rooms[peer.ip][peer.id] = peer;
  }

  _leaveRoom(peer) {
    if (!this._rooms[peer.ip] || !this._rooms[peer.ip][peer.id]) return;
    this._cancelKeepAlive(this._rooms[peer.ip][peer.id]);

    delete this._rooms[peer.ip][peer.id];
    peer.socket.terminate();

    if (!Object.keys(this._rooms[peer.ip]).length) {
      delete this._rooms[peer.ip];
    } else {
      // Notify others that this peer left
      for (const otherPeerId in this._rooms[peer.ip]) {
        const otherPeer = this._rooms[peer.ip][otherPeerId];
        this._send(otherPeer, {
          type: 'peer-left',
          peerId: peer.id
        });
      }
    }
  }

  _send(peer, message) {
    if (!peer || peer.socket.readyState !== WebSocket.OPEN) return;
    peer.socket.send(JSON.stringify(message), (err) => {
      if (err) console.error(err);
    });
  }

  _notifyPeersAboutUpdate(sender) {
    const peersInRoom = this._rooms[sender.ip];
    if (peersInRoom) {
      for (const peerId in peersInRoom) {
        const peer = peersInRoom[peerId];
        if (peer.id !== sender.id) {
          this._send(peer, {
            type: 'peer-updated',
            peer: sender.getInfo()
          });
        }
      }
    }
  }

  _sendPeersList(peer) {
    const peersInRoom = this._rooms[peer.ip];
    const otherPeers = [];
    for (const pId in peersInRoom) {
      if (pId !== peer.id) {
        otherPeers.push(peersInRoom[pId].getInfo());
      }
    }
    this._send(peer, {
      type: 'peers',
      peers: otherPeers
    });
  }

  _keepAlive(peer) {
    this._cancelKeepAlive(peer);
    const timeout = 30000;
    if (!peer.lastBeat) {
      peer.lastBeat = Date.now();
    }
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
    this.rtcSupported = true; // Assume WebRTC is supported
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
    // Normalize localhost
    if (this.ip === '::1' || this.ip === '::ffff:127.0.0.1') {
      this.ip = '127.0.0.1';
    }
  }

  _setPeerId(request) {
    if (request.peerId) {
      this.id = request.peerId;
    } else {
      // If no peerId from the headers, generate a new one
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
      if (i === 8 || i === 12 || i === 16 || i === 20) {
        uuid += '-';
      }
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

// Start server
const port = process.env.PORT || 3002;
server.listen(port, () => {
  console.log('Server is listening on port', port);
  new FileDropServer(wss); // Initiate our signaling
});
