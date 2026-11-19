# V4 – QC

Ergebnis: **BESTANDEN** (66/66) · V4 ist **nicht** automatisch freigegeben.

| Prüfung | Ergebnis | Wert |
|---|---|---|
| [A outro] video codec H.264 | ✅ | `"h264"` |
| [A outro] audio codec AAC | ✅ | `"aac"` |
| [A outro] resolution 1080x1920 | ✅ | `"1080x1920"` |
| [A outro] frame rate | ✅ | `30` |
| [A outro] duration matches plan | ✅ | `13.418` |
| [A outro] audio/video length in sync | ✅ | `"v=13.400 a=13.418"` |
| [A outro] no black frames before the final fade | ✅ | `[]` |
| [A outro] no audio dropouts before the final fade | ✅ | `[]` |
| [A outro] outro loudness ≈ -14 LUFS (previous outro level) | ✅ | `-14` |
| [A outro] whole-video loudness (info: story is intentionally quieter) | ✅ | `-14.5` |
| [A outro] true peak below -0.5 dBTP | ✅ | `-6.1` |
| [A outro] music aligned (drop lands on the transition) | ✅ | `45.674` |
| [A outro] music gain follows the planned envelope | ✅ | `{"medianDevDb":0.1,"maxDevDb":0.9}` |
| [A outro] music plays without interruption from the start to the end | ✅ | `"0 silent windows"` |
| [A outro] single continuous song (no restart at the drop, no second track) | ✅ | `{"offsets":[45.7],"coveredSec":12}` |
| [A outro] smooth build-up before the drop (rising, no jumps) | ✅ | `{"buildUpSec":2.5,"riseDb":9.5,"maxStepDb":2,"minStepDb":0.6}` |
| [A outro] no audio jump at the drop (music already at outro level) | ✅ | `{"beforeDb":-7.2,"afterDb":-7.1}` |
| [A outro] no visible shot repetitions in the outro | ✅ | `"11 shots, all distinct"` |
| [A outro] Thorfinn on the drop | ✅ | `"teen-profile"` |
| [A outro] calm manga ending kept (silhouette, field + tree, Thorfinn) | ✅ | `["father-child-silhouette","field-rock-tree","adult-trees-final"]` |
| [A outro] every shot a different motif | ✅ | `"11/11 distinct"` |
| [A outro] definition fades in 0.30 s after the drop, fully visible after 0.55 s | ✅ | `{"fadeInAt":0.3,"fadeInDur":0.25,"pixels":{"before":0,"mid":61077,"full":119523,"late":119523}}` |
| [A outro] text design identical to V3 (pixel comparison of the card) | ✅ | `"PSNR 99 dB"` |
| [B full audio] video codec H.264 | ✅ | `"h264"` |
| [B full audio] audio codec AAC | ✅ | `"aac"` |
| [B full audio] resolution 1080x1920 | ✅ | `"1080x1920"` |
| [B full audio] frame rate | ✅ | `30` |
| [B full audio] duration matches plan | ✅ | `27.413` |
| [B full audio] audio/video length in sync | ✅ | `"v=27.400 a=27.413"` |
| [B full audio] no black frames before the final fade | ✅ | `[]` |
| [B full audio] no audio dropouts before the final fade | ✅ | `[]` |
| [B full audio] outro loudness ≈ -14 LUFS (previous outro level) | ✅ | `-14` |
| [B full audio] whole-video loudness (info: story is intentionally quieter) | ✅ | `-17.2` |
| [B full audio] true peak below -0.5 dBTP | ✅ | `-6.8` |
| [B full audio] music aligned (drop lands on the transition) | ✅ | `31.695` |
| [B full audio] music gain follows the planned envelope | ✅ | `{"medianDevDb":0.1,"maxDevDb":0.9}` |
| [B full audio] music plays without interruption from the start to the end | ✅ | `"0 silent windows"` |
| [B full audio] single continuous song (no restart at the drop, no second track) | ✅ | `{"offsets":[31.7],"coveredSec":27}` |
| [B full audio] story starts with quiet music (≥ 10 dB below the outro) | ✅ | `{"storyStartDb":-19.2,"outroDb":-7.1}` |
| [B full audio] smooth build-up before the drop (rising, no jumps) | ✅ | `{"buildUpSec":2.6,"riseDb":10.1,"maxStepDb":1.7,"minStepDb":0}` |
| [B full audio] no audio jump at the drop (music already at outro level) | ✅ | `{"beforeDb":-7.4,"afterDb":-7.1}` |
| [B full audio] speech intelligibility | ✅ | `"clip audio muted (contains the song)"` |
| [B full audio] no double music (clip containing the song is muted) | ✅ | `{"songInClip":true,"storyAudioGain":0}` |
| [B full audio] no visible shot repetitions in the outro | ✅ | `"11 shots, all distinct"` |
| [B2 speech] video codec H.264 | ✅ | `"h264"` |
| [B2 speech] audio codec AAC | ✅ | `"aac"` |
| [B2 speech] resolution 1080x1920 | ✅ | `"1080x1920"` |
| [B2 speech] frame rate | ✅ | `30` |
| [B2 speech] duration matches plan | ✅ | `28.906` |
| [B2 speech] audio/video length in sync | ✅ | `"v=28.900 a=28.906"` |
| [B2 speech] no black frames before the final fade | ✅ | `[]` |
| [B2 speech] no audio dropouts before the final fade | ✅ | `[]` |
| [B2 speech] outro loudness ≈ -14 LUFS (previous outro level) | ✅ | `-14` |
| [B2 speech] whole-video loudness (info: story is intentionally quieter) | ✅ | `-16.6` |
| [B2 speech] true peak below -0.5 dBTP | ✅ | `-3.3` |
| [B2 speech] music aligned (drop lands on the transition) | ✅ | `30.186` |
| [B2 speech] music gain follows the planned envelope | ✅ | `{"medianDevDb":0.1,"maxDevDb":1}` |
| [B2 speech] music plays without interruption from the start to the end | ✅ | `"0 silent windows"` |
| [B2 speech] single continuous song (no restart at the drop, no second track) | ✅ | `{"offsets":[30.2],"coveredSec":28}` |
| [B2 speech] story starts with quiet music (≥ 10 dB below the outro) | ✅ | `{"storyStartDb":-25.1,"outroDb":-7.1}` |
| [B2 speech] smooth build-up before the drop (rising, no jumps) | ✅ | `{"buildUpSec":2.6,"riseDb":9.9,"maxStepDb":3,"minStepDb":-0.2}` |
| [B2 speech] no audio jump at the drop (music already at outro level) | ✅ | `{"beforeDb":-7.2,"afterDb":-7.2}` |
| [B2 speech] speech clearly above the music (speech-to-music ratio) | ✅ | `{"medianSmrDb":10.9,"windows":61}` |
| [B2 speech] no double music (clip containing the song is muted) | ✅ | `{"songInClip":false,"storyAudioGain":1.866}` |
| [B2 speech] no visible shot repetitions in the outro | ✅ | `"11 shots, all distinct"` |
| [C comparison] V3 left / V4 right, same length, 2160x1920 | ✅ | `"2160x1920, V3 13.418s / V4 13.418s"` |
