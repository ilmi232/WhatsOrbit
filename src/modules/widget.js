// Modul Chat Widget: hanya dimuat kalau fitur "widget" aktif.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { PUBLIC_URL } from '../config.js';
import { normalizePhone } from '../phone.js';
import { buildSnippet } from '../widget-runtime.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_widgets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    public_key TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    config     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS widget_clicks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    widget_id INTEGER NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
    agent     INTEGER NOT NULL,
    page      TEXT NOT NULL DEFAULT '',
    at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_wclicks ON widget_clicks(widget_id, at);
`);

export const DEFAULT_CONFIG = {
  title: 'Hubungi Kami',
  subtitle: 'Biasanya membalas dalam beberapa menit',
  color: '#25d366',
  position: 'right',
  mode: 'list', // list = pilih agen, direct = langsung chat (rotasi acak antar agen)
  label: 'Chat dengan kami',
  greeting: 'Halo! 👋 Ada yang bisa kami bantu?',
  greetingDelay: 5,
  offlineText: 'Di luar jam kerja, tetap bisa kirim pesan',
  timezone: 'Asia/Jakarta',
  agents: [],
};

const str = (v, max, d = '') => String(v ?? d).trim().slice(0, max);
const time = (v) => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v ?? '')) ? String(v).padStart(5, '0') : '');

function cleanConfig(input) {
  const b = { ...DEFAULT_CONFIG, ...(input ?? {}) };
  const agents = (Array.isArray(b.agents) ? b.agents : []).slice(0, 10).map((a, i) => {
    const phone = normalizePhone(a?.phone);
    if (!phone) throw new Error(`Nomor agen ${i + 1} tidak valid`);
    return {
      name: str(a.name, 60) || `Agen ${i + 1}`,
      role: str(a.role, 60),
      phone,
      message: str(a.message, 500),
      start: time(a.start),
      end: time(a.end),
      days: Array.isArray(a.days) ? [...new Set(a.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : [],
    };
  });
  return {
    title: str(b.title, 60) || DEFAULT_CONFIG.title,
    subtitle: str(b.subtitle, 120),
    color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : DEFAULT_CONFIG.color,
    position: b.position === 'left' ? 'left' : 'right',
    mode: b.mode === 'direct' ? 'direct' : 'list',
    label: str(b.label, 40),
    greeting: str(b.greeting, 160),
    greetingDelay: Math.max(0, Math.min(120, Number.parseInt(b.greetingDelay, 10) || 0)),
    offlineText: str(b.offlineText, 80),
    timezone: str(b.timezone, 40) || 'Asia/Jakarta',
    agents,
  };
}

const get = (id) => {
  const w = db.prepare('SELECT * FROM chat_widgets WHERE id = ?').get(id);
  return w && { ...w, config: JSON.parse(w.config) };
};

const trackUrl = () => (PUBLIC_URL ? `${PUBLIC_URL}/api/widget/track` : null);

function snippetFor(w, { preview = false } = {}) {
  return buildSnippet({ name: w.name, key: w.public_key, track: preview ? null : trackUrl(), ...w.config });
}

function stats(widgetId) {
  const q = (sql, ...p) => db.prepare(sql).get(widgetId, ...p).n;
  const local = "date(at, 'localtime')";
  const per = db
    .prepare(`SELECT ${local} AS day, COUNT(*) AS n FROM widget_clicks WHERE widget_id = ? AND ${local} >= date('now', 'localtime', '-29 days') GROUP BY day`)
    .all(widgetId);
  const map = Object.fromEntries(per.map((r) => [r.day, r.n]));
  const perDay = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    perDay.push({ day: key, n: map[key] ?? 0 });
  }
  return {
    today: q(`SELECT COUNT(*) AS n FROM widget_clicks WHERE widget_id = ? AND ${local} = date('now', 'localtime')`),
    week: q(`SELECT COUNT(*) AS n FROM widget_clicks WHERE widget_id = ? AND ${local} >= date('now', 'localtime', '-6 days')`),
    total: q('SELECT COUNT(*) AS n FROM widget_clicks WHERE widget_id = ?'),
    perDay,
    agents: db.prepare('SELECT agent, COUNT(*) AS n FROM widget_clicks WHERE widget_id = ? GROUP BY agent').all(widgetId),
    pages: db
      .prepare(`SELECT page, COUNT(*) AS n FROM widget_clicks WHERE widget_id = ? AND at >= datetime('now', '-30 days') GROUP BY page ORDER BY n DESC LIMIT 8`)
      .all(widgetId),
  };
}

export async function register({ router, publicRouter, isEnabled }) {
  // ---- Publik: catat klik (dipanggil dari website lewat sendBeacon) ---------------------
  const hits = new Map(); // batas sederhana per IP: 60 klik / 10 menit
  setInterval(() => hits.clear(), 10 * 60 * 1000).unref();
  publicRouter.post('/track', express.text({ type: '*/*', limit: '2kb' }), (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (!isEnabled()) return res.status(204).end();
    const ip = String(req.get('X-Forwarded-For') ?? req.ip).split(',')[0].trim();
    const n = (hits.get(ip) ?? 0) + 1;
    hits.set(ip, n);
    if (n > 60) return res.status(429).end();
    let body;
    try { body = JSON.parse(typeof req.body === 'string' ? req.body : '{}'); } catch { return res.status(400).end(); }
    const w = db.prepare('SELECT id, config FROM chat_widgets WHERE public_key = ?').get(String(body.k ?? ''));
    if (!w) return res.status(404).end();
    const agents = JSON.parse(w.config).agents.length;
    const agent = Number.parseInt(body.a, 10);
    if (!(agent >= 0 && agent < agents)) return res.status(400).end();
    let page = '';
    try {
      const u = new URL(String(body.u ?? ''));
      page = (u.host + u.pathname).slice(0, 200);
    } catch { /* biarkan kosong */ }
    db.prepare('INSERT INTO widget_clicks (widget_id, agent, page) VALUES (?, ?, ?)').run(w.id, agent, page);
    res.status(204).end();
  });
  publicRouter.options('/track', (_req, res) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }).status(204).end();
  });

  // ---- API admin ------------------------------------------------------------------
  router.get('/', (_req, res) => {
    const rows = db.prepare('SELECT * FROM chat_widgets ORDER BY id').all().map((w) => {
      const s = stats(w.id);
      return { ...w, config: JSON.parse(w.config), today: s.today, week: s.week, total: s.total };
    });
    res.json({ success: true, data: rows, publicUrl: PUBLIC_URL || null, trackingUrl: trackUrl() });
  });

  router.post('/', (req, res) => {
    try {
      const name = str(req.body?.name, 60) || 'Website Sekolah';
      const config = cleanConfig(req.body?.config ?? {});
      const r = db
        .prepare('INSERT INTO chat_widgets (public_key, name, config) VALUES (?, ?, ?)')
        .run(randomBytes(9).toString('base64url'), name, JSON.stringify(config));
      res.json({ success: true, data: get(Number(r.lastInsertRowid)) });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  router.get('/:id', (req, res) => {
    const w = get(Number(req.params.id));
    if (!w) return res.status(404).json({ success: false, message: 'Widget tidak ditemukan' });
    res.json({ success: true, data: { ...w, stats: stats(w.id) } });
  });

  router.put('/:id', (req, res) => {
    const w = get(Number(req.params.id));
    if (!w) return res.status(404).json({ success: false, message: 'Widget tidak ditemukan' });
    try {
      const config = cleanConfig(req.body?.config);
      if (!config.agents.length) throw new Error('Tambahkan minimal satu agen');
      const name = str(req.body?.name, 60) || w.name;
      db.prepare("UPDATE chat_widgets SET name = ?, config = ?, updated_at = datetime('now') WHERE id = ?").run(name, JSON.stringify(config), w.id);
      res.json({ success: true, data: get(w.id) });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  /** Kode tempel. ?preview=1 -> tanpa pencatat klik (untuk pratinjau di dashboard). */
  router.post('/:id/snippet', (req, res) => {
    const w = get(Number(req.params.id));
    if (!w) return res.status(404).json({ success: false, message: 'Widget tidak ditemukan' });
    try {
      // Pratinjau boleh memakai pengaturan yang belum disimpan
      const draft = req.body?.config ? { ...w, name: str(req.body.name, 60) || w.name, config: cleanConfig(req.body.config) } : w;
      res.json({ success: true, data: { code: snippetFor(draft, { preview: req.query.preview === '1' }), tracking: !!trackUrl() } });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM chat_widgets WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true });
  });
}
