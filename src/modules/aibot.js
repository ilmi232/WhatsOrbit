// Modul AI Chat Bot: hanya dimuat kalau fitur "aibot" aktif.
import { db, devices, getSetting, messages, setSetting } from '../db.js';
import { PROVIDERS, chat, listModels } from '../ai-providers.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_jid  TEXT NOT NULL,
    device_id TEXT NOT NULL,
    role      TEXT NOT NULL,       -- user | assistant
    text      TEXT NOT NULL,
    at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ai_messages_chat ON ai_messages(chat_jid, device_id, id);
  CREATE TABLE IF NOT EXISTS ai_pauses (
    chat_jid  TEXT NOT NULL,
    device_id TEXT NOT NULL,
    until     TEXT NOT NULL,
    PRIMARY KEY (chat_jid, device_id)
  );
  CREATE TABLE IF NOT EXISTS ai_usage (
    day      TEXT PRIMARY KEY,
    requests INTEGER NOT NULL DEFAULT 0,
    errors   INTEGER NOT NULL DEFAULT 0,
    input    INTEGER NOT NULL DEFAULT 0,
    output   INTEGER NOT NULL DEFAULT 0
  );
`);

const ADMIN_TAG = '[ADMIN]';
const MAX_AGE_MS = 10 * 60 * 1000;

export const DEFAULT_PROMPT =
  'Kamu adalah asisten WhatsApp resmi sekolah. Jawab dalam Bahasa Indonesia yang sopan dan ramah, ' +
  'singkat (maksimal 5 kalimat), dan mudah dibaca di WhatsApp (boleh *tebal* dan daftar bernomor, tanpa tabel atau markdown lain).\n' +
  'Jawab HANYA berdasarkan INFORMASI SEKOLAH di bawah. Kalau informasinya tidak ada, katakan terus terang bahwa kamu belum punya ' +
  'informasinya dan tawarkan untuk diteruskan ke admin. Jangan pernah mengarang biaya, tanggal, nomor telepon, atau kebijakan.\n' +
  `Kalau pengguna meminta bicara dengan admin/petugas, atau urusannya perlu ditangani manusia (keluhan, pembayaran, data pribadi siswa), ` +
  `balas singkat bahwa admin akan membalas, lalu akhiri jawaban dengan tanda ${ADMIN_TAG}.`;

const DEFAULTS = {
  active: false,
  provider: 'gemini',
  keys: {},        // { provider: apiKey }
  models: {},      // { provider: model }
  baseUrls: {},    // { provider: url } untuk penyedia kompatibel OpenAI
  prompt: DEFAULT_PROMPT,
  knowledge: '',
  mode: 'fallback', // fallback = jawab chat yang tidak ditangani fitur lain; prefix = hanya pesan diawali kata tertentu
  prefix: 'tanya',
  deviceIds: [],
  historyTurns: 6,
  temperature: 0.3,
  maxTokens: 1024,
  dailyLimit: 300,
  perChatHourly: 20,
  handoverHours: 12,
  errorText: '',
};

export function loadSettings() {
  return { ...DEFAULTS, ...JSON.parse(getSetting('aibot', () => '{}')) };
}

const mask = (k) => (k ? `••••${k.slice(-4)}` : '');

function publicSettings(s) {
  const { keys, ...rest } = s;
  return { ...rest, keys: Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, mask(keys[p])])) };
}

const num = (v, min, max, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
};

function saveSettings(b) {
  const cur = loadSettings();
  const next = { ...cur };
  if (b.provider && PROVIDERS[b.provider]) next.provider = b.provider;
  // API key: string berisi = ganti, null = hapus, tidak dikirim/kosong = tetap
  if (b.keys && typeof b.keys === 'object') {
    next.keys = { ...cur.keys };
    for (const [p, k] of Object.entries(b.keys)) {
      if (!PROVIDERS[p]) continue;
      if (k === null) delete next.keys[p];
      else if (typeof k === 'string' && k.trim() && !k.startsWith('••••')) next.keys[p] = k.trim();
    }
  }
  if (b.models && typeof b.models === 'object') next.models = { ...cur.models, ...Object.fromEntries(Object.entries(b.models).map(([p, m]) => [p, String(m ?? '').trim().slice(0, 120)])) };
  if (b.baseUrls && typeof b.baseUrls === 'object') {
    next.baseUrls = { ...cur.baseUrls };
    for (const [p, u] of Object.entries(b.baseUrls)) {
      const url = String(u ?? '').trim();
      if (!url) delete next.baseUrls[p];
      else if (/^https?:\/\/[^\s]+$/i.test(url)) next.baseUrls[p] = url.slice(0, 300);
      else throw new Error('Base URL harus diawali http:// atau https://');
    }
  }
  if (b.prompt !== undefined) next.prompt = String(b.prompt).trim().slice(0, 8000) || DEFAULT_PROMPT;
  if (b.knowledge !== undefined) next.knowledge = String(b.knowledge).slice(0, 60_000);
  if (b.mode !== undefined) next.mode = b.mode === 'prefix' ? 'prefix' : 'fallback';
  if (b.prefix !== undefined) next.prefix = String(b.prefix).trim().toLowerCase().slice(0, 30);
  if (Array.isArray(b.deviceIds)) {
    const known = new Set(devices.all().map((d) => d.id));
    next.deviceIds = b.deviceIds.filter((d) => known.has(d));
  }
  next.historyTurns = num(b.historyTurns ?? cur.historyTurns, 0, 20, 6);
  next.temperature = num(b.temperature ?? cur.temperature, 0, 1.5, 0.3);
  next.maxTokens = num(b.maxTokens ?? cur.maxTokens, 128, 8192, 1024);
  next.dailyLimit = num(b.dailyLimit ?? cur.dailyLimit, 1, 100_000, 300);
  next.perChatHourly = num(b.perChatHourly ?? cur.perChatHourly, 1, 500, 20);
  next.handoverHours = num(b.handoverHours ?? cur.handoverHours, 0, 168, 12);
  if (b.errorText !== undefined) next.errorText = String(b.errorText).trim().slice(0, 300);
  if (b.active !== undefined) next.active = !!b.active;
  // Saat aktif, pengaturan harus lengkap (juga saat mengganti penyedia ketika AI sedang aktif)
  if (next.active) {
    const p = PROVIDERS[next.provider];
    const suffix = b.active === undefined ? ', atau nonaktifkan AI dulu' : '';
    if (!next.keys[next.provider] && !p.keyOptional) throw new Error(`Isi API key ${p.name} dulu${suffix}`);
    if (!modelOf(next)) throw new Error(`Pilih model dulu${suffix}`);
    if (next.mode === 'prefix' && !next.prefix) throw new Error(`Isi kata awalan dulu${suffix}`);
  }
  setSetting('aibot', JSON.stringify(next));
  return next;
}

const modelOf = (s) => s.models[s.provider] || PROVIDERS[s.provider].defaultModel;

function systemFor(s, name) {
  let sys = s.prompt;
  if (s.knowledge.trim()) sys += `\n\nINFORMASI SEKOLAH:\n${s.knowledge.trim()}`;
  if (name) sys += `\n\nNama pengguna (dari WhatsApp): ${name}`;
  return sys;
}

/** Panggil AI dengan pengaturan + riwayat. Mengembalikan { text, admin, refused, usage }. */
async function ask(s, history, name) {
  const r = await chat({
    provider: s.provider,
    apiKey: s.keys[s.provider],
    baseUrl: s.baseUrls[s.provider],
    model: modelOf(s),
    system: systemFor(s, name),
    history,
    maxTokens: s.maxTokens,
    temperature: s.temperature,
  });
  const admin = r.text.includes(ADMIN_TAG);
  return { ...r, text: r.text.replaceAll(ADMIN_TAG, '').trim(), admin };
}

function addUsage({ requests = 0, errors = 0, input = 0, output = 0 }) {
  db.prepare(
    `INSERT INTO ai_usage (day, requests, errors, input, output) VALUES (date('now','localtime'), ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET requests = requests + excluded.requests, errors = errors + excluded.errors,
       input = input + excluded.input, output = output + excluded.output`
  ).run(requests, errors, input, output);
}
const usedToday = () => db.prepare("SELECT requests FROM ai_usage WHERE day = date('now','localtime')").get()?.requests ?? 0;

export async function register({ router, wa, isEnabled }) {
  const inboxMark = (id, label) => {
    if (!id) return;
    const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='incoming_messages'").get();
    if (t && db.prepare('PRAGMA table_info(incoming_messages)').all().some((c) => c.name === 'handled_by')) {
      db.prepare('UPDATE incoming_messages SET handled_by = ? WHERE id = ?').run(label, id);
    }
  };
  const inScope = (s, msg) => !s.deviceIds.length || s.deviceIds.includes(msg.deviceId);

  // Penanda awal: beri tahu Autoreply bahwa AI akan menjawab (aturan "semua pesan" dilewati)
  wa.addIncomingHandler({
    priority: 5,
    handle(msg) {
      if (!isEnabled() || msg.isGroup) return;
      const s = loadSettings();
      if (s.active && s.mode === 'fallback' && inScope(s, msg)) msg.aiActive = true;
    },
  });

  // Antrean per chat supaya jawaban berurutan
  const chains = new Map();

  async function answer(msg, s, question) {
    const hist = db
      .prepare('SELECT role, text FROM ai_messages WHERE chat_jid = ? AND device_id = ? AND at > datetime(\'now\', \'-24 hours\') ORDER BY id DESC LIMIT ?')
      .all(msg.chatJid, msg.deviceId, s.historyTurns * 2)
      .reverse();
    // Riwayat harus diawali pesan pengguna
    while (hist.length && hist[0].role !== 'user') hist.shift();
    const history = [...hist, { role: 'user', text: question }];
    const to = msg.phone ?? msg.chatJid.split('@')[0];
    try {
      const r = await ask(s, history, msg.pushName);
      addUsage({ requests: 1, input: r.usage.input, output: r.usage.output });
      const reply = r.text || (r.refused ? 'Maaf, pertanyaan ini akan dijawab langsung oleh admin. 🙏' : '');
      if (!reply) throw new Error('AI tidak memberi jawaban');
      messages.enqueue(msg.deviceId, to, reply, msg.chatJid);
      const ins = db.prepare('INSERT INTO ai_messages (chat_jid, device_id, role, text) VALUES (?, ?, ?, ?)');
      ins.run(msg.chatJid, msg.deviceId, 'user', question);
      ins.run(msg.chatJid, msg.deviceId, 'assistant', reply);
      const handover = r.admin || r.refused;
      if (handover && s.handoverHours) {
        db.prepare(
          `INSERT INTO ai_pauses (chat_jid, device_id, until) VALUES (?, ?, datetime('now', ?))
           ON CONFLICT(chat_jid, device_id) DO UPDATE SET until = excluded.until`
        ).run(msg.chatJid, msg.deviceId, `+${s.handoverHours} hours`);
      }
      inboxMark(msg.inboxId, handover ? 'AI → admin' : 'AI');
      if (handover) wa.emitHandover(msg, 'AI Chat Bot');
      await wa.markRead(msg.deviceId, msg.key);
      wa.drainQueue(msg.deviceId);
    } catch (err) {
      addUsage({ requests: 1, errors: 1 });
      setSetting('aibot_last_error', JSON.stringify({ at: new Date().toISOString(), message: String(err.message).slice(0, 300) }));
      wa.logger.warn({ err: err.message }, 'AI Chat Bot gagal menjawab');
      inboxMark(msg.inboxId, 'AI gagal menjawab');
      if (s.errorText) {
        messages.enqueue(msg.deviceId, to, s.errorText, msg.chatJid);
        wa.drainQueue(msg.deviceId);
      }
    }
  }

  // Jalan paling akhir (setelah Chat Bot 15 dan Autoreply 20)
  wa.addIncomingHandler({
    priority: 25,
    handle(msg) {
      if (!isEnabled() || msg.handled || msg.isGroup || !msg.text) return;
      if (Date.now() - msg.at > MAX_AGE_MS) return;
      const s = loadSettings();
      if (!s.active || !inScope(s, msg)) return;

      let question = msg.text;
      if (s.mode === 'prefix') {
        const t = question.trim();
        if (!t.toLowerCase().startsWith(s.prefix)) return;
        question = t.slice(s.prefix.length).replace(/^[\s:,.-]+/, '').trim();
        if (!question) return;
      }
      // Diserahkan ke admin: AI diam
      const paused = db.prepare("SELECT 1 FROM ai_pauses WHERE chat_jid = ? AND device_id = ? AND until > datetime('now')").get(msg.chatJid, msg.deviceId);
      if (paused) { msg.handled = true; return; }
      // Batas pemakaian (melindungi kuota/biaya)
      if (usedToday() >= s.dailyLimit) { inboxMark(msg.inboxId, 'AI: batas harian tercapai'); return; }
      const lastHour = db.prepare("SELECT COUNT(*) AS n FROM ai_messages WHERE chat_jid = ? AND role = 'assistant' AND at > datetime('now', '-1 hours')").get(msg.chatJid).n;
      if (lastHour >= s.perChatHourly) { msg.handled = true; inboxMark(msg.inboxId, 'AI: batas per chat tercapai'); return; }

      msg.handled = true;
      const key = `${msg.deviceId}|${msg.chatJid}`;
      const prev = chains.get(key) ?? Promise.resolve();
      const next = prev.then(() => answer(msg, s, question));
      chains.set(key, next);
      next.finally(() => { if (chains.get(key) === next) chains.delete(key); });
    },
  });

  const cleanup = () => {
    db.prepare("DELETE FROM ai_messages WHERE at < datetime('now', '-30 days')").run();
    db.prepare("DELETE FROM ai_pauses WHERE until < datetime('now')").run();
  };
  cleanup();
  setInterval(cleanup, 24 * 3600 * 1000).unref();

  // ---- API admin ------------------------------------------------------------------
  const fail = (res, err) => res.status(400).json({ success: false, message: err.message });

  router.get('/settings', (_req, res) => {
    res.json({
      success: true,
      data: publicSettings(loadSettings()),
      providers: PROVIDERS,
      defaultPrompt: DEFAULT_PROMPT,
      lastError: JSON.parse(getSetting('aibot_last_error', () => 'null')),
    });
  });

  router.put('/settings', (req, res) => {
    try { res.json({ success: true, data: publicSettings(saveSettings(req.body ?? {})) }); } catch (err) { fail(res, err); }
  });

  /** Daftar model dari penyedia (pakai key yang dikirim, atau yang tersimpan). */
  router.post('/models', async (req, res) => {
    const s = loadSettings();
    const provider = req.body?.provider ?? s.provider;
    const key = String(req.body?.apiKey ?? '').trim();
    try {
      const r = await listModels({
        provider,
        apiKey: key && !key.startsWith('••••') ? key : s.keys[provider],
        baseUrl: req.body?.baseUrl || s.baseUrls[provider],
      });
      res.json({ success: true, data: r.models, recommended: r.recommended });
    } catch (err) { fail(res, err); }
  });

  /** Uji / simulator: tanya AI dengan pengaturan tersimpan + perubahan yang belum disimpan. */
  router.post('/test', async (req, res) => {
    const s = { ...loadSettings() };
    const b = req.body ?? {};
    for (const k of ['provider', 'prompt', 'knowledge', 'temperature', 'maxTokens']) if (b[k] !== undefined) s[k] = b[k];
    if (b.model) s.models = { ...s.models, [s.provider]: b.model };
    if (b.baseUrl) s.baseUrls = { ...s.baseUrls, [s.provider]: b.baseUrl };
    if (typeof b.apiKey === 'string' && b.apiKey.trim() && !b.apiKey.startsWith('••••')) s.keys = { ...s.keys, [s.provider]: b.apiKey.trim() };
    s.temperature = num(s.temperature, 0, 1.5, 0.3);
    s.maxTokens = num(s.maxTokens, 128, 8192, 1024);
    const history = (Array.isArray(b.history) ? b.history : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.text)
      .slice(-40)
      .map((m) => ({ role: m.role, text: String(m.text).slice(0, 4000) }));
    if (!history.length || history[history.length - 1].role !== 'user') return fail(res, new Error('Pesan uji kosong'));
    const t0 = Date.now();
    try {
      const r = await ask(s, history, 'Budi');
      addUsage({ requests: 1, input: r.usage.input, output: r.usage.output });
      res.json({ success: true, data: { ...r, ms: Date.now() - t0, model: modelOf(s) } });
    } catch (err) {
      addUsage({ requests: 1, errors: 1 });
      fail(res, err);
    }
  });

  router.get('/stats', (_req, res) => {
    const days = db.prepare("SELECT * FROM ai_usage WHERE day >= date('now','localtime','-6 days') ORDER BY day").all();
    const today = days.find((d) => d.day === db.prepare("SELECT date('now','localtime') AS d").get().d) ?? { requests: 0, errors: 0, input: 0, output: 0 };
    const conv = db.prepare(
      `SELECT a.chat_jid, a.device_id, d.name AS device_name, MAX(a.at) AS last_at, COUNT(*) AS n,
              (SELECT text FROM ai_messages x WHERE x.chat_jid = a.chat_jid AND x.device_id = a.device_id AND x.role = 'user' ORDER BY x.id DESC LIMIT 1) AS last_q,
              (SELECT text FROM ai_messages x WHERE x.chat_jid = a.chat_jid AND x.device_id = a.device_id AND x.role = 'assistant' ORDER BY x.id DESC LIMIT 1) AS last_a,
              (SELECT until FROM ai_pauses p WHERE p.chat_jid = a.chat_jid AND p.device_id = a.device_id AND p.until > datetime('now')) AS paused_until
         FROM ai_messages a LEFT JOIN devices d ON d.id = a.device_id
        GROUP BY a.chat_jid, a.device_id ORDER BY last_at DESC LIMIT 20`
    ).all();
    res.json({ success: true, data: { today, week: days, conversations: conv, lastError: JSON.parse(getSetting('aibot_last_error', () => 'null')) } });
  });

  router.post('/resume', (req, res) => {
    db.prepare('DELETE FROM ai_pauses WHERE chat_jid = ?').run(String(req.body?.chatJid ?? ''));
    res.json({ success: true });
  });
}
