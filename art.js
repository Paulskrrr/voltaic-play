// Voltaic art kit: the machine-age Deco palette, plus the 2D motifs used to paint the ground texture
// and the overlay (light, effects, UI marks). Pure drawing helpers: each takes a 2D context and
// knows nothing about the game state. The 3D models live in models.js.
window.TD_ART = (() => {
  'use strict';

  // Midnight navy, cream and gold, warmed by one ember of signal color.
  const P = {
    night: '#05080f',      // the sky beyond the map
    navy: '#0b1329',       // plaza paving
    navySeam: 'rgba(30, 46, 88, 0.55)',
    navyHi: '#1d2d55',
    terrace: '#1a2b52',
    terraceHi: '#22365f',
    terraceLo: '#0a1328',
    marble: '#0a0d16',     // black marble
    marbleHi: '#1a2131',
    vein: 'rgba(226, 214, 184, 0.16)',
    facade: '#111a33',     // building faces
    facadeHi: '#1e2b50',
    cream: '#efe4c8',
    creamDim: '#b9ab88',
    road: '#cbbb92',       // the boulevard the enemy marches down
    roadLo: '#b4a27a',
    roadHi: '#dccfae',
    gold: '#d4af5a',
    goldHi: '#f3d88a',
    goldLo: '#8c6c2e',
    brass: '#9c7a45',
    gunmetal: '#2a3042',
    ember: '#ff5a2e',      // the signal color: danger, fire, the enemy's eyes
    emberHi: '#ffa25c',
    emberLo: '#a3311b',
    lantern: '#ffcf73',    // lit windows
    coral: '#ff6f61',      // neon, with teal and pink: the colour the night city carries
    teal: '#2ee6cf',
    pink: '#ff4fa8',
    deck: '#0d3540',       // terrace terrazzo
    deckHi: '#135059',
    ice: '#d8ecf0',
    lilac: '#b9a2e6',      // arcane light
    steel: '#9fc8dc',
    pool: '#081127',
    ink: '#070a12',        // outlines
  };

  const TAU = Math.PI * 2;

  function diamond(g, x, y, rx, ry = rx) {
    g.beginPath();
    g.moveTo(x, y - ry); g.lineTo(x + rx, y); g.lineTo(x, y + ry); g.lineTo(x - rx, y);
    g.closePath();
  }

  function polygon(g, x, y, r, n, rot = 0) {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU;
      if (i) g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.closePath();
  }

  // A ">" pointing along angle `ang`.
  function chevron(g, x, y, size, ang, color, w) {
    g.save();
    g.translate(x, y); g.rotate(ang);
    g.beginPath();
    g.moveTo(-size * 0.5, -size); g.lineTo(size * 0.5, 0); g.lineTo(-size * 0.5, size);
    g.strokeStyle = color; g.lineWidth = w; g.lineJoin = 'miter'; g.lineCap = 'butt';
    g.stroke();
    g.restore();
  }

  // Rays fanning from r0 to r1 between angles a0 and a1.
  function sunburst(g, cx, cy, r0, r1, n, a0, a1, color, w) {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? a0 : a0 + ((a1 - a0) * i) / (n - 1);
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    }
    g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'butt';
    g.stroke();
  }

  // Thin pale veins through black marble, clipped to the rectangle.
  function veins(g, x, y, w, h, r, n = 2, color = P.vein) {
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.strokeStyle = color; g.lineWidth = 0.45;
    for (let i = 0; i < n; i++) {
      const sx = x + r() * w, sy = y;
      g.beginPath();
      g.moveTo(sx, sy);
      g.bezierCurveTo(x + r() * w, y + h * 0.35, x + r() * w, y + h * 0.65, x + r() * w, y + h);
      g.stroke();
    }
    g.restore();
  }

  // Soft round light, cached per color as a small sprite so glows cost one drawImage.
  const glowCache = new Map();
  function glowSprite(color) {
    let c = glowCache.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, color + '88');
    grad.addColorStop(1, color + '00');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    glowCache.set(color, c);
    return c;
  }
  // color must be a #rrggbb hex.
  function glow(g, x, y, r, color, alpha = 1) {
    if (r <= 0 || alpha <= 0) return;
    const a = g.globalAlpha;
    g.globalAlpha = a * alpha;
    g.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
    g.globalAlpha = a;
  }

  // Film grain: a tile of soft light and dark specks, returned as a data URL for a CSS overlay.
  function grainURL(size = 160) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() < 0.5 ? 0 : 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.random() * 46;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }

  return { P, TAU, diamond, polygon, chevron, sunburst, veins, glow, grainURL };
})();
