#!/usr/bin/env python3
"""Checks that every Hangul syllable the site can show is in the cut-down Gaegu font.

The font (shared/fonts) keeps only the 2,350 common Hangul syllables; anything else falls back to a
system font and breaks the hand-written look. This scans the page sources (lines, rules, buttons...)
for Hangul syllables and fails if one is missing from the font.
Needs: pip install fonttools brotli
"""
import pathlib
import re
import sys

from fontTools.ttLib import TTFont

root = pathlib.Path(__file__).resolve().parent.parent
cmap = set()
for f in ("Gaegu-Regular.woff2", "Gaegu-Bold.woff2"):
    font = TTFont(root / "shared" / "fonts" / f)
    cmap |= set(font.getBestCmap().keys()) if not cmap else cmap & set(font.getBestCmap().keys())

skip = {"engine", "pkg", "node_modules", ".git", "tools", "target"}
sources = [p for p in root.rglob("*") if p.suffix in (".js", ".html", ".webmanifest") and not (skip & set(p.relative_to(root).parts))]
bad = {}
for p in sources:
    for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        for ch in re.findall(r"[가-힣]", line):
            if ord(ch) not in cmap:
                bad.setdefault(ch, []).append(f"{p.relative_to(root)}:{n}")
if bad:
    for ch, where in sorted(bad.items()):
        print(f"'{ch}' not in the font: {', '.join(where[:5])}")
    sys.exit(1)
print(f"ok: {len(sources)} files, every Hangul syllable is in the font")
