import { db } from './db.js';
import { normalizePhone } from './phone.js';
import { NAME_HEADER, parseTable } from './tabular.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL DEFAULT '',
    fields     TEXT NOT NULL DEFAULT '{}',  -- JSON {Kelas: "9A", ...}
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contact_groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT '#1ea5e3',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contact_group_members (
    group_id   INTEGER NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, contact_id)
  );

  CREATE INDEX IF NOT EXISTS idx_members_contact ON contact_group_members(contact_id);
  CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
`);

const COLORS = ['#1ea5e3', '#ac39d4', '#3fd1a6', '#4b26e8', '#ff9f1c', '#ff5b5b', '#2bc155', '#e83e8c'];

function cleanFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = String(k).trim();
    const val = String(v ?? '').trim();
    if (key && val) out[key] = val;
  }
  return out;
}

function hydrate(row) {
  if (!row) return row;
  return {
    ...row,
    fields: JSON.parse(row.fields),
    groupIds: row.group_ids ? row.group_ids.split(',').map(Number) : [],
    group_ids: undefined,
  };
}

function withTransaction(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const SELECT = `
  SELECT c.*, (SELECT group_concat(group_id) FROM contact_group_members m WHERE m.contact_id = c.id) AS group_ids
    FROM contacts c`;

export const contacts = {
  /** Cari kontak; q mencocokkan nama, nomor, atau isi kolom. */
  list({ q = '', groupId = null, limit = 50, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (q) {
      const like = `%${q.replace(/[%_]/g, '')}%`;
      const digits = q.replace(/\D/g, '');
      where.push(`(c.name LIKE ? OR c.fields LIKE ?${digits.length >= 3 ? ' OR c.phone LIKE ?' : ''})`);
      params.push(like, like);
      if (digits.length >= 3) params.push(`%${digits.replace(/^0/, '')}%`);
    }
    if (groupId === 'none') {
      where.push('NOT EXISTS (SELECT 1 FROM contact_group_members m WHERE m.contact_id = c.id)');
    } else if (groupId) {
      where.push('EXISTS (SELECT 1 FROM contact_group_members m WHERE m.contact_id = c.id AND m.group_id = ?)');
      params.push(Number(groupId));
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM contacts c ${w}`).get(...params).n;
    const rows = db
      .prepare(`${SELECT} ${w} ORDER BY c.name COLLATE NOCASE, c.id LIMIT ? OFFSET ?`)
      .all(...params, limit, offset)
      .map(hydrate);
    return { total, rows };
  },

  get: (id) => hydrate(db.prepare(`${SELECT} WHERE c.id = ?`).get(id)),
  byPhone: (phone) => db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone),
  count: () => db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n,

  /** Simpan kontak baru. Melempar error kalau nomor tidak valid / sudah ada. */
  create({ name = '', phone, fields = {}, groupIds = [] }) {
    const p = normalizePhone(phone);
    if (!p) throw new Error('Nomor tidak valid');
    if (contacts.byPhone(p)) throw new Error('Nomor sudah ada di kontak');
    return withTransaction(() => {
      const r = db
        .prepare('INSERT INTO contacts (phone, name, fields) VALUES (?, ?, ?)')
        .run(p, String(name).trim(), JSON.stringify(cleanFields(fields)));
      const id = Number(r.lastInsertRowid);
      contacts.setGroups(id, groupIds);
      return id;
    });
  },

  update(id, { name, phone, fields, groupIds }) {
    const cur = contacts.get(id);
    if (!cur) throw new Error('Kontak tidak ditemukan');
    const p = phone === undefined ? cur.phone : normalizePhone(phone);
    if (!p) throw new Error('Nomor tidak valid');
    const other = contacts.byPhone(p);
    if (other && other.id !== cur.id) throw new Error('Nomor sudah dipakai kontak lain');
    withTransaction(() => {
      db.prepare("UPDATE contacts SET phone = ?, name = ?, fields = ?, updated_at = datetime('now') WHERE id = ?").run(
        p,
        name === undefined ? cur.name : String(name).trim(),
        JSON.stringify(fields === undefined ? cur.fields : cleanFields(fields)),
        id
      );
      if (groupIds !== undefined) contacts.setGroups(id, groupIds);
    });
  },

  /**
   * Simpan atau perbarui kontak berdasarkan nomor (dipakai Daily Leads).
   * Data kolom digabung, nama diganti kalau diisi, dan kontak dimasukkan ke grup
   * `groupName` (dibuat otomatis kalau belum ada).
   */
  upsert({ phone, name = '', fields = {}, groupName = '' }) {
    const p = normalizePhone(phone);
    if (!p) throw new Error('Nomor tidak valid');
    return withTransaction(() => {
      const cur = contacts.byPhone(p);
      let id;
      if (cur) {
        id = cur.id;
        const merged = { ...JSON.parse(cur.fields), ...cleanFields(fields) };
        db.prepare("UPDATE contacts SET name = ?, fields = ?, updated_at = datetime('now') WHERE id = ?")
          .run(String(name).trim() || cur.name, JSON.stringify(merged), id);
      } else {
        id = Number(
          db.prepare('INSERT INTO contacts (phone, name, fields) VALUES (?, ?, ?)')
            .run(p, String(name).trim(), JSON.stringify(cleanFields(fields))).lastInsertRowid
        );
      }
      let groupId = null;
      const gName = String(groupName ?? '').trim();
      if (gName) {
        groupId = groups.byName(gName)?.id ?? groups.create({ name: gName });
        db.prepare('INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)').run(groupId, id);
      }
      return { contactId: id, isNew: !cur, phone: p, groupId };
    });
  },

  setGroups(id, groupIds) {
    db.prepare('DELETE FROM contact_group_members WHERE contact_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)');
    for (const g of groupIds ?? []) ins.run(Number(g), id);
  },

  removeMany: (ids) => withTransaction(() => {
    const del = db.prepare('DELETE FROM contacts WHERE id = ?');
    for (const id of ids) del.run(Number(id));
  }),

  addToGroup: (ids, groupId) => withTransaction(() => {
    const ins = db.prepare('INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)');
    for (const id of ids) ins.run(Number(groupId), Number(id));
  }),

  removeFromGroup: (ids, groupId) => withTransaction(() => {
    const del = db.prepare('DELETE FROM contact_group_members WHERE group_id = ? AND contact_id = ?');
    for (const id of ids) del.run(Number(groupId), Number(id));
  }),

  /** Semua nama kolom tambahan yang pernah dipakai (untuk saran placeholder). */
  fieldNames() {
    const set = new Set();
    for (const r of db.prepare("SELECT DISTINCT fields FROM contacts WHERE fields != '{}'").all()) {
      for (const k of Object.keys(JSON.parse(r.fields))) set.add(k);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'id'));
  },

  // ---- Import / export ---------------------------------------------------
  /** Baca tabel tempel jadi daftar kontak {phone, name, fields}. */
  parseImport(text) {
    const t = parseTable(text);
    const nameIdx = t.columns.findIndex((c) => NAME_HEADER.test(c));
    const nameCol = nameIdx >= 0 ? t.columns[nameIdx] : null;
    const phoneCol = t.columns[t.phoneIdx];
    const rows = t.recipients.map((r) => {
      const fields = { ...r.vars };
      delete fields[phoneCol];
      const name = nameCol ? fields[nameCol] : '';
      if (nameCol) delete fields[nameCol];
      return { phone: r.phone, name, fields: cleanFields(fields) };
    });
    const existing = rows.filter((r) => contacts.byPhone(r.phone)).length;
    return {
      columns: t.columns,
      nameColumn: nameCol,
      phoneColumn: phoneCol,
      rows,
      existing,
      invalid: t.invalid,
      duplicates: t.duplicates,
    };
  },

  /** Simpan hasil import. mode: 'update' = timpa data lama, 'skip' = lewati nomor yang sudah ada. */
  import(rows, { groupId = null, mode = 'update' } = {}) {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    withTransaction(() => {
      const ins = db.prepare('INSERT INTO contacts (phone, name, fields) VALUES (?, ?, ?)');
      const upd = db.prepare("UPDATE contacts SET name = ?, fields = ?, updated_at = datetime('now') WHERE id = ?");
      const member = db.prepare('INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)');
      for (const r of rows) {
        const cur = contacts.byPhone(r.phone);
        let id;
        if (!cur) {
          id = Number(ins.run(r.phone, r.name, JSON.stringify(r.fields)).lastInsertRowid);
          created++;
        } else if (mode === 'update') {
          const merged = { ...JSON.parse(cur.fields), ...r.fields };
          upd.run(r.name || cur.name, JSON.stringify(merged), cur.id);
          id = cur.id;
          updated++;
        } else {
          id = cur.id;
          skipped++;
        }
        if (groupId) member.run(Number(groupId), id);
      }
    });
    return { created, updated, skipped };
  },

  /** CSV (pemisah koma, UTF-8 dengan BOM supaya Excel membaca huruf dengan benar). */
  exportCsv(groupId = null) {
    const { rows } = contacts.list({ groupId, limit: 1_000_000 });
    const groupNames = Object.fromEntries(groups.all().map((g) => [g.id, g.name]));
    const extra = [...new Set(rows.flatMap((r) => Object.keys(r.fields)))];
    const head = ['Nama', 'Nomor', ...extra, 'Grup'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head.map(q).join(',')];
    for (const r of rows) {
      // ="62..." supaya Excel tidak mengubah nomor jadi 6,28E+12 (import ulang tetap terbaca)
      lines.push([r.name, `="${r.phone}"`, ...extra.map((k) => r.fields[k] ?? ''), r.groupIds.map((g) => groupNames[g]).join('; ')].map(q).join(','));
    }
    return '﻿' + lines.join('\r\n');
  },

  /** Penerima blast dari satu atau beberapa grup (nomor ganda otomatis digabung). */
  recipientsForGroups(groupIds) {
    const ids = (groupIds ?? []).map(Number).filter(Boolean);
    if (!ids.length) return { columns: [], recipients: [], invalid: [], duplicates: 0 };
    const rows = db
      .prepare(
        `SELECT DISTINCT c.* FROM contacts c JOIN contact_group_members m ON m.contact_id = c.id
          WHERE m.group_id IN (${ids.map(() => '?').join(',')}) ORDER BY c.name COLLATE NOCASE`
      )
      .all(...ids);
    const parsed = rows.map((c) => ({ c, f: JSON.parse(c.fields) }));
    const extra = [...new Set(parsed.flatMap(({ f }) => Object.keys(f)))];
    // Kolom yang tidak dimiliki kontak diisi kosong, supaya [Kolom] tidak tercetak mentah
    const blank = Object.fromEntries(extra.map((k) => [k, '']));
    const recipients = parsed.map(({ c, f }) => ({
      phone: c.phone,
      vars: { ...blank, Nama: c.name, Nomor: '0' + c.phone.replace(/^62/, ''), ...f },
    }));
    return { columns: ['Nama', 'Nomor', ...extra], recipients, invalid: [], duplicates: 0 };
  },
};

export const groups = {
  all: () =>
    db
      .prepare(
        `SELECT g.*, (SELECT COUNT(*) FROM contact_group_members m WHERE m.group_id = g.id) AS members
           FROM contact_groups g ORDER BY g.name COLLATE NOCASE`
      )
      .all(),
  get: (id) => db.prepare('SELECT * FROM contact_groups WHERE id = ?').get(id),
  byName: (name) => db.prepare('SELECT * FROM contact_groups WHERE name = ?').get(String(name).trim()),
  create({ name, description = '', color }) {
    const n = String(name ?? '').trim();
    if (!n) throw new Error('Nama grup wajib diisi');
    if (groups.byName(n)) throw new Error('Nama grup sudah ada');
    const count = db.prepare('SELECT COUNT(*) AS n FROM contact_groups').get().n;
    const r = db
      .prepare('INSERT INTO contact_groups (name, description, color) VALUES (?, ?, ?)')
      .run(n, String(description).trim(), color || COLORS[count % COLORS.length]);
    return Number(r.lastInsertRowid);
  },
  update(id, { name, description, color }) {
    const g = groups.get(id);
    if (!g) throw new Error('Grup tidak ditemukan');
    const n = name === undefined ? g.name : String(name).trim();
    if (!n) throw new Error('Nama grup wajib diisi');
    const other = groups.byName(n);
    if (other && other.id !== g.id) throw new Error('Nama grup sudah ada');
    db.prepare('UPDATE contact_groups SET name = ?, description = ?, color = ? WHERE id = ?').run(
      n,
      description === undefined ? g.description : String(description).trim(),
      color || g.color,
      id
    );
  },
  remove: (id) => db.prepare('DELETE FROM contact_groups WHERE id = ?').run(id),
  ungroupedCount: () =>
    db.prepare('SELECT COUNT(*) AS n FROM contacts c WHERE NOT EXISTS (SELECT 1 FROM contact_group_members m WHERE m.contact_id = c.id)').get().n,
};
