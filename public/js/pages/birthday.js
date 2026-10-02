import { $, $$, chip, confirmBox, esc, fmt, icon, localTime } from '../ui.js';

const localPhone = (p) => (p?.startsWith('62') ? '0' + p.slice(2) : p ? '+' + p : '');
const fmtDate = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'long' });
const MSG_STATUS = { sent: ['ok', 'Terkirim'], pending: ['warn', 'Antrean'], failed: ['bad', 'Gagal'] };

let settings = null;
let dirty = false;

function settingsCard(ctx, fields, groups) {
  const s = settings;
  return `
  <div class="card">
    <div class="card-head">
      <div><h3>Pengaturan</h3><p>Ucapan dikirim sekali per orang per tahun</p></div>
      <label class="switch" title="Kirim otomatis setiap hari">
        <input type="checkbox" id="bAuto" ${s.auto ? 'checked' : ''} aria-label="Kirim otomatis"><i></i>
      </label>
    </div>
    <div class="est" id="autoInfo" style="margin:0 0 16px"></div>
    <div class="grid g-2" style="gap:14px">
      <label class="field"><span>Jam kirim</span><input type="time" id="bTime" value="${esc(s.time)}"></label>
      <label class="field"><span>Kolom tanggal lahir</span>
        <select id="bField">
          <option value="">Otomatis${s.detectedField ? ` (${esc(s.detectedField)})` : ''}</option>
          ${fields.map((f) => `<option ${f === s.field ? 'selected' : ''}>${esc(f)}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="field"><span>Kirim dari device <span class="hint">— lebih dari satu = bergantian; kosong = semua</span></span>
      <div class="row">${ctx.state.devices.map((d) => `
        <label class="check"><input type="checkbox" name="bDev" value="${d.id}" ${s.deviceIds.includes(d.id) ? 'checked' : ''}> ${esc(d.name)} ${chip(d.status)}</label>`).join('') || '<span class="muted">Belum ada device.</span>'}</div>
    </div>
    <div class="field"><span>Hanya untuk grup <span class="hint">— kosong = semua kontak</span></span>
      <div class="row">${groups.map((g) => `
        <label class="check"><input type="checkbox" name="bGroup" value="${g.id}" ${s.groupIds.includes(g.id) ? 'checked' : ''}>
        <span class="dot-c" style="background:${esc(g.color)}"></span>${esc(g.name)}</label>`).join('') || '<span class="muted">Belum ada grup kontak.</span>'}</div>
    </div>
    <label class="field"><span>Pesan ucapan</span>
      <textarea id="bTemplate" style="min-height:150px">${esc(s.template)}</textarea>
      <span class="hint"><b>[Nama]</b>, <b>[Nama Depan]</b>, <b>[Umur]</b> (kalau tahun lahir diisi), kolom Kontak seperti <b>[Kelas]</b>,
        dan <b>{Selamat ulang tahun|Selamat milad}</b> untuk variasi acak.</span>
    </label>
    <div class="label" style="margin-bottom:4px">Pratinjau <span class="muted" id="pvName" style="font-weight:400"></span></div>
    <div class="bubble" id="pvBody"></div>
    <div class="row between" style="margin-top:6px">
      <span class="muted" id="saveState"></span>
      <button class="btn grad" id="bSave">${icon('check')} Simpan</button>
    </div>
  </div>`;
}

function autoInfo() {
  const s = settings;
  return s.auto
    ? `Aktif: setiap hari mulai pukul <b>${esc(s.time)}</b>. Kalau server sempat mati, ucapan tetap dikirim hari itu sampai pukul ${s.lastHour}.00.`
    : 'Kirim otomatis <b>nonaktif</b>. Periksa data & pesan dulu, lalu nyalakan saklar di atas.';
}

function todayRows(list) {
  if (!list.length) return `<div class="empty">${icon('cake')}<div>Tidak ada yang berulang tahun hari ini.</div></div>`;
  return list.map((c) => {
    const st = c.log ? MSG_STATUS[c.log.status] ?? ['muted', 'Tercatat'] : ['muted', 'Belum dikirim'];
    return `<div class="list-row" style="grid-template-columns:46px minmax(0,1fr) auto">
      <span class="circle c-warn">${icon('cake')}</span>
      <div><b>${esc(c.name || '—')}${c.age ? ` <span class="muted" style="font-weight:400">· ${c.age} tahun</span>` : ''}</b>
        <small>${esc(localPhone(c.phone))}</small></div>
      ${chip(st[0], st[1])}
    </div>`;
  }).join('');
}

async function loadOverview(el, ctx) {
  const { data: o } = await ctx.call('GET', '/admin/birthday/overview');
  const notSent = o.today.filter((c) => !c.log).length;
  $('#todayCount', el).textContent = fmt(o.today.length);
  $('#todayMeta', el).innerHTML = `
    <div><small>Belum dikirim</small><b>${fmt(notSent)}</b></div>
    <div><small>30 hari ke depan</small><b>${fmt(o.upcoming.length)}</b></div>
    <div><small>Dikirim tahun ini</small><b>${fmt(o.thisYear)}</b></div>`;
  $('#runBtn', el).disabled = !notSent;
  $('#todayList', el).innerHTML = todayRows(o.today);

  $('#upList', el).innerHTML = o.upcoming.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Tanggal</th><th>Nama</th><th>Umur</th><th>Lagi</th></tr></thead>
        <tbody>${o.upcoming.map((c) => `<tr>
          <td style="white-space:nowrap">${fmtDate(c.date)}</td>
          <td><b style="font-weight:600">${esc(c.name || '—')}</b><div class="muted">${esc(localPhone(c.phone))}</div></td>
          <td>${c.age ? `${c.age} th` : '<span class="muted">—</span>'}</td>
          <td class="muted" style="white-space:nowrap">${c.days === 1 ? 'besok' : `${c.days} hari`}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="muted">Tidak ada ulang tahun dalam 30 hari ke depan.</div>';

  const pct = o.total ? Math.round((o.withDate / o.total) * 100) : 0;
  $('#dataInfo', el).innerHTML = `
    ${o.field ? `<div class="muted" style="margin-bottom:10px">Kolom dipakai: <code>${esc(o.field)}</code></div>`
      : '<div class="est" style="margin:0 0 12px">Belum ada kolom tanggal lahir. Tambahkan kolom mis. <b>Tanggal Lahir</b> saat import kontak.</div>'}
    <div class="label">Kontak dengan tanggal lahir</div>
    <div class="meter"><i style="width:${pct}%"></i></div>
    <div class="muted">${fmt(o.withDate)} dari ${fmt(o.total)} kontak${o.missing ? ` · ${fmt(o.missing)} belum diisi` : ''}${o.invalidCount ? ` · <span class="c-bad">${fmt(o.invalidCount)} tidak terbaca</span>` : ''}</div>
    ${o.invalid.length ? `
      <div class="label" style="margin:16px 0 6px">Tanggal tidak terbaca</div>
      <div class="table-wrap"><table>${o.invalid.slice(0, 20).map((c) => `
        <tr><td>${esc(c.name || '—')}</td><td class="muted">${esc(localPhone(c.phone))}</td><td><code>${esc(c.raw)}</code></td></tr>`).join('')}</table></div>
      <div class="muted" style="margin-top:6px">Perbaiki di menu <a href="#/contacts">Kontak</a>. Format yang dikenali: 17/05/2010, 2010-05-17, 17 Mei 2010.</div>` : ''}`;
}

async function loadHistory(el, ctx) {
  const { data } = await ctx.call('GET', '/admin/birthday/history');
  $('#history', el).innerHTML = data.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Waktu</th><th>Nama</th><th>Device</th><th>Status</th></tr></thead>
        <tbody>${data.map((r) => {
          const st = MSG_STATUS[r.status] ?? ['muted', r.status ? r.status : 'Dihapus'];
          return `<tr><td style="white-space:nowrap">${localTime(r.sent_at)}</td>
            <td><b style="font-weight:600">${esc(r.name || '(kontak dihapus)')}</b><div class="muted">${esc(localPhone(r.phone))}</div></td>
            <td class="muted">${esc(r.device_name ?? '')}</td>
            <td>${chip(st[0], st[1])}${r.error ? `<div class="muted c-bad">${esc(r.error)}</div>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>`
    : '<div class="muted">Belum ada ucapan yang dikirim.</div>';
}

let pvTimer;
async function preview(el, ctx) {
  clearTimeout(pvTimer);
  pvTimer = setTimeout(async () => {
    try {
      const { data } = await ctx.call('POST', '/admin/birthday/preview', { template: $('#bTemplate', el).value, field: $('#bField', el).value });
      $('#pvName', el).textContent = `— contoh untuk ${data.name}`;
      $('#pvBody', el).textContent = data.body;
    } catch { /* abaikan */ }
  }, 250);
}

function collect(el) {
  return {
    auto: $('#bAuto', el).checked,
    time: $('#bTime', el).value,
    field: $('#bField', el).value,
    deviceIds: $$('input[name=bDev]:checked', el).map((i) => i.value),
    groupIds: $$('input[name=bGroup]:checked', el).map((i) => Number(i.value)),
    template: $('#bTemplate', el).value,
  };
}

export default {
  async mount(el, ctx) {
    await ctx.loadDevices();
    const [s, fields, groups] = await Promise.all([
      ctx.call('GET', '/admin/birthday/settings'),
      ctx.call('GET', '/admin/contacts/fields'),
      ctx.call('GET', '/admin/contacts/groups'),
    ]);
    settings = s.data;
    dirty = false;

    el.innerHTML = `
    <div class="grid g-dash">
      <div class="stack">
        <div class="hero" style="min-height:200px">
          <div class="label">Ulang tahun hari ini</div>
          <div class="big" id="todayCount">0</div>
          <div class="meta" id="todayMeta"></div>
        </div>
        <div class="card">
          <div class="card-head">
            <div><h3>Hari ini</h3><p>${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
            <button class="btn soft sm" id="runBtn">${icon('send')} Kirim sekarang</button>
          </div>
          <div id="todayList"></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>30 Hari ke Depan</h3></div></div>
          <div id="upList"></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Riwayat Ucapan</h3><p>100 terakhir</p></div></div>
          <div id="history"></div>
        </div>
      </div>

      <div class="stack">
        ${settingsCard(ctx, fields.data, groups.data)}
        <div class="card">
          <div class="card-head"><div><h3>Data Tanggal Lahir</h3><p>Diambil dari kolom data di menu Kontak</p></div></div>
          <div id="dataInfo"></div>
        </div>
      </div>
    </div>`;

    $('#autoInfo', el).innerHTML = autoInfo();
    const markDirty = () => { dirty = true; $('#saveState', el).textContent = 'Ada perubahan yang belum disimpan'; };
    el.addEventListener('input', (e) => {
      if (e.target.closest('.card') && !e.target.matches('#bAuto')) markDirty();
      if (e.target.matches('#bTemplate')) preview(el, ctx);
    });
    el.addEventListener('change', (e) => {
      if (e.target.matches('#bField')) { preview(el, ctx); markDirty(); }
      if (e.target.matches('input[name=bDev], input[name=bGroup], #bTime')) markDirty();
    });

    $('#bAuto', el).addEventListener('change', async (e) => {
      const on = e.target.checked;
      if (on && !(await confirmBox('Nyalakan kirim otomatis?', `Ucapan akan dikirim setiap hari mulai pukul ${$('#bTime', el).value}. Pengaturan lain di kartu ini ikut disimpan.`, { okText: 'Nyalakan' }))) {
        e.target.checked = false;
        return;
      }
      try {
        settings = { ...settings, ...(await ctx.call('PUT', '/admin/birthday/settings', collect(el))).data };
        dirty = false;
        $('#saveState', el).textContent = '';
        $('#autoInfo', el).innerHTML = autoInfo();
        ctx.toast(on ? 'Kirim otomatis aktif' : 'Kirim otomatis dimatikan');
        await loadOverview(el, ctx);
      } catch (err) { e.target.checked = !on; ctx.toast(err.message); }
    });

    $('#bSave', el).addEventListener('click', async () => {
      try {
        settings = { ...settings, ...(await ctx.call('PUT', '/admin/birthday/settings', collect(el))).data };
        dirty = false;
        $('#saveState', el).textContent = 'Tersimpan';
        $('#autoInfo', el).innerHTML = autoInfo();
        await loadOverview(el, ctx);
      } catch (err) { ctx.toast(err.message); }
    });

    $('#runBtn', el).addEventListener('click', async () => {
      if (dirty) return ctx.toast('Simpan pengaturan dulu');
      if (!(await confirmBox('Kirim ucapan sekarang?', 'Ucapan dikirim ke yang berulang tahun hari ini dan belum dikirimi tahun ini.', { okText: 'Kirim' }))) return;
      try {
        const { data } = await ctx.call('POST', '/admin/birthday/run');
        ctx.toast(data.queued ? `${data.queued} ucapan masuk antrean` : 'Tidak ada yang perlu dikirim');
        await Promise.all([loadOverview(el, ctx), loadHistory(el, ctx)]);
      } catch (err) { ctx.toast(err.message); }
    });

    preview(el, ctx);
    await Promise.all([loadOverview(el, ctx), loadHistory(el, ctx)]);
  },
  async refresh(el, ctx) {
    if (document.querySelector('.modal-bg')) return;
    await Promise.all([loadOverview(el, ctx), loadHistory(el, ctx)]);
  },
};
