import { $, chip, esc, icon, localTime } from '../ui.js';

let filter = { device: '', status: '' };

async function loadTable(el, ctx) {
  const q = filter.device ? `&device=${encodeURIComponent(filter.device)}` : '';
  const { data } = await ctx.call('GET', `/admin/messages?limit=200${q}`);
  const names = Object.fromEntries(ctx.state.devices.map((d) => [d.id, d.name]));
  const rows = data.filter((m) => !filter.status || m.status === filter.status);
  $('#logBody', el).innerHTML = rows.map((m) => `
    <tr>
      <td class="muted">${m.id}</td>
      <td style="white-space:nowrap">${localTime(m.sent_at || m.created_at)}</td>
      <td>${esc(names[m.device_id] || m.device_id)}</td>
      <td style="white-space:nowrap">${m.to_jid?.endsWith('@lid') ? '<span class="muted">Nomor tersembunyi</span>' : '+' + esc(m.to_number)}</td>
      <td class="msg">${esc(m.body)}${m.error ? `<div class="muted c-bad">${esc(m.error)}</div>` : ''}</td>
      <td>${chip(m.status)}</td>
      <td>${m.status === 'failed' ? `<button class="btn soft sm" data-retry="${m.id}">${icon('refresh')} Ulangi</button>` : ''}</td>
    </tr>`).join('') || `<tr><td colspan="7"><div class="empty">${icon('list')}<div>Belum ada pesan.</div></div></td></tr>`;
}

export default {
  async mount(el, ctx) {
    el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h3>Log Pesan</h3><p>200 pesan terakhir dari API, Google Form, dan Kirim Pesan</p></div>
        <div class="row">
          <select id="fDevice" style="width:auto">
            <option value="">Semua device</option>
            ${ctx.state.devices.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
          </select>
          <div class="seg" id="fStatus">
            <button data-s="" class="on">Semua</button><button data-s="sent">Terkirim</button>
            <button data-s="pending">Antrean</button><button data-s="failed">Gagal</button>
          </div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Waktu</th><th>Device</th><th>Tujuan</th><th>Pesan</th><th>Status</th><th></th></tr></thead>
          <tbody id="logBody"></tbody>
        </table>
      </div>
    </div>`;
    $('#fDevice', el).value = filter.device;
    for (const b of el.querySelectorAll('#fStatus button')) b.classList.toggle('on', b.dataset.s === filter.status);

    $('#fDevice', el).addEventListener('change', (e) => { filter.device = e.target.value; loadTable(el, ctx); });
    $('#fStatus', el).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      filter.status = b.dataset.s;
      for (const x of el.querySelectorAll('#fStatus button')) x.classList.toggle('on', x === b);
      loadTable(el, ctx);
    });
    el.addEventListener('click', async (e) => {
      const id = e.target.closest('[data-retry]')?.dataset.retry;
      if (!id) return;
      try {
        await ctx.call('POST', `/admin/messages/${id}/retry`);
        ctx.toast('Pesan dimasukkan ke antrean lagi');
        loadTable(el, ctx);
      } catch (err) { ctx.toast(err.message); }
    });
    await loadTable(el, ctx);
  },
  refresh: loadTable,
};
