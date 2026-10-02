// Jalur peristiwa internal. Fitur memancarkan peristiwa; modul seperti Webhook mendengarkan.
//   message.incoming    pesan masuk (setelah diproses bot/autoreply)
//   message.status      status pesan keluar dari antrean (sent | failed)
//   device.status       status device (connected | disconnected | logged_out | qr)
//   group.participants  anggota grup masuk/keluar/naik/turun admin
//   lead.created        lead baru dari Google Form/Spreadsheet/API
//   cs.ticket           tiket Customer Service dibuka/ditutup
import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
bus.setMaxListeners(50);

/** Pancarkan peristiwa tanpa pernah menggagalkan pemanggil. */
export function emit(name, payload) {
  try {
    bus.emit(name, payload);
  } catch {
    /* pendengar tidak boleh mengganggu alur utama */
  }
}
