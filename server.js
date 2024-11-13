require('dotenv').config(); 
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
const os = require('os');

// Constants for heartbeat
const HEARTBEAT_INTERVAL = 15000; // 15 seconds
const HEARTBEAT_TIMEOUT = 45000;  // 45 seconds

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: [
      'http://localhost:7865',
      'https://drpl.co',
    ],
    methods: ["GET", "POST"],
    credentials: true
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
        'https://drpl.co'
      ],
      styleSrc: [
        "'self'", 
        "'unsafe-inline'", 
        'https://cdnjs.cloudflare.com', 
        'https://cdn.jsdelivr.net',
        'https://drpl.co'
      ],
      imgSrc: [
        "'self'", 
        'data:', 
        'blob:',
        'https://drpl.co'
      ],
      connectSrc: [
        "'self'",
        'ws://localhost:*',
        'ws://127.0.0.1:*',
        'wss://drpl.co',
        'ws://*:*',
        'wss://*:*'
      ],
      fontSrc: [
        "'self'", 
        'https://cdnjs.cloudflare.com', 
        'https://cdn.jsdelivr.net',
        'https://drpl.co'
      ],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"]
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'http://localhost:7865',
      'http://127.0.0.1:7865',
      'https://drpl.co'
    ];

    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }

    return callback(null, true);
  },
  credentials: true
}));

// Store connected peers with network information
const peers = new Map();

// Helper function to get client's real IP
function getClientIP(socket) {
  const forwardedFor = socket.handshake.headers['x-forwarded-for'];
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  return socket.handshake.address.replace('::ffff:', '');
}

// Helper function to get subnet information
function getSubnet(ip) {
  const parts = ip.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

// Helper function to check if IP is private
function isPrivateIP(ip) {
  const parts = ip.split('.').map(Number);
  return (
    (parts[0] === 10) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

// Helper function to notify subnet peers about disconnection
function notifySubnetPeersOfDisconnection(peerId, subnet) {
  const subnetSockets = Array.from(peers.values())
    .filter(p => p.subnet === subnet)
    .map(p => p.socket);

  subnetSockets.forEach(socketId => {
    io.to(socketId).emit('peer-disconnected', peerId);
  });
}

// Clean up stale connections
function cleanupStaleConnections() {
  const now = Date.now();
  for (const [peerId, peer] of peers.entries()) {
    if (now - peer.lastHeartbeat > HEARTBEAT_TIMEOUT) {
      console.log(`Removing stale peer: ${peer.name} (${peerId})`);
      const subnet = peer.subnet;
      peers.delete(peerId);
      
      // Only notify peers on the same subnet
      if (subnet) {
        notifySubnetPeersOfDisconnection(peerId, subnet);
        broadcastPeersToSubnet(subnet);
      }
    }
  }
}

// Broadcast peers only to clients on the same subnet
function broadcastPeersToSubnet(subnet) {
  const subnetPeers = Array.from(peers.values())
    .filter(peer => peer.subnet === subnet)
    .map(peer => ({
      id: peer.id,
      name: peer.name,
      type: peer.type
    }));

  const subnetSockets = Array.from(peers.values())
    .filter(peer => peer.subnet === subnet)
    .map(peer => peer.socket);

  subnetSockets.forEach(socketId => {
    io.to(socketId).emit('peers', subnetPeers);
  });
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  const clientIP = getClientIP(socket);
  const clientSubnet = getSubnet(clientIP);

  // Set up heartbeat for this connection
  const heartbeatInterval = setInterval(() => {
    socket.emit('heartbeat');
  }, HEARTBEAT_INTERVAL);

  // Handle heartbeat response
  socket.on('heartbeat-response', () => {
    for (const [_, peer] of peers.entries()) {
      if (peer.socket === socket.id) {
        peer.lastHeartbeat = Date.now();
      }
    }
  });

  // Register new peer
  socket.on('register', (data) => {
    // Clean up any existing peers with this socket ID
    for (const [peerId, peer] of peers.entries()) {
      if (peer.socket === socket.id) {
        peers.delete(peerId);
      }
    }

    const deviceName = validator.escape(data.deviceName || 'Unknown Device');
    const deviceType = validator.escape(data.deviceType || 'unknown');

    const peerId = uuidv4();
    peers.set(peerId, {
      id: peerId,
      socket: socket.id,
      name: deviceName,
      type: deviceType,
      ip: clientIP,
      subnet: clientSubnet,
      isPrivate: isPrivateIP(clientIP),
      lastHeartbeat: Date.now()
    });

    socket.emit('registered', { peerId });
    broadcastPeersToSubnet(clientSubnet);
  });

  // Handle peer discovery request
  socket.on('discover', () => {
    broadcastPeersToSubnet(clientSubnet);
  });

  // Handle WebRTC signaling
  socket.on('signal', (data) => {
    const { target, signal } = data;
    const targetPeer = peers.get(target);
    const senderPeer = Array.from(peers.values()).find(p => p.socket === socket.id);

    if (targetPeer && senderPeer && targetPeer.subnet === senderPeer.subnet) {
      io.to(targetPeer.socket).emit('signal', {
        peer: senderPeer.id,
        signal
      });
    }
  });

  // Handle file transfer request
  socket.on('file-request', (data) => {
    const { target, files } = data;
    const targetPeer = peers.get(target);
    const senderPeer = Array.from(peers.values()).find(p => p.socket === socket.id);

    if (targetPeer && senderPeer && targetPeer.subnet === senderPeer.subnet) {
      const sanitizedFiles = files.map(file => ({
        name: validator.escape(file.name),
        size: validator.isInt(file.size.toString(), { min: 1 }) ? file.size : 0,
        type: validator.escape(file.type)
      }));

      io.to(targetPeer.socket).emit('file-request', {
        peer: senderPeer.id,
        files: sanitizedFiles
      });
    }
  });

  // Handle file transfer response
  socket.on('file-response', (data) => {
    const { target, accepted } = data;
    const targetPeer = peers.get(target);
    const senderPeer = Array.from(peers.values()).find(p => p.socket === socket.id);

    if (targetPeer && senderPeer && targetPeer.subnet === senderPeer.subnet) {
      io.to(targetPeer.socket).emit('file-response', { accepted });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    clearInterval(heartbeatInterval);
    
    // Remove all peers associated with this socket and notify only their subnets
    const peersToRemove = Array.from(peers.entries())
      .filter(([_, peer]) => peer.socket === socket.id);

    for (const [peerId, peer] of peersToRemove) {
      const subnet = peer.subnet;
      peers.delete(peerId);
      console.log(`Client disconnected: ${peer.name} (${peerId})`);
      
      // Only notify peers on the same subnet
      if (subnet) {
        notifySubnetPeersOfDisconnection(peerId, subnet);
      }
    }

    // Broadcast updates to affected subnets
    const affectedSubnets = new Set(peersToRemove.map(([_, peer]) => peer.subnet));
    affectedSubnets.forEach(subnet => {
      broadcastPeersToSubnet(subnet);
    });
  });
});

// Start cleanup interval
setInterval(cleanupStaleConnections, HEARTBEAT_INTERVAL);

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
const PORT = process.env.PORT || 7865;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});