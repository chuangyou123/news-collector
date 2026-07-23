// ═══════════════════════════════════════════════
//  新闻收集站 — 三Tab版 v2
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

const adminKeyOverlay=$('#adminKeyOverlay'),adminKeyInput=$('#adminKeyInput');
const adminKeyCancel=$('#adminKeyCancel'),adminKeyConfirm=$('#adminKeyConfirm');
const adminOverlay=$('#adminOverlay'),adminCloseBtn=$('#adminCloseBtn');
const adminDateFilter=$('#adminDateFilter'),adminCopyToday=$('#adminCopyToday');
const adminNewsList=$('#adminNewsList'),adminUserList=$('#adminUserList');
const adminTabs=document.querySelectorAll('.admin-tab'),tabNews=$('#tabNews'),tabUsers=$('#tabUsers'),tabAnnounce=$('#tabAnnounce');
const mainTabs=document.querySelectorAll('.main-tab'),tabPublish=$('#tabPublish'),tabLibrary=$('#tabLibrary'),tabRank=$('#tabRank');
const announceInput=$('#announceInput'),announceList=$('#announceList');

const pwdModalOverlay=$('#pwdModalOverlay'),pwdModalTarget=$('#pwdModalTarget');
const pwdModalInput=$('#pwdModalInput'),pwdModalCancel=$('#pwdModalCancel'),pwdModalConfirm=$('#pwdModalConfirm');
let pwdModalUsername=null;

// State
let currentUser=null,authToken=null,mode='login',adminIPOk=false,adminKey=null;
let allNews=[],publishNews=[],myLikes=new Set(JSON.parse(localStorage.getItem('myLikes')||'[]'));

// ═══ Main Tabs ═══
mainTabs.forEach(t=>t.addEventListener('click',async()=>{
  mainTabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');
  const tab=t.dataset.tab;
  tabPublish.style.display=tab==='publish'?'block':'none';
  tabLibrary.style.display=tab==='library'?'block':'none';
  tabRank.style.display=tab==='rank'?'block':'none';
  const sr=document.querySelector('.sort-row');if(sr)sr.style.display=tab==='publish'?'flex':'none';
  if(tab==='library')loadLibrary();
  if(tab==='rank'){if(!libAll.length)await loadLibrary();renderLeaderboardFromData();}
}));

// ═══ Auth ═══
function setMode(m){mode=m;loginBtn.textContent=m==='login'?'登录':'注册';switchBtn.textContent=m==='login'?'注册':'返回登录';}
loginBtn.addEventListener('click',()=>{const u=usernameInput.value.trim(),p=passwordInput.value;if(!u){showToast('请输入昵称','error');return;}if(!p||p.length<4){showToast('密码至少4位','error');return;}mode==='login'?doLogin(u,p):doRegister(u,p);});
switchBtn.addEventListener('click',()=>{setMode(mode==='login'?'register':'login');passwordInput.value='';});
passwordInput.addEventListener('keydown',e=>{if(e.key==='Enter')loginBtn.click();});

async function doRegister(u,p){loginBtn.disabled=true;loginBtn.textContent='...';try{const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const d=await r.json();if(!r.ok)throw new Error(d.error);onAuthSuccess(d);showToast('注册成功','success');}catch(e){showToast(e.message,'error');}finally{loginBtn.disabled=false;setMode(mode);}}
async function doLogin(u,p){loginBtn.disabled=true;loginBtn.textContent='...';try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const d=await r.json();if(!r.ok)throw new Error(d.error);onAuthSuccess(d);showToast('欢迎','success');}catch(e){showToast(e.message,'error');}finally{loginBtn.disabled=false;setMode(mode);}}
function onAuthSuccess(data){currentUser=data.username;authToken=data.token;localStorage.setItem('nc_user',data.username);localStorage.setItem('nc_token',data.token);socket.emit('login',data.username);userArea.style.display='none';userInfo.style.display='flex';userBadge.textContent=data.username;userBadge.style.cursor='pointer';userBadge.title='点击修改头像颜色';userBadge.onclick=()=>pickColor();uploadCard.style.display='block';usernameInput.value='';passwordInput.value='';checkAdminIP();}
logoutBtn.addEventListener('click',()=>{if(authToken)fetch('/api/logout',{method:'POST',headers:{Authorization:authToken}}).catch(()=>{});currentUser=null;authToken=null;adminIPOk=false;adminKey=null;localStorage.clear();userArea.style.display='flex';userInfo.style.display='none';uploadCard.style.display='none';adminBtn.style.display='none';adminOverlay.style.display='none';adminKeyOverlay.style.display='none';setMode('login');showToast('已退出','info');});
(async()=>{const t=localStorage.getItem('nc_token');if(!t)return;try{const r=await fetch('/api/me',{headers:{Authorization:t}});if(!r.ok){localStorage.clear();return}const d=await r.json();currentUser=d.username;authToken=t;userArea.style.display='none';userInfo.style.display='flex';userBadge.textContent=d.username;uploadCard.style.display='block';checkAdminIP();}catch{}})();
async function checkAdminIP(){try{const r=await fetch('/api/admin/check',{headers:authToken?{Authorization:authToken}:{}});const d=await r.json();adminIPOk=d.allowed;if(adminIPOk)adminBtn.style.display='inline-block';}catch{adminIPOk=false;}}
// 标签
let selectedTag='';
let currentSort='new';
document.querySelectorAll('.sort-btn').forEach(b=>b.addEventListener('click',function(){
  document.querySelectorAll('.sort-btn').forEach(x=>x.classList.remove('active'));
  this.classList.add('active');
  currentSort=this.dataset.sort;
  reloadWithSort();
}));
async function reloadWithSort(){
  const h=authToken?{Authorization:authToken}:{};
  const tag=selectedTag?'&tag='+selectedTag:'';
  const r=await fetch('/api/news?limit=30&sort='+currentSort+tag,{headers:h});
  const d=await r.json();renderNews(d.items||d);
}
async function loadTags(){try{const r=await fetch('/api/tags');const tags=await r.json();const s=$('#tagFilter');const ts=$('#tagSelect');const opts='<option value=\"\">全部标签</option>'+tags.map(t=>'<option value=\"'+t.name+'\">'+t.name+'</option>').join('');if(s){s.innerHTML=opts;s.style.display='inline-block';s.addEventListener('change',async()=>{selectedTag=s.value;await reloadWithSort()})}if(ts){ts.innerHTML='<option value=\"\">选择标签（可选）</option>'+tags.map(t=>'<option value=\"'+t.name+'\">'+t.name+'</option>').join('')}}catch{}}
async function filterByTag(){selectedTag=$('#tagFilter').value;await reloadWithSort()}
setTimeout(loadTags,800);

// 通知
const notifBtn=$('#notifBtn'),notifBadge=$('#notifBadge');
let unreadNotifs=0;
async function loadNotifs(){if(!authToken)return;try{const r=await fetch('/api/notifications',{headers:{Authorization:authToken}});const list=await r.json();unreadNotifs=list.filter(n=>!n.seen).length;notifBadge.textContent=unreadNotifs;notifBadge.style.display=unreadNotifs>0?'block':'none';notifBtn.style.display='inline-block';notifBtn.onclick=()=>{let h='<h3>通知</h3>';list.forEach(n=>{h+='<div style=\"padding:6px;border-bottom:1px solid #ddd\">'+esc(n.content)+' <span style=\"color:#888;font-size:.7rem\">'+fmt(n.created_at)+'</span></div>'});const d=document.createElement('div');d.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);z-index:400;display:flex;align-items:center;justify-content:center';d.onclick=function(e){if(e.target===d)d.remove()};d.innerHTML='<div style=\"background:#fff;border-radius:12px;padding:20px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto\">'+h+'</div>';document.body.appendChild(d);fetch('/api/notifications/read',{method:'POST',headers:{Authorization:authToken}});unreadNotifs=0;notifBadge.style.display='none'}}catch(e){}}
setInterval(loadNotifs,30000);
setTimeout(loadNotifs,1000);

// 评论
window.showComments=async function(id){
  const card=document.querySelector('[data-id=\"'+id+'\"]');
  let sec=card.querySelector('.cmt-section');
  if(sec){sec.remove();return}
  const r=await fetch('/api/news/'+id+'/comments');
  const list=await r.json();
  sec=document.createElement('div');
  sec.className='cmt-section';
  let h=list.map(c=>'<div class=\"cmt-item\"><b>'+esc(c.username)+'</b> '+esc(c.content)+' <span class=\"cmt-time\">'+fmt(c.created_at)+'</span></div>').join('');
  if(authToken)h+='<div class="cmt-input-row"><input id="cmtInput'+id+'" placeholder="写评论..."><button class="cmt-send-btn" onclick="postComment(\''+id+'\')">发送</button></div>';
  sec.innerHTML=h;
  card.appendChild(sec);
};
window.postComment=async function(id){
  const c=document.getElementById('cmtInput'+id);
  if(!c||!c.value.trim())return;
  await fetch('/api/news/'+id+'/comments',{method:'POST',headers:{'Content-Type':'application/json',Authorization:authToken},body:JSON.stringify({content:c.value.trim()})});
  document.querySelector('[data-id=\"'+id+'\"] .cmt-section')?.remove();
  window.showComments(id);
}

// ═══ Publish ═══
contentInput.addEventListener('input',()=>{charCount.textContent=contentInput.value.length+'/500';});
newsForm.addEventListener('submit',async e=>{e.preventDefault();const c=contentInput.value.trim();if([...c].length<5){showToast('至少5字符','error');return}if(!authToken){showToast('请先登录','error');return}const btn=newsForm.querySelector('button');btn.disabled=true;btn.textContent='...';try{const tag=$('#tagSelect').value;const r=await fetch('/api/news',{method:'POST',headers:{'Content-Type':'application/json',Authorization:authToken},body:JSON.stringify({content:c,tag})});if(!r.ok){const d=await r.json();throw new Error(d.error)}contentInput.value='';charCount.textContent='0/500';showToast('发布成功','success')}catch(e){showToast(e.message,'error')}finally{btn.disabled=false;btn.textContent='发布';}});

// ═══ News Library ═══
let libPage=0,libAll=[];
async function loadLibrary(){try{const r=await fetch('/api/news/all');libAll=await r.json()}catch{libAll=libAll||[]}libPage=0;renderLibrary()}
function renderLibrary(){const q=searchInput.value.trim().toLowerCase();let list=libAll;if(q)list=libAll.filter(n=>n.content.toLowerCase().includes(q));const perPage=30;const totalPages=Math.ceil(list.length/perPage);const page=Math.min(libPage+1,totalPages);const start=(page-1)*perPage;const chunk=list.slice(start,start+perPage);libraryList.innerHTML=chunk.length?chunk.map((n,i)=>'<div class="lib-item"><span class="lib-num">'+(start+i+1)+'.</span><span class="lib-user">'+esc(n.username)+'</span><span class="lib-text">'+esc((n.content||'').slice(0,120))+(n.content&&n.content.length>120?'...':'')+'</span>'+(adminIPOk&&!n.id.startsWith('seed-')?'<button class="lib-del" onclick="delFromLib(\''+n.id+'\')">x</button>':'')+'</div>').join(''):'<div class="empty-state"><p>empty</p></div>';let pager='';for(let i=1;i<=totalPages;i++)pager+='<button class="page-btn'+(i===page?' active':'')+'" onclick="libPage='+(i-1)+';renderLibrary()">'+i+'</button>';libraryList.innerHTML+='<div class="pagination">'+pager+'</div>';totalCount.textContent=libAll.length;}
searchInput.addEventListener('input',()=>{libPage=0;renderLibrary()});
downloadBtn.addEventListener('click',()=>{const a=document.createElement('a');a.href='/api/news/download';a.download='news-collection.txt';a.click();});

// ═══ Dark Mode ═══
const darkToggle=$('#darkToggle');
if(localStorage.getItem('dark')==='1')document.body.classList.add('dark');
if(darkToggle)darkToggle.addEventListener('click',()=>{const d=document.body.classList.toggle('dark');localStorage.setItem('dark',d?'1':'0');});

// 自定义颜色
window.pickColor=function(){const c=prompt('输入颜色 (如 #FF6B6B 或 red)：','#4F46E5');if(c)fetch('/api/user/color',{method:'POST',headers:{'Content-Type':'application/json',Authorization:authToken},body:JSON.stringify({color:c})}).then(()=>location.reload())};

// ═══ Socket ═══
socket.on('init-data',data=>{publishNews=data.news;renderNews(data.news);renderLeaderboard(data.leaderboard);fetch('/api/news/count').then(r=>r.json()).then(d=>{totalCount.textContent=d.count;});loadAnnouncements();loadMyLikes();});
socket.on('news-added',item=>{publishNews.unshift(item);prependNews(item);fetch('/api/news/count').then(r=>r.json()).then(d=>totalCount.textContent=d.count);});
socket.on('news-deleted',data=>{publishNews=publishNews.filter(n=>n.id!==data.id);const c=document.querySelector('[data-id="'+data.id+'"]');if(c){c.style.opacity='0';c.style.transition='.3s';setTimeout(()=>c.remove(),300)}fetch('/api/news/count').then(r=>r.json()).then(d=>totalCount.textContent=d.count);});
socket.on('leaderboard-updated',lb=>renderLeaderboard(lb));
socket.on('announcement-added',a=>{showAnnounce(a.content,a.created_by,a.created_at);});

// ═══ Announcements ═══
async function loadAnnouncements(){try{const r=await fetch('/api/announcements');const list=await r.json();if(list.length){const a=list[0];showAnnounce(a.content,a.created_by,a.created_at)}}catch{}}
function showAnnounce(content,by,time){announceText.textContent=content;announceTime.textContent=' - '+by+' '+fmt(time);announceBanner.style.display='block';}

// 同步服务器点赞状态
async function loadMyLikes(){if(!authToken)return;try{const r=await fetch('/api/news',{headers:{Authorization:authToken}});const d=await r.json();const list=d.items||d;myLikes.clear();if(Array.isArray(list))list.forEach(n=>{if(n.liked_by_me)myLikes.add(n.id)});localStorage.setItem('myLikes',JSON.stringify([...myLikes]))}catch{}}

// ═══ Render ═══
function renderNews(arr){if(!arr||!arr.length){newsList.innerHTML='<div class="empty-state"><div class="empty-icon">x</div><p>no news</p></div>';return}newsList.innerHTML=arr.map(n=>newsCardHTML(n)).join('');}
function prependNews(item){const e=newsList.querySelector('.empty-state');if(e)e.remove();const d=document.createElement('div');d.innerHTML=newsCardHTML(item);newsList.insertBefore(d.firstElementChild,newsList.firstChild);}
function newsCardHTML(item){const i=(item.username||'?')[0].toUpperCase(),c=getColor(item.username);const isMine=currentUser&&item.username===currentUser;const likes=parseInt(item.likes)||0;const liked=myLikes.has(item.id);const tags=item.tags?item.tags.split(','):[];const canDel=adminIPOk&&!item.id.startsWith('seed-');return '<div class="news-card '+(item.pinned?'pinned':'')+'" data-id="'+item.id+'">'+(tags.length?'<span class="tag-badge-top" style="'+(canDel?'right:36px':'right:8px')+'">'+esc(tags[0])+'</span>':'')+'<div class="news-header"><div class="news-avatar" style="background:'+c+'">'+i+'</div><div class="news-meta"><div class="news-username">'+esc(item.username)+' '+(item.pinned?'<span class="pin-badge">置顶</span>':'')+'</div><div class="news-time">'+fmt(item.time||item.created_at)+'</div></div></div><div class="news-content">'+esc(item.content)+'</div><div class="news-actions"><button class="like-btn'+(liked?' liked':'')+'" onclick="event.stopPropagation();toggleLike(\''+item.id+'\',this)">❤ <span>'+likes+'</span></button><button class="self-btn" onclick="event.stopPropagation();showComments(\''+item.id+'\')">💬</button>'+(isMine?'<button class="self-btn" onclick="event.stopPropagation();editNews(\''+item.id+'\',\''+esc(item.content)+'\')">✏️</button><button class="self-del-btn" onclick="event.stopPropagation();delOwnNews(\''+item.id+'\')">撤销</button>':(authToken?'<button class="rpt-btn" onclick="event.stopPropagation();reportNews(\''+item.id+'\')">🚩</button>':''))+(canDel?'<button class="news-del-btn" onclick="event.stopPropagation();delFromLib(\''+item.id+'\')">x</button>':'')+'</div></div>';}
function renderLeaderboard(lb){if(!lb||!lb.length){leaderboardList.innerHTML='<div class="empty-state small"><p>no</p></div>';return}leaderboardList.innerHTML=lb.map((u,i)=>{const r=i+1;let tc='',ri=r;if(r===1){tc='top-1';ri='1'}else if(r===2){tc='top-2';ri='2'}else if(r===3){tc='top-3';ri='3'}return '<div class="leaderboard-item '+tc+'"><div class="rank-badge">'+ri+'</div><div class="rank-avatar" style="background:'+(u.avatar||getColor(u.username))+'">'+u.username[0].toUpperCase()+'</div><div class="rank-name">'+esc(u.username)+'</div><div class="rank-count">'+u.count+'</div></div>';}).join('');}
function renderLeaderboardFromData(){if(!libAll.length)return;const lb=Object.values(libAll.reduce((a,n)=>{if(!n.seed){if(!a[n.username])a[n.username]={username:n.username,count:0,avatar:getColor(n.username)};a[n.username].count++}return a},{})).sort((a,b)=>b.count-a.count).slice(0,20);renderLeaderboard(lb);}

// ═══ Direct Delete ═══
window.delFromLib=async function(id){if(!confirm('确定删除？'))return;if(!adminKey){showToast('请先输入管理密钥','error');return}try{const r=await fetch('/api/admin/news/'+id,{method:'DELETE',headers:adminHeaders()});if(!r.ok){const d=await r.json();throw new Error(d.error)}showToast('已删除','success')}catch(e){showToast(e.message,'error')}};

// 用户撤销自己的新闻
window.delOwnNews=async function(id){if(!confirm('确定撤销这条新闻？'))return;try{const r=await fetch('/api/news/'+id,{method:'DELETE',headers:{Authorization:authToken}});if(!r.ok)throw new Error((await r.json()).error);showToast('已撤销','success')}catch(e){showToast(e.message,'error')}};

window.editNews=async function(id,old){const c=prompt('编辑：',old);if(!c||c===old||[...c].length<5)return;try{const r=await fetch('/api/news/'+id,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:authToken},body:JSON.stringify({content:c})});if(!r.ok)throw new Error((await r.json()).error);showToast('已更新','success');location.reload()}catch(e){showToast(e.message,'error')}};
window.reportNews=async function(id){const reason=prompt('举报理由：');if(!reason)return;try{await fetch('/api/news/'+id+'/report',{method:'POST',headers:{'Content-Type':'application/json',Authorization:authToken},body:JSON.stringify({reason})});showToast('已举报','success')}catch(e){showToast(e.message,'error')}};

// 点赞
window.toggleLike=async function(id,btn){if(!authToken){showToast('请先登录','error');return}const wasLiked=myLikes.has(id);try{const r=await fetch('/api/news/'+id+'/like',{method:'POST',headers:{Authorization:authToken}});const d=await r.json();if(d.liked)myLikes.add(id);else myLikes.delete(id);localStorage.setItem('myLikes',JSON.stringify([...myLikes]));btn.classList.toggle('liked',d.liked);btn.querySelector('span').textContent=d.count;}catch(e){showToast(e.message,'error')}};

// ═══ Admin Panel ═══
adminBtn.addEventListener('click',()=>{adminKeyInput.value='';adminKeyOverlay.style.display='flex';adminKeyInput.focus();});
adminKeyCancel.addEventListener('click',()=>{adminKeyOverlay.style.display='none';});
adminKeyConfirm.addEventListener('click',async()=>{const k=adminKeyInput.value.trim();if(!k){showToast('请输入密钥','error');return}adminKeyConfirm.disabled=true;try{const r=await fetch('/api/admin/auth',{method:'POST',headers:{'Content-Type':'application/json',Authorization:authToken||''},body:JSON.stringify({key:k})});if(!r.ok)throw new Error('密钥错误');adminKey=k;adminKeyOverlay.style.display='none';adminKeyInput.value='';openAdminPanel()}catch(e){showToast(e.message,'error')}finally{adminKeyConfirm.disabled=false;}});
adminCloseBtn.addEventListener('click',()=>{adminOverlay.style.display='none';});
function adminHeaders(){return{'x-admin-key':adminKey||'','x-user-token':authToken||''};}
function openAdminPanel(){adminOverlay.style.display='flex';adminDateFilter.value=new Date().toISOString().slice(0,10);setupStatsTab();switchAdminTab('news');loadAdminNews();}
function setupStatsTab(){if($('#tabStats'))return;const div=document.createElement('div');div.id='tabStats';div.className='admin-tab-content';div.style.display='none';document.querySelector('.admin-panel').appendChild(div);const btn=document.createElement('button');btn.className='admin-tab';btn.dataset.tab='stats';btn.textContent='📊 统计';btn.addEventListener('click',()=>{document.querySelectorAll('.admin-tab').forEach(x=>x.classList.remove('active'));btn.classList.add('active');switchAdminTab('stats')});document.querySelector('.admin-tabs').appendChild(btn);}
adminTabs.forEach(t=>t.addEventListener('click',()=>{adminTabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');switchAdminTab(t.dataset.tab);}));
function switchAdminTab(t){tabNews.style.display=t==='news'?'block':'none';tabUsers.style.display=t==='users'?'block':'none';tabAnnounce.style.display=t==='announce'?'block':'none';tabReports.style.display=t==='reports'?'block':'none';if($('#tabStats'))$('#tabStats').style.display=t==='stats'?'block':'none';if(t==='news')loadAdminNews();if(t==='users')loadAdminUsers();if(t==='announce')loadAdminAnnouncements();if(t==='reports')loadAdminReports();if(t==='stats')loadAdminStats();}
adminDateFilter.addEventListener('change',loadAdminNews);

async function loadAdminNews(){const d=adminDateFilter.value||new Date().toISOString().slice(0,10);try{const r=await fetch('/api/admin/news?date='+d,{headers:adminHeaders()});if(!r.ok)throw new Error('err');const list=await r.json();adminNewsList.innerHTML=list.length?list.map(n=>'<div class="admin-news-item"><div class="admin-news-info"><span class="admin-news-user">'+esc(n.username)+'</span><span class="admin-news-title">'+esc((n.content||'').slice(0,50))+'</span><span class="admin-news-time">'+fmt(n.time||n.created_at)+'</span></div><div class="admin-news-actions">'+(!n.seed?'<button class="btn-sm '+(n.pinned?'btn-unpin':'btn-pin')+'" onclick="togglePin(\''+n.id+'\','+!n.pinned+')">'+(n.pinned?'取消置顶':'置顶')+'</button><button class="btn-del" onclick="deleteNews(\''+n.id+'\')">删除</button>':'')+'</div></div>').join(''):'<div class="empty-state small"><p>暂无</p></div>';}catch(e){adminNewsList.innerHTML='<div class="empty-state small"><p>'+esc(e.message)+'</p></div>';}}

window.togglePin=async(id,pin)=>{try{const r=await fetch('/api/admin/pin',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders()},body:JSON.stringify({id,pinned:pin})});if(!r.ok)throw new Error((await r.json()).error);showToast(pin?'已置顶':'已取消','success');loadAdminNews()}catch(e){showToast(e.message,'error')}};
window.deleteNews=async(id)=>{if(!confirm('确定删除？'))return;try{const r=await fetch('/api/admin/news/'+id,{method:'DELETE',headers:adminHeaders()});if(!r.ok)throw new Error((await r.json()).error);showToast('已删除','success');loadAdminNews()}catch(e){showToast(e.message,'error')}};

adminCopyToday.addEventListener('click',async()=>{const d=adminDateFilter.value;try{const url=d?'/api/admin/news?date='+d:'/api/news/all';const r=await fetch(url,{headers:adminHeaders()});const list=await r.json();if(!list.length){showToast('无新闻','info');return}await navigator.clipboard.writeText(list.map(x=>x.content).join(','));showToast('已复制'+list.length+'条','success')}catch(e){showToast('复制失败','error')}});

async function loadAdminReports(){try{const r=await fetch('/api/admin/reports',{headers:adminHeaders()});const list=await r.json();adminReportList.innerHTML=list.length?list.map(rp=>'<div style=\"padding:8px;border-bottom:1px solid #ddd\"><b>'+esc(rp.reporter)+'</b> 举报 <span style=\"color:#DC2626\">'+esc((rp.news_content||'').slice(0,50))+'</span><br>理由: '+esc(rp.reason)+' <span style=\"color:#888;font-size:.75rem\">'+fmt(rp.created_at)+'</span></div>').join(''):'<div class=\"empty-state small\"><p>暂无举报</p></div>'}catch(e){adminReportList.innerHTML='<div class=\"empty-state small\"><p>加载失败</p></div>'}}

async function loadAdminStats(){try{const r=await fetch('/api/admin/stats',{headers:adminHeaders()});const d=await r.json();const s=$('#tabStats');if(!s)return;s.innerHTML='<div style="padding:16px"><h3>📊 站点统计</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px"><div style="background:#EEF2FF;padding:16px;border-radius:8px;text-align:center"><div style="font-size:2rem;font-weight:700;color:#4F46E5">'+d.users+'</div><div>注册用户</div></div><div style="background:#FEF3C7;padding:16px;border-radius:8px;text-align:center"><div style="font-size:2rem;font-weight:700;color:#D97706">'+d.news+'</div><div>总新闻</div></div><div style="background:#D1FAE5;padding:16px;border-radius:8px;text-align:center"><div style="font-size:2rem;font-weight:700;color:#059669">'+d.today+'</div><div>今日新闻</div></div><div style="background:#FCE7F3;padding:16px;border-radius:8px;text-align:center"><div style="font-size:2rem;font-weight:700;color:#DB2777">'+d.likes+'</div><div>总点赞</div></div></div>';if(d.daily&&d.daily.length){const m=Math.max(...d.daily.map(x=>parseInt(x.count)),1);s.innerHTML+='<div style="margin-top:16px"><h4>📈 7日趋势</h4><div style="display:flex;align-items:flex-end;gap:8px;height:100px">'+d.daily.map(day=>'<div style="flex:1;text-align:center"><div style="font-size:.7rem;color:#666">'+day.count+'</div><div style="background:linear-gradient(#4F46E5,#818CF8);height:'+Math.max(Math.round(parseInt(day.count)/m*80),4)+'px;border-radius:4px 4px 0 0;max-width:60px;margin:0 auto"></div><div style="font-size:.55rem;color:#888;margin-top:4px">'+(day.date||'').slice(5,10)+'</div></div>').join('')+'</div></div>'}s.innerHTML+='</div>'}catch(e){}}

async function loadAdminUsers(){try{const r=await fetch('/api/admin/users',{headers:adminHeaders()});if(!r.ok)throw new Error('err');const list=await r.json();adminUserList.innerHTML=list.length?list.map(u=>'<div class="admin-user-item '+(u.banned?'banned':'')+'"><div class="admin-user-info"><span class="admin-user-name">'+esc(u.username)+(u.online?' <span style=\"color:#10B981;font-size:0.7rem\">●在线</span>':(u.last_seen?' <span style=\"color:#888;font-size:0.65rem\">'+fmt(u.last_seen)+'</span>':''))+(u.banned?' 已封':'')+(u.role==='superadmin'?' 👑超管':u.role==='admin'?' 🔧管理':'')+'</span><span class="admin-user-ip">IP:'+esc(u.ip)+'</span><span class="admin-user-count">'+u.count+'条</span><span class="admin-user-role">'+(u.role==='superadmin'?'超级管理员':u.role==='admin'?'管理员':'用户')+'</span></div><div class="admin-user-actions">'+(u.role!=='superadmin'?'<button class="btn-sm '+(u.role==='admin'?'btn-demote':'btn-promote')+'" onclick="toggleRole(\''+esc(u.username)+'\',\''+(u.role==='admin'?'user':'admin')+'\')">'+(u.role==='admin'?'撤销管理':'设为管理')+'</button>':'')+'<button class="btn-sm btn-warn" onclick="warnUser(\''+esc(u.username)+'\')">⚠警告</button><button class="btn-sm '+(u.banned?'btn-unban':'btn-ban')+'" onclick="toggleBan(\''+esc(u.username)+'\','+!u.banned+')">'+(u.banned?'解封':'封禁')+'</button><button class="btn-sm btn-pwd" onclick="openPwd(\''+esc(u.username)+'\')">改密</button></div></div>').join(''):'<div class="empty-state small"><p>暂无</p></div>';}catch(e){adminUserList.innerHTML='<div class="empty-state small"><p>'+esc(e.message)+'</p></div>';}}

window.toggleBan=async(u,ban)=>{const h=ban?prompt('封禁时长（小时，0=永久）：','0'):'0';if(ban&&h===null)return;if(!confirm((ban?'封禁':'解封')+'「'+u+'」？'+(ban&&parseInt(h)>0?' '+h+'小时':'')))return;try{const r=await fetch('/api/admin/ban',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders()},body:JSON.stringify({username:u,banned:ban,duration:parseInt(h)||0})});if(!r.ok)throw new Error((await r.json()).error);showToast('成功','success');loadAdminUsers()}catch(e){showToast(e.message,'error')}};
window.toggleRole=async(u,role)=>{if(!confirm((role==='admin'?'设为管理':'撤销管理')+'「'+u+'」？'))return;try{const r=await fetch('/api/admin/set-role',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders(),'x-user-token':authToken},body:JSON.stringify({username:u,role})});if(!r.ok)throw new Error((await r.json()).error);showToast('成功','success');loadAdminUsers()}catch(e){showToast(e.message,'error')}};
window.openPwd=function(u){pwdModalUsername=u;pwdModalTarget.textContent=u;pwdModalInput.value='';pwdModalOverlay.style.display='flex';};
pwdModalCancel.addEventListener('click',()=>{pwdModalOverlay.style.display='none';});
pwdModalConfirm.addEventListener('click',async()=>{const p=pwdModalInput.value.trim();if(!p||p.length<4){showToast('密码至少4位','error');return}try{const r=await fetch('/api/admin/reset-password',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders()},body:JSON.stringify({username:pwdModalUsername,newPassword:p})});if(!r.ok)throw new Error((await r.json()).error);showToast('密码已修改','success');pwdModalOverlay.style.display='none'}catch(e){showToast(e.message,'error')}});

// ═══ Announce & Warn ═══
window.postAnnounce=async()=>{const c=announceInput.value.trim();if(!c){showToast('请输入内容','error');return}try{const r=await fetch('/api/admin/announcement',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders(),'x-user-token':authToken},body:JSON.stringify({content:c})});if(!r.ok)throw new Error((await r.json()).error);announceInput.value='';showToast('公告已发布','success');loadAdminAnnouncements()}catch(e){showToast(e.message,'error')}};
async function loadAdminAnnouncements(){try{const r=await fetch('/api/announcements');const list=await r.json();announceList.innerHTML=list.length?list.map(a=>'<div style="padding:8px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between"><span>'+esc(a.content)+' <span style="color:#888;font-size:.75rem">- '+a.created_by+' '+fmt(a.created_at)+'</span></span><button class="btn-sm" style="background:#FEE2E2;color:#DC2626" onclick="delAnnounce('+a.id+')">x</button></div>').join(''):'<div class="empty-state small"><p>no announcements</p></div>'}catch(e){}}
window.delAnnounce=async(id)=>{try{await fetch('/api/admin/announcement/'+id,{method:'DELETE',headers:adminHeaders()});loadAdminAnnouncements()}catch{}};
window.warnUser=async(u)=>{const reason=prompt('警告理由：');if(!reason)return;try{const r=await fetch('/api/admin/warn',{method:'POST',headers:{'Content-Type':'application/json',...adminHeaders(),'x-user-token':authToken},body:JSON.stringify({username:u,reason})});const d=await r.json();if(!r.ok)throw new Error(d.error);showToast('⚠ '+d.action+' ('+d.count+'/3次)','success');loadAdminUsers()}catch(e){showToast(e.message,'error')}};

// ═══ Utils ═══
function getColor(n){const c=['#FF6B6B','#FF9F43','#FECA57','#54A0FF','#5F27CD','#01A3A4','#F368E0','#2ED573','#FF6348','#7BED9F','#70A1FF','#5352ED','#FF4757','#1E90FF','#2ED573'];let h=0;for(let i=0;i<n.length;i++)h=n.charCodeAt(i)+((h<<5)-h);return c[Math.abs(h)%c.length];}
function fmt(s){if(!s)return'';const d=new Date(s),n=new Date(),diff=n-d;if(diff<6e4)return'now';if(diff<36e5)return Math.floor(diff/6e4)+'min';if(diff<864e5)return Math.floor(diff/36e5)+'h';return(d.getMonth()+1)+'-'+d.getDate();}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function showToast(msg,type){const t=document.createElement('div');t.className='toast '+type;t.textContent=msg;toastContainer.appendChild(t);setTimeout(()=>{t.style.opacity='0';t.style.transition='.3s';setTimeout(()=>t.remove(),300)},3500);}
