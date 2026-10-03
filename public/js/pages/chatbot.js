import { $, $$, chip, confirmBox, esc, fmt, icon, localTime, promptBox } from '../ui.js';

let bots = [];
let current = null; // bot dari server (+ visits, handovers)
let draft = null; // { name, config }
let selected = 'root';
let dirty = false;
let sim = { node: null, log: [] };
let ctxRef = null;

const nid = () => Math.random().toString(16).slice(2, 10);
const kids = (id) => draft.config.nodes.filter((n) => n.parent === id);
const node = (id) => draft.config.nodes.find((n) => n.id === id);

// Pratinjau teks node (placeholder dibiarkan apa adanya)
function nodePreview(n) {
  const ch = kids(n.id);
  let out = n.text || '';
  if (n.type !== 'handover') {
    if (ch.length) out += `\n\n${ch.map((k, i) => `*${i + 1}.* ${k.label}`).join('\n')}`;
    if (draft.config.footer) out += `\n\n_${draft.config.footer.replace(/_/g, '')}_`;
  }
  return out;
}

// Format WhatsApp sederhana (*tebal*, _miring_) untuk gelembung pratinjau/simulator
const waFormat = (s) => esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>');

// ---- Pohon menu --------------------------------------------------------------------
function treeHtml(id = 'root', depth = 0, num = '') {
  const n = node(id);
  const visits = current.visits?.[id] ?? 0;
  const ch = kids(id);
  const isRoot = id === 'root';
  const row = `
    <div class="tree-row ${selected === id ? 'on' : ''}" data-node="${id}" style="padding-left:${10 + depth * 22}px">
      <span class="tree-num">${isRoot ? icon('bot') : num}</span>
      <span class="tree-label">${isRoot ? '<b>Menu utama</b>' : esc(n.label) || '<i class="muted">(tanpa nama)</i>'}</span>
      ${n.type === 'handover' ? chip('warn', 'Ke admin') : ''}
      ${visits ? `<span class="muted" title="Dibuka 30 hari terakhir">${fmt(visits)}×</span>` : ''}
    </div>`;
  return row + ch.map((k, i) => treeHtml(k.id, depth + 1, `${num}${i + 1}.`)).join('');
}

function editorHtml() {
  const n = node(selected);
  if (!n) return '';
  const isRoot = n.id === 'root';
  const siblings = isRoot ? [] : kids(n.parent);
  const idx = siblings.findIndex((x) => x.id === n.id);
  return `
    <div class="row between" style="margin-bottom:12px">
      <b>${isRoot ? 'Menu utama (pesan pertama)' : 'Pilihan menu'}</b>
      <div class="row">
        ${isRoot ? '' : `
          <button type="button" class="btn ghost sm" data-nact="up" ${idx <= 0 ? 'disabled' : ''} title="Naikkan">${icon('up')}</button>
          <button type="button" class="btn ghost sm" data-nact="down" ${idx >= siblings.length - 1 ? 'disabled' : ''} title="Turunkan">${icon('down')}</button>
          <button type="button" class="btn bad-soft sm" data-nact="delete" title="Hapus beserta sub-pilihannya">${icon('trash')}</button>`}
      </div>
    </div>
    ${isRoot ? '' : `
      <label class="field"><span>Nama pilihan <span class="hint">— tampil sebagai nomor di menu induknya</span></span>
        <input data-n="label" value="${esc(n.label)}" placeholder="mis. Info PPDB"></label>
      <div class="field"><span>Jenis</span>
        <div class="seg" data-ntype><button type="button" data-v="menu" class="${n.type === 'menu' ? 'on' : ''}">Info / sub-menu</button><button type="button" data-v="handover" class="${n.type === 'handover' ? 'on' : ''}">Serahkan ke admin</button></div>
        <span class="hint">${n.type === 'handover'
          ? `Mengirim pesan ini, lalu bot (dan Autoreply) diam untuk chat ini selama ${draft.config.handoverHours} jam supaya admin bisa membalas manual.`
          : 'Mengirim pesan ini. Kalau punya sub-pilihan, daftarnya ikut ditampilkan.'}</span>
      </div>`}
    <label class="field"><span>Pesan</span>
      <textarea data-n="text" style="min-height:120px">${esc(n.text)}</textarea>
      <span class="hint"><b>[Nama]</b> nama pengirim/kontak, <b>[Nomor]</b>, kolom Kontak; <b>{Halo|Hai}</b> variasi; <b>*tebal*</b> <b>_miring_</b>.</span>
    </label>
    ${n.type === 'handover' ? '' : `<button type="button" class="btn soft sm" data-nact="add">${icon('plus')} Tambah sub-pilihan</button>`}
    <div class="label" style="margin:16px 0 6px">Pratinjau pesan</div>
    <div class="bubble" style="background:var(--surface-2);color:var(--text)">${waFormat(nodePreview(n))}</div>`;
}

function renderTree(el) {
  $('#tree', el).innerHTML = treeHtml();
  $('#nodeEditor', el).innerHTML = editorHtml();
}

// ---- Simulator ------------------------------------------------------------------------
function renderSim(el) {
  $('#simLog', el).innerHTML = sim.log.length
    ? sim.log.map((m) => `<div class="sim-msg ${m.me ? 'me' : ''}">${waFormat(m.text)}</div>`).join('')
    : `<div class="muted" style="text-align:center;padding:30px 10px">Ketik kata pemicu, mis. <b>menu</b>, untuk mulai.</div>`;
  $('#simLog', el).scrollTop = 1e6;
  $('#simState', el).textContent = sim.node ? `Posisi: ${sim.node === 'root' ? 'Menu utama' : node(sim.node)?.label ?? '-'}` : 'Belum ada sesi';
}

async function simSend(el, text) {
  sim.log.push({ me: true, text });
  try {
    const { data } = await ctxRef.call('POST', `/admin/chatbots/${current.id}/simulate`, { config: draft.config, node: sim.node, text, name: 'Budi' });
    if (!data.handled) sim.log.push({ text: '(bot tidak membalas: bukan kata pemicu & tidak ada sesi)' });
    for (const r of data.replies) sim.log.push({ text: r });
    if (data.handover) sim.log.push({ text: `(bot diam ${draft.config.handoverHours} jam untuk chat ini; admin membalas manual)` });
    sim.node = data.node;
  } catch (err) {
    sim.log.push({ text: `⚠️ ${err.message}` });
  }
  renderSim(el);
}

// ---- Halaman ---------------------------------------------------------------------------
function settingsHtml(ctx) {
  const c = draft.config;
  return `
    <label class="field"><span>Kata pemicu <span class="hint">— satu per baris; pesan yang sama atau diawali kata ini memulai bot</span></span>
      <textarea data-c="triggers" style="min-height:80px">${esc(c.triggers)}</textarea></label>
    <label class="row" style="flex-wrap:nowrap;cursor:pointer;font-weight:500;margin-bottom:14px">
      <input type="checkbox" data-c="startOnAny" ${c.startOnAny ? 'checked' : ''}> Mulai untuk <b>semua</b> chat baru (tanpa kata pemicu)
    </label>
    <div class="field"><span>Device <span class="hint">— tidak dipilih = semua device</span></span>
      <div class="row">${ctx.state.devices.map((d) => `
        <label class="check"><input type="checkbox" data-dev value="${d.id}" ${c.deviceIds.includes(d.id) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('')}</div></div>
    <div class="grid g-2" style="gap:12px">
      <label class="field"><span>Sesi berakhir setelah diam (menit)</span><input type="number" min="1" data-c="timeoutMin" value="${c.timeoutMin}"></label>
      <label class="field"><span>Bot diam setelah serah ke admin (jam)</span><input type="number" min="0" data-c="handoverHours" value="${c.handoverHours}"></label>
    </div>
    <label class="field"><span>Petunjuk di bawah menu</span><input data-c="footer" value="${esc(c.footer)}"></label>
    <label class="field"><span>Pesan pilihan tidak dikenali</span><input data-c="fallback" value="${esc(c.fallback)}"></label>
    <label class="field"><span>Pesan saat pengguna mengetik "selesai"</span><textarea data-c="endText" style="min-height:60px">${esc(c.endText)}</textarea></label>`;
}

function render(el, ctx) {
  if (!bots.length) {
    el.innerHTML = `
      <div class="card empty">${icon('bot')}
        <div style="font-weight:600;color:var(--text);margin-bottom:4px">Belum ada Chat Bot</div>
        <div style="margin-bottom:16px">Bot menu bernomor: pengirim membalas angka untuk melihat info PPDB, jadwal, lokasi, atau minta bicara dengan admin.<br>Bot baru berisi contoh menu sekolah yang bisa langsung diubah.</div>
        <button class="btn grad" id="newBot">Buat bot</button>
      </div>`;
    return;
  }
  const b = bots.find((x) => x.id === current.id) ?? {};
  el.innerHTML = `
    <div class="section-title">
      <div class="row">
        ${bots.length > 1 ? `<div class="seg">${bots.map((x) => `<button data-bid="${x.id}" class="${x.id === current.id ? 'on' : ''}">${esc(x.name)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="row">
        <button class="btn ghost" id="newBot">${icon('plus')} Bot lain</button>
        <button class="btn bad-soft" id="delBot" title="Hapus bot">${icon('trash')}</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:24px">
      <div class="row between">
        <div class="row" style="gap:14px;min-width:0">
          <div class="device-ico ${current.active ? 'on' : ''}">${icon('bot')}</div>
          <div style="min-width:0">
            <input data-c="__name" value="${esc(draft.name)}" style="font-weight:600;font-size:16px;padding:6px 10px;max-width:280px" aria-label="Nama bot">
            <div class="muted" style="margin-top:4px">${current.active ? 'Aktif — membalas chat pribadi yang cocok' : 'Nonaktif — coba dulu di simulator, lalu aktifkan'}</div>
          </div>
        </div>
        <div class="row" style="gap:22px">
          <div class="mini-stats" style="display:flex;margin:0;gap:10px">
            <div><b>${fmt(b.today ?? 0)}</b><small>Menu dibuka hari ini</small></div>
            <div><b>${fmt(b.sessions ?? 0)}</b><small>Sesi aktif</small></div>
            <div><b class="${b.handovers ? 'c-warn' : ''}">${fmt(b.handovers ?? 0)}</b><small>Menunggu admin</small></div>
          </div>
          <label class="switch" title="${current.active ? 'Nonaktifkan bot' : 'Aktifkan bot'}"><input type="checkbox" id="botActive" ${current.active ? 'checked' : ''} aria-label="Bot aktif"><i></i></label>
        </div>
      </div>
    </div>

    <div class="grid g-dash">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h3>Menu</h3><p>Klik untuk mengubah. Angka di kanan = berapa kali dibuka (30 hari).</p></div></div>
          <div id="tree" class="tree"></div>
          <div class="preview" id="nodeEditor" style="margin-top:16px"></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Pengaturan</h3></div></div>
          ${settingsHtml(ctx)}
        </div>
        <div class="card save-bar">
          <div class="row between">
            <span class="muted" id="saveState">${dirty ? 'Ada perubahan yang belum disimpan' : 'Semua perubahan tersimpan'}</span>
            <button class="btn grad" id="saveBot">${icon('check')} Simpan</button>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head">
            <div><h3>Simulator</h3><p id="simState"></p></div>
            <button class="btn ghost sm" id="simReset">${icon('refresh')} Ulang</button>
          </div>
          <div id="simLog" class="sim-log"></div>
          <form id="simForm" class="row" style="flex-wrap:nowrap;margin-top:10px">
            <input name="t" placeholder="Ketik pesan, mis. menu / 1 / 0 / #" autocomplete="off" aria-label="Pesan simulator">
            <button class="btn grad">${icon('send')}</button>
          </form>
          <div class="muted" style="margin-top:8px">Simulator memakai pengaturan yang sedang diedit (belum perlu disimpan) dan tidak mengirim apa pun.</div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Menunggu Admin</h3><p>Chat yang memilih "bicara dengan admin"; bot diam sampai waktu habis</p></div></div>
          ${current.handovers?.length ? current.handovers.map((h) => `
            <div class="list-row" style="grid-template-columns:minmax(0,1fr) auto">
              <div><b>${esc(h.chat_jid.endsWith('@s.whatsapp.net') ? '0' + h.chat_jid.split('@')[0].replace(/^62/, '') : 'Nomor tersembunyi')}</b>
                <small>${esc(h.device_name ?? '')} · bot aktif lagi ${localTime(h.paused_until)}</small></div>
              <button class="btn soft sm" data-resume="${esc(h.chat_jid)}" title="Aktifkan bot lagi untuk chat ini">${icon('play')} Bot aktif</button>
            </div>`).join('') : '<div class="muted">Tidak ada.</div>'}
          ${ctx.isOn('inbox') ? '<a class="btn ghost sm" href="#/inbox" style="margin-top:12px">' + icon('inbox') + ' Buka Pesan Masuk</a>' : ''}
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Cara kerja</h3></div></div>
          <ul class="muted" style="margin:0;padding-left:18px;line-height:1.8">
            <li>Hanya chat pribadi. Saat bot menangani chat, Autoreply tidak ikut membalas.</li>
            <li>Pengguna membalas <b>angka</b> atau <b>nama pilihan</b>; <b>0</b> kembali, <b>#</b> menu utama, <b>selesai</b> mengakhiri.</li>
            <li>Sesi berakhir otomatis setelah ${draft.config.timeoutMin} menit tanpa balasan.</li>
            <li>Pesan yang masuk saat server mati (lebih dari 10 menit lalu) tidak dibalas.</li>
          </ul>
        </div>
      </div>
    </div>`;
  renderTree(el);
  renderSim(el);
}

function markDirty(el) {
  dirty = true;
  $('#saveState', el).textContent = 'Ada perubahan yang belum disimpan';
}

async function loadList(ctx) {
  bots = (await ctx.call('GET', '/admin/chatbots')).data;
}

async function open(el, ctx, id) {
  current = (await ctx.call('GET', `/admin/chatbots/${id}`)).data;
  draft = { name: current.name, config: JSON.parse(JSON.stringify(current.config)) };
  selected = 'root';
  dirty = false;
  sim = { node: null, log: [] };
  render(el, ctx);
}

function removeSubtree(id) {
  for (const k of kids(id)) removeSubtree(k.id);
  draft.config.nodes = draft.config.nodes.filter((n) => n.id !== id);
}

function bind(el, ctx) {
  el.addEventListener('click', async (e) => {
    const t = e.target;
    try {
      if (t.closest('#newBot')) {
        const name = await promptBox('Chat Bot baru', bots.length ? '' : 'Bot Informasi Sekolah', 'Bot baru berisi contoh menu sekolah yang bisa langsung diubah.');
        if (!name) return;
        const { data } = await ctx.call('POST', '/admin/chatbots', { name });
        await loadList(ctx);
        return open(el, ctx, data.id);
      }
      if (t.closest('#delBot')) {
        if (!(await confirmBox(`Hapus bot "${current.name}"?`, 'Menu, sesi, dan statistiknya ikut terhapus.', { danger: true, okText: 'Hapus' }))) return;
        await ctx.call('DELETE', `/admin/chatbots/${current.id}`);
        await loadList(ctx);
        if (bots.length) return open(el, ctx, bots[0].id);
        current = null;
        return render(el, ctx);
      }
      const pickBot = t.closest('[data-bid]');
      if (pickBot) {
        if (dirty && !(await confirmBox('Buang perubahan?', 'Ada perubahan yang belum disimpan.', { okText: 'Buang' }))) return;
        return open(el, ctx, Number(pickBot.dataset.bid));
      }
      if (t.closest('#saveBot')) {
        const { data } = await ctx.call('PUT', `/admin/chatbots/${current.id}`, { name: draft.name, config: draft.config });
        current = { ...current, ...data };
        dirty = false;
        $('#saveState', el).textContent = 'Tersimpan';
        await loadList(ctx);
        return;
      }
      const resume = t.closest('[data-resume]');
      if (resume) {
        await ctx.call('POST', `/admin/chatbots/${current.id}/resume`, { chatJid: resume.dataset.resume });
        await loadList(ctx);
        return open(el, ctx, current.id);
      }
      if (t.closest('#simReset')) {
        sim = { node: null, log: [] };
        return renderSim(el);
      }
      const row = t.closest('[data-node]');
      if (row) {
        selected = row.dataset.node;
        return renderTree(el);
      }
      const nact = t.closest('[data-nact]')?.dataset.nact;
      if (nact) {
        const n = node(selected);
        if (nact === 'add') {
          if (kids(n.id).length >= 9) return ctx.toast('Maksimal 9 pilihan per menu');
          const id = nid();
          draft.config.nodes.push({ id, parent: n.id, label: 'Pilihan baru', type: 'menu', text: '' });
          selected = id;
        } else if (nact === 'delete') {
          const count = (function count(id) { return kids(id).reduce((s, k) => s + 1 + count(k.id), 0); })(n.id);
          if (!(await confirmBox(`Hapus "${n.label}"?`, count ? `${count} sub-pilihan di bawahnya ikut terhapus.` : '', { danger: true, okText: 'Hapus' }))) return;
          selected = n.parent;
          removeSubtree(n.id);
        } else if (nact === 'up' || nact === 'down') {
          const sib = kids(n.parent);
          const i = sib.findIndex((x) => x.id === n.id);
          const j = nact === 'up' ? i - 1 : i + 1;
          const all = draft.config.nodes;
          const a = all.indexOf(sib[i]);
          const b = all.indexOf(sib[j]);
          [all[a], all[b]] = [all[b], all[a]];
        }
        renderTree(el);
        return markDirty(el);
      }
      const ntype = t.closest('[data-ntype] [data-v]');
      if (ntype) {
        const n = node(selected);
        if (ntype.dataset.v === 'handover' && kids(n.id).length) return ctx.toast('Hapus sub-pilihannya dulu sebelum menjadikan "Serahkan ke admin"');
        n.type = ntype.dataset.v;
        renderTree(el);
        return markDirty(el);
      }
    } catch (err) { ctx.toast(err.message); }
  });

  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.n) {
      node(selected)[t.dataset.n] = t.value;
      // Perbarui pohon & pratinjau tanpa menghilangkan fokus input
      $('#tree', el).innerHTML = treeHtml();
      const prev = $('#nodeEditor .bubble', el);
      if (prev) prev.innerHTML = waFormat(nodePreview(node(selected)));
      return markDirty(el);
    }
    const c = t.dataset.c;
    if (c) {
      if (c === '__name') draft.name = t.value;
      else if (c === 'startOnAny') draft.config.startOnAny = t.checked;
      else if (c === 'timeoutMin' || c === 'handoverHours') draft.config[c] = Number(t.value);
      else draft.config[c] = t.value;
      if (c === 'footer') { const prev = $('#nodeEditor .bubble', el); if (prev) prev.innerHTML = waFormat(nodePreview(node(selected))); }
      return markDirty(el);
    }
    if (t.matches('[data-dev]')) {
      draft.config.deviceIds = $$('[data-dev]:checked', el).map((x) => x.value);
      markDirty(el);
    }
  });
  el.addEventListener('change', async (e) => {
    if (e.target.matches('[data-c=startOnAny], [data-dev]')) e.target.dispatchEvent(new Event('input', { bubbles: true }));
    if (e.target.id === 'botActive') {
      const on = e.target.checked;
      if (on && dirty) {
        e.target.checked = false;
        return ctx.toast('Simpan perubahan dulu sebelum mengaktifkan');
      }
      if (on && !(await confirmBox('Aktifkan bot?', 'Bot akan mulai membalas chat pribadi yang cocok dengan kata pemicu.', { okText: 'Aktifkan' }))) {
        e.target.checked = false;
        return;
      }
      try {
        await ctx.call('PATCH', `/admin/chatbots/${current.id}/active`, { active: on });
        await loadList(ctx);
        current.active = on;
        render(el, ctx);
        ctx.toast(on ? 'Bot aktif' : 'Bot dinonaktifkan');
      } catch (err) { e.target.checked = !on; ctx.toast(err.message); }
    }
  });
  el.addEventListener('submit', (e) => {
    if (e.target.id !== 'simForm') return;
    e.preventDefault();
    const text = e.target.t.value.trim();
    if (!text) return;
    e.target.t.value = '';
    simSend(el, text);
  });
}

export default {
  async mount(el, ctx) {
    ctxRef = ctx;
    await ctx.loadDevices();
    bind(el, ctx);
    await loadList(ctx);
    if (bots.length) await open(el, ctx, bots[0].id);
    else render(el, ctx);
  },
  unmount() {
    current = null;
    draft = null;
  },
};
