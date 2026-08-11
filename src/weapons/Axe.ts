import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';

const BASE_COOLDOWN = 1.1;
const BASE_DAMAGE = 14;
const BASE_SPEED = 9;

/** Thrown in the player's current facing/movement direction (random if idle); pierces multiple enemies. */
export class AxeWeapon implements Weapon {
  readonly id = 'axe_throw';
  readonly name = 'Axe';
  level = 1;
  readonly maxLevel = 8;
  evolved = false;
  /** Evolves into a wider whirling form once the player also holds Wide Reach (area passive). */
  readonly evolutionRequiresPassive = 'passive_area';

  private readonly visualId: number;
  private cooldown = 0;
  private lastFacingAngle = 0;

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    this.visualId = visuals.get('proj_axe', 0.6, [1, 1, 1], true);
  }

  private pierce(): number {
    const base = 2 + Math.floor((this.level - 1) / 3);
    return this.evolved ? base + 2 : base;
  }

  update(ctx: WeaponContext): void {
    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;
    this.cooldown = Math.max(0.4, BASE_COOLDOWN - 0.05 * (this.level - 1)) * (this.evolved ? 0.75 : 1) * ctx.stats.cooldownMultiplier;

    const moveSpeedSq = ctx.playerVX * ctx.playerVX + ctx.playerVZ * ctx.playerVZ;
    let angle: number;
    if (moveSpeedSq > 0.01) {
      angle = Math.atan2(ctx.playerVZ, ctx.playerVX);
      this.lastFacingAngle = angle;
    } else if (ctx.rng() < 0.5) {
      angle = this.lastFacingAngle;
    } else {
      angle = ctx.rng() * Math.PI * 2;
      this.lastFacingAngle = angle;
    }

    const damage = (BASE_DAMAGE + 2.2 * (this.level - 1)) * (this.evolved ? 1.3 : 1) * ctx.stats.damageMultiplier;
    const speed = BASE_SPEED * (this.evolved ? 1.25 : 1) * ctx.stats.projectileSpeedMultiplier;
    ctx.projectiles.spawn(this.visualId, ctx.playerX, ctx.playerZ, Math.cos(angle) * speed, Math.sin(angle) * speed, {
      damage,
      radius: 0.5,
      pierce: this.pierce(),
      life: 1.6 * ctx.stats.durationMultiplier,
      weaponId: this.weaponNumericId,
    });
  }

  levelUp(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  evolve(): void {
    this.evolved = true;
  }
}
