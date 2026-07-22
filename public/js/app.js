// ═══════════════════════════════════════════════
//  新闻收集站 — 全功能版 vFinal
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
const announceBanner=$('#announceBanner'),announceText=$('#announceText'),announceTime=$('#announceTime');
const pagination=$('#pagination'),tagFilter=$('#tagFilter'),darkToggle=$('#darkToggle');

const adminKeyOverlay=$('#adminKeyOverlay'),adminKeyInput=$('#adminKeyInput');
const adminKeyCancel=$('#adminKeyCancel'),adminKeyConfirm=$('#adminKeyConfirm');
const adminOverlay=$('#adminOverlay'),adminCloseBtn=$('#adminCloseBtn');
const adminDateFilter=$('#adminDateFilter'),adminCopyToday=$('#adminCopyToday');
const adminNewsList=$('#adminNewsList'),adminUserList=$('#adminUserList'),adminReportList=$('#adminReportList');
const adminTabs=document.querySelectorAll('.admin-tab'),tabNews=$('#tabNews'),tabUsers=$('#tabUsers'),tabAnnounce=$('#tabAnnounce'),tabReports=$('#tabReports');
const mainTabs=document.querySelectorAll('.main-tab'),tabPublish=$('#tabPublish'),tabLibrary=$('#tabLibrary'),tabRank=$('#tabRank');
const announceInput=$('#announceInput'),announceList=$('#announceList');

const pwdModalOverlay=$('#pwdModalOverlay'),pwdModalTarget=$('#pwdModalTarget');
const pwdModalInput=$('#pwdModalInput'),pwdModalCancel=$('#pwdModalCancel'),pwdModalConfirm=$('#pwdModalConfirm');
let pwdModalUsername=null;

// State
let currentUser=null,authToken=null,mode='login',adminIPOk=false,adminKey=null;
let allNews=[],publishNews=[],myLikes=new Set(JSON.parse(localStorage.getItem('myLikes')||'[]'));
let currentPage=1,totalPages=1,tags=[],selectedTag='';

// Dark mode
if(localStorage.getItem('dark')==='1')document.body.classList.add('dark');

// ═══ Main Tabs ═══
mainTabs.forEach(t=>t.addEventListener('click',()=>{
  mainTabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');
  const tab=t.dataset.tab;
  tabPublish.style.display=tab==='publish'?'block':'none';
  tabLibrary.style.display=tab==='library'?'block':'none';
  tabRank.style.display=tab==='rank'?'block':'none';
  if(tab==='library')loadLibrary();
  if(tab==='rank')renderLeaderboardFromData();
}));

// ═══ Auth ═══
function setMode(m){mode=m;loginBtn.textContent=m==='login'?'登录':'注册';switchBtn.textContent=m==='login'?'注册':'返回登录';}
loginBtn.addEventListener('click',()=>{const u=usernameInput.value.trim(),p=passwordInput.value;if(!u){showToast('请输入昵称','error');return;}if(!p||p.length<4){showToast('密码至少4位','error');return;}mode==='login'?doLogin(u,p):doRegister(u,p);});
switchBtn.addEventListener('click',()=>{setMode(mode==='login'?'register':'login');passwordInput.value='';});
passwordInput.addEventListener('keydown',e=>{if(e.key==='Enter')loginBtn.click();});
async function doRegister(u,p){loginBtn.disabled=true;loginBtn.textContent='...';try{const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const d=await r.json();if(!r.ok)throw new Error(d.error);onAuthSuccess(d);showToast('注册成功','success');}catch(e){showToast(e.message,'error');}finally{loginBtn.disabled=false;setMode(mode);}}
async function doLogin(u,p){loginBtn.disabled=true;loginBtn.textContent='...';try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const d=await r.json();if(!r.ok)throw new Error(d.error);onAuthSuccess(d);showToast('欢迎','success');}catch(e){showToast(e.message,'error');}finally{loginBtn.disabled=false;setMode(mode);}}
function onAuthSuccess(data){currentUser=data.username;authToken=data.token;localStorage.setItem('nc_user',data.username);localStorage.setItem('nc_token',data.token);userArea.style.display='none';userInfo.style.display='flex';userBadge.textContent=data.username;uploadCard.style.display='block';usernameInput.value='';passwordInput.value='';checkAdminIP();loadTags();}
logoutBtn.addEventListener('click',()=>{if(authToken)fetch('/api/logout',{method:'POST',headers:{Authorization:authToken}}).catch(()=>{});currentUser=null;authToken=null;adminIPOk=false;adminKey=null;myLikes.clear();localStorage.clear();userArea.style.display='flex';userInfo.style.display='none';uploadCard.style.display='none';adminBtn.style.display='none';adminOverlay.style.display='none';adminKeyOverlay.style.display='none';setMode('login');showToast('已退出','info');});
(async()=>{const t=localStorage.getItem('nc_token');if(!t)return;try{const r=await fetch('/api/me',{headers:{Authorization:t}});if(!r.ok){localStorage.clear();return}const d=await r.json();currentUser=d.username;authToken=t;userArea.style.display='none';userInfo.style.display='flex';userBadge.textContent=d.username;uploadCard.style.display='block';checkAdminIP();loadTags();}catch{}})();
async function checkAdminIP(){try{const r=await fetch('/api/admin/check',{headers:authToken?{Authorization:authToken}:{}});const d=await r.json();adminIPOk=d.allowed;if(adminIPOk)adminBtn.style.display='inline-block';}catch{adminIPOk=false;}}
async function loadTags(){try{const r=await fetch('/api/tags');tags=await r.json();const s=tagFilter;if(s){s.innerHTML='<option value="">全部标签</option>'+tags.map(t=>'<option value="'+t.name+'">'+t.name+'</option>').join('');s.value=selectedTag;s.style.display='inline-block'}}catch{}}

// ═══ Publish ═══
contentInput.addEventListener('input',()=>{charCount.textContent=contentInput.value.length+'/500';});
newsForm.addEventListener('submit',async e=>{e.preventDefault();const c=contentInput.value.trim();if([...c].length<5){showToast('至少5字符','error');return}if(!authToken){showToast('请先登录','error');return}const btn=newsForm.querySelector('button');btn.disabled=true;btn.textContent='...';try{const r=await fetch('/api/news',{method:'POST',headers:{'Content-Type':'application/json',Authorization:authToken},body:JSON.stringify({content:c})});if(!r.ok){const d=await r.json();throw new Error(d.error)}contentInput.value='';charCount.textContent='0/500';showToast('发布成功','success');reloadNews()}catch(e){showToast(e.message,'error')}finally{btn.disabled=false;btn.textContent='发布';}});

async function reloadNews(page=1){currentPage=page;const h=authToken?{Authorization:authToken}:{};const tag=selectedTag?'&tag='+selectedTag:'';const r=await fetch('/api/news?page='+page+'&limit=30'+tag,{headers:h});const d=await r.json();publishNews=d.items||d;totalPages=d.totalPages||1;totalCount.textContent=d.total||publishNews.length;renderNews(publishNews);renderPagination();}
function renderPagination(){let h='';for(let i=1;i<=totalPages;i++)h+='<button class="page-btn'+(i===currentPage?' active':'')+'" onclick="reloadNews('+i+')">'+i+'</button>';pagination.innerHTML=h;}

// ═══ News Library ═══
async function loadLibrary(){try{const r=await fetch('/api/news/all');allNews=await r.json()}catch{allNews=allNews||[]}const q=searchInput.value.trim().toLowerCase();let list=allNews;if(q)list=allNews.filter(n=>n.content.toLowerCase().includes(q));libraryList.innerHTML=list.length?list.map((n,i)=>'<div class="lib-item"><span class="lib-num">'+(i+1)+'.</span><span class="lib-user">'+esc(n.username)+'</span><span class="lib-text">'+esc((n.content||'').slice(0,120))+(n.content&&n.content.length>120?'...':'')+'</span>'+(adminIPOk&&!n.id.startsWith('seed-')?'<button class="lib-del" onclick="delFromLib(\''+n.id+'\')">x</button>':'')+'</div>').join(''):'<div class="empty-state"><p>无结果</p></div>';totalCount.textContent=list.length;}
searchInput.addEventListener('input',loadLibrary);
downloadBtn.addEventListener('click',()=>{const a=document.createElement('a');a.href='/api/news/download';a.download='news-collection.txt';a.click();});

// ═══ Socket ═══
socket.on('init-data',data=>{publishNews=data.news||data.items||[];totalPages=1;renderNews(publishNews);renderLeaderboard(data.leaderboard);fetch('/api/news/count').then(r=>r.json()).then(d=>{totalCount.textContent=d.count;});loadAnnouncements();loadMyLikes();});
socket.on('news-added',async()=>{await reloadNews(currentPage);});
socket.on('news-deleted',async()=>{await reloadNews(currentPage);});
socket.on('leaderboard-updated',lb=>renderLeaderboard(lb));
socket.on('announcement-added',a=>{showAnnounce(a.content,a.created_by,a.created_at);});

// ═══ Announcements ═══
async function loadAnnouncements(){try{const r=await fetch('/api/announcements');const list=await r.json();if(list.length){const a=list[0];showAnnounce(a.content,a.created_by,a.created_at)}}catch{}}
function showAnnounce(c,b,t){announceText.textContent=c;announceTime.textContent=' - '+b+' '+fmt(t);announceBanner.style.display='block';}
async function loadMyLikes(){if(!authToken)return;try{const r=await fetch('/api/news',{headers:{Authorization:authToken}});const d=await r.json();const list=d.items||d;myLikes.clear();list.forEach(n=>{if(n.liked_by_me)myLikes.add(n.id)});localStorage.setItem('myLikes',JSON.stringify([...myLikes]))}catch{}}

// ═══ Render ═══
function renderNews(arr){if(!arr||!arr.length){newsList.innerHTML='<div class="empty-state"><div class="empty-icon">x</div><p>暂无新闻</p></div>';return}newsList.innerHTML=arr.map(n=>newsCardHTML(n)).join('');}
function newsCardHTML(item){const i=(item.username||'?')[0].toUpperCase(),c=getColor(item.username);const isMine=currentUser&&item.username===currentUser;const likes=parseInt(item.likes)||0;const liked=myLikes.has(item.id);const tagStr=item.tags?item.tags.split(',').map(t=>'<span class="tag-badge">'+esc(t)+'</span>').join(''):'';return '<div class="news-card '+(item.pinned?'pinned':'')+'" data-id="'+item.id+'"><div class="news-header"><div class="news-avatar" style="background:'+c+'">'+i+'</div><div class="news-meta"><div class="news-username">'+esc(item.username)+(item.pinned?' <span class="pin-badge">顶</span>':'')+'</div><div class="news-time">'+fmt(item.time||item.created_at)+'</div></div></div><div class="news-content">'+esc(item.content)+'</div>'+tagStr+'<div class="news-actions"><button class="like-btn'+(liked?' liked':'')+'" onclick="event.stopPropagation();toggleLike(\''+item.id+'\',this)">❤ <span>'+likes+'</span></button>'+(isMine?'<button class="self-btn" onclick="event.stopPropagation();editNews(\''+item.id+'\',\''+esc(item.content)+'\')">✏</button><button class="self-del-btn" onclick="event.stopPropagation();delOwnNews(\''+item.id+'\')">撤销</button>':'<button class="rpt-btn" onclick="event.stopPropagation();reportNews(\''+item.id+'\')">🚩</button>')+(adminIPOk&&!item.id.startsWith('seed-')?'<button class="news-del-btn" onclick="event.stopPropagation();delFromLib(\''+item.id+'\')">x</button>':'')+'</div></div>';}
function renderLeaderboard(lb){if(!lb||!lb.length){leaderboardList.innerHTML='<div class="empty-state small"><p>暂无</p></div>';return}leaderboardList.innerHTML=lb.map((u,i)=>{const r=i+1;let tc='',ri=r;if(r===1){tc='top-1';ri='1'}else if(r===2){tc='top-2';ri='2'}else if(r===3){tc='top-3';ri='3'}return '<div class="leaderboard-item '+tc+'"><div class="rank-badge">'+ri+'</div><div class="rank-avatar" style="background:'+(u.avatar||getColor(u.username))+'">'+u.username[0].toUpperCase()+'</div><div class="rank-name">'+esc(u.username)+'</div><div class="rank-count">'+u.count+'</div></div>';}).join('');}
function renderLeaderboardFromData(){const lb=Object.values((allNews||[]).reduce((a,n)=>{if(!n.seed){if(!a[n.username])a[n.username]={username:n.username,count:0,avatar:getColor(n.username)};a[n.username].count++}return a},{})).sort((a,b)=>b.count-a.count).slice(0,20);renderLeaderboard(lb);}

// ═══ Actions ═══
window.delFromLib=async function(id){if(!confirm('确定删除？'))return;if(!adminKey){showToast('请先输入管理密钥','error');return}try{await fetch('/api/admin/news/'+id,{method:'DELETE',headers:adminHeaders()});showToast('已删除','success')}catch(e){showToast(e.message,'error')}};
window.delOwnNews=async function(id){if(!confirm('确定撤销？'))return;try{const r=await fetch('/api/news/'+id,{method:'DELETE',headers:{Authorization:authToken}});if(!r.ok)throw new Error((await r.json()).error);showToast('已撤销','success');reloadNews(currentPage)}catch(e){showToast(e.message,'error')}};
window.toggleLike=async function(id,btn){if(!authToken){showToast('请先登录','error');return}try{const r=await fetch('/api/news/'+id+'/like',{method:'POST',headers:{Authorization:authToken}});const d=await r.json();if(d.liked)myLikes.add(id);else myLikes.delete(id);localStorage.setItem('myLikes',JSON.stringify([...myLikes]));btn.classList.toggle('liked',d.liked);btn.querySelector('span').textContent=d.count}catch(e){showToast(e.message,'error')}};
window.editNews=async function(id,old){const c=prompt('编辑新闻：',old);if(!c||c===old||[...c].length<5)return;try{const r=await fetch('/api/news/'+id,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:authToken},body:JSON.stringify({content:c})});if(!r.ok)throw new Error((await r.json()).error);showToast('已更新','success');reloadNews(currentPage)}catch(e){showToast(e.message,'error')}};
window.reportNews=async function(id){const reason=prompt('举报理由：');if(!reason)return;try{await fetch('/api/news/'+id+'/report',{method:'POST',headers:{'Content-Type':'application/json',Authorization:authToken},body:JSON.stringify({reason})});showToast('已举报','success')}catch(e){showToast(e.message,'error')}};

// ═══ Tag Filter ═══
tagFilter.addEventListener('change',()=>{selectedTag=tagFilter.value;reloadNews(1);});

// ═══ Admin Panel ═══
adminBtn.addEventListener('click',()=>{adminKeyInput.value='';adminKeyOverlay.style.display='flex';adminKeyInput.focus();});
adminKeyCancel.addEventListener('click',()=>{adminKeyOverlay.style.display='none';});
adminKeyConfirm.addEventListener('click',async()=>{const k=adminKeyInput.value.trim();if(!k){showToast('请输入密钥','error');return}adminKeyConfirm.disabled=true;try{const r=await fetch('/api/admin/auth',{method:'POST',headers:{'Content-Type':'application/json',Authorization:authToken||''},body:JSON.stringify({key:k})});if(!r.ok)throw new Error('密钥错误');adminKey=k;adminKeyOverlay.style.display='none';adminKeyInput.value='';openAdminPanel()}catch(e){showToast(e.message,'error')}finally{adminKeyConfirm.disabled=false;}});
adminCloseBtn.addEventListener('click',()=>{adminOverlay.style.display='none';});
function adminHeaders(){return{'x-admin-key':adminKey||'','x-user-token':authToken||''};}
function openAdminPanel(){adminOverlay.style.display='flex';adminDateFilter.value=new Date().toISOString().slice(0,10);switchAdminTab('news');loadAdminNews();}
adminTabs.forEach(t=>t.addEventListener('click',()=>{adminTabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');switchAdminTab(t.dataset.tab);}));
function switchAdminTab(t){tabNews.style.display=t==='news'?'block':'none';tabUsers.style.display=t==='users'?'block':'none';tabAnnounce.style.display=t==='announce'?'block':'none';tabReports.style.display=t==='reports'?'block':'none';if(t==='news')loadAdminNews();if(t==='users')loadAdminUsers();if(t==='announce')loadAdminAnnouncements();if(t==='reports')loadAdminReports();}
adminDateFilter.addEventListener('change',loadAdminNews);
async function loadAdminNews(){const d=adminDateFilter.value||new Date().toISOString().slice(0,10);try{const r=await fetch('/api/admin/news?date='+d,{headers:adminHeaders()});if(!r.ok)throw new Error('err');const list=await r.json();adminNewsList.innerHTML=list.length?list.map(n=>'<div class="admin-news-item"><div class="admin-news-info"><span class="admin-news-user">'+esc(n.username)+'</span><span class="admin-news-title">'+esc((n.content||'').slice(0,50))+'</span><span class="admin-news-time">'+fmt(n.time||n.created_at)+'</span></div><div class="admin-news-actions">'+(!n.seed?'<button class="btn-sm '+(n.pinned?'btn-unpin':'btn-pin')+'" onclick="togglePin(\''+n.id+'\','+!n.pinned+')">'+(n.pinned?'取消置顶':'置顶')+'</button><button class="btn-del" onclick="deleteNews(\''+n.id+'\')">删除</button>':'')+'</div></div>').join(''):'<div class="empty-state small"><p>暂无</p></div>';}catch(e){adminNewsList.innerHTML='<div class="empty-state small"><p>'+esc(e.message)+'</p></div>';}}
window.togglePin=async(id,pin)=>{try{const r=await fetch('/api/admin/pin',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders()},body:JSON.stringify({id,pinned:pin})});if(!r.ok)throw new Error((await r.json()).error);showToast(pin?'已置顶':'已取消','success');loadAdminNews()}catch(e){showToast(e.message,'error')}};
window.deleteNews=async(id)=>{if(!confirm('确定删除？'))return;try{const r=await fetch('/api/admin/news/'+id,{method:'DELETE',headers:adminHeaders()});if(!r.ok)throw new Error((await r.json()).error);showToast('已删除','success');loadAdminNews()}catch(e){showToast(e.message,'error')}};
adminCopyToday.addEventListener('click',async()=>{const d=adminDateFilter.value;try{const url=d?'/api/admin/news?date='+d:'/api/news/all';const r=await fetch(url,{headers:adminHeaders()});const list=await r.json();if(!list.length){showToast('无新闻','info');return}await navigator.clipboard.writeText(list.map(x=>x.content).join(','));showToast('已复制'+list.length+'条','success')}catch(e){showToast('复制失败','error')}});
async function loadAdminUsers(){try{const r=await fetch('/api/admin/users',{headers:adminHeaders()});if(!r.ok)throw new Error('err');const list=await r.json();adminUserList.innerHTML=list.length?list.map(u=>'<div class="admin-user-item '+(u.banned?'banned':'')+'"><div class="admin-user-info"><span class="admin-user-name">'+esc(u.username)+(u.banned?' 封':'')+(u.role==='superadmin'?' 👑':u.role==='admin'?' 🔧':'')+'</span><span class="admin-user-ip">IP:'+esc(u.ip)+'</span><span class="admin-user-count">'+u.count+'条</span><span class="admin-user-role">'+(u.role==='superadmin'?'超级':u.role==='admin'?'管理':'用户')+'</span></div><div class="admin-user-actions">'+(u.role!=='superadmin'?'<button class="btn-sm '+(u.role==='admin'?'btn-demote':'btn-promote')+'" onclick="toggleRole(\''+esc(u.username)+'\',\''+(u.role==='admin'?'user':'admin')+'\')">'+(u.role==='admin'?'撤销':'设为管理')+'</button>':'')+'<button class="btn-sm btn-warn" onclick="warnUser(\''+esc(u.username)+'\')">警告</button><button class="btn-sm '+(u.banned?'btn-unban':'btn-ban')+'" onclick="toggleBan(\''+esc(u.username)+'\','+!u.banned+')">'+(u.banned?'解封':'封禁')+'</button><button class="btn-sm btn-pwd" onclick="openPwd(\''+esc(u.username)+'\')">改密</button></div></div>').join(''):'<div class="empty-state small"><p>暂无</p></div>';}catch(e){adminUserList.innerHTML='<div class="empty-state small"><p>'+esc(e.message)+'</p></div>';}}
window.toggleBan=async(u,ban)=>{const h=ban?prompt('封禁时长（小时，0=永久）：','0'):'0';if(ban&&h===null)return;if(!confirm((ban?'封禁':'解封')+'「'+u+'」？'))return;try{const r=await fetch('/api/admin/ban',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders()},body:JSON.stringify({username:u,banned:ban,duration:parseInt(h)||0})});if(!r.ok)throw new Error((await r.json()).error);showToast('成功','success');loadAdminUsers()}catch(e){showToast(e.message,'error')}};
window.toggleRole=async(u,role)=>{if(!confirm((role==='admin'?'设为管理':'撤销')+'「'+u+'」？'))return;try{const r=await fetch('/api/admin/set-role',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders(),'x-user-token':authToken},body:JSON.stringify({username:u,role})});if(!r.ok)throw new Error((await r.json()).error);showToast('成功','success');loadAdminUsers()}catch(e){showToast(e.message,'error')}};
window.openPwd=function(u){pwdModalUsername=u;pwdModalTarget.textContent=u;pwdModalInput.value='';pwdModalOverlay.style.display='flex';};
pwdModalCancel.addEventListener('click',()=>{pwdModalOverlay.style.display='none';});
pwdModalConfirm.addEventListener('click',async()=>{const p=pwdModalInput.value.trim();if(!p||p.length<4){showToast('密码至少4位','error');return}try{const r=await fetch('/api/admin/reset-password',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders()},body:JSON.stringify({username:pwdModalUsername,newPassword:p})});if(!r.ok)throw new Error((await r.json()).error);showToast('已修改','success');pwdModalOverlay.style.display='none'}catch(e){showToast(e.message,'error')}});
window.postAnnounce=async()=>{const c=announceInput.value.trim();if(!c){showToast('请输入','error');return}try{const r=await fetch('/api/admin/announcement',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders(),'x-user-token':authToken},body:JSON.stringify({content:c})});if(!r.ok)throw new Error((await r.json()).error);announceInput.value='';showToast('已发布','success');loadAdminAnnouncements()}catch(e){showToast(e.message,'error')}};
async function loadAdminAnnouncements(){try{const r=await fetch('/api/announcements');const list=await r.json();announceList.innerHTML=list.length?list.map(a=>'<div style="padding:8px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between"><span>'+esc(a.content)+' <span style="color:#888;font-size:.75rem">- '+a.created_by+' '+fmt(a.created_at)+'</span></span><button class="btn-sm" style="background:#FEE2E2;color:#DC2626" onclick="delAnnounce('+a.id+')">x</button></div>').join(''):'<div class="empty-state small"><p>暂无</p></div>'}catch(e){}
window.delAnnounce=async(id)=>{try{await fetch('/api/admin/announcement/'+id,{method:'DELETE',headers:adminHeaders()});loadAdminAnnouncements()}catch{}};
window.warnUser=async(u)=>{const reason=prompt('警告理由：');if(!reason)return;try{const r=await fetch('/api/admin/warn',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders(),'x-user-token':authToken},body:JSON.stringify({username:u,reason})});const d=await r.json();if(!r.ok)throw new Error(d.error);showToast(d.action+' ('+d.count+'/3)','success');loadAdminUsers()}catch(e){showToast(e.message,'error')}};
async function loadAdminReports(){try{const r=await fetch('/api/admin/reports',{headers:adminHeaders()});const list=await r.json();adminReportList.innerHTML=list.length?list.map(rp=>'<div style="padding:8px;border-bottom:1px solid #ddd"><b>'+esc(rp.reporter)+'</b> 举报 <span style="color:#DC2626">'+esc((rp.news_content||'').slice(0,50))+'</span><br>理由: '+esc(rp.reason)+' <span style="color:#888;font-size:.75rem">'+fmt(rp.created_at)+'</span></div>').join(''):'<div class="empty-state small"><p>暂无举报</p></div>'}catch(e){}

// ═══ Dark Mode ═══
darkToggle.addEventListener('click',()=>{const d=document.body.classList.toggle('dark');localStorage.setItem('dark',d?'1':'0');});

// ═══ Utils ═══
function getColor(n){const c=['#FF6B6B','#FF9F43','#FECA57','#54A0FF','#5F27CD','#01A3A4','#F368E0','#2ED573','#FF6348','#7BED9F','#70A1FF','#5352ED','#FF4757','#1E90FF','#2ED573'];let h=0;for(let i=0;i<n.length;i++)h=n.charCodeAt(i)+((h<<5)-h);return c[Math.abs(h)%c.length];}
function fmt(s){if(!s)return'';const d=new Date(s),n=new Date(),diff=n-d;if(diff<6e4)return'刚刚';if(diff<36e5)return Math.floor(diff/6e4)+'分钟前';if(diff<864e5)return Math.floor(diff/36e5)+'小时前';return(d.getMonth()+1)+'-'+d.getDate();}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function showToast(msg,type){const t=document.createElement('div');t.className='toast '+type;t.textContent=msg;toastContainer.appendChild(t);setTimeout(()=>{t.style.opacity='0';t.style.transition='.3s';setTimeout(()=>t.remove(),300)},3500);}}
}