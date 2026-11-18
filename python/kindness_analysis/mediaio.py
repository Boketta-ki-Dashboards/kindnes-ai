"""Thin ffmpeg/ffprobe wrappers used by every analysis module."""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np

DEFAULT_SR = 22050


class MediaError(RuntimeError):
    pass


def sha256_file(path: str | Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            b = fh.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def probe(path: str | Path) -> dict:
    """Return ffprobe JSON (format + streams)."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, check=True,
        ).stdout
    except subprocess.CalledProcessError as exc:  # pragma: no cover - depends on file
        raise MediaError(f"ffprobe failed for {path}: {exc.stderr.decode(errors='ignore')[:300]}") from exc
    return json.loads(out)


def has_audio(path: str | Path) -> bool:
    return any(s.get("codec_type") == "audio" for s in probe(path).get("streams", []))


def load_audio(path: str | Path, sr: int = DEFAULT_SR, start: float | None = None,
               duration: float | None = None) -> np.ndarray:
    """Decode any media file to mono float32 PCM via ffmpeg."""
    cmd = ["ffmpeg", "-nostdin", "-v", "error"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(path)]
    if duration is not None:
        cmd += ["-t", f"{duration:.3f}"]
    cmd += ["-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]
    try:
        raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    except subprocess.CalledProcessError as exc:
        raise MediaError(f"audio decode failed for {path}: {exc.stderr.decode(errors='ignore')[:300]}") from exc
    return np.frombuffer(raw, dtype=np.float32).copy()


def integrated_loudness(path: str | Path) -> dict:
    """EBU R128 integrated loudness / true peak via ffmpeg's ebur128 filter."""
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "info", "-i", str(path), "-vn", "-af", "ebur128=peak=true:framelog=quiet",
         "-f", "null", "-"], capture_output=True)
    text = proc.stderr.decode(errors="ignore")
    summary = text[text.rfind("Summary:"):] if "Summary:" in text else text

    def grab(label: str) -> float | None:
        for line in summary.splitlines():
            line = line.strip()
            if line.startswith(label):
                try:
                    return float(line.split(":")[1].split()[0])
                except (ValueError, IndexError):
                    return None
        return None

    return {"integratedLufs": grab("I:"), "loudnessRangeLu": grab("LRA:"), "truePeakDbfs": grab("Peak:")}
