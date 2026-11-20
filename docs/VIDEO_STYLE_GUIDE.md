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

## 9. Outro V3 – kuratierter Thorfinn-Schnitt (Stand 2026-11-18)

Basis ist Variante A (golden, Vollbild, Beat-Cut, Drop 48,216 s). Neu: Jede Einstellung wurde anhand echter Einzelbilder der Quellvideos ausgewählt (`config/assets.json` → Variante `V3` → `curated`). Erkenntnis aus der Sichtung: In „I have no enemies" zeigen die meisten frühen Shots (3–36 s) **Thors** (Thorfinns Vater) und andere Figuren – Thorfinn selbst erscheint dort vor allem ab 37 s. „Heart to Heart" enthält die stärksten Thorfinn-Nahaufnahmen.

| # | Akt | Beats | Quelle @ Zeit | Inhalt | Effekt |
|---|---|---|---|---|---|
| 1 | Drop | 2 | No Enemies @ 48,15 s | Thorfinn (Teenager), Nahaufnahme im Profil – Auge, Nase, Mund klar erkennbar | Impact + Lichtakzent |
| 2 | dynamisch | 1 | Heart to Heart @ 4,30 s | Thorfinn (erwachsen), enge Nahaufnahme, Blick gesenkt | Impact |
| 3 | dynamisch | 1 | No Enemies @ 40,00 s | Thorfinn steht im Feld, Erinnerung an sich als Kind | Impact |
| 4 | dynamisch | 2 | No Enemies @ 49,60 s | Thorfinn (Teenager) | Lichtakzent |
| 5 | dynamisch | 1 | No Enemies @ 43,00 s | Thorfinn im Feld, Tinten-Übergang | Impact |
| 6 | dynamisch | 1 | No Enemies @ 50,70 s | Thorfinn (Teenager), Thorkell im Hintergrund | Impact |
| 7 | dynamisch | 2 | Heart to Heart @ 14,90 s | Thorfinn (erwachsen), Nahaufnahme | Motion-Blur |
| 8 | emotional | 1 | No Enemies @ 44,20 s | Thorfinn, Erinnerung an sein jüngeres Ich | Motion-Blur |
| 9 | emotional | 1 | No Enemies @ 52,60 s | Thorfinn (Teenager) vor Askeladd | Motion-Blur |
| 10 | emotional | 2 | No Enemies @ 19,30 s | Thors kniet vor dem kleinen Thorfinn | Lichtakzent |
| 11 | emotional | 1 | No Enemies @ 45,50 s | Thorfinn, Schatten von Askeladd | Motion-Blur |
| 12 | emotional | 1 | No Enemies @ 46,60 s | Thorfinn von oben, Erinnerungs-Feuer | Motion-Blur |
| 13 | emotional | 2 | Heart to Heart @ 5,60 s | Thorfinn Nahaufnahme, 0,9× Tempo | Lichtakzent |
| 14 | ruhig | 2 | No Enemies @ 53,60 s | Vater und Kind-Thorfinn, Silhouette im Sonnenuntergang, 0,85× | Motion-Blur |
| 15 | ruhig | 2 | Heart to Heart @ 21,40 s | Goldenes Feld, Figur am Felsen, 0,85× | Motion-Blur |
| 16 | ruhig | 2 + Abblende | No Enemies @ 55,15 s | Thorfinn (erwachsen) vor Bäumen, nachdenklich, 0,8× | Motion-Blur |

Effekte (alle dezent, nur am Shot-Anfang): **Impact** = 6 Frames Zoom 107 % → 100 % + kurzer Helligkeitsimpuls; **Motion-Blur** = 4 Frames Unschärfe 9 px → 0; **Lichtakzent** = warmes Light-Leak (Screen-Blend), 14 Frames; **Speed-Ramp** = Zeitlupe 0,8–0,9× im ruhigen Schluss; **Beat-Zoom** pro Akt: 2,2 % (Drop/dynamisch), 1,5 % (emotional), 0,6 % (ruhig). Kein Wackeln, keine Kamerafahrten, keine Schwarzbilder (QC).

Nahaufnahmen werden vergrößert (Teenager-Shots 112 %, Heart-to-Heart 122 %) und nach oben verschoben (`focusY`), damit Gesichter weiter oben im Bild sitzen; die Verschiebung ist so begrenzt, dass nie ein Bildrand sichtbar wird. Bei Heart to Heart blickt Thorfinn nach unten und das Gesicht liegt tief im 16:9-Bild – ohne engeren Ausschnitt zeigte der 9:16-Zuschnitt fast nur Haare (erster V3-Render, korrigiert). Deshalb liegt jetzt die Teenager-Nahaufnahme auf dem Drop.

### Zwei Versionen mit identischem Bild

| Version | Datei | Text |
|---|---|---|
| A1 Clean | `kindness-outro-v3-clean.mp4` | weißes `kindness.` (wie Variante A) |
| A2 Dictionary | `kindness-outro-v3-definition.mp4` | Wörterbuch-Karte, nachgebaut nach `references/typography/*.webp` |
| Vergleich | `kindness-outro-v3-comparison.mp4` | links A1, rechts A2, gemeinsame Tonspur, 2160×1920 |

Rendern: `npm run kai -- outro:v3` (lokal/Cloud) oder GitHub Actions → „Render outro V3" (Artifact `kindness-outro-v3`, 30 Tage).

### Wörterbuch-Karte (Remotion-Komponente `src/remotion/components/DictionaryDefinition.tsx`)

Vermessen am Referenz-Screenshot, alles relativ zur Fließtextgröße (36 px):

| Element | Wert |
|---|---|
| Schrift | Google Sans (SIL OFL, `assets/fonts/google-sans`), Lautschrift-Zeichen ʌ/ɪ aus Noto Sans (OFL) |
| Lautsprecher-Button | Kreis Ø 2,12× (76 px), #ACC7F5, Icon #1F2A37 |
| Titel `kindness` | 1,24×, Gewicht 700, weiß |
| Lautschrift `/kʌɪn(d)nɪs/` | 0,75×, gedämpftes Weiß |
| Fließtext | 36 px, Gewicht 400 (GRAD +40), Zeilenraster 1,5×, linksbündig, 9 Zeilen mit den Umbrüchen der Referenz |
| Markierung | #203D95, rechteckige Balken 1,05× hoch, nur „the quality … rewards"; „Kindness is" und der Punkt danach unmarkiert (wie im Screenshot) – umschaltbar mit `text.dictionary.highlightIncludesPeriod` |
| Position | unten links, Unterkante 430 px über dem Bildrand (TikTok-Caption/Nutzername frei), rechts ≥ 150 px Abstand (Buttons); alternativ `text.dictionary.anchor: "top"` |
| Timing | Einblendung ab Beat 2 nach dem Drop (0,86 s – Thorfinn ist auf dem Drop frei sichtbar), 0,4 s Fade-in, statisch, 0,45 s Fade-out vor der Schlussabblende |
| Hintergrund | sanfte Abdunklung (max. 42 %) hinter dem Textblock, wie im Referenzbild |

Bekannter Zielkonflikt: Bei Nahaufnahmen liegt Thorfinns Gesicht bei 55–65 % Bildhöhe, also im unteren Drittel, wo die Referenz den Textblock zeigt. Der Block verdeckt dort Teile des Gesichts (die Zeilen 4–9 sind nur Text ohne Fläche, das Gesicht bleibt dazwischen sichtbar). Mit `anchor: "top"` wären die Nahaufnahmen frei, dafür die Köpfe in den Ganzkörper-Shots verdeckt.

## 10. Outro V4 – gleiche Ästhetik, keine Wiederholungen (Stand 2026-11-19)

Messung der V3-Shotliste mit der neuen Wiederholungskontrolle: Heart to Heart 4,3 s und 14,9 s sind **pixelgleich** (SSIM 0,996, pHash-Abstand 0 – die Animation wiederholt sich als Schleife); dazu kamen die Teenager-Nahaufnahme 4× (48,15 / 49,6 / 50,7 / 52,6 s), dieselbe Feld-Komposition 5× (40,0–46,6 s) und Heart-to-Heart-Nahaufnahmen 3×. V4 nutzt stattdessen **11 eigenständige Motive** (16 → 11 Schnitte; wo kein weiteres eigenständiges Motiv existiert, laufen Shots länger statt doppelt):

| # | Akt | Beats | Quelle @ Zeit | Motiv | Bildtyp |
|---|---|---|---|---|---|
| 1 | Drop | 2 | No Enemies @ 48,15 s | Thorfinn (Teenager) im Profil | Porträt |
| 2 | dynamisch | 2 | No Enemies @ 40,00 s | Thorfinn im Feld, Erinnerung an sich als Kind | Halbtotale |
| 3 | dynamisch | 2 | Heart to Heart @ 4,30 s | Thorfinn (erwachsen), golden | Detail-Nahaufnahme |
| 4 | dynamisch | 1 | No Enemies @ 14,30 s | junger Thorfinn liegt, Blick nach oben (neu) | Porträt, anderer Ausdruck |
| 5 | dynamisch | 1 | No Enemies @ 46,60 s | Thorfinn von oben, Erinnerungs-Feuer | Ganzkörper |
| 6 | emotional | 4 | Heart to Heart @ 8,30 s | Figur mit Kapuze im goldenen Wind (neu) | Halbtotale |
| 7 | emotional | 1 | No Enemies @ 38,85 s | Thorfinn mit langem Haar, Kopf gesenkt (neu) | Halbnah |
| 8 | emotional | 4 | No Enemies @ 19,30 s | Thors kniet vor dem kleinen Thorfinn | Totale |
| 9 | ruhig | 2 | No Enemies @ 53,60 s | Vater & Kind, Silhouette (Ausschnitt korrigiert: Kind jetzt im Bild) | Silhouette |
| 10 | ruhig | 3 | Heart to Heart @ 21,40 s | goldenes Feld, Figur am Felsen, Baum | Landschaft |
| 11 | ruhig | 2 + Abblende | No Enemies @ 55,15 s | Thorfinn vor Bäumen, nachdenklich | Schlussporträt |

**Deine Beispiele, einzeln an echten Frames gemessen** (5 Frames pro Shot, so ausgeschnitten wie im Render; SSIM 1 = identisch, pHash-Abstand 0 = identisch; „Aufbau" = Ähnlichkeit der Bildkomposition):

| Beispiel (V3-Shot #) | SSIM | pHash | Aufbau | Ergebnis | in V4 |
|---|---|---|---|---|---|
| HH 4,3 (#2) ↔ 14,9 (#7) | 0,996 | 0 | 0,98 | **Duplikat** – die Animation wiederholt sich als Schleife | nur 4,3 |
| HH 4,3 (#2) ↔ 5,6 (#13) | 0,28 | 16 | 0,95 | ähnlich – gleiche Nahaufnahme, gleiche Gesichtsposition | 5,6 entfällt |
| HH 14,9 (#7) ↔ 5,6 (#13) | 0,29 | 16 | 0,94 | ähnlich – gleiche Komposition | 14,9 entfällt |
| NE 48,15 (#1) ↔ 49,6 (#4) | 0,31 | 20 | 0,84 | ähnlich – dasselbe Teenager-Profil, gleiche Einstellung | nur 48,15 (auf dem Drop) |
| NE 48,15 (#1) ↔ 50,7 (#6) | 0,29 | 24 | 0,71 | ähnlich – gleiches Motiv | 50,7 entfällt |
| NE 49,6 (#4) ↔ 50,7 (#6) | 0,28 | 22 | 0,85 | ähnlich – nur 2 Shots Abstand | 49,6 entfällt |
| NE 43,0 (#5) ↔ 44,2 (#8) | 0,45 | 20 | 0,91 | ähnlich – gleiche Feld-Komposition | beide entfallen |
| NE 43,0 (#5) ↔ 45,5 (#11) | 0,39 | 26 | 0,35 | ähnlich – gleiches Motiv (Erwachsener im Feld) | – |
| NE 44,2 (#8) ↔ 45,5 (#11) | 0,43 | 24 | 0,31 | ähnlich – gleiche Einstellung | – |
| NE 45,5 (#11) ↔ 46,6 (#12) | 0,55 | 26 | 0,77 | ähnlich – direkt hintereinander, gleiche Einstellung | nur 46,6 (Blick von oben) |
| NE 43,0 / 44,2 ↔ 46,6 | – | – | – | nicht ähnlich (eigenes Motiv) | – |

Ergebnis: Unterschiedliche Zeitstempel waren in V3 tatsächlich keine neuen Motive. Aus jeder Gruppe bleibt in V4 genau ein Shot; die frei gewordenen Beats gehen an neue Motive (#4, #6, #7) oder an längere Shots.

Bewusst nicht verwendet: weitere Ufer-Silhouetten von Vater & Kind (10,6 / 12,3 s – gleiche Komposition wie #9), die zweite Kapuzen-Einstellung (18,2 s), NE 52,6 s (wieder das Teenager-Profil, endet zudem mit einem weißen Blitz-Frame – von der Kontrolle gefunden), NE 9,97 s und 33,9 s (Figur nicht sicher als Thorfinn erkennbar).

Unverändert gegenüber V3: 1080×1920, 30 fps, goldener Grade, Vollbild-Zuschnitt, Effekte, Drop 48,216 s, Outro-Länge, Wörterbuch-Karte (Schrift, Größe, Position, Markierung, Text, Umbrüche). **Einzige Textänderung:** Einblendung beginnt 0,30 s nach dem Drop und dauert 0,25 s (`text.dictionary.fadeInDelaySec` / `fadeInDurationSec`; V3: 0,86 s / 0,40 s).
