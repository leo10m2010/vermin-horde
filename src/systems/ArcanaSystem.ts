import type { PlayerStats } from '../game/GameState';

/** A rare, build-defining in-run bonus - bigger and stranger than a regular
 * passive pick from UpgradeSystem. Effects stay as PlayerStats mutations
 * (same contract as PassiveDef) since that's the only surface arcana can
 * reach into. */
export interface ArcanaDef {
  id: string;
  name: string;
  description: string;
  apply: (stats: PlayerStats) => void;
}

/** Survive this many seconds between offers; up to MAX_MILESTONES per run. */
const MILESTONE_INTERVAL_SECONDS = 300; // every 5 minutes
const MAX_MILESTONES = 5;
const OFFER_SIZE = 2;

const ARCANA_DEFS: ArcanaDef[] = [
  {
    id: 'blood_pact',
    name: 'Blood Pact',
    description: '+40% damage, but -15% max health. A bigger, riskier version of raw power.',
    apply: (s) => {
      s.damageMultiplier += 0.4;
      s.maxHealth = Math.max(1, Math.round(s.maxHealth * 0.85));
      s.health = Math.min(s.health, s.maxHealth);
    },
  },
  {
    id: 'undying_momentum',
    name: 'Undying Momentum',
    description: '+25% move speed and +25% projectile speed. Everything gets faster, permanently.',
    apply: (s) => {
      s.moveSpeed *= 1.25;
      s.projectileSpeedMultiplier *= 1.25;
    },
  },
  {
    id: 'second_chance',
    name: 'Second Chance',
    description: 'Fully heals you and grants 2 extra revive charges.',
    apply: (s) => {
      s.reviveCharges += 2;
      s.health = s.maxHealth;
    },
  },
  {
    id: 'fortunes_eye',
    name: "Fortune's Eye",
    description: 'A huge spike in luck and crit: +30% luck, +15% crit chance, +50% crit damage.',
    apply: (s) => {
      s.luck = Math.min(1, s.luck + 0.3);
      s.critChance += 0.15;
      s.critMultiplier += 0.5;
    },
  },
  {
    id: 'overgrowth',
    name: 'Overgrowth',
    description: '+35% area, +20% effect duration on every weapon.',
    apply: (s) => {
      s.areaMultiplier += 0.35;
      s.durationMultiplier += 0.2;
    },
  },
  {
    id: 'titans_blood',
    name: "Titan's Blood",
    description: '+80 max health (fully healed) and +2 armor.',
    apply: (s) => {
      s.maxHealth += 80;
      s.health += 80;
      s.armor += 2;
    },
  },
  {
    id: 'frenzied_assault',
    name: 'Frenzied Assault',
    description: '-25% cooldown and +2 extra projectiles across your arsenal.',
    apply: (s) => {
      s.cooldownMultiplier = Math.max(0.35, s.cooldownMultiplier - 0.25);
      s.extraProjectiles += 2;
    },
  },
  {
    id: 'golden_harvest',
    name: 'Golden Harvest',
    description: '+40% XP gain, +1.2 pickup radius, +1 HP/s regen. A big lump of utility.',
    apply: (s) => {
      s.xpGainMultiplier += 0.4;
      s.magnetRadius += 1.2;
      s.regenPerSecond += 1;
    },
  },
];

/**
 * Tracks in-run survival time and fires a rare, build-altering "arcana"
 * offer at fixed milestones (every 5 minutes of survival, up to 5 per run).
 * Distinct from - and rarer/bigger than - the regular level-up picker driven
 * by UpgradeSystem.
 */
export class ArcanaSystem {
  private nextMilestoneIndex = 0;
  private readonly offeredIds = new Set<string>();

  constructor(private readonly rng: () => number) {}

  /** Call every frame with elapsed run seconds. Returns a non-empty offer
   * array the instant a new milestone is crossed, otherwise null. */
  checkMilestone(elapsedSeconds: number): ArcanaDef[] | null {
    if (this.nextMilestoneIndex >= MAX_MILESTONES) return null;
    const threshold = (this.nextMilestoneIndex + 1) * MILESTONE_INTERVAL_SECONDS;
    if (elapsedSeconds < threshold) return null;
    this.nextMilestoneIndex += 1;
    return this.rollOffer(OFFER_SIZE);
  }

  apply(arcana: ArcanaDef, stats: PlayerStats): void {
    arcana.apply(stats);
  }

  /** Clear milestone-tracking state for a fresh run. */
  reset(): void {
    this.nextMilestoneIndex = 0;
    this.offeredIds.clear();
  }

  private rollOffer(count: number): ArcanaDef[] {
    // Prefer arcana not yet offered this run; once the fresh pool runs dry
    // (more milestones than defs), fall back to the full list so an offer
    // is always non-empty.
    const freshPool = ARCANA_DEFS.filter((a) => !this.offeredIds.has(a.id));
    const source = freshPool.length >= Math.min(count, ARCANA_DEFS.length) ? freshPool : ARCANA_DEFS.slice();

    const shuffled = source.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const picks = shuffled.slice(0, Math.min(count, shuffled.length));
    for (const pick of picks) this.offeredIds.add(pick.id);
    return picks;
  }
}
