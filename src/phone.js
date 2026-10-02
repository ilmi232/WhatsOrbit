import { DEFAULT_COUNTRY_CODE } from './config.js';

/**
 * Ubah format nomor bebas ("0812-3456-789", "+62 812...", "812...") jadi "62812...".
 * Mengembalikan null kalau tidak masuk akal sebagai nomor HP.
 */
export function normalizePhone(input) {
  let n = String(input ?? '').replace(/\D/g, '');
  if (!n) return null;
  if (n.startsWith('00')) n = n.slice(2); // awalan internasional: 0062...
  if (n.startsWith(DEFAULT_COUNTRY_CODE + '0')) n = DEFAULT_COUNTRY_CODE + n.slice(DEFAULT_COUNTRY_CODE.length + 1); // 62 0812...
  if (n.startsWith('0')) n = DEFAULT_COUNTRY_CODE + n.slice(1);
  else if (DEFAULT_COUNTRY_CODE === '62' && n.startsWith('8')) n = '62' + n;
  if (n.length < 9 || n.length > 15) return null;
  return n;
}
