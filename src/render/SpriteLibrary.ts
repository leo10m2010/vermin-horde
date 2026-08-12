import { spriteAtlas } from './SpriteAtlas';
import { drawPixelGrid, drawSoftCircle, makeGrid, fillRect, toRows } from './PixelDraw';
import { registerEnemyRosterSprites } from './SpriteLibraryEnemyArt';
import { registerBossRosterSprites } from './SpriteLibraryBossArt';
import { registerPowerSprites } from './SpriteLibraryPowerArt';

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
// Shared AoE ring decal. The weapon projectile sprites (axe, knife, fireball,
// orbiter blade) that used to live here were re-authored with outlines,
// shading and animation in SpriteLibraryPowerArt.ts during the power art pass.
// ---------------------------------------------------------------------------
export function registerWeaponSprites(): void {
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
  registerPickupSprites();
  registerProjectileSprites();
  // Enemy/boss art lives in its own modules (SpriteLibraryEnemyArt.ts /
  // SpriteLibraryBossArt.ts) rather than inline here, mirroring how the
  // playable roster already lives in SpriteLibraryCharacters.ts - each
  // creature there ships a full idle/walk/attack/hit/special/death pose set
  // instead of the single flat walk cycle this file used to hold.
  registerEnemyRosterSprites();
  registerBossRosterSprites();
  registerPowerSprites();
  registerWeaponSprites();
  registerVfxSprites();
  registerDecorSprites();
}
