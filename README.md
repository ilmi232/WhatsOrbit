# WhatsOrbit

Gateway WhatsApp multi-device yang di-host sendiri (pengganti Starsender) untuk
auto-reply Google Form dan kirim pesan lewat API. Dibangun dengan
[Baileys](https://github.com/WhiskeySockets/Baileys), tanpa browser tersembunyi,
sehingga RAM-nya kecil (± 100–150 MB + 20–60 MB per nomor).

> ⚠️ Baileys bukan API resmi WhatsApp. Risiko banned sama seperti Starsender:
> hindari spam, kirim ke orang yang memang mengisi form, dan biarkan jeda antar pesan.

## Fitur

- Banyak device/nomor, scan QR dari dashboard, sesi tersimpan (tidak perlu scan ulang)
- API `POST /api/send` yang **kompatibel dengan format Starsender**
- Antrean pesan + jeda acak + simulasi "sedang mengetik"; pesan tetap tersimpan
  dan dikirim otomatis saat device tersambung lagi
- Cek nomor terdaftar di WhatsApp sebelum kirim
- Log pesan (terkirim / antrean / gagal) + tombol kirim ulang
- Generator Apps Script untuk Google Form

## Backup

**Pengaturan → Backup.** Berisi database (kontak, tiket, pengaturan, API key AI),
sesi login WhatsApp (tidak perlu scan ulang), dan `.env`.

- Folder tujuan bebas; disarankan OneDrive/Google Drive atau drive lain (bukan C:).
- Otomatis setiap hari pada jam yang diatur, menyimpan N backup terakhir.
  Tombol **Backup sekarang** untuk manual.
- **Pulihkan** dari dashboard (butuh PM2): kondisi sekarang dibackup dulu, server
  restart, data diganti isi backup sebelum database dibuka. Data lama juga
  disimpan di `data/_sebelum-pulih-<waktu>/`.
- Folder backup berisi data sensitif (sesi WA, API key): jangan dibagikan.
- Pindah PC: pasang WhatsOrbit, salin `env.backup` → `.env`, salin isi backup ke
  `data/` (`whatsorbit.db` + folder `sessions`), lalu jalankan.

## Anti-banned (semua fitur)

**Pengaturan → Anti-banned.**

| Jenis pesan | Contoh | Aturan |
|---|---|---|
| Balasan | Autoreply, Chat Bot, AI, CS, Pesan Masuk | Tidak dibatasi, didahulukan di antrean |
| API | Google Form, aplikasi lain | Batas harian opsional (default tanpa batas) |
| Dimulai oleh kita | Blast, Kirim Pesan, Ulang Tahun | Batas harian per device (default 200), jeda 15–45 detik; sisanya dikirim otomatis saat kuota tersedia |
| Internal | Notifikasi ke petugas CS | Tidak dibatasi |

Semua pesan: satu per satu per device, efek "sedang mengetik", nomor dicek
terdaftar di WA. **Mode pemanasan** per device untuk nomor baru: batas
20 → 40 → 80 → 150 → 250 per hari selama 4 minggu.

## Fitur bisa diaktif/nonaktifkan

Menu **Pengaturan** di dashboard. Fitur yang nonaktif tidak tampil di menu,
API-nya menolak request, dan prosesnya berhenti.

- Fitur berupa modul (saat ini **Blast**, `src/modules/`) baru di-import ke
  memori saat aktif. Kalau dimatikan, RAM-nya dilepas setelah **Restart server**
  (tombol di Pengaturan, butuh PM2).
- Fitur baru ditambahkan di `src/features.js` (daftar + `load`) dan
  `public/js/pages/<nama>.js` (halaman, hanya dimuat saat dibuka).
- Pemakai RAM terbesar tetap jumlah device yang online (± 20–60 MB per nomor).

## Data & Group Kontak

Menu **Kontak** (modul `src/modules/contacts.js`, bisa dinonaktifkan).

- Kontak: nama, nomor, dan kolom bebas (Kelas, Wali, Angkatan, …). Nomor unik.
- Grup: satu kontak bisa di beberapa grup. Hapus grup tidak menghapus kontaknya.
- **Import**: copy-paste dari Google Sheets/Excel (baris pertama = judul kolom),
  langsung ke grup lama/baru. Nomor yang sudah ada bisa diperbarui atau dilewati.
- **Export CSV** per grup (bisa dibuka Excel dan diimport ulang).
- Pilih banyak kontak → masukkan ke grup, keluarkan dari grup, atau hapus.
- **Blast → Dari grup kontak**: pilih satu/lebih grup; placeholder `[Nama]`,
  `[Nomor]`, dan semua kolom kontak (mis. `[Kelas]`) terisi otomatis.

## Daily Leads

Menu **Daily Leads** (modul `src/modules/leads.js`, butuh fitur Kontak).

- Di menu **Google Form**, centang *Simpan pengisi sebagai lead*, pilih field
  nama, isi grup tujuan & nama sumber, lalu tempel script baru ke Apps Script.
- Setiap form dikirim: pengisi disimpan/diperbarui di **Kontak** (semua jawaban
  jadi kolom data), dimasukkan ke grup, dan dicatat sebagai lead hari itu.
- Bisa tanpa balasan WA (hapus centang *Kirim balasan WhatsApp juga*); script
  memakai `POST /api/lead`.
- Halaman Daily Leads: angka hari ini/7/30 hari, grafik 30 hari, sumber form,
  filter tanggal/sumber, dan export CSV.

API: `/api/send` menerima objek opsional
`"lead": { "name", "phone", "source", "group", "fields": {...} }`;
`POST /api/lead` dengan body yang sama menyimpan lead tanpa mengirim pesan.

## Ulang Tahun

Menu **Ulang Tahun** (modul `src/modules/birthday.js`, butuh fitur Kontak).

- Tanggal lahir diambil dari kolom data Kontak (mis. **Tanggal Lahir**,
  terdeteksi otomatis). Format: `17/05/2010`, `2010-05-17`, `17 Mei 2010`,
  `17-5-10`, `17/05` (tanpa tahun), angka tanggal Excel.
- Kirim otomatis tiap hari mulai jam yang diatur (default 07.00, **nonaktif
  sampai dinyalakan**). Kalau server sempat mati, tetap dikirim hari itu s/d 21.00.
- Satu kontak hanya diberi ucapan sekali per tahun. 29 Feb → 28 Feb di tahun biasa.
- Bisa dibatasi ke grup, memakai beberapa device bergantian.
- Placeholder: `[Nama]`, `[Nama Depan]`, `[Umur]`, kolom Kontak, `{a|b}`.
- Halaman: hari ini (+ status kirim), 30 hari ke depan, tanggal yang tidak
  terbaca, riwayat, tombol **Kirim sekarang**.

## Chat Widget

Menu **Chat Widget** (modul `src/modules/widget.js`, kode website di
`src/widget-runtime.js`).

- Tombol WhatsApp melayang untuk website: beberapa agen (nama, keterangan,
  nomor, jam & hari online menurut WIB), pesan pembuka (`[Halaman]` = judul
  halaman), sapaan otomatis, label, warna, posisi kiri/kanan.
- Mode **Pilih agen** (daftar) atau **Langsung chat** (acak di antara agen online).
- Kode tempel **berdiri sendiri**: pengaturan tertanam di kode, jadi widget tetap
  jalan walau server WhatsOrbit mati. Tampilan diisolasi (Shadow DOM).
  Setelah mengubah pengaturan, tempel ulang kodenya di website.
- Statistik klik (per hari, per agen, per halaman) dikirim ke
  `POST /api/widget/track` (publik, tanpa API key, dibatasi 60 klik/10 menit per IP).
  Butuh `PUBLIC_URL` di `.env`. Lewat ngrok gratis tetap tercatat (POST tidak
  terkena halaman peringatan ngrok).

## Chat Bot

Menu **Chat Bot** (modul `src/modules/chatbot.js`). Bot menu bernomor, tanpa AI.

- Pohon menu: setiap pilihan punya pesan dan boleh punya sub-pilihan (maks. 9
  per menu). Jenis **Serahkan ke admin**: kirim pesan, lalu bot (dan Autoreply)
  diam untuk chat itu selama N jam supaya admin membalas manual.
- Dimulai oleh kata pemicu (mis. `menu`, `halo`) atau semua chat baru.
- Pengguna membalas angka atau nama pilihan; `0` kembali, `#`/`menu` ke menu
  utama, `selesai` mengakhiri. Sesi berakhir setelah 30 menit tanpa balasan.
- Prioritas pesan masuk: Pesan Masuk mencatat → Chat Bot → Autoreply
  (Autoreply tidak membalas chat yang sedang ditangani bot).
- Simulator di dashboard memakai pengaturan yang belum disimpan.

## AI Chat Bot

Menu **AI Chat Bot** (modul `src/modules/aibot.js`, penyedia di `src/ai-providers.js`).

| Penyedia | Gratis? | API key |
|---|---|---|
| Google Gemini (AI Studio) | ada kuota gratis | https://aistudio.google.com/apikey |
| Groq | ada kuota gratis | https://console.groq.com/keys |
| OpenRouter | model `:free` | https://openrouter.ai/keys |
| OpenAI | berbayar | https://platform.openai.com/api-keys |
| Anthropic Claude | berbayar | https://console.anthropic.com/settings/keys |
| Server lain (kompatibel OpenAI, mis. Ollama) | tergantung | opsional |

- API key disimpan di database lokal; dashboard hanya menampilkan `••••abcd`.
- **Informasi Sekolah** = bahan jawaban; AI diminta tidak mengarang di luar itu.
- Mode: jawab semua pertanyaan lain (setelah Chat Bot & kata kunci Autoreply;
  aturan Autoreply "Semua pesan" dilewati) atau hanya pesan berawalan (mis. `tanya`).
- Ingat beberapa pasang pesan terakhir per chat (24 jam). Kalau pengguna minta
  admin, AI menandai `[ADMIN]` → chat diserahkan, AI diam N jam.
- Batas jawaban per hari & per chat per jam untuk menjaga kuota/biaya.
- Paket gratis Gemini: Google dapat memakai isi percakapan untuk meningkatkan
  layanannya, jadi jangan masukkan data pribadi siswa.

## Web WhatsApp

Menu **Web WhatsApp** (modul `src/modules/webwa.js`, butuh Pesan Masuk).

- Daftar chat (nama dari Kontak, pesan terakhir, belum dibaca, cari, tab Pribadi/Grup)
  dan percakapan seperti WhatsApp Web.
- Satu percakapan menggabungkan: pesan masuk, balasan bot/AI/Autoreply/CS,
  Kirim Pesan, API/Form, Blast, Ulang Tahun, dan **pesan yang dikirim langsung
  dari HP** (dicatat sejak fitur aktif).
- **Ambil alih**: saat admin membalas dari sini, Chat Bot/Autoreply/AI diam untuk
  chat itu selama 60 menit (bisa dilepas/diaktifkan manual).
- Chat yang sedang ditangani Customer Service: balasan lewat tiket (tercatat dan
  diteruskan ke petugas).
- Chat baru ke nomor yang belum pernah chat dihitung sebagai pesan yang kita
  mulai (ikut kuota anti-banned). Saat ini hanya teks; media tampil sebagai label.

## Customer Service

Menu **Customer Service** (modul `src/modules/cs.js`).

- **Petugas**: nama, nomor WA pribadi, jam & hari tugas, device yang ditangani,
  saklar bertugas. Chat dibagi ke petugas yang bertugas dengan chat terbuka
  paling sedikit (bergiliran).
- **Kapan chat masuk ke CS**: saat Chat Bot/AI menyerahkan ke admin, atau
  (opsional) semua chat pribadi yang tidak dijawab otomatis.
- **Petugas membalas dari WhatsApp pribadinya**: notifikasi dikirim dari nomor
  sekolah; petugas **membalas (kutip)** notifikasi → diteruskan ke pelanggan dari
  nomor sekolah (nomor petugas tidak terlihat). Pesan lanjutan pelanggan ikut
  diteruskan. Perintah: `#12 teks`, `#selesai 12`, `#ambil 12`, `#list`, `#off`/`#on`.
  Saat ini hanya teks yang diteruskan.
- Selama chat ditangani CS, Chat Bot/Autoreply/AI diam; setelah ditutup, bot aktif lagi.
- Dashboard: tiket terbuka/menunggu/selesai, riwayat, balas sebagai Admin,
  pindahkan petugas, tutup (dengan/tanpa pesan penutup), tutup otomatis
  setelah N jam tanpa aktivitas, rata-rata waktu respons pertama.

## Pesan Masuk & Autoreply

Dua fitur terpisah (`src/modules/inbox.js`, `src/modules/autoreply.js`).

**Pesan Masuk**: chat pribadi yang diterima device dicatat (grup tidak
ditampilkan), bisa dicari dan dibalas dari dashboard. Disimpan 90 hari.
Pengirim yang nomornya disembunyikan WhatsApp (ID "LID") tetap bisa dibalas.

**Autoreply**: aturan balasan otomatis.

| Jenis | Contoh |
|---|---|
| Mengandung kata | `ppdb`, `pendaftaran` → info PPDB |
| Sama persis | `biaya` |
| Diawali | `#menu` |
| Regex | `^daftar\s+\d{4}$` |
| Semua pesan | sambutan / di luar jam kantor (cadangan) |

- Aturan kata kunci dicek dari atas (bisa diurutkan); "Semua pesan" hanya
  untuk pesan yang tidak cocok kata kunci apa pun.
- Jeda per pengirim (default 60 menit). Kalau kata kunci cocok tapi masih jeda,
  tidak dibalas sama sekali. Ada juga jeda 20 detik per chat (anti saling-balas bot).
- Jam aktif (boleh melewati tengah malam, mis. 15–7), pilih device, opsi grup.
- Placeholder `[Nama]` (nama Kontak, atau nama profil WA), `[Nomor]`, `[Pesan]`,
  kolom Kontak (`[Kelas]`, …), dan variasi `{Halo|Hai}`.
- Pesan yang masuk lebih dari 10 menit lalu (mis. saat server mati) tidak dibalas.
- Balasan lewat antrean kirim biasa (efek mengetik), pesan ditandai dibaca.
- **Simulator** di halaman Autoreply untuk mencoba tanpa mengirim.

## Blast

Menu **Blast** di dashboard untuk kirim pesan ke banyak nomor.

- **Penerima**: copy-paste dari Google Sheets/Excel (baris pertama = judul kolom),
  CSV, atau satu nomor per baris. Nomor dirapikan otomatis, yang ganda dibuang.
- **Pesan**: `[Nama Kolom]` diganti isi kolom; `{Halo|Hai|Selamat siang}` dipilih
  acak per penerima supaya pesan tidak identik. Bisa bersarang: `{ya|{kak|dik}}`.
- **Anti-banned** (bisa diatur per blast):

  | Pengaturan | Default |
  |---|---|
  | Jeda acak antar pesan | 20–60 detik |
  | Istirahat setiap | 15 pesan, selama 5–15 menit |
  | Batas per device per hari | 100 pesan (sisanya lanjut besok) |
  | Jam kirim | 08.00–20.00 (jam PC) |
  | Efek mengetik | 1–9 detik, sebanding panjang pesan |
  | Rotasi device | pilih beberapa device, penerima dibagi otomatis |

- Auto-reply Google Form / API **selalu didahulukan**; blast jalan di sela-selanya.
- Blast bisa dijeda, dilanjutkan, dibatalkan, dan yang gagal bisa diulang.
  Kalau server mati di tengah jalan, blast lanjut otomatis saat menyala lagi.

Tips: untuk nomor baru, mulai dengan batas harian kecil (20–50) dan naikkan
pelan-pelan. Kirim hanya ke orang yang mengenal nomor sekolah.

## Menjalankan

Butuh Node.js 22.13+ (sudah terpasang v24).

```bash
npm install
copy .env.example .env   # lalu isi ADMIN_PASSWORD
npm start
```

Buka http://localhost:3077, masuk dengan `ADMIN_PASSWORD`, tambah device, klik
**Scan QR**, lalu scan dari HP: WhatsApp → Perangkat tertaut → Tautkan perangkat.

Data (database + sesi WA) tersimpan di folder `data/`. **Jangan bagikan folder
ini**, karena siapa pun yang memegangnya bisa memakai nomor WA tersebut.

## API

```
POST /api/send
Authorization: <API key device>
Content-Type: application/json

{ "messageType": "text", "to": "081234567890", "body": "Halo" }
```

- `to` boleh `08…`, `+62…`, `62…`, atau beberapa nomor dipisah koma.
- Respons langsung `200` setelah pesan masuk antrean; status kirim terlihat di Log Pesan.

`GET /api/status` (dengan header yang sama) menampilkan status device.

### Pindah dari Starsender

Di script Apps Script yang sudah ada, cukup ganti dua baris:

```js
var APIKey = "<API key dari dashboard WhatsOrbit>";
var url = "https://<alamat-publik-anda>/api/send";
```

Atau buat script baru dari menu **Google Form Script** di dashboard.

## Supaya bisa dipanggil dari Google

Apps Script berjalan di server Google, jadi butuh alamat publik. Lewat tunnel,
hanya `/api` yang bisa diakses; dashboard tetap hanya dari PC ini
(ubah dengan `PUBLIC_DASHBOARD=true`).

### Opsi A: ngrok (dipakai sekarang)

1. Daftar gratis di https://dashboard.ngrok.com/signup.
2. Install: `winget install --id Ngrok.Ngrok`, lalu `ngrok update`.
3. Salin authtoken dari https://dashboard.ngrok.com/get-started/your-authtoken, lalu:
   `ngrok config add-authtoken <TOKEN>`
4. Ambil domain statis gratis di https://dashboard.ngrok.com/domains
   (contoh `nama-anda.ngrok-free.app`). Alamat ini tetap walau PC restart.
5. Jalankan: `ngrok http --url=nama-anda.ngrok-free.app 3077`
6. Di Apps Script, `url` = `https://nama-anda.ngrok-free.app/api/send` dan tambahkan
   header `"ngrok-skip-browser-warning": "1"` (sudah otomatis di generator dashboard).

Domain ngrok diatur di `ecosystem.config.cjs` (`NGROK_DOMAIN`) dan ikut dijalankan PM2.

### Opsi B: Cloudflare Tunnel (kalau domain sudah di Cloudflare)

Gratis, tanpa batas kuota, dan bisa memakai subdomain sekolah sendiri.

1. Domain sekolah harus memakai DNS Cloudflare (gratis).
2. Install: `winget install --id Cloudflare.cloudflared`
3. ```bash
   cloudflared tunnel login
   cloudflared tunnel create whatsorbit
   cloudflared tunnel route dns whatsorbit wa.domainanda.sch.id
   ```
4. Buat `%USERPROFILE%\.cloudflared\config.yml`. Hanya `/api` yang dibuka ke
   internet, dashboard tetap lokal:
   ```yaml
   tunnel: whatsorbit
   credentials-file: C:\Users\<user>\.cloudflared\<tunnel-id>.json
   ingress:
     - hostname: wa.domainanda.sch.id
       path: ^/api/
       service: http://127.0.0.1:3077
     - service: http_status:404
   ```
5. Pasang sebagai service Windows (otomatis jalan saat PC menyala):
   `cloudflared service install`

Kalau belum punya domain di Cloudflare, alternatifnya **ngrok** dengan static
domain gratis (`ngrok http --url=<nama>.ngrok-free.app 3077`).

## Jalan otomatis saat PC menyala

WhatsOrbit dan ngrok dijalankan oleh PM2 (lihat `ecosystem.config.cjs`) dan
dihidupkan ulang saat login Windows oleh Task Scheduler **"WhatsOrbit (PM2)"**
(`pm2 resurrect`, 30 detik setelah login).

| Mau apa | Klik ganda | Atau perintah |
|---|---|---|
| Nyalakan | `start-whatsorbit.cmd` | `pm2 start ecosystem.config.cjs` |
| Matikan | `stop-whatsorbit.cmd` | `pm2 stop all` |
| Lihat status & log | `status-whatsorbit.cmd` | `pm2 ls` / `pm2 logs` |
| Mulai ulang (setelah ubah kode/.env) | — | `pm2 restart all` |

Matikan auto-start permanen: Task Scheduler → hapus/disable task
"WhatsOrbit (PM2)", atau `Unregister-ScheduledTask -TaskName "WhatsOrbit (PM2)"`.

Pastikan juga Windows tidak masuk Sleep/Hibernate
(Settings → System → Power & sleep → Sleep: **Never**).

## Konfigurasi (.env)

| Variabel | Default | Keterangan |
|---|---|---|
| `ADMIN_PASSWORD` | — | Wajib. Password dashboard |
| `PORT` / `HOST` | `3077` / `127.0.0.1` | Alamat server |
| `SEND_DELAY_MIN_MS` / `SEND_DELAY_MAX_MS` | `4000` / `10000` | Jeda acak antar pesan per device |
| `MAX_ATTEMPTS` | `3` | Percobaan kirim sebelum ditandai gagal |
| `DEFAULT_COUNTRY_CODE` | `62` | Pengganti awalan `0` |
| `LOG_LEVEL` | `info` | Level log |
