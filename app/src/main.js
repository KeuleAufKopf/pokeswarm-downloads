// PokéSwarm Desktop-App: ein Fenster für https://poke.bukestudios.com (kein Spielcode hier drin).
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const logbuch = require('./log');
const { log } = logbuch;

const argWert = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};

const DIAG = process.argv.includes('--diag');
const STANDARD_URL = 'https://poke.bukestudios.com/';
let START_URL = argWert('url') || STANDARD_URL;
try { new URL(START_URL); } catch { START_URL = STANDARD_URL; }
const HOSTS = new Set(['poke.bukestudios.com', new URL(START_URL).host]);

const unsereSeite = (url) => {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && HOSTS.has(u.host);
  } catch { return false; }
};
const bleibtInApp = (url) => /^(about|data|blob):/i.test(url) || unsereSeite(url);

// Fremde Links im normalen Browser öffnen (nur http/https/mailto)
function extern(url) {
  if (/^(https?|mailto):/i.test(url)) shell.openExternal(url).catch(() => {});
}

// Zweiter Start holt nur das vorhandene Fenster nach vorn
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  logbuch.start();
  log(`PokéSwarm ${app.getVersion()} (Electron ${process.versions.electron}, ${process.platform}) startet: ${START_URL}`);
  const gpu = require('./gpu');
  const discord = require('./discord');
  gpu.schalterSetzen();

  // Das Spiel erkennt die App an "PokeSurvivorApp/x.y.z"
  app.userAgentFallback = `${app.userAgentFallback} PokeSurvivorApp/${app.getVersion()} electron ${gpu.angle}`;
  Menu.setApplicationMenu(null);

  let win = null;
  let seitenTitel = '';
  let updateBereit = false;

  function titelSetzen() {
    if (!win) return;
    let t = seitenTitel.replace(/\s*\(privat\)/gi, '').trim();
    if (!t || /^https?:/i.test(t)) t = 'PokéSwarm';
    win.setTitle(t + (updateBereit ? ' · Update bereit (beim nächsten Start)' : ''));
  }

  function fensterOeffnen() {
    win = new BrowserWindow({
      width: 1280,
      height: 800,
      title: 'PokéSwarm',
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    const wc = win.webContents;

    win.on('page-title-updated', (e, titel) => {
      e.preventDefault();
      seitenTitel = titel;
      titelSetzen();
    });
    win.on('closed', () => { win = null; });

    wc.on('before-input-event', (e, i) => {
      if (i.type !== 'keyDown') return;
      const strg = i.control || i.meta;
      if (i.code === 'F11' && !i.isAutoRepeat) win.setFullScreen(!win.isFullScreen());
      else if (strg && !i.shift && i.code === 'KeyR') wc.reload();
      else if (strg && i.shift && i.code === 'KeyG' && !i.isAutoRepeat) gpu.umschalten();
      else if (i.code === 'F12' && DIAG) wc.toggleDevTools();
      else return;
      e.preventDefault();
    });

    wc.once('did-finish-load', () => setTimeout(() => { if (!wc.isDestroyed()) gpu.pruefen(wc); }, 5000));
    wc.on('did-fail-load', (_e, code, text, url, mainFrame) => {
      if (mainFrame) log(`Laden fehlgeschlagen: ${code} ${text} ${url}`);
    });
    wc.on('render-process-gone', (_e, d) => {
      log(`Seite abgestürzt: ${d.reason} (Code ${d.exitCode})`);
      if (d.reason !== 'clean-exit') wc.reload();
    });

    win.loadURL(START_URL);
  }

  // Für alle Fenster/Seiten: nur unsere Seite bleibt in der App, alles andere geht in den Browser
  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      if (bleibtInApp(url)) return { action: 'allow' };
      extern(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      if (bleibtInApp(url)) return;
      e.preventDefault();
      extern(url);
    });
  });

  // Nachrichten vom Spiel (window.chrome.webview.postMessage)
  ipcMain.on('webview-message', (e, text) => {
    if (!unsereSeite(e.senderFrame && e.senderFrame.url)) return;
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    // {kick:1} war in WebView2 das Neu-Andocken der Leinwand; hier nur protokollieren
    // (kein Grafik-Ausweichgrund: das Spiel schickt auf Nvidia-Karten beim Start immer 3 Kicks)
    if (msg.kick) log('Kick vom Spiel');
    if (msg.rp && typeof msg.rp === 'object') discord.setzen(msg.rp);
  });

  // Auto-Update über GitHub-Releases dieses Repos; ohne Releases scheitert es still
  function updatePruefen() {
    if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return; // Portable kann sich nicht selbst ersetzen
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = null;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (err) => log(`Update: ${err.message.split('\n')[0]}`));
    autoUpdater.on('update-downloaded', (info) => {
      log(`Update ${info.version} geladen, wird beim Beenden installiert`);
      updateBereit = true;
      titelSetzen();
    });
    autoUpdater.checkForUpdates().catch(() => {});
  }

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    fensterOeffnen();
    discord.start();
    updatePruefen();
  });

  app.on('window-all-closed', () => app.quit());
}
