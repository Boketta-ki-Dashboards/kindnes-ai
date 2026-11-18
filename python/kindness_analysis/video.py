"""Video content analysis: cuts, black frames, motion, colour, framing focus, highlights.

Everything is computed from decoded frames (downscaled for speed) and decoded
audio. Nothing here guesses from titles or metadata.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import librosa
import numpy as np

from .mediaio import DEFAULT_SR, has_audio, load_audio, probe

ANALYSIS_FPS = 10.0
ANALYSIS_WIDTH = 160


def video_stream_info(path: str | Path) -> dict:
    info = probe(path)
    v = next((s for s in info["streams"] if s.get("codec_type") == "video"), None)
    if v is None:
        raise ValueError(f"no video stream in {path}")
    num, den = (v.get("avg_frame_rate") or v.get("r_frame_rate") or "30/1").split("/")
    fps = float(num) / float(den) if float(den) else 30.0
    rotation = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rotation = int(sd["rotation"])
    w, h = int(v["width"]), int(v["height"])
    if abs(rotation) in (90, 270):
        w, h = h, w
    return {
        "width": w, "height": h, "fps": round(fps, 3), "codec": v.get("codec_name"),
        "durationSec": round(float(info["format"].get("duration", v.get("duration", 0.0))), 3),
        "rotation": rotation, "pixFmt": v.get("pix_fmt"),
        "bitRate": int(info["format"].get("bit_rate", 0) or 0),
    }


def decode_frames(path: str | Path, fps: float = ANALYSIS_FPS, width: int = ANALYSIS_WIDTH) -> tuple[np.ndarray, float]:
    """Decode downscaled RGB frames at a fixed rate. Returns (frames[N,H,W,3], fps)."""
    info = video_stream_info(path)
    height = int(round(info["height"] * width / info["width"] / 2) * 2)
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-an",
           "-vf", f"fps={fps},scale={width}:{height}:flags=area", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    frame_size = width * height * 3
    n = len(raw) // frame_size
    frames = np.frombuffer(raw[: n * frame_size], dtype=np.uint8).reshape(n, height, width, 3)
    return frames, fps


def scene_cuts(path: str | Path, threshold: float = 0.3, min_gap: float = 0.2) -> list[dict]:
    """Hard cuts using ffmpeg's scene score (on a downscaled stream)."""
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-an", "-vf",
           f"scale={ANALYSIS_WIDTH * 2}:-2,select='gte(scene,0)',metadata=print:file=-", "-f", "null", "-"]
    text = subprocess.run(cmd, capture_output=True, check=True).stdout.decode(errors="ignore")
    cuts: list[dict] = []
    pts = None
    for line in text.splitlines():
        m = re.search(r"pts_time:([0-9.]+)", line)
        if m:
            pts = float(m.group(1))
            continue
        m = re.search(r"lavfi\.scene_score=([0-9.]+)", line)
        if m and pts is not None:
            score = float(m.group(1))
            if score >= threshold and (not cuts or pts - cuts[-1]["time"] >= min_gap):
                cuts.append({"time": round(pts, 3), "score": round(score, 3)})
    return cuts


def black_segments(path: str | Path, min_duration: float = 0.25, pic_th: float = 0.92) -> list[dict]:
    cmd = ["ffmpeg", "-nostdin", "-v", "info", "-i", str(path), "-an", "-vf",
           f"blackdetect=d={min_duration}:pic_th={pic_th}", "-f", "null", "-"]
    text = subprocess.run(cmd, capture_output=True).stderr.decode(errors="ignore")
    out = []
    for m in re.finditer(r"black_start:([0-9.]+) black_end:([0-9.]+)", text):
        out.append({"start": round(float(m.group(1)), 3), "end": round(float(m.group(2)), 3)})
    return out


def _per_second(values: np.ndarray, fps: float, duration: float) -> list[float]:
    out = []
    for s in range(int(np.ceil(duration))):
        seg = values[int(s * fps): int((s + 1) * fps)]
        out.append(round(float(seg.mean()), 4) if len(seg) else 0.0)
    return out


def frame_features(frames: np.ndarray, fps: float) -> dict:
    f = frames.astype(np.float32) / 255.0
    gray = f.mean(axis=3)
    motion = np.zeros(len(gray), dtype=np.float32)
    if len(gray) > 1:
        motion[1:] = np.abs(np.diff(gray, axis=0)).mean(axis=(1, 2))
    brightness = gray.mean(axis=(1, 2))
    mx, mn = f.max(axis=3), f.min(axis=3)
    saturation = ((mx - mn) / (mx + 1e-6)).mean(axis=(1, 2))
    warmth = (f[..., 0] - f[..., 2]).mean(axis=(1, 2))  # >0 = warm/golden, <0 = cool/blue
    # horizontal focus: centre of mass of gradient energy (edges + detail) per frame
    gx = np.abs(np.diff(gray, axis=2)).mean(axis=1)  # [N, W-1]
    col = gx / (gx.sum(axis=1, keepdims=True) + 1e-9)
    xs = np.linspace(0, 1, col.shape[1])
    focus_x = (col * xs).sum(axis=1)
    sharp = np.abs(np.diff(gray, axis=2)).mean(axis=(1, 2)) + np.abs(np.diff(gray, axis=1)).mean(axis=(1, 2))
    # 9:16 crop suitability: share of detail energy inside the best vertical window, and its centre
    n_frames, h, w = gray.shape
    win = int(round(min(w - 1, h * 9 / 16)))
    crop_fit = np.ones(n_frames, dtype=np.float32)
    crop_x = focus_x.copy()
    if win < w - 1:
        cs = np.cumsum(np.pad(gx, ((0, 0), (1, 0))), axis=1)
        sums = cs[:, win:] - cs[:, :-win]
        best = sums.argmax(axis=1)
        total = gx.sum(axis=1) + 1e-9
        crop_fit = sums[np.arange(n_frames), best] / total
        crop_x = (best + win / 2) / (w - 1)
    return {"motion": motion, "brightness": brightness, "saturation": saturation, "warmth": warmth,
            "focusX": crop_x, "sharpness": sharp, "cropFit": crop_fit, "detailFocusX": focus_x}


def audio_features(path: str | Path, duration: float, sr: int = DEFAULT_SR) -> dict | None:
    if not has_audio(path):
        return None
    y = load_audio(path, sr=sr)
    if len(y) == 0:
        return None
    hop = 512
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    flatness = librosa.feature.spectral_flatness(y=y, hop_length=hop)[0]
    t = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    per_half = []
    for s in np.arange(0.0, duration, 0.5):
        m = (t >= s) & (t < s + 0.5)
        if not m.any():
            per_half.append({"t": round(float(s), 2), "rmsDb": -90.0, "onset": 0.0, "flatness": 0.0})
            continue
        per_half.append({
            "t": round(float(s), 2),
            "rmsDb": round(float(20 * np.log10(rms[m].mean() + 1e-9)), 2),
            "onset": round(float(onset[m[: len(onset)]].mean()) if len(onset) else 0.0, 3),
            "flatness": round(float(flatness[m[: len(flatness)]].mean()), 4),
        })
    return {"halfSecond": per_half, "meanRmsDb": round(float(20 * np.log10(rms.mean() + 1e-9)), 2)}


def find_highlights(motion_ps: list[float], audio: dict | None, cuts: list[dict], duration: float,
                    top_k: int = 3) -> list[dict]:
    """Heuristic emotional-peak detector.

    Kindness clips usually peak where the *reaction* happens: audio gets louder
    (cheering, applause, crying, laughter), motion changes (hugs, jumps) and the
    moment sits in the second half of the story. Each second is scored from those
    signals; the breakdown is returned so the choice is explainable and can be
    overridden manually.
    """
    n = max(1, int(np.ceil(duration)))
    motion = np.array((motion_ps + [0.0] * n)[:n], dtype=float)
    motion_z = (motion - motion.mean()) / (motion.std() + 1e-9)
    loud = np.zeros(n)
    rise = np.zeros(n)
    if audio:
        db = np.array([h["rmsDb"] for h in audio["halfSecond"]], dtype=float)
        per_s = np.array([db[2 * i: 2 * i + 2].mean() if len(db[2 * i: 2 * i + 2]) else -90 for i in range(n)])
        loud = (per_s - np.median(per_s)) / (per_s.std() + 1e-9)
        prev = np.array([per_s[max(0, i - 3): i].mean() if i > 0 else per_s[0] for i in range(n)])
        rise = (per_s - prev) / (per_s.std() + 1e-9)
    cut_density = np.zeros(n)
    for c in cuts:
        i = int(c["time"])
        if i < n:
            cut_density[i] += 1
    pos = np.arange(n) / max(1, n - 1)
    position_prior = np.exp(-((pos - 0.7) ** 2) / (2 * 0.2 ** 2))  # favour ~70 % into the clip
    score = 0.35 * loud + 0.25 * rise + 0.2 * motion_z + 0.05 * cut_density + 1.0 * position_prior
    # never pick the very first/last second
    if n > 4:
        score[:1] -= 5
        score[-1:] -= 5
    order = np.argsort(score)[::-1]
    picked: list[int] = []
    for i in order:
        if all(abs(i - p) >= 3 for p in picked):
            picked.append(int(i))
        if len(picked) >= top_k:
            break
    return [{
        "time": float(i) + 0.5,
        "score": round(float(score[i]), 3),
        "features": {"loudnessZ": round(float(loud[i]), 2), "loudnessRiseZ": round(float(rise[i]), 2),
                     "motionZ": round(float(motion_z[i]), 2), "cuts": int(cut_density[i]),
                     "positionPrior": round(float(position_prior[i]), 2)},
    } for i in picked]


def analyze_video(path: str | Path, with_audio: bool = True, highlight: bool = True) -> dict:
    path = Path(path)
    info = video_stream_info(path)
    frames, fps = decode_frames(path)
    feats = frame_features(frames, fps)
    duration = info["durationSec"]
    cuts = scene_cuts(path)
    blacks = black_segments(path)
    audio = audio_features(path, duration) if with_audio else None
    motion_ps = _per_second(feats["motion"], fps, duration)
    shots = []
    bounds = [0.0] + [c["time"] for c in cuts] + [duration]
    for a, b in zip(bounds[:-1], bounds[1:]):
        if b - a < 0.05:
            continue
        sl = slice(int(a * fps), max(int(a * fps) + 1, int(b * fps)))
        shots.append({
            "start": round(a, 3), "end": round(b, 3), "duration": round(b - a, 3),
            "meanMotion": round(float(feats["motion"][sl].mean()), 4) if len(feats["motion"][sl]) else 0.0,
            "meanBrightness": round(float(feats["brightness"][sl].mean()), 3) if len(feats["brightness"][sl]) else 0.0,
            "focusX": round(float(np.median(feats["focusX"][sl])), 3) if len(feats["focusX"][sl]) else 0.5,
            "warmth": round(float(feats["warmth"][sl].mean()), 3) if len(feats["warmth"][sl]) else 0.0,
            "cropFit": round(float(np.median(feats["cropFit"][sl])), 3) if len(feats["cropFit"][sl]) else 1.0,
        })
    shot_durs = [s["duration"] for s in shots] or [duration]
    result = {
        "schema": "kindness-ai/video-analysis",
        "path": str(path),
        "info": info,
        "cuts": cuts,
        "cutsPerMinute": round(len(cuts) / max(duration, 1e-3) * 60, 1),
        "medianShotSec": round(float(np.median(shot_durs)), 3),
        "shots": shots,
        "blackSegments": blacks,
        "perSecond": {
            "motion": motion_ps,
            "brightness": _per_second(feats["brightness"], fps, duration),
            "saturation": _per_second(feats["saturation"], fps, duration),
            "warmth": _per_second(feats["warmth"], fps, duration),
            "focusX": _per_second(feats["focusX"], fps, duration),
            "sharpness": _per_second(feats["sharpness"], fps, duration),
            "cropFit": _per_second(feats["cropFit"], fps, duration),
        },
        "color": {
            "meanBrightness": round(float(feats["brightness"].mean()), 3),
            "meanSaturation": round(float(feats["saturation"].mean()), 3),
            "meanWarmth": round(float(feats["warmth"].mean()), 3),
        },
        "audio": audio,
    }
    if highlight:
        result["highlights"] = find_highlights(motion_ps, audio, cuts, duration)
    return result
