import { $, $$, chip, confirmBox, esc, fmt, icon, localTime, timeAgo } from '../ui.js';

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const localPhone = (p) => (p ? (p.startsWith('62') ? '0' + p.slice(2) : '+' + p) : 'Nomor tersembunyi');
const waFormat = (s) => esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');

const st = { tab: 'open', q: '', openId: null, agents: [], settings: null };

// ---- Petugas -------------------------------------------------------------------------
function agentDialog(ctx, a = null) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <form class="modal wide">
        <h3>${a ? 'Ubah petugas' : 'Petugas baru'}</h3>
        <div class="grid g-2" style="gap:12px">
          <label class="field"><span>Nama</span><input name="name" value="${esc(a?.name ?? '')}" placeholder="mis. Bu Rina" required></label>
          <label class="field"><span>Nomor WhatsApp pribadi</span><input name="phone" value="${esc(a ? localPhone(a.phone) : '')}" placeholder="0812xxxxxxxx" required></label>
        </div>
        <div class="field"><span>Jam tugas <span class="hint">— kosong = kapan saja</span></span>
          <span class="row" style="flex-wrap:nowrap"><input type="time" name="start" value="${esc(a?.start ?? '')}"> s/d <input type="time" name="end" value="${esc(a?.end ?? '')}"></span></div>
        <div class="field"><span>Hari tugas <span class="hint">— tidak dipilih = setiap hari</span></span>
          <div class="row" style="gap:6px">${DAYS.map((d, i) => `<label class="check" style="padding:6px 10px"><input type="checkbox" name="day" value="${i}" ${a?.days.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div></div>
        <div class="field"><span>Menangani chat dari device <span class="hint">— tidak dipilih = semua</span></span>
          <div class="row">${ctx.state.devices.map((d) => `<label class="check"><input type="checkbox" name="dev" value="${d.id}" ${a?.device_ids.includes(d.id) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('')}</div></div>
        <p style="margin:4px 0 12px">Petugas akan menerima notifikasi chat di nomor ini, dari nomor WhatsApp sekolah, dan membalas dengan mengutip notifikasinya.</p>
        <div class="row"><button type="button" class="btn ghost" data-x>Batal</button><button class="btn grad">Simpan</button></div>
      </form>`;
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-x]')) { bg.remove(); resolve(false); } });
    $('form', bg).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = {
        name: f.name.value, phone: f.phone.value, start: f.start.value, end: f.end.value,
        days: $$('input[name=day]:checked', bg).map((x) => Number(x.value)),
        device_ids: $$('input[name=dev]:checked', bg).map((x) => x.value),
        active: a ? a.active : true,
      };
      try {
        if (a) await ctx.call('PUT', `/admin/cs/agents/${a.id}`, body);
        else await ctx.call('POST', '/admin/cs/agents', body);
        bg.remove();
        resolve(true);
      } catch (err) { ctx.toast(err.message); }
    });
    document.body.append(bg);
    $('input[name=name]', bg).focus();
  });
}

async function loadAgents(el, ctx) {
  st.agents = (await ctx.call('GET', '/admin/cs/agents')).data;
  $('#agents', el).innerHTML = st.agents.length ? st.agents.map((a) => `
    <div class="list-row" data-aid="${a.id}" style="grid-template-columns:46px minmax(0,1fr) auto">
      <span class="circle ${a.onShift ? 'c-ok' : 'c-bad'}">${icon('headset')}</span>
      <div style="min-width:0">
        <b>${esc(a.name)} ${a.onShift ? chip('ok', 'Bertugas') : chip('muted', a.on_duty ? 'Di luar jam' : 'Off')}</b>
        <small>${esc(localPhone(a.phone))}${a.start ? ` · ${esc(a.start)}–${esc(a.end)}` : ''}${a.days.length ? ` · ${a.days.map((d) => DAYS[d]).join(', ')}` : ''}</small>
        <small>Terbuka <b>${fmt(a.open)}</b> · hari ini <b>${fmt(a.today)}</b></small>
      </div>
      <div class="row" style="flex-wrap:nowrap">
        <label class="switch" title="${a.on_duty ? 'Matikan status bertugas' : 'Nyalakan status bertugas'}"><input type="checkbox" data-duty ${a.on_duty ? 'checked' : ''} aria-label="Bertugas"><i></i></label>
        <button class="btn ghost sm" data-aedit title="Ubah">${icon('edit')}</button>
        <button class="btn bad-soft sm" data-adel title="Hapus">${icon('trash')}</button>
      </div>
    </div>`).join('') : `<div class="muted">Belum ada petugas. Tambahkan nomor WhatsApp petugas CS.</div>`;
}

// ---- Tiket ---------------------------------------------------------------------------
async function loadStats(el, ctx) {
  const { data: s } = await ctx.call('GET', '/admin/cs/stats');
  $('#stOpen', el).textContent = fmt(s.open);
  $('#stWait', el).textContent = fmt(s.unassigned);
  $('#stToday', el).textContent = fmt(s.today);
  $('#stResp', el).textContent = s.avgFirstResponseMin ? `${fmt(s.avgFirstResponseMin)} mnt` : '—';
  $('#tabWait', el).textContent = s.unassigned ? `Menunggu (${s.unassigned})` : 'Menunggu';
}

async function loadTickets(el, ctx) {
  const p = new URLSearchParams({ status: st.tab });
  if (st.q) p.set('q', st.q);
  const { data } = await ctx.call('GET', `/admin/cs/tickets?${p}`);
  $('#tickets', el).innerHTML = data.length ? data.map((t) => `
    <div class="list-row ${String(t.id) === String(st.openId) ? 'tree-row on' : ''}" data-tid="${t.id}" style="grid-template-columns:46px minmax(0,1fr) auto;cursor:pointer;padding-left:6px;padding-right:6px">
      <span class="circle ${t.status === 'closed' ? 'c-ok' : t.agent_id ? 'c-info' : 'c-warn'}">${icon('chat')}</span>
      <div style="min-width:0">
        <b>#${t.id} ${esc(t.name || localPhone(t.phone))}</b>
        <small>${t.last_dir === 'out' ? '↩️ ' : ''}${esc((t.last_text ?? '').slice(0, 80))}</small>
        <small>${esc(t.device_name ?? '')} · ${esc(t.source || '')} · ${timeAgo(t.status === 'closed' ? t.closed_at : t.last_activity_at)}</small>
      </div>
      ${t.status === 'closed' ? chip('muted', 'Selesai') : t.agent_name ? chip('info', t.agent_name) : chip('warn', 'Menunggu')}
    </div>`).join('') : `<div class="empty">${icon('headset')}<div>${st.tab === 'closed' ? 'Belum ada chat selesai.' : 'Tidak ada chat.'}</div></div>`;
}

async function loadDetail(el, ctx, { keepReply = true } = {}) {
  const box = $('#detail', el);
  if (!st.openId) { box.classList.add('hidden'); return; }
  let t;
  try { t = (await ctx.call('GET', `/admin/cs/tickets/${st.openId}`)).data; } catch { st.openId = null; box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const draftText = keepReply ? $('#replyText', el)?.value ?? '' : '';
  $('#dTitle', el).textContent = `#${t.id} ${t.name || localPhone(t.phone)}`;
  $('#dSub', el).textContent = `${localPhone(t.phone)} · ${t.device_name ?? ''} · dibuat ${localTime(t.created_at)}${t.status === 'closed' ? ` · selesai ${localTime(t.closed_at)}` : ''}`;
  $('#thread', el).innerHTML = t.thread.map((m) => m.dir === 'note'
    ? `<div class="muted" style="text-align:center;font-size:11.5px;margin:4px 0">${esc(m.text)} · ${localTime(m.at)}</div>`
    : `<div class="sim-msg ${m.dir === 'out' ? 'me' : ''}">${waFormat(m.text)}<div style="font-size:11px;opacity:.6;margin-top:4px">${esc(m.dir === 'out' ? m.author : t.name || 'Pelanggan')} · ${localTime(m.at)}</div></div>`).join('');
  $('#thread', el).scrollTop = 1e6;
  const open = t.status === 'open';
  $('#dActions', el).innerHTML = open ? `
    <form id="replyForm" class="row" style="flex-wrap:nowrap;margin-top:10px">
      <input id="replyText" placeholder="Balas sebagai Admin…" autocomplete="off" value="${esc(draftText)}" aria-label="Balasan">
      <button class="btn grad">${icon('send')}</button>
    </form>
    <div class="row between" style="margin-top:10px">
      <div class="row">
        <select id="assignSel" style="width:auto" aria-label="Pindahkan ke petugas">
          <option value="">${t.agent_name ? `Petugas: ${esc(t.agent_name)}` : 'Belum ada petugas'}</option>
          ${st.agents.filter((a) => a.id !== t.agent_id).map((a) => `<option value="${a.id}">Pindahkan ke ${esc(a.name)}${a.onShift ? '' : ' (tidak bertugas)'}</option>`).join('')}
        </select>
      </div>
      <button class="btn bad-soft sm" id="closeTicket">${icon('check')} Tutup chat</button>
    </div>` : '<div class="muted" style="margin-top:10px">Chat ini sudah selesai. Pesan berikutnya dari pelanggan akan ditangani bot/autoreply atau menjadi chat baru.</div>';
  if (keepReply && document.activeElement?.id !== 'replyText' && draftText) $('#replyText', el).value = draftText;
}

/** Dialog tutup chat: 'notify' | 'silent' | null (batal). */
function closeDialog() {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>Tutup chat ini?</h3>
        <p>Pesan penutup: "${esc(st.settings.closeText || '(kosong)')}"</p>
        <div class="row" style="flex-wrap:wrap">
          <button class="btn ghost" data-c="">Batal</button>
          <button class="btn ghost" data-c="silent">Tutup tanpa pesan</button>
          <button class="btn grad" data-c="notify" ${st.settings.closeText ? '' : 'disabled'}>Tutup & kirim pesan</button>
        </div>
      </div>`;
    bg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (e.target === bg || b) { bg.remove(); resolve(b?.dataset.c || null); }
    });
    document.body.append(bg);
    $('[data-c=""]', bg).focus();
  });
}

// ---- Pengaturan -------------------------------------------------------------------------
function settingsHtml() {
  const s = st.settings;
  return `
    <div class="field"><span>Chat yang diteruskan ke CS</span>
      <div class="seg" id="modeSeg">
        <button type="button" data-v="handover" class="${s.mode === 'handover' ? 'on' : ''}">Hanya yang diserahkan bot</button>
        <button type="button" data-v="all" class="${s.mode === 'all' ? 'on' : ''}">+ semua yang tidak dijawab otomatis</button>
      </div>
      <span class="hint">${s.mode === 'handover'
        ? 'Chat masuk ke CS saat pelanggan memilih "Bicara dengan admin" di Chat Bot, atau AI menyerahkannya.'
        : 'Juga setiap chat pribadi yang tidak dijawab Chat Bot, Autoreply, maupun AI.'}</span>
    </div>
    <label class="field"><span>Pesan ke pelanggan saat diteruskan <span class="hint">— [Nama], [CS]; kosong = tidak ada</span></span><textarea data-cs="greetText" style="min-height:60px">${esc(s.greetText)}</textarea></label>
    <label class="field"><span>Pesan saat tidak ada petugas bertugas</span><textarea data-cs="offlineText" style="min-height:60px">${esc(s.offlineText)}</textarea></label>
    <label class="field"><span>Pesan penutup (saat chat ditutup petugas)</span><textarea data-cs="closeText" style="min-height:50px">${esc(s.closeText)}</textarea></label>
    <label class="field"><span>Tutup otomatis setelah tidak ada aktivitas (jam) <span class="hint">— 0 = tidak</span></span><input type="number" min="0" data-cs="autoCloseHours" value="${s.autoCloseHours}"></label>
    <div class="row between"><span class="muted" id="setState"></span><button class="btn grad sm" id="saveSet">${icon('check')} Simpan</button></div>`;
}

export default {
  async mount(el, ctx) {
    await ctx.loadDevices();
    st.settings = (await ctx.call('GET', '/admin/cs/settings')).data;
    el.innerHTML = `
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:24px">
      <div class="card stat" style="min-height:0;padding-bottom:18px"><div class="k">Chat terbuka</div><div class="v" id="stOpen">0</div></div>
      <div class="card stat" style="min-height:0;padding-bottom:18px"><div class="k">Menunggu petugas</div><div class="v c-warn" id="stWait">0</div></div>
      <div class="card stat" style="min-height:0;padding-bottom:18px"><div class="k">Chat baru hari ini</div><div class="v" id="stToday">0</div></div>
      <div class="card stat" style="min-height:0;padding-bottom:18px"><div class="k">Rata-rata respons pertama (7 hari)</div><div class="v" id="stResp">—</div></div>
    </div>
    <div class="grid g-dash">
      <div class="stack">
        <div class="card">
          <div class="card-head" style="margin-bottom:12px"><div><h3>Chat</h3></div></div>
          <div class="toolbar">
            <div class="seg" id="tabs">
              <button data-tab="open" class="on">Terbuka</button><button data-tab="unassigned" id="tabWait">Menunggu</button><button data-tab="closed">Selesai</button>
            </div>
            <div class="search">${icon('search')}<input id="tq" placeholder="Cari nama, nomor, atau #id" aria-label="Cari chat"></div>
          </div>
          <div id="tickets"></div>
        </div>
        <div class="card hidden" id="detail">
          <div class="card-head">
            <div><h3 id="dTitle"></h3><p id="dSub"></p></div>
            <button class="btn ghost sm" id="dClose">${icon('x')}</button>
          </div>
          <div id="thread" class="sim-log" style="height:380px"></div>
          <div id="dActions"></div>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h3>Petugas CS</h3><p>Dibagi bergiliran ke yang bertugas & paling sedikit chat</p></div>
            <button class="btn soft sm" id="addAgent">${icon('plus')} Petugas</button></div>
          <div id="agents"></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Cara petugas membalas</h3><p>Langsung dari WhatsApp pribadi, tanpa dashboard</p></div></div>
          <ul class="muted" style="margin:0;padding-left:18px;line-height:1.85">
            <li>Notifikasi chat baru dikirim dari nomor sekolah ke WA petugas.</li>
            <li><b>Balas (kutip) notifikasinya</b>, maka pesan diteruskan ke pelanggan dari nomor sekolah. Nomor petugas tidak terlihat.</li>
            <li>Kalau hanya punya 1 chat terbuka, cukup ketik balasan biasa.</li>
            <li><code>#12 teks</code> balas chat #12 · <code>#selesai 12</code> tutup · <code>#ambil 12</code> ambil chat menunggu · <code>#list</code> · <code>#off</code> / <code>#on</code></li>
            <li>Saat ini hanya <b>teks</b> yang diteruskan (gambar/dokumen belum).</li>
          </ul>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Pengaturan</h3></div></div>
          <div id="settings">${settingsHtml()}</div>
        </div>
      </div>
    </div>`;

    $('#tabs', el).addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      st.tab = b.dataset.tab;
      $$('#tabs button', el).forEach((x) => x.classList.toggle('on', x === b));
      loadTickets(el, ctx);
    });
    let tmr;
    $('#tq', el).addEventListener('input', (e) => { clearTimeout(tmr); tmr = setTimeout(() => { st.q = e.target.value.trim(); loadTickets(el, ctx); }, 250); });
    $('#tickets', el).addEventListener('click', (e) => {
      const r = e.target.closest('[data-tid]');
      if (!r) return;
      st.openId = r.dataset.tid;
      loadTickets(el, ctx);
      loadDetail(el, ctx, { keepReply: false }).then(() => $('#detail', el).scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    });
    $('#dClose', el).addEventListener('click', () => { st.openId = null; $('#detail', el).classList.add('hidden'); loadTickets(el, ctx); });

    el.addEventListener('submit', async (e) => {
      if (e.target.id !== 'replyForm') return;
      e.preventDefault();
      const text = $('#replyText', el).value.trim();
      if (!text) return;
      try {
        await ctx.call('POST', `/admin/cs/tickets/${st.openId}/reply`, { text });
        $('#replyText', el).value = '';
        await loadDetail(el, ctx, { keepReply: false });
      } catch (err) { ctx.toast(err.message); }
    });
    el.addEventListener('change', async (e) => {
      const t = e.target;
      try {
        if (t.id === 'assignSel' && t.value) {
          await ctx.call('POST', `/admin/cs/tickets/${st.openId}/assign`, { agentId: Number(t.value) });
          ctx.toast('Chat dipindahkan');
          await Promise.all([loadDetail(el, ctx), loadTickets(el, ctx), loadAgents(el, ctx)]);
        }
        if (t.matches('[data-duty]')) {
          const id = t.closest('[data-aid]').dataset.aid;
          await ctx.call('PATCH', `/admin/cs/agents/${id}/duty`, { on: t.checked });
          await Promise.all([loadAgents(el, ctx), loadStats(el, ctx), loadTickets(el, ctx)]);
        }
      } catch (err) { ctx.toast(err.message); }
    });
    el.addEventListener('click', async (e) => {
      const t = e.target;
      try {
        if (t.closest('#closeTicket')) {
          const choice = await closeDialog();
          if (!choice) return;
          await ctx.call('POST', `/admin/cs/tickets/${st.openId}/close`, { notify: choice === 'notify' });
          ctx.toast('Chat ditutup');
          return Promise.all([loadDetail(el, ctx), loadTickets(el, ctx), loadStats(el, ctx), loadAgents(el, ctx)]);
        }
        if (t.closest('#addAgent')) {
          if (await agentDialog(ctx)) { ctx.toast('Petugas ditambahkan'); await Promise.all([loadAgents(el, ctx), loadStats(el, ctx), loadTickets(el, ctx)]); }
          return;
        }
        const row = t.closest('[data-aid]');
        if (row) {
          const a = st.agents.find((x) => String(x.id) === row.dataset.aid);
          if (t.closest('[data-aedit]')) { if (await agentDialog(ctx, a)) { ctx.toast('Tersimpan'); await loadAgents(el, ctx); } return; }
          if (t.closest('[data-adel]')) {
            if (!(await confirmBox(`Hapus petugas ${a.name}?`, `${a.open ? `${a.open} chat terbukanya akan dibagikan ke petugas lain.` : ''}`, { danger: true, okText: 'Hapus' }))) return;
            await ctx.call('DELETE', `/admin/cs/agents/${a.id}`);
            return Promise.all([loadAgents(el, ctx), loadStats(el, ctx), loadTickets(el, ctx)]);
          }
        }
        const seg = t.closest('#modeSeg [data-v]');
        if (seg) {
          st.settings.mode = seg.dataset.v;
          $('#settings', el).innerHTML = settingsHtml();
          $('#setState', el).textContent = 'Belum disimpan';
          return;
        }
        if (t.closest('#saveSet')) {
          const body = { mode: st.settings.mode };
          for (const i of $$('[data-cs]', el)) body[i.dataset.cs] = i.type === 'number' ? Number(i.value) : i.value;
          st.settings = (await ctx.call('PUT', '/admin/cs/settings', body)).data;
          $('#setState', el).textContent = 'Tersimpan';
        }
      } catch (err) { ctx.toast(err.message); }
    });
    el.addEventListener('input', (e) => { if (e.target.dataset.cs) $('#setState', el).textContent = 'Belum disimpan'; });

    await Promise.all([loadStats(el, ctx), loadAgents(el, ctx), loadTickets(el, ctx)]);
  },
  async refresh(el, ctx) {
    if (document.querySelector('.modal-bg')) return;
    await Promise.all([loadStats(el, ctx), loadTickets(el, ctx)]);
    if (st.openId && document.activeElement?.id !== 'replyText' && document.activeElement?.id !== 'assignSel') await loadDetail(el, ctx);
  },
  unmount() { st.openId = null; },
};
