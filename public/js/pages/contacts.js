import { $, $$, confirmBox, esc, fmt, icon, promptBox } from '../ui.js';

const PAGE = 50;
const COLORS = ['#1ea5e3', '#ac39d4', '#3fd1a6', '#4b26e8', '#ff9f1c', '#ff5b5b', '#2bc155', '#e83e8c'];

const st = {
  group: '', // '' = semua, 'none' = tanpa grup, atau id grup
  q: '',
  offset: 0,
  selected: new Set(),
  groups: [],
  total: 0,
  ungrouped: 0,
  rows: [],
  fieldNames: [],
};

const groupById = (id) => st.groups.find((g) => g.id === Number(id));
const localPhone = (p) => (p.startsWith('62') ? '0' + p.slice(2) : '+' + p);

// ---- Grup -------------------------------------------------------------------------
async function loadGroups(el, ctx) {
  const res = await ctx.call('GET', '/admin/contacts/groups');
  st.groups = res.data;
  st.total = res.total;
  st.ungrouped = res.ungrouped;
  renderGroups(el);
}

function renderGroups(el) {
  const item = (key, label, n, color, tools = false) => `
    <div class="group-item ${String(st.group) === String(key) ? 'on' : ''}" data-group="${key}">
      ${color ? `<span class="dot-c" style="background:${esc(color)}"></span>` : icon(key === '' ? 'users' : 'x')}
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</span>
      ${tools ? `<span class="gtools" style="margin-left:auto">
        <button data-gact="edit" title="Ubah grup">${icon('edit')}</button>
        <button data-gact="delete" title="Hapus grup">${icon('trash')}</button></span>` : ''}
      <span class="n">${fmt(n)}</span>
    </div>`;
  $('#groupList', el).innerHTML =
    item('', 'Semua kontak', st.total) +
    item('none', 'Tanpa grup', st.ungrouped) +
    (st.groups.length ? '<div class="nav-group" style="padding:14px 12px 6px">Grup</div>' : '') +
    st.groups.map((g) => item(g.id, g.name, g.members, g.color, true)).join('') +
    (st.groups.length ? '' : '<div class="muted" style="padding:12px">Belum ada grup. Buat grup seperti "Wali 9A" atau "Alumni 2025".</div>');
}

async function groupDialog(ctx, g = null) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const color = g?.color ?? COLORS[st.groups.length % COLORS.length];
    bg.innerHTML = `
      <form class="modal">
        <h3>${g ? 'Ubah grup' : 'Grup baru'}</h3>
        <label class="field"><span>Nama grup</span><input name="name" value="${esc(g?.name ?? '')}" placeholder="mis. Wali Murid 9A" required></label>
        <label class="field"><span>Keterangan <span class="hint">— opsional</span></span><input name="description" value="${esc(g?.description ?? '')}"></label>
        <div class="field"><span>Warna</span><div class="row">${COLORS.map((c) => `
          <label style="cursor:pointer"><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''} style="display:none">
          <span class="dot-c" style="background:${c};width:26px;height:26px;display:block;outline-offset:2px"></span></label>`).join('')}</div></div>
        <div class="row"><button type="button" class="btn ghost" data-x>Batal</button><button class="btn grad">Simpan</button></div>
      </form>`;
    const paint = () => $$('input[name=color]', bg).forEach((i) => (i.nextElementSibling.style.outline = i.checked ? '3px solid var(--text)' : 'none'));
    paint();
    bg.addEventListener('change', paint);
    const close = () => { bg.remove(); resolve(null); };
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-x]')) close(); });
    $('form', bg).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = { name: f.name.value, description: f.description.value, color: f.color.value };
      try {
        const r = g ? await ctx.call('PATCH', `/admin/contacts/groups/${g.id}`, body) : await ctx.call('POST', '/admin/contacts/groups', body);
        bg.remove();
        resolve(r.data);
      } catch (err) { ctx.toast(err.message); }
    });
    document.body.append(bg);
    $('input[name=name]', bg).focus();
  });
}

// ---- Kontak ----------------------------------------------------------------------
async function loadContacts(el, ctx) {
  const p = new URLSearchParams({ limit: PAGE, offset: st.offset });
  if (st.q) p.set('q', st.q);
  if (st.group) p.set('group', st.group);
  const res = await ctx.call('GET', `/admin/contacts?${p}`);
  st.rows = res.data;
  st.resultTotal = res.total;
  renderContacts(el);
}

function renderContacts(el) {
  const g = groupById(st.group);
  $('#listTitle', el).textContent = st.group === 'none' ? 'Tanpa grup' : g ? g.name : 'Semua kontak';
  $('#listSub', el).textContent = g?.description || `${fmt(st.resultTotal)} kontak${st.q ? ` cocok dengan "${st.q}"` : ''}`;
  $('#exportBtn', el).href = `/admin/contacts/export.csv${st.group ? `?group=${st.group}` : ''}`;

  const allChecked = st.rows.length && st.rows.every((r) => st.selected.has(r.id));
  $('#contactHead', el).innerHTML = `<tr>
    <th class="cb"><input type="checkbox" id="checkAll" ${allChecked ? 'checked' : ''} aria-label="Pilih semua"></th>
    <th>Nama</th><th>Nomor</th><th>Data</th><th>Grup</th><th></th></tr>`;
  $('#contactBody', el).innerHTML = st.rows.map((c) => `
    <tr data-cid="${c.id}">
      <td class="cb"><input type="checkbox" data-sel="${c.id}" ${st.selected.has(c.id) ? 'checked' : ''} aria-label="Pilih ${esc(c.name)}"></td>
      <td><b style="font-weight:600">${esc(c.name || '—')}</b></td>
      <td style="white-space:nowrap">${esc(localPhone(c.phone))}</td>
      <td>${Object.entries(c.fields).map(([k, v]) => `<span class="fchip">${esc(k)}: <b>${esc(v)}</b></span>`).join('')}</td>
      <td>${c.groupIds.map((id) => groupById(id)).filter(Boolean).map((x) => `<span class="gchip"><span class="dot-c" style="background:${esc(x.color)};width:7px;height:7px"></span>${esc(x.name)}</span>`).join('')}</td>
      <td style="white-space:nowrap;text-align:right">
        <button class="btn ghost sm" data-cact="edit" title="Ubah">${icon('edit')}</button>
        <button class="btn bad-soft sm" data-cact="delete" title="Hapus">${icon('trash')}</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="6"><div class="empty">${icon('users')}
      <div style="font-weight:600;color:var(--text)">${st.q ? 'Tidak ada yang cocok' : 'Belum ada kontak di sini'}</div>
      <div>${st.q ? 'Coba kata kunci lain.' : 'Tambah satu per satu, atau Import dari Google Sheets/Excel.'}</div></div></td></tr>`;

  const from = st.resultTotal ? st.offset + 1 : 0;
  const to = Math.min(st.offset + PAGE, st.resultTotal);
  $('#pager', el).innerHTML = `
    <span class="muted">${fmt(from)}–${fmt(to)} dari ${fmt(st.resultTotal)}</span>
    <div class="row">
      <button class="btn ghost sm" data-page="-1" ${st.offset ? '' : 'disabled'}>‹ Sebelumnya</button>
      <button class="btn ghost sm" data-page="1" ${to < st.resultTotal ? '' : 'disabled'}>Berikutnya ›</button>
    </div>`;
  renderBulk(el);
}

function renderBulk(el) {
  const n = st.selected.size;
  const bar = $('#bulkbar', el);
  bar.classList.toggle('hidden', !n);
  if (!n) return;
  const g = groupById(st.group);
  bar.innerHTML = `
    <span>${fmt(n)} kontak dipilih</span>
    <select id="bulkGroup" aria-label="Pilih grup">
      <option value="">Tambah ke grup…</option>
      ${st.groups.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}
      <option value="new">+ Grup baru…</option>
    </select>
    ${g ? `<button class="btn ghost sm" data-bulk="removeFromGroup">Keluarkan dari "${esc(g.name)}"</button>` : ''}
    <button class="btn bad-soft sm" data-bulk="delete">${icon('trash')} Hapus</button>
    <button class="btn ghost sm" data-bulk="clear" style="margin-left:auto">Batal pilih</button>`;
}

function contactDialog(ctx, c = null) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const fields = Object.entries(c?.fields ?? {});
    if (!fields.length) fields.push(['', '']);
    const preselect = new Set(c?.groupIds ?? (groupById(st.group) ? [Number(st.group)] : []));
    const row = ([k, v]) => `<div class="kv-row">
      <input placeholder="Kolom, mis. Kelas" list="fieldNames" value="${esc(k)}" data-k>
      <input placeholder="Isi, mis. 9A" value="${esc(v)}" data-v>
      <button type="button" class="btn ghost sm" data-rm title="Hapus kolom">${icon('x')}</button></div>`;
    bg.innerHTML = `
      <form class="modal wide">
        <h3>${c ? 'Ubah kontak' : 'Kontak baru'}</h3>
        <div class="grid g-2" style="gap:12px">
          <label class="field"><span>Nama</span><input name="name" value="${esc(c?.name ?? '')}" placeholder="Nama lengkap"></label>
          <label class="field"><span>Nomor WhatsApp</span><input name="phone" value="${esc(c ? localPhone(c.phone) : '')}" placeholder="0812xxxxxxxx" required></label>
        </div>
        <div class="field"><span>Data tambahan <span class="hint">— dipakai di pesan sebagai [Nama Kolom]</span></span>
          <div id="kvRows">${fields.map(row).join('')}</div>
          <datalist id="fieldNames">${st.fieldNames.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
          <button type="button" class="btn soft sm" id="addField" style="justify-self:start">${icon('plus')} Tambah kolom</button>
        </div>
        <div class="field"><span>Grup</span>
          <div class="row">${st.groups.map((g) => `
            <label class="check"><input type="checkbox" value="${g.id}" ${preselect.has(g.id) ? 'checked' : ''}>
            <span class="dot-c" style="background:${esc(g.color)}"></span>${esc(g.name)}</label>`).join('') || '<span class="muted">Belum ada grup.</span>'}</div>
        </div>
        <div class="row"><button type="button" class="btn ghost" data-x>Batal</button><button class="btn grad">Simpan</button></div>
      </form>`;
    const close = () => { bg.remove(); resolve(false); };
    bg.addEventListener('click', (e) => {
      if (e.target === bg || e.target.closest('[data-x]')) return close();
      if (e.target.closest('[data-rm]')) e.target.closest('.kv-row').remove();
      if (e.target.closest('#addField')) $('#kvRows', bg).insertAdjacentHTML('beforeend', row(['', '']));
    });
    $('form', bg).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const fieldsObj = {};
      for (const r of $$('.kv-row', bg)) {
        const k = $('[data-k]', r).value.trim();
        if (k) fieldsObj[k] = $('[data-v]', r).value.trim();
      }
      const body = {
        name: f.name.value,
        phone: f.phone.value,
        fields: fieldsObj,
        groupIds: $$('.check input:checked', bg).map((i) => Number(i.value)),
      };
      try {
        if (c) await ctx.call('PATCH', `/admin/contacts/${c.id}`, body);
        else await ctx.call('POST', '/admin/contacts', body);
        bg.remove();
        resolve(true);
      } catch (err) { ctx.toast(err.message); }
    });
    document.body.append(bg);
    $('input[name=name]', bg).focus();
  });
}

// ---- Import ---------------------------------------------------------------------
function renderImport(el) {
  const box = $('#importBox', el);
  box.innerHTML = `
    <div class="card-head">
      <div><h3>Import kontak</h3><p>Copy-paste dari Google Sheets / Excel. Baris pertama = judul kolom (mis. Nama, No WA, Kelas).</p></div>
      <button class="btn ghost sm" data-imp="close">${icon('x')} Tutup</button>
    </div>
    <textarea id="impText" class="mono" style="min-height:180px" placeholder="Nama&#9;No WA&#9;Kelas&#10;Budi Santoso&#9;081234567890&#9;9A&#10;Siti Aminah&#9;0813-1111-2222&#9;9B"></textarea>
    <div class="grid g-2" style="gap:16px;margin-top:14px">
      <label class="field"><span>Masukkan ke grup</span>
        <select id="impGroup">
          <option value="">Tidak dimasukkan ke grup</option>
          ${st.groups.map((g) => `<option value="${g.id}" ${String(g.id) === String(st.group) ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
          <option value="new">+ Grup baru…</option>
        </select>
        <input id="impNewGroup" class="hidden" placeholder="Nama grup baru" style="margin-top:6px">
      </label>
      <div class="field"><span>Kalau nomor sudah ada</span>
        <div><label class="radio"><input type="radio" name="impMode" value="update" checked> Perbarui data</label>
        <label class="radio"><input type="radio" name="impMode" value="skip"> Lewati</label></div>
      </div>
    </div>
    <div id="impPreview" class="preview hidden"></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px">
      <button class="btn soft" data-imp="preview">${icon('check')} Pratinjau</button>
      <button class="btn grad" data-imp="run">${icon('down')} Import</button>
    </div>`;
  $('#impGroup', box).addEventListener('change', (e) => $('#impNewGroup', box).classList.toggle('hidden', e.target.value !== 'new'));
}

function importBody(el) {
  const g = $('#impGroup', el).value;
  return {
    text: $('#impText', el).value,
    groupId: g && g !== 'new' ? Number(g) : null,
    newGroup: g === 'new' ? $('#impNewGroup', el).value : '',
    mode: $('input[name=impMode]:checked', el).value,
  };
}

async function onImport(e, el, ctx) {
  const act = e.target.closest('[data-imp]')?.dataset.imp;
  if (!act) return;
  if (act === 'close') return $('#importBox', el).classList.add('hidden');
  try {
    if (act === 'preview') {
      const { data: d } = await ctx.call('POST', '/admin/contacts/import/preview', { text: $('#impText', el).value });
      const p = $('#impPreview', el);
      p.classList.remove('hidden');
      const cols = [...new Set(d.sample.flatMap((s) => Object.keys(s.fields)))];
      p.innerHTML = `
        <div class="row">
          <span class="chip ok">${fmt(d.total)} nomor valid</span>
          ${d.existing ? `<span class="chip info">${fmt(d.existing)} sudah ada</span>` : ''}
          ${d.duplicates ? `<span class="chip muted">${fmt(d.duplicates)} ganda dibuang</span>` : ''}
          ${d.invalidCount ? `<span class="chip bad">${fmt(d.invalidCount)} tidak valid</span>` : ''}
        </div>
        <div class="muted" style="margin:10px 0">Kolom nomor: <code>${esc(d.phoneColumn ?? '-')}</code> · kolom nama: <code>${esc(d.nameColumn ?? 'tidak ada')}</code>
          ${cols.length ? ` · data tambahan: ${cols.map((c) => `<code>${esc(c)}</code>`).join(' ')}` : ''}</div>
        ${d.invalid.length ? `<div class="muted c-bad" style="margin-bottom:10px">Tidak valid: ${d.invalid.map(esc).join('; ')}</div>` : ''}
        ${d.sample.length ? `<div class="table-wrap"><table><tr><th>Nama</th><th>Nomor</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>
          ${d.sample.map((s) => `<tr><td>${esc(s.name || '—')}</td><td>${esc(localPhone(s.phone))}</td>${cols.map((c) => `<td>${esc(s.fields[c] ?? '')}</td>`).join('')}</tr>`).join('')}
        </table></div><div class="muted">Menampilkan ${d.sample.length} baris pertama.</div>` : ''}`;
    }
    if (act === 'run') {
      const body = importBody(el);
      if (body.newGroup === '' && $('#impGroup', el).value === 'new') return ctx.toast('Isi nama grup baru');
      const { data: r } = await ctx.call('POST', '/admin/contacts/import', body);
      ctx.toast(`Import selesai: ${r.created} baru, ${r.updated} diperbarui, ${r.skipped} dilewati${r.invalid ? `, ${r.invalid} tidak valid` : ''}`);
      $('#importBox', el).classList.add('hidden');
      if (r.groupId) st.group = String(r.groupId);
      st.offset = 0;
      await refreshAll(el, ctx);
    }
  } catch (err) { ctx.toast(err.message); }
}

// ---- Event ------------------------------------------------------------------------
async function refreshAll(el, ctx) {
  st.fieldNames = (await ctx.call('GET', '/admin/contacts/fields')).data;
  await loadGroups(el, ctx);
  await loadContacts(el, ctx);
}

function bind(el, ctx) {
  $('#groupList', el).addEventListener('click', async (e) => {
    const it = e.target.closest('[data-group]');
    if (!it) return;
    const gact = e.target.closest('[data-gact]')?.dataset.gact;
    const g = groupById(it.dataset.group);
    if (gact === 'edit') {
      if (await groupDialog(ctx, g)) await refreshAll(el, ctx);
      return;
    }
    if (gact === 'delete') {
      if (!(await confirmBox(`Hapus grup "${g.name}"?`, 'Kontaknya tidak ikut terhapus, hanya dikeluarkan dari grup ini.', { danger: true, okText: 'Hapus grup' }))) return;
      await ctx.call('DELETE', `/admin/contacts/groups/${g.id}`);
      st.group = '';
      st.selected.clear();
      return refreshAll(el, ctx);
    }
    st.group = it.dataset.group;
    st.offset = 0;
    st.selected.clear();
    renderGroups(el);
    loadContacts(el, ctx);
  });

  $('#newGroupBtn', el).addEventListener('click', async () => {
    const g = await groupDialog(ctx);
    if (g) { st.group = String(g.id); st.offset = 0; await refreshAll(el, ctx); }
  });

  let t;
  $('#search', el).addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { st.q = e.target.value.trim(); st.offset = 0; loadContacts(el, ctx); }, 250);
  });

  $('#addContact', el).addEventListener('click', async () => {
    if (await contactDialog(ctx)) { ctx.toast('Kontak disimpan'); await refreshAll(el, ctx); }
  });

  $('#importBtn', el).addEventListener('click', () => {
    renderImport(el);
    $('#importBox', el).classList.remove('hidden');
    $('#impText', el).focus();
  });
  $('#importBox', el).addEventListener('click', (e) => onImport(e, el, ctx));

  $('#contactTable', el).addEventListener('change', (e) => {
    if (e.target.id === 'checkAll') {
      for (const r of st.rows) e.target.checked ? st.selected.add(r.id) : st.selected.delete(r.id);
      return renderContacts(el);
    }
    const id = Number(e.target.dataset.sel);
    if (!id) return;
    e.target.checked ? st.selected.add(id) : st.selected.delete(id);
    renderBulk(el);
    $('#checkAll', el).checked = st.rows.every((r) => st.selected.has(r.id));
  });

  $('#contactTable', el).addEventListener('click', async (e) => {
    const act = e.target.closest('[data-cact]')?.dataset.cact;
    if (!act) return;
    const c = st.rows.find((r) => r.id === Number(e.target.closest('[data-cid]').dataset.cid));
    if (act === 'edit') {
      if (await contactDialog(ctx, c)) { ctx.toast('Kontak diperbarui'); await refreshAll(el, ctx); }
    } else if (act === 'delete') {
      if (!(await confirmBox(`Hapus ${c.name || 'kontak ini'}?`, '', { danger: true, okText: 'Hapus' }))) return;
      await ctx.call('DELETE', `/admin/contacts/${c.id}`);
      st.selected.delete(c.id);
      await refreshAll(el, ctx);
    }
  });

  $('#pager', el).addEventListener('click', (e) => {
    const d = Number(e.target.closest('[data-page]')?.dataset.page);
    if (!d) return;
    st.offset = Math.max(0, st.offset + d * PAGE);
    loadContacts(el, ctx);
  });

  const bar = $('#bulkbar', el);
  bar.addEventListener('change', async (e) => {
    if (e.target.id !== 'bulkGroup' || !e.target.value) return;
    let groupId = e.target.value;
    try {
      if (groupId === 'new') {
        const name = await promptBox('Grup baru', '', 'Kontak yang dipilih akan dimasukkan ke grup ini.');
        if (!name) { e.target.value = ''; return; }
        groupId = (await ctx.call('POST', '/admin/contacts/groups', { name })).data.id;
      }
      await ctx.call('POST', '/admin/contacts/bulk', { ids: [...st.selected], action: 'addToGroup', groupId: Number(groupId) });
      ctx.toast(`${st.selected.size} kontak dimasukkan ke grup`);
      st.selected.clear();
      await refreshAll(el, ctx);
    } catch (err) { ctx.toast(err.message); }
  });
  bar.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-bulk]')?.dataset.bulk;
    if (!act) return;
    if (act === 'clear') { st.selected.clear(); return renderContacts(el); }
    const n = st.selected.size;
    try {
      if (act === 'delete') {
        if (!(await confirmBox(`Hapus ${n} kontak?`, 'Kontak dihapus permanen dari semua grup.', { danger: true, okText: 'Hapus' }))) return;
        await ctx.call('POST', '/admin/contacts/bulk', { ids: [...st.selected], action: 'delete' });
      } else if (act === 'removeFromGroup') {
        await ctx.call('POST', '/admin/contacts/bulk', { ids: [...st.selected], action: 'removeFromGroup', groupId: Number(st.group) });
      }
      ctx.toast(`${n} kontak diproses`);
      st.selected.clear();
      await refreshAll(el, ctx);
    } catch (err) { ctx.toast(err.message); }
  });
}

export default {
  async mount(el, ctx) {
    el.innerHTML = `
    <div class="grid g-contacts">
      <div class="card">
        <div class="card-head" style="margin-bottom:10px">
          <div><h3>Grup Kontak</h3></div>
          <button class="btn soft sm" id="newGroupBtn">${icon('plus')} Grup</button>
        </div>
        <div id="groupList"></div>
      </div>

      <div class="stack">
        <div id="importBox" class="card hidden"></div>
        <div class="card">
          <div class="card-head">
            <div><h3 id="listTitle">Semua kontak</h3><p id="listSub"></p></div>
          </div>
          <div class="toolbar">
            <div class="search">${icon('search')}<input id="search" placeholder="Cari nama, nomor, atau data (mis. 9A)" aria-label="Cari kontak"></div>
            <button class="btn grad" id="addContact">${icon('plus')} Kontak</button>
            <button class="btn soft" id="importBtn">${icon('down')} Import</button>
            <a class="btn ghost" id="exportBtn" href="/admin/contacts/export.csv" download>${icon('up')} Export CSV</a>
          </div>
          <div id="bulkbar" class="bulkbar hidden"></div>
          <div class="table-wrap">
            <table id="contactTable"><thead id="contactHead"></thead><tbody id="contactBody"></tbody></table>
          </div>
          <div id="pager" class="pager"></div>
        </div>
      </div>
    </div>`;
    $('#search', el).value = st.q;
    bind(el, ctx);
    await refreshAll(el, ctx);
  },
  unmount() {
    st.selected.clear();
  },
};
