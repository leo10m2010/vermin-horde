import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';

const BASE_COOLDOWN = 0.4;
const BASE_DAMAGE = 4;
const BASE_SPEED = 14;
const SPREAD_STEP = (8 * Math.PI) / 180; // 8deg between adjacent knives
const EVOLVED_SPREAD_STEP = (22 * Math.PI) / 180; // evolved-only: wide fan instead of a narrow forward cone

/**
 * Knife's identity is being the DIRECTIONAL weapon: it never auto-targets an
 * enemy. It always throws along the player's current facing - the direction
 * of movement, remembered across idle frames so it never collapses to a
 * fixed default while stationary. Count climbs 1 -> 2 -> 3 -> 4 across
 * levels 1/2/4/7 so "more knives" is something you can literally count on
 * screen, plus whatever `stats.extraProjectiles` (Amount) adds on top.
 */
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
  private facingX = 1;
  private facingZ = 0;

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    // Thrown dagger reads better tumbling in flight (VS-style kunai) than static-facing.
    this.visualId = visuals.get('proj_knife', 0.4, [1, 1, 1], true);
  }

  /** 1 at Lv1-3, 2 at Lv4-6, 3 at Lv7-8 - own-level milestones, before evolve/Amount are added. */
  private ownCount(): number {
    let count = 1;
    if (this.level >= 2) count += 1;
    if (this.level >= 4) count += 1;
    if (this.level >= 7) count += 1;
    return count;
  }

  private pierce(): number {
    return this.level >= 6 ? 1 : 0;
  }

  update(ctx: WeaponContext): void {
    const moveSpeedSq = ctx.playerVX * ctx.playerVX + ctx.playerVZ * ctx.playerVZ;
    if (moveSpeedSq > 0.01) {
      const invLen = 1 / Math.sqrt(moveSpeedSq);
      this.facingX = ctx.playerVX * invLen;
      this.facingZ = ctx.playerVZ * invLen;
    }

    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;

    // Balance: Lv5 no longer only shaves a flat per-level amount - it also
    // marks the "-cooldown" milestone the level-up card promises.
    const lv5Bonus = this.level >= 5 ? 0.05 : 0;
    this.cooldown = Math.max(0.15, BASE_COOLDOWN - 0.015 * (this.level - 1) - lv5Bonus) * (this.evolved ? 0.75 : 1) * ctx.stats.cooldownMultiplier;

    const baseAngle = Math.atan2(this.facingZ, this.facingX);
    const count = this.ownCount() + (this.evolved ? 2 : 0) + Math.max(0, Math.round(ctx.stats.extraProjectiles));
    const speedBonus = this.level >= 3 ? 1.15 : 1;
    const damage = (BASE_DAMAGE + 0.6 * (this.level - 1)) * ctx.stats.damageMultiplier;
    const speed = BASE_SPEED * speedBonus * ctx.stats.projectileSpeedMultiplier;
    const pierce = this.pierce() + (this.evolved ? 1 : 0);
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
