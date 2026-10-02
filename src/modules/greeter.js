// Modul Group Greeter: sapa anggota baru (dan opsional pamit) di grup WhatsApp.
import { db, devices, messages } from '../db.js';
import { render } from '../template.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS group_greeters (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id      TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    group_jid      TEXT NOT NULL,
    group_name     TEXT NOT NULL DEFAULT '',
    active         INTEGER NOT NULL DEFAULT 1,
    welcome_text   TEXT NOT NULL,
    goodbye_active INTEGER NOT NULL DEFAULT 0,
    goodbye_text   TEXT NOT NULL DEFAULT '',
    dm_active      INTEGER NOT NULL DEFAULT 0,
    dm_text        TEXT NOT NULL DEFAULT '',
    batch_seconds  INTEGER NOT NULL DEFAULT 60,
    greeted        INTEGER NOT NULL DEFAULT 0,
    last_at        TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (device_id, group_jid)
  );
  CREATE TABLE IF NOT EXISTS group_names (
    device_id TEXT NOT NULL,
    jid       TEXT NOT NULL,
    subject   TEXT NOT NULL,
    PRIMARY KEY (device_id, jid)
  );
  CREATE TABLE IF NOT EXISTS group_greeter_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    greeter_id INTEGER NOT NULL REFERENCES group_greeters(id) ON DELETE CASCADE,
    action     TEXT NOT NULL,          -- welcome | goodbye | dm
    count      INTEGER NOT NULL,
    body       TEXT NOT NULL,
    at         TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export const DEFAULT_WELCOME =
  '{Selamat datang|Ahlan wa sahlan|Halo} [Nama] di grup *[Grup]* 👋\n\n' +
  'Mohon membaca deskripsi grup dan menjaga komunikasi tetap sopan. Terima kasih 🙏';
export const DEFAULT_GOODBYE = 'Terima kasih [Nama] sudah bergabung di *[Grup]*. Sampai jumpa 👋';
export const DEFAULT_DM = 'Halo, selamat datang di grup *[Grup]* 🙏\nSilakan simpan nomor ini untuk informasi resmi dari sekolah.';

const MAX_MENTIONS = 20; // per pesan
const digits = (jid) => jid?.split('@')[0]?.split(':')[0] ?? '';
const hydrate = (g) => g && { ...g, active: !!g.active, goodbye_active: !!g.goodbye_active, dm_active: !!g.dm_active };

/** Teks sapaan untuk beberapa anggota sekaligus + daftar mention. */
export function compose(template, people, { group = '', size = '' } = {}) {
  const tags = people.map((p) => `@${digits(p.jid)}`);
  const list = tags.length <= 1 ? tags.join('') : `${tags.slice(0, -1).join(', ')} dan ${tags[tags.length - 1]}`;
  return {
    text: render(template, { Nama: list, Grup: group, Jumlah: String(size) }).trim(),
    mentions: people.map((p) => p.jid),
  };
}

export async function register({ router, wa, isEnabled }) {
  // Kumpulkan peristiwa per grup selama batch_seconds, lalu kirim satu pesan
  const pending = new Map(); // key: greeterId|action -> { people: Map, timer }

  async function flush(g, action) {
    const key = `${g.id}|${action}`;
    const p = pending.get(key);
    pending.delete(key);
    if (!p || !isEnabled()) return;
    const fresh = hydrate(db.prepare('SELECT * FROM group_greeters WHERE id = ?').get(g.id));
    if (!fresh?.active) return;
    const people = [...p.people.values()];
    const info = (await wa.groupInfo(fresh.device_id, fresh.group_jid)) ?? { subject: fresh.group_name, size: '' };
    if (info.subject && info.subject !== fresh.group_name) db.prepare('UPDATE group_greeters SET group_name = ? WHERE id = ?').run(info.subject, fresh.id);
    const template = action === 'goodbye' ? fresh.goodbye_text : fresh.welcome_text;
    for (let i = 0; i < people.length; i += MAX_MENTIONS) {
      const chunk = people.slice(i, i + MAX_MENTIONS);
      const { text, mentions } = compose(template, chunk, { group: info.subject, size: info.size });
      if (!text) continue;
      messages.enqueue(fresh.device_id, digits(fresh.group_jid), text, fresh.group_jid, 'reply', { mentions });
      db.prepare('INSERT INTO group_greeter_log (greeter_id, action, count, body) VALUES (?, ?, ?, ?)').run(fresh.id, action, chunk.length, text);
    }
    // Pesan pribadi ke anggota baru (dihitung sebagai pesan yang kita mulai -> ikut kuota anti-banned)
    if (action === 'welcome' && fresh.dm_active && fresh.dm_text) {
      for (const person of people) {
        const body = render(fresh.dm_text, { Nama: person.name || '', Grup: info.subject, Jumlah: String(info.size) }).trim();
        if (!body) continue;
        const to = person.phone ?? digits(person.jid);
        messages.enqueue(fresh.device_id, to, body, person.jid, 'manual');
        db.prepare("INSERT INTO group_greeter_log (greeter_id, action, count, body) VALUES (?, 'dm', 1, ?)").run(fresh.id, body);
      }
    }
    db.prepare("UPDATE group_greeters SET greeted = greeted + ?, last_at = datetime('now') WHERE id = ?")
      .run(action === 'welcome' ? people.length : 0, fresh.id);
    wa.drainQueue(fresh.device_id);
  }

  wa.addGroupHandler((ev) => {
    if (!isEnabled()) return;
    const action = ev.action === 'add' ? 'welcome' : ev.action === 'remove' ? 'goodbye' : null;
    if (!action) return;
    const g = hydrate(db.prepare('SELECT * FROM group_greeters WHERE device_id = ? AND group_jid = ?').get(ev.deviceId, ev.groupJid));
    if (!g?.active || (action === 'goodbye' && !g.goodbye_active)) return;
    const key = `${g.id}|${action}`;
    let p = pending.get(key);
    if (!p) {
      p = { people: new Map() };
      pending.set(key, p);
      p.timer = setTimeout(() => flush(g, action).catch((err) => wa.logger.warn({ err: err.message }, 'greeter gagal')), Math.max(5, g.batch_seconds) * 1000);
    }
    for (const person of ev.participants) p.people.set(person.jid, person);
  });

  // ---- API admin ------------------------------------------------------------------
  const fail = (res, err, code = 400) => res.status(code).json({ success: false, message: err.message });

  /** Grup milik device + status greeter-nya. */
  router.get('/groups', async (req, res) => {
    const deviceId = String(req.query.device ?? '');
    if (!devices.get(deviceId)) return fail(res, new Error('Pilih device'));
    const saved = Object.fromEntries(db.prepare('SELECT * FROM group_greeters WHERE device_id = ?').all(deviceId).map((g) => [g.group_jid, hydrate(g)]));
    let groups = [];
    let offline = false;
    try {
      groups = await wa.listGroups(deviceId);
      // Simpan nama grup (dipakai juga oleh Web WhatsApp)
      const up = db.prepare('INSERT INTO group_names (device_id, jid, subject) VALUES (?, ?, ?) ON CONFLICT(device_id, jid) DO UPDATE SET subject = excluded.subject');
      for (const g of groups) if (g.subject) up.run(deviceId, g.id, g.subject);
    } catch {
      offline = true; // device offline: tampilkan yang sudah tersimpan saja
      groups = Object.values(saved).map((g) => ({ id: g.group_jid, subject: g.group_name, size: null, announce: false, meAdmin: null }));
    }
    for (const g of groups) if (saved[g.id] && g.subject && g.subject !== saved[g.id].group_name) {
      db.prepare('UPDATE group_greeters SET group_name = ? WHERE id = ?').run(g.subject, saved[g.id].id);
    }
    res.json({ success: true, offline, data: groups.map((g) => ({ ...g, greeter: saved[g.id] ?? null })) });
  });

  router.put('/', (req, res) => {
    const b = req.body ?? {};
    const device = devices.get(String(b.device ?? ''));
    if (!device) return fail(res, new Error('Pilih device'));
    const jid = String(b.groupJid ?? '');
    if (!jid.endsWith('@g.us')) return fail(res, new Error('Grup tidak valid'));
    const welcome = String(b.welcome_text ?? '').trim();
    if (!welcome) return fail(res, new Error('Isi pesan sambutan'));
    const v = {
      name: String(b.groupName ?? '').slice(0, 120),
      active: b.active === false ? 0 : 1,
      welcome: welcome.slice(0, 2000),
      goodbyeActive: b.goodbye_active ? 1 : 0,
      goodbye: String(b.goodbye_text ?? '').trim().slice(0, 2000),
      dmActive: b.dm_active ? 1 : 0,
      dm: String(b.dm_text ?? '').trim().slice(0, 2000),
      batch: Math.max(5, Math.min(600, Number.parseInt(b.batch_seconds, 10) || 60)),
    };
    db.prepare(
      `INSERT INTO group_greeters (device_id, group_jid, group_name, active, welcome_text, goodbye_active, goodbye_text, dm_active, dm_text, batch_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(device_id, group_jid) DO UPDATE SET group_name = excluded.group_name, active = excluded.active,
         welcome_text = excluded.welcome_text, goodbye_active = excluded.goodbye_active, goodbye_text = excluded.goodbye_text,
         dm_active = excluded.dm_active, dm_text = excluded.dm_text, batch_seconds = excluded.batch_seconds`
    ).run(device.id, jid, v.name, v.active, v.welcome, v.goodbyeActive, v.goodbye, v.dmActive, v.dm, v.batch);
    res.json({ success: true, data: hydrate(db.prepare('SELECT * FROM group_greeters WHERE device_id = ? AND group_jid = ?').get(device.id, jid)) });
  });

  router.patch('/:id/active', (req, res) => {
    db.prepare('UPDATE group_greeters SET active = ? WHERE id = ?').run(req.body?.active ? 1 : 0, Number(req.params.id));
    res.json({ success: true });
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM group_greeters WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true });
  });

  /** Pratinjau teks (tanpa mengirim). */
  router.post('/preview', (req, res) => {
    const people = [{ jid: '6281234567890@s.whatsapp.net' }, { jid: '6281311112222@s.whatsapp.net' }].slice(0, req.body?.many ? 2 : 1);
    const r = compose(String(req.body?.template ?? ''), people, { group: String(req.body?.group ?? 'Nama Grup'), size: 45 });
    res.json({ success: true, data: { text: r.text.replace(/@6281234567890/g, '@Budi').replace(/@6281311112222/g, '@Siti') } });
  });

  router.get('/log', (_req, res) => {
    res.json({
      success: true,
      data: db.prepare(
        `SELECT l.*, g.group_name FROM group_greeter_log l JOIN group_greeters g ON g.id = l.greeter_id ORDER BY l.id DESC LIMIT 50`
      ).all(),
      defaults: { welcome: DEFAULT_WELCOME, goodbye: DEFAULT_GOODBYE, dm: DEFAULT_DM },
    });
  });

  const cleanup = () => db.prepare("DELETE FROM group_greeter_log WHERE at < datetime('now', '-90 days')").run();
  cleanup();
  setInterval(cleanup, 24 * 3600 * 1000).unref();
}
