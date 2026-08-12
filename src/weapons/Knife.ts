import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';

const RANGE = 12;
const BASE_COOLDOWN = 0.4;
const BASE_DAMAGE = 4;
const BASE_SPEED = 14;
const SPREAD_STEP = (8 * Math.PI) / 180; // 8deg between adjacent knives
const EVOLVED_SPREAD_STEP = (22 * Math.PI) / 180; // evolved-only: wide fan instead of a narrow forward cone

/** Fast, low-damage, multi-shot: fires `2 + own-level-bonus + stats.extraProjectiles` in a narrow forward spread. */
export class KnifeWeapon implements Weapon {
  readonly id = 'knife_throw';
  readonly name = 'Knife';
  level = 1;
  readonly maxLevel = 8;
  evolved = false;
  /** Evolves into a screen-wide barrage once the player also holds Windforce (projectile speed passive). */
  readonly evolutionRequiresPassive = 'passive_proj_speed';

  private readonly visualId: number;
  private cooldown = 0;

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    // Thrown dagger reads better tumbling in flight (VS-style kunai) than static-facing.
    this.visualId = visuals.get('proj_knife', 0.4, [1, 1, 1], true);
  }

  update(ctx: WeaponContext): void {
    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;

    const target = ctx.enemies.queryNearest(ctx.playerX, ctx.playerZ, RANGE);
    if (target === -1) return;

    this.cooldown = Math.max(0.15, BASE_COOLDOWN - 0.015 * (this.level - 1)) * (this.evolved ? 0.75 : 1) * ctx.stats.cooldownMultiplier;

    const dx = ctx.enemies.posX[target] - ctx.playerX;
    const dz = ctx.enemies.posZ[target] - ctx.playerZ;
    const baseAngle = Math.atan2(dz, dx);

    const ownExtra = Math.floor((this.level - 1) / 2);
    const count = 2 + ownExtra + (this.evolved ? 2 : 0) + Math.max(0, Math.round(ctx.stats.extraProjectiles));
    const damage = (BASE_DAMAGE + 0.6 * (this.level - 1)) * ctx.stats.damageMultiplier;
    const speed = BASE_SPEED * ctx.stats.projectileSpeedMultiplier;
    const pierce = this.evolved ? 1 : 0;
    // Evolved knives fan out into a wide barrage instead of a narrow forward cone.
    const spreadStep = this.evolved ? EVOLVED_SPREAD_STEP : SPREAD_STEP;

    const mid = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      const angle = baseAngle + (i - mid) * spreadStep;
      ctx.projectiles.spawn(this.visualId, ctx.playerX, ctx.playerZ, Math.cos(angle) * speed, Math.sin(angle) * speed, {
        damage,
        radius: 0.3,
        pierce,
        life: 1.4,
        weaponId: this.weaponNumericId,
      });
    }
  }

  levelUp(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  evolve(): void {
    this.evolved = true;
  }
}
