import { gameEvents } from '../core/EventBus';
import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';
import { effectAt } from './WeaponProgression';

/**
 * AXE - FIXED ARC.
 *
 * Every axe is tossed toward a CONSTANT base direction: the top of the screen
 * (world -Z; CameraRig sits at +Z looking toward -Z). Player movement never
 * reaches this weapon's targeting - there is no facing, no velocity read, no
 * sweep, no golden-angle spread, no random fallback. Walking in any of the
 * eight directions leaves the throw exactly where it is.
 *
 * Amount IS the progression here. Extra axes open out SYMMETRICALLY around
 * the base angle, so the fan stays centred on "up":
 *
 *   Lv1        Lv2          Lv5
 *    A        A   A      A   A   A
 *    |         \ /         \ | /
 *    P          P            P
 *
 * The toss is rendered as a real 2.5D throw - rise, apex, fall - with the axe
 * spinning through flight and a ground shadow that tightens and darkens as it
 * comes down, so it reads as an object thrown through the air rather than a
 * flat sprite carrying a Y offset.
 */

const BASE_SPEED = 9;
/** Angular gap between adjacent axes in the symmetric fan. */
const FAN_STEP = (19 * Math.PI) / 180;
/** Extra axes granted by the Amount passive fan out beyond the level fan. */
const EXTRA_PROJECTILE_ANGLE = (13 * Math.PI) / 180;
/**
 * Peak height of the toss. Comfortably above the 1.5-unit-tall character, so
 * the apex is unmistakably "up in the air" rather than a slight bob.
 */
const ARC_HEIGHT = 2.7;
/** Base flight time. The parabola now spans the WHOLE of this, so the axe
 * lands exactly as it expires - see stepArcs(). */
const AXE_LIFE = 1.6;
/** Fixed base direction: straight up the screen. A constant, never reassigned. */
const BASE_ANGLE = -Math.PI / 2;

interface ArcState {
  spawnedAt: number;
  shadowIndex: number;
  /** This throw's total flight time; the parabola is normalised across it. */
  life: number;
}

export class AxeWeapon implements Weapon {
  readonly id = 'axe_throw';
  readonly name = 'Axe';
  level = 1;
  readonly maxLevel = 8;
  evolved = false;
  readonly evolutionRequiresPassive = 'passive_area';

  private readonly visualId: number;
  /** Evolved Whirlwind Axe: gold-hot steel. */
  private readonly evolvedVisualId: number;
  private readonly shadowVisualId: number;
  private cooldown = 0;
  private readonly arcs = new Map<number, ArcState>();

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    this.visualId = visuals.get('proj_axe', 0.95, [1, 1, 1], true);
    this.evolvedVisualId = visuals.get('proj_axe_evo', 1.15, [1, 1, 1], true);
    // Flat dark blob that stays on the ground under the axe for the whole toss.
    this.shadowVisualId = visuals.get('fx_toss_shadow', 0.5, [1, 1, 1], false);
  }

  /** Axes thrown per cast at this level, before the Amount passive. */
  axeCount(): number {
    return effectAt(this.id, this.level, this.evolved).projectiles ?? 1;
  }

  update(ctx: WeaponContext): void {
    this.stepArcs(ctx);

    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;

    const e = effectAt(this.id, this.level, this.evolved);
    this.cooldown = e.cooldown * ctx.stats.cooldownMultiplier;

    const damage = e.damage * ctx.stats.damageMultiplier;
    const speed = BASE_SPEED * (this.evolved ? 1.25 : 1) * ctx.stats.projectileSpeedMultiplier;
    const pierce = e.pierce ?? 2;
    const radius = (e.radius ?? 0.5) * ctx.stats.areaMultiplier;
    const life = AXE_LIFE * ctx.stats.durationMultiplier;

    // Symmetric fan centred on the fixed base angle: 1 axe -> straight up,
    // 2 -> mirrored pair, 3 -> centre plus a mirrored pair, and so on.
    const count = this.axeCount();
    const mid = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      this.throwAxe(ctx, BASE_ANGLE + (i - mid) * FAN_STEP, damage, speed, pierce, life, radius);
    }

    // Amount stacks widen the fan further, still symmetric about "up".
    const extra = Math.max(0, Math.round(ctx.stats.extraProjectiles));
    for (let i = 0; i < extra; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const step = Math.floor(i / 2) + 1;
      const outer = (count - 1) / 2 + step;
      this.throwAxe(ctx, BASE_ANGLE + side * outer * EXTRA_PROJECTILE_ANGLE, damage, speed, pierce, life, radius);
    }
  }

  private throwAxe(ctx: WeaponContext, angle: number, damage: number, speed: number, pierce: number, life: number, radius: number): void {
    const index = ctx.projectiles.spawn(this.evolved ? this.evolvedVisualId : this.visualId, ctx.playerX, ctx.playerZ, Math.cos(angle) * speed, Math.sin(angle) * speed, {
      damage,
      radius,
      pierce,
      life,
      weaponId: this.weaponNumericId,
    });
    if (index === -1) return;
    // Companion ground-shadow instance, driven by stepArcs alongside the axe.
    const shadowIndex = ctx.projectiles.spawn(this.shadowVisualId, ctx.playerX, ctx.playerZ, 0, 0, {
      damage: 0,
      radius: 0,
      pierce: 0,
      life,
      weaponId: -1, // never hit-tested
    });
    this.arcs.set(index, { spawnedAt: ctx.elapsed, shadowIndex, life });
  }

  /**
   * Visual-only 2.5D toss. Collisions stay flat on X/Z; this drives the
   * rendered height, the spin, and the ground shadow.
   *
   * The parabola spans the axe's ENTIRE flight, so the throw resolves: it
   * rises, peaks, falls, and hits the ground exactly as the projectile
   * expires, where it kicks up a small impact. Previously the arc ran for a
   * fixed 0.62s out of a 1.6s life - the axe finished its hop in the first
   * third of the flight, the shadow was deleted, and it spent the remaining
   * ~9 of its ~14 world units sliding along flat with nothing under it. That
   * unexplained flat tail is what stopped it reading as a thrown object.
   */
  private stepArcs(ctx: WeaponContext): void {
    for (const [index, state] of this.arcs) {
      if (!ctx.projectiles.alive[index]) {
        if (state.shadowIndex !== -1) ctx.projectiles.despawn(state.shadowIndex);
        this.arcs.delete(index);
        continue;
      }
      const t = Math.min(1, (ctx.elapsed - state.spawnedAt) / state.life);
      const height = Math.sin(t * Math.PI) * ARC_HEIGHT;
      ctx.projectiles.setHeightOffset(index, height);
      // Reads bigger near the apex (closer to the camera) and settles back
      // down as it falls - a cheap but effective depth cue.
      ctx.projectiles.setSize(index, (this.evolved ? 1.15 : 0.95) * (1 + height * 0.14));
      // Spin slows as it climbs and picks back up on the way down, the way a
      // real thrown axe does as it trades rotation for height.
      ctx.projectiles.setSpinRate(index, 9 + (1 - Math.sin(t * Math.PI)) * 7);

      if (state.shadowIndex !== -1 && ctx.projectiles.alive[state.shadowIndex]) {
        // Shadow stays for the WHOLE flight, tracking the axe's ground point:
        // tight and dark at launch and landing, wide and faint at the apex.
        ctx.projectiles.setPosition(state.shadowIndex, ctx.projectiles.posX[index], ctx.projectiles.posZ[index]);
        const lift = height / ARC_HEIGHT; // 0 on the ground, 1 at the apex
        ctx.projectiles.setSize(state.shadowIndex, 0.42 * (1 + lift * 0.55));
        ctx.projectiles.setAlpha(state.shadowIndex, 0.6 * (1 - lift * 0.62));
      }

      if (t >= 1) {
        // LANDING: the throw has resolved. Puff of dust at the impact point,
        // then both the axe and its shadow are done.
        gameEvents.emit('weaponImpact', {
          x: ctx.projectiles.posX[index],
          z: ctx.projectiles.posZ[index],
          weaponId: this.id,
        });
        if (state.shadowIndex !== -1) ctx.projectiles.despawn(state.shadowIndex);
        ctx.projectiles.despawn(index);
        this.arcs.delete(index);
      }
    }
  }

  levelUp(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  evolve(): void {
    this.evolved = true;
  }
}
