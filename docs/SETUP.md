# Setup

## Voraussetzungen

| Werkzeug | Version (getestet) | Wofür |
|---|---|---|
| Node.js | 22.x (≥ 20) | Pipeline, Remotion, Dashboard |
| Python | 3.12 / 3.13 | Audio-/Videoanalyse |
| FFmpeg + ffprobe | 6.x / 7.x | Proxys, Messungen, Lautheit, QC |
| Chrome/Chromium | wird von Remotion bei Bedarf automatisch geladen | Rendering |
| yt-dlp | 2026.x | nur YouTube-*Suche* (Metadaten) |

## Lokal (macOS)

```bash
brew install node@22 python ffmpeg
git clone <repo-url> kindnes-ai && cd kindnes-ai
npm install
pip3 install -r requirements.txt
npm run kai -- status
npm test            # optional: alle Tests inkl. einem kurzen echten Render
```

Remotion lädt beim ersten Render einmalig seine Chrome-Headless-Shell (~100 MB). Alternativ einen vorhandenen Browser setzen: `export KAI_BROWSER=/pfad/zu/chrome-headless-shell` oder `render.browserExecutable` in `config/pipeline.json`.

## Claude-Code-Cloud-Umgebung

Alles oben Genannte ist dort bereits vorhanden bzw. per `npm install` / `pip install -r requirements.txt` installierbar. Chromium liegt unter `/opt/pw-browsers/…` und wird automatisch gefunden. Wichtig: Die Cloud-Sitzung ist kein Dauer-Server – Container werden nach Inaktivität verworfen. Gerenderte Videos liegen in `output/` (nicht im Git); für dauerhafte Ergebnisse den GitHub-Actions-Weg nutzen.

## GitHub Actions (empfohlen für den Regelbetrieb)

Die Workflows liegen in `.github/workflows/`. GitHub zeigt manuell startbare Workflows erst an, wenn sie im **Standard-Branch (`main`)** liegen → den Entwicklungs-Branch nach `main` mergen.

| Workflow | Auslöser | Ergebnis |
|---|---|---|
| `CI` | jeder Push | Typecheck + alle Tests (inkl. kurzem Render) |
| `Discover candidates` | manuell; Zeitplan vorbereitet (auskommentiert) | neue Kandidaten + Bewertung werden in `data/` committet, Dashboard-Snapshot als Artifact |
| `Produce video` | manuell (Kandidaten-ID oder Datei in `references/raw-examples/`) | `final.mp4` + QC-Bericht als Artifact |

Zeitplan aktivieren: in `discover.yml` die zwei Zeilen unter `# schedule:` einkommentieren (Mo/Mi/Fr 06:17 UTC). Kosten: öffentliche Repos kostenlos; private Repos enthalten 2.000 Freiminuten/Monat (ein Suchlauf ≈ 3–5 min, ein Render ≈ 5–10 min).

### Optionale Zugangsdaten (Repository → Settings → Secrets → Actions)

| Secret | Wofür | Kosten |
|---|---|---|
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | Reddit-Suche (App-Typ „script" auf reddit.com/prefs/apps) | kostenlos |

Zugangsdaten gehören **nie** ins Repository.

## Wichtige Pfade

| Pfad | Inhalt | Im Git? |
|---|---|---|
| `config/` | Pipeline-, Musik- und Asset-Konfiguration | ja |
| `data/` | Kandidaten, Produktionen, Analysen, Reviews, Logs, Edit-Pläne | ja |
| `references/raw-examples/` | eigene Rohclips (für Actions erreichbar) | ja |
| `media/inbox/` | manuell bereitgestellte Clips (`<kandidaten-id>.mp4`) | nein |
| `media/downloads/` | frei lizenzierte Downloads | nein |
| `output/` | fertige Videos, Outro-Vorschauen, Exporte | nein |
| `.cache/` | Proxys, Thumbnails, QC-Zwischendaten | nein |
