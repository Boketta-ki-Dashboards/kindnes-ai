# Architektur

## Überblick

```
                ┌────────────── TypeScript / Node 22 (src/) ──────────────┐
 Plattformen ─► │ discovery/  ─► core/store (data/candidates.json)         │
 (YT, DM, IA,   │      │            ▲        │                             │
  WM, Reddit)   │      ▼            │        ▼                             │
                │ scoring/ ◄── analysis JSON ◄── python/kindness_analysis  │◄─ ffmpeg/ffprobe
                │      │                          (librosa, numpy)         │
                │      ▼                                                   │
                │ pipeline/ (Zustände, Retry, Duplikate)                   │
                │      │                                                   │
                │      ▼                                                   │
                │ edit/planner ─► EditPlan (JSON) ─► render/ ─► Remotion ──┼─► output/<job>/final.mp4
                │   ▲       ▲                         │  (Chromium)        │
                │ music/  outro/                      └─► render/qc         │
                │ dashboard/ (HTTP, statischer Snapshot)  cli.ts            │
                └──────────────────────────────────────────────────────────┘
```

Der **Edit-Plan** (`src/edit/plan-types.ts`) ist die zentrale Schnittstelle: ein reines JSON-Dokument mit allen Zeitpunkten in Sekunden (Story-Segmente, Songstart/Drop/Ende, Outro-Shots, Texte, Übergang). Planer und Renderer sind dadurch entkoppelt; jeder Plan wird unter `data/jobs/<job>/plan.json` gespeichert und ist reproduzierbar.

## Module

| Modul | Aufgabe |
|---|---|
| `src/core/` | Pfade, Konfiguration (zod-Schemas), JSON-Store mit atomaren Schreibvorgängen, Zustandsautomat, Logger (JSONL), Python-Brücke |
| `src/discovery/` | Suchbegriff-Rotation, Plattform-Adapter (einheitliches `SearchAdapter`-Interface) |
| `src/scoring/` | 100-Punkte-Rubrik, Lexika, Scorer für Metadaten / Inhaltssignale / Reviews |
| `src/acquisition/` | erlaubte Beschaffungswege (Inbox, freie Lizenzen, yt-dlp nur Opt-in) |
| `src/music/` | Beat-Map laden, Beat-Raster-Mathematik, Song-Fenster relativ zum Drop |
| `src/outro/` | Shot-Auswahl aus analysiertem Material, Beat-Slots, Outro-Vorschau-Pläne |
| `src/edit/` | Story-Auswahl, Höhepunkt, Beat-Snapping, Texte → EditPlan |
| `src/remotion/` | Komposition `KindnessEdit` (Story, Flash, Outro mit Beat-Puls/Vignette/Grade, Texte, Musik) |
| `src/render/` | Proxys (H.264 CFR, Letterbox-Crop, vorkomponierter Blur-Hintergrund), lokaler Medienserver mit Range-Support, Remotion-Render, 2-Pass-Lautheit, QC |
| `src/pipeline/` | Orchestrierung aller Schritte inkl. Fehlerzustände, Wiederaufnahme, Duplikatschutz |
| `src/dashboard/` | lokaler Server + HTML-Oberfläche; statischer Snapshot |
| `python/kindness_analysis/` | `music` (Beat-Map/Drops/Lautheit), `locate` (Song-Fingerprint), `video` (Schnitte, Schwarzbilder, Bewegung, Farbe, 9:16-Fokus, Höhepunkte) |

## Entscheidungen

- **JSON statt SQLite**: Daten sind klein (Hunderte Kandidaten), Änderungen sind im Git-Diff nachvollziehbar und GitHub Actions kann sie direkt committen. Schreiben ist atomar (temp + rename). Bei > 10.000 Kandidaten wäre SQLite sinnvoll; der Store kapselt den Zugriff.
- **Python für Analyse**: librosa ist für Beat-/Onset-/Chroma-Analyse ausgereift. Alles wird über `ffmpeg` dekodiert (beliebige Formate).
- **Remotion für Komposition, FFmpeg für Vor-/Nachbearbeitung**: Remotion rendert Layout, Texte, Zooms und Übergänge framegenau; FFmpeg erzeugt seekfreundliche Proxys, den Weichzeichner-Hintergrund (≈ 2,5× schneller als CSS-Blur im Headless-Browser) und die Lautheitsnormalisierung.
- **Drop fix, Songstart variabel**: entspricht exakt dem gemessenen Verhalten aller Referenzen.
- **Ehrliche Analysestufen**: Metadaten- und Signalscores sind Heuristiken; nur Reviews auf echten Bildern zählen als inhaltliche Bewertung. Ein Vision-Modell-Reviewer (z. B. Claude API) passt in dasselbe Review-Format, ist aber kostenpflichtig und deshalb nicht aktiviert.
- **Keine Plattform-Umgehung**: Downloads nur bei freier Lizenz bzw. durch dich bereitgestellt. Kein automatischer Upload.

## Datenmodelle (Auszug)

- `Candidate` (`src/core/types.ts`): Plattform, IDs, Metadaten, Kategorien, `state`, `history[]`, `media{status, local{path, sha256, dHash, …}}`, `score{total, A–E mit reasons, analysisLevel, provisional, qualifies}`, `editOverrides`, `jobId`, `lastError`.
- `ProductionRecord` (`data/productions.json`): Kandidat, Job, Media-Hash, dHash, Status, Ausgabedatei.
- `BeatMap` (`data/analysis/music/*.beatmap.json`): BPM, Beats, Downbeats, Abschnitte, Drop-Kandidaten mit Merkmalen, Lautheit.
- `EditPlan` (`data/jobs/<job>/plan.json`).
- `QcReport` (`output/<job>/final.qc.json`, Kopie in `data/jobs/<job>/qc.json`).

## Erweiterungspunkte

- Neuer Suchadapter: `SearchAdapter` implementieren, in `adaptersFor()` eintragen.
- Neue Outro-Variante: Eintrag in `config/assets.json` (Quellen, Beat-Muster, Framing, Zoom, Grade, Overlay).
- Neuer Song: Datei ablegen, `config/music.json` anpassen, `npm run kai -- music:analyze --force`, Drop prüfen.
- Vision-Review: Bilder mit `extractFrame`/`contactSheet` erzeugen, Ergebnis als `data/reviews/<id>.json` speichern.
