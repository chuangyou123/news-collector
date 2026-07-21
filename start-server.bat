@echo off
:: 新闻收集站 — 开机自启脚本
:: 把这个文件放到 shell:startup 文件夹即可

cd /d D:\test\news-collector
start "新闻收集站" /MIN cmd /c "node server.js"
timeout /t 3 >nul
start "Cloudflare Tunnel" /MIN cmd /c "cloudflared tunnel --url http://localhost:3000 --protocol http2 --edge-ip-version 4"
