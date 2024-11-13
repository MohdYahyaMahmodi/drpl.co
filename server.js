// server.js
import process from 'process';
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import parser from 'ua-parser-js';

// Word lists for generating device names
const adjectivesList = ['Red', 'Blue', 'Green', 'Purple', 'Golden', 'Silver', 'Crystal', 'Cosmic', 'Electric', 'Mystic'];
const nounsList = ['Wolf', 'Eagle', 'Lion', 'Phoenix', 'Dragon', 'Tiger', 'Falcon', 'Panther', 'Hawk', 'Bear'];

// Helper function to generate displayName based on peer ID
function getDisplayName(id) {
  const hash1 = (id + 'adjective').hashCode();
  const hash2 = (id + 'noun').hashCode();
  const adjective = adjectivesList[Math.abs(hash1) % adjectivesList.length];
  const noun = nounsList[Math.abs(hash2) % nounsList.length];
  return `${adjective} ${noun}`;
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.info("SIGINT Received, exiting...");
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.info("SIGTERM Received, exiting...");
  process.exit(0);
});

// Create an Express app
const app = express();

// Serve static files from the current directory
app.use(express.static('.'));

// Create an HTTP server
const server = http.createServer(app);

// Create a WebSocket server
const wss = new WebSocketServer({ server });

class FileDropServer {
  constructor(wss) {
    this._wss = wss;
    this._wss.on('connection', (socket, request) => this._onConnection(new Peer(socket, request)));
    this._wss.on('headers', (headers, response) => this._onHeaders(headers, response));

    this._rooms = {};

    console.log('FileDrop server is running');
  }

  _onConnection(peer) {
    this._joinRoom(peer);
    peer.socket.on('message', message => this._onMessage(peer, message));
    peer.socket.on('close', () => this._leaveRoom(peer));
    peer.socket.on('error', console.error);
    this._keepAlive(peer);

    // Send displayName and deviceName to the peer, including peerId
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
    if (response.headers.cookie && response.headers.cookie.indexOf('peerid=') > -1) return;
    response.peerId = Peer.uuid();
    headers.push('Set-Cookie: peerid=' + response.peerId + "; SameSite=Strict; Secure");
  }

  _onMessage(sender, message) {
    try {
      message = JSON.parse(message);
    } catch (e) {
      return;
    }

    switch (message.type) {
      case 'introduce':
        // Set peer's deviceType from client
        sender.name.type = message.name.deviceType;
        // Notify other peers about this peer's updated name
        this._notifyPeersAboutUpdate(sender);
        // Send updated peers list to the sender
        this._sendPeersList(sender);
        break;
      case 'disconnect':
        this._leaveRoom(sender);
        break;
      case 'pong':
        sender.lastBeat = Date.now();
        break;
      default:
        // Relay message to recipient
        if (message.to && this._rooms[sender.ip]) {
          const recipientId = message.to;
          const recipient = this._rooms[sender.ip][recipientId];
          if (!recipient) return;
          delete message.to;
          message.sender = sender.id;
          this._send(recipient, message);
        }
        break;
    }
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
    // Send list of existing peers to the peer
    const peersInRoom = this._rooms[peer.ip];
    const otherPeers = [];
    for (const otherPeerId in peersInRoom) {
      if (otherPeerId !== peer.id) {
        otherPeers.push(peersInRoom[otherPeerId].getInfo());
      }
    }

    this._send(peer, {
      type: 'peers',
      peers: otherPeers
    });
  }

  _joinRoom(peer) {
    if (!this._rooms[peer.ip]) {
      this._rooms[peer.ip] = {};
    }

    // Notify existing peers about the new peer
    for (const otherPeerId in this._rooms[peer.ip]) {
      const otherPeer = this._rooms[peer.ip][otherPeerId];
      if (otherPeer.id !== peer.id) {
        this._send(otherPeer, {
          type: 'peer-joined',
          peer: peer.getInfo()
        });
      }
    }

    // Send list of existing peers to the new peer
    this._sendPeersList(peer);

    // Add the peer to the room
    this._rooms[peer.ip][peer.id] = peer;
  }

  _leaveRoom(peer) {
    if (!this._rooms[peer.ip] || !this._rooms[peer.ip][peer.id]) return;
    this._cancelKeepAlive(this._rooms[peer.ip][peer.id]);

    // Remove the peer from the room
    delete this._rooms[peer.ip][peer.id];

    peer.socket.terminate();

    if (!Object.keys(this._rooms[peer.ip]).length) {
      delete this._rooms[peer.ip];
    } else {
      // Notify other peers that this peer has left
      for (const otherPeerId in this._rooms[peer.ip]) {
        const otherPeer = this._rooms[peer.ip][otherPeerId];
        this._send(otherPeer, { type: 'peer-left', peerId: peer.id });
      }
    }
  }

  _send(peer, message) {
    if (!peer || peer.socket.readyState !== WebSocket.OPEN) return;
    message = JSON.stringify(message);
    peer.socket.send(message, error => { if (error) console.error(error); });
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
    if (this.ip === '::1' || this.ip === '::ffff:127.0.0.1') {
      this.ip = '127.0.0.1';
    }
  }

  _setPeerId(request) {
    if (request.peerId) {
      this.id = request.peerId;
    } else {
      const cookies = request.headers.cookie;
      if (cookies && cookies.indexOf('peerid=') > -1) {
        this.id = cookies.replace(/(?:(?:^|.*;\s*)peerid\s*\=\s*([^;]*).*$)|^.*$/, "$1");
      } else {
        this.id = Peer.uuid();
      }
    }
  }

  _setName(request) {
    let ua = parser(request.headers['user-agent']);

    let deviceName = '';

    if (ua.os && ua.os.name) {
      deviceName = ua.os.name.replace('Mac OS', 'Mac') + ' ';
    }

    if (ua.device.model) {
      deviceName += ua.device.model;
    } else {
      deviceName += ua.browser.name;
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
    let uuid = '',
      ii;
    for (ii = 0; ii < 32; ii += 1) {
      switch (ii) {
        case 8:
        case 20:
          uuid += '-';
          uuid += (Math.random() * 16 | 0).toString(16);
          break;
        case 12:
          uuid += '-';
          uuid += '4';
          break;
        case 16:
          uuid += '-';
          uuid += (Math.random() * 4 | 8).toString(16);
          break;
        default:
          uuid += (Math.random() * 16 | 0).toString(16);
      }
    }
    return uuid;
  }
}

Object.defineProperty(String.prototype, 'hashCode', {
  value: function() {
    var hash = 0, i, chr;
    for (i = 0; i < this.length; i++) {
      chr   = this.charCodeAt(i);
      hash  = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return hash;
  }
});

// Start the server
const port = process.env.PORT || 7865;
server.listen(port, () => {
  console.log('Server is listening on port', port);
  // Initialize the FileDropServer
  new FileDropServer(wss);
});
