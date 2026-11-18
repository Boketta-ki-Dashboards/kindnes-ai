# Video Style Guide & Referenzanalyse

Dieser Leitfaden beschreibt den Kindness-AI-Schnittstil. Alle Zahlen stammen aus der **tatsächlichen Analyse** der vier Referenzvideos und des Outro-Materials (Szenenerkennung, Schwarzbild-Erkennung, Farbmessung und Audio-Fingerprinting gegen „Meant to Be"). Rohdaten: `data/analysis/references/`, Zusammenfassung: `data/analysis/reference-summary.json` (neu erzeugen mit `npm run kai -- references:summary`).

## 1. Grundaufbau (alle Referenzen)

```
 ┌──────────── Kindness-Story ────────────┐┌──── Anime-Outro ────┐┌ Ende ┐
 0 s                               Drop ≈ 48,2 s Songzeit        ≈ 58 s Songzeit
 Song läuft bereits leise/ganz darunter    harter Schnitt / Flash     Fade/Endkarte
 lange, kaum geschnittene Takes            Schnitt auf jeden 1–2 Beats
```

1. **Story** – ein einziger echter Moment, fast ungeschnitten, Musik läuft von Anfang an.
2. **Emotionaler Höhepunkt** – die Reaktion (Weinen, Umarmung, Erkenntnis) passiert in den letzten Sekunden vor dem Drop.
3. **Drop = Schnitt ins Outro** – immer an derselben Songstelle (≈ 48,2 s).
4. **Vinland-Saga-Outro** – ~10 s, goldene Anime-Bilder, rhythmisch auf den Beat geschnitten.
5. **Ende** – Abblende bzw. TikTok-Endkarte.

## 2. Gemessene Werte pro Referenz

| | ref-02 Straßenverkäufer | ref-03 Fußball-Rivalen | ref-04 Hund & blinde Katze | ref-01 Feed-Aufnahme |
|---|---|---|---|---|
| Format | 900×1956 Bildschirmaufnahme | 576×576 (16:9 im Quadrat) | 576×1024 (Inhalt 574×616) | 720×1566 Bildschirmaufnahme |
| Song startet bei (Songzeit) | **18,76 s** | **0,72 s** | **27,96 s** | 1,32 s (erste Story) |
| Übereinstimmung Song ↔ Ton | 96 % | 97 % | 98 % | 95 % |
| Story-Länge | 29,3 s | 47,4 s | ~20,3 s | ~45 s |
| Schnitt ins Outro (Video) | 29,333 s (hart) | 47,433 s (hart) | 19,3 – 20,3 s (Überblendung) | ~46,9 s |
| **Schnitt ins Outro (Songzeit)** | **48,10 s** | **48,15 s** | **47,3 → 48,29 s** | **48,27 s** |
| Outro-Länge | ~9,6 s | 10,4 s | ~9,8 s | ~10 s |
| Outro-Schnittfrequenz | ~2 Beats/Shot | **1 Beat/Shot** (17 Schnitte, Median 0,43 s) | lange Shots + Text-Overlay | Text-Overlay |
| Schnitte in der Story | 0/min (ein Take) | 0/min (weiche Wechsel) | 2,7/min | – |
| Outro-Material | Vinland Saga, Vollbild | Vinland Saga, Letterbox | Vinland Saga + „kindness"-Definition | Vinland Saga + „kindness"-Definition |

**Konsequenzen für die Pipeline:**

- Der **Drop ist fix** (48,216 s, ein Downbeat). Die Story-Länge wird über den **Song-Startpunkt** angepasst: `Songstart = Drop − Storylänge`. Maximal 48,2 s Story.
- Im Outro wird **beatgenau** geschnitten; ref-03 schneidet im Median **~70 ms vor dem Beat** (`outroMedianCutLeadBeforeBeatSec = 0.073`) → Konfiguration `outro.cutLeadFrames = 2` (2 Frames bei 30 fps).
- Outro-Ende ≈ 6 Takte nach dem Drop (Downbeat 58,5 s) → `outro.bars = 6`, danach 0,6 s Abblende.
- Die Story selbst wird **kaum geschnitten**; es werden nur unwichtige Passagen am Anfang/in der Mitte entfernt, interne Schnitte werden auf Beats gelegt.

## 3. Musik

- Track: „Meant to Be", 139,7 BPM, 4/4, Beat-Periode 0,4296 s.
- Drop-Vorschlag: **48,216 s** (Quelle: Referenz-Konsens; rein energetisch erkennt die Analyse noch 20,8 s, 19,1 s, 128,8 s, 60,2 s – alle in `dropCandidates`).
- Korrigieren: `npm run kai -- music:drop --set 48.216` (oder `--clear`). Alle Zeitpunkte (Songstart, Outro-Schnitte, Outro-Ende) passen sich automatisch an.
- Mix: Song ist sehr laut gemastert (−6,2 LUFS) → Musik −7 dB, Original-Ton der Story 30 % (stumm, wenn der Clip schon Musik enthält), Story-Ton blendet in den letzten 0,5 s vor dem Drop aus, Endmix auf **−14 LUFS / −1,5 dBTP** normalisiert.

## 4. Übergang zum Outro

| Typ | Beschreibung | Referenz |
|---|---|---|
| `flash` (Standard) | 8 Frames warmes Weiß (#fff6dc), Peak genau auf dem Drop | entspricht dem hellen ersten Outro-Bild |
| `hard-cut` | harter Schnitt auf dem Drop | ref-02, ref-03 |
| `dissolve` | erstes Outro-Bild blendet über die Länge des Übergangs ein | ref-04 |
| `zoom-punch` | erstes Outro-Bild startet mit 122 % Zoom | – |

## 5. Outro-Varianten

| Variante | Name | Material | Schnitt | Framing | Look |
|---|---|---|---|---|---|
| **A** | Golden Beat-Cut | I have no enemies | 2-1-1-2-1-1-2-2 Beats | Vollbild-Zuschnitt (nach 9:16-Eignung ausgewählt) | golden |
| **B** | Heart-to-Heart ruhig | Heart to Heart + I have no enemies | 1 Takt (4 Beats) pro Shot | ganzes Bild + unscharfer Hintergrund | warm-soft |
| **C** | Kindness-Definition | beide | 2 Beats | Vollbild | golden + eigene Definitionskarte |
| **D** | Direktübernahme edit-c | edit-c (Fremd-Edit) | wie Original | ganzes Bild + Hintergrund | natürlich – **nur mit Erlaubnis** |

Gemeinsam: leichter Zoom pro Shot (`zoom`), kleiner Zoom-Impuls auf jedem Beat, dezente Vignette, Abblende am Ende. Vorschauen: `npm run kai -- outro:preview` → `output/outro-previews/outro-<X>.mp4`. Freigabe: `npm run kai -- outro:approve B`.

## 6. Bild & Framing (1080 × 1920, 9:16)

- **Hochkant-Quellen** (Seitenverhältnis < 0,7) füllen das Bild (`cover`).
- **Querformat/Quadrat** werden vollständig gezeigt, darunter eine unscharfe, abgedunkelte Kopie (`fit-blur`) – keine abgeschnittenen Gesichter.
- Langsamer Push-in über die Story (+5 %), nach dem Höhepunkt etwas schneller.
- Keine Schwarzbilder außer der finalen Abblende (wird in der QC geprüft).

## 7. Text & Safe Areas

TikTok-UI verdeckt oben ~220 px, unten ~420 px (Caption, Sound) und rechts ~150 px (Buttons). Alle Texte bleiben innerhalb dieses Bereichs (`SAFE_AREA` in `src/edit/plan-types.ts`).

| Stil | Position | Einsatz |
|---|---|---|
| `hook` | oben, unter der Safe-Area, 64 px fett, halbtransparenter Kasten | optionaler Einstiegssatz (0,2 – 4 s) |
| `subtitle` | unten über der Safe-Area, 52 px | Untertitel (aus Quellzeit übertragen) |
| `drop-caption` | Mitte (Vollbild) bzw. unter dem Bild (Fit-Layouts), 84 px | „kindness." während des Outros (wie ref-01) |
| Definitionskarte | unteres Drittel mit dunklem Verlauf | Variante C |

## 8. Qualitätskriterien (automatische QC)

H.264 + AAC, 1080×1920, eingestellte Bildrate, Länge = Plan ± 0,13 s, Audio/Video gleich lang, keine Schwarzbilder und keine Tonlücken vor der Abblende, −16,5 … −11,5 LUFS, True Peak ≤ −0,5 dBTP und – per Audio-Fingerprint nachgemessen – **Musik exakt auf dem geplanten Songstart (± 60 ms)**, damit der Drop auf dem Übergang liegt.
