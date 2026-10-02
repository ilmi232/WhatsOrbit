import { $, $$, chip, confirmBox, copyText, esc, fmt, icon, localTime, timeAgo } from '../ui.js';

const st = { tab: 'lynk', data: null, q: '' };
const rupiah = (n) => (n == null ? '-' : `Rp ${Number(n).toLocaleString('id-ID')}`);
const STATUS = {
  sent: ['ok', 'WA dikirim'], logged: ['muted', 'Dicatat'], duplicate: ['muted', 'Duplikat'],
  rejected: ['failed', 'Ditolak'], no_phone: ['pending', 'Tanpa nomor'],
};
const VARS = '<b>[Nama]</b> <b>[Nomor]</b> <b>[Email]</b> <b>[Produk]</b> <b>[Total]</b> <b>[Jumlah]</b> <b>[Ref]</b> <b>[Tanggal]</b>';

const SETUP = {
  lynk: `<ol class="muted" style="margin:0;padding-left:18px;line-height:1.8;font-size:13px">
    <li>Buka dashboard <b>Lynk.id</b> → menu <b>Integrasi / Webhook</b>.</li>
    <li>Tempel <b>URL Webhook</b> di atas, lalu simpan.</li>
    <li>Lynk.id akan menampilkan <b>Merchant Key</b>. Tempel di kolom Merchant Key di bawah supaya WhatsOrbit hanya menerima notifikasi yang benar-benar dari Lynk.id.</li>
  </ol>`,
  mayar: `<ol class="muted" style="margin:0;padding-left:18px;line-height:1.8;font-size:13px">
    <li>Buka dashboard <b>Mayar.id</b> → <b>Integrasi → Webhook</b>.</li>
    <li>Tempel URL di atas ke kolom <b>URL Webhook</b>, klik simpan lalu <b>Test URL</b>.</li>
    <li>Mayar tidak memakai tanda tangan, jadi URL ini yang menjadi kuncinya. Jangan dibagikan; kalau bocor, klik <b>Buat URL baru</b>.</li>
  </ol>`,
};

function settingsHtml(p, ctx) {
  const s = st.data.providers[p];
  const kinds = st.data.kinds;
  const noPublic = !st.data.publicUrl;
  return `
    <div class="card">
      <div class="card-head"><div><h3>${esc(s.name)}</h3><p>Terima notifikasi pembayaran dari ${esc(s.name)}</p></div>
        <label class="switch" title="Aktif/nonaktif"><input type="checkbox" id="pyActive" ${s.active ? 'checked' : ''} aria-label="Aktif"><i></i></label></div>
      <div class="field"><span>URL Webhook</span>
        <div class="row" style="flex-wrap:nowrap;gap:6px">
          <input readonly value="${esc(s.url)}" id="pyUrl" style="font-family:monospace;font-size:12px">
          <button class="btn ghost sm" id="pyCopy" title="Salin">${icon('copy')}</button>
          <button class="btn ghost sm" id="pyRotate" title="Buat URL baru">${icon('refresh')}</button>
        </div>
        ${noPublic ? '<span class="hint c-warn">PUBLIC_URL di .env belum diisi, ganti "http://ALAMAT-PUBLIK" dengan alamat ngrok.</span>' : ''}
      </div>
      ${SETUP[p]}
      ${p === 'lynk' ? `
      <label class="field" style="margin-top:14px"><span>Merchant Key <span class="hint">— dari dashboard Lynk.id, untuk cek tanda tangan</span></span>
        <input id="pyKey" type="password" value="${esc(s.merchantKey)}" placeholder="Kosong = tidak dicek (tidak disarankan)" autocomplete="off"></label>` : ''}
      <label class="field" style="margin-top:14px"><span>Kirim dari device</span>
        <select id="pyDevice"><option value="">Otomatis (device yang tersambung)</option>
          ${ctx.state.devices.map((d) => `<option value="${d.id}" ${d.id === s.deviceId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Pesan ke Pembeli</h3><p>Dikirim otomatis ke nomor WhatsApp pembeli</p></div></div>
      ${s.kinds.map((k) => `
        <div style="margin-bottom:14px">
          <label class="row" style="flex-wrap:nowrap;cursor:pointer;font-weight:600;margin-bottom:6px">
            <input type="checkbox" data-kon="${k}" ${s.templates[k]?.on ? 'checked' : ''}> ${esc(kinds[k])}</label>
          <textarea data-ktext="${k}" style="min-height:${k === 'paid' ? 120 : 80}px">${esc(s.templates[k]?.text ?? '')}</textarea>
        </div>`).join('')}
      <span class="hint">${VARS}${p === 'mayar' ? ' <b>[LinkBayar]</b> <b>[Metode]</b>' : ' <b>[Addon]</b>'} · <b>{a|b}</b> variasi acak.</span>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Pesan per Produk</h3><p>Opsional: pesan pembayaran berhasil yang berbeda per produk</p></div>
        <button class="btn ghost sm" id="pyAddRule">${icon('plus')} Tambah</button></div>
      <div id="pyRules">${(s.rules ?? []).map(ruleHtml).join('') || '<div class="muted" data-empty>Belum ada. Semua produk memakai pesan di atas.</div>'}</div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Notifikasi Admin & Kontak</h3></div></div>
      <label class="row" style="flex-wrap:nowrap;cursor:pointer;font-weight:600;margin-bottom:8px">
        <input type="checkbox" id="pyAdminOn" ${s.adminOn ? 'checked' : ''}> Kabari admin saat ada pembayaran / member baru</label>
      <div id="pyAdminBox" class="${s.adminOn ? '' : 'hidden'}">
        <label class="field"><span>Nomor admin <span class="hint">— pisahkan dengan koma</span></span>
          <input id="pyAdminPhones" value="${esc(s.adminPhones)}" placeholder="0812..., 0857..."></label>
        <label class="field"><span>Pesan admin</span><textarea id="pyAdminText" style="min-height:90px">${esc(s.adminText)}</textarea>
          <span class="hint">Tambahan: <b>[Sumber]</b> (Lynk.id/Mayar.id), <b>[Peristiwa]</b>.</span></label>
      </div>
      <label class="row" style="flex-wrap:nowrap;cursor:pointer;font-weight:600;margin:8px 0">
        <input type="checkbox" id="pySaveContact" ${s.saveContact ? 'checked' : ''} ${ctx.isOn('contacts') ? '' : 'disabled'}> Simpan pembeli ke Kontak
        ${ctx.isOn('contacts') ? '' : '<span class="muted" style="font-weight:400">(fitur Kontak nonaktif)</span>'}</label>
      <label class="field"><span>Grup kontak</span><input id="pyGroup" value="${esc(s.contactGroup)}"></label>
      <div class="row" style="justify-content:flex-end"><button class="btn grad" id="pySave">${icon('check')} Simpan</button></div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Simulasi</h3><p>Coba alurnya tanpa transaksi sungguhan</p></div></div>
      <div class="row" style="gap:8px">
        <input id="pySimPhone" placeholder="Nomor WhatsApp tes" style="flex:1;min-width:160px">
        ${s.kinds.length > 1 ? `<select id="pySimKind" style="width:auto">${s.kinds.map((k) => `<option value="${k}">${esc(kinds[k])}</option>`).join('')}</select>` : ''}
        <button class="btn ghost" id="pySim">${icon('send')} Jalankan</button>
      </div>
      <span class="hint">Simpan pengaturan dulu. Pesan dikirim ke nomor tes (dan admin kalau aktif); data ditandai "tes" dan tidak masuk statistik.</span>
    </div>`;
}

const ruleHtml = (r = {}) => `
  <div class="list-row" data-rule style="grid-template-columns:minmax(0,1fr) auto;align-items:start">
    <div class="stack" style="gap:6px">
      <div class="row" style="flex-wrap:nowrap;gap:6px">
        <input data-r="match" value="${esc(r.match ?? '')}" placeholder="Nama produk mengandung… mis. PPDB">
        <input data-r="group" value="${esc(r.group ?? '')}" placeholder="Grup kontak (opsional)">
      </div>
      <textarea data-r="text" style="min-height:70px" placeholder="Pesan khusus produk ini (kosong = pakai pesan umum)">${esc(r.text ?? '')}</textarea>
    </div>
    <button class="btn bad-soft sm" data-rdel title="Hapus">${icon('trash')}</button>
  </div>`;

function collect(el, p) {
  const s = st.data.providers[p];
  const templates = {};
  for (const k of s.kinds) templates[k] = { on: $(`[data-kon="${k}"]`, el).checked, text: $(`[data-ktext="${k}"]`, el).value };
  return {
    active: $('#pyActive', el).checked,
    ...(p === 'lynk' ? { merchantKey: $('#pyKey', el).value.trim() } : {}),
    deviceId: $('#pyDevice', el).value,
    templates,
    rules: $$('[data-rule]', el).map((r) => ({ match: $('[data-r=match]', r).value, group: $('[data-r=group]', r).value, text: $('[data-r=text]', r).value })),
    adminOn: $('#pyAdminOn', el).checked,
    adminPhones: $('#pyAdminPhones', el).value,
    adminText: $('#pyAdminText', el).value,
    saveContact: $('#pySaveContact', el).checked,
    contactGroup: $('#pyGroup', el).value,
  };
}

function statsHtml() {
  const t = st.data.stats;
  const box = (label, v) => `<div class="card" style="padding:14px 16px;min-width:0"><div class="muted" style="font-size:12px">${label}</div>
    <div style="font-size:18px;font-weight:700;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${rupiah(v?.total ?? 0)}</div><small class="muted">${fmt(v?.n ?? 0)} transaksi</small></div>`;
  return ['lynk', 'mayar'].map((p) => `${box(`${st.data.providers[p].name} · hari ini`, t.today[p])}${box(`${st.data.providers[p].name} · bulan ini`, t.month[p])}`).join('');
}

async function loadEvents(el, ctx) {
  const q = new URLSearchParams({ provider: st.tab, limit: '80' });
  if (st.q) q.set('q', st.q);
  const { data } = await ctx.call('GET', `/admin/payments/events?${q}`);
  $('#pyEvents', el).innerHTML = data.length ? data.map((e) => {
    const [cls, label] = STATUS[e.status] ?? ['muted', e.status];
    return `
      <div class="list-row" data-ev="${e.id}" style="grid-template-columns:minmax(0,1fr) auto;cursor:pointer">
        <div style="min-width:0"><b>${esc(e.name || e.phone || '(tanpa nama)')}</b>${e.test ? ' <span class="chip muted">tes</span>' : ''}
          <small>${esc(e.eventLabel)} · ${esc(e.product || '-')}${e.amount != null ? ` · ${rupiah(e.amount)}` : ''}</small>
          <small>${timeAgo(e.created_at)}${e.note ? ` · ${esc(e.note)}` : ''}</small></div>
        ${chip(cls, label)}
      </div>`;
  }).join('') : `<div class="empty">${icon('link')}<div>Belum ada notifikasi dari ${esc(st.data.providers[st.tab].name)}.</div></div>`;
}

async function eventDialog(ctx, id, el) {
  const { data: d } = await ctx.call('GET', `/admin/payments/events/${id}`);
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  const [cls, label] = STATUS[d.status] ?? ['muted', d.status];
  bg.innerHTML = `
    <div class="modal wide" style="max-width:640px">
      <div class="row between" style="flex-wrap:nowrap"><h3 style="margin:0">${esc(d.eventLabel)}</h3>${chip(cls, label)}</div>
      <p style="margin:6px 0 12px">${esc(localTime(d.created_at))}${d.test ? ' · simulasi' : ''}${d.note ? `\n${d.note}` : ''}</p>
      <div class="grid g-2" style="gap:6px 14px;font-size:13px;margin-bottom:12px">
        <div><span class="muted">Nama</span><br><b>${esc(d.name || '-')}</b></div>
        <div><span class="muted">Nomor</span><br><b>${esc(d.phone || '-')}</b></div>
        <div><span class="muted">Produk</span><br><b>${esc(d.product || '-')}</b></div>
        <div><span class="muted">Total</span><br><b>${rupiah(d.amount)}</b></div>
        <div><span class="muted">Email</span><br>${esc(d.email || '-')}</div>
        <div><span class="muted">Ref</span><br><span style="word-break:break-all">${esc(d.ref || '-')}</span></div>
      </div>
      ${d.messages.length ? `<div class="label" style="margin-bottom:4px">Pesan WhatsApp</div>
        ${d.messages.map((m) => `<div style="margin-bottom:8px"><small class="muted">ke ${esc(m.to)} · ${chip(m.status)}${m.error ? ` ${esc(m.error)}` : ''}</small><div class="bubble" style="margin:4px 0">${esc(m.body)}</div></div>`).join('')}` : ''}
      <div class="label" style="margin:8px 0 4px">Payload asli</div>
      <pre class="code" style="max-height:240px">${esc(JSON.stringify(d.payload, null, 2))}</pre>
      <div class="row" style="margin-top:14px">
        <button class="btn ghost" data-x>Tutup</button>
        ${d.status !== 'rejected' ? `<button class="btn grad" data-re>${icon('refresh')} Proses ulang</button>` : ''}
      </div>
    </div>`;
  bg.addEventListener('click', async (e) => {
    if (e.target === bg || e.target.closest('[data-x]')) return bg.remove();
    if (e.target.closest('[data-re]')) {
      if (!(await confirmBox('Proses ulang notifikasi ini?', 'Pesan WhatsApp akan dikirim lagi memakai pengaturan sekarang.'))) return;
      try {
        await ctx.call('POST', `/admin/payments/events/${id}/reprocess`);
        ctx.toast('Diproses ulang');
        bg.remove();
        loadEvents(el, ctx);
      } catch (err) { ctx.toast(err.message); }
    }
  });
  document.body.append(bg);
}

async function render(el, ctx) {
  st.data = (await ctx.call('GET', '/admin/payments')).data;
  $('#pyStats', el).innerHTML = statsHtml();
  $$('[data-tab]', el).forEach((b) => b.classList.toggle('on', b.dataset.tab === st.tab));
  $('#pySettings', el).innerHTML = settingsHtml(st.tab, ctx);
  $('#pyEvTitle', el).textContent = `Notifikasi ${st.data.providers[st.tab].name}`;
  await loadEvents(el, ctx);
}

export default {
  async mount(el, ctx) {
    await ctx.loadDevices();
    el.innerHTML = `
    <div class="grid" id="pyStats" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:18px"></div>
    <div class="seg" style="margin-bottom:16px">
      <button type="button" data-tab="lynk">Lynk.id</button><button type="button" data-tab="mayar">Mayar.id</button>
    </div>
    <div class="grid g-dash">
      <div class="stack" id="pySettings"></div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h3 id="pyEvTitle">Notifikasi</h3><p>Klik untuk detail & pesan yang dikirim</p></div>
            <button class="btn ghost sm" id="pyReload" title="Muat ulang">${icon('refresh')}</button></div>
          <div class="toolbar"><div class="search">${icon('search')}<input id="pyQ" placeholder="Cari nama, nomor, produk, ref" aria-label="Cari"></div></div>
          <div id="pyEvents"></div>
        </div>
      </div>
    </div>`;

    el.addEventListener('click', async (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) { st.tab = tab.dataset.tab; return render(el, ctx); }
      const ev = e.target.closest('[data-ev]');
      if (ev) return eventDialog(ctx, ev.dataset.ev, el).catch((err) => ctx.toast(err.message));
      const p = st.tab;
      try {
        if (e.target.closest('#pyReload')) return loadEvents(el, ctx);
        if (e.target.closest('#pyCopy')) return copyText($('#pyUrl', el).value, 'URL webhook disalin');
        if (e.target.closest('#pyRotate')) {
          if (!(await confirmBox('Buat URL webhook baru?', `URL lama langsung tidak berlaku. Perbarui juga di dashboard ${st.data.providers[p].name}.`, { okText: 'Buat baru' }))) return;
          await ctx.call('POST', `/admin/payments/${p}/token`);
          ctx.toast('URL baru dibuat, perbarui di dashboard penyedia');
          return render(el, ctx);
        }
        if (e.target.closest('#pyAddRule')) {
          $('[data-empty]', el)?.remove();
          $('#pyRules', el).insertAdjacentHTML('beforeend', ruleHtml());
          return;
        }
        if (e.target.closest('[data-rdel]')) return e.target.closest('[data-rule]').remove();
        if (e.target.closest('#pySave')) {
          await ctx.call('PUT', `/admin/payments/${p}`, collect(el, p));
          ctx.toast('Pengaturan disimpan');
          return render(el, ctx);
        }
        if (e.target.closest('#pySim')) {
          const btn = e.target.closest('#pySim');
          btn.disabled = true;
          const { data } = await ctx.call('POST', `/admin/payments/${p}/simulate`, { phone: $('#pySimPhone', el).value, kind: $('#pySimKind', el)?.value })
            .finally(() => { btn.disabled = false; });
          ctx.toast(data.status === 'sent' ? 'Simulasi berhasil, pesan masuk antrean' : `Simulasi: ${STATUS[data.status]?.[1] ?? data.status}${data.note ? ` (${data.note})` : ''}`);
          return loadEvents(el, ctx);
        }
      } catch (err) { ctx.toast(err.message); }
    });
    el.addEventListener('change', async (e) => {
      if (e.target.id === 'pyAdminOn') $('#pyAdminBox', el).classList.toggle('hidden', !e.target.checked);
      if (e.target.id === 'pyActive') {
        try {
          await ctx.call('PUT', `/admin/payments/${st.tab}`, { active: e.target.checked });
          ctx.toast(e.target.checked ? 'Integrasi aktif' : 'Integrasi dinonaktifkan (URL menolak notifikasi)');
        } catch (err) { ctx.toast(err.message); }
      }
    });
    let t;
    el.addEventListener('input', (e) => {
      if (e.target.id !== 'pyQ') return;
      clearTimeout(t);
      t = setTimeout(() => { st.q = e.target.value.trim(); loadEvents(el, ctx); }, 300);
    });

    await render(el, ctx);
  },
  async refresh(el, ctx) {
    if (document.querySelector('.modal-bg')) return;
    await loadEvents(el, ctx);
  },
};
