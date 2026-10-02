// Modul Pesan Masuk: hanya dimuat kalau fitur "inbox" aktif.
import { db, devices, messages } from '../db.js';

const KEEP_DAYS = 90;

db.exec(`
  CREATE TABLE IF NOT EXISTS incoming_messages (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id        TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    chat_jid         TEXT NOT NULL,
    phone            TEXT,
    push_name        TEXT NOT NULL DEFAULT '',
    body             TEXT NOT NULL,
    msg_type         TEXT NOT NULL,
    is_group         INTEGER NOT NULL DEFAULT 0,
    autoreply_rule_id INTEGER,
    replied_at       TEXT,
    received_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_incoming_received ON incoming_messages(received_at);
  CREATE INDEX IF NOT EXISTS idx_incoming_chat ON incoming_messages(chat_jid);
`);
// Kolom penanda "ditangani oleh" (mis. Chat Bot)
if (!db.prepare('PRAGMA table_info(incoming_messages)').all().some((c) => c.name === 'handled_by')) {
  db.exec('ALTER TABLE incoming_messages ADD COLUMN handled_by TEXT');
}

const cleanup = () =>
  db.prepare(`DELETE FROM incoming_messages WHERE received_at < datetime('now', '-${KEEP_DAYS} days')`).run();

export async function register({ router, wa, isEnabled }) {
  cleanup();
  setInterval(cleanup, 24 * 3600 * 1000).unref();

  // Catat dulu (prioritas 10), sebelum Autoreply (prioritas 20) membalas
  wa.addIncomingHandler({
    priority: 10,
    handle(msg) {
      if (!isEnabled() || msg.internal) return; // mis. perintah/balasan petugas CS
      const r = db
        .prepare(
          `INSERT INTO incoming_messages (device_id, chat_jid, phone, push_name, body, msg_type, is_group, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime(?, 'unixepoch'))`
        )
        .run(msg.deviceId, msg.chatJid, msg.phone, msg.pushName, msg.body, msg.msgType, msg.isGroup ? 1 : 0, Math.floor(msg.at / 1000));
      msg.inboxId = Number(r.lastInsertRowid);
    },
  });

  // ---- API admin ------------------------------------------------------------------
  router.get('/stats', (_req, res) => {
    const today = db.prepare("SELECT COUNT(*) AS n FROM incoming_messages WHERE date(received_at, 'localtime') = date('now', 'localtime')").get().n;
    const auto = db.prepare("SELECT COUNT(*) AS n FROM incoming_messages WHERE autoreply_rule_id IS NOT NULL AND date(received_at, 'localtime') = date('now', 'localtime')").get().n;
    res.json({ success: true, data: { today, autoToday: auto, keepDays: KEEP_DAYS } });
  });

  router.get('/', (req, res) => {
    const w = [];
    const p = [];
    if (req.query.device) { w.push('i.device_id = ?'); p.push(req.query.device); }
    if (req.query.filter === 'unreplied') w.push('i.autoreply_rule_id IS NULL AND i.replied_at IS NULL AND i.handled_by IS NULL');
    if (req.query.filter === 'auto') w.push('(i.autoreply_rule_id IS NOT NULL OR i.handled_by IS NOT NULL)');
    if (req.query.groups !== '1') w.push('i.is_group = 0');
    const q = String(req.query.q ?? '').trim();
    if (q) {
      const digits = q.replace(/\D/g, '').replace(/^0/, '');
      w.push(`(i.body LIKE ? OR i.push_name LIKE ?${digits.length >= 3 ? ' OR i.phone LIKE ?' : ''})`);
      p.push(`%${q}%`, `%${q}%`);
      if (digits.length >= 3) p.push(`%${digits}%`);
    }
    const sql = w.length ? `WHERE ${w.join(' AND ')}` : '';
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM incoming_messages i ${sql}`).get(...p).n;
    const hasRules = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='autoreply_rules'").get();
    const hasContacts = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='contacts'").get();
    const rows = db
      .prepare(
        `SELECT i.*, d.name AS device_name
                ${hasRules ? ', r.name AS rule_name' : ''}
                ${hasContacts ? ', c.name AS contact_name' : ''}
           FROM incoming_messages i
           LEFT JOIN devices d ON d.id = i.device_id
           ${hasRules ? 'LEFT JOIN autoreply_rules r ON r.id = i.autoreply_rule_id' : ''}
           ${hasContacts ? 'LEFT JOIN contacts c ON c.phone = i.phone' : ''}
           ${sql} ORDER BY i.id DESC LIMIT ? OFFSET ?`
      )
      .all(...p, limit, offset);
    res.json({ success: true, data: rows, total, limit, offset });
  });

  /** Balas manual dari dashboard (masuk antrean kirim biasa). */
  router.post('/:id/reply', (req, res) => {
    const m = db.prepare('SELECT * FROM incoming_messages WHERE id = ?').get(Number(req.params.id));
    if (!m) return res.status(404).json({ success: false, message: 'Pesan tidak ditemukan' });
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ success: false, message: 'Isi balasan wajib diisi' });
    if (!devices.get(m.device_id)) return res.status(400).json({ success: false, message: 'Device sudah dihapus' });
    const id = messages.enqueue(m.device_id, m.phone ?? m.chat_jid.split('@')[0], text, m.chat_jid);
    db.prepare("UPDATE incoming_messages SET replied_at = datetime('now') WHERE id = ?").run(m.id);
    wa.drainQueue(m.device_id);
    res.json({ success: true, data: { id } });
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM incoming_messages WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true });
  });
}
