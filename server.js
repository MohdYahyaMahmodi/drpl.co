require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Store connected peers
const peers = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Register new peer
    socket.on('register', (data) => {
        const peerId = uuidv4();
        peers.set(peerId, {
            id: peerId,
            socket: socket.id,
            name: data.deviceName,
            type: data.deviceType
        });

        socket.emit('registered', { peerId });
        broadcastPeers();
    });

    // Handle peer discovery request
    socket.on('discover', () => {
        const peerList = Array.from(peers.values()).map(peer => ({
            id: peer.id,
            name: peer.name,
            type: peer.type
        }));
        socket.emit('peers', peerList);
    });

    // Handle WebRTC signaling
    socket.on('signal', (data) => {
        const { target, signal } = data;
        const targetPeer = Array.from(peers.values())
            .find(peer => peer.id === target);

        if (targetPeer) {
            io.to(targetPeer.socket).emit('signal', {
                peer: Array.from(peers.values())
                    .find(p => p.socket === socket.id)?.id,
                signal
            });
        }
    });

    // Handle file transfer request
    socket.on('file-request', (data) => {
        const { target, files } = data;
        const targetPeer = Array.from(peers.values())
            .find(peer => peer.id === target);

        if (targetPeer) {
            io.to(targetPeer.socket).emit('file-request', {
                peer: Array.from(peers.values())
                    .find(p => p.socket === socket.id)?.id,
                files
            });
        }
    });

    // Handle file transfer response
    socket.on('file-response', (data) => {
        const { target, accepted } = data;
        const targetPeer = Array.from(peers.values())
            .find(peer => peer.id === target);

        if (targetPeer) {
            io.to(targetPeer.socket).emit('file-response', { accepted });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        const peerId = Array.from(peers.entries())
            .find(([_, peer]) => peer.socket === socket.id)?.[0];
        
        if (peerId) {
            peers.delete(peerId);
            broadcastPeers();
        }
        console.log('Client disconnected:', socket.id);
    });
});

// Broadcast updated peer list to all connected clients
function broadcastPeers() {
    const peerList = Array.from(peers.values()).map(peer => ({
        id: peer.id,
        name: peer.name,
        type: peer.type
    }));
    io.emit('peers', peerList);
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
