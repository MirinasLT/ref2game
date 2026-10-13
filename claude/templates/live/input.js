// live/input.js — one input record for the sim from keyboard, pointer, touch and gamepad (engine file).
//   inp: left right up down jump act alt (0/1), ax ay (analog −1..1), px py (pointer, view px), press (button held),
//        click (one step), slot (1–9, 0 → 10: hotbars), wheel (±1)
// The game declares what it needs in SIM.CONTROLS = { move: 'x' | 'xy' | null, buttons: [[action, label], …], pointer }:
// phones get a floating stick on the left half and those buttons on the right; pointer: true lets taps on the world through.
// Taps shorter than a frame still reach the sim (latched until the next step); focus loss releases everything (no stuck keys);
// key auto-repeat and Ctrl/Cmd shortcuts never reach the game. The gamepad is polled only after one is connected.
(function () {
  const I = (window.INPUT = { hasTouch: false, device: 'key' });
  const KEYS = { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
    jump: ['Space'], act: ['KeyX', 'KeyJ', 'Enter'], alt: ['KeyC', 'KeyK'] };
  const ACTS = Object.keys(KEYS), CODE = {}, DEFKEYS = {}; for (const a of ACTS) DEFKEYS[a] = KEYS[a].slice();
  // remapped keys (menu → Controls) live in SET.keys = { action: code }: that code becomes the action's first key and leaves
  // every other action; the remaining defaults stay as alternatives
  const rebuild = () => { for (const c in CODE) delete CODE[c]; const ov = (window.SET && SET.keys) || {}, taken = Object.values(ov);
    for (const a of ACTS) { const d = DEFKEYS[a].filter((c) => !taken.includes(c)); KEYS[a] = ov[a] ? [ov[a], ...d] : d; for (const c of KEYS[a]) CODE[c] = a; } };
  rebuild();
  I.KEYS = KEYS;
  I.LABEL = { left: 'Left', right: 'Right', up: 'Up', down: 'Down', jump: 'Jump', act: 'Action', alt: 'Second action' };
  I.RESERVED = /^(Escape|Tab|F\d+|Meta.*|Control.*|Alt.*|Shift.*|CapsLock|ContextMenu)$/;    // never bindable
  I.bind = (a, code) => { if (I.RESERVED.test(code) || !ACTS.includes(a)) return false; SET.keys = Object.assign({}, SET.keys, { [a]: code }); rebuild(); return true; };
  I.resetKeys = () => { SET.keys = null; rebuild(); };
  // the actions this game uses (moves from SIM.CONTROLS.move, one per button): what the Controls screen lists
  I.binds = () => [...(!C || C.move === 'xy' ? ['left', 'right', 'up', 'down'] : C.move === 'x' ? ['left', 'right', 'down'] : []),
    ...((C && C.buttons) || []).map((b) => b[0]).filter((a) => ACTS.includes(a))];
  const KN = { Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: 'Enter', Backspace: '⌫' };
  I.keyName = (code) => (code ? KN[code] || code.replace(/^(Key|Digit|Numpad)/, '') : '—');
  // glyph(action): what to print in prompts for the device used last ("Press A", "Press Space", the touch button's label)
  const PADG = { jump: 'A', act: 'X', alt: 'B', left: '←', right: '→', up: '↑', down: '↓' };
  I.glyph = (a) => { if (I.device === 'pad') return PADG[a] || a;
    if (I.device === 'touch') { const b = ((C && C.buttons) || []).find((x) => x[0] === a); return b ? b[1] || a[0].toUpperCase() : PADG[a] || a; }
    return I.keyName(KEYS[a] && KEYS[a][0]); };
  const held = {}, latch = {}, tch = {}, pad = {}, ptr = { x: 0, y: 0, down: 0, pl: 0, click: 0 }, pend = { slot: 0, wheel: 0 };
  let cv = null, VW = 1920, VH = 1080, C = null, padOn = false, stick = null, ui = null, touchSeen = false;
  const coarse = () => !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const start = () => { if (window.SND) SND.unlock(); if (I.onStart) I.onStart(); };
  const toView = (e) => { const r = cv.getBoundingClientRect(); ptr.x = (e.clientX - r.left) / r.width * VW; ptr.y = (e.clientY - r.top) / r.height * VH; };

  I.isAction = (code) => code in CODE || /^Digit\d$/.test(code);
  let prevB = [];
  const clearPad = () => { for (const k in pad) pad[k] = 0; prevB = []; };
  I.release = () => { for (const c in held) held[c] = 0; for (const a of ACTS) latch[a] = tch[a] = 0; clearPad();
    ptr.down = ptr.pl = 0; stick = null; if (ui) { ui.knob.style.opacity = 0; ui.base.style.opacity = 0.25; } };
  // clear(): drop pending taps (the tap that starts / restarts a run must not also act in it)
  I.clear = () => { for (const a of ACTS) latch[a] = 0; ptr.click = ptr.pl = pend.slot = pend.wheel = 0; };
  addEventListener('blur', I.release);
  // audio unlock and fullscreen need an activating gesture: for touch that is pointerup / touchend, not pointerdown.
  // Capture phase on window, so no overlay's stopPropagation can hide it.
  const gesture = () => { if (window.SND) SND.unlock(); if (I.onGesture) I.onGesture(); };
  addEventListener('pointerup', gesture, true); addEventListener('touchend', gesture, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) I.release(); });
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;                       // browser shortcuts stay the browser's
    const a = CODE[e.code]; I.device = 'key';
    if (a) { held[e.code] = 1; if (!e.repeat) latch[a] = 1; e.preventDefault(); }
    const dg = /^Digit(\d)$/.exec(e.code); if (dg && !e.repeat) pend.slot = +dg[1] || 10;
  });
  addEventListener('keyup', (e) => { held[e.code] = 0; });

  // read(inp): fill the reused record (no allocation per frame); consume() after the first sim step of a frame
  I.read = (inp) => {
    pollPad();
    for (const a of ACTS) { let v = latch[a] || tch[a] || pad[a] || 0; if (!v) for (const c of KEYS[a]) if (held[c]) { v = 1; break; } inp[a] = v; }
    inp.ax = pad.ax || (stick ? stick.ax : 0) || (inp.right - inp.left); inp.ay = pad.ay || (stick ? stick.ay : 0) || (inp.down - inp.up);
    inp.px = ptr.x; inp.py = ptr.y; inp.press = ptr.down || ptr.pl; inp.click = ptr.click; inp.slot = pend.slot; inp.wheel = pend.wheel;
    return inp;
  };
  I.consume = (inp) => { for (const a of ACTS) latch[a] = 0; ptr.click = ptr.pl = pend.slot = pend.wheel = 0; inp.click = inp.slot = inp.wheel = 0; };

  // ---------------- gamepad (standard mapping) ----------------
  addEventListener('gamepadconnected', () => { padOn = true; });
  addEventListener('gamepaddisconnected', clearPad);
  const pollPad = () => {
    if (!padOn || !navigator.getGamepads) return;
    const gp = [...navigator.getGamepads()].find((g) => g && g.connected); if (!gp) { clearPad(); padOn = false; return; }
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed), edge = (i) => b(i) && !prevB[i];
    // radial deadzone: the stick's direction is kept (no snapping to the axes), its length rescaled from 0.2..0.9 to 0..1
    const rx = gp.axes[0] || 0, ry = gp.axes[1] || 0, m = Math.sqrt(rx * rx + ry * ry), sc = m < 0.2 ? 0 : Math.min(1, (m - 0.2) / 0.7) / m, ax = rx * sc, ay = ry * sc;
    const M = window.SETTINGS;
    if (M && M.open) {                                                 // menu navigation
      if (edge(12) || (ay < -0.5 && !prevB.up)) M.nav(-1); if (edge(13) || (ay > 0.5 && !prevB.dn)) M.nav(1);
      if (edge(0)) M.activate(); if ((edge(1) || edge(9)) && M.mode === 'pause') M.close();
    } else {
      pad.left = b(14) || ax < -0.35 ? 1 : 0; pad.right = b(15) || ax > 0.35 ? 1 : 0; pad.up = b(12) || ay < -0.5 ? 1 : 0; pad.down = b(13) || ay > 0.5 ? 1 : 0;
      pad.ax = ax || (pad.right - pad.left); pad.ay = ay || (pad.down - pad.up);
      pad.jump = b(0) ? 1 : 0; pad.act = b(2) ? 1 : 0; pad.alt = b(1) || b(3) ? 1 : 0;
      if (edge(4)) pend.wheel = -1; if (edge(5)) pend.wheel = 1;
      if (edge(9) && M) M.openMenu();
      for (const i of [0, 1, 2, 3]) if (edge(i)) { I.device = 'pad'; start(); }
    }
    prevB = gp.buttons.map((x) => x.pressed); prevB.up = ay < -0.5; prevB.dn = ay > 0.5;
  };

  // ---------------- touch controls (DOM, multi-touch, safe-area aware) ----------------
  const css = `#r2gt{position:absolute;inset:0;pointer-events:none;z-index:10;touch-action:none;-webkit-user-select:none;user-select:none;display:none}
#r2gt.on{display:block}#r2gt .zone{position:absolute;left:0;top:25%;width:50%;bottom:0;pointer-events:auto}
#r2gt .base,#r2gt .knob{position:absolute;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none}
#r2gt .base{width:128px;height:128px;border:3px solid #fff8;background:#0003;opacity:.25}
#r2gt .knob{width:58px;height:58px;background:#fffc;opacity:0;box-shadow:0 2px 8px #0006}
#r2gt .btns{position:absolute;right:calc(18px + env(safe-area-inset-right));bottom:calc(18px + env(safe-area-inset-bottom));pointer-events:none}
#r2gt .b{position:absolute;border-radius:50%;pointer-events:auto;display:flex;align-items:center;justify-content:center;
  font:700 22px system-ui,sans-serif;color:#fff;background:#0005;border:3px solid #fff9;opacity:.6;transition:transform .06s,opacity .06s}
#r2gt .b.on{opacity:1;transform:scale(.9);background:#fff4}
#r2gt .menu{position:absolute;top:calc(10px + env(safe-area-inset-top));right:calc(10px + env(safe-area-inset-right));width:48px;height:48px;
  pointer-events:auto;border-radius:12px;background:#0005;border:2px solid #fff6;color:#fff;font:700 20px system-ui;display:flex;align-items:center;justify-content:center}`;
  const ctl = () => Object.assign({ move: 'xy', buttons: [['jump', 'A'], ['act', 'B']], pointer: true }, (window.SIM && SIM.CONTROLS) || {});
  // primary button bottom-right, the rest on an arc up-left of it (thumb reach): [x, y, size] from the bottom-right corner
  const POS = [[0, 0, 96], [-104, 26, 80], [-14, -100, 80], [-112, -78, 72]];
  const build = () => {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const root = document.createElement('div'); root.id = 'r2gt'; document.body.appendChild(root);
    const kill = (e) => { e.preventDefault(); e.stopPropagation(); };
    ui = { root, btn: {} };
    if (C.move) {
      const z = document.createElement('div'); z.className = 'zone'; root.appendChild(z);
      ui.base = document.createElement('div'); ui.base.className = 'base'; ui.knob = document.createElement('div'); ui.knob.className = 'knob';
      root.append(ui.base, ui.knob);
      const home = () => { const r = root.getBoundingClientRect(); ui.base.style.left = (r.width * 0.14) + 'px'; ui.base.style.top = (r.height * 0.74) + 'px'; };
      home(); addEventListener('resize', home);
      const R = 56;
      const upd = (e) => { const dx = e.clientX - stick.ox - stick.x, dy = e.clientY - stick.oy - stick.y, d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
        const vx = dx * k / R, vy = dy * k / R, dzn = 0.28, m = Math.hypot(vx, vy);
        stick.ax = m < dzn ? 0 : vx; stick.ay = m < dzn ? 0 : vy;
        tch.left = vx < -dzn ? 1 : 0; tch.right = vx > dzn ? 1 : 0;                  // 'x': up/down only on a firm push (ladders, drop)
        tch.up = vy < (C.move === 'x' ? -0.65 : -dzn) ? 1 : 0; tch.down = vy > (C.move === 'x' ? 0.65 : dzn) ? 1 : 0;
        ui.knob.style.left = (stick.x + dx * k) + 'px'; ui.knob.style.top = (stick.y + dy * k) + 'px'; };
      // floating stick: it appears where the thumb lands (no aiming for a fixed circle)
      z.addEventListener('pointerdown', (e) => { kill(e); if (stick) return; I.device = 'touch'; touchSeen = true; start();
        const r = root.getBoundingClientRect(); stick = { id: e.pointerId, ox: r.left, oy: r.top, x: e.clientX - r.left, y: e.clientY - r.top, ax: 0, ay: 0 };
        ui.base.style.left = stick.x + 'px'; ui.base.style.top = stick.y + 'px'; ui.base.style.opacity = 0.7; ui.knob.style.opacity = 1;
        z.setPointerCapture(e.pointerId); upd(e); });
      z.addEventListener('pointermove', (e) => { if (stick && e.pointerId === stick.id) { kill(e); upd(e); } });
      const end = (e) => { if (!stick || e.pointerId !== stick.id) return; stick = null; tch.left = tch.right = tch.up = tch.down = 0;
        ui.knob.style.opacity = 0; ui.base.style.opacity = 0.25; home(); };
      z.addEventListener('pointerup', end); z.addEventListener('pointercancel', end);
    }
    const box = document.createElement('div'); box.className = 'btns'; root.appendChild(box);
    // primary button bottom-right, the rest on an arc up-left of it (thumb reach)
    (C.buttons || []).slice(0, 4).forEach(([a, label], i) => {
      const [x, y, s] = POS[i], b = document.createElement('div'); b.className = 'b'; b.textContent = label || a[0].toUpperCase();
      Object.assign(b.style, { width: s + 'px', height: s + 'px', right: -x + 'px', bottom: -y + 'px' }); b.setAttribute('aria-label', a);
      const on = (e) => { kill(e); I.device = 'touch'; touchSeen = true; tch[a] = 1; latch[a] = 1; b.classList.add('on'); b.setPointerCapture(e.pointerId);
        if (navigator.vibrate) try { navigator.vibrate(8); } catch (x) { /* not allowed */ } start(); };
      const off = (e) => { tch[a] = 0; b.classList.remove('on'); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off);
      box.appendChild(b); ui.btn[a] = b; });
    const m = document.createElement('div'); m.className = 'menu'; m.textContent = '❚❚'; m.setAttribute('aria-label', 'menu');
    m.addEventListener('pointerdown', (e) => { kill(e); if (window.SETTINGS) SETTINGS.openMenu(); }); root.appendChild(m);
  };
  // show the overlay: Touch controls = On, or Auto on a touch screen (coarse pointer or a touch seen); SIM.PLATFORM 'mobile'
  // shows it on every screen (the game is played by touch, also when tested on a desktop)
  I.refresh = () => { if (!ui) return; const s = (window.SET || {}).touch ?? 'auto';
    ui.root.classList.toggle('on', s === true || (s === 'auto' && (I.PLATFORM === 'mobile' || coarse() || touchSeen))); };
  // zones(VW, VH, pw, ph): where the touch controls sit on a phone page (844×390 CSS px landscape by default), as view-px rects
  // [{ id, x, y, w, h }] — qa.mjs fails HUD text under a thumb. Same layout numbers as the overlay (buttons, menu, resting stick).
  I.zones = (vw, vh, pw = vw >= vh ? 844 : 390, ph = vw >= vh ? 390 : 844) => {
    const c = ctl(), ar = vw / vh, cw = Math.min(pw, ph * ar), ch = cw / ar, ox = (pw - cw) / 2, oy = (ph - ch) / 2, k = vw / cw, out = [];
    const add = (id, l, t, w, h) => out.push({ id, x: (l - ox) * k, y: (t - oy) * k, w: w * k, h: h * k });
    if (!(c.move || (c.buttons && c.buttons.length))) return out;
    (c.buttons || []).slice(0, 4).forEach(([a], i) => { const [x, y, s] = POS[i]; add('touch:' + a, pw - 18 + x - s, ph - 18 + y - s, s, s); });
    add('touch:menu', pw - 58, 10, 48, 48);
    if (c.move) add('touch:stick', pw * 0.14 - 64, ph * 0.74 - 64, 128, 128);
    return out; };
  // rect of an on-screen button in page px (livecheck taps it)
  I.btnRect = (a) => { const b = ui && ui.btn[a]; if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

  // init(canvas, VW, VH): pointer in view px on the canvas; touch overlay when SIM.CONTROLS asks for a stick or buttons.
  // SIM.PLATFORM (Step 0 of the skill): 'universal' (default: keyboard, touch, gamepad), 'desktop' (no touch overlay, no
  // rotate prompt), 'mobile' (touch overlay always, touch hints; keyboard and gamepad still work for testing)
  I.PLATFORM = (window.SIM && SIM.PLATFORM) || 'universal';
  I.init = (canvas, w, h) => {
    cv = canvas; VW = w; VH = h; ptr.x = w / 2; ptr.y = h / 2;
    C = ctl();
    I.hasTouch = I.PLATFORM !== 'desktop' && !!(C.move || (C.buttons && C.buttons.length));
    if (I.hasTouch) { build(); I.refresh(); }
    addEventListener('pointermove', (e) => { if (e.pointerType === 'touch' && !C.pointer) return; toView(e); });
    addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') { touchSeen = true; I.device = 'touch'; I.refresh(); }
      toView(e); if (C.pointer || e.pointerType !== 'touch') { ptr.down = ptr.pl = ptr.click = 1; } start(); });
    addEventListener('pointerup', () => { ptr.down = 0; });
    addEventListener('pointercancel', () => { ptr.down = 0; });
    addEventListener('wheel', (e) => { pend.wheel = Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
  };
})();
