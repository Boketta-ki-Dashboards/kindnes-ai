"""Music-gain chart (planned envelope vs. gain measured from the rendered music stem).

Input spec (JSON):
  {"title": str, "windowSec": 0.2, "planned": [dB...], "measured": [dB|null...],
   "speech": [[a,b],...], "buildUpStart": s, "drop": s, "fadeOutStart": s, "out": "file.png"}

Drawn with PIL only (no matplotlib dependency). One y-axis (dB), two series
(planned = blue, measured = orange), speech segments as grey bands, phase markers.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SURFACE = "#fcfcfb"
TEXT = "#0b0b0b"
TEXT2 = "#52514e"
GRID = "#e4e3df"
SPEECH = "#ecebe7"
PLANNED = "#2a78d6"
MEASURED = "#eb6834"
MARK = "#8a8984"

FONT_DIRS = ["/usr/share/fonts/opentype/inter/Inter-{w}.otf", "/usr/share/fonts/truetype/dejavu/DejaVuSans{d}.ttf"]


def _font(size: int, bold: bool = False):
    for pattern in FONT_DIRS:
        p = pattern.format(w="SemiBold" if bold else "Regular", d="-Bold" if bold else "")
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def plot_envelope(spec: dict) -> dict:
    W, H, S = 1600, 620, 2  # drawn at 2x for crisp lines, scaled down on save
    L, R, T, B = 110, 40, 92, 96
    img = Image.new("RGB", (W * S, H * S), SURFACE)
    d = ImageDraw.Draw(img)
    win = float(spec.get("windowSec", 0.2))
    planned = spec["planned"]
    measured = spec["measured"]
    total = len(planned) * win
    lo, hi = -36.0, 0.0
    x = lambda t: (L + (W - L - R) * t / total) * S
    y = lambda v: (T + (H - T - B) * (hi - max(lo, min(hi, v))) / (hi - lo)) * S
    f_lbl, f_small, f_title = _font(15 * S), _font(13 * S), _font(20 * S, True)

    # speech bands
    for a, b in spec.get("speech", []):
        d.rectangle([x(a), y(hi), x(min(b, total)), y(lo)], fill=SPEECH)
    # grid + y labels
    for v in range(int(lo), int(hi) + 1, 6):
        d.line([x(0), y(v), x(total), y(v)], fill=GRID, width=1 * S)
        d.text((x(0) - 12 * S, y(v)), f"{v} dB", fill=TEXT2, font=f_small, anchor="rm")
    # x labels
    step = 2 if total <= 30 else 5
    t = 0
    while t <= total + 1e-6:
        d.text((x(t), y(lo) + 10 * S), f"{t:g}s", fill=TEXT2, font=f_small, anchor="ma")
        t += step
    # phase markers
    marks = [(spec.get("buildUpStart"), "Build-up"), (spec.get("drop"), "Drop"), (spec.get("fadeOutStart"), "Fade-out")]
    for tm, name in marks:
        if tm is None or tm <= 0:
            continue
        for yy in range(int(y(hi)), int(y(lo)), 10 * S):  # dashed
            d.line([x(tm), yy, x(tm), min(yy + 5 * S, y(lo))], fill=MARK, width=1 * S)
        right = x(tm) > (W - R - 90) * S  # keep the label inside the plot
        d.text((x(tm) + (-6 if right else 6) * S, y(hi) + 4 * S), name, fill=TEXT2, font=f_small, anchor="ra" if right else "la")

    def polyline(vals, colour):
        seg = []
        for i, v in enumerate(vals):
            if v is None:
                if len(seg) > 1:
                    d.line(seg, fill=colour, width=2 * S, joint="curve")
                seg = []
                continue
            seg.append((x((i + 0.5) * win), y(v)))
        if len(seg) > 1:
            d.line(seg, fill=colour, width=2 * S, joint="curve")

    polyline(planned, PLANNED)
    polyline(measured, MEASURED)

    # title + legend (one row above the plot)
    d.text((L * S, 24 * S), spec.get("title", "Music gain"), fill=TEXT, font=f_title)
    lx = L * S
    ly = 60 * S
    for colour, name in [(PLANNED, "geplant (Envelope)"), (MEASURED, "gemessen (Musik-Stem ÷ Song)")]:
        d.line([lx, ly + 8 * S, lx + 26 * S, ly + 8 * S], fill=colour, width=3 * S)
        d.text((lx + 34 * S, ly), name, fill=TEXT, font=f_lbl)
        lx += (34 + d.textlength(name, font=f_lbl) / S + 28) * S
    d.rectangle([lx, ly + 2 * S, lx + 26 * S, ly + 14 * S], fill=SPEECH)
    d.text((lx + 34 * S, ly), "Sprache erkannt (Ducking)", fill=TEXT, font=f_lbl)
    d.text((L * S, (H - 34) * S), "Gain der Musik relativ zum Original-Song, 0,2-s-Fenster. Lücken = Song-Pause / Fade (nicht messbar).", fill=TEXT2, font=f_small)

    out = Path(spec["out"])
    out.parent.mkdir(parents=True, exist_ok=True)
    img.resize((W, H), Image.LANCZOS).save(out)
    return {"out": str(out), "width": W, "height": H, "seconds": round(total, 2)}


if __name__ == "__main__":  # pragma: no cover
    import sys

    print(json.dumps(plot_envelope(json.loads(Path(sys.argv[1]).read_text()))))
