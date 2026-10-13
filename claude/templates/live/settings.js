// live/settings.js — player options, quality tiers and the in-game menu (engine file; references/performance.md §13).
//   window.SET   the player's options, saved per game in localStorage: quality, shadows, music, sfx, vol, shake, touch
//   window.Q     the resolved quality knobs everything reads each frame: { tier, scale, fx, post, rays, ink, oct, shadows, shake }
//   SETTINGS     open('pause') / close() the menu, result({ title, lines }) a win / game-over card, fit() the render scale to
//                the screen, watch(ms) the adaptive governor (auto quality steps down when frames run long on this device)
// Tiers: high = desktop look; mid = phones (render 0.75, fewer passes); low = weak phones (no bloom, no rays, no drop shadows,
// fewer particles). The sim never reads Q: the attract demo and the play rules are the same on every device.
// URL: ?q=low|mid|high forces a tier (not saved); ?render=1 (renders, QA) is always high.
// Q.oct (fbm octaves) is baked into shaders when they compile: a tier change at runtime applies it on the next page load.
(function () {
  const KEY = 'r2g:' + location.pathname.replace(/index\.html$/, ''), qs = new URLSearchParams(location.search);
  const RENDER = qs.has('render'), media = (m) => !!(window.matchMedia && matchMedia(m).matches);
  const TIERS = {
    high: { scale: 1, fx: 1, post: 2, rays: 72, ink: 8, oct: 5 },
    mid: { scale: 0.75, fx: 0.7, post: 1, rays: 36, ink: 6, oct: 4 },
    low: { scale: 0.6, fx: 0.4, post: 0, rays: 0, ink: 4, oct: 3 },
  };
  const ORDER = ['low', 'mid', 'high'];
  const DEF = { quality: 'auto', autoTier: null, shadows: 'auto', music: true, sfx: true, vol: 0.8,
    shake: !media('(prefers-reduced-motion: reduce)'), touch: 'auto' };
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  const SET = (window.SET = Object.assign({}, DEF, saved));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(SET)); } catch (e) { /* private mode: options last this session */ } };

  // device guess: weak phone → low, phone/tablet → mid, desktop → high; capped by what the governor settled on before
  const detect = () => {
    const coarse = media('(pointer: coarse)'), mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
    const d = coarse ? (mem <= 3 || cores <= 4 ? 'low' : 'mid') : 'high';
    return SET.autoTier && ORDER.indexOf(SET.autoTier) < ORDER.indexOf(d) ? SET.autoTier : d;
  };
  const tierNow = () => RENDER ? 'high' : TIERS[qs.get('q')] ? qs.get('q') : SET.quality !== 'auto' && TIERS[SET.quality] ? SET.quality : detect();
  const resolve = () => {
    const tier = tierNow(), t = TIERS[tier];
    return Object.assign(window.Q || {}, t, { tier, auto: !RENDER && !qs.get('q') && SET.quality === 'auto',
      shadows: RENDER || (SET.shadows === 'auto' ? tier !== 'low' : !!SET.shadows), shake: RENDER || SET.shake ? 1 : 0 });
  };
  window.Q = resolve();

  const S = (window.SETTINGS = { open: false, mode: null, on: {} });
  // render scale for a canvas shown at `shown` device px per view px: never more pixels than the screen shows, never above the
  // tier's cap, never below 0.5. ?scale=k overrides; renders are always 1.
  S.scaleFor = (shown) => RENDER ? 1 : +(qs.get('scale') || Math.max(0.5, Math.min(Q.scale, shown || 1)));
  const shownNow = () => { const c = window.G && G.canvas; return c ? c.getBoundingClientRect().width * devicePixelRatio / G.W : 1; };
  S.fit = () => { if (!window.G || !G.canvas || RENDER) return; const k = S.scaleFor(shownNow());
    if (Math.abs(k - G.SCALE) > 0.04) { G.resize(k); if (window.LIB && LIB.resize) LIB.resize(); } };
  let fitT = 0; addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(S.fit, 250); });
  S.apply = () => { resolve(); save(); S.fit(); if (window.SND) SND.apply(); if (window.INPUT && INPUT.refresh) INPUT.refresh(); };

  // ---- adaptive governor: auto quality only, after a 3 s warm-up, skipped while paused / hidden / automated (Playwright).
  // Every 2 s: frame p95 > 20 ms twice in a row → one tier down (remembered for this device). A steady ~33 ms with low spread
  // is a 30 Hz display / battery-saver cap, not load: leave it.
  const ring = new Float32Array(120); let ri = 0, rn = 0, since = performance.now(), bad = 0;
  const auto = () => Q.auto && (!navigator.webdriver || qs.has('gov'));
  S.watch = (ms, active) => {
    if (!auto() || !active || document.hidden) { rn = ri = 0; since = performance.now(); return; }
    ring[ri] = ms; ri = (ri + 1) % ring.length; rn = Math.min(ring.length, rn + 1);
    const now = performance.now(); if (now - since < (bad ? 2000 : 3000) || rn < 60) return; since = now;
    const a = Array.from(ring.subarray(0, rn)).sort((x, y) => x - y), p50 = a[rn >> 1], p95 = a[Math.floor(rn * 0.95)]; rn = ri = 0;
    const capped30 = p50 > 31 && p50 < 35.5 && p95 < 38;
    bad = p95 > 20 && !capped30 ? bad + 1 : 0;
    if (bad >= 2 && Q.tier !== 'low') { SET.autoTier = ORDER[ORDER.indexOf(Q.tier) - 1]; bad = 0; S.apply(); console.info('quality: auto →', Q.tier, `(p95 ${p95.toFixed(1)} ms)`); }
  };

  // ---------------- menu: DOM overlay (costs nothing while closed), keyboard / gamepad / touch ----------------
  const css = `#r2gm{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#0009;z-index:20;
  font:600 17px system-ui,-apple-system,"Segoe UI",sans-serif;color:#f4ecdc;touch-action:none;-webkit-user-select:none;user-select:none}
#r2gm.on{display:flex}#r2gm .card{min-width:min(340px,86vw);max-height:90vh;overflow:auto;padding:20px 22px;border-radius:16px;
  background:#1d1712ee;box-shadow:0 10px 40px #000a;border:1px solid #fff2}
#r2gm h2{margin:0 0 4px;font-size:26px;text-align:center}#r2gm p{margin:0 0 10px;text-align:center;opacity:.8;font-weight:500}
#r2gm button{display:flex;justify-content:space-between;width:100%;min-height:48px;margin:6px 0;padding:10px 14px;border-radius:10px;
  border:1px solid #fff3;background:#ffffff14;color:inherit;font:inherit;cursor:pointer}
#r2gm button:hover,#r2gm button:focus-visible{background:#ffffff2e;outline:2px solid #ffd76a;outline-offset:1px}
#r2gm button b{opacity:.75;font-weight:600}`;
  let root = null, card = null;
  const LBL = { auto: 'Auto', high: 'High', mid: 'Medium', low: 'Low', true: 'On', false: 'Off' };
  const cyc = (k, opts) => { SET[k] = opts[(opts.indexOf(SET[k]) + 1) % opts.length]; S.apply(); };
  const items = (mode) => {
    const L = [];
    if (mode === 'pause') L.push(['Resume', null, () => S.close()]);
    L.push([mode === 'pause' ? 'Restart' : 'Play again', null, () => { S.close(); S.on.restart && S.on.restart(); }]);
    if (mode === 'pause') {
      L.push(['Quality', LBL[SET.quality] + (SET.quality === 'auto' ? ` (${LBL[Q.tier]})` : ''), () => cyc('quality', ['auto', 'high', 'mid', 'low'])]);
      L.push(['Shadows', SET.shadows === 'auto' ? `Auto (${LBL[Q.shadows]})` : LBL[SET.shadows], () => cyc('shadows', ['auto', true, false])]);
      if (window.SOUND && SOUND.song) L.push(['Music', LBL[SET.music], () => cyc('music', [true, false])]);
      L.push(['Sound effects', LBL[SET.sfx], () => cyc('sfx', [true, false])]);
      L.push(['Screen shake', LBL[SET.shake], () => cyc('shake', [true, false])]);
      if (window.INPUT && INPUT.hasTouch) L.push(['Touch controls', LBL[SET.touch], () => cyc('touch', ['auto', true, false])]);
      if (document.fullscreenEnabled) L.push(['Fullscreen', LBL[!!document.fullscreenElement], () => S.fullscreen(!document.fullscreenElement)]);
    }
    L.push(['Title', null, () => { S.close(); S.on.title && S.on.title(); }]);
    return L;
  };
  let mode = 'pause', info = null;
  const build = () => {
    if (!root) { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      root = document.createElement('div'); root.id = 'r2gm'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
      card = document.createElement('div'); card.className = 'card'; root.appendChild(card); document.body.appendChild(root);
      root.addEventListener('pointerdown', (e) => e.stopPropagation()); }
    const fi = card.contains(document.activeElement) ? [...card.querySelectorAll('button')].indexOf(document.activeElement) : 0;
    card.replaceChildren();
    const h = document.createElement('h2'); h.textContent = info ? info.title : 'Paused'; card.appendChild(h);
    for (const l of (info && info.lines) || []) { const p = document.createElement('p'); p.textContent = l; card.appendChild(p); }
    for (const [label, val, fn] of items(mode)) { const b = document.createElement('button'); b.type = 'button';
      b.append(label); if (val !== null) { const v = document.createElement('b'); v.textContent = val; b.appendChild(v); }
      b.addEventListener('click', () => { if (window.SND) SND.play('click'); fn(); if (S.open) build(); }); card.appendChild(b); }
    const bs = card.querySelectorAll('button'); (bs[Math.max(0, Math.min(bs.length - 1, fi))] || bs[0]).focus({ preventScroll: true });
  };
  S.show = (m, inf = null) => { mode = S.mode = m; info = inf; S.open = true; build(); root.classList.add('on');
    card.querySelector('button').focus({ preventScroll: true });           // after display: a hidden element can't take focus
    S.on.pause && S.on.pause(true); };
  S.openMenu = () => { if (!(S.open && mode === 'result')) S.show('pause'); };   // never replaces a result card
  S.result = (inf) => S.show('result', inf);            // inf: { title, lines: [...] }
  S.close = () => { if (!S.open) return; S.open = false; S.mode = null; root.classList.remove('on'); S.on.pause && S.on.pause(false); };
  S.nav = (d) => { if (!S.open) return; const bs = [...card.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
    bs[(i + d + bs.length) % bs.length].focus({ preventScroll: true }); };
  S.activate = () => { if (S.open && card.contains(document.activeElement)) document.activeElement.click(); };
  // fullscreen + landscape lock where the platform allows it (Android); iOS Safari has no element fullscreen on iPhone
  S.fullscreen = (on) => { try {
    if (on) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => {
      const VW = (window.SIM && SIM.VIEW && SIM.VIEW.W) || 16, VH = (window.SIM && SIM.VIEW && SIM.VIEW.H) || 9;
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock(VW >= VH ? 'landscape' : 'portrait').catch(() => {}); }).catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) { /* unsupported */ } };
  addEventListener('keydown', (e) => { if (!S.open) return; e.stopPropagation();            // the game sees no keys while the menu is up
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { S.nav(1); e.preventDefault(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { S.nav(-1); e.preventDefault(); }
    else if ((e.code === 'Escape' || e.code === 'Backspace') && mode === 'pause' && !e.repeat) { S.close(); e.preventDefault(); } }, true);
})();
