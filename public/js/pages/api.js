import { $, copyText, esc, icon } from '../ui.js';

export default {
  async mount(el, ctx) {
    const devices = await ctx.loadDevices();
    const base = (ctx.state.info?.publicUrl || location.origin).replace(/\/+$/, '');
    const key = devices[0]?.api_key ?? 'API_KEY_DEVICE';
    const curl = `curl -X POST ${base}/api/send \\
  -H "Authorization: ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"messageType":"text","to":"081234567890","body":"Halo dari WhatsOrbit"}'`;

    el.innerHTML = `
    <div class="grid g-2">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h3>Kirim pesan</h3><p>Format kompatibel dengan Starsender</p></div></div>
          <div class="row" style="margin-bottom:14px"><span class="chip ok">POST</span><code>${esc(base)}/api/send</code></div>
          <table>
            <tr><th>Header</th><th>Nilai</th></tr>
            <tr><td><code>Authorization</code></td><td>API key device (lihat menu Device)</td></tr>
            <tr><td><code>Content-Type</code></td><td><code>application/json</code></td></tr>
          </table>
          <table style="margin-top:14px">
            <tr><th>Body</th><th>Keterangan</th></tr>
            <tr><td><code>messageType</code></td><td><code>"text"</code></td></tr>
            <tr><td><code>to</code></td><td>Nomor tujuan: <code>08…</code>, <code>+62…</code>, <code>62…</code>, atau beberapa dipisah koma</td></tr>
            <tr><td><code>body</code></td><td>Isi pesan</td></tr>
          </table>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Cek status device</h3><p>Pakai header Authorization yang sama</p></div></div>
          <div class="row"><span class="chip info">GET</span><code>${esc(base)}/api/status</code></div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head">
            <div><h3>Contoh (cURL)</h3><p>Memakai API key device "${esc(devices[0]?.name ?? '-')}"</p></div>
            <button class="btn soft sm" id="copyCurl">${icon('copy')} Copy</button>
          </div>
          <pre class="code" id="curl">${esc(curl)}</pre>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Contoh respons</h3></div></div>
          <pre class="code">{
  "success": true,
  "message": "Pesan masuk antrean",
  "data": {
    "device": "Humas A",
    "deviceStatus": "connected",
    "queued": [{ "to": "6281234567890", "id": 12 }],
    "invalid": []
  }
}</pre>
          <p class="muted" style="margin:12px 0 0">Pesan dikirim berurutan dengan jeda acak & efek mengetik. Status akhir terlihat di Log Pesan.
          Lewat ngrok gratis, tambahkan header <code>ngrok-skip-browser-warning: 1</code>.</p>
        </div>
      </div>
    </div>`;
    $('#copyCurl', el).addEventListener('click', () => copyText(curl, 'Contoh disalin'));
  },
};
