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
  /**
   * Optional: called every frame (while playing) for every arcana the player
   * currently holds, so an arcana can express a genuinely dynamic effect -
   * an oscillating multiplier, a value that drains while moving, etc -
   * instead of only a one-time stat mutation. Receives elapsed RUN seconds
   * (not seconds since pick) so effects get a stable phase.
   *
   * IMPORTANT: never SET a shared stat outright (`stats.x = f(t)`) - that
   * clobbers whatever passives/traits/other arcanas also touch it. Instead
   * track your own last-applied value in module scope and apply only the
   * DELTA each tick (mirrors CharacterDef.onLevelUp in src/game/Characters.ts
   * - see e.g. Vex Redline's decaying speed/crit bonus there for the exact
   * pattern: compute desired value from elapsed time, diff against what you
   * applied last time, `stats.x *= desired/last` or `stats.x += desired -
   * last`, then store `last = desired`). Reset your tracking state inside
   * `apply()` so nothing leaks across a restart.
   */
  tick?: (stats: PlayerStats, elapsedSeconds: number) => void;
}

/** Survive this many seconds between offers; up to MAX_MILESTONES per run. */
const MILESTONE_INTERVAL_SECONDS = 300; // every 5 minutes
const MAX_MILESTONES = 5;
const OFFER_SIZE = 2;

// --- Tidal Surge: permanent +15% projectile speed, plus a continuous
// sine-wave oscillation layered on top that swings projectile speed between
// 0.6x and 1.6x on a steady 6-second cycle - forever, while held. Play
// rhythm never settles into one static value the way a flat passive would.
const TIDAL_SURGE_BASELINE = 1.15; // permanent multiplicative bump, applied once in apply()
const TIDAL_SURGE_PERIOD_SECONDS = 6;
const TIDAL_SURGE_CENTER = 1.1;
const TIDAL_SURGE_AMPLITUDE = 0.5; // 1.1 +/- 0.5 => swings 0.6x..1.6x, never near 0
let tidalSurgeLastFactor = 1;

function tidalSurgeFactorAt(elapsedSeconds: number): number {
  return (
    TIDAL_SURGE_CENTER +
    TIDAL_SURGE_AMPLITUDE * Math.sin((elapsedSeconds / TIDAL_SURGE_PERIOD_SECONDS) * Math.PI * 2)
  );
}

// --- Adrenal Heartbeat: small permanent crit-damage bump, plus a hard crit
// CHANCE spike that pulses on a fixed rhythm - a narrow "heartbeat" window
// every few seconds instead of one flat always-on bonus.
const HEARTBEAT_PERIOD_SECONDS = 4; // one beat every 4s
const HEARTBEAT_WINDOW_SECONDS = 0.4; // the spike lasts this long each beat
const HEARTBEAT_CRIT_CHANCE_BONUS = 0.45; // +45% crit chance during the spike window
let heartbeatLastBonus = 0;

function heartbeatBonusAt(elapsedSeconds: number): number {
  const phase = elapsedSeconds % HEARTBEAT_PERIOD_SECONDS;
  return phase < HEARTBEAT_WINDOW_SECONDS ? HEARTBEAT_CRIT_CHANCE_BONUS : 0;
}

// --- Withering Growth: a real, felt upfront tradeoff (permanent move-speed
// and max-health cut, taken immediately in apply()) in exchange for damage
// that ramps UP continuously and UNCAPPED for the rest of the run. Because
// the ramp is driven by run-elapsed seconds (not seconds-since-pick), a
// late pick banks a bigger immediate chunk too - the withering has been
// happening in the background the whole run, this arcana just taps into it.
const WITHER_MOVE_SPEED_FACTOR = 0.8; // -20% move speed, permanent
const WITHER_MAX_HEALTH_FACTOR = 0.85; // -15% max health, permanent
const WITHER_DAMAGE_RAMP_PER_SECOND = 0.001; // +0.1%/s => roughly +6% damage per minute survived, uncapped
let witherLastDamageBonus = 0;

// --- Ebb and Flow: HP regen that builds across an 8-second ramp up to a
// peak, then snaps back to nothing and repeats - a sawtooth rhythm instead
// of a flat HP/s trickle, so lean stretches and healing surges alternate
// for the rest of the run.
const EBBFLOW_CYCLE_SECONDS = 8;
const EBBFLOW_PEAK_REGEN = 6; // HP/s at the top of each ramp
let ebbFlowLastRegen = 0;

function ebbFlowRegenAt(elapsedSeconds: number): number {
  const phase = (elapsedSeconds % EBBFLOW_CYCLE_SECONDS) / EBBFLOW_CYCLE_SECONDS; // 0..1 sawtooth
  return phase * EBBFLOW_PEAK_REGEN;
}

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
  {
    id: 'tidal_surge',
    name: 'Tidal Surge',
    description:
      '+15% projectile speed immediately. Forever after, projectile speed also surges and ebbs on a steady 6-second cycle, swinging between 0.6x and 1.6x - the rhythm never settles.',
    apply: (s) => {
      s.projectileSpeedMultiplier *= TIDAL_SURGE_BASELINE;
      tidalSurgeLastFactor = 1;
    },
    tick: (stats, elapsedSeconds) => {
      const desired = tidalSurgeFactorAt(elapsedSeconds);
      stats.projectileSpeedMultiplier *= desired / tidalSurgeLastFactor;
      tidalSurgeLastFactor = desired;
    },
  },
  {
    id: 'adrenal_heartbeat',
    name: 'Adrenal Heartbeat',
    description:
      '+15% crit damage immediately. Forever after, your pulse pounds every 4 seconds: crit chance spikes by +45% for a brief instant, then fades back to normal.',
    apply: (s) => {
      s.critMultiplier += 0.15;
      heartbeatLastBonus = 0;
    },
    tick: (stats, elapsedSeconds) => {
      const desired = heartbeatBonusAt(elapsedSeconds);
      if (desired !== heartbeatLastBonus) {
        stats.critChance += desired - heartbeatLastBonus;
        heartbeatLastBonus = desired;
      }
    },
  },
  {
    id: 'withering_growth',
    name: 'Withering Growth',
    description:
      '-20% move speed and -15% max health, permanently. In exchange, damage ramps up continuously and without limit for the rest of the run - roughly +6% every minute survived.',
    apply: (s) => {
      s.moveSpeed *= WITHER_MOVE_SPEED_FACTOR;
      s.maxHealth = Math.max(1, Math.round(s.maxHealth * WITHER_MAX_HEALTH_FACTOR));
      s.health = Math.min(s.health, s.maxHealth);
      witherLastDamageBonus = 0;
    },
    tick: (stats, elapsedSeconds) => {
      const desired = elapsedSeconds * WITHER_DAMAGE_RAMP_PER_SECOND;
      stats.damageMultiplier += desired - witherLastDamageBonus;
      witherLastDamageBonus = desired;
    },
  },
  {
    id: 'ebb_and_flow',
    name: 'Ebb and Flow',
    description:
      '+1 armor immediately. Forever after, HP regen builds across an 8-second ramp up to 6 HP/s, then snaps back to nothing and starts again - lean stretches followed by a surge, on repeat.',
    apply: (s) => {
      s.armor += 1;
      ebbFlowLastRegen = 0;
    },
    tick: (stats, elapsedSeconds) => {
      const desired = ebbFlowRegenAt(elapsedSeconds);
      stats.regenPerSecond += desired - ebbFlowLastRegen;
      ebbFlowLastRegen = desired;
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
  private readonly active: ArcanaDef[] = [];

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
    if (arcana.tick) this.active.push(arcana);
  }

  /** Call every frame while playing so any held arcana's `tick` (if it has one) keeps running. */
  tickActive(stats: PlayerStats, elapsedSeconds: number): void {
    for (const arcana of this.active) arcana.tick?.(stats, elapsedSeconds);
  }

  /** Clear milestone-tracking and active-effect state for a fresh run. */
  reset(): void {
    this.nextMilestoneIndex = 0;
    this.offeredIds.clear();
    this.active.length = 0;
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
