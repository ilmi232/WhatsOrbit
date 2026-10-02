// Backup & pulihkan: database, sesi login WhatsApp, dan .env.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR, ROOT_DIR, SESSIONS_DIR } from './config.js';
import { db, getSetting, setSetting } from './db.js';

const PREFIX = 'whatsorbit-backup-';
export const RESTORE_MARKER = path.join(DATA_DIR, 'restore.json');

export const DEFAULTS = {
  auto: false,
  dir: '',
  time: '02:00',
  keep: 7,
};

export function loadSettings() {
  return { ...DEFAULTS, ...JSON.parse(getSetting('backup', () => '{}')) };
}

/** Lokasi yang disarankan: folder cloud (OneDrive/Google Drive) dan drive lain. */
export function suggestions() {
  const home = os.homedir();
  const cands = [
    [process.env.OneDriveCommercial, 'OneDrive (kantor/sekolah)', true],
    [process.env.OneDrive, 'OneDrive', true],
    [process.env.OneDriveConsumer, 'OneDrive pribadi', true],
    ['G:\\My Drive', 'Google Drive', true],
    ['G:\\Drive Saya', 'Google Drive', true],
    [path.join(home, 'Google Drive'), 'Google Drive', true],
    [path.join(home, 'My Drive'), 'Google Drive', true],
  ];
  for (const d of 'DEFGHIJ') cands.push([`${d}:\\`, `Drive ${d}:`, false]);
  const seen = new Set();
  const out = [];
  for (const [p, label, cloud] of cands) {
    if (!p || seen.has(p.toLowerCase())) continue;
    seen.add(p.toLowerCase());
    try {
      if (fs.statSync(p).isDirectory()) out.push({ label, dir: path.join(p, 'WhatsOrbit-Backup'), cloud });
    } catch { /* tidak ada */ }
  }
  return out;
}

function checkDir(dir) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('Isi folder tujuan backup (alamat lengkap, mis. D:\\WhatsOrbit-Backup)');
  const resolved = path.resolve(dir);
  if (resolved.toLowerCase().startsWith(path.resolve(DATA_DIR).toLowerCase())) throw new Error('Folder backup tidak boleh di dalam folder data');
  fs.mkdirSync(resolved, { recursive: true });
  const probe = path.join(resolved, '.whatsorbit-write-test');
  fs.writeFileSync(probe, 'ok');
  fs.rmSync(probe);
  return resolved;
}

export function saveSettings(b) {
  const cur = loadSettings();
  const next = {
    auto: b.auto === undefined ? cur.auto : !!b.auto,
    dir: b.dir === undefined ? cur.dir : String(b.dir).trim(),
    time: /^([01]?\d|2[0-3]):[0-5]\d$/.test(b.time ?? '') ? b.time.padStart(5, '0') : cur.time,
    keep: Math.max(1, Math.min(90, Number.parseInt(b.keep ?? cur.keep, 10) || 7)),
  };
  if (next.dir) next.dir = checkDir(next.dir);
  if (next.auto && !next.dir) throw new Error('Pilih folder tujuan backup dulu');
  setSetting('backup', JSON.stringify(next));
  return next;
}

const stamp = (d = new Date()) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-` +
  `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

function dirSize(p) {
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    n += e.isDirectory() ? dirSize(f) : fs.statSync(f).size;
  }
  return n;
}

/** Daftar backup di folder tujuan, terbaru dulu. */
export function list(dir = loadSettings().dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(PREFIX) && fs.existsSync(path.join(dir, e.name, 'whatsorbit.db')))
    .map((e) => {
      const full = path.join(dir, e.name);
      let info = {};
      try { info = JSON.parse(fs.readFileSync(path.join(full, 'backup.json'), 'utf8')); } catch { /* lama */ }
      return { name: e.name, path: full, createdAt: info.createdAt ?? null, sizeBytes: dirSize(full), devices: info.devices ?? null, reason: info.reason ?? '' };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Buat backup sekarang. Database disalin dengan VACUUM INTO (aman walau server berjalan). */
export function run(reason = 'manual', { prune = true } = {}) {
  const s = loadSettings();
  const dir = checkDir(s.dir);
  const name = `${PREFIX}${stamp()}`;
  const target = path.join(dir, name);
  const tmp = `${target}.partial`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    db.exec(`VACUUM INTO '${path.join(tmp, 'whatsorbit.db').replaceAll("'", "''")}'`);
    if (fs.existsSync(SESSIONS_DIR)) fs.cpSync(SESSIONS_DIR, path.join(tmp, 'sessions'), { recursive: true });
    const envFile = path.join(ROOT_DIR, '.env');
    if (fs.existsSync(envFile)) fs.copyFileSync(envFile, path.join(tmp, 'env.backup'));
    const devices = db.prepare('SELECT COUNT(*) AS n FROM devices').get().n;
    fs.writeFileSync(path.join(tmp, 'backup.json'), JSON.stringify({ createdAt: new Date().toISOString(), reason, devices, host: os.hostname() }, null, 2));
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  // Simpan hanya N backup terbaru
  if (prune) for (const old of list(dir).slice(s.keep)) fs.rmSync(old.path, { recursive: true, force: true });
  setSetting('backup_last', JSON.stringify({ at: new Date().toISOString(), name, ok: true }));
  return list(dir).find((b) => b.name === name);
}

/** Jadwalkan pemulihan: dijalankan saat server menyala berikutnya (lihat restore-boot.js). */
export function scheduleRestore(name) {
  const b = list().find((x) => x.name === name);
  if (!b) throw new Error('Backup tidak ditemukan');
  fs.writeFileSync(RESTORE_MARKER, JSON.stringify({ from: b.path, at: new Date().toISOString() }));
  return b;
}

/** Penjadwal harian. */
export function startScheduler(logger) {
  const tick = () => {
    try {
      const s = loadSettings();
      if (!s.auto || !s.dir) return;
      const now = new Date();
      const [hh, mm] = s.time.split(':').map(Number);
      if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return;
      const last = JSON.parse(getSetting('backup_last', () => 'null'));
      const today = now.toDateString();
      if (last?.ok && new Date(last.at).toDateString() === today) return;
      if (last && !last.ok && Date.now() - new Date(last.at).getTime() < 60 * 60 * 1000) return; // gagal: coba lagi tiap jam
      run('otomatis');
      logger?.info('backup otomatis selesai');
    } catch (err) {
      setSetting('backup_last', JSON.stringify({ at: new Date().toISOString(), ok: false, error: String(err.message).slice(0, 300) }));
      logger?.warn({ err: err.message }, 'backup otomatis gagal');
    }
  };
  setInterval(tick, 60_000).unref();
  setTimeout(tick, 30_000).unref();
}

export const lastResult = () => JSON.parse(getSetting('backup_last', () => 'null'));
