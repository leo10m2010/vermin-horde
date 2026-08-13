import { totalLuck } from '../utils/luck';

/**
 * DROP TABLE - what a destroyed breakable leaves behind.
 *
 * Deliberately a data table rather than a chain of `if (rng() < x)` branches
 * scattered through Game.ts: adding a new drop, retuning a weight, or gating
 * something behind a level is a one-line edit here, and the whole
 * distribution can be simulated offline (see the drop-table test).
 */

export type PickupKind = 'gold' | 'ration' | 'vacuum' | 'freeze' | 'purge' | 'fortune';

export interface DropDef {
  id: PickupKind;
  /** Shown in the pickup toast. English source string - see i18n/translations.ts. */
  name: string;
  /** Atlas clip for the world sprite. */
  clip: string;
  /** Relative weight before any modifiers. */
  baseWeight: number;
  /** Luck nudges this drop's weight upward when true. Gold deliberately does NOT scale,
   * so a lucky build gains rare drops without ever losing its common income. */
  affectedByLuck: boolean;
  /** How strongly luck scales this entry. Higher = rarer things benefit more. */
  luckScale: number;
  /** Player level required before this can appear at all. */
  minLevel: number;
}

/**
 * Weights are relative. `nothing` is a real entry rather than a special case,
 * which keeps "most crates give you something small, some give you nothing"
 * expressible in the same table as everything else.
 */
export const NOTHING_WEIGHT = 26;

export const DROP_TABLE: DropDef[] = [
  { id: 'gold', name: 'Gold', clip: 'pickup_gold', baseWeight: 46, affectedByLuck: false, luckScale: 0, minLevel: 0 },
  { id: 'ration', name: "Hunter's Ration", clip: 'pickup_ration', baseWeight: 20, affectedByLuck: true, luckScale: 0.35, minLevel: 0 },
  { id: 'freeze', name: 'Sepulchral Frost', clip: 'pickup_freeze', baseWeight: 5, affectedByLuck: true, luckScale: 1.1, minLevel: 3 },
  { id: 'vacuum', name: 'Soul Call', clip: 'pickup_vacuum', baseWeight: 5, affectedByLuck: true, luckScale: 1.1, minLevel: 3 },
  { id: 'fortune', name: 'Fortune Coin', clip: 'pickup_fortune', baseWeight: 1.6, affectedByLuck: true, luckScale: 1.8, minLevel: 5 },
  { id: 'purge', name: 'Purge Bell', clip: 'pickup_purge', baseWeight: 1.2, affectedByLuck: true, luckScale: 1.8, minLevel: 6 },
];

/**
 * Rolls one drop. Returns null when the roll lands on "nothing".
 *
 * Luck multiplies only the entries that opt in, and through the same
 * `totalLuck` curve the rest of the game uses, so a lucky run meets more
 * rations and relics without common gold ever drying up - and nothing is ever
 * guaranteed, however high luck goes.
 */
export function rollDrop(rng: () => number, luck: number, playerLevel: number): DropDef | null {
    const luckMult = totalLuck(luck);
  let total = NOTHING_WEIGHT;
  const eligible: Array<{ def: DropDef; weight: number }> = [];
  for (const def of DROP_TABLE) {
    if (playerLevel < def.minLevel) continue;
    const weight = def.affectedByLuck ? def.baseWeight * (1 + (luckMult - 1) * def.luckScale) : def.baseWeight;
    eligible.push({ def, weight });
    total += weight;
  }

  let roll = rng() * total;
  for (const entry of eligible) {
    roll -= entry.weight;
    if (roll <= 0) return entry.def;
  }
  return null; // fell through into the `nothing` slice
}

/**
 * Effect magnitudes, kept beside the table they belong to so drops can be
 * retuned in one file. Gold lives here too because MetaProgression - which
 * owns the permanent gold multiplier - credits the coin pickup itself.
 */
export const GOLD_PICKUP_VALUE = 15;
/** Never exceeds maxHealth; the director clamps. */
export const RATION_HEAL = 30;
export const FREEZE_SECONDS = 3.5;
/** Large enough to clear any regular enemy, applied through the normal damage API. */
export const PURGE_DAMAGE = 100000;
export const FORTUNE_LUCK = 0.05;

export function findDrop(id: PickupKind): DropDef | undefined {
  return DROP_TABLE.find((d) => d.id === id);
}
