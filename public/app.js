// ==================== State ====================
var BASE = localStorage.getItem('server-url') || (location.protocol.startsWith('http') ? location.origin : '');
let currentUser = null;
let socket = null;
let pendingFiles = [];
let typingTimeout = null;

// Level thresholds: index=level, LEVEL_XP[1]=0, LEVEL_XP[2]=5, ...
const LEVEL_XP = [0, 0, 5, 10, 40, 100, 500];
const MAX_LEVEL = 6;

function calcLevel(xp) {
  let level = 1;
  for (let l = 2; l <= MAX_LEVEL; l++) {
    if (xp >= LEVEL_XP[l]) level = l;
  }
  return level;
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ==================== Auth ====================
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.getElementById('login-form').classList.toggle('active', target === 'login');
    document.getElementById('register-form').classList.toggle('active', target === 'register');
    document.getElementById('auth-error').textContent = '';
  });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('login-name').value.trim();
  const password = document.getElementById('login-password').value;
  if (!name || !password) return showAuthError('请填写姓名和密码');

  try {
    const res = await fetch(BASE + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(data.error);
    login(data.user);
  } catch (err) {
    showAuthError('无法连接服务器 — 请确认PC防火墙已放行端口3000，手机与PC在同一WiFi');
  }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const password = document.getElementById('reg-password').value;
  if (!name || !password) return showAuthError('请填写姓名和密码');

  try {
    const res = await fetch(BASE + '/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(data.error);
    login(data.user);
  } catch (err) {
    showAuthError('无法连接服务器 — 请确认PC防火墙已放行端口3000，手机与PC在同一WiFi');
  }
});

function showAuthError(msg) {
  document.getElementById('auth-error').textContent = msg;
}

// ==================== Login & Connect ====================
function login(user) {
  currentUser = user;
  document.getElementById('auth-page').classList.add('hidden');
  document.getElementById('chat-page').classList.remove('hidden');

  updateCurrentUserDisplay();
  updateCheckinUI();

  if (currentUser.isAdmin) {
    document.getElementById('btn-admin').classList.remove('hidden');
  }

  // Connect Socket.IO — wait for connect before joining
  socket = io(BASE || undefined, { reconnection: true, reconnectionAttempts: 20, reconnectionDelay: 1000 });

  socket.on('connect', () => {
    setConnectionStatus(true);
    socket.emit('join', {
      id: currentUser.id,
      name: currentUser.name,
      avatar: currentUser.avatar,
      isAdmin: currentUser.isAdmin
    });
  });

  socket.on('disconnect', () => setConnectionStatus(false));
  socket.on('connect_error', () => setConnectionStatus(false));

  setupSocketHandlers();
}

// ==================== Checkin ====================
function updateCheckinUI() {
  const btn = document.getElementById('btn-checkin');
  const daysEl = document.getElementById('checkin-days');
  if (!btn || !daysEl) return;

  if (currentUser.lastCheckinDate === todayStr()) {
    setCheckedInState(btn, daysEl);
  } else {
    btn.disabled = false;
    btn.textContent = '签到 +5';
    btn.classList.remove('checked-in');
    const n = currentUser.consecutiveDays || 0;
    daysEl.textContent = n > 0 ? `已连续签到 ${n} 天` : '';
  }
}

function setCheckedInState(btn, daysEl) {
  btn.disabled = true;
  btn.textContent = '今日已签到';
  btn.classList.add('checked-in');
  const n = currentUser.consecutiveDays || 1;
  daysEl.textContent = `已连续签到 ${n} 天`;
}

document.getElementById('btn-checkin').addEventListener('click', async () => {
  if (!currentUser) return;
  const btn = document.getElementById('btn-checkin');
  btn.disabled = true;
  btn.textContent = '签到中...';

  try {
    const res = await fetch(BASE + '/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    });
    const data = await res.json();

    if (res.ok) {
      currentUser.xp = data.xp;
      currentUser.consecutiveDays = data.consecutiveDays;
      currentUser.lastCheckinDate = data.lastCheckinDate;
      setCheckedInState(btn, document.getElementById('checkin-days'));
      showToast(data.leveledUp ? `🎉 升级到 LV.${data.level}！` : '签到成功 +5 经验');
    } else if (res.status === 409) {
      currentUser.lastCheckinDate = todayStr();
      setCheckedInState(btn, document.getElementById('checkin-days'));
      showToast('今天已经签到过了');
    } else {
      btn.disabled = false;
      btn.textContent = '签到 +5';
      showToast(data.error || '签到失败');
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '签到 +5';
  }
});

// ==================== XP Bar ====================
function renderXPBar() {
  const xp = currentUser.xp || 0;
  const level = calcLevel(xp);
  const isMax = level >= MAX_LEVEL;

  document.getElementById('xp-level').textContent = level;
  document.getElementById('xp-consecutive').textContent =
    (currentUser.consecutiveDays || 0) > 0 ? `已连续签到 ${currentUser.consecutiveDays} 天` : '';

  const bar = document.getElementById('xp-bar');
  const hint = document.getElementById('xp-max-hint');
  const text = document.getElementById('xp-text');
  const container = document.querySelector('.xp-bar-container');

  if (isMax) {
    bar.style.width = '100%';
    text.textContent = `${xp} XP`;
    hint.classList.remove('hidden');
    container.style.display = 'none';
  } else {
    const prevXp = LEVEL_XP[level];
    const nextXp = LEVEL_XP[level + 1] || LEVEL_XP[MAX_LEVEL];
    const pct = Math.min(100, ((xp - prevXp) / (nextXp - prevXp)) * 100);
    bar.style.width = pct + '%';
    text.textContent = `${xp} / ${nextXp}`;
    hint.classList.add('hidden');
    container.style.display = '';
  }
}

// ==================== Toast ====================
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#e94560;color:#fff;padding:10px 24px;border-radius:8px;font-size:15px;z-index:9999;transition:opacity .3s;pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

function setConnectionStatus(connected) {
  const el = document.getElementById('connection-status');
  if (!el) return;
  el.textContent = connected ? '已连接' : '连接中...';
  el.style.color = connected ? '#4ecca3' : '#e94560';
  document.getElementById('message-input').disabled = !connected;
  document.getElementById('btn-send').disabled = !connected;
}

function updateCurrentUserDisplay() {
  const container = document.getElementById('current-user-info');
  const avatarUrl = currentUser.avatar
    ? `<img src="${currentUser.avatar}" alt="">`
    : (currentUser.isAdmin ? '<span>帅</span>' : '<span>🐷</span>');
  container.innerHTML = `
    <div class="member-avatar" style="background:${currentUser.isAdmin ? '#c0392b' : '#e8a0b0'}">${avatarUrl}</div>
    <span>${currentUser.name}${currentUser.isAdmin ? ' <span class="member-admin-badge">管理</span>' : ''}</span>
  `;
}

// ==================== Socket Handlers ====================
function setupSocketHandlers() {
  socket.on('member-list', (data) => {
    document.getElementById('member-count').textContent = data.total;
    onlineMemberCache = data.online;
    renderMemberList(data.online);
  });

  socket.on('message-history', (messages) => {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    if (messages.length === 0) {
      container.innerHTML = `<div class="welcome-msg"><div class="welcome-icon">🏢</div><h2>欢迎来到 311大厦B</h2><p>开始畅聊吧！</p></div>`;
    }
    messages.forEach(msg => appendMessage(msg));
    scrollToBottom();
  });

  socket.on('new-message', (msg) => {
    // Remove welcome msg if present
    const welcome = document.querySelector('.welcome-msg');
    if (welcome) welcome.remove();
    appendMessage(msg);
    scrollToBottom();
  });

  socket.on('user-joined', (data) => {
    systemMessage(`${data.name} 加入了群聊`);
  });

  socket.on('user-left', (data) => {
    systemMessage(`${data.name} 离开了群聊`);
  });

  socket.on('user-typing', (data) => {
    const indicator = document.getElementById('typing-indicator');
    indicator.textContent = `${data.name} 正在输入...`;
    indicator.classList.remove('hidden');
  });

  socket.on('user-stop-typing', () => {
    document.getElementById('typing-indicator').classList.add('hidden');
  });

  socket.on('messages-cleared', () => {
    document.getElementById('chat-messages').innerHTML = `
      <div class="welcome-msg"><div class="welcome-icon">🏢</div><h2>欢迎来到 311大厦B</h2><p>聊天记录已清空</p></div>`;
  });

  socket.on('new-registration', (data) => {
    window._registrations = window._registrations || [];
    window._registrations.push(data);
    updateAdminNotifications();
  });

  socket.on('message-recalled', (data) => {
    document.querySelector(`.message[data-id="${data.id}"]`)?.remove();
    systemMessage(`${data.userName} 撤回了一条消息`);
  });

  socket.on('user-muted', (data) => {
    if (data.userId === currentUser.id) {
      startMuteCountdown(data.until);
    }
    // Re-render member list to show mute badge
    const entry = onlineMemberCache.find(m => m.userId === data.userId);
    if (entry) entry.muteUntil = data.until;
    renderMemberListFromCache();
  });

  socket.on('user-unmuted', (data) => {
    if (data.userId === currentUser.id) {
      clearMuteState();
    }
    const entry = onlineMemberCache.find(m => m.userId === data.userId);
    if (entry) entry.muteUntil = null;
    renderMemberListFromCache();
  });

  socket.on('muted-blocked', () => {
    systemMessage('你已被禁言');
  });
}

let muteTimer = null;
let onlineMemberCache = [];

function startMuteCountdown(until) {
  const input = document.getElementById('message-input');
  clearMuteState();
  function tick() {
    const remaining = until - Date.now();
    if (remaining <= 0) {
      clearMuteState();
      return;
    }
    const sec = Math.ceil(remaining / 1000);
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    input.disabled = true;
    input.placeholder = `你已被禁言，剩余 ${min}:${String(s).padStart(2, '0')}`;
    muteTimer = setTimeout(tick, 1000);
  }
  tick();
}

function clearMuteState() {
  if (muteTimer) { clearTimeout(muteTimer); muteTimer = null; }
  const input = document.getElementById('message-input');
  input.disabled = false;
  input.placeholder = '输入消息...';
}

function renderMemberListFromCache() {
  renderMemberList(onlineMemberCache);
}

// ==================== Message Rendering ====================
function appendMessage(msg) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.classList.add('message');
  div.dataset.id = msg.id;
  div.dataset.userId = msg.userId;
  if (msg.userId === currentUser.id) div.classList.add('own');

  const isAdmin = msg.userId && msg.userId.startsWith('admin-');
  const defaultAvatar = isAdmin ? '帅' : '🐷';
  const avatarBg = isAdmin ? '#c0392b' : '#e8a0b0';

  let avatarHTML;
  if (msg.userAvatar) {
    avatarHTML = `<img src="${msg.userAvatar}" alt="">`;
  } else {
    avatarHTML = `<span>${defaultAvatar}</span>`;
  }

  let contentHTML = '';
  if (msg.type === 'text') {
    contentHTML = escapeHtml(msg.content);
  } else if (msg.type === 'image') {
    contentHTML = `<img src="${escapeHtml(msg.content)}" alt="图片" onclick="window.open('${escapeHtml(msg.content)}')">`;
  } else if (msg.type === 'file') {
    contentHTML = `<a class="file-link" href="${escapeHtml(msg.content)}" target="_blank" download="${escapeHtml(msg.fileName || 'file')}">📄 ${escapeHtml(msg.fileName || '文件')} (${formatSize(msg.fileSize || 0)})</a>`;
  }

  const time = new Date(msg.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  div.innerHTML = `
    <div class="msg-avatar" style="background:${avatarBg}">${avatarHTML}</div>
    <div class="msg-body">
      <div class="msg-header">
        <span class="msg-name">${escapeHtml(msg.userName)}${isAdmin ? ' <span class="member-admin-badge">管理</span>' : ''}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="msg-content">${contentHTML}</div>
    </div>
  `;
  container.appendChild(div);
}

function systemMessage(text) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.style.cssText = 'text-align:center;color:#666;font-size:13px;padding:4px 0;';
  div.textContent = text;
  container.appendChild(div);
  scrollToBottom();
}

// ==================== Member List ====================
function renderMemberList(online) {
  const list = document.getElementById('member-list');
  list.innerHTML = online.map(u => {
    const isMuted = u.muteUntil && u.muteUntil > Date.now();
    const muteBadge = isMuted ? ` <span class="member-mute-badge" title="禁言至 ${new Date(u.muteUntil).toLocaleTimeString('zh-CN')}">🔇</span>` : '';
    const avatarUrl = u.avatar ? `<img src="${u.avatar}" alt="">` : (u.isAdmin ? '<span>帅</span>' : '<span>🐷</span>');
    const bg = u.isAdmin ? '#c0392b' : '#e8a0b0';
    return `
      <div class="member-item${isMuted ? ' member-muted' : ''}" data-user-id="${u.userId}">
        <div class="member-status"${isMuted ? ' style="background:#e94560"' : ''}></div>
        <div class="member-avatar" style="background:${bg}">${avatarUrl}</div>
        <span class="member-name">${escapeHtml(u.name)}${u.isAdmin ? '<span class="member-admin-badge">管理</span>' : ''}${muteBadge}</span>
      </div>
    `;
  }).join('');
}

// ==================== Send Message ====================
document.getElementById('btn-send').addEventListener('click', sendTextMessage);
document.getElementById('message-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendTextMessage();
  }
});

document.getElementById('message-input').addEventListener('input', () => {
  if (typingTimeout) clearTimeout(typingTimeout);
  socket.emit('typing');
  typingTimeout = setTimeout(() => {
    socket.emit('stop-typing');
  }, 2000);
});

function sendTextMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('send-message', { content: text });
  input.value = '';
  input.style.height = 'auto';
}

// ==================== Image & File ====================
document.getElementById('btn-image').addEventListener('click', () => {
  const input = document.getElementById('file-input');
  input.accept = 'image/*';
  input.click();
});

document.getElementById('btn-file').addEventListener('click', () => {
  const input = document.getElementById('doc-input');
  input.accept = '*/*';
  input.click();
});

document.getElementById('file-input').addEventListener('change', handleFiles);
document.getElementById('doc-input').addEventListener('change', handleFiles);

function handleFiles(e) {
  const files = Array.from(e.target.files);
  const preview = document.getElementById('file-preview');
  preview.classList.remove('hidden');
  preview.innerHTML = '';

  files.forEach((file, i) => {
    pendingFiles.push(file);
    const item = document.createElement('div');
    item.classList.add('preview-item');
    item.innerHTML = `
      <span>${file.name} (${formatSize(file.size)})</span>
      <span class="preview-remove" data-index="${pendingFiles.length - 1}">✕</span>
    `;
    preview.appendChild(item);
  });

  // Remove handlers
  preview.querySelectorAll('.preview-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      pendingFiles.splice(idx, 1);
      btn.parentElement.remove();
      if (pendingFiles.length === 0) preview.classList.add('hidden');
    });
  });

  // Auto send files
  sendPendingFiles();
  e.target.value = '';
}

async function sendPendingFiles() {
  const files = [...pendingFiles];
  pendingFiles = [];
  document.getElementById('file-preview').classList.add('hidden');

  for (const file of files) {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(BASE + '/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        socket.emit('send-file', {
          content: data.url,
          fileType: file.type,
          fileName: file.name,
          fileSize: file.size
        });
      }
    } catch (err) {
      console.error('Upload failed:', err);
    }
  }
}

// ==================== Settings ====================
document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.remove('hidden');
  updateAvatarPreview();
  renderXPBar();
});

document.getElementById('btn-save-avatar').addEventListener('click', () => {
  document.getElementById('avatar-input').click();
});

document.getElementById('avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('avatar', file);
  formData.append('userId', currentUser.id);

  try {
    const res = await fetch(BASE + '/api/avatar', { method: 'POST', body: formData });
    const data = await res.json();
    if (res.ok) {
      currentUser.avatar = data.avatar;
      updateAvatarPreview();
      updateCurrentUserDisplay();
      socket.emit('avatar-updated', { avatar: data.avatar });
    }
  } catch (err) {
    console.error(err);
  }
  e.target.value = '';
});

document.getElementById('btn-reset-avatar').addEventListener('click', async () => {
  currentUser.avatar = null;
  updateAvatarPreview();
  updateCurrentUserDisplay();
  socket.emit('avatar-updated', { avatar: null });
});

function updateAvatarPreview() {
  const preview = document.getElementById('avatar-preview');
  const isAdmin = currentUser && currentUser.isAdmin;
  if (currentUser && currentUser.avatar) {
    preview.innerHTML = `<img src="${currentUser.avatar}" alt="">`;
  } else {
    preview.innerHTML = `<span id="avatar-text">${isAdmin ? '帅' : '🐷'}</span>`;
  }
}

// Modal close
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.closest('.modal').classList.add('hidden');
  });
});

// Click outside modal to close
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
});

// ==================== Admin ====================
document.getElementById('btn-admin').addEventListener('click', async () => {
  document.getElementById('admin-modal').classList.remove('hidden');
  await loadAdminData();
});

async function loadAdminData() {
  try {
    const res = await fetch(BASE + '/api/admin/users?userId=' + currentUser.id);
    const users = await res.json();
    if (!res.ok) return;

    const tbody = document.getElementById('admin-user-list');
    tbody.innerHTML = users.map(u => `
      <tr>
        <td>${escapeHtml(u.name)}${u.isAdmin ? ' <span class="member-admin-badge">管理</span>' : ''}</td>
        <td>${new Date(u.createdAt).toLocaleString('zh-CN')}</td>
      </tr>
    `).join('');

    updateAdminNotifications();
  } catch (err) {
    console.error(err);
  }
}

function updateAdminNotifications() {
  const container = document.getElementById('admin-notifications');
  const regs = window._registrations || [];
  if (regs.length === 0) {
    container.innerHTML = '<p style="color:#888">暂无新注册通知</p>';
  } else {
    container.innerHTML = regs.reverse().map(r =>
      `<div class="admin-notification">${escapeHtml(r.name)} 注册了 (${new Date(r.time).toLocaleString('zh-CN')})</div>`
    ).join('');
  }
}

document.getElementById('btn-clear-messages').addEventListener('click', async () => {
  if (!confirm('确定要清空所有聊天记录吗？此操作不可撤销。')) return;
  await fetch(BASE + '/api/admin/clear-messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: currentUser.id })
  });
});

// Logout
document.getElementById('btn-logout').addEventListener('click', () => {
  if (socket) socket.disconnect();
  currentUser = null;
  socket = null;
  document.getElementById('chat-page').classList.add('hidden');
  document.getElementById('auth-page').classList.remove('hidden');
  document.getElementById('login-form').reset();
  document.getElementById('register-form').reset();
});

// ==================== Context Menu ====================
const ctxMenu = document.getElementById('context-menu');
let ctxTarget = null;

document.addEventListener('contextmenu', (e) => {
  const msgEl = e.target.closest('.message');
  const memberEl = e.target.closest('.member-item');

  ctxMenu.classList.add('hidden');
  ctxMenu.innerHTML = '';
  ctxTarget = null;

  // Context menu for messages (recall)
  if (msgEl) {
    e.preventDefault();
    const msgUserId = msgEl.dataset.userId;
    if (msgUserId !== currentUser.id && !currentUser.isAdmin) return;

    const item = document.createElement('div');
    item.className = 'context-menu-item danger';
    item.textContent = '撤回';
    item.addEventListener('click', () => {
      socket.emit('recall-message', { messageId: msgEl.dataset.id });
      ctxMenu.classList.add('hidden');
    });
    ctxMenu.appendChild(item);
    positionMenu(e.clientX, e.clientY);
    ctxTarget = msgEl;
    return;
  }

  // Context menu for member items (admin: mute)
  if (memberEl && currentUser.isAdmin) {
    e.preventDefault();
    const targetUserId = memberEl.dataset.userId;
    [1, 2, 10].forEach(min => {
      const item = document.createElement('div');
      item.className = 'context-menu-item';
      item.textContent = `禁言${min}分钟`;
      item.addEventListener('click', () => {
        socket.emit('mute-user', { userId: targetUserId, minutes: min });
        ctxMenu.classList.add('hidden');
      });
      ctxMenu.appendChild(item);
    });
    positionMenu(e.clientX, e.clientY);
    ctxTarget = memberEl;
  }
});

document.addEventListener('click', () => {
  ctxMenu.classList.add('hidden');
  ctxTarget = null;
});

function positionMenu(x, y) {
  ctxMenu.classList.remove('hidden');
  const r = ctxMenu.getBoundingClientRect();
  if (x + r.width > window.innerWidth) x = window.innerWidth - r.width - 4;
  if (y + r.height > window.innerHeight) y = window.innerHeight - r.height - 4;
  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top = y + 'px';
}

// ==================== Helpers ====================
function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
