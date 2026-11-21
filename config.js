// Voltaic balance sheet.
// Every number that affects difficulty lives here so tuning never means digging through game.js.
// Units: distances in tiles, speeds in tiles/second, rate in shots/second, durations in seconds.
window.TD_CONFIG = {
  TILE: 32,
  START_GOLD: 300,
  START_LIVES: 20,
  SELL_RATE: 0.6,

  // How terrain changes what you can build and how towers perform.
  // The keys are the mechanics (hill = high ground, forest = sight-blocker); the names are what the city shows.
  TERRAIN: {
    grass:   { name: 'Plaza',       build: true,  desc: 'Open paving. Build anything here.' },
    hill:    { name: 'Terrace',     build: true,  rangeBonus: 0.3,
               desc: 'High ground. Towers gain +30% range; a tower stands wholly on a terrace or wholly off it.' },
    forest:  { name: 'Tenements',   build: false, blocksSight: true,
               desc: 'Tall blocks that cut line of sight to ground enemies. Mortars and railguns fire over them. They cannot be built on or torn down.' },
    rock:    { name: 'Monolith',    build: false, noBuild: 'Nothing can be built here.', desc: 'Solid black marble.' },
    water:   { name: 'Reflecting pool', build: false, noBuild: 'Nothing can be built here.', desc: 'Flyers do not care.' },
    path:    { name: 'Boulevard',   build: false, desc: 'The enemy route.' },
    walk:    { name: 'Promenade',   build: false, desc: 'Public paving. On maps with building lots, only the lots and terraces can be built on.' },
  },

  // Interactions between towers and status effects.
  COMBO: {
    shatter: 0.4,       // physical hits on chilled enemies deal +40%
    steamPenalty: 0.7,  // Frost Spire and Flamethrower touching each other: both work at 70%
    takenCap: 0.6,      // Cryo brittle + Mag Rail vuln add up to at most +60% damage taken
    bossStun: 0.3,      // bosses are stunned for 30% of a stun's duration
    knockbackBoss: 0.25, // bosses are knocked back 25% as far
    knockbackCooldown: 3, // seconds before the same enemy can be knocked back again (at 1 s a Concussion Bombard out-pushed an Ironclad's 0.55 tiles/s walk)
    sideBoost: 0.25,    // a side path may raise the main path's dmg × rate by at most 25%
    bossCullGap: 3,     // Sentinel Rifle: a boss takes an Executioner cull at most once per 3 s, from all rifles
    sniperStunGap: 2,   // Sentinel Rifle: a foe a rifle stunned can't be stunned by a rifle again for 2 s after
    ampCap: { dmg: 1.2, rate: 0.6, range: 0.5 }, // all Amplifier bonuses on one tower add up to at most this
    bankCap: 1.5,       // the most gold Banks add in one wave (every Bank effect together), × that wave's clear bonus
  },

  // Four damage types against two enemy defenses:
  //   physical — reduced by armor (flat, per hit, never below 20%)
  //   magic    — reduced by magic defense (a percentage)
  //   fire     — ignores both defenses, but comes as weak damage over time
  //   electric — +40% against anything with armor, reduced by magic defense
  DAMAGE: {
    physical: { name: 'Physical', short: 'PHY', color: '#efe4c8', minShare: 0.2 },
    magic:    { name: 'Magic',    short: 'MAG', color: '#b9a2e6' },
    fire:     { name: 'Fire',     short: 'FIRE', color: '#ff7a52' },
    electric: { name: 'Electric', short: 'ELEC', color: '#9fc8dc', vsArmor: 1.4 },
  },

  // Upgrade-path archetypes (docs/upgrades.md): role colours for the upgrade panel and the tower accents.
  // Kept apart from the DAMAGE colours, which mark damage, not role.
  ARCH: {
    precision:   { name: 'Precision',   color: '#c8413a' },
    barrage:     { name: 'Barrage',     color: '#e0a030' },
    engineering: { name: 'Engineering', color: '#4fa08a' },
  },

  AUTO_WAVE_DELAY: 3,   // seconds after a wave is cleared before auto-start sends the next one

  // Every tower (docs/upgrades.md): base (what you place) + paths { P precision, B barrage, E engineering }, 4 tiers each.
  // Each tier lists cost, desc (one-line UI text), an optional signature name, and only the stats it changes.
  // One main path can reach T4, one side path T2, the third stays locked.
  TOWERS: {
    arrow: {
      name: 'Rivet Gun', key: '1', cost: 50, shape: [[0, 0]], kind: 'projectile', air: true, dmgType: 'physical',
      color: '#d0844a', role: 'Cheap, anti-air',
      blurb: 'Fires rivets at one target. Cheap, and hits flyers.',
      base: { dmg: 8, rate: 1.5, range: 3.0, projSpeed: 11 },
      // Precision keeps its range at or below 5.6: map-wide range belongs to the Sentinel Rifle.
      paths: {
        P: { name: 'Spike Driver', arch: 'precision', desc: 'Heavy single shots. Sees invisible enemies. At T4 it finishes off weak enemies.',
             tiers: [{ cost: 30, desc: 'Heavier shots', dmg: 18, rate: 1.2, range: 3.8, projSpeed: 15 },
                     { cost: 60, desc: 'Sees invisible enemies', dmg: 30, range: 4.4, seesStealth: true },
                     { cost: 110, desc: 'Range 5', dmg: 55, rate: 1.0, range: 5.0, projSpeed: 18 },
                     { cost: 200, desc: 'Kills enemies below 20% HP, ×2 damage to bosses', name: 'Deadeye', dmg: 85, range: 5.6, execute: 0.2, bossMul: 2 }] },
        B: { name: 'Riveter', arch: 'barrage', desc: 'Fast fire against swarms.',
             tiers: [{ cost: 30, desc: 'Faster fire', dmg: 9, rate: 2.6 },
                     { cost: 60, desc: 'Rate 3.6', dmg: 10, rate: 3.6, range: 3.1 },
                     { cost: 110, desc: 'Rate 4.8', dmg: 12, rate: 4.8 },
                     { cost: 200, desc: 'Rivets bounce to 2 more enemies', name: 'Ricochet', dmg: 14, rate: 5.5, bounce: { n: 2, reach: 1.5, falloff: 0.7 } }] },
        E: { name: 'Flak', arch: 'engineering', desc: 'Cheap anti-air. Shots burst and hit nearby flyers.',
             tiers: [{ cost: 30, desc: '×1.5 damage to flyers', airMul: 1.5 },
                     { cost: 60, desc: 'Shots splash nearby flyers', dmg: 12, flak: 0.8 },
                     { cost: 110, desc: 'Targets flyers first', dmg: 18, rate: 1.8, range: 3.8, flak: 1.0, prefersAir: true },
                     { cost: 200, desc: 'Bursts slow flyers by 40%', name: 'Skyscreen', dmg: 24, flak: 1.2, airSlow: { slow: 0.6, dur: 1.5 } }] },
      },
    },
    cannon: {
      name: 'Bombard', key: '2', cost: 110, shape: [[0, 0], [1, 0], [0, 1], [1, 1]], kind: 'splash', air: false,
      dmgType: 'physical', color: '#7d8494', role: 'Groups',
      blurb: '2×2 footprint. Splash damage, ground only.',
      base: { dmg: 22, rate: 0.6, range: 3.0, splash: 0.9, projSpeed: 7 },
      // no rapid-fire path: every Bombard path keeps rate at or below 0.8
      paths: {
        P: { name: 'Howitzer', arch: 'precision', desc: 'Slow, heavy shells for armored enemies and bosses.',
             tiers: [{ cost: 65, desc: 'Heavy shell, ignores 3 armor', dmg: 40, splash: 0.7, pierce: 3 },
                     { cost: 130, desc: 'Ignores 5 armor', dmg: 70, rate: 0.55, range: 3.4, pierce: 5 },
                     { cost: 240, desc: 'Ignores 8 armor', dmg: 130, rate: 0.5, range: 3.6, splash: 0.8, pierce: 8 },
                     { cost: 440, desc: 'Ignores all armor, ×2 damage to bosses', name: 'Breacher', dmg: 220, ignoreArmor: true, bossMul: 2 }] },
        B: { name: 'Mortar', arch: 'barrage', desc: 'Long range and wide splash. Fires over tenements.',
             tiers: [{ cost: 65, desc: 'Fires over tenements', dmg: 30, range: 3.6, splash: 1.2, arc: true, ignoreForest: true, minRange: 1.2, projSpeed: 6 },
                     { cost: 130, desc: 'Range 4.5, wider splash', dmg: 44, range: 4.5, splash: 1.4 },
                     { cost: 240, desc: 'Range 5.5', dmg: 70, rate: 0.55, range: 5.5, splash: 1.6 },
                     { cost: 440, desc: 'Shells split into 5 bomblets', name: 'Cluster', dmg: 90, range: 6.0, cluster: { n: 5, dmg: 30, splash: 0.8, spread: 2.5 } }] },
        E: { name: 'Concussion', arch: 'engineering', desc: 'Removes armor and knocks enemies back.',
             tiers: [{ cost: 65, desc: 'Each hit removes 1 armor', dmg: 26, shred: 1 },
                     { cost: 130, desc: 'Knocks enemies back, removes 2 armor', rate: 0.7, shred: 2, knockback: 0.4 },
                     { cost: 240, desc: 'Each hit removes 3 armor', dmg: 40, rate: 0.8, splash: 1.2, shred: 3, knockback: 0.6 },
                     { cost: 440, desc: 'Hits slow nearby enemies by 50%', name: 'Seismic', dmg: 55, quake: { slow: 0.5, dur: 1.5, radius: 2.0 } }] },
      },
    },
    frost: {
      name: 'Frost Spire', key: '3', cost: 70, shape: [[0, 0]], kind: 'pulse', air: true, dmgType: 'magic', role: 'Control',
      color: '#cfe3ea',
      blurb: 'Pulses slow (chill) every enemy in range. Chilled enemies take +40% physical damage.',
      base: { dmg: 2, rate: 0.8, range: 2.5, slow: 0.55, slowDur: 1.5 },
      paths: {
        P: { name: 'Cryo', arch: 'precision', desc: 'Chilled enemies take more damage. At T4 it freezes the toughest enemy.',
             tiers: [{ cost: 40, desc: 'Chilled enemies take +15% damage', brittle: 0.15 },
                     { cost: 80, desc: 'Chilled: +25% damage taken', dmg: 3, brittle: 0.25, slowDur: 2 },
                     { cost: 150, desc: 'Chilled: +35% damage taken, range 2.8', dmg: 4, range: 2.8, brittle: 0.35 },
                     { cost: 280, desc: 'Every 3s, freezes the toughest enemy for 1.2s', name: 'Flash Freeze', brittle: 0.45, freeze: { every: 3, dur: 1.2 } }] },
        B: { name: 'Blizzard', arch: 'barrage', desc: 'More range. At T4 pulses drop hail.',
             tiers: [{ cost: 40, desc: 'Range 2.9', range: 2.9 },
                     { cost: 80, desc: 'Range 3.3, slow 50%', dmg: 3, range: 3.3, slow: 0.5 },
                     { cost: 150, desc: 'Range 3.7, faster pulses', dmg: 5, range: 3.7, rate: 1.0 },
                     { cost: 280, desc: 'Each pulse drops 5 hailstones on enemies', name: 'Hailstorm', dmg: 6, hail: { n: 5, dmg: 8 } }] },
        E: { name: 'Permafrost', arch: 'engineering', desc: 'Stronger, longer slows. At T4 ground towers can hit chilled flyers.',
             tiers: [{ cost: 40, desc: 'Slow 52%', slow: 0.48 },
                     { cost: 80, desc: 'Slow 58%, lasts 2s', slow: 0.42, slowDur: 2 },
                     { cost: 150, desc: 'Slow 64%, range 2.8', slow: 0.36, slowDur: 2.5, range: 2.8 },
                     { cost: 280, desc: 'Ground-only towers can hit chilled flyers', name: 'Iced Wings', grounds: 3 }] },
      },
    },
    tesla: {
      name: 'Tesla Coil', key: '4', cost: 130, shape: [[0, 0], [0, 1], [1, 1]], kind: 'chain', air: true,
      dmgType: 'electric', color: '#c98a52', role: 'Crowds, armor',
      blurb: 'L-shaped. Lightning jumps between enemies and deals +40% to armored ones.',
      // falloff = damage kept on each jump of the chain
      base: { dmg: 14, rate: 0.9, range: 3.0, chains: 2, chainRange: 1.8, falloff: 0.85 },
      paths: {
        P: { name: 'Lightning Rod', arch: 'precision', desc: 'One heavy bolt, stronger against armor. At T4 every 4th bolt deals ×4.',
             tiers: [{ cost: 80, desc: 'Heavier bolt, jumps once', dmg: 24, chains: 1, range: 3.4 },
                     { cost: 160, desc: '+6% damage per point of armor', dmg: 38, rate: 0.85, range: 3.8, conduct: 0.06 },
                     { cost: 290, desc: 'No jumps, +9% per point of armor', dmg: 60, chains: 0, rate: 0.8, range: 4.2, conduct: 0.09 },
                     { cost: 520, desc: 'Every 4th bolt hits the toughest enemy for ×4', name: 'Thunderstroke', dmg: 85, range: 4.6, conduct: 0.1, strike: { every: 4, mul: 4 } }] },
        B: { name: 'Storm', arch: 'barrage', desc: 'Bolts jump through crowds. At T4 kills fire extra bolts.',
             tiers: [{ cost: 80, desc: 'Jumps to 4 more', dmg: 16, chains: 4, chainRange: 2.0 },
                     { cost: 160, desc: 'Jumps to 6', dmg: 20, rate: 1.0, chains: 6, chainRange: 2.2 },
                     { cost: 290, desc: 'Jumps to 8, loses less per jump', dmg: 28, rate: 1.1, range: 3.4, chains: 8, chainRange: 2.4, falloff: 0.92 },
                     { cost: 520, desc: 'Each kill fires up to 2 extra bolts', name: 'Chain Reaction', dmg: 34, rate: 1.2, chains: 10, reaction: { n: 2, mul: 0.6 } }] },
        E: { name: 'Ionise', arch: 'engineering', desc: 'Hits permanently lower magic defense. At T4 they switch off enemy abilities.',
             tiers: [{ cost: 80, desc: 'Each hit: −5% magic defense', dmg: 18, ionise: 0.05 },
                     { cost: 160, desc: 'Each hit: −7% magic defense', dmg: 22, chains: 3, range: 3.2, ionise: 0.07 },
                     { cost: 290, desc: 'Each hit: −10% magic defense', dmg: 28, chains: 4, chainRange: 2.0, ionise: 0.10 },
                     { cost: 520, desc: 'Hit enemies lose auras and abilities for 3s', name: 'Jammer', dmg: 34, jam: { dur: 3 } }] },
      },
    },
    rail: {
      name: 'Railgun', key: '5', cost: 150, shape: [[0, 0], [1, 0]], kind: 'beam', air: true, directional: true,
      dmgType: 'electric', color: '#7fb8a8', ignoreForest: true, role: 'Long lines',
      blurb: '2×1, fires in one direction. Hits every enemy in its line and fires over tenements. Can\'t hit invisible enemies unless revealed.',
      base: { dmg: 60, rate: 0.35, range: 6, width: 0.4 },
      paths: {
        P: { name: 'Gauss', arch: 'precision', desc: 'Huge damage down a longer line.',
             tiers: [{ cost: 90, desc: 'Heavier shot', dmg: 100, range: 7 },
                     { cost: 180, desc: 'Range 8', dmg: 160, rate: 0.33, range: 8 },
                     { cost: 330, desc: 'Range 9', dmg: 260, range: 9 },
                     { cost: 600, desc: 'Charges while idle, up to ×3 damage', name: 'Capacitor', dmg: 420, range: 10, charge: { perSec: 0.5, max: 3 } }] },
        B: { name: 'Arc Rail', arch: 'barrage', desc: 'Shots leave an electric strip on the road that damages enemies on it.',
             tiers: [{ cost: 90, desc: 'Shots leave a damaging strip', dmg: 70, trail: { dps: 8, dur: 2, width: 0.5 } },
                     { cost: 180, desc: 'Strip deals more, lasts longer', rate: 0.4, trail: { dps: 14, dur: 3 } },
                     { cost: 330, desc: 'Strip 24/s for 4s', dmg: 100, trail: { dps: 24, dur: 4 } },
                     { cost: 600, desc: 'Strip zaps nearby enemies, flyers too', name: 'Third Rail', trail: { dps: 32, dur: 6, arc: { dmg: 26, every: 0.5, reach: 1.0, chains: 2 } } }] },
        E: { name: 'Mag Rail', arch: 'engineering', desc: 'Shots slow every enemy in the line and make them take more damage.',
             tiers: [{ cost: 90, desc: 'Hits slow by 30%', dmg: 65, slow: 0.7, slowDur: 1.5 },
                     { cost: 180, desc: 'Slow 40%', rate: 0.4, slow: 0.6, slowDur: 2 },
                     { cost: 330, desc: 'Hit enemies take +10% damage', dmg: 90, slow: 0.5, slowDur: 2.5, vuln: 0.1 },
                     { cost: 600, desc: 'Stuns every enemy in the line for 1s', name: 'Mag Lock', dmg: 120, stun: 1.0, vuln: 0.2 }] },
      },
    },
    flame: {
      name: 'Flamethrower', key: '6', cost: 90, shape: [[0, 0]], kind: 'cone', air: false, directional: true,
      dmgType: 'fire', color: '#ff6a3d', role: 'Ignores defenses',
      blurb: 'Sprays a cone in one direction. Fire ignores armor and magic defense, but removes chill.',
      base: { dmg: 3, rate: 8, range: 2.5, cone: 35, burn: 4, burnDur: 2 },
      paths: {
        P: { name: 'Blowtorch', arch: 'precision', desc: 'A narrow, hotter jet. At T4 burns remove armor.',
             tiers: [{ cost: 50, desc: 'Narrower, hotter jet', dmg: 5, cone: 25, burn: 6 },
                     { cost: 110, desc: 'Range 2.8, burns 9/s', dmg: 7, range: 2.8, burn: 9 },
                     { cost: 200, desc: 'Burns 14/s for 3s', dmg: 11, range: 3.1, burn: 14, burnDur: 3 },
                     { cost: 360, desc: 'Burns remove 1.5 armor/s, ×1.5 damage to bosses', name: 'Thermite', dmg: 18, melt: 1.5, bossMul: 1.5 }] },
        B: { name: 'Dragon', arch: 'barrage', desc: 'A wide cone that hits flyers. At T4 fire spreads.',
             tiers: [{ cost: 50, desc: 'Wider cone', cone: 50 },
                     { cost: 110, desc: 'Hits flyers', dmg: 4, cone: 60, air: true },
                     { cost: 200, desc: 'Very wide cone, burns 8/s', dmg: 5, cone: 75, range: 2.8, burn: 8 },
                     { cost: 360, desc: 'Burning enemies set enemies next to them on fire', name: 'Firestorm', dmg: 10, burn: 16, spread: { reach: 1.0, every: 0.5 } }] },
        E: { name: 'Napalm', arch: 'engineering', desc: 'Burns that slow. At T4 it leaves fire on the road.',
             tiers: [{ cost: 50, desc: 'Burns last 3s', burnDur: 3 },
                     { cost: 110, desc: 'Burning enemies move 20% slower', burn: 6, burnSlow: 0.8 },
                     { cost: 200, desc: 'Slow 30%, burns 4s', dmg: 4, burn: 8, burnDur: 4, burnSlow: 0.7, range: 2.8 },
                     { cost: 360, desc: 'Leaves the road on fire for 3s', name: 'Firewall', burn: 10, pool: { dps: 10, dur: 3 } }] },
      },
    },
    amp: {
      name: 'Amplifier', key: '7', cost: 80, shape: [[0, 0]], kind: 'support', air: false, dmgType: 'none',
      color: '#e6c36e', role: 'Support',
      blurb: 'No attack. Towers touching it deal +20% damage.',
      // boost* = share added to each touching tower; all Amplifier bonuses on one tower sit under COMBO.ampCap
      base: { boostDmg: 0.2 },
      paths: {
        // focus: extra on the touching tower with the most gold spent; overdrive: focus runs `on` s, then rests `off` s
        P: { name: 'Overclock', arch: 'precision', desc: 'Extra boost for the top touching tower (most gold spent). At T4 it runs in bursts.',
             tiers: [{ cost: 50, desc: 'Top tower: +25% damage', focus: { dmg: 0.25 } },
                     { cost: 100, desc: 'Top tower: +40% damage, +10% rate', focus: { dmg: 0.4, rate: 0.1 } },
                     { cost: 180, desc: 'Top tower: +50% damage, +15% rate', focus: { dmg: 0.5, rate: 0.15 } },
                     { cost: 320, desc: 'Top tower: ×2.2 damage for 8s, then 3s off', name: 'Overdrive', focus: { dmg: 1.0, rate: 0.5 }, overdrive: { on: 8, off: 3 } }] },
        // reach: towers within r tiles past the touching ring get mul × the boost; arms: +dmg per tower type boosted
        B: { name: 'Grid', arch: 'barrage', desc: 'Boosts towers that are not touching. At T4, more tower types means more damage.',
             tiers: [{ cost: 50, desc: 'Half boost to towers up to 1 tile further out', reach: { r: 1, mul: 0.5 } },
                     { cost: 100, desc: 'Boost 25%; half boost reaches 1.5 tiles out', boostDmg: 0.25, reach: { r: 1.5 } },
                     { cost: 180, desc: 'Boost 30% damage, +10% rate; 60% of it reaches 2 tiles out', boostDmg: 0.3, boostRate: 0.1, reach: { r: 2, mul: 0.6 } },
                     { cost: 320, desc: '+5% damage per tower type in reach', name: 'Combined Arms', arms: 0.05 }] },
        // grantSight / grantLos: touching towers see invisible foes / fire over tenements
        E: { name: 'Relay', arch: 'engineering', desc: 'Gives touching towers range, then sight.',
             tiers: [{ cost: 50, desc: 'Touching towers: +15% range', boostRange: 0.15 },
                     { cost: 100, desc: 'Touching towers see invisible enemies', boostRange: 0.25, grantSight: true },
                     { cost: 180, desc: '+30% damage, +35% range', boostDmg: 0.3, boostRange: 0.35 },
                     { cost: 320, desc: 'Touching towers fire over tenements (not the Sentinel Rifle)', name: 'Overwatch', boostRange: 0.35, grantLos: true }] },
      },
    },
    prism: {
      name: 'Arcane Prism', key: '8', cost: 140, shape: [[0, 0], [0, 1], [0, 2]], kind: 'focus', air: true,
      dmgType: 'magic', color: '#b9a2e6', role: 'Boss killer',
      blurb: '1×3. Its beam gets stronger the longer it stays on one target (ramp).',
      // dmg is damage per second at base power; power climbs to rampMax× over rampTime seconds on one target
      base: { dmg: 7, range: 3.2, rampMax: 4, rampTime: 3 },
      paths: {
        P: { name: 'Lance', arch: 'precision', desc: 'Higher ramp. At T4 a kill keeps part of it.',
             tiers: [{ cost: 80, desc: 'Ramps to ×5', dmg: 10, rampMax: 5 },
                     { cost: 170, desc: 'Ramps to ×7, range 3.5', dmg: 13, range: 3.5, rampMax: 7, rampTime: 3.5 },
                     { cost: 310, desc: 'Ramps to ×9', dmg: 18, range: 3.8, rampMax: 9 },
                     // carry: share of the ramp a kill passes on to the next target (it still resets if the target walks out)
                     { cost: 560, desc: 'A kill keeps 60% of the ramp for the next target', name: 'Afterglow', dmg: 28, rampMax: 10, carry: 0.6 }] },
        B: { name: 'Spectrum', arch: 'barrage', desc: 'More beams. At T4 each beam ramps on its own.',
             tiers: [{ cost: 80, desc: 'Second beam', dmg: 8, beams: 2 },
                     { cost: 170, desc: '3 beams', dmg: 10, beams: 3, range: 3.5 },
                     { cost: 310, desc: '5 beams', dmg: 12, beams: 5, range: 3.8 },
                     // heat: each extra beam's target warms from ×1 to max over time seconds, cools 1.5× as fast unlit
                     { cost: 560, desc: 'Every beam ramps on its own target', name: 'Spectrum', dmg: 16, beams: 7, heat: { max: 3, time: 2.5 } }] },
        E: { name: 'Gravity', arch: 'engineering', desc: 'The beam pulls its target backward. At T4 it pulls nearby enemies together.',
             // drag: tiles/s pulled back along the road, scaled by the ramp; never more than the target's own speed
             tiers: [{ cost: 80, desc: 'Pulls the target back 0.3 tiles/s', dmg: 8, drag: 0.3 },
                     { cost: 170, desc: 'Pulls back 0.5 tiles/s', dmg: 10, range: 3.5, drag: 0.5 },
                     { cost: 310, desc: 'Pulls back 0.8 tiles/s', dmg: 12, range: 3.8, drag: 0.8 },
                     // pull: foes within radius tiles of the target slide toward it along the road at speed tiles/s
                     { cost: 560, desc: 'Pulls nearby enemies into one group', name: 'Singularity', dmg: 14, pull: { radius: 1.5, speed: 1.2 } }] },
      },
    },
    light: {
      name: 'Searchlight', key: '9', cost: 90, shape: [[0, 0]], kind: 'light', air: true, dmgType: 'none', label: 'SPOT',
      color: '#f3e6b8', role: 'Reveal, marks',
      blurb: 'Sweeps a beam around. Lit enemies are revealed and take more damage from all towers for a few seconds.',
      // cone = half-angle of the beam in degrees; sweep = radians per second; mark = extra damage taken while lit
      // (its own multiplier, outside COMBO.takenCap; no tier above 0.5); revealDur = seconds a lit foe stays revealed
      base: { range: 3.5, cone: 20, sweep: 1.0, mark: 0.2, markDur: 2.5, revealDur: 0.3 },
      paths: {
        P: { name: 'Designator', arch: 'precision', desc: 'Narrow beam that stays on the toughest enemy. At T4 all towers target it.',
             tiers: [{ cost: 50, desc: 'Narrow beam, lit enemies take +30%', range: 4.0, cone: 12, mark: 0.3 },
                     // lock: aim at the highest-hp foe in range and light only it; sweep when there is none
                     { cost: 110, desc: 'Stays on the toughest enemy', mark: 0.35, markDur: 3.5, lock: true },
                     { cost: 200, desc: 'Lit enemies take +40%, range 4.6', range: 4.6, mark: 0.4 },
                     // designate: a foe this tower lit outranks every target mode, for every tower in range of it
                     { cost: 360, desc: 'All towers target the lit enemy first', name: 'Designate', mark: 0.5, designate: true }] },
        B: { name: 'Lighthouse', arch: 'barrage', desc: 'Bigger, faster sweep. At T4 it lights its whole range.',
             tiers: [{ cost: 50, desc: 'Range 4.5, faster sweep', range: 4.5, sweep: 1.4 },
                     { cost: 110, desc: 'Range 5.5, wider beam', range: 5.5, cone: 26, sweep: 1.7 },
                     { cost: 200, desc: 'Range 6.5, lit enemies take +25%', range: 6.5, cone: 32, sweep: 2.0, mark: 0.25 },
                     // flood: everything in range is lit at once
                     { cost: 360, desc: 'Lights its whole range at once', name: 'Floodlight', range: 7.0, mark: 0.25, flood: true }] },
        E: { name: 'Observer', arch: 'engineering', desc: 'Lit enemies stay revealed. At T4 towers reach them from farther away.',
             tiers: [{ cost: 50, desc: 'Lit enemies stay revealed 4s', sweep: 1.3, revealDur: 4 },
                     { cost: 110, desc: 'Revealed 8s', range: 4.2, revealDur: 8, markDur: 3.5 },
                     { cost: 200, desc: 'Range 4.8, lit enemies take +30%', range: 4.8, cone: 26, mark: 0.3, sweep: 1.5 },
                     // spotter.range: other towers reach this much farther against foes this tower has marked
                     { cost: 360, desc: 'Towers get +40% range against lit enemies', name: 'Forward Observer', spotter: { range: 0.4 } }] },
      },
    },
    mines: {
      name: 'Mine Layer', key: 'z', cost: 100, shape: [[0, 0], [1, 0]], kind: 'mines', air: false, dmgType: 'physical',
      color: '#b08a4a', role: 'Traps',
      blurb: '2×1. Places mines on the road in range. A mine explodes when a ground enemy walks over it.',
      // rate = mines laid per second; maxMines = how many it keeps on the road at once
      base: { dmg: 45, rate: 0.35, range: 2.6, splash: 0.8, maxMines: 4 },
      paths: {
        P: { name: 'Heavy Charge', arch: 'precision', desc: 'Big mines that ignore armor. At T4 they stick and explode twice.',
             tiers: [{ cost: 60, desc: 'Heavier mines, ignore 3 armor', dmg: 80, pierce: 3 },
                     { cost: 120, desc: 'Ignore 5 armor', dmg: 130, rate: 0.38, pierce: 5 },
                     { cost: 220, desc: 'Ignore 8 armor, bigger blast', dmg: 200, splash: 1.0, pierce: 8 },
                     { cost: 400, desc: 'Mines stick to the enemy and explode twice', name: 'Limpet', limpet: { n: 2, every: 0.8 } }] },
        B: { name: 'Minefield', arch: 'barrage', desc: 'More mines, placed faster. At T4 each blast drops more.',
             tiers: [{ cost: 60, desc: 'Places faster, holds 6', rate: 0.5, maxMines: 6 },
                     { cost: 120, desc: 'Holds 8, range 3', dmg: 55, rate: 0.65, maxMines: 8, range: 3.0 },
                     { cost: 220, desc: 'Holds 10, bigger blasts', dmg: 65, rate: 0.85, maxMines: 10, splash: 1.0 },
                     { cost: 400, desc: 'Each blast drops 2 small mines', name: 'Scatter Charge', dmg: 75, scatter: { n: 2, dmg: 35, splash: 0.7 } }] },
        E: { name: 'Snare', arch: 'engineering', desc: 'Blasts slow and remove armor. At T4 they stun.',
             tiers: [{ cost: 60, desc: 'Blasts slow by 40%', slow: 0.6, slowDur: 1.5 },
                     { cost: 120, desc: 'Blasts remove 1 armor', shred: 1, slowDur: 2 },
                     { cost: 220, desc: 'Slow 50%, remove 2 armor', dmg: 70, rate: 0.45, slow: 0.5, shred: 2, range: 3.0 },
                     { cost: 400, desc: 'Blasts stun ground enemies for 1.5s', name: 'Tanglefoot', stun: 1.5 }] },
      },
    },
    clock: {
      name: 'Clock Tower', key: 'x', cost: 150, shape: [[0, 0], [1, 0], [0, 1], [1, 1]], kind: 'clock', air: true,
      dmgType: 'magic', color: '#e6d3a0', role: 'Stuns crowds',
      blurb: '2×2. Every few seconds it damages and stuns every enemy in range. Bosses take the damage but are not stunned.',
      base: { dmg: 32, rate: 0.2, range: 2.8, stun: 0.6 },
      paths: {
        P: { name: 'Deathwatch', arch: 'precision', desc: 'Gives up crowd stuns for heavy damage to the toughest enemies. At T4 they lose a share of max HP 3s later.',
             tiers: [{ cost: 90, desc: 'Damages only the 3 toughest, 70 damage each', dmg: 70, rate: 0.22, targets: 3 },
                     { cost: 180, desc: 'Damages only the 2 toughest, 130 damage each', dmg: 130, rate: 0.25, targets: 2, stun: 0.8 },
                     { cost: 330, desc: 'Damages only the toughest, 240 damage, stun 1s', dmg: 240, rate: 0.28, targets: 1, stun: 1.0, range: 3.1 },
                     { cost: 600, desc: 'Damaged enemies lose 20% of max HP 3s later (bosses 6%)', name: 'Last Hour', dmg: 400, rate: 0.3, range: 3.4, doom: { delay: 3, share: 0.2, boss: 0.06 } }] },
        B: { name: 'Carillon', arch: 'barrage', desc: 'More range, slows, longer stuns. At T4 damage during a stun is held, then dealt ×1.5.',
             tiers: [{ cost: 90, desc: 'Range 3.2', dmg: 45, range: 3.2 },
                     { cost: 180, desc: 'Hit enemies slowed by 40%', dmg: 70, rate: 0.24, range: 3.5, slow: 0.6, slowDur: 2 },
                     { cost: 330, desc: 'Range 3.9, stun 0.9s', dmg: 100, rate: 0.28, range: 3.9, stun: 0.9 },
                     { cost: 600, desc: 'Damage during the stun is held, then dealt ×1.5', name: 'Stasis', dmg: 130, stun: 1.5, stasis: { mul: 1.5 } }] },
        // stunAdd: seconds added to whatever stun the tower has, so it still pays as a side path to Carillon or Deathwatch.
        // toll: every `every`-th strike stuns `mul` times as long. midnight: the toll stops time instead, for everything
        // within reach × range, flyers and bosses too (bosses for `boss` s), and readies the towers in that circle.
        E: { name: 'Chronometer', arch: 'engineering', desc: 'Longer stuns, and every few hits stuns twice as long. At T4 that hit freezes everything nearby.',
             tiers: [{ cost: 90, desc: 'Stuns +0.3s', stunAdd: 0.3 },
                     { cost: 180, desc: 'Every 4th hit stuns twice as long', stunAdd: 0.6, rate: 0.22, range: 3.0, toll: { every: 4, mul: 2 } },
                     { cost: 330, desc: 'Long stun every 3rd hit; stuns bosses for 30%', stunAdd: 0.9, rate: 0.25, stunBoss: true, toll: { every: 3 } },
                     { cost: 700, desc: 'Every 3rd hit freezes all enemies in 1.5× range for 3s', name: 'Midnight', dmg: 40, midnight: { reach: 1.5, dur: 3, boss: 1.5 } }] },
      },
    },
    barrier: {
      name: 'Barricade', key: 'c', cost: 40, shape: [[0, 0]], kind: 'barrier', air: false, dmgType: 'none', label: 'WALL',
      onPath: true, color: '#c9a65a', role: 'Holds the line',
      blurb: 'Built on the road. Ground enemies stop to break it. Its upgrades are lost when it is destroyed.',
      // hp is the plating; walkers hit it for their threat × √(wave hp multiplier) per second (bosses ×6)
      base: { hp: 320 },
      paths: {
        // guard: share of each blow the plating shrugs off; reflect: share of each blow returned as true damage
        P: { name: 'Bulwark', arch: 'precision', desc: 'More HP. At T4 it reflects damage back.',
             tiers: [{ cost: 25, desc: 'HP 520', hp: 520 },
                     { cost: 50, desc: 'Takes 20% less damage', hp: 900, guard: 0.2 },
                     { cost: 90, desc: 'Takes 30% less damage, HP 1500', hp: 1500, guard: 0.3 },
                     { cost: 160, desc: 'Reflects 80% of damage taken, ignoring armor', name: 'Mirror Plate', hp: 1800, reflect: 0.8 }] },
        // thorns: damage per second to each walker hammering on it; shrapnel: a blast when it falls
        B: { name: 'Spiked', arch: 'barrage', desc: 'Damages enemies attacking it. At T4 it explodes when destroyed.',
             tiers: [{ cost: 25, desc: 'Deals 20/s to attackers', hp: 450, thorns: 20 },
                     { cost: 50, desc: 'Deals 40/s to attackers', hp: 650, thorns: 40 },
                     { cost: 90, desc: 'Deals 70/s to attackers', hp: 900, thorns: 70 },
                     { cost: 160, desc: 'Explodes when destroyed', name: 'Shrapnel', shrapnel: { dmg: 180, radius: 1.6 } }] },
        // regen: plating repaired per second; tar: walkers held at it move at `slow` for dur s;
        // phoenix: once a wave a fallen wall rises again after delay s with hp × its plating
        E: { name: 'Mender', arch: 'engineering', desc: 'Repairs itself and slows attackers. At T4 it rebuilds once a wave.',
             tiers: [{ cost: 25, desc: 'HP 450', hp: 450 },
                     { cost: 50, desc: 'Repairs 8/s', hp: 650, regen: 8 },
                     { cost: 90, desc: 'Repairs 16/s, attackers slowed 40%', hp: 900, regen: 16, tar: { slow: 0.6, dur: 3 } },
                     { cost: 160, desc: 'Rebuilds once a wave at half HP', name: 'Phoenix', phoenix: { delay: 6, hp: 0.5 } }] },
      },
    },
    bank: {
      name: 'Gilded Bank', key: 'v', cost: 120, shape: [[0, 0], [1, 0], [2, 0], [1, 1]], kind: 'bank', air: false,
      dmgType: 'none', label: 'GOLD', color: '#f3d88a', role: 'Economy',
      blurb: 'T-shaped. No attack. Kills in range give extra gold and towers in range sell for more. Bank gold per wave is capped.',
      // bounty = extra share of a kill's bounty; sellBonus = added to the sell rate of towers in range.
      // The best bank counts for each effect, and everything Banks pay sits under COMBO.bankCap.
      base: { range: 3.0, bounty: 0.5, sellBonus: 0.1 },
      paths: {
        // elite: kills with a bounty of min or more (and bosses) pay bonus more; wanted: the wave's toughest
        // non-boss to enter range pays mul × its bounty
        P: { name: 'Bounty Hunter', arch: 'precision', desc: 'More gold from tough enemies. At T4 one enemy per wave pays ×3.',
             tiers: [{ cost: 70, desc: 'Enemies worth 10g+ give 25% more', elite: { min: 10, bonus: 0.25 } },
                     { cost: 140, desc: '50% more', elite: { bonus: 0.5 } },
                     { cost: 260, desc: '75% more, from 8g, range 3.4', elite: { min: 8, bonus: 0.75 }, range: 3.4 },
                     { cost: 480, desc: 'The wave\'s toughest enemy in range pays ×3', name: 'Wanted', wanted: { mul: 3 }, range: 3.8 }] },
        // streak: a kill in range within window s of the last one adds step, up to max
        B: { name: 'Exchange', arch: 'barrage', desc: 'More range, more gold. At T4 quick kills stack a bonus.',
             tiers: [{ cost: 70, desc: 'Range 3.4, +60% gold', range: 3.4, bounty: 0.6 },
                     { cost: 140, desc: 'Range 3.8, +70% gold', range: 3.8, bounty: 0.7 },
                     { cost: 260, desc: 'Range 4.2, +80% gold', range: 4.2, bounty: 0.8 },
                     { cost: 480, desc: 'Each kill within 1.2s of the last: +10%, up to +80%', name: 'Streak', streak: { window: 1.2, step: 0.1, max: 0.8 } }] },
        // interest: share of your gold paid at the end of each wave (WAVES.interestCap); discount: upgrades of
        // towers in range cost this much less
        E: { name: 'Treasury', arch: 'engineering', desc: 'Interest and better resale. At T4 cheaper upgrades.',
             tiers: [{ cost: 70, desc: '3% interest per wave', interest: 0.03, sellBonus: 0.15 },
                     { cost: 140, desc: '5% interest', interest: 0.05, sellBonus: 0.2 },
                     { cost: 260, desc: '7% interest, towers sell for 85%', interest: 0.07, sellBonus: 0.25, range: 3.4 },
                     { cost: 480, desc: 'Upgrades in range cost 12% less', name: 'Wholesale', discount: 0.12, sellBonus: 0.3 }] },
      },
    },
    sniper: {
      name: 'Sentinel Rifle', key: 's', cost: 200, shape: [[0, 0]], kind: 'sniper', air: true, dmgType: 'physical',
      color: '#c9b48a', role: 'Map-wide marksman',
      blurb: 'Hits anywhere on the map, one big shot at a time. Tenements block its shots at ground enemies, not flyers. Can\'t hit invisible enemies unless revealed.',
      // global: reaches the whole map (no range; hill and range boosts add nothing). Ground and air; walkers only along a
      // clear line (tenements block them), flyers anywhere, like every other tower.
      base: { dmg: 100, rate: 0.2, global: true },
      paths: {
        // cull: each hit also takes share (boss: on bosses) of the foe's current hp as true damage; bosses at most
        // once per COMBO.bossCullGap. late: non-boss share × (1 + late × progress), so it doubles at the gate
        P: { name: 'Executioner', arch: 'precision', desc: 'Heavy shots that also take a % of the enemy\'s current HP.',
             tiers: [{ cost: 100, desc: '150 damage', dmg: 150, rate: 0.22 },
                     { cost: 200, desc: 'Also takes 6% of current HP', dmg: 200, cull: { share: 0.06, boss: 0.03 } },
                     { cost: 380, desc: '300 damage, takes 10% of current HP', dmg: 300, rate: 0.25, cull: { share: 0.1, boss: 0.05 } },
                     { cost: 640, desc: 'The % grows to double near the end of the road', name: 'Deadline', dmg: 420, rate: 0.28, cull: { share: 0.12, boss: 0.07, late: 1 } }] },
        // quick: a kill readies the next shot after `delay` s instead of a full reload, up to `max` per reload
        B: { name: 'Rapid Rifle', arch: 'barrage', desc: 'Faster fire, lighter shots.',
             tiers: [{ cost: 100, desc: '0.35 shots/s', dmg: 95, rate: 0.35 },
                     { cost: 200, desc: '0.55 shots/s, lighter shots', dmg: 85, rate: 0.55 },
                     { cost: 380, desc: '0.8 shots/s', dmg: 80, rate: 0.8 },
                     { cost: 640, desc: 'A kill reloads instantly (up to 3 in a row)', name: 'Hair Trigger', rate: 1.0, quick: { max: 3, delay: 0.12 } }] },
        // stun: one foe, then COMBO.sniperStunGap before any rifle stuns it again. interrupt: the stun restarts its
        // ability clock (not bosses). gridlock: a stunned walker blocks the walkers behind it until the stun ends
        E: { name: 'Spotter', arch: 'engineering', desc: 'Short stuns that reset enemy abilities. At T4 a stunned enemy blocks the road.',
             tiers: [{ cost: 100, desc: 'Shots stun 0.4s', stun: 0.4 },
                     { cost: 200, desc: 'Stuns reset the enemy\'s ability timer', dmg: 110, stun: 0.6, interrupt: true },
                     { cost: 380, desc: 'Stun 0.8s', dmg: 130, rate: 0.25, stun: 0.8 },
                     { cost: 640, desc: 'A stunned enemy blocks enemies behind it', name: 'Gridlock', dmg: 150, rate: 0.3, stun: 1.0, gridlock: true }] },
      },
    },
  },

  // threat = how much of a wave's budget one unit uses. gap = seconds between spawns.
  // armor: flat reduction of each physical hit. mdef: share of magic and electric damage blocked (0–0.75).
  // Defenses grow in long games (see WAVES.armorGrowth / mdefPerWave) so every damage type stays needed.
  ENEMIES: {
    grunt:   { name: 'Grunt',     hp: 40,   speed: 1.1, armor: 0, mdef: 0,    bounty: 5,   lives: 1,  threat: 5,   gap: 0.9,  unlock: 1,  size: 7,  color: '#a08a5c' },
    runner:  { name: 'Runner', ability: 'Very fast, but fragile.',    hp: 22,   speed: 2.2, armor: 0, mdef: 0,    bounty: 4,   lives: 1,  threat: 4,   gap: 0.6,  unlock: 2,  size: 6,  color: '#d9b45a', traits: ['Fast'] },
    swarm:   { name: 'Swarmling', ability: 'Arrives in big, tightly packed groups.', hp: 10,   speed: 1.6, armor: 0, mdef: 0,    bounty: 1,   lives: 1,  threat: 1.5, gap: 0.22, unlock: 3,  size: 4,  color: '#b8a878', traits: ['Swarm'] },
    brute:   { name: 'Brute',     hp: 160,  speed: 0.7, armor: 5, mdef: 0,    bounty: 14,  lives: 2,  threat: 14,  gap: 1.5,  unlock: 4,  size: 10, color: '#8a5a3c' },
    hexguard:{ name: 'Hexguard', ability: 'Blocks 65% of magic and electric damage. Use physical towers.',  hp: 100,  speed: 0.9, armor: 0, mdef: 0.65, bounty: 12,  lives: 1,  threat: 11,  gap: 1.2,  unlock: 5,  size: 8,  color: '#7a74b8' },
    flyer:   { name: 'Wyvern', ability: 'Flies straight to the exit, ignoring the road. Only anti-air towers can hit it.',    hp: 45,   speed: 1.4, armor: 0, mdef: 0.15, bounty: 8,   lives: 1,  threat: 8,   gap: 1.0,  unlock: 6,  size: 7,  color: '#d8c9a6', air: true, traits: ['Flying'] },
    ghost:   { name: 'Shade', ability: 'Invisible until a Searchlight or Spike Driver reveals it.',     hp: 55,   speed: 1.3, armor: 0, mdef: 0.3,  bounty: 10,  lives: 1,  threat: 10,  gap: 1.0,  unlock: 8,  size: 7,  color: '#d8d2c0', stealth: true, traits: ['Invisible'] },
    emp:     { name: 'Disruptor', ability: 'Every 5 s, knocks out towers within 2 tiles for 3 s.', hp: 90,   speed: 0.9, armor: 2, mdef: 0.25, bounty: 15,  lives: 2,  threat: 15,  gap: 2.0,  unlock: 11, size: 8,  color: '#6f93b0',
               emp: { every: 5, radius: 2, dur: 3 }, traits: ['EMP'] },
    cloaker: { name: 'Cloaker', ability: 'Turns invisible for 2.5 s out of every 5 s.',   hp: 120,  speed: 1.0, armor: 3, mdef: 0.2,  bounty: 16,  lives: 2,  threat: 15,  gap: 1.3,  unlock: 13, size: 8,  color: '#6f8f80',
               cloak: { every: 5, dur: 2.5 }, traits: ['Cloaks'] },
    shield:  { name: 'Shield Bearer', ability: 'Robots within 1.6 tiles take 30% less damage. Does not shelter other Shield Bearers.', hp: 180, speed: 0.8, armor: 4, mdef: 0.1, bounty: 18, lives: 2, threat: 20, gap: 1.8, unlock: 7, size: 9, color: '#b0904a',
               aegis: { radius: 1.6, cut: 0.3 }, traits: ['Aegis'] }, // bearers cannot shelter each other
    splitter:{ name: 'Gear Splitter', ability: 'Splits into 2 Gear Mites when destroyed.', hp: 140, speed: 0.9, armor: 2, mdef: 0,   bounty: 10,  lives: 1,  threat: 19,  gap: 1.4,  unlock: 9,  size: 9,  color: '#a8884c',
               split: { into: 'mite', n: 2 }, traits: ['Splits'] },
    spotter: { name: 'Spotter Drone', ability: 'Flies. Robots within 1.8 tiles move 25% faster.', hp: 30, speed: 2.0, armor: 0, mdef: 0,  bounty: 7,   lives: 1,  threat: 8,   gap: 0.8,  unlock: 12, size: 5,  color: '#e0c070', air: true, road: true,
               haste: { radius: 1.8, speed: 0.25 }, traits: ['Flying', 'Spots'] },
    sapper:  { name: 'Sapper', ability: 'Stops beside a tower, plants a charge for 1 s, and knocks it out for 6 s.',    hp: 110,  speed: 1.0, armor: 1, mdef: 0.1,  bounty: 14,  lives: 1,  threat: 13,  gap: 1.2,  unlock: 14, size: 7,  color: '#7a6040', atk: 40,
               sap: { range: 1.6, plant: 1.0, dur: 6, every: 7 }, traits: ['Sabotage'] },
    lamp:    { name: 'Lamplighter', ability: 'Robots within 1.8 tiles cannot be slowed or stunned.', hp: 160, speed: 0.85, armor: 2, mdef: 0.3, bounty: 16, lives: 2,  threat: 16,  gap: 1.6,  unlock: 15, size: 8,  color: '#e8b860',
               lamp: { radius: 1.8 }, traits: ['Unslowable'] },
    courier: { name: 'Relay Courier', ability: 'Teleports 3 tiles forward every 8 s.', hp: 70, speed: 1.8, armor: 0, mdef: 0.2,  bounty: 9,   lives: 1,  threat: 9,   gap: 0.9,  unlock: 16, size: 6,  color: '#cfd6e0',
               blink: { every: 8, dist: 3 }, traits: ['Fast', 'Teleports'] },
    mole:    { name: 'Mole Tunneller', ability: 'Burrows for 2 s out of every 5.5 s, out of reach of all towers, and moves faster underground.', hp: 150, speed: 1.0, armor: 4, mdef: 0.1, bounty: 15, lives: 2, threat: 15, gap: 1.5, unlock: 17, size: 8, color: '#8a6a48',
               burrow: { up: 3.5, down: 2, speed: 1.3 }, traits: ['Burrows'] },
    ember:   { name: 'Ember Carrier', ability: 'Explodes when destroyed, scorching towers within 2 tiles for 5 s.', hp: 130, speed: 0.9, armor: 2, mdef: 0.15, bounty: 14, lives: 2, threat: 13, gap: 1.4, unlock: 18, size: 8, color: '#c06030',
               blast: { radius: 2, dur: 5 }, traits: ['Explodes'] },
    bomber:  { name: 'Dirigible', ability: 'Flies. Bombs towers beneath it every 2.5 s, knocking them out for 4 s.', hp: 340,  speed: 0.45, armor: 3, mdef: 0.2, bounty: 34,  lives: 2,  threat: 40,  gap: 3.0,  unlock: 19, size: 13, color: '#d8c9a6', air: true,
               bomb: { every: 2.5, radius: 1.1, dur: 4 }, traits: ['Flying', 'Bombs'] },
    tram:    { name: 'Tram Juggernaut', ability: 'Smashes through barricades without stopping.', hp: 700, speed: 0.45, armor: 10, mdef: 0.25, bounty: 45, lives: 4, threat: 40, gap: 3.0, unlock: 21, size: 13, color: '#5a5e70',
               ram: 450, traits: ['Heavy', 'Rams'] },
    // Late game (waves 22+, Endless beyond 25). Flyers: a cloaker, a troop carrier and a sprinter.
    // cloak on a flyer works like the Cloaker's: hidden until a Searchlight or Spike Driver reveals it.
    moth:    { name: 'Veil Moth', ability: 'Flies. Turns invisible for 2.5 s out of every 6 s.', hp: 60,   speed: 1.5, armor: 0, mdef: 0.25, bounty: 12,  lives: 1,  threat: 11,  gap: 1.0,  unlock: 22, size: 6,  color: '#b9b4d8', air: true,
               cloak: { every: 6, dur: 2.5 }, traits: ['Flying', 'Cloaks'] },
    // drop: from `at` of its flight it lowers `n` of `type` onto the road once it is within `near` tiles of one (by `last`
    // wherever the nearest road is), then flies on
    balloon: { name: 'Troop Balloon', ability: 'Flies. Lowers 3 Grunts onto the road partway through its flight.', hp: 240, speed: 0.6, armor: 1, mdef: 0.1, bounty: 22, lives: 2, threat: 34, gap: 2.2, unlock: 24, size: 11, color: '#c47a5c', air: true,
               drop: { at: 0.35, near: 0.75, last: 0.8, type: 'grunt', n: 3 }, traits: ['Flying', 'Drops troops'] },
    // surge: every `every` s it burns for `dur` s at `mul` times its speed
    hawk:    { name: 'Stormhawk', ability: 'Flies. Every 6 s, an afterburner makes it 1.9x faster for 1.4 s.', hp: 130,  speed: 1.5, armor: 4, mdef: 0.1,  bounty: 18,  lives: 1,  threat: 16,  gap: 1.0,  unlock: 26, size: 8,  color: '#9db4c8', air: true,
               surge: { every: 6, dur: 1.4, mul: 1.9 }, traits: ['Flying', 'Afterburner'] },
    // Ground: a healer, a plated tank and a robot that rises once.
    // mend: robots in `radius` heal `rate` of their max HP per second (a boss a third of that)
    mender:  { name: 'Field Mender', ability: 'Heals robots within 1.8 tiles by 1.5% of their max HP per second (a third of that for bosses).', hp: 220, speed: 0.85, armor: 2, mdef: 0.2, bounty: 20, lives: 2, threat: 22, gap: 1.8, unlock: 23, size: 8, color: '#5fa88a',
               mend: { radius: 1.8, rate: 0.015 }, traits: ['Heals'] },
    // hitCap: no single hit does more than this (damage over time and true damage are not hits)
    ironclad:{ name: 'Ironclad', ability: 'No single hit can deal more than 40 damage. Damage over time still works.', hp: 700,  speed: 0.55, armor: 6, mdef: 0.3,  bounty: 40,  lives: 4,  threat: 44,  gap: 3.0,  unlock: 25, size: 12, color: '#7d8a96',
               hitCap: 40, traits: ['Heavy', 'Plated'] },
    // revive: once, it gets back up with `hp` of its max HP and is stunned `stun` s
    phoenix: { name: 'Phoenix Frame', ability: 'Gets back up once, at 50% HP, stunned for 1.2 s.', hp: 260, speed: 1.0, armor: 3, mdef: 0.25, bounty: 30, lives: 2, threat: 28, gap: 1.6, unlock: 27, size: 9, color: '#d0603a',
               revive: { hp: 0.5, stun: 1.2 }, traits: ['Reboots'] },
    // Endless only (after wave 27): robots that work through the others or against how you aim.
    // escort: the group is spread through the rest of its wave instead of marching as a block (it needs company)
    // salvage: while a Salvager is out, a ground robot that dies leaves scrap on the road for `linger` s. A Salvager
    // that passes within `radius` tiles rebuilds it `delay` s later with `hp` of its max HP, at most `max` times.
    // Killing, jamming or stunning the Salvager stops the rebuild. Rebuilt robots pay no gold and are not salvaged again.
    salvager:{ name: 'Scrap Salvager', ability: 'Rebuilds fallen ground robots from scrap (up to 5 times). They pay no gold. Kill or stun it to stop this.', hp: 320, speed: 0.75, armor: 3, mdef: 0.2, bounty: 28, lives: 2, threat: 28, gap: 2.0, unlock: 28, size: 9, color: '#9a8a5a', escort: true,
               salvage: { radius: 1.2, linger: 8, delay: 2.5, hp: 0.5, max: 5 }, traits: ['Rebuilds'] },
    // mirage: every `every` s it projects `n` hologram copies of itself with `hp` of its max HP that live `life` s.
    // Towers cannot tell them apart and shoot them; a Searchlight's beam pops them. They do no harm if they get through.
    caster:  { name: 'Mirage Caster', ability: 'Every 6 s, projects 2 holograms of itself. Towers shoot them, a Searchlight pops them.', hp: 220, speed: 0.9, armor: 1, mdef: 0.4, bounty: 24, lives: 2, threat: 24, gap: 1.8, unlock: 29, size: 8, color: '#8fb0d8',
               mirage: { every: 6, n: 2, hp: 0.45, life: 9 }, traits: ['Holograms'] },
    // hook: picks up the biggest ground robot within `near` tiles below it and carries it for `carry` s, then sets
    // it down on the road below. While carried, only anti-air can hit the cargo. Shoot the Skyhook down (or jam it)
    // and the cargo falls: `fall` of its max HP lost and stunned `stun` s.
    skyhook: { name: 'Skyhook', ability: 'Flies. Lifts the biggest ground robot below it for 5 s, so only anti-air can hit it. Shooting the Skyhook down drops the cargo.', hp: 300, speed: 0.75, armor: 2, mdef: 0.15, bounty: 30, lives: 2, threat: 30, gap: 2.4, unlock: 31, size: 10, color: '#c8a050', air: true, escort: true,
               hook: { near: 0.9, carry: 5, cd: 2, fall: 0.25, stun: 1.5 }, traits: ['Flying', 'Airlifts'] },
    // only appear when something else spawns them
    hologram:{ name: 'Hologram', hp: 1, speed: 0.9, armor: 1, mdef: 0.4, bounty: 0, lives: 0, threat: 0, gap: 0, unlock: 999, size: 8, color: '#8fb0d8' },
    mite:    { name: 'Gear Mite', hp: 30,   speed: 1.5, armor: 1, mdef: 0,    bounty: 2,   lives: 1,  threat: 0,   gap: 0,    unlock: 999, size: 5, color: '#c4a060' },
    boss:    { name: 'Siege Golem', ability: 'Slow and heavily armoured.', hp: 1100, speed: 0.5, armor: 8, mdef: 0.3, bounty: 120, lives: 10, threat: 0, gap: 3, unlock: 999, size: 14, color: '#6b6380', boss: true, traits: ['Boss'] },
    colossus:{ name: 'Foundry Colossus', ability: 'Calls 2 Gear Mites every 8 s.', hp: 1600, speed: 0.42, armor: 10, mdef: 0.4, bounty: 200, lives: 15, threat: 0, gap: 3, unlock: 999, size: 16, color: '#7a4a38', boss: true,
               spawner: { every: 8, type: 'mite', n: 2 }, traits: ['Boss', 'Spawns mites'] },
    // the finale's boss: at each share of max HP in overload.at it knocks out every tower within overload.radius for
    // overload.dur seconds, calls overload.n escorts of overload.type and runs overload.speed faster for overload.fast
    // seconds. A Jammer hit at that moment makes the surge fizzle: no blast, no escorts, no rush.
    dynamo:  { name: 'Power Colossus', ability: 'At 75%, 50% and 25% HP, knocks out towers within 4.5 tiles for 7 s, calls 3 Disruptors and rushes for 5 s. A Tesla Jammer makes the surge fizzle.', hp: 2100, speed: 0.36, armor: 12, mdef: 0.45, bounty: 300, lives: 20, threat: 0, gap: 3, unlock: 999, size: 18, color: '#3e5a78', boss: true,
               overload: { at: [0.75, 0.5, 0.25], radius: 4.5, dur: 7, type: 'emp', n: 3, speed: 0.6, fast: 5 }, traits: ['Boss', 'Surges'] },
    // a flying boss: it bombs the towers it passes over and launches Wyverns. Only anti-air can touch it.
    citadel: { name: 'Sky Citadel', ability: 'Flies. Bombs the towers it passes over and launches 2 Wyverns every 9 s. Only anti-air can hit it.', hp: 2200, speed: 0.35, armor: 6, mdef: 0.35, bounty: 320, lives: 20, threat: 0, gap: 3, unlock: 999, size: 17, color: '#8a7a9a', boss: true, air: true,
               bomb: { every: 2, radius: 1.5, dur: 5 }, spawner: { every: 9, type: 'flyer', n: 2 }, traits: ['Boss', 'Flying', 'Bombs', 'Launches Wyverns'] },
  },

  WAVES: {
    normalLength: 25,
    bossEvery: 10,
    baseBudget: 30,
    perWave: 18,
    curve: 2.2,          // extra budget growth: + n^1.6 * curve
    groupPause: 1.5,
    debutAirShare: 0.27, // a new flyer's debut group is a smaller slice of the wave (else 0.35): few towers cover the flight line yet
    bonusBase: 20,       // gold at the end of each wave
    bonusPer: 4,
    earlyBase: 10,       // gold for sending a wave while another is still running
    earlyPer: 2,
    hpGrowth: 1.15,      // enemy hp multiplier per wave: hpGrowth^(n-1). Wave 10 ≈ 3.5×, wave 25 ≈ 29×
    endlessGrowth: 1.05, // after the campaign length, hp also grows 5% per wave
    armorGrowth: 0.5,    // endless only: armor grows with (hp multiplier vs. the last campaign wave)^armorGrowth
    mdefPerWave: 0.01,   // after the campaign length, magic defense rises 1 point per wave (capped at 0.75)
    interestCap: 60,     // most gold a Treasury pays in interest at the end of one wave
    // which boss leads a boss wave, in turn: the Golem on wave 10, the Colossus on 20 and 25, the Sky Citadel on 30,
    // the Power Colossus on 40, and so on. The finale's Endless carry-on meets the Citadel on 30 and the Power Colossus again on 40.
    bosses: ['boss', 'colossus', 'citadel', 'dynamo'],
  },

  // The campaign: levels in order. Each plays one map (by name) for `waves` waves with only the listed towers
  // and enemies; boss: false leaves the boss out of the boss waves, bosses: { wave: type } picks the boss waves
  // and who leads them instead of every 10th and the last. `at` is the level's place on the campaign
  // map (0-1 across and down the artwork). Optional: `gold` and `lives` to start with (else START_GOLD and
  // START_LIVES), `debut: { type: wave }` to bring a robot in on another wave than its `unlock`. `soon` marks a
  // level still being designed: it shows on the campaign map with its name and idea but cannot be played.
  // Plan: docs/campaign.md.
  CAMPAIGN: [
    { map: 'Kingsway Gate', at: [0.08, 0.8], waves: 10, boss: false, towers: ['arrow', 'cannon', 'frost'], enemies: ['grunt', 'runner', 'swarm', 'brute'],
      brief: 'Ten waves. Build on the gold-bordered lots, as close to the bends as you can.' },
    { map: 'Market Square', at: [0.26, 0.68], waves: 12, boss: false, towers: ['arrow', 'cannon', 'frost', 'tesla', 'flame'],
      enemies: ['grunt', 'runner', 'swarm', 'brute', 'hexguard'],
      brief: 'Hexguards shrug off magic and lightning, but rivets, shells and flame still bite. The terrace lends range.' },
    { map: 'Riverside', at: [0.15, 0.4], waves: 12, boss: false, towers: ['arrow', 'cannon', 'frost', 'tesla', 'flame', 'rail', 'mines', 'prism'],
      enemies: ['grunt', 'runner', 'swarm', 'brute', 'hexguard', 'flyer'],
      brief: 'Wyverns skip the bridges and fly straight down the river. Something has to look up.' },
    { map: 'Tenement Row', at: [0.34, 0.2], waves: 15, bosses: { 15: 'boss' },
      towers: ['arrow', 'cannon', 'frost', 'tesla', 'flame', 'rail', 'mines', 'prism', 'light', 'sniper', 'clock'],
      enemies: ['grunt', 'runner', 'swarm', 'brute', 'hexguard', 'flyer', 'ghost'],
      brief: 'Tall blocks cut the line of fire and Shades hide in the dark. The first Siege Golem leads wave 15.' },
    { map: 'Kingsway Arcade', at: [0.48, 0.44], waves: 15, towers: ['arrow', 'cannon', 'frost', 'tesla', 'flame', 'rail', 'mines', 'prism',
      'light', 'sniper', 'clock', 'amp', 'bank', 'barrier'],
      enemies: ['grunt', 'runner', 'swarm', 'brute', 'hexguard', 'flyer', 'ghost', 'shield', 'splitter'],
      brief: 'Few lots, and every tower is yours. Stand towers together so they help each other, and block the road.' },
    { map: 'The Foundry', at: [0.6, 0.72], waves: 18, towers: ['arrow', 'cannon', 'frost', 'tesla', 'flame', 'rail', 'mines', 'prism',
      'light', 'sniper', 'clock', 'amp', 'bank', 'barrier'],
      enemies: ['grunt', 'runner', 'swarm', 'brute', 'hexguard', 'flyer', 'ghost', 'shield', 'splitter', 'emp', 'spotter'],
      brief: 'Flame and beams want long straights. Disruptors punish a crowd of towers.' },
    { map: 'The Exchange', at: [0.8, 0.8], waves: 18, gold: 180, debut: { cloaker: 8, sapper: 10 },
      towers: ['arrow', 'cannon', 'frost', 'tesla', 'flame', 'rail', 'mines', 'prism',
      'light', 'sniper', 'clock', 'amp', 'bank', 'barrier'],
      enemies: ['grunt', 'runner', 'swarm', 'brute', 'hexguard', 'flyer', 'ghost', 'shield', 'splitter', 'emp', 'spotter', 'cloaker', 'sapper'],
      brief: 'Little gold, and a road that coils into the trading pit and back out. Hold the first waves, then let a Bank in the vault at the heart of the coil pay for the rest. Sappers sabotage towers next to the road, and Cloakers vanish without a light on them.' },
    { map: 'Ashford Crossing', at: [0.9, 0.52], waves: 20, gold: 350, bosses: { 10: 'boss', 20: 'colossus' }, debut: { lamp: 9, courier: 11 },
      towers: ['arrow', 'cannon', 'frost', 'tesla', 'flame', 'rail', 'mines', 'prism',
      'light', 'sniper', 'clock', 'amp', 'bank', 'barrier'],
      enemies: ['grunt', 'runner', 'swarm', 'brute', 'hexguard', 'flyer', 'ghost', 'shield', 'splitter', 'emp', 'spotter', 'cloaker', 'sapper',
        'lamp', 'courier'],
      brief: 'Build anywhere. Lamplighters keep the robots around them from being slowed or stunned, and Couriers teleport ahead, so plan for damage, not delay.' },
    { map: 'Twin Gates', at: [0.7, 0.3], waves: 20, gold: 350, bosses: { 10: 'boss', 20: 'colossus' }, debut: { mole: 8, ember: 11, bomber: 14 },
      towers: ['arrow', 'cannon', 'frost', 'tesla', 'flame', 'rail', 'mines', 'prism',
      'light', 'sniper', 'clock', 'amp', 'bank', 'barrier'],
      enemies: ['grunt', 'runner', 'swarm', 'brute', 'hexguard', 'flyer', 'ghost', 'shield', 'splitter', 'emp', 'spotter', 'cloaker', 'sapper',
        'lamp', 'courier', 'mole', 'ember', 'bomber'],
      brief: 'Two gates, two roads, two flight lines. Ember Carriers scorch towers when they burst, and Dirigibles bomb whatever stands under them.' },
    { map: 'Power Station', at: [0.88, 0.14], waves: 20, gold: 600, bosses: { 10: 'boss', 15: 'colossus', 20: 'dynamo' }, debut: { tram: 12 },
      towers: ['arrow', 'cannon', 'frost', 'tesla', 'flame', 'rail', 'mines', 'prism',
      'light', 'sniper', 'clock', 'amp', 'bank', 'barrier'],
      enemies: ['grunt', 'runner', 'swarm', 'brute', 'hexguard', 'flyer', 'ghost', 'shield', 'splitter', 'emp', 'spotter', 'cloaker', 'sapper',
        'lamp', 'courier', 'mole', 'ember', 'bomber', 'tram'],
      brief: 'The finale. Both gates feed one long road that winds the long way round two turbine halls. Trams smash barricades. On wave 20 the Power Colossus surges as it takes damage, darkening every tower near it. A Jammer hit makes a surge fizzle.' },
  ],

  // Maps: path waypoints in tile coords, terrain painted as rectangles [x, y, w, h].
  // A map with `lots` is restricted: only those rectangles (and terraces) can be built on.
  MAPS: [{
    name: 'Kingsway Gate',
    blurb: 'Where the arcade meets the outer road. A short road and four lots.',
    // Campaign level 1, the first map a new player sees. One S-bend, four lots, no terrace and no tenement
    // between a lot and the road, so the only lesson is where to build: a lot on the inside of a bend
    // covers two stretches of road, the middle of a straight covers one. Every lot is within 2 tiles of the
    // road (base range 3), and three of them fit a Bombard.
    cols: 32, rows: 18,
    path: [[0, 4], [11, 4], [11, 12], [21, 12], [21, 6], [31, 6]],
    lots: [
      [7, 6, 3, 3],   // the gate square: inside the first bend, sees the gate straight and the drop
      [13, 9, 7, 2],  // the long kerb: its two ends sit in corners, its middle only sees the south straight
      [23, 8, 3, 3],  // the last bend: inside it, sees the climb and the exit straight
      [26, 3, 3, 2],  // the exit post: one straight only, the last chance before the gate
    ],
    terrain: [
      { t: 'forest',  rect: [0, 13, 5, 5] },
      { t: 'forest',  rect: [13, 0, 6, 2] },
      { t: 'forest',  rect: [27, 12, 5, 4] },
      { t: 'forest',  rect: [0, 0, 4, 2] },
      { t: 'rock',    rect: [15, 5, 2, 2] },
      { t: 'water',   rect: [3, 8, 3, 2] },
      { t: 'water',   rect: [14, 14, 5, 2] },
      { t: 'water',   rect: [29, 1, 2, 1] },
      // more city: tenements on tiles no line of fire crosses
      { t: 'forest',  rect: [11, 2, 3, 1] },
      { t: 'forest',  rect: [30, 16, 1, 1] },
      { t: 'forest',  rect: [30, 9, 2, 2] },
      { t: 'forest',  rect: [10, 14, 1, 2] },
      { t: 'forest',  rect: [11, 0, 1, 1] },
      { t: 'forest',  rect: [23, 1, 1, 1] },
      { t: 'forest',  rect: [7, 12, 1, 1] },
      { t: 'forest',  rect: [6, 15, 2, 2] },
      { t: 'forest',  rect: [23, 13, 2, 1] },
      { t: 'forest',  rect: [4, 10, 1, 2] },
    ],
  }, {
    name: 'Ashford Crossing',
    blurb: 'The open city. The road fords the river three times. Build on any free paving.',
    // Campaign level 8. Open paving, so a build is the player's own plan. Each ford keeps the middle of a
    // climb clear of towers, and the bends are far apart, so no spot covers much of the road: towers have to
    // be strong, not just well placed.
    cols: 32, rows: 18,
    path: [[0, 3], [7, 3], [7, 13], [16, 13], [16, 3], [24, 3], [24, 13], [31, 13]],
    terrain: [
      { t: 'water',   rect: [0, 8, 32, 2] },  // the river; the road fords it on all three climbs
      { t: 'hill',    rect: [10, 4, 3, 2] },  // the mill terrace, inside the first loop
      { t: 'hill',    rect: [19, 11, 2, 2] }, // the lock terrace, inside the second
      { t: 'hill',    rect: [27, 5, 2, 2] },
      { t: 'forest',  rect: [9, 11, 2, 1] },
      { t: 'forest',  rect: [20, 5, 2, 1] },
      { t: 'forest',  rect: [0, 0, 6, 2] },
      { t: 'forest',  rect: [11, 0, 5, 2] },
      { t: 'forest',  rect: [26, 0, 6, 3] },
      { t: 'forest',  rect: [0, 15, 6, 3] },
      { t: 'forest',  rect: [10, 15, 5, 3] },
      { t: 'forest',  rect: [26, 15, 6, 3] },
      { t: 'rock',    rect: [2, 5, 2, 1] },
      { t: 'rock',    rect: [28, 11, 1, 1] },
    ],
  }, {
    name: 'Kingsway Arcade',
    blurb: 'A longer, winding road. Build only on the marked lots.',
    // With `lots`, open ground is promenade that cannot be built on; only the lots (and any terraces) can.
    // Every lot covers a different stretch of road, so each one is a choice of what to put where.
    cols: 32, rows: 18,
    path: [[0, 2], [10, 2], [10, 7], [4, 7], [4, 13], [14, 13], [14, 9], [20, 9], [20, 2], [28, 2], [28, 8], [24, 8], [24, 14], [31, 14]],
    lots: [
      [5, 3, 4, 3],   // the first bend: sees the gate and the long first straight
      [1, 9, 2, 3],   // a narrow strip by the western drop
      [6, 9, 5, 3],   // the courtyard ringed by three stretches of road
      [16, 11, 3, 3], // the southern square, beside two straights
      [22, 4, 3, 3],  // the crossroads lot, between three lanes
      [26, 10, 4, 3], // the last corner before the exit
      // kerbside lots: one tile off the road, on the inside of a bend, for the short-range towers (range floor 2.5)
      [11, 3, 1, 3],  // inside the first bend, beside the gate straight and the first drop
      [5, 8, 2, 1],   // inside the western bend (fits a Mine Layer)
      [15, 10, 1, 4], // the southern square's kerb, along the climb north
      [19, 6, 1, 3],  // under the terrace, beside the long climb
      [25, 13, 3, 1], // inside the last bend before the exit (fits a Mine Layer)
    ],
    terrain: [
      { t: 'hill',    rect: [16, 4, 3, 4] }, // the one terrace: high ground over the middle of the route
      { t: 'forest',  rect: [12, 3, 3, 3] },
      { t: 'forest',  rect: [0, 4, 3, 2] },
      { t: 'forest',  rect: [13, 0, 6, 1] },
      { t: 'forest',  rect: [22, 0, 5, 1] },
      { t: 'forest',  rect: [29, 4, 3, 3] },
      { t: 'forest',  rect: [6, 15, 6, 3] },
      { t: 'forest',  rect: [26, 16, 6, 2] },
      { t: 'forest',  rect: [0, 14, 3, 4] },
      { t: 'forest',  rect: [21, 11, 2, 4] },
      { t: 'rock',    rect: [11, 10, 2, 1] },
      { t: 'rock',    rect: [22, 7, 1, 1] },
      { t: 'rock',    rect: [30, 9, 1, 2] },
      { t: 'forest',  rect: [15, 15, 5, 2] },
      { t: 'water',   rect: [6, 0, 3, 1] },
      { t: 'water',   rect: [25, 4, 2, 2] },
      // more city: tenements on tiles no line of fire crosses
      { t: 'forest',  rect: [14, 1, 3, 1] },
      { t: 'forest',  rect: [15, 17, 1, 1] },
      { t: 'forest',  rect: [21, 15, 1, 2] },
      { t: 'forest',  rect: [2, 0, 1, 1] },
      { t: 'forest',  rect: [27, 0, 1, 1] },
      { t: 'forest',  rect: [12, 15, 2, 1] },
      { t: 'forest',  rect: [30, 7, 1, 2] },
      { t: 'forest',  rect: [24, 16, 2, 2] },
      { t: 'forest',  rect: [12, 0, 1, 2] },
      { t: 'forest',  rect: [29, 0, 3, 1] },
    ],
  }, {
    name: 'Market Square',
    blurb: 'The road rings a market on three sides. One terrace, six lots.',
    // Campaign level 2. The road wraps the market (an upside-down U), so the lots inside the two corners see
    // two stretches. The terrace sits a tile further out than the west stall; its +30% range is what lets
    // most of it see both the top and the descent. Two kerb strips one tile off the road for the Flamethrower.
    cols: 32, rows: 18,
    path: [[0, 12], [7, 12], [7, 3], [24, 3], [24, 12], [31, 12]],
    lots: [
      [9, 5, 3, 3],   // the west stall: inside the first corner, sees the climb and the north side
      [13, 5, 4, 2],  // the north arcade: along the top of the market, one stretch only
      [8, 9, 1, 3],   // the west kerb, one tile off the climb
      [23, 7, 1, 3],  // the east kerb, one tile off the descent
      [3, 9, 3, 3],   // the gate yard: inside the bend where the road turns north
      [26, 13, 4, 2], // the exit row, along the last straight
    ],
    terrain: [
      { t: 'hill',    rect: [19, 5, 3, 3] }, // the terrace: needs its range bonus to see both the top and the descent
      { t: 'rock',    rect: [13, 8, 6, 2] }, // the market hall
      { t: 'water',   rect: [14, 11, 4, 2] }, // the fountain
      { t: 'forest',  rect: [0, 0, 5, 2] },
      { t: 'forest',  rect: [27, 0, 5, 2] },
      { t: 'forest',  rect: [10, 14, 12, 4] },
      { t: 'forest',  rect: [0, 15, 6, 3] },
      { t: 'forest',  rect: [27, 4, 5, 3] },
      { t: 'rock',    rect: [1, 5, 2, 2] },
      { t: 'water',   rect: [29, 9, 2, 2] },
      // more city: tenements on tiles no line of fire crosses
      { t: 'forest',  rect: [17, 1, 3, 1] },
      { t: 'forest',  rect: [27, 16, 1, 1] },
      { t: 'forest',  rect: [0, 3, 2, 2] },
      { t: 'forest',  rect: [9, 0, 1, 1] },
      { t: 'forest',  rect: [6, 1, 1, 1] },
      { t: 'forest',  rect: [3, 6, 1, 1] },
      { t: 'forest',  rect: [24, 1, 2, 1] },
      { t: 'forest',  rect: [30, 7, 2, 1] },
      { t: 'forest',  rect: [4, 3, 1, 2] },
      { t: 'forest',  rect: [29, 2, 3, 1] },
    ],
  }, {
    name: 'Riverside',
    blurb: 'The road crosses the river twice. Wyverns follow the water straight to the gate.',
    // Campaign level 3. The river runs east to west under the flight line, and the road loops north, south and
    // north again across two bridges: twice as far on foot as by air. The towpath terrace sits right under the
    // flight line with +30% range, the pools keep the rest of it unbuildable. Two north lots line up with the long bridge
    // roads for the Railgun; the kerb by the south loop fits a Mine Layer.
    cols: 32, rows: 18,
    path: [[0, 8], [5, 8], [5, 3], [12, 3], [12, 14], [19, 14], [19, 3], [26, 3], [26, 8], [31, 8]],
    lots: [
      [7, 5, 4, 2],   // the west loop: between its top straight and the flight line
      [21, 5, 4, 2],  // the east loop, the same
      [14, 12, 4, 2], // the south loop, beside the far straight
      [11, 1, 3, 2],  // north of the first bridge road: a Railgun here fires straight down it
      [18, 1, 3, 2],  // north of the second bridge road, the same
      [1, 4, 3, 3],   // the west quay, outside the first climb
      [27, 4, 3, 3],  // the east quay, outside the last drop
      [9, 12, 2, 2],  // the west bank, beside the first bridge road
      [21, 12, 3, 2], // the east bank, beside the second
    ],
    terrain: [
      { t: 'water',   rect: [0, 9, 32, 2] }, // the river; the road crosses it on two bridges
      { t: 'hill',    rect: [14, 5, 4, 3] }, // the towpath terrace: between the bridge roads, under the flight line
      { t: 'water',   rect: [7, 7, 4, 2] },  // reflecting pools under the flight line
      { t: 'water',   rect: [21, 7, 4, 2] },
      { t: 'forest',  rect: [0, 0, 4, 2] },
      { t: 'forest',  rect: [28, 0, 4, 2] },
      { t: 'forest',  rect: [0, 13, 6, 5] },
      { t: 'forest',  rect: [25, 12, 7, 6] },
      { t: 'rock',    rect: [15, 0, 2, 2] },
      { t: 'rock',    rect: [8, 15, 2, 1] },
      // more city: tenements on tiles no line of fire crosses
      { t: 'forest',  rect: [1, 2, 3, 1] },
      { t: 'forest',  rect: [12, 17, 1, 1] },
      { t: 'forest',  rect: [8, 16, 1, 2] },
      { t: 'forest',  rect: [7, 0, 1, 1] },
      { t: 'forest',  rect: [6, 15, 1, 1] },
      { t: 'forest',  rect: [14, 16, 2, 2] },
      { t: 'forest',  rect: [29, 2, 2, 1] },
      { t: 'forest',  rect: [1, 11, 3, 1] },
      { t: 'forest',  rect: [22, 16, 2, 2] },
    ],
  }, {
    name: 'Tenement Row',
    blurb: 'Tall blocks crowd the road. Every lot sees only part of it.',
    // Campaign level 4. Tenements stand between most lots and part of the road, so a range ring lies: the
    // sight overlay (and the Railgun, Bombard and Sentinel Rifle, which fire over them) are the answer. The two
    // courtyards inside the first loop are split by a block, each seeing its own side. The perch in the
    // north-west, away from the road, is for a Sentinel Rifle.
    cols: 32, rows: 18,
    path: [[0, 13], [9, 13], [9, 5], [17, 5], [17, 11], [25, 11], [25, 3], [31, 3]],
    lots: [
      [4, 9, 3, 3],   // the west yard: sees the gate straight, a block hides the climb
      [11, 7, 2, 3],  // the west courtyard: the climb and the top's west half
      [15, 7, 2, 3],  // the east courtyard: the drop and the top's east half
      [20, 6, 3, 2],  // the well: between two climbs, a block hides the bottom straight
      [20, 12, 4, 2], // the kerb row, along the bottom straight
      [27, 5, 3, 3],  // the exit yard, beside the last climb and the gate
      [5, 3, 2, 2],   // the perch: out in the north-west, a clear look along the top straight
    ],
    terrain: [
      { t: 'forest',  rect: [7, 7, 2, 5] },   // hides the first climb from the west yard
      { t: 'forest',  rect: [13, 6, 2, 6] },  // splits the two courtyards
      { t: 'forest',  rect: [19, 8, 5, 2] },  // hides the bottom straight from the well
      { t: 'forest',  rect: [11, 11, 2, 1] },
      { t: 'forest',  rect: [15, 11, 2, 1] },
      { t: 'forest',  rect: [0, 0, 9, 2] },
      { t: 'forest',  rect: [19, 0, 7, 2] },
      { t: 'forest',  rect: [0, 6, 3, 2] },
      { t: 'forest',  rect: [11, 14, 7, 4] },
      { t: 'forest',  rect: [27, 9, 5, 3] },
      { t: 'forest',  rect: [26, 14, 6, 4] },
      { t: 'rock',    rect: [2, 15, 2, 1] },
      { t: 'water',   rect: [28, 0, 3, 1] },
      // more city: tenements on tiles no line of fire crosses
      { t: 'forest',  rect: [8, 2, 3, 1] },
      { t: 'forest',  rect: [1, 17, 1, 1] },
      { t: 'forest',  rect: [0, 4, 2, 2] },
      { t: 'forest',  rect: [6, 15, 1, 2] },
      { t: 'forest',  rect: [13, 0, 1, 1] },
      { t: 'forest',  rect: [18, 1, 1, 1] },
      { t: 'forest',  rect: [25, 13, 1, 1] },
      { t: 'forest',  rect: [20, 15, 2, 2] },
      { t: 'forest',  rect: [14, 2, 2, 1] },
      { t: 'forest',  rect: [28, 1, 3, 1] },
    ],
  }, {
    name: 'The Foundry',
    blurb: 'Three long casting lines. Cones and beams love them. Disruptors love a crowd.',
    // Campaign level 6. Three long straights for the Flamethrower, Railgun and Arcane Prism, with Railgun lots
    // on the end of each line. The strips between the lines are kerb lots, which Disruptors can reach, and the
    // furnaces break them up so a build has to spread out.
    cols: 32, rows: 18,
    path: [[0, 3], [27, 3], [27, 8], [4, 8], [4, 13], [31, 13]],
    lots: [
      [28, 2, 3, 3],  // the east crane: in line with the first casting line
      [1, 7, 2, 3],   // the west crane: in line with the second
      [1, 12, 2, 2],  // the gate crane: in line with the third
      [2, 4, 5, 2],   // the north-west floor, between the first two lines
      [11, 4, 6, 1],  // the north kerb, under the first line
      [11, 7, 6, 1],  // the middle kerb, above the second line
      [19, 5, 4, 2],  // the north-east floor
      [6, 10, 4, 2],  // the south-west floor, between the last two lines
      [15, 10, 6, 2], // the long floor
      [23, 9, 3, 3],  // the south-east floor, inside the last bend
      [8, 14, 5, 1],  // the south kerb, under the last line
    ],
    terrain: [
      { t: 'hill',    rect: [14, 5, 3, 2] },  // the slag heap: a terrace between the first two lines
      { t: 'rock',    rect: [8, 5, 2, 2] },   // furnaces
      { t: 'rock',    rect: [24, 5, 2, 2] },
      { t: 'rock',    rect: [11, 9, 3, 3] },
      { t: 'water',   rect: [27, 10, 3, 2] }, // the quench pool
      { t: 'forest',  rect: [0, 0, 6, 2] },
      { t: 'forest',  rect: [9, 0, 10, 2] },
      { t: 'forest',  rect: [22, 0, 6, 2] },
      { t: 'forest',  rect: [14, 15, 8, 3] },
      { t: 'forest',  rect: [26, 15, 6, 3] },
      { t: 'forest',  rect: [0, 15, 4, 3] },
      // more city: tenements on tiles no line of fire crosses
      { t: 'forest',  rect: [11, 17, 1, 1] },
      { t: 'forest',  rect: [22, 15, 2, 2] },
      { t: 'forest',  rect: [13, 16, 1, 2] },
      { t: 'forest',  rect: [7, 0, 1, 1] },
      { t: 'forest',  rect: [30, 0, 1, 1] },
      { t: 'forest',  rect: [8, 16, 1, 1] },
      { t: 'forest',  rect: [20, 1, 2, 1] },
      { t: 'forest',  rect: [25, 16, 1, 1] },
      { t: 'forest',  rect: [4, 15, 2, 1] },
      { t: 'forest',  rect: [8, 16, 2, 2] },
      { t: 'forest',  rect: [19, 1, 3, 1] },
    ],
  }, {
    name: 'The Exchange',
    blurb: 'The road coils into the trading pit and back out. Every lane in the coil runs beside the one before it.',
    // Campaign level 7: economy. Little gold to start, so a Bank pays for the rest. The road is a double spiral:
    // it winds in clockwise to the pit and winds back out between its own lanes, so the kerbs inside the coil see
    // two lanes at once. The vault sits in the pit, where every lane is in reach, but on the kerb, where Sappers
    // reach it; 40 of the 58 slots touch the road. The flight line cuts straight across the coil.
    // Outside the coil everything is mirrored through the pit.
    cols: 32, rows: 18,
    path: [[0, 2], [21, 2], [21, 11], [13, 11], [13, 7], [15, 7], [15, 9], [18, 9], [18, 5], [10, 5], [10, 14], [31, 14]],
    lots: [
      [14, 6, 4, 1],  // the vault: the pit floor, a Bank's width
      [16, 7, 2, 2],  // the vault's lower half, between the last two turns
      [11, 7, 2, 4],  // the west kerb, between the outgoing and incoming lanes
      [19, 6, 2, 4],  // the east kerb
      [14, 3, 4, 2],  // the north gallery, between the way in and the coil
      [14, 12, 4, 2], // the south gallery, between the coil and the way out
      [6, 8, 3, 3],   // the west yard, outside the coil
      [23, 6, 3, 3],  // the east yard
    ],
    terrain: [
      { t: 'forest',  rect: [0, 0, 9, 2] },
      { t: 'forest',  rect: [23, 15, 9, 3] },
      { t: 'forest',  rect: [0, 14, 8, 4] },
      { t: 'forest',  rect: [24, 0, 8, 3] },
      { t: 'forest',  rect: [0, 9, 3, 3] },
      { t: 'forest',  rect: [29, 5, 3, 3] },
      { t: 'water',   rect: [3, 5, 4, 2] },   // the fountains
      { t: 'water',   rect: [25, 10, 4, 2] },
      { t: 'rock',    rect: [8, 3, 1, 1] },   // four pillars at the coil's corners
      { t: 'rock',    rect: [23, 13, 1, 1] },
      { t: 'rock',    rect: [8, 12, 1, 1] },
      { t: 'rock',    rect: [23, 4, 1, 1] },
      // more city: tenements on tiles no line of fire crosses
      { t: 'forest',  rect: [25, 4, 3, 1] },
      { t: 'forest',  rect: [8, 17, 1, 1] },
      { t: 'forest',  rect: [6, 12, 1, 2] },
      { t: 'forest',  rect: [12, 0, 1, 1] },
      { t: 'forest',  rect: [3, 11, 1, 1] },
      { t: 'forest',  rect: [30, 4, 2, 1] },
      { t: 'forest',  rect: [0, 7, 3, 1] },
      { t: 'forest',  rect: [13, 16, 2, 2] },
      { t: 'forest',  rect: [14, 0, 1, 1] },
      { t: 'forest',  rect: [20, 0, 3, 1] },
    ],
  }, {
    name: 'Twin Gates',
    blurb: 'Two gates, two roads, one exit. The roads meet late, so each needs its own guard.',
    // Campaign level 9. `entry2` is the second gate's road: it ends on the main road and robots carry on along
    // it from there. Groups take turns between the gates. The island lot sees both roads; the merge terrace sees
    // all three stretches but sits under the north flight line, where Dirigibles bomb it.
    cols: 32, rows: 18,
    path: [[0, 3], [10, 3], [10, 6], [20, 6], [20, 9], [24, 9], [24, 13], [28, 13], [28, 5], [31, 5]],
    entry2: [[0, 14], [8, 14], [8, 11], [16, 11], [16, 9], [20, 9]],
    lots: [
      [11, 8, 4, 2],  // the island: between the two roads, 2 tiles from each, under the south flight line
      [2, 5, 4, 2],   // the north yard
      [4, 8, 3, 2],   // the west yard, between the gates
      [2, 11, 4, 2],  // the south yard
      [10, 13, 5, 2], // the south kerb, under the south road
      [22, 6, 3, 2],  // the merge yard
      [25, 9, 2, 3],  // the pocket: inside the last loop
      [21, 11, 2, 2], // the exit kerb
      [29, 8, 2, 3],  // the exit yard
    ],
    terrain: [
      { t: 'hill',    rect: [17, 7, 2, 2] },  // the merge terrace
      { t: 'rock',    rect: [12, 4, 2, 1] },
      { t: 'water',   rect: [5, 16, 6, 2] },
      { t: 'water',   rect: [24, 3, 2, 2] },
      { t: 'forest',  rect: [0, 0, 5, 2] },
      { t: 'forest',  rect: [12, 0, 8, 2] },
      { t: 'forest',  rect: [22, 0, 10, 3] },
      { t: 'forest',  rect: [17, 13, 6, 5] },
      { t: 'forest',  rect: [26, 14, 6, 4] },
      { t: 'rock',    rect: [1, 16, 3, 1] },
      // more city: tenements on tiles no line of fire crosses
      { t: 'forest',  rect: [14, 2, 3, 1] },
      { t: 'forest',  rect: [2, 17, 1, 1] },
      { t: 'forest',  rect: [19, 3, 2, 2] },
      { t: 'forest',  rect: [7, 0, 1, 1] },
      { t: 'forest',  rect: [9, 1, 1, 1] },
      { t: 'forest',  rect: [22, 4, 1, 1] },
      { t: 'forest',  rect: [23, 15, 2, 2] },
      { t: 'forest',  rect: [22, 3, 1, 2] },
      { t: 'forest',  rect: [14, 16, 2, 2] },
    ],
  }, {
    name: 'Power Station',
    blurb: 'The road runs the long way round the station: east, back west between the two turbine halls, then east again to the exit.',
    // Campaign level 10, the finale, and the main Endless map (the finale's win offers to carry on here). The
    // main road is an S: hall A sits in the upper bend, hall B in the lower, and the middle lane between them
    // carries every robot past both. The south gate road climbs the west side to join at the top, which closes
    // hall A in on all four sides. Room for a long game: about 110 build tiles, two terraces.
    cols: 32, rows: 18,
    path: [[0, 3], [22, 3], [22, 9], [9, 9], [9, 15], [31, 15]],
    entry2: [[0, 14], [5, 14], [5, 3]],
    lots: [
      [12, 4, 6, 5],  // hall A: its floor rings the terrace
      [14, 10, 6, 5], // hall B
      [6, 4, 3, 2],   // the gatehouse, between the south gate road and hall A
      [6, 7, 3, 2],
      [20, 4, 2, 5],  // hall A's east floor, on the bend
      [10, 11, 2, 3], // hall B's west floor, on the bend
      [21, 11, 2, 3], // hall B's east floor
      [23, 5, 2, 4],  // the switchyard, outside the upper bend
      [26, 12, 4, 3], // the exit yard
      [2, 5, 3, 3],   // the west yard, beside the south gate road
      [6, 11, 3, 3],  // the cut, between the south gate road and the lower bend
    ],
    terrain: [
      { t: 'hill',    rect: [13, 5, 4, 3] },  // hall A's terrace
      { t: 'hill',    rect: [15, 11, 4, 3] }, // hall B's terrace
      // the turbine houses: tenements, so they block sight across the hall (models.js draws them as one building)
      { t: 'forest',  rect: [13, 4, 4, 1] },  // hall A's turbine house
      { t: 'forest',  rect: [15, 14, 4, 1] }, // hall B's turbine house
      { t: 'water',   rect: [27, 5, 3, 3] },  // the cooling ponds
      { t: 'water',   rect: [1, 10, 3, 2] },
      { t: 'forest',  rect: [0, 0, 12, 2] },
      { t: 'forest',  rect: [24, 0, 8, 3] },
      { t: 'forest',  rect: [0, 16, 8, 2] },  // only west of the lower bend: tenements in front would hide the last lane
      { t: 'rock',    rect: [12, 17, 1, 1] },
      { t: 'rock',    rect: [24, 17, 1, 1] },
      { t: 'forest',  rect: [12, 0, 12, 1] },
      // more city: tenements on tiles no line of fire crosses
      { t: 'forest',  rect: [21, 17, 1, 1] },
      { t: 'forest',  rect: [14, 1, 1, 1] },
      { t: 'forest',  rect: [24, 3, 1, 1] },
      { t: 'forest',  rect: [0, 9, 1, 1] },
      { t: 'forest',  rect: [27, 4, 2, 1] },
      { t: 'forest',  rect: [30, 6, 1, 2] },
      { t: 'forest',  rect: [27, 4, 3, 1] },
      // monoliths standing in the open yards: no sight lost, nothing built on
      { t: 'rock',    rect: [27, 9, 1, 1] },
      { t: 'rock',    rect: [10, 16, 1, 1] },
      { t: 'rock',    rect: [1, 13, 1, 1] },
    ],
  }],
};
