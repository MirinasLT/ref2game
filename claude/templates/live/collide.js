// live/collide.js — shared kinematic collision for box movers (engine file): tile grids and rects, walls, ceilings, one-way
// platforms, ceiling corner correction, a top-down corner nudge and moving platforms that carry their rider. No allocation per
// call, deterministic, node-loadable (sims require it in tune.cjs); `node live/collide.js` runs its self-test.
//   const W = COLLIDE.world({ tile: 32, cols, rows, data, rects })
//     data: flat row-major array, 0 empty, 1 solid, 2 one-way (stand on its top, pass from below and the sides)
//     rects: [{ id, x, y, w, h, oneway, dx, dy }] top-left boxes; a moving platform sets dx, dy = how far it moved this step
//   COLLIDE.move(b, dx, dy, W, o)  b: { x, y, w, h } with x = centre, y = feet (bottom edge), w/h full size
//     o: { corner: px — a rising head that clips a ceiling edge by ≤ corner slides past it (platformers: 4–8),
//          nudge: px — a mover blocked by a corner it misses by ≤ nudge slides around it (top-down: 6–12),
//          drop: true — fall through one-way platforms (↓ + jump) }
//     sets b.hitX / b.hitY (−1, 0, 1: the side blocked), b.ground (landed this move), b.on (rect id, 'tile' or null)
//   COLLIDE.carry(b, W)  before move(): a rider standing on a moving rect moves with it
//   COLLIDE.hit(W, l, t, r, b)  any solid overlapping the box (spawn checks, line of sight probes)
(function (root) {
  const E = 1e-6;
  const world = ({ tile = 32, cols = 0, rows = 0, data = [], rects = [] } = {}) => {
    const byId = {}; for (const r of rects) if (r.id !== undefined) byId[r.id] = r;
    return { tile, cols, rows, data, rects, byId };
  };
  const cell = (W, c, r) => (c < 0 || r < 0 || c >= W.cols || r >= W.rows ? 0 : W.data[r * W.cols + c] | 0);
  let hitId = null;
  // extreme edge of the solids overlapping box l,t,r,b, for the moving side: 0 → min left, 1 → max right, 2 → min top (also
  // one-way tops that were at or below the feet before the move, unless dropping), 3 → max bottom. NaN when nothing blocks.
  // A solid the box already overlapped before the move (ox0..oy1: the old box) never blocks it: an embedded mover walks out
  // instead of being shoved through to the far side.
  let ox0 = NaN, oy0 = NaN, ox1 = NaN, oy1 = NaN;
  const was = (l, t, r, b) => l < ox1 - E && r > ox0 + E && t < oy1 - E && b > oy0 + E;
  const edge = (W, l, t, r, b, side, oldB, drop) => {
    const T = W.tile; let best = NaN; hitId = null;
    const c0 = Math.floor(l / T), c1 = Math.floor((r - E) / T), r0 = Math.floor(t / T), r1 = Math.floor((b - E) / T);
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
      const v = cell(W, cc, rr); if (!v) continue;
      if (v === 2 && (side !== 2 || drop || oldB > rr * T + E)) continue;
      if (was(cc * T, rr * T, (cc + 1) * T, (rr + 1) * T)) continue;
      const e = side === 0 ? cc * T : side === 1 ? (cc + 1) * T : side === 2 ? rr * T : (rr + 1) * T;
      if (best !== best || (side & 1 ? e > best : e < best)) { best = e; hitId = 'tile'; } }
    for (const q of W.rects) {
      if (r <= q.x + E || l >= q.x + q.w - E || b <= q.y + E || t >= q.y + q.h - E) continue;
      if (q.oneway && (side !== 2 || drop || oldB > q.y + E)) continue;
      if (was(q.x, q.y, q.x + q.w, q.y + q.h)) continue;
      const e = side === 0 ? q.x : side === 1 ? q.x + q.w : side === 2 ? q.y : q.y + q.h;
      if (best !== best || (side & 1 ? e > best : e < best)) { best = e; hitId = q.id ?? 'rect'; } }
    return best;
  };
  const hit = (W, l, t, r, b) => { ox0 = NaN; const e = edge(W, l, t, r, b, 0, 0, true); return e === e; };   // one-way never blocks
  const old = (b) => { ox0 = b.x - b.w / 2; ox1 = b.x + b.w / 2; oy0 = b.y - b.h; oy1 = b.y; };
  const freeAt = (W, x, y, w, h) => !hit(W, x - w / 2, y - h, x + w / 2, y);

  const moveX = (b, d, W, o) => {
    old(b); const hw = b.w / 2, nx = b.x + d, s = d > 0 ? 0 : 1, e = edge(W, nx - hw, b.y - b.h, nx + hw, b.y, s, 0, true);
    if (e !== e) { b.x = nx; return; }
    if (o.nudge) for (let k = 1; k <= o.nudge; k++) for (let sg = -1; sg <= 1; sg += 2)     // slide around a corner it nearly clears
      if (freeAt(W, nx, b.y + sg * k, b.w, b.h)) { b.y += sg * Math.min(k, Math.abs(d)); if (k <= Math.abs(d)) b.x = nx; return; }
    b.x = d > 0 ? e - hw : e + hw; b.hitX = d > 0 ? 1 : -1;
  };
  const moveY = (b, d, W, o) => {
    const hw = b.w / 2, ny = b.y + d, ad = Math.abs(d);
    old(b); let e;
    if (d > 0) { e = edge(W, b.x - hw, ny - b.h, b.x + hw, ny, 2, b.y, o.drop);
      if (e !== e) { b.y = ny; return; }
      if (o.nudge && slide(b, ny, ad, o.nudge, W)) return;                        // top-down: round a corner going south too
      b.y = e; b.hitY = 1; b.ground = true; b.on = hitId; return; }
    e = edge(W, b.x - hw, ny - b.h, b.x + hw, ny, 3, 0, true);
    if (e !== e) { b.y = ny; return; }
    if (slide(b, ny, ad, o.corner || o.nudge || 0, W)) return;                      // ceiling corner correction
    b.y = e + b.h; b.hitY = -1;
  };
  // sideways by ≤ kmax px to clear a corner, never faster than the move itself (no visible pop)
  const slide = (b, ny, ad, kmax, W) => { for (let k = 1; k <= kmax; k++) for (let sg = -1; sg <= 1; sg += 2)
    if (freeAt(W, b.x + sg * k, ny, b.w, b.h)) { b.x += sg * Math.min(k, ad); if (k <= ad) b.y = ny; return true; }
    return false; };
  const NONE = {};
  // move in substeps no longer than half the smallest of tile / box (fast movers never tunnel), x then y each substep
  const move = (b, dx, dy, W, o = NONE) => {
    b.hitX = b.hitY = 0; b.ground = false; b.on = null;
    const lim = Math.max(1, Math.min(W.tile, b.w, b.h) / 2), n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / lim));
    const sx = dx / n, sy = dy / n;
    for (let i = 0; i < n; i++) { if (sx && !b.hitX) moveX(b, sx, W, o); if (sy && !b.hitY) moveY(b, sy, W, o); }
    if (!dy) { old(b); ox0 = NaN; const hw = b.w / 2, e = edge(W, b.x - hw, b.y - b.h + 1, b.x + hw, b.y + 1, 2, b.y, false);   // no fall this move:
      if (e === e && Math.abs(e - b.y) < 1e-3) b.on = hitId; }                                                                 // still standing on?
    return b;
  };
  // the rider moves with its platform, through collision (a lift that rises under a ceiling or slides into a wall stops it,
  // never embeds it). Jumping off: add the platform's speed (vx += q.dx / DT) so the jump carries its momentum.
  const carry = (b, W) => { const q = b.on !== null && b.on !== undefined && W.byId[b.on];
    if (q && (q.dx || q.dy)) { const on = b.on; move(b, q.dx || 0, q.dy || 0, W); b.on = on; } return b; };

  root.COLLIDE = { world, move, carry, hit, freeAt, cell };
  if (typeof module !== 'undefined') module.exports = root.COLLIDE;

  // ---------------- self-test: node live/collide.js ----------------
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    const assert = require('assert'), C = root.COLLIDE, cols = 12, rows = 8, data = new Array(cols * rows).fill(0);
    for (let c = 0; c < cols; c++) data[7 * cols + c] = 1;                         // floor: top at y 224
    for (let r = 3; r < 7; r++) data[r * cols + 9] = 1;                            // wall: left face at x 288
    data[4 * cols + 2] = data[4 * cols + 3] = 2;                                   // one-way plank: top at y 128
    data[2 * cols + 5] = 1;                                                        // ceiling block x 160..192, bottom y 96
    const W = C.world({ tile: 32, cols, rows, data, rects: [{ id: 'lift', x: 320, y: 160, w: 64, h: 16, dx: 0, dy: 0 }] });
    const box = (x, y) => ({ x, y, w: 20, h: 40 });
    let b = C.move(box(40, 100), 0, 300, W); assert.equal(b.y, 224); assert(b.ground && b.on === 'tile', 'lands on the floor');
    b = C.move(box(200, 224), 200, 0, W); assert.equal(b.x, 278); assert.equal(b.hitX, 1, 'stopped by the wall');
    b = C.move(box(96, 224), 0, -150, W); assert(b.y < 128 && !b.hitY, 'jumps up through the one-way plank');
    b = C.move(box(96, 100), 0, 60, W); assert.equal(b.y, 128); assert(b.ground, 'lands on the one-way plank');
    b = C.move(box(96, 128), 0, 10, W, { drop: true }); assert.equal(b.y, 138, 'drops through the plank');
    b = C.move(box(40, 100), 0, 2000, W); assert.equal(b.y, 224, 'a fast fall does not tunnel');
    b = C.move(box(152, 150), 0, -40, W); assert.equal(b.hitY, -1, 'head clipping the ceiling edge is blocked without corner');
    b = C.move(box(152, 150), 0, -40, W, { corner: 6 }); assert(!b.hitY && b.x === 150, 'corner correction slides past the edge');
    b = Object.assign(box(352, 160), { on: 'lift' }); W.byId.lift.dx = 5; W.byId.lift.dy = -3;
    C.carry(b, W); assert.deepEqual([b.x, b.y], [357, 157], 'the lift carries its rider');
    b = C.move(box(260, 100), 30, 0, W, { nudge: 8 }); assert.deepEqual([b.x, b.y], [290, 96], 'nudged up over the wall top it nearly cleared');
    b = C.move(box(295, 200), -2, 0, W); assert.equal(b.x, 293, 'a box inside the wall walks out, never shoved through');
    b = C.move(box(152, 40), 0, 30, W, { nudge: 6 }); assert(!b.hitY && b.x === 150, 'nudge rounds a corner going south too');
    b = C.move(box(156, 137), 0, -2, W, { corner: 12 }); assert.deepEqual([b.x, b.y], [154, 137], 'corner correction never outruns the move');
    b = Object.assign(box(352, 100), { on: 'lift' }); W.byId.lift.dx = 0; W.byId.lift.dy = -60;
    C.carry(b, W); assert.equal(b.y, 100 - 60 + 0, 'carried up through open air');
    b = C.move(box(352, 160), 0, 0, W); assert.equal(b.on, 'lift', 'standing still on a lift keeps it as ground');
    console.log('collide: ok');
  }
})(typeof window !== 'undefined' ? window : globalThis);
