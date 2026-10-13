# Performance first: architecture for phones from the first line

The game must hold a stable 60 fps on a mid-range phone (Android and iOS browsers, WebGL2), not only on a laptop. Performance is
**designed in at Phase 1**, the same as the camera and the level: retrofitting a pool, a grid or an atlas into a finished game
means rewriting it. This file is the doctrine. `study/PERF.md` is how a project applies it (§12). The engine already does the
generic part (§0), so the work per game is choosing what fits **this** mechanic.

Rules of thumb:
- **Fit the mechanic, not the list.** A puzzle with 40 objects needs none of pools, grids or batches. A shmup with 800 bullets
  needs all of them. Decide per system from its worst-case count (§12), and write the decision down.
- **Simplest thing that holds the budget.** A flat array scan over 50 things beats a spatial hash. Add structure when the count
  says so (the thresholds below), never "for later".
- **Use the engine, don't duplicate it.** Batching, culling, state caching, render scale and the counters are in gl.js/lib.js.
- **Measure, don't guess.** `?perf=1` and `livecheck.mjs` report frame time p50/p95, draw calls, texture MB (§11).
- **Never trade away the look without asking.** Cut what the eye misses least first (§10).

## Contents
0. What the engine already does
1. Draw calls: batching and atlases
2. Object pools
3. Spatial hash / uniform grid
4. Overdraw and fill rate
5. Offscreen culling and chunking
6. Instancing
7. The update loop: tiers and events
8. Memory and garbage
9. Texture memory and compression
10. Animation, particles, physics
11. Profiling and budgets
12. study/PERF.md: the per-project plan
13. Quality tiers, options and the adaptive governor

---

## 0. What the engine already does (free, automatic)

| Engine feature | Where | Effect |
|---|---|---|
| GL state cache (program, VAO, blend, uniforms, bound textures) | gl.js `useP`, `useVao`, `G.blend`, `setU` | No redundant `useProgram`, blend or uniform upload: a default-valued sprite uniform costs nothing after the first draw |
| Garbage-free sprite path | `L.sprite` (one reused uniform record, scratch arrays) | No per-sprite allocations, so no GC hitches from drawing |
| Offscreen culling | `L.sprite` (non-rig quads; `noCull: true` opts out), `L.glow/shadow/puff/star/ring` | Quads outside the target cost nothing on the GPU |
| Render scale | `G.init(…, { scale })`, settings.js | Never renders more pixels than the screen shows; tier cap (mid 0.75, low 0.6); re-fit on resize/rotation; `?scale=k` |
| Quality tiers + governor | settings.js, `Q` (§13) | Phones drop passes, rays, bloom radii and particles; auto steps down when frames run long |
| Render interpolation | index.html (`SIM.LERP`) | Smooth motion at any refresh rate without running the sim faster |
| No `preserveDrawingBuffer` outside `?render=1` | index.html | Avoids a full-frame copy per frame on tile GPUs |
| Instanced batches | `G.batch(name)` | N quads of one texture = 1 draw call |
| Atlas lookup | `G.tex(name)` + `live/atlas.js` | Atlased names draw unchanged and can share one batch |
| Counters | `G.stats` / `G.last`, `__perf()` | Draw calls, program switches, instanced quads per frame |
| Fixed 120 Hz sim, render decoupled | index.html loop | Sim cost is stable; render scales with the device |

## 1. Draw calls: batching and atlases (priority 1)

Every `L.sprite` / primitive is one draw call with a full uniform upload. Phones handle a few hundred per frame; past that the CPU
side stalls before the GPU is busy.

- **Budget:** ≤ 250 draw calls per frame on the play screen (`__perf().draws`), ≤ 400 at the busiest moment.
- **Numerous + simple → `G.batch`.** Bullets, particles, coins, tiles, debris, grass blades, crowds of small props:
  ```js
  const B = G.batch('fx');                              // same object every frame, no allocation
  for (const p of S.parts) if (p.on) B.add(p.x - 8, p.y - 8, 16, 16, { rot: p.a, alpha: p.life, tint: p.col });
  B.flush();                                            // one draw call, at this point of the layer order
  ```
  `add(x, y, w, h, { rot, pivot, src, flip, alpha, tint })`; `B.lod` = mip bias. Draw order inside a batch is add order; a batch
  is one layer, so flush it where that layer goes. Sprites that need `L.sprite`'s shader features (sway, rim, grade/haze,
  bones, bulge) stay on `L.sprite`; there are few of them.
- **Atlases make batches possible across names.** One batch = one texture, so things drawn together in one layer go into one
  atlas: `python3 <skill>/scripts/atlas.py fx coin spark bullet_0 bullet_1 --pad 8`. Group per layer and per filter (never mix
  NEAREST and smooth). Leave REPEAT tiles and full-screen `bg_*` bands as their own textures. Re-run after `prep.py` changes a
  packed texture.
- **Sort by texture, not by habit.** Within a layer where depth between items doesn't matter (pickups, particles), draw all of
  one texture together. Where it does matter (y-sorted top-down actors), keep the sort and atlas the actors so the sort doesn't
  split batches.
- **Glyph text** is already one texture; a long HUD string is many quads. Cache static HUD into a canvas texture
  (`G.canvasTex`) when it changes rarely.
- The ink pass (`L.inked`) draws a puppet n + 1 times. Keep it for actors that need the line, and lower `n` (6 is usually enough).

## 2. Object pools (priority 2)

Anything created and destroyed during play (bullets, enemies, pickups, particles, damage numbers, decals) lives in a
**fixed-size array of plain objects** allocated once in `SIM.create()`. Spawning reuses a dead slot; dying flips a flag. Nothing
is pushed or spliced per frame. This keeps the state JSON-able (sessionStorage across reloads) and deterministic, and makes
the worst case visible in the data.

```js
// sim.js: pool = array of plain objects, created once; `on` marks the live ones
const pool = (n, make) => Array.from({ length: n }, (_, i) => ({ on: 0, id: i, ...make() }));
const spawn = (P, init) => { for (const o of P) if (!o.on) { Object.assign(o, init); o.on = 1; return o; } return null; };  // full → drop
// create(): S.bullets = pool(256, () => ({ x: 0, y: 0, vx: 0, vy: 0, t: 0 }));
// step():   for (const b of S.bullets) if (b.on) { b.x += b.vx * DT; …; if (dead) b.on = 0; }
```
- Size each pool from the design's worst case + margin (PERF.md), and decide what happens when full: drop the oldest cosmetic
  particle, refuse a new bullet. Never grow silently.
- A free-list index makes spawn O(1). Add it when the pool is over ~500 and spawns are frequent; a linear scan is fine below.
- The scene derives one-shot FX from `S.ev` (events) by age, so most visual effects need no pool at all.

## 3. Spatial hash / uniform grid (priority 3)

Pairwise checks are O(n·m). Below ~30 × 30 pairs a plain loop is fastest; above that, bucket things into a uniform grid
rebuilt every step (cheap, no stale state, nothing to serialise):

```js
// sim.js, module scope (scratch, NOT in S): cell = about the largest collider diameter
const CELL = 128, COLS = Math.ceil(WORLD_W / CELL), ROWS = Math.ceil(WORLD_H / CELL);
const head = new Int32Array(COLS * ROWS), next = new Int32Array(MAX_ENEMIES);
const cellOf = (x, y) => Math.max(0, Math.min(ROWS - 1, y / CELL | 0)) * COLS + Math.max(0, Math.min(COLS - 1, x / CELL | 0));
function buildGrid(E) { head.fill(-1); E.forEach((e, i) => { if (!e.on) return; const c = cellOf(e.x, e.y); next[i] = head[c]; head[c] = i; }); }
function near(x, y, r, E, fn) {          // visits every live entity whose cell touches the circle
  const c0 = Math.max(0, (x - r) / CELL | 0), c1 = Math.min(COLS - 1, (x + r) / CELL | 0);
  const r0 = Math.max(0, (y - r) / CELL | 0), r1 = Math.min(ROWS - 1, (y + r) / CELL | 0);
  for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) for (let i = head[cy * COLS + cx]; i >= 0; i = next[i]) fn(E[i], i);
}
```
- Linked lists in typed arrays: zero allocation per step.
- Compare squared distances; `Math.hypot` and `sqrt` only when the real distance is needed.
- Static colliders (level geometry) go in a grid built **once** at load, not per step.
- Endless/huge worlds: hash `(cx, cy)` into a fixed-size table instead of a dense grid.
- Iteration order must not depend on anything but the data (determinism: the demo replays identically).

## 4. Overdraw and fill rate (priority 4)

Phones are fill-rate bound long before they are vertex bound. Every transparent pixel drawn over another costs.
- **Full-screen passes are the expensive thing:** each fog strip, god rays (mask + 72-sample blur), veil, water, bloom (2 radii),
  the final grade. Count them per frame in PERF.md; each must earn its place in the look.
- **Trim** transparent margins (prep.py does) so quads cover only real pixels. Big, mostly empty quads (a vignette sprite, a
  full-screen overlay PNG) are pure overdraw: do them in the final shader or as a `L.fog` band.
- **Opaque layers without blending.** The sky and opaque full-screen bands can draw with `G.blend('none')`.
- **Stacked translucent layers** (5 fog bands + haze + veil + particles) multiply cost. Merge bands where the reference allows.
- Render scale (§0) is the last lever and the bluntest: keep the look at scale 1 on desktop, let phones run at 0.75.

## 5. Offscreen culling and chunking (priority 5)

- **Drawing:** `L.sprite` culls automatically. For custom draws and batches, test `G.onScreen(x, y, w, h, margin)` first.
- **Updating:** visual-only things offscreen (ambient critters, swaying foliage springs, particles, idle NPC animation) are not
  updated, or update at a low tier (§7). **Gameplay never culls**: enemies, timers and hazards keep their logic offscreen,
  or the demo and play diverge.
- **Chunking:** levels longer than ~3 screens store placed things per chunk (fixed width, e.g. one screen). The scene iterates
  only chunks that intersect the camera ± one; the sim's ambient systems likewise. Static decoration per chunk can be baked
  into one canvas texture when it never animates.

## 6. Instancing (priority 6)

WebGL2 has instancing natively; `G.batch` is it (one quad, per-instance affine + uv + colour). Use a custom instanced program
(`G.program(name, fs, vs)` with per-instance attributes, same pattern as gl.js) only when a numerous effect needs its own
shader, e.g. 2,000 grass blades with wind sway computed in the vertex shader from `u_t` and a per-instance phase.

## 7. The update loop: tiers and events (priority 7)

The sim runs at 120 Hz. Most things don't need that.
- **Tiers:** every-step (player, projectiles, collisions), every 2nd–4th step (enemy steering, AI decisions), every ~0.25 s
  (pathfinding, target selection, spawn directors), on event only (doors, UI, scoring). Stagger the slow tiers by entity
  index so their cost spreads across steps: `if ((S.step + e.id) % 4 === 0) think(e)`.
- **Events, not polling.** React to `S.ev` (collect, hurt, land) instead of checking conditions every frame. The scene already
  derives FX from events.
- **Hoist invariants:** level-derived tables (surfaces, nav grids, spawn lists, lookup tables of sin/cos when hot) are
  computed once at load, not per step.
- **Pathfinding:** a flow field (one BFS from the player over the grid, refreshed every ~0.25 s) serves hundreds of enemies
  for the cost of one search. Per-enemy A* is for few enemies with different goals.
- **The scene** is a pure function of state: it must not re-derive expensive data per frame either. Cache per-level
  constants at module scope.

## 8. Memory and garbage (priority 8)

GC pauses are frame-time spikes (p95, not p50). Hot paths (step, render, per-entity code) allocate nothing:
- No `map`/`filter`/spread/`{...}`/array literals per entity per frame in hot loops; plain `for` loops over pools.
- Reuse scratch objects and typed arrays at module scope (`Float32Array`, `Int32Array`). Return numbers, not `[x, y]`, from
  functions called thousands of times.
- The event bus is capped (64); keep it that way.
- Load-time and level-start allocation is fine; that's where pools and tables are built.
- `__perf().heapMB` (Chromium) should be flat during play; a sawtooth means per-frame allocation.

## 9. Texture memory and compression (priority 9)

A 2048² RGBA texture with mips is 21 MB of GPU memory, no matter how small the PNG file. Phones have a fraction of a laptop's.
- **Budget:** ≤ 150 MB textures for the whole game (`__perf().texMB`), ≤ 2048 px on a side per texture.
- **Size textures to their display size:** about 1.5–2 × the size in `SIZES` at the target view, not the generator's native
  resolution. Downscale in prep, keep the full source in `art/gen`.
- **Atlases** cut the per-texture overhead and the switches (§1).
- **GPU compression (ASTC on iOS and modern Android, ETC2 on the rest)** through KTX2 + Basis Universal cuts memory 4–8×. It
  needs a transcoder (wasm) at load time, so it belongs in the delivery build of a game that is over the texture budget after
  resizing and atlasing, not in the live loop. Check `WEBGL_compressed_texture_astc` / `_etc` on the target devices first.
- Pixel art with NEAREST has no mips: 25 % less memory, and must stay uncompressed (compression smears hard pixels).

## 10. Animation, particles, physics (priority 10)

- **Rigs:** cut-out rigs are a handful of quads per actor; that's the cheap path, and it stays. Far or offscreen actors skip
  secondary motion (springs, cloth) and drop to a lower tier. Many identical background actors can be batched (atlas the parts).
- **Particles:** one pool, one batch per texture/blend mode, positions as pure functions of age where possible (no
  integration: `x = x0 + vx·age`, `y = y0 + vy·age + g·age²/2`). Cap per emitter, scale density with `G.SCALE` on phones.
- **Physics:** simple shapes (AABB, circle, segment), layer masks so only pairs that can interact are tested (bullets ×
  enemies, never bullets × bullets), the grid (§3) for broad phase, and sleeping for things at rest.
- **Shaders:** `fbm` is 5 noise octaves per pixel; on a full-screen pass that's the cost of the frame. Use fewer octaves or a
  noise texture for big areas.

**What to cut first when over budget** (least visible first): ambient particles and motes → extra fog bands → god-ray samples
→ bloom second radius → render scale on the affected device class → only then actor detail. Ask before changing the look.

## 11. Profiling and budgets

- **Live:** `?perf=1` or F shows fps, frame time p50/p95, CPU time (sim + render submit), draw calls, program switches,
  instanced quads, render scale, texture MB, heap MB. `window.__perf()` returns the same object.
- **Headless:** `livecheck.mjs` prints `perf` with every run. Compare it with the PERF.md budgets at each gate; a regression
  is a defect like any other.
- **Worst case, not average:** add a `stress` input script or QA state with the design's maximum (all enemies, full bullet
  pool, every effect on) and read `__perf()` there.
- **Phones:** `livecheck.mjs --mobile --cpu 4` emulates a landscape phone (touch, mid tier, render ≤ 0.75) on a 4× slower CPU;
  `--q low` checks the weak-phone tier. Test the packed build on a real device with `?perf=1` before calling it done.
- **Budgets (60 fps, mid-range phone):** frame p95 ≤ 16.7 ms; CPU (sim + render) p95 ≤ 8 ms; draws ≤ 250 typical / 400 peak;
  full-screen passes ≤ 10; textures ≤ 150 MB; heap flat during play. A project tightens or loosens these in PERF.md.

## 12. study/PERF.md: the per-project plan

Written in Phase 1, right after PLAN.md and before the systems are coded; updated whenever a system or a count changes;
`pack.py` copies it into the build and its README. Template: `templates/PERF.md` (setup.sh seeds it). It holds:
1. **Target:** devices, view, fps, budgets (copied from §11, adjusted).
2. **Entity budget per system:** max simultaneous count, from the design (e.g. enemies 60, bullets 400, pickups 120, particles 1,500).
3. **Decisions per system:** pool size and full-pool policy; collision broad phase (loop / grid, cell size); update tier;
   batch/atlas group; cull rule. One line each, with the reason.
4. **Render plan:** layers in order, draw calls per layer, full-screen passes, atlases and what's in them, texture MB.
5. **Measured:** the last `__perf()` at the gates (normal play and the stress case), and on a device when tested.

## 13. Quality tiers, options and the adaptive governor (settings.js)

One game, three costs. `window.Q` is resolved from the player's options and the device, and lib.js reads it every frame:

| Tier | Who | Render scale cap | `fx` (particles, motes) | `post` (bloom radii) | `rays` (taps) | ink passes | fbm octaves | drop shadows |
|---|---|---|---|---|---|---|---|---|
| high | desktop | 1 | 1 | 2 | 72 | 8 | 5 | on |
| mid | phones, tablets | 0.75 | 0.7 | 1 | 36 | 6 | 4 | on |
| low | weak phones (≤ 4 cores or ≤ 3 GB) | 0.6 | 0.4 | 0 | off | 4 | 3 | off (Auto) |

- **Auto** (default): the device guess above, then the **governor**. After a 3 s warm-up, every 2 s it reads the frame p95; two
  windows over 20 ms step one tier down, remembered for this device (a steady 30 Hz cap is recognised and left alone). It
  never steps up during a session, so the look doesn't pump. Off while paused, hidden or under automation (`?gov=1` forces it).
- **The player's options** (menu, saved per game): Quality Auto/High/Medium/Low, Shadows Auto/On/Off, Music, Sound effects,
  Screen shake (off by default with `prefers-reduced-motion`), Touch controls Auto/On/Off.
- **What honours what:** `L.dropShadow` → `Q.shadows` (contact ellipses stay: they ground actors); `L.finish` → `Q.post`;
  `L.godRays` / `L.veil` → `Q.rays` (off = no passes at all); `L.motes` and the scene's own counts → `L.fx(n)`;
  `L.inked` → `Q.ink`; every fbm (fog, water, sprite fades) → octaves; shake → `Q.shake`. A scene that adds its own
  expensive extra (a reflection pass, a second particle layer) gates it on `Q` the same way, and says so in PERF.md.
- **Never in the sim.** Gameplay is identical on every tier; only what is drawn changes. Renders and QA always run high.
- **Check every tier at Gate B:** `livecheck.mjs --q low` and `--mobile` must stay readable (the low tier loses glow, not
  information: no gameplay cue may live only in bloom, rays or particles).
