import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { DATA_DIR } from './config.js';

mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(`${DATA_DIR}/whatsorbit.db`);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    api_key    TEXT NOT NULL UNIQUE,
    phone      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    to_number  TEXT NOT NULL,
    body       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
    attempts   INTEGER NOT NULL DEFAULT 0,
    error      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_messages_queue ON messages(device_id, status, id);
`);

// Migrasi: kirim ke ID chat langsung (balasan pesan masuk, termasuk pengirim ber-ID LID)
if (!db.prepare('PRAGMA table_info(messages)').all().some((c) => c.name === 'to_jid')) {
  db.exec('ALTER TABLE messages ADD COLUMN to_jid TEXT');
}
// Migrasi: ID pesan WhatsApp yang terkirim (untuk mengenali balasan "kutip", mis. Customer Service)
if (!db.prepare('PRAGMA table_info(messages)').all().some((c) => c.name === 'wa_id')) {
  db.exec('ALTER TABLE messages ADD COLUMN wa_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(wa_id)');
}

export function getSetting(key, createDefault) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return row.value;
  const value = createDefault();
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
  return value;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export const tableExists = (name) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

export const newApiKey = () => randomUUID();

export const devices = {
  all: () => db.prepare('SELECT * FROM devices ORDER BY created_at').all(),
  get: (id) => db.prepare('SELECT * FROM devices WHERE id = ?').get(id),
  byApiKey: (key) => db.prepare('SELECT * FROM devices WHERE api_key = ?').get(key),
  create(name) {
    const id = randomBytes(6).toString('hex');
    db.prepare('INSERT INTO devices (id, name, api_key) VALUES (?, ?, ?)').run(id, name, newApiKey());
    return devices.get(id);
  },
  rename: (id, name) => db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(name, id),
  setPhone: (id, phone) => db.prepare('UPDATE devices SET phone = ? WHERE id = ?').run(phone, id),
  regenerateKey(id) {
    db.prepare('UPDATE devices SET api_key = ? WHERE id = ?').run(newApiKey(), id);
    return devices.get(id);
  },
  remove: (id) => db.prepare('DELETE FROM devices WHERE id = ?').run(id),
};

export const messages = {
  /** `jid` opsional: kirim langsung ke ID chat ini (tanpa cek nomor). */
  enqueue(deviceId, to, body, jid = null) {
    const r = db
      .prepare('INSERT INTO messages (device_id, to_number, body, to_jid) VALUES (?, ?, ?, ?)')
      .run(deviceId, to, body, jid);
    return Number(r.lastInsertRowid);
  },
  get: (id) => db.prepare('SELECT * FROM messages WHERE id = ?').get(id),
  nextPending: (deviceId) =>
    db
      .prepare("SELECT * FROM messages WHERE device_id = ? AND status = 'pending' ORDER BY id LIMIT 1")
      .get(deviceId),
  markSent: (id, waId = null) =>
    db
      .prepare("UPDATE messages SET status = 'sent', attempts = attempts + 1, error = NULL, sent_at = datetime('now'), wa_id = ? WHERE id = ?")
      .run(waId, id),
  byWaId: (waId) => db.prepare('SELECT * FROM messages WHERE wa_id = ?').get(waId),
  markAttemptFailed(id, error, maxAttempts) {
    db.prepare(
      `UPDATE messages
          SET attempts = attempts + 1,
              error = ?,
              status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END
        WHERE id = ?`
    ).run(error, maxAttempts, id);
  },
  markFailed: (id, error) =>
    db.prepare("UPDATE messages SET status = 'failed', attempts = attempts + 1, error = ? WHERE id = ?").run(error, id),
  retry: (id) => db.prepare("UPDATE messages SET status = 'pending', attempts = 0, error = NULL WHERE id = ?").run(id),
  recent: (limit = 100, deviceId = null) =>
    deviceId
      ? db.prepare('SELECT * FROM messages WHERE device_id = ? ORDER BY id DESC LIMIT ?').all(deviceId, limit)
      : db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?').all(limit),
  stats: () =>
    db
      .prepare('SELECT device_id, status, COUNT(*) AS n FROM messages GROUP BY device_id, status')
      .all(),
};
