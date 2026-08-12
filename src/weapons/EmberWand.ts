import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';
import { effectAt } from './WeaponProgression';

const RANGE = 16;
const BASE_COOLDOWN = 2.2;
const BASE_SPEED = 8;

/** Fires at a RANDOM alive enemy in range (not nearest) - slow, heavy single-target hit. */
export class EmberWandWeapon implements Weapon {
  readonly id = 'ember_wand';
  readonly name = 'Ember Wand';
  level = 1;
  readonly maxLevel = 8;
  evolved = false;
  /** Evolves into a scorching barrage once the player also holds Killer Instinct (crit passive). */
  readonly evolutionRequiresPassive = 'passive_crit';

  private readonly visualId: number;
  /** Evolved sprite - an evolution must be visible, not a tint. */
  private readonly evolvedVisualId: number;
  private cooldown = 0;
  private readonly candidateBuffer: number[] = [];

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    this.visualId = visuals.get('proj_ember', 0.6, [1, 1, 1], false);
    this.evolvedVisualId = visuals.get('proj_ember_evo', 0.6, [1, 1, 1], false);
  }

  update(ctx: WeaponContext): void {
    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;

    const count = ctx.enemies.queryRadius(ctx.playerX, ctx.playerZ, RANGE, this.candidateBuffer);
    if (count === 0) return;
    const firstTarget = this.candidateBuffer[Math.floor(ctx.rng() * count) % count];

    // Balance: evolved no longer also gets a cooldown discount (was 0.75) -
    // hurling a second ember at a different target already doubles output,
    // so stacking a rate-of-fire bonus on top pushed evolve to ~3.7x+ DPS
    // vs. the ~1.7-2x other weapons get from their evolutions.
    this.cooldown = Math.max(1.1, BASE_COOLDOWN - 0.09 * (this.level - 1)) * ctx.stats.cooldownMultiplier;

    const speed = BASE_SPEED * ctx.stats.projectileSpeedMultiplier;
    // Balance: was 1.4 - trimmed since the second ember already doubles damage output.
    const e = effectAt(this.id, this.level, this.evolved);
    const damage = e.damage * ctx.stats.damageMultiplier;
    const pierce = e.pierce ?? 0;
    const life = 2.5 * ctx.stats.durationMultiplier;

    this.fireAt(ctx, firstTarget, damage, speed, pierce, life);

    if (this.evolved && count > 1) {
      // Evolved wand hurls a second ember at a different target in the same instant, instead of one heavy hit per cooldown.
      let secondTarget = firstTarget;
      for (let attempts = 0; attempts < 4 && secondTarget === firstTarget; attempts++) {
        secondTarget = this.candidateBuffer[Math.floor(ctx.rng() * count) % count];
      }
      if (secondTarget !== firstTarget) this.fireAt(ctx, secondTarget, damage, speed, pierce, life);
    }
  }

  private fireAt(ctx: WeaponContext, target: number, damage: number, speed: number, pierce: number, life: number): void {
    const dx = ctx.enemies.posX[target] - ctx.playerX;
    const dz = ctx.enemies.posZ[target] - ctx.playerZ;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    ctx.projectiles.spawn(this.evolved ? this.evolvedVisualId : this.visualId, ctx.playerX, ctx.playerZ, (dx / dist) * speed, (dz / dist) * speed, {
      damage,
      radius: 0.55,
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
