// Konfigurasi PM2: menjalankan WhatsOrbit + tunnel ngrok di latar belakang.
//   pm2 start ecosystem.config.cjs   -> nyalakan
//   pm2 stop all / pm2 restart all   -> matikan / mulai ulang
// Domain ngrok diambil dari PUBLIC_URL di .env (tidak disimpan di repository).
const fs = require('node:fs');
const path = require('node:path');

function readEnv(file) {
  try {
    return Object.fromEntries(
      fs.readFileSync(file, 'utf8').split(/\r?\n/)
        .map((l) => l.replace(/^﻿/, '').match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
        .filter(Boolean)
        .map((m) => [m[1], m[2]])
    );
  } catch {
    return {};
  }
}

const env = readEnv(path.join(__dirname, '.env'));
const NGROK = path.join(
  process.env.LOCALAPPDATA ?? '',
  'Microsoft/WinGet/Packages/Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe/ngrok.exe'
);
const NGROK_DOMAIN = (env.PUBLIC_URL ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '');

const apps = [
  {
    name: 'whatsorbit',
    cwd: __dirname,
    script: 'src/server.js',
    node_args: ['--env-file-if-exists=.env', '--disable-warning=ExperimentalWarning'],
    max_memory_restart: '600M',
    restart_delay: 5000,
    windowsHide: true,
  },
];

// Tunnel ngrok hanya kalau PUBLIC_URL memakai domain ngrok
if (/\.ngrok(-free)?\.(app|dev|io)$/.test(NGROK_DOMAIN)) {
  apps.push({
    name: 'ngrok',
    cwd: __dirname,
    script: NGROK,
    args: ['http', `--url=${NGROK_DOMAIN}`, String(env.PORT || 3077), '--log=stdout'],
    interpreter: 'none',
    restart_delay: 10000,
    windowsHide: true,
  });
}

module.exports = { apps };
