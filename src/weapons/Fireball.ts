import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';

const RANGE = 14;
const BASE_COOLDOWN = 1.6;
const BASE_DAMAGE = 16;
const BASE_SPEED = 6;
const SPLASH_FRACTION = 0.6;
const TURN_RATE = 5; // rad/s max steering toward target while in flight

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
  private cooldown = 0;
  /** projectile index -> tracked target enemy index, for in-flight homing. */
  private readonly homing = new Map<number, number>();

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    this.visualId = visuals.get('fireball', 0.65, [1, 1, 1], false);
  }

  private aoeRadius(ctx: WeaponContext): number {
    const base = (2 + 0.1 * (this.level - 1)) * (this.evolved ? 1.5 : 1);
    return base * ctx.stats.areaMultiplier;
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

    this.cooldown = Math.max(0.9, BASE_COOLDOWN - 0.06 * (this.level - 1)) * (this.evolved ? 0.7 : 1) * ctx.stats.cooldownMultiplier;

    const dx = ctx.enemies.posX[target] - ctx.playerX;
    const dz = ctx.enemies.posZ[target] - ctx.playerZ;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const speed = BASE_SPEED * ctx.stats.projectileSpeedMultiplier;

    const index = ctx.projectiles.spawn(this.visualId, ctx.playerX, ctx.playerZ, (dx / dist) * speed, (dz / dist) * speed, {
      damage: (BASE_DAMAGE + 2.4 * (this.level - 1)) * (this.evolved ? 1.3 : 1) * ctx.stats.damageMultiplier,
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
      ctx.enemies.damage(idx, splashDamage, false);
    }
  }

  levelUp(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  evolve(): void {
    this.evolved = true;
  }
}
