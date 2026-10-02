// Modul Customer Service: hanya dimuat kalau fitur "cs" aktif.
// Chat pelanggan dibagi ke petugas CS. Petugas membalas dari WhatsApp pribadinya
// (balas/kutip notifikasi), WhatsOrbit meneruskan ke pelanggan dari nomor sekolah.
import { db, devices, getSetting, messages, setSetting } from '../db.js';
import { normalizePhone } from '../phone.js';
import { render } from '../template.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS cs_agents (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    phone            TEXT NOT NULL UNIQUE,
    jid              TEXT,                    -- ID chat terakhir yang terlihat (untuk nomor tersembunyi/LID)
    active           INTEGER NOT NULL DEFAULT 1,
    on_duty          INTEGER NOT NULL DEFAULT 1,
    start            TEXT NOT NULL DEFAULT '',
    end              TEXT NOT NULL DEFAULT '',
    days             TEXT NOT NULL DEFAULT '[]',
    device_ids       TEXT NOT NULL DEFAULT '[]',
    last_assigned_at TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS cs_tickets (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id         TEXT NOT NULL,
    chat_jid          TEXT NOT NULL,
    phone             TEXT,
    name              TEXT NOT NULL DEFAULT '',
    agent_id          INTEGER REFERENCES cs_agents(id) ON DELETE SET NULL,
    status            TEXT NOT NULL DEFAULT 'open',   -- open | closed
    source            TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    assigned_at       TEXT,
    first_response_at TEXT,
    last_activity_at  TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at         TEXT,
    close_reason      TEXT,
    offline_sent      INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_cs_tickets_chat ON cs_tickets(device_id, chat_jid, status);
  CREATE TABLE IF NOT EXISTS cs_ticket_messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
    dir       TEXT NOT NULL,            -- in (pelanggan) | out (ke pelanggan) | note (sistem)
    author    TEXT NOT NULL DEFAULT '',
    text      TEXT NOT NULL,
    at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cs_tm_ticket ON cs_ticket_messages(ticket_id, id);
  CREATE TABLE IF NOT EXISTS cs_relay (
    message_id INTEGER PRIMARY KEY,     -- pesan notifikasi ke petugas (messages.id)
    ticket_id  INTEGER NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE
  );
`);

export const DEFAULTS = {
  mode: 'handover', // handover = hanya chat yang diserahkan Chat Bot/AI; all = juga semua chat yang tidak dijawab otomatis
  greetText: 'Halo [Nama], pesan Anda sudah kami teruskan ke petugas kami *[CS]*. Mohon ditunggu sebentar 🙏',
  offlineText: 'Terima kasih [Nama]. Saat ini petugas kami sedang tidak bertugas, pesan Anda akan dibalas pada jam kerja 🙏',
  closeText: 'Terima kasih sudah menghubungi kami 🙏 Semoga membantu.',
  autoCloseHours: 24,
};

export function loadSettings() {
  return { ...DEFAULTS, ...JSON.parse(getSetting('cs', () => '{}')) };
}

const localPhone = (p) => (p ? (p.startsWith('62') ? '0' + p.slice(2) : '+' + p) : 'nomor tersembunyi');
const hydrateAgent = (a) => a && { ...a, active: !!a.active, on_duty: !!a.on_duty, days: JSON.parse(a.days), device_ids: JSON.parse(a.device_ids) };
const agentById = (id) => hydrateAgent(db.prepare('SELECT * FROM cs_agents WHERE id = ?').get(id));
const ticketById = (id) => db.prepare('SELECT * FROM cs_tickets WHERE id = ?').get(id);
const openTicketFor = (deviceId, chatJid) =>
  db.prepare("SELECT * FROM cs_tickets WHERE device_id = ? AND chat_jid = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(deviceId, chatJid);
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };

/** Petugas sedang bertugas sekarang (aktif, saklar bertugas, jam & hari kerja). */
function onShift(a, now = new Date()) {
  if (!a.active || !a.on_duty) return false;
  if (a.days.length && !a.days.includes(now.getDay())) return false;
  if (!a.start || !a.end) return true;
  const m = now.getHours() * 60 + now.getMinutes();
  const s = toMin(a.start);
  const e = toMin(a.end);
  return s < e ? m >= s && m < e : m >= s || m < e;
}

const openCount = (agentId) => db.prepare("SELECT COUNT(*) AS n FROM cs_tickets WHERE agent_id = ? AND status = 'open'").get(agentId).n;

export async function register({ router, wa, isEnabled }) {
  // ---- Kirim -------------------------------------------------------------------------
  const note = (ticketId, text, dir = 'note', author = '') =>
    db.prepare('INSERT INTO cs_ticket_messages (ticket_id, dir, author, text) VALUES (?, ?, ?, ?)').run(ticketId, dir, author, text);
  const touch = (ticketId) => db.prepare("UPDATE cs_tickets SET last_activity_at = datetime('now') WHERE id = ?").run(ticketId);

  /** Pesan ke petugas (dicatat supaya balasan "kutip" bisa dikenali). */
  function toAgent(ticket, agent, text) {
    const id = messages.enqueue(ticket.device_id, agent.phone, text, agent.jid?.endsWith('@s.whatsapp.net') ? agent.jid : null, 'internal');
    db.prepare('INSERT OR REPLACE INTO cs_relay (message_id, ticket_id) VALUES (?, ?)').run(id, ticket.id);
    wa.drainQueue(ticket.device_id);
  }

  /** Pesan ke pelanggan dari nomor sekolah. */
  function toCustomer(ticket, text, author) {
    messages.enqueue(ticket.device_id, ticket.phone ?? ticket.chat_jid.split('@')[0], text, ticket.chat_jid);
    note(ticket.id, text, 'out', author);
    db.prepare("UPDATE cs_tickets SET first_response_at = COALESCE(first_response_at, datetime('now')), last_activity_at = datetime('now') WHERE id = ?")
      .run(ticket.id);
    wa.drainQueue(ticket.device_id);
  }

  const vars = (ticket, agent) => ({ Nama: ticket.name || '', Nomor: localPhone(ticket.phone), CS: agent?.name ?? '' });

  // ---- Pembagian ------------------------------------------------------------------------
  function pickAgent(ticket) {
    const all = db.prepare('SELECT * FROM cs_agents WHERE active = 1').all().map(hydrateAgent)
      .filter((a) => onShift(a) && (!a.device_ids.length || a.device_ids.includes(ticket.device_id)));
    // Paling sedikit chat terbuka, lalu yang paling lama tidak mendapat chat (bergiliran)
    all.sort((a, b) => openCount(a.id) - openCount(b.id) || String(a.last_assigned_at ?? '').localeCompare(String(b.last_assigned_at ?? '')));
    return all[0] ?? null;
  }

  function recentLines(ticket, n = 3) {
    return db.prepare("SELECT text FROM cs_ticket_messages WHERE ticket_id = ? AND dir = 'in' ORDER BY id DESC LIMIT ?")
      .all(ticket.id, n).reverse().map((r) => `"${r.text.slice(0, 300)}"`).join('\n');
  }

  function assign(ticket, agent, { announce = true } = {}) {
    db.prepare("UPDATE cs_tickets SET agent_id = ?, assigned_at = datetime('now') WHERE id = ?").run(agent.id, ticket.id);
    db.prepare("UPDATE cs_agents SET last_assigned_at = datetime('now') WHERE id = ?").run(agent.id);
    note(ticket.id, `Ditugaskan ke ${agent.name}`);
    const dev = devices.get(ticket.device_id);
    toAgent(ticket, agent,
      `📩 *Chat #${ticket.id}* — via ${dev?.name ?? 'WhatsOrbit'}\n` +
      `👤 ${ticket.name || 'Tanpa nama'} (${localPhone(ticket.phone)})\n` +
      (ticket.source ? `Sumber: ${ticket.source}\n` : '') +
      `\n${recentLines(ticket) || '(Pelanggan diminta menulis pertanyaannya; pesan berikutnya akan diteruskan ke sini.)'}\n\n` +
      `↩️ *Balas (kutip) pesan ini* untuk menjawab pelanggan.\nPerintah: *#selesai ${ticket.id}* · *#list* · *#off*`);
    if (announce) {
      const s = loadSettings();
      if (s.greetText) toCustomer({ ...ticket, agent_id: agent.id }, render(s.greetText, vars(ticket, agent)), 'Sistem');
    }
  }

  function tryAssign(ticket, opts) {
    const agent = pickAgent(ticket);
    if (agent) { assign(ticket, agent, opts); return agent; }
    const s = loadSettings();
    if (opts?.announce !== false && s.offlineText && !ticket.offline_sent) {
      toCustomer(ticket, render(s.offlineText, vars(ticket, null)), 'Sistem');
      db.prepare('UPDATE cs_tickets SET offline_sent = 1 WHERE id = ?').run(ticket.id);
    }
    return null;
  }

  /**
   * context: 'inbox' = beberapa pesan terakhir yang belum dijawab otomatis,
   *          'message' = pesan ini saja (mis. pertanyaan yang membuat AI menyerahkan),
   *          'none' = belum ada (Chat Bot meminta pelanggan menulis pertanyaannya).
   */
  function createTicket(msg, source, { announce, context }) {
    const r = db.prepare('INSERT INTO cs_tickets (device_id, chat_jid, phone, name, source) VALUES (?, ?, ?, ?, ?)')
      .run(msg.deviceId, msg.chatJid, msg.phone, msg.pushName ?? '', source);
    const ticket = ticketById(Number(r.lastInsertRowid));
    let lines = [];
    if (context === 'inbox' && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='incoming_messages'").get()) {
      lines = db.prepare(
        `SELECT body FROM incoming_messages WHERE device_id = ? AND chat_jid = ? AND handled_by IS NULL AND autoreply_rule_id IS NULL
            AND received_at > datetime('now', '-1 hours') ORDER BY id DESC LIMIT 3`
      ).all(msg.deviceId, msg.chatJid).reverse().map((x) => x.body);
    }
    if (context !== 'none' && !lines.length) lines = [msg.body ?? msg.text ?? ''];
    for (const t of lines) if (t) note(ticket.id, t, 'in', ticket.name);
    tryAssign(ticket, { announce });
    return ticketById(ticket.id);
  }

  /** Setelah CS selesai, Chat Bot & AI boleh menjawab chat ini lagi (lepas jeda serah-ke-admin). */
  function resumeBots(ticket) {
    const has = (t) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(t);
    if (has('chatbot_sessions')) db.prepare('UPDATE chatbot_sessions SET paused_until = NULL, node_id = NULL WHERE chat_jid = ? AND device_id = ?').run(ticket.chat_jid, ticket.device_id);
    if (has('ai_pauses')) db.prepare('DELETE FROM ai_pauses WHERE chat_jid = ? AND device_id = ?').run(ticket.chat_jid, ticket.device_id);
  }

  function closeTicket(ticket, reason, { notifyCustomer = false, by = '' } = {}) {
    if (ticket.status !== 'open') return;
    db.prepare("UPDATE cs_tickets SET status = 'closed', closed_at = datetime('now'), close_reason = ? WHERE id = ?").run(reason, ticket.id);
    note(ticket.id, `Ditutup${by ? ` oleh ${by}` : ''} (${reason})`);
    resumeBots(ticket);
    const s = loadSettings();
    if (notifyCustomer && s.closeText) toCustomer(ticket, render(s.closeText, vars(ticket, agentById(ticket.agent_id))), by || 'Sistem');
    const agent = ticket.agent_id ? agentById(ticket.agent_id) : null;
    if (agent && by !== agent.name) toAgent(ticket, agent, `✅ Chat #${ticket.id} (${ticket.name || localPhone(ticket.phone)}) ditutup${by ? ` oleh ${by}` : ''}.`);
  }

  const inboxMark = (msg, label) => {
    if (!msg.inboxId) return;
    if (db.prepare('PRAGMA table_info(incoming_messages)').all().some((c) => c.name === 'handled_by')) {
      db.prepare('UPDATE incoming_messages SET handled_by = ? WHERE id = ?').run(label, msg.inboxId);
    }
  };

  // ---- Pesan dari petugas ------------------------------------------------------------------
  function findAgent(msg) {
    const a = db.prepare('SELECT * FROM cs_agents WHERE active = 1 AND (phone = ? OR jid = ?)').get(msg.phone ?? '-', msg.senderJid ?? '-');
    if (a && msg.senderJid && a.jid !== msg.senderJid) db.prepare('UPDATE cs_agents SET jid = ? WHERE id = ?').run(msg.senderJid, a.id);
    return hydrateAgent(a);
  }

  const HELP = (agent) =>
    `🤖 *Perintah Customer Service*\n` +
    `• Balas (kutip) notifikasi chat untuk menjawab pelanggan\n` +
    `• *#12 teks* — balas chat #12\n• *#selesai 12* — tutup chat #12\n• *#ambil 12* — ambil chat yang belum ada petugasnya\n` +
    `• *#list* — chat terbuka Anda\n• *#off* / *#on* — berhenti / mulai bertugas (sekarang: ${agent.on_duty ? 'bertugas' : 'tidak bertugas'})`;

  function replyAgent(msg, agent, text) {
    messages.enqueue(msg.deviceId, agent.phone, text, msg.chatJid, 'internal');
    wa.drainQueue(msg.deviceId);
  }

  function handleAgent(msg, agent) {
    const text = (msg.text ?? '').trim();
    const mine = () => db.prepare("SELECT * FROM cs_tickets WHERE agent_id = ? AND status = 'open' ORDER BY last_activity_at DESC").all(agent.id);
    const quoted = msg.quotedId ? messages.byWaId(msg.quotedId) : null;
    const quotedTicket = quoted ? ticketById(db.prepare('SELECT ticket_id FROM cs_relay WHERE message_id = ?').get(quoted.id)?.ticket_id) : null;

    if (!text) return replyAgent(msg, agent, '⚠️ Saat ini hanya pesan teks yang bisa diteruskan ke pelanggan.');

    let m;
    if (/^#(list|daftar)$/i.test(text)) {
      const list = mine();
      const free = db.prepare("SELECT * FROM cs_tickets WHERE agent_id IS NULL AND status = 'open' ORDER BY id").all();
      return replyAgent(msg, agent,
        (list.length ? `📋 *Chat terbuka Anda (${list.length})*\n${list.map((t) => `#${t.id} ${t.name || localPhone(t.phone)}`).join('\n')}` : '📋 Tidak ada chat terbuka.') +
        (free.length ? `\n\n🕐 *Belum ada petugas (${free.length})*\n${free.map((t) => `#${t.id} ${t.name || localPhone(t.phone)} — ketik *#ambil ${t.id}*`).join('\n')}` : ''));
    }
    if ((m = text.match(/^#(on|off)$/i))) {
      const on = m[1].toLowerCase() === 'on';
      db.prepare('UPDATE cs_agents SET on_duty = ? WHERE id = ?').run(on ? 1 : 0, agent.id);
      replyAgent(msg, agent, on ? '🟢 Anda sekarang *bertugas*. Chat baru akan diteruskan ke Anda.' : '⚪ Anda *tidak bertugas*. Chat baru tidak diteruskan ke Anda. Ketik *#on* untuk kembali.');
      if (on) assignPending();
      return;
    }
    if ((m = text.match(/^#(selesai|tutup)\s*(\d+)?\s*$/i))) {
      const list = mine();
      const t = m[2] ? ticketById(Number(m[2])) : quotedTicket ?? (list.length === 1 ? list[0] : null);
      if (!t || t.status !== 'open') return replyAgent(msg, agent, m[2] ? `Chat #${m[2]} tidak ditemukan atau sudah ditutup.` : 'Sebutkan nomornya, mis. *#selesai 12*');
      if (t.agent_id !== agent.id) return replyAgent(msg, agent, `Chat #${t.id} bukan milik Anda.`);
      closeTicket(t, 'selesai', { notifyCustomer: true, by: agent.name });
      return replyAgent(msg, agent, `✅ Chat #${t.id} ditutup.`);
    }
    if ((m = text.match(/^#ambil\s*(\d+)$/i))) {
      const t = ticketById(Number(m[1]));
      if (!t || t.status !== 'open') return replyAgent(msg, agent, `Chat #${m[1]} tidak ditemukan atau sudah ditutup.`);
      if (t.agent_id && t.agent_id !== agent.id) return replyAgent(msg, agent, `Chat #${t.id} sudah ditangani petugas lain.`);
      if (!t.agent_id) assign(t, agent, { announce: true });
      return;
    }
    if ((m = text.match(/^#(\d+)\s+([\s\S]+)$/))) {
      const t = ticketById(Number(m[1]));
      if (!t || t.status !== 'open') return replyAgent(msg, agent, `Chat #${m[1]} tidak ditemukan atau sudah ditutup.`);
      if (t.agent_id && t.agent_id !== agent.id) return replyAgent(msg, agent, `Chat #${t.id} ditangani petugas lain.`);
      if (!t.agent_id) assign(t, agent, { announce: false });
      return toCustomer(t, m[2].trim(), agent.name);
    }
    if (text.startsWith('#')) return replyAgent(msg, agent, HELP(agent));

    // Balasan biasa: ke chat yang dikutip, atau satu-satunya chat terbuka
    const list = mine();
    const t = quotedTicket ?? (list.length === 1 ? list[0] : null);
    if (t && t.status === 'open' && t.agent_id === agent.id) return toCustomer(t, text, agent.name);
    if (quotedTicket && quotedTicket.status !== 'open') return replyAgent(msg, agent, `Chat #${quotedTicket.id} sudah ditutup. Pesan tidak diteruskan.`);
    if (!list.length) return replyAgent(msg, agent, `Anda tidak punya chat terbuka, pesan tidak diteruskan.\n\n${HELP(agent)}`);
    return replyAgent(msg, agent,
      `Anda punya ${list.length} chat terbuka. *Balas (kutip)* notifikasinya, atau tulis *#nomor teks*:\n${list.map((x) => `#${x.id} ${x.name || localPhone(x.phone)}`).join('\n')}`);
  }

  function assignPending() {
    for (const t of db.prepare("SELECT * FROM cs_tickets WHERE status = 'open' AND agent_id IS NULL ORDER BY id").all()) {
      if (!tryAssign(t, { announce: true })) break;
    }
  }

  // ---- Alur pesan masuk -------------------------------------------------------------------
  // Paling awal (3): pesan petugas & pelanggan yang sedang punya tiket terbuka
  wa.addIncomingHandler({
    priority: 3,
    handle(msg) {
      if (!isEnabled() || msg.isGroup) return;
      const agent = findAgent(msg);
      if (agent) {
        msg.handled = true;
        msg.internal = true;
        handleAgent(msg, agent);
        return;
      }
      const t = openTicketFor(msg.deviceId, msg.chatJid);
      if (!t) return;
      msg.handled = true; // bot & Autoreply diam selama ditangani CS
      msg.csTicket = t.id;
      note(t.id, msg.body ?? msg.text ?? '', 'in', t.name);
      touch(t.id);
      if (msg.pushName && !t.name) db.prepare('UPDATE cs_tickets SET name = ? WHERE id = ?').run(msg.pushName, t.id);
      const agent2 = t.agent_id ? agentById(t.agent_id) : null;
      if (agent2) toAgent(t, agent2, `💬 *#${t.id} ${t.name || localPhone(t.phone)}:* ${msg.body ?? msg.text}`);
      else tryAssign(t, { announce: true });
    },
  });
  // Penanda Pesan Masuk (setelah dicatat di prioritas 10)
  wa.addIncomingHandler({
    priority: 11,
    handle(msg) {
      if (msg.csTicket) {
        const t = ticketById(msg.csTicket);
        inboxMark(msg, t?.agent_id ? `CS: ${agentById(t.agent_id)?.name ?? ''} (#${t.id})` : `CS: menunggu petugas (#${t.id})`);
      }
    },
  });
  // Paling akhir (30): mode "semua chat" -> chat yang tidak dijawab otomatis jadi tiket baru
  wa.addIncomingHandler({
    priority: 30,
    handle(msg) {
      if (!isEnabled() || msg.isGroup || msg.handled || msg.internal) return;
      if (loadSettings().mode !== 'all') return;
      if (Date.now() - msg.at > 10 * 60 * 1000) return;
      const t = createTicket(msg, 'Pesan masuk', { announce: true, context: 'inbox' });
      msg.handled = true;
      inboxMark(msg, t.agent_id ? `CS: ${agentById(t.agent_id)?.name ?? ''} (#${t.id})` : `CS: menunggu petugas (#${t.id})`);
    },
  });
  // Serah ke admin dari Chat Bot / AI -> tiket baru (bot sudah memberi tahu pelanggan, jadi tanpa sapaan)
  wa.onHandover((msg, source) => {
    if (!isEnabled() || msg.isGroup || openTicketFor(msg.deviceId, msg.chatJid)) return;
    const t = createTicket(msg, source, { announce: false, context: String(source).startsWith('Chat Bot') ? 'none' : 'message' });
    inboxMark(msg, t.agent_id ? `CS: ${agentById(t.agent_id)?.name ?? ''} (#${t.id})` : `CS: menunggu petugas (#${t.id})`);
  });

  // Tiket tanpa aktivitas ditutup otomatis; tiket menunggu dicoba dibagikan lagi
  const tick = () => {
    if (!isEnabled()) return;
    const s = loadSettings();
    if (s.autoCloseHours > 0) {
      for (const t of db.prepare("SELECT * FROM cs_tickets WHERE status = 'open' AND last_activity_at < datetime('now', ?)").all(`-${s.autoCloseHours} hours`)) {
        closeTicket(t, 'otomatis (tidak ada aktivitas)');
      }
    }
    assignPending();
  };
  setInterval(tick, 60_000).unref();

  // ---- API admin ------------------------------------------------------------------
  const fail = (res, err, code = 400) => res.status(code).json({ success: false, message: err.message });
  const time = (v) => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v ?? '')) ? String(v).padStart(5, '0') : '');

  function agentInput(b) {
    const phone = normalizePhone(b?.phone);
    if (!phone) throw new Error('Nomor WhatsApp petugas tidak valid');
    const known = new Set(devices.all().map((d) => d.id));
    if (devices.all().some((d) => d.phone === phone)) throw new Error('Nomor petugas tidak boleh sama dengan nomor device WhatsOrbit');
    return {
      name: String(b?.name ?? '').trim().slice(0, 60) || 'Petugas',
      phone,
      start: time(b?.start),
      end: time(b?.end),
      days: JSON.stringify(Array.isArray(b?.days) ? [...new Set(b.days.map(Number).filter((d) => d >= 0 && d <= 6))] : []),
      device_ids: JSON.stringify((Array.isArray(b?.device_ids) ? b.device_ids : []).filter((d) => known.has(d))),
      active: b?.active === false ? 0 : 1,
    };
  }

  router.get('/stats', (_req, res) => {
    const one = (sql) => db.prepare(sql).get().n ?? 0;
    res.json({
      success: true,
      data: {
        open: one("SELECT COUNT(*) AS n FROM cs_tickets WHERE status = 'open'"),
        unassigned: one("SELECT COUNT(*) AS n FROM cs_tickets WHERE status = 'open' AND agent_id IS NULL"),
        today: one("SELECT COUNT(*) AS n FROM cs_tickets WHERE date(created_at, 'localtime') = date('now', 'localtime')"),
        closedToday: one("SELECT COUNT(*) AS n FROM cs_tickets WHERE date(closed_at, 'localtime') = date('now', 'localtime')"),
        avgFirstResponseMin: Math.round(one(
          `SELECT AVG((julianday(first_response_at) - julianday(created_at)) * 1440) AS n FROM cs_tickets
            WHERE first_response_at IS NOT NULL AND created_at >= datetime('now', '-7 days')`)),
      },
    });
  });

  router.get('/agents', (_req, res) => {
    const rows = db.prepare('SELECT * FROM cs_agents ORDER BY name COLLATE NOCASE').all().map(hydrateAgent).map((a) => ({
      ...a,
      onShift: onShift(a),
      open: openCount(a.id),
      today: db.prepare("SELECT COUNT(*) AS n FROM cs_tickets WHERE agent_id = ? AND date(assigned_at, 'localtime') = date('now', 'localtime')").get(a.id).n,
    }));
    res.json({ success: true, data: rows });
  });

  router.post('/agents', (req, res) => {
    try {
      const v = agentInput(req.body);
      if (db.prepare('SELECT 1 FROM cs_agents WHERE phone = ?').get(v.phone)) throw new Error('Nomor ini sudah terdaftar sebagai petugas');
      const r = db.prepare('INSERT INTO cs_agents (name, phone, start, end, days, device_ids, active) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(v.name, v.phone, v.start, v.end, v.days, v.device_ids, v.active);
      assignPending(); // chat yang menunggu langsung dibagikan
      res.json({ success: true, data: agentById(Number(r.lastInsertRowid)) });
    } catch (err) { fail(res, err); }
  });

  router.put('/agents/:id', (req, res) => {
    const a = agentById(Number(req.params.id));
    if (!a) return fail(res, new Error('Petugas tidak ditemukan'), 404);
    try {
      const v = agentInput(req.body);
      const other = db.prepare('SELECT id FROM cs_agents WHERE phone = ?').get(v.phone);
      if (other && other.id !== a.id) throw new Error('Nomor ini sudah dipakai petugas lain');
      db.prepare('UPDATE cs_agents SET name = ?, phone = ?, start = ?, end = ?, days = ?, device_ids = ?, active = ?, jid = CASE WHEN phone = ? THEN jid ELSE NULL END WHERE id = ?')
        .run(v.name, v.phone, v.start, v.end, v.days, v.device_ids, v.active, v.phone, a.id);
      assignPending();
      res.json({ success: true, data: agentById(a.id) });
    } catch (err) { fail(res, err); }
  });

  router.patch('/agents/:id/duty', (req, res) => {
    db.prepare('UPDATE cs_agents SET on_duty = ? WHERE id = ?').run(req.body?.on ? 1 : 0, Number(req.params.id));
    if (req.body?.on) assignPending();
    res.json({ success: true });
  });

  router.delete('/agents/:id', (req, res) => {
    // Chat terbuka miliknya kembali ke antrean
    db.prepare("UPDATE cs_tickets SET agent_id = NULL WHERE agent_id = ? AND status = 'open'").run(Number(req.params.id));
    db.prepare('DELETE FROM cs_agents WHERE id = ?').run(Number(req.params.id));
    assignPending();
    res.json({ success: true });
  });

  router.get('/tickets', (req, res) => {
    const st = req.query.status;
    const where = st === 'closed' ? "t.status = 'closed'" : st === 'unassigned' ? "t.status = 'open' AND t.agent_id IS NULL" : "t.status = 'open'";
    const q = String(req.query.q ?? '').trim();
    const params = [];
    let qsql = '';
    if (q) {
      qsql = ' AND (t.name LIKE ? OR t.phone LIKE ? OR CAST(t.id AS TEXT) = ?)';
      params.push(`%${q}%`, `%${q.replace(/\D/g, '').replace(/^0/, '') || q}%`, q.replace(/^#/, ''));
    }
    const rows = db.prepare(
      `SELECT t.*, a.name AS agent_name, d.name AS device_name,
              (SELECT text FROM cs_ticket_messages m WHERE m.ticket_id = t.id AND m.dir != 'note' ORDER BY m.id DESC LIMIT 1) AS last_text,
              (SELECT dir FROM cs_ticket_messages m WHERE m.ticket_id = t.id AND m.dir != 'note' ORDER BY m.id DESC LIMIT 1) AS last_dir
         FROM cs_tickets t LEFT JOIN cs_agents a ON a.id = t.agent_id LEFT JOIN devices d ON d.id = t.device_id
        WHERE ${where}${qsql} ORDER BY ${st === 'closed' ? 't.closed_at' : 't.last_activity_at'} DESC LIMIT 100`
    ).all(...params);
    res.json({ success: true, data: rows });
  });

  router.get('/tickets/:id', (req, res) => {
    const t = db.prepare('SELECT t.*, a.name AS agent_name, d.name AS device_name FROM cs_tickets t LEFT JOIN cs_agents a ON a.id = t.agent_id LEFT JOIN devices d ON d.id = t.device_id WHERE t.id = ?').get(Number(req.params.id));
    if (!t) return fail(res, new Error('Tiket tidak ditemukan'), 404);
    const thread = db.prepare('SELECT * FROM cs_ticket_messages WHERE ticket_id = ? ORDER BY id').all(t.id);
    res.json({ success: true, data: { ...t, thread } });
  });

  router.post('/tickets/:id/reply', (req, res) => {
    const t = ticketById(Number(req.params.id));
    if (!t || t.status !== 'open') return fail(res, new Error('Tiket tidak ditemukan atau sudah ditutup'));
    const text = String(req.body?.text ?? '').trim();
    if (!text) return fail(res, new Error('Isi balasan wajib diisi'));
    toCustomer(t, text, 'Admin');
    // Petugas yang menangani ikut tahu
    const agent = t.agent_id ? agentById(t.agent_id) : null;
    if (agent) toAgent(t, agent, `ℹ️ Admin membalas #${t.id}: ${text}`);
    res.json({ success: true });
  });

  router.post('/tickets/:id/assign', (req, res) => {
    const t = ticketById(Number(req.params.id));
    if (!t || t.status !== 'open') return fail(res, new Error('Tiket tidak ditemukan atau sudah ditutup'));
    const agent = agentById(Number(req.body?.agentId));
    if (!agent) return fail(res, new Error('Pilih petugas'));
    const prev = t.agent_id ? agentById(t.agent_id) : null;
    if (prev && prev.id !== agent.id) toAgent(t, prev, `↪️ Chat #${t.id} dipindahkan ke ${agent.name}.`);
    assign(t, agent, { announce: false });
    res.json({ success: true });
  });

  router.post('/tickets/:id/close', (req, res) => {
    const t = ticketById(Number(req.params.id));
    if (!t) return fail(res, new Error('Tiket tidak ditemukan'), 404);
    closeTicket(t, 'ditutup admin', { notifyCustomer: !!req.body?.notify, by: 'Admin' });
    res.json({ success: true });
  });

  router.get('/settings', (_req, res) => res.json({ success: true, data: loadSettings(), defaults: DEFAULTS }));
  router.put('/settings', (req, res) => {
    const b = req.body ?? {};
    const cur = loadSettings();
    const next = {
      mode: b.mode === 'all' ? 'all' : b.mode === 'handover' ? 'handover' : cur.mode,
      greetText: b.greetText === undefined ? cur.greetText : String(b.greetText).trim().slice(0, 500),
      offlineText: b.offlineText === undefined ? cur.offlineText : String(b.offlineText).trim().slice(0, 500),
      closeText: b.closeText === undefined ? cur.closeText : String(b.closeText).trim().slice(0, 500),
      autoCloseHours: Math.max(0, Math.min(720, Number.parseInt(b.autoCloseHours ?? cur.autoCloseHours, 10) || 0)),
    };
    setSetting('cs', JSON.stringify(next));
    res.json({ success: true, data: next });
  });
}
