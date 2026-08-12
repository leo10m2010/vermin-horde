import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';
import { effectAt } from './WeaponProgression';

const RANGE = 14;
const BASE_SPEED = 6;
const SPLASH_FRACTION = 0.6;
const TURN_RATE = 5; // rad/s max steering toward target while in flight
const EVOLVED_LIFESTEAL_FRACTION = 0.06; // evolved-only: fraction of direct-hit damage returned as player healing

/** Slow, gently-homing projectile that explodes for AoE splash damage on impact. */
export class FireballWeapon implements Weapon {
  readonly id = 'fireball';
  readonly name = 'Fireball';
  level = 1;
  readonly maxLevel = 8;
  evolved = false;
  /** Evolves into a devastating inferno once the player also holds Power Charm (damage passive). */
  readonly evolutionRequiresPassive = 'passive_damage';

  private readonly visualId: number;
  /** Evolved Inferno Core: blue-white heat instead of orange flame. */
  private readonly evolvedVisualId: number;
  private cooldown = 0;
  /** projectile index -> tracked target enemy index, for in-flight homing. */
  private readonly homing = new Map<number, number>();

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    this.visualId = visuals.get('fireball', 0.8, [1, 1, 1], false);
    this.evolvedVisualId = visuals.get('fireball_evo', 1.05, [1, 1, 1], false);
  }

  /** Explosion radius. Public so the showcase/tests can compare it against the drawn blast. */
  aoeRadius(ctx: WeaponContext): number {
    return (effectAt(this.id, this.level, this.evolved).radius ?? 2) * ctx.stats.areaMultiplier;
  }

  update(ctx: WeaponContext): void {
    // Steer already-flying fireballs toward their tracked target each frame.
    for (const [projIndex, targetIndex] of this.homing) {
      if (!ctx.projectiles.alive[projIndex] || !ctx.enemies.alive[targetIndex]) {
        this.homing.delete(projIndex);
        continue;
      }
      const px = ctx.projectiles.posX[projIndex];
      const pz = ctx.projectiles.posZ[projIndex];
      const dx = ctx.enemies.posX[targetIndex] - px;
      const dz = ctx.enemies.posZ[targetIndex] - pz;
      const dist = Math.sqrt(dx * dx + dz * dz) || 1;
      const desiredVX = (dx / dist) * BASE_SPEED * ctx.stats.projectileSpeedMultiplier;
      const desiredVZ = (dz / dist) * BASE_SPEED * ctx.stats.projectileSpeedMultiplier;
      const curVX = ctx.projectiles.velX[projIndex];
      const curVZ = ctx.projectiles.velZ[projIndex];
      const turn = Math.min(1, TURN_RATE * ctx.dt);
      ctx.projectiles.setVelocity(projIndex, curVX + (desiredVX - curVX) * turn, curVZ + (desiredVZ - curVZ) * turn);
    }

    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;
    const target = ctx.enemies.queryNearest(ctx.playerX, ctx.playerZ, RANGE);
    if (target === -1) return;

    this.cooldown = effectAt(this.id, this.level, this.evolved).cooldown * ctx.stats.cooldownMultiplier;

    const dx = ctx.enemies.posX[target] - ctx.playerX;
    const dz = ctx.enemies.posZ[target] - ctx.playerZ;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const speed = BASE_SPEED * ctx.stats.projectileSpeedMultiplier;

    const index = ctx.projectiles.spawn(this.evolved ? this.evolvedVisualId : this.visualId, ctx.playerX, ctx.playerZ, (dx / dist) * speed, (dz / dist) * speed, {
      damage: effectAt(this.id, this.level, this.evolved).damage * ctx.stats.damageMultiplier,
      radius: 0.5,
      pierce: 0,
      life: 3,
      weaponId: this.weaponNumericId,
    });
    if (index !== -1) this.homing.set(index, target);
  }

  onProjectileHit(ctx: WeaponContext, hitX: number, hitZ: number, directDamage: number, hitEnemyIndex: number): void {
    const radius = this.aoeRadius(ctx);
    const buffer: number[] = [];
    const count = ctx.enemies.queryRadius(hitX, hitZ, radius, buffer);
    const splashDamage = directDamage * SPLASH_FRACTION;
    for (let i = 0; i < count; i++) {
      const idx = buffer[i];
      if (idx === hitEnemyIndex) continue; // avoid double-dipping the primary target
      ctx.enemies.damage(idx, splashDamage, false, this.id);
    }
    if (this.evolved) {
      // Evolved inferno sears a little life back into the caster on every direct hit.
      ctx.stats.health = Math.min(ctx.stats.maxHealth, ctx.stats.health + directDamage * EVOLVED_LIFESTEAL_FRACTION);
    }
  }

  levelUp(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  evolve(): void {
    this.evolved = true;
  }
}
