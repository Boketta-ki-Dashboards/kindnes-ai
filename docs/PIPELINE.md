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

## 7. Musik-Dramaturgie (seit V4, gilt für jede Produktion)

„Meant to Be" läuft als **eine durchgehende Spur** vom ersten Bild bis zum Ende. Der Songstart wird so berechnet, dass Songsekunde 48,216 (Drop) exakt auf den Schnitt ins Outro fällt; am Drop wird nichts neu gestartet und keine zweite Spur eingeblendet. Der Pegel folgt einer Envelope, die pro Bild im Edit-Plan steht (`plan.music.envelope`, Code: `src/music/envelope.ts`):

| Phase | Zeitraum | Musik-Gain (vor Normalisierung) | Konfiguration |
|---|---|---|---|
| A Story-Beginn | 0 s, 0,4 s Einblendung | −20 dB | `audio.storyMusic.startDb`, `fadeInSec` |
| B Story-Verlauf | bis 4 s auf | −18 dB, bei Sprache zusätzlich −6 dB (Attack 0,15 s mit Vorlauf, Hold 0,15 s, Release 0,45 s) | `audio.storyMusic.bodyDb`, `riseSec`, `audio.ducking.*` |
| C Aufbau | die letzten 6 Beats vor dem Drop (≈ 2,6 s), Start exakt auf einem Beat | weiche S-Kurve hoch auf das Outro-Niveau | `audio.storyMusic.buildUpBeats` |
| D Drop / Outro | ab Drop | −7 dB (wie bisher), Schlussabblende 0,6 s | `audio.musicGainDb` |

- **Originalton der Story**: 90 % (`audio.storyAudioGain`), blendet in den letzten 0,5 s vor dem Drop aus.
- **Sprache** wird automatisch erkannt (Energie im Sprachband + Silbenrhythmus 2–8 Hz, `python/kindness_analysis/speech.py`); nur dort wird die Musik abgesenkt.
- **Clip enthält schon den Song?** Wird per Audio-Fingerprint erkannt (`audio.songDetectSimilarity`); dann wird der Originalton stummgeschaltet, damit der Song nicht doppelt bzw. phasenverschoben läuft (`audio.muteStoryIfSongDetected`).
- **Lautheit**: gemessen wird nur das Outro (Drop bis Schlussabblende) → ein statischer Gain auf das ganze Video (+ Spitzenlimiter bei −1,5 dBFS, ohne Auto-Level). Das Outro landet bei −14 LUFS wie bisher, die leisere Story bleibt leiser (`audio.normalizeOn: "outro"`). Die frühere `loudnorm`-Zweipass-Methode konnte bei großem Pegelumfang in einen dynamischen Modus wechseln und hätte die Dramaturgie eingeebnet.

QC jeder Produktion (`src/render/audio-qc.ts`): Musik- und Story-Spur werden getrennt gerendert. Gemessen werden der tatsächlich angewendete Gain (Musikspur ÷ Original-Song an derselben Stelle, zeitlich ausgerichtet) gegen den Plan, Lücken, Neustart oder zweite Spur (Fingerprint), leiser Beginn (≥ 10 dB unter dem Outro), gleichmäßiger Aufbau, kein Sprung am Drop, Sprach-zu-Musik-Abstand ≥ 8 dB während Sprache, Stummschaltung bei Song im Clip und Outro-Lautheit −14 LUFS.

## 8. Visuelle Wiederholungskontrolle (seit V4)

`npm run kai -- outro:check V4` bzw. automatisch in der QC jeder Produktion (`src/outro/repetition.ts` → `python/kindness_analysis/shotsim.py`). Pro Shot werden 5 Bilder genau wie im Video zugeschnitten und paarweise verglichen:

1. Herkunft/Zeitbereich (gleiche Quelle, überlappende Fenster, gleiche Einstellung ohne harten Schnitt – nur zusammen mit messbarer Bildnähe),
2. pHash (63 Bit, kleinster Hamming-Abstand),
3. SSIM (90×160, bestes Bildpaar),
4. Komposition (3×4-Raster aus Helligkeit + Kanten) und Gesichtsposition (`focusX/focusY`), dazu das kuratierte Motiv-Label,
5. Abstand im Schnitt (Shots, Sekunden).

Regeln: keine Dopplungen (SSIM ≥ 0,72 oder pHash ≤ 8), ähnliche Shots mindestens 3 Shots auseinander, kein Motiv dreimal, keine leeren/weißen Frames innerhalb eines Shots. Ergebnis: Bericht + Kontaktübersicht (PNG, auffällige Shots rot markiert). Schwellen in `outro.repetition` (`config/pipeline.json`); `severity: "warning"` meldet nur, `"error"` blockiert die Produktion.
