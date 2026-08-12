import { spriteAtlas } from './SpriteAtlas';
import { drawPixelGrid, makeGrid, fillRect, fillRectShaded, toRows } from './PixelDraw';

/**
 * Shared authoring contract for every enemy and boss sprite, deliberately the
 * SAME readability skeleton `SpriteLibraryCharacters.ts` established for the
 * playable roster - because the two have to look like they belong to one game
 * when they stand next to each other. Before this module the enemy roster was
 * authored with flat `fillRect` blocks and no outline at all (zero
 * `fillRectShaded` calls, zero `outlineColor` arguments in the whole file),
 * which is exactly why they read as prototype placeholders beside the shaded,
 * outlined, multi-pose characters.
 *
 * Non-negotiables every creature below honors:
 *   - a 1px dark outline stamped around the whole silhouette (via
 *     `drawPixelGrid`'s `outlineColor`) - the single biggest lever between
 *     "flat color blob" and "real pixel-art creature"
 *   - EVERY major mass (skull, torso, limbs, wings, armor plate, weapon head)
 *     painted with `fillRectShaded` under a consistent top-left light source,
 *     never a flat fill. Plain `fillRect` stays reserved for genuinely thin
 *     details (eyes, teeth, claws, straps, cracks) where a bevel is just noise.
 *   - a real face wherever the creature has a head: two separate eyes with a
 *     gap between them, each with a bright gleam pixel, plus teeth/jaw/beak
 *     detail - never one blank slit
 *   - readable extremities: claws, hooves, talons or feet in their own darker
 *     shade so the silhouette doesn't fuse into one mass at horde scale
 *   - a SQUARE grid whose bottom row is the creature's ground contact, so the
 *     feet-anchored billboard quad plants it on the floor (see
 *     InstancedBillboardBatch's [0,1] y-span). Flyers - bat, ghost - are the
 *     deliberate exception: they leave their bottom rows empty so they hover.
 *
 * Palette-key convention (same letter = same "slot" for every creature, even
 * though the hex differs, so the coordinate code stays readable across the
 * whole roster - mirrors the character file's convention):
 *   h/i/j = head or skull base/highlight/shadow     e/g = eye pupil/gleam
 *   b/c/d = torso base/highlight/shadow             a = torso accent
 *   m/l/q = limb base/highlight/shadow              n = claw/hand (flat)
 *   p/r/u = leg base/highlight/shadow               o = foot/hoof (flat)
 *   w/x/y = weapon or prop base/highlight/shadow    v = grip (flat)
 *   s/t/z = signature feature base/highlight/shadow (wings, crown, shell...)
 *   '1'..'4' = small flat one-off details (teeth, cracks, rivets, gems)
 */

/** One full pose set per creature. Every creature authors all six - the
 * animation system (EnemyManager) resolves missing ones back to walk, but the
 * point of this pass is that none are missing. */
export interface EnemyArt {
  /** Square grid side. Bigger = finer detail; scale it with the creature's world size. */
  size: number;
  palette: Record<string, string>;
  outline: string;
  /** frame 0..1 - subtle breathing/hover, no ground travel. */
  idle: (frame: number) => string[][];
  /** frame 0..3 - full stride/flap cycle. */
  walk: (frame: number) => string[][];
  /** stage 0..2 - windup, strike, recover. */
  attack: (stage: number) => string[][];
  /** settled=false is the recoil extreme, true is the settle-back frame. */
  hit: (settled: boolean) => string[][];
  /** stage 0..1 - the charge/telegraph tell held while an attack is winding up. */
  special: (stage: number) => string[][];
  /** stage 0..3 - collapse to a heap / dissipate. */
  death: (stage: number) => string[][];
  fps: { idle: number; walk: number; attack: number; hit: number; special: number; death: number };
}

/**
 * Registers all six clips for one creature under `${prefix}_idle|_walk|
 * _attack|_hit|_special|_death`. `prefix` keeps the existing naming that
 * EnemyTypes.ts already points at (`enemy_grunt`, `boss_rotking`, ...) so the
 * walk clip name is unchanged and only siblings are added.
 */
export function registerEnemyArt(prefix: string, art: EnemyArt): void {
  const paint = (g: string[][]) => (ctx: CanvasRenderingContext2D, size: number) =>
    drawPixelGrid(ctx, size, toRows(g), art.palette, art.outline);

  spriteAtlas.registerClip(`${prefix}_idle`, art.fps.idle, true, [
    { key: `${prefix}_idle_0`, draw: paint(art.idle(0)) },
    { key: `${prefix}_idle_1`, draw: paint(art.idle(1)) },
  ]);
  spriteAtlas.registerClip(`${prefix}_walk`, art.fps.walk, true, [
    { key: `${prefix}_walk_0`, draw: paint(art.walk(0)) },
    { key: `${prefix}_walk_1`, draw: paint(art.walk(1)) },
    { key: `${prefix}_walk_2`, draw: paint(art.walk(2)) },
    { key: `${prefix}_walk_3`, draw: paint(art.walk(3)) },
  ]);
  spriteAtlas.registerClip(`${prefix}_attack`, art.fps.attack, false, [
    { key: `${prefix}_attack_0`, draw: paint(art.attack(0)) },
    { key: `${prefix}_attack_1`, draw: paint(art.attack(1)) },
    { key: `${prefix}_attack_2`, draw: paint(art.attack(2)) },
  ]);
  spriteAtlas.registerClip(`${prefix}_hit`, art.fps.hit, false, [
    { key: `${prefix}_hit_0`, draw: paint(art.hit(false)) },
    { key: `${prefix}_hit_1`, draw: paint(art.hit(true)) },
  ]);
  spriteAtlas.registerClip(`${prefix}_special`, art.fps.special, true, [
    { key: `${prefix}_special_0`, draw: paint(art.special(0)) },
    { key: `${prefix}_special_1`, draw: paint(art.special(1)) },
  ]);
  spriteAtlas.registerClip(`${prefix}_death`, art.fps.death, false, [
    { key: `${prefix}_death_0`, draw: paint(art.death(0)) },
    { key: `${prefix}_death_1`, draw: paint(art.death(1)) },
    { key: `${prefix}_death_2`, draw: paint(art.death(2)) },
    { key: `${prefix}_death_3`, draw: paint(art.death(3)) },
  ]);
}

// --- shared stamps -------------------------------------------------------

/**
 * A pair of live-looking eyes: a `w`x`h` pupil block at columns `lx`/`rx`
 * with a bright gleam across its top row. Every creature with a head uses
 * this so no enemy ever ships the blank single-slit visor that made the old
 * sprites read as icons.
 */
export function stampEyes(g: string[][], lx: number, rx: number, y: number, w = 1, h = 2, pupil = 'e', gleam = 'g'): void {
  fillRect(g, lx, y, lx + w - 1, y + h - 1, pupil);
  fillRect(g, rx, y, rx + w - 1, y + h - 1, pupil);
  fillRect(g, lx, y, lx + w - 1, y, gleam);
  fillRect(g, rx, y, rx + w - 1, y, gleam);
}

/** A row of alternating fangs hanging from `y`, between `x0` and `x1`. */
export function stampFangs(g: string[][], x0: number, x1: number, y: number, ch = '1', step = 2): void {
  for (let x = x0; x <= x1; x += step) fillRect(g, x, y, x, y, ch);
}

/** Three-toed claw/talon splay under a limb, pointing down from (x, y). */
export function stampClaw(g: string[][], x: number, y: number, ch = 'n'): void {
  fillRect(g, x, y, x, y, ch);
  fillRect(g, x + 2, y, x + 2, y, ch);
  fillRect(g, x + 4, y, x + 4, y, ch);
  fillRect(g, x, y - 1, x + 4, y - 1, ch);
}

/**
 * Shared collapse generator for creatures whose death is "fold down into a
 * heap" (as opposed to the bespoke splatter/dissipate/shatter deaths below).
 * Keeps the creature's own width and palette so the heap still reads as that
 * species, and stays shaded rather than going flat the moment it dies.
 */
export function collapseHeap(
  size: number,
  spec: { headX0: number; headX1: number; bodyX0: number; bodyX1: number; groundY: number },
  stage: number,
): string[][] {
  const g = makeGrid(size, size);
  const gy = spec.groundY;
  // The heap gets shorter and wider each stage but never collapses to a bare
  // sliver - the last frame still has to read as a slumped body, since it is
  // what the player actually sees while the sprite fades out.
  const height = [10, 8, 6, 5][stage];
  const spread = stage;
  const bodyTop = Math.max(0, gy - height);
  fillRectShaded(g, spec.bodyX0 - spread, bodyTop, spec.bodyX1 + spread, gy, 'b', 'c', 'd');
  fillRect(g, spec.bodyX0, bodyTop + 1, spec.bodyX1, bodyTop + 2, 'a');
  // head lolls further to one side and sinks as it settles
  const headShift = 1 + stage;
  const headY = Math.min(gy - 3, bodyTop - 4 + stage * 2);
  fillRectShaded(g, spec.headX0 - headShift, headY, spec.headX1 - headShift, headY + 3, 'h', 'i', 'j');
  // eyes go out on the final frame - the light leaving is the whole point
  if (stage < 3) stampEyes(g, spec.headX0 - headShift + 1, spec.headX1 - headShift - 1, headY + 1);
  // limbs splay wider outward as it falls
  fillRectShaded(g, Math.max(0, spec.bodyX0 - 4 - stage), gy - 3, Math.max(1, spec.bodyX0 - 1 - stage), gy, 'm', 'l', 'q');
  fillRectShaded(g, Math.min(size - 2, spec.bodyX1 + 1 + stage), gy - 3, Math.min(size - 1, spec.bodyX1 + 4 + stage), gy, 'm', 'l', 'q');
  return g;
}

// ===========================================================================
// GRUNT - the baseline melee shambler. Silhouette: knuckle-dragging hunch,
// head sunk between oversized shoulders, jutting under-bite with tusks, long
// arms ending in visible claws. Reads as "the basic one" without reading as
// "the unfinished one". Grid 24x24.
// ===========================================================================
// Value range is deliberately WIDE (near-black shadow through pale highlight).
// A first pass used a tight range and every `fillRectShaded` bevel vanished at
// render scale, fusing head, torso, arms and legs into one green blob - the
// exact "flat prototype" read this pass exists to kill. Limbs also get their
// own distinctly darker base ('m'/'p') than the torso ('b') so the silhouette
// separates without relying on the bevel alone.
const GRUNT_PALETTE: Record<string, string> = {
  h: '#6fae4a', i: '#a5dd77', j: '#2c541c',
  e: '#ffe14d', g: '#fffbd0',
  b: '#4e8433', c: '#79b657', d: '#1f4014',
  a: '#8ec463',
  m: '#2f5a22', l: '#4d8035', q: '#12290a',
  n: '#c9b48a',
  p: '#376026', r: '#547f38', u: '#132a0a',
  o: '#0d1a07',
  s: '#7a4a24', t: '#a86e36', z: '#361f0d',
  '1': '#f4f0dc', '2': '#8a2f2a',
};

/** lean = torso pitch, arm = 0 hang / 1 raised / 2 thrust, legOffset = stride. */
function gruntBody(legOffset: number, lean: number, arm: number, crouch: number): string[][] {
  const g = makeGrid(24, 24);
  const ly = crouch; // whole upper body sinks when crouching/charging

  // hunched shoulder mass, narrower than the arms so the two never fuse
  fillRectShaded(g, 5 + lean, 9 + ly, 18 + lean, 12 + ly, 'b', 'c', 'd');
  // head sunk between the shoulders
  fillRectShaded(g, 8 + lean, 2 + ly, 15 + lean, 8 + ly, 'h', 'i', 'j');
  fillRect(g, 8 + lean, 2 + ly, 15 + lean, 3 + ly, 'j'); // heavy brow ridge
  stampEyes(g, 9 + lean, 13 + lean, 5 + ly, 2, 2);
  // jutting under-bite jaw with upward tusks
  fillRectShaded(g, 9 + lean, 8 + ly, 14 + lean, 10 + ly, 'h', 'i', 'j');
  fillRect(g, 9 + lean, 6 + ly, 9 + lean, 8 + ly, '1');
  fillRect(g, 14 + lean, 6 + ly, 14 + lean, 8 + ly, '1');
  stampFangs(g, 10 + lean, 13 + lean, 10 + ly, '1');
  // torso + pale belly + rag belt
  fillRectShaded(g, 6 + lean, 12 + ly, 17 + lean, 18 + ly, 'b', 'c', 'd');
  fillRectShaded(g, 8 + lean, 14 + ly, 15 + lean, 17 + ly, 'a', 'i', 'd');
  fillRectShaded(g, 6 + lean, 18 + ly, 17 + lean, 19 + ly, 's', 't', 'z');
  fillRect(g, 11 + lean, 18 + ly, 12 + lean, 18 + ly, '2'); // knotted rag

  // long knuckle-dragging arms, sitting OUTSIDE the torso in a darker shade
  fillRectShaded(g, 1 + lean, 10 + ly, 4 + lean, 18 + ly, 'm', 'l', 'q');
  fillRectShaded(g, 0 + lean, 18 + ly, 4 + lean, 20 + ly, 'n', 'i', 'q'); // hand
  stampClaw(g, 0 + lean, 21 + ly, 'q');
  if (arm === 1) {
    // raised overhead, cocked to swipe
    fillRectShaded(g, 19 + lean, 2 + ly, 22 + lean, 12 + ly, 'm', 'l', 'q');
    fillRectShaded(g, 19 + lean, 0 + ly, 23 + lean, 2 + ly, 'n', 'i', 'q');
    stampClaw(g, 19 + lean, 0 + ly, 'q');
  } else if (arm === 2) {
    // thrust forward at head height
    fillRectShaded(g, 18 + lean, 8 + ly, 22 + lean, 11 + ly, 'm', 'l', 'q');
    fillRectShaded(g, 21 + lean, 8 + ly, 23 + lean, 12 + ly, 'n', 'i', 'q');
    stampClaw(g, 19 + lean, 13 + ly, 'q');
  } else {
    fillRectShaded(g, 19 + lean, 10 + ly, 22 + lean, 18 + ly, 'm', 'l', 'q');
    fillRectShaded(g, 19 + lean, 18 + ly, 23 + lean, 20 + ly, 'n', 'i', 'q');
    stampClaw(g, 19 + lean, 21 + ly, 'q');
  }

  // legs with a real transparent gap, ending in dark splayed feet
  fillRectShaded(g, 8, 19 + ly, 10, 22 + legOffset, 'p', 'r', 'u');
  fillRectShaded(g, 13, 19 + ly, 15, 22 - legOffset, 'p', 'r', 'u');
  fillRect(g, 7, 22 + legOffset, 11, 23 + legOffset, 'o');
  fillRect(g, 12, 22 - legOffset, 16, 23 - legOffset, 'o');
  return g;
}

const GRUNT_ART: EnemyArt = {
  size: 24,
  palette: GRUNT_PALETTE,
  outline: '#0b1406',
  idle: (f) => gruntBody(0, 0, 0, f === 0 ? 0 : 1),
  walk: (f) => gruntBody([1, 0, -1, 0][f], 0, f === 1 ? 1 : 0, 0),
  attack: (s) => (s === 0 ? gruntBody(0, -1, 1, 1) : s === 1 ? gruntBody(0, 2, 2, 0) : gruntBody(0, 1, 0, 0)),
  hit: (settled) => gruntBody(0, settled ? -1 : -3, 1, settled ? 1 : 2),
  special: (s) => gruntBody(0, 0, 1, s === 0 ? 1 : 0),
  death: (s) => collapseHeap(24, { headX0: 8, headX1: 15, bodyX0: 7, bodyX1: 16, groundY: 23 }, s),
  fps: { idle: 2.2, walk: 7, attack: 12, hit: 12, special: 6, death: 16 },
};

// ===========================================================================
// BAT - fast erratic flyer. Silhouette: a wide W of membrane wings with
// visible finger-bones, tiny body, huge pointed ears. Deliberately leaves its
// bottom rows empty so the feet-anchored quad makes it hover. Grid 26x26.
// ===========================================================================
const BAT_PALETTE: Record<string, string> = {
  h: '#4a2b63', i: '#6d438c', j: '#2a1439',
  e: '#ff5470', g: '#ffd0d8',
  b: '#40254f', c: '#5e3a72', d: '#22102e',
  a: '#7a4f96',
  s: '#6b3f8c', t: '#8f5cb0', z: '#341a45',
  n: '#d8c8e8',
  '1': '#f4eaff', '2': '#2a1439',
};

/**
 * wing = -1 down / 0 mid / 1 up.
 *
 * The creature is drawn LARGE within its grid (head+body spanning ~14 of 26
 * rows, wings the full width): a hovering enemy still has to read at the same
 * visual weight as the ground creatures beside it, and the first pass left so
 * much empty grid around a small body that the bat rendered as a speck. The
 * empty rows are all kept at the BOTTOM, which is what makes it hover on the
 * feet-anchored quad.
 */
function batBody(wing: number, bob: number): string[][] {
  const g = makeGrid(26, 26);
  const y = 7 + bob;
  const wy = y + (wing === 1 ? -5 : wing === -1 ? 4 : 0);

  // membrane wings: an outer sweep, an inner sweep, and finger-bone struts
  fillRectShaded(g, 0, wy, 8, wy + 3, 's', 't', 'z');
  fillRectShaded(g, 2, wy + 3, 9, wy + 6, 's', 't', 'z');
  fillRect(g, 1, wy + 2, 8, wy + 2, 'z'); // finger bone
  fillRect(g, 4, wy + 5, 9, wy + 5, 'z');
  fillRectShaded(g, 17, wy, 25, wy + 3, 's', 't', 'z');
  fillRectShaded(g, 16, wy + 3, 23, wy + 6, 's', 't', 'z');
  fillRect(g, 17, wy + 2, 24, wy + 2, 'z');
  fillRect(g, 16, wy + 5, 21, wy + 5, 'z');

  // tall pointed ears
  fillRectShaded(g, 8, y - 6, 10, y - 1, 'h', 'i', 'j');
  fillRectShaded(g, 15, y - 6, 17, y - 1, 'h', 'i', 'j');
  fillRect(g, 9, y - 6, 9, y - 4, 'a');
  fillRect(g, 16, y - 6, 16, y - 4, 'a');
  // head with a real snout + fangs
  fillRectShaded(g, 7, y - 1, 18, y + 4, 'h', 'i', 'j');
  stampEyes(g, 9, 14, y, 3, 2);
  fillRectShaded(g, 10, y + 4, 15, y + 6, 'h', 'i', 'j');
  fillRect(g, 10, y + 7, 11, y + 7, '1');
  fillRect(g, 14, y + 7, 15, y + 7, '1');
  // furred body + clawed feet tucked under
  fillRectShaded(g, 9, y + 6, 16, y + 11, 'b', 'c', 'd');
  fillRect(g, 11, y + 7, 14, y + 9, 'a');
  fillRect(g, 9, y + 12, 11, y + 12, 'n');
  fillRect(g, 14, y + 12, 16, y + 12, 'n');
  return g;
}

const BAT_ART: EnemyArt = {
  size: 26,
  palette: BAT_PALETTE,
  outline: '#120720',
  idle: (f) => batBody(f === 0 ? 0 : 1, f === 0 ? 0 : -1),
  walk: (f) => batBody([1, 0, -1, 0][f], [-1, 0, 1, 0][f]),
  attack: (s) => (s === 0 ? batBody(1, -2) : s === 1 ? batBody(-1, 2) : batBody(0, 0)),
  hit: (settled) => batBody(settled ? 0 : -1, settled ? 1 : 3),
  special: (s) => batBody(1, s === 0 ? -2 : -1),
  death: (s) => {
    // wings crumple inward and the whole body tumbles downward
    const g = makeGrid(26, 26);
    const y = 8 + s * 3;
    const fold = 3 - s;
    fillRectShaded(g, 9 - fold, y, 12, y + 2, 's', 't', 'z');
    fillRectShaded(g, 13, y, 16 + fold, y + 2, 's', 't', 'z');
    fillRectShaded(g, 10, y + 1, 15, y + 5, 'b', 'c', 'd');
    fillRectShaded(g, 10, y - 3, 15, y + 1, 'h', 'i', 'j');
    if (s < 3) stampEyes(g, 11, 14, y - 2, 1, 1);
    return g;
  },
  fps: { idle: 6, walk: 14, attack: 14, hit: 14, special: 10, death: 16 },
};

// ===========================================================================
// SKELETON - gaunt undead footsoldier. Silhouette: narrow vertical stack with
// a real see-through gap between the ribcage bars and a rusted cleaver held
// out to one side, so it never reads as the same block as the grunt. Grid
// 24x24.
// ===========================================================================
const SKELETON_PALETTE: Record<string, string> = {
  h: '#ddd6bd', i: '#f4efdd', j: '#9c9377',
  e: '#ff7a2f', g: '#ffd9a8',
  b: '#cfc7ac', c: '#eae3cb', d: '#8d846a',
  a: '#b3aa8d',
  m: '#c6bda2', l: '#e2dbc3', q: '#847b62',
  n: '#f0eada',
  p: '#c6bda2', r: '#e2dbc3', u: '#7d7460',
  o: '#4a4436',
  w: '#8f7a5c', x: '#b0968a', y: '#5c4b34',
  v: '#4a3826',
  '1': '#3a352a', '2': '#6d3a2a',
};

function skeletonBody(legOffset: number, lean: number, arm: number, jaw: number): string[][] {
  const g = makeGrid(24, 24);
  // cracked skull with a hinged jaw
  fillRectShaded(g, 8 + lean, 0, 15 + lean, 5, 'h', 'i', 'j');
  fillRect(g, 12 + lean, 0, 12 + lean, 2, '1'); // hairline crack
  stampEyes(g, 9 + lean, 13 + lean, 2, 2, 2);
  fillRect(g, 11 + lean, 4, 12 + lean, 4, '1'); // nasal cavity
  fillRectShaded(g, 9 + lean, 5 + jaw, 14 + lean, 6 + jaw, 'h', 'i', 'j');
  stampFangs(g, 9 + lean, 14 + lean, 6 + jaw, '1');
  // neck + collarbone
  fillRect(g, 11 + lean, 7, 12 + lean, 7, 'a');
  fillRectShaded(g, 7 + lean, 8, 16 + lean, 9, 'b', 'c', 'd');
  // ribcage: spine column with rib bars and REAL transparent gaps between them
  fillRectShaded(g, 11 + lean, 9, 12 + lean, 16, 'a', 'c', 'd');
  for (let r = 0; r < 3; r++) {
    const ry = 10 + r * 2;
    fillRectShaded(g, 7 + lean, ry, 16 + lean, ry, 'b', 'c', 'd');
  }
  // pelvis
  fillRectShaded(g, 8, 17, 15, 19, 'b', 'c', 'd');
  fillRect(g, 11, 18, 12, 19, '1');
  // arms - left hangs, right carries the cleaver
  fillRectShaded(g, 5 + lean, 9, 6 + lean, 17, 'm', 'l', 'q');
  fillRect(g, 4 + lean, 17, 6 + lean, 18, 'n');
  if (arm === 1) {
    // cleaver raised overhead
    fillRectShaded(g, 17 + lean, 3, 18 + lean, 11, 'm', 'l', 'q');
    fillRect(g, 17 + lean, 3, 19 + lean, 4, 'n');
    fillRect(g, 18 + lean, 0, 19 + lean, 3, 'v');
    fillRectShaded(g, 16 + lean, -1, 22 + lean, 1, 'w', 'x', 'y');
  } else if (arm === 2) {
    // cleaver chopped down and forward
    fillRectShaded(g, 17 + lean, 10, 21 + lean, 12, 'm', 'l', 'q');
    fillRect(g, 19 + lean, 11, 21 + lean, 12, 'n');
    fillRect(g, 21 + lean, 12, 22 + lean, 15, 'v');
    fillRectShaded(g, 19 + lean, 15, 24 + lean, 18, 'w', 'x', 'y');
  } else {
    fillRectShaded(g, 17 + lean, 9, 18 + lean, 16, 'm', 'l', 'q');
    fillRect(g, 17 + lean, 15, 19 + lean, 16, 'n');
    fillRect(g, 19 + lean, 12, 20 + lean, 16, 'v');
    fillRectShaded(g, 18 + lean, 8, 23 + lean, 11, 'w', 'x', 'y');
  }
  // leg bones with a wide gap and dark foot bones
  fillRectShaded(g, 9, 20, 10, 22 + legOffset, 'p', 'r', 'u');
  fillRectShaded(g, 13, 20, 14, 22 - legOffset, 'p', 'r', 'u');
  fillRect(g, 7, 22 + legOffset, 11, 23 + legOffset, 'o');
  fillRect(g, 12, 22 - legOffset, 16, 23 - legOffset, 'o');
  return g;
}

const SKELETON_ART: EnemyArt = {
  size: 24,
  palette: SKELETON_PALETTE,
  outline: '#1a1712',
  idle: (f) => skeletonBody(0, 0, 0, f === 0 ? 0 : 1),
  walk: (f) => skeletonBody([1, 0, -1, 0][f], 0, 0, 0),
  attack: (s) => (s === 0 ? skeletonBody(0, -1, 1, 1) : s === 1 ? skeletonBody(0, 2, 2, 1) : skeletonBody(0, 1, 0, 0)),
  hit: (settled) => skeletonBody(0, settled ? -1 : -3, 0, settled ? 1 : 2),
  special: (s) => skeletonBody(0, 0, 1, s === 0 ? 1 : 0),
  death: (s) => {
    // clatters apart: skull rolls off the collapsing rib stack
    const g = makeGrid(24, 24);
    const drop = s * 3;
    fillRectShaded(g, 8 - s * 2, 12 + drop, 13 - s * 2, 16 + drop, 'h', 'i', 'j');
    if (s < 3) stampEyes(g, 9 - s * 2, 12 - s * 2, 13 + drop, 1, 1);
    for (let r = 0; r < 3 - s; r++) {
      fillRectShaded(g, 9 + r, 18 + r + s, 17 - r, 19 + r + s, 'b', 'c', 'd');
    }
    fillRect(g, 5 + s, 22, 10 + s, 23, 'p');
    fillRect(g, 13 - s, 22, 18 - s, 23, 'p');
    fillRectShaded(g, 16 + s, 20, 21 + s, 22, 'w', 'x', 'y'); // dropped cleaver
    return g;
  },
  fps: { idle: 2, walk: 6, attack: 11, hit: 12, special: 5, death: 16 },
};

// ===========================================================================
// SLIME - gelatinous blob. Silhouette: a low wide dome with NO limbs at all,
// a darker suspended nucleus visible through the body, drip tendrils on the
// underside and a hard specular highlight so it reads as wet/translucent
// rather than as a flat green hill. Grid 22x22.
// ===========================================================================
const SLIME_PALETTE: Record<string, string> = {
  b: 'rgba(58,196,132,0.82)', c: 'rgba(140,255,205,0.92)', d: 'rgba(24,120,80,0.85)',
  a: 'rgba(190,255,225,0.95)',
  e: '#0f3a28', g: '#c8fff0',
  h: 'rgba(20,96,66,0.9)', i: 'rgba(40,150,100,0.9)', j: 'rgba(10,60,40,0.92)',
  n: 'rgba(200,255,232,0.75)',
  '1': 'rgba(255,255,255,0.9)',
};

/**
 * squash 0 = tall rest, 2 = flattened bounce.
 *
 * Built from per-row ELLIPSE SPANS rather than stacked `fillRectShaded`
 * bands: shading each band individually stamped a highlight row and a shadow
 * row every two pixels, so the blob read as a striped dome (a hat) instead of
 * a smooth gel body. Here the mass is filled flat, then a single continuous
 * rim-light runs down the upper-left boundary and a single shade down the
 * lower-right - one light source, one curve, no banding.
 */
function slimeBody(squash: number, wobble: number): string[][] {
  const g = makeGrid(22, 22);
  const cx = 10.5 + wobble;
  const halfW = 7.5 + squash * 0.9;
  const h = 13 - squash * 2;
  const bottom = 21;
  const top = bottom - h;

  const spans: Array<[number, number]> = [];
  for (let y = top; y <= bottom; y++) {
    const ty = (bottom - y) / h; // 0 at the base, 1 at the crown
    const rx = halfW * Math.sqrt(Math.max(0, 1 - ty * ty * 0.94));
    const x0 = Math.round(cx - rx);
    const x1 = Math.round(cx + rx);
    spans[y] = [x0, x1];
    fillRect(g, x0, y, x1, y, 'b');
  }
  // one continuous rim light down the upper-left, one shade down the lower-right
  for (let y = top; y <= bottom; y++) {
    const s = spans[y];
    if (!s) continue;
    if (y <= top + Math.round(h * 0.62)) fillRect(g, s[0], y, s[0], y, 'c');
    fillRect(g, s[1], y, s[1], y, 'd');
  }
  // hard specular glint near the crown - the "wet" read
  fillRect(g, Math.round(cx - halfW * 0.55), top + 2, Math.round(cx - halfW * 0.2), top + 3, 'a');
  fillRect(g, Math.round(cx - halfW * 0.5), top + 2, Math.round(cx - halfW * 0.35), top + 2, '1');

  // suspended nucleus seen through the gel, with a real face on it
  const ny = bottom - Math.round(h * 0.45);
  fillRectShaded(g, Math.round(cx) - 3, ny - 2, Math.round(cx) + 3, ny + 2, 'h', 'i', 'j');
  stampEyes(g, Math.round(cx) - 2, Math.round(cx) + 1, ny - 1, 2, 2);
  fillRect(g, Math.round(cx) - 1, ny + 1, Math.round(cx), ny + 1, 'j'); // small mouth

  // drip tendrils hanging under the base
  fillRect(g, 5, bottom, 6, bottom, 'n');
  fillRect(g, 10, bottom, 12, bottom, 'n');
  fillRect(g, 16, bottom, 17, bottom, 'n');
  return g;
}

const SLIME_ART: EnemyArt = {
  size: 22,
  palette: SLIME_PALETTE,
  outline: '#08281c',
  idle: (f) => slimeBody(f === 0 ? 0 : 1, 0),
  walk: (f) => slimeBody([0, 1, 2, 1][f], 0),
  attack: (s) => (s === 0 ? slimeBody(2, 0) : s === 1 ? slimeBody(0, 0) : slimeBody(1, 0)),
  hit: (settled) => slimeBody(settled ? 1 : 2, settled ? 1 : 2),
  special: (s) => slimeBody(2, s === 0 ? -1 : 1),
  death: (s) => {
    // does not fold like a body - it bursts and spreads into a puddle
    const g = makeGrid(22, 22);
    const spread = s * 3;
    fillRectShaded(g, 3 - Math.min(3, spread), 20 - s, 18 + Math.min(3, spread), 21, 'b', 'c', 'd');
    if (s < 3) {
      fillRectShaded(g, 6, 16 - s * 2, 15, 20 - s, 'b', 'c', 'd');
      fillRectShaded(g, 8, 15 - s * 2, 13, 18 - s, 'h', 'i', 'j');
    }
    // flung droplets arcing away from the burst
    fillRect(g, 1 + s, 14 - s, 2 + s, 15 - s, 'a');
    fillRect(g, 19 - s, 13 - s, 20 - s, 14 - s, 'a');
    fillRect(g, 10, 11 - s * 2, 11, 12 - s * 2, 'a');
    return g;
  },
  fps: { idle: 2.4, walk: 8, attack: 10, hit: 12, special: 8, death: 16 },
};

// ===========================================================================
// WOLF - fast quadruped. Silhouette: horizontal, four legs with real gaps, a
// long muzzle, a raised ridge of hackles along the spine and a bushy tail -
// the only fully horizontal land silhouette in the trash roster. Grid 26x26,
// body sitting on the bottom rows.
// ===========================================================================
const WOLF_PALETTE: Record<string, string> = {
  h: '#6f6252', i: '#8f8170', j: '#453b30',
  e: '#ffc23d', g: '#fff3c8',
  b: '#63564a', c: '#847668', d: '#3a3128',
  a: '#4a4038',
  m: '#574b40', l: '#756759', q: '#2c251e',
  n: '#e8e2d2',
  p: '#5c5044', r: '#7a6c5d', u: '#2f2820',
  o: '#181410',
  s: '#4a3f34', t: '#6b5c4d', z: '#241d17',
  '1': '#f2ecdc',
};

function wolfBody(gait: number, head: number, jaw: number): string[][] {
  const g = makeGrid(26, 26);
  const base = 25;
  // bushy tail sweeping up behind
  fillRectShaded(g, 0, 10 - gait, 4, 13 - gait, 's', 't', 'z');
  fillRectShaded(g, 3, 12, 6, 15, 's', 't', 'z');
  // haunches + barrel torso
  fillRectShaded(g, 4, 12, 11, 20, 'b', 'c', 'd');
  fillRectShaded(g, 9, 13, 20, 19, 'b', 'c', 'd');
  fillRect(g, 6, 17, 19, 19, 'a'); // shadowed underbelly
  // raised hackles ridge along the spine
  for (let i = 0; i < 5; i++) fillRect(g, 6 + i * 2, 10 - (i % 2), 7 + i * 2, 12, 's');
  // head + long muzzle, pitched by `head`
  const hy = 8 + head;
  fillRectShaded(g, 17, hy, 23, hy + 5, 'h', 'i', 'j');
  fillRectShaded(g, 17, hy - 3, 18, hy, 'h', 'i', 'j'); // ears
  fillRectShaded(g, 21, hy - 3, 22, hy, 'h', 'i', 'j');
  stampEyes(g, 19, 22, hy + 1, 1, 2);
  fillRectShaded(g, 23, hy + 2, 25, hy + 4, 'h', 'i', 'j'); // muzzle
  fillRect(g, 25, hy + 2, 25, hy + 2, 'j'); // nose
  fillRect(g, 21, hy + 5 + jaw, 25, hy + 5 + jaw, 'j'); // open maw
  stampFangs(g, 22, 25, hy + 4 + jaw, '1', 2);
  // four legs, diagonal trot, real gaps, dark paws
  const f = gait;
  fillRectShaded(g, 5, 20, 7, base - 1 + f, 'p', 'r', 'u');
  fillRectShaded(g, 9, 20, 11, base - 1 - f, 'p', 'r', 'u');
  fillRectShaded(g, 15, 19, 17, base - 1 - f, 'm', 'l', 'q');
  fillRectShaded(g, 19, 19, 21, base - 1 + f, 'm', 'l', 'q');
  fillRect(g, 4, base + f, 7, base + f, 'o');
  fillRect(g, 9, base - f, 12, base - f, 'o');
  fillRect(g, 14, base - f, 17, base - f, 'o');
  fillRect(g, 19, base + f, 22, base + f, 'o');
  return g;
}

const WOLF_ART: EnemyArt = {
  size: 26,
  palette: WOLF_PALETTE,
  outline: '#100d09',
  idle: (f) => wolfBody(0, f === 0 ? 0 : 1, 0),
  walk: (f) => wolfBody([1, 0, -1, 0][f], 0, f === 1 ? 1 : 0),
  attack: (s) => (s === 0 ? wolfBody(-1, 2, 0) : s === 1 ? wolfBody(1, -2, 1) : wolfBody(0, 0, 1)),
  hit: (settled) => wolfBody(settled ? 0 : -1, settled ? 2 : 3, 1),
  special: (s) => wolfBody(0, s === 0 ? -2 : -1, 1),
  death: (s) => {
    // legs give out and the barrel body rolls onto its side
    const g = makeGrid(26, 26);
    const drop = s * 2;
    fillRectShaded(g, 3, 17 + drop, 20 - s, 24, 'b', 'c', 'd');
    fillRectShaded(g, 18 - s, 14 + drop, 24 - s, 19 + drop, 'h', 'i', 'j');
    if (s < 3) stampEyes(g, 20 - s, 22 - s, 15 + drop, 1, 1);
    fillRect(g, 5, 24, 9 + s, 25, 'o');
    fillRect(g, 13 - s, 24, 18 - s, 25, 'o');
    fillRectShaded(g, 0, 15 + drop, 4, 18 + drop, 's', 't', 'z'); // tail flops down
    return g;
  },
  fps: { idle: 2.4, walk: 10, attack: 13, hit: 13, special: 6, death: 16 },
};

// ===========================================================================
// GHOST - drifting revenant. Silhouette: tapered teardrop with NO legs, a
// hollow-eyed hooded face, two thin trailing arms and a wispy tail that frays
// into separate tatters. Leaves its bottom rows empty so it hovers. Grid
// 24x24.
// ===========================================================================
const GHOST_PALETTE: Record<string, string> = {
  h: 'rgba(198,244,248,0.86)', i: 'rgba(240,254,255,0.95)', j: 'rgba(120,178,190,0.8)',
  e: '#12323a', g: '#8ff2ff',
  b: 'rgba(178,232,240,0.8)', c: 'rgba(226,250,253,0.9)', d: 'rgba(104,158,172,0.75)',
  a: 'rgba(150,214,226,0.7)',
  m: 'rgba(190,238,244,0.7)', l: 'rgba(232,252,255,0.8)', q: 'rgba(110,164,178,0.65)',
  n: 'rgba(240,254,255,0.85)',
  s: 'rgba(160,222,232,0.55)', t: 'rgba(214,246,250,0.65)', z: 'rgba(96,148,162,0.5)',
  '1': 'rgba(255,255,255,0.9)',
};

function ghostBody(sway: number, arms: number, mouth: number): string[][] {
  const g = makeGrid(24, 24);
  // hood crown tapering into the shroud
  fillRectShaded(g, 9, 0, 14, 1, 'h', 'i', 'j');
  fillRectShaded(g, 7, 2, 16, 8, 'h', 'i', 'j');
  fillRect(g, 8, 3, 15, 4, 'j'); // shadowed hood interior
  stampEyes(g, 9, 13, 4, 2, 2);
  if (mouth) fillRect(g, 11, 7, 12, 8, 'e'); // wailing mouth
  // shroud body widening then tapering
  fillRectShaded(g, 6, 8, 17, 14, 'b', 'c', 'd');
  fillRect(g, 8, 10, 15, 12, 'a');
  // thin trailing arms
  if (arms === 1) {
    fillRectShaded(g, 1, 6, 5, 8, 'm', 'l', 'q');
    fillRectShaded(g, 18, 6, 22, 8, 'm', 'l', 'q');
    fillRect(g, 0, 8, 2, 9, 'n');
    fillRect(g, 21, 8, 23, 9, 'n');
  } else {
    fillRectShaded(g, 3, 9, 6, 13, 'm', 'l', 'q');
    fillRectShaded(g, 17, 9, 20, 13, 'm', 'l', 'q');
    fillRect(g, 2, 13, 4, 14, 'n');
    fillRect(g, 19, 13, 21, 14, 'n');
  }
  // wispy tail fraying into separate tatters that sway
  fillRectShaded(g, 7 + sway, 14, 16 + sway, 16, 'b', 'c', 'd');
  fillRectShaded(g, 8 + sway, 17, 15 + sway, 18, 's', 't', 'z');
  fillRect(g, 8 + sway, 19, 10 + sway, 21, 's');
  fillRect(g, 12 - sway, 19, 14 - sway, 20, 's');
  fillRect(g, 15 + sway, 19, 16 + sway, 21, 's');
  fillRect(g, 9, 3, 9, 3, '1'); // faint rim gleam on the hood
  return g;
}

const GHOST_ART: EnemyArt = {
  size: 24,
  palette: GHOST_PALETTE,
  outline: 'rgba(14,42,52,0.75)',
  idle: (f) => ghostBody(f === 0 ? 0 : 1, 0, 0),
  walk: (f) => ghostBody([-1, 0, 1, 0][f], 0, 0),
  attack: (s) => (s === 0 ? ghostBody(0, 1, 0) : s === 1 ? ghostBody(1, 1, 1) : ghostBody(0, 0, 1)),
  hit: (settled) => ghostBody(settled ? 1 : 2, 1, 1),
  special: (s) => ghostBody(s === 0 ? -1 : 1, 1, 1),
  death: (s) => {
    // dissipates upward instead of collapsing: the body shreds into tatters
    const g = makeGrid(24, 24);
    const rise = s * 2;
    if (s < 3) {
      fillRectShaded(g, 7 + s, 2 - rise, 16 - s, 7 - rise, 'h', 'i', 'j');
      stampEyes(g, 9 + s, 13 - s, 4 - rise, 1, 1);
      fillRectShaded(g, 6 + s * 2, 8 - rise, 17 - s * 2, 12 - rise, 'b', 'c', 'd');
    }
    // fraying wisps drifting apart and upward
    fillRect(g, 4 - s, 12 - rise, 6 - s, 14 - rise, 's');
    fillRect(g, 18 + s, 11 - rise, 20 + s, 13 - rise, 's');
    fillRect(g, 10, 16 - rise, 13, 18 - rise, 's');
    fillRect(g, 7 + s, 19 - rise, 9 + s, 20 - rise, 's');
    return g;
  },
  fps: { idle: 2, walk: 5, attack: 10, hit: 10, special: 6, death: 14 },
};

// ===========================================================================
// BRUTE - the heavy. Silhouette: a broad trapezoid, by far the widest
// shoulders in the trash roster, tiny sunken head, banded iron belly plate and
// enormous fists that hang past the knees. Grid 28x28.
// ===========================================================================
const BRUTE_PALETTE: Record<string, string> = {
  h: '#5c2a1e', i: '#7d4130', j: '#2f1310',
  e: '#ff8a3d', g: '#ffe0b8',
  b: '#6b3324', c: '#8f4a34', d: '#3a1712',
  a: '#8a4a30',
  m: '#5a2a1c', l: '#7c3f2a', q: '#2c1009',
  n: '#c9b088',
  p: '#4a1f16', r: '#6a3123', u: '#220c07',
  o: '#150705',
  s: '#6f6a62', t: '#948f86', z: '#3c3833',
  '1': '#c9c2b4', '2': '#ffb066',
};

function bruteBody(legOffset: number, lean: number, arms: number, roar: number): string[][] {
  const g = makeGrid(28, 28);
  // massive sloped shoulders - drawn first, the head sinks into them
  fillRectShaded(g, 2 + lean, 5, 25 + lean, 11, 'b', 'c', 'd');
  // riveted iron shoulder caps
  fillRectShaded(g, 0 + lean, 6, 6 + lean, 12, 's', 't', 'z');
  fillRectShaded(g, 21 + lean, 6, 27 + lean, 12, 's', 't', 'z');
  fillRect(g, 2 + lean, 8, 3 + lean, 9, '1');
  fillRect(g, 24 + lean, 8, 25 + lean, 9, '1');
  // small sunken head with a heavy brow
  fillRectShaded(g, 10 + lean, 1, 17 + lean, 6, 'h', 'i', 'j');
  fillRect(g, 10 + lean, 1, 17 + lean, 2, 'j');
  stampEyes(g, 11 + lean, 15 + lean, 3, 2, 2);
  if (roar) {
    fillRect(g, 12 + lean, 6, 15 + lean, 8, 'j'); // roaring maw
    stampFangs(g, 12 + lean, 15 + lean, 6, '1');
  } else {
    stampFangs(g, 12 + lean, 15 + lean, 6, '1');
  }
  // torso + banded iron belly plate
  fillRectShaded(g, 5 + lean, 11, 22 + lean, 20, 'b', 'c', 'd');
  fillRectShaded(g, 8 + lean, 13, 19 + lean, 19, 's', 't', 'z');
  fillRect(g, 8 + lean, 15, 19 + lean, 15, '1');
  fillRect(g, 8 + lean, 18, 19 + lean, 18, '1');
  // enormous arms + fists
  if (arms === 1) {
    // both fists raised overhead ready to slam
    fillRectShaded(g, 1, 0, 6, 10, 'm', 'l', 'q');
    fillRectShaded(g, 21, 0, 26, 10, 'm', 'l', 'q');
    fillRectShaded(g, 0, -1, 7, 3, 'a', 'l', 'q');
    fillRectShaded(g, 20, -1, 27, 3, 'a', 'l', 'q');
  } else if (arms === 2) {
    // slammed down into the ground
    fillRectShaded(g, 1, 12, 6, 22, 'm', 'l', 'q');
    fillRectShaded(g, 21, 12, 26, 22, 'm', 'l', 'q');
    fillRectShaded(g, 0, 22, 7, 26, 'a', 'l', 'q');
    fillRectShaded(g, 20, 22, 27, 26, 'a', 'l', 'q');
  } else {
    fillRectShaded(g, 1, 10, 6, 19, 'm', 'l', 'q');
    fillRectShaded(g, 21, 10, 26, 19, 'm', 'l', 'q');
    fillRectShaded(g, 0, 19, 7, 23, 'a', 'l', 'q'); // fists hang past the knees
    fillRectShaded(g, 20, 19, 27, 23, 'a', 'l', 'q');
    fillRect(g, 1, 21, 6, 21, 'n');
    fillRect(g, 21, 21, 26, 21, 'n');
  }
  // stumpy legs with a gap and heavy feet
  fillRectShaded(g, 8, 20, 12, 25 + legOffset, 'p', 'r', 'u');
  fillRectShaded(g, 15, 20, 19, 25 - legOffset, 'p', 'r', 'u');
  fillRect(g, 7, 25 + legOffset, 13, 27 + legOffset, 'o');
  fillRect(g, 14, 25 - legOffset, 20, 27 - legOffset, 'o');
  return g;
}

const BRUTE_ART: EnemyArt = {
  size: 28,
  palette: BRUTE_PALETTE,
  outline: '#0d0403',
  idle: (f) => bruteBody(0, 0, 0, f === 1 ? 1 : 0),
  walk: (f) => bruteBody([1, 0, -1, 0][f], 0, 0, 0),
  attack: (s) => (s === 0 ? bruteBody(0, -1, 1, 1) : s === 1 ? bruteBody(0, 1, 2, 1) : bruteBody(0, 0, 0, 0)),
  hit: (settled) => bruteBody(0, settled ? -1 : -2, 1, 1),
  special: (s) => bruteBody(0, 0, 1, s === 0 ? 1 : 0),
  death: (s) => collapseHeap(28, { headX0: 10, headX1: 17, bodyX0: 5, bodyX1: 22, groundY: 27 }, s),
  fps: { idle: 1.8, walk: 8, attack: 9, hit: 11, special: 5, death: 14 },
};

// ===========================================================================
// SPITTER - ranged acid lobber. Silhouette: pot-bellied sac slung between
// spindly legs, a forward-jutting proboscis and a glowing throat sac that
// visibly INFLATES on the special/charge pose - that swelling sac is the
// telegraph the player reads before the shot lands. Grid 24x24.
// ===========================================================================
const SPITTER_PALETTE: Record<string, string> = {
  h: '#93c631', i: '#c4ec6b', j: '#3f5a12',
  e: '#141d04', g: '#eaffb4',
  b: '#7cab2d', c: '#aed85e', d: '#33490e',
  a: '#cbe975',
  m: '#4f7018', l: '#7ba334', q: '#22330a',
  n: '#e2f5a8',
  p: '#3f5a12', r: '#6b8f28', u: '#182406',
  o: '#0b1103',
  s: '#c9f24d', t: '#f4ffc8', z: '#5c7d0d',
  '1': '#ffffff', '2': '#b6f53a',
};

/**
 * sac 0..2 = throat sac inflation, spit = mid-spit spray plume.
 *
 * Sized to actually fill its grid: the first pass drew a small blob in the
 * middle of a 24x24 cell, which rendered as an unreadable green lump next to
 * creatures whose art reached the grid edges. The abdomen now sits low and
 * wide, the head is big enough to carry real eyes, and the legs reach the
 * bottom row so it plants on the floor.
 */
function spitterBody(legOffset: number, lean: number, sac: number, spit: number): string[][] {
  const g = makeGrid(24, 24);

  // Long spindly legs drawn FIRST so the abdomen overlaps their tops - the
  // creature is carried high off the ground on visible legs rather than being
  // a rounded lump sitting on the floor, which is what gives it a silhouette
  // distinct from the slime and the grunt.
  fillRectShaded(g, 2, 13, 3, 21 + legOffset, 'p', 'r', 'u');
  fillRectShaded(g, 8, 14, 9, 22 - legOffset, 'p', 'r', 'u');
  fillRectShaded(g, 14, 13, 15, 21 + legOffset, 'p', 'r', 'u');
  fillRect(g, 1, 21 + legOffset, 4, 22 + legOffset, 'o');
  fillRect(g, 7, 22 - legOffset, 10, 23 - legOffset, 'o');
  fillRect(g, 13, 21 + legOffset, 16, 22 + legOffset, 'o');

  // bulbous abdomen slung between the legs
  fillRectShaded(g, 1, 8, 16, 16, 'b', 'c', 'd');
  fillRect(g, 3, 10, 13, 12, 'a'); // pale belly band
  fillRect(g, 2, 15, 15, 15, 'd');
  fillRect(g, 3, 9, 4, 9, '1'); // wet shell highlight

  // narrower thorax/head raised above the abdomen, pitched by `lean`
  fillRectShaded(g, 6 + lean, 1, 17 + lean, 9, 'h', 'i', 'j');
  fillRect(g, 7 + lean, 2, 16 + lean, 2, 'a'); // carapace ridge
  stampEyes(g, 8 + lean, 14 + lean, 4, 2, 2);
  fillRect(g, 9 + lean, 8, 15 + lean, 8, 'j'); // mouth line

  // throat sac - the telegraph. Swells forward and brightens as `sac` rises.
  if (sac > 0) {
    fillRectShaded(g, 7 + lean, 8, 16 + lean + sac, 12 + sac, 's', 't', 'z');
    fillRect(g, 10 + lean, 9, 13 + lean, 11, '1');
  }

  // long forward proboscis - reads as a snout even at horde scale
  fillRectShaded(g, 17 + lean, 4, 22 + lean, 6, 'm', 'l', 'q');
  fillRectShaded(g, 21 + lean, 4 - spit, 23 + lean, 6 - spit, 's', 't', 'z');
  if (spit) {
    // acid plume leaving the proboscis
    fillRect(g, 22, 1, 23, 2, '2');
    fillRect(g, 19, 0, 21, 1, '2');
  }
  return g;
}

const SPITTER_ART: EnemyArt = {
  size: 24,
  palette: SPITTER_PALETTE,
  outline: '#0d1403',
  idle: (f) => spitterBody(0, 0, f === 0 ? 0 : 1, 0),
  walk: (f) => spitterBody([1, 0, -1, 0][f], 0, 0, 0),
  // rear back with a full sac, then snap forward spraying, then settle empty
  attack: (s) => (s === 0 ? spitterBody(0, -2, 2, 0) : s === 1 ? spitterBody(0, 2, 0, 1) : spitterBody(0, 1, 0, 0)),
  hit: (settled) => spitterBody(0, settled ? -1 : -3, 0, 0),
  // the charge tell: sac pulses between half and fully inflated
  special: (s) => spitterBody(0, -1, s === 0 ? 1 : 2, 0),
  death: (s) => {
    // the sac ruptures - body deflates flat and leaks
    const g = makeGrid(24, 24);
    const flat = s * 2;
    fillRectShaded(g, 3 - s, 17 + flat, 18 + s, 23, 'b', 'c', 'd');
    if (s < 3) {
      fillRectShaded(g, 6, 12 + flat, 16, 18 + flat, 'h', 'i', 'j');
      stampEyes(g, 7, 13, 14 + flat, 1, 1);
    }
    fillRect(g, 1 + s, 22, 4 + s, 23, '2'); // acid pooling out
    fillRect(g, 17 - s, 21, 21 - s, 23, '2');
    return g;
  },
  fps: { idle: 2.6, walk: 6, attack: 11, hit: 12, special: 7, death: 15 },
};

// ===========================================================================
// GHOUL - crystal-headed charger. Silhouette kept from the existing design
// (twin amethyst crystal heads on stalks over a bell-shaped robe, no legs)
// because it was already the most distinctive shape in the roster - but
// rebuilt with volume, an outline, faceted crystal shading and a real
// coiled-brace windup pose for the dash telegraph. Grid 26x26.
// ===========================================================================
const GHOUL_PALETTE: Record<string, string> = {
  h: '#c9a6f0', i: '#f0e2ff', j: '#7a4fb4',
  e: '#3a1a5c', g: '#ffffff',
  b: '#6b5a3a', c: '#8f7a4e', d: '#3f3422',
  a: '#8a7248',
  m: '#5a4a30', l: '#7a6642', q: '#332a1a',
  n: '#d8c9a0',
  s: '#a87fe0', t: '#e2ccff', z: '#5f3a94',
  '1': '#ffffff', '2': '#5a2f2a',
};

/** crouch = coiled brace before the dash, sway = idle counter-sway, glow = crystal charge. */
function ghoulBody(sway: number, crouch: number, glow: number, lean: number): string[][] {
  const g = makeGrid(26, 26);
  const ls = sway;
  const rs = -sway;
  const cy = crouch;

  // left crystal head - faceted teardrop on a thin stalk
  fillRectShaded(g, 5 + ls + lean, 1 + cy, 9 + ls + lean, 4 + cy, 'h', 'i', 'j');
  fillRect(g, 6 + ls + lean, 0 + cy, 8 + ls + lean, 0 + cy, glow ? '1' : 'i');
  fillRectShaded(g, 6 + ls + lean, 5 + cy, 8 + ls + lean, 6 + cy, 'h', 'i', 'j');
  fillRect(g, 8 + ls + lean, 3 + cy, 9 + ls + lean, 5 + cy, 'j'); // facet shadow
  if (glow) fillRect(g, 6 + ls + lean, 2 + cy, 7 + ls + lean, 3 + cy, '1');
  stampEyes(g, 6 + ls + lean, 8 + ls + lean, 2 + cy, 1, 2);
  fillRectShaded(g, 7, 7 + cy, 8, 10 + cy, 'a', 'l', 'q'); // stalk

  // right crystal head - mirrored
  fillRectShaded(g, 15 + rs + lean, 1 + cy, 19 + rs + lean, 4 + cy, 'h', 'i', 'j');
  fillRect(g, 16 + rs + lean, 0 + cy, 18 + rs + lean, 0 + cy, glow ? '1' : 'i');
  fillRectShaded(g, 16 + rs + lean, 5 + cy, 18 + rs + lean, 6 + cy, 'h', 'i', 'j');
  fillRect(g, 18 + rs + lean, 3 + cy, 19 + rs + lean, 5 + cy, 'j');
  if (glow) fillRect(g, 16 + rs + lean, 2 + cy, 17 + rs + lean, 3 + cy, '1');
  stampEyes(g, 16 + rs + lean, 18 + rs + lean, 2 + cy, 1, 2);
  fillRectShaded(g, 17, 7 + cy, 18, 10 + cy, 'a', 'l', 'q');

  // shoulders + bell robe widening to a swaying hem
  fillRectShaded(g, 7 + lean, 10 + cy, 18 + lean, 13 + cy, 'a', 'l', 'q');
  fillRectShaded(g, 5 + lean, 13 + cy, 20 + lean, 18, 'b', 'c', 'd');
  fillRect(g, 8 + lean, 15 + cy, 17 + lean, 17, 'd'); // robe fold shadow
  fillRectShaded(g, 3 + sway, 18, 22 + sway, 22, 'b', 'c', 'd');
  fillRect(g, 6 + sway, 20, 19 + sway, 21, 'm');
  // ragged hem tatters instead of a flat bottom edge
  fillRect(g, 3 + sway, 23, 6 + sway, 25, 'm');
  fillRect(g, 8 + sway, 23, 11 + sway, 24, 'm');
  fillRect(g, 13 - sway, 23, 16 - sway, 25, 'm');
  fillRect(g, 18 - sway, 23, 21 - sway, 24, 'm');
  // bound-cloth arms peeking from the robe
  fillRectShaded(g, 2 + lean, 12 + cy, 5 + lean, 17, 'm', 'l', 'q');
  fillRectShaded(g, 20 + lean, 12 + cy, 23 + lean, 17, 'm', 'l', 'q');
  fillRect(g, 1 + lean, 17, 4 + lean, 18, 'n');
  fillRect(g, 21 + lean, 17, 24 + lean, 18, 'n');
  return g;
}

const GHOUL_ART: EnemyArt = {
  size: 26,
  palette: GHOUL_PALETTE,
  outline: '#160c22',
  idle: (f) => ghoulBody(f === 0 ? 0 : 1, 0, 0, 0),
  walk: (f) => ghoulBody([1, 0, -1, 0][f], 0, 0, 0),
  // lunge: coiled -> stretched forward -> settle
  attack: (s) => (s === 0 ? ghoulBody(0, 2, 1, -1) : s === 1 ? ghoulBody(0, -1, 1, 3) : ghoulBody(0, 0, 0, 1)),
  hit: (settled) => ghoulBody(settled ? 1 : 2, settled ? 1 : 2, 0, settled ? -1 : -2),
  // dash telegraph: crystals flare and the whole body coils down and back
  special: (s) => ghoulBody(0, s === 0 ? 2 : 3, 1, -1),
  death: (s) => {
    // the crystals shatter first, then the empty robe crumples
    const g = makeGrid(26, 26);
    const drop = s * 2;
    if (s === 0) {
      fillRectShaded(g, 5, 1, 9, 5, 'h', 'i', 'j');
      fillRectShaded(g, 15, 1, 19, 5, 'h', 'i', 'j');
    } else {
      // shards flying apart
      fillRect(g, 3 - s, 3 - s, 5 - s, 5 - s, 'h');
      fillRect(g, 20 + s, 2 - s, 22 + s, 4 - s, 'h');
      fillRect(g, 9, 1, 10, 2, 's');
      fillRect(g, 16, 0, 17, 1, 's');
    }
    fillRectShaded(g, 4 + s, 14 + drop, 21 - s, 22, 'b', 'c', 'd');
    fillRectShaded(g, 2 + s, 21, 23 - s, 25, 'b', 'c', 'd');
    return g;
  },
  fps: { idle: 2, walk: 4, attack: 12, hit: 12, special: 8, death: 15 },
};

// ===========================================================================
// GARGOYLE - stone turret. Silhouette: the widest, lowest, most static shape
// in the roster - a squat statue with wings spread flat out to either side,
// curled horns and clawed feet gripping a stone base. Cracks run through the
// stone; the eyes and the cracks are what light up on the charge pose. Grid
// 26x26.
// ===========================================================================
const GARGOYLE_PALETTE: Record<string, string> = {
  h: '#8a8a94', i: '#b0b0ba', j: '#4c4c56',
  e: '#8a5fc4', g: '#e2ccff',
  b: '#7e7e88', c: '#a4a4ae', d: '#43434d',
  a: '#606069',
  m: '#6f6f79', l: '#94949e', q: '#3a3a43',
  n: '#2a2a30',
  p: '#75757f', r: '#9a9aa4', u: '#3f3f48',
  o: '#22222a',
  s: '#5c4a6e', t: '#7d6690', z: '#33263f',
  '1': '#c9b0f0', '2': '#2f2f38',
};

/** charge 0..2 = eye/crack glow ramp, wings 0 = spread, 1 = drawn back. */
function gargoyleBody(charge: number, wings: number, crouch: number): string[][] {
  const g = makeGrid(26, 26);
  const cy = crouch;
  const glowKey = charge > 0 ? '1' : 'e';

  // wings - spread flat and low, or hauled back for the shot
  if (wings === 0) {
    fillRectShaded(g, 0, 8 + cy, 7, 10 + cy, 's', 't', 'z');
    fillRectShaded(g, 0, 11 + cy, 6, 13 + cy, 's', 't', 'z');
    fillRect(g, 1, 14 + cy, 4, 14 + cy, 'z');
    fillRectShaded(g, 18, 8 + cy, 25, 10 + cy, 's', 't', 'z');
    fillRectShaded(g, 19, 11 + cy, 25, 13 + cy, 's', 't', 'z');
    fillRect(g, 21, 14 + cy, 24, 14 + cy, 'z');
  } else {
    fillRectShaded(g, 2, 5 + cy, 7, 8 + cy, 's', 't', 'z');
    fillRectShaded(g, 3, 9 + cy, 7, 12 + cy, 's', 't', 'z');
    fillRectShaded(g, 18, 5 + cy, 23, 8 + cy, 's', 't', 'z');
    fillRectShaded(g, 18, 9 + cy, 22, 12 + cy, 's', 't', 'z');
  }
  // curled horns
  fillRectShaded(g, 8, 0 + cy, 9, 3 + cy, 'n', 'a', 'o');
  fillRectShaded(g, 16, 0 + cy, 17, 3 + cy, 'n', 'a', 'o');
  fillRect(g, 7, 1 + cy, 7, 2 + cy, 'o');
  fillRect(g, 18, 1 + cy, 18, 2 + cy, 'o');
  // blocky stone head with a heavy jaw
  fillRectShaded(g, 8, 3 + cy, 17, 9 + cy, 'h', 'i', 'j');
  stampEyes(g, 9, 15, 5 + cy, 2, 2, glowKey, charge > 1 ? '1' : 'g');
  fillRect(g, 10, 9 + cy, 15, 10 + cy, 'j');
  stampFangs(g, 10, 15, 10 + cy, 'i');
  // wide blocky torso with fracture lines that light up while charging
  fillRectShaded(g, 6, 10 + cy, 19, 19, 'b', 'c', 'd');
  fillRect(g, 8, 12 + cy, 17, 13 + cy, 'a');
  fillRect(g, 11, 13 + cy, 11, 18, charge > 0 ? '1' : '2'); // fracture
  fillRect(g, 14, 15, 14, 19, charge > 1 ? '1' : '2');
  // short stone arms braced on the base
  fillRectShaded(g, 3, 12 + cy, 6, 19, 'm', 'l', 'q');
  fillRectShaded(g, 19, 12 + cy, 22, 19, 'm', 'l', 'q');
  // clawed feet gripping a plinth
  fillRectShaded(g, 5, 19, 11, 23, 'p', 'r', 'u');
  fillRectShaded(g, 14, 19, 20, 23, 'p', 'r', 'u');
  stampClaw(g, 4, 24, 'o');
  stampClaw(g, 15, 24, 'o');
  fillRectShaded(g, 3, 24, 22, 25, 'a', 'l', 'q'); // plinth
  return g;
}

const GARGOYLE_ART: EnemyArt = {
  size: 26,
  palette: GARGOYLE_PALETTE,
  outline: '#101018',
  idle: (f) => gargoyleBody(0, 0, f === 0 ? 0 : 1),
  // it barely moves in play, so "walk" is a heavy stone shuffle, not a stride
  walk: (f) => gargoyleBody(0, 0, [0, 1, 0, 1][f]),
  attack: (s) => (s === 0 ? gargoyleBody(2, 1, 1) : s === 1 ? gargoyleBody(2, 0, -1) : gargoyleBody(0, 0, 0)),
  hit: (settled) => gargoyleBody(0, 1, settled ? 1 : 2),
  // charge tell: wings haul back, eyes and stone fractures light violet
  special: (s) => gargoyleBody(s === 0 ? 1 : 2, 1, 1),
  death: (s) => {
    // crumbles rather than folding: the statue breaks into rubble
    const g = makeGrid(26, 26);
    if (s === 0) {
      fillRectShaded(g, 8, 4, 17, 10, 'h', 'i', 'j');
      fillRectShaded(g, 6, 10, 19, 20, 'b', 'c', 'd');
      fillRect(g, 11, 5, 12, 12, '2');
    } else {
      // progressively smaller, more scattered rubble
      const k = 4 - s;
      fillRectShaded(g, 5 + s, 26 - k * 2, 12 + s, 25, 'b', 'c', 'd');
      fillRectShaded(g, 13 - s, 25 - k, 20 - s, 25, 'h', 'i', 'j');
      fillRect(g, 2 + s, 23, 4 + s, 25, 'a');
      fillRect(g, 21 - s, 22, 23 - s, 25, 'a');
    }
    fillRectShaded(g, 3, 24, 22, 25, 'a', 'l', 'q');
    return g;
  },
  fps: { idle: 1.4, walk: 2.5, attack: 9, hit: 10, special: 6, death: 13 },
};

/** Registers all ten trash-enemy roster sprites (bosses live in SpriteLibraryBossArt.ts). */
export function registerEnemyRosterSprites(): void {
  registerEnemyArt('enemy_grunt', GRUNT_ART);
  registerEnemyArt('enemy_bat', BAT_ART);
  registerEnemyArt('enemy_skeleton', SKELETON_ART);
  registerEnemyArt('enemy_slime', SLIME_ART);
  registerEnemyArt('enemy_wolf', WOLF_ART);
  registerEnemyArt('enemy_ghost', GHOST_ART);
  registerEnemyArt('enemy_brute', BRUTE_ART);
  registerEnemyArt('enemy_spitter', SPITTER_ART);
  registerEnemyArt('enemy_ghoul', GHOUL_ART);
  registerEnemyArt('enemy_gargoyle', GARGOYLE_ART);
}
