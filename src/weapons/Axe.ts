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

/**
 * How far up-screen the throw carries, in world -Z. This is the REAL
 * trajectory: world -Z projects onto screen-up at 0.848 with our 58-degree
 * camera, so moving in Z is what the eye reads as rising and falling.
 */
const UP_DISTANCE = 7.2;
/**
 * How far past the launch point the axe ends up in +Z (down-screen) once it
 * has fallen. Guarantees the second half of the flight descends well below
 * the apex rather than merely returning to the start line.
 */
const DOWN_FOLLOW_THROUGH = 3.4;
/** Sideways drift per fan step, in world units/second. Spreads multiple axes without changing their shared Z parabola. */
const LATERAL_SPEED = 3.1;
/**
 * Peak height of the toss. Comfortably above the 1.5-unit-tall character, so
 * the apex is unmistakably "up in the air" rather than a slight bob.
 */
/**
 * Small extra lift in world Y. Purely a 2.5D garnish now - it separates the
 * axe from its ground shadow and adds a little aerial depth. It is NOT the
 * trajectory: the visible arc comes from Z above. It used to be 2.7, which
 * was an attempt to fake the whole arc in an axis the camera barely uses.
 */
const ARC_HEIGHT = 0.45;
/** Base flight time. The parabola now spans the WHOLE of this, so the axe
 * lands exactly as it expires - see stepArcs(). */
const AXE_LIFE = 1.6;

interface ArcState {
  spawnedAt: number;
  shadowIndex: number;
  /** This throw's total flight time; the parabola is normalised across it. */
  life: number;
  /** Launch point - the parabola is evaluated as an offset from here. */
  startX: number;
  startZ: number;
  /** Constant sideways drift (world units/sec) that spreads the fan. */
  lateralVX: number;
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
    const pierce = e.pierce ?? 2;
    const radius = (e.radius ?? 0.5) * ctx.stats.areaMultiplier;
    const life = AXE_LIFE * ctx.stats.durationMultiplier;

    // Symmetric fan. Every axe shares the SAME up-and-down Z parabola; the
    // spread comes from a constant sideways drift, so extra axes fan out
    // without any of them flying off forever on their own heading.
    //   1 axe  -> straight up and back down
    //   2 axes -> mirrored pair
    //   3 axes -> centre plus a mirrored pair
    const count = this.axeCount();
    const mid = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      this.throwAxe(ctx, (i - mid) * LATERAL_SPEED, damage, pierce, life, radius);
    }

    // Amount stacks widen the fan further, still symmetric.
    const extra = Math.max(0, Math.round(ctx.stats.extraProjectiles));
    for (let i = 0; i < extra; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const step = Math.floor(i / 2) + 1;
      this.throwAxe(ctx, side * (mid + step) * LATERAL_SPEED, damage, pierce, life, radius);
    }
  }

  private throwAxe(ctx: WeaponContext, lateralVX: number, damage: number, pierce: number, life: number, radius: number): void {
    // Spawned with ZERO velocity on purpose. ProjectileManager's generic
    // `pos += vel * dt` integration is what produced the old behaviour: a
    // constant -Z velocity that projects to a permanent upward screen drift,
    // which no amount of world-Y bobbing could ever overcome. This weapon
    // drives its own position every frame instead (see stepArcs).
    const index = ctx.projectiles.spawn(this.evolved ? this.evolvedVisualId : this.visualId, ctx.playerX, ctx.playerZ, 0, 0, {
      damage,
      radius,
      pierce,
      life,
      weaponId: this.weaponNumericId,
    });
    if (index === -1) return;
    const shadowIndex = ctx.projectiles.spawn(this.shadowVisualId, ctx.playerX, ctx.playerZ, 0, 0, {
      damage: 0,
      radius: 0,
      pierce: 0,
      life,
      weaponId: -1, // never hit-tested
    });
    this.arcs.set(index, {
      spawnedAt: ctx.elapsed,
      shadowIndex,
      life,
      startX: ctx.playerX,
      startZ: ctx.playerZ,
      lateralVX,
    });
  }

  /**
   * Drives every in-flight axe's REAL position each frame.
   *
   * The arc lives in world Z, not world Y. With the camera at 58 degrees the
   * screen-up basis vector is (0, 0.530, -0.848): world -Z pushes a sprite up
   * the screen roughly 1.6x more strongly than world +Y does. The previous
   * version launched with a constant velZ = -9 and tried to fake the arc with
   * a sin() bump in Y, which could never win - -Z alone climbed the screen at
   * ~7.63 units/s while the steepest Y descent gave back only ~2.81, so the
   * axe was still rising at ~4.8 units/s during its supposed fall. It read as
   * a hammer thrown into the sky and never coming back, because that is
   * literally what it was doing.
   *
   * Now Z carries the parabola and therefore genuinely REVERSES:
   *   u < 0.5  -> Z decreasing -> rising on screen
   *   u = 0.5  -> dZ/du = 0    -> apex
   *   u > 0.5  -> Z increasing -> falling on screen
   * and the follow-through term leaves it below the launch line at landing.
   *
   * `setPosition` writes the same coordinates the hit resolver reads, so
   * enemies are damaged exactly where the axe is drawn.
   */
  private stepArcs(ctx: WeaponContext): void {
    for (const [index, state] of this.arcs) {
      if (!ctx.projectiles.alive[index]) {
        if (state.shadowIndex !== -1) ctx.projectiles.despawn(state.shadowIndex);
        this.arcs.delete(index);
        continue;
      }
      const age = ctx.elapsed - state.spawnedAt;
      const u = Math.min(1, age / state.life);

      // 4u(1-u) peaks at 1.0 when u = 0.5, so this term rises to -UP_DISTANCE
      // and returns; the linear term carries the axe past its launch line on
      // the way down.
      const zOffset = -UP_DISTANCE * 4 * u * (1 - u) + DOWN_FOLLOW_THROUGH * u;
      const x = state.startX + state.lateralVX * age;
      const z = state.startZ + zOffset;
      ctx.projectiles.setPosition(index, x, z);

      // Small aerial lift, purely to separate the axe from its shadow.
      const height = Math.sin(u * Math.PI) * ARC_HEIGHT;
      ctx.projectiles.setHeightOffset(index, height);
      // Constant size: the camera is orthographic, so a thrown object does not
      // grow as it gains altitude. Scaling it up at the apex was part of what
      // sold the wrong "flying toward the camera" read.
      ctx.projectiles.setSize(index, this.evolved ? 1.15 : 0.95);
      // Spin eases off near the apex and picks back up on the way down.
      ctx.projectiles.setSpinRate(index, 9 + (1 - Math.sin(u * Math.PI)) * 7);

      if (state.shadowIndex !== -1 && ctx.projectiles.alive[state.shadowIndex]) {
        // Shadow tracks the axe's ground point for the whole flight. It does
        // not define the arc - the arc must read without it (see QA).
        ctx.projectiles.setPosition(state.shadowIndex, x, z);
        const lift = height / ARC_HEIGHT;
        ctx.projectiles.setSize(state.shadowIndex, 0.42 * (1 + lift * 0.4));
        ctx.projectiles.setAlpha(state.shadowIndex, 0.6 * (1 - lift * 0.45));
      }

      if (u >= 1) {
        // LANDING: the throw has resolved.
        gameEvents.emit('weaponImpact', { x, z, weaponId: this.id });
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
