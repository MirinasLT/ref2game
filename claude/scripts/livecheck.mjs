// livecheck.mjs — play-test the live page like a player would, headless (run from the project root).
//   node <skill>/scripts/livecheck.mjs [--keys "ArrowRight:down@0.2, Space:press@1.0, ArrowRight:up@2, Move:960x360@2.2, Click:960x360@2.5"] [--shots 0.5,1.2,2.5]
//   (Move/Click take view pixels, e.g. 960x360 on a 1920×1080 view; Down:XxY@t moves and holds the left button, Up:_@t releases,
//    Wheel:±1@t scrolls — hold-to-use tools, aim-and-release, hotbar wheels)
//   touch (with --mobile): T.jump:down@t / T.jump:up@t / T.jump:press@t press the on-screen button of that action;
//    Stick:right@t / Stick:upleft@t … pushes the floating stick (Stick:off@t lets go). Real touch events (CDP), multi-touch.
//        [--for 4] [--url http://127.0.0.1:PORT/live/index.html] [--out frames/livecheck] [--reload] [--eval "SCENE.state.x"] [--minfps 55]
//        [--scale 0.75] [--q low|mid|high] [--mobile] [--cpu 4] [--flow] [--vw 1920]
// --mobile: a landscape phone (844×390 CSS px, DPR 3, touch, coarse pointer → touch controls, mid tier, render scale ≤ 0.75).
// --cpu k: CPU slowed k× (CDP) — 4 ≈ a mid-range phone's main thread. --q: force a quality tier.
// --flow: after the script, Esc opens the menu and the sim must stop, Esc resumes it, then a WebGL context loss must recover
//   (page reloads, play state kept, no errors) — the lifecycle a phone puts the game through.
// Clears the saved session, starts play mode with the first input, runs the timed script, takes screenshots at --shots,
// optionally touches sim.js to prove hot-reload keeps the play state (--reload), and prints one JSON line:
// { errors, fps, perf, quality, touch, audio, flow, dev, evals, shots }. Exit code 2 on page errors, fps < --minfps or a failed flow.
// Without --url it serves the project itself on a free port.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const here = import.meta.dirname;
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || path.join(here, 'node_modules/playwright'));
const args = process.argv.slice(2); const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const root = process.cwd(); let srv = null, url = opt('url'); const mobile = args.includes('--mobile');
if (!url) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
  srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    fs.stat(f, (e, st) => { if (e || !st.isFile()) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'last-modified': st.mtime.toUTCString(), 'content-length': st.size });
      if (q.method === 'HEAD') return r.end(); fs.createReadStream(f).pipe(r); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); url = `http://127.0.0.1:${srv.address().port}/live/index.html`;
}
const addQ = (k, v) => { url += (url.includes('?') ? '&' : '?') + k + '=' + v; };
if (opt('scale')) addQ('scale', opt('scale'));            // --scale 0.75: a phone's render resolution
if (opt('q')) addQ('q', opt('q'));
const out = opt('out', 'frames/livecheck'); fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=' + (process.platform === 'darwin' ? 'metal' : 'default'), '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const vw = +opt('vw', 1280);
const ctx = await browser.newContext(mobile ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
  : { viewport: { width: vw, height: Math.round(vw * 9 / 16) } });
const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
if (opt('cpu')) await cdp.send('Emulation.setCPUThrottlingRate', { rate: +opt('cpu') });
const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(url); await p.evaluate(() => sessionStorage.clear()); await p.reload(); await p.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }); await p.waitForTimeout(1500);

// ---- real touches through CDP: every event carries all fingers that are down ----
const fingers = new Map(); let fid = 1;
const touch = async (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [...fingers.values()] });
const fingerDown = async (key, x, y) => { fingers.set(key, { x, y, id: fid++ }); await touch('touchStart'); };
const fingerMove = async (key, x, y) => { const f = fingers.get(key); if (!f) return; f.x = x; f.y = y; await touch('touchMove'); };
const fingerUp = async (key) => { if (!fingers.delete(key)) return; await touch('touchEnd'); if (fingers.size) await touch('touchStart'); };
const DIRS = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1], upright: [0.7, -0.7], upleft: [-0.7, -0.7], downright: [0.7, 0.7], downleft: [-0.7, 0.7] };

const ev = []; for (const s of (opt('keys', mobile ? 'Stick:right@0, Stick:off@1.5, T.jump:press@1.8' : 'ArrowRight:down@0, ArrowRight:up@1.5, Space:press@1.8')).split(',').map((x) => x.trim()).filter(Boolean)) {
  const [k, rest] = s.split(':'); const [act, at] = rest.split('@'); ev.push({ k, act, at: +at }); }
const shots = (opt('shots', '1,2.5')).split(',').map(Number).map((at) => ({ at, shot: true }));
const tl = [...ev, ...shots].sort((a, b) => a.at - b.at); const t0 = Date.now(); const files = [];
for (const e of tl) { const wait = e.at * 1000 - (Date.now() - t0); if (wait > 0) await p.waitForTimeout(wait);
  if (e.shot) { const f = path.join(out, `play_${e.at.toFixed(2)}.png`); await p.screenshot({ path: f }); files.push(f); }
  else if (e.k.startsWith('T.')) { const a = e.k.slice(2), pos = await p.evaluate((a) => window.INPUT && INPUT.btnRect(a), a);
    if (!pos) { errors.push(`livecheck: no touch button for "${a}" (SIM.CONTROLS.buttons)`); continue; }
    if (e.act === 'down' || e.act === 'press') await fingerDown('b.' + a, pos[0], pos[1]);
    if (e.act === 'press') { await p.waitForTimeout(90); await fingerUp('b.' + a); } else if (e.act === 'up') await fingerUp('b.' + a); }
  else if (e.k === 'Stick') { const vp = p.viewportSize(), x0 = vp.width * 0.16, y0 = vp.height * 0.72;
    if (e.act === 'off') await fingerUp('stick');
    else { const d = DIRS[e.act] || [0, 0]; if (!fingers.has('stick')) await fingerDown('stick', x0, y0); await fingerMove('stick', x0 + d[0] * 60, y0 + d[1] * 60); } }
  else if (e.k === 'Up') await p.mouse.up();
  else if (e.k === 'Wheel') await p.mouse.wheel(0, +e.act * 100);
  else if (e.k === 'Click' || e.k === 'Move' || e.k === 'Down') { const [vx, vy] = e.act.split('x').map(Number);             // view px → page px
    const [x, y] = await p.evaluate(([vx, vy]) => { const r = document.getElementById('c').getBoundingClientRect(), V = (window.SIM && SIM.VIEW) || { W: 1920, H: 1080 };
      return [r.left + vx / V.W * r.width, r.top + vy / V.H * r.height]; }, [vx, vy]);
    if (mobile && e.k === 'Click') { await fingerDown('tap', x, y); await p.waitForTimeout(60); await fingerUp('tap'); }
    else if (e.k === 'Click') await p.mouse.click(x, y); else { await p.mouse.move(x, y, { steps: 8 }); if (e.k === 'Down') await p.mouse.down(); } }
  else if (e.act === 'down') await p.keyboard.down(e.k); else if (e.act === 'up') await p.keyboard.up(e.k); else await p.keyboard.press(e.k); }
for (const k of [...fingers.keys()]) await fingerUp(k);
const total = +opt('for', 0) * 1000; if (total > Date.now() - t0) await p.waitForTimeout(total - (Date.now() - t0));
let reload = null;
if (args.includes('--reload')) { const before = await p.evaluate(() => !!(window.SCENE && SCENE.state));
  const f = path.join(root, 'live/sim.js'); const now = new Date(); fs.utimesSync(f, now, now); await p.waitForTimeout(3500);
  const after = await p.evaluate(() => !!(window.SCENE && SCENE.state)); reload = { playingBefore: before, playingAfter: after }; }
const evals = []; for (const x of args.filter((a, i) => args[i - 1] === '--eval')) evals.push(await p.evaluate((x) => { try { return JSON.stringify(eval(x)); } catch (e) { return 'ERR ' + e.message; } }, x));
await p.waitForTimeout(1200);
const dev = (await p.textContent('#dev').catch(() => '')) || '';
const fps = Math.round(await p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n * 1000 / (performance.now() - t0)); }; requestAnimationFrame(f); })));
const perf = await p.evaluate(() => window.__perf ? window.__perf() : null);   // frame/cpu p50/p95, draws, programs, texture MB, tier, audio (performance.md §11)
const extra = await p.evaluate(() => ({ quality: window.Q ? { tier: Q.tier, scale: window.G && G.SCALE, shadows: Q.shadows, post: Q.post, fx: Q.fx } : null,
  touch: !!document.querySelector('#r2gt.on'), audio: window.SND ? SND.stats() : null, playing: !!(window.SCENE && SCENE.state) }));

let flow = null;
if (args.includes('--flow')) {
  const simT = () => p.evaluate(() => (window.SCENE && SCENE.state ? SCENE.state.t : null));
  flow = { playing: extra.playing };
  if (!extra.playing) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(400); flow.playing = await p.evaluate(() => !!(window.SCENE && SCENE.state)); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  flow.menuOpen = await p.evaluate(() => !!(window.SETTINGS && SETTINGS.open));
  const a = await simT(); await p.waitForTimeout(400); const b = await simT();
  flow.pausedInMenu = a !== null && a === b;
  await p.keyboard.press('Escape'); await p.waitForTimeout(400); const c = await simT();
  flow.resumed = !(await p.evaluate(() => SETTINGS.open)) && c !== null && c > b;
  const lose = await p.evaluate(() => { const x = G.gl.getExtension('WEBGL_lose_context'); if (!x) return false; x.loseContext(); setTimeout(() => x.restoreContext(), 300); return true; });
  if (lose) { await p.waitForTimeout(800); await p.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(800);
    flow.contextLoss = await p.evaluate(() => ({ ready: window.__ready === true, playing: !!(window.SCENE && SCENE.state) }));
    flow.contextLossOk = flow.contextLoss.ready && flow.contextLoss.playing; }
  flow.ok = flow.playing && flow.menuOpen && flow.pausedInMenu && flow.resumed && (!lose || flow.contextLossOk);
}
console.log(JSON.stringify({ errors, fps, perf, ...extra, flow, dev, reload, evals, shots: files }));
await browser.close(); if (srv) srv.close(); if (errors.length || fps < +opt('minfps', 55) || (flow && !flow.ok)) process.exit(2);
