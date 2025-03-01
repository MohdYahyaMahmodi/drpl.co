/**
 * Drpl.co Server
 * Handles WebSocket connections, peer discovery, and signaling for WebRTC
 * 
 * Improvements:
 * - Enhanced error handling and logging
 * - Better WebSocket connection management
 * - More efficient peer tracking and room management
 * - Improved reconnection handling
 * - Better security with rate limiting and validation
 */

import process from 'process';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import parser from 'ua-parser-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Word lists for generating random display names
const adjectivesList = [
  'Red', 'Blue', 'Green', 'Purple', 'Golden', 'Silver',
  'Crystal', 'Cosmic', 'Electric', 'Mystic', 'Shadow', 'Radiant',
  'Midnight', 'Solar', 'Lunar', 'Cobalt', 'Verdant', 'Scarlet',
  'Azure', 'Thunder', 'Crimson', 'Sapphire', 'Emerald', 'Amber',
  'Onyx', 'Ruby', 'Jade', 'Obsidian', 'Ivory', 'Platinum'
];

const nounsList = [
  'Wolf', 'Eagle', 'Lion', 'Phoenix', 'Dragon', 'Tiger',
  'Falcon', 'Panther', 'Hawk', 'Bear', 'Serpent', 'Leopard',
  'Raven', 'Shark', 'Cheetah', 'Pegasus', 'Minotaur', 'Orca',
  'Griffin', 'Octopus', 'Dolphin', 'Lynx', 'Jaguar', 'Fox',
  'Rhino', 'Puma', 'Gazelle', 'Coyote', 'Cobra', 'Falcon'
];

// Logger
class Logger {
  static get levels() {
    return {
      ERROR: 0,
      WARN: 1,
      INFO: 2,
      DEBUG: 3
    };
  }

  constructor(level = Logger.levels.INFO) {
    this.level = level;
  }

  setLevel(level) {
    this.level = level;
  }

  getTimestamp() {
    return new Date().toISOString();
  }

  error(message, ...args) {
    if (this.level >= Logger.levels.ERROR) {
      console.error(`[${this.getTimestamp()}] ERROR: ${message}`, ...args);
    }
  }

  warn(message, ...args) {
    if (this.level >= Logger.levels.WARN) {
      console.warn(`[${this.getTimestamp()}] WARN: ${message}`, ...args);
    }
  }

  info(message, ...args) {
    if (this.level >= Logger.levels.INFO) {
      console.info(`[${this.getTimestamp()}] INFO: ${message}`, ...args);
    }
  }

  debug(message, ...args) {
    if (this.level >= Logger.levels.DEBUG) {
      console.debug(`[${this.getTimestamp()}] DEBUG: ${message}`, ...args);
    }
  }
}

// Global logger instance
const logger = new Logger(
  process.env.NODE_ENV === 'production' ? Logger.levels.INFO : Logger.levels.DEBUG
);

// Server configuration
const CONFIG = {
  port: process.env.PORT || 3002,
  pingInterval: 30000, // 30 seconds
  peerExpiryTime: 120000, // 2 minutes
  maxPeersPerIP: 10,
  maxMessageSize: 10 * 1024, // 10KB max message size
  rateLimitRequests: 100,
  rateLimitWindow: 60000, // 1 minute
  allowedOrigins: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : ['*']
};

// Extend String prototype for hashing
Object.defineProperty(String.prototype, 'hashCode', {
  value: function() {
    let hash = 0;
    for (let i = 0; i < this.length; i++) {
      const chr = this.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0; // Convert to 32-bit int
    }
    return hash;
  }
});

// Generate a display name from ID
function getDisplayName(id) {
  // Use hash of ID to deterministically select adjective and noun
  const hash1 = Math.abs((id + 'adjective').hashCode());
  const hash2 = Math.abs((id + 'noun').hashCode());
  
  const adjective = adjectivesList[hash1 % adjectivesList.length];
  const noun = nounsList[hash2 % nounsList.length];
  
  return `${adjective} ${noun}`;
}

// Validate input to prevent XSS, injection, etc.
function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return input;
  }
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Basic rate limiter
class RateLimiter {
  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.clients = new Map(); // IP -> { count, resetTime }
  }
  
  check(ip) {
    const now = Date.now();
    
    if (!this.clients.has(ip)) {
      this.clients.set(ip, { 
        count: 1,
        resetTime: now + this.windowMs
      });
      return true;
    }
    
    const client = this.clients.get(ip);
    
    if (now > client.resetTime) {
      // Reset counter for new window
      client.count = 1;
      client.resetTime = now + this.windowMs;
      return true;
    }
    
    if (client.count >= this.maxRequests) {
      return false; // Rate limit exceeded
    }
    
    // Increment counter
    client.count++;
    return true;
  }
  
  // Clean up old entries
  cleanup() {
    const now = Date.now();
    for (const [ip, client] of this.clients.entries()) {
      if (now > client.resetTime) {
        this.clients.delete(ip);
      }
    }
  }
}

// Peer class
class Peer {
  constructor(socket, request) {
    this.socket = socket;
    this.id = null;
    this.ip = null;
    this.name = {};
    this.lastActivity = Date.now();
    this.isAlive = true;
    
    this._setIP(request);
    this._setPeerId(request);
    this._setName(request);
    
    this.pingInterval = null;
  }
  
  _setIP(request) {
    if (request.headers['x-forwarded-for']) {
      this.ip = request.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
    } else {
      this.ip = request.socket.remoteAddress;
    }
    
    // Normalize localhost addresses
    if (this.ip === '::1' || this.ip === '::ffff:127.0.0.1') {
      this.ip = '127.0.0.1';
    }
  }
  
  _setPeerId(request) {
    if (request.peerId) {
      this.id = request.peerId;
    } else {
      const cookies = request.headers.cookie || '';
      const match = cookies.match(/peerid=([^;]+)/);
      this.id = match ? match[1] : Peer.generateUUID();
    }
  }
  
  _setName(request) {
    try {
      const ua = parser(request.headers['user-agent']);
      
      // Build device name
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
      
      // Generate display name from peer ID
      const displayName = getDisplayName(this.id);
      
      // Set name properties
      this.name = {
        model: ua.device.model || '',
        os: ua.os.name || '',
        browser: ua.browser.name || '',
        type: ua.device.type || 'desktop',
        deviceName,
        displayName
      };
    } catch (error) {
      logger.warn('Error parsing user agent:', error);
      
      // Fallback to default name
      this.name = {
        model: '',
        os: '',
        browser: '',
        type: 'desktop',
        deviceName: 'Unknown Device',
        displayName: getDisplayName(this.id)
      };
    }
  }
  
  startPinging() {
    // Clear any existing interval
    this.stopPinging();
    
    // Set up ping interval
    this.pingInterval = setInterval(() => {
      if (!this.isAlive) {
        this.socket.terminate();
        this.stopPinging();
        return;
      }
      
      // Reset alive flag and send ping
      this.isAlive = false;
      this.send({ type: 'ping' });
    }, CONFIG.pingInterval);
  }
  
  stopPinging() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  
  updateActivity() {
    this.lastActivity = Date.now();
    this.isAlive = true;
  }
  
  isActive() {
    return (Date.now() - this.lastActivity) < CONFIG.peerExpiryTime;
  }
  
  send(data) {
    try {
      if (this.socket && this.socket.readyState === this.socket.OPEN) {
        this.socket.send(JSON.stringify(data));
        return true;
      }
    } catch (error) {
      logger.warn(`Error sending to peer ${this.id}:`, error.message);
    }
    return false;
  }
  
  getInfo() {
    return {
      id: this.id,
      name: this.name,
      rtcSupported: true
    };
  }
  
  static generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

// Room class for managing peers by IP
class Room {
  constructor(ip) {
    this.ip = ip;
    this.peers = new Map(); // peerId -> Peer
    this.lastActivity = Date.now();
  }
  
  addPeer(peer) {
    this.peers.set(peer.id, peer);
    this.updateActivity();
  }
  
  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.stopPinging();
      this.peers.delete(peerId);
    }
    this.updateActivity();
  }
  
  hasPeer(peerId) {
    return this.peers.has(peerId);
  }
  
  getPeer(peerId) {
    return this.peers.get(peerId);
  }
  
  updateActivity() {
    this.lastActivity = Date.now();
  }
  
  isActive() {
    return (Date.now() - this.lastActivity) < CONFIG.peerExpiryTime;
  }
  
  isEmpty() {
    return this.peers.size === 0;
  }
  
  getPeersCount() {
    return this.peers.size;
  }
  
  getPeersArray() {
    return Array.from(this.peers.values());
  }
  
  getPeersInfoArray() {
    return this.getPeersArray().map(peer => peer.getInfo());
  }
  
  broadcast(message, excludePeerId = null) {
    for (const [peerId, peer] of this.peers.entries()) {
      if (peerId !== excludePeerId) {
        peer.send(message);
      }
    }
  }
}

// Main server class
class DrplServer {
  constructor(wss, options = {}) {
    this.wss = wss;
    this.options = {
      ...CONFIG,
      ...options
    };
    
    this.rooms = new Map(); // IP -> Room
    this.rateLimiter = new RateLimiter(
      this.options.rateLimitWindow,
      this.options.rateLimitRequests
    );
    
    // Set up WebSocket server
    this.wss.on('connection', (socket, request) => this._handleConnection(socket, request));
    this.wss.on('headers', (headers, response) => this._handleHeaders(headers, response));
    
    // Set up cleanup interval
    this.cleanupInterval = setInterval(() => this._cleanup(), 60000); // Every minute
    
    // Handle process events
    this._setupProcessHandlers();
    
    logger.info(`Drpl.co server is running on port ${this.options.port}`);
  }
  
  _setupProcessHandlers() {
    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down...');
      this._shutdown();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down...');
      this._shutdown();
      process.exit(0);
    });
    
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    });
  }
  
  _shutdown() {
    // Clear intervals
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Close all WebSocket connections
    for (const room of this.rooms.values()) {
      for (const peer of room.peers.values()) {
        peer.stopPinging();
        peer.socket.terminate();
      }
    }
    
    // Close WebSocket server
    this.wss.close();
    
    logger.info('Server shutdown complete');
  }
  
  _handleHeaders(headers, response) {
    // Set peer ID cookie if not present
    if (!response.headers.cookie || !response.headers.cookie.includes('peerid=')) {
      response.peerId = Peer.generateUUID();
      headers.push(`Set-Cookie: peerid=${response.peerId}; SameSite=Strict; Secure; Path=/; Max-Age=31536000`);
    }
  }
  
  _handleConnection(socket, request) {
    // Extract IP from request
    let ip;
    if (request.headers['x-forwarded-for']) {
      ip = request.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
    } else {
      ip = request.socket.remoteAddress;
    }
    
    // Normalize localhost IP
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
      ip = '127.0.0.1';
    }
    
    // Check rate limit
    if (!this.rateLimiter.check(ip)) {
      logger.warn(`Rate limit exceeded for IP: ${ip}`);
      socket.close(1008, 'Rate limit exceeded');
      return;
    }
    
    // Create peer
    const peer = new Peer(socket, request);
    
    // Check if room exists, create if not
    if (!this.rooms.has(peer.ip)) {
      this.rooms.set(peer.ip, new Room(peer.ip));
    }
    
    // Get room
    const room = this.rooms.get(peer.ip);
    
    // Check if room has too many peers
    if (room.getPeersCount() >= this.options.maxPeersPerIP) {
      logger.warn(`Too many peers for IP: ${peer.ip}`);
      socket.close(1008, 'Too many connections from this IP');
      return;
    }
    
    // Add peer to room
    room.addPeer(peer);
    
    // Set up socket event handlers
    socket.on('message', (data) => this._handleMessage(peer, data));
    socket.on('close', () => this._handleClose(peer));
    socket.on('error', (error) => this._handleError(peer, error));
    socket.on('pong', () => {
      peer.isAlive = true;
      peer.updateActivity();
    });
    
    // Start ping-pong
    peer.startPinging();
    
    // Notify peer about their ID and display name
    peer.send({
      type: 'display-name',
      message: {
        peerId: peer.id,
        displayName: peer.name.displayName,
        deviceName: peer.name.deviceName
      }
    });
    
    // Send peer list to new peer
    this._sendPeerList(peer);
    
    // Notify existing peers about new peer
    room.broadcast(
      { 
        type: 'peer-joined',
        peer: peer.getInfo()
      },
      peer.id
    );
    
    logger.debug(`New peer connected: ${peer.id} (${peer.name.displayName}) from ${peer.ip}`);
  }
  
  _handleMessage(peer, data) {
    let message;
    
    try {
      // Validate message size
      if (data.length > this.options.maxMessageSize) {
        logger.warn(`Message too large from peer ${peer.id}: ${data.length} bytes`);
        return;
      }
      
      // Parse message
      message = JSON.parse(data);
      
      // Validate message type
      if (!message.type) {
        logger.warn(`Invalid message from peer ${peer.id}: missing type`);
        return;
      }
      
      // Update activity
      peer.updateActivity();
      
      // Handle message based on type
      switch (message.type) {
        case 'introduce':
          this._handleIntroduce(peer, message);
          break;
          
        case 'signal':
        case 'transfer-request':
        case 'transfer-accept':
        case 'transfer-decline':
        case 'transfer-cancel':
        case 'send-message':
        case 'transfer-complete':
        case 'transfer-error':
          this._handleForwardMessage(peer, message);
          break;
          
        case 'pong':
          // Already handled by socket.on('pong')
          break;
          
        default:
          logger.debug(`Unknown message type from peer ${peer.id}: ${message.type}`);
      }
    } catch (error) {
      logger.warn(`Error handling message from peer ${peer.id}:`, error.message);
    }
  }
  
  _handleIntroduce(peer, message) {
    // Store device type if provided
    if (message.name && message.name.deviceType) {
      peer.name.type = sanitizeInput(message.name.deviceType);
      
      // Update room activity
      const room = this.rooms.get(peer.ip);
      if (room) {
        room.updateActivity();
        
        // Notify other peers
        room.broadcast(
          {
            type: 'peer-updated',
            peer: peer.getInfo()
          },
          peer.id
        );
      }
    }
  }
  
  _handleForwardMessage(peer, message) {
    // Check if recipient is specified
    if (!message.to) {
      logger.warn(`Missing recipient in message from peer ${peer.id}`);
      return;
    }
    
    // Get room
    const room = this.rooms.get(peer.ip);
    if (!room) {
      logger.warn(`Room not found for peer ${peer.id}`);
      return;
    }
    
    // Check if recipient exists
    const recipient = room.getPeer(message.to);
    if (!recipient) {
      logger.warn(`Recipient ${message.to} not found for peer ${peer.id}`);
      return;
    }
    
    // Remove recipient from message
    const { to, ...forwardMessage } = message;
    
    // Add sender ID
    forwardMessage.sender = peer.id;
    
    // Forward message
    recipient.send(forwardMessage);
    
    // Debug log for specific message types
    if (message.type === 'transfer-request') {
      logger.debug(`Transfer request from ${peer.id} to ${message.to}: mode=${message.mode}`);
    } else if (message.type === 'transfer-complete') {
      logger.debug(`Transfer completed from ${peer.id} to ${message.to}`);
    }
  }
  
  _handleClose(peer) {
    // Get room
    const room = this.rooms.get(peer.ip);
    if (!room) return;
    
    // Remove peer from room
    room.removePeer(peer.id);
    
    // Notify other peers
    room.broadcast(
      {
        type: 'peer-left',
        peerId: peer.id
      }
    );
    
    // Check if room is empty
    if (room.isEmpty()) {
      this.rooms.delete(peer.ip);
    }
    
    logger.debug(`Peer disconnected: ${peer.id} (${peer.name.displayName})`);
  }
  
  _handleError(peer, error) {
    logger.warn(`WebSocket error for peer ${peer.id}:`, error.message);
  }
  
  _sendPeerList(peer) {
    // Get room
    const room = this.rooms.get(peer.ip);
    if (!room) return;
    
    // Build peer list excluding the current peer
    const peers = room.getPeersInfoArray().filter(p => p.id !== peer.id);
    
    // Send peer list
    peer.send({
      type: 'peers',
      peers: peers
    });
  }
  
  _cleanup() {
    // Clean up rate limiter
    this.rateLimiter.cleanup();
    
    // Clean up inactive rooms
    for (const [ip, room] of this.rooms.entries()) {
      // Remove inactive peers
      for (const [peerId, peer] of room.peers.entries()) {
        if (!peer.isActive()) {
          logger.debug(`Removing inactive peer: ${peerId}`);
          room.removePeer(peerId);
          
          // Notify other peers
          room.broadcast({
            type: 'peer-left',
            peerId: peerId
          });
        }
      }
      
      // Remove empty or inactive rooms
      if (room.isEmpty() || !room.isActive()) {
        logger.debug(`Removing inactive room: ${ip}`);
        this.rooms.delete(ip);
      }
    }
    
    // Log status
    logger.debug(`Active rooms: ${this.rooms.size}, total peers: ${this._getTotalPeersCount()}`);
  }
  
  _getTotalPeersCount() {
    let count = 0;
    for (const room of this.rooms.values()) {
      count += room.getPeersCount();
    }
    return count;
  }
}

// Initialize Express app
const app = express();

// Server configuration
const PORT = process.env.PORT || 3002;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Set logger level
switch (LOG_LEVEL.toLowerCase()) {
  case 'debug':
    logger.setLevel(Logger.levels.DEBUG);
    break;
  case 'info':
    logger.setLevel(Logger.levels.INFO);
    break;
  case 'warn':
  case 'warning':
    logger.setLevel(Logger.levels.WARN);
    break;
  case 'error':
    logger.setLevel(Logger.levels.ERROR);
    break;
  default:
    logger.setLevel(Logger.levels.INFO);
}

// Server static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Create Drpl server
const drplServer = new DrplServer(wss, {
  port: PORT
});

// Start server
server.listen(PORT, () => {
  logger.info(`Server listening on port ${PORT}`);
});

export default server;