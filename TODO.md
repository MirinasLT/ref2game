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
- ⬜ **A shared collision module** (`collide.js`, UMD, node-testable): AABB vs a tile grid and rects, walls and ceilings, corner
  correction, moving platforms that carry the rider, a top-down corner nudge. `genres.md` promises this for tile games; today
  each game writes its own.
- ⬜ Interpolate the attract demo too. `SIM.at(t)` rounds to whole steps, so the demo still judders slightly at 144 Hz.
- ⬜ Cross-browser determinism: replace the `sin` hash with an integer hash so the attract demo is bit-identical in
  Safari/Firefox.

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
- ⬜ Persistent progress: best score, unlocked levels (`SIM.SAVE` keys → localStorage).
- ⬜ A remappable controls screen and on-screen button glyphs that follow the last used device (`INPUT.device`).
- ⬜ Fit the touch layout to the HUD: register the touch buttons as `L.uiBox` so `qa.mjs` fails overlaps with HUD panels.

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
- ⬜ `L.text`: one batch on the glyph texture instead of one draw per glyph. `L.label`: reuse one canvas per slot.
- ⬜ Top-down scene: Y-sort into a reused index array (no closure per object per frame).
- ⬜ Drop shadows of atlased sprites sample at mip 4.5, wider than the 8 px atlas pad: widen the pad or clamp the lod for atlased names.
- ⬜ KTX2 / Basis texture delivery for big games (`performance.md` §9).

## Sound
- ✅ `snd.js`: procedural SFX presets, game voices (`SOUND.defs`), sample files, streamed or procedural music, voice cap and
  rate limit, a compressor. Zero cost when off or hidden.
- ✅ `audio.js` per game, mapped from sim events; `references/audio.md`.
- ⬜ A tiny procedural "jingle" helper for win / game over / level up (a note list → voices).
- ⬜ Duck the music under big events (explosion, boss roar).

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
- ⬜ A `flow` QA scenario that goes win → result card → Play again → heap and pool counts back to baseline, plus settings
  surviving a reload.
- ⬜ Port all of this to the Codex edition (`codex/`), which has diverged since the fork.
- ⬜ Migrate `2d_new_game` (its own customised engine) to the shell, or measure it with the benchmark first.
- ⬜ Real-device pass (Android mid-range, iPhone) with `?perf=1`; record the numbers in `performance.md` as reference points.
