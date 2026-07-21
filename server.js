const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ── PostgreSQL ─────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 自动建表
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      username VARCHAR(20) PRIMARY KEY,
      password_hash VARCHAR(255) NOT NULL,
      salt VARCHAR(32) NOT NULL,
      ip VARCHAR(45) NOT NULL,
      count INT DEFAULT 0,
      banned BOOLEAN DEFAULT FALSE,
      role VARCHAR(10) DEFAULT 'user',
      avatar VARCHAR(7) DEFAULT '#54A0FF',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS news (
      id VARCHAR(20) PRIMARY KEY,
      username VARCHAR(20) NOT NULL,
      content TEXT NOT NULL,
      pinned BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tokens (
      token VARCHAR(64) PRIMARY KEY,
      username VARCHAR(20) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // 重置 winster 密码
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync('Winster770228', salt, 10000, 64, 'sha512').toString('hex');
  await pool.query("UPDATE users SET password_hash = $1, salt = $2 WHERE username = 'winster'", [hash, salt]);
  console.log('✅ 数据库表已就绪');
})();

// ── 管理员 IP ──────────────────────────────────────
const ADMIN_IPS = ['26.100.68.199', '192.168.10.21', '127.0.0.1', '::1', '::ffff:127.0.0.1', '2409:8a55:e1:fbe4:6447:5fe:90ed:7749'];
const ADMIN_KEY = process.env.ADMIN_KEY || '2d384f9ba42ae0aac8a0e65d4ef40a3698969866981f4d10676dddf923778b9b98d40f89546ce4aa95e414c1caad064f91d78fa97ffbdca8dd8e35120653fc29f019bf4582ab2e18159aff67f44a1eb658bb44776503f304233ad4edc62b08e3b9b1ebcb0c411da948bbf1824a2586643d6c29b87a80ec4153b37051e0d67359';

function verifyAdminKey(rawKey) { return rawKey === ADMIN_KEY; }

// ── 工具函数 ──────────────────────────────────────
function sanitize(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&#34;').replace(/'/g, '&#39;').replace(/`/g, '&#96;').replace(/\$/g, '&#36;').trim();
}
function validateContent(text) {
  const len = [...text.trim()].length;
  if (len < 5) return '内容至少 5 个字符';
  if (len > 500) return '内容最多 500 个字符';
  return null;
}
function hashPassword(pw, salt) { return crypto.pbkdf2Sync(pw, salt, 10000, 64, 'sha512').toString('hex'); }
function makeSalt() { return crypto.randomBytes(16).toString('hex'); }
function randomToken() { return crypto.randomBytes(32).toString('hex'); }
function getAvatarColor(name) {
  const colors = ['#FF6B6B','#FF9F43','#FECA57','#54A0FF','#5F27CD','#01A3A4','#F368E0','#2ED573','#FF6348','#7BED9F','#70A1FF','#5352ED','#FF4757','#1E90FF','#2ED573'];
  let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}
function getClientIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || req.ip || '127.0.0.1';
}
function isAdminIP(req) {
  let ip = getClientIP(req); const pct = ip.indexOf('%'); if (pct !== -1) ip = ip.slice(0, pct);
  return ADMIN_IPS.includes(ip);
}

// ── 数据库查询辅助 ────────────────────────────────
async function query(sql, params) { return (await pool.query(sql, params)).rows; }
async function queryOne(sql, params) { const r = await pool.query(sql, params); return r.rows[0] || null; }

async function getUser(username) { return queryOne('SELECT * FROM users WHERE username = $1', [username]); }
async function verifyToken(token) { const r = await queryOne('SELECT username FROM tokens WHERE token = $1', [token]); return r ? r.username : null; }
async function isAdminUser(username) { const u = await getUser(username); return u && (u.role === 'admin' || u.role === 'superadmin'); }
async function isSuperAdmin(username) { const u = await getUser(username); return u && u.role === 'superadmin'; }

async function getLeaderboard() {
  return query('SELECT username, count, avatar FROM users WHERE banned = FALSE ORDER BY count DESC LIMIT 20');
}

// ── 中间件 ────────────────────────────────────────
async function authMiddleware(req, res, next) {
  const token = req.headers['authorization'] || req.query.token;
  if (!token) return res.status(401).json({ error: '请先登录' });
  const username = await verifyToken(token);
  if (!username) return res.status(401).json({ error: '登录已过期，请重新登录' });
  req.currentUser = username;
  next();
}
async function adminMiddleware(req, res, next) {
  if (!isAdminIP(req)) {
    const token = req.headers['x-user-token'] || req.headers['authorization'] || '';
    const username = await verifyToken(token);
    if (!username || !(await isAdminUser(username))) return res.status(403).json({ error: '无管理员权限' });
  }
  if (!verifyAdminKey(req.headers['x-admin-key'] || '')) return res.status(403).json({ error: '管理员密钥错误' });
  next();
}

// ── 静态文件 ──────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ═══════════════════════════════════════════════════
//  公开 API
// ═══════════════════════════════════════════════════

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const uname = (username || '').trim();
    if (!uname) return res.status(400).json({ error: '请输入昵称' });
    if (!password || password.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
    if (!/^[\w\u4e00-\u9fa5]{2,20}$/.test(uname)) return res.status(400).json({ error: '昵称 2-20 个字符' });

    if (await getUser(uname)) return res.status(400).json({ error: '该昵称已被注册' });

    const ip = getClientIP(req);
    const r = await queryOne('SELECT username FROM users WHERE ip = $1', [ip]);
    if (r) return res.status(400).json({ error: `该 IP 已注册过账号「${r.username}」，每个 IP 只能注册一次` });

    const salt = makeSalt();
    const role = uname === 'winster' ? 'superadmin' : 'user';
    await query('INSERT INTO users (username, password_hash, salt, ip, role, avatar) VALUES ($1,$2,$3,$4,$5,$6)',
      [uname, hashPassword(password, salt), salt, ip, role, getAvatarColor(uname)]);
    const token = randomToken();
    await query('INSERT INTO tokens (token, username) VALUES ($1,$2)', [token, uname]);
    res.json({ success: true, token, username: uname });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const uname = (username || '').trim();
    if (!uname || !password) return res.status(400).json({ error: '请输入昵称和密码' });
    const user = await getUser(uname);
    if (!user) return res.status(400).json({ error: '用户不存在，请先注册' });
    if (user.banned) return res.status(403).json({ error: '该账号已被封禁' });
    if (hashPassword(password, user.salt) !== user.password_hash) return res.status(400).json({ error: '密码错误' });
    const token = randomToken();
    await query('INSERT INTO tokens (token, username) VALUES ($1,$2)', [token, uname]);
    res.json({ success: true, token, username: uname });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', async (req, res) => {
  const token = req.headers['authorization'] || req.query.token;
  if (token) await query('DELETE FROM tokens WHERE token = $1', [token]);
  res.json({ success: true });
});

app.get('/api/me', async (req, res) => {
  const token = req.headers['authorization'] || req.query.token;
  const username = await verifyToken(token);
  if (!username) return res.status(401).json({ error: '登录已过期' });
  res.json({ username });
});

app.get('/api/news', async (req, res) => {
  res.json(await query('SELECT id, username, content, pinned, created_at as time FROM news ORDER BY pinned DESC, created_at DESC'));
});

app.post('/api/news', authMiddleware, async (req, res) => {
  try {
    let { content } = req.body;
    const username = req.currentUser;
    content = sanitize(content);
    const err = validateContent(content);
    if (err) return res.status(400).json({ error: err });
    const user = await getUser(username);
    if (user && user.banned) return res.status(403).json({ error: '该账号已被封禁' });

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await query('INSERT INTO news (id, username, content) VALUES ($1,$2,$3)', [id, username, content]);
    await query('UPDATE users SET count = count + 1 WHERE username = $1', [username]);

    const item = { id, username, content, pinned: false, time: new Date().toISOString() };
    io.emit('news-added', item);
    io.emit('leaderboard-updated', await getLeaderboard());
    res.json({ success: true, news: item });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
//  管理员 API
// ═══════════════════════════════════════════════════

app.get('/api/admin/check', async (req, res) => {
  if (isAdminIP(req)) return res.json({ allowed: true });
  const token = req.headers['authorization'] || req.query.token;
  const username = await verifyToken(token);
  if (username && await isAdminUser(username)) return res.json({ allowed: true });
  res.json({ allowed: false });
});

app.post('/api/admin/auth', async (req, res) => {
  if (!isAdminIP(req)) {
    const token = req.headers['authorization'] || req.query.token;
    const username = await verifyToken(token);
    if (!username || !(await isAdminUser(username))) return res.status(403).json({ error: '拒绝访问' });
  }
  if (!verifyAdminKey(req.body.key || '')) return res.status(403).json({ error: '密钥错误' });
  res.json({ success: true });
});

app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  res.json(await query('SELECT username, ip, count, banned, role, created_at FROM users ORDER BY created_at DESC'));
});

app.get('/api/admin/news', adminMiddleware, async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  res.json(await query("SELECT * FROM news WHERE created_at::date = $1 ORDER BY pinned DESC, created_at DESC", [date]));
});

app.delete('/api/admin/news/:id', adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const item = await queryOne('SELECT * FROM news WHERE id = $1', [id]);
  if (!item) return res.status(404).json({ error: '新闻不存在' });
  await query('DELETE FROM news WHERE id = $1', [id]);
  await query("UPDATE users SET count = GREATEST(count - 1, 0) WHERE username = $1", [item.username]);
  io.emit('news-deleted', { id });
  io.emit('leaderboard-updated', await getLeaderboard());
  res.json({ success: true });
});

app.post('/api/admin/ban', adminMiddleware, async (req, res) => {
  const { username, banned } = req.body;
  if (!username) return res.status(400).json({ error: '请指定用户名' });
  await query('UPDATE users SET banned = $1 WHERE username = $2', [!!banned, username]);
  await query('DELETE FROM tokens WHERE username = $1', [username]);
  io.emit('leaderboard-updated', await getLeaderboard());
  res.json({ success: true, action: banned ? '封禁' : '解封' });
});

app.post('/api/admin/set-role', adminMiddleware, async (req, res) => {
  const { username, role } = req.body;
  if (!username || !['admin', 'user'].includes(role)) return res.status(400).json({ error: '参数错误' });
  const token = req.headers['x-user-token'] || '';
  const operator = await verifyToken(token);
  if (!operator || !(await isSuperAdmin(operator))) return res.status(403).json({ error: '仅超级管理员可执行此操作' });
  const user = await getUser(username);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.role === 'superadmin') return res.status(403).json({ error: '无法修改超级管理员' });
  await query('UPDATE users SET role = $1 WHERE username = $2', [role, username]);
  res.json({ success: true, action: role === 'admin' ? '设为管理员' : '撤销管理员' });
});

app.post('/api/admin/pin', adminMiddleware, async (req, res) => {
  const { id, pinned } = req.body;
  if (!id) return res.status(400).json({ error: '请指定新闻ID' });
  await query('UPDATE news SET pinned = $1 WHERE id = $2', [!!pinned, id]);
  io.emit('news-pin-toggled', { id, pinned: !!pinned });
  res.json({ success: true, pinned: !!pinned });
});

app.post('/api/admin/reset-password', adminMiddleware, async (req, res) => {
  const { username, newPassword } = req.body;
  if (!username || !newPassword || newPassword.length < 4) return res.status(400).json({ error: '参数错误' });
  const salt = makeSalt();
  await query('UPDATE users SET password_hash = $1, salt = $2 WHERE username = $3', [hashPassword(newPassword, salt), salt, username]);
  await query('DELETE FROM tokens WHERE username = $1', [username]);
  res.json({ success: true });
});

// ── Socket.IO ─────────────────────────────────────
io.on('connection', async socket => {
  socket.emit('init-data', {
    news: await query('SELECT id, username, content, pinned, created_at as time FROM news ORDER BY pinned DESC, created_at DESC'),
    leaderboard: await getLeaderboard()
  });
  socket.on('disconnect', () => {});
});

// ── 启动 ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`📰 新闻收集站 PG版 启动于端口 ${PORT}`);
});
