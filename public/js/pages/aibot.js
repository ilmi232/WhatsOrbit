import { $, $$, chip, confirmBox, esc, fmt, icon, localTime, timeAgo } from '../ui.js';

let S = null; // pengaturan tersimpan (key disamarkan)
let P = {}; // daftar penyedia
let defaultPrompt = '';
let draft = null;
let newKeys = {}; // key yang baru diketik (belum disimpan)
let dirty = false;
let simLog = [];
let ctxRef = null;

const waFormat = (s) => esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>');
const modelOf = () => draft.models[draft.provider] || P[draft.provider].defaultModel || '';

// Judul singkat + keterangan kecil di kartu pilihan penyedia
const PROV_LABEL = {
  gemini: ['Google Gemini', 'AI Studio · disarankan'],
  groq: ['Groq', 'Llama dll., sangat cepat'],
  openrouter: ['OpenRouter', 'Banyak model, ada yang gratis'],
  openai: ['OpenAI', 'ChatGPT'],
  anthropic: ['Claude', 'Anthropic'],
  custom: ['Server lain', 'Kompatibel OpenAI (Ollama dll.)'],
};

function providerCards() {
  return Object.entries(P).map(([k, p]) => {
    const [title, sub] = PROV_LABEL[k] ?? [p.name, ''];
    return `
    <label class="prov-card ${draft.provider === k ? 'on' : ''}">
      <input type="radio" name="prov" value="${k}" ${draft.provider === k ? 'checked' : ''}>
      <span class="prov-top"><b>${esc(title)}</b><span class="prov-tick">${icon('check')}</span></span>
      <span class="prov-sub">${esc(sub ?? '')}</span>
      <span class="prov-foot">${p.free ? chip('ok', 'Ada gratis') : chip('muted', 'Berbayar')}
        ${S.keys[k] ? `<span class="prov-key">${icon('key')} tersimpan</span>` : ''}</span>
    </label>`;
  }).join('');
}

// Daftar model hasil "Muat daftar model", per penyedia: { models, recommended }
const modelLists = {};

function modelOptions(k) {
  const l = modelLists[k];
  if (!l) return '';
  const cur = modelOf();
  const opt = (m) => `<option value="${esc(m)}" ${m === cur ? 'selected' : ''}>${esc(m)}</option>`;
  const rest = l.models.filter((m) => !l.recommended.includes(m));
  return (l.recommended.length ? `<optgroup label="Disarankan">${l.recommended.map(opt).join('')}</optgroup>` : '') +
    `<optgroup label="Semua model (terbaru dulu)">${rest.map(opt).join('')}</optgroup>` +
    (cur && !l.models.includes(cur) ? `<option value="${esc(cur)}" selected>${esc(cur)} (tidak ada di daftar)</option>` : '') +
    '<option value="__manual">Ketik nama model sendiri…</option>';
}

function modelHint(k) {
  const l = modelLists[k];
  const free = l.models.filter((m) => m.endsWith(':free')).length;
  return `${l.models.length} model chat tersedia${free ? `, ${free} gratis (:free)` : ''}. Yang <b>Disarankan</b> paling cocok untuk chat WhatsApp.`;
}

function providerDetail() {
  const k = draft.provider;
  const p = P[k];
  const saved = S.keys[k];
  return `
    <div class="est" style="margin:0 0 14px">${esc(p.note)}</div>
    <div class="field"><span>API key ${p.keyOptional ? '<span class="hint">— opsional</span>' : ''}</span>
      <div class="row" style="flex-wrap:nowrap">
        <input type="password" id="apiKey" autocomplete="off" placeholder="${saved ? `Tersimpan (${esc(saved)}) — isi untuk mengganti` : 'Tempel API key di sini'}" value="${esc(newKeys[k] ?? '')}">
        ${saved ? `<button type="button" class="btn bad-soft sm" id="clearKey" title="Hapus API key">${icon('trash')}</button>` : ''}
      </div>
      ${p.keyUrl ? `<span class="hint">Belum punya? <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener">Buat API key di sini ↗</a></span>` : ''}
    </div>
    ${p.kind === 'openai' ? `
      <label class="field"><span>Base URL</span>
        <input id="baseUrl" value="${esc(draft.baseUrls[k] ?? '')}" placeholder="${esc(p.baseUrl)}">
        <span class="hint">Kosongkan untuk memakai bawaan: ${esc(p.baseUrl)}</span>
      </label>` : ''}
    <div class="field"><span>Model</span>
      <div class="row" style="flex-wrap:nowrap">
        <select id="modelSelect" class="${modelLists[k] ? '' : 'hidden'}" aria-label="Pilih model">${modelOptions(k)}</select>
        <input id="model" class="${modelLists[k] ? 'hidden' : ''}" value="${esc(modelOf())}" placeholder="${p.defaultModel ? esc(p.defaultModel) : 'Klik “Muat daftar model”'}" aria-label="Nama model">
        <button type="button" class="btn soft sm" id="loadModels" style="white-space:nowrap">${icon('refresh')} Muat daftar model</button>
      </div>
      <span class="hint" id="modelHint">${modelLists[k] ? modelHint(k) : k === 'openrouter' ? 'Pilih model berakhiran <b>:free</b> untuk gratis.' : 'Klik “Muat daftar model” untuk melihat model yang tersedia untuk API key Anda.'}</span>
    </div>
    <div class="row">
      <button type="button" class="btn grad" id="testConn">${icon('play')} Tes koneksi</button>
      <span class="muted" id="testOut"></span>
    </div>`;
}

function settingsHtml(ctx) {
  const d = draft;
  return `
    <div class="field"><span>Kapan AI menjawab</span>
      <div class="seg" data-seg="mode">
        <button type="button" data-v="fallback" class="${d.mode === 'fallback' ? 'on' : ''}">Semua pertanyaan lain</button>
        <button type="button" data-v="prefix" class="${d.mode === 'prefix' ? 'on' : ''}">Hanya dengan awalan</button>
      </div>
      <span class="hint" id="modeHint">${d.mode === 'fallback'
        ? 'AI menjawab chat pribadi yang tidak ditangani Chat Bot atau aturan kata kunci Autoreply. Aturan Autoreply "Semua pesan" dilewati.'
        : `AI hanya menjawab pesan yang diawali "${esc(d.prefix)}", mis. "${esc(d.prefix)} kapan pendaftaran dibuka?"`}</span>
    </div>
    <label class="field ${d.mode === 'prefix' ? '' : 'hidden'}" id="prefixBox"><span>Kata awalan</span><input data-s="prefix" value="${esc(d.prefix)}"></label>
    <div class="field"><span>Device <span class="hint">— tidak dipilih = semua</span></span>
      <div class="row">${ctx.state.devices.map((x) => `<label class="check"><input type="checkbox" data-dev value="${x.id}" ${d.deviceIds.includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('')}</div>
    </div>
    <div class="grid g-2" style="gap:12px">
      <label class="field"><span>Batas jawaban per hari <span class="hint">— jaga kuota/biaya</span></span><input type="number" min="1" data-s="dailyLimit" value="${d.dailyLimit}"></label>
      <label class="field"><span>Maks. jawaban per chat per jam</span><input type="number" min="1" data-s="perChatHourly" value="${d.perChatHourly}"></label>
      <label class="field"><span>Ingat percakapan (pasang pesan)</span><input type="number" min="0" max="20" data-s="historyTurns" value="${d.historyTurns}"></label>
      <label class="field"><span>AI diam setelah serah ke admin (jam)</span><input type="number" min="0" data-s="handoverHours" value="${d.handoverHours}"></label>
    </div>
    <label class="field"><span>Pesan kalau AI gagal <span class="hint">— kosong = tidak membalas (muncul di Pesan Masuk sebagai "AI gagal")</span></span>
      <input data-s="errorText" value="${esc(d.errorText)}" placeholder="Maaf, sedang ada gangguan. Admin akan membalas secepatnya 🙏"></label>
    <details>
      <summary style="cursor:pointer;font-weight:600;margin-bottom:10px">Lanjutan</summary>
      <div class="grid g-2" style="gap:12px">
        <label class="field"><span>Kreativitas (temperature 0–1)</span><input type="number" step="0.1" min="0" max="1.5" data-s="temperature" value="${d.temperature}"></label>
        <label class="field"><span>Panjang jawaban maks. (token)</span><input type="number" min="128" max="8192" data-s="maxTokens" value="${d.maxTokens}"></label>
      </div>
      <label class="field"><span>Instruksi untuk AI (system prompt)</span>
        <textarea data-s="prompt" style="min-height:170px">${esc(d.prompt)}</textarea>
        <span class="hint">Tanda <b>[ADMIN]</b> di jawaban AI = serahkan ke admin (tanda ini tidak ikut terkirim). <a href="#" id="resetPrompt">Kembalikan bawaan</a></span>
      </label>
    </details>`;
}

function renderSim(el) {
  $('#simLog', el).innerHTML = simLog.length
    ? simLog.map((m) => `<div class="sim-msg ${m.role === 'user' ? 'me' : ''}">${waFormat(m.text)}${m.meta ? `<div style="font-size:11px;opacity:.6;margin-top:4px">${esc(m.meta)}</div>` : ''}</div>`).join('')
    : '<div class="muted" style="text-align:center;padding:30px 10px">Tanyakan sesuatu, mis. <b>kapan pendaftaran dibuka?</b></div>';
  $('#simLog', el).scrollTop = 1e6;
}

function testBody(el) {
  return {
    provider: draft.provider,
    apiKey: newKeys[draft.provider] ?? '',
    baseUrl: draft.baseUrls[draft.provider] ?? '',
    model: modelOf(),
    prompt: draft.prompt,
    knowledge: draft.knowledge,
    temperature: Number(draft.temperature),
    maxTokens: Number(draft.maxTokens),
  };
}

async function loadStats(el, ctx) {
  const { data } = await ctx.call('GET', '/admin/aibot/stats');
  const t = data.today;
  $('#stToday', el).textContent = fmt(t.requests);
  $('#stLimit', el).textContent = `dari ${fmt(S.dailyLimit)} / hari`;
  $('#stErr', el).textContent = fmt(t.errors);
  $('#stTok', el).textContent = fmt(t.input + t.output);
  $('#lastErr', el).innerHTML = data.lastError
    ? `<div class="muted c-bad" style="margin-top:10px">Error terakhir (${esc(new Date(data.lastError.at).toLocaleString('id-ID'))}): ${esc(data.lastError.message)}</div>` : '';
  $('#convs', el).innerHTML = data.conversations.length
    ? data.conversations.map((c) => `
      <div class="list-row" style="grid-template-columns:minmax(0,1fr) auto;align-items:start">
        <div style="min-width:0">
          <b>${esc(c.chat_jid.endsWith('@s.whatsapp.net') ? '0' + c.chat_jid.split('@')[0].replace(/^62/, '') : 'Nomor tersembunyi')}
            <span class="muted" style="font-weight:400">· ${esc(c.device_name ?? '')} · ${timeAgo(c.last_at)}</span></b>
          <small style="white-space:normal">❓ ${esc((c.last_q ?? '').slice(0, 120))}</small>
          <small style="white-space:normal">🤖 ${esc((c.last_a ?? '').slice(0, 160))}</small>
        </div>
        ${c.paused_until ? `<button class="btn soft sm" data-resume="${esc(c.chat_jid)}" title="AI diam sampai ${esc(localTime(c.paused_until))}">${icon('play')} AI aktif lagi</button>` : ''}
      </div>`).join('')
    : '<div class="muted">Belum ada percakapan.</div>';
}

function render(el, ctx) {
  el.innerHTML = `
    <div class="card" style="margin-bottom:24px">
      <div class="row between">
        <div class="row" style="gap:14px;min-width:0">
          <div class="device-ico ${S.active ? 'on' : ''}">${icon('sparkles')}</div>
          <div>
            <b style="font-size:16px">${S.active ? 'AI Chat Bot aktif' : 'AI Chat Bot nonaktif'}</b>
            <div class="muted">${esc(P[S.provider].name)} · ${esc(S.models[S.provider] || P[S.provider].defaultModel || '-')}</div>
          </div>
        </div>
        <div class="row" style="gap:22px">
          <div class="mini-stats" style="display:flex;margin:0;gap:10px">
            <div><b id="stToday">0</b><small id="stLimit">hari ini</small></div>
            <div><b id="stErr" class="c-bad">0</b><small>Gagal hari ini</small></div>
            <div><b id="stTok">0</b><small>Token hari ini</small></div>
          </div>
          <label class="switch" title="${S.active ? 'Nonaktifkan' : 'Aktifkan'}"><input type="checkbox" id="aiActive" ${S.active ? 'checked' : ''} aria-label="AI aktif"><i></i></label>
        </div>
      </div>
      <div id="lastErr"></div>
    </div>

    <div class="grid g-dash">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h3>Penyedia AI</h3><p>API key disimpan di database WhatsOrbit di PC ini</p></div></div>
          <div class="prov-grid" id="provCards">${providerCards()}</div>
          <div id="provDetail">${providerDetail()}</div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Informasi Sekolah</h3><p>Bahan jawaban AI. AI diminta hanya menjawab dari sini dan tidak mengarang.</p></div></div>
          <textarea data-s="knowledge" style="min-height:260px" placeholder="Nama sekolah: ...
Alamat: ...
Jam operasional: Senin–Jumat 07.00–15.00
PPDB 2026: gelombang 1 tanggal ..., syarat: ..., biaya: ...
Kontak admin: ...">${esc(draft.knowledge)}</textarea>
          <div class="hint muted" style="margin-top:6px"><span id="kbCount">${fmt(draft.knowledge.length)}</span> / 60.000 karakter. Jangan masukkan data pribadi siswa.</div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Pengaturan</h3></div></div>
          ${settingsHtml(ctx)}
        </div>
        <div class="card" style="position:sticky;bottom:12px;z-index:2;padding:16px 24px">
          <div class="row between">
            <span class="muted" id="saveState">${dirty ? 'Ada perubahan yang belum disimpan' : 'Semua perubahan tersimpan'}</span>
            <button class="btn grad" id="saveAi">${icon('check')} Simpan</button>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head">
            <div><h3>Simulator</h3><p>Memakai pengaturan yang sedang diedit. Setiap pertanyaan memakai kuota AI.</p></div>
            <button class="btn ghost sm" id="simReset">${icon('refresh')} Ulang</button>
          </div>
          <div id="simLog" class="sim-log"></div>
          <form id="simForm" class="row" style="flex-wrap:nowrap;margin-top:10px">
            <input name="t" placeholder="Tulis pertanyaan…" autocomplete="off" aria-label="Pertanyaan simulator">
            <button class="btn grad">${icon('send')}</button>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Percakapan Terakhir</h3><p>Chat yang dijawab AI</p></div></div>
          <div id="convs"></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Penting diketahui</h3></div></div>
          <ul class="muted" style="margin:0;padding-left:18px;line-height:1.8">
            <li><b>Paket gratis</b> (Gemini, Groq, OpenRouter :free) punya batas per menit/hari. Kalau habis, AI gagal menjawab sampai kuota pulih.</li>
            <li>Di paket gratis Gemini, Google dapat memakai isi percakapan untuk meningkatkan layanannya. <b>Jangan</b> masukkan data pribadi siswa ke Informasi Sekolah.</li>
            <li>AI bisa salah. Isi Informasi Sekolah selengkap mungkin dan uji di simulator sebelum diaktifkan.</li>
            <li>Urutan: Chat Bot → Autoreply (kata kunci) → AI. AI hanya chat pribadi, bukan grup.</li>
            <li>Kalau pengguna minta bicara dengan admin, AI menyerahkan chat dan diam selama ${draft.handoverHours} jam.</li>
          </ul>
        </div>
      </div>
    </div>`;
  renderSim(el);
  loadStats(el, ctx).catch(() => {});
  // Key sudah tersimpan -> muat daftar model otomatis (sekali per penyedia)
  if ((S.keys[draft.provider] || P[draft.provider].keyOptional) && !modelLists[draft.provider]) $('#loadModels', el)?.click();
}

function markDirty(el) {
  dirty = true;
  $('#saveState', el).textContent = 'Ada perubahan yang belum disimpan';
}

async function load(ctx) {
  const res = await ctx.call('GET', '/admin/aibot/settings');
  S = res.data;
  P = res.providers;
  defaultPrompt = res.defaultPrompt;
  draft = JSON.parse(JSON.stringify(S));
  newKeys = {};
  dirty = false;
}

function payload() {
  const keys = {};
  for (const [k, v] of Object.entries(newKeys)) if (v) keys[k] = v;
  const { keys: _ignored, active: _a, ...rest } = draft;
  return { ...rest, keys };
}

function bind(el, ctx) {
  el.addEventListener('click', async (e) => {
    const t = e.target;
    try {
      if (t.closest('#saveAi')) {
        const { data } = await ctx.call('PUT', '/admin/aibot/settings', payload());
        S = data;
        newKeys = {};
        draft = { ...JSON.parse(JSON.stringify(S)), knowledge: draft.knowledge };
        dirty = false;
        ctx.toast('Tersimpan');
        return render(el, ctx);
      }
      if (t.closest('#clearKey')) {
        if (!(await confirmBox(`Hapus API key ${P[draft.provider].name}?`, '', { danger: true, okText: 'Hapus' }))) return;
        const { data } = await ctx.call('PUT', '/admin/aibot/settings', { keys: { [draft.provider]: null }, ...(S.provider === draft.provider && S.active ? { active: false } : {}) });
        S = { ...S, keys: data.keys, active: data.active };
        draft.keys = data.keys;
        ctx.toast('API key dihapus');
        return render(el, ctx);
      }
      if (t.closest('#loadModels')) {
        const btn = t.closest('#loadModels');
        btn.disabled = true;
        $('#modelHint', el).textContent = 'Memuat…';
        try {
          const k = draft.provider;
          const res = await ctx.call('POST', '/admin/aibot/models', { provider: k, apiKey: newKeys[k] ?? '', baseUrl: draft.baseUrls[k] ?? '' });
          if (!res.data.length) throw new Error('Tidak ada model chat yang tersedia untuk API key ini');
          modelLists[k] = { models: res.data, recommended: res.recommended ?? [] };
          // Model sekarang kosong / tidak tersedia -> pilih yang disarankan (terbaru)
          if (!modelOf() || !res.data.includes(modelOf())) {
            draft.models = { ...draft.models, [k]: res.recommended?.[0] ?? res.data[0] };
            markDirty(el);
          }
          $('#provDetail', el).innerHTML = providerDetail();
          return;
        } catch (err) {
          $('#modelHint', el).innerHTML = `<span class="c-bad">${esc(err.message)}</span>`;
        } finally { btn.disabled = false; }
        return;
      }
      if (t.closest('#testConn')) {
        const out = $('#testOut', el);
        out.textContent = 'Menghubungi AI…';
        try {
          const { data } = await ctx.call('POST', '/admin/aibot/test', { ...testBody(el), history: [{ role: 'user', text: 'Halo, tolong perkenalkan dirimu dalam satu kalimat.' }] });
          out.innerHTML = `<span class="c-ok">Berhasil (${(data.ms / 1000).toFixed(1)} dtk, ${esc(data.model)}):</span> ${esc(data.text.slice(0, 160))}`;
        } catch (err) {
          out.innerHTML = `<span class="c-bad">Gagal: ${esc(err.message)}</span>`;
        }
        return;
      }
      if (t.closest('#resetPrompt')) {
        e.preventDefault();
        draft.prompt = defaultPrompt;
        $('[data-s=prompt]', el).value = defaultPrompt;
        return markDirty(el);
      }
      if (t.closest('#simReset')) { simLog = []; return renderSim(el); }
      const seg = t.closest('[data-seg] [data-v]');
      if (seg) {
        draft.mode = seg.dataset.v;
        seg.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === seg));
        $('#prefixBox', el).classList.toggle('hidden', draft.mode !== 'prefix');
        $('#modeHint', el).textContent = draft.mode === 'fallback'
          ? 'AI menjawab chat pribadi yang tidak ditangani Chat Bot atau aturan kata kunci Autoreply. Aturan Autoreply "Semua pesan" dilewati.'
          : `AI hanya menjawab pesan yang diawali "${draft.prefix}".`;
        return markDirty(el);
      }
      const resume = t.closest('[data-resume]');
      if (resume) {
        await ctx.call('POST', '/admin/aibot/resume', { chatJid: resume.dataset.resume });
        return loadStats(el, ctx);
      }
    } catch (err) { ctx.toast(err.message); }
  });

  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'apiKey') { newKeys[draft.provider] = t.value.trim(); return markDirty(el); }
    if (t.id === 'model') { draft.models = { ...draft.models, [draft.provider]: t.value.trim() }; return markDirty(el); }
    if (t.id === 'baseUrl') { draft.baseUrls = { ...draft.baseUrls, [draft.provider]: t.value.trim() }; return markDirty(el); }
    const k = t.dataset.s;
    if (k) {
      draft[k] = t.type === 'number' ? Number(t.value) : t.value;
      if (k === 'knowledge') $('#kbCount', el).textContent = fmt(t.value.length);
      return markDirty(el);
    }
    if (t.matches('[data-dev]')) {
      draft.deviceIds = $$('[data-dev]:checked', el).map((x) => x.value);
      markDirty(el);
    }
  });

  el.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.name === 'prov') {
      draft.provider = t.value;
      $$('.prov-card', el).forEach((c) => c.classList.toggle('on', c.contains(t)));
      $('#provDetail', el).innerHTML = providerDetail();
      return markDirty(el);
    }
    if (t.id === 'modelSelect') {
      if (t.value === '__manual') {
        t.classList.add('hidden');
        const inp = $('#model', el);
        inp.classList.remove('hidden');
        inp.value = modelOf();
        inp.focus();
        return;
      }
      draft.models = { ...draft.models, [draft.provider]: t.value };
      $('#model', el).value = t.value;
      return markDirty(el);
    }
    if (t.matches('[data-dev]')) t.dispatchEvent(new Event('input', { bubbles: true }));
    if (t.id === 'aiActive') {
      const on = t.checked;
      if (on && dirty) { t.checked = false; return ctx.toast('Simpan perubahan dulu'); }
      if (on && !(await confirmBox('Aktifkan AI Chat Bot?', `AI (${P[S.provider].name}) akan mulai menjawab chat pribadi${S.mode === 'prefix' ? ` yang diawali "${S.prefix}"` : ''}. Sudah dicoba di simulator?`, { okText: 'Aktifkan' }))) {
        t.checked = false;
        return;
      }
      try {
        const { data } = await ctx.call('PUT', '/admin/aibot/settings', { active: on });
        S = data;
        draft.active = on;
        ctx.toast(on ? 'AI Chat Bot aktif' : 'AI Chat Bot dinonaktifkan');
        render(el, ctx);
      } catch (err) { t.checked = !on; ctx.toast(err.message); }
    }
  });

  el.addEventListener('submit', async (e) => {
    if (e.target.id !== 'simForm') return;
    e.preventDefault();
    const text = e.target.t.value.trim();
    if (!text) return;
    e.target.t.value = '';
    simLog.push({ role: 'user', text });
    simLog.push({ role: 'assistant', text: '…' });
    renderSim(el);
    const history = simLog.slice(0, -1).filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    try {
      const { data } = await ctxRef.call('POST', '/admin/aibot/test', { ...testBody(el), history });
      simLog[simLog.length - 1] = {
        role: 'assistant',
        text: data.text || (data.refused ? '(AI menolak menjawab)' : '(kosong)'),
        meta: `${(data.ms / 1000).toFixed(1)} dtk · ${data.usage.input + data.usage.output} token${data.admin ? ' · diserahkan ke admin' : ''}`,
      };
    } catch (err) {
      simLog[simLog.length - 1] = { role: 'assistant', text: `⚠️ ${err.message}`, error: true };
      simLog[simLog.length - 2].error = true;
    }
    renderSim(el);
    loadStats(el, ctxRef).catch(() => {});
  });
}

export default {
  async mount(el, ctx) {
    ctxRef = ctx;
    await ctx.loadDevices();
    await load(ctx);
    simLog = [];
    bind(el, ctx);
    render(el, ctx);
  },
  async refresh(el, ctx) {
    if (document.querySelector('.modal-bg')) return;
    await loadStats(el, ctx);
  },
};
