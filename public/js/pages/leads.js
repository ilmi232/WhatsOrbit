import { $, $$, barSeries, chip, confirmBox, esc, fmt, icon, localTime, sparkline, timeAgo } from '../ui.js';

const PAGE = 50;
const ymd = (offset = 0) => {
  const d = new Date(Date.now() - offset * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const RANGES = {
  today: () => [ymd(0), ymd(0)],
  yesterday: () => [ymd(1), ymd(1)],
  week: () => [ymd(6), ymd(0)],
  month: () => [ymd(29), ymd(0)],
  all: () => ['', ''],
};

const st = { range: 'today', from: ymd(0), to: ymd(0), source: '', q: '', offset: 0, stats: null };
const localPhone = (p) => (p.startsWith('62') ? '0' + p.slice(2) : '+' + p);

function query(extra = {}) {
  const p = new URLSearchParams();
  if (st.from) p.set('from', st.from);
  if (st.to) p.set('to', st.to);
  if (st.source) p.set('source', st.source);
  if (st.q) p.set('q', st.q);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

function renderStats(el) {
  const s = st.stats;
  const diff = s.today - s.yesterday;
  const series = s.perDay.slice(-14).map((d) => d.n);
  $('#leadStats', el).innerHTML = `
    <div class="card stat">
      <div class="k">Lead hari ini</div>
      <div class="v">${fmt(s.today)}</div>
      <div class="trend ${diff >= 0 ? 'c-ok' : 'c-bad'}">${icon(diff >= 0 ? 'up' : 'down')} ${diff >= 0 ? '+' : ''}${diff} vs kemarin</div>
      ${sparkline(series, 'var(--primary)')}
    </div>
    <div class="card stat"><div class="k">7 hari terakhir</div><div class="v">${fmt(s.week)}</div>
      <div class="trend">± ${fmt(Math.round(s.week / 7))}/hari</div>${sparkline(s.perDay.slice(-7).map((d) => d.n), 'var(--teal)')}</div>
    <div class="card stat"><div class="k">30 hari terakhir</div><div class="v">${fmt(s.month)}</div>
      <div class="trend">± ${fmt(Math.round(s.month / 30))}/hari</div>${sparkline(s.perDay.map((d) => d.n), 'var(--purple)')}</div>
    <div class="card stat"><div class="k">Total lead</div><div class="v">${fmt(s.total)}</div>
      <div class="trend">${s.sources.length} sumber form</div>${sparkline(s.perDay.map((d) => d.fresh), 'var(--indigo)')}</div>`;

  $('#leadChart', el).innerHTML = barSeries(s.perDay);
  $('#leadSources', el).innerHTML = s.sources.length
    ? s.sources.map((x) => `
      <div class="list-row" style="grid-template-columns:46px minmax(0,1fr) auto">
        <span class="circle c-info">${icon('form')}</span>
        <div><b>${esc(x.source)}</b><small>Terakhir ${timeAgo(x.last)}</small></div>
        <b>${fmt(x.n)}</b>
      </div>`).join('')
    : '<div class="muted">Belum ada sumber.</div>';

  // Bangun ulang pilihan sumber hanya kalau berubah (supaya dropdown yang terbuka tidak tertutup)
  const sel = $('#fSource', el);
  const key = s.sources.map((x) => x.source).join('\n');
  if (sel.dataset.key !== key) {
    sel.dataset.key = key;
    sel.innerHTML = '<option value="">Semua sumber</option>' + s.sources.map((x) => `<option>${esc(x.source)}</option>`).join('');
    sel.value = st.source;
  }
}

async function loadList(el, ctx) {
  const res = await ctx.call('GET', `/admin/leads?${query({ limit: PAGE, offset: st.offset })}`);
  $('#exportLeads', el).href = `/admin/leads/export.csv?${query()}`;
  const rangeLabel = st.range === 'custom'
    ? `${st.from || 'awal'} s/d ${st.to || 'sekarang'}`
    : { today: 'hari ini', yesterday: 'kemarin', week: '7 hari terakhir', month: '30 hari terakhir', all: 'semua waktu' }[st.range];
  $('#listSub', el).textContent = `${fmt(res.total)} lead ${rangeLabel}${st.source ? ` dari "${st.source}"` : ''}`;

  $('#leadBody', el).innerHTML = res.data.map((l) => `
    <tr data-lid="${l.id}">
      <td style="white-space:nowrap">${localTime(l.created_at)}</td>
      <td><b style="font-weight:600">${esc(l.name || '—')}</b></td>
      <td style="white-space:nowrap">${esc(localPhone(l.phone))}</td>
      <td>${Object.entries(l.fields).map(([k, v]) => `<span class="fchip">${esc(k)}: <b>${esc(v)}</b></span>`).join('')}</td>
      <td><span class="muted">${esc(l.source)}</span>${l.group_name ? `<div><span class="gchip">${esc(l.group_name)}</span></div>` : ''}</td>
      <td>${l.is_new ? chip('ok', 'Kontak baru') : chip('info', 'Sudah ada')}</td>
      <td><button class="btn ghost sm" data-del title="Hapus catatan lead">${icon('trash')}</button></td>
    </tr>`).join('') || `<tr><td colspan="7"><div class="empty">${icon('users')}<div>Tidak ada lead pada periode ini.</div></div></td></tr>`;

  const from = res.total ? st.offset + 1 : 0;
  const to = Math.min(st.offset + PAGE, res.total);
  $('#pager', el).innerHTML = `
    <span class="muted">${fmt(from)}–${fmt(to)} dari ${fmt(res.total)}</span>
    <div class="row">
      <button class="btn ghost sm" data-page="-1" ${st.offset ? '' : 'disabled'}>‹ Sebelumnya</button>
      <button class="btn ghost sm" data-page="1" ${to < res.total ? '' : 'disabled'}>Berikutnya ›</button>
    </div>`;
}

async function loadAll(el, ctx) {
  st.stats = (await ctx.call('GET', '/admin/leads/stats')).data;
  $('#setupGuide', el).classList.toggle('hidden', st.stats.total > 0);
  renderStats(el);
  await loadList(el, ctx);
}

function setRange(el, r) {
  st.range = r;
  if (r !== 'custom') [st.from, st.to] = RANGES[r]();
  $('#fFrom', el).value = st.from;
  $('#fTo', el).value = st.to;
  for (const b of $$('#fRange button', el)) b.classList.toggle('on', b.dataset.r === r);
  st.offset = 0;
}

export default {
  async mount(el, ctx) {
    el.innerHTML = `
    <div id="setupGuide" class="card hidden" style="margin-bottom:24px">
      <div class="card-head"><div><h3>Mulai mengumpulkan lead</h3><p>Pengisi Google Form otomatis tersimpan sebagai kontak</p></div></div>
      <ol style="margin:0;padding-left:20px;line-height:1.9">
        <li>Buka menu <a href="#/form">Google Form</a>, centang <b>Simpan pengisi sebagai lead</b>, isi nama grup (mis. "Pendaftar PPDB 2026").</li>
        <li>Copy script baru dan tempel menggantikan script lama di Apps Script Google Form, lalu Simpan.</li>
        <li>Setiap form dikirim, pengisinya muncul di sini dan di menu <a href="#/contacts">Kontak</a>.</li>
      </ol>
    </div>

    <div id="leadStats" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))"></div>

    <div class="grid g-dash" style="margin-top:24px">
      <div class="card">
        <div class="card-head">
          <div><h3>Lead 30 Hari</h3><p>Per hari, berdasarkan waktu form dikirim</p></div>
          <div class="chart-legend"><span><i style="background:var(--primary)"></i>Kontak baru</span><span><i style="background:var(--primary);opacity:.35"></i>Sudah ada</span></div>
        </div>
        <div id="leadChart"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Sumber Form</h3><p>Diatur di generator script Google Form</p></div></div>
        <div id="leadSources"></div>
      </div>
    </div>

    <div class="card" style="margin-top:24px">
      <div class="card-head">
        <div><h3>Daftar Lead</h3><p id="listSub"></p></div>
        <a class="btn ghost" id="exportLeads" href="/admin/leads/export.csv" download>${icon('up')} Export CSV</a>
      </div>
      <div class="toolbar">
        <div class="seg" id="fRange">
          <button data-r="today">Hari ini</button><button data-r="yesterday">Kemarin</button>
          <button data-r="week">7 hari</button><button data-r="month">30 hari</button><button data-r="all">Semua</button>
        </div>
        <div class="row" style="flex-wrap:nowrap">
          <input type="date" id="fFrom" aria-label="Dari tanggal" style="width:auto;min-width:0;flex:1">
          <span class="muted">s/d</span>
          <input type="date" id="fTo" aria-label="Sampai tanggal" style="width:auto;min-width:0;flex:1">
        </div>
        <select id="fSource" style="width:auto" aria-label="Sumber"></select>
        <div class="search">${icon('search')}<input id="fQ" placeholder="Cari nama, nomor, atau data" aria-label="Cari lead"></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Waktu</th><th>Nama</th><th>Nomor</th><th>Data</th><th>Sumber / Grup</th><th>Status</th><th></th></tr></thead>
          <tbody id="leadBody"></tbody>
        </table>
      </div>
      <div id="pager" class="pager"></div>
    </div>`;

    setRange(el, st.range);
    $('#fQ', el).value = st.q;

    $('#fRange', el).addEventListener('click', (e) => {
      const r = e.target.closest('[data-r]')?.dataset.r;
      if (!r) return;
      setRange(el, r);
      loadList(el, ctx);
    });
    for (const id of ['#fFrom', '#fTo']) {
      $(id, el).addEventListener('change', () => {
        st.from = $('#fFrom', el).value;
        st.to = $('#fTo', el).value;
        setRange(el, 'custom');
        loadList(el, ctx);
      });
    }
    $('#fSource', el).addEventListener('change', (e) => { st.source = e.target.value; st.offset = 0; loadList(el, ctx); });
    let t;
    $('#fQ', el).addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => { st.q = e.target.value.trim(); st.offset = 0; loadList(el, ctx); }, 250);
    });
    $('#pager', el).addEventListener('click', (e) => {
      const d = Number(e.target.closest('[data-page]')?.dataset.page);
      if (!d) return;
      st.offset = Math.max(0, st.offset + d * PAGE);
      loadList(el, ctx);
    });
    $('#leadBody', el).addEventListener('click', async (e) => {
      if (!e.target.closest('[data-del]')) return;
      const id = e.target.closest('[data-lid]').dataset.lid;
      if (!(await confirmBox('Hapus catatan lead ini?', 'Hanya catatan lead yang dihapus. Kontaknya tetap ada di menu Kontak.', { danger: true, okText: 'Hapus' }))) return;
      await ctx.call('DELETE', `/admin/leads/${id}`);
      loadAll(el, ctx);
    });

    await loadAll(el, ctx);
  },
  async refresh(el, ctx) {
    if (document.querySelector('.modal-bg')) return;
    // Statistik saja yang diperbarui otomatis; daftar diperbarui kalau sedang melihat hari ini
    st.stats = (await ctx.call('GET', '/admin/leads/stats')).data;
    $('#setupGuide', el).classList.toggle('hidden', st.stats.total > 0);
    renderStats(el);
    if (st.range === 'today' && !st.offset) await loadList(el, ctx);
  },
};
