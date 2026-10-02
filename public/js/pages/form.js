import { $, copyText, esc, icon } from '../ui.js';

const store = {
  get(k) { try { return localStorage.getItem('wo_' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('wo_' + k, v); } catch { /* abaikan */ } },
};

const DEFAULTS = {
  sgFields: 'Nama\nKelas\nAsal sekolah\nNo Wa',
  sgMsg: 'Halo [Nama], terima kasih sudah mendaftar.\n\nData kamu:\nKelas: [Kelas]\nAsal sekolah: [Asal sekolah]\n\nKami akan segera menghubungi kamu.',
};

function buildScript(el, ctx) {
  const fields = $('#sgFields', el).value.split('\n').map((s) => s.trim()).filter(Boolean);
  const toSel = $('#sgTo', el);
  // Pertahankan pilihan kalau field-nya masih ada; kalau tidak, tebak dari judulnya
  const guessTo = fields.find((f) => /whatsapp|\bwa\b|\bhp\b|telp|telepon|nomor|\bno\b|phone/i.test(f)) || fields[0];
  const curTo = fields.includes(toSel.value) ? toSel.value : guessTo;
  toSel.innerHTML = fields.map((f) => `<option>${esc(f)}</option>`).join('');
  if (curTo) toSel.value = curTo;

  const nameSel = $('#sgNameField', el);
  const curName = fields.includes(nameSel.value) ? nameSel.value : fields.find((f) => /^nama\b|^name\b/i.test(f)) || '';
  nameSel.innerHTML = '<option value="">(tidak ada)</option>' + fields.map((f) => `<option>${esc(f)}</option>`).join('');
  nameSel.value = fields.includes(curName) ? curName : '';

  const d = ctx.state.devices.find((x) => x.id === $('#sgDevice', el).value) || ctx.state.devices[0];
  const base = ($('#sgUrl', el).value.trim() || 'https://ALAMAT-SERVER-ANDA').replace(/\/+$/, '');
  const js = (s) => JSON.stringify(s);

  const leadOn = ctx.isOn('leads') && $('#sgLead', el).checked;
  const reply = !leadOn || $('#sgReply', el).checked;
  $('#leadOpts', el).classList.toggle('hidden', !leadOn);
  $('#msgBox', el).classList.toggle('hidden', !reply);
  const leadJs = leadOn
    ? `{
    name: jawab(${js(nameSel.value)}),
    nameField: ${js(nameSel.value)},
    phone: tujuan,
    source: ${js($('#sgSource', el).value.trim() || 'Google Form')},
    group: ${js($('#sgGroup', el).value.trim())},
    fields: semua
  }`
    : '';

  // Ubah "Halo [Nama]" jadi gabungan string JS
  const msg = $('#sgMsg', el).value;
  const parts = [];
  let last = 0;
  msg.replace(/\[([^\]]+)\]/g, (m, name, idx) => {
    if (idx > last) parts.push(js(msg.slice(last, idx)));
    parts.push(fields.includes(name.trim()) ? `jawab(${js(name.trim())})` : js(m));
    last = idx + m.length;
  });
  if (last < msg.length) parts.push(js(msg.slice(last)));

  const payloadJs = reply
    ? `{ messageType: "text", to: tujuan, body: pesan${leadOn ? ', lead: lead' : ''} }`
    : '{ lead: lead }';

  $('#sgOut', el).textContent =
`function onFormSubmitWA(e) {
  var API_KEY = ${js(d ? d.api_key : 'BUAT-DEVICE-DULU')};
  var URL = ${js(base + (reply ? '/api/send' : '/api/lead'))};

  // Kumpulkan jawaban, baik dari pemicu Form (e.response) maupun Spreadsheet (e.namedValues)
  var data = {};   // judul huruf kecil -> jawaban (untuk dicari)
  var semua = {};  // judul asli -> jawaban (untuk disimpan)
  if (e.response) {
    e.response.getItemResponses().forEach(function (r) {
      var v = r.getResponse();
      var t = r.getItem().getTitle().trim();
      semua[t] = Array.isArray(v) ? v.join(", ") : String(v).trim();
      data[t.toLowerCase()] = semua[t];
    });
  } else if (e.namedValues) {
    for (var k in e.namedValues) {
      if (k === "Timestamp") continue;
      semua[k.trim()] = String(e.namedValues[k][0]).trim();
      data[k.trim().toLowerCase()] = semua[k.trim()];
    }
  }

  function jawab(field) {
    return data[field.trim().toLowerCase()] || "";
  }

  var tujuan = jawab(${js(toSel.value || '')});
${reply ? `  var pesan = ${parts.join('\n    + ') || '""'};\n` : ''}${leadOn ? `  var lead = ${leadJs};\n` : ''}
  if (!tujuan) {
    Logger.log("Nomor tujuan kosong. Field yang terbaca: " + Object.keys(data).join(" | "));
    return;
  }

  var response = UrlFetchApp.fetch(URL, {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": API_KEY, "ngrok-skip-browser-warning": "1" },
    payload: JSON.stringify(${payloadJs}),
    muteHttpExceptions: true
  });

  Logger.log(response.getResponseCode() + " " + response.getContentText());
}

// Jalankan SEKALI dari editor (pilih fungsi ini lalu klik Jalankan)
// untuk memasang pemicu "saat formulir dikirim".
function pasangPemicu() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "onFormSubmitWA") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("onFormSubmitWA").forForm(FormApp.getActiveForm()).onFormSubmit().create();
  Logger.log("Pemicu terpasang");
}
`;
}

export default {
  async mount(el, ctx) {
    const devices = await ctx.loadDevices();
    el.innerHTML = `
    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.35fr)">
      <div class="card">
        <div class="card-head"><div><h3>Google Form Script</h3><p>Auto-reply WhatsApp saat formulir dikirim</p></div></div>
        <label class="field"><span>Device pengirim</span>
          <select id="sgDevice">${devices.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
        </label>
        <label class="field"><span>URL server (publik)</span>
          <input id="sgUrl" placeholder="https://nama-anda.ngrok-free.app">
          <span class="hint">Alamat tunnel (ngrok/Cloudflare). Apps Script tidak bisa memanggil localhost.</span>
        </label>
        <label class="field"><span>Judul pertanyaan Google Form <span class="hint">— satu per baris, sama seperti di form</span></span>
          <textarea id="sgFields" style="min-height:120px"></textarea>
        </label>
        <label class="field"><span>Field nomor WhatsApp pengisi</span><select id="sgTo"></select></label>

        ${ctx.isOn('leads') ? `
        <div class="preview" style="margin:4px 0 16px">
          <label class="row" style="flex-wrap:nowrap;cursor:pointer;font-weight:600">
            <input type="checkbox" id="sgLead"> Simpan pengisi sebagai lead (Daily Leads)
          </label>
          <div class="hint muted" style="margin:4px 0 0 26px">Pengisi otomatis masuk menu Kontak + grup, dan tercatat per hari.</div>
          <div id="leadOpts" class="hidden" style="margin-top:14px">
            <label class="field"><span>Field nama</span><select id="sgNameField"></select></label>
            <label class="field"><span>Masukkan ke grup kontak</span><input id="sgGroup" placeholder="mis. Pendaftar PPDB 2026"></label>
            <label class="field"><span>Nama sumber <span class="hint">— untuk membedakan form di Daily Leads</span></span><input id="sgSource" placeholder="mis. Form PPDB"></label>
            <label class="row" style="flex-wrap:nowrap;cursor:pointer;font-weight:500">
              <input type="checkbox" id="sgReply" checked> Kirim balasan WhatsApp juga
            </label>
          </div>
        </div>` : '<select id="sgNameField" class="hidden"></select><input type="checkbox" id="sgLead" class="hidden"><div id="leadOpts" class="hidden"></div>'}

        <label class="field" id="msgBox"><span>Pesan balasan</span>
          <textarea id="sgMsg" style="min-height:160px"></textarea>
          <span class="hint">Pakai <b>[Judul Field]</b> untuk memanggil isi jawaban.</span>
        </label>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h3>Kode Apps Script</h3><p>Salin lalu tempel di Apps Script Google Form</p></div>
          <button class="btn grad" id="copyScript">${icon('copy')} Copy</button>
        </div>
        <pre class="code" id="sgOut"></pre>
        <div class="est" style="margin-top:16px">
          <b>Cara pasang:</b> buka Google Form (mode edit) → ⋮ → <b>Apps Script</b> → tempel kode → Simpan →
          pilih fungsi <b>pasangPemicu</b> di toolbar → <b>Jalankan</b> → izinkan akses. Cukup sekali.
        </div>
      </div>
    </div>`;

    const texts = ['sgUrl', 'sgFields', 'sgMsg', ...(ctx.isOn('leads') ? ['sgGroup', 'sgSource'] : [])];
    for (const id of texts) {
      const saved = store.get(id);
      $('#' + id, el).value = saved ?? DEFAULTS[id] ?? '';
    }
    if (!$('#sgUrl', el).value) $('#sgUrl', el).value = ctx.state.info?.publicUrl || '';
    if (ctx.isOn('leads')) {
      $('#sgLead', el).checked = store.get('sgLead') === '1';
      $('#sgReply', el).checked = store.get('sgReply') !== '0';
    }

    for (const id of texts) {
      $('#' + id, el).addEventListener('input', () => { store.set(id, $('#' + id, el).value); buildScript(el, ctx); });
    }
    for (const id of ['sgLead', 'sgReply']) {
      $('#' + id, el)?.addEventListener('change', (e) => { store.set(id, e.target.checked ? '1' : '0'); buildScript(el, ctx); });
    }
    for (const id of ['sgDevice', 'sgTo', 'sgNameField']) $('#' + id, el).addEventListener('change', () => buildScript(el, ctx));
    $('#copyScript', el).addEventListener('click', () => copyText($('#sgOut', el).textContent, 'Script disalin'));
    buildScript(el, ctx);
  },
};
