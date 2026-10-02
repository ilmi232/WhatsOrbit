// Aturan anti-banned lintas fitur: batas harian per device untuk pesan yang KITA mulai,
// mode pemanasan untuk nomor baru, dan jeda lebih panjang untuk pesan yang kita mulai.
import { db, getSetting, setSetting, tableExists } from './db.js';

// Jenis pesan di antrean (kolom messages.kind)
export const KIND = {
  REPLY: 'reply',       // balasan ke orang yang chat duluan (Autoreply, Chat Bot, AI, CS, Pesan Masuk)
  API: 'api',           // /api/send (mis. auto-reply Google Form)
  MANUAL: 'manual',     // Kirim Pesan dari dashboard
  BIRTHDAY: 'birthday', // ucapan Ulang Tahun
  INTERNAL: 'internal', // notifikasi ke petugas CS (nomor staf sendiri)
};
/** Jenis yang dihitung ke batas harian "pesan yang kita mulai" (+ Blast). */
export const INITIATED = [KIND.MANUAL, KIND.BIRTHDAY];

export const DEFAULTS = {
  dailyLimit: 200,     // per device per hari: Kirim Pesan + Ulang Tahun + Blast
  apiDailyLimit: 0,    // per device per hari untuk API/Google Form (0 = tanpa batas)
  initDelayMin: 15,    // detik, jeda setelah pesan yang kita mulai
  initDelayMax: 45,
};

// Mode pemanasan: batas harian bertahap sejak tanggal mulai
export const WARMUP = [
  { untilDay: 3, limit: 20 },
  { untilDay: 7, limit: 40 },
  { untilDay: 14, limit: 80 },
  { untilDay: 21, limit: 150 },
  { untilDay: 28, limit: 250 },
];

export function loadSettings() {
  return { ...DEFAULTS, ...JSON.parse(getSetting('antiban', () => '{}')) };
}

export function saveSettings(b) {
  const cur = loadSettings();
  const n = (v, min, max, d) => {
    const x = Number.parseInt(v, 10);
    return Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : d;
  };
  const next = {
    dailyLimit: n(b.dailyLimit ?? cur.dailyLimit, 1, 5000, DEFAULTS.dailyLimit),
    apiDailyLimit: n(b.apiDailyLimit ?? cur.apiDailyLimit, 0, 100_000, 0),
    initDelayMin: n(b.initDelayMin ?? cur.initDelayMin, 5, 600, DEFAULTS.initDelayMin),
    initDelayMax: 0,
  };
  next.initDelayMax = Math.max(next.initDelayMin, n(b.initDelayMax ?? cur.initDelayMax, 5, 900, DEFAULTS.initDelayMax));
  setSetting('antiban', JSON.stringify(next));
  return next;
}

/** Hari ke-berapa pemanasan (1 = hari mulai), atau null kalau tidak/sudah selesai. */
export function warmupDay(deviceId) {
  const d = db.prepare('SELECT warmup_start FROM devices WHERE id = ?').get(deviceId);
  if (!d?.warmup_start) return null;
  const day = db.prepare("SELECT CAST(julianday(date('now','localtime')) - julianday(date(?)) AS INTEGER) + 1 AS n").get(d.warmup_start).n;
  return day > WARMUP[WARMUP.length - 1].untilDay ? null : Math.max(1, day);
}

/** Batas harian pesan yang kita mulai untuk device ini (memperhitungkan pemanasan). */
export function limitFor(deviceId, s = loadSettings()) {
  const day = warmupDay(deviceId);
  if (!day) return s.dailyLimit;
  const step = WARMUP.find((w) => day <= w.untilDay);
  return Math.min(s.dailyLimit, step.limit);
}

const TODAY = "date(COALESCE(sent_at, created_at), 'localtime') = date('now', 'localtime')";

/** Jumlah pesan yang kita mulai hari ini (Kirim Pesan + Ulang Tahun + Blast). */
export function initiatedToday(deviceId) {
  const n = db.prepare(
    `SELECT COUNT(*) AS n FROM messages WHERE device_id = ? AND kind IN (${INITIATED.map(() => '?').join(',')})
       AND status != 'pending' AND ${TODAY}`
  ).get(deviceId, ...INITIATED).n;
  const blast = tableExists('campaign_recipients')
    ? db.prepare(
        `SELECT COUNT(*) AS n FROM campaign_recipients WHERE device_id = ? AND status IN ('sent','failed')
           AND date(sent_at, 'localtime') = date('now', 'localtime')`
      ).get(deviceId).n
    : 0;
  return n + blast;
}

export const apiToday = (deviceId) =>
  db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE device_id = ? AND kind = 'api' AND status != 'pending' AND ${TODAY}`).get(deviceId).n;

/** Boleh mengirim pesan yang kita mulai sekarang? (dipakai antrean & Blast) */
export const canInitiate = (deviceId) => initiatedToday(deviceId) < limitFor(deviceId);

/** Jenis pesan yang sedang ditahan untuk device ini (kuota habis). */
export function blockedKinds(deviceId) {
  const s = loadSettings();
  const blocked = [];
  if (!canInitiate(deviceId)) blocked.push(...INITIATED);
  if (s.apiDailyLimit > 0 && apiToday(deviceId) >= s.apiDailyLimit) blocked.push(KIND.API);
  return blocked;
}

/** Ringkasan per device untuk dashboard. */
export function usage(deviceId) {
  const s = loadSettings();
  return {
    initiated: initiatedToday(deviceId),
    limit: limitFor(deviceId, s),
    api: apiToday(deviceId),
    apiLimit: s.apiDailyLimit,
    warmupDay: warmupDay(deviceId),
    warmupTotal: WARMUP[WARMUP.length - 1].untilDay,
    held: db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE device_id = ? AND status = 'pending' AND error LIKE 'Menunggu kuota%'`).get(deviceId).n,
  };
}

export function setWarmup(deviceId, on) {
  db.prepare("UPDATE devices SET warmup_start = CASE WHEN ? THEN date('now','localtime') ELSE NULL END WHERE id = ?").run(on ? 1 : 0, deviceId);
}
