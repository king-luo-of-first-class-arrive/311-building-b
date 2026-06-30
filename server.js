const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ponytail: CORS for Capacitor WebView (cross-origin from localhost)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.static('public', {
  setHeaders: (res) => { res.set('Cache-Control', 'no-cache, no-store, must-revalidate'); }
}));
app.use('/uploads', express.static('uploads'));

// Data paths
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

// Ensure data dir and files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');

// Multer config for file uploads
const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + Buffer.from(file.originalname, 'latin1').toString('utf8'));
  }
});

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads', 'avatars')),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(Buffer.from(file.originalname, 'latin1').toString('utf8')));
  }
});

const uploadFile = multer({ storage: fileStorage, limits: { fileSize: 50 * 1024 * 1024 } });
const uploadAvatar = multer({ storage: avatarStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// Helpers
function getUsers() { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
function saveUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
function getMessages() { return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')); }
function saveMessages(msgs) {
  // Keep only last 2000 messages
  if (msgs.length > 2000) msgs = msgs.slice(-2000);
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(msgs, null, 2));
}

// Level system
const LEVEL_XP = [0, 0, 5, 10, 40, 100, 500]; // index=level
const MAX_LEVEL = 6;

function calcLevel(xp) {
  let level = 1;
  for (let l = 2; l <= MAX_LEVEL; l++) {
    if (xp >= LEVEL_XP[l]) level = l;
  }
  return level;
}

function getLocalDateStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Admin account init
function initAdmin() {
  const users = getUsers();
  if (!users.find(u => u.name === '罗文俊')) {
    const adminPassword = process.env.ADMIN_PASSWORD || 'luo20070606';
    users.push({
      id: 'admin-' + Date.now(),
      name: '罗文俊',
      password: bcrypt.hashSync(adminPassword, 10),
      avatar: null,
      isAdmin: true,
      createdAt: new Date().toISOString()
    });
    saveUsers(users);
  }
}
initAdmin();

// Online users tracking: socketId -> { userId, name, avatar, isAdmin }
const onlineUsers = new Map();

// Mutes: userId -> { until, timeoutId }
const mutes = new Map();

// ==================== API Routes ====================

// Register
app.post('/api/register', (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: '姓名和密码不能为空' });
  if (name.length > 20) return res.status(400).json({ error: '姓名不能超过20个字符' });

  const users = getUsers();
  if (users.find(u => u.name === name)) {
    return res.status(400).json({ error: '该用户名已被注册' });
  }

  const newUser = {
    id: 'user-' + Date.now(),
    name,
    password: bcrypt.hashSync(password, 10),
    avatar: null,
    isAdmin: false,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  saveUsers(users);

  // Notify admin via socket
  const adminSocket = [...onlineUsers.entries()].find(([_, u]) => u.isAdmin);
  if (adminSocket) {
    io.to(adminSocket[0]).emit('new-registration', {
      name: newUser.name,
      time: new Date().toISOString()
    });
  }

  res.json({ success: true, user: { id: newUser.id, name: newUser.name, avatar: null, isAdmin: false, xp: 0, consecutiveDays: 0, lastCheckinDate: null } });
});

// Login
app.post('/api/login', (req, res) => {
  const { name, password } = req.body;
  const users = getUsers();
  const user = users.find(u => u.name === name);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ error: '用户名或密码错误' });
  }
  res.json({ success: true, user: { id: user.id, name: user.name, avatar: user.avatar, isAdmin: user.isAdmin, xp: user.xp || 0, consecutiveDays: user.consecutiveDays || 0, lastCheckinDate: user.lastCheckinDate || null } });
});

// Get all users
app.get('/api/users', (req, res) => {
  const users = getUsers().map(u => ({ id: u.id, name: u.name, avatar: u.avatar, isAdmin: u.isAdmin }));
  res.json(users);
});

// Get admin view (all users with passwords)
app.get('/api/admin/users', (req, res) => {
  const { userId } = req.query;
  const users = getUsers();
  const requester = users.find(u => u.id === userId);
  if (!requester || !requester.isAdmin) return res.status(403).json({ error: '无权限' });
  res.json(users.map(u => ({ id: u.id, name: u.name, avatar: u.avatar, isAdmin: u.isAdmin, createdAt: u.createdAt })));
});

// Checkin
app.post('/api/checkin', (req, res) => {
  const { userId } = req.body;
  const users = getUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const today = getLocalDateStr();
  if (user.lastCheckinDate === today) {
    return res.status(409).json({ error: '今天已经签到过了' });
  }

  const yesterday = new Date(Date.now() - 86400000);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  const oldLevel = calcLevel(user.xp || 0);
  user.xp = (user.xp || 0) + 5;

  if (user.lastCheckinDate === yesterdayStr) {
    user.consecutiveDays = (user.consecutiveDays || 0) + 1;
  } else {
    user.consecutiveDays = 1;
  }
  user.lastCheckinDate = today;
  saveUsers(users);

  const newLevel = calcLevel(user.xp);
  res.json({
    xp: user.xp,
    level: newLevel,
    leveledUp: newLevel > oldLevel,
    consecutiveDays: user.consecutiveDays,
    lastCheckinDate: user.lastCheckinDate
  });
});

// Get user profile
app.get('/api/profile', (req, res) => {
  const { userId } = req.query;
  const users = getUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const xp = user.xp || 0;
  res.json({
    xp,
    level: calcLevel(xp),
    consecutiveDays: user.consecutiveDays || 0,
    lastCheckinDate: user.lastCheckinDate || null
  });
});

// Update avatar
app.post('/api/avatar', uploadAvatar.single('avatar'), (req, res) => {
  const { userId } = req.body;
  if (!req.file) return res.status(400).json({ error: '请选择头像文件' });

  const users = getUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  // Delete old avatar file
  if (user.avatar && user.avatar.startsWith('/uploads/avatars/')) {
    const oldPath = path.join(__dirname, user.avatar);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  user.avatar = '/uploads/avatars/' + req.file.filename;
  saveUsers(users);
  res.json({ success: true, avatar: user.avatar });
});

// Upload file for chat
app.post('/api/upload', uploadFile.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择文件' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// Get messages
app.get('/api/messages', (req, res) => {
  res.json(getMessages());
});

// Admin: clear all messages
app.post('/api/admin/clear-messages', (req, res) => {
  const { userId } = req.body;
  const users = getUsers();
  const requester = users.find(u => u.id === userId);
  if (!requester || !requester.isAdmin) return res.status(403).json({ error: '无权限' });
  saveMessages([]);
  io.emit('messages-cleared');
  res.json({ success: true });
});

// ==================== Socket.IO ====================

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // User joins chat
  socket.on('join', (userData) => {
    onlineUsers.set(socket.id, {
      userId: userData.id,
      name: userData.name,
      avatar: userData.avatar,
      isAdmin: userData.isAdmin
    });

    // Broadcast updated member list
    broadcastMemberList();
    // Push mute state if user is currently muted (reconnect)
    const mute = mutes.get(userData.id);
    if (mute && mute.until > Date.now()) {
      socket.emit('user-muted', { userId: userData.id, userName: userData.name, until: mute.until });
    }
    // Send recent messages to the new user
    socket.emit('message-history', getMessages().slice(-100));
    // Notify others
    socket.broadcast.emit('user-joined', { name: userData.name, avatar: userData.avatar });
  });

  // Send text message
  socket.on('send-message', (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const mute = mutes.get(user.userId);
    if (mute && mute.until > Date.now()) {
      socket.emit('muted-blocked', { until: mute.until });
      return;
    }

    const msg = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      type: 'text',
      userId: user.userId,
      userName: user.name,
      userAvatar: user.avatar,
      content: data.content.slice(0, 5000),
      time: new Date().toISOString()
    };
    const msgs = getMessages();
    msgs.push(msg);
    saveMessages(msgs);
    io.emit('new-message', msg);
  });

  // Send image/file message
  socket.on('send-file', (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const mute = mutes.get(user.userId);
    if (mute && mute.until > Date.now()) {
      socket.emit('muted-blocked', { until: mute.until });
      return;
    }

    const msg = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      type: data.fileType.startsWith('image/') ? 'image' : 'file',
      userId: user.userId,
      userName: user.name,
      userAvatar: user.avatar,
      content: data.content,
      fileName: data.fileName,
      fileSize: data.fileSize,
      time: new Date().toISOString()
    };
    const msgs = getMessages();
    msgs.push(msg);
    saveMessages(msgs);
    io.emit('new-message', msg);
  });

  // Recall message
  socket.on('recall-message', (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const msgs = getMessages();
    const idx = msgs.findIndex(m => m.id === data.messageId);
    if (idx === -1) return;
    const msg = msgs[idx];
    if (msg.userId !== user.userId && !user.isAdmin) return;
    msgs.splice(idx, 1);
    saveMessages(msgs);
    io.emit('message-recalled', { id: msg.id, userName: user.name });
  });

  // Mute user (admin only)
  socket.on('mute-user', (data) => {
    const admin = onlineUsers.get(socket.id);
    if (!admin || !admin.isAdmin) return;
    // Find target user's socket
    let targetUserId = null;
    let targetUserName = null;
    for (const [, u] of onlineUsers) {
      if (u.userId === data.userId) {
        targetUserId = u.userId;
        targetUserName = u.name;
        break;
      }
    }
    if (!targetUserId) return;
    const minutes = Math.min(Math.max(data.minutes || 1, 1), 10);
    const until = Date.now() + minutes * 60 * 1000;
    // Clear existing mute
    const existing = mutes.get(targetUserId);
    if (existing) clearTimeout(existing.timeoutId);
    const timeoutId = setTimeout(() => {
      mutes.delete(targetUserId);
      io.emit('user-unmuted', { userId: targetUserId });
      broadcastMemberList();
    }, minutes * 60 * 1000);
    mutes.set(targetUserId, { until, timeoutId });
    io.emit('user-muted', { userId: targetUserId, userName: targetUserName, until });
    broadcastMemberList();
  });

  // User typing indicator
  socket.on('typing', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      socket.broadcast.emit('user-typing', { name: user.name });
    }
  });

  socket.on('stop-typing', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      socket.broadcast.emit('user-stop-typing', { name: user.name });
    }
  });

  // Avatar updated
  socket.on('avatar-updated', (data) => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      user.avatar = data.avatar;
      broadcastMemberList();
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      io.emit('user-left', { name: user.name });
    }
    onlineUsers.delete(socket.id);
    broadcastMemberList();
  });
});

function broadcastMemberList() {
  const members = [...onlineUsers.values()].map(u => ({
    userId: u.userId,
    name: u.name,
    avatar: u.avatar,
    isAdmin: u.isAdmin,
    muteUntil: mutes.get(u.userId)?.until || null
  }));
  const totalUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).length;
  io.emit('member-list', { online: members, total: totalUsers });
}

// ==================== Start ====================

const os = require('os');
const PORT = process.env.PORT || 3000;
fs.writeFileSync(path.join(__dirname, 'server.pid'), String(process.pid));
server.listen(PORT, '0.0.0.0', () => {
  console.log(`311大厦B running on http://0.0.0.0:${PORT}`);
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`  → 手机连接地址: http://${iface.address}:${PORT}`);
      }
    }
  }
});
