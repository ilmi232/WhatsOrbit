// Modul Autoreply: hanya dimuat kalau fitur "autoreply" aktif.
import { db, devices, messages } from '../db.js';
import { render } from '../template.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS autoreply_rules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    match_type   TEXT NOT NULL DEFAULT 'contains', -- contains | exact | startsWith | regex | any
    keywords     TEXT NOT NULL DEFAULT '',          -- satu per baris
    reply        TEXT NOT NULL,
    device_ids   TEXT NOT NULL DEFAULT '[]',        -- [] = semua device
    active       INTEGER NOT NULL DEFAULT 1,
    priority     INTEGER NOT NULL DEFAULT 0,
    cooldown_min INTEGER NOT NULL DEFAULT 60,       -- jeda per pengirim untuk aturan ini
    in_groups    INTEGER NOT NULL DEFAULT 0,
    hour_start   INTEGER,                           -- null = sepanjang hari
    hour_end     INTEGER,
    hits         INTEGER NOT NULL DEFAULT 0,
    last_hit_at  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS autoreply_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id   INTEGER NOT NULL REFERENCES autoreply_rules(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    chat_jid  TEXT NOT NULL,
    at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_arlog_chat ON autoreply_log(chat_jid, rule_id, at);
`);

const MATCH_TYPES = ['contains', 'exact', 'startsWith', 'regex', 'any'];
const MAX_AGE_MS = 10 * 60 * 1000; // pesan lebih tua dari ini (mis. saat server mati) tidak dibalas
const GLOBAL_GAP_S = 20; // jeda minimum antar balasan otomatis ke chat yang sama (anti saling-balas bot)

const hydrate = (r) => r && { ...r, device_ids: JSON.parse(r.device_ids), active: !!r.active, in_groups: !!r.in_groups };
// Kata kunci: satu per baris atau dipisah koma. Regex hanya per baris (koma bisa bagian dari regex, mis. {2,4}).
const keywordList = (r) =>
  r.keywords.split(r.match_type === 'regex' ? /\r?\n/ : /\r?\n|,/).map((k) => k.trim()).filter(Boolean);
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function inHours(r, now = new Date()) {
  if (r.hour_start == null || r.hour_end == null || r.hour_start === r.hour_end) return true;
  const h = now.getHours();
  return r.hour_start < r.hour_end ? h >= r.hour_start && h < r.hour_end : h >= r.hour_start || h < r.hour_end;
}

/** Apakah teks cocok dengan aturan (tanpa cek device/jam/jeda). */
export function matches(rule, text) {
  if (rule.match_type === 'any') return true;
  const t = norm(text);
  if (!t) return false;
  const kws = keywordList(rule);
  if (rule.match_type === 'regex') {
    return kws.some((k) => {
      try { return new RegExp(k, 'i').test(text); } catch { return false; }
    });
  }
  return kws.some((k) => {
    const kw = norm(k);
    if (rule.match_type === 'exact') return t === kw;
    if (rule.match_type === 'startsWith') return t.startsWith(kw);
    return t.includes(kw);
  });
}

/** Aturan yang aktif, kata kunci dulu (urut prioritas), lalu "semua pesan" sebagai cadangan. */
const activeRules = () =>
  db.prepare("SELECT * FROM autoreply_rules WHERE active = 1 ORDER BY (match_type = 'any'), priority, id").all().map(hydrate);

/**
 * Aturan pertama yang cocok. Kalau aturan kata kunci cocok tapi masih dalam jeda untuk
 * pengirim ini, tidak dibalas sama sekali (bukan jatuh ke aturan "semua pesan").
 */
function findRule(msg, { checkCooldown = true } = {}) {
  let keywordMatched = false;
  for (const r of activeRules()) {
    if (r.device_ids.length && !r.device_ids.includes(msg.deviceId)) continue;
    if (msg.isGroup && !r.in_groups) continue;
    if (!inHours(r)) continue;
    if (r.match_type === 'any' && keywordMatched) return null;
    if (r.match_type === 'any' && msg.aiActive) continue; // AI Chat Bot yang menjawab pesan bebas
    if (r.match_type !== 'any' && !msg.text) continue;
    if (!matches(r, msg.text ?? '')) continue;
    if (checkCooldown && r.cooldown_min > 0) {
      const recent = db
        .prepare(`SELECT 1 FROM autoreply_log WHERE rule_id = ? AND chat_jid = ? AND at > datetime('now', ?)`)
        .get(r.id, msg.chatJid, `-${r.cooldown_min} minutes`);
      if (recent) {
        if (r.match_type !== 'any') keywordMatched = true;
        continue;
      }
    }
    return r;
  }
  return null;
}

/** Isi placeholder: [Nama], [Nomor], [Pesan], dan kolom data Kontak (kalau ada). */
function varsFor(msg) {
  const vars = { Nama: msg.pushName || '', Nomor: msg.phone ? '0' + msg.phone.replace(/^62/, '') : '', Pesan: msg.text ?? '' };
  if (msg.phone && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='contacts'").get()) {
    const c = db.prepare('SELECT name, fields FROM contacts WHERE phone = ?').get(msg.phone);
    if (c) Object.assign(vars, JSON.parse(c.fields), c.name ? { Nama: c.name } : {});
  }
  return vars;
}

function input(body) {
  const b = body ?? {};
  const matchType = MATCH_TYPES.includes(b.match_type) ? b.match_type : 'contains';
  const keywords = String(b.keywords ?? '').trim();
  const reply = String(b.reply ?? '').trim();
  if (!reply) throw new Error('Isi balasan wajib diisi');
  if (matchType !== 'any' && !keywords) throw new Error('Kata kunci wajib diisi');
  if (matchType === 'regex') {
    for (const k of keywords.split(/\r?\n/).filter(Boolean)) {
      try { new RegExp(k); } catch { throw new Error(`Regex tidak valid: ${k}`); }
    }
  }
  const hour = (v) => (v === '' || v == null ? null : Math.max(0, Math.min(24, Number.parseInt(v, 10) || 0)));
  const known = new Set(devices.all().map((d) => d.id));
  return {
    name: String(b.name ?? '').trim() || (matchType === 'any' ? 'Semua pesan' : keywords.split(/\r?\n|,/)[0].trim()),
    match_type: matchType,
    keywords: matchType === 'any' ? '' : keywords,
    reply,
    device_ids: JSON.stringify((Array.isArray(b.device_ids) ? b.device_ids : []).filter((d) => known.has(d))),
    active: b.active === false ? 0 : 1,
    cooldown_min: Math.max(0, Number.parseInt(b.cooldown_min, 10) || 0),
    in_groups: b.in_groups ? 1 : 0,
    hour_start: b.use_hours ? hour(b.hour_start) : null,
    hour_end: b.use_hours ? hour(b.hour_end) : null,
  };
}

export async function register({ router, wa, isEnabled }) {
  // Balas setelah Pesan Masuk mencatat (prioritas 20)
  wa.addIncomingHandler({
    priority: 20,
    async handle(msg) {
      if (!isEnabled() || msg.handled) return; // sudah ditangani Chat Bot
      if (Date.now() - msg.at > MAX_AGE_MS) return;
      const gap = db.prepare("SELECT 1 FROM autoreply_log WHERE chat_jid = ? AND at > datetime('now', ?)").get(msg.chatJid, `-${GLOBAL_GAP_S} seconds`);
      if (gap) return;
      const rule = findRule(msg);
      if (!rule) return;

      const text = render(rule.reply, varsFor(msg)).trim();
      if (!text) return;
      msg.handled = true; // AI Chat Bot tidak ikut menjawab pesan ini
      const to = msg.phone ?? msg.chatJid.split('@')[0];
      messages.enqueue(msg.deviceId, to, text, msg.chatJid);
      db.prepare('INSERT INTO autoreply_log (rule_id, device_id, chat_jid) VALUES (?, ?, ?)').run(rule.id, msg.deviceId, msg.chatJid);
      db.prepare("UPDATE autoreply_rules SET hits = hits + 1, last_hit_at = datetime('now') WHERE id = ?").run(rule.id);
      if (msg.inboxId) db.prepare('UPDATE incoming_messages SET autoreply_rule_id = ? WHERE id = ?').run(rule.id, msg.inboxId);
      await wa.markRead(msg.deviceId, msg.key);
      wa.drainQueue(msg.deviceId);
    },
  });

  // Bersihkan log lama (jeda per pengirim maksimal beberapa hari)
  const cleanup = () => db.prepare("DELETE FROM autoreply_log WHERE at < datetime('now', '-30 days')").run();
  cleanup();
  setInterval(cleanup, 24 * 3600 * 1000).unref();

  // ---- API admin ------------------------------------------------------------------
  const fail = (res, err) => res.status(400).json({ success: false, message: err.message });

  router.get('/', (_req, res) => {
    const rows = db.prepare("SELECT * FROM autoreply_rules ORDER BY (match_type = 'any'), priority, id").all().map(hydrate);
    const today = db.prepare("SELECT COUNT(*) AS n FROM autoreply_log WHERE date(at, 'localtime') = date('now', 'localtime')").get().n;
    res.json({ success: true, data: rows, repliesToday: today });
  });

  router.post('/', (req, res) => {
    try {
      const v = input(req.body);
      const prio = db.prepare('SELECT COALESCE(MAX(priority), 0) + 1 AS p FROM autoreply_rules').get().p;
      const r = db
        .prepare(
          `INSERT INTO autoreply_rules (name, match_type, keywords, reply, device_ids, active, cooldown_min, in_groups, hour_start, hour_end, priority)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(v.name, v.match_type, v.keywords, v.reply, v.device_ids, v.active, v.cooldown_min, v.in_groups, v.hour_start, v.hour_end, prio);
      res.json({ success: true, data: hydrate(db.prepare('SELECT * FROM autoreply_rules WHERE id = ?').get(r.lastInsertRowid)) });
    } catch (err) { fail(res, err); }
  });

  /** Coba aturan tanpa mengirim apa pun. */
  router.post('/test', (req, res) => {
    const text = String(req.body?.text ?? '');
    const msg = {
      deviceId: req.body?.deviceId || devices.all()[0]?.id,
      chatJid: 'simulator',
      phone: null,
      pushName: String(req.body?.name ?? '').trim() || 'Budi',
      text,
      isGroup: false,
    };
    const rule = findRule(msg, { checkCooldown: false });
    res.json({ success: true, data: rule ? { rule: { id: rule.id, name: rule.name }, reply: render(rule.reply, varsFor(msg)) } : null });
  });

  router.post('/reorder', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    const upd = db.prepare('UPDATE autoreply_rules SET priority = ? WHERE id = ?');
    ids.forEach((id, i) => upd.run(i + 1, id));
    res.json({ success: true });
  });

  router.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const cur = hydrate(db.prepare('SELECT * FROM autoreply_rules WHERE id = ?').get(id));
    if (!cur) return res.status(404).json({ success: false, message: 'Aturan tidak ditemukan' });
    try {
      // Hanya ubah status aktif
      if (Object.keys(req.body ?? {}).length === 1 && 'active' in req.body) {
        db.prepare('UPDATE autoreply_rules SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, id);
      } else {
        const v = input({ ...cur, use_hours: cur.hour_start != null, ...req.body });
        db.prepare(
          `UPDATE autoreply_rules SET name = ?, match_type = ?, keywords = ?, reply = ?, device_ids = ?, active = ?,
                  cooldown_min = ?, in_groups = ?, hour_start = ?, hour_end = ? WHERE id = ?`
        ).run(v.name, v.match_type, v.keywords, v.reply, v.device_ids, v.active, v.cooldown_min, v.in_groups, v.hour_start, v.hour_end, id);
      }
      res.json({ success: true, data: hydrate(db.prepare('SELECT * FROM autoreply_rules WHERE id = ?').get(id)) });
    } catch (err) { fail(res, err); }
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM autoreply_rules WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true });
  });
}
