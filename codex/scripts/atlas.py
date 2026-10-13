#!/usr/bin/env python3
"""atlas.py: pack textures from live/assets into one atlas sheet so they share one texture (one batch, no texture switches).

  python3 <skill>/scripts/atlas.py <atlas> name1 name2 ... [--glob 'fx_*'] [--max 2048] [--pad 8]

Writes live/assets/<atlas>.png and merges its entries into live/atlas.js (window.ATLAS = {name: [atlas, u0, v0, u1, v1, w, h]}).
The page then loads the sheet instead of the packed names, and G.tex(name) resolves to the sheet + uv rect, so L.sprite, rigs
and G.batch draw atlased names unchanged. Re-run after prep.py replaces any packed texture.

Group by what is drawn together in one layer (performance.md §1): pickups + bullets + particles, one actor's parts, HUD icons.
Leave out: REPEAT tiles (wrap needs their own texture), full-screen bg_* bands, NEAREST and smooth textures in one sheet.
--pad gaps sprites with their own extruded edge so mip levels don't bleed neighbours in; keep atlased sprites drawn near their
texture size (SIZES), since deep mips need wider pads.
"""
import argparse
import fnmatch
import json
import os
import re
import sys

import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('atlas')
ap.add_argument('names', nargs='*')
ap.add_argument('--glob', action='append', default=[])
ap.add_argument('--max', type=int, default=2048, help='max sheet side; 2048 is safe on every phone GPU, 4096 on most')
ap.add_argument('--pad', type=int, default=8)
ap.add_argument('--dir', default='live/assets')
ap.add_argument('--js', default='live/atlas.js')
a = ap.parse_args()

avail = sorted(f[:-4] for f in os.listdir(a.dir) if f.endswith('.png') and f[:-4] != a.atlas)
names = list(dict.fromkeys(a.names + [n for g in a.glob for n in avail if fnmatch.fnmatch(n, g)]))
missing = [n for n in names if n not in avail]
if missing or not names:
    sys.exit(f'atlas.py: missing textures {missing}' if missing else 'atlas.py: nothing to pack')

ims = {n: Image.open(os.path.join(a.dir, n + '.png')).convert('RGBA') for n in names}
too_big = [n for n, im in ims.items() if max(im.size) + 2 * a.pad > a.max]
if too_big:
    sys.exit(f'atlas.py: {too_big} larger than --max {a.max}; keep them as their own textures')


def shelf(width):
    """Shelf packing, tallest first. Returns ({name: (x, y)}, height) or None if it overflows --max."""
    x = y = row = 0
    pos = {}
    for n in sorted(names, key=lambda n: -ims[n].size[1]):
        w, h = ims[n].size[0] + 2 * a.pad, ims[n].size[1] + 2 * a.pad
        if x + w > width:
            x, y, row = 0, y + row, 0
        pos[n] = (x + a.pad, y + a.pad)
        x, row = x + w, max(row, h)
    return (pos, y + row) if y + row <= a.max else None


# the narrowest square-ish power-of-two width that fits (smaller sheet = less memory)
area = sum((im.size[0] + 2 * a.pad) * (im.size[1] + 2 * a.pad) for im in ims.values())
width = 256
while width < a.max and (width * width < area or shelf(width) is None or shelf(width)[1] > width):
    width *= 2
fit = shelf(width)
if fit is None:
    sys.exit(f'atlas.py: does not fit in {a.max}x{a.max}; split into two atlases')
pos, height = fit

sheet = Image.new('RGBA', (width, height), (0, 0, 0, 0))
entries = {}
for n, (x, y) in pos.items():
    im = ims[n]
    w, h = im.size
    # extrude the border into the pad (mip/bilinear sampling at the edge reads the sprite's own pixels, not a neighbour)
    edge = np.pad(np.asarray(im), ((a.pad, a.pad), (a.pad, a.pad), (0, 0)), mode='edge')
    sheet.paste(Image.fromarray(edge), (x - a.pad, y - a.pad))
    entries[n] = [a.atlas, round(x / width, 6), round(y / height, 6), round((x + w) / width, 6), round((y + h) / height, 6), w, h]
sheet.save(os.path.join(a.dir, a.atlas + '.png'), optimize=True)

old = {}
if os.path.exists(a.js):
    m = re.search(r'window\.ATLAS\s*=\s*(\{.*\})\s*;?', open(a.js, encoding='utf-8').read(), re.S)
    old = json.loads(m.group(1)) if m else {}
merged = {k: v for k, v in old.items() if v[0] != a.atlas and k not in entries}
merged.update(entries)
with open(a.js, 'w', encoding='utf-8') as f:
    rows = ',\n'.join(f'  {json.dumps(k)}: {json.dumps(v)}' for k, v in sorted(merged.items()))
    f.write('// written by scripts/atlas.py: name -> [atlas, u0, v0, u1, v1, w, h]\nwindow.ATLAS = {\n' + rows + '\n};\n')

used = sum(im.size[0] * im.size[1] for im in ims.values())
print(f'atlas {a.atlas}: {len(names)} textures -> {width}x{height} ({used * 100 // (width * height)}% used), {a.js}')
