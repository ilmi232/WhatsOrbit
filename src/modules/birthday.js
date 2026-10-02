// Modul Ulang Tahun: hanya dimuat kalau fitur "birthday" aktif (butuh fitur Kontak).
import { db, devices, getSetting, messages, setSetting } from '../db.js';
import { render } from '../template.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS birthday_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    year       INTEGER NOT NULL,
    message_id INTEGER,
    device_id  TEXT,
    body       TEXT,
    sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (contact_id, year)
  );
`);

export const DEFAULTS = {
  auto: false,
  time: '07:00',
  deviceIds: [],
  field: '', // kosong = deteksi otomatis
  groupIds: [],
  template:
    '{Selamat ulang tahun|Selamat milad|Happy birthday}, [Nama Depan]! 🎂\n\n' +
    '{Semoga sehat selalu|Semoga selalu diberi kesehatan}, makin semangat, dan sukses meraih cita-cita.\n\n' +
    'Salam hangat,\nKeluarga Besar Sekolah',
};
const LAST_HOUR = 21; // setelah jam ini, ucapan hari itu tidak dikirim otomatis lagi
const FIELD_HINT = /lahir|ultah|ulang\s*tahun|birth|dob/i;

// ---- Tanggal ------------------------------------------------------------------------
const MONTHS = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, peb: 2, mar: 3, maret: 3, march: 3,
  apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, ags: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, nop: 11, november: 11, nopember: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (m, y = 2000) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

function fullYear(y) {
  if (y == null) return null;
  if (y >= 1000) return y;
  const now = new Date().getFullYear() % 100;
  return y <= now ? 2000 + y : 1900 + y; // "10" -> 2010, "85" -> 1985
}

/**
 * Baca tanggal lahir dari teks bebas. Mengembalikan { d, m, y } (y boleh null) atau null.
 * Urutan Indonesia (hari/bulan) diutamakan.
 */
export function parseBirthDate(input) {
  const s = String(input ?? '').trim().toLowerCase().replace(/^=?"?|"$/g, '');
  if (!s) return null;
  let d, m, y;
  let r;
  if ((r = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) {
    [y, m, d] = [+r[1], +r[2], +r[3]];
  } else if ((r = s.match(/^(\d{1,2})[-/.\s](\d{1,2})(?:[-/.\s](\d{2,4}))?$/))) {
    [d, m, y] = [+r[1], +r[2], r[3] ? +r[3] : null];
    if (m > 12 && d <= 12) [d, m] = [m, d]; // format bulan/hari
  } else if ((r = s.match(/^(\d{1,2})\s*[-/.]?\s*([a-z]+)\.?\s*[-/.,]?\s*(\d{2,4})?$/))) {
    [d, m, y] = [+r[1], MONTHS[r[2]], r[3] ? +r[3] : null];
  } else if ((r = s.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s*(\d{2,4})?$/))) {
    [m, d, y] = [MONTHS[r[1]], +r[2], r[3] ? +r[3] : null]; // "May 17, 2010"
  } else if ((r = s.match(/^(\d{5})$/)) && +r[1] > 7000 && +r[1] < 60000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + +r[1] * 86400000); // angka tanggal Excel / Sheets
    [d, m, y] = [dt.getUTCDate(), dt.getUTCMonth() + 1, dt.getUTCFullYear()];
  } else {
    return null;
  }
  y = fullYear(y);
  if (!m || m < 1 || m > 12 || !d || d < 1 || d > daysIn(m, y ?? 2000)) return null;
  if (y && (y < 1900 || y > new Date().getFullYear())) return null;
  return { d, m, y: y ?? null };
}

/** Apakah tanggal lahir jatuh pada `date` (29 Feb dirayakan 28 Feb di tahun biasa). */
export function isBirthdayOn(b, date = new Date()) {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  if (b.m === m && b.d === d) return true;
  return b.m === 2 && b.d === 29 && m === 2 && d === 28 && !isLeap(date.getFullYear());
}

/** Hari menuju ulang tahun berikutnya (0 = hari ini). */
function daysUntil(b, from = new Date()) {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 367; i++) {
    const t = new Date(today.getTime() + i * 86400000);
    if (isBirthdayOn(b, t)) return { days: i, date: t };
  }
  return null;
}

const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

// ---- Pengaturan & data ---------------------------------------------------------------
export function loadSettings() {
  const s = { ...DEFAULTS, ...JSON.parse(getSetting('birthday', () => '{}')) };
  return s;
}

function saveSettings(input) {
  const cur = loadSettings();
  const b = input ?? {};
  const time = /^([01]?\d|2[0-3]):([0-5]\d)$/.test(b.time ?? '') ? b.time.padStart(5, '0') : cur.time;
  const known = new Set(devices.all().map((d) => d.id));
  const next = {
    auto: b.auto === undefined ? cur.auto : !!b.auto,
    time,
    deviceIds: Array.isArray(b.deviceIds) ? b.deviceIds.filter((d) => known.has(d)) : cur.deviceIds,
    field: b.field === undefined ? cur.field : String(b.field).trim(),
    groupIds: Array.isArray(b.groupIds) ? b.groupIds.map(Number).filter(Boolean) : cur.groupIds,
    template: b.template === undefined ? cur.template : String(b.template).trim() || DEFAULTS.template,
  };
  setSetting('birthday', JSON.stringify(next));
  return next;
}

/** Nama kolom tanggal lahir: dari pengaturan, atau tebakan dari kolom yang ada. */
function birthField(settings) {
  if (settings.field) return settings.field;
  const counts = {};
  for (const r of db.prepare("SELECT fields FROM contacts WHERE fields != '{}'").all()) {
    for (const k of Object.keys(JSON.parse(r.fields))) if (FIELD_HINT.test(k)) counts[k] = (counts[k] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/** Semua kontak (sesuai filter grup) beserta tanggal lahir yang terbaca. */
function scan(settings) {
  const field = birthField(settings);
  const fk = field.toLowerCase();
  const groupSql = settings.groupIds.length
    ? `WHERE EXISTS (SELECT 1 FROM contact_group_members m WHERE m.contact_id = c.id AND m.group_id IN (${settings.groupIds.map(() => '?').join(',')}))`
    : '';
  const rows = db.prepare(`SELECT c.id, c.name, c.phone, c.fields FROM contacts c ${groupSql}`).all(...settings.groupIds);
  const valid = [];
  const invalid = [];
  let missing = 0;
  for (const r of rows) {
    const fields = JSON.parse(r.fields);
    const key = Object.keys(fields).find((k) => k.toLowerCase() === fk);
    const raw = key ? fields[key] : '';
    if (!raw) { missing++; continue; }
    const b = parseBirthDate(raw);
    if (b) valid.push({ ...r, fields, birth: b, raw });
    else invalid.push({ id: r.id, name: r.name, phone: r.phone, raw });
  }
  return { field, total: rows.length, valid, invalid, missing };
}

function varsFor(c, now = new Date()) {
  const name = c.name || '';
  const age = c.birth.y ? now.getFullYear() - c.birth.y : '';
  return {
    ...c.fields,
    Nama: name,
    'Nama Depan': name.split(/\s+/)[0] ?? '',
    Umur: age === '' ? '' : String(age),
    Nomor: '0' + c.phone.replace(/^62/, ''),
  };
}

export async function register({ router, wa, isEnabled }) {
  let rr = 0; // giliran device

  function pickDevice(settings) {
    const ids = settings.deviceIds.length ? settings.deviceIds : devices.all().map((d) => d.id);
    if (!ids.length) return null;
    const online = ids.filter((id) => wa.getState(id).status === 'connected');
    const pool = online.length ? online : ids; // kalau semua offline, tetap antre di device pertama
    return pool[rr++ % pool.length];
  }

  /** Kirim ucapan untuk yang berulang tahun hari ini dan belum dikirimi tahun ini. */
  function runToday() {
    const s = loadSettings();
    const now = new Date();
    const year = now.getFullYear();
    const { valid } = scan(s);
    const done = new Set(db.prepare('SELECT contact_id FROM birthday_log WHERE year = ?').all(year).map((r) => r.contact_id));
    let queued = 0;
    const touched = new Set();
    for (const c of valid) {
      if (!isBirthdayOn(c.birth, now) || done.has(c.id)) continue;
      const deviceId = pickDevice(s);
      if (!deviceId) break;
      const body = render(s.template, varsFor(c, now)).trim();
      const mid = messages.enqueue(deviceId, c.phone, body);
      db.prepare('INSERT OR IGNORE INTO birthday_log (contact_id, year, message_id, device_id, body) VALUES (?, ?, ?, ?, ?)')
        .run(c.id, year, mid, deviceId, body);
      touched.add(deviceId);
      queued++;
    }
    for (const id of touched) wa.drainQueue(id);
    if (queued) wa.logger.info({ queued }, 'ucapan ulang tahun masuk antrean');
    return { queued };
  }

  // Penjadwal: cek tiap menit, kirim antara jam yang ditentukan s/d pukul 21.00
  const tick = () => {
    try {
      if (!isEnabled()) return;
      const s = loadSettings();
      if (!s.auto) return;
      const now = new Date();
      const [hh, mm] = s.time.split(':').map(Number);
      const mins = now.getHours() * 60 + now.getMinutes();
      if (mins < hh * 60 + mm || now.getHours() >= LAST_HOUR) return;
      runToday();
    } catch (err) {
      wa.logger.warn({ err: err.message }, 'penjadwal ulang tahun error');
    }
  };
  setInterval(tick, 60_000).unref();
  setTimeout(tick, 15_000).unref(); // sesaat setelah server menyala (device sempat tersambung)

  // ---- API admin ------------------------------------------------------------------
  router.get('/settings', (_req, res) => {
    const s = loadSettings();
    res.json({ success: true, data: { ...s, detectedField: birthField({ ...s, field: '' }), lastHour: LAST_HOUR } });
  });

  router.put('/settings', (req, res) => res.json({ success: true, data: saveSettings(req.body) }));

  router.get('/overview', (_req, res) => {
    const s = loadSettings();
    const now = new Date();
    const sc = scan(s);
    const logs = Object.fromEntries(
      db.prepare(
        `SELECT b.contact_id, b.message_id, b.sent_at, m.status FROM birthday_log b
           LEFT JOIN messages m ON m.id = b.message_id WHERE b.year = ?`
      ).all(now.getFullYear()).map((r) => [r.contact_id, r])
    );
    const upcoming = sc.valid
      .map((c) => {
        const u = daysUntil(c.birth, now);
        const age = c.birth.y ? u.date.getFullYear() - c.birth.y : null;
        return { id: c.id, name: c.name, phone: c.phone, raw: c.raw, days: u.days, date: ymd(u.date), age, log: u.days === 0 ? logs[c.id] ?? null : null };
      })
      .filter((x) => x.days <= 30)
      .sort((a, b) => a.days - b.days || a.name.localeCompare(b.name, 'id'));
    res.json({
      success: true,
      data: {
        field: sc.field,
        total: sc.total,
        withDate: sc.valid.length,
        missing: sc.missing,
        invalid: sc.invalid.slice(0, 100),
        invalidCount: sc.invalid.length,
        today: upcoming.filter((x) => x.days === 0),
        upcoming: upcoming.filter((x) => x.days > 0),
        thisYear: db.prepare('SELECT COUNT(*) AS n FROM birthday_log WHERE year = ?').get(now.getFullYear()).n,
      },
    });
  });

  router.post('/run', (_req, res) => {
    const s = loadSettings();
    if (!s.template) return res.status(400).json({ success: false, message: 'Isi pesan ucapan dulu' });
    res.json({ success: true, data: runToday() });
  });

  router.post('/preview', (req, res) => {
    const s = { ...loadSettings(), ...(req.body?.field !== undefined ? { field: req.body.field } : {}) };
    const sample = scan(s).valid[0] ?? {
      name: 'Budi Santoso', phone: '6281234567890', fields: { Kelas: '9A' }, birth: { d: 17, m: 5, y: new Date().getFullYear() - 15 },
    };
    const template = String(req.body?.template ?? s.template);
    res.json({ success: true, data: { name: sample.name, body: render(template, varsFor(sample)) } });
  });

  router.get('/history', (_req, res) => {
    const rows = db.prepare(
      `SELECT b.*, c.name, c.phone, d.name AS device_name, m.status, m.error
         FROM birthday_log b
         LEFT JOIN contacts c ON c.id = b.contact_id
         LEFT JOIN devices d ON d.id = b.device_id
         LEFT JOIN messages m ON m.id = b.message_id
        ORDER BY b.id DESC LIMIT 100`
    ).all();
    res.json({ success: true, data: rows });
  });
}
