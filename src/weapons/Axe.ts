import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';

const BASE_COOLDOWN = 1.1;
const BASE_DAMAGE = 14;
const BASE_SPEED = 9;
const EVOLVED_TWIN_ANGLE = (18 * Math.PI) / 180; // evolved-only: second axe thrown simultaneously, offset from the primary throw

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
    // Balance: evolved no longer also gets a cooldown discount (was 0.75) -
    // throwing a second axe simultaneously already doubles output, so
    // stacking a rate-of-fire bonus on top pushed evolve to ~5x DPS vs. the
    // ~1.7-2x other weapons get from their evolutions.
    this.cooldown = Math.max(0.4, BASE_COOLDOWN - 0.05 * (this.level - 1)) * ctx.stats.cooldownMultiplier;

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

    // Balance: was 1.3 - trimmed since the twin-throw already doubles damage output.
    const damage = (BASE_DAMAGE + 2.2 * (this.level - 1)) * (this.evolved ? 1.15 : 1) * ctx.stats.damageMultiplier;
    const speed = BASE_SPEED * (this.evolved ? 1.25 : 1) * ctx.stats.projectileSpeedMultiplier;
    const pierce = this.pierce();
    const life = 1.6 * ctx.stats.durationMultiplier;
    this.throwAxe(ctx, angle, damage, speed, pierce, life);
    if (this.evolved) {
      // Evolved axe throws a second blade simultaneously in a fanned-out angle, a wider whirling spread instead of a single line.
      this.throwAxe(ctx, angle + EVOLVED_TWIN_ANGLE, damage, speed, pierce, life);
    }
  }

  private throwAxe(ctx: WeaponContext, angle: number, damage: number, speed: number, pierce: number, life: number): void {
    ctx.projectiles.spawn(this.visualId, ctx.playerX, ctx.playerZ, Math.cos(angle) * speed, Math.sin(angle) * speed, {
      damage,
      radius: 0.5,
      pierce,
      life,
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
