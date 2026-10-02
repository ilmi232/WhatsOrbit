// Modul Daily Leads: hanya dimuat kalau fitur "leads" aktif (butuh fitur Kontak).
import { db } from '../db.js';
import { normalizePhone } from '../phone.js';
import { contacts } from '../contacts.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    phone      TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    source     TEXT NOT NULL DEFAULT 'Google Form',
    group_name TEXT NOT NULL DEFAULT '',
    fields     TEXT NOT NULL DEFAULT '{}',
    is_new     INTEGER NOT NULL DEFAULT 1,  -- 1 = kontak baru, 0 = kontak sudah ada sebelumnya
    device_id  TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
  CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
`);

const LOCAL_DAY = "date(created_at, 'localtime')";

/** Filter tanggal (YYYY-MM-DD, waktu lokal PC), sumber, dan kata kunci. */
function where({ from, to, source, q }) {
  const w = [];
  const p = [];
  if (from) { w.push(`${LOCAL_DAY} >= ?`); p.push(from); }
  if (to) { w.push(`${LOCAL_DAY} <= ?`); p.push(to); }
  if (source) { w.push('source = ?'); p.push(source); }
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const digits = q.replace(/\D/g, '').replace(/^0/, '');
    w.push(`(name LIKE ? OR fields LIKE ?${digits.length >= 3 ? ' OR phone LIKE ?' : ''})`);
    p.push(like, like);
    if (digits.length >= 3) p.push(`%${digits}%`);
  }
  return { sql: w.length ? `WHERE ${w.join(' AND ')}` : '', params: p };
}

const hydrate = (r) => ({ ...r, fields: JSON.parse(r.fields), is_new: !!r.is_new });
const day = (offset = 0) => {
  const d = new Date(Date.now() - offset * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function register({ router, hooks }) {
  // ---- Simpan lead dari API (/api/send dengan "lead", atau /api/lead) ------------
  hooks.lead = ({ device, lead }) => {
    const phone = normalizePhone(lead.phone);
    if (!phone) throw new Error('Nomor lead tidak valid');
    const name = String(lead.name ?? '').trim();
    const source = String(lead.source ?? '').trim() || 'Google Form';
    const groupName = String(lead.group ?? '').trim();

    // Buang kolom nama & nomor dari data tambahan (sudah tersimpan terpisah)
    const fields = {};
    for (const [k, v] of Object.entries(lead.fields ?? {})) {
      const val = String(v ?? '').trim();
      if (!val) continue;
      if (lead.nameField && k.trim().toLowerCase() === String(lead.nameField).trim().toLowerCase()) continue;
      if (normalizePhone(val) === phone && /\d{8,}/.test(val.replace(/\D/g, ''))) continue;
      fields[k.trim()] = val;
    }

    const r = contacts.upsert({ phone, name, fields, groupName });
    db.prepare(
      'INSERT INTO leads (contact_id, phone, name, source, group_name, fields, is_new, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(r.contactId, phone, name, source, groupName, JSON.stringify(fields), r.isNew ? 1 : 0, device?.id ?? null);
    return { contactId: r.contactId, isNew: r.isNew, group: groupName || null };
  };

  // ---- API admin ------------------------------------------------------------------
  router.get('/stats', (_req, res) => {
    const count = (from) => db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE ${LOCAL_DAY} >= ?`).get(from).n;
    const per = db
      .prepare(`SELECT ${LOCAL_DAY} AS day, COUNT(*) AS n, SUM(is_new) AS fresh FROM leads WHERE ${LOCAL_DAY} >= ? GROUP BY day`)
      .all(day(29));
    const map = Object.fromEntries(per.map((r) => [r.day, r]));
    const perDay = [];
    for (let i = 29; i >= 0; i--) {
      const d = day(i);
      perDay.push({ day: d, n: map[d]?.n ?? 0, fresh: map[d]?.fresh ?? 0 });
    }
    res.json({
      success: true,
      data: {
        today: count(day(0)),
        yesterday: perDay[perDay.length - 2].n,
        week: count(day(6)),
        month: count(day(29)),
        total: db.prepare('SELECT COUNT(*) AS n FROM leads').get().n,
        perDay,
        sources: db.prepare('SELECT source, COUNT(*) AS n, MAX(created_at) AS last FROM leads GROUP BY source ORDER BY last DESC').all(),
      },
    });
  });

  router.get('/', (req, res) => {
    const f = where(req.query);
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM leads ${f.sql}`).get(...f.params).n;
    const rows = db.prepare(`SELECT * FROM leads ${f.sql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...f.params, limit, offset).map(hydrate);
    res.json({ success: true, data: rows, total, limit, offset });
  });

  router.get('/export.csv', (req, res) => {
    const f = where(req.query);
    const rows = db.prepare(`SELECT * FROM leads ${f.sql} ORDER BY id`).all(...f.params).map(hydrate);
    const extra = [...new Set(rows.flatMap((r) => Object.keys(r.fields)))];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Waktu', 'Nama', 'Nomor', 'Sumber', 'Grup', 'Status', ...extra].map(q).join(',')];
    for (const r of rows) {
      const t = new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleString('id-ID');
      lines.push([t, r.name, `="${r.phone}"`, r.source, r.group_name, r.is_new ? 'Baru' : 'Sudah ada', ...extra.map((k) => r.fields[k] ?? '')].map(q).join(','));
    }
    const range = [req.query.from, req.query.to].filter(Boolean).join('_sd_') || 'semua';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${range}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM leads WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true });
  });
}
