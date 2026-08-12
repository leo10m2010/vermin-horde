import type { EnemyManager } from '../entities/EnemyManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { PlayerStats } from '../game/GameState';
import type { GroundAreaRings } from '../vfx/GroundAreaRings';
import { gameEvents } from '../core/EventBus';
import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';
import { WEAPON_ROSTER } from './WeaponRegistry';

export interface WeaponSummary {
  id: string;
  name: string;
  level: number;
  maxLevel: number;
  evolved: boolean;
}

const STARTING_WEAPON_ID = 'magic_wand';

/**
 * Owns every weapon the player currently has, drives them each frame, and
 * runs the generic projectile-hit resolution pass shared by every weapon
 * that doesn't opt out via `handlesOwnHits` (currently only the orbiter).
 */
export class WeaponSystem {
  readonly maxSlots = 6;

  private readonly owned = new Map<string, Weapon>();
  /** numeric weaponId (index into WEAPON_ROSTER) -> owned Weapon instance, for weapons using the generic hit resolver. */
  private readonly hitTestable = new Map<number, Weapon>();
  private readonly visuals: VisualCache;
  private readonly numericIdById = new Map<string, number>();
  private readonly hitBuffer: number[] = [];
  /** Per-projectile-slot last-hit enemy index, to avoid re-hitting the same enemy on consecutive overlapping frames. */
  private readonly lastHitEnemy: Int32Array;
  /**
   * Owned-passive stack ledger (passive id -> stack count), used to gate
   * evolutions that require both maxLevel AND a specific held passive (real
   * VS mechanic). Defaults to an empty map until the director wires
   * `trySetInventory` in from GameState.ownedPassives once per frame - a
   * weapon whose `evolutionRequiresPassive` is unset is unaffected either way.
   */
  private ownedPassives: Map<string, number> = new Map();

  constructor(
    private readonly enemies: EnemyManager,
    private readonly projectiles: ProjectileManager,
    private readonly groundRings: GroundAreaRings,
    private readonly rng: () => number,
  ) {
    this.visuals = new VisualCache(projectiles);
    WEAPON_ROSTER.forEach((entry, index) => this.numericIdById.set(entry.id, index));
    this.lastHitEnemy = new Int32Array(projectiles.capacity).fill(-1);
    this.addWeapon(STARTING_WEAPON_ID);
  }

  update(
    dt: number,
    elapsed: number,
    playerX: number,
    playerZ: number,
    playerVX: number,
    playerVZ: number,
    stats: PlayerStats,
  ): void {
    const ctx: WeaponContext = { enemies: this.enemies, projectiles: this.projectiles, groundRings: this.groundRings, stats, playerX, playerZ, playerVX, playerVZ, dt, elapsed, rng: this.rng };
    for (const weapon of this.owned.values()) weapon.update(ctx);
    this.resolveProjectileHits(ctx);
  }

  private resolveProjectileHits(ctx: WeaponContext): void {
    const cap = this.projectiles.capacity;
    for (let i = 0; i < cap; i++) {
      if (!this.projectiles.alive[i]) {
        this.lastHitEnemy[i] = -1;
        continue;
      }
      const numericId = this.projectiles.weaponId[i];
      if (numericId < 0) continue;
      const weapon = this.hitTestable.get(numericId);
      if (!weapon) continue;

      const count = this.enemies.queryRadius(this.projectiles.posX[i], this.projectiles.posZ[i], this.projectiles.radius[i], this.hitBuffer);
      if (count === 0) continue;

      let enemyIndex = -1;
      for (let k = 0; k < count; k++) {
        if (this.hitBuffer[k] !== this.lastHitEnemy[i]) {
          enemyIndex = this.hitBuffer[k];
          break;
        }
      }
      if (enemyIndex === -1) continue; // only overlap is the enemy we already hit last frame; wait for separation

      const crit = ctx.rng() < ctx.stats.critChance;
      const damage = this.projectiles.damage[i] * (crit ? ctx.stats.critMultiplier : 1);
      const hitX = this.projectiles.posX[i];
      const hitZ = this.projectiles.posZ[i];
      this.enemies.damage(enemyIndex, damage, crit);
      this.lastHitEnemy[i] = enemyIndex;
      weapon.onProjectileHit?.(ctx, hitX, hitZ, damage, enemyIndex);
      this.projectiles.registerHit(i);
    }
  }

  /**
   * Feeds in the current run's owned-passive ledger (GameState.ownedPassives)
   * so the evolve check in levelUp() can verify a weapon's
   * `evolutionRequiresPassive` condition. Call once per frame (or whenever
   * the ledger changes) before levelUp() - cheap to call redundantly since it
   * just stores the reference.
   */
  trySetInventory(ownedPassives: Map<string, number>): void {
    this.ownedPassives = ownedPassives;
  }

  addWeapon(id: string): boolean {
    if (this.owned.has(id)) return false;
    if (this.owned.size >= this.maxSlots) return false;
    const entry = WEAPON_ROSTER.find((w) => w.id === id);
    if (!entry) return false;
    const numericId = this.numericIdById.get(id)!;
    const weapon = entry.create(this.visuals, numericId);
    this.owned.set(id, weapon);
    if (!weapon.handlesOwnHits) this.hitTestable.set(numericId, weapon);
    return true;
  }

  levelUp(id: string): boolean {
    const weapon = this.owned.get(id);
    if (!weapon) return false;
    if (weapon.level >= weapon.maxLevel) return false;
    weapon.levelUp();
    const passiveSatisfied = !weapon.evolutionRequiresPassive || (this.ownedPassives.get(weapon.evolutionRequiresPassive) ?? 0) > 0;
    if (weapon.level >= weapon.maxLevel && !weapon.evolved && weapon.evolve && passiveSatisfied) {
      weapon.evolve();
      gameEvents.emit('weaponEvolved', { weaponId: weapon.id, name: weapon.name });
    }
    return true;
  }

  hasWeapon(id: string): boolean {
    return this.owned.has(id);
  }

  isMaxed(id: string): boolean {
    const weapon = this.owned.get(id);
    return weapon ? weapon.level >= weapon.maxLevel : false;
  }

  listOwned(): WeaponSummary[] {
    return Array.from(this.owned.values()).map((w) => ({ id: w.id, name: w.name, level: w.level, maxLevel: w.maxLevel, evolved: w.evolved }));
  }

  ownedCount(): number {
    return this.owned.size;
  }

  reset(startingWeaponId: string = STARTING_WEAPON_ID): void {
    this.owned.clear();
    this.hitTestable.clear();
    this.lastHitEnemy.fill(-1);
    this.ownedPassives = new Map();
    if (!this.addWeapon(startingWeaponId)) this.addWeapon(STARTING_WEAPON_ID);
  }
}
