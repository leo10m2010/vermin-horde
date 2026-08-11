import { PLAYER, XP } from '../core/Constants';

export type GamePhase = 'menu' | 'playing' | 'paused' | 'levelup' | 'gameover' | 'victory';

/** Multiplicative/additive modifiers accumulated from passives & weapon upgrades. */
export interface PlayerStats {
  maxHealth: number;
  health: number;
  armor: number; // flat damage reduction per hit
  moveSpeed: number;
  magnetRadius: number;
  regenPerSecond: number;
  damageMultiplier: number;
  areaMultiplier: number;
  cooldownMultiplier: number; // <1 = weapons fire faster
  projectileSpeedMultiplier: number;
  durationMultiplier: number;
  xpGainMultiplier: number;
  luck: number; // 0..1, nudges elite/rare rolls
  critChance: number;
  critMultiplier: number;
  extraProjectiles: number;
  reviveCharges: number;
}

export function createDefaultStats(): PlayerStats {
  return {
    maxHealth: PLAYER.baseMaxHealth,
    health: PLAYER.baseMaxHealth,
    armor: PLAYER.baseArmor,
    moveSpeed: PLAYER.baseSpeed,
    magnetRadius: PLAYER.baseMagnet,
    regenPerSecond: 0,
    damageMultiplier: 1,
    areaMultiplier: 1,
    cooldownMultiplier: 1,
    projectileSpeedMultiplier: 1,
    durationMultiplier: 1,
    xpGainMultiplier: 1,
    luck: 0,
    critChance: 0.04,
    critMultiplier: 1.8,
    extraProjectiles: 0,
    reviveCharges: 0,
  };
}

export interface RunStats {
  elapsed: number;
  kills: number;
  eliteKills: number;
  bossKills: number;
  level: number;
  xp: number;
  xpToNext: number;
  gemsCollected: number;
  damageDealt: number;
  damageTaken: number;
}

export function createDefaultRunStats(): RunStats {
  return {
    elapsed: 0,
    kills: 0,
    eliteKills: 0,
    bossKills: 0,
    level: 1,
    xp: 0,
    xpToNext: XP.curve(1),
    gemsCollected: 0,
    damageDealt: 0,
    damageTaken: 0,
  };
}

/**
 * Single mutable source of truth for the current run. Systems read/write
 * fields directly (no getters/setters ceremony) but must never replace the
 * object references themselves - Game.reset() mutates in place so other
 * systems that captured a reference stay valid across restarts.
 */
export class GameState {
  phase: GamePhase = 'menu';
  stats: PlayerStats = createDefaultStats();
  run: RunStats = createDefaultRunStats();
  seed = 1;
  /** Stack count per owned passive id (e.g. {'passive_damage': 3}), used to gate weapon evolutions on a specific owned passive. */
  ownedPassives: Map<string, number> = new Map();

  reset(seed = Date.now() & 0xffffffff): void {
    this.stats = createDefaultStats();
    this.run = createDefaultRunStats();
    this.seed = seed;
    this.phase = 'playing';
    this.ownedPassives = new Map();
  }

  gainXp(amount: number): number {
    this.run.xp += amount * this.stats.xpGainMultiplier;
    let levelsGained = 0;
    while (this.run.xp >= this.run.xpToNext) {
      this.run.xp -= this.run.xpToNext;
      this.run.level += 1;
      this.run.xpToNext = XP.curve(this.run.level);
      levelsGained += 1;
    }
    return levelsGained;
  }
}
