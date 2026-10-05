@echo off
rem Klik ganda: atur aplikasi PM2 (WhatsOrbit, ngrok, fingerprint) jalan otomatis saat PC menyala tanpa login.
rem Windows akan meminta izin Administrator.
powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0autostart-pm2.ps1\"'"
