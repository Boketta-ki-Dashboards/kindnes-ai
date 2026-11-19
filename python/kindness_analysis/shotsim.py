"""Visual repetition control for outro shot lists.

Every shot is sampled at several frames, cropped exactly like the 9:16 render
(cover framing, focusX, baseZoom, vertical lift) and compared with every other
shot on five criteria:

1. origin  – same source file and same continuous take (no hard cut in between)
2. pHash   – 64-bit DCT perceptual hash, minimum Hamming distance over frame pairs
3. SSIM    – structural similarity on 90x160 greyscale crops, best frame pair
4. layout  – composition descriptor (3x4 grid of brightness + edge energy) and the
             curated face position (focusX/focusY)
5. timing  – distance between the two shots in the edit (shots and seconds)

Pairs are classified as ``duplicate`` (visually the same picture) or ``similar``
(same motif / same take / same composition). Rules: no duplicates at all, no similar
shots closer than ``min_gap`` shots, no group of three or more similar shots.
A contact overview (PNG) shows every shot with its sampled frames and flags.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.fft import dctn
from scipy.ndimage import gaussian_filter, sobel

THUMB_W, THUMB_H = 90, 160


def _decode_frame(path: str, t: float) -> np.ndarray:
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
         "-of", "json", path], capture_output=True, check=True).stdout)
    w, h = probe["streams"][0]["width"], probe["streams"][0]["height"]
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw[: w * h * 3], dtype=np.uint8).reshape(h, w, 3)


def crop_like_render(img: np.ndarray, focus_x: float, focus_y: float | None, base_zoom: float,
                     out_w: int = 1080, out_h: int = 1920) -> np.ndarray:
    """Emulate the Remotion 'cover' framing (object-position focusX, zoom, vertical lift)."""
    h, w = img.shape[:2]
    scale = out_h / h if w / h > out_w / out_h else out_w / w
    sw, sh = w * scale, h * scale
    # visible window in source pixels before zoom
    vis_w, vis_h = out_w / scale, out_h / scale
    x0 = (sw - out_w) * min(1.0, max(0.0, focus_x)) / scale
    y0 = (sh - out_h) * 0.5 / scale
    # zoom about the centre of the visible window, lift towards 0.42 (same rule as FramedVideo)
    z = max(1.0, base_zoom)
    cw, ch = vis_w / z, vis_h / z
    cx, cy = x0 + vis_w / 2, y0 + vis_h / 2
    if focus_y is not None and z > 1:
        # FramedVideo: translateY(ty) scale(z) → visible window centre at 0.5 - ty / z (element units)
        after = 0.5 + (focus_y - 0.5) * z
        max_shift = (z - 1) / 2
        ty = max(-max_shift, min(max_shift, 0.42 - after))
        cy = y0 + vis_h * (0.5 - ty / z)
        cy = min(max(cy, ch / 2), h - ch / 2)
    xa, ya = int(round(cx - cw / 2)), int(round(cy - ch / 2))
    xa = max(0, min(w - int(cw), xa))
    ya = max(0, min(h - int(ch), ya))
    return img[ya: ya + int(ch), xa: xa + int(cw)]


def _resize_gray(img: np.ndarray, w: int, h: int) -> np.ndarray:
    from PIL import Image
    g = Image.fromarray(img).convert("L").resize((w, h), Image.BILINEAR)
    return np.asarray(g, dtype=np.float32) / 255.0


def phash(gray: np.ndarray) -> np.ndarray:
    from PIL import Image
    small = np.asarray(Image.fromarray((gray * 255).astype(np.uint8)).resize((32, 32), Image.BILINEAR), dtype=np.float32)
    d = dctn(small, norm="ortho")[:8, :8].flatten()
    return d[1:] > np.median(d[1:])  # 63 bits (skip DC)


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    mu_a, mu_b = gaussian_filter(a, 1.5), gaussian_filter(b, 1.5)
    va = gaussian_filter(a * a, 1.5) - mu_a ** 2
    vb = gaussian_filter(b * b, 1.5) - mu_b ** 2
    cov = gaussian_filter(a * b, 1.5) - mu_a * mu_b
    s = ((2 * mu_a * mu_b + c1) * (2 * cov + c2)) / ((mu_a ** 2 + mu_b ** 2 + c1) * (va + vb + c2))
    return float(s.mean())


def layout(gray: np.ndarray) -> np.ndarray:
    edges = np.hypot(sobel(gray, 0), sobel(gray, 1))
    rows, cols = 4, 3
    h, w = gray.shape
    v = []
    for r in range(rows):
        for c in range(cols):
            cell = (slice(r * h // rows, (r + 1) * h // rows), slice(c * w // cols, (c + 1) * w // cols))
            v.append(gray[cell].mean())
            v.append(edges[cell].mean())
    v = np.array(v)
    v = v - v.mean()
    return v / (np.linalg.norm(v) + 1e-9)


def analyse_shots(spec: dict) -> dict:
    shots = spec["shots"]
    k = int(spec.get("framesPerShot", 5))
    thr = spec.get("thresholds", {})
    dup_ssim = thr.get("duplicateSsim", 0.72)
    dup_hash = thr.get("duplicateHash", 8)
    sim_ssim = thr.get("similarSsim", 0.55)
    sim_hash = thr.get("similarHash", 14)
    sim_layout = thr.get("similarLayout", 0.93)
    same_take_sec = thr.get("sameTakeSec", 4.0)
    min_gap = int(thr.get("minGapShots", 3))
    take_ssim = thr.get("takeSsim", 0.40)
    take_hash = thr.get("takeHash", 20)
    take_layout = thr.get("takeLayout", 0.80)

    feats = []
    thumbs = []
    for s in shots:
        times = [s["srcIn"] + (s["srcOut"] - s["srcIn"]) * (i + 0.5) / k for i in range(k)]
        grays, hashes, lays, th = [], [], [], []
        for t in times:
            crop = crop_like_render(_decode_frame(s["path"], t), s["focusX"], s.get("focusY"), s.get("baseZoom") or 1.0)
            g = _resize_gray(crop, THUMB_W, THUMB_H)
            grays.append(g)
            hashes.append(phash(g))
            lays.append(layout(g))
            from PIL import Image
            th.append(np.asarray(Image.fromarray(crop).resize((THUMB_W * 2, THUMB_H * 2), Image.BILINEAR)))
        # blank / flash frames (white flashes, black gaps) inside the shot window
        blanks = [round(t, 2) for t, g in zip(times, grays) if float(g.std()) < 0.035]
        feats.append({"grays": grays, "hashes": hashes, "layout": np.mean(lays, axis=0), "blankFrames": blanks})
        thumbs.append(th)

    n = len(shots)
    pairs = []
    for i in range(n):
        for j in range(i + 1, n):
            a, b = shots[i], shots[j]
            ss = max(ssim(x, y) for x in feats[i]["grays"] for y in feats[j]["grays"])
            hd = min(int(np.count_nonzero(x != y)) for x in feats[i]["hashes"] for y in feats[j]["hashes"])
            lay = float(np.dot(feats[i]["layout"], feats[j]["layout"]))
            same_src = a["sourceId"] == b["sourceId"]
            gap_src = min(abs(a["srcIn"] - b["srcOut"]), abs(b["srcIn"] - a["srcOut"])) if same_src else None
            overlap = same_src and a["srcIn"] < b["srcOut"] and b["srcIn"] < a["srcOut"]
            cut_between = False
            if same_src:
                lo, hi = sorted([a["srcIn"], b["srcIn"]])
                cut_between = any(lo < c < hi for c in a.get("cuts", []))
            same_take = same_src and not cut_between and (overlap or (gap_src is not None and gap_src < same_take_sec))
            face_dist = None
            if a.get("focusY") is not None and b.get("focusY") is not None:
                face_dist = float(np.hypot(a["focusX"] - b["focusX"], a["focusY"] - b["focusY"]))
            same_comp = lay >= sim_layout and a.get("tag") == b.get("tag") and (face_dist is None or face_dist < 0.12)
            # a continuous take only counts when the pictures are also measurably close
            # (long takes with ink dissolves change the motif completely without a hard cut)
            take_close = same_take and (ss >= take_ssim or hd <= take_hash or lay >= take_layout)
            same_motif = bool(a.get("motif")) and a.get("motif") == b.get("motif")
            reasons = []
            if overlap:
                reasons.append("overlapping source window")
            if ss >= dup_ssim:
                reasons.append(f"SSIM {ss:.2f} ≥ {dup_ssim}")
            if hd <= dup_hash:
                reasons.append(f"pHash distance {hd} ≤ {dup_hash}")
            level = "duplicate" if reasons else None
            if level is None:
                if same_motif:
                    reasons.append(f"same curated motif '{a.get('motif')}'")
                if take_close:
                    reasons.append("same continuous take and visually close")
                if ss >= sim_ssim:
                    reasons.append(f"SSIM {ss:.2f} ≥ {sim_ssim}")
                if hd <= sim_hash:
                    reasons.append(f"pHash distance {hd} ≤ {sim_hash}")
                if same_comp:
                    reasons.append(f"same composition (layout {lay:.2f}, tag {a.get('tag')})")
                level = "similar" if reasons else None
            pairs.append({
                "a": i, "b": j, "level": level, "reasons": reasons,
                "ssim": round(ss, 3), "phashDistance": hd, "layout": round(lay, 3),
                "faceDistance": None if face_dist is None else round(face_dist, 3),
                "sameTake": bool(same_take), "shotGap": j - i,
                "secondsApart": round(b["start"] - (a["start"] + a["duration"]), 2),
            })

    # rule checks
    violations = []
    for p in pairs:
        if p["level"] == "duplicate":
            violations.append({"rule": "no duplicates", "shots": [p["a"], p["b"]], "detail": p["reasons"]})
        elif p["level"] == "similar" and p["shotGap"] < min_gap:
            violations.append({"rule": f"similar shots at least {min_gap} shots apart", "shots": [p["a"], p["b"]], "detail": p["reasons"]})
    for i, f in enumerate(feats):
        if f["blankFrames"]:
            violations.append({"rule": "no blank or flash frames inside a shot", "shots": [i], "detail": [f"near-uniform frame at source {t}s" for t in f["blankFrames"]]})
    # clusters of similar/duplicate shots (connected components)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for p in pairs:
        if p["level"]:
            parent[find(p["a"])] = find(p["b"])
    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    clusters = [g for g in groups.values() if len(g) > 1]
    for g in clusters:
        if len(g) >= 3:
            violations.append({"rule": "no motif used three or more times", "shots": g, "detail": ["similarity group"]})

    flagged = {i for v in violations for i in v["shots"]}
    sheet = spec.get("contactSheet")
    if sheet:
        _contact_sheet(sheet, shots, thumbs, pairs, flagged, spec.get("title", ""))
    return {
        "shots": len(shots),
        "framesPerShot": k,
        "thresholds": {"duplicateSsim": dup_ssim, "duplicateHash": dup_hash, "similarSsim": sim_ssim,
                       "similarHash": sim_hash, "similarLayout": sim_layout, "sameTakeSec": same_take_sec, "minGapShots": min_gap,
                       "takeSsim": take_ssim, "takeHash": take_hash, "takeLayout": take_layout},
        "pairs": [p for p in pairs if p["level"]],
        "clusters": clusters,
        "violations": violations,
        "blankFrames": {str(i): f["blankFrames"] for i, f in enumerate(feats) if f["blankFrames"]},
        "pass": not violations,
        "contactSheet": sheet,
    }


def _contact_sheet(out: str, shots: list[dict], thumbs: list[list[np.ndarray]], pairs: list[dict], flagged: set[int], title: str) -> None:
    from PIL import Image, ImageDraw, ImageFont
    k = len(thumbs[0]) if thumbs else 0
    tw, th = THUMB_W * 2, THUMB_H * 2
    label_w = 430
    row_h = th + 12
    W = label_w + k * (tw + 6) + 10
    H = 50 + len(shots) * row_h
    im = Image.new("RGB", (W, H), (24, 22, 20))
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 17)
        bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
    except OSError:
        font = bold = ImageFont.load_default()
    d.text((12, 12), title, fill=(255, 220, 140), font=bold)
    sim_of: dict[int, list[str]] = {}
    for p in pairs:
        if p["level"]:
            sim_of.setdefault(p["a"], []).append(f"{p['level']} #{p['b'] + 1}")
            sim_of.setdefault(p["b"], []).append(f"{p['level']} #{p['a'] + 1}")
    for i, s in enumerate(shots):
        y = 50 + i * row_h
        bad = i in flagged
        d.rectangle([4, y - 2, W - 4, y + th + 4], outline=(220, 60, 50) if bad else (60, 58, 54), width=3 if bad else 1)
        d.text((14, y + 6), f"#{i + 1}  {s.get('act', '')}", fill=(255, 255, 255), font=bold)
        d.text((14, y + 36), f"{s['sourceId']}", fill=(200, 200, 200), font=font)
        d.text((14, y + 58), f"@ {s['srcIn']:.2f}s  ({s['duration']:.2f}s)", fill=(200, 200, 200), font=font)
        d.text((14, y + 80), f"{s.get('motif') or s.get('tag', '')}", fill=(255, 210, 120), font=font)
        notes = sim_of.get(i, [])
        for li, note in enumerate(notes[:5]):
            d.text((14, y + 110 + li * 22), note, fill=(240, 90, 80) if "duplicate" in note else (240, 180, 80), font=font)
        if not notes:
            d.text((14, y + 110), "eigenständig", fill=(120, 210, 140), font=font)
        for f, t in enumerate(thumbs[i]):
            im.paste(Image.fromarray(t), (label_w + f * (tw + 6), y))
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    im.save(out)
