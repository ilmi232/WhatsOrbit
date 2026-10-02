// Utilitas UI bersama: DOM, API, ikon, grafik SVG, modal, toast.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmt = (n) => Number(n ?? 0).toLocaleString('id-ID');

export const STATUS = {
  connected: 'Terkoneksi', qr: 'Menunggu scan', connecting: 'Menghubungkan', disconnected: 'Tidak terkoneksi', logged_out: 'Logout',
  sent: 'Terkirim', pending: 'Antrean', failed: 'Gagal', sending: 'Mengirim',
  running: 'Berjalan', paused: 'Dijeda', done: 'Selesai', cancelled: 'Dibatalkan', draft: 'Draft',
};
export const chip = (status, label) => `<span class="chip ${esc(status)}">${esc(label ?? STATUS[status] ?? status)}</span>`;

// ---- API -------------------------------------------------------------------
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

export async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/admin/login') {
    onUnauthorized();
    throw new Error('Sesi berakhir, silakan masuk lagi');
  }
  if (!res.ok) throw new Error(json.message || res.statusText);
  return json;
}

// ---- Toast & modal -----------------------------------------------------------
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2400);
}

function modal({ title, text = '', input = null, okText = 'OK', danger = false, cancel = true }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <form class="modal" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>
        ${text ? `<p>${esc(text)}</p>` : ''}
        ${input !== null ? `<div class="field"><input name="v" value="${esc(input)}" required></div>` : ''}
        <div class="row">
          ${cancel ? '<button type="button" class="btn ghost" data-x>Batal</button>' : ''}
          <button class="btn ${danger ? 'bad' : 'grad'}">${esc(okText)}</button>
        </div>
      </form>`;
    const close = (v) => { bg.remove(); resolve(v); };
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.hasAttribute('data-x')) close(input !== null ? null : false); });
    bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(input !== null ? null : false); });
    $('form', bg).addEventListener('submit', (e) => {
      e.preventDefault();
      close(input !== null ? $('input', bg).value.trim() : true);
    });
    document.body.append(bg);
    ($('input', bg) || $('button:last-child', bg)).focus();
  });
}
export const confirmBox = (title, text, opts = {}) => modal({ title, text, okText: opts.okText ?? 'Ya, lanjutkan', danger: opts.danger });
export const promptBox = (title, value = '', text = '') => modal({ title, text, input: value, okText: 'Simpan' });

// ---- Ikon (garis, 24x24) -----------------------------------------------------------
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  device: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  blast: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  history: '<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.3"/><path d="M3 3.5v4.8h4.8"/><path d="M12 7.5V12l3 2"/>',
  sheet: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 9.5h17M3.5 15h17M9.5 9.5v11"/>',
  chats: '<path d="M15 9.5a2 2 0 0 1-2 2H7l-4 3.5V4.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18.5 8.5h.5a2 2 0 0 1 2 2V21l-4-3.5h-6a2 2 0 0 1-2-2V15"/>',
  widget: '<rect x="2.5" y="3.5" width="19" height="17" rx="2.5"/><path d="M2.5 8.5h19M5.8 6h.01M8.3 6h.01"/><path d="M14 17.8l.6-1.5a2.7 2.7 0 1 1 1.2 1z" fill="currentColor"/>',
  form: '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M8 7h8"/><circle cx="8.6" cy="12" r="1.4"/><path d="M12 12h4"/><circle cx="8.6" cy="16.6" r="1.4"/><path d="M12 16.6h4"/>',
  book: '<path d="M2.5 5h5.5a4 4 0 0 1 4 4v11.5a3 3 0 0 0-3-3H2.5z"/><path d="M21.5 5H16a4 4 0 0 0-4 4v11.5a3 3 0 0 1 3-3h6.5z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  headset: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M21 15a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2zM3 15a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z"/><path d="M18 17v1a3 3 0 0 1-3 3h-3"/>',
  sparkles: '<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14 9l2 2"/>',
  userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  reply: '<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  bot: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4M8 4h8M9 14h.01M15 14h.01"/>',
  webhook: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  cake: '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1M2 21h20M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(-30 12 12)"/><circle cx="20.2" cy="7.6" r="1.4" fill="currentColor" stroke="none"/>',
};
export const icon = (name, cls = '') =>
  `<svg class="svg-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;

// ---- Grafik ----------------------------------------------------------------------
let gid = 0;

/** Garis halus + area gradien untuk kartu statistik. */
export function sparkline(values, color = 'var(--primary)', { w = 300, h = 64 } = {}) {
  const v = values.length > 1 ? values : [0, ...values, 0];
  const max = Math.max(1, ...v);
  const pts = v.map((y, i) => [(i / (v.length - 1)) * w, h - 8 - (y / max) * (h - 18)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  const id = `sg${++gid}`;
  const [lx, ly] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${w},${h} L0,${h} Z" fill="url(#${id})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${lx}" cy="${ly}" r="5" fill="${color}" stroke="#fff" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/** Diagram batang berpasangan (terkirim vs gagal) per hari. */
export function barChart(rows, { h = 240 } = {}) {
  const w = 640;
  const pad = { l: 36, r: 8, t: 14, b: 30 };
  const max = Math.max(4, ...rows.flatMap((r) => [r.sent, r.failed]));
  const nice = Math.ceil(max / 4) * 4;
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const slot = iw / rows.length;
  const bw = Math.min(18, slot / 4);
  const y = (v) => pad.t + ih - (v / nice) * ih;
  const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (nice / 4) * i;
    g += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" ${i ? 'stroke-dasharray="4 5"' : ''}/>
          <text x="${pad.l - 10}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${fmt(v)}</text>`;
  }
  rows.forEach((r, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const isToday = i === rows.length - 1;
    const d = new Date(`${r.day}T00:00:00`);
    g += `<g><title>${d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' })}: ${r.sent} terkirim, ${r.failed} gagal</title>
      <rect x="${cx - bw - 2}" y="${y(r.sent)}" width="${bw}" height="${Math.max(0, pad.t + ih - y(r.sent))}" rx="${bw / 2.4}" fill="${isToday ? 'url(#barToday)' : 'var(--primary)'}" opacity="${isToday ? 1 : 0.85}"/>
      <rect x="${cx + 2}" y="${y(r.failed)}" width="${bw}" height="${Math.max(0, pad.t + ih - y(r.failed))}" rx="${bw / 2.4}" fill="var(--bad)" opacity=".75"/>
      <text x="${cx}" y="${h - 8}" text-anchor="middle" font-size="11.5" fill="${isToday ? 'var(--text)' : 'var(--muted)'}" font-weight="${isToday ? 600 : 400}">${isToday ? 'Hari ini' : days[d.getDay()]}</text></g>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Grafik pesan 7 hari">
    <defs><linearGradient id="barToday" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3cc4f8"/><stop offset="1" stop-color="#127fd0"/></linearGradient></defs>${g}</svg>`;
}

/** Diagram batang satu seri per hari, mis. 30 hari terakhir. rows: [{day, n, fresh?}] */
export function barSeries(rows, { h = 220 } = {}) {
  const w = 720;
  const pad = { l: 34, r: 6, t: 12, b: 28 };
  const max = Math.max(4, ...rows.map((r) => r.n));
  const nice = Math.ceil(max / 4) * 4;
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const slot = iw / rows.length;
  const bw = Math.max(4, Math.min(16, slot * 0.55));
  const y = (v) => pad.t + ih - (v / nice) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (nice / 4) * i;
    g += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" ${i ? 'stroke-dasharray="4 5"' : ''}/>
          <text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${fmt(v)}</text>`;
  }
  const every = Math.ceil(rows.length / 8);
  rows.forEach((r, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const d = new Date(`${r.day}T00:00:00`);
    const last = i === rows.length - 1;
    const label = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    const fresh = r.fresh ?? r.n;
    g += `<g><title>${d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}: ${r.n} lead${r.fresh !== undefined ? ` (${fresh} kontak baru)` : ''}</title>
      <rect x="${cx - bw / 2}" y="${pad.t}" width="${bw}" height="${ih}" fill="transparent"/>
      <rect x="${cx - bw / 2}" y="${y(r.n)}" width="${bw}" height="${pad.t + ih - y(r.n)}" rx="${bw / 2.5}" fill="var(--primary)" opacity=".35"/>
      <rect x="${cx - bw / 2}" y="${y(fresh)}" width="${bw}" height="${pad.t + ih - y(fresh)}" rx="${bw / 2.5}" fill="${last ? 'url(#barToday)' : 'var(--primary)'}"/>
      ${(rows.length - 1 - i) % every === 0 ? `<text x="${cx}" y="${h - 8}" text-anchor="middle" font-size="11" fill="${last ? 'var(--text)' : 'var(--muted)'}" font-weight="${last ? 600 : 400}">${last ? 'Hari ini' : label}</text>` : ''}</g>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Grafik lead per hari">
    <defs><linearGradient id="barToday" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3cc4f8"/><stop offset="1" stop-color="#127fd0"/></linearGradient></defs>${g}</svg>`;
}

/** Donut persentase (untuk tile berwarna). */

/** Donut multi-segmen (terkirim / antrean / gagal). */
export function ring(parts, { size = 170, stroke = 22 } = {}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let off = 0;
  const segs = total
    ? parts.filter((p) => p.value).map((p) => {
        const len = (p.value / total) * c;
        const s = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${stroke}"
          stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
        off += len;
        return s;
      }).join('')
    : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Komposisi pesan">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${stroke}"/>${segs}
    <text x="50%" y="46%" text-anchor="middle" font-size="26" font-weight="700" fill="var(--text)">${fmt(total)}</text>
    <text x="50%" y="62%" text-anchor="middle" font-size="11.5" fill="var(--muted)">pesan</text>
  </svg>`;
}

export const fmtDur = (sec) => {
  if (sec < 60) return `${Math.round(sec)} detik`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} menit` : `${Math.floor(m / 60)} jam ${m % 60} menit`;
};

export const timeAgo = (sqlDate) => {
  if (!sqlDate) return '';
  const d = new Date(sqlDate.replace(' ', 'T') + 'Z');
  const s = (Date.now() - d) / 1000;
  if (s < 60) return 'baru saja';
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
};

export const localTime = (sqlDate) =>
  sqlDate ? new Date(sqlDate.replace(' ', 'T') + 'Z').toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export async function copyText(text, msg = 'Disalin') {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    toast('Gagal menyalin, salin manual');
  }
}
