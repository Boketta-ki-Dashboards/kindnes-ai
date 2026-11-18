"""Music engine analysis: BPM, beat grid, downbeats, sections, drop candidates.

The output ("beat map") is stored once in data/analysis/music/<track>.beatmap.json
and re-used by every edit, so the song never has to be re-analysed unless the
audio file itself changes (detected via sha256).
"""
from __future__ import annotations

import datetime as _dt
from pathlib import Path

import librosa
import numpy as np

from .mediaio import DEFAULT_SR, integrated_loudness, load_audio, sha256_file

HOP = 256
ANALYSIS_VERSION = 2


def _db(x: np.ndarray | float) -> np.ndarray | float:
    return 20.0 * np.log10(np.maximum(x, 1e-9))


def _band_envelopes(y: np.ndarray, sr: int) -> dict[str, np.ndarray]:
    spec = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    return {
        "low": spec[freqs < 150].sum(axis=0),
        "mid": spec[(freqs >= 150) & (freqs < 4000)].sum(axis=0),
        "high": spec[freqs >= 4000].sum(axis=0),
        "rms": librosa.feature.rms(y=y, frame_length=2048, hop_length=HOP)[0],
    }


def _mean_between(curve: np.ndarray, times: np.ndarray, a: float, b: float) -> float:
    mask = (times >= a) & (times < b)
    if not mask.any():
        return float("nan")
    return float(curve[mask].mean())


def estimate_downbeat_phase(beats: np.ndarray, low_env: np.ndarray, times: np.ndarray, meter: int = 4) -> int:
    """Pick the beat phase (0..meter-1) whose beats carry the most low-band (kick) energy."""
    if len(beats) < meter * 2:
        return 0
    idx = np.clip(np.searchsorted(times, beats), 0, len(low_env) - 1)
    energy = low_env[idx]
    scores = [float(energy[p::meter].mean()) for p in range(meter)]
    return int(np.argmax(scores))


def segment_sections(y: np.ndarray, sr: int, beats: np.ndarray, rms_db_beats: np.ndarray, n_sections: int = 8) -> list[dict]:
    """Coarse section boundaries via agglomerative clustering of beat-synchronous chroma+MFCC."""
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=512, n_mfcc=13)
    beat_frames = librosa.time_to_frames(beats, sr=sr, hop_length=512)
    feat = np.vstack([librosa.util.normalize(chroma, axis=0), mfcc / (np.abs(mfcc).max() + 1e-9)])
    sync = librosa.util.sync(feat, beat_frames, aggregate=np.median)
    k = max(2, min(n_sections, sync.shape[1] // 8))
    bounds = librosa.segment.agglomerative(sync, k)
    bound_times = sorted(set([0.0] + [float(beats[min(b, len(beats) - 1)]) for b in bounds if b > 0]))
    duration = len(y) / sr
    sections = []
    for i, start in enumerate(bound_times):
        end = bound_times[i + 1] if i + 1 < len(bound_times) else duration
        mask = (beats >= start) & (beats < end)
        loud = float(np.mean(rms_db_beats[mask])) if mask.any() else float("nan")
        sections.append({"index": i, "start": round(start, 3), "end": round(end, 3), "meanRmsDb": round(loud, 2)})
    # label energy relative to song median
    median = np.nanmedian([s["meanRmsDb"] for s in sections])
    for s in sections:
        delta = s["meanRmsDb"] - median
        s["energy"] = "high" if delta > 1.0 else ("low" if delta < -2.0 else "mid")
    return sections


def drop_candidates(beats: np.ndarray, downbeats: np.ndarray, times: np.ndarray, env: dict[str, np.ndarray],
                    onset_env: np.ndarray, window: float = 4.0, top_k: int = 8) -> list[dict]:
    """Rank downbeats by how much energy/onset strength rises across them.

    score = energy jump (rms dB after vs. before) + low-band jump + onset strength at the beat.
    Returns the best `top_k` candidates (with raw features so the ranking is explainable).
    """
    rms_db = _db(env["rms"])
    low_db = _db(env["low"])
    onset_norm = onset_env / (np.percentile(onset_env, 99) + 1e-9)
    duration = float(times[-1])
    out = []
    for t in downbeats:
        if t < window or t > duration - window:
            continue
        rms_jump = _mean_between(rms_db, times, t, t + window) - _mean_between(rms_db, times, t - window, t)
        low_jump = _mean_between(low_db, times, t, t + window / 2) - _mean_between(low_db, times, t - window / 2, t)
        i = int(np.clip(np.searchsorted(times, t), 0, len(onset_norm) - 1))
        onset_strength = float(onset_norm[max(0, i - 2): i + 3].max())
        score = 0.5 * rms_jump + 0.3 * low_jump + 2.0 * onset_strength
        out.append({
            "time": round(float(t), 3),
            "score": round(float(score), 3),
            "rmsJumpDb": round(float(rms_jump), 2),
            "lowJumpDb": round(float(low_jump), 2),
            "onsetStrength": round(onset_strength, 3),
        })
    out.sort(key=lambda d: d["score"], reverse=True)
    # de-duplicate candidates closer than one bar
    picked: list[dict] = []
    bar = float(np.median(np.diff(beats))) * 4 if len(beats) > 1 else 2.0
    for c in out:
        if all(abs(c["time"] - p["time"]) > bar * 0.99 for p in picked):
            picked.append(c)
        if len(picked) >= top_k:
            break
    return picked


def analyze_song(path: str | Path, sr: int = DEFAULT_SR, expected_bpm: float | None = None) -> dict:
    path = Path(path)
    y = load_audio(path, sr=sr)
    duration = len(y) / sr
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, hop_length=HOP, units="time",
                                           start_bpm=expected_bpm or 120.0)
    beats = np.asarray(beats, dtype=float)
    ibi = np.diff(beats)
    bpm = 60.0 / float(np.median(ibi)) if len(ibi) else float(np.atleast_1d(tempo)[0])
    times = librosa.frames_to_time(np.arange(len(onset_env)), sr=sr, hop_length=HOP)
    env = _band_envelopes(y, sr)
    n = min(len(times), len(env["rms"]))
    times = times[:n]
    env = {k: v[:n] for k, v in env.items()}
    onset_env = onset_env[:n]

    phase = estimate_downbeat_phase(beats, env["low"], times)
    downbeats = beats[phase::4]

    beat_idx = np.clip(np.searchsorted(times, beats), 0, n - 1)
    rms_db_beats = _db(env["rms"])[beat_idx]
    sections = segment_sections(y, sr, beats, rms_db_beats)
    candidates = drop_candidates(beats, downbeats, times, env, onset_env)

    # 0.5 s loudness curve for dashboards / debugging
    curve = []
    for s in np.arange(0.0, duration, 0.5):
        curve.append(round(float(_mean_between(_db(env["rms"]), times, s, s + 0.5)), 2))

    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=HOP, units="time")
    strong_thr = np.percentile(onset_env, 90)
    strong_onsets = [round(float(t), 3) for t in onsets
                     if onset_env[min(int(np.searchsorted(times, t)), n - 1)] >= strong_thr]

    return {
        "schema": "kindness-ai/beatmap",
        "analysisVersion": ANALYSIS_VERSION,
        "createdAt": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "source": {"path": str(path), "sha256": sha256_file(path)},
        "durationSec": round(duration, 3),
        "sampleRate": sr,
        "bpm": round(bpm, 2),
        "librosaTempoEstimate": round(float(np.atleast_1d(tempo)[0]), 2),
        "beatPeriodSec": round(60.0 / bpm, 4),
        "meter": 4,
        "downbeatPhase": phase,
        "beats": [round(float(b), 3) for b in beats],
        "downbeats": [round(float(b), 3) for b in downbeats],
        "strongOnsets": strong_onsets,
        "sections": sections,
        "dropCandidates": candidates,
        "loudness": integrated_loudness(path),
        "rmsCurveDb": {"stepSec": 0.5, "values": curve},
    }
