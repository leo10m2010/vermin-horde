import { spriteAtlas } from './SpriteAtlas';
import { drawPixelGrid, drawSoftCircle, makeGrid, fillRect, toRows } from './PixelDraw';

// ---------------------------------------------------------------------------
// Weapon sprites for the second wave of weapons (whip_strike, arc_cross,
// ember_wand, rune_shard, hex_flask). Kept in its own module so registration
// here can never collide with SpriteLibrary.ts's cell keys/clip names.
// ---------------------------------------------------------------------------

/** Bright cyan-white slash arc, drawn once per swing at the player. */
function registerWhipSlash(): void {
  const a = makeGrid(14, 6);
  fillRect(a, 1, 2, 12, 3, 'c');
  fillRect(a, 3, 1, 10, 1, 'w');
  fillRect(a, 3, 4, 10, 4, 'w');
  fillRect(a, 0, 2, 1, 3, 'w');
  fillRect(a, 12, 2, 13, 3, 'w');
  const b = makeGrid(14, 6);
  fillRect(b, 2, 2, 11, 3, 'c');
  fillRect(b, 4, 1, 9, 1, 'w');
  fillRect(b, 4, 4, 9, 4, 'w');
  const palette = { c: '#eafcff', w: '#8fe9ff' };
  spriteAtlas.registerClip('whip_slash', 14, false, [
    { key: 'whip_slash_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), palette) },
    { key: 'whip_slash_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), palette) },
  ]);
}

/** Small ornate cross/boomerang - gold cross-bar over a violet core, core pulses across 2 frames for a "charged" glow. */
function registerCross(): void {
  const a = makeGrid(10, 10);
  fillRect(a, 4, 0, 5, 9, 'g');
  fillRect(a, 0, 4, 9, 5, 'g');
  fillRect(a, 3, 3, 6, 6, 'v');
  const b = makeGrid(10, 10);
  fillRect(b, 4, 0, 5, 9, 'g');
  fillRect(b, 0, 4, 9, 5, 'g');
  fillRect(b, 2, 2, 7, 7, 'v');
  fillRect(b, 4, 4, 5, 5, 'w');
  const palette = { g: '#ffd35c', v: '#8a4fe6', w: '#e0c8ff' };
  spriteAtlas.registerClip('proj_cross', 6, true, [
    { key: 'proj_cross_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), palette) },
    { key: 'proj_cross_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), palette) },
  ]);
}

/** Glowing ember - warm orange core with a hotter yellow center, smaller/denser than the fireball. */
function registerEmber(): void {
  spriteAtlas.registerClip('proj_ember', 6, true, [
    {
      key: 'proj_ember_0',
      draw: (ctx, size) => {
        drawSoftCircle(ctx, size / 2, size / 2, size * 0.4, '#ff3d1f', 0.9);
        drawSoftCircle(ctx, size / 2, size / 2, size * 0.2, '#ffcf4d', 1);
      },
    },
    {
      key: 'proj_ember_1',
      draw: (ctx, size) => {
        drawSoftCircle(ctx, size / 2, size / 2, size * 0.44, '#ff5a2e', 0.85);
        drawSoftCircle(ctx, size / 2, size / 2, size * 0.24, '#ffe08a', 1);
      },
    },
  ]);
}

/** Tiny bright rune shard - thin diamond sliver, pale blue/white so it reads while wandering fast; a 2-frame glint shimmers on top of the spins:true mirror-flicker. */
function registerRune(): void {
  const a = makeGrid(6, 10);
  fillRect(a, 2, 0, 3, 1, 't');
  fillRect(a, 1, 1, 4, 3, 'c');
  fillRect(a, 0, 3, 5, 5, 'c');
  fillRect(a, 1, 5, 4, 7, 'c');
  fillRect(a, 2, 7, 3, 9, 't');
  const b = makeGrid(6, 10);
  fillRect(b, 2, 0, 3, 1, 't');
  fillRect(b, 1, 1, 4, 3, 'c');
  fillRect(b, 0, 3, 5, 5, 't');
  fillRect(b, 1, 5, 4, 7, 'c');
  fillRect(b, 2, 7, 3, 9, 't');
  const palette = { t: '#eafcff', c: '#7fd3ff' };
  spriteAtlas.registerClip('proj_rune', 11, true, [
    { key: 'proj_rune_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), palette) },
    { key: 'proj_rune_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), palette) },
  ]);
}

/** Small glass flask tumbling toward its landing spot - green liquid, cork top. */
function registerHexFlask(): void {
  const a = makeGrid(8, 10);
  fillRect(a, 3, 0, 4, 1, 'k');
  fillRect(a, 2, 2, 5, 3, 'g');
  fillRect(a, 1, 4, 6, 8, 'g');
  fillRect(a, 2, 5, 5, 7, 'l');
  const b = makeGrid(8, 10);
  fillRect(b, 2, 0, 3, 1, 'k');
  fillRect(b, 1, 2, 4, 3, 'g');
  fillRect(b, 0, 4, 5, 8, 'g');
  fillRect(b, 1, 5, 4, 7, 'l');
  const palette = { k: '#6b4a2a', g: '#3a5a2a', l: '#8ee65c' };
  spriteAtlas.registerClip('proj_hexflask', 8, true, [
    { key: 'proj_hexflask_0', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(a), palette) },
    { key: 'proj_hexflask_1', draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(b), palette) },
  ]);
}

/** Lingering toxic-green ground zone - soft pulsing circle with a bubbling rim, similar treatment to aoe_ring_holy. */
function registerHexZone(): void {
  spriteAtlas.registerClip('zone_hex', 3, true, [
    {
      key: 'zone_hex_0',
      draw: (ctx, size) => {
        drawSoftCircle(ctx, size / 2, size / 2, size * 0.46, '#5cff8a', 0.28);
        ctx.save();
        ctx.translate(size / 2, size / 2);
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = '#8ee65c';
        ctx.lineWidth = size * 0.05;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      },
    },
    {
      key: 'zone_hex_1',
      draw: (ctx, size) => {
        drawSoftCircle(ctx, size / 2, size / 2, size * 0.5, '#3ae06e', 0.22);
        ctx.save();
        ctx.translate(size / 2, size / 2);
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#c8ffb0';
        ctx.lineWidth = size * 0.04;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.44, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      },
    },
  ]);
}

/**
 * Sharp radiating-line impact flash - a quick "hit spark" silhouette distinct
 * from ParticleSystem's scatter-spark burst (vfx_hit_burst/vfx_spark) so the
 * two read as complementary layers instead of duplicating each other.
 * `rayColor` fans out from the center, `coreColor` is the bright center dot.
 */
function registerImpactBurst(clipName: string, coreColor: string, rayColor: string): void {
  spriteAtlas.registerClip(clipName, 1, false, [
    {
      key: `${clipName}_0`,
      draw: (ctx, size) => {
        const cx = size / 2;
        const cy = size / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = rayColor;
        ctx.lineWidth = size * 0.07;
        ctx.lineCap = 'round';
        const rays = 7;
        for (let i = 0; i < rays; i++) {
          const a = (i / rays) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * size * 0.12, Math.sin(a) * size * 0.12);
          ctx.lineTo(Math.cos(a) * size * 0.42, Math.sin(a) * size * 0.42);
          ctx.stroke();
        }
        ctx.restore();
        drawSoftCircle(ctx, cx, cy, size * 0.18, coreColor, 1);
      },
    },
  ]);
}

/** Small soft dot used to build fading motion-trail streaks behind fast projectiles; tinted per-weapon at spawn time. */
function registerTrailDot(): void {
  spriteAtlas.registerClip('fx_trail_dot', 1, false, [
    {
      key: 'fx_trail_dot_0',
      draw: (ctx, size) => drawSoftCircle(ctx, size / 2, size / 2, size * 0.34, '#ffffff', 1),
    },
  ]);
}

/** Registers the small hit-flash/trail building-block sprites shared by ProjectileTrails.ts (and available to any weapon file that wants a bespoke impact flourish). */
function registerImpactSprites(): void {
  registerImpactBurst('fx_impact_generic', '#fff6d8', '#ffffff');
  registerImpactBurst('fx_impact_fire', '#ffe08a', '#ff5a1f');
  registerImpactBurst('fx_impact_arcane', '#eafcff', '#8a4fe6');
  registerTrailDot();
}

/** Registers every projectile/effect sprite used by the second-wave weapons (whip, cross, ember, rune, hex flask + its zone) plus the shared impact/trail building blocks. */
export function registerWeapon2Sprites(): void {
  registerWhipSlash();
  registerCross();
  registerEmber();
  registerRune();
  registerHexFlask();
  registerHexZone();
  registerImpactSprites();
}
