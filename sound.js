// Voltaic sound: every effect is synthesized with Web Audio. The only audio files are the two
// music tracks in music/: one for the home screen and one for play.
// Browsers only allow sound after a click or key press; the context unlocks on the first one.
window.TD_SFX = (() => {
  let ac = null, master = null, musicBus = null;
  const TRACKS = { home: 'music/home.m4a', game: 'music/game.m4a' };
  const MUSIC_VOL = 0.4;
  const tracks = {};
  let want = null, ducked = false;
  const SFX_GAIN = 0.55;
  let muted = false;
  // Slider levels, 0..1. The gain is the square, which sounds closer to even steps.
  const vol = { music: 1, sfx: 1 };
  try {
    muted = localStorage.getItem('tw-muted') === '1';
    for (const k in vol) {
      const v = parseFloat(localStorage.getItem(`tw-vol-${k}`));
      if (Number.isFinite(v)) vol[k] = Math.min(1, Math.max(0, v));
    }
  } catch (e) { /* storage blocked */ }
  const sfxGain = () => (muted ? 0 : SFX_GAIN * vol.sfx * vol.sfx);
  const musicGain = () => (muted ? 0 : vol.music * vol.music);
  const last = {};

  // The sfx graph: voices -> master -> compressor -> out, with two shared sends: a short
  // street-echo reverb (wet) and a soft-clip drive that gives blasts their crunch.
  function buildBus(ctx, dest, gain) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.15;
    const m = ctx.createGain(); m.gain.value = gain;
    m.connect(comp); comp.connect(dest);
    // reverb: decaying stereo noise, darker as it fades, so it reads as brick and wet asphalt
    const len = Math.floor(ctx.sampleRate * 1.3), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len;
        lp += (Math.random() * 2 - 1 - lp) * (0.9 - 0.75 * k);
        d[i] = lp * Math.pow(1 - k, 3) * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
      }
    }
    const rev = ctx.createConvolver(); rev.buffer = ir;
    const revOut = ctx.createGain(); revOut.gain.value = 0.5;
    rev.connect(revOut); revOut.connect(m);
    const drive = ctx.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(x * 3.2) / Math.tanh(3.2); }
    drive.curve = curve; drive.oversample = '2x';
    const driveOut = ctx.createGain(); driveOut.gain.value = 0.7;
    drive.connect(driveOut); driveOut.connect(m);
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return { ctx, master: m, rev, drive, noise: nb };
  }
  let bus = null, live = null;

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    bus = live = buildBus(ac, ac.destination, sfxGain());
    master = bus.master;
    // Music skips the compressor, so cannon fire does not make it pump.
    musicBus = ac.createGain();
    musicBus.gain.value = musicGain();
    musicBus.connect(ac.destination);
    // Hand the already-loaded elements over to Web Audio. A track that is already playing
    // (the browser allowed autoplay) keeps its level, so there is no dip.
    for (const name in tracks) {
      const tr = tracks[name];
      const g = ac.createGain();
      g.gain.value = tr.el.paused ? 0 : trackLevel(name);
      tr.el.volume = 1;
      ac.createMediaElementSource(tr.el).connect(g); g.connect(musicBus);
      tr.g = g;
    }
    applyMusic();
  }
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, init, { capture: true }));

  // Start downloading the music as soon as the page loads, not on the first click, so the
  // menu track can start the moment sound is allowed.
  for (const name in TRACKS) {
    const el = new Audio(TRACKS[name]);
    el.loop = true; el.preload = 'auto';
    tracks[name] = { el, g: null };
  }
  const trackLevel = (name) => (name === want ? MUSIC_VOL * (ducked ? 0.35 : 1) : 0);

  // Per play: start time, pitch and level jitter (so a tower firing all wave is not one
  // sample on repeat) and the sound's reverb send.
  let t0 = 0, pj = 1, vj = 1, send = 0;
  // Route a voice: dry to master, plus the reverb send and, for blasts, the drive.
  function out(node, { wet = 0, drive = false } = {}) {
    node.connect(drive ? bus.drive : bus.master);
    const w = send + wet;
    if (w > 0) { const s = bus.ctx.createGain(); s.gain.value = w; node.connect(s); s.connect(bus.rev); }
  }
  // An envelope gain: quick attack, exponential decay.
  function env(t, dur, vol, attack) {
    const g = bus.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * vj, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  // One oscillator with a pitch slide and a decay envelope; lp puts a lowpass on it.
  function tone(freq, dur, { type = 'square', vol = 0.1, to = null, delay = 0, attack = 0.005, lp = 0, vib = 0, ...o } = {}) {
    const ctx = bus.ctx, t = t0 + delay;
    const osc = ctx.createOscillator(), g = env(t, dur, vol, attack);
    osc.type = type;
    osc.frequency.setValueAtTime(freq * pj, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to * pj), t + dur);
    if (vib) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = 5.5; lg.gain.value = freq * vib;
      l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + dur + 0.02);
    }
    let src = osc;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.7; osc.connect(f); src = f; }
    src.connect(g); out(g, o);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  // Filtered white noise: hiss, thumps, crackle.
  function noise(dur, { vol = 0.2, freq = 1000, to = null, filter = 'lowpass', q = 1, delay = 0, attack = 0.002, ...o } = {}) {
    const ctx = bus.ctx, t = t0 + delay;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = env(t, dur, vol, attack);
    s.buffer = bus.noise;
    f.type = filter; f.Q.value = q;
    f.frequency.setValueAtTime(freq * pj, t);
    if (to) f.frequency.exponentialRampToValueAtTime(Math.max(20, to * pj), t + dur);
    s.connect(f); f.connect(g); out(g, o);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
  }
  // Two-operator FM: electric buzz at high index, metallic ping at low. idx is in carrier
  // multiples and falls to idxTo, so the tone starts gritty and settles.
  function fm(freq, dur, { ratio = 1.4, idx = 2, idxTo = 0.1, vol = 0.08, to = null, delay = 0, attack = 0.003, ...o } = {}) {
    const ctx = bus.ctx, t = t0 + delay, f0 = freq * pj;
    const c = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = env(t, dur, vol, attack);
    c.frequency.setValueAtTime(f0, t); m.frequency.setValueAtTime(f0 * ratio, t);
    if (to) {
      c.frequency.exponentialRampToValueAtTime(Math.max(20, to * pj), t + dur);
      m.frequency.exponentialRampToValueAtTime(Math.max(20, to * pj * ratio), t + dur);
    }
    mg.gain.setValueAtTime(f0 * idx, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1, f0 * idxTo), t + dur);
    m.connect(mg); mg.connect(c.frequency); c.connect(g); out(g, o);
    c.start(t); m.start(t); c.stop(t + dur + 0.02); m.stop(t + dur + 0.02);
  }
  // Struck metal: inharmonic partials (a bar's modes), the high ones dying first.
  function metal(freq, dur, { vol = 0.06, delay = 0, ...o } = {}) {
    [[1, 1, 1], [2.76, 0.5, 0.6], [5.4, 0.28, 0.35], [8.93, 0.15, 0.2]].forEach(([r, a, d]) =>
      tone(freq * r, dur * d, { type: 'sine', vol: vol * a, delay, attack: 0.001, ...o }));
  }
  // A scatter of short grains: debris, gravel, crackle.
  function grit(n, span, { vol = 0.08, freq = 2500, q = 2, filter = 'bandpass', delay = 0, ...o } = {}) {
    for (let i = 0; i < n; i++) noise(0.012 + Math.random() * 0.025, { vol: vol * (0.5 + Math.random() * 0.5), freq: freq * (0.7 + Math.random() * 0.6), q, filter, delay: delay + Math.random() * span, ...o });
  }
  const notes = (list, step, opts) => list.forEach((f, i) => tone(f, step * 1.6, { ...opts, delay: i * step }));

  // A low thump with a fast pitch drop: the body of every blast.
  const kick = (f, to, dur, vol, delay = 0) => tone(f, dur, { type: 'sine', vol, to, delay, attack: 0.002 });

  // name: [min seconds between plays, synth, { jit: pitch jitter (0 for cues), wet: reverb send }]
  const SOUNDS = {
    // Arrow: a pneumatic rivet gun. Tick, a short ring of the barrel, and the puff of the vent.
    rivet:   [0.06, () => { noise(0.012, { vol: 0.2, freq: 4500, filter: 'highpass' }); fm(380, 0.05, { ratio: 2.1, idx: 1.2, vol: 0.05, to: 260 }); noise(0.05, { vol: 0.12, freq: 900, to: 250, delay: 0.004 }); noise(0.1, { vol: 0.022, freq: 3800, filter: 'highpass', delay: 0.025 }); }, { jit: 0.06 }],
    // Cannon: a driven thump with a breech clank behind it.
    cannon:  [0.08, () => { kick(150, 42, 0.32, 0.38); noise(0.28, { vol: 0.32, freq: 1400, to: 90, drive: true }); noise(0.015, { vol: 0.2, freq: 3000, filter: 'highpass' }); metal(210, 0.18, { vol: 0.025, delay: 0.07 }); }, { jit: 0.05, wet: 0.12 }],
    // Mortar (and Quake): deeper, longer, with debris pattering down after.
    mortar:  [0.1,  () => { kick(110, 30, 0.5, 0.42); noise(0.55, { vol: 0.38, freq: 900, to: 50, drive: true }); grit(6, 0.35, { vol: 0.05, freq: 1800, delay: 0.12 }); }, { jit: 0.05, wet: 0.2 }],
    // Cluster bomblets: small dry pops, a string of firecrackers.
    bomblet: [0.05, () => { kick(220, 70, 0.1, 0.2); noise(0.12, { vol: 0.22, freq: 2000, to: 300, drive: true }); }, { jit: 0.12, wet: 0.08 }],
    // Shrapnel: a burst of hard ticks.
    shred:   [0.07, () => { noise(0.07, { vol: 0.3, freq: 1600, to: 400 }); grit(5, 0.06, { vol: 0.14, freq: 4200, q: 4 }); }, { jit: 0.08 }],
    // Mine: a sharp high crack on top of the boom, the tell that it came from below.
    mine:    [0.08, () => { noise(0.03, { vol: 0.25, freq: 2500, filter: 'highpass' }); kick(130, 40, 0.3, 0.35); noise(0.35, { vol: 0.3, freq: 1100, to: 70, drive: true }); grit(4, 0.2, { vol: 0.04, delay: 0.08 }); }, { jit: 0.06, wet: 0.15 }],
    // Frost pulse: a struck ice bell and a falling shimmer.
    frost:   [0.12, () => { metal(1320, 0.5, { vol: 0.035 }); noise(0.35, { vol: 0.05, freq: 9000, to: 2500, filter: 'highpass', attack: 0.02 }); tone(2640, 0.25, { type: 'sine', vol: 0.015, delay: 0.04 }); }, { jit: 0.04, wet: 0.3 }],
    // Tesla: an FM buzz at mains pitch with crackle across it.
    zap:     [0.07, () => { fm(120, 0.14, { ratio: 3.51, idx: 8, idxTo: 1, vol: 0.06, to: 90 }); grit(5, 0.08, { vol: 0.07, freq: 5000, q: 1.5 }); noise(0.04, { vol: 0.1, freq: 3500, filter: 'bandpass', q: 2 }); }, { jit: 0.1, wet: 0.08 }],
    // Sentinel Rifle: a sharp crack, then a short echo off the tenements
    snipe:   [0.06, () => { noise(0.02, { vol: 0.18, freq: 3000, filter: 'highpass' }); noise(0.06, { vol: 0.2, freq: 2600, to: 600 }); kick(180, 60, 0.08, 0.2); noise(0.3, { vol: 0.05, freq: 1200, to: 300, filter: 'bandpass', q: 1.2, delay: 0.11 }); noise(0.3, { vol: 0.025, freq: 900, to: 250, filter: 'bandpass', q: 1.2, delay: 0.24 }); }, { jit: 0.03, wet: 0.15 }],
    // Arc Rail: a capacitor whine snapping into a hard discharge.
    rail:    [0.08, () => { tone(400, 0.09, { type: 'sawtooth', vol: 0.03, to: 2600, lp: 3500 }); fm(900, 0.18, { ratio: 1.5, idx: 4, idxTo: 0.2, vol: 0.06, to: 180, delay: 0.08 }); noise(0.22, { vol: 0.14, freq: 7000, to: 1200, filter: 'highpass', delay: 0.08 }); kick(160, 60, 0.12, 0.15, 0.08); }, { jit: 0.04, wet: 0.12 }],
    // Flamethrower: a gas whoosh with a few spits of crackle.
    flame:   [0.14, () => { noise(0.22, { vol: 0.13, freq: 500, to: 1500, filter: 'bandpass', q: 0.7, attack: 0.03 }); noise(0.2, { vol: 0.06, freq: 200, attack: 0.02 }); grit(3, 0.15, { vol: 0.04, freq: 3000 }); }, { jit: 0.1 }],
    // Prism: it repeats while the beam holds, so a soft beating glass tone, never sharp.
    prism:   [0.35, () => { tone(660, 0.4, { type: 'sine', vol: 0.02, attack: 0.08 }); tone(663, 0.4, { type: 'sine', vol: 0.016, attack: 0.08 }); tone(1320, 0.3, { type: 'triangle', vol: 0.006, attack: 0.08 }); }, { jit: 0.02, wet: 0.25 }],
    // Robot down: a servo whine cut off by a crunch.
    pop:     [0.04, () => { tone(700, 0.07, { type: 'square', vol: 0.03, to: 180, lp: 2400 }); noise(0.05, { vol: 0.12, freq: 1800, filter: 'bandpass', q: 1.5, delay: 0.02 }); metal(900, 0.08, { vol: 0.015, delay: 0.03 }); }, { jit: 0.12 }],
    // Heavy robot down: a scrap pile hitting the road.
    wreck:   [0.08, () => { kick(120, 45, 0.22, 0.3); noise(0.25, { vol: 0.25, freq: 1200, to: 150, drive: true }); metal(160, 0.4, { vol: 0.04, delay: 0.03 }); grit(5, 0.2, { vol: 0.05, freq: 2200, delay: 0.05 }); }, { jit: 0.08, wet: 0.12 }],
    // Flyer down: rotors wind down, then it hits.
    downed:  [0.06, () => { tone(1100, 0.22, { type: 'sawtooth', vol: 0.025, to: 260, lp: 2500 }); noise(0.08, { vol: 0.12, freq: 1400, to: 300, delay: 0.18 }); }, { jit: 0.1 }],
    bossDie: [0.5,  () => { kick(90, 25, 1, 0.4); noise(1.2, { vol: 0.32, freq: 1500, to: 40, drive: true }); metal(110, 1.4, { vol: 0.07, delay: 0.05 }); grit(12, 0.8, { vol: 0.05, delay: 0.2 }); notes([392, 330, 262, 196], 0.11, { type: 'triangle', vol: 0.06, delay: 0.25 }); }, { wet: 0.3 }],
    // Build: the frame drops onto the lot and two bolts go in.
    place:   [0.05, () => { kick(140, 70, 0.14, 0.14); noise(0.1, { vol: 0.16, freq: 800, to: 150 }); metal(520, 0.12, { vol: 0.02, delay: 0.09 }); noise(0.012, { vol: 0.1, freq: 4000, filter: 'highpass', delay: 0.09 }); noise(0.012, { vol: 0.1, freq: 4500, filter: 'highpass', delay: 0.16 }); }, { jit: 0.03, wet: 0.06 }],
    upgrade: [0.1,  () => { notes([523, 659, 784], 0.06, { type: 'triangle', vol: 0.07 }); fm(1568, 0.4, { ratio: 3.5, idx: 1.2, idxTo: 0.05, vol: 0.025, delay: 0.18 }); }, { wet: 0.15 }],
    sell:    [0.1,  () => { metal(1480, 0.25, { vol: 0.04 }); metal(1975, 0.35, { vol: 0.04, delay: 0.07 }); }, { wet: 0.12 }],
    // Wave start: a factory whistle, two pipes a fourth apart.
    horn:    [0.3,  () => { tone(196, 0.5, { type: 'sawtooth', vol: 0.05, attack: 0.06, lp: 1100, vib: 0.006 }); tone(262, 0.55, { type: 'sawtooth', vol: 0.05, attack: 0.06, lp: 1300, vib: 0.006, delay: 0.24 }); noise(0.6, { vol: 0.012, freq: 2500, filter: 'bandpass', q: 2, attack: 0.1 }); }, { wet: 0.25 }],
    // Boss wave: an air-raid siren drone, two saws a hair apart over a sub.
    boss:    [1,    () => { tone(98, 1.4, { type: 'sawtooth', vol: 0.055, attack: 0.25, to: 130, lp: 900 }); tone(99.5, 1.4, { type: 'sawtooth', vol: 0.05, attack: 0.25, to: 132, lp: 900 }); kick(55, 40, 1.2, 0.1); }, { wet: 0.3 }],
    coins:   [0.3,  () => { [1568, 1976, 2349, 3136].forEach((f, i) => metal(f, 0.25, { vol: 0.03, delay: i * 0.05 })); }, { wet: 0.1 }],
    // Power lost: a brownout, the hum sagging away.
    leak:    [0.15, () => { tone(220, 0.45, { type: 'sawtooth', vol: 0.1, to: 55, lp: 1400 }); fm(110, 0.4, { ratio: 1, idx: 3, idxTo: 0.3, vol: 0.05, to: 40 }); }, { wet: 0.1 }],
    emp:     [0.2,  () => { fm(1600, 0.45, { ratio: 0.5, idx: 5, idxTo: 0.5, vol: 0.06, to: 80 }); noise(0.35, { vol: 0.06, freq: 3000, filter: 'bandpass', q: 6, to: 600 }); }, { jit: 0.05, wet: 0.2 }],
    surge:   [0.6,  () => { kick(70, 30, 1, 0.3); fm(900, 1.1, { ratio: 0.5, idx: 8, idxTo: 0.5, vol: 0.08, to: 50 }); noise(0.9, { vol: 0.09, freq: 4000, filter: 'bandpass', q: 4, to: 300, drive: true }); tone(55, 1.2, { type: 'sawtooth', vol: 0.05, attack: 0.02, to: 40, lp: 700 }); }, { wet: 0.35 }],
    // Mine laid: a clank on the road and an arming beep.
    lay:     [0.2,  () => { metal(380, 0.1, { vol: 0.04 }); noise(0.04, { vol: 0.08, freq: 1500, filter: 'bandpass' }); tone(1760, 0.05, { type: 'square', vol: 0.015, lp: 4000, delay: 0.1 }); }, { jit: 0.05 }],
    // Clock tower: a church bell, one strike with the long hum after.
    clock:   [0.3,  () => { metal(523, 2, { vol: 0.08 }); tone(261, 2.2, { type: 'sine', vol: 0.04, attack: 0.01 }); noise(0.02, { vol: 0.06, freq: 2000, filter: 'bandpass' }); }, { wet: 0.35 }],
    // Chronometer's toll: the same bell a fifth lower, struck twice as hard, with a longer hum.
    toll:    [0.3,  () => { metal(349, 2.8, { vol: 0.1 }); tone(174, 3, { type: 'sine', vol: 0.05, attack: 0.01 }); kick(90, 50, 0.3, 0.08); }, { wet: 0.45 }],
    // Midnight: a great bell, its hum sinking as time stops, then one tick when it starts again.
    midnight: [1,   () => { metal(196, 4, { vol: 0.12 }); tone(98, 3.2, { type: 'sine', vol: 0.07, attack: 0.01, to: 82 }); kick(60, 30, 0.8, 0.14); noise(0.9, { vol: 0.03, freq: 900, filter: 'bandpass', q: 3, to: 200 }); tone(2093, 0.03, { type: 'triangle', vol: 0.03, delay: 3 }); }, { wet: 0.55 }],
    crash:   [0.15, () => { noise(0.45, { vol: 0.25, freq: 3000, to: 200, drive: true }); metal(150, 0.5, { vol: 0.06 }); metal(233, 0.35, { vol: 0.04, delay: 0.04 }); grit(6, 0.3, { vol: 0.05, delay: 0.05 }); }, { jit: 0.06, wet: 0.15 }],
    split:   [0.12, () => { tone(800, 0.05, { type: 'square', vol: 0.03, to: 1600, lp: 3000 }); tone(1200, 0.06, { type: 'square', vol: 0.025, to: 400, lp: 3000, delay: 0.05 }); noise(0.03, { vol: 0.06, freq: 2500, filter: 'bandpass', delay: 0.05 }); }, { jit: 0.08 }],
    // Robot bombs (Furnace, Bomber, Sapper): a dirtier blast than the city's guns.
    bomb:    [0.15, () => { kick(90, 30, 0.4, 0.36); noise(0.55, { vol: 0.34, freq: 700, to: 60, drive: true }); grit(5, 0.3, { vol: 0.05, freq: 1500, delay: 0.1 }); }, { jit: 0.06, wet: 0.2 }],
    // Sapper planting: a lit fuse.
    sap:     [0.3,  () => { noise(0.6, { vol: 0.05, freq: 5000, filter: 'highpass', attack: 0.03 }); grit(8, 0.55, { vol: 0.04, freq: 6000, q: 3 }); }],
    blink:   [0.15, () => { fm(600, 0.18, { ratio: 2, idx: 3, idxTo: 0.2, vol: 0.04, to: 2400 }); tone(2400, 0.25, { type: 'sine', vol: 0.025, to: 1200, delay: 0.08 }); }, { jit: 0.05, wet: 0.2 }],
    dig:     [0.25, () => { noise(0.25, { vol: 0.12, freq: 300, to: 120 }); grit(7, 0.22, { vol: 0.05, freq: 900, q: 1 }); }, { jit: 0.1 }],
    error:   [0.15, () => { tone(150, 0.08, { vol: 0.06, lp: 1200 }); tone(120, 0.1, { vol: 0.06, lp: 1200, delay: 0.09 }); }],
    click:   [0.03, () => { tone(1500, 0.02, { type: 'triangle', vol: 0.03 }); noise(0.008, { vol: 0.03, freq: 5000, filter: 'highpass' }); }],
    win:     [1,    () => notes([523, 659, 784, 1047, 784, 1047], 0.12, { type: 'triangle', vol: 0.09 }), { wet: 0.2 }],
    lose:    [1,    () => notes([392, 349, 311, 262, 196], 0.18, { type: 'sawtooth', vol: 0.06, lp: 1800 }), { wet: 0.25 }],
  };

  function voice(name, at) {
    const [, fn, o = {}] = SOUNDS[name];
    const j = o.jit || 0;
    t0 = at; send = o.wet || 0;
    pj = 1 + (Math.random() * 2 - 1) * j; vj = 1 - Math.random() * j;
    fn();
  }
  function play(name) {
    if (!ac || muted || ac.state !== 'running') return;
    const s = SOUNDS[name];
    if (!s) return;
    const now = ac.currentTime;
    if (last[name] !== undefined && now - last[name] < s[0]) return;
    last[name] = now;
    bus = live; voice(name, now);
  }
  // Dev: render sounds offline, one after another, into an AudioBuffer (dev/sounds.html).
  async function bounce(names = Object.keys(SOUNDS), gap = 1) {
    const sr = 44100, ctx = new OfflineAudioContext(2, Math.ceil(sr * (names.length * gap + 1.5)), sr);
    const keep = bus;
    bus = buildBus(ctx, ctx.destination, SFX_GAIN);
    names.forEach((n, i) => { if (SOUNDS[n]) voice(n, 0.05 + i * gap); });
    bus = keep;
    return ctx.startRendering();
  }

  // Fade the wanted track in and the others out. Faded-out tracks pause where they are.
  function applyMusic() {
    if (!ac) {
      // No click yet. Some browsers still allow autoplay (for sites you visit often); try it
      // with the element's own volume until Web Audio takes over.
      for (const name in tracks) {
        const { el } = tracks[name];
        if (name === want) {
          el.volume = Math.min(1, trackLevel(name) * musicGain());
          if (el.paused) el.play().catch(() => {});
        } else if (!el.paused) el.pause();
      }
      return;
    }
    const t = ac.currentTime;
    for (const name in tracks) {
      const { el, g } = tracks[name];
      const on = name === want;
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(trackLevel(name), t, on ? 0.6 : 0.4);
      clearTimeout(el._stop);
      if (on) { if (el.paused) el.play().catch(() => {}); }
      else if (!el.paused) el._stop = setTimeout(() => el.pause(), 2500);
    }
  }
  // name: 'home', 'game' or null. duck: play quieter (game paused). Cheap to call every frame.
  function music(name, duck = false) {
    if (name === want && duck === ducked) return;
    want = name; ducked = duck;
    applyMusic();
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('tw-muted', m ? '1' : '0'); } catch (e) { /* storage blocked */ }
    applyLevels();
  }
  function applyLevels() {
    if (!ac) { applyMusic(); return; }
    if (master) master.gain.setTargetAtTime(sfxGain(), ac.currentTime, 0.02);
    if (musicBus) musicBus.gain.setTargetAtTime(musicGain(), ac.currentTime, 0.05);
  }
  // kind: 'music' or 'sfx'; v: 0..1
  function setVolume(kind, v) {
    if (!(kind in vol)) return;
    vol[kind] = Math.min(1, Math.max(0, v));
    try { localStorage.setItem(`tw-vol-${kind}`, String(vol[kind])); } catch (e) { /* storage blocked */ }
    applyLevels();
  }

  return { play, bounce, names: () => Object.keys(SOUNDS), music, setMuted, setVolume, get muted() { return muted; }, volume: (kind) => vol[kind] };
})();
