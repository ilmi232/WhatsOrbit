import { $, copyText, esc, icon } from '../ui.js';

const store = {
  get(k) { try { return localStorage.getItem('wo_sh_' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('wo_sh_' + k, v); } catch { /* abaikan */ } },
};
const DEFAULTS = {
  sheet: '',
  headerRow: '1',
  headers: 'Nama\tNo WA\tKelas\tStatus Pembayaran',
  sample: '',
  statusColumn: 'Status WA',
  template: '{Halo|Assalamualaikum} [Nama], pembayaran untuk kelas [Kelas] sudah kami terima. Terima kasih 🙏',
  every: '5',
  maxPerRun: '10',
  condColumn: '',
  condValue: '',
  leadGroup: '',
};
const FIELDS = Object.keys(DEFAULTS);

/** Judul kolom dari baris judul yang di-paste (dipisah tab, koma, atau baris baru). */
function parseHeaders(text) {
  const line = String(text).split(/\r?\n/).find((l) => l.trim()) ?? '';
  const parts = line.includes('\t') ? line.split('\t') : line.includes(';') ? line.split(';') : line.includes(',') ? line.split(',') : String(text).split(/\r?\n/);
  return [...new Set(parts.map((h) => h.trim()).filter(Boolean))];
}
const placeholders = (tpl) => [...new Set([...String(tpl).matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim()))];

/** Kode Apps Script (String.raw supaya regex di dalamnya tidak berubah). */
export function scriptCode(cfg) {
  const json = JSON.stringify(cfg, null, 2).replace(/\n/g, '\n');
  return String.raw`/**
 * WhatsOrbit — kirim WhatsApp otomatis dari Google Spreadsheet.
 * Dibuat oleh dashboard WhatsOrbit. Untuk mengubah pengaturan, ubah di dashboard lalu tempel ulang.
 *
 * Cara pasang: Simpan -> pilih fungsi "pasangPemicu" -> Jalankan -> izinkan akses.
 * Baris yang sudah ada saat dipasang ditandai "Dilewati (data lama)" (tidak dikirimi).
 */
var WO = ${json};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('WhatsOrbit')
    .addItem('Proses baris baru sekarang', 'prosesBaris')
    .addItem('Kirim ulang baris yang dipilih', 'kirimBarisTerpilih')
    .addSeparator()
    .addItem('Pasang / perbarui pemicu otomatis', 'pasangPemicu')
    .addToUi();
}

/** Jalankan SEKALI dari editor: memasang pemeriksaan otomatis & menandai baris lama. */
function pasangPemicu() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'prosesBaris') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('prosesBaris').timeBased().everyMinutes(WO.everyMinutes).create();
  var n = tandaiBarisLama();
  Logger.log('Pemicu terpasang: diperiksa setiap ' + WO.everyMinutes + ' menit. Baris lama ditandai: ' + n);
}

function lembar_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = WO.sheet ? ss.getSheetByName(WO.sheet) : ss.getSheets()[0];
  if (!sh) throw new Error('Tab "' + WO.sheet + '" tidak ditemukan');
  return sh;
}

/** Judul kolom + posisi; kolom status dibuat kalau belum ada. */
function kolom_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(WO.headerRow, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  head.forEach(function (h, i) { if (h) idx[h.toLowerCase()] = i; });
  if (idx[WO.statusColumn.toLowerCase()] === undefined) {
    sh.getRange(WO.headerRow, lastCol + 1).setValue(WO.statusColumn).setFontWeight('bold');
    head.push(WO.statusColumn);
    idx[WO.statusColumn.toLowerCase()] = head.length - 1;
  }
  return { head: head, idx: idx, status: idx[WO.statusColumn.toLowerCase()] };
}

function teks_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  return String(v === null || v === undefined ? '' : v).trim();
}

function data_(head, row) {
  var o = {};
  head.forEach(function (h, i) { if (h && h !== WO.statusColumn) o[h] = teks_(row[i]); });
  return o;
}

function ambil_(d, kolom) {
  var k = String(kolom || '').trim().toLowerCase();
  for (var key in d) if (key.toLowerCase() === k) return d[key];
  return '';
}

/** Isi template: {a|b} dipilih acak, [Kolom] diganti isi kolom. */
function isi_(tpl, d) {
  var out = tpl;
  for (var i = 0; i < 20 && /\{[^{}]*\|[^{}]*\}/.test(out); i++) {
    out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, function (_, o) { var a = o.split('|'); return a[Math.floor(Math.random() * a.length)]; });
  }
  return out.replace(/\[([^\]]+)\]/g, function (m, k) {
    var v = ambil_(d, k);
    return v === '' && !(k.trim().toLowerCase() in lower_(d)) ? m : v;
  });
}
function lower_(d) { var o = {}; for (var k in d) o[k.toLowerCase()] = 1; return o; }

/** Baris siap dikirim? (nomor terisi, kolom di pesan terisi, kondisi terpenuhi) */
function siap_(d) {
  if (!ambil_(d, WO.phoneColumn)) return false;
  for (var i = 0; i < WO.required.length; i++) if (!ambil_(d, WO.required[i])) return false;
  if (WO.condition) {
    var nilai = ambil_(d, WO.condition.column).toLowerCase();
    var cari = WO.condition.value.toLowerCase();
    if (cari ? nilai !== cari : !nilai) return false;
  }
  return true;
}

/** Kirim satu baris ke WhatsOrbit. retry=true kalau server tidak bisa dihubungi (dicoba lagi nanti). */
function kirim_(d) {
  var payload = { messageType: 'text', to: ambil_(d, WO.phoneColumn), body: isi_(WO.template, d) };
  if (WO.lead) {
    payload.lead = { name: ambil_(d, WO.lead.nameColumn), nameField: WO.lead.nameColumn, source: WO.lead.source, group: WO.lead.group, fields: d };
  }
  var res;
  try {
    res = UrlFetchApp.fetch(WO.url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: WO.apiKey, 'ngrok-skip-browser-warning': '1' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    return { retry: true, msg: String(e) };
  }
  var code = res.getResponseCode();
  var body = null;
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = null; }
  if (!body || code >= 500) return { retry: true, msg: 'Server tidak bisa dihubungi (' + code + ')' };
  if (body.success) return { ok: true, msg: 'Masuk antrean' };
  return { ok: false, msg: String(body.message || ('HTTP ' + code)).slice(0, 120) };
}

function tandai_(sh, baris, kol, hasil) {
  var waktu = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM HH:mm');
  sh.getRange(baris, kol + 1).setValue((hasil.ok ? '✓ ' : '✗ ') + hasil.msg + ' · ' + waktu);
}

/** Dipanggil otomatis oleh pemicu: kirim baris baru yang statusnya masih kosong. */
function prosesBaris() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    var sh = lembar_();
    var k = kolom_(sh);
    var last = sh.getLastRow();
    if (last <= WO.headerRow) return;
    var rows = sh.getRange(WO.headerRow + 1, 1, last - WO.headerRow, k.head.length).getValues();
    var terkirim = 0;
    for (var r = 0; r < rows.length && terkirim < WO.maxPerRun; r++) {
      if (teks_(rows[r][k.status])) continue; // sudah diproses
      var d = data_(k.head, rows[r]);
      if (!siap_(d)) continue; // belum lengkap / kondisi belum terpenuhi: tunggu
      var hasil = kirim_(d);
      if (hasil.retry) { Logger.log(hasil.msg); break; } // coba lagi putaran berikutnya
      tandai_(sh, WO.headerRow + 1 + r, k.status, hasil);
      terkirim++;
    }
  } finally {
    lock.releaseLock();
  }
}

/** Tandai semua baris yang sudah ada supaya tidak ikut dikirimi. */
function tandaiBarisLama() {
  var sh = lembar_();
  var k = kolom_(sh);
  var last = sh.getLastRow();
  if (last <= WO.headerRow) return 0;
  var range = sh.getRange(WO.headerRow + 1, k.status + 1, last - WO.headerRow, 1);
  var vals = range.getValues();
  var n = 0;
  for (var i = 0; i < vals.length; i++) if (!teks_(vals[i][0])) { vals[i][0] = 'Dilewati (data lama)'; n++; }
  range.setValues(vals);
  return n;
}

/** Menu: kirim (ulang) baris yang sedang dipilih, tanpa melihat status & kondisi. */
function kirimBarisTerpilih() {
  var ui = SpreadsheetApp.getUi();
  var sh = SpreadsheetApp.getActiveSheet();
  var sel = sh.getActiveRange();
  var mulai = Math.max(sel.getRow(), WO.headerRow + 1);
  var akhir = sel.getLastRow();
  if (akhir < mulai) return ui.alert('Pilih baris data (bukan baris judul).');
  if (ui.alert('Kirim WhatsApp ke ' + (akhir - mulai + 1) + ' baris yang dipilih?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var k = kolom_(sh);
  var rows = sh.getRange(mulai, 1, akhir - mulai + 1, k.head.length).getValues();
  for (var r = 0; r < rows.length; r++) {
    var d = data_(k.head, rows[r]);
    if (!ambil_(d, WO.phoneColumn)) continue;
    var hasil = kirim_(d);
    if (hasil.retry) return ui.alert('Server WhatsOrbit tidak bisa dihubungi: ' + hasil.msg);
    tandai_(sh, mulai + r, k.status, hasil);
  }
}
`;
}

function renderLocal(text, sample) {
  const low = Object.fromEntries(Object.entries(sample).map(([k, v]) => [k.toLowerCase(), v]));
  let out = text;
  for (let i = 0; i < 20 && /\{[^{}]*\|[^{}]*\}/.test(out); i++) out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, o) => o.split('|')[0]);
  return out.replace(/\[([^\]]+)\]/g, (m, k) => (k.trim().toLowerCase() in low ? low[k.trim().toLowerCase()] || `(${k.trim()} kosong)` : m));
}

function build(el, ctx) {
  const v = Object.fromEntries(FIELDS.map((f) => [f, $(`#sh_${f}`, el)?.value ?? '']));
  const headers = parseHeaders(v.headers);
  // Pilihan kolom
  const fill = (sel, current, guess, blank = false) => {
    const box = $(sel, el);
    const val = headers.includes(current) ? current : guess;
    box.innerHTML = (blank ? '<option value="">(tidak ada)</option>' : '') + headers.map((h) => `<option>${esc(h)}</option>`).join('');
    box.value = val ?? '';
  };
  const guessPhone = headers.find((h) => /whatsapp|\bwa\b|\bhp\b|telp|telepon|nomor|\bno\b|phone/i.test(h)) ?? headers[0];
  const guessName = headers.find((h) => /^nama\b|^name\b/i.test(h)) ?? '';
  fill('#sh_phone', $('#sh_phone', el).value || store.get('phone'), guessPhone);
  fill('#sh_condCol', $('#sh_condCol', el).value || v.condColumn, '', true);
  fill('#sh_leadName', $('#sh_leadName', el).value || store.get('leadName'), guessName, true);

  const phoneColumn = $('#sh_phone', el).value;
  const condCol = $('#sh_condCol', el).value;
  const leadOn = ctx.isOn('leads') && $('#sh_lead', el)?.checked;
  const d = ctx.state.devices.find((x) => x.id === $('#sh_device', el).value) ?? ctx.state.devices[0];
  const base = ($('#sh_url', el).value.trim() || 'https://ALAMAT-SERVER-ANDA').replace(/\/+$/, '');
  const unknown = placeholders(v.template).filter((p) => !headers.some((h) => h.toLowerCase() === p.toLowerCase()));

  const cfg = {
    apiKey: d ? d.api_key : 'BUAT-DEVICE-DULU',
    url: `${base}/api/send`,
    sheet: v.sheet.trim(),
    headerRow: Math.max(1, Number.parseInt(v.headerRow, 10) || 1),
    phoneColumn,
    statusColumn: v.statusColumn.trim() || 'Status WA',
    template: v.template,
    required: placeholders(v.template).filter((p) => headers.some((h) => h.toLowerCase() === p.toLowerCase())),
    condition: condCol ? { column: condCol, value: v.condValue.trim() } : null,
    everyMinutes: Number(v.every),
    maxPerRun: Math.max(1, Math.min(50, Number.parseInt(v.maxPerRun, 10) || 10)),
    lead: leadOn ? { nameColumn: $('#sh_leadName', el).value, group: v.leadGroup.trim(), source: `Spreadsheet${v.sheet.trim() ? `: ${v.sheet.trim()}` : ''}` } : null,
  };
  $('#sh_out', el).textContent = scriptCode(cfg);
  $('#sh_leadOpts', el)?.classList.toggle('hidden', !leadOn);

  // Pratinjau dengan baris contoh (kalau di-paste) atau isian contoh
  const sampleRow = (String(v.sample).split(/\r?\n/).find((l) => l.trim()) ?? '').split('\t');
  const sample = Object.fromEntries(headers.map((h, i) => [h, (sampleRow[i] ?? '').trim() || (v.sample ? '' : `contoh ${h}`)]));
  $('#sh_preview', el).textContent = renderLocal(v.template, sample);
  $('#sh_warn', el).innerHTML = [
    !phoneColumn ? 'Pilih kolom nomor WhatsApp.' : '',
    unknown.length ? `Tidak ada kolom bernama ${unknown.map((u) => `<b>[${esc(u)}]</b>`).join(', ')} di baris judul, jadi akan tampil apa adanya.` : '',
    !$('#sh_url', el).value.trim() ? 'Isi URL server publik (ngrok/Cloudflare).' : '',
  ].filter(Boolean).map((t) => `<div>⚠️ ${t}</div>`).join('');
  $('#sh_condHint', el).textContent = condCol
    ? (v.condValue.trim() ? `Hanya dikirim kalau "${condCol}" = "${v.condValue.trim()}" (huruf besar/kecil diabaikan).` : `Hanya dikirim kalau "${condCol}" sudah terisi.`)
    : 'Semua baris baru dikirim.';
}

export default {
  async mount(el, ctx) {
    const devices = await ctx.loadDevices();
    el.innerHTML = `
    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h3>Spreadsheet</h3><p>Tempel baris judul dari spreadsheet supaya kolomnya terbaca</p></div></div>
          <label class="field"><span>Device pengirim</span><select id="sh_device">${devices.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label>
          <label class="field"><span>URL server (publik)</span><input id="sh_url" placeholder="https://nama-anda.ngrok-free.app"></label>
          <div class="grid g-2" style="gap:12px">
            <label class="field"><span>Nama tab <span class="hint">— kosong = tab pertama</span></span><input id="sh_sheet" placeholder="mis. Sheet1"></label>
            <label class="field"><span>Baris judul</span><input type="number" min="1" id="sh_headerRow"></label>
          </div>
          <label class="field"><span>Baris judul kolom <span class="hint">— copy baris judul di spreadsheet, paste di sini</span></span>
            <textarea id="sh_headers" class="mono" style="min-height:52px"></textarea></label>
          <label class="field"><span>Contoh satu baris data <span class="hint">— opsional, untuk pratinjau</span></span>
            <textarea id="sh_sample" class="mono" style="min-height:44px" placeholder="Budi Santoso&#9;081234567890&#9;9A&#9;Lunas"></textarea></label>
          <div class="grid g-2" style="gap:12px">
            <label class="field"><span>Kolom nomor WhatsApp</span><select id="sh_phone"></select></label>
            <label class="field"><span>Kolom status <span class="hint">— dibuat otomatis</span></span><input id="sh_statusColumn"></label>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Pesan</h3></div></div>
          <label class="field"><textarea id="sh_template" style="min-height:120px"></textarea>
            <span class="hint"><b>[Judul Kolom]</b> = isi kolom; <b>{a|b}</b> variasi acak. Baris ditunggu sampai semua kolom di pesan terisi.</span></label>
          <div class="label" style="margin-bottom:4px">Pratinjau</div>
          <div class="bubble" id="sh_preview" style="white-space:pre-wrap"></div>
          <div class="muted c-warn" id="sh_warn" style="margin-top:6px"></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Aturan kirim</h3></div></div>
          <div class="grid g-2" style="gap:12px">
            <label class="field"><span>Hanya kalau kolom</span><select id="sh_condCol"></select></label>
            <label class="field"><span>bernilai <span class="hint">— kosong = asal terisi</span></span><input id="sh_condValue" placeholder="mis. Lunas"></label>
          </div>
          <div class="hint muted" id="sh_condHint" style="margin:-6px 0 12px"></div>
          <div class="grid g-2" style="gap:12px">
            <label class="field"><span>Periksa baris baru setiap</span>
              <select id="sh_every">${[1, 5, 10, 15, 30].map((m) => `<option value="${m}">${m} menit</option>`).join('')}</select></label>
            <label class="field"><span>Maks. baris per pemeriksaan</span><input type="number" min="1" max="50" id="sh_maxPerRun"></label>
          </div>
          ${ctx.isOn('leads') ? `
          <label class="row" style="flex-wrap:nowrap;cursor:pointer;font-weight:600;margin-top:4px">
            <input type="checkbox" id="sh_lead"> Simpan juga sebagai kontak (Daily Leads)</label>
          <div id="sh_leadOpts" class="hidden" style="margin-top:10px">
            <div class="grid g-2" style="gap:12px">
              <label class="field"><span>Kolom nama</span><select id="sh_leadName"></select></label>
              <label class="field"><span>Masukkan ke grup kontak</span><input id="sh_leadGroup" placeholder="mis. Pembayaran Lunas"></label>
            </div>
          </div>` : '<select id="sh_leadName" class="hidden"></select><input id="sh_leadGroup" class="hidden">'}
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head">
            <div><h3>Kode Apps Script</h3><p>Tempel di spreadsheet: Ekstensi → Apps Script</p></div>
            <button class="btn grad" id="sh_copy">${icon('copy')} Copy</button>
          </div>
          <pre class="code" id="sh_out"></pre>
          <div class="est" style="margin-top:14px">
            <b>Cara pasang:</b><br>
            1. Buka spreadsheet → <b>Ekstensi → Apps Script</b>, hapus isi lama, tempel kode, <b>Simpan</b>.<br>
            2. Pilih fungsi <b>pasangPemicu</b> di toolbar → <b>Jalankan</b> → izinkan akses.<br>
            3. Selesai. Baris yang sudah ada ditandai <i>Dilewati (data lama)</i>; baris baru dikirimi otomatis dan kolom <b>Status WA</b> terisi.<br>
            4. Muat ulang spreadsheet untuk melihat menu <b>WhatsOrbit</b> (proses sekarang / kirim ulang baris terpilih).
          </div>
          <ul class="muted" style="margin:12px 0 0;padding-left:18px;line-height:1.8">
            <li>Kirim ulang satu baris: kosongkan sel <b>Status WA</b>-nya.</li>
            <li>Kalau server WhatsOrbit mati, baris tidak ditandai gagal; dicoba lagi di pemeriksaan berikutnya.</li>
            <li>Pesan masuk antrean WhatsOrbit (jeda & efek mengetik), dihitung sebagai pesan API.</li>
          </ul>
        </div>
      </div>
    </div>`;

    for (const f of FIELDS) {
      const inp = $(`#sh_${f}`, el);
      if (inp) inp.value = store.get(f) ?? DEFAULTS[f];
    }
    if (!$('#sh_url', el).value) $('#sh_url', el).value = ctx.state.info?.publicUrl || '';
    const dev = store.get('device');
    if (dev && devices.some((d) => d.id === dev)) $('#sh_device', el).value = dev;
    if ($('#sh_lead', el)) $('#sh_lead', el).checked = store.get('lead') === '1';
    // Pilihan kolom dari simpanan
    $('#sh_phone', el).value = store.get('phone') ?? '';
    $('#sh_condCol', el).value = store.get('condColumn') ?? '';

    el.addEventListener('input', (e) => {
      const id = e.target.id?.replace(/^sh_/, '');
      if (FIELDS.includes(id)) store.set(id, e.target.value);
      build(el, ctx);
    });
    el.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id === 'sh_phone') store.set('phone', e.target.value);
      if (id === 'sh_condCol') store.set('condColumn', e.target.value);
      if (id === 'sh_leadName') store.set('leadName', e.target.value);
      if (id === 'sh_device') store.set('device', e.target.value);
      if (id === 'sh_lead') store.set('lead', e.target.checked ? '1' : '0');
      if (id === 'sh_every') store.set('every', e.target.value);
      build(el, ctx);
    });
    $('#sh_copy', el).addEventListener('click', () => copyText($('#sh_out', el).textContent, 'Kode disalin'));
    build(el, ctx);
  },
};
