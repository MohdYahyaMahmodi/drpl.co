require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store connected peers
const peers = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('register', (data) => {
        const peerId = uuidv4();
        peers.set(peerId, {
            id: peerId,
            socketId: socket.id,
            name: data.deviceName,
            type: data.deviceType
        });

        socket.emit('registered', { peerId });
        broadcastPeers();
    });

    socket.on('discover', () => {
        broadcastPeers();
    });

    socket.on('signal', ({ target, signal }) => {
        const targetPeer = getPeerById(target);
        if (targetPeer) {
            io.to(targetPeer.socketId).emit('signal', {
                peerId: getPeerIdBySocketId(socket.id),
                signal
            });
        }
    });

    socket.on('file-request', (data) => {
        const targetPeer = getPeerById(data.target);
        if (targetPeer) {
            io.to(targetPeer.socketId).emit('file-request', {
                peerId: getPeerIdBySocketId(socket.id),
                files: data.files
            });
        }
    });

    socket.on('file-response', (data) => {
        const targetPeer = getPeerById(data.target);
        if (targetPeer) {
            io.to(targetPeer.socketId).emit('file-response', {
                accepted: data.accepted
            });
        }
    });

    socket.on('disconnect', () => {
        const peerId = getPeerIdBySocketId(socket.id);
        if (peerId) {
            peers.delete(peerId);
            broadcastPeers();
        }
        console.log(`Client disconnected: ${socket.id}`);
    });
});

// Helper functions
function broadcastPeers() {
    const peerList = Array.from(peers.values()).map(peer => ({
        id: peer.id,
        name: peer.name,
        type: peer.type
    }));
    io.emit('peers', peerList);
}

function getPeerById(peerId) {
    return peers.get(peerId);
}

function getPeerIdBySocketId(socketId) {
    for (let [peerId, peer] of peers.entries()) {
        if (peer.socketId === socketId) {
            return peerId;
        }
    }
    return null;
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
