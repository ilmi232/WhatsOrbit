// Modul Chat Bot (menu bernomor): hanya dimuat kalau fitur "chatbot" aktif.
import { randomBytes } from 'node:crypto';
import { db, devices, messages } from '../db.js';
import { render } from '../template.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS chatbots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    active     INTEGER NOT NULL DEFAULT 0,
    config     TEXT NOT NULL,   -- pengaturan + pohon menu (JSON)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS chatbot_sessions (
    chat_jid     TEXT NOT NULL,
    device_id    TEXT NOT NULL,
    bot_id       INTEGER NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
    node_id      TEXT,             -- null = sesi selesai
    paused_until TEXT,             -- diserahkan ke admin: bot diam sampai waktu ini
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (chat_jid, device_id)
  );
  CREATE TABLE IF NOT EXISTS chatbot_stats (
    bot_id  INTEGER NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    day     TEXT NOT NULL,
    n       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bot_id, node_id, day)
  );
`);

const MAX_AGE_MS = 10 * 60 * 1000;
const nid = () => randomBytes(4).toString('hex');

// ---- Contoh bot sekolah ------------------------------------------------------------------
export function sampleConfig() {
  const ppdb = nid();
  return {
    triggers: 'menu\nhalo\nhai\nassalamualaikum\ninfo',
    startOnAny: false,
    deviceIds: [],
    timeoutMin: 30,
    handoverHours: 12,
    footer: 'Balas *angka* pilihan · *0* kembali · *#* menu utama',
    fallback: 'Maaf, pilihan tidak dikenali 🙏',
    endText: 'Terima kasih sudah menghubungi kami. Ketik *menu* kapan saja untuk memulai lagi. 🙏',
    nodes: [
      { id: 'root', parent: null, label: '', type: 'menu',
        text: '{Halo|Hai} [Nama] 👋\nSelamat datang di layanan informasi *Sekolah*.\n\nSilakan pilih informasi yang dibutuhkan:' },
      { id: ppdb, parent: 'root', label: 'Info PPDB 2026', type: 'menu', text: '*Info PPDB 2026*\nPilih informasi PPDB:' },
      { id: nid(), parent: ppdb, label: 'Jadwal pendaftaran', type: 'menu', text: '📅 *Jadwal PPDB 2026*\nGelombang 1: 1 Nov – 31 Des 2025\nGelombang 2: 1 Jan – 28 Feb 2026' },
      { id: nid(), parent: ppdb, label: 'Syarat pendaftaran', type: 'menu', text: '📄 *Syarat*\n1. Fotokopi akta kelahiran\n2. Fotokopi KK\n3. Rapor terakhir\n4. Pas foto 3x4 (2 lembar)' },
      { id: nid(), parent: ppdb, label: 'Biaya', type: 'menu', text: '💰 Rincian biaya dapat dilihat di brosur PPDB. Untuk konsultasi biaya, pilih *Bicara dengan admin* di menu utama.' },
      { id: nid(), parent: 'root', label: 'Jam operasional', type: 'menu', text: '🕖 Senin – Jumat: 07.00 – 15.00\nSabtu: 07.00 – 12.00\nMinggu & hari libur: tutup' },
      { id: nid(), parent: 'root', label: 'Lokasi sekolah', type: 'menu', text: '📍 Alamat sekolah: (isi alamat)\nGoogle Maps: (isi link)' },
      { id: nid(), parent: 'root', label: 'Bicara dengan admin', type: 'handover',
        text: 'Baik [Nama], pesan Anda akan dibalas langsung oleh admin pada jam kerja. Silakan tulis pertanyaan Anda. 🙏' },
    ],
  };
}

// ---- Mesin bot (fungsi murni, dipakai juga oleh simulator) ----------------------------------
const norm = (s) => String(s ?? '').toLowerCase().replace(/[*_~]/g, '').replace(/\s+/g, ' ').trim();
const lines = (s) => String(s ?? '').split(/\r?\n|,/).map(norm).filter(Boolean);
const childrenOf = (cfg, id) => cfg.nodes.filter((n) => n.parent === id);
const nodeById = (cfg, id) => cfg.nodes.find((n) => n.id === id);

/** Teks yang dikirim untuk sebuah node: isi + daftar pilihan bernomor + petunjuk. */
export function nodeMessage(cfg, node, vars = {}) {
  const kids = childrenOf(cfg, node.id);
  let out = render(node.text ?? '', vars).trim();
  if (node.type !== 'handover') {
    if (kids.length) out += `\n\n${kids.map((k, i) => `*${i + 1}.* ${k.label}`).join('\n')}`;
    if (cfg.footer) out += `\n\n_${render(cfg.footer, vars).replace(/_/g, '')}_`;
  }
  return out;
}

/** Apakah pesan memicu bot (tanpa sesi berjalan). */
export function isTrigger(cfg, text) {
  if (cfg.startOnAny) return true;
  const t = norm(text);
  return !!t && lines(cfg.triggers).some((k) => t === k || t.startsWith(k + ' '));
}

/**
 * Satu langkah percakapan.
 * state: { node: id | null }  (null = belum/tidak ada sesi)
 * Hasil: { replies: [teks], node: id | null, handover: bool, visited: id | null, handled: bool }
 */
export function step(cfg, state, text, vars = {}) {
  const t = norm(text);
  const root = nodeById(cfg, 'root');
  const go = (node) => ({ replies: [nodeMessage(cfg, node, vars)], node: node.id, handover: false, visited: node.id, handled: true });

  if (!state?.node || !nodeById(cfg, state.node)) {
    return isTrigger(cfg, text) ? go(root) : { replies: [], node: null, handover: false, visited: null, handled: false };
  }

  const cur = nodeById(cfg, state.node);
  if (['#', 'menu', 'menu utama', 'mulai'].includes(t)) return go(root);
  if (['selesai', 'keluar', 'stop', 'exit'].includes(t)) {
    return { replies: cfg.endText ? [render(cfg.endText, vars)] : [], node: null, handover: false, visited: null, handled: true };
  }
  if (t === '0') return go(nodeById(cfg, cur.parent) ?? root);

  // Pilihan dari node sekarang; kalau node sekarang tidak punya pilihan (jawaban), pakai pilihan induknya
  const base = childrenOf(cfg, cur.id).length ? cur : nodeById(cfg, cur.parent) ?? root;
  const kids = childrenOf(cfg, base.id);
  let pick = null;
  const num = t.match(/^(\d{1,2})[.)]?$/);
  if (num) pick = kids[Number(num[1]) - 1] ?? null;
  if (!pick && t.length >= 3) pick = kids.find((k) => norm(k.label) === t) ?? kids.find((k) => norm(k.label).includes(t)) ?? null;

  if (!pick) {
    return {
      replies: [`${render(cfg.fallback || 'Pilihan tidak dikenali.', vars)}\n\n${nodeMessage(cfg, base, vars)}`],
      node: base.id, handover: false, visited: null, handled: true,
    };
  }
  if (pick.type === 'handover') {
    return { replies: [render(pick.text ?? '', vars).trim()].filter(Boolean), node: null, handover: true, visited: pick.id, handled: true };
  }
  return go(pick);
}

// ---- Validasi pengaturan ---------------------------------------------------------------------
function cleanConfig(input) {
  const b = input ?? {};
  const raw = Array.isArray(b.nodes) ? b.nodes : [];
  if (!raw.some((n) => n.id === 'root')) throw new Error('Menu utama tidak ditemukan');
  if (raw.length > 200) throw new Error('Maksimal 200 menu');
  const ids = new Set(raw.map((n) => String(n.id)));
  const nodes = raw.map((n) => ({
    id: String(n.id).slice(0, 20),
    parent: n.id === 'root' ? null : ids.has(String(n.parent)) ? String(n.parent) : 'root',
    label: String(n.label ?? '').trim().slice(0, 80),
    type: n.type === 'handover' && n.id !== 'root' ? 'handover' : 'menu',
    text: String(n.text ?? '').slice(0, 3000),
  }));
  for (const n of nodes) {
    if (n.id !== 'root' && !n.label) throw new Error('Setiap pilihan menu harus punya nama');
    // Cegah lingkaran (node menjadi turunan dirinya sendiri)
    let p = n.parent;
    for (let i = 0; p && i < 250; i++) {
      if (p === n.id) throw new Error(`Menu "${n.label}" tidak boleh berada di bawah dirinya sendiri`);
      p = nodes.find((x) => x.id === p)?.parent;
    }
  }
  const known = new Set(devices.all().map((d) => d.id));
  return {
    triggers: String(b.triggers ?? '').slice(0, 1000),
    startOnAny: !!b.startOnAny,
    deviceIds: (Array.isArray(b.deviceIds) ? b.deviceIds : []).filter((d) => known.has(d)),
    timeoutMin: Math.max(1, Math.min(1440, Number.parseInt(b.timeoutMin, 10) || 30)),
    handoverHours: Math.max(0, Math.min(168, Number.parseInt(b.handoverHours, 10) || 0)),
    footer: String(b.footer ?? '').slice(0, 200),
    fallback: String(b.fallback ?? '').slice(0, 300),
    endText: String(b.endText ?? '').slice(0, 500),
    nodes,
  };
}

const getBot = (id) => {
  const b = db.prepare('SELECT * FROM chatbots WHERE id = ?').get(id);
  return b && { ...b, active: !!b.active, config: JSON.parse(b.config) };
};

/** Isi placeholder dari pesan masuk & data Kontak. */
function varsFor(msg) {
  const vars = { Nama: msg.pushName || '', Nomor: msg.phone ? '0' + msg.phone.replace(/^62/, '') : '' };
  if (msg.phone && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='contacts'").get()) {
    const c = db.prepare('SELECT name, fields FROM contacts WHERE phone = ?').get(msg.phone);
    if (c) Object.assign(vars, JSON.parse(c.fields), c.name ? { Nama: c.name } : {});
  }
  return vars;
}

export async function register({ router, wa, isEnabled }) {
  // Tandai pesan yang ditangani bot di Pesan Masuk
  const hasInboxCol = () => {
    const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='incoming_messages'").get();
    if (!t) return false;
    if (!db.prepare('PRAGMA table_info(incoming_messages)').all().some((c) => c.name === 'handled_by')) {
      db.exec('ALTER TABLE incoming_messages ADD COLUMN handled_by TEXT');
    }
    return true;
  };

  // Jalan setelah Pesan Masuk (10), sebelum Autoreply (20)
  wa.addIncomingHandler({
    priority: 15,
    async handle(msg) {
      if (!isEnabled() || msg.isGroup || msg.handled) return;
      if (Date.now() - msg.at > MAX_AGE_MS) return;

      const sess = db.prepare('SELECT * FROM chatbot_sessions WHERE chat_jid = ? AND device_id = ?').get(msg.chatJid, msg.deviceId);
      // Diserahkan ke admin: bot (dan Autoreply) diam
      if (sess?.paused_until && sess.paused_until > db.prepare("SELECT datetime('now') AS t").get().t) {
        msg.handled = true;
        return;
      }

      const bots = db.prepare('SELECT * FROM chatbots WHERE active = 1 ORDER BY id').all()
        .map((b) => ({ ...b, config: JSON.parse(b.config) }))
        .filter((b) => !b.config.deviceIds.length || b.config.deviceIds.includes(msg.deviceId));
      if (!bots.length) return;

      // Sesi masih berjalan (belum lewat batas waktu)?
      let bot = null;
      let state = { node: null };
      if (sess?.node_id) {
        const b = bots.find((x) => x.id === sess.bot_id);
        const fresh = b && db.prepare("SELECT ? > datetime('now', ?) AS ok").get(sess.updated_at, `-${b.config.timeoutMin} minutes`).ok;
        if (fresh) { bot = b; state = { node: sess.node_id }; }
      }
      if (!bot) bot = bots.find((b) => isTrigger(b.config, msg.text));
      if (!bot || !msg.text) return;

      const vars = varsFor(msg);
      const r = step(bot.config, state, msg.text, vars);
      if (!r.handled) return;
      msg.handled = true;

      const to = msg.phone ?? msg.chatJid.split('@')[0];
      for (const text of r.replies) messages.enqueue(msg.deviceId, to, text, msg.chatJid);
      const pause = r.handover && bot.config.handoverHours ? `+${bot.config.handoverHours} hours` : null;
      db.prepare(
        `INSERT INTO chatbot_sessions (chat_jid, device_id, bot_id, node_id, paused_until, updated_at)
         VALUES (?, ?, ?, ?, ${pause ? "datetime('now', ?)" : 'NULL'}, datetime('now'))
         ON CONFLICT(chat_jid, device_id) DO UPDATE SET bot_id = excluded.bot_id, node_id = excluded.node_id,
           paused_until = excluded.paused_until, updated_at = excluded.updated_at`
      ).run(...[msg.chatJid, msg.deviceId, bot.id, r.node, ...(pause ? [pause] : [])]);
      if (r.visited) {
        db.prepare(
          `INSERT INTO chatbot_stats (bot_id, node_id, day, n) VALUES (?, ?, date('now', 'localtime'), 1)
           ON CONFLICT(bot_id, node_id, day) DO UPDATE SET n = n + 1`
        ).run(bot.id, r.visited);
      }
      if (r.handover) wa.emitHandover(msg, `Chat Bot: ${bot.name}`);
      if (msg.inboxId && hasInboxCol()) {
        db.prepare('UPDATE incoming_messages SET handled_by = ? WHERE id = ?')
          .run(r.handover ? `Chat Bot: ${bot.name} → admin` : `Chat Bot: ${bot.name}`, msg.inboxId);
      }
      await wa.markRead(msg.deviceId, msg.key);
      wa.drainQueue(msg.deviceId);
    },
  });

  const cleanup = () => db.prepare("DELETE FROM chatbot_sessions WHERE updated_at < datetime('now', '-8 days')").run();
  cleanup();
  setInterval(cleanup, 24 * 3600 * 1000).unref();

  // ---- API admin ------------------------------------------------------------------
  const fail = (res, err, code = 400) => res.status(code).json({ success: false, message: err.message });

  router.get('/', (_req, res) => {
    const rows = db.prepare('SELECT * FROM chatbots ORDER BY id').all().map((b) => {
      const s = db.prepare(
        `SELECT COALESCE(SUM(CASE WHEN day = date('now','localtime') THEN n END), 0) AS today,
                COALESCE(SUM(CASE WHEN day >= date('now','localtime','-6 days') THEN n END), 0) AS week
           FROM chatbot_stats WHERE bot_id = ?`
      ).get(b.id);
      const active = db.prepare("SELECT COUNT(*) AS n FROM chatbot_sessions WHERE bot_id = ? AND node_id IS NOT NULL AND updated_at > datetime('now', '-30 minutes')").get(b.id).n;
      const paused = db.prepare("SELECT COUNT(*) AS n FROM chatbot_sessions WHERE bot_id = ? AND paused_until > datetime('now')").get(b.id).n;
      return { ...b, active: !!b.active, config: JSON.parse(b.config), today: s.today, week: s.week, sessions: active, handovers: paused };
    });
    res.json({ success: true, data: rows });
  });

  router.post('/', (req, res) => {
    try {
      const name = String(req.body?.name ?? '').trim().slice(0, 60) || 'Bot Informasi';
      const config = cleanConfig(sampleConfig());
      const r = db.prepare('INSERT INTO chatbots (name, active, config) VALUES (?, 0, ?)').run(name, JSON.stringify(config));
      res.json({ success: true, data: getBot(Number(r.lastInsertRowid)) });
    } catch (err) { fail(res, err); }
  });

  router.get('/:id', (req, res) => {
    const b = getBot(Number(req.params.id));
    if (!b) return fail(res, new Error('Bot tidak ditemukan'), 404);
    const visits = Object.fromEntries(
      db.prepare("SELECT node_id, SUM(n) AS n FROM chatbot_stats WHERE bot_id = ? AND day >= date('now','localtime','-29 days') GROUP BY node_id").all(b.id)
        .map((r) => [r.node_id, r.n])
    );
    const handovers = db.prepare(
      `SELECT s.chat_jid, s.paused_until, d.name AS device_name FROM chatbot_sessions s LEFT JOIN devices d ON d.id = s.device_id
        WHERE s.bot_id = ? AND s.paused_until > datetime('now') ORDER BY s.paused_until DESC LIMIT 50`
    ).all(b.id);
    res.json({ success: true, data: { ...b, visits, handovers } });
  });

  router.put('/:id', (req, res) => {
    const b = getBot(Number(req.params.id));
    if (!b) return fail(res, new Error('Bot tidak ditemukan'), 404);
    try {
      const config = cleanConfig(req.body?.config);
      const name = String(req.body?.name ?? b.name).trim().slice(0, 60) || b.name;
      const active = req.body?.active === undefined ? b.active : !!req.body.active;
      if (active && !config.startOnAny && !lines(config.triggers).length) throw new Error('Isi kata pemicu, atau aktifkan "mulai untuk semua chat"');
      db.prepare("UPDATE chatbots SET name = ?, active = ?, config = ?, updated_at = datetime('now') WHERE id = ?")
        .run(name, active ? 1 : 0, JSON.stringify(config), b.id);
      res.json({ success: true, data: getBot(b.id) });
    } catch (err) { fail(res, err); }
  });

  router.patch('/:id/active', (req, res) => {
    const b = getBot(Number(req.params.id));
    if (!b) return fail(res, new Error('Bot tidak ditemukan'), 404);
    if (req.body?.active && !b.config.startOnAny && !lines(b.config.triggers).length) {
      return fail(res, new Error('Isi kata pemicu dulu'));
    }
    db.prepare('UPDATE chatbots SET active = ? WHERE id = ?').run(req.body?.active ? 1 : 0, b.id);
    res.json({ success: true, data: getBot(b.id) });
  });

  /** Simulator: jalankan satu langkah dengan pengaturan (boleh belum disimpan). */
  router.post('/:id/simulate', (req, res) => {
    try {
      const cfg = cleanConfig(req.body?.config);
      const r = step(cfg, { node: req.body?.node ?? null }, String(req.body?.text ?? ''), { Nama: String(req.body?.name ?? 'Budi'), Nomor: '081234567890' });
      res.json({ success: true, data: r });
    } catch (err) { fail(res, err); }
  });

  /** Lepas jeda serah-ke-admin untuk satu chat (bot aktif lagi untuk chat itu). */
  router.post('/:id/resume', (req, res) => {
    db.prepare('UPDATE chatbot_sessions SET paused_until = NULL, node_id = NULL WHERE bot_id = ? AND chat_jid = ?')
      .run(Number(req.params.id), String(req.body?.chatJid ?? ''));
    res.json({ success: true });
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM chatbots WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true });
  });
}
