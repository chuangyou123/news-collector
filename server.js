const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ── 管理员 IP 白名单 ──────────────────────────────
const ADMIN_IPS = ['26.100.68.199', '192.168.10.21', '127.0.0.1', '::1', '::ffff:127.0.0.1', '2409:8a55:e1:fbe4:6447:5fe:90ed:7749'];

// ── 管理员密钥（256字符强密钥，可通过环境变量 ADMIN_KEY 覆盖）────
const ADMIN_KEY = process.env.ADMIN_KEY || '2d384f9ba42ae0aac8a0e65d4ef40a3698969866981f4d10676dddf923778b9b98d40f89546ce4aa95e414c1caad064f91d78fa97ffbdca8dd8e35120653fc29f019bf4582ab2e18159aff67f44a1eb658bb44776503f304233ad4edc62b08e3b9b1ebcb0c411da948bbf1824a2586643d6c29b87a80ec4153b37051e0d67359';

// 验证管理员密钥
function verifyAdminKey(rawKey) {
  if (!rawKey || rawKey.length < 4) return false;
  return rawKey === ADMIN_KEY;
}

// ── 数据文件路径 ──────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const NEWS_FILE = path.join(DATA_DIR, 'news.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');

function initDataFile(fp, def) {
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, JSON.stringify(def, null, 2), 'utf-8');
}
initDataFile(NEWS_FILE, []);
initDataFile(USERS_FILE, {});
initDataFile(TOKENS_FILE, {});

function readJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); }
  catch { return fp === NEWS_FILE ? [] : {}; }
}
function writeJSON(fp, data) {
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
}

// ── 防注入清理 ────────────────────────────────────
function sanitize(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&#34;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
    .replace(/\$/g, '&#36;')
    .trim();
}
function validateContent(text) {
  const len = [...text.trim()].length;
  if (len < 5) return '内容至少 5 个字符';
  if (len > 500) return '内容最多 500 个字符';
  return null;
}

// ── 密码 ──────────────────────────────────────────
function hashPassword(pw, salt) {
  return crypto.pbkdf2Sync(pw, salt, 10000, 64, 'sha512').toString('hex');
}
function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

// ── Token ─────────────────────────────────────────
function createToken(username) {
  const tokens = readJSON(TOKENS_FILE);
  const token = crypto.randomBytes(32).toString('hex');
  tokens[token] = username;
  writeJSON(TOKENS_FILE, tokens);
  return token;
}
function verifyToken(token) {
  const tokens = readJSON(TOKENS_FILE);
  return tokens[token] || null;
}
function removeToken(token) {
  const tokens = readJSON(TOKENS_FILE);
  delete tokens[token];
  writeJSON(TOKENS_FILE, tokens);
}

// ── IP ────────────────────────────────────────────
function getClientIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || req.ip || '127.0.0.1';
}

function isAdminIP(req) {
  let ip = getClientIP(req);
  const pct = ip.indexOf('%');
  if (pct !== -1) ip = ip.slice(0, pct);
  return ADMIN_IPS.includes(ip);
}

function getUserRole(username) {
  const users = readJSON(USERS_FILE);
  return (users[username] && users[username].role) || 'user';
}
function isAdminUser(username) {
  const r = getUserRole(username);
  return r === 'admin' || r === 'superadmin';
}
function isSuperAdmin(username) {
  return getUserRole(username) === 'superadmin';
}

// ── 头像颜色 ──────────────────────────────────────
function getAvatarColor(name) {
  const colors = [
    '#FF6B6B','#FF9F43','#FECA57','#54A0FF','#5F27CD',
    '#01A3A4','#F368E0','#2ED573','#FF6348','#7BED9F',
    '#70A1FF','#5352ED','#FF4757','#1E90FF','#2ED573'
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

// ── IP 已注册检查 ────────────────────────────────
function ipAlreadyRegistered(ip) {
  const users = readJSON(USERS_FILE);
  for (const k of Object.keys(users)) {
    if (users[k].ip === ip) return users[k].username;
  }
  return null;
}

// ── 排行榜 ────────────────────────────────────────
function getLeaderboard(users) {
  return Object.values(users)
    .filter(u => !u.banned)
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

// ── 中间件 ────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers['authorization'] || req.query.token;
  if (!token) return res.status(401).json({ error: '请先登录' });
  const username = verifyToken(token);
  if (!username) return res.status(401).json({ error: '登录已过期，请重新登录' });
  req.currentUser = username;
  next();
}

function adminMiddleware(req, res, next) {
  if (!isAdminIP(req)) {
    // 也允许 admin/superadmin 角色用户
    const token = req.headers['x-user-token'] || req.headers['authorization'] || '';
    const username = verifyToken(token);
    if (!username || !isAdminUser(username)) {
      return res.status(403).json({ error: '无管理员权限' });
    }
  }
  const key = req.headers['x-admin-key'];
  if (!verifyAdminKey(key)) {
    return res.status(403).json({ error: '管理员密钥错误' });
  }
  next();
}

// ── 静态文件 ──────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ═══════════════════════════════════════════════════
//  公开 API
// ═══════════════════════════════════════════════════

// 注册
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: '请输入昵称' });
  if (!password || password.length < 4) return res.status(400).json({ error: '密码至少 4 位' });

  const uname = username.trim();
  if (!/^[\w\u4e00-\u9fa5]{2,20}$/.test(uname)) {
    return res.status(400).json({ error: '昵称 2-20 个字符，仅限中英文、数字、下划线' });
  }

  const users = readJSON(USERS_FILE);
  if (users[uname]) return res.status(400).json({ error: '该昵称已被注册' });

  const ip = getClientIP(req);
  const existing = ipAlreadyRegistered(ip);
  if (existing) return res.status(400).json({ error: `该 IP 已注册过账号「${existing}」，每个 IP 只能注册一次` });

  const salt = makeSalt();
  users[uname] = {
    username: uname,
    passwordHash: hashPassword(password, salt),
    salt,
    ip,
    count: 0,
    banned: false,
    role: uname === 'winster' ? 'superadmin' : 'user',
    avatar: getAvatarColor(uname),
    createdAt: new Date().toISOString()
  };
  writeJSON(USERS_FILE, users);
  const token = createToken(uname);
  console.log(`✅ 新用户注册: ${uname}  (IP: ${ip})`);
  return res.json({ success: true, token, username: uname });
});

// 登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入昵称和密码' });

  const uname = username.trim();
  const users = readJSON(USERS_FILE);
  const user = users[uname];
  if (!user) return res.status(400).json({ error: '用户不存在，请先注册' });

  // ⭐ 封禁检查
  if (user.banned) return res.status(403).json({ error: '该账号已被封禁' });

  if (hashPassword(password, user.salt) !== user.passwordHash) {
    return res.status(400).json({ error: '密码错误' });
  }

  const token = createToken(uname);
  console.log(`🔑 用户登录: ${uname}`);
  return res.json({ success: true, token, username: uname });
});

// 退出
app.post('/api/logout', (req, res) => {
  const token = req.headers['authorization'] || req.query.token;
  if (token) removeToken(token);
  return res.json({ success: true });
});

// 验证 token
app.get('/api/me', (req, res) => {
  const token = req.headers['authorization'] || req.query.token;
  if (!token) return res.status(401).json({ error: '未登录' });
  const username = verifyToken(token);
  if (!username) return res.status(401).json({ error: '登录已过期' });
  return res.json({ username });
});

// 获取新闻列表（置顶优先）
app.get('/api/news', (req, res) => {
  const news = readJSON(NEWS_FILE);
  // 置顶在前，其余按时间倒序
  const pinned = news.filter(n => n.pinned);
  const unpinned = news.filter(n => !n.pinned);
  res.json([...pinned, ...unpinned]);
});

// 发布新闻
app.post('/api/news', authMiddleware, (req, res) => {
  let { content } = req.body;
  const username = req.currentUser;

  // 防注入清理
  content = sanitize(content);

  // 内容校验
  const err = validateContent(content);
  if (err) return res.status(400).json({ error: err });

  const users = readJSON(USERS_FILE);
  if (users[username] && users[username].banned) {
    return res.status(403).json({ error: '该账号已被封禁，无法发布新闻' });
  }

  const news = readJSON(NEWS_FILE);
  const newsItem = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    username,
    content,
    pinned: false,
    time: new Date().toISOString()
  };

  news.unshift(newsItem);
  writeJSON(NEWS_FILE, news);

  if (users[username]) { users[username].count++; writeJSON(USERS_FILE, users); }

  io.emit('news-added', newsItem);
  io.emit('leaderboard-updated', getLeaderboard(users));

  res.json({ success: true, news: newsItem });
});

// ═══════════════════════════════════════════════════
//  管理员 API（仅白名单 IP 可访问）
// ═══════════════════════════════════════════════════

// 检查当前用户是否为管理员（IP 白名单 或 用户角色为admin）
app.get('/api/admin/check', (req, res) => {
  if (isAdminIP(req)) return res.json({ allowed: true });
  // 也检查用户 token 的角色
  const token = req.headers['authorization'] || req.query.token;
  const username = verifyToken(token);
  if (username && isAdminUser(username)) return res.json({ allowed: true });
  res.json({ allowed: false });
});

// 验证管理员密钥
app.post('/api/admin/auth', (req, res) => {
  // IP 白名单 或 用户角色为admin/superadmin
  if (!isAdminIP(req)) {
    const token = req.headers['authorization'] || req.query.token;
    const username = verifyToken(token);
    if (!username || !isAdminUser(username)) {
      return res.status(403).json({ error: '拒绝访问' });
    }
  }
  const { key } = req.body;
  if (!verifyAdminKey(key)) {
    return res.status(403).json({ error: '密钥错误' });
  }
  // 验证通过
  console.log('🔐 管理员密钥验证通过');
  res.json({ success: true });
});

// 获取所有用户（含角色信息）
app.get('/api/admin/users', adminMiddleware, (req, res) => {
  const users = readJSON(USERS_FILE);
  const list = Object.values(users).map(u => ({
    username: u.username,
    ip: u.ip,
    count: u.count,
    banned: !!u.banned,
    role: u.role || 'user',
    createdAt: u.createdAt
  }));
  res.json(list);
});

// 获取指定日期新闻  ?date=YYYY-MM-DD（置顶优先）
app.get('/api/admin/news', adminMiddleware, (req, res) => {
  const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
  const news = readJSON(NEWS_FILE);
  const filtered = news.filter(item => item.time.slice(0, 10) === dateStr);
  const pinned = filtered.filter(n => n.pinned);
  const unpinned = filtered.filter(n => !n.pinned);
  res.json([...pinned, ...unpinned]);
});

// 删除新闻  DELETE /api/admin/news/:id
app.delete('/api/admin/news/:id', adminMiddleware, (req, res) => {
  const { id } = req.params;
  let news = readJSON(NEWS_FILE);
  const item = news.find(n => n.id === id);
  if (!item) return res.status(404).json({ error: '新闻不存在' });

  news = news.filter(n => n.id !== id);
  writeJSON(NEWS_FILE, news);

  // 减少该用户计数
  const users = readJSON(USERS_FILE);
  if (users[item.username] && users[item.username].count > 0) {
    users[item.username].count--;
    writeJSON(USERS_FILE, users);
  }

  io.emit('news-deleted', { id });
  io.emit('leaderboard-updated', getLeaderboard(users));

  console.log(`🗑 管理员删除新闻: [${item.username}] ${item.content.slice(0, 30)}...`);
  res.json({ success: true });
});

// 封禁 / 解封用户  POST /api/admin/ban  { username, banned: true/false }
app.post('/api/admin/ban', adminMiddleware, (req, res) => {
  const { username, banned } = req.body;
  if (!username) return res.status(400).json({ error: '请指定用户名' });

  const users = readJSON(USERS_FILE);
  if (!users[username]) return res.status(404).json({ error: '用户不存在' });

  users[username].banned = !!banned;
  writeJSON(USERS_FILE, users);

  // 清除该用户所有 token，强制下线
  const tokens = readJSON(TOKENS_FILE);
  for (const tk of Object.keys(tokens)) {
    if (tokens[tk] === username) delete tokens[tk];
  }
  writeJSON(TOKENS_FILE, tokens);

  // 广播排行榜更新
  io.emit('leaderboard-updated', getLeaderboard(users));

  const action = banned ? '封禁' : '解封';
  console.log(`🔒 管理员${action}用户: ${username}`);
  res.json({ success: true, action });
});

// 赋予/撤销管理员  POST /api/admin/set-role  { username, role }
// 仅超级管理员可操作
app.post('/api/admin/set-role', adminMiddleware, (req, res) => {
  const { username, role } = req.body;
  if (!username) return res.status(400).json({ error: '请指定用户名' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: '角色仅限 admin 或 user' });

  // 从 admin-key 无法知道操作者，从 req 中获取（需额外传 token）
  const token = req.headers['x-user-token'] || '';
  const operator = verifyToken(token);
  if (!operator || !isSuperAdmin(operator)) {
    return res.status(403).json({ error: '仅超级管理员可执行此操作' });
  }

  const users = readJSON(USERS_FILE);
  if (!users[username]) return res.status(404).json({ error: '用户不存在' });
  if (users[username].role === 'superadmin') return res.status(403).json({ error: '无法修改超级管理员' });

  users[username].role = role;
  writeJSON(USERS_FILE, users);

  const action = role === 'admin' ? '设为管理员' : '撤销管理员';
  console.log(`👑 ${operator} ${action}: ${username}`);
  res.json({ success: true, action });
});

// 置顶 / 取消置顶  POST /api/admin/pin  { id, pinned: true/false }
app.post('/api/admin/pin', adminMiddleware, (req, res) => {
  const { id, pinned } = req.body;
  if (!id) return res.status(400).json({ error: '请指定新闻ID' });

  const news = readJSON(NEWS_FILE);
  const item = news.find(n => n.id === id);
  if (!item) return res.status(404).json({ error: '新闻不存在' });

  item.pinned = !!pinned;
  writeJSON(NEWS_FILE, news);

  // 广播更新
  io.emit('news-pin-toggled', { id, pinned: item.pinned });

  const action = item.pinned ? '置顶' : '取消置顶';
  console.log(`📌 管理员${action}: [${item.username}] ${item.content.slice(0, 20)}...`);
  res.json({ success: true, pinned: item.pinned });
});

// 修改用户密码  POST /api/admin/reset-password  { username, newPassword }
app.post('/api/admin/reset-password', adminMiddleware, (req, res) => {
  const { username, newPassword } = req.body;
  if (!username) return res.status(400).json({ error: '请指定用户名' });
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: '新密码至少 4 位' });

  const users = readJSON(USERS_FILE);
  if (!users[username]) return res.status(404).json({ error: '用户不存在' });

  const salt = makeSalt();
  users[username].passwordHash = hashPassword(newPassword, salt);
  users[username].salt = salt;
  writeJSON(USERS_FILE, users);

  // 清除该用户所有 token，需重新登录
  const tokens = readJSON(TOKENS_FILE);
  for (const tk of Object.keys(tokens)) {
    if (tokens[tk] === username) delete tokens[tk];
  }
  writeJSON(TOKENS_FILE, tokens);

  console.log(`🔑 管理员重置 ${username} 的密码`);
  res.json({ success: true });
});

// ── Socket.IO ─────────────────────────────────────
io.on('connection', socket => {
  console.log('用户连接:', socket.id);
  socket.emit('init-data', {
    news: (() => { const n = readJSON(NEWS_FILE); const p = n.filter(x => x.pinned); const u = n.filter(x => !x.pinned); return [...p, ...u]; })(),
    leaderboard: getLeaderboard(readJSON(USERS_FILE))
  });
  socket.on('disconnect', () => {
    console.log('用户断开:', socket.id);
  });
});

// ── 启动 ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('   📰 新闻收集站 v3 — 管理员面板');
  console.log(`   管理员 IP: ${ADMIN_IPS.filter(ip => !ip.startsWith('::')).join(', ')}`);
  console.log('========================================');
  console.log(`   本地访问: http://localhost:${PORT}`);
  const os = require('os');
  for (const name of Object.keys(os.networkInterfaces())) {
    for (const iface of os.networkInterfaces()[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`   局域网访问: http://${iface.address}:${PORT}`);
      }
    }
  }
  console.log('========================================');
});
