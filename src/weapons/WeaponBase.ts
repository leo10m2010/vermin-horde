import type { EnemyManager } from '../entities/EnemyManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { PlayerStats } from '../game/GameState';
import type { GroundAreaRings } from '../vfx/GroundAreaRings';

export interface WeaponContext {
  enemies: EnemyManager;
  projectiles: ProjectileManager;
  groundRings: GroundAreaRings;
  stats: PlayerStats;
  playerX: number;
  playerZ: number;
  playerVX: number;
  playerVZ: number;
  dt: number;
  elapsed: number;
  rng: () => number;
}

export interface Weapon {
  readonly id: string;
  readonly name: string;
  level: number;
  readonly maxLevel: number;
  evolved: boolean;
  /**
   * When true, this weapon's projectiles are excluded from WeaponSystem's
   * generic per-frame hit-test pass (damage application + pierce handling) -
   * the weapon does its own collision/damage entirely inside update().
   * Used by the orbiter, whose blades are life:Infinity and never consume
   * pierce through ProjectileManager.registerHit.
   */
  readonly handlesOwnHits?: boolean;

  /**
   * Optional: id of a passive (from UpgradeSystem's PASSIVE_DEFS) the player
   * must own at least one stack of, IN ADDITION to being at maxLevel, before
   * WeaponSystem.levelUp() will auto-evolve this weapon. Mirrors real Vampire
   * Survivors' "max level + specific held item" evolution requirement. When
   * omitted, the weapon evolves on max level alone (backward compatible).
   */
  readonly evolutionRequiresPassive?: string;

  /** Called every frame while phase === 'playing'. Fire, move, tick damage, etc. */
  update(ctx: WeaponContext): void;

  /** Apply this weapon's own per-level scaling (damage/count/cooldown/pierce/etc). */
  levelUp(): void;

  /**
   * Optional: invoked once, the moment `level` first reaches `maxLevel`.
   * Should set `evolved = true` and apply a meaningful one-time stat bump.
   * WeaponSystem emits `weaponEvolved` right after calling this.
   */
  evolve?(): void;

  /**
   * Optional: invoked by WeaponSystem's generic hit-test pass right after it
   * applies direct damage to the struck enemy, for weapons that need a
   * secondary effect on impact (e.g. Fireball's splash AoE).
   */
  onProjectileHit?(ctx: WeaponContext, hitX: number, hitZ: number, directDamage: number, hitEnemyIndex: number): void;
}

/** Dedupes ProjectileManager.registerVisual calls by clip name across repeated weapon (re)construction (e.g. WeaponSystem.reset()). */
export class VisualCache {
  private readonly ids = new Map<string, number>();

  constructor(private readonly projectiles: ProjectileManager) {}

  get(clip: string, spriteSize: number, tint: [number, number, number] = [1, 1, 1], spins = false): number {
    const existing = this.ids.get(clip);
    if (existing !== undefined) return existing;
    const id = this.projectiles.registerVisual(clip, spriteSize, tint, spins);
    this.ids.set(clip, id);
    return id;
  }
}

/** Fills `out` with up to `maxCount` alive enemy indices within `radius` of (x,z), nearest-first. */
export function findNearestEnemies(ctx: WeaponContext, x: number, z: number, radius: number, maxCount: number, out: number[]): number {
  const buffer: number[] = [];
  const found = ctx.enemies.queryRadius(x, z, radius, buffer);
  buffer.length = found;
  buffer.sort((a, b) => {
    const da = (ctx.enemies.posX[a] - x) ** 2 + (ctx.enemies.posZ[a] - z) ** 2;
    const db = (ctx.enemies.posX[b] - x) ** 2 + (ctx.enemies.posZ[b] - z) ** 2;
    return da - db;
  });
  const count = Math.min(maxCount, buffer.length);
  for (let i = 0; i < count; i++) out[i] = buffer[i];
  return count;
}
