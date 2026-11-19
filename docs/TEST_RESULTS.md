# Testergebnisse

Stand: 2026-11-19 (inkl. Outro V3 und V4), Claude-Code-Cloud-Umgebung (Linux, 4 vCPU, 15 GB RAM, Node 22.23, Python 3.13, FFmpeg 7, Chromium Headless Shell 1243, Remotion 4.0.545).
Alle Angaben sind tatsächlich ausgeführte Läufe; nichts davon ist geschätzt.

## 1. Automatisierte Tests

| Suite | Befehl | Ergebnis |
|---|---|---|
| TypeScript-Typecheck | `npx tsc --noEmit` | ✅ fehlerfrei |
| TypeScript/Vitest (62 Tests, 7 Dateien) | `npm test` | ✅ 62/62 bestanden (~28 s, davon ~25 s echter Render) |
| Python/unittest (8 Tests) | `npm run test:py` | ✅ 8/8 bestanden (~7 s) |

Synthetische Testmedien werden von den Tests selbst erzeugt, heißen `TEST_*` / tragen den Bildtext „TEST MEDIA" und liegen nur in `.cache/test-media/` (nicht im Git).

| Gefordert | Abgedeckt durch | Status |
|---|---|---|
| Dateierkennung | `media-render.test.ts` › Inbox-Suche nach Kandidaten-ID; `references:analyze` über alle Asset-Ordner | ✅ |
| Medien-Metadaten | `media-render.test.ts` › ffprobe Auflösung/FPS/Dauer/Codecs; Python `VideoTests` | ✅ |
| Beat-Analyse | Python `MusicTests` (Klicktrack 120 BPM → 120 ± 2, Beat-Abstand 0,5 s; Drop am Energiesprung erkannt); `timing.test.ts` › echte Beat-Map von „Meant to Be" (130–150 BPM, Drop 48,216 s liegt auf einem Downbeat) | ✅ |
| Score-Berechnung | `scoring.test.ts` (Gewichte 35/25/20/10/10 = 100, Summe = Gesamtpunktzahl, Grenzen je Kriterium, Begründungen vorhanden, Compilation-Abzug, Analysestufen) | ✅ |
| Schwellenwert 75 | `scoring.test.ts` (74,9 → nicht qualifiziert, 75 → qualifiziert); `pipeline.test.ts` (≥ 75 → SHORTLISTED, < 75 → ARCHIVED, wiederherstellbar, nichts gelöscht) | ✅ |
| Duplikaterkennung | `store-state.test.ts` (gleiche ID, URL-Varianten youtu.be/shorts/watch, TikTok, Dailymotion, ähnlicher Titel, gleicher Datei-Hash); `media-render.test.ts` (Bild-Hash: identisch 0, anderes Bild > 60, neu kodierte Kopie ≤ 40); `pipeline.test.ts` (zweiter Suchlauf findet nichts Neues) | ✅ |
| Schnitt-Timing | `timing.test.ts` (Story endet Höhepunkt + 2 s, Drop exakt am Story-Ende, max. Storylänge, Kontext + Höhepunkt bleiben beim Kürzen, Jump-Cuts auf Beats, Schwarzbilder übersprungen, Texte innerhalb der Laufzeit, manuelle Drop-Korrektur verschiebt alles) | ✅ |
| Outro-Synchronisation | `timing.test.ts` (Slots folgen dem Beat-Muster, enden exakt am Outro-Ende, lückenlose Shots, Schnitt genau 2 Frames vor dem Beat, Vorschau-Pläne für alle Varianten aus dem echten Material) | ✅ |
| Videoexport | `media-render.test.ts` › echter Remotion-Render → 1080×1920 H.264/AAC, QC ohne Fehler, **Musik-Offset im gerenderten Ton nachgemessen** | ✅ |
| Fehlerbehandlung | `store-state.test.ts` (ungültige Übergänge werden abgelehnt); `pipeline.test.ts` (gesperrte Plattform wird erkannt und nicht weiter abgefragt; YouTube/Dailymotion/TikTok werden nicht heruntergeladen, verständliche Meldung) | ✅ |
| Wiederaufnahme | `store-state.test.ts` + `pipeline.test.ts` (RENDER_FAILED → retry → SELECTED ohne erneute Suche/Bewertung; EDITING/RENDERED können fortgesetzt werden) | ✅ |

## 2. Integrationstests mit echtem Material

### Musik „Meant to Be"
- Analyse in 7 s: **139,7 BPM**, 364 Beats, 91 Downbeats, 8 Abschnitte, −6,2 LUFS, True Peak +1,9 dBTP.
- Song in den Referenzen per Fingerprint wiedergefunden (Ähnlichkeit 0,95–0,98): Songstart 18,76 s / 0,72 s / 27,96 s; Schnitt ins Outro bei Songzeit 48,10 s / 48,15 s / ~48,3 s → Drop 48,216 s.

### Outro-Vorschauen (`npm run kai -- outro:preview`)

| Variante | Datei | Renderzeit | QC |
|---|---|---|---|
| A Golden Beat-Cut | `output/outro-previews/outro-A.mp4` (12,5 MB, 13,4 s) | 50 s | ✅ bestanden (im ersten Lauf ❌: QC fand 0,13 s fast-schwarzes Bild → dunkle Shots werden jetzt ausgeschlossen) |
| B Heart-to-Heart ruhig | `outro-B.mp4` (10,7 MB) | 58 s (vorher 2,5 min mit CSS-Blur) | ✅ |
| C Kindness-Definition | `outro-C.mp4` (11,8 MB) | 50 s | ✅ |
| D Direktübernahme edit-c | `outro-D.mp4` (10,6 MB) | 46 s | ✅ (Warnung: Fremd-Edit, nur mit Erlaubnis; 1,2 s kürzer als das Outro-Fenster) |

Die Vorschauen beginnen mit 2,5 s Platzhalter („Story-Clip endet hier → Drop").

### Vollständiger End-to-End-Edit

Eingabe: Story-Teil der Referenz 4 (Hund führt blinde Katze), aus `ref-04` herausgeschnitten → `media/test-inputs/TEST-INPUT_ref04-story_dog-guides-blind-cat.mp4` (574×616, 19,2 s). **Nur Testmaterial, nicht zur Veröffentlichung** (fremder Clip mit TikTok-Wasserzeichen; enthält bereits den Song, daher Original-Ton stumm).

| | Outro B | Outro A |
|---|---|---|
| Ausgabe | `output/2026-11-18_local_test-input_ref04-story_dog-guides-blind-cat_B/final.mp4` | `…_A/final.mp4` |
| Länge | 27,39 s (Story 16,5 s + Outro 10,9 s) | 27,39 s |
| Höhepunkt (automatisch) | 14,5 s (Nahaufnahme der blinden Augen) | gleich |
| Songstart / Drop | 31,716 s / 48,216 s | gleich |
| Renderzeit | ~2,5 min inkl. erstmaliger Proxy-Erstellung | ~1,7 min |
| QC (11 Prüfungen) | ✅ alle bestanden | ✅ alle bestanden |
| Musik-Offset nachgemessen | 31,695 s (Soll 31,716 s → **21 ms**) | 31,695 s (21 ms) |
| Lautheit / True Peak | −14,0 LUFS / −6,5 dBTP | gleich |
| Status | `REVIEW` (wartet auf Freigabe) | `REVIEW` |

### Erster echter Suchlauf (`npm run kai -- discover`)

| Adapter | Treffer | neu | Duplikate | gefiltert | Status |
|---|---|---|---|---|---|
| youtube | 120 | 47 | 4 | 69 (meist > 10 min Compilations) | ✅ |
| youtube-cc | 118 | 70 | 17 | 31 | ✅ |
| dailymotion | 120 | 78 | 30 | 12 | ✅ |
| archive_org | 120 | 68 | 8 | 44 | ✅ |
| wikimedia | 41 | 23 | 2 | 16 | ✅ |
| reddit | 0 | 0 | – | – | ❌ HTTP 403 (Cloud-IP gesperrt; mit OAuth-Secrets nutzbar) |

**286 echte Kandidaten**, alle bewertet: 4 ≥ 75 (Shortlist, vorläufig), 282 archiviert.

### Beschaffung + Inhaltsanalyse an echten Funden
- 2 frei lizenzierte Wikimedia-Clips automatisch geladen und analysiert (`CONTENT_SIGNALS`).
- Befund: Ein CDC-Schulungsvideo („Bad Sportsmanship", gemeinfrei, 1080p) erhielt durch technische Signale 70,3 Punkte, ist inhaltlich aber keine Kindness-Story. Nach Sichtung der Bilder als Review erfasst → **19 Punkte**. Fazit: Für die Kriterien A–C ist eine Inhaltsprüfung auf echten Bildern nötig (Mensch oder optionaler Vision-Reviewer).

### Dashboard
- Lokaler Server: Laden, Tabs, Filter, Aktionen und eingebetteter Videoplayer im Review-Tab per Playwright geprüft; keine JS-Fehler; mobil (390 px) kein horizontales Scrollen.
- Statischer Snapshot (`dashboard-dist/index.html`, 0,8 MB): 287 Karten, Favorit wird im Browser gespeichert, Export der Auswahl.

## 3. Nicht ausgeführt / blockiert

| Punkt | Grund |
|---|---|
| Vision-Reviewer (`npm run kai -- review <id>`) | **implementiert, nicht getestet** – kostenpflichtige Claude API, ohne deine Zustimmung nicht aufgerufen; standardmäßig deaktiviert. Typen gegen das offizielle SDK geprüft. |
| GitHub-Actions-Workflows | CI läuft bei jedem Push. **Korrektur:** Die CI-Läufe #1 und #2 sind fehlgeschlagen, weil `src/media/ffmpeg.ts` durch die `.gitignore`-Regel `media/` nie committet wurde (lokal fiel das nicht auf). Behoben im Commit „Fix .gitignore…“; danach Typecheck + 49/49 Tests in einem frischen Klon bestanden. Manuell startbare Workflows (Discover, Produce) erscheinen erst im Actions-Tab, wenn sie im Standard-Branch liegen. |
| YouTube-/Dailymotion-/TikTok-Downloads | bewusst nicht implementiert (Nutzungsbedingungen); YouTube-Einzelseiten liefern aus der Cloud zudem HTTP 429. yt-dlp-Download nur als Opt-in für CC-Videos – nicht getestet. |
| Reddit | blockiert (HTTP 403 ohne OAuth). |
| Integrationstest mit einem eigenen, unbearbeiteten Kindness-Clip | `references/raw-examples/` ist noch leer. Sobald dort ein Clip liegt: `npm run kai -- import references/raw-examples/<clip>.mp4` und `produce`. |

## 4. Outro V3 (kuratierter Thorfinn-Schnitt, zwei Textversionen)

Befehl: `npm run kai -- outro:v3` · Ergebnis: **40/40 Prüfungen bestanden** (vollständiger Bericht: [`docs/outro-v3/QC_REPORT.md`](outro-v3/QC_REPORT.md), Screenshots in `docs/outro-v3/`).

| Datei | Format | Größe |
|---|---|---|
| `kindness-outro-v3-clean.mp4` | 1080×1920, H.264/AAC, 30 fps, 13,42 s | 14,9 MB |
| `kindness-outro-v3-definition.mp4` | 1080×1920, H.264/AAC, 30 fps, 13,42 s | 15,4 MB |
| `kindness-outro-v3-comparison.mp4` | 2160×1920 nebeneinander, eine Tonspur | 23,2 MB |

| Prüfung | Messung |
|---|---|
| Thorfinn direkt auf dem Drop | erster Shot = Thorfinn-Nahaufnahme, beginnt exakt am Drop (aus kuratierter Shot-Liste + Sichtprüfung der Screenshots) |
| erste 6 Beats nur Thorfinn | 5 Shots, alle `thorfinn-*` |
| keine langen leeren Landschaften | 1 Landschafts-Shot (0,86 s) im ruhigen Schlussakt |
| emotionales Ende | letzte 3 Shots im Akt „ruhig", Schlussbild Thorfinn |
| Drop synchron | Drop 48,216 s; Musik-Offset im gerenderten Ton nachgemessen: 45,697 s (Soll 45,716 s, 19 ms) |
| Schnitte auf dem Beat | alle 15 Schnitte genau 2 Frames (67 ms) vor einem Beat |
| identischer Bildschnitt | Shot-Listen identisch; Bildvergleich im gemeinsamen Bereich (obere 700 px): PSNR Ø 49,9 dB, min 43,1 dB |
| Definition wortgetreu | Text aus den 9 Zeilen == Vorgabe (396 Zeichen) |
| Markierung | genau „the quality … rewards"; „Kindness is" und „. It reduces" unmarkiert |
| Safe Areas (Pixelmessung) | Definition x 63–874, y 889–1482; Clean x 297–690, y 1091–1156 (erlaubt: x 60–930, y 220–1500) |
| keine doppelten Texte | Clean: nur „kindness."; Definition: nur Karte |
| Schwarzbilder / Tonlücken / Lautheit | keine; −14 LUFS; True Peak −6,7 dBTP (beide Versionen) |

Im ersten V3-Lauf schlug die Safe-Area-Prüfung fehl (Markierungsbalken 1 px über dem linken Rand, x = 59) – korrigiert. Zusätzlich zeigte die Sichtung, dass die Heart-to-Heart-Nahaufnahmen im 9:16-Ausschnitt fast nur Haare zeigten → engerer Ausschnitt, Teenager-Nahaufnahme auf den Drop.

Nicht automatisch prüfbar (manuell anhand der Screenshots bewertet): ob Gesichter „wichtig" angeschnitten sind und ob die Figur wirklich Thorfinn ist – die Zuordnung beruht auf meiner Sichtung der Einzelbilder (Shot-Liste in `docs/VIDEO_STYLE_GUIDE.md`).

**Unabhängig auf GitHub Actions reproduziert:** Workflow „Render outro V3" (Lauf #2, https://github.com/Boketta-ki-Dashboards/kindnes-ai/actions/runs/44406611378) hat alle drei Videos in einer frischen Ubuntu-Umgebung gerendert, die QC bestanden (der Schritt bricht bei einer fehlgeschlagenen Prüfung ab) und das Artifact `kindness-outro-v3` (49 MB, gültig bis 18.12.2026) hochgeladen. CI-Lauf #4 auf demselben Commit: bestanden.

## 5. V4 (Wiederholungskontrolle, durchgehende Musik, früheres Dictionary)

Befehl: `npm run kai -- outro:v4` · Ergebnis: **66/66 Prüfungen bestanden** (vollständiger Bericht: [`docs/v4/QC_REPORT.md`](v4/QC_REPORT.md), Bilder in `docs/v4/`). **V4 ist nicht freigegeben** (`approved: false`, `outro.variant` unverändert).

| Datei | Inhalt | Format | Größe |
|---|---|---|---|
| A `kindness-outro-v4-definition.mp4` | Outro V4 mit Dictionary (2,5 s Vorlauf + Outro) | 1080×1920, H.264/AAC, 30 fps, 13,42 s | 14,0 MB |
| B `kindness-v4-full-audio-test.mp4` | ganze Timeline: TEST-Story + durchgehender Song + V4-Outro | 1080×1920, 27,41 s | 25,7 MB |
| B2 `kindness-v4-speech-ducking-test.mp4` | TEST mit Sprache (Ducking/Verständlichkeit) | 1080×1920, 28,91 s | 23,1 MB |
| C `kindness-v3-v4-comparison.mp4` | V3 links, V4 rechts, synchron, Ton von V4 | 2160×1920, 13,42 s | 23,1 MB |

**Testmaterial (klar gekennzeichnet):** Es liegt kein rechtlich nutzbarer Kindness-Clip mit Sprache vor. B nutzt den Story-Teil der Referenz 4 (`TEST-INPUT_ref04-story_…`), der den Song bereits enthält → dieser Fall testet „keine doppelte Musik". B2 nutzt einen gemeinfreien CDC-Clip mit Sprache (`TEST-SPEECH_cdc-public-domain_classroom.mp4`, keine Kindness-Story) → testet Ducking und Sprachverständlichkeit.

### Visuelle Wiederholungen (gemessen)

| | V3 | V4 |
|---|---|---|
| Shots | 16 | 11 |
| Duplikate | 1 (#2 = #7, SSIM 1,00, pHash-Abstand 0 – derselbe Heart-to-Heart-Loop) | 0 |
| zu nah beieinander (< 3 Shots Abstand) | 3 Paare (#3/#5, #4/#6, #11/#12) | 0 |
| Motiv ≥ 3× | 3 Gruppen (Teen-Profil 4×, Heart-to-Heart 3×, Feld-Erwachsener 5×) | 0 |
| Ergebnis Wiederholungskontrolle | ❌ 7 Verstöße | ✅ alle 11 Shots verschieden |

Methode: 5 Frames pro Shot, ausgeschnitten wie im Render (9:16-Cover, Fokus, Zoom), 63-bit-DCT-pHash, SSIM, 3×4-Layout-Deskriptor (Bildaufbau/Gesichtsposition), Herkunft (Quelle + Zeitfenster, gleiche Einstellung), kuratiertes Motiv-Label, Leerbild-Erkennung. Übersichten: `docs/v4/v3-shot-overview.jpg`, `docs/v4/v4-shot-overview.jpg`.

### Musik (aus getrennt gerenderten Stems gemessen, nicht geschätzt)

Der Musik-Stem wird gegen den Original-Song an derselben Songposition verglichen → tatsächlich angewendeter Gain je 0,2 s. Diagramme: `docs/v4/*.audio-envelope.png`.

| Prüfung | A Outro | B Full Audio | B2 Sprache |
|---|---|---|---|
| Gain folgt dem Plan (Median / Max. Abweichung) | 0,1 / 0,9 dB | 0,1 / 0,9 dB | 0,1 / 1,0 dB |
| Song durchgehend, ein Track, kein Neustart | ✅ ein Offset 45,7 s | ✅ ein Offset 31,7 s, 27 s abgedeckt | ✅ ein Offset 30,2 s, 28 s abgedeckt |
| Lücken (< −60 dBFS) | 0 | 0 | 0 |
| Leiser Start (Story) vs. Outro | – (nur 2,5 s Vorlauf) | −19,2 dB vs. −7,1 dB | −25,1 dB (geduckt) vs. −7,1 dB |
| Build-up (Dauer / Anstieg / größter Schritt pro 0,2 s) | 2,5 s / +9,5 dB / 2,0 dB | 2,6 s / +10,1 dB / 1,7 dB | 2,6 s / +9,9 dB / 3,0 dB (Grenzwert 3,0) |
| Sprung am Drop (vorher → nachher) | −7,2 → −7,1 dB | −7,4 → −7,1 dB | −7,2 → −7,2 dB |
| Sprache über Musik (Median) | – | Clip stumm (enthält den Song) | **10,9 dB** (Ziel ≥ 8 dB) |
| Keine doppelte Musik | – | ✅ Song im Clip erkannt → Clip-Ton 0 | ✅ kein Song im Clip, Story-Gain automatisch 1,87 (+5,4 dB) |
| Lautheit Outro / ganzes Video | −14,0 / −14,5 LUFS | −14,0 / −17,2 LUFS | −14,0 / −16,6 LUFS |
| True Peak | −6,1 dBTP | −6,8 dBTP | −3,3 dBTP |

Die Normalisierung misst nur das Outro-Fenster und wendet **einen festen Gain** an (plus Limiter) – die leisere Story bleibt leiser, die Dramaturgie wird nicht eingeebnet. Das Ganze-Video-Ergebnis ist deshalb bewusst leiser als −14 LUFS.

Der B2-Build-up liegt mit 3,0 dB größtem Schritt genau an der Grenze: Am Anfang des Build-ups spricht noch jemand (16,8–18 s), die Ducking-Absenkung wird während des Build-ups gleichmäßig aufgelöst – das ergibt den steileren Schritt. Hörbar ist das als zügiger, aber stetiger Anstieg.

### Dictionary-Timing (Pixelmessung an Einzelbildern)

| Zeit nach dem Drop | sichtbare Karten-Pixel |
|---|---|
| 0,00 s | 0 (noch unsichtbar) |
| 0,42 s (Mitte der Einblendung) | 61 077 |
| 0,55 s (voll sichtbar) | 119 523 |
| später | 119 523 |

Einblendung beginnt 0,30 s nach dem Drop und dauert 0,25 s (Werte aus `config/pipeline.json` → `text.dictionary.fadeInDelaySec` / `fadeInDurationSec`). Karte im Endzustand pixelgleich mit V3 (PSNR 99 dB): Schrift, Größe, Position, Markierung, Text und Zeilenumbrüche unverändert.

### Reproduziert auf GitHub Actions

Workflow „Render V4 (outro + full audio test)", **Lauf #3** (https://github.com/Boketta-ki-Dashboards/kindnes-ai/actions/runs/44588411823), Commit `b6e4ea6`, frische Ubuntu-Umgebung: bestanden. Artifact `kindness-v4` (70,6 MB, gültig bis 19.12.2026) mit A, B, C, QC-Bericht, Shot-Übersichten, Musik-Diagrammen und Screenshots. CI-Lauf #8 auf demselben Commit: bestanden.

| Teil | GitHub Actions | Abweichung zum lokalen Lauf |
|---|---|---|
| A Outro (23 Prüfungen) | ✅ 23/23 | keine bei Ton, Schnitt, Wiederholungen; Dictionary-Pixelzählung 62 767 / 121 077 statt 61 077 / 119 523 (Schriftglättung unter Ubuntu), Timing identisch: vorher 0, ab 0,55 s voll sichtbar |
| B Full Audio (21 Prüfungen) | ✅ 21/21 | keine: Gain-Abweichung 0,1 / 0,9 dB, Story-Start −19,2 dB, Build-up +10,1 dB, Drop −7,4 → −7,1 dB, −14 LUFS Outro |
| B2 Sprache | ⚠️ übersprungen | Wikimedia beantwortet Downloads von GitHub-Servern mit HTTP 429 – Original, 720p und 480p. B2 ist nur lokal geprüft (siehe Tabelle oben) |
| C Vergleich | ✅ | 2160×1920, V3 13,418 s / V4 13,418 s |

**Korrektur – fehlgeschlagene Läufe:**

- **Lauf #1:** `pillow` fehlte in `requirements.txt` (lokal zufällig installiert), deshalb brachen Wiederholungskontrolle und CI-Lauf #5 ab. Behoben in `014ab0c`, danach in einer frischen Python-Umgebung 8/8 Tests bestanden.
- **Lauf #2:** B2 brach mit „speech test clip unavailable: undefined" ab.
  - Ursache: Wikimedia drosselt automatisierte Downloads von Originaldateien (HTTP 429), und die Fehlermeldung ging unterwegs verloren.
  - Behoben in `b6e4ea6`: Zuerst wird das Original versucht, danach die von Wikimedia empfohlenen Standardgrößen.
  - Die Ursache steht jetzt im Log.
  - Ist der Clip trotzdem nicht erreichbar, wird B2 als sichtbare Warnung übersprungen, statt A/B/C zu verhindern.
  - Der Workflow cached den vorbereiteten Clip, sobald ein Download einmal gelingt.

### Was nicht automatisch prüfbar ist

- Ob jede Figur Thorfinn ist, beruht auf meiner Sichtung der Einzelbilder; Shot 6 (Kapuzenfigur im Wind) ist nicht eindeutig identifizierbar.
- Ob der Ton „gut klingt", ersetzt keine Messung – bitte A, B und B2 selbst anhören.
- Bei 0,00 s nach dem Drop ist das Bild hell: das ist der bestehende Übergangs-Blitz aus V3, kein Fehler.

