import { spriteAtlas } from './SpriteAtlas';
import { drawPixelGrid, drawSoftCircle, makeGrid, fillRect, toRows } from './PixelDraw';

const GW = 16;
const GH = 18;

function humanoidGrid(opts: {
  legOffset: number; // 0 = neutral stance, +/-1 = walk stride
  armUp: boolean;
}): string[][] {
  const g = makeGrid(GW, GH);
  // hood/head
  fillRect(g, 6, 1, 9, 4, 'h');
  fillRect(g, 7, 2, 8, 3, 'e');
  // torso
  fillRect(g, 5, 5, 10, 11, 'b');
  fillRect(g, 6, 6, 9, 8, 'a'); // accent chest stripe
  // arms
  fillRect(g, 3, 6, 4, 10 + (opts.armUp ? -2 : 0), 'b');
  fillRect(g, 11, 6, 12, 10, 'b');
  // legs (offset animates the stride)
  const lo = opts.legOffset;
  fillRect(g, 6, 12, 7, 16 + lo, 'p');
  fillRect(g, 8, 12, 9, 16 - lo, 'p');
  // feet
  fillRect(g, 5, 16 + lo, 7, 17 + lo, 'o');
  fillRect(g, 8, 16 - lo, 10, 17 - lo, 'o');
  return colorize(g);
}

function colorize(g: string[][]): string[][] {
  for (const row of g) {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === 'h') row[x] = 'H';
      if (row[x] === 'b') row[x] = 'B';
      if (row[x] === 'a') row[x] = 'A';
      if (row[x] === 'p') row[x] = 'P';
    }
  }
  return g;
}

const PLAYER_PALETTE: Record<string, string> = {
  H: '#f2c88f',
  e: '#20241f',
  B: '#3d6fb4',
  A: '#e8b13a',
  P: '#26314a',
  o: '#171a17',
};

export function registerPlayerSprites(): void {
  const idleA = humanoidGrid({ legOffset: 0, armUp: false });
  const idleB = humanoidGrid({ legOffset: 0, armUp: true });
  const walkA = humanoidGrid({ legOffset: 2, armUp: false });
  const walkB = humanoidGrid({ legOffset: -2, armUp: true });

  spriteAtlas.registerClip('player_idle', 2.4, true, [
    { key: 'player_idle_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(idleA), PLAYER_PALETTE) },
    { key: 'player_idle_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(idleB), PLAYER_PALETTE) },
  ]);
  spriteAtlas.registerClip('player_walk', 8, true, [
    { key: 'player_walk_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(walkA), PLAYER_PALETTE) },
    { key: 'player_idle_0b', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(idleA), PLAYER_PALETTE) },
    { key: 'player_walk_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(walkB), PLAYER_PALETTE) },
    { key: 'player_idle_0c', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(idleA), PLAYER_PALETTE) },
  ]);

  // flinch/recoil pose - renderer applies white/red flash tint at runtime (aFlash/aTint),
  // this just needs a distinct enough silhouette (knocked slightly off-balance, arms out).
  const hitA = playerHitGrid(false);
  const hitB = playerHitGrid(true);
  spriteAtlas.registerClip('player_hit', 10, false, [
    { key: 'player_hit_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(hitA), PLAYER_PALETTE) },
    { key: 'player_hit_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(hitB), PLAYER_PALETTE) },
  ]);

  // attack flourish - brief wind-up / overhead-raise / forward-thrust arc played whenever
  // a weapon fires, so attacks read as a deliberate action distinct from walk/idle.
  const castA = playerCastGrid(0);
  const castB = playerCastGrid(1);
  const castC = playerCastGrid(2);
  spriteAtlas.registerClip('player_cast', 16, false, [
    { key: 'player_cast_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(castA), PLAYER_PALETTE) },
    { key: 'player_cast_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(castB), PLAYER_PALETTE) },
    { key: 'player_cast_2', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(castC), PLAYER_PALETTE) },
  ]);

  // collapsing sequence - progressively lower/wider silhouette as the character folds down.
  const deathFrames = [0, 1, 2, 3].map((stage) => playerDeathGrid(stage));
  spriteAtlas.registerClip(
    'player_death',
    4,
    false,
    deathFrames.map((g, i) => ({
      key: `player_death_${i}`,
      draw: (ctx: CanvasRenderingContext2D, size: number) => drawPixelGrid(ctx, size, toRows(g), PLAYER_PALETTE),
    })),
  );
}

function playerHitGrid(settled: boolean): string[][] {
  const g = makeGrid(GW, GH);
  const lean = settled ? 0 : 1;
  // head tilted back
  fillRect(g, 7 + lean, 0, 10 + lean, 3, 'h');
  fillRect(g, 8 + lean, 1, 9 + lean, 2, 'e');
  // torso leaning away from the hit
  fillRect(g, 6 + lean, 4, 11 + lean, 10, 'b');
  fillRect(g, 7 + lean, 5, 10 + lean, 7, 'a');
  // arms flung wide
  const armY1 = settled ? 6 : 5;
  fillRect(g, 1, 3, 3, armY1, 'b');
  fillRect(g, 12 + lean, 3, 14 + lean, armY1, 'b');
  // braced legs
  fillRect(g, 6, 11, 8, 16, 'p');
  fillRect(g, 9, 11, 11, 16, 'p');
  fillRect(g, 5, 16, 8, 17, 'o');
  fillRect(g, 9, 16, 12, 17, 'o');
  return colorize(g);
}

/**
 * Attack flourish pose. stage 0 = wind-up (arm cocked at shoulder height),
 * stage 1 = peak (arm raised straight overhead with a small accent glint),
 * stage 2 = release (torso leans forward, arm swings out into a thrust).
 * Legs stay planted (no stride) since this plays as a quick overlay on top
 * of whatever movement state the player is already in.
 */
function playerCastGrid(stage: number): string[][] {
  const g = makeGrid(GW, GH);
  const lean = stage === 2 ? 1 : 0;
  // hood/head - tips forward slightly on the release frame
  fillRect(g, 6 + lean, 1, 9 + lean, 4, 'h');
  fillRect(g, 7 + lean, 2, 8 + lean, 3, 'e');
  // torso
  fillRect(g, 5 + lean, 5, 10 + lean, 11, 'b');
  fillRect(g, 6 + lean, 6, 9 + lean, 8, 'a');
  // off-hand braced at the hip
  fillRect(g, 3, 8, 4, 10, 'b');
  // cast arm: cocked back -> raised overhead -> thrust forward
  if (stage === 0) {
    fillRect(g, 11, 5, 13, 7, 'b');
  } else if (stage === 1) {
    fillRect(g, 11, 0, 12, 6, 'b');
    fillRect(g, 12, 0, 13, 0, 'a'); // glint at the raised hand/weapon tip
  } else {
    fillRect(g, 12, 5, 15, 7, 'b');
  }
  // legs - short braced stance, no stride during the flourish
  fillRect(g, 6, 12, 7, 16, 'p');
  fillRect(g, 8, 12, 9, 16, 'p');
  fillRect(g, 5, 16, 7, 17, 'o');
  fillRect(g, 8, 16, 10, 17, 'o');
  return colorize(g);
}

function playerDeathGrid(stage: number): string[][] {
  const g = makeGrid(GW, GH);
  const drop = stage * 2;
  const headY = 1 + drop;
  fillRect(g, 6, headY, 9, headY + 3, 'h');
  fillRect(g, 7, headY + 1, 8, headY + 2, 'e');
  const torsoTop = headY + 4;
  const torsoBottom = Math.min(GH - 2, torsoTop + (6 - stage));
  fillRect(g, 5, torsoTop, 10, torsoBottom, 'b');
  fillRect(g, 6, torsoTop + 1, 9, torsoTop + 3, 'a');
  fillRect(g, 3 - stage, torsoTop, 4 - stage, torsoTop + 3, 'b');
  fillRect(g, 11 + stage, torsoTop, 12 + stage, torsoTop + 3, 'b');
  const legY = Math.min(GH - 2, torsoBottom + 1);
  fillRect(g, 5, legY, 11, Math.min(GH - 1, legY + 1), 'p');
  return colorize(g);
}

const GRUNT_PALETTE: Record<string, string> = {
  H: '#7fbf5a',
  e: '#171a17',
  B: '#4c8a37',
  A: '#2f5a24',
  P: '#3a6b2b',
  o: '#12160f',
};

function bruteGrid(legOffset: number): string[][] {
  const g = makeGrid(GW, GH);
  fillRect(g, 5, 1, 10, 5, 'h');
  fillRect(g, 6, 3, 7, 4, 'e');
  fillRect(g, 9, 3, 10, 4, 'e');
  fillRect(g, 4, 6, 11, 12, 'b');
  fillRect(g, 5, 7, 10, 9, 'a');
  fillRect(g, 5, 13, 7, 16 + legOffset, 'p');
  fillRect(g, 8, 13, 10, 16 - legOffset, 'p');
  return colorize(g);
}

export function registerBasicEnemySprites(): void {
  const a = bruteGrid(2);
  const b = bruteGrid(-2);
  spriteAtlas.registerClip('enemy_grunt_walk', 6, true, [
    { key: 'grunt_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), GRUNT_PALETTE) },
    { key: 'grunt_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), GRUNT_PALETTE) },
  ]);
}

export function registerPickupSprites(): void {
  const gemGrid = makeGrid(10, 10);
  fillRect(gemGrid, 4, 0, 5, 1, 'g');
  fillRect(gemGrid, 2, 2, 7, 3, 'g');
  fillRect(gemGrid, 1, 4, 8, 5, 'g');
  fillRect(gemGrid, 2, 6, 7, 7, 'd');
  fillRect(gemGrid, 4, 8, 5, 9, 'd');
  const palette = { g: '#59e0ff', d: '#1d7fbf' };
  spriteAtlas.registerClip('gem_basic', 1, true, [
    { key: 'gem_basic_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(gemGrid), palette) },
  ]);

  // Gilded Cache - a rare elite/boss drop, deliberately chest-shaped (not
  // just a bigger gem) so it reads as a distinct pickup type at a glance.
  const chestClosed = makeGrid(12, 12);
  fillRect(chestClosed, 1, 4, 10, 10, 'w'); // base
  fillRect(chestClosed, 1, 4, 10, 4, 'b'); // band under lid
  fillRect(chestClosed, 1, 1, 10, 3, 'l'); // lid
  fillRect(chestClosed, 1, 1, 10, 1, 'b'); // lid trim top
  fillRect(chestClosed, 5, 3, 6, 5, 'k'); // lock
  const chestGlowGrid = makeGrid(12, 12);
  fillRect(chestGlowGrid, 1, 4, 10, 10, 'w');
  fillRect(chestGlowGrid, 1, 4, 10, 4, 'b');
  fillRect(chestGlowGrid, 1, 1, 10, 3, 'l');
  fillRect(chestGlowGrid, 1, 1, 10, 1, 'b');
  fillRect(chestGlowGrid, 5, 3, 6, 5, 'k');
  fillRect(chestGlowGrid, 4, 2, 7, 2, 'e'); // sparkle line across the lid
  const chestPalette = { w: '#7a4a1f', b: '#c9a227', l: '#9a6a2f', k: '#3a2410', e: '#fff2b0' };
  spriteAtlas.registerClip('treasure_cache', 2.2, true, [
    { key: 'treasure_cache_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(chestClosed), chestPalette) },
    { key: 'treasure_cache_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(chestGlowGrid), chestPalette) },
  ]);
}

export function registerProjectileSprites(): void {
  const boltGrid = makeGrid(8, 8);
  fillRect(boltGrid, 3, 0, 4, 1, 'c');
  fillRect(boltGrid, 2, 1, 5, 3, 'c');
  fillRect(boltGrid, 1, 3, 6, 4, 'w');
  fillRect(boltGrid, 2, 4, 5, 6, 'c');
  fillRect(boltGrid, 3, 6, 4, 7, 'c');
  const palette = { c: '#ffd35c', w: '#fff6d8' };
  spriteAtlas.registerClip('bolt_basic', 1, true, [
    { key: 'bolt_basic_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(boltGrid), palette) },
  ]);
}

// ---------------------------------------------------------------------------
// Bat - small, dark violet, flighty. Wide bat-wing silhouette, low & wide.
// ---------------------------------------------------------------------------
const BAT_PALETTE: Record<string, string> = {
  b: '#3a1f52',
  w: '#7a3fa0',
  e: '#ff5470',
};

function batGrid(wingsUp: boolean): string[][] {
  const g = makeGrid(16, 12);
  fillRect(g, 6, 4, 9, 8, 'b');
  fillRect(g, 6, 3, 7, 3, 'b');
  fillRect(g, 8, 3, 9, 3, 'b');
  fillRect(g, 7, 5, 7, 5, 'e');
  fillRect(g, 8, 5, 8, 5, 'e');
  const wy0 = wingsUp ? 1 : 4;
  const wy1 = wingsUp ? 5 : 8;
  fillRect(g, 0, wy0, 5, wy0 + 1, 'w');
  fillRect(g, 1, wy0 + 2, 5, wy1, 'w');
  fillRect(g, 10, wy0, 15, wy0 + 1, 'w');
  fillRect(g, 10, wy0 + 2, 14, wy1, 'w');
  fillRect(g, 7, 9, 8, 10, 'b');
  return g;
}

export function registerBatSprites(): void {
  const a = batGrid(false);
  const b = batGrid(true);
  spriteAtlas.registerClip('enemy_bat_walk', 10, true, [
    { key: 'bat_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), BAT_PALETTE) },
    { key: 'bat_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), BAT_PALETTE) },
  ]);
}

// ---------------------------------------------------------------------------
// Skeleton - bone white/grey, gaunt vertical silhouette.
// ---------------------------------------------------------------------------
const SKELETON_PALETTE: Record<string, string> = {
  b: '#e8e2d0',
  e: '#1a1a1a',
  r: '#b7b0a0',
};

function skeletonGrid(legOffset: number): string[][] {
  const g = makeGrid(14, 20);
  fillRect(g, 5, 0, 8, 3, 'b');
  fillRect(g, 5, 1, 6, 1, 'e');
  fillRect(g, 7, 1, 8, 1, 'e');
  fillRect(g, 6, 4, 7, 9, 'b');
  fillRect(g, 4, 4, 9, 5, 'r');
  fillRect(g, 4, 6, 9, 7, 'r');
  fillRect(g, 4, 8, 9, 9, 'r');
  fillRect(g, 3, 5, 4, 9, 'b');
  fillRect(g, 9, 5, 10, 9, 'b');
  fillRect(g, 5, 10, 8, 11, 'b');
  fillRect(g, 5, 12, 6, 16 + legOffset, 'b');
  fillRect(g, 7, 12, 8, 16 - legOffset, 'b');
  fillRect(g, 4, 16 + legOffset, 7, 17 + legOffset, 'b');
  fillRect(g, 7, 16 - legOffset, 10, 17 - legOffset, 'b');
  return g;
}

export function registerSkeletonSprites(): void {
  const a = skeletonGrid(1);
  const b = skeletonGrid(-1);
  spriteAtlas.registerClip('enemy_skeleton_walk', 6, true, [
    { key: 'skeleton_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), SKELETON_PALETTE) },
    { key: 'skeleton_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), SKELETON_PALETTE) },
  ]);
}

// ---------------------------------------------------------------------------
// Slime - round blobby, translucent green/teal, squash-stretch between frames.
// ---------------------------------------------------------------------------
const SLIME_PALETTE: Record<string, string> = {
  g: 'rgba(61,220,151,0.75)',
  h: 'rgba(180,255,220,0.9)',
};

// phase 0 = tall rest pose, phase 1 = halfway into the squash, phase 2 = full squash.
function slimeGrid(phase: 0 | 1 | 2): string[][] {
  const g = makeGrid(16, 12);
  if (phase === 0) {
    fillRect(g, 5, 2, 10, 3, 'g');
    fillRect(g, 3, 4, 12, 7, 'g');
    fillRect(g, 2, 8, 13, 9, 'g');
    fillRect(g, 4, 10, 11, 10, 'g');
    fillRect(g, 5, 3, 7, 4, 'h');
  } else if (phase === 1) {
    // in-between: halfway (rounded) between the tall rest pose and the full squash below
    fillRect(g, 4, 3, 11, 4, 'g');
    fillRect(g, 2, 5, 13, 7, 'g');
    fillRect(g, 1, 8, 14, 9, 'g');
    fillRect(g, 3, 10, 12, 10, 'g');
    fillRect(g, 4, 4, 6, 5, 'h');
  } else {
    fillRect(g, 3, 5, 12, 6, 'g');
    fillRect(g, 1, 7, 14, 8, 'g');
    fillRect(g, 0, 9, 15, 10, 'g');
    fillRect(g, 2, 11, 13, 11, 'g');
    fillRect(g, 4, 6, 6, 7, 'h');
  }
  return g;
}

export function registerSlimeSprites(): void {
  // squash-stretch now passes through a halfway pose (0 -> 1 -> 2 -> 1) instead of
  // flipping directly between tall and squashed; fps doubled to keep the same
  // real-world bounce speed with the added in-between frames.
  const a = slimeGrid(0);
  const mid = slimeGrid(1);
  const b = slimeGrid(2);
  spriteAtlas.registerClip('enemy_slime_walk', 8, true, [
    { key: 'slime_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), SLIME_PALETTE) },
    { key: 'slime_mid', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(mid), SLIME_PALETTE) },
    { key: 'slime_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), SLIME_PALETTE) },
    { key: 'slime_mid_b', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(mid), SLIME_PALETTE) },
  ]);
}

// ---------------------------------------------------------------------------
// Wolf - low, wide silhouette (wider than tall), grey/brown fur.
// ---------------------------------------------------------------------------
const WOLF_PALETTE: Record<string, string> = {
  f: '#6b5d4f',
  d: '#4a3f35',
  e: '#ffd35c',
};

function wolfGrid(phase: boolean): string[][] {
  const g = makeGrid(20, 12);
  fillRect(g, 2, 4, 15, 7, 'f');
  fillRect(g, 14, 2, 19, 6, 'f');
  fillRect(g, 18, 4, 19, 5, 'f');
  fillRect(g, 14, 1, 15, 2, 'f');
  fillRect(g, 17, 1, 18, 2, 'f');
  fillRect(g, 16, 3, 16, 3, 'e');
  fillRect(g, 0, 2, 2, 4, 'f');
  fillRect(g, 3, 6, 14, 7, 'd');
  const a = phase ? 1 : 0;
  fillRect(g, 3 + a, 8, 4 + a, 11, 'f');
  fillRect(g, 7 - a, 8, 8 - a, 11, 'f');
  fillRect(g, 11 + a, 8, 12 + a, 11, 'f');
  fillRect(g, 15 - a, 8, 16 - a, 11, 'f');
  return g;
}

export function registerWolfSprites(): void {
  const a = wolfGrid(true);
  const b = wolfGrid(false);
  spriteAtlas.registerClip('enemy_wolf_walk', 8, true, [
    { key: 'wolf_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), WOLF_PALETTE) },
    { key: 'wolf_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), WOLF_PALETTE) },
  ]);
}

// ---------------------------------------------------------------------------
// Ghost - pale cyan/white, wispy tapered bottom instead of legs.
// ---------------------------------------------------------------------------
const GHOST_PALETTE: Record<string, string> = {
  g: 'rgba(189,243,247,0.8)',
  e: '#1c2e33',
  l: 'rgba(232,253,255,0.6)',
};

function ghostGrid(wispShift: number): string[][] {
  const g = makeGrid(14, 18);
  fillRect(g, 4, 0, 9, 0, 'g');
  fillRect(g, 3, 1, 10, 7, 'g');
  fillRect(g, 5, 3, 5, 3, 'e');
  fillRect(g, 8, 3, 8, 3, 'e');
  fillRect(g, 3 + wispShift, 8, 10 + wispShift, 9, 'g');
  fillRect(g, 4 + wispShift, 10, 9 + wispShift, 11, 'g');
  fillRect(g, 5, 12, 8, 13, 'g');
  fillRect(g, 5 - wispShift, 14, 8 - wispShift, 15, 'l');
  fillRect(g, 6, 16, 7, 17, 'l');
  return g;
}

export function registerGhostSprites(): void {
  // 0 -> 1 -> 2 -> 1 ping-pongs the wisp sway through a middle extreme instead of
  // flipping between just two poses, and fps is doubled alongside the frame count
  // so the sway completes in the same real-world time as before, just smoother.
  const a = ghostGrid(0);
  const b = ghostGrid(1);
  const c = ghostGrid(2);
  spriteAtlas.registerClip('enemy_ghost_walk', 6, true, [
    { key: 'ghost_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), GHOST_PALETTE) },
    { key: 'ghost_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), GHOST_PALETTE) },
    { key: 'ghost_2', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(c), GHOST_PALETTE) },
    { key: 'ghost_1b', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), GHOST_PALETTE) },
  ]);
}

// ---------------------------------------------------------------------------
// Brute - big, wide, heavily armored, dark red-brown. Biggest of the base roster.
// ---------------------------------------------------------------------------
const BIG_BRUTE_PALETTE: Record<string, string> = {
  h: '#3a1414',
  e: '#ff8a3d',
  b: '#5c2a1e',
  a: '#7a3a28',
  s: '#241010',
  p: '#40190f',
};

function bigBruteGrid(legOffset: number): string[][] {
  const g = makeGrid(18, 18);
  fillRect(g, 5, 0, 12, 4, 'h');
  fillRect(g, 7, 2, 8, 2, 'e');
  fillRect(g, 9, 2, 10, 2, 'e');
  fillRect(g, 3, 5, 14, 13, 'b');
  fillRect(g, 4, 6, 13, 9, 'a');
  fillRect(g, 2, 6, 3, 12, 's');
  fillRect(g, 14, 6, 15, 12, 's');
  fillRect(g, 0, 7, 2, 11, 'b');
  fillRect(g, 15, 7, 17, 11, 'b');
  fillRect(g, 5, 13, 8, 16 + legOffset, 'p');
  fillRect(g, 9, 13, 12, 16 - legOffset, 'p');
  return g;
}

export function registerBruteSprites(): void {
  // stride now passes through a neutral mid-stance (1 -> 0 -> -1 -> 0) instead of
  // flipping directly between the two extremes; fps doubled to keep the same
  // real-world stride speed with the added in-between frames.
  const a = bigBruteGrid(1);
  const mid = bigBruteGrid(0);
  const b = bigBruteGrid(-1);
  spriteAtlas.registerClip('enemy_brute_walk', 10, true, [
    { key: 'bigbrute_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), BIG_BRUTE_PALETTE) },
    { key: 'bigbrute_mid', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(mid), BIG_BRUTE_PALETTE) },
    { key: 'bigbrute_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), BIG_BRUTE_PALETTE) },
    { key: 'bigbrute_mid_b', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(mid), BIG_BRUTE_PALETTE) },
  ]);
}

// ---------------------------------------------------------------------------
// Spitter - sickly yellow-green, proboscis/mouth detail for "ranged attacker".
// ---------------------------------------------------------------------------
const SPITTER_PALETTE: Record<string, string> = {
  b: '#9acb3a',
  e: '#1c2408',
  m: '#c7d94f',
  n: '#5a6b1f',
  p: '#6f8a2a',
};

function spitterGrid(legOffset: number): string[][] {
  const g = makeGrid(16, 16);
  fillRect(g, 4, 1, 11, 7, 'b');
  fillRect(g, 5, 3, 6, 4, 'e');
  fillRect(g, 9, 3, 10, 4, 'e');
  fillRect(g, 11, 5, 14, 6, 'm');
  fillRect(g, 13, 4, 15, 5, 'n');
  fillRect(g, 4, 8, 11, 11, 'b');
  fillRect(g, 5, 12, 7, 14 + legOffset, 'p');
  fillRect(g, 8, 12, 10, 14 - legOffset, 'p');
  return g;
}

export function registerSpitterSprites(): void {
  const a = spitterGrid(1);
  const b = spitterGrid(-1);
  spriteAtlas.registerClip('enemy_spitter_walk', 5, true, [
    { key: 'spitter_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), SPITTER_PALETTE) },
    { key: 'spitter_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), SPITTER_PALETTE) },
  ]);
}

// ---------------------------------------------------------------------------
// Ghoul - charger/dasher. Twin amethyst-crystal heads on thin stalks over a
// tattered robe; no visible legs (it shambles/glides between dashes), so its
// "walk" is a gentle counter-sway of the two heads and the hem rather than a
// leg stride.
// ---------------------------------------------------------------------------
const GHOUL_PALETTE: Record<string, string> = {
  c: '#c9a6f0', // crystal light
  h: '#e8d4ff', // crystal highlight
  d: '#8a5fc4', // crystal shadow/underside
  n: '#8a7248', // stalk / robe shoulder accent
  r: '#6b5a3a', // robe main
  s: '#4a3d28', // robe shade
  m: '#5a2f2a', // robe lower shade (darker, warmer - matches the hem gradient)
  o: '#1a1410', // ground shadow
};

function ghoulGrid(sway: number): string[][] {
  const g = makeGrid(16, 20);
  const ls = sway; // left crystal/stalk sways opposite the right one
  const rs = -sway;

  // left crystal head: teardrop gem + small secondary bead, on a thin neck
  fillRect(g, 3 + ls, 1, 6 + ls, 2, 'c');
  fillRect(g, 4 + ls, 0, 5 + ls, 0, 'h');
  fillRect(g, 3 + ls, 3, 6 + ls, 3, 'c');
  fillRect(g, 5 + ls, 3, 6 + ls, 3, 'd');
  fillRect(g, 4 + ls, 4, 5 + ls, 4, 'c');
  fillRect(g, 4, 5, 5, 7, 'n');

  // right crystal head: mirrored
  fillRect(g, 9 + rs, 1, 12 + rs, 2, 'c');
  fillRect(g, 10 + rs, 0, 11 + rs, 0, 'h');
  fillRect(g, 9 + rs, 3, 12 + rs, 3, 'c');
  fillRect(g, 11 + rs, 3, 12 + rs, 3, 'd');
  fillRect(g, 10 + rs, 4, 11 + rs, 4, 'c');
  fillRect(g, 10, 5, 11, 7, 'n');

  // robe: narrow at the shoulders, widening toward a swaying hem
  fillRect(g, 4, 7, 11, 9, 'n');
  fillRect(g, 3, 9, 12, 13, 'r');
  fillRect(g, 5, 10, 10, 12, 's');
  fillRect(g, 2, 13, 13, 17, 'r');
  fillRect(g, 3, 14, 12, 16, 'm');
  fillRect(g, 1 + sway, 17, 14 + sway, 18, 'r');
  fillRect(g, 2 + sway, 18, 13 + sway, 18, 'o');
  return g;
}

export function registerGhoulSprites(): void {
  const a = ghoulGrid(0);
  const b = ghoulGrid(1);
  spriteAtlas.registerClip('enemy_ghoul_walk', 3, true, [
    { key: 'ghoul_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), GHOUL_PALETTE) },
    { key: 'ghoul_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), GHOUL_PALETTE) },
  ]);
}

// ---------------------------------------------------------------------------
// Gargoyle - stationary turret. Squat stone statue, wings spread wide for a
// low silhouette, clawed feet planted apart. Barely moves in play, so its
// two-frame "idle" is a violet eye-glow pulse instead of a stride.
// ---------------------------------------------------------------------------
const GARGOYLE_PALETTE: Record<string, string> = {
  t: '#8a8a92', // stone base
  d: '#4f4f58', // stone shade
  l: '#a8a8b2', // stone highlight
  w: '#5a4a68', // wing membrane
  k: '#2a2a30', // horns / claws
  e: '#8a5fc4', // eye glow (dim)
};

function gargoyleGrid(eyeBright: boolean): string[][] {
  const g = makeGrid(18, 16);
  // horns
  fillRect(g, 7, 0, 7, 1, 'k');
  fillRect(g, 10, 0, 10, 1, 'k');
  // head
  fillRect(g, 6, 1, 11, 5, 't');
  fillRect(g, 6, 4, 7, 5, 'd');
  fillRect(g, 10, 4, 11, 5, 'd');
  fillRect(g, 7, 3, 8, 3, eyeBright ? 'l' : 'e');
  fillRect(g, 9, 3, 10, 3, eyeBright ? 'l' : 'e');
  // wings spread wide and low, angular bat-membrane shapes
  fillRect(g, 0, 5, 5, 6, 'w');
  fillRect(g, 0, 7, 4, 8, 'w');
  fillRect(g, 1, 9, 3, 9, 'w');
  fillRect(g, 12, 5, 17, 6, 'w');
  fillRect(g, 13, 7, 17, 8, 'w');
  fillRect(g, 14, 9, 16, 9, 'w');
  // torso, wide and blocky
  fillRect(g, 5, 6, 12, 12, 't');
  fillRect(g, 6, 7, 11, 9, 'l');
  fillRect(g, 5, 10, 6, 12, 'd');
  fillRect(g, 11, 10, 12, 12, 'd');
  // feet planted wide with small claw notches
  fillRect(g, 4, 13, 7, 15, 't');
  fillRect(g, 10, 13, 13, 15, 't');
  fillRect(g, 4, 15, 5, 15, 'k');
  fillRect(g, 6, 15, 7, 15, 'k');
  fillRect(g, 10, 15, 11, 15, 'k');
  fillRect(g, 12, 15, 13, 15, 'k');
  return g;
}

export function registerGargoyleSprites(): void {
  const a = gargoyleGrid(false);
  const b = gargoyleGrid(true);
  spriteAtlas.registerClip('enemy_gargoyle_walk', 1.4, true, [
    { key: 'gargoyle_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), GARGOYLE_PALETTE) },
    { key: 'gargoyle_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), GARGOYLE_PALETTE) },
  ]);
}

export function registerEnemyVarietySprites(): void {
  registerBatSprites();
  registerSkeletonSprites();
  registerSlimeSprites();
  registerWolfSprites();
  registerGhostSprites();
  registerBruteSprites();
  registerSpitterSprites();
  registerGhoulSprites();
  registerGargoyleSprites();
}

// ---------------------------------------------------------------------------
// Bosses - bigger, more detailed, imposing silhouettes with distinct color identity.
// ---------------------------------------------------------------------------
const ROTKING_PALETTE: Record<string, string> = {
  k: '#c9a227',
  h: '#7a9a3a',
  e: '#b95cff',
  b: '#5c6b2e',
  a: '#7a3a9a',
  p: '#3a2a4a',
};

function rotkingGrid(legOffset: number): string[][] {
  const g = makeGrid(22, 22);
  fillRect(g, 8, 0, 9, 1, 'k');
  fillRect(g, 11, 0, 12, 1, 'k');
  fillRect(g, 14, 0, 15, 1, 'k');
  fillRect(g, 7, 1, 16, 2, 'k');
  fillRect(g, 7, 3, 16, 7, 'h');
  fillRect(g, 9, 4, 10, 5, 'e');
  fillRect(g, 13, 4, 14, 5, 'e');
  fillRect(g, 4, 8, 19, 16, 'b');
  fillRect(g, 6, 9, 17, 12, 'a');
  fillRect(g, 3, 9, 4, 15, 'b');
  fillRect(g, 19, 9, 20, 15, 'b');
  fillRect(g, 7, 17, 10, 20 + legOffset, 'p');
  fillRect(g, 13, 17, 16, 20 - legOffset, 'p');
  return g;
}

export function registerRotKingSprites(): void {
  const a = rotkingGrid(1);
  const b = rotkingGrid(-1);
  spriteAtlas.registerClip('boss_rotking_walk', 4, true, [
    { key: 'rotking_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), ROTKING_PALETTE) },
    { key: 'rotking_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), ROTKING_PALETTE) },
  ]);
}

const BONECOLOSSUS_PALETTE: Record<string, string> = {
  b: '#d8d0b8',
  j: '#3a3428',
};

function bonecolossusGrid(legOffset: number): string[][] {
  const g = makeGrid(22, 24);
  fillRect(g, 7, 0, 14, 4, 'b');
  fillRect(g, 8, 1, 9, 2, 'j');
  fillRect(g, 12, 1, 13, 2, 'j');
  fillRect(g, 2, 5, 19, 15, 'b');
  fillRect(g, 4, 6, 17, 7, 'j');
  fillRect(g, 4, 9, 17, 10, 'j');
  fillRect(g, 4, 12, 17, 13, 'j');
  fillRect(g, 0, 6, 2, 14, 'b');
  fillRect(g, 19, 6, 21, 14, 'b');
  fillRect(g, 7, 16, 10, 20 + legOffset, 'b');
  fillRect(g, 12, 16, 15, 20 - legOffset, 'b');
  fillRect(g, 6, 20 + legOffset, 11, 22 + legOffset, 'j');
  fillRect(g, 11, 20 - legOffset, 16, 22 - legOffset, 'j');
  return g;
}

export function registerBoneColossusSprites(): void {
  // ponderous stomp now swings through a neutral mid-stance (1 -> 0 -> -1 -> 0)
  // instead of flipping directly between the two extremes; fps doubled so the
  // stomp lands at the same real-world cadence with the extra in-between frames.
  const a = bonecolossusGrid(1);
  const mid = bonecolossusGrid(0);
  const b = bonecolossusGrid(-1);
  spriteAtlas.registerClip('boss_bonecolossus_walk', 6, true, [
    { key: 'bonecolossus_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), BONECOLOSSUS_PALETTE) },
    { key: 'bonecolossus_mid', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(mid), BONECOLOSSUS_PALETTE) },
    { key: 'bonecolossus_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), BONECOLOSSUS_PALETTE) },
    { key: 'bonecolossus_mid_b', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(mid), BONECOLOSSUS_PALETTE) },
  ]);
}

// ---------------------------------------------------------------------------
// Duskfang - fast, low-slung spectral hound boss. Distinct silhouette from
// Rot King/Bone Colossus (both tall bipedal brutes): quadruped stance, wide
// and low, smaller footprint, jagged spine spikes, glowing cyan eyes over
// near-black violet fur - reads as a quick predator, not a lumbering giant.
// ---------------------------------------------------------------------------
const DUSKFANG_PALETTE: Record<string, string> = {
  f: '#241a30',
  d: '#140e1c',
  s: '#4a3868',
  e: '#7ef7ff',
  c: '#d8ffff',
};

function duskfangGrid(legOffset: number): string[][] {
  const g = makeGrid(24, 20);
  const lo = legOffset;

  // tail, thin and trailing low behind the haunches
  fillRect(g, 0, 11, 2, 12, 'd');
  fillRect(g, 2, 10, 5, 11, 'f');

  // haunches - raised rear end
  fillRect(g, 4, 6, 10, 11, 'f');
  fillRect(g, 5, 7, 9, 8, 'd');

  // jagged spine spikes
  fillRect(g, 8, 2, 9, 5, 's');
  fillRect(g, 11, 1, 12, 5, 's');
  fillRect(g, 13, 1, 14, 5, 's');
  fillRect(g, 16, 2, 17, 5, 's');

  // torso, low and wide
  fillRect(g, 6, 7, 19, 13, 'f');
  fillRect(g, 7, 9, 18, 10, 'd');

  // head, forward and low-slung, jaw jutting out
  fillRect(g, 17, 5, 23, 10, 'f');
  fillRect(g, 21, 7, 23, 9, 'd'); // snout shade
  fillRect(g, 19, 7, 20, 7, 'e'); // eye glow
  fillRect(g, 20, 7, 20, 7, 'c'); // eye highlight/catch-light

  // legs - diagonal trot, front-right and rear-left share phase
  fillRect(g, 16, 14, 18, 18 + lo, 'f');
  fillRect(g, 19, 14, 21, 18 - lo, 'f');
  fillRect(g, 5, 14, 7, 18 - lo, 'f');
  fillRect(g, 8, 14, 10, 18 + lo, 'f');

  return g;
}

export function registerDuskfangSprites(): void {
  const a = duskfangGrid(1);
  const b = duskfangGrid(-1);
  spriteAtlas.registerClip('boss_duskfang_walk', 8, true, [
    { key: 'duskfang_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), DUSKFANG_PALETTE) },
    { key: 'duskfang_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), DUSKFANG_PALETTE) },
  ]);
}

export function registerBossSprites(): void {
  registerRotKingSprites();
  registerBoneColossusSprites();
  registerDuskfangSprites();
}

// ---------------------------------------------------------------------------
// Weapon & projectile visuals.
// ---------------------------------------------------------------------------
export function registerWeaponSprites(): void {
  // spinning axe head - grey metal + brown handle accent
  const axeGrid = makeGrid(10, 10);
  fillRect(axeGrid, 4, 0, 5, 9, 'w');
  fillRect(axeGrid, 0, 2, 4, 2, 'm');
  fillRect(axeGrid, 0, 3, 3, 3, 'm');
  fillRect(axeGrid, 0, 4, 2, 4, 'm');
  fillRect(axeGrid, 5, 2, 9, 2, 'm');
  fillRect(axeGrid, 6, 3, 9, 3, 'm');
  fillRect(axeGrid, 7, 4, 9, 4, 'm');
  fillRect(axeGrid, 3, 1, 6, 1, 'h');
  const axePalette = { w: '#7a4a2a', m: '#c8ccd4', h: '#eef1f5' };
  spriteAtlas.registerClip('proj_axe', 1, true, [
    { key: 'proj_axe_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(axeGrid), axePalette) },
  ]);

  // slim fast dagger - silver/white
  const knifeGrid = makeGrid(6, 14);
  fillRect(knifeGrid, 2, 0, 3, 1, 't');
  fillRect(knifeGrid, 1, 1, 4, 7, 'b');
  fillRect(knifeGrid, 2, 8, 3, 9, 'd');
  fillRect(knifeGrid, 2, 10, 3, 13, 'h');
  const knifePalette = { t: '#fefefe', b: '#d8dde6', d: '#3a3a3a', h: '#5a3a20' };
  spriteAtlas.registerClip('proj_knife', 1, true, [
    { key: 'proj_knife_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(knifeGrid), knifePalette) },
  ]);

  // warm glowing fireball - radial soft circle over a bright core
  spriteAtlas.registerClip('proj_fireball', 8, true, [
    {
      key: 'proj_fireball_0',
      draw: (ctx, size) => {
        drawSoftCircle(ctx, size / 2, size / 2, size * 0.45, '#ff6a1f', 0.9);
        drawSoftCircle(ctx, size / 2, size / 2, size * 0.26, '#ffd35c', 1);
      },
    },
    {
      key: 'proj_fireball_1',
      draw: (ctx, size) => {
        drawSoftCircle(ctx, size / 2, size / 2, size * 0.5, '#ff8a3d', 0.85);
        drawSoftCircle(ctx, size / 2, size / 2, size * 0.3, '#fff2b0', 1);
      },
    },
  ]);

  // small glowing blade/shard meant to spin around the player
  const orbiterGrid = makeGrid(8, 16);
  fillRect(orbiterGrid, 3, 0, 4, 1, 't');
  fillRect(orbiterGrid, 2, 1, 5, 3, 'b');
  fillRect(orbiterGrid, 1, 3, 6, 7, 'b');
  fillRect(orbiterGrid, 2, 7, 5, 10, 'b');
  fillRect(orbiterGrid, 3, 10, 4, 13, 'b');
  fillRect(orbiterGrid, 3, 4, 4, 6, 'c');
  const orbiterPaletteA = { t: '#eafcff', b: '#4fd9ff', c: '#ffffff' };
  const orbiterPaletteB = { t: '#eafcff', b: '#7fe6ff', c: '#dffcff' };
  spriteAtlas.registerClip('orbiter_blade', 4, true, [
    { key: 'orbiter_blade_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(orbiterGrid), orbiterPaletteA) },
    { key: 'orbiter_blade_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(orbiterGrid), orbiterPaletteB) },
  ]);

  // translucent gold/white ring/halo - pixel-art stepped band instead of a
  // smooth canvas arc()/stroke(), so it reads as chunky retro pixel art
  // like everything else on screen instead of a modern vector-UI ring
  // floating over it. Built the same way gemGrid/slimeGrid/batGrid fake
  // roundness elsewhere in this file: per-row horizontal spans computed
  // from the ring's inner/outer radii rather than an anti-aliased curve.
  const RING_GRID = 16;
  const paintRing = (g: string[][], outerR: number, innerR: number, ch: string): void => {
    const c = (RING_GRID - 1) / 2;
    for (let y = 0; y < RING_GRID; y++) {
      const dy = y - c;
      if (Math.abs(dy) > outerR) continue;
      const outerHalf = Math.sqrt(Math.max(0, outerR * outerR - dy * dy));
      const xOuterL = Math.round(c - outerHalf);
      const xOuterR = Math.round(c + outerHalf);
      if (Math.abs(dy) < innerR) {
        // Row crosses the hollow center: fill the two side spans only.
        const innerHalf = Math.sqrt(Math.max(0, innerR * innerR - dy * dy));
        const xInnerL = Math.round(c - innerHalf);
        const xInnerR = Math.round(c + innerHalf);
        fillRect(g, xOuterL, y, xInnerL - 1, y, ch);
        fillRect(g, xInnerR + 1, y, xOuterR, y, ch);
      } else {
        // Row is above/below the hole entirely: solid cap of the band.
        fillRect(g, xOuterL, y, xOuterR, y, ch);
      }
    }
  };
  // Frame A: dim/smaller pulse-low. Frame B: bright/bigger pulse-high -
  // same idea as the original two alternating alpha/radius frames, just
  // rasterized instead of stroked so the pulse still reads as a beat, not
  // just a smoothness difference.
  const ringGridA = makeGrid(RING_GRID, RING_GRID);
  paintRing(ringGridA, 7.0, 5.0, 'g');
  paintRing(ringGridA, 6.3, 5.5, 'w');
  const ringGridB = makeGrid(RING_GRID, RING_GRID);
  paintRing(ringGridB, 7.4, 5.2, 'g');
  paintRing(ringGridB, 6.6, 5.7, 'w');
  // Alpha kept in the palette (not the pixel shape) so the band still
  // glows translucently against the ground, matching the original's
  // "translucent gold/white halo" intent while staying blocky/stepped.
  const ringPaletteA = { g: 'rgba(255,233,168,0.45)', w: 'rgba(255,246,216,0.8)' };
  const ringPaletteB = { g: 'rgba(255,233,168,0.6)', w: 'rgba(255,246,216,0.95)' };
  spriteAtlas.registerClip('aoe_ring_holy', 3, true, [
    { key: 'aoe_ring_holy_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(ringGridA), ringPaletteA) },
    { key: 'aoe_ring_holy_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(ringGridB), ringPaletteB) },
  ]);
}

// ---------------------------------------------------------------------------
// VFX icons - small, simple, drawn at particle scale.
// ---------------------------------------------------------------------------
export function registerVfxSprites(): void {
  // tiny bright cross/star burst
  const sparkA = makeGrid(8, 8);
  fillRect(sparkA, 3, 0, 4, 1, 's');
  fillRect(sparkA, 3, 6, 4, 7, 's');
  fillRect(sparkA, 0, 3, 1, 4, 's');
  fillRect(sparkA, 6, 3, 7, 4, 's');
  fillRect(sparkA, 3, 3, 4, 4, 'c');
  const sparkB = makeGrid(8, 8);
  fillRect(sparkB, 1, 1, 2, 2, 's');
  fillRect(sparkB, 5, 1, 6, 2, 's');
  fillRect(sparkB, 1, 5, 2, 6, 's');
  fillRect(sparkB, 5, 5, 6, 6, 's');
  fillRect(sparkB, 3, 3, 4, 4, 'c');
  const sparkPalette = { s: '#fff6b0', c: '#ffffff' };
  spriteAtlas.registerClip('vfx_spark', 10, true, [
    { key: 'vfx_spark_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(sparkA), sparkPalette) },
    { key: 'vfx_spark_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(sparkB), sparkPalette) },
  ]);

  // small jagged impact-star shape, white/yellow
  const hitA = makeGrid(12, 12);
  fillRect(hitA, 5, 3, 6, 4, 'w');
  fillRect(hitA, 5, 7, 6, 8, 'w');
  fillRect(hitA, 3, 5, 4, 6, 'w');
  fillRect(hitA, 7, 5, 8, 6, 'w');
  fillRect(hitA, 5, 5, 6, 6, 'c');
  const hitB = makeGrid(12, 12);
  fillRect(hitB, 5, 0, 6, 2, 'w');
  fillRect(hitB, 5, 9, 6, 11, 'w');
  fillRect(hitB, 0, 5, 2, 6, 'w');
  fillRect(hitB, 9, 5, 11, 6, 'w');
  fillRect(hitB, 2, 2, 3, 3, 'y');
  fillRect(hitB, 8, 2, 9, 3, 'y');
  fillRect(hitB, 2, 8, 3, 9, 'y');
  fillRect(hitB, 8, 8, 9, 9, 'y');
  fillRect(hitB, 5, 5, 6, 6, 'c');
  const hitPalette = { w: '#ffffff', y: '#ffe066', c: '#fff6d8' };
  spriteAtlas.registerClip('vfx_hit_burst', 12, false, [
    { key: 'vfx_hit_burst_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(hitA), hitPalette) },
    { key: 'vfx_hit_burst_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(hitB), hitPalette) },
  ]);

  // bigger radiant burst/star, gold
  const levelA = makeGrid(16, 16);
  fillRect(levelA, 7, 5, 8, 6, 'g');
  fillRect(levelA, 7, 9, 8, 10, 'g');
  fillRect(levelA, 5, 7, 6, 8, 'g');
  fillRect(levelA, 9, 7, 10, 8, 'g');
  fillRect(levelA, 6, 6, 9, 9, 'w');
  const levelB = makeGrid(16, 16);
  fillRect(levelB, 7, 0, 8, 3, 'g');
  fillRect(levelB, 7, 13, 8, 15, 'g');
  fillRect(levelB, 0, 7, 3, 8, 'g');
  fillRect(levelB, 13, 7, 15, 8, 'g');
  fillRect(levelB, 2, 2, 4, 4, 'y');
  fillRect(levelB, 11, 2, 13, 4, 'y');
  fillRect(levelB, 2, 11, 4, 13, 'y');
  fillRect(levelB, 11, 11, 13, 13, 'y');
  fillRect(levelB, 6, 6, 9, 9, 'w');
  const levelPalette = { g: '#ffcc33', y: '#fff08a', w: '#ffffff' };
  spriteAtlas.registerClip('vfx_levelup_burst', 8, false, [
    { key: 'vfx_levelup_burst_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(levelA), levelPalette) },
    { key: 'vfx_levelup_burst_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(levelB), levelPalette) },
  ]);

  // soft round grey puff
  spriteAtlas.registerClip('vfx_smoke', 3, true, [
    { key: 'vfx_smoke_0', draw: (ctx, size) => drawSoftCircle(ctx, size / 2, size / 2, size * 0.4, '#9a9a9a', 0.5) },
    { key: 'vfx_smoke_1', draw: (ctx, size) => drawSoftCircle(ctx, size / 2, size / 2, size * 0.48, '#b5b5b5', 0.35) },
  ]);
}

// ---------------------------------------------------------------------------
// Stage decor - static, non-interactive pixel-art scenery scattered across
// the ground per stage (see StageDecor.ts). Each stage's ground palette
// (Stages.ts) only swaps 3 flat colors, so these props exist purely to make
// each stage read as its own place beyond a color tint. Kept small/simple
// (background texture, not focal points) with 2-3 variants per theme for
// visual variety, and colored to contrast clearly against each stage's
// ground tones rather than blend into them.
// ---------------------------------------------------------------------------

// Graveyard - weathered stone tombstones. Light stone grey with a darker
// shade side and a faint moss accent reads clearly against the graveyard's
// cool blue-grey ground (#232a35).
const TOMBSTONE_PALETTE: Record<string, string> = {
  s: '#9aa0ab',
  d: '#5f6570',
  c: '#333944',
  m: '#5a7a5a',
};

function tombstoneArchGrid(): string[][] {
  const g = makeGrid(10, 14);
  fillRect(g, 3, 0, 6, 1, 's');
  fillRect(g, 2, 1, 7, 3, 's');
  fillRect(g, 2, 3, 7, 10, 's');
  fillRect(g, 2, 3, 3, 10, 'd');
  fillRect(g, 5, 5, 5, 8, 'c');
  fillRect(g, 2, 9, 4, 10, 'm');
  fillRect(g, 1, 10, 8, 12, 'd');
  return g;
}

function tombstoneCrossGrid(): string[][] {
  const g = makeGrid(10, 16);
  fillRect(g, 4, 1, 5, 12, 's');
  fillRect(g, 1, 4, 8, 5, 's');
  fillRect(g, 4, 1, 4, 12, 'd');
  fillRect(g, 1, 4, 8, 4, 'd');
  fillRect(g, 2, 12, 7, 14, 'd');
  fillRect(g, 3, 13, 4, 13, 'm');
  return g;
}

function tombstoneCrackedGrid(): string[][] {
  const g = makeGrid(10, 12);
  fillRect(g, 2, 1, 3, 1, 's');
  fillRect(g, 5, 0, 6, 0, 's');
  fillRect(g, 2, 2, 7, 8, 's');
  fillRect(g, 2, 2, 3, 8, 'd');
  fillRect(g, 5, 2, 5, 5, 'c');
  fillRect(g, 6, 5, 6, 8, 'c');
  fillRect(g, 1, 8, 8, 10, 'd');
  fillRect(g, 6, 8, 8, 9, 'm');
  return g;
}

// Cursed forest - gnarled, twisted trees. Dark violet-brown trunk against
// the forest's dark green ground (#1c2417), with sickly yellow-green moss
// clumps for texture that don't just blend into the canopy-dark palette.
const TWISTED_TREE_PALETTE: Record<string, string> = {
  t: '#241a30',
  k: '#150f1c',
  b: '#3a2a1c',
  m: '#5a7a3a',
  h: '#7a9a3a',
};

function twistedTreeGrid(lean: number): string[][] {
  const g = makeGrid(14, 18);
  // trunk, slightly leaning/twisted partway up
  fillRect(g, 6, 10, 8, 17, 't');
  fillRect(g, 6 + lean, 6, 7 + lean, 10, 't');
  fillRect(g, 6, 10, 6, 17, 'k');
  // gnarled branches reaching out asymmetrically
  fillRect(g, 2, 6, 6, 7, 'b');
  fillRect(g, 1, 4, 3, 5, 'b');
  fillRect(g, 8 + lean, 4, 12 + lean, 5, 'b');
  fillRect(g, 10 + lean, 2, 12 + lean, 3, 'b');
  fillRect(g, 5 + lean, 2, 6 + lean, 6, 'b');
  // sickly moss clumps
  fillRect(g, 2, 5, 4, 6, 'm');
  fillRect(g, 9 + lean, 3, 11 + lean, 4, 'h');
  fillRect(g, 5 + lean, 1, 7 + lean, 2, 'm');
  return g;
}

function deadStumpGrid(): string[][] {
  const g = makeGrid(12, 10);
  fillRect(g, 3, 3, 8, 9, 't');
  fillRect(g, 3, 3, 4, 9, 'k');
  fillRect(g, 2, 1, 5, 3, 'b');
  fillRect(g, 7, 0, 10, 2, 'b');
  fillRect(g, 5, 2, 6, 3, 'b');
  fillRect(g, 4, 8, 6, 9, 'm');
  return g;
}

// Ruined library - leaning bookshelves and toppled tome/scroll piles. Faded
// jewel-tone spines (red/teal/gold) read clearly against the library's warm
// brown ground (#3a2a1c).
const LIBRARY_PALETTE: Record<string, string> = {
  w: '#5c3d22',
  d: '#2c1c0f',
  r: '#8a2f2f',
  u: '#2f5a6b',
  y: '#a8862f',
  p: '#c9b789',
};

function bookshelfGrid(tall: boolean): string[][] {
  const h = tall ? 18 : 14;
  const g = makeGrid(12, h);
  fillRect(g, 0, 0, 11, 1, 'w');
  fillRect(g, 0, 0, 1, h - 1, 'w');
  fillRect(g, 10, 0, 11, h - 1, 'w');
  fillRect(g, 0, h - 2, 11, h - 1, 'd');
  const rows = tall ? 3 : 2;
  for (let r = 0; r < rows; r++) {
    const y0 = 2 + r * 5;
    const y1 = y0 + 3;
    fillRect(g, 2, y0, 9, y1, r % 2 === 0 ? 'r' : 'u');
    fillRect(g, 2, y0, 2, y1, 'y');
    fillRect(g, 5, y0, 5, y1, 'p');
    fillRect(g, 8, y0, 8, y1, 'y');
    fillRect(g, 2, y1 + 1, 9, y1 + 1, 'd');
  }
  return g;
}

function scrollPileGrid(): string[][] {
  const g = makeGrid(14, 8);
  fillRect(g, 1, 5, 12, 7, 'r');
  fillRect(g, 1, 5, 12, 5, 'd');
  fillRect(g, 2, 3, 10, 5, 'u');
  fillRect(g, 2, 3, 10, 3, 'd');
  fillRect(g, 4, 1, 9, 3, 'p');
  fillRect(g, 3, 2, 4, 2, 'y');
  fillRect(g, 9, 2, 10, 2, 'y');
  return g;
}

/**
 * Static decor props for each of the 3 stages (see `src/game/Stages.ts`).
 * Clip names follow `decor_<stageTheme>_<propKind>_<variant>` so StageDecor
 * can look them up per `StageDef.id`. Single-frame clips (fps/loop values
 * are irrelevant since nothing ever advances them) - these props never move
 * or animate, matching StageDecor's "populate once, no update()" contract.
 */
export function registerDecorSprites(): void {
  const tombstoneA = tombstoneArchGrid();
  const tombstoneB = tombstoneCrossGrid();
  const tombstoneC = tombstoneCrackedGrid();
  spriteAtlas.registerClip('decor_graveyard_tombstone_0', 1, true, [
    { key: 'decor_graveyard_tombstone_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(tombstoneA), TOMBSTONE_PALETTE) },
  ]);
  spriteAtlas.registerClip('decor_graveyard_tombstone_1', 1, true, [
    { key: 'decor_graveyard_tombstone_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(tombstoneB), TOMBSTONE_PALETTE) },
  ]);
  spriteAtlas.registerClip('decor_graveyard_tombstone_2', 1, true, [
    { key: 'decor_graveyard_tombstone_2', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(tombstoneC), TOMBSTONE_PALETTE) },
  ]);

  const treeA = twistedTreeGrid(0);
  const treeB = twistedTreeGrid(2);
  const stump = deadStumpGrid();
  spriteAtlas.registerClip('decor_forest_tree_0', 1, true, [
    { key: 'decor_forest_tree_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(treeA), TWISTED_TREE_PALETTE) },
  ]);
  spriteAtlas.registerClip('decor_forest_tree_1', 1, true, [
    { key: 'decor_forest_tree_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(treeB), TWISTED_TREE_PALETTE) },
  ]);
  spriteAtlas.registerClip('decor_forest_tree_2', 1, true, [
    { key: 'decor_forest_tree_2', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(stump), TWISTED_TREE_PALETTE) },
  ]);

  const shelfShort = bookshelfGrid(false);
  const shelfTall = bookshelfGrid(true);
  const scrolls = scrollPileGrid();
  spriteAtlas.registerClip('decor_library_shelf_0', 1, true, [
    { key: 'decor_library_shelf_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(shelfShort), LIBRARY_PALETTE) },
  ]);
  spriteAtlas.registerClip('decor_library_shelf_1', 1, true, [
    { key: 'decor_library_shelf_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(shelfTall), LIBRARY_PALETTE) },
  ]);
  spriteAtlas.registerClip('decor_library_scrolls_0', 1, true, [
    { key: 'decor_library_scrolls_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(scrolls), LIBRARY_PALETTE) },
  ]);
}

export function registerCoreSprites(): void {
  registerPlayerSprites();
  registerBasicEnemySprites();
  registerPickupSprites();
  registerProjectileSprites();
  registerEnemyVarietySprites();
  registerBossSprites();
  registerWeaponSprites();
  registerVfxSprites();
  registerDecorSprites();
}
