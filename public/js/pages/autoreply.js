import { $, $$, chip, confirmBox, esc, fmt, icon, timeAgo } from '../ui.js';

const TYPES = {
  contains: ['Mengandung kata', 'Pesan mengandung salah satu kata kunci'],
  exact: ['Sama persis', 'Seluruh pesan sama dengan kata kunci (huruf besar/kecil diabaikan)'],
  startsWith: ['Diawali', 'Pesan diawali kata kunci, cocok untuk perintah seperti #menu'],
  any: ['Semua pesan', 'Membalas pesan apa pun yang tidak cocok aturan lain (sambutan / di luar jam kantor)'],
  regex: ['Regex (lanjutan)', 'Pola regular expression, satu per baris'],
};

let rules = [];

function ruleCard(r, i, ctx) {
  const names = Object.fromEntries(ctx.state.devices.map((d) => [d.id, d.name]));
  const kws = r.match_type === 'any' ? [] : r.keywords.split(r.match_type === 'regex' ? /\n/ : /\n|,/).map((k) => k.trim()).filter(Boolean);
  const hours = r.hour_start != null ? `pukul ${r.hour_start}.00–${r.hour_end}.00` : 'sepanjang hari';
  return `
  <div class="card" data-rid="${r.id}" style="margin-bottom:18px;${r.active ? '' : 'opacity:.6'}">
    <div class="row between" style="align-items:flex-start;flex-wrap:nowrap">
      <div style="min-width:0">
        <div class="row" style="gap:8px">
          <h3 style="margin:0;font-size:16px;font-weight:600">${esc(r.name)}</h3>
          ${chip(r.match_type === 'any' ? 'warn' : 'info', TYPES[r.match_type][0])}
        </div>
        <div class="muted" style="margin-top:4px">
          ${r.device_ids.length ? r.device_ids.map((d) => esc(names[d] ?? d)).join(', ') : 'Semua device'} · ${hours} ·
          jeda ${r.cooldown_min ? `${fmt(r.cooldown_min)} menit` : 'tidak ada'} per pengirim${r.in_groups ? ' · termasuk grup' : ''}
        </div>
      </div>
      <label class="switch" title="${r.active ? 'Nonaktifkan' : 'Aktifkan'}">
        <input type="checkbox" data-toggle ${r.active ? 'checked' : ''} aria-label="Aktif"><i></i>
      </label>
    </div>
    ${kws.length ? `<div style="margin-top:12px">${kws.map((k) => `<span class="fchip"><b>${esc(k)}</b></span>`).join('')}</div>` : ''}
    <div class="bubble" style="margin-top:12px">${esc(r.reply)}</div>
    <div class="row between">
      <span class="muted">Dipakai <b>${fmt(r.hits)}</b>×${r.last_hit_at ? ` · terakhir ${timeAgo(r.last_hit_at)}` : ''}</span>
      <div class="row">
        ${r.match_type !== 'any' ? `
          <button class="btn ghost sm" data-move="-1" ${i === 0 ? 'disabled' : ''} title="Naikkan prioritas">${icon('up')}</button>
          <button class="btn ghost sm" data-move="1" title="Turunkan prioritas">${icon('down')}</button>` : ''}
        <button class="btn ghost sm" data-edit>${icon('edit')} Ubah</button>
        <button class="btn bad-soft sm" data-del title="Hapus">${icon('trash')}</button>
      </div>
    </div>
  </div>`;
}

function ruleDialog(ctx, r = null) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const type = r?.match_type ?? 'contains';
    const useHours = r?.hour_start != null;
    bg.innerHTML = `
      <form class="modal wide">
        <h3>${r ? 'Ubah aturan' : 'Aturan baru'}</h3>
        <label class="field"><span>Nama aturan <span class="hint">— opsional</span></span>
          <input name="name" value="${esc(r?.name ?? '')}" placeholder="mis. Info PPDB"></label>
        <label class="field"><span>Jenis pencocokan</span>
          <select name="match_type">${Object.entries(TYPES).map(([k, [label]]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${label}</option>`).join('')}</select>
          <span class="hint" id="typeHint"></span>
        </label>
        <label class="field" id="kwBox"><span>Kata kunci</span>
          <textarea name="keywords" style="min-height:80px" placeholder="ppdb&#10;pendaftaran&#10;daftar sekolah">${esc(r?.keywords ?? '')}</textarea>
          <span class="hint">Satu per baris (atau dipisah koma). Huruf besar/kecil tidak berpengaruh.</span>
        </label>
        <label class="field"><span>Balasan</span>
          <textarea name="reply" style="min-height:120px" required placeholder="{Halo|Hai} [Nama], terima kasih sudah menghubungi kami ...">${esc(r?.reply ?? '')}</textarea>
          <span class="hint"><b>[Nama]</b> nama pengirim (dari Kontak kalau ada), <b>[Nomor]</b>, <b>[Pesan]</b> isi pesannya, dan kolom Kontak seperti <b>[Kelas]</b>.
          <b>{Halo|Hai}</b> = variasi acak.</span>
        </label>
        <div class="field"><span>Device <span class="hint">— tidak dipilih = semua device</span></span>
          <div class="row">${ctx.state.devices.map((d) => `
            <label class="check"><input type="checkbox" name="dev" value="${d.id}" ${r?.device_ids.includes(d.id) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('')}</div>
        </div>
        <div class="grid g-2" style="gap:14px">
          <label class="field"><span>Jeda per pengirim (menit)</span>
            <input type="number" name="cooldown_min" min="0" value="${r?.cooldown_min ?? 60}">
            <span class="hint">Orang yang sama tidak dibalas aturan ini lagi selama jeda.</span>
          </label>
          <div class="field"><span>Jam aktif</span>
            <label class="row" style="flex-wrap:nowrap;font-weight:500;cursor:pointer"><input type="checkbox" name="use_hours" ${useHours ? 'checked' : ''}> Hanya pada jam tertentu</label>
            <span class="row" id="hoursBox" style="flex-wrap:nowrap">
              <input type="number" name="hour_start" min="0" max="23" value="${r?.hour_start ?? 15}" style="width:80px"> s/d
              <input type="number" name="hour_end" min="0" max="24" value="${r?.hour_end ?? 7}" style="width:80px">
            </span>
            <span class="hint">Boleh melewati tengah malam, mis. 15 s/d 7 = di luar jam kantor.</span>
          </div>
        </div>
        <label class="row" style="flex-wrap:nowrap;font-weight:500;cursor:pointer;margin-bottom:12px">
          <input type="checkbox" name="in_groups" ${r?.in_groups ? 'checked' : ''}> Balas juga pesan di grup <span class="muted">(tidak disarankan)</span>
        </label>
        <div class="row"><button type="button" class="btn ghost" data-x>Batal</button><button class="btn grad">Simpan</button></div>
      </form>`;
    const f = $('form', bg);
    const sync = () => {
      $('#typeHint', bg).textContent = TYPES[f.match_type.value][1];
      $('#kwBox', bg).classList.toggle('hidden', f.match_type.value === 'any');
      $('#hoursBox', bg).style.opacity = f.use_hours.checked ? 1 : 0.4;
    };
    sync();
    f.addEventListener('change', sync);
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-x]')) { bg.remove(); resolve(false); } });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        name: f.name.value,
        match_type: f.match_type.value,
        keywords: f.keywords.value,
        reply: f.reply.value,
        device_ids: $$('input[name=dev]:checked', bg).map((i) => i.value),
        cooldown_min: f.cooldown_min.value,
        use_hours: f.use_hours.checked,
        hour_start: f.hour_start.value,
        hour_end: f.hour_end.value,
        in_groups: f.in_groups.checked,
        active: r ? r.active : true,
      };
      try {
        if (r) await ctx.call('PATCH', `/admin/autoreply/${r.id}`, body);
        else await ctx.call('POST', '/admin/autoreply', body);
        bg.remove();
        resolve(true);
      } catch (err) { ctx.toast(err.message); }
    });
    document.body.append(bg);
    f.name.focus();
  });
}

async function load(el, ctx) {
  const res = await ctx.call('GET', '/admin/autoreply');
  rules = res.data;
  $('#arToday', el).textContent = fmt(res.repliesToday);
  $('#arActive', el).textContent = `${rules.filter((r) => r.active).length} dari ${rules.length}`;
  const keyword = rules.filter((r) => r.match_type !== 'any');
  const any = rules.filter((r) => r.match_type === 'any');
  $('#ruleList', el).innerHTML = rules.length
    ? `${keyword.length ? '<div class="nav-group" style="padding:0 4px 10px">Kata kunci · dicek dari atas ke bawah</div>' : ''}
       ${keyword.map((r, i) => ruleCard(r, i, ctx)).join('')}
       ${any.length ? '<div class="nav-group" style="padding:6px 4px 10px">Cadangan · kalau tidak ada kata kunci yang cocok</div>' : ''}
       ${any.map((r, i) => ruleCard(r, i, ctx)).join('')}`
    : `<div class="card empty">${icon('reply')}<div style="font-weight:600;color:var(--text)">Belum ada aturan</div>
        <div>Mulai dengan aturan kata kunci, mis. "ppdb" → info pendaftaran.</div></div>`;
}

export default {
  async mount(el, ctx) {
    await ctx.loadDevices();
    el.innerHTML = `
    <div class="grid g-dash">
      <div>
        <div class="section-title">
          <h2>Aturan Autoreply</h2>
          <button class="btn grad" id="addRule">${icon('plus')} Aturan</button>
        </div>
        <div id="ruleList"></div>
      </div>

      <div class="stack">
        <div class="grid g-2">
          <div class="card stat" style="min-height:0;padding-bottom:20px"><div class="k">Balasan hari ini</div><div class="v" id="arToday">0</div></div>
          <div class="card stat" style="min-height:0;padding-bottom:20px"><div class="k">Aturan aktif</div><div class="v" id="arActive" style="font-size:20px">0</div></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Simulator</h3><p>Coba pesan masuk tanpa mengirim apa pun</p></div></div>
          <form id="simForm">
            <div class="grid g-2" style="gap:10px">
              <label class="field"><span>Device</span><select name="device">${ctx.state.devices.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label>
              <label class="field"><span>Nama pengirim</span><input name="name" value="Budi"></label>
            </div>
            <label class="field"><span>Pesan masuk</span><input name="text" placeholder="mis. info ppdb dong" required></label>
            <button class="btn soft">${icon('play')} Coba</button>
          </form>
          <div id="simOut" style="margin-top:14px"></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Cara kerja</h3></div></div>
          <ul class="muted" style="margin:0;padding-left:18px;line-height:1.8">
            <li>Hanya membalas <b>chat pribadi</b>; grup diabaikan kecuali diizinkan per aturan.</li>
            <li>Aturan kata kunci dicek dari atas; yang pertama cocok dipakai.</li>
            <li>Kalau kata kunci cocok tapi masih dalam jeda, pengirim <b>tidak</b> dibalas lagi.</li>
            <li>"Semua pesan" hanya untuk pesan yang tidak cocok kata kunci apa pun.</li>
            <li>Pesan yang masuk saat server mati (lebih dari 10 menit lalu) tidak dibalas.</li>
            <li>Balasan masuk antrean kirim dengan efek mengetik, dan pesan ditandai sudah dibaca.</li>
          </ul>
        </div>
      </div>
    </div>`;

    $('#addRule', el).addEventListener('click', async () => {
      if (await ruleDialog(ctx)) { ctx.toast('Aturan disimpan'); load(el, ctx); }
    });

    $('#ruleList', el).addEventListener('click', async (e) => {
      const card = e.target.closest('[data-rid]');
      if (!card) return;
      const r = rules.find((x) => x.id === Number(card.dataset.rid));
      try {
        if (e.target.closest('[data-edit]')) {
          if (await ruleDialog(ctx, r)) { ctx.toast('Aturan diperbarui'); load(el, ctx); }
        } else if (e.target.closest('[data-del]')) {
          if (!(await confirmBox(`Hapus aturan "${r.name}"?`, '', { danger: true, okText: 'Hapus' }))) return;
          await ctx.call('DELETE', `/admin/autoreply/${r.id}`);
          load(el, ctx);
        } else if (e.target.closest('[data-move]')) {
          const dir = Number(e.target.closest('[data-move]').dataset.move);
          const list = rules.filter((x) => x.match_type !== 'any');
          const i = list.findIndex((x) => x.id === r.id);
          const j = i + dir;
          if (j < 0 || j >= list.length) return;
          [list[i], list[j]] = [list[j], list[i]];
          await ctx.call('POST', '/admin/autoreply/reorder', { ids: list.map((x) => x.id) });
          load(el, ctx);
        }
      } catch (err) { ctx.toast(err.message); }
    });

    $('#ruleList', el).addEventListener('change', async (e) => {
      if (!e.target.matches('[data-toggle]')) return;
      const id = Number(e.target.closest('[data-rid]').dataset.rid);
      try {
        await ctx.call('PATCH', `/admin/autoreply/${id}`, { active: e.target.checked });
        load(el, ctx);
      } catch (err) { ctx.toast(err.message); }
    });

    $('#simForm', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const { data } = await ctx.call('POST', '/admin/autoreply/test', { text: f.text.value, name: f.name.value, deviceId: f.device.value });
      $('#simOut', el).innerHTML = data
        ? `<div class="muted">Cocok dengan aturan <b>${esc(data.rule.name)}</b>. Balasan:</div><div class="bubble">${esc(data.reply)}</div>`
        : '<div class="muted">Tidak ada aturan yang cocok, pesan tidak dibalas.</div>';
    });

    await load(el, ctx);
  },
};
