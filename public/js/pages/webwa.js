import { $, confirmBox, esc, icon } from '../ui.js';

const st = { device: '', groups: false, q: '', open: null, chats: [], thread: null, sending: false, lastCount: 0 };

const localPhone = (p) => (p && /^\d+$/.test(p) ? (p.startsWith('62') ? '0' + p.slice(2) : '+' + p) : '');
const toDate = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z') : null);
const hhmm = (d) => d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
function shortWhen(s) {
  const d = toDate(s);
  if (!d) return '';
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return hhmm(d);
  const y = new Date(today.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}
function dayLabel(d) {
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Hari ini';
  if (d.toDateString() === new Date(today.getTime() - 86400000).toDateString()) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
const waFormat = (s) => esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>').replace(/~([^~\n]+)~/g, '<s>$1</s>');
const nameOf = (c) => c.contact_name || c.push_name || localPhone(c.phone ?? c.k) || (String(c.k).endsWith('@g.us') ? 'Grup' : 'Nomor tersembunyi');
// Inisial dari huruf saja; nama berupa nomor -> ikon orang
const initials = (n) => String(n).trim().split(/\s+/).map((w) => w[0]).filter((x) => /\p{L}/u.test(x ?? '')).slice(0, 2).join('').toUpperCase() || '👤';
const VIA = { reply: '', manual: 'Dashboard', api: 'API / Form', birthday: 'Ulang Tahun', blast: 'Blast', hp: 'Dari HP' };
const TICK = { sent: '✓✓', pending: '🕓', failed: '⚠️' };

// ---- Daftar chat -------------------------------------------------------------------------
async function loadChats(el, ctx) {
  const p = new URLSearchParams();
  if (st.device) p.set('device', st.device);
  if (st.groups) p.set('groups', '1');
  if (st.q) p.set('q', st.q);
  const res = await ctx.call('GET', `/admin/webwa/chats?${p}`);
  st.chats = res.data;
  $('#waList', el).innerHTML = st.chats.length ? st.chats.map((c) => {
    const n = nameOf(c);
    const on = st.open && st.open.device === c.device_id && st.open.key === c.k;
    return `<div class="wa-item ${on ? 'on' : ''}" data-dev="${esc(c.device_id)}" data-key="${esc(c.k)}">
      <span class="wa-av">${esc(initials(n))}</span>
      <div class="mid"><b>${esc(n)}</b><small>${c.last_dir === 'out' ? '↩ ' : ''}${esc((c.last_body ?? '').replace(/\n/g, ' ').slice(0, 70))}</small></div>
      <div class="end"><span>${shortWhen(c.last_at)}</span>
        ${c.unread && !on ? `<span class="wa-badge">${c.unread}</span>` : c.takeover_until ? '<span title="Bot diam (diambil alih)">🧑‍💼</span>' : ''}</div>
    </div>`;
  }).join('') : `<div class="wa-empty">${st.q ? 'Tidak ada chat yang cocok.' : 'Belum ada percakapan.'}</div>`;
}

// ---- Percakapan ---------------------------------------------------------------------------
function renderThread(el, keepScroll) {
  const t = st.thread;
  const box = $('#waMsgs', el);
  const nearBottom = !keepScroll || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  let lastDay = '';
  box.innerHTML = t.items.length ? t.items.map((m) => {
    const d = toDate(m.at) ?? new Date();
    const day = d.toDateString();
    const sep = day !== lastDay ? `<div class="wa-day">${dayLabel(d)}</div>` : '';
    lastDay = day;
    const via = m.dir === 'out' ? VIA[m.via] ?? '' : (m.via ?? '');
    return `${sep}<div class="wa-msg ${m.dir === 'out' ? 'out' : ''}">${via ? `<div class="via">${esc(via)}</div>` : ''}${waFormat(m.body)}
      <div class="meta">${hhmm(d)}${m.dir === 'out' ? ` <span title="${esc(m.status ?? '')}">${TICK[m.status] ?? ''}</span>` : ''}</div></div>`;
  }).join('') : '<div class="wa-empty">Belum ada pesan. Tulis pesan pertama di bawah.</div>';
  if (nearBottom) box.scrollTop = box.scrollHeight;
}

function renderHead(el, ctx) {
  const t = st.thread;
  const c = st.chats.find((x) => x.device_id === st.open.device && x.k === st.open.key) ?? { k: st.open.key, phone: /^\d+$/.test(st.open.key) ? st.open.key : null };
  const name = t.contact?.name || nameOf(c);
  const dev = ctx.state.devices.find((d) => d.id === st.open.device);
  const fields = t.contact ? Object.entries(t.contact.fields).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ') : '';
  $('#waHead', el).innerHTML = `
    <button class="btn ghost sm" id="waBack" title="Kembali" style="display:none">${icon('up')}</button>
    <span class="wa-av">${esc(initials(name))}</span>
    <div class="who"><b>${esc(name)}</b><small>${esc(localPhone(c.phone ?? st.open.key) || 'Nomor tersembunyi')} · via ${esc(dev?.name ?? '')}${fields ? ` · ${esc(fields)}` : ''}</small></div>
    ${t.takeoverUntil
      ? `<button class="btn soft sm" id="waRelease" title="Bot aktif lagi untuk chat ini">${icon('bot')} Bot diam s/d ${hhmm(toDate(t.takeoverUntil))} · Lepas</button>`
      : `<button class="btn ghost sm" id="waTake" title="Hentikan bot untuk chat ini">${icon('pause')} Ambil alih</button>`}`;
  const banner = $('#waBanner', el);
  if (t.ticket) {
    banner.className = 'wa-banner';
    banner.innerHTML = `🎧 Sedang ditangani Customer Service${t.ticket.agent_name ? ` oleh <b>${esc(t.ticket.agent_name)}</b>` : ' (menunggu petugas)'} · chat #${t.ticket.id}. Balasan Anda ikut tercatat di tiket dan diteruskan ke petugas.`;
    banner.classList.remove('hidden');
  } else if (t.takeoverUntil) {
    banner.className = 'wa-banner info';
    banner.innerHTML = `Bot (Chat Bot, Autoreply, AI) diam untuk chat ini sampai ${hhmm(toDate(t.takeoverUntil))} karena sedang dibalas manual.`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
  if (window.matchMedia('(max-width: 900px)').matches) $('#waBack', el).style.display = '';
}

async function loadThread(el, ctx, { keepScroll = false } = {}) {
  if (!st.open) return;
  const p = new URLSearchParams({ device: st.open.device, key: st.open.key });
  const { data } = await ctx.call('GET', `/admin/webwa/thread?${p}`);
  const changed = !st.thread || data.items.length !== st.lastCount || data.takeoverUntil !== st.thread.takeoverUntil || JSON.stringify(data.ticket) !== JSON.stringify(st.thread.ticket)
    || data.items.some((m, i) => m.status !== st.thread.items[i]?.status);
  st.thread = data;
  st.lastCount = data.items.length;
  if (!changed && keepScroll) return;
  renderHead(el, ctx);
  renderThread(el, keepScroll);
}

async function openChat(el, ctx, device, key) {
  st.open = { device, key };
  st.thread = null;
  $('#waShell', el).classList.add('open');
  $('#waEmpty', el).classList.add('hidden');
  $('#waChat', el).classList.remove('hidden');
  await loadThread(el, ctx);
  loadChats(el, ctx);
  $('#waText', el).focus();
}

async function send(el, ctx) {
  const ta = $('#waText', el);
  const text = ta.value.trim();
  if (!text || st.sending || !st.open) return;
  st.sending = true;
  try {
    const res = await ctx.call('POST', '/admin/webwa/send', { device: st.open.device, key: st.open.key, text });
    if (res.data.viaTicket) await ctx.call('POST', `/admin/cs/tickets/${res.data.viaTicket}/reply`, { text });
    ta.value = '';
    ta.style.height = '';
    await loadThread(el, ctx);
    loadChats(el, ctx);
  } catch (err) {
    ctx.toast(err.message);
  } finally {
    st.sending = false;
  }
}

function newChatDialog(el, ctx) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <form class="modal">
      <h3>Chat baru</h3>
      <label class="field"><span>Kirim dari device</span>
        <select name="device">${ctx.state.devices.map((d) => `<option value="${d.id}" ${d.id === st.device ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Nomor WhatsApp</span><input name="phone" placeholder="0812xxxxxxxx" required></label>
      <p>Pesan ke nomor yang belum pernah chat dihitung sebagai pesan yang kita mulai (ikut kuota anti-banned).</p>
      <div class="row"><button type="button" class="btn ghost" data-x>Batal</button><button class="btn grad">Buka chat</button></div>
    </form>`;
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-x]')) bg.remove(); });
  $('form', bg).addEventListener('submit', (e) => {
    e.preventDefault();
    let n = e.target.phone.value.replace(/\D/g, '');
    if (n.startsWith('0')) n = '62' + n.slice(1);
    else if (n.startsWith('8')) n = '62' + n;
    if (n.length < 9) return ctx.toast('Nomor tidak valid');
    bg.remove();
    openChat(el, ctx, e.target.device.value, n);
  });
  document.body.append(bg);
  $('input[name=phone]', bg).focus();
}

export default {
  async mount(el, ctx) {
    await ctx.loadDevices();
    el.innerHTML = `
    <div class="card wa-shell" id="waShell">
      <aside class="wa-side">
        <div class="wa-side-head">
          <div class="row" style="flex-wrap:nowrap">
            <select id="waDevice" aria-label="Device">
              <option value="">Semua device</option>
              ${ctx.state.devices.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
            </select>
            <button class="btn grad sm" id="waNew" title="Chat baru">${icon('plus')}</button>
          </div>
          <div class="search" style="position:relative">${icon('search')}<input id="waQ" placeholder="Cari nama, nomor, atau pesan" style="padding-left:40px" aria-label="Cari chat"></div>
          <div class="seg" id="waTabs" style="justify-self:start"><button data-g="0" class="on">Pribadi</button><button data-g="1">Grup</button></div>
        </div>
        <div class="wa-list" id="waList"></div>
      </aside>
      <section class="wa-main">
        <div class="wa-empty" id="waEmpty">${icon('chat')}<div style="margin-top:8px">Pilih percakapan di kiri, atau klik <b>+</b> untuk chat baru.</div></div>
        <div id="waChat" class="hidden" style="display:flex;flex-direction:column;flex:1;min-height:0">
          <div class="wa-head" id="waHead"></div>
          <div class="wa-banner hidden" id="waBanner"></div>
          <div class="wa-msgs" id="waMsgs"></div>
          <form class="wa-input" id="waForm">
            <textarea id="waText" rows="1" placeholder="Tulis pesan… (Enter kirim, Shift+Enter baris baru)" aria-label="Pesan"></textarea>
            <button class="btn grad" aria-label="Kirim">${icon('send')}</button>
          </form>
        </div>
      </section>
    </div>`;
    $('.search .svg-icon', el).style.cssText = 'position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--muted);width:18px;height:18px';

    $('#waDevice', el).value = st.device;
    $('#waQ', el).value = st.q;
    $('#waDevice', el).addEventListener('change', (e) => { st.device = e.target.value; loadChats(el, ctx); });
    let tmr;
    $('#waQ', el).addEventListener('input', (e) => { clearTimeout(tmr); tmr = setTimeout(() => { st.q = e.target.value.trim(); loadChats(el, ctx); }, 250); });
    $('#waTabs', el).addEventListener('click', (e) => {
      const b = e.target.closest('[data-g]');
      if (!b) return;
      st.groups = b.dataset.g === '1';
      el.querySelectorAll('#waTabs button').forEach((x) => x.classList.toggle('on', x === b));
      loadChats(el, ctx);
    });
    $('#waList', el).addEventListener('click', (e) => {
      const it = e.target.closest('[data-key]');
      if (it) openChat(el, ctx, it.dataset.dev, it.dataset.key);
    });
    $('#waNew', el).addEventListener('click', () => newChatDialog(el, ctx));
    $('#waForm', el).addEventListener('submit', (e) => { e.preventDefault(); send(el, ctx); });
    $('#waText', el).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(el, ctx); }
    });
    $('#waText', el).addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`; });
    el.addEventListener('click', async (e) => {
      try {
        if (e.target.closest('#waBack')) {
          st.open = null;
          $('#waShell', el).classList.remove('open');
          return loadChats(el, ctx);
        }
        if (e.target.closest('#waTake')) {
          await ctx.call('POST', '/admin/webwa/takeover', { device: st.open.device, key: st.open.key, minutes: st.thread.takeoverMinutes || 60 });
          ctx.toast('Bot diam untuk chat ini');
          return loadThread(el, ctx, { keepScroll: true }).then(() => { st.thread.takeoverUntil = st.thread.takeoverUntil ?? null; renderHead(el, ctx); });
        }
        if (e.target.closest('#waRelease')) {
          if (!(await confirmBox('Aktifkan bot lagi untuk chat ini?', 'Chat Bot, Autoreply, dan AI akan kembali menjawab pesan berikutnya dari orang ini.', { okText: 'Aktifkan bot' }))) return;
          await ctx.call('POST', '/admin/webwa/takeover', { device: st.open.device, key: st.open.key, minutes: 0 });
          return loadThread(el, ctx).then(() => renderHead(el, ctx));
        }
      } catch (err) { ctx.toast(err.message); }
    });

    await loadChats(el, ctx);
    if (st.open) await openChat(el, ctx, st.open.device, st.open.key);
  },
  async refresh(el, ctx) {
    if (document.querySelector('.modal-bg')) return;
    await loadChats(el, ctx);
    if (st.open) await loadThread(el, ctx, { keepScroll: true });
  },
  unmount() { st.thread = null; },
};
