// Kartu Anti-banned di halaman Pengaturan.
import { $, chip, esc, fmt, icon } from '../ui.js';

let state = null;

function html() {
  const { settings: s, warmup, devices } = state;
  return `
    <div class="card-head"><div><h3>Anti-banned</h3><p>Berlaku untuk semua fitur</p></div></div>
    <div class="est" style="margin:0 0 14px">
      <b>Balasan</b> (Autoreply, Chat Bot, AI, CS, Pesan Masuk) <b>tidak dibatasi</b>, karena orangnya yang chat duluan dan sedang menunggu jawaban.
      Yang dibatasi adalah pesan yang <b>kita mulai</b>: Blast, Kirim Pesan, dan Ulang Tahun. Kalau kuota habis, sisanya otomatis dikirim besok.
    </div>
    <div class="grid g-2" style="gap:12px">
      <label class="field"><span>Batas harian per device <span class="hint">— Blast + Kirim Pesan + Ulang Tahun</span></span>
        <input type="number" min="1" id="abLimit" value="${s.dailyLimit}"></label>
      <label class="field"><span>Batas harian API / Google Form <span class="hint">— 0 = tanpa batas</span></span>
        <input type="number" min="0" id="abApi" value="${s.apiDailyLimit}"></label>
      <label class="field"><span>Jeda pesan yang kita mulai (detik)</span>
        <span class="row" style="flex-wrap:nowrap"><input type="number" min="5" id="abMin" value="${s.initDelayMin}"> s/d <input type="number" min="5" id="abMax" value="${s.initDelayMax}"></span></label>
      <div class="field"><span>Jeda balasan & API</span><span class="muted">4–10 detik (diatur di <code>.env</code>). Blast punya jeda sendiri per blast.</span></div>
    </div>
    <div class="row between"><span class="muted" id="abState"></span><button class="btn grad sm" id="abSave">${icon('check')} Simpan</button></div>

    <div class="label" style="margin:18px 0 8px">Pemakaian hari ini</div>
    ${devices.map((d) => {
      const pct = Math.min(100, (d.initiated / Math.max(1, d.limit)) * 100);
      return `
      <div style="margin-bottom:14px">
        <div class="row between">
          <b>${esc(d.name)} ${chip(d.status)}</b>
          <label class="row" style="flex-wrap:nowrap;cursor:pointer;font-size:12.5px">
            <input type="checkbox" data-warmup="${d.id}" ${d.warmupDay ? 'checked' : ''}> Mode pemanasan
          </label>
        </div>
        <div class="meter"><i style="width:${pct}%;${pct >= 100 ? 'background:var(--bad)' : ''}"></i></div>
        <div class="muted">${fmt(d.initiated)} / ${fmt(d.limit)} pesan yang kita mulai${d.apiLimit ? ` · API ${fmt(d.api)} / ${fmt(d.apiLimit)}` : ` · API ${fmt(d.api)}`}
          ${d.held ? ` · <span class="c-warn">${fmt(d.held)} tertahan menunggu kuota</span>` : ''}
          ${d.warmupDay ? ` · <span class="c-info">pemanasan hari ke-${d.warmupDay} dari ${d.warmupTotal}</span>` : ''}</div>
      </div>`;
    }).join('') || '<div class="muted">Belum ada device.</div>'}
    <details>
      <summary style="cursor:pointer;font-weight:600">Tentang mode pemanasan</summary>
      <p class="muted" style="margin:8px 0">Untuk nomor yang baru dipakai mengirim pesan. Batas harian naik bertahap supaya WhatsApp melihat pola wajar:</p>
      <div class="row" style="gap:6px">${warmup.map((w, i) => `<span class="fchip">hari ${i ? warmup[i - 1].untilDay + 1 : 1}–${w.untilDay}: <b>${w.limit}</b></span>`).join('')}
        <span class="fchip">setelahnya: <b>batas normal</b></span></div>
    </details>`;
}

async function load(card, ctx) {
  state = (await ctx.call('GET', '/admin/antiban')).data;
  card.innerHTML = html();
}

export async function mountAntiban(card, ctx) {
  await load(card, ctx);
  card.addEventListener('click', async (e) => {
    if (!e.target.closest('#abSave')) return;
    try {
      await ctx.call('PUT', '/admin/antiban', {
        dailyLimit: Number($('#abLimit', card).value),
        apiDailyLimit: Number($('#abApi', card).value),
        initDelayMin: Number($('#abMin', card).value),
        initDelayMax: Number($('#abMax', card).value),
      });
      ctx.toast('Pengaturan anti-banned disimpan');
      await load(card, ctx);
    } catch (err) { ctx.toast(err.message); }
  });
  card.addEventListener('input', (e) => { if (e.target.type === 'number') $('#abState', card).textContent = 'Belum disimpan'; });
  card.addEventListener('change', async (e) => {
    const id = e.target.dataset.warmup;
    if (!id) return;
    try {
      await ctx.call('PATCH', `/admin/devices/${id}/warmup`, { on: e.target.checked });
      ctx.toast(e.target.checked ? 'Mode pemanasan aktif (mulai hari ini)' : 'Mode pemanasan dimatikan');
      await load(card, ctx);
    } catch (err) { e.target.checked = !e.target.checked; ctx.toast(err.message); }
  });
}
