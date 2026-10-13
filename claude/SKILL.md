---
name: ref2game
description: Turn a reference (a screenshot, gameplay video, key art, concept art or mood image) into a live, playable 2D game slice that looks shipped, not like AI slop, and feels alive. Any 2D genre (platformer, top-down, isometric, shmup, puzzle, card/UI, runner…) and any style (pixel, painterly, cel/ink, flat vector, hand-drawn, watercolour, neon…). Art is AI-generated with whatever generator the user picks (Codex built-in image_gen, any image API researched and plugged in on the spot, a local tool, or manual drops). Effects, rigs, animation, wind, reactive objects, critters, game feel, camera and HUD are code in a tiny WebGL2 engine with a hot-reloading live preview. Independent critic agents check every asset, module, animation, frame and the play feel. Use this skill whenever the user wants to make a game, level, scene, prototype, vertical slice, playable demo, sprites, characters, backgrounds or an asset pack "like this", "in this style" or "from this reference", or wants to bring concept art to life as a game, even if they never say "game engine" or "asset pack". Not for 3D games.
---

# ref2game: reference → alive, playable 2D game slice

You turn a reference into a **live, playable slice** in its style. The user watches it in a browser page that reloads itself while you work. You also deliver the assets and a packed build.

There are two sources of truth:
- `art/gen/*.png`: the generated art;
- `live/*.js`: the code (effects, rigs, simulation, scene).

This folder is self-contained: scripts, engine templates, references and Playwright.

## Principles

1. **Ask, don't guess.**
   - If something is the user's call and the reference doesn't settle it, ask with `AskUserQuestion`: 2–4 short options, the recommended one first.
   - Typical questions: what game this becomes, who the player is, the scope, a style choice, an ambiguous note.
   - Group questions together. Decide technical matters yourself and state those decisions in your progress message.
2. **Visible progress in minutes.**
   - The page runs on placeholders from minute one.
   - Real art replaces them piece by piece.
   - Never leave the user long without a visible change.
3. **AI paints, code rules.**
   - Generate one piece or depth band per call, always with the reference and the verbatim style bible.
   - Code owns scale, light, haze, outline, alpha, and all motion and effects (`references/art.md`).
4. **Alive means systems, not loops.**
   - Shared forces, springs, things that react, an event bus that drives juice, a camera that travels.
   - Pick what fits this game's world (`references/gamefeel.md`, `references/effects.md`).
5. **Rigs, measured.** The bar is a finished, shipped game.
   - **Every actor gets a cut-out rig with authored poses:** the player, enemies, every NPC and every animal (`references/animation.md`).
   - **NPCs work at their station, facing it; some walk routines. Animals move their neck, ears and tail.**
   - **No action is faked by rotating, scaling or bobbing a whole sprite.**
   - **Every rig reports its joints and passes the measured checks of `qa.mjs` before anyone looks at it:** foot slide, ground, limp, stride, knee, stretch, arm phase, aim at the impact, pops, rigid-only motion, coverage (`animation.md` §14). Frame-by-frame cycle sheets and the motion critic then judge the rest.
6. **Independent critics.**
   - They run in the background on assets, modules, motion, frames and feel.
   - At most 3 rounds each (the fidelity critic's extra rounds only when the user asks, principle 8).
   - Their verdicts decide what the next iteration fixes; they never hold back the live page, the next step or a hand-back (`references/critics.md`).
7. **The user is never the first to find a defect a check could find.**
   - `qa.mjs` (automatic) runs after every change to the HUD, a rig, an emitter or the render pipeline, and before anything is shown as done: HUD text inside its panel at worst-case strings, emitted effects drawn where the sim emits them, walk cycles that really move the limbs, time-driven effects that really move and don't sweep when a state changes.
   - Critics are launched by default at the gates, without being asked, **in the background**: they never block the live page, the next step or a hand-back. Speed is the point of this skill; the automatic check is the blocking one because it takes seconds.
   - Every defect the user reports becomes a check: a QA state, an anchor or a cycle that would have caught it (Phase 4).
   - The bar is "a clip of a shipped indie game", not "works": `critics.md` §0 is the polish checklist.
8. **Fidelity to the reference is the default bar.** Unless the brief says "inspired by" or "style only" (Step 0), the game must look nearly identical to the reference, not merely "in its style" (for "inspired by" the fidelity critic judges style, palette and rendering family, not layout):
   - the same camera angle and scale, the same layout (the reference's composition is the level's first screen), the same palette, value planes and light pools, the same character and prop designs, density of actors, effects and HUD layout;
   - it is measured, not eyeballed: a `match` state in `SCENE.QA()` restages the reference's composition, and the **fidelity critic** (`critics.md` §5a) compares it with `compare.py` at the same scale, region by region;
   - the fidelity critic runs at both gates and after every visual change batch, in the background; fold its top fixes into the next pass;
   - **don't over-polish on your own.** After a pass that visibly closes the gap, show the result (live URL, the `match` frame next to the reference, axis scores, the top remaining gaps) and ask with `AskUserQuestion`: keep polishing (naming the next 2–3 fixes and roughly how long) or stop here. One fidelity pass per gate is the default; further rounds (up to 5) only when the user says to continue.
9. **Deterministic and data-first.**
   - Render is a function of time and sim state.
   - The level is data.
   - The attract demo is a scripted replay, checked headless.
10. **Performance first, for phones.** The game must hold 60 fps on a mid-range phone, so performance is architecture decided in Phase 1, not a fix at the end (`references/performance.md`).
   - Before coding the systems, write `study/PERF.md`: the max simultaneous count of every system, and per system its pool, collision broad phase, update tier, batch/atlas group and cull rule, each with its reason.
   - Fit the mechanic: a 40-object puzzle needs no pools or grids; a shmup needs all of them. The simplest structure that holds the budget wins.
   - Use what the engine does (state caching, auto-culling, render scale, `G.batch`, atlases, counters); never duplicate it.
   - Hot paths allocate nothing: pools of plain objects in `S`, grids and scratch typed arrays at module scope.
   - Measure, don't guess: `livecheck.mjs` prints `perf` (frame p50/p95, draws, texture MB); compare it with PERF.md at each gate.
   - Quality tiers (high / mid / low, `performance.md` §13) are automatic; the scene's own extras honour `Q` (`L.fx(n)`, `Q.shadows`, `Q.post`), and no gameplay cue may exist only at the high tier.
11. **A complete game on every device, from the engine.** The shell (`engine.md` §11) already gives every game smooth fixed-step motion at any refresh rate, keyboard + touch (stick and buttons) + gamepad input, a pause / options menu (quality, shadows, music, sound, shake), win / game-over cards, sound from sim events with music that costs nothing when off (`references/audio.md`), and recovery from phone lifecycle events. Configure it (`SIM.CONTROLS`, `SIM.LERP`, `SIM.HINT`, `win` / `gameover` events, `live/audio.js`); never rebuild input, the loop or the menu in game code.

The references are background knowledge, not rules: the reference and the user decide.

## Step 0: look, then ask (one or two calls)

Look at the reference and read the user's description first. For a video, run `study.py probe` and make one contact sheet. Then ask with `AskUserQuestion`, recommended option first, options written from **this** picture (what the player does in it, what it would sound like):

**Call 1 (always):**
1. **Image generator:** Codex built-in image_gen (the default when `codex` is on PATH) / an image API the user names (you research it and plug it in) / a local tool via a command template / manual (you write the prompts, the user drops the images in).
2. **Platform:** Universal: desktop + phone + gamepad (recommended) / Desktop-first / Phone-first (touch, short sessions).
3. **Fidelity:** Near-identical to the picture / Inspired by it (same style, new layout and designs) / Style only (a new world in this look).
4. **The game and the player's role**, when the picture and the description don't settle it (each option: what the player does here). When they do settle it, ask the **scope** instead: one screen / one short level / a level with a boss or finale.

**Call 2 (only for what is still open; skip it when the description answers everything):**
5. **Goal and session:** a level with an end and a win card / score attack, 1–3 min / endless or sandbox / a few puzzle levels.
6. **Failure:** soft (respawn, keep progress) / lives, then game over / instant retry.
7. **Sound:** procedural music + sound effects, both switchable (recommended) / sound effects only / my own music file (they drop it in `live/audio/`) / silent.
8. **Touch scheme** (phone or universal, only when the genre leaves it open): stick + buttons / tap to move / swipes / one button.

Decide without asking, and say so in the progress message: quality tiers and their defaults, orientation (from the reference's aspect), controls per device (from the verbs), what is saved.

Write the answers to `study/BRIEF.md` (a few lines: game, player, platform and controls, fidelity, goal / fail loop, sound, scope). Every phase, gate and critic reads it; when the user changes their mind, update it first.

All art goes through `gen.py`, which drives Codex too. Don't route generation through other image skills.

After the answer:
1. Run `gen.py check`.
2. For an API, follow `references/generators.md`:
   - research the docs into `study/GENERATOR.md`;
   - write a plugin from `provider_template.py`;
   - `--dry-run` it;
   - **ask once for a budget**;
   - run the capability probe (`generators.md` (c)).
3. Otherwise make one probe generation.

## Phase 1: setup and study

```bash
bash <skill>/scripts/setup.sh <project> --ref <reference> --genre side|top|blank
cd <project> && bash <skill>/scripts/serve.sh      # run in background; prints the LIVE: URL
```

The base is only a starting point:
- `side`: side view;
- `top`: top-down or 3/4;
- `blank`: an empty stage with pointer and keyboard input, for anything else.

Send the live URL right away.

1. **Quick study (about 5 min)** (`references/study.md`):
   - run `study.py probe` and `study.py image`;
   - write `art/style_bible.txt` (`references/styles.md`);
   - start the first batch in the background: the pieces the first frame needs most (e.g. the backdrop, the main depth bands, terrain, the hero anchor).
2. **While it runs, finish the study** (including `study/MATCH.md`: the reference decomposed into a stageable layout, `study.md` §4.7):
   - `study/STYLE.md`;
   - `study/PLAN.md`: layers, assets in generation order, effects, interactions, level data, attract beats; the **game flow** (attract → play → pause → win / game over → results → restart / title) and the **control map** per device (keys, `SIM.CONTROLS` touch layout, pad); the **sound list** (event → sound, the song's mood);
   - `study/PERF.md` (seeded by setup.sh): entity budget and the per-system decisions (`performance.md` §12). Short, but before step 3.
3. **Shape the base into this game on placeholders:**
   - the mover or interaction model;
   - pools, collision broad phase and update tiers as PERF.md decided them (`performance.md` §2, §3, §7), built in from the start;
   - collision (extend the template's `selfCheck` probes to every new surface type and mechanic);
   - sort order;
   - camera (`SIM.CAM`: follow, limits, from the level data);
   - level;
   - controls: `SIM.CONTROLS` (one touch button per action), `SIM.HINT`, `SIM.LERP` (every moving key);
   - the flow: `win` / `gameover` events where the brief has an end;
   - sound: `live/audio.js` map for every event kind, timbre and song from the art and BRIEF (`references/audio.md`);
   - attract script.

   `references/genres.md` has notes per family. Keep the engine and the sim/scene contracts (`references/engine.md`).

## Phase 2: first real frame

1. **Generate** in parallel batches in PLAN order: `gen.py batch jobs.json [--jobs N]`, run in the background.
   - A job is `{"name", "prompt", "size", "alpha"}`.
   - `prompt` is a file in `art/prompts/` or inline text.
   - Prompt scaffold: `references/art.md`.
2. **As each batch lands:**
   - `slice.py`;
   - `prep.py`;
   - put it in the scene (the page reloads);
   - start the asset critic in the background.
   - A change of texture resolution or display size lands **in the same step** as the scene code that sizes it (`SIZES`): the user is watching the live page, and oversized sprites, even briefly, read as broken.
3. **While images generate,** build the effects this reference and style need (`references/effects.md`, `references/styles.md`).
4. **Hero.** Approve the hero anchor in a real rig pose (feet under the hips, free limbs), then make its part sheet and variants (`variantfix.py`). Do the same for every actor in the animation list (`animation.md` §13), NPCs and animals included.
5. **Gate A.** `qa.mjs` passes (seconds); `livecheck.mjs` `perf` is within the PERF.md budgets (record it in PERF.md §5); for phone or universal briefs `livecheck.mjs --mobile` runs with 0 errors and the touch controls do the main verb. Launch the asset + frame + fidelity critics in the background (the fidelity critic on `frames/qa/match.png`) and send the live page and a few stills right away; keep working, and fold the critics' top fixes into the next iteration when they land.

## Phase 3: make it alive

1. **Rig every actor in the animation list** (`animation.md` §12–13): walkers plant their feet, attacks aim at the target, NPCs play work loops and routines, animals move their heads and tails. Every rig reports its joints (`L.joint`), and `SCENE.QA()` stages its cycles, loops, attacks all round and transitions. `qa.mjs` rig checks must pass (`animation.md` §14); then the cycle sheets and the motion critic.
2. **Feel.** Player feel, camera, a world that reacts, juice per event (`references/gamefeel.md`). Choose what this world has; skip what it doesn't.
3. **Attract demo.** Tune it headless: `node live/tune.cjs`.
4. **Module critic** per finished module.
5. **Gate B.**
   - `qa.mjs` passes; `livecheck.mjs` `perf` holds the PERF.md budgets in normal play **and** in a stress case at the design's max counts (record both in PERF.md §5; over budget → `performance.md` §10, ask before changing the look).
   - `livecheck.mjs --flow` passes (menu pauses and resumes, context loss recovers); for phone or universal briefs `--mobile --flow --cpu 4` too, and `--q low` keeps every cue readable; `audio.played` > 0 after a play script (every verb heard).
   - Launch the frame, fidelity, motion and game critics in the background and run the interaction audit meanwhile. Hand back without waiting; the scores follow in the next message.
   - Send the hand-back (`references/delivery.md`): the URL, what to try, what changed, known gaps.

## Phase 4: feedback loop

For each note:
1. Fix it in code, or regenerate.
2. Verify with sheets, crops and `livecheck.mjs`.
3. Send a short report with what to try, and ask whether to keep polishing or stop when the remaining gaps are minor.

- **Motion:** look frame by frame before answering.
- **Things stills don't show:** reproduce them with `livecheck.mjs --keys … --shots …`.
- **Unclear note:** ask.
- **Close the class, not just the instance.** After fixing a reported defect, add the check that would have caught it (a `SCENE.QA()` state with the worst-case string, an `L.anchor` for the emitter, a cycle for the gait), run `qa.mjs`, and look for the same defect elsewhere (every panel, every emitter, every walker). Add it to `references/pitfalls.md` when it is new, as a general rule (the class of defect and its fix), never as this project's specifics.

## Phase 5: deliver

`pack.py --name <name> --zip` builds the static playable build, textures, manifest, sources and README. Verify the build with `livecheck.mjs --url … --flow` (and `--mobile --flow`), `delivery.md`. Make a video only when asked.

## Speed

- **Parallelise:**
  - generation;
  - critics;
  - code work while images generate;
  - study subagents for videos.
- **Check with stills, crops and sheets,** not full videos.
- **At most 3 critic rounds;** report what's left.
- **Fix sources, not derived files.**
  - After a sim change, run `tune.cjs`.
  - After a scene or lib change, run `livecheck.mjs`.
- **Pitfalls:** skim `references/pitfalls.md` once per project.
- **Performance:** read `references/performance.md` once per project, before writing PERF.md.
- **Sound:** read `references/audio.md` once per project, before writing `live/audio.js`.

## References

| File | What's in it |
|---|---|
| `generators.md` | Researching and plugging in any generator; alpha strategies; consistency |
| `study.md` | Probing and measuring the reference; STYLE.md, the style bible, PLAN.md |
| `genres.md` | Notes per game family: camera, layers, sim, interactions, tiles, directional characters |
| `styles.md` | Notes per style family: prompt vocabulary, post chain, engine settings, motion and effects |
| `art.md` | What to generate vs code, prompt scaffold, slop fixes, asset classes, slicing, acceptance |
| `engine.md` | Files, live loop, gl.js/lib.js API, sim and scene contracts, asset names, tools |
| `effects.md` | Atmosphere, water, wind, particles, light, post, ambient life |
| `animation.md` | Parts, two-bone limbs, layering, poses, cycles, secondary motion, frame checks |
| `gamefeel.md` | Player feel, camera, reactive world, juice, level design, interaction audit |
| `critics.md` | Critic types (incl. the fidelity critic), briefs, rounds |
| `pitfalls.md` | Bugs that cost hours before |
| `delivery.md` | Hand-back messages and packing |
| `performance.md` | Phone-first performance: batching/atlases, pools, spatial grid, overdraw, culling/chunking, update tiers, GC, texture memory, profiling and budgets, the PERF.md plan, quality tiers and the adaptive governor |
| `audio.md` | Sound and music: events → sounds, timbre from the art, the set per genre, streamed vs procedural music, cost, mixing, checks |

## Scripts (run from the project root; `<skill>` = this folder)

| Script | Does |
|---|---|
| `setup.sh <dir> --ref <file> [--genre side\|top\|blank] [--refresh-engine]` | Dependencies, project skeleton, base template (engine shell: input, settings/quality, menu, sound), placeholder art; `--refresh-engine` updates an existing project's engine files |
| `serve.sh` | Live preview server |
| `gen.py check / one / batch / key / validate / pixel` | Generation with any provider (style bible and refs on every call, alpha, logs, parallel batches); offline alpha and pixel tools |
| `provider_template.py` | Skeleton for a new API plugin (`art/providers/<name>.py`) |
| `slice.py`, `prep.py`, `variantfix.py` | Cut sheets; turn art/gen into live/assets (`maxper` caps small sprites' texture size); make variants differ only where they changed |
| `atlas.py <atlas> names… [--glob]` | Pack textures drawn in one layer into one atlas (`live/atlas.js`); they then share one texture and one `G.batch` |
| `placeholders.py` | Stand-in art for the base's asset names |
| `sheet.py` | Contact and cycle sheets |
| `rigcut.py`, `partrig.py` | Cut-out rig from the approved drawing / from a part sheet (body, one leg, one arm, weapon) → parts + `live/rigs.js` |
| `jointr.py` | Limb half-widths at elbows and knees → round joint caps (`animation.md` §15.5) |
| `softbones.py` | Weight maps for bending one painted sprite (an animal's neck, head, tail) in the shader (`animation.md` §15.6) |
| `render.mjs stills / video` | Deterministic renders of the live page |
| `livecheck.mjs` | Headless play-test: keys, pointer (click, hold, release, wheel), touch (`--mobile`: stick, buttons, multi-touch), screenshots, errors, fps, `perf` (frame/CPU p50/p95, draw calls, texture MB, tier), audio, hot reload; `--flow` (menu pause/resume, context-loss recovery), `--q`, `--cpu`, `--scale` |
| `qa.mjs` | Automatic polish checks from `SCENE.QA()`: HUD text overflow/overlap, emitter anchors, limb motion of walk cycles (+ cycle sheets), rig checks, frozen effects and sweeps (`anim`), and the measured rig checks from the joint trace (foot slide, ground, lift, limp, stride, knee, stretch, arm phase, rigid-only motion, aim at the impact, pops, coverage) |
| `pack.py` | Static playable build and asset pack |
| `study.py`, `compare.py` | Reference analysis; reference vs render |
