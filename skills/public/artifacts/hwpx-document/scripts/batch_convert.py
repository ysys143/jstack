#!/usr/bin/env python
"""Batch-convert proposal Markdown files to HWPX using the local converter."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
CONVERTER = SCRIPT_DIR / "md_to_hwpx.py"


def infer_title(path: Path) -> str:
    stem = path.stem
    stem = re.sub(r"^\d+_", "", stem)
    stem = stem.replace("_", " ")
    return stem.strip() or path.stem


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

    parser = argparse.ArgumentParser(description="Batch-convert Markdown proposal files to HWPX")
    parser.add_argument("input_dir", type=Path, help="Directory containing Markdown files")
    parser.add_argument("output_dir", type=Path, help="Directory for generated HWPX files")
    parser.add_argument("--reference", type=Path, required=True, help="Reference .hwp or .hwpx file")
    parser.add_argument("--glob", default="*.md", help="Markdown glob pattern, default: *.md")
    parser.add_argument("--skip-prefix", action="append", default=["00_"], help="Filename prefix to skip; can repeat")
    parser.add_argument("--roman-to-arabic", action="store_true")
    parser.add_argument("--preserve-heading-numbers", action="store_true")
    parser.add_argument("--validate", action="store_true")
    parser.add_argument("--semantic-validate", action="store_true")
    args = parser.parse_args()

    if not args.input_dir.is_dir():
        raise SystemExit(f"Input directory not found: {args.input_dir}")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    files = [
        p for p in sorted(args.input_dir.glob(args.glob))
        if p.is_file() and not any(p.name.startswith(prefix) for prefix in args.skip_prefix)
    ]
    if not files:
        raise SystemExit(f"No Markdown files matched {args.glob} under {args.input_dir}")

    for src in files:
        out = args.output_dir / f"{src.stem}.hwpx"
        cmd = [
            sys.executable,
            str(CONVERTER),
            str(src),
            str(out),
            "--reference",
            str(args.reference),
            "--title",
            infer_title(src),
        ]
        if args.roman_to_arabic:
            cmd.append("--roman-to-arabic")
        if args.preserve_heading_numbers:
            cmd.append("--preserve-heading-numbers")
        if args.validate:
            cmd.append("--validate")
        if args.semantic_validate:
            cmd.append("--semantic-validate")
        print(f"Converting: {src} -> {out}", flush=True)
        subprocess.run(cmd, check=True)


if __name__ == "__main__":
    main()
