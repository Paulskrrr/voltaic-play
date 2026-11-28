// Voltaic campaign map: the city from above at night, in the same Deco palette as the menu, drawn in code.
// Ten districts strung along one boulevard that enters from the foundry lands in the west. A district's
// windows come on once its level is won, so the map fills with light over the campaign. Everything is
// still: it is painted once per show, resize or change of progress, and the game puts the level markers
// (HTML buttons) on top using the box this returns.
window.TD_CAMP_ART = (() => {
  const BW = 1000, BH = 680; // the designed box in map units; a level's `at` is a fraction of it
  // the river, in box fractions; it runs off the left edge and out at the bottom
  const RIVER = [[-0.6, 0.5], [-0.05, 0.55], [0.1, 0.57], [0.22, 0.52], [0.34, 0.55], [0.42, 0.66], [0.47, 0.84], [0.5, 1.1], [0.52, 1.8]];
  // how the boulevard bends between level i and i + 1: 'h' runs across first, 'v' up or down first
  const BENDS = ['h', 'v', 'v', 'h', 'v', 'v', 'h', 'h', 'v'];
  // how lit a district is, by its level's state
  const LIGHT = { won: 1, open: 0.55, locked: 0.14, soon: 0.1 };

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
  const hash = (i, seed) => rng(Math.imul(i + 1000, 2654435761) ^ seed)();
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
  const segDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
    return Math.hypot(px - ax - dx * t, py - ay - dy * t);
  };
  const lineDist = (px, py, pts) => {
    let d = Infinity;
    for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
    return d;
  };

  // Street edges along one axis: blocks of 30-56 units, streets of 9, and a wider avenue every few blocks.
  // Seeded by index, so the same city appears however much of it the screen shows.
  function edges(min, max, seed, lo, hi) {
    const out = [];
    const step = (i) => ({ len: lo + hash(i, seed) * (hi - lo), gap: i % 4 === 0 ? 16 : 9 });
    let x = 0;
    for (let i = 0; x < max; i++) { const s = step(i); if (x + s.len > min) out.push([x, x + s.len]); x += s.len + s.gap; }
    x = 0;
    for (let i = -1; x > min; i--) { const s = step(i); x -= s.len + s.gap; if (x < max) out.push([x, x + s.len]); }
    return out;
  }

  function routeOf(nodes) {
    const p = nodes.map((n) => [n.at[0] * BW, n.at[1] * BH]);
    const pts = [[-900, p[0][1]], p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [a, b] = [p[i], p[i + 1]];
      pts.push(BENDS[i] === 'v' ? [a[0], b[1]] : [b[0], a[1]], b);
    }
    return pts;
  }
  // a polyline with rounded corners
  function roundPath(g, pts, r) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) g.arcTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r);
    g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  }

  function block(g, r, x, y, w, h, L) {
    if (r() < 0.06) {
      // a park: dark lawn and a scatter of trees
      g.fillStyle = rgb(mix([9, 20, 20], [14, 32, 28], L)); g.fillRect(x, y, w, h);
      g.fillStyle = rgb(mix([12, 30, 26], [24, 52, 40], L));
      for (let i = 0, n = Math.floor((w * h) / 70); i < n; i++) {
        g.beginPath(); g.arc(x + 3 + r() * (w - 6), y + 3 + r() * (h - 6), 1.6 + r() * 1.8, 0, Math.PI * 2); g.fill();
      }
      return;
    }
    g.fillStyle = rgb(mix([10, 15, 28], [22, 28, 46], L)); g.fillRect(x, y, w, h);
    // the block's buildings: split along its long side, each roof its own shade
    const n = 1 + Math.floor(r() * (w > h ? w / 18 : h / 18)), across = w > h;
    let at = 0;
    for (let i = 0; i < n; i++) {
      const len = i === n - 1 ? (across ? w : h) - at : ((across ? w : h) / n) * (0.7 + r() * 0.6);
      const bx = across ? x + at : x, by = across ? y : y + at, bw = across ? len : w, bh = across ? h : len;
      at += len;
      if (bw < 3 || bh < 3) continue;
      const tall = r(), sh = 1.5 + tall * 3.5;
      // the shadow it throws south-east in the moonlight, so the plan reads in relief
      g.fillStyle = 'rgba(2, 3, 8, 0.55)';
      g.fillRect(bx + 1 + sh, by + 1 + sh, bw - 2, bh - 2);
      g.fillStyle = rgb(mix([15, 21, 38], [52, 46, 58], L * (0.6 + tall * 0.5)));
      g.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
      // moonlight on the north-west edges
      g.fillStyle = `rgba(230, 195, 110, ${0.05 + L * 0.16})`;
      g.fillRect(bx + 1, by + 1, bw - 2, 0.8); g.fillRect(bx + 1, by + 1, 0.8, bh - 2);
      if (tall > 0.8 && bw > 10 && bh > 10) {
        // a setback tower rising out of the block
        g.fillStyle = 'rgba(2, 3, 8, 0.5)';
        g.fillRect(bx + bw * 0.25 + 3, by + bh * 0.25 + 3, bw * 0.5, bh * 0.5);
        g.fillStyle = rgb(mix([19, 26, 46], [70, 62, 70], L));
        g.fillRect(bx + bw * 0.25, by + bh * 0.25, bw * 0.5, bh * 0.5);
        g.fillStyle = `rgba(243, 206, 128, ${0.08 + L * 0.5})`;
        g.fillRect(bx + bw * 0.5 - 0.8, by + bh * 0.5 - 0.8, 1.6, 1.6); // the beacon on its crown
      }
      // lit windows seen from above: skylights and the odd lit roof
      const p = 0.03 + L * 0.55;
      for (let yy = by + 3; yy < by + bh - 3; yy += 4) {
        for (let xx = bx + 3; xx < bx + bw - 3; xx += 4) {
          if (r() > p) continue;
          const warm = r() < (L > 0.3 ? 0.88 : 0.35);
          g.fillStyle = warm ? `rgba(243, 206, 128, ${0.35 + r() * 0.6 * (0.4 + L)})` : `rgba(160, 190, 230, ${0.2 + r() * 0.3})`;
          g.fillRect(xx, yy, 1.5, 1.5);
        }
      }
    }
  }

  function compass(g, x, y, R) {
    g.save();
    g.translate(x, y);
    g.strokeStyle = 'rgba(230, 195, 110, 0.55)'; g.lineWidth = 0.8;
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, R * 0.78, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 4; i++) {
      g.rotate(Math.PI / 2);
      g.fillStyle = i === 3 ? 'rgba(243, 216, 138, 0.9)' : 'rgba(230, 195, 110, 0.45)';
      g.beginPath(); g.moveTo(0, -R * 1.25); g.lineTo(R * 0.16, 0); g.lineTo(-R * 0.16, 0); g.closePath(); g.fill();
    }
    g.rotate(Math.PI / 4);
    g.fillStyle = 'rgba(230, 195, 110, 0.3)';
    for (let i = 0; i < 4; i++) {
      g.rotate(Math.PI / 2);
      g.beginPath(); g.moveTo(0, -R * 0.75); g.lineTo(R * 0.1, 0); g.lineTo(-R * 0.1, 0); g.closePath(); g.fill();
    }
    g.restore();
    g.fillStyle = 'rgba(243, 216, 138, 0.9)';
    g.font = `500 ${R * 0.42}px "Jost", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.fillText('N', x, y - R * 1.3);
  }

  // A double gold rule around the box with stepped Deco corners, like the frame of a printed city plan.
  function frame(g) {
    const m = 14;
    g.strokeStyle = 'rgba(212, 175, 90, 0.5)'; g.lineWidth = 1;
    g.strokeRect(-m, -m, BW + m * 2, BH + m * 2);
    g.strokeStyle = 'rgba(212, 175, 90, 0.2)';
    g.strokeRect(-m + 5, -m + 5, BW + m * 2 - 10, BH + m * 2 - 10);
    g.fillStyle = 'rgba(230, 195, 110, 0.75)';
    for (const [cx, cy] of [[-m, -m], [BW + m, -m], [-m, BH + m], [BW + m, BH + m]]) {
      g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4);
      g.strokeStyle = 'rgba(230, 195, 110, 0.7)'; g.strokeRect(-6, -6, 12, 12);
      g.fillRect(-3, -3, 6, 6);
      g.restore();
    }
  }

  // nodes: [{ at: [fx, fy], state: 'won' | 'open' | 'locked' | 'soon' }]; area: the screen rectangle (CSS px)
  // the box should fit in. Returns the box: { x, y, s } so that a point at fraction (fx, fy) sits at
  // x + fx * w, y + fy * h on screen.
  function paint(cv, nodes, area) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth || window.innerWidth, H = cv.clientHeight || window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    const s = Math.min(area.w / (BW + 60), area.h / (BH + 60));
    const ox = area.x + (area.w - BW * s) / 2, oy = area.y + (area.h - BH * s) / 2;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#05080f'; g.fillRect(0, 0, W, H);
    g.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    // the visible area in map units
    const vx0 = -ox / s, vy0 = -oy / s, vx1 = (W - ox) / s, vy1 = (H - oy) / s;

    const P = nodes.map((n) => [n.at[0] * BW, n.at[1] * BH]);
    const lights = nodes.map((n) => LIGHT[n.state] || 0);
    const river = RIVER.map(([x, y]) => [x * BW, y * BH]);
    const route = routeOf(nodes);

    // the street grid, each block lit by the district it falls in (its nearest level)
    const r = rng(1931);
    const cols = edges(vx0 - 60, vx1 + 60, 17, 30, 56), rows = edges(vy0 - 60, vy1 + 60, 29, 26, 44);
    for (const [y0, y1] of rows) {
      for (const [x0, x1] of cols) {
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, half = Math.hypot(x1 - x0, y1 - y0) / 2;
        if (lineDist(cx, cy, river) < 22 + half * 0.8) continue;
        let k = 0, best = Infinity;
        for (let i = 0; i < P.length; i++) { const d = Math.hypot(cx - P[i][0], cy - P[i][1]); if (d < best) { best = d; k = i; } }
        if (best < 34 + half * 0.6) continue; // the circus round each level
        // past the edge of the plan the city fades to the dark outskirts
        const out = Math.max(0, -cx, cx - BW, -cy, cy - BH);
        const L = lights[k] * Math.max(0.15, 1 - Math.max(0, best - 150) / 220) * Math.max(0.25, 1 - out / 260);
        block(g, r, x0, y0, x1 - x0, y1 - y0, L);
      }
    }

    // street lamps at every crossing: the whole city glows faintly, the won districts brightly
    g.globalCompositeOperation = 'lighter';
    for (const [, y1] of rows) {
      for (const [, x1] of cols) {
        const x = x1 + 4.5, y = y1 + 4.5;
        if (lineDist(x, y, river) < 26) continue;
        let k = 0, best = Infinity;
        for (let i = 0; i < P.length; i++) { const d = Math.hypot(x - P[i][0], y - P[i][1]); if (d < best) { best = d; k = i; } }
        const L = lights[k] * Math.max(0.1, 1 - Math.max(0, best - 150) / 220), a = 0.12 + L * 0.32;
        const gl = g.createRadialGradient(x, y, 0, x, y, 5 + L * 3);
        gl.addColorStop(0, `rgba(255, 214, 140, ${a})`); gl.addColorStop(1, 'rgba(255, 214, 140, 0)');
        g.fillStyle = gl; g.fillRect(x - 12, y - 12, 24, 24);
      }
    }
    g.globalCompositeOperation = 'source-over';

    // the river, with lamplit embankments
    roundPath(g, river, 60);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(212, 175, 90, 0.28)'; g.lineWidth = 50; g.stroke();
    g.strokeStyle = '#0a1626'; g.lineWidth = 46; g.stroke();
    g.strokeStyle = 'rgba(40, 70, 100, 0.35)'; g.lineWidth = 26; g.stroke();
    // moonlight on the water
    const rr = rng(77);
    g.fillStyle = 'rgba(243, 216, 138, 0.35)';
    for (let i = 0; i < 260; i++) {
      const x = vx0 + rr() * (vx1 - vx0), y = vy0 + rr() * (vy1 - vy0);
      if (lineDist(x, y, river) < 14) g.fillRect(x, y, 2 + rr() * 5, 0.8);
    }

    // the boulevard: a stone casing, the roadway, then a gold centre line that is solid as far as the
    // campaign has reached and dotted beyond
    g.lineCap = 'round'; g.lineJoin = 'round';
    roundPath(g, route, 16);
    g.strokeStyle = 'rgba(0, 0, 0, 0.55)'; g.lineWidth = 26; g.stroke();
    g.strokeStyle = '#28304a'; g.lineWidth = 17; g.stroke();
    g.strokeStyle = '#161d30'; g.lineWidth = 13; g.stroke();
    // level k sits at route[1 + 2k]; the solid line runs up to the first level not yet won
    const reach = nodes.findIndex((n) => n.state !== 'won');
    const cut = reach === -1 ? route.length : 2 + reach * 2;
    const done = route.slice(1, cut), rest = route.slice(cut - 1);
    // where the machines come from: the road in from the west glows ember, cooling toward the first gate
    const ex = Math.max(vx0, -320), eg = g.createLinearGradient(ex, 0, P[0][0], 0);
    eg.addColorStop(0, 'rgba(255, 90, 46, 0.9)'); eg.addColorStop(1, 'rgba(255, 90, 46, 0.1)');
    g.strokeStyle = eg;
    g.beginPath(); g.moveTo(ex, P[0][1]); g.lineTo(P[0][0], P[0][1]);
    g.lineWidth = 7; g.globalAlpha = 0.35; g.stroke();
    g.lineWidth = 1.6; g.globalAlpha = 1; g.stroke();
    if (done.length > 1) roundPath(g, done, 16);
    else { g.beginPath(); g.moveTo(done[0][0], done[0][1]); }
    g.strokeStyle = 'rgba(243, 216, 138, 0.25)'; g.lineWidth = 7; g.stroke();
    g.strokeStyle = 'rgba(243, 216, 138, 0.9)'; g.lineWidth = 1.6; g.stroke();
    if (rest.length > 1) {
      roundPath(g, rest, 16);
      g.setLineDash([3, 7]); g.strokeStyle = 'rgba(212, 175, 90, 0.4)'; g.lineWidth = 1.4; g.stroke(); g.setLineDash([]);
    }

    // a circus round each level, and light pooling over the districts that are lit
    g.globalCompositeOperation = 'lighter';
    nodes.forEach((n, i) => {
      const L = lights[i];
      if (L < 0.3) return;
      const gr = g.createRadialGradient(P[i][0], P[i][1], 0, P[i][0], P[i][1], 170);
      gr.addColorStop(0, `rgba(243, 200, 110, ${0.2 * L})`); gr.addColorStop(1, 'rgba(243, 200, 110, 0)');
      g.fillStyle = gr; g.beginPath(); g.arc(P[i][0], P[i][1], 170, 0, Math.PI * 2); g.fill();
    });
    g.globalCompositeOperation = 'source-over';
    nodes.forEach((n, i) => {
      const L = lights[i];
      g.fillStyle = rgb(mix([14, 19, 34], [38, 40, 56], L));
      g.beginPath(); g.arc(P[i][0], P[i][1], 30, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(212, 175, 90, ${0.2 + L * 0.5})`; g.lineWidth = 1;
      g.beginPath(); g.arc(P[i][0], P[i][1], 30, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(P[i][0], P[i][1], 25, 0, Math.PI * 2); g.stroke();
      // the four streets into the circus
      for (let a = 0; a < 4; a++) {
        const c = Math.cos((a * Math.PI) / 2), sn = Math.sin((a * Math.PI) / 2);
        g.beginPath(); g.moveTo(P[i][0] + c * 30, P[i][1] + sn * 30); g.lineTo(P[i][0] + c * 38, P[i][1] + sn * 38); g.stroke();
      }
    });

    compass(g, 0.05 * BW, 0.1 * BH, 22);
    frame(g);

    // darken the edges of the screen so the plan sits in a pool of light
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = g.createRadialGradient(ox + (BW * s) / 2, oy + (BH * s) / 2, Math.min(W, H) * 0.3, ox + (BW * s) / 2, oy + (BH * s) / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(3, 5, 12, 0)'); v.addColorStop(1, 'rgba(3, 5, 12, 0.8)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    return { x: ox, y: oy, w: BW * s, h: BH * s, s };
  }


  // one line-drawn badge per district for its level marker, keyed by map name: 24-unit SVG paths, stroked
  // in the marker's colour (currentColor), so they follow its won / open / locked state like the numeral did
  const ICONS = {
    'Kingsway Gate': 'M4 21V9h16v12M2.5 9h19M4 6h16l-1-2H5zM9.5 21v-5a2.5 2.5 0 0 1 5 0v5M6.5 12v6M17.5 12v6',
    'Market Square': 'M3 9l2-5h14l2 5M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v9h14v-9M10 21v-5h4v5',
    'Riverside': 'M2 14h20M4 14a8 6 0 0 1 16 0M7 14v-3.5M12 14V8M17 14v-3.5M3 18c2-1.5 4 1.5 6 0s4 1.5 6 0 4 1.5 6 0M5 21.5c2-1.5 4 1.5 6 0s4 1.5 6 0',
    'Tenement Row': 'M3 21V9h5v12M8 21V4h8v17M16 21v-9h5v9M2 21h20M11 7h2M11 10.5h2M11 14h2M5 12h1M5 15.5h1M18 15h1M18 18h1',
    'Kingsway Arcade': 'M2 21h20M3 21V8l9-4 9 4v13M6 21v-6a2 2 0 0 1 4 0v6M14 21v-6a2 2 0 0 1 4 0v6M8 10h8',
    'The Foundry': 'M2 21h20M3 21v-8l5 3v-3l5 3v-3l5 3V4h3v17M7 21v-2h3v2M14 21v-2h3v2M18.5 4c0-1.5 2-1.5 2-3',
    'The Exchange': 'M2 21h20M3 18h18M3 9h18M12 3L3 9h18zM5.5 9.5v8M9.5 9.5v8M14.5 9.5v8M18.5 9.5v8',
    'Ashford Crossing': 'M12 21V10M5 3l14 7M19 3L5 10M8 21h8M10 14h4',
    'Twin Gates': 'M2 21h20M3 21V7l2.5-3L8 7v14M16 21V7l2.5-3L21 7v14M8 11h8M8 15h8M5.5 10v2M18.5 10v2',
    'Power Station': 'M13 2L5 13h6l-1 9 8-12h-6z',
  };
  const icon = (name) => (ICONS[name] ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>` : '');

  return { paint, icon };
})();
