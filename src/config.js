import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

export const ROOT_DIR = root;
export const DATA_DIR = path.resolve(root, process.env.DATA_DIR || 'data');
export const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

export const PORT = int(process.env.PORT, 3077);
export const HOST = process.env.HOST || '127.0.0.1';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
// Izinkan dashboard dibuka lewat tunnel (internet). Default: hanya /api yang publik.
export const PUBLIC_DASHBOARD = process.env.PUBLIC_DASHBOARD === 'true';
// Alamat publik (ngrok/Cloudflare), dipakai sebagai default di generator script
export const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');

// Jeda acak antar pesan per device (anti-banned)
export const SEND_DELAY_MIN_MS = int(process.env.SEND_DELAY_MIN_MS, 4000);
export const SEND_DELAY_MAX_MS = int(process.env.SEND_DELAY_MAX_MS, 10000);
export const MAX_ATTEMPTS = int(process.env.MAX_ATTEMPTS, 3);
export const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || '62';
