import { gameEvents } from '../core/EventBus';
import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';

const BASE_TICK = 0.4;
const BASE_DAMAGE = 5;
const BASE_RADIUS = 2.2;
const RING_COLOR = '#ffcf7a';
const RING_OPACITY = 0.5;
const EVOLVED_LIFESTEAL_FRACTION = 0.08; // evolved-only: fraction of total tick damage dealt returned as player healing

/**
 * Passive continuous AoE around the player - no projectile hit-testing (ticks
 * directly against nearby enemies), but it DOES own one permanent
 * life:Infinity visual-only "ring" instance so the player can actually see
 * their aura instead of it being an invisible damage zone.
 */
export class GarlicWeapon implements Weapon {
  readonly id = 'garlic_aura';
  readonly name = 'Garlic Aura';
  level = 1;
  readonly maxLevel = 8;
  evolved = false;
  readonly handlesOwnHits = true; // the visual ring instance must never be hit-tested/despawned by the generic pass
  /** Evolves into a life-draining aura once the player also holds Regeneration. */
  readonly evolutionRequiresPassive = 'passive_regen';

  private cooldown = 0;
  private readonly hitBuffer: number[] = [];
  private ringIndex = -1;

  // Neither visuals (no projectile-atlas sprite needed - the ring is a flat
  // GroundAreaRings mesh) nor weaponNumericId (never tags a projectile) are
  // used, but both are required by WeaponRosterEntry.create's shared signature.
  constructor(_visuals: VisualCache, _weaponNumericId: number) {}

  update(ctx: WeaponContext): void {
    // Computed every frame (not just on tick) so the ring visual - and its
    // hit-test radius below - both track area upgrades/arcanas live instead
    // of the ring staying a fixed size while the real damage radius grows.
    const radius = (BASE_RADIUS + 0.05 * (this.level - 1)) * ctx.stats.areaMultiplier;

    if (this.ringIndex === -1) this.ringIndex = ctx.groundRings.acquire();
    ctx.groundRings.set(this.ringIndex, ctx.playerX, ctx.playerZ, radius, RING_COLOR, RING_OPACITY);

    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;
    this.cooldown = Math.max(0.2, BASE_TICK - 0.01 * (this.level - 1)) * ctx.stats.cooldownMultiplier;

    const count = ctx.enemies.queryRadius(ctx.playerX, ctx.playerZ, radius, this.hitBuffer);
    if (count === 0) return;

    const damagePerTick = (BASE_DAMAGE + 0.6 * (this.level - 1)) * (this.evolved ? 2 : 1) * ctx.stats.damageMultiplier;
    let totalDealt = 0;
    for (let i = 0; i < count; i++) {
      const enemyIndex = this.hitBuffer[i];
      const crit = ctx.rng() < ctx.stats.critChance;
      const dmg = damagePerTick * (crit ? ctx.stats.critMultiplier : 1);
      ctx.enemies.damage(enemyIndex, dmg, crit);
      totalDealt += dmg;
    }
    if (this.evolved && totalDealt > 0) {
      // Evolved aura drains life from everything it burns, healing the player as it ticks.
      ctx.stats.health = Math.min(ctx.stats.maxHealth, ctx.stats.health + totalDealt * EVOLVED_LIFESTEAL_FRACTION);
    }
    gameEvents.emit('weaponFired', { weaponId: this.id, x: ctx.playerX, z: ctx.playerZ });
  }

  levelUp(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  evolve(): void {
    this.evolved = true;
  }
}
