# Asset-Inventar

Stand: 2026-11-18 · erstellt bei der Bestandsaufnahme (Phase 1) · alle Werte gemessen mit `ffprobe` bzw. der Python-Analyse (`python/kindness_analysis`).

## Speicherung / Git LFS

- Das Repository nutzt **kein Git LFS** (`.gitattributes` fehlt, `git lfs ls-files` ist leer). Alle Medien liegen als normale Git-Blobs vor; die echten Binärdaten waren in der Cloud-Umgebung vollständig abrufbar und analysierbar.
- Größte Datei: 23,1 MB (Limit von GitHub: 100 MB pro Datei). Gesamtgröße der Medien: ~125 MB.
- Umbenennungen wurden mit `git mv` durchgeführt → gleiche Blobs, **kein zusätzlicher Speicher**.
- Gerenderte Videos, Proxys und Downloads liegen in `output/`, `.cache/` und `media/` und sind per `.gitignore` vom Repository ausgeschlossen.

## Entfernte Platzhalter (eindeutig leer)

Alle 8 Dateien hatten exakt 1 Byte (nur ein Zeilenumbruch) und dienten nur dazu, über die GitHub-Weboberfläche Ordner anzulegen:

| Gelöschte Datei | Größe | Inhalt |
|---|---|---|
| `assets/test1` | 1 B | `\n` |
| `assets/music/test1` | 1 B | `\n` |
| `assets/outro/test1` | 1 B | `\n` |
| `references/test1` | 1 B | `\n` |
| `references/raw-examples/test1` | 1 B | `\n` (ersetzt durch `.gitkeep`) |
| `references/tiktok-edits/test` | 1 B | `\n` |
| `src/12` | 1 B | `\n` |
| `output/13` | 1 B | `\n` (ersetzt durch `.gitkeep`) |

Es wurde **keine** echte Video- oder Musikdatei gelöscht.

## Musik

| Neuer Pfad | Ursprünglicher Name | Größe | Format | Laufzeit | Analyse |
|---|---|---|---|---|---|
| `assets/music/meant-to-be.mp3` | `Cuntsniffer - Meant To Be (Lyrics).mp3` | 6,42 MB | MP3, 320 kbit/s, 44,1 kHz, Stereo | 160,5 s | **139,7 BPM** (4/4), 364 Beats, 91 Taktanfänge; −6,2 LUFS integriert, True Peak +1,9 dBTP (sehr laut gemastert, leicht übersteuert) |

Struktur (automatische Segmentierung, siehe `data/analysis/music/meant-to-be.beatmap.json`):

| Abschnitt | Zeit | Energie |
|---|---|---|
| Intro/Strophe | 0,0 – 14,4 s | hoch |
| Breakdown | 14,4 – 21,2 s | niedrig |
| Aufbau | 21,2 – 62,4 s | mittel – **hier liegt der Drop 48,216 s** |
| Refrain | 62,4 – 89,8 s | hoch |
| Breakdown | 89,8 – 103,5 s | niedrig |
| Aufbau | 103,5 – 129,2 s | mittel |
| Finale | 129,2 – 160,5 s | hoch |

## Outro-Material (`assets/outro/`)

### `sources/` – Rohmaterial (für eigene Outro-Varianten genutzt)

| Neuer Pfad | Ursprünglicher Name | Größe | Video | Laufzeit | Inhalt (gesichtet) | Nutzbarer Bereich |
|---|---|---|---|---|---|---|
| `sources/vs-manga_i-have-no-enemies.mp4` | `Thorfinn - I have no enemies _ Manga animation .mp4` | 15,3 MB | H.264 1280×720, 30 fps | 59,1 s | Animierte Manga-Panels „I have no enemies", warm/golden, 27 harte Schnitte (Median 1,3 s), CapCut-Endkarte ab 56,5 s | 0,4 – 56,4 s |
| `sources/vs-manga_heart-to-heart.mp4` | `Thorfinn, Vinland Saga [Heart To Heart] ║ Manga Animation.mp4` | 5,5 MB | H.264 1280×720, 24 fps | 26,7 s | Thorfinn in goldenem Feld, sehr warm, lange Einstellungen; Creator-Logo 0,9 – 3,5 s, Schwarz ab 23,8 s | 3,9 – 23,7 s |

Beide Dateien sind das **hochwertigste Ausgangsmaterial** (720p, H.264, saubere Panels).

### `edits/` – fertige Fremd-Edits (Stilreferenz, standardmäßig nicht verwendet)

| Neuer Pfad | Ursprünglicher Name | Größe | Video | Laufzeit | Inhalt | Song-Sync |
|---|---|---|---|---|---|---|
| `edits/edit-a_i-have-no-enemies-dialogue_v15044gf.mov` | `v15044gf0000d2664ffog65hq9o78o0g.mov` | 19,0 MB | HEVC 844×576, 30 fps | 35,3 s | Dialog-Untertitel („you don't have enemies …") über verzerrten goldenen Shots, ~1 s Shots; Texttafeln + TikTok-Endkarte ab 24 s | eigener Ton, **nicht** „Meant to Be" |
| `edits/edit-b_thorfinn-golden-montage_db0cl8no.mov` | `v1c044g50000db0cl8nog65kaujfageg.mov` | 18,3 MB | HEVC 762×576, 30 fps | 31,8 s | Thorfinn-Montage golden/blau/Wald, ~2,5 s Shots; Schwarz + TikTok-Endkarte ab 23,6 s | eigener Ton |
| `edits/edit-c_kindness-definition_dbl28pno.mov` | `v1c044g50000dbl28pnog65mi6ppnc90.mov` | 7,8 MB | HEVC 574×450, 30 fps | 13,9 s | „kindness"-Wörterbuch-Overlay über goldenen Shots; TikTok-Endkarte ab 9,8 s. Identisch mit dem Outro-Teil von `ref-04` (gleiche TikTok-ID) | **bereits synchron**: beginnt bei Song-Zeit 48,16 s |

> Hinweis: Die Fremd-Edits enthalten Creator-Arbeit und TikTok-Wasserzeichen/Endkarten. Variante D nutzt `edit-c` direkt und ist deshalb als „nur mit Erlaubnis" markiert. Die Varianten A–C sind eigene, editierbare Vorlagen aus dem Rohmaterial.

## TikTok-Referenzen (`references/tiktok-edits/`)

| Neuer Pfad | Ursprünglicher Name | Größe | Video | Laufzeit | Inhalt |
|---|---|---|---|---|---|
| `ref-01_feed-screenrecording-multi-story.mp4` | `Video_1_komprimiert_unter_25MB.mp4` | 22,8 MB | H.264 720×1566, 20 fps | 170,2 s | Bildschirmaufnahme des TikTok-Feeds mit mehreren Kindness-Edits (Regenschirm/Straßenszene, Fensterputzer, Judo-Fairplay, ältere Dame mit Riesen-Teddy …) inkl. App-Oberfläche |
| `ref-02_street-vendor-tears.mp4` | `Video_2_komprimiert_unter_25MB.mp4` | 23,1 MB | H.264 900×1956, 30 fps | 44,6 s | Bildschirmaufnahme: Straßenverkäufer wird beschenkt und weint; Schnitt aufs Anime-Outro; endet mit iOS-Kontrollzentrum |
| `ref-03_football-rivals-old-friends_dbim1vvo.mp4` | `v1c044g50000dbim1vvog65u1mohaj70.mp4` | 4,5 MB | H.264 576×576, 30 fps | 61,3 s | Gealterte Fußball-Rivalen als Freunde auf einer Parkbank (vermutlich KI-generiert), englische Untertitel; Outro mit Schnitt auf jeden Beat |
| `ref-04_dog-guides-blind-cat_dbl28pno.mp4` | `v1c044g50000dbl28pnog65mi6ppnc90.mp4` | 2,7 MB | H.264 576×1024, 30 fps | 34,1 s | Hund führt blinde Katze; Überblendung ins „kindness"-Definition-Outro |

Die vollständige Schnitt-/Timing-Analyse steht in [VIDEO_STYLE_GUIDE.md](VIDEO_STYLE_GUIDE.md).

## `references/raw-examples/`

Leer (nur `.gitkeep`). Vorgesehen für unbearbeitete Kindness-Clips. Dateien hier können mit
`npm run kai -- import references/raw-examples/<datei>.mp4` als Kandidat übernommen werden und sind
auch für den GitHub-Actions-Render-Workflow erreichbar.

## Analyse-Dateien

| Pfad | Inhalt |
|---|---|
| `data/analysis/music/meant-to-be.beatmap.json` | Beat-Map: BPM, alle Beats/Downbeats, Abschnitte, Drop-Kandidaten, Lautheit |
| `data/analysis/references/*.video.json` | Schnitte, Shots, Schwarzbilder, Bewegung, Farbe, Audio pro Referenz |
| `data/analysis/references/*.songmatch.json` | Wo „Meant to Be" in der Referenz läuft (Audio-Fingerprint) |
| `data/analysis/outro/*.video.json` | Dasselbe für das Outro-Material inkl. 9:16-Zuschnitt-Eignung |
| `data/analysis/reference-summary.json` | Abgeleitete Struktur aller Referenzen (Drop, Story-/Outro-Länge, Schnittrhythmus) |

## Typografie-Referenzen (`references/typography/`) – neu für Outro V3

| Datei | Größe | Inhalt |
|---|---|---|
| `dictionary-ref-1_closeup.webp` | 910×700 | Nahaufnahme der Wörterbuch-Karte (vermessen: Kreis 75 px #ACC7F5, Markierung #203D95, Balkenhöhe 37 px, Zeilenraster 53 px) |
| `dictionary-ref-2_layout.webp` | 964×952 | Gesamtlayout mit Thorfinn; verbindliche Zeilenumbrüche (9 Zeilen) |

Beide Screenshots stammen von dir (Chat-Upload) und dienen nur als Designvorlage; Bedienelemente (Pfeile, „YouTube +3") werden nicht übernommen.

## Schriften (`assets/fonts/`)

| Datei | Größe | Lizenz | Verwendung |
|---|---|---|---|
| `google-sans/GoogleSans-latin.woff2` | 83 KB | SIL Open Font License 1.1 (`google-sans/OFL.txt`) | Wörterbuch-Karte: Titel, Fließtext, Markierung. Untermenge (Latin) der variablen Schrift aus github.com/google/fonts (Achsen wght 400–700, GRAD, opsz) |
| `noto-sans/NotoSans-ipa.woff2` | 99 KB | SIL Open Font License 1.1 (`noto-sans/OFL.txt`) | nur die Lautschrift-Zeichen ʌ/ɪ (fehlen in Google Sans) |
