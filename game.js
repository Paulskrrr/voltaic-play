// Voltaic engine: simulation, rendering and UI glue.
(() => {
  'use strict';
  const C = window.TD_CONFIG;
  const T = C.TILE;
  const TW = C.TOWERS, EN = C.ENEMIES, TR = C.TERRAIN, WV = C.WAVES;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const DIR_NAMES = ['east', 'south', 'west', 'north'];
  const $ = (id) => document.getElementById(id);
  const sfx = (name) => { if (window.TD_SFX) window.TD_SFX.play(name); };

  const canvas = $('board');           // WebGL: the city
  const fx = $('fx');                  // 2D overlay: light effects and UI marks
  const fxCtx = fx.getContext('2d');
  let ctx = fxCtx;                     // the canvas being drawn on: the overlay, or the road decal while it is painted
  const THREE = window.THREE, MODELS = window.TD_MODELS;
  if (!THREE || !MODELS) { $('overlay').hidden = false; $('ovActions').hidden = true; $('ovBody').innerHTML = '<p>Voltaic needs WebGL and its 3D library (vendor/three.min.js) to draw the city, and one of them did not load.</p>'; return; }

  // ---------- helpers ----------
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // sqrt, not Math.hypot: this runs per tower x enemy x step and hypot is several times slower
  const dist = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); };
  const fmt = (n) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10).toString();
  const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.round(Math.abs(n) * 100)}%`;

  // ---------- map ----------
  // routes: every road from a gate to the exit (routes[0] = path; a map's `entry2` adds a second one that joins
  // it); flyPaths: each route's straight flight line from its gate to the exit (flyPaths[0] = flyPath)
  let COLS, ROWS, grid, path, flyPath, routes, flyPaths, terrainCanvas;
  let mapDef = C.MAPS[0];   // the map being played
  let restricted = false;   // true on maps with building lots: open ground is promenade, not plaza

  function buildPolyline(pts) {
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = dist(a.x, a.y, b.x, b.y);
      segs.push({ a, b, len, start: total });
      total += len;
    }
    return { pts, segs, len: total };
  }
  function posOn(poly, d) {
    for (const s of poly.segs) {
      if (d <= s.start + s.len) {
        const t = (d - s.start) / s.len;
        return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
      }
    }
    const last = poly.pts[poly.pts.length - 1];
    return { x: last.x, y: last.y };
  }

  // The designed map is the core. Extra rows or columns of real, buildable land are added around it
  // so the grid matches the window's shape and the whole screen is playable map.
  // size: [cols, rows] to rebuild a saved game's map exactly, whatever shape the window is now
  function buildMap(def, size) {
    mapDef = def; restricted = !!def.lots;
    const open = restricted ? 'walk' : 'grass';
    // The camera looks down at an angle, which squashes depth on screen, so the map gets extra rows to fill it.
    const aspect = (window.innerWidth / Math.max(1, window.innerHeight)) * 0.8;
    let cols = def.cols, rows = def.rows;
    if (aspect < cols / rows) rows = Math.min(def.rows * 4, Math.ceil(cols / aspect));
    else cols = Math.min(def.cols * 4, Math.ceil(rows * aspect));
    if (size) [cols, rows] = size;
    const offX = Math.floor((cols - def.cols) / 2), offY = Math.floor((rows - def.rows) / 2);
    COLS = cols; ROWS = rows;
    // outer city: plazas with clumps of tenements and the odd monolith
    grid = Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => {
      const inCore = x >= offX && x < offX + def.cols && y >= offY && y < offY + def.rows;
      if (inCore) return open;
      const clump = rng(((x >> 2) + 1) * 92821 ^ ((y >> 2) + 1) * 68917)();
      const r = rng((x + 7) * 31337 ^ (y + 3) * 7919)();
      if (clump < 0.3 && r < 0.75) return 'forest';
      if (r < 0.03) return 'rock';
      return open;
    }));
    for (const [x, y, w, h] of def.lots || []) {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        if (yy >= 0 && yy < def.rows && xx >= 0 && xx < def.cols) grid[yy + offY][xx + offX] = 'grass';
      }
    }
    for (const p of def.terrain) {
      const [x, y, w, h] = p.rect;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        if (yy >= 0 && yy < def.rows && xx >= 0 && xx < def.cols) grid[yy + offY][xx + offX] = p.t;
      }
    }
    const shift = (road) => road.map(([x, y]) => [x + offX, y + offY]);
    const wp = shift(def.path);
    // stretch the road to the new screen edges
    if (offX > 0) {
      const [fx, fy] = wp[0], [lx, ly] = wp[wp.length - 1];
      if (fx === offX) wp.unshift([0, fy]);
      if (lx === offX + def.cols - 1) wp.push([COLS - 1, ly]);
    }
    // a second gate's road runs until it meets the main road, then follows it to the exit
    const wp2 = def.entry2 ? shift(def.entry2) : null;
    if (wp2 && offX > 0 && wp2[0][0] === offX) wp2.unshift([0, wp2[0][1]]);
    for (const road of [wp, wp2]) for (let i = 0; road && i < road.length - 1; i++) {
      let [x, y] = road[i];
      const [x1, y1] = road[i + 1];
      const dx = Math.sign(x1 - x), dy = Math.sign(y1 - y);
      for (;;) { grid[y][x] = 'path'; if (x === x1 && y === y1) break; x += dx; y += dy; }
    }
    const px = (road) => road.map(([x, y]) => ({ x: (x + 0.5) * T, y: (y + 0.5) * T }));
    const pts = px(wp);
    const ext = (a, b) => ({ x: a.x + Math.sign(a.x - b.x) * T, y: a.y + Math.sign(a.y - b.y) * T });
    pts.unshift(ext(pts[0], pts[1]));
    pts.push(ext(pts[pts.length - 1], pts[pts.length - 2]));
    path = buildPolyline(pts);
    routes = [path];
    if (wp2) {
      // join where the second road's last point lies on the main road; carry on along the main road from there
      const p2 = px(wp2), j = p2[p2.length - 1];
      const at = path.segs.findIndex((s) => Math.abs((s.b.x - s.a.x) * (j.y - s.a.y) - (s.b.y - s.a.y) * (j.x - s.a.x)) < 1
        && j.x >= Math.min(s.a.x, s.b.x) - 1 && j.x <= Math.max(s.a.x, s.b.x) + 1 && j.y >= Math.min(s.a.y, s.b.y) - 1 && j.y <= Math.max(s.a.y, s.b.y) + 1);
      const tail = pts.slice(at + 1).filter((q) => q.x !== j.x || q.y !== j.y);
      routes.push(buildPolyline([ext(p2[0], p2[1]), ...p2, ...tail]));
    }
    flyPaths = routes.map((r) => buildPolyline([r.pts[0], r.pts[r.pts.length - 1]]));
    flyPath = flyPaths[0];
    if (typeof losCache !== 'undefined') { losCache.clear(); roadCache.clear(); }
    resize();
    paintTerrain();
    buildScene();
  }

  // ---------- the 3D stage ----------
  // The city is a real 3D scene seen from an angle. The WebGL canvas draws the city, the towers and the robots;
  // a transparent 2D canvas on top draws light effects and UI marks, projected through the same camera.
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  gl.outputEncoding = THREE.sRGBEncoding;
  gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.1;
  gl.autoClear = false;
  const M3 = MODELS.init(gl);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0f22, 0.016);
  const world = new THREE.Group(); // everything above ground; drawn a second time upside down as the reflection
  scene.add(world);
  const camera = new THREE.PerspectiveCamera(34, 1, 1, 600);
  const hemi = new THREE.HemisphereLight(0x8890b0, 0x2a1c08, 0.3);
  world.add(hemi);
  const moon = new THREE.DirectionalLight(0xc8d2f0, 0.4); moon.position.set(-30, 60, 24); world.add(moon, moon.target);
  const warm = new THREE.DirectionalLight(0xffb866, 0.5); warm.position.set(40, 22, 40); world.add(warm, warm.target);
  // moonlight pooled on the playfield: one soft-edged spot straight above it, aimed in buildScene
  const moonPool = new THREE.SpotLight(0xffffff, 0, 0, 0.5, 1, 0); world.add(moonPool, moonPool.target);
  const lightRig = [hemi, moon, warm, moonPool].map((light) => ({ light, base: light.intensity }));

  const raycaster = new THREE.Raycaster(), ndcV = new THREE.Vector2(), hitV = new THREE.Vector3();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  raycaster.params.Line.threshold = 0.01;
  const PITCH = (43 * Math.PI) / 180; // how steeply the camera looks down
  const view = { w: 1, h: 1, dpr: 1, ppt: 32 }; // overlay size in device pixels; ppt = pixels per tile mid-map
  const _v = new THREE.Vector3();
  // While the road decal is painted, decalK is its pixels per tile and proj maps straight onto it (height ignored).
  const DECAL_PAD = 1; // tiles of decal past each map edge
  let decalK = 0;
  // map position (world pixels) and height (tiles) -> overlay pixel
  function proj(px, py, h = 0) {
    if (decalK) return { x: (px / T + DECAL_PAD) * decalK, y: (py / T + DECAL_PAD) * decalK };
    _v.set(px / T, h, py / T).project(camera);
    return { x: (_v.x * 0.5 + 0.5) * view.w, y: (0.5 - _v.y * 0.5) * view.h };
  }
  // Reflection targets: half resolution, blurred in two passes.
  const reflA = new THREE.WebGLRenderTarget(1, 1), reflB = new THREE.WebGLRenderTarget(1, 1);
  reflA.texture.encoding = reflB.texture.encoding = THREE.sRGBEncoding;   // pass 1 already writes display-ready colour
  const reflTexel = new THREE.Vector2(), tune = { streak: 3 };
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() }, uStrength: { value: 0.7 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; uniform float uStrength; varying vec2 vUv;
      void main(){
        vec3 c = vec3(0.0); float ws = 0.0;
        for (int i = -4; i <= 4; i++) { float w = exp(-float(i * i) / 12.0); c += texture2D(tSrc, vUv + uDir * float(i)).rgb * w; ws += w; }
        gl_FragColor = vec4(c / ws * uStrength, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const quadScene = new THREE.Scene();
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMat));
  quadScene.children[0].frustumCulled = false;
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---------- post-processing ----------
  // Visual polish (settings toggle, `voltaic.post`): the city is drawn into an offscreen target instead of the
  // canvas, then one pass adds the glow on the neon and gold, local light from muzzles, gates and signs, a
  // depth-aware tilt-shift blur, a colour grade and a vignette. Off, the frame is drawn straight to the canvas as
  // before, so the old look is untouched. The 2D overlay (#fx) is its own canvas on top and never goes through it.
  // Loosely after Cinderwatch's post stack (github.com/kevintngo/cinderwatch, MIT, src/20-post.js); the shaders are
  // written for this game, no code taken.
  const POST_KEY = 'voltaic.post', POST_LIGHTS = 16;
  const PT = {   // the look, tuned by eye; dev: ?tune adds sliders
    thr: 0.58, knee: 0.3, glow: 0.55, wide: 0.45,   // bloom: threshold on the brightest channel, tight and wide mix
    tilt: 0.9, ramp: 0.25,                           // tilt-shift: strongest mix, ramp length as a share of the map's depth
    sat: 1.1, contrast: 1.06, vig: 0.42, lamp: 1.0,  // grade, vignette, local light strength
  };
  // quality steps a slow device walks down before the polish gives up: [offscreen size, MSAA samples]
  const POST_TIERS = [[1, 4], [1, 2], [0.8, 2], [0.67, 2]];
  const post = { ok: gl.capabilities.isWebGL2, on: false, auto: true, scene: null, rts: null, tier: 0, frames: [], last: 0 };
  const fullVS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const postMat = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ uniforms, vertexShader: fullVS, fragmentShader, depthTest: false, depthWrite: false });
  // Built on first use, so with the polish off nothing is made: three.js draws every new object's id from
  // Math.random, the same stream that lays out the lit windows, and the off look must match the old one exactly.
  let brightMat, gaussMat, downMat, compMat, postQuad, postScene, backMesh;
  function postInit() {
    if (compMat) return;
    // bright parts only, weighted to saturated colour (neon, gold, lamps) over plain pale stone
    brightMat = postMat(`uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThr, uKnee; varying vec2 vUv;
      vec3 pick(vec2 o){ vec3 c = texture2D(tSrc, vUv + o).rgb; float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
        float sat = mx > 0.0 ? (mx - mn) / mx : 0.0; return c * smoothstep(uThr, uThr + uKnee, mx) * (0.45 + 0.55 * sat); }
      void main(){ vec2 h = uTexel * 0.5; gl_FragColor = vec4((pick(-h) + pick(h) + pick(vec2(h.x, -h.y)) + pick(vec2(-h.x, h.y))) * 0.25, 1.0); }`,
    { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThr: { value: PT.thr }, uKnee: { value: PT.knee } });
    // a 13-tap Gaussian (sigma 3) folded into 7 bilinear taps: each pair of neighbours is one fetch between them
    const gw = (i) => Math.exp(-(i * i) / 18), taps = [[1, 2], [3, 4], [5, 6]].map(([a, b]) => [(a * gw(a) + b * gw(b)) / (gw(a) + gw(b)), gw(a) + gw(b)]);
    const gsum = 1 + 2 * taps.reduce((n, t) => n + t[1], 0), f = (x) => x.toFixed(5);
    gaussMat = postMat(`uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tSrc, vUv).rgb;
        ${taps.map(([o, w]) => `c += (texture2D(tSrc, vUv + uDir * ${f(o)}).rgb + texture2D(tSrc, vUv - uDir * ${f(o)}).rgb) * ${f(w)};`).join(' ')}
        gl_FragColor = vec4(c / ${f(gsum)}, 1.0); }`, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    // the frame shrunk to quarter size (four bilinear taps, 16 pixels) for the tilt-shift's soft copy
    downMat = postMat(`uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main(){ vec2 h = uTexel; gl_FragColor = vec4((texture2D(tSrc, vUv - h).rgb + texture2D(tSrc, vUv + h).rgb
        + texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb + texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb) * 0.25, 1.0); }`,
    { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    compMat = postMat(`#define NL ${POST_LIGHTS}
      uniform sampler2D tScene, tDepth, tSoft, tGlow, tWide; uniform mat4 uInvProj; uniform vec3 uFocus; uniform vec2 uAspect;
      uniform vec4 uLP[NL]; uniform vec3 uLC[NL]; uniform int uN; uniform float uGlow, uWide, uTilt, uSat, uCon, uVig, uLamp, uTime;
      varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tScene, vUv).rgb;
        float d = texture2D(tDepth, vUv).x;
        vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vp.xyz /= vp.w;
        float z = -vp.z;
        // tilt-shift: the map's own depth span stays sharp, the skyline beyond and the apron before it soften
        float coc = d >= 1.0 ? 1.0 : clamp(max(uFocus.x - z, z - uFocus.y) / uFocus.z, 0.0, 1.0);
        float tk = smoothstep(0.0, 1.0, coc) * uTilt;
        if (tk > 0.002) c = mix(c, texture2D(tSoft, vUv).rgb, tk);   // the sharp middle skips the fetch
        // local light: point lights in view space, falling off over their radius, brightest near the ground
        if (d < 1.0) {
          vec3 acc = vec3(0.0);
          for (int i = 0; i < NL; i++) { if (i >= uN) break;
            vec3 dv = uLP[i].xyz - vp.xyz; float a = max(0.0, 1.0 - dot(dv, dv) / (uLP[i].w * uLP[i].w)); acc += uLC[i] * a * a; }
          c += acc * uLamp * (c * 1.6 + 0.05);
        }
        // glow: screen-blended so lit parts bloom without washing to white
        vec3 g = texture2D(tGlow, vUv).rgb * uGlow + texture2D(tWide, vUv).rgb * uWide;
        c = 1.0 - (1.0 - c) * (1.0 - g);
        // grade: a gentle S-curve, a little more colour, cool navy shadows and warm brass highlights
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        c = clamp((c - 0.5) * uCon + 0.5, 0.0, 1.0);
        c += vec3(-0.012, 0.0, 0.03) * (1.0 - l) * (1.0 - l) + vec3(0.03, 0.012, -0.022) * l * l;
        // vignette, rounder on wide screens
        vec2 q = (vUv - 0.5) * uAspect.xy / max(uAspect.x, 1.0);
        c *= 1.0 - uVig * smoothstep(0.25, 0.85, length(q) * 1.25);
        // a fleck of noise keeps the long dark gradients from banding (far below a visible dither)
        c += (fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
        gl_FragColor = vec4(c, 1.0);
      }`, {
      tScene: { value: null }, tDepth: { value: null }, tSoft: { value: null }, tGlow: { value: null }, tWide: { value: null },
      uInvProj: { value: new THREE.Matrix4() }, uFocus: { value: new THREE.Vector3() }, uAspect: { value: new THREE.Vector2(1, 1) },
      uLP: { value: Array.from({ length: POST_LIGHTS }, () => new THREE.Vector4()) }, uLC: { value: Array.from({ length: POST_LIGHTS }, () => new THREE.Vector3()) },
      uN: { value: 0 }, uGlow: { value: PT.glow }, uWide: { value: PT.wide }, uTilt: { value: PT.tilt }, uSat: { value: PT.sat }, uCon: { value: PT.contrast }, uVig: { value: PT.vig }, uLamp: { value: PT.lamp }, uTime: { value: 0 },
    });
    postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat); postQuad.frustumCulled = false;
    postScene = new THREE.Scene(); postScene.add(postQuad);
    // the reflection backdrop as the first thing the city pass draws, so the offscreen frame is drawn (and its
    // multisampled colour and depth resolved) once per frame, not twice
    backMesh = new THREE.Mesh(quadScene.children[0].geometry, blurMat); backMesh.frustumCulled = false;
    backMesh.renderOrder = -1e9; backMesh.visible = false; scene.add(backMesh);
  }
  const pass = (mat, target) => { postQuad.material = mat; gl.setRenderTarget(target); gl.render(postScene, quadCam); };
  try { const v = localStorage.getItem(POST_KEY); if (v !== null) { post.auto = false; post.on = v === '1'; } else post.on = true; } catch (e) { post.on = true; /* storage blocked */ }
  post.on = post.on && post.ok;
  // (Re)size the offscreen targets; off, they are freed.
  function postSize() {
    if (!post.on) {
      if (post.scene) post.scene.depthTexture.dispose(), post.scene.dispose();
      if (post.rts) for (const r of Object.values(post.rts)) r.dispose();
      post.scene = post.rts = null;
      return;
    }
    postInit();
    const [k, ms] = POST_TIERS[post.tier];
    const w = Math.max(1, Math.round(gl.domElement.width * k)), h = Math.max(1, Math.round(gl.domElement.height * k));
    if (post.scene && post.scene.samples !== ms) { post.scene.depthTexture.dispose(); post.scene.dispose(); post.scene = null; }
    post.frames.length = 0;   // a new size compiles and allocates: time the frames after it afresh
    if (!post.scene) {
      const dt = new THREE.DepthTexture(w, h); dt.type = THREE.UnsignedIntType;
      post.scene = new THREE.WebGLMultisampleRenderTarget(w, h, { depthTexture: dt }); post.scene.samples = ms;
      post.scene.texture.encoding = THREE.sRGBEncoding;   // materials write display-ready colour, as on the canvas
      const rt = () => new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
      if (!post.rts) post.rts = { half: rt(), halfB: rt(), quarter: rt(), quarterB: rt(), soft: rt(), softB: rt() };
    }
    post.scene.setSize(w, h);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    for (const k of ['half', 'halfB']) post.rts[k].setSize(hw, hh);
    for (const k of ['quarter', 'quarterB', 'soft', 'softB']) post.rts[k].setSize(qw, qh);
  }
  // This frame's local lights, in view space: gates, explosions, muzzle flashes, then the neon signs by the map.
  const _lv = new THREE.Vector3(), _lc = new THREE.Color(), postNeon = [];
  function postLights(time) {
    const L = [];
    const add = (x, h, z, r, hex, k) => { if (k > 0.02) L.push({ x, h, z, r, hex, k }); };
    for (const g of gates) {
      const power = Math.max(0, state.lives) / maxLives();
      add(g.x / T, 1.1, g.y / T, g.exit ? 3.6 : 3, g.exit ? P.lantern : P.ember, (g.exit ? 0.12 + 0.2 * power + 0.6 * g.flash : 0.3 + 0.06 * Math.sin(time * 4)));
    }
    const hot = [];
    for (const f of state.effects) if (f.type === 'flash') hot.push({ x: f.x / T, h: 0.5, z: f.y / T, r: Math.max(1.5, (f.R / T) * 2.2), hex: P.lantern, k: 1.4 * f.life / f.max });
    for (const t of state.towers) {
      if (!(t.flash > 0) || t.disabledT > 0) continue;
      const m = towerMeshes.get(t.id), mz = m && m.userData.muzzle, by = baseY(t);
      const acc = towerAccent(t), hex = t.key === 'tesla' || t.key === 'frost' ? P.ice : t.key === 'flame' ? P.ember : acc ? acc.color : P.lantern;
      if (mz) hot.push({ x: (t.x + Math.cos(t.aim) * mz.r * T) / T, h: by + mz.h, z: (t.y + Math.sin(t.aim) * mz.r * T) / T, r: 2.4, hex, k: Math.min(1, t.flash / 0.1) });
      else { const lt = m && m.userData.light; hot.push({ x: (t.x + ((lt && lt.ox) || 0) * T) / T, h: by + (lt ? lt.h : 1), z: (t.y + ((lt && lt.oy) || 0) * T) / T, r: 2.4, hex, k: Math.min(1, t.flash / 0.15) }); }
    }
    hot.sort((a, b) => b.k - a.k);
    for (const h of hot) { if (L.length >= POST_LIGHTS - 4) break; L.push(h); }
    for (const n of postNeon) { if (L.length >= POST_LIGHTS) break; L.push(n); }
    const U = compMat.uniforms, V = camera.matrixWorldInverse;
    L.forEach((l, i) => {
      _lv.set(l.x, l.h, l.z).applyMatrix4(V); U.uLP.value[i].set(_lv.x, _lv.y, _lv.z, l.r);
      _lc.set(l.hex); U.uLC.value[i].set(_lc.r * l.k, _lc.g * l.k, _lc.b * l.k);
    });
    U.uN.value = L.length;
  }
  // The neon signs that light the street: the biggest pools at the map's edge, chosen once per map.
  function pickNeon(glows) {
    const hex = { coral: '#ff6f61', teal: P.teal, pink: '#ff4fa8', amber: '#ffb24d' };
    postNeon.length = 0;
    glows.filter((s) => s.pool && s.x > -APRON && s.z > -APRON && s.x < COLS + APRON && s.z < ROWS + APRON)
      .sort((a, b) => b.pool - a.pool).slice(0, 4)
      .forEach((s) => postNeon.push({ x: s.x, h: Math.min(s.y, 2), z: s.z, r: 1.6 + s.pool * 1.6, hex: hex[s.c] || P.teal, k: 0.35 }));
  }
  // After the city is drawn into post.scene: glow chain, soft copy for the tilt-shift, then the composite to the canvas.
  const _fc = new THREE.Vector3();
  function runPost(now) {
    const R = post.rts, B = brightMat.uniforms, G = gaussMat.uniforms, U = compMat.uniforms;
    const w = post.scene.width, h = post.scene.height;
    B.tSrc.value = post.scene.texture; B.uTexel.value.set(1 / w, 1 / h); B.uThr.value = PT.thr; B.uKnee.value = PT.knee;
    pass(brightMat, R.half);
    const blur = (src, mid, dst, tw, th, k) => {
      G.tSrc.value = src.texture; G.uDir.value.set(k / tw, 0); pass(gaussMat, mid);
      G.tSrc.value = mid.texture; G.uDir.value.set(0, k / th); pass(gaussMat, dst);
    };
    blur(R.half, R.halfB, R.half, R.half.width, R.half.height, 1);
    blur(R.half, R.quarterB, R.quarter, R.quarter.width, R.quarter.height, 1.6);
    // the soft copy: the frame at quarter size, blurred about as wide as the old half-size one (sigma ~9 pixels)
    downMat.uniforms.tSrc.value = post.scene.texture; downMat.uniforms.uTexel.value.set(1 / w, 1 / h); pass(downMat, R.softB);
    blur(R.softB, R.soft, R.softB, R.soft.width, R.soft.height, 0.75);
    const soft = R.softB;
    // focus: the nearest and farthest view depth of the map's ground; the ramp is a share of that span
    let zn = Infinity, zf = 0;
    for (const [x, z] of [[0, 0], [COLS, 0], [0, ROWS], [COLS, ROWS]]) {
      const d = -_fc.set(x, 0, z).applyMatrix4(camera.matrixWorldInverse).z;
      zn = Math.min(zn, d); zf = Math.max(zf, d);
    }
    U.uFocus.value.set(zn, zf, Math.max(1, (zf - zn) * PT.ramp)); U.uAspect.value.set(w / h, 1);
    U.uInvProj.value.copy(camera.projectionMatrixInverse);
    U.tScene.value = post.scene.texture; U.tDepth.value = post.scene.depthTexture; U.tSoft.value = soft.texture;
    U.tGlow.value = R.half.texture; U.tWide.value = R.quarter.texture;
    U.uGlow.value = PT.glow; U.uWide.value = PT.wide; U.uTilt.value = PT.tilt; U.uSat.value = PT.sat; U.uCon.value = PT.contrast; U.uVig.value = PT.vig; U.uLamp.value = PT.lamp;
    U.uTime.value = (now % 1000) / 10;
    postLights(state.time);
    pass(compMat, null);
  }
  function setPost(on, save = true) {
    post.on = !!on && post.ok; post.tier = 0;
    if (save) { post.auto = false; try { localStorage.setItem(POST_KEY, post.on ? '1' : '0'); } catch (e) { /* storage blocked */ } }
    postSize();
  }
  // Frame watch while the polish is on: every ~60 frames, if the median frame is slower than ~52 fps, step one
  // quality tier down (fewer MSAA samples, then a smaller offscreen frame). Past the last tier, with no saved
  // choice, the polish turns off for this session (not saved, so a faster device or a later visit checks again).
  // The tier is per session too: a reload starts at full quality.
  function postWatch(now) {
    const f = post.frames;
    if (now - post.last > 1500) f.length = 0;   // a hidden tab or a stall: start the sample over
    post.last = now; f.push(now);
    // the first 10 after a (re)size are compiles and uploads; then 60 frames or 4 s, whichever is first
    if (f.length <= 10 || (f.length < 70 && now - f[10] < 4000)) return;
    const dts = f.slice(11).map((t, i) => t - f[10 + i]).sort((x, y) => x - y), med = dts[dts.length >> 1];
    f.length = 0;
    if (med <= 19) return;
    // far too slow for any tier (under 20 fps) with no saved choice: off at once
    if (post.auto && (med > 50 || (med > 25 && post.tier === POST_TIERS.length - 1))) { setPost(false, false); syncSettings(); }
    else if (post.tier < POST_TIERS.length - 1) { post.tier++; postSize(); }
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = Math.max(1, window.innerHeight);
    gl.setPixelRatio(dpr); gl.setSize(w, h, false);
    const rw = Math.max(1, Math.floor((w * dpr) / 2)), rh = Math.max(1, Math.floor((h * dpr) / 2));
    reflA.setSize(rw, rh); reflB.setSize(rw, rh); reflTexel.set(1 / rw, 1 / rh);
    postSize();
    fx.width = Math.round(w * dpr); fx.height = Math.round(h * dpr);
    Object.assign(view, { w: fx.width, h: fx.height, dpr });
    camera.aspect = w / h; camera.updateProjectionMatrix();
    fitCamera();
  }
  // Pull the camera back just far enough that the whole map sits between the top bar and the build bar.
  function fitCamera() {
    const h = Math.max(1, window.innerHeight);
    // the far edge of the map stops well short of the top, leaving the skyline and the night sky above it
    const yMax = 0.56, yMin = -1 + (2 * 80) / h, xMax = 0.985;
    const back = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
    const place = (d, tz) => { camera.position.set(COLS / 2, 0, tz).addScaledVector(back, d); camera.lookAt(COLS / 2, 0, tz); camera.updateMatrixWorld(); };
    const ndc = (x, z) => _v.set(x, 0, z).project(camera);
    const fits = (d) => {
      // slide the view until the far edge of the map sits just under the top bar
      let lo = -ROWS * 2, hi = ROWS * 3;
      for (let i = 0; i < 24; i++) { const tz = (lo + hi) / 2; place(d, tz); if (ndc(0, 0).y > yMax) hi = tz; else lo = tz; }
      place(d, lo);
      const n = ndc(0, ROWS);
      return n.y >= yMin && Math.abs(n.x) <= xMax;
    };
    let lo = 3, hi = 400;
    for (let i = 0; i < 24; i++) { const d = (lo + hi) / 2; if (fits(d)) hi = d; else lo = d; }
    fits(hi);
    const a = proj((COLS / 2) * T, (ROWS / 2) * T), b = proj((COLS / 2 + 1) * T, (ROWS / 2) * T);
    // this fitted view is the base the player's zoom, rotation and pan start from
    _v.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const s = -camera.position.y / _v.y;
    Object.assign(cam.base, { d: hi, x: camera.position.x + _v.x * s, z: camera.position.z + _v.z * s, ppt: b.x - a.x });
    placeCamera();
  }

  // ---------- the player's camera ----------
  // zoom 1 is the fitted view; yaw turns the view around the point it looks at; x/z pan that point (in tiles).
  // Input moves the goal and the camera eases toward it, except panning, which follows the pointer exactly.
  const ZOOM_MIN = 0.7, ZOOM_MAX = 3.5;
  const cam = {
    zoom: 1, yaw: 0, x: 0, z: 0,
    goal: { zoom: 1, yaw: 0, x: 0, z: 0 },
    base: { d: 30, x: 0, z: 0, ppt: 32 },
    last: 0,
  };
  const _back = new THREE.Vector3();
  function clampGoal() {
    const g = cam.goal, b = cam.base;
    g.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, g.zoom));
    // keep the point the camera looks at on the map
    g.x = Math.min(COLS - b.x, Math.max(-b.x, g.x));
    g.z = Math.min(ROWS - b.z, Math.max(-b.z, g.z));
  }
  function placeCamera() {
    const b = cam.base, tx = b.x + cam.x, tz = b.z + cam.z;
    _back.set(Math.sin(cam.yaw) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(cam.yaw) * Math.cos(PITCH));
    camera.position.set(tx, 0, tz).addScaledVector(_back, b.d / cam.zoom);
    camera.lookAt(tx, 0, tz); camera.updateMatrixWorld();
    view.ppt = b.ppt * cam.zoom; // the same spot is 1/zoom as far away, so it looks zoom times as big
  }
  function easeCamera(now) {
    const dt = Math.min(0.1, (now - (cam.last || now)) / 1000); cam.last = now;
    const k = 1 - Math.exp(-dt * 14), g = cam.goal;
    let moved = false;
    for (const key of ['zoom', 'yaw', 'x', 'z']) {
      const diff = g[key] - cam[key];
      if (Math.abs(diff) < 1e-4) { if (diff) { cam[key] = g[key]; moved = true; } continue; }
      cam[key] += diff * k; moved = true;
    }
    if (moved) placeCamera();
  }
  // the ground under a screen point, in tiles (null in the sky)
  function groundAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndcV.set(((clientX - r.left) / r.width) * 2 - 1, 1 - ((clientY - r.top) / r.height) * 2);
    raycaster.setFromCamera(ndcV, camera);
    return raycaster.ray.intersectPlane(groundPlane, hitV) ? { x: hitV.x, z: hitV.z } : null;
  }
  // zoom by a factor, keeping the ground under (clientX, clientY) where it is on screen
  function zoomBy(f, clientX, clientY) {
    const g = cam.goal, b = cam.base, z0 = g.zoom;
    g.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z0 * f));
    const p = clientX == null ? null : groundAt(clientX, clientY);
    if (p) {
      const k = z0 / g.zoom;
      g.x = p.x + (b.x + g.x - p.x) * k - b.x;
      g.z = p.z + (b.z + g.z - p.z) * k - b.z;
    }
    clampGoal();
  }
  // drag the ground from one screen point to another
  function panBetween(ax, ay, bx, by) {
    const p = groundAt(ax, ay), q = groundAt(bx, by);
    if (!p || !q) return;
    cam.goal.x += p.x - q.x; cam.goal.z += p.z - q.z;
    clampGoal();
    cam.x = cam.goal.x; cam.z = cam.goal.z;
    placeCamera();
  }
  function rotateBy(a) { cam.goal.yaw += a; }
  function resetCamera() { Object.assign(cam.goal, { zoom: 1, x: 0, z: 0, yaw: Math.round(cam.goal.yaw / (2 * Math.PI)) * 2 * Math.PI }); }
  // Before anything is built, reshape the map itself to the new window; after that, only re-aim the camera.
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    if (!COLS) return;
    resize();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state && state.wave === 0 && state.towers.length === 0) {
        buildMap(mapDef);
        state.occ = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
        state.selected = null; state.hover = null;
      }
    }, 150);
  });

  const inBounds = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
  const tileAt = (px, py) => {
    const x = Math.floor(px / T), y = Math.floor(py / T);
    return inBounds(x, y) ? grid[y][x] : null;
  };

  // ---------- ground: the city's paving, painted once into a texture ----------
  const A = window.TD_ART, P = A.P, TAU = A.TAU;
  let terrainCtx = null, alphaCanvas = null, alphaCtx = null;
  let chimneys = [];            // rooftops that breathe steam
  let pathMarks = new Map();    // "x,y" -> { ang } for chevrons along the boulevard, or { corner: true }
  // How much of the ground's own colour shows. The rest is the city's reflection in the polished stone.
  const APRON = 4; // tiles of paving painted past each map edge
  const FRONT = 2.2; // the frontage street: tiles from the map edge to the first building face of the city round it
  const POLISH = { walk: 0.45, lot: 0.9, grass: 0.62, rock: 0.62, path: 0.85, hill: 1, water: 0.4, forest: 0.8 };
  const CHIPS = ['rgba(239, 228, 200, 0.5)', 'rgba(255, 111, 97, 0.55)', 'rgba(46, 230, 207, 0.4)', 'rgba(212, 175, 90, 0.5)', 'rgba(3, 14, 20, 0.5)'];
  // the playfield's moonlight: a wash painted into the paving (more of it on and beside the boulevard), and
  // `moonPool`, a soft spotlight straight above the map (height and reach in tiles past the map's half-diagonal)
  const FIELD_LIGHT = { wash: '150, 176, 240', washA: 0.2, roadA: 0.3, roadReach: 1.6, roadLift: 0.22, color: 0xc4d2ff, power: 1.1, height: 46, reach: 1.25 };
  const NEON_RGB = { coral: '255, 111, 97', teal: '46, 230, 207', pink: '255, 79, 168', amber: '255, 178, 77' };

  function paintTerrain() {
    const res = Math.min(64, Math.floor(4096 / (Math.max(COLS, ROWS) + 2 * APRON)));
    terrainCanvas = document.createElement('canvas');
    terrainCanvas.width = (COLS + 2 * APRON) * res; terrainCanvas.height = (ROWS + 2 * APRON) * res;
    terrainCtx = terrainCanvas.getContext('2d');
    terrainCtx.setTransform(res / T, 0, 0, res / T, APRON * res, APRON * res);   // map coordinates stay as they were
    alphaCanvas = document.createElement('canvas');
    alphaCanvas.width = (COLS + 2 * APRON) * 4; alphaCanvas.height = (ROWS + 2 * APRON) * 4;
    alphaCtx = alphaCanvas.getContext('2d');
    alphaCtx.setTransform(1, 0, 0, 1, APRON * 4, APRON * 4);
    markPath();
    paintApron();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) paintTile(x, y);
    paintFieldLight();
  }
  // Light of one colour spilling out of every tile of terrain `t` onto its neighbours, fading over L pixels.
  // edge = whether the map edge counts as more of the same (no spill across it).
  function spill(g, t, L, rgb, a, edge) {
    const is = (x, y) => (inBounds(x, y) ? grid[y][x] === t : edge);
    const stops = (gr) => { gr.addColorStop(0, `rgba(${rgb}, ${a})`); gr.addColorStop(0.35, `rgba(${rgb}, ${a * 0.32})`); gr.addColorStop(1, `rgba(${rgb}, 0)`); return gr; };
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (grid[y][x] !== t) continue;
      const ox = x * T, oy = y * T;
      const out = { n: !is(x, y - 1), s: !is(x, y + 1), w: !is(x - 1, y), e: !is(x + 1, y) };
      if (out.n) { g.fillStyle = stops(g.createLinearGradient(0, oy, 0, oy - L)); g.fillRect(ox, oy - L, T, L); }
      if (out.s) { g.fillStyle = stops(g.createLinearGradient(0, oy + T, 0, oy + T + L)); g.fillRect(ox, oy + T, T, L); }
      if (out.w) { g.fillStyle = stops(g.createLinearGradient(ox, 0, ox - L, 0)); g.fillRect(ox - L, oy, L, T); }
      if (out.e) { g.fillStyle = stops(g.createLinearGradient(ox + T, 0, ox + T + L, 0)); g.fillRect(ox + T, oy, L, T); }
      for (const [p, q, qx, qy] of [[out.n, out.w, 0, 0], [out.n, out.e, 1, 0], [out.s, out.w, 0, 1], [out.s, out.e, 1, 1]]) {
        if (!p || !q) continue;
        const px = ox + qx * T, py = oy + qy * T;
        g.fillStyle = stops(g.createRadialGradient(px, py, 0, px, py, L));
        g.fillRect(qx ? px : px - L, qy ? py : py - L, L, L);
      }
    }
  }
  // Moonlight on the paving: a cool wash over the whole map that dies away across the frontage street,
  // strongest on the pale boulevard, which throws some of it back onto the paving beside it.
  function paintFieldLight() {
    const g = terrainCtx, aw = COLS * T, ah = ROWS * T, F = FIELD_LIGHT, L = FRONT * T;
    const c = (k) => `rgba(${F.wash}, ${F.washA * k})`;
    g.save(); g.globalCompositeOperation = 'screen';
    // brightest mid-field, easing off a little towards the edges
    const mid = g.createRadialGradient(aw / 2, ah / 2, 0, aw / 2, ah / 2, Math.hypot(aw, ah) / 2);
    mid.addColorStop(0, c(1)); mid.addColorStop(1, c(0.7));
    g.fillStyle = mid; g.fillRect(0, 0, aw, ah);
    const fade = (gr) => { gr.addColorStop(0, c(0.7)); gr.addColorStop(0.4, c(0.25)); gr.addColorStop(1, c(0)); return gr; };
    g.fillStyle = fade(g.createLinearGradient(0, 0, 0, -L)); g.fillRect(0, -L, aw, L);
    g.fillStyle = fade(g.createLinearGradient(0, ah, 0, ah + L)); g.fillRect(0, ah, aw, L);
    g.fillStyle = fade(g.createLinearGradient(0, 0, -L, 0)); g.fillRect(-L, 0, L, ah);
    g.fillStyle = fade(g.createLinearGradient(aw, 0, aw + L, 0)); g.fillRect(aw, 0, L, ah);
    for (const [px, py] of [[0, 0], [aw, 0], [0, ah], [aw, ah]]) {
      g.fillStyle = fade(g.createRadialGradient(px, py, 0, px, py, L));
      g.fillRect(px ? px : px - L, py ? py : py - L, L, L);
    }
    spill(g, 'path', F.roadReach * T, F.wash, F.roadA, true);
    g.fillStyle = `rgba(${F.wash}, ${F.roadLift})`;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (grid[y][x] === 'path') g.fillRect(x * T, y * T, T, T);
    g.restore();
  }
  function paintTile(x, y) {
    paintGround(terrainCtx, x, y);
    const t = grid[y][x];
    const v = Math.round(POLISH[restricted && t === 'grass' ? 'lot' : t] * 255);
    alphaCtx.fillStyle = `rgb(${v},${v},${v})`;
    alphaCtx.fillRect(x * 4, y * 4, 4, 4);
  }

  // The paving carries on past the map edge, fading into the dark, so the playfield has no seam.
  function paintApron() {
    const g = terrainCtx, aw = COLS * T, ah = ROWS * T, ap = APRON * T;
    // alpha: the apron starts as polished as the grass and goes glassier towards the city
    alphaCtx.fillStyle = 'rgb(51,51,51)'; alphaCtx.fillRect(-APRON * 4, -APRON * 4, (COLS + 2 * APRON) * 4, (ROWS + 2 * APRON) * 4);
    const hi = Math.round(POLISH.grass * 255), lo = 51;
    const ramp = (x0, y0, x1, y1, rx, ry, rw, rh) => {
      const gr = alphaCtx.createLinearGradient(x0 * 4, y0 * 4, x1 * 4, y1 * 4);
      gr.addColorStop(0, `rgb(${hi},${hi},${hi})`); gr.addColorStop(1, `rgb(${lo},${lo},${lo})`);
      alphaCtx.fillStyle = gr; alphaCtx.fillRect(rx * 4, ry * 4, rw * 4, rh * 4);
    };
    ramp(0, 0, -APRON, 0, -APRON, -APRON, APRON, ROWS + 2 * APRON);
    ramp(COLS, 0, COLS + APRON, 0, COLS, -APRON, APRON, ROWS + 2 * APRON);
    ramp(0, 0, 0, -APRON, 0, -APRON, COLS, APRON);
    ramp(0, ROWS, 0, ROWS + APRON, 0, ROWS, COLS, APRON);
    // 1. the plaza's own paving, without studs or medallions
    const outside = (x, y) => x < 0 || y < 0 || x >= COLS || y >= ROWS;
    for (let y = -APRON; y < ROWS + APRON; y++) for (let x = -APRON; x < COLS + APRON; x++) {
      if (!outside(x, y)) continue;
      const r = rng(((x + 97) * 83492791) ^ ((y + 13) * 19349663)), ox = x * T, oy = y * T;
      g.save(); g.beginPath(); g.rect(ox, oy, T, T); g.clip();
      g.fillStyle = P.navy; g.fillRect(ox, oy, T, T);
      A.veins(g, ox, oy, T, T, r, 1, 'rgba(70, 96, 150, 0.16)');
      g.strokeStyle = P.navySeam; g.lineWidth = 0.6;
      g.strokeRect(ox + 0.3, oy + 0.3, T - 0.6, T - 0.6);
      g.restore();
    }
    // 2. fade into the dark across the outer edge (west and east run full height, so the corners are covered)
    const clear = 'rgba(6, 10, 24, 0)', far = 'rgba(6, 10, 24, 0.85)';
    const fade = (x0, y0, x1, y1, rx, ry, rw, rh) => {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, clear); gr.addColorStop(1, far);
      g.fillStyle = gr; g.fillRect(rx, ry, rw, rh);
    };
    const f0 = (FRONT - 0.3) * T; // the street stays lit to the building line, then the paving runs on under the city
    fade(-f0, 0, -ap, 0, -ap, -ap, ap, ah + 2 * ap);
    fade(aw + f0, 0, aw + ap, 0, aw, -ap, ap, ah + 2 * ap);
    fade(0, -f0, 0, -ap, 0, -ap, aw, ap);
    fade(0, ah + f0, 0, ah + ap, 0, ah, aw, ap);
    // the kerb of the frontage street: a thin gold line, with the pavement under the shopfronts a shade lighter
    const kb = (FRONT - 0.6) * T;
    g.fillStyle = 'rgba(120, 140, 190, 0.07)';
    g.fillRect(-FRONT * T, -FRONT * T, aw + 2 * FRONT * T, FRONT * T - kb); g.fillRect(-FRONT * T, ah + kb, aw + 2 * FRONT * T, FRONT * T - kb);
    g.fillRect(-FRONT * T, -kb, FRONT * T - kb, ah + 2 * kb); g.fillRect(aw + kb, -kb, FRONT * T - kb, ah + 2 * kb);
    g.strokeStyle = 'rgba(212, 175, 90, 0.45)'; g.lineWidth = 0.8; g.strokeRect(-kb, -kb, aw + 2 * kb, ah + 2 * kb);
    // 3. the boundary: a double gold inlay on the map rectangle
    g.strokeStyle = P.goldLo; g.lineWidth = 2; g.strokeRect(-1, -1, aw + 2, ah + 2);
    g.strokeStyle = P.gold; g.lineWidth = 0.9; g.strokeRect(-3, -3, aw + 6, ah + 6);
    // 4. the boulevard carries on across the apron at both ends
    for (const r of routes) continueRoad(g, r.pts[0], r.pts[1]);
    continueRoad(g, path.pts[path.pts.length - 1], path.pts[path.pts.length - 2]);
  }
  function continueRoad(g, p, q) {
    const dx = Math.sign(p.x - q.x), dy = Math.sign(p.y - q.y);
    let tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
    const along = [dy !== 0, dy !== 0, dx !== 0, dx !== 0, [true, true, true, true]]; // kerbs on the sides only
    for (let k = 0; k < APRON; k++, tx += dx, ty += dy) {
      const ox = tx * T, oy = ty * T, r = rng(((tx + 5) * 73856093) ^ ((ty + 5) * 19349663));
      g.save(); g.globalAlpha = Math.max(0, 1 - k / APRON); g.beginPath(); g.rect(ox, oy, T, T); g.clip();
      paintRoad(g, ox, oy, along, null, r);
      g.restore();
    }
  }

  // Wet paving picks up the light above it: a pool of colour under every neon sign, and teal spilling out
  // from under the terraces. Painted once, over the finished ground.
  function paintGlows(glows) {
    const g = terrainCtx;
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const s of glows) {
      if (!s.pool || s.x < -APRON || s.z < -APRON || s.x > COLS + APRON || s.z > ROWS + APRON) continue;
      const px = s.x * T, py = s.z * T, rad = s.pool * T * 1.25;
      const gr = g.createRadialGradient(px, py, 0, px, py, rad);
      gr.addColorStop(0, `rgba(${NEON_RGB[s.c]}, 0.5)`); gr.addColorStop(0.5, `rgba(${NEON_RGB[s.c]}, 0.16)`); gr.addColorStop(1, `rgba(${NEON_RGB[s.c]}, 0)`);
      g.fillStyle = gr; g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    spill(g, 'hill', T * 0.8, '46, 230, 207', 0.5, false);
    g.restore();
  }

  // Chevrons on every straight stretch of road point the way the enemy marches; turns get a medallion.
  function markPath() {
    pathMarks = new Map();
    const key = (p) => `${Math.floor(p.x / T)},${Math.floor(p.y / T)}`;
    for (const { segs } of routes) segs.forEach((s, i) => {
      const ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
      const n = Math.round(s.len / T);
      for (let k = 1; k < n; k++) {
        const f = k / n;
        pathMarks.set(key({ x: s.a.x + (s.b.x - s.a.x) * f, y: s.a.y + (s.b.y - s.a.y) * f }), { ang });
      }
      if (i < segs.length - 1) {
        const nx = segs[i + 1];
        const ang2 = Math.atan2(nx.b.y - nx.a.y, nx.b.x - nx.a.x);
        pathMarks.set(key(s.b), Math.abs(ang2 - ang) > 0.01 ? { corner: true } : { ang });
      }
    });
  }

  // Frame lines inset along the tile's edges that face a different terrain, meeting cleanly at the corners.
  function edgeFrame(g, ox, oy, same, i, color, w) {
    g.beginPath();
    const [up, down, left, right] = same;
    const x0 = left ? ox : ox + i, x1 = right ? ox + T : ox + T - i;
    const y0 = up ? oy : oy + i, y1 = down ? oy + T : oy + T - i;
    if (!up) { g.moveTo(x0, oy + i); g.lineTo(x1, oy + i); }
    if (!down) { g.moveTo(x0, oy + T - i); g.lineTo(x1, oy + T - i); }
    if (!left) { g.moveTo(ox + i, y0); g.lineTo(ox + i, y1); }
    if (!right) { g.moveTo(ox + T - i, y0); g.lineTo(ox + T - i, y1); }
    // inside corners: close the gap between the two neighbours' frames
    const diag = same[4];
    for (const [dx, dy, k] of [[-1, -1, 0], [1, -1, 1], [-1, 1, 2], [1, 1, 3]]) {
      const sideX = dx < 0 ? left : right, sideY = dy < 0 ? up : down;
      if (!sideX || !sideY || diag[k]) continue;
      const cx = dx > 0 ? ox + T : ox, cy = dy > 0 ? oy + T : oy;
      const ix = cx - dx * i, iy = cy - dy * i;
      g.moveTo(ix, cy); g.lineTo(ix, iy); g.lineTo(cx, iy);
    }
    g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'square'; g.stroke();
    g.lineCap = 'butt';
  }

  function plaza(g, ox, oy, r) {
    g.fillStyle = P.navy; g.fillRect(ox, oy, T, T);
    A.veins(g, ox, oy, T, T, r, 1, 'rgba(70, 96, 150, 0.16)');
    g.strokeStyle = P.navySeam; g.lineWidth = 0.6;
    g.strokeRect(ox + 0.3, oy + 0.3, T - 0.6, T - 0.6);
    // gold studs where four paving stones meet (each tile paints its quarter)
    g.fillStyle = 'rgba(212, 175, 90, 0.5)';
    for (const [cx, cy] of [[ox, oy], [ox + T, oy], [ox, oy + T], [ox + T, oy + T]]) { A.diamond(g, cx, cy, 1.9); g.fill(); }
    if (r() < 0.05) {
      // the odd inlaid sunburst medallion
      const mx = ox + T / 2, my = oy + T / 2;
      g.beginPath(); g.arc(mx, my, 3, 0, TAU);
      g.strokeStyle = 'rgba(212, 175, 90, 0.3)'; g.lineWidth = 0.6; g.stroke();
      A.sunburst(g, mx, my, 4.5, 10.5, 16, 0, TAU - TAU / 16, 'rgba(212, 175, 90, 0.16)', 0.6);
    }
  }

  // The boulevard: pale marble flagstones between gold kerbs. m = this tile's chevron or corner mark, if any.
  function paintRoad(g, ox, oy, same, m, r) {
    const cx = ox + T / 2, cy = oy + T / 2;
    g.fillStyle = P.road; g.fillRect(ox, oy, T, T);
    A.veins(g, ox, oy, T, T, r, 2, 'rgba(120, 96, 56, 0.16)');
    g.strokeStyle = 'rgba(120, 96, 56, 0.22)'; g.lineWidth = 0.6;
    g.strokeRect(ox + 0.3, oy + 0.3, T - 0.6, T - 0.6);
    edgeFrame(g, ox, oy, same, 1, P.goldLo, 2);
    edgeFrame(g, ox, oy, same, 3, P.gold, 0.9);
    edgeFrame(g, ox, oy, same, 4.8, 'rgba(140, 108, 46, 0.5)', 0.5);
    if (m && m.corner) {
      A.diamond(g, cx, cy, 6); g.strokeStyle = 'rgba(140, 108, 46, 0.7)'; g.lineWidth = 0.8; g.stroke();
      A.diamond(g, cx, cy, 2.6); g.fillStyle = 'rgba(140, 108, 46, 0.6)'; g.fill();
    } else if (m) {
      A.chevron(g, cx - Math.cos(m.ang) * 2, cy - Math.sin(m.ang) * 2, 4.4, m.ang, 'rgba(140, 108, 46, 0.7)', 1.6);
      A.chevron(g, cx + Math.cos(m.ang) * 3, cy + Math.sin(m.ang) * 3, 4.4, m.ang, 'rgba(140, 108, 46, 0.35)', 1);
    }
  }

  // Promenade: darker, plainer paving with no gold studs, so the building lots stand out against it.
  function promenade(g, ox, oy, r) {
    g.fillStyle = '#080e20'; g.fillRect(ox, oy, T, T);
    A.veins(g, ox, oy, T, T, r, 1, 'rgba(60, 80, 130, 0.1)');
    g.strokeStyle = 'rgba(24, 36, 70, 0.6)'; g.lineWidth = 0.5;
    g.beginPath();
    for (const f of [0, 0.5]) { g.moveTo(ox, oy + f * T + 0.25); g.lineTo(ox + T, oy + f * T + 0.25); }
    const sh = (Math.floor(oy / T) & 1) * 0.25 * T;
    for (const f of [0.25, 0.75]) { g.moveTo(ox + f * T + sh, oy); g.lineTo(ox + f * T + sh, oy + T / 2); g.moveTo(ox + f * T - sh + T / 4, oy + T / 2); g.lineTo(ox + f * T - sh + T / 4, oy + T); }
    g.stroke();
  }

  function paintGround(g, x, y) {
    const t = grid[y][x];
    const r = rng((x + 1) * 73856093 ^ (y + 1) * 19349663);
    const ox = x * T, oy = y * T, cx = ox + T / 2, cy = oy + T / 2;
    // the screen edge counts as "same", so frames never line the edge of the map
    const is = (nx, ny) => !inBounds(nx, ny) || grid[ny][nx] === t;
    const same = [is(x, y - 1), is(x, y + 1), is(x - 1, y), is(x + 1, y),
      [is(x - 1, y - 1), is(x + 1, y - 1), is(x - 1, y + 1), is(x + 1, y + 1)]];
    g.save();
    g.beginPath(); g.rect(ox, oy, T, T); g.clip();
    if (t === 'walk') promenade(g, ox, oy, r);
    else if (t === 'grass' && restricted) {
      // a building lot: plaza paving inside a gold rope border, with corner brackets where the border turns
      g.fillStyle = '#1a2850'; g.fillRect(ox, oy, T, T);
      A.veins(g, ox, oy, T, T, r, 1, 'rgba(120, 140, 200, 0.18)');
      g.strokeStyle = 'rgba(212, 175, 90, 0.22)'; g.lineWidth = 0.6;
      g.strokeRect(ox + 0.3, oy + 0.3, T - 0.6, T - 0.6);
      g.fillStyle = 'rgba(243, 216, 138, 0.8)';
      A.diamond(g, ox + T / 2, oy + T / 2, 2.2); g.fill();
      const b = (nx, ny) => !inBounds(nx, ny) || TR[grid[ny][nx]].build;
      const fb = [b(x, y - 1), b(x, y + 1), b(x - 1, y), b(x + 1, y),
        [b(x - 1, y - 1), b(x + 1, y - 1), b(x - 1, y + 1), b(x + 1, y + 1)]];
      edgeFrame(g, ox, oy, fb, 1.2, P.gold, 2.4);
      edgeFrame(g, ox, oy, fb, 3.4, P.goldHi, 0.9);
      edgeFrame(g, ox, oy, fb, 5.4, 'rgba(243, 216, 138, 0.45)', 0.6);
    } else if (t === 'grass' || t === 'rock') plaza(g, ox, oy, r);
    else if (t === 'path') {
      paintRoad(g, ox, oy, same, pathMarks.get(`${x},${y}`), r);
    } else if (t === 'hill') {
      // a raised terrace: a jade terrazzo deck, a gold kerb, and a tube of pink neon inlaid along the rim
      const hT = T / 2;
      g.fillStyle = P.deck; g.fillRect(ox, oy, T, T);
      g.fillStyle = P.deckHi; g.fillRect(ox, oy, hT, hT); g.fillRect(ox + hT, oy + hT, hT, hT);
      for (let i = 0; i < 30; i++) {
        g.fillStyle = CHIPS[(r() * CHIPS.length) | 0];
        const s = 0.5 + r() * 0.9; g.fillRect(ox + r() * T, oy + r() * T, s, s);
      }
      g.strokeStyle = 'rgba(3, 14, 20, 0.55)'; g.lineWidth = 0.5;
      g.strokeRect(ox + 0.25, oy + 0.25, T - 0.5, T - 0.5);
      g.beginPath(); g.moveTo(cx, oy); g.lineTo(cx, oy + T); g.moveTo(ox, cy); g.lineTo(ox + T, cy); g.stroke();
      // an atomic starburst marks each building plot
      g.fillStyle = 'rgba(243, 216, 138, 0.75)';
      A.diamond(g, cx, cy, 1.1, 5.2); g.fill(); A.diamond(g, cx, cy, 5.2, 1.1); g.fill();
      g.fillStyle = 'rgba(46, 230, 207, 0.9)'; g.beginPath(); g.arc(cx, cy, 1, 0, TAU); g.fill();
      edgeFrame(g, ox, oy, same, 1, P.goldLo, 2);
      edgeFrame(g, ox, oy, same, 2.3, P.goldHi, 0.7);
      for (const [w, a] of [[5.5, 0.13], [3, 0.3], [1.1, 1]]) edgeFrame(g, ox, oy, same, 4.8, `rgba(255, 79, 168, ${a})`, w);
      edgeFrame(g, ox, oy, same, 7.6, 'rgba(46, 230, 207, 0.6)', 0.6);
    } else if (t === 'water') {
      // a sunken basin: deep light at the centre, a Deco mosaic at low strength; the 3D coping replaces the cream frame
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, T * 0.7);
      gr.addColorStop(0, '#0d1a3c'); gr.addColorStop(1, P.pool);
      g.fillStyle = gr; g.fillRect(ox, oy, T, T);
      g.strokeStyle = 'rgba(212, 175, 90, 0.11)'; g.lineWidth = 0.6;
      for (let j = Math.floor(oy / 7) - 1; j * 7 < oy + T + 7; j++) {
        const yy = j * 7, shift = (j & 1) * 4;
        g.beginPath();
        for (let i = Math.floor(ox / 8) - 1; i * 8 < ox + T + 8; i++) { const xx = i * 8 + shift; g.moveTo(xx + 4, yy); g.arc(xx, yy, 4, 0, Math.PI, true); }
        g.stroke();
      }
      edgeFrame(g, ox, oy, same, 3.8, 'rgba(212, 175, 90, 0.5)', 0.6);
    } else if (t === 'forest') {
      // the footprint of a tenement block: black marble with a gold kerb
      g.fillStyle = P.marble; g.fillRect(ox, oy, T, T);
      g.strokeStyle = 'rgba(212, 175, 90, 0.12)'; g.lineWidth = 0.6; g.strokeRect(ox + 0.3, oy + 0.3, T - 0.6, T - 0.6);
      edgeFrame(g, ox, oy, same, 1.4, 'rgba(212, 175, 90, 0.55)', 0.7);
    }
    g.restore();
  }

  // ---------- footprints ----------
  function footprint(key, dir) {
    let cells = TW[key].shape.map((c) => [c[0], c[1]]);
    for (let i = 0; i < dir; i++) cells = cells.map(([x, y]) => [-y, x]);
    const mx = Math.min(...cells.map((c) => c[0])), my = Math.min(...cells.map((c) => c[1]));
    return cells.map(([x, y]) => [x - mx, y - my]);
  }
  // Pick the anchor so the footprint's centre sits nearest the cursor.
  function anchorFor(cells, px, py) {
    const w = Math.max(...cells.map((c) => c[0])) + 1, h = Math.max(...cells.map((c) => c[1])) + 1;
    return [Math.round(px / T - w / 2), Math.round(py / T - h / 2)];
  }
  function placeCells(key, dir, ax, ay) { return footprint(key, dir).map(([x, y]) => [ax + x, ay + y]); }
  function cellsCenter(cells) {
    let sx = 0, sy = 0;
    for (const [x, y] of cells) { sx += (x + 0.5) * T; sy += (y + 0.5) * T; }
    return { x: sx / cells.length, y: sy / cells.length };
  }
  // Barricades go on the boulevard and nowhere else; every other tower goes anywhere buildable but the road.
  function cellProblem(x, y, key) {
    if (!inBounds(x, y)) return 'off-map';
    const onPath = key && TW[key].onPath;
    if (onPath ? grid[y][x] !== 'path' : !TR[grid[y][x]].build) return grid[y][x];
    if (state.occ[y][x]) return 'occupied';
    return null;
  }
  // A footprint's problems, one per cell: cellProblem, plus a terrace rule. A tower stands wholly on a terrace or
  // wholly off it, never half up the kerb, so a footprint that straddles the edge is refused on every cell.
  function footProblems(cells, key) {
    const out = cells.map(([x, y]) => cellProblem(x, y, key));
    if (out.some((p) => p)) return out;
    const up = cells.filter(([x, y]) => grid[y][x] === 'hill').length;
    return up && up < cells.length ? cells.map(() => 'terrace edge') : out;
  }
  // distance along the road (a route; the main one by default) to the middle of a road tile, and which way the
  // road runs there (for barricades); d is null when the tile is not on that route
  function roadAt(cx, cy, poly = path) {
    const px = (cx + 0.5) * T, py = (cy + 0.5) * T;
    let best = null, dir = 0;
    for (const s of poly.segs) {
      const ux = (s.b.x - s.a.x) / s.len, uy = (s.b.y - s.a.y) / s.len;
      const along = (px - s.a.x) * ux + (py - s.a.y) * uy;
      if (along < -1 || along > s.len + 1) continue;
      if (Math.abs((px - s.a.x) * -uy + (py - s.a.y) * ux) > 1) continue;
      const d = s.start + clamp(along, 0, s.len);
      if (best === null || d < best) { best = d; dir = Math.abs(ux) > 0.5 ? 0 : 1; }
    }
    return { d: best, dir };
  }
  // Which way a fresh turret looks: at the nearer gate, where its robots will come from (each route's second point
  // is where it comes onto the map; the gate building stands just behind it). Directional towers face their dir.
  function gateAim(x, y) {
    let best = null;
    for (const r of routes) { const p = r.pts[1] || r.pts[0]; if (!best || dist(x, y, p.x, p.y) < dist(x, y, best.x, best.y)) best = p; }
    return best ? Math.atan2(best.y - y, best.x - x) : 0;
  }
  const startAim = (key, dir, x, y) => (TW[key].directional ? Math.atan2(DIRS[dir][1], DIRS[dir][0]) : gateAim(x, y));
  // the first route through a road tile (any gate's road), for which way a barricade faces
  const anyRoadAt = (cx, cy) => routes.map((poly) => roadAt(cx, cy, poly)).find((q) => q.d !== null) || { d: 0, dir: 0 };
  function neighborsOfCells(cells, self) {
    const set = new Set();
    for (const [x, y] of cells) for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const o = state.occ[ny][nx];
      if (o && o !== self) set.add(o);
    }
    return [...set];
  }
  function terrainShare(cells, kind) {
    let n = 0;
    for (const [x, y] of cells) if (inBounds(x, y) && grid[y][x] === kind) n++;
    return n / cells.length;
  }

  // ---------- state ----------
  let state;
  let uid = 1;

  // A campaign level (an index into C.CAMPAIGN) picks its own map and limits the waves, towers and enemies.
  // Without one, 'normal' is the full 25-wave game on any map (the balance bot plays that).
  let lastStart = ['normal', 0, null, false], nextStart = null; // what Play again / Next level starts
  const levelMap = (lv) => Math.max(0, C.MAPS.findIndex((m) => m.name === C.CAMPAIGN[lv].map));
  // a level may start with more or less power than usual; the city's lights and the exit gauge scale to it
  const startLives = (level) => (level && level.lives) || C.START_LIVES;
  // master mode (any playable level, once won): the same level with a single point of power, one leak ends it
  const maxLives = () => (state.master ? C.MASTER_LIVES : startLives(state.level));
  function newGame(mode, mapIdx = chosenMap, levelIdx = null, master = false, size = null) {
    const level = levelIdx === null ? null : C.CAMPAIGN[levelIdx];
    if (level) mapIdx = levelMap(levelIdx);
    master = !!(master && level && !level.soon);
    lastStart = [mode, mapIdx, levelIdx, master]; nextStart = null;
    for (const o of [cam, cam.goal]) Object.assign(o, { zoom: 1, yaw: 0, x: 0, z: 0 });
    buildMap(C.MAPS[mapIdx] || C.MAPS[0], size);
    $('ovEyebrow').textContent = level ? `Level ${levelIdx + 1}: ${mapDef.name}${master ? ' (Master)' : ''}` : mapDef.name;
    state = {
      mode, level, levelIdx, master, gold: (level && level.gold) || C.START_GOLD, lives: master ? C.MASTER_LIVES : startLives(level), wave: 0,
      towers: [], enemies: [], projectiles: [], effects: [], mines: [], strips: new Map(), pools: new Map(), wrecks: [],
      occ: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
      spawnQueue: [], activeWaves: new Map(),
      time: 0, speed: 1, paused: false, over: false, won: false, started: true,
      build: null, dir: 0, hover: null, selected: null,
      kills: 0, leaked: 0, banked: 0, bankAsked: 0,
      run: { dmg: {}, built: {}, killsBy: {}, spent: 0, recorded: false }, // for the all-time statistics
    };
    ui.panelKey = ''; ui.previewKey = '';
    bannerQ.length = 0; bannerUntil = 0;
    applyBlackout(0);   // a new game switches every light back on
    syncBuildBar();
    $('overlay').hidden = true;
    hideMenu();
    hideCampaign();
  }

  // After the finale's win: the same game carries on as Endless on the same map. The level's limits go (its
  // robot list, boss waves and wave count), so later waves draw from every robot by its own unlock wave. The
  // won campaign game is already recorded; the statistics count the rest as an Endless run of its own.
  function continueEndless() {
    if (!state || !state.won) return;
    Object.assign(state, { mode: 'endless', level: null, levelIdx: null, over: false, won: false });
    state.run = { dmg: {}, built: {}, killsBy: {}, spent: 0, recorded: false, from: { kills: state.kills, leaked: state.leaked, time: state.time } };
    lastStart = ['endless', C.MAPS.indexOf(mapDef), null, false]; nextStart = null;
    $('ovEyebrow').textContent = mapDef.name;
    ui.panelKey = ''; ui.previewKey = '';
    syncBuildBar();
    $('overlay').hidden = true;
    saveRun();
  }

  // ---------- waves ----------
  // HP: fixed per robot (hpGrowth 1); only the Endless slope from WV.endless.from scales it
  function hpMul(n) {
    return Math.pow(WV.hpGrowth, n - 1) * Math.pow(WV.endless.hp, Math.max(0, n - WV.endless.from + 1));
  }
  // walking pace: the same slope, capped
  const paceMul = (n) => Math.min(WV.endless.speedCap, 1 + WV.endless.speed * Math.max(0, n - WV.endless.from + 1));

  // waves in a won game: the level's, or the full campaign length; endless has none
  const gameLen = () => (state.mode !== 'normal' ? Infinity : state.level ? state.level.waves : WV.normalLength);
  const towerOpen = (key) => !state || !state.level || state.level.towers.includes(key);

  // the boss group of boss wave n (WV.bossTiers: the last tier from n or below). With `floor` (outside levels) its total
  // HP is at least WV.bossFloor.mul × the previous boss wave's from bossFloor.from: more bosses up to maxN, then `hpx`
  function bossGroup(n, floor) {
    const b = WV.bossTiers.filter((x) => x.from <= n).pop() || WV.bossTiers[0], F = WV.bossFloor;
    const g = { type: b.type, count: b.n };
    if (!floor || n < F.from) return g;
    const one = EN[b.type].hp * hpMul(n), want = F.mul * bossHp(n - WV.bossEvery);
    while (g.count < F.maxN && g.count * one < want) g.count++;
    if (g.count * one < want) g.hpx = want / (g.count * one);
    return g;
  }
  const bossHp = (n) => { const g = bossGroup(n, true); return EN[g.type].hp * hpMul(n) * g.count * (g.hpx || 1); };

  function makeWave(n) {
    const r = rng(n * 7919 + 13);
    const lv = state.level;
    // a level's own `bosses` map picks its boss waves; otherwise every 10th and the last, unless boss: false
    const isBoss = lv && lv.bosses ? !!lv.bosses[n] : (!lv || lv.boss !== false) && (n % WV.bossEvery === 0 || n === gameLen());
    let budget = WV.baseBudget + n * WV.perWave + Math.pow(n, 1.6) * WV.curve;
    if (isBoss) budget *= 0.6;
    // a level's `debut` can bring a robot in earlier (or later) than its global unlock wave
    const unlock = (k) => (lv && lv.debut && lv.debut[k]) || EN[k].unlock;
    // in Endless a robot retires once its advanced variant debuts (`retire`, set in config.js), so the pool stays near 30
    let pool = Object.keys(EN).filter((k) => unlock(k) <= n && (lv ? lv.enemies.includes(k) : !(EN[k].retire <= n)));
    // a wave modifier (Endless only, WV.modifiers) filters the pool and may reshape spacing; none changes budget, threat or HP
    const MD = WV.modifiers, mod0 = !lv && !isBoss && n >= MD.from && (n - MD.from) % MD.every === 0 ? MD.order[((n - MD.from) / MD.every) % MD.order.length] : null;
    let mod = null, gapMul = 1, escortTypes = null;
    if (mod0) {
      const R = MD[mod0];
      const sub = pool.filter((k) => mod0 === 'air' ? EN[k].air : mod0 === 'armour' ? EN[k].armor >= R.minArmor : mod0 === 'rush' ? EN[k].speed >= R.minSpeed && !EN[k].escort : !!EN[k].emp);
      if (sub.length >= (R.minTypes || 1)) {
        mod = mod0;
        if (mod0 === 'rush') { // one of the fast types, the newer ones more likely
          const top = Math.max(...pool.map(unlock));
          let x = r() * sub.reduce((a, k) => a + 0.35 + unlock(k) / top, 0), one = sub[sub.length - 1];
          for (const k of sub) { x -= 0.35 + unlock(k) / top; if (x <= 0) { one = k; break; } }
          pool = [one]; gapMul = R.gap;
        } else if (mod0 === 'blackout') {
          const rest = pool.filter((k) => !sub.includes(k));
          if (rest.length) { pool = rest; escortTypes = sub; } else mod = null;
        } else pool = sub;
      }
    }
    const fresh = pool.find((k) => unlock(k) === n);
    // late waves favour the newer robots, so the first ones fade out instead of padding the wave
    // past the campaign length the weight is relative to the newest robot in the pool, not to n, so it does not drift back
    // to the old robots as waves climb (waves of a level and the first 25 keep n)
    const newest = !lv && n > WV.normalLength ? Math.max(...pool.map(unlock)) : n;
    const fullBudget = budget;
    if (escortTypes) budget *= 1 - MD.blackout.share; // the escorts take their slice off the top
    const weight = (k) => (n < WV.lateFrom ? 1 : 0.35 + unlock(k) / newest);
    const pick = (exclude) => {
      const opts = pool.filter((k) => !exclude.includes(k));
      let x = r() * opts.reduce((a, k) => a + weight(k), 0);
      for (const k of opts) { x -= weight(k); if (x <= 0) return k; }
      return opts[opts.length - 1];
    };
    // a tank + support pair the pool can field (both unlocked, both in the level's roster)
    const pairs = n >= WV.combos.from ? WV.combos.pairs.filter((q) => q.every((k) => pool.includes(k))) : [];
    // A new enemy type debuts as the smaller group so the first meeting is a warning, not a wipe.
    let types, shares;
    if (fresh && pool.length > 1) {
      types = [pick([fresh]), fresh];
      const fs = EN[fresh].air ? WV.debutAirShare : 0.35;
      shares = [1 - fs, fs];
      if (n >= 8 && pool.length > 3) { types.splice(1, 0, pick(types)); shares = [0.4, 0.3, 0.3]; }
    } else {
      // the roster is large, so later waves mix more types and no single counter decides a wave
      types = [pick([])];
      if (n >= 3 && pool.length > 1) types.push(pick(types));
      if (n >= 7 && pool.length > 2 && r() < (n >= 12 ? 0.85 : 0.6)) types.push(pick(types));
      if (n >= 16 && types.length === 3 && r() < 0.5) types.push(pick(types));
      shares = [[1], [0.6, 0.4], [0.45, 0.33, 0.22], [0.36, 0.28, 0.2, 0.16]][types.length - 1];
    }
    // a pair wave: the tank leads, the support takes its slice, a third group (if the wave had one) fills the rest
    if (!fresh && pairs.length && r() < WV.combos.chance) {
      const [tank, sup] = pairs[Math.floor(r() * pairs.length)], s2 = WV.combos.share;
      const extra = pool.length > 2 && r() < 0.6 ? pick([tank, sup]) : null;
      types = extra ? [tank, sup, extra] : [tank, sup];
      shares = extra ? [0.5, s2, 0.5 - s2] : [1 - s2, s2];
    }
    const groups = types.map((type, i) => ({
      type, count: Math.max(1, Math.round((budget * shares[i]) / EN[type].threat)),
    }));
    // a debut group is capped past the campaign length; its freed budget goes to the other groups by their share
    const fi = fresh ? types.indexOf(fresh) : -1;
    if (fi >= 0 && !lv && n > WV.normalLength && groups[fi].count > WV.debutMax && groups.length > 1) {
      const freed = (groups[fi].count - WV.debutMax) * EN[fresh].threat;
      const rest = shares.reduce((a, x, i) => (i === fi ? a : a + x), 0);
      groups[fi].count = WV.debutMax;
      groups.forEach((g, i) => { if (i !== fi) g.count += Math.round((freed * shares[i]) / rest / EN[g.type].threat); });
    }
    if (escortTypes) {
      const type = escortTypes.reduce((a, k) => (unlock(k) > unlock(a) ? k : a));
      groups.push({ type, count: Math.max(1, Math.round((fullBudget * MD.blackout.share) / EN[type].threat)), escort: true });
    }
    if (isBoss) groups.push(lv && lv.bosses ? { type: lv.bosses[n], count: 1 + Math.floor(n / 30) } : bossGroup(n, !lv));
    const w = { n, groups, bonus: WV.bonusBase + n * WV.bonusPer, boss: isBoss };
    if (mod) Object.assign(w, { mod, gapMul });
    return w;
  }

  function canSendWave() {
    if (state.over) return false;
    return state.wave < gameLen();
  }

  function sendWave() {
    if (!canSendWave()) return;
    saveRun(); // keeps what was built since the last wave cleared (does nothing with robots still out)
    const early = state.activeWaves.size > 0;
    state.wave++;
    const w = makeWave(state.wave);
    // with two gates the groups take turns between them (the wave's lead group swaps gate every wave)
    let t = state.time + 0.5;
    let total = 0;
    const tight = Math.max(WV.tight.min, 1 - Math.max(0, w.n - WV.tight.from) * WV.tight.per);
    // an escort group (Salvager, Skyhook) works on other robots, so it is spread through the rest of the wave
    // instead of marching as a block of its own; with nothing to escort it marches like any group
    const escorted = (g) => (g.escort || EN[g.type].escort) && w.groups.some((o) => !o.escort && !EN[o.type].escort && !EN[o.type].boss);
    const t0 = t, main = [];
    w.groups.forEach((g, gi) => {
      if (escorted(g)) return;
      // a boss group splits across the gates unit by unit, so a multi-boss wave uses every entrance
      for (let i = 0; i < g.count; i++) {
        const route = (gi + w.n + (EN[g.type].boss ? i : 0)) % routes.length;
        const q = { at: t, type: g.type, wave: w.n, route, hpx: g.hpx };
        state.spawnQueue.push(q); main.push(q);
        t += EN[g.type].gap * tight * (w.gapMul || 1);
        total++;
      }
      t += WV.groupPause * tight;
    });
    const span = Math.max(1, t - WV.groupPause * tight - t0);
    for (const g of w.groups.filter(escorted)) for (let i = 0; i < g.count; i++) {
      const want = t0 + (span * (i + 0.5)) / g.count;
      // walk with whoever is at the gate then; a hook leaves the gate with its cargo, or the lift never happens
      const near = main.reduce((a, q) => (Math.abs(q.at - want) < Math.abs(a.at - want) ? q : a), main[0]);
      state.spawnQueue.push({ at: EN[g.type].hook ? near.at : want, type: g.type, wave: w.n, route: near.route });
      total++;
    }
    state.spawnQueue.sort((a, b) => a.at - b.at);
    // banked: what Banks paid this wave (bankPay); top: the bounty a Wanted foe is picked from
    const top = Math.max(0, ...w.groups.filter((g) => !EN[g.type].boss).map((g) => EN[g.type].bounty));
    state.activeWaves.set(w.n, { left: total, bonus: w.bonus, banked: 0, top, wanted: null, mod: w.mod || null });
    sfx(w.boss ? 'boss' : 'horn');
    if (w.mod) modCue(w);
    if (early) {
      const b = WV.earlyBase + state.wave * WV.earlyPer;
      state.gold += b;
      floatText((COLS * T) / 2, 3 * T, `Early call +${b}g`, P.goldHi);
    }
  }

  function waveUnitGone(n) {
    const w = state.activeWaves.get(n);
    if (!w) return;
    w.left--;
    if (w.left <= 0) {
      state.activeWaves.delete(n);
      if (state.over) return;
      state.saveDue = true; // saved at the end of the step, once everything this kill caused has happened
      state.gold += w.bonus;
      sfx('coins');
      floatText((COLS * T) / 2, 3.6 * T, `Wave ${n} cleared +${w.bonus}g`, P.goldHi);
      // Treasury banks pay interest on what you are holding (the best one counts, not the sum), under this
      // wave's bankCap like every other Bank payment
      const rate = bestOf(state.towers.filter((t) => t.def.kind === 'bank' && t.s && t.disabledT <= 0), (s) => s.interest);
      if (rate > 0) {
        const i = bankPay(w, Math.min(WV.interestCap, Math.floor(state.gold * rate)), (COLS * T) / 2, 4.8 * T);
        if (i > 0) { state.gold += i; floatText((COLS * T) / 2, 4.2 * T, `Interest +${i}g`, P.goldHi); }
      }
      if (state.wave >= gameLen() && state.activeWaves.size === 0) endGame(true);
    }
  }

  // at = distance along the route to appear at (spawned children appear where their parent was); route = which
  // gate's road (an index into routes); flyers take that gate's flight line
  // hpx: the boss floor's HP multiplier (bossGroup), on top of the slope
  function spawn(type, waveN, at = 0, route = 0, hpx = 1) {
    const d = EN[type];
    const m = hpMul(waveN) * hpx;
    const hp = Math.round(d.hp * m);
    const armor = d.armor, mdef = d.mdef || 0;
    const poly = d.air && !d.road ? flyPaths[route] : routes[route];
    const p = posOn(poly, at);
    const e = {
      id: uid++, type, def: d, hp, maxHp: hp, armor, mdef, pace: paceMul(waveN), cloakClock: 0, x: p.x, y: p.y, d: at, poly, route,
      air: !!d.air, stealth: !!d.stealth, wave: waveN, r: d.size, boss: !!d.boss,
      slowMul: 1, slowT: 0, stunT: 0, burnDps: 0, burnT: 0, burnSrc: null,
      chillT: 0, brittle: 0, empT: d.emp ? d.emp.every * 0.6 : 0, revealed: false, dead: false, hitFlash: 0,
      markT: 0, mark: 0, spotT: 0, aegis: 0, baffle: 0, baffleMin: 0, haste: 0, lit: false, under: false, burrowClock: 0,
      sapCd: d.sap ? 2 : 0, plantT: 0, sapTarget: null, bombT: d.bomb ? d.bomb.every : 0,
      surgeT: d.surge ? d.surge.every * 0.7 : 0, surgeLeft: 0, dropped: false, reborn: false, mend: 0,
      blinkT: d.blink ? d.blink.every * 0.6 : 0, spawnT: d.spawner ? d.spawner.every : 0, rammed: null, blocked: null,
      vuln: 0, vulnT: 0, kbT: 0, designT: 0, spotter: 0, spotterT: 0, jamT: 0, doomT: 0, stasisT: 0, bank: 0,
      overN: 0, overT: 0, mirageT: d.mirage ? d.mirage.every * 0.5 : 0, fadeT: 0, fake: false, rebuilt: false, salvaged: 0,
      cargo: null, carried: null, hookCd: d.hook ? d.hook.first : 0, carryT: 0,
      thiefT: d.thief ? d.thief.every : 0, thiefLock: 0, thiefTarget: null,
      gov: 0, noCtl: false, stunPre: 0, slowPre: 0, slowMulPre: 1,
    };
    state.enemies.push(e);
    noteRobot(type);
    return e;
  }
  // a child robot (Gear Mite) joins its parent's wave, so the wave only clears once it is gone too
  function spawnChild(type, parent, back) {
    const w = state.activeWaves.get(parent.wave);
    if (w) w.left++;
    return spawn(type, parent.wave, Math.max(0, parent.d - back), parent.route);
  }

  // ---------- tower stats ----------
  // Upgrade paths: a tower has a base and three paths (P precision, B barrage, E engineering) of four tiers each.
  // Tower state is `pips: { P, B, E }`, the tiers bought on each path, and `pathOrder`, the order they were opened.
  const PATHS = ['P', 'B', 'E'];
  const PATH_MAX = 4, SIDE_MAX = 2;
  const NON_STAT = ['cost', 'desc', 'name'];
  const MAX_OF = ['dmg', 'range', 'rate', 'mark'];
  // one tier onto a stat block; object-valued fields (trail, cluster, ...) merge one level deep, so a tier that
  // only changes trail.dps keeps the earlier trail.width
  function mergeTier(s, tier) {
    for (const [k, v] of Object.entries(tier)) {
      if (NON_STAT.includes(k)) continue;
      s[k] = v && typeof v === 'object' && !Array.isArray(v) && s[k] && typeof s[k] === 'object' ? mergeTier({ ...s[k] }, v) : v;
    }
    return s;
  }
  // Main path: the one with the most tiers; on a tie, the one bought into first. Side path: the other one with tiers.
  function pathRoles(pips, order = PATHS) {
    const used = PATHS.filter((p) => pips[p] > 0)
      .sort((a, b) => pips[b] - pips[a] || order.indexOf(a) - order.indexOf(b));
    return { main: used[0] || null, side: used[1] || null };
  }
  // The side path's dmg and rate may lift the main path's dmg × rate by at most COMBO.sideBoost. Without it a
  // fast side (Riveter) on a heavy main (Spike Driver) multiplies the two. Rate gives way first, then dmg.
  function sideCap(s, md, mr) {
    if (md === undefined || mr === undefined) return;
    const cap = md * mr * (1 + C.COMBO.sideBoost);
    if (s.dmg * s.rate <= cap) return;
    if (s.rate > mr) s.rate = Math.max(mr, cap / s.dmg);
    if (s.dmg * s.rate > cap) s.dmg = Math.max(md, cap / s.rate);
  }
  const freshPips = () => ({ P: 0, B: 0, E: 0 });
  // The merge depends only on tower key, tiers bought and path order, yet computeStats runs it for every tower (and
  // every Amplifier, per tower) on every sim step. Memoised; callers get a shallow copy they may write to.
  const baseCache = new Map();
  function baseStats(t, pips = t.pips) {
    const pp = pips || freshPips();
    const ck = t.key ? `${t.key}|${pp.P}${pp.B}${pp.E}|${t.pathOrder ? t.pathOrder.join('') : '-'}` : null;
    if (ck) {
      const hit = baseCache.get(ck);
      if (hit) return { ...hit };
    }
    const s = buildBaseStats(t, pp);
    if (ck) { if (baseCache.size > 4000) baseCache.clear(); baseCache.set(ck, s); return { ...s }; }
    return s;
  }
  function buildBaseStats(t, pp) {
    const d = t.def || TW[t.key];
    const s = { ...d.base };
    const { main, side } = pathRoles(pp, t.pathOrder);
    const stack = (p) => d.paths[p].tiers.slice(0, pp[p]).reduce(mergeTier, {});
    if (main) mergeTier(s, stack(main));
    if (side) {
      // side tiers only write fields the main path leaves alone; dmg, range, rate and mark take the larger value, hp adds
      const m = main ? stack(main) : {}, sd = stack(side), md = s.dmg, mr = s.rate;
      for (const [k, v] of Object.entries(sd)) {
        if (MAX_OF.includes(k)) s[k] = Math.max(s[k] ?? v, v);
        else if (k === 'hp') s[k] += v - d.base.hp; // plating stacks: the side's gain over the bare wall is added
        else if (!(k in m)) s[k] = v;
      }
      sideCap(s, md, mr);
    }
    // Chronometer's stunAdd lengthens whatever stun the main path set rather than replacing it
    if (s.stunAdd) { s.stun = Math.round(((s.stun || 0) + s.stunAdd) * 100) / 100; delete s.stunAdd; }
    if (s.air === undefined) s.air = d.air;
    if (s.ignoreForest === undefined) s.ignoreForest = !!d.ignoreForest;
    return s;
  }

  // Amplifiers. Every touching tower gets the boost; Grid's `reach` gives towers a little farther out a share
  // (reach.mul) of it; Overclock's `focus` goes to one touching tower on top. Amplifiers never boost each other.
  // Tiles between the nearest cells of two footprints, centre to centre (touching = 1).
  const cellGap = (ca, cb) => Math.min(...ca.flatMap(([ax, ay]) => cb.map(([bx, by]) => Math.hypot(ax - bx, ay - by))));
  const inReach = (as, ca, cb) => !!as.reach && cellGap(ca, cb) <= 1 + as.reach.r + 1e-6;
  // the towers amp `a` boosts, each with its share of the boost: [tower, 1] touching, [tower, reach.mul] in reach
  function ampTargets(a, as = baseStats(a)) {
    const touch = neighborsOfCells(a.cells, a).filter((n) => n.key !== 'amp');
    const out = touch.map((n) => [n, 1]);
    if (as.reach) for (const n of state.towers) if (n.key !== 'amp' && !touch.includes(n) && inReach(as, a.cells, n.cells)) out.push([n, as.reach.mul]);
    return out;
  }
  // Combined Arms: distinct tower types among the boosted towers, up to 6
  const ampArms = (a, as) => Math.min(6, new Set(ampTargets(a, as).map(([n]) => n.key)).size);
  // Overclock's focus: the touching tower with the most gold spent (ties: the older one). Only towers with a damage
  // stat count, so the focus is never wasted on a Bank, a Searchlight or a Barricade.
  function ampFocus(a) {
    let best = null;
    for (const n of neighborsOfCells(a.cells, a)) {
      if (n.key === 'amp' || n.def.base.dmg === undefined) continue;
      if (!best || n.spent > best.spent || (n.spent === best.spent && n.id < best.id)) best = n;
    }
    return best;
  }
  // Overdrive: the focus runs `on` seconds, then rests `off` seconds (t.odT, advanced in updateTower)
  const overdriveOn = (a, as) => !as.overdrive || (a.odT || 0) % (as.overdrive.on + as.overdrive.off) < as.overdrive.on;

  // Full stats: base tier + terrain + neighbours.
  // pips default to the tower's own; pass them to preview another state
  function computeStats(t, cells = t.cells, neighbors = null, pips) {
    const s = baseStats({ key: t.key, pathOrder: t.pathOrder }, pips ?? t.pips);
    const notes = [];
    let dmgMul = 1, rateMul = 1, rangeMul = 1;
    const hillF = terrainShare(cells, 'hill');
    if (hillF > 0 && !s.global && !s.fixedRange) { const b = TR.hill.rangeBonus * hillF; rangeMul += b; notes.push({ txt: `High ground ${pct(b)} range`, good: true }); }
    const nbs = neighbors || neighborsOfCells(cells, t);
    let steam = false;
    for (const n of nbs) if ((t.key === 'frost' && n.key === 'flame') || (t.key === 'flame' && n.key === 'frost')) steam = true;
    // every Amplifier bonus on this tower adds up here, then COMBO.ampCap trims the total
    const amp = { dmg: 0, rate: 0, range: 0 };
    if (t.key !== 'amp') for (const a of state.towers) {
      if (a.key !== 'amp' || a === t) continue;
      const as = baseStats(a), touching = nbs.includes(a), share = touching ? 1 : inReach(as, a.cells, cells) ? as.reach.mul : 0;
      if (!share) continue;
      // Signal Thief: this tower's links are cut, so it takes nothing from any Amplifier
      if (t.linkCutT > 0) { if (!notes.some((n) => n.cut)) notes.push({ txt: 'Links cut (Signal Thief)', good: false, cut: true }); continue; }
      if (a.disabledT > 0) { notes.push({ txt: `Amplifier offline (${a.disabledWhy || 'EMP'})`, good: false }); continue; }
      const add = { dmg: (as.boostDmg || 0) + (as.arms ? as.arms * ampArms(a, as) : 0), rate: as.boostRate || 0, range: as.boostRange || 0 };
      const parts = [];
      for (const k of ['dmg', 'rate', 'range']) if (add[k]) { amp[k] += add[k] * share; parts.push(`${pct(add[k] * share)} ${k === 'dmg' ? 'damage' : k}`); }
      if (parts.length) notes.push({ txt: `${touching ? 'Amplifier' : 'Grid reach'} ${parts.join(', ')}`, good: true });
      if (touching && as.focus && ampFocus(a) === t) {
        if (overdriveOn(a, as)) {
          amp.dmg += as.focus.dmg || 0; amp.rate += as.focus.rate || 0;
          notes.push({ txt: `${as.overdrive ? 'Overdrive' : 'Overclock'} ${pct(as.focus.dmg || 0)} damage${as.focus.rate ? `, ${pct(as.focus.rate)} rate` : ''}`, good: true });
        } else notes.push({ txt: 'Overdrive resting', good: false });
      }
      if (touching && as.grantSight) { s.seesStealth = true; notes.push({ txt: 'Relay: sees invisible foes', good: true }); }
      // Overwatch never lends the Sentinel Rifle its line: a map-wide gun over tenements breaks its one limit
      if (touching && as.grantLos && usesSight(t.key, s)) {
        if (s.global) notes.push({ txt: 'Overwatch: the rifle never fires over tenements', good: false });
        else { s.ignoreForest = true; notes.push({ txt: 'Overwatch: fires over tenements', good: true }); }
      }
    }
    const cap = C.COMBO.ampCap;
    for (const k of ['dmg', 'rate', 'range']) if (amp[k] > cap[k]) { amp[k] = cap[k]; notes.push({ txt: `Amplifier cap ${pct(cap[k])} ${k === 'dmg' ? 'damage' : k}`, good: false }); }
    dmgMul += amp.dmg; rateMul += amp.rate; rangeMul += amp.range;
    if (t.key === 'amp' && state.towers.includes(t)) {
      // the Amplifier's own panel names what it is doing
      if (s.focus) { const f = ampFocus(t); notes.push({ txt: f ? `Overclocking ${f.def.name}${s.overdrive && !overdriveOn(t, s) ? ' (resting)' : ''}` : 'No tower to overclock', good: !!f }); }
      if (s.reach) notes.push({ txt: `Boosting ${ampTargets(t, s).length} towers`, good: true });
      if (s.arms) notes.push({ txt: `Combined Arms: ${ampArms(t, s)} tower types`, good: true });
    }
    if (t.x !== undefined) {
      const off = discountOf(t);
      if (off > 0) notes.push({ txt: `Wholesale: upgrades ${pct(-off)}`, good: true });
    }
    if (steam) { dmgMul *= C.COMBO.steamPenalty; notes.push({ txt: `Steam: touching ${t.key === 'frost' ? 'Flamethrower' : 'Frost Spire'} ${pct(C.COMBO.steamPenalty - 1)}`, good: false }); }
    if (s.dmg !== undefined) s.dmg *= dmgMul;
    if (s.rate !== undefined) s.rate *= rateMul;
    if (s.rampTime) s.rampTime /= rateMul; // faster towers charge the prism quicker
    if (s.range !== undefined && !s.fixedRange) s.range *= rangeMul; // the Pinwheel's ring never grows
    if (s.global) s.range = mapReach(); // Sentinel Rifle: the whole map, whatever boosts it has
    if (s.slow !== undefined && steam) s.slow = 1 - (1 - s.slow) * C.COMBO.steamPenalty;
    s.notes = notes; s.dmgMul = dmgMul; s.rateMul = rateMul; s.rangeMul = rangeMul;
    return s;
  }

  // ---------- towers ----------
  function placeTower(key, dir, ax, ay) {
    const d = TW[key];
    const cells = placeCells(key, dir, ax, ay);
    if (footProblems(cells, key).some((p) => p)) return null;
    if (state.gold < d.cost) return null;
    state.gold -= d.cost;
    state.run.built[key] = (state.run.built[key] || 0) + 1; state.run.spent += d.cost;
    const c = cellsCenter(cells);
    const t = {
      id: uid++, key, def: d, cells, dir, x: c.x, y: c.y, pips: freshPips(), pathOrder: [], spent: d.cost,
      cool: 0.2, disabledT: 0, disabledWhy: '', linkCutT: 0, targetMode: 'first',
      aim: startAim(key, dir, c.x, c.y), dmgDealt: 0, kills: 0, s: null, flash: 0,
      focus: null, ramp: 0, beams: [], strikes: 0,
    };
    for (const [x, y] of cells) state.occ[y][x] = t;
    state.towers.push(t);
    t.s = computeStats(t);
    if (d.kind === 'barrier') {
      // pd: where it stands along each route (null on a route that does not pass it)
      t.hp = t.maxHp = t.s.hp; t.pd = routes.map((poly) => roadAt(cells[0][0], cells[0][1], poly).d);
      t.dir = anyRoadAt(cells[0][0], cells[0][1]).dir;
    }
    if (d.kind === 'volley') t.ports = cornerPorts(t);
    burst(c.x, c.y, P.cream, 10);
    sfx('place');
    return t;
  }

  // Can tower t buy the next tier on `path` (P/B/E)? Pure apart from reading gold and Banks. Returns
  // { ok, reason, cost, tier }: cost is after any Wholesale discount; reason is null when ok, else
  //   'maxed'  the path is full                               'locked'  a third path: at most two paths have tiers
  //   'capped' another path is past T2, so this one stops at T2  'gold'    legal but not affordable (cost is set)
  function canBuy(t, path, gold = state.gold) {
    const d = t.def;
    const res = (reason, cost = null, tier = null) => ({ ok: !reason, reason, cost, tier });
    if (!d.paths[path]) return res('maxed');
    const n = t.pips[path] + 1;
    if (n > PATH_MAX) return res('maxed');
    const after = { ...t.pips, [path]: n };
    if (PATHS.filter((p) => after[p] > 0).length > 2) return res('locked');
    if (PATHS.filter((p) => after[p] > SIDE_MAX).length > 1) return res('capped');
    const cost = upgradePrice(t, d.paths[path].tiers[n - 1].cost);
    return res(gold < cost ? 'gold' : null, cost, n);
  }
  function upgrade(t, path) {
    const r = canBuy(t, path);
    if (!r.ok) return false;
    state.gold -= r.cost; t.spent += r.cost; state.run.spent += r.cost;
    if (!t.pathOrder.includes(path)) t.pathOrder.push(path);
    t.pips[path]++;
    t.s = computeStats(t);
    if (t.s.prefersAir && t.targetMode === 'first') t.targetMode = 'air'; // the Flak tier sets its default once
    if (t.def.kind === 'barrier') { const hp = baseStats(t).hp; t.hp += hp - t.maxHp; t.maxHp = hp; }
    burst(t.x, t.y, P.goldHi, 14);
    sfx('upgrade');
    return true;
  }
  // What the model and effects draw. The models build four steps (0-3) and up to two path silhouettes ('A', 'B'),
  // so the main path's tier picks the step and LOOK maps the main path onto a silhouette from step 2. A path not
  // listed keeps the plain silhouette and shows itself through its accent (towerAccent) only.
  const LOOK = { arrow: { P: 'A', B: 'B' }, cannon: { B: 'A', E: 'B' }, rail: { P: 'A' },
    frost: { B: 'A', P: 'B' }, flame: { P: 'A', B: 'B' }, mines: { P: 'A' },
    prism: { P: 'A', B: 'B' }, light: { P: 'A', B: 'B' },
    tesla: { B: 'A', P: 'B' }, clock: { E: 'A', B: 'B' },
    nail: { P: 'A', B: 'B' }, amp: { P: 'A', E: 'B' }, bank: { P: 'A', E: 'A', B: 'B' }, barrier: { P: 'A', B: 'B' }, sniper: { P: 'A', B: 'B' } };
  function towerLook(t) {
    const { main } = pathRoles(t.pips, t.pathOrder), n = main ? t.pips[main] : 0;
    const step = Math.min(3, n), form = (LOOK[t.key] || {})[main] || null;
    return { form: step >= 2 ? form : null, step, main, tier: n };
  }
  // The main path's role colour for the model and the range ring; null for a fresh tower.
  function towerAccent(t) {
    const { main } = pathRoles(t.pips, t.pathOrder);
    if (!main) return null;
    const arch = t.def.paths[main].arch;
    return { arch, color: C.ARCH[arch].color, big: t.pips[main] >= PATH_MAX };
  }
  const hexA = (h, a) => `rgba(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')}, ${a})`;
  // ---------- Gilded Bank ----------
  // The best Bank whose radius covers a point counts for each effect; Banks never add up. Offline Banks are skipped.
  const banksAt = (x, y, pad = 0, skip = null) => state.towers.filter((b) => b !== skip && b.def.kind === 'bank' && b.s
    && b.disabledT <= 0 && dist(b.x, b.y, x, y) <= b.s.range * T + pad);
  const bestOf = (banks, f) => Math.max(0, ...banks.map((b) => f(b.s) || 0));
  // Gilded Banks raise the sale price of the towers in their radius.
  const sellRate = (t) => Math.min(0.95, C.SELL_RATE + bestOf(banksAt(t.x, t.y, 0, t), (s) => s.sellBonus));
  // Wholesale takes its share off every upgrade of a tower in its radius (placing a tower is full price).
  const discountOf = (t) => bestOf(banksAt(t.x, t.y, 0, t), (s) => s.discount);
  const upgradePrice = (t, cost) => Math.round(cost * (1 - discountOf(t)));
  // Everything Banks add in a wave (bounty extras, elite, Wanted, streaks, interest) goes through bankPay: one
  // counter per wave (w.banked), capped at COMBO.bankCap × that wave's clear bonus (36 gold at wave 1, 90 at wave 10).
  const bankCapOf = (w) => Math.floor(C.COMBO.bankCap * w.bonus);
  function bankPay(w, want, x, y) {
    if (!w || want <= 0) return 0;
    const pay = Math.max(0, Math.min(want, bankCapOf(w) - w.banked));
    w.banked += pay; state.banked += pay; state.bankAsked += want; // totals for the HUD-less balance bot
    if (pay < want && !w.vaultFull) { w.vaultFull = true; floatText(x, y - 22, 'Vault full this wave', P.creamDim, 1.6); }
    return pay;
  }
  // The extra a kill pays: base bounty share, elite bonus, Streak and Wanted, each from the best Bank in range.
  function bankBounty(e) {
    const banks = banksAt(e.x, e.y, e.r), b0 = e.def.bounty;
    if (!banks.length || !b0) return 0;
    let share = bestOf(banks, (s) => s.bounty) + bestOf(banks, (s) => (s.elite && (e.boss || b0 >= s.elite.min) ? s.elite.bonus : 0));
    // Streak: each Streak Bank times the kills in its own radius; the best running bonus counts
    let streak = 0;
    for (const b of banks) {
      const k = b.s.streak;
      if (!k) continue;
      b.streak = state.time - (b.lastKill ?? -Infinity) <= k.window ? Math.min(k.max, (b.streak || 0) + k.step) : 0;
      b.lastKill = state.time;
      streak = Math.max(streak, b.streak);
    }
    share += streak;
    // Wanted: the marked foe pays mul × its bounty in all, in place of the other bonuses when that is more
    if (e.wanted) {
      const mul = bestOf(banks, (s) => s.wanted && s.wanted.mul);
      if (mul) {
        share = Math.max(share, mul - 1);
        ring(e.x, e.y, 2, e.r * 4, P.goldHi, 0.6); burst(e.x, e.y, P.goldHi, 14);
        floatText(e.x, e.y - 24, `Wanted ×${mul}`, P.goldHi, 1.2);
      }
    }
    return bankPay(state.activeWaves.get(e.wave), Math.round(b0 * share), e.x, e.y);
  }
  // Wanted (Bounty Hunter T4): the first non-boss foe of the wave's top bounty to enter a Wanted Bank's radius is
  // marked; one per wave, however many Banks have it.
  function updateBank(t, s) {
    if (!s.wanted) return;
    for (const [n, w] of state.activeWaves) {
      if (w.wanted || !w.top) continue;
      const e = state.enemies.find((o) => o.wave === n && !gone(o) && !o.boss && o.def.bounty === w.top && dist(o.x, o.y, t.x, t.y) <= s.range * T + o.r);
      if (!e) continue;
      w.wanted = e.id; e.wanted = true;
      ring(e.x, e.y, 2, e.r * 3, P.goldHi, 0.5);
      floatText(e.x, e.y - 18, 'Wanted', P.goldHi, 1);
    }
  }
  const sellValue = (t) => Math.floor(t.spent * sellRate(t));
  function removeTower(t) {
    for (const [x, y] of t.cells) state.occ[y][x] = null;
    state.towers = state.towers.filter((o) => o !== t);
    state.mines = state.mines.filter((m) => m.src !== t);
    if (state.selected && state.selected.tower === t) state.selected = null;
  }
  function sell(t) {
    const v = sellValue(t);
    state.gold += v;
    removeTower(t);
    floatText(t.x, t.y - 10, `+${v}g`, P.goldHi);
    sfx('sell');
    state.selected = null;
  }
  // knocked out for a while: EMP, sabotage, bombs, fire. Barricades are only plates, so nothing to knock out.
  function disableTower(t, dur, why) {
    if (t.def.kind === 'barrier') return;
    if (dur >= t.disabledT) t.disabledWhy = why;
    t.disabledT = Math.max(t.disabledT, dur);
  }
  const towerWithin = (t, x, y, R) => t.cells.some(([cx, cy]) => dist((cx + 0.5) * T, (cy + 0.5) * T, x, y) <= R);
  // ---------- Barricade ----------
  // A blow on the wall: Bulwark's guard shrugs off a share. At 0 hp Shrapnel bursts, then Phoenix lays the wall down
  // for a while (once a wave) instead of clearing it away. A wall that is down stops nothing and takes nothing.
  function hurtBarricade(b, amt) {
    if (b.downT > 0) return;
    const s = b.s;
    b.hp -= amt * (1 - (s.guard || 0));
    b.flash = 0.1;
    if (b.hp > 0) return;
    if (s.shrapnel) shrapnelBurst(b, s.shrapnel);
    if (s.phoenix && b.phoenixWave !== state.wave) {
      b.phoenixWave = state.wave; b.downT = s.phoenix.delay; b.hp = 0;
      burst(b.x, b.y, P.gold, 18);
      floatText(b.x, b.y - 10, 'Barricade down: rising', C.ARCH.engineering.color);
      sfx('crash');
      return;
    }
    removeTower(b);
    burst(b.x, b.y, P.gold, 18);
    floatText(b.x, b.y - 10, 'Barricade down', P.ember);
    sfx('crash');
  }
  // Shrapnel (Spiked T4): the falling wall bursts over the queue that broke it, like a mine going off.
  function shrapnelBurst(b, sh) {
    const R = sh.radius * T;
    for (const e of state.enemies) if (!gone(e) && !airborne(e) && dist(e.x, e.y, b.x, b.y) <= R + e.r) damage(e, sh.dmg, 'physical', b);
    mineBlast({ x: b.x, y: b.y }, R, false);
    sparks(b.x, b.y, 0.3, 0, Math.PI, [C.ARCH.barrage.color, P.goldHi, P.steel], 26);
    sfx('bomb');
  }
  // The barricade's own clock: Mender repairs, Phoenix rises.
  function updateBarrier(t, s, dt) {
    if (t.downT > 0) {
      t.downT -= dt;
      if (t.downT > 0) return;
      t.hp = t.maxHp * s.phoenix.hp;
      ring(t.x, t.y, 2, T * 1.2, C.ARCH.engineering.color, 0.6); burst(t.x, t.y, C.ARCH.engineering.color, 16);
      floatText(t.x, t.y - 10, 'Barricade rebuilt', C.ARCH.engineering.color);
      sfx('place');
      return;
    }
    if (s.regen && t.hp < t.maxHp) {
      t.hp = Math.min(t.maxHp, t.hp + s.regen * dt);
      if (Math.random() < dt * 4) sparks(t.x, t.y, 0.4, -Math.PI / 2, Math.PI, [C.ARCH.engineering.color, P.cream], 2);
    }
  }
  // A walker hammering on wall b this frame for `blow` (before guard): Spiked thorns, Mender tar and Mirror Plate's
  // reflect answer it. Reflect is true damage, and a wall returns at most its own max plating in all.
  function answerBlow(e, b, blow, dt) {
    const s = b.s;
    if (s.thorns) damage(e, s.thorns * dt, 'physical', b);
    if (s.tar && !gone(e)) { e.slowMul = e.slowT > 0 ? Math.min(e.slowMul, s.tar.slow) : s.tar.slow; e.slowT = Math.max(e.slowT, s.tar.dur); }
    if (s.reflect && !gone(e)) {
      const r = Math.min(blow * s.reflect, b.maxHp - (b.reflected || 0));
      if (r <= 0) return;
      b.reflected = (b.reflected || 0) + r;
      b.mirAcc = (b.mirAcc || 0) + r;
      trueDamage(e, r, b);
      // show it in pulses rather than every frame: a crimson spark fan back at the attacker and the sum
      if (state.time - (b.mirAt || -1) >= 0.5) {
        sparks(b.x, b.y, 0.4, Math.atan2(e.y - b.y, e.x - b.x), 0.5, [C.ARCH.precision.color, P.coral, P.cream], 8);
        floatText(e.x, e.y - 14, `−${Math.round(b.mirAcc)}`, P.coral, 0.7);
        b.mirAt = state.time; b.mirAcc = 0;
      }
    }
  }
  // road points a Mine Layer can reach: { x, y, d, poly }, d along that route. A stretch two routes share is
  // listed once, from the first route through it.
  function mineSpots(t) {
    const out = [], R = t.s.range * T;
    for (const poly of routes) for (let d = T; d < poly.len - T; d += T / 3) {
      const p = posOn(poly, d);
      if (dist(p.x, p.y, t.x, t.y) > R || (poly !== path && out.some((q) => dist(q.x, q.y, p.x, p.y) < T / 4))) continue;
      out.push({ x: p.x, y: p.y, d, poly });
    }
    return out;
  }

  // ---------- targeting ----------
  function progress(e) { return e.d / e.poly.len; }
  // a boss or a `heavy` robot (an advanced variant): the percent-of-HP effects (Last Hour, Deadline, Deadeye) take the boss rate
  const bossy = (e) => e.boss || !!e.def.heavy;
  // underground Mole Tunnellers cannot be hit by anything
  const gone = (e) => e.dead || e.under;
  // hit by a Jammer (Tesla E4): auras off, ability clocks stopped, no split on death
  const jammed = (e) => e.jamT > 0;
  // a flyer out of reach of ground-only towers; Iced Wings (Frost) brings chilled flyers down for e.downT seconds
  const airborne = (e) => e.air && !(e.downT > 0);
  function canSee(t, e) {
    if (e.stealth && !e.revealed && !(t.s.seesStealth)) return false;
    return true;
  }
  // Area effects (splash, pulses, cones, beams, strips, pools) need sight too: they skip an unrevealed invisible foe.
  // Mines are the exception: they trip on, and blast, anything that walks over them, seen or not.
  const areaSees = (src, e) => !src || !src.s || canSee(src, e);
  function lineOfSight(x0, y0, x1, y1) {
    const len = dist(x0, y0, x1, y1);
    const steps = Math.ceil(len / (T / 4));
    for (let i = 1; i < steps; i++) {
      const k = i / steps;
      if (tileAt(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k) === 'forest') return false;
    }
    return true;
  }
  // Which part of a tower's range it can actually see: rays stop at the first tenement ('forest') tile.
  // Cached by position and range; cleared when a new map is built.
  const losCache = new Map();
  const usesSight = (key, s) => ['projectile', 'splash', 'chain', 'focus', 'sniper'].includes(TW[key].kind) && !s.ignoreForest;
  // Sentinel Rifle: map-wide range in tiles (the padded map's diagonal)
  const mapReach = () => Math.hypot(COLS, ROWS);
  // Which road tiles a rifle at (cx, cy) has a clear line to: the same lineOfSight test validTarget runs, to each
  // tile centre. One pass per position (~a few hundred lines), cached with losCache. seen[y][x] for the overlay.
  const roadCache = new Map();
  function roadSight(cx, cy) {
    const key = `${Math.round(cx)},${Math.round(cy)}`;
    let v = roadCache.get(key);
    if (v) return v;
    const tiles = [];
    let n = 0;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (grid[y][x] !== 'path') continue;
      const ok = lineOfSight(cx, cy, (x + 0.5) * T, (y + 0.5) * T);
      tiles.push([x, y, ok]); if (ok) n++;
    }
    v = { tiles, share: tiles.length ? n / tiles.length : 0 };
    if (roadCache.size > 200) roadCache.clear();
    roadCache.set(key, v);
    return v;
  }
  function visibility(cx, cy, R) {
    const key = `${Math.round(cx)},${Math.round(cy)},${Math.round(R)}`;
    let v = losCache.get(key);
    if (v) return v;
    // map-wide (the Sentinel Rifle): more rays so far shadows keep their shape, and rays end at the map's edge
    const big = R > 12 * T, N = big ? 360 : 160, step = T / 6, pts = [];
    let area = 0;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      let d = R;
      for (let s = step; s < R; s += step) {
        const tl = tileAt(cx + dx * s, cy + dy * s);
        if (tl === 'forest' || (big && tl === null)) { d = s; break; }
      }
      pts.push({ x: cx + dx * d, y: cy + dy * d });
      area += d * d;
    }
    v = { pts, share: 1 - area / (N * R * R) };
    if (losCache.size > 500) losCache.clear();
    losCache.set(key, v);
    return v;
  }

  // noLos: skip the line-of-sight ray (the costly part) so pickTarget can run it only for a foe that would win
  function validTarget(t, e, s, noLos) {
    if (gone(e)) return false;
    if (airborne(e) && !s.air) return false;
    const dd = dist(t.x, t.y, e.x, e.y);
    // Forward Observer: foes it has lit can be hit from farther away
    if (dd > s.range * (e.spotterT > 0 ? 1 + e.spotter : 1) * T + e.r) return false;
    if (s.minRange && dd < s.minRange * T) return false;
    if (!canSee(t, e)) return false;
    // the map-wide rifle needs a clear line even to a flyer: tenements are its one limit
    // tenements block shots at walkers only: flyers are above the roofs, for the Sentinel Rifle too
    if (!noLos && !e.air && !s.ignoreForest && !lineOfSight(t.x, t.y, e.x, e.y)) return false;
    return true;
  }
  function pickTarget(t, s) {
    let best = null, bestV = -Infinity;
    for (const e of state.enemies) {
      if (!validTarget(t, e, s, true)) continue;
      let v;
      switch (t.targetMode) {
        case 'last': v = -progress(e); break;
        case 'strong': v = e.hp; break;
        case 'close': v = -dist(t.x, t.y, e.x, e.y); break;
        case 'air': v = (e.air ? 1 : 0) + progress(e); break; // Flak: any flyer before any walker
        default: v = progress(e);
      }
      if (e.designT > 0) v += 1e9; // Designate: a foe it lit outranks every mode
      // the sight ray only runs for a foe that would take the lead: same pick, far fewer rays in a crowd
      if (v > bestV && (e.air || s.ignoreForest || lineOfSight(t.x, t.y, e.x, e.y))) { bestV = v; best = e; }
    }
    return best;
  }

  // ---------- damage ----------
  // set while a mine or a rail trail does its damage: it lands where it was placed, not where the tower stands
  let placedHit = false;
  // m: the hit's modifiers, usually the firing tower's stats (pierce, ignoreArmor, bossMul, airMul, execute)
  function damage(e, amt, type, src, m) {
    if (gone(e)) return;
    let a = amt;
    if (m && m.bossMul && e.boss) a *= m.bossMul;
    if (m && m.airMul && e.air) a *= m.airMul;
    if (type === 'physical') {
      if (e.chillT > 0) a *= 1 + C.COMBO.shatter;
      const armor = m && m.ignoreArmor ? 0 : Math.max(0, e.armor - ((m && m.pierce) || 0));
      a = Math.max(a * C.DAMAGE.physical.minShare, a - armor);
    } else if (type === 'magic') {
      a *= 1 - e.mdef;
    } else if (type === 'electric') {
      if (e.armor > 0) a *= C.DAMAGE.electric.vsArmor;
      a *= 1 - e.mdef;
    } // fire ignores both defenses
    // Cryo brittle and Mag Rail vuln add up, to a cap
    const taken = (e.chillT > 0 ? e.brittle : 0) + (e.vulnT > 0 ? e.vuln : 0);
    if (taken) a *= 1 + Math.min(C.COMBO.takenCap, taken);
    if (e.markT > 0) a *= 1 + e.mark;       // lit by a Searchlight
    if (e.aegis > 0) a *= 1 - e.aegis;      // sheltered by a Shield Bearer
    // sheltered by a Baffle Drone: only a tower's own hit from far away; fire, burning and placed damage (mines, trails) are exempt
    if (e.baffle > 0 && src && src.def && type !== 'fire' && !placedHit && dist(src.x, src.y, e.x, e.y) > e.baffleMin * T) a *= 1 - e.baffle;
    if (e.cargo && e.def.hook) a *= 1 - e.def.hook.ward; // a loaded Skyhook is hard to bring down
    if (e.def.hitCap && a > e.def.hitCap) a = e.def.hitCap; // Ironclad plating: one hit only goes so deep
    // Stasis (Clock B4): while it holds, hits are banked after every multiplier and land at once when it ends
    if (e.stasisT > 0) { e.bank += a; if (type !== 'fire') e.hitFlash = 0.08; return; }
    e.hp -= a;
    if (m && m.execute && !bossy(e) && e.hp > 0 && e.hp <= m.execute * e.maxHp) {
      // Deadeye: a wounded non-boss dies outright
      a += e.hp; e.hp = 0;
      floatText(e.x, e.y - 14, 'Executed', P.emberHi, 0.8);
      ring(e.x, e.y, 2, e.r * 2, P.coral, 0.3);
    }
    if (type !== 'fire') e.hitFlash = 0.08; // fire lands every frame; burning robots glow ember instead
    if (!e.fake) credit(src, Math.min(a, a + e.hp)); // shots into a hologram are wasted, not credited
    if (e.hp <= 0) kill(e, src);
  }
  // a tower's damage, for its own panel and for the all-time statistics by tower type
  function credit(src, a) {
    if (!src || a <= 0) return;
    src.dmgDealt += a;
    if (src.key) state.run.dmg[src.key] = (state.run.dmg[src.key] || 0) + a;
  }
  function kill(e, src) {
    if (e.fake) { popHologram(e); return; }
    // a Phoenix Frame gets back up once, unless a Jammer has its circuits scrambled
    if (e.def.revive && !e.reborn && !jammed(e)) {
      e.reborn = true;
      e.hp = e.maxHp * e.def.revive.hp;
      e.stunT = Math.max(e.stunT, e.def.revive.stun);
      e.burnT = 0; e.chillT = 0; e.brittle = 0; e.vulnT = 0; e.doomT = 0; e.markT = 0;
      ring(e.x, e.y, 3, e.r * 3.4, P.ember, 0.6); burst(e.x, e.y, P.emberHi, 16);
      floatText(e.x, e.y - 16, 'Rebooting', P.emberHi, 1);
      sfx('split');
      return;
    }
    e.dead = true;
    state.run.killsBy[e.type] = (state.run.killsBy[e.type] || 0) + 1;
    if (e.cargo) dropCargo(e, true);
    salvageWreck(e);
    // a Gilded Bank in range pays extra, under the wave's bankCap; a rebuilt robot pays nothing
    const pay = e.rebuilt ? 0 : e.def.bounty + bankBounty(e);
    state.gold += pay;
    state.kills++;
    if (src) src.kills++;
    if (pay) floatText(e.x, e.y - 8, `+${pay}`, P.goldHi, 0.7);
    sfx(e.boss ? 'bossDie' : e.def.air ? 'downed' : e.def.size >= 10 ? 'wreck' : 'pop');
    burst(e.x, e.y, e.def.color, e.boss ? 30 : 8);
    const d = e.def;
    if (d.split && !jammed(e)) {
      for (let i = 0; i < d.split.n; i++) spawnChild(d.split.into, e, i * 6);
      sfx('split');
    }
    if (d.blast) {
      // the furnace goes up and scorches the towers around it
      const R = d.blast.radius * T;
      for (const t of state.towers) if (towerWithin(t, e.x, e.y, R)) disableTower(t, d.blast.dur, 'Scorched');
      ring(e.x, e.y, 4, R, P.ember, 0.6); burst(e.x, e.y, P.ember, 16);
      sfx('bomb');
    }
    waveUnitGone(e.wave);
  }

  // Scrap Salvager: while one is out, a ground robot that dies leaves scrap on the road for `linger` s. A Salvager
  // that passes within `radius` claims it and rebuilds it `delay` s later. A claimed wreck holds the Salvager's wave open.
  function salvageWreck(e) {
    if (e.boss || e.air || e.rebuilt || e.def.salvage || !state.enemies.some((o) => o.def.salvage && !o.dead)) return;
    state.wrecks.push({ type: e.type, route: e.route, d: e.d, x: e.x, y: e.y, life: EN.salvager.salvage.linger, t: 0, by: null });
  }
  // a claimed wreck comes back while its Salvager stands; it rusts away if the Salvager dies or is jammed, and waits
  // while it is stunned
  function updateWrecks(dt) {
    for (const k of state.wrecks) {
      if (!k.by) {
        k.life -= dt;
        if (k.life <= 0) { k.done = true; continue; }
        const sv = state.enemies.find((o) => !gone(o) && o.def.salvage && !jammed(o) && o.salvaged < o.def.salvage.max
          && dist(o.x, o.y, k.x, k.y) <= o.def.salvage.radius * T);
        if (!sv) continue;
        sv.salvaged++; k.by = sv; k.t = sv.def.salvage.delay;
        const w = state.activeWaves.get(sv.wave);
        if (w) w.left++;
        continue;
      }
      const sv = k.by, sg = sv.def.salvage;
      if (sv.dead || jammed(sv)) {
        k.done = true; burst(k.x, k.y, P.roadLo, 8);
        waveUnitGone(sv.wave);
        continue;
      }
      if (sv.stunT > 0) continue;
      k.t -= dt;
      if (k.t > 0) continue;
      k.done = true;
      const g = spawn(k.type, sv.wave, k.d, k.route);
      g.hp = g.maxHp * sg.hp; g.rebuilt = true; g.reborn = true; g.dropped = true;
      ring(g.x, g.y, 2, T * 0.8, P.goldHi, 0.5); burst(g.x, g.y, P.gold, 10);
      floatText(g.x, g.y - 14, 'Rebuilt', P.goldHi, 0.9);
      sfx('split');
    }
    if (state.wrecks.some((k) => k.done)) state.wrecks = state.wrecks.filter((k) => !k.done);
  }
  // Mirage Caster's holograms vanish when shot, timed out, lit by a Searchlight or through the exit, harmlessly
  function popHologram(e) {
    e.dead = true;
    ring(e.x, e.y, 2, e.r * 2.2, P.ice, 0.35); burst(e.x, e.y, P.ice, 8);
    waveUnitGone(e.wave);
  }
  // Skyhook: set its cargo down on the nearest road; `fell` when the hook was shot down or jammed
  function dropCargo(h, fell) {
    const c = h.cargo, hk = h.def.hook;
    h.cargo = null; h.hookCd = hk.cd;
    if (!c || c.dead) return;
    const { poly, d: at } = roadDist(h.x, h.y), p = posOn(poly, at);
    state.effects.push({ type: 'rope', x0: h.x, y0: h.y, h0: aimHeight(h), x1: p.x, y1: p.y, life: 0.6, max: 0.6 });
    c.carried = null; c.air = false; c.poly = poly; c.route = Math.max(0, routes.indexOf(poly)); c.d = at; c.x = p.x; c.y = p.y;
    ring(p.x, p.y, 2, T * 0.7, fell ? P.ember : P.cream, 0.5);
    if (!fell) return;
    c.stunT = Math.max(c.stunT, hk.stun);
    floatText(p.x, p.y - 14, 'Dropped', P.emberHi, 0.9);
    burst(p.x, p.y, P.roadLo, 12); sfx('crash');
    c.hp -= c.maxHp * hk.fall;
    if (c.hp <= 0) kill(c, null);
  }

  // ---------- tower behaviour ----------
  // Turrets (Rivet Gun, Bombard) swing toward their current target every frame at a limited turn rate, and drift
  // back to a gentle idle sway when nothing is in range. Firing is untouched: it still picks its own target, and
  // the shot leaves along t.aim, which tracking has already brought (nearly) onto it.
  const TURN_RATE = { arrow: 9, cannon: 3.6, sniper: 5 };   // rad/s: the light gun whips round, the heavy mortar lumbers
  function trackAim(t, s, dt) {
    t.trackT = (t.trackT || 0) - dt;
    if (t.trackT <= 0 || !t.trackE || !validTarget(t, t.trackE, s)) { t.trackE = pickTarget(t, s); t.trackT = 0.12; }
    const e = t.trackE;
    if (t.home === undefined) t.home = t.aim;
    const want = e ? Math.atan2(e.y - t.y, e.x - t.x) : t.home + Math.sin(state.time * 0.45 + t.id * 1.7) * 0.45;
    const rate = (TURN_RATE[t.key] || 6) * (e ? 1 : 0.18);
    let diff = ((want - t.aim + Math.PI) % TAU + TAU) % TAU - Math.PI;
    const step = rate * dt;
    t.aim += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
    t.aim = ((t.aim + Math.PI) % TAU + TAU) % TAU - Math.PI;
  }
  function updateTower(t, dt) {
    t.flash = Math.max(0, t.flash - dt);
    if (t.linkCutT > 0) t.linkCutT -= dt;
    if (t.def.kind === 'volley') { t.ports = cornerPorts(t); if (t.hot) for (let i = 0; i < 8; i++) t.hot[i] = Math.max(0, t.hot[i] - dt); }
    t.s = computeStats(t);
    if (t.disabledT > 0) { t.disabledT -= dt; t.beams = []; return; }
    const s = t.s;
    const kind = t.def.kind;
    // Static Warden: a warded tower's own clock (cooldown, ramp, charge, sweep) runs slower; aim and flash keep real time
    const wdt = dt * (t.warded || 1);
    if (kind === 'focus') { updateFocus(t, s, wdt); return; }
    if (kind === 'light') { updateLight(t, s, wdt); return; }
    if (kind === 'barrier') { updateBarrier(t, s, dt); return; }
    if (kind === 'bank') { updateBank(t, s); return; }
    if (kind === 'support') {
      // Overdrive's on/off clock (read by computeStats); without overdrive the Amplifier has nothing to do
      t.odT = s.overdrive ? (t.odT || 0) + dt : 0;
      return;
    }
    if (kind === 'projectile' || kind === 'splash' || kind === 'sniper') trackAim(t, s, dt);
    // Capacitor: an idle gun (nothing in its line) stores up a multiplier for its next shot
    if (s.charge && !beamTargets(t, s).length) t.charge = Math.min(s.charge.max, (t.charge || 1) + s.charge.perSec * wdt);
    if (s.freeze) flashFreeze(t, s, wdt);
    t.cool -= wdt;
    if (t.cool > 0) return;
    if (kind === 'mines') {
      if (t.mineR !== s.range) { t.mineR = s.range; t.mineSpots = mineSpots(t); }
      if (ownMines(t) < s.maxMines && layMine(t)) t.cool = 1 / s.rate;
      return;
    }
    if (kind === 'clock') {
      if (state.enemies.some((e) => inClock(t, s, e))) clockStrike(t);
      return;
    }
    if (kind === 'sniper') {
      const e = pickTarget(t, s);
      if (e) sniperShot(t, s, e);
      return;
    }
    if (kind === 'projectile' || kind === 'splash') {
      const e = pickTarget(t, s);
      if (!e) return;
      // tracking has normally brought the barrel onto the target already; only the very first shot after a long
      // idle can still be off, and then the barrel closes most of the gap (the shot's own offset closes the rest)
      const gap = ((Math.atan2(e.y - t.y, e.x - t.x) - t.aim + Math.PI) % TAU + TAU) % TAU - Math.PI;
      t.aim += clamp(gap, -0.6, 0.6);
      // the shot flies from the tower's centre for the game; it is drawn leaving the barrel (mz)
      const mz = muzzlePt(t), look = towerLook(t);
      state.projectiles.push({
        x: t.x, y: t.y, sx: t.x, sy: t.y, target: e, tx: e.x, ty: e.y, speed: s.projSpeed * T,
        dmg: s.dmg, splash: (s.splash || 0) * T, s, hit: [], hops: 0,
        shred: s.shred || 0, arc: !!s.arc, kind, src: t, type: t.def.dmgType, color: t.def.color, traveled: 0,
        total: dist(t.x, t.y, e.x, e.y), ox: mz.x - t.x, oy: mz.y - t.y, h0: mz.h, h1: aimHeight(e),
        style: t.key !== 'arrow' ? null : look.form === 'A' ? 'spike' : look.form === 'B' ? 'rapid' : 'rivet',
      });
      if (kind === 'projectile') { sfx(state.projectiles[state.projectiles.length - 1].style === 'spike' ? 'spike' : 'rivet'); ventSteam(t); }
      t.cool = 1 / s.rate; t.flash = 0.1;
    } else if (kind === 'chain') {
      // Thunderstroke: every strike.every-th bolt skips the chain and hits the toughest foe in range
      const st = s.strike && (t.bolts = (t.bolts || 0) + 1) % s.strike.every === 0;
      let first = null;
      if (st) for (const e of state.enemies) if (validTarget(t, e, s) && (!first || e.hp > first.hp)) first = e;
      if (!first) first = pickTarget(t, s);
      if (!first) { if (st) t.bolts--; return; }
      t.aim = Math.atan2(first.y - t.y, first.x - t.x);
      const hit = st ? [first] : chainWalk(t, s, first, s.chains);
      const killed = [];
      hit.forEach((e, i) => {
        zap(t, s, e, s.dmg * Math.pow(s.falloff, i) * (st ? s.strike.mul : 1));
        if (e.dead) killed.push(e);
      });
      lightning([{ x: t.x, y: t.y }, ...hit.map((e) => ({ x: e.x, y: e.y }))], t, undefined, st);
      if (st) {
        ring(first.x, first.y, 4, first.r * 3, P.coral, 0.4);
        burst(first.x, first.y, P.goldHi, 10);
        floatText(first.x, first.y - 14, 'Thunderstroke', P.goldHi, 0.8);
      }
      // Chain Reaction: the first n kills each throw a fresh bolt (the leap off the corpse, then 4 jumps: up to
      // 5 hits); sparks don't spark
      if (s.reaction) for (const c of killed.slice(0, s.reaction.n)) {
        const near = chainWalk(t, s, c, 5, [c]).slice(1);
        if (!near.length) continue;
        near.forEach((e, i) => zap(t, s, e, s.dmg * s.reaction.mul * Math.pow(s.falloff, i)));
        lightning([{ x: c.x, y: c.y }, ...near.map((e) => ({ x: e.x, y: e.y }))], t, 0.45);
        burst(c.x, c.y, P.goldHi, 6);
      }
      sfx('zap');
      t.cool = 1 / s.rate; t.flash = 0.1;
    } else if (kind === 'pulse') {
      const inRange = state.enemies.filter((e) => !gone(e) && (!airborne(e) || s.air) && canSee(t, e) && dist(e.x, e.y, t.x, t.y) <= s.range * T + e.r);
      if (!inRange.length) return;
      for (const e of inRange) {
        e.slowMul = e.slowT > 0 ? Math.min(e.slowMul, s.slow) : s.slow;
        e.slowT = Math.max(e.slowT, s.slowDur);
        e.chillT = Math.max(e.chillT, s.slowDur);
        if (s.brittle) e.brittle = Math.max(e.brittle, s.brittle);
        // Iced Wings: chilled flyers drop low enough for ground-only towers
        if (s.grounds && e.air) { if (!(e.downT > 0)) ring(e.x, e.y, 2, e.r * 2.2, P.ice, 0.35); e.downT = Math.max(e.downT || 0, s.grounds); }
        damage(e, s.dmg, 'magic', t);
      }
      if (s.hail) hailstorm(t, s, inRange);
      ring(t.x, t.y, 4, s.range * T, P.ice, 0.45);
      sfx('frost');
      t.cool = 1 / s.rate; t.flash = 0.15;
    } else if (kind === 'volley') {
      volley(t, s);
    } else if (kind === 'beam') {
      if (beamTargets(t, s).length) fireBeam(t);
    } else if (kind === 'cone') {
      const hits = state.enemies.filter((e) => inCone(t, s, e));
      if (!hits.length) return;
      for (const e of hits) {
        damage(e, s.dmg, 'fire', t, s);
        if (!e.dead) ignite(e, s, t);
      }
      if (s.pool) firewall(t, s);
      flameParticles(t, s);
      sfx('flame');
      t.cool = 1 / s.rate; t.flash = 0.14;
    }
  }

  // Tesla: from `from`, jump to the nearest unhit enemy within chainRange, n times. `hit` seeds the list
  // (a Chain Reaction spark starts from its corpse). Returns every enemy on the chain, the seed included.
  function chainWalk(t, s, from, n, hit = [from]) {
    let cur = from;
    for (let k = 0; k < n; k++) {
      let next = null, nd = Infinity;
      for (const e of state.enemies) {
        if (gone(e) || hit.includes(e) || (airborne(e) && !s.air) || !canSee(t, e)) continue;
        const dd = dist(cur.x, cur.y, e.x, e.y);
        if (dd <= s.chainRange * T && dd < nd) { nd = dd; next = e; }
      }
      if (!next) break;
      hit.push(next); cur = next;
    }
    return hit;
  }
  // One Tesla hit: Lightning Rod's conduct scales with the foe's armour (on top of electric's own bonus), Ionise
  // strips magic defence for good (bosses at half rate), Jammer suspends auras and abilities.
  function zap(t, s, e, amt) {
    if (gone(e)) return;
    damage(e, amt * (1 + (s.conduct || 0) * e.armor), t.def.dmgType, t, s);
    if (e.dead) return;
    if (s.ionise && e.mdef > 0) {
      const was = e.mdef;
      e.mdef = Math.max(0, e.mdef - s.ionise * (e.boss ? 0.5 : 1));
      e.ionised = (e.ionised || 0) + was - e.mdef;
      sparks(e.x, e.y, aimHeight(e), -Math.PI / 2, 1.2, [P.lilac, P.cream], 3);
    }
    if (s.jam) {
      if (!(e.jamT > 0)) { ring(e.x, e.y, 2, e.r * 2.4, P.steel, 0.35); floatText(e.x, e.y - 14, 'Jammed', P.steel, 0.7); }
      e.jamT = Math.max(e.jamT || 0, e.boss ? s.jam.dur * C.COMBO.bossStun : s.jam.dur);
      if (e.plantT > 0) { e.plantT = 0; e.sapTarget = null; } // the fuse is cut
      if (e.thiefLock > 0) { e.thiefLock = 0; e.thiefTarget = null; } // the lock-on drops
    }
  }
  // Set an enemy burning: the hottest burn wins, fire thaws chill. Thermite's melt and Napalm's slow ride on the
  // burn; dur/dps override the tower's own (Firewall pools, Firestorm spread).
  function ignite(e, s, src, dps = s.burn, dur = s.burnDur) {
    const was = e.burnT > 0;
    e.burnDps = Math.max(was ? e.burnDps : 0, dps);
    e.burnT = Math.max(e.burnT, dur);
    e.burnSrc = src;
    e.chillT = 0; e.brittle = 0; // fire thaws
    if (s.melt) e.melt = Math.max(was ? e.melt || 0 : 0, s.melt);
    else if (!was) e.melt = 0;
    if (s.burnSlow) { e.slowMul = e.slowT > 0 ? Math.min(e.slowMul, s.burnSlow) : s.burnSlow; e.slowT = Math.max(e.slowT, dur); }
  }
  // Firewall: the road tiles inside the cone catch for pool.dur seconds (re-laid at most 4 times a second).
  function firewall(t, s) {
    if (state.time < (t.poolAt || 0)) return;
    t.poolAt = state.time + 0.25;
    const R = s.range * T, cx0 = Math.floor(t.x / T), cy0 = Math.floor(t.y / T), n = Math.ceil(s.range);
    const until = state.time + s.pool.dur;
    for (let cy = cy0 - n; cy <= cy0 + n; cy++) for (let cx = cx0 - n; cx <= cx0 + n; cx++) {
      if (!inBounds(cx, cy) || grid[cy][cx] !== 'path') continue;
      const x = (cx + 0.5) * T, y = (cy + 0.5) * T;
      if (dist(t.x, t.y, x, y) > R || !inCone(t, s, { x, y, r: 0, air: false })) continue;
      const key = cy * COLS + cx, old = state.pools.get(key);
      if (old && old.until > state.time && old.dps > s.pool.dps) { old.until = Math.max(old.until, until); continue; }
      state.pools.set(key, { cx, cy, x, y, dps: s.pool.dps, until, src: t, s });
    }
  }
  // Pools set walkers on them burning (short, refreshed each frame) and carry the Napalm slow.
  function updatePools(dt) {
    if (!state.pools.size) return;
    for (const [k, q] of state.pools) {
      if (q.until <= state.time) { state.pools.delete(k); continue; }
      if (Math.random() > dt * 2.5) continue;
      const life = 0.35 + Math.random() * 0.2;
      state.effects.push({ type: 'fire', x: q.x + (Math.random() - 0.5) * T * 0.8, y: q.y + (Math.random() - 0.5) * T * 0.8, h0: 0.02, h1: 0.35, ang: Math.random() * TAU, reach: 3, s: 0.4, rise: 0.25, life, max: life });
    }
    for (const e of state.enemies) {
      if (gone(e) || airborne(e)) continue;
      const q = state.pools.get(Math.floor(e.y / T) * COLS + Math.floor(e.x / T));
      if (q && areaSees(q.src, e)) ignite(e, q.s, q.src, q.dps, 0.5);
    }
  }
  // Firestorm: every `every` seconds, each enemy this tower set burning lights the nearest unburnt one within reach.
  function updateSpread(dt) {
    for (const t of state.towers) {
      const sp = t.s && t.s.spread;
      if (!sp || t.disabledT > 0) continue;
      t.spreadCd = (t.spreadCd || 0) - dt;
      if (t.spreadCd > 0) continue;
      t.spreadCd = sp.every;
      const R = sp.reach * T, lit = state.enemies.filter((e) => !gone(e) && e.burnT > 0 && e.burnSrc === t);
      for (const e of lit) {
        let next = null, nd = Infinity;
        for (const o of state.enemies) {
          if (gone(o) || o.burnT > 0 || (airborne(o) && !t.s.air)) continue;
          const dd = dist(e.x, e.y, o.x, o.y);
          if (dd <= R + o.r && dd < nd) { nd = dd; next = o; }
        }
        if (!next) continue;
        ignite(next, t.s, t);
        sparks(e.x, e.y, aimHeight(e), Math.atan2(next.y - e.y, next.x - e.x), 0.5, [P.ember, P.emberHi], 5);
        burst(next.x, next.y, P.ember, 4);
      }
    }
  }
  // Hailstorm: each pulse drops hailstones on random enemies it reached. Physical, so the chill it just laid
  // makes them shatter (+40%), and Cryo's brittle adds on top.
  function hailstorm(t, s, hit) {
    for (let i = 0; i < s.hail.n; i++) {
      const live = hit.filter((e) => !gone(e));
      if (!live.length) return;
      const e = live[Math.floor(Math.random() * live.length)];
      damage(e, s.hail.dmg * (s.dmgMul || 1), 'physical', t, s);
      ring(e.x + (Math.random() - 0.5) * 6, e.y + (Math.random() - 0.5) * 6, 1, 7, P.cream, 0.22);
      sparks(e.x, e.y, aimHeight(e) + 0.3, Math.PI / 2, 0.6, [P.ice, P.cream], 3);
    }
  }
  // Flash Freeze: on its own clock, the toughest enemy in range (most hp) is frozen solid. Bosses get a share.
  function flashFreeze(t, s, dt) {
    t.freezeCd = (t.freezeCd ?? s.freeze.every) - dt;
    if (t.freezeCd > 0) return;
    let best = null;
    for (const e of state.enemies) {
      if (gone(e) || (airborne(e) && !s.air) || !canSee(t, e) || dist(e.x, e.y, t.x, t.y) > s.range * T + e.r) continue;
      if (!best || e.hp > best.hp) best = e;
    }
    if (!best) { t.freezeCd = 0; return; }
    const dur = best.boss ? s.freeze.dur * C.COMBO.bossStun : s.freeze.dur;
    best.stunT = Math.max(best.stunT, dur);
    best.chillT = Math.max(best.chillT, dur);
    ring(best.x, best.y, 4, best.r * 2.4, P.ice, 0.5);
    floatText(best.x, best.y - 14, 'Frozen', P.ice, 0.8);
    lightning([{ x: t.x, y: t.y }, { x: best.x, y: best.y }], t);
    t.freezeCd = s.freeze.every;
  }

  // Arcane Prism: a continuous beam whose power climbs while it stays on one target.
  function updateFocus(t, s, dt) {
    const was = t.focus;
    let e = was && validTarget(t, was, s) ? was : null;
    if (!e) {
      e = pickTarget(t, s);
      if (e !== was) {
        // Afterglow: a kill passes part of the ramp on (it waits, fading, if nothing is in range yet);
        // a target that walks out or burrows still resets it
        if (s.carry && was && was.hp <= 0) {
          t.glow = t.ramp * s.carry;
          ring(was.x, was.y, 2, was.r * 2.6, P.lilac, 0.45); burst(was.x, was.y, P.lilac, 8);
        }
        t.ramp = t.glow || 0;
        if (e) t.glow = 0;
      }
      t.focus = e;
    }
    if (!e) {
      t.beams = [];
      if (t.glow > 0) t.ramp = t.glow = Math.max(0, t.glow - dt / s.rampTime);
      return;
    }
    t.ramp = Math.min(1, t.ramp + dt / s.rampTime);
    const power = 1 + (s.rampMax - 1) * t.ramp;
    damage(e, s.dmg * power * dt, 'magic', t);
    t.aim = Math.atan2(e.y - t.y, e.x - t.x);
    t.beams = [e]; t.beamK = [t.ramp];
    if (s.beams > 1) {
      const extra = state.enemies
        .filter((o) => o !== e && validTarget(t, o, s))
        .sort((a, b) => dist(t.x, t.y, a.x, a.y) - dist(t.x, t.y, b.x, b.y))
        .slice(0, s.beams - 1);
      if (s.heat) heatBeams(t, s, extra, dt);
      for (const o of extra) {
        const h = s.heat ? t.heat.get(o) : 0;
        damage(o, s.dmg * (1 + ((s.heat ? s.heat.max : 1) - 1) * h) * dt, 'magic', t);
        t.beams.push(o); t.beamK.push(h);
      }
    }
    if (s.drag && !gone(e)) gravityDrag(t, s, e, dt);
    if (s.pull && !gone(e)) singularity(t, s, e, dt);
    sfx('prism');
  }
  // Spectrum: every enemy an extra beam lights warms up on its own (0..1 in t.heat), and cools 1.5× as fast unlit
  function heatBeams(t, s, lit, dt) {
    t.heat = t.heat || new Map();
    for (const [o, h] of t.heat) {
      if (lit.includes(o)) continue;
      const n = h - (1.5 * dt) / s.heat.time;
      if (n <= 0 || o.dead) t.heat.delete(o); else t.heat.set(o, n);
    }
    for (const o of lit) t.heat.set(o, Math.min(1, (t.heat.get(o) || 0) + dt / s.heat.time));
  }
  // Gravity: the beam pulls its target back along its route, growing with the ramp. Never faster than the
  // target walks (it holds, it does not shove); bosses feel a quarter, and a Lamplighter's lantern cancels it.
  function gravityDrag(t, s, e, dt) {
    if (e.noCtl) return;
    const own = e.def.speed * e.pace * (e.slowT > 0 ? e.slowMul : 1) * (1 + e.haste);
    const v = Math.min(own, s.drag * t.ramp * (e.boss ? C.COMBO.knockbackBoss : 1) * (1 - e.gov));
    if (v <= 0) return;
    e.d = Math.max(0, e.d - v * T * dt);
    const q = posOn(e.poly, e.d); e.x = q.x; e.y = q.y;
    if (Math.random() < dt * 3) ring(e.x, e.y, e.r * 2.6, e.r, P.teal, 0.35);
  }
  // Singularity: foes near the target slide along their route toward it, into a clump. Bosses anchor but never move.
  function singularity(t, s, e, dt) {
    const R = s.pull.radius * T, step = s.pull.speed * T * dt;
    for (const o of state.enemies) {
      if (o === e || o.boss || gone(o) || o.poly !== e.poly || dist(o.x, o.y, e.x, e.y) > R) continue;
      const gap = e.d - o.d, room = Math.abs(gap) - (o.r + e.r) * 0.6;
      if (room <= 0) continue;
      const nd = o.d + Math.sign(gap) * Math.min(step, room);
      o.d = gap > 0 ? Math.min(nd, barrierStop(o, nd)) : nd; // pulled forward, a barricade still stops it
      o.blocked = null;
      const q = posOn(o.poly, o.d); o.x = q.x; o.y = q.y;
      if (Math.random() < dt * 2) sparks(o.x, o.y, aimHeight(o), Math.atan2(e.y - o.y, e.x - o.x), 0.3, [P.teal, P.lilac], 2);
    }
    t.pullFx = (t.pullFx || 0) - dt;
    if (t.pullFx <= 0) { t.pullFx = 0.6; ring(e.x, e.y, R, e.r, P.teal, 0.55); }
  }

  // Searchlight: the beam turns steadily; whatever it crosses is revealed and marked to take extra damage.
  // Designator locks onto the toughest foe and lights only it; Floodlight lights its whole circle.
  function inLight(t, s, e) {
    if (gone(e)) return false;
    if (dist(t.x, t.y, e.x, e.y) > s.range * T + e.r) return false;
    if (s.flood) return true;
    let diff = Math.abs(Math.atan2(e.y - t.y, e.x - t.x) - t.aim) % TAU;
    if (diff > Math.PI) diff = TAU - diff;
    const lit = diff <= (s.cone * Math.PI) / 180 || dist(t.x, t.y, e.x, e.y) < e.r + 8;
    return s.lock && t.lockE ? e === t.lockE && lit : lit;
  }
  // the toughest foe it can see in range; the current lock holds unless another has 25% more hp
  function lockTarget(t, s) {
    const ok = (e) => !gone(e) && canSee(t, e) && dist(t.x, t.y, e.x, e.y) <= s.range * T + e.r;
    let best = t.lockE && ok(t.lockE) ? t.lockE : null;
    for (const e of state.enemies) if (ok(e) && (!best || e.hp > best.hp * (best === t.lockE ? 1.25 : 1))) best = e;
    return best;
  }
  const LOCK_TURN = 5; // rad/s: the Designator swings onto a new lock instead of snapping
  function updateLight(t, s, dt) {
    t.lockE = s.lock && !s.flood ? lockTarget(t, s) : null;
    if (t.lockE) {
      const e = t.lockE, diff = ((Math.atan2(e.y - t.y, e.x - t.x) - t.aim + Math.PI) % TAU + TAU) % TAU - Math.PI;
      t.aim += clamp(diff, -LOCK_TURN * dt, LOCK_TURN * dt);
    } else t.aim = (t.aim + (s.flood ? 0.4 : s.sweep) * dt) % TAU; // a flooding lamp idles round slowly
    for (const e of state.enemies) {
      if (!inLight(t, s, e)) continue;
      e.spotT = Math.max(e.spotT, s.revealDur * (e.def.veil || 1)); // a Wraith's veil shortens the reveal
      e.mark = e.markT > 0 ? Math.max(e.mark, s.mark) : s.mark;
      e.markT = Math.max(e.markT, s.markDur);
      if (s.designate) e.designT = Math.max(e.designT, s.markDur);
      if (s.spotter) { e.spotter = e.spotterT > 0 ? Math.max(e.spotter, s.spotter.range) : s.spotter.range; e.spotterT = Math.max(e.spotterT, s.markDur); }
    }
  }

  // Mine Layer: rolls a mine onto a free stretch of road in range. Returns false if there is no room.
  function layMine(t) {
    const s = t.s, spots = t.mineSpots || [];
    if (!spots.length) return false;
    const mine = state.mines.filter((m) => m.src === t && !m.mini);
    const free = spots.filter((q) => !state.mines.some((m) => !m.stuck && dist(m.x, m.y, q.x, q.y) < T * 0.6));
    if (!free.length) return false;
    // prefer the stretch the robots reach first, so the mines meet them as early as possible
    const q = free[Math.floor(Math.random() * Math.min(free.length, 3 + mine.length))];
    state.mines.push({ x: q.x, y: q.y, d: q.d, poly: q.poly, src: t, armT: 0.6, born: state.time });
    t.flash = 0.15;
    sfx('lay');
    return true;
  }
  // A mine going off: a white flash, a gold shockwave chased by a cream one, a scorch on the paving, and brass
  // shrapnel (embers for burning mines) thrown up and out. Same area as before; this is all drawing.
  function mineBlast(m, R, fire) {
    const hot = fire ? P.ember : P.goldHi;
    state.effects.push({ type: 'flash', x: m.x, y: m.y, R, life: 0.22, max: 0.22 });
    state.effects.push({ type: 'scorch', x: m.x, y: m.y, R: R * 0.4, fire, life: 1.1, max: 1.1 });
    ring(m.x, m.y, 4, R, hot, 0.38);
    ring(m.x, m.y, 2, R * 0.7, P.cream, 0.26);
    sparks(m.x, m.y, 0.15, 0, Math.PI, [P.goldHi, P.cream, hot, P.brass], 22);
    burst(m.x, m.y, fire ? P.emberHi : P.creamDim, 8);
  }
  // A mine going off where it lies. Mini-mines (Scatter Charge) carry their own dmg and splash and don't scatter.
  function detonate(m) {
    const s = m.src.s, R = (m.mini ? m.splash : s.splash) * T, dmg = m.mini ? m.dmg : s.dmg;
    for (const e of state.enemies) {
      if (gone(e) || airborne(e) || dist(e.x, e.y, m.x, m.y) > R + e.r) continue;
      placedHit = true; damage(e, dmg, 'physical', m.src, s); placedHit = false;
      if (e.dead) continue;
      if (s.shred) e.armor = Math.max(0, e.armor - s.shred);
      if (s.slow !== undefined && s.slowDur) { e.slowMul = e.slowT > 0 ? Math.min(e.slowMul, s.slow) : s.slow; e.slowT = Math.max(e.slowT, s.slowDur); }
      if (s.stun) e.stunT = Math.max(e.stunT, e.boss ? s.stun * C.COMBO.bossStun : s.stun); // Tanglefoot
      if (s.burn) ignite(e, s, m.src);
    }
    if (s.scatter && !m.mini && state.mines.filter((o) => o.src === m.src && o.mini).length < s.maxMines) {
      // Scatter Charge: mini-mines land along the road on both sides of the blast
      const c = s.scatter;
      for (let i = 0; i < c.n; i++) {
        const poly = m.poly || path, d = clamp(m.d + (i % 2 ? 1 : -1) * (0.7 + Math.random() * 0.6) * T, 0, poly.len), p = posOn(poly, d);
        state.mines.push({ x: p.x, y: p.y, d, poly, src: m.src, armT: 0.4, born: state.time, mini: true, dmg: c.dmg * (s.dmgMul || 1), splash: c.splash });
      }
    }
    mineBlast(m, R, !!s.burn);
    sfx('mine');
  }
  // Mines that count against maxMines: the ones waiting on the road (not mini-mines, not limpets already clinging)
  const ownMines = (t) => state.mines.filter((m) => m.src === t && !m.mini && !m.stuck).length;
  function updateMines(dt) {
    for (const m of state.mines) {
      if (m.stuck) {
        // Limpet: rides the enemy that tripped it and blasts again every `every` seconds
        if (!m.stuck.dead) { m.x = m.stuck.x; m.y = m.stuck.y; m.d = m.stuck.d; m.poly = m.stuck.poly; }
        m.cd -= dt;
        if (m.cd > 0) continue;
        detonate(m);
        if (--m.left <= 0) m.done = true; else m.cd = m.src.s.limpet.every;
        continue;
      }
      if (m.armT > 0) { m.armT -= dt; continue; }
      const trip = state.enemies.find((e) => !gone(e) && !airborne(e) && dist(e.x, e.y, m.x, m.y) <= T * 0.35 + e.r);
      if (!trip) continue;
      detonate(m);
      const lp = m.src.s.limpet;
      if (lp && !m.mini && lp.n > 1 && !trip.dead) { m.stuck = trip; m.left = lp.n - 1; m.cd = lp.every; }
      else m.done = true;
    }
    state.mines = state.mines.filter((m) => !m.done);
  }

  // Clock Tower: a strike every few seconds stuns everything in range. Bosses only take the hit (Chronometer's
  // stunBoss stuns them for COMBO.bossStun of it). Deathwatch's `targets` narrows the strike to the n toughest.
  function inClock(t, s, e) { return !gone(e) && (!airborne(e) || s.air) && canSee(t, e) && dist(t.x, t.y, e.x, e.y) <= s.range * T + e.r; }
  function clockStrike(t) {
    const s = t.s;
    // Chronometer's toll: every n-th strike rings long; with Midnight that strike stops time instead
    const toll = !!s.toll && (t.tollN = (t.tollN || 0) + 1) >= s.toll.every;
    if (toll) t.tollN = 0;
    const stunMul = toll ? s.toll.mul || 1 : 1;
    let hit = state.enemies.filter((e) => inClock(t, s, e));
    if (s.targets) {
      hit = hit.sort((a, b) => b.hp - a.hp).slice(0, s.targets);
      for (const e of hit) lightning([{ x: t.x, y: t.y }, { x: e.x, y: e.y }], t);
    }
    for (const e of hit) {
      damage(e, s.dmg, 'magic', t);
      if (e.dead) continue;
      // Last Hour: a brand that takes a share of max HP later; a branded foe is not branded again until it lands
      if (s.doom && !(e.doomT > 0)) {
        e.doomT = s.doom.delay; e.doomShare = bossy(e) ? s.doom.boss : s.doom.share; e.doomSrc = t; e.doomMax = s.doom.delay;
        floatText(e.x, e.y - 14, 'Branded', P.coral, 0.8);
      }
      if (e.noCtl || (e.boss && !s.stunBoss)) continue;
      const stun = (e.boss ? s.stun * C.COMBO.bossStun : s.stun) * stunMul;
      e.stunT = Math.max(e.stunT, stun);
      if (s.slow) { e.slowMul = e.slowT > 0 ? Math.min(e.slowMul, s.slow) : s.slow; e.slowT = Math.max(e.slowT, s.slowDur + stun); }
      // Stasis: only this Clock's own stun starts it, and never on a boss
      if (s.stasis && !e.boss) { if (!(e.stasisT > 0)) e.bank = 0; e.stasisT = Math.max(e.stasisT, stun); e.stasisMul = s.stasis.mul; e.stasisSrc = t; }
    }
    if (toll && s.midnight) midnight(t, s);
    else if (toll) { ring(t.x, t.y, 8, s.range * T * 1.08, C.ARCH.engineering.color, 0.9); sfx('toll'); }
    t.strikes++;
    ring(t.x, t.y, 6, s.range * T, P.goldHi, 0.6);
    ring(t.x, t.y, 4, s.range * T * 0.7, P.cream, 0.45);
    if (!toll) sfx('clock');
    t.cool = 1 / s.rate; t.flash = toll ? 0.6 : 0.3;
  }
  // Midnight (Chronometer T4): time stops for everything in the wider circle, flyers and bosses too, and every
  // tower in it is readied to fire into the stillness. Other Clock Towers are not readied, or two Midnights
  // would ready each other into a loop.
  function midnight(t, s) {
    const M = s.midnight, R = s.range * M.reach * T;
    for (const e of state.enemies) {
      if (gone(e) || e.noCtl || !canSee(t, e) || dist(t.x, t.y, e.x, e.y) > R + e.r) continue;
      const dur = e.boss ? M.boss : M.dur;
      e.stunT = Math.max(e.stunT, dur); e.stopT = Math.max(e.stopT || 0, dur);
    }
    for (const o of state.towers) {
      if (o === t || o.def.kind === 'clock' || o.disabledT > 0 || dist(o.x, o.y, t.x, t.y) > R || !(o.cool > 0)) continue;
      o.cool = 0;
    }
    state.effects.push({ type: 'midnight', x: t.x, y: t.y, R, life: M.dur, max: M.dur });
    ring(t.x, t.y, 10, R, P.cream, 1.2);
    sfx('midnight');
  }
  // Last Hour's brand lands: a share of max HP as true damage, past every defence and multiplier.
  function doomStrike(e) {
    const a = e.doomShare * e.maxHp, src = state.towers.includes(e.doomSrc) ? e.doomSrc : null;
    if (e.stasisT > 0) { e.bank += a; return; }
    ring(e.x, e.y, 2, e.r * 3, P.coral, 0.45); burst(e.x, e.y, P.coral, 10);
    floatText(e.x, e.y - 14, `−${Math.round(a)}`, P.coral, 0.9);
    trueDamage(e, a, src);
  }
  // True damage (Last Hour, Mirror Plate): past armour, ward and every multiplier; Stasis still banks it.
  function trueDamage(e, a, src) {
    if (gone(e)) return;
    if (e.stasisT > 0) { e.bank += a; return; }
    e.hp -= a;
    if (!e.fake) credit(src, Math.min(a, a + e.hp)); // shots into a hologram are wasted, not credited
    if (e.hp <= 0) kill(e, src);
  }
  // Stasis ends (stun over, or a Lamplighter's lantern broke it): the banked damage lands once, ×stasis.mul.
  function releaseStasis(e) {
    e.stasisT = 0;
    const a = e.bank * (e.stasisMul || 1), src = state.towers.includes(e.stasisSrc) ? e.stasisSrc : null;
    e.bank = 0;
    if (a <= 0) return;
    e.hp -= a;
    if (!e.fake) credit(src, Math.min(a, a + e.hp)); // shots into a hologram are wasted, not credited
    state.effects.push({ type: 'flash', x: e.x, y: e.y, R: e.r * 3, life: 0.2, max: 0.2 });
    ring(e.x, e.y, 2, e.r * 2.6, P.lilac, 0.4);
    floatText(e.x, e.y - 14, `${Math.round(a)}`, P.lilac, 0.8);
    if (e.hp <= 0) kill(e, src);
  }

  function beamGeom(t, s) {
    const [dx, dy] = DIRS[t.dir];
    return { dx, dy, len: s.range * T, half: s.width * T };
  }
  function beamTargets(t, s) {
    const g = beamGeom(t, s);
    return state.enemies.filter((e) => {
      if (gone(e) || (airborne(e) && !s.air) || !canSee(t, e)) return false;
      const rx = e.x - t.x, ry = e.y - t.y;
      const along = rx * g.dx + ry * g.dy;
      const perp = Math.abs(rx * -g.dy + ry * g.dx);
      return along >= 0 && along <= g.len + e.r && perp <= g.half + e.r;
    });
  }
  function fireBeam(t) {
    const s = t.s, look = towerLook(t);
    const g = beamGeom(t, s), mz = muzzlePt(t), mul = s.charge ? t.charge || 1 : 1;
    for (const e of beamTargets(t, s)) {
      damage(e, s.dmg * mul, 'magic', t, s);
      if (!e.dead) magnetise(e, s);
      sparks(e.x, e.y, aimHeight(e), Math.atan2(g.dy, g.dx), 0.9, [P.cream, t.def.color, P.goldHi], 5);
    }
    if (s.trail) layTrail(t, s, g);
    if (s.charge) {
      if (mul > 1.05) floatText(mz.x, mz.y - 10, `×${mul.toFixed(1)}`, P.goldHi, 0.9);
      t.charge = 1;
    }
    sfx('rail');
    // drawn from the barrel tip to the end of the line, at barrel height; Pulse Rail fires all three barrels
    const out = (mz.x - t.x) * g.dx + (mz.y - t.y) * g.dy;
    state.effects.push({
      type: 'rail', x0: mz.x, y0: mz.y, h: mz.h, dx: g.dx, dy: g.dy, len: Math.max(T, g.len - out), w: g.half * 2 * Math.sqrt(mul),
      lanes: look.form === 'B' ? [-0.2 * T, 0, 0.2 * T] : [0], coil: look.form === 'A' && look.step >= 3 ? 2 : 1,
      color: t.def.color, phase: Math.random() * TAU, life: 0.55, max: 0.55,
    });
    sparks(mz.x, mz.y, mz.h, Math.atan2(g.dy, g.dx), 0.5, [P.cream, t.def.color], 6);
    t.cool = 1 / s.rate; t.flash = 0.15;
  }
  // Mag Rail: slow, stun (bosses feel a share of it) and vuln, which lasts as long as the slow
  function magnetise(e, s) {
    if (s.slow !== undefined && s.slowDur) { e.slowMul = e.slowT > 0 ? Math.min(e.slowMul, s.slow) : s.slow; e.slowT = Math.max(e.slowT, s.slowDur); }
    if (s.stun) e.stunT = Math.max(e.stunT, e.boss ? s.stun * C.COMBO.bossStun : s.stun);
    if (s.vuln) { e.vuln = e.vulnT > 0 ? Math.max(e.vuln, s.vuln) : s.vuln; e.vulnT = Math.max(e.vulnT, s.slowDur || 1); }
  }
  // Arc Rail: road tiles under the beam go live. A tile keeps the hotter strip if two railguns cross it.
  function layTrail(t, s, g) {
    const tr = s.trail, w = (tr.width || 0) * T, until = state.time + tr.dur;
    for (let a = 0; a <= g.len; a += T / 4) for (const o of [-w, 0, w]) {
      const x = t.x + g.dx * a - g.dy * o, y = t.y + g.dy * a + g.dx * o;
      const cx = Math.floor(x / T), cy = Math.floor(y / T);
      if (!inBounds(cx, cy) || grid[cy][cx] !== 'path') continue;
      const key = cy * COLS + cx, old = state.strips.get(key);
      if (old && old.until > state.time && old.dps > tr.dps) { old.until = Math.max(old.until, until); continue; }
      state.strips.set(key, { cx, cy, x: (cx + 0.5) * T, y: (cy + 0.5) * T, dps: tr.dps, until, dur: tr.dur, src: t });
    }
  }
  function updateStrips(dt) {
    if (!state.strips.size) return;
    for (const [k, st] of state.strips) if (st.until <= state.time) state.strips.delete(k);
    for (const e of state.enemies) {
      if (gone(e) || airborne(e)) continue;
      const st = state.strips.get(Math.floor(e.y / T) * COLS + Math.floor(e.x / T));
      if (st && areaSees(st.src, e)) { placedHit = true; damage(e, st.dps * dt, 'electric', st.src); placedHit = false; }
    }
    // Third Rail: each tower's strip throws an arc at something near it (flyers too), chaining like a Tesla bolt
    for (const t of state.towers) {
      const arc = t.s && t.s.trail && t.s.trail.arc;
      if (!arc) continue;
      t.arcCd = (t.arcCd || 0) - dt;
      if (t.arcCd > 0) continue;
      const R = arc.reach * T, mine = [...state.strips.values()].filter((st) => st.src === t);
      let from = null, first = null;
      for (const e of state.enemies) {
        if (gone(e) || !canSee(t, e)) continue;
        const st = mine.find((q) => dist(q.x, q.y, e.x, e.y) <= R + e.r);
        if (st && (!first || progress(e) > progress(first))) { first = e; from = st; }
      }
      if (!first) continue;
      const hit = [first];
      while (hit.length < arc.chains + 1) {
        const cur = hit[hit.length - 1];
        let next = null, nd = Infinity;
        for (const e of state.enemies) {
          if (gone(e) || hit.includes(e) || !canSee(t, e)) continue;
          const dd = dist(cur.x, cur.y, e.x, e.y);
          if (dd <= R + e.r && dd < nd) { nd = dd; next = e; }
        }
        if (!next) break;
        hit.push(next);
      }
      for (const e of hit) damage(e, arc.dmg, 'electric', t);
      lightning([{ x: from.x, y: from.y }, ...hit.map((e) => ({ x: e.x, y: e.y }))], t, 0.05);
      sfx('zap');
      t.arcCd = arc.every;
    }
  }
  function inCone(t, s, e) {
    if (gone(e) || (airborne(e) && !s.air) || !canSee(t, e)) return false;
    const dd = dist(t.x, t.y, e.x, e.y);
    if (dd > s.range * T + e.r) return false;
    const a = Math.atan2(e.y - t.y, e.x - t.x);
    const f = Math.atan2(DIRS[t.dir][1], DIRS[t.dir][0]);
    let diff = Math.abs(a - f);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    return diff <= (s.cone * Math.PI) / 180 || dd < e.r + 6;
  }

  // Sentinel Rifle: one instant round along a clear line, anywhere on the map. Executioner adds `cull`, Rapid Rifle's
  // Hair Trigger re-chambers on a kill (`quick`), Spotter stuns (`stun`, `interrupt`, `gridlock`).
  function sniperShot(t, s, e) {
    t.aim = Math.atan2(e.y - t.y, e.x - t.x);
    const mz = muzzlePt(t), acc = towerAccent(t), h1 = aimHeight(e);
    state.effects.push({ type: 'tracer', x0: mz.x, y0: mz.y, h0: mz.h, x1: e.x, y1: e.y, h1, color: acc ? acc.color : P.cream, big: !!(acc && acc.big), life: 0.1, max: 0.1 });
    sparks(e.x, e.y, h1, t.aim + Math.PI, 0.5, [P.cream, P.goldHi], 2);
    sfx('snipe'); t.flash = 0.12;
    damage(e, s.dmg, t.def.dmgType, t, s);
    if (s.cull && !gone(e)) cull(t, s, e);
    if (s.stun && !gone(e)) rifleStun(s, e);
    // Hair Trigger: a kill readies the next round almost at once, up to quick.max times per full reload
    if (e.dead && s.quick && (t.quickN || 0) < s.quick.max) { t.quickN = (t.quickN || 0) + 1; t.cool = s.quick.delay; }
    else { t.quickN = 0; t.cool = 1 / s.rate; }
  }
  // Executioner: a share of what the foe has left (not counting what Stasis holds), as true damage. Bosses take
  // cull.boss, at most once per COMBO.bossCullGap from all rifles, and never the Deadline `late` growth.
  function cull(t, s, e) {
    if (bossy(e) && e.cullCd > 0) return;
    const share = bossy(e) ? s.cull.boss : s.cull.share * (1 + (s.cull.late || 0) * progress(e));
    const a = share * Math.max(0, e.hp - (e.stasisT > 0 ? e.bank : 0));
    if (bossy(e)) e.cullCd = C.COMBO.bossCullGap;
    if (a < 1) return;
    floatText(e.x + 12, e.y - 18, `−${Math.round(a)}`, C.ARCH.precision.color, 0.7);
    trueDamage(e, a, t);
  }
  // Spotter: a short stun on one foe, then COMBO.sniperStunGap before any rifle may stun it again
  function rifleStun(s, e) {
    if (e.noCtl || e.rifleCd > 0) return; // a Lamplighter's lantern (or a Governor) holds it off
    const dur = e.boss ? s.stun * C.COMBO.bossStun : s.stun;
    e.stunT = Math.max(e.stunT, dur);
    e.rifleCd = dur + C.COMBO.sniperStunGap;
    if (s.gridlock && !e.air) { e.gridT = dur; ring(e.x, e.y, 2, e.r * 2.4, C.ARCH.engineering.color, 0.4); }
    if (s.interrupt && !e.boss) interrupt(e);
  }
  // Spotter T2: the stun restarts this foe's ability clock (EMP, cloak, fuse, blink, time above ground)
  function interrupt(e) {
    const d = e.def;
    let hit = false;
    if (d.emp) { e.empT = d.emp.every; hit = true; }
    if (d.cloak) { e.cloakClock = 0; e.stealth = false; hit = true; }
    if (d.sap) { e.plantT = 0; e.sapTarget = null; e.sapCd = d.sap.every; hit = true; }
    if (d.blink) { e.blinkT = d.blink.every; hit = true; }
    if (d.thief) { e.thiefT = d.thief.every; e.thiefLock = 0; e.thiefTarget = null; hit = true; }
    if (d.surge) { e.surgeT = d.surge.every; e.surgeLeft = 0; hit = true; }
    if (d.burrow && !e.under) { e.burrowClock = 0; hit = true; }
    // a quiet ring, not a word: Spotter rifles interrupt often enough that text would clutter the road
    if (hit) ring(e.x, e.y, 2, e.r * 1.8, C.ARCH.engineering.color, 0.3);
  }

  // ---------- projectiles ----------
  function updateProjectile(p, dt) {
    if (p.target && !p.target.dead) { p.tx = p.target.x; p.ty = p.target.y; }
    const dd = dist(p.x, p.y, p.tx, p.ty);
    const step = p.speed * dt;
    if (dd <= step) { p.x = p.tx; p.y = p.ty; return impact(p) === true; }
    p.x += ((p.tx - p.x) / dd) * step;
    p.y += ((p.ty - p.y) / dd) * step;
    p.traveled += step;
    return true;
  }
  // A shell or rivet arriving. Returns true when the projectile flies on (a Ricochet bounce).
  function impact(p) {
    const s = p.s || {};
    if (p.kind === 'splash') {
      for (const e of state.enemies) {
        if (gone(e) || airborne(e) || !areaSees(p.src, e)) continue;
        if (dist(e.x, e.y, p.x, p.y) <= p.splash + e.r) {
          damage(e, p.dmg, p.type, p.src, s);
          if (p.shred) e.armor = Math.max(0, e.armor - p.shred);
          if (s.knockback && !e.dead) knockBack(e, s.knockback);
        }
      }
      if (s.quake) quake(p.x, p.y, s.quake, p.src);
      if (s.cluster) clusterBurst(p, s);
      ring(p.x, p.y, 2, p.splash, P.goldHi, 0.3);
      sfx(p.bomblet ? 'bomblet' : p.arc ? 'mortar' : p.shred ? 'shred' : 'cannon');
      burst(p.x, p.y, P.creamDim, p.bomblet ? 3 : 5);
    } else if (p.target && !p.target.dead) {
      const e = p.target;
      damage(e, p.dmg, p.type, p.src, s);
      if (s.flak && e.air) flakBurst(p, e, s);
      sparks(p.x, p.y, p.h1 || 0.45, Math.atan2(p.y - p.sy, p.x - p.sx) + Math.PI, 0.8, [P.emberHi, P.lantern, P.ember], p.style === 'rapid' ? 2 : p.style === 'spike' ? 6 : 3);
      if (s.bounce && p.hops < s.bounce.n) return ricochet(p, e, s);
    }
    return false;
  }
  // Concussion: shove a walker back along the road. Bosses budge a little; nobody is shoved twice in a row.
  function knockBack(e, tiles) {
    if (e.kbT > 0 || e.air || e.under) return;
    e.d = Math.max(0, e.d - tiles * T * (e.boss ? C.COMBO.knockbackBoss : 1));
    const q = posOn(e.poly, e.d); e.x = q.x; e.y = q.y;
    e.kbT = C.COMBO.knockbackCooldown;
    burst(e.x, e.y, P.roadLo, 4);
  }
  // Seismic: the ground around the impact slows every walker on it
  function quake(x, y, q, src) {
    const R = q.radius * T;
    for (const e of state.enemies) {
      if (gone(e) || airborne(e) || !areaSees(src, e) || dist(e.x, e.y, x, y) > R + e.r) continue;
      e.slowMul = e.slowT > 0 ? Math.min(e.slowMul, q.slow) : q.slow;
      e.slowT = Math.max(e.slowT, q.dur);
    }
    ring(x, y, 4, R, P.teal, 0.5);
    ring(x, y, 2, R * 0.6, P.roadHi, 0.4);
    if (src) src.flash = 0.15;
  }
  // the walkers' road nearest a point: which route, and the distance along it
  function roadDist(x, y) {
    let best = 0, bd = Infinity, on = path;
    for (const poly of routes) for (const sg of poly.segs) {
      const ux = (sg.b.x - sg.a.x) / sg.len, uy = (sg.b.y - sg.a.y) / sg.len;
      const al = clamp((x - sg.a.x) * ux + (y - sg.a.y) * uy, 0, sg.len);
      const dd = dist(x, y, sg.a.x + ux * al, sg.a.y + uy * al);
      if (dd < bd - 0.5) { bd = dd; best = sg.start + al; on = poly; }
    }
    return { poly: on, d: best, gap: bd };
  }
  // Cluster: the shell breaks into bomblets that hop to points along the road near the impact
  function clusterBurst(p, s) {
    const c = s.cluster, { poly, d: d0 } = roadDist(p.x, p.y);
    const mods = { pierce: s.pierce, ignoreArmor: s.ignoreArmor, bossMul: s.bossMul }; // bomblets carry damage modifiers only
    for (let i = 0; i < c.n; i++) {
      const at = posOn(poly, clamp(d0 + ((i + 0.5) / c.n * 2 - 1 + (Math.random() - 0.5) / c.n) * c.spread * T, 0, poly.len));
      state.projectiles.push({
        x: p.x, y: p.y, sx: p.x, sy: p.y, target: null, tx: at.x, ty: at.y, speed: p.speed, bomblet: true,
        dmg: c.dmg * (p.src.s ? p.src.s.dmgMul : 1), splash: c.splash * T, s: mods, hit: [], hops: 0,
        shred: 0, arc: false, kind: 'splash', src: p.src, type: p.type, traveled: 0,
        total: Math.max(1, dist(p.x, p.y, at.x, at.y)), ox: 0, oy: 0, h0: 0.2, h1: 0.1,
      });
    }
  }
  // Flak: a hit on a flyer bursts and hits every flyer around it; Skyscreen also slows them
  function flakBurst(p, e, s) {
    const R = s.flak * T;
    for (const o of state.enemies) {
      if (gone(o) || !o.air || !areaSees(p.src, o) || dist(o.x, o.y, e.x, e.y) > R + o.r) continue;
      if (o !== e) damage(o, p.dmg, p.type, p.src, s);
      if (s.airSlow && !o.dead) { o.slowMul = o.slowT > 0 ? Math.min(o.slowMul, s.airSlow.slow) : s.airSlow.slow; o.slowT = Math.max(o.slowT, s.airSlow.dur); }
    }
    ring(e.x, e.y, 2, R, s.airSlow ? P.ice : P.cream, 0.3);
    sparks(e.x, e.y, p.h1 || 0.8, 0, Math.PI, [P.cream, P.lantern, P.creamDim], 8);
  }
  // Ricochet: the rivet jumps on to the nearest enemy it has not hit, a little weaker each time
  function ricochet(p, e, s) {
    p.hit.push(e);
    const b = s.bounce, R = b.reach * T;
    let next = null, nd = Infinity;
    for (const o of state.enemies) {
      if (gone(o) || p.hit.includes(o) || (airborne(o) && !s.air) || !canSee(p.src, o)) continue;
      const dd = dist(e.x, e.y, o.x, o.y);
      if (dd <= R + o.r && dd < nd) { nd = dd; next = o; }
    }
    if (!next) return false;
    p.hops++; p.dmg *= b.falloff; p.target = next;
    p.sx = p.x; p.sy = p.y; p.tx = next.x; p.ty = next.y; p.traveled = 0; p.total = Math.max(1, nd);
    p.ox = 0; p.oy = 0; p.h0 = p.h1 || 0.45;
    return true;
  }

  // ---------- enemies ----------
  function updateEnemy(e, dt) {
    const d = e.def;
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    if (e.markT > 0) e.markT -= dt;
    if (e.spotT > 0) e.spotT -= dt;
    if (e.designT > 0) e.designT -= dt;   // Designate: every tower prefers it
    if (e.spotterT > 0) e.spotterT -= dt; // Forward Observer: towers reach it from farther
    if (e.burnT > 0) {
      e.burnT -= dt;
      damage(e, e.burnDps * dt, 'fire', e.burnSrc);
      if (e.dead) return;
      // Thermite: the burn eats armour while it lasts (bosses too)
      if (e.melt && e.armor > 0) {
        e.armor = Math.max(0, e.armor - e.melt * dt);
        if (e.armor === 0) floatText(e.x, e.y - 14, 'Melted', P.emberHi, 0.8);
      }
      if (Math.random() < dt * 9) {
        const h = aimHeight(e), life = 0.3 + Math.random() * 0.2;
        state.effects.push({ type: 'fire', x: e.x + (Math.random() - 0.5) * e.r, y: e.y + (Math.random() - 0.5) * e.r, h0: h * 0.7, h1: h * 1.4, ang: Math.random() * TAU, reach: 3, s: 0.45, rise: 0.25, life, max: life });
      }
    }
    if (e.chillT > 0) { e.chillT -= dt; if (e.chillT <= 0) e.brittle = 0; }
    if (e.vulnT > 0) e.vulnT -= dt;
    if (e.kbT > 0) e.kbT -= dt;
    if (e.downT > 0) e.downT -= dt;
    if (e.cullCd > 0) e.cullCd -= dt;   // Executioner's boss gate
    if (e.rifleCd > 0) e.rifleCd -= dt; // Spotter's stun gap
    if (e.gridT > 0) e.gridT -= dt;     // Gridlock: blocks the road while it lasts (and the stun holds)
    if (e.stopT > 0) e.stopT -= dt;     // Midnight: time stopped (the stun does the holding; this is the look)
    // Jammer (Tesla E4): ability clocks stand still and a cloak drops while the jam lasts
    const jam = jammed(e);
    if (e.jamT > 0) e.jamT -= dt;
    if (e.doomT > 0) { e.doomT -= dt; if (e.doomT <= 0) doomStrike(e); if (e.dead) return; }
    if (e.stasisT > 0) { e.stasisT -= dt; if (e.stasisT <= 0 || e.stunT <= 0 || e.noCtl) releaseStasis(e); if (e.dead) return; }
    if (d.cloak && jam) e.stealth = false;
    else if (d.cloak) {
      // visible for (every - dur) seconds, then invisible for dur seconds
      e.cloakClock += dt;
      const was = e.stealth;
      e.stealth = e.cloakClock % d.cloak.every > d.cloak.every - d.cloak.dur;
      if (e.stealth && !was) burst(e.x, e.y, P.cream, 5);
    }
    if (d.burrow) {
      // surfaced for `up` seconds, then underground for `down` seconds, out of reach of every tower
      e.burrowClock += dt;
      const was = e.under, cyc = d.burrow.up + d.burrow.down;
      e.under = e.burrowClock % cyc > d.burrow.up;
      if (e.under !== was) { burst(e.x, e.y, P.roadLo, 10); sfx('dig'); }
    }
    // a Lamplighter's lantern (or a Governor itself): no slow, freeze or stun takes hold
    if (e.noCtl) { e.slowT = 0; e.stunT = 0; }
    else if (e.gov) govCut(e);
    if (e.slowT > 0) e.slowT -= dt;
    // Skyhook cargo hangs under its hook; the hook sets it down (dropCargo)
    if (e.carried) { e.x = e.carried.x; e.y = e.carried.y; return; }
    if (e.fake) {
      e.fadeT -= dt;
      if (e.fadeT <= 0 || e.spotT > 0) { popHologram(e); return; }
    }
    if (d.mirage && !jam) {
      // the Mirage Caster projects copies of itself on the road around it
      e.mirageT -= dt;
      if (e.mirageT <= 0) {
        e.mirageT = d.mirage.every;
        const w = state.activeWaves.get(e.wave);
        for (let i = 0; i < d.mirage.n; i++) {
          if (w) w.left++;
          const off = (i % 2 ? -1 : 1) * (0.8 + 0.6 * Math.floor(i / 2)) * T;
          const g = spawn('hologram', e.wave, clamp(e.d + off, 0, e.poly.len - T), e.route);
          g.fake = true; g.hp = g.maxHp = e.maxHp * d.mirage.hp; g.armor = e.armor; g.mdef = e.mdef; g.fadeT = d.mirage.life;
          ring(g.x, g.y, 2, e.r * 2.4, P.ice, 0.4);
        }
        burst(e.x, e.y, P.ice, 10); sfx('blink');
      }
    }
    if (d.emp && !jam) {
      e.empT -= dt;
      if (e.empT <= 0) {
        e.empT = d.emp.every;
        const R = d.emp.radius * T;
        for (const t of state.towers) if (towerWithin(t, e.x, e.y, R)) disableTower(t, d.emp.dur, 'EMP');
        ring(e.x, e.y, 4, R, P.ember, 0.5);
        sfx('emp');
      }
    }
    if (d.thief && !jam) {
      // the Signal Thief locks on the most-upgraded tower in reach (a beam shows it), then cuts it off and its links
      const th = d.thief;
      if (e.thiefLock > 0) {
        const t = e.thiefTarget;
        if (!t || !state.towers.includes(t)) { e.thiefLock = 0; e.thiefTarget = null; }
        else if ((e.thiefLock -= dt) <= 0) {
          disableTower(t, th.down, 'Signal Thief');
          t.linkCutT = Math.max(t.linkCutT, th.down);
          ring(t.x, t.y, 2, T, P.ice, 0.5); burst(t.x, t.y, P.ice, 10);
          floatText(t.x, t.y - 10, 'Links cut', P.ice);
          sfx('emp');
        }
      } else if ((e.thiefT -= dt) <= 0) {
        const R = th.range * T;
        let best = null, bp = -1, bd = Infinity;
        for (const t of state.towers) {
          if (t.def.kind === 'barrier' || t.disabledT > 0 || !towerWithin(t, e.x, e.y, R)) continue;
          const p = t.pips.P + t.pips.B + t.pips.E, dd = dist(t.x, t.y, e.x, e.y);
          if (p > bp || (p === bp && dd < bd)) { best = t; bp = p; bd = dd; }
        }
        // the clock restarts at the lock, so a cut lands every `every` s; no tower in reach: look again next tick
        if (best) { e.thiefTarget = best; e.thiefLock = th.lock; e.thiefT = th.every - th.lock; sfx('sap'); }
      }
    }
    if (d.bomb && !jam) {
      // the Dirigible drops a bomb whenever it is over a tower
      e.bombT -= dt;
      if (e.bombT <= 0) {
        const R = d.bomb.radius * T, hit = state.towers.filter((t) => towerWithin(t, e.x, e.y, R) && t.def.kind !== 'barrier');
        if (hit.length) {
          e.bombT = d.bomb.every;
          for (const t of hit) disableTower(t, d.bomb.dur, 'Bombed');
          ring(e.x, e.y, 3, R, P.ember, 0.5); burst(e.x, e.y, P.ember, 12);
          sfx('bomb');
        }
      }
    }
    if (d.overload) {
      // the Power Colossus surges each time its hp falls past the next share in overload.at
      const sg = d.overload;
      if (e.overT > 0) e.overT -= dt;
      while (e.overN < sg.at.length && e.hp <= sg.at[e.overN] * e.maxHp) {
        e.overN++;
        if (jam) { ring(e.x, e.y, 2, T, P.cream, 0.4); burst(e.x, e.y, P.cream, 12); floatText(e.x, e.y, 'Surge fizzled', P.cream); continue; }
        const R = sg.radius * T;
        for (const t of state.towers) if (towerWithin(t, e.x, e.y, R)) disableTower(t, sg.dur, 'Surge');
        for (let i = 0; i < sg.n; i++) spawnChild(sg.type, e, 12 + i * 10);
        e.overT = sg.fast;
        ring(e.x, e.y, 6, R, P.ice, 0.7); burst(e.x, e.y, P.ice, 24);
        sfx('surge');
      }
    }
    if (d.spawner && !jam) {
      e.spawnT -= dt;
      if (e.spawnT <= 0) {
        e.spawnT = d.spawner.every;
        for (let i = 0; i < d.spawner.n; i++) spawnChild(d.spawner.type, e, 10 + i * 8);
        burst(e.x, e.y, P.lantern, 10);
        sfx('split');
      }
    }
    if (e.mend > 0 && e.hp < e.maxHp && e.stasisT <= 0) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * e.mend * (e.boss ? 0.33 : 1) * dt);
    // the Troop Balloon flies straight, not along the road: from `at` of its flight it drops its cargo as soon as
    // it is over a road (within `near` tiles), and by `last` wherever the nearest road is
    if (d.drop && !e.dropped && !jam && e.d >= e.poly.len * d.drop.at) {
      const { poly, d: at, gap } = roadDist(e.x, e.y);
      if (gap <= d.drop.near * T || e.d >= e.poly.len * d.drop.last) {
        e.dropped = true;
        // roadDist gives the nearest route and the distance along it; troops land on that route
        const w = state.activeWaves.get(e.wave), route = Math.max(0, routes.indexOf(poly)), h = aimHeight(e);
        for (let i = 0; i < d.drop.n; i++) {
          if (w) w.left++;
          const g = spawn(d.drop.type, e.wave, Math.max(0, at - i * 10), route);
          // a drop line from the balloon to each landing spot, so the troops visibly come from it
          state.effects.push({ type: 'rope', x0: e.x, y0: e.y, h0: h, x1: g.x, y1: g.y, life: 0.9, max: 0.9 });
          ring(g.x, g.y, 2, T * 0.6, P.cream, 0.6);
        }
        ring(e.x, e.y, 3, T * 1.2, P.cream, 0.5); burst(e.x, e.y, P.cream, 10);
        floatText(e.x, e.y - 18, `Dropped ${d.drop.n} ${EN[d.drop.type].name}s`, P.cream, 1.4);
        sfx('split');
      }
    }
    if (d.hook) {
      // the Skyhook grabs the biggest ground robot below it, carries it, and sets it down on a road
      const hk = d.hook;
      if (e.cargo) {
        e.carryT -= dt;
        if (e.cargo.dead) { e.cargo = null; e.hookCd = hk.cd; }
        else if (jam) dropCargo(e, true);
        else if (e.d >= e.poly.len * 0.92 || (e.carryT <= 0 && roadDist(e.x, e.y).gap <= hk.near * T)) dropCargo(e, false);
      } else if (!jam && (e.hookCd -= dt) <= 0 && e.d < e.poly.len * 0.8) {
        let best = null;
        for (const o of state.enemies) {
          if (gone(o) || o.air || o.boss || o.carried || o.fake || o.stasisT > 0 || dist(o.x, o.y, e.x, e.y) > hk.near * T) continue;
          if (!best || o.hp > best.hp) best = o;
        }
        if (best) {
          e.cargo = best; best.carried = e; best.air = true; e.carryT = hk.carry;
          state.effects.push({ type: 'rope', x0: e.x, y0: e.y, h0: aimHeight(e), x1: best.x, y1: best.y, life: 0.5, max: 0.5 });
          floatText(e.x, e.y - 18, `Airlifted ${best.def.name}`, P.cream, 1.2);
          sfx('blink');
        }
      }
    }
    if (e.stunT > 0) { e.stunT -= dt; return; }
    if (d.sap && !e.under && !jam) {
      // the Sapper stops beside a tower, lights a fuse and knocks it out
      if (e.plantT > 0) {
        e.plantT -= dt;
        const t = e.sapTarget;
        if (!t || !state.towers.includes(t)) { e.plantT = 0; e.sapTarget = null; }
        else if (e.plantT <= 0) {
          disableTower(t, d.sap.dur, 'Sabotaged');
          ring(t.x, t.y, 2, T, P.ember, 0.5); burst(t.x, t.y, P.ember, 10);
          sfx('bomb');
          e.sapTarget = null; e.sapCd = d.sap.every;
        }
        return;
      }
      e.sapCd -= dt;
      if (e.sapCd <= 0) {
        const R = d.sap.range * T;
        let best = null, bd = Infinity;
        for (const t of state.towers) {
          if (t.def.kind === 'barrier' || t.disabledT > 0 || !towerWithin(t, e.x, e.y, R)) continue;
          const dd = dist(t.x, t.y, e.x, e.y);
          if (dd < bd) { bd = dd; best = t; }
        }
        if (best) { e.sapTarget = best; e.plantT = d.sap.plant; sfx('sap'); return; }
      }
    }
    if (d.blink && !jam) {
      e.blinkT -= dt;
      if (e.blinkT <= 0) {
        e.blinkT = d.blink.every;
        const from = { x: e.x, y: e.y };
        e.d = Math.min(e.poly.len - T, barrierStop(e, e.d + d.blink.dist * T, true));
        const p = posOn(e.poly, e.d); e.x = p.x; e.y = p.y;
        ring(from.x, from.y, 8, 2, P.ice, 0.3); ring(e.x, e.y, 2, 12, P.ice, 0.35);
        sfx('blink');
      }
    }
    if (d.surge && !jam) {
      e.surgeT -= dt;
      if (e.surgeT <= 0) { e.surgeT = d.surge.every; e.surgeLeft = d.surge.dur; ring(e.x, e.y, 2, e.r * 2.4, P.emberHi, 0.35); sfx('blink'); }
    }
    let mul = e.slowT > 0 ? e.slowMul : 1;
    mul *= 1 + e.haste;
    if (e.surgeLeft > 0) { e.surgeLeft -= dt; mul *= d.surge.mul; }
    if (e.overT > 0) mul *= 1 + d.overload.speed;
    if (e.under) mul *= d.burrow.speed;
    const want = e.d + d.speed * e.pace * T * mul * dt;
    e.blocked = null;
    e.d = barrierStop(e, want);
    if (e.blocked) {
      // hammering on a barricade: threat × √(wave hp multiplier) per second
      const b = e.blocked, blow = (d.atk || d.threat || 8) * Math.sqrt(hpMul(e.wave)) * dt * (e.boss ? 6 : 1);
      hurtBarricade(b, blow);
      answerBlow(e, b, blow, dt);
      if (e.dead) return;
    }
    if (e.d >= e.poly.len) {
      if (e.fake) { popHologram(e); return; }
      if (e.cargo) dropCargo(e, false);
      e.dead = true;
      state.lives = Math.max(0, state.lives - d.lives);
      for (const gt of gates) if (gt.exit) gt.flash = 1;
      state.leaked++;
      floatText(e.x - 20, e.y, `−${d.lives} power`, P.ember);
      sfx('leak');
      if (state.lives <= 0) beginBlackout(); // before the wave check, so losing the last life on the last wave is a loss
      waveUnitGone(e.wave);
      return;
    }
    const p = posOn(e.poly, e.d);
    e.x = p.x; e.y = p.y;
  }

  // How far along the road a walker may get before a barricade stops it. Flyers and burrowers pass;
  // a Tram Juggernaut rams each barricade once, smashing into it, and keeps going.
  // Gridlock blockers stop walkers behind them too (bosses and Trams push through; a Courier blinks past).
  function barrierStop(e, want, blink = false) {
    if (e.air || e.under || e.poly !== routes[e.route]) return want;
    let to = want;
    if (!blink && !e.boss && !e.def.ram) for (const b of state.gridlock || []) {
      const stop = b.d - T * 0.5;
      if (b === e || b.poly !== e.poly || e.d > stop + 0.5 || want <= stop) continue;
      if (stop < to) to = Math.max(e.d, stop);
    }
    for (const b of state.towers) {
      if (b.def.kind !== 'barrier' || b.downT > 0 || b.pd[e.route] === null) continue;
      const stop = b.pd[e.route] - T * 0.55;
      if (e.d > stop + 0.5 || want <= stop) continue;
      if (e.def.ram) {
        e.rammed = e.rammed || new Set();
        if (!e.rammed.has(b.id)) {
          e.rammed.add(b.id);
          ring(b.x, b.y, 2, T, P.goldHi, 0.4); sfx('crash');
          // a smash: a second, wider dust ring, a fan of sparks thrown on along the road and stone chips; the model's ram thrusts (e.ramAt)
          e.ramAt = state.time;
          ring(b.x, b.y, 4, T * 1.8, '#c9c2dd', 0.55);
          sparks(b.x, b.y, 0.5, Math.atan2(b.y - e.y, b.x - e.x), 1.0, [P.goldHi, '#ffb347', '#c9c2dd'], 16);
          burst(b.x, b.y, '#8a849c', 10);
          hurtBarricade(b, e.def.ram * Math.sqrt(hpMul(e.wave)));
        }
        continue;
      }
      if (stop < to) { to = Math.max(e.d, stop); e.blocked = b; }
    }
    return to;
  }

  // Governor aura: what this step's towers just applied to a robot near one is cut by `gov`. A stun lasts (1 - gov) as
  // long; a slow is (1 - gov) as strong (a 40% slow becomes 20%), its duration unchanged. Compared against the values
  // kept before the towers ran, so every source (all kinds of slow and stun, magnetise, Clock, rifle) is covered in one place
  // and what a robot already carried when it walked in is left alone.
  function govCut(e) {
    if (e.stunT > e.stunPre) e.stunT = Math.max(e.stunPre, e.stunT * (1 - e.gov));
    if (e.slowT > 0 && (e.slowT > e.slowPre || e.slowMul < e.slowMulPre)) {
      const mul = 1 - (1 - e.slowMul) * (1 - e.gov);
      e.slowMul = e.slowPre > 0 ? Math.min(e.slowMulPre, mul) : mul;
    }
  }

  // Auras between robots, worked out fresh every step: Shield Bearers, Spotter Drones, Lamplighters, Governors, Field Menders and Baffle Drones;
  // then the Static Warden's damping of nearby towers.
  // The Governor: `gov` is the share of slow and stun cut on robots near it. `noCtl` (no slow, stun or drag at all) is the
  // Lamplighter's lantern or an unjammed Governor itself; it wins over `gov`. The pre-step stun and slow are kept so
  // updateEnemy can tell what this step's towers applied (see govCut).
  function updateAuras() {
    // a Jammer-hit robot's aura is off while the jam lasts
    const src = state.enemies.filter((e) => !e.dead && !e.under && !jammed(e) && (e.def.aegis || e.def.haste || e.def.lamp || e.def.mend || e.def.baffle || e.def.governor));
    for (const e of state.enemies) {
      e.aegis = 0; e.haste = 0; e.lit = false; e.mend = 0; e.baffle = 0; e.gov = 0;
      e.stunPre = e.stunT; e.slowPre = e.slowT; e.slowMulPre = e.slowMul;
      for (const a of src) {
        const d = a.def, dd = dist(a.x, a.y, e.x, e.y);
        if (d.aegis && !e.def.aegis && dd <= d.aegis.radius * T) e.aegis = Math.max(e.aegis, d.aegis.cut);
        // ground robots only (a flyer shot down to the ground by Iced Wings counts as ground)
        if (d.baffle && !airborne(e) && dd <= d.baffle.range * T && d.baffle.cut > e.baffle) { e.baffle = d.baffle.cut; e.baffleMin = d.baffle.minDist; }
        if (d.haste && a !== e && dd <= d.haste.radius * T) e.haste = Math.max(e.haste, d.haste.speed);
        if (d.lamp && dd <= d.lamp.radius * T) e.lit = true;
        if (d.governor && a !== e && dd <= d.governor.radius * T) e.gov = Math.max(e.gov, d.governor.cut);
        if (d.mend && !e.def.mend && dd <= d.mend.radius * T) e.mend = Math.max(e.mend, d.mend.rate);
      }
      e.noCtl = e.lit || (!!e.def.governor && !jammed(e));
    }
    // Static Warden: towers within its range get t.warded (< 1) for this step only, so it clears the moment the
    // robot dies, burrows or is jammed. updateTower reads it.
    const wardens = state.enemies.filter((e) => e.def.warden && !gone(e) && !jammed(e));
    for (const t of state.towers) {
      t.warded = 1;
      for (const w of wardens) if (towerWithin(t, w.x, w.y, w.def.warden.range * T)) t.warded = Math.min(t.warded, w.def.warden.rate);
    }
  }

  // A Searchlight's beam reveals a foe for every tower. (Spike Driver and Relay neighbours see stealth themselves.)
  function updateReveal() {
    for (const e of state.enemies) if (e.stealth) e.revealed = e.spotT > 0;
  }


  // ---------- Pinwheel ----------
  // The eight tiles round a 1×1 tower, east first and clockwise on screen: port i faces angle i·45°.
  const NB8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  // Which sides touch road. Only those ports open: a side that faces a neighbouring tower or bare paving stays
  // shut, so nails never seem to leave through a wall (and the model shows where the stone can bite).
  function cornerPorts(t) {
    const cx = Math.floor(t.x / T), cy = Math.floor(t.y / T);
    return NB8.map(([dx, dy]) => inBounds(cx + dx, cy + dy) && grid[cy + dy][cx + dx] === 'path');
  }
  const portOf = (t, x, y) => ((Math.round(Math.atan2(y - t.y, x - t.x) / (Math.PI / 4)) % 8) + 8) % 8;
  // One volley: every ground robot in the ring takes the hit, nails flying out of the port that faces it.
  function volley(t, s) {
    const hit = state.enemies.filter((e) => !gone(e) && (!airborne(e) || s.air) && canSee(t, e) && dist(e.x, e.y, t.x, t.y) <= s.range * T + e.r);
    if (!hit.length) return;
    t.ports = cornerPorts(t);
    t.hot = t.hot || [0, 0, 0, 0, 0, 0, 0, 0];
    t.volleys = (t.volleys || 0) + 1;
    // Fusillade: every Nth volley is a triple load
    const big = s.salvo && t.volleys % s.salvo.every === 0, mul = big ? s.salvo.mul : 1;
    const h0 = baseY(t) + 0.34;
    for (const e of hit) {
      const i = portOf(t, e.x, e.y), a = (i * Math.PI) / 4, cm = clinchMul(e, s.clinch);
      t.hot[i] = 0.3;
      if (hit.length < 7) for (let n = 0; n < (big ? 3 : 2); n++) {
        const sp = (Math.random() - 0.5) * 7;
        state.effects.push({ type: 'nail', x0: t.x + Math.cos(a) * 0.36 * T, y0: t.y + Math.sin(a) * 0.36 * T, h0, x1: e.x + sp, y1: e.y + sp, h1: 0.3 + Math.random() * 0.15, big, n: e.clinchN || 0, life: 0.16, max: 0.16 });
      }
      damage(e, s.dmg * mul * cm, 'physical', t, s);
    }
    // Pinned: the toughest survivor is nailed to the road
    if (s.pin) {
      const top = hit.filter((e) => !e.dead).sort((a, b) => b.hp - a.hp)[0];
      if (top) { top.stunT = Math.max(top.stunT, top.boss ? s.pin * C.COMBO.bossStun : s.pin); ring(top.x, top.y, 2, top.r * 2.2, P.goldHi, 0.3); }
    }
    sfx('nails');
    t.cool = 1 / s.rate; t.flash = 0.12;
  }
  // Clinch: each condition another tower has put on the robot adds its share, and having all three multiplies the lot.
  // Returns the damage multiplier; n (0-3) tints the nails.
  function clinchMul(e, c) {
    if (!c) return 1;
    let m = 1, n = 0;
    for (const [on, add] of [[e.slowT > 0, c.slow], [e.burnT > 0, c.burn], [e.stunT > 0, c.stun]]) if (on && add) { m += add; n++; }
    e.clinchN = n;
    return n === 3 && c.all ? m * c.all : m;
  }

  // ---------- effects ----------
  function ring(x, y, r0, r1, color, life) { state.effects.push({ type: 'ring', x, y, r0, r1, color, life, max: life }); }
  // h0: the height the bolt starts at; by default the tower's lamp
  // big: a Thunderstroke, drawn thicker
  function lightning(pts, t, h0, big = false) {
    const m = towerMeshes.get(t.id), L = m && m.userData.light;
    // a bolt from the tower's own lamp leaves from over it, which need not be the footprint's centre (Tesla's coil)
    if (h0 === undefined && L && L.ox !== undefined) pts = [{ x: pts[0].x + L.ox * T, y: pts[0].y + L.oy * T }, ...pts.slice(1)];
    const jag = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      jag.push(a);
      for (let k = 1; k < 4; k++) {
        const f = k / 4;
        jag.push({ x: a.x + (b.x - a.x) * f + (Math.random() - 0.5) * 10, y: a.y + (b.y - a.y) * f + (Math.random() - 0.5) * 10 });
      }
    }
    jag.push(pts[pts.length - 1]);
    state.effects.push({ type: 'bolt', pts: jag, big, h0: h0 ?? baseY(t) + (L ? L.h : 1.9), life: big ? 0.3 : 0.18, max: big ? 0.3 : 0.18 });
  }
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 70;
      state.effects.push({ type: 'px', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, color, life: 0.4 + Math.random() * 0.3, max: 0.7, size: 2 });
    }
  }
  // Flame puffs leave the nozzle, slow down as they spread through the cone and dip to robot height, then
  // cool from white-hot through amber to ember and leave a wisp of smoke as they rise.
  function flameParticles(t, s) {
    const f = dirAngle(t.dir), h = (s.cone * Math.PI) / 180, mz = muzzlePt(t), big = towerLook(t).form === 'B' ? 1.25 : 1;
    for (let i = 0; i < 8; i++) {
      // bunched toward the middle of the cone, so the jet has a hot core and ragged edges
      const a = f + (Math.random() + Math.random() - 1) * h * 0.95;
      const life = 0.38 + Math.random() * 0.2;
      state.effects.push({
        type: 'fire', x: mz.x, y: mz.y, h0: mz.h, h1: 0.45 + Math.random() * 0.15, ang: a,
        reach: s.range * T * (0.35 + Math.random() * 0.7), s: big * (0.8 + Math.random() * 0.4), rise: 0.35, life, max: life,
      });
    }
  }
  // The Rivet Gun blows off a little steam from the vents either side of its boiler with every shot.
  function ventSteam(t) {
    const m = towerMeshes.get(t.id), v = m && m.userData.muzzle && m.userData.muzzle.vent;
    if (!v) return;
    const br = towerLook(t).form, c = Math.cos(t.aim), sn = Math.sin(t.aim), big = br === 'A' ? 1.4 : br === 'B' ? 0.7 : 1;
    // a few puffs per vent, blown out sideways and back at different speeds, so each shot leaves a little cloud
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      const life = 0.9 + Math.random() * 0.5, sp = (0.6 + Math.random() * 0.8) * 45;
      const ox = -c * 0.5 - sn * side + (Math.random() - 0.5) * 0.4, oy = -sn * 0.5 + c * side + (Math.random() - 0.5) * 0.4;
      state.effects.push({
        type: 'puff', x: t.x + (c * v.x - sn * v.z * side) * T, y: t.y + (sn * v.x + c * v.z * side) * T, h: baseY(t) + v.h,
        vx: ox * sp, vy: oy * sp, vh: 0.45 + Math.random() * 0.35, s: big * (0.8 + Math.random() * 0.5), life, max: life,
      });
    }
  }
  // A small fan of sparks thrown out along angle a (spread in radians either side).
  function sparks(x, y, h, a, spread, colors, n) {
    for (let i = 0; i < n; i++) {
      const b = a + (Math.random() * 2 - 1) * spread, v = 40 + Math.random() * 90, life = 0.25 + Math.random() * 0.25;
      state.effects.push({ type: 'spark', x, y, h, vx: Math.cos(b) * v, vy: Math.sin(b) * v, vh: 0.6 + Math.random() * 1.4, color: colors[i % colors.length], life, max: life });
    }
  }
  function floatText(x, y, txt, color, life = 1.2) { state.effects.push({ type: 'text', x, y, txt, color, life, max: life }); }

  const FX_MAX = 1500, FX_SHED = new Set(['px', 'puff', 'spark', 'fire']); // particles only: rings, bolts and text stay
  function updateEffects(dt) {
    for (const f of state.effects) {
      f.life -= dt;
      if (f.type === 'px') {
        f.x += f.vx * dt; f.y += f.vy * dt;
        f.vx *= 0.9; f.vy *= 0.9;
      } else if (f.type === 'puff') {
        f.x += f.vx * dt; f.y += f.vy * dt; f.h += f.vh * dt;
        f.vx *= 0.9; f.vy *= 0.9;
      } else if (f.type === 'spark') {
        f.x += f.vx * dt; f.y += f.vy * dt; f.h = Math.max(0.02, f.h + f.vh * dt);
        f.vh -= 5 * dt; f.vx *= 0.92; f.vy *= 0.92;
      }
      if (f.type === 'text') f.y -= 18 * dt;
    }
    state.effects = state.effects.filter((f) => f.life > 0);
    // a crowd of burning, shot-at robots can spawn thousands of particles; shed the oldest ones past the cap
    let extra = state.effects.length - FX_MAX;
    if (extra > 0) state.effects = state.effects.filter((f) => !(extra > 0 && FX_SHED.has(f.type) && extra--));
  }

  // ---------- main update ----------
  function step(dt) {
    state.time += dt;
    // Auto-start: once the field is clear, send the next wave after a short breather.
    if (ui.auto && state.wave > 0 && state.activeWaves.size === 0 && !state.spawnQueue.length && canSendWave()) {
      state.autoT = (state.autoT || 0) + dt;
      if (state.autoT >= C.AUTO_WAVE_DELAY) { state.autoT = 0; sendWave(); }
    } else state.autoT = 0;
    while (state.spawnQueue.length && state.spawnQueue[0].at <= state.time) {
      const q = state.spawnQueue.shift();
      spawn(q.type, q.wave, 0, q.route, q.hpx);
    }
    updateAuras();
    updateReveal();
    // Gridlock: rifle-stunned walkers that block the road behind them this step
    state.gridlock = state.enemies.filter((e) => e.gridT > 0 && e.stunT > 0 && !gone(e) && !e.air && e.poly === routes[e.route]);
    for (const t of [...state.towers]) updateTower(t, dt);
    // impacts can spawn projectiles (Cluster bomblets); they land in the fresh list and fly from the next step
    const flying = state.projectiles;
    state.projectiles = [];
    state.projectiles = flying.filter((p) => updateProjectile(p, dt)).concat(state.projectiles);
    updateMines(dt);
    updateStrips(dt);
    updatePools(dt);
    updateSpread(dt);
    for (const e of [...state.enemies]) if (!e.dead) updateEnemy(e, dt);
    if (state.wrecks.length) updateWrecks(dt);
    state.enemies = state.enemies.filter((e) => !e.dead);
    updateEffects(dt);
    if (state.saveDue) { state.saveDue = false; saveRun(); }
  }

  // Final loss: the sim stops at once, but the defeat overlay waits for a short blackout beat in which the
  // playfield's own lights go out. A new game (or anything that replaces `state`) simply drops the pending beat.
  const BLACKOUT_LEN = 2.1, BLACKOUT_HOLD = 2.5; // fade, then the dark city alone before the overlay
  let blackK = 0;
  function applyBlackout(k) {
    if (k === blackK && k === 0) return;
    blackK = k;
    const now = reduceMotion ? 0 : performance.now() / 1000;
    const r = MODELS.setBlackout(k, lightRig, now);
    const amb = r.amb, dim = 0.04 + 0.96 * amb;
    if (deckMat) deckMat.emissiveIntensity = 0.8 * dim;
    if (groundMesh) groundMesh.material.emissiveIntensity = 0.55 * dim;
    fx.style.opacity = String(Math.max(0, 1 - 0.9 * k));
    gl.toneMappingExposure = 1.1 * (0.3 + 0.7 * amb);
  }
  function beginBlackout() {
    if (state.over) return;
    state.over = true; state.won = false; state.blackout = { t: 0 };
    dropSave(); // a lost run cannot be continued, even by closing the page during the blackout
    sfx('lose');
  }
  function tickBlackout(dt) {
    const b = state.blackout;
    if (!b) return;
    b.t += dt;
    applyBlackout(clamp(b.t / BLACKOUT_LEN, 0, 1));
    if (b.t >= BLACKOUT_LEN + BLACKOUT_HOLD) { state.blackout = null; state.over = false; endGame(false); }
  }
  function endGame(won) {
    if (state.over) return;
    state.over = true; state.won = won;
    if (won) sfx('win');
    recordRun(won ? 'won' : 'lost');
    const ov = $('overlay');
    const lv = state.level, li = state.levelIdx;
    if (won && lv) beatLevel(li, state.master);
    const more = !state.master && !!lv && li + 1 < C.CAMPAIGN.length && !C.CAMPAIGN[li + 1].soon;
    // winning the last level offers to carry the same game on into Endless
    const carryOn = won && !!lv && !state.master && li === C.CAMPAIGN.length - 1;
    $('ovEyebrow').textContent = won ? (state.master ? 'Master mode cleared' : lv && !carryOn ? `Level ${li + 1} cleared` : 'Campaign complete') : 'The city went dark';
    $('ovTitle').textContent = won ? `${mapDef.name.split(' ')[0]} stays lit` : `Blackout on wave ${state.wave}`;
    $('ovBody').innerHTML = `<p>${state.kills} enemies defeated, ${state.leaked} reached the Exchange, ${state.towers.length} towers standing.</p>
      <p>${won ? (state.master ? 'One life, and the Power Station never flickered.' : more ? `Level ${li + 2} is open.` : carryOn ? `Do you want to continue in Endless mode? Your towers, gold and power carry on from wave ${state.wave + 1}, robots the campaign never sent join in, and the waves never stop.` : endlessOpen() ? 'Try Endless to see how far the build goes.' : 'Clear every level to unlock Endless.') : 'Different terrain and neighbours change everything. Try again.'}</p>`;
    const parked = carryOn && loadSave();
    if (parked) $('ovBody').innerHTML += `<p>Continuing replaces your saved Endless run (${parked.map}, wave ${parked.wave}).</p>`;
    $('ovMenu').textContent = lv ? 'Campaign map' : 'Main menu';
    $('ovStart').textContent = won && more ? 'Next level' : carryOn ? 'Continue in Endless' : 'Play again';
    nextStart = won && more ? ['normal', null, li + 1] : carryOn ? 'carry' : lastStart;
    ov.hidden = false;
    $('ovStart').focus({ preventScroll: true });
  }

  // ---------- the scene ----------
  // the road decal (see paintDecal): canvas, plane and its pixels per tile
  const decalCanvas = document.createElement('canvas'), decalCtx = decalCanvas.getContext('2d');
  let decalMesh = null, decalTex = null, DK = 32;
  let groundMesh = null, outerGround = null, groundTex = null, alphaTex = null, deckMat = null, cityGroup = null, blockGroup = null, gateGroup = null;
  let gates = [], gateChimneys = [], poolsOnMap = [];
  let cityPower = [];   // the outer city's districts, in the order they black out
  const towerMeshes = new Map(), enemyMeshes = new Map();
  let ghostMesh = null, ghostKey = '';
  const HILL_H = 0.22;
  const baseY = (t) => (terrainShare(t.cells, 'hill') > 0.49 ? HILL_H : 0);
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const UI_FONT = '"Jost", "Futura", "Century Gothic", sans-serif';
  function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  const dirAngle = (dir) => Math.atan2(DIRS[dir][1], DIRS[dir][0]);
  // Where a tower's shots leave it, on the map (x, y in pixels) and in height (tiles). Directional towers point
  // along their facing, turrets along their aim. Falls back to the top of the tower before its model exists.
  function muzzlePt(t) {
    const m = towerMeshes.get(t.id), mz = m && m.userData.muzzle;
    if (!mz) return { x: t.x, y: t.y, h: baseY(t) + 1 };
    const a = t.def.directional ? dirAngle(t.dir) : t.aim;
    return { x: t.x + Math.cos(a) * mz.r * T, y: t.y + Math.sin(a) * mz.r * T, h: baseY(t) + mz.h };
  }
  // the height to aim at on a robot: its chest
  function aimHeight(e) {
    const m = enemyMeshes.get(e.id);
    return m ? m.userData.h * 0.55 - (m.userData.low || 0) : 0.45;
  }

  // Called whenever the map is (re)built: polished ground, the city around the map, the gates.
  function buildScene() {
    occVer++;
    for (const g of [groundMesh, outerGround]) if (g) { scene.remove(g); g.geometry.dispose(); g.material.dispose(); }
    if (cityGroup) for (const dc of cityGroup.userData.districts || []) dc.dispose();
    for (const g of [cityGroup, gateGroup]) if (g) { world.remove(g); MODELS.disposeGroup(g); }
    for (const gt of gates) if (gt.core) gt.core.dispose();   // each gate building owns a cloned material
    for (const m of towerMeshes.values()) world.remove(m);
    for (const m of enemyMeshes.values()) world.remove(m);
    towerMeshes.clear(); enemyMeshes.clear();
    if (groundTex) { groundTex.dispose(); alphaTex.dispose(); }
    groundTex = new THREE.CanvasTexture(terrainCanvas);
    groundTex.encoding = THREE.sRGBEncoding; groundTex.anisotropy = gl.capabilities.getMaxAnisotropy();
    alphaTex = new THREE.CanvasTexture(alphaCanvas);
    if (deckMat) deckMat.dispose();
    deckMat = M3.std({ map: groundTex, emissiveMap: groundTex, emissive: 0xffffff, emissiveIntensity: 0.8, metalness: 0.25, roughness: 0.3, envMapIntensity: 0.6 });
    // The ground is partly see-through: what shows through it is the city drawn upside down, its reflection.
    groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(COLS + 2 * APRON, ROWS + 2 * APRON), M3.std({ map: groundTex, emissiveMap: groundTex, emissive: 0xffffff, emissiveIntensity: 0.55, alphaMap: alphaTex, transparent: true, metalness: 0.1, roughness: 0.25, envMapIntensity: 0.4 }));
    groundMesh.rotation.x = -Math.PI / 2; groundMesh.position.set(COLS / 2, 0, ROWS / 2); groundMesh.renderOrder = -1;
    outerGround = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), M3.std({ color: 0x060a18, transparent: true, opacity: 0.8, metalness: 0.3, roughness: 0.22, envMapIntensity: 0.4 }));
    outerGround.rotation.x = -Math.PI / 2; outerGround.position.set(COLS / 2, -0.02, ROWS / 2); outerGround.renderOrder = -2;
    scene.add(outerGround, groundMesh);
    buildDecal();
    const F = FIELD_LIGHT, rig = lightRig.find((l) => l.light === moonPool);
    moonPool.color.setHex(F.color); moonPool.intensity = rig.base = F.power;
    moonPool.position.set(COLS / 2, F.height, ROWS / 2); moonPool.target.position.set(COLS / 2, 0, ROWS / 2);
    moonPool.angle = Math.atan((Math.hypot(COLS, ROWS) / 2) * F.reach / F.height);
    // the gates stand in notches in the city's first row of buildings
    const clear = [], pts = path.pts;
    // [where the gate stands, the point beyond it, exit?]: one factory per route, one exchange at the exit
    const gatePts = [...routes.map((r) => [r.pts[1], r.pts[0], false]), [pts[pts.length - 2], pts[pts.length - 3], true]];
    for (const [at, from, exit] of gatePts) {
      const ang = Math.atan2(at.y - from.y, at.x - from.x), k = exit ? 0.5 : -0.5;
      const ex = (at.x + Math.cos(ang) * k * T) / T, ez = (at.y + Math.sin(ang) * k * T) / T;
      const ux = Math.round(Math.cos(ang)) * (exit ? 1 : -1), uz = Math.round(Math.sin(ang)) * (exit ? 1 : -1);
      const ax = ex + ux * 5.4, az = ez + uz * 5.4, px = Math.abs(uz) * 2.9, pz = Math.abs(ux) * 2.9;
      clear.push({ x0: Math.min(ex, ax) - px, x1: Math.max(ex, ax) + px, z0: Math.min(ez, az) - pz, z1: Math.max(ez, az) + pz });
    }
    cityGroup = MODELS.outerCity(COLS, ROWS, rng(1931), { front: FRONT, clear });
    // Districts black out in a fixed, scattered order, so each loss puts out a different part of the skyline.
    const order = cityGroup.userData.districts.map((dc, i) => ({ dc, k: rng(i * 7919 + 3)() })).sort((a, b) => a.k - b.k);
    cityPower = order.map(({ dc }) => ({ dc, on: true, t0: -1e9, p: 1 }));
    gateGroup = new THREE.Group(); gates = [];
    for (const [at, from, exit] of gatePts) {
      const g = exit ? MODELS.exchange() : MODELS.factory(), ang = Math.atan2(at.y - from.y, at.x - from.x), k = exit ? 0.5 : -0.5;
      const gx = at.x + Math.cos(ang) * k * T, gy = at.y + Math.sin(ang) * k * T;
      g.position.set(gx / T, 0, gy / T); g.rotation.y = -ang;
      gateGroup.add(g);
      gates.push({ x: gx, y: gy, ang, exit, flash: 0, ...g.userData });
    }
    // factory stacks breathe steam too (kept apart from the rooftop list, which rebuildBlocks replaces)
    gateChimneys = [];
    for (const g of gates) if (g.stacks) for (const [lx, ly, lz] of g.stacks) {
      const cs = Math.cos(g.ang), sn = Math.sin(g.ang);
      gateChimneys.push({ x: g.x + cs * lx * T - sn * lz * T, y: g.y + sn * lx * T + cs * lz * T, h: ly });
    }
    world.add(cityGroup, gateGroup);
    rebuildBlocks();
  }
  // Tenements, monoliths and terraces standing on the map.
  function rebuildBlocks() {
    if (blockGroup) { world.remove(blockGroup); MODELS.disposeGroup(blockGroup); }
    const b = MODELS.blocks(grid, COLS, ROWS, rng, { deck: deckMat, apron: APRON });
    blockGroup = b.group;
    const glows = b.glows.concat(cityGroup ? cityGroup.userData.glows : []);
    paintGlows(glows); pickNeon(glows); groundTex.needsUpdate = true;
    chimneys = b.chimneys.map((c) => ({ x: c.x * T, y: c.y * T, h: c.h }));
    poolsOnMap = b.pools;
    world.add(blockGroup);
  }

  // Keep one model per tower and per robot, and pose them for this frame. Returns the placement preview, if any.
  function syncScene() {
    const time = state.time, seen = new Set();
    const running = state.activeWaves.size > 0 || state.spawnQueue.length > 0;
    // The city's power. Every life lost drains it; each 1/N of it lost puts out one district of the skyline,
    // which flickers and goes dark. A new game sweeps the lights back on.
    const power = Math.max(0, state.lives) / maxLives(), nowS = performance.now() / 1000;
    const nDark = Math.min(cityPower.length, Math.floor((1 - power) * cityPower.length + 1e-6));
    cityPower.forEach((c, k) => {
      const on = k >= nDark;
      if (on !== c.on) { c.on = on; c.t0 = nowS; }
      const t = nowS - c.t0;
      const p = on ? Math.min(1, t / 1.2) : t < 0.8 ? (Math.sin(t * 47) > 0.2 ? 0.85 : 0.1) * (1 - t / 0.8) : 0;
      if (Math.abs(p - c.p) > 1e-3) { c.p = p; c.dc.setPower(p); }
    });
    for (const gt of gates) {
      if (gt.spin) for (const s of gt.spin) s.rotation.x = time * 0.5;
      if (!gt.core) continue;
      if (gt.exit) {
        // the Power Exchange: brightness and the gauge follow the city's charge; a leak surges it for a moment
        // in the final blackout the gauge is the last light to die: it holds until the very end, then gutters out
        const gaugeK = blackK > 0 ? Math.max(0, 1 - Math.max(0, (blackK - 0.75) / 0.25)) * (blackK > 0.9 && Math.sin(nowS * 30) > 0.3 ? 0.3 : 1) : 1;
        gt.core.emissiveIntensity = (0.12 + 1.1 * power ** 1.5) * (1 + 1.5 * gt.flash) * gaugeK;
        const lit = Math.ceil(power * gt.bars.length - 1e-6);
        gt.bars.forEach((pair, k) => {
          const m = k < lit && !(k === lit - 1 && gt.flash > 0 && Math.sin(nowS * 60) > 0) ? gt.core : M3.navy;
          for (const b of pair) b.material = m;
        });
        gt.flash = Math.max(0, gt.flash - 0.03);
      } else gt.core.emissiveIntensity = running ? 0.8 + 0.2 * Math.sin(time * 4) : 0.8;
    }
    for (const t of state.towers) {
      const look = towerLook(t), acc = towerAccent(t), key = `${look.step}:${look.form}:${acc ? acc.arch + acc.big : ''}`;
      let m = towerMeshes.get(t.id);
      if (!m || m.userData.key !== key) {
        if (m) world.remove(m);
        occVer++;
        m = MODELS.tower(t.key, look.form, look.step, t.cells.map(([cx, cy]) => [cx + 0.5 - t.x / T, cy + 0.5 - t.y / T]), t.dir, acc);
        m.userData.key = key; m.userData.tower = t;
        m.position.set(t.x / T, baseY(t), t.y / T);
        world.add(m); towerMeshes.set(t.id, m);
      }
      m.userData.tick(t, time);
      MODELS.setDamped(m, t.warded < 1 && t.disabledT <= 0 && t.def.kind !== 'barrier');
      if (t.def.kind === 'barrier') { const sy = t.downT > 0 ? 0.15 : 1; if (m.scale.y !== sy) occVer++; m.scale.y = sy; } // Phoenix: the wall lies flat until it rises
      seen.add(t.id);
    }
    for (const [id, m] of towerMeshes) if (!seen.has(id)) { world.remove(m); towerMeshes.delete(id); occVer++; }
    seen.clear();
    for (const e of state.enemies) {
      let m = enemyMeshes.get(e.id);
      if (!m) { m = MODELS.enemy(e.type, e.def); world.add(m); enemyMeshes.set(e.id, m); }
      const ahead = posOn(e.poly, Math.min(e.poly.len, e.d + 3));
      if (ahead.x !== e.x || ahead.y !== e.y) m.rotation.y = -Math.atan2(ahead.y - e.y, ahead.x - e.x);
      // Iced Wings: a grounded flyer sinks most of the way down, easing back up as the frost wears off
      // Skyhook cargo is lifted under its hook (a negative sink)
      m.userData.low = (m.userData.low || 0) + ((e.carried ? -1.1 : e.downT > 0 ? 0.8 : 0) - (m.userData.low || 0)) * 0.15;
      m.position.set(e.x / T, -m.userData.low, e.y / T);
      // Midnight: a stopped robot holds its pose mid-stride
      if (e.stopT > 0) { if (e.frozeAt === undefined) e.frozeAt = time; } else e.frozeAt = undefined;
      m.userData.tick(e, e.frozeAt ?? time, e.d / T);
      // a hologram flickers now and then: the player can spot it, the towers cannot
      m.userData.setGhost(e.stealth ? (e.revealed ? 1 : 2) : e.fake && Math.sin(time * 9 + e.id) > 0.55 ? 1 : 0);
      m.visible = !e.under;
      seen.add(e.id);
    }
    for (const [id, m] of enemyMeshes) if (!seen.has(id)) { world.remove(m); enemyMeshes.delete(id); }
    if (state.build && state.hover) {
      const g = ghostInfo();
      const gdir = TW[g.key].onPath && inBounds(g.ax, g.ay) && grid[g.ay][g.ax] === 'path' ? anyRoadAt(g.ax, g.ay).dir : state.dir;
      const key = `${g.key}:${gdir}:${g.ok}`;
      if (key !== ghostKey) {
        if (ghostMesh) world.remove(ghostMesh);
        ghostMesh = MODELS.ghostify(MODELS.tower(g.key, null, 0, g.cells.map(([cx, cy]) => [cx + 0.5 - g.c.x / T, cy + 0.5 - g.c.y / T]), gdir), g.ok);
        ghostKey = key; world.add(ghostMesh);
      }
      ghostMesh.position.set(g.c.x / T, baseY(g.fake), g.c.y / T);
      // the preview turret already looks where the placed one will; tick may swap lamp materials, so re-ghost after
      ghostMesh.userData.tick(g.fake, time); MODELS.ghostify(ghostMesh, g.ok);
      return g;
    }
    if (ghostMesh) { world.remove(ghostMesh); ghostMesh = null; ghostKey = ''; }
    return null;
  }

  // ---------- overlay: light, effects and UI marks, projected onto the city ----------
  function trace(pts, close) {
    pts.forEach((p, i) => { const q = proj(p[0], p[1], p[2] || 0); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    if (close) ctx.closePath();
  }
  function arcPts(x, y, R, a0 = 0, a1 = TAU, h = 0.04) {
    const n = Math.max(10, Math.ceil((Math.abs(a1 - a0) / TAU) * 72)), out = [];
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([x + Math.cos(a) * R, y + Math.sin(a) * R, h]); }
    return out;
  }
  const cellQuad = (cx, cy, h = 0.03, i = 0) => [[cx * T + i, cy * T + i, h], [(cx + 1) * T - i, cy * T + i, h], [(cx + 1) * T - i, (cy + 1) * T - i, h], [cx * T + i, (cy + 1) * T - i, h]];
  // A jagged electric arc between two points [px, py, h], drawn in screen space.
  function arc(a, b, alpha) {
    const p = proj(a[0], a[1], a[2]), q = proj(b[0], b[1], b[2]), d = view.dpr;
    const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    const pts = [[p.x, p.y]];
    for (let k = 1; k < 8; k++) { const f = k / 8, j = (Math.random() - 0.5) * Math.min(18, len * 0.18) * d; pts.push([p.x + dx * f + nx * j, p.y + dy * f + ny * j]); }
    pts.push([q.x, q.y]);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
    for (const [w, c] of [[6, `rgba(120, 200, 255, ${0.18 * alpha})`], [1.6, `rgba(230, 248, 255, ${0.95 * alpha})`]]) {
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = c; ctx.lineWidth = w * d; ctx.stroke();
    }
    ctx.restore();
  }
  // The overlay is a flat 2D layer with no depth buffer, so a mark would draw over anything in front of it.
  // This asks whether a building, tenement or tower stands between the camera and a point on the map
  // (px, py in world pixels, h in tiles), so marks can skip themselves when they are behind something.
  // Every tower asks this for several marks every frame, and each ask ray-tests triangles. Two things keep that flat
  // as the tower count grows: the answer is cached until the camera moves or the buildings change (occVer), and a
  // tower is only ray-tested if the ray touches its bounding sphere.
  const occRay = new THREE.Raycaster(), _od = new THREE.Vector3(), occCache = new Map();
  let occSig = '', occVer = 0;
  occRay.camera = camera;
  function towerSphere(m) {
    let s = m.userData.occSphere;
    if (!s) {
      m.updateMatrixWorld(true);
      s = new THREE.Box3().setFromObject(m).getBoundingSphere(new THREE.Sphere());
      s.radius += 0.35; // animated parts (barrels, spinners) reach a little past the resting pose
      m.userData.occSphere = s;
    }
    return s;
  }
  function hidden(px, py, h, skip) {
    const cp = camera.position, sig = `${occVer}|${cp.x.toFixed(3)},${cp.y.toFixed(3)},${cp.z.toFixed(3)}`;
    if (sig !== occSig) { occSig = sig; occCache.clear(); }
    const ck = `${px.toFixed(1)},${py.toFixed(1)},${h.toFixed(2)},${skip && skip.userData.tower ? skip.userData.tower.id : ''}`;
    const hit = occCache.get(ck);
    if (hit !== undefined) return hit;
    _od.set(px / T, h, py / T).sub(camera.position);
    const dist = _od.length();
    occRay.set(camera.position, _od.normalize());
    occRay.far = dist - 0.15; // a mark painted on a surface is not behind that surface
    const objs = [];
    if (gateGroup) objs.push(gateGroup);
    if (blockGroup) objs.push(blockGroup);
    for (const m of towerMeshes.values()) if (m !== skip && occRay.ray.intersectsSphere(towerSphere(m))) objs.push(m);
    const res = occRay.intersectObjects(objs, true).length > 0;
    if (occCache.size > 4000) occCache.clear(); // moving marks (muzzle flashes) add keys; the cap bounds them
    occCache.set(ck, res);
    return res;
  }
  const light = (x, y, r, color, a) => { ctx.globalCompositeOperation = 'lighter'; A.glow(ctx, x, y, r, color, a); ctx.globalCompositeOperation = 'source-over'; };

  // A railgun slug: the line snaps out from the barrel in a few hundredths of a second, a white-hot core thins
  // away inside a wide teal glow, and an ion spiral wound round the line widens and fades after it.
  function drawRail(f, k, u, d) {
    const age = 1 - k, tt = age * f.max, ext = clamp(tt / 0.05, 0, 1), L = f.len * ext;
    const px = -f.dy, py = f.dx, wpx = (f.w / T) * u;
    ctx.lineCap = 'round';
    for (const o of f.lanes) {
      ctx.globalCompositeOperation = 'lighter';
      const x0 = f.x0 + px * o, y0 = f.y0 + py * o;
      const a = proj(x0, y0, f.h), b = proj(x0 + f.dx * L, y0 + f.dy * L, f.h);
      const line = (w, color, alpha) => {
        if (alpha <= 0 || w <= 0) return;
        ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      };
      const lane = f.lanes.length > 1 ? 0.55 : 1;
      line(wpx * (0.9 - 0.3 * k) * lane, f.color, 0.22 * k * k);
      line(wpx * 0.32 * lane, P.goldHi, 0.4 * k * k);
      line(Math.max(1.2 * d, wpx * 0.16 * k * lane), '#ffffff', clamp(k * 1.8, 0, 1));
      // the ion spiral: a helix in 3D around the line, opening up as it fades
      const r = (0.07 + 0.22 * age) * T * lane, n = Math.max(8, Math.round(L / (0.07 * T)));
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const s = (i / n) * L, ph = f.phase + s / (0.32 * T) * TAU * f.coil * 0.5 - age * 5;
        const q = proj(x0 + f.dx * s + px * Math.cos(ph) * r, y0 + f.dy * s + py * Math.cos(ph) * r, f.h + (Math.sin(ph) * r) / T);
        if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
      }
      ctx.globalAlpha = 0.75 * k; ctx.strokeStyle = P.cream; ctx.lineWidth = Math.max(d, 0.025 * u); ctx.stroke();
      ctx.globalAlpha = 1;
      if (k > 0.5) light(b.x, b.y, 0.35 * u * k, f.color, k);
      light(a.x, a.y, (0.25 + 0.7 * k * k) * u, P.cream, k);
      light(a.x, a.y, (0.5 + 0.9 * k) * u, f.color, 0.6 * k);
    }
  }
  // One puff of flame: eases out along its heading, dips to robot height and then lifts as it cools.
  const FIRE = ['#fff4d6', P.lantern, P.emberHi, P.ember, P.emberLo];
  function drawFire(f, k, u) {
    const a = 1 - k, e = 1 - (1 - a) * (1 - a);
    const x = f.x + Math.cos(f.ang) * f.reach * e, y = f.y + Math.sin(f.ang) * f.reach * e;
    const h = f.h0 + (f.h1 - f.h0) * e + a * a * f.rise;
    const q = proj(x, y, h), r = (0.07 + 0.3 * a) * u * f.s;
    const fade = Math.min(1, a / 0.08) * Math.pow(k, 0.7);
    const c = FIRE[Math.min(FIRE.length - 1, Math.floor(a * 4.2))];
    if (a > 0.55) {
      // smoke left behind as it burns out
      const sq = proj(x, y, h + (a - 0.55) * 0.8);
      ctx.globalAlpha = (a - 0.55) * k * 0.9;
      A.glow(ctx, sq.x, sq.y, r * 1.3, '#1a1420', 1);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'lighter';
    light(q.x, q.y, r, c, 0.6 * fade);
    if (a < 0.35) light(q.x, q.y, r * 0.45, '#fff4d6', 0.6 * fade);
  }

  // Sentinel Rifle's sight: the map outside its lit area is dimmed (tenement shadows), road it has a clear line to
  // is tinted, road it can't see is hatched. Both the polygon and the
  // road test are cached per position (visibility, roadSight), so a frame only draws.
  function drawSight(x, y) {
    const d = view.dpr, v = visibility(x, y, mapReach() * T), road = roadSight(x, y);
    ctx.setLineDash([]);
    ctx.beginPath();
    trace([[0, 0, 0.04], [COLS * T, 0, 0.04], [COLS * T, ROWS * T, 0.04], [0, ROWS * T, 0.04]], true);
    trace(v.pts.map((p) => [p.x, p.y, 0.04]), true);
    ctx.fillStyle = 'rgba(3, 5, 12, 0.5)';
    ctx.fill('evenodd');
    ctx.beginPath(); trace(v.pts.map((p) => [p.x, p.y, 0.04]), true);
    ctx.fillStyle = hexA(P.cream, 0.05); ctx.fill();
    const seen = new Path2D(), hidden = new Path2D();
    const quad = (pp, tx, ty) => {
      [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([a, b], i) => { const q = proj((tx + a) * T, (ty + b) * T, 0.05); i ? pp.lineTo(q.x, q.y) : pp.moveTo(q.x, q.y); });
      pp.closePath();
    };
    for (const [tx, ty, ok] of road.tiles) {
      if (ok) { quad(seen, tx, ty); continue; }
      // two diagonal strokes per hidden tile read as hatching at any zoom
      for (const f of [0.3, 0.7]) {
        const a = proj((tx + f) * T, ty * T, 0.05), b = proj(tx * T, (ty + f) * T, 0.05);
        const c = proj((tx + 1) * T, (ty + f) * T, 0.05), e = proj((tx + f) * T, (ty + 1) * T, 0.05);
        hidden.moveTo(a.x, a.y); hidden.lineTo(b.x, b.y); hidden.moveTo(c.x, c.y); hidden.lineTo(e.x, e.y);
      }
    }
    ctx.fillStyle = hexA('#8fe0b0', 0.28); ctx.fill(seen);
    ctx.strokeStyle = 'rgba(255, 90, 46, 0.75)'; ctx.lineWidth = 1.4 * d; ctx.stroke(hidden);
  }
  function drawRangeShape(key, s, x, y, dir, color, fill) {
    const kind = TW[key].kind, d = view.dpr;
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = fill; ctx.lineWidth = 1.4 * d;
    ctx.setLineDash([7 * d, 3 * d, 1.5 * d, 3 * d]);
    const shape = (pts) => { ctx.beginPath(); trace(pts, true); ctx.fill(); ctx.stroke(); };
    if (kind === 'beam') {
      const [dx, dy] = DIRS[dir];
      const len = s.range * T, half = s.width * T;
      shape([[x - dy * half, y + dx * half], [x - dy * half + dx * len, y + dx * half + dy * len], [x + dy * half + dx * len, y - dx * half + dy * len], [x + dy * half, y - dx * half]]);
    } else if (kind === 'cone') {
      const f = dirAngle(dir), h = (s.cone * Math.PI) / 180;
      shape([[x, y], ...arcPts(x, y, s.range * T, f - h, f + h)]);
    } else if (kind === 'support') {
      // Grid: towers with a cell inside this ring get a share of the boost
      if (s.reach) shape(arcPts(x, y, (1 + s.reach.r + 0.5) * T));
    } else if (kind === 'sniper') {
      drawSight(x, y);
    } else if (kind === 'barrier') {
      // no range: it simply stands in the way
    } else if (kind === 'volley') {
      // the 3×3 block it covers: road tiles lit, the rest dim, so a corner shows what it would bite
      const cx0 = Math.floor(x / T), cy0 = Math.floor(y / T);
      for (const [dx, dy] of NB8) {
        const cx = cx0 + dx, cy = cy0 + dy;
        if (!inBounds(cx, cy)) continue;
        const road = grid[cy][cx] === 'path';
        ctx.globalAlpha = road ? 1 : 0.35; ctx.setLineDash(road ? [] : [4 * d, 4 * d]);
        ctx.fillStyle = road ? fill.replace(/[\d.]+\)$/, '0.32)') : fill; ctx.strokeStyle = road ? color : 'rgba(243, 216, 138, 0.35)';
        ctx.beginPath(); trace(cellQuad(cx, cy, 0.035, 2), true); ctx.fill(); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (kind === 'light' || kind === 'bank' || kind === 'mines' || kind === 'clock') {
      shape(arcPts(x, y, s.range * T));
    } else {
      const R = s.range * T;
      shape(arcPts(x, y, R));
      if (s.minRange) { ctx.beginPath(); trace(arcPts(x, y, s.minRange * T), true); ctx.stroke(); }
      // Shade what the tenements hide: the range circle minus the visible area (even-odd fill).
      if (usesSight(key, s)) {
        const v = visibility(x, y, R);
        if (v.share > 0) {
          ctx.setLineDash([]);
          ctx.beginPath();
          trace(arcPts(x, y, R), true);
          trace(v.pts.map((p) => [p.x, p.y, 0.04]), true);
          ctx.fillStyle = 'rgba(3, 5, 12, 0.6)';
          ctx.fill('evenodd');
          // outline only the edges where sight is cut off
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(255, 90, 46, 0.85)'; ctx.lineWidth = 1.8 * d;
          for (let i = 0; i < v.pts.length; i++) {
            const p = v.pts[i], q = v.pts[(i + 1) % v.pts.length];
            if (dist(p.x, p.y, x, y) < R - 1 || dist(q.x, q.y, x, y) < R - 1) trace([[p.x, p.y, 0.04], [q.x, q.y, 0.04]]);
          }
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // Lamps and status marks for one tower.
  function drawTowerMarks(t, u, d, time) {
    const m = towerMeshes.get(t.id), by = baseY(t), L = m && m.userData.light;
    if (L && !hidden(t.x + (L.ox || 0) * T, t.y + (L.oy || 0) * T, by + L.h, m)) {
      const q = proj(t.x + (L.ox || 0) * T, t.y + (L.oy || 0) * T, by + L.h);
      const hot = t.flash > 0;
      const k = t.key === 'prism' ? 1 + (t.ramp || 0) * 1.4 : hot ? 1.8 : 1;
      light(q.x, q.y, L.r * u * k * (1 + 0.06 * Math.sin(time * 5 + t.id)), t.key === 'prism' && t.ramp > 0.95 ? '#ffffff' : L.color, t.disabledT > 0 ? 0.15 : 0.85);
      if (t.key === 'tesla' && t.disabledT <= 0 && (hot || Math.random() < 0.06)) {
        // little arcs crawling off the sphere
        ctx.beginPath();
        for (let j = 0; j < 2; j++) {
          const a = Math.random() * TAU; let x = q.x + Math.cos(a) * 0.2 * u, y = q.y + Math.sin(a) * 0.2 * u;
          ctx.moveTo(x, y);
          for (let n = 0; n < 3; n++) { x += Math.cos(a) * 0.12 * u + (Math.random() - 0.5) * 0.14 * u; y += Math.sin(a) * 0.12 * u + (Math.random() - 0.5) * 0.14 * u; ctx.lineTo(x, y); }
        }
        ctx.strokeStyle = P.cream; ctx.lineWidth = 1.2 * d; ctx.stroke();
      }
    }
    if (t.s && t.s.toll && L && t.disabledT <= 0) {
      // Chronometer: a row of pips over the lamp counts the strikes to the next toll; the last one pulses
      const n = t.s.toll.every, got = t.tollN || 0, ready = 1 - Math.min(1, Math.max(0, (t.cool || 0) * t.s.rate));
      const col = t.s.midnight ? P.ice : C.ARCH.engineering.color, q = proj(t.x, t.y, by + L.h + 0.3);
      for (let i = 0; i < n; i++) {
        const px = q.x + (i - (n - 1) / 2) * 0.28 * u, on = i < got, next = i === got && got === n - 1;
        A.diamond(ctx, px, q.y, 0.1 * u);
        ctx.fillStyle = on ? col : 'rgba(11, 19, 41, 0.85)'; ctx.fill();
        ctx.strokeStyle = on ? P.navy : hexA(col, 0.8); ctx.lineWidth = 1.5 * d; ctx.stroke();
        if (on || next) light(px, q.y, 0.12 * u, col, next ? 0.3 + 0.5 * ready * (0.6 + 0.4 * Math.sin(time * 10)) : 0.35);
      }
      if (t.s.midnight) {
        // Midnight: a hand sweeps round the stop circle towards twelve; the circle is the reach of the stop
        const R = t.s.range * t.s.midnight.reach * T, p = Math.min(1, (got + ready) / n), a0 = -Math.PI / 2;
        ctx.save();
        ctx.globalAlpha = 0.18 + 0.3 * p; ctx.strokeStyle = P.ice; ctx.lineWidth = 2 * d;
        ctx.beginPath(); trace(arcPts(t.x, t.y, R, a0, a0 + TAU * p, 0.05)); ctx.stroke();
        ctx.globalAlpha = 0.25; ctx.lineWidth = d;
        for (let h = 0; h < 12; h++) {
          const a = (h / 12) * TAU, r0 = h ? R * 0.95 : R * 0.9, i = proj(t.x + Math.cos(a) * r0, t.y + Math.sin(a) * r0, 0.05), o = proj(t.x + Math.cos(a) * R, t.y + Math.sin(a) * R, 0.05);
          ctx.beginPath(); ctx.moveTo(i.x, i.y); ctx.lineTo(o.x, o.y); ctx.stroke();
        }
        ctx.restore();
      }
    }
    if (t.charge > 1.01 && t.s && t.s.charge && t.disabledT <= 0) {
      // Capacitor: the crystal at the back of the deck glows brighter as the charge builds (along the barrel
      // only on a model without one); the barrel glow washed out against the rails and coils
      const k = (t.charge - 1) / (t.s.charge.max - 1), tip = muzzlePt(t), core = m && m.userData.muzzle && m.userData.muzzle.core;
      const a = dirAngle(t.dir), cx = t.x + Math.cos(a) * (core ? core.r : 0) * T, cy = t.y + Math.sin(a) * (core ? core.r : 0) * T;
      if (core && !hidden(cx, cy, by + core.h, m)) {
        const q = proj(cx, cy, by + core.h), pulse = 0.85 + 0.15 * Math.sin(time * (6 + 10 * k)), full = k > 0.98;
        light(q.x, q.y, (0.35 + 0.7 * k) * u, full ? '#ffffff' : P.teal, (0.35 + 0.65 * k) * pulse);
        light(q.x, q.y, (0.12 + 0.18 * k) * u, '#ffffff', (0.3 + 0.6 * k) * pulse);
      }
      if (!core) for (let i = 1; i <= 4; i++) {
        const f = i / 4, x = t.x + (tip.x - t.x) * f, y = t.y + (tip.y - t.y) * f, h = by + (tip.h - by) * (0.6 + 0.4 * f);
        if (hidden(x, y, h, m)) continue;
        const q = proj(x, y, h);
        light(q.x, q.y, (0.2 + 0.35 * k) * u, k > 0.98 ? '#ffffff' : P.teal, (0.3 + 0.6 * k) * (0.85 + 0.15 * Math.sin(time * 12 + i)));
      }
    }
    if (t.linkCutT > 0 && !hidden(t.x, t.y, by + 1.3, m)) {
      // cut off by a Signal Thief: a broken chain link over it, flickering
      const q = proj(t.x, t.y, by + 1.3);
      cutMark(q.x, q.y, 0.075 * u, d, time + t.id);
      light(q.x, q.y, 0.4 * u, P.pink, 0.3);
    }
    if (t.disabledT > 0 && t.disabledWhy !== 'Signal Thief' && !hidden(t.x, t.y, by + 1.1, m)) {
      // knocked out by an EMP: an ember spark crackles over it
      const q = proj(t.x, t.y, by + 1.1);
      if (Math.floor(time * 10) % 2) {
        ctx.beginPath(); ctx.moveTo(q.x - 0.3 * u, q.y); ctx.lineTo(q.x - 0.12 * u, q.y - 0.14 * u); ctx.lineTo(q.x, q.y + 0.06 * u); ctx.lineTo(q.x + 0.12 * u, q.y - 0.12 * u); ctx.lineTo(q.x + 0.3 * u, q.y + 0.02 * u);
        ctx.strokeStyle = P.ember; ctx.lineWidth = 2 * d; ctx.stroke();
      }
      light(q.x, q.y, 0.5 * u, P.ember, 0.35);
    }
    if (t.warded < 1 && t.disabledT <= 0 && t.def.kind !== 'barrier' && !hidden(t.x, t.y, by + 1.3, m)) {
      // damped by a Static Warden (the model itself goes cold, MODELS.setDamped): a dying wave over it
      const q = proj(t.x, t.y, by + 1.3);
      dampMark(q.x, q.y, 0.1 * u, d, time + t.id);
    }
    if (t.def.kind === 'barrier') drawBarrierMarks(t, u, d, time, m, by);
    if (t.def.kind === 'bank' && t.s && t.s.streak && t.streak > 0 && state.time - t.lastKill <= t.s.streak.window) {
      // Streak: an amber ring round the vault, fuller as the streak climbs, with the running bonus over it
      const k = t.streak / t.s.streak.max, fade = 1 - (state.time - t.lastKill) / t.s.streak.window;
      ctx.save(); ctx.globalAlpha = 0.4 + 0.5 * fade; ctx.strokeStyle = C.ARCH.barrage.color; ctx.lineWidth = (1.5 + 2.5 * k) * d;
      ctx.beginPath(); trace(arcPts(t.x, t.y, 1.6 * T, -Math.PI / 2, -Math.PI / 2 + k * TAU, 0.08)); ctx.stroke();
      if (!hidden(t.x, t.y, by + 2, m)) {
        const q = proj(t.x, t.y, by + 2);
        ctx.font = `700 ${12 * d}px ${UI_FONT}`; ctx.textAlign = 'center';
        ctx.fillStyle = P.ink; ctx.fillText(`Streak ${pct(t.streak)}`, q.x + d, q.y + d); ctx.fillStyle = C.ARCH.barrage.color; ctx.fillText(`Streak ${pct(t.streak)}`, q.x, q.y);
      }
      ctx.restore();
    }
  }
  // The barricade's marks: plating bar (steel frame while Bulwark guards it), Mender's tar on the road in front,
  // and Phoenix's countdown dial while it lies down.
  function drawBarrierMarks(t, u, d, time, m, by) {
    const s = t.s;
    if (s && s.tar && !(t.downT > 0)) {
      const [ux, uy] = t.dir === 0 ? [1, 0] : [0, 1], back = 0.85 * T; // clear of the wall's own tile, or the overlay blots out the model
      for (const sg of [-1, 1]) {
        ctx.save(); ctx.globalAlpha = 0.55;
        ctx.beginPath(); trace(arcPts(t.x + ux * back * sg, t.y + uy * back * sg, 0.3 * T, 0, TAU, 0.03), true);
        ctx.fillStyle = '#120d0a'; ctx.fill(); ctx.strokeStyle = 'rgba(79, 160, 138, 0.5)'; ctx.lineWidth = d; ctx.stroke(); ctx.restore();
      }
    }
    if (t.downT > 0) {
      if (hidden(t.x, t.y, by + 0.5, m)) return;
      const q = proj(t.x, t.y, by + 0.5), r = 0.16 * u, k = 1 - t.downT / s.phoenix.delay;
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, TAU); ctx.fillStyle = 'rgba(7, 10, 18, 0.75)'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.arc(q.x, q.y, r, -Math.PI / 2, -Math.PI / 2 + k * TAU); ctx.closePath();
      ctx.fillStyle = C.ARCH.engineering.color; ctx.fill();
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, TAU); ctx.strokeStyle = P.cream; ctx.lineWidth = 1.2 * d; ctx.stroke();
      return;
    }
    if (t.hp < t.maxHp && !hidden(t.x, t.y, by + 0.85, m)) {
      const top = proj(t.x, t.y, by + 0.85), w = 0.8 * u, h = Math.max(3 * d, 0.07 * u);
      rect(top.x - w / 2 - d, top.y - h - d, w + 2 * d, h + 2 * d, P.ink);
      rect(top.x - w / 2, top.y - h, Math.max(1, (w * t.hp) / t.maxHp), h, t.hp / t.maxHp > 0.35 ? P.goldHi : P.ember);
      // steel frame = guarded plating, the same cue the robots' armour uses
      ctx.strokeStyle = s && s.guard ? '#c4c9d6' : P.gold; ctx.lineWidth = (s && s.guard ? 1.6 : 1) * d;
      ctx.strokeRect(top.x - w / 2 - d, top.y - h - d, w + 2 * d, h + 2 * d);
    }
  }

  // The Searchlight's beam: a pale wedge of light on the paving, or the whole circle while Floodlight runs.
  function drawSearchBeam(t, u, d) {
    if (t.disabledT > 0 || !t.s) return;
    const s = t.s, m = towerMeshes.get(t.id), by = baseY(t), L = m && m.userData.light;
    const R = s.range * T, h = (s.cone * Math.PI) / 180;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    if (s.flood) {
      // Floodlight: the whole circle is lit. Idle it is only a faint rim (the range is big and always on);
      // the full glow and pulse show while the tower is selected.
      const on = state.selected && state.selected.tower === t;
      trace(arcPts(t.x, t.y, R, 0, TAU, 0.05), true);
      if (on) { ctx.fillStyle = 'rgba(243, 230, 184, 0.09)'; ctx.fill(); }
      ctx.globalAlpha = on ? 0.35 + 0.2 * Math.sin(state.time * 2 + t.id) : 0.12; ctx.strokeStyle = 'rgba(255, 246, 214, 0.8)'; ctx.lineWidth = (on ? 1.6 : 1) * d; ctx.stroke();
      ctx.restore();
      return;
    }
    trace([[t.x, t.y, 0.05], ...arcPts(t.x, t.y, R, t.aim - h, t.aim + h, 0.05)], true);
    ctx.fillStyle = 'rgba(243, 230, 184, 0.16)'; ctx.fill();
    // Designator: a crimson crosshair on the locked foe
    if (t.lockE && !gone(t.lockE)) reticle(t.lockE.x, t.lockE.y, t.lockE.r * 1.9, C.ARCH.precision.color, d, state.time * 1.5);
    if (L) {
      // the shaft from the lens down to the far edge of the wedge
      const a = proj(t.x, t.y, by + L.h), b = proj(t.x + Math.cos(t.aim) * R * 0.85, t.y + Math.sin(t.aim) * R * 0.85, 0.05);
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, 'rgba(255, 246, 214, 0.45)'); g.addColorStop(1, 'rgba(255, 246, 214, 0)');
      ctx.strokeStyle = g; ctx.lineCap = 'round'; ctx.lineWidth = 0.22 * u;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  }

  // a ring with four ticks on the paving (the Precision crosshair), turned by rot
  function reticle(x, y, R, color, d, rot = 0) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 1.8 * d; ctx.globalAlpha = 0.9;
    ctx.beginPath(); trace(arcPts(x, y, R, 0, TAU, 0.05), true); ctx.stroke();
    for (let k = 0; k < 4; k++) {
      const a = rot + (k * Math.PI) / 2, c = Math.cos(a), sn = Math.sin(a);
      ctx.beginPath(); trace([[x + c * R * 0.7, y + sn * R * 0.7, 0.05], [x + c * R * 1.35, y + sn * R * 1.35, 0.05]]); ctx.stroke();
    }
    ctx.restore();
  }

  // Brass mines on the road. Drawn flat on the paving so they read at any zoom: a dark pit that sets the mine off
  // the pale road, a gold-rimmed brass plate with a domed cap and eight studs. Unarmed, it is a dull plate that
  // drops in with a cream ring filling round it; armed, the cap goes gold and the lamp pulses in the signal colour
  // (ember), with a faint ember ring out at the rim. Burning mines carry ember studs.
  const ngon = (x, y, R, n, rot, h) => Array.from({ length: n }, (_, i) => [x + Math.cos(rot + (i * TAU) / n) * R, y + Math.sin(rot + (i * TAU) / n) * R, h]);
  // flat: true draws the mines lying on the road (for the decal), false the rest (dropping, or limpets on a robot).
  // Skyhook cables to their cargo, and Salvager wrecks: a scrap pile with a gold rebuild ring and a tether to its Salvager
  function drawRobotLinks(u, d, time) {
    ctx.save();
    for (const e of state.enemies) {
      if (!e.cargo || e.dead) continue;
      const a = proj(e.x, e.y, aimHeight(e)), b = proj(e.cargo.x, e.cargo.y, aimHeight(e.cargo) + 0.25);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.globalAlpha = 0.9; ctx.strokeStyle = P.gold; ctx.lineWidth = Math.max(1.4 * d, 0.03 * u); ctx.stroke();
    }
    for (const k of state.wrecks) {
      const R = 0.28 * T, sv = k.by;
      ctx.globalAlpha = sv ? 1 : clamp(k.life / 2, 0, 0.6);
      ctx.beginPath(); trace(ngon(k.x, k.y, R, 7, k.d, 0.04), true); ctx.fillStyle = '#4b4638'; ctx.fill();
      ctx.strokeStyle = P.goldLo; ctx.lineWidth = 1.2 * d; ctx.stroke();
      if (!sv) continue;
      const f = clamp(1 - k.t / sv.def.salvage.delay, 0, 1);
      ctx.beginPath(); trace(arcPts(k.x, k.y, R * 1.5, -Math.PI / 2, -Math.PI / 2 + TAU * f, 0.05));
      ctx.strokeStyle = P.goldHi; ctx.lineWidth = 2.2 * d; ctx.stroke();
      if (!sv.dead) {
        ctx.setLineDash([0.08 * u, 0.08 * u]); ctx.globalAlpha = 0.45 + 0.3 * Math.sin(time * 8);
        ctx.beginPath(); trace([[sv.x, sv.y, aimHeight(sv)], [k.x, k.y, 0.05]]);
        ctx.strokeStyle = P.gold; ctx.lineWidth = 1.2 * d; ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }
  function drawMines(u, d, time, flat) {
    for (const m of state.mines) {
      if (flat !== (!m.stuck && state.time - m.born >= 0.25)) continue;
      const armed = m.armT <= 0, age = state.time - m.born, fire = !!m.src.s.burn;
      const arm = armed ? 1 : clamp(1 - m.armT / 0.6, 0, 1);
      const R = (m.mini ? 0.12 : 0.2) * T, drop = Math.pow(Math.max(0, 1 - age / 0.25), 2) * 0.7, pulse = 0.5 + 0.5 * Math.sin(time * (m.stuck ? 14 : 6) + m.d);
      ctx.save();
      // pit (a limpet rides its enemy at chest height instead)
      if (!m.stuck) {
        ctx.beginPath(); trace(arcPts(m.x, m.y, R * 1.45, 0, TAU, 0.03), true); ctx.fillStyle = 'rgba(6, 9, 22, 0.78)'; ctx.fill();
        if (armed) { ctx.globalAlpha = 0.25 + 0.4 * pulse; ctx.strokeStyle = P.ember; ctx.lineWidth = 1.2 * d; ctx.stroke(); ctx.globalAlpha = 1; }
      }
      // plate
      const h = m.stuck ? aimHeight(m.stuck) : 0.05 + drop;
      ctx.beginPath(); trace(ngon(m.x, m.y, R * 1.12, 8, Math.PI / 8, h), true);
      ctx.fillStyle = armed ? P.brass : '#4b4638'; ctx.fill();
      ctx.strokeStyle = armed ? P.gold : P.goldLo; ctx.lineWidth = 1.8 * d; ctx.stroke();
      // studs
      for (const p of ngon(m.x, m.y, R * 0.92, 8, 0, h + 0.01)) {
        const q = proj(p[0], p[1], p[2]); A.diamond(ctx, q.x, q.y, 0.03 * u); ctx.fillStyle = fire ? P.ember : P.cream; ctx.fill();
      }
      // domed cap
      ctx.beginPath(); trace(arcPts(m.x, m.y, R * 0.62, 0, TAU, h + 0.06), true);
      ctx.fillStyle = armed ? P.goldHi : P.goldLo; ctx.fill(); ctx.strokeStyle = P.ink; ctx.lineWidth = d; ctx.stroke();
      const c = proj(m.x, m.y, h + 0.1);
      if (armed) {
        // lamp: the signal colour, pulsing
        ctx.beginPath(); ctx.arc(c.x, c.y, (0.045 + 0.015 * pulse) * u, 0, TAU); ctx.fillStyle = pulse > 0.5 ? P.emberHi : P.ember; ctx.fill();
        light(c.x, c.y, (0.28 + 0.12 * pulse) * u, P.ember, 0.55 + 0.35 * pulse);
      } else {
        ctx.beginPath(); ctx.arc(c.x, c.y, 0.04 * u, 0, TAU); ctx.fillStyle = '#1a2240'; ctx.fill();
        // arming ring filling up
        ctx.beginPath(); trace(arcPts(m.x, m.y, R * 1.3, -Math.PI / 2, -Math.PI / 2 + TAU * arm, 0.06));
        ctx.strokeStyle = P.cream; ctx.lineWidth = 2 * d; ctx.stroke();
      }
      ctx.restore();
    }
  }

  // The road decal: marks painted on the paving (gate chevrons, Arc Rail strips, Firewall pools, mines lying on the
  // road) go on a canvas texture on a plane just above the ground, so robots and buildings hide them with real depth.
  function buildDecal() {
    if (decalMesh) { scene.remove(decalMesh); decalMesh.geometry.dispose(); decalMesh.material.dispose(); decalTex.dispose(); }
    const dw = COLS + 2 * DECAL_PAD, dh = ROWS + 2 * DECAL_PAD;
    DK = Math.floor(Math.min(64, 2048 / dw, 2048 / dh));
    decalCanvas.width = dw * DK; decalCanvas.height = dh * DK;
    decalAt = 0; // the resize blanked it: repaint on the next frame
    decalTex = new THREE.CanvasTexture(decalCanvas);
    decalTex.encoding = THREE.sRGBEncoding; decalTex.generateMipmaps = false; decalTex.minFilter = THREE.LinearFilter;
    // unlit and not tone mapped, so the colours match the overlay's
    decalMesh = new THREE.Mesh(new THREE.PlaneGeometry(dw, dh), new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false, toneMapped: false }));
    decalMesh.rotation.x = -Math.PI / 2; decalMesh.position.set(COLS / 2, 0.03, ROWS / 2);
    scene.add(decalMesh);
  }
  // The decal is a big canvas re-uploaded to the GPU on every repaint, and what it shows (marching chevrons, fading
  // strips, pools, mines) is slow, so it repaints at 20 Hz rather than every frame.
  let decalAt = 0;
  // When frames are slow the repaint backs off with them: it is a multi-megabyte upload, and a crowd that already
  // costs a long frame should not pay for a 20 Hz decal on top.
  let decalFrameAt = 0, decalFrame = 16;
  function paintDecal(now) {
    decalFrame += (Math.min(250, now - decalFrameAt) - decalFrame) * 0.1; decalFrameAt = now;
    if (now - decalAt < Math.max(50, decalFrame * 2)) return;
    decalAt = now;
    // line widths are given in screen pixels; scale them so they look the same on screen as on the overlay, but
    // no thinner than the decal can hold when zoomed right in
    const u = DK, d = Math.max(0.75, (view.dpr * DK) / view.ppt), time = state.time;
    ctx = decalCtx; decalK = DK;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, decalCanvas.width, decalCanvas.height); ctx.lineJoin = 'round';
    for (const g of gates) if (!g.exit) {
      const cs = Math.cos(g.ang), sn = Math.sin(g.ang);
      for (let k = 0; k < 3; k++) {
        const ph = (time * 0.7 + k / 3) % 1, cx = g.x + cs * (0.25 + ph * 0.8) * T, cy = g.y + sn * (0.25 + ph * 0.8) * T;
        ctx.beginPath();
        trace([[cx - cs * 5 - sn * 9, cy - sn * 5 + cs * 9], [cx + cs * 4, cy + sn * 4], [cx - cs * 5 + sn * 9, cy - sn * 5 - cs * 9]]);
        ctx.strokeStyle = `rgba(255, 90, 46, ${(1 - ph) * 0.85})`; ctx.lineWidth = 2.4 * d; ctx.stroke();
      }
    }
    drawStrips(u, d, time);
    drawPools(u, d, time);
    drawMines(u, d, time, true);
    ctx = fxCtx; decalK = 0;
    decalTex.needsUpdate = true;
  }

  // Arc Rail strips: live road tiles glow teal and fade over their last second, with the odd spark crawling over them.
  function drawStrips(u, d, time) {
    if (!state.strips.size) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const st of state.strips.values()) {
      const left = st.until - state.time, k = clamp(left, 0, 1) * (0.75 + 0.25 * Math.sin(time * 9 + st.cx * 1.7 + st.cy));
      ctx.globalAlpha = 0.28 * k;
      ctx.beginPath(); trace(cellQuad(st.cx, st.cy, 0.035, 2), true); ctx.fillStyle = P.teal; ctx.fill();
      ctx.globalAlpha = 0.6 * k; ctx.strokeStyle = P.teal; ctx.lineWidth = d; ctx.stroke();
      if (Math.random() < 0.03) arc([st.x - T * 0.35, st.y + (Math.random() - 0.5) * T * 0.6, 0.04], [st.x + T * 0.35, st.y + (Math.random() - 0.5) * T * 0.6, 0.04], 0.6 * k);
    }
    ctx.restore();
  }

  // Firewall pools: burning road tiles, ember-orange, with flames licking up from them now and then.
  function drawPools(u, d, time) {
    if (!state.pools.size) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const q of state.pools.values()) {
      const k = clamp(q.until - state.time, 0, 1) * (0.7 + 0.3 * Math.sin(time * 11 + q.cx * 2.3 + q.cy));
      ctx.globalAlpha = 0.3 * k;
      ctx.beginPath(); trace(cellQuad(q.cx, q.cy, 0.035, 2), true); ctx.fillStyle = P.ember; ctx.fill();
      ctx.globalAlpha = 0.5 * k; ctx.strokeStyle = P.emberHi; ctx.lineWidth = d; ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- the late robots' fields and marks ----------
  const WARDEN = '#7fb4c0', WARDEN_DK = '#3f7d8c', BAFFLE = '#58b4c0';
  // a ring on the paving whose radius wavers by `wob` (share of R) in `lobes` bumps
  const wobPts = (x, y, R, wob, lobes, ph, h = 0.04) => {
    const out = [];
    for (let i = 0; i <= 72; i++) { const a = (i / 72) * TAU; const r = R * (1 + wob * Math.sin(a * lobes + ph)); out.push([x + Math.cos(a) * r, y + Math.sin(a) * r, h]); }
    return out;
  };
  // Static Warden: a cold haze on the paving, ripples drawn inward to it (the towers' clocks running down) and a
  // fine solid edge, so the reach reads against the dashed auras of the support robots
  function drawWardenField(e, d, time) {
    const R = e.def.warden.range * T;
    ctx.save();
    ctx.beginPath(); trace(arcPts(e.x, e.y, R), true); ctx.fillStyle = hexA(WARDEN_DK, 0.14); ctx.fill();
    for (let k = 0; k < 3; k++) {
      const ph = (time * 0.45 + k / 3 + e.id * 0.13) % 1;
      ctx.beginPath(); trace(wobPts(e.x, e.y, R * (1 - 0.78 * ph), 0.025, 9, time * 3 + k * 2), true);
      ctx.strokeStyle = hexA(WARDEN_DK, 0.75 * Math.sin(ph * Math.PI)); ctx.lineWidth = 1.6 * d; ctx.stroke();
    }
    ctx.beginPath(); trace(arcPts(e.x, e.y, R), true); ctx.strokeStyle = hexA(WARDEN, 0.8); ctx.lineWidth = 1.4 * d; ctx.stroke();
    ctx.restore();
  }
  // Baffle Drone: eight shield plates round its reach, turning slowly, a faint wash inside and a cold lamp under the pod
  function drawBaffleField(e, H, u, d, time) {
    const R = e.def.baffle.range * T, n = 8, rot = time * 0.35 + e.id;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath(); trace(arcPts(e.x, e.y, R), true); ctx.fillStyle = hexA(BAFFLE, 0.06); ctx.fill();
    for (let k = 0; k < n; k++) {
      const a0 = rot + (k * TAU) / n + 0.07, a1 = rot + ((k + 1) * TAU) / n - 0.07;
      ctx.beginPath(); trace([...arcPts(e.x, e.y, R, a0, a1), ...arcPts(e.x, e.y, R * 0.88, a1, a0)], true);
      ctx.fillStyle = hexA(BAFFLE, 0.2); ctx.fill();
      ctx.strokeStyle = hexA(P.ice, 0.55); ctx.lineWidth = d; ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    const lamp = proj(e.x, e.y, H - 0.62), foot = proj(e.x, e.y, 0.04);
    ctx.beginPath(); ctx.moveTo(lamp.x, lamp.y); ctx.lineTo(foot.x, foot.y);
    ctx.strokeStyle = hexA(P.ice, 0.25); ctx.lineWidth = 2 * d; ctx.stroke();
    light(lamp.x, lamp.y, 0.22 * u, P.ice, 0.6);
    light(foot.x, foot.y, 0.45 * u, BAFFLE, 0.35);
    ctx.restore();
  }
  // Governor: a regulator's dial on the paving: a lilac rim with ticks, every third one long, turning slowly
  function drawGovernorDial(e, d, time) {
    const R = e.def.governor.radius * T, rot = time * 0.25 + e.id;
    ctx.save();
    ctx.beginPath(); trace(arcPts(e.x, e.y, R), true); ctx.globalAlpha = 0.75; ctx.strokeStyle = P.lilac; ctx.lineWidth = 1.4 * d; ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < 24; k++) {
      const a = rot + (k * TAU) / 24, r1 = R * (k % 3 ? 0.93 : 0.86), c = Math.cos(a), sn = Math.sin(a);
      trace([[e.x + c * R, e.y + sn * R, 0.04], [e.x + c * r1, e.y + sn * r1, 0.04]]);
    }
    ctx.globalAlpha = 0.75; ctx.lineWidth = 1.2 * d; ctx.stroke();
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1;
    ctx.beginPath(); trace(arcPts(e.x, e.y, R * 0.98, rot * 3, rot * 3 + 0.7), false); ctx.strokeStyle = hexA(P.lilac, 0.7); ctx.lineWidth = 2 * d; ctx.stroke();
    ctx.restore();
  }
  // Signal Thief: while it locks on, a dashed pink beam reaches out and a reticle closes on the tower; once the tower is
  // cut, a thin line stays and packets of its signal stream back into the thief's dish
  function drawThiefLink(e, H, u, d, time) {
    const t = e.thiefTarget, lock = e.thiefLock > 0, a = proj(e.x, e.y, H * 0.78), b = proj(t.x, t.y, baseY(t) + 0.45);
    ctx.save();
    if (lock) {
      const k = clamp(1 - e.thiefLock / e.def.thief.lock, 0, 1);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = hexA(P.pink, 0.25); ctx.lineWidth = 3 * d; ctx.stroke();
      ctx.setLineDash([4 * d, 4 * d]); ctx.lineDashOffset = -time * 40 * d;
      ctx.strokeStyle = hexA(P.pink, 0.7 + 0.3 * k); ctx.lineWidth = (1.6 + 1.2 * k) * d; ctx.stroke(); ctx.setLineDash([]);
      // the reticle: four corner brackets closing in and turning
      const r = (0.5 - 0.3 * k) * u, rot = time * 2;
      ctx.strokeStyle = P.pink; ctx.lineWidth = 1.8 * d;
      for (let i = 0; i < 4; i++) {
        const ang = rot + (i * Math.PI) / 2, cx = b.x + Math.cos(ang) * r, cy = b.y + Math.sin(ang) * r * 0.6;
        ctx.beginPath(); ctx.arc(cx, cy, 0.09 * u, ang + Math.PI - 0.6, ang + Math.PI + 0.6); ctx.stroke();
      }
      light(b.x, b.y, 0.3 * u, P.pink, 0.4 + 0.5 * k);
    } else {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = hexA(P.pink, 0.4); ctx.lineWidth = d; ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const f = (time * 1.3 + i / 4) % 1, x = b.x + (a.x - b.x) * f, y = b.y + (a.y - b.y) * f;
        A.diamond(ctx, x, y, 0.05 * u, 0.035 * u); ctx.fillStyle = hexA(P.ice, 0.9 * Math.sin(f * Math.PI)); ctx.fill();
      }
      light(a.x, a.y, 0.25 * u, P.pink, 0.5);
    }
    ctx.restore();
  }
  // a dark disc behind a small mark, so it reads over any facade
  const markBack = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = 'rgba(7, 10, 18, 0.62)'; ctx.fill(); };
  // the damped-tower mark: a wave dying away
  function dampMark(x, y, r, d, ph) {
    ctx.save(); markBack(x, y, r * 1.25);
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const f = i / 24, px = x - r * 0.9 + f * r * 1.8, py = y + Math.sin(f * TAU * 2.5 - ph * 2) * r * 0.6 * Math.exp(-f * 2.6); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.strokeStyle = WARDEN; ctx.lineWidth = 1.6 * d; ctx.lineCap = 'round'; ctx.stroke();
    ctx.restore();
  }
  // the cut-tower mark: a chain link broken in two, with a spark in the gap
  function cutMark(x, y, r, d, ph) {
    ctx.save(); markBack(x, y, r * 1.9);
    ctx.translate(x, y); ctx.rotate(-Math.PI / 4);
    ctx.strokeStyle = P.pink; ctx.lineWidth = 1.8 * d;
    for (const sg of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sg * r * 0.85, 0, r * 0.6, r * 0.34, 0, 0, TAU); ctx.stroke(); }
    if (Math.sin(ph * 9) > -0.2) { ctx.beginPath(); ctx.moveTo(0, -r * 0.55); ctx.lineTo(0, -r * 0.2); ctx.moveTo(0, r * 0.2); ctx.lineTo(0, r * 0.55); ctx.strokeStyle = P.ice; ctx.lineWidth = 1.2 * d; ctx.stroke(); }
    ctx.restore();
  }
  // the shielded mark: a small heater shield in baffle teal
  function shieldMark(x, y, r, d) {
    ctx.save(); ctx.beginPath();
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y - r); ctx.quadraticCurveTo(x + r, y + r * 0.5, x, y + r * 1.35); ctx.quadraticCurveTo(x - r, y + r * 0.5, x - r, y - r); ctx.closePath();
    ctx.fillStyle = hexA(BAFFLE, 0.85); ctx.fill(); ctx.strokeStyle = P.ice; ctx.lineWidth = 1.2 * d; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - r * 0.7); ctx.lineTo(x, y + r * 0.9); ctx.strokeStyle = hexA(P.ice, 0.8); ctx.lineWidth = d; ctx.stroke();
    ctx.restore();
  }
  // the governed mark: a lilac half-dial with its needle held near the middle
  function gaugeMark(x, y, r, d, ph) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI, TAU); ctx.closePath(); ctx.fillStyle = 'rgba(7, 10, 18, 0.62)'; ctx.fill();
    ctx.strokeStyle = P.lilac; ctx.lineWidth = 1.4 * d; ctx.stroke();
    const a = -Math.PI / 2 + Math.sin(ph * 6) * 0.12;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85); ctx.strokeStyle = P.cream; ctx.lineWidth = 1.2 * d; ctx.stroke();
    ctx.restore();
  }

  // Health, defenses and status effects for one robot.
  function drawEnemyMarks(e, u, d, time) {
    const m = enemyMeshes.get(e.id);
    if (!m) return;
    const H = m.userData.h, s = m.userData.s, R = (s * 1.25 + 0.14) * T, D = e.def;
    if (e.under) {
      // a burrowing mole: just a churning mound of earth moving under the paving
      // a Deep Borer (a variant) churns a wider mound
      const q = proj(e.x, e.y, 0.03), r = (0.22 + 0.03 * Math.sin(time * 12 + e.id)) * u * (D.variant ? 1.4 : 1);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(q.x, q.y, r * 1.3, r * 0.7, 0, 0, TAU); ctx.fillStyle = 'rgba(74, 56, 34, 0.85)'; ctx.fill();
      ctx.strokeStyle = P.roadLo; ctx.lineWidth = d; ctx.stroke();
      for (let k = 0; k < 3; k++) { const a = time * 4 + k * 2.1 + e.id; A.diamond(ctx, q.x + Math.cos(a) * r, q.y + Math.sin(a) * r * 0.5, 0.035 * u); ctx.fillStyle = P.roadLo; ctx.fill(); }
      ctx.restore();
      return;
    }
    ctx.save();
    // aura robots show their reach as a ring on the paving
    if ((D.aegis || D.haste || D.lamp || D.mend) && !jammed(e)) {
      const a = D.aegis || D.haste || D.lamp || D.mend, col = D.aegis ? P.goldHi : D.haste ? P.ember : D.mend ? P.teal : P.lantern;
      ctx.beginPath(); trace(arcPts(e.x, e.y, a.radius * T), true);
      ctx.setLineDash([2 * d, 5 * d]); ctx.lineDashOffset = time * 10 * d;
      // a variant's wider aura (Beacon, Phalanx) draws a bolder ring; the Herald keeps its base's until it has a look
      const bold = D.variant && !D.haste;
      ctx.globalAlpha = bold ? 0.75 : 0.5; ctx.strokeStyle = col; ctx.lineWidth = (bold ? 2 : 1.2) * d; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (D.lamp) { const q = proj(e.x, e.y, H + 0.25); light(q.x, q.y, 0.45 * u * (D.variant ? 1.6 : 1), P.lantern, 0.8); }
    }
    if (D.warden && !jammed(e)) drawWardenField(e, d, time);
    if (D.baffle && !jammed(e)) drawBaffleField(e, H, u, d, time);
    if (D.governor && !jammed(e)) drawGovernorDial(e, d, time);
    if (e.plantT > 0 && e.sapTarget) {
      // the Sapper's fuse, fizzing toward the tower it is about to knock out
      const a = proj(e.x, e.y, H * 0.5), b = proj(e.sapTarget.x, e.sapTarget.y, 0.3);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.setLineDash([3 * d, 3 * d]); ctx.lineDashOffset = -time * 30 * d; ctx.strokeStyle = P.ember; ctx.lineWidth = 1.6 * d; ctx.stroke(); ctx.setLineDash([]);
      const k = 1 - e.plantT / D.sap.plant, f = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      light(f.x, f.y, 0.3 * u, P.emberHi, 0.95);
    }
    if (D.thief && e.thiefTarget && state.towers.includes(e.thiefTarget) && ((e.thiefLock > 0 && !jammed(e)) || e.thiefTarget.linkCutT > 0)) drawThiefLink(e, H, u, d, time);
    if (state.inspect === e) {
      // the inspected robot: a gold ring on the paving that follows it
      ctx.beginPath(); trace(arcPts(e.x, e.y, R * 1.15, 0, TAU, 0.05), true);
      ctx.strokeStyle = P.goldHi; ctx.lineWidth = 2 * d; ctx.stroke();
    }
    if (e.stealth) ctx.globalAlpha = e.revealed ? 0.85 : 0.25;
    if (e.markT > 0) {
      // lit by a Searchlight: a small cream star above it; crimson when Designated (every tower's first pick)
      const q = proj(e.x, e.y, H + 0.42), r = (e.designT > 0 ? 0.1 : 0.07) * u;
      A.diamond(ctx, q.x, q.y, r * 0.55, r * 1.2); ctx.fillStyle = e.designT > 0 ? C.ARCH.precision.color : 'rgba(255, 246, 214, 0.9)'; ctx.fill();
      A.diamond(ctx, q.x, q.y, r * 1.2, r * 0.45); ctx.fill();
    }
    if (e.spotterT > 0) {
      // Forward Observer: verdigris range ticks round it, so towers reaching it from afar read
      ctx.save(); ctx.globalAlpha = 0.85; ctx.strokeStyle = C.ARCH.engineering.color; ctx.lineWidth = 1.6 * d;
      for (let k = 0; k < 3; k++) { const a0 = time * 2 + (k * TAU) / 3; ctx.beginPath(); trace(arcPts(e.x, e.y, R * 1.35, a0, a0 + 1.2, 0.05)); ctx.stroke(); }
      ctx.restore();
    } else if (e.stealth && e.spotT > 0.3) {
      // kept revealed by an Observer's lingering light
      ctx.save(); ctx.globalAlpha = 0.6; ctx.setLineDash([2 * d, 3 * d]); ctx.strokeStyle = C.ARCH.engineering.color; ctx.lineWidth = 1.2 * d;
      ctx.beginPath(); trace(arcPts(e.x, e.y, R * 1.25, 0, TAU, 0.05), true); ctx.stroke(); ctx.restore();
    }
    if (e.aegis > 0) {
      const q = proj(e.x, e.y, H * 0.6);
      ctx.beginPath(); ctx.arc(q.x, q.y, (s + 0.2) * u, Math.PI * 1.05, Math.PI * 1.95); ctx.strokeStyle = 'rgba(243, 216, 138, 0.7)'; ctx.lineWidth = 1.4 * d; ctx.stroke();
    }
    if (e.baffle > 0) {
      // shielded by a Baffle Drone: a small teal shield at its left shoulder (far shots are cut)
      const q = proj(e.x, e.y, H * 0.6);
      shieldMark(q.x - (s + 0.22) * u, q.y - 0.04 * u, 0.075 * u, d);
    }
    if (e.gov > 0) {
      // governed: a little lilac gauge at its right shoulder, the needle pinned (slow and stun only half take)
      const q = proj(e.x, e.y, H * 0.6);
      gaugeMark(q.x + (s + 0.22) * u, q.y, 0.08 * u, d, time + e.id);
    }
    if (e.chillT > 0) { ctx.beginPath(); trace(arcPts(e.x, e.y, R * 0.9), true); ctx.fillStyle = 'rgba(216, 236, 240, 0.3)'; ctx.fill(); }
    const mid = proj(e.x, e.y, H * 0.55), top = proj(e.x, e.y, H + 0.2);
    if (e.hitFlash > 0) light(mid.x, mid.y, (s + 0.25) * u, P.cream, 0.7);
    if (e.boss) light(mid.x, mid.y, 0.8 * u, P.ember, 0.3 + 0.1 * Math.sin(time * 5));
    if (e.burnT > 0) light(mid.x, mid.y - 0.1 * u, (0.35 + 0.1 * Math.sin(time * 14 + e.id)) * u, P.ember, 0.75);
    if (e.jamT > 0) {
      // jammed: a flickering steel-blue zigzag across the robot
      ctx.beginPath(); ctx.moveTo(mid.x - (s + 0.2) * u, mid.y);
      for (let k = 1; k <= 4; k++) ctx.lineTo(mid.x - (s + 0.2) * u + (k / 4) * 2 * (s + 0.2) * u, mid.y + (k % 2 ? -1 : 1) * 0.08 * u * (0.6 + 0.4 * Math.sin(time * 30 + k)));
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 20 + e.id); ctx.strokeStyle = P.steel; ctx.lineWidth = 1.6 * d; ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (e.doomT > 0) {
      // Last Hour's brand: a crimson dial above the robot that empties as the brand runs down
      const q = proj(e.x, e.y, H + 0.55), r = 0.13 * u, k = e.doomT / (e.doomMax || 1);
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, TAU); ctx.fillStyle = 'rgba(7, 10, 18, 0.7)'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.arc(q.x, q.y, r, -Math.PI / 2, -Math.PI / 2 + k * TAU); ctx.closePath();
      ctx.fillStyle = C.ARCH.precision.color; ctx.fill();
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, TAU); ctx.strokeStyle = P.coral; ctx.lineWidth = 1.2 * d; ctx.stroke();
    }
    if (e.stasisT > 0) {
      // Stasis: a lilac glow that swells with the damage banked
      const b = Math.min(1, e.bank / Math.max(1, e.maxHp));
      light(mid.x, mid.y, (s + 0.3 + 0.4 * b) * u, P.lilac, 0.5 + 0.4 * b);
    }
    if (e.wanted) {
      // Wanted: a gold coin with a crimson rim over the marked robot, spinning
      const q = proj(e.x, e.y, H + 0.7), r = 0.12 * u, sq = Math.abs(Math.cos(time * 3 + e.id));
      ctx.beginPath(); ctx.ellipse(q.x, q.y, r * Math.max(0.15, sq), r, 0, 0, TAU); ctx.fillStyle = P.goldHi; ctx.fill();
      ctx.strokeStyle = C.ARCH.precision.color; ctx.lineWidth = 1.6 * d; ctx.stroke();
      light(q.x, q.y, 0.35 * u, P.goldHi, 0.5);
    }
    // stunned: gold diamonds circling; stopped by Midnight: ice ones that hang still
    if (e.stunT > 0) for (let k = 0; k < 3; k++) { const a = (e.stopT > 0 ? 0.5 : time * 6) + (k * TAU) / 3; A.diamond(ctx, top.x + Math.cos(a) * 0.22 * u, top.y + 0.08 * u + Math.sin(a) * 0.07 * u, 0.05 * u); ctx.fillStyle = e.stopT > 0 ? P.ice : P.goldHi; ctx.fill(); }
    ctx.restore();
    if (e.hp < e.maxHp) {
      const w = Math.max(0.5, s * 2.2) * u, h = Math.max(3 * d, 0.07 * u), hx = top.x - w / 2, hy = top.y - h;
      rect(hx - d, hy - d, w + 2 * d, h + 2 * d, P.ink);
      rect(hx, hy, Math.max(1, w * e.hp / e.maxHp), h, e.hp / e.maxHp > 0.4 ? P.cream : P.ember);
      // steel frame = armored, gold = not
      ctx.strokeStyle = e.armor > 0 ? '#c4c9d6' : 'rgba(212, 175, 90, 0.75)'; ctx.lineWidth = (e.armor > 0 ? 1.6 : 0.8) * d;
      ctx.strokeRect(hx - d, hy - d, w + 2 * d, h + 2 * d);
    }
  }

  // Steam drifting up from the rooftops and the hotter towers. Purely decorative, runs in real time.
  const steam = [];
  let steamLast = 0;
  function updateSteam(now) {
    const dt = Math.min(0.1, (now - (steamLast || now)) / 1000);
    steamLast = now;
    if (reduceMotion) { steam.length = 0; return; }
    const emit = (x, y, h, big) => {
      if (steam.length > 90) return;
      const life = 4 + Math.random() * 3;
      steam.push({ x, y, h, vx: 3 + Math.random() * 4, vh: 0.16 + Math.random() * 0.14, r: big ? 0.2 : 0.13, grow: 0.09 + Math.random() * 0.06, life, max: life });
    };
    for (const c of chimneys) if (Math.random() < dt * 0.09) emit(c.x, c.y, c.h, false);
    for (const c of gateChimneys) if (Math.random() < dt * 0.4) emit(c.x, c.y, c.h, true);
    for (const t of state.towers) if ((t.key === 'flame' || t.key === 'frost' || t.key === 'cannon') && Math.random() < dt * 0.35) emit(t.x, t.y, 1.1, true);
    for (const p of steam) { p.x += p.vx * dt; p.h += p.vh * dt; p.r += p.grow * dt; p.life -= dt; }
    for (let i = steam.length - 1; i >= 0; i--) if (steam[i].life <= 0) steam.splice(i, 1);
  }

  // ---------- shots: flying things, depth-tested in the 3D scene ----------
  // Shots, muzzle flashes, sparks and steam start at or fly past towers, so the flat overlay would paint them over
  // whatever stands in front. They are quads in the scene instead and the depth buffer clips them per pixel. The
  // corners are worked out in screen pixels like the overlay's marks (the vertex shader passes them through), and
  // all of them share one buffer, so the whole layer is one draw call.
  const SHOT_MAX = 4096, SHOT_STRIDE = 12; // x y z, along across, length radius glow, r g b a
  const shotData = new THREE.InterleavedBuffer(new Float32Array(SHOT_MAX * 6 * SHOT_STRIDE), SHOT_STRIDE).setUsage(THREE.DynamicDrawUsage);
  const shotGeo = new THREE.BufferGeometry();
  [['position', 3, 0], ['aAt', 2, 3], ['aForm', 3, 5], ['aColor', 4, 8]].forEach(([name, n, off]) => shotGeo.setAttribute(name, new THREE.InterleavedBufferAttribute(shotData, n, off)));
  const shotMesh = new THREE.Mesh(shotGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'attribute vec2 aAt; attribute vec3 aForm; attribute vec4 aColor; varying vec2 vAt; varying vec3 vForm; varying vec4 vColor; void main(){ vAt = aAt; vForm = aForm; vColor = aColor; gl_Position = vec4(position, 1.0); }',
    // a capsule (round-capped line, or a dot) with a one-pixel soft edge; glows fall off like the overlay's sprite
    fragmentShader: `varying vec2 vAt; varying vec3 vForm; varying vec4 vColor;
      void main(){
        float d = length(vec2(vAt.x - clamp(vAt.x, 0.0, vForm.x), vAt.y)), k = d / vForm.y;
        float a = vForm.z > 0.5 ? (k < 0.35 ? mix(1.0, 0.533, k / 0.35) : 0.533 * clamp((1.0 - k) / 0.65, 0.0, 1.0)) : clamp(vForm.y - d + 0.5, 0.0, 1.0);
        a *= vColor.a;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor.rgb, a);
      }`,
  }));
  shotMesh.frustumCulled = false; shotMesh.renderOrder = 10; // after the see-through ground
  scene.add(shotMesh); // not in `world`: these are not reflected
  let shotN = 0;
  const rgbCache = new Map();
  function rgb(hex) {
    let c = rgbCache.get(hex);
    if (!c) { const n = parseInt(hex.slice(1), 16); c = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; rgbCache.set(hex, c); }
    return c;
  }
  // map point [px, py, h] -> overlay pixels plus depth
  function shotPt(px, py, h) {
    _v.set(px / T, h, py / T).project(camera);
    return { x: (_v.x * 0.5 + 0.5) * view.w, y: (0.5 - _v.y * 0.5) * view.h, z: _v.z };
  }
  // One capsule from a to b with radius r (pixels), the colour and alpha running from end a to end b.
  function shotQuad(a, b, r, ca, aa, cb, ab, glow) {
    if (shotN >= SHOT_MAX || r <= 0 || (aa <= 0 && ab <= 0)) return;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), ux = len ? dx / len : 1, uy = len ? dy / len : 0;
    const R = r + 1, arr = shotData.array;
    let o = shotN++ * 6 * SHOT_STRIDE;
    for (const [end, side] of [[0, -1], [1, -1], [1, 1], [0, -1], [1, 1], [0, 1]]) {
      const p = end ? b : a, c = end ? cb : ca, out = end ? R : -R;
      const x = p.x + ux * out - uy * side * R, y = p.y + uy * out + ux * side * R;
      arr[o++] = (x / view.w) * 2 - 1; arr[o++] = 1 - (y / view.h) * 2; arr[o++] = p.z;
      arr[o++] = end ? len + R : -R; arr[o++] = side * R;
      arr[o++] = len; arr[o++] = r; arr[o++] = glow ? 1 : 0;
      arr[o++] = c[0]; arr[o++] = c[1]; arr[o++] = c[2]; arr[o++] = end ? ab : aa;
    }
  }
  const shotLine = (a, b, w, color, alpha) => shotQuad(a, b, w / 2, rgb(color), alpha, rgb(color), alpha);
  const shotDot = (q, r, color, alpha = 1) => shotQuad(q, q, r, rgb(color), alpha, rgb(color), alpha);
  const shotGlow = (q, r, color, alpha) => shotQuad(q, q, r, rgb(color), alpha, rgb(color), alpha, true);

  function buildShots(now) {
    const u = view.ppt, d = view.dpr;
    shotN = 0;
    updateSteam(now);
    for (const t of state.towers) {
      const m = towerMeshes.get(t.id), mz = m && m.userData.muzzle;
      if (mz && mz.flash !== false && t.flash > 0) shotGlow(shotPt(t.x + Math.cos(t.aim) * mz.r * T, t.y + Math.sin(t.aim) * mz.r * T, baseY(t) + mz.h), 0.7 * u, P.lantern, 0.9);
    }
    for (const p of state.projectiles) {
      if (p.target && !p.target.dead) p.h1 = aimHeight(p.target);
      // The shot is simulated from the tower's centre; drawn, it leaves the muzzle and the offset closes in flight.
      const at = (k) => {
        k = clamp(k, 0, 1);
        const back = (clamp(p.traveled / Math.max(1, p.total), 0, 1) - k) * p.total;
        const dd = Math.max(1, dist(p.x, p.y, p.tx, p.ty)), ux = (p.tx - p.x) / dd, uy = (p.ty - p.y) / dd;
        const h = p.h0 + (p.h1 - p.h0) * k + (p.kind === 'splash' ? Math.sin(k * Math.PI) * (p.arc ? 1.7 : 0.45) : 0);
        return shotPt(p.x - ux * back + p.ox * (1 - k), p.y - uy * back + p.oy * (1 - k), h);
      };
      const k = clamp(p.traveled / Math.max(1, p.total), 0, 1), q = at(k);
      if (p.kind === 'splash') {
        const r = 0.11 * u;
        shotDot(q, r + d / 2, P.gold);
        shotDot(q, r - d / 2, P.gunmetal);
        continue;
      }
      // A rivet: a red-hot slug with a heat streak behind it. The Spike Driver's spike is longer and white-hot;
      // the Riveter's rivets are small.
      const spike = p.style === 'spike', len = (spike ? 0.3 : p.style === 'rapid' ? 0.1 : 0.14) * T, perK = len / Math.max(1, p.total);
      const b = at(k - perK), tail = at(k - perK * (spike ? 5 : 4));
      if (Math.hypot(q.x - b.x, q.y - b.y) < 0.5) continue;
      const hot = spike ? '#fff4d6' : P.lantern, w = (spike ? 0.06 : p.style === 'rapid' ? 0.05 : 0.065) * u;
      shotQuad(tail, q, w * 0.4, rgb(P.ember), 0, rgb(spike ? '#ffcf73' : '#ff783c'), spike ? 0.6 : 0.45);
      shotGlow(q, (spike ? 0.3 : 0.2) * u, P.ember, 0.7);
      shotLine(b, q, Math.max(2 * d, w), P.emberHi, 1);
      shotLine(b, q, Math.max(d, w * 0.45), hot, 1);
    }
    for (const f of state.effects) {
      const k = f.life / f.max;
      if (f.type === 'nail') {
        // a short gold dart flying from its port to the robot; a Fusillade load is whiter and longer
        const run = Math.min(1, (1 - k) * 1.5), tail = Math.max(0, run - 0.35);
        const at = (m) => shotPt(f.x0 + (f.x1 - f.x0) * m, f.y0 + (f.y1 - f.y0) * m, f.h0 + (f.h1 - f.h0) * m);
        const a = at(tail), b = at(run);
        shotLine(a, b, Math.max(1.6 * d, 0.045 * u * (f.big ? 1.4 : 1) * (1 + 0.3 * (f.n || 0))), f.n ? P.emberHi : P.goldHi, 0.5);
        shotLine(a, b, Math.max(d, 0.018 * u), f.big ? '#ffffff' : P.cream, 0.95);
      } else if (f.type === 'puff') {
        // a dense white burst that billows out and thins as it rises
        const q = shotPt(f.x, f.y, f.h), age = 1 - k, a = Math.pow(k, 1.3) * Math.min(1, age / 0.06);
        shotGlow(q, (0.12 + 0.42 * age) * u * f.s, P.cream, 0.75 * a);
        if (age < 0.4) shotGlow(q, (0.06 + 0.18 * age) * u * f.s, '#ffffff', 0.6 * a);
      } else if (f.type === 'spark') {
        // a short streak along its motion, so sparks read as flying rather than as dots
        const q = shotPt(f.x, f.y, f.h), b = shotPt(f.x - f.vx * 0.03, f.y - f.vy * 0.03, f.h - f.vh * 0.03);
        shotLine(b, q, Math.max(1.2 * d, 0.03 * u), f.color, clamp(k * 1.6, 0, 1));
      }
    }
    for (const p of steam) shotGlow(shotPt(p.x, p.y, p.h), p.r * 1.7 * u, P.cream, 0.16 * Math.sin(Math.PI * (1 - p.life / p.max)));
    shotMesh.visible = shotN > 0;
    shotGeo.setDrawRange(0, shotN * 6);
    shotData.updateRange.count = shotN * 6 * SHOT_STRIDE;
    shotData.needsUpdate = true;
  }

  // ---------- frame ----------
  const REFL_ROBOTS_MAX = 40, reflHid = [];
  function render() {
    const now = performance.now();
    easeCamera(now);
    const ghost = syncScene();
    // Pass 1: the city upside down, faded with height, into a half-res target. It is blurred (wide, then stretched
    // vertically so neon streaks) and drawn as the backdrop. Pass 2: the see-through ground and the real city on top.
    M3.REFL.uRefl.value = 1;
    gl.setRenderTarget(reflA);
    gl.setClearColor(0x0a0f22, 1); gl.clear();
    groundMesh.visible = outerGround.visible = decalMesh.visible = false;
    // The reflection is blurred past recognition, but it redraws every mesh in the city. In a crowd the robots
    // (hundreds of meshes) are left out of it; the main pass still draws them.
    const skipRobots = enemyMeshes.size > REFL_ROBOTS_MAX;
    if (skipRobots) { reflHid.length = 0; for (const m of enemyMeshes.values()) { reflHid.push(m.visible); m.visible = false; } }
    shotMesh.visible = false;
    world.scale.y = -1; gl.render(scene, camera); world.scale.y = 1;
    if (skipRobots) { let i = 0; for (const m of enemyMeshes.values()) m.visible = reflHid[i++]; }
    M3.REFL.uRefl.value = 0;
    blurMat.uniforms.tSrc.value = reflA.texture; blurMat.uniforms.uDir.value.set(reflTexel.x, 0);
    gl.setRenderTarget(reflB); gl.render(quadScene, quadCam);
    blurMat.uniforms.tSrc.value = reflB.texture; blurMat.uniforms.uDir.value.set(0, reflTexel.y * tune.streak);
    // with the polish on, the frame goes to an offscreen target and the post pass puts it on the canvas
    const fin = post.on ? post.scene : null;
    gl.setRenderTarget(fin);
    if (fin) backMesh.visible = true; else gl.render(quadScene, quadCam);
    gl.clearDepth();
    groundMesh.visible = outerGround.visible = decalMesh.visible = true;
    paintDecal(now);
    buildShots(now);
    gl.render(scene, camera);
    if (fin) { backMesh.visible = false; runPost(now); postWatch(now); }
    drawOverlay(now, ghost);
  }

  function drawOverlay(now, ghost) {
    const u = view.ppt, d = view.dpr, time = state.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.lineJoin = 'round';

    if (state.build) {
      ctx.save(); ctx.strokeStyle = 'rgba(212, 175, 90, 0.16)'; ctx.lineWidth = d;
      ctx.beginPath();
      for (let x = 1; x < COLS; x++) trace([[x * T, 0, 0.02], [x * T, ROWS * T, 0.02]]);
      for (let y = 1; y < ROWS; y++) trace([[0, y * T, 0.02], [COLS * T, y * T, 0.02]]);
      ctx.stroke(); ctx.restore();
    }
    // gates: lamps (the ember chevrons marching in from the spawn are on the road decal)
    for (const g of gates) {
      const cs = Math.cos(g.ang), sn = Math.sin(g.ang);
      const lamp = g.exit ? 0.3 + 0.7 * Math.max(0, state.lives) / maxLives() : 1;
      for (const side of [-1, 1]) { if (hidden(g.x - sn * side * T, g.y + cs * side * T, 1.3)) continue; const q = proj(g.x - sn * side * T, g.y + cs * side * T, 1.3); light(q.x, q.y, (0.55 + 0.05 * Math.sin(time * 3 + side)) * u * lamp, g.exit ? P.lantern : P.ember, 0.8); }
      if (g.exit && g.coils) {
        // local (x, h, z) on the building to [px, py, h] on the map
        const at = ([lx, ly, lz]) => [g.x + cs * lx * T - sn * lz * T, g.y + sn * lx * T + cs * lz * T, ly];
        const [c1, c2] = g.coils.map(at);
        // a leak: the robot plugs in under the arch and the charge jumps from both coils into it
        if (g.flash > 0) for (const c of [c1, c2]) arc(at([0.5, 0.5, 0]), c, g.flash);
        // idle: the coils crackle at each other while the city still has power
        else if (state.lives > 0 && Math.random() < 0.04) arc(c1, c2, 0.45);
      }
    }

    // ripples on each pool: three rings expanding over 4 s, fading out
    // clipped to the pool's own cells: an irregular pool must not ring onto the floor around it
    for (const p of poolsOnMap) {
      ctx.save(); ctx.beginPath();
      for (const [cx, cy] of p.cells) trace(cellQuad(cx, cy, 0.03), true);
      ctx.clip();
      for (let k = 0; k < 3; k++) {
        const ph = (time / 4 + k / 3) % 1;
        ctx.beginPath(); trace(arcPts(p.cx * T, p.cz * T, (p.r0 + ph * (p.r1 - p.r0)) * T, 0, TAU, 0.03), true);
        ctx.strokeStyle = `rgba(46, 230, 207, ${(1 - ph) * 0.28})`; ctx.lineWidth = 1.2 * d; ctx.stroke();
      }
      ctx.restore();
    }

    const sel = state.selected && state.selected.kind === 'tower' ? state.selected.tower : null;
    if (sel) {
      // a path tower's ring takes its main path's colour
      const acc = towerAccent(sel);
      drawRangeShape(sel.key, sel.s, sel.x, sel.y, sel.dir, acc ? hexA(acc.color, 0.9) : 'rgba(243, 216, 138, 0.8)', acc ? hexA(acc.color, 0.1) : 'rgba(212, 175, 90, 0.08)');
      drawLinks(sel, sel.cells, sel);
      ctx.save(); ctx.strokeStyle = P.goldHi; ctx.lineWidth = 2 * d;
      for (const [cx, cy] of sel.cells) { ctx.beginPath(); trace(cellQuad(cx, cy, baseY(sel) + 0.09, 0.8), true); ctx.stroke(); }
      ctx.restore();
    }
    if (state.selected && state.selected.kind === 'tile') {
      ctx.save(); ctx.strokeStyle = P.goldHi; ctx.lineWidth = 2 * d;
      ctx.beginPath(); trace(cellQuad(state.selected.x, state.selected.y, 0.03, 0.8), true); ctx.stroke(); ctx.restore();
    }
    for (const t of state.towers) drawTowerMarks(t, u, d, time);
    drawFocusLinks(u, d, time);
    drawMines(u, d, time, false);
    drawRobotLinks(u, d, time);
    for (const t of state.towers) if (t.def.kind === 'light') drawSearchBeam(t, u, d);
    for (const e of state.enemies) drawEnemyMarks(e, u, d, time);

    // prism beams: width and brightness follow the charge
    for (const t of state.towers) {
      if (t.key !== 'prism' || !t.beams || !t.beams.length) continue;
      const m = towerMeshes.get(t.id), a = proj(t.x, t.y, baseY(t) + (m ? m.userData.light.h : 3));
      t.beams.forEach((e, i) => {
        if (e.dead) return;
        const k = (t.beamK && t.beamK[i]) || 0, em = enemyMeshes.get(e.id), b = proj(e.x, e.y, em ? em.userData.h * 0.55 : 0.4);
        ctx.save();
        ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(185, 162, 230, 0.5)'; ctx.lineWidth = (0.1 + 0.2 * k) * u;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = k > 0.95 ? '#ffffff' : P.cream; ctx.lineWidth = (0.03 + 0.06 * k) * u;
        ctx.stroke();
        ctx.restore();
        light(b.x, b.y, (0.3 + 0.3 * k) * u, P.lilac, 0.7);
      });
    }

    for (const f of state.effects) {
      const k = f.life / f.max;
      ctx.save();
      if (f.type === 'ring') {
        const R = f.r0 + (f.r1 - f.r0) * (1 - k);
        ctx.globalAlpha = k * 0.9; ctx.strokeStyle = f.color; ctx.lineWidth = 2.2 * d;
        ctx.beginPath(); trace(arcPts(f.x, f.y, R, 0, TAU, 0.06), true); ctx.stroke();
        ctx.globalAlpha = k * 0.4; ctx.lineWidth = d;
        ctx.beginPath(); trace(arcPts(f.x, f.y, R * 0.86, 0, TAU, 0.06), true); ctx.stroke();
      } else if (f.type === 'midnight') {
        // time stopped: a cold dial on the ground, its hands at twelve, fading in fast and out over the last second
        const fade = Math.min(1, (1 - k) * f.max * 4, f.life), pts = arcPts(f.x, f.y, f.R, 0, TAU, 0.05);
        ctx.globalAlpha = 0.22 * fade; ctx.fillStyle = '#9fb8e8';
        ctx.beginPath(); trace(pts, true); ctx.fill();
        ctx.globalAlpha = 0.7 * fade; ctx.strokeStyle = P.ice; ctx.lineWidth = 2 * d;
        ctx.beginPath(); trace(pts, true); ctx.stroke();
        ctx.lineWidth = 1.4 * d;
        for (let h = 0; h < 12; h++) {
          const a = (h / 12) * TAU, r0 = f.R * (h % 3 ? 0.93 : 0.86), i = proj(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0, 0.05), o = proj(f.x + Math.cos(a) * f.R, f.y + Math.sin(a) * f.R, 0.05);
          ctx.beginPath(); ctx.moveTo(i.x, i.y); ctx.lineTo(o.x, o.y); ctx.stroke();
        }
        const c = proj(f.x, f.y, 0.05), up = (r) => proj(f.x, f.y - r, 0.05);
        ctx.lineWidth = 3 * d; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(up(f.R * 0.5).x, up(f.R * 0.5).y); ctx.stroke();
        ctx.lineWidth = 1.6 * d; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(up(f.R * 0.78).x, up(f.R * 0.78).y); ctx.stroke();
      } else if (f.type === 'flash') {
        const q = proj(f.x, f.y, 0.2), age = 1 - k;
        ctx.globalCompositeOperation = 'lighter';
        A.glow(ctx, q.x, q.y, (0.35 + age * 0.9) * (f.R / T) * u, P.goldHi, 0.8 * k);
        A.glow(ctx, q.x, q.y, (0.18 + age * 0.3) * (f.R / T) * u, '#ffffff', 0.9 * k * k);
      } else if (f.type === 'scorch') {
        ctx.globalAlpha = Math.min(1, k * 1.6) * 0.5;
        ctx.beginPath(); trace(arcPts(f.x, f.y, f.R * (1.1 - 0.2 * k), 0, TAU, 0.035), true); ctx.fillStyle = P.ink; ctx.fill();
        ctx.globalAlpha = k * 0.6; ctx.strokeStyle = f.fire ? P.ember : P.goldLo; ctx.lineWidth = 1.5 * d; ctx.stroke();
      } else if (f.type === 'bolt') {
        // the bolt leaps from the coil's sphere down to the first robot, then runs between them
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath(); trace(f.pts.map((p, i) => [p.x, p.y, i < 4 ? f.h0 + (0.45 - f.h0) * (i / 4) : 0.45]));
        const w = f.big ? 2.2 : 1;
        ctx.globalAlpha = k * 0.5; ctx.strokeStyle = P.goldHi; ctx.lineWidth = 0.16 * u * w; ctx.stroke();
        ctx.globalAlpha = k; ctx.strokeStyle = P.cream; ctx.lineWidth = 0.05 * u * w; ctx.stroke();
      } else if (f.type === 'tracer') {
        // Sentinel Rifle: a short streak ending at the hit, not a map-long line; it shrinks toward the hit as it fades
        const a = [f.x0, f.y0, f.h0], b = [f.x1, f.y1, f.h1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, m = 1 - Math.min(1, (2.5 * T) / len) * k;
        const from = [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
        const w = f.big ? 1.4 : 1;
        ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        ctx.beginPath(); trace([from, b]);
        ctx.globalAlpha = k * 0.4; ctx.strokeStyle = f.color; ctx.lineWidth = Math.max(1.5 * d, 0.05 * u * w); ctx.stroke();
        ctx.globalAlpha = k * 0.85; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(d, 0.018 * u * w); ctx.stroke();
        const q = proj(b[0], b[1], b[2]);
        A.glow(ctx, q.x, q.y, 0.14 * u * w, f.color, 0.6 * k);
      } else if (f.type === 'rope') {
        // Troop Balloon drop: a dashed line from the balloon down to where a trooper lands
        const a = proj(f.x0, f.y0, f.h0), b = proj(f.x1, f.y1, 0);
        ctx.setLineDash([0.12 * u, 0.08 * u]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.globalAlpha = Math.min(1, k * 1.5) * 0.8; ctx.strokeStyle = P.cream; ctx.lineWidth = Math.max(1.2 * d, 0.025 * u); ctx.stroke();
        ctx.setLineDash([]);
      } else if (f.type === 'rail') {
        drawRail(f, k, u, d);
      } else if (f.type === 'fire') {
        drawFire(f, k, u);
      } else if (f.type === 'px') {
        const q = proj(f.x, f.y, 0.3 + (1 - k) * 0.35), r = (f.size / 34) * u;
        ctx.globalAlpha = clamp(k * 1.5, 0, 1);
        A.diamond(ctx, q.x, q.y, r * 0.75, r); ctx.fillStyle = f.color; ctx.fill();
      } else if (f.type === 'text') {
        const q = proj(f.x, f.y, 1.1);
        ctx.globalAlpha = clamp(k * 2, 0, 1); ctx.font = `600 ${13 * d}px ${UI_FONT}`; ctx.textAlign = 'center';
        ctx.fillStyle = P.ink; ctx.fillText(f.txt, q.x + d, q.y + d); ctx.fillStyle = f.color; ctx.fillText(f.txt, q.x, q.y);
      }
      ctx.restore();
    }

    if (ghost) drawGhost(ghost);
    else if (state.hover && !state.build) drawTerrainHint();
  }

  // In-world hint for special terrain, so the map explains itself without a legend.
  // The third entry is the line on maps with lots, where open ground is unbuildable anyway and 'cannot build' says nothing.
  const HINTS = {
    hill: ['Terrace', 'High ground · +30% tower range', 'High ground · +30% tower range'],
    forest: ['Tenements', 'Blocks sight · cannot build', 'Blocks sight'],
    rock: ['Monolith', 'Cannot build', ''],
    water: ['Reflecting pool', 'Cannot build', ''],
  };
  // A small Deco plaque: navy, gold rule, gold title. Sizes are in overlay pixels.
  function plaque(x, y, w, h) {
    const d = view.dpr;
    ctx.fillStyle = 'rgba(9, 14, 30, 0.92)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = P.gold; ctx.lineWidth = d; ctx.strokeRect(x + 0.5 * d, y + 0.5 * d, w - d, h - d);
    ctx.strokeStyle = 'rgba(212, 175, 90, 0.3)'; ctx.lineWidth = 0.6 * d; ctx.strokeRect(x + 3 * d, y + 3 * d, w - 6 * d, h - 6 * d);
  }
  function drawTerrainHint() {
    const tx = Math.floor(state.hover.px / T), ty = Math.floor(state.hover.py / T);
    if (!inBounds(tx, ty) || state.occ[ty][tx]) return;
    const h = HINTS[grid[ty][tx]];
    if (!h) return;
    const d = view.dpr, at = proj(state.hover.px, state.hover.py);
    ctx.save();
    const t0 = h[0].toUpperCase().split('').join(String.fromCharCode(8202));
    ctx.font = `600 ${11 * d}px ${UI_FONT}`;
    const w0 = ctx.measureText(t0).width, sub = h[restricted ? 2 : 1], ph = (sub ? 40 : 25) * d;
    ctx.font = `400 ${12 * d}px ${UI_FONT}`;
    const w = Math.max(w0, ctx.measureText(sub).width) + 20 * d;
    const x = clamp(at.x + 16 * d, 2, view.w - w - 2), y = clamp(at.y + 16 * d, 2, view.h - ph - 2 * d);
    plaque(x, y, w, ph);
    ctx.font = `600 ${11 * d}px ${UI_FONT}`; ctx.fillStyle = P.goldHi; ctx.fillText(t0, x + 10 * d, y + 16 * d);
    if (sub) { ctx.font = `400 ${12 * d}px ${UI_FONT}`; ctx.fillStyle = P.cream; ctx.fillText(sub, x + 10 * d, y + 32 * d); }
    ctx.restore();
  }

  // Lines from a tower to the neighbours that change its stats; Grid's reached towers get a thinner amber line.
  function drawLinks(t, cells, self) {
    const nbs = neighborsOfCells(cells, self);
    const c = cellsCenter(cells), d = view.dpr;
    const line = (n, color, w) => { ctx.strokeStyle = color; ctx.lineWidth = w * d; ctx.beginPath(); trace([[c.x, c.y, 0.12], [n.x, n.y, 0.12]]); ctx.stroke(); };
    ctx.save(); ctx.setLineDash([4 * d, 4 * d]);
    for (const n of nbs) {
      if ((n.key === 'amp') !== (t.key === 'amp')) line(n, P.goldHi, 2.2);
      if ((t.key === 'frost' && n.key === 'flame') || (t.key === 'flame' && n.key === 'frost')) line(n, P.ember, 2.2);
    }
    if (t.key === 'amp' && self) { for (const [n, k] of ampTargets(t)) if (k < 1) line(n, C.ARCH.barrage.color, 1.4); }
    else if (t.key !== 'amp') for (const a of state.towers) {
      if (a.key === 'amp' && !nbs.includes(a) && inReach(baseStats(a), a.cells, cells)) line(a, C.ARCH.barrage.color, 1.4);
    }
    ctx.restore();
  }
  // Overclock: a crimson link from each Amplifier to the tower it focuses, pulsing hard while Overdrive runs.
  function drawFocusLinks(u, d, time) {
    for (const a of state.towers) {
      if (a.key !== 'amp' || a.disabledT > 0 || !a.s || !a.s.focus) continue;
      const f = ampFocus(a);
      if (!f) continue;
      const on = overdriveOn(a, a.s), od = !!a.s.overdrive && on;
      ctx.save();
      ctx.globalAlpha = on ? (od ? 0.65 + 0.35 * Math.sin(time * 10) : 0.7) : 0.25;
      ctx.strokeStyle = C.ARCH.precision.color; ctx.lineWidth = (od ? 3 : 1.8) * d; ctx.lineCap = 'round';
      ctx.setLineDash([2 * d, 4 * d]); ctx.lineDashOffset = -time * 24 * d;
      ctx.beginPath(); trace([[a.x, a.y, 0.6], [f.x, f.y, 0.6]]); ctx.stroke();
      ctx.restore();
      if (on && !hidden(f.x, f.y, baseY(f) + 0.3)) { const q = proj(f.x, f.y, baseY(f) + 0.3); light(q.x, q.y, (od ? 0.75 : 0.45) * u, C.ARCH.precision.color, od ? 0.55 : 0.3); }
    }
  }

  // While building, the kerb of any terrace the footprint touches lights up, so its edge is plain to see.
  function drawTerraceEdges(cells) {
    const seen = new Set(), stack = [];
    for (const [x, y] of cells) if (inBounds(x, y) && grid[y][x] === 'hill' && !seen.has(y * COLS + x)) { seen.add(y * COLS + x); stack.push([x, y]); }
    if (!stack.length) return;
    const isHill = (x, y) => inBounds(x, y) && grid[y][x] === 'hill', h = HILL_H + 0.01, segs = [];
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (isHill(nx, ny)) { if (!seen.has(ny * COLS + nx)) { seen.add(ny * COLS + nx); stack.push([nx, ny]); } continue; }
        // the cell's side facing (dx, dy)
        const ax = dx > 0 ? x + 1 : x, ay = dy > 0 ? y + 1 : y;
        segs.push(dx ? [[ax * T, y * T, h], [ax * T, (y + 1) * T, h]] : [[x * T, ay * T, h], [(x + 1) * T, ay * T, h]]);
      }
    }
    ctx.save(); ctx.lineCap = 'round';
    for (const [w, a] of [[7, 0.18], [2.2, 0.95]]) {
      ctx.beginPath(); for (const sg of segs) trace(sg, false);
      ctx.lineWidth = w * view.dpr; ctx.strokeStyle = `rgba(46, 230, 207, ${a})`; ctx.stroke();
    }
    ctx.restore();
  }

  function ghostInfo() {
    const key = state.build;
    const cells0 = footprint(key, state.dir);
    const [ax, ay] = anchorFor(cells0, state.hover.px, state.hover.py);
    const cells = cells0.map(([x, y]) => [x + ax, y + ay]);
    const problems = footProblems(cells, key);
    const c = cellsCenter(cells);
    const fake = { key, cells, dir: state.dir, x: c.x, y: c.y, pips: freshPips(), pathOrder: [], aim: startAim(key, state.dir, c.x, c.y) };
    const s = computeStats(fake, cells, neighborsOfCells(cells, null));
    fake.s = s; fake.flash = 0;
    if (problems[0] === 'terrace edge') s.notes = [{ txt: 'Build fully on the terrace or off it', good: false }];
    return { key, cells, problems, ok: problems.every((p) => !p) && state.gold >= TW[key].cost, c, s, fake, ax, ay };
  }

  function drawGhost(g) {
    const d = view.dpr;
    drawTerraceEdges(g.cells);
    drawRangeShape(g.key, g.s, g.c.x, g.c.y, state.dir, g.ok ? 'rgba(243, 216, 138, 0.85)' : 'rgba(255, 110, 70, 0.85)', g.ok ? 'rgba(212, 175, 90, 0.08)' : 'rgba(255, 90, 46, 0.08)');
    const afford = state.gold >= TW[g.key].cost;
    g.cells.forEach(([x, y], i) => {
      const col = g.problems[i] ? P.ember : afford ? P.goldHi : P.creamDim;
      ctx.save();
      ctx.beginPath(); trace(cellQuad(x, y, 0.04), true);
      ctx.globalAlpha = 0.3; ctx.fillStyle = col; ctx.fill();
      ctx.globalAlpha = 0.95; ctx.strokeStyle = col; ctx.lineWidth = 1.4 * d; ctx.stroke();
      ctx.restore();
    });
    drawLinks(g.fake, g.cells, null);
    // bonus label
    if (g.s.notes.length) {
      const at = proj(g.c.x, g.c.y, 1.2);
      ctx.save(); ctx.font = `500 ${12 * d}px ${UI_FONT}`; ctx.textAlign = 'left';
      const lx = clamp(at.x + 40 * d, 8 * d, view.w - 240 * d);
      let ly = clamp(at.y, 20 * d, view.h - g.s.notes.length * 22 * d - 100 * d);
      for (const n of g.s.notes) {
        const w = ctx.measureText(n.txt).width + 16 * d;
        plaque(lx - 8 * d, ly - 14 * d, w, 20 * d);
        ctx.fillStyle = n.good ? P.goldHi : '#ff8a66'; ctx.fillText(n.txt, lx, ly);
        ly += 22 * d;
      }
      ctx.restore();
    }
  }

  // ---------- input ----------
  function setRay(ev) {
    const r = canvas.getBoundingClientRect();
    ndcV.set(((ev.clientX - r.left) / r.width) * 2 - 1, 1 - ((ev.clientY - r.top) / r.height) * 2);
    raycaster.setFromCamera(ndcV, camera);
  }
  // where on the ground the pointer is, in world pixels
  function canvasPoint(ev) {
    setRay(ev);
    return raycaster.ray.intersectPlane(groundPlane, hitV) ? { px: hitV.x * T, py: hitV.z * T } : { px: -1e6, py: -1e6 };
  }
  // a tall tower can be clicked anywhere on its body, not just on its tiles
  function pickTower(ev) {
    setRay(ev);
    for (const h of raycaster.intersectObjects([...towerMeshes.values()], true)) {
      let o = h.object;
      while (o && !o.userData.tower) o = o.parent;
      if (o) return o.userData.tower;
    }
    return null;
  }
  // A robot can be clicked near its body: the radius is generous because they keep moving, and larger for touch.
  // Returns the nearest one with its distance and the radius of its body in CSS pixels.
  function pickEnemy(ev) {
    const r = canvas.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    const tile = view.ppt / view.dpr; // CSS pixels per tile
    let best = null;
    for (const e of state.enemies) {
      if (e.dead || e.under || (e.stealth && !e.revealed)) continue;
      const m = enemyMeshes.get(e.id);
      const q = proj(e.x, e.y, m ? m.userData.h * 0.55 : 0.4);
      const dd = Math.hypot(q.x / view.dpr - x, q.y / view.dpr - y);
      const body = Math.max(8, e.r / T * tile * 1.2);
      if (dd <= body + (ev.pointerType === 'touch' ? 26 : 16) && (!best || dd < best.dist)) best = { e, dist: dd, body };
    }
    return best;
  }
  let lastTouchTile = null;

  // Camera gestures on the map. Mouse: drag to pan, right-drag to rotate, wheel to zoom.
  // Touch: one finger pans, two fingers pinch to zoom, twist to rotate and move together to pan.
  // A press that moves more than a few pixels is a gesture, not a click.
  const ptrs = new Map(); // pointerId -> { x, y, sx, sy, button }
  const gesture = { active: false }; // true from the first drag until every pointer is lifted
  const pair = () => { const [a, b] = [...ptrs.values()]; return { a, b, d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
  canvas.addEventListener('pointerdown', (ev) => {
    if (!state || drag.mode) return;
    if (ptrs.size === 0) gesture.active = false;
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, button: ev.button });
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* the pointer may already be gone */ }
    if (ptrs.size === 2) gesture.active = true;
    if (ev.button === 1) ev.preventDefault(); // no autoscroll on middle click
  });
  function moveGesture(ev) {
    const p = ptrs.get(ev.pointerId);
    if (!p) return;
    const px = p.x, py = p.y;
    if (ptrs.size >= 2) {
      const before = pair();
      p.x = ev.clientX; p.y = ev.clientY;
      const after = pair();
      panBetween(before.mx, before.my, after.mx, after.my);
      if (before.d > 10) zoomBy(after.d / before.d, after.mx, after.my);
      let da = after.ang - before.ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      rotateBy(da); cam.yaw = cam.goal.yaw; placeCamera();
      return;
    }
    p.x = ev.clientX; p.y = ev.clientY;
    if (!gesture.active && Math.hypot(p.x - p.sx, p.y - p.sy) > (ev.pointerType === 'touch' ? 10 : 5)) {
      gesture.active = true;
      // catch up on the movement that was still under the click threshold
      if (p.button === 2) rotateBy(-(p.x - p.sx) * 0.008); else panBetween(p.sx, p.sy, p.x, p.y);
      return;
    }
    if (!gesture.active) return;
    if (p.button === 2) rotateBy(-(p.x - px) * 0.008);
    else panBetween(px, py, p.x, p.y);
  }
  function endPointer(ev) {
    const p = ptrs.get(ev.pointerId);
    ptrs.delete(ev.pointerId);
    return { p, gesture: gesture.active };
  }
  canvas.addEventListener('pointercancel', (ev) => { ptrs.delete(ev.pointerId); });
  // iOS Safari can claim a two-finger pinch as page zoom despite touch-action: none; these events are its own
  for (const g of ['gesturestart', 'gesturechange', 'gestureend']) canvas.addEventListener(g, (ev) => ev.preventDefault());
  // and a multi-touch move must never scroll or zoom the page, or the browser cancels our pointers mid-pinch
  canvas.addEventListener('touchmove', (ev) => { if (ev.touches.length > 1) ev.preventDefault(); }, { passive: false });
  canvas.addEventListener('wheel', (ev) => {
    if (!state) return;
    ev.preventDefault();
    // a trackpad pinch arrives as a wheel event with ctrlKey set and small deltas
    const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
    zoomBy(Math.exp(-dy * (ev.ctrlKey ? 0.01 : 0.0015)), ev.clientX, ev.clientY);
  }, { passive: false });

  canvas.addEventListener('pointermove', (ev) => {
    if (!state) return;
    moveGesture(ev);
    const p = canvasPoint(ev);
    state.hover = p;
    const tx = Math.floor(p.px / T), ty = Math.floor(p.py / T);
    const clickable = !state.build && inBounds(tx, ty) && (state.occ[ty][tx] || grid[ty][tx] === 'forest');
    canvas.style.cursor = clickable ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerleave', () => { if (state && ui.lastPointer !== 'touch') state.hover = null; });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  canvas.addEventListener('pointerup', (ev) => {
    const end = endPointer(ev);
    if (!state || state.over || drag.mode === 'carry') return; // drops from the build bar are handled by endDrag
    if (end.gesture) return; // that was a pan, zoom or turn of the camera
    if (end.p && end.p.button === 2) { setBuild(null); return; } // a right click without a drag cancels
    if (end.p && end.p.button !== 0) return;
    ui.lastPointer = ev.pointerType;
    const p = canvasPoint(ev);
    state.hover = p;
    const tx = Math.floor(p.px / T), ty = Math.floor(p.py / T);
    // Inspect: while building, a click is always a build click. Otherwise a robot under the pointer is
    // inspected, unless a tower is hit too and the pointer is not on the robot's body itself.
    const hitEnemy = state.build ? null : pickEnemy(ev);
    state.inspect = null;
    if (hitEnemy && (hitEnemy.dist <= hitEnemy.body || !pickTower(ev))) {
      state.inspect = hitEnemy.e; state.selected = null; ui.help = false; sfx('click');
      return;
    }
    if (state.build) {
      // touch: first tap previews, second tap on the same spot builds
      const g = ghostInfo();
      const tag = `${g.ax},${g.ay},${state.dir}`;
      if (ev.pointerType === 'touch' && lastTouchTile !== tag) { lastTouchTile = tag; return; }
      lastTouchTile = null;
      if (!g.ok) sfx('error');
      if (g.ok) {
        const t = placeTower(state.build, state.dir, g.ax, g.ay);
        if (t && !ev.shiftKey && state.gold < TW[state.build].cost) setBuild(null);
        if (t && !ev.shiftKey) { setBuild(null); state.selected = { kind: 'tower', tower: t }; }
      }
      return;
    }
    const hitTower = pickTower(ev);
    if (hitTower) { state.selected = { kind: 'tower', tower: hitTower }; ui.help = false; return; }
    if (!inBounds(tx, ty)) { state.selected = null; return; }
    const o = state.occ[ty][tx];
    const plain = grid[ty][tx] === 'grass' || grid[ty][tx] === 'path' || grid[ty][tx] === 'walk';
    state.selected = o ? { kind: 'tower', tower: o } : plain ? null : { kind: 'tile', x: tx, y: ty };
    ui.help = false;
  });

  function setBuild(key) {
    if (key && !towerOpen(key)) return;
    state.build = key && state.build !== key ? key : null;
    if (state.build) {
      state.selected = null;
      if (!TW[state.build].directional && TW[state.build].shape.length === 1) state.dir = 0;
    }
    lastTouchTile = null;
  }
  function rotate() { if (state) state.dir = (state.dir + 1) % 4; lastTouchTile = null; }

  window.addEventListener('keydown', (ev) => {
    if (ev.target.closest('input,textarea,select')) { if (ev.key === 'Escape') closeMenuCards(); return; }
    const k = ev.key.toLowerCase();
    if (campOpen()) { campKey(k, ev); return; }
    if (menuOpen()) {
      // the menu only knows full screen and closing its cards
      if (k === 'f') toggleFullscreen();
      else if (k === 'escape') closeMenuCards();
      return;
    }
    if (!state) return;
    if (k === 'r') rotate();
    else if (k === 'q') rotateBy(-Math.PI / 4);
    else if (k === 'e') rotateBy(Math.PI / 4);
    else if (k === '=' || k === '+') zoomBy(1.25);
    else if (k === '-' || k === '_') zoomBy(0.8);
    else if (k === '0' || k === 'home') resetCamera();
    else if (k.startsWith('arrow')) {
      // pan along the screen's directions, a fixed share of the view whatever the zoom
      ev.preventDefault();
      const step = 3 / cam.goal.zoom, f = k === 'arrowup' ? [0, -1] : k === 'arrowdown' ? [0, 1] : k === 'arrowleft' ? [-1, 0] : [1, 0];
      const c = Math.cos(cam.goal.yaw), sn = Math.sin(cam.goal.yaw);
      cam.goal.x += (f[0] * c + f[1] * sn) * step; cam.goal.z += (-f[0] * sn + f[1] * c) * step;
      clampGoal();
    }
    else if (k === 'escape') { if (!$('settingsCard').hidden) closeMenuCards(); else { setBuild(null); state.selected = null; state.inspect = null; } }
    else if (k === ' ') { ev.preventDefault(); sendWave(); }
    else if (k === 'p') state.paused = !state.paused;
    else if (k === 'm') toggleMute();
    else if (k === 'a') toggleAuto();
    else if (k === 'n') togglePreview();
    else if (k === 'f') toggleFullscreen();
  });

  // Dev only: ?tune adds sliders for the reflection look.
  if (location.search.includes('tune')) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:12px;bottom:90px;z-index:99;background:rgba(3,5,12,.9);color:#efe4c8;padding:10px;font:12px monospace;width:260px';
    const sliders = { depth: [2.5, 0.5, 8, 0.1], strength: [0.7, 0, 1.5, 0.01], streak: [3, 1, 6, 0.1] };
    // the post look (visual polish on): PT fields
    for (const [k, mx] of [['thr', 1], ['knee', 1], ['glow', 2], ['wide', 2], ['tilt', 1], ['ramp', 2], ['sat', 2], ['contrast', 1.5], ['vig', 1], ['lamp', 3]]) sliders[k] = [PT[k], 0, mx, 0.01];
    const out = document.createElement('pre');
    for (const [k, [v, mn, mx, st]] of Object.entries(sliders)) box.insertAdjacentHTML('beforeend', `<label>${k} <input type="range" data-k="${k}" min="${mn}" max="${mx}" step="${st}" value="${v}"></label><br>`);
    box.appendChild(out); document.body.appendChild(box);
    const apply = () => {
      const vals = {};
      box.querySelectorAll('input').forEach((el) => { vals[el.dataset.k] = +el.value; });
      M3.REFL.uReflDepth.value = vals.depth; blurMat.uniforms.uStrength.value = vals.strength; tune.streak = vals.streak;
      for (const k of Object.keys(PT)) if (k in vals) PT[k] = vals[k];
      out.textContent = JSON.stringify(vals, null, 2);
    };
    box.addEventListener('input', apply); apply();
  }

  // Next-wave card: folds to a one-line header. The class lives on #preview so re-renders keep it.
  const PV_KEY = 'tw-preview';
  function setPreviewFolded(folded, save = true) {
    const el = $('preview');
    el.classList.toggle('folded', folded);
    const head = $('pvHead');
    if (head) head.setAttribute('aria-expanded', String(!folded));
    if (save) try { localStorage.setItem(PV_KEY, folded ? '1' : '0'); } catch (e) { /* storage blocked */ }
  }
  function togglePreview() { setPreviewFolded(!$('preview').classList.contains('folded')); }
  let pvStored = null;
  try { pvStored = localStorage.getItem(PV_KEY); } catch (e) { /* storage blocked */ }
  setPreviewFolded(pvStored === null ? window.matchMedia('(max-width: 760px)').matches : pvStored === '1', false);
  $('preview').addEventListener('click', (ev) => { if (ev.target.closest('#pvHead')) togglePreview(); });

  // ---------- UI ----------
  const ui = { panelKey: '', previewKey: '', lastPointer: 'mouse', waveHtml: '', paused: null, auto: false };
  try { ui.auto = localStorage.getItem('tw-auto') === '1'; } catch (e) { /* storage blocked */ }
  const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2l10 6-10 6z" fill="currentColor"/></svg>';
  const ICON_FF = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 3l7 5-7 5zM8 3l7 5-7 5z" fill="currentColor"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="4" height="12" fill="currentColor"/><rect x="9" y="2" width="4" height="12" fill="currentColor"/></svg>';

  function miniFootprint(key) {
    const cells = footprint(key, 0);
    const w = Math.max(...cells.map((c) => c[0])) + 1, h = Math.max(...cells.map((c) => c[1])) + 1;
    let html = `<span class="fp" style="grid-template-columns:repeat(${w},6px);grid-template-rows:repeat(${h},6px)">`;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) html += `<i class="${cells.some((c) => c[0] === x && c[1] === y) ? 'on' : ''}"></i>`;
    return html + '</span>';
  }

  // Build-bar portraits: each tower's real model, rendered once with the game's own renderer and lighting.
  // Drawn into a corner of the main canvas before the first frame and copied out straight away
  // (the next frame clears it), so the icons get the same tone mapping and colour as the city.
  const ICON_PX = 112;
  let towerIcons = null;
  const enemyIcons = {};
  const enemyIcon = (type) => { towerIcon(''); return enemyIcons[type] || ''; };
  function towerIcon(key) {
    if (towerIcons === null) {
      towerIcons = {};
      try { renderTowerIcons(); } catch (e) { console.warn('tower icons', e); }
    }
    return towerIcons[key] || '';
  }
  function renderTowerIcons() {
    const dpr = gl.getPixelRatio(), size = new THREE.Vector2();
    gl.getDrawingBufferSize(size);
    if (size.x < ICON_PX || size.y < ICON_PX) return;
    const css = ICON_PX / dpr;
    const s = new THREE.Scene();
    s.add(new THREE.HemisphereLight(0x9aa4c8, 0x2a1c08, 0.8));
    const key1 = new THREE.DirectionalLight(0xffc27a, 1.25); key1.position.set(4, 6, 5); s.add(key1);
    const rim = new THREE.DirectionalLight(0x9fb4ff, 0.6); rim.position.set(-5, 3, -4); s.add(rim);
    const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
    const out = document.createElement('canvas'); out.width = out.height = ICON_PX;
    const g2 = out.getContext('2d', { willReadFrequently: true });
    const box = new THREE.Box3(), ctr = new THREE.Vector3(), sph = new THREE.Sphere();
    const pose = { aim: -0.6, ramp: 0.35, disabledT: 0, flash: 0, level: 0, s: {}, def: {} };
    gl.setScissorTest(true);
    gl.setViewport(0, 0, css, css); gl.setScissor(0, 0, css, css);
    // Frame one model, render it on black and on white, and return it as a transparent PNG data URL.
    const snap = (m) => {
      s.add(m);
      m.updateMatrixWorld(true);
      box.setFromObject(m); box.getCenter(ctr); box.getBoundingSphere(sph);
      // Three-quarter view from above, like the game camera but lower so the silhouette reads. Then pull in
      // until the projected box (not the bounding sphere) fills the frame, so tall spires read as large as squat ones.
      let dist = sph.radius / Math.sin((cam.fov * Math.PI) / 360);
      const yaw = Math.PI / 4 + 0.35, pitch = 0.5;
      const place = () => {
        cam.position.set(ctr.x + Math.cos(yaw) * Math.cos(pitch) * dist, ctr.y + Math.sin(pitch) * dist, ctr.z + Math.sin(yaw) * Math.cos(pitch) * dist);
        cam.lookAt(ctr); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      };
      for (let it = 0; it < 4; it++) {
        place();
        let ext = 0;
        for (let c = 0; c < 8; c++) {
          _v.set(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z).project(cam);
          ext = Math.max(ext, Math.abs(_v.x), Math.abs(_v.y));
        }
        dist *= ext / 0.9;
      }
      place();
      // The game canvas is opaque, so render on black and on white and recover the alpha from the difference.
      const shot = (bg) => {
        gl.setClearColor(bg, 1); gl.clear();
        gl.render(s, cam);
        g2.clearRect(0, 0, ICON_PX, ICON_PX);
        g2.drawImage(canvas, 0, size.y - ICON_PX, ICON_PX, ICON_PX, 0, 0, ICON_PX, ICON_PX); // viewport origin is bottom-left
        return g2.getImageData(0, 0, ICON_PX, ICON_PX);
      };
      const k = shot(0x000000), w = shot(0xffffff).data, d = k.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = 255 - Math.max(0, Math.min(255, ((w[i] - d[i]) + (w[i + 1] - d[i + 1]) + (w[i + 2] - d[i + 2])) / 3));
        if (a > 0) { const f = 255 / a; d[i] = Math.min(255, d[i] * f); d[i + 1] = Math.min(255, d[i + 1] * f); d[i + 2] = Math.min(255, d[i + 2] * f); }
        d[i + 3] = a;
      }
      g2.putImageData(k, 0, 0);
      const url = out.toDataURL('image/png');
      s.remove(m); MODELS.disposeGroup && MODELS.disposeGroup(m);
      return url;
    };
    for (const key of Object.keys(TW)) {
      const cells = footprint(key, 0);
      const mx = cells.reduce((a, c) => a + c[0], 0) / cells.length, my = cells.reduce((a, c) => a + c[1], 0) / cells.length;
      const m = MODELS.tower(key, null, 0, cells.map(([cx, cy]) => [cx - mx, cy - my]), 0);
      try { m.userData.tick({ ...pose, key, def: TW[key] }, 1.3); } catch (e) { /* a pose field this tower doesn't need */ }
      towerIcons[key] = snap(m);
    }
    // the robots too, for the next-wave card and the inspect panel
    for (const [type, def] of Object.entries(EN)) {
      try {
        const m = MODELS.enemy(type, def);
        try { m.userData.tick({ id: 0, hp: def.hp, maxHp: def.hp, slowT: 0, stunT: 0, chillT: 0, burnT: 0, hitFlash: 0, under: false, def, type }, 1.3, 2); } catch (e) { /* a pose field this robot doesn't need */ }
        m.rotation.y = -0.5;
        enemyIcons[type] = snap(m);
      } catch (e) { console.warn('enemy icon', type, e); }
    }
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.x / dpr, size.y / dpr);
  }

  function buildBuildList() {
    $('buildList').innerHTML = Object.entries(TW).map(([key, d]) => `
      <button class="tcard" data-build="${key}" id="b-${key}" title="${d.role}: ${d.blurb} Click or drag onto the map.">
        <span class="tc-icon" style="--tc:${d.color}">${towerIcon(key) ? `<img src="${towerIcon(key)}" alt="" draggable="false">` : `<span class="sw" style="background:${d.color}"></span>`}</span>
        <span class="tc-top"><span class="tc-name">${d.name}</span></span>
        <span class="tc-bot">${miniFootprint(key)}${C.DAMAGE[d.dmgType] ? `<span class="dtype" style="color:${C.DAMAGE[d.dmgType].color}">${C.DAMAGE[d.dmgType].short}</span>` : `<span class="dtype">${d.label || 'BUFF'}</span>`}${d.directional ? '<span class="tag">aim</span>' : ''}<span class="cost">${d.cost}g</span></span>
      </button>`).join('');
  }

  // a campaign level only offers its own towers
  function syncBuildBar() {
    for (const key in TW) { const b = $(`b-${key}`); if (b) b.hidden = !towerOpen(key); }
  }

  function statRows(t, s) {
    const rows = [];
    const k = t.def.kind;
    const dt = C.DAMAGE[t.def.dmgType];
    if (dt) rows.push(['Type', `<span style="color:${dt.color}">${dt.name}</span>`]);
    if (s.dmg !== undefined) rows.push([k === 'focus' ? 'Beam' : 'Damage', fmt(s.dmg) + (k === 'cone' ? ' / tick' : k === 'focus' ? '/s' : '')]);
    if (s.rampMax) rows.push(['Max power', `${fmt(s.rampMax)}× in ${fmt(s.rampTime)}s`]);
    if (s.beams) rows.push(['Beams', s.beams]);
    if (s.carry) rows.push(['Afterglow', `kills pass ${Math.round(s.carry * 100)}% of the ramp`]);
    if (s.heat) rows.push(['Extra beams', `ramp to ×${fmt(s.heat.max)} in ${fmt(s.heat.time)}s`]);
    if (s.drag) rows.push(['Drag', `${fmt(s.drag)} tiles/s at full power`]);
    if (s.pull) rows.push(['Singularity', `pulls foes within ${fmt(s.pull.radius)} tiles`]);
    if (s.rate !== undefined) rows.push(['Rate', `${fmt(s.rate)}/s`]);
    if (s.global) rows.push(['Range', 'the whole map, along a clear line']);
    else if (s.range !== undefined) rows.push(['Range', `${fmt(s.range)} tiles`]);
    if (s.splash) rows.push(['Splash', `${fmt(s.splash)} tiles`]);
    if (s.minRange) rows.push(['Min range', `${fmt(s.minRange)} tiles`]);
    if (s.chains !== undefined) rows.push(['Chains', s.chains]);
    if (s.falloff && s.chains) rows.push(['Per jump', `×${fmt(s.falloff)}`]);
    if (s.conduct) rows.push(['Conduct', `+${Math.round(s.conduct * 100)}% per armour`]);
    if (s.strike) rows.push(['Thunderstroke', `every ${s.strike.every}th bolt ×${s.strike.mul}`]);
    if (s.reaction) rows.push(['Kill sparks', `${s.reaction.n} × ${Math.round(s.reaction.mul * 100)}%`]);
    if (s.ionise) rows.push(['Ionise', `−${Math.round(s.ionise * 100)}% ward per hit`]);
    if (s.jam) rows.push(['Jam', `${fmt(s.jam.dur)}s`]);
    if (s.targets) rows.push(['Targets', `${s.targets} toughest`]);
    if (s.doom) rows.push(['Last Hour', `−${Math.round(s.doom.share * 100)}% max HP after ${fmt(s.doom.delay)}s (bosses ${Math.round(s.doom.boss * 100)}%)`]);
    if (s.stasis) rows.push(['Stasis', `banked ×${fmt(s.stasis.mul)}`]);
    if (s.stunBoss) rows.push(['Stuns bosses', `${Math.round(C.COMBO.bossStun * 100)}%`]);
    if (s.toll) rows.push(['Toll', `every ${s.toll.every} strikes${s.midnight ? '' : `, ×${s.toll.mul} stun`}`]);
    if (s.midnight) rows.push(['Midnight', `${fmt(s.midnight.dur)}s stop in ${fmt(s.range * s.midnight.reach)} tiles (bosses ${fmt(s.midnight.boss)}s)`]);
    if (s.stun) rows.push(['Stun', `${s.stun}s${k === 'sniper' ? `, then ${C.COMBO.sniperStunGap}s immune` : ''}`]);
    if (s.cull) rows.push(['Cull', `${Math.round(s.cull.share * 100)}%${s.cull.late ? ` to ${Math.round(s.cull.share * (1 + s.cull.late) * 100)}%` : ''} of remaining HP (bosses ${Math.round(s.cull.boss * 100)}%, once per ${C.COMBO.bossCullGap}s)`]);
    if (s.quick) rows.push(['Hair Trigger', `a kill reloads in ${s.quick.delay}s, ${s.quick.max} per reload`]);
    if (s.interrupt) rows.push(['Interrupt', 'stun restarts ability clocks (not bosses)']);
    if (s.gridlock) rows.push(['Gridlock', 'a stunned walker blocks the road']);
    if (s.slow !== undefined) rows.push(['Slow', `${Math.round((1 - s.slow) * 100)}%`]);
    if (s.brittle) rows.push(['Brittle', `+${Math.round(s.brittle * 100)}% taken`]);
    if (s.burn) rows.push(['Burn', `${fmt(s.burn)}/s`]);
    if (s.shred) rows.push(['Armor shred', s.shred]);
    if (s.ignoreArmor) rows.push(['Armor', 'ignored']);
    else if (s.pierce) rows.push(['Pierce', `${s.pierce} armor`]);
    if (s.bossMul) rows.push(['Vs bosses', `×${s.bossMul}`]);
    if (s.airMul) rows.push(['Vs flyers', `×${s.airMul}`]);
    if (s.execute) rows.push(['Execute', `under ${Math.round(s.execute * 100)}% hp`]);
    if (s.knockback) rows.push(['Knockback', `${fmt(s.knockback)} tiles`]);
    if (s.quake) rows.push(['Quake', `${Math.round((1 - s.quake.slow) * 100)}% slow, ${fmt(s.quake.radius)} tiles`]);
    if (s.cluster) rows.push(['Bomblets', `${s.cluster.n} × ${fmt(s.cluster.dmg)}`]);
    if (s.charge) rows.push(['Charge', `up to ×${s.charge.max}`]);
    if (s.trail) rows.push(['Live strip', `${fmt(s.trail.dps)}/s for ${fmt(s.trail.dur)}s`]);
    if (s.trail && s.trail.arc) rows.push(['Strip arcs', `${fmt(s.trail.arc.dmg)} every ${s.trail.arc.every}s`]);
    if (s.vuln) rows.push(['Exposed', `+${Math.round(s.vuln * 100)}% taken`]);
    if (s.bounce) rows.push(['Bounces', `${s.bounce.n}, ×${s.bounce.falloff} each`]);
    if (s.flak) rows.push(['Flak burst', `${fmt(s.flak)} tiles`]);
    if (s.airSlow) rows.push(['Flak slow', `${Math.round((1 - s.airSlow.slow) * 100)}%`]);
    if (s.salvo) rows.push(['Fusillade', `every ${s.salvo.every}th volley ×${s.salvo.mul}`]);
    if (s.pin) rows.push(['Pins', `the toughest for ${fmt(s.pin)}s (bosses ${fmt(s.pin * C.COMBO.bossStun)}s)`]);
    if (s.clinch) rows.push(['Clinch', [['slowed', s.clinch.slow], ['burning', s.clinch.burn], ['stunned', s.clinch.stun]].filter((c) => c[1]).map((c) => `${c[0]} +${Math.round(c[1] * 100)}%`).join(', ') + (s.clinch.all ? `, all ×${s.clinch.all}` : '')]);
    if (s.hail) rows.push(['Hail', `${s.hail.n} × ${fmt(s.hail.dmg)} per pulse`]);
    if (s.freeze) rows.push(['Flash freeze', `${fmt(s.freeze.dur)}s every ${fmt(s.freeze.every)}s`]);
    if (s.grounds) rows.push(['Grounds flyers', `${fmt(s.grounds)}s`]);
    if (s.melt) rows.push(['Melts armour', `${fmt(s.melt)}/s`]);
    if (s.burnSlow) rows.push(['Burn slow', `${Math.round((1 - s.burnSlow) * 100)}%`]);
    if (s.pool) rows.push(['Burning road', `${fmt(s.pool.dps)}/s for ${fmt(s.pool.dur)}s`]);
    if (s.spread) rows.push(['Fire spreads', `${fmt(s.spread.reach)} tiles`]);
    if (s.limpet) rows.push(['Limpet', `blasts ${s.limpet.n}×`]);
    if (s.scatter) rows.push(['Mini-mines', `${s.scatter.n} × ${fmt(s.scatter.dmg)}`]);
    if (s.boostDmg) rows.push(['Boost dmg', pct(s.boostDmg)]);
    if (s.boostRate) rows.push(['Boost rate', pct(s.boostRate)]);
    if (s.boostRange) rows.push(['Boost range', pct(s.boostRange)]);
    if (s.focus) rows.push(['Overclock', `best neighbour ${pct(s.focus.dmg || 0)} dmg${s.focus.rate ? `, ${pct(s.focus.rate)} rate` : ''}`]);
    if (s.overdrive) rows.push(['Overdrive', `${fmt(s.overdrive.on)}s on, ${fmt(s.overdrive.off)}s rest`]);
    if (s.reach) rows.push(['Reach', `${fmt(s.reach.r)} tiles more, at ${Math.round(s.reach.mul * 100)}%`]);
    if (s.arms) rows.push(['Combined Arms', `${pct(s.arms)} dmg per tower type`]);
    if (s.grantSight) rows.push(['Relay', 'neighbours see invisible']);
    if (s.grantLos) rows.push(['Overwatch', 'touching towers fire over tenements, not the rifle']);
    if (k === 'support') rows.push(['Cap', `${pct(C.COMBO.ampCap.dmg)} dmg, ${pct(C.COMBO.ampCap.rate)} rate, ${pct(C.COMBO.ampCap.range)} range per tower`]);
    if (s.cone && k === 'light') rows.push(['Beam', `${s.cone * 2}° wide`]);
    if (s.mark) rows.push(['Lit enemies', `+${Math.round(s.mark * 100)}% taken, ${fmt(s.markDur)}s`]);
    if (s.lock) rows.push(['Lock', 'toughest foe in range']);
    if (s.designate) rows.push(['Designate', 'every tower fires at the lit foe']);
    if (s.flood) rows.push(['Floodlight', 'lights the whole circle']);
    if (s.revealDur > 0.3) rows.push(['Reveals', `${fmt(s.revealDur)}s after lit`]);
    if (s.spotter) rows.push(['Spotter', `${pct(s.spotter.range)} range vs lit foes`]);
    if (s.maxMines) rows.push(['Mines', `up to ${s.maxMines}`]);
    if (s.hp) rows.push(['Plating', `${Math.round(t.hp ?? s.hp)} / ${Math.round(t.maxHp ?? s.hp)}`]);
    if (t.downT > 0) rows.push(['Phoenix', `rising in ${fmt(Math.ceil(t.downT))}s`]);
    if (s.guard) rows.push(['Guard', `takes ${Math.round(s.guard * 100)}% less`]);
    if (s.reflect) rows.push(['Mirror Plate', `returns ${Math.round(s.reflect * 100)}%, up to ${Math.round(t.maxHp ?? s.hp)}${t.reflected ? ` (${Math.round(t.reflected)} so far)` : ''}`]);
    if (s.thorns) rows.push(['Thorns', `${fmt(s.thorns)}/s`]);
    if (s.shrapnel) rows.push(['Shrapnel', `${fmt(s.shrapnel.dmg)} in ${fmt(s.shrapnel.radius)} tiles when it falls`]);
    if (s.regen) rows.push(['Repairs', `${fmt(s.regen)}/s`]);
    if (s.tar) rows.push(['Tar', `${Math.round((1 - s.tar.slow) * 100)}% slow for ${fmt(s.tar.dur)}s`]);
    if (s.phoenix) rows.push(['Phoenix', `rises after ${fmt(s.phoenix.delay)}s at ${Math.round(s.phoenix.hp * 100)}%, once a wave`]);
    if (s.bounty) rows.push(['Bounty', `+${Math.round(s.bounty * 100)}% in range`]);
    if (s.elite) rows.push(['Elite', `+${Math.round(s.elite.bonus * 100)}% on kills worth ${s.elite.min}+`]);
    if (s.wanted) rows.push(['Wanted', `one foe a wave pays ×${s.wanted.mul}`]);
    if (s.streak) rows.push(['Streak', `+${Math.round(s.streak.step * 100)}% per kill within ${fmt(s.streak.window)}s, up to +${Math.round(s.streak.max * 100)}%`]);
    if (s.sellBonus) rows.push(['Resale', `+${Math.round(s.sellBonus * 100)}% in range`]);
    if (s.interest) rows.push(['Interest', `${Math.round(s.interest * 100)}% a wave (max ${WV.interestCap}g)`]);
    if (s.discount) rows.push(['Wholesale', `upgrades in range ${pct(-s.discount)}`]);
    if (k === 'bank') {
      const w = state.activeWaves.get(state.wave);
      rows.push(['Bank cap', w ? `${w.banked} / ${bankCapOf(w)}g this wave` : `${Math.floor(C.COMBO.bankCap * 100)}% of a wave's clear bonus`]);
    }
    const tgt = [s.air ? 'ground + air' : 'ground only'];
    if (k !== 'support' && k !== 'bank') rows.push(['Hits', k === 'barrier' ? 'blocks walkers' : tgt[0]]);
    if (s.seesStealth) rows.push(['Invisible', 'sees in range']);
    // a value longer than a short figure gets the panel's full width, so it never pushes the panel sideways
    return rows.map(([a, b]) => `<div class="row${String(b).replace(/<[^>]*>/g, '').length > 12 ? ' wide' : ''}"><span>${a}</span><b>${b}</b></div>`).join('');
  }

  // ---------- upgrade panel ----------
  // One frame for every tower: a column per path (P B E in archetype colours), each a row of tier pips, then
  // what its next tier does in a few words, then the price. The whole column is the buy button: one tap buys
  // its next tier. Every tier of every path, with the next one's stat changes, is in the Details fold.
  const COG = (() => {
    const pts = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 12) * Math.PI - Math.PI / 2, r = k % 4 < 2 ? 7.2 : 5.4;
      pts.push(`${(8 + Math.cos(a) * r).toFixed(2)} ${(8 + Math.sin(a) * r).toFixed(2)}`);
    }
    return `M${pts.join('L')}z`;
  })();
  const ARCH_ICON = {
    precision: '<circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 .8v4M8 11.2v4M.8 8h4M11.2 8h4" stroke="currentColor" stroke-width="1.3"/><path d="M8 6.6l1.4 1.4L8 9.4 6.6 8z" fill="currentColor"/>',
    barrage: '<path d="M10.2 5.8a3.1 3.1 0 0 1 0 4.4M12 4a5.6 5.6 0 0 1 0 8M13.9 2.1a8.3 8.3 0 0 1 0 11.8M5.8 5.8a3.1 3.1 0 0 0 0 4.4M4 4a5.6 5.6 0 0 0 0 8M2.1 2.1a8.3 8.3 0 0 0 0 11.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 6.6l1.4 1.4L8 9.4 6.6 8z" fill="currentColor"/>',
    engineering: `<path d="${COG}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="miter"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/>`,
  };
  const icon = (k) => `<svg class="pico" viewBox="0 0 16 16" aria-hidden="true">${ARCH_ICON[k]}</svg>`;
  const LOCK = '<svg class="lk" viewBox="0 0 10 12" aria-hidden="true"><path d="M2.6 5.2V3.6a2.4 2.4 0 0 1 4.8 0v1.6" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="1.2" y="5.2" width="7.6" height="5.8" fill="currentColor"/></svg>';
  const WHY = { locked: 'Two paths in use', capped: 'Side path: T2 max', maxed: 'Maxed' };
  // Columns of pips, one per path. pip.st: own | next | poor (legal, too dear) | lock | later.
  // Prices are what the player pays, after a Wholesale Bank's discount (full: the list price).
  // What buying the next tier of path p does to the headline numbers, as 'Damage 8 → 18' parts.
  function tierDelta(t, p) {
    const o = { key: t.key, pathOrder: t.pathOrder.includes(p) ? t.pathOrder : [...t.pathOrder, p] };
    const a = baseStats(o, t.pips), b = baseStats(o, { ...t.pips, [p]: t.pips[p] + 1 });
    return [['dmg', 'Damage'], ['rate', 'Rate'], ['range', 'Range'], ['stun', 'Stun']]
      .filter(([k]) => a[k] !== undefined && b[k] !== undefined && fmt(a[k]) !== fmt(b[k]))
      .map(([k, l]) => `${l} ${fmt(a[k])} → ${fmt(b[k])}`).join(' · ');
  }
  function upgradeCols(t) {
    const d = t.def;
    return PATHS.map((p) => {
      const path = d.paths[p], n = t.pips[p], r = canBuy(t, p);
      // a path stops at T2 once another one is past it; a third path is shut entirely
      const other = PATHS.some((q) => q !== p && t.pips[q] > SIDE_MAX);
      const shut = r.reason === 'locked';
      const pips = path.tiers.map((tier, i) => ({
        st: i < n ? 'own' : shut || (other && i >= SIDE_MAX) ? 'lock' : i === n ? (r.ok ? 'next' : 'poor') : 'later',
        cost: upgradePrice(t, tier.cost), full: tier.cost, line: `T${i + 1}${tier.name ? ` ${tier.name}` : ''} · ${tier.desc}`,
        term: tier.desc, sig: tier.name || '', delta: i === n && !shut && !(other && i >= SIDE_MAX) ? tierDelta(t, p) : '',
        why: shut ? WHY.locked : WHY.capped,
      }));
      return { id: p, arch: path.arch, color: C.ARCH[path.arch].color, name: path.name,
        desc: `${C.ARCH[path.arch].name}: ${path.desc}`, pips, why: shut ? WHY.locked : r.reason === 'capped' ? WHY.capped : r.reason === 'maxed' ? WHY.maxed : null };
    });
  }
  function upgradeHtml(t) {
    return `<div class="pcols">${upgradeCols(t).map((c) => {
      const nx = c.pips.find((p) => p.st === 'next' || p.st === 'poor');
      const off = nx && nx.cost < nx.full;
      const cap = c.why ? `<span class="why">${c.why === WHY.maxed ? '' : LOCK}${c.why}</span>`
        : nx ? `<span class="cost ${nx.st}${off ? ' off' : ''}"${off ? ` title="Wholesale: list price ${nx.full}g"` : ''}>${nx.cost}g</span>` : '';
      const tip = (p) => p.line + (p.delta ? ` (${p.delta})` : '');
      const pips = c.pips.map((p, i) => `<span class="pip ${p.st}${i === c.pips.length - 1 ? ' top' : ''}" title="${tip(p)}"><i></i>${p.st === 'lock' ? LOCK : ''}</span>`).join('');
      // the term: what the next tier does; a finished column names its signature instead
      const top = c.pips[c.pips.length - 1];
      const term = c.why === WHY.maxed ? `<b>${top.sig}</b>` : c.why || !nx ? '' : `${nx.sig ? `<b>${nx.sig}</b>` : ''}${nx.term}`;
      const label = nx && !c.why ? `${c.name}: buy ${tip(nx)}, ${nx.cost}g` : `${c.name}: ${c.why}`;
      return `<button class="pcol${c.why && c.why !== WHY.maxed ? ' shut' : ''}" style="--ac:${c.color}" data-act="buy" data-c="${c.id}"
        ${nx && nx.st === 'next' ? '' : 'disabled'} aria-label="${label}">
        <span class="pch" title="${c.desc}">${icon(c.arch)}<b>${c.name}</b></span>
        <span class="pips">${pips}</span><span class="pterm">${term}</span><span class="pcap">${cap}</span></button>`;
    }).join('')}</div>`;
  }
  // the Details fold: every path, what it is for, and each tier's line; the next tier also shows its stat changes
  function pathsHtml(t) {
    return upgradeCols(t).map((c) => `<div class="pth" style="--ac:${c.color}"><p><b>${c.name}</b> ${c.desc}</p>${c.pips.map((p) =>
      `<div class="tr ${p.st}"><span>${p.line}${p.delta ? `<small>${p.delta}</small>` : ''}</span><b>${p.st === 'own' ? 'Owned' : p.st === 'lock' ? p.why : `${p.cost}g`}</b></div>`).join('')}</div>`).join('');
  }
  function towerPanel(t) {
    const d = t.def, s = t.s;
    const modes = [['first', 'First'], ['last', 'Last'], ['strong', 'Strongest'], ['close', 'Closest']];
    if (s.prefersAir) modes.push(['air', 'Flyers']);
    const aims = ['projectile', 'splash', 'chain', 'focus', 'sniper'].includes(d.kind);
    const targeting = aims ? `<p class="label">Targeting</p><div class="seg">${modes
      .map(([m, l]) => `<button data-act="target" data-m="${m}" class="${t.targetMode === m ? 'on' : ''}">${l}</button>`).join('')}</div>` : '';
    const facing = d.directional ? `<p class="small">Facing ${DIR_NAMES[t.dir]}. Rotate before placing with R.</p>` : '';
    const notes = s.notes.length ? `<div class="chips">${s.notes.map((n) => `<span class="chip ${n.good ? 'good' : 'bad'}">${n.txt}</span>`).join('')}</div>` : '';
    const bad = s.notes.filter((n) => !n.good).length;
    const sum = [aims ? (modes.find(([m]) => m === t.targetMode) || modes[0])[1] : '', bad ? `${bad} warning${bad > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
    return `
      <div class="ph"><span class="sw" style="background:${d.color}"></span><h3>${d.name}</h3></div>
      ${t.disabledT > 0 ? `<p class="warn">Offline: ${t.disabledWhy || 'disabled'}</p>` : ''}
      ${t.warded < 1 && t.disabledT <= 0 ? `<p class="warn">Damped: ${Math.round(t.warded * 100)}% rate (Static Warden)</p>` : ''}
      ${upgradeHtml(t)}
      <div class="foot"><button class="more${bad ? ' bad' : ''}" data-act="stats" aria-expanded="${!!ui.statsOpen}"><span class="chev" aria-hidden="true"></span>Details${sum ? `<em>${sum}</em>` : ''}</button>
        <button class="btn danger" data-act="sell">Sell · ${sellValue(t)}g</button></div>
      ${ui.statsOpen ? `<div class="more-body"><div class="stats">${statRows(t, s)}</div>${notes}${facing}${targeting}
        <p class="small muted" id="dmgDealt"></p><p class="label">Upgrade paths</p>${pathsHtml(t)}</div>` : ''}`;
  }

  function tilePanel(x, y) {
    const k = grid[y][x];
    const d = TR[k], note = d.noBuild && !restricted ? `${d.noBuild} ` : '';
    return `<div class="ph"><span class="sw tile-${k}"></span><h3>${d.name}</h3></div><p>${note}${d.desc}</p>`;
  }

  function buildPanel(key) {
    const d = TW[key];
    return `<div class="ph"><span class="sw" style="background:${d.color}"></span><h3>${d.name}</h3><span class="lvl">${d.cost}g</span></div>
      <p>${d.blurb}</p>
      <p class="small">${d.directional || d.shape.length > 1 ? `Press <kbd>R</kbd> to rotate the footprint${d.directional ? ' and the firing direction' : ''}. ` : ''}Shift-click to keep building.</p>
      <div class="stats">${statRows({ def: d }, baseStats({ key }))}</div>
      <p class="label">Upgrade paths</p>
      <div class="pcols">${PATHS.map((p) => {
        const a = d.paths[p].arch, c = C.ARCH[a];
        const pips = d.paths[p].tiers.map((_, i) => `<span class="pip own${i === 3 ? ' top' : ''}"><i></i></span>`).join('');
        return `<div class="pcol view" style="--ac:${c.color}"><span class="pch">${icon(a)}<b>${d.paths[p].name}</b></span>
          <span class="pips">${pips}</span><span class="pterm">${c.name}</span></div>`;
      }).join('')}</div>
      <p class="small pdesc">${PATHS.map((p) => `<span style="--ac:${C.ARCH[d.paths[p].arch].color}"><b>${d.paths[p].name}</b> ${d.paths[p].desc}</span>`).join('')}</p>`;
  }

  function helpPanel() {
    return `<div class="ph"><h3>Field notes</h3></div>
      <ul class="tips">
        <li><b>Terrain matters.</b> Build on terraces for extra range. Tenements block sight and cannot be torn down.</li>
        <li><b>Footprints matter.</b> Bigger towers need room. Rotate with <kbd>R</kbd> to fit them.</li>
        <li><b>Neighbours matter.</b> Amplifiers boost what they touch (a Grid Amplifier reaches a little farther). Frost and fire next to each other make steam.</li>
        <li><b>Frost + physical = shatter.</b> Chilled enemies take +40% from rivets and bombs. Fire thaws them.</li>
        <li><b>Damage types.</b> <span style="color:${C.DAMAGE.physical.color}">Physical</span> is blunted by armor. <span style="color:${C.DAMAGE.magic.color}">Magic</span> is blocked by wards. <span style="color:${C.DAMAGE.electric.color}">Electric</span> hits armor 40% harder but is warded. <span style="color:${C.DAMAGE.fire.color}">Fire</span> ignores both. Late waves need all four.</li>
        <li><b>Invisible enemies</b> need a Searchlight's beam, a Spike Driver, or a tower touching a Relay Amplifier.</li>
        <li><b>Hold them up.</b> Barricades go on the boulevard and stop walkers until broken. Mines wait on the road for them.</li>
        <li><b>Economy.</b> A Gilded Bank pays extra for kills near it and raises the resale of towers in its radius. What Banks pay in one wave is capped.</li>
        <li>Drag a tower from the bar onto the map, or click it and click the map.</li>
      </ul>
      <p class="small muted">Click a tower or tile for details. <kbd>Space</kbd> sends the next wave.</p>
      <p class="small muted">Camera: drag to pan, scroll or pinch to zoom, right-drag, twist or <kbd>Q</kbd>/<kbd>E</kbd> to rotate, <kbd>0</kbd> to reset.</p>`;
  }

  function panelKey() {
    const s = state.selected;
    if (state.build) return `build:${state.build}`;
    if (s && s.kind === 'tower') {
      const t = s.tower;
      // pip states carry affordability, so pips and prices flip live as gold comes and goes
      const c1 = upgradeCols(t).map((c) => c.pips.map((p) => p.st[0] + p.cost).join('')).join('/'); // costs: Wholesale
      return `t:${t.id}:${c1}:${!!ui.statsOpen}:${t.targetMode}:${t.disabledT > 0}:${t.disabledWhy}:${t.warded < 1}:${t.s.notes.map((n) => n.txt).join('|')}:${sellValue(t)}:${t.hp ? Math.ceil((t.hp / t.maxHp) * 20) : ''}:${t.downT > 0 ? Math.ceil(t.downT) : ''}`;
    }
    if (s && s.kind === 'tile') return `tile:${s.x}:${s.y}:${grid[s.y][s.x]}`;
    return ui.help ? 'help' : 'none';
  }

  // A robot's portrait with a corner badge for each of flying, invisible and boss.
  const BADGE_SVG = {
    boss: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 9.5V4l2.6 2.2L6 2.2l1.9 4L10.5 4v5.5z" fill="currentColor"/></svg>',
    fly: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 8.5C3 8 4.6 6.6 6 3.5 7.4 6.6 9 8 11 8.5 9 9.6 7.4 9.2 6 7.6 4.6 9.2 3 9.6 1 8.5z" fill="currentColor"/></svg>',
    ghost: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6c1.4-2.4 3-3.4 5-3.4S9.6 3.6 11 6c-1.4 2.4-3 3.4-5 3.400S2.4 8.4 1 6z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="6" r="1.4" fill="currentColor"/><path d="M2 10.500L10 1.5" stroke="currentColor" stroke-width="1.3"/></svg>',
  };
  function enemyBadges(d) {
    const out = [];
    if (d.boss) out.push(['boss', 'Boss']);
    if (d.air) out.push(['fly', 'Flying']);
    if (d.stealth || (d.traits || []).includes('Cloaks')) out.push(['ghost', 'Invisible']);
    return out;
  }
  function enemyIconHtml(type) {
    const d = EN[type], src = enemyIcon(type);
    const img = src ? `<img src="${src}" alt="" draggable="false">` : `<span class="esw" style="background:${d.color}"></span>`;
    const badges = enemyBadges(d).map(([k, name]) => `<i class="bdg ${k}" title="${name}">${BADGE_SVG[k]}</i>`).join('');
    return `${img}${badges ? `<span class="bdgs">${badges}</span>` : ''}`;
  }

  // tip per trait: the Next-wave card lists them for the coming wave, the New robot banner shows a robot's own
  const TRAIT_TIPS = {
  Invisible: (d) => 'Invisible enemies can only be targeted once revealed by a Searchlight, or seen by a Spike Driver or a tower touching a Relay Amplifier. Area weapons need that sight too.',
  Cloaks: (d) => 'Invisible enemies can only be targeted once revealed by a Searchlight, or seen by a Spike Driver or a tower touching a Relay Amplifier. Area weapons need that sight too.',
  Flying: (d) => 'Wyverns fly straight across. Bombards and basic flamethrowers cannot hit air.',
  EMP: (d) => 'Disruptors switch off towers within 2 tiles every few seconds. Spread out.',
  Aegis: (d) => 'Shield Bearers cut the damage taken by robots around them. Kill the bearer first.',
  Baffles: (d) => 'Baffle Drones make the ground robots under them shrug off shots from towers more than 6 tiles away. Shoot the drone down, or let near towers take the shelter.',
  Splits: (d) => 'Gear Splitters break into two Gear Mites when they die. Splash and mines clean up the pieces.',
  Spots: (d) => 'Spotter Drones fly low along the boulevard and hurry the robots around them. Anti-air should take them early.',
  Sabotage: (d) => 'Sappers stop beside a tower and knock it out for a while. A Barricade keeps them off your line.',
  Governs: (d) => 'Governors cannot be slowed or stunned, and halve the slow and stun on robots within 2 tiles. Rely on damage, or jam them with a Tesla.',
  Unslowable: (d) => 'Lamplighters make the robots near them immune to slow and stun. Burn or shoot them down.',
  Surges: (d) => { const o = d.overload; return `The Power Colossus surges at ${o.at.map((a) => `${Math.round(a * 100)}%`).join(', ')} HP: towers within ${o.radius} tiles go dark for ${o.dur}s, ${o.n} ${EN[o.type].name}s join it and it rushes ahead. Keep damage out of its reach, or have a Jammer hit it as it crosses a mark and the surge fizzles.`; },
  Teleports: (d) => 'Relay Couriers jump several tiles ahead every few seconds. Give them depth, not one choke point.',
  Burrows: (d) => 'Mole Tunnellers dig under the road, where nothing can hit them, and pass under barricades.',
  Explodes: (d) => 'Ember Carriers scorch the towers within 2 tiles when they die. Kill them at range.',
  Bombs: (d) => 'Dirigibles bomb the towers they fly over, knocking them out. Only anti-air can stop them.',
  Heals: (d) => 'Field Menders heal the robots around them. Burst them down first, or keep the pressure on.',
  Plated: (d) => 'Ironclads take at most 40 damage from any one hit. Fast, light shots, flames and beams work. One big shell does not.',
  Reboots: (d) => 'Phoenix Frames get back up once at half health. Keep firing after the first kill.',
  'Drops troops': (d) => 'Troop Balloons drop three Grunts onto the first road they fly over after a third of their flight. Shoot them down before they get there.',
  Rebuilds: (d) => `Scrap Salvagers rebuild robots that die near them at half health (up to ${d.salvage.max} each, no gold). Kill the Salvager first, or jam or stun it.`,
  Holograms: (d) => 'Mirage Casters project copies of themselves that soak your shots. A Searchlight pops them; splash hits the real one too.',
  Airlifts: (d) => 'Skyhooks lift the biggest ground robot below them and carry it ahead; only anti-air hits it up there. Shoot the Skyhook down and its cargo falls hard.',
  Afterburner: (d) => 'Stormhawks burn for a short sprint every few seconds. Slows and stuns throw off the timing.',
  'Launches Wyverns': (d) => 'The Sky Citadel bombs towers below it and launches Wyverns. Only anti-air can hurt it.',
  Rams: (d) => 'Tram Juggernauts smash through barricades without stopping.',
  'Spawns mites': (d) => 'The Foundry Colossus builds Gear Mites as it walks.',
  Advanced: (d) => `${d.name}s are advanced ${EN[d.variant].name}s, six times as tough. ${d.ability} Last Hour, Deadline and executes treat them like bosses.`,
  };
  const ARMOR_TIP = 'Armor blunts every physical hit. Electric deals +40% to armored enemies; magic and fire ignore armor. Concussion and Howitzer Bombards strip or pierce it.';
  // the most specific trait comes last ('Flying', 'Bombs'), so it wins
  const robotTip = (d) => { for (const tr of [...(d.traits || [])].reverse()) if (TRAIT_TIPS[tr]) return TRAIT_TIPS[tr](d); return d.ability || (d.armor > 0 ? ARMOR_TIP : ''); };

  function previewHtml() {
    if (state.wave >= gameLen()) return ''; // last wave sent: the card hides (#preview:empty)
    const w = makeWave(state.wave + 1);
    const hp = hpMul(w.n);
    const MD = w.mod && WV.modifiers[w.mod];
    const tips = new Set(MD ? [`<b>${MD.name}.</b> ${MD.tip}`] : []); // the modifier's tip leads
    const rows = w.groups.map((g) => {
      const d = EN[g.type];
      const armor = d.armor, mdef = d.mdef || 0;
      for (const tr of d.traits || []) if (TRAIT_TIPS[tr]) tips.add(TRAIT_TIPS[tr](d));
      if (armor > 0) tips.add(ARMOR_TIP);
      if (mdef >= 0.3) tips.add('Magic defense blocks magic and electric. Physical and fire damage go straight through.');
      const def = [
        armor > 0 ? `<em class="arm">Armor ${armor}</em>` : '',
        mdef > 0 ? `<em class="mdf">Ward ${Math.round(mdef * 100)}%</em>` : '',
        ...(d.traits || []).map((t) => `<em>${t}</em>`),
      ].join('');
      return `<li><span class="en-ico">${enemyIconHtml(g.type)}</span><span class="en">${d.name}</span><span class="ct">×${g.count}</span>
        <span class="traits">${def}</span><span class="hp">${Math.round(d.hp * hp)} hp</span></li>`;
    }).join('');
    const swatches = w.groups.map((g) => `<span class="en-ico sm">${enemyIconHtml(g.type)}</span><span class="ct">×${g.count}</span>`).join('');
    const tipsHtml = [...tips].map((t) => `<p class="tip">${t}</p>`).join('');
    return `<button class="wt pv-head" id="pvHead" type="button" aria-expanded="${!$('preview').classList.contains('folded')}" aria-controls="pvBody">
      <span class="chev" aria-hidden="true"></span>
      <span><span class="pv-next">Next · </span>wave ${w.n}</span>${w.boss ? '<span class="boss">Boss</span>' : ''}${MD ? `<span class="boss mod mod-${w.mod}">${modGlyph(w.mod)}<b>${MD.name}</b></span>` : ''}
      <span class="pv-sum">${swatches}</span>
      <span class="bonus">+${w.bonus}g</span>
    </button>
    <div class="pv-body" id="pvBody"><div class="pv-inner"><ul class="wave">${rows}</ul>${tipsHtml}</div></div>`;
  }

  // ---------- wave modifier cue ----------
  // A modifier wave (Endless) wears its own colour and glyph (CSS .mod-<key> in index.html) on the wave button, the
  // preview's tag and a HUD badge while it is on the field, and starts with a one-shot edge flash and plaque (#modCue).
  // Swarm rush: chevrons; Air only: a wing; Armoured column: a shield; Blackout: a broken bolt.
  const MOD_GLYPH = {
    rush: '<path d="M1 3l5 5-5 5M6 3l5 5-5 5M11 3l4 5-4 5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    air: '<path d="M1 11L15 4l-4 9-3-3z" fill="currentColor"/><path d="M8 10l-2 4" stroke="currentColor" stroke-width="1.4"/>',
    armour: '<path d="M8 1l6 2v5c0 3.4-2.6 5.8-6 7-3.4-1.2-6-3.6-6-7V3z" fill="currentColor"/><path d="M8 3.6v9" stroke="#0b1020" stroke-width="1.2"/>',
    blackout: '<path d="M9.6 1L3.4 8.6h4L6.2 15 12.6 6.8H8.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M2 14L14 2" stroke="currentColor" stroke-width="1.6"/>',
  };
  const modGlyph = (k) => `<svg class="mglyph" viewBox="0 0 16 16" aria-hidden="true">${MOD_GLYPH[k] || ''}</svg>`;
  function modCue(w) {
    const el = $('modCue'), MD = WV.modifiers[w.mod];
    if (!el || !MD) return;
    el.className = `mod-${w.mod}`;
    el.querySelector('.mc-plaque').innerHTML = `<p class="mc-eye">Wave ${w.n} · Modifier</p><p class="mc-title">${modGlyph(w.mod)}${MD.name}</p><p class="mc-tip">${MD.tip}</p>`;
    void el.offsetWidth; // restart the CSS animations
    el.classList.add('on');
    clearTimeout(modCue.t); modCue.t = setTimeout(() => el.classList.remove('on'), 3600);
  }

  // ---------- New robot banner ----------
  // The first time a robot type takes the field a small card in the side column names it and shows its tip. Types
  // already seen live in localStorage, so a returning player is not told again while a newly added type still is.
  // Holograms and mites only come from other robots; bosses are roster robots and get one.
  const SEEN_KEY = 'voltaic.seen', BANNER_MAX = 3, BANNER_MS = 14000;
  const seenRobots = new Set();
  try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null'); if (v && Array.isArray(v.types)) v.types.forEach((k) => seenRobots.add(k)); } catch (e) { /* storage blocked */ }
  const bannerQ = [];
  let bannerNow = null, bannerUntil = 0;
  function noteRobot(type) {
    const d = EN[type];
    if (state.noStats || seenRobots.has(type) || bannerQ.includes(type) || bannerNow === type || (d.unlock >= 999 && !d.boss)) return;
    if (!robotTip(d)) return;
    if (bannerQ.length < BANNER_MAX) bannerQ.push(type); // past the cap a type waits: it is not marked seen, so it gets its turn later
  }
  function showBanner(type) {
    bannerNow = type; bannerUntil = Date.now() + BANNER_MS;
    seenRobots.add(type);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify({ v: 1, types: [...seenRobots] })); } catch (e) { /* storage blocked */ }
    const d = EN[type], el = $('robotNew');
    el.innerHTML = `<button class="x" data-act="dismiss" aria-label="Dismiss">×</button>
      <div class="wt"><span>New robot</span></div>
      <div class="rn-head"><span class="en-ico">${enemyIconHtml(type)}</span><span class="en">${d.name}</span></div>
      <p class="tip">${robotTip(d)}</p>`;
    el.hidden = false;
  }
  function updateBanner() {
    if (bannerNow && (Date.now() > bannerUntil || menuOpen() || state.over)) { bannerNow = null; $('robotNew').hidden = true; }
    if (!bannerNow && bannerQ.length && !menuOpen()) showBanner(bannerQ.shift());
  }
  $('robotNew').addEventListener('click', (ev) => { if (ev.target.closest('[data-act="dismiss"]')) bannerUntil = 0; });

  function updateUI() {
    $('gold').textContent = Math.floor(state.gold);
    $('lives').textContent = state.lives;
    $('wave').textContent = state.mode === 'normal' ? `${state.wave} / ${gameLen()}` : `${state.wave}`;
    const wb = $('waveBtn');
    const active = state.activeWaves.size > 0;
    wb.disabled = !canSendWave();
    const next = state.wave + 1;
    // a modifier wave names itself on the button (looked up once per wave, not per frame)
    if (ui.modState !== state || ui.modWave !== next) { ui.modState = state; ui.modWave = next; ui.mod = canSendWave() ? makeWave(next).mod || null : null; }
    const md = ui.mod && WV.modifiers[ui.mod], tag = md ? ` <span class="md">${modGlyph(ui.mod)}<b>${md.name}</b></span>` : '';
    const wcls = `cbtn primary${md ? ` mod mod-${ui.mod}` : ''}`;
    if (wb.className !== wcls) wb.className = wcls;
    // the HUD badge names the newest modifier wave still on the field
    let onMod = null;
    for (const [, aw] of state.activeWaves) if (aw.mod) onMod = aw.mod;
    if (ui.modOn !== onMod) {
      ui.modOn = onMod;
      const bd = $('modBadge'), M2 = onMod && WV.modifiers[onMod];
      bd.hidden = !M2;
      if (M2) { bd.className = `mod-${onMod}`; bd.innerHTML = `${modGlyph(onMod)}<b>${M2.name}</b>`; bd.title = `${M2.name}: ${M2.tip}`; }
    }
    const countdown = ui.auto && state.autoT > 0 ? Math.ceil(C.AUTO_WAVE_DELAY - state.autoT) : 0;
    const whtml = !canSendWave() ? 'Final wave'
      : active ? `${ICON_FF}Wave ${next} <span class="g">+${WV.earlyBase + next * WV.earlyPer}g</span>${tag}`
      : countdown ? `${ICON_PLAY}Wave ${next} in ${countdown}s${tag}`
      : `${ICON_PLAY}Wave ${next}${tag}`;
    if (ui.waveHtml !== whtml) {
      ui.waveHtml = whtml; wb.innerHTML = whtml;
      wb.title = (md ? `${md.name}: ${md.tip}\n` : '') + (active ? 'Send the next wave early for bonus gold (Space)' : 'Start the next wave (Space)');
    }
    const sp = `${state.speed}×`;
    if ($('speedBtn').textContent !== sp) $('speedBtn').textContent = sp;
    const pb = $('pauseBtn');
    if (ui.paused !== state.paused) {
      ui.paused = state.paused;
      pb.innerHTML = state.paused ? ICON_PLAY : ICON_PAUSE;
      pb.setAttribute('aria-label', state.paused ? 'Resume' : 'Pause');
      pb.title = state.paused ? 'Resume (P)' : 'Pause (P)';
      pb.setAttribute('aria-pressed', state.paused);
    }
    for (const [key, d] of Object.entries(TW)) {
      const b = $(`b-${key}`);
      b.classList.toggle('on', state.build === key);
      b.classList.toggle('poor', state.gold < d.cost);
    }

    const key = panelKey();
    if (key !== ui.panelKey) {
      ui.panelKey = key;
      const s = state.selected;
      const panel = $('panel');
      panel.hidden = key === 'none';
      const body = state.build ? buildPanel(state.build)
        : s && s.kind === 'tower' ? towerPanel(s.tower)
        : s && s.kind === 'tile' ? tilePanel(s.x, s.y) : key === 'help' ? helpPanel() : '';
      panel.innerHTML = body ? `<button class="x" data-act="close" aria-label="Close">×</button>${body}` : '';
      panel.classList.toggle('tower', !!(s && s.kind === 'tower' && !state.build));
    }
    $('helpBtn').setAttribute('aria-pressed', !!ui.help);
    updateInspect();
    updateBanner();
    if (state.selected && state.selected.kind === 'tower') {
      const t = state.selected.tower;
      const dd = $('dmgDealt');
      if (dd) dd.textContent = `${Math.round(t.dmgDealt)} damage · ${t.kills} kills`;
    }
    const pk = `${state.wave}:${state.mode}`;
    if (pk !== ui.previewKey) { ui.previewKey = pk; $('preview').innerHTML = previewHtml(); }
  }

  // Inspect panel: the shell is built once per robot, so the close button survives while the numbers tick.
  const STATUS_FX = (e) => {
    const d = e.def, out = [];
    if (e.stunT > 0) out.push(['Stunned', 'bad']);
    if (e.slowT > 0 && e.slowMul < 1) out.push([`Slowed −${Math.round((1 - e.slowMul) * 100)}%`, 'ice']);
    if (e.chillT > 0) out.push([e.brittle ? `Chilled · +${Math.round(e.brittle * 100)}% phys` : 'Chilled', 'ice']);
    if (e.burnT > 0) out.push([`Burning ${fmt(e.burnDps)}/s`, 'fire']);
    if (e.burnT > 0 && e.melt) out.push(['Melting armour', 'fire']);
    if (e.downT > 0) out.push(['Iced wings: low', 'ice']);
    if (e.jamT > 0) out.push(['Jammed', 'good']);
    if (e.ionised > 0) out.push([`Ionised −${Math.round(e.ionised * 100)}% ward`, 'good']);
    if (e.doomT > 0) out.push([`Branded −${Math.round(e.doomShare * 100)}% HP`, 'good']);
    if (e.stasisT > 0) out.push([`Stasis: ${Math.round(e.bank)} banked`, 'good']);
    if (e.markT > 0) out.push([`Lit +${Math.round(e.mark * 100)}% dmg`, 'good']);
    if (e.vulnT > 0) out.push([`Exposed +${Math.round(e.vuln * 100)}% dmg`, 'good']);
    if (e.aegis > 0) out.push([`Shielded −${Math.round((d.aegis ? d.aegis.cut : 0.3) * 100)}%`, 'good']);
    if (e.baffle > 0) out.push([`Baffled −${Math.round(e.baffle * 100)}% from ${e.baffleMin}+ tiles`, 'good']);
    if (e.haste > 0) out.push([`Hasted +${Math.round(e.haste * 100)}%`, 'bad']);
    if (e.mend > 0) out.push([`Mending ${Math.round(e.mend * (e.boss ? 0.33 : 1) * 100)}%/s`, 'bad']);
    if (e.surgeLeft > 0) out.push(['Afterburner', 'bad']);
    if (e.reborn && !e.rebuilt) out.push(['Rebooted', 'good']);
    if (e.rebuilt) out.push(['Rebuilt: no gold', 'good']);
    if (e.fake) out.push(['Hologram: no harm', 'good']);
    if (e.carried) out.push(['Airlifted: anti-air only', 'bad']);
    if (e.cargo) out.push([`Carrying ${e.cargo.def.name}`, 'bad']);
    if (d.salvage) out.push([`Rebuilds left ${d.salvage.max - e.salvaged}`, 'bad']);
    if (e.overT > 0) out.push([`Surging +${Math.round(d.overload.speed * 100)}%`, 'bad']);
    if (d.overload && e.overN < d.overload.at.length) out.push([`Next surge at ${Math.round(d.overload.at[e.overN] * 100)}% HP`, 'bad']);
    if (e.lit) out.push(['Lantern: no slow/stun', 'good']);
    else if (e.noCtl) out.push(['Governor: no slow/stun', 'good']);
    else if (e.gov) out.push([`Governor: slow/stun −${Math.round(e.gov * 100)}%`, 'bad']);
    if (e.stealth) out.push([e.revealed ? 'Revealed' : 'Hidden', 'good']);
    if (e.blocked) out.push(['Breaking barricade', 'bad']);
    if (e.plantT > 0) out.push(['Planting charge', 'bad']);
    return out;
  };
  function updateInspect() {
    const el = $('inspect'), e = state.inspect;
    if (!e || e.dead || state.over || state.build) { state.inspect = null; el.hidden = true; ui.inspectId = null; return; }
    const d = e.def;
    if (ui.inspectId !== e.id) {
      ui.inspectId = e.id; ui.inspectFx = null;
      const badges = enemyBadges(d).map(([k, name]) => `<i class="bdg ${k}" title="${name}">${BADGE_SVG[k]}</i>`).join('');
      const traits = (d.traits || []).filter((t) => t !== 'Boss').map((t) => `<em>${t}</em>`).join('');
      el.innerHTML = `<button class="x" data-act="close-inspect" aria-label="Close">×</button>
        <div class="ph"><span class="en-ico lg">${enemyIcon(e.type) ? `<img src="${enemyIcon(e.type)}" alt="" draggable="false">` : `<span class="esw" style="background:${d.color}"></span>`}</span>
          <h3>${d.name}${badges ? `<span class="bdgs inline">${badges}</span>` : ''}</h3></div>
        ${d.variant ? `<p class="small muted">Advanced ${EN[d.variant].name}</p>` : ''}
        <div class="hpbar"><i id="inHpBar"></i><b id="inHp"></b></div>
        <div class="stats">
          <div class="row"><span>Armor</span><b>${fmt(e.armor)}</b></div>
          <div class="row"><span>Ward</span><b>${Math.round(e.mdef * 100)}%</b></div>
          <div class="row"><span>Speed</span><b id="inSpeed"></b></div>
        </div>
        ${traits ? `<div class="traits wide">${traits}</div>` : ''}
        ${d.ability ? `<p class="ability">${d.ability}</p>` : ''}
        <div class="chips" id="inFx"></div>`;
      el.hidden = false;
    }
    const hp = Math.max(0, Math.ceil(e.hp));
    $('inHp').textContent = `${hp} / ${e.maxHp}`;
    $('inHpBar').style.width = `${Math.max(0, (e.hp / e.maxHp) * 100)}%`;
    let mul = e.slowT > 0 ? e.slowMul : 1; mul *= 1 + e.haste; if (e.surgeLeft > 0) mul *= d.surge.mul; if (e.overT > 0) mul *= 1 + d.overload.speed; if (e.under && d.burrow) mul *= d.burrow.speed;
    $('inSpeed').textContent = `${fmt(d.speed * e.pace * mul)} tiles/s`;
    const fx = STATUS_FX(e), key = fx.map((f) => f[0]).join('|');
    if (key !== ui.inspectFx) {
      ui.inspectFx = key;
      $('inFx').innerHTML = fx.length ? fx.map(([t, k]) => `<span class="chip st-${k}">${t}</span>`).join('') : '<span class="small muted">No status effects</span>';
    }
  }
  $('inspect').addEventListener('click', (ev) => { if (ev.target.closest('[data-act="close-inspect"]') && state) state.inspect = null; });

  $('panel').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b || b.disabled || !state) return;
    const s = state.selected;
    const t = s && s.kind === 'tower' ? s.tower : null;
    switch (b.dataset.act) {
      case 'buy': if (t) upgrade(t, b.dataset.c); break;
      case 'stats': ui.statsOpen = !ui.statsOpen; break;
      case 'target': if (t) t.targetMode = b.dataset.m; break;
      case 'sell': if (t) sell(t); break;
      case 'close': state.selected = null; state.build = null; ui.help = false; break;
    }
    ui.panelKey = '';
  });
  $('buildList').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-build]');
    if (b && state) { setBuild(b.dataset.build); sfx('click'); }
  });
  // Build bar gestures:
  //  - drag a card up onto the map: carry that tower and drop it where you let go
  //  - drag sideways with the mouse (or use the wheel): scroll through the towers
  // Neither counts as a click, so you never pick a tower by accident.
  const bar = $('buildBar');
  const drag = { down: false, mode: null, x: 0, y: 0, left: 0, key: null, suppress: false };
  bar.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !state || state.over) return;
    const card = ev.target.closest('[data-build]');
    Object.assign(drag, { down: true, mode: null, x: ev.clientX, y: ev.clientY, left: bar.scrollLeft, key: card ? card.dataset.build : null });
  });
  window.addEventListener('pointermove', (ev) => {
    if (!drag.down) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (!drag.mode) {
      if (drag.key && towerOpen(drag.key) && dy < -8 && Math.abs(dy) > Math.abs(dx)) {
        drag.mode = 'carry';
        state.build = drag.key; state.selected = null; ui.help = false;
        if (!TW[drag.key].directional && TW[drag.key].shape.length === 1) state.dir = 0;
        bar.classList.add('carrying');
        sfx('click');
      } else if (ev.pointerType === 'mouse' && Math.abs(dx) > 4) {
        drag.mode = 'scroll';
        bar.classList.add('dragging');
      }
    }
    if (drag.mode === 'scroll') bar.scrollLeft = drag.left - dx;
    if (drag.mode === 'carry') state.hover = canvasPoint(ev);
  });
  function endDrag(ev, cancelled) {
    if (!drag.down) return;
    drag.down = false;
    const mode = drag.mode;
    drag.mode = null;
    bar.classList.remove('dragging', 'carrying');
    if (!mode) return;
    drag.suppress = true;
    setTimeout(() => { drag.suppress = false; }, 0);
    if (mode !== 'carry') return;
    const overMap = !cancelled && document.elementFromPoint(ev.clientX, ev.clientY) === canvas;
    if (overMap) {
      state.hover = canvasPoint(ev);
      const g = ghostInfo();
      if (g.ok) {
        const t = placeTower(state.build, state.dir, g.ax, g.ay);
        if (t && !ev.shiftKey) { state.build = null; state.selected = { kind: 'tower', tower: t }; }
        return;
      }
      sfx('error');
    }
    if (!ev.shiftKey) state.build = null;
  }
  window.addEventListener('pointerup', (ev) => endDrag(ev, false));
  window.addEventListener('pointercancel', (ev) => endDrag(ev, true));
  bar.addEventListener('click', (ev) => { if (drag.suppress) { ev.stopPropagation(); ev.preventDefault(); } }, true);
  bar.addEventListener('wheel', (ev) => {
    if (bar.scrollWidth <= bar.clientWidth || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
    bar.scrollLeft += ev.deltaY; ev.preventDefault();
  }, { passive: false });
  $('waveBtn').addEventListener('click', () => state && sendWave());
  $('speedBtn').addEventListener('click', () => { if (state) state.speed = state.speed >= 2 ? 1 : state.speed + 1; });
  $('pauseBtn').addEventListener('click', () => { if (state) state.paused = !state.paused; });
  const ICON_SOUND = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 5.5c1 1.4 1 3.6 0 5M13 3.5c2 2.5 2 6.5 0 9" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  const ICON_MUTE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.5"/></svg>';
  function toggleMute() { if (window.TD_SFX) { window.TD_SFX.setMuted(!window.TD_SFX.muted); syncSettings(); } }
  function syncAuto() {
    const b = $('autoBtn');
    b.setAttribute('aria-pressed', ui.auto);
    b.title = ui.auto ? `Auto-start is on: the next wave starts ${C.AUTO_WAVE_DELAY}s after the field clears (A)` : 'Auto-start next wave (A)';
  }
  function toggleAuto() {
    ui.auto = !ui.auto;
    try { localStorage.setItem('tw-auto', ui.auto ? '1' : '0'); } catch (e) { /* storage blocked */ }
    syncAuto(); sfx('click');
  }
  $('autoBtn').addEventListener('click', toggleAuto);
  syncAuto();
  $('helpBtn').addEventListener('click', () => {
    ui.help = !ui.help;
    if (ui.help && state) { state.selected = null; state.build = null; }
  });
  function toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement) d.exitFullscreen?.().catch(() => {});
    else d.documentElement.requestFullscreen?.().catch(() => {});
  }
  $('settingsFsBtn').addEventListener('click', toggleFullscreen);
  // iPhone Safari has no full-screen API for pages; do not offer a button that does nothing
  if (!document.documentElement.requestFullscreen) $('settingsFsBtn').hidden = true;
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    $('settingsFsBtn').setAttribute('aria-pressed', on);
    $('settingsFsBtn').textContent = on ? 'Exit full screen' : 'Full screen';
  });

  // ---------- main menu ----------
  // the home screen or the campaign map: either covers the game
  const menuOpen = () => !$('menu').hidden || !$('campaign').hidden;
  function showMenu() {
    $('overlay').hidden = true;
    hideCampaign();
    closeMenuCards();
    $('menu').hidden = false;
    if (window.TD_MENU_ART) window.TD_MENU_ART.start($('menuArt'));
    syncSettings();
    syncMenu();
  }
  function hideMenu() {
    $('menu').hidden = true;
    if (window.TD_MENU_ART) window.TD_MENU_ART.stop();
  }
  const MENU_CARDS = { settingsCard: 'settingsBtn', howCard: 'howBtn', statsCard: 'statsBtn', mapCard: 'endlessBtn' };
  const settingsToggles = ['settingsBtn', 'gearBtn'];
  function openMenuCard(id) {
    const open = $(id).hidden;
    closeMenuCards();
    if (!open) return;
    $(id).hidden = false;
    $(MENU_CARDS[id]).setAttribute('aria-expanded', 'true');
    if (id === 'settingsCard') { $('gearBtn').setAttribute('aria-expanded', 'true'); syncSettings(); }
    if (id === 'statsCard') renderStats();
    sfx('click');
  }
  function closeMenuCards() {
    for (const id in MENU_CARDS) { $(id).hidden = true; $(MENU_CARDS[id]).setAttribute('aria-expanded', 'false'); }
    $('gearBtn').setAttribute('aria-expanded', 'false');
  }
  // Endless: which map, remembered between visits where the browser allows it. The finale's map is the main
  // Endless map: first in the list and the pick until another is chosen.
  const MAIN_MAP = levelMap(C.CAMPAIGN.length - 1);
  let chosenMap = MAIN_MAP;
  try {
    const v = parseInt(localStorage.getItem('voltaic.map'), 10);
    if (v >= 0) chosenMap = clamp(v, 0, C.MAPS.length - 1);
  } catch (e) { /* storage blocked */ }
  // Campaign progress: the maps of the levels won. Keyed by map name so reordering levels keeps it.
  const CAMP_KEY = 'voltaic.campaign';
  function loadCampaign() {
    try { const c = JSON.parse(localStorage.getItem(CAMP_KEY)); if (c && c.v === 1) return c; } catch (e) { /* storage blocked */ }
    return { v: 1, beaten: [] };
  }
  function beatLevel(i, master) {
    if (state.noStats) return;
    const c = loadCampaign(), name = C.CAMPAIGN[i].map;
    if (master) { c.master = c.master || []; if (!c.master.includes(name)) c.master.push(name); } // master mode never opens the next level
    else if (!c.beaten.includes(name)) c.beaten.push(name);
    try { localStorage.setItem(CAMP_KEY, JSON.stringify(c)); } catch (e) { /* storage blocked */ }
  }
  // the first playable level not yet won (the last playable one once all are)
  function nextLevel() {
    const b = loadCampaign().beaten, ready = C.CAMPAIGN.map((l, i) => i).filter((i) => !C.CAMPAIGN[i].soon);
    const i = ready.find((k) => !b.includes(C.CAMPAIGN[k].map));
    return i === undefined ? ready[ready.length - 1] : i;
  }
  // Endless opens once every playable level is won: [won, playable]
  function campaignProgress() {
    const b = loadCampaign().beaten, ready = C.CAMPAIGN.filter((l) => !l.soon);
    return [ready.filter((l) => b.includes(l.map)).length, ready.length];
  }
  const endlessOpen = () => { const [won, all] = campaignProgress(); return won >= all; };
  function syncMenu() {
    const i = nextLevel(), l = C.CAMPAIGN[i];
    $('menuMapName').textContent = `Level ${i + 1}: ${l.map}`;
    const [won, all] = campaignProgress(), open = won >= all;
    $('endlessBtn').setAttribute('aria-disabled', String(!open));
    $('endlessNote').textContent = open ? 'Pick a map. The waves never stop.' : `Clear all ${all} campaign levels to unlock (${won}/${all}).`;
    const sv = loadSave();
    $('continueBtn').hidden = !sv;
    $('saveWarn').hidden = !sv;
    if (sv) {
      $('continueNote').textContent = `${sv.map} · wave ${sv.wave} cleared · ${sv.lives} power · ${sv.gold}g`;
      $('saveWarn').textContent = `A new run replaces your saved one (${sv.map}, wave ${sv.wave}) once its first wave is cleared.`;
    }
    const best = loadStats().best;
    const order = [MAIN_MAP, ...C.MAPS.map((m, k) => k).filter((k) => k !== MAIN_MAP)];
    $('mapPick').innerHTML = order.map((k) => {
      const m = C.MAPS[k], b = best[`${m.name}|endless`];
      return `<button class="map-opt" data-map="${k}" aria-current="${k === chosenMap}"><b>${m.name}</b>${k === MAIN_MAP ? '<u>Main map</u>' : ''}<em>${m.blurb || ''}</em>${b ? `<i>Best: ${b} waves</i>` : ''}</button>`;
    }).join('');
  }
  $('mapPick').addEventListener('click', (ev) => {
    const b = ev.target.closest('.map-opt');
    if (!b) return;
    chosenMap = +b.dataset.map;
    try { localStorage.setItem('voltaic.map', String(chosenMap)); } catch (e) { /* storage blocked */ }
    sfx('upgrade'); newGame('endless', chosenMap);
  });
  $('campaignBtn').addEventListener('click', () => { sfx('upgrade'); showCampaign(); });
  $('endlessBtn').addEventListener('click', () => {
    if (endlessOpen()) { openMenuCard('mapCard'); return; }
    sfx('error'); const b = $('endlessBtn'); b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
  });
  $('continueBtn').addEventListener('click', () => { sfx('upgrade'); restoreRun(); });
  document.querySelectorAll('.mitem').forEach((b) => b.addEventListener('pointerenter', () => sfx('click')));
  $('howBtn').addEventListener('click', () => openMenuCard('howCard'));
  $('statsBtn').addEventListener('click', () => openMenuCard('statsCard'));
  for (const id of settingsToggles) $(id).addEventListener('click', () => openMenuCard('settingsCard'));
  // in play, a press outside the settings card closes it (the menu has its own handler below)
  document.addEventListener('pointerdown', (ev) => {
    if (!menuOpen() && !$('settingsCard').hidden && !ev.target.closest('#settingsCard, #gearBtn')) closeMenuCards();
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeMenuCards));
  // a click on the open sky closes a card
  $('menu').addEventListener('pointerdown', (ev) => {
    if (!ev.target.closest('.menu-card, .menu-top, .mitem')) closeMenuCards();
  });

  // settings: music and effects volume, and the same mute as the in-game button
  function syncSettings() {
    const S = window.TD_SFX;
    for (const [id, kind] of [['volMusic', 'music'], ['volSfx', 'sfx']]) {
      const v = Math.round((S ? S.volume(kind) : 1) * 100), el = $(id);
      el.value = v; el.style.setProperty('--fill', `${v}%`);
      $(`${id}Out`).textContent = v;
    }
    const m = !!(S && S.muted);
    $('menuMuteBtn').setAttribute('aria-pressed', m);
    $('menuMuteBtn').textContent = m ? 'Unmute' : 'Mute all';
    $('homeBtn').hidden = menuOpen();
    const pb = $('postBtn');
    pb.hidden = !post.ok; pb.setAttribute('aria-pressed', post.on); pb.textContent = post.on ? 'Visual polish: on' : 'Visual polish: off';
    armHome(false);
  }
  $('postBtn').addEventListener('click', () => { setPost(!post.on); syncSettings(); sfx('click'); });
  for (const [id, kind] of [['volMusic', 'music'], ['volSfx', 'sfx']]) {
    $(id).addEventListener('input', (ev) => {
      const S = window.TD_SFX;
      if (!S) return;
      if (S.muted) S.setMuted(false); // turning a volume up means you want to hear it
      S.setVolume(kind, ev.target.value / 100);
      syncSettings();
      if (kind === 'sfx') sfx('pop');
    });
  }
  $('menuMuteBtn').addEventListener('click', () => { toggleMute(); syncSettings(); });
  $('ovStart').addEventListener('click', () => (nextStart === 'carry' ? continueEndless() : newGame(...(nextStart || lastStart))));
  // after a campaign game, back to the campaign map with the next level picked
  $('ovMenu').addEventListener('click', () => {
    if (!state.level) { showMenu(); return; }
    const i = state.levelIdx;
    showCampaign(state.won && i + 1 < C.CAMPAIGN.length ? i + 1 : i);
  });

  // ---------- campaign map ----------
  // The city plan (campaign-art.js) with a marker per level. Picking a marker fills the level card; the plan
  // is only repainted when the page opens or the window changes size, since its lights follow progress.
  const campOpen = () => !$('campaign').hidden;
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const levelName = (l) => l.map || l.name;
  const STATE_NAME = { won: 'Won', open: 'Ready', locked: 'Locked', soon: 'Coming soon' };
  // won, open (playable now), locked (opens when the level before is won) or soon (still being designed)
  function levelStates() {
    const b = loadCampaign().beaten;
    return C.CAMPAIGN.map((l, i) => (l.soon ? 'soon' : b.includes(l.map) ? 'won'
      : i === 0 || b.includes(C.CAMPAIGN[i - 1].map) ? 'open' : 'locked'));
  }
  let campSel = 0, campStates = [];
  function showCampaign(sel = nextLevel()) {
    $('menu').hidden = true;
    if (window.TD_MENU_ART) window.TD_MENU_ART.stop();
    closeMenuCards();
    $('overlay').hidden = true;
    $('campaign').hidden = false;
    campSel = sel;
    campStates = levelStates();
    // the district's badge in the diamond, the numeral beside the name (the numeral alone if a level has no badge)
    const badge = (l) => (window.TD_CAMP_ART && window.TD_CAMP_ART.icon(levelName(l))) || '';
    $('campNodes').innerHTML = C.CAMPAIGN.map((l, i) => { const ic = badge(l); return `<button class="cnode" data-lv="${i}">${ic ? `<b class="ic">${ic}</b>` : `<b>${ROMAN[i]}</b>`}<span class="nm">${ic ? `<i>${ROMAN[i]}</i>` : ''}${esc(levelName(l))}</span></button>`; }).join('');
    levelCard();
    paintCampaign();
    const b = document.querySelector(`.cnode[data-lv="${campSel}"]`);
    if (b) b.focus({ preventScroll: true });
  }
  function hideCampaign() { $('campaign').hidden = true; }
  // the plan fits the screen beside the level card (above it on phones, where the card is a fixed-height sheet)
  function paintCampaign() {
    const W = window.innerWidth, H = window.innerHeight;
    const head = $('campHead').getBoundingClientRect(), card = $('levelCard').getBoundingClientRect();
    const area = W > 760 ? { x: 16, y: head.bottom + 10, w: card.left - 40, h: H - head.bottom - 40 }
      : { x: 10, y: head.bottom + 8, w: W - 20, h: card.top - head.bottom - 28 };
    const nodes = C.CAMPAIGN.map((l, i) => ({ at: l.at, state: campStates[i] }));
    const box = window.TD_CAMP_ART ? window.TD_CAMP_ART.paint($('campArt'), nodes, area) : area;
    document.querySelectorAll('.cnode').forEach((b) => {
      const at = C.CAMPAIGN[+b.dataset.lv].at;
      b.style.left = `${box.x + at[0] * box.w}px`; b.style.top = `${box.y + at[1] * box.h}px`;
    });
    syncNodes();
  }
  function syncNodes() {
    document.querySelectorAll('.cnode').forEach((b) => {
      const i = +b.dataset.lv, st = campStates[i];
      b.className = `cnode ${st}${i === campSel ? ' sel' : ''}`;
      b.setAttribute('aria-pressed', String(i === campSel));
      b.setAttribute('aria-label', `Level ${i + 1}, ${levelName(C.CAMPAIGN[i])}: ${STATE_NAME[st]}`);
    });
  }
  const iconHtml = (src, color) => (src ? `<img src="${src}" alt="" draggable="false">` : `<span class="sw" style="background:${color}"></span>`);
  // master mode is offered on every level once that level is won
  const masterOpen = (l, st) => !l.soon && st === 'won';
  function levelCard() {
    const i = campSel, l = C.CAMPAIGN[i], st = campStates[i], play = st === 'open' || st === 'won';
    // towers and robots this level brings in (not in the level before) get a New tag
    const prev = i > 0 ? C.CAMPAIGN[i - 1] : null;
    const list = (keys, D, icon, field) => keys.map((k) => `<span class="lc-item"><span class="lc-ico">${iconHtml(icon(k), D[k].color)}</span>${D[k].name}${
      prev && !(prev[field] || []).includes(k) ? '<em class="lc-new">New</em>' : ''}</span>`).join('');
    $('levelCard').innerHTML = `<div class="lc-body">
      <p class="eyebrow">Level ${ROMAN[i]}</p>
      <h3 class="lc-name">${esc(levelName(l))}</h3>
      <span class="lc-state ${st}">${STATE_NAME[st]}</span>
      <p class="lc-brief">${esc(l.brief || '')}</p>
      ${play ? `<dl class="lc-facts"><div><dt>Waves</dt><dd>${l.waves}</dd></div><div><dt>Power</dt><dd>${startLives(l)}</dd></div><div><dt>Gold</dt><dd>${l.gold || C.START_GOLD}</dd></div></dl>
      <p class="label">Your towers</p><div class="lc-list">${list(l.towers, TW, towerIcon, 'towers')}</div>
      <p class="label">The machines</p><div class="lc-list">${list(l.enemies, EN, enemyIcon, 'enemies')}</div></div>
      <button class="btn primary lc-play" id="levelPlay">${st === 'won' ? 'Play again' : 'Play'}</button>
      ${masterOpen(l, st) ? `<button class="btn lc-play lc-master" id="levelMaster">Master mode: 1 power${loadCampaign().master?.includes(l.map) ? ' (cleared)' : ''}</button>` : ''}`
      : `<p class="lc-note">${st === 'soon' ? 'This district is still being built.' : `Win level ${ROMAN[i - 1]} to open it.`}</p></div>`}`;
  }
  function pickLevel(i) {
    if (i === campSel || i < 0 || i >= C.CAMPAIGN.length) return;
    campSel = i; sfx('click');
    levelCard(); syncNodes();
  }
  function playLevel(i, master = false) {
    if (campStates[i] !== 'open' && campStates[i] !== 'won') return;
    if (master && !masterOpen(C.CAMPAIGN[i], campStates[i])) return;
    sfx('upgrade'); newGame('normal', null, i, master);
  }
  $('campNodes').addEventListener('click', (ev) => {
    const b = ev.target.closest('.cnode');
    if (b) pickLevel(+b.dataset.lv);
  });
  $('campNodes').addEventListener('dblclick', (ev) => {
    const b = ev.target.closest('.cnode');
    if (b) playLevel(+b.dataset.lv);
  });
  $('levelCard').addEventListener('click', (ev) => {
    if (ev.target.closest('#levelPlay')) playLevel(campSel);
    else if (ev.target.closest('#levelMaster')) playLevel(campSel, true);
  });
  $('campBack').addEventListener('click', () => { sfx('click'); showMenu(); });
  function campKey(k, ev) {
    if (k === 'f') toggleFullscreen();
    else if (k === 'escape') showMenu();
    else if (k === 'arrowright' || k === 'arrowdown') { ev.preventDefault(); pickLevel(campSel + 1); }
    else if (k === 'arrowleft' || k === 'arrowup') { ev.preventDefault(); pickLevel(campSel - 1); }
    else if (k === 'enter' && !ev.target.closest('button:not(.cnode)')) { ev.preventDefault(); playLevel(campSel); }
    const b = document.querySelector(`.cnode[data-lv="${campSel}"]`);
    if (b && k.startsWith('arrow')) b.focus({ preventScroll: true });
  }
  let campResize = 0;
  window.addEventListener('resize', () => {
    if (!campOpen()) return;
    cancelAnimationFrame(campResize);
    campResize = requestAnimationFrame(paintCampaign);
  });

  // ---------- statistics ----------
  // All-time totals plus the last STATS_KEEP games, in localStorage. A game counts once: when it is won, lost, or
  // left (Back to home, or closing the page) after the first wave was sent. A saved Endless run is not left: it
  // counts when it is lost, or when another run takes its save slot.
  const STATS_KEY = 'voltaic.stats', STATS_KEEP = 100;
  const freshStats = () => ({ v: 1, runs: [], tot: { games: 0, won: 0, lost: 0, quit: 0, kills: 0, leaked: 0, time: 0, spent: 0, dmg: {}, built: {}, killsBy: {} }, best: {} });
  function loadStats() {
    try { const s = JSON.parse(localStorage.getItem(STATS_KEY)); if (s && s.v === 1) return s; } catch (e) { /* storage blocked */ }
    return freshStats();
  }
  const addAll = (into, from) => { for (const k in from) into[k] = (into[k] || 0) + from[k]; };
  function recordRun(out) {
    if (!state || state.run.recorded || state.wave < 1 || state.noStats) return;
    state.run.recorded = true;
    const { run, wave, kills, leaked, time } = state;
    tally(out, { run, wave, kills, leaked, time, map: mapDef.name, mode: state.master ? 'master' : state.mode });
  }
  // g: a game as it stands, live or saved: { run, wave, kills, leaked, time, map (name), mode }
  function tally(out, g) {
    const S = loadStats(), r = g.run, tot = S.tot;
    // a game carried on into Endless counts only what happened after the carry
    const f = r.from || { kills: 0, leaked: 0, time: 0 }, kills = g.kills - f.kills, time = g.time - f.time;
    tot.games++; tot[out]++;
    tot.kills += kills; tot.leaked += g.leaked - f.leaked; tot.time += time; tot.spent += r.spent;
    addAll(tot.dmg, r.dmg); addAll(tot.built, r.built); addAll(tot.killsBy, r.killsBy);
    // best wave held per map and mode: a loss on wave n held n - 1 waves; a win or a quit held the waves sent
    const held = out === 'lost' ? g.wave - 1 : g.wave, bk = `${g.map}|${g.mode}`;
    S.best[bk] = Math.max(S.best[bk] || 0, held);
    S.runs.push({ at: Date.now(), map: g.map, mode: g.mode, out, wave: g.wave, kills, time: Math.round(time) });
    if (S.runs.length > STATS_KEEP) S.runs.splice(0, S.runs.length - STATS_KEEP);
    try { localStorage.setItem(STATS_KEY, JSON.stringify(S)); } catch (e) { /* storage blocked */ }
  }
  window.addEventListener('pagehide', () => { if (state && !state.over) leaveRun(); });

  // ---------- saved Endless run ----------
  // One slot in localStorage, written only while the field is clear: when a wave is cleared, just before the next
  // one is sent, and on leaving. Robots, shots and fire are never saved, so a run resumes between waves. Waves
  // are seeded by their number, so the wave number is all it takes to get the same ones again.
  const SAVE_KEY = 'voltaic.save';
  // tower fields that are rebuilt on load: config, derived stats and references to robots
  const TOWER_LIVE = ['id', 'def', 's', 'beams', 'beamK', 'focus', 'lockE', 'trackE', 'heat', 'mineSpots', 'mineR'];
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      // a save naming a map or tower that no longer exists is ignored
      if (s && s.v === 1 && C.MAPS.some((m) => m.name === s.map) && s.towers.every((t) => TW[t.key])) return s;
    } catch (e) { /* storage blocked */ }
    return null;
  }
  const ownsSave = () => { const s = loadSave(); return !!s && s.id === state.saveId; };
  function saveRun() {
    if (!state || state.mode !== 'endless' || state.over || state.noStats || state.wave < 1 || state.activeWaves.size || state.spawnQueue.length) return;
    const old = loadSave();
    // a run that has lost the slot to another (a second tab) leaves it alone; a new run takes it over
    if (old && old.id !== state.saveId && state.saveId) return;
    const id = state.saveId || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const { wave, gold, lives, kills, leaked, time, banked, bankAsked, speed, run } = state;
    const towers = state.towers.map((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !TOWER_LIVE.includes(k))));
    const mines = state.mines.map((m) => ({ ...m, src: state.towers.indexOf(m.src), poly: routes.indexOf(m.poly), stuck: !!m.stuck }));
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, id, map: mapDef.name, size: [COLS, ROWS], wave, gold, lives, kills, leaked, time, banked, bankAsked, speed, run, towers, mines }));
    } catch (e) { return; /* storage blocked */ }
    state.saveId = id;
    if (old && old.id !== id) tally('quit', { ...old, mode: 'endless' });
  }
  function dropSave() {
    if (!ownsSave()) return;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage blocked */ }
  }
  // leaving a game: save it if the field is clear; a run with no save of its own counts as left
  function leaveRun() {
    saveRun();
    if (!ownsSave()) recordRun('quit');
  }
  function restoreRun() {
    const sv = loadSave();
    if (!sv) return;
    newGame('endless', C.MAPS.findIndex((m) => m.name === sv.map), null, false, sv.size);
    const { id, wave, gold, lives, kills, leaked, time, banked, bankAsked, speed, run } = sv;
    Object.assign(state, { saveId: id, wave, gold, lives, kills, leaked, time, banked, bankAsked, speed, run });
    for (const d of sv.towers) {
      const t = { ...d, id: uid++, def: TW[d.key], s: null, beams: [], focus: null };
      for (const [x, y] of t.cells) state.occ[y][x] = t;
      state.towers.push(t);
    }
    // stats need every tower in place first: Amplifiers and neighbours feed into them
    for (const t of state.towers) {
      t.s = computeStats(t);
      if (t.def.kind === 'volley') t.ports = cornerPorts(t);
    }
    state.mines = sv.mines.map((m) => ({ ...m, src: state.towers[m.src], poly: routes[m.poly] || path, stuck: m.stuck ? { dead: true } : null })).filter((m) => m.src);
    // with auto-start on the next wave would march at once, so the game waits for the player
    state.paused = ui.auto;
    floatText((COLS * T) / 2, 3 * T, `Wave ${wave} cleared: run restored`, P.goldHi, 2.5);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveRun(); });

  const OUT = { won: { name: 'Won', color: 'var(--gold)' }, lost: { name: 'Lost', color: 'var(--ember)' }, quit: { name: 'Left', color: 'var(--muted)' } };
  const big = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);
  const hm = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // horizontal bars, biggest first: [name, value, colour, note]
  function barRows(rows, unit) {
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return rows.map(([name, v, color, note]) => `<div class="st-row" title="${esc(name)}: ${Math.round(v).toLocaleString()} ${unit}${note ? `, ${note}` : ''}">
      <span class="st-name">${esc(name)}</span><span class="st-track"><i style="width:${(v / max) * 100}%;background:${color}"></i></span>
      <b>${big(v)}</b><em>${note || ''}</em></div>`).join('');
  }
  // waves reached, one bar per game, oldest left; colour = how it ended
  function waveChart(runs) {
    const W = 320, H = 96, top = Math.max(WV.normalLength, ...runs.map((r) => r.wave)), n = runs.length;
    const slot = W / Math.max(n, 12), bw = Math.max(2, Math.min(14, slot - 2)), y = (v) => H - (v / top) * (H - 6);
    const bars = runs.map((r, i) => {
      const x = i * slot + (slot - bw) / 2, h = Math.max(2, H - y(r.wave));
      const d = new Date(r.at), when = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      return `<g class="st-bar"><rect x="${i * slot}" y="0" width="${slot}" height="${H}" fill="transparent"/>
        <path d="M${x} ${H}V${H - h + 2}q0 -2 2 -2h${bw - 4}q2 0 2 2V${H}z" fill="${OUT[r.out].color}"/>
        <title>${esc(r.map)}, ${r.mode === 'endless' ? 'Endless' : r.mode === 'master' ? 'Master' : 'Campaign'}: ${OUT[r.out].name.toLowerCase()} on wave ${r.wave}, ${r.kills} robots. ${when}</title></g>`;
    }).join('');
    const g = y(WV.normalLength);
    return `<svg class="st-waves" viewBox="0 0 ${W} ${H + 1}" preserveAspectRatio="none" role="img" aria-label="Waves reached in the last ${n} games">
      <line x1="0" x2="${W}" y1="${g}" y2="${g}" class="st-grid"/>${bars}<line x1="0" x2="${W}" y1="${H + 0.5}" y2="${H + 0.5}" class="st-base"/></svg>
      <div class="st-axis"><span>${n > 1 ? `${n} games ago` : ''}</span><span>latest</span></div>`;
  }
  function renderStats() {
    const S = loadStats(), t = S.tot, el = $('statsBody');
    if (!t.games) { el.innerHTML = '<p class="st-empty">No games yet. Send the first wave and your record starts here: every game you win, lose or leave counts.</p>'; $('statsReset').hidden = true; return; }
    $('statsReset').hidden = false; armReset(false);
    const bestOf = (mode) => Math.max(0, ...Object.entries(S.best).filter(([k]) => k.endsWith(`|${mode}`)).map(([, v]) => v));
    const tiles = [
      ['Games', t.games, `${t.won} won · ${t.lost} lost · ${t.quit} left`],
      ['Win rate', `${Math.round((t.won / Math.max(1, t.won + t.lost)) * 100)}%`, 'of games played out'],
      ['Robots destroyed', big(t.kills), `${big(t.leaked)} reached the Exchange`],
      ['Best endless', bestOf('endless') || '–', 'waves held'],
      ['Time defended', hm(t.time), 'game time'],
      ['Gold spent', big(t.spent), 'towers and upgrades'],
    ].map(([k, v, s]) => `<div class="st-tile"><span>${k}</span><b>${v}</b><em>${s}</em></div>`).join('');
    const runs = S.runs.slice(-30);
    const totalDmg = Object.values(t.dmg).reduce((a, b) => a + b, 0) || 1;
    const dmgRows = Object.keys(TW).filter((k) => t.dmg[k] || t.built[k])
      .map((k) => [TW[k].name, t.dmg[k] || 0, TW[k].color || 'var(--gold)', `${Math.round(((t.dmg[k] || 0) / totalDmg) * 100)}% · built ${t.built[k] || 0}`])
      .sort((a, b) => b[1] - a[1]);
    const killRows = Object.keys(t.killsBy).filter((k) => EN[k]).map((k) => [EN[k].name, t.killsBy[k], EN[k].color]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const mapRows = C.MAPS.map((m) => {
      const mine = S.runs.filter((r) => r.map === m.name);
      return `<tr><th>${esc(m.name)}</th><td>${S.best[`${m.name}|normal`] || '–'}</td><td>${S.best[`${m.name}|endless`] || '–'}</td><td>${mine.filter((r) => r.out === 'won').length}/${mine.length}</td></tr>`;
    }).join('');
    const legend = Object.values(OUT).map((o) => `<span><i style="background:${o.color}"></i>${o.name}</span>`).join('') +
      `<span><i class="dash"></i>Wave ${WV.normalLength}, campaign won</span>`;
    el.innerHTML = `<div class="st-tiles">${tiles}</div>
      <div class="st-sec"><p class="label">Waves reached · last ${runs.length} games</p><div class="st-legend">${legend}</div>${waveChart(runs)}</div>
      ${dmgRows.length ? `<div class="st-sec"><p class="label">Damage by tower · all time</p>${barRows(dmgRows, 'damage')}</div>` : ''}
      ${killRows.length ? `<div class="st-sec"><p class="label">Robots destroyed · all time</p>${barRows(killRows, 'destroyed')}</div>` : ''}
      <div class="st-sec"><p class="label">Maps</p><table class="st-maps"><thead><tr><th></th><td>Campaign best</td><td>Endless best</td><td>Won (last ${STATS_KEEP})</td></tr></thead><tbody>${mapRows}</tbody></table></div>`;
  }
  // two presses to wipe: the first arms the button for a few seconds
  let resetArmed = 0;
  function armReset(on) {
    clearTimeout(resetArmed); resetArmed = on ? setTimeout(() => armReset(false), 3000) : 0;
    $('statsReset').textContent = on ? 'Press again to erase' : 'Reset statistics';
    $('statsReset').classList.toggle('warn', on);
  }
  $('statsReset').addEventListener('click', () => {
    if (!resetArmed) { armReset(true); sfx('click'); return; }
    armReset(false);
    try { localStorage.removeItem(STATS_KEY); } catch (e) { /* storage blocked */ }
    renderStats();
  });
  // Settings > Back to home: two presses too, since it ends the game. The game counts as left.
  let homeArmed = 0;
  function armHome(on) {
    clearTimeout(homeArmed); homeArmed = on ? setTimeout(() => armHome(false), 3000) : 0;
    if (on) saveRun();
    const sv = on && state && loadSave();
    $('homeBtn').textContent = !on ? 'Back to home' : sv && sv.id === state.saveId ? `Leave? Saved at wave ${sv.wave}` : 'Leave this game?';
    $('homeBtn').classList.toggle('warn', on);
  }
  $('homeBtn').addEventListener('click', () => {
    if (!homeArmed) { armHome(true); sfx('click'); return; }
    armHome(false);
    if (!state.over) leaveRun();
    state.paused = true;
    showMenu();
  });

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    const wall = Math.min(0.5, (now - last) / 1000), real = Math.min(0.05, wall);
    last = now;
    if (state && !state.paused && !state.over) {
      const n = state.speed * 2;
      for (let i = 0; i < n; i++) step(real / 2);
    } else if (state) {
      updateEffects(0);
      tickBlackout(wall);   // a presentation beat: runs on wall-clock time even when frames are slow
      for (const t of state.towers) t.s = computeStats(t);
    }
    // The menu covers the whole screen, so the city is not drawn behind it.
    const inMenu = menuOpen();
    if (state && !inMenu) { render(); updateUI(); }
    // Home-screen music while the menu or end screen is up, game music otherwise.
    // Pausing mid-game ducks the game music.
    const inPlay = !inMenu && $('overlay').hidden;
    if (window.TD_SFX) window.TD_SFX.music(inPlay ? 'game' : 'home', inPlay && !!(state && state.paused));
    requestAnimationFrame(frame);
  }

  // Debug handle for playtesting from the console.
  window.__td = { camera, cam, hideMenu, showMenu, renderStats, get state() { return state; }, get grid() { return grid; }, get path() { return path; }, get flyPath() { return flyPath; }, get routes() { return routes; }, get flyPaths() { return flyPaths; }, ui, newGame, placeTower, sendWave, upgrade, canBuy, sell, towerLook, baseStats, step, makeWave, computeStats, cellProblem, spawn, damage, roadSight, continueEndless, saveRun, loadSave, restoreRun };

  // Boot: a paused board under the main menu.
  $('menuGrain').style.backgroundImage = `url(${A.grainURL()})`;
  buildBuildList();
  newGame('normal', null, nextLevel());
  state.paused = true;
  showMenu();
  requestAnimationFrame(frame);
})();
