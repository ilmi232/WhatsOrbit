import { $, chip, confirmBox, esc, fmt, icon, localTime } from '../ui.js';

const PAGE = 50;
const st = { device: '', filter: '', q: '', offset: 0, rows: [] };

const who = (m) => {
  const phone = m.phone ? (m.phone.startsWith('62') ? '0' + m.phone.slice(2) : '+' + m.phone) : 'Nomor tersembunyi';
  return { name: m.contact_name || m.push_name || phone, phone };
};

function replyDialog(ctx, m) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const w = who(m);
    bg.innerHTML = `
      <form class="modal wide">
        <h3>Balas ${esc(w.name)}</h3>
        <p>${esc(w.phone)} · via ${esc(m.device_name ?? '')}</p>
        <div class="bubble" style="background:var(--surface-2);color:var(--text)">${esc(m.body)}</div>
        <label class="field"><span>Balasan</span><textarea name="text" required style="min-height:110px"></textarea></label>
        <div class="row"><button type="button" class="btn ghost" data-x>Batal</button><button class="btn grad">${icon('send')} Kirim</button></div>
      </form>`;
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-x]')) { bg.remove(); resolve(false); } });
    $('form', bg).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await ctx.call('POST', `/admin/inbox/${m.id}/reply`, { text: e.target.text.value });
        bg.remove();
        resolve(true);
      } catch (err) { ctx.toast(err.message); }
    });
    document.body.append(bg);
    $('textarea', bg).focus();
  });
}

async function load(el, ctx) {
  const p = new URLSearchParams({ limit: PAGE, offset: st.offset });
  if (st.device) p.set('device', st.device);
  if (st.filter) p.set('filter', st.filter);
  if (st.q) p.set('q', st.q);
  const [res, stats] = await Promise.all([
    ctx.call('GET', `/admin/inbox?${p}`),
    ctx.call('GET', '/admin/inbox/stats'),
  ]);
  st.rows = res.data;
  $('#inSub', el).textContent = `${fmt(stats.data.today)} pesan hari ini · ${fmt(stats.data.autoToday)} dibalas otomatis · disimpan ${stats.data.keepDays} hari`;

  $('#inList', el).innerHTML = res.data.map((m) => {
    const w = who(m);
    const status = m.handled_by
      ? chip(m.handled_by.includes('→ admin') ? 'warn' : 'ok', m.handled_by)
      : m.rule_name
      ? chip('ok', `Autoreply: ${m.rule_name}`)
      : m.autoreply_rule_id ? chip('ok', 'Autoreply') : m.replied_at ? chip('info', 'Dibalas manual') : chip('muted', 'Belum dibalas');
    return `
      <div class="list-row" data-mid="${m.id}" style="grid-template-columns:46px minmax(0,1fr) auto;align-items:start">
        <span class="circle c-info">${icon('chat')}</span>
        <div style="min-width:0">
          <b>${esc(w.name)} <span class="muted" style="font-weight:400">${esc(w.phone)}</span></b>
          <div style="white-space:pre-wrap;word-break:break-word;margin:4px 0">${esc(m.body)}</div>
          <small>${localTime(m.received_at)} · ${esc(m.device_name ?? '')} ${status}</small>
        </div>
        <div class="row" style="flex-wrap:nowrap">
          <button class="btn soft sm" data-reply>${icon('reply')} Balas</button>
          <button class="btn ghost sm" data-del title="Hapus">${icon('trash')}</button>
        </div>
      </div>`;
  }).join('') || `<div class="empty">${icon('inbox')}<div style="font-weight:600;color:var(--text)">Belum ada pesan masuk</div>
    <div>Pesan pribadi yang diterima device akan muncul di sini.</div></div>`;

  const from = res.total ? st.offset + 1 : 0;
  const to = Math.min(st.offset + PAGE, res.total);
  $('#pager', el).innerHTML = `
    <span class="muted">${fmt(from)}–${fmt(to)} dari ${fmt(res.total)}</span>
    <div class="row">
      <button class="btn ghost sm" data-page="-1" ${st.offset ? '' : 'disabled'}>‹ Sebelumnya</button>
      <button class="btn ghost sm" data-page="1" ${to < res.total ? '' : 'disabled'}>Berikutnya ›</button>
    </div>`;
}

export default {
  async mount(el, ctx) {
    await ctx.loadDevices();
    el.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Pesan Masuk</h3><p id="inSub"></p></div></div>
      <div class="toolbar">
        <select id="inDevice" style="width:auto" aria-label="Device">
          <option value="">Semua device</option>
          ${ctx.state.devices.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
        </select>
        <div class="seg" id="inFilter">
          <button data-f="" class="on">Semua</button><button data-f="unreplied">Belum dibalas</button><button data-f="auto">Otomatis</button>
        </div>
        <div class="search">${icon('search')}<input id="inQ" placeholder="Cari isi pesan, nama, atau nomor" aria-label="Cari pesan"></div>
      </div>
      <div id="inList"></div>
      <div id="pager" class="pager"></div>
    </div>`;

    $('#inDevice', el).value = st.device;
    $('#inQ', el).value = st.q;
    for (const b of el.querySelectorAll('#inFilter button')) b.classList.toggle('on', b.dataset.f === st.filter);

    $('#inDevice', el).addEventListener('change', (e) => { st.device = e.target.value; st.offset = 0; load(el, ctx); });
    $('#inFilter', el).addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      st.filter = b.dataset.f;
      st.offset = 0;
      for (const x of el.querySelectorAll('#inFilter button')) x.classList.toggle('on', x === b);
      load(el, ctx);
    });
    let t;
    $('#inQ', el).addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => { st.q = e.target.value.trim(); st.offset = 0; load(el, ctx); }, 250);
    });
    $('#pager', el).addEventListener('click', (e) => {
      const d = Number(e.target.closest('[data-page]')?.dataset.page);
      if (!d) return;
      st.offset = Math.max(0, st.offset + d * PAGE);
      load(el, ctx);
    });
    $('#inList', el).addEventListener('click', async (e) => {
      const row = e.target.closest('[data-mid]');
      if (!row) return;
      const m = st.rows.find((x) => x.id === Number(row.dataset.mid));
      try {
        if (e.target.closest('[data-reply]')) {
          if (await replyDialog(ctx, m)) { ctx.toast('Balasan masuk antrean'); load(el, ctx); }
        } else if (e.target.closest('[data-del]')) {
          if (!(await confirmBox('Hapus pesan ini dari daftar?', '', { danger: true, okText: 'Hapus' }))) return;
          await ctx.call('DELETE', `/admin/inbox/${m.id}`);
          load(el, ctx);
        }
      } catch (err) { ctx.toast(err.message); }
    });

    await load(el, ctx);
  },
  async refresh(el, ctx) {
    if (document.querySelector('.modal-bg') || st.offset) return;
    await load(el, ctx);
  },
};
