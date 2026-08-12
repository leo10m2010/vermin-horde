/**
 * SINGLE SOURCE OF TRUTH for every weapon's level 1-8 numbers.
 *
 * Before this module the real numbers lived inline in each weapon's
 * `update()` as ad-hoc expressions (`BASE_DAMAGE + 2.2 * (level - 1)` etc.)
 * while `WeaponMetadata.ts` carried a hand-written prose description of what
 * each level supposedly did. Keeping those two in sync was pure discipline,
 * and they had already drifted - which is how a level-up card can promise
 * "+1 proyectil" for a level that actually only adds damage.
 *
 * Here each weapon instead declares an explicit per-level TABLE of the stats
 * that matter. Gameplay reads it (`effectAt`) and the level-up UI diffs it
 * (`describeLevelUp`), so a card physically cannot describe a change the
 * weapon does not make: the text is derived from the same numbers the
 * simulation uses.
 *
 * Adding a level effect = editing one row. The UI updates itself.
 */

/**
 * Every stat any weapon might step across levels. All optional except the
 * universal three, so each weapon's table only lists what it actually uses -
 * and `describeLevelUp` only ever reports fields that changed.
 */
export interface WeaponLevelEffect {
  /** Index signature so the whole bag can cross the test-hook boundary as plain data. */
  [key: string]: number | undefined;
  damage: number;
  cooldown: number;
  /** Countable projectiles/knives/axes launched per cast. */
  projectiles?: number;
  /** Whip only: how many horizontal sides are struck (1 = fixed side, 2 = both). */
  sides?: number;
  /** Orbiter only: blades in the ring. */
  blades?: number;
  /** Enemies a projectile passes through before despawning. */
  pierce?: number;
  /** Melee reach / zone radius / aura radius, in world units. */
  radius?: number;
  /** Whip only: half-thickness of the strike band. */
  halfWidth?: number;
  /** Projectile travel speed. */
  speed?: number;
  /** Persistent-zone or projectile lifetime, seconds. */
  duration?: number;
  /** Rune Shard only: how many times a shard changes heading. */
  turns?: number;
}

/** How a single field should be worded on a level-up card when it changes. */
interface FieldLabel {
  /** Headline, e.g. "+1 proyectil". `d` is the signed delta. */
  headline: (d: number) => string;
  /** "1 → 2 proyectiles" readout. */
  detail: (from: number, to: number) => string;
  /** Higher number = reported first when several fields change at once. */
  priority: number;
  /** true when a LOWER value is the improvement (cooldown). */
  lowerIsBetter?: boolean;
}

const FIELD_LABELS: Record<keyof WeaponLevelEffect, FieldLabel> = {
  sides: {
    headline: () => 'Nuevo ataque al lado opuesto',
    detail: (f, t) => (f === 1 && t === 2 ? '1 lado → ambos lados' : `${f} → ${t} lados`),
    priority: 100,
  },
  projectiles: {
    headline: (d) => (d > 0 ? `+${d} proyectil${d > 1 ? 'es' : ''}` : `${d} proyectiles`),
    detail: (f, t) => `${f} → ${t} proyectiles`,
    priority: 90,
  },
  blades: {
    headline: (d) => (d > 0 ? `+${d} hoja${d > 1 ? 's' : ''}` : `${d} hojas`),
    detail: (f, t) => `${f} → ${t} hojas`,
    priority: 90,
  },
  pierce: {
    headline: (d) => `+${d} perforación`,
    detail: (f, t) => `${f} → ${t} enemigos perforados`,
    priority: 70,
  },
  radius: {
    headline: () => '+área',
    detail: (f, t) => `radio ${f.toFixed(1)} → ${t.toFixed(1)}`,
    priority: 60,
  },
  halfWidth: {
    headline: () => '+anchura',
    detail: (f, t) => `grosor ${(f * 2).toFixed(1)} → ${(t * 2).toFixed(1)}`,
    priority: 55,
  },
  turns: {
    headline: (d) => `+${d} cambio${d > 1 ? 's' : ''} de rumbo`,
    detail: (f, t) => `${f} → ${t} desvíos`,
    priority: 50,
  },
  duration: {
    headline: () => '+duración',
    detail: (f, t) => `${f.toFixed(1)}s → ${t.toFixed(1)}s`,
    priority: 45,
  },
  speed: {
    headline: () => '+velocidad',
    detail: (f, t) => `${f.toFixed(0)} → ${t.toFixed(0)}`,
    priority: 30,
  },
  cooldown: {
    headline: () => '-cooldown',
    detail: (f, t) => `${f.toFixed(2)}s → ${t.toFixed(2)}s entre ataques`,
    priority: 40,
    lowerIsBetter: true,
  },
  damage: {
    headline: () => '+daño',
    detail: (f, t) => `${f.toFixed(0)} → ${t.toFixed(0)} de daño`,
    priority: 20,
  },
};

// ---------------------------------------------------------------------------
// Per-weapon level tables. Index 0 = level 1. Every row is explicit rather
// than a formula, so "what changes at level N" is readable at a glance and
// diffable by machine - which is the entire point.
// ---------------------------------------------------------------------------

/**
 * WHIP STRIKE. Lv1 strikes ONE fixed horizontal side; Lv2 unlocks the
 * opposite side (the headline upgrade of this weapon's identity). After that
 * the climb alternates damage / reach / cooldown / width so no two
 * consecutive levels feel like the same pick.
 */
const WHIP: WeaponLevelEffect[] = [
  { sides: 1, damage: 10, radius: 3.2, halfWidth: 1.15, cooldown: 1.0 },
  { sides: 2, damage: 10, radius: 3.2, halfWidth: 1.15, cooldown: 1.0 }, // Lv2: opposite side
  { sides: 2, damage: 13.5, radius: 3.2, halfWidth: 1.15, cooldown: 1.0 }, // Lv3: damage
  { sides: 2, damage: 13.5, radius: 4.0, halfWidth: 1.15, cooldown: 1.0 }, // Lv4: reach
  { sides: 2, damage: 13.5, radius: 4.0, halfWidth: 1.15, cooldown: 0.8 }, // Lv5: cooldown
  { sides: 2, damage: 13.5, radius: 4.0, halfWidth: 1.55, cooldown: 0.8 }, // Lv6: width
  { sides: 2, damage: 17, radius: 4.6, halfWidth: 1.55, cooldown: 0.8 }, // Lv7: damage + area
  { sides: 2, damage: 21, radius: 5.1, halfWidth: 1.8, cooldown: 0.7 }, // Lv8: max base
];

/**
 * AXE. Amount is the backbone of this weapon's progression: 1 axe at Lv1,
 * 2 at Lv2, 3 at Lv5, with damage and pierce filling the gaps. Extra axes
 * fan out symmetrically around the fixed upward base angle.
 */
const AXE: WeaponLevelEffect[] = [
  { projectiles: 1, damage: 14, pierce: 2, cooldown: 1.1, radius: 0.5 },
  { projectiles: 2, damage: 14, pierce: 2, cooldown: 1.1, radius: 0.5 }, // Lv2: +1 axe
  { projectiles: 2, damage: 18, pierce: 2, cooldown: 1.05, radius: 0.5 }, // Lv3: damage
  { projectiles: 2, damage: 18, pierce: 4, cooldown: 1.05, radius: 0.5 }, // Lv4: pierce
  { projectiles: 3, damage: 18, pierce: 4, cooldown: 1.0, radius: 0.5 }, // Lv5: +1 axe
  { projectiles: 3, damage: 23, pierce: 4, cooldown: 1.0, radius: 0.5 }, // Lv6: damage
  { projectiles: 3, damage: 23, pierce: 6, cooldown: 0.95, radius: 0.5 }, // Lv7: pierce
  { projectiles: 3, damage: 29, pierce: 7, cooldown: 0.9, radius: 0.68 }, // Lv8: damage + area
];

/** MAGIC WAND. Clean, fast, reliable: bolt count steps at Lv4 and Lv7. */
const MAGIC_WAND: WeaponLevelEffect[] = [
  { projectiles: 1, damage: 7, pierce: 0, cooldown: 0.55 },
  { projectiles: 1, damage: 8.6, pierce: 0, cooldown: 0.55 },
  { projectiles: 1, damage: 10, pierce: 0, cooldown: 0.5 },
  { projectiles: 2, damage: 10, pierce: 0, cooldown: 0.5 }, // Lv4: +1 bolt
  { projectiles: 2, damage: 11.5, pierce: 0, cooldown: 0.44 },
  { projectiles: 2, damage: 13, pierce: 1, cooldown: 0.44 }, // Lv6: pierce
  { projectiles: 3, damage: 13, pierce: 1, cooldown: 0.4 }, // Lv7: +1 bolt
  { projectiles: 3, damage: 16, pierce: 2, cooldown: 0.36 }, // Lv8
];

/** KNIFE. The directional weapon: 1 / 2 / 3 / 4 knives at Lv1/2/4/7. */
const KNIFE: WeaponLevelEffect[] = [
  { projectiles: 1, damage: 4, pierce: 0, cooldown: 0.4, speed: 14 },
  { projectiles: 2, damage: 4, pierce: 0, cooldown: 0.4, speed: 14 }, // Lv2: +1
  { projectiles: 2, damage: 5.2, pierce: 0, cooldown: 0.4, speed: 16 }, // Lv3: damage + speed
  { projectiles: 3, damage: 5.2, pierce: 0, cooldown: 0.4, speed: 16 }, // Lv4: +1
  { projectiles: 3, damage: 5.2, pierce: 0, cooldown: 0.32, speed: 16 }, // Lv5: cooldown
  { projectiles: 3, damage: 6.4, pierce: 1, cooldown: 0.32, speed: 16 }, // Lv6: pierce
  { projectiles: 4, damage: 6.4, pierce: 1, cooldown: 0.32, speed: 16 }, // Lv7: +1
  { projectiles: 4, damage: 8, pierce: 2, cooldown: 0.28, speed: 18 }, // Lv8
];

/** FIREBALL. Heavy homing projectile; the blast radius is the visible milestone. */
const FIREBALL: WeaponLevelEffect[] = [
  { damage: 16, cooldown: 1.6, radius: 2.0 },
  { damage: 19, cooldown: 1.6, radius: 2.0 },
  { damage: 19, cooldown: 1.5, radius: 2.6 }, // Lv3: bigger explosion
  { damage: 23, cooldown: 1.5, radius: 2.6 },
  { damage: 23, cooldown: 1.35, radius: 2.6 },
  { damage: 27, cooldown: 1.35, radius: 3.3 }, // Lv6: bigger fireball + blast
  { damage: 31, cooldown: 1.25, radius: 3.3 },
  { damage: 38, cooldown: 1.1, radius: 3.9 }, // Lv8
];

/** GARLIC AURA. Radius is the whole read - it steps at Lv2/Lv4/Lv7/Lv8. */
const GARLIC: WeaponLevelEffect[] = [
  { damage: 5, cooldown: 0.4, radius: 2.2 },
  { damage: 5, cooldown: 0.4, radius: 2.7 }, // Lv2: bigger aura
  { damage: 6.2, cooldown: 0.4, radius: 2.7 },
  { damage: 6.2, cooldown: 0.4, radius: 3.2 }, // Lv4: bigger aura
  { damage: 6.2, cooldown: 0.3, radius: 3.2 }, // Lv5: pulses faster
  { damage: 7.6, cooldown: 0.3, radius: 3.2 },
  { damage: 7.6, cooldown: 0.3, radius: 3.8 }, // Lv7: bigger aura
  { damage: 9.5, cooldown: 0.24, radius: 4.3 }, // Lv8
];

/** HOLY BLADES. 1 / 2 / 3 / 4 / 5 blades at Lv1/2/4/6/8 - countable on screen. */
const ORBITER: WeaponLevelEffect[] = [
  { blades: 1, damage: 6, cooldown: 0.35, radius: 2.2 },
  { blades: 2, damage: 6, cooldown: 0.35, radius: 2.2 }, // Lv2
  { blades: 2, damage: 7.4, cooldown: 0.35, radius: 2.4 },
  { blades: 3, damage: 7.4, cooldown: 0.35, radius: 2.4 }, // Lv4
  { blades: 3, damage: 8.8, cooldown: 0.3, radius: 2.4 },
  { blades: 4, damage: 8.8, cooldown: 0.3, radius: 2.6 }, // Lv6
  { blades: 4, damage: 10.2, cooldown: 0.3, radius: 2.6 },
  { blades: 5, damage: 12, cooldown: 0.26, radius: 2.9 }, // Lv8
];

/** ARC CROSS. Boomerang: pierce and range are what make later levels read. */
const ARC_CROSS: WeaponLevelEffect[] = [
  { projectiles: 1, damage: 11, pierce: 2, cooldown: 1.4, radius: 9 },
  { projectiles: 1, damage: 13, pierce: 2, cooldown: 1.4, radius: 9 },
  { projectiles: 1, damage: 13, pierce: 4, cooldown: 1.3, radius: 10.5 }, // Lv3: pierce + range
  { projectiles: 2, damage: 13, pierce: 4, cooldown: 1.3, radius: 10.5 }, // Lv4: +1 cross
  { projectiles: 2, damage: 16, pierce: 4, cooldown: 1.2, radius: 10.5 },
  { projectiles: 2, damage: 16, pierce: 6, cooldown: 1.2, radius: 12 }, // Lv6: pierce + range
  { projectiles: 2, damage: 19, pierce: 6, cooldown: 1.1, radius: 12 },
  { projectiles: 3, damage: 23, pierce: 8, cooldown: 1.0, radius: 13.5 }, // Lv8: +1 cross
];

/** EMBER WAND. Rare, random-target, heavy. Milestones are impact-scale, not rate. */
const EMBER_WAND: WeaponLevelEffect[] = [
  { projectiles: 1, damage: 24, pierce: 0, cooldown: 2.2, radius: 0.55 },
  { projectiles: 1, damage: 30, pierce: 0, cooldown: 2.2, radius: 0.55 },
  { projectiles: 1, damage: 30, pierce: 1, cooldown: 2.1, radius: 0.75 }, // Lv3: bigger bolt + pierce
  { projectiles: 1, damage: 38, pierce: 1, cooldown: 2.1, radius: 0.75 },
  { projectiles: 2, damage: 38, pierce: 1, cooldown: 2.0, radius: 0.75 }, // Lv5: second target
  { projectiles: 2, damage: 46, pierce: 1, cooldown: 2.0, radius: 0.95 }, // Lv6: bigger bolt
  { projectiles: 2, damage: 46, pierce: 2, cooldown: 1.85, radius: 0.95 },
  { projectiles: 3, damage: 58, pierce: 2, cooldown: 1.7, radius: 1.15 }, // Lv8: third target
];

/** RUNE SHARD. Erratic wanderer - more shards, more heading changes, more pierce. */
const RUNE_SHARD: WeaponLevelEffect[] = [
  { projectiles: 1, damage: 6, pierce: 6, cooldown: 1.0, duration: 4, turns: 6 },
  { projectiles: 1, damage: 7.5, pierce: 7, cooldown: 1.0, duration: 4, turns: 6 },
  { projectiles: 2, damage: 7.5, pierce: 7, cooldown: 1.0, duration: 4, turns: 6 }, // Lv3: +1 shard
  { projectiles: 2, damage: 7.5, pierce: 8, cooldown: 0.95, duration: 5, turns: 9 }, // Lv4: duration + turns
  { projectiles: 2, damage: 9.2, pierce: 8, cooldown: 0.95, duration: 5, turns: 9 },
  { projectiles: 3, damage: 9.2, pierce: 9, cooldown: 0.9, duration: 5, turns: 9 }, // Lv6: +1 shard
  { projectiles: 3, damage: 9.2, pierce: 10, cooldown: 0.9, duration: 6, turns: 13 }, // Lv7: duration + turns
  { projectiles: 4, damage: 12, pierce: 12, cooldown: 0.85, duration: 6, turns: 13 }, // Lv8: +1 shard
];

/** HEX FLASK. Persistent ground zone - radius and duration are the identity. */
const HEX_FLASK: WeaponLevelEffect[] = [
  { projectiles: 1, damage: 5, cooldown: 3.0, radius: 1.9, duration: 3 },
  { projectiles: 1, damage: 5, cooldown: 3.0, radius: 2.4, duration: 3 }, // Lv2: bigger pool
  { projectiles: 1, damage: 6.4, cooldown: 2.85, radius: 2.4, duration: 3.6 }, // Lv3: duration
  { projectiles: 2, damage: 6.4, cooldown: 2.85, radius: 2.4, duration: 3.6 }, // Lv4: +1 flask
  { projectiles: 2, damage: 6.4, cooldown: 2.7, radius: 2.9, duration: 3.6 }, // Lv5: bigger pool
  { projectiles: 2, damage: 8, cooldown: 2.7, radius: 2.9, duration: 4.4 }, // Lv6: duration
  { projectiles: 2, damage: 8, cooldown: 2.5, radius: 3.4, duration: 4.4 }, // Lv7: bigger pool
  { projectiles: 3, damage: 10, cooldown: 2.3, radius: 3.8, duration: 5.2 }, // Lv8: +1 flask
];

const TABLES: Record<string, WeaponLevelEffect[]> = {
  whip_strike: WHIP,
  axe_throw: AXE,
  magic_wand: MAGIC_WAND,
  knife_throw: KNIFE,
  fireball: FIREBALL,
  garlic_aura: GARLIC,
  orbiter_blades: ORBITER,
  arc_cross: ARC_CROSS,
  ember_wand: EMBER_WAND,
  rune_shard: RUNE_SHARD,
  hex_flask: HEX_FLASK,
};

/**
 * Multipliers applied on top of the level row when a weapon has evolved.
 * Kept here (not inline in each weapon) so the evolved numbers are diffable
 * by the same machinery, which is what lets the evolution card state real
 * figures instead of a vague promise.
 */
export interface EvolvedModifiers {
  damage?: number;
  cooldown?: number;
  radius?: number;
  pierce?: number;
  projectiles?: number;
  blades?: number;
  speed?: number;
  duration?: number;
}

const EVOLVED: Record<string, EvolvedModifiers> = {
  whip_strike: { damage: 1.4, radius: 1.35, cooldown: 0.75 },
  axe_throw: { damage: 1.15, projectiles: 1, speed: 1.25 },
  magic_wand: { damage: 1.3, cooldown: 0.75, projectiles: 1, pierce: 2 },
  knife_throw: { damage: 1.15, cooldown: 0.75, projectiles: 2, pierce: 1 },
  fireball: { damage: 1.3, cooldown: 0.7, radius: 1.5 },
  garlic_aura: { damage: 2, radius: 1.2 },
  orbiter_blades: { damage: 1.3, blades: 2, radius: 1.1 },
  arc_cross: { damage: 1.35, cooldown: 0.8, pierce: 2 },
  ember_wand: { damage: 1.2, pierce: 2, radius: 1.3 },
  rune_shard: { damage: 1.3, pierce: 4 },
  hex_flask: { damage: 1.25, radius: 1.4, duration: 1.15 },
};

/**
 * The authoritative stats for a weapon at a given level. Every weapon's
 * `update()` calls this instead of recomputing its own formulas, so the
 * numbers the simulation uses and the numbers the UI shows are literally the
 * same values.
 */
export function effectAt(weaponId: string, level: number, evolved = false): WeaponLevelEffect {
  const table = TABLES[weaponId];
  if (!table || table.length === 0) return { damage: 0, cooldown: 1 };
  const row = table[Math.max(0, Math.min(table.length - 1, level - 1))];
  if (!evolved) return row;
  const mod = EVOLVED[weaponId];
  if (!mod) return row;
  const out: WeaponLevelEffect = { ...row };
  if (mod.damage !== undefined) out.damage *= mod.damage;
  if (mod.cooldown !== undefined) out.cooldown *= mod.cooldown;
  if (mod.radius !== undefined && out.radius !== undefined) out.radius *= mod.radius;
  if (mod.speed !== undefined && out.speed !== undefined) out.speed *= mod.speed;
  if (mod.duration !== undefined && out.duration !== undefined) out.duration *= mod.duration;
  // Additive counters: an evolution grants extra projectiles/blades/pierce outright.
  if (mod.projectiles !== undefined && out.projectiles !== undefined) out.projectiles += mod.projectiles;
  if (mod.blades !== undefined && out.blades !== undefined) out.blades += mod.blades;
  if (mod.pierce !== undefined && out.pierce !== undefined) out.pierce += mod.pierce;
  return out;
}

export function maxLevelOf(weaponId: string): number {
  return TABLES[weaponId]?.length ?? 8;
}

export interface LevelChange {
  field: string;
  headline: string;
  detail: string;
  from: number;
  to: number;
}

/**
 * What ACTUALLY changes between two levels, derived by diffing the tables.
 * The level-up card renders this directly, so it can never advertise an
 * effect the weapon does not have - if a row does not change a field, no
 * text about that field is produced.
 *
 * Returned most-significant first (a new projectile outranks a damage bump).
 */
export function describeLevelUp(weaponId: string, fromLevel: number, toLevel: number): LevelChange[] {
  const a = effectAt(weaponId, fromLevel);
  const b = effectAt(weaponId, toLevel);
  const changes: LevelChange[] = [];
  for (const key of Object.keys(FIELD_LABELS)) {
    const from = a[key];
    const to = b[key];
    if (from === undefined || to === undefined) continue;
    if (Math.abs(to - from) < 1e-6) continue;
    const label = FIELD_LABELS[key];
    // Only report a field as an upgrade when it moved the right way.
    const improved = label.lowerIsBetter ? to < from : to > from;
    if (!improved) continue;
    changes.push({
      field: key,
      headline: label.headline(Math.round((to - from) * 100) / 100),
      detail: label.detail(from, to),
      from,
      to,
    });
  }
  changes.sort((x, y) => FIELD_LABELS[y.field].priority - FIELD_LABELS[x.field].priority);
  return changes;
}

/** Same diff, but between a weapon's max level and its evolved form - powers the evolution card. */
export function describeEvolution(weaponId: string): LevelChange[] {
  const max = maxLevelOf(weaponId);
  const a = effectAt(weaponId, max, false);
  const b = effectAt(weaponId, max, true);
  const changes: LevelChange[] = [];
  for (const key of Object.keys(FIELD_LABELS)) {
    const from = a[key];
    const to = b[key];
    if (from === undefined || to === undefined) continue;
    if (Math.abs(to - from) < 1e-6) continue;
    const label = FIELD_LABELS[key];
    const improved = label.lowerIsBetter ? to < from : to > from;
    if (!improved) continue;
    changes.push({ field: key, headline: label.headline(Math.round((to - from) * 100) / 100), detail: label.detail(from, to), from, to });
  }
  changes.sort((x, y) => FIELD_LABELS[y.field].priority - FIELD_LABELS[x.field].priority);
  return changes;
}
