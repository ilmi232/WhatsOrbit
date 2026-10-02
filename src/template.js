// Template pesan: spintax {a|b|c} + placeholder [Kolom]. Dipakai Blast & Autoreply.

export function spin(text) {
  let out = text;
  // Pilih dari kurung kurawal paling dalam dulu, supaya bisa bersarang
  for (let i = 0; i < 50 && /\{[^{}]*\|[^{}]*\}/.test(out); i++) {
    out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, opts) => {
      const list = opts.split('|');
      return list[Math.floor(Math.random() * list.length)];
    });
  }
  return out;
}

export function render(template, vars) {
  const lower = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k.trim().toLowerCase(), v]));
  return spin(template).replace(/\[([^\]]+)\]/g, (m, key) => {
    const v = lower[key.trim().toLowerCase()];
    return v === undefined ? m : v;
  });
}
