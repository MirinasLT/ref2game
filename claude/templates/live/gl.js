// live/gl.js — a tiny deterministic WebGL2 layer renderer: textures (premultiplied, mipmapped or nearest), programs, render
// targets, pixel-space quads (y down) with an affine transform. Everything the scene draws is a quad with a shader.
// Performance (references/performance.md): GL state is cached (program, VAO), every draw is counted (G.stats), many quads of
// one texture go out as ONE instanced draw (G.batch), and the backbuffer can render below view size (scale) on weak GPUs.
(function () {
  const G = (window.G = {});
  let gl, quadVao, cur = null, curP = null, curVao = null, curBlend = null;
  const progs = {}, texs = {};
  G.stats = { draws: 0, progs: 0, inst: 0 };      // this frame: draw calls, program switches, instanced quads (G.frame() resets)
  G.last = { draws: 0, progs: 0, inst: 0 };
  G.frame = () => { const s = G.stats, l = G.last; l.draws = s.draws; l.progs = s.progs; l.inst = s.inst; s.draws = s.progs = s.inst = 0; return l; };
  G.OCT = 5;                                       // fbm octaves compiled into every shader (quality tier, settings.js)

  // W×H = view px every draw uses. scale (0.25..1) = backbuffer and render-target resolution relative to the view: the same
  // frame with fewer pixels (phones, small windows). preserve: keep the drawing buffer (only screenshots need it; costs on mobile).
  // oct: fbm octaves (3 low … 5 high). CAPS.hdr: half-float render targets work here (else targets fall back to RGBA8).
  G.init = (canvas, W, H, { scale = 1, out = scale, preserve = false, oct = 5 } = {}) => {
    G.canvas = canvas; G.W = W; G.H = H; G.OCT = oct;
    gl = G.gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: false, antialias: false, preserveDrawingBuffer: preserve, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available on this device/browser');
    const hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    gl.getExtension('OES_texture_float_linear');
    G.CAPS = { hdr, maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
    G.resize(scale, out);
    quadVao = gl.createVertexArray(); gl.bindVertexArray(quadVao); curVao = quadVao;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    stub = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, stub);           // 1×1 transparent: what a still-loading texture draws
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  };
  // scale (0.25..1) = the scene's render targets (lib.js re-creates them in L.resize); out (scale..1) = the backbuffer, where the
  // final grade upsamples the scene and the HUD draws: a phone renders the world at 0.66 but its text and edges stay crisp
  G.resize = (scale, out = scale) => { const c = G.canvas; G.SCALE = Math.min(1, Math.max(0.25, scale)); G.OUT = Math.min(2, Math.max(G.SCALE, out));
    c.width = Math.round(G.W * G.OUT); c.height = Math.round(G.H * G.OUT); G.BW = c.width; G.BH = c.height; };
  const useP = (P) => { if (curP !== P) { gl.useProgram(P.p); curP = P; G.stats.progs++; } };
  const useVao = (v) => { if (curVao !== v) { gl.bindVertexArray(v); curVao = v; } };
  // is the rect (view px of the bound target) at least partly visible? m = margin. Cull before drawing, and before updating
  // purely visual things (ambient critters, particles), never gameplay (references/performance.md §5)
  G.onScreen = (x, y, w, h, m = 0) => { const vw = cur ? cur.vw : G.W, vh = cur ? cur.vh : G.H;
    return x + w > -m && y + h > -m && x < vw + m && y < vh + m; };

  // nearest: NEAREST min/mag, no mipmaps (pixel art: crisp texels; lod bias has no effect). The image is decoded off the main
  // thread (img.decode) before the upload, so a texture streamed in mid-game does not hitch the frame.
  G.load = (name, url, { repeat = false, nearest = false } = {}) => new Promise((res, rej) => {
    const im = new Image();
    const up = () => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); G.dirtyTex();
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      let src = im; const mx = G.CAPS.maxTex;                  // larger than this GPU allows: downscale, never a silent black quad
      if (im.width > mx || im.height > mx) { const k = mx / Math.max(im.width, im.height), cv = document.createElement('canvas');
        cv.width = Math.floor(im.width * k); cv.height = Math.floor(im.height * k); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        console.warn(`${name}: ${im.width}x${im.height} > MAX_TEXTURE_SIZE ${mx}, downscaled`); src = cv; }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      if (!nearest) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
      const wr = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
      const r = texs[name] && texs[name].pending ? texs[name] : (texs[name] = {});      // a stub fills in place: held refs stay valid
      if (r.t && r.t !== stub) gl.deleteTexture(r.t);
      Object.assign(r, { t, w: im.width, h: im.height, bytes: src.width * src.height * 4 * (nearest ? 1 : 1.34), own: true }); delete r.pending;
      for (const k in texs) if (texs[k].atlas === name) delete texs[k];               // atlas aliases re-resolve to the real sheet
      res(r);
    };
    im.onerror = () => rej(new Error('failed to load ' + url)); im.src = url;
    im.decode ? im.decode().then(up, () => (im.complete && im.naturalWidth ? up() : rej(new Error('failed to load ' + url)))) : (im.onload = up);
  });
  // streaming (big games, references/performance.md §8): G.source(name) → { url, repeat, nearest } (index.html sets it). A name
  // used before it is loaded draws as an empty stub of its real size (ASSETS w/h) and starts loading; G.prefetch warms names
  // ahead (the next level), G.unload frees them (the level you left). Size queries (G.dim, L.hsz) never touch the GPU.
  G.source = null; let stub = null;
  const want = (n) => { const s = G.source && G.source(n); if (!s) return null;
    const A = window.ASSETS && window.ASSETS[n], r = texs[n] = { t: stub, w: A ? A.w : 1, h: A ? A.h : 1, pending: true };
    G.load(n, s.url, s).catch((e) => { console.error(e.message); r.failed = true; }); return r; };
  G.prefetch = (names) => { for (const n of names) { const a = window.ATLAS && window.ATLAS[n]; const k = a ? a[0] : n; if (!texs[k]) want(k); } };
  G.unload = (names) => { for (const n of names) { const a = window.ATLAS && window.ATLAS[n], k = a ? a[0] : n, r = texs[k];
    if (!r || !r.own) continue; gl.deleteTexture(r.t); G.dirtyTex(); delete texs[k]; for (const j in texs) if (texs[j].atlas === k) delete texs[j]; } };
  G.loaded = (n) => { const a = window.ATLAS && window.ATLAS[n], r = texs[a ? a[0] : n]; return !!r && !r.pending; };
  // size in px without loading anything: a loaded texture, an atlas entry, or the ASSETS manifest
  G.dim = (n) => { const t = texs[n]; if (t) return t; const a = window.ATLAS && window.ATLAS[n]; if (a) return { w: a[5], h: a[6] };
    const A = window.ASSETS && window.ASSETS[n]; if (A) return A; return G.tex(n); };
  G.mem = () => { let b = 0; for (const k in texs) if (texs[k].own) b += texs[k].bytes; return b; };   // bytes of loaded textures (with mips)
  G.canvasTex = (name, cv) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); G.dirtyTex();
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return (texs[name] = { t, w: cv.width, h: cv.height, bytes: cv.width * cv.height * 4 * 1.34, own: true });
  };
  // an atlased name (window.ATLAS, scripts/atlas.py) resolves to { t: the atlas, w, h: its own px size, src: its uv rect }, so
  // L.sprite, rigs and batches draw it unchanged, and everything in one atlas can share one batch
  G.tex = (n) => { const t = texs[n]; if (t) return t; const a = window.ATLAS && window.ATLAS[n];
    if (a) { const sh = texs[a[0]] || want(a[0]); if (sh) { const r = { t: sh.t, w: a[5], h: a[6], src: [a[1], a[2], a[3], a[4]], atlas: a[0], pending: sh.pending };
      if (!sh.pending) texs[n] = r; return r; } }                       // a pending sheet: an uncached stub alias until it lands
    const r = want(n); if (r) return r;
    throw new Error('no texture ' + n); };

  const VS = `#version 300 es
in vec2 a_pos; uniform vec2 u_res; uniform mat3 u_xf; uniform vec2 u_flip;
out vec2 v_uv; out vec2 v_px;
void main(){ vec3 p = u_xf * vec3(a_pos, 1.0); v_px = p.xy; v_uv = mix(a_pos, 1.0 - a_pos, u_flip);
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0); }`;
  const COMMON = `precision highp float; precision highp sampler2D;
in vec2 v_uv; in vec2 v_px; out vec4 o;
uniform vec2 u_res; uniform float u_t;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < FBM_OCT; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; } return s; }
vec2 scr(vec2 px){ return vec2(px.x / u_res.x, 1.0 - px.y / u_res.y); }   // screen px -> render-target uv
`;
  G.COMMON = COMMON;                               // G.program prepends '#version 300 es' and '#define FBM_OCT n'

  G.program = (name, fs, vs = VS) => {
    if (progs[name]) return progs[name];
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, '#version 300 es\n#define FBM_OCT ' + G.OCT + '\n' + COMMON + fs));
    gl.bindAttribLocation(p, 0, 'a_pos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(p));
    const loc = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); loc[u.name.replace('[0]', '')] = { l: gl.getUniformLocation(p, u.name), type: u.type }; }
    return (progs[name] = { p, loc, name });
  };

  // view: the coordinate space draws use (default w×h), e.g. a W/k × H/k target drawn in W×H view px; nearest: sample it crisp
  // float: half-float (HDR) when the GPU can render to it, else RGBA8 (checked: never a silent black frame)
  G.target = (w, h, float = false, { view = [w, h], nearest = false } = {}) => {
    const mk = (hf) => { const t = gl.createTexture(), f = nearest ? gl.NEAREST : gl.LINEAR; gl.bindTexture(gl.TEXTURE_2D, t); G.dirtyTex();
      if (hf) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) return { fb, t };
      gl.deleteFramebuffer(fb); gl.deleteTexture(t); return null; };
    const r = (float && G.CAPS.hdr && mk(true)) || mk(false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur ? cur.fb : null);
    if (!r) throw new Error(`render target ${w}x${h} is not supported on this GPU`);
    return { fb: r.fb, t: r.t, w, h, vw: view[0], vh: view[1] };
  };
  G.free = (tg) => { if (!tg) return; if (cur === tg) { cur = null; gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    gl.deleteFramebuffer(tg.fb); gl.deleteTexture(tg.t); G.dirtyTex(); };
  G.bind = (tg, clear) => {
    cur = tg; gl.bindFramebuffer(gl.FRAMEBUFFER, tg ? tg.fb : null);
    gl.viewport(0, 0, tg ? tg.w : G.BW, tg ? tg.h : G.BH);
    if (clear) { gl.clearColor(clear[0], clear[1], clear[2], clear[3]); gl.clear(gl.COLOR_BUFFER_BIT); }
  };
  G.blend = (mode = 'alpha') => {             // cached: setting the current mode again costs nothing
    if (mode === curBlend) return; curBlend = mode;
    gl.enable(gl.BLEND);
    if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else if (mode === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else if (mode === 'none') gl.disable(gl.BLEND);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  };

  // affine: place the unit quad at x,y (top-left) with size w,h, rotated by rot (rad) about pivot (px,py) in local px.
  // Returns ONE scratch array (no garbage per draw): pass it straight to G.draw, never keep it.
  const XF = new Float32Array(9); XF[8] = 1;
  G.xf = (x, y, w, h, rot = 0, px = 0, py = 0) => {
    const c = rot ? Math.cos(rot) : 1, s = rot ? Math.sin(rot) : 0;
    // local (u*w - px, v*h - py) rotated, then + (x + px, y + py)
    XF[0] = w * c; XF[1] = w * s; XF[3] = -h * s; XF[4] = h * c; XF[6] = x + px - (px * c - py * s); XF[7] = y + py - (px * s + py * c);
    return XF;
  };

  // uniforms keep their value per program, so an upload is skipped when the value did not change since this program's last
  // draw (most sprite uniforms are defaults); textures are skipped when the unit already holds them. Anything that binds a
  // texture outside setU calls G.dirtyTex().
  let unit = 0, fbWarned = false; const onUnit = [];
  G.dirtyTex = () => { onUnit.length = 0; };
  const same = (u, v) => {
    if (typeof v === 'number') { if (u.v === v) return true; u.v = v; return false; }
    const c = u.v; if (!c || c.length !== v.length) { u.v = Array.from(v); return false; }
    let eq = true; for (let i = 0; i < v.length; i++) if (c[i] !== v[i]) { c[i] = v[i]; eq = false; } return eq; };
  const setU = (P, k, v) => {
    const u = P.loc[k]; if (!u) return;
    const T = gl;
    if (u.type === T.SAMPLER_2D) { const tx = v.t || v;
      if (cur && tx === cur.t && !fbWarned) { fbWarned = true; console.error(`${P.name}: ${k} samples the target being drawn into (a feedback loop: draws nothing). Reading T.bg after beginComp needs L.init(…, { readBG: true })`); }
      if (onUnit[unit] !== tx) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tx); onUnit[unit] = tx; }
      if (u.v !== unit) { gl.uniform1i(u.l, unit); u.v = unit; } unit++; return; }
    if (v === undefined || same(u, v)) return;
    if (u.type === T.FLOAT) gl.uniform1f(u.l, v);
    else if (u.type === T.FLOAT_VEC2) gl.uniform2fv(u.l, v);
    else if (u.type === T.FLOAT_VEC3) gl.uniform3fv(u.l, v);
    else if (u.type === T.FLOAT_VEC4) gl.uniform4fv(u.l, v);
    else if (u.type === T.FLOAT_MAT3) gl.uniformMatrix3fv(u.l, false, v);
    else if (u.type === T.INT) gl.uniform1i(u.l, v);
  };
  const RES = [0, 0], NOFLIP = [0, 0];
  const res = () => { RES[0] = cur ? cur.vw : G.W; RES[1] = cur ? cur.vh : G.H; return RES; };
  G.draw = (P, U, xf, flip = NOFLIP) => {
    useP(P); useVao(quadVao); unit = 0;
    setU(P, 'u_res', res()); setU(P, 'u_xf', xf); setU(P, 'u_flip', flip);
    for (const k in U) setU(P, k, U[k]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); G.stats.draws++;
  };
  G.full = (P, U) => { const r = res(); G.draw(P, U, G.xf(0, 0, r[0], r[1])); };

  // ---------------- instanced batch: many quads of ONE texture (or one atlas) in one draw call ----------------
  // Per instance: affine (as G.xf), uv rect, premultiplied colour multiplier. For anything numerous and simple: bullets,
  // particles, coins, tiles, debris, crowds of small props. Sprites that need L.sprite's deform/grade uniforms (sway, rim,
  // haze, bones) stay on L.sprite. Order inside a batch = add order, so one batch = one layer (references/performance.md §1).
  const BVS = `#version 300 es
layout(location=0) in vec2 a_pos; layout(location=1) in vec4 a_ab; layout(location=2) in vec2 a_ef; layout(location=3) in vec4 a_src; layout(location=4) in vec4 a_col;
uniform vec2 u_res; out vec2 v_uv; out vec2 v_px; out vec4 v_col;
void main(){ vec2 p = vec2(a_ab.x * a_pos.x + a_ab.z * a_pos.y + a_ef.x, a_ab.y * a_pos.x + a_ab.w * a_pos.y + a_ef.y);
  v_px = p; v_uv = mix(a_src.xy, a_src.zw, a_pos); v_col = a_col;
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0); }`;
  const BFS = `in vec4 v_col; uniform sampler2D u_tex; uniform float u_lod;
void main(){ o = texture(u_tex, v_uv, u_lod) * v_col; }`;
  const F = 14, batches = new Map(), UNIT = [0, 0, 1, 1], ZERO2 = [0, 0];
  // G.batch(texName) returns the same reusable batch every frame (no per-frame allocation): b.add(...) per quad, b.flush() once.
  // Procedural quads (glows, puffs, sparks, motes): G.batch(key, cap, fs) with a fragment shader that reads v_uv (0..1 over the
  // quad), v_px and v_col (tint × alpha, alpha in .a); no texture, b.u = { u_name: value } extra uniforms set at flush.
  G.batch = (name, cap = 1024, fs = null) => {
    let b = batches.get(name); if (b) return b;
    const P = G.program(fs ? '__batch_' + name : '__batch', fs ? 'in vec4 v_col; ' + fs : BFS, BVS), vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    [[1, 4, 0], [2, 2, 4], [3, 4, 6], [4, 4, 10]].forEach(([l, n, o]) => { gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, n, gl.FLOAT, false, F * 4, o * 4); gl.vertexAttribDivisor(l, 1); });
    gl.bindVertexArray(curVao = quadVao);
    b = { name, n: 0, cap, a: new Float32Array(cap * F), lod: 0, u: {},
      // x, y = top-left in view px; o: { rot, pivot: [px, py], src: [u0, v0, u1, v1] (within the sprite), flip, alpha, tint: [r, g, b] }
      add(x, y, w, h, o) {
        if (b.n === b.cap) b.flush();
        const base = (!fs && G.tex(name).src) || UNIT, s = (o && o.src) || null;
        let u0 = base[0], v0 = base[1], u1 = base[2], v1 = base[3];
        if (s) { const du = u1 - u0, dv = v1 - v0; u1 = u0 + du * s[2]; v1 = v0 + dv * s[3]; u0 += du * s[0]; v0 += dv * s[1]; }
        if (o && o.flip) { const t = u0; u0 = u1; u1 = t; }
        const rot = (o && o.rot) || 0, pv = (o && o.pivot) || ZERO2, c = Math.cos(rot), sn = Math.sin(rot);
        const al = o && o.alpha !== undefined ? o.alpha : 1, tn = (o && o.tint) || null, i = b.n++ * F, A = b.a;
        A[i] = w * c; A[i + 1] = w * sn; A[i + 2] = -h * sn; A[i + 3] = h * c;
        A[i + 4] = x + pv[0] - (pv[0] * c - pv[1] * sn); A[i + 5] = y + pv[1] - (pv[0] * sn + pv[1] * c);
        A[i + 6] = u0; A[i + 7] = v0; A[i + 8] = u1; A[i + 9] = v1;
        A[i + 10] = (tn ? tn[0] : 1) * al; A[i + 11] = (tn ? tn[1] : 1) * al; A[i + 12] = (tn ? tn[2] : 1) * al; A[i + 13] = al;
      },
      flush() {
        if (!b.n) return; useP(P); useVao(vao); unit = 0;
        setU(P, 'u_res', res()); if (!fs) { setU(P, 'u_tex', G.tex(name)); setU(P, 'u_lod', b.lod); }
        for (const k in b.u) setU(P, k, b.u[k]);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, b.a, gl.DYNAMIC_DRAW, 0, b.n * F);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.n); G.stats.draws++; G.stats.inst += b.n; b.n = 0;
      } };
    batches.set(name, b); return b;
  };
})();
