"""CLI: python -m kindness_analysis <command> [...]

Commands (all print JSON to stdout, or write to --out):
  music   <audio>                 beat map / drop candidates
  locate  <media> --song <audio>  where does the song play inside <media>
  video   <video>                 cuts, black frames, motion, colour, highlights
  probe   <media>                 ffprobe JSON
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")


def _emit(data: dict, out: str | None) -> None:
    text = json.dumps(data, indent=2, ensure_ascii=False)
    if out:
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_text(text + "\n", encoding="utf-8")
    else:
        sys.stdout.write(text + "\n")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="kindness_analysis")
    sub = p.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("music")
    m.add_argument("path")
    m.add_argument("--expected-bpm", type=float, default=None)
    m.add_argument("--out")
    l = sub.add_parser("locate")
    l.add_argument("path")
    l.add_argument("--song", required=True)
    l.add_argument("--threshold", type=float, default=0.85)
    l.add_argument("--out")
    v = sub.add_parser("video")
    v.add_argument("path")
    v.add_argument("--no-audio", action="store_true")
    v.add_argument("--out")
    pr = sub.add_parser("probe")
    pr.add_argument("path")
    pr.add_argument("--out")
    args = p.parse_args(argv)

    try:
        if args.cmd == "music":
            from .music import analyze_song
            _emit(analyze_song(args.path, expected_bpm=args.expected_bpm), args.out)
        elif args.cmd == "locate":
            from .locate import locate_song
            _emit(locate_song(args.path, args.song, match_threshold=args.threshold), args.out)
        elif args.cmd == "video":
            from .video import analyze_video
            _emit(analyze_video(args.path, with_audio=not args.no_audio), args.out)
        elif args.cmd == "probe":
            from .mediaio import probe
            _emit(probe(args.path), args.out)
    except Exception as exc:  # surface a machine-readable error for the TS side
        sys.stderr.write(json.dumps({"error": type(exc).__name__, "message": str(exc)}) + "\n")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
