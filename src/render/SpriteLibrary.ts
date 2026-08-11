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

function slimeGrid(squash: boolean): string[][] {
  const g = makeGrid(16, 12);
  if (!squash) {
    fillRect(g, 5, 2, 10, 3, 'g');
    fillRect(g, 3, 4, 12, 7, 'g');
    fillRect(g, 2, 8, 13, 9, 'g');
    fillRect(g, 4, 10, 11, 10, 'g');
    fillRect(g, 5, 3, 7, 4, 'h');
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
  const a = slimeGrid(false);
  const b = slimeGrid(true);
  spriteAtlas.registerClip('enemy_slime_walk', 4, true, [
    { key: 'slime_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), SLIME_PALETTE) },
    { key: 'slime_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), SLIME_PALETTE) },
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
  const a = ghostGrid(0);
  const b = ghostGrid(1);
  spriteAtlas.registerClip('enemy_ghost_walk', 3, true, [
    { key: 'ghost_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), GHOST_PALETTE) },
    { key: 'ghost_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), GHOST_PALETTE) },
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
  const a = bigBruteGrid(1);
  const b = bigBruteGrid(-1);
  spriteAtlas.registerClip('enemy_brute_walk', 5, true, [
    { key: 'bigbrute_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), BIG_BRUTE_PALETTE) },
    { key: 'bigbrute_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), BIG_BRUTE_PALETTE) },
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

export function registerEnemyVarietySprites(): void {
  registerBatSprites();
  registerSkeletonSprites();
  registerSlimeSprites();
  registerWolfSprites();
  registerGhostSprites();
  registerBruteSprites();
  registerSpitterSprites();
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
  const a = bonecolossusGrid(1);
  const b = bonecolossusGrid(-1);
  spriteAtlas.registerClip('boss_bonecolossus_walk', 3, true, [
    { key: 'bonecolossus_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), BONECOLOSSUS_PALETTE) },
    { key: 'bonecolossus_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), BONECOLOSSUS_PALETTE) },
  ]);
}

export function registerBossSprites(): void {
  registerRotKingSprites();
  registerBoneColossusSprites();
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

  // translucent gold/white ring/halo
  spriteAtlas.registerClip('aoe_ring_holy', 3, true, [
    {
      key: 'aoe_ring_holy_0',
      draw: (ctx, size) => {
        ctx.save();
        ctx.translate(size / 2, size / 2);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#ffe9a8';
        ctx.lineWidth = size * 0.12;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.36, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = '#fff6d8';
        ctx.lineWidth = size * 0.04;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.36, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      },
    },
    {
      key: 'aoe_ring_holy_1',
      draw: (ctx, size) => {
        ctx.save();
        ctx.translate(size / 2, size / 2);
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#ffe9a8';
        ctx.lineWidth = size * 0.15;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = '#fff6d8';
        ctx.lineWidth = size * 0.04;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      },
    },
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

export function registerCoreSprites(): void {
  registerPlayerSprites();
  registerBasicEnemySprites();
  registerPickupSprites();
  registerProjectileSprites();
  registerEnemyVarietySprites();
  registerBossSprites();
  registerWeaponSprites();
  registerVfxSprites();
}
