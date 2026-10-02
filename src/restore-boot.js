// Dijalankan PALING AWAL saat server menyala (sebelum database dibuka):
// kalau ada permintaan pulihkan backup, data sekarang disimpan dulu lalu diganti isi backup.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, SESSIONS_DIR } from './config.js';

const marker = path.join(DATA_DIR, 'restore.json');

if (fs.existsSync(marker)) {
  let from = null;
  try { from = JSON.parse(fs.readFileSync(marker, 'utf8')).from; } catch { /* rusak */ }
  fs.rmSync(marker, { force: true });
  if (from && fs.existsSync(path.join(from, 'whatsorbit.db'))) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safety = path.join(DATA_DIR, `_sebelum-pulih-${stamp}`);
    fs.mkdirSync(safety, { recursive: true });
    for (const f of ['whatsorbit.db', 'whatsorbit.db-wal', 'whatsorbit.db-shm']) {
      const p = path.join(DATA_DIR, f);
      if (fs.existsSync(p)) fs.renameSync(p, path.join(safety, f));
    }
    if (fs.existsSync(SESSIONS_DIR)) fs.renameSync(SESSIONS_DIR, path.join(safety, 'sessions'));
    fs.copyFileSync(path.join(from, 'whatsorbit.db'), path.join(DATA_DIR, 'whatsorbit.db'));
    if (fs.existsSync(path.join(from, 'sessions'))) fs.cpSync(path.join(from, 'sessions'), SESSIONS_DIR, { recursive: true });
    console.log(`Backup dipulihkan dari ${from}. Data sebelumnya disimpan di ${safety}`);
  }
}
