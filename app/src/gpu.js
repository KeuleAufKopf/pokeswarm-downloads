// Grafikweg (ANGLE-Backend) wählen, in userData/gpu.json merken und bei Problemen umschalten.
// Standard ist Vulkan (umgeht den DirectComposition/D3D-Weg, der auf Nvidia-Karten ruckelt), Reserve ist OpenGL.
// 2.1.0 (Mirco 03.11.): Auswahl in den Spiel-Einstellungen (Nachricht {gpu}) statt Strg+Umschalt+G; DirectX nur noch, wenn man es wählt.
// 2.1.2 (Ash Ketchum 04.11.): Ein Grafikweg kann schwarz zeichnen, ohne abzustürzen - dann merkt das niemand automatisch, und die
// Einstellungen sind nicht zu sehen. Darum zwei Auswege über Windows-Dialoge (die sind auch dann sichtbar, wenn das Spielbild es nicht ist):
// Strg+Umschalt+G fragt nach dem Grafikweg, und nach 2 kurzen Starten fragt die App selbst, ob man das Spiel sieht.
const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { log } = require('./log');

const BACKENDS = process.platform === 'win32' ? ['vulkan', 'gl', 'd3d11', 'd3d11on12'] : ['vulkan', 'gl'];
const STANDARD = 'vulkan';
const AUSWEICH = { vulkan: 'gl', d3d11on12: 'gl', gl: process.platform === 'win32' ? 'd3d11' : null };   // automatisch, nur bei Absturz
const MARKE = '--gpu-fallback'; // hängt am Neustart nach automatischem Umschalten (nur einmal je Start umschalten)
const STAND = 2;                // gpu.json-Fassung: ältere (2.0.0 wich dauerhaft auf D3D11 aus) starten einmal wieder mit Vulkan
const NAMEN = { vulkan: 'Vulkan', gl: 'OpenGL', d3d11: 'DirectX 11', d3d11on12: 'DirectX 11 on 12' };
const FRAGEN_AB = 2;            // so viele Starts ohne Bestätigung, dann fragt die App nach

const datei = () => path.join(app.getPath('userData'), 'gpu.json');
const argWert = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const OK_NACH = +argWert('gpu-ok-ms') || 5 * 60e3;   // wer so lange im Spiel bleibt, sieht auch etwas

// { angle, auto, ok, tries }: auto = so oft ist der Weg schon von selbst ausgewichen (1: beim nächsten Start Vulkan nochmal versuchen),
// ok = dieser Weg lief schon nachweislich, tries = Starts ohne diesen Nachweis
function gespeichert() {
  try {
    const j = JSON.parse(fs.readFileSync(datei(), 'utf8'));
    if (j.v === STAND && BACKENDS.includes(j.angle)) return { angle: j.angle, auto: j.auto || 0, ok: j.ok || null, tries: j.tries || 0, lang: j.lang || null };
    // alte Datei auf DirectX: lag oft an einem Vulkan-Problem, der Wechsel auf Vulkan kann also das schwarze Bild sein -> gleich beim ersten Start fragen
    if (j.angle === 'd3d11') return { angle: STANDARD, auto: 0, ok: null, tries: FRAGEN_AB - 1 };
  } catch {}
  return { angle: STANDARD, auto: 0, ok: null, tries: 0 };
}

function speichern(angle, auto = 0) {
  akt.angle = angle; akt.auto = auto;
  try {
    fs.mkdirSync(path.dirname(datei()), { recursive: true });
    fs.writeFileSync(datei(), JSON.stringify({ v: STAND, angle, auto: auto || undefined, ok: akt.ok || undefined, tries: akt.tries || undefined, lang: akt.lang || undefined }, null, 2));
  } catch (e) {
    log(`gpu.json nicht schreibbar: ${e.message}`);
  }
}

// --angle=... gilt nur für diesen Start und schaltet den automatischen Ausweichweg ab
const vonHand = BACKENDS.includes(argWert('angle')) ? argWert('angle') : null;
const stand = gespeichert();
const akt = { ...stand };   // was gerade in gpu.json steht
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
  // Start zählen, solange dieser Weg nicht nachweislich läuft
  if (!vonHand && akt.ok !== angle) { akt.tries += 1; speichern(akt.angle, akt.auto); log(`Grafikweg noch nicht bestätigt, Start ${akt.tries}`); }
}

function bestaetigen(grund) {
  if (akt.ok === angle) return;
  log(`Grafikweg ${angle} bestätigt (${grund})`);
  akt.ok = angle; akt.tries = 0;
  speichern(akt.angle, akt.auto);
}

function neustarten(neu, auto) {
  akt.tries = 0;   // neuer Weg, neue Zählung
  speichern(neu, auto);
  const args = process.argv.slice(1).filter((a) => !a.startsWith('--angle=') && a !== MARKE);
  if (auto) args.push(MARKE);
  app.relaunch({ args });
  app.exit(0);
}

// Texte der Windows-Dialoge
const TEXTE = {
  de: { siehst: 'Siehst du das Spiel?', siehstInfo: 'PokéSwarm wurde zuletzt mehrmals nur kurz gestartet. Falls das Bild schwarz, weiß oder kaputt ist, wähle einen anderen Grafikweg.', ja: 'Ja, alles gut', nein: 'Nein, Grafikweg wechseln', wahl: 'Welchen Grafikweg möchtest du nutzen?', wahlInfo: 'Aktuell: {w}. Die App startet danach neu.', abbruch: 'Abbrechen' },
  en: { siehst: 'Can you see the game?', siehstInfo: 'PokéSwarm was only open briefly the last few times. If the picture is black, white or broken, choose another graphics path.', ja: 'Yes, all good', nein: 'No, change graphics path', wahl: 'Which graphics path do you want to use?', wahlInfo: 'Current: {w}. The app will restart afterwards.', abbruch: 'Cancel' },
  ru: { siehst: 'Вы видите игру?', siehstInfo: 'В последние разы PokéSwarm был открыт совсем недолго. Если изображение чёрное, белое или с ошибками, выберите другой графический режим.', ja: 'Да, всё хорошо', nein: 'Нет, сменить режим', wahl: 'Какой графический режим использовать?', wahlInfo: 'Сейчас: {w}. После этого приложение перезапустится.', abbruch: 'Отмена' },
  zh: { siehst: '你能看到游戏画面吗？', siehstInfo: 'PokéSwarm 最近几次只运行了很短时间。如果画面发黑、发白或显示异常，请选择其他图形模式。', ja: '能，一切正常', nein: '不能，更换图形模式', wahl: '要使用哪种图形模式？', wahlInfo: '当前：{w}。之后应用将重新启动。', abbruch: '取消' },
  ja: { siehst: 'ゲーム画面は見えていますか？', siehstInfo: 'PokéSwarm は最近、短時間しか起動されていません。画面が黒い・白い・崩れている場合は、別のグラフィックモードを選んでください。', ja: 'はい、問題なし', nein: 'いいえ、モードを変更', wahl: 'どのグラフィックモードを使いますか？', wahlInfo: '現在：{w}。このあとアプリが再起動します。', abbruch: 'キャンセル' },
  ko: { siehst: '게임 화면이 보이나요?', siehstInfo: 'PokéSwarm이 최근 몇 번 짧게만 실행되었습니다. 화면이 검거나 희거나 깨져 보이면 다른 그래픽 모드를 선택하세요.', ja: '네, 정상입니다', nein: '아니요, 모드 변경', wahl: '어떤 그래픽 모드를 사용할까요?', wahlInfo: '현재: {w}. 이후 앱이 다시 시작됩니다.', abbruch: '취소' },
  pl: { siehst: 'Czy widzisz grę?', siehstInfo: 'PokéSwarm był ostatnio uruchamiany tylko na krótko. Jeśli obraz jest czarny, biały lub uszkodzony, wybierz inny tryb grafiki.', ja: 'Tak, wszystko dobrze', nein: 'Nie, zmień tryb grafiki', wahl: 'Którego trybu grafiki chcesz używać?', wahlInfo: 'Obecnie: {w}. Aplikacja uruchomi się potem ponownie.', abbruch: 'Anuluj' },
  cs: { siehst: 'Vidíš hru?', siehstInfo: 'PokéSwarm byl naposledy spuštěn jen krátce. Pokud je obraz černý, bílý nebo rozbitý, vyber jiný grafický režim.', ja: 'Ano, vše v pořádku', nein: 'Ne, změnit grafický režim', wahl: 'Který grafický režim chceš použít?', wahlInfo: 'Aktuálně: {w}. Aplikace se poté restartuje.', abbruch: 'Zrušit' },
  es: { siehst: '¿Ves el juego?', siehstInfo: 'PokéSwarm solo ha estado abierto poco tiempo las últimas veces. Si la imagen se ve negra, blanca o rota, elige otro modo gráfico.', ja: 'Sí, todo bien', nein: 'No, cambiar modo gráfico', wahl: '¿Qué modo gráfico quieres usar?', wahlInfo: 'Actual: {w}. Después la aplicación se reiniciará.', abbruch: 'Cancelar' },
  pt: { siehst: 'Consegues ver o jogo?', siehstInfo: 'O PokéSwarm esteve aberto pouco tempo nas últimas vezes. Se a imagem estiver preta, branca ou com erros, escolhe outro modo gráfico.', ja: 'Sim, está tudo bem', nein: 'Não, mudar modo gráfico', wahl: 'Que modo gráfico queres usar?', wahlInfo: 'Atual: {w}. Depois a aplicação reinicia.', abbruch: 'Cancelar' },
};
const texte = (l) => TEXTE[l] || TEXTE.en;
const gemerkteSprache = () => akt.lang || null;
function spracheMerken(l) {
  if (!TEXTE[l] || akt.lang === l) return;
  akt.lang = l;
  speichern(akt.angle, akt.auto);
}

// Strg+Umschalt+G bzw. "Nein" auf die Frage: Weg wählen. Standard ist Abbrechen, versehentlich ändert sich nichts (03.11.: die alte Taste schaltete sofort um).
let dialogOffen = false;
async function waehlen(win, l) {
  if (dialogOffen) return;
  dialogOffen = true;
  const t = texte(l);
  const { response } = await dialog.showMessageBox(win, { type: 'question', title: 'PokéSwarm', message: t.wahl, detail: t.wahlInfo.replace('{w}', NAMEN[angle]), noLink: true,
    buttons: [...BACKENDS.map((w) => NAMEN[w]), t.abbruch], defaultId: BACKENDS.length, cancelId: BACKENDS.length });
  dialogOffen = false;
  const neu = BACKENDS[response];
  if (neu && neu !== angle) { log(`Grafikweg aus dem Dialog: ${angle} -> ${neu}`); neustarten(neu, 0); }
}

// Nach mehreren kurzen Starten nachfragen. Fenster schließen zählt als "Nein": dann kommt die Auswahl, dort lässt sich abbrechen.
async function nachfragen(win, l) {
  if (dialogOffen) return;
  dialogOffen = true;
  const t = texte(l);
  const { response } = await dialog.showMessageBox(win, { type: 'question', title: 'PokéSwarm', message: t.siehst, detail: t.siehstInfo, noLink: true, buttons: [t.ja, t.nein], defaultId: 0, cancelId: 1 });
  dialogOffen = false;
  if (response === 0) bestaetigen('Spieler sieht das Spiel');
  else await waehlen(win, l);
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
async function pruefen(wc, win, sprache) {
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
  if (umgeschaltet || vonHand || akt.ok === angle) return;
  setTimeout(() => bestaetigen('lange genug im Spiel'), OK_NACH);
  if (akt.tries >= FRAGEN_AB && win && !win.isDestroyed()) nachfragen(win, sprache());
}

module.exports = { angle, BACKENDS, schalterSetzen, setzen, pruefen, waehlen, gemerkteSprache, spracheMerken };
