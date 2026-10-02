import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from 'baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { MAX_ATTEMPTS, SEND_DELAY_MAX_MS, SEND_DELAY_MIN_MS, SESSIONS_DIR } from './config.js';
import { devices, messages } from './db.js';
import * as antiban from './antiban.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });
const waLogger = logger.child({ module: 'baileys' }, { level: process.env.BAILEYS_LOG_LEVEL || 'silent' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomBetween = (min, max) => min + Math.floor(Math.random() * Math.max(0, max - min));

/**
 * @typedef {'disconnected'|'connecting'|'qr'|'connected'|'logged_out'} Status
 * @type {Map<string, {sock: any, status: Status, qr: string|null, stopped: boolean,
 *   working: boolean, retries: number, retryTimer: NodeJS.Timeout|null, lastError: string|null}>}
 */
const sessions = new Map();

let cachedVersion = null;
async function waVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedVersion = version;
  } catch {
    cachedVersion = undefined; // pakai default bawaan Baileys
  }
  return cachedVersion;
}

const sessionDir = (id) => path.join(SESSIONS_DIR, id);

function entry(id) {
  let e = sessions.get(id);
  if (!e) {
    e = {
      sock: null, status: 'disconnected', qr: null, stopped: false, working: false, retries: 0, retryTimer: null, lastError: null,
    };
    sessions.set(id, e);
  }
  return e;
}

export function getState(id) {
  const e = sessions.get(id);
  return e
    ? { status: e.status, qr: e.qr, lastError: e.lastError }
    : { status: 'disconnected', qr: null, lastError: null };
}

export function hasSession(id) {
  return existsSync(path.join(sessionDir(id), 'creds.json'));
}

/** Mulai / sambungkan ulang device. Kalau belum pernah login, akan menghasilkan QR. */
export async function startDevice(id) {
  const e = entry(id);
  if (e.sock) return;
  clearTimeout(e.retryTimer);
  e.stopped = false;
  e.status = 'connecting';
  e.qr = null;

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir(id));
  const sock = makeWASocket({
    version: await waVersion(),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, waLogger) },
    logger: waLogger,
    browser: Browsers.windows('Chrome'),
    markOnlineOnConnect: false, // supaya notifikasi di HP tetap muncul
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false, // hemat RAM, riwayat chat tidak diperlukan
    generateHighQualityLinkPreview: false,
  });
  e.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  // Pesan masuk -> diteruskan ke modul (Pesan Masuk, Autoreply) kalau ada yang mendengarkan
  sock.ev.on('messages.upsert', async ({ type, messages: list }) => {
    if (type !== 'notify' || !incomingHandlers.length) return;
    for (const m of list) {
      try {
        const msg = await normalizeIncoming(id, sock, m);
        if (!msg) continue;
        for (const h of incomingHandlers) await h.handle(msg);
      } catch (err) {
        logger.warn({ id, err: err?.message }, 'gagal memproses pesan masuk');
      }
    }
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (e.sock !== sock) return; // socket lama, abaikan

    if (qr) {
      e.status = 'qr';
      e.qr = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
    }

    if (connection === 'open') {
      e.status = 'connected';
      e.qr = null;
      e.retries = 0;
      e.lastError = null;
      const phone = sock.user?.id?.split(':')[0]?.split('@')[0];
      if (phone) devices.setPhone(id, phone);
      logger.info({ id, phone }, 'device terhubung');
      drainQueue(id);
    }

    if (connection === 'close') {
      e.sock = null;
      e.qr = null;
      const code = lastDisconnect?.error?.output?.statusCode;
      e.lastError = lastDisconnect?.error?.message ?? null;
      logger.warn({ id, code, err: e.lastError }, 'koneksi ditutup');

      if (e.stopped) {
        e.status = 'disconnected';
      } else if (code === DisconnectReason.loggedOut) {
        // Di-logout dari HP (Perangkat Tertaut) -> hapus sesi, perlu scan ulang
        rmSync(sessionDir(id), { recursive: true, force: true });
        e.status = 'logged_out';
      } else if (code === DisconnectReason.restartRequired) {
        // Normal terjadi sesaat setelah scan QR
        startDevice(id);
      } else if (code === DisconnectReason.connectionReplaced) {
        // Sesi yang sama dibuka di tempat lain; jangan rebutan
        e.status = 'disconnected';
      } else if (!state.creds.me) {
        // Belum pernah login dan QR kedaluwarsa / tidak di-scan.
        // (creds.registered selalu false untuk login QR, jadi pakai creds.me)
        e.status = 'disconnected';
      } else {
        e.status = 'connecting';
        const delay = Math.min(60_000, 2_000 * 2 ** e.retries++);
        e.retryTimer = setTimeout(() => startDevice(id), delay);
      }
    }
  });
}

/** Putuskan koneksi tanpa menghapus sesi (bisa disambung lagi tanpa scan). */
export function stopDevice(id) {
  const e = sessions.get(id);
  if (!e) return;
  e.stopped = true;
  clearTimeout(e.retryTimer);
  e.sock?.end(undefined);
  e.sock = null;
  e.status = 'disconnected';
  e.qr = null;
}

/** Logout dari WhatsApp dan hapus sesi. Perlu scan QR lagi untuk memakai device ini. */
export async function logoutDevice(id) {
  const e = sessions.get(id);
  if (e?.sock && e.status === 'connected') {
    e.stopped = true;
    try {
      await e.sock.logout();
    } catch {
      /* tetap lanjut hapus sesi lokal */
    }
  }
  stopDevice(id);
  rmSync(sessionDir(id), { recursive: true, force: true });
  entry(id).status = 'logged_out';
}

export async function removeDevice(id) {
  await logoutDevice(id);
  sessions.delete(id);
}

class NotOnWhatsApp extends Error {
  constructor() {
    super('Nomor tidak terdaftar di WhatsApp');
  }
}

/**
 * Kirim teks dengan efek "sedang mengetik" yang lamanya sebanding panjang pesan.
 * `target` = nomor (dicek dulu terdaftar di WA) atau JID chat (dikirim langsung).
 */
async function sendText(sock, target, text) {
  let jid = target;
  if (!target.includes('@')) {
    const [result] = (await sock.onWhatsApp(target)) ?? [];
    if (!result?.exists) throw new NotOnWhatsApp();
    jid = result.jid;
  }
  await sock.sendPresenceUpdate('composing', jid).catch(() => {});
  const typingMs = Math.min(9000, 1000 + text.length * randomBetween(25, 55));
  await sleep(typingMs);
  const sent = await sock.sendMessage(jid, { text });
  await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  return sent?.key?.id ?? null;
}

// ---- Pesan masuk -------------------------------------------------------------------
/**
 * Handler pesan masuk dari modul: { priority, handle(msg) }. Prioritas kecil jalan
 * duluan (Pesan Masuk mencatat dulu, baru Autoreply membalas).
 */
const incomingHandlers = [];
export function addIncomingHandler(handler) {
  incomingHandlers.push(handler);
  incomingHandlers.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
}

const MEDIA_LABEL = {
  imageMessage: '[Gambar]', videoMessage: '[Video]', audioMessage: '[Pesan suara]', documentMessage: '[Dokumen]',
  documentWithCaptionMessage: '[Dokumen]', stickerMessage: '[Stiker]', locationMessage: '[Lokasi]',
  liveLocationMessage: '[Lokasi]', contactMessage: '[Kontak]', contactsArrayMessage: '[Kontak]', pollCreationMessage: '[Polling]',
};
const IGNORE_TYPES = new Set(['protocolMessage', 'reactionMessage', 'pollUpdateMessage', 'keepInChatMessage', 'editedMessage']);
const digitsOf = (jid) => jid?.split('@')[0]?.split(':')[0] ?? null;

/** Ubah pesan Baileys jadi bentuk sederhana. Mengembalikan null untuk yang tidak perlu diproses. */
async function normalizeIncoming(deviceId, sock, m) {
  const k = m.key;
  if (!k || k.fromMe || !m.message) return null;
  const chat = k.remoteJid;
  if (!chat || chat === 'status@broadcast' || chat.endsWith('@broadcast') || chat.endsWith('@newsletter')) return null;

  const raw = m.message;
  const inner = raw.ephemeralMessage?.message ?? raw.viewOnceMessage?.message ?? raw.viewOnceMessageV2?.message
    ?? raw.documentWithCaptionMessage?.message ?? raw;
  const msgType = Object.keys(inner).find((t) => t !== 'messageContextInfo' && t !== 'senderKeyDistributionMessage');
  if (!msgType || IGNORE_TYPES.has(msgType)) return null;

  const text = (
    inner.conversation ?? inner.extendedTextMessage?.text ?? inner.imageMessage?.caption ?? inner.videoMessage?.caption
    ?? inner.documentMessage?.caption ?? inner.buttonsResponseMessage?.selectedDisplayText
    ?? inner.listResponseMessage?.title ?? inner.templateButtonReplyMessage?.selectedDisplayText ?? ''
  ).trim();
  const label = MEDIA_LABEL[msgType];
  if (!text && !label) return null;

  const isGroup = chat.endsWith('@g.us');
  // Nomor HP pengirim: dari JID biasa, JID alternatif, atau pemetaan LID -> nomor
  const pnOf = (a, b) => [a, b].find((j) => j?.endsWith('@s.whatsapp.net'));
  const sender = isGroup ? (pnOf(k.participantAlt, k.participant) ?? k.participant) : (pnOf(k.remoteJidAlt, chat) ?? chat);
  let phone = sender?.endsWith('@s.whatsapp.net') ? digitsOf(sender) : null;
  if (!phone && sender?.endsWith('@lid')) {
    const pn = await sock.signalRepository?.lidMapping?.getPNForLID(sender).catch(() => null);
    if (pn) phone = digitsOf(pn);
  }

  // ID pesan yang dikutip (balasan "reply"), kalau ada
  const ctxInfo = inner[msgType]?.contextInfo ?? inner.extendedTextMessage?.contextInfo;
  return {
    deviceId,
    key: k,
    quotedId: ctxInfo?.stanzaId ?? null,
    chatJid: chat,
    senderJid: sender,
    phone,
    pushName: m.pushName ?? '',
    text,
    body: label ? (text ? `${label} ${text}` : label) : text,
    msgType,
    isGroup,
    at: Number(m.messageTimestamp ?? 0) * 1000 || Date.now(),
  };
}

/**
 * Peristiwa "serah ke admin" dari Chat Bot / AI Chat Bot (bisa terjadi setelah handler
 * selesai, mis. AI menjawab belakangan). Customer Service mendengarkan ini.
 */
const handoverListeners = [];
export const onHandover = (fn) => handoverListeners.push(fn);
export function emitHandover(msg, source) {
  for (const fn of handoverListeners) {
    try { fn(msg, source); } catch (err) { logger.warn({ err: err.message }, 'handover listener error'); }
  }
}

/** Tandai pesan sudah dibaca (centang biru). */
export async function markRead(deviceId, key) {
  const e = sessions.get(deviceId);
  if (e?.status === 'connected') await e.sock.readMessages([key]).catch(() => {});
}

/**
 * Antrean tambahan dari modul fitur (mis. Blast). Setiap provider:
 *   next(deviceId) -> null | { run(send, isConnected) }
 * `send(number, text)` mengirim dengan efek mengetik dan melempar NotOnWhatsApp
 * kalau nomor tidak terdaftar.
 */
const providers = [];
export function addQueueProvider(provider) {
  providers.push(provider);
}
export { NotOnWhatsApp };

/**
 * Proses antrean device ini. Prioritas:
 *  1. Pesan API / auto-reply Google Form (jeda pendek)
 *  2. Antrean modul (mis. Blast, dengan aturan anti-banned sendiri)
 * Dipanggil saat ada pesan baru, saat device tersambung, dan oleh ticker tiap 5 detik.
 */
export async function drainQueue(id) {
  const e = sessions.get(id);
  if (!e || e.working) return;
  e.working = true;
  try {
    while (e.status === 'connected' && e.sock) {
      const sock = e.sock;

      // Anti-banned: jenis pesan yang kuota hariannya habis ditahan (tetap antre untuk besok)
      const blocked = antiban.blockedKinds(id);
      messages.markHeld(id, blocked);
      const msg = messages.nextPending(id, blocked);
      if (msg) {
        try {
          const waId = await sendText(sock, msg.to_jid || msg.to_number, msg.body);
          messages.markSent(msg.id, waId);
        } catch (err) {
          if (err instanceof NotOnWhatsApp) messages.markFailed(msg.id, err.message);
          else messages.markAttemptFailed(msg.id, String(err?.message ?? err), MAX_ATTEMPTS);
          logger.warn({ id, msgId: msg.id, err: err?.message }, 'gagal kirim');
        }
        // Pesan yang kita mulai (Kirim Pesan, Ulang Tahun) memakai jeda lebih panjang
        if (antiban.INITIATED.includes(msg.kind)) {
          const s = antiban.loadSettings();
          await sleep(randomBetween(s.initDelayMin * 1000, s.initDelayMax * 1000));
        } else {
          await sleep(randomBetween(SEND_DELAY_MIN_MS, SEND_DELAY_MAX_MS));
        }
        continue;
      }

      let job = null;
      for (const p of providers) if ((job = p.next(id))) break;
      if (!job) break;
      try {
        await job.run(
          (number, text) => sendText(sock, number, text),
          () => e.status === 'connected'
        );
      } catch (err) {
        logger.error({ id, err: err?.message }, 'provider antrean error');
      }
    }
  } finally {
    e.working = false;
  }
}

// Ticker: lanjutkan antrean modul setelah jeda/istirahat selesai
setInterval(() => {
  for (const [id, e] of sessions) if (e.status === 'connected' && !e.working) drainQueue(id);
}, 5000).unref();

/** Saat server start: sambungkan semua device yang sudah pernah login. */
export async function restoreAll() {
  for (const d of devices.all()) {
    if (hasSession(d.id)) await startDevice(d.id).catch((err) => logger.error({ id: d.id, err: err.message }, 'gagal restore'));
  }
}

export const connectedCount = () => [...sessions.values()].filter((e) => e.status === 'connected').length;

export { logger, randomBetween };
export const canInitiate = antiban.canInitiate;
