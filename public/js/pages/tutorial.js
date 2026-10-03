// Tutorial & dokumentasi pemakaian WhatsOrbit (untuk admin sekolah, bukan developer).
import { $, esc, icon } from '../ui.js';

const steps = (...xs) => `<ol class="tut-steps">${xs.map((x) => `<li>${x}</li>`).join('')}</ol>`;
const tips = (...xs) => `<ul class="tut-list">${xs.map((x) => `<li>${x}</li>`).join('')}</ul>`;
const note = (x, kind = 'info') => `<div class="tut-note ${kind}">${x}</div>`;
const h = (x) => `<h4>${x}</h4>`;

/** Artikel: id, grup, judul, fitur (kunci Pengaturan), menu tujuan, isi. */
const ARTICLES = [
  // ---- Mulai ----------------------------------------------------------------------------------
  {
    id: 'mulai', group: 'Mulai', icon: 'orbit', title: 'Mulai cepat', menu: 'devices',
    summary: 'Langkah pertama: sambungkan nomor WhatsApp sekolah.',
    body: `
      <p>WhatsOrbit adalah pengganti Starsender yang berjalan di PC sekolah sendiri. Semua pesan dikirim dari nomor WhatsApp yang Anda sambungkan.</p>
      ${steps(
        'Buka menu <b>Device</b> → <b>Tambah device</b>, beri nama (mis. "Humas").',
        'Klik <b>Scan QR</b>. Di HP: WhatsApp → <b>Perangkat tertaut</b> → <b>Tautkan perangkat</b> → arahkan kamera ke QR.',
        'Tunggu status menjadi <b>Terkoneksi</b>. Sesi tersimpan, tidak perlu scan ulang walau PC restart.',
        'Coba kirim pesan dari menu <b>Kirim Pesan</b> ke nomor Anda sendiri.',
        'Buka <b>Pengaturan</b> dan matikan fitur yang tidak dipakai supaya menu lebih ringkas dan hemat RAM.',
      )}
      ${note('HP yang dipakai untuk scan tidak harus menyala terus, tetapi <b>jangan logout</b> perangkat tertaut "WhatsOrbit" dari HP. Buka WhatsApp di HP minimal sekali dalam 14 hari supaya tautan tidak kedaluwarsa.')}`,
  },
  {
    id: 'server', group: 'Mulai', icon: 'power', title: 'Server, PC & akses dari luar', menu: 'settings',
    summary: 'WhatsOrbit harus menyala supaya pesan terkirim.',
    body: `
      <p>WhatsOrbit berjalan di PC ini dan otomatis menyala saat PC dinyalakan (PM2 + Task Scheduler). Selama PC mati atau tidak ada internet, pesan masuk antrean dan dikirim begitu server hidup lagi.</p>
      ${h('Alamat publik (ngrok)')}
      <p>Google Form, Spreadsheet, Chat Widget, Lynk.id/Mayar.id, dan aplikasi lain memanggil WhatsOrbit lewat alamat publik (ngrok) yang tercantum di <b>Pengaturan</b>. Dari luar, hanya alamat <code>/api/...</code> yang bisa diakses; dashboard tetap hanya bisa dibuka dari PC ini.</p>
      ${h('Menyalakan / mematikan')}
      ${tips(
        'Restart dari dashboard: <b>Pengaturan</b> → tombol <b>Restart server</b>.',
        'Lewat terminal PC: <code>pm2 restart whatsorbit</code>, <code>pm2 stop whatsorbit</code>, <code>pm2 start whatsorbit</code>.',
        'Lihat log: <code>pm2 logs whatsorbit</code>.',
      )}
      ${note('Jangan biarkan PC sleep/hibernate. Atur Power Options → "Never" untuk sleep.', 'warn')}`,
  },
  {
    id: 'antiban', group: 'Mulai', icon: 'check', title: 'Anti-banned: supaya nomor aman', menu: 'settings',
    summary: 'Batas harian, jeda acak, pemanasan nomor baru.',
    body: `
      <p>WhatsApp memblokir nomor yang terlihat seperti robot spam. WhatsOrbit melindungi nomor sekolah secara otomatis:</p>
      ${tips(
        '<b>Efek mengetik & jeda acak</b> sebelum setiap pesan.',
        '<b>Balasan didahulukan</b> (orang yang chat lebih dulu) dan tidak dibatasi kuota.',
        '<b>Batas harian</b> untuk pesan yang kita mulai (Kirim Pesan, Ulang Tahun, Blast). Kalau habis, pesan ditahan sampai besok, tidak hilang.',
        '<b>Mode pemanasan</b> untuk nomor baru (Pengaturan → Anti-banned): kuota naik bertahap 20 → 40 → 80 → 150 → 250 per hari selama 4 minggu.',
      )}
      ${h('Kebiasaan yang aman')}
      ${tips(
        'Kirim hanya ke orang yang mengenal sekolah (wali murid, pendaftar). Hindari nomor beli/acak.',
        'Pakai variasi pesan <code>{Halo|Hai|Selamat pagi}</code> dan sebut nama <code>[Nama]</code> supaya tiap pesan berbeda.',
        'Minta penerima menyimpan nomor sekolah dan membalas pesan.',
        'Nomor baru: tunggu beberapa hari dan aktifkan pemanasan sebelum Blast.',
      )}
      Atur angkanya di <b>Pengaturan → Anti-banned</b>.`,
  },
  {
    id: 'template', group: 'Mulai', icon: 'edit', title: 'Menulis pesan: variasi & data', menu: 'send',
    summary: 'Spintax {a|b}, placeholder [Kolom], format WhatsApp.',
    body: `
      ${h('Variasi acak')}
      <p><code>{Halo|Hai|Assalamualaikum} [Nama]</code> → tiap penerima mendapat salah satu sapaan secara acak. Bisa bersarang: <code>{Terima kasih|Makasih {banyak|ya}}</code>.</p>
      ${h('Placeholder')}
      <p><code>[Nama]</code>, <code>[Nomor]</code>, dan kolom apa pun dari data (mis. <code>[Kelas]</code>, <code>[Nama Siswa]</code>) diganti isi datanya. Huruf besar/kecil tidak berpengaruh. Placeholder yang berbeda per fitur tertulis di bawah kotak pesan masing-masing.</p>
      ${h('Format WhatsApp')}
      ${tips('<code>*tebal*</code>, <code>_miring_</code>, <code>~coret~</code>, <code>\`\`\`monospace\`\`\`</code>', 'Enter = baris baru. Emoji boleh langsung ditempel.')}
      ${h('Format nomor')}
      <p>Semua bentuk dikenali: <code>0812-3456-7890</code>, <code>+62 812 3456 7890</code>, <code>6281234567890</code>, <code>812...</code>. Saat menempel dari Excel/Spreadsheet, nomor otomatis dipisah per baris.</p>`,
  },

  // ---- Data -----------------------------------------------------------------------------------
  {
    id: 'kontak', group: 'Data', icon: 'users', title: 'Kontak & Grup Kontak', feature: 'contacts', menu: 'contacts',
    summary: 'Simpan data wali murid/siswa untuk Blast & Ulang Tahun.',
    body: `
      ${steps(
        'Siapkan data di Google Sheets / Excel. Baris pertama = judul kolom, mis. <i>Nama, No HP, Kelas, Tanggal Lahir</i>.',
        'Menu <b>Kontak</b> → <b>Import</b> → blok semua sel (termasuk judul) → copy → paste ke kotak import.',
        'Pilih kolom mana yang berisi nama & nomor, pilih/buat grup (mis. "Wali Kelas 7A"), lalu Import.',
        'Kolom lain (Kelas, Tanggal Lahir, dll.) ikut tersimpan dan bisa dipanggil sebagai <code>[Kelas]</code> di pesan.',
      )}
      ${tips('Nomor yang sama tidak dobel; datanya diperbarui.', 'Satu kontak boleh masuk beberapa grup.', 'Export ke CSV kapan saja dari tombol Export.')}`,
  },
  {
    id: 'leads', group: 'Data', icon: 'userplus', title: 'Daily Leads', feature: 'leads', menu: 'leads',
    summary: 'Rekap harian pengisi Google Form (mis. calon pendaftar).',
    body: `
      <p>Pengisi Google Form otomatis tersimpan sebagai kontak + grup dan direkap per hari.</p>
      ${steps(
        'Buka menu <b>Google Form</b>, centang <b>Simpan pengisi sebagai lead</b>.',
        'Isi field nama, grup kontak, dan nama sumber (mis. "PPDB 2027").',
        'Salin script dan pasang di Google Form (lihat tutorial Google Form).',
        'Pantau grafik dan daftar lead di menu <b>Daily Leads</b>; export ke CSV untuk tim marketing.',
      )}`,
  },

  // ---- Outgoing -------------------------------------------------------------------------------
  {
    id: 'kirim', group: 'Outgoing', icon: 'send', title: 'Kirim Pesan', menu: 'send',
    summary: 'Kirim pesan manual ke satu atau banyak nomor.',
    body: `
      ${steps(
        'Pilih device pengirim.',
        'Isi nomor tujuan. Bisa tempel banyak nomor dari Excel/Spreadsheet sekaligus (maks. 500).',
        'Tulis pesan, klik Kirim. Pesan masuk antrean dan dikirim satu per satu dengan jeda.',
      )}
      ${note('Pesan ke banyak orang lebih baik lewat <b>Blast</b> (ada jeda, istirahat, jam kirim, dan laporan).')}`,
  },
  {
    id: 'log', group: 'Outgoing', icon: 'history', title: 'Log Pesan', feature: 'messageLog', menu: 'messages',
    summary: 'Cek pesan terkirim, antre, atau gagal.',
    body: `
      ${tips(
        '<b>Antrean</b>: menunggu giliran / device offline / kuota harian habis.',
        '<b>Terkirim</b>: sudah sampai server WhatsApp.',
        '<b>Gagal</b>: mis. nomor tidak terdaftar di WhatsApp. Klik <b>Kirim ulang</b> setelah diperbaiki.',
      )}
      Jumlah pesan gagal hari ini juga tampil di Dashboard.`,
  },
  {
    id: 'blast', group: 'Outgoing', icon: 'blast', title: 'Blast (kirim massal)', feature: 'blast', menu: 'blast',
    summary: 'Pengumuman ke banyak wali murid dengan anti-banned.',
    body: `
      ${steps(
        'Menu <b>Blast</b> → isi nama blast.',
        'Pilih penerima: grup Kontak, atau tempel daftar nomor.',
        'Tulis pesan dengan variasi <code>{...|...}</code> dan <code>[Nama]</code>.',
        'Atur jeda antar pesan, istirahat tiap sekian pesan, batas per device per hari, dan jam kirim (mis. 07–20).',
        'Mulai. Blast bisa dijeda, dilanjutkan, atau dibatalkan; progres dan nomor gagal terlihat di daftar.',
      )}
      ${tips(
        'Kalau ada beberapa device, Blast bergiliran memakai device yang tersambung.',
        'Di luar jam kirim atau saat kuota habis, blast menunggu otomatis lalu lanjut.',
        'Rekomendasi aman: jeda 20–60 detik, istirahat 5–10 menit setiap 20–30 pesan.',
      )}`,
  },

  // ---- Incoming -------------------------------------------------------------------------------
  {
    id: 'webwa', group: 'Incoming', icon: 'chats', title: 'Web WhatsApp', feature: 'webwa', menu: 'webwa',
    summary: 'Baca & balas chat dari dashboard.',
    body: `
      ${tips(
        'Tampilan mirip WhatsApp Web: daftar chat di kiri, percakapan di kanan.',
        'Saat admin membalas dari dashboard (atau dari HP), bot otomatis diam di chat itu untuk sementara, jadi tidak bertabrakan.',
        'Chat grup juga tampil, dikelompokkan per grup.',
        'Hanya pesan teks yang dikirim; gambar/dokumen yang masuk tampil sebagai label (mis. 📷 Foto).',
      )}`,
  },
  {
    id: 'inbox', group: 'Incoming', icon: 'inbox', title: 'Pesan Masuk', feature: 'inbox', menu: 'inbox',
    summary: 'Arsip semua pesan yang diterima (90 hari).',
    body: `<p>Semua pesan pribadi yang diterima device tercatat di sini, lengkap dengan siapa yang menanganinya (Chat Bot, AI, Autoreply, CS). Klik <b>Balas</b> untuk menjawab langsung. Data lebih dari 90 hari dihapus otomatis.</p>`,
  },
  {
    id: 'cs', group: 'Incoming', icon: 'headset', title: 'Customer Service', feature: 'cs', menu: 'cs',
    summary: 'Bagi chat ke petugas; petugas membalas dari WA pribadi.',
    body: `
      ${steps(
        'Menu <b>Customer Service</b> → tambah petugas (nama + nomor WA pribadi) dan jam tugasnya.',
        'Chat pelanggan yang meminta admin (dari Chat Bot / AI, atau sesuai pengaturan) menjadi <b>tiket</b> dan dibagi bergiliran ke petugas yang bertugas.',
        'Petugas menerima notifikasi di WA pribadinya, lalu <b>membalas (kutip) notifikasi itu</b>. Balasan diteruskan ke pelanggan dari nomor sekolah.',
      )}
      ${h('Perintah petugas (dikirim ke nomor sekolah)')}
      ${tips('<code>#12 teks</code>: balas chat #12', '<code>#selesai 12</code>: tutup chat #12', '<code>#ambil 12</code>: ambil chat yang belum ada petugasnya', '<code>#list</code>: chat terbuka', '<code>#off</code> / <code>#on</code>: berhenti / mulai bertugas')}
      ${note('Nomor pribadi petugas tidak pernah terlihat oleh pelanggan.')}`,
  },

  // ---- Otomasi --------------------------------------------------------------------------------
  {
    id: 'chatbot', group: 'Otomasi', icon: 'bot', title: 'Chat Bot (menu bernomor)', feature: 'chatbot', menu: 'chatbot',
    summary: 'Menu 1. Info PPDB, 2. Jadwal, dst.',
    body: `
      ${steps(
        'Pilih device, aktifkan bot, tulis sambutan.',
        'Tambah menu dan submenu. Setiap menu berisi jawaban, atau pilihan <b>serahkan ke admin</b>.',
        'Uji di <b>Simulator</b> sebelum diaktifkan.',
      )}
      ${tips(
        'Pengguna membalas angka/nama pilihan; <code>0</code> kembali, <code>#</code> menu utama, <code>selesai</code> mengakhiri.',
        'Atur kata pemicu (mis. "menu") atau balas semua chat pertama.',
        'Chat yang menunggu admin terlihat di kartu "Menunggu Admin"; bot diam di chat itu.',
      )}`,
  },
  {
    id: 'aibot', group: 'Otomasi', icon: 'sparkles', title: 'AI Chat Bot', feature: 'aibot', menu: 'aibot',
    summary: 'Jawab pertanyaan bebas memakai AI (Gemini gratis).',
    body: `
      ${h('Ambil API key gratis (Google AI Studio)')}
      ${steps(
        'Buka <b>aistudio.google.com</b> dan login dengan akun Google sekolah.',
        'Klik <b>Get API key</b> → <b>Create API key</b> → salin.',
        'Di menu <b>AI Chat Bot</b>, pilih penyedia <b>Google Gemini</b>, tempel API key, klik muat model, pilih model Flash terbaru.',
      )}
      ${h('Isi pengetahuan')}
      <p>Tulis <b>Informasi Sekolah</b> selengkap mungkin: alamat, jam layanan, biaya, jadwal PPDB, kontak. AI diminta hanya menjawab dari informasi ini. Uji di Simulator lalu aktifkan.</p>
      ${tips(
        'Urutan penjawab: Chat Bot → Autoreply → AI. AI hanya menjawab chat pribadi.',
        'Kalau penanya minta bicara dengan admin, AI menyerahkan chat (ke CS kalau aktif) dan diam sementara.',
        'Penyedia lain: Groq, OpenRouter, OpenAI, Claude, atau server sendiri.',
        '<b>Beberapa API key</b>: tambahkan lebih dari satu (mis. dari akun Google berbeda, atau Groq sebagai cadangan). Atur urutannya di kartu <b>Urutan API key</b>. Kalau key teratas habis kuota, AI otomatis memakai key berikutnya dan key itu diistirahatkan sampai kuotanya pulih.',
      )}
      ${note('Kuota gratis terbatas per menit/hari. Di paket gratis Gemini, Google dapat memakai isi percakapan, jadi <b>jangan</b> masukkan data pribadi siswa.', 'warn')}`,
  },
  {
    id: 'autoreply', group: 'Otomasi', icon: 'reply', title: 'Autoreply', feature: 'autoreply', menu: 'autoreply',
    summary: 'Balas otomatis berdasarkan kata kunci / di luar jam kantor.',
    body: `
      ${tips(
        '<b>Mengandung kata</b>: pesan mengandung salah satu kata kunci (mis. ppdb, daftar).',
        '<b>Sama persis</b>, <b>Diawali</b> (cocok untuk perintah seperti <code>#info</code>), atau <b>Regex</b> (lanjutan).',
        '<b>Semua pesan</b>: sambutan atau balasan di luar jam kantor (mis. jam 15 s/d 7).',
        '<b>Jeda per pengirim</b>: orang yang sama tidak dibalas aturan yang sama lagi selama jeda (default 60 menit).',
        'Aturan bisa khusus device tertentu dan jam tertentu.',
      )}`,
  },
  {
    id: 'form', group: 'Otomasi', icon: 'form', title: 'Google Form → WhatsApp', feature: 'formScript', menu: 'form',
    summary: 'Pengisi form langsung menerima WhatsApp.',
    body: `
      ${steps(
        'Menu <b>Google Form</b>: pilih device, isi judul pertanyaan (sama persis dengan di form), pilih field nomor WA, tulis pesan dengan <code>[Judul Field]</code>.',
        'Klik <b>Copy</b> untuk menyalin script.',
        'Buka Google Form (mode edit) → titik tiga <b>⋮</b> → <b>Apps Script</b> → hapus isi lama → tempel → Simpan.',
        'Di toolbar, pilih fungsi <b>pasangPemicu</b> → <b>Jalankan</b> → izinkan akses (Advanced → Go to … → Allow). Cukup sekali.',
        'Isi form untuk mencoba; pesan muncul di <b>Log Pesan</b>.',
      )}
      ${note('Kalau pemicu dibuat manual lewat menu Pemicu (ikon jam), pilih fungsi <b>onFormSubmitWA</b> dan jenis peristiwa <b>Saat formulir dikirim</b>, bukan pasangPemicu.')}`,
  },
  {
    id: 'sheets', group: 'Otomasi', icon: 'sheet', title: 'Google Spreadsheet → WhatsApp', feature: 'sheets', menu: 'sheets',
    summary: 'Kirim WA dari baris baru di spreadsheet.',
    body: `
      ${steps(
        'Menu <b>Google Spreadsheet</b>: tempel baris judul spreadsheet supaya kolomnya terbaca.',
        'Pilih kolom nomor, tulis pesan dengan <code>[Nama Kolom]</code>, atur kondisi (opsional) dan kolom <b>Status WA</b>.',
        'Salin script → di spreadsheet: <b>Ekstensi → Apps Script</b> → tempel → Simpan → jalankan fungsi pemasang sesuai petunjuk di halaman.',
      )}
      ${tips('Baris yang sudah terkirim ditandai di kolom Status WA, jadi tidak dobel.', 'Kirim ulang satu baris: kosongkan sel Status WA-nya.')}`,
  },
  {
    id: 'greeter', group: 'Otomasi', icon: 'users', title: 'Group Greeter', feature: 'greeter', menu: 'greeter',
    summary: 'Sapa anggota baru grup WhatsApp dengan @mention.',
    body: `
      ${steps(
        'Pilih device; daftar grup tempat nomor sekolah menjadi anggota akan muncul.',
        'Klik grup → tulis sambutan dengan <code>[Nama]</code> (jadi @mention), <code>[Grup]</code>, <code>[Jumlah]</code>.',
        'Opsional: pesan pamit saat keluar, dan pesan pribadi ke anggota baru.',
      )}
      ${note('Kalau grup hanya mengizinkan admin mengirim pesan, jadikan nomor sekolah <b>admin grup</b>.', 'warn')}`,
  },
  {
    id: 'birthday', group: 'Otomasi', icon: 'cake', title: 'Ulang Tahun', feature: 'birthday', menu: 'birthday',
    summary: 'Ucapan otomatis tiap pagi dari data Kontak.',
    body: `
      ${steps(
        'Pastikan kontak punya kolom tanggal lahir (mis. "Tanggal Lahir": 17/08/2012 atau 2012-08-17).',
        'Menu <b>Ulang Tahun</b>: pilih kolom tanggal, jam kirim, device, dan tulis ucapan (<code>[Nama]</code>, <code>[Umur]</code>, dll.).',
        'Cek daftar "Hari ini" dan "30 hari ke depan" untuk memastikan tanggal terbaca.',
      )}
      Ucapan dikirim sekali per orang per tahun dan ikut kuota anti-banned.`,
  },

  // ---- Integrasi ------------------------------------------------------------------------------
  {
    id: 'widget', group: 'Integrasi', icon: 'widget', title: 'Chat Widget website', feature: 'widget', menu: 'widget',
    summary: 'Tombol WhatsApp melayang di website sekolah.',
    body: `
      ${steps(
        'Atur tampilan (warna, posisi, sapaan) dan agen (nomor tujuan, jam online).',
        'Coba di Pratinjau.',
        'Salin <b>Kode Pasang</b> dan tempel sebelum <code>&lt;/body&gt;</code> di website (WordPress: plugin "Insert Headers and Footers").',
      )}
      Klik pengunjung tercatat di Statistik Klik.`,
  },
  {
    id: 'payments', group: 'Integrasi', icon: 'link', title: 'Lynk.id / Mayar.id', feature: 'payments', menu: 'payments',
    summary: 'WhatsApp otomatis setelah pembeli membayar.',
    body: `
      ${steps(
        'Menu <b>Lynk.id / Mayar.id</b> → pilih tab penyedia → salin <b>URL Webhook</b>.',
        'Di dashboard Lynk.id / Mayar.id: <b>Integrasi → Webhook</b> → tempel URL → simpan (Mayar: klik Test URL).',
        'Lynk.id: salin <b>Merchant Key</b> yang muncul ke kolom Merchant Key di WhatsOrbit.',
        'Atur pesan ke pembeli, pesan per produk, notifikasi admin → Simpan → coba dengan <b>Simulasi</b>.',
      )}
      ${note('URL webhook bersifat rahasia. Kalau bocor, klik <b>Buat URL baru</b> lalu perbarui di dashboard penyedia.')}`,
  },
  {
    id: 'webhook', group: 'Integrasi', icon: 'webhook', title: 'Webhook', feature: 'webhook', menu: 'webhook',
    summary: 'Teruskan pesan masuk & peristiwa ke aplikasi lain.',
    body: `
      ${steps(
        'Menu <b>Webhook</b> → <b>Tambah webhook</b> → isi URL aplikasi penerima (SIAKAD, n8n, Apps Script, dll.).',
        'Pilih peristiwa: pesan masuk, status kirim, status device, anggota grup, lead, tiket CS, pembayaran.',
        'Klik <b>Tes kirim</b>, lalu cek <b>Log Pengiriman</b>.',
      )}
      Detail format data, tanda tangan, dan contoh kode untuk developer ada di halaman Webhook.`,
  },
  {
    id: 'api', group: 'Integrasi', icon: 'code', title: 'API (pindah dari Starsender)', feature: 'api', menu: 'api',
    summary: 'Kirim pesan dari aplikasi lain dengan API key device.',
    body: `
      <p>API WhatsOrbit kompatibel dengan format Starsender: <code>POST /api/send</code> dengan header <code>Authorization: API key device</code> dan body <code>{"messageType":"text","to":"0812...","body":"Halo"}</code>.</p>
      ${steps(
        'Ambil API key di menu <b>Device</b>.',
        'Di script/aplikasi lama, ganti alamat <code>https://api.starsender.online</code> dengan alamat publik WhatsOrbit dan API key-nya.',
        'Contoh lengkap ada di menu <b>Dokumentasi API</b>.',
      )}
      ${note('API key = kunci kirim pesan atas nama sekolah. Jangan ditaruh di website publik atau dibagikan.', 'warn')}`,
  },

  // ---- Pengaturan -----------------------------------------------------------------------------
  {
    id: 'fitur', group: 'Pengaturan', icon: 'settings', title: 'Mengaktifkan & mematikan fitur', menu: 'settings',
    summary: 'Pakai seperlunya supaya ringan.',
    body: `<p>Di <b>Pengaturan</b>, setiap fitur bisa dinyalakan/dimatikan. Fitur yang mati hilang dari menu, API-nya berhenti, dan prosesnya tidak berjalan. Memori (RAM) baru benar-benar dilepas setelah <b>Restart server</b>. Beberapa fitur bergantung pada fitur lain (mis. Daily Leads butuh Kontak, Web WhatsApp butuh Pesan Masuk).</p>`,
  },
  {
    id: 'backup', group: 'Pengaturan', icon: 'down', title: 'Backup & pulihkan', menu: 'settings',
    summary: 'Cadangan otomatis tiap hari.',
    body: `
      ${tips(
        'Backup otomatis setiap hari (default jam 02:00) ke folder yang diatur di <b>Pengaturan → Backup</b>, disimpan beberapa hari terakhir.',
        'Isinya: database (kontak, pengaturan, riwayat), sesi WhatsApp (tidak perlu scan ulang), dan file .env.',
        'Klik <b>Backup sekarang</b> sebelum perubahan besar.',
        '<b>Pulihkan</b>: pilih backup → server restart otomatis. Data saat itu disimpan dulu di <code>data/_sebelum-pulih-…</code> untuk berjaga-jaga.',
      )}
      ${note('Folder backup berisi sesi WhatsApp dan password. Simpan di drive yang aman, jangan dibagikan.', 'warn')}`,
  },

  // ---- Bantuan --------------------------------------------------------------------------------
  {
    id: 'masalah', group: 'Bantuan', icon: 'bell', title: 'Pemecahan masalah',
    summary: 'Pesan tidak terkirim, device terputus, dll.',
    body: `
      ${h('Pesan tertahan di Antrean')}
      ${tips('Cek status device di <b>Device</b>; harus <b>Terkoneksi</b>.', 'Kuota harian anti-banned mungkin habis; pesan dikirim besok. Cek di <b>Pengaturan → Anti-banned</b>.', 'Blast di luar jam kirim akan menunggu.')}
      ${h('Status "Gagal: nomor tidak terdaftar"')}
      <p>Nomor tersebut tidak memakai WhatsApp atau salah ketik. Perbaiki lalu kirim ulang.</p>
      ${h('Device terus "Menghubungkan" atau "Logout"')}
      ${tips('Cek internet PC.', 'Kalau statusnya Logout, perangkat tertaut sudah dihapus dari HP: klik <b>Scan QR</b> di menu Device dan tautkan ulang.', 'Coba Restart server dari Pengaturan.')}
      ${h('Google Form / Spreadsheet tidak mengirim')}
      ${tips('Pastikan pemicu terpasang (Apps Script → ikon jam / Pemicu).', 'Lihat Apps Script → <b>Eksekusi</b> untuk pesan error.', 'Pastikan alamat ngrok di script sama dengan yang di Pengaturan dan server menyala.', 'Judul pertanyaan di script harus sama persis dengan di form.')}
      ${h('Bot membalas dobel')}
      <p>Biasanya dua penjawab aktif untuk hal yang sama (mis. Autoreply "Semua pesan" + AI, atau Webhook yang membalas lewat respons). Matikan salah satunya, atau batasi per device.</p>
      ${h('Dashboard terasa lama / tampilan aneh setelah update')}
      <p>Tekan <b>Ctrl+F5</b> untuk memuat ulang halaman.</p>`,
  },
  {
    id: 'faq', group: 'Bantuan', icon: 'search', title: 'Tanya jawab (FAQ)',
    summary: 'Pertanyaan yang sering muncul.',
    body: `
      ${h('Apakah nomor bisa diblokir WhatsApp?')}
      <p>Risiko selalu ada untuk aplikasi tidak resmi, tetapi anti-banned WhatsOrbit membuatnya jauh lebih kecil. Ikuti panduan <a href="#/tutorial/antiban">Anti-banned</a>.</p>
      ${h('Bisa memakai beberapa nomor?')}
      <p>Bisa. Tambahkan device sebanyak yang diperlukan; tiap device punya API key dan kuota sendiri.</p>
      ${h('Apakah WhatsApp di HP masih bisa dipakai?')}
      <p>Bisa, seperti WhatsApp Web. Balasan dari HP juga terlihat di Web WhatsApp dan membuat bot diam sementara di chat itu.</p>
      ${h('Bisa kirim gambar/dokumen?')}
      <p>Saat ini WhatsOrbit mengirim pesan teks. Untuk file, kirim link (Google Drive, dll.).</p>
      ${h('Berapa RAM yang dipakai?')}
      <p>Sekitar 100 MB. Angkanya tampil di pojok kanan atas dashboard.</p>
      ${h('Data disimpan di mana?')}
      <p>Semuanya di PC ini (folder <code>data</code>), bukan di server pihak lain. Kecuali AI Chat Bot: pertanyaan dikirim ke penyedia AI yang dipilih.</p>`,
  },
];

const GROUPS = [...new Set(ARTICLES.map((a) => a.group))];
const st = { q: '', current: 'mulai' };
let menuLabel = {};

const visible = (ctx) => ARTICLES.filter((a) => {
  if (!st.q) return true;
  const q = st.q.toLowerCase();
  return (a.title + ' ' + a.summary + ' ' + a.body.replace(/<[^>]+>/g, ' ')).toLowerCase().includes(q);
});

function tocHtml(ctx) {
  const list = visible(ctx);
  if (!list.length) return '<div class="muted" style="padding:8px 4px">Tidak ditemukan.</div>';
  return GROUPS.map((g) => {
    const items = list.filter((a) => a.group === g);
    if (!items.length) return '';
    return `<div class="nav-group" style="padding:12px 4px 6px">${g}</div>${items.map((a) => `
      <a class="tut-toc ${a.id === st.current ? 'on' : ''} ${a.feature && !ctx.isOn(a.feature) ? 'off' : ''}" href="#/tutorial/${a.id}">
        <span class="ico">${icon(a.icon)}</span><span>${esc(a.title)}</span></a>`).join('')}`;
  }).join('');
}

function articleHtml(a, ctx) {
  const off = a.feature && !ctx.isOn(a.feature);
  const idx = ARTICLES.indexOf(a);
  const prev = ARTICLES[idx - 1];
  const next = ARTICLES[idx + 1];
  return `
    <div class="card tut-article">
      <div class="row between" style="flex-wrap:nowrap;align-items:flex-start;gap:12px">
        <div style="min-width:0"><div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.06em">${esc(a.group)}</div>
          <h2 style="margin:4px 0 4px">${esc(a.title)}</h2><p class="muted" style="margin:0">${esc(a.summary)}</p></div>
        ${a.menu && !off ? `<a class="btn grad sm" href="#/${a.menu}" style="white-space:nowrap">Buka ${esc(menuLabel[a.menu] ?? 'menu')} →</a>` : ''}
      </div>
      ${off ? note(`Fitur ini sedang <b>nonaktif</b>. Aktifkan di <a href="#/settings">Pengaturan</a> untuk memakainya.`, 'warn') : ''}
      <div class="tut-body">${a.body}</div>
      <div class="row between tut-nav">
        ${prev ? `<a href="#/tutorial/${prev.id}" class="btn ghost sm">← ${esc(prev.title)}</a>` : '<span></span>'}
        ${next ? `<a href="#/tutorial/${next.id}" class="btn ghost sm">${esc(next.title)} →</a>` : '<span></span>'}
      </div>
    </div>`;
}

function show(el, ctx) {
  const a = ARTICLES.find((x) => x.id === st.current) ?? ARTICLES[0];
  st.current = a.id;
  $('#tutToc', el).innerHTML = tocHtml(ctx);
  $('#tutPick', el).value = a.id;
  $('#tutMain', el).innerHTML = articleHtml(a, ctx);
}

const fromHash = () => location.hash.match(/^#\/tutorial\/([\w-]+)/)?.[1];

export default {
  async mount(el, ctx) {
    menuLabel = { devices: 'Device', settings: 'Pengaturan', send: 'Kirim Pesan', contacts: 'Kontak', leads: 'Daily Leads', messages: 'Log Pesan', blast: 'Blast', webwa: 'Web WhatsApp', inbox: 'Pesan Masuk', cs: 'Customer Service', chatbot: 'Chat Bot', aibot: 'AI Chat Bot', autoreply: 'Autoreply', form: 'Google Form', sheets: 'Spreadsheet', greeter: 'Group Greeter', birthday: 'Ulang Tahun', widget: 'Chat Widget', payments: 'Lynk.id / Mayar.id', webhook: 'Webhook', api: 'Dokumentasi API' };
    st.current = fromHash() ?? st.current;
    el.innerHTML = `
      <div class="tut-grid">
        <aside class="card tut-side">
          <div class="search" style="margin-bottom:4px">${icon('search')}<input id="tutQ" placeholder="Cari tutorial…" aria-label="Cari tutorial" value="${esc(st.q)}"></div>
          <div id="tutToc"></div>
        </aside>
        <div style="min-width:0">
          <select id="tutPick" class="tut-pick" aria-label="Pilih tutorial">${GROUPS.map((g) => `<optgroup label="${g}">${ARTICLES.filter((a) => a.group === g).map((a) => `<option value="${a.id}">${esc(a.title)}</option>`).join('')}</optgroup>`).join('')}</select>
          <div id="tutMain"></div>
        </div>
      </div>`;
    $('#tutQ', el).addEventListener('input', (e) => {
      st.q = e.target.value.trim();
      $('#tutToc', el).innerHTML = tocHtml(ctx);
      const first = visible(ctx)[0];
      if (st.q && first && !visible(ctx).some((a) => a.id === st.current)) { st.current = first.id; show(el, ctx); }
    });
    $('#tutPick', el).addEventListener('change', (e) => { location.hash = `#/tutorial/${e.target.value}`; });
    this._onHash = () => {
      const id = fromHash();
      if (id && id !== st.current) { st.current = id; show(el, ctx); el.scrollIntoView({ block: 'start' }); window.scrollTo(0, 0); }
    };
    window.addEventListener('hashchange', this._onHash);
    show(el, ctx);
  },
  unmount() {
    window.removeEventListener('hashchange', this._onHash);
  },
};
