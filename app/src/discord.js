// Discord Rich Presence direkt über die lokale Discord-IPC-Pipe (ohne npm-Paket).
// Paket: [op int32 LE][länge int32 LE][JSON]. op 0 = Handshake, 1 = Befehl/Antwort, 2 = Ende, 3/4 = Ping/Pong.
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CLIENT_ID = '778971343743614996';
const START = Math.floor(Date.now() / 1000);
const NEU_VERBINDEN_MS = 15000;
const MIN_ABSTAND_MS = 4000; // Discord erlaubt nur ~5 Aktivitäten pro 20 s

let sock = null;
let bereit = false;
let wiederTimer = null;
let sendeTimer = null;
let aktivitaet = null;
let gesendet = null;
let zuletzt = 0;

function pfade() {
  const namen = Array.from({ length: 10 }, (_, i) => `discord-ipc-${i}`);
  if (process.platform === 'win32') return namen.map((n) => `\\\\?\\pipe\\${n}`);
  const e = process.env;
  const basen = [...new Set([e.XDG_RUNTIME_DIR, e.TMPDIR, e.TMP, e.TEMP, '/tmp'].filter(Boolean))];
  // normale Installation, Flatpak und Snap
  const unter = ['', 'app/com.discordapp.Discord', 'app/com.discordapp.DiscordCanary',
    '.flatpak/com.discordapp.Discord/xdg-run', 'snap.discord', 'snap.discord-canary'];
  const liste = [];
  for (const n of namen) for (const b of basen) for (const u of unter) liste.push(path.join(b, u, n));
  return liste.filter((p) => fs.existsSync(p));
}

function paket(op, daten) {
  const json = Buffer.from(JSON.stringify(daten));
  const kopf = Buffer.alloc(8);
  kopf.writeInt32LE(op, 0);
  kopf.writeInt32LE(json.length, 4);
  return Buffer.concat([kopf, json]);
}

function spaeter() {
  clearTimeout(wiederTimer);
  wiederTimer = setTimeout(verbinden, NEU_VERBINDEN_MS);
}

// Pipes der Reihe nach probieren; läuft Discord nicht, still in 15 s erneut
function verbinden() {
  if (sock) return;
  const liste = pfade();
  const naechste = () => {
    const p = liste.shift();
    if (!p) return spaeter();
    const s = net.connect(p);
    s.once('error', () => { s.destroy(); naechste(); });
    s.once('connect', () => { s.removeAllListeners('error'); verbunden(s); });
  };
  naechste();
}

function verbunden(s) {
  sock = s;
  let puffer = Buffer.alloc(0);
  s.on('data', (d) => {
    puffer = Buffer.concat([puffer, d]);
    while (puffer.length >= 8) {
      const laenge = puffer.readInt32LE(4);
      if (puffer.length < 8 + laenge) break;
      empfangen(puffer.readInt32LE(0), puffer.subarray(8, 8 + laenge));
      puffer = puffer.subarray(8 + laenge);
    }
  });
  s.on('error', () => {});
  s.on('close', () => {
    if (sock === s) { sock = null; bereit = false; }
    spaeter();
  });
  s.write(paket(0, { v: 1, client_id: CLIENT_ID }));
}

function empfangen(op, body) {
  let msg = {};
  try { msg = JSON.parse(body.toString('utf8')); } catch {}
  if (op === 3) sock.write(paket(4, msg));
  else if (op === 2) sock.destroy();
  else if (op === 1 && msg.evt === 'READY') { bereit = true; gesendet = null; senden(); }
}

function senden() {
  if (!bereit || !aktivitaet) return;
  const json = JSON.stringify(aktivitaet);
  if (json === gesendet) return;
  const warten = zuletzt + MIN_ABSTAND_MS - Date.now();
  if (warten > 0) {
    if (!sendeTimer) sendeTimer = setTimeout(() => { sendeTimer = null; senden(); }, warten);
    return;
  }
  gesendet = json;
  zuletzt = Date.now();
  sock.write(paket(1, {
    cmd: 'SET_ACTIVITY',
    args: { pid: process.pid, activity: aktivitaet },
    nonce: crypto.randomUUID(),
  }));
}

// rp = { details, state, start } vom Spiel (start in Unix-Sekunden)
function setzen(rp = {}) {
  const kurz = (t) => String(t).slice(0, 128);
  let start = Math.floor(Number(rp.start)) || START;
  if (start > 1e12) start = Math.floor(start / 1000); // falls doch Millisekunden kommen
  aktivitaet = {
    details: kurz(rp.details || 'In the menu'),
    timestamps: { start },
    assets: { large_image: 'https://poke.bukestudios.com/login/icon512.png?v=2', large_text: 'PokéSwarm' },
    buttons: [{ label: 'Play PokéSwarm', url: 'https://poke.bukestudios.com/' }],
  };
  if (rp.state) aktivitaet.state = kurz(rp.state);
  senden();
}

function start() {
  setzen();
  verbinden();
}

module.exports = { start, setzen };
