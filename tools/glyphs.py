#!/usr/bin/env python3
"""Turns a few characters of a font into SVG paths, so piece names are drawings and don't depend on a font being loaded.
  python3 tools/glyphs.py <out.js> <name>=<font file or folder of subset files>:<characters> ...
e.g. python3 tools/glyphs.py shared/glyphs.js hangul=shared/fonts/Gaegu-Bold.woff2:초한차포마상사졸병 hanja=/tmp/zen/files:楚漢車包馬象士卒兵
Each glyph is scaled into a 100×100 box (y down), centred on its own ink. Writes `export const GLYPHS = {name: {char: "path d"}}`.
Needs fonttools and brotli. The sources must allow this (both here are SIL OFL 1.1; their licences sit in shared/fonts/)."""
import glob, json, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

out, specs = sys.argv[1], sys.argv[2:]
result = {}
for spec in specs:
    name, rest = spec.split("=", 1)
    src, chars = rest.rsplit(":", 1)
    files = sorted(glob.glob(os.path.join(src, "*-400-normal.woff2"))) if os.path.isdir(src) else [src]
    fonts = [TTFont(f) for f in files]
    result[name] = {}
    for ch in chars:
        font = next((f for f in fonts if ord(ch) in f.getBestCmap()), None)
        if font is None:
            sys.exit(f"{name}: no glyph for {ch}")
        gs, g = font.getGlyphSet(), font.getBestCmap()[ord(ch)]
        bp = BoundsPen(gs); gs[g].draw(bp)
        x0, y0, x1, y1 = bp.bounds
        k = 100 / font["head"].unitsPerEm          # em → 100 units; then centre the ink in the box
        dx, dy = 50 - (x0 + x1) / 2 * k, 50 + (y0 + y1) / 2 * k
        pen = SVGPathPen(gs, ntos=lambda v: ("%.1f" % v).rstrip("0").rstrip("."))
        gs[g].draw(TransformPen(pen, (k, 0, 0, -k, dx, dy)))
        result[name][ch] = pen.getCommands()
body = json.dumps(result, ensure_ascii=False, indent=1)
open(out, "w").write("// Piece names as SVG paths (100×100 box, ink centred), made by tools/glyphs.py so they don't depend on a loaded font.\n"
                     "// hangul: Gaegu Bold; hanja: Zen Kurenaido (both SIL OFL 1.1, licences in shared/fonts/).\n"
                     f"export const GLYPHS = {body};\n")
print(out, {k: len(v) for k, v in result.items()}, os.path.getsize(out), "bytes")
