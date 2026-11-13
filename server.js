// Guftago — Ultra-lightweight self-hosted private chat server
// Node.js + Express + Socket.IO + node:sqlite + multer + sharp

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { DatabaseSync } = require('node:sqlite');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const APP_NAME = process.env.APP_NAME || 'Guftago';
const ADMIN_CODE = process.env.ADMIN_CODE || 'ADMIN-MASTER';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Admin';
const SESSION_SECRET = process.env.SESSION_SECRET || 'guftago-secret-salt-2026';

// ── Helpers ──
function folderFor(type) {
  if (type === 'video') return 'videos';
  if (type === 'audio') return 'audio';
  if (type === 'gif') return 'gifs';
  return 'photos';
}

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
// Migration: add scheduled_at column if missing
try { db.exec('ALTER TABLE messages ADD COLUMN scheduled_at INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* column may already exist */ }
// Migration: add status column if missing
try { db.exec("ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'"); } catch (e) { /* column may already exist */ }

const insertMsg = db.prepare(
  'INSERT INTO messages (sender, type, content, filename, mimetype, size, reply_to, created_at, self_destruct, scheduled_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const getMessages = db.prepare(`
  SELECT m.*, 
    p.sender AS reply_sender, p.type AS reply_type, p.content AS reply_content,
    (SELECT GROUP_CONCAT(r.emoji || ':' || r.user, ',') FROM reactions r WHERE r.message_id = m.id) as reactions 
  FROM messages m 
  LEFT JOIN messages p ON m.reply_to = p.id
  ORDER BY m.created_at ASC LIMIT ? OFFSET ?
`);
const getMessagesSince = db.prepare(`
  SELECT m.*, 
    p.sender AS reply_sender, p.type AS reply_type, p.content AS reply_content,
    (SELECT GROUP_CONCAT(r.emoji || ':' || r.user, ',') FROM reactions r WHERE r.message_id = m.id) as reactions 
  FROM messages m 
  LEFT JOIN messages p ON m.reply_to = p.id
  WHERE m.id > ? ORDER BY m.created_at ASC
`);
const markRead = db.prepare('UPDATE messages SET read_at = ? WHERE id = ? AND sender != ?');
const addReaction = db.prepare('INSERT OR IGNORE INTO reactions (message_id, user, emoji, created_at) VALUES (?, ?, ?, ?)');
const removeReaction = db.prepare('DELETE FROM reactions WHERE message_id = ? AND user = ? AND emoji = ?');

// ── REST Session Tokens ──
function createSessionToken(entry) {
  const payload = {
    code: entry.code,
    role: entry.role,
    name: entry.name || (entry.role === 'admin' ? 'Admin' : 'Partner'),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireSession(req, res, next) {
  const token = req.headers['x-session'];
  const session = verifySessionToken(token);
  if (!session) return res.status(401).json({ error: 'Authentication required' });
  req.session = session;
  next();
}

// ── Rate limiter for login ──
const loginAttempts = new Map();
function isLoginRateLimited(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60000 });
    return false;
  }
  record.count++;
  if (record.count > 10) return true;
  return false;
}
function resetLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

// ── Express setup ──
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

// Global security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}, express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

// ── Multer for file uploads ──
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm',
  'audio/webm', 'audio/ogg', 'audio/mp3', 'audio/mpeg', 'audio/wav'
]);

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp3': '.mp3',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = folderFor(file.mimetype.startsWith('video/') ? 'video' : file.mimetype.startsWith('audio/') ? 'audio' : file.mimetype === 'image/gif' ? 'gif' : 'photo');
    cb(null, path.join(uploadsDir, folder));
  },
  filename: (req, file, cb) => {
    const rawExt = (path.extname(file.originalname) || '').toLowerCase();
    const safeExt = MIME_TO_EXT[file.mimetype] || (['.jpg', '.jpeg', '.png', '.gif', '.mp4', '.webm', '.mp3', '.ogg', '.wav'].includes(rawExt) ? rawExt : '.bin');
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

// ── Active session tracking (single-session-per-code) ──
// Map: code -> { socket, deviceId, lastSeen, connectedAt, name, role }
const activeSessions = new Map();
const onlineSockets = new Map(); // socket.id -> userId
const userPubkeys = new Map(); // userId -> base64 ECDH public key (E2EE)

// ── Auth middleware for Socket.IO ──
io.use((socket, next) => {
  const auth = socket.handshake.auth || {};
  const code = auth.code;
  const deviceId = auth.deviceId || null;
  const takeover = Boolean(auth.takeover);

  const entry = findCode(code);
  if (!entry) return next(new Error('Invalid code'));

  const now = Date.now();
  const existing = activeSessions.get(code);

  if (existing && existing.socket && (now - existing.lastSeen <= 60000)) {
    const isSameDevice = Boolean(deviceId && existing.deviceId && existing.deviceId === deviceId);
    if (isSameDevice || takeover) {
      if (existing.socket !== socket) {
        if (takeover && !isSameDevice) {
          try {
            existing.socket.emit('session:replaced', { message: 'Your session was opened on another device' });
          } catch (_) {}
        }
        try { existing.socket.disconnect(true); } catch (_) {}
      }
      activeSessions.delete(code);
    } else {
      const err = new Error('This code is already in use. Only one session per code allowed.');
      err.data = { code: 'CODE_IN_USE', since: existing.lastSeen, deviceLabel: existing.deviceId || 'other' };
      return next(err);
    }
  } else if (existing) {
    try { existing.socket?.disconnect(true); } catch (_) {}
    activeSessions.delete(code);
  }

  socket.partner = {
    id: entry.role === 'admin' ? 'admin' : 'partner',
    name: entry.name || (entry.role === 'admin' ? 'Admin' : 'Partner'),
    role: entry.role,
    code: entry.code,
    deviceId: deviceId,
  };
  next();
});

// Periodic session sweep (TTL = 60s, sweeps every 15s)
const sessionSweepInterval = setInterval(() => {
  const now = Date.now();
  for (const [code, session] of activeSessions.entries()) {
    if (now - session.lastSeen > 60000) {
      try { session.socket?.disconnect(true); } catch (_) {}
      activeSessions.delete(code);
    }
  }
}, 15000);
sessionSweepInterval.unref();

// ── Socket.IO connection handling ──
io.on('connection', (socket) => {
  const { id: userId, name, code, deviceId } = socket.partner;
  const now = Date.now();

  activeSessions.set(code, {
    socket,
    deviceId,
    lastSeen: now,
    connectedAt: now,
    name,
    role: socket.partner.role,
  });

  onlineSockets.set(socket.id, userId);
  io.emit('presence', { userId, online: true, name });

  const touch = () => {
    const s = activeSessions.get(code);
    if (s && s.socket === socket) s.lastSeen = Date.now();
  };
  socket.conn.on('packet', touch);
  socket.onAny(touch);

  // Relay cached peer public key for E2EE key exchange
  const peerId = userId === 'admin' ? 'partner' : 'admin';
  if (userPubkeys.has(peerId)) {
    socket.emit('pubkey', { userId: peerId, pubkey: userPubkeys.get(peerId) });
  }

  // Send any messages the client missed (for reconnect)
  socket.on('sync', (lastId) => {
    if (lastId && Number.isInteger(lastId)) {
      const missed = getMessagesSince.all(lastId);
      missed.forEach(m => socket.emit('message', formatMessage(m)));
    }
  });

  // E2EE public key exchange
  socket.on('pubkey', (pubkey) => {
    if (!pubkey || typeof pubkey !== 'string') return;
    userPubkeys.set(userId, pubkey);
    socket.broadcast.emit('pubkey', { userId, pubkey });
  });

  // New message
  socket.on('message', (data) => {
    const { type, content, filename, mimetype, size, replyTo, selfDestruct } = data;
    if (!type) return;
    const msgNow = Date.now();
    const sd = Math.max(0, parseInt(selfDestruct, 10) || 0);
    const result = insertMsg.run(userId, type, content || null, filename || null, mimetype || null, size || null, replyTo || null, msgNow, sd, 0, 'sent');
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
      created_at: msgNow,
      read_at: null,
      reactions: null,
      self_destruct: sd,
    });
    socket.broadcast.emit('message', msg);
    socket.emit('message:sent', { tempId: data.tempId, id: msg.id });
    if (sd > 0) scheduleSelfDestruct(msgId, sd, msgNow);
  });

  // Schedule a message
  socket.on('schedule', (data) => {
    const { type, content, scheduledAt, filename, mimetype, size, replyTo } = data || {};
    if (!type || !scheduledAt) return;
    const msgNow = Date.now();
    const sd = 0;
    const result = insertMsg.run(userId, type, content || null, filename || null, mimetype || null, size || null, replyTo || null, msgNow, sd, scheduledAt, 'scheduled');
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
      created_at: msgNow,
      read_at: null,
      reactions: null,
      self_destruct: sd,
      scheduled_at: scheduledAt,
      status: 'scheduled',
    });
    socket.emit('message:scheduled', { tempId: data.tempId, id: msg.id, scheduledAt });
  });

  // Typing indicator
  socket.on('typing', (isTyping) => {
    socket.broadcast.emit('typing', { userId, isTyping: !!isTyping });
  });

  // Reaction
  socket.on('reaction', (data) => {
    const { messageId, emoji, action } = data;
    if (!messageId || !emoji) return;
    const rNow = Date.now();
    if (action === 'remove') {
      removeReaction.run(messageId, userId, emoji);
    } else {
      addReaction.run(messageId, userId, emoji, rNow);
    }
    io.emit('reaction', { messageId, userId, emoji, action: action || 'add' });
  });

  // Read receipts
  socket.on('read', (messageIds) => {
    if (!Array.isArray(messageIds)) return;
    const rNow = Date.now();
    messageIds.forEach(mid => {
      markRead.run(rNow, mid, userId);
    });
    socket.broadcast.emit('read', { messageIds, readBy: userId, readAt: rNow });
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
    deleteMessageFiles(msg);
    db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
    db.prepare('DELETE FROM reactions WHERE message_id = ?').run(messageId);
    io.emit('message:deleted', { id: messageId });
  });

  // Logout handler
  socket.on('logout', (cb) => {
    if (activeSessions.get(code)?.socket === socket) {
      activeSessions.delete(code);
    }
    onlineSockets.delete(socket.id);
    if (![...onlineSockets.values()].includes(userId)) {
      io.emit('presence', { userId, online: false });
    }
    if (typeof cb === 'function') cb({ success: true });
    socket.disconnect(true);
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (activeSessions.get(code)?.socket === socket) {
      activeSessions.delete(code);
    }
    onlineSockets.delete(socket.id);
    if (![...onlineSockets.values()].includes(userId)) {
      io.emit('presence', { userId, online: false });
    }
  });

  socket.conn.on('close', () => {
    if (activeSessions.get(code)?.socket === socket) {
      activeSessions.delete(code);
    }
  });
});

function formatMessage(m) {
  const reactions = {};
  if (m.reactions) {
    m.reactions.split(',').forEach(r => {
      const idx = r.indexOf(':');
      if (idx !== -1) {
        const emoji = r.slice(0, idx);
        const user = r.slice(idx + 1);
        if (!reactions[emoji]) reactions[emoji] = [];
        reactions[emoji].push(user);
      }
    });
  }
  let url = null;
  if (m.filename && m.type !== 'gif') {
    url = `/uploads/${folderFor(m.type)}/${m.filename}`;
  }
  if (m.type === 'gif' && m.content) url = m.content;

  let replyTo = m.reply_to || null;
  let replyContent = null;
  let replySender = null;
  if (replyTo) {
    if (m.reply_sender !== undefined) {
      replyContent = m.reply_type === 'text' ? m.reply_content : (m.reply_type ? `[${m.reply_type}]` : null);
      replySender = m.reply_sender;
    } else {
      const replyMsg = db.prepare('SELECT sender, type, content FROM messages WHERE id = ?').get(replyTo);
      if (replyMsg) {
        replyContent = replyMsg.type === 'text' ? replyMsg.content : `[${replyMsg.type}]`;
        replySender = replyMsg.sender;
      }
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
    scheduledAt: m.scheduled_at || 0,
    status: m.status || 'sent',
    createdAt: m.created_at,
    readAt: m.read_at,
    reactions,
  };
}

// ── Self-destruct scheduling ──
function deleteMessageFiles(msg) {
  if (msg && msg.filename) {
    const filePath = path.join(uploadsDir, folderFor(msg.type), msg.filename);
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
    doDelete();
    return;
  }
  setTimeout(doDelete, delay);
}

try {
  const sdRows = db.prepare('SELECT id, created_at, self_destruct FROM messages WHERE self_destruct > 0').all();
  sdRows.forEach(r => scheduleSelfDestruct(r.id, r.self_destruct, r.created_at));
} catch (e) { console.error('self-destruct schedule error:', e.message); }

// ── REST API ──

// Login
app.post('/api/login', (req, res) => {
  const { code, deviceId } = req.body || {};
  const entry = findCode(code);

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!entry) {
    if (isLoginRateLimited(ip)) {
      return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    }
    return res.status(401).json({ error: 'Invalid code' });
  }

  resetLoginAttempts(ip);

  // Check if session is already active on another device
  const existing = activeSessions.get(code);
  const now = Date.now();
  if (existing && existing.socket && existing.socket.connected && (now - existing.lastSeen <= 60000)) {
    if (deviceId && existing.deviceId && existing.deviceId !== deviceId) {
      return res.status(409).json({ error: 'Code already in use on another device', code: 'CODE_IN_USE' });
    }
  }

  const token = createSessionToken(entry);
  const isAdmin = entry.role === 'admin';

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
    token,
  });
});

// ── Admin API ──

function requireAdmin(req, res, next) {
  const code = req.headers['x-admin-code'] || req.body?.adminCode;
  const entry = findCode(code);
  if (entry && entry.role === 'admin') return next();
  const token = req.headers['x-session'];
  const sess = verifySessionToken(token);
  if (sess && sess.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
}

// Generate new partner code
app.post('/api/admin/generate-code', requireAdmin, (req, res) => {
  const name = req.body.name || 'Partner';
  const customCode = (req.body.customCode || '').trim().toUpperCase();
  let newCode;
  if (customCode) {
    if (customCode.length < 4) return res.status(400).json({ error: 'Code must be at least 4 characters' });
    const existing = db.prepare("SELECT * FROM access_codes WHERE code = ?").get(customCode);
    if (existing && existing.active === 1 && existing.role === 'partner') return res.status(400).json({ error: 'This code is currently active' });
    newCode = customCode;
  } else {
    do { newCode = generateCode(); } while (findCode(newCode));
  }
  db.prepare("UPDATE access_codes SET active = 0 WHERE role = 'partner'").run();
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
  const session = activeSessions.get(code);
  if (session && session.socket && session.socket.connected) {
    session.socket.emit('revoked', { message: 'Your access has been revoked by admin. 💔' });
    session.socket.disconnect(true);
  }
  activeSessions.delete(code);
  res.json({ success: true, kicked: !!session });
});

// Kick a session (force disconnect)
app.post('/api/admin/kick-session', requireAdmin, (req, res) => {
  const { code } = req.body;
  const session = activeSessions.get(code);
  if (!session) return res.status(404).json({ error: 'No active session for this code' });
  try {
    session.socket?.emit('revoked', { message: 'Your session has been ended by admin. 💔' });
    session.socket?.disconnect(true);
  } catch (_) {}
  activeSessions.delete(code);
  res.json({ success: true });
});

// List active sessions
app.get('/api/admin/sessions', requireAdmin, (req, res) => {
  const sessions = [];
  activeSessions.forEach((session, code) => {
    sessions.push({
      code,
      name: session.name,
      role: session.role,
      deviceId: session.deviceId ? session.deviceId.slice(0, 8) + '...' : 'unknown',
      connectedAt: session.connectedAt,
      lastSeen: session.lastSeen,
      connected: Boolean(session.socket && session.socket.connected),
    });
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
  const { picUrl, target } = req.body;
  if (!picUrl) return res.status(400).json({ error: 'Picture URL is required' });
  const role = target === 'partner' ? 'partner' : 'admin';
  db.prepare("UPDATE access_codes SET profile_pic = ? WHERE role = ? AND active = 1").run(picUrl, role);
  res.json({ success: true, profile_pic: picUrl });
});

// Change admin code
app.post('/api/admin/change-admin-code', requireAdmin, (req, res) => {
  const { newCode } = req.body;
  if (!newCode || newCode.trim().length < 4) return res.status(400).json({ error: 'Code must be at least 4 characters' });
  const code = newCode.trim();
  const existing = db.prepare("SELECT * FROM access_codes WHERE code = ?").get(code);
  if (existing && existing.active === 1) return res.status(400).json({ error: 'This code is currently active' });
  try {
    db.exec('BEGIN TRANSACTION');
    db.prepare("UPDATE access_codes SET active = 0 WHERE role = 'admin'").run();
    if (existing) {
      db.prepare("UPDATE access_codes SET active = 1, role = 'admin', name = ?, created_at = ? WHERE code = ?")
        .run(ADMIN_NAME, Date.now(), code);
    } else {
      db.prepare("INSERT INTO access_codes (code, role, name, created_at, active) VALUES (?, 'admin', ?, ?, 1)")
        .run(code, ADMIN_NAME, Date.now());
    }
    db.exec('COMMIT');
    res.json({ code, message: 'Admin code changed. Use the new code from now on.' });
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: 'Failed to change admin code: ' + e.message });
  }
});

// Upload file
app.post('/api/upload', requireSession, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const file = req.file;
  const ext = (path.extname(file.originalname) || '').toLowerCase();

  const dangerousExts = ['.html', '.htm', '.svg', '.exe', '.js', '.mjs', '.php', '.sh', '.py'];
  if (dangerousExts.includes(ext) || !ALLOWED_MIME_TYPES.has(file.mimetype)) {
    try { fs.unlinkSync(file.path); } catch (_) {}
    return res.status(415).json({ error: 'Unsupported file type' });
  }

  let type = 'photo';
  if (file.mimetype.startsWith('video/')) type = 'video';
  else if (file.mimetype.startsWith('audio/')) type = 'audio';
  else if (file.mimetype === 'image/gif') type = 'gif';

  // Compress photos (not gifs, videos, or audio)
  if (type === 'photo') {
    try {
      const metadata = await sharp(file.path).metadata();
      if (!metadata || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
        try { fs.unlinkSync(file.path); } catch (_) {}
        return res.status(415).json({ error: 'Unsupported file type' });
      }
      const compressed = await sharp(file.path)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
      fs.writeFileSync(file.path, compressed);
      const stat = fs.statSync(file.path);
      file.size = stat.size;
    } catch (e) {
      console.error('sharp verify/compress error:', e.message);
      try { fs.unlinkSync(file.path); } catch (_) {}
      return res.status(415).json({ error: 'Unsupported image file' });
    }
  }

  const folder = folderFor(type);
  res.json({
    url: `/uploads/${folder}/${file.filename}`,
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
    type,
  });
});

// Get message history
app.get('/api/messages', requireSession, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 200);
  const offset = parseInt(req.query.offset || '0', 10);
  const rows = getMessages.all(limit, offset);
  res.json(rows.map(formatMessage));
});

// Get bookmarked messages
app.get('/api/bookmarks', requireSession, (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, 
      p.sender AS reply_sender, p.type AS reply_type, p.content AS reply_content,
      (SELECT GROUP_CONCAT(r.emoji || ':' || r.user, ',') FROM reactions r WHERE r.message_id = m.id) as reactions 
    FROM messages m 
    LEFT JOIN messages p ON m.reply_to = p.id
    WHERE m.bookmarked = 1 ORDER BY m.created_at DESC
  `).all();
  res.json(rows.map(formatMessage));
});

// Health check
app.get('/api/health', (req, res) => {
  const distinctUsers = new Set(onlineSockets.values()).size;
  res.json({ status: 'ok', uptime: process.uptime(), users: distinctUsers });
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
        const filePath = path.join(uploadsDir, folderFor(type), row.filename);
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    }
    const info = db.prepare('DELETE FROM messages WHERE type = ? AND created_at < ?').run(type, cutoff);
    if (info.changes > 0) console.log(`[cleanup] Removed ${info.changes} old ${type} messages`);
  }
}

runCleanup();
const cleanupInterval = (parseInt(process.env.CLEANUP_INTERVAL_HOURS || '24', 10)) * 60 * 60 * 1000;
const cleanupTimer = setInterval(runCleanup, cleanupInterval);
cleanupTimer.unref();

// Scheduled message checker (runs every 10 seconds)
const schedTimer = setInterval(() => {
  const now = Date.now();
  const due = db.prepare("SELECT * FROM messages WHERE status = 'scheduled' AND scheduled_at <= ?").all(now);
  due.forEach(msg => {
    db.prepare("UPDATE messages SET status = 'sent' WHERE id = ?").run(msg.id);
    const formatted = formatMessage({ ...msg, status: 'sent', scheduled_at: msg.scheduled_at });
    io.emit('message', formatted);
  });
}, 10000);
schedTimer.unref();

// ── Start server ──
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  💬 ${APP_NAME} running on http://0.0.0.0:${PORT}`);
  console.log(`  📱 Local:  http://localhost:${PORT}`);
  console.log(`  🌐 LAN:    http://<your-ip>:${PORT}\n`);
});

// Graceful shutdown
function shutdown() {
  clearInterval(cleanupTimer);
  clearInterval(schedTimer);
  clearInterval(sessionSweepInterval);
  server.close(() => {
    try { db.close(); } catch (_) {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
