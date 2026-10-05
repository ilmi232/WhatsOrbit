// Backup & pulihkan: database, sesi login WhatsApp, dan .env.
//
// Salinan cloud: kalau "cloud" diisi (remote rclone, mis. gdrive:WhatsOrbit-Backup), setiap backup yang
// selesai dikemas jadi satu .tar.gz (sesi WhatsApp berisi ribuan file kecil yang lambat diunggah satu-satu),
// diunggah di latar belakang, diperiksa, lalu hanya N backup terbaru yang disimpan di cloud.
import { spawn } from 'node:child_process';
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
  cloud: '',
};
const CLOUD = /^[A-Za-z0-9_.-]+:[^\s"'|&<>]*$/; // remote rclone, mis. gdrive:WhatsOrbit-Backup

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
    cloud: b.cloud === undefined ? cur.cloud : String(b.cloud).trim().replace(/\/+$/, ''),
  };
  if (next.cloud && !CLOUD.test(next.cloud)) throw new Error('Tujuan cloud harus nama remote rclone, mis. gdrive:WhatsOrbit-Backup');
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
  // Unggah ke cloud di latar belakang (server tidak menunggu); hasilnya di cloudResult()
  if (s.cloud) upload(name).catch(() => {});
  return list(dir).find((b) => b.name === name);
}

// ---- Salinan cloud lewat rclone ---------------------------------------------------------------
/** rclone.exe dari folder winget (PATH proses PM2 belum tentu memuatnya), atau dari PATH. */
function findRclone() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const pkg of fs.readdirSync(base).filter((n) => n.startsWith('Rclone.Rclone_'))) {
      for (const d of fs.readdirSync(path.join(base, pkg)).sort().reverse()) {
        const exe = path.join(base, pkg, d, 'rclone.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch { /* winget tidak ada */ }
  return 'rclone';
}

/** Jalankan program tanpa shell (argumen aman), kembalikan { code, out, err }. */
function exec(cmd, args, timeoutMs = 15 * 60_000) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try { child = spawn(cmd, args, { windowsHide: true }); } catch (e) { return resolve({ code: -1, out, err: e.message }); }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: e.code === 'ENOENT' ? `${path.basename(cmd)} tidak ditemukan` : e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out, err }); });
  });
}
const rclone = (args, timeoutMs) => exec(findRclone(), args, timeoutMs);

/** Pesan error yang bisa dibaca (baris ERROR terakhir, tanpa NOTICE). */
function errorText(r) {
  const lines = String(r.err || '').split(/\r?\n/).filter((l) => l.trim() && !/NOTICE/.test(l));
  const line = lines.filter((l) => /ERROR|Failed|error/i.test(l)).pop() || lines.pop() || `keluar dengan kode ${r.code}`;
  return line.replace(/^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d\s*/, '').slice(0, 300);
}

const setCloud = (v) => setSetting('backup_cloud', JSON.stringify(v));
export const cloudResult = () => JSON.parse(getSetting('backup_cloud', () => 'null'));

let uploading = null;
/** Kemas satu backup jadi .tar.gz, unggah, periksa hash, lalu hapus backup lama di cloud. */
export async function upload(name) {
  const s = loadSettings();
  if (!s.cloud) return null;
  if (uploading) await uploading.catch(() => {}); // satu unggahan dalam satu waktu
  const job = (async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsorbit-upload-'));
    setCloud({ at: new Date().toISOString(), state: 'uploading', name });
    try {
      const archive = path.join(tmp, `${name}.tar.gz`);
      // tar bawaan Windows (bsdtar); jangan tar Git/MSYS yang salah membaca alamat C:\
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      let r = await exec(tar, ['-czf', archive, '-C', s.dir, name], 5 * 60_000);
      if (r.code) throw new Error(`Gagal mengemas backup: ${errorText(r)}`);
      r = await rclone(['copy', tmp, s.cloud]);
      if (r.code) throw new Error(errorText(r));
      r = await rclone(['check', tmp, s.cloud, '--one-way']); // ukuran & hash harus sama
      if (r.code) throw new Error(`Hasil unggahan tidak sama: ${errorText(r)}`);
      r = await rclone(['lsf', s.cloud, '--files-only']);
      if (r.code) throw new Error(errorText(r));
      const all = r.out.split(/\r?\n/).filter((n) => n.startsWith(PREFIX) && n.endsWith('.tar.gz')).sort();
      for (const old of all.slice(0, Math.max(0, all.length - s.keep))) {
        const d = await rclone(['deletefile', `${s.cloud}/${old}`]);
        if (d.code) throw new Error(`Gagal menghapus backup lama ${old}: ${errorText(d)}`);
      }
      const done = { at: new Date().toISOString(), ok: true, name, count: Math.min(all.length, s.keep), sizeBytes: fs.statSync(archive).size };
      setCloud(done);
      return done;
    } catch (err) {
      const failed = { at: new Date().toISOString(), ok: false, name, error: String(err.message).slice(0, 300) };
      setCloud(failed);
      return failed;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })();
  uploading = job;
  try { return await job; } finally { if (uploading === job) uploading = null; }
}

/** Tes tujuan cloud: buat foldernya (kalau belum ada) lalu baca isinya. */
export async function testCloud(cloud) {
  const c = String(cloud ?? loadSettings().cloud).trim().replace(/\/+$/, '');
  if (!c || !CLOUD.test(c)) throw new Error('Isi tujuan cloud dulu, mis. gdrive:WhatsOrbit-Backup');
  let r = await rclone(['mkdir', c], 60_000);
  if (r.code) throw new Error(errorText(r));
  r = await rclone(['lsf', c, '--files-only'], 60_000);
  if (r.code) throw new Error(errorText(r));
  return { cloud: c, count: r.out.split(/\r?\n/).filter((n) => n.startsWith(PREFIX)).length };
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
