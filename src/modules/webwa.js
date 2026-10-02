// Modul Web WhatsApp: tampilan percakapan (butuh fitur Pesan Masuk).
// Menggabungkan pesan masuk, pesan keluar lewat WhatsOrbit, Blast, dan pesan yang
// dikirim langsung dari HP menjadi satu percakapan per lawan bicara.
import { db, devices, getSetting, messages, setSetting, tableExists } from '../db.js';
import { normalizePhone } from '../phone.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS webwa_external (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    chat_jid  TEXT NOT NULL,
    phone     TEXT,
    body      TEXT NOT NULL,
    wa_id     TEXT UNIQUE,
    at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_webwa_ext ON webwa_external(device_id, phone, chat_jid);
  CREATE TABLE IF NOT EXISTS webwa_reads (
    device_id TEXT NOT NULL,
    chat_key  TEXT NOT NULL,
    read_at   TEXT NOT NULL,
    PRIMARY KEY (device_id, chat_key)
  );
  CREATE TABLE IF NOT EXISTS webwa_takeover (
    device_id TEXT NOT NULL,
    chat_key  TEXT NOT NULL,
    until     TEXT NOT NULL,
    PRIMARY KEY (device_id, chat_key)
  );
`);

export const DEFAULTS = { takeoverMinutes: 60 };
const loadSettings = () => ({ ...DEFAULTS, ...JSON.parse(getSetting('webwa', () => '{}')) });

/** Kunci percakapan: nomor HP kalau diketahui, kalau tidak ID chat (mis. nomor tersembunyi/grup). */
const keyOf = (phone, jid) => phone || jid;
const KEY_IN = 'COALESCE(i.phone, i.chat_jid)';
const KEY_MSG = "CASE WHEN m.to_jid LIKE '%@lid' OR m.to_jid LIKE '%@g.us' THEN m.to_jid ELSE m.to_number END";

export async function register({ router, wa, isEnabled }) {
  // ---- Pesan dari HP sendiri -----------------------------------------------------------
  wa.addOwnMessageHandler((msg) => {
    if (!isEnabled()) return;
    db.prepare('INSERT OR IGNORE INTO webwa_external (device_id, chat_jid, phone, body, wa_id, at) VALUES (?, ?, ?, ?, ?, datetime(?, \'unixepoch\'))')
      .run(msg.deviceId, msg.chatJid, msg.phone, msg.body, msg.key.id, Math.floor(msg.at / 1000));
  });

  // ---- Ambil alih: bot diam untuk chat yang sedang dibalas manusia -----------------------
  wa.addIncomingHandler({
    priority: 4, // setelah Customer Service (3), sebelum Chat Bot/Autoreply/AI
    handle(msg) {
      if (!isEnabled() || msg.handled) return;
      const t = db.prepare("SELECT 1 FROM webwa_takeover WHERE device_id = ? AND chat_key IN (?, ?) AND until > datetime('now')")
        .get(msg.deviceId, msg.phone ?? '-', msg.chatJid);
      if (t) msg.handled = true;
    },
  });

  function setTakeover(deviceId, key, minutes) {
    if (minutes > 0) {
      db.prepare(
        `INSERT INTO webwa_takeover (device_id, chat_key, until) VALUES (?, ?, datetime('now', ?))
         ON CONFLICT(device_id, chat_key) DO UPDATE SET until = excluded.until`
      ).run(deviceId, key, `+${minutes} minutes`);
    } else {
      db.prepare('DELETE FROM webwa_takeover WHERE device_id = ? AND chat_key = ?').run(deviceId, key);
    }
  }

  // ---- Data percakapan --------------------------------------------------------------------
  const hasBlast = () => tableExists('campaign_recipients');
  const hasContacts = () => tableExists('contacts');
  const hasCs = () => tableExists('cs_tickets');

  /** Semua pesan (masuk & keluar) sebagai satu sumber: device_id, k (kunci chat), jid, dir, body, at, status. */
  function unionSql() {
    return `
      SELECT i.device_id, ${KEY_IN} AS k, i.chat_jid AS jid, i.phone, i.push_name AS name, 'in' AS dir, i.body, i.received_at AS at,
             NULL AS status, i.is_group, i.handled_by AS via
        FROM incoming_messages i
      UNION ALL
      SELECT m.device_id, ${KEY_MSG}, COALESCE(m.to_jid, m.to_number || '@s.whatsapp.net'), CASE WHEN m.to_jid LIKE '%@lid' THEN NULL ELSE m.to_number END,
             NULL, 'out', m.body, COALESCE(m.sent_at, m.created_at), m.status, CASE WHEN m.to_jid LIKE '%@g.us' THEN 1 ELSE 0 END, m.kind
        FROM messages m WHERE m.kind != 'internal'
      UNION ALL
      SELECT e.device_id, COALESCE(e.phone, e.chat_jid), e.chat_jid, e.phone, NULL, 'out', e.body, e.at, 'sent',
             CASE WHEN e.chat_jid LIKE '%@g.us' THEN 1 ELSE 0 END, 'hp'
        FROM webwa_external e
      ${hasBlast() ? `UNION ALL
      SELECT r.device_id, r.phone, r.phone || '@s.whatsapp.net', r.phone, NULL, 'out', r.body, r.sent_at, r.status, 0, 'blast'
        FROM campaign_recipients r WHERE r.sent_at IS NOT NULL AND r.body IS NOT NULL` : ''}`;
  }

  router.get('/chats', (req, res) => {
    const device = String(req.query.device ?? '');
    const groups = req.query.groups === '1';
    const q = String(req.query.q ?? '').trim();
    const params = [];
    let where = 'WHERE 1=1';
    if (device) { where += ' AND u.device_id = ?'; params.push(device); }
    where += groups ? ' AND u.is_group = 1' : ' AND u.is_group = 0';
    const contactJoin = hasContacts() ? 'LEFT JOIN contacts c ON c.phone = g.phone' : '';
    const contactName = hasContacts() ? 'c.name' : 'NULL';
    let sql = `
      WITH u AS (${unionSql()}),
      g AS (
        SELECT u.device_id, u.k,
               MAX(u.at) AS last_at,
               MAX(u.phone) AS phone,
               (SELECT x.jid FROM u x WHERE x.device_id = u.device_id AND x.k = u.k AND x.dir = 'in' ORDER BY x.at DESC LIMIT 1) AS in_jid,
               (SELECT x.name FROM u x WHERE x.device_id = u.device_id AND x.k = u.k AND x.name IS NOT NULL AND x.name != '' ORDER BY x.at DESC LIMIT 1) AS push_name,
               (SELECT x.body FROM u x WHERE x.device_id = u.device_id AND x.k = u.k ORDER BY x.at DESC LIMIT 1) AS last_body,
               (SELECT x.dir FROM u x WHERE x.device_id = u.device_id AND x.k = u.k ORDER BY x.at DESC LIMIT 1) AS last_dir,
               SUM(u.dir = 'in' AND u.at > COALESCE((SELECT r.read_at FROM webwa_reads r WHERE r.device_id = u.device_id AND r.chat_key = u.k), '')) AS unread
          FROM u ${where} GROUP BY u.device_id, u.k
      )
      SELECT g.*, ${contactName} AS contact_name, d.name AS device_name,
             (SELECT until FROM webwa_takeover t WHERE t.device_id = g.device_id AND t.chat_key = g.k AND t.until > datetime('now')) AS takeover_until
        FROM g ${contactJoin} LEFT JOIN devices d ON d.id = g.device_id`;
    if (q) {
      const digits = q.replace(/\D/g, '').replace(/^0/, '');
      sql += ` WHERE (COALESCE(${contactName}, '') LIKE ? OR COALESCE(g.push_name, '') LIKE ? OR g.last_body LIKE ?${digits.length >= 3 ? ' OR g.k LIKE ?' : ''})`;
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      if (digits.length >= 3) params.push(`%${digits}%`);
    }
    sql += ' ORDER BY g.last_at DESC LIMIT 200';
    const rows = db.prepare(sql).all(...params);
    res.json({ success: true, data: rows, totalUnread: rows.reduce((s, r) => s + (r.unread ?? 0), 0) });
  });

  router.get('/thread', (req, res) => {
    const device = String(req.query.device ?? '');
    const key = String(req.query.key ?? '');
    if (!device || !key) return res.status(400).json({ success: false, message: 'Chat tidak valid' });
    const items = db.prepare(`WITH u AS (${unionSql()}) SELECT * FROM u WHERE u.device_id = ? AND u.k = ? ORDER BY u.at DESC LIMIT 300`)
      .all(device, key).reverse();
    // Tandai sudah dibaca
    db.prepare(
      `INSERT INTO webwa_reads (device_id, chat_key, read_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(device_id, chat_key) DO UPDATE SET read_at = excluded.read_at`
    ).run(device, key);
    const phone = /^\d+$/.test(key) ? key : null;
    const contact = phone && hasContacts() ? db.prepare('SELECT id, name, fields FROM contacts WHERE phone = ?').get(phone) : null;
    const ticket = hasCs()
      ? db.prepare(
          `SELECT t.id, a.name AS agent_name FROM cs_tickets t LEFT JOIN cs_agents a ON a.id = t.agent_id
            WHERE t.device_id = ? AND t.status = 'open' AND (t.phone = ? OR t.chat_jid = ?) ORDER BY t.id DESC LIMIT 1`
        ).get(device, phone ?? '-', key)
      : null;
    const takeover = db.prepare("SELECT until FROM webwa_takeover WHERE device_id = ? AND chat_key = ? AND until > datetime('now')").get(device, key);
    res.json({
      success: true,
      data: {
        items,
        contact: contact ? { ...contact, fields: JSON.parse(contact.fields) } : null,
        ticket: ticket ?? null,
        takeoverUntil: takeover?.until ?? null,
        takeoverMinutes: loadSettings().takeoverMinutes,
      },
    });
  });

  /** Balas / kirim pesan dari Web WhatsApp. */
  router.post('/send', (req, res) => {
    const device = devices.get(String(req.body?.device ?? ''));
    if (!device) return res.status(400).json({ success: false, message: 'Pilih device' });
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ success: false, message: 'Pesan kosong' });
    let key = String(req.body?.key ?? '').trim();
    // Chat baru: nomor diketik
    if (!key && req.body?.phone) {
      const p = normalizePhone(req.body.phone);
      if (!p) return res.status(400).json({ success: false, message: 'Nomor tidak valid' });
      key = p;
    }
    if (!key) return res.status(400).json({ success: false, message: 'Chat tidak valid' });

    // ID chat terakhir dari lawan bicara (supaya balasan masuk ke chat yang sama, termasuk nomor tersembunyi)
    const lastIn = db.prepare('SELECT chat_jid FROM incoming_messages WHERE device_id = ? AND COALESCE(phone, chat_jid) = ? ORDER BY id DESC LIMIT 1')
      .get(device.id, key);
    const jid = lastIn?.chat_jid ?? (key.includes('@') ? key : null);
    const to = /^\d+$/.test(key) ? key : key.split('@')[0];

    // Kalau chat sedang ditangani Customer Service: lewat tiket (tercatat & petugas diberi tahu)
    if (hasCs()) {
      const t = db.prepare("SELECT id FROM cs_tickets WHERE device_id = ? AND status = 'open' AND (phone = ? OR chat_jid = ?) ORDER BY id DESC LIMIT 1")
        .get(device.id, /^\d+$/.test(key) ? key : '-', jid ?? key);
      if (t) return res.json({ success: true, data: { viaTicket: t.id } });
    }

    // Belum pernah chat = pesan yang kita mulai (ikut kuota anti-banned); sudah pernah = balasan
    messages.enqueue(device.id, to, text, jid, lastIn ? 'reply' : 'manual');
    const s = loadSettings();
    if (req.body?.takeover !== false && s.takeoverMinutes > 0) setTakeover(device.id, key, s.takeoverMinutes);
    wa.drainQueue(device.id);
    res.json({ success: true, data: { key } });
  });

  router.post('/takeover', (req, res) => {
    const device = String(req.body?.device ?? '');
    const key = String(req.body?.key ?? '');
    const minutes = Math.max(0, Math.min(7 * 24 * 60, Number.parseInt(req.body?.minutes, 10) || 0));
    setTakeover(device, key, minutes);
    res.json({ success: true });
  });

  router.get('/settings', (_req, res) => res.json({ success: true, data: loadSettings() }));
  router.put('/settings', (req, res) => {
    const m = Math.max(0, Math.min(1440, Number.parseInt(req.body?.takeoverMinutes, 10) || 0));
    setSetting('webwa', JSON.stringify({ takeoverMinutes: m }));
    res.json({ success: true, data: loadSettings() });
  });

  const cleanup = () => {
    db.prepare("DELETE FROM webwa_takeover WHERE until < datetime('now')").run();
    db.prepare("DELETE FROM webwa_external WHERE at < datetime('now', '-90 days')").run();
  };
  cleanup();
  setInterval(cleanup, 6 * 3600 * 1000).unref();
}
