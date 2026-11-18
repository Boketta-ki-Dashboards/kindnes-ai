# Testergebnisse

Stand: 2026-11-18 (inkl. Outro V3), Claude-Code-Cloud-Umgebung (Linux, 4 vCPU, 15 GB RAM, Node 22.23, Python 3.13, FFmpeg 7, Chromium Headless Shell 1243, Remotion 4.0.545).
Alle Angaben sind tatsächlich ausgeführte Läufe; nichts davon ist geschätzt.

## 1. Automatisierte Tests

| Suite | Befehl | Ergebnis |
|---|---|---|
| TypeScript-Typecheck | `npx tsc --noEmit` | ✅ fehlerfrei |
| TypeScript/Vitest (49 Tests, 6 Dateien) | `npm test` | ✅ 49/49 bestanden (~33 s, davon ~29 s echter Render) |
| Python/unittest (5 Tests) | `npm run test:py` | ✅ 5/5 bestanden (~5 s) |

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
| GitHub-Actions-Workflows | **implementiert, nicht ausgeführt** – laufen erst, wenn sie im Standard-Branch liegen; manueller Start durch dich. |
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
