import type { PlayerStats } from './GameState';

/**
 * A selectable character: one starting weapon plus a build-defining passive
 * trait. Every character applies a one-time bonus via applyTrait() at run
 * start, and some also scale further through onLevelUp(). As a set the
 * roster spans the range of trait archetypes seen in the genre:
 *  - Brakka: flat one-time stat tradeoff (buff + honest malus), no scaling.
 *  - Vex: front-loaded bonus that decays down to a smaller permanent bonus
 *    over the first few levels, bundled with a permanent malus.
 *  - Orin: small uncapped bonus that keeps compounding every level, no cap.
 *  - Pyra: milestone-stepped bonus that grows every N levels and hard-caps.
 *  - Lucca: flat one-time bonus plus a big bonus unlocked only once a
 *    specific level threshold is crossed.
 *  - Dess: flat one-time bonus only, spread across several stats.
 * Mirrors how Vampire-Survivors-style character rosters work without
 * reusing any of that game's actual character names.
 */
export interface CharacterDef {
  id: string;
  name: string;
  title: string; // short flavor subtitle, e.g. "The Grave Digger"
  startWeaponId: string;
  traitDescription: string; // human-readable, shown on the select card
  spriteKey: string; // clip-name prefix - see SpriteLibraryCharacters.ts
  /**
   * Height of this character's WEAPON HAND as a fraction of their sprite
   * height (0 = feet, 1 = top of head). Weapons that must visibly originate
   * from the hand - the whip cord, and any future cast/muzzle effect - read
   * it through `WeaponContext.castAnchorY` instead of assuming one height for
   * everyone. The six sprites genuinely differ here: Brakka grips low at his
   * hip (0.38) while Vex holds a dagger up by their shoulder (0.77), so a
   * single shared constant is visibly wrong for somebody either way.
   * Measured from each character's own grid in SpriteLibraryCharacters.ts.
   */
  castAnchor: number;
  applyTrait: (stats: PlayerStats) => void; // mutate stats once at run start
  /**
   * Optional: called once per level gained (after applyTrait's one-time
   * bonus), so a character's trait can keep scaling through the run instead
   * of being a flat start-of-run bump. Mirrors the range of VS character
   * archetypes - uncapped per-level scaling, milestone-stepped scaling with
   * a hard cap, unlock-gated bonuses at a specific level, etc. `newLevel` is
   * the level just reached.
   *
   * IMPORTANT: the game may batch several level-ups gained from one big XP
   * pickup into a single event, so `newLevel` can jump by more than 1 since
   * the previous call - never assume it increments one at a time. Hooks
   * below express their scaling as a pure function of the absolute level and
   * apply only the delta since the last call, so batched jumps still land
   * the correct total. Each hook's tracking state is reset from applyTrait
   * so nothing leaks across a restart (applyTrait always runs once at the
   * start of every run, before any levelUp event can fire).
   */
  onLevelUp?: (stats: PlayerStats, newLevel: number) => void;
}

// --- Orin Warden: uncapped per-level area growth -----------------------
// Tiny compounding bonus every single level, never capped - rewards long
// survival on top of the immediate one-time bonus.
const WARDEN_PER_LEVEL_AREA = 1.01; // +1% area, compounds, no ceiling
let wardenLastLevel = 1;

// --- Pyra Cinderborn: milestone-stepped damage, hard-capped -------------
// +5% damage every 5 levels reached, capping out after the 4th milestone
// (level 20) so the bonus plateaus instead of growing forever.
const CINDERBORN_MILESTONE_STEP_LEVELS = 5;
const CINDERBORN_MILESTONE_STEP_BONUS = 1.05;
const CINDERBORN_MAX_MILESTONES = 4; // caps at level 20
let cinderbornMilestonesApplied = 0;

// --- Vex Redline: front-loaded burst that decays to a smaller permanent
// bonus by level 6, bundled with a permanent health tradeoff (unaffected
// by the decay - the malus is the honest price of the early burst).
const REDLINE_SPEED_BURST = 1.3; // +30% move speed at level 1
const REDLINE_SPEED_FLOOR = 1.08; // decays down to +8% by level 6
const REDLINE_CRIT_BURST = 0.2; // +20% crit chance at level 1
const REDLINE_CRIT_FLOOR = 0.05; // decays down to +5% by level 6
const REDLINE_DECAY_LEVELS = 6; // fully decayed by this level
let redlineLastSpeedFactor = REDLINE_SPEED_BURST;
let redlineLastCritBonus = REDLINE_CRIT_BURST;

function redlineSpeedFactorAt(level: number): number {
  const t = Math.min(Math.max(level, 1), REDLINE_DECAY_LEVELS);
  return (
    REDLINE_SPEED_BURST -
    ((REDLINE_SPEED_BURST - REDLINE_SPEED_FLOOR) * (t - 1)) / (REDLINE_DECAY_LEVELS - 1)
  );
}

function redlineCritBonusAt(level: number): number {
  const t = Math.min(Math.max(level, 1), REDLINE_DECAY_LEVELS);
  return (
    REDLINE_CRIT_BURST -
    ((REDLINE_CRIT_BURST - REDLINE_CRIT_FLOOR) * (t - 1)) / (REDLINE_DECAY_LEVELS - 1)
  );
}

// --- Lucca Fortune: unlock-gated jackpot at level 20 ---------------------
const FORTUNE_JACKPOT_LEVEL = 20;
let fortuneJackpotUnlocked = false;

export const CHARACTERS: CharacterDef[] = [
  // Tanky slow bruiser - melee whip-style starter, trades speed for survivability.
  // Archetype: flat one-time stat tradeoff (buff + honest malus), no scaling.
  {
    id: 'thornguard',
    name: 'Brakka Thornguard',
    title: 'The Rampart',
    startWeaponId: 'whip_strike',
    traitDescription: '+40% max health, -15% move speed',
    spriteKey: 'thornguard',
    castAnchor: 0.38,
    applyTrait: (stats: PlayerStats) => {
      stats.maxHealth *= 1.4;
      stats.health = stats.maxHealth;
      stats.moveSpeed *= 0.85;
    },
  },

  // Glass-cannon speedster - fast knife starter, high mobility and crit but fragile.
  // Archetype: front-loaded decaying burst (speed/crit) bundled with a permanent
  // health tradeoff that does NOT decay - you pay for the redline every run.
  {
    id: 'redline',
    name: 'Vex Redline',
    title: 'The Redline Runner',
    startWeaponId: 'knife_throw',
    traitDescription:
      '+30% move speed, +20% crit chance, -20% max health. Speed and crit bonuses fade down to +8%/+5% by level 6 (the health penalty is permanent).',
    spriteKey: 'redline',
    castAnchor: 0.77,
    applyTrait: (stats: PlayerStats) => {
      stats.moveSpeed *= REDLINE_SPEED_BURST;
      stats.critChance += REDLINE_CRIT_BURST;
      stats.maxHealth *= 0.8;
      stats.health = stats.maxHealth;
      redlineLastSpeedFactor = REDLINE_SPEED_BURST;
      redlineLastCritBonus = REDLINE_CRIT_BURST;
    },
    onLevelUp: (stats: PlayerStats, newLevel: number) => {
      const targetSpeedFactor = redlineSpeedFactorAt(newLevel);
      if (targetSpeedFactor !== redlineLastSpeedFactor) {
        stats.moveSpeed *= targetSpeedFactor / redlineLastSpeedFactor;
        redlineLastSpeedFactor = targetSpeedFactor;
      }
      const targetCritBonus = redlineCritBonusAt(newLevel);
      if (targetCritBonus !== redlineLastCritBonus) {
        stats.critChance += targetCritBonus - redlineLastCritBonus;
        redlineLastCritBonus = targetCritBonus;
      }
    },
  },

  // Summoner/orbiter specialist - starts with the orbiting blades, boosts their reach.
  // Archetype: uncapped continuous per-level scaling - small, no ceiling, rewards
  // surviving deep into a run.
  {
    id: 'warden',
    name: 'Orin Warden',
    title: 'The Circling Warden',
    startWeaponId: 'orbiter_blades',
    traitDescription: '+25% area. +1% area every level thereafter, uncapped.',
    spriteKey: 'warden',
    castAnchor: 0.49,
    applyTrait: (stats: PlayerStats) => {
      stats.areaMultiplier *= 1.25;
      wardenLastLevel = 1;
    },
    onLevelUp: (stats: PlayerStats, newLevel: number) => {
      const delta = newLevel - wardenLastLevel;
      if (delta <= 0) return;
      stats.areaMultiplier *= Math.pow(WARDEN_PER_LEVEL_AREA, delta);
      wardenLastLevel = newLevel;
    },
  },

  // Pyromancer - AoE fire starter, boosts both area and damage for blast weapons.
  // Archetype: milestone-stepped scaling with a hard cap - grows every 5 levels,
  // plateaus at level 20.
  {
    id: 'cinderborn',
    name: 'Pyra Cinderborn',
    title: 'The Cinderborn',
    startWeaponId: 'ember_wand',
    traitDescription:
      '+15% area, +15% damage. +5% damage every 5 levels, capping at level 20 (~+40% damage total).',
    spriteKey: 'cinderborn',
    castAnchor: 0.45,
    applyTrait: (stats: PlayerStats) => {
      stats.areaMultiplier *= 1.15;
      stats.damageMultiplier *= 1.15;
      cinderbornMilestonesApplied = 0;
    },
    onLevelUp: (stats: PlayerStats, newLevel: number) => {
      const milestonesReached = Math.min(
        CINDERBORN_MAX_MILESTONES,
        Math.floor(newLevel / CINDERBORN_MILESTONE_STEP_LEVELS)
      );
      const gained = milestonesReached - cinderbornMilestonesApplied;
      if (gained <= 0) return;
      stats.damageMultiplier *= Math.pow(CINDERBORN_MILESTONE_STEP_BONUS, gained);
      cinderbornMilestonesApplied = milestonesReached;
    },
  },

  // Lucky scavenger - magic wand starter, boosts luck, pickup range, and xp gain.
  // Archetype: unlock-gated milestone - a big one-shot payoff that only kicks in
  // once level 20 is reached, on top of the immediate flat bonus.
  {
    id: 'fortune',
    name: "Lucca Fortune",
    title: "Fortune's Hand",
    startWeaponId: 'magic_wand',
    traitDescription:
      "+0.2 luck, +35% magnet radius, +15% XP gain. Level 20: Jackpot - +0.35 luck, +10% crit chance.",
    spriteKey: 'fortune',
    castAnchor: 0.68,
    applyTrait: (stats: PlayerStats) => {
      stats.luck += 0.2;
      stats.magnetRadius *= 1.35;
      stats.xpGainMultiplier *= 1.15;
      fortuneJackpotUnlocked = false;
    },
    onLevelUp: (stats: PlayerStats, newLevel: number) => {
      if (fortuneJackpotUnlocked || newLevel < FORTUNE_JACKPOT_LEVEL) return;
      stats.luck += 0.35;
      stats.critChance += 0.1;
      fortuneJackpotUnlocked = true;
    },
  },

  // Hybrid/balanced starter - garlic aura starter, small bonus across several stats.
  // Archetype: flat one-time bonus only, spread across stats, no malus, no scaling.
  {
    id: 'steadyhand',
    name: 'Dess Steadyhand',
    title: 'The Steady Hand',
    startWeaponId: 'garlic_aura',
    traitDescription: '+10% max health, +10% damage, +10% move speed, +10% cooldown reduction',
    spriteKey: 'steadyhand',
    castAnchor: 0.55,
    applyTrait: (stats: PlayerStats) => {
      stats.maxHealth *= 1.1;
      stats.health = stats.maxHealth;
      stats.damageMultiplier *= 1.1;
      stats.moveSpeed *= 1.1;
      stats.cooldownMultiplier *= 0.9;
    },
  },
];
