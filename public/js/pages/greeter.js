import { $, chip, confirmBox, esc, fmt, icon, timeAgo } from '../ui.js';

const st = { device: '', groups: [], open: null, defaults: null, offline: false };
const waFormat = (s) => esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>').replace(/@(Budi|Siti)/g, '<b style="color:#027eb5">@$1</b>');

function groupRow(g) {
  const gr = g.greeter;
  const warn = g.announce && g.meAdmin === false;
  return `
    <div class="list-row ${st.open === g.id ? 'tree-row on' : ''}" data-gid="${esc(g.id)}" style="grid-template-columns:46px minmax(0,1fr) auto;cursor:pointer;padding-left:6px;padding-right:6px">
      <span class="circle ${gr?.active ? 'c-ok' : 'c-info'}">${icon('users')}</span>
      <div style="min-width:0">
        <b>${esc(g.subject || g.id)}</b>
        <small>${g.size != null ? `${fmt(g.size)} anggota` : ''}${g.meAdmin ? ' · nomor sekolah admin' : ''}${gr ? ` · disapa ${fmt(gr.greeted)} orang${gr.last_at ? `, terakhir ${timeAgo(gr.last_at)}` : ''}` : ''}</small>
        ${warn ? '<small class="c-warn" style="white-space:normal">⚠️ Hanya admin yang boleh kirim pesan di grup ini, sedangkan nomor sekolah bukan admin.</small>' : ''}
      </div>
      ${gr ? (gr.active ? chip('ok', 'Aktif') : chip('muted', 'Nonaktif')) : chip('muted', 'Belum diatur')}
    </div>`;
}

function editorHtml(g) {
  const gr = g.greeter;
  const d = st.defaults;
  return `
    <div class="card-head">
      <div><h3>${esc(g.subject || 'Grup')}</h3><p>${g.size != null ? `${fmt(g.size)} anggota` : ''}</p></div>
      ${gr ? `<label class="switch" title="Aktif/nonaktif"><input type="checkbox" id="grActive" ${gr.active ? 'checked' : ''} aria-label="Aktif"><i></i></label>` : ''}
    </div>
    ${g.announce && g.meAdmin === false ? '<div class="wa-banner" style="border-radius:12px;margin-bottom:14px">⚠️ Grup ini hanya mengizinkan admin mengirim pesan. Jadikan nomor sekolah <b>admin grup</b> supaya sapaan bisa terkirim.</div>' : ''}
    <label class="field"><span>Pesan sambutan</span>
      <textarea id="grWelcome" style="min-height:110px">${esc(gr?.welcome_text ?? d.welcome)}</textarea>
      <span class="hint"><b>[Nama]</b> = @mention anggota baru (beberapa orang sekaligus digabung), <b>[Grup]</b> nama grup, <b>[Jumlah]</b> jumlah anggota, <b>{a|b}</b> variasi.</span>
    </label>
    <div class="label" style="margin-bottom:4px">Pratinjau</div>
    <div id="grPreview" class="bubble"></div>

    <label class="row" style="flex-wrap:nowrap;cursor:pointer;font-weight:600;margin:14px 0 8px">
      <input type="checkbox" id="grBye" ${gr?.goodbye_active ? 'checked' : ''}> Kirim pesan pamit saat anggota keluar
    </label>
    <label class="field ${gr?.goodbye_active ? '' : 'hidden'}" id="grByeBox"><textarea id="grByeText" style="min-height:60px">${esc(gr?.goodbye_text || d.goodbye)}</textarea></label>

    <label class="row" style="flex-wrap:nowrap;cursor:pointer;font-weight:600;margin:6px 0 8px">
      <input type="checkbox" id="grDm" ${gr?.dm_active ? 'checked' : ''}> Kirim juga pesan pribadi ke anggota baru
    </label>
    <div class="${gr?.dm_active ? '' : 'hidden'}" id="grDmBox">
      <label class="field"><textarea id="grDmText" style="min-height:70px">${esc(gr?.dm_text || d.dm)}</textarea>
        <span class="hint">Mis. aturan grup atau link formulir. Pesan pribadi dihitung sebagai pesan yang kita mulai (ikut kuota anti-banned).</span></label>
    </div>

    <label class="field"><span>Gabungkan anggota yang masuk dalam waktu (detik)</span>
      <input type="number" id="grBatch" min="5" max="600" value="${gr?.batch_seconds ?? 60}" style="max-width:140px">
      <span class="hint">Kalau banyak orang masuk berdekatan, mereka disapa dalam satu pesan (maks. 20 mention per pesan), bukan satu per satu.</span>
    </label>
    <div class="row between">
      ${gr ? `<button class="btn bad-soft sm" id="grDelete">${icon('trash')} Hapus pengaturan</button>` : '<span></span>'}
      <button class="btn grad" id="grSave">${icon('check')} ${gr ? 'Simpan' : 'Aktifkan sapaan'}</button>
    </div>`;
}

let pvTimer;
function preview(el, ctx) {
  clearTimeout(pvTimer);
  pvTimer = setTimeout(async () => {
    const g = st.groups.find((x) => x.id === st.open);
    if (!g || !$('#grWelcome', el)) return;
    try {
      const { data } = await ctx.call('POST', '/admin/greeter/preview', { template: $('#grWelcome', el).value, group: g.subject, many: true });
      $('#grPreview', el).innerHTML = waFormat(data.text);
    } catch { /* abaikan */ }
  }, 250);
}

async function loadGroups(el, ctx) {
  if (!st.device) { $('#grList', el).innerHTML = '<div class="muted">Belum ada device.</div>'; return; }
  $('#grList', el).innerHTML = '<div class="muted">Memuat daftar grup dari WhatsApp…</div>';
  try {
    const res = await ctx.call('GET', `/admin/greeter/groups?device=${encodeURIComponent(st.device)}`);
    st.groups = res.data;
    st.offline = res.offline;
  } catch (err) {
    $('#grList', el).innerHTML = `<div class="muted c-bad">${esc(err.message)}</div>`;
    return;
  }
  renderList(el);
}

function renderList(el) {
  const q = ($('#grQ', el)?.value ?? '').trim().toLowerCase();
  const list = st.groups.filter((g) => !q || (g.subject ?? '').toLowerCase().includes(q));
  $('#grInfo', el).innerHTML = st.offline
    ? '<span class="c-warn">Device sedang offline, hanya grup yang sudah diatur yang ditampilkan.</span>'
    : `${fmt(st.groups.length)} grup · ${fmt(st.groups.filter((g) => g.greeter?.active).length)} dengan sapaan aktif`;
  $('#grList', el).innerHTML = list.map(groupRow).join('') || `<div class="empty">${icon('users')}<div>${st.groups.length ? 'Tidak ada grup yang cocok.' : 'Nomor ini belum menjadi anggota grup mana pun.'}</div></div>`;
}

function openEditor(el, ctx, id) {
  st.open = id;
  renderList(el);
  const g = st.groups.find((x) => x.id === id);
  const box = $('#grEditor', el);
  box.classList.remove('hidden');
  box.innerHTML = editorHtml(g);
  preview(el, ctx);
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function loadLog(el, ctx) {
  const res = await ctx.call('GET', '/admin/greeter/log');
  st.defaults = res.defaults;
  const label = { welcome: 'Sambutan', goodbye: 'Pamit', dm: 'Pesan pribadi' };
  $('#grLog', el).innerHTML = res.data.length ? res.data.map((l) => `
    <div class="list-row" style="grid-template-columns:minmax(0,1fr) auto">
      <div style="min-width:0"><b>${esc(l.group_name || 'Grup')}</b><small>${esc(label[l.action] ?? l.action)}${l.count > 1 ? ` · ${l.count} orang` : ''} · ${timeAgo(l.at)}</small>
        <small style="white-space:normal">${esc(l.body.slice(0, 140))}</small></div>
    </div>`).join('') : '<div class="muted">Belum ada sapaan terkirim.</div>';
}

export default {
  async mount(el, ctx) {
    const devs = await ctx.loadDevices();
    st.device = st.device && devs.some((d) => d.id === st.device) ? st.device : (devs.find((d) => d.status === 'connected') ?? devs[0])?.id ?? '';
    el.innerHTML = `
    <div class="grid g-dash">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h3>Grup WhatsApp</h3><p id="grInfo"></p></div>
            <button class="btn ghost sm" id="grReload" title="Muat ulang">${icon('refresh')}</button></div>
          <div class="toolbar">
            <select id="grDevice" style="width:auto" aria-label="Device">${devs.map((d) => `<option value="${d.id}">${esc(d.name)}${d.status === 'connected' ? '' : ' (offline)'}</option>`).join('')}</select>
            <div class="search">${icon('search')}<input id="grQ" placeholder="Cari nama grup" aria-label="Cari grup"></div>
          </div>
          <div id="grList"></div>
        </div>
      </div>
      <div class="stack">
        <div class="card hidden" id="grEditor"></div>
        <div class="card">
          <div class="card-head"><div><h3>Cara kerja</h3></div></div>
          <ul class="muted" style="margin:0;padding-left:18px;line-height:1.8">
            <li>Nomor sekolah harus menjadi <b>anggota</b> grup. Kalau grup hanya mengizinkan admin mengirim pesan, jadikan nomor sekolah <b>admin</b>.</li>
            <li>Anggota baru disebut dengan <b>@mention</b>. Beberapa orang yang masuk berdekatan disapa dalam satu pesan.</li>
            <li>Masuknya nomor sekolah sendiri ke grup tidak disapa.</li>
            <li>Server harus menyala saat anggota masuk; yang masuk saat server mati tidak disapa.</li>
          </ul>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Riwayat Sapaan</h3><p>50 terakhir</p></div></div>
          <div id="grLog"></div>
        </div>
      </div>
    </div>`;
    if (st.device) $('#grDevice', el).value = st.device;

    $('#grDevice', el).addEventListener('change', (e) => { st.device = e.target.value; st.open = null; $('#grEditor', el).classList.add('hidden'); loadGroups(el, ctx); });
    $('#grReload', el).addEventListener('click', () => loadGroups(el, ctx));
    $('#grQ', el).addEventListener('input', () => renderList(el));
    $('#grList', el).addEventListener('click', (e) => {
      const r = e.target.closest('[data-gid]');
      if (r) openEditor(el, ctx, r.dataset.gid);
    });
    const ed = $('#grEditor', el);
    ed.addEventListener('input', (e) => { if (e.target.id === 'grWelcome') preview(el, ctx); });
    ed.addEventListener('change', async (e) => {
      if (e.target.id === 'grBye') $('#grByeBox', el).classList.toggle('hidden', !e.target.checked);
      if (e.target.id === 'grDm') $('#grDmBox', el).classList.toggle('hidden', !e.target.checked);
      if (e.target.id === 'grActive') {
        const g = st.groups.find((x) => x.id === st.open);
        await ctx.call('PATCH', `/admin/greeter/${g.greeter.id}/active`, { active: e.target.checked });
        g.greeter.active = e.target.checked;
        renderList(el);
        ctx.toast(e.target.checked ? 'Sapaan aktif' : 'Sapaan dinonaktifkan');
      }
    });
    ed.addEventListener('click', async (e) => {
      const g = st.groups.find((x) => x.id === st.open);
      try {
        if (e.target.closest('#grSave')) {
          const { data } = await ctx.call('PUT', '/admin/greeter', {
            device: st.device, groupJid: g.id, groupName: g.subject,
            active: g.greeter ? g.greeter.active : true,
            welcome_text: $('#grWelcome', el).value,
            goodbye_active: $('#grBye', el).checked, goodbye_text: $('#grByeText', el).value,
            dm_active: $('#grDm', el).checked, dm_text: $('#grDmText', el).value,
            batch_seconds: Number($('#grBatch', el).value),
          });
          g.greeter = data;
          ctx.toast('Sapaan grup disimpan');
          openEditor(el, ctx, g.id);
        }
        if (e.target.closest('#grDelete')) {
          if (!(await confirmBox('Hapus pengaturan sapaan grup ini?', '', { danger: true, okText: 'Hapus' }))) return;
          await ctx.call('DELETE', `/admin/greeter/${g.greeter.id}`);
          g.greeter = null;
          openEditor(el, ctx, g.id);
        }
      } catch (err) { ctx.toast(err.message); }
    });

    await loadLog(el, ctx);
    await loadGroups(el, ctx);
  },
  async refresh(el, ctx) {
    if (document.querySelector('.modal-bg')) return;
    await loadLog(el, ctx);
  },
  unmount() { st.open = null; },
};
