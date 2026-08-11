import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';

const RANGE = 16;
const BASE_COOLDOWN = 2.2;
const BASE_DAMAGE = 24;
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
  private cooldown = 0;
  private readonly candidateBuffer: number[] = [];

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    this.visualId = visuals.get('proj_ember', 0.6, [1, 1, 1], false);
  }

  update(ctx: WeaponContext): void {
    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;

    const count = ctx.enemies.queryRadius(ctx.playerX, ctx.playerZ, RANGE, this.candidateBuffer);
    if (count === 0) return;
    const target = this.candidateBuffer[Math.floor(ctx.rng() * count) % count];

    this.cooldown = Math.max(1.1, BASE_COOLDOWN - 0.09 * (this.level - 1)) * (this.evolved ? 0.75 : 1) * ctx.stats.cooldownMultiplier;

    const dx = ctx.enemies.posX[target] - ctx.playerX;
    const dz = ctx.enemies.posZ[target] - ctx.playerZ;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const speed = BASE_SPEED * ctx.stats.projectileSpeedMultiplier;
    const damage = (BASE_DAMAGE + 3.2 * (this.level - 1)) * (this.evolved ? 1.4 : 1) * ctx.stats.damageMultiplier;
    const pierce = this.evolved ? 2 : 0;

    ctx.projectiles.spawn(this.visualId, ctx.playerX, ctx.playerZ, (dx / dist) * speed, (dz / dist) * speed, {
      damage,
      radius: 0.55,
      pierce,
      life: 2.5 * ctx.stats.durationMultiplier,
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
