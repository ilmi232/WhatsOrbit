import { $, chip, esc, fmt, icon } from '../ui.js';

/** Rapikan nomor seperti di server: 08… / +62… / 62 0… -> 62… (null kalau tidak valid). */
function normalize(input) {
  let n = String(input ?? '').replace(/\D/g, '');
  if (!n) return null;
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('620')) n = '62' + n.slice(3);
  if (n.startsWith('0')) n = '62' + n.slice(1);
  else if (n.startsWith('8')) n = '62' + n;
  return n.length >= 9 && n.length <= 15 ? n : null;
}
const local = (n) => '0' + n.slice(2);

/**
 * Ambil nomor dari teks tempelan Excel/Sheets/CSV: dipisah baris, tab, koma, titik koma.
 * Sel tanpa deret angka panjang (nama, kelas) diabaikan.
 */
function parseNumbers(text) {
  const seen = new Set();
  const valid = [];
  const invalid = [];
  let duplicates = 0;
  for (const part of String(text).split(/[\n,;\t|]+/)) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/[+\d][\d\s\-().]{6,}\d/);
    if (!m) {
      if (/\d{3,}/.test(t)) invalid.push(t); // ada angka tapi bukan nomor HP
      continue;
    }
    const n = normalize(m[0]);
    if (!n) { invalid.push(t); continue; }
    if (seen.has(n)) { duplicates++; continue; }
    seen.add(n);
    valid.push(n);
  }
  return { valid, invalid, duplicates };
}

const BLAST_HINT = 10;

function summary(el, ctx) {
  const p = parseNumbers($('#to', el).value);
  const box = $('#toInfo', el);
  if (!p.valid.length && !p.invalid.length) { box.innerHTML = ''; return p; }
  box.innerHTML = `
    <div class="row" style="gap:8px;margin-top:8px">
      ${chip('ok', `${fmt(p.valid.length)} nomor`)}
      ${p.duplicates ? chip('muted', `${fmt(p.duplicates)} ganda dibuang`) : ''}
      ${p.invalid.length ? chip('bad', `${fmt(p.invalid.length)} tidak valid`) : ''}
    </div>
    ${p.invalid.length ? `<div class="muted c-bad" style="margin-top:6px">Tidak valid: ${p.invalid.slice(0, 8).map(esc).join(', ')}${p.invalid.length > 8 ? ', …' : ''}</div>` : ''}
    ${p.valid.length > BLAST_HINT ? `
      <div class="est" style="margin-top:10px">
        ${fmt(p.valid.length)} nomor termasuk kiriman massal. Kirim Pesan hanya memakai jeda 4–10 detik.
        ${ctx.isOn('blast') ? 'Lebih aman pakai <a href="#/blast"><b>Blast</b></a> (jeda 20–60 detik, istirahat berkala, batas harian, variasi kalimat).' : ''}
      </div>` : ''}`;
  return p;
}

export default {
  async mount(el, ctx) {
    const devices = await ctx.loadDevices();
    el.innerHTML = `
    <div class="grid g-2">
      <form class="card" id="sendForm">
        <div class="card-head"><div><h3>Kirim Pesan</h3><p>Kirim pesan manual dari salah satu device</p></div></div>
        <label class="field"><span>Device pengirim</span>
          <select name="device" required>
            ${devices.map((d) => `<option value="${d.id}">${esc(d.name)} — ${d.status === 'connected' ? 'online' : 'offline'}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Nomor tujuan <span class="hint">— boleh paste langsung dari Excel / Google Sheets, otomatis dipisah koma</span></span>
          <textarea id="to" name="to" rows="3" style="min-height:76px" placeholder="0812xxxxxxxx, 0813xxxxxxxx" required></textarea>
          <div id="toInfo"></div>
        </label>
        <label class="field"><span>Pesan</span>
          <textarea name="body" rows="6" placeholder="Tulis pesan…" required></textarea>
        </label>
        <div class="row between">
          <span class="muted">Pesan masuk antrean dan dikirim satu per satu dengan efek mengetik.</span>
          <button class="btn grad" id="sendBtn">${icon('send')} Kirim</button>
        </div>
      </form>

      <div class="card">
        <div class="card-head"><div><h3>Status device</h3><p>Pesan tetap disimpan walau device offline</p></div></div>
        ${devices.map((d) => `
          <div class="list-row" style="grid-template-columns:46px minmax(0,1fr) auto">
            <span class="circle ${d.status === 'connected' ? 'c-ok' : 'c-bad'}">${icon('device')}</span>
            <div><b>${esc(d.name)}</b><small>${d.phone ? '+' + esc(d.phone) : 'Belum tertaut'}</small></div>
            ${chip(d.status)}
          </div>`).join('') || '<div class="empty">Belum ada device.</div>'}
      </div>
    </div>`;

    const to = $('#to', el);
    // Saat paste: ambil semua nomor dari tempelan, gabung dengan isi sebelumnya, tampilkan dipisah koma
    to.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text') ?? '';
      if (!/[\n\t;]/.test(text) && parseNumbers(text).valid.length < 2) return; // tempelan biasa, biarkan
      e.preventDefault();
      const before = to.value.slice(0, to.selectionStart);
      const after = to.value.slice(to.selectionEnd);
      const merged = parseNumbers(`${before}\n${text}\n${after}`);
      to.value = merged.valid.map(local).join(', ');
      summary(el, ctx);
      const pasted = parseNumbers(text);
      const dropped = merged.duplicates;
      const notes = [
        dropped ? `${fmt(dropped)} nomor ganda dibuang` : '',
        pasted.invalid.length ? `${fmt(pasted.invalid.length)} isi tidak valid diabaikan (${pasted.invalid.slice(0, 5).map(esc).join(', ')})` : '',
      ].filter(Boolean);
      if (notes.length) $('#toInfo', el).insertAdjacentHTML('beforeend', `<div class="muted" style="margin-top:4px">Dari tempelan: ${notes.join(' · ')}.</div>`);
    });
    to.addEventListener('input', () => summary(el, ctx));
    // Rapikan saat keluar dari kolom (mis. diketik manual dengan spasi/baris baru)
    to.addEventListener('blur', () => {
      const p = parseNumbers(to.value);
      if (p.valid.length && !p.invalid.length) to.value = p.valid.map(local).join(', ');
      summary(el, ctx);
    });

    $('#sendForm', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const p = parseNumbers(to.value);
      if (!p.valid.length) return ctx.toast('Belum ada nomor yang valid');
      const btn = $('#sendBtn', el);
      btn.disabled = true;
      try {
        const { data } = await ctx.call('POST', `/admin/devices/${f.device.value}/test`, { to: p.valid, body: f.body.value });
        ctx.toast(`${fmt(data.queued)} pesan masuk antrean`);
        f.body.value = '';
      } catch (err) {
        ctx.toast(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  },
};
