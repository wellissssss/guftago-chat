// Couple Chat — Ultra-lightweight self-hosted private chat server
// Node.js + Express + Socket.IO + better-sqlite3 + multer + sharp

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { DatabaseSync } = require('node:sqlite');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.PORT || '3000', 10);
const APP_NAME = process.env.APP_NAME || 'Chat';
const ADMIN_CODE = process.env.ADMIN_CODE || 'ADMIN-MASTER';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Admin';

// ── Database setup ──
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const uploadsDir = path.join(dataDir, 'uploads');
['photos', 'videos', 'audio', 'gifs'].forEach(d => {
  const dir = path.join(uploadsDir, d);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const db = new DatabaseSync(path.join(dataDir, 'chat.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

// Create access_codes table for dynamic password management
db.exec(`
  CREATE TABLE IF NOT EXISTS access_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'partner',
    name TEXT,
    profile_pic TEXT,
    created_at INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    used_at INTEGER
  );
`);

// Insert default admin code if not exists
const adminExists = db.prepare("SELECT * FROM access_codes WHERE code = ?").get(ADMIN_CODE);
if (!adminExists) {
  db.prepare("INSERT INTO access_codes (code, role, name, created_at, active) VALUES (?, 'admin', ?, ?, 1)").run(ADMIN_CODE, ADMIN_NAME, Date.now());
}

// Insert default partner code if not exists
const partnerCode = process.env.PARTNER_CODE || 'PARTNER-GF';
const partnerExists = db.prepare("SELECT * FROM access_codes WHERE code = ?").get(partnerCode);
if (!partnerExists) {
  db.prepare("INSERT INTO access_codes (code, role, name, created_at, active) VALUES (?, 'partner', ?, ?, 1)").run(partnerCode, process.env.PARTNER_NAME || 'Partner', Date.now());
}

function findCode(code) {
  return db.prepare("SELECT * FROM access_codes WHERE code = ? AND active = 1").get(code);
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT,
    filename TEXT,
    mimetype TEXT,
    size INTEGER,
    reply_to INTEGER,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    read_at INTEGER,
    FOREIGN KEY (reply_to) REFERENCES messages(id)
  );
  CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(message_id, user, emoji),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
`);
// Migration: add bookmarked column if missing
try { db.exec('ALTER TABLE messages ADD COLUMN bookmarked INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* column may already exist */ }
// Migration: add self_destruct column if missing
try { db.exec('ALTER TABLE messages ADD COLUMN self_destruct INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* column may already exist */ }

const insertMsg = db.prepare(
  'INSERT INTO messages (sender, type, content, filename, mimetype, size, reply_to, created_at, self_destruct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const getMessages = db.prepare(
  "SELECT m.*, (SELECT GROUP_CONCAT(r.emoji || ':' || r.user, ',') FROM reactions r WHERE r.message_id = m.id) as reactions FROM messages m ORDER BY m.created_at ASC LIMIT ? OFFSET ?"
);
const getMessagesSince = db.prepare(
  "SELECT m.*, (SELECT GROUP_CONCAT(r.emoji || ':' || r.user, ',') FROM reactions r WHERE r.message_id = m.id) as reactions FROM messages m WHERE m.id > ? ORDER BY m.created_at ASC"
);
const markRead = db.prepare('UPDATE messages SET read_at = ? WHERE id = ? AND sender != ?');
const addReaction = db.prepare('INSERT OR IGNORE INTO reactions (message_id, user, emoji, created_at) VALUES (?, ?, ?, ?)');
const removeReaction = db.prepare('DELETE FROM reactions WHERE message_id = ? AND user = ? AND emoji = ?');
const deleteOldMedia = db.prepare('DELETE FROM messages WHERE type != ? AND created_at < ?');

// ── Express setup ──
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));
app.use('/uploads', express.static(uploadsDir));

// ── Multer for file uploads ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = 'photos';
    if (file.mimetype.startsWith('video/')) folder = 'videos';
    else if (file.mimetype.startsWith('audio/')) folder = 'audio';
    else if (file.mimetype === 'image/gif') folder = 'gifs';
    cb(null, path.join(uploadsDir, folder));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
});

// ── Active session tracking (single-session-per-code) ──
const activeSessions = new Map(); // code -> socket

// ── Auth middleware for Socket.IO ──
io.use((socket, next) => {
  const code = socket.handshake.auth?.code;
  const entry = findCode(code);
  if (!entry) return next(new Error('Invalid code'));

  // Check if code is already in use by an active session
  const existingSocket = activeSessions.get(code);
  if (existingSocket && existingSocket.connected) {
    return next(new Error('This code is already in use. Only one session per code allowed.'));
  }

  socket.partner = { id: entry.role === 'admin' ? 'admin' : 'partner', name: entry.name || (entry.role === 'admin' ? 'Admin' : 'Partner'), role: entry.role, code: entry.code };
  activeSessions.set(code, socket);
  next();
});

// ── Socket.IO connection handling ──
const onlineUsers = new Set();

io.on('connection', (socket) => {
  const { id: userId, name } = socket.partner;
  onlineUsers.add(userId);
  io.emit('presence', { userId, online: true, name });

  // Send any messages the client missed (for reconnect)
  socket.on('sync', (lastId) => {
    if (lastId && Number.isInteger(lastId)) {
      const missed = getMessagesSince.all(lastId);
      missed.forEach(m => socket.emit('message', formatMessage(m)));
    }
  });

  // New message
  socket.on('message', (data) => {
    const { type, content, filename, mimetype, size, replyTo, selfDestruct } = data;
    if (!type) return;
    const now = Date.now();
    const sd = Math.max(0, parseInt(selfDestruct, 10) || 0);
    const result = insertMsg.run(userId, type, content || null, filename || null, mimetype || null, size || null, replyTo || null, now, sd);
    const msgId = result.lastInsertRowid;
    const msg = formatMessage({
      id: msgId,
      sender: userId,
      type,
      content,
      filename,
      mimetype,
      size,
      reply_to: replyTo || null,
      created_at: now,
      read_at: null,
      reactions: null,
      self_destruct: sd,
    });
    // Broadcast to the other user
    socket.broadcast.emit('message', msg);
    // Confirm to sender
    socket.emit('message:sent', { tempId: data.tempId, id: msg.id });
    // Schedule self-destruct deletion
    if (sd > 0) scheduleSelfDestruct(msgId, sd, now);
  });

  // Typing indicator
  socket.on('typing', (isTyping) => {
    socket.broadcast.emit('typing', { userId, isTyping: !!isTyping });
  });

  // Reaction
  socket.on('reaction', (data) => {
    const { messageId, emoji, action } = data;
    if (!messageId || !emoji) return;
    const now = Date.now();
    if (action === 'remove') {
      removeReaction.run(messageId, userId, emoji);
    } else {
      addReaction.run(messageId, userId, emoji, now);
    }
    io.emit('reaction', { messageId, userId, emoji, action: action || 'add' });
  });

  // Read receipts
  socket.on('read', (messageIds) => {
    if (!Array.isArray(messageIds)) return;
    const now = Date.now();
    messageIds.forEach(mid => {
      markRead.run(now, mid, userId);
    });
    socket.broadcast.emit('read', { messageIds, readBy: userId, readAt: now });
  });

  // Edit message
  socket.on('edit', (data) => {
    const { messageId, content } = data;
    if (!messageId || !content) return;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND sender = ?').get(messageId, userId);
    if (!msg) return;
    db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, messageId);
    io.emit('message:edited', { id: messageId, content });
  });

  // Pin/unpin message
  socket.on('pin', (data) => {
    const { messageId, pinned } = data;
    if (!messageId) return;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    if (!msg) return;
    db.prepare('UPDATE messages SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, messageId);
    io.emit('message:pinned', { id: messageId, pinned: !!pinned });
  });

  // Bookmark/unbookmark message
  socket.on('bookmark', (data) => {
    const { messageId, bookmarked } = data;
    if (!messageId) return;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    if (!msg) return;
    db.prepare('UPDATE messages SET bookmarked = ? WHERE id = ?').run(bookmarked ? 1 : 0, messageId);
    io.emit('message:bookmarked', { id: messageId, bookmarked: !!bookmarked });
  });

  // Delete message
  socket.on('delete', (data) => {
    const { messageId } = data;
    if (!messageId) return;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND sender = ?').get(messageId, userId);
    if (!msg) return;
    // Delete file if exists
    if (msg.filename) {
      const folder = msg.type === 'photo' ? 'photos' : msg.type === 'video' ? 'videos' : msg.type === 'audio' ? 'audio' : 'gifs';
      const filePath = path.join(uploadsDir, folder, msg.filename);
      try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
    }
    db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
    db.prepare('DELETE FROM reactions WHERE message_id = ?').run(messageId);
    io.emit('message:deleted', { id: messageId });
  });

  // Disconnect
  socket.on('disconnect', () => {
    // Remove from active sessions
    if (activeSessions.get(socket.partner.code) === socket) {
      activeSessions.delete(socket.partner.code);
    }
    // Check if user has other connections
    const stillOnline = [...io.sockets.sockets.values()].some(s => s.partner?.id === userId);
    if (!stillOnline) {
      onlineUsers.delete(userId);
      io.emit('presence', { userId, online: false });
    }
  });
});

function formatMessage(m) {
  const reactions = {};
  if (m.reactions) {
    m.reactions.split(',').forEach(r => {
      const [emoji, user] = r.split(':');
      if (!reactions[emoji]) reactions[emoji] = [];
      reactions[emoji].push(user);
    });
  }
  let url = null;
  if (m.filename && m.type !== 'gif') {
    const folder = m.type === 'photo' ? 'photos' : m.type === 'video' ? 'videos' : m.type === 'audio' ? 'audio' : 'gifs';
    url = `/uploads/${folder}/${m.filename}`;
  }
  if (m.type === 'gif' && m.content) url = m.content;
  // Get reply-to message content
  let replyTo = m.reply_to || null;
  let replyContent = null;
  let replySender = null;
  if (replyTo) {
    const replyMsg = db.prepare('SELECT sender, type, content FROM messages WHERE id = ?').get(replyTo);
    if (replyMsg) {
      replyContent = replyMsg.type === 'text' ? replyMsg.content : `[${replyMsg.type}]`;
      replySender = replyMsg.sender;
    }
  }
  return {
    id: m.id,
    sender: m.sender,
    type: m.type,
    content: m.content,
    url,
    filename: m.filename,
    mimetype: m.mimetype,
    size: m.size,
    replyTo,
    replyContent,
    replySender,
    pinned: !!m.pinned,
    bookmarked: !!m.bookmarked,
    selfDestruct: m.self_destruct || 0,
    createdAt: m.created_at,
    readAt: m.read_at,
    reactions,
  };
}

// ── Self-destruct scheduling ──
function deleteMessageFiles(msg) {
  if (msg && msg.filename) {
    const folder = msg.type === 'photo' ? 'photos' : msg.type === 'video' ? 'videos' : msg.type === 'audio' ? 'audio' : 'gifs';
    const filePath = path.join(uploadsDir, folder, msg.filename);
    try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
  }
}
function scheduleSelfDestruct(msgId, seconds, createdAt) {
  const base = createdAt || Date.now();
  const expiry = base + (seconds || 0) * 1000;
  const delay = expiry - Date.now();
  const doDelete = () => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
    if (!msg) return;
    deleteMessageFiles(msg);
    db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);
    db.prepare('DELETE FROM reactions WHERE message_id = ?').run(msgId);
    io.emit('message:deleted', { id: msgId, auto: true });
  };
  if (delay <= 0) {
    // already expired
    doDelete();
    return;
  }
  setTimeout(doDelete, delay);
}

// Schedule self-destruct for existing messages on startup
try {
  const sdRows = db.prepare('SELECT id, created_at, self_destruct FROM messages WHERE self_destruct > 0').all();
  sdRows.forEach(r => scheduleSelfDestruct(r.id, r.self_destruct, r.created_at));
} catch (e) { console.error('self-destruct schedule error:', e.message); }

// ── REST API ──

// Login
app.post('/api/login', (req, res) => {
  const { code } = req.body;
  const entry = findCode(code);
  if (!entry) return res.status(401).json({ error: 'Invalid code' });
  // Mark code as used
  db.prepare("UPDATE access_codes SET used_at = ? WHERE code = ?").run(Date.now(), code);
  const isAdmin = entry.role === 'admin';
  // Get the other user's name
  let otherName = 'Partner';
  let otherPic = null;
  if (isAdmin) {
    const partnerEntry = db.prepare("SELECT name, profile_pic FROM access_codes WHERE role = 'partner' AND active = 1 ORDER BY created_at DESC LIMIT 1").get();
    otherName = partnerEntry?.name || 'Partner';
    otherPic = partnerEntry?.profile_pic || null;
  } else {
    const adminEntry = db.prepare("SELECT name, profile_pic FROM access_codes WHERE role = 'admin' AND active = 1 ORDER BY created_at DESC LIMIT 1").get();
    otherName = adminEntry?.name || 'Admin';
    otherPic = adminEntry?.profile_pic || null;
  }
  res.json({
    user: isAdmin ? 'admin' : 'partner',
    name: entry.name || (isAdmin ? 'Admin' : 'Partner'),
    profilePic: entry.profile_pic || null,
    role: entry.role,
    isAdmin,
    otherUser: isAdmin ? 'partner' : 'admin',
    otherName,
    otherPic,
    appName: APP_NAME,
  });
});

// ── Admin API ──

// Middleware to check admin
function requireAdmin(req, res, next) {
  const code = req.headers['x-admin-code'] || req.body?.adminCode;
  const entry = findCode(code);
  if (!entry || entry.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Generate new partner code
app.post('/api/admin/generate-code', requireAdmin, (req, res) => {
  const name = req.body.name || 'Partner';
  const customCode = (req.body.customCode || '').trim().toUpperCase();
  let newCode;
  if (customCode) {
    // Validate custom code FIRST (before deactivating)
    if (customCode.length < 4) return res.status(400).json({ error: 'Code must be at least 4 characters' });
    const existing = db.prepare("SELECT * FROM access_codes WHERE code = ?").get(customCode);
    if (existing && existing.active === 1 && existing.role === 'partner') return res.status(400).json({ error: 'This code is currently active' });
    newCode = customCode;
  } else {
    do { newCode = generateCode(); } while (findCode(newCode));
  }
  // Deactivate old partner codes
  db.prepare("UPDATE access_codes SET active = 0 WHERE role = 'partner'").run();
  // Upsert: if code exists (inactive), reactivate it; otherwise insert
  const exists = db.prepare("SELECT * FROM access_codes WHERE code = ?").get(newCode);
  if (exists) {
    db.prepare("UPDATE access_codes SET active = 1, name = ?, created_at = ?, used_at = NULL WHERE code = ?").run(name, Date.now(), newCode);
  } else {
    db.prepare("INSERT INTO access_codes (code, role, name, created_at, active) VALUES (?, 'partner', ?, ?, 1)").run(newCode, name, Date.now());
  }
  res.json({ code: newCode, name, message: 'Share this code with your partner. Old codes are now invalid.' });
});

// List all codes
app.get('/api/admin/codes', requireAdmin, (req, res) => {
  const codes = db.prepare("SELECT code, role, name, created_at, active, used_at FROM access_codes ORDER BY created_at DESC").all();
  res.json(codes);
});

// Deactivate a code
app.post('/api/admin/deactivate-code', requireAdmin, (req, res) => {
  const { code } = req.body;
  if (code === ADMIN_CODE) return res.status(400).json({ error: 'Cannot deactivate admin code' });
  db.prepare("UPDATE access_codes SET active = 0 WHERE code = ?").run(code);
  // Instantly kick any active session using this code
  const socket = activeSessions.get(code);
  if (socket && socket.connected) {
    socket.emit('revoked', { message: 'Your access has been revoked by admin. 💔' });
    socket.disconnect(true);
    activeSessions.delete(code);
  }
  res.json({ success: true, kicked: !!socket });
});

// Kick a session (force disconnect)
app.post('/api/admin/kick-session', requireAdmin, (req, res) => {
  const { code } = req.body;
  const socket = activeSessions.get(code);
  if (!socket || !socket.connected) return res.status(404).json({ error: 'No active session for this code' });
  socket.emit('revoked', { message: 'Your session has been ended by admin. 💔' });
  socket.disconnect(true);
  activeSessions.delete(code);
  res.json({ success: true });
});

// List active sessions
app.get('/api/admin/sessions', requireAdmin, (req, res) => {
  const sessions = [];
  activeSessions.forEach((socket, code) => {
    if (socket.connected) {
      sessions.push({
        code,
        name: socket.partner.name,
        role: socket.partner.role,
        connectedAt: socket.handshake.time,
      });
    }
  });
  res.json(sessions);
});

// Chat stats
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  const byType = db.prepare('SELECT type, COUNT(*) as count FROM messages GROUP BY type').all();
  const reactions = db.prepare('SELECT COUNT(*) as count FROM reactions').get().count;
  const first = db.prepare('SELECT created_at FROM messages ORDER BY created_at ASC LIMIT 1').get();
  const last = db.prepare('SELECT created_at FROM messages ORDER BY created_at DESC LIMIT 1').get();
  const codes = db.prepare('SELECT COUNT(*) as count FROM access_codes WHERE active = 1').get().count;
  const storage = db.prepare('SELECT COALESCE(SUM(size), 0) as bytes FROM messages').get().bytes;
  res.json({ total, byType, reactions, firstMessage: first?.created_at, lastMessage: last?.created_at, activeCodes: codes, storageBytes: storage });
});

// Update admin name
app.post('/api/admin/update-name', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length === 0) return res.status(400).json({ error: 'Name is required' });
  db.prepare("UPDATE access_codes SET name = ? WHERE role = 'admin' AND active = 1").run(name.trim());
  res.json({ success: true, name: name.trim() });
});

// Update profile pic
app.post('/api/admin/update-pic', requireAdmin, (req, res) => {
  const { picUrl, target } = req.body; // target: 'admin' or 'partner'
  if (!picUrl) return res.status(400).json({ error: 'Picture URL is required' });
  const role = target === 'partner' ? 'partner' : 'admin';
  db.prepare("UPDATE access_codes SET profile_pic = ? WHERE role = ? AND active = 1").run(picUrl, role);
  res.json({ success: true, profile_pic: picUrl });
});

// Get profile pics
app.get('/api/profile-pics', (req, res) => {
  const adminPic = db.prepare("SELECT profile_pic FROM access_codes WHERE role = 'admin' AND active = 1 ORDER BY created_at DESC LIMIT 1").get();
  const partnerPic = db.prepare("SELECT profile_pic FROM access_codes WHERE role = 'partner' AND active = 1 ORDER BY created_at DESC LIMIT 1").get();
  res.json({ admin: adminPic?.profile_pic || null, partner: partnerPic?.profile_pic || null });
});

// Change admin code
app.post('/api/admin/change-admin-code', requireAdmin, (req, res) => {
  const { newCode } = req.body;
  if (!newCode || newCode.length < 4) return res.status(400).json({ error: 'Code must be at least 4 characters' });
  // Deactivate old admin code
  db.prepare("UPDATE access_codes SET active = 0 WHERE role = 'admin'").run();
  // Create new admin code
  db.prepare("INSERT INTO access_codes (code, role, name, created_at, active) VALUES (?, 'admin', ?, ?, 1)").run(newCode, ADMIN_NAME, Date.now());
  res.json({ code: newCode, message: 'Admin code changed. Use the new code from now on.' });
});

// Upload file
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const file = req.file;
  let type = 'photo';
  if (file.mimetype.startsWith('video/')) type = 'video';
  else if (file.mimetype.startsWith('audio/')) type = 'audio';
  else if (file.mimetype === 'image/gif') type = 'gif';

  // Compress photos (not gifs, not videos, not audio)
  if (type === 'photo' && file.mimetype.startsWith('image/') && file.mimetype !== 'image/gif') {
    try {
      const compressed = await sharp(file.path)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
      fs.writeFileSync(file.path, compressed);
      // Update size
      const stat = fs.statSync(file.path);
      file.size = stat.size;
    } catch (e) {
      console.error('sharp compress error:', e.message);
    }
  }

  const folder = type === 'photo' ? 'photos' : type === 'video' ? 'videos' : type === 'audio' ? 'audio' : 'gifs';
  res.json({
    url: `/uploads/${folder}/${file.filename}`,
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
    type,
  });
});

// Get message history
app.get('/api/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 200);
  const offset = parseInt(req.query.offset || '0', 10);
  const rows = getMessages.all(limit, offset);
  res.json(rows.map(formatMessage));
});

// Get bookmarked messages
app.get('/api/bookmarks', (req, res) => {
  const rows = db.prepare('SELECT * FROM messages WHERE bookmarked = 1 ORDER BY created_at DESC').all();
  res.json(rows.map(formatMessage));
});

// GIF URL validation (no API key needed - users paste URLs or upload files)
app.post('/api/gif/validate', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  // Basic URL validation
  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith('http')) return res.status(400).json({ error: 'Invalid URL' });
    res.json({ valid: true, url });
  } catch (e) {
    res.status(400).json({ error: 'Invalid URL' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), users: onlineUsers.size });
});

// ── Auto-cleanup old media ──
function runCleanup() {
  const now = Date.now();
  const types = [
    { type: 'photo', days: parseInt(process.env.CLEANUP_PHOTOS_DAYS || '30', 10) },
    { type: 'video', days: parseInt(process.env.CLEANUP_VIDEOS_DAYS || '14', 10) },
    { type: 'audio', days: parseInt(process.env.CLEANUP_AUDIO_DAYS || '30', 10) },
    { type: 'gif', days: parseInt(process.env.CLEANUP_GIFS_DAYS || '30', 10) },
  ];
  for (const { type, days } of types) {
    if (days <= 0) continue;
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    const rows = db.prepare('SELECT id, filename FROM messages WHERE type = ? AND created_at < ?').all(type, cutoff);
    for (const row of rows) {
      if (row.filename) {
        const folder = type === 'photo' ? 'photos' : type === 'video' ? 'videos' : type === 'audio' ? 'audio' : 'gifs';
        const filePath = path.join(uploadsDir, folder, row.filename);
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    }
    const info = db.prepare('DELETE FROM messages WHERE type = ? AND created_at < ?').run(type, cutoff);
    if (info.changes > 0) console.log(`[cleanup] Removed ${info.changes} old ${type} messages`);
  }
  // Also clean up reactions for deleted messages (cascade should handle, but be safe)
}

// Run cleanup on start
runCleanup();
// Schedule periodic cleanup
const cleanupInterval = (parseInt(process.env.CLEANUP_INTERVAL_HOURS || '24', 10)) * 60 * 60 * 1000;
setInterval(runCleanup, cleanupInterval);

// ── Start server ──
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  💬 ${APP_NAME} running on http://0.0.0.0:${PORT}`);
  console.log(`  📱 Local:  http://localhost:${PORT}`);
  console.log(`  🌐 LAN:    http://<your-ip>:${PORT}\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => { db.close(); server.close(); process.exit(0); });
process.on('SIGINT', () => { db.close(); server.close(); process.exit(0); });
