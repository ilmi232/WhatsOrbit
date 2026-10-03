import { $, $$, barSeries, confirmBox, copyText, esc, fmt, icon, promptBox } from '../ui.js';

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const PRESETS = ['#25d366', '#128c7e', '#1ea5e3', '#4b26e8', '#ac39d4', '#ff5b5b', '#ff9f1c', '#1c2434'];
const localPhone = (p) => (p?.startsWith('62') ? '0' + p.slice(2) : p ?? '');

let widgets = [];
let current = null; // { id, name, config, stats }
let draft = null; // { name, config }
let dirty = false;
let trackingUrl = null;
let ctxRef = null;

// ---- Editor --------------------------------------------------------------------------
function agentRow(a, i, n) {
  return `
  <div class="preview" data-ag="${i}" style="margin:0 0 12px">
    <div class="row between" style="margin-bottom:10px">
      <b>Agen ${i + 1}</b>
      <div class="row">
        <button type="button" class="btn ghost sm" data-agmove="-1" ${i === 0 ? 'disabled' : ''} title="Naikkan">${icon('up')}</button>
        <button type="button" class="btn ghost sm" data-agmove="1" ${i === n - 1 ? 'disabled' : ''} title="Turunkan">${icon('down')}</button>
        <button type="button" class="btn bad-soft sm" data-agdel title="Hapus agen">${icon('trash')}</button>
      </div>
    </div>
    <div class="grid g-2" style="gap:10px">
      <label class="field" style="margin:0"><span>Nama</span><input data-f="name" value="${esc(a.name)}" placeholder="mis. Admin PPDB"></label>
      <label class="field" style="margin:0"><span>Keterangan</span><input data-f="role" value="${esc(a.role)}" placeholder="mis. Info pendaftaran"></label>
      <label class="field" style="margin:0"><span>Nomor WhatsApp</span><input data-f="phone" value="${esc(localPhone(a.phone))}" placeholder="0812xxxxxxxx"></label>
      <label class="field" style="margin:0"><span>Jam online <span class="hint">— kosong = selalu</span></span>
        <span class="row" style="flex-wrap:nowrap"><input type="time" data-f="start" value="${esc(a.start)}"> s/d <input type="time" data-f="end" value="${esc(a.end)}"></span></label>
    </div>
    <div class="field" style="margin:10px 0 0"><span>Hari online <span class="hint">— tidak dipilih = setiap hari</span></span>
      <div class="row" style="gap:6px">${DAYS.map((d, k) => `
        <label class="check" style="padding:6px 10px"><input type="checkbox" data-day="${k}" ${a.days.includes(k) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
    </div>
    <label class="field" style="margin:10px 0 0"><span>Pesan pembuka <span class="hint">— otomatis terisi di WhatsApp pengunjung; [Halaman] = judul halaman</span></span>
      <textarea data-f="message" style="min-height:60px" placeholder="Halo Admin, saya ingin bertanya tentang ...">${esc(a.message)}</textarea></label>
  </div>`;
}

function renderAgents(el) {
  const list = draft.config.agents;
  $('#agents', el).innerHTML = list.length
    ? list.map((a, i) => agentRow(a, i, list.length)).join('')
    : '<div class="muted" style="margin-bottom:12px">Belum ada agen. Tambahkan minimal satu nomor WhatsApp.</div>';
}

function editorHtml() {
  const c = draft.config;
  return `
  <div class="card">
    <div class="card-head"><div><h3>Tampilan</h3><p>Yang dilihat pengunjung website</p></div></div>
    <label class="field"><span>Nama widget <span class="hint">— untuk Anda, tidak tampil</span></span><input data-c="__name" value="${esc(draft.name)}"></label>
    <div class="grid g-2" style="gap:12px">
      <label class="field"><span>Judul panel</span><input data-c="title" value="${esc(c.title)}"></label>
      <label class="field"><span>Subjudul</span><input data-c="subtitle" value="${esc(c.subtitle)}"></label>
      <label class="field"><span>Label di samping tombol <span class="hint">— kosong = tanpa label</span></span><input data-c="label" value="${esc(c.label)}"></label>
      <label class="field"><span>Teks saat agen offline</span><input data-c="offlineText" value="${esc(c.offlineText)}"></label>
    </div>
    <div class="field"><span>Warna</span>
      <div class="row">
        ${PRESETS.map((p) => `<button type="button" data-color="${p}" title="${p}" style="width:30px;height:30px;border-radius:50%;border:3px solid ${p === c.color ? 'var(--text)' : 'transparent'};background:${p};cursor:pointer;padding:0"></button>`).join('')}
        <input type="color" data-c="color" value="${esc(c.color)}" style="width:46px;height:34px;padding:2px" aria-label="Warna lain">
      </div>
    </div>
    <div class="grid g-2" style="gap:12px">
      <div class="field"><span>Posisi</span>
        <div class="seg" data-seg="position"><button type="button" data-v="left" class="${c.position === 'left' ? 'on' : ''}">Kiri bawah</button><button type="button" data-v="right" class="${c.position === 'right' ? 'on' : ''}">Kanan bawah</button></div>
      </div>
      <div class="field"><span>Saat tombol diklik</span>
        <div class="seg" data-seg="mode"><button type="button" data-v="list" class="${c.mode === 'list' ? 'on' : ''}">Pilih agen</button><button type="button" data-v="direct" class="${c.mode === 'direct' ? 'on' : ''}">Langsung chat</button></div>
        <span class="hint" id="modeHint"></span>
      </div>
    </div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 130px;gap:12px">
      <label class="field"><span>Sapaan otomatis <span class="hint">— kosong = tidak ada</span></span><input data-c="greeting" value="${esc(c.greeting)}"></label>
      <label class="field"><span>Muncul setelah (detik)</span><input type="number" min="0" max="120" data-c="greetingDelay" value="${esc(c.greetingDelay)}"></label>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <div><h3>Agen</h3><p>Nomor WhatsApp tujuan chat, maksimal 10</p></div>
      <button type="button" class="btn soft sm" id="addAgent">${icon('plus')} Agen</button>
    </div>
    <div id="agents"></div>
  </div>

  <div class="card save-bar">
    <div class="row between">
      <span class="muted" id="saveState">Semua perubahan tersimpan</span>
      <button class="btn grad" id="saveWidget">${icon('check')} Simpan</button>
    </div>
  </div>`;
}

function markDirty(el) {
  dirty = true;
  $('#saveState', el).textContent = 'Ada perubahan yang belum disimpan, kode tempel di bawah belum diperbarui';
  schedulePreview(el);
}

// ---- Pratinjau ------------------------------------------------------------------------
const FAKE_PAGE = (title) => `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;font:14px/1.6 system-ui,sans-serif;color:#334;background:#f6f8fb}header{background:#0f3d6e;color:#fff;padding:18px 24px;font-weight:700}
main{padding:24px;max-width:640px}.b{height:12px;background:#dfe5ee;border-radius:6px;margin:10px 0}.h{height:120px;background:#e7edf5;border-radius:12px;margin:16px 0}</style></head>
<body><header>Website Sekolah (contoh)</header><main><h2 style="margin-top:0">${title}</h2><div class="h"></div><div class="b"></div><div class="b" style="width:80%"></div><div class="b" style="width:60%"></div></main>`;

let pvTimer;
function schedulePreview(el) {
  clearTimeout(pvTimer);
  pvTimer = setTimeout(() => preview(el), 350);
}

async function preview(el) {
  const frame = $('#pvFrame', el);
  if (!frame) return;
  try {
    const { data } = await ctxRef.call('POST', `/admin/widgets/${current.id}/snippet?preview=1`, { name: draft.name, config: draft.config });
    frame.srcdoc = FAKE_PAGE('Info PPDB 2026') + data.code + '</body></html>';
    $('#pvError', el).textContent = '';
  } catch (err) {
    $('#pvError', el).textContent = err.message;
  }
}

async function loadCode(el, ctx) {
  const { data } = await ctx.call('POST', `/admin/widgets/${current.id}/snippet`, {});
  $('#code', el).value = data.code;
  $('#trackInfo', el).innerHTML = data.tracking
    ? `Klik tercatat ke <code>${esc(trackingUrl)}</code>. Kalau server WhatsOrbit mati, widget tetap berfungsi, hanya kliknya tidak tercatat.`
    : 'Statistik klik nonaktif karena <code>PUBLIC_URL</code> belum diatur di <code>.env</code>. Widget tetap berfungsi.';
}

function renderStats(el) {
  const s = current.stats;
  const names = current.config.agents;
  const total = s.agents.reduce((x, a) => x + a.n, 0) || 1;
  $('#stats', el).innerHTML = `
    <div class="grid g-3" style="gap:12px;margin-bottom:16px">
      <div class="mini-stats" style="display:block;margin:0"><div><b>${fmt(s.today)}</b><small>Klik hari ini</small></div></div>
      <div class="mini-stats" style="display:block;margin:0"><div><b>${fmt(s.week)}</b><small>7 hari</small></div></div>
      <div class="mini-stats" style="display:block;margin:0"><div><b>${fmt(s.total)}</b><small>Total</small></div></div>
    </div>
    ${barSeries(s.perDay.map((d) => ({ day: d.day, n: d.n })), { h: 170 })}
    ${s.agents.length ? `<div class="label" style="margin:16px 0 8px">Per agen</div>
      ${s.agents.sort((a, b) => b.n - a.n).map((a) => `
        <div style="margin-bottom:8px"><div class="row between"><span>${esc(names[a.agent]?.name ?? `Agen ${a.agent + 1} (dihapus)`)}</span><b>${fmt(a.n)}</b></div>
        <div class="meter" style="margin:4px 0 0"><i style="width:${(a.n / total) * 100}%"></i></div></div>`).join('')}` : ''}
    ${s.pages.length ? `<div class="label" style="margin:16px 0 8px">Halaman teratas (30 hari)</div>
      ${s.pages.map((p) => `<div class="row between" style="flex-wrap:nowrap;margin-bottom:6px"><span class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.page || '(tidak diketahui)')}</span><b>${fmt(p.n)}</b></div>`).join('')}` : ''}`;
}

// ---- Halaman ---------------------------------------------------------------------------
async function loadList(ctx) {
  const res = await ctx.call('GET', '/admin/widgets');
  widgets = res.data;
  trackingUrl = res.trackingUrl;
}

async function open(el, ctx, id) {
  current = (await ctx.call('GET', `/admin/widgets/${id}`)).data;
  draft = { name: current.name, config: JSON.parse(JSON.stringify(current.config)) };
  dirty = false;
  render(el, ctx);
}

function render(el, ctx) {
  if (!widgets.length) {
    el.innerHTML = `
      <div class="card empty">${icon('chat')}
        <div style="font-weight:600;color:var(--text);margin-bottom:4px">Belum ada Chat Widget</div>
        <div style="margin-bottom:16px">Tombol WhatsApp melayang untuk website sekolah. Pengunjung memilih admin, lalu chat terbuka di WhatsApp mereka.</div>
        <button class="btn grad" id="newWidget">Buat widget</button>
      </div>`;
    return;
  }
  el.innerHTML = `
    <div class="section-title">
      <div class="row">
        ${widgets.length > 1 ? `<div class="seg" id="wSel">${widgets.map((w) => `<button data-wid="${w.id}" class="${w.id === current.id ? 'on' : ''}">${esc(w.name)}</button>`).join('')}</div>`
          : `<h2>${esc(current.name)}</h2>`}
      </div>
      <div class="row">
        <button class="btn ghost" id="newWidget">${icon('plus')} Widget lain</button>
        <button class="btn bad-soft" id="delWidget" title="Hapus widget">${icon('trash')}</button>
      </div>
    </div>
    <div class="grid g-dash">
      <div class="stack" id="editor">${editorHtml()}</div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h3>Pratinjau</h3><p>Coba klik tombolnya. Statistik tidak tercatat di pratinjau.</p></div></div>
          <iframe id="pvFrame" title="Pratinjau widget" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            style="width:100%;height:540px;border:1px solid var(--line);border-radius:14px;background:#fff"></iframe>
          <div class="muted c-bad" id="pvError"></div>
        </div>
        <div class="card">
          <div class="card-head">
            <div><h3>Kode Pasang</h3><p>Tempel sebelum tag &lt;/body&gt; di website</p></div>
            <button class="btn grad sm" id="copyCode">${icon('copy')} Copy</button>
          </div>
          <textarea id="code" class="mono" readonly style="min-height:120px;font-size:11.5px"></textarea>
          <div class="muted" id="trackInfo" style="margin-top:8px"></div>
          <details style="margin-top:12px">
            <summary style="cursor:pointer;font-weight:600">Cara pasang</summary>
            <ul class="muted" style="padding-left:18px;line-height:1.8;margin:8px 0 0">
              <li><b>WordPress</b>: plugin <i>WPCode</i> / <i>Insert Headers and Footers</i> → tempel di bagian <b>Footer</b>.</li>
              <li><b>Blogger</b>: Tata Letak → Tambah Gadget → <i>HTML/JavaScript</i> → tempel.</li>
              <li><b>Website buatan sendiri</b>: tempel sebelum <code>&lt;/body&gt;</code> di template utama.</li>
              <li><b>Google Sites</b>: kode di-embed dalam kotak, jadi tombol hanya tampil di dalam kotak itu (tidak melayang).</li>
              <li>Setelah mengubah pengaturan dan menyimpan, <b>tempel ulang kode</b> di website.</li>
            </ul>
          </details>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Statistik Klik</h3><p>Pengunjung yang membuka chat dari widget</p></div></div>
          <div id="stats"></div>
        </div>
      </div>
    </div>`;
  renderAgents(el);
  updateModeHint(el);
  renderStats(el);
  preview(el);
  loadCode(el, ctx);
}

function updateModeHint(el) {
  $('#modeHint', el).textContent = draft.config.mode === 'direct'
    ? 'Langsung membuka chat dengan agen yang online (acak kalau lebih dari satu).'
    : 'Pengunjung memilih agen dari daftar.';
}

function bind(el, ctx) {
  el.addEventListener('click', async (e) => {
    const t = e.target;
    try {
      if (t.closest('#newWidget')) {
        const name = await promptBox('Widget baru', widgets.length ? '' : 'Website Sekolah', 'Beri nama, mis. "Website Sekolah" atau "Halaman PPDB".');
        if (!name) return;
        const { data } = await ctx.call('POST', '/admin/widgets', { name });
        await loadList(ctx);
        return open(el, ctx, data.id);
      }
      if (t.closest('#delWidget')) {
        if (!(await confirmBox(`Hapus widget "${current.name}"?`, 'Statistiknya ikut terhapus. Kode yang sudah terpasang di website tetap jalan, hapus juga dari website.', { danger: true, okText: 'Hapus' }))) return;
        await ctx.call('DELETE', `/admin/widgets/${current.id}`);
        await loadList(ctx);
        if (widgets.length) return open(el, ctx, widgets[0].id);
        current = null;
        return render(el, ctx);
      }
      const sel = t.closest('[data-wid]');
      if (sel) {
        if (dirty && !(await confirmBox('Buang perubahan?', 'Ada perubahan yang belum disimpan.', { okText: 'Buang' }))) return;
        return open(el, ctx, Number(sel.dataset.wid));
      }
      if (t.closest('#copyCode')) {
        if (dirty) ctx.toast('Simpan dulu supaya kode berisi pengaturan terbaru');
        return copyText($('#code', el).value, 'Kode disalin');
      }
      if (t.closest('#saveWidget')) {
        const { data } = await ctx.call('PUT', `/admin/widgets/${current.id}`, { name: draft.name, config: draft.config });
        current = { ...current, ...data };
        draft = { name: data.name, config: JSON.parse(JSON.stringify(data.config)) };
        dirty = false;
        $('#saveState', el).textContent = 'Tersimpan. Tempel ulang kode di website kalau sudah terpasang.';
        renderAgents(el);
        await loadList(ctx);
        return loadCode(el, ctx);
      }
      const color = t.closest('[data-color]');
      if (color) {
        draft.config.color = color.dataset.color;
        $$('[data-color]', el).forEach((b) => (b.style.borderColor = b === color ? 'var(--text)' : 'transparent'));
        $('[data-c=color]', el).value = draft.config.color;
        return markDirty(el);
      }
      const seg = t.closest('[data-seg] [data-v]');
      if (seg) {
        const key = seg.closest('[data-seg]').dataset.seg;
        draft.config[key] = seg.dataset.v;
        seg.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === seg));
        updateModeHint(el);
        return markDirty(el);
      }
      if (t.closest('#addAgent')) {
        if (draft.config.agents.length >= 10) return ctx.toast('Maksimal 10 agen');
        draft.config.agents.push({ name: '', role: '', phone: '', message: 'Halo, saya ingin bertanya. (dari halaman [Halaman])', start: '', end: '', days: [] });
        renderAgents(el);
        return markDirty(el);
      }
      const row = t.closest('[data-ag]');
      if (row) {
        const i = Number(row.dataset.ag);
        const list = draft.config.agents;
        if (t.closest('[data-agdel]')) {
          list.splice(i, 1);
          renderAgents(el);
          return markDirty(el);
        }
        const mv = t.closest('[data-agmove]');
        if (mv) {
          const j = i + Number(mv.dataset.agmove);
          [list[i], list[j]] = [list[j], list[i]];
          renderAgents(el);
          return markDirty(el);
        }
      }
    } catch (err) { ctx.toast(err.message); }
  });

  el.addEventListener('input', (e) => {
    const t = e.target;
    const c = t.dataset.c;
    if (c) {
      if (c === '__name') draft.name = t.value;
      else draft.config[c] = c === 'greetingDelay' ? Number(t.value) : t.value;
      if (c === 'color') $$('[data-color]', el).forEach((b) => (b.style.borderColor = 'transparent'));
      return markDirty(el);
    }
    const row = t.closest('[data-ag]');
    if (row && (t.dataset.f || t.dataset.day !== undefined)) {
      const a = draft.config.agents[Number(row.dataset.ag)];
      if (t.dataset.f) a[t.dataset.f] = t.value;
      else a.days = $$('[data-day]', row).filter((x) => x.checked).map((x) => Number(x.dataset.day));
      markDirty(el);
    }
  });
  el.addEventListener('change', (e) => {
    if (e.target.dataset.day !== undefined) e.target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export default {
  async mount(el, ctx) {
    ctxRef = ctx;
    bind(el, ctx);
    await loadList(ctx);
    if (widgets.length) await open(el, ctx, widgets[0].id);
    else render(el, ctx);
  },
  async refresh(el, ctx) {
    if (!current || document.querySelector('.modal-bg')) return;
    const { data } = await ctx.call('GET', `/admin/widgets/${current.id}`);
    current.stats = data.stats;
    renderStats(el);
  },
  unmount() {
    current = null;
    draft = null;
  },
};
