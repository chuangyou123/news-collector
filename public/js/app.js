// ═══════════════════════════════════════════════
//  新闻收集站 — 三Tab版
// ═══════════════════════════════════════════════
const socket = io();
const $ = s => document.querySelector(s);

// DOM
const userArea=$('#userArea'),userInfo=$('#userInfo'),userBadge=$('#userBadge');
const usernameInput=$('#usernameInput'),passwordInput=$('#passwordInput');
const loginBtn=$('#loginBtn'),switchBtn=$('#switchToRegisterBtn'),logoutBtn=$('#logoutBtn'),adminBtn=$('#adminBtn');
const uploadCard=$('#uploadCard'),newsForm=$('#newsForm'),contentInput=$('#contentInput');
const charCount=$('#charCount'),newsList=$('#newsList'),leaderboardList=$('#leaderboardList');
const toastContainer=$('#toastContainer'),totalCount=$('#totalCount');
const libraryList=$('#libraryList'),downloadBtn=$('#downloadBtn'),searchInput=$('#searchInput');

const adminKeyOverlay=$('#adminKeyOverlay'),adminKeyInput=$('#adminKeyInput');
const adminKeyCancel=$('#adminKeyCancel'),adminKeyConfirm=$('#adminKeyConfirm');
const adminOverlay=$('#adminOverlay'),adminCloseBtn=$('#adminCloseBtn');
const adminDateFilter=$('#adminDateFilter'),adminCopyToday=$('#adminCopyToday');
const adminNewsList=$('#adminNewsList'),adminUserList=$('#adminUserList');
const adminTabs=document.querySelectorAll('.admin-tab'),tabNews=$('#tabNews'),tabUsers=$('#tabUsers');
const mainTabs=document.querySelectorAll('.main-tab'),tabPublish=$('#tabPublish'),tabLibrary=$('#tabLibrary'),tabRank=$('#tabRank');

const pwdModalOverlay=$('#pwdModalOverlay'),pwdModalTarget=$('#pwdModalTarget');
const pwdModalInput=$('#pwdModalInput'),pwdModalCancel=$('#pwdModalCancel'),pwdModalConfirm=$('#pwdModalConfirm');
let pwdModalUsername=null;

// State
let currentUser=null,authToken=null,mode='login',adminIPOk=false,adminKey=null;
let allNews=[],publishNews=[],knownIds=new Set();

// ═══ Main Tabs ═══
mainTabs.forEach(t=>t.addEventListener('click',()=>{
  mainTabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');
  const tab=t.dataset.tab;
  tabPublish.style.display=tab==='publish'?'block':'none';
  tabLibrary.style.display=tab==='library'?'block':'none';
  tabRank.style.display=tab==='rank'?'block':'none';
  if(tab==='library')loadLibrary();
  if(tab==='rank'&&allNews.length)renderLeaderboardFromData();
}));

// ═══ Auth ═══
function setMode(m){mode=m;loginBtn.textContent=m==='login'?'登录':'注册';switchBtn.textContent=m==='login'?'注册':'←返回登录';}
loginBtn.addEventListener('click',()=>{const u=usernameInput.value.trim(),p=passwordInput.value;if(!u){showToast('请输入昵称','error');return;}if(!p||p.length<4){showToast('密码至少4位','error');return;}mode==='login'?doLogin(u,p):doRegister(u,p);});
switchBtn.addEventListener('click',()=>{setMode(mode==='login'?'register':'login');passwordInput.value='';});
passwordInput.addEventListener('keydown',e=>{if(e.key==='Enter')loginBtn.click();});

async function doRegister(u,p){loginBtn.disabled=true;loginBtn.textContent='⏳';try{const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const d=await r.json();if(!r.ok)throw new Error(d.error);onAuthSuccess(d);showToast('🎉注册成功','success');}catch(e){showToast('❌'+e.message,'error');}finally{loginBtn.disabled=false;setMode(mode);}}
async function doLogin(u,p){loginBtn.disabled=true;loginBtn.textContent='⏳';try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const d=await r.json();if(!r.ok)throw new Error(d.error);onAuthSuccess(d);showToast('👋欢迎','success');}catch(e){showToast('❌'+e.message,'error');}finally{loginBtn.disabled=false;setMode(mode);}}
function onAuthSuccess(data){currentUser=data.username;authToken=data.token;localStorage.setItem('nc_user',data.username);localStorage.setItem('nc_token',data.token);userArea.style.display='none';userInfo.style.display='flex';userBadge.textContent='👤'+data.username;uploadCard.style.display='block';usernameInput.value='';passwordInput.value='';checkAdminIP();}
logoutBtn.addEventListener('click',()=>{if(authToken)fetch('/api/logout',{method:'POST',headers:{Authorization:authToken}}).catch(()=>{});currentUser=null;authToken=null;adminIPOk=false;adminKey=null;localStorage.clear();userArea.style.display='flex';userInfo.style.display='none';uploadCard.style.display='none';adminBtn.style.display='none';adminOverlay.style.display='none';adminKeyOverlay.style.display='none';setMode('login');showToast('已退出','info');});
(async()=>{const t=localStorage.getItem('nc_token');if(!t)return;try{const r=await fetch('/api/me',{headers:{Authorization:t}});if(!r.ok){localStorage.clear();return}const d=await r.json();currentUser=d.username;authToken=t;userArea.style.display='none';userInfo.style.display='flex';userBadge.textContent='👤'+d.username;uploadCard.style.display='block';checkAdminIP();}catch{}})();
async function checkAdminIP(){try{const r=await fetch('/api/admin/check',{headers:authToken?{Authorization:authToken}:{}});const d=await r.json();adminIPOk=d.allowed;if(adminIPOk)adminBtn.style.display='inline-block';}catch{adminIPOk=false;}}

// ═══ Publish ═══
contentInput.addEventListener('input',()=>{charCount.textContent=contentInput.value.length+'/500';});
newsForm.addEventListener('submit',async e=>{e.preventDefault();const c=contentInput.value.trim();if([...c].length<5){showToast('至少5字符','error');return}if(!authToken){showToast('请先登录','error');return}const btn=newsForm.querySelector('button');btn.disabled=true;btn.textContent='⏳';try{const r=await fetch('/api/news',{method:'POST',headers:{'Content-Type':'application/json',Authorization:authToken},body:JSON.stringify({content:c})});if(!r.ok){const d=await r.json();throw new Error(d.error)}contentInput.value='';charCount.textContent='0/500';showToast('✅发布成功','success')}catch(e){showToast('❌'+e.message,'error')}finally{btn.disabled=false;btn.textContent='🚀发布';}});

// ═══ News Library ═══
async function loadLibrary(){try{const r=await fetch('/api/news/all');allNews=await r.json()}catch{allNews=allNews||[]}const q=searchInput.value.trim().toLowerCase();let list=allNews;if(q)list=allNews.filter(n=>n.content.toLowerCase().includes(q));libraryList.innerHTML=list.length?list.map((n,i)=>`<div class="lib-item"><span class="lib-num">${i+1}.</span><span class="lib-user">${esc(n.username)}</span><span class="lib-text">${esc(n.content.slice(0,120))}${n.content.length>120?'...':''}</span>${adminIPOk&&!n.id.startsWith('seed-')?`<button class=\"lib-del\" onclick=\"delFromLib('${n.id}')\">✕</button>`:''}</div>`).join(''):'<div class="empty-state"><p>未找到</p></div>';totalCount.textContent=list.length;}
searchInput.addEventListener('input',loadLibrary);
downloadBtn.addEventListener('click',()=>{window.open('/api/news/download','_blank')});

// ═══ Socket ═══
socket.on('init-data',data=>{publishNews=data.news;renderNews(data.news);renderLeaderboard(data.leaderboard);fetch('/api/news/count').then(r=>r.json()).then(d=>{totalCount.textContent=d.count;});});
socket.on('news-added',item=>{publishNews.unshift(item);prependNews(item);fetch('/api/news/count').then(r=>r.json()).then(d=>totalCount.textContent=d.count);});
socket.on('news-deleted',data=>{publishNews=publishNews.filter(n=>n.id!==data.id);const c=document.querySelector('[data-id=\"'+data.id+'\"]');if(c){c.style.opacity='0';c.style.transition='.3s';setTimeout(()=>c.remove(),300)}fetch('/api/news/count').then(r=>r.json()).then(d=>totalCount.textContent=d.count);});
socket.on('leaderboard-updated',lb=>renderLeaderboard(lb));

// ═══ Render ═══
function renderNews(arr){if(!arr||!arr.length){newsList.innerHTML='<div class=\"empty-state\"><div class=\"empty-icon\">📭</div><p>还没有新闻</p></div>';return}newsList.innerHTML=arr.map(n=>newsCardHTML(n)).join('');}
function prependNews(item){const e=newsList.querySelector('.empty-state');if(e)e.remove();const d=document.createElement('div');d.innerHTML=newsCardHTML(item);newsList.insertBefore(d.firstElementChild,newsList.firstChild);}
function newsCardHTML(item){const i=(item.username||'?')[0].toUpperCase(),c=getColor(item.username);return `<div class=\"news-card ${item.pinned?'pinned':''}\" data-id=\"${item.id}\"><div class=\"news-header\"><div class=\"news-avatar\" style=\"background:${c}\">${i}</div><div class=\"news-meta\"><div class=\"news-username\">${esc(item.username)} ${item.pinned?'<span class=\"pin-badge\">📌</span>':''}</div><div class=\"news-time\">${fmt(item.time)}</div></div></div><div class=\"news-content\">${esc(item.content)}</div>${adminIPOk&&!item.id.startsWith('seed-')?`<button class=\"news-del-btn\" onclick=\"event.stopPropagation();delFromLib('${item.id}')\">✕</button>`:''}</div>`;}
function renderLeaderboard(lb){if(!lb||!lb.length){leaderboardList.innerHTML='<div class=\"empty-state small\"><p>暂无</p></div>';return}leaderboardList.innerHTML=lb.map((u,i)=>{const r=i+1;let tc='',ri=r;if(r===1){tc='top-1';ri='🥇'}else if(r===2){tc='top-2';ri='🥈'}else if(r===3){tc='top-3';ri='🥉'}return `<div class=\"leaderboard-item ${tc}\"><div class=\"rank-badge\">${ri}</div><div class=\"rank-avatar\" style=\"background:${u.avatar||getColor(u.username)}\">${u.username[0].toUpperCase()}</div><div class=\"rank-name\">${esc(u.username)}</div><div class=\"rank-count\">${u.count}条</div></div>`}).join('');}
function renderLeaderboardFromData(){const lb=Object.values(allNews.reduce((a,n)=>{if(!n.seed){if(!a[n.username])a[n.username]={username:n.username,count:0,avatar:getColor(n.username)};a[n.username].count++}return a},{})).sort((a,b)=>b.count-a.count).slice(0,20);renderLeaderboard(lb);}

// ═══ Direct Delete ═══
window.delFromLib=async function(id){if(!confirm('确定删除？'))return;if(!adminKey){showToast('请先点⚙️输入管理密钥','error');return}try{const r=await fetch('/api/admin/news/'+id,{method:'DELETE',headers:adminHeaders()});if(!r.ok){const d=await r.json();throw new Error(d.error)}showToast('🗑已删除','success')}catch(e){showToast('❌'+e.message,'error')}};

// ═══ Admin Panel ═══
adminBtn.addEventListener('click',()=>{adminKeyInput.value='';adminKeyOverlay.style.display='flex';adminKeyInput.focus();});
adminKeyCancel.addEventListener('click',()=>{adminKeyOverlay.style.display='none';});
adminKeyConfirm.addEventListener('click',async()=>{const k=adminKeyInput.value.trim();if(!k){showToast('请输入密钥','error');return}adminKeyConfirm.disabled=true;try{const r=await fetch('/api/admin/auth',{method:'POST',headers:{'Content-Type':'application/json',Authorization:authToken||''},body:JSON.stringify({key:k})});if(!r.ok)throw new Error('密钥错误');adminKey=k;adminKeyOverlay.style.display='none';adminKeyInput.value='';openAdminPanel()}catch(e){showToast('❌'+e.message,'error')}finally{adminKeyConfirm.disabled=false;}});
adminCloseBtn.addEventListener('click',()=>{adminOverlay.style.display='none';});
function adminHeaders(){return{'x-admin-key':adminKey||'','x-user-token':authToken||''};}
function openAdminPanel(){adminOverlay.style.display='flex';adminDateFilter.value=new Date().toISOString().slice(0,10);switchAdminTab('news');loadAdminNews();}
adminTabs.forEach(t=>t.addEventListener('click',()=>{adminTabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');switchAdminTab(t.dataset.tab);}));
function switchAdminTab(t){tabNews.style.display=t==='news'?'block':'none';tabUsers.style.display=t==='users'?'block':'none';if(t==='news')loadAdminNews();if(t==='users')loadAdminUsers();}
adminDateFilter.addEventListener('change',loadAdminNews);
async function loadAdminNews(){const d=adminDateFilter.value||new Date().toISOString().slice(0,10);try{const r=await fetch('/api/admin/news?date='+d,{headers:adminHeaders()});if(!r.ok)throw new Error('无权限');const list=await r.json();adminNewsList.innerHTML=list.length?list.map(n=>`<div class=\"admin-news-item\"><div class=\"admin-news-info\"><span class=\"admin-news-user\">${esc(n.username)}</span><span class=\"admin-news-title\">${esc((n.content||'').slice(0,50))}</span><span class=\"admin-news-time\">${fmt(n.time||n.created_at)}</span></div><div class=\"admin-news-actions\">${!n.seed?`<button class=\"btn-sm ${n.pinned?'btn-unpin':'btn-pin'}\" onclick=\"togglePin('${n.id}',${!n.pinned})\">${n.pinned?'📌已置顶':'📌置顶'}</button><button class=\"btn-del\" onclick=\"deleteNews('${n.id}')\">🗑</button>`:''}</div></div>`).join(''):'<div class=\"empty-state small\"><p>该日期暂无</p></div>';}catch(e){adminNewsList.innerHTML='<div class=\"empty-state small\"><p>'+esc(e.message)+'</p></div>';}}
window.togglePin=async(id,pin)=>{try{const r=await fetch('/api/admin/pin',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders()},body:JSON.stringify({id,pinned:pin})});if(!r.ok)throw new Error((await r.json()).error);showToast(pin?'📌已置顶':'已取消','success');loadAdminNews()}catch(e){showToast('❌'+e.message,'error')}};
window.deleteNews=async(id)=>{if(!confirm('确定删除？'))return;try{const r=await fetch('/api/admin/news/'+id,{method:'DELETE',headers:adminHeaders()});if(!r.ok)throw new Error((await r.json()).error);showToast('🗑已删除','success');loadAdminNews()}catch(e){showToast('❌'+e.message,'error')}};
adminCopyToday.addEventListener('click',async()=>{const d=adminDateFilter.value||new Date().toISOString().slice(0,10);try{const r=await fetch('/api/admin/news?date='+d,{headers:adminHeaders()});const list=await r.json();if(!list.length){showToast('当天无新闻','info');return}await navigator.clipboard.writeText(list.map(x=>x.content).join('\n---\n'));showToast('📋已复制'+list.length+'条','success')}catch(e){showToast('复制失败','error')}});
async function loadAdminUsers(){try{const r=await fetch('/api/admin/users',{headers:adminHeaders()});if(!r.ok)throw new Error('无权限');const list=await r.json();adminUserList.innerHTML=list.length?list.map(u=>`<div class=\"admin-user-item ${u.banned?'banned':''}\"><div class=\"admin-user-info\"><span class=\"admin-user-name\">${esc(u.username)}${u.banned?'🚫':''}${u.role==='superadmin'?'👑':u.role==='admin'?'🔧':''}</span><span class=\"admin-user-ip\">IP:${esc(u.ip)}</span><span class=\"admin-user-count\">📰${u.count}条</span><span class=\"admin-user-role\">${u.role==='superadmin'?'超管':u.role==='admin'?'管理':'用户'}</span></div><div class=\"admin-user-actions\">${u.role!=='superadmin'?`<button class=\"btn-sm ${u.role==='admin'?'btn-demote':'btn-promote'}\" onclick=\"toggleRole('${esc(u.username)}','${u.role==='admin'?'user':'admin'}')\">${u.role==='admin'?'⬇撤销':'⬆设为管理'}</button>`:''}<button class=\"btn-sm ${u.banned?'btn-unban':'btn-ban'}\" onclick=\"toggleBan('${esc(u.username)}',${!u.banned})\">${u.banned?'✅解封':'🚫封禁'}</button><button class=\"btn-sm btn-pwd\" onclick=\"openPwd('${esc(u.username)}')\">🔑改密</button></div></div>`).join(''):'<div class=\"empty-state small\"><p>暂无</p></div>';}catch(e){adminUserList.innerHTML='<div class=\"empty-state small\"><p>'+esc(e.message)+'</p></div>';}}
window.toggleBan=async(u,ban)=>{if(!confirm('确定'+(ban?'封禁':'解封')+'「'+u+'」？'))return;try{const r=await fetch('/api/admin/ban',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders()},body:JSON.stringify({username:u,banned:ban})});if(!r.ok)throw new Error((await r.json()).error);showToast('成功','success');loadAdminUsers()}catch(e){showToast('❌'+e.message,'error')}};
window.toggleRole=async(u,role)=>{if(!confirm('确定'+(role==='admin'?'设为管理':'撤销管理')+'「'+u+'」？'))return;try{const r=await fetch('/api/admin/set-role',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders(),'x-user-token':authToken},body:JSON.stringify({username:u,role})});if(!r.ok)throw new Error((await r.json()).error);showToast('成功','success');loadAdminUsers()}catch(e){showToast('❌'+e.message,'error')}};
window.openPwd=function(u){pwdModalUsername=u;pwdModalTarget.textContent='用户：'+u;pwdModalInput.value='';pwdModalOverlay.style.display='flex';};
pwdModalCancel.addEventListener('click',()=>{pwdModalOverlay.style.display='none';});
pwdModalConfirm.addEventListener('click',async()=>{const p=pwdModalInput.value.trim();if(!p||p.length<4){showToast('密码至少4位','error');return}try{const r=await fetch('/api/admin/reset-password',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders()},body:JSON.stringify({username:pwdModalUsername,newPassword:p})});if(!r.ok)throw new Error((await r.json()).error);showToast('🔑已修改','success');pwdModalOverlay.style.display='none'}catch(e){showToast('❌'+e.message,'error')}});

// ═══ Utils ═══
function getColor(n){const c=['#FF6B6B','#FF9F43','#FECA57','#54A0FF','#5F27CD','#01A3A4','#F368E0','#2ED573','#FF6348','#7BED9F','#70A1FF','#5352ED','#FF4757','#1E90FF','#2ED573'];let h=0;for(let i=0;i<n.length;i++)h=n.charCodeAt(i)+((h<<5)-h);return c[Math.abs(h)%c.length];}
function fmt(s){if(!s)return'';const d=new Date(s),n=new Date(),diff=n-d;if(diff<6e4)return'刚刚';if(diff<36e5)return Math.floor(diff/6e4)+'分钟前';if(diff<864e5)return Math.floor(diff/36e5)+'小时前';return (d.getMonth()+1)+'-'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function showToast(msg,type){const icons={success:'✅',error:'❌',info:'ℹ️'},t=document.createElement('div');t.className='toast '+type;t.textContent=(icons[type]||'')+' '+msg;toastContainer.appendChild(t);setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(50px)';t.style.transition='.3s';setTimeout(()=>t.remove(),300)},3500);}
