// Modul Blast: hanya dimuat kalau fitur "blast" aktif.
import { devices } from '../db.js';
import { DEFAULT_SETTINGS, campaigns, parseRecipients, render } from '../campaigns.js';

export async function register({ router, wa, isEnabled, features }) {
  const { NotOnWhatsApp, logger, randomBetween } = wa;

  // ---- Antrean kirim (anti-banned) -----------------------------------------
  /** Jadwal per device: kapan boleh kirim lagi & jumlah terkirim sejak start (untuk batch). */
  const timing = new Map();
  const t = (id) => timing.get(id) ?? timing.set(id, { nextAt: 0, sent: 0 }).get(id);
  const inActiveHours = (c, now = new Date()) => now.getHours() >= c.hour_start && now.getHours() < c.hour_end;

  wa.addQueueProvider({
    next(deviceId) {
      if (!isEnabled()) return null;
      const dt = t(deviceId);
      if (Date.now() < dt.nextAt) return null;
      if (!wa.canInitiate(deviceId)) return null; // batas harian anti-banned per device (semua fitur)
      for (const c of campaigns.running()) {
        if (!c.device_ids.includes(deviceId)) continue;
        if (!inActiveHours(c)) continue;
        if (campaigns.sentToday(deviceId) >= c.daily_limit) continue;
        const r = campaigns.claim(c.id, deviceId);
        if (!r) {
          campaigns.finishIfDone(c.id);
          continue;
        }
        return {
          async run(send, isConnected) {
            const body = render(c.template, r.vars);
            try {
              await send(r.phone, body);
              campaigns.markSent(r.id, body);
            } catch (err) {
              if (err instanceof NotOnWhatsApp) campaigns.markFailed(r.id, body, err.message);
              else if (!isConnected()) campaigns.release(r.id); // koneksi putus, coba lagi nanti
              else campaigns.markFailed(r.id, body, String(err?.message ?? err));
              logger.warn({ deviceId, campaign: c.id, to: r.phone, err: err?.message }, 'gagal kirim blast');
            }
            campaigns.finishIfDone(c.id);

            // Jeda sebelum pesan berikutnya; istirahat panjang setiap batch_size pesan
            dt.sent++;
            let waitMs = randomBetween(c.delay_min_s * 1000, c.delay_max_s * 1000);
            if (dt.sent % c.batch_size === 0) {
              waitMs += randomBetween(c.rest_min_m * 60_000, c.rest_max_m * 60_000);
              logger.info({ deviceId, campaign: c.id, restMin: Math.round(waitMs / 60000) }, 'istirahat batch');
            }
            dt.nextAt = Date.now() + waitMs;
          },
        };
      }
      return null;
    },
  });

  // ---- API admin ----------------------------------------------------------
  /** Penerima dari grup kontak (kalau fitur Kontak aktif) atau dari daftar yang ditempel. */
  async function recipientsFrom(body) {
    const groupIds = Array.isArray(body?.groupIds) ? body.groupIds : [];
    if (body?.source === 'groups') {
      if (!features.isEnabled('contacts')) throw new Error('Fitur Data & Group Kontak sedang nonaktif');
      if (!groupIds.length) throw new Error('Pilih minimal satu grup kontak');
      const { contacts } = await import('../contacts.js');
      return contacts.recipientsForGroups(groupIds);
    }
    return parseRecipients(body?.recipients);
  }

  async function input(body) {
    const known = new Set(devices.all().map((d) => d.id));
    return {
      name: String(body?.name ?? '').trim(),
      template: String(body?.template ?? '').trim(),
      deviceIds: (Array.isArray(body?.deviceIds) ? body.deviceIds : []).filter((id) => known.has(id)),
      parsed: await recipientsFrom(body),
      settings: body?.settings ?? {},
    };
  }

  router.post('/preview', async (req, res) => {
    let parsed, template;
    try {
      ({ template, parsed } = await input(req.body));
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.json({
      success: true,
      data: {
        columns: parsed.columns,
        total: parsed.recipients.length,
        duplicates: parsed.duplicates,
        invalid: parsed.invalid.slice(0, 20),
        invalidCount: parsed.invalid.length,
        samples: parsed.recipients.slice(0, 3).map((r) => ({ phone: r.phone, body: render(template, r.vars) })),
      },
    });
  });

  router.get('/', (_req, res) => res.json({ success: true, data: campaigns.all(), defaults: DEFAULT_SETTINGS }));

  router.post('/', async (req, res) => {
    let name, template, deviceIds, parsed, settings;
    try {
      ({ name, template, deviceIds, parsed, settings } = await input(req.body));
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (!name) return res.status(400).json({ success: false, message: 'Nama blast wajib diisi' });
    if (!template) return res.status(400).json({ success: false, message: 'Isi pesan wajib diisi' });
    if (!deviceIds.length) return res.status(400).json({ success: false, message: 'Pilih minimal satu device' });
    if (!parsed.recipients.length) return res.status(400).json({ success: false, message: 'Tidak ada nomor penerima yang valid' });
    const id = campaigns.create({ name, template, deviceIds, recipients: parsed.recipients, settings });
    if (req.body?.start) campaigns.setStatus(id, 'running');
    res.json({ success: true, data: campaigns.get(id) });
  });

  router.get('/:id', (req, res) => {
    const c = campaigns.get(Number(req.params.id));
    if (!c) return res.status(404).json({ success: false, message: 'Blast tidak ditemukan' });
    const tm = Object.fromEntries(c.device_ids.map((id) => [id, { nextAt: t(id).nextAt, sentToday: campaigns.sentToday(id) }]));
    res.json({ success: true, data: { ...c, timing: tm, recipients: campaigns.recipients(c.id) } });
  });

  router.post('/:id/:action', (req, res) => {
    const c = campaigns.get(Number(req.params.id));
    if (!c) return res.status(404).json({ success: false, message: 'Blast tidak ditemukan' });
    const action = req.params.action;
    if (action === 'start' || action === 'resume') {
      if (c.status === 'done' || c.status === 'cancelled') {
        return res.status(400).json({ success: false, message: 'Blast sudah selesai/dibatalkan' });
      }
      campaigns.setStatus(c.id, 'running');
      for (const id of c.device_ids) wa.drainQueue(id);
    } else if (action === 'pause') {
      campaigns.setStatus(c.id, 'paused');
    } else if (action === 'cancel') {
      campaigns.setStatus(c.id, 'cancelled');
    } else if (action === 'retry-failed') {
      campaigns.retryFailed(c.id);
      campaigns.setStatus(c.id, 'running');
    } else {
      return res.status(400).json({ success: false, message: 'Aksi tidak dikenal' });
    }
    res.json({ success: true, data: campaigns.get(c.id) });
  });

  router.delete('/:id', (req, res) => {
    const c = campaigns.get(Number(req.params.id));
    if (c?.status === 'running') return res.status(400).json({ success: false, message: 'Jeda atau batalkan blast dulu sebelum menghapus' });
    campaigns.remove(Number(req.params.id));
    res.json({ success: true });
  });
}
