@echo off
rem Mematikan WhatsOrbit + ngrok. Pesan yang masuk saat mati tidak diterima
rem (Google Form tetap tersimpan, tapi WA tidak terkirim).
call "%APPDATA%\npm\pm2.cmd" stop all
echo.
echo WhatsOrbit dimatikan. Nyalakan lagi dengan start-whatsorbit.cmd
echo (atau otomatis menyala lagi saat login Windows berikutnya).
pause
