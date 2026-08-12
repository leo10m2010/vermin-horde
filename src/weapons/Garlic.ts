import { gameEvents } from '../core/EventBus';
import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';
import { effectAt } from './WeaponProgression';

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
    // ONE radius value feeds both the drawn ring and the damage query below,
    // so the aura the player sees is exactly the aura that hurts.
    const radius = this.auraRadius(ctx.stats.areaMultiplier);

    if (this.ringIndex === -1) this.ringIndex = ctx.groundRings.acquire();
    ctx.groundRings.set(this.ringIndex, ctx.playerX, ctx.playerZ, radius, RING_COLOR, RING_OPACITY);

    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;
    this.cooldown = effectAt(this.id, this.level, this.evolved).cooldown * ctx.stats.cooldownMultiplier;

    const count = ctx.enemies.queryRadius(ctx.playerX, ctx.playerZ, radius, this.hitBuffer);
    if (count === 0) return;

    const damagePerTick = effectAt(this.id, this.level, this.evolved).damage * ctx.stats.damageMultiplier;
    let totalDealt = 0;
    for (let i = 0; i < count; i++) {
      const enemyIndex = this.hitBuffer[i];
      const crit = ctx.rng() < ctx.stats.critChance;
      const dmg = damagePerTick * (crit ? ctx.stats.critMultiplier : 1);
      ctx.enemies.damage(enemyIndex, dmg, crit, this.id);
      totalDealt += dmg;
    }
    if (this.evolved && totalDealt > 0) {
      // Evolved aura drains life from everything it burns, healing the player as it ticks.
      ctx.stats.health = Math.min(ctx.stats.maxHealth, ctx.stats.health + totalDealt * EVOLVED_LIFESTEAL_FRACTION);
    }
    gameEvents.emit('weaponFired', { weaponId: this.id, x: ctx.playerX, z: ctx.playerZ });
  }

  /** The single radius used for BOTH the visual ring and the damage query. Public so tests can assert they match. */
  auraRadius(areaMultiplier: number): number {
    return (effectAt(this.id, this.level, this.evolved).radius ?? BASE_RADIUS) * areaMultiplier;
  }

  levelUp(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  evolve(): void {
    this.evolved = true;
  }
}
