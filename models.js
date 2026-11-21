// Voltaic models: the city, the defense towers and the robots, assembled from simple solids in three.js.
// Units are tiles (1 = one map tile), +X east, +Z south, +Y up. Models face +X. No game state lives here.
window.TD_MODELS = (() => {
  'use strict';
  const THREE = window.THREE;
  if (!THREE) return null;
  const P = window.TD_ART.P;
  const TAU = Math.PI * 2;
  let M = null; // shared materials, created by init()

  // ---------- materials ----------
  // One small texture tiles every facade. Two kinds: Deco piers with a window lit about one time in three,
  // and ribbon windows in long bands, mostly amber with the odd teal or pink room.
  function windowTextures(ribbon) {
    const n = 8, cell = 32, S = n * cell;
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
    const a = mk(), b = mk(), ga = a.getContext('2d'), gb = b.getContext('2d');
    ga.fillStyle = ribbon ? '#0a1626' : '#090e1f'; ga.fillRect(0, 0, S, S);
    gb.fillStyle = '#000'; gb.fillRect(0, 0, S, S);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i * cell, y = j * cell;
      if (ribbon) {
        const k = Math.random(), lit = k < 0.42, col = k < 0.32 ? '#ffb347' : k < 0.38 ? P.teal : P.pink;
        ga.fillStyle = 'rgba(160, 190, 210, 0.35)'; ga.fillRect(x, y + 7, cell, 1); ga.fillRect(x, y + 24, cell, 1);
        ga.fillStyle = lit ? col : '#050b14'; ga.fillRect(x, y + 9, cell, 14);
        ga.fillStyle = '#0a1626'; ga.fillRect(x, y + 9, 2, 14);
        if (lit) { gb.fillStyle = col; gb.fillRect(x + 2, y + 9, cell - 2, 14); }
      } else {
        const lit = Math.random() < 0.34;
        ga.fillStyle = 'rgba(212, 175, 90, 0.8)'; ga.fillRect(x, y, 2, cell);
        ga.fillStyle = 'rgba(212, 175, 90, 0.3)'; ga.fillRect(x, y, cell, 1);
        ga.fillStyle = lit ? P.lantern : '#04070f';
        ga.fillRect(x + 11, y + 8, 12, 17);
        if (lit) { gb.fillStyle = '#ffa63d'; gb.fillRect(x + 11, y + 8, 12, 17); }
      }
    }
    return [a, b].map((c) => {
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
      return t;
    });
  }
  // the soft disc of light round every neon sign
  function haloTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  // The night sky the metal and marble reflect: deep navy, a warm glow on the horizon, and neon in coral, teal and pink.
  function makeEnv(renderer) {
    const s = new THREE.Scene();
    s.background = new THREE.Color(0x05070f);
    const basic = (c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
    s.add(new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 7, 24, 1, true), basic(0x4a2e0c)));
    s.add(new THREE.Mesh(new THREE.CylinderGeometry(19, 19, 1.6, 24, 1, true), basic(0xd89a3c)));
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 2.4), basic([0xffd98a, 0xff6f61, 0x2ee6cf, 0xff4fa8][i % 4]));
      const a = (i / 8) * TAU; m.position.set(Math.cos(a) * 13, 6 + (i % 3) * 3, Math.sin(a) * 13); s.add(m);
    }
    const sky = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, 16), basic(0x070b18)); sky.position.y = 19; s.add(sky);
    const pm = new THREE.PMREMGenerator(renderer);
    const tex = pm.fromScene(s, 0.03).texture;
    pm.dispose();
    return tex;
  }

  function init(renderer) {
    const envMap = makeEnv(renderer);
    const [map, emissiveMap] = windowTextures(false), [mapB, emissiveMapB] = windowTextures(true);
    // Reflection fade. In the mirrored pass world Y is negated, so the height above the ground is max(-vWorldY, 0).
    // Only pass 1 sets uRefl = 1, so the real city in pass 2 is untouched.
    const REFL = { uRefl: { value: 0 }, uReflDepth: { value: 2.5 } }; // depth in tiles, shared by every hooked material
    const reflect = (mat) => {
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, REFL);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uRefl;\nuniform float uReflDepth;\nvarying float vWorldY;')
          .replace('#include <fog_fragment>', 'float hgt = max(-vWorldY, 0.0);\ngl_FragColor.rgb *= mix(1.0, clamp(1.0 - hgt / uReflDepth, 0.25, 1.0), uRefl);\n#include <fog_fragment>');
      };
      return mat;
    };
    const std = (o) => reflect(new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 1.1, ...o }));
    const lit = (c, k) => std({ color: 0x000000, emissive: new THREE.Color(c), emissiveIntensity: k, roughness: 0.4, metalness: 0 });
    const neon = (c) => reflect(new THREE.MeshBasicMaterial({ color: new THREE.Color(c), toneMapped: false }));
    M = {
      envMap, std, REFL, reflect,
      facade: std({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.5, metalness: 0.4, roughness: 0.34 }),
      facadeB: std({ map: mapB, emissiveMap: emissiveMapB, emissive: 0xffffff, emissiveIntensity: 1.6, metalness: 0.7, roughness: 0.22 }),
      neonCoral: neon(P.coral), neonTeal: neon(P.teal), neonPink: neon(P.pink), // not tone-mapped, so the colour stays pure
      halo: new THREE.PointsMaterial({ size: 1.5, map: haloTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      roof: std({ color: 0x070b1a, metalness: 0.45, roughness: 0.4 }),
      marble: std({ color: 0x0b0e18, metalness: 0.9, roughness: 0.14 }),
      navy: std({ color: 0x0a1126, metalness: 0.6, roughness: 0.28 }),
      terrace: std({ color: 0x121d3e, metalness: 0.5, roughness: 0.3 }),
      gold: std({ color: 0xd4af5a, metalness: 1, roughness: 0.25 }),
      goldTwo: std({ color: 0xd4af5a, metalness: 1, roughness: 0.3, side: THREE.DoubleSide }), // open shells, like the radar dish
      brass: std({ color: 0x9c7a45, metalness: 1, roughness: 0.34 }),
      copper: std({ color: 0xc98a52, metalness: 1, roughness: 0.3 }),
      gunmetal: std({ color: 0x2a3042, metalness: 0.9, roughness: 0.3 }),
      steel: std({ color: 0xa4a9b6, metalness: 1, roughness: 0.22 }),
      cream: lit(P.cream, 1.2), ember: lit(P.ember, 2.4), ice: lit(P.ice, 1.0), lilac: lit(P.lilac, 0.85),
      goldRim: lit(P.gold, 0.9),
      lantern: lit(P.lantern, 2), goldGlow: lit(P.goldHi, 1.6), dim: lit(P.goldLo, 0.5),
      line: new THREE.LineBasicMaterial({ color: 0xf3d88a, transparent: true, opacity: 0.8 }),
      ghost: new THREE.MeshBasicMaterial({ color: 0xf3d88a, transparent: true, opacity: 0.3, depthWrite: false }),
      ghostBad: new THREE.MeshBasicMaterial({ color: 0xff5a2e, transparent: true, opacity: 0.3, depthWrite: false }),
      shadeHi: new THREE.MeshBasicMaterial({ color: 0xefe4c8, transparent: true, opacity: 0.55, depthWrite: false }),
      shadeLo: new THREE.MeshBasicMaterial({ color: 0xefe4c8, transparent: true, opacity: 0.16, depthWrite: false }),
      body: new Map(),
    };
    return M;
  }
  const bodyMat = (color) => {
    let m = M.body.get(color);
    if (!m) { m = M.std({ color: new THREE.Color(color), metalness: 0.85, roughness: 0.3 }); M.body.set(color, m); }
    return m;
  };

  // a flat painted colour, for fabric and canvas that should not mirror the sky (the Troop Balloon's gores)
  const matteMat = (color) => {
    const key = `matte${color}`;
    let m = M.body.get(key);
    if (!m) { m = M.std({ color: new THREE.Color(color), metalness: 0.1, roughness: 0.6 }); M.body.set(key, m); }
    return m;
  };

  // ---------- batched solids: thousands of buildings in a handful of draw calls ----------
  class Batch {
    // plain = no line-work (neon tubes, metal trim)
    constructor(plain = false) { this.plain = plain; this.p = []; this.n = []; this.uv = []; this.i = []; this.rp = []; this.rn = []; this.ri = []; this.lp = []; }
    // x, z = centre; y = bottom. Walls get window UVs (three windows per tile); the roof is plain.
    box(x, y, z, w, h, d, edges = true) {
      const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y + h;
      const uo = Math.floor(Math.random() * 8) / 8, vo = Math.floor(Math.random() * 8) / 8;
      const side = (ax, az, bx, bz, nx, nz, len) => {
        const b = this.p.length / 3;
        this.p.push(ax, y, az, bx, y, bz, bx, y1, bz, ax, y1, az);
        for (let k = 0; k < 4; k++) this.n.push(nx, 0, nz);
        const u1 = uo + Math.max(1, Math.round(len * 3)) / 8, v1 = vo + Math.max(1, Math.round(h * 3)) / 8;
        this.uv.push(uo, vo, u1, vo, u1, v1, uo, v1);
        this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
      };
      side(x0, z1, x1, z1, 0, 1, w); side(x1, z1, x1, z0, 1, 0, d); side(x1, z0, x0, z0, 0, -1, w); side(x0, z0, x0, z1, -1, 0, d);
      const b = this.rp.length / 3;
      this.rp.push(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0);
      this.rn.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      this.ri.push(b, b + 1, b + 2, b, b + 2, b + 3);
      if (edges && !this.plain) {
        this.lp.push(x0, y1, z1, x1, y1, z1, x1, y1, z1, x1, y1, z0, x1, y1, z0, x0, y1, z0, x0, y1, z0, x0, y1, z1,
          x0, y, z1, x0, y1, z1, x1, y, z1, x1, y1, z1, x1, y, z0, x1, y1, z0, x0, y, z0, x0, y1, z0);
      }
    }
    // A prism, drum or cone round a vertical axis: radius r0 at the bottom, r1 at the top, seg sides.
    // o.rot turns it; o.under closes the bottom, for anything that overhangs.
    tube(x, y, z, r0, r1, h, seg = 12, o = {}) {
      const rot = o.rot || 0, y1 = y + h, da = TAU / seg;
      const uo = Math.floor(Math.random() * 8) / 8, vo = Math.floor(Math.random() * 8) / 8;
      const nu = Math.max(1, Math.round(2 * Math.max(r0, r1) * Math.sin(Math.PI / seg) * 3)), nv = Math.max(1, Math.round(h * 3));
      const sl = Math.hypot(h, r0 - r1) || 1, ny = (r0 - r1) / sl, nr = h / sl;
      const lines = !this.plain && o.edges !== false;
      for (let k = 0; k < seg; k++) {
        const a0 = rot - k * da, a1 = a0 - da, am = a0 - da / 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        const b = this.p.length / 3;
        this.p.push(x + c0 * r0, y, z + s0 * r0, x + c1 * r0, y, z + s1 * r0, x + c1 * r1, y1, z + s1 * r1, x + c0 * r1, y1, z + s0 * r1);
        for (let q = 0; q < 4; q++) this.n.push(Math.cos(am) * nr, ny, Math.sin(am) * nr);
        const u0 = uo + (k * nu) / 8, u1 = uo + ((k + 1) * nu) / 8;
        this.uv.push(u0, vo, u1, vo, u1, vo + nv / 8, u0, vo + nv / 8);
        this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
        if (lines) {
          this.lp.push(x + c0 * r1, y1, z + s0 * r1, x + c1 * r1, y1, z + s1 * r1);
          if (seg <= 8) this.lp.push(x + c0 * r0, y, z + s0 * r0, x + c0 * r1, y1, z + s0 * r1);
        }
      }
      const cap = (r, yy, up) => {
        if (r < 0.001) return;
        const b = this.rp.length / 3;
        this.rp.push(x, yy, z); this.rn.push(0, up ? 1 : -1, 0);
        for (let k = 0; k <= seg; k++) { const a = rot - k * da; this.rp.push(x + Math.cos(a) * r, yy, z + Math.sin(a) * r); this.rn.push(0, up ? 1 : -1, 0); }
        for (let k = 0; k < seg; k++) { if (up) this.ri.push(b, b + 1 + k, b + 2 + k); else this.ri.push(b, b + 2 + k, b + 1 + k); }
      };
      cap(r1, y1, true);
      if (o.under) cap(r0, y, false);
    }
    // a faceted jewel: two cones base to base
    gem(x, y, z, r, sy = 1.4) { this.tube(x, y, z, 0, r, r * sy, 6); this.tube(x, y + r * sy, z, r, 0, r * sy, 6); }
    line(...v) { this.lp.push(...v); }
    build(wallMat, roofMat) {
      const g = new THREE.Group();
      if (this.p.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        geo.setIndex(this.i);
        g.add(new THREE.Mesh(geo, wallMat));
      }
      if (this.rp.length) {
        const rg = new THREE.BufferGeometry();
        rg.setAttribute('position', new THREE.Float32BufferAttribute(this.rp, 3));
        rg.setAttribute('normal', new THREE.Float32BufferAttribute(this.rn, 3));
        rg.setIndex(this.ri);
        g.add(new THREE.Mesh(rg, roofMat));
      }
      if (this.lp.length) {
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute(this.lp, 3));
        g.add(new THREE.LineSegments(lg, M.line));
      }
      return g;
    }
  }
  const disposeGroup = (g) => g && g.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });

  // ---------- the building kit ----------
  // Two kinds of facade (a = Deco piers, b = ribbon windows), metal trim, and one batch per colour of neon.
  // Neon glows on its sides only; its top is dark roof, so a band round a tower reads as a tube, not a slab.
  // glows = where the light comes from: each gets a soft halo in the air and a pool of colour on the wet street.
  const NEON = ['coral', 'teal', 'pink'];
  const GLOW = { coral: 0xff6f61, teal: 0x2ee6cf, pink: 0xff4fa8, amber: 0xffb24d };
  function kit() {
    return { a: new Batch(), b: new Batch(), gold: new Batch(true), steel: new Batch(true), dark: new Batch(true),
      coral: new Batch(true), teal: new Batch(true), pink: new Batch(true), amber: new Batch(true), glows: [] };
  }
  const glow = (K, c, x, y, z, s = 1, pool = s) => K.glows.push({ c, x, y, z, s, pool });
  // S = the materials to build with; a district of the outer city passes its own, so it can lose power on its own
  function assemble(K, S = M) {
    const g = new THREE.Group();
    g.add(K.a.build(S.facade, M.roof), K.b.build(S.facadeB, M.roof), K.gold.build(M.gold, M.gold), K.steel.build(M.steel, M.steel),
      K.dark.build(M.navy, M.navy), K.coral.build(S.neonCoral, M.roof), K.teal.build(S.neonTeal, M.roof),
      K.pink.build(S.neonPink, M.roof), K.amber.build(S.lantern, M.lantern));
    if (K.glows.length) {
      const pos = [], col = [], c = new THREE.Color();
      for (const s of K.glows) { pos.push(s.x, s.y, s.z); c.setHex(GLOW[s.c]).multiplyScalar(0.75 * s.s); col.push(c.r, c.g, c.b); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const pts = new THREE.Points(geo, S.halo); pts.renderOrder = 5;
      g.add(pts);
    }
    return g;
  }

  // neon fittings
  const neonBand = (K, c, x, z, w, d, y, t = 0.035) => K[c].box(x, y, z, w + 0.03, t, d + 0.03);
  const hoopBand = (K, c, x, z, R, y, seg = 14, rot = 0) => K[c].tube(x, y, z, R + 0.015, R + 0.015, 0.035, seg, { rot });
  // a blade sign standing off the east or west wall, broadside to the street
  function blade(K, c, x, z, w, d, y0, y1, r) {
    const side = r() < 0.5 ? -1 : 1, px = x + side * (w / 2 + 0.06), pz = z + (r() - 0.5) * d * 0.5;
    K[c].box(px, y0, pz, 0.12, y1 - y0, 0.03);
    K.gold.box(px, y1, pz, 0.14, 0.02, 0.05);
    glow(K, c, px, (y0 + y1) / 2, pz, 0.9);
  }
  // a marquee flat on the south or north wall
  function marquee(K, c, x, z, w, d, y, r) {
    const side = r() < 0.75 ? 1 : -1, pz = z + side * (d / 2 + 0.012);
    K[c].box(x, y, pz, w * 0.62, 0.09, 0.024);
    glow(K, c, x, y + 0.05, pz + side * 0.1, 0.9);
  }
  // letters on stilts above the roof
  function roofSign(K, c, x, z, w, top) {
    K.gold.box(x - w * 0.3, top, z, 0.02, 0.1, 0.02); K.gold.box(x + w * 0.3, top, z, 0.02, 0.1, 0.02);
    K[c].box(x, top + 0.09, z, w * 0.8, 0.11, 0.03);
    glow(K, c, x, top + 0.15, z, 1);
    return top + 0.2;
  }
  // a flying saucer on a stalk: steel dome, neon rim, and a glowing belly for the street to reflect
  function saucer(K, c, x, y, z, R) {
    K.steel.tube(x, y, z, 0.045, 0.045, 0.13, 8);
    K[c].tube(x, y + 0.08, z, 0.07, R, 0.06, 16, { under: true });
    K[c].tube(x, y + 0.14, z, R, R, 0.05, 16);
    K.steel.tube(x, y + 0.19, z, R * 0.97, R * 0.4, 0.07, 16);
    K.amber.gem(x, y + 0.24, z, 0.035, 1.2);
    glow(K, c, x, y + 0.12, z, 1.1, 1.3);
    return y + 0.3;
  }
  // a needle with a jewel at the tip
  function needle(K, c, x, y, z, h) {
    K.gold.tube(x, y, z, 0.02, 0.005, h, 6);
    K[c].gem(x, y + h, z, 0.04);
    glow(K, c, x, y + h + 0.05, z, 0.5, 0);
    return y + h + 0.1;
  }

  // A stepped Deco skyscraper: setbacks narrowing as it rises, sometimes a needle with a beacon.
  function skyscraper(b, x, z, w, d, h, r) {
    const style = r();
    let y = 0;
    const tiers = style < 0.4 ? [[1, 0.52], [0.72, 0.28], [0.46, 0.2]] : style < 0.75 ? [[1, 0.62], [0.62, 0.38]] : [[1, 0.8], [0.8, 0.08], [0.6, 0.07], [0.4, 0.05]];
    for (const [k, hk] of tiers) { b.box(x, y, z, w * k, h * hk, d * k); y += h * hk; }
    if (style >= 0.4 && style < 0.75) { b.line(x, y, z, x, y + h * 0.22, z); y += h * 0.22; }
    return y;
  }
  // The same idea in the round: drums stepping in, ringed in neon where they meet.
  function roundTower(K, W, c, x, z, R, h, r) {
    const tiers = r() < 0.5 ? [[1, 0.6], [0.7, 0.4]] : [[1, 0.5], [0.76, 0.3], [0.5, 0.2]];
    let y = 0;
    for (const [k, hk] of tiers) {
      W.tube(x, y, z, R * k, R * k, h * hk, 14); y += h * hk;
      if (k > 0.55 && c) { hoopBand(K, c, x, z, R * k * 0.9, y); y += 0.035; }
    }
    return y;
  }

  // One building on a w × d lot. Eight kinds, so that no two neighbours need look alike. Returns its height.
  function tenement(K, x, z, w, d, r) {
    const c = NEON[(r() * 3) | 0], c2 = NEON[(r() * 3) | 0], W = r() < 0.5 ? K.a : K.b, V = r() < 0.5 ? K.a : K.b;
    const s = Math.min(w, d), h = 0.9 + r() * 1.1;
    let top;
    switch ((r() * 8) | 0) {
      case 0: { // stepped Deco tower with a blade sign
        top = skyscraper(W, x, z, w, d, h, r);
        if (r() < 0.7) blade(K, c, x, z, w, d, h * 0.14, h * 0.46, r); else neonBand(K, c, x, z, w, d, h * 0.5);
        break;
      }
      case 1: { // drum tower under a saucer
        const R = s * 0.45;
        W.tube(x, 0, z, R, R, h * 0.85, 14);
        K.gold.tube(x, h * 0.85, z, R + 0.03, R + 0.03, 0.035, 14);
        if (r() < 0.5) hoopBand(K, c2, x, z, R, h * 0.4);
        top = saucer(K, c, x, h * 0.85 + 0.035, z, R * 1.2);
        break;
      }
      case 2: { // octagon in two stages with a spire
        const R = s * 0.52, rot = Math.PI / 8;
        W.tube(x, 0, z, R, R, h * 0.6, 8, { rot });
        hoopBand(K, c, x, z, R * 0.8, h * 0.6, 8, rot);
        W.tube(x, h * 0.6 + 0.035, z, R * 0.7, R * 0.7, h * 0.4, 8, { rot });
        K.gold.tube(x, h + 0.035, z, R * 0.45, 0.01, 0.26, 8, { rot });
        top = needle(K, c2, x, h + 0.29, z, 0.12);
        glow(K, c, x, h * 0.6, z + R, 0.8);
        break;
      }
      case 3: { // a thin slab on a podium, with a marquee
        W.box(x, 0, z, w, 0.28, d);
        V.box(x, 0.28, z - d * 0.2, w * 0.94, h, d * 0.42);
        marquee(K, c, x, z - d * 0.2, w, d * 0.42, 0.28 + h * 0.62, () => 0);
        top = r() < 0.5 ? roofSign(K, c2, x, z - d * 0.2, w, 0.28 + h) : 0.28 + h;
        break;
      }
      case 4: { // twin towers joined by a lit bridge
        W.box(x, 0, z, w, 0.22, d * 0.8);
        W.box(x - w * 0.29, 0.22, z, w * 0.36, h, d * 0.6);
        V.box(x + w * 0.29, 0.22, z, w * 0.36, h * 0.72, d * 0.5);
        K[c].box(x, 0.22 + h * 0.45, z, w * 0.24, 0.06, d * 0.2);
        glow(K, c, x, 0.25 + h * 0.45, z, 0.9);
        top = needle(K, c2, x - w * 0.29, 0.22 + h, z, 0.3);
        break;
      }
      case 5: { // four small houses packed on to one lot
        top = 0;
        for (const [qx, qz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const hh = 0.35 + r() * 1.3, px = x + qx * w * 0.25, pz = z + qz * d * 0.25, q = r() < 0.5 ? K.a : K.b;
          if (r() < 0.3) q.tube(px, 0, pz, w * 0.22, w * 0.22, hh, 10);
          else q.box(px, 0, pz, w * (0.38 + r() * 0.1), hh, d * (0.38 + r() * 0.1));
          if (qz > 0 && r() < 0.6) { K[qx < 0 ? c : c2].box(px, hh * 0.55, pz + d * 0.25, w * 0.3, 0.07, 0.024); glow(K, qx < 0 ? c : c2, px, hh * 0.55, pz + d * 0.3, 0.7); }
          top = Math.max(top, hh);
        }
        break;
      }
      case 6: { // a tapered hexagon crowned with a ring and a mast
        const rot = r() * 1;
        W.tube(x, 0, z, s * 0.5, s * 0.36, h, 6, { rot });
        K[c].tube(x, h, z, s * 0.39, s * 0.39, 0.04, 6, { rot });
        hoopBand(K, c2, x, z, s * 0.44, h * 0.45, 6, rot);
        top = needle(K, c, x, h + 0.04, z, 0.34);
        glow(K, c, x, h, z, 1);
        break;
      }
      default: { // a round diner under a disc roof, and a pylon sign taller than the diner
        const R = s * 0.4, px = x + w * 0.37, pz = z - d * 0.3;
        W.tube(x - w * 0.06, 0, z + d * 0.04, R, R, 0.3, 16);
        K.steel.tube(x - w * 0.06, 0.3, z + d * 0.04, R * 1.18, R * 1.3, 0.045, 16, { under: true });
        K[c].tube(x - w * 0.06, 0.345, z + d * 0.04, R * 1.3, R * 1.3, 0.05, 16);
        K.steel.tube(x - w * 0.06, 0.395, z + d * 0.04, R * 1.26, R * 0.3, 0.09, 16);
        glow(K, c, x - w * 0.06, 0.36, z + d * 0.04, 1, 1.3);
        K.dark.box(px, 0, pz, 0.045, 1.25, 0.045);
        K[c2].box(px, 0.62, pz + 0.03, 0.2, 0.52, 0.03);
        K.amber.gem(px, 1.25, pz, 0.06);
        glow(K, c2, px, 0.9, pz, 1);
        top = 1.36;
      }
    }
    return top;
  }
  // A turbine house on a run of n tenement tiles beside a terrace (x0 = west edge, cz = row centre, side = +1
  // when the terrace lies south). A long Deco hall at the back, a generator drum per tile facing the terrace, a
  // lightning sign on the roof and a cooling stack at each end. Returns the stacks, which breathe steam.
  function powerHouse(K, x0, n, cz, side, r) {
    const xc = x0 + n / 2, bz = cz - side * 0.2, fz = cz + side * 0.22, c = NEON[(r() * 3) | 0];
    K.dark.box(xc, 0, cz, n - 0.04, 0.12, 0.94);
    K.a.box(xc, 0.12, bz, n - 0.24, 1.1, 0.5);
    K.b.box(xc, 1.22, bz, n - 0.6, 0.16, 0.38);
    K.b.box(xc, 1.38, bz, n - 1.2, 0.1, 0.26);
    neonBand(K, c, xc, bz, n - 0.24, 0.5, 0.84);
    // gold piers down the face, one between each pair of drums
    for (let i = 1; i < n; i++) K.gold.box(x0 + i, 0.12, bz + side * 0.26, 0.05, 1.1, 0.03);
    for (let i = 0; i < n; i++) {
      const gx = x0 + i + 0.5;
      K.steel.tube(gx, 0.12, fz, 0.22, 0.22, 0.08, 16);
      K.b.tube(gx, 0.2, fz, 0.19, 0.19, 0.46, 16);
      hoopBand(K, 'teal', gx, fz, 0.19, 0.3, 16);
      hoopBand(K, 'teal', gx, fz, 0.19, 0.5, 16);
      K.steel.tube(gx, 0.66, fz, 0.2, 0.07, 0.12, 16);
      K.gold.tube(gx, 0.78, fz, 0.025, 0.012, 0.16, 6);
      K.teal.gem(gx, 0.96, fz, 0.045, 1.1);
      glow(K, 'teal', gx, 0.45, fz + side * 0.2, 0.8);
    }
    // the lightning sign: a zig-zag bolt in amber over the roof
    const sy = 1.48, sz = bz;
    K.gold.box(xc - 0.3, sy, sz, 0.02, 0.12, 0.02); K.gold.box(xc + 0.3, sy, sz, 0.02, 0.12, 0.02);
    K.amber.box(xc - 0.12, sy + 0.1, sz, 0.22, 0.08, 0.03);
    K.amber.box(xc, sy + 0.18, sz, 0.08, 0.16, 0.03);
    K.amber.box(xc + 0.12, sy + 0.3, sz, 0.22, 0.08, 0.03);
    glow(K, 'amber', xc, sy + 0.2, sz + side * 0.15, 1.3, 1.2);
    const stacks = [];
    for (const sx of [x0 + 0.32, x0 + n - 0.32]) {
      const h = 2.1 + r() * 0.3;
      K.a.tube(sx, 0.12, bz, 0.18, 0.12, h, 12);
      K[c].tube(sx, 0.12 + h * 0.7, bz, 0.135, 0.135, 0.05, 12);
      K.gold.tube(sx, 0.12 + h, bz, 0.14, 0.14, 0.04, 12);
      glow(K, c, sx, 0.12 + h * 0.7, bz, 0.7, 0);
      stacks.push({ x: sx, y: bz, h: 0.16 + h });
    }
    return stacks;
  }
  // A landmark filling a 2 × 2 block.
  function landmark(K, x, z, r) {
    const c = NEON[(r() * 3) | 0], c2 = NEON[(r() * 3) | 0], W = r() < 0.5 ? K.a : K.b, h = 2 + r() * 0.8;
    let top;
    if (r() < 0.5) {
      top = roundTower(K, W, c, x, z, 0.82, h, r);
      top = saucer(K, c2, x, top, z, 0.5);
      top = needle(K, c, x, top - 0.04, z, 0.3);
      glow(K, c, x, h * 0.55, z + 0.7, 1.2, 1.6);
    } else {
      W.box(x, 0, z, 1.8, 0.3, 1.8);
      top = skyscraper(W, x, z, 1.4, 1.4, h, r);
      neonBand(K, c, x, z, 1.4, 1.4, h * 0.3);
      for (const [qx, qz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const tx = x + qx * 0.72, tz = z + qz * 0.72, th = h * (0.3 + r() * 0.2);
        K.b.tube(tx, 0.3, tz, 0.17, 0.17, th, 10);
        K[c2].tube(tx, 0.3 + th, tz, 0.19, 0.19, 0.03, 10);
        K.gold.tube(tx, 0.33 + th, tz, 0.17, 0.01, 0.16, 10);
      }
      marquee(K, c2, x, z, 1.5, 1.4, h * 0.2, () => 0);
      glow(K, c, x, h * 0.3, z + 0.8, 1.2, 1.6);
    }
    return top;
  }
  // A long block across two lots: a tall centre between low wings, or a slab under a rooftop sign.
  function longBlock(K, x, z, along, r) {
    const c = NEON[(r() * 3) | 0], c2 = NEON[(r() * 3) | 0], W = r() < 0.5 ? K.a : K.b, V = W === K.a ? K.b : K.a, h = 1 + r() * 1;
    const bx = (B, l, y, lw, hh, ld) => (along ? B.box(x + l, y, z, lw, hh, ld) : B.box(x, y, z + l, ld, hh, lw));
    if (r() < 0.5) {
      bx(W, 0, 0, 0.7, h, 0.8); bx(V, -0.62, 0, 0.55, h * 0.55, 0.7); bx(V, 0.62, 0, 0.55, h * 0.55, 0.7);
      bx(K[c], 0, h * 0.55, 1.83, 0.035, 0.74);
      bx(W, 0, h, 0.4, 0.18, 0.46);
      glow(K, c, x, h * 0.55, z + 0.45, 1, 1.4);
      return needle(K, c2, x, h + 0.18, z, 0.3);
    }
    bx(W, 0, 0, 1.84, 0.26, 0.84); bx(V, 0, 0.26, 1.7, h, 0.44);
    if (along) {
      K.gold.box(x - 0.5, 0.285 + h, z, 0.02, 0.1, 0.02); K.gold.box(x + 0.5, 0.285 + h, z, 0.02, 0.1, 0.02);
      K[c].box(x, 0.375 + h, z, 1.3, 0.13, 0.03);
      glow(K, c, x - 0.35, 0.44 + h, z, 1, 1.2); glow(K, c, x + 0.35, 0.44 + h, z, 1, 1.2);
    } else {
      K[c].box(x + 0.28, 0.26 + h * 0.3, z + 0.3, 0.12, h * 0.6, 0.03);
      glow(K, c, x + 0.3, 0.26 + h * 0.6, z + 0.3, 1, 1.3);
    }
    bx(K[c2], 0, 0.26, 1.87, 0.03, 0.87);
    return 0.5 + h;
  }

  // A district of the outer city: its own copies of the lit materials, so its power can be cut.
  // setPower(p): 1 = fully lit, 0 = blacked out (windows, neon and halos all but gone).
  function district() {
    const S = {
      facade: reflect(M.facade.clone()), facadeB: reflect(M.facadeB.clone()), lantern: reflect(M.lantern.clone()),
      neonCoral: reflect(M.neonCoral.clone()), neonTeal: reflect(M.neonTeal.clone()), neonPink: reflect(M.neonPink.clone()),
      halo: M.halo.clone(),
    };
    const base = { facade: S.facade.emissiveIntensity, facadeB: S.facadeB.emissiveIntensity, lantern: S.lantern.emissiveIntensity,
      neonCoral: S.neonCoral.color.clone(), neonTeal: S.neonTeal.color.clone(), neonPink: S.neonPink.color.clone(),
      wall: S.facade.color.clone(), wallB: S.facadeB.color.clone(), env: S.facade.envMapIntensity, envB: S.facadeB.envMapIntensity };
    const setPower = (p) => {
      const k = 0.03 + 0.97 * p;
      for (const n of ['facade', 'facadeB', 'lantern']) S[n].emissiveIntensity = base[n] * k;
      // the window texture also shows in the lit colour and the reflections, so those go down with the lights
      S.facade.color.copy(base.wall).multiplyScalar(0.15 + 0.85 * p); S.facadeB.color.copy(base.wallB).multiplyScalar(0.15 + 0.85 * p);
      S.facade.envMapIntensity = base.env * (0.4 + 0.6 * p); S.facadeB.envMapIntensity = base.envB * (0.4 + 0.6 * p);
      for (const n of ['neonCoral', 'neonTeal', 'neonPink']) S[n].color.copy(base[n]).multiplyScalar(0.06 + 0.94 * p);
      S.halo.opacity = p;
    };
    return { S, setPower, dispose: () => { for (const n in S) S[n].dispose(); } };
  }
  const reflect = (mat) => M.reflect(mat);

  // The city beyond the playable map, laid out the way a 1930s city grew: a street grid of perimeter blocks, each
  // a continuous street wall of buildings sharing party walls under a common cornice line, with lit shopfronts at
  // street level and setback towers rising out of the block's interior. A frontage street runs round the map, so
  // the playfield reads as a square cut into the city rather than an island in front of it. Heights climb with
  // distance and most steeply to the north, so nothing near the map hides it. The gates stand in notches in the
  // first row (o.clear: rectangles kept free of buildings).
  // It is cut into wedges round the map; each wedge is a district that goes dark on its own as the city loses power.
  function outerCity(COLS, ROWS, r, o = {}) {
    const FRONT = o.front || 2.2; // tiles from the map edge to the first building face
    const nDistricts = o.districts || 10, clear = o.clear || [];
    const kits = Array.from({ length: nDistricts }, () => kit());
    const kitAt = (x, z) => {
      const a = Math.atan2(z - ROWS / 2, x - COLS / 2);
      return kits[Math.min(nDistricts - 1, Math.floor(((a + Math.PI) / TAU) * nDistricts))];
    };
    const snap = (h) => Math.max(1 / 3, Math.round(h * 3) / 3); // whole storeys: three windows to a tile
    const blocked = (x0, z0, x1, z1) => clear.some((c) => x0 < c.x1 && x1 > c.x0 && z0 < c.z1 && z1 > c.z0);

    // ---- the street grid ----
    // Along each axis: blocks of 4-6.5 tiles split by streets, with a wider avenue every third crossing.
    // Inside the map's span the blocks are laid between the frontage corners; outside it they march outward.
    const street = (k) => (k % 3 === 2 ? 2.1 : 1.3);
    function axis(lo, hi, reach) {
      const out = [];
      // the run alongside the map (blocks north/south of it, or west/east of it)
      const a = lo - FRONT + 1.3, b = hi + FRONT - 1.3, n = Math.max(1, Math.round((b - a) / 6.2)), sw = 1.3;
      const len = (b - a - sw * (n - 1)) / n;
      for (let k = 0; k < n; k++) out.push({ a: a + k * (len + sw), b: a + k * (len + sw) + len, side: 0, d: 0 });
      // outward from each side; the first block's face is on the frontage street
      for (const dir of [-1, 1]) {
        let p = dir < 0 ? lo - FRONT : hi + FRONT, k = 0;
        while ((dir < 0 ? lo - p : p - hi) < reach) {
          const L = 4 + r() * 2.5, q = p + dir * L;
          out.push({ a: Math.min(p, q), b: Math.max(p, q), side: dir, d: Math.abs(p - (dir < 0 ? lo : hi)) });
          p = q + dir * street(k++);
        }
      }
      return out;
    }
    const xs = axis(0, COLS, 34), zs = axis(0, ROWS, 46);

    // ---- one building lot ----
    // x0..x1, z0..z1 = its footprint; h = its height; fronts = the street faces as [nx, nz] pairs.
    function building(x0, z0, x1, z1, h, fronts, near, facing, corner) {
      if (blocked(x0, z0, x1, z1)) return;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0, K = kitAt(cx, cz);
      const W = r() < 0.55 ? K.a : K.b, c = NEON[(r() * 3) | 0];
      if (corner && r() < 0.35 && w > 0.9 && d > 0.9) {
        // the Deco corner: a drum or an octagon turning the corner, a storey or two above its neighbours
        const R = Math.min(w, d) / 2, oct = r() < 0.5, seg = oct ? 8 : 14, rot = oct ? Math.PI / 8 : 0;
        W.box(cx, 0, cz, w, h, d);
        W.tube(cx, h, cz, R * 0.9, R * 0.9, snap(0.5 + r() * 0.8), seg, { rot });
        const top = h + snap(0.5 + r() * 0.8);
        if (near) { hoopBand(K, c, cx, cz, R * 0.92, h + 0.02, seg, rot); glow(K, c, cx, h, cz, 0.7, 0); }
        if (r() < 0.5) needle(K, c, cx, top, cz, 0.25);
      } else {
        W.box(cx, 0, cz, w, h, d);
        // a setback attic on about one in four
        if (r() < 0.25 && w > 0.7 && d > 0.7) {
          let ax = cx, az = cz;
          for (const [nx, nz] of fronts) { ax -= nx * 0.12; az -= nz * 0.12; }
          (W === K.a ? K.b : K.a).box(ax, h, az, w - 0.24, snap(0.34 + r() * 0.3), d - 0.24);
        }
      }
      if (!near) return;
      // street level: a lit shopfront along the street face, and now and then a neon sign
      for (const [nx, nz] of fronts) {
        const f = nx ? d : w, px = cx + nx * (w / 2 + 0.012), pz = cz + nz * (d / 2 + 0.012);
        const sx = nx ? 0.024 : f * 0.84, sz = nx ? f * 0.84 : 0.024;
        if (r() < 0.55) {
          K.amber.box(px, 0.05, pz, sx, 0.08, sz);
          if (facing) glow(K, 'amber', px + nx * 0.25, 0.1, pz + nz * 0.25, 0.25, 0.55);
        }
        const k = r();
        if (k < 0.22) { // a canopy marquee over the shop
          K[c].box(px + nx * 0.02, 0.2, pz + nz * 0.02, nx ? 0.03 : f * 0.6, 0.06, nx ? f * 0.6 : 0.03);
          glow(K, c, px + nx * 0.2, 0.25, pz + nz * 0.2, facing ? 0.8 : 0.6, facing ? 1 : 0);
        } else if (k < 0.36 && h > 0.9) { // a blade sign standing off the wall
          const t = r() < 0.5 ? -1 : 1, ox = px + nx * 0.07 + (nx ? 0 : t * f * 0.32), oz = pz + nz * 0.07 + (nz ? 0 : t * f * 0.32);
          const y0 = 0.3, y1 = Math.min(h - 0.1, 0.3 + 0.4 + r() * 0.6);
          K[c].box(ox, y0, oz, nx ? 0.12 : 0.03, y1 - y0, nx ? 0.03 : 0.12);
          K.gold.box(ox, y1, oz, nx ? 0.14 : 0.05, 0.02, nx ? 0.05 : 0.14);
          glow(K, c, ox + nx * 0.1, (y0 + y1) / 2, oz + nz * 0.1, 0.8, facing ? 1 : 0);
        } else if (k < 0.44) { // a neon band under the cornice
          K[c].box(px, h - 0.12, pz, nx ? 0.03 : f, 0.035, nx ? f : 0.03);
        }
      }
    }

    // ---- a tower rising out of a block's courtyard ----
    function tower(x, z, w, d, base, h, far) {
      if (blocked(x - w / 2, z - d / 2, x + w / 2, z + d / 2)) return;
      const K = kitAt(x, z), W = r() < 0.5 ? K.a : K.b, c = NEON[(r() * 3) | 0], kind = r();
      let top;
      if (kind < 0.18) {
        top = roundTower(K, W, far ? null : c, x, z, Math.min(w, d) / 2, h, r);
      } else {
        // stepped setbacks, the classic wedding-cake massing
        const tiers = kind < 0.55 ? [[1, 0.55], [0.74, 0.25], [0.5, 0.2]] : kind < 0.85 ? [[1, 0.7], [0.66, 0.3]] : [[1, 0.45], [0.82, 0.25], [0.62, 0.18], [0.42, 0.12]];
        let y = 0;
        for (const [k, hk] of tiers) {
          W.box(x, y, z, w * k, h * hk, d * k); y += h * hk;
          if (!far && k > 0.6 && r() < 0.3) neonBand(K, c, x, z, w * k, d * k, y - 0.15, 0.04);
        }
        top = y;
      }
      // crowns on the tall ones: a gold spire, a needle with a jewel, or letters on the roof
      const crown = r();
      if (h > 4 && crown < 0.4) { K.gold.tube(x, top, z, Math.min(w, d) * 0.18, 0.01, 0.6 + h * 0.08, 8, { rot: Math.PI / 8 }); if (!far) glow(K, c, x, top + 0.3, z, 0.6, 0); }
      else if (crown < 0.6) needle(K, c, x, top, z, 0.3 + h * 0.04);
      else if (!far && crown < 0.75) roofSign(K, c, x, z, Math.min(w, 1.4), top);
      return base;
    }

    // ---- fill every block ----
    for (const bx of xs) for (const bz of zs) {
      if (bx.side === 0 && bz.side === 0) continue; // the map and its frontage street
      const x0 = bx.a, x1 = bx.b, z0 = bz.a, z1 = bz.b, w = x1 - x0, dd = z1 - z0;
      const north = bz.side < 0 ? bz.d : 0, south = bz.side > 0 ? bz.d : 0, side = Math.max(bx.d, 0);
      const dist = Math.hypot(bx.d, bz.d), near = dist < 14, far = dist > 24;
      // the cornice line this block keeps to, and how tall its towers may go
      let cornice, towerH = 0;
      if (south > 0) { cornice = 0.7 + Math.min(south, 26) * 0.05 + r() * 0.3; if (south > 8 && r() < 0.5) towerH = 1.4 + Math.min(south, 26) * 0.12 * (0.5 + r()); }
      else if (north > 0) {
        cornice = 1 + Math.min(north, 30) * 0.09 + r() * 0.4;
        if (r() < 0.85) towerH = 2.4 + Math.min(north, 30) * 0.22 + r() * 1.6 + (north > 8 && r() < 0.12 ? 5 + r() * 6 : 0);
      } else {
        cornice = 0.9 + Math.min(side, 26) * 0.07 + r() * 0.35;
        if (side > 3 && r() < 0.7) towerH = 1.8 + Math.min(side, 26) * 0.14 + r() * 1.4;
      }
      cornice = snap(cornice);
      // which faces look onto the map across the frontage street
      const facesMap = { n: bz.side > 0 && bz.d < FRONT + 0.1 && bx.side === 0, s: bz.side < 0 && bz.d < FRONT + 0.1 && bx.side === 0,
        w: bx.side > 0 && bx.d < FRONT + 0.1 && bz.side === 0, e: bx.side < 0 && bx.d < FRONT + 0.1 && bz.side === 0 };
      const D = Math.min(far ? 2 : 1.5, Math.min(w, dd) / 2); // lot depth from the street
      const lotH = (k = 1) => snap(cornice * k * (0.85 + r() * 0.3));
      const step = () => (far ? 1.6 + r() * 1.6 : 0.9 + r() * 0.9);
      // corners
      for (const [cx, cz, fx, fz] of [[x0, z0, -1, -1], [x1 - D, z0, 1, -1], [x0, z1 - D, -1, 1], [x1 - D, z1 - D, 1, 1]]) {
        const fm = (fz < 0 && facesMap.n) || (fz > 0 && facesMap.s) || (fx < 0 && facesMap.w) || (fx > 0 && facesMap.e);
        building(cx, cz, cx + D, cz + D, lotH(1.15), [[fx, 0], [0, fz]], near, fm, true);
      }
      // the long sides between the corners, cut into lots of uneven frontage
      const run = (a, b, put) => { let p = a; while (b - p > 0.05) { let f = step(); if (b - p - f < 0.6) f = b - p; put(p, p + f); p += f; } };
      run(x0 + D, x1 - D, (a, b) => {
        building(a, z0, b, z0 + D, lotH(), [[0, -1]], near, facesMap.n);
        building(a, z1 - D, b, z1, lotH(), [[0, 1]], near, facesMap.s);
      });
      run(z0 + D, z1 - D, (a, b) => {
        building(x0, a, x0 + D, b, lotH(), [[-1, 0]], near, facesMap.w);
        building(x1 - D, a, x1, b, lotH(), [[1, 0]], near, facesMap.e);
      });
      // the courtyard: a setback tower (two on a long block) rising behind the street wall
      const iw = w - 2 * D, id = dd - 2 * D;
      if (towerH > cornice + 0.6 && iw > 0.4 && id > 0.4) {
        const tw = Math.min(iw + 0.6, 2.6), td = Math.min(id + 0.6, 2.6);
        const two = w > dd * 1.4 && w > 5.5 && r() < 0.6;
        if (two) for (const s of [-1, 1]) tower(x0 + w / 2 + s * w * 0.22, z0 + dd / 2, Math.min(tw, w * 0.36), td, cornice, snap(towerH * (s < 0 ? 1 : 0.7 + r() * 0.2)), far);
        else tower(x0 + w / 2, z0 + dd / 2, tw, td, cornice, snap(towerH), far);
      } else if (iw > 0.4 && id > 0.4) {
        // no tower: fill the courtyard with a low back building so the block reads as solid from above
        kitAt(x0 + w / 2, z0 + dd / 2).dark.box(x0 + w / 2, 0, z0 + dd / 2, iw + 0.05, cornice * 0.6, id + 0.05);
      }
    }

    // ---- street lamps along the frontage street, and at the crossings nearest the map ----
    const lamp = (x, z) => {
      if (blocked(x - 0.1, z - 0.1, x + 0.1, z + 0.1)) return;
      const K = kitAt(x, z);
      K.dark.box(x, 0, z, 0.035, 0.6, 0.035);
      K.gold.box(x, 0.6, z, 0.07, 0.02, 0.07);
      K.amber.gem(x, 0.62, z, 0.04, 1.3);
      glow(K, 'amber', x, 0.66, z, 0.4, 0.55);
    };
    const lo = FRONT - 0.35;
    for (let x = -lo; x <= COLS + lo + 0.01; x += (COLS + 2 * lo) / Math.round((COLS + 2 * lo) / 2.6)) { lamp(x, -lo); lamp(x, ROWS + lo); }
    for (let z = -lo; z <= ROWS + lo + 0.01; z += (ROWS + 2 * lo) / Math.round((ROWS + 2 * lo) / 2.6)) { if (z > -lo + 0.5 && z < ROWS + lo - 0.5) { lamp(-lo, z); lamp(COLS + lo, z); } }

    const g = new THREE.Group(), districts = [], glows = [];
    for (const K of kits) { const d = district(); districts.push(d); g.add(assemble(K, { ...M, ...d.S })); glows.push(...K.glows); }
    g.userData.districts = districts;
    g.userData.glows = glows; // for the wet street round the map
    return g;
  }

  const gemGeo = () => { const g = new THREE.OctahedronGeometry(1, 0); g.userData.shared = true; return g; };
  let GEM = null;

  // Everything standing on the map itself: tenements, monoliths and terraces.
  // o.deck = the material for the terrace tops (the game paints them into the ground texture).
  // Returns { group, chimneys, glows }: rooftops that breathe steam, and the lights that colour the street.
  function blocks(grid, COLS, ROWS, rng, o = {}) {
    const K = kit(), stone = new Batch(), rim = new Batch();
    const group = new THREE.Group(), chimneys = [];
    const dp = [], duv = [], di = [];
    const ap = o.apron || 0, u = (x) => (x + ap) / (COLS + 2 * ap), v = (y) => (y + ap) / (ROWS + 2 * ap); // terrace UVs into the ground texture
    GEM = GEM || gemGeo();
    const at = (x, y) => (x >= 0 && y >= 0 && x < COLS && y < ROWS ? grid[y][x] : null);
    const used = new Set(), free = (x, y) => at(x, y) === 'forest' && !used.has(y * COLS + x);
    // Tenements in a row of three or more along a terrace's edge become one turbine house facing the terrace.
    const besideHill = (x, y) => (at(x, y + 1) === 'hill' ? 1 : at(x, y - 1) === 'hill' ? -1 : 0);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const side = free(x, y) && besideHill(x, y);
      if (!side) continue;
      let n = 1;
      while (free(x + n, y) && besideHill(x + n, y) === side) n++;
      if (n < 3) continue;
      for (let i = 0; i < n; i++) used.add(y * COLS + x + i);
      chimneys.push(...powerHouse(K, x, n, y + 0.5, side, rng((x + 3) * 7919 ^ (y + 17) * 104729)));
      x += n - 1;
    }
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = grid[y][x], r = rng((x + 11) * 2654435761 ^ (y + 5) * 40503), cx = x + 0.5, cz = y + 0.5;
      if (t === 'forest') {
        if (used.has(y * COLS + x)) continue;
        const pick = r();
        let top, sx = cx, sz = cz;
        if (pick < 0.22 && free(x + 1, y) && free(x, y + 1) && free(x + 1, y + 1)) {
          for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) used.add((y + dy) * COLS + x + dx);
          sx = x + 1; sz = y + 1; top = landmark(K, sx, sz, r);
        } else if (pick < 0.42 && free(x + 1, y)) {
          used.add(y * COLS + x + 1); sx = x + 1; top = longBlock(K, sx, sz, true, r);
        } else if (pick < 0.56 && free(x, y + 1)) {
          used.add((y + 1) * COLS + x); sz = y + 1; top = longBlock(K, sx, sz, false, r);
        } else {
          // most lots hold one building; it may crowd its lot or leave an alley
          const w = 0.62 + r() * 0.32, d = 0.62 + r() * 0.32;
          sx = cx + (r() - 0.5) * (0.96 - w); sz = cz + (r() - 0.5) * (0.96 - d);
          top = tenement(K, sx, sz, w, d, r);
        }
        if (r() < 0.45) chimneys.push({ x: sx, y: sz, h: top });
      } else if (t === 'rock') {
        if (r() < 0.4) {
          stone.box(cx, 0, cz, 0.34, 1.25, 0.34);
          const cap = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.3, 4), M.gold);
          cap.position.set(cx, 1.4, cz); cap.rotation.y = Math.PI / 4; group.add(cap);
        } else {
          stone.box(cx, 0, cz, 0.84, 0.28, 0.84); stone.box(cx, 0.28, cz, 0.6, 0.26, 0.6); stone.box(cx, 0.54, cz, 0.36, 0.24, 0.36);
          const cap = new THREE.Mesh(GEM, M.gold); cap.scale.set(0.1, 0.14, 0.1); cap.position.set(cx, 0.92, cz); group.add(cap);
        }
      } else if (t === 'water') {
        // a sunken basin: a low marble coping round the edge of the pool, with a thread of teal light set into it
        const N = at(x, y - 1) !== 'water', S = at(x, y + 1) !== 'water', Wt = at(x - 1, y) !== 'water', E = at(x + 1, y) !== 'water';
        const I = 0.12;
        if (N) { stone.box(cx, 0, y + I / 2, 1, 0.09, I); rim.box(cx, 0.09, y + I / 2, 1, 0.02, I, false); K.teal.box(cx, 0.02, y + I + 0.005, 1, 0.02, 0.01); }
        if (S) { stone.box(cx, 0, y + 1 - I / 2, 1, 0.09, I); rim.box(cx, 0.09, y + 1 - I / 2, 1, 0.02, I, false); K.teal.box(cx, 0.02, y + 1 - I - 0.015, 1, 0.02, 0.01); }
        if (Wt) { stone.box(x + I / 2, 0, cz, I, 0.09, 1); rim.box(x + I / 2, 0.09, cz, I, 0.02, 1, false); K.teal.box(x + I + 0.005, 0.02, cz, 0.01, 0.02, 1); }
        if (E) { stone.box(x + 1 - I / 2, 0, cz, I, 0.09, 1); rim.box(x + 1 - I / 2, 0.09, cz, I, 0.02, 1, false); K.teal.box(x + 1 - I - 0.015, 0.02, cz, 0.01, 0.02, 1); }
        if (N || S || Wt || E) glow(K, 'teal', cx, 0.1, cz, 0.6, 0.4);   // the water's own light spills onto the basin
      } else if (t === 'hill') {
        // A deck that seems to float: a dark kerb, a band of teal light set back under the rim, a gold-edged slab on top.
        const N = at(x, y - 1) !== 'hill', S = at(x, y + 1) !== 'hill', Wt = at(x - 1, y) !== 'hill', E = at(x + 1, y) !== 'hill';
        const I = 0.04, x0 = x + (Wt ? I : 0), x1 = x + 1 - (E ? I : 0), z0 = y + (N ? I : 0), z1 = y + 1 - (S ? I : 0);
        K.dark.box(cx, 0, cz, 1, 0.035, 1);
        K.teal.box((x0 + x1) / 2, 0.035, (z0 + z1) / 2, x1 - x0, 0.095, z1 - z0);
        rim.box(cx, 0.13, cz, 1, 0.09, 1, false);
        const b = dp.length / 3;
        dp.push(x, 0.224, y + 1, x + 1, 0.224, y + 1, x + 1, 0.224, y, x, 0.224, y);
        duv.push(u(x), 1 - v(y + 1), u(x + 1), 1 - v(y + 1), u(x + 1), 1 - v(y), u(x), 1 - v(y));
        di.push(b, b + 1, b + 2, b, b + 2, b + 3);
        const e = [[N, x, y, x + 1, y], [S, x, y + 1, x + 1, y + 1], [Wt, x, y, x, y + 1], [E, x + 1, y, x + 1, y + 1]];
        for (const [out, ax, az, bx, bz] of e) if (out) { rim.line(ax, 0.225, az, bx, 0.225, bz); rim.line(ax, 0.13, az, bx, 0.13, bz); }
        // a lamp on every outside corner
        for (const [oz, ox, qx, qz] of [[N, Wt, -1, -1], [N, E, 1, -1], [S, Wt, -1, 1], [S, E, 1, 1]]) {
          if (!oz || !ox) continue;
          const lx = cx + qx * 0.43, lz = cz + qz * 0.43, c = (x + y) & 1 ? 'pink' : 'coral';
          K.gold.tube(lx, 0.22, lz, 0.028, 0.012, 0.24, 6);
          K[c].gem(lx, 0.45, lz, 0.045, 1.1);
          glow(K, c, lx, 0.5, lz, 0.55, 0);
        }
      }
    }
    // One feature per pool: a stepped fountain in a big one, two lily lamps in a small one.
    const seen = new Set(), poolInfo = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (at(x, y) !== 'water' || seen.has(y * COLS + x)) continue;
      const cells = [], stack = [[x, y]]; seen.add(y * COLS + x);
      while (stack.length) {
        const [px, py] = stack.pop(); cells.push([px, py]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx, ny = py + dy, k = ny * COLS + nx;
          if (at(nx, ny) === 'water' && !seen.has(k)) { seen.add(k); stack.push([nx, ny]); }
        }
      }
      const mx = cells.reduce((s, c) => s + c[0], 0) / cells.length + 0.5, mz = cells.reduce((s, c) => s + c[1], 0) / cells.length + 0.5;
      if (cells.length >= 4) {
        stone.box(mx, 0, mz, 1.0, 0.2, 1.0); stone.box(mx, 0.2, mz, 0.7, 0.2, 0.7); stone.box(mx, 0.4, mz, 0.4, 0.2, 0.4);
        K.teal.gem(mx, 0.7, mz, 0.09, 1.2);
        const fin = new THREE.Mesh(GEM, M.gold); fin.scale.set(0.08, 0.14, 0.08); fin.position.set(mx, 0.9, mz); group.add(fin);
      } else {
        for (const ox of [-0.25, 0.25]) { K.teal.gem(mx + ox, 0.12, mz, 0.08, 1.2); glow(K, 'teal', mx + ox, 0.2, mz, 0.4, 0.2); }
      }
      // ripples run from r0 to r1 (tiles): clear of the fountain, and inside the pool's narrower side
      const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
      const half = Math.min(Math.max(...xs) - Math.min(...xs) + 1, Math.max(...zs) - Math.min(...zs) + 1) / 2;
      poolInfo.push({ cx: mx, cz: mz, r0: cells.length >= 4 ? 0.55 : 0.1, r1: half - 0.14, cells });
    }
    group.add(assemble(K), stone.build(M.marble, M.marble), rim.build(M.gold, M.gold));
    if (dp.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(dp.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
      geo.setIndex(di);
      group.add(new THREE.Mesh(geo, o.deck || M.terrace));
    }
    return { group, chimneys, glows: K.glows, pools: poolInfo };
  }

  // ---------- small solids, with geometry shared between everything that uses the same size ----------
  const geos = new Map();
  const shared = (key, make) => { let g = geos.get(key); if (!g) { g = make(); g.userData.shared = true; geos.set(key, g); } return g; };
  const boxGeo = (w, h, d, windows) => shared(`b${w},${h},${d},${windows ? 1 : 0}`, () => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (windows) {
      // three windows per tile on the walls, plain stone on top and bottom
      const uv = g.attributes.uv, dims = [[d, h], [d, h], null, null, [w, h], [w, h]];
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        if (!dims[f]) uv.setXY(i, 0.02, 0.01);
        else uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(dims[f][0] * 3)) / 8, uv.getY(i) * Math.max(1, Math.round(dims[f][1] * 3)) / 8);
      }
    }
    return g;
  });
  const edgeGeo = (w, h, d) => shared(`e${w},${h},${d}`, () => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)));
  // box with its bottom at y; trim = thin gold line-work along every edge
  function box(g, mat, w, h, d, x = 0, y = 0, z = 0, trim = false) {
    const m = new THREE.Mesh(boxGeo(w, h, d, mat === M.facade), mat);
    m.position.set(x, y + h / 2, z); g.add(m);
    if (trim) { const l = new THREE.LineSegments(edgeGeo(w, h, d), M.line); l.position.copy(m.position); g.add(l); }
    return m;
  }
  function cyl(g, mat, rt, rb, h, x = 0, y = 0, z = 0, seg = 16) {
    const m = new THREE.Mesh(shared(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), mat);
    m.position.set(x, y + h / 2, z); g.add(m); return m;
  }
  function torus(g, mat, r, tube, x = 0, y = 0, z = 0, arc = TAU) {
    const m = new THREE.Mesh(shared(`t${r},${tube},${arc}`, () => new THREE.TorusGeometry(r, tube, 8, 28, arc)), mat);
    m.position.set(x, y, z); m.rotation.x = Math.PI / 2; g.add(m); return m;
  }
  function ball(g, mat, r, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(shared(`s${r}`, () => new THREE.SphereGeometry(r, 18, 12)), mat);
    m.position.set(x, y, z); g.add(m); return m;
  }
  function gem(g, mat, r, x, y, z, sy = 1.5) {
    GEM = GEM || gemGeo();
    const m = new THREE.Mesh(GEM, mat); m.scale.set(r, r * sy, r); m.position.set(x, y, z); g.add(m); return m;
  }
  // a rod lying along +X, starting at x
  function rod(g, mat, r, len, x, y, z = 0, r2 = r) {
    const m = cyl(g, mat, r2, r, len, 0, 0, 0, 12);
    m.rotation.z = -Math.PI / 2; m.position.set(x + len / 2, y, z); return m;
  }

  // ---------- towers: massive Deco structures ----------
  // Every tower grows by the same four steps, so its level reads at a glance from the game camera:
  //   Lv1  the bare build.
  //   Lv2  a gilded storey: the working part climbs onto an extra setback with a gold band and corner fins,
  //        and the weapon gets bigger.
  //   Lv3  the chosen path's own silhouette (its weapon or crown changes shape), plus a lit band in the path's
  //        colour: gold for path A, cream for path B.
  //   Lv4  a crown (Deco rays, finials or a beacon) and the largest form of that path's weapon.
  // Levels add real storeys rather than stretching the model, so round parts stay round.
  const pathLit = (br) => (br === 'B' ? M.cream : M.goldGlow);
  // a thin band wrapped round a w×d block at height y
  function band(g, mat, w, d, y, x = 0, z = 0) { return box(g, mat, w + 0.03, 0.04, d + 0.03, x, y, z); }
  // four gold fins standing diagonally off the corners of a w×d block
  function fins(g, w, d, y, h, mat = M.gold) {
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const f = box(g, mat, 0.03, h, 0.15, (sx * w) / 2, y, (sz * d) / 2); f.rotation.y = (sx * sz * Math.PI) / 4;
    }
  }
  // a Deco crown: n rays standing on a ring of radius r at height y, leaning outward
  function rays(g, y, r, h, n, mat = M.gold, x = 0, z = 0) {
    const c = new THREE.Group(); c.position.set(x, y, z); g.add(c);
    for (let k = 0; k < n; k++) {
      const p = new THREE.Group(); p.rotation.y = (k / n) * TAU; c.add(p);
      box(p, mat, 0.025, h * (k % 2 ? 0.65 : 1), 0.07, r, 0, 0).rotation.z = -0.3;
    }
    return c;
  }
  // a lit gem on a gold pin; returns the gem
  function beacon(g, mat, y, s = 0.07, x = 0, z = 0) { cyl(g, M.gold, 0.008, 0.03, 0.22, x, y, z, 6); return gem(g, mat, s, x, y + 0.3, z, 1.5); }
  // a toothed gear lying flat (its axle vertical), centred at y
  function gear(g, mat, r, th, teeth, x = 0, y = 0, z = 0) {
    const w = new THREE.Group(); w.position.set(x, y, z); g.add(w);
    cyl(w, mat, r, r, th, 0, -th / 2, 0, 20);
    const tw = Math.max(0.03, r * 0.24);
    for (let k = 0; k < teeth; k++) {
      const a = (k / teeth) * TAU;
      box(w, mat, tw, th, tw, Math.cos(a) * (r + tw * 0.35), -th / 2, Math.sin(a) * (r + tw * 0.35)).rotation.y = -a;
    }
    return w;
  }
  // a rod between two points
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function strut(g, mat, r, ax, ay, az, bx, by, bz) {
    _a.set(ax, ay, az); _b.set(bx, by, bz);
    const len = +_a.distanceTo(_b).toFixed(3);
    const m = new THREE.Mesh(shared(`c${r},${r},${len},6`, () => new THREE.CylinderGeometry(r, r, len, 6)), mat);
    m.position.copy(_a).add(_b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(_up, _b.sub(_a).normalize()); g.add(m); return m;
  }
  // a ring standing upright with its axis along X (a band round a barrel)
  function hoop(g, mat, r, tube, x, y, z = 0) { const m = torus(g, mat, r, tube, x, y, z); m.rotation.set(0, Math.PI / 2, 0); return m; }
  // a bell hanging from y
  function bell(g, mat, s, x, y, z) {
    const b = new THREE.Group(); b.position.set(x, y, z); g.add(b);
    cyl(b, mat, s * 0.35, s, s * 1.1, 0, -s * 1.1, 0, 14); torus(b, mat, s, s * 0.1, 0, -s * 1.1, 0);
    return b;
  }

  // cells = footprint cell centres relative to the tower's centre, in tiles. Returns a group whose
  // userData.tick(t, time) animates it, userData.light = { h, color, r } is where its lamp glows, and
  // userData.muzzle = { h, r, flash } is where its shots leave the barrel: h above the ground, r tiles out along
  // the tower's aim. flash: false means the overlay draws its own shot instead of a generic muzzle flash.
  // accent = { arch, color, big } paints the main upgrade path's role on the barrel (pathAccent below).
  function tower(key, br, level, cells, dir, accent = null) {
    const g = new THREE.Group(), body = new THREE.Group(), F = M.facade;
    for (const [cx, cz] of cells) box(g, M.marble, 0.94, 0.07, 0.94, cx, 0, cz, true);
    body.position.y = 0.07; g.add(body);
    const yaw = -dir * Math.PI / 2, A = br === 'A', B = br === 'B', L2 = level >= 1, L3 = level >= 2, L4 = level >= 3, lit = pathLit(br);
    let tick = () => {}, light = null, muzzle = null, barrel = null;
    switch (key) {
      case 'arrow': {
        // the Rivet Gun: a steam rivet gun from the skyscraper sites, on a girder-braced plinth. A boiler drives
        // a short barrel with a red-hot rivet glowing in its mouth; a hopper of hot rivets rides behind and a
        // gauge shows the pressure building back up. Spike Driver climbs a mast and stretches into a long
        // piston-driven barrel with a sight; Riveter turns a rotary cluster of barrels fed by a rivet drum.
        box(body, M.navy, 0.84, 0.16, 0.84, 0, 0, 0, true);
        box(body, F, 0.66, 0.42, 0.66, 0, 0.16, 0, true);
        // girder X-braces on all four faces
        for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const f = 0.335, px = nz, pz = nx; // along the face
          for (const sgn of [1, -1]) strut(body, M.gold, 0.011, nx * f + px * 0.27 * sgn, 0.2, nz * f + pz * 0.27 * sgn, nx * f - px * 0.27 * sgn, 0.54, nz * f - pz * 0.27 * sgn);
        }
        let y = 0.58;
        if (L2) { box(body, F, 0.52, 0.3, 0.52, 0, y, 0, true); band(body, M.gold, 0.52, 0.52, y + 0.24); fins(body, 0.66, 0.66, 0.16, 0.5); y += 0.3; }
        if (L4) rays(body, y - 0.04, A ? 0.24 : 0.3, 0.3, 12);
        if (A) { const h = L4 ? 0.6 : 0.4; box(body, F, 0.36, h, 0.36, 0, y, 0, true); band(body, lit, 0.36, 0.36, y + h - 0.08); y += h; }
        if (B) { cyl(body, M.gunmetal, 0.34, 0.36, 0.14, 0, y, 0, 20); torus(body, lit, 0.35, 0.022, 0, y + 0.1, 0); y += 0.14; }
        const head = new THREE.Group(); head.position.y = y; body.add(head);
        cyl(head, M.brass, 0.2, 0.24, 0.1, 0, 0, 0, 16);
        const sc = A ? (L4 ? 1.15 : 1.05) : B ? 1 : L2 ? 1.15 : 1;
        const R = 0.11 * sc, cy = 0.1 + R + 0.02, x0 = -0.3 * sc, lb = (A ? 0.55 : 0.48) * sc;
        // the boiler, capped at the back, banded in gold
        rod(head, M.gunmetal, R, lb, x0, cy);
        ball(head, M.brass, R * 0.96, x0, cy);
        for (const x of [x0 + 0.05, x0 + lb - 0.04]) hoop(head, M.gold, R + 0.008, 0.016, x, cy);
        // steam vents either side at the back: the overlay puffs steam from them on each shot
        for (const z of [-1, 1]) cyl(head, M.gunmetal, 0.022, 0.026, 0.14, x0 + 0.08, cy, z * (R + 0.02), 8);
        // the pressure gauge: a cream dial in a gold rim facing sideways, its needle climbing as it reloads
        const gx = x0 + lb * 0.55, gyy = cy + R + 0.07;
        cyl(head, M.brass, 0.012, 0.012, 0.06, gx, cy + R - 0.01, 0, 6);
        const rim = torus(head, M.gold, 0.05, 0.011, gx, gyy, 0); rim.rotation.set(0, 0, 0);
        ball(head, M.cream, 0.045, gx, gyy, 0).scale.z = 0.25;
        const needle = new THREE.Group(); needle.position.set(gx, gyy, 0.014); head.add(needle);
        box(needle, M.ember, 0.008, 0.04, 0.006, 0, 0, 0);
        const bolts = []; // the hot rivet(s) loaded in the muzzle: gone with the shot, back partway through reloading
        let spin = null, tip;
        if (A) {
          // a long barrel driven by twin copper pistons, with a sight on top
          const bl = (L4 ? 0.62 : 0.52) * sc, bx = x0 + lb;
          rod(head, M.steel, 0.055, bl, bx, cy, 0, 0.045);
          for (const x of [bx + bl * 0.4, bx + bl - 0.03]) hoop(head, M.gold, 0.06, 0.016, x, cy);
          for (const z of [-1, 1]) {
            rod(head, M.copper, 0.022, lb * 0.8, x0 + 0.08, cy - R * 0.35, z * (R + 0.025));
            rod(head, M.steel, 0.014, bl * 0.6, x0 + 0.08 + lb * 0.8, cy - R * 0.35, z * (R + 0.025));
          }
          rod(head, M.gunmetal, 0.035, 0.32, x0 + lb * 0.75, cy + R + 0.07); hoop(head, M.gold, 0.04, 0.011, x0 + lb * 0.75 + 0.3, cy + R + 0.07); // sight
          if (L4) gem(head, M.goldGlow, 0.035, x0 + lb * 0.75 + 0.36, cy + R + 0.07, 0, 1.2);
          tip = bx + bl;
          bolts.push(rod(head, M.lantern, 0.022, 0.12, tip - 0.06, cy, 0, 0.004)); // a white-hot spike, point out
        } else if (B) {
          // a rotary cluster of short barrels, fed by a drum of hot rivets on the side
          const n = L4 ? 6 : 4, bl = L4 ? 0.42 : 0.36, cr = 0.055, bx = x0 + lb;
          spin = new THREE.Group(); spin.position.set(bx, cy, 0); head.add(spin);
          for (let k = 0; k < n; k++) { const a = (k / n) * TAU; rod(spin, M.steel, 0.024, bl, 0, Math.cos(a) * cr, Math.sin(a) * cr); }
          for (const x of [0.05, bl - 0.02]) hoop(spin, x > 0.1 ? lit : M.gold, cr + 0.035, 0.014, x, 0);
          const drum = new THREE.Group(); drum.position.set(x0 + lb * 0.45, cy, R + 0.1); head.add(drum);
          const dr = L4 ? 0.1 : 0.085;
          const d = cyl(drum, M.brass, dr, dr, 0.07, 0, -0.035, 0, 18); d.rotation.x = Math.PI / 2; d.position.set(0, 0, 0);
          torus(drum, M.gold, dr + 0.005, 0.012, 0, 0, 0.036).rotation.set(0, 0, 0);
          for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; ball(drum, M.ember, 0.017, Math.cos(a) * dr * 0.7, Math.sin(a) * dr * 0.7, 0.04); }
          tip = bx + bl;
          bolts.push(ball(head, M.ember, 0.03, tip + 0.01, cy));
          spin.userData.drum = drum;
        } else {
          const bl = 0.3 * sc, bx = x0 + lb;
          rod(head, M.steel, 0.048, bl, bx, cy, 0, 0.04);
          hoop(head, L2 ? M.gold : M.brass, 0.052, 0.016, bx + bl - 0.02, cy);
          tip = bx + bl;
          bolts.push(ball(head, M.ember, 0.034, tip + 0.01, cy));
        }
        // the hopper of glowing rivets riding on the boiler's back
        if (!B) {
          box(head, M.brass, 0.13, 0.08, 0.13, x0 + 0.1, cy + R - 0.02, 0);
          for (const [dx, dz] of [[-0.03, -0.03], [0.03, 0.02], [-0.01, 0.035]]) ball(head, M.ember, 0.02, x0 + 0.1 + dx, cy + R + 0.07, dz);
        }
        muzzle = { h: y + cy, r: tip, flash: false, vent: { x: x0 + 0.08, z: R + 0.02, h: y + cy + 0.14 } };
        barrel = { obj: head, x0: x0 + lb, x1: tip, y: cy, r: A ? 0.062 : B ? 0.1 : 0.056, zs: [0] };
        tick = (t, time) => {
          head.rotation.y = -t.aim;
          const spent = t.s && t.s.rate ? Math.min(1, Math.max(0, (t.cool || 0) * t.s.rate)) : 0;
          for (const b of bolts) b.visible = spent < 0.6;
          // pressure falls with the shot and builds back up as it reloads
          needle.rotation.z = 1.1 - (1 - spent) * 2.2;
          if (spin) { spin.rotation.x = time * 9; spin.userData.drum.rotation.z = -time * 2; }
          // a small kick back along the aim as it fires
          const kick = Math.max(0, t.flash || 0) / 0.1 * 0.05;
          head.position.x = -Math.cos(t.aim) * kick; head.position.z = -Math.sin(t.aim) * kick;
        };
        break;
      }
      case 'cannon': {
        // a bastion with corner drums under a big turret. Mortar raises a fat tube at the sky; Shredder turns
        // rotary clusters of barrels.
        box(body, M.navy, 1.8, 0.3, 1.8, 0, 0, 0, true);
        let y = 0.3;
        if (L2) { box(body, F, 1.4, 0.26, 1.4, 0, y, 0, true); band(body, M.gold, 1.4, 1.4, y + 0.2); y += 0.26; }
        if (L4) { box(body, M.navy, 1.14, 0.14, 1.14, 0, y, 0, true); band(body, lit, 1.14, 1.14, y + 0.08); y += 0.14; }
        const dh = y + 0.2;
        for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const x = sx * 0.7, z = sz * 0.7;
          cyl(body, M.gunmetal, 0.2, 0.23, dh, x, 0, z, 14); cyl(body, M.gold, 0.22, 0.22, 0.04, x, dh, z, 14);
          if (L3) torus(body, lit, 0.215, 0.02, x, dh - 0.1, z);
          if (L4) cyl(body, M.gold, 0.004, 0.07, 0.42, x, dh + 0.04, z, 6);
        }
        const head = new THREE.Group(); head.position.y = y; body.add(head);
        const wheel = gear(head, M.gold, 0.6, 0.07, 16, 0, 0.07);
        cyl(head, M.gunmetal, 0.46, 0.54, 0.36, 0, 0.07, 0, 20);
        cyl(head, M.gold, 0.48, 0.48, 0.03, 0, 0.43, 0, 20);
        ball(head, M.navy, 0.3, 0, 0.44, 0);
        const core = gem(head, M.dim, 0.1, 0, 0.8, 0, 1.2);
        const spin = [];
        let mh = 0.3, mr = 1.4;
        if (A) {
          const r = L4 ? 0.34 : 0.28, len = L4 ? 0.82 : 0.7, tube = new THREE.Group();
          tube.position.set(0.12, 0.36, 0); tube.rotation.z = 0.62; head.add(tube);
          rod(tube, M.gunmetal, r, len, 0, 0, 0, r * 1.15);
          for (const x of [0.12, len - 0.06]) hoop(tube, M.gold, r * (1 + x / len * 0.15) + 0.02, 0.03, x, 0);
          if (L4) {
            for (const z of [-1, 1]) box(head, M.gold, 0.5, 0.06, 0.04, 0.15, 0.4, z * (r + 0.08)).rotation.z = 0.62;
            for (const [x, z] of [[-0.42, -0.14], [-0.42, 0.14], [-0.42, 0]]) ball(head, M.gunmetal, 0.1, x, 0.5 + (z ? 0 : 0.14), z);
          }
          mh = 0.36 + Math.sin(0.62) * len; mr = 0.12 + Math.cos(0.62) * len;
          barrel = { obj: tube, x0: 0, x1: len, y: 0, r: r * 1.15 + 0.02, zs: [0] };
        } else if (B) {
          const zs = L4 ? [-0.24, 0.24] : [0], len = L4 ? 1.2 : 1.05, r = L4 ? 0.13 : 0.15;
          for (const z of zs) {
            const cl = new THREE.Group(); cl.position.set(0.3, 0.27, z); head.add(cl); spin.push(cl);
            for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; rod(cl, M.gunmetal, 0.045, len, 0, Math.cos(a) * r, Math.sin(a) * r); }
            for (const x of [0.06, len * 0.55, len - 0.04]) hoop(cl, x > len * 0.5 ? lit : M.gold, r + 0.05, 0.025, x, 0);
          }
          mr = 0.3 + len;
          barrel = { obj: head, x0: 0.3, x1: 0.3 + len, y: 0.27, r: r + 0.06, zs };
        } else {
          const r = L2 ? 0.2 : 0.17, len = L2 ? 1.3 : 1.12;
          rod(head, M.gunmetal, r, len, 0.25, 0.27, 0, r * 0.9);
          for (const x of [0.75, 1.0]) hoop(head, M.gold, r + 0.012, 0.02, x, 0.27);
          hoop(head, M.gold, r * 0.9 + 0.03, 0.04, 0.25 + len, 0.27);
          mr = 0.25 + len;
          barrel = { obj: head, x0: 0.25, x1: 0.25 + len, y: 0.27, r: r + 0.015, zs: [0] };
        }
        muzzle = { h: y + mh, r: mr };
        tick = (t, time) => {
          head.rotation.y = -t.aim; wheel.rotation.y = time * 0.3; core.material = M.dim;
          for (const c of spin) c.rotation.x = time * 7;
        };
        break;
      }
      case 'frost': {
        // an ice obelisk with a floating crystal. Blizzard spreads a wide snowflake crown; Cryo locks one huge
        // crystal in a gold cage.
        cyl(body, M.navy, 0.4, 0.44, 0.22, 0, 0, 0, 6);
        cyl(body, M.gold, 0.41, 0.41, 0.03, 0, 0.22, 0, 6);
        const sh = 0.75 + (L2 ? 0.3 : 0) + (L4 ? 0.2 : 0), st = 0.25 + sh;
        cyl(body, M.navy, 0.12, 0.25, sh, 0, 0.25, 0, 6);
        torus(body, M.gold, 0.14, 0.02, 0, st, 0);
        if (L2) for (let k = 0; k < 3; k++) { const p = new THREE.Group(); p.rotation.y = (k / 3) * TAU; body.add(p); box(p, M.gold, 0.12, sh * 0.75, 0.02, 0.22, 0.25, 0).rotation.z = 0.08; }
        if (L3) torus(body, lit, 0.2, 0.022, 0, 0.25 + sh * 0.45, 0);
        if (L4) rays(body, st - 0.02, 0.12, 0.34, 8, M.gold);
        const top = st + (B ? 0.5 : 0.36);
        const spin = new THREE.Group(); spin.position.y = top; body.add(spin);
        const size = B ? (L4 ? 0.3 : 0.25) : L2 ? 0.18 : 0.15;
        const c = gem(spin, M.ice, size, 0, 0, 0, 1.6);
        if (A) {
          for (let k = 0; k < (L4 ? 12 : 6); k++) {
            const a = (k / 6) * TAU + (k >= 6 ? Math.PI / 6 : 0), r = k >= 6 ? 0.26 : 0.38, s = gem(spin, M.ice, 1, Math.cos(a) * r, k >= 6 ? 0.12 : 0, Math.sin(a) * r);
            s.scale.set(k >= 6 ? 0.12 : 0.2, 0.035, 0.05); s.rotation.y = -a;
          }
        } else if (B) {
          const r = size + 0.12, h = size * 3.4;
          for (const y of [-h / 2, h / 2]) torus(spin, M.gold, r, 0.022, 0, y, 0);
          for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; cyl(spin, M.gold, 0.014, 0.014, h, Math.cos(a) * r, -h / 2, Math.sin(a) * r, 6); }
          if (L4) for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; cyl(spin, M.gold, 0.002, 0.03, 0.16, Math.cos(a) * r, h / 2, Math.sin(a) * r, 6); }
        } else {
          for (let k = 0; k < (L2 ? 4 : 3); k++) { const a = (k / (L2 ? 4 : 3)) * TAU; gem(spin, M.ice, 0.05, Math.cos(a) * 0.3, 0.04 * (k % 2), Math.sin(a) * 0.3, 1.8); }
        }
        tick = (t, time) => { spin.rotation.y = time * (B ? 0.4 : 0.7); c.rotation.y = time * 1.2; };
        light = { h: top, color: P.ice, r: B ? 0.7 : 0.5 };
        // the obelisk shaft stands in for a barrel: an upright axis, so path accents ring the shaft
        const ax = new THREE.Group(); ax.position.y = 0.25; ax.rotation.z = Math.PI / 2; body.add(ax);
        barrel = { obj: ax, x0: 0.06, x1: sh * 0.85, y: 0, r: 0.2, zs: [0] };
        break;
      }
      case 'tesla': {
        // a copper coil on an L-shaped plinth. Storm plants small satellite coils on every tile; Overload
        // swells into one massive toroid.
        for (const [cx, cz] of cells) box(body, M.navy, 0.86, 0.16, 0.86, cx, 0, cz, true);
        box(body, M.navy, 0.6, 0.18, 0.6, 0, 0.16, 0, true);
        if (L2) band(body, M.gold, 0.6, 0.6, 0.3);
        const ch = 1.0 + (L2 ? 0.3 : 0) + (L4 ? 0.2 : 0), top = 0.34 + ch;
        cyl(body, M.copper, 0.13, 0.18, ch, 0, 0.34);
        for (let y = 0.44; y < top - 0.1; y += 0.15) torus(body, M.gold, 0.19, 0.022, 0, y, 0);
        if (L3) torus(body, lit, 0.24, 0.025, 0, 0.42, 0);
        let sy;
        if (B) {
          torus(body, M.gold, L4 ? 0.58 : 0.5, 0.09, 0, top, 0);
          if (L4) torus(body, M.gold, 0.4, 0.07, 0, top + 0.2, 0);
          sy = top + (L4 ? 0.5 : 0.36); ball(body, M.cream, L4 ? 0.34 : 0.28, 0, sy, 0);
        } else {
          torus(body, M.gold, 0.4, 0.05, 0, top, 0);
          if (L2) torus(body, M.gold, 0.3, 0.045, 0, top + 0.16, 0);
          sy = top + (L2 ? 0.36 : 0.26); ball(body, M.cream, L2 ? 0.23 : 0.2, 0, sy, 0);
          if (L4 && A) rays(body, top + 0.2, 0.18, 0.36, 10);
        }
        if (A) for (const [cx, cz] of cells) {
          const x = cx * 1.3, z = cz * 1.3, h = L4 ? 0.8 : 0.55;
          cyl(body, M.copper, 0.045, 0.06, h, x, 0.16, z, 8);
          for (let k = 0; k < 3; k++) torus(body, M.gold, 0.08, 0.014, x, 0.26 + k * (h / 4), z);
          torus(body, M.gold, 0.13, 0.025, x, 0.16 + h, z);
          ball(body, M.cream, 0.08, x, 0.16 + h + 0.1, z);
        }
        light = { h: sy, color: P.goldHi, r: B ? 0.95 : 0.7 };
        // the coil is the "barrel": upright, so accents ring the copper column just outside its gold windings
        { const ax = new THREE.Group(); ax.position.y = 0.34; ax.rotation.z = Math.PI / 2; body.add(ax);
          barrel = { obj: ax, x0: 0.04, x1: ch - 0.04, y: 0, r: 0.25, zs: [0] }; }
        break;
      }
      case 'rail': {
        // a long gun on a gun deck that rises with each level. Gauss stretches the rails and wraps them in coils;
        // Pulse Rail bundles three short barrels.
        body.rotation.y = yaw;
        const gy = L4 ? 0.64 : L2 ? 0.52 : 0.4;
        const reach = A ? (L4 ? 2.55 : 2.35) : B ? (L4 ? 2.0 : 1.85) : L2 ? 2.2 : 2.0, hw = B ? 0.68 : 0.52;
        box(body, M.navy, 1.72, gy - 0.06, hw, 0, 0, 0, true);
        box(body, M.marble, 0.3, gy + 0.18, hw + 0.14, -0.76, 0, 0, true);
        if (L2) {
          band(body, M.gold, 1.72, hw, gy - 0.16);
          // capacitor banks down both flanks
          for (const z of [-1, 1]) for (let k = 0; k < 3; k++) cyl(body, M.copper, 0.055, 0.055, gy - 0.1, -0.42 + k * 0.2, 0, z * (hw / 2 + 0.04), 10);
        }
        if (L3) band(body, lit, 0.3, hw + 0.14, gy + 0.08, -0.76);
        // the T4 beacon is Capacitor's charge crystal: game.js lights it from muzzle.core, tick swells it
        let crystal = null;
        if (L4) { for (let k = 0; k < 5; k++) box(body, M.gold, 0.03, 0.26, hw + 0.16, -0.86 + k * 0.05, gy + 0.18, 0); crystal = beacon(body, lit, gy + 0.44, 0.06, -0.76); crystal.userData.s0 = crystal.scale.clone(); }
        const cores = [];
        if (B) {
          for (const z of [-0.2, 0, 0.2]) {
            rod(body, M.gunmetal, 0.075, reach, -0.6, gy, z);
            cores.push(rod(body, M.dim, 0.03, reach + 0.04, -0.6, gy, z));
            hoop(body, M.gold, 0.085, 0.02, -0.6 + reach, gy, z);
          }
          if (L4) for (const x of [0.2, 0.7]) box(body, M.gold, 0.06, 0.06, 0.62, x, gy + 0.06, 0);
        } else {
          const r = A ? 0.042 : 0.034;
          for (const z of [-0.13, 0.13]) rod(body, M.gold, r, reach, -0.6, gy, z);
          cores.push(rod(body, M.dim, 0.024, reach - 0.1, -0.55, gy, 0));
          if (A) for (let x = -0.2; x < reach - 0.7; x += 0.32) hoop(body, x > reach * 0.5 ? lit : M.gold, 0.2, 0.03, x, gy);
        }
        const lamps = [0, 1, 2].map((k) => box(body, M.dim, 0.1, 0.05, 0.26, -0.5 + k * 0.24, gy - 0.06, 0));
        muzzle = { h: gy, r: reach - 0.6, flash: false, core: crystal && { h: gy + 0.74, r: -0.76 } };
        barrel = { obj: body, x0: -0.2, x1: reach - 0.6, y: gy, r: B ? 0.3 : 0.2, zs: [0] };
        for (const x of [0.3, 0.85]) box(body, M.gunmetal, 0.07, 0.14, B ? 0.62 : 0.36, x, gy - 0.07, 0);
        tick = (t) => {
          const ready = t.s && t.s.rate ? 1 - Math.min(1, Math.max(0, (t.cool || 0) * t.s.rate)) : 1;
          lamps.forEach((l, k) => { l.material = ready >= (k + 1) / 3 ? M.goldGlow : M.dim; });
          for (const c of cores) c.material = t.flash > 0 ? M.cream : M.dim;
          if (crystal) { const k = t.charge > 1 && t.s && t.s.charge ? 1 + 0.6 * (t.charge - 1) / (t.s.charge.max - 1) : 1; crystal.scale.copy(crystal.userData.s0).multiplyScalar(k); }
        };
        break;
      }
      case 'flame': {
        // a fuel depot: tanks behind a nozzle turret. Inferno stretches a long finned lance; Dragon opens a
        // wide bell mouth ringed with teeth.
        box(body, M.navy, 0.8, 0.36, 0.8, 0, 0, 0, true);
        const rig = new THREE.Group(); rig.rotation.y = yaw; body.add(rig);
        for (const [x, z] of [[0.405, 0], [0, 0.405], [0, -0.405]]) { const m = box(rig, M.ember, 0.46, 0.12, 0.012, x, 0.12, z); if (!z) m.rotation.y = Math.PI / 2; }
        let y = 0.36;
        if (L2) { box(rig, M.navy, 0.46, 0.18, 0.46, 0, y, 0, true); band(rig, M.gold, 0.46, 0.46, y + 0.14); y += 0.18; }
        if (L4) { box(rig, M.navy, 0.36, 0.12, 0.36, 0, y, 0, true); band(rig, lit, 0.36, 0.36, y + 0.06); y += 0.12; }
        const tanks = L4 ? [-0.25, 0, 0.25] : L2 ? [-0.17, 0.17] : [0];
        tanks.forEach((z, k) => {
          const h = 0.5 + (L2 ? 0.14 : 0) + (L4 && k === 1 ? 0.22 : 0);
          cyl(rig, M.brass, 0.1, 0.1, h, -0.29, 0.36, z, 14);
          ball(rig, M.brass, 0.1, -0.29, 0.36 + h, z);
          torus(rig, L3 ? lit : M.gold, 0.105, 0.015, -0.29, 0.36 + h * 0.6, z);
        });
        const head = new THREE.Group(); head.position.y = y; head.rotation.y = yaw; body.add(head);
        cyl(head, M.gunmetal, 0.17, 0.21, 0.16);
        let len;
        if (A) {
          len = L4 ? 1.05 : 0.9;
          rod(head, M.gunmetal, 0.1, len, 0, 0.18, 0, 0.07);
          for (let x = 0.12; x < len * 0.6; x += 0.1) hoop(head, M.gold, 0.12, 0.022, x, 0.18);
          hoop(head, lit, 0.08, 0.02, len - 0.02, 0.18);
        } else if (B) {
          len = L4 ? 0.82 : 0.7;
          rod(head, M.brass, 0.1, len * 0.45, 0, 0.18);
          rod(head, M.brass, 0.1, len * 0.55, len * 0.45, 0.18, 0, L4 ? 0.34 : 0.28);
          hoop(head, M.gold, L4 ? 0.34 : 0.28, 0.025, len, 0.18);
          if (L4) for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; const tth = cyl(head, M.gold, 0.001, 0.035, 0.12, 0, 0, 0, 5); tth.rotation.z = -Math.PI / 2; tth.position.set(len + 0.05, 0.18 + Math.cos(a) * 0.3, Math.sin(a) * 0.3); }
        } else {
          len = L2 ? 0.72 : 0.62;
          rod(head, M.brass, 0.085, len, 0, 0.17, 0, L2 ? 0.14 : 0.12);
          hoop(head, M.gold, (L2 ? 0.14 : 0.12) + 0.01, 0.02, len, 0.17);
        }
        ball(head, M.ember, 0.05, len + 0.02, 0.18, 0);
        barrel = { obj: head, x0: 0.14, x1: len, y: 0.18, r: B ? (L4 ? 0.34 : 0.28) : A ? 0.1 : 0.09, zs: [0] };
        muzzle = { h: y + 0.18, r: len + 0.06, flash: false };
        light = { h: y + 0.18, color: P.ember, r: B ? 0.5 : 0.35, ox: Math.cos((dir * Math.PI) / 2) * len, oy: Math.sin((dir * Math.PI) / 2) * len };
        break;
      }
      case 'amp': {
        // a broadcasting mast. Overclock (A) spins gold dynamo gears on it; Relay (B) turns a big dish.
        box(body, M.navy, 0.66, 0.26, 0.66, 0, 0, 0, true); box(body, M.navy, 0.42, 0.26, 0.42, 0, 0.26, 0, true);
        if (L2) { band(body, M.gold, 0.42, 0.42, 0.44); fins(body, 0.66, 0.66, 0, 0.4); }
        if (L3) torus(body, lit, 0.24, 0.022, 0, 0.54, 0);
        if (L4) rays(body, 0.5, 0.18, 0.32, 10);
        const mh = 1.25 + (L2 ? 0.25 : 0) + (L4 ? 0.2 : 0), top = 0.52 + mh + 0.04;
        cyl(body, M.gold, 0.012, 0.1, mh, 0, 0.52, 0, 4);
        const nr = L2 ? 4 : 3;
        for (let k = 0; k < nr; k++) torus(body, M.gold, 0.1 - k * 0.018, 0.012, 0, 0.84 + k * ((mh - 0.45) / nr), 0);
        if (L2) for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) strut(body, M.brass, 0.008, sx * 0.28, 0.26, sz * 0.28, 0, 0.52 + mh * 0.55, 0);
        gem(body, M.goldGlow, 0.08, 0, top, 0, 1.4);
        const waves = [0, 1, 2].map(() => {
          const m = new THREE.Mesh(shared('wave', () => new THREE.TorusGeometry(1, 0.016, 6, 40)), new THREE.MeshBasicMaterial({ color: 0xf3d88a, transparent: true, depthWrite: false }));
          m.rotation.x = Math.PI / 2; m.position.y = top; body.add(m); return m;
        });
        const turn = [];
        if (A) {
          turn.push([gear(body, M.gold, L4 ? 0.26 : 0.22, 0.05, 12, 0, 0.52 + mh * 0.38), 2]);
          ball(body, M.goldGlow, 0.07, 0, 0.52 + mh * 0.38, 0);
          if (L4) turn.push([gear(body, M.brass, 0.17, 0.04, 10, 0, 0.52 + mh * 0.38 + 0.12), -3]);
        } else if (B) {
          const r = L4 ? 0.44 : 0.36, mount = new THREE.Group(); mount.position.y = 0.52 + mh * 0.5; body.add(mount);
          const dish = new THREE.Mesh(shared(`dish${r}`, () => new THREE.SphereGeometry(r, 20, 8, 0, TAU, 0, 0.75)), M.goldTwo);
          const tilt = new THREE.Group(); tilt.rotation.z = 0.45; mount.add(tilt);
          dish.rotation.z = Math.PI / 2; dish.position.x = r * 0.85; tilt.add(dish);
          rod(tilt, M.cream, 0.012, r * 0.9, 0.12, 0);
          ball(tilt, M.cream, 0.035, 0.12 + r * 0.9, 0);
          turn.push([mount, 1.2]);
          if (L4) { const m2 = new THREE.Group(); m2.position.y = 0.52 + mh * 0.82; body.add(m2); const d2 = new THREE.Mesh(shared('dish0.18', () => new THREE.SphereGeometry(0.18, 16, 6, 0, TAU, 0, 0.75)), M.goldTwo); d2.rotation.z = Math.PI / 2; d2.position.x = 0.16; m2.add(d2); turn.push([m2, -2]); }
        }
        tick = (t, time) => {
          waves.forEach((w, k) => { const ph = (time * 0.6 + k / 3) % 1; w.scale.setScalar(0.12 + ph * 0.75); w.material.opacity = (1 - ph) * 0.8; });
          for (const [o, s] of turn) o.rotation.y = time * s;
        };
        light = { h: top, color: P.goldHi, r: 0.45 };
        // the mast is the "barrel": upright, so accents ring it between the gold hoops
        const ax = new THREE.Group(); ax.position.y = 0.52; ax.rotation.z = Math.PI / 2; body.add(ax);
        barrel = { obj: ax, x0: 0.06, x1: mh * 0.8, y: 0, r: 0.13, zs: [0] };
        break;
      }
      case 'prism': {
        // a crystal skyscraper over all three tiles. Lance climbs into a needle spire; Spectrum raises a jewel
        // on each end tile as well.
        const vert = cells.every((c) => Math.abs(c[0]) < 0.01);
        if (vert) body.rotation.y = Math.PI / 2;
        box(body, F, 2.72, 0.4, 0.74, 0, 0, 0, true); box(body, F, 1.9, 0.6, 0.58, 0, 0.4, 0, true);
        box(body, M.lilac, 2.74, 0.035, 0.76, 0, 0.4); box(body, M.lilac, 1.92, 0.035, 0.6, 0, 1.0);
        let y = 1.0;
        if (L2) { box(body, F, 1.1, 0.62, 0.46, 0, y, 0, true); box(body, M.lilac, 1.12, 0.035, 0.48, 0, y + 0.62); fins(body, 1.9, 0.58, 0.4, 0.6); y += 0.62; }
        const mat = M.lilac.clone(); // its own material, so each prism's jewels brighten with its beam
        const jewels = [];
        let jy, spire;
        if (A) {
          const h = L4 ? 0.95 : 0.65;
          spire = [y, y + h];
          box(body, F, 0.5, h, 0.32, 0, y, 0, true); band(body, lit, 0.5, 0.32, y + h - 0.1); y += h;
          if (L4) rays(body, y, 0.12, 0.4, 10);
          cyl(body, M.gold, 0.01, 0.04, 0.55, 0, y, 0, 6);
          jy = y + 0.85; jewels.push([gem(body, mat, 0.17, 0, jy, 0, 2.4), 0.17, 2.4]);
        } else if (B) {
          spire = [y, y + 0.36];
          box(body, F, 0.5, 0.36, 0.34, 0, y, 0, true); band(body, lit, 0.5, 0.34, y + 0.28); y += 0.36;
          cyl(body, M.gold, 0.01, 0.03, 0.3, 0, y, 0, 6);
          jy = y + 0.55; jewels.push([gem(body, mat, 0.2, 0, jy, 0, 1.6), 0.2, 1.6]);
          const ph = L4 ? 1.15 : 0.8;
          for (const sx of [-1, 1]) {
            box(body, F, 0.42, ph, 0.4, sx * 1.08, 0.4, 0, true); band(body, lit, 0.42, 0.4, 0.4 + ph - 0.08, sx * 1.08);
            cyl(body, M.gold, 0.008, 0.025, 0.22, sx * 1.08, 0.4 + ph, 0, 6);
            jewels.push([gem(body, mat, 0.12, sx * 1.08, 0.4 + ph + 0.4, 0, 1.6), 0.12, 1.6]);
            if (L4) rays(body, 0.4 + ph, 0.1, 0.26, 8, M.gold, sx * 1.08);
          }
        } else {
          spire = [y, y + 0.4];
          box(body, F, 0.42, 0.4, 0.3, 0, y, 0, true); y += 0.4;
          cyl(body, M.gold, 0.012, 0.03, 0.34, 0, y, 0, 6);
          jy = y + 0.5; jewels.push([gem(body, mat, 0.2, 0, jy, 0, 1.6), 0.2, 1.6]);
        }
        tick = (t, time) => {
          const k = t.ramp || 0; mat.emissiveIntensity = 0.85 + k * 2;
          for (const [j, s, sy] of jewels) { j.rotation.y = time * (0.8 + k * 4); j.scale.setScalar(s * (1 + k * 0.35)); j.scale.y = s * sy * (1 + k * 0.35); }
        };
        light = { h: jy, color: P.lilac, r: 0.6 };
        // the central spire stands in for a barrel: an upright axis, so path accents ring it
        const ax = new THREE.Group(); ax.position.y = spire[0]; ax.rotation.z = Math.PI / 2; body.add(ax);
        barrel = { obj: ax, x0: 0.04, x1: spire[1] - spire[0], y: 0, r: 0.3, zs: [0] };
        break;
      }
      case 'light': {
        // a brass searchlight. Designator swells into a great louvred drum on a short mast; Lighthouse climbs a
        // tall banded tower with a gallery.
        box(body, F, 0.7, 0.36, 0.7, 0, 0, 0, true);
        if (L2) { band(body, M.gold, 0.7, 0.7, 0.3); fins(body, 0.7, 0.7, 0, 0.36); }
        let top;
        if (B) {
          const th = L4 ? 1.6 : 1.3;
          cyl(body, M.navy, 0.17, 0.27, th, 0, 0.36, 0, 16);
          for (let k = 1; k < 4; k++) { const f = k / 4; torus(body, k === 2 ? lit : M.cream, 0.27 - f * 0.1 + 0.005, 0.03, 0, 0.36 + th * f, 0); }
          top = 0.36 + th;
          cyl(body, M.gold, 0.3, 0.3, 0.04, 0, top, 0, 20); torus(body, M.gold, 0.3, 0.015, 0, top + 0.14, 0);
          for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; cyl(body, M.gold, 0.008, 0.008, 0.14, Math.cos(a) * 0.3, top + 0.04, Math.sin(a) * 0.3, 4); }
          for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; cyl(body, M.gold, 0.012, 0.012, 0.46, Math.cos(a) * 0.2, top + 0.04, Math.sin(a) * 0.2, 4); }
          const cap = cyl(body, M.navy, 0.02, 0.26, L4 ? 0.26 : 0.18, 0, top + 0.5, 0, 8);
          if (L4) beacon(body, M.cream, top + 0.74, 0.05);
          top += 0.04;
        } else {
          const mh = A ? (L4 ? 0.75 : 0.65) : L2 ? 0.95 : 0.65;
          box(body, M.navy, 0.46, 0.24, 0.46, 0, 0.36, 0, true);
          for (const [x, z] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]]) cyl(body, M.brass, 0.02, 0.03, mh, x, 0.6, z, 6);
          for (let k = 1; k <= Math.round(mh / 0.3); k++) box(body, M.gold, 0.32, 0.02, 0.32, 0, 0.6 + k * (mh / Math.round(mh / 0.3)) - 0.02, 0);
          if (L3) band(body, lit, 0.46, 0.46, 0.5);
          top = 0.6 + mh;
          if (L4) rays(body, top - 0.1, 0.22, 0.3, 12);
        }
        cyl(body, M.gunmetal, 0.26, 0.2, 0.08, 0, top);
        const head = new THREE.Group(); head.position.y = top + 0.08; body.add(head);
        const r = A ? (L4 ? 0.34 : 0.28) : B ? 0.16 : L2 ? 0.2 : 0.17;
        torus(head, M.gold, r + 0.06, 0.025, 0, r + 0.02, 0, Math.PI).rotation.set(0, Math.PI / 2, Math.PI); // the yoke
        rod(head, M.brass, r, 0.36 + r * 0.4, -0.16 - r * 0.4, r + 0.02, 0, r * 1.1);
        const lens = cyl(head, M.cream, r * 0.95, r * 0.95, 0.03, 0, 0, 0, 20); lens.rotation.z = Math.PI / 2; lens.position.set(0.21, r + 0.02, 0);
        hoop(head, M.gold, r * 1.1, 0.022, 0.22, r + 0.02);
        if (A) {
          for (const y of [-0.5, 0, 0.5]) box(head, M.gold, 0.02, 0.025, r * 2, 0.24, r + 0.02 + y * r, 0);
          if (L4) for (const z of [-0.1, 0.1]) cyl(head, M.gunmetal, 0.018, 0.018, 0.3, -0.1, r * 2, z, 6);
        }
        tick = (t) => { head.rotation.y = -t.aim; lens.material = t.disabledT > 0 ? M.dim : M.cream; };
        light = { h: top + 0.1 + r, color: P.cream, r: A ? 0.7 : 0.5 };
        // the lamp drum is the barrel: it turns with the beam, lens at x = 0.21
        barrel = { obj: head, x0: -0.16 - r * 0.4, x1: 0.2, y: r + 0.02, r: r * 1.1, zs: [0] };
        break;
      }
      case 'mines': {
        // a squat bunker drum with a hatch, and a conveyor of gear-shaped mines feeding it. Heavy Charge armours
        // the drum and carries fat mines; Incendiary vents fire from its chimneys.
        const vert = cells.every((c) => Math.abs(c[0]) < 0.01);
        if (vert) body.rotation.y = Math.PI / 2;
        box(body, M.navy, 1.8, 0.16, 0.76, 0, 0, 0, true);
        const dh = 0.42 + (L2 ? 0.18 : 0) + (L4 ? 0.14 : 0), dt = 0.16 + dh;
        cyl(body, M.gunmetal, 0.4, 0.44, dh, -0.45, 0.16, 0, 18);
        cyl(body, M.gold, 0.42, 0.42, 0.03, -0.45, dt, 0, 18);
        const hatch = cyl(body, M.dim, 0.16, 0.16, 0.04, -0.45, dt + 0.02, 0, 12);
        if (L2) torus(body, M.gold, 0.43, 0.025, -0.45, 0.16 + dh * 0.5, 0);
        if (L3) torus(body, lit, 0.43, 0.022, -0.45, 0.16 + dh * 0.8, 0);
        box(body, M.brass, 1.0, 0.06, 0.3, 0.38, 0.22, 0, true);
        if (L2) for (const z of [-0.17, 0.17]) box(body, M.gold, 1.0, 0.08, 0.02, 0.38, 0.22, z);
        const mr = A ? 0.12 : 0.09;
        const belt = [0, 1, 2, 3].map((k) => { const m = cyl(body, B ? M.ember : A ? M.gunmetal : M.gold, mr, mr, A ? 0.08 : 0.05, 0, 0.29, 0, 8); m.userData.k = k; return m; });
        if (A) {
          for (const z of [-0.32, 0.32]) box(body, M.steel, 0.6, dh * 0.8, 0.06, -0.45, 0.16, z, true);
          if (L4) { cyl(body, M.steel, 0.47, 0.47, 0.12, -0.45, dt - 0.18, 0, 18); for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; cyl(body, M.gold, 0.004, 0.04, 0.2, -0.45 + Math.cos(a) * 0.36, dt + 0.03, Math.sin(a) * 0.36, 6); } }
        }
        const vents = [];
        if (B) for (const [x, z, h] of L4 ? [[-0.82, 0.24, 0.85], [-0.82, -0.24, 0.65]] : [[-0.82, 0.24, 0.7]]) {
          cyl(body, M.gunmetal, 0.06, 0.08, h, x, 0.16, z, 10); torus(body, M.gold, 0.065, 0.015, x, 0.16 + h, z);
          vents.push(ball(body, M.ember, 0.05, x, 0.18 + h, z));
        }
        if (L4) beacon(body, lit, dt + 0.04, 0.06, -0.45);
        tick = (t, time) => {
          belt.forEach((m) => { const ph = (time * 0.4 + m.userData.k / 4) % 1; m.position.x = 0.85 - ph * 0.95; m.rotation.y = time * 2; });
          hatch.material = t.flash > 0 ? M.lantern : M.dim;
          for (const v of vents) v.scale.setScalar(1 + 0.3 * Math.sin(time * 9 + v.position.z * 10));
        };
        light = { h: dt + 0.04, color: B ? P.ember : P.lantern, r: 0.3, ox: vert ? 0 : -0.45, oy: vert ? 0.45 : 0 };
        // the drum is the "barrel": upright, so accents ring it and the cog plates sit on its flanks
        const ax = new THREE.Group(); ax.position.set(-0.45, 0.16, 0); ax.rotation.z = Math.PI / 2; body.add(ax);
        barrel = { obj: ax, x0: 0.04, x1: dh, y: 0, r: 0.44, zs: [0] };
        break;
      }
      case 'clock': {
        // a tiered tower with a gilded clock face on every side; the hour hand jumps on each strike.
        // Chronometer bares turning gears and an orrery; Carillon opens a belfry of swinging bells.
        box(body, F, 1.84, 0.5, 1.84, 0, 0, 0, true);
        let y = 0.5;
        if (L2) { box(body, F, 1.36, 0.5, 1.36, 0, y, 0, true); band(body, M.gold, 1.36, 1.36, y + 0.44); fins(body, 1.84, 1.84, 0, 0.5); y += 0.5; }
        else { box(body, F, 1.36, 0.22, 1.36, 0, y, 0, true); y += 0.22; }
        if (L4) { box(body, F, 1.12, 0.3, 1.12, 0, y, 0, true); band(body, lit, 1.12, 1.12, y + 0.24); y += 0.3; }
        const turn = [];
        if (A) for (let k = 0; k < 4; k++) {
          // a gear turning flat against each face of the tier below the clock
          const side = new THREE.Group(); side.rotation.y = (k * Math.PI) / 2; side.position.y = y - 0.24; body.add(side);
          const hold = new THREE.Group(); hold.position.x = L4 ? 0.58 : 0.7; hold.rotation.z = Math.PI / 2; side.add(hold);
          turn.push([gear(hold, k % 2 ? M.brass : M.gold, 0.17, 0.03, 10, 0, 0.0, 0), k % 2 ? -1 : 1]);
        }
        box(body, F, 0.92, 0.9, 0.92, 0, y, 0, true);
        const hands = [];
        for (let k = 0; k < 4; k++) {
          const side = new THREE.Group(); side.rotation.y = (k * Math.PI) / 2; side.position.y = y + 0.45; body.add(side);
          const face = cyl(side, M.cream, 0.34, 0.34, 0.03, 0, 0, 0, 24); face.rotation.z = Math.PI / 2; face.position.set(0.47, 0, 0);
          hoop(side, L3 ? lit : M.gold, 0.36, 0.03, 0.48, 0);
          for (let h = 0; h < 12; h++) { const a = (h / 12) * TAU; const tk = box(side, M.gold, 0.012, 0.05, 0.012, 0.495, 0, 0); tk.position.set(0.495, Math.cos(a) * 0.28, Math.sin(a) * 0.28); tk.rotation.x = -a; }
          const hour = new THREE.Group(); hour.position.set(0.5, 0, 0); side.add(hour);
          box(hour, M.gunmetal, 0.012, 0.2, 0.03, 0, 0, 0);
          const minute = new THREE.Group(); minute.position.set(0.505, 0, 0); side.add(minute);
          box(minute, M.gold, 0.01, 0.28, 0.02, 0, 0, 0);
          hands.push([hour, minute]);
        }
        y += 0.9;
        box(body, M.navy, 1.0, 0.1, 1.0, 0, y, 0, true); y += 0.1;
        const roofY = y;
        let ding, by;
        const bells = [];
        if (B) {
          // an open belfry: four gold posts, a roof, and the bells inside
          const bh = L4 ? 0.62 : 0.5;
          for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) cyl(body, M.gold, 0.03, 0.03, bh, sx * 0.38, y, sz * 0.38, 8);
          box(body, M.navy, 0.92, 0.08, 0.92, 0, y + bh, 0, true);
          bells.push(bell(body, M.gold, L4 ? 0.2 : 0.18, 0, y + bh, 0));
          if (L4) for (const z of [-0.26, 0.26]) bells.push(bell(body, M.brass, 0.1, 0, y + bh - 0.02, z));
          const roof = y + bh + 0.08;
          const cap = cyl(body, M.navy, 0.02, 0.5, L4 ? 0.5 : 0.36, 0, roof, 0, 4); cap.rotation.y = Math.PI / 4;
          if (L4) rays(body, roof, 0.4, 0.26, 12);
          by = roof + (L4 ? 0.5 : 0.36) + 0.12;
        } else {
          const ch = A && L4 ? 0.8 : 0.6;
          const cap = cyl(body, M.navy, 0.02, 0.56, ch, 0, y, 0, 4); cap.rotation.y = Math.PI / 4;
          cyl(body, M.gold, 0.01, 0.03, L2 ? 0.7 : 0.5, 0, y + ch - 0.1, 0, 6);
          by = y + ch + (L2 ? 0.64 : 0.44);
          if (A) {
            for (let k = 0; k < (L4 ? 2 : 1); k++) { const o = new THREE.Group(); o.position.y = y + ch + 0.1 + k * 0.18; body.add(o); torus(o, M.gold, 0.22 - k * 0.06, 0.012, 0, 0, 0).rotation.set(0.5, 0, 0); ball(o, M.goldGlow, 0.035, 0.22 - k * 0.06, 0, 0); turn.push([o, k ? -1.5 : 1]); }
          }
        }
        ding = gem(body, B ? M.lantern : M.goldGlow, 0.08, 0, by, 0, 1.4);
        let shown = 0;
        tick = (t, time) => {
          shown += ((t.strikes || 0) - shown) * 0.2;
          for (const [hour, minute] of hands) { hour.rotation.x = -shown * (TAU / 12); minute.rotation.x = -time * 0.5; }
          ding.scale.setScalar(t.flash > 0 ? 0.13 : 0.08); ding.scale.y *= 1.4;
          for (const [o, s] of turn) o.rotation.y = time * s;
          bells.forEach((b, k) => { b.rotation.x = t.flash > 0 ? Math.sin(time * 14 + k) * 0.35 : 0; });
        };
        light = { h: by, color: P.goldHi, r: 0.45 };
        // the spire above the clock faces is the "barrel": an upright axis, so accents ring the roof and spire
        // without crossing the dials
        const ax = new THREE.Group(); ax.position.y = roofY; ax.rotation.z = Math.PI / 2; body.add(ax);
        barrel = { obj: ax, x0: 0.02, x1: by - roofY - 0.1, y: 0, r: 0.3, zs: [0] };
        break;
      }
      case 'barrier': {
        // riveted brass plates across the road, trimmed in gold. Bulwark (A) grows into a tall crenellated wall;
        // Spiked (B) bristles with spikes and a coil of wire.
        body.rotation.y = yaw;
        const plates = A ? 4 : 3, ph = A ? (L4 ? 0.66 : 0.54) : B ? (L4 ? 0.48 : 0.42) : L2 ? 0.44 : 0.34, pw = L2 ? 0.2 : 0.16;
        for (let k = 0; k < plates; k++) {
          const z = (k - (plates - 1) / 2) * (0.84 / plates);
          box(body, k % 2 ? M.brass : M.gunmetal, pw, ph, 0.84 / plates - 0.02, 0, 0, z, true);
          for (const y of [0.08, ph - 0.08]) ball(body, M.gold, 0.022, pw / 2 + 0.005, y, z);
        }
        box(body, M.gold, pw + 0.04, 0.04, 0.9, 0, ph, 0);
        if (L2) for (const z of [-0.3, 0.3]) { const b = box(body, M.gunmetal, 0.26, ph * 0.7, 0.08, -0.14, 0, z); b.rotation.z = 0.35; }
        if (L3) box(body, lit, pw + 0.05, 0.03, 0.92, 0, ph * 0.5);
        if (A) {
          box(body, M.gunmetal, 0.1, ph * 0.85, 0.9, -0.15, 0, 0, true);
          for (const z of [-0.2, 0.2]) { const c = box(body, M.gold, 0.02, 0.2, 0.04, pw / 2 + 0.01, ph * 0.3, z); c.rotation.x = z > 0 ? 0.6 : -0.6; }
          if (L4) for (let k = 0; k < 4; k++) box(body, k % 2 ? M.brass : M.gunmetal, pw + 0.02, 0.12, 0.13, 0, ph + 0.04, -0.33 + k * 0.22, true);
        }
        if (B) {
          const rows = L4 ? 3 : 2;
          for (let r = 0; r < rows; r++) for (let k = 0; k < 4; k++) for (const sx of [-1, 1]) {
            const sp = cyl(body, M.gold, 0.001, 0.04, L4 ? 0.24 : 0.2, 0, 0, 0, 6); sp.rotation.z = (sx * -Math.PI) / 2;
            sp.position.set(sx * (pw / 2 + 0.1), 0.1 + r * ((ph - 0.14) / Math.max(1, rows - 1)), -0.3 + k * 0.2 + (r % 2) * 0.08);
          }
          if (L4) for (let k = 0; k < 6; k++) { const c = torus(body, M.steel, 0.07, 0.008, 0, ph + 0.1, -0.36 + k * 0.145); c.rotation.set(0, Math.PI / 2, 0); }
        }
        const base = body.position.x;
        tick = (t, time) => { body.position.x = base + (t.flash > 0 ? Math.sin(time * 90) * 0.02 : 0); };
        // the wall itself is the "barrel": its long axis runs across the road, so bands wrap the plates, the
        // muzzle glow sits at one end and the cog plates on its two faces
        const ax = new THREE.Group(); ax.rotation.y = Math.PI / 2; body.add(ax);
        barrel = { obj: ax, x0: -0.42, x1: 0.42, y: ph / 2, r: Math.max(ph, pw) / 2 + 0.02, zs: [0] };
        break;
      }
      case 'sniper': {
        // the Sentinel Rifle: a slim stepped Deco spire with fluted corners, a rooftop turntable on top and a long,
        // thin rifle with a scope. Executioner (A) lengthens the barrel and adds a muzzle brake; Rapid Rifle (B)
        // shortens it and hangs a drum magazine underneath. Each level adds a storey; T4 a gold crown of rays.
        box(body, M.navy, 0.8, 0.14, 0.8, 0, 0, 0, true);
        box(body, F, 0.62, 0.5, 0.62, 0, 0.14, 0, true);
        for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) cyl(body, M.gold, 0.022, 0.022, 0.5, sx * 0.31, 0.14, sz * 0.31, 6);
        band(body, M.gold, 0.62, 0.62, 0.56);
        let y = 0.64;
        if (L2) { box(body, F, 0.48, 0.36, 0.48, 0, y, 0, true); band(body, M.gold, 0.48, 0.48, y + 0.3); fins(body, 0.6, 0.6, y - 0.04, 0.32); y += 0.36; }
        if (L3) { box(body, F, 0.36, 0.3, 0.36, 0, y, 0, true); band(body, lit, 0.36, 0.36, y + 0.24); y += 0.3; }
        if (L4) rays(body, y - 0.04, 0.22, 0.28, 12);
        const head = new THREE.Group(); head.position.y = y; body.add(head);
        cyl(head, M.brass, 0.17, 0.2, 0.07, 0, 0, 0, 18);
        torus(head, M.gold, 0.175, 0.012, 0, 0.07, 0);
        const cy = 0.16, x0 = -0.2, rl = 0.3;
        // the receiver and stock, banded in gold
        box(head, M.gunmetal, rl, 0.09, 0.09, x0 + rl / 2, cy - 0.045, 0);
        box(head, M.brass, 0.14, 0.07, 0.06, x0 - 0.05, cy - 0.06, 0);
        cyl(head, M.gunmetal, 0.02, 0.02, 0.08, 0, 0.07, 0, 8);
        const bl = A ? (L4 ? 0.78 : 0.66) : B ? 0.44 : L2 ? 0.58 : 0.5, br0 = A ? 0.032 : 0.026, bx = x0 + rl;
        rod(head, M.steel, br0, bl, bx, cy, 0, br0 * 0.8);
        hoop(head, M.gold, br0 + 0.012, 0.01, bx + 0.02, cy);
        if (A) { rod(head, M.gunmetal, br0 * 1.5, 0.08, bx + bl - 0.06, cy); hoop(head, M.gold, br0 * 1.5 + 0.008, 0.008, bx + bl - 0.05, cy); }
        if (B) {
          const drum = cyl(head, M.brass, 0.065, 0.065, 0.05, x0 + rl * 0.6, cy - 0.11, -0.025, 16); drum.rotation.x = Math.PI / 2;
          torus(head, M.gold, 0.066, 0.008, x0 + rl * 0.6, cy - 0.11, 0).rotation.set(0, 0, 0);
        }
        // the telescopic sight on short posts, its front lens glowing
        const sy = cy + 0.09;
        for (const x of [x0 + 0.08, x0 + rl - 0.04]) cyl(head, M.gold, 0.008, 0.008, 0.05, x, cy + 0.04, 0, 6);
        rod(head, M.navy, 0.026, 0.26, x0 + 0.02, sy, 0, 0.03);
        const lens = ball(head, M.lantern, 0.026, x0 + 0.29, sy, 0); lens.scale.x = 0.4;
        const tip = bx + bl;
        muzzle = { h: y + cy, r: tip, flash: false };
        light = { h: y + sy, color: P.lantern, r: 0.18 };
        barrel = { obj: head, x0: bx, x1: tip, y: cy, r: A ? 0.05 : 0.042, zs: [0] };
        tick = (t) => {
          head.rotation.y = -t.aim;
          // the barrel kicks back along the aim with each shot
          const kick = Math.max(0, t.flash || 0) / 0.12 * 0.06;
          head.position.x = -Math.cos(t.aim) * kick; head.position.z = -Math.sin(t.aim) * kick;
        };
        break;
      }
      case 'bank': {
        // a columned vault with a dome over the hub of the T, and gold doors. Path A (Bounty Hunter, Treasury) gilds
        // the dome and crowns it with a lantern; path B (Exchange) raises glowing obelisks on the wings.
        const deg = (c) => cells.filter((o) => Math.abs(o[0] - c[0]) + Math.abs(o[1] - c[1]) === 1).length;
        const hub = cells.reduce((a, c) => (deg(c) > deg(a) ? c : a), cells[0]);
        const isHub = (c) => c[0] === hub[0] && c[1] === hub[1];
        for (const [cx, cz] of cells) {
          box(body, F, 0.9, 0.42, 0.9, cx, 0, cz, true);
          box(body, M.navy, 0.94, 0.06, 0.94, cx, 0.92, cz, true);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (cells.some((o) => Math.abs(o[0] - cx - dx) < 0.01 && Math.abs(o[1] - cz - dz) < 0.01)) continue;
            for (const k of [-0.3, -0.1, 0.1, 0.3]) cyl(body, M.cream, 0.035, 0.04, 0.5, cx + dx * 0.4 + dz * k, 0.42, cz + dz * 0.4 + dx * k, 8);
            if (isHub([cx, cz])) continue;
            box(body, M.gold, 0.02 + Math.abs(dz) * 0.16, 0.26, 0.02 + Math.abs(dx) * 0.16, cx + dx * 0.455, 0.0, cz + dz * 0.455);
          }
          if (!isHub([cx, cz]) && L2) {
            box(body, M.navy, 0.6, 0.2, 0.6, cx, 0.98, cz, true); band(body, M.gold, 0.6, 0.6, 1.12, cx, cz);
            if (B) {
              const oh = L4 ? 0.75 : 0.5;
              cyl(body, M.navy, 0.03, 0.1, oh, cx, 1.18, cz, 4).rotation.y = Math.PI / 4;
              gem(body, M.cream, L4 ? 0.07 : 0.055, cx, 1.18 + oh + 0.08, cz, 1.5);
            }
          }
        }
        const drum = L2 ? 0.3 : 0.18, dy = 0.98 + drum, dr = L2 ? 0.42 : 0.36;
        cyl(body, M.navy, dr, dr + 0.02, drum, hub[0], 0.98, hub[1], 20);
        if (L2) for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; cyl(body, M.cream, 0.018, 0.018, drum - 0.04, hub[0] + Math.cos(a) * (dr + 0.02), 1.0, hub[1] + Math.sin(a) * (dr + 0.02), 6); }
        if (L3) torus(body, lit, dr + 0.03, 0.025, hub[0], dy, hub[1]);
        const dome = new THREE.Mesh(shared(`dome${dr}`, () => new THREE.SphereGeometry(dr - 0.02, 20, 10, 0, TAU, 0, Math.PI / 2)), A ? M.gold : M.cream);
        dome.position.set(hub[0], dy, hub[1]); body.add(dome);
        torus(body, M.gold, dr - 0.01, 0.025, hub[0], dy + 0.01, hub[1]);
        let cy = dy + dr + 0.08;
        if (A && L4) {
          for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; cyl(body, M.gold, 0.012, 0.012, 0.22, hub[0] + Math.cos(a) * 0.1, cy - 0.06, hub[1] + Math.sin(a) * 0.1, 4); }
          cyl(body, M.navy, 0.02, 0.14, 0.12, hub[0], cy + 0.16, hub[1], 8);
          cy += 0.28;
        }
        if (L4 && B) rays(body, dy, dr - 0.04, 0.24, 16, M.gold, hub[0], hub[1]);
        cyl(body, M.gold, 0.01, 0.03, 0.3, hub[0], cy, hub[1], 6);
        const cs = L4 ? 0.14 : L2 ? 0.11 : 0.09, coinY = cy + 0.3 + cs;
        const coin = cyl(body, M.goldGlow, cs, cs, 0.025, hub[0], coinY, hub[1], 18); coin.rotation.x = Math.PI / 2;
        tick = (t, time) => { coin.rotation.z = time * 1.5; };
        light = { h: coinY, color: P.goldHi, r: 0.45, ox: hub[0], oy: hub[1] };
        // the domed drum over the hub is the "barrel": upright, so accents ring the drum and dome
        const ax = new THREE.Group(); ax.position.set(hub[0], 0.98, hub[1]); ax.rotation.z = Math.PI / 2; body.add(ax);
        barrel = { obj: ax, x0: 0.02, x1: drum + dr * 0.5, y: 0, r: dr + 0.04, zs: [0] };
        break;
      }
    }
    if (light) light.h += 0.07;
    if (muzzle) muzzle.h += 0.07;
    if (accent && barrel) pathAccent(barrel, accent);
    g.userData = { tick, light, muzzle, key: '' };
    return g;
  }
  // The main upgrade path's role on the barrel, larger at T4: Precision crimson bands along it, Barrage an amber
  // glow at the muzzle, Engineering verdigris cog plates on its flanks. A handful of meshes on shared geometry.
  const accentMats = new Map();
  function accentMat(color) {
    const k = color;
    if (!accentMats.has(k)) {
      // unlit and not tone-mapped, like the city neon: lit materials wash out towards white and lose the role colour
      accentMats.set(k, M.reflect(new THREE.MeshBasicMaterial({ color: new THREE.Color(color), toneMapped: false })));
    }
    return accentMats.get(k);
  }
  function pathAccent({ obj, x0, x1, y, r, zs }, { arch, color, big }) {
    const mat = accentMat(color), len = x1 - x0;
    for (const z of zs) {
      if (arch === 'precision') {
        for (const f of big ? [0.25, 0.5, 0.75] : [0.35, 0.65]) hoop(obj, mat, r + 0.01, big ? 0.03 : 0.022, x0 + len * f, y, z);
      } else if (arch === 'barrage') {
        hoop(obj, mat, r * 0.85 + 0.01, big ? 0.04 : 0.026, x1 - 0.02, y, z);
        if (big) hoop(obj, mat, r * 0.85 + 0.03, 0.022, x1 - 0.12, y, z);
      }
    }
    if (arch === 'engineering') {
      const zm = Math.max(...zs.map(Math.abs)) + r + 0.03, cr = big ? 0.12 : 0.085;
      for (const s of [-1, 1]) gear(obj, mat, cr, 0.03, 8, x0 + Math.min(0.2, len * 0.25), y, s * zm).rotation.x = Math.PI / 2;
    }
  }
  // a tower drawn as a translucent blueprint, for the placement preview
  function ghostify(g, ok) {
    g.traverse((o) => { if (o.isMesh) o.material = ok ? M.ghost : M.ghostBad; });
    return g;
  }

  // ---------- robots ----------
  // A two-legged walker. s = body radius in tiles. Legs swing with distance walked, so slowed robots trudge
  // and frozen ones stop mid-stride.
  function biped(g, mat, s, o = {}) {
    const legH = s * (o.leg || 1.1), torsoH = s * (o.torso || 1.15), w = s * (o.w || 1), legs = [], arms = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(0, legH, side * w * 0.42); g.add(hip);
      box(hip, M.gunmetal, s * 0.3, legH * 0.94, s * 0.3, 0, -legH, 0);
      box(hip, mat, s * 0.5, s * 0.14, s * 0.36, s * 0.08, -legH, 0);
      legs.push(hip);
    }
    const up = new THREE.Group(); up.position.y = legH; g.add(up);
    if (o.lean) up.rotation.z = o.lean;
    const torso = o.hex ? cyl(up, mat, w * 0.62, w * 0.62, torsoH, 0, 0, 0, 6) : o.round ? ball(up, mat, w * 0.72, 0, torsoH * 0.55, 0) : box(up, mat, s * 0.74, torsoH, w * 1.16);
    box(up, M.gunmetal, s * 0.46, s * 0.4, s * 0.52, s * 0.04, torsoH, 0);
    box(up, M.ember, s * 0.06, s * 0.1, s * 0.4, s * 0.28, torsoH + s * 0.16, 0);
    if (o.arms) for (const side of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(0, torsoH * 0.92, side * w * 0.76); up.add(sh);
      box(sh, M.steel, s * 0.46, s * 0.3, s * 0.4, 0, -s * 0.1, 0);
      box(sh, M.gunmetal, s * 0.26, torsoH * 0.9, s * 0.26, 0, -torsoH * 0.95, 0);
      arms.push(sh);
    }
    const k = Math.PI / (legH * 1.7);
    return { up, torso, torsoH, legH, h: legH + torsoH + s * 0.4, walk: (d) => {
      const a = Math.sin(d * k) * 0.62;
      legs[0].rotation.z = a; legs[1].rotation.z = -a;
      if (arms.length) { arms[0].rotation.z = -a * 0.7; arms[1].rotation.z = a * 0.7; }
      up.position.y = legH + Math.abs(Math.cos(d * k)) * s * 0.07;
    } };
  }

  // Returns a group; userData.tick(e, time, dTiles) animates it, userData.h is its height in tiles.
  function enemy(type, def) {
    const g = new THREE.Group(), mat = bodyMat(def.color), s = (def.size / 32) * 1.55;
    let tick = () => {}, h = s * 2;
    switch (type) {
      case 'swarm': {
        // a rolling scout drone
        const roll = new THREE.Group(); roll.position.y = s; g.add(roll);
        ball(roll, mat, s); torus(roll, M.gunmetal, s * 1.02, s * 0.14).rotation.x = 0;
        box(g, M.ember, s * 0.2, s * 0.3, s * 0.7, s * 0.85, s * 0.9, 0);
        tick = (e, time, d) => { roll.rotation.z = -d / s; };
        break;
      }
      case 'flyer': {
        // an ornithopter
        const f = new THREE.Group(); f.position.y = 1.35; g.add(f);
        rod(f, mat, s * 0.34, s * 2.2, -s * 1.1, 0, 0, 0.02);
        box(f, M.ember, s * 0.12, s * 0.14, s * 0.3, s * 0.7, s * 0.06, 0);
        const wings = [-1, 1].map((side) => {
          const p = new THREE.Group(); f.add(p);
          for (let k = 0; k < 3; k++) { const b = box(p, k === 1 ? M.cream : M.gold, s * 0.5, s * 0.04, s * 1.9, (k - 1) * s * 0.55, 0, side * s * 1.05); b.rotation.y = side * (k - 1) * 0.3; }
          return p;
        });
        tick = (e, time) => { const a = Math.sin(time * 14 + e.id) * 0.5; wings[0].rotation.x = a; wings[1].rotation.x = -a; f.position.y = 1.35 + Math.sin(time * 5 + e.id) * 0.06; };
        h = 1.6;
        break;
      }
      case 'ghost': {
        // a shade: a hollow drifting cowl
        const f = new THREE.Group(); g.add(f);
        const c = new THREE.Mesh(shared(`cone${s}`, () => new THREE.ConeGeometry(s * 0.9, s * 3, 12, 1, true)), M.shadeHi);
        c.position.y = s * 1.7; f.add(c);
        for (const z of [-1, 1]) ball(f, M.cream, s * 0.12, s * 0.42, s * 2.1, z * s * 0.24);
        tick = (e, time) => { f.position.y = Math.sin(time * 4 + e.id) * 0.05; };
        h = s * 3.3;
        break;
      }
      case 'boss': {
        // the siege golem: a towering walker with a furnace heart and a turning gear on its back
        const b = biped(g, mat, s, { w: 1.25, arms: true, leg: 1.25, torso: 1.3 });
        const gear = cyl(b.up, M.gold, s * 0.95, s * 0.95, s * 0.14, 0, 0, 0, 10);
        gear.rotation.z = Math.PI / 2; gear.position.set(-s * 0.5, b.torsoH * 0.55, 0);
        ball(b.up, M.ember, s * 0.3, s * 0.34, b.torsoH * 0.5, 0);
        for (const z of [-1, 1]) box(b.up, M.gold, s * 0.2, b.torsoH * 0.5, s * 0.08, s * 0.38, b.torsoH * 0.3, z * s * 0.5);
        tick = (e, time, d) => { b.walk(d); gear.rotation.x = time * 1.2; };
        h = b.h;
        break;
      }
      case 'splitter': case 'mite': {
        // a rolling gear; the splitter's seam glows where it will crack in two
        const roll = new THREE.Group(); roll.position.y = s; g.add(roll);
        const w = cyl(roll, mat, s, s, s * 0.7, 0, -s * 0.35, 0, 10); w.rotation.x = Math.PI / 2; w.position.set(0, 0, 0);
        for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; const tooth = box(roll, M.gunmetal, s * 0.26, s * 0.26, s * 0.6, Math.cos(a) * s, 0, 0); tooth.position.set(Math.cos(a) * s, Math.sin(a) * s, 0); tooth.rotation.z = a; }
        ball(roll, M.gold, s * 0.3, 0, 0, s * 0.36);
        if (type === 'splitter') box(roll, M.ember, s * 2.05, s * 0.08, s * 0.72, 0, -s * 0.04, 0);
        box(g, M.ember, s * 0.2, s * 0.24, s * 0.5, s * 0.95, s * 1.1, 0);
        tick = (e, time, d) => { roll.rotation.z = -d / s; };
        h = s * 2.1;
        break;
      }
      case 'spotter': {
        // a brass dragonfly that skims low over the boulevard, lens glowing
        const f = new THREE.Group(); f.position.y = 0.85; g.add(f);
        rod(f, mat, s * 0.2, s * 2.6, -s * 1.6, 0, 0, s * 0.08);
        ball(f, mat, s * 0.32, s * 0.95, 0, 0);
        ball(f, M.lantern, s * 0.18, s * 1.22, 0, 0);
        const wings = [];
        for (const x of [s * 0.45, -s * 0.05]) for (const side of [-1, 1]) {
          const p = new THREE.Group(); p.position.set(x, s * 0.12, 0); f.add(p);
          box(p, M.cream, s * 0.36, s * 0.03, s * 1.5, 0, 0, side * s * 0.8);
          wings.push([p, side]);
        }
        tick = (e, time) => { const a = Math.sin(time * 30 + e.id) * 0.4; for (const [p, side] of wings) p.rotation.x = side * a; f.position.y = 0.85 + Math.sin(time * 4 + e.id) * 0.05; };
        h = 1.1;
        break;
      }
      case 'bomber': {
        // a cream-and-brass blimp with a gondola of bomb racks
        const f = new THREE.Group(); f.position.y = 2.1; g.add(f);
        const env = ball(f, M.cream, s, 0, 0, 0); env.scale.set(1.9, 0.85, 0.85);
        for (const k of [-0.6, 0, 0.6]) torus(f, M.gold, s * 0.86 * Math.cos(k * 0.9), s * 0.03, k * s, 0, 0).rotation.set(0, Math.PI / 2, 0);
        for (const [ny, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const fin = box(f, M.gold, s * 0.5, ny ? s * 0.45 : s * 0.04, nz ? s * 0.45 : s * 0.04, 0, 0, 0);
          fin.position.set(-s * 1.6, ny * s * 0.5, nz * s * 0.5);
        }
        box(f, M.gunmetal, s * 1.1, s * 0.3, s * 0.4, 0, -s * 1.15, 0, true);
        for (const x of [-0.3, 0, 0.3]) ball(f, M.ember, s * 0.08, x * s, -s * 1.2, 0);
        const prop = new THREE.Group(); prop.position.set(-s * 1.95, 0, 0); f.add(prop);
        for (let k = 0; k < 3; k++) { const b = box(prop, M.brass, s * 0.03, s * 0.55, s * 0.08, 0, 0, 0); b.rotation.x = (k * TAU) / 3; }
        tick = (e, time) => { prop.rotation.x = time * 14; f.position.y = 2.1 + Math.sin(time * 1.5 + e.id) * 0.06; f.rotation.x = Math.sin(time * 0.9 + e.id) * 0.04; };
        h = 2.6;
        break;
      }
      case 'moth': {
        // a luna moth: two pairs of pale wings rimmed in pink neon, eyespots, trailing tails and a lit abdomen
        const k = s * 1.4, f = new THREE.Group(); f.position.y = 1.3; g.add(f);
        ball(f, mat, k * 0.26, k * 0.2, 0, 0).scale.set(1.3, 1, 1);
        for (let i = 0; i < 3; i++) ball(f, i === 1 ? M.neonPink : mat, k * (0.2 - i * 0.04), -k * (0.18 + i * 0.26), -k * 0.03 * i, 0).scale.set(1.4, 1, 1);
        ball(f, mat, k * 0.17, k * 0.55, k * 0.03, 0);
        for (const z of [-1, 1]) {
          ball(f, M.neonPink, k * 0.06, k * 0.66, k * 0.08, z * k * 0.09);
          const a = new THREE.Group(); a.position.set(k * 0.62, k * 0.14, z * k * 0.06); a.rotation.set(0, -z * 0.5, 0.8); f.add(a);
          rod(a, M.gold, k * 0.015, k * 0.7, 0, 0);
          for (let j = 1; j < 5; j++) box(a, M.gold, k * 0.02, k * 0.02, k * 0.18, j * k * 0.13, 0, 0);
        }
        const wings = [];
        for (const side of [-1, 1]) {
          const p = new THREE.Group(); p.position.set(k * 0.15, k * 0.08, side * k * 0.12); f.add(p);
          const fw = new THREE.Group(); fw.rotation.y = -side * 0.3; p.add(fw);
          box(fw, M.shadeHi, k * 0.9, k * 0.02, k * 1.5, 0, 0, side * k * 0.75);
          box(fw, M.neonPink, k * 0.05, k * 0.035, k * 1.5, k * 0.45, 0, side * k * 0.75);
          box(fw, M.neonPink, k * 0.9, k * 0.035, k * 0.05, 0, 0, side * k * 1.5);
          ball(fw, M.neonPink, k * 0.14, 0, k * 0.03, side * k * 1.0).scale.y = 0.25;
          torus(fw, M.lilac, k * 0.22, k * 0.025, 0, k * 0.03, side * k * 1.0);
          const hw = new THREE.Group(); hw.position.x = -k * 0.35; hw.rotation.y = -side * 0.8; p.add(hw);
          box(hw, M.shadeHi, k * 0.7, k * 0.02, k * 1.0, 0, -k * 0.02, side * k * 0.5);
          box(hw, M.lilac, k * 0.05, k * 0.035, k * 1.0, k * 0.35, -k * 0.02, side * k * 0.5);
          box(hw, M.neonPink, k * 0.9, k * 0.035, k * 0.08, -k * 0.6, -k * 0.02, side * k * 0.95);   // the trailing tail
          wings.push([p, side]);
        }
        tick = (e, time) => { const a = Math.sin(time * 6 + e.id) * 0.55 - 0.35; for (const [p, side] of wings) p.rotation.x = side * a; f.position.y = 1.3 + Math.sin(time * 2.4 + e.id) * 0.1; f.rotation.x = Math.sin(time * 1.3 + e.id) * 0.12; };
        h = 1.7;
        break;
      }
      case 'balloon': {
        // a striped hot-air balloon: coral and cream gores, a gold crown, a roaring burner and a basket of troops
        const f = new THREE.Group(); f.position.y = 1.7; g.add(f);
        const R = s * 1.1, cy = s * 1.6, cloth = matteMat('#a8402a');
        for (let i = 0; i < 8; i++) {
          const gore = new THREE.Mesh(shared(`gore${R}:${i}`, () => new THREE.SphereGeometry(R, 3, 14, (i * TAU) / 8, TAU / 8)), i % 2 ? M.cream : cloth);
          gore.position.y = cy; gore.scale.set(1, 1.18, 1); f.add(gore);
        }
        torus(f, M.gold, R * 1.01, s * 0.04, 0, cy, 0);
        torus(f, M.gold, R * 0.72, s * 0.03, 0, cy + R * 0.82, 0);
        cyl(f, M.gold, s * 0.2, s * 0.32, s * 0.12, 0, cy + R * 1.14, 0, 12);
        cyl(f, M.brass, s * 0.02, s * 0.02, s * 0.6, 0, cy + R * 1.2, 0, 6);
        box(f, M.neonCoral, s * 0.4, s * 0.22, s * 0.02, s * 0.2, cy + R * 1.2 + s * 0.36, 0);
        cyl(f, cloth, R * 0.5, R * 0.28, s * 0.35, 0, s * 0.05, 0, 12);
        const flame = cyl(f, M.ember, 0.001, s * 0.15, s * 0.45, 0, -s * 0.2, 0, 8);
        ball(f, M.lantern, s * 0.1, 0, -s * 0.2, 0);
        for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) cyl(f, M.brass, s * 0.015, s * 0.015, s * 0.5, x * s * 0.38, -s * 0.45, z * s * 0.38, 4);
        box(f, M.brass, s * 0.9, s * 0.45, s * 0.9, 0, -s * 0.9, 0, true);
        box(f, M.gold, s * 0.96, s * 0.06, s * 0.96, 0, -s * 0.48, 0);
        for (const z of [-1, 1]) ball(f, M.cream, s * 0.1, 0, -s * 0.75, z * s * 0.52);
        const cargo = new THREE.Group(); f.add(cargo);
        for (const [x, z] of [[0.2, -0.22], [-0.2, 0], [0.2, 0.22]]) { box(cargo, M.gunmetal, s * 0.24, s * 0.26, s * 0.24, x * s, -s * 0.5, z * s); box(cargo, M.neonCoral, s * 0.02, s * 0.05, s * 0.18, x * s + s * 0.12, -s * 0.4, z * s); }
        tick = (e, time) => {
          cargo.visible = !e.dropped;
          flame.scale.set(1, 0.8 + Math.abs(Math.sin(time * 17 + e.id)) * 0.6, 1);
          f.position.y = 1.7 + Math.sin(time * 1.2 + e.id) * 0.08; f.rotation.z = Math.sin(time * 0.8 + e.id) * 0.05; f.rotation.y = time * 0.15;
        };
        h = 1.7 + cy + R * 1.3;
        break;
      }
      case 'hawk': {
        // a stormhawk: a steel raptor with feathered blade wings, teal edges and twin burners that flare in a sprint
        const k = s * 1.3, f = new THREE.Group(); f.position.y = 1.4; g.add(f);
        rod(f, mat, k * 0.13, k * 1.6, -k * 0.8, 0, 0, k * 0.22);
        ball(f, mat, k * 0.22, k * 0.88, k * 0.04, 0);
        rod(f, M.gold, k * 0.09, k * 0.4, k * 1.05, -k * 0.02, 0, 0.001);
        for (const z of [-1, 1]) box(f, M.neonTeal, k * 0.12, k * 0.05, k * 0.05, k * 0.98, k * 0.1, z * k * 0.13);
        const wings = [];
        for (const side of [-1, 1]) {
          const p = new THREE.Group(); p.position.set(k * 0.15, k * 0.06, side * k * 0.12); f.add(p);
          for (let i = 0; i < 5; i++) {
            const fb = new THREE.Group(); fb.position.x = -i * k * 0.16; fb.rotation.y = -side * (0.2 + i * 0.13); p.add(fb);
            box(fb, i % 2 ? M.steel : mat, k * 0.3, k * 0.03, k * (1.6 - i * 0.22), 0, -i * k * 0.005, side * k * (0.8 - i * 0.11));
            if (i === 0) box(fb, M.neonTeal, k * 0.04, k * 0.04, k * 1.6, k * 0.15, 0, side * k * 0.8);
          }
          wings.push([p, side]);
        }
        const plumes = [];
        for (const z of [-1, 1]) {
          rod(f, M.gunmetal, k * 0.09, k * 0.7, -k * 0.5, -k * 0.12, z * k * 0.42);
          ball(f, M.ice, k * 0.07, -k * 0.52, -k * 0.12, z * k * 0.42);
          ringX(f, M.neonTeal, k * 0.1, k * 0.02, -k * 0.5, -k * 0.12, z * k * 0.42);
          const pl = new THREE.Group(); pl.position.set(-k * 0.52, -k * 0.12, z * k * 0.42); f.add(pl);
          rod(pl, M.neonCoral, 0.001, k * 1.1, -k * 1.1, 0, 0, k * 0.15);
          rod(pl, M.lantern, 0.001, k * 0.7, -k * 0.7, 0, 0, k * 0.09);
          ball(pl, M.lantern, k * 0.12, 0, 0, 0);
          plumes.push(pl);
        }
        const tail = new THREE.Group(); tail.position.x = -k * 0.75; f.add(tail);
        for (let j = -1; j <= 1; j++) { const b = new THREE.Group(); b.rotation.y = j * 0.4; tail.add(b); box(b, j ? M.steel : mat, k * 0.7, k * 0.03, k * 0.16, -k * 0.35, 0, 0); }
        tick = (e, time) => {
          const go = e.surgeLeft > 0;
          for (const [p, side] of wings) { p.rotation.x = side * Math.sin(time * 5 + e.id) * (go ? 0.04 : 0.18); p.rotation.y = go ? side * 0.45 : 0; }
          for (const pl of plumes) { pl.visible = go; pl.scale.x = 0.8 + Math.random() * 0.5; }
          f.rotation.x = Math.sin(time * 1.6 + e.id) * 0.15; f.rotation.z = go ? -0.12 : 0;
          f.position.y = 1.4 + Math.sin(time * 3 + e.id) * 0.05;
        };
        h = 1.6;
        break;
      }
      case 'mender': {
        // a field medic: a capsule body with a glowing cross, a tank of teal fluid, a halo and a heal pulse at its feet
        const S = s * 1.2, b = biped(g, mat, S, { round: true, w: 0.95, leg: 1.05, arms: true });
        const tH = b.torsoH, fx = S * 0.66;
        box(b.up, M.cream, S * 0.06, S * 0.62, S * 0.62, fx - S * 0.04, tH * 0.55 - S * 0.31, 0);
        box(b.up, M.neonTeal, S * 0.06, S * 0.48, S * 0.15, fx, tH * 0.55 - S * 0.24, 0);
        box(b.up, M.neonTeal, S * 0.06, S * 0.15, S * 0.48, fx, tH * 0.55 - S * 0.075, 0);
        box(b.up, M.neonTeal, S * 0.05, S * 0.08, S * 0.38, S * 0.27, tH + S * 0.15, 0);
        for (const z of [-1, 1]) {
          box(b.up, M.neonTeal, S * 0.15, S * 0.42, S * 0.06, 0, tH * 0.55 - S * 0.21, z * S * 0.66);
          box(b.up, M.neonTeal, S * 0.42, S * 0.15, S * 0.06, 0, tH * 0.55 - S * 0.075, z * S * 0.66);
        }
        const tx = -S * 0.62;
        cyl(b.up, M.brass, S * 0.26, S * 0.26, S * 0.06, tx, tH * 0.2, 0, 14);
        cyl(b.up, M.brass, S * 0.26, S * 0.26, S * 0.06, tx, tH * 0.2 + S * 0.72, 0, 14);
        for (let i = 0; i < 3; i++) { const a = (i * TAU) / 3; cyl(b.up, M.gunmetal, S * 0.025, S * 0.025, S * 0.7, tx + Math.cos(a) * S * 0.25, tH * 0.2, Math.sin(a) * S * 0.25, 4); }
        const fluid = cyl(b.up, M.neonTeal, S * 0.18, S * 0.18, S * 0.62, tx, tH * 0.2 + S * 0.06, 0, 12);
        const halo = torus(b.up, M.neonTeal, S * 0.34, S * 0.035, S * 0.02, tH + S * 0.75, 0);
        const pulse = torus(g, M.neonTeal, S * 1.2, S * 0.025, 0, 0.04, 0);
        tick = (e, time, d) => {
          b.walk(d);
          const c = (time * 0.8 + e.id * 0.37) % 1;
          pulse.scale.setScalar(0.3 + c * 1.4); pulse.visible = c < 0.85;
          fluid.scale.y = 0.75 + Math.sin(time * 4 + e.id) * 0.2;
          halo.position.y = tH + S * 0.75 + Math.sin(time * 3 + e.id) * S * 0.06; halo.rotation.z = Math.sin(time * 2) * 0.2;
        };
        h = b.h + S * 0.9;
        break;
      }
      case 'ironclad': {
        // a dreadnought on legs: riveted hull, layered front plates, a prow ram, a conning tower and two smokestacks
        const b = biped(g, mat, s, { w: 1.45, arms: true, leg: 0.85, torso: 1.25 });
        const tH = b.torsoH;
        box(b.up, M.gunmetal, s * 1.1, tH * 0.9, s * 1.9, 0, tH * 0.05, 0, true);
        for (let i = 0; i < 3; i++) box(b.up, i % 2 ? mat : M.steel, s * 0.16, tH * 0.3, s * (1.85 - i * 0.3), s * (0.6 + i * 0.05), tH * (0.08 + i * 0.27), 0, true);
        const ram = box(b.up, M.steel, s * 0.55, s * 0.12, s * 1.3, s * 0.85, tH * 0.02, 0); ram.rotation.z = -0.35;
        for (const z of [-1, 1]) {
          for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) ball(b.up, M.gold, s * 0.045, s * (-0.38 + c * 0.25), tH * (0.3 + r * 0.35), z * s * 0.96);
          box(b.up, M.steel, s * 0.85, s * 0.18, s * 0.55, 0, tH * 0.95, z * s * 0.92, true);
          box(b.up, mat, s * 0.6, s * 0.14, s * 0.4, 0, tH * 0.95 + s * 0.18, z * s * 0.95);
        }
        const hex = cyl(b.up, M.gold, s * 0.22, s * 0.22, s * 0.05, 0, 0, 0, 6); hex.rotation.z = Math.PI / 2; hex.position.set(s * 0.75, tH * 0.55, 0);
        box(b.up, mat, s * 0.6, s * 0.45, s * 0.7, -s * 0.05, tH * 0.95, 0, true);
        box(b.up, M.neonCoral, s * 0.04, s * 0.07, s * 0.5, s * 0.26, tH * 0.95 + s * 0.24, 0);
        const tops = [];
        for (const z of [-0.38, 0.38]) {
          cyl(b.up, M.gunmetal, s * 0.12, s * 0.15, s * 0.8, -s * 0.45, tH * 0.95, z * s, 10);
          torus(b.up, M.gold, s * 0.135, s * 0.025, -s * 0.45, tH * 0.95 + s * 0.55, z * s);
          tops.push(cyl(b.up, M.ember, s * 0.11, s * 0.11, s * 0.04, -s * 0.45, tH * 0.95 + s * 0.8, z * s, 10));
        }
        tick = (e, time, d) => { b.walk(d); tops.forEach((t, i) => { t.material = Math.sin(time * 5 + i * 2 + e.id) > 0.2 ? M.ember : M.lantern; }); };
        h = b.h + s * 0.9;
        break;
      }
      case 'phoenix': {
        // a phoenix frame: a lean bird walker with fanned fire wings, a crest and a burning core; brighter once reborn
        const S = s * 1.1, b = biped(g, mat, S, { leg: 1.3, torso: 0.9, w: 0.8, lean: -0.15 });
        const tH = b.torsoH;
        const core = gem(b.up, M.neonCoral, S * 0.18, S * 0.4, tH * 0.5, 0);
        rod(b.up, M.gold, S * 0.08, S * 0.35, S * 0.25, tH + S * 0.2, 0, 0.001);
        const crest = new THREE.Group(); crest.position.set(0, tH + S * 0.35, 0); b.up.add(crest);
        for (let j = 0; j < 3; j++) { const c = new THREE.Group(); c.rotation.z = 0.5 + j * 0.3; crest.add(c); box(c, j === 1 ? M.lantern : M.ember, S * 0.06, S * (0.55 - j * 0.1), S * 0.06, 0, 0, 0); }
        const wings = [], ember = [M.lantern, M.goldGlow, M.ember, M.ember, M.neonCoral];
        for (const side of [-1, 1]) {
          const w = new THREE.Group(); w.position.set(-S * 0.15, tH * 0.85, side * S * 0.42); w.rotation.z = 0.35; b.up.add(w);
          for (let i = 0; i < 5; i++) {
            const p = new THREE.Group(); p.rotation.x = side * (0.25 + i * 0.32); w.add(p);
            box(p, ember[i], S * 0.14, S * (1.25 - i * 0.1), S * 0.05, -i * S * 0.05, 0, 0);
          }
          wings.push([w, side]);
        }
        for (let j = -1; j <= 1; j++) { const t = box(b.up, j ? M.ember : M.neonCoral, S * 0.9, S * 0.04, S * 0.1, -S * 0.9, S * 0.05, j * S * 0.14); t.rotation.y = j * 0.25; t.rotation.z = 0.25; }
        tick = (e, time, d) => {
          b.walk(d);
          const flare = e.reborn ? 1.25 : 1;
          for (const [w, side] of wings) { w.rotation.x = side * Math.sin(time * 4 + e.id) * 0.18; w.scale.setScalar(flare); }
          core.material = e.reborn ? M.lantern : M.neonCoral;
          core.rotation.y = time * 2;
        };
        h = b.h + S * 0.9;
        break;
      }
      case 'salvager': {
        // a scrap salvager: a stocky walker with a hopper of junk on its back, a crane arm and a welding torch
        const b = biped(g, mat, s, { w: 1.25, arms: true, leg: 0.9, torso: 1.1 });
        const tH = b.torsoH;
        box(b.up, M.gunmetal, s * 0.8, s * 0.7, s * 1.2, -s * 0.7, tH * 0.35, 0, true);
        for (const [x, z, k] of [[-0.8, -0.3, 0.3], [-0.6, 0.25, 0.26], [-0.75, 0.05, 0.22]]) { const j = box(b.up, k > 0.25 ? M.steel : M.brass, s * k, s * k, s * k, x * s, tH * 0.35 + s * 0.68, z * s); j.rotation.set(k * 3, k * 5, k * 2); }
        const arm = new THREE.Group(); arm.position.set(s * 0.1, tH * 1.0, s * 0.35); b.up.add(arm);
        rod(arm, M.gold, s * 0.07, s * 1.1, 0, 0, 0);
        const claw = new THREE.Group(); claw.position.set(s * 1.1, 0, 0); arm.add(claw);
        for (const z of [-1, 1]) { const c = box(claw, M.steel, s * 0.08, s * 0.4, s * 0.06, 0, -s * 0.4, z * s * 0.1); c.rotation.x = z * 0.35; }
        const torch = ball(b.up, M.lantern, s * 0.09, s * 0.75, tH * 0.4, -s * 0.5);
        box(b.up, M.neonCoral, s * 0.05, s * 0.07, s * 0.6, s * 0.4, tH + s * 0.22, 0);
        tick = (e, time, d) => {
          b.walk(d);
          arm.rotation.z = -0.5 + Math.sin(time * 1.6 + e.id) * 0.25;
          torch.visible = Math.sin(time * 23 + e.id) > -0.3;
        };
        h = b.h + s * 0.6;
        break;
      }
      case 'caster': case 'hologram': {
        // a mirage caster: a slim walker carrying a lens dish on a mast, throwing a teal fan of light around it
        const b = biped(g, mat, s, { round: true, w: 0.85, leg: 1.25, torso: 0.9 });
        const tH = b.torsoH;
        cyl(b.up, M.steel, s * 0.04, s * 0.04, s * 0.8, 0, tH, 0, 6);
        const head = new THREE.Group(); head.position.y = tH + s * 0.85; b.up.add(head);
        const dish = cyl(head, M.gold, s * 0.55, s * 0.2, s * 0.14, 0, 0, 0, 16); dish.rotation.z = -0.5;
        const lens = ball(head, M.neonTeal, s * 0.16, s * 0.12, s * 0.14, 0);
        const halo = torus(head, M.neonTeal, s * 0.7, s * 0.02, 0, s * 0.1, 0);
        for (const z of [-1, 1]) box(b.up, M.neonTeal, s * 0.06, s * 0.3, s * 0.06, s * 0.5, tH * 0.4, z * s * 0.4);
        tick = (e, time, d) => {
          b.walk(d);
          head.rotation.y = time * 1.8 + e.id;
          halo.scale.setScalar(1 + ((time * 1.5 + e.id * 0.3) % 1) * 0.6);
          lens.material = e.mirageT !== undefined && e.def.mirage && e.mirageT < 0.8 && Math.floor(time * 12) % 2 ? M.lantern : M.neonTeal;
        };
        h = b.h + s * 1.1;
        break;
      }
      case 'skyhook': {
        // a skyhook: a tandem-rotor lifter with a long brass hull, a winch and a claw on a cable
        const f = new THREE.Group(); f.position.y = 2.3; g.add(f);
        rod(f, mat, s * 0.3, s * 2.6, -s * 1.3, 0, 0, s * 0.22);
        box(f, M.gunmetal, s * 1.6, s * 0.25, s * 0.5, -s * 0.8, -s * 0.38, 0, true);
        for (const x of [-0.9, 0, 0.9]) ball(f, M.lantern, s * 0.06, x * s, s * 0.05, s * 0.3);
        box(f, M.neonCoral, s * 0.04, s * 0.06, s * 0.5, s * 1.25, s * 0.05, 0);
        const rotors = [];
        for (const x of [-1.15, 1.15]) {
          cyl(f, M.steel, s * 0.06, s * 0.06, s * 0.45, x * s, s * 0.15, 0, 6);
          const r = new THREE.Group(); r.position.set(x * s, s * 0.62, 0); f.add(r);
          for (let k = 0; k < 3; k++) { const bl = box(r, M.brass, s * 1.5, s * 0.03, s * 0.12, 0, 0, 0); bl.rotation.y = (k * TAU) / 3; bl.position.set(0, 0, 0); }
          rotors.push(r);
        }
        cyl(f, M.gold, s * 0.16, s * 0.16, s * 0.2, 0, -s * 0.5, 0, 10);
        const cable = cyl(f, M.steel, s * 0.02, s * 0.02, s * 0.9, 0, -s * 1.4, 0, 4);
        const claw = new THREE.Group(); claw.position.y = -s * 1.45; f.add(claw);
        for (let k = 0; k < 3; k++) { const c = new THREE.Group(); c.rotation.y = (k * TAU) / 3; claw.add(c); const p = box(c, M.gold, s * 0.06, s * 0.35, s * 0.06, s * 0.12, -s * 0.3, 0); p.rotation.z = 0.4; }
        tick = (e, time) => {
          rotors[0].rotation.y = time * 16; rotors[1].rotation.y = -time * 16;
          const busy = !!e.cargo;
          cable.visible = claw.visible = !busy;
          f.position.y = 2.3 + Math.sin(time * 1.4 + e.id) * 0.06; f.rotation.z = busy ? 0.06 : 0;
        };
        h = 2.6;
        break;
      }
      case 'citadel': {
        // the sky citadel: a flying Deco ziggurat with lit windows, a blinking beacon, a stepped keel and four ringed rotors
        const f = new THREE.Group(); f.position.y = 2.6; g.add(f);
        box(f, M.gunmetal, s * 2.4, s * 0.3, s * 1.4, 0, -s * 0.3, 0, true);
        box(f, M.gunmetal, s * 1.7, s * 0.3, s * 1.0, 0, -s * 0.6, 0, true);
        box(f, M.gunmetal, s * 0.9, s * 0.3, s * 0.6, 0, -s * 0.9, 0, true);
        const bays = [-0.5, 0, 0.5].map((x) => ball(f, M.ember, s * 0.09, x * s, -s * 0.92, 0));
        box(f, mat, s * 2.8, s * 0.15, s * 1.6, 0, -s * 0.05, 0, true);
        box(f, M.goldRim, s * 2.84, s * 0.04, s * 1.64, 0, s * 0.08, 0);
        for (let k = -2; k <= 2; k++) for (const z of [-1, 1]) box(f, mat, s * 0.26, s * 0.2, s * 0.16, k * s * 0.55, s * 0.1, z * s * 0.72);
        const prow = box(f, M.gold, s * 0.6, s * 0.12, s * 0.7, s * 1.5, -s * 0.15, 0); prow.rotation.z = -0.3;
        const tiers = [[1.4, 0.6, 1.0, M.facadeB], [0.95, 0.55, 0.7, M.facade], [0.55, 0.5, 0.42, M.facadeB]];
        let y = s * 0.1;
        for (const [w, hh, dd, wall] of tiers) {
          box(f, wall, w * s, hh * s, dd * s, -s * 0.25, y, 0, true);
          box(f, M.neonPink, w * s + s * 0.03, s * 0.04, dd * s + s * 0.03, -s * 0.25, y + hh * s - s * 0.1, 0);
          y += hh * s;
        }
        cyl(f, M.brass, 0.001, s * 0.12, s * 0.75, -s * 0.25, y, 0, 8);
        const beacon = ball(f, M.neonCoral, s * 0.11, -s * 0.25, y + s * 0.82, 0);
        torus(f, M.neonTeal, s * 0.22, s * 0.015, -s * 0.25, y + s * 0.82, 0);
        for (const z of [-1, 1]) { cyl(f, M.brass, s * 0.015, s * 0.015, s * 0.6, -s * 1.3, s * 0.1, z * s * 0.7, 4); box(f, M.neonCoral, s * 0.3, s * 0.18, s * 0.02, -s * 1.45, s * 0.48, z * s * 0.7); }
        const rotors = [];
        for (const [x, z] of [[1.25, 1.05], [1.25, -1.05], [-1.25, 1.05], [-1.25, -1.05]]) {
          box(f, M.gunmetal, s * 0.1, s * 0.08, s * 0.4, x * s, -s * 0.04, z * s * 0.84);   // the strut out to the rotor
          const pod = new THREE.Group(); pod.position.set(x * s, 0, z * s); f.add(pod);
          cyl(pod, M.gunmetal, s * 0.1, s * 0.12, s * 0.35, 0, -s * 0.15, 0, 10);
          torus(pod, M.neonTeal, s * 0.55, s * 0.025, 0, s * 0.22, 0);
          const r = new THREE.Group(); r.position.y = s * 0.22; pod.add(r);
          for (let k = 0; k < 3; k++) box(r, M.brass, s * 1.0, s * 0.025, s * 0.1, 0, 0, 0).rotation.y = (k * Math.PI) / 3;
          rotors.push(r);
        }
        tick = (e, time) => {
          rotors.forEach((r, i) => { r.rotation.y = time * (14 + i) * (i % 2 ? -1 : 1); });
          beacon.material = Math.floor(time * 2 + e.id) % 2 ? M.neonCoral : M.ember;
          bays.forEach((bb, i) => { bb.material = Math.sin(time * 6 + i) > 0 ? M.ember : M.lantern; });
          f.position.y = 2.6 + Math.sin(time * 1.1 + e.id) * 0.06; f.rotation.x = Math.sin(time * 0.7 + e.id) * 0.03;
        };
        h = 2.6 + s * 2.6;
        break;
      }
      case 'colossus': {
        // the foundry colossus: a furnace on legs with smokestacks, a glowing grate and a crane arm
        const b = biped(g, mat, s, { w: 1.4, arms: true, leg: 1.1, torso: 1.4 });
        box(b.up, M.gunmetal, s * 0.9, b.torsoH * 0.6, s * 1.4, 0, b.torsoH * 0.2, 0);
        const grate = box(b.up, M.ember, s * 0.05, b.torsoH * 0.4, s * 0.9, s * 0.46, b.torsoH * 0.3, 0);
        for (const z of [-0.45, 0, 0.45]) cyl(b.up, M.gunmetal, s * 0.14, s * 0.18, s * 1.3, -s * 0.3, b.torsoH, z * s, 10);
        for (const z of [-0.45, 0, 0.45]) torus(b.up, M.gold, s * 0.15, s * 0.03, -s * 0.3, b.torsoH + s * 1.3, z * s);
        tick = (e, time, d) => { b.walk(d); grate.material = Math.sin(time * 6) > 0 ? M.ember : M.lantern; };
        h = b.h + s * 1.2;
        break;
      }
      case 'dynamo': {
        // the power colossus: a walking generator, a copper-wound drum for a chest, Tesla coils on its shoulders
        // and a turbine on its back that spins up as it surges
        const b = biped(g, mat, s, { w: 1.5, arms: true, leg: 1.15, torso: 1.45 });
        const drum = cyl(b.up, M.gunmetal, s * 0.72, s * 0.72, s * 1.3, 0, 0, 0, 16);
        drum.rotation.x = Math.PI / 2; drum.position.set(s * 0.15, b.torsoH * 0.5, 0);
        for (const z of [-0.45, -0.15, 0.15, 0.45]) torus(b.up, M.copper, s * 0.74, s * 0.06, s * 0.15, b.torsoH * 0.5, z * s);
        const core = ball(b.up, M.ice, s * 0.3, s * 0.82, b.torsoH * 0.5, 0);
        const tips = [-1, 1].map((z) => {
          cyl(b.up, M.steel, s * 0.06, s * 0.1, s * 1.1, -s * 0.1, b.torsoH + s * 0.5, z * s * 0.62, 8);
          for (const y of [0.25, 0.55, 0.85]) torus(b.up, M.copper, s * 0.16, s * 0.04, -s * 0.1, b.torsoH + y * s, z * s * 0.62).rotation.x = Math.PI / 2;
          return ball(b.up, M.ice, s * 0.17, -s * 0.1, b.torsoH + s * 1.15, z * s * 0.62);
        });
        const rotor = new THREE.Group(); rotor.position.set(-s * 0.85, b.torsoH * 0.6, 0); b.up.add(rotor);
        for (let k = 0; k < 5; k++) { const bl = box(rotor, M.steel, s * 0.05, s * 0.75, s * 0.18, 0, 0, 0); bl.rotation.x = (k * TAU) / 5; bl.translateY(s * 0.35); }
        cyl(rotor, M.gold, s * 0.14, s * 0.14, s * 0.2, 0, 0, 0, 10).rotation.z = Math.PI / 2;
        tick = (e, time, d) => {
          b.walk(d);
          const surging = e.overT > 0;
          rotor.rotation.x = time * (surging ? 22 : 4);
          const hot = surging ? Math.floor(time * 14) % 2 === 0 : Math.sin(time * 3 + e.id) > 0.6;
          for (const t of tips) t.material = hot ? M.lantern : M.ice;
          core.material = surging ? M.lantern : M.ice;
        };
        h = b.h + s * 1.3;
        break;
      }
      default: {
        const o = type === 'runner' ? { leg: 1.5, torso: 0.85, w: 0.72, lean: -0.3 }
          : type === 'brute' ? { w: 1.3, arms: true, torso: 1.2 }
          : type === 'hexguard' ? { hex: true }
          : type === 'emp' ? { round: true, leg: 0.8 }
          : type === 'cloaker' ? { w: 0.85, leg: 1.2, arms: true }
          : type === 'shield' ? { w: 1.1, arms: true, leg: 1.2, torso: 1.3 }
          : type === 'sapper' ? { leg: 0.8, torso: 0.9, lean: -0.35, arms: true }
          : type === 'lamp' ? { w: 0.8, leg: 1.5, torso: 1.2 }
          : type === 'courier' ? { leg: 1.4, torso: 0.8, w: 0.7, lean: -0.2 }
          : type === 'mole' ? { round: true, leg: 0.9, w: 1.05 }
          : type === 'ember' ? { round: true, leg: 1.1, w: 1.0 }
          : type === 'tram' ? { leg: 0.8, torso: 0.4, w: 1.2 } : {};
        const b = biped(g, mat, s, o);
        let ring = null, tip = null;
        if (type === 'emp') { ring = torus(b.up, M.steel, s * 0.9, s * 0.07, 0, b.torsoH * 0.55, 0); cyl(b.up, M.steel, s * 0.03, s * 0.03, s * 0.9, 0, b.torsoH + s * 0.4, 0, 6); tip = ball(b.up, M.steel, s * 0.12, 0, b.torsoH + s * 1.35, 0); }
        if (type === 'brute') for (const z of [-1, 1]) box(b.up, M.steel, s * 0.8, s * 0.12, s * 0.2, 0, b.torsoH * 0.5, z * s * 0.6);
        let spin = null, glow = null, extraH = type === 'emp' ? s : 0;
        if (type === 'shield') {
          // a gold bulwark disc held out in front
          const disc = cyl(b.up, M.gold, s * 0.8, s * 0.8, s * 0.08, 0, 0, 0, 20); disc.rotation.z = Math.PI / 2; disc.position.set(s * 0.62, b.torsoH * 0.55, 0);
          torus(b.up, M.cream, s * 0.55, s * 0.04, s * 0.67, b.torsoH * 0.55, 0).rotation.set(0, Math.PI / 2, 0);
          ball(b.up, M.goldGlow, s * 0.14, s * 0.7, b.torsoH * 0.55, 0);
        }
        if (type === 'sapper') {
          // a satchel on the back with a lit fuse
          box(b.up, M.brass, s * 0.5, s * 0.6, s * 0.7, -s * 0.6, b.torsoH * 0.2, 0, true);
          glow = ball(b.up, M.ember, s * 0.1, -s * 0.6, b.torsoH * 0.2 + s * 0.75, 0);
        }
        if (type === 'lamp') {
          // a lantern carried high on a pole
          cyl(b.up, M.brass, s * 0.05, s * 0.05, s * 2.4, s * 0.5, b.torsoH * 0.5, s * 0.5, 6);
          box(b.up, M.gold, s * 0.36, s * 0.06, s * 0.36, s * 0.5, b.torsoH * 0.5 + s * 2.4, s * 0.5);
          glow = box(b.up, M.lantern, s * 0.28, s * 0.4, s * 0.28, s * 0.5, b.torsoH * 0.5 + s * 2.0, s * 0.5);
          extraH = s * 1.6;
        }
        if (type === 'courier') {
          // a brass bell on a short antenna
          cyl(b.up, M.steel, s * 0.03, s * 0.03, s * 0.6, 0, b.torsoH + s * 0.4, 0, 6);
          glow = ball(b.up, M.gold, s * 0.2, 0, b.torsoH + s * 1.05, 0);
          extraH = s * 0.8;
        }
        if (type === 'mole') {
          // a drill nose that spins as it walks
          spin = cyl(b.up, M.steel, 0.001, s * 0.5, s * 1.1, 0, 0, 0, 10); spin.rotation.z = -Math.PI / 2; spin.position.set(s * 1.15, b.torsoH * 0.55, 0);
          for (const z of [-1, 1]) box(b.up, M.gunmetal, s * 0.3, s * 0.12, s * 0.5, -s * 0.2, b.torsoH * 0.3, z * s * 0.65);
        }
        if (type === 'ember') {
          // a furnace belly that glows through a grate
          glow = ball(b.up, M.ember, s * 0.45, s * 0.42, b.torsoH * 0.5, 0);
          for (const y of [-0.15, 0, 0.15]) box(b.up, M.gunmetal, s * 0.06, s * 0.04, s * 0.8, s * 0.88, b.torsoH * 0.5 + y * s, 0);
          cyl(b.up, M.gunmetal, s * 0.12, s * 0.16, s * 0.6, -s * 0.2, b.torsoH * 1.1, 0, 10);
        }
        if (type === 'tram') {
          // an iron tram car riding on robot legs, lit windows, gold trim and a pantograph
          box(b.up, mat, s * 2.2, s * 0.95, s * 1.2, 0, s * 0.1, 0, true);
          box(b.up, M.facade, s * 1.9, s * 0.4, s * 1.24, 0, s * 0.45, 0);
          box(b.up, M.gold, s * 2.24, s * 0.05, s * 1.24, 0, s * 1.05, 0);
          box(b.up, M.roof, s * 2.0, s * 0.12, s * 1.0, 0, s * 1.1, 0);
          const pan = box(b.up, M.steel, s * 0.04, s * 0.5, s * 0.04, 0, s * 1.2, 0); pan.rotation.z = 0.5;
          for (const z of [-1, 1]) ball(b.up, M.lantern, s * 0.1, s * 1.12, s * 0.5, z * s * 0.4);
          box(b.up, M.steel, s * 0.12, s * 0.5, s * 1.3, s * 1.15, 0, 0);
          extraH = s * 0.8;
        }
        tick = (e, time, d) => {
          b.walk(d);
          if (ring) ring.rotation.z = time * 1.5;
          if (tip) tip.material = e.empT < 1 && Math.floor(time * 12) % 2 ? M.ember : M.steel;
          if (spin) spin.rotation.x = time * 20;
          if (glow && type === 'sapper') glow.material = Math.floor(time * 8) % 2 ? M.ember : M.lantern;
          if (glow && type === 'courier') glow.material = e.blinkT < 1 ? M.goldGlow : M.gold;
        };
        h = b.h + extraH;
      }
    }
    // stealth: swap every part for a faint cream silhouette (mode 0 solid, 1 revealed, 2 hidden)
    const parts = [];
    g.traverse((o) => { if (o.isMesh) parts.push([o, o.material]); });
    let mode = 0;
    const setGhost = (m) => { if (m === mode) return; mode = m; for (const [o, orig] of parts) o.material = m === 0 ? orig : m === 1 ? M.shadeHi : M.shadeLo; };
    g.userData = { tick, h, setGhost, s };
    return g;
  }

  // A thin lit rim round the top of a w×d block (not a slab, so the roof stays dark and only the edge glows).
  const rimLine = (g, mat, w, d, x, y, z, t = 0.05) => {
    box(g, mat, w + t, 0.05, t, x, y, z - d / 2); box(g, mat, w + t, 0.05, t, x, y, z + d / 2);
    box(g, mat, t, 0.05, d - t, x - w / 2, y, z); box(g, mat, t, 0.05, d - t, x + w / 2, y, z);
  };
  // A flat ring standing in the YZ plane, facing +x (the way the buildings face the road).
  const ringX = (g, mat, r, t, x, y, z) => { const m = torus(g, mat, r, t, x, y, z); m.rotation.set(0, Math.PI / 2, 0); return m; };
  // A cog standing in the YZ plane: rim, three spokes, a hub and teeth. The group turns about its x axis.
  function cog(mat, hub, r, teeth = 10) {
    const g = new THREE.Group();
    const rim = new THREE.Mesh(shared(`cr${r}`, () => new THREE.TorusGeometry(r, r * 0.12, 6, 24)), mat); rim.rotation.y = Math.PI / 2; g.add(rim);
    for (let k = 0; k < 3; k++) { const sp = new THREE.Mesh(boxGeo(r * 0.1, r * 2, r * 0.1, false), mat); sp.rotation.x = (k * Math.PI) / 3; g.add(sp); }
    for (let k = 0; k < teeth; k++) {
      const a = (k / teeth) * TAU, t = new THREE.Mesh(boxGeo(r * 0.22, r * 0.34, r * 0.3, false), mat);
      t.position.set(0, Math.cos(a) * r * 1.12, Math.sin(a) * r * 1.12); t.rotation.x = a; g.add(t);
    }
    const h = new THREE.Mesh(shared(`ch${r}`, () => new THREE.SphereGeometry(r * 0.22, 10, 8)), hub); g.add(h);
    return g;
  }

  // The Automaton Works: robots march out of its dark door. Body spans local x in [-4.6, -0.6]; the door recess is [-0.6, 0].
  // Local +x points along the road, and the door sits at x = 0 on the map edge.
  function factory() {
    const g = new THREE.Group();
    const coreMat = M.reflect(M.ember.clone());                 // its own material, so only this door and its glass pulse
    const spin = [];
    box(g, M.marble, 3.9, 0.12, 3.3, -2.6, 0, 0, true);         // plinth
    box(g, M.facade, 3.4, 2.6, 2.8, -2.3, 0.12, 0, true);       // the hall, with the city's lit windows
    rimLine(g, M.goldRim, 3.4, 2.8, -2.3, 2.72, 0);            // a lit gold rim round the roof
    box(g, M.neonCoral, 3.44, 0.05, 2.84, -2.3, 2.3, 0);        // a coral band round the hall
    // the foundry block at the back, rising above the roof
    box(g, M.facadeB, 1.0, 1.7, 2.2, -3.5, 2.8, 0, true);
    rimLine(g, M.goldRim, 1.0, 2.2, -3.5, 4.5, 0);
    box(g, M.neonTeal, 1.04, 0.04, 2.24, -3.5, 4.2, 0);
    for (const z of [-1.1, 1.1]) box(g, M.neonTeal, 0.05, 1.5, 0.05, -3.0, 2.85, z);
    // a sawtooth roof: slanted slabs, each with a glowing glass edge
    for (let i = 0; i < 3; i++) {
      const x = -2.1 + i * 0.6;
      const slab = box(g, M.roof, 0.62, 0.07, 2.6, 0, 0, 0); slab.rotation.z = 0.5; slab.position.set(x, 2.98, 0);
      box(g, coreMat, 0.04, 0.34, 2.5, x + 0.28, 2.8, 0);
    }
    // two banded stacks, glowing at the rim
    for (const z of [-1.0, 1.0]) {
      box(g, M.marble, 0.46, 1.9, 0.46, -2.6, 2.8, z, true);
      for (const y of [3.4, 4.1]) box(g, M.brass, 0.5, 0.06, 0.5, -2.6, y, z);
      box(g, coreMat, 0.5, 0.1, 0.5, -2.6, 4.7, z);
    }
    // two storage tanks beside the hall, banded in teal light
    for (const [x, z, r] of [[-2.0, -2.15, 0.5], [-3.3, 2.15, 0.42]]) {
      cyl(g, M.marble, r, r, 1.5, x, 0.12, z, 20);
      const dome = ball(g, M.brass, r, x, 1.62, z); dome.scale.y = 0.45;
      torus(g, M.neonTeal, r + 0.015, 0.025, x, 0.7, z); torus(g, M.neonTeal, r + 0.015, 0.025, x, 1.2, z);
    }
    // the door: a deep arch of jambs and lintel, hazard-striped, with the furnace glowing in the dark
    for (const z of [-1.05, 1.05]) { box(g, M.marble, 0.6, 1.8, 0.3, -0.3, 0.12, z, true); box(g, M.brass, 0.62, 0.05, 0.32, -0.3, 1.92, z); }
    box(g, M.marble, 0.6, 0.3, 2.4, -0.3, 1.92, 0, true);
    for (let k = 0; k < 10; k++) box(g, k % 2 ? M.roof : M.brass, 0.02, 0.18, 0.2, 0.01, 1.98, -0.9 + k * 0.2);
    box(g, M.roof, 0.04, 1.8, 1.8, -0.58, 0.12, 0);
    box(g, coreMat, 0.03, 1.2, 1.2, -0.545, 0.25, 0);
    for (const z of [-0.5, 0.5]) box(g, M.gunmetal, 0.56, 0.02, 0.2, -0.3, 0.12, z);   // the belt the robots ride out on
    // the cog emblem over the door: a ring of brass that slowly turns
    const emblem = cog(M.brass, coreMat, 0.26); emblem.position.set(-0.56, 2.4, 0); g.add(emblem); spin.push(emblem);
    g.userData = { core: coreMat, spin, stacks: [[-2.6, 4.7, -1.0], [-2.6, 4.7, 1.0]] };
    return g;
  }

  // The Power Exchange: where the boulevard enters the city, and what the robots are marching on. Each one that
  // reaches it plugs in and drains it, and districts of the city go dark. Local +x points away from the map; the robots
  // stop under the intake arch at x = 0.5. A gauge of lit bars on each side shows the city's charge.
  function exchange(nBars = 10) {
    const g = new THREE.Group();
    const coreMat = M.reflect(M.lantern.clone());               // its own material, driven by the city's power
    coreMat.emissive.setHex(0xff9a2e);                          // a warmer amber than the lanterns
    // the intake arch the robots walk under, with the sunburst crown
    for (const z of [-1.0, 1.0]) { box(g, M.marble, 0.34, 2.2, 0.34, 0.45, 0, z, true); box(g, M.brass, 0.38, 0.05, 0.38, 0.45, 2.2, z); }
    box(g, M.marble, 0.34, 0.24, 2.34, 0.45, 2.2, 0, true);
    for (let k = 0; k < 7; k++) {
      const a = (k - 3) * 0.36, ray = box(g, M.brass, 0.03, 0.55 + (k % 2) * 0.2, 0.03, 0.45, 2.7, 0);
      ray.rotation.x = a; ray.position.z = Math.sin(a) * 0.5; ray.position.y = 2.95 + Math.cos(a) * 0.4;
    }
    // a stepped plinth and tower in three setbacks, each with lit windows, a teal band and teal corner lines
    box(g, M.marble, 3.5, 0.06, 3.7, 2.6, 0, 0, true);
    const tiers = [[3.0, 1.8, 2.5, 0.06, M.facade], [2.2, 1.3, 2.7, 1.98, M.facadeB], [1.4, 1.3, 2.8, 3.34, M.facade]];
    for (const [w, h, cx, y0, wall] of tiers) {
      box(g, wall, w, h, w, cx, y0, 0, true);
      rimLine(g, M.goldRim, w, w, cx, y0 + h, 0);
      box(g, M.neonTeal, w + 0.03, 0.04, w + 0.03, cx, y0 + h - 0.14, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, M.neonTeal, 0.05, h - 0.3, 0.05, cx + sx * (w / 2 + 0.01), y0 + 0.1, sz * (w / 2 + 0.01));
    }
    box(g, M.marble, 0.9, 0.3, 0.9, 2.8, 4.7, 0, true);
    cyl(g, M.brass, 0.03, 0.09, 0.7, 2.8, 5.0, 0, 8);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), coreMat); orb.position.set(2.8, 5.9, 0); g.add(orb);
    torus(g, M.neonTeal, 0.34, 0.015, 2.8, 5.9, 0);              // a halo ring round the orb
    // the intake: a glowing doorway in the face of the tower, where the robots plug in
    box(g, M.roof, 0.06, 1.5, 1.3, 1.0, 0.06, 0);
    box(g, coreMat, 0.03, 1.2, 1.0, 0.97, 0.16, 0);
    for (const y of [0.5, 0.9]) box(g, M.brass, 0.04, 0.03, 1.0, 0.955, y, 0);
    // tesla coils at the tower's front corners: a rod, copper rings, a glowing terminal inside a teal ring
    const coils = [];
    for (const z of [-1.25, 1.25]) {
      cyl(g, M.brass, 0.05, 0.07, 2.4, 1.3, 0.06, z, 8);
      for (let k = 0; k < 5; k++) cyl(g, M.copper, 0.16 - k * 0.02, 0.16 - k * 0.02, 0.05, 1.3, 0.6 + k * 0.32, z, 12);
      const t = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), coreMat); t.position.set(1.3, 2.55, z); g.add(t);
      torus(g, M.neonTeal, 0.22, 0.012, 1.3, 2.55, z);
      coils.push([1.3, 2.55, z]);
    }
    // capacitor banks flanking the tower: drums with brass caps and teal bands
    for (const z of [-2.15, 2.15]) for (const x of [1.9, 2.6, 3.3]) {
      cyl(g, M.marble, 0.27, 0.27, 0.9, x, 0.06, z, 14);
      cyl(g, M.brass, 0.29, 0.29, 0.06, x, 0.96, z, 14);
      torus(g, M.neonTeal, 0.275, 0.02, x, 0.5, z);
    }
    // the charge gauge: a column of bars on each side of the tower, lit from the bottom up
    const bars = [];
    for (let k = 0; k < nBars; k++) {
      const y = 0.15 + k * 0.155, pair = [];
      for (const z of [-1.52, 1.52]) pair.push(box(g, coreMat, 0.5, 0.11, 0.03, 2.5, y, z));
      bars.push(pair);
    }
    g.userData = { core: coreMat, coils, spire: [2.8, 5.9, 0], bars };
    return g;
  }

  // The playfield's lights going out (the final blackout beat). k: 0 = normal, 1 = near darkness. Windows flicker
  // out first, then neon, then the towers' lamps; street reflections and the ambient light fade last. It only
  // touches shared materials and the scene lights handed in, so it costs a handful of uniform writes per frame.
  let BO = null;
  function setBlackout(k, lights = [], now = 0) {
    if (!BO) {
      const keep = (m, ...ps) => ({ m, v: ps.map((p) => (m[p] && m[p].isColor ? m[p].clone() : m[p])), ps });
      BO = {
        win: [keep(M.facade, 'emissiveIntensity', 'color', 'envMapIntensity'), keep(M.facadeB, 'emissiveIntensity', 'color', 'envMapIntensity')],
        neon: ['neonCoral', 'neonTeal', 'neonPink'].map((n) => keep(M[n], 'color')),
        lamp: ['lantern', 'cream', 'ember', 'ice', 'lilac', 'goldGlow', 'goldRim', 'dim'].map((n) => keep(M[n], 'emissiveIntensity')),
        metal: ['gold', 'goldTwo', 'brass', 'copper', 'gunmetal', 'steel', 'marble', 'navy', 'terrace', 'roof'].map((n) => keep(M[n], 'envMapIntensity')),
        halo: M.halo.opacity,
      };
    }
    // lit(k, from, to): 1 until `from`, then falls to ~0 at `to`, stuttering on the way down
    const lit = (from, to, seed) => {
      if (k <= from) return 1;
      if (k >= to) return 0;
      const x = (k - from) / (to - from), flick = !now || Math.sin(now * 38 + seed * 5.3) > -0.25 + x * 0.9 ? 1 : 0.12;
      return (1 - x) * flick;
    };
    const win = lit(0.0, 0.5, 1), neon = lit(0.15, 0.65, 2), lamp = lit(0.3, 0.85, 3), amb = Math.pow(1 - Math.min(1, k * 1.12), 1.6);
    const set = (e, f) => e.ps.forEach((p, i) => {
      if (typeof e.v[i] === 'number') e.m[p] = e.v[i] * f; else e.m[p].copy(e.v[i]).multiplyScalar(f);
    });
    for (const e of BO.win) { e.m.emissiveIntensity = e.v[0] * (0.02 + 0.98 * win); e.m.color.copy(e.v[1]).multiplyScalar(0.2 + 0.8 * win); e.m.envMapIntensity = e.v[2] * (0.25 + 0.75 * amb); }
    for (const e of BO.neon) set(e, 0.04 + 0.96 * neon);
    for (const e of BO.lamp) set(e, 0.04 + 0.96 * lamp);
    for (const e of BO.metal) set(e, 0.1 + 0.9 * amb);
    M.halo.opacity = BO.halo * Math.max(win, neon);
    for (const l of lights) l.light.intensity = l.base * (0.03 + 0.97 * amb);
    return { win, neon, lamp, amb };
  }
  return { init, outerCity, setBlackout, blocks, tower, ghostify, enemy, factory, exchange, disposeGroup, get M() { return M; } };
})();
