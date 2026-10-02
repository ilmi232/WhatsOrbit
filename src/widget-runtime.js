// Kode Chat Widget yang berjalan di website (bukan di server).
// Fungsi `runtime` disalin utuh ke kode tempel, jadi TIDAK boleh memakai variabel dari luar.

/* eslint-disable no-var */
function runtime(C) {
  if (window.__whatsOrbitWidget) return;
  window.__whatsOrbitWidget = true;

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function now() {
    try {
      var o = {};
      new Intl.DateTimeFormat('en-US', { timeZone: C.timezone || 'Asia/Jakarta', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(new Date()).forEach(function (x) { o[x.type] = x.value; });
      return { day: DAYS.indexOf(o.weekday), min: (+o.hour % 24) * 60 + +o.minute };
    } catch (e) {
      var d = new Date();
      return { day: d.getDay(), min: d.getHours() * 60 + d.getMinutes() };
    }
  }
  function toMin(t) { var p = String(t).split(':'); return +p[0] * 60 + +(p[1] || 0); }
  function online(a) {
    var n = now();
    if (a.days && a.days.length && a.days.indexOf(n.day) < 0) return false;
    if (!a.start || !a.end) return true;
    var s = toMin(a.start), e = toMin(a.end);
    return s < e ? n.min >= s && n.min < e : n.min >= s || n.min < e;
  }
  function fill(t) {
    return String(t || '').replace(/\[Halaman\]/gi, document.title || '').replace(/\[URL\]/gi, location.href);
  }
  function track(i) {
    if (!C.track) return;
    try {
      var b = JSON.stringify({ k: C.key, a: i, u: location.href.slice(0, 300) });
      if (navigator.sendBeacon) navigator.sendBeacon(C.track, new Blob([b], { type: 'text/plain' }));
      else fetch(C.track, { method: 'POST', body: b, mode: 'no-cors', keepalive: true });
    } catch (e) { /* abaikan */ }
  }
  function chat(i) {
    var a = C.agents[i];
    track(i);
    var url = 'https://wa.me/' + a.phone + (a.message ? '?text=' + encodeURIComponent(fill(a.message)) : '');
    window.open(url, '_blank', 'noopener');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(n) {
    var p = String(n || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  var WA = '<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M16 3C8.8 3 3 8.7 3 15.8c0 2.5.7 4.9 2 7L3 29l6.4-2c2 1.1 4.3 1.7 6.6 1.7 7.2 0 13-5.7 13-12.8S23.2 3 16 3zm0 23.4c-2.1 0-4.1-.6-5.9-1.7l-.4-.2-3.8 1.2 1.2-3.7-.3-.4c-1.2-1.8-1.8-3.8-1.8-5.9C5 9.9 10 5.1 16 5.1s11 4.8 11 10.7-4.9 10.6-11 10.6zm6-7.9c-.3-.2-2-1-2.3-1.1-.3-.1-.5-.2-.8.2-.2.3-.9 1.1-1.1 1.3-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.7-1.6-1-.9-1.6-1.9-1.8-2.2-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.4.3-.6.1-.2 0-.4 0-.6-.1-.2-.8-1.8-1-2.5-.3-.7-.5-.6-.8-.6h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.7s1.2 3.1 1.4 3.4c.2.2 2.3 3.5 5.6 4.9.8.3 1.4.5 1.9.7.8.2 1.5.2 2.1.1.6-.1 2-.8 2.2-1.6.3-.8.3-1.4.2-1.6-.1-.1-.3-.2-.6-.3z"/></svg>';
  function xIcon(size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }
  var X = xIcon(18);
  var col = C.color || '#25d366';
  var side = C.position === 'left' ? 'left' : 'right';

  var host = document.createElement('div');
  host.setAttribute('data-whatsorbit-widget', '');
  host.style.cssText = 'position:fixed;z-index:2147483000;bottom:20px;' + side + ':20px;';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  root.innerHTML =
    '<style>' +
    ':host,*{box-sizing:border-box}' +
    '.w{font:14px/1.45 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1c2434;display:flex;flex-direction:column;align-items:' + (side === 'left' ? 'flex-start' : 'flex-end') + ';gap:12px}' +
    '.row{display:flex;align-items:center;gap:10px;flex-direction:' + (side === 'left' ? 'row-reverse' : 'row') + '}' +
    '.btn{width:60px;height:60px;border-radius:50%;border:0;background:' + col + ';color:#fff;cursor:pointer;display:grid;place-items:center;box-shadow:0 8px 24px rgba(0,0,0,.22);transition:transform .15s}' +
    '.btn:hover{transform:scale(1.06)}' +
    '.lbl{background:#fff;padding:8px 14px;border-radius:99px;box-shadow:0 4px 16px rgba(0,0,0,.15);font-weight:600;cursor:pointer;white-space:nowrap}' +
    '.greet{position:relative;background:#fff;padding:12px 36px 12px 14px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.18);max-width:260px;cursor:pointer;animation:in .25s ease}' +
    '.greet button{position:absolute;top:6px;right:6px;border:0;background:none;color:#8a94a7;cursor:pointer;padding:2px;display:grid}' +
    '.panel{width:min(340px,calc(100vw - 40px));background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.25);animation:in .2s ease}' +
    '.head{background:' + col + ';color:#fff;padding:18px 44px 18px 18px;position:relative}' +
    '.head b{display:block;font-size:16px}.head span{font-size:12.5px;opacity:.9}' +
    '.head button{position:absolute;top:12px;right:12px;border:0;background:rgba(255,255,255,.2);color:#fff;border-radius:50%;width:28px;height:28px;display:grid;place-items:center;cursor:pointer}' +
    '.list{padding:8px;max-height:min(360px,60vh);overflow:auto}' +
    '.ag{display:flex;gap:12px;align-items:center;width:100%;text-align:left;border:0;background:none;padding:10px;border-radius:12px;cursor:pointer;font:inherit;color:inherit}' +
    '.ag:hover{background:#f3f6fa}' +
    '.av{width:44px;height:44px;border-radius:50%;background:' + col + ';color:#fff;display:grid;place-items:center;font-weight:700;flex:none;position:relative}' +
    '.av i{position:absolute;right:0;bottom:0;width:12px;height:12px;border-radius:50%;border:2px solid #fff;background:#2bc155}' +
    '.av i.off{background:#b5bdca}' +
    '.ag b{display:block;font-weight:600}.ag small{color:#8a94a7;font-size:12px}' +
    '.go{margin-left:auto;color:' + col + '}' +
    '@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){.panel,.greet{animation:none}.btn{transition:none}}' +
    '</style><div class="w"></div>';
  var w = root.querySelector('.w');

  var open = false;
  var greetShown = false;
  function seen(k, v) {
    try { if (v) sessionStorage.setItem('wo_' + k, '1'); return sessionStorage.getItem('wo_' + k) === '1'; } catch (e) { return false; }
  }
  function pickDirect() {
    var on = [], all = [];
    C.agents.forEach(function (a, i) { all.push(i); if (online(a)) on.push(i); });
    var pool = on.length ? on : all;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function draw() {
    var html = '';
    if (open) {
      html += '<div class="panel" role="dialog" aria-label="' + esc(C.title) + '"><div class="head"><b>' + esc(C.title) + '</b><span>' + esc(C.subtitle) + '</span>' +
        '<button data-close aria-label="Tutup">' + X + '</button></div><div class="list">';
      C.agents.forEach(function (a, i) {
        var on = online(a);
        html += '<button class="ag" data-agent="' + i + '"><span class="av">' + esc(initials(a.name)) + '<i class="' + (on ? '' : 'off') + '"></i></span>' +
          '<span><b>' + esc(a.name) + '</b><small>' + esc(a.role || '') + (a.role ? ' · ' : '') + (on ? 'Online' : esc(C.offlineText || 'Offline')) + '</small></span>' +
          '<span class="go">' + WA.replace('width="30" height="30"', 'width="22" height="22"') + '</span></button>';
      });
      html += '</div></div>';
    } else if (greetShown) {
      html += '<div class="greet" data-greet>' + esc(C.greeting) + '<button data-close-greet aria-label="Tutup">' + X + '</button></div>';
    }
    html += '<div class="row">' + (C.label && !open ? '<span class="lbl" data-toggle>' + esc(C.label) + '</span>' : '') +
      '<button class="btn" data-toggle aria-label="' + esc(C.title || 'Chat WhatsApp') + '">' + (open ? xIcon(26) : WA) + '</button></div>';
    w.innerHTML = html;
  }
  w.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : e.target.parentElement;
    if (t.closest('[data-close-greet]')) { greetShown = false; seen('greet', 1); draw(); return; }
    if (t.closest('[data-agent]')) { chat(+t.closest('[data-agent]').getAttribute('data-agent')); return; }
    if (t.closest('[data-close]')) { open = false; draw(); return; }
    if (t.closest('[data-toggle]') || t.closest('[data-greet]')) {
      greetShown = false;
      seen('greet', 1);
      if (C.mode === 'direct') { chat(pickDirect()); draw(); return; }
      open = !open;
      draw();
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) { open = false; draw(); } });
  draw();
  if (C.greeting && !seen('greet')) {
    setTimeout(function () { if (!open) { greetShown = true; draw(); } }, (C.greetingDelay || 0) * 1000);
  }
  (document.body || document.documentElement).appendChild(host);
}

/** Buat kode tempel `<script>` lengkap dengan pengaturan widget. */
export function buildSnippet(config) {
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<!-- WhatsOrbit Chat Widget: ${config.name.replace(/--/g, '-')} -->\n<script>\n(${runtime.toString()})(${json});\n</script>`;
}
