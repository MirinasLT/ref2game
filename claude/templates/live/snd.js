// live/snd.js — the sound engine (engine file, refreshed by setup.sh --refresh-engine). The game's sound design lives in
// live/audio.js as window.SOUND (references/audio.md). Three sources:
//   procedural SFX: tiny oscillator / noise voices with pitch and filter sweeps (no files, no memory);
//   sample SFX: short files from SOUND.files, decoded once;
//   music: a file streamed through an <audio> element (never decoded into RAM) or a procedural song (a lookahead note
//   scheduler, a few oscillators per beat).
// Cost when off is zero: no AudioContext exists until the first gesture with music or sound on; both off (or the tab
// hidden) suspends it; music off pauses the stream / stops the scheduler. Voices are capped (MAXV) and the same sound
// within GAP s is dropped, so 50 pickups in one frame are one sound, not 50.
// Not part of the deterministic render: renders and QA never create audio.
(function () {
  const A = (window.SND = { played: 0, dropped: 0 });
  const MAXV = 14, GAP = 0.035, last = {}, bufs = {};
  let ctx = null, out, sfxG, musG, noiseBuf, el = null, seq = null, live = 0;
  const set = () => window.SET || { music: true, sfx: true, vol: 0.8 };
  const D = () => window.SOUND || {};
  const h = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

  // voice = { w: 'sine'|'square'|'triangle'|'sawtooth'|'noise', f: [from, to] Hz (noise: lowpass sweep), d: s, a: attack s,
  //           v: volume, lp / hp: fixed filter Hz, n: delay s, j: random detune ± semitones }. A sound = a voice or an array.
  A.PRESETS = {
    jump: { w: 'square', f: [260, 640], d: 0.13, v: 0.12, lp: 2600 },
    land: { w: 'noise', f: [1100, 160], d: 0.13, v: 0.32 },
    step: { w: 'noise', f: [2200, 700], d: 0.045, v: 0.07, j: 3 },
    coin: [{ w: 'square', f: [988, 988], d: 0.07, v: 0.09, lp: 5000 }, { w: 'square', f: [1319, 1319], d: 0.18, v: 0.09, n: 0.07, lp: 5000 }],
    hit: [{ w: 'sawtooth', f: [320, 70], d: 0.18, v: 0.2, lp: 2000 }, { w: 'noise', f: [3200, 300], d: 0.1, v: 0.25 }],
    hurt: { w: 'square', f: [440, 110], d: 0.3, v: 0.14, lp: 1600 },
    shoot: { w: 'square', f: [900, 170], d: 0.09, v: 0.1, lp: 3800, j: 1 },
    explode: [{ w: 'noise', f: [1400, 50], d: 0.65, v: 0.45 }, { w: 'sine', f: [130, 38], d: 0.5, v: 0.4 }],
    power: { w: 'triangle', f: [330, 1320], d: 0.42, v: 0.16 },
    click: { w: 'triangle', f: [1500, 900], d: 0.035, v: 0.1 },
    whoosh: { w: 'noise', f: [350, 2600], d: 0.24, v: 0.16 },
    rustle: { w: 'noise', f: [5200, 2400], d: 0.2, v: 0.05, hp: 1400, j: 2 },
    splash: [{ w: 'noise', f: [4000, 500], d: 0.35, v: 0.2 }, { w: 'sine', f: [500, 180], d: 0.12, v: 0.08 }],
  };

  const noise = () => { if (noiseBuf) return noiseBuf; const n = ctx.sampleRate; noiseBuf = ctx.createBuffer(1, n, n);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = h(i * 0.37) * 2 - 1; return noiseBuf; };
  const filt = (type, hz, t) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(hz, t); return f; };
  // one voice into dest at time t0; o: { v, rate, seed }
  const voice = (vd, dest, t0, o) => {
    const r = (o.rate || 1) * (vd.j ? 2 ** ((h((o.seed || 0) + t0 * 7.1) * 2 - 1) * vd.j / 12) : 1);
    const st = t0 + (vd.n || 0), end = st + vd.d, peak = Math.max(0.0002, (vd.v ?? 0.3) * (o.v ?? 1));
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(peak, st + (vd.a || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, end);
    let src, node;
    if (vd.w === 'noise') { src = ctx.createBufferSource(); src.buffer = noise(); src.loop = true;
      node = filt('lowpass', vd.f[0] * r, st); node.frequency.exponentialRampToValueAtTime(vd.f[1] * r, end); src.connect(node); }
    else { src = ctx.createOscillator(); src.type = vd.w; src.frequency.setValueAtTime(vd.f[0] * r, st);
      if (vd.f[1] !== vd.f[0]) src.frequency.exponentialRampToValueAtTime(vd.f[1] * r, end); node = src; }
    if (vd.lp) { const f = filt('lowpass', vd.lp, st); node.connect(f); node = f; }
    if (vd.hp) { const f = filt('highpass', vd.hp, st); node.connect(f); node = f; }
    node.connect(g); g.connect(dest);
    src.start(st, vd.w === 'noise' ? h(t0) * 0.8 : 0); src.stop(end + 0.03);
    if (o.music) src.onended = () => g.disconnect();                   // music notes don't take SFX voice slots
    else { live++; src.onended = () => { live--; g.disconnect(); }; }
  };

  // play(name, { v: volume 0..1, rate: pitch multiplier, pan: -1..1 }): a SOUND.files sample, a SOUND.defs or preset voice set
  A.play = (name, o = {}) => {
    if (!ctx || ctx.state !== 'running' || !set().sfx) return;
    const now = ctx.currentTime;
    if (now - (last[name] ?? -1) < GAP || live >= MAXV) { A.dropped++; return; }
    last[name] = now; A.played++;
    let dest = sfxG;
    if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); p.connect(sfxG); dest = p; }
    if (bufs[name]) { const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = bufs[name]; s.playbackRate.value = o.rate || 1;
      g.gain.value = o.v ?? 1; s.connect(g); g.connect(dest); s.start(now); live++; s.onended = () => { live--; g.disconnect(); }; return; }
    const def = (D().defs || {})[name] || A.PRESETS[name]; if (!def) return;
    for (const vd of [].concat(def)) voice(vd, dest, now, o);
  };

  // ev(e, camX): a sim event → its sound via SOUND.map (kind → name | (e) => name | [name, opts] | null), else DEFMAP; panned by screen x
  const DEFMAP = { jump: 'jump', land: (e) => ['land', { v: Math.min(1, (e.v || 900) / 1300) }], step: 'step', collect: 'coin',
    hit: 'hit', hurt: 'hurt', shoot: 'shoot', explode: 'explode', rustle: 'rustle', splash: 'splash', power: 'power', dash: 'whoosh', tap: 'click' };
  A.ev = (e, camX = 0) => {
    if (!ctx) return;
    const gm = D().map || {}, m = e.k in gm ? gm[e.k] : DEFMAP[e.k];               // the game's map first (null = silent), then defaults
    let r = typeof m === 'function' ? m(e) : m; if (!r) return;
    if (typeof r === 'string') r = [r, {}];
    const W = (window.SIM && SIM.VIEW && SIM.VIEW.W) || 1920, o = Object.assign({ seed: e.t }, r[1]);
    if (e.x !== undefined && o.pan === undefined) o.pan = ((e.x - camX) / W * 2 - 1) * 0.5;
    A.play(r[0], o);
  };

  // ---------------- music ----------------
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11], penta: [0, 2, 4, 7, 9], minpenta: [0, 3, 5, 7, 10], phrygian: [0, 1, 3, 5, 7, 8, 10] };
  const MUS = { music: 1 };
  const tone = (w, midi, t, d, v, a, lp) => voice({ w, f: [440 * 2 ** ((midi - 69) / 12), 440 * 2 ** ((midi - 69) / 12)], d, v, a, lp }, musG, t, MUS);
  // song: { bpm, root (MIDI), scale, prog: chord roots as scale degrees per bar, arp: 8 degrees per bar (null = rest),
  //         lead, bass, pad: waveforms (null = no part), density 0..1 } — 8 bars of A, then a sparser B, deterministic
  const startSeq = (sg) => {
    const sc = typeof sg.scale === 'string' ? SCALES[sg.scale] || SCALES.minor : sg.scale || SCALES.minor;
    const root = sg.root ?? 57, prog = sg.prog || [0, 5, 3, 4], arp = sg.arp || [0, 2, 4, 7, 4, 2, 0, null];
    const sp = 60 / (sg.bpm || 90) / 2, den = sg.density ?? 0.85;
    const deg = (d, oct) => { const n = sc.length, i = ((d % n) + n) % n; return root + 12 * (oct + Math.floor(d / n)) + sc[i]; };
    const S = { k: 0, next: ctx.currentTime + 0.12 };
    const tick = () => { while (S.next < ctx.currentTime + 0.3) {
      const bar = Math.floor(S.k / 8), i = S.k % 8, ch = prog[bar % prog.length], B = Math.floor(bar / 8) % 2 === 1, t = S.next;
      if (i === 0 && sg.pad !== null) for (const d of [0, 2, 4]) tone(sg.pad || 'sawtooth', deg(ch + d, 0), t, sp * 8.4, 0.035, sp * 2, 900);
      if (i % 4 === 0 && sg.bass !== null) tone(sg.bass || 'sine', deg(ch, -1), t, sp * 3.6, 0.16, 0.01, 600);
      const a = arp[i]; if (a !== null && a !== undefined && sg.lead !== null && h(S.k * 1.7 + (sg.seed || 0)) < (B ? den * 0.5 : den))
        tone(sg.lead || 'triangle', deg(ch + a + (B && i === 7 ? 2 : 0), 1), t, sp * 0.9, 0.06, 0.008, 3200);
      S.k++; S.next += sp; } };
    tick(); S.id = setInterval(tick, 100); return S;
  };
  const music = () => {
    const sg = D().song; if (!ctx || !sg) return;
    const want = set().music && !document.hidden && ctx.state !== 'closed';
    if (sg.src) { if (!el && want) { el = new Audio(sg.src); el.loop = true; el.preload = 'auto'; ctx.createMediaElementSource(el).connect(musG); }
      if (el) { if (want) el.play().catch(() => {}); else el.pause(); } return; }
    if (want && !seq) seq = startSeq(sg); else if (!want && seq) { clearInterval(seq.id); seq = null; }
  };

  // apply(): settings or visibility changed → gains, suspend/resume, music on/off
  A.apply = () => {
    if (!ctx) return; const s = set(), sg = D().song || {};
    out.gain.value = s.vol ?? 0.8; sfxG.gain.value = s.sfx ? 1 : 0; musG.gain.value = s.music ? sg.v ?? 0.45 : 0;
    if ((!s.sfx && !s.music) || document.hidden) ctx.suspend(); else ctx.resume();
    music();
  };
  // unlock(): call from every user gesture (cheap after the first). Creates the context only when sound or music is on.
  A.unlock = () => {
    // not just 'suspended': iOS leaves the context 'interrupted' after a call, Siri or a lock
    if (ctx) { if (ctx.state !== 'running' && ctx.state !== 'closed' && !document.hidden && (set().sfx || set().music)) { ctx.resume(); music(); } return; }
    const s = set(), AC = window.AudioContext || window.webkitAudioContext; if ((!s.sfx && !s.music) || !AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    out = ctx.createGain(); const comp = ctx.createDynamicsCompressor(); out.connect(comp); comp.connect(ctx.destination);
    sfxG = ctx.createGain(); musG = ctx.createGain(); sfxG.connect(out); musG.connect(out);
    for (const [n, url] of Object.entries(D().files || {}))
      fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).then((b) => { bufs[n] = b; }).catch((e) => console.warn('sound', n, e.message));
    A.apply();
  };
  A.stats = () => ({ state: ctx ? ctx.state : 'none', voices: live, played: A.played, dropped: A.dropped,
    music: el ? !el.paused : !!seq });
  document.addEventListener('visibilitychange', () => A.apply());
})();
