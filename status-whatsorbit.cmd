@echo off
rem Melihat status + 30 baris log terakhir.
call "%APPDATA%\npm\pm2.cmd" ls
call "%APPDATA%\npm\pm2.cmd" logs whatsorbit --lines 30 --nostream
pause
