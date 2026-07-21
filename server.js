const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const ADMIN_IPS = ['26.100.68.199', '192.168.10.21', '127.0.0.1', '::1', '::ffff:127.0.0.1', '2409:8a55:e1:fbe4:6447:5fe:90ed:7749'];
const ADMIN_KEY = process.env.ADMIN_KEY || '2d384f9ba42ae0aac8a0e65d4ef40a3698969866981f4d10676dddf923778b9b98d40f89546ce4aa95e414c1caad064f91d78fa97ffbdca8dd8e35120653fc29f019bf4582ab2e18159aff67f44a1eb658bb44776503f304233ad4edc62b08e3b9b1ebcb0c411da948bbf1824a2586643d6c29b87a80ec4153b37051e0d67359';

const DATA_DIR = path.join(__dirname, 'data');
const NEWS_FILE = path.join(DATA_DIR, 'news.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');
const SEED_FILE = path.join(DATA_DIR, 'seed-news.json');

function initFile(fp, def) { if (!fs.existsSync(fp)) fs.writeFileSync(fp, JSON.stringify(def, null, 2)); }
initFile(NEWS_FILE, []);
initFile(USERS_FILE, {});
initFile(TOKENS_FILE, {});

function readJSON(fp) { try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return fp === NEWS_FILE ? [] : {}; } }
function writeJSON(fp, d) { fs.writeFileSync(fp, JSON.stringify(d, null, 2)); }

// 加载示例新闻
let seedNews = [];
try {
  seedNews = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
  seedNews = seedNews.map((text, i) => ({
    id: 'seed-' + i,
    username: '📢 示例',
    content: sanitize(text),
    pinned: false,
    time: '2025-01-01T00:00:00.000Z',
    seed: true
  }));
  console.log(`📦 加载了 ${seedNews.length} 条示例新闻`);
} catch { seedNews = []; }

function sanitize(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&#34;').replace(/'/g,'&#39;').replace(/`/g,'&#96;').replace(/\$/g,'&#36;').trim();
}
function validateContent(text) { const l = [...text.trim()].length; if (l < 5) return '内容至少 5 个字符'; if (l > 500) return '内容最多 500 个字符'; return null; }
function hashPassword(pw, s) { return crypto.pbkdf2Sync(pw, s, 10000, 64, 'sha512').toString('hex'); }
function makeSalt() { return crypto.randomBytes(16).toString('hex'); }
function randToken() { return crypto.randomBytes(32).toString('hex'); }
function getAvatar(name) { const c = ['#FF6B6B','#FF9F43','#FECA57','#54A0FF','#5F27CD','#01A3A4','#F368E0','#2ED573','#FF6348','#7BED9F','#70A1FF','#5352ED','#FF4757','#1E90FF','#2ED573']; let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h); return c[Math.abs(h) % c.length]; }
function getIP(req) { const f = req.headers['x-forwarded-for']; return f ? f.split(',')[0].trim() : (req.socket.remoteAddress || req.ip || '127.0.0.1'); }
function isAdminIP(req) { let ip = getIP(req); const p = ip.indexOf('%'); if (p !== -1) ip = ip.slice(0, p); return ADMIN_IPS.includes(ip); }

function createToken(username) { const t = readJSON(TOKENS_FILE); const tk = randToken(); t[tk] = username; writeJSON(TOKENS_FILE, t); return tk; }
function verifyToken(token) { const t = readJSON(TOKENS_FILE); return t[token] || null; }
function removeToken(token) { const t = readJSON(TOKENS_FILE); delete t[token]; writeJSON(TOKENS_FILE, t); }

function getUser(username) { const u = readJSON(USERS_FILE); return u[username] || null; }
function isAdminUser(u) { const r = (getUser(u) || {}).role || 'user'; return r === 'admin' || r === 'superadmin'; }
function isSuperAdmin(u) { return (getUser(u) || {}).role === 'superadmin'; }
function ipRegistered(ip) { const u = readJSON(USERS_FILE); for (const k of Object.keys(u)) { if (u[k].ip === ip) return u[k].username; } return null; }
function getLeaderboard() { return Object.values(readJSON(USERS_FILE)).filter(u => !u.banned).sort((a, b) => b.count - a.count).slice(0, 20); }

function authMiddleware(req, res, next) { const token = req.headers['authorization'] || req.query.token; if (!token) return res.status(401).json({ error: '请先登录' }); const u = verifyToken(token); if (!u) return res.status(401).json({ error: '登录已过期' }); req.currentUser = u; next(); }
function adminMiddleware(req, res, next) { if (!isAdminIP(req)) { const token = req.headers['x-user-token'] || req.headers['authorization'] || ''; const u = verifyToken(token); if (!u || !isAdminUser(u)) return res.status(403).json({ error: '无管理员权限' }); } if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ error: '管理员密钥错误' }); next(); }

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── 重置 winster 密码 ─────────────────────────────
app.post('/api/reset-winster', (req, res) => {
  if (req.body.key !== ADMIN_KEY) return res.status(403).json({ error: '密钥错误' });
  const pw = req.body.password || 'Winster770228';
  const users = readJSON(USERS_FILE);
  const salt = makeSalt();
  users['winster'] = { username: 'winster', passwordHash: hashPassword(pw, salt), salt, ip: '0.0.0.0', count: 0, banned: false, role: 'superadmin', avatar: getAvatar('winster'), createdAt: new Date().toISOString() };
  writeJSON(USERS_FILE, users);
  res.json({ success: true, username: 'winster' });
});

// ── 公开 API ──────────────────────────────────────
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  const uname = (username || '').trim();
  if (!uname) return res.status(400).json({ error: '请输入昵称' });
  if (!password || password.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
  if (!/^[\w\u4e00-\u9fa5]{2,20}$/.test(uname)) return res.status(400).json({ error: '昵称 2-20 个字符' });
  const users = readJSON(USERS_FILE);
  if (users[uname]) return res.status(400).json({ error: '该昵称已被注册' });
  const ip = getIP(req);
  const ex = ipRegistered(ip);
  if (ex) return res.status(400).json({ error: `该 IP 已注册过「${ex}」` });
  const salt = makeSalt();
  users[uname] = { username: uname, passwordHash: hashPassword(password, salt), salt, ip, count: 0, banned: false, role: uname === 'winster' ? 'superadmin' : 'user', avatar: getAvatar(uname), createdAt: new Date().toISOString() };
  writeJSON(USERS_FILE, users);
  const token = createToken(uname);
  res.json({ success: true, token, username: uname });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const uname = (username || '').trim();
  if (!uname || !password) return res.status(400).json({ error: '请输入昵称和密码' });
  const user = getUser(uname);
  if (!user) return res.status(400).json({ error: '用户不存在' });
  if (user.banned) return res.status(403).json({ error: '该账号已被封禁' });
  if (hashPassword(password, user.salt) !== user.passwordHash) return res.status(400).json({ error: '密码错误' });
  const token = createToken(uname);
  res.json({ success: true, token, username: uname });
});

app.post('/api/logout', (req, res) => { const t = req.headers['authorization'] || req.query.token; if (t) removeToken(t); res.json({ success: true }); });
app.get('/api/me', (req, res) => { const t = req.headers['authorization'] || req.query.token; const u = verifyToken(t); if (!u) return res.status(401).json({ error: '未登录' }); res.json({ username: u }); });

// 发布Tab：仅用户新闻
app.get('/api/news', (req, res) => {
  const n = readJSON(NEWS_FILE);
  res.json([...n.filter(x => x.pinned), ...n.filter(x => !x.pinned)]);
});

// 新闻库Tab：用户+示例
app.get('/api/news/all', (req, res) => {
  const n = readJSON(NEWS_FILE);
  const userNews = [...n.filter(x => x.pinned), ...n.filter(x => !x.pinned)];
  res.json([...userNews, ...seedNews]);
});

// 下载全部新闻（纯文本，每条一行）
app.get('/api/news/download', (req, res) => {
  const n = readJSON(NEWS_FILE);
  const all = [...n.map(x => x.content), ...seedNews.map(x => x.content)];
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(all.join('\n---\n'));
});

// 新闻总数
app.get('/api/news/count', (req, res) => {
  const n = readJSON(NEWS_FILE);
  res.json({ count: n.length + seedNews.length, userCount: n.length, seedCount: seedNews.length });
});

app.post('/api/news', authMiddleware, (req, res) => {
  let { content } = req.body;
  content = sanitize(content);
  const err = validateContent(content);
  if (err) return res.status(400).json({ error: err });
  const users = readJSON(USERS_FILE);
  if (users[req.currentUser] && users[req.currentUser].banned) return res.status(403).json({ error: '已封禁' });
  const news = readJSON(NEWS_FILE);
  const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), username: req.currentUser, content, pinned: false, time: new Date().toISOString() };
  news.unshift(item);
  writeJSON(NEWS_FILE, news);
  if (users[req.currentUser]) { users[req.currentUser].count++; writeJSON(USERS_FILE, users); }
  io.emit('news-added', item);
  io.emit('leaderboard-updated', getLeaderboard());
  res.json({ success: true, news: item });
});

// ── 管理员 API ────────────────────────────────────
app.get('/api/admin/check', (req, res) => {
  if (isAdminIP(req)) return res.json({ allowed: true });
  const token = req.headers['authorization'] || req.query.token;
  const u = verifyToken(token);
  if (u && isAdminUser(u)) return res.json({ allowed: true });
  res.json({ allowed: false });
});

app.post('/api/admin/auth', (req, res) => {
  if (!isAdminIP(req)) { const token = req.headers['authorization'] || req.query.token; const u = verifyToken(token); if (!u || !isAdminUser(u)) return res.status(403).json({ error: '拒绝访问' }); }
  if (req.body.key !== ADMIN_KEY) return res.status(403).json({ error: '密钥错误' });
  res.json({ success: true });
});

app.get('/api/admin/users', adminMiddleware, (req, res) => { res.json(Object.values(readJSON(USERS_FILE)).map(u => ({ username: u.username, ip: u.ip, count: u.count, banned: !!u.banned, role: u.role || 'user', createdAt: u.createdAt }))); });

app.get('/api/admin/news', adminMiddleware, (req, res) => { const d = req.query.date || new Date().toISOString().slice(0, 10); const f = readJSON(NEWS_FILE).filter(n => n.time.slice(0, 10) === d); res.json([...f.filter(n => n.pinned), ...f.filter(n => !n.pinned)]); });

app.delete('/api/admin/news/:id', adminMiddleware, (req, res) => {
  const { id } = req.params;
  if (id.startsWith('seed-')) return res.status(403).json({ error: '示例新闻不可删除' });
  let news = readJSON(NEWS_FILE);
  const item = news.find(n => n.id === id);
  if (!item) return res.status(404).json({ error: '不存在' });
  news = news.filter(n => n.id !== id);
  writeJSON(NEWS_FILE, news);
  const users = readJSON(USERS_FILE);
  if (users[item.username] && users[item.username].count > 0) { users[item.username].count--; writeJSON(USERS_FILE, users); }
  io.emit('news-deleted', { id });
  io.emit('leaderboard-updated', getLeaderboard());
  res.json({ success: true });
});

app.post('/api/admin/ban', adminMiddleware, (req, res) => {
  const { username, banned } = req.body;
  if (!username) return res.status(400).json({ error: '请指定用户名' });
  const users = readJSON(USERS_FILE);
  const target = users[username];
  if (!target) return res.status(404).json({ error: '用户不存在' });
  // 不能封禁超级管理员
  if (target.role === 'superadmin') return res.status(403).json({ error: '不能封禁超级管理员' });
  // 操作者身份：只有 superadmin 能封禁 admin
  const token = req.headers['x-user-token'] || req.headers['authorization'] || '';
  const operator = verifyToken(token);
  if (target.role === 'admin' && (!operator || !isSuperAdmin(operator))) {
    return res.status(403).json({ error: '只有超级管理员能封禁管理员' });
  }
  target.banned = !!banned;
  writeJSON(USERS_FILE, users);
  const tokens = readJSON(TOKENS_FILE);
  for (const tk of Object.keys(tokens)) { if (tokens[tk] === username) delete tokens[tk]; }
  writeJSON(TOKENS_FILE, tokens);
  io.emit('leaderboard-updated', getLeaderboard());
  res.json({ success: true, action: banned ? '封禁' : '解封' });
});

app.post('/api/admin/set-role', adminMiddleware, (req, res) => {
  const { username, role } = req.body;
  if (!username || !['admin', 'user'].includes(role)) return res.status(400).json({ error: '参数错误' });
  const token = req.headers['x-user-token'] || '';
  const operator = verifyToken(token);
  if (!operator || !isSuperAdmin(operator)) return res.status(403).json({ error: '仅超级管理员可操作' });
  const users = readJSON(USERS_FILE);
  if (!users[username]) return res.status(404).json({ error: '不存在' });
  if (users[username].role === 'superadmin') return res.status(403).json({ error: '无法修改超级管理员' });
  users[username].role = role;
  writeJSON(USERS_FILE, users);
  res.json({ success: true, action: role === 'admin' ? '设为管理员' : '撤销管理员' });
});

app.post('/api/admin/pin', adminMiddleware, (req, res) => {
  const { id, pinned } = req.body;
  if (!id) return res.status(400).json({ error: '请指定新闻ID' });
  const news = readJSON(NEWS_FILE);
  const item = news.find(n => n.id === id);
  if (!item) return res.status(404).json({ error: '不存在' });
  item.pinned = !!pinned;
  writeJSON(NEWS_FILE, news);
  io.emit('news-pin-toggled', { id, pinned: item.pinned });
  res.json({ success: true, pinned: item.pinned });
});

app.post('/api/admin/reset-password', adminMiddleware, (req, res) => {
  const { username, newPassword } = req.body;
  if (!username || !newPassword || newPassword.length < 4) return res.status(400).json({ error: '参数错误' });
  const users = readJSON(USERS_FILE);
  if (!users[username]) return res.status(404).json({ error: '不存在' });
  const salt = makeSalt();
  users[username].passwordHash = hashPassword(newPassword, salt);
  users[username].salt = salt;
  writeJSON(USERS_FILE, users);
  const tokens = readJSON(TOKENS_FILE);
  for (const tk of Object.keys(tokens)) { if (tokens[tk] === username) delete tokens[tk]; }
  writeJSON(TOKENS_FILE, tokens);
  res.json({ success: true });
});

io.on('connection', socket => {
  const n = readJSON(NEWS_FILE);
  socket.emit('init-data', { news: [...n.filter(x => x.pinned), ...n.filter(x => !x.pinned)], leaderboard: getLeaderboard() });
  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => { console.log(`📰 新闻收集站 启动于端口 ${PORT}`); });
