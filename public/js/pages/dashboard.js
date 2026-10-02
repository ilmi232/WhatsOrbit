import { barChart, chip, esc, fmt, icon, ring, sparkline, timeAgo } from '../ui.js';

let range = 'today';

function view(s, ctx) {
  const days = s.last7;
  const sentSeries = days.map((d) => d.sent);
  const failSeries = days.map((d) => d.failed);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const week = { sent: sum(sentSeries), failed: sum(failSeries) };
  const yesterday = days[days.length - 2] ?? { sent: 0 };
  const diff = s.today.sent - yesterday.sent;
  const online = s.devices.filter((d) => d.status === 'connected').length;
  const offline = s.devices.length - online;
  const successRate = week.sent + week.failed ? Math.round((week.sent / (week.sent + week.failed)) * 100) : 100;
  const pick = range === 'today' ? { sent: s.today.sent, failed: s.today.failed } : week;
  const pending = s.totals.pending;

  const iconFor = (st) =>
    st === 'sent' ? ['c-ok', 'up'] : st === 'failed' ? ['c-bad', 'x'] : ['c-warn', 'clock'];

  // Angka tambahan di bawah grafik (hanya fitur yang aktif)
  const extras = [
    ['Sukses 7 hari', `${successRate}%`],
    ['Total terkirim', fmt(s.totals.sent)],
    s.incomingToday !== null && ['Masuk hari ini', fmt(s.incomingToday)],
    s.leadsToday !== null && ['Lead hari ini', fmt(s.leadsToday)],
    s.contactsTotal !== null && ['Kontak', fmt(s.contactsTotal)],
  ].filter(Boolean);

  const deviceSub = !s.devices.length ? 'belum ada device' : offline ? `${offline} tidak terkoneksi` : 'semua terkoneksi';

  return `
  <div class="dash">
    <div class="dash-kpis">
      <div class="kpi kpi-hero">
        <div class="kpi-k">Terkirim hari ini</div>
        <div class="kpi-v">${fmt(s.today.sent)}</div>
        <div class="kpi-s">${icon(diff >= 0 ? 'up' : 'down')} ${diff >= 0 ? '+' : ''}${fmt(diff)} dibanding kemarin</div>
        ${sparkline(sentSeries, '#ffffff', { h: 48 })}
      </div>
      <div class="kpi">
        <div class="kpi-k">Gagal hari ini</div>
        <div class="kpi-v ${s.today.failed ? 'c-bad' : ''}">${fmt(s.today.failed)}</div>
        <div class="kpi-s">${fmt(week.failed)} dalam 7 hari</div>
        ${sparkline(failSeries, 'var(--bad)', { h: 48 })}
      </div>
      <a class="kpi" href="#/${ctx.isOn('messageLog') ? 'messages' : 'dashboard'}">
        <div class="kpi-k">Antrean</div>
        <div class="kpi-v ${pending ? 'c-warn' : ''}">${fmt(pending)}</div>
        <div class="kpi-s">${pending ? 'pesan menunggu dikirim' : 'tidak ada yang menunggu'}</div>
      </a>
      <a class="kpi" href="#/devices">
        <div class="kpi-k">Device online</div>
        <div class="kpi-v">${online}<span class="kpi-of"> / ${s.devices.length}</span></div>
        <div class="kpi-s ${offline ? 'c-bad' : ''}">${deviceSub}</div>
      </a>
    </div>

    <div class="dash-row">
      <div class="card">
        <div class="card-head">
          <div><h3>Aktivitas 7 Hari</h3><p>${fmt(week.sent)} terkirim · ${fmt(week.failed)} gagal (API, Google Form, Blast)</p></div>
          <div class="chart-legend"><span><i style="background:var(--primary)"></i>Terkirim</span><span><i style="background:var(--bad)"></i>Gagal</span></div>
        </div>
        ${barChart(days, { h: 230 })}
        <div class="dash-extras" style="--n:${extras.length}">${extras.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('')}</div>
      </div>

      <div class="card dash-summary">
        <div class="card-head">
          <div><h3>Ringkasan</h3><p>Status pesan</p></div>
          <div class="seg" data-range>
            <button data-r="today" class="${range === 'today' ? 'on' : ''}">Hari ini</button>
            <button data-r="week" class="${range === 'week' ? 'on' : ''}">7 hari</button>
          </div>
        </div>
        <div class="dash-ring">
          ${ring([
            { value: pick.sent, color: 'var(--ok)' },
            { value: pending, color: 'var(--warn)' },
            { value: pick.failed, color: 'var(--bad)' },
          ], { size: 150, stroke: 18 })}
          <div class="dash-legend">
            <div><i style="background:var(--ok)"></i><small>Terkirim</small><b>${fmt(pick.sent)}</b></div>
            <div><i style="background:var(--warn)"></i><small>Antrean</small><b>${fmt(pending)}</b></div>
            <div><i style="background:var(--bad)"></i><small>Gagal</small><b>${fmt(pick.failed)}</b></div>
          </div>
        </div>
      </div>
    </div>

    <div class="dash-row">
      <div class="card">
        <div class="card-head">
          <div><h3>Pesan Terbaru</h3><p>6 pesan terakhir dari semua sumber</p></div>
          ${ctx.isOn('messageLog') ? '<a class="btn soft sm" href="#/messages">Lihat semua</a>' : ''}
        </div>
        ${s.recent.length ? s.recent.map((m) => {
          const [c, ic] = iconFor(m.status);
          return `<div class="list-row">
            <span class="circle ${c}">${icon(ic)}</span>
            <div><b>+${esc(m.phone)}</b><small>${esc(m.body ?? '')}</small></div>
            <div class="when"><b style="font-weight:500">${esc(m.device ?? '-')}</b><small>${m.source === 'blast' ? 'Blast' : 'API / Form'} · ${timeAgo(m.at)}</small></div>
            ${chip(m.status)}
          </div>`;
        }).join('') : `<div class="empty">${icon('chat')}<div>Belum ada pesan.</div></div>`}
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head">
            <div><h3>Device</h3><p>${online} dari ${s.devices.length} terkoneksi</p></div>
            <a class="btn soft sm" href="#/devices">Kelola</a>
          </div>
          ${s.devices.length ? s.devices.map((d) => `
            <div class="list-row compact">
              <span class="circle ${d.status === 'connected' ? 'c-ok' : d.status === 'qr' || d.status === 'connecting' ? 'c-warn' : 'c-bad'}">${icon('device')}</span>
              <div><b>${esc(d.name)}</b><small>${d.phone ? '+' + esc(d.phone) : 'Belum tertaut'}</small></div>
              ${chip(d.status)}
            </div>`).join('') : `<div class="empty">${icon('device')}<div>Belum ada device. <a href="#/devices">Tambah sekarang</a></div></div>`}
        </div>

        ${ctx.isOn('blast') ? `
        <div class="card">
          <div class="card-head">
            <div><h3>Blast</h3><p>Berjalan & selesai 24 jam terakhir</p></div>
            <a class="btn soft sm" href="#/blast">Kelola</a>
          </div>
          ${s.blasts.length ? s.blasts.map((b) => {
            const pct = b.total ? Math.round(((b.sent + b.failed) / b.total) * 100) : 0;
            return `<a class="dash-blast" href="#/blast">
              <div class="row between" style="flex-wrap:nowrap;gap:10px"><b>${esc(b.name)}</b>${chip(b.status)}</div>
              <div class="meter"><i style="width:${pct}%"></i></div>
              <small>${fmt(b.sent)} terkirim${b.failed ? ` · ${fmt(b.failed)} gagal` : ''} · ${fmt(b.total)} penerima · ${pct}%</small>
            </a>`;
          }).join('') : '<div class="muted">Tidak ada blast yang berjalan.</div>'}
        </div>` : ''}
      </div>
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
