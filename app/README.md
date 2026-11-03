# PokéSwarm Desktop-App (Electron)

Ein schlankes Fenster für https://poke.bukestudios.com – für Windows und Linux.
Hier ist **kein Spielcode** drin: Das Spiel wird immer vom Server geladen, Konto und Spielstand liegen dort.

Die App ersetzt die alte WebView2-App (C#). Grund: Auf Nvidia-Karten ruckelt der DirectComposition/D3D-Weg
von WebView2/Edge. Diese App zeichnet WebGL über **ANGLE auf Vulkan** und weicht bei Problemen auf
**D3D11** (Windows) bzw. **OpenGL** (Linux) aus.

## Was sie kann

- Lädt das Spiel; der Fenstertitel folgt dem Seitentitel (ohne „(privat)“).
- Brücke wie in WebView2: `window.chrome.webview.postMessage(JSON.stringify(obj))` funktioniert unverändert.
  - `{kick:1}` wird nur protokolliert.
  - `{rp:{details,state,start}}` setzt den Discord-Status („Rich Presence“, eigene kleine IPC-Umsetzung).
- Kennung im User-Agent: `PokeSurvivorApp/<version> electron <grafikweg>`.
- Fremde Links und Fenster öffnen im normalen Browser; nur `poke.bukestudios.com` bleibt in der App.
- Auto-Update über GitHub-Releases dieses Repos (Installer und AppImage, nicht die Portable-Version):
  lädt im Hintergrund, installiert beim nächsten Beenden, im Titel steht dann „Update bereit“.
- Nur eine Instanz: ein zweiter Start holt das offene Fenster nach vorn.

## Tasten und Schalter

| | |
|---|---|
| F11 | Vollbild an/aus |
| Strg+R | Seite neu laden |
| F12 | Entwicklertools (nur mit `--diag`) |
| `--angle=vulkan\|gl\|d3d11\|d3d11on12` | Grafikweg nur für diesen Start erzwingen (ohne automatisches Ausweichen) |
| `--url=https://…` | andere Adresse laden (z. B. Testserver) |
| `--diag` | Entwicklertools erlauben, Protokoll zusätzlich auf die Konsole |

Beispiel (Verknüpfung unter Windows): `PokeSwarm.exe --angle=d3d11`

## Grafikweg und gpu.json

Seit 2.1.0 wählt man den Grafikweg im Spiel unter **Einstellungen → Grafikweg** (das Spiel schickt `{gpu: "…"}`,
die App merkt ihn und startet neu). Strg+Umschalt+G gibt es nicht mehr.

| Weg | |
|---|---|
| `vulkan` | Standard (umgeht den DirectComposition/D3D-Weg, der auf Nvidia-Karten ruckelt) |
| `gl` | OpenGL, Reserve |
| `d3d11` | DirectX 11 (nur Windows) |
| `d3d11on12` | DirectX 11 über DirectX 12 (nur Windows) |

Der gewählte Grafikweg steht in `gpu.json` im Datenordner der App:

- Windows: `%APPDATA%\PokeSwarm\gpu.json`
- Linux: `~/.config/PokeSwarm/gpu.json`

Inhalt: `{ "v": 2, "angle": "vulkan" }`. Ohne Datei (oder mit einer alten aus 2.0.0) gilt Vulkan.

Automatisches Ausweichen: Stürzt der GPU-Prozess ab oder läuft WebGL 5 Sekunden nach dem Laden nicht auf der
Grafikkarte (WebGL aus oder nur SwiftShader-Software), stellt die App auf OpenGL um (von OpenGL aus unter Windows
auf D3D11) und startet neu. Nach dem ersten Ausweichen versucht der nächste normale Start wieder Vulkan; erst beim
zweiten Mal bleibt die Reserve (`"auto"` in `gpu.json` zählt mit). Eine Auswahl in den Einstellungen setzt das zurück.

Im selben Ordner liegt `launcher.log` (vorheriger Start: `launcher.old.log`) mit Grafikweg, erkanntem
Renderer (z. B. `ANGLE (NVIDIA, Vulkan …)`) und Fehlern – das bitte bei Grafikproblemen mitschicken.

## Bauen

Voraussetzung: Node.js 22.

```bash
cd app
npm ci
npm start              # zum Ausprobieren
npm run dist           # baut für das aktuelle System nach app/dist/
```

- Windows: `PokeSwarm-Setup-<version>.exe` (Installer, pro Benutzer, ohne Admin) und `PokeSwarm-Portable-<version>.exe`
- Linux: `PokeSwarm-<version>-x86_64.AppImage`

Der Workflow `.github/workflows/app.yml` baut beides bei jedem Push auf den Branch `electron` (Änderungen in `app/`)
und legt die Dateien als Workflow-Artefakte ab. Veröffentlicht wird dabei nichts.

Für ein Update an Spieler später: Version in `package.json` erhöhen und ein GitHub-Release mit Tag `v<version>`
anlegen, das die Installer-exe, das AppImage, `latest.yml`, `latest-linux.yml` und die `.blockmap`-Dateien enthält.
