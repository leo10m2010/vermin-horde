/**
 * Shared Luck-stat formulas, modeled on Vampire Survivors' documented Luck
 * mechanic: TotalLuck = 100 + displayed Luck%, applied multiplicatively to
 * chance-based rolls (rare-tier weight, bonus-slot unlock, etc). Our
 * `stats.luck` is already the fractional bonus (0.25 == "+25%"), so
 * TotalLuck here is simply `1 + luck` - the same ratio, just unscaled by 100.
 */

/** TotalLuck multiplier: 1.0 at zero luck, grows linearly, uncapped (matches the wiki: no upper limit). */
export function totalLuck(luck: number): number {
  return 1 + Math.max(0, luck);
}

/** A base chance scaled by TotalLuck, clamped to a sane [0, max] range so luck can push toward "always" without exceeding it. */
export function luckScaledChance(baseChance: number, luck: number, max = 0.95): number {
  return Math.min(max, baseChance * totalLuck(luck));
}

/**
 * VS's bonus-upgrade-slot formula: chance = 1 - 1/TotalLuck. At luck=0 this
 * is exactly 0 (TotalLuck=1); it climbs smoothly and asymptotically toward 1
 * as luck grows, so no hard cap is needed - the formula self-limits.
 */
export function bonusSlotChance(luck: number): number {
  return 1 - 1 / totalLuck(luck);
}
