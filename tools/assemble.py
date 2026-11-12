#!/usr/bin/env python3
"""Assembles the site to publish: everything except engine sources, tools and repo files, into a folder
(default _site), then writes precache.json there (the list sw.js keeps for offline use).
Run after tools/build-wasm.sh."""
import json
import pathlib
import shutil
import sys

root = pathlib.Path(__file__).resolve().parent.parent
site = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root / "_site").resolve()
SKIP_DIRS = {".git", ".github", "engine", "tools", "node_modules", "target", site.name}
SKIP_FILES = {"rust-toolchain.toml", ".gitignore"}

if site.exists():
    shutil.rmtree(site)
for p in sorted(root.rglob("*")):
    rel = p.relative_to(root)
    if p.is_dir() or SKIP_DIRS & set(rel.parts) or p.name in SKIP_FILES or p.suffix == ".md":
        continue
    (site / rel).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p, site / rel)

files = sorted(p.relative_to(site).as_posix() for p in site.rglob("*") if p.is_file() and p.name != "sw.js")
urls = []
for f in files:
    urls.append(f)
    if f.endswith("index.html"):  # a page is opened by its folder's address
        urls.append(f[: -len("index.html")] or "./")
(site / "precache.json").write_text(json.dumps(urls, ensure_ascii=False))
size = sum(p.stat().st_size for p in site.rglob("*") if p.is_file())
print(f"{site}: {len(files)} files, {size / 1e6:.1f} MB; precache.json {len(urls)} entries")
