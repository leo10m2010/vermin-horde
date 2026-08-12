import { spriteAtlas } from './SpriteAtlas';
import { drawSoftCircle } from './PixelDraw';

// ---------------------------------------------------------------------------
// Shared ground/impact FX decals. The weapon projectile sprites that used to
// live here were re-authored in SpriteLibraryPowerArt.ts during the power art
// pass; what remains is the persistent hex zone decal, the impact bursts and
// the trail dot, all consumed by the vfx layer.
// ---------------------------------------------------------------------------

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
/**
 * whip_slash / proj_cross / proj_ember / proj_rune / proj_hexflask moved to
 * SpriteLibraryPowerArt.ts in the power art pass - they are re-authored there
 * with outlines, shading and real animation. Only the zone decal, the impact
 * bursts and the trail dot still live here.
 */
export function registerWeapon2Sprites(): void {
  registerHexZone();
  registerImpactSprites();
}
