// Modul Integrasi Lynk.id / Mayar.id: terima webhook pembayaran, kirim WhatsApp ke pembeli
// (terima kasih / pengingat bayar / membership), notifikasi admin, dan simpan ke Kontak.
//   Lynk.id  : header X-Lynk-Signature = sha256(grandTotal + refId + message_id + merchantKey)
//   Mayar.id : tidak bertanda tangan -> diamankan dengan token rahasia di URL
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PUBLIC_URL } from '../config.js';
import { db, devices, getSetting, messages, setSetting } from '../db.js';
import { normalizePhone } from '../phone.js';
import { render } from '../template.js';
import { emit } from '../events.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS payment_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    provider   TEXT NOT NULL,              -- lynk | mayar
    event      TEXT NOT NULL,
    ref        TEXT,
    name       TEXT,
    phone      TEXT,
    email      TEXT,
    product    TEXT,
    amount     INTEGER,
    status     TEXT NOT NULL,              -- sent | logged | duplicate | rejected | no_phone
    note       TEXT,
    message_ids TEXT,
    test       INTEGER NOT NULL DEFAULT 0,
    payload    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pay_ref ON payment_events (provider, event, ref);
  CREATE INDEX IF NOT EXISTS idx_pay_time ON payment_events (created_at);
`);

/** Jenis pesan otomatis per peristiwa. */
export const KINDS = {
  paid: { label: 'Pembayaran berhasil', events: ['payment.received'] },
  reminder: { label: 'Pengingat belum bayar', events: ['payment.reminder'] },
  member_new: { label: 'Member baru', events: ['membership.newMemberRegistered'] },
  member_expired: { label: 'Membership berakhir', events: ['membership.memberExpired'] },
};
const kindOf = (event) => Object.keys(KINDS).find((k) => KINDS[k].events.includes(event)) ?? null;

export const EVENT_LABEL = {
  'payment.received': 'Pembayaran berhasil',
  'payment.reminder': 'Belum dibayar (29 menit)',
  'shipper.status': 'Status pengiriman',
  'membership.newMemberRegistered': 'Member baru',
  'membership.memberExpired': 'Membership berakhir',
  'membership.memberUnsubscribed': 'Member berhenti',
  'membership.changeTierMemberRegistered': 'Ganti paket member',
};

const DEFAULT_TEXT = {
  paid: 'Halo [Nama] 👋\n{Terima kasih|Terima kasih banyak}, pembayaran *[Produk]* sebesar *[Total]* sudah kami terima ✅\n\nNo. transaksi: [Ref]\n\nSimpan nomor ini untuk informasi selanjutnya ya 🙏',
  reminder: 'Halo [Nama], pesanan *[Produk]* ([Total]) belum selesai dibayar. Lanjutkan pembayaran di sini:\n[LinkBayar]\n\nAbaikan pesan ini kalau sudah membayar 🙏',
  member_new: 'Halo [Nama], selamat bergabung di *[Produk]* 🎉\nKalau ada pertanyaan, balas saja pesan ini.',
  member_expired: 'Halo [Nama], keanggotaan *[Produk]* Anda sudah berakhir. Silakan perpanjang kapan saja 🙏',
  admin: '💰 *[Sumber]* · [Peristiwa]\n[Nama] ([Nomor])\n[Produk] · [Total]\nRef: [Ref]',
};

export const PROVIDERS = {
  lynk: { name: 'Lynk.id', kinds: ['paid'] },
  mayar: { name: 'Mayar.id', kinds: ['paid', 'reminder', 'member_new', 'member_expired'] },
};

const newToken = () => randomBytes(18).toString('base64url');
const rupiah = (n) => (n == null || Number.isNaN(Number(n)) ? '' : `Rp ${Number(n).toLocaleString('id-ID')}`);
const str = (v) => (v == null ? '' : String(v).trim());

function defaults(provider) {
  return {
    active: true,
    token: newToken(),
    merchantKey: '',
    deviceId: '',
    templates: Object.fromEntries(PROVIDERS[provider].kinds.map((k) => [k, { on: k === 'paid', text: DEFAULT_TEXT[k] }])),
    rules: [], // [{ match, text, group }] khusus pembayaran berhasil, per produk
    adminOn: false,
    adminPhones: '',
    adminText: DEFAULT_TEXT.admin,
    saveContact: true,
    contactGroup: provider === 'lynk' ? 'Pembeli Lynk.id' : 'Pembeli Mayar.id',
  };
}

export function loadSettings(provider) {
  const d = defaults(provider);
  const s = JSON.parse(getSetting(`pay_${provider}`, () => '{}'));
  if (!s.token) {
    s.token = d.token;
    setSetting(`pay_${provider}`, JSON.stringify({ ...d, ...s }));
  }
  return { ...d, ...s, templates: { ...d.templates, ...(s.templates ?? {}) } };
}
const saveSettings = (provider, s) => setSetting(`pay_${provider}`, JSON.stringify(s));
const hookUrl = (provider, token) => `${PUBLIC_URL || 'http://ALAMAT-PUBLIK'}/api/pay/${provider}/${token}`;

// ---- Pembaca payload -------------------------------------------------------------------------
/** Ubah payload Lynk.id / Mayar.id ke bentuk yang sama. */
export function parse(provider, body) {
  const event = str(body?.event) || 'unknown';
  if (provider === 'lynk') {
    const data = body?.data ?? {};
    const md = data.message_data ?? {};
    const items = Array.isArray(md.items) ? md.items : [];
    return {
      event,
      ref: str(md.refId) || null,
      messageId: str(data.message_id),
      name: str(md.customer?.name),
      phone: str(md.customer?.phone),
      email: str(md.customer?.email),
      product: items.map((i) => str(i.title)).filter(Boolean).join(', '),
      amount: md.totals?.grandTotal != null ? Number(md.totals.grandTotal) : null,
      qty: items.reduce((a, i) => a + (Number(i.qty) || 0), 0) || null,
      addons: items.flatMap((i) => (i.addons ?? []).map((a) => str(a.name))).filter(Boolean).join(', '),
      method: '',
      payUrl: '',
      status: str(data.message_action),
    };
  }
  const d = body?.data ?? {};
  const m = d.membershipCustomer ?? d.customer ?? {};
  return {
    event,
    ref: str(d.transactionId ?? d.id) || null,
    messageId: '',
    name: str(d.customerName ?? m.name),
    phone: str(d.customerMobile ?? m.mobile ?? m.phone),
    email: str(d.customerEmail ?? m.email),
    product: str(d.productName ?? d.membershipTierName ?? d.tierName ?? d.product?.name),
    amount: d.amount != null ? Number(d.amount) : null,
    qty: d.qty != null ? Number(d.qty) : null,
    addons: Array.isArray(d.addOn) ? d.addOn.map((a) => str(a?.name ?? a)).filter(Boolean).join(', ') : '',
    method: str(d.paymentMethod),
    payUrl: str(d.paymentUrl),
    status: str(d.transactionStatus ?? d.status),
  };
}

export function lynkSignature(body, key) {
  const md = body?.data?.message_data ?? {};
  return createHash('sha256')
    .update(`${md.totals?.grandTotal ?? ''}${md.refId ?? ''}${body?.data?.message_id ?? ''}${key}`)
    .digest('hex');
}

const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// ---- Contoh payload (tombol "Simulasi") -----------------------------------------------------
function sample(provider, kind, phone) {
  const ref = `TES-${Date.now().toString(36).toUpperCase()}`;
  if (provider === 'lynk') {
    return {
      event: 'payment.received',
      data: {
        message_action: 'SUCCESS', message_code: '0', message_id: `SIMULASI_${Date.now()}`,
        message_data: {
          createdAt: new Date().toISOString(),
          customer: { email: 'pembeli@contoh.id', name: 'Pembeli Simulasi', phone },
          items: [{ title: 'Seragam Olahraga', price: 150000, qty: 1, addons: [] }],
          refId: ref,
          totals: { grandTotal: 150000, totalItem: 1, totalPrice: 150000 },
        },
      },
    };
  }
  return {
    event: (KINDS[kind] ?? KINDS.paid).events[0],
    data: {
      id: ref, transactionId: ref, status: 'SUCCESS', transactionStatus: kind === 'reminder' ? 'created' : 'paid',
      createdAt: new Date().toISOString(), customerName: 'Pembeli Simulasi', customerEmail: 'pembeli@contoh.id',
      customerMobile: phone, amount: 250000, productId: 'simulasi', productName: 'Formulir PPDB 2027', productType: 'digital_product',
      qty: 1, paymentMethod: 'qris', paymentUrl: kind === 'reminder' ? 'https://contoh.myr.id/select-channel/simulasi' : undefined,
    },
  };
}

export async function register({ router, publicRouter, wa, features }) {
  let contactsApi = null;
  async function saveContact(s, p, phone, group) {
    if (!s.saveContact || !features.isEnabled('contacts')) return null;
    contactsApi ??= (await import('../contacts.js')).contacts;
    const fields = {};
    if (p.email) fields.Email = p.email;
    if (p.product) fields.Produk = p.product;
    return contactsApi.upsert({ phone, name: p.name, fields, groupName: group || s.contactGroup || '' });
  }

  function pickDevice(s) {
    const all = devices.all();
    return all.find((d) => d.id === s.deviceId) ?? all.find((d) => wa.getState?.(d.id)?.status === 'connected') ?? all[0] ?? null;
  }

  /** Proses satu payload. Mengembalikan baris log. */
  async function processPayload(provider, body, { test = false, force = false } = {}) {
    const s = loadSettings(provider);
    const p = parse(provider, body);
    const phone = normalizePhone(p.phone);
    const kind = kindOf(p.event);
    const log = (status, note = null, ids = []) => {
      const r = db.prepare(
        `INSERT INTO payment_events (provider, event, ref, name, phone, email, product, amount, status, note, message_ids, test, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(provider, p.event, p.ref, p.name, phone ?? (p.phone || null), p.email, p.product, p.amount, status, note,
        JSON.stringify(ids), test ? 1 : 0, JSON.stringify(body));
      return db.prepare('SELECT * FROM payment_events WHERE id = ?').get(Number(r.lastInsertRowid));
    };

    // Penyedia bisa mengirim ulang peristiwa yang sama -> jangan kirim WhatsApp dua kali
    if (!force && p.ref && db.prepare(
      "SELECT 1 FROM payment_events WHERE provider = ? AND event = ? AND ref = ? AND status IN ('sent','logged','no_phone') LIMIT 1"
    ).get(provider, p.event, p.ref)) {
      return log('duplicate', 'Peristiwa yang sama sudah pernah diproses');
    }

    if (!test) emit('payment', { deviceId: pickDevice(s)?.id ?? null, provider, ...p, phone: phone ?? p.phone });

    const vars = {
      Nama: p.name || 'Kak', Nomor: phone ?? p.phone, Email: p.email, Produk: p.product || '-', Total: rupiah(p.amount),
      Jumlah: p.qty ?? '', Ref: p.ref ?? '', LinkBayar: p.payUrl, Metode: p.method.toUpperCase(), Addon: p.addons,
      Sumber: PROVIDERS[provider].name, Peristiwa: EVENT_LABEL[p.event] ?? p.event,
      Tanggal: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
    };
    const dev = pickDevice(s);
    const ids = [];
    const notes = [];

    // Pesan untuk pembeli
    const rule = kind === 'paid'
      ? (s.rules ?? []).find((r) => r.match && p.product.toLowerCase().includes(String(r.match).toLowerCase()))
      : null;
    const tpl = s.templates[kind];
    const customerText = kind && tpl?.on ? (rule?.text?.trim() ? rule.text : tpl.text) : '';
    if (kind === 'paid' && phone) {
      try { await saveContact(s, p, phone, rule?.group); } catch (err) { notes.push(`Kontak: ${err.message}`); }
    }
    if (customerText && dev) {
      if (phone) ids.push(messages.enqueue(dev.id, phone, render(customerText, vars).trim(), null, 'api'));
      else notes.push('Nomor pembeli kosong/tidak valid');
    }
    // Notifikasi admin
    if (s.adminOn && dev && (kind === 'paid' || kind === 'member_new' || test)) {
      const text = render(s.adminText || DEFAULT_TEXT.admin, vars).trim();
      for (const a of String(s.adminPhones).split(/[,;\n]+/).map(normalizePhone).filter(Boolean)) {
        ids.push(messages.enqueue(dev.id, a, text, null, 'internal'));
      }
    }
    if (!dev && (customerText || s.adminOn)) notes.push('Belum ada device');
    if (ids.length) wa.drainQueue?.(dev.id);
    const status = ids.length ? 'sent' : customerText && !phone ? 'no_phone' : 'logged';
    return log(status, [rule ? `Aturan produk "${rule.match}"` : null, ...notes].filter(Boolean).join(' · ') || null, ids);
  }

  // ---- Endpoint publik untuk Lynk.id / Mayar.id ----------------------------------------------
  publicRouter.post('/:provider/:token', async (req, res) => {
    const provider = req.params.provider;
    if (!PROVIDERS[provider]) return res.status(404).json({ success: false });
    const s = loadSettings(provider);
    if (!s.active || !safeEq(req.params.token, s.token)) return res.status(404).json({ success: false });
    const body = req.body ?? {};
    try {
      if (provider === 'lynk' && s.merchantKey) {
        const sig = String(req.get('X-Lynk-Signature') ?? '');
        if (!safeEq(sig, lynkSignature(body, s.merchantKey))) {
          db.prepare(`INSERT INTO payment_events (provider, event, ref, status, note, payload) VALUES (?, ?, ?, 'rejected', ?, ?)`)
            .run(provider, str(body.event) || 'unknown', str(body?.data?.message_data?.refId) || null, 'Tanda tangan X-Lynk-Signature tidak cocok', JSON.stringify(body));
          return res.status(401).json({ success: false, message: 'Invalid signature' });
        }
      }
      const row = await processPayload(provider, body);
      res.json({ success: true, status: row.status });
    } catch (err) {
      wa.logger.warn({ provider, err: err.message }, 'gagal memproses webhook pembayaran');
      res.status(500).json({ success: false });
    }
  });
  // Sebagian penguji URL memakai GET
  publicRouter.get('/:provider/:token', (req, res) => {
    const s = PROVIDERS[req.params.provider] && loadSettings(req.params.provider);
    if (!s?.active || !safeEq(req.params.token, s.token)) return res.status(404).json({ success: false });
    res.json({ success: true, message: 'WhatsOrbit siap menerima webhook' });
  });

  // ---- API admin -----------------------------------------------------------------------------
  const view = (provider) => {
    const s = loadSettings(provider);
    return { ...s, url: hookUrl(provider, s.token), name: PROVIDERS[provider].name, kinds: PROVIDERS[provider].kinds };
  };

  router.get('/', (_req, res) => {
    const sum = (where) => db.prepare(
      `SELECT provider, COUNT(*) n, COALESCE(SUM(amount), 0) total FROM (
         SELECT provider, MAX(amount) amount FROM payment_events
          WHERE test = 0 AND event = 'payment.received' AND status NOT IN ('duplicate', 'rejected') AND ${where}
          GROUP BY provider, COALESCE(ref, id)) GROUP BY provider`
    ).all();
    const pack = (rows) => Object.fromEntries(rows.map((r) => [r.provider, { n: r.n, total: r.total }]));
    res.json({
      success: true,
      data: {
        providers: Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, view(p)])),
        kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.label])),
        defaults: DEFAULT_TEXT,
        publicUrl: PUBLIC_URL,
        stats: {
          today: pack(sum("date(created_at, 'localtime') = date('now', 'localtime')")),
          month: pack(sum("strftime('%Y-%m', created_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')")),
        },
      },
    });
  });

  router.put('/:provider', (req, res) => {
    const provider = req.params.provider;
    if (!PROVIDERS[provider]) return res.status(404).json({ success: false, message: 'Penyedia tidak dikenal' });
    const cur = loadSettings(provider);
    const b = req.body ?? {};
    const templates = { ...cur.templates };
    for (const k of PROVIDERS[provider].kinds) {
      if (b.templates?.[k]) templates[k] = { on: !!b.templates[k].on, text: String(b.templates[k].text ?? '').slice(0, 4000) };
    }
    const rules = Array.isArray(b.rules ?? cur.rules)
      ? (b.rules ?? cur.rules).map((r) => ({ match: str(r.match).slice(0, 120), text: String(r.text ?? '').slice(0, 4000), group: str(r.group).slice(0, 80) })).filter((r) => r.match).slice(0, 30)
      : [];
    const next = {
      ...cur,
      active: b.active ?? cur.active,
      merchantKey: b.merchantKey !== undefined ? str(b.merchantKey) : cur.merchantKey,
      deviceId: b.deviceId !== undefined ? str(b.deviceId) : cur.deviceId,
      templates,
      rules,
      adminOn: b.adminOn ?? cur.adminOn,
      adminPhones: b.adminPhones !== undefined ? str(b.adminPhones) : cur.adminPhones,
      adminText: b.adminText !== undefined ? String(b.adminText).slice(0, 2000) : cur.adminText,
      saveContact: b.saveContact ?? cur.saveContact,
      contactGroup: b.contactGroup !== undefined ? str(b.contactGroup).slice(0, 80) : cur.contactGroup,
    };
    for (const k of Object.keys(templates)) if (templates[k].on && !templates[k].text.trim()) {
      return res.status(400).json({ success: false, message: `Pesan "${KINDS[k].label}" masih kosong` });
    }
    saveSettings(provider, next);
    res.json({ success: true, data: view(provider) });
  });

  router.post('/:provider/token', (req, res) => {
    const provider = req.params.provider;
    if (!PROVIDERS[provider]) return res.status(404).json({ success: false, message: 'Penyedia tidak dikenal' });
    saveSettings(provider, { ...loadSettings(provider), token: newToken() });
    res.json({ success: true, data: view(provider) });
  });

  // Simulasi: proses contoh payload seolah datang dari penyedia, pesan dikirim ke nomor tes
  router.post('/:provider/simulate', async (req, res) => {
    const provider = req.params.provider;
    if (!PROVIDERS[provider]) return res.status(404).json({ success: false, message: 'Penyedia tidak dikenal' });
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ success: false, message: 'Nomor tes tidak valid' });
    const kind = PROVIDERS[provider].kinds.includes(req.body?.kind) ? req.body.kind : 'paid';
    const row = await processPayload(provider, sample(provider, kind, phone), { test: true });
    res.json({ success: true, data: row });
  });

  router.get('/events', (req, res) => {
    const where = [];
    const params = [];
    if (PROVIDERS[req.query.provider]) { where.push('provider = ?'); params.push(req.query.provider); }
    if (req.query.q) {
      where.push('(name LIKE ? OR phone LIKE ? OR product LIKE ? OR ref LIKE ? OR email LIKE ?)');
      params.push(...Array(5).fill(`%${String(req.query.q).replace(/[%_]/g, '')}%`));
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows = db.prepare(
      `SELECT id, provider, event, ref, name, phone, email, product, amount, status, note, test, created_at FROM payment_events
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`
    ).all(...params, limit);
    res.json({ success: true, data: rows.map((r) => ({ ...r, eventLabel: EVENT_LABEL[r.event] ?? r.event })) });
  });

  router.get('/events/:id', (req, res) => {
    const r = db.prepare('SELECT * FROM payment_events WHERE id = ?').get(Number(req.params.id));
    if (!r) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
    const ids = JSON.parse(r.message_ids || '[]');
    const msgs = ids.map((id) => messages.get(id)).filter(Boolean).map((m) => ({ id: m.id, to: m.to_number, body: m.body, status: m.status, kind: m.kind, error: m.error }));
    res.json({ success: true, data: { ...r, payload: JSON.parse(r.payload), messages: msgs, eventLabel: EVENT_LABEL[r.event] ?? r.event } });
  });

  // Proses ulang (mis. setelah template diperbaiki), mengabaikan cek duplikat
  router.post('/events/:id/reprocess', async (req, res) => {
    const r = db.prepare('SELECT * FROM payment_events WHERE id = ?').get(Number(req.params.id));
    if (!r) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
    const row = await processPayload(r.provider, JSON.parse(r.payload), { test: !!r.test, force: true });
    res.json({ success: true, data: row });
  });

  // Simpan log 1 tahun (data transaksi)
  const cleanup = () => db.prepare("DELETE FROM payment_events WHERE created_at < datetime('now', '-365 days')").run();
  cleanup();
  setInterval(cleanup, 24 * 3600_000).unref();
}
