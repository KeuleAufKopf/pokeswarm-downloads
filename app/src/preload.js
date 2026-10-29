// Brücke zum Spiel: das Spiel ruft wie in WebView2 window.chrome.webview.postMessage(JSON.stringify(obj)) auf.
// Wir bauen genau diese Funktion in die Seite ein und reichen die Nachricht per IPC an den Hauptprozess weiter.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.executeInMainWorld({
  func: (senden) => {
    const chrome = window.chrome || (window.chrome = {});
    chrome.webview = {
      postMessage: (m) => senden(typeof m === 'string' ? m : JSON.stringify(m)),
      addEventListener() {},
      removeEventListener() {},
    };
  },
  args: [(m) => ipcRenderer.send('webview-message', String(m))],
});
