import { makeGrid, fillRect, fillRectShaded } from './PixelDraw';
import { registerEnemyArt, stampEyes, stampFangs, stampClaw, type EnemyArt } from './SpriteLibraryEnemyArt';

/**
 * Boss art. Same authoring contract as the trash roster
 * (SpriteLibraryEnemyArt.ts - outline, `fillRectShaded` volume, real faces,
 * square ground-contact grid, full six-pose set) but deliberately pushed
 * further on every axis, because a boss that is just "a big trash mob with
 * more HP" is the exact thing this pass exists to fix:
 *   - noticeably larger grids (36-38 vs 22-28) so they carry real detail
 *     rather than the same block scaled up
 *   - a signature light source of their own (Rot King's plague glow, the
 *     Colossus's caged soul-core, Duskfang's spectral eyes) that visibly
 *     brightens during the charge pose, so their telegraph is readable across
 *     a screen full of hordes
 *   - bespoke multi-beat attack animations matched to the attack each one
 *     actually performs in WaveDirector, instead of a generic swipe
 *   - bespoke death sequences (crown falls / ribcage bursts / hound
 *     dissolves) rather than the shared collapse heap
 */

// ===========================================================================
// ROT KING - bloated plague monarch. Silhouette: jagged five-point crown over
// a sunken crowned skull, an enormous tattered royal mantle flaring out to
// either side, a swollen ribcage-split belly leaking plague light, and a long
// bone scepter. Its attack is a scepter-driven ground slam (see
// WaveDirector.triggerRotKingAttack), so the pose set is raise -> slam ->
// recover. Grid 36x36.
// ===========================================================================
const ROTKING_PALETTE: Record<string, string> = {
  h: '#8aa348', i: '#b3cc6b', j: '#4c5f22',
  e: '#c25cff', g: '#f0d0ff',
  b: '#6f8a34', c: '#94ad52', d: '#3a4a18',
  a: '#5c7328',
  m: '#5f7a2c', l: '#829a44', q: '#2f3d12',
  n: '#d8d0a8',
  p: '#4a5a3a', r: '#66784f', u: '#252f1c',
  o: '#141a0e',
  w: '#d8c98a', x: '#f4ebc0', y: '#8a7a48',
  v: '#5c4a28',
  s: '#6b2f8a', t: '#9a4fc4', z: '#3a1450',
  '1': '#e8c93a', '2': '#c25cff', '3': '#f2eed6',
};

/** arm: 0 rest / 1 scepter overhead / 2 scepter slammed down. glow: plague-light intensity 0..2. */
function rotKingBody(legOffset: number, arm: number, glow: number, hunch: number): string[][] {
  const g = makeGrid(36, 36);
  const hy = hunch;

  // tattered royal mantle, flaring wide behind the shoulders - drawn first
  fillRectShaded(g, 1, 12 + hy, 10, 26, 's', 't', 'z');
  fillRectShaded(g, 25, 12 + hy, 34, 26, 's', 't', 'z');
  fillRect(g, 2, 27, 9, 29, 'z'); // ragged mantle hem
  fillRect(g, 26, 27, 33, 29, 'z');
  fillRect(g, 3, 30, 5, 32, 'z');
  fillRect(g, 30, 30, 32, 32, 'z');

  // jagged five-point crown
  for (let k = 0; k < 5; k++) {
    const cx = 11 + k * 3;
    fillRectShaded(g, cx, 1 + hy - (k % 2), cx + 1, 4 + hy, '1', '3', 'y');
  }
  fillRectShaded(g, 10, 4 + hy, 25, 6 + hy, '1', '3', 'y');
  fillRect(g, 17, 5 + hy, 18, 5 + hy, '2'); // crown gem

  // sunken monarch skull
  fillRectShaded(g, 12, 6 + hy, 23, 14 + hy, 'h', 'i', 'j');
  fillRect(g, 12, 6 + hy, 23, 7 + hy, 'j'); // brow shadow
  stampEyes(g, 14, 20, 9 + hy, 2, 3, 'e', glow > 0 ? 'g' : 'e');
  fillRect(g, 17, 12 + hy, 18, 13 + hy, 'j'); // nasal pit
  fillRectShaded(g, 13, 14 + hy, 22, 16 + hy, 'h', 'i', 'j'); // jaw
  stampFangs(g, 14, 22, 16 + hy, '3');

  // shoulders + bloated torso split open by a glowing plague wound
  fillRectShaded(g, 7, 16 + hy, 28, 21, 'b', 'c', 'd');
  fillRectShaded(g, 9, 20, 26, 29, 'b', 'c', 'd');
  fillRect(g, 11, 22, 24, 23, 'a');
  // exposed rib bars over the wound
  for (let r = 0; r < 3; r++) fillRect(g, 12, 24 + r * 2, 23, 24 + r * 2, 'n');
  if (glow > 0) {
    fillRectShaded(g, 14, 24, 21, 28, glow > 1 ? '2' : 's', 't', 'z');
    fillRect(g, 16, 25, 19, 27, glow > 1 ? 'g' : '2');
  }

  // arms: left braces the mantle, right works the scepter
  fillRectShaded(g, 4, 17 + hy, 9, 27, 'm', 'l', 'q');
  fillRect(g, 3, 27, 8, 29, 'n');
  if (arm === 1) {
    // scepter hauled high overhead - the slam windup
    fillRectShaded(g, 26, 6, 31, 18, 'm', 'l', 'q');
    fillRect(g, 26, 6, 31, 8, 'n');
    fillRect(g, 28, 0, 29, 6, 'v');
    fillRectShaded(g, 25, -2, 32, 2, 'w', 'x', 'y');
    fillRect(g, 27, -1, 30, 1, glow > 0 ? '2' : '1');
  } else if (arm === 2) {
    // scepter driven into the ground - the slam impact
    fillRectShaded(g, 26, 18, 31, 26, 'm', 'l', 'q');
    fillRect(g, 27, 24, 31, 26, 'n');
    fillRect(g, 30, 26, 31, 31, 'v');
    fillRectShaded(g, 28, 31, 35, 34, 'w', 'x', 'y');
    fillRect(g, 30, 32, 33, 33, '2');
  } else {
    fillRectShaded(g, 26, 17 + hy, 31, 27, 'm', 'l', 'q');
    fillRect(g, 27, 27, 32, 29, 'n');
    fillRect(g, 30, 14, 31, 28, 'v');
    fillRectShaded(g, 28, 9, 34, 13, 'w', 'x', 'y');
    fillRect(g, 30, 10, 32, 12, glow > 0 ? '2' : '1');
  }

  // heavy legs with a real gap and clawed royal boots
  fillRectShaded(g, 11, 29, 15, 33 + legOffset, 'p', 'r', 'u');
  fillRectShaded(g, 20, 29, 24, 33 - legOffset, 'p', 'r', 'u');
  fillRect(g, 9, 33 + legOffset, 16, 35 + legOffset, 'o');
  fillRect(g, 19, 33 - legOffset, 26, 35 - legOffset, 'o');
  return g;
}

const ROTKING_ART: EnemyArt = {
  size: 36,
  palette: ROTKING_PALETTE,
  outline: '#0a1005',
  idle: (f) => rotKingBody(0, 0, f === 0 ? 0 : 1, f === 0 ? 0 : 1),
  walk: (f) => rotKingBody([1, 0, -1, 0][f], 0, 1, f === 1 ? 1 : 0),
  attack: (s) => (s === 0 ? rotKingBody(0, 1, 2, -1) : s === 1 ? rotKingBody(0, 2, 2, 2) : rotKingBody(0, 0, 1, 1)),
  hit: (settled) => rotKingBody(0, 0, settled ? 1 : 2, settled ? 1 : 3),
  special: (s) => rotKingBody(0, 1, s === 0 ? 1 : 2, -1),
  death: (s) => {
    // the crown topples off first, then the bloated body folds and the plague
    // light gutters out - not the shared collapse heap
    const g = makeGrid(36, 36);
    const drop = s * 3;
    // crown rolling away
    fillRectShaded(g, 2 + s * 3, 30 - (3 - s), 9 + s * 3, 32, '1', '3', 'y');
    // mantle settling into a puddle of cloth
    fillRectShaded(g, 3, 24 + drop, 32, 34, 's', 't', 'z');
    // body sinking
    fillRectShaded(g, 10, 20 + drop, 25, 30 + drop, 'b', 'c', 'd');
    if (s < 3) {
      fillRectShaded(g, 13 + s, 14 + drop, 22 + s, 21 + drop, 'h', 'i', 'j');
      stampEyes(g, 15 + s, 20 + s, 16 + drop, 2, 2, 'e', 'e');
      // the wound light fading stage by stage
      fillRect(g, 15, 24 + drop, 20, 26 + drop, s === 0 ? '2' : 's');
    }
    fillRectShaded(g, 27, 28, 34, 33, 'w', 'x', 'y'); // dropped scepter head
    return g;
  },
  fps: { idle: 1.6, walk: 5, attack: 7, hit: 9, special: 4.5, death: 7 },
};

// ===========================================================================
// BONE COLOSSUS - skeletal titan. Silhouette: the tallest, heaviest shape in
// the game - a colossal horned skull over an enormous open ribcage with a
// caged soul-core burning inside it, boulder fists on the ends of long arms,
// and pillar leg bones. Its attack is a scatter of falling bone shards
// (WaveDirector.triggerBoneColossusAttack), so the pose set is arms-up
// summon -> arms-slammed-wide release -> recover. Grid 38x38.
// ===========================================================================
const BONECOLOSSUS_PALETTE: Record<string, string> = {
  h: '#ddd6bb', i: '#f6f1de', j: '#968d72',
  e: '#4fe0ff', g: '#d8fbff',
  b: '#d0c8ad', c: '#ece5cd', d: '#8a8167',
  a: '#b5ac90',
  m: '#c9c1a6', l: '#e6dfc6', q: '#847b62',
  n: '#f2ecdc',
  p: '#cdc5aa', r: '#e9e2ca', u: '#7d7460',
  o: '#3f3a2e',
  s: '#2f7f96', t: '#5fc0d8', z: '#154453',
  '1': '#332e24', '2': '#4fe0ff', '3': '#ffffff',
};

/** arms: 0 rest / 1 raised summon / 2 slammed wide. core: soul-core intensity 0..2. */
function boneColossusBody(legOffset: number, arms: number, core: number, hunch: number): string[][] {
  const g = makeGrid(38, 38);
  const hy = hunch;

  // curved horns sweeping off the skull
  fillRectShaded(g, 9, 1 + hy, 11, 5 + hy, 'h', 'i', 'j');
  fillRect(g, 8, 0 + hy, 9, 2 + hy, 'j');
  fillRectShaded(g, 26, 1 + hy, 28, 5 + hy, 'h', 'i', 'j');
  fillRect(g, 28, 0 + hy, 29, 2 + hy, 'j');
  // colossal skull with deep sockets and a heavy hinged jaw
  fillRectShaded(g, 11, 2 + hy, 26, 12 + hy, 'h', 'i', 'j');
  fillRect(g, 11, 2 + hy, 26, 3 + hy, 'j');
  stampEyes(g, 13, 22, 6 + hy, 3, 3, core > 0 ? 'e' : '1', core > 1 ? '3' : 'g');
  fillRect(g, 18, 10 + hy, 19, 11 + hy, '1'); // nasal cavity
  fillRectShaded(g, 12, 12 + hy, 25, 15 + hy, 'h', 'i', 'j');
  stampFangs(g, 13, 25, 15 + hy, '1');

  // shoulder girdle
  fillRectShaded(g, 5, 15 + hy, 32, 19, 'b', 'c', 'd');
  // enormous open ribcage - rib bars with REAL gaps, spine behind them
  fillRectShaded(g, 17, 18, 20, 30, 'a', 'c', 'd'); // spine
  for (let r = 0; r < 5; r++) {
    const ry = 19 + r * 2;
    const inset = r > 2 ? r - 2 : 0;
    fillRectShaded(g, 7 + inset, ry, 30 - inset, ry, 'b', 'c', 'd');
  }
  // caged soul-core burning inside the ribcage - the boss's signature light
  if (core > 0) {
    fillRectShaded(g, 15, 22, 22, 27, core > 1 ? '2' : 's', 't', 'z');
    fillRect(g, 17, 23, 20, 26, core > 1 ? '3' : '2');
  }
  // pelvis
  fillRectShaded(g, 12, 30, 25, 33, 'b', 'c', 'd');

  // long arms ending in boulder fists
  if (arms === 1) {
    fillRectShaded(g, 1, 2, 6, 17, 'm', 'l', 'q');
    fillRectShaded(g, 31, 2, 36, 17, 'm', 'l', 'q');
    fillRectShaded(g, 0, -2, 8, 3, 'a', 'l', 'q');
    fillRectShaded(g, 29, -2, 37, 3, 'a', 'l', 'q');
  } else if (arms === 2) {
    fillRectShaded(g, 0, 17, 6, 24, 'm', 'l', 'q');
    fillRectShaded(g, 31, 17, 37, 24, 'm', 'l', 'q');
    fillRectShaded(g, -1, 24, 7, 30, 'a', 'l', 'q');
    fillRectShaded(g, 30, 24, 38, 30, 'a', 'l', 'q');
  } else {
    fillRectShaded(g, 2, 17 + hy, 7, 27, 'm', 'l', 'q');
    fillRectShaded(g, 30, 17 + hy, 35, 27, 'm', 'l', 'q');
    fillRectShaded(g, 1, 27, 9, 32, 'a', 'l', 'q');
    fillRectShaded(g, 28, 27, 36, 32, 'a', 'l', 'q');
    fillRect(g, 2, 29, 8, 30, 'n');
    fillRect(g, 29, 29, 35, 30, 'n');
  }

  // pillar leg bones with a wide gap and slab feet
  fillRectShaded(g, 13, 33, 17, 36 + legOffset, 'p', 'r', 'u');
  fillRectShaded(g, 21, 33, 25, 36 - legOffset, 'p', 'r', 'u');
  fillRect(g, 10, 36 + legOffset, 19, 37 + legOffset, 'o');
  fillRect(g, 19, 36 - legOffset, 28, 37 - legOffset, 'o');
  return g;
}

const BONECOLOSSUS_ART: EnemyArt = {
  size: 38,
  palette: BONECOLOSSUS_PALETTE,
  outline: '#191610',
  idle: (f) => boneColossusBody(0, 0, f === 0 ? 1 : 0, f === 0 ? 0 : 1),
  walk: (f) => boneColossusBody([1, 0, -1, 0][f], 0, 1, f === 1 ? 1 : 0),
  attack: (s) => (s === 0 ? boneColossusBody(0, 1, 2, -1) : s === 1 ? boneColossusBody(0, 2, 2, 2) : boneColossusBody(0, 0, 1, 1)),
  hit: (settled) => boneColossusBody(0, 0, settled ? 1 : 2, settled ? 1 : 3),
  special: (s) => boneColossusBody(0, 1, s === 0 ? 1 : 2, -1),
  death: (s) => {
    // the ribcage bursts outward and the soul-core escapes upward before the
    // skeleton drops - a collapse of separated bones, not one folding body
    const g = makeGrid(38, 38);
    const drop = s * 3;
    const scatter = s * 3;
    // escaping soul-core rising and fading
    if (s < 3) fillRectShaded(g, 16, 14 - s * 4, 21, 19 - s * 4, s === 0 ? '2' : 's', 't', 'z');
    // skull falling forward
    if (s < 3) {
      fillRectShaded(g, 12 + s, 16 + drop, 25 + s, 25 + drop, 'h', 'i', 'j');
      stampEyes(g, 14 + s, 22 + s, 19 + drop, 2, 2, '1', '1');
    } else {
      fillRectShaded(g, 14, 30, 27, 37, 'h', 'i', 'j');
    }
    // rib bars flung apart
    for (let r = 0; r < 4; r++) {
      const ry = 28 + r;
      fillRectShaded(g, 6 - scatter + r * 2, ry + drop / 2, 14 - scatter + r * 2, ry + drop / 2, 'b', 'c', 'd');
      fillRectShaded(g, 23 + scatter - r * 2, ry + drop / 2, 31 + scatter - r * 2, ry + drop / 2, 'b', 'c', 'd');
    }
    // fists and leg bones dropping to the floor
    fillRectShaded(g, 1, 34, 9, 37, 'a', 'l', 'q');
    fillRectShaded(g, 28, 34, 36, 37, 'a', 'l', 'q');
    fillRect(g, 12, 36, 26, 37, 'p');
    return g;
  },
  fps: { idle: 1.4, walk: 6, attack: 6.5, hit: 9, special: 4, death: 6.5 },
};

// ===========================================================================
// DUSKFANG - spectral hound. Silhouette: the only quadruped boss - low, wide
// and fast-reading, with a jagged spine ridge, a long jutting jaw and burning
// cyan eyes. Its attack in WaveDirector is a Pounce Combo (a line of
// telegraphs advancing through the player), so the pose set is literally
// windup -> pounce -> landing:
//   special  = WINDUP  - haunches raised, chest to the floor, coiled to spring
//   attack 0 = POUNCE  - launched off the ground, body stretched, legs tucked
//   attack 1 = POUNCE peak - fully extended, jaws open, still airborne
//   attack 2 = LANDING - front legs slammed down, body compressed, dust kick
// Grid 32x32, body occupying the lower rows so it reads low-slung.
// ===========================================================================
const DUSKFANG_PALETTE: Record<string, string> = {
  h: '#2e2140', i: '#4a3663', j: '#150e1f',
  e: '#7ef7ff', g: '#e8ffff',
  b: '#312244', c: '#54407a', d: '#0f0a18',
  a: '#0c0714',
  m: '#241a32', l: '#3d2c52', q: '#0f0a16',
  n: '#c8d8e8',
  p: '#2a1e3a', r: '#453263', u: '#120c1a',
  o: '#0a0710',
  s: '#5f4726', t: '#7d5fa8', z: '#2f2044',
  '1': '#e8f8ff', '2': '#7ef7ff',
};

/**
 * `lift` raises the whole body off the ground (pounce), `rear` raises only the
 * haunches (windup coil), `stretch` extends the body length, `jaw` opens the
 * maw, `dust` stamps an impact kick under the front paws.
 */
function duskfangBody(gait: number, lift: number, rear: number, stretch: number, jaw: number, dust: number): string[][] {
  const g = makeGrid(32, 32);
  const base = 31 - lift;
  const backY = 12 - rear - lift;
  const frontY = 12 - lift + Math.round(rear / 2);

  // trailing spectral tail, fraying at the tip
  fillRectShaded(g, 0, backY + 2, 4, backY + 4, 'm', 'l', 'q');
  fillRect(g, 0, backY + 5, 2, backY + 6, 't');
  // raised haunches - a distinctly lighter mass than the barrel torso, so the
  // rear reads as a separate muscled block instead of the whole animal being
  // one flat purple silhouette
  fillRectShaded(g, 3, backY, 11, backY + 9, 'c', 't', 'd');
  fillRect(g, 4, backY + 6, 10, backY + 8, 'a'); // shadowed underside of the haunch
  // jagged spine ridge running the length of the back
  for (let k = 0; k < 6; k++) {
    const sx = 6 + k * 3;
    const sh = k === 2 || k === 3 ? 4 : 3;
    fillRectShaded(g, sx, backY - sh + Math.round((k * rear) / 6), sx + 1, backY + 1, 's', 't', 'z');
  }
  // low barrel torso, lengthened while airborne: bright dorsal line along the
  // spine, near-black underbelly, so the body has a top-lit round volume
  // rather than reading as one flat slab
  fillRectShaded(g, 8, frontY, 22 + stretch, frontY + 8, 'b', 'c', 'd');
  fillRect(g, 9, frontY + 1, 21 + stretch, frontY + 1, 'c');
  fillRect(g, 10, frontY + 6, 21 + stretch, frontY + 8, 'a');
  // rib/muscle striations catching the light across the flank
  for (let k = 0; k < 4; k++) fillRect(g, 11 + k * 3, frontY + 2, 11 + k * 3, frontY + 5, 'd');
  // head thrust forward and low, long jaw
  const hx = 20 + stretch;
  fillRectShaded(g, hx, frontY - 2, hx + 8, frontY + 5, 'h', 'i', 'j');
  fillRectShaded(g, hx + 1, frontY - 5, hx + 2, frontY - 2, 'h', 'i', 'j'); // ears
  fillRectShaded(g, hx + 5, frontY - 5, hx + 6, frontY - 2, 'h', 'i', 'j');
  stampEyes(g, hx + 2, hx + 6, frontY, 2, 2);
  // muzzle + hinged lower jaw that drops when `jaw` is set
  fillRectShaded(g, hx + 6, frontY + 2, hx + 11, frontY + 4, 'h', 'i', 'j');
  fillRect(g, hx + 11, frontY + 2, hx + 11, frontY + 2, 'j'); // nose
  fillRectShaded(g, hx + 5, frontY + 5 + jaw * 2, hx + 10, frontY + 6 + jaw * 2, 'h', 'i', 'j');
  stampFangs(g, hx + 5, hx + 10, frontY + 4 + jaw * 2, '1');
  if (jaw) stampFangs(g, hx + 6, hx + 10, frontY + 5 + jaw * 2, '1');

  // four legs. While airborne (lift > 0) they tuck instead of reaching down.
  if (lift > 0) {
    fillRectShaded(g, 5, backY + 8, 8, backY + 12, 'p', 'r', 'u');
    fillRectShaded(g, 9, backY + 9, 12, backY + 12, 'p', 'r', 'u');
    fillRectShaded(g, 17 + stretch, frontY + 7, 20 + stretch, frontY + 11, 'm', 'l', 'q');
    fillRectShaded(g, 21 + stretch, frontY + 7, 24 + stretch, frontY + 10, 'm', 'l', 'q');
    stampClaw(g, 4, backY + 13, 'n');
    stampClaw(g, 17 + stretch, frontY + 12, 'n');
  } else {
    fillRectShaded(g, 4, backY + 9, 7, base - 1 + gait, 'p', 'r', 'u');
    fillRectShaded(g, 9, backY + 9, 12, base - 1 - gait, 'p', 'r', 'u');
    fillRectShaded(g, 16 + stretch, frontY + 8, 19 + stretch, base - 1 - gait, 'm', 'l', 'q');
    fillRectShaded(g, 20 + stretch, frontY + 8, 23 + stretch, base - 1 + gait, 'm', 'l', 'q');
    fillRect(g, 3, base + gait, 8, base + gait, 'o');
    fillRect(g, 8, base - gait, 13, base - gait, 'o');
    fillRect(g, 15 + stretch, base - gait, 20 + stretch, base - gait, 'o');
    fillRect(g, 19 + stretch, base + gait, 24 + stretch, base + gait, 'o');
  }

  // landing impact: dust kicked up around the front paws
  if (dust) {
    fillRect(g, 13, 29, 16, 30, 't');
    fillRect(g, 24, 28, 27, 30, 't');
    fillRect(g, 10, 30, 12, 31, 's');
    fillRect(g, 27, 30, 30, 31, 's');
  }
  return g;
}

const DUSKFANG_ART: EnemyArt = {
  size: 32,
  palette: DUSKFANG_PALETTE,
  outline: '#080510',
  idle: (f) => duskfangBody(0, 0, f === 0 ? 0 : 1, 0, 0, 0),
  walk: (f) => duskfangBody([1, 0, -1, 0][f], 0, 0, 0, f === 1 ? 1 : 0, 0),
  // POUNCE (0,1) then LANDING (2) - see the header comment
  attack: (s) => (s === 0 ? duskfangBody(0, 4, 0, 2, 1, 0) : s === 1 ? duskfangBody(0, 6, 0, 4, 1, 0) : duskfangBody(0, 0, -2, 1, 1, 1)),
  hit: (settled) => duskfangBody(settled ? 0 : -1, 0, settled ? 1 : 2, 0, 1, 0),
  // WINDUP - haunches up, chest low, coiled to spring
  special: (s) => duskfangBody(0, 0, s === 0 ? 3 : 4, -1, s === 1 ? 1 : 0, 0),
  death: (s) => {
    // the hound's spectral body dissolves from the tail forward, dropping to
    // the floor as it goes - it never simply shrinks away
    const g = makeGrid(32, 32);
    const drop = s * 2;
    const eaten = s * 6; // how much of the rear has already dissolved
    fillRectShaded(g, 6 + eaten, 20 + drop, 24, 28 + drop, 'b', 'c', 'd');
    if (s < 3) {
      fillRectShaded(g, 21, 17 + drop, 29, 24 + drop, 'h', 'i', 'j');
      stampEyes(g, 23, 27, 19 + drop, 2, 2, 'e', s > 1 ? 'e' : 'g');
    } else {
      fillRectShaded(g, 20, 28, 29, 31, 'h', 'i', 'j');
    }
    // dissolving motes drifting off the dissolved end
    fillRect(g, 2 + s, 18 - s * 2, 4 + s, 20 - s * 2, 't');
    fillRect(g, 7 + s, 15 - s * 2, 9 + s, 16 - s * 2, 's');
    fillRect(g, 12, 12 - s * 2, 14, 13 - s * 2, 't');
    fillRect(g, 4, 30, 12 + eaten, 31, 'o'); // shadowed remains on the floor
    return g;
  },
  fps: { idle: 2.4, walk: 10, attack: 10, hit: 12, special: 6, death: 8 },
};

export function registerBossRosterSprites(): void {
  registerEnemyArt('boss_rotking', ROTKING_ART);
  registerEnemyArt('boss_bonecolossus', BONECOLOSSUS_ART);
  registerEnemyArt('boss_duskfang', DUSKFANG_ART);
}
