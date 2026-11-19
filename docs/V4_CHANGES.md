# V4 – Änderungen

Stand: 2026-11-19 · Status: **nicht freigegeben**. Die Freigabe erfolgt erst nach deiner Sichtung mit
`npm run kai -- outro:approve V4 --overlay dictionary`. Messwerte stehen in [TEST_RESULTS.md §5](TEST_RESULTS.md#5-v4-wiederholungskontrolle-durchgehende-musik-früheres-dictionary).

## 1. Thorfinn-Szenen ohne sichtbare Wiederholungen

**V3, nachgemessen:** 16 Shots, davon 1 pixelgleiches Duplikat (Heart-to-Heart-Loop als Shot 2 und 7) und 3 Paare ähnlicher Shots zu dicht hintereinander. Drei Motive kamen 3–5× vor (Teen-Profil, Heart-to-Heart-Nahaufnahme, Erwachsener im Feld).

**V4:** Es gibt jetzt **11 Shots mit 11 verschiedenen Motiven** und dieselbe Outro-Länge (24 Beats). Weniger Schnitte, dafür keine Doppelungen. Die Abfolge (vollständige Liste in [VIDEO_STYLE_GUIDE §10](VIDEO_STYLE_GUIDE.md)):

| Akt | Shots |
|---|---|
| Drop | Thorfinn (Teen-Profil) direkt auf dem Drop |
| dynamisch | Erwachsener im Feld · Heart-to-Heart-Nahaufnahme · liegend, nach oben blickend · Feld von oben |
| emotional | Kapuzenfigur im Wind · Erwachsener mit gesenktem Kopf · Vater kniet beim Kind |
| ruhig (wie V3) | Vater-Kind-Silhouette · Feld mit Fels und Baum · Erwachsener vor Bäumen (Schlussbild) |

Look, Golden-Grade, Effekte (Impact, Lichtakzent, Blur-In, Speed-Ramp), Cover-Framing, Zoom und Drop bleiben wie in V3.

**Wiederholungskontrolle (dauerhaft in der Pipeline):** `python/kindness_analysis/shotsim.py` und `src/outro/repetition.ts`.

- **Messung je Shot:** Es werden 5 Frames geprüft, ausgeschnitten wie im fertigen Render. Verglichen werden pHash, SSIM, Bildaufbau und Gesichtsposition, Herkunft (Quelle und Zeitfenster) sowie das Motiv-Label. Leere oder weiße Frames werden ebenfalls erkannt.
- **Regeln:** keine Duplikate, ähnliche Shots mindestens 3 Shots auseinander, kein Motiv 3× oder öfter.
- **Bei Verstoß:** Die QC meldet die betroffenen Shots und erzeugt eine Kontaktübersicht mit markierten Paaren (`*.shots.png`).
- **Konfiguration:** Schwellenwerte und Schweregrad stehen in `config/pipeline.json` unter `outro.repetition`.
- **Einzelprüfung:** `npm run kai -- outro:check V4`

## 2. Musik läuft durchgehend unter der Story

Ein einziger Song wird ohne Neustart, Cut oder zweiten Track abgespielt. Die Lautstärke folgt einer Gain-Kurve, die pro Frame im Edit-Plan gespeichert wird (`plan.music.envelope`):

| Phase | Verhalten | Konfiguration (`config/pipeline.json` → `audio`) |
|---|---|---|
| A Start | 0,4 s Fade-in auf −20 dB | `storyMusic.fadeInSec`, `startDb` |
| B Story | Anstieg auf −18 dB; **Ducking −6 dB, solange gesprochen wird** (Attack 0,15 s, Release 0,45 s, mit Vorlauf) | `storyMusic.bodyDb`, `riseSec`, `ducking.*` |
| C Build-up | beginnt auf einem Beat, 6 Beats (≈ 2,6 s) vor dem Drop, S-Kurve | `storyMusic.buildUpBeats` |
| D Drop | genau der bisherige Outro-Pegel (−7 dB), kein Sprung | `musicGainDb` |

Weitere Bausteine:

- **Spracherkennung:** `python/kindness_analysis/speech.py` nutzt Energie im Sprachband und die Silbenmodulation (2–8 Hz) und ist in der Clip-Analyse gecacht.
- **Keine doppelte Musik:** Enthält der Clip den Song bereits (Fingerprint), wird der Clip-Ton stummgeschaltet. Steuerung über `muteStoryIfSongDetected`.
- **Story-Lautstärke automatisch:** Die Sprache wird auf etwa −20 dBFS gebracht, begrenzt auf −6 … +12 dB (`storyLevel`). Ein manueller Wert in den Overrides hat Vorrang.
- **Normalisierung zerstört die Dramaturgie nicht:**
  - Gemessen wird nur das Outro-Fenster.
  - Darauf wird ein fester Gain auf −14 LUFS angewendet, dazu ein Limiter (`normalizeOn: "outro"`).
  - Die Story bleibt dadurch leiser als das Outro.
- **QC misst den Ton tatsächlich** (`src/render/audio-qc.ts`): Musik- und Story-Stem werden getrennt gerendert. Daraus prüft die QC:
  - ob der angewendete Gain der Plan-Kurve folgt,
  - ob der Song lückenlos und als ein einziger Track läuft,
  - leisen Start, stetigen Build-up und dass es am Drop keinen Sprung gibt,
  - den Abstand von Sprache zu Musik,
  - dass keine doppelte Musik entsteht.
  
  Das Diagramm geplant vs. gemessen wird als `*.audio-envelope.png` gespeichert.

## 3. Dictionary früher

Die Einblendung beginnt **0,30 s nach dem Drop** (V3: 2 Beats ≈ 0,86 s) und dauert **0,25 s** (V3: 0,4 s). Das Ausblenden bleibt unverändert. Die Werte stehen in `config/pipeline.json` unter `text.dictionary.fadeInDelaySec` und `fadeInDurationSec`. Schrift, Größe, Position, Markierung, Text und Zeilenumbrüche sind unverändert: Die Karte ist im Endzustand pixelgleich mit V3 (PSNR 99 dB). Während der Story wird nichts eingeblendet.

## 4. Nicht verändert

Clip-Suche, Bewertung (100 Punkte, Schwelle 75), Dashboard, Zustandsmaschine, V3-Varianten und die Typografie bleiben unverändert. Das aktive Outro in `config/pipeline.json` (`outro.variant`) wurde **nicht** auf V4 umgestellt.

## 5. Reproduzieren

```bash
npm run kai -- outro:v3     # V3-Referenz (für den Vergleich)
npm run kai -- outro:v4     # A, B, B2, C + QC → output/kindness-v4/
```

Ohne eigenen Rechner: GitHub → Actions → **„Render V4 (outro + full audio test)"** → *Run workflow*. Der Workflow läuft auch automatisch bei jedem Push auf `claude/**`, wenn sich relevante Dateien ändern. Das Ergebnis liegt als Artifact `kindness-v4` 30 Tage zum Download bereit. Videos werden nicht ins Git committet; in `docs/v4/` liegen nur verkleinerte Bilder und der QC-Bericht.
