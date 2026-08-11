import { gameEvents } from '../core/EventBus';
import type { PlayerStats } from '../game/GameState';
import { WEAPON_ROSTER } from '../weapons/WeaponRegistry';
import type { WeaponSystem } from '../weapons/WeaponSystem';

export interface UpgradeOption {
  id: string;
  name: string;
  description: string;
  kind: 'new-weapon' | 'weapon-level' | 'passive';
}

interface PassiveDef {
  id: string;
  name: string;
  description: string;
  apply: (stats: PlayerStats) => void;
  /** Max stack count this passive can be picked up to (real VS caps most passives around 5). rollChoices skips it once reached. */
  maxStacks: number;
}

/** Stackable passive stat boosts. Modest per-pick increments so a full run of picks stays balanced. */
const PASSIVE_DEFS: PassiveDef[] = [
  {
    id: 'passive_damage',
    name: 'Power Charm',
    description: '+8% damage',
    apply: (s) => (s.damageMultiplier += 0.08),
    maxStacks: 5,
  },
  {
    id: 'passive_health',
    name: 'Vitality Ring',
    description: '+20 max health (fully healed)',
    apply: (s) => {
      s.maxHealth += 20;
      s.health += 20;
    },
    maxStacks: 5,
  },
  {
    id: 'passive_armor',
    name: 'Iron Skin',
    description: '+1 armor',
    apply: (s) => (s.armor += 1),
    maxStacks: 5,
  },
  {
    id: 'passive_speed',
    name: 'Swift Boots',
    description: '+6% move speed',
    apply: (s) => (s.moveSpeed += 0.35),
    maxStacks: 5,
  },
  {
    id: 'passive_area',
    name: 'Wide Reach',
    description: '+8% area',
    apply: (s) => (s.areaMultiplier += 0.08),
    maxStacks: 5,
  },
  {
    id: 'passive_cooldown',
    name: 'Quick Hands',
    description: '-6% cooldown',
    apply: (s) => (s.cooldownMultiplier = Math.max(0.5, s.cooldownMultiplier - 0.06)),
    maxStacks: 5,
  },
  {
    id: 'passive_proj_speed',
    name: 'Windforce',
    description: '+12% projectile speed',
    apply: (s) => (s.projectileSpeedMultiplier += 0.12),
    maxStacks: 5,
  },
  {
    id: 'passive_magnet',
    name: 'Magnet Charm',
    description: '+0.6 pickup radius',
    apply: (s) => (s.magnetRadius += 0.6),
    maxStacks: 5,
  },
  {
    id: 'passive_regen',
    name: 'Regeneration',
    description: '+0.3 HP/s regen',
    apply: (s) => (s.regenPerSecond += 0.3),
    maxStacks: 5,
  },
  {
    id: 'passive_luck',
    name: 'Four-Leaf Clover',
    description: '+5% luck',
    apply: (s) => (s.luck = Math.min(1, s.luck + 0.05)),
    maxStacks: 5,
  },
  {
    id: 'passive_crit',
    name: 'Killer Instinct',
    description: '+3% crit chance',
    apply: (s) => (s.critChance += 0.03),
    maxStacks: 5,
  },
  {
    id: 'passive_extra_projectile',
    name: 'Ammo Satchel',
    description: '+1 extra projectile',
    apply: (s) => (s.extraProjectiles += 1),
    maxStacks: 5,
  },
  {
    id: 'passive_duration',
    name: 'Timeless Hourglass',
    description: '+10% effect duration',
    apply: (s) => (s.durationMultiplier += 0.1),
    maxStacks: 5,
  },
  {
    id: 'passive_growth',
    name: 'Growth Sigil',
    description: '+8% XP gain',
    apply: (s) => (s.xpGainMultiplier += 0.08),
    maxStacks: 5,
  },
  {
    id: 'passive_revival',
    name: 'Phoenix Feather',
    description: '+1 revival - survive a fatal hit',
    apply: (s) => (s.reviveCharges += 1),
    maxStacks: 2,
  },
];

/**
 * Builds the 3-choice (by default) level-up menu: unlockable weapons, level-ups
 * for owned non-maxed weapons, and stackable passives. Applies whichever the
 * player picks by mutating stats or delegating to WeaponSystem.
 */
export class UpgradeSystem {
  constructor(private readonly weapons: WeaponSystem) {}

  /**
   * `ownedPassives` (stack ledger, id -> count - typically GameState.ownedPassives)
   * is required so the pool can skip any passive already at its `maxStacks` cap.
   */
  rollChoices(rng: () => number, ownedPassives: Map<string, number>, count = 3): UpgradeOption[] {
    const pool: UpgradeOption[] = [];

    const ownedIds = new Set(this.weapons.listOwned().map((w) => w.id));
    if (this.weapons.ownedCount() < this.weapons.maxSlots) {
      for (const entry of WEAPON_ROSTER) {
        if (ownedIds.has(entry.id)) continue;
        pool.push({
          id: entry.id,
          name: entry.name,
          description: `Unlock ${entry.name} - a new attack.`,
          kind: 'new-weapon',
        });
      }
    }

    for (const owned of this.weapons.listOwned()) {
      if (owned.level >= owned.maxLevel) continue;
      pool.push({
        id: owned.id,
        name: owned.name,
        description: `Level up ${owned.name} to level ${owned.level + 1}.`,
        kind: 'weapon-level',
      });
    }

    for (const passive of PASSIVE_DEFS) {
      const owned = ownedPassives.get(passive.id) ?? 0;
      if (owned >= passive.maxStacks) continue;
      pool.push({
        id: passive.id,
        name: passive.name,
        description: passive.description,
        kind: 'passive',
      });
    }

    // Fisher-Yates partial shuffle routed through the seeded rng, then take the front slice.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    return pool.slice(0, Math.min(count, pool.length));
  }

  /** `ownedPassives` (typically GameState.ownedPassives) is incremented in place when a passive is picked, so WeaponSystem's evolution gate can see it. */
  apply(option: UpgradeOption, stats: PlayerStats, ownedPassives: Map<string, number>): void {
    if (option.kind === 'new-weapon') {
      this.weapons.addWeapon(option.id);
    } else if (option.kind === 'weapon-level') {
      this.weapons.levelUp(option.id);
    } else {
      const def = PASSIVE_DEFS.find((p) => p.id === option.id);
      def?.apply(stats);
      ownedPassives.set(option.id, (ownedPassives.get(option.id) ?? 0) + 1);
      gameEvents.emit('passiveGained', { id: option.id, name: option.name });
    }
    gameEvents.emit('upgradeChosen', { id: option.id, name: option.name });
  }
}
