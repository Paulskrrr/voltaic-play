// Voltaic main-menu backdrop: a night skyline in the city's Deco palette, drawn in code.
// Three layers of stepped towers, a moon with a sunburst, searchlights sweeping the sky and
// blinking aviation lights. The still parts are painted once per resize into two offscreen
// canvases (behind and in front of the searchlights); each frame only adds the moving light.
window.TD_MENU_ART = (() => {
  let cv = null, ctx = null, back = null, front = null;
  let w = 0, h = 0, dpr = 1;
  let beams = [], lights = [], raf = 0, running = false, lastDraw = 0;
  const reduced = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // Small seeded generator, so the skyline is the same city every time.
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function layerCanvas() {
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    return [c, g];
  }

  // Lit windows on one face of a building.
  function windows(g, r, x, top, bw, bh, o) {
    const cw = o.cell[0], ch = o.cell[1], gx = o.gap[0], gy = o.gap[1];
    const cols = Math.floor((bw - gx) / (cw + gx)), rows = Math.floor((bh - gy * 2) / (ch + gy));
    if (cols < 1 || rows < 1) return;
    const x0 = x + (bw - (cols * (cw + gx) - gx)) / 2;
    const p = o.p[0] + r() * (o.p[1] - o.p[0]);
    for (let j = 0; j < rows; j++) {
      // whole floors go dark or bright together, which reads more like a real tower
      const fp = p * (r() < 0.25 ? 0.2 : r() < 0.15 ? 2.4 : 1);
      for (let i = 0; i < cols; i++) {
        if (r() > fp) continue;
        const warm = r() < 0.86;
        const a = o.alpha * (0.45 + r() * 0.55);
        g.fillStyle = warm ? `rgba(243, 206, 128, ${a})` : `rgba(214, 228, 240, ${a * 0.8})`;
        g.fillRect(x0 + i * (cw + gx), top + gy + j * (ch + gy), cw, ch);
      }
    }
  }

  // One building, in one flat color. Returns the tip of its roof for lights and beams.
  function building(g, r, x, base, bw, bh, color, o) {
    g.fillStyle = color;
    const style = o.style || ['setback', 'setback', 'crown', 'flat', 'pyramid'][Math.floor(r() * 5)];
    let top = base - bh;
    g.fillRect(x, top, bw, bh + 2);
    if (o.win) windows(g, r, x, top, bw, bh, o.win);
    if (o.rim) {
      // moonlight catching the right-hand edge
      g.fillStyle = `rgba(230, 195, 110, ${o.rim})`;
      g.fillRect(x + bw - Math.max(1, bw * 0.04), top, Math.max(1, bw * 0.04), bh);
    }
    g.fillStyle = color;
    let cx = x + bw / 2, tw = bw;
    if (style === 'setback' || style === 'crown' || style === 'pyramid') {
      const tiers = style === 'pyramid' ? 4 : 1 + Math.floor(r() * 3);
      for (let i = 0; i < tiers; i++) {
        const nw = tw * (style === 'pyramid' ? 0.74 : 0.62 + r() * 0.16);
        const th = style === 'pyramid' ? bh * 0.035 : bh * (0.07 + r() * 0.08);
        top -= th; tw = nw;
        g.fillStyle = color;
        g.fillRect(cx - tw / 2, top, tw, th + 1);
        if (o.win && th > o.win.cell[1] * 3) windows(g, r, cx - tw / 2, top, tw, th, o.win);
      }
      g.fillStyle = color;
    }
    if (style === 'crown') {
      // stacked arches and a needle, the Chrysler way
      let aw = tw;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo(cx - aw / 2, top + 1);
        g.arc(cx, top + 1, aw / 2, Math.PI, 0);
        g.fillStyle = color; g.closePath(); g.fill();
        if (o.win) {
          g.strokeStyle = `rgba(243, 206, 128, ${o.win.alpha * 0.6})`;
          g.lineWidth = Math.max(0.6, aw * 0.03);
          g.beginPath(); g.arc(cx, top + 1, aw * 0.36, Math.PI, 0); g.stroke();
        }
        top -= aw * 0.32; aw *= 0.68;
      }
      const nh = bh * (0.12 + r() * 0.1);
      g.fillStyle = color; g.beginPath(); g.moveTo(cx - aw * 0.22, top + aw * 0.3); g.lineTo(cx, top - nh); g.lineTo(cx + aw * 0.22, top + aw * 0.3); g.fill();
      top -= nh;
    } else if (style === 'pyramid' || r() < 0.45) {
      const sh = bh * (0.05 + r() * 0.12);
      g.fillRect(cx - Math.max(0.8, tw * 0.03), top - sh, Math.max(1.6, tw * 0.06), sh + 1);
      top -= sh;
    } else if (style === 'flat' && r() < 0.5) {
      // rooftop water tank
      const tw2 = tw * 0.22, th2 = tw2 * 0.9;
      g.fillRect(cx + tw * 0.12, top - th2, tw2, th2 + 1);
    }
    return { x: cx, y: top };
  }

  function row(g, r, o) {
    const tips = [];
    let x = -o.wid[1] * 0.5;
    while (x < w + o.wid[1]) {
      const bw = o.wid[0] + r() * (o.wid[1] - o.wid[0]);
      // taller toward the right, where the menu leaves the view open
      const lean = 0.75 + 0.5 * Math.min(1, Math.max(0, x / w));
      const bh = (o.hei[0] + r() * (o.hei[1] - o.hei[0])) * h * lean;
      tips.push(building(g, r, x, o.base, bw, bh, o.color, o));
      x += bw * (0.82 + r() * 0.3);
    }
    return tips;
  }

  function paint() {
    const r = rng(1931);
    const u = h / 900;
    let gb, gf;
    [back, gb] = layerCanvas();
    [front, gf] = layerCanvas();

    // sky
    const sky = gb.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#03050c');
    sky.addColorStop(0.55, '#0a1230');
    sky.addColorStop(0.8, '#1a1d3c');
    sky.addColorStop(1, '#2a1c2a');
    gb.fillStyle = sky; gb.fillRect(0, 0, w, h);

    // stars
    for (let i = 0; i < 220; i++) {
      const sx = r() * w, sy = r() * h * 0.62, sr = (0.35 + r() * 0.9) * u * 1.2;
      gb.fillStyle = `rgba(239, 228, 200, ${0.15 + r() * 0.55 * (1 - sy / (h * 0.7))})`;
      gb.beginPath(); gb.arc(sx, sy, sr, 0, Math.PI * 2); gb.fill();
    }

    // moon, sunburst and deco rings
    const mx = w * 0.72, my = h * 0.27, mr = h * 0.075;
    gb.save();
    gb.translate(mx, my);
    for (let i = 0; i < 40; i++) {
      const a0 = (i / 40) * Math.PI * 2, a1 = a0 + Math.PI * 2 / 40 * 0.35;
      gb.fillStyle = 'rgba(212, 175, 90, 0.035)';
      gb.beginPath(); gb.moveTo(0, 0); gb.arc(0, 0, Math.max(w, h) * 1.2, a0, a1); gb.closePath(); gb.fill();
    }
    const halo = gb.createRadialGradient(0, 0, mr * 0.8, 0, 0, mr * 4.5);
    halo.addColorStop(0, 'rgba(243, 216, 138, 0.28)');
    halo.addColorStop(1, 'rgba(243, 216, 138, 0)');
    gb.fillStyle = halo; gb.beginPath(); gb.arc(0, 0, mr * 4.5, 0, Math.PI * 2); gb.fill();
    gb.strokeStyle = 'rgba(230, 195, 110, 0.22)'; gb.lineWidth = Math.max(1, u);
    for (const k of [1.45, 1.8]) { gb.beginPath(); gb.arc(0, 0, mr * k, 0, Math.PI * 2); gb.stroke(); }
    const disc = gb.createRadialGradient(-mr * 0.3, -mr * 0.3, mr * 0.1, 0, 0, mr);
    disc.addColorStop(0, '#fbf1d6'); disc.addColorStop(1, '#dcc58c');
    gb.fillStyle = disc; gb.beginPath(); gb.arc(0, 0, mr, 0, Math.PI * 2); gb.fill();
    gb.fillStyle = 'rgba(160, 130, 70, 0.18)';
    for (const [cx, cy, cr] of [[0.3, -0.2, 0.18], [-0.35, 0.25, 0.12], [0.1, 0.45, 0.09]]) {
      gb.beginPath(); gb.arc(cx * mr, cy * mr, cr * mr, 0, Math.PI * 2); gb.fill();
    }
    gb.restore();

    // far city in the haze
    const farTips = row(gb, r, {
      base: h * 0.8, wid: [26 * u, 70 * u], hei: [0.16, 0.42], color: '#141d42', rim: 0,
      win: { cell: [1.6 * u, 2.2 * u], gap: [2.6 * u, 3.2 * u], p: [0.04, 0.16], alpha: 0.4 },
    });
    let mist = gb.createLinearGradient(0, h * 0.45, 0, h * 0.82);
    mist.addColorStop(0, 'rgba(30, 40, 84, 0)'); mist.addColorStop(1, 'rgba(36, 40, 82, 0.55)');
    gb.fillStyle = mist; gb.fillRect(0, h * 0.45, w, h * 0.4);

    // mid city, with the hero tower in front of the moon
    const midOpts = {
      base: h * 0.88, wid: [34 * u, 92 * u], hei: [0.12, 0.4], color: '#0b1230', rim: 0.07,
      win: { cell: [2.2 * u, 3.2 * u], gap: [3.4 * u, 4 * u], p: [0.08, 0.3], alpha: 0.75 },
    };
    const midTips = row(gf, r, midOpts);
    const hero = building(gf, r, w * 0.665, h * 0.88, 92 * u, h * 0.5, '#0b1230', { ...midOpts, style: 'crown', rim: 0.12 });
    let glow = gf.createLinearGradient(0, h * 0.7, 0, h * 0.9);
    glow.addColorStop(0, 'rgba(255, 110, 60, 0)'); glow.addColorStop(1, 'rgba(255, 110, 60, 0.12)');
    gf.fillStyle = glow; gf.fillRect(0, h * 0.7, w, h * 0.2);

    // near rooftops
    const nearTips = row(gf, r, {
      base: h * 1.0, wid: [60 * u, 150 * u], hei: [0.06, 0.24], color: '#050814', rim: 0.05,
      win: { cell: [3.4 * u, 5 * u], gap: [5 * u, 6.5 * u], p: [0.06, 0.24], alpha: 0.85 },
    });

    // searchlights from a few far rooftops, sweeping out of phase
    const pick = (list, n) => list.filter((t) => t.x > w * 0.3 && t.x < w * 0.98).sort((a, b) => a.y - b.y).slice(0, n);
    beams = pick(farTips, 3).map((t, i) => ({ x: t.x, y: t.y, base: -Math.PI / 2 + (i - 1) * 0.35, amp: 0.32 + r() * 0.15, speed: 0.12 + r() * 0.1, phase: r() * 6.28 }));
    lights = [hero, ...pick(midTips, 4), ...pick(nearTips, 2)].map((t) => ({ x: t.x, y: t.y, phase: r() * 6.28 }));
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(back, 0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const len = h * 1.4;
    for (const b of beams) {
      const a = b.base + Math.sin(t * b.speed + b.phase) * b.amp, spread = 0.045;
      const ex = Math.cos(a) * len, ey = Math.sin(a) * len;
      const grad = ctx.createLinearGradient(b.x, b.y, b.x + ex, b.y + ey);
      grad.addColorStop(0, 'rgba(243, 216, 138, 0.2)');
      grad.addColorStop(1, 'rgba(243, 216, 138, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + Math.cos(a - spread) * len, b.y + Math.sin(a - spread) * len);
      ctx.lineTo(b.x + Math.cos(a + spread) * len, b.y + Math.sin(a + spread) * len);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(front, 0, 0, w, h);
    const u = h / 900;
    for (const l of lights) {
      const on = Math.max(0, Math.sin(t * 2.2 + l.phase));
      if (on < 0.05) continue;
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, 9 * u);
      g.addColorStop(0, `rgba(255, 120, 80, ${0.95 * on})`);
      g.addColorStop(0.25, `rgba(255, 90, 46, ${0.5 * on})`);
      g.addColorStop(1, 'rgba(255, 90, 46, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(l.x, l.y, 9 * u, 0, Math.PI * 2); ctx.fill();
    }
  }

  function resize() {
    if (!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = cv.clientWidth || window.innerWidth; h = cv.clientHeight || window.innerHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    paint();
    draw(performance.now() / 1000);
  }

  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (reduced.matches || now - lastDraw < 33) return; // about 30 fps is plenty for slow light
    lastDraw = now;
    draw(now / 1000);
  }

  function start(canvas) {
    if (canvas !== cv) { cv = canvas; ctx = cv.getContext('2d'); }
    if (running) return;
    running = true;
    resize();
    raf = requestAnimationFrame(loop);
  }
  function stop() { running = false; cancelAnimationFrame(raf); }
  window.addEventListener('resize', () => { if (running) resize(); });

  return { start, stop };
})();
