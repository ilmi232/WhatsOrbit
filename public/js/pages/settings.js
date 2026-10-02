import { $, confirmBox, esc, icon } from '../ui.js';

const FEATURE_ICON = {
  api: 'code', contacts: 'users', leads: 'userplus', birthday: 'cake', widget: 'chat', chatbot: 'bot', aibot: 'sparkles', cs: 'headset', inbox: 'inbox', autoreply: 'reply', formScript: 'form', blast: 'blast', messageLog: 'list',
};

// Fitur Starsender yang belum ada di WhatsOrbit (rencana pengembangan)
const ROADMAP = [
  ['Otomasi', [
    ['list', 'Google Spreadsheet', 'Kirim pesan saat baris baru ditambahkan'],
    ['link', 'Integrasi Lynk.id / Mayar.id', 'Notifikasi pembayaran'],
  ]],
  ['Premium', [
    ['chat', 'Web WhatsApp', 'Balas chat dari dashboard'],
    ['link', 'Link Rotator', 'Satu link untuk beberapa nomor'],
    ['users', 'Group Greeter', 'Sapa anggota baru grup'],
  ]],
  ['Integrasi', [['webhook', 'Webhook', 'Teruskan pesan masuk ke aplikasi lain']]],
];

const dur = (s) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} hari ${h} jam` : h ? `${h} jam ${m} menit` : `${m} menit`;
};

async function render(el, ctx) {
  const [{ data: feats }, { data: sys }] = await Promise.all([
    ctx.call('GET', '/admin/features'),
    ctx.call('GET', '/admin/system'),
  ]);
  const needRestart = feats.some((f) => f.restartToFree);
  const ramPct = Math.min(100, (sys.memory.rssMb / 1024) * 100);

  el.innerHTML = `
  <div class="grid g-dash">
    <div class="card">
      <div class="card-head">
        <div><h3>Fitur</h3><p>Aktifkan hanya yang dibutuhkan. Fitur nonaktif tidak tampil di menu dan tidak berjalan.</p></div>
      </div>
      ${feats.map((f) => `
        <div class="feature ${f.enabled ? '' : 'off'}">
          <div class="fi">${icon(FEATURE_ICON[f.key] ?? 'settings')}</div>
          <div style="flex:1;min-width:0">
            <b>${esc(f.name)}</b>
            <p>${esc(f.description)}</p>
            <div class="tags">
              ${f.module ? `<span class="chip ${f.loaded ? 'info' : 'muted'}">${f.loaded ? 'Dimuat di memori' : 'Tidak dimuat'}</span>` : '<span class="chip muted">Ringan</span>'}
              ${f.restartToFree ? '<span class="chip warn">Restart untuk melepas RAM</span>' : ''}
              ${f.key === 'api' && !f.enabled ? '<span class="chip bad">Auto-reply Google Form berhenti</span>' : ''}
              ${f.requires.map((r) => `<span class="chip ${r.enabled ? 'muted' : 'warn'}">Butuh: ${esc(r.name)}</span>`).join('')}
            </div>
          </div>
          <label class="switch" title="${f.requires.some((r) => !r.enabled) ? 'Aktifkan fitur yang dibutuhkan dulu' : f.enabled ? 'Nonaktifkan' : 'Aktifkan'}">
            <input type="checkbox" data-feature="${f.key}" ${f.enabled ? 'checked' : ''} ${f.requires.some((r) => !r.enabled) ? 'disabled' : ''}
              data-dependents="${esc(f.dependents.join(', '))}" aria-label="${esc(f.name)}"><i></i>
          </label>
        </div>`).join('')}
      ${needRestart ? `
        <div class="est" style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:16px">
          <span>Ada fitur yang sudah dimatikan tapi masih di memori. Restart server untuk melepas RAM-nya.</span>
          <button class="btn grad sm" data-restart>${icon('power')} Restart sekarang</button>
        </div>` : ''}
    </div>

    <div class="stack">
      <div class="card">
        <div class="card-head"><div><h3>Sistem</h3><p>Server WhatsOrbit di PC ini</p></div></div>
        <div class="label">Pemakaian RAM</div>
        <div class="meter"><i style="width:${ramPct}%"></i></div>
        <div class="muted" style="margin-bottom:16px">${sys.memory.rssMb} MB dipakai (heap ${sys.memory.heapMb} MB). Terbesar dari jumlah device yang online.</div>
        <dl class="kv">
          <dt>Versi</dt><dd>WhatsOrbit ${esc(sys.version)} · Node ${esc(sys.node)}</dd>
          <dt>Berjalan</dt><dd>${dur(sys.uptimeSec)}</dd>
          <dt>Device</dt><dd>${sys.connected} online dari ${sys.devices}</dd>
          <dt>URL publik</dt><dd>${sys.publicUrl ? esc(sys.publicUrl) : '<span class="muted">Belum diatur (PUBLIC_URL di .env)</span>'}</dd>
          <dt>Auto-start</dt><dd>${sys.pm2 ? '<span class="chip ok">PM2 aktif</span>' : '<span class="chip warn">Tidak lewat PM2</span>'}</dd>
        </dl>
        <div class="row" style="margin-top:18px">
          <button class="btn ghost" data-restart ${sys.pm2 ? '' : 'disabled'}>${icon('power')} Restart server</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>Keamanan</h3></div></div>
        <p class="muted" style="margin:0">Password admin, port, dan jeda kirim API diatur di file <code>.env</code> di folder WhatsOrbit.
        Setelah mengubah <code>.env</code>, klik <b>Restart server</b>.</p>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:24px">
    <div class="card-head"><div><h3>Segera hadir</h3><p>Fitur yang bisa ditambahkan berikutnya. Semuanya akan bisa diaktif/nonaktifkan di sini.</p></div></div>
    ${ROADMAP.map(([group, items]) => `
      <div class="nav-group" style="padding:10px 0 8px">${group}</div>
      <div class="soon">${items.map(([ic, name, desc]) => `
        <div class="row" style="flex-wrap:nowrap;align-items:flex-start;gap:12px">
          <span class="muted" style="margin-top:2px">${icon(ic)}</span>
          <div><b>${esc(name)}</b><small>${esc(desc)}</small></div>
        </div>`).join('')}</div>`).join('')}
  </div>`;
}

async function restart(ctx) {
  if (!(await confirmBox('Restart server?', 'Dashboard akan terputus beberapa detik. Device tersambung lagi otomatis tanpa scan ulang.', { okText: 'Restart' }))) return;
  await ctx.call('POST', '/admin/restart');
  ctx.toast('Server sedang restart…');
  // Tunggu server hidup lagi, lalu muat ulang halaman
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const r = await fetch('/admin/info');
      if (r.status === 200 || r.status === 401) return location.reload();
    } catch { /* belum hidup */ }
  }
  ctx.toast('Server belum merespons, coba muat ulang halaman');
}

export default {
  async mount(el, ctx) {
    await render(el, ctx);
    el.addEventListener('change', async (e) => {
      const key = e.target.dataset?.feature;
      if (!key) return;
      const on = e.target.checked;
      if (!on && key === 'api' && !(await confirmBox('Matikan API?', 'Auto-reply Google Form dan aplikasi lain yang memakai /api/send akan berhenti bekerja.', { danger: true, okText: 'Matikan' }))) {
        e.target.checked = true;
        return;
      }
      const deps = e.target.dataset.dependents;
      if (!on && deps && !(await confirmBox('Fitur lain ikut nonaktif', `Fitur berikut membutuhkan fitur ini dan akan ikut dimatikan: ${deps}.`, { danger: true, okText: 'Matikan semua' }))) {
        e.target.checked = true;
        return;
      }
      if (!on && key === 'blast' && !(await confirmBox('Matikan Blast?', 'Blast yang sedang berjalan akan berhenti mengirim sampai fitur diaktifkan lagi.', { danger: true, okText: 'Matikan' }))) {
        e.target.checked = true;
        return;
      }
      try {
        await ctx.call('PATCH', `/admin/features/${key}`, { enabled: on });
        await ctx.reloadInfo();
        ctx.toast(on ? 'Fitur diaktifkan' : 'Fitur dinonaktifkan');
        await render(el, ctx);
      } catch (err) {
        e.target.checked = !on;
        ctx.toast(err.message);
      }
    });
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-restart]')) restart(ctx).catch((err) => ctx.toast(err.message));
    });
  },
};
