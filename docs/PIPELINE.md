# Pipeline – Bedienung & Funktionsweise

## 1. Zustände

```
DISCOVERED → METADATA_ANALYZED → CONTENT_ANALYZED → SCORED → SHORTLISTED → SELECTED
           → EDITING → RENDERED → QUALITY_CHECKED → REVIEW → APPROVED → EXPORTED
```

Fehler-/Nebenzustände: `MEDIA_UNAVAILABLE`, `ANALYSIS_FAILED`, `RENDER_FAILED`, `QC_FAILED`, `REJECTED`, `ARCHIVED`.

- Jeder Übergang wird mit Zeit und Notiz in `candidate.history` gespeichert; alle Schritte zusätzlich in `data/logs/pipeline-<datum>.jsonl`.
- Ungültige Sprünge (z. B. `RENDERED → APPROVED` ohne Review) werden abgelehnt (`src/core/state.ts`).
- **Wiederholen ohne Neustart:** `npm run kai -- retry <id>` setzt einen Fehlerzustand auf den letzten sinnvollen Schritt zurück. `produce` erkennt einen unterbrochenen Lauf (EDITING/RENDERED) und verwendet einen bereits vorhandenen Render weiter (neu rendern mit `--force`).
- Analysen (Song, Referenzen, Clips) werden gespeichert und nur neu berechnet, wenn sich die Datei ändert (`sha256`) oder `--force` angegeben wird.

## 2. Suche (`discover`)

- Pro Lauf die nächsten 10 Suchbegriffe aus einer rotierenden Liste (21 Basisbegriffe aus dem Briefing, 20 verwandte Themen, 12 mehrsprachige Begriffe DE/ES/PT/FR/IT/TR/AR, Kombinationen mit „shorts") – so werden nicht ständig dieselben viralen Clips gefunden. Zustand: `data/query-state.json`.
- Eigene Begriffe: `npm run kai -- discover --queries "dog saves owner; nurse surprises patient"`.
- Gefiltert werden Videos < 8 s und > 10 min (Compilations).

| Adapter | Finden | Metadaten | Inhalt analysieren | Datei erhalten |
|---|---|---|---|---|
| `youtube` (yt-dlp, nur Suchergebnisseite) | ✅ | Titel, Dauer, Aufrufe, Kanal, Thumbnail | erst mit Datei | ❌ AGB erlauben keinen Download → Datei selbst bereitstellen |
| `youtube-cc` (Creative-Commons-Filter) | ✅ | wie oben + Lizenz CC BY | erst mit Datei | nur mit Opt-in `acquisition.ytDlp.enabled` (aus der Cloud: HTTP 429) |
| `dailymotion` (offizielle API) | ✅ | inkl. Seitenverhältnis/Höhe | erst mit Datei | ❌ selbst bereitstellen |
| `archive_org` | ✅ | inkl. Lizenz | ✅ automatisch bei CC/gemeinfrei | ✅ bei freier Lizenz |
| `wikimedia` | ✅ | inkl. Lizenz, Auflösung | ✅ | ✅ (alle Dateien frei lizenziert) |
| `reddit` | ⚠️ ohne OAuth meist HTTP 403 | – | – | ❌ |
| TikTok | ❌ keine offizielle Such-API | per Link: `import-url` (oEmbed) | erst mit Datei | ❌ selbst bereitstellen |

Eine Datei bereitstellen: Video als `media/inbox/<kandidaten-id>.mp4` ablegen (lokal) bzw. nach `references/raw-examples/` hochladen (GitHub) und `npm run kai -- acquire <id>` bzw. `import <datei>` ausführen.

## 3. Bewertung (100 Punkte)

| Kriterium | Max | Was zählt |
|---|---|---|
| A. Emotionaler Höhepunkt | 35 | Wirkung, Überraschung, Menschlichkeit, Reaktion, Stärke des Schlüsselmoments |
| B. Verständlichkeit | 25 | ohne Erklärung verständlich, Anfang/Ende, Kontext, Kurzvideo-tauglich |
| C. Musik-Drop-Potenzial | 20 | klarer Höhepunkt, synchronisierbar, Übergang zum Outro möglich |
| D. Bildqualität | 10 | Auflösung, Schärfe, Stabilität, Bildausschnitt, 9:16-Eignung |
| E. Originalität | 10 | interessante Handlung, Wendung, Besonderheit, Abwechslung |

**Regel:** ≥ 75 → `SHORTLISTED` (reguläre Auswahl). < 75 → `ARCHIVED` (ausgeblendet, **nie gelöscht**, jederzeit `restore`).

Drei Analysestufen – im Dashboard immer sichtbar:

| Stufe | Grundlage | Kennzeichnung |
|---|---|---|
| `METADATA_ONLY` | Titel, Beschreibung, Dauer, Aufrufe, Auflösung laut Plattform | **vorläufig** |
| `CONTENT_SIGNALS` | Datei dekodiert und gemessen: Auflösung, Schärfe, Stabilität, Schnitte, Lautheits-/Bewegungs-Peak | technisch analysiert – Bedeutung der Szene **nicht** beurteilt |
| `CONTENT_REVIEWED` | Inhalt auf echten Bildern beurteilt (Mensch oder Vision-Modell) → `data/reviews/<id>.json` | einzige Stufe, die als vollständig inhaltlich bewertet gilt |

Jede Teilbewertung enthält Begründungen (`npm run kai -- show <id>`). Ein Review-File hat dieses Format:

```json
{ "candidateId": "…", "reviewer": "human", "reviewedAt": "2026-…", "basis": "ganzes Video angesehen",
  "scores": { "emotional": {"points": 30, "reasons": ["…"]}, "clarity": {…}, "dropPotential": {…},
              "visualQuality": {…}, "originality": {…} } }
```

Danach `npm run kai -- score --ids <id>`.

## 4. Schnitt (`produce`)

1. **Material**: vorhandene Datei, Inbox oder erlaubter Download.
2. **Inhaltsanalyse** (`python -m kindness_analysis video`): Schnitte, Schwarzbilder, Bewegung, Farbe, 9:16-Fokus, Lautheitsverlauf, Höhepunkt-Kandidaten.
3. **Höhepunkt**: stärkste Kombination aus Lautheitsanstieg (Jubel, Weinen, Lachen), Bewegung und Position (~70 % des Clips). Manuell: `npm run kai -- set <id> --highlight 14.5`.
4. **Story**: endet `reactionHoldSec` (2 s) nach dem Höhepunkt (bzw. am nächsten Schnitt), beginnt nach Schwarzbildern; ist sie zu lang (> 40 s), werden langweilige Shots in der Mitte entfernt, dann der Anfang gekürzt – Kontext-Shot und Höhepunkt bleiben. Interne Schnitte werden auf Beats gelegt.
5. **Musik**: `Songstart = Drop − Storylänge` → der Drop (48,216 s) fällt exakt auf das Story-Ende.
6. **Übergang**: `flash` (Standard), `hard-cut`, `dissolve`, `zoom-punch` → `--transition`.
7. **Outro**: gewählte Variante, beatgenau, endet nach 6 Takten + 0,6 s Abblende.
8. **Texte**: optionaler Hook (`--hook "…"`), „kindness."-Caption im Outro (`--caption none` zum Abschalten), Untertitel; alle in den Safe-Areas.
9. **Render** (Remotion, 1080×1920, H.264 CRF 18, AAC 192 kbit/s) → Lautheit auf −14 LUFS normalisiert.
10. **QC** → `REVIEW`. Freigeben im Dashboard oder `approve`, dann `export` → `output/export/`.

Doppelte Produktionen werden verhindert (gleicher Kandidat, gleicher Datei-Hash oder ähnlicher Bild-Hash); bewusst übergehen mit `--allow-duplicate`.

## 5. Konfiguration

`config/pipeline.json` (alle Felder mit Standardwerten in `src/core/config.ts`):

| Feld | Standard | Bedeutung |
|---|---|---|
| `video.fps` | 30 | Bildrate |
| `video.crf` / `x264Preset` | 18 / medium | Qualität / Geschwindigkeit |
| `story.minSec` / `maxSec` | 12 / 40 | Storylänge (max. 48 s wegen Drop) |
| `story.framing` | fit-blur | `cover` / `fit-blur` / `fit-black` für Querformat |
| `audio.musicGainDb` | −7 | Musikpegel vor Normalisierung |
| `audio.storyAudioGain` | 0,3 | Originalton (0 = stumm) |
| `audio.targetLufs` | −14 | Endlautheit |
| `outro.variant` | A | Standard-Outro (wird durch `outro:approve` gesetzt) |
| `outro.bars` | 6 | Outro-Länge in Takten |
| `outro.cutLeadFrames` | 2 | Schnitt so viele Frames vor dem Beat |
| `transition.type` | flash | Übergang |
| `scoring.threshold` | 75 | Schwelle für die Shortlist |
| `acquisition.ytDlp.enabled` | false | yt-dlp-Download (Opt-in, standardmäßig nur CC) |

`config/music.json`: Song, Beat-Map, Drop (`auto` + `manualOverride`). `config/assets.json`: Outro-Quellen (nutzbare Bereiche) und Varianten.

## 6. Automatisierung

1. **Manueller Testlauf**: GitHub → Actions → *Discover candidates* → Run workflow (oder lokal `npm run kai -- run`).
2. Dashboard-Snapshot aus dem Workflow herunterladen bzw. lokal `npm run kai -- dashboard`.
3. Clips auswählen; Material bereitstellen (Inbox / `references/raw-examples/`).
4. *Produce video* starten → Video als Artifact herunterladen, prüfen, selbst veröffentlichen.
5. Läuft das stabil: Zeitplan in `discover.yml` aktivieren (3×/Woche).

Für 3–4 Videos/Woche reicht: 3 Suchläufe/Woche + 3–4 Produktionen. Keine Kosten außer ggf. Actions-Minuten bei privaten Repos.
