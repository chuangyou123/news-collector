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

// ── 安全防护 ──────────────────────────────────────
const rateLimit = new Map(); // IP -> { action:count, reset:timestamp }
function checkRate(ip, action, max, windowSec = 60) {
  const key = ip + ':' + action;
  const now = Date.now();
  let r = rateLimit.get(key);
  if (!r || now > r.reset) { r = { count: 0, reset: now + windowSec * 1000 }; rateLimit.set(key, r); }
  r.count++;
  if (r.count > max) return false;
  return true;
}
// 定期清理
setInterval(() => { const now = Date.now(); for (const [k, v] of rateLimit) { if (now > v.reset) rateLimit.delete(k); } }, 60000);

function strongPassword(pw) {
  if (pw.length < 6) return '密码至少6位';
  if (!/[a-zA-Z]/.test(pw)) return '密码需包含字母';
  if (!/[0-9]/.test(pw)) return '密码需包含数字';
  return null;
}

// ── PG 或 JSON ────────────────────────────────────
let pg = null;
try { pg = require('pg'); } catch {}
const DATA_DIR = path.join(__dirname, 'data');
const NEWS_FILE = path.join(DATA_DIR, 'news.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');
const SEED_FILE = path.join(DATA_DIR, 'seed-news.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
function initFile(fp, def) { if (!fs.existsSync(fp)) fs.writeFileSync(fp, JSON.stringify(def)); }
initFile(NEWS_FILE, []);
initFile(USERS_FILE, {});
initFile(TOKENS_FILE, {});

let pool = null;
if (pg && process.env.DATABASE_URL) {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS users(username VARCHAR(20) PRIMARY KEY, password_hash VARCHAR(255), salt VARCHAR(32), ip VARCHAR(45), count INT DEFAULT 0, banned BOOLEAN DEFAULT FALSE, role VARCHAR(10) DEFAULT 'user', avatar VARCHAR(7), created_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS news(id VARCHAR(20) PRIMARY KEY, username VARCHAR(20), content TEXT, pinned BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS tokens(token VARCHAR(64) PRIMARY KEY, username VARCHAR(20), created_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS warnings(id SERIAL PRIMARY KEY, username VARCHAR(20), reason TEXT, warned_by VARCHAR(20), created_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS announcements(id SERIAL PRIMARY KEY, content TEXT, created_by VARCHAR(20), created_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS likes(news_id VARCHAR(20), username VARCHAR(20), PRIMARY KEY(news_id, username))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS tags(id SERIAL PRIMARY KEY, name VARCHAR(20) UNIQUE)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS news_tags(news_id VARCHAR(20), tag_id INT, PRIMARY KEY(news_id, tag_id))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS reports(id SERIAL PRIMARY KEY, news_id VARCHAR(20), reporter VARCHAR(20), reason TEXT, resolved BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS comments(id SERIAL PRIMARY KEY, news_id VARCHAR(20), username VARCHAR(20), content TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS notifications(id SERIAL PRIMARY KEY, username VARCHAR(20), type VARCHAR(20), content TEXT, link VARCHAR(100), seen BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // 预设标签
    await pool.query(`INSERT INTO tags(name) VALUES('搞笑'),('生活'),('科技'),('游戏'),('社会'),('其他') ON CONFLICT DO NOTHING`);
    console.log('✅ PostgreSQL 已就绪');
  })().catch(e => { console.log('PG init error:', e.message); pool = null; });
}
console.log(pool ? '📦 使用 PostgreSQL' : '📦 使用 JSON 文件');

// ── 示例新闻 ──────────────────────────────────────
let seedNews = [];
try { const s = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8')); seedNews = s.map((t, i) => ({ id: 'seed-' + i, username: '📢 示例', content: sanitize2(t), pinned: false, time: '2025-01-01T00:00:00.000Z', seed: true })); console.log(`📦 ${seedNews.length} 条示例新闻`); } catch { seedNews = []; }

// ── Helpers ────────────────────────────────────────
function sanitize2(s) { if (!s || typeof s !== 'string') return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&#34;').replace(/'/g,'&#39;').replace(/`/g,'&#96;').replace(/\$/g,'&#36;').trim(); }
function hash(p, s) { return crypto.pbkdf2Sync(p, s, 10000, 64, 'sha512').toString('hex'); }
function rsalt() { return crypto.randomBytes(16).toString('hex'); }
function rtoken() { return crypto.randomBytes(32).toString('hex'); }
function getIP(r) { const f = r.headers['x-forwarded-for']; return f ? f.split(',')[0].trim() : (r.socket.remoteAddress || '127.0.0.1'); }
function isAdminIP(r) { let ip = getIP(r); const p = ip.indexOf('%'); if (p !== -1) ip = ip.slice(0, p); return ADMIN_IPS.includes(ip); }
function avatar(n) { const c = ['#FF6B6B','#FF9F43','#FECA57','#54A0FF','#5F27CD','#01A3A4','#F368E0','#2ED573','#FF6348','#7BED9F','#70A1FF','#5352ED','#FF4757','#1E90FF','#2ED573']; let h = 0; for (let i = 0; i < n.length; i++) h = n.charCodeAt(i) + ((h << 5) - h); return c[Math.abs(h) % c.length]; }

// JSON helpers
function readJ(fp) { try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return fp === NEWS_FILE ? [] : {}; } }
function writeJ(fp, d) { fs.writeFileSync(fp, JSON.stringify(d)); }

// Unified data layer
async function q(sql, params) { if (pool) return (await pool.query(sql, params)).rows; return null; }
async function q1(sql, params) { if (pool) { const r = await pool.query(sql, params); return r.rows[0] || null; } return null; }
function readJSON(fp) { return readJ(fp); }
function writeJSON(fp, d) { writeJ(fp, d); }

async function createToken(u) { const tk = rtoken(); if (pool) { await pool.query('INSERT INTO tokens(token,username) VALUES($1,$2)', [tk, u]); } else { const t = readJ(TOKENS_FILE); t[tk] = u; writeJ(TOKENS_FILE, t); } return tk; }
async function verifyToken(tk) { if (pool) { const r = await q1('SELECT username FROM tokens WHERE token=$1', [tk]); return r ? r.username : null; } const t = readJ(TOKENS_FILE); return t[tk] || null; }
async function removeToken(tk) { if (pool) { await pool.query('DELETE FROM tokens WHERE token=$1', [tk]); } else { const t = readJ(TOKENS_FILE); delete t[tk]; writeJ(TOKENS_FILE, t); } }
async function getUser(u) { if (pool) return q1('SELECT * FROM users WHERE username=$1', [u]); return readJ(USERS_FILE)[u] || null; }
async function isAdminUser(u) { const r = await getUser(u); return r && (r.role === 'admin' || r.role === 'superadmin'); }
async function isSuperAdmin(u) { const r = await getUser(u); return r && r.role === 'superadmin'; }
async function getLeaderboard() { if (pool) return q('SELECT username, count, avatar FROM users WHERE banned=FALSE ORDER BY count DESC LIMIT 20'); return Object.values(readJ(USERS_FILE)).filter(u => !u.banned).sort((a, b) => b.count - a.count).slice(0, 20); }

// ── Middleware ─────────────────────────────────────
async function authMW(req, res, next) { const t = req.headers['authorization'] || req.query.token; if (!t) return res.status(401).json({ error: '请先登录' }); const u = await verifyToken(t); if (!u) return res.status(401).json({ error: '登录已过期' }); req.currentUser = u; next(); }
async function adminMW(req, res, next) { if (!isAdminIP(req)) { const t = req.headers['x-user-token'] || req.headers['authorization'] || ''; const u = await verifyToken(t); if (!u || !(await isAdminUser(u))) return res.status(403).json({ error: '无管理员权限' }); } if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ error: '密钥错误' }); next(); }

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Reset winster ─────────────────────────────────
app.post('/api/reset-winster', async (req, res) => {
  if (req.body.key !== ADMIN_KEY) return res.status(403).json({ error: '密钥错误' });
  const uname = req.body.username || 'winster';
  const pw = req.body.password || 'Winster770228';
  const salt = rsalt();
  const role = (uname === 'winster' || uname === 'Winster') ? 'superadmin' : 'user';
  if (pool) {
    const r = await q1('SELECT username FROM users WHERE username=$1', [uname]);
    if (r) await pool.query('UPDATE users SET password_hash=$1,salt=$2,role=$3 WHERE username=$4', [hash(pw, salt), salt, role, uname]);
    else await pool.query('INSERT INTO users(username,password_hash,salt,ip,role,avatar) VALUES($1,$2,$3,$4,$5,$6)', [uname, hash(pw, salt), salt, '0.0.0.0', role, avatar(uname)]);
  } else {
    const u = readJ(USERS_FILE);
    u[uname] = { username: uname, passwordHash: hash(pw, salt), salt, ip: '0.0.0.0', count: 0, banned: false, role, avatar: avatar(uname), createdAt: new Date().toISOString() };
    writeJ(USERS_FILE, u);
  }
  res.json({ success: true, username: uname, password: pw });
});

// ── Auth API ──────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const ip = getIP(req);
  if (!checkRate(ip, 'register', 3, 3600)) return res.status(429).json({ error: '注册太频繁，请稍后再试' });
  const { username, password } = req.body;
  const un = (username || '').trim();
  const pwErr = strongPassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  if (!un || !password) return res.status(400).json({ error: '参数错误' });
  if (!/^[\w\u4e00-\u9fa5]{2,20}$/.test(un)) return res.status(400).json({ error: '昵称格式不对' });
  if (await getUser(un)) return res.status(400).json({ error: '该昵称已被注册' });
  if (pool) {
    const r = await q1('SELECT username FROM users WHERE ip=$1', [ip]);
    if (r) return res.status(400).json({ error: `该IP已注册过「${r.username}」` });
    const s = rsalt();
    const role = (un === 'winster' || un === 'Winster') ? 'superadmin' : 'user';
    await pool.query('INSERT INTO users(username,password_hash,salt,ip,role,avatar) VALUES($1,$2,$3,$4,$5,$6)', [un, hash(password, s), s, ip, role, avatar(un)]);
  } else {
    const u = readJ(USERS_FILE);
    if (Object.values(u).find(x => x.ip === ip)) return res.status(400).json({ error: '该IP已注册' });
    const s = rsalt();
    const r2 = (un === 'winster' || un === 'Winster') ? 'superadmin' : 'user';
    u[un] = { username: un, passwordHash: hash(password, s), salt: s, ip, count: 0, banned: false, role: r2, avatar: avatar(un), createdAt: new Date().toISOString() };
    writeJ(USERS_FILE, u);
  }
  const token = await createToken(un);
  res.json({ success: true, token, username: un });
});

app.post('/api/login', async (req, res) => {
  const ip = getIP(req);
  const { username, password } = req.body;
  const un = (username || '').trim();
  if (!un || !password) return res.status(400).json({ error: '请输入昵称和密码' });
  
  // 检查是否已被限流（不管对错都先检查）
  const key = ip + ':login';
  const rl = rateLimit.get(key);
  if (rl && rl.count >= 10) return res.status(429).json({ error: '登录尝试过多，请15分钟后再试' });
  
  const user = await getUser(un);
  if (!user) { checkRate(ip, 'login', 10, 900); return res.status(400).json({ error: '用户不存在' }); }
  if (user.banned) return res.status(403).json({ error: '已封禁' });
  const h = user.passwordHash || user.password_hash;
  if (hash(password, user.salt) !== h) { checkRate(ip, 'login', 10, 900); return res.status(400).json({ error: '密码错误' }); }
  
  // 密码正确 → 清除限流计数
  rateLimit.delete(key);
  res.json({ success: true, token: await createToken(un), username: un });
});

app.post('/api/logout', async (req, res) => { const t = req.headers['authorization'] || req.query.token; if (t) await removeToken(t); res.json({ success: true }); });
app.get('/api/me', async (req, res) => { const t = req.headers['authorization'] || req.query.token; const u = await verifyToken(t); if (!u) return res.status(401).json({ error: '未登录' }); res.json({ username: u }); });

// ── News API ──────────────────────────────────────
app.get('/api/news', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const offset = (page - 1) * limit;
  const tag = req.query.tag || '';
  if (pool) {
    const t = req.headers['authorization'] || req.query.token || '';
    const u = await verifyToken(t);
    let sql = `SELECT n.id, n.username, n.content, n.pinned, n.created_at as time, COUNT(DISTINCT l.username) as likes,
      ${u ? `EXISTS(SELECT 1 FROM likes WHERE news_id=n.id AND username=$1) as liked_by_me` : 'FALSE as liked_by_me'},
      (SELECT STRING_AGG(tg.name,',') FROM news_tags nt JOIN tags tg ON nt.tag_id=tg.id WHERE nt.news_id=n.id) as tags
      FROM news n LEFT JOIN likes l ON n.id=l.news_id`;
    const params = u ? [u] : [];
    let paramIdx = params.length;
    if (tag) { sql += ` JOIN news_tags nt ON n.id=nt.news_id JOIN tags tg ON nt.tag_id=tg.id WHERE tg.name=$${++paramIdx}`; params.push(tag); }
    sql += ` GROUP BY n.id ORDER BY n.pinned DESC, n.created_at DESC LIMIT $${++paramIdx} OFFSET $${++paramIdx}`;
    params.push(limit, offset);
    const rows = await q(sql, params);
    const countR = await q1(tag
      ? `SELECT COUNT(DISTINCT n.id) as c FROM news n JOIN news_tags nt ON n.id=nt.news_id JOIN tags tg ON nt.tag_id=tg.id WHERE tg.name=$1`
      : `SELECT COUNT(*) as c FROM news`, tag ? [tag] : []);
    res.json({ items: rows, page, totalPages: Math.ceil((countR?.c || 0) / limit), total: parseInt(countR?.c || 0) });
  } else { const n = readJ(NEWS_FILE); res.json({ items: [...n.filter(x => x.pinned), ...n.filter(x => !x.pinned)], page: 1, totalPages: 1, total: n.length }); }
});
app.get('/api/news/all', async (req, res) => {
  let userNews;
  if (pool) {
    const t = req.headers['authorization'] || req.query.token || '';
    const u = await verifyToken(t);
    userNews = await q(
      `SELECT n.id, n.username, n.content, n.pinned, n.created_at as time, COUNT(l.username) as likes,
        ${u ? `EXISTS(SELECT 1 FROM likes WHERE news_id=n.id AND username=$1) as liked_by_me` : 'FALSE as liked_by_me'}
      FROM news n LEFT JOIN likes l ON n.id=l.news_id GROUP BY n.id ORDER BY n.pinned DESC, n.created_at DESC`,
      u ? [u] : []
    );
  } else { const n = readJ(NEWS_FILE); userNews = [...n.filter(x => x.pinned), ...n.filter(x => !x.pinned)]; }
  res.json([...userNews, ...seedNews]);
});
app.get('/api/news/download', async (req, res) => {
  let n;
  if (pool) { const r = await q('SELECT content FROM news ORDER BY created_at DESC'); n = r.map(x => x.content); }
  else n = readJ(NEWS_FILE).map(x => x.content);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="news-collection.txt"');
  res.send([...n, ...seedNews.map(x => x.content)].join(','));
});
app.get('/api/news/count', async (req, res) => {
  if (pool) { const r = await q1('SELECT COUNT(*) as c FROM news'); res.json({ count: parseInt(r.c) + seedNews.length, userCount: parseInt(r.c), seedCount: seedNews.length }); }
  else { const n = readJ(NEWS_FILE); res.json({ count: n.length + seedNews.length, userCount: n.length, seedCount: seedNews.length }); }
});

app.post('/api/news', authMW, async (req, res) => {
  const ip = getIP(req);
  if (!checkRate(ip, 'news', 5, 60)) return res.status(429).json({ error: '发布太频繁，请稍后再试' });
  let content = (req.body.content || '').trim();
  content = sanitize2(content);
  const l = [...content].length;
  if (l < 5) return res.status(400).json({ error: '至少5个字符' });
  if (l > 500) return res.status(400).json({ error: '最多500个字符' });
  const user = await getUser(req.currentUser);
  if (user && user.banned) return res.status(403).json({ error: '已封禁' });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  if (pool) {
    await pool.query('INSERT INTO news(id,username,content) VALUES($1,$2,$3)', [id, req.currentUser, content]);
    await pool.query('UPDATE users SET count=count+1 WHERE username=$1', [req.currentUser]);
    // 标签
    const tag = (req.body.tag || '').trim();
    if (tag && pool) {
      const t = await q1('SELECT id FROM tags WHERE name=$1', [tag]);
      if (t) await pool.query('INSERT INTO news_tags(news_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, t.id]);
    }
  } else {
    const n = readJ(NEWS_FILE); n.unshift({ id, username: req.currentUser, content, pinned: false, time: new Date().toISOString() }); writeJ(NEWS_FILE, n);
    const u = readJ(USERS_FILE); if (u[req.currentUser]) { u[req.currentUser].count++; writeJ(USERS_FILE, u); }
  }
  const item = { id, username: req.currentUser, content, pinned: false, time: new Date().toISOString() };
  io.emit('news-added', item);
  io.emit('leaderboard-updated', await getLeaderboard());
  res.json({ success: true, news: item });
});

// 编辑自己的新闻
app.put('/api/news/:id', authMW, async (req, res) => {
  const { id } = req.params;
  let content = (req.body.content || '').trim();
  content = sanitize2(content);
  if ([...content].length < 5) return res.status(400).json({ error: '至少5个字符' });
  if (pool) {
    const item = await q1('SELECT * FROM news WHERE id=$1', [id]);
    if (!item) return res.status(404).json({ error: '不存在' });
    if (item.username !== req.currentUser) return res.status(403).json({ error: '只能编辑自己的新闻' });
    await pool.query('UPDATE news SET content=$1 WHERE id=$2', [content, id]);
  }
  res.json({ success: true });
});

// 标签列表
app.get('/api/tags', async (req, res) => {
  if (pool) res.json(await q('SELECT * FROM tags ORDER BY id'));
  else res.json([]);
});

// 举报
app.post('/api/news/:id/report', authMW, async (req, res) => {
  const { id } = req.params;
  const reason = (req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: '请输入举报理由' });
  if (pool) {
    await pool.query('INSERT INTO reports(news_id,reporter,reason) VALUES($1,$2,$3)', [id, req.currentUser, reason]);
  }
  res.json({ success: true });
});

// 获取举报列表(管理员)
app.get('/api/admin/reports', adminMW, async (req, res) => {
  if (pool) res.json(await q('SELECT r.*,n.content as news_content FROM reports r JOIN news n ON r.news_id=n.id ORDER BY r.created_at DESC'));
  else res.json([]);
});

// 用户删除自己的新闻
app.delete('/api/news/:id', authMW, async (req, res) => {
  const { id } = req.params;
  if (pool) {
    const item = await q1('SELECT * FROM news WHERE id=$1', [id]);
    if (!item) return res.status(404).json({ error: '不存在' });
    if (item.username !== req.currentUser) return res.status(403).json({ error: '只能删除自己的新闻' });
    await pool.query('DELETE FROM news WHERE id=$1', [id]);
    await pool.query('UPDATE users SET count=GREATEST(count-1,0) WHERE username=$1', [req.currentUser]);
  }
  io.emit('news-deleted', { id });
  io.emit('leaderboard-updated', await getLeaderboard());
  res.json({ success: true });
});

// 点赞/取消点赞
app.post('/api/news/:id/like', authMW, async (req, res) => {
  const { id } = req.params;
  const username = req.currentUser;
  if (pool) {
    const existing = await q1('SELECT * FROM likes WHERE news_id=$1 AND username=$2', [id, username]);
    if (existing) {
      await pool.query('DELETE FROM likes WHERE news_id=$1 AND username=$2', [id, username]);
    } else {
      await pool.query('INSERT INTO likes(news_id,username) VALUES($1,$2)', [id, username]);
    }
    const r = await q1('SELECT COUNT(*) as c FROM likes WHERE news_id=$1', [id]);
    res.json({ liked: !existing, count: parseInt(r.c) });
  } else {
    res.json({ liked: false, count: 0 });
  }
});

// ── 评论 ──────────────────────────────────────────
app.get('/api/news/:id/comments', async (req, res) => {
  if (pool) res.json(await q('SELECT * FROM comments WHERE news_id=$1 ORDER BY created_at ASC', [req.params.id]));
  else res.json([]);
});

app.post('/api/news/:id/comments', authMW, async (req, res) => {
  const content = (req.body.content || '').trim();
  if (!content || content.length < 1) return res.status(400).json({ error: '内容不能为空' });
  if (pool) {
    await pool.query('INSERT INTO comments(news_id,username,content) VALUES($1,$2,$3)', [req.params.id, req.currentUser, content]);
    // 通知新闻作者
    const n = await q1('SELECT username FROM news WHERE id=$1', [req.params.id]);
    if (n && n.username !== req.currentUser) {
      await pool.query("INSERT INTO notifications(username,type,content,link) VALUES($1,'comment',$2,$3)", [n.username, req.currentUser+' 评论了你的新闻', '/#news-'+req.params.id]);
    }
  }
  res.json({ success: true });
});

// ── 通知 ──────────────────────────────────────────
app.get('/api/notifications', authMW, async (req, res) => {
  if (pool) res.json(await q('SELECT * FROM notifications WHERE username=$1 ORDER BY created_at DESC LIMIT 30', [req.currentUser]));
  else res.json([]);
});
app.post('/api/notifications/read', authMW, async (req, res) => {
  if (pool) await pool.query('UPDATE notifications SET seen=TRUE WHERE username=$1', [req.currentUser]);
  res.json({ success: true });
});

// ── 统计 ──────────────────────────────────────────
app.get('/api/admin/stats', adminMW, async (req, res) => {
  if (!pool) return res.json({});
  const users = await q1('SELECT COUNT(*) as c FROM users');
  const news = await q1('SELECT COUNT(*) as c FROM news');
  const today = await q1("SELECT COUNT(*) as c FROM news WHERE created_at::date=CURRENT_DATE");
  const likes = await q1('SELECT COUNT(*) as c FROM likes');
  const daily = await q("SELECT created_at::date as date, COUNT(*) as count FROM news WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY date ORDER BY date");
  res.json({ users: parseInt(users.c), news: parseInt(news.c), today: parseInt(today.c), likes: parseInt(likes.c), daily });
});

// ── 自定义头像颜色 ────────────────────────────────
app.post('/api/user/color', authMW, async (req, res) => {
  const color = req.body.color || '';
  if (pool) await pool.query('UPDATE users SET avatar=$1 WHERE username=$2', [color, req.currentUser]);
  res.json({ success: true });
});

// ── Admin API ─────────────────────────────────────
app.get('/api/admin/check', async (req, res) => {
  if (isAdminIP(req)) return res.json({ allowed: true });
  const t = req.headers['authorization'] || req.query.token;
  res.json({ allowed: !!(await verifyToken(t) && await isAdminUser(await verifyToken(t))) });
});
app.post('/api/admin/auth', async (req, res) => {
  const ip = getIP(req);
  if (!checkRate(ip, 'admin-auth', 5, 300)) return res.status(429).json({ error: '尝试过多' });
  if (!isAdminIP(req)) { const t = req.headers['authorization'] || req.query.token; const u = await verifyToken(t); if (!u || !(await isAdminUser(u))) return res.status(403).json({ error: '拒绝访问' }); }
  if (req.body.key !== ADMIN_KEY) return res.status(403).json({ error: '密钥错误' });
  res.json({ success: true });
});
app.get('/api/admin/users', adminMW, async (req, res) => {
  if (pool) { res.json(await q('SELECT username,ip,count,banned,role,created_at FROM users ORDER BY created_at DESC')); }
  else { res.json(Object.values(readJ(USERS_FILE)).map(u => ({ username: u.username, ip: u.ip, count: u.count, banned: !!u.banned, role: u.role || 'user', createdAt: u.createdAt }))); }
});
app.get('/api/admin/news', adminMW, async (req, res) => {
  const d = req.query.date || new Date().toISOString().slice(0, 10);
  if (pool) { res.json(await q('SELECT * FROM news WHERE created_at::date=$1 ORDER BY pinned DESC, created_at DESC', [d])); }
  else { const f = readJ(NEWS_FILE).filter(n => (n.time || n.created_at || '').slice(0, 10) === d); res.json([...f.filter(n => n.pinned), ...f.filter(n => !n.pinned)]); }
});
app.delete('/api/admin/news/:id', adminMW, async (req, res) => {
  const { id } = req.params;
  if (id.startsWith('seed-')) return res.status(403).json({ error: '示例不可删' });
  if (pool) {
    const item = await q1('SELECT * FROM news WHERE id=$1', [id]);
    if (!item) return res.status(404).json({ error: '不存在' });
    await pool.query('DELETE FROM news WHERE id=$1', [id]);
    await pool.query('UPDATE users SET count=GREATEST(count-1,0) WHERE username=$1', [item.username]);
  } else {
    let n = readJ(NEWS_FILE); const item = n.find(x => x.id === id); if (!item) return res.status(404).json({ error: '不存在' });
    n = n.filter(x => x.id !== id); writeJ(NEWS_FILE, n);
    const u = readJ(USERS_FILE); if (u[item.username] && u[item.username].count > 0) { u[item.username].count--; writeJ(USERS_FILE, u); }
  }
  io.emit('news-deleted', { id });
  io.emit('leaderboard-updated', await getLeaderboard());
  res.json({ success: true });
});
app.post('/api/admin/set-role', adminMW, async (req, res) => {
  const { username, role } = req.body;
  if (!username || !['admin', 'user'].includes(role)) return res.status(400).json({ error: '参数错误' });
  const t = req.headers['x-user-token'] || ''; const op = await verifyToken(t);
  if (!op || !(await isSuperAdmin(op))) return res.status(403).json({ error: '仅超管可操作' });
  const target = await getUser(username);
  if (!target) return res.status(404).json({ error: '不存在' });
  if (target.role === 'superadmin') return res.status(403).json({ error: '不能改超管' });
  if (pool) { await pool.query('UPDATE users SET role=$1 WHERE username=$2', [role, username]); }
  else { const u = readJ(USERS_FILE); u[username].role = role; writeJ(USERS_FILE, u); }
  res.json({ success: true });
});
app.post('/api/admin/pin', adminMW, async (req, res) => {
  const { id, pinned } = req.body;
  if (!id) return res.status(400).json({ error: '请指定ID' });
  if (pool) { await pool.query('UPDATE news SET pinned=$1 WHERE id=$2', [!!pinned, id]); }
  else { const n = readJ(NEWS_FILE); const item = n.find(x => x.id === id); if (item) item.pinned = !!pinned; writeJ(NEWS_FILE, n); }
  io.emit('news-pin-toggled', { id, pinned: !!pinned });
  res.json({ success: true });
});
app.post('/api/admin/reset-password', adminMW, async (req, res) => {
  const { username, newPassword } = req.body;
  if (!username || !newPassword || newPassword.length < 4) return res.status(400).json({ error: '参数错误' });
  const s = rsalt(); const h = hash(newPassword, s);
  if (pool) { await pool.query('UPDATE users SET password_hash=$1,salt=$2 WHERE username=$3', [h, s, username]); await pool.query('DELETE FROM tokens WHERE username=$1', [username]); }
  else { const u = readJ(USERS_FILE); if (!u[username]) return res.status(404).json({ error: '不存在' }); u[username].passwordHash = h; u[username].salt = s; writeJ(USERS_FILE, u); const tk = readJ(TOKENS_FILE); for (const k of Object.keys(tk)) { if (tk[k] === username) delete tk[k]; } writeJ(TOKENS_FILE, tk); }
  res.json({ success: true });
});

// ── 公告 ──────────────────────────────────────────
app.post('/api/admin/announcement', adminMW, async (req, res) => {
  const { content } = req.body;
  if (!content || content.trim().length < 2) return res.status(400).json({ error: '内容太短' });
  const t = req.headers['x-user-token'] || req.headers['authorization'] || '';
  const op = await verifyToken(t);
  if (!op || !(await isSuperAdmin(op))) return res.status(403).json({ error: '仅超管可发公告' });
  if (pool) { await pool.query('INSERT INTO announcements(content,created_by) VALUES($1,$2)', [content.trim(), op]); }
  io.emit('announcement-added', { content: content.trim(), created_by: op, created_at: new Date().toISOString() });
  res.json({ success: true });
});

app.get('/api/announcements', async (req, res) => {
  if (pool) { res.json(await q('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 10')); }
  else { res.json([]); }
});

app.delete('/api/admin/announcement/:id', adminMW, async (req, res) => {
  if (pool) { await pool.query('DELETE FROM announcements WHERE id=$1', [req.params.id]); }
  res.json({ success: true });
});

// ── 警告 ──────────────────────────────────────────
app.post('/api/admin/warn', adminMW, async (req, res) => {
  const { username, reason } = req.body;
  if (!username || !reason) return res.status(400).json({ error: '参数错误' });
  const t = req.headers['x-user-token'] || ''; const op = await verifyToken(t);
  if (!op || !(await isAdminUser(op))) return res.status(403).json({ error: '无权限' });
  const target = await getUser(username);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.role === 'superadmin') return res.status(403).json({ error: '不能警告超管' });
  if (pool) {
    await pool.query('INSERT INTO warnings(username,reason,warned_by) VALUES($1,$2,$3)', [username, reason, op]);
    const r = await q1('SELECT COUNT(*) as c FROM warnings WHERE username=$1', [username]);
    if (parseInt(r.c) >= 3) {
      await pool.query('UPDATE users SET banned=TRUE WHERE username=$1', [username]);
      await pool.query('DELETE FROM tokens WHERE username=$1', [username]);
      io.emit('leaderboard-updated', await getLeaderboard());
      res.json({ success: true, action: '警告+自动封禁', count: parseInt(r.c) });
      return;
    }
    res.json({ success: true, action: '警告', count: parseInt(r.c) });
  } else { res.json({ error: '需要PG' }); }
});

app.get('/api/admin/warnings/:username', adminMW, async (req, res) => {
  if (pool) res.json(await q('SELECT * FROM warnings WHERE username=$1 ORDER BY created_at DESC', [req.params.username]));
  else res.json([]);
});

// ── 封禁时长 ──────────────────────────────────────
app.post('/api/admin/ban', adminMW, async (req, res) => {
  const { username, banned, duration } = req.body; // duration: 小时数，0=永久
  if (!username) return res.status(400).json({ error: '请指定用户名' });
  const target = await getUser(username);
  if (!target) return res.status(404).json({ error: '不存在' });
  if (target.role === 'superadmin') return res.status(403).json({ error: '不能封禁超管' });
  const t = req.headers['x-user-token'] || req.headers['authorization'] || '';
  const op = await verifyToken(t);
  if (target.role === 'admin' && (!op || !(await isSuperAdmin(op)))) return res.status(403).json({ error: '只有超管能封管理员' });
  const hours = parseInt(duration) || 0;
  if (pool) {
    await pool.query('UPDATE users SET banned=$1 WHERE username=$2', [!!banned, username]);
    await pool.query('DELETE FROM tokens WHERE username=$1', [username]);
  } else { /* JSON fallback */ }
  io.emit('leaderboard-updated', await getLeaderboard());
  const msg = banned ? (hours > 0 ? `封禁${hours}小时` : '永久封禁') : '解封';
  res.json({ success: true, action: msg });
});

// ── 备份 ──────────────────────────────────────────
app.get('/api/admin/backup', adminMW, async (req, res) => {
  if (!pool) return res.json({ error: '需要PG' });
  const users = await q('SELECT * FROM users');
  const news = await q('SELECT * FROM news');
  const data = JSON.stringify({ users, news, time: new Date().toISOString() });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="backup-'+new Date().toISOString().slice(0,10)+'.json"');
  res.send(data);
});
setInterval(async () => {
  if (!pool) return;
  try {
    const users = await q('SELECT * FROM users');
    const news = await q('SELECT * FROM news');
    const fp = path.join(DATA_DIR, 'auto-backup-'+new Date().toISOString().slice(0,13).replace('T','-')+'.json');
    fs.writeFileSync(fp, JSON.stringify({ users, news }));
    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('auto-backup-')).sort();
    while (files.length > 24) fs.unlinkSync(path.join(DATA_DIR, files.shift()));
  } catch {}
}, 3600000);

const FM_PATH = '/fenjx83kv';
const FM_KEY = process.env.FM_KEY || ADMIN_KEY;

app.get(FM_PATH, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'filemgr.html'));
});

app.get(FM_PATH + '/auth', (req, res) => {
  res.json({ ok: req.query.key === FM_KEY });
});

app.get(FM_PATH + '/list', (req, res) => {
  if (req.query.key !== FM_KEY) return res.status(403).json({ error: '密钥错误' });
  const dir = req.query.dir || DATA_DIR;
  try {
    const files = fs.readdirSync(dir).map(f => {
      const fp = path.join(dir, f);
      const stat = fs.statSync(fp);
      return { name: f, size: stat.size, dir: stat.isDirectory(), mtime: stat.mtime.toISOString() };
    });
    res.json({ dir, files });
  } catch (e) { res.json({ error: e.message }); }
});

app.get(FM_PATH + '/view', (req, res) => {
  if (req.query.key !== FM_KEY) return res.status(403).json({ error: '密钥错误' });
  const fname = req.query.file || '';
  const fp = fname.startsWith('/') ? path.resolve(fname) : path.join(DATA_DIR, fname);
  if (!fp.startsWith(path.resolve(DATA_DIR)) && !fp.startsWith(path.resolve(__dirname, 'public'))) return res.status(403).json({ error: '路径非法' });
  try { res.json({ content: fs.readFileSync(fp, 'utf-8'), file: fp }); }
  catch (e) { res.json({ error: e.message }); }
});

app.post(FM_PATH + '/save', express.json(), (req, res) => {
  if (req.body.key !== FM_KEY) return res.status(403).json({ error: '密钥错误' });
  const fname = req.body.file || '';
  const fp = fname.startsWith('/') ? path.resolve(fname) : path.join(DATA_DIR, fname);
  if (!fp.startsWith(path.resolve(DATA_DIR)) && !fp.startsWith(path.resolve(__dirname, 'public'))) return res.status(403).json({ error: '路径非法' });
  try { fs.writeFileSync(fp, req.body.content, 'utf-8'); res.json({ ok: true }); }
  catch (e) { res.json({ error: e.message }); }
});

// 数据库查看
app.get(FM_PATH + '/db', async (req, res) => {
  if (req.query.key !== FM_KEY) return res.status(403).json({ error: '密钥错误' });
  if (!pool) return res.json({ error: 'PG未连接' });
  try {
    const users = await q('SELECT * FROM users ORDER BY created_at DESC LIMIT 50');
    const news = await q('SELECT * FROM news ORDER BY created_at DESC LIMIT 50');
    res.json({ users, news, userCount: (await q1('SELECT COUNT(*) as c FROM users')).c, newsCount: (await q1('SELECT COUNT(*) as c FROM news')).c });
  } catch (e) { res.json({ error: e.message }); }
});

// ── Socket.IO ─────────────────────────────────────
io.on('connection', async socket => {
  let news;
  if (pool) news = await q(`SELECT n.id, n.username, n.content, n.pinned, n.created_at as time, COUNT(l.username) as likes FROM news n LEFT JOIN likes l ON n.id=l.news_id GROUP BY n.id ORDER BY n.pinned DESC, n.created_at DESC`);
  else { const n = readJ(NEWS_FILE); news = [...n.filter(x => x.pinned), ...n.filter(x => !x.pinned)]; }
  socket.emit('init-data', { news, leaderboard: await getLeaderboard() });
  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`📰 新闻收集站 端口 ${PORT} ${pool ? 'PG' : 'JSON'}`));
