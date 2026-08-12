import type { Weapon, WeaponContext } from './WeaponBase';
import { findNearestEnemies, VisualCache } from './WeaponBase';
import { effectAt } from './WeaponProgression';

const RANGE = 12;
const BASE_SPEED = 11;
const CHAIN_RADIUS = 3.5; // evolved-only: search radius for a secondary arc target around the impact point
const CHAIN_DAMAGE_FRACTION = 0.6;

/** Starting weapon: auto-targets the nearest enemy(ies) in range and fires straight bolts. */
export class MagicWandWeapon implements Weapon {
  readonly id = 'magic_wand';
  readonly name = 'Magic Wand';
  level = 1;
  readonly maxLevel = 8;
  evolved = false;
  /** Evolves into a rapid-cast form once the player also holds Quick Hands (cooldown passive). */
  readonly evolutionRequiresPassive = 'passive_cooldown';

  private readonly visualId: number;
  /** Separate evolved sprite (violet arcane dart) - an evolution has to be visible, not a tint. */
  private readonly evolvedVisualId: number;
  private cooldown = 0;
  private readonly targetBuffer: number[] = [];
  private readonly chainBuffer: number[] = [];

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    this.visualId = visuals.get('bolt_basic', 0.6, [1, 1, 1], false);
    this.evolvedVisualId = visuals.get('bolt_basic_evo', 0.78, [1, 1, 1], false);
  }

  /** Bolts per cast at this level (Lv1:1, Lv4:2, Lv7:3), before Amount. Public for tests/showcase. */
  boltCount(): number {
    return effectAt(this.id, this.level, this.evolved).projectiles ?? 1;
  }

  private projectileCount(extraProjectiles: number): number {
    // Amount (Ammo Satchel) is compatible: one more auto-targeted bolt per stack.
    return this.boltCount() + Math.max(0, Math.round(extraProjectiles));
  }

  update(ctx: WeaponContext): void {
    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;

    const count = this.projectileCount(ctx.stats.extraProjectiles);
    const found = findNearestEnemies(ctx, ctx.playerX, ctx.playerZ, RANGE, count, this.targetBuffer);
    if (found === 0) return;

    // Evolved cast rate is faster than the base weapon's steady gap between casts.
    // Balance: was 0.5 (a flat cooldown halving) - combined with the extra
    // projectile and the on-hit chain that's evolved-only, this alone pushed
    // the evolution to ~4x+ total DPS vs. the ~1.7-2x other weapons get.
    const e = effectAt(this.id, this.level, this.evolved);
    this.cooldown = e.cooldown * ctx.stats.cooldownMultiplier;
    const damage = e.damage * ctx.stats.damageMultiplier;
    const speed = BASE_SPEED * ctx.stats.projectileSpeedMultiplier;
    const pierce = e.pierce ?? 0;

    for (let i = 0; i < found; i++) {
      const target = this.targetBuffer[i];
      const dx = ctx.enemies.posX[target] - ctx.playerX;
      const dz = ctx.enemies.posZ[target] - ctx.playerZ;
      const dist = Math.sqrt(dx * dx + dz * dz) || 1;
      ctx.projectiles.spawn(this.evolved ? this.evolvedVisualId : this.visualId, ctx.playerX, ctx.playerZ, (dx / dist) * speed, (dz / dist) * speed, {
        damage,
        radius: 0.4,
        pierce,
        life: 2.2,
        weaponId: this.weaponNumericId,
      });
    }
  }

  /**
   * Evolved-only: bolts arc to one extra nearby enemy on impact instead of
   * only ever hitting what they struck - the wand "never loses track" of the
   * crowd around its target.
   */
  onProjectileHit(ctx: WeaponContext, hitX: number, hitZ: number, directDamage: number, hitEnemyIndex: number): void {
    if (!this.evolved) return;
    const found = findNearestEnemies(ctx, hitX, hitZ, CHAIN_RADIUS, 2, this.chainBuffer);
    for (let i = 0; i < found; i++) {
      const idx = this.chainBuffer[i];
      if (idx === hitEnemyIndex) continue;
      ctx.enemies.damage(idx, directDamage * CHAIN_DAMAGE_FRACTION, false, this.id);
      break;
    }
  }

  levelUp(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  evolve(): void {
    this.evolved = true;
  }
}
