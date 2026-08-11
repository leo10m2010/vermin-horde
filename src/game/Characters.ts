import type { PlayerStats } from './GameState';

/**
 * A selectable character: one starting weapon plus one build-defining
 * passive trait applied once at run start (after createDefaultStats()).
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
  applyTrait: (stats: PlayerStats) => void; // mutate stats once at run start
}

export const CHARACTERS: CharacterDef[] = [
  // Tanky slow bruiser - melee whip-style starter, trades speed for survivability.
  {
    id: 'thornguard',
    name: 'Brakka Thornguard',
    title: 'The Rampart',
    startWeaponId: 'whip_strike',
    traitDescription: '+40% max health, -15% move speed',
    spriteKey: 'thornguard',
    applyTrait: (stats: PlayerStats) => {
      stats.maxHealth *= 1.4;
      stats.health = stats.maxHealth;
      stats.moveSpeed *= 0.85;
    },
  },

  // Glass-cannon speedster - fast knife starter, high mobility and crit but fragile.
  {
    id: 'redline',
    name: 'Vex Redline',
    title: 'The Redline Runner',
    startWeaponId: 'knife_throw',
    traitDescription: '+25% move speed, +15% crit chance, -20% max health',
    spriteKey: 'redline',
    applyTrait: (stats: PlayerStats) => {
      stats.moveSpeed *= 1.25;
      stats.critChance += 0.15;
      stats.maxHealth *= 0.8;
      stats.health = stats.maxHealth;
    },
  },

  // Summoner/orbiter specialist - starts with the orbiting blades, boosts their reach.
  {
    id: 'warden',
    name: 'Orin Warden',
    title: 'The Circling Warden',
    startWeaponId: 'orbiter_blades',
    traitDescription: '+35% area',
    spriteKey: 'warden',
    applyTrait: (stats: PlayerStats) => {
      stats.areaMultiplier *= 1.35;
    },
  },

  // Pyromancer - AoE fire starter, boosts both area and damage for blast weapons.
  {
    id: 'cinderborn',
    name: 'Pyra Cinderborn',
    title: 'The Cinderborn',
    startWeaponId: 'ember_wand',
    traitDescription: '+20% area, +20% damage',
    spriteKey: 'cinderborn',
    applyTrait: (stats: PlayerStats) => {
      stats.areaMultiplier *= 1.2;
      stats.damageMultiplier *= 1.2;
    },
  },

  // Lucky scavenger - magic wand starter, boosts luck, pickup range, and xp gain.
  {
    id: 'fortune',
    name: "Lucca Fortune",
    title: "Fortune's Hand",
    startWeaponId: 'magic_wand',
    traitDescription: '+0.25 luck, +40% magnet radius, +20% XP gain',
    spriteKey: 'fortune',
    applyTrait: (stats: PlayerStats) => {
      stats.luck += 0.25;
      stats.magnetRadius *= 1.4;
      stats.xpGainMultiplier *= 1.2;
    },
  },

  // Hybrid/balanced starter - garlic aura starter, small bonus across several stats.
  {
    id: 'steadyhand',
    name: 'Dess Steadyhand',
    title: 'The Steady Hand',
    startWeaponId: 'garlic_aura',
    traitDescription: '+10% max health, +10% damage, +10% move speed, +10% cooldown reduction',
    spriteKey: 'steadyhand',
    applyTrait: (stats: PlayerStats) => {
      stats.maxHealth *= 1.1;
      stats.health = stats.maxHealth;
      stats.damageMultiplier *= 1.1;
      stats.moveSpeed *= 1.1;
      stats.cooldownMultiplier *= 0.9;
    },
  },
];
