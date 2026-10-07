# WhatsOrbit

Gateway WhatsApp milik sekolah (multi-device, blast, autoreply, chat bot AI, webhook, integrasi Google Sheet/Form,
Lynk.id/Mayar.id, Customer Service, backup). Jalan 24 jam di PC sekolah (Windows) lewat PM2.
Pengguna: staf IT sekolah, bahasa Indonesia, bukan programmer: jelaskan dengan bahasa sederhana.

## Stack & menjalankan
- Node.js (ESM) + Express + Baileys (WhatsApp, tanpa browser) + SQLite bawaan Node (`node:sqlite`, `data/whatsorbit.db`).
- Frontend tanpa build: `public/` (JS biasa, `public/js/ui.js`, halaman di `public/js/pages/`).
- PM2 (`ecosystem.config.cjs`): `whatsorbit` (port 3077) dan `ngrok` (tunnel). Ubah kode → `pm2 restart whatsorbit`
  (koneksi WhatsApp putus beberapa detik lalu tersambung lagi).
- Pengaturan aplikasi di tabel `settings` (`getSetting`/`setSetting` di `src/db.js`, tidak di-cache).
- Auto-start tanpa login Windows: `autostart-pm2.cmd` (task "WhatsOrbit (PM2)" saat PC menyala, mode S4U).
- Backup: `src/backup.js`, harian ke folder lokal + Google Drive lewat rclone (`gdrive:WhatsOrbit-Backup`, satu `.tar.gz`).

## Aturan keras
- **Repo ini PUBLIK.** Sebelum setiap commit/push, periksa diff: jangan pernah ikut `.env`, `data/`, sesi WhatsApp,
  nomor telepon, API key/token, domain ngrok, atau email pengguna.
- Push: `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push`
- Folder `data/` dan isi backup berisi sesi login WhatsApp & API key: sangat sensitif, jangan dibagikan atau diunggah ke mana pun
  selain tujuan backup yang diatur pengguna.
- Jangan kirim pesan WhatsApp atau blast uji ke nomor sungguhan tanpa izin pengguna.
- Jangan masukkan password/token atas nama pengguna; pengguna yang mengisinya.

## Gaya kerja
- UI dan teks dalam bahasa Indonesia; hindari tampilan "AI slop" (ikon bertitik, garis tepi warna-warni, dsb.).
- Cek tampilan di layar sempit (HP).
- Aplikasi lain di PC yang sama: aplikasi fingerprint di `C:\zerone\zerone\fingerprint` (lihat CLAUDE.md di sana).
