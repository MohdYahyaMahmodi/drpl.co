/* 
  drpl.co Node.js server
  Based on Snapdrop (GNU GPLv3) 
*/

const WebSocket = require('ws');
const parser = require('ua-parser-js');
const { uniqueNamesGenerator, animals, colors } = require('unique-names-generator');

const port = process.env.PORT || 3002;

// Graceful shutdown
process.on('SIGINT', () => {
  console.info("SIGINT Received, shutting down...");
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.info("SIGTERM Received, shutting down...");
  process.exit(0);
});

////////////////////////////////////////////////////////////////////////////////
// PEER CLASS
////////////////////////////////////////////////////////////////////////////////

class Peer {
  constructor(socket, request) {
    this.socket = socket;
    this._setIP(request);
    this._setPeerId(request);

    // Determine if WebRTC is supported or not, based on the URL path
    // e.g. /server/webrtc or /server/fallback
    this.rtcSupported = request.url.includes('webrtc');
    this._setName(request);

    this.timerId = 0;
    this.lastBeat = Date.now();
  }

  _setIP(request) {
    if (request.headers['x-forwarded-for']) {
      this.ip = request.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
    } else {
      this.ip = request.connection.remoteAddress;
    }
    // unify localhost references
    if (this.ip === '::1' || this.ip === '::ffff:127.0.0.1') {
      this.ip = '127.0.0.1';
    }
  }

  _setPeerId(request) {
    if (request.peerId) {
      // If set by server in 'headers' event
      this.id = request.peerId;
    } else {
      // Otherwise parse from cookie
      const cookieHeader = request.headers.cookie || '';
      const match = cookieHeader.match(/peerid=([^;]+)/);
      this.id = match ? match[1] : Peer.uuid();
    }
  }

  _setName(request) {
    const ua = parser(request.headers['user-agent'] || '');
    let deviceName = '';

    if (ua.os && ua.os.name) {
      deviceName = ua.os.name.replace('Mac OS', 'Mac') + ' ';
    }
    if (ua.device.model) {
      deviceName += ua.device.model;
    } else if (ua.browser.name) {
      deviceName += ua.browser.name;
    }

    if (!deviceName) {
      deviceName = 'Unknown Device';
    }

    // Generate a stable random name based on peer's ID
    const displayName = uniqueNamesGenerator({
      length: 2,
      separator: ' ',
      dictionaries: [colors, animals],
      style: 'capital',
      seed: this.id.hashCode()
    });

    this.name = {
      deviceName,
      displayName,
      device: {
        type: ua.device.type || 'desktop',
        model: ua.device.model || '',
        os: ua.os.name || '',
        browser: ua.browser.name || ''
      }
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
    // return uuid of form xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    let uuid = '', ii;
    for (ii = 0; ii < 32; ii += 1) {
      switch (ii) {
        case 8:
        case 20:
          uuid += '-';
          uuid += (Math.random() * 16 | 0).toString(16);
          break;
        case 12:
          uuid += '-4';
          break;
        case 16:
          uuid += '-' + ((Math.random() * 4 | 8).toString(16));
          break;
        default:
          uuid += (Math.random() * 16 | 0).toString(16);
      }
    }
    return uuid;
  }
}

// For stable name generation
Object.defineProperty(String.prototype, 'hashCode', {
  value: function () {
    let hash = 0, i, chr;
    for (i = 0; i < this.length; i++) {
      chr = this.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit int
    }
    return hash;
  }
});

////////////////////////////////////////////////////////////////////////////////
// DRPL SERVER CLASS
////////////////////////////////////////////////////////////////////////////////

class DrplServer {
  constructor(port) {
    this._wss = new WebSocket.Server({ port });
    this._rooms = {}; // each room is keyed by IP, containing a map of peerId => Peer

    // Connection
    this._wss.on('connection', (socket, request) => this._onConnection(new Peer(socket, request)));

    // Called right before the connection is established to set cookies
    this._wss.on('headers', (headers, response) => this._onHeaders(headers, response));

    console.log('drpl.co server running on port', port);
  }

  _onHeaders(headers, response) {
    // We only set peerId if we haven't yet
    if (!response.headers.cookie || !response.headers.cookie.includes('peerid=')) {
      const newPeerId = Peer.uuid();
      headers.push('Set-Cookie: peerid=' + newPeerId + '; SameSite=Strict; Secure');
      response.peerId = newPeerId;
    }
  }

  _onConnection(peer) {
    this._joinRoom(peer);

    // Handle inbound messages
    peer.socket.on('message', (data) => this._onMessage(peer, data));
    peer.socket.on('close', () => this._leaveRoom(peer));
    peer.socket.on('error', () => this._leaveRoom(peer));

    // "display-name" is sent so the client knows what name the server assigned
    this._send(peer, {
      type: 'display-name',
      message: {
        displayName: peer.name.displayName,
        deviceName: peer.name.deviceName
      }
    });

    this._keepAlive(peer);
  }

  _onMessage(sender, msg) {
    let message;
    try {
      message = JSON.parse(msg);
    } catch {
      // ignore malformed JSON
      return;
    }

    switch (message.type) {
      case 'disconnect':
        this._leaveRoom(sender);
        return;
      case 'pong':
        sender.lastBeat = Date.now();
        return;
      default:
        // Relay to recipient if .to is present
        if (message.to && this._rooms[sender.ip]) {
          const recipient = this._rooms[sender.ip][message.to];
          if (!recipient) return;
          delete message.to;
          message.sender = sender.id;
          this._send(recipient, message);
        }
        break;
    }
  }

  _joinRoom(peer) {
    if (!this._rooms[peer.ip]) {
      this._rooms[peer.ip] = {};
    }

    // Let existing peers know someone new joined
    Object.values(this._rooms[peer.ip]).forEach(otherPeer => {
      this._send(otherPeer, {
        type: 'peer-joined',
        peer: peer.getInfo()
      });
    });

    // Send the newcomer a list of all existing peers
    const otherPeers = Object.values(this._rooms[peer.ip]).map(p => p.getInfo());
    this._send(peer, {
      type: 'peers',
      peers: otherPeers
    });

    // Add the new peer
    this._rooms[peer.ip][peer.id] = peer;
  }

  _leaveRoom(peer) {
    const room = this._rooms[peer.ip];
    if (!room || !room[peer.id]) return;

    this._cancelKeepAlive(peer);

    // Remove this peer from the room
    delete room[peer.id];
    peer.socket.terminate();

    // If room is now empty, remove it
    if (!Object.keys(room).length) {
      delete this._rooms[peer.ip];
    } else {
      // Notify other peers
      Object.values(room).forEach(otherPeer => {
        this._send(otherPeer, {
          type: 'peer-left',
          peerId: peer.id
        });
      });
    }
  }

  _send(peer, message) {
    if (!peer) return;
    if (peer.socket.readyState !== WebSocket.OPEN) return;
    peer.socket.send(JSON.stringify(message), () => {});
  }

  // Ping/pong keepalive
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

// Start server
new DrplServer(port);
