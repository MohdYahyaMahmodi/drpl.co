require('dotenv').config(); 
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://192.168.12.163:3000', // Your local IP address
      'https://drop.co' // Added production domain
    ],
    methods: ["GET", "POST"],
    credentials: true // If you need to send cookies or other credentials
  }
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Use Helmet to set security-related HTTP headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'", 
        'https://cdnjs.cloudflare.com', 
        'https://cdn.tailwindcss.com', 
        'https://cdn.jsdelivr.net',
        'https://drop.co' // Allow scripts from your domain
      ],
      styleSrc: [
        "'self'", 
        "'unsafe-inline'", 
        'https://cdnjs.cloudflare.com', 
        'https://cdn.jsdelivr.net',
        'https://drop.co' // Allow styles from your domain
      ],
      imgSrc: [
        "'self'", 
        'data:', 
        'blob:',
        'https://drop.co' // Allow images from your domain
      ],
      connectSrc: [
        "'self'",
        'ws://localhost:*',
        'ws://127.0.0.1:*',
        'ws://192.168.12.163:*', // Your local IP with ws protocol
        'wss://drop.co' // Allow WebSocket connections from your domain
      ],
      fontSrc: [
        "'self'", 
        'https://cdnjs.cloudflare.com', 
        'https://cdn.jsdelivr.net',
        'https://drop.co' // Allow fonts from your domain
      ],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"]
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://192.168.12.163:3000', // Your local IP address
      'https://drop.co' // Added production domain
    ];

    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }

    return callback(null, true);
  },
  credentials: true // If you need to send cookies or other credentials
}));

// Store connected peers
const peers = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Register new peer
  socket.on('register', (data) => {
    // Validate and sanitize inputs
    const deviceName = validator.escape(data.deviceName || 'Unknown Device');
    const deviceType = validator.escape(data.deviceType || 'unknown');

    const peerId = uuidv4();
    peers.set(peerId, {
      id: peerId,
      socket: socket.id,
      name: deviceName,
      type: deviceType
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
    const targetPeer = peers.get(target);

    if (targetPeer) {
      const senderPeer = Array.from(peers.values()).find(p => p.socket === socket.id);
      io.to(targetPeer.socket).emit('signal', {
        peer: senderPeer?.id,
        signal
      });
    }
  });

  // Handle file transfer request
  socket.on('file-request', (data) => {
    const { target, files } = data;
    const targetPeer = peers.get(target);

    if (targetPeer) {
      const senderPeer = Array.from(peers.values()).find(p => p.socket === socket.id);

      // Validate and sanitize file metadata
      const sanitizedFiles = files.map(file => ({
        name: validator.escape(file.name),
        size: validator.isInt(file.size.toString(), { min: 1 }) ? file.size : 0,
        type: validator.escape(file.type)
      }));

      io.to(targetPeer.socket).emit('file-request', {
        peer: senderPeer?.id,
        files: sanitizedFiles
      });
    }
  });

  // Handle file transfer response
  socket.on('file-response', (data) => {
    const { target, accepted } = data;
    const targetPeer = peers.get(target);

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
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
