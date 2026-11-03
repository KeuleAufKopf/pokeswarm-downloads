// Grafikweg (ANGLE-Backend) wählen, in userData/gpu.json merken und bei Problemen umschalten.
// Standard ist Vulkan (umgeht den DirectComposition/D3D-Weg, der auf Nvidia-Karten ruckelt), Reserve ist OpenGL.
// 2.1.0 (Mirco 03.11.): Auswahl in den Spiel-Einstellungen (Nachricht {gpu}) statt Strg+Umschalt+G; DirectX nur noch, wenn man es wählt.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { log } = require('./log');

const BACKENDS = process.platform === 'win32' ? ['vulkan', 'gl', 'd3d11', 'd3d11on12'] : ['vulkan', 'gl'];
const STANDARD = 'vulkan';
const AUSWEICH = { vulkan: 'gl', d3d11on12: 'gl', gl: process.platform === 'win32' ? 'd3d11' : null };   // automatisch, nur bei Absturz
const MARKE = '--gpu-fallback'; // hängt am Neustart nach automatischem Umschalten (nur einmal je Start umschalten)
const STAND = 2;                // gpu.json-Fassung: ältere (2.0.0 wich dauerhaft auf D3D11 aus) starten einmal wieder mit Vulkan

const datei = () => path.join(app.getPath('userData'), 'gpu.json');
const argWert = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};

// { angle, auto }: auto = so oft ist der Weg schon von selbst ausgewichen (1: beim nächsten Start Vulkan nochmal versuchen)
function gespeichert() {
  try {
    const j = JSON.parse(fs.readFileSync(datei(), 'utf8'));
    if (j.v === STAND && BACKENDS.includes(j.angle)) return { angle: j.angle, auto: j.auto || 0 };
  } catch {}
  return { angle: STANDARD, auto: 0 };
}

function speichern(angle, auto = 0) {
  try {
    fs.mkdirSync(path.dirname(datei()), { recursive: true });
    fs.writeFileSync(datei(), JSON.stringify({ v: STAND, angle, auto: auto || undefined }, null, 2));
  } catch (e) {
    log(`gpu.json nicht schreibbar: ${e.message}`);
  }
}

// --angle=... gilt nur für diesen Start und schaltet den automatischen Ausweichweg ab
const vonHand = BACKENDS.includes(argWert('angle')) ? argWert('angle') : null;
const stand = gespeichert();
// einmal von selbst ausgewichen: beim nächsten normalen Start Vulkan nochmal versuchen (ein einzelner Treiber-Schluckauf
// soll niemanden für immer auf der Reserve lassen); beim zweiten Mal bleibt die Reserve
const nochmal = !vonHand && stand.auto === 1 && !process.argv.includes(MARKE);
const angle = vonHand || (nochmal ? STANDARD : stand.angle);

// Muss vor app.whenReady() laufen
function schalterSetzen() {
  const cl = app.commandLine;
  cl.appendSwitch('use-angle', angle);
  cl.appendSwitch('ignore-gpu-blocklist');
  cl.appendSwitch('force_high_performance_gpu');
  cl.appendSwitch('enable-gpu-rasterization');
  cl.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  log(`Grafikweg: ${angle}${vonHand ? ' (per --angle)' : nochmal ? ' (nach Ausweichen nochmal versucht)' : ''}`);
}

function neustarten(neu, auto) {
  speichern(neu, auto);
  const args = process.argv.slice(1).filter((a) => !a.startsWith('--angle=') && a !== MARKE);
  if (auto) args.push(MARKE);
  app.relaunch({ args });
  app.exit(0);
}

// Auswahl aus den Spiel-Einstellungen
function setzen(neu) {
  if (!BACKENDS.includes(neu)) return;
  log(`Grafikweg aus den Einstellungen: ${angle} -> ${neu}`);
  neustarten(neu, 0);
}

let umgeschaltet = false;
function ausweichen(grund) {
  log(`Grafikproblem: ${grund}`);
  const neu = AUSWEICH[angle];
  if (!neu || vonHand || umgeschaltet || process.argv.includes(MARKE)) return;
  umgeschaltet = true;
  log(`Schalte automatisch auf ${neu} um und starte neu`);
  neustarten(neu, (nochmal ? 1 : stand.auto) + 1);
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
  } else if (nochmal) {
    log('Vulkan läuft wieder, Ausweichen vergessen');
    speichern(STANDARD, 0);
  } else if (!fs.existsSync(datei()) || stand.angle !== angle) {
    speichern(angle, stand.auto);   // erster Start bzw. alte gpu.json: in der neuen Fassung merken
  }
}

module.exports = { angle, BACKENDS, schalterSetzen, setzen, pruefen };
