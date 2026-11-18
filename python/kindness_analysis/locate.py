"""Find where (and whether) a known song plays inside another media file.

Used to measure *which part* of "Meant to Be" the TikTok reference edits use and
at which song-time they cut to the anime outro. Works with a combined
chroma + log-mel fingerprint and cosine similarity over sliding windows.
"""
from __future__ import annotations

from pathlib import Path

import librosa
import numpy as np

from .mediaio import DEFAULT_SR, load_audio

HOP = 512


def fingerprint(y: np.ndarray, sr: int = DEFAULT_SR) -> np.ndarray:
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP)
    mel = librosa.power_to_db(librosa.feature.melspectrogram(y=y, sr=sr, hop_length=HOP, n_mels=64))
    mel = (mel - mel.mean(axis=1, keepdims=True)) / 20.0
    n = min(chroma.shape[1], mel.shape[1])
    return np.vstack([chroma[:, :n] * 3.0, mel[:, :n]]).astype(np.float32)


def _norm(w: np.ndarray) -> np.ndarray:
    w = w - w.mean(axis=1, keepdims=True)
    return w / (np.linalg.norm(w) + 1e-9)


def _best_offset(window: np.ndarray, song: np.ndarray, coarse: int = 4) -> tuple[float, int]:
    W = window.shape[1]
    wn = _norm(window)
    best = (-1.0, 0)
    for o in range(0, song.shape[1] - W, coarse):
        s = float(np.sum(wn * _norm(song[:, o:o + W])))
        if s > best[0]:
            best = (s, o)
    o0 = best[1]
    for o in range(max(0, o0 - coarse), min(song.shape[1] - W, o0 + coarse + 1)):
        s = float(np.sum(wn * _norm(song[:, o:o + W])))
        if s > best[0]:
            best = (s, o)
    return best


def locate_song(media: str | Path, song: str | Path, window_sec: float = 3.0, step_sec: float = 1.0,
                match_threshold: float = 0.85, sr: int = DEFAULT_SR) -> dict:
    """Return per-window matches plus merged continuous segments.

    A segment means: media time [mediaStart, mediaEnd] plays song time
    [songStart, songEnd] (offset = songTime - mediaTime is constant).
    """
    fps = sr / HOP
    song_fp = fingerprint(load_audio(song, sr=sr), sr)
    y = load_audio(media, sr=sr)
    if len(y) < sr * window_sec:
        return {"windows": [], "segments": [], "note": "media shorter than analysis window"}
    media_fp = fingerprint(y, sr)
    W, step = int(window_sec * fps), int(step_sec * fps)
    windows = []
    for s in range(0, media_fp.shape[1] - W, step):
        sim, off = _best_offset(media_fp[:, s:s + W], song_fp)
        windows.append({"mediaTime": round(s / fps, 3), "songTime": round(off / fps, 3),
                        "offset": round((off - s) / fps, 3), "similarity": round(sim, 3)})
    segments: list[dict] = []
    for w in windows:
        if w["similarity"] < match_threshold:
            continue
        last = segments[-1] if segments else None
        if last and abs(w["offset"] - last["offset"]) < 0.15 and w["mediaTime"] - last["mediaEnd"] <= step_sec + 1e-6:
            last["mediaEnd"] = w["mediaTime"]
            last["n"] += 1
            last["simSum"] += w["similarity"]
        else:
            segments.append({"mediaStart": w["mediaTime"], "mediaEnd": w["mediaTime"], "offset": w["offset"],
                             "n": 1, "simSum": w["similarity"]})
    out_segments = []
    for seg in segments:
        if seg["n"] < 2:
            continue
        refined = refine_offset(media_fp, song_fp, seg["mediaStart"], seg["offset"], fps, W)
        media_end = seg["mediaEnd"] + window_sec
        out_segments.append({
            "mediaStart": seg["mediaStart"], "mediaEnd": round(media_end, 3),
            "songStart": round(seg["mediaStart"] + refined, 3), "songEnd": round(media_end + refined, 3),
            "offset": round(refined, 3), "meanSimilarity": round(seg["simSum"] / seg["n"], 3),
        })
    return {"windowSec": window_sec, "stepSec": step_sec, "threshold": match_threshold,
            "windows": windows, "segments": out_segments}


def refine_offset(media_fp: np.ndarray, song_fp: np.ndarray, media_start: float, offset: float, fps: float,
                  W: int) -> float:
    """Frame-accurate offset (+/- 0.25 s search) around the coarse estimate."""
    s = int(media_start * fps)
    win = _norm(media_fp[:, s:s + W])
    base = int(round((media_start + offset) * fps))
    best = (-1.0, base)
    for o in range(max(0, base - int(0.25 * fps)), min(song_fp.shape[1] - W, base + int(0.25 * fps)) + 1):
        sim = float(np.sum(win * _norm(song_fp[:, o:o + W])))
        if sim > best[0]:
            best = (sim, o)
    return best[1] / fps - media_start
