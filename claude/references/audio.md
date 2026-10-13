# Sound and music: event-driven, switchable, nearly free

The engine (`live/snd.js`) plays sound; the game (`live/audio.js`, `window.SOUND`) decides which. Sound is half of game feel:
a jump without a sound feels floaty, a pickup without one feels unclaimed. It must also cost nothing when the player turns it
off, and almost nothing when it is on.

## Contents
1. The model: every sound is a sim event
2. Timbre from the art
3. The sound set per genre
4. Music: a streamed file or a procedural song
5. Cost: CPU and memory
6. Mixing
7. Checks

---

## 1. The model: every sound is a sim event

- The sim already emits events (`S.ev`: jump, land with `v`, collect, hit, hurt, shoot, explode, splash, dash, rustle…). The shell
  hands each new event to `SND.ev(e)`, and `SOUND.map` turns it into a sound. The sim never calls audio, so it stays pure and
  deterministic, the attract demo and play sound the same, and a hot reload never replays old sounds.
- `SOUND.map[kind]`: a name, `null` (silent), or `(e) => name | [name, { v, rate, pan }]` to scale by the event:
  landing volume by `e.v`, a rising pitch for consecutive pickups (`rate: 1 + 0.06 * streak`), a heavier hit for a bigger enemy.
- A kind missing from the map falls back to the engine defaults (jump, land, step, collect → coin, hit, hurt, shoot,
  explode, rustle, splash, power, dash → whoosh, tap → click). Every new event kind in the sim gets a line in the map,
  in the same change.
- Stereo: events with an `x` pan with their screen position (subtly, ±0.5), so off-screen-left threats are heard on the left.
- Anything that needs a sound but is not a sim event (a UI button) calls `SND.play(name)` directly; the menu already does.

## 2. Timbre from the art

Pick voices that sound like the picture looks. Write the game's voices in `SOUND.defs` (same shape as `SND.PRESETS`):
`{ w: waveform | 'noise', f: [from, to] Hz, d: s, a: attack s, v: volume, lp / hp: filter Hz, n: delay s, j: ± semitones of random detune }`.

| Art | Voices | Music |
|---|---|---|
| Pixel / chiptune | `square`, short (d ≤ 0.15), pitch sweeps, no filter | square lead, triangle bass, no pad, bpm 120–150, major/penta |
| Cosy painterly, storybook | `triangle` / `sine`, soft attack (a 0.01–0.03), lowpass 2–3 kHz | triangle lead, sine bass, saw pad lowpassed, bpm 70–95, dorian/lydian |
| Dark, gritty, horror | filtered `noise`, low sines, long tails | no lead or a sparse one, pad + bass, bpm 60–80, phrygian/minor |
| Neon, synthwave | `sawtooth` with lowpass sweeps, detune `j` | saw lead, square bass, bpm 100–120, minor |
| Cartoon, slapstick | wide pitch sweeps (f [200, 900] and back), bouncy `n`-delayed second voice | major, bpm 110–140 |

Layer two voices for weight: a tonal body plus a noise transient (`hit`, `explode` presets). Use `j` (1–3 semitones) on
anything repeated (steps, shots) so it never sounds like a machine gun of the same sample.

## 3. The sound set per genre

The minimum a slice ships with; one line in `SOUND.map` each.

| Genre | Must have |
|---|---|
| Platformer | jump, land (by speed), step (quiet), collect, hurt, death/respawn, checkpoint, enemy stomp |
| Top-down action | step, dash/roll, swing/shoot, hit (dealt), hurt (taken), enemy death, pickup |
| Shmup | shoot (quiet, detuned, rate-limited), hit, explode (by size), power-up, warning |
| Puzzle / cards | pick up, drop, valid move, invalid move, match/clear, win |
| Point-and-click / UI | tap/click, hover (very quiet), open, close, success, fail |

Plus `win` / `gameover` jingles when the game has those events (a 4–6 note `defs` entry is enough).

## 4. Music: a streamed file or a procedural song

- **A file** (the user supplies one, or names a licensed track): `song: { src: 'audio/music.mp3', v: 0.4 }`, placed in
  `live/audio/` (pack.py ships it). Loopable, 96–128 kbps MP3 or M4A (both play everywhere; Ogg does not play on older iOS).
  It is **streamed** through an `<audio>` element: a 3-minute track costs ~3 MB of buffer, not the 60 MB a decoded buffer would.
- **Procedural** (default, no file): `song: { bpm, root, scale, prog, arp, lead, bass, pad, density, v }`. A lookahead
  scheduler plays a pad chord per bar, bass on beats 1 and 3 and an arpeggio, 8 bars of A then a sparser B, deterministic.
  Tune the numbers to the mood (§2): it should sit under the game, never compete with it. Set `lead: null` for ambience only.
- No music for this game (the user said so, or the reference is silent): `song: null`; the menu then hides the Music option.
- **Never generate music with the image generator**, and never fetch tracks from the web without the user's say-so (licence).

## 5. Cost: CPU and memory

- Nothing runs until the first user gesture (browsers require one anyway); with both Music and Sound effects off, no
  `AudioContext` is created at all. Turning both off later suspends it; a hidden tab suspends it.
- Music off pauses the stream or stops the scheduler: zero decoding, zero nodes.
- SFX voices are a few native nodes each, freed when they end. At most 14 play at once and the same sound within 35 ms is
  dropped (`SND.stats().dropped`), so 50 pickups in one frame are one sound. Sample SFX (`SOUND.files`) are for what synthesis
  can't do (a voice line, a specific foley); keep each ≤ 2 s — they are decoded into memory (~350 KB per second of stereo).
- One compressor on the master bus keeps stacked sounds from clipping.

## 6. Mixing

Relative levels (`v`), loudest first: hurt / death > hit / explode > jump / collect / UI > land > steps / ambience; music
0.3–0.45 under it all. Frequent sounds are quiet and short; rare sounds can be loud and long. Steps at 0.05–0.1.
Pitch carries information: rising = good (collect streaks, power-ups), falling = bad (hurt, fail).

## 7. Checks

- `livecheck.mjs` reports `audio: { state, voices, played, dropped, music }`: after a play script that jumps and collects,
  `played` > 0 and `state` is `running`; `dropped` stays small (a large number means a sound fires every step: rate-limit it
  in the map or emit the event less often).
- With Music and Sound effects off in the menu, `state` is `suspended` (or `none` if they were off from the start).
- The interaction audit (`gamefeel.md` §7) lists, per player action, its sound next to its FX: an action without one is a gap.
