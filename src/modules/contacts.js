// Modul Data & Group Kontak: hanya dimuat kalau fitur "contacts" aktif.
import { contacts, groups } from '../contacts.js';

const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });
const fail = (res, err, code = 400) => res.status(code).json({ success: false, message: err.message ?? String(err) });
const ids = (v) => (Array.isArray(v) ? v.map(Number).filter(Boolean) : []);

export async function register({ router }) {
  // ---- Grup ----------------------------------------------------------------
  router.get('/groups', (_req, res) =>
    ok(res, groups.all(), { total: contacts.count(), ungrouped: groups.ungroupedCount() })
  );

  router.post('/groups', (req, res) => {
    try {
      const id = groups.create(req.body ?? {});
      ok(res, groups.get(id));
    } catch (err) { fail(res, err); }
  });

  router.patch('/groups/:id', (req, res) => {
    try {
      groups.update(Number(req.params.id), req.body ?? {});
      ok(res, groups.get(Number(req.params.id)));
    } catch (err) { fail(res, err); }
  });

  router.delete('/groups/:id', (req, res) => {
    groups.remove(Number(req.params.id));
    ok(res, null);
  });

  // ---- Import / export -------------------------------------------------------
  router.post('/import/preview', (req, res) => {
    const p = contacts.parseImport(req.body?.text);
    ok(res, {
      columns: p.columns,
      nameColumn: p.nameColumn,
      phoneColumn: p.phoneColumn,
      total: p.rows.length,
      existing: p.existing,
      duplicates: p.duplicates,
      invalidCount: p.invalid.length,
      invalid: p.invalid.slice(0, 20),
      sample: p.rows.slice(0, 5),
    });
  });

  router.post('/import', (req, res) => {
    try {
      const p = contacts.parseImport(req.body?.text);
      if (!p.rows.length) throw new Error('Tidak ada nomor valid untuk diimport');
      let groupId = Number(req.body?.groupId) || null;
      const newGroup = String(req.body?.newGroup ?? '').trim();
      if (newGroup) groupId = groups.byName(newGroup)?.id ?? groups.create({ name: newGroup });
      const r = contacts.import(p.rows, { groupId, mode: req.body?.mode === 'skip' ? 'skip' : 'update' });
      ok(res, { ...r, invalid: p.invalid.length, groupId });
    } catch (err) { fail(res, err); }
  });

  router.get('/export.csv', (req, res) => {
    const groupId = req.query.group || null;
    const name = groupId && groupId !== 'none' ? groups.get(Number(groupId))?.name ?? 'grup' : groupId === 'none' ? 'tanpa-grup' : 'semua';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kontak-${name.replace(/[^\w-]+/g, '-').toLowerCase()}.csv"`);
    res.send(contacts.exportCsv(groupId));
  });

  router.get('/fields', (_req, res) => ok(res, contacts.fieldNames()));

  // ---- Aksi massal -----------------------------------------------------------
  router.post('/bulk', (req, res) => {
    const list = ids(req.body?.ids);
    if (!list.length) return fail(res, new Error('Pilih kontak dulu'));
    const action = req.body?.action;
    const groupId = Number(req.body?.groupId);
    if (action === 'delete') contacts.removeMany(list);
    else if (action === 'addToGroup' && groupId) contacts.addToGroup(list, groupId);
    else if (action === 'removeFromGroup' && groupId) contacts.removeFromGroup(list, groupId);
    else return fail(res, new Error('Aksi tidak dikenal'));
    ok(res, { count: list.length });
  });

  // ---- Kontak ----------------------------------------------------------------
  router.get('/', (req, res) => {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const { total, rows } = contacts.list({ q: String(req.query.q ?? '').trim(), groupId: req.query.group || null, limit, offset });
    ok(res, rows, { total, limit, offset });
  });

  router.post('/', (req, res) => {
    try {
      const id = contacts.create({ ...req.body, groupIds: ids(req.body?.groupIds) });
      ok(res, contacts.get(id));
    } catch (err) { fail(res, err); }
  });

  router.patch('/:id', (req, res) => {
    try {
      const b = req.body ?? {};
      contacts.update(Number(req.params.id), { ...b, groupIds: b.groupIds === undefined ? undefined : ids(b.groupIds) });
      ok(res, contacts.get(Number(req.params.id)));
    } catch (err) { fail(res, err); }
  });

  router.delete('/:id', (req, res) => {
    contacts.removeMany([Number(req.params.id)]);
    ok(res, null);
  });
}
