/**
 * drpl.co - Server Javascript
 * WebSocket signaling server for peer-to-peer file sharing
 */

// Core dependencies
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const parser = require('ua-parser-js');
const { uniqueNamesGenerator, colors, animals } = require('unique-names-generator');

// ======================================================================
// STRING EXTENSIONS
// ======================================================================

/**
 * Generate a hash code from a string (used for name generation)
 * @returns {number} - Hash code
 */
String.prototype.hashCode = function() {
    let hash = 0;
    for (let i = 0; i < this.length; i++) {
        const chr = this.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};

// ======================================================================
// PEER CLASS
// ======================================================================

/**
 * Peer - Represents a connected client
 */
class Peer {
    /**
     * Initialize a new peer
     * @param {WebSocket} socket - The WebSocket connection
     * @param {Object} request - The HTTP request
     */
    constructor(socket, request) {
        // Set WebSocket connection
        this.socket = socket;

        // Extract client IP address
        this._setIP(request);

        // Set unique peer identifier
        this._setPeerId(request);
        
        // Check WebRTC support based on connection URL
        this.rtcSupported = request.url.indexOf('webrtc') > -1;
        
        // Generate display name
        this._setName(request);
        
        // Initialize keepalive tracking
        this.timerId = 0;
        this.lastBeat = Date.now();
    }

    /**
     * Extract and normalize client IP address
     * @param {Object} request - HTTP request
     * @private
     */
    _setIP(request) {
        // Check for proxy forwarded IP
        if (request.headers['x-forwarded-for']) {
            this.ip = request.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
        } else {
            this.ip = request.socket.remoteAddress;
        }
        
        // Normalize localhost addresses
        if (this.ip == '::1' || this.ip == '::ffff:127.0.0.1') {
            this.ip = '127.0.0.1';
        }
    }

    /**
     * Set peer ID from cookie or generate new one
     * @param {Object} request - HTTP request
     * @private
     */
    _setPeerId(request) {
        if (request.peerId) {
            // ID was set in headers
            this.id = request.peerId;
        } else if (request.headers.cookie && request.headers.cookie.includes('peerid=')) {
            // Extract ID from cookie
            this.id = request.headers.cookie.split('peerid=')[1].split(';')[0];
        } else {
            // Generate new ID
            this.id = Peer.uuid();
        }
    }

    /**
     * Generate peer name based on user agent
     * @param {Object} req - HTTP request
     * @private
     */
    _setName(req) {
        // Parse user agent string
        let ua = parser(req.headers['user-agent']);
        
        // Generate device name from OS and browser/device info
        let deviceName = '';
        
        if (ua.os && ua.os.name) {
            deviceName = ua.os.name.replace('Mac OS', 'Mac') + ' ';
        }
        
        if (ua.device.model) {
            deviceName += ua.device.model;
        } else {
            deviceName += ua.browser.name;
        }

        if(!deviceName) {
            deviceName = 'Unknown Device';
        }

        // Generate consistent display name based on peer ID
        const displayName = uniqueNamesGenerator({
            length: 2,
            separator: ' ',
            dictionaries: [colors, animals],
            style: 'capital',
            seed: this.id.hashCode()
        });

        // Store all name-related information
        this.name = {
            model: ua.device.model,
            os: ua.os.name,
            browser: ua.browser.name,
            type: ua.device.type,
            deviceName,
            displayName
        };
    }

    /**
     * Get peer information for sharing with other peers
     * @returns {Object} - Peer information
     */
    getInfo() {
        return {
            id: this.id,
            name: this.name,
            rtcSupported: this.rtcSupported
        };
    }

    /**
     * Generate a UUID v4
     * @returns {string} - UUID string
     */
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

// ======================================================================
// SERVER CLASS
// ======================================================================

/**
 * DrplServer - Manages WebSocket connections and peer-to-peer signaling
 */
class DrplServer {
    /**
     * Initialize the server
     * @param {http.Server} server - HTTP server instance
     */
    constructor(server) {
        // Create WebSocket server
        this._wss = new WebSocket.Server({ server: server });
        
        // Set up event handlers
        this._wss.on('connection', (socket, request) => 
            this._onConnection(new Peer(socket, request)));
        this._wss.on('headers', (headers, response) => 
            this._onHeaders(headers, response));

        // Initialize rooms storage (grouped by IP)
        this._rooms = {};
        
        console.log('drpl.co WebSocket server is running');
    }

    /**
     * Handle new WebSocket connection
     * @param {Peer} peer - New peer
     * @private
     */
    _onConnection(peer) {
        // Add peer to appropriate room
        this._joinRoom(peer);
        
        // Set up event listeners
        peer.socket.on('message', message => this._onMessage(peer, message));
        peer.socket.on('error', console.error);
        peer.socket.on('close', () => this._leaveRoom(peer));
        
        // Start keepalive process
        this._keepAlive(peer);

        // Send display name to the peer
        this._send(peer, {
            type: 'display-name',
            message: {
                displayName: peer.name.displayName,
                deviceName: peer.name.deviceName
            }
        });
    }

    /**
     * Handle HTTP headers before WebSocket upgrade
     * @param {Array} headers - HTTP headers
     * @param {Object} response - HTTP response
     * @private
     */
    _onHeaders(headers, response) {
        // Skip if peer ID already exists in cookie
        if (response.headers.cookie && response.headers.cookie.indexOf('peerid=') > -1) {
            return;
        }
        
        // Generate and set new peer ID
        response.peerId = Peer.uuid();
        headers.push('Set-Cookie: peerid=' + response.peerId + "; SameSite=Strict; Secure");
    }

    /**
     * Process WebSocket messages
     * @param {Peer} sender - Sending peer
     * @param {string|Buffer} message - Message data
     * @private
     */
    _onMessage(sender, message) {
        // Try to parse message as JSON
        try {
            message = JSON.parse(message);
        } catch (e) {
            return; // Ignore malformed JSON
        }

        // Handle message based on type
        switch (message.type) {
            case 'disconnect':
                this._leaveRoom(sender);
                break;
            case 'pong':
                sender.lastBeat = Date.now();
                break;
        }

        // Relay message to recipient if specified
        if (message.to && this._rooms[sender.ip]) {
            const recipientId = message.to;
            const recipient = this._rooms[sender.ip][recipientId];
            
            if (!recipient) return; // Recipient not found
            
            // Modify message before forwarding
            delete message.to;
            message.sender = sender.id;
            
            // Send to recipient
            this._send(recipient, message);
        }
    }

    /**
     * Add a peer to its IP-based room
     * @param {Peer} peer - Peer to add
     * @private
     */
    _joinRoom(peer) {
        // If room doesn't exist, create it
        if (!this._rooms[peer.ip]) {
            this._rooms[peer.ip] = {};
        }

        // Notify all existing peers in the room
        for (const otherPeerId in this._rooms[peer.ip]) {
            const otherPeer = this._rooms[peer.ip][otherPeerId];
            this._send(otherPeer, {
                type: 'peer-joined',
                peer: peer.getInfo()
            });
        }

        // Collect information about existing peers
        const otherPeers = [];
        for (const otherPeerId in this._rooms[peer.ip]) {
            otherPeers.push(this._rooms[peer.ip][otherPeerId].getInfo());
        }

        // Notify new peer about existing peers
        this._send(peer, {
            type: 'peers',
            peers: otherPeers
        });

        // Add peer to room
        this._rooms[peer.ip][peer.id] = peer;
    }

    /**
     * Remove a peer from its room
     * @param {Peer} peer - Peer to remove
     * @private
     */
    _leaveRoom(peer) {
        // Check if peer exists in a room
        if (!this._rooms[peer.ip] || !this._rooms[peer.ip][peer.id]) {
            return;
        }
        
        // Cancel keepalive timer
        this._cancelKeepAlive(this._rooms[peer.ip][peer.id]);

        // Delete the peer
        delete this._rooms[peer.ip][peer.id];

        // If room is empty, delete it
        if (!Object.keys(this._rooms[peer.ip]).length) {
            delete this._rooms[peer.ip];
        } else {
            // Notify all remaining peers
            for (const otherPeerId in this._rooms[peer.ip]) {
                const otherPeer = this._rooms[peer.ip][otherPeerId];
                this._send(otherPeer, { 
                    type: 'peer-left', 
                    peerId: peer.id 
                });
            }
        }
    }

    /**
     * Send a message to a peer
     * @param {Peer} peer - Target peer
     * @param {Object} message - Message to send
     * @private
     */
    _send(peer, message) {
        // Validate peer and socket
        if (!peer || !peer.socket) return;
        if (peer.socket.readyState !== WebSocket.OPEN) return;
        
        // Send message as JSON
        try {
            peer.socket.send(JSON.stringify(message));
        } catch (e) {
            console.error('Send error:', e);
        }
    }

    /**
     * Maintain connection with periodic pings
     * @param {Peer} peer - Peer to keep alive
     * @private
     */
    _keepAlive(peer) {
        // Clear any existing timer
        this._cancelKeepAlive(peer);
        
        const timeout = 30000; // 30 seconds
        
        // Initialize lastBeat if not set
        if (!peer.lastBeat) {
            peer.lastBeat = Date.now();
        }
        
        // Check if peer has timed out (missed two pings)
        if (Date.now() - peer.lastBeat > 2 * timeout) {
            this._leaveRoom(peer);
            return;
        }

        // Send ping and schedule next check
        this._send(peer, { type: 'ping' });
        peer.timerId = setTimeout(() => this._keepAlive(peer), timeout);
    }

    /**
     * Cancel keepalive timer
     * @param {Peer} peer - Peer to cancel timer for
     * @private
     */
    _cancelKeepAlive(peer) {
        if (peer && peer.timerId) {
            clearTimeout(peer.timerId);
        }
    }
}

// ======================================================================
// SERVER INITIALIZATION
// ======================================================================

// Create the Express app
const app = express();

// Serve static files from the current directory
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = http.createServer(app);

// Set port from environment or default
const PORT = process.env.PORT || 3002;

// Start the server
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    new DrplServer(server);
});