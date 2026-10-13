// live/audio.js — THIS game's sound design (the engine is snd.js; references/audio.md). Every sound comes from a sim event
// (S.ev), so the attract demo, play, hot reload and replays stay in sync and the sim stays silent and deterministic.
//   map:   event kind → sound name | (e) => name | [name, { v: volume 0..1, rate: pitch ×, pan: −1..1 }] | null
//   defs:  this game's own voices (same shape as SND.PRESETS: { w, f: [from, to], d, a, v, lp, hp, n, j }); a name here wins
//   files: short sample SFX, { name: 'audio/name.mp3' } (≤ 2 s each, decoded once; prefer procedural voices)
//   song:  { src: 'audio/music.mp3' } streams a file (loopable, 96–128 kbps, never decoded into RAM), or a procedural song:
//          { bpm, root (MIDI note), scale: major|minor|dorian|lydian|phrygian|penta|minpenta, prog: chord degrees per bar,
//            arp: 8 degrees per bar (null = rest), lead / bass / pad: waveform or null, density 0..1, v: music volume }
// Timbre follows the art (audio.md §2): soft triangle/sine for cosy painterly, square/pulse for pixel, filtered noise for gritty.
window.SOUND = {
  map: {
    jump: 'jump',
    land: (e) => ['land', { v: Math.min(1, (e.v || 900) / 1300) }],
    step: (e) => ['step', { v: 0.8 }],
    collect: (e) => ['coin', { rate: 1 + 0.06 * ((e.i || 0) % 5) }],          // a rising run of pickups reads as progress
    rustle: 'rustle',
  },
  defs: {},
  files: {},
  song: { bpm: 84, root: 57, scale: 'dorian', prog: [0, 5, 3, 4], arp: [0, 2, 4, 7, 4, 2, 0, null],
    lead: 'triangle', bass: 'sine', pad: 'sawtooth', density: 0.8, v: 0.4 },
};
