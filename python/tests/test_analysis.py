"""Unit tests for the Python analysis toolkit using synthetic TEST audio/video."""
import os
import subprocess
import tempfile
import unittest

import numpy as np
import soundfile as sf

from kindness_analysis.locate import locate_song
from kindness_analysis.music import analyze_song
from kindness_analysis.video import analyze_video, find_highlights

SR = 22050


def click_track(path: str, bpm: float = 120.0, seconds: float = 40.0, drop_at: float | None = None) -> None:
    """Synthetic TEST track: clicks on every beat, louder kick + noise bed after `drop_at`."""
    t = np.arange(int(seconds * SR)) / SR
    y = np.zeros_like(t)
    period = 60.0 / bpm
    rng = np.random.default_rng(1)
    for i, bt in enumerate(np.arange(0.1, seconds, period)):
        n = int(bt * SR)
        env = np.exp(-np.arange(2000) / 200.0)
        loud = 1.0 if (drop_at is not None and bt >= drop_at) else 0.4
        freq = 60.0 if i % 4 == 0 else 1000.0
        seg = loud * env * np.sin(2 * np.pi * freq * np.arange(2000) / SR)
        y[n:n + 2000] += seg[: len(y[n:n + 2000])]
    if drop_at is not None:
        y[int(drop_at * SR):] += 0.05 * rng.standard_normal(len(y) - int(drop_at * SR))
    sf.write(path, (y / np.max(np.abs(y)) * 0.8).astype(np.float32), SR)


class MusicTests(unittest.TestCase):
    def test_bpm_and_beat_grid(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "TEST_click_120.wav")
            click_track(p, 120.0, 30.0)
            bm = analyze_song(p, expected_bpm=120)
            self.assertAlmostEqual(bm["bpm"], 120.0, delta=2.0)
            ibi = np.diff(bm["beats"])
            self.assertAlmostEqual(float(np.median(ibi)), 0.5, delta=0.02)
            self.assertEqual(bm["meter"], 4)
            self.assertGreater(len(bm["downbeats"]), 10)

    def test_drop_candidate_found_at_energy_jump(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "TEST_click_drop.wav")
            click_track(p, 120.0, 40.0, drop_at=20.1)
            bm = analyze_song(p, expected_bpm=120)
            times = [c["time"] for c in bm["dropCandidates"][:3]]
            self.assertTrue(any(abs(t - 20.1) < 0.6 for t in times), times)


class LocateTests(unittest.TestCase):
    def test_finds_offset_of_song_excerpt(self):
        with tempfile.TemporaryDirectory() as d:
            song = os.path.join(d, "TEST_song.wav")
            rng = np.random.default_rng(7)
            # a melody-ish signal with changing pitches so windows are unique
            t = np.arange(int(40 * SR)) / SR
            notes = rng.integers(0, 24, size=int(40 * 2) + 1)  # random, non-repeating pitch sequence
            freqs = 220 * 2 ** (notes[(t * 2).astype(int)] / 12)
            y = 0.5 * np.sin(2 * np.pi * np.cumsum(freqs) / SR) + 0.02 * rng.standard_normal(len(t))
            sf.write(song, y.astype(np.float32), SR)
            clip = os.path.join(d, "TEST_clip.wav")
            excerpt = y[int(12.5 * SR): int(24.5 * SR)] + 0.05 * rng.standard_normal(int(12 * SR))
            sf.write(clip, excerpt.astype(np.float32), SR)
            res = locate_song(clip, song, match_threshold=0.8)
            self.assertTrue(res["segments"], res["windows"][:3])
            self.assertAlmostEqual(res["segments"][0]["offset"], 12.5, delta=0.06)


class VideoTests(unittest.TestCase):
    def test_cuts_black_and_highlight(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "TEST_cuts.mp4")
            # 1 s black, 3 s red, 3 s blue (cut at 4 s) with a loud tone in the last 2 s
            subprocess.run([
                "ffmpeg", "-nostdin", "-v", "error", "-y",
                "-f", "lavfi", "-i", "color=black:s=320x180:r=30:d=1",
                "-f", "lavfi", "-i", "color=red:s=320x180:r=30:d=3",
                "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=3",
                "-f", "lavfi", "-i", "sine=f=300:sample_rate=48000:d=5,volume=0.05",
                "-f", "lavfi", "-i", "sine=f=600:sample_rate=48000:d=2,volume=0.9",
                "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[3:a][4:a]concat=n=2:v=0:a=1[a]",
                "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", p,
            ], check=True)
            a = analyze_video(p)
            self.assertEqual(a["info"]["width"], 320)
            self.assertTrue(any(abs(c["time"] - 4.0) < 0.15 for c in a["cuts"]), a["cuts"])
            self.assertTrue(a["blackSegments"] and a["blackSegments"][0]["start"] < 0.1)
            self.assertGreaterEqual(a["highlights"][0]["time"], 4.0)

    def test_highlight_prefers_loud_reaction(self):
        motion = [0.01] * 30
        audio = {"halfSecond": [{"t": i / 2, "rmsDb": -10.0 if 40 <= i < 46 else -30.0, "onset": 0, "flatness": 0} for i in range(60)]}
        hl = find_highlights(motion, audio, [], 30.0)
        self.assertTrue(19 <= hl[0]["time"] <= 24, hl)


if __name__ == "__main__":
    unittest.main()


class SpeechAndRepetitionTests(unittest.TestCase):
    def test_speech_detection_separates_syllabic_sound_from_steady_tone(self):
        from kindness_analysis.speech import speech_segments
        with tempfile.TemporaryDirectory() as d:
            sr = 16000
            t = np.arange(int(12 * sr)) / sr
            rng = np.random.default_rng(3)
            steady = 0.05 * np.sin(2 * np.pi * 440 * t)  # music-like steady tone
            # 4–9 s: "speech-like" band noise modulated at ~4 Hz (syllable rate)
            noise = rng.standard_normal(len(t))
            from scipy.signal import butter, lfilter
            b, a = butter(4, [300 / (sr / 2), 3000 / (sr / 2)], btype="band")
            band = lfilter(b, a, noise)
            mod = (0.5 + 0.5 * np.sin(2 * np.pi * 4 * t)) ** 2
            gate = ((t > 4) & (t < 9)).astype(float)
            y = steady + 0.6 * band * mod * gate
            p = os.path.join(d, "TEST_speechlike.wav")
            sf.write(p, (y / np.max(np.abs(y)) * 0.8).astype(np.float32), sr)
            r = speech_segments(p)
            covered = sum(min(b_, 9) - max(a_, 4) for a_, b_ in r["segments"] if b_ > 4 and a_ < 9)
            outside = sum(b_ - a_ for a_, b_ in r["segments"]) - covered
            self.assertGreater(covered, 3.0, r)
            self.assertLess(outside, 1.0, r)

    def test_repetition_control_flags_identical_shots_only(self):
        from kindness_analysis.shotsim import analyse_shots
        with tempfile.TemporaryDirectory() as d:
            a = os.path.join(d, "TEST_a.mp4")
            b = os.path.join(d, "TEST_b.mp4")
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=4", "-pix_fmt", "yuv420p", a], check=True)
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "mandelbrot=s=640x360:r=30", "-t", "4", "-pix_fmt", "yuv420p", b], check=True)
            shot = lambda path, src, t0, start: {"path": path, "sourceId": src, "srcIn": t0, "srcOut": t0 + 0.8, "start": start, "duration": 0.8, "focusX": 0.5, "focusY": None, "baseZoom": 1, "tag": "x", "motif": "", "act": "", "cuts": []}
            r = analyse_shots({"framesPerShot": 3, "shots": [shot(a, "A", 1.0, 0), shot(b, "B", 1.0, 0.8), shot(a, "A", 1.0, 1.6)]})
            levels = {(p["a"], p["b"]): p["level"] for p in r["pairs"]}
            self.assertEqual(levels.get((0, 2)), "duplicate")
            self.assertNotIn((0, 1), levels)
            self.assertFalse(r["pass"])

    def test_envelope_chart_is_written(self):
        from kindness_analysis.envplot import plot_envelope
        from PIL import Image
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "TEST_env.png")
            planned = [-20.0] * 50 + [-7.0] * 30
            measured = [None] + [-20.2] * 49 + [-7.1] * 30
            r = plot_envelope({"title": "TEST", "planned": planned, "measured": measured, "windowSec": 0.2, "speech": [[2, 4]], "buildUpStart": 8, "drop": 10, "fadeOutStart": 15.5, "out": out})
            self.assertEqual(Image.open(out).size, (r["width"], r["height"]))
            self.assertAlmostEqual(r["seconds"], 16.0)
