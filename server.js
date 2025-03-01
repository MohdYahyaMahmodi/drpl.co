const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const parser = require('ua-parser-js');
const { uniqueNamesGenerator, colors, animals } = require('unique-names-generator');

// Create the Express app
const app = express();

// Serve static files from the current directory
app.use(express.static('.'));

// Create HTTP server
const server = http.createServer(app);

class DrplServer {
    constructor(server) {
        this._wss = new WebSocket.Server({ server: server });
        this._wss.on('connection', (socket, request) => this._onConnection(new Peer(socket, request)));
        this._wss.on('headers', (headers, response) => this._onHeaders(headers, response));

        this._rooms = {};
        console.log('drpl.co WebSocket server is running');
    }

    _onConnection(peer) {
        this._joinRoom(peer);
        peer.socket.on('message', message => this._onMessage(peer, message));
        peer.socket.on('error', console.error);
        peer.socket.on('close', () => this._leaveRoom(peer));
        this._keepAlive(peer);

        // send displayName
        this._send(peer, {
            type: 'display-name',
            message: {
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
        // Try to parse message 
        try {
            message = JSON.parse(message);
        } catch (e) {
            return; // Ignore malformed JSON
        }

        switch (message.type) {
            case 'disconnect':
                this._leaveRoom(sender);
                break;
            case 'pong':
                sender.lastBeat = Date.now();
                break;
        }

        // relay message to recipient
        if (message.to && this._rooms[sender.ip]) {
            const recipientId = message.to;
            const recipient = this._rooms[sender.ip][recipientId];
            if (!recipient) return; // Recipient not found
            
            delete message.to;
            // add sender id
            message.sender = sender.id;
            this._send(recipient, message);
        }
    }

    _joinRoom(peer) {
        // if room doesn't exist, create it
        if (!this._rooms[peer.ip]) {
            this._rooms[peer.ip] = {};
        }

        // notify all other peers
        for (const otherPeerId in this._rooms[peer.ip]) {
            const otherPeer = this._rooms[peer.ip][otherPeerId];
            this._send(otherPeer, {
                type: 'peer-joined',
                peer: peer.getInfo()
            });
        }

        // notify peer about the other peers
        const otherPeers = [];
        for (const otherPeerId in this._rooms[peer.ip]) {
            otherPeers.push(this._rooms[peer.ip][otherPeerId].getInfo());
        }

        this._send(peer, {
            type: 'peers',
            peers: otherPeers
        });

        // add peer to room
        this._rooms[peer.ip][peer.id] = peer;
    }

    _leaveRoom(peer) {
        if (!this._rooms[peer.ip] || !this._rooms[peer.ip][peer.id]) return;
        this._cancelKeepAlive(this._rooms[peer.ip][peer.id]);

        // delete the peer
        delete this._rooms[peer.ip][peer.id];

        //if room is empty, delete the room
        if (!Object.keys(this._rooms[peer.ip]).length) {
            delete this._rooms[peer.ip];
        } else {
            // notify all other peers
            for (const otherPeerId in this._rooms[peer.ip]) {
                const otherPeer = this._rooms[peer.ip][otherPeerId];
                this._send(otherPeer, { type: 'peer-left', peerId: peer.id });
            }
        }
    }

    _send(peer, message) {
        if (!peer || !peer.socket) return;
        if (peer.socket.readyState !== WebSocket.OPEN) return;
        
        try {
            peer.socket.send(JSON.stringify(message));
        } catch (e) {
            console.error('Send error:', e);
        }
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
        // set socket
        this.socket = socket;

        // set remote ip
        this._setIP(request);

        // set peer id
        this._setPeerId(request);
        
        // is WebRTC supported?
        this.rtcSupported = request.url.indexOf('webrtc') > -1;
        
        // set name 
        this._setName(request);
        
        // for keepalive
        this.timerId = 0;
        this.lastBeat = Date.now();
    }

    _setIP(request) {
        if (request.headers['x-forwarded-for']) {
            this.ip = request.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
        } else {
            this.ip = request.socket.remoteAddress;
        }
        // IPv4 and IPv6 use different values to refer to localhost
        if (this.ip == '::1' || this.ip == '::ffff:127.0.0.1') {
            this.ip = '127.0.0.1';
        }
    }

    _setPeerId(request) {
        if (request.peerId) {
            this.id = request.peerId;
        } else if (request.headers.cookie && request.headers.cookie.includes('peerid=')) {
            this.id = request.headers.cookie.split('peerid=')[1].split(';')[0];
        } else {
            this.id = Peer.uuid();
        }
    }

    _setName(req) {
        let ua = parser(req.headers['user-agent']);
        
        let deviceName = '';
        
        if (ua.os && ua.os.name) {
            deviceName = ua.os.name.replace('Mac OS', 'Mac') + ' ';
        }
        
        if (ua.device.model) {
            deviceName += ua.device.model;
        } else {
            deviceName += ua.browser.name;
        }

        if(!deviceName)
            deviceName = 'Unknown Device';

        const displayName = uniqueNamesGenerator({
            length: 2,
            separator: ' ',
            dictionaries: [colors, animals],
            style: 'capital',
            seed: this.id.hashCode()
        });

        this.name = {
            model: ua.device.model,
            os: ua.os.name,
            browser: ua.browser.name,
            type: ua.device.type,
            deviceName,
            displayName
        };
    }

    getInfo() {
        return {
            id: this.id,
            name: this.name,
            rtcSupported: this.rtcSupported
        }
    }

    // Generate UUID of form xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    static uuid() {
        let uuid = '';
        for (let i = 0; i < 32; i++) {
            switch (i) {
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

// Add hashCode method to String prototype for name generation
String.prototype.hashCode = function() {
    let hash = 0;
    for (let i = 0; i < this.length; i++) {
        const chr = this.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};

// Start the server
const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    new DrplServer(server);
});