"""Speech / foreground-voice activity detection for the ducking of the music.

Heuristic, dependency-free VAD:
* energy in the speech band (300–3400 Hz) per 20 ms frame, compared with an
  adaptive noise floor (15th percentile) – a frame is "loud" when it is
  ≥ 9 dB above the floor and above an absolute minimum;
* syllabic modulation: speech energy fluctuates at 2–8 Hz (syllable rate);
  sustained music or noise does much less. The modulation share in a 1 s window
  must be high enough;
* smoothing: gaps < 0.3 s are bridged, segments < 0.25 s dropped.

The result is used to duck the background music; it is deliberately tolerant
(loud, modulated foreground sounds such as laughter or cheering also count,
which is what we want for "important original sounds stay audible").
"""
from __future__ import annotations

import numpy as np

from .mediaio import load_audio

SR = 16000
HOP = 320  # 20 ms
WIN = 640


def speech_segments(path: str, min_seg: float = 0.25, bridge: float = 0.3) -> dict:
    y = load_audio(path, sr=SR)
    if len(y) < SR // 2:
        return {"segments": [], "frameSec": HOP / SR, "speechRatio": 0.0}
    n = 1 + (len(y) - WIN) // HOP
    idx = np.arange(WIN)[None, :] + HOP * np.arange(n)[:, None]
    frames = y[idx] * np.hanning(WIN)[None, :]
    spec = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    freqs = np.fft.rfftfreq(WIN, 1 / SR)
    band = spec[:, (freqs >= 300) & (freqs <= 3400)].sum(axis=1)
    total = spec.sum(axis=1) + 1e-12
    band_db = 10 * np.log10(band + 1e-12)
    floor = np.percentile(band_db, 15)
    loud = (band_db > floor + 9) & (band_db > 10 * np.log10(1e-5 * WIN)) & (band / total > 0.35)

    # syllabic modulation of the band energy envelope (frame rate 50 Hz)
    env = band_db - np.convolve(band_db, np.ones(50) / 50, mode="same")
    fps = SR / HOP
    mod = np.zeros(n)
    w = int(fps)  # 1 s window
    for i in range(0, n, 5):
        seg = env[max(0, i - w // 2): i + w // 2]
        if len(seg) < w // 2:
            continue
        p = np.abs(np.fft.rfft(seg - seg.mean())) ** 2
        f = np.fft.rfftfreq(len(seg), 1 / fps)
        share = p[(f >= 2) & (f <= 8)].sum() / (p[f > 0.5].sum() + 1e-9)
        mod[i: i + 5] = share
    active = loud & (mod > 0.3)

    # frames -> segments with bridging and minimum length
    segs: list[list[float]] = []
    for i, a in enumerate(active):
        if not a:
            continue
        t = i * HOP / SR
        if segs and t - segs[-1][1] <= bridge:
            segs[-1][1] = t + HOP / SR
        else:
            segs.append([t, t + HOP / SR])
    segs = [[round(a, 2), round(b, 2)] for a, b in segs if b - a >= min_seg]
    dur = len(y) / SR
    return {
        "segments": segs,
        "frameSec": HOP / SR,
        "speechRatio": round(sum(b - a for a, b in segs) / max(dur, 1e-6), 3),
        "method": "band-energy + syllabic-modulation heuristic",
    }
