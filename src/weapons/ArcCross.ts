import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';

const RANGE = 13; // search radius for a launch target
const MAX_TRAVEL_RANGE = 9; // distance traveled outbound before turning back
const BASE_COOLDOWN = 1.4;
const BASE_DAMAGE = 11;
const BASE_SPEED = 10;
const TOTAL_LIFE = 2.6; // seconds; natural despawn once this elapses
const RETURN_TRIGGER_FRACTION = 0.6; // switch to 'return' once past this fraction of total life
const ORBIT_RADIUS = 1.7;
const ORBIT_ANGULAR_SPEED = 7; // rad/s
const ORBIT_DURATION = 0.5; // seconds spent circling the player before despawning
const TURN_RATE = 6; // rad/s max steering while returning
const EXTRA_PROJECTILE_ANGLE = (12 * Math.PI) / 180; // Amount (Ammo Satchel): extra crosses fan out from the primary launch angle

type Phase = 'out' | 'return' | 'orbit';

interface FlightState {
  phase: Phase;
  spawnTime: number;
  spawnX: number;
  spawnZ: number;
  totalLife: number;
  orbitAngle: number;
  orbitStart: number;
  /** Enemy index locked on at launch, used by the evolved form's outbound homing. */
  targetIndex: number;
}

/**
 * Homing boomerang: launches at the nearest enemy in range, flies straight
 * toward that point, then - once past ~60% of its life or its max travel
 * range - reverses course to steer back toward the player's CURRENT
 * position, briefly orbits near them, then despawns.
 */
export class ArcCrossWeapon implements Weapon {
  readonly id = 'arc_cross';
  readonly name = 'Arc Cross';
  level = 1;
  readonly maxLevel = 8;
  evolved = false;
  /** Evolves into a radiant returning blade once the player also holds Four-Leaf Clover (luck passive). */
  readonly evolutionRequiresPassive = 'passive_luck';

  private readonly visualId: number;
  private cooldown = 0;
  private readonly flight = new Map<number, FlightState>();

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    this.visualId = visuals.get('proj_cross', 0.55, [1, 1, 1], true);
  }

  private pierce(): number {
    const base = 2 + Math.floor((this.level - 1) / 3);
    return this.evolved ? base + 2 : base;
  }

  update(ctx: WeaponContext): void {
    this.stepFlights(ctx);

    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;
    const target = ctx.enemies.queryNearest(ctx.playerX, ctx.playerZ, RANGE);
    if (target === -1) return;

    this.cooldown = Math.max(0.55, BASE_COOLDOWN - 0.05 * (this.level - 1)) * (this.evolved ? 0.8 : 1) * ctx.stats.cooldownMultiplier;

    const dx = ctx.enemies.posX[target] - ctx.playerX;
    const dz = ctx.enemies.posZ[target] - ctx.playerZ;
    const baseAngle = Math.atan2(dz, dx);
    const speed = BASE_SPEED * ctx.stats.projectileSpeedMultiplier;
    const damage = (BASE_DAMAGE + 1.7 * (this.level - 1)) * (this.evolved ? 1.35 : 1) * ctx.stats.damageMultiplier;
    const totalLife = TOTAL_LIFE * ctx.stats.durationMultiplier;

    this.launchCross(ctx, target, baseAngle, speed, damage, totalLife);
    // Amount (Ammo Satchel) is compatible: extra crosses launch fanned around the same target heading, each returning independently.
    const extra = Math.max(0, Math.round(ctx.stats.extraProjectiles));
    for (let i = 0; i < extra; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const step = Math.floor(i / 2) + 1;
      this.launchCross(ctx, target, baseAngle + side * step * EXTRA_PROJECTILE_ANGLE, speed, damage, totalLife);
    }
  }

  private launchCross(ctx: WeaponContext, target: number, angle: number, speed: number, damage: number, totalLife: number): void {
    const index = ctx.projectiles.spawn(this.visualId, ctx.playerX, ctx.playerZ, Math.cos(angle) * speed, Math.sin(angle) * speed, {
      damage,
      radius: 0.42,
      pierce: this.pierce(),
      life: totalLife,
      weaponId: this.weaponNumericId,
    });
    if (index === -1) return;
    this.flight.set(index, {
      phase: 'out',
      spawnTime: ctx.elapsed,
      spawnX: ctx.playerX,
      spawnZ: ctx.playerZ,
      totalLife,
      orbitAngle: 0,
      orbitStart: 0,
      targetIndex: target,
    });
  }

  private stepFlights(ctx: WeaponContext): void {
    const speed = BASE_SPEED * ctx.stats.projectileSpeedMultiplier;
    for (const [index, state] of this.flight) {
      if (!ctx.projectiles.alive[index]) {
        this.flight.delete(index);
        continue;
      }
      const px = ctx.projectiles.posX[index];
      const pz = ctx.projectiles.posZ[index];
      const age = ctx.elapsed - state.spawnTime;

      if (state.phase === 'out') {
        const traveledSq = (px - state.spawnX) ** 2 + (pz - state.spawnZ) ** 2;
        if (age > state.totalLife * RETURN_TRIGGER_FRACTION || traveledSq > MAX_TRAVEL_RANGE * MAX_TRAVEL_RANGE) {
          state.phase = 'return';
        } else if (this.evolved && ctx.enemies.alive[state.targetIndex]) {
          // Evolved cross keeps steering toward its original target on the way out instead of flying a straight line - it never "loses" what it launched at.
          const dx = ctx.enemies.posX[state.targetIndex] - px;
          const dz = ctx.enemies.posZ[state.targetIndex] - pz;
          const dist = Math.sqrt(dx * dx + dz * dz) || 1;
          const desiredVX = (dx / dist) * speed;
          const desiredVZ = (dz / dist) * speed;
          const curVX = ctx.projectiles.velX[index];
          const curVZ = ctx.projectiles.velZ[index];
          const turn = Math.min(1, TURN_RATE * ctx.dt);
          ctx.projectiles.setVelocity(index, curVX + (desiredVX - curVX) * turn, curVZ + (desiredVZ - curVZ) * turn);
        }
      }

      if (state.phase === 'return') {
        const dx = ctx.playerX - px;
        const dz = ctx.playerZ - pz;
        const dist = Math.sqrt(dx * dx + dz * dz) || 1;
        if (dist < ORBIT_RADIUS) {
          state.phase = 'orbit';
          state.orbitAngle = Math.atan2(pz - ctx.playerZ, px - ctx.playerX);
          state.orbitStart = ctx.elapsed;
        } else {
          const desiredVX = (dx / dist) * speed;
          const desiredVZ = (dz / dist) * speed;
          const curVX = ctx.projectiles.velX[index];
          const curVZ = ctx.projectiles.velZ[index];
          const turn = Math.min(1, TURN_RATE * ctx.dt);
          ctx.projectiles.setVelocity(index, curVX + (desiredVX - curVX) * turn, curVZ + (desiredVZ - curVZ) * turn);
        }
      }

      if (state.phase === 'orbit') {
        state.orbitAngle += ctx.dt * ORBIT_ANGULAR_SPEED;
        const x = ctx.playerX + Math.cos(state.orbitAngle) * ORBIT_RADIUS;
        const z = ctx.playerZ + Math.sin(state.orbitAngle) * ORBIT_RADIUS;
        ctx.projectiles.setPosition(index, x, z);
        ctx.projectiles.setVelocity(index, -Math.sin(state.orbitAngle) * ORBIT_ANGULAR_SPEED * ORBIT_RADIUS, Math.cos(state.orbitAngle) * ORBIT_ANGULAR_SPEED * ORBIT_RADIUS);
        if (ctx.elapsed - state.orbitStart > ORBIT_DURATION) {
          ctx.projectiles.despawn(index);
          this.flight.delete(index);
        }
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
