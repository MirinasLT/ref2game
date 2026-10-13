# ref2game: roadmap (Claude Code edition)

Built from three audits on 2026-10-13: movement and physics, render and performance, and the skill workflow. ✅ = done and
verified (livecheck desktop + `--mobile` + `--flow` on all three templates, qa, tune, the packed build, and renders checked
pixel-identical against the old engine).

## Engine: motion and physics
- ✅ Render interpolation (`SIM.LERP`, including arrays such as a top-down camera). Vsync jitter is snapped to whole steps and a
  frame runs at most 8 steps, so movement is even at 60/90/120/144 Hz and a weak device slows down instead of spiralling.
- ✅ The loop uses the rAF timestamp; `.` advances one step (1/120 s), not two.
- ✅ Side physics:
  - landing is a crossing test between the old and new x, so a hero running onto a slope doesn't fall through it;
  - the hero keeps the surface it stands on, so a plank above the ground holds;
  - feet width (`K.HW`): no standing on air at a ledge's edge;
  - run speed is measured along the slope;
  - drop-through with ↓ + jump;
  - apex hang only during a held jump;
  - the camera comes from data (`SIM.CAM`: follow, limits, vertical platform snap);
  - level bounds come from data (`SIM.LEVEL`).
- ✅ `SIM.selfCheck()` physics probes, run by `tune.cjs`: drop onto every surface standing and running both ways, and walk
  every plank.
- ✅ Top-down:
  - the dash takes its direction from the input, not the momentum;
  - analog movement (stick / pad);
  - two push-out passes;
  - gusts computed once per step (no per-tuft allocation).
- ✅ Events are pruned by age (2 s, cap 256) instead of a 64 cap that lost FX in bursts. `tune.cjs` collects events as they
  appear.
- ✅ Blank template: press/release edges (`down` / `up` events) and an event cap.
- ✅ **A shared collision module** (`collide.js`, node-testable, `node live/collide.js` self-tests): boxes vs a tile grid and
  rects, walls and ceilings, one-way platforms and drop-through, ceiling corner correction, a top-down corner nudge, moving
  platforms that carry the rider, substeps so fast movers never tunnel.
- ✅ The attract demo is interpolated too (the shell blends `SIM.LERP` keys between the two steps around t; renders as well).
- ✅ Sim hashes are integer hashes (`Math.imul`), so a sin() difference between engines can't change the demo. Hero physics
  uses only IEEE-exact ops; wind still uses `sin`, which only moves foliage.

## Engine: input, shell and lifecycle
- ✅ `input.js`: one record from keyboard, pointer, touch (floating stick and buttons from `SIM.CONTROLS`) and gamepad.
  - Taps are latched, input is released on blur or a hidden tab, auto-repeat and Ctrl/Cmd shortcuts are filtered.
  - `alt` action, analog `ax` / `ay`, haptic tick on touch buttons.
- ✅ Shell:
  - pause when the tab is hidden;
  - WebGL context loss reloads the page with the state kept;
  - a sim that throws returns to the title instead of freezing;
  - a stale hot-reload state is dropped (schema check, `SIM.VERSION`);
  - result cards on `win` / `gameover`;
  - packed build: no dev keys.
- ✅ Phone page:
  - viewport and safe areas;
  - no zoom or pull-to-refresh;
  - a "turn your phone" overlay;
  - fullscreen and orientation lock on the first touch (packed build).
- ✅ Persistent progress: `SIM.SAVE(play, prev)` → localStorage per game, handed to `spawn` / `respawn` / `RESULT`; saved on
  win / game over / `save` events, restart, title and a hidden tab.
- ✅ Controls screen in the menu (remap any key, saved, reset to defaults) and `INPUT.glyph(action)` for prompts that follow
  the device used last (key name, pad A/X/B, the touch button's label).
- ✅ `qa.mjs` fails HUD text under the phone's touch controls (`INPUT.zones`: buttons, menu, resting stick on an 844×390 page).

## Engine: render, quality and performance
- ✅ Quality tiers high/mid/low (`settings.js`, `Q`):
  - render scale cap, bloom radii, god-ray taps, fbm octaves, ink passes, particle density (`L.fx`), drop shadows;
  - the adaptive governor (steps down once and remembers it, ignores a 30 Hz cap);
  - menu options and a `?q=` override.
- ✅ gl.js:
  - caches unchanged uniforms, bound textures and the blend mode;
  - half-float targets with an RGBA8 fallback (checked), texture downscale past `MAX_TEXTURE_SIZE`, sampler precision;
  - `G.resize` / `G.free` / `L.resize`, so the render scale re-fits on rotation and window resize.
- ✅ lib.js:
  - the `L.sprite` hot path has no garbage;
  - ray targets are RGBA8 and skip all passes when off;
  - the bloom chain is skipped when unused;
  - primitives (glow/shadow/puff/star/ring) are culled offscreen;
  - the cracks decal no longer forms a feedback loop.
- ✅ `L.text` is one instanced draw per string; `L.label` reuses one canvas per slot.
- ✅ Top-down scene: Y-sort over reused records (no closure or array per object per frame).
- ✅ Drop shadows of atlased sprites clamp the mip to 3 (the 8 px atlas pad), so neighbours never bleed in.
- ⬜ KTX2 / Basis texture delivery, only for a game whose textures exceed the phone budget (`performance.md` §9): needs the
  `basisu` encoder and a transcoder in the page; not worth it below ~150 MB of textures.

## Sound
- ✅ `snd.js`: procedural SFX presets, game voices (`SOUND.defs`), sample files, streamed or procedural music, voice cap and
  rate limit, a compressor. Zero cost when off or hidden.
- ✅ `audio.js` per game, mapped from sim events; `references/audio.md`.
- ✅ `SND.jingle(notes, opts)` and built-in `win` / `lose` jingles for the `win` / `gameover` events.
- ✅ Music ducks under big moments (`SND.DUCK`, or `{ duck }` in a map entry).

## Skill workflow
- ✅ Step 0 asks about generator, platform, fidelity and game/scope, then (only if still open) goal, failure, sound and touch
  scheme. The answers go to `study/BRIEF.md` (seeded by setup).
- ✅ PLAN.md gains the game flow, the control map per device and the sound list. Phase 1 step 3 configures controls, LERP,
  flow and sound.
- ✅ Gates:
  - Gate A: `--mobile` for phone briefs;
  - Gate B: `--flow`, `--mobile --flow --cpu 4`, `--q low`, audio played;
  - the packed build is verified with `--flow` and `--mobile --flow`.
- ✅ Critics:
  - polish checklist items 12–14 (flow, phone-ready, sound);
  - the game critic plays the phone profile and scores controls and sound;
  - the critic-blocking wording is fixed;
  - the fidelity bar follows the brief.
- ✅ `livecheck.mjs --flow`: result card → Play again restarts the run, a changed option survives the reload.
- ✅ The Codex edition has all of it: templates, engine, tools and references copied; SKILL.md, setup.sh, engine.md,
  pitfalls.md and critics.md got the same changes in Codex's own wording (no generator question; Codex asks in chat).
- ⬜ Migrate `~/2d_new_game` (its own customised engine) to the shell: the user's project, done only when they ask.
- ⬜ Real-device pass (Android mid-range, iPhone) with `?perf=1`; record the numbers in `performance.md` as reference points.

## Audit 2: engine polish, 2.5D, platform choice, AI handoff ✅

- ✅ Streaming textures: `SCENE.BOOT`, load on first use (decoded off the main thread), `G.prefetch` / `G.unload`, `G.dim` and `L.hsz` read sizes from the manifest (no GPU upload to measure), `texMB` = what is loaded.
- ✅ No per-draw garbage: scratch `G.xf`, reused `L.sprite` result and primitive uniform records, pooled depth queue, reused gust lists; templates hoist constant option records.
- ✅ Render: comp = bg unless something reads the background (one full-res copy and target less), HDR bloom with one pass less and a stable bright pass, quarter-res rays below high, soft-edged drop shadows, crisp HUD at low render scale (`G.resize(scale, out)`), pixel-art canvas `pixelated`, labels without mips, QA records only in QA renders, feedback-loop error.
- ✅ Shell: the attract demo never replays from the loop start at 144 Hz / slow motion, `S.warp` teleports are not smeared, dev line at 4 Hz, governor steps down on a vsync-missing phone, a step-down is re-tested after a week.
- ✅ Sound: no StereoPanner leak, music skips ahead after a stall, layered sounds respect the voice cap, iOS silent switch, resume errors handled.
- ✅ Collision: embedded boxes walk out, nudge in all directions, corner correction never outruns the move, carry through collision, `b.on` kept while standing still.
- ✅ Feel: separate stop / turn / overspeed rates, jump not on stick-up, input buffered through hit-stop, eased camera lead, vertical framing on falls, top-down radial accel, real velocity after collisions, dash buffer, radial gamepad deadzone, no `Math.hypot` in sims, `tune.cjs` determinism check.
- ✅ 2.5D: `L.view` / `L.at` (side, top, iso, persp), `L.dq` depth queue, `L.shadowAt`; the top-down template hops on z.
- ✅ Platform choice: `SIM.PLATFORM` = universal / desktop / mobile (Step 0), honoured by the shell and input.
- ✅ Skill: Step 0 asks view/depth and feel target when open, writes pre-production notes; `setup.sh` writes the project's `CLAUDE.md` / `AGENTS.md` map (files, where new things go, rules) from `templates/GAME.md`.
- Next, only when a game needs it: fog into a quarter-res target, one-pass ink outline (dilation) for many inked actors, `L.M` out-parameter matrices for heavy rigs.
