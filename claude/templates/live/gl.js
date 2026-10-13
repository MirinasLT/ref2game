// live/gl.js — a tiny deterministic WebGL2 layer renderer: textures (premultiplied, mipmapped or nearest), programs, render
// targets, pixel-space quads (y down) with an affine transform. Everything the scene draws is a quad with a shader.
// Performance (references/performance.md): GL state is cached (program, VAO), every draw is counted (G.stats), many quads of
// one texture go out as ONE instanced draw (G.batch), and the backbuffer can render below view size (scale) on weak GPUs.
(function () {
  const G = (window.G = {});
  let gl, quadVao, cur = null, curP = null, curVao = null;
  const progs = {}, texs = {};
  G.stats = { draws: 0, progs: 0, inst: 0 };      // this frame: draw calls, program switches, instanced quads (G.frame() resets)
  G.frame = () => { const s = G.stats; G.last = { ...s }; s.draws = s.progs = s.inst = 0; return G.last; };

  // W×H = view px every draw uses. scale (0.25..1) = backbuffer and render-target resolution relative to the view: the same
  // frame with fewer pixels (phones, small windows). preserve: keep the drawing buffer (only screenshots need it; costs on mobile).
  G.init = (canvas, W, H, { scale = 1, preserve = false } = {}) => {
    G.SCALE = Math.min(1, Math.max(0.25, scale));
    canvas.width = Math.round(W * G.SCALE); canvas.height = Math.round(H * G.SCALE);
    gl = G.gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: false, antialias: false, preserveDrawingBuffer: preserve, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 not available');
    gl.getExtension('EXT_color_buffer_float'); gl.getExtension('EXT_color_buffer_half_float'); gl.getExtension('OES_texture_float_linear');
    quadVao = gl.createVertexArray(); gl.bindVertexArray(quadVao); curVao = quadVao;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    G.W = W; G.H = H; G.BW = canvas.width; G.BH = canvas.height;
  };
  const useP = (P) => { if (curP !== P) { gl.useProgram(P.p); curP = P; G.stats.progs++; } };
  const useVao = (v) => { if (curVao !== v) { gl.bindVertexArray(v); curVao = v; } };
  // is the rect (view px of the bound target) at least partly visible? m = margin. Cull before drawing, and before updating
  // purely visual things (ambient critters, particles), never gameplay (references/performance.md §5)
  G.onScreen = (x, y, w, h, m = 0) => { const vw = cur ? cur.vw : G.W, vh = cur ? cur.vh : G.H;
    return x + w > -m && y + h > -m && x < vw + m && y < vh + m; };

  // nearest: NEAREST min/mag, no mipmaps (pixel art: crisp texels; lod bias has no effect)
  G.load = (name, url, { repeat = false, nearest = false } = {}) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      if (!nearest) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
      const wr = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
      texs[name] = { t, w: im.width, h: im.height }; res(texs[name]);
    };
    im.onerror = () => rej(new Error('failed to load ' + url)); im.src = url;
  });
  G.canvasTex = (name, cv) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return (texs[name] = { t, w: cv.width, h: cv.height });
  };
  // an atlased name (window.ATLAS, scripts/atlas.py) resolves to { t: the atlas, w, h: its own px size, src: its uv rect }, so
  // L.sprite, rigs and batches draw it unchanged, and everything in one atlas can share one batch
  G.tex = (n) => { const t = texs[n]; if (t) return t; const a = window.ATLAS && window.ATLAS[n];
    if (a && texs[a[0]]) return (texs[n] = { t: texs[a[0]].t, w: a[5], h: a[6], src: [a[1], a[2], a[3], a[4]], atlas: a[0] });
    throw new Error('no texture ' + n); };

  const VS = `#version 300 es
in vec2 a_pos; uniform vec2 u_res; uniform mat3 u_xf; uniform vec2 u_flip;
out vec2 v_uv; out vec2 v_px;
void main(){ vec3 p = u_xf * vec3(a_pos, 1.0); v_px = p.xy; v_uv = mix(a_pos, 1.0 - a_pos, u_flip);
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0); }`;
  const COMMON = `#version 300 es
precision highp float;
in vec2 v_uv; in vec2 v_px; out vec4 o;
uniform vec2 u_res; uniform float u_t;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; } return s; }
vec2 scr(vec2 px){ return vec2(px.x / u_res.x, 1.0 - px.y / u_res.y); }   // screen px -> render-target uv
`;
  G.COMMON = COMMON;

  G.program = (name, fs, vs = VS) => {
    if (progs[name]) return progs[name];
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, COMMON + fs));
    gl.bindAttribLocation(p, 0, 'a_pos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(p));
    const loc = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); loc[u.name.replace('[0]', '')] = { l: gl.getUniformLocation(p, u.name), type: u.type }; }
    return (progs[name] = { p, loc, name });
  };

  // view: the coordinate space draws use (default w×h), e.g. a W/k × H/k target drawn in W×H view px; nearest: sample it crisp
  G.target = (w, h, float = false, { view = [w, h], nearest = false } = {}) => {
    const t = gl.createTexture(), f = nearest ? gl.NEAREST : gl.LINEAR; gl.bindTexture(gl.TEXTURE_2D, t);
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { fb, t, w, h, vw: view[0], vh: view[1] };
  };
  G.bind = (tg, clear) => {
    cur = tg; gl.bindFramebuffer(gl.FRAMEBUFFER, tg ? tg.fb : null);
    gl.viewport(0, 0, tg ? tg.w : G.BW, tg ? tg.h : G.BH);
    if (clear) { gl.clearColor(clear[0], clear[1], clear[2], clear[3]); gl.clear(gl.COLOR_BUFFER_BIT); }
  };
  G.blend = (mode) => {
    gl.enable(gl.BLEND);
    if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else if (mode === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else if (mode === 'none') gl.disable(gl.BLEND);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  };

  // affine: place the unit quad at x,y (top-left) with size w,h, rotated by rot (rad) about pivot (px,py) in local px
  G.xf = (x, y, w, h, rot = 0, px = 0, py = 0) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    // local (u*w - px, v*h - py) rotated, then + (x + px, y + py)
    return [w * c, w * s, 0, -h * s, h * c, 0, x + px - (px * c - py * s), y + py - (px * s + py * c), 1];
  };

  let unit = 0;
  const setU = (P, k, v) => {
    const u = P.loc[k]; if (!u) return;
    const T = gl;
    if (u.type === T.SAMPLER_2D) { const tx = v.t || v; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tx); gl.uniform1i(u.l, unit++); }
    else if (u.type === T.FLOAT) gl.uniform1f(u.l, v);
    else if (u.type === T.FLOAT_VEC2) gl.uniform2fv(u.l, v);
    else if (u.type === T.FLOAT_VEC3) gl.uniform3fv(u.l, v);
    else if (u.type === T.FLOAT_VEC4) gl.uniform4fv(u.l, v);
    else if (u.type === T.FLOAT_MAT3) gl.uniformMatrix3fv(u.l, false, v);
    else if (u.type === T.INT) gl.uniform1i(u.l, v);
  };
  G.draw = (P, U, xf, flip = [0, 0]) => {
    useP(P); useVao(quadVao); unit = 0;
    setU(P, 'u_res', cur ? [cur.vw, cur.vh] : [G.W, G.H]); setU(P, 'u_xf', xf); setU(P, 'u_flip', flip);
    for (const k in U) setU(P, k, U[k]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); G.stats.draws++;
  };
  G.full = (P, U) => { const res = cur ? [cur.vw, cur.vh] : [G.W, G.H]; G.draw(P, U, G.xf(0, 0, res[0], res[1])); };

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
  const F = 14, batches = new Map();
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
        const base = (!fs && G.tex(name).src) || [0, 0, 1, 1], s = (o && o.src) || null;
        let u0 = base[0], v0 = base[1], u1 = base[2], v1 = base[3];
        if (s) { const du = u1 - u0, dv = v1 - v0; u1 = u0 + du * s[2]; v1 = v0 + dv * s[3]; u0 += du * s[0]; v0 += dv * s[1]; }
        if (o && o.flip) { const t = u0; u0 = u1; u1 = t; }
        const rot = (o && o.rot) || 0, pv = (o && o.pivot) || [0, 0], c = Math.cos(rot), sn = Math.sin(rot);
        const al = o && o.alpha !== undefined ? o.alpha : 1, tn = (o && o.tint) || null, i = b.n++ * F, A = b.a;
        A[i] = w * c; A[i + 1] = w * sn; A[i + 2] = -h * sn; A[i + 3] = h * c;
        A[i + 4] = x + pv[0] - (pv[0] * c - pv[1] * sn); A[i + 5] = y + pv[1] - (pv[0] * sn + pv[1] * c);
        A[i + 6] = u0; A[i + 7] = v0; A[i + 8] = u1; A[i + 9] = v1;
        A[i + 10] = (tn ? tn[0] : 1) * al; A[i + 11] = (tn ? tn[1] : 1) * al; A[i + 12] = (tn ? tn[2] : 1) * al; A[i + 13] = al;
      },
      flush() {
        if (!b.n) return; useP(P); useVao(vao); unit = 0;
        setU(P, 'u_res', cur ? [cur.vw, cur.vh] : [G.W, G.H]); if (!fs) { setU(P, 'u_tex', G.tex(name)); setU(P, 'u_lod', b.lod); }
        for (const k in b.u) setU(P, k, b.u[k]);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, b.a, gl.DYNAMIC_DRAW, 0, b.n * F);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.n); G.stats.draws++; G.stats.inst += b.n; b.n = 0;
      } };
    batches.set(name, b); return b;
  };
})();
