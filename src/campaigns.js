import { db } from './db.js';
import { parseTable } from './tabular.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    template         TEXT NOT NULL,
    device_ids       TEXT NOT NULL,              -- JSON array
    status           TEXT NOT NULL DEFAULT 'draft', -- draft | running | paused | done | cancelled
    delay_min_s      INTEGER NOT NULL DEFAULT 20,
    delay_max_s      INTEGER NOT NULL DEFAULT 60,
    batch_size       INTEGER NOT NULL DEFAULT 15,
    rest_min_m       INTEGER NOT NULL DEFAULT 5,
    rest_max_m       INTEGER NOT NULL DEFAULT 15,
    daily_limit      INTEGER NOT NULL DEFAULT 100, -- per device per hari
    hour_start       INTEGER NOT NULL DEFAULT 8,
    hour_end         INTEGER NOT NULL DEFAULT 20,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    started_at       TEXT,
    finished_at      TEXT
  );

  CREATE TABLE IF NOT EXISTS campaign_recipients (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    phone       TEXT NOT NULL,
    vars        TEXT NOT NULL DEFAULT '{}',      -- JSON {kolom: nilai}
    status      TEXT NOT NULL DEFAULT 'pending', -- pending | sending | sent | failed
    device_id   TEXT,
    body        TEXT,
    error       TEXT,
    sent_at     TEXT,
    UNIQUE (campaign_id, phone)
  );

  CREATE INDEX IF NOT EXISTS idx_recipients_queue ON campaign_recipients(campaign_id, status, id);
  CREATE INDEX IF NOT EXISTS idx_recipients_daily ON campaign_recipients(device_id, sent_at);

  -- Kalau server mati di tengah kirim, kembalikan ke antrean
  UPDATE campaign_recipients SET status = 'pending', device_id = NULL WHERE status = 'sending';
`);

const SETTINGS = ['delay_min_s', 'delay_max_s', 'batch_size', 'rest_min_m', 'rest_max_m', 'daily_limit', 'hour_start', 'hour_end'];
export const DEFAULT_SETTINGS = {
  delay_min_s: 20, delay_max_s: 60, batch_size: 15, rest_min_m: 5, rest_max_m: 15,
  daily_limit: 100, hour_start: 8, hour_end: 20,
};

// Template (spintax + placeholder): lihat template.js
export { render, spin } from './template.js';

// Daftar penerima: lihat tabular.js
export const parseRecipients = parseTable;

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
function clampSettings(input = {}) {
  const s = {};
  for (const k of SETTINGS) {
    const v = Number.parseInt(input[k], 10);
    s[k] = Number.isFinite(v) && v >= 0 ? v : DEFAULT_SETTINGS[k];
  }
  s.delay_min_s = Math.max(5, s.delay_min_s);
  s.delay_max_s = Math.max(s.delay_min_s, s.delay_max_s);
  s.rest_max_m = Math.max(s.rest_min_m, s.rest_max_m);
  s.batch_size = Math.max(1, s.batch_size);
  s.daily_limit = Math.max(1, s.daily_limit);
  s.hour_start = Math.min(23, s.hour_start);
  s.hour_end = Math.min(24, Math.max(s.hour_start + 1, s.hour_end));
  return s;
}

export const campaigns = {
  create({ name, template, deviceIds, recipients, settings }) {
    const s = clampSettings(settings);
    db.exec('BEGIN');
    try {
      const r = db
        .prepare(
          `INSERT INTO campaigns (name, template, device_ids, ${SETTINGS.join(', ')})
           VALUES (?, ?, ?, ${SETTINGS.map(() => '?').join(', ')})`
        )
        .run(name, template, JSON.stringify(deviceIds), ...SETTINGS.map((k) => s[k]));
      const id = Number(r.lastInsertRowid);
      const ins = db.prepare('INSERT OR IGNORE INTO campaign_recipients (campaign_id, phone, vars) VALUES (?, ?, ?)');
      for (const rec of recipients) ins.run(id, rec.phone, JSON.stringify(rec.vars));
      db.exec('COMMIT');
      return id;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  get(id) {
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
    return c && withCounts(c);
  },

  all: () => db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all().map(withCounts),

  running: () =>
    db.prepare("SELECT * FROM campaigns WHERE status = 'running' ORDER BY started_at, id").all()
      .map((c) => ({ ...c, device_ids: JSON.parse(c.device_ids) })),

  recipients: (id, limit = 2000) =>
    db.prepare('SELECT * FROM campaign_recipients WHERE campaign_id = ? ORDER BY id LIMIT ?').all(id, limit),

  setStatus(id, status) {
    const extra = status === 'running'
      ? ", started_at = COALESCE(started_at, datetime('now')), finished_at = NULL"
      : status === 'done' || status === 'cancelled'
        ? ", finished_at = datetime('now')"
        : '';
    db.prepare(`UPDATE campaigns SET status = ?${extra} WHERE id = ?`).run(status, id);
  },

  retryFailed: (id) =>
    db.prepare("UPDATE campaign_recipients SET status = 'pending', error = NULL, device_id = NULL WHERE campaign_id = ? AND status = 'failed'").run(id),

  remove: (id) => db.prepare('DELETE FROM campaigns WHERE id = ?').run(id),

  /** Ambil satu penerima berikutnya untuk device ini (status jadi 'sending'). */
  claim(campaignId, deviceId) {
    const r = db
      .prepare("SELECT * FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending' ORDER BY id LIMIT 1")
      .get(campaignId);
    if (!r) return null;
    db.prepare("UPDATE campaign_recipients SET status = 'sending', device_id = ? WHERE id = ?").run(deviceId, r.id);
    return { ...r, vars: JSON.parse(r.vars) };
  },

  markSent: (rid, body) =>
    db.prepare("UPDATE campaign_recipients SET status = 'sent', body = ?, error = NULL, sent_at = datetime('now') WHERE id = ?").run(body, rid),

  markFailed: (rid, body, error) =>
    db.prepare("UPDATE campaign_recipients SET status = 'failed', body = ?, error = ?, sent_at = datetime('now') WHERE id = ?").run(body, error, rid),

  /** Kembalikan ke antrean (mis. koneksi putus saat mengirim). */
  release: (rid) => db.prepare("UPDATE campaign_recipients SET status = 'pending', device_id = NULL WHERE id = ?").run(rid),

  /** Jumlah pesan blast terkirim device ini hari ini (waktu lokal PC). */
  sentToday: (deviceId) =>
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM campaign_recipients
          WHERE device_id = ? AND status IN ('sent', 'failed')
            AND date(sent_at, 'localtime') = date('now', 'localtime')`
      )
      .get(deviceId).n,

  /** Tandai selesai kalau tidak ada lagi yang menunggu. */
  finishIfDone(id) {
    const left = db
      .prepare("SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? AND status IN ('pending', 'sending')")
      .get(id).n;
    if (left === 0) campaigns.setStatus(id, 'done');
  },
};

function withCounts(c) {
  const counts = { pending: 0, sending: 0, sent: 0, failed: 0 };
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? GROUP BY status').all(c.id)) {
    counts[row.status] = row.n;
  }
  counts.total = counts.pending + counts.sending + counts.sent + counts.failed;
  return { ...c, device_ids: JSON.parse(c.device_ids), counts };
}
