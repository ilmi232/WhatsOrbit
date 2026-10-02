// Inti dashboard: login, sidebar, topbar, routing, dan pemuatan halaman per fitur.
// Halaman hanya di-import saat dibuka, dan menu fitur yang nonaktif tidak ditampilkan.
import { $, call, esc, icon, setUnauthorizedHandler, toast } from './ui.js';

/** Menu sidebar. `feature` = kunci fitur di Pengaturan (kosong = selalu ada). */
const MENU = [
  { group: 'Utama' },
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', sub: 'Ringkasan aktivitas WhatsOrbit' },
  { key: 'tutorial', label: 'Tutorial', icon: 'form', sub: 'Panduan memakai setiap fitur WhatsOrbit' },
  { group: 'Data' },
  { key: 'contacts', label: 'Kontak', icon: 'users', feature: 'contacts', sub: 'Data & grup kontak untuk Blast' },
  { key: 'leads', label: 'Daily Leads', icon: 'userplus', feature: 'leads', sub: 'Pengisi Google Form per hari' },
  { group: 'Outgoing' },
  { key: 'send', label: 'Kirim Pesan', icon: 'send', sub: 'Kirim pesan manual dari device' },
  { key: 'messages', label: 'Log Pesan', icon: 'list', feature: 'messageLog', sub: 'Riwayat pesan API & Google Form' },
  { key: 'blast', label: 'Blast', icon: 'blast', feature: 'blast', sub: 'Kirim massal dengan anti-banned' },
  { group: 'Incoming' },
  { key: 'webwa', label: 'Web WhatsApp', icon: 'chat', feature: 'webwa', sub: 'Baca & balas chat seperti WhatsApp Web' },
  { key: 'inbox', label: 'Pesan Masuk', icon: 'inbox', feature: 'inbox', sub: 'Pesan WhatsApp yang diterima device' },
  { key: 'cs', label: 'Customer Service', icon: 'headset', feature: 'cs', sub: 'Chat pelanggan dibagi ke petugas CS' },
  { group: 'Otomasi' },
  { key: 'chatbot', label: 'Chat Bot', icon: 'bot', feature: 'chatbot', sub: 'Bot menu bernomor untuk informasi sekolah' },
  { key: 'aibot', label: 'AI Chat Bot', icon: 'sparkles', feature: 'aibot', sub: 'Jawab pertanyaan bebas memakai AI' },
  { key: 'autoreply', label: 'Autoreply', icon: 'reply', feature: 'autoreply', sub: 'Balas otomatis berdasarkan kata kunci' },
  { key: 'form', label: 'Google Form', icon: 'form', feature: 'formScript', sub: 'Auto-reply WhatsApp saat form dikirim' },
  { key: 'sheets', label: 'Google Spreadsheet', icon: 'list', feature: 'sheets', sub: 'WhatsApp otomatis dari baris baru di spreadsheet' },
  { key: 'greeter', label: 'Group Greeter', icon: 'users', feature: 'greeter', sub: 'Sapa anggota baru di grup WhatsApp' },
  { key: 'birthday', label: 'Ulang Tahun', icon: 'cake', feature: 'birthday', sub: 'Ucapan otomatis dari data Kontak' },
  { group: 'Integrasi' },
  { key: 'widget', label: 'Chat Widget', icon: 'chat', feature: 'widget', sub: 'Tombol WhatsApp untuk website sekolah' },
  { key: 'payments', label: 'Lynk.id / Mayar.id', icon: 'link', feature: 'payments', sub: 'WhatsApp otomatis saat ada pembayaran' },
  { key: 'webhook', label: 'Webhook', icon: 'webhook', feature: 'webhook', sub: 'Kirim peristiwa WhatsOrbit ke aplikasi lain' },
  { key: 'api', label: 'Dokumentasi API', icon: 'code', feature: 'api', sub: 'Kirim pesan dari aplikasi lain' },
  { group: 'Pengaturan' },
  { key: 'devices', label: 'Device', icon: 'device', sub: 'Nomor WhatsApp yang tersambung' },
  { key: 'settings', label: 'Pengaturan', icon: 'settings', sub: 'Aktifkan fitur sesuai kebutuhan' },
];

const state = {
  info: null, // { version, publicUrl, features, memory, connected }
  devices: [],
};

const pageCache = new Map();
let current = null; // { key, mod, el }
let pollTimer = null;

const ctx = {
  state,
  call,
  toast,
  navigate: (key) => (location.hash = `#/${key}`),
  isOn: (feature) => !feature || !!state.info?.features?.[feature],
  async loadDevices() {
    state.devices = (await call('GET', '/admin/devices')).data;
    return state.devices;
  },
  async reloadInfo() {
    state.info = (await call('GET', '/admin/info')).data;
    renderChrome();
  },
};

// ---- Login ------------------------------------------------------------------
function showLogin() {
  clearInterval(pollTimer);
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#pw').value = '';
  $('#pw').focus();
}
setUnauthorizedHandler(showLogin);

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await call('POST', '/admin/login', { password: $('#pw').value });
    start();
  } catch (err) {
    toast(err.message);
  }
});

// ---- Chrome (sidebar + topbar) ---------------------------------------------
function renderChrome() {
  const active = current?.key;
  $('#nav').innerHTML = MENU.map((m, i) => {
    if (m.group) {
      // Sembunyikan judul grup kalau semua menunya nonaktif
      const items = [];
      for (let j = i + 1; j < MENU.length && !MENU[j].group; j++) items.push(MENU[j]);
      return items.some((x) => ctx.isOn(x.feature)) ? `<div class="nav-group">${m.group}</div>` : '';
    }
    if (!ctx.isOn(m.feature)) return '';
    return `<a class="nav-item ${m.key === active ? 'active' : ''}" href="#/${m.key}">
      <span class="ico">${icon(m.icon)}</span>${esc(m.label)}</a>`;
  }).join('');

  const info = state.info;
  if (!info) return;
  $('#ramPill').innerHTML = `
    <span class="pill-a">${icon('cpu')} ${info.memory.rssMb} MB</span>
    <span class="pill-b">${info.connected} device online</span>`;
}

$('#burger').addEventListener('click', () => $('.shell').classList.toggle('nav-open'));
$('#nav').addEventListener('click', () => $('.shell').classList.remove('nav-open'));
$('#logoutBtn').addEventListener('click', async () => {
  await call('POST', '/admin/logout').catch(() => {});
  showLogin();
});
$('#gearBtn').addEventListener('click', () => ctx.navigate('settings'));

// ---- Mode gelap / terang ----------------------------------------------------
// Tema awal sudah dipasang skrip di index.html; tombol ini menyimpan pilihan di browser.
const savedTheme = () => { try { return localStorage.getItem('wo-theme'); } catch { return null; } };
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('#themeBtn').title = t === 'dark' ? 'Ganti ke mode terang' : 'Ganti ke mode gelap';
}
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
$('#themeBtn').addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('wo-theme', t); } catch { /* mode privat: berlaku sampai halaman ditutup */ }
  applyTheme(t);
});
// Belum pernah memilih -> ikut perubahan tema sistem
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!savedTheme()) applyTheme(e.matches ? 'dark' : 'light');
});

// ---- Routing ----------------------------------------------------------------
async function route() {
  // "#/tutorial/blast" -> halaman "tutorial"; bagian setelahnya diurus halamannya sendiri
  const key = location.hash.replace(/^#\/?/, '').split('/')[0] || 'dashboard';
  if (current?.key === key && location.hash.includes(`#/${key}/`)) return;
  const item = MENU.find((m) => m.key === key);
  if (!item || !ctx.isOn(item.feature)) {
    if (key !== 'dashboard') return ctx.navigate('dashboard');
  }
  const m = item ?? MENU.find((x) => x.key === 'dashboard');

  current?.mod.unmount?.();
  $('#pageTitle').textContent = m.label;
  $('#pageSub').textContent = m.sub;
  document.title = `${m.label} · WhatsOrbit`;

  // Elemen baru per halaman, supaya event listener halaman lama ikut hilang
  const el = document.createElement('div');
  el.innerHTML = '<div class="empty muted">Memuat…</div>';
  $('#page').replaceChildren(el);
  let mod = pageCache.get(m.key);
  if (!mod) {
    mod = (await import(`./pages/${m.key}.js`)).default;
    pageCache.set(m.key, mod);
  }
  current = { key: m.key, mod, el };
  renderChrome();
  el.innerHTML = '';
  try {
    await mod.mount(el, ctx);
  } catch (err) {
    el.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ---- Start ------------------------------------------------------------------
async function start() {
  try {
    await ctx.reloadInfo();
    await ctx.loadDevices();
  } catch {
    return; // 401 -> showLogin sudah dipanggil
  }
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  await route();

  clearInterval(pollTimer);
  let tick = 0;
  pollTimer = setInterval(async () => {
    tick++;
    if (document.hidden) return;
    try {
      await current?.mod.refresh?.(current.el, ctx);
    } catch { /* abaikan, dicoba lagi */ }
    if (tick % 5 === 0) {
      ctx.reloadInfo().catch(() => {});
    }
  }, 3000);
}

start();
