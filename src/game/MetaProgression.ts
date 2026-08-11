import { gameEvents } from '../core/EventBus';
import type { PlayerStats } from './GameState';

/**
 * One permanently-purchasable stat bump. `costPerLevel(currentLevel)` returns
 * the gold price of buying the *next* level (currentLevel -> currentLevel+1).
 * `apply` is called once per run start with the level currently owned - it
 * should apply the *total* bonus for that level, not an incremental step.
 */
export interface PermanentUpgradeDef {
  id: string;
  name: string;
  description: string;
  costPerLevel: (currentLevel: number) => number;
  maxLevel: number;
  apply: (stats: PlayerStats, level: number) => void;
}

interface MetaSaveData {
  gold: number;
  upgrades: Record<string, number>;
}

const STORAGE_KEY = 'vermin-horde-meta-v1';

/** Gold cost curve shared by most upgrades: steep enough that maxing every
 * upgrade is a real long-term goal, gentle enough that early levels feel
 * reachable after a couple of runs. */
function scaledCost(base: number, exponent = 1.6): (currentLevel: number) => number {
  return (currentLevel: number) => Math.round(base * (currentLevel + 1) ** exponent);
}

const UPGRADE_DEFS: PermanentUpgradeDef[] = [
  {
    id: 'ancestral_vigor',
    name: 'Ancestral Vigor',
    description: '+12 max health per level, applied at the start of every run.',
    costPerLevel: scaledCost(50),
    maxLevel: 10,
    apply: (stats, level) => {
      stats.maxHealth += 12 * level;
      stats.health += 12 * level;
    },
  },
  {
    id: 'grave_boots',
    name: 'Grave Boots',
    description: '+0.12 move speed per level.',
    costPerLevel: scaledCost(45),
    maxLevel: 8,
    apply: (stats, level) => {
      stats.moveSpeed += 0.12 * level;
    },
  },
  {
    id: 'bone_charm',
    name: 'Bone Charm',
    description: '+2% luck per level (nudges rare/elite rolls).',
    costPerLevel: scaledCost(55),
    maxLevel: 10,
    apply: (stats, level) => {
      stats.luck = Math.min(1, stats.luck + 0.02 * level);
    },
  },
  {
    id: 'wardstone',
    name: 'Wardstone',
    description: '+1 armor per level.',
    costPerLevel: scaledCost(70),
    maxLevel: 6,
    apply: (stats, level) => {
      stats.armor += 1 * level;
    },
  },
  {
    id: 'ember_heart',
    name: 'Ember Heart',
    description: '+3% damage per level.',
    costPerLevel: scaledCost(60),
    maxLevel: 8,
    apply: (stats, level) => {
      stats.damageMultiplier += 0.03 * level;
    },
  },
  {
    id: 'fleet_step',
    name: 'Fleet Step',
    description: '+5% projectile speed per level.',
    costPerLevel: scaledCost(40),
    maxLevel: 6,
    apply: (stats, level) => {
      stats.projectileSpeedMultiplier += 0.05 * level;
    },
  },
  {
    id: 'hunters_eye',
    name: "Hunter's Eye",
    description: '+1.5% crit chance per level.',
    costPerLevel: scaledCost(65),
    maxLevel: 8,
    apply: (stats, level) => {
      stats.critChance += 0.015 * level;
    },
  },
  {
    id: 'spirit_regen',
    name: 'Spirit Regen',
    description: '+0.15 HP/s regeneration per level.',
    costPerLevel: scaledCost(75),
    maxLevel: 6,
    apply: (stats, level) => {
      stats.regenPerSecond += 0.15 * level;
    },
  },
  {
    id: 'old_coin_purse',
    name: 'Old Coin Purse',
    description: '+10% gold earned per level, in this and every future run. Compounds over time.',
    costPerLevel: scaledCost(90, 1.7),
    maxLevel: 5,
    // No direct stat effect - the bonus is read via getUpgradeLevel() when
    // gold is awarded on enemyKilled, below.
    apply: () => {},
  },
  {
    id: 'second_wind',
    name: 'Second Wind',
    description: 'Grants 1 revive charge at the start of every run.',
    costPerLevel: () => 900,
    maxLevel: 1,
    apply: (stats, level) => {
      if (level >= 1) stats.reviveCharges += 1;
    },
  },
];

/**
 * Persistent, between-runs currency + permanent upgrade shop backing store.
 * Owns its own localStorage blob and self-subscribes to `enemyKilled` /
 * `runOver` so gold accrues passively during a run and is never lost even if
 * the run director forgets to call `save()` explicitly.
 */
export class MetaProgression {
  private goldAmount = 0;
  private readonly upgradeLevels: Record<string, number> = {};
  readonly upgrades: PermanentUpgradeDef[] = UPGRADE_DEFS;

  constructor() {
    this.load();

    gameEvents.on('enemyKilled', (e) => {
      let amount = Math.max(1, Math.round(e.xpValue * 0.6));
      if (e.isBoss) amount *= 6;
      else if (e.isElite) amount *= 2;
      const goldMultiplier = 1 + this.getUpgradeLevel('old_coin_purse') * 0.1;
      this.addGold(Math.round(amount * goldMultiplier));
    });

    // Belt-and-suspenders: persist whenever a run ends, regardless of
    // whether the director also calls save() itself.
    gameEvents.on('runOver', () => this.save());
  }

  get gold(): number {
    return this.goldAmount;
  }

  addGold(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.goldAmount += Math.round(amount);
  }

  spendGold(amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    if (this.goldAmount < amount) return false;
    this.goldAmount -= amount;
    return true;
  }

  getUpgradeLevel(id: string): number {
    return this.upgradeLevels[id] ?? 0;
  }

  buyUpgrade(id: string): boolean {
    const def = this.upgrades.find((u) => u.id === id);
    if (!def) return false;
    const currentLevel = this.getUpgradeLevel(id);
    if (currentLevel >= def.maxLevel) return false;
    const cost = def.costPerLevel(currentLevel);
    if (!this.spendGold(cost)) return false;
    this.upgradeLevels[id] = currentLevel + 1;
    this.save();
    return true;
  }

  /** Apply every owned permanent upgrade's effect (scaled by its level) to a
   * fresh run's stats. Call once per run start, after createDefaultStats(). */
  applyToStats(stats: PlayerStats): void {
    for (const def of this.upgrades) {
      const level = this.getUpgradeLevel(def.id);
      if (level > 0) def.apply(stats, level);
    }
  }

  save(): void {
    try {
      const data: MetaSaveData = { gold: this.goldAmount, upgrades: this.upgradeLevels };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Private browsing / disabled storage: fail soft, session stays in-memory-only.
    }
  }

  load(): void {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<MetaSaveData> | null;
      if (!parsed || typeof parsed !== 'object') return;
      if (typeof parsed.gold === 'number' && Number.isFinite(parsed.gold)) {
        this.goldAmount = Math.max(0, Math.floor(parsed.gold));
      }
      if (parsed.upgrades && typeof parsed.upgrades === 'object') {
        for (const [id, level] of Object.entries(parsed.upgrades)) {
          if (typeof level === 'number' && Number.isFinite(level) && level > 0) {
            this.upgradeLevels[id] = Math.floor(level);
          }
        }
      }
    } catch {
      // Corrupt/blocked storage: fail soft, start a fresh in-memory session.
    }
  }
}
