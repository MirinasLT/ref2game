# The live engine (templates/live): files, API, contracts, the live-preview loop

A tiny WebGL2 renderer, a deterministic sim and a scene file that is a pure function of time and state. It runs in the browser with no build step and no dependencies. Its job is to make the game look shipped and alive, fast, in a page the user watches while you work.

## Contents
1. Files and responsibilities
2. The live-preview loop (how we work)
3. gl.js
4. lib.js API
5. Sprite uniforms reference
6. The sim contract (sim.js)
7. The scene contract (scene.js)
8. Determinism rules
9. Tools: render.mjs, livecheck.mjs, tune.cjs
10. Performance budget
11. The game shell: input, settings and quality, menu, sound, lifecycle

---

## 1. Files and responsibilities

| File | Owns | Changes per project? |
|---|---|---|
| `live/index.html` | The game shell: loading (cache-busted), canvas (aspect from `SIM.VIEW`), hint, attract vs play, the fixed-step loop with render interpolation, sim events → sound and result cards, respawn, pause on hidden tab, WebGL context-loss recovery, dev keys, hot-reload polling, sessionStorage state (dropped when the sim's shape changed) | No (engine; `--refresh-engine`) |
| `live/gl.js` | WebGL2 context, caps (`G.CAPS`: hdr targets, max texture size), premultiplied textures (mipmapped, or nearest; downscaled past the GPU limit), programs (COMMON: hash, vnoise, fbm with `FBM_OCT` octaves, scr), checked render targets (half-float or RGBA8 fallback), resize/free, cached GL state (program, VAO, blend, unchanged uniforms and bound textures skipped), affine quads, instanced batches | No (`setup.sh --refresh-engine` updates it) |
| `live/settings.js` | `SET` (player options, localStorage), `Q` (quality tier knobs), the pause / settings / result menu, render-scale fit on resize, the adaptive quality governor | No (engine) |
| `live/input.js` | One input record from keyboard (latched taps, no stuck keys), pointer, touch (floating stick + buttons from `SIM.CONTROLS`) and gamepad | No (engine) |
| `live/snd.js` | Sound engine: procedural SFX voices, jingles, sample SFX, streamed or procedural music with ducking; zero cost while off | No (engine) |
| `live/collide.js` | `COLLIDE`: box movers vs tile grids and rects (walls, ceilings, one-way, corner correction, top-down corner nudge, moving platforms that carry); `node live/collide.js` self-tests | No (engine) |
| `live/audio.js` | `window.SOUND`: this game's event → sound map, voices, files, song (`audio.md`) | Yes, the game's sound |
| `live/lib.js` | Shader library, `sprite()`, passes (shadow, ink), primitives (glow, shadow, puff, star, ring, fog), rig helper, glyph text, the frame pipeline | Add shaders through `L.init(w, h, extra)`; edit lib only for engine-wide fixes |
| `live/sim.js` | Everything that **happens**: movement, collisions, level data, pickups, hazards, critters, reactive props, springs, wind, camera, events | Yes, it is the game |
| `live/scene.js` | Everything that is **drawn**: layer plan, parallax, placement, rig poses, FX from events, HUD | Yes, it is the look |
| `live/assets.js` | `window.ASSETS` (written by `prep.py`): w, h, crop, scale, walk/bottom | Generated |
| `live/tune.cjs` | Headless attract-route check (`SIM.demoCheck`, else all pickups) and level self-check (`SIM.selfCheck`) | Yes |

## 2. The live-preview loop (how we work)

The user watches `http://127.0.0.1:<port>/live/index.html`. Start it with `bash <skill>/scripts/serve.sh` in the background. The page polls its sources every 700 ms and reloads itself on change, keeping play state, speed and pause. **Every change you make shows up there within a second.**

Rules:
- **Keep the page green.**
  - After every edit batch, run `node <skill>/scripts/livecheck.mjs`. It must report 0 errors and fps ≥ `--minfps` (default 55).
  - A syntax error shows a red stack on the page. Polling continues, so the fix reloads by itself, but don't leave it broken.
- **Look at it yourself the way the user does.**
  - `render.mjs stills` at the key beats, or `livecheck.mjs --shots` in play mode.
  - Build contact sheets (`sheet.py`) and crops; never judge from memory.
- **Dev keys for inspecting motion:**
  - P pauses;
  - `[` and `]` change speed (0.1 / 0.25 / 0.5 / 1);
  - `.` single-steps (one 1/120 s sim step);
  - F toggles the perf overlay;
  - Esc opens the menu (Resume, Restart, Quality, Shadows, Music, Sound, Shake, Touch controls, Fullscreen, Title);
  - R restarts.
  - The packed build keeps only Esc and R (and F via `?perf=1`).
- **Query flags:**
  - `?render=1` is the offline renderer mode;
  - `?fx=0` hides fog and rays;
  - `?only=name1,name2` draws only those sprites, to bisect a stray line or pixel;
  - `?q=low|mid|high` forces a quality tier, `?scale=k` a render scale, `?perf=1` shows the perf overlay.
- **When you hand back,** tell the user exactly what to try in play mode: which key, where, and what should react.

## 3. gl.js

- `G.init(canvas, W, H, { scale, preserve, oct })`: W×H is the view every draw uses; `scale` (0.25..1) renders the backbuffer and all of lib's targets at fewer pixels (settings.js picks it: never above what the screen shows, never above the tier's cap, `?scale=k` overrides, `?render=1` = 1). `oct`: fbm octaves compiled into every shader (tier). `preserve` only for screenshots.
- `G.resize(scale, out)` + `L.resize()`: `scale` = the scene's render targets, `out` (scale..1) = the backbuffer where the final grade upsamples the scene and the HUD draws (settings.js: what the screen shows up to view size; the low tier keeps it at `scale`), so a phone rendering the world at 0.66 still gets crisp text and edges. Change them at runtime (settings.js does it on window resize, rotation and tier change). Scene-made targets register a maker in `L.onResize` so they follow.
- `G.CAPS = { hdr, maxTex }`: `G.target(w, h, true)` is half-float when the GPU renders to it, else RGBA8 (checked, never a silent black frame). `G.free(target)` deletes one.
- GL state is cached: `G.blend(mode)` with the current mode, a uniform with the value this program already has, a texture already on its unit, all cost nothing. Code that binds a texture with raw `gl` calls must call `G.dirtyTex()`.
- `G.load(name, url, {repeat, nearest})`. `nearest`: NEAREST min/mag, no mipmaps (lod bias does nothing). index.html sets it for the names in `SCENE.NEAREST`, or for all when `SCENE.NEAREST = true`.
- `G.canvasTex(name, canvas)`
- `G.tex(name)` returns `{t, w, h}`; for a name packed by `atlas.py` it returns the atlas texture plus `src` (its uv rect) and its own w, h, so every draw path handles atlased names unchanged.
- **Streaming (big games).** `SCENE.BOOT = [names]` lists what the first frame needs; only those (and their atlas sheets) load before play. Any other name loads on first use: until it lands it is a `pending` stub of its real size that draws nothing, and the image is decoded off the main thread before the upload (no hitch). `G.prefetch(names)` warms the next level while this one plays, `G.unload(names)` frees the level you left, `G.loaded(name)` tells whether it is in. No `SCENE.BOOT` = everything at boot (fine under ~40 MB of textures). Renders (`?render=1`) always load everything.
- `G.dim(name)` = `{w, h}` from the loaded texture, the atlas entry or the `ASSETS` manifest, never touching the GPU (`L.hsz`, `L.sz` use it: picking or laying out a sprite never uploads it). `G.mem()` = bytes of the textures actually loaded (with mips); `__perf().texMB` reports it.
- `G.program(name, fragSrc)`. The vertex shader is fixed. The fragment shader gets `v_uv` (0..1 over the quad, flipped by `u_flip`), `v_px` (screen px), `u_res` and `u_t`, plus the COMMON helpers `hash`, `vnoise`, `fbm` and `scr(px)` (screen px to render-target uv).
- `G.target(w, h, float, {view, nearest})`: `view` = the coordinate space draws use (default `[w, h]`), so a small target can still be drawn in view px; `nearest` samples it crisp. `G.bind(target | null, clearRGBA?)`
- `G.blend('add' | 'screen' | 'none' | default=premultiplied over)`
- `G.xf(x, y, w, h, rot, px, py)` gives an affine for a quad with top-left (x, y), size w×h, rotated about the pivot (px, py) in local px. It returns one scratch array (no garbage per draw): pass it straight to `G.draw`, never keep it.
- `G.batch(name)` returns a reusable instanced batch for one texture (or atlas): `b.add(x, y, w, h, { rot, pivot, src, flip, alpha, tint })` per quad, `b.flush()` once = one draw call (`performance.md` §1). `b.lod` = mip bias.
- `G.onScreen(x, y, w, h, margin)`: is the rect visible in the bound target? (`L.sprite` culls with it automatically; `noCull: true` opts out.)
- `G.stats` = `{ draws, progs, inst }` of the current frame; `G.frame()` (index.html, once per frame) moves them to `G.last`. `window.__perf()` adds frame/CPU p50/p95, texture MB, heap; `?perf=1` or F shows it.
- `G.draw(P, uniforms, xf, flip)` and `G.full(P, uniforms)`. Never call `gl.useProgram`, `gl.bindVertexArray` or `vertexAttribPointer` directly: gl.js caches that state, so go through `G.program` / `G.draw` / `G.batch`. Only `u_res`, `u_xf` and `u_flip` are set for you; every other uniform, `u_t` included, belongs to its program and keeps its last value (0 if never set). A helper whose shader animates takes `t` and passes it on every draw.

Textures are uploaded **premultiplied** (no dark halos) with mipmaps and LINEAR_MIPMAP_LINEAR, or NEAREST without mips (`SCENE.NEAREST`). Pixel art: `SCENE.NEAREST = true`, `L.init(W, H, extra, { pixel: k })`, positions snapped to multiples of k (`styles.md`).

## 4. lib.js API (window.LIB, used as `L` in scenes)

**Setup and math:**
- `L.init(W, H, extraShaders, { pixel, readBG })` compiles all programs into `L.P.<name>` and creates targets `L.T.{bg, comp, mask, rays, b1, b2, c1, c2}`. `pixel: k` (> 1) renders bg and comp into W/k × H/k targets, still drawn in W×H view px, and `finish` upscales them with nearest: crisp pixel art. The HUD (after `finish`) stays full-res. `readBG: true` when a custom shader samples `T.bg` after `beginComp` (the frame before the play plane): only then is comp a separate target that `beginComp` copies bg into; otherwise comp *is* bg (no copy, one full-res target less). `L.water`, `L.cracks` (mode 1) and `L.rain` switch it on by themselves; a shader that samples the target it draws into logs a feedback-loop error naming the uniform.
- Set `L.SUN = [x, y]` for fog scatter and rays.
- `L.M` gives 2×3 affines: `t(x, y)`, `r(a)`, `s(x, y)`, `mul`, `of(...)`, `ap(M, p)`. Rig chains read like `M.of(M.t(x, y), M.s(face, 1), M.r(a))`.
- `L.SS(e0, e1, x)` is smoothstep; `L.rnd(a, b)` is a deterministic hash in [0, 1); `L.lerpP(a, b, w)` lerps arrays; `L.ph(t, period, k)` is phase.
- `L.hsz(name, h)` is the width at height h; `L.sz(name, k)` is `[w·k, h·k]` (both from `G.dim`: no upload).

**No garbage in the frame.** `L.sprite` returns its drawn `{w, h}` in one reused record (read it at once); the primitives fill reused uniform records; `G.xf` is a scratch array. Game code does the same: hoist constant option records out of `render` (`const U_ROCK = { rim: [0.35, -0.004, -0.004, 1] }` at module scope, then `L.sprite('rock', x, y, { h, u: U_ROCK })`), loop with `for` over pooled arrays, and keep the per-frame literals to the few one-off calls.

**Sprites and passes:**
- `L.sprite(name, x, y, opts)` draws one textured quad (§5).
- `L.dropShadow(drawFn, {dx, dy, a, lod})` draws a soft, offset, blurred dark copy of a group. Call it, then draw the group normally.
- `L.inked(drawFn, {r, n, col})` makes one weighted ink silhouette around a whole puppet: n offset flat-ink copies, then the puppet. It gives a line that is uniform no matter what the generator drew, and lets actors carry a heavier line than props when the style wants that.
- `L.sp` is the active pass override (`{dx, dy, a, lod}` for shadow, `+ink: [r, g, b]` for ink). The helpers set it; custom draw code must skip glows and caps when `L.sp` is set.

**Primitives** (all premultiplied):
- `L.glow(x, y, r, col, amt, k)` is additive.
- `L.shadow(x, y, rx, ry, amt)` is a soft dark ellipse: contact shadows and HUD backings.
- `L.puff(x, y, r, col, amt, seed)` is a noisy soft blob: dust, smoke, splash drops.
- `L.star(x, y, r, col, amt)` is an additive 4-point sparkle.
- `L.ring(x, y, rx, ry, col, amt, w)` is a shockwave or ripple ring.
- `L.rain(t, amt, cam, phase, { wind })` is rain for a ground view: `'ground'` in the ground decal pass (wet ground, puddles), `'fx'` after the light pass (splashes, puddle glints from strong lights), `'sky'` for the lit, slanted streaks over everything (`effects.md` §1).
- `L.cracks(x, y, R, age, seed, mode)` is ground impact fissures (a slam, a stomp, a meteor): jagged branching cracks that race out from the impact point, shattered plates round a crater, a pale broken lip. Mode 0 goes in the ground decal pass, mode 1 after the light pass adds the magma glow, masked by sprites (`effects.md` §4).
- `L.solid(x, y, w, h, col, rot, px, py)` draws ropes, strings and bars.
- `L.fog(y, h, [scale, speed, threshold, density], col, seed, t, scatter)` is an fbm fog band across the screen.

**2.5D (projection and depth):** world `x` (right), `y` (ground depth), `z` (height above the ground).
- `L.view({ mode, cx, cy, tilt, f, horizon, camH })` once per frame: `'side'`, `'top'` (3/4 and beat-'em-up lanes, `tilt` 0.5–1), `'iso'` (2:1 at tilt 1), `'persp'` (pseudo-3D road: scale `f / (y − cy)` toward `horizon`, camera height `camH`).
- `L.at(x, y, z)` → `L.PT = [sx, sy, scale, depth]` (scratch; scale ≤ 0 = behind the camera, skip it). Draw the sprite at `(sx − w·s/2, sy − h·s)` with size × s.
- `L.dq.add(depth, kind, i)` per drawable, then `L.dq.draw(DRAW)`: sorted far → near, ties in add order (no flicker), reused records. `DRAW[kind](i)` draws one. The top-down template draws its world through it.
- `L.shadowAt(x, y, z, rx, ry, amt)`: the contact shadow stays on the ground under something z px up, smaller and fainter as it rises: the one cue that sells height in 2.5D.
- Sim side: x/y move and collide on the ground plane (`COLLIDE` with `nudge`), z is its own axis (`vz`, gravity, land at 0); hits test overlap in x and y and a depth band (|Δy| < lane width), not just screen rectangles.

**Rig:**
- `L.twoBone({tex, p, a1, a2, face, rot, w, h, split, root, joint, r, col, u, capDark})` draws a limb from one drawing cut at the joint, plus a round joint cap. It returns the joint's screen position. See `animation.md`.

**HUD:**
- `L.glyphs(chars, {size, font, stroke, fill})` builds a canvas glyph atlas once (chunky rounded digits with an ink stroke and a gradient fill).
- `L.text(str, x, y, h, align, alpha)` draws with it.

**Frame pipeline** (call in this order every frame):

```
L.beginBG()                         → T.bg: sky, sun glow, bands with per-plane grade/haze/lod, fog strips between bands
L.godRays(t, {sun, amt, col})       → occluded shafts from the bright sky through the band silhouettes (screen-added onto T.bg)
L.beginComp()                       → T.comp = copy of T.bg; now draw: L.water(...) / L.waterfall(...) (they sample T.bg),
                                      play plane (dropShadow + pieces), actors (inked), FX, front tufts
L.veil(amt) ; L.motes(t, {...})     → a thin veil of the shafts over the play plane, dust motes lit only inside shafts
(foreground framing clumps)
L.finish(t, {bloom, vignette, warm, roll, dither})
                                    → bloom (2 radii) + final grade (warm highs, cool lows, hue-keeping roll-off, vignette, dither) → screen
(HUD: screen space, after the grade so it stays crisp)
```

`L.finish` defaults `{ bloom: [0.22, 0.20], vignette: 0.92, warm: 1, roll: 1, dither: 1 }`: `warm` scales the warm-high / cool-low tint, `roll` the highlight roll-off (0 = none), `dither` is 0/1. The defaults turn pure white into a warm off-white; `{ bloom: [0, 0], warm: 0, roll: 0, dither: 0 }` turns off bloom, tint, roll-off and dither, for styles that need exact palette colours. Set the grade from the reference, not from the defaults.

## 5. Sprite uniforms reference (`opts.u`, names without the `u_` prefix)

| Uniform | Default | Meaning |
|---|---|---|
| `alpha` | 1 | Overall opacity (blink/hurt flicker, fades) |
| `lod` | 0 | Mip bias: soft blur for planes away from the focus plane; match the reference's softness per plane |
| `src` | [0,0,1,1] | Sub-rect in uv (glyphs, limb halves, strip segments) |
| `grade` | [1,1,0,1] | [saturation, brightness, haze amount, contrast]: per-plane depth grading, set from the reference's measured planes |
| `haze` | warm cream | Haze colour mixed by grade.z (match the fog colour of that depth) |
| `tint` | [1,1,1,0] | rgb multiply × amount: e.g. shading a rig's far-side limbs, or pushing foreground toward silhouette |
| `rim` | 0 | [strength, dir.x, dir.y (uv), width]: warm sun-side rim from alpha; mirror dir.x for flipped sprites |
| `rimCol` | warm | Rim colour |
| `sway` | 0 | [amp (uv), spatial freq, phase, mode]. Mode 1: rooted at the bottom (plants). Mode 2: hung from the top (vines, banners, moss); with mode 2 also a small vertical ripple. Mode 3: anchored at uv.x=1 with a wave to the free end (capes, flags) |
| `lean` | [0,0] | [shift (uv of width) at the free end, 0 rooted bottom / 1 hung top]: grass pushed aside, gust lean, a vine's tip lagging its swing. Quadratic weight; rooted mode also shortens the top slightly |
| `bend` | 0 | [amp (uv of height), load u, load width, on]: sag field (catenary + local dip), used for bridges and planks under load |
| `bulge` | 0 | [centre uv, radius, amount]: local inflate (belly breathing, cheeks, swelling) |
| `fade` | [0,0] | Soft left/right edge (uv): hides strip cut ends |
| `vfade` | 0 | Ragged noisy bottom fade: roots blend into moss or ground |
| `tfade` | 0 | Soft top fade |
| `pad` (opt, not uniform) | 0 | Grows the quad by this fraction on all sides so deformed pixels are not clipped. Needed with sway, lean, bend; keep it as small as works |

Deformations are clamped in the shader; `pow()` of a negative base is NaN, so always clamp before `pow`. A NaN at a padded quad edge shows up as a hairline across the screen.

## 6. The sim contract (sim.js)

`window.SIM` (and `module.exports`) provides:

| Member | What |
|---|---|
| `DT` | 1/120 fixed step |
| `L` | Attract loop length (s) |
| `VIEW` | {W, H} view px (default 1920×1080). The canvas aspect, the scene's W/H and pack.py's README come from it |
| `HINT` | Optional controls hint shown on the page and in the pack README (fallback: the default arrows/WASD text); `HINT_TOUCH` the one on touch screens ("Tap to play") |
| `CONTROLS` | `{ move: 'x' \| 'xy' \| null, buttons: [[action, label], …], pointer }`: what input.js shows on touch screens (a floating stick for `x`/`xy`, up to 4 buttons, taps passed to the world when `pointer`) |
| `LERP` | State keys the shell interpolates between the last two steps (numbers or arrays of numbers: positions, camera, `t`). Default `['x', 'y', 'cam', 't']`. Add every moving thing whose position is a top-level key; pooled entities interpolate in the scene with `SCENE.state` vs their stored previous position when they need it |
| `VERSION` | Optional: bump it when the state's meaning changes without its shape changing, so a hot reload starts a fresh run instead of restoring an incompatible state |
| `RESULT(e, S, P)` | Optional: `{ title, lines }` for the card shown on a `win` / `gameover` event (default: "Level complete" / "Game over" + `e.score`); `P` = saved progress ("Best 12") |
| `SAVE(S, P)` | Optional: persistent progress → the object to keep (`{ best: Math.max(P.best \|\| 0, S.score), level }`), called on `win` / `gameover` / `save` events, restart, title and a hidden tab; stored in localStorage per game. Plain JSON, small |
| `PLATFORM` | `'universal'` (default) / `'desktop'` (no touch overlay, no rotate prompt, keyboard hints) / `'mobile'` (touch overlay on every screen, touch hints, fullscreen on the first tap of the packed build). From Step 0; the gates follow it |
| `FULLSCREEN` | `false` to skip the automatic fullscreen + orientation lock on the first touch in the packed build |
| `demoCheck(S)` | Optional: does the attract run hit its beats? `tune.cjs` passes on it; without it, every `S.got` ≥ 0 (no `S.got`: pass) |
| `selfCheck()` | Optional: `[failure strings]` for what the level data must satisfy after every placement pass (every spawn in open space, every enemy able to reach and attack the player, every pickup reachable). `tune.cjs` fails on any |
| `create()` | Fresh state (plain JSON-able object: sessionStorage keeps it across reloads) |
| `step(S, input)` | Advances S by DT with the input below |
| `at(t)` | Attract replay of `SCRIPT` from 0 to t, cached incrementally; returns `{...S, loop, q}`; same t gives the same state. The shell wraps it to blend `LERP` keys between the two steps around t (smooth demo and renders at any rate) |
| `spawn(worldT, P)` | Play-mode start state (`vj: true` for variable jumps, `wt0` world clock); `P` = saved progress (start at the unlocked level) |
| `respawn(S, worldT, P)` | Keeps progress (banked pickups) |
| `outOfPlay(S)` | Respawn condition |
| `scriptInput(t, S)` | The demo's input at time t (same shape as play input) |
| Level data and helpers | e.g. `SURF`, `COINS`, `TUFTS`, `yOn`, `groundBelow`, `windAt`, `gustAt`, `gusts`: the scene reads them, it never duplicates them |

Input (input.js, one record whatever the device):
- Actions: `left` (←/A, stick, d-pad), `right`, `up`, `down`, `jump` (Space, pad A, touch button), `act` (X/J/Enter, pad X), `alt` (C/K, pad B/Y); `ax`, `ay` analog −1..1 (stick or pad; keys give ±1). A tap shorter than a frame is latched until the next step, so it always reaches the sim.
- Pointer, in view px: `px`, `py`; `press` = button held; `click` = true for exactly one sim step; `slot` 1–10 (digit keys), `wheel` ±1 (wheel, pad shoulders). Any input starts play.
- Read edges in the sim (`jumpHeld && !S.prevJump`), never in the shell. Top-down movers use `inp.ax/ay` for analog speed.
- Prompts: `INPUT.glyph('jump')` gives what to print for the device used last ("Space", pad "A", the touch button's label); players remap keys in the menu (Controls), so never hard-code a key name in the HUD.

Collision (`collide.js`, for tile and box games; the side template's polyline walk lines stay as they are): build `W = COLLIDE.world({ tile, cols, rows, data, rects })` once at load (module scope, not in S), then per step `COLLIDE.carry(b, W)` and `COLLIDE.move(b, vx * DT, vy * DT, W, { corner: 6 })` (platformer) or `{ nudge: 10 }` (top-down); read `b.ground`, `b.on`, `b.hitX`, `b.hitY` to zero velocities. Moving platforms are rects whose `dx, dy` the sim sets each step; `carry` moves the rider through collision (a lift under a ceiling or into a wall stops it, never embeds it) and a jump off a moving platform adds its speed (`vx += q.dx / DT`). A box that starts inside a solid walks out instead of being shoved through, `nudge` rounds corners in all four directions, and standing still on a rect keeps `b.on`. In node (`tune.cjs`) require it: `const COLLIDE = root.COLLIDE || require('./collide.js')`.

Principles:
- **Every reaction lives in the sim:** springs, pendulums, critter FSMs, foliage, camera. The demo and play then behave the same, and `tune.cjs` can check the demo headless.
- **Events.** `S.ev` is the event bus: `{k, t, x, y, ...}` for step, jump, land (with v), collect, hurt, stomp, bounce, splash, rustle and so on. The scene derives all one-shot FX, shakes and jiggles from events with their age `GT − e.t`; the shell plays their sounds (`audio.md`) and shows the result card on `win` / `gameover`. The templates prune events older than 2 s (cap 256), so a burst of shots keeps all its FX; tools that need every event collect them as they appear (`tune.cjs` does).
- **Physics probes.** `selfCheck()` in the side template drops the hero onto every surface (standing and running both ways) and walks every plank: a new slope or stacked platform that the hero falls through or snaps off fails `tune.cjs`. Keep it and extend it per mechanic (walls, moving platforms, dash through gaps).
- **World clock.** `wt = S.wt0 + S.t` keeps the sim's wind identical to the scene's `t`. In attract mode `wt0 = loop·L`; in play mode `wt0` is the wall time at spawn.
- **Hit-stop.** `S.freeze > 0` holds the hero and camera while world reactions keep integrating.
- **Attract loop boundary.** All state resets at `loop·L`. Reactions triggered late in the loop (a critter flying off, a gust lean) must finish inside the loop, or they visibly pop at the reset. Check the timeline in `tune.cjs`.
- **Changing physics changes the demo route.** After any change, run `node live/tune.cjs`; retune `SCRIPT` times or pickup positions so pickups sit on the trajectories the sim really produces (e.g. search jump times in node). Interactive-only feel options (variable jump, apex hang, longer coyote) go behind `S.vj`, so the tuned demo stays valid.

## 7. The scene contract (scene.js)

`window.SCENE` provides:
- `programs()`: calls `L.init`, builds glyphs and sets `L.SUN`;
- `render(t)`;
- `state`: set by index.html in play mode, otherwise `null`;
- `REPEAT`: texture names that need wrap;
- `NEAREST`: texture names loaded with nearest filtering, or `true` for all (true low-res pixel art only; see `styles.md` §1 for HD pixel);
- `BOOT`: optional, the names the first frame needs; the rest stream in (§3, Streaming);
- `QA()`: the states and cycles `qa.mjs` checks (below).

W and H come from `SIM.VIEW`, never literals.

**Display size vs texture size.** Draw sprites at sizes from `window.SIZES` (`live/sizes.js`: name → [w, h] in view px), never at `texture size × k`. Hi-res sources then stay hi-res (mipmapped, smooth) while the game scale stays fixed, and regenerating an asset at another resolution doesn't change its size in the game. Write `sizes.js` from the art scale you chose (px per art pixel, or a fixed height), not by hand.

**QA hooks (read by `scripts/qa.mjs`; lib.js resets them in `beginBG`).**
- `SCENE.QA()` returns `{ states, cycles, sprites, box }` (`states` always includes `['match', state]`: the reference's composition restaged, `study.md` §4.7):
  - `states`: `[[name, simState], …]` covering **every HUD screen** (start, every toast/tip kind, low-resource warnings, pause, results/game over…) filled with **worst-case values** (longest strings, largest counts), plus every held/aimed tool in every facing at its straight-ahead **and extreme** aim angles (so anchors and stills cover the diagonals, not just the easy case);
  - `cycles`: `{ name: [simState, …] }` per walking actor and view, the same state at successive gait distances over a full cycle (and one with the tool aimed);
  - `sprites`: `{ cycleName: [texture names the actor is drawn from] }`, so the motion check isolates the actor;
  - `box(name, state)`: the actor's screen box `[x, y, w, h]`;
  - `anim` and `ramps` for everything driven by time, which stills can't show (`qa.mjs` `anim` check):
    `anim: { name: { on: [states 1/60 s apart, the effect active], off: [the same frames without it], box?, min? } }` per
    time-driven effect (weather, water, fire, drifting fog), and `ramps: { name: { ramp: [frames while a state changes],
    steady: [the same frames with it fixed], box? } }` per state that fades or ramps (weather coming in, a day clock, a
    boss phase).
- HUD: draw text with `L.label` (smooth, any script) or `L.text`; both record their boxes. Register every panel/slot/backdrop with `L.uiBox(id, x, y, w, h, pad)`. **Size panels to their content** with `L.labelW`; never hard-code a width for variable text.
- Emitters: `L.anchor(name, simXY, drawnXY, tol)` for everything shot, thrown or shone: where the sim emits it vs where the scene draws what emits it.
- **One origin function.** The sim owns where things are emitted (e.g. `SIM.hand(S)`), in the same screen-plane coordinates the scene draws in, and the rig is built so its grip lands there (shoulder height and arm length shared as constants, e.g. `SIM.RIG`). Never emit from the actor's ground point `(x, y)`: that is the feet.

Structure `render(t)`:
1. `ST = S.state || SIM.at(t)`, `GT = ST.t` (game time for events), `t` (world time for ambience).
2. **Shake and camera.**
   - Shake from recent events: amplitude by event kind, decaying fast enough to read as an impact, not a wobble (`gamefeel.md`).
   - `camX = ST.cam + shake`; `X(f) = −camX·f` is the parallax offset for depth factor f.
   - Factors rise with nearness: close to 0 for the sky, 1 for the play plane, above 1 for the foreground. Take the spread from the reference (in a video, how fast each plane scrolls; the layer plan in `study.md`), not from habit.
3. **Background bands and fog**, then god rays.
4. **Composite:** water and falls (sample the background), platforms (drop shadow + pieces, deformed by sim state), back foliage, props, critters, pickups, inked actors, front foliage, event FX.
5. Veil, motes, foreground, `finish`.
6. HUD in screen space.

Draw order is the depth order: anything that should pass in front of the actors (front grass, foreground) is drawn after them.

Asset names per base (`art/gen/<name>.png`; placeholders until generated):

| Base | Names |
|---|---|
| side | `bg_sky`, `bg_far`, `bg_mid` (parallax bands), `ground` (tiled strip, walk), `ledge` (walk), `tuft_0..2`, `coin`, `hero_body` + `hero_arm` + `hero_leg` (cut-out rig), `fg_clump` |
| top | `ground_tex` (REPEAT tile), `path` (decal), `tree_trunk` + `tree_canopy`, `rock`, `tuft_0..2`, `critter`, `hero_top`, `coin` |
| blank | `bg_sky`, `coin` |

Naming rules (prep.py, gen.py):
- `*_sheet` (and `*_raw`) are skipped by prep: sources to slice, not textures.
- Full-frame images are `bg_*` or `*_tex`: not trimmed (prep `notrim`). Only `bg_sky*` and `*_tex` get `transparent_background: false` from `gen.py prepare --alpha auto` (`generator.opaque` in ref2game.json); bands such as `bg_far` and `bg_mid` keep their see-through top.
- Walk lines (`walk`, `bottom`) are measured for names matching `prep.walk` (default `ground`, `ledge*`).

## 8. Determinism rules

- Every frame is a pure function of `t` and the sim state. No `Math.random`, no `Date`, no accumulated state in the scene. Sim hashes are integer hashes (`Math.imul`), not `fract(sin(x) · 43758)`: engines differ in sin's last bits and the multiplier turns that into different values, so a sin hash breaks the demo between Chrome, Safari and Firefox. Use `L.rnd(i, k)` for per-instance jitter. Breaking this causes flicker between renders, and the offline video stops matching the live page.
- Ambient schedules use **windows with jitter**: `k = floor(t / per)`, offset `rnd(k)·jitter`, sometimes skipped. Never use exact periods, and never reuse one period for two systems. Incommensurate periods (golden-ratio or prime ratios) keep loops from visibly repeating.
- Anything that moves on its own with a cause (sway in wind, a pendulum, a spring) belongs in the sim or in pure functions of `t` (wind field). Never integrate in the scene.

## 9. Tools

All run from the project root.
- `node <skill>/scripts/render.mjs stills 0,1.5,3 --out frames/check [--q "fx=0"]` makes offline stills. Use it for checking beats, crops and sheets.
- `node <skill>/scripts/render.mjs video --to 14 --fps 30 --jobs 4 --out frames/film.mp4` renders a video only when the user wants one; the live page is the main deliverable.
- `node <skill>/scripts/qa.mjs` renders every `SCENE.QA()` state and cycle in `?render=1` mode and fails (exit 2) on text outside its container or the screen, overlapping texts, emitters drawn more than `tol` px from where the sim emits, and walk cycles whose lower body doesn't change once frames are aligned on the upper body (a sliding sprite). It writes `frames/qa/<state>.png`, `cycle_<name>.png` (for the motion critic) and `report.json`. Mutation-tested: it catches fixed-size panels with variable text, effects emitted from the actor's ground point, and frozen limbs under a body bob.
- `node <skill>/scripts/livecheck.mjs --keys "ArrowRight:down@0, Space:press@0.9, Click:960x360@1.2" --shots 1,2 --reload --eval "SCENE.state.x"` plays the game like a user (`Move`/`Click` take view px). Exit 2 means errors, fps < `--minfps` (55) or a failed flow.
  - `--mobile`: a landscape phone (touch, DPR 3, mid tier). Touch script: `Stick:right@0`, `Stick:off@1.5`, `T.jump:press@1.8`, `T.act:down@2 / T.act:up@2.4` (real multi-touch through CDP).
  - `--flow`: Esc opens the menu and the sim must stop, Esc resumes it, a WebGL context loss must recover with the play state kept.
  - `--q low|mid|high`, `--cpu 4` (CPU slowed like a phone), `--scale k`. The JSON also reports `quality`, `touch` (overlay shown), `audio` (context state, voices, sounds played).
- `node live/tune.cjs [path]` prints the attract route events; exit 1 if `SIM.demoCheck` fails, or (without it) not all pickups are collected.
- `python3 <skill>/scripts/sheet.py out.png frames/check/*.png --crop x0,y0,x1,y1 --cols 6 --label` makes cycle sheets and frame-by-frame checks.

## 10. Performance budget

The target is 60 fps on a mid-range phone, not only on a laptop; the full doctrine and the per-project plan (`study/PERF.md`) are
in `performance.md`. In short:
- Budgets: frame p95 ≤ 16.7 ms, CPU p95 ≤ 8 ms, ≤ 250 draw calls (peak 400), ≤ 10 full-screen passes, ≤ 150 MB textures.
- Quads are cheap; full-screen passes are not. Each fog strip is a full-width pass; the god-ray pass loops 72 samples at half res; bloom runs at quarter and eighth res. Add full-screen passes only where they show.
- Numerous simple sprites go through `G.batch` (one draw call), and through an atlas when they are several names in one layer.
- The ink pass draws the group n times (default 8) before the group itself, so keep it to what needs the weighted line.
- If fps drops, measure first (`livecheck.mjs` `perf`, `?perf=1`), then cut what the eye misses least (ambient particles, extra full-screen passes) before touching the look of actors.
- Quality tiers (`performance.md` §13) already cut passes per device; a scene's own extras honour `Q` too (`L.fx(n)` for counts, `Q.shadows`, `Q.post`).

## 11. The game shell: input, settings and quality, menu, sound, lifecycle

Every game gets these from the engine files, with no game code. Don't re-implement them in the scene or the sim; configure them.
- **Motion.** The sim steps at a fixed 120 Hz; the shell draws the state between the last two steps (`SIM.LERP` keys), snaps vsync jitter to whole steps and runs at most 8 steps a frame. Movement and camera are even at 60, 90, 120 and 144 Hz; a slow device slows the game down instead of spiralling.
- **Input** (`input.js`): keyboard, mouse, touch and gamepad into one record (§6). Phones get the controls `SIM.CONTROLS` asks for, plus a ❚❚ menu button; a hidden tab or a lost focus releases every key. When a new action is added to the sim, add its button to `CONTROLS` and its key to the hint.
- **Options and quality** (`settings.js`): `SET` (saved per game) and `Q` (resolved knobs, read every frame by lib.js and the scene). The sim never reads them.
- **Menu.** Esc / ❚❚ / pad Start opens Resume, Restart, Quality, Shadows, Music, Sound effects, Screen shake, Touch controls, Controls (key remapping, saved), Fullscreen, Title. The game pauses while it is open and when the tab is hidden. A sim event `{ k: 'win' }` or `{ k: 'gameover', score }` shows a result card with Play again / Title (`SIM.RESULT` words it).
- **Sound** (`snd.js` + the game's `audio.js`): every sound comes from a sim event; music and SFX switch off from the menu and then cost nothing (`audio.md`).
- **Progress** (`SIM.SAVE`): best score, unlocked levels, kept in localStorage per game and handed to `spawn` / `RESULT`.
- **Lifecycle.** A lost WebGL context (phones in the background) reloads the page with the play state kept; a sim that throws in `step` shows the error and returns to the title instead of freezing; a restored hot-reload state that no longer fits `SIM.create()` (or `SIM.VERSION`) is dropped with a note.
- **Phone page.** Viewport and safe-area aware, no pinch / double-tap zoom / pull-to-refresh, "turn your phone" for landscape games held upright, fullscreen + orientation lock on the first touch in the packed build.
