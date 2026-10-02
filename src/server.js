import './restore-boot.js'; // harus paling awal: pulihkan backup sebelum database dibuka
import express from 'express';
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ADMIN_PASSWORD, HOST, PORT, PUBLIC_DASHBOARD, PUBLIC_URL, ROOT_DIR } from './config.js';
import { db, devices, getSetting, messages, tableExists } from './db.js';
import { normalizePhone } from './phone.js';
import * as wa from './wa.js';
import * as features from './features.js';
import * as backup from './backup.js';
import * as antiban from './antiban.js';

if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD belum diisi. Salin .env.example menjadi .env lalu isi password admin.');
  process.exit(1);
}

const VERSION = '0.3.0';
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' })); // daftar penerima blast bisa panjang
app.use(express.urlencoded({ extended: false }));

// ---------------------------------------------------------------------------
// API publik (dipanggil Apps Script) — kompatibel dengan format Starsender:
//   POST /api/send   Header: Authorization: <API key device>
//   Body: { "messageType": "text", "to": "0812...", "body": "Halo" }
// ---------------------------------------------------------------------------
const api = express.Router();

/**
 * Hook untuk modul fitur. `lead` diisi modul Daily Leads:
 *   lead({ device, lead }) -> { contactId, isNew } | null
 */
const hooks = { lead: null };

function saveLead(device, lead, fallbackPhone) {
  if (!lead || typeof lead !== 'object' || !hooks.lead || !features.isEnabled('leads')) return null;
  try {
    return hooks.lead({ device, lead: { ...lead, phone: lead.phone ?? fallbackPhone } });
  } catch (err) {
    wa.logger.warn({ err: err.message }, 'gagal simpan lead');
    return { error: err.message };
  }
}

api.use(features.requireFeature('api'));

api.use((req, res, next) => {
  const key = String(req.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const device = key && devices.byApiKey(key);
  if (!device) return res.status(401).json({ success: false, message: 'API key tidak valid' });
  req.device = device;
  next();
});

api.post('/send', (req, res) => {
  const { messageType = 'text', to, body } = req.body ?? {};
  if (messageType !== 'text') {
    return res.status(400).json({ success: false, message: 'Saat ini hanya messageType "text" yang didukung' });
  }
  if (!body || !String(body).trim()) {
    return res.status(400).json({ success: false, message: 'body (isi pesan) wajib diisi' });
  }
  // "to" boleh satu nomor atau beberapa dipisah koma
  const targets = String(to ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (!targets.length) return res.status(400).json({ success: false, message: 'to (nomor tujuan) wajib diisi' });

  const queued = [];
  const invalid = [];
  for (const t of targets) {
    const n = normalizePhone(t);
    if (n) queued.push({ to: n, id: messages.enqueue(req.device.id, n, String(body)) });
    else invalid.push(t);
  }
  wa.drainQueue(req.device.id);
  // Opsional: simpan pengisi form sebagai lead/kontak (fitur Daily Leads)
  const lead = saveLead(req.device, req.body?.lead, targets[0]);

  const { status } = wa.getState(req.device.id);
  res.status(queued.length ? 200 : 400).json({
    success: queued.length > 0,
    message: queued.length
      ? status === 'connected'
        ? 'Pesan masuk antrean'
        : 'Pesan masuk antrean, akan dikirim saat device terhubung kembali'
      : 'Nomor tujuan tidak valid',
    data: { device: req.device.name, deviceStatus: status, queued, invalid, ...(lead ? { lead } : {}) },
  });
});

// Simpan lead tanpa mengirim pesan
api.post('/lead', (req, res) => {
  if (!features.isEnabled('leads') || !hooks.lead) {
    return res.status(404).json({ success: false, message: 'Fitur Daily Leads nonaktif' });
  }
  const result = saveLead(req.device, req.body?.lead ?? req.body);
  if (!result || result.error) return res.status(400).json({ success: false, message: result?.error ?? 'Data lead tidak valid' });
  res.json({ success: true, message: 'Lead tersimpan', data: result });
});

api.get('/status', (req, res) => {
  res.json({ success: true, data: { device: req.device.name, ...wa.getState(req.device.id), qr: undefined } });
});

// Endpoint publik modul (tanpa API key), dipasang sebelum /api yang butuh API key
app.use('/api/widget', features.requireFeature('widget'), features.publicRouter('widget'));
app.use('/api', api);

// Request lewat tunnel (ngrok / Cloudflare) selalu membawa X-Forwarded-For.
// Dashboard hanya boleh dibuka langsung dari PC ini, kecuali PUBLIC_DASHBOARD=true.
app.use((req, res, next) => {
  if (!PUBLIC_DASHBOARD && req.get('X-Forwarded-For')) return res.status(404).send('Not found');
  next();
});

// ---------------------------------------------------------------------------
// Admin (dashboard)
// ---------------------------------------------------------------------------
const secret = getSetting('session_secret', () => randomBytes(32).toString('hex'));
const adminToken = createHmac('sha256', secret).update(ADMIN_PASSWORD).digest('hex');

function readCookie(req, name) {
  const m = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
const safeEqual = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const admin = express.Router();

admin.post('/login', (req, res) => {
  const pw = String(req.body?.password ?? '');
  if (!safeEqual(pw, ADMIN_PASSWORD)) return res.status(401).json({ success: false, message: 'Password salah' });
  res.cookie('wo_admin', adminToken, { httpOnly: true, sameSite: 'strict', maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ success: true });
});

admin.post('/logout', (_req, res) => {
  res.clearCookie('wo_admin');
  res.json({ success: true });
});

admin.use((req, res, next) => {
  const token = readCookie(req, 'wo_admin');
  if (!token || !safeEqual(token, adminToken)) return res.status(401).json({ success: false, message: 'Belum login' });
  next();
});

// ---- Info, statistik, pengaturan ---------------------------------------------
const memory = () => {
  const m = process.memoryUsage();
  return { rssMb: Math.round(m.rss / 1048576), heapMb: Math.round(m.heapUsed / 1048576) };
};

admin.get('/info', (_req, res) =>
  res.json({
    success: true,
    data: { publicUrl: PUBLIC_URL, version: VERSION, features: features.enabledMap(), memory: memory(), connected: wa.connectedCount() },
  })
);

admin.get('/stats', (_req, res) => {
  const hasBlast = tableExists('campaign_recipients');
  // Gabungan pesan API/Google Form + pesan blast, per hari (waktu lokal), 7 hari terakhir
  const union = `
    SELECT status, sent_at, created_at AS at FROM messages
    ${hasBlast ? "UNION ALL SELECT status, sent_at, sent_at AS at FROM campaign_recipients WHERE status IN ('sent','failed')" : ''}`;
  const days = db
    .prepare(
      `SELECT date(COALESCE(sent_at, at), 'localtime') AS day,
              SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed
         FROM (${union})
        WHERE date(COALESCE(sent_at, at), 'localtime') >= date('now', 'localtime', '-6 days')
        GROUP BY day`
    )
    .all();
  const byDay = Object.fromEntries(days.map((d) => [d.day, d]));
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    last7.push({ day: key, sent: byDay[key]?.sent ?? 0, failed: byDay[key]?.failed ?? 0 });
  }
  const totals = db.prepare(`SELECT SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed, SUM(status = 'pending') AS pending FROM (${union})`).get();
  const recent = db
    .prepare(
      `SELECT 'api' AS source, m.id, m.to_number AS phone, m.body, m.status, COALESCE(m.sent_at, m.created_at) AS at, d.name AS device
         FROM messages m LEFT JOIN devices d ON d.id = m.device_id
       ${hasBlast ? `UNION ALL
       SELECT 'blast', r.id, r.phone, r.body, r.status, r.sent_at, d.name
         FROM campaign_recipients r LEFT JOIN devices d ON d.id = r.device_id WHERE r.sent_at IS NOT NULL` : ''}
       ORDER BY at DESC LIMIT 6`
    )
    .all();
  const blasts = hasBlast && features.isEnabled('blast')
    ? db
        .prepare(
          `SELECT c.id, c.name, c.status,
                  SUM(r.status = 'sent') AS sent, SUM(r.status = 'failed') AS failed, COUNT(r.id) AS total
             FROM campaigns c LEFT JOIN campaign_recipients r ON r.campaign_id = c.id
            WHERE c.status IN ('running', 'paused') OR c.finished_at >= datetime('now', '-1 day')
            GROUP BY c.id ORDER BY c.id DESC LIMIT 4`
        )
        .all()
    : [];
  const today = last7[last7.length - 1];
  const contactsTotal = features.isEnabled('contacts') && tableExists('contacts')
    ? db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n
    : null;
  const leadsToday = features.isEnabled('leads') && tableExists('leads')
    ? db.prepare("SELECT COUNT(*) AS n FROM leads WHERE date(created_at, 'localtime') = date('now', 'localtime')").get().n
    : null;
  res.json({
    success: true,
    data: {
      today,
      last7,
      totals: { sent: totals.sent ?? 0, failed: totals.failed ?? 0, pending: totals.pending ?? 0 },
      devices: devices.all().map((d) => ({ id: d.id, name: d.name, phone: d.phone, status: wa.getState(d.id).status })),
      recent,
      blasts,
      contactsTotal,
      leadsToday,
      incomingToday: features.isEnabled('inbox') && tableExists('incoming_messages')
        ? db.prepare("SELECT COUNT(*) AS n FROM incoming_messages WHERE date(received_at, 'localtime') = date('now', 'localtime')").get().n
        : null,
      memory: memory(),
      uptimeSec: Math.round(process.uptime()),
    },
  });
});

admin.get('/features', (_req, res) => res.json({ success: true, data: features.list() }));

admin.patch('/features/:key', async (req, res) => {
  try {
    const changed = await features.setEnabled(req.params.key, !!req.body?.enabled);
    res.json({ success: true, data: features.list(), changed });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

admin.get('/system', (_req, res) =>
  res.json({
    success: true,
    data: {
      version: VERSION,
      node: process.version,
      memory: memory(),
      uptimeSec: Math.round(process.uptime()),
      pm2: process.env.pm_id !== undefined,
      publicUrl: PUBLIC_URL,
      devices: devices.all().length,
      connected: wa.connectedCount(),
    },
  })
);

// ---- Anti-banned ---------------------------------------------------------------------
admin.get('/antiban', (_req, res) => {
  res.json({
    success: true,
    data: {
      settings: antiban.loadSettings(),
      warmup: antiban.WARMUP,
      devices: devices.all().map((d) => ({ id: d.id, name: d.name, status: wa.getState(d.id).status, ...antiban.usage(d.id) })),
    },
  });
});

admin.put('/antiban', (req, res) => {
  const s = antiban.saveSettings(req.body ?? {});
  for (const d of devices.all()) wa.drainQueue(d.id); // kuota naik -> pesan tertahan bisa jalan lagi
  res.json({ success: true, data: s });
});

admin.patch('/devices/:id/warmup', (req, res) => {
  const d = findDevice(req, res);
  if (!d) return;
  antiban.setWarmup(d.id, !!req.body?.on);
  res.json({ success: true, data: antiban.usage(d.id) });
});

// ---- Backup -------------------------------------------------------------------------
admin.get('/backup', (_req, res) => {
  const s = backup.loadSettings();
  let items = [];
  let listError = null;
  try { items = backup.list(s.dir); } catch (err) { listError = err.message; }
  res.json({ success: true, data: { settings: s, suggestions: backup.suggestions(), items, last: backup.lastResult(), listError, pm2: process.env.pm_id !== undefined } });
});

admin.put('/backup/settings', (req, res) => {
  try { res.json({ success: true, data: backup.saveSettings(req.body ?? {}) }); } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

admin.post('/backup/run', (_req, res) => {
  try { res.json({ success: true, data: backup.run('manual') }); } catch (err) {
    res.status(400).json({ success: false, message: `Backup gagal: ${err.message}` });
  }
});

admin.post('/backup/restore', (req, res) => {
  if (process.env.pm_id === undefined) {
    return res.status(400).json({ success: false, message: 'Pulihkan butuh server berjalan lewat PM2 (supaya bisa restart otomatis).' });
  }
  try {
    // Backup kondisi sekarang dulu (kalau folder tujuan ada), lalu pulihkan saat restart
    // (tanpa menghapus backup lama, supaya backup yang mau dipulihkan tidak ikut terhapus)
    try { backup.run('sebelum pulihkan', { prune: false }); } catch { /* tetap lanjut: data lama juga disimpan di folder data */ }
    const b = backup.scheduleRestore(String(req.body?.name ?? ''));
    res.json({ success: true, data: b });
    setTimeout(() => process.exit(0), 300);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

admin.post('/restart', (_req, res) => {
  if (process.env.pm_id === undefined) {
    return res.status(400).json({ success: false, message: 'Server tidak berjalan lewat PM2, restart manual.' });
  }
  res.json({ success: true });
  // PM2 akan menyalakan ulang proses ini otomatis
  setTimeout(() => process.exit(0), 300);
});

// ---- Device -------------------------------------------------------------------
function deviceView(d) {
  const counts = { pending: 0, sent: 0, failed: 0 };
  for (const s of messages.stats()) if (s.device_id === d.id) counts[s.status] = s.n;
  return { ...d, ...wa.getState(d.id), counts, antiban: antiban.usage(d.id) };
}

const findDevice = (req, res) => {
  const d = devices.get(req.params.id);
  if (!d) res.status(404).json({ success: false, message: 'Device tidak ditemukan' });
  return d;
};

admin.get('/devices', (_req, res) => res.json({ success: true, data: devices.all().map(deviceView) }));

admin.post('/devices', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ success: false, message: 'Nama device wajib diisi' });
  res.json({ success: true, data: deviceView(devices.create(name)) });
});

admin.patch('/devices/:id', (req, res) => {
  const d = findDevice(req, res);
  if (!d) return;
  const name = String(req.body?.name ?? '').trim();
  if (name) devices.rename(d.id, name);
  res.json({ success: true, data: deviceView(devices.get(d.id)) });
});

admin.post('/devices/:id/connect', async (req, res) => {
  const d = findDevice(req, res);
  if (!d) return;
  await wa.startDevice(d.id);
  res.json({ success: true, data: deviceView(d) });
});

admin.post('/devices/:id/disconnect', (req, res) => {
  const d = findDevice(req, res);
  if (!d) return;
  wa.stopDevice(d.id);
  res.json({ success: true, data: deviceView(d) });
});

admin.post('/devices/:id/logout', async (req, res) => {
  const d = findDevice(req, res);
  if (!d) return;
  await wa.logoutDevice(d.id);
  devices.setPhone(d.id, null);
  res.json({ success: true, data: deviceView(devices.get(d.id)) });
});

admin.post('/devices/:id/regenerate-key', (req, res) => {
  const d = findDevice(req, res);
  if (!d) return;
  res.json({ success: true, data: deviceView(devices.regenerateKey(d.id)) });
});

admin.delete('/devices/:id', async (req, res) => {
  const d = findDevice(req, res);
  if (!d) return;
  await wa.removeDevice(d.id);
  devices.remove(d.id);
  res.json({ success: true });
});

/** Kirim manual: satu atau banyak nomor (dipisah koma / baris baru / titik koma / tab). */
admin.post('/devices/:id/test', (req, res) => {
  const d = findDevice(req, res);
  if (!d) return;
  const body = String(req.body?.body ?? '').trim();
  const raw = Array.isArray(req.body?.to) ? req.body.to.join('\n') : String(req.body?.to ?? '');
  const seen = new Set();
  const invalid = [];
  for (const part of raw.split(/[\n,;\t|]+/)) {
    if (!part.trim()) continue;
    const n = normalizePhone(part);
    if (n) seen.add(n);
    else invalid.push(part.trim());
  }
  if (!seen.size || !body) return res.status(400).json({ success: false, message: 'Nomor dan pesan wajib diisi' });
  if (seen.size > 500) return res.status(400).json({ success: false, message: 'Maksimal 500 nomor sekali kirim. Untuk lebih banyak, gunakan Blast.' });
  const ids = [...seen].map((n) => messages.enqueue(d.id, n, body, null, 'manual'));
  wa.drainQueue(d.id);
  res.json({ success: true, data: { queued: ids.length, invalid, id: ids[0] } });
});

// ---- Log pesan ----------------------------------------------------------------
admin.get('/messages', features.requireFeature('messageLog'), (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  res.json({ success: true, data: messages.recent(limit, req.query.device || null) });
});

admin.post('/messages/:id/retry', features.requireFeature('messageLog'), (req, res) => {
  const msg = messages.get(Number(req.params.id));
  if (!msg) return res.status(404).json({ success: false, message: 'Pesan tidak ditemukan' });
  messages.retry(msg.id);
  wa.drainQueue(msg.device_id);
  res.json({ success: true });
});

// ---- Modul fitur (dimuat hanya kalau aktif) -------------------------------------
admin.use('/campaigns', features.requireFeature('blast'), features.featureRouter('blast'));
admin.use('/contacts', features.requireFeature('contacts'), features.featureRouter('contacts'));
admin.use('/leads', features.requireFeature('leads'), features.featureRouter('leads'));
admin.use('/inbox', features.requireFeature('inbox'), features.featureRouter('inbox'));
admin.use('/birthday', features.requireFeature('birthday'), features.featureRouter('birthday'));
admin.use('/widgets', features.requireFeature('widget'), features.featureRouter('widget'));
admin.use('/chatbots', features.requireFeature('chatbot'), features.featureRouter('chatbot'));
admin.use('/aibot', features.requireFeature('aibot'), features.featureRouter('aibot'));
admin.use('/cs', features.requireFeature('cs'), features.featureRouter('cs'));
admin.use('/autoreply', features.requireFeature('autoreply'), features.featureRouter('autoreply'));

app.use('/admin', admin);
app.use(express.static(path.join(ROOT_DIR, 'public')));

await features.loadEnabled({ wa, features, hooks });
backup.startScheduler(wa.logger);

app.listen(PORT, HOST, async () => {
  console.log(`WhatsOrbit ${VERSION} berjalan di http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  await wa.restoreAll();
});
