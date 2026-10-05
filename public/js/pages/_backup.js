// Kartu Backup di halaman Pengaturan.
import { $, confirmBox, esc, fmt, icon } from '../ui.js';

const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const when = (iso) => (iso ? new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

let state = null;

function html() {
  const { settings: s, suggestions, items, last, cloud, listError } = state;
  return `
    <div class="card-head">
      <div><h3>Backup</h3><p>Database, sesi login WhatsApp, dan .env</p></div>
      <label class="switch" title="Backup otomatis harian"><input type="checkbox" id="bkAuto" ${s.auto ? 'checked' : ''} aria-label="Backup otomatis"><i></i></label>
    </div>
    <div class="est" style="margin:0 0 14px">${s.auto
      ? `Otomatis setiap hari pukul <b>${esc(s.time)}</b>, menyimpan <b>${s.keep}</b> backup terakhir.`
      : '<b>Backup otomatis belum aktif.</b> Pilih folder (sebaiknya OneDrive/Google Drive atau drive lain), lalu nyalakan saklar.'}</div>
    <label class="field"><span>Folder tujuan</span>
      <input id="bkDir" value="${esc(s.dir)}" placeholder="mis. D:\\WhatsOrbit-Backup">
      ${suggestions.length ? `<div class="row" style="gap:6px;margin-top:6px">${suggestions.map((x) => `
        <button type="button" class="btn ${x.cloud ? 'soft' : 'ghost'} sm" data-dir="${esc(x.dir)}" title="${esc(x.dir)}">${x.cloud ? '☁️ ' : ''}${esc(x.label)}</button>`).join('')}</div>` : ''}
      <span class="hint">Jangan di drive C: yang sama kalau bisa: kalau harddisk rusak, backup ikut hilang. Folder cloud (OneDrive/Google Drive) paling aman.</span>
    </label>
    <label class="field"><span>Salinan Google Drive (rclone)</span>
      <input id="bkCloud" value="${esc(s.cloud ?? '')}" placeholder="gdrive:WhatsOrbit-Backup">
      <span class="hint">Setiap backup ikut diunggah ke sini (satu file .tar.gz). Isinya termasuk sesi login WhatsApp dan .env: jangan bagikan folder ini. Kosongkan kalau tidak perlu.</span>
    </label>
    <div class="grid g-2" style="gap:12px">
      <label class="field"><span>Jam backup</span><input type="time" id="bkTime" value="${esc(s.time)}"></label>
      <label class="field"><span>Simpan berapa backup</span><input type="number" min="1" max="90" id="bkKeep" value="${s.keep}"></label>
    </div>
    <div class="row between">
      <span class="muted" id="bkState">${last ? (last.ok ? `Terakhir: ${when(last.at)} ✓` : `<span class="c-bad">Gagal ${when(last.at)}: ${esc(last.error)}</span>`) : 'Belum pernah backup'}</span>
      <div class="row">
        ${s.cloud ? `<button class="btn ghost sm" id="bkTest">${icon('refresh')} Tes koneksi</button>` : ''}
        <button class="btn ghost sm" id="bkSave">${icon('check')} Simpan</button>
        <button class="btn grad sm" id="bkRun" ${s.dir ? '' : 'disabled'}>${icon('down')} Backup sekarang</button>
      </div>
    </div>
    ${s.cloud ? `<div class="row" style="gap:8px;margin-top:8px"><span class="muted ${cloud && cloud.ok === false ? 'c-bad' : ''}" id="bkCloudState">${
      !cloud ? 'Belum pernah diunggah ke Google Drive.'
        : cloud.state === 'uploading' ? 'Sedang mengunggah ke Google Drive…'
          : cloud.ok ? `Terunggah ke Google Drive ${when(cloud.at)} ✓ · ${cloud.count} backup tersimpan di sana`
            : `Unggah ke Google Drive gagal: ${esc(cloud.error)}`}</span>${
      cloud && cloud.ok === false ? `<button class="btn ghost sm" id="bkUpload">${icon('refresh')} Coba lagi</button>` : ''}</div>` : ''}
    ${listError ? `<div class="muted c-bad" style="margin-top:10px">${esc(listError)}</div>` : ''}
    ${items.length ? `
      <div class="label" style="margin:16px 0 6px">Backup tersimpan (${items.length})</div>
      ${items.map((b) => `
        <div class="list-row" style="grid-template-columns:minmax(0,1fr) auto">
          <div><b>${esc(when(b.createdAt) || b.name)}</b><small>${size(b.sizeBytes)}${b.devices != null ? ` · ${fmt(b.devices)} device` : ''}${b.reason ? ` · ${esc(b.reason)}` : ''}</small></div>
          <button class="btn ghost sm" data-restore="${esc(b.name)}" ${state.pm2 ? '' : 'disabled title="Butuh PM2"'}>${icon('refresh')} Pulihkan</button>
        </div>`).join('')}` : ''}`;
}

let poll = null;
async function load(card, ctx) {
  state = (await ctx.call('GET', '/admin/backup')).data;
  card.innerHTML = html();
  // Selama unggahan ke cloud berjalan, perbarui status tiap 5 detik
  clearTimeout(poll);
  if (state.cloud?.state === 'uploading' && card.isConnected) poll = setTimeout(() => load(card, ctx).catch(() => {}), 5000);
}

async function save(card, ctx, extra = {}) {
  const body = { dir: $('#bkDir', card).value, cloud: $('#bkCloud', card).value, time: $('#bkTime', card).value, keep: Number($('#bkKeep', card).value), ...extra };
  await ctx.call('PUT', '/admin/backup/settings', body);
  await load(card, ctx);
}

export async function mountBackup(card, ctx) {
  await load(card, ctx);
  card.addEventListener('click', async (e) => {
    const t = e.target;
    try {
      const pick = t.closest('[data-dir]');
      if (pick) { $('#bkDir', card).value = pick.dataset.dir; $('#bkState', card).textContent = 'Belum disimpan'; return; }
      if (t.closest('#bkSave')) { await save(card, ctx); ctx.toast('Pengaturan backup disimpan'); return; }
      if (t.closest('#bkTest')) {
        const { data } = await ctx.call('POST', '/admin/backup/test-cloud', { cloud: $('#bkCloud', card).value });
        ctx.toast(`Terhubung ke ${data.cloud} (${data.count} backup tersimpan di sana)`);
        return;
      }
      if (t.closest('#bkUpload')) { await ctx.call('POST', '/admin/backup/upload'); await load(card, ctx); return; }
      if (t.closest('#bkRun')) {
        const btn = t.closest('#bkRun');
        btn.disabled = true;
        $('#bkState', card).textContent = 'Membuat backup…';
        await save(card, ctx);
        const { data } = await ctx.call('POST', '/admin/backup/run');
        ctx.toast(state.settings.cloud ? `Backup selesai (${size(data.sizeBytes)}), sedang diunggah ke Google Drive` : `Backup selesai (${size(data.sizeBytes)})`);
        await load(card, ctx);
        return;
      }
      const r = t.closest('[data-restore]');
      if (r) {
        const b = state.items.find((x) => x.name === r.dataset.restore);
        if (!(await confirmBox('Pulihkan backup ini?',
          `Data akan dikembalikan ke kondisi ${when(b.createdAt)}: kontak, pengaturan, riwayat, dan sesi WhatsApp.\n\n` +
          'Data saat ini disimpan dulu (backup baru + salinan di folder data). Server akan restart ±10 detik.', { danger: true, okText: 'Pulihkan' }))) return;
        await ctx.call('POST', '/admin/backup/restore', { name: b.name });
        ctx.toast('Memulihkan, server restart…');
        for (let i = 0; i < 40; i++) {
          await new Promise((res) => setTimeout(res, 1500));
          try {
            const res = await fetch('/admin/info');
            if (res.status === 200 || res.status === 401) return location.reload();
          } catch { /* belum hidup */ }
        }
      }
    } catch (err) {
      ctx.toast(err.message);
      load(card, ctx).catch(() => {});
    }
  });
  card.addEventListener('change', async (e) => {
    if (e.target.id !== 'bkAuto') return;
    try {
      await save(card, ctx, { auto: e.target.checked });
      ctx.toast(e.target.checked ? 'Backup otomatis aktif' : 'Backup otomatis dimatikan');
    } catch (err) { e.target.checked = !e.target.checked; ctx.toast(err.message); }
  });
}
