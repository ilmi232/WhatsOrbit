// Penyedia AI untuk AI Chat Bot. Satu antarmuka untuk semua:
//   chat({ provider, apiKey, baseUrl, model, system, history, maxTokens, temperature })
//     -> { text, refused, usage: { input, output } }
//   listModels({ provider, apiKey, baseUrl }) -> [id]

export const PROVIDERS = {
  gemini: {
    name: 'Google Gemini (AI Studio)', kind: 'gemini', free: true,
    keyUrl: 'https://aistudio.google.com/apikey', defaultModel: '',
    note: 'Ada kuota gratis dengan batas per menit/hari. Klik "Muat daftar model" lalu pilih model terbaru (seri Flash cocok untuk chat). Di paket gratis, Google dapat memakai data percakapan untuk meningkatkan layanannya.',
  },
  groq: {
    name: 'Groq', kind: 'openai', free: true, baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys', defaultModel: 'llama-3.3-70b-versatile',
    note: 'Ada kuota gratis, sangat cepat. Model open-source (Llama, dll.).',
  },
  openrouter: {
    name: 'OpenRouter', kind: 'openai', free: true, baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys', defaultModel: '',
    note: 'Banyak model dari berbagai penyedia. Model berakhiran ":free" gratis dengan batas harian.',
  },
  openai: {
    name: 'OpenAI (ChatGPT)', kind: 'openai', free: false, baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys', defaultModel: 'gpt-4.1-mini',
    note: 'Berbayar per pemakaian.',
  },
  anthropic: {
    name: 'Anthropic Claude', kind: 'anthropic', free: false,
    keyUrl: 'https://console.anthropic.com/settings/keys', defaultModel: 'claude-opus-5',
    note: 'Berbayar per pemakaian. claude-opus-5 paling pintar; claude-haiku-4-5 jauh lebih murah untuk jawaban singkat.',
  },
  custom: {
    name: 'Server lain (kompatibel OpenAI)', kind: 'openai', free: true, baseUrl: 'http://localhost:11434/v1',
    keyUrl: null, defaultModel: '', keyOptional: true,
    note: 'Mis. Ollama / LM Studio di PC sendiri (gratis & privat, tapi butuh RAM besar), atau DeepSeek dll. API key boleh kosong.',
  },
};

class AiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function readJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 300) }; }
}

function httpError(res, data) {
  const msg = data?.error?.message ?? data?.error ?? data?.message ?? data?.raw ?? res.statusText;
  const badKey = res.status === 401 || res.status === 403 || /api[ _-]?key/i.test(String(msg));
  const retired = /no longer available|deprecated|has been (shut ?down|retired)/i.test(String(msg));
  const hint = retired ? ' (model ini sudah ditutup, klik "Muat daftar model" dan pilih yang lebih baru)'
    : badKey ? ' (API key salah/tidak berlaku)'
    : res.status === 429 ? ' (kuota/batas pemakaian habis, coba lagi nanti)'
    : res.status === 404 ? ' (nama model tidak ditemukan)' : '';
  return new AiError(`${typeof msg === 'string' ? msg : JSON.stringify(msg)}${hint}`, res.status);
}

const timeout = (ms) => AbortSignal.timeout(ms);

// ---- Google Gemini --------------------------------------------------------------------
async function geminiChat({ apiKey, model, system, history, maxTokens, temperature }) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
      // Model Gemini terbaru "berpikir" dulu dan itu ikut memakai jatah token jawaban,
      // jadi beri ruang cukup; panjang jawaban tetap dibatasi lewat instruksi.
      generationConfig: { temperature, maxOutputTokens: Math.max(maxTokens, 8192) },
    }),
    signal: timeout(90_000),
  });
  const data = await readJson(res);
  if (!res.ok) throw httpError(res, data);
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
  if (!text && cand?.finishReason === 'MAX_TOKENS') {
    throw new AiError('Jawaban terpotong sebelum selesai (naikkan "Panjang jawaban maks." di Lanjutan)');
  }
  return {
    text,
    refused: !text && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION'].includes(cand?.finishReason ?? data.promptFeedback?.blockReason),
    usage: { input: data.usageMetadata?.promptTokenCount ?? 0, output: data.usageMetadata?.candidatesTokenCount ?? 0 },
  };
}

async function geminiModels({ apiKey }) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': apiKey },
    signal: timeout(20_000),
  });
  const data = await readJson(res);
  if (!res.ok) throw httpError(res, data);
  return (data.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
}

// ---- OpenAI & yang kompatibel (Groq, OpenRouter, Ollama, ...) -------------------------------
async function openaiChat({ provider, apiKey, baseUrl, model, system, history, maxTokens, temperature }) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const body = {
    model,
    messages: [{ role: 'system', content: system }, ...history.map((m) => ({ role: m.role, content: m.text }))],
    temperature,
  };
  // OpenAI memakai max_completion_tokens; penyedia kompatibel lain umumnya max_tokens
  if (provider === 'openai') body.max_completion_tokens = maxTokens;
  else body.max_tokens = maxTokens;
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(provider === 'openrouter' ? { 'X-Title': 'WhatsOrbit' } : {}),
    },
    body: JSON.stringify(body),
    signal: timeout(90_000),
  });
  const data = await readJson(res);
  if (!res.ok) throw httpError(res, data);
  const choice = data.choices?.[0];
  return {
    text: String(choice?.message?.content ?? '').trim(),
    refused: choice?.finish_reason === 'content_filter',
    usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
  };
}

async function openaiModels({ apiKey, baseUrl }) {
  const res = await fetch(`${String(baseUrl).replace(/\/+$/, '')}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: timeout(20_000),
  });
  const data = await readJson(res);
  if (!res.ok) throw httpError(res, data);
  return (data.data ?? data.models ?? []).map((m) => m.id ?? m.name).filter(Boolean);
}

// ---- Anthropic Claude (SDK resmi, dimuat hanya saat dipakai) ---------------------------------
let AnthropicSdk = null;
async function anthropicClient(apiKey) {
  AnthropicSdk ??= (await import('@anthropic-ai/sdk')).default;
  return new AnthropicSdk({ apiKey, timeout: 120_000, maxRetries: 1 });
}

function anthropicError(err) {
  if (!(err instanceof AnthropicSdk.APIError)) return err;
  const msg = err.error?.error?.message ?? err.message;
  if (err instanceof AnthropicSdk.AuthenticationError || err instanceof AnthropicSdk.PermissionDeniedError) {
    return new AiError(`${msg} (API key salah/tidak berlaku)`, err.status);
  }
  if (err instanceof AnthropicSdk.RateLimitError) return new AiError(`${msg} (batas pemakaian, coba lagi nanti)`, 429);
  if (err instanceof AnthropicSdk.NotFoundError) return new AiError(`${msg} (nama model tidak ditemukan)`, 404);
  return new AiError(msg, err.status);
}

async function anthropicChat({ apiKey, model, system, history }) {
  const client = await anthropicClient(apiKey);
  const messages = history.map((m) => ({ role: m.role, content: m.text }));
  // Model terbaru (Opus 5 / Fable): aktifkan fallback otomatis kalau permintaan ditolak filter keamanan
  const withFallback = /^claude-(opus-5|fable-5)/.test(model);
  let response;
  try {
    response = withFallback
      ? await client.beta.messages.create({
          model, max_tokens: 16000, system, messages,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        })
      : await client.messages.create({ model, max_tokens: 16000, system, messages });
  } catch (err) {
    throw anthropicError(err);
  }
  if (response.stop_reason === 'refusal') return { text: '', refused: true, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } };
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return { text, refused: false, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } };
}

async function anthropicModels({ apiKey }) {
  const client = await anthropicClient(apiKey);
  const ids = [];
  try {
    for await (const m of client.models.list()) ids.push(m.id);
  } catch (err) {
    throw anthropicError(err);
  }
  return ids;
}

// ---- Antarmuka umum ------------------------------------------------------------------------
export async function chat(opts) {
  const p = PROVIDERS[opts.provider];
  if (!p) throw new AiError('Penyedia AI tidak dikenal');
  if (!opts.model) throw new AiError('Pilih model dulu');
  if (!opts.apiKey && !p.keyOptional) throw new AiError('API key belum diisi');
  if (p.kind === 'gemini') return geminiChat(opts);
  if (p.kind === 'anthropic') return anthropicChat(opts);
  return openaiChat({ ...opts, baseUrl: opts.baseUrl || p.baseUrl });
}

// Model yang bukan untuk chat teks (suara, gambar, embedding, dll.)
const NON_CHAT = /(tts|image|imagen|embed|audio|live|veo|aqa|robotics|computer-use|whisper|dall-e|moderation|transcribe|realtime|guard|search)/i;

/** Versi dari nama model, mis. "gemini-3.5-flash" -> 3.5 (0 kalau tidak ada). */
const versionOf = (id) => Number(id.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);

/**
 * Daftar model chat, terbaru dulu. Mengembalikan { models, recommended }.
 * `recommended` = beberapa model yang disarankan untuk chat WhatsApp (cepat & murah).
 */
export async function listModels(opts) {
  const p = PROVIDERS[opts.provider];
  if (!p) throw new AiError('Penyedia AI tidak dikenal');
  if (!opts.apiKey && !p.keyOptional) throw new AiError('Isi API key dulu');
  const raw = p.kind === 'gemini' ? await geminiModels(opts)
    : p.kind === 'anthropic' ? await anthropicModels(opts)
    : await openaiModels({ ...opts, baseUrl: opts.baseUrl || p.baseUrl });
  const unstable = (id) => /(preview|exp|experimental|latest)/i.test(id);
  const models = [...new Set(raw)]
    .filter((id) => !NON_CHAT.test(id))
    .sort((a, b) => versionOf(b) - versionOf(a) || Number(unstable(a)) - Number(unstable(b)) || a.localeCompare(b));
  let recommended = [];
  if (p.kind === 'gemini') {
    // Versi tertinggi yang punya model stabil (bukan preview); di situ ambil Flash & Flash-Lite
    const stable = models.filter((m) => !unstable(m) && /flash/i.test(m));
    const top = Math.max(0, ...stable.map(versionOf));
    recommended = stable.filter((m) => versionOf(m) === top && /^gemini-[\d.]+-flash(-lite)?$/.test(m));
  } else if (opts.provider === 'openrouter') {
    recommended = models.filter((m) => m.endsWith(':free')).slice(0, 8);
  } else if (p.defaultModel && models.includes(p.defaultModel)) {
    recommended = [p.defaultModel];
  }
  return { models, recommended };
}
