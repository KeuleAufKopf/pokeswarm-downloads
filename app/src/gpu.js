// Grafikweg (ANGLE-Backend) wählen, in userData/gpu.json merken und bei Problemen umschalten.
// Standard ist Vulkan (umgeht den DirectComposition/D3D-Weg, der auf Nvidia-Karten ruckelt),
// Ausweichweg ist D3D11 unter Windows bzw. OpenGL unter Linux.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { log } = require('./log');

const BACKENDS = ['vulkan', 'd3d11', 'gl'];
const AUSWEICH = process.platform === 'win32' ? 'd3d11' : 'gl';
const MARKE = '--gpu-fallback'; // hängt am Neustart nach automatischem Umschalten (nur einmal umschalten)

const datei = () => path.join(app.getPath('userData'), 'gpu.json');
const argWert = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};

function gespeichert() {
  try {
    const j = JSON.parse(fs.readFileSync(datei(), 'utf8'));
    if (BACKENDS.includes(j.angle)) return j.angle;
  } catch {}
  return 'vulkan';
}

function speichern(angle) {
  try {
    fs.mkdirSync(path.dirname(datei()), { recursive: true });
    fs.writeFileSync(datei(), JSON.stringify({ angle }, null, 2));
  } catch (e) {
    log(`gpu.json nicht schreibbar: ${e.message}`);
  }
}

// --angle=... gilt nur für diesen Start und schaltet den automatischen Ausweichweg ab
const vonHand = BACKENDS.includes(argWert('angle')) ? argWert('angle') : null;
const angle = vonHand || gespeichert();

// Muss vor app.whenReady() laufen
function schalterSetzen() {
  const cl = app.commandLine;
  cl.appendSwitch('use-angle', angle);
  cl.appendSwitch('ignore-gpu-blocklist');
  cl.appendSwitch('force_high_performance_gpu');
  cl.appendSwitch('enable-gpu-rasterization');
  cl.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  log(`Grafikweg: ${angle}${vonHand ? ' (per --angle)' : ''}`);
}

function neustarten(neu, automatisch) {
  speichern(neu);
  const args = process.argv.slice(1).filter((a) => !a.startsWith('--angle=') && a !== MARKE);
  if (automatisch) args.push(MARKE);
  app.relaunch({ args });
  app.exit(0);
}

// Strg+Umschalt+G: Vulkan <-> Ausweichweg
function umschalten() {
  const neu = angle === 'vulkan' ? AUSWEICH : 'vulkan';
  log(`Grafikweg von Hand: ${angle} -> ${neu}`);
  neustarten(neu, false);
}

let umgeschaltet = false;
function ausweichen(grund) {
  log(`Grafikproblem: ${grund}`);
  if (angle !== 'vulkan' || vonHand || umgeschaltet || process.argv.includes(MARKE)) return;
  umgeschaltet = true;
  log(`Schalte automatisch auf ${AUSWEICH} um und starte neu`);
  neustarten(AUSWEICH, true);
}

// GPU-Prozess abgestürzt oder gar nicht erst hochgekommen
app.on('child-process-gone', (_e, d) => {
  if (d.type === 'GPU' && d.reason !== 'clean-exit' && d.reason !== 'killed') {
    ausweichen(`GPU-Prozess weg (${d.reason}, Code ${d.exitCode})`);
  }
});

// Renderer-Name direkt aus WebGL in der Seite lesen (eigene isolierte Welt, stört das Spiel nicht)
const RENDERER_JS = `(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  if (!gl) return '';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const r = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  const weg = gl.getExtension('WEBGL_lose_context');
  if (weg) weg.loseContext();
  return r;
})()`;

// Nach dem ersten Laden: läuft WebGL wirklich auf der Grafikkarte?
async function pruefen(wc) {
  const webgl = app.getGPUFeatureStatus().webgl;
  let renderer = '';
  try { renderer = await wc.executeJavaScriptInIsolatedWorld(999, [{ code: RENDERER_JS }]); } catch {}
  log(`GPU: webgl=${webgl} renderer=${renderer || '-'}`);
  // SwiftShader = Software-Vulkan, also keine echte Grafikkarte
  if (!String(webgl).startsWith('enabled') || !renderer || /swiftshader/i.test(renderer)) {
    ausweichen(`WebGL nicht auf der Grafikkarte (${webgl}, ${renderer || 'kein Kontext'})`);
  }
}

module.exports = { angle, schalterSetzen, umschalten, pruefen };
