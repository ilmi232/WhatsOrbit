import { $, $$, chip, confirmBox, esc, fmt, fmtDur, icon, localTime, STATUS } from '../ui.js';

let defaults = null;
let openId = null;

const FORM = `
<form id="blastForm" class="card hidden" style="margin-bottom:24px">
  <div class="card-head"><div><h3>Buat Blast</h3><p>Kirim pesan ke banyak nomor dengan perlindungan anti-banned</p></div></div>
  <label class="field"><span>Nama blast</span>
    <input id="bName" placeholder="mis. Undangan Rapat Wali Murid Kelas 9" required>
  </label>
  <div class="field"><span>Kirim dari device <span class="hint">— pilih lebih dari satu untuk membagi beban bergantian</span></span>
    <div id="bDevices" class="row"></div>
  </div>
  <div class="grid g-2" style="gap:18px">
    <div class="field"><span>Penerima</span>
      <div class="seg src-tabs hidden" id="bSource">
        <button type="button" data-src="paste" class="on">Tempel daftar</button>
        <button type="button" data-src="groups">Dari grup kontak</button>
      </div>
      <div id="bPaste" class="field" style="margin:0">
        <textarea id="bRecipients" class="mono" style="min-height:230px" placeholder="Nomor&#9;Nama&#9;Kelas&#10;081234567890&#9;Budi&#9;9A&#10;0812-9876-5432&#9;Siti&#9;9B"></textarea>
        <span class="hint">Copy-paste dari Google Sheets/Excel (baris pertama = judul kolom), CSV, atau satu nomor per baris. Nomor ganda otomatis dibuang.</span>
      </div>
      <div id="bGroups" class="hidden">
        <div id="bGroupList" class="row"></div>
        <span class="hint" style="display:block;margin-top:8px">Bisa pilih beberapa grup; kontak yang ada di lebih dari satu grup hanya dikirimi sekali.
          Placeholder: <code>[Nama]</code> <code>[Nomor]</code> dan semua kolom data kontak (mis. <code>[Kelas]</code>).</span>
      </div>
    </div>
    <label class="field"><span>Pesan</span>
      <textarea id="bTemplate" style="min-height:230px" placeholder="{Halo|Hai|Selamat siang} Bapak/Ibu [Nama],&#10;&#10;Kami mengundang wali murid kelas [Kelas] ..."></textarea>
      <span class="hint"><b>[Nama Kolom]</b> = isi kolom penerima. <b>{Halo|Hai|Selamat siang}</b> = dipilih acak per penerima, supaya pesan tidak identik (sangat disarankan).</span>
    </label>
  </div>

  <details open style="margin-top:6px">
    <summary style="cursor:pointer;font-weight:600;margin-bottom:12px">Pengaturan anti-banned</summary>
    <div class="settings-grid">
      <label class="field"><span>Jeda antar pesan (detik)</span><span class="row"><input type="number" min="5" data-s="delay_min_s"> s/d <input type="number" min="5" data-s="delay_max_s"></span></label>
      <label class="field"><span>Istirahat setiap … pesan</span><span class="row"><input type="number" min="1" data-s="batch_size"></span></label>
      <label class="field"><span>Lama istirahat (menit)</span><span class="row"><input type="number" min="0" data-s="rest_min_m"> s/d <input type="number" min="0" data-s="rest_max_m"></span></label>
      <label class="field"><span>Batas per device per hari</span><span class="row"><input type="number" min="1" data-s="daily_limit"></span></label>
      <label class="field"><span>Jam kirim</span><span class="row"><input type="number" min="0" max="23" data-s="hour_start"> s/d <input type="number" min="1" max="24" data-s="hour_end"></span></label>
    </div>
    <div class="est hidden" id="bEstimate"></div>
  </details>

  <div id="bPreview" class="preview hidden"></div>

  <div class="row between" style="margin-top:18px">
    <button type="button" class="btn soft" id="bPreviewBtn">${icon('check')} Pratinjau</button>
    <div class="row">
      <button type="button" class="btn ghost" id="bCancel">Batal</button>
      <button type="button" class="btn ghost" data-save="draft">Simpan draft</button>
      <button type="button" class="btn grad" data-save="start">${icon('play')} Simpan & Mulai</button>
    </div>
  </div>
</form>`;

// ---- Form -----------------------------------------------------------------------
const settings = (el) => Object.fromEntries($$('[data-s]', el).map((i) => [i.dataset.s, Number(i.value)]));

let source = 'paste';
let contactGroups = [];

function recipientCount(el) {
  if (source === 'groups') {
    // Perkiraan (kontak di beberapa grup terhitung lebih dari sekali)
    const picked = new Set($$('#bGroupList input:checked', el).map((i) => Number(i.value)));
    return contactGroups.filter((g) => picked.has(g.id)).reduce((s, g) => s + g.members, 0);
  }
  const seen = new Set();
  for (const line of $('#bRecipients', el).value.split('\n')) {
    const num = (line.match(/[+\d][\d\s\-().]{7,}\d/g) ?? []).map((s) => s.replace(/\D/g, '')).sort((a, b) => b.length - a.length)[0];
    if (num && num.length >= 9) seen.add(num.slice(-9));
  }
  return seen.size;
}

function updateEstimate(el) {
  const s = settings(el);
  const n = recipientCount(el);
  const box = $('#bEstimate', el);
  box.classList.toggle('hidden', !n);
  if (!n) return;
  const devs = Math.max(1, $$('#bDevices input:checked', el).length);
  const perDevice = Math.ceil(n / devs);
  const today = Math.min(perDevice, s.daily_limit);
  const avg = (s.delay_min_s + s.delay_max_s) / 2 + 5; // + waktu mengetik
  const rests = Math.floor(today / Math.max(1, s.batch_size)) * ((s.rest_min_m + s.rest_max_m) / 2) * 60;
  const days = Math.ceil(perDevice / s.daily_limit);
  box.innerHTML =
    `Estimasi: <b>${source === 'groups' ? 'maks. ' : ''}${fmt(n)}</b> penerima${source === 'groups' ? ' (kontak di beberapa grup dihitung sekali saat dikirim)' : ''}, ${devs} device → ± <b>${fmtDur(today * avg + rests)}</b> per hari` +
    (days > 1 ? `, selesai dalam <b>${days} hari</b> (batas ${s.daily_limit}/device/hari)` : '') +
    `. Hanya dikirim pukul ${s.hour_start}.00–${s.hour_end}.00.`;
}

function renderDevices(el, ctx) {
  const box = $('#bDevices', el);
  const checked = new Set($$('input:checked', box).map((i) => i.value));
  box.innerHTML = ctx.state.devices.map((d) => `
    <label class="check"><input type="checkbox" value="${d.id}" ${checked.has(d.id) ? 'checked' : ''}>
      ${esc(d.name)} ${chip(d.status)}</label>`).join('') || '<span class="muted">Belum ada device.</span>';
}

function setSource(el, src) {
  source = src;
  for (const b of $$('#bSource button', el)) b.classList.toggle('on', b.dataset.src === src);
  $('#bPaste', el).classList.toggle('hidden', src !== 'paste');
  $('#bGroups', el).classList.toggle('hidden', src !== 'groups');
  $('#bPreview', el).classList.add('hidden');
  updateEstimate(el);
}

async function loadContactGroups(el, ctx) {
  const on = ctx.isOn('contacts');
  $('#bSource', el).classList.toggle('hidden', !on);
  if (!on) return setSource(el, 'paste');
  contactGroups = (await ctx.call('GET', '/admin/contacts/groups')).data;
  $('#bGroupList', el).innerHTML = contactGroups.map((g) => `
    <label class="check"><input type="checkbox" value="${g.id}">
      <span class="dot-c" style="background:${esc(g.color)}"></span>${esc(g.name)} <span class="muted">${fmt(g.members)}</span></label>`).join('')
    || '<span class="muted">Belum ada grup kontak. Buat di menu <a href="#/contacts">Kontak</a>.</span>';
}

const payload = (el) => ({
  name: $('#bName', el).value,
  template: $('#bTemplate', el).value,
  source,
  groupIds: $$('#bGroupList input:checked', el).map((i) => Number(i.value)),
  recipients: $('#bRecipients', el).value,
  deviceIds: $$('#bDevices input:checked', el).map((i) => i.value),
  settings: settings(el),
});

function bindForm(el, ctx) {
  const form = $('#blastForm', el);
  $('#newBlast', el).addEventListener('click', async () => {
    form.reset();
    $('#bPreview', el).classList.add('hidden');
    for (const i of $$('[data-s]', el)) i.value = defaults?.[i.dataset.s] ?? '';
    renderDevices(el, ctx);
    setSource(el, 'paste');
    form.classList.remove('hidden');
    $('#bName', el).focus();
    try { await loadContactGroups(el, ctx); } catch (err) { ctx.toast(err.message); }
  });
  $('#bSource', el).addEventListener('click', (e) => {
    const src = e.target.closest('[data-src]')?.dataset.src;
    if (src) setSource(el, src);
  });
  $('#bCancel', el).addEventListener('click', () => form.classList.add('hidden'));
  form.addEventListener('input', () => updateEstimate(el));
  form.addEventListener('submit', (e) => e.preventDefault());

  $('#bPreviewBtn', el).addEventListener('click', async () => {
    try {
      const { data } = await ctx.call('POST', '/admin/campaigns/preview', payload(el));
      const p = $('#bPreview', el);
      p.classList.remove('hidden');
      p.innerHTML = `
        <div class="row" style="gap:16px">
          <span class="chip ok">${fmt(data.total)} nomor valid</span>
          ${data.duplicates ? `<span class="chip muted">${fmt(data.duplicates)} ganda dibuang</span>` : ''}
          ${data.invalidCount ? `<span class="chip bad">${fmt(data.invalidCount)} tidak valid</span>` : ''}
        </div>
        <div class="muted" style="margin-top:10px">Kolom terbaca: ${data.columns.map((c) => `<code>[${esc(c)}]</code>`).join(' ')}</div>
        ${data.invalid.length ? `<div class="muted c-bad" style="margin-top:6px">Tidak valid: ${data.invalid.map(esc).join('; ')}</div>` : ''}
        ${data.samples.length ? '<div class="label" style="margin:14px 0 6px">Contoh pesan (variasi acak)</div>' : ''}
        ${data.samples.map((s) => `<div class="muted">+${esc(s.phone)}</div><div class="bubble">${esc(s.body)}</div>`).join('')}`;
    } catch (err) { ctx.toast(err.message); }
  });

  for (const btn of $$('[data-save]', el)) {
    btn.addEventListener('click', async () => {
      const start = btn.dataset.save === 'start';
      const p = payload(el);
      if (start && !(await confirmBox(`Mulai blast "${p.name}"?`, 'Pesan akan mulai dikirim sesuai pengaturan anti-banned.', { okText: 'Mulai' }))) return;
      try {
        await ctx.call('POST', '/admin/campaigns', { ...p, start });
        form.classList.add('hidden');
        ctx.toast(start ? 'Blast dimulai' : 'Draft disimpan');
        loadList(el, ctx);
      } catch (err) { ctx.toast(err.message); }
    });
  }
}

// ---- Daftar & detail ----------------------------------------------------------------------
async function loadList(el, ctx) {
  const res = await ctx.call('GET', '/admin/campaigns');
  defaults = res.defaults;
  if (!$('#blastForm', el).classList.contains('hidden')) renderDevices(el, ctx);
  const names = Object.fromEntries(ctx.state.devices.map((d) => [d.id, d.name]));
  $('#blastList', el).innerHTML = res.data.map((c) => {
    const k = c.counts;
    const pct = (n) => (k.total ? (n / k.total) * 100 : 0);
    const btns = [];
    if (c.status === 'draft') btns.push(`<button class="btn grad sm" data-bact="start">${icon('play')} Mulai</button>`);
    if (c.status === 'running') btns.push(`<button class="btn warn sm" data-bact="pause">${icon('pause')} Jeda</button>`);
    if (c.status === 'paused') btns.push(`<button class="btn grad sm" data-bact="resume">${icon('play')} Lanjutkan</button>`);
    if (['running', 'paused', 'draft'].includes(c.status)) btns.push('<button class="btn ghost sm" data-bact="cancel">Batalkan</button>');
    if (k.failed && c.status !== 'cancelled') btns.push(`<button class="btn soft sm" data-bact="retry-failed">${icon('refresh')} Ulangi ${k.failed} gagal</button>`);
    return `
      <div class="card" data-cid="${c.id}" style="margin-bottom:20px">
        <div class="row between">
          <div style="min-width:0">
            <h3 style="margin:0;font-size:16px;font-weight:600">${esc(c.name)}</h3>
            <div class="muted">${c.device_ids.map((id) => esc(names[id] || id)).join(', ')} · jeda ${c.delay_min_s}–${c.delay_max_s} dtk ·
              istirahat tiap ${c.batch_size} pesan · maks ${c.daily_limit}/hari · pukul ${c.hour_start}–${c.hour_end}</div>
          </div>
          ${chip(c.status)}
        </div>
        <div class="progress"><i class="p-ok" style="width:${pct(k.sent)}%"></i><i class="p-bad" style="width:${pct(k.failed)}%"></i><i class="p-info" style="width:${pct(k.sending)}%"></i></div>
        <div class="row between">
          <span class="muted">Terkirim <b class="c-ok">${fmt(k.sent)}</b> · Gagal <b class="c-bad">${fmt(k.failed)}</b> · Sisa <b>${fmt(k.pending + k.sending)}</b> dari ${fmt(k.total)}</span>
          <div class="row">${btns.join('')}
            <button class="btn ghost sm" data-bact="detail">Detail</button>
            ${c.status !== 'running' ? `<button class="btn bad-soft sm" data-bact="delete" title="Hapus">${icon('trash')}</button>` : ''}
          </div>
        </div>
      </div>`;
  }).join('') || `<div class="card empty">${icon('blast')}<div style="font-weight:600;color:var(--text)">Belum ada blast</div><div>Klik "Buat Blast" untuk mulai.</div></div>`;
  if (openId) await loadDetail(el, ctx);
}

async function loadDetail(el, ctx) {
  let c;
  try {
    c = (await ctx.call('GET', `/admin/campaigns/${openId}`)).data;
  } catch {
    openId = null;
    $('#blastDetail', el).classList.add('hidden');
    return;
  }
  const names = Object.fromEntries(ctx.state.devices.map((d) => [d.id, d.name]));
  const box = $('#blastDetail', el);
  box.classList.remove('hidden');
  $('#bdTitle', el).textContent = c.name;
  $('#bdTiming', el).innerHTML = c.status !== 'running' ? '' : c.device_ids.map((id) => {
    const t = c.timing[id];
    const wait = Math.max(0, (t.nextAt - Date.now()) / 1000);
    return `<span class="chip info">${esc(names[id] || id)}: hari ini ${t.sentToday}/${c.daily_limit}${wait > 0 ? ` · berikutnya ± ${fmtDur(wait)}` : ''}</span>`;
  }).join(' ');
  const f = $('#bdFilter', el).value;
  $('#bdBody', el).innerHTML = c.recipients
    .filter((r) => !f || r.status === f || (f === 'pending' && r.status === 'sending'))
    .map((r) => {
      const vars = JSON.parse(r.vars);
      const info = Object.entries(vars).filter(([k]) => !/^(no|nomor|wa|hp|telp|phone)/i.test(k)).map(([, v]) => v).join(' · ');
      return `<tr>
        <td class="muted">${r.id}</td><td style="white-space:nowrap">+${esc(r.phone)}</td><td class="muted">${esc(info)}</td>
        <td>${chip(r.status, STATUS[r.status])}${r.error ? `<div class="muted c-bad">${esc(r.error)}</div>` : ''}</td>
        <td class="muted">${esc(names[r.device_id] || '')}</td><td class="muted" style="white-space:nowrap">${localTime(r.sent_at)}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">Tidak ada data.</td></tr>';
}

function bindList(el, ctx) {
  $('#blastList', el).addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-bact]');
    if (!btn) return;
    const id = btn.closest('[data-cid]').dataset.cid;
    const act = btn.dataset.bact;
    try {
      if (act === 'detail') {
        openId = id;
        await loadDetail(el, ctx);
        $('#blastDetail', el).scrollIntoView({ behavior: 'smooth' });
        return;
      }
      if (act === 'delete') {
        if (!(await confirmBox('Hapus blast ini?', 'Riwayat penerima blast ini ikut terhapus.', { danger: true, okText: 'Hapus' }))) return;
        await ctx.call('DELETE', `/admin/campaigns/${id}`);
        if (openId === id) { openId = null; $('#blastDetail', el).classList.add('hidden'); }
      } else {
        if (act === 'cancel' && !(await confirmBox('Batalkan blast?', 'Penerima yang belum dikirimi tidak akan dikirimi.', { danger: true, okText: 'Batalkan blast' }))) return;
        if ((act === 'start' || act === 'resume') && !(await confirmBox('Mulai/lanjutkan blast ini?', '', { okText: 'Ya' }))) return;
        await ctx.call('POST', `/admin/campaigns/${id}/${act}`);
      }
      loadList(el, ctx);
    } catch (err) { ctx.toast(err.message); }
  });
  $('#bdFilter', el).addEventListener('change', () => loadDetail(el, ctx));
  $('#bdClose', el).addEventListener('click', () => { openId = null; $('#blastDetail', el).classList.add('hidden'); });
}

export default {
  async mount(el, ctx) {
    await ctx.loadDevices();
    el.innerHTML = `
      <div class="section-title">
        <h2>Daftar Blast</h2>
        <button class="btn grad" id="newBlast">${icon('plus')} Buat Blast</button>
      </div>
      ${FORM}
      <div id="blastList"></div>
      <div id="blastDetail" class="card hidden">
        <div class="card-head">
          <div><h3 id="bdTitle"></h3><p>Status per penerima</p></div>
          <div class="row">
            <select id="bdFilter" style="width:auto">
              <option value="">Semua</option><option value="pending">Antrean</option><option value="sent">Terkirim</option><option value="failed">Gagal</option>
            </select>
            <button class="btn ghost sm" id="bdClose">${icon('x')} Tutup</button>
          </div>
        </div>
        <div id="bdTiming" class="row" style="margin-bottom:12px"></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Nomor</th><th>Data</th><th>Status</th><th>Device</th><th>Waktu</th></tr></thead>
            <tbody id="bdBody"></tbody>
          </table>
        </div>
      </div>`;
    bindForm(el, ctx);
    bindList(el, ctx);
    await loadList(el, ctx);
  },
  async refresh(el, ctx) {
    if (document.querySelector('.modal-bg')) return;
    await loadList(el, ctx);
  },
  unmount() {
    openId = null;
  },
};
