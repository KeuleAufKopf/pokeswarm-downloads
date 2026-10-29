// Kleines Protokoll in userData/launcher.log (der vorherige Lauf bleibt als launcher.old.log erhalten,
// damit z. B. der Grund für einen automatischen Grafik-Neustart nicht verloren geht).
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let datei = null;

function start() {
  datei = path.join(app.getPath('userData'), 'launcher.log');
  try {
    fs.mkdirSync(path.dirname(datei), { recursive: true });
    fs.renameSync(datei, datei.replace(/\.log$/, '.old.log'));
  } catch {}
}

function log(text) {
  const zeile = `${new Date().toISOString()} ${text}\n`;
  if (process.argv.includes('--diag')) process.stdout.write(zeile);
  if (!datei) return;
  try { fs.appendFileSync(datei, zeile); } catch {}
}

module.exports = { start, log };
