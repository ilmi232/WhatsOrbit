import { normalizePhone } from './phone.js';

// Tabel tempel dari Google Sheets / Excel (tab), CSV (, atau ;), atau satu nomor per baris.
// Baris pertama boleh berupa judul kolom.
export const PHONE_HEADER = /^(no\.?\s*)?(wa|whatsapp|hp|telp|telepon|phone|nomor|no)\b/i;
export const NAME_HEADER = /^(nama|name)\b/i;

export function parseTable(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { columns: [], phoneIdx: 0, recipients: [], invalid: [], duplicates: 0 };

  const delim = ['\t', ';', ','].find((d) => lines[0].includes(d));
  const split = (l) => (delim ? l.split(delim) : [l]).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));

  let columns;
  let rows = lines.map(split);
  const hasHeader = !normalizePhone(rows[0].find((c) => /\d{6,}/.test(c)) ?? '') && rows[0].some((c) => /[a-z]/i.test(c));
  if (hasHeader) {
    columns = rows[0].map((c, i) => c || `Kolom${i + 1}`);
    rows = rows.slice(1);
  } else {
    columns = rows[0].map((_, i) => (i === 0 ? 'Nomor' : i === 1 ? 'Nama' : `Kolom${i + 1}`));
  }
  let phoneIdx = columns.findIndex((c) => PHONE_HEADER.test(c));
  if (phoneIdx < 0) phoneIdx = 0;

  const seen = new Set();
  const recipients = [];
  const invalid = [];
  let duplicates = 0;
  for (const r of rows) {
    const phone = normalizePhone(r[phoneIdx]);
    if (!phone) {
      invalid.push(r.join(' | '));
      continue;
    }
    if (seen.has(phone)) {
      duplicates++;
      continue;
    }
    seen.add(phone);
    recipients.push({ phone, vars: Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])) });
  }
  return { columns, phoneIdx, recipients, invalid, duplicates };
}
