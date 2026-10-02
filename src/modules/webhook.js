// Modul Webhook: teruskan peristiwa WhatsOrbit (pesan masuk, status kirim, status device,
// anggota grup, lead, tiket CS) ke URL aplikasi lain. Ditandatangani HMAC-SHA256,
// dikirim ulang otomatis dengan jeda bertahap, dan tercatat di log pengiriman.
import { createHmac, randomBytes } from 'node:crypto';
import { db, devices, messages } from '../db.js';
import { bus } from '../events.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS webhooks (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL,
    url                  TEXT NOT NULL,
    secret               TEXT NOT NULL,
    device_ids           TEXT NOT NULL DEFAULT '[]',   -- [] = semua device
    events               TEXT NOT NULL DEFAULT '[]',
    active               INTEGER NOT NULL DEFAULT 1,
    include_groups       INTEGER NOT NULL DEFAULT 0,
    allow_reply          INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    paused_reason        TEXT,
    last_success_at      TEXT,
    last_failure_at      TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint_id  INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event        TEXT NOT NULL,
    event_id     TEXT NOT NULL,
    payload      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',      -- pending | ok | failed
    attempts     INTEGER NOT NULL DEFAULT 0,
    next_at      INTEGER NOT NULL,                     -- epoch ms
    last_code    INTEGER,
    last_error   TEXT,
    response     TEXT,
    duration_ms  INTEGER,
    replied      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    delivered_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_wh_deliv_due ON webhook_deliveries (status, next_at);
  CREATE INDEX IF NOT EXISTS idx_wh_deliv_ep ON webhook_deliveries (endpoint_id, id);
`);

/** Peristiwa yang bisa dipilih per endpoint. */
export const EVENTS = [
  { key: 'message.incoming', label: 'Pesan masuk', desc: 'Pesan WhatsApp yang diterima device (setelah bot/autoreply memprosesnya).' },
  { key: 'message.status', label: 'Status pesan keluar', desc: 'Pesan dari antrean terkirim (sent) atau gagal (failed).' },
  { key: 'device.status', label: 'Status device', desc: 'Device tersambung, terputus, logout, atau menunggu scan QR.' },
  { key: 'group.participants', label: 'Anggota grup', desc: 'Anggota masuk, keluar, dijadikan / dicabut admin.' },
  { key: 'lead.created', label: 'Lead baru', desc: 'Lead baru dari Google Form / Spreadsheet / API (fitur Daily Leads).' },
  { key: 'cs.ticket', label: 'Tiket Customer Service', desc: 'Tiket CS dibuka atau ditutup.' },
  { key: 'payment', label: 'Pembayaran Lynk.id / Mayar.id', desc: 'Notifikasi pembayaran, pengingat bayar, dan membership dari Lynk.id / Mayar.id.' },
];
const EVENT_KEYS = EVENTS.map((e) => e.key);

const MAX_ATTEMPTS = 6;
const BACKOFF_S = [30, 120, 600, 1800, 7200, 21600]; // 30 dtk, 2 mnt, 10 mnt, 30 mnt, 2 jam, 6 jam
const TIMEOUT_MS = 10_000;
const AUTO_PAUSE_AFTER = 25; // gagal berturut-turut (setelah semua percobaan ulang)
const KEEP_DAYS = 14;
const UA = 'WhatsOrbit-Webhook/1.0';

const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;
const newEventId = () => `evt_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
const parseJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

const hydrate = (w) => w && {
  ...w,
  device_ids: parseJson(w.device_ids, []),
  events: parseJson(w.events, []),
  active: !!w.active,
  include_groups: !!w.include_groups,
  allow_reply: !!w.allow_reply,
};
const endpointById = (id) => hydrate(db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id));
const allEndpoints = () => db.prepare('SELECT * FROM webhooks ORDER BY id').all().map(hydrate);

/** Tanda tangan: hex(HMAC-SHA256(secret, `${timestamp}.${body}`)). */
export function sign(secret, timestamp, body) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function validUrl(u) {
  try {
    const x = new URL(String(u).trim());
    return ['http:', 'https:'].includes(x.protocol) ? x.toString() : null;
  } catch {
    return null;
  }
}

function deviceInfo(id) {
  const d = id ? devices.get(id) : null;
  return d ? { id: d.id, name: d.name, phone: d.phone ?? null } : id ? { id, name: null, phone: null } : null;
}

const groupName = (deviceId, jid) => {
  try {
    return db.prepare('SELECT subject FROM group_names WHERE device_id = ? AND jid = ?').get(deviceId, jid)?.subject ?? null;
  } catch {
    return null; // tabel belum ada (Group Greeter / Web WhatsApp belum pernah aktif)
  }
};

/** Ubah peristiwa internal jadi data webhook yang rapi. */
function shape(event, p) {
  switch (event) {
    case 'message.incoming':
      return {
        id: p.key?.id ?? null,
        chatJid: p.chatJid,
        from: p.phone ?? null,
        senderJid: p.senderJid ?? null,
        name: p.pushName ?? '',
        text: p.text ?? '',
        body: p.body ?? '',
        type: p.msgType,
        isGroup: !!p.isGroup,
        groupName: p.isGroup ? groupName(p.deviceId, p.chatJid) : null,
        quotedId: p.quotedId ?? null,
        handled: !!p.handled,
        timestamp: new Date(p.at || Date.now()).toISOString(),
      };
    case 'group.participants':
      return {
        groupJid: p.groupJid,
        groupName: groupName(p.deviceId, p.groupJid),
        action: p.action,
        participants: (p.participants ?? []).map((x) => ({ jid: x.jid, phone: x.phone ?? null })),
        author: p.author ?? null,
      };
    default: {
      const { deviceId, ...rest } = p;
      return rest;
    }
  }
}

function matches(w, event, p) {
  if (!w.active || !w.events.includes(event)) return false;
  if (w.device_ids.length && !w.device_ids.includes(p.deviceId)) return false;
  if (event === 'message.incoming' && p.isGroup && !w.include_groups) return false;
  return true;
}

function buildPayload(event, deviceId, data) {
  return { id: newEventId(), event, timestamp: new Date().toISOString(), device: deviceInfo(deviceId), data };
}

function insertDelivery(endpointId, payload, nextAt = Date.now()) {
  const r = db.prepare('INSERT INTO webhook_deliveries (endpoint_id, event, event_id, payload, next_at) VALUES (?, ?, ?, ?, ?)')
    .run(endpointId, payload.event, payload.id, JSON.stringify(payload), nextAt);
  return Number(r.lastInsertRowid);
}

/** Kirim satu payload ke satu endpoint. Tidak melempar error. */
async function post(w, body) {
  const ts = Math.floor(Date.now() / 1000);
  const evt = parseJson(body, {});
  const started = Date.now();
  try {
    const res = await fetch(w.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        'X-WhatsOrbit-Event': evt.event ?? '',
        'X-WhatsOrbit-Delivery': evt.id ?? '',
        'X-WhatsOrbit-Timestamp': String(ts),
        'X-WhatsOrbit-Signature': `sha256=${sign(w.secret, ts, body)}`,
        'ngrok-skip-browser-warning': '1',
      },
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = (await res.text().catch(() => '')).slice(0, 4000);
    return { ok: res.ok, code: res.status, text, error: res.ok ? null : `HTTP ${res.status}`, ms: Date.now() - started };
  } catch (err) {
    const msg = err?.name === 'TimeoutError' ? `Timeout ${TIMEOUT_MS / 1000} detik` : (err?.cause?.code ?? err?.message ?? String(err));
    return { ok: false, code: null, text: null, error: String(msg), ms: Date.now() - started };
  }
}

/**
 * Balasan lewat respons: {"reply": "teks"} atau {"reply": ["teks 1", "teks 2"]}.
 * Hanya untuk pesan masuk dan kalau endpoint mengizinkan.
 */
function replyFromResponse(w, payload, text) {
  if (!w.allow_reply || payload.event !== 'message.incoming' || !text) return 0;
  const r = parseJson(text, null)?.reply;
  const list = (Array.isArray(r) ? r : [r]).filter((x) => typeof x === 'string' && x.trim()).slice(0, 3);
  const chat = payload.data?.chatJid;
  const deviceId = payload.device?.id;
  if (!list.length || !chat || !deviceId) return 0;
  const to = payload.data.from ?? chat.split('@')[0];
  for (const t of list) messages.enqueue(deviceId, to, t.trim().slice(0, 4000), chat, 'reply');
  return list.length;
}

export async function register({ router, wa, isEnabled }) {
  // ---- Penerima peristiwa -------------------------------------------------------------------
  for (const event of EVENT_KEYS) {
    bus.on(event, (p) => {
      if (!isEnabled() || !p) return;
      try {
        const targets = allEndpoints().filter((w) => matches(w, event, p));
        if (!targets.length) return;
        const payload = buildPayload(event, p.deviceId, shape(event, p));
        for (const w of targets) insertDelivery(w.id, payload);
        kick();
      } catch (err) {
        wa.logger.warn({ event, err: err?.message }, 'webhook: gagal mencatat peristiwa');
      }
    });
  }

  // ---- Pekerja pengiriman -------------------------------------------------------------------
  const inflight = new Set();
  let running = false;
  let again = false;

  async function work() {
    if (running) return void (again = true);
    running = true;
    try {
      do {
        again = false;
        if (!isEnabled()) break;
        const due = db.prepare(
          `SELECT d.* FROM webhook_deliveries d JOIN webhooks w ON w.id = d.endpoint_id
            WHERE d.status = 'pending' AND d.next_at <= ? AND w.active = 1 ORDER BY d.id LIMIT 20`
        ).all(Date.now()).filter((d) => !inflight.has(d.id));
        // Per endpoint berurutan (urutan peristiwa terjaga), antar endpoint paralel
        const byEp = new Map();
        for (const d of due) byEp.set(d.endpoint_id, [...(byEp.get(d.endpoint_id) ?? []), d]);
        await Promise.all([...byEp.values()].map(async (list) => {
          for (const d of list) await deliver(d);
        }));
        if (due.length === 20) again = true;
      } while (again);
    } finally {
      running = false;
    }
  }
  const kick = () => setImmediate(() => work().catch((err) => wa.logger.error({ err: err?.message }, 'webhook worker')));

  async function deliver(d) {
    const w = endpointById(d.endpoint_id);
    if (!w?.active) return;
    inflight.add(d.id);
    try {
      const r = await post(w, d.payload);
      const attempts = d.attempts + 1;
      if (r.ok) {
        const replied = d.replied ? 0 : replyFromResponse(w, parseJson(d.payload, {}), r.text);
        db.prepare(
          `UPDATE webhook_deliveries SET status = 'ok', attempts = ?, last_code = ?, last_error = NULL, response = ?, duration_ms = ?,
                  replied = replied + ?, delivered_at = datetime('now') WHERE id = ?`
        ).run(attempts, r.code, r.text, r.ms, replied, d.id);
        db.prepare("UPDATE webhooks SET consecutive_failures = 0, last_success_at = datetime('now') WHERE id = ?").run(w.id);
        if (replied) wa.drainQueue?.(parseJson(d.payload, {}).device?.id);
        return;
      }
      // 410 Gone = penerima minta berhenti; selain itu coba lagi dengan jeda bertahap
      const final = attempts >= MAX_ATTEMPTS || r.code === 410;
      db.prepare(
        `UPDATE webhook_deliveries SET status = ?, attempts = ?, next_at = ?, last_code = ?, last_error = ?, response = ?, duration_ms = ? WHERE id = ?`
      ).run(final ? 'failed' : 'pending', attempts, Date.now() + BACKOFF_S[Math.min(attempts - 1, BACKOFF_S.length - 1)] * 1000,
        r.code, r.error, r.text, r.ms, d.id);
      db.prepare("UPDATE webhooks SET last_failure_at = datetime('now') WHERE id = ?").run(w.id);
      if (final) {
        const n = db.prepare('UPDATE webhooks SET consecutive_failures = consecutive_failures + 1 WHERE id = ? RETURNING consecutive_failures')
          .get(w.id).consecutive_failures;
        const reason = r.code === 410 ? 'Penerima membalas 410 Gone'
          : n >= AUTO_PAUSE_AFTER ? `${n} pengiriman berturut-turut gagal` : null;
        if (reason) {
          db.prepare('UPDATE webhooks SET active = 0, paused_reason = ? WHERE id = ?').run(reason, w.id);
          wa.logger.warn({ endpoint: w.name, reason }, 'webhook dijeda otomatis');
        }
      }
    } finally {
      inflight.delete(d.id);
    }
  }

  setInterval(() => isEnabled() && kick(), 5000).unref();
  const cleanup = () => db.prepare(`DELETE FROM webhook_deliveries WHERE status != 'pending' AND created_at < datetime('now', ?)`).run(`-${KEEP_DAYS} days`);
  cleanup();
  setInterval(cleanup, 3600_000).unref();

  // ---- Admin API ----------------------------------------------------------------------------
  const stats = db.prepare(
    `SELECT endpoint_id,
            SUM(status = 'ok') AS ok, SUM(status = 'failed') AS failed, SUM(status = 'pending') AS pending
       FROM webhook_deliveries WHERE created_at > datetime('now', '-1 day') GROUP BY endpoint_id`
  );

  function readBody(b, current = {}) {
    const url = validUrl(b.url ?? current.url);
    if (!url) throw new Error('URL harus diawali http:// atau https://');
    const events = (Array.isArray(b.events) ? b.events : current.events ?? []).filter((e) => EVENT_KEYS.includes(e));
    if (!events.length) throw new Error('Pilih minimal satu peristiwa');
    const known = new Set(devices.all().map((d) => d.id));
    const deviceIds = (Array.isArray(b.device_ids) ? b.device_ids : current.device_ids ?? []).filter((id) => known.has(id));
    return {
      name: String(b.name ?? current.name ?? '').trim().slice(0, 80) || new URL(url).host,
      url,
      events,
      device_ids: deviceIds,
      include_groups: b.include_groups ?? current.include_groups ?? false,
      allow_reply: b.allow_reply ?? current.allow_reply ?? false,
      active: b.active ?? current.active ?? true,
    };
  }

  router.get('/', (_req, res) => {
    const s = Object.fromEntries(stats.all().map((r) => [r.endpoint_id, { ok: r.ok, failed: r.failed, pending: r.pending }]));
    res.json({
      success: true,
      data: {
        endpoints: allEndpoints().map((w) => ({ ...w, stats: s[w.id] ?? { ok: 0, failed: 0, pending: 0 } })),
        events: EVENTS,
        retry: { maxAttempts: MAX_ATTEMPTS, backoffSeconds: BACKOFF_S, timeoutSeconds: TIMEOUT_MS / 1000, keepDays: KEEP_DAYS },
      },
    });
  });

  router.post('/', (req, res) => {
    try {
      const v = readBody(req.body ?? {});
      const r = db.prepare(
        'INSERT INTO webhooks (name, url, secret, device_ids, events, active, include_groups, allow_reply) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(v.name, v.url, newSecret(), JSON.stringify(v.device_ids), JSON.stringify(v.events), v.active ? 1 : 0, v.include_groups ? 1 : 0, v.allow_reply ? 1 : 0);
      res.json({ success: true, data: endpointById(Number(r.lastInsertRowid)) });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  router.put('/:id', (req, res) => {
    const w = endpointById(Number(req.params.id));
    if (!w) return res.status(404).json({ success: false, message: 'Webhook tidak ditemukan' });
    try {
      const v = readBody(req.body ?? {}, w);
      const reactivated = v.active && !w.active;
      db.prepare(
        `UPDATE webhooks SET name = ?, url = ?, device_ids = ?, events = ?, active = ?, include_groups = ?, allow_reply = ?,
                paused_reason = CASE WHEN ? THEN NULL ELSE paused_reason END,
                consecutive_failures = CASE WHEN ? THEN 0 ELSE consecutive_failures END WHERE id = ?`
      ).run(v.name, v.url, JSON.stringify(v.device_ids), JSON.stringify(v.events), v.active ? 1 : 0, v.include_groups ? 1 : 0,
        v.allow_reply ? 1 : 0, reactivated ? 1 : 0, reactivated ? 1 : 0, w.id);
      if (reactivated) kick();
      res.json({ success: true, data: endpointById(w.id) });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM webhook_deliveries WHERE endpoint_id = ?').run(Number(req.params.id));
    db.prepare('DELETE FROM webhooks WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true });
  });

  router.post('/:id/secret', (req, res) => {
    const w = endpointById(Number(req.params.id));
    if (!w) return res.status(404).json({ success: false, message: 'Webhook tidak ditemukan' });
    db.prepare('UPDATE webhooks SET secret = ? WHERE id = ?').run(newSecret(), w.id);
    res.json({ success: true, data: endpointById(w.id) });
  });

  // Tes kirim langsung (tanpa antre & tanpa percobaan ulang), hasilnya ditampilkan
  router.post('/:id/test', async (req, res) => {
    const w = endpointById(Number(req.params.id));
    if (!w) return res.status(404).json({ success: false, message: 'Webhook tidak ditemukan' });
    const dev = w.device_ids[0] ?? devices.all()[0]?.id ?? null;
    const payload = buildPayload('webhook.test', dev, { message: 'Tes webhook dari WhatsOrbit', endpoint: w.name });
    const body = JSON.stringify(payload);
    const r = await post(w, body);
    db.prepare(
      `INSERT INTO webhook_deliveries (endpoint_id, event, event_id, payload, status, attempts, next_at, last_code, last_error, response, duration_ms, delivered_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, CASE WHEN ? THEN datetime('now') END)`
    ).run(w.id, payload.event, payload.id, body, r.ok ? 'ok' : 'failed', r.code, r.error, r.text, r.ms, r.ok ? 1 : 0);
    res.json({ success: true, data: { ok: r.ok, code: r.code, error: r.error, response: r.text, ms: r.ms } });
  });

  router.get('/deliveries', (req, res) => {
    const where = [];
    const params = [];
    if (req.query.endpoint) { where.push('d.endpoint_id = ?'); params.push(Number(req.query.endpoint)); }
    if (['ok', 'failed', 'pending'].includes(req.query.status)) { where.push('d.status = ?'); params.push(req.query.status); }
    if (EVENT_KEYS.includes(req.query.event) || req.query.event === 'webhook.test') { where.push('d.event = ?'); params.push(req.query.event); }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows = db.prepare(
      `SELECT d.id, d.endpoint_id, w.name AS endpoint, d.event, d.event_id, d.status, d.attempts, d.next_at, d.last_code, d.last_error,
              d.duration_ms, d.replied, d.created_at, d.delivered_at
         FROM webhook_deliveries d JOIN webhooks w ON w.id = d.endpoint_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.id DESC LIMIT ?`
    ).all(...params, limit);
    res.json({ success: true, data: rows });
  });

  router.get('/deliveries/:id', (req, res) => {
    const d = db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(Number(req.params.id));
    if (!d) return res.status(404).json({ success: false, message: 'Log tidak ditemukan' });
    res.json({ success: true, data: { ...d, payload: parseJson(d.payload, d.payload) } });
  });

  // Kirim ulang = salinan baru dengan isi sama (ID peristiwa sama, agar penerima bisa menyaring duplikat)
  router.post('/deliveries/:id/resend', (req, res) => {
    const d = db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(Number(req.params.id));
    if (!d) return res.status(404).json({ success: false, message: 'Log tidak ditemukan' });
    const w = endpointById(d.endpoint_id);
    if (!w?.active) return res.status(400).json({ success: false, message: 'Aktifkan webhook ini dulu' });
    const r = db.prepare('INSERT INTO webhook_deliveries (endpoint_id, event, event_id, payload, next_at, replied) VALUES (?, ?, ?, ?, ?, 1)')
      .run(d.endpoint_id, d.event, d.event_id, d.payload, Date.now());
    kick();
    res.json({ success: true, data: { id: Number(r.lastInsertRowid) } });
  });

  router.delete('/deliveries', (req, res) => {
    const ep = Number(req.query.endpoint) || null;
    const r = ep
      ? db.prepare("DELETE FROM webhook_deliveries WHERE endpoint_id = ? AND status != 'pending'").run(ep)
      : db.prepare("DELETE FROM webhook_deliveries WHERE status != 'pending'").run();
    res.json({ success: true, data: { deleted: r.changes } });
  });

  kick();
}
