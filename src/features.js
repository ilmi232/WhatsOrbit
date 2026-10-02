import express from 'express';
import { getSetting, setSetting } from './db.js';

/**
 * Daftar fitur yang bisa diaktifkan/nonaktifkan di menu Pengaturan.
 *
 * Fitur dengan `load` adalah modul terpisah: kodenya baru di-import (masuk RAM)
 * saat fitur aktif. Menonaktifkan langsung mematikan menu, API, dan proses kirimnya;
 * memorinya benar-benar dilepas setelah server di-restart.
 */
export const FEATURES = [
  {
    key: 'api',
    name: 'API & Google Form',
    description: 'Endpoint /api/send untuk Apps Script (auto-reply Google Form) dan aplikasi lain.',
    default: true,
  },
  {
    key: 'contacts',
    name: 'Data & Group Kontak',
    description: 'Simpan kontak (nama, nomor, kolom bebas), kelompokkan ke grup, import/export, dan pakai sebagai penerima Blast.',
    default: true,
    load: () => import('./modules/contacts.js'),
  },
  {
    key: 'leads',
    name: 'Daily Leads',
    description: 'Simpan otomatis pengisi Google Form sebagai kontak + grup, dengan rekap harian dan export.',
    default: true,
    requires: ['contacts'],
    load: () => import('./modules/leads.js'),
  },
  {
    key: 'birthday',
    name: 'Ulang Tahun',
    description: 'Kirim ucapan ulang tahun otomatis setiap pagi berdasarkan kolom tanggal lahir di Kontak.',
    default: true,
    requires: ['contacts'],
    load: () => import('./modules/birthday.js'),
  },
  {
    key: 'inbox',
    name: 'Pesan Masuk',
    description: 'Catat pesan WhatsApp yang diterima device (chat pribadi), bisa dibalas dari dashboard. Disimpan 90 hari.',
    default: true,
    load: () => import('./modules/inbox.js'),
  },
  {
    key: 'webwa',
    name: 'Web WhatsApp',
    description: 'Baca & balas chat dalam tampilan percakapan seperti WhatsApp Web; bot diam otomatis saat admin membalas.',
    default: true,
    requires: ['inbox'],
    load: () => import('./modules/webwa.js'),
  },
  {
    key: 'cs',
    name: 'Customer Service',
    description: 'Bagi chat ke petugas CS secara bergiliran. Petugas membalas dari WhatsApp pribadinya, diteruskan dari nomor sekolah.',
    default: true,
    load: () => import('./modules/cs.js'),
  },
  {
    key: 'chatbot',
    name: 'Chat Bot',
    description: 'Bot menu bernomor (mis. 1. Info PPDB, 2. Jadwal) dengan sesi per chat dan serah-ke-admin.',
    default: true,
    load: () => import('./modules/chatbot.js'),
  },
  {
    key: 'aibot',
    name: 'AI Chat Bot',
    description: 'Menjawab pertanyaan bebas memakai AI (Gemini gratis, Groq, OpenRouter, OpenAI, Claude, atau server sendiri) berdasarkan info sekolah.',
    default: true,
    load: () => import('./modules/aibot.js'),
  },
  {
    key: 'autoreply',
    name: 'Autoreply',
    description: 'Balas otomatis berdasarkan kata kunci atau semua pesan (mis. di luar jam kantor), dengan jeda per pengirim.',
    default: true,
    load: () => import('./modules/autoreply.js'),
  },
  {
    key: 'greeter',
    name: 'Group Greeter',
    description: 'Sapa anggota baru di grup WhatsApp (dengan @mention), opsional pesan pamit & pesan pribadi ke anggota baru.',
    default: true,
    load: () => import('./modules/greeter.js'),
  },
  {
    key: 'widget',
    name: 'Chat Widget',
    description: 'Tombol WhatsApp melayang untuk website sekolah: banyak agen, jam online, sapaan, dan statistik klik.',
    default: true,
    load: () => import('./modules/widget.js'),
  },
  {
    key: 'formScript',
    name: 'Generator Script Google Form',
    description: 'Membuat kode Apps Script siap tempel untuk auto-reply Google Form.',
    default: true,
  },
  {
    key: 'sheets',
    name: 'Generator Script Google Spreadsheet',
    description: 'Kirim WhatsApp otomatis saat ada baris baru di Google Spreadsheet (dengan kolom status & kondisi).',
    default: true,
  },
  {
    key: 'blast',
    name: 'Blast',
    description: 'Kirim pesan massal dengan anti-banned: jeda acak, istirahat, batas harian, rotasi device.',
    default: true,
    load: () => import('./modules/blast.js'),
  },
  {
    key: 'messageLog',
    name: 'Log Pesan',
    description: 'Riwayat pesan API/Google Form beserta status dan tombol kirim ulang.',
    default: true,
  },
];

const byKey = Object.fromEntries(FEATURES.map((f) => [f.key, f]));

const stored = JSON.parse(getSetting('features', () => '{}'));
const enabled = Object.fromEntries(FEATURES.map((f) => [f.key, stored[f.key] ?? f.default]));
// Fitur yang syaratnya mati ikut dianggap mati
for (const f of FEATURES) if (f.requires?.some((r) => !enabled[r])) enabled[f.key] = false;
const loaded = new Set();

/** Router per fitur modul, dipasang sejak awal dan diisi saat modul dimuat. */
const routers = Object.fromEntries(FEATURES.filter((f) => f.load).map((f) => [f.key, express.Router()]));

export const isEnabled = (key) => !!enabled[key];

/** Middleware: tolak request kalau fiturnya nonaktif. */
export const requireFeature = (key) => (_req, res, next) =>
  enabled[key] ? next() : res.status(404).json({ success: false, message: `Fitur "${byKey[key].name}" nonaktif` });

export const featureRouter = (key) => routers[key];

/** Router publik (tanpa login/API key) per fitur modul, mis. pencatat klik Chat Widget. */
const publicRouters = Object.fromEntries(FEATURES.filter((f) => f.load).map((f) => [f.key, express.Router()]));
export const publicRouter = (key) => publicRouters[key];

async function loadModule(key, ctx) {
  const f = byKey[key];
  if (!f.load || loaded.has(key)) return;
  const mod = await f.load();
  await mod.register({ ...ctx, router: routers[key], publicRouter: publicRouters[key], isEnabled: () => enabled[key] });
  loaded.add(key);
}

let context = null;

/** Muat semua modul fitur yang aktif. Dipanggil sekali saat server start. */
export async function loadEnabled(ctx) {
  context = ctx;
  for (const f of FEATURES) if (enabled[f.key]) await loadModule(f.key, ctx);
}

/** Fitur lain yang ikut mati kalau `key` dimatikan (karena membutuhkannya). */
const dependents = (key) => FEATURES.filter((f) => f.requires?.includes(key)).map((f) => f.key);

/**
 * Aktifkan/nonaktifkan fitur. Mengaktifkan butuh semua `requires` aktif;
 * menonaktifkan ikut mematikan fitur yang bergantung padanya.
 * Mengembalikan daftar kunci fitur yang berubah.
 */
export async function setEnabled(key, on) {
  const f = byKey[key];
  if (!f) throw new Error('Fitur tidak dikenal');
  const changed = [key];
  if (on) {
    const missing = (f.requires ?? []).filter((r) => !enabled[r]);
    if (missing.length) throw new Error(`Aktifkan dulu: ${missing.map((r) => byKey[r].name).join(', ')}`);
  } else {
    const stack = [key];
    while (stack.length) {
      for (const d of dependents(stack.pop())) {
        if (enabled[d] && !changed.includes(d)) {
          enabled[d] = false;
          changed.push(d);
          stack.push(d);
        }
      }
    }
  }
  enabled[key] = !!on;
  setSetting('features', JSON.stringify(enabled));
  if (on) await loadModule(key, context);
  return changed;
}

export function list() {
  return FEATURES.map((f) => ({
    key: f.key,
    name: f.name,
    description: f.description,
    enabled: enabled[f.key],
    requires: (f.requires ?? []).map((r) => ({ key: r, name: byKey[r].name, enabled: enabled[r] })),
    dependents: dependents(f.key).map((d) => byKey[d].name),
    module: !!f.load,
    loaded: loaded.has(f.key),
    // Modul masih di memori walau sudah dimatikan -> perlu restart untuk melepas RAM
    restartToFree: !!f.load && loaded.has(f.key) && !enabled[f.key],
  }));
}

export const enabledMap = () => ({ ...enabled });
