@echo off
rem Menyalakan WhatsOrbit + ngrok di latar belakang (PM2).
cd /d "%~dp0"
call "%APPDATA%\npm\pm2.cmd" start ecosystem.config.cjs
call "%APPDATA%\npm\pm2.cmd" save
echo.
echo WhatsOrbit menyala. Dashboard: http://localhost:3077
pause
