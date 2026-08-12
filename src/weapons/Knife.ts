import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';
import { effectAt } from './WeaponProgression';

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
  /** Evolved Thousand Blades: cyan spectral daggers, visibly not the same weapon. */
  private readonly evolvedVisualId: number;
  private cooldown = 0;
  private facingX = 1;
  private facingZ = 0;

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    // Thrown dagger reads better tumbling in flight (VS-style kunai) than static-facing.
    this.visualId = visuals.get('proj_knife', 0.55, [1, 1, 1], false);
    this.evolvedVisualId = visuals.get('proj_knife_evo', 0.65, [1, 1, 1], false);
  }

  /** Knives per throw at this level (Lv1:1, Lv2:2, Lv4:3, Lv7:4), before Amount. Public for tests/showcase. */
  knifeCount(): number {
    return effectAt(this.id, this.level, this.evolved).projectiles ?? 1;
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

    const e = effectAt(this.id, this.level, this.evolved);
    this.cooldown = e.cooldown * ctx.stats.cooldownMultiplier;

    const baseAngle = Math.atan2(this.facingZ, this.facingX);
    const count = this.knifeCount() + Math.max(0, Math.round(ctx.stats.extraProjectiles));
    const damage = e.damage * ctx.stats.damageMultiplier;
    const speed = (e.speed ?? BASE_SPEED) * ctx.stats.projectileSpeedMultiplier;
    const pierce = e.pierce ?? 0;
    // Evolved knives fan out into a wide barrage instead of a narrow forward cone.
    const spreadStep = this.evolved ? EVOLVED_SPREAD_STEP : SPREAD_STEP;

    const mid = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      const angle = baseAngle + (i - mid) * spreadStep;
      ctx.projectiles.spawn(this.evolved ? this.evolvedVisualId : this.visualId, ctx.playerX, ctx.playerZ, Math.cos(angle) * speed, Math.sin(angle) * speed, {
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
