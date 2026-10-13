// live/sim.js — deterministic game simulation (fixed 120 Hz steps). Pure data, no drawing, no Math.random, no Date.
// SIM.at(t) replays the attract-mode input script from 0 → t (looping every SIM.L s) and returns the state (cached);
// SIM.spawn(worldT) + SIM.step(S, input) drive interactive play in the browser (index.html).
// Every reaction (critters, foliage, props, camera) lives HERE, so the attract demo and play mode behave identically.
// Template: a side-view platformer. For another genre keep the shape (create/step/at/spawn/ev) and swap the mover.
(function (root) {
  const DT = 1 / 120, L = 8.0;                              // attract loop length (s)
  // feel numbers (px, s): Celeste-like timings, scaled to a ~1920x1080 view
  // HW: half the hero's foot width — it stands on a ledge until its feet, not its centre, leave it (no hanging in the air)
  // ACC: speeding up · DEC: stopping (no input) · TURN: × on reversing (snappy turns) · OVER: bleeding speed above RUN (a spring
  // or knockback launch keeps its momentum instead of dying in 0.2 s)
  const K = { G: 2600, GF: 3000, MAXF: 1500, RUN: 380, ACC_G: 2600, ACC_A: 1700, DEC_G: 3400, DEC_A: 1400, TURN: 1.6, OVER: 900,
    JUMP: 900, COYOTE: 0.10, BUFFER: 0.12, CUT: 330, APEX: 150, HW: 18, DROP: 0.25 };
  const VIEW = { W: 1920, H: 1080 };
  // the level's extent (out of play beyond it) and the camera: follow = share of the hero's offset the camera takes (0.12 = a
  // one-screen slice that drifts; 1 = a scrolling level), x0..x1 = camera limits = what the art covers; fy: vertical follow of
  // the ground the hero last stood on (platform snap: jumps don't move it), y0..y1 its limits
  const LEVEL = { x0: -200, x1: 2200, y1: VIEW.H + 200 };
  const CAM = { follow: 0.12, lead: 140, x0: -40, x1: 160, fy: 0, y0: -200, y1: 0, base: 860 };
  const CONTROLS = { move: 'x', buttons: [['jump', 'A']], pointer: false };    // touch layout (input.js): add a button per new action
  const HINT = 'Arrows / WASD move · Space jump · ↓+Space drop through · Esc menu';

  // ---------------- the level, as data ----------------
  // one-way walk lines: polylines of [x, feetY]; the feet y between points is linear (slopes are free)
  const SURF = [
    { id: 'ground', pts: [[-400, 860], [2400, 860]] },
    { id: 'ledgeA', pts: [[620, 740], [960, 740]] },
    { id: 'ledgeB', pts: [[1080, 620], [1420, 600]] },
  ];
  // feet y of surface s at x; pad > 0 extends the ends flat by pad px (the feet still overlap the end of a ledge)
  const yOn = (s, x, pad = 0) => { const p = s.pts, n = p.length - 1;
    if (pad && x < p[0][0] && x >= p[0][0] - pad) return p[0][1]; if (pad && x > p[n][0] && x <= p[n][0] + pad) return p[n][1];
    for (let i = 0; i < n; i++) if (x >= p[i][0] && x <= p[i + 1][0]) {
    const u = (x - p[i][0]) / (p[i + 1][0] - p[i][0] || 1); return p[i][1] + (p[i + 1][1] - p[i][1]) * u; } return null; };
  // the surface to keep walking on: the one stood on if it is still there, else the nearest within tol (stacked planks don't
  // snap the hero to the ground below)
  // returns one reused record (read it at once): no allocation per step
  const SA = { s: null, y: 0 };
  const surfAt = (x, y, tol, cur) => { let bs = null, by = 0;
    for (const s of SURF) { const sy = yOn(s, x, K.HW); if (sy === null || Math.abs(sy - y) > tol) continue;
      if (s.id === cur) { bs = s; by = sy; break; }
      if (!bs || Math.abs(sy - y) < Math.abs(by - y)) { bs = s; by = sy; } }
    if (!bs) return null; SA.s = bs; SA.y = by; return SA; };
  const SURF_ID = {}; for (const s of SURF) SURF_ID[s.id] = s;
  const groundBelow = (x, y) => { let best = null; for (const s of SURF) { const sy = yOn(s, x); if (sy !== null && sy >= y - 4 && (best === null || sy < best)) best = sy; } return best; };
  // collectibles: breadcrumbs that trace the intended jump arcs (they ARE the tutorial)
  const COINS = [[570, 680], [608, 641], [643, 628], [1020, 595], [1061, 540], [1099, 516], [1327, 382], [1422, 445]];
  // grass tufts: [x, kind (index into scene's TUFT names), height, in front of the actors (1) or behind (0)]
  const TUFTS = [[300, 0, 90, 0], [360, 1, 50, 1], [700, 2, 70, 0], [1100, 0, 96, 0], [1150, 1, 52, 1], [1700, 2, 84, 0], [1760, 1, 50, 1]];
  const TUFT_Y = TUFTS.map(([tx]) => groundBelow(tx, 0) ?? 860);           // the ground under each tuft (static: computed once)
  // attract script: [time, key, down] — tune with `node live/tune.cjs`
  const SCRIPT = [[0, 'right', 1], [1.5, 'jump', 1], [1.8, 'jump', 0], [2.74, 'jump', 1], [3.04, 'jump', 0], [3.34, 'jump', 1], [3.64, 'jump', 0]];

  // ---------------- one wind field for the whole world ----------------
  // base breeze + gust fronts crossing left → right (~every 14 s, jittered). Foliage, props, particles and water all sample it.
  // integer hash → [0, 1): bit-identical in every JS engine (a sin() hash is not: engines differ in sin's last bits and ×43758 amplifies them)
  const h1 = (n) => { let x = Math.imul(Math.round(n * 1024) | 0, 0x9e3779b1); x ^= x >>> 15; x = Math.imul(x, 0x85ebca77); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae3d); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
  const GUST = 14, GUST_V = 360;
  // the active fronts, in one reused list (read it at once; the next call overwrites it): no garbage per step or per gustAt
  const GB = [{ k: 0, t0: 0, front: 0, amp: 0 }, { k: 0, t0: 0, front: 0, amp: 0 }], GL = [];
  const gusts = (t) => { const k = Math.floor(t / GUST); GL.length = 0;
    for (let kk = k - 1; kk <= k; kk++) { const t0 = kk * GUST + 2 + 6 * h1(kk); if (t < t0) continue;
      const front = -500 + GUST_V * (t - t0); if (front < VIEW.W + 1000) { const o = GB[GL.length]; o.k = kk; o.t0 = t0; o.front = front; o.amp = 0.8 + 0.7 * h1(kk + 0.5); GL.push(o); } }
    return GL; };
  const gustAt = (t, x, gl = gusts(t)) => { let g = 0; for (const q of gl) { const d = x - q.front; g += q.amp * Math.exp(-((d / (d > 0 ? 140 : 420)) ** 2)); } return g; };
  const windAt = (t, x, gl) => 0.25 * Math.sin(0.6 * t + 0.013 * x) + 0.12 * Math.sin(1.7 * t + 0.031 * x + 1.3) + gustAt(t, x, gl);
  const ss = (e0, e1, x) => { const q = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return q * q * (3 - 2 * q); };

  function create() {
    return { t: 0, steps: 0, wt0: 0, vj: false,            // wt0: world-clock offset (wind matches the scene's t); vj: variable jump (play)
      x: -60, y: 860, vx: K.RUN, vy: 0, ground: 'ground', face: 1, dist: 0, coyote: 0, buf: 0, prevJump: 0, cut: false,
      landT: -9, landV: 0, jumpT: -9, hurtT: -9, hearts: 3, freeze: 0, bank: 0, dropT: -9, dropId: null, gy: 860,
      capeTh: -6, capeOm: 0, cam: 0, camV: 0, camY: 0, camYV: 0, lead: CAM.lead, warp: 0, ev: [],
      got: COINS.map(() => -1),                            // -1 available, ≥0 collect time, -2 collected in an earlier life
      tf: TUFTS.map(() => [0, 0, -9]) };                   // tuft lean px, lean velocity, last rustle time
  }
  const spawn = (worldT) => Object.assign(create(), { x: 120, vx: 0, vj: true, wt0: worldT, cam: -20 });
  const outOfPlay = (S) => S.x > LEVEL.x1 || S.x < LEVEL.x0 || S.y > LEVEL.y1;
  // respawn keeps progress: collected pickups are banked and stay gone (-2) until all are taken, then everything returns
  const respawn = (S, worldT) => { const bank = (S.bank || 0) + S.got.filter((g) => g >= 0).length, all = !S.got.includes(-1);
    return Object.assign(spawn(worldT), { bank, got: all ? S.got.map(() => -1) : S.got.map((g) => (g === -1 ? -1 : -2)) }); };

  function step(S, inp) {
    const t = S.t + DT, wt = S.wt0 + t, gl = gusts(wt);                     // gust fronts once per step, shared by every tuft
    // ---- world reactions integrate every step (also during hit-stop) ----
    const landed = S.landT === S.t;
    for (let i = 0; i < TUFTS.length; i++) {
      const tx = TUFTS[i][0], th = TUFTS[i][2], f = S.tf[i], ty = TUFT_Y[i]; let tg = 12 * windAt(wt, tx, gl) * th / 100, wh = 0;
      const up = ty - S.y;                                                    // the hero's push: lean away, harder the closer
      if (up >= -20 && up <= th * 0.85) { const dx = tx - S.x; wh = ss(78, 78 * 0.15, Math.abs(dx)); tg += (Math.sign(dx || 1) * 0.30 * th + S.vx * 0.012) * wh; }
      if (landed && wh > 0) f[1] += Math.sign(tx - S.x || 1) * Math.min(900, S.landV) * 0.35 * th / 100;
      if (wh > 0.6 && Math.abs(S.vx) > 120 && t - f[2] > 0.5) { f[2] = t; S.ev.push({ k: 'rustle', t, x: tx, y: ty - th * 0.55, i, d: Math.sign(S.vx) }); }
      f[1] += (355 * (tg - f[0]) - 11 * f[1]) * DT; f[0] += f[1] * DT;           // spring f≈3 Hz, ζ≈0.3
    }
    // ---- input (read before hit-stop: a jump pressed during the freeze is buffered, not lost) ----
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (dir) S.face = dir;
    const jumpHeld = !!inp.jump, jumpEdge = jumpHeld && !S.prevJump; S.prevJump = jumpHeld;   // not `up`: a diagonal stick push never jumps
    S.buf = jumpEdge ? (S.vj ? K.BUFFER : 0.10) : S.freeze > 0 ? S.buf : Math.max(0, S.buf - DT);
    if (S.freeze > 0) { S.freeze -= DT; S.t = t; S.steps++; return S; }       // hit-stop: hero + camera hold, world keeps moving
    // ---- drop through a one-way ledge: down + jump (never through the ground) ----
    if (S.ground && S.ground !== 'ground' && inp.down && jumpEdge) { S.dropId = S.ground; S.dropT = t; S.ground = null; S.buf = 0; S.coyote = 0; S.ev.push({ k: 'drop', t, x: S.x, y: S.y }); }
    // ---- horizontal ----
    const g0 = !!S.ground, sv = Math.sign(S.vx), target = dir * K.RUN;
    let acc = g0 ? K.ACC_G : K.ACC_A;
    if (!dir) acc = g0 ? K.DEC_G : K.DEC_A;
    else if (sv && sv !== dir) acc *= K.TURN;
    else if (Math.abs(S.vx) > K.RUN) acc = K.OVER;
    S.vx = S.vx < target ? Math.min(target, S.vx + acc * DT) : Math.max(target, S.vx - acc * DT);
    const py = S.y, px = S.x;
    if (S.ground) {
      const gs = SURF_ID[S.ground], sl = gs ? ((yOn(gs, S.x + 2, K.HW) ?? S.y) - (yOn(gs, S.x - 2, K.HW) ?? S.y)) / 4 : 0;
      S.x += S.vx * DT / Math.sqrt(1 + sl * sl);                            // run speed measured along the slope
      const g = surfAt(S.x, S.y, 30, S.ground);
      if (g) { S.y = g.y; S.ground = g.s.id; S.gy = g.y; S.coyote = S.vj ? K.COYOTE : 0.08; } else S.ground = null;
      if (S.ground && Math.abs(S.vx) > 20) { const b = Math.floor(S.dist / 75); S.dist += Math.abs(S.vx) * DT;
        if (Math.floor(S.dist / 75) !== b) S.ev.push({ k: 'step', t, x: S.x, y: S.y }); }
    } else {
      S.coyote = Math.max(0, S.coyote - DT);
      if (S.vj && S.cut && !jumpHeld && S.vy < -K.CUT) { S.vy = -K.CUT; S.cut = false; }           // short hop on early release
      const apex = S.vj && S.cut && jumpHeld && Math.abs(S.vy) < K.APEX ? 0.5 : 1;               // floaty apex: only in a held jump
      S.vy = Math.min(K.MAXF, S.vy + (S.vy > 0 ? K.GF : K.G) * apex * DT);
      S.x += S.vx * DT; S.y += S.vy * DT;
      // landing = the feet crossed a surface during this step: above it at the old x, at/below it at the new x (a slope rising
      // under a running hero is caught too); of several, the first crossed (the highest). A dropped-through ledge is skipped briefly.
      if (S.vy > 0) { let hit = null, hy = 0;
        for (const s of SURF) { if (s.id === S.dropId && t - S.dropT < K.DROP) continue;
          const sy = yOn(s, S.x, K.HW); if (sy === null) continue; const sy0 = yOn(s, px, K.HW) ?? sy;
          if (py <= sy0 + 1 && S.y >= sy && (!hit || sy < hy)) { hit = s; hy = sy; } }
        if (hit) { S.landV = S.vy; S.y = hy; S.vy = 0; S.ground = hit.id; S.gy = hy; S.landT = t; S.cut = false; S.ev.push({ k: 'land', t, x: S.x, y: hy, v: S.landV }); } }
    }
    // ---- jump (buffered, coyote) ----
    if (S.buf > 0 && (S.ground || S.coyote > 0)) { S.vy = -K.JUMP; S.ground = null; S.coyote = 0; S.buf = 0; S.jumpT = t; S.cut = true; S.ev.push({ k: 'jump', t, x: S.x, y: S.y }); }
    // ---- collectibles ----
    for (let i = 0; i < COINS.length; i++) { if (S.got[i] !== -1) continue; const cx = COINS[i][0], cy = COINS[i][1], dx = cx - S.x, dy = cy - (S.y - 80);
      if (dx * dx + dy * dy < 62 * 62) { S.got[i] = t; S.ev.push({ k: 'collect', t, x: cx, y: cy, i }); } }   // no Math.hypot: its last bits differ between engines
    // ---- cape / hair / ears: damped spring toward a velocity-driven angle (follow-through) ----
    const ct = Math.max(-32, Math.min(38, S.vy * 0.03)) - 6 + (S.ground ? Math.max(-14, Math.min(14, -Math.abs(S.vx) * 0.03)) : 0);
    S.capeOm += (170 * (ct - S.capeTh) - 15 * S.capeOm) * DT; S.capeTh += S.capeOm * DT;
    // ---- camera: critically damped follow with forward focus (asymmetric clamp keeps framing art on screen) ----
    S.lead += (S.face * CAM.lead - S.lead) * Math.min(1, 3 * DT);                // the look-ahead eases across on a turn, never jumps
    const ctg = Math.max(CAM.x0, Math.min(CAM.x1, (S.x + S.lead - VIEW.W / 2) * CAM.follow));
    S.camV += (36 * (ctg - S.cam) - 12 * S.camV) * DT; S.cam += S.camV * DT;
    let cty = (S.gy - CAM.base) * CAM.fy;
    if (CAM.fy) cty = Math.max(S.y - 0.85 * VIEW.H, Math.min(S.y - 0.2 * VIEW.H, cty));   // a long fall or a high jump never leaves the screen
    cty = Math.max(CAM.y0, Math.min(CAM.y1, cty));
    S.camYV += (20 * (cty - S.camY) - 9 * S.camYV) * DT; S.camY += S.camYV * DT;
    pruneEv(S, t);
    S.t = t; S.steps++;
    return S;
  }

  // events live ~2 s (long enough for any FX that reads their age), never more than 256: a burst of 100 shots keeps its FX
  const pruneEv = (S, t) => { const e = S.ev; let i = 0; while (i < e.length && t - e[i].t > 2) i++; if (e.length - i > 256) i = e.length - 256; if (i) e.splice(0, i); };
  const scriptInput = (t) => { const inp = { right: 0, left: 0, jump: 0 }; for (const [ts, k, d] of SCRIPT) if (ts <= t + 1e-9) inp[k] = d; return inp; };
  let cache = null;
  // pure function of t (cached incrementally). The result shares its arrays with the cache: read it, never keep or mutate it.
  function at(t) {
    const loop = Math.floor(t / L), q = t - loop * L, n = Math.round(q / DT);
    if (!cache || cache.loop !== loop || cache.S.steps > n) cache = { loop, S: Object.assign(create(), { wt0: loop * L }) };
    const S = cache.S; while (S.steps < n) step(S, scriptInput(S.t));
    return Object.assign({}, S, { loop, q });
  }
  // selfCheck (tune.cjs runs it after every sim change): physics probes against THIS level's data, so a new slope, plank or
  // gap that breaks landing or walking fails headless instead of in the user's hands
  const selfCheck = () => { const out = [];
    for (const s of SURF) { const x0 = s.pts[0][0], x1 = s.pts[s.pts.length - 1][0];
      for (let k = 1; k < 8; k++) { const x = x0 + (x1 - x0) * k / 8, sy = yOn(s, x);
        if (SURF.some((o) => o !== s && (yOn(o, x) ?? -1e9) < sy && (yOn(o, x) ?? -1e9) > sy - 200)) continue;   // another surface just above
        for (const vx of [-K.RUN, 0, K.RUN]) {                    // drop onto it standing and running both ways: never through it
          const S = Object.assign(create(), { x, y: sy - 160, vx, vy: 0, ground: null, vj: true });
          for (let i = 0; i < 90 && !S.ground; i++) step(S, { right: vx > 0 ? 1 : 0, left: vx < 0 ? 1 : 0 });
          const ny = yOn(s, S.x); if (ny !== null && S.y > ny + 2) out.push(`fell through ${s.id} at x=${x | 0} running ${vx}`); }
        if (s.id !== 'ground') {                                // walk along it: stays on it while over it (no snap to a surface below)
          const S = Object.assign(create(), { x, y: sy, vx: K.RUN, ground: s.id, vj: true });
          for (let i = 0; i < 20; i++) { step(S, { right: 1 }); if (yOn(s, S.x) !== null && S.ground !== s.id && S.ground !== null) { out.push(`walking ${s.id} at x=${x | 0} snapped to ${S.ground}`); break; } } } } }
    return out; };
  // LERP: state keys the shell interpolates between steps (smooth motion at any refresh rate); add moving things' scalar keys
  const LERP = ['x', 'y', 'cam', 'camY', 'capeTh', 't'];
  root.SIM = { DT, L, K, VIEW, LEVEL, CAM, CONTROLS, HINT, LERP, SURF, COINS, TUFTS, yOn, surfAt, groundBelow, selfCheck, gusts, gustAt, windAt, create, spawn, respawn, outOfPlay, step, at, scriptInput };
  if (typeof module !== 'undefined') module.exports = root.SIM;
})(typeof window !== 'undefined' ? window : globalThis);
