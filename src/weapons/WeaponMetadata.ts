// Descriptive metadata layer over the 11 weapons. This is READ-ONLY data for
// UI/Character-Select/level-up cards - it never drives gameplay logic itself
// (each weapon's own update()/levelUp() in this folder remains the single
// source of truth for numbers). Keeping the two in sync is a discipline, not
// an abstraction: when a weapon's per-level behavior changes, update its
// entry here too so the level-up card never lies about what a pick does.

export type AttackPattern =
  | 'FORWARD'
  | 'FRONT_BACK'
  | 'NEAREST'
  | 'RANDOM_TARGET'
  | 'HOMING'
  | 'ORBIT'
  | 'AURA'
  | 'BOOMERANG'
  | 'WANDER'
  | 'GROUND_ZONE'
  | 'FAN'
  | 'RADIAL';

/** One perceptible step in a weapon's 1-8 climb: reaching `level` changes something you can see, not just a hidden number. */
export interface WeaponLevelStep {
  level: number; // the level being reached (2..8)
  /** Short headline for the level-up card, e.g. "+1 proyectil". No trailing period. */
  summary: string;
  /** "1 → 2 proyectiles" style before/after readout, or '' when there's nothing countable to show. */
  detail: string;
}

export interface WeaponMetadata {
  id: string;
  name: string;
  iconKey: string; // Icons.ts DRAWERS key
  /** One-line flavor description shown on the "unlock new weapon" card. */
  description: string;
  attackPattern: AttackPattern;
  /** Human-readable direction/targeting hint, e.g. "Dirección de movimiento". */
  directionLabel: string;
  maxLevel: number;
  evolvedName: string;
  /** Human-readable name of the passive that gates evolution, e.g. "Windforce". */
  evolutionRequirementName: string;
  evolutionDescription: string;
  /** Steps for reaching level 2 through maxLevel (7 entries for maxLevel 8). */
  levelSteps: WeaponLevelStep[];
  compatibleWithExtraProjectiles: boolean;
  tags: string[];
}

export const WEAPON_METADATA: Record<string, WeaponMetadata> = {
  magic_wand: {
    id: 'magic_wand',
    name: 'Magic Wand',
    iconKey: 'magic_wand',
    description: 'Auto-apunta y dispara al enemigo más cercano en rango. Fiable, sin dirección que gestionar.',
    attackPattern: 'NEAREST',
    directionLabel: 'Auto-objetivo: enemigo más cercano',
    maxLevel: 8,
    evolvedName: 'Staff of the Archmage',
    evolutionRequirementName: 'Quick Hands',
    evolutionDescription: 'Cadencia mucho más rápida y cada impacto salta a un segundo enemigo cercano.',
    levelSteps: [
      { level: 2, summary: '+daño', detail: '' },
      { level: 3, summary: '+daño', detail: '' },
      { level: 4, summary: '+1 proyectil', detail: '1 → 2 proyectiles' },
      { level: 5, summary: '+daño, -cooldown', detail: '' },
      { level: 6, summary: '+daño', detail: '' },
      { level: 7, summary: '+1 proyectil', detail: '2 → 3 proyectiles' },
      { level: 8, summary: '+perforación', detail: '0 → 1 enemigo perforado' },
    ],
    compatibleWithExtraProjectiles: true,
    tags: ['proyectil', 'auto-objetivo', 'inicial'],
  },
  knife_throw: {
    id: 'knife_throw',
    name: 'Knife',
    iconKey: 'knife_throw',
    description: 'Cuchillos veloces lanzados en tu dirección de movimiento. El poder puramente direccional.',
    attackPattern: 'FORWARD',
    directionLabel: 'Dirección de movimiento (última usada si estás quieto)',
    maxLevel: 8,
    evolvedName: 'Thousand Blades',
    evolutionRequirementName: 'Windforce',
    evolutionDescription: 'Los cuchillos se abren en un abanico amplio en vez de un cono estrecho, y perforan.',
    levelSteps: [
      { level: 2, summary: '+1 cuchillo', detail: '1 → 2 proyectiles' },
      { level: 3, summary: '+velocidad y daño', detail: '' },
      { level: 4, summary: '+1 cuchillo', detail: '2 → 3 proyectiles' },
      { level: 5, summary: '-cooldown', detail: 'Lanzamiento más frecuente' },
      { level: 6, summary: '+perforación', detail: '0 → 1 enemigo perforado' },
      { level: 7, summary: '+1 cuchillo', detail: '3 → 4 proyectiles' },
      { level: 8, summary: 'Versión máxima', detail: '+daño y velocidad de lanzamiento' },
    ],
    compatibleWithExtraProjectiles: true,
    tags: ['proyectil', 'direccional', 'multi-disparo'],
  },
  axe_throw: {
    id: 'axe_throw',
    name: 'Axe',
    iconKey: 'axe_throw',
    description: 'Hacha arrojada en tu dirección de movimiento, cae en parábola y perfora varios enemigos.',
    attackPattern: 'FORWARD',
    directionLabel: 'Dirección de movimiento (última usada si estás quieto)',
    maxLevel: 8,
    evolvedName: 'Whirlwind Axe',
    evolutionRequirementName: 'Wide Reach',
    evolutionDescription: 'Lanza un segundo hacha simultánea en ángulo abierto, doblando la cobertura.',
    levelSteps: [
      { level: 2, summary: '+daño', detail: '' },
      { level: 3, summary: '-cooldown', detail: '' },
      { level: 4, summary: '+perforación', detail: '2 → 3 enemigos perforados' },
      { level: 5, summary: '+daño', detail: '' },
      { level: 6, summary: '-cooldown', detail: '' },
      { level: 7, summary: '+perforación', detail: '3 → 4 enemigos perforados' },
      { level: 8, summary: 'Versión máxima', detail: '+daño y velocidad de vuelo' },
    ],
    compatibleWithExtraProjectiles: true,
    tags: ['proyectil', 'direccional', 'perforante', 'arco visual'],
  },
  fireball: {
    id: 'fireball',
    name: 'Fireball',
    iconKey: 'fireball',
    description: 'Proyectil pesado con seguimiento suave que explota en área al impactar.',
    attackPattern: 'HOMING',
    directionLabel: 'Persigue al objetivo trabado en vuelo',
    maxLevel: 8,
    evolvedName: 'Inferno Core',
    evolutionRequirementName: 'Power Charm',
    evolutionDescription: 'Explosión mucho mayor y cada impacto directo drena vida hacia ti.',
    levelSteps: [
      { level: 2, summary: '+daño', detail: '' },
      { level: 3, summary: '+radio de explosión', detail: '' },
      { level: 4, summary: '-cooldown', detail: '' },
      { level: 5, summary: '+daño', detail: '' },
      { level: 6, summary: '+radio de explosión', detail: '' },
      { level: 7, summary: '-cooldown', detail: '' },
      { level: 8, summary: 'Versión máxima', detail: '+daño y radio de explosión' },
    ],
    compatibleWithExtraProjectiles: false,
    tags: ['proyectil', 'área', 'seguimiento'],
  },
  garlic_aura: {
    id: 'garlic_aura',
    name: 'Garlic Aura',
    iconKey: 'garlic_aura',
    description: 'Aura defensiva de daño continuo alrededor tuyo. Sin dirección: te protege en 360°.',
    attackPattern: 'AURA',
    directionLabel: '360° alrededor del jugador',
    maxLevel: 8,
    evolvedName: 'Soul Eater',
    evolutionRequirementName: 'Regeneration',
    evolutionDescription: 'El aura duplica su daño y drena vida de todo lo que quema.',
    levelSteps: [
      { level: 2, summary: '+radio', detail: '' },
      { level: 3, summary: '+daño por tick', detail: '' },
      { level: 4, summary: '+radio', detail: '' },
      { level: 5, summary: '+frecuencia', detail: 'Tick más rápido' },
      { level: 6, summary: '+daño por tick', detail: '' },
      { level: 7, summary: '+radio', detail: '' },
      { level: 8, summary: 'Versión máxima', detail: '+daño y radio del aura' },
    ],
    compatibleWithExtraProjectiles: false,
    tags: ['aura', 'defensivo', 'inicial'],
  },
  orbiter_blades: {
    id: 'orbiter_blades',
    name: 'Holy Blades',
    iconKey: 'orbiter_blades',
    description: 'Hojas orbitando alrededor tuyo en formación uniforme. Cuantas más, mejor cobertura 360°.',
    attackPattern: 'ORBIT',
    directionLabel: 'Órbita 360° alrededor del jugador',
    maxLevel: 8,
    evolvedName: 'Aureole Ring',
    evolutionRequirementName: 'Ammo Satchel',
    evolutionDescription: '2 hojas adicionales y un pulso radial periódico que golpea más allá del anillo.',
    levelSteps: [
      { level: 2, summary: '+1 hoja', detail: '1 → 2 hojas' },
      { level: 3, summary: '+daño', detail: '' },
      { level: 4, summary: '+1 hoja', detail: '2 → 3 hojas' },
      { level: 5, summary: '+daño', detail: '' },
      { level: 6, summary: '+1 hoja', detail: '3 → 4 hojas' },
      { level: 7, summary: '+daño', detail: '' },
      { level: 8, summary: '+1 hoja', detail: '4 → 5 hojas' },
    ],
    compatibleWithExtraProjectiles: false,
    tags: ['orbital', '360°', 'inicial'],
  },
  whip_strike: {
    id: 'whip_strike',
    name: 'Whip Strike',
    iconKey: 'whip_strike',
    description: 'Golpe cuerpo a cuerpo frontal. Al mejorar, desbloquea un segundo golpe por detrás.',
    attackPattern: 'FRONT_BACK',
    directionLabel: 'Frontal (nivel 2+: también por detrás)',
    maxLevel: 8,
    evolvedName: "Serpent's Coil",
    evolutionRequirementName: 'Vitality Ring',
    evolutionDescription: 'Mayor alcance y daño, y cada golpe empuja hacia atrás a los enemigos golpeados.',
    levelSteps: [
      { level: 2, summary: 'Ataque trasero', detail: 'Ahora golpea delante Y detrás' },
      { level: 3, summary: '+daño', detail: '' },
      { level: 4, summary: '+alcance', detail: '' },
      { level: 5, summary: '-cooldown', detail: '' },
      { level: 6, summary: '+anchura', detail: 'Banda de golpe más ancha' },
      { level: 7, summary: '+daño y área', detail: '' },
      { level: 8, summary: 'Versión máxima', detail: '+daño, alcance y anchura' },
    ],
    compatibleWithExtraProjectiles: false,
    tags: ['melee', 'direccional', 'inicial'],
  },
  arc_cross: {
    id: 'arc_cross',
    name: 'Arc Cross',
    iconKey: 'arc_cross',
    description: 'Bumerán que vuela hacia el enemigo más cercano, regresa hacia ti y orbita brevemente.',
    attackPattern: 'BOOMERANG',
    directionLabel: 'Sale hacia el objetivo, regresa al jugador',
    maxLevel: 8,
    evolvedName: 'Radiant Cross',
    evolutionRequirementName: 'Four-Leaf Clover',
    evolutionDescription: 'Persigue su objetivo original en la salida y perfora dos enemigos más.',
    levelSteps: [
      { level: 2, summary: '+daño', detail: '' },
      { level: 3, summary: '-cooldown', detail: '' },
      { level: 4, summary: '+perforación', detail: '2 → 3 enemigos perforados' },
      { level: 5, summary: '+daño', detail: '' },
      { level: 6, summary: '-cooldown', detail: '' },
      { level: 7, summary: '+perforación', detail: '3 → 4 enemigos perforados' },
      { level: 8, summary: 'Versión máxima', detail: '+daño y radio de retorno' },
    ],
    compatibleWithExtraProjectiles: true,
    tags: ['proyectil', 'retorno', 'perforante'],
  },
  ember_wand: {
    id: 'ember_wand',
    name: 'Ember Wand',
    iconKey: 'ember_wand',
    description: 'Golpe pesado y poco frecuente contra un enemigo aleatorio en rango. No es auto-apuntado al más cercano.',
    attackPattern: 'RANDOM_TARGET',
    directionLabel: 'Objetivo aleatorio en rango',
    maxLevel: 8,
    evolvedName: 'Cataclysm Wand',
    evolutionRequirementName: 'Killer Instinct',
    evolutionDescription: 'Lanza una segunda brasa a otro objetivo distinto en el mismo instante, y perfora.',
    levelSteps: [
      { level: 2, summary: '+daño', detail: '' },
      { level: 3, summary: '-cooldown', detail: '' },
      { level: 4, summary: '+daño', detail: '' },
      { level: 5, summary: '+daño', detail: '' },
      { level: 6, summary: '-cooldown', detail: '' },
      { level: 7, summary: '+daño', detail: '' },
      { level: 8, summary: 'Versión máxima', detail: '+daño y velocidad de proyectil' },
    ],
    compatibleWithExtraProjectiles: false,
    tags: ['proyectil', 'aleatorio', 'golpe pesado'],
  },
  rune_shard: {
    id: 'rune_shard',
    name: 'Rune Shard',
    iconKey: 'rune_shard',
    description: 'Esquirla veloz que cambia de rumbo aleatoriamente y perfora todo lo que cruza.',
    attackPattern: 'WANDER',
    directionLabel: 'Rumbo inicial hacia el objetivo, luego cambia de dirección',
    maxLevel: 8,
    evolvedName: 'Rune Storm',
    evolutionRequirementName: 'Swift Boots',
    evolutionDescription: 'Las esquirlas cazan activamente al enemigo más cercano en cada cambio de rumbo.',
    levelSteps: [
      { level: 2, summary: '+daño', detail: '' },
      { level: 3, summary: '+perforación', detail: '6 → 7 enemigos perforados' },
      { level: 4, summary: '-cooldown', detail: '' },
      { level: 5, summary: '+daño', detail: '' },
      { level: 6, summary: '+perforación', detail: '7 → 8 enemigos perforados' },
      { level: 7, summary: '-cooldown', detail: '' },
      { level: 8, summary: 'Versión máxima', detail: '+daño y duración' },
    ],
    compatibleWithExtraProjectiles: true,
    tags: ['proyectil', 'errático', 'perforante'],
  },
  hex_flask: {
    id: 'hex_flask',
    name: 'Hex Flask',
    iconKey: 'hex_flask',
    description: 'Frasco lanzado en arco que aterriza y deja una zona de daño continuo en el suelo.',
    attackPattern: 'GROUND_ZONE',
    directionLabel: 'Arco hacia el objetivo más cercano; zona fija al aterrizar',
    maxLevel: 8,
    evolvedName: "Witch's Cauldron",
    evolutionRequirementName: 'Timeless Hourglass',
    evolutionDescription: 'Se rompe en una segunda zona satélite al aterrizar, duplicando la cobertura del suelo.',
    levelSteps: [
      { level: 2, summary: '+radio de zona', detail: '' },
      { level: 3, summary: '+duración', detail: '' },
      { level: 4, summary: '+daño por tick', detail: '' },
      { level: 5, summary: '-cooldown', detail: '' },
      { level: 6, summary: '+radio de zona', detail: '' },
      { level: 7, summary: '+duración', detail: '' },
      { level: 8, summary: 'Versión máxima', detail: '+daño, radio y duración' },
    ],
    compatibleWithExtraProjectiles: false,
    tags: ['zona', 'lanzamiento en arco', 'daño en el tiempo'],
  },
};

/** Weapon id -> id of the passive (UpgradeSystem's PASSIVE_DEFS) that gates its evolution - mirrors each weapon class's own `evolutionRequiresPassive` field, duplicated here so UI code (pause/build panel) can check "does the player already own it" without importing the weapon classes themselves. */
export const WEAPON_EVOLUTION_PASSIVE_ID: Record<string, string> = {
  magic_wand: 'passive_cooldown',
  knife_throw: 'passive_proj_speed',
  axe_throw: 'passive_area',
  fireball: 'passive_damage',
  garlic_aura: 'passive_regen',
  orbiter_blades: 'passive_extra_projectile',
  whip_strike: 'passive_health',
  arc_cross: 'passive_luck',
  ember_wand: 'passive_crit',
  rune_shard: 'passive_speed',
  hex_flask: 'passive_duration',
};

export function getWeaponMetadata(id: string): WeaponMetadata | undefined {
  return WEAPON_METADATA[id];
}

/** The step describing what reaching `toLevel` changes, or undefined for level 1 (baseline) / out of range. */
export function getWeaponLevelStep(id: string, toLevel: number): WeaponLevelStep | undefined {
  return WEAPON_METADATA[id]?.levelSteps.find((s) => s.level === toLevel);
}
