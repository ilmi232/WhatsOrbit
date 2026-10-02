import { chip, confirmBox, copyText, esc, fmt, icon, promptBox } from '../ui.js';

function card(d) {
  const s = d.status;
  const cls = s === 'connected' ? 'on' : s === 'qr' || s === 'connecting' ? '' : 'off';
  const actions =
    s === 'connected'
      ? `<button class="btn warn sm" data-act="disconnect">${icon('pause')} Putuskan</button>
         <button class="btn bad-soft sm" data-act="logout">${icon('logout')} Logout WA</button>`
      : s === 'qr' || s === 'connecting'
        ? `<button class="btn ghost sm" data-act="disconnect">${icon('x')} Batal</button>`
        : `<button class="btn grad sm" data-act="connect">${icon('qr')} ${s === 'logged_out' || !d.phone ? 'Scan QR' : 'Sambungkan'}</button>`;
  return `
  <div class="card" data-id="${d.id}">
    <div class="device-top">
      <div class="device-ico ${cls}">${icon('device')}</div>
      <div style="flex:1;min-width:0">
        <h3>${esc(d.name)}</h3>
        <div class="muted">${d.phone ? '+' + esc(d.phone) : 'Belum tertaut ke nomor WA'}</div>
      </div>
      ${chip(s)}
    </div>

    ${s === 'qr' && d.qr ? `
      <div class="qr-box">
        <img src="${d.qr}" alt="QR code WhatsApp">
        <small>Buka WhatsApp di HP → <b>Perangkat tertaut</b> → <b>Tautkan perangkat</b>, lalu scan.</small>
      </div>` : ''}
    ${s === 'connecting' ? '<div class="muted" style="margin-top:12px">Menghubungkan ke WhatsApp…</div>' : ''}
    ${d.lastError && s !== 'connected' && s !== 'qr' ? `<div class="muted" style="margin-top:12px">Error terakhir: ${esc(d.lastError)}</div>` : ''}

    <div class="mini-stats">
      <div><b class="c-ok">${fmt(d.counts.sent)}</b><small>Terkirim</small></div>
      <div><b class="c-warn">${fmt(d.counts.pending)}</b><small>Antrean</small></div>
      <div><b class="c-bad">${fmt(d.counts.failed)}</b><small>Gagal</small></div>
    </div>

    <div class="label" style="margin-bottom:6px">API key</div>
    <div class="keybox">
      <code>${esc(d.api_key)}</code>
      <button class="btn soft sm" data-act="copy">${icon('copy')} Copy</button>
      <button class="btn ghost sm" data-act="regen" title="Buat API key baru">${icon('refresh')}</button>
    </div>

    <div class="row between" style="margin-top:18px">
      <div class="row">${actions}</div>
      <div class="row">
        <button class="btn ghost sm" data-act="rename" title="Ubah nama">${icon('edit')}</button>
        <button class="btn bad-soft sm" data-act="delete" title="Hapus device">${icon('trash')}</button>
      </div>
    </div>
  </div>`;
}

function render(el, ctx) {
  const list = ctx.state.devices;
  el.innerHTML = `
    <div class="section-title">
      <h2>${list.length} device</h2>
      <button class="btn grad" data-act="add">${icon('plus')} Tambah Device</button>
    </div>
    ${list.length
      ? `<div class="grid g-auto">${list.map(card).join('')}</div>`
      : `<div class="card empty">${icon('device')}
          <div style="font-weight:600;color:var(--text);margin-bottom:4px">Belum ada device</div>
          <div>Tambah device, lalu scan QR dari WhatsApp di HP.</div></div>`}`;
}

async function onClick(e, el, ctx) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.closest('[data-id]')?.dataset.id;
  const d = ctx.state.devices.find((x) => x.id === id);
  try {
    if (act === 'add') {
      const name = await promptBox('Tambah device', '', 'Beri nama untuk nomor WhatsApp ini, misalnya "Humas A".');
      if (!name) return;
      await ctx.call('POST', '/admin/devices', { name });
    } else if (act === 'copy') {
      return copyText(d.api_key, 'API key disalin');
    } else if (act === 'connect') {
      await ctx.call('POST', `/admin/devices/${id}/connect`);
    } else if (act === 'disconnect') {
      await ctx.call('POST', `/admin/devices/${id}/disconnect`);
    } else if (act === 'logout') {
      if (!(await confirmBox(`Logout "${d.name}"?`, 'Device akan dilepas dari WhatsApp dan perlu scan QR lagi untuk dipakai.', { danger: true, okText: 'Logout' }))) return;
      await ctx.call('POST', `/admin/devices/${id}/logout`);
    } else if (act === 'regen') {
      if (!(await confirmBox('Buat API key baru?', 'Script Google Form / aplikasi yang memakai key lama akan berhenti bekerja sampai diganti.', { okText: 'Buat baru' }))) return;
      await ctx.call('POST', `/admin/devices/${id}/regenerate-key`);
      ctx.toast('API key baru dibuat');
    } else if (act === 'rename') {
      const name = await promptBox('Ubah nama device', d.name);
      if (!name) return;
      await ctx.call('PATCH', `/admin/devices/${id}`, { name });
    } else if (act === 'delete') {
      if (!(await confirmBox(`Hapus "${d.name}"?`, 'Device akan di-logout dari WhatsApp dan log pesannya ikut terhapus.', { danger: true, okText: 'Hapus' }))) return;
      await ctx.call('DELETE', `/admin/devices/${id}`);
    }
    await ctx.loadDevices();
    render(el, ctx);
  } catch (err) {
    ctx.toast(err.message);
  }
}

export default {
  async mount(el, ctx) {
    await ctx.loadDevices();
    render(el, ctx);
    el.addEventListener('click', (e) => onClick(e, el, ctx));
  },
  async refresh(el, ctx) {
    if (document.querySelector('.modal-bg')) return; // jangan ganggu dialog yang terbuka
    await ctx.loadDevices();
    render(el, ctx);
  },
};
