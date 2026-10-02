import { barChart, chip, donut, esc, fmt, icon, ring, sparkline, timeAgo } from '../ui.js';

let range = 'today';

function view(s, ctx) {
  const last = s.last7;
  const sentSeries = last.map((d) => d.sent);
  const failSeries = last.map((d) => d.failed);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const week = { sent: sum(sentSeries), failed: sum(failSeries) };
  const yesterday = last[last.length - 2] ?? { sent: 0 };
  const diff = s.today.sent - yesterday.sent;
  const online = s.devices.filter((d) => d.status === 'connected').length;
  const successRate = week.sent + week.failed ? Math.round((week.sent / (week.sent + week.failed)) * 100) : 100;
  const pick = range === 'today' ? { sent: s.today.sent, failed: s.today.failed } : week;
  const pending = s.totals.pending;

  const tileColors = ['t-purple', 't-teal', 't-line', 't-indigo'];
  const barColors = ['var(--purple)', 'var(--teal)', 'var(--primary)', 'var(--indigo)'];

  const iconFor = (st) =>
    st === 'sent' ? ['c-ok', 'up'] : st === 'failed' ? ['c-bad', 'x'] : ['c-warn', 'clock'];

  return `
  <div class="grid g-dash">
    <div class="stack">
      <div class="hero">
        <div class="label">Total pesan terkirim</div>
        <div class="big">${fmt(s.totals.sent)}</div>
        <div class="orbs"><i></i><i></i></div>
        <div class="meta">
          <div><small>Device online</small><b>${online} / ${s.devices.length}</b></div>
          <div><small>Antrean</small><b>${fmt(pending)} pesan</b></div>
          <div><small>Sukses 7 hari</small><b>${successRate}%</b></div>
          ${s.contactsTotal !== null ? `<div><small>Kontak</small><b>${fmt(s.contactsTotal)}</b></div>` : ''}
          ${s.leadsToday !== null ? `<div><small>Lead hari ini</small><b>${fmt(s.leadsToday)}</b></div>` : ''}
          ${s.incomingToday !== null ? `<div><small>Pesan masuk hari ini</small><b>${fmt(s.incomingToday)}</b></div>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h3>Aktivitas 7 Hari</h3><p>Pesan API, Google Form, dan Blast</p></div>
          <div class="chart-legend"><span><i style="background:var(--primary)"></i>Terkirim</span><span><i style="background:var(--bad)"></i>Gagal</span></div>
        </div>
        ${barChart(last)}
      </div>
    </div>

    <div class="stack">
      <div class="grid g-2">
        <div class="card stat">
          <div class="k">Terkirim hari ini</div>
          <div class="v">${fmt(s.today.sent)}</div>
          <div class="trend ${diff >= 0 ? 'c-ok' : 'c-bad'}">${icon(diff >= 0 ? 'up' : 'down')} ${diff >= 0 ? '+' : ''}${diff} vs kemarin</div>
          ${sparkline(sentSeries, 'var(--primary)')}
        </div>
        <div class="card stat">
          <div class="k">Gagal hari ini</div>
          <div class="v">${fmt(s.today.failed)}</div>
          <div class="trend">7 hari: ${fmt(week.failed)}</div>
          ${sparkline(failSeries, 'var(--bad)')}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h3>Ringkasan Pesan</h3><p>Komposisi status pesan</p></div>
          <div class="seg" data-range>
            <button data-r="today" class="${range === 'today' ? 'on' : ''}">Hari ini</button>
            <button data-r="week" class="${range === 'week' ? 'on' : ''}">7 hari</button>
          </div>
        </div>
        <div class="row" style="gap:28px;justify-content:space-around">
          ${ring([
            { value: pick.sent, color: 'var(--ok)' },
            { value: pending, color: 'var(--warn)' },
            { value: pick.failed, color: 'var(--bad)' },
          ])}
          <div class="legend-list" style="min-width:180px">
            <div class="legend-item"><span class="bar" style="background:var(--ok)"></span><div><small>Terkirim</small><b>${fmt(pick.sent)}</b></div></div>
            <div class="legend-item"><span class="bar" style="background:var(--warn)"></span><div><small>Antrean (saat ini)</small><b>${fmt(pending)}</b></div></div>
            <div class="legend-item"><span class="bar" style="background:var(--bad)"></span><div><small>Gagal</small><b>${fmt(pick.failed)}</b></div></div>
          </div>
        </div>
      </div>

      ${ctx.isOn('blast') ? `
      <div class="card">
        <div class="card-head">
          <div><h3>Blast</h3><p>Blast aktif & selesai 24 jam terakhir</p></div>
          <a class="btn soft sm" href="#/blast">${icon('blast')} Kelola</a>
        </div>
        ${s.blasts.length ? `
        <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:20px">
          <div class="legend-list">
            ${s.blasts.map((b, i) => `
              <div class="legend-item"><span class="bar" style="background:${barColors[i]}"></span>
                <div style="min-width:0"><small style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.name)}</small>
                <b>${fmt(b.sent)} <em>/ ${fmt(b.total)}</em></b></div></div>`).join('')}
          </div>
          <div class="tiles">
            ${s.blasts.map((b, i) => {
              const pct = b.total ? ((b.sent + b.failed) / b.total) * 100 : 0;
              const line = tileColors[i] === 't-line';
              return `<a class="tile ${tileColors[i]}" href="#/blast" title="${esc(b.name)}">
                ${donut(pct, line ? { color: 'var(--primary)', track: 'var(--surface-2)', text: 'var(--text)' } : {})}
                <span>${esc(b.name)}</span></a>`;
            }).join('')}
          </div>
        </div>` : `<div class="empty">${icon('blast')}<div>Belum ada blast aktif.</div></div>`}
      </div>` : ''}
    </div>
  </div>

  <div class="grid g-dash" style="margin-top:24px">
    <div class="card">
      <div class="card-head">
        <div><h3>Device</h3><p>Status nomor WhatsApp</p></div>
        <a class="btn soft sm" href="#/devices">${icon('device')} Kelola</a>
      </div>
      ${s.devices.length ? s.devices.map((d) => `
        <div class="list-row">
          <span class="circle ${d.status === 'connected' ? 'c-ok' : d.status === 'qr' || d.status === 'connecting' ? 'c-warn' : 'c-bad'}">${icon('device')}</span>
          <div><b>${esc(d.name)}</b><small>${d.phone ? '+' + esc(d.phone) : 'Belum tertaut'}</small></div>
          <div class="when"></div>
          ${chip(d.status)}
        </div>`).join('') : `<div class="empty">${icon('device')}<div>Belum ada device. <a href="#/devices">Tambah sekarang</a></div></div>`}
    </div>

    <div class="card">
      <div class="card-head">
        <div><h3>Pesan Terbaru</h3><p>6 pesan terakhir dari semua sumber</p></div>
        ${ctx.isOn('messageLog') ? `<a class="btn soft sm" href="#/messages">${icon('list')} Semua</a>` : ''}
      </div>
      ${s.recent.length ? s.recent.map((m) => {
        const [c, ic] = iconFor(m.status);
        return `<div class="list-row">
          <span class="circle ${c}">${icon(ic)}</span>
          <div><b>+${esc(m.phone)}</b><small>${esc((m.body ?? '').slice(0, 60))}</small></div>
          <div class="when"><b style="font-weight:500">${esc(m.device ?? '-')}</b><small>${m.source === 'blast' ? 'Blast' : 'API / Form'} · ${timeAgo(m.at)}</small></div>
          ${chip(m.status)}
        </div>`;
      }).join('') : `<div class="empty">${icon('chat')}<div>Belum ada pesan.</div></div>`}
    </div>
  </div>`;
}

let last = null;

async function load(el, ctx) {
  const { data } = await ctx.call('GET', '/admin/stats');
  last = data;
  el.innerHTML = view(data, ctx);
  el.querySelector('[data-range]')?.addEventListener('click', (e) => {
    const r = e.target.closest('button')?.dataset.r;
    if (!r) return;
    range = r;
    el.innerHTML = view(last, ctx);
    load(el, ctx);
  });
}

export default {
  mount: load,
  refresh: load,
};
