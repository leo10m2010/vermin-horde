import { spriteAtlas } from './SpriteAtlas';
import { drawPixelGrid, drawSoftCircle, makeGrid, fillRect, fillRectShaded, toRows } from './PixelDraw';

/**
 * POWER ART PASS.
 *
 * The playable roster (SpriteLibraryCharacters.ts) and the enemy roster
 * (SpriteLibraryEnemyArt.ts) both already ship outlined, shaded, multi-frame
 * pixel art. The weapons did not: they were flat `fillRect` blocks with 2-4
 * colour palettes and no outline, which is why a Magic Wand bolt or an Axe
 * read as placeholder geometry flying past a fully-rendered monster.
 *
 * Everything here follows the same contract as the character/enemy modules:
 *   - a 1px dark outline around the whole silhouette (`drawPixelGrid`'s
 *     `outlineColor`), so a projectile stays readable against both the pale
 *     bone of a skeleton and the near-black of the graveyard floor
 *   - `fillRectShaded` volume on every major mass under a top-left light
 *   - a hot core / cool rim value structure on anything magical, so it reads
 *     as emitting light rather than being a coloured block
 *   - real multi-frame animation where the weapon has a state to express
 *     (the whip's snap, the fireball's churn, the flask's splash)
 *
 * Evolved variants get their OWN clips (suffix `_evo`) rather than a tint
 * swap, because an evolution has to be visible at a glance.
 */

// Shared value-structure helper: a glowing orb with a white-hot core, a
// mid-tone body and a dark rim, built from per-row spans so it reads round
// instead of as a square block.
function paintOrb(g: string[][], cx: number, cy: number, r: number, core: string, mid: string, rim: string): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    const dy = y - cy;
    const half = Math.sqrt(Math.max(0, r * r - dy * dy));
    if (half <= 0) continue;
    const x0 = Math.round(cx - half);
    const x1 = Math.round(cx + half);
    fillRect(g, x0, y, x1, y, rim);
    if (half > 1.2) fillRect(g, x0 + 1, y, x1 - 1, y, mid);
    if (half > 2.4 && Math.abs(dy) < r * 0.55) fillRect(g, Math.round(cx - half * 0.45), y, Math.round(cx + half * 0.45), y, core);
  }
}

// ===========================================================================
// WHIP SLASH - a real lash, not a rectangle that blinks on.
// 5 frames: coil -> release -> extension -> SNAP -> recovery.
// Authored pointing RIGHT; WhipStrike mirrors it per side via setFacing(),
// and renders it into a NON-SQUARE quad via setSizeXY() so the cord stays
// long and thin instead of ballooning into a square that floats overhead.
// ===========================================================================
const WHIP_PALETTE: Record<string, string> = {
  a: '#fff4d0', // hot inner edge / highlight along the top of the cord
  b: '#ffd166', // cord body
  c: '#e08a2e', // cord shade (underside)
  d: '#9c4a12', // deep shade / grip
  t: '#fffdf2', // crack-tip flash
};

/** Grid is deliberately long and thin - the sprite is rendered into a
 * non-square quad via setSizeXY(), so the authored aspect must match. */
const WHIP_W = 44;
const WHIP_H = 18;
const WHIP_MID = 9;

/**
 * Draws one tapering, curved cord from the grip end (x=0) out to `len`.
 *
 * Two things make this read as a whip rather than a bar:
 *  - THICKNESS TAPERS from a few pixels at the grip to a single pixel at the
 *    tip, so the eye follows it outward,
 *  - the centreline follows a SINE CURVE whose amplitude grows toward the tip,
 *    so the cord bends like something flexible being cracked instead of
 *    sitting flat like a blade.
 * `phase` shifts where the curve's belly sits, which is what animates the
 * wave travelling down the cord between frames.
 */
function drawLash(g: string[][], len: number, amp: number, phase: number, baseThick: number): void {
  for (let x = 0; x <= len; x++) {
    const t = x / Math.max(1, len);
    // Curve: amplitude ramps up along the cord, so the base stays near the
    // hand and the tip whips furthest - the classic whip silhouette.
    const bend = Math.sin(t * Math.PI * 1.55 + phase) * amp * (0.35 + t * 0.85);
    const y = WHIP_MID + Math.round(bend);
    const thick = Math.max(1, Math.round(baseThick * (1 - t * 0.88)));
    const top = y - Math.floor(thick / 2);
    fillRect(g, x, top, x, top + thick - 1, 'b');
    fillRect(g, x, top, x, top, 'a'); // lit top edge
    if (thick > 1) fillRect(g, x, top + thick - 1, x, top + thick - 1, 'c'); // shaded underside
  }
}

/** Chunky grip/handle at the player end so the cord visibly comes FROM a hand. */
function drawGrip(g: string[][]): void {
  fillRectShaded(g, 0, WHIP_MID - 2, 3, WHIP_MID + 2, 'd', 'c', 'd');
  fillRect(g, 1, WHIP_MID - 1, 2, WHIP_MID - 1, 'c');
}

/**
 * 5-beat crack: coil -> release -> extension -> SNAP -> recovery.
 * The tip travels much further than the base across the sequence, which is
 * the whole point - a rigid bar would translate uniformly.
 */
function whipGrid(stage: number): string[][] {
  const g = makeGrid(WHIP_W, WHIP_H);
  drawGrip(g);
  if (stage === 0) {
    // COIL: short, tightly curled back near the hand, storing the snap.
    drawLash(g, 12, 4.6, 2.2, 6);
    fillRect(g, 10, WHIP_MID - 6, 12, WHIP_MID - 5, 'c');
  } else if (stage === 1) {
    // RELEASE: uncoiling, a deep belly in the cord as it starts to travel.
    drawLash(g, 23, 4.2, 1.15, 6);
  } else if (stage === 2) {
    // EXTENSION: most of the length out, the wave running toward the tip.
    drawLash(g, 35, 3.6, 0.45, 5);
  } else if (stage === 3) {
    // SNAP: fully extended, nearly straight, thin white-hot tip + crack spark.
    drawLash(g, 43, 2.6, 0.15, 5);
    fillRect(g, 41, WHIP_MID + 1, 43, WHIP_MID + 2, 't');
    fillRect(g, 42, WHIP_MID - 1, 43, WHIP_MID, 't');
    fillRect(g, 39, WHIP_MID + 4, 41, WHIP_MID + 5, 'a');
  } else {
    // RECOVERY: tension gone, a thin slack after-image falling away.
    for (let x = 2; x <= 30; x++) {
      const t = x / 30;
      const y = WHIP_MID + Math.round(Math.sin(t * Math.PI * 0.9 + 2.6) * 4.0 * t);
      fillRect(g, x, y, x, y, x % 3 === 0 ? 'b' : 'c');
    }
  }
  return g;
}

/**
 * SERPENT'S COIL (evolved). Same cord, same 5-beat crack, same thickness -
 * it must still read as the SAME weapon, just awakened. The differences are
 * deliberately small and specific rather than "the green one":
 *   - venom energy travelling ALONG the cord as bright nodes that slide
 *     outward frame by frame, so the lash looks charged rather than tinted,
 *   - a forked, slightly serpentine TIP instead of a plain taper,
 *   - a short afterimage trailing the cord's previous position,
 *   - venom motes spitting off the tip on the snap.
 */
function serpentGrid(stage: number): string[][] {
  const g = makeGrid(WHIP_W, WHIP_H);

  // Afterimage first, so the live cord paints over it: a faint copy of the
  // PREVIOUS beat's shape, which reads as motion blur on a fast lash.
  if (stage > 0 && stage < 4) {
    const prev = [0, 12, 23, 35][stage];
    const prevAmp = [0, 4.6, 4.2, 3.6][stage];
    const prevPhase = [0, 2.2, 1.15, 0.45][stage];
    for (let x = 0; x <= prev; x++) {
      const t = x / Math.max(1, prev);
      const bend = Math.sin(t * Math.PI * 1.55 + prevPhase) * prevAmp * (0.35 + t * 0.85);
      fillRect(g, x, WHIP_MID + Math.round(bend) + 1, x, WHIP_MID + Math.round(bend) + 1, 'g');
    }
  }

  drawGrip(g);

  const len = [12, 23, 35, 43, 30][stage];
  const amp = [4.6, 4.2, 3.6, 2.6, 3.2][stage];
  const phase = [2.2, 1.15, 0.45, 0.15, 2.6][stage];
  const thick = [6, 6, 5, 5, 3][stage];
  drawLash(g, len, amp, phase, thick);

  // Venom nodes sliding outward along the cord, one step further each beat.
  for (let n = 0; n < 3; n++) {
    const nodeT = (0.18 + n * 0.28 + stage * 0.12) % 1.0;
    const x = Math.round(nodeT * len);
    if (x < 2 || x > len) continue;
    const bend = Math.sin(nodeT * Math.PI * 1.55 + phase) * amp * (0.35 + nodeT * 0.85);
    const y = WHIP_MID + Math.round(bend);
    fillRect(g, x, y - 1, x, y + 1, 'e');
    fillRect(g, x, y, x, y, 't');
  }

  if (stage === 3) {
    // Forked serpent tongue at the tip + venom motes spat off the crack.
    const tipY = WHIP_MID + Math.round(Math.sin(Math.PI * 1.55 + 0.15) * 2.6 * 1.2);
    fillRect(g, 43, tipY - 2, 43, tipY - 1, 't');
    fillRect(g, 43, tipY + 1, 43, tipY + 2, 't');
    fillRect(g, 42, tipY, 43, tipY, 'e');
    fillRect(g, 40, tipY + 4, 41, tipY + 5, 'e');
    fillRect(g, 38, tipY - 4, 39, tipY - 3, 'e');
  }
  return g;
}

function registerWhip(): void {
  spriteAtlas.registerClip('whip_slash', 26, false, [0, 1, 2, 3, 4].map((i) => ({
    key: `whip_slash_${i}`,
    draw: (ctx: CanvasRenderingContext2D, s: number) => drawPixelGrid(ctx, s, toRows(whipGrid(i)), WHIP_PALETTE, '#3a1c05'),
  })));
  const evoPalette = {
    a: '#e8ffd0', b: '#7fd94a', c: '#3f8a24', d: '#1f5210',
    t: '#ffffff', e: '#c8ff6a', g: 'rgba(126,217,74,0.35)',
  };
  spriteAtlas.registerClip('whip_slash_evo', 26, false, [0, 1, 2, 3, 4].map((i) => ({
    key: `whip_slash_evo_${i}`,
    draw: (ctx: CanvasRenderingContext2D, s: number) => drawPixelGrid(ctx, s, toRows(serpentGrid(i)), evoPalette, '#0d2606'),
  })));
}

/** Authored aspect ratio (width / height) of the lash sprite, so the weapon can size its quad to match. */
export const WHIP_SPRITE_ASPECT = WHIP_W / WHIP_H;

// ===========================================================================
// AXE - a real hand axe: shaded steel head with a bevelled edge, bound haft,
// leather grip. Spins in flight (ProjectileManager drives `spins`).
// ===========================================================================
const AXE_PALETTE: Record<string, string> = {
  m: '#c8ccd4', h: '#f2f5fa', d: '#6b7280', // steel
  w: '#8a5a2e', x: '#b07a44', y: '#4a2d13', // haft
  v: '#3a2410', // grip wrap
  s: '#ffffff', // edge glint
};

function axeGrid(): string[][] {
  const g = makeGrid(18, 18);

  // LONG THIN HAFT running most of the diagonal. The old version had a stubby
  // haft under a symmetric double-bit head, which at gameplay scale read as a
  // hammer. A hacha needs a visibly long shaft and an ASYMMETRIC head.
  fillRectShaded(g, 8, 3, 9, 17, 'w', 'x', 'y');
  fillRect(g, 8, 11, 9, 13, 'v'); // leather grip wrap
  fillRect(g, 7, 16, 10, 17, 'v'); // pommel

  // ONE BIG BLADE with a curved cutting edge, swept forward from the socket.
  // Built as per-row spans so the edge is a genuine crescent rather than a box.
  for (let y = 1; y <= 9; y++) {
    const t = (y - 1) / 8; // 0 at the top of the blade, 1 at the bottom
    // Edge bulges outward in the middle - the classic axe crescent.
    const reach = Math.round(3 + Math.sin(t * Math.PI) * 4.6);
    fillRect(g, 10, y, 10 + reach, y, 'm');
    fillRect(g, 10 + reach - 1, y, 10 + reach, y, 'h'); // bright honed edge
    if (y > 2 && y < 8) fillRect(g, 10, y, 11, y, 'd'); // shadow at the socket
  }
  // Top and bottom horns of the blade, tapering to points.
  fillRect(g, 10, 0, 12, 0, 'm');
  fillRect(g, 10, 10, 12, 10, 'm');

  // SMALL BACK SPIKE - much smaller than the blade, which is what makes the
  // head asymmetric and unmistakably an axe rather than a hammer.
  fillRectShaded(g, 5, 4, 7, 7, 'm', 'h', 'd');
  fillRect(g, 4, 5, 5, 6, 'd');

  // Socket band where the head grips the haft.
  fillRect(g, 8, 3, 9, 9, 'y');
  fillRect(g, 7, 4, 10, 4, 'd');
  fillRect(g, 7, 8, 10, 8, 'd');
  return g;
}

function registerAxe(): void {
  spriteAtlas.registerClip('proj_axe', 1, true, [
    { key: 'proj_axe_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(axeGrid()), AXE_PALETTE, '#16181c') },
  ]);
  const evoPalette = { ...AXE_PALETTE, m: '#ffd98a', h: '#fff6d4', d: '#b3792a', s: '#ffffff' };
  spriteAtlas.registerClip('proj_axe_evo', 1, true, [
    { key: 'proj_axe_evo_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(axeGrid()), evoPalette, '#3d2405') },
  ]);
  // Flat ground shadow that tracks a thrown object's landing point.
  spriteAtlas.registerClip('fx_toss_shadow', 1, true, [
    { key: 'fx_toss_shadow_0', draw: (ctx, s) => drawSoftCircle(ctx, s / 2, s / 2, s * 0.42, 'rgba(0,0,0,0.85)', 1) },
  ]);
}

// ===========================================================================
// MAGIC WAND BOLT - small, fast, clean. A pointed arcane dart with a bright
// core and a cool trailing tail, NOT a fat glowing ball (that is Fireball's
// job - the two must never be confused at a glance).
// ===========================================================================
function boltGrid(frame: number): string[][] {
  const g = makeGrid(16, 10);
  const pulse = frame === 0 ? 0 : 1;
  // trailing tail, thinning backwards
  fillRect(g, 0, 5, 3, 5, 'd');
  fillRect(g, 3, 4, 6, 6, 'm');
  // body
  fillRectShaded(g, 6, 3, 11, 7, 'm', 'h', 'd');
  // sharp leading point
  fillRect(g, 12, 4, 13, 6, 'h');
  fillRect(g, 14, 5, 14 + pulse, 5, 'c');
  // white-hot core
  fillRect(g, 8, 4, 10, 6, 'c');
  fillRect(g, 9, 5, 9, 5, 'w');
  return g;
}

function registerBolt(): void {
  const palette = { m: '#5aa8ff', h: '#a8d6ff', d: '#1f4f9c', c: '#e8f4ff', w: '#ffffff' };
  spriteAtlas.registerClip('bolt_basic', 14, true, [
    { key: 'bolt_basic_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(boltGrid(0)), palette, '#0a1c38') },
    { key: 'bolt_basic_1', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(boltGrid(1)), palette, '#0a1c38') },
  ]);
  // Evolved Staff of the Archmage: violet-white, hotter core.
  const evo = { m: '#c07aff', h: '#e8c4ff', d: '#5f2199', c: '#f8eaff', w: '#ffffff' };
  spriteAtlas.registerClip('bolt_basic_evo', 16, true, [
    { key: 'bolt_evo_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(boltGrid(0)), evo, '#1d0838') },
    { key: 'bolt_evo_1', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(boltGrid(1)), evo, '#1d0838') },
  ]);
}

// ===========================================================================
// KNIFE - slim thrown dagger with a real blade, crossguard and wrapped grip.
// ===========================================================================
function knifeGrid(): string[][] {
  const g = makeGrid(18, 8);
  // blade: tapering point on the right, fuller line down the middle
  fillRectShaded(g, 6, 2, 14, 5, 'b', 'h', 'd');
  fillRect(g, 15, 3, 16, 4, 'h'); // tip
  fillRect(g, 7, 3, 13, 3, 'h'); // fuller highlight
  fillRect(g, 7, 5, 13, 5, 'd');
  // crossguard
  fillRectShaded(g, 4, 1, 5, 6, 'g', 'k', 'j');
  // wrapped grip + pommel
  fillRectShaded(g, 1, 3, 4, 5, 'w', 'x', 'y');
  fillRect(g, 2, 3, 2, 5, 'y');
  fillRect(g, 0, 3, 1, 5, 'g');
  return g;
}

function registerKnife(): void {
  const palette = { b: '#d8dde6', h: '#ffffff', d: '#7b828e', g: '#c9a227', k: '#f0dc8a', j: '#7a5f12', w: '#5a3a20', x: '#7d5430', y: '#2e1c0e' };
  spriteAtlas.registerClip('proj_knife', 1, true, [
    { key: 'proj_knife_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(knifeGrid()), palette, '#14161a') },
  ]);
  const evo = { ...palette, b: '#9ef0ff', h: '#ffffff', d: '#2f7f96', g: '#e8f9ff', k: '#ffffff', j: '#2f7f96' };
  spriteAtlas.registerClip('proj_knife_evo', 1, true, [
    { key: 'proj_knife_evo_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(knifeGrid()), evo, '#08222b') },
  ]);
}

// ===========================================================================
// FIREBALL - heavy, churning, unmistakably NOT the wand bolt: big round mass,
// white core, licking flames, dark smoke edge.
// ===========================================================================
function fireballGrid(frame: number): string[][] {
  const g = makeGrid(20, 20);
  const wobble = frame === 0 ? 0 : 1;
  paintOrb(g, 9.5, 10, 7, 'c', 'm', 'd');
  paintOrb(g, 9.5, 10, 4, 'w', 'c', 'm');
  // flames licking off the trailing edge
  fillRect(g, 0, 7 + wobble, 3, 8 + wobble, 'm');
  fillRect(g, 1, 11 - wobble, 4, 12 - wobble, 'd');
  fillRect(g, 2, 4 + wobble, 4, 5 + wobble, 'd');
  fillRect(g, 3, 15, 6, 16 - wobble, 'm');
  // hot leading edge
  fillRect(g, 16, 9, 17, 11, 'c');
  return g;
}

function registerFireball(): void {
  const palette = { m: '#ff6a1f', c: '#ffd35c', d: '#a32d05', w: '#fffbe8' };
  spriteAtlas.registerClip('fireball', 12, true, [
    { key: 'fireball_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(fireballGrid(0)), palette, '#3d1201') },
    { key: 'fireball_1', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(fireballGrid(1)), palette, '#3d1201') },
  ]);
  // Evolved Inferno Core: blue-white heat, the hottest thing on screen.
  const evo = { m: '#4fa8ff', c: '#c8ecff', d: '#12407f', w: '#ffffff' };
  spriteAtlas.registerClip('fireball_evo', 14, true, [
    { key: 'fireball_evo_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(fireballGrid(0)), evo, '#04203f') },
    { key: 'fireball_evo_1', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(fireballGrid(1)), evo, '#04203f') },
  ]);
}

// ===========================================================================
// HOLY BLADE - orbiting blade with its own volume and a bright edge.
// ===========================================================================
function holyBladeGrid(): string[][] {
  const g = makeGrid(10, 18);
  fillRect(g, 4, 0, 5, 1, 'w'); // point
  fillRectShaded(g, 3, 1, 6, 11, 'b', 'w', 'd');
  fillRect(g, 4, 2, 5, 9, 'c'); // glowing fuller
  fillRectShaded(g, 1, 11, 8, 12, 'g', 'k', 'j'); // crossguard
  fillRectShaded(g, 4, 13, 5, 16, 'h', 'k', 'j'); // grip
  fillRect(g, 3, 16, 6, 17, 'g'); // pommel
  return g;
}

function registerHolyBlade(): void {
  const palette = { b: '#8fd6ff', w: '#ffffff', d: '#2f6f96', c: '#e8faff', g: '#e8c96a', k: '#fff3c0', j: '#8a6a1c', h: '#7a5a28' };
  spriteAtlas.registerClip('orbiter_blade', 1, true, [
    { key: 'orbiter_blade_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(holyBladeGrid()), palette, '#0b2333') },
  ]);
  const evo = { ...palette, b: '#ffe9a3', c: '#fffbe8', d: '#b3872a' };
  spriteAtlas.registerClip('orbiter_blade_evo', 1, true, [
    { key: 'orbiter_blade_evo_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(holyBladeGrid()), evo, '#3a2a05') },
  ]);
}

// ===========================================================================
// ARC CROSS - boomerang cross. The OUT and RETURN phases get separate clips
// so the player can tell at a glance which way it is travelling.
// ===========================================================================
function crossGrid(): string[][] {
  const g = makeGrid(16, 16);
  fillRectShaded(g, 6, 0, 9, 15, 'b', 'h', 'd'); // vertical arm
  fillRectShaded(g, 0, 5, 15, 9, 'b', 'h', 'd'); // horizontal arm
  fillRectShaded(g, 5, 5, 10, 9, 'c', 'w', 'd'); // bright hub
  fillRect(g, 7, 6, 8, 8, 'w');
  fillRect(g, 7, 0, 8, 1, 'w'); // tips
  fillRect(g, 0, 6, 1, 8, 'w');
  fillRect(g, 14, 6, 15, 8, 'w');
  fillRect(g, 7, 14, 8, 15, 'w');
  return g;
}

function registerArcCross(): void {
  // OUT: cool steel-blue. RETURN: warm gold - same shape, unmistakably
  // different colour temperature, which is the cheapest possible way to make
  // the two phases readable without changing the silhouette.
  const out = { b: '#b9c7d8', h: '#e8f1ff', d: '#5a6b80', c: '#8fd6ff', w: '#ffffff' };
  const back = { b: '#e8c96a', h: '#fff3c0', d: '#8a6a1c', c: '#ffe9a3', w: '#ffffff' };
  spriteAtlas.registerClip('proj_cross', 1, true, [
    { key: 'proj_cross_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(crossGrid()), out, '#141a22') },
  ]);
  spriteAtlas.registerClip('proj_cross_return', 1, true, [
    { key: 'proj_cross_return_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(crossGrid()), back, '#2e2205') },
  ]);
  const evo = { b: '#ffffff', h: '#ffffff', d: '#c9a227', c: '#fff8d8', w: '#ffffff' };
  spriteAtlas.registerClip('proj_cross_evo', 1, true, [
    { key: 'proj_cross_evo_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(crossGrid()), evo, '#4a3a08') },
  ]);
}

// ===========================================================================
// EMBER BOLT - heavy, slow, molten. Deliberately chunkier than both the wand
// bolt and the fireball, with a cracked-magma surface.
// ===========================================================================
function emberGrid(frame: number): string[][] {
  const g = makeGrid(18, 14);
  paintOrb(g, 8.5, 7, 6.2, 'c', 'm', 'd');
  // cracked crust: dark fissures over the molten body
  fillRect(g, 5, 5, 11, 5, 'd');
  fillRect(g, 7, 8, 12, 8, 'd');
  fillRect(g, 6, 10 - (frame === 0 ? 0 : 1), 9, 10 - (frame === 0 ? 0 : 1), 'd');
  // white-hot vents
  fillRect(g, 7, 6, 9, 7, 'w');
  fillRect(g, 11, 9, 12, 9, 'c');
  // trailing embers
  fillRect(g, 0, 6 + (frame === 0 ? 0 : 1), 2, 7, 'm');
  fillRect(g, 1, 10, 3, 11 - (frame === 0 ? 1 : 0), 'd');
  return g;
}

function registerEmber(): void {
  const palette = { m: '#ff8a2b', c: '#ffe08a', d: '#7a2205', w: '#fffdf0' };
  spriteAtlas.registerClip('proj_ember', 9, true, [
    { key: 'proj_ember_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(emberGrid(0)), palette, '#2e0d01') },
    { key: 'proj_ember_1', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(emberGrid(1)), palette, '#2e0d01') },
  ]);
  const evo = { m: '#c05cff', c: '#f0d0ff', d: '#4a0f7a', w: '#ffffff' };
  spriteAtlas.registerClip('proj_ember_evo', 11, true, [
    { key: 'proj_ember_evo_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(emberGrid(0)), evo, '#1c0430') },
    { key: 'proj_ember_evo_1', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(emberGrid(1)), evo, '#1c0430') },
  ]);
}

// ===========================================================================
// RUNE SHARD - jagged crystal splinter with a glyph face. Its erratic path is
// the identity, so the sprite is angular and asymmetric on purpose.
// ===========================================================================
function runeGrid(frame: number): string[][] {
  const g = makeGrid(14, 14);
  // angular splinter
  fillRectShaded(g, 5, 0, 8, 3, 'b', 'h', 'd');
  fillRectShaded(g, 3, 3, 10, 8, 'b', 'h', 'd');
  fillRectShaded(g, 5, 8, 8, 12, 'b', 'h', 'd');
  fillRect(g, 2, 5, 3, 7, 'd');
  fillRect(g, 10, 4, 11, 6, 'd');
  // glyph burning on the face, flickering between frames
  fillRect(g, 6, 4, 7, 4, 'w');
  fillRect(g, 5, 5, 8, 5, frame === 0 ? 'w' : 'c');
  fillRect(g, 6, 6, 7, 7, 'w');
  fillRect(g, 5, 8, 8, 8, frame === 0 ? 'c' : 'w');
  return g;
}

function registerRune(): void {
  const palette = { b: '#b98aff', h: '#e2ccff', d: '#4f2199', c: '#d8b8ff', w: '#ffffff' };
  spriteAtlas.registerClip('proj_rune', 12, true, [
    { key: 'proj_rune_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(runeGrid(0)), palette, '#1a0733') },
    { key: 'proj_rune_1', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(runeGrid(1)), palette, '#1a0733') },
  ]);
  const evo = { b: '#7effc8', h: '#d8fff0', d: '#0f7a52', c: '#b0ffe0', w: '#ffffff' };
  spriteAtlas.registerClip('proj_rune_evo', 14, true, [
    { key: 'proj_rune_evo_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(runeGrid(0)), evo, '#03291b') },
    { key: 'proj_rune_evo_1', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(runeGrid(1)), evo, '#03291b') },
  ]);
}

// ===========================================================================
// HEX FLASK - a real glass bottle: cork, neck, shoulders, sloshing contents
// with a liquid surface line and a glass highlight.
// ===========================================================================
function flaskGrid(frame: number): string[][] {
  const g = makeGrid(14, 16);
  const slosh = frame === 0 ? 0 : 1;
  fillRectShaded(g, 5, 0, 8, 2, 'k', 'l', 'j'); // cork
  fillRectShaded(g, 5, 2, 8, 5, 'g', 'w', 'd'); // neck
  fillRectShaded(g, 3, 5, 10, 7, 'g', 'w', 'd'); // shoulders
  fillRectShaded(g, 2, 7, 11, 14, 'g', 'w', 'd'); // body
  fillRect(g, 2, 15, 11, 15, 'd'); // base
  // sloshing contents with a visible surface line
  fillRect(g, 3, 9 + slosh, 10, 14, 'p');
  fillRect(g, 3, 9 + slosh, 10, 9 + slosh, 'q');
  fillRect(g, 4, 11, 6, 13, 'q'); // bubble
  // glass highlight down the left shoulder
  fillRect(g, 3, 6, 3, 11, 'w');
  return g;
}

function registerHexFlask(): void {
  const palette = { g: '#8fa8b8', w: '#dff0f8', d: '#3f5866', k: '#8a5a2e', l: '#b07a44', j: '#4a2d13', p: '#7ce06b', q: '#c8ff9e' };
  spriteAtlas.registerClip('proj_hexflask', 8, true, [
    { key: 'proj_hexflask_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(flaskGrid(0)), palette, '#101c22') },
    { key: 'proj_hexflask_1', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(flaskGrid(1)), palette, '#101c22') },
  ]);
  const evo = { ...palette, p: '#c05cff', q: '#eec4ff' };
  spriteAtlas.registerClip('proj_hexflask_evo', 8, true, [
    { key: 'proj_hexflask_evo_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(flaskGrid(0)), evo, '#1a0a26') },
    { key: 'proj_hexflask_evo_1', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(flaskGrid(1)), evo, '#1a0a26') },
  ]);
}

// ===========================================================================
// IMPACT / CAST FX - shared small bursts. Pooled through ProjectileManager
// like everything else, so they cost no extra draw call.
// ===========================================================================
function registerImpacts(): void {
  // Metallic tick for knife/axe hits: a short cross of sparks.
  const spark = makeGrid(12, 12);
  fillRect(spark, 5, 1, 6, 10, 's');
  fillRect(spark, 1, 5, 10, 6, 's');
  fillRect(spark, 4, 4, 7, 7, 'w');
  fillRect(spark, 2, 2, 3, 3, 's');
  fillRect(spark, 8, 8, 9, 9, 's');
  spriteAtlas.registerClip('fx_impact_metal', 1, true, [
    { key: 'fx_impact_metal_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(spark), { s: '#ffe9a3', w: '#ffffff' }) },
  ]);

  // Arcane pop for wand/rune hits.
  const pop = makeGrid(12, 12);
  fillRect(pop, 4, 2, 7, 9, 'a');
  fillRect(pop, 2, 4, 9, 7, 'a');
  fillRect(pop, 4, 4, 7, 7, 'w');
  spriteAtlas.registerClip('fx_impact_arcane', 1, true, [
    { key: 'fx_impact_arcane_0', draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(pop), { a: '#9ec8ff', w: '#ffffff' }) },
  ]);

  // Fireball detonation: expanding ring of flame, three frames.
  for (let f = 0; f < 3; f++) {
    spriteAtlas.registerClip(`fx_explosion_${f}`, 1, true, [
      {
        key: `fx_explosion_${f}_0`,
        draw: (ctx, s) => {
          drawSoftCircle(ctx, s / 2, s / 2, s * (0.26 + f * 0.11), '#ff6a1f', 0.9 - f * 0.24);
          drawSoftCircle(ctx, s / 2, s / 2, s * (0.15 + f * 0.07), '#ffd35c', 1 - f * 0.22);
          if (f < 2) drawSoftCircle(ctx, s / 2, s / 2, s * (0.07 + f * 0.04), '#fffbe8', 1);
        },
      },
    ]);
  }
}

export function registerPowerSprites(): void {
  registerWhip();
  registerAxe();
  registerBolt();
  registerKnife();
  registerFireball();
  registerHolyBlade();
  registerArcCross();
  registerEmber();
  registerRune();
  registerHexFlask();
  registerImpacts();
}
