import { gameEvents } from '../core/EventBus';
import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';

const BASE_TICK = 0.4;
const BASE_DAMAGE = 5;
const BASE_RADIUS = 2.2;
const RING_VISUAL_SIZE = BASE_RADIUS * 2.1;

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
  private readonly visualId: number;
  private ringIndex = -1;

  constructor(private readonly visuals: VisualCache, private readonly weaponNumericId: number) {
    this.visualId = this.visuals.get('aoe_ring_holy', RING_VISUAL_SIZE, [1, 0.85, 0.55], false);
  }

  update(ctx: WeaponContext): void {
    if (this.ringIndex === -1 || !ctx.projectiles.alive[this.ringIndex]) {
      this.ringIndex = ctx.projectiles.spawn(this.visualId, ctx.playerX, ctx.playerZ, 0, 0, {
        damage: 0,
        radius: 0,
        pierce: 0,
        life: Infinity,
        weaponId: this.weaponNumericId,
      });
    }
    if (this.ringIndex !== -1) {
      ctx.projectiles.setPosition(this.ringIndex, ctx.playerX, ctx.playerZ);
    }

    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;
    this.cooldown = Math.max(0.2, BASE_TICK - 0.01 * (this.level - 1)) * ctx.stats.cooldownMultiplier;

    const radius = (BASE_RADIUS + 0.05 * (this.level - 1)) * ctx.stats.areaMultiplier;
    const count = ctx.enemies.queryRadius(ctx.playerX, ctx.playerZ, radius, this.hitBuffer);
    if (count === 0) return;

    const damagePerTick = (BASE_DAMAGE + 0.6 * (this.level - 1)) * (this.evolved ? 2 : 1) * ctx.stats.damageMultiplier;
    for (let i = 0; i < count; i++) {
      const enemyIndex = this.hitBuffer[i];
      const crit = ctx.rng() < ctx.stats.critChance;
      const dmg = damagePerTick * (crit ? ctx.stats.critMultiplier : 1);
      ctx.enemies.damage(enemyIndex, dmg, crit);
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
