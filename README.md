# 📰 新闻收集站

一个实时新闻收集网站，用户可以注册账号、发布新闻链接，查看其他用户分享的新闻和上传数量排行榜。

## ✨ 功能

- 🔐 **注册/登录** — 昵称 + 密码注册，同一 IP 只能注册一次
- 📝 **发布新闻** — 填写标题、链接、摘要即可分享
- 📡 **实时更新** — 基于 WebSocket (Socket.IO)，新发布的新闻实时推送给所有在线用户
- 🏆 **排行榜** — 按用户上传新闻数量排名，前三名金银铜牌标识
- 📱 **响应式** — 手机、平板、桌面均可使用

## 🚀 运行

```bash
# 1. 安装依赖
npm install

# 2. 启动服务器
node server.js
```

然后访问 `http://localhost:3000`。

同一局域网下的设备可通过终端输出的局域网 IP 访问（如 `http://192.168.x.x:3000`）。

## 🛠 技术栈

- **后端**: Node.js + Express + Socket.IO
- **前端**: 原生 HTML/CSS/JS（无框架）
- **存储**: JSON 文件 (`data/` 目录)
- **密码**: PBKDF2 + SHA-512 + 随机盐值

## 📁 项目结构

```
news-collector/
├── server.js           # 后端服务（Express + Socket.IO）
├── package.json
├── .gitignore
├── data/
│   ├── news.json       # 新闻数据
│   ├── users.json      # 用户数据（密码哈希）
│   └── tokens.json     # 登录令牌
└── public/
    ├── index.html      # 前端页面
    ├── css/style.css   # 样式
    └── js/app.js       # 前端逻辑
```

## ⚠️ 注意

- `data/` 目录下的 `users.json` 包含密码哈希，如需公开仓库建议将其加入 `.gitignore`
- 默认端口 3000，可通过环境变量 `PORT` 修改
