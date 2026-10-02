import { $, chip, confirmBox, copyText, esc, fmt, icon, localTime, timeAgo } from '../ui.js';

const st = { endpoints: [], events: [], retry: null, filter: { endpoint: '', status: '' }, docTab: 'node' };

const EVENT_LABEL = () => Object.fromEntries([...st.events.map((e) => [e.key, e.label]), ['webhook.test', 'Tes kirim']]);
const STATUS_CHIP = { ok: ['ok', 'Berhasil'], failed: ['failed', 'Gagal'], pending: ['pending', 'Menunggu'] };

function endpointCard(w, ctx) {
  const devs = w.device_ids.length
    ? w.device_ids.map((id) => ctx.state.devices.find((d) => d.id === id)?.name ?? id).join(', ')
    : 'Semua device';
  const labels = EVENT_LABEL();
  return `
    <div class="card" data-ep="${w.id}" style="padding:18px">
      <div class="row between" style="flex-wrap:nowrap;align-items:flex-start">
        <div style="min-width:0">
          <b style="font-size:15px">${esc(w.name)}</b>
          <div class="muted" style="font-size:12.5px;word-break:break-all">${esc(w.url)}</div>
        </div>
        <label class="switch" title="Aktif/nonaktif"><input type="checkbox" data-act="toggle" ${w.active ? 'checked' : ''} aria-label="Aktif"><i></i></label>
      </div>
      ${!w.active && w.paused_reason ? `<div class="wa-banner" style="border-radius:10px;margin:10px 0 0">⏸️ Dijeda otomatis: ${esc(w.paused_reason)}. Periksa URL lalu aktifkan lagi.</div>` : ''}
      <div class="row" style="gap:6px;margin:10px 0">
        ${w.events.map((e) => `<span class="chip muted">${esc(labels[e] ?? e)}</span>`).join('')}
        ${w.include_groups && w.events.includes('message.incoming') ? '<span class="chip muted">+ pesan grup</span>' : ''}
        ${w.allow_reply ? '<span class="chip ok">Balas via respons</span>' : ''}
      </div>
      <small class="muted">${icon('device')} ${esc(devs)} · 24 jam: <b class="c-ok">${fmt(w.stats.ok)}</b> berhasil, <b class="c-bad">${fmt(w.stats.failed)}</b> gagal${w.stats.pending ? `, ${fmt(w.stats.pending)} menunggu` : ''}
        ${w.last_success_at ? ` · terakhir sukses ${timeAgo(w.last_success_at)}` : ''}</small>
      <div class="field" style="margin:12px 0 10px"><span>Secret penanda tangan</span>
        <div class="row" style="flex-wrap:nowrap;gap:6px">
          <input readonly value="${esc(w.secret)}" type="password" data-secret style="font-family:monospace;font-size:12.5px">
          <button class="btn ghost sm" data-act="show" title="Tampilkan">${icon('search')}</button>
          <button class="btn ghost sm" data-act="copy" title="Salin">${icon('copy')}</button>
          <button class="btn ghost sm" data-act="rotate" title="Buat secret baru">${icon('refresh')}</button>
        </div>
      </div>
      <div class="row between">
        <div class="row" style="gap:6px">
          <button class="btn ghost sm" data-act="test">${icon('send')} Tes kirim</button>
          <button class="btn ghost sm" data-act="log">${icon('list')} Log</button>
        </div>
        <div class="row" style="gap:6px">
          <button class="btn ghost sm" data-act="edit">${icon('edit')} Ubah</button>
          <button class="btn bad-soft sm" data-act="delete" title="Hapus">${icon('trash')}</button>
        </div>
      </div>
    </div>`;
}

function endpointDialog(ctx, w = null) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const ev = w?.events ?? ['message.incoming'];
    bg.innerHTML = `
      <form class="modal wide">
        <h3>${w ? 'Ubah webhook' : 'Webhook baru'}</h3>
        <label class="field"><span>URL penerima</span>
          <input name="url" required value="${esc(w?.url ?? '')}" placeholder="https://aplikasi-sekolah.id/webhook/whatsapp">
          <span class="hint">WhatsOrbit mengirim <b>POST</b> berisi JSON ke URL ini setiap ada peristiwa yang dipilih.</span></label>
        <label class="field"><span>Nama <span class="hint">— opsional</span></span>
          <input name="name" value="${esc(w?.name ?? '')}" placeholder="mis. SIAKAD, n8n, Apps Script"></label>
        <div class="field"><span>Peristiwa</span>
          ${st.events.map((e) => `
            <label class="row" style="flex-wrap:nowrap;align-items:flex-start;cursor:pointer;margin:4px 0;gap:8px">
              <input type="checkbox" name="ev" value="${e.key}" ${ev.includes(e.key) ? 'checked' : ''} style="margin-top:3px">
              <span><b style="font-weight:600">${esc(e.label)}</b> <code class="muted" style="font-size:11.5px">${e.key}</code><br><small class="muted">${esc(e.desc)}</small></span>
            </label>`).join('')}
        </div>
        <div id="inOpts" style="margin:-4px 0 10px 26px">
          <label class="row" style="flex-wrap:nowrap;cursor:pointer;margin-bottom:6px"><input type="checkbox" name="include_groups" ${w?.include_groups ? 'checked' : ''}> Sertakan pesan dari grup</label>
          <label class="row" style="flex-wrap:nowrap;cursor:pointer;align-items:flex-start"><input type="checkbox" name="allow_reply" ${w?.allow_reply ? 'checked' : ''} style="margin-top:3px">
            <span>Izinkan balasan lewat respons <small class="muted"><br>Kalau penerima menjawab <code>{"reply":"teks"}</code>, WhatsOrbit membalas pengirimnya. Matikan bot lain di device yang sama agar tidak dobel.</small></span></label>
        </div>
        <div class="field"><span>Device <span class="hint">— tidak dipilih = semua device</span></span>
          <div class="row">${ctx.state.devices.map((d) => `
            <label class="check"><input type="checkbox" name="dev" value="${d.id}" ${w?.device_ids.includes(d.id) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('') || '<span class="muted">Belum ada device</span>'}</div>
        </div>
        <div class="row"><button type="button" class="btn ghost" data-x>Batal</button><button class="btn grad">Simpan</button></div>
      </form>`;
    const f = $('form', bg);
    const sync = () => { $('#inOpts', bg).style.display = f.querySelector('[value="message.incoming"]').checked ? '' : 'none'; };
    sync();
    f.addEventListener('change', sync);
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-x]')) { bg.remove(); resolve(false); } });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        url: f.url.value.trim(),
        name: f.name.value.trim(),
        events: [...f.querySelectorAll('[name=ev]:checked')].map((x) => x.value),
        device_ids: [...f.querySelectorAll('[name=dev]:checked')].map((x) => x.value),
        include_groups: f.include_groups.checked,
        allow_reply: f.allow_reply.checked,
      };
      try {
        await ctx.call(w ? 'PUT' : 'POST', w ? `/admin/webhooks/${w.id}` : '/admin/webhooks', body);
        bg.remove();
        resolve(true);
      } catch (err) { ctx.toast(err.message); }
    });
    document.body.append(bg);
    f.url.focus();
  });
}

async function deliveryDialog(ctx, id, el) {
  const { data: d } = await ctx.call('GET', `/admin/webhooks/deliveries/${id}`);
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  let resp = d.response ?? '';
  try { resp = JSON.stringify(JSON.parse(resp), null, 2); } catch { /* bukan JSON */ }
  const [cls, label] = STATUS_CHIP[d.status] ?? ['muted', d.status];
  bg.innerHTML = `
    <div class="modal wide" style="max-width:680px">
      <div class="row between" style="flex-wrap:nowrap"><h3 style="margin:0">${esc(EVENT_LABEL()[d.event] ?? d.event)}</h3>${chip(cls, label)}</div>
      <p style="margin:6px 0 12px">${esc(localTime(d.created_at))} · ${d.attempts}× percobaan${d.last_code ? ` · HTTP ${d.last_code}` : ''}${d.duration_ms != null ? ` · ${d.duration_ms} ms` : ''}
        ${d.status === 'pending' && d.attempts ? `\nPercobaan berikutnya ${new Date(d.next_at).toLocaleTimeString('id-ID')}` : ''}${d.last_error ? `\nError: ${d.last_error}` : ''}${d.replied && d.event === 'message.incoming' ? '\nBalasan dari respons sudah dikirim ke pengirim.' : ''}</p>
      <div class="label" style="margin-bottom:4px">Payload</div>
      <pre class="code" style="max-height:260px">${esc(JSON.stringify(d.payload, null, 2))}</pre>
      ${resp ? `<div class="label" style="margin:12px 0 4px">Respons penerima</div><pre class="code" style="max-height:180px">${esc(resp)}</pre>` : ''}
      <div class="row" style="margin-top:14px">
        <button class="btn ghost" data-x>Tutup</button>
        ${d.event !== 'webhook.test' && d.status !== 'pending' ? `<button class="btn grad" data-resend>${icon('refresh')} Kirim ulang</button>` : ''}
      </div>
    </div>`;
  bg.addEventListener('click', async (e) => {
    if (e.target === bg || e.target.closest('[data-x]')) return bg.remove();
    if (e.target.closest('[data-resend]')) {
      try {
        await ctx.call('POST', `/admin/webhooks/deliveries/${id}/resend`);
        ctx.toast('Masuk antrean kirim ulang');
        bg.remove();
        setTimeout(() => loadLog(el, ctx), 1500);
      } catch (err) { ctx.toast(err.message); }
    }
  });
  document.body.append(bg);
}

async function loadLog(el, ctx) {
  const q = new URLSearchParams({ limit: '60' });
  if (st.filter.endpoint) q.set('endpoint', st.filter.endpoint);
  if (st.filter.status) q.set('status', st.filter.status);
  const { data } = await ctx.call('GET', `/admin/webhooks/deliveries?${q}`);
  const labels = EVENT_LABEL();
  $('#whLog', el).innerHTML = data.length ? data.map((d) => {
    const [cls, label] = STATUS_CHIP[d.status] ?? ['muted', d.status];
    return `
      <div class="list-row" data-del="${d.id}" style="grid-template-columns:minmax(0,1fr) auto;cursor:pointer">
        <div style="min-width:0"><b>${esc(labels[d.event] ?? d.event)}</b>
          <small>${esc(d.endpoint)} · ${timeAgo(d.created_at)}${d.last_code ? ` · HTTP ${d.last_code}` : ''}${d.attempts > 1 ? ` · ${d.attempts}× percobaan` : ''}${d.last_error && d.status !== 'ok' && !/^HTTP \d+$/.test(d.last_error) ? ` · ${esc(d.last_error)}` : ''}</small></div>
        ${chip(cls, label)}
      </div>`;
  }).join('') : '<div class="muted">Belum ada pengiriman.</div>';
}

async function loadEndpoints(el, ctx) {
  const { data } = await ctx.call('GET', '/admin/webhooks');
  st.endpoints = data.endpoints;
  st.events = data.events;
  st.retry = data.retry;
  $('#whList', el).innerHTML = st.endpoints.map((w) => endpointCard(w, ctx)).join('') || `
    <div class="card empty">${icon('webhook')}<div>Belum ada webhook.<br><small class="muted">Tambahkan URL aplikasi yang ingin menerima pesan masuk, status kirim, dan peristiwa lainnya.</small></div></div>`;
  const sel = $('#whFilterEp', el);
  sel.innerHTML = `<option value="">Semua webhook</option>${st.endpoints.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}`;
  sel.value = st.filter.endpoint;
}

const SAMPLE = {
  'message.incoming': { id: '3EB0C431D2A8F1E6B7C2', chatJid: '6281234567890@s.whatsapp.net', from: '6281234567890', senderJid: '6281234567890@s.whatsapp.net', name: 'Budi', text: 'Assalamualaikum, mau tanya PPDB', body: 'Assalamualaikum, mau tanya PPDB', type: 'conversation', isGroup: false, groupName: null, quotedId: null, handled: false, timestamp: '2026-10-02T07:15:00.000Z' },
  'message.status': { id: 128, waId: '3EB0A1B2C3D4E5F6A7B8', status: 'sent', to: '6281234567890', kind: 'api', body: 'Terima kasih sudah mengisi formulir', error: null, attempts: 1 },
  'device.status': { status: 'disconnected', phone: '6281111111111', reason: 'Connection Closed', code: 428, reconnecting: true },
  'group.participants': { groupJid: '1203630xxxxxxxx@g.us', groupName: 'Wali Murid Kelas 7A', action: 'add', participants: [{ jid: '6281234567890@s.whatsapp.net', phone: '6281234567890' }], author: '6281111111111@s.whatsapp.net' },
  'lead.created': { lead: { name: 'Budi', phone: '6281234567890', source: 'Form PPDB' }, contactId: 42, isNew: true, group: 'Leads PPDB' },
  payment: { provider: 'mayar', event: 'payment.received', ref: 'a1b2c3d4-...', name: 'Budi', phone: '6281234567890', email: 'budi@contoh.id', product: 'Formulir PPDB 2027', amount: 250000, qty: 1, method: 'qris', status: 'paid' },
  'cs.ticket': { action: 'opened', ticketId: 17, chatJid: '6281234567890@s.whatsapp.net', phone: '6281234567890', name: 'Budi', agent: { id: 2, name: 'Bu Rina' }, source: 'chatbot' },
};

const VERIFY = {
  node: ['Node.js (Express)', `import crypto from 'node:crypto';

app.post('/webhook/whatsapp', express.raw({ type: 'application/json' }), (req, res) => {
  const ts = req.get('X-WhatsOrbit-Timestamp');
  const sig = req.get('X-WhatsOrbit-Signature');          // "sha256=..."
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSORBIT_SECRET)
    .update(ts + '.' + req.body).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;   // tolak > 5 menit
  if (!fresh || sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.sendStatus(401);

  const evt = JSON.parse(req.body);
  if (evt.event === 'message.incoming' && /jadwal/i.test(evt.data.text)) {
    return res.json({ reply: 'Jadwal pelajaran ada di https://...' });  // opsional
  }
  res.sendStatus(200);
});`],
  php: ['PHP', `<?php
$body = file_get_contents('php://input');
$ts   = $_SERVER['HTTP_X_WHATSORBIT_TIMESTAMP'] ?? '';
$sig  = $_SERVER['HTTP_X_WHATSORBIT_SIGNATURE'] ?? '';
$expected = 'sha256=' . hash_hmac('sha256', $ts . '.' . $body, getenv('WHATSORBIT_SECRET'));
if (!hash_equals($expected, $sig) || abs(time() - (int)$ts) > 300) {
  http_response_code(401); exit;
}
$evt = json_decode($body, true);
if ($evt['event'] === 'message.incoming') {
  // simpan ke database, dll.
}
http_response_code(200);`],
  python: ['Python (Flask)', `import hmac, hashlib, os, time
from flask import Flask, request, abort, jsonify

@app.post('/webhook/whatsapp')
def whatsorbit():
    ts  = request.headers.get('X-WhatsOrbit-Timestamp', '')
    sig = request.headers.get('X-WhatsOrbit-Signature', '')
    mac = hmac.new(os.environ['WHATSORBIT_SECRET'].encode(),
                   f"{ts}.".encode() + request.get_data(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest('sha256=' + mac, sig) or abs(time.time() - int(ts or 0)) > 300:
        abort(401)
    evt = request.get_json()
    return '', 200`],
  gas: ['Google Apps Script', `// Apps Script tidak bisa membaca header, jadi tanda tangan tidak bisa dicek.
// Pakai token rahasia di URL: https://script.google.com/macros/s/XXX/exec?token=RAHASIA
function doPost(e) {
  if (e.parameter.token !== 'RAHASIA') return ContentService.createTextOutput('forbidden');
  const evt = JSON.parse(e.postData.contents);
  if (evt.event === 'message.incoming') {
    SpreadsheetApp.openById('ID_SPREADSHEET').getSheetByName('Pesan Masuk')
      .appendRow([new Date(evt.timestamp), evt.data.from, evt.data.name, evt.data.text]);
  }
  return ContentService.createTextOutput('ok');
}`],
};

function docsHtml() {
  const r = st.retry;
  const [, code] = VERIFY[st.docTab];
  return `
    <div class="card-head"><div><h3>Format & Keamanan</h3><p>Untuk developer aplikasi penerima</p></div></div>
    <p class="muted" style="margin-top:0">Setiap peristiwa dikirim sebagai <b>POST JSON</b>:</p>
    <pre class="code" style="max-height:none">{
  "id": "evt_m1x2y3...",          // unik; sama saat dikirim ulang
  "event": "message.incoming",
  "timestamp": "2026-10-02T07:15:00.000Z",
  "device": { "id": "a1b2c3", "name": "Humas", "phone": "62811..." },
  "data": { ... }
}</pre>
    <div class="field" style="margin:14px 0 6px"><span>Contoh <code>data</code> per peristiwa</span>
      <select id="whSample">${st.events.map((e) => `<option value="${e.key}">${esc(e.label)} — ${e.key}</option>`).join('')}</select></div>
    <pre class="code" id="whSampleOut" style="max-height:300px"></pre>
    <div class="label" style="margin:16px 0 6px">Header</div>
    <ul class="muted" style="margin:0;padding-left:18px;line-height:1.8;font-size:13px">
      <li><code>X-WhatsOrbit-Event</code> — nama peristiwa</li>
      <li><code>X-WhatsOrbit-Delivery</code> — ID peristiwa (pakai untuk menyaring duplikat)</li>
      <li><code>X-WhatsOrbit-Timestamp</code> — waktu kirim (detik Unix)</li>
      <li><code>X-WhatsOrbit-Signature</code> — <code>sha256=</code>HMAC-SHA256(secret, <code>timestamp + "." + body</code>)</li>
    </ul>
    <div class="label" style="margin:16px 0 6px">Verifikasi tanda tangan</div>
    <div class="seg" style="margin-bottom:8px;flex-wrap:wrap">${Object.entries(VERIFY).map(([k, [l]]) => `<button type="button" data-doc="${k}" class="${k === st.docTab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <pre class="code">${esc(code)}</pre>
    <div class="label" style="margin:16px 0 6px">Pengiriman & kirim ulang</div>
    <ul class="muted" style="margin:0;padding-left:18px;line-height:1.8;font-size:13px">
      <li>Dianggap berhasil kalau penerima menjawab <b>HTTP 2xx</b> dalam ${r?.timeoutSeconds ?? 10} detik.</li>
      <li>Kalau gagal, dicoba lagi otomatis hingga ${r?.maxAttempts ?? 6}× dengan jeda 30 detik, 2 menit, 10 menit, 30 menit, 2 jam, 6 jam.</li>
      <li>Penerima yang menjawab <b>410 Gone</b>, atau gagal terus-menerus, dijeda otomatis.</li>
      <li>Balasan otomatis: jawab <code>{"reply": "teks"}</code> atau <code>{"reply": ["pesan 1", "pesan 2"]}</code> (kalau opsinya diaktifkan, untuk pesan masuk saja).</li>
      <li>Log pengiriman disimpan ${r?.keepDays ?? 14} hari.</li>
    </ul>`;
}

function renderDocs(el) {
  $('#whDocs', el).innerHTML = docsHtml();
  const showSample = () => {
    const k = $('#whSample', el).value;
    $('#whSampleOut', el).textContent = JSON.stringify(SAMPLE[k] ?? {}, null, 2);
  };
  $('#whSample', el).addEventListener('change', showSample);
  showSample();
}

export default {
  async mount(el, ctx) {
    await ctx.loadDevices();
    el.innerHTML = `
    <div class="grid g-dash">
      <div class="stack">
        <div class="row between">
          <div class="muted" style="font-size:13px">Kirim peristiwa WhatsOrbit ke aplikasi lain secara real-time.</div>
          <button class="btn grad" id="whAdd">${icon('plus')} Tambah webhook</button>
        </div>
        <div class="stack" id="whList"></div>
        <div class="card">
          <div class="card-head"><div><h3>Log Pengiriman</h3><p>Klik untuk melihat payload & respons</p></div>
            <button class="btn ghost sm" id="whClear" title="Bersihkan log">${icon('trash')}</button></div>
          <div class="toolbar">
            <select id="whFilterEp" style="width:auto" aria-label="Webhook"></select>
            <select id="whFilterSt" style="width:auto" aria-label="Status">
              <option value="">Semua status</option><option value="ok">Berhasil</option><option value="failed">Gagal</option><option value="pending">Menunggu</option>
            </select>
          </div>
          <div id="whLog"></div>
        </div>
      </div>
      <div class="stack"><div class="card" id="whDocs"></div></div>
    </div>`;

    $('#whAdd', el).addEventListener('click', async () => {
      if (await endpointDialog(ctx)) { ctx.toast('Webhook ditambahkan'); await loadEndpoints(el, ctx); }
    });
    $('#whFilterEp', el).addEventListener('change', (e) => { st.filter.endpoint = e.target.value; loadLog(el, ctx); });
    $('#whFilterSt', el).addEventListener('change', (e) => { st.filter.status = e.target.value; loadLog(el, ctx); });
    $('#whLog', el).addEventListener('click', (e) => {
      const r = e.target.closest('[data-del]');
      if (r) deliveryDialog(ctx, r.dataset.del, el).catch((err) => ctx.toast(err.message));
    });
    $('#whClear', el).addEventListener('click', async () => {
      if (!(await confirmBox('Bersihkan log pengiriman?', st.filter.endpoint ? 'Hanya log webhook yang dipilih. Antrean yang menunggu tidak dihapus.' : 'Antrean yang menunggu tidak dihapus.', { danger: true, okText: 'Bersihkan' }))) return;
      const { data } = await ctx.call('DELETE', `/admin/webhooks/deliveries${st.filter.endpoint ? `?endpoint=${st.filter.endpoint}` : ''}`);
      ctx.toast(`${fmt(data.deleted)} log dihapus`);
      loadLog(el, ctx);
    });
    $('#whDocs', el).addEventListener('click', (e) => {
      const b = e.target.closest('[data-doc]');
      if (b) { st.docTab = b.dataset.doc; renderDocs(el); }
    });

    $('#whList', el).addEventListener('change', async (e) => {
      if (e.target.dataset.act !== 'toggle') return;
      const w = st.endpoints.find((x) => x.id === Number(e.target.closest('[data-ep]').dataset.ep));
      try {
        await ctx.call('PUT', `/admin/webhooks/${w.id}`, { active: e.target.checked });
        ctx.toast(e.target.checked ? 'Webhook aktif' : 'Webhook dinonaktifkan');
        await loadEndpoints(el, ctx);
      } catch (err) { ctx.toast(err.message); }
    });
    $('#whList', el).addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.dataset.act === 'toggle') return;
      const card = b.closest('[data-ep]');
      const w = st.endpoints.find((x) => x.id === Number(card.dataset.ep));
      try {
        switch (b.dataset.act) {
          case 'show': { const i = $('[data-secret]', card); i.type = i.type === 'password' ? 'text' : 'password'; break; }
          case 'copy': copyText(w.secret, 'Secret disalin'); break;
          case 'rotate':
            if (!(await confirmBox('Buat secret baru?', 'Secret lama langsung tidak berlaku. Perbarui juga di aplikasi penerima.', { okText: 'Buat baru' }))) return;
            await ctx.call('POST', `/admin/webhooks/${w.id}/secret`);
            ctx.toast('Secret baru dibuat');
            await loadEndpoints(el, ctx);
            break;
          case 'test': {
            b.disabled = true;
            const { data } = await ctx.call('POST', `/admin/webhooks/${w.id}/test`).finally(() => { b.disabled = false; });
            ctx.toast(data.ok ? `Berhasil · HTTP ${data.code} · ${data.ms} ms` : `Gagal: ${data.error}`);
            loadLog(el, ctx);
            break;
          }
          case 'log':
            st.filter.endpoint = String(w.id);
            $('#whFilterEp', el).value = st.filter.endpoint;
            await loadLog(el, ctx);
            $('#whLog', el).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            break;
          case 'edit':
            if (await endpointDialog(ctx, w)) { ctx.toast('Webhook disimpan'); await loadEndpoints(el, ctx); }
            break;
          case 'delete':
            if (!(await confirmBox(`Hapus webhook "${w.name}"?`, 'Log pengirimannya ikut terhapus.', { danger: true, okText: 'Hapus' }))) return;
            await ctx.call('DELETE', `/admin/webhooks/${w.id}`);
            if (st.filter.endpoint === String(w.id)) st.filter.endpoint = '';
            await loadEndpoints(el, ctx);
            loadLog(el, ctx);
            break;
        }
      } catch (err) { ctx.toast(err.message); }
    });

    await loadEndpoints(el, ctx);
    renderDocs(el);
    await loadLog(el, ctx);
  },
  async refresh(el, ctx) {
    if (document.querySelector('.modal-bg')) return;
    await loadLog(el, ctx);
  },
};
