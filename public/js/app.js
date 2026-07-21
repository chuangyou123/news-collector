// ═══════════════════════════════════════════════
//  新闻收集站 v3 — 前端逻辑（管理密钥加密防护）
// ═══════════════════════════════════════════════

const socket = io();
const $ = s => document.querySelector(s);

// ── 用户 DOM ──────────────────────────────────────
const userArea       = $('#userArea');
const userInfo       = $('#userInfo');
const userBadge      = $('#userBadge');
const usernameInput  = $('#usernameInput');
const passwordInput  = $('#passwordInput');
const loginBtn       = $('#loginBtn');
const switchBtn      = $('#switchToRegisterBtn');
const logoutBtn      = $('#logoutBtn');
const adminBtn       = $('#adminBtn');
const uploadCard     = $('#uploadCard');
const newsForm       = $('#newsForm');
const contentInput   = $('#contentInput');
const charCount      = $('#charCount');
const newsList       = $('#newsList');
const leaderboardList = $('#leaderboardList');
const logList        = $('#logList');
const newsCount      = $('#newsCount');
const toastContainer = $('#toastContainer');

// ── 管理员密钥 DOM ────────────────────────────────
const adminKeyOverlay  = $('#adminKeyOverlay');
const adminKeyInput    = $('#adminKeyInput');
const adminKeyCancel   = $('#adminKeyCancel');
const adminKeyConfirm  = $('#adminKeyConfirm');

// ── 管理员面板 DOM ────────────────────────────────
const adminOverlay    = $('#adminOverlay');
const adminCloseBtn   = $('#adminCloseBtn');
const adminDateFilter = $('#adminDateFilter');
const adminCopyToday  = $('#adminCopyToday');
const adminNewsList   = $('#adminNewsList');
const adminUserList   = $('#adminUserList');
const adminTabs       = document.querySelectorAll('.admin-tab');
const tabNews         = $('#tabNews');
const tabUsers        = $('#tabUsers');

// ── 改密弹窗 DOM ─────────────────────────────────
const pwdModalOverlay  = $('#pwdModalOverlay');
const pwdModalTarget   = $('#pwdModalTarget');
const pwdModalInput    = $('#pwdModalInput');
const pwdModalCancel   = $('#pwdModalCancel');
const pwdModalConfirm  = $('#pwdModalConfirm');
let pwdModalUsername = null;

// ── 状态 ──────────────────────────────────────────
let currentUser = null;
let authToken   = null;
let mode        = 'login';
let adminIPOk   = false;   // IP 在白名单中
let adminKey    = null;    // 已验证的管理密钥（仅内存，绝不持久化）

// ── 模式切换 ──────────────────────────────────────
function setMode(m) {
  mode = m;
  loginBtn.textContent = m === 'login' ? '登录' : '注册';
  switchBtn.textContent = m === 'login' ? '注册' : '← 返回登录';
}

loginBtn.addEventListener('click', () => {
  const u = usernameInput.value.trim();
  const p = passwordInput.value;
  if (!u) { showToast('请输入昵称', 'error'); return; }
  if (!p || p.length < 4) { showToast('密码至少 4 位', 'error'); return; }
  mode === 'login' ? doLogin(u, p) : doRegister(u, p);
});

switchBtn.addEventListener('click', () => {
  setMode(mode === 'login' ? 'register' : 'login');
  passwordInput.value = '';
});
passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') loginBtn.click(); });

// ── 注册 / 登录 ──────────────────────────────────
async function doRegister(username, password) {
  loginBtn.disabled = true; loginBtn.textContent = '⏳ 注册中...';
  try {
    const res = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '注册失败');
    onAuthSuccess(data);
    showToast(`🎉 注册成功，欢迎 ${data.username}！`, 'success');
  } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  finally { loginBtn.disabled = false; setMode(mode); }
}

async function doLogin(username, password) {
  loginBtn.disabled = true; loginBtn.textContent = '⏳ 登录中...';
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '登录失败');
    onAuthSuccess(data);
    showToast(`👋 欢迎回来，${data.username}！`, 'success');
  } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  finally { loginBtn.disabled = false; setMode(mode); }
}

async function onAuthSuccess(data) {
  currentUser = data.username;
  authToken   = data.token;
  localStorage.setItem('nc_user', data.username);
  localStorage.setItem('nc_token', data.token);

  userArea.style.display = 'none';
  userInfo.style.display = 'flex';
  userBadge.textContent = `👤 ${data.username}`;
  uploadCard.style.display = 'block';
  usernameInput.value = '';
  passwordInput.value = '';

  await checkAdminIP();
}

// ── 退出 ──────────────────────────────────────────
logoutBtn.addEventListener('click', async () => {
  if (authToken) {
    fetch('/api/logout', { method: 'POST', headers: { 'Authorization': authToken } }).catch(() => {});
  }
  currentUser = null; authToken = null; adminIPOk = false; adminKey = null;
  localStorage.removeItem('nc_user');
  localStorage.removeItem('nc_token');
  userArea.style.display = 'flex';
  userInfo.style.display = 'none';
  uploadCard.style.display = 'none';
  adminBtn.style.display = 'none';
  adminOverlay.style.display = 'none';
  adminKeyOverlay.style.display = 'none';
  setMode('login');
  showToast('已退出', 'info');
});

// ── 恢复登录 ──────────────────────────────────────
(async function restoreLogin() {
  const savedToken = localStorage.getItem('nc_token');
  if (!savedToken) return;
  try {
    const res = await fetch('/api/me', { headers: { 'Authorization': savedToken } });
    if (!res.ok) { localStorage.removeItem('nc_token'); localStorage.removeItem('nc_user'); return; }
    const data = await res.json();
    currentUser = data.username;
    authToken   = savedToken;
    userArea.style.display = 'none';
    userInfo.style.display = 'flex';
    userBadge.textContent = `👤 ${data.username}`;
    uploadCard.style.display = 'block';
    await checkAdminIP();
  } catch {}
})();

// ── 检查管理员 IP（仅检查白名单，不验证密钥） ──
async function checkAdminIP() {
  try {
    const res = await fetch('/api/admin/check', {
      headers: authToken ? { 'Authorization': authToken } : {}
    });
    const data = await res.json();
    adminIPOk = data.allowed;
    if (adminIPOk) adminBtn.style.display = 'inline-block';
  } catch { adminIPOk = false; }
}

// ═══════════════════════════════════════════════════
//  发布新闻
// ═══════════════════════════════════════════════════
contentInput.addEventListener('input', () => {
  charCount.textContent = `${contentInput.value.length}/500`;
});

newsForm.addEventListener('submit', async e => {
  e.preventDefault();
  const content = contentInput.value.trim();
  if ([...content].length < 5) { showToast('内容至少 5 个字符', 'error'); return; }
  if ([...content].length > 500) { showToast('内容最多 500 个字符', 'error'); return; }
  if (!authToken) { showToast('请先登录', 'error'); return; }

  const btn = newsForm.querySelector('button');
  btn.disabled = true; btn.textContent = '⏳ 发布中...';
  try {
    const res = await fetch('/api/news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authToken },
      body: JSON.stringify({ content })
    });
    if (!res.ok) {
      const err = await res.json();
      if (res.status === 401) { logoutBtn.click(); throw new Error('登录已过期，请重新登录'); }
      if (res.status === 403) throw new Error(err.error || '账号已被封禁');
      throw new Error(err.error || '发布失败');
    }
    contentInput.value = ''; charCount.textContent = '0/500';
    showToast('✅ 发布成功！', 'success');
  } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  finally { btn.disabled = false; btn.textContent = '🚀 发布'; }
});

// ═══════════════════════════════════════════════════
//  Socket.IO
// ═══════════════════════════════════════════════════
socket.on('init-data', data => {
  renderNews(data.news);
  renderLeaderboard(data.leaderboard);
  updateStats(data.news);
});

socket.on('news-added', item => {
  prependNews(item);
  newsCount.textContent = document.querySelectorAll('.news-card').length;
  addLog(item.username, item.content.slice(0, 20) + (item.content.length > 20 ? '...' : ''));
});

socket.on('news-deleted', data => {
  const card = document.querySelector(`[data-id="${data.id}"]`);
  if (card) { card.style.opacity = '0'; card.style.transform = 'translateX(30px)'; card.style.transition = 'all 0.3s'; setTimeout(() => card.remove(), 300); }
  newsCount.textContent = document.querySelectorAll('.news-card').length;
  if (adminKey && adminOverlay.style.display !== 'none') loadAdminNews();
});

socket.on('leaderboard-updated', lb => renderLeaderboard(lb));

socket.on('news-pin-toggled', data => {
  // 更新卡片置顶状态
  const card = document.querySelector(`[data-id="${data.id}"]`);
  if (card) {
    if (data.pinned) { card.classList.add('pinned'); card.querySelector('.pin-badge').style.display = 'inline'; }
    else { card.classList.remove('pinned'); card.querySelector('.pin-badge').style.display = 'none'; }
  }
  if (adminKey && adminOverlay.style.display !== 'none') loadAdminNews();
});

// ═══════════════════════════════════════════════════
//  渲染函数
// ═══════════════════════════════════════════════════
function renderNews(arr) {
  if (!arr || arr.length === 0) {
    newsList.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>还没有新闻，快来分享第一条吧！</p></div>';
    newsCount.textContent = '0'; return;
  }
  newsList.innerHTML = arr.map(item => newsCardHTML(item)).join('');
  newsCount.textContent = arr.length;
}
function prependNews(item) {
  const empty = newsList.querySelector('.empty-state'); if (empty) empty.remove();
  const t = document.createElement('div'); t.innerHTML = newsCardHTML(item);
  const card = t.firstElementChild; newsList.insertBefore(card, newsList.firstChild);
  setTimeout(() => card.classList.remove('new-arrival'), 3000);
}
function newsCardHTML(item) {
  const initial = (item.username || '?')[0].toUpperCase();
  const color = getColor(item.username);
  const timeStr = formatTime(item.time);
  return `<div class="news-card new-arrival ${item.pinned ? 'pinned' : ''}" data-id="${item.id}">
    <div class="news-header">
      <div class="news-avatar" style="background:${color}">${initial}</div>
      <div class="news-meta"><div class="news-username">${esc(item.username)} <span class="pin-badge" style="display:${item.pinned ? 'inline' : 'none'}">📌置顶</span></div><div class="news-time">${timeStr}</div></div>
    </div>
    <div class="news-content">${esc(item.content)}</div>
  </div>`;
}
function renderLeaderboard(lb) {
  if (!lb || lb.length === 0) { leaderboardList.innerHTML = '<div class="empty-state small"><p>暂无排名</p></div>'; return; }
  leaderboardList.innerHTML = lb.map((u, i) => {
    const r = i + 1;
    let tc = '', ri = r;
    if (r === 1) { tc = 'top-1'; ri = '🥇'; } else if (r === 2) { tc = 'top-2'; ri = '🥈'; } else if (r === 3) { tc = 'top-3'; ri = '🥉'; }
    return `<div class="leaderboard-item ${tc}"><div class="rank-badge">${ri}</div><div class="rank-avatar" style="background:${u.avatar||getColor(u.username)}">${u.username[0].toUpperCase()}</div><div class="rank-name">${esc(u.username)}</div><div class="rank-count">${u.count} 条</div></div>`;
  }).join('');
}
function addLog(username, action) {
  const el = document.createElement('div'); el.className = 'log-item';
  el.innerHTML = `<span class="log-user">${esc(username)}</span> <span class="log-action">${action}</span>`;
  logList.insertBefore(el, logList.firstChild);
  while (logList.children.length > 50) logList.lastElementChild.remove();
}
function updateStats(news) { newsCount.textContent = news ? news.length : 0; }

// ═══════════════════════════════════════════════════
//  管理员：密钥验证 → 面板
// ═══════════════════════════════════════════════════

// 点击齿轮 → 弹出密钥输入框
adminBtn.addEventListener('click', () => {
  adminKeyInput.value = '';
  adminKeyOverlay.style.display = 'flex';
  adminKeyInput.focus();
});
adminKeyCancel.addEventListener('click', () => { adminKeyOverlay.style.display = 'none'; });
adminKeyOverlay.addEventListener('click', e => { if (e.target === adminKeyOverlay) adminKeyOverlay.style.display = 'none'; });
adminKeyConfirm.addEventListener('click', doVerifyAdminKey);
adminKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') doVerifyAdminKey(); });

async function doVerifyAdminKey() {
  const key = adminKeyInput.value.trim();
  if (!key) { showToast('请输入管理员密钥', 'error'); return; }
  adminKeyConfirm.disabled = true; adminKeyConfirm.textContent = '⏳';
  try {
    const res = await fetch('/api/admin/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': authToken || '' },
      body: JSON.stringify({ key })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || '密钥错误'); }
    adminKey = key;   // 仅存内存
    adminKeyOverlay.style.display = 'none';
    adminKeyInput.value = '';
    openAdminPanel();
  } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  finally { adminKeyConfirm.disabled = false; adminKeyConfirm.textContent = '验证'; }
}

adminCloseBtn.addEventListener('click', () => { adminOverlay.style.display = 'none'; });

function openAdminPanel() {
  adminOverlay.style.display = 'flex';
  adminDateFilter.value = new Date().toISOString().slice(0, 10);
  switchAdminTab('news');
  loadAdminNews();
}

// Tab 切换
adminTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    adminTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    switchAdminTab(tab.dataset.tab);
  });
});

function switchAdminTab(tab) {
  tabNews.style.display = tab === 'news' ? 'block' : 'none';
  tabUsers.style.display = tab === 'users' ? 'block' : 'none';
  if (tab === 'news') loadAdminNews();
  if (tab === 'users') loadAdminUsers();
}

adminDateFilter.addEventListener('change', loadAdminNews);

// ── 管理 API（均携带 x-admin-key） ────────────────
function adminHeaders() {
  return { 'x-admin-key': adminKey || '', 'x-user-token': authToken || '' };
}

async function loadAdminNews() {
  const date = adminDateFilter.value || new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch(`/api/admin/news?date=${date}`, { headers: adminHeaders() });
    if (!res.ok) throw new Error('无权限');
    const list = await res.json();
    if (list.length === 0) {
      adminNewsList.innerHTML = '<div class="empty-state small"><p>该日期暂无新闻</p></div>';
    } else {
      adminNewsList.innerHTML = list.map(item => `
        <div class="admin-news-item">
          <div class="admin-news-info">
            <span class="admin-news-user">${esc(item.username)}</span>
            <span class="admin-news-title">${esc(item.content.slice(0, 50))}${item.content.length > 50 ? '...' : ''}</span>
            <span class="admin-news-time">${formatTime(item.time)}</span>
          </div>
          <div class="admin-news-actions">
            <button class="btn-sm ${item.pinned ? 'btn-unpin' : 'btn-pin'}" onclick="togglePin('${item.id}', ${!item.pinned})">${item.pinned ? '📌已置顶' : '📌置顶'}</button>
            <button class="btn-del" onclick="deleteNews('${item.id}')" title="删除此新闻">🗑</button>
          </div>
        </div>
      `).join('');
    }
  } catch (err) { adminNewsList.innerHTML = `<div class="empty-state small"><p>加载失败: ${esc(err.message)}</p></div>`; }
}

// ── 置顶/取消置顶 ────────────────────────────────
window.togglePin = async function(id, pin) {
  try {
    const res = await fetch('/api/admin/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ id, pinned: pin })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    showToast(pin ? '📌 已置顶' : '已取消置顶', 'success');
    loadAdminNews();
  } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
};

window.deleteNews = async function(id) {
  if (!confirm('确定要删除这条新闻吗？')) return;
  try {
    const res = await fetch(`/api/admin/news/${id}`, { method: 'DELETE', headers: adminHeaders() });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    showToast('🗑 新闻已删除', 'success');
    loadAdminNews();
  } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
};

adminCopyToday.addEventListener('click', async () => {
  const date = adminDateFilter.value || new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch(`/api/admin/news?date=${date}`, { headers: adminHeaders() });
    const list = await res.json();
    if (list.length === 0) { showToast('当天没有新闻', 'info'); return; }
    const text = list.map(item => item.content).join('\n---\n');
    await navigator.clipboard.writeText(text);
    showToast(`📋 已复制 ${list.length} 条新闻`, 'success');
  } catch (err) { showToast('复制失败，请手动选择', 'error'); }
});

async function loadAdminUsers() {
  try {
    const res = await fetch('/api/admin/users', { headers: adminHeaders() });
    if (!res.ok) throw new Error('无权限');
    const list = await res.json();
    if (list.length === 0) {
      adminUserList.innerHTML = '<div class="empty-state small"><p>暂无用户</p></div>';
      return;
    }
    adminUserList.innerHTML = list.map(u => `
      <div class="admin-user-item ${u.banned ? 'banned' : ''}">
        <div class="admin-user-info">
          <span class="admin-user-name">${esc(u.username)}${u.banned ? ' 🚫' : ''}${u.role==='superadmin'?' 👑':u.role==='admin'?' 🔧':''}</span>
          <span class="admin-user-ip">IP: ${esc(u.ip)}</span>
          <span class="admin-user-count">📰 ${u.count} 条</span>
          <span class="admin-user-role">${u.role==='superadmin'?'超级管理员':u.role==='admin'?'管理员':'用户'}</span>
          <span class="admin-user-date">注册: ${u.createdAt ? u.createdAt.slice(0,10) : '?'}</span>
        </div>
        <div class="admin-user-actions">
          ${u.role !== 'superadmin' ? `<button class="btn-sm ${u.role==='admin' ? 'btn-demote' : 'btn-promote'}" onclick="toggleRole('${esc(u.username)}', '${u.role==='admin'?'user':'admin'}')">${u.role==='admin'?'⬇ 撤销':'⬆ 设为管理员'}</button>` : ''}
          <button class="btn-sm ${u.banned ? 'btn-unban' : 'btn-ban'}" onclick="toggleBan('${esc(u.username)}', ${!u.banned})">${u.banned ? '✅ 解封' : '🚫 封禁'}</button>
          <button class="btn-sm btn-pwd" onclick="openPwdModal('${esc(u.username)}')">🔑 改密</button>
        </div>
      </div>
    `).join('');
  } catch (err) { adminUserList.innerHTML = `<div class="empty-state small"><p>加载失败</p></div>`; }
}

window.toggleBan = async function(username, ban) {
  const action = ban ? '封禁' : '解封';
  if (!confirm(`确定要${action}「${username}」吗？`)) return;
  try {
    const res = await fetch('/api/admin/ban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ username, banned: ban })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    showToast(`${action}成功`, 'success');
    loadAdminUsers();
  } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
};

// ── 赋予/撤销管理员 ──────────────────────────────
window.toggleRole = async function(username, role) {
  const action = role === 'admin' ? '设为管理员' : '撤销管理员';
  if (!confirm(`确定要${action}「${username}」吗？（需要超级管理员权限）`)) return;
  try {
    const res = await fetch('/api/admin/set-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders(), 'x-user-token': authToken },
      body: JSON.stringify({ username, role })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    showToast(`${action}成功`, 'success');
    loadAdminUsers();
  } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
};

// ── 改密弹窗 ──────────────────────────────────────
window.openPwdModal = function(username) {
  pwdModalUsername = username;
  pwdModalTarget.textContent = `用户：${username}`;
  pwdModalInput.value = '';
  pwdModalOverlay.style.display = 'flex';
};
pwdModalCancel.addEventListener('click', () => { pwdModalOverlay.style.display = 'none'; });
pwdModalOverlay.addEventListener('click', e => { if (e.target === pwdModalOverlay) pwdModalOverlay.style.display = 'none'; });
pwdModalConfirm.addEventListener('click', async () => {
  const pw = pwdModalInput.value.trim();
  if (!pw || pw.length < 4) { showToast('新密码至少 4 位', 'error'); return; }
  try {
    const res = await fetch('/api/admin/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ username: pwdModalUsername, newPassword: pw })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    showToast(`🔑 ${pwdModalUsername} 的密码已修改`, 'success');
    pwdModalOverlay.style.display = 'none';
  } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
});
pwdModalInput.addEventListener('keydown', e => { if (e.key === 'Enter') pwdModalConfirm.click(); });

// ═══════════════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════════════
function getColor(name) {
  const colors = ['#FF6B6B','#FF9F43','#FECA57','#54A0FF','#5F27CD','#01A3A4','#F368E0','#2ED573','#FF6348','#7BED9F','#70A1FF','#5352ED','#FF4757','#1E90FF','#2ED573'];
  let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date(), diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff/60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)} 小时前`;
  return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escAttr(s) { return s.replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function showToast(msg, type='info') {
  const icons = { success:'✅', error:'❌', info:'ℹ️' };
  const t = document.createElement('div'); t.className = `toast ${type}`;
  t.textContent = `${icons[type]||''} ${msg}`;
  toastContainer.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(50px)'; t.style.transition='all 0.3s ease'; setTimeout(() => t.remove(),300); }, 3500);
}
