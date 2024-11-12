require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: [
      'http://localhost:7865',
      'https://drpl.co',
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(helmet());
app.use(express.static('public'));

const peers = new Map();

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('register', (data) => {
    const deviceName = validator.escape(data.deviceName || 'Device');
    const deviceType = validator.escape(data.deviceType || 'unknown');

    const peerId = uuidv4();
    peers.set(peerId, { id: peerId, socketId: socket.id, name: deviceName, type: deviceType });

    socket.emit('registered', { peerId });
    broadcastPeers();
  });

  socket.on('discover', () => {
    const peerList = Array.from(peers.values()).map(({ id, name, type }) => ({ id, name, type }));
    socket.emit('peers', peerList);
  });

  socket.on('signal', (data) => {
    const { target, signal } = data;
    const targetPeer = peers.get(target);
    if (targetPeer) {
      io.to(targetPeer.socketId).emit('signal', { peer: target, signal });
    }
  });

  socket.on('file-request', (data) => {
    const { target, files } = data;
    const targetPeer = peers.get(target);
    if (targetPeer) {
      io.to(targetPeer.socketId).emit('file-request', { peerId: socket.id, files });
    }
  });

  socket.on('file-response', (data) => {
    const { target, accepted } = data;
    const targetPeer = peers.get(target);
    if (targetPeer) {
      io.to(targetPeer.socketId).emit('file-response', { accepted });
    }
  });

  socket.on('disconnect', () => {
    const peerId = Array.from(peers.keys()).find((key) => peers.get(key).socketId === socket.id);
    if (peerId) peers.delete(peerId);
    broadcastPeers();
    console.log(`Client disconnected: ${socket.id}`);
  });
});

function broadcastPeers() {
  const peerList = Array.from(peers.values()).map(({ id, name, type }) => ({ id, name, type }));
  io.emit('peers', peerList);
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(process.env.PORT || 7865, () => {
  console.log(`Server running on port ${process.env.PORT || 7865}`);
});
