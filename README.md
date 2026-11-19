# Kindness AI

Automatisierte Produktionspipeline für emotionale TikTok-Videos:

**echte Kindness-Story → Musik „Meant to Be" → Drop genau auf dem emotionalen Höhepunkt → Vinland-Saga-Outro**

Das System sucht neue Clips, bewertet sie nach einem festen 100-Punkte-Schema, stellt die besten im Dashboard zur Auswahl, schneidet ausgewählte Clips automatisch (Remotion + FFmpeg), prüft das Ergebnis technisch und legt es zur Freigabe vor. **Veröffentlicht wird nichts automatisch** – du kontrollierst jedes Video und lädst es selbst auf TikTok hoch.

```
Suche ─► Bewertung (0-100) ─► Shortlist ≥ 75 ─► deine Auswahl ─► Schnitt ─► Render ─► QC ─► Review ─► Freigabe ─► Export
```

## Schnellstart

```bash
npm install
pip install -r requirements.txt        # Python-Analyse (librosa, yt-dlp)
npm run kai -- help                     # alle Befehle
```

| Was | Befehl |
|---|---|
| Neue Kandidaten suchen + bewerten | `npm run kai -- discover` |
| Dashboard öffnen | `npm run kai -- dashboard` → http://localhost:4173 |
| Eigenen Clip übernehmen | `npm run kai -- import references/raw-examples/clip.mp4` |
| Link übernehmen (TikTok/YouTube) | `npm run kai -- import-url "<link>"` |
| Video produzieren | `npm run kai -- produce <id>` → `output/<job>/final.mp4` |
| Outro-Vorschauen | `npm run kai -- outro:preview` → `output/outro-previews/` |
| Outro V3 (clean + Definition + Vergleich) | `npm run kai -- outro:v3` → `output/kindness-outro-v3/` |
| Outro V4 (ohne Wiederholungen, durchgehende Musik, Test-Videos) | `npm run kai -- outro:v4` → `output/kindness-v4/` |
| Shot-Wiederholungen eines Outros prüfen | `npm run kai -- outro:check V4` → `output/outro-checks/` |
| Outro freigeben (erst nach eigener Sichtung) | `npm run kai -- outro:approve V4 --overlay dictionary` |
| Drop korrigieren | `npm run kai -- music:drop --set 48.216` |
| Video freigeben / exportieren | `npm run kai -- approve <id>` · `npm run kai -- export <id>` |

Ohne eigenen Rechner: GitHub → **Actions** → „Discover candidates" bzw. „Produce video" → *Run workflow*. Das fertige Video liegt danach als Download (Artifact) beim Workflow-Lauf.

## Was der Stand heute kann

- Gemessene Musik-Engine: 139,7 BPM, Beat-Map, Drop **48,216 s** (aus den Referenzen abgeleitet, manuell korrigierbar).
- Referenzanalyse aller 4 TikTok-Vorlagen (Songposition per Audio-Fingerprint, Schnittzeitpunkte, Outro-Rhythmus) → [Style Guide](docs/VIDEO_STYLE_GUIDE.md).
- 4 Outro-Varianten (A–D) mit beatgenauen Schnitten.
- Outro V4: 11 verschiedene Thorfinn-Motive (automatische Wiederholungskontrolle per pHash/SSIM), Song läuft durchgehend unter der Story (leiser Start, Ducking bei Sprache, Build-up, nahtloser Drop).
- Vollständiger Schnitt eines Clips inkl. Höhepunkt-Erkennung, Musik-Sync, Übergang, Outro, Texten in den TikTok-Safe-Areas, Lautheit −14 LUFS und automatischer Qualitätsprüfung.
- Suche über YouTube, YouTube-Creative-Commons, Dailymotion, Internet Archive, Wikimedia Commons, Reddit (mit OAuth) sowie Link-Import für TikTok.
- 100-Punkte-Bewertung (35/25/20/10/10, Schwelle 75) mit klar gekennzeichneter Analysestufe (vorläufig / technisch analysiert / Inhalt bewertet).

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Installation lokal, in der Cloud und in GitHub Actions |
| [docs/PIPELINE.md](docs/PIPELINE.md) | Bedienung, Zustände, Suche, Bewertung, Schnitt, Automatisierung |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Aufbau des Codes, Datenmodelle, Entscheidungen |
| [docs/VIDEO_STYLE_GUIDE.md](docs/VIDEO_STYLE_GUIDE.md) | Referenzanalyse & Schnittstil |
| [docs/ASSET_INVENTORY.md](docs/ASSET_INVENTORY.md) | Alle Medien, Umbenennungen, gelöschte Platzhalter |
| [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md) | Testergebnisse und Status jeder Funktion |
| [docs/V4_CHANGES.md](docs/V4_CHANGES.md) | Änderungen V4: Wiederholungskontrolle, durchgehende Musik, früheres Dictionary |

## Rechtliches (kurz)

Die Pipeline lädt Videos nur über erlaubte Wege: Dateien, die du selbst bereitstellst, sowie frei lizenzierte Quellen (Creative Commons / gemeinfrei). Zugangssperren und Bot-Schutz von Plattformen werden nicht umgangen. Kindness-Clips Dritter, der Song und das Vinland-Saga-Material sind urheberrechtlich geschützt – die Verantwortung für die Nutzungsrechte beim Veröffentlichen liegt bei dir. Remotion ist für Einzelpersonen und Firmen bis 3 Mitarbeitende kostenlos (danach Firmenlizenz nötig).
