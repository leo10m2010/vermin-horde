import { test, expect, type Page } from '@playwright/test';

/**
 * CHARACTER AFFINITIES
 *
 * An affinity is a claim about a distribution, so it is checked as one:
 * 10,000 rolls of the real upgrade pool per character, against a game state
 * held fixed so the only variable is the affinity table itself.
 *
 * The three things that must be true, and the reasons they matter:
 *  1. The lean is real and points the right way, or the affinity is decoration.
 *  2. The lean is bounded, or a character stops being able to build anything
 *     but their theme - which is the failure mode this system is trying to
 *     avoid, not cause.
 *  3. Nothing is ever locked out, or the roster becomes six narrow decks
 *     instead of six starting points.
 */

const ROLLS = 10000;
const CHARACTER_IDS = ['thornguard', 'redline', 'warden', 'cinderborn', 'fortune', 'steadyhand'];

/** The bands the design brief fixes for each tier of affinity. */
const BANDS = {
  starter: [1.4, 1.6] as const,
  secondary: [1.15, 1.3] as const,
  passive: [1.1, 1.2] as const,
};

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__!.seed(31337);
    window.__THREE_GAME_TEST_HOOKS__!.setState('active-play');
    window.__THREE_GAME_TEST_HOOKS__!.setGodMode(true);
  });
  await page.waitForTimeout(300);
}

test.describe('character affinities', () => {
  test.beforeEach(async ({ page }) => boot(page));

  test('every affinity magnitude sits inside its design band', async ({ page }) => {
    const tables = await page.evaluate(
      ({ ids }) =>
        ids.map((id) => ({
          id,
          starter: window.__THREE_GAME_TEST_HOOKS__!.getCharacterStartWeapon(id),
          aff: window.__THREE_GAME_TEST_HOOKS__!.getCharacterAffinities(id),
        })),
      { ids: CHARACTER_IDS },
    );

    for (const { id, starter, aff } of tables) {
      expect(aff, `${id} must carry an affinity table`).not.toBeNull();
      const weapons = aff!.weapons;
      const passives = aff!.passives;

      // The starting weapon must be the strongest weapon lean, and in band.
      const starterMult = weapons[starter];
      expect(starterMult, `${id}: starting weapon ${starter} must have an affinity`).toBeDefined();
      expect(starterMult, `${id}: starter multiplier`).toBeGreaterThanOrEqual(BANDS.starter[0]);
      expect(starterMult, `${id}: starter multiplier`).toBeLessThanOrEqual(BANDS.starter[1]);

      for (const [weaponId, mult] of Object.entries(weapons)) {
        if (weaponId === starter) continue;
        expect(mult, `${id}: secondary ${weaponId}`).toBeGreaterThanOrEqual(BANDS.secondary[0]);
        expect(mult, `${id}: secondary ${weaponId}`).toBeLessThanOrEqual(BANDS.secondary[1]);
        expect(mult, `${id}: secondary ${weaponId} must not outweigh the starter`).toBeLessThan(starterMult);
      }
      for (const [passiveId, mult] of Object.entries(passives)) {
        expect(mult, `${id}: passive ${passiveId}`).toBeGreaterThanOrEqual(BANDS.passive[0]);
        expect(mult, `${id}: passive ${passiveId}`).toBeLessThanOrEqual(BANDS.passive[1]);
      }

      // Tags are what the player actually reads, and must not leak numbers.
      expect(aff!.tags.length, `${id} must have select-screen tags`).toBeGreaterThan(0);
      for (const tag of aff!.tags) {
        expect(tag, `${id}: tag "${tag}" must not print a raw percentage`).not.toMatch(/\d/);
      }
    }
  });

  test('10,000 rolls per character: the lean is real, bounded, and locks nothing out', async ({ page }) => {
    const baseline = await page.evaluate(
      (rolls) => window.__THREE_GAME_TEST_HOOKS__!.simulateUpgradeRolls(null, rolls),
      ROLLS,
    );

    const report: string[] = [];

    for (const id of CHARACTER_IDS) {
      const { biased, aff, poolSize } = await page.evaluate(
        ({ id, rolls }) => ({
          biased: window.__THREE_GAME_TEST_HOOKS__!.simulateUpgradeRolls(id, rolls),
          aff: window.__THREE_GAME_TEST_HOOKS__!.getCharacterAffinities(id)!,
          poolSize: Object.keys(window.__THREE_GAME_TEST_HOOKS__!.simulateUpgradeRolls(null, 400)).length,
        }),
        { id, rolls: ROLLS },
      );

      const favoured = [...Object.keys(aff.weapons), ...Object.keys(aff.passives)];

      for (const optionId of favoured) {
        const before = baseline[optionId] ?? 0;
        const after = biased[optionId] ?? 0;
        // An option the pool never offers at all (e.g. a weapon already owned
        // and maxed) cannot be tested for a lean; skip rather than fake one.
        if (before === 0 && after === 0) continue;

        const ratio = before > 0 ? after / before : Infinity;
        report.push(`${id.padEnd(11)} ${optionId.padEnd(26)} ${before} -> ${after}  (x${ratio.toFixed(2)})`);

        // 1. The lean points the right way. 10k rolls makes the sampling noise
        //    far smaller than the smallest multiplier in play (1.10).
        expect(after, `${id}: ${optionId} must be offered MORE often than baseline`).toBeGreaterThan(before);

        // 2. And is bounded: no affinity may more than double an option's rate.
        expect(ratio, `${id}: ${optionId} lean must stay bounded`).toBeLessThan(2);
      }

      // 3. Nothing is locked out: every option the unbiased pool can offer is
      //    still offered to this character.
      const missing = Object.keys(baseline).filter((k) => !(k in biased));
      expect(missing, `${id} must not lock any upgrade out of its pool`).toEqual([]);
      expect(Object.keys(biased).length).toBe(poolSize);
    }

    console.log(report.join('\n'));
  });

  test('a character never crowds its own theme out of the rest of the pool', async ({ page }) => {
    // The counterweight to the test above: the favoured set must stay a lean,
    // not a takeover. Off-theme options must still make up most of the offers.
    for (const id of CHARACTER_IDS) {
      const { biased, aff } = await page.evaluate(
        ({ id, rolls }) => ({
          biased: window.__THREE_GAME_TEST_HOOKS__!.simulateUpgradeRolls(id, rolls),
          aff: window.__THREE_GAME_TEST_HOOKS__!.getCharacterAffinities(id)!,
        }),
        { id, rolls: ROLLS },
      );

      const favoured = new Set([...Object.keys(aff.weapons), ...Object.keys(aff.passives)]);
      let favouredOffers = 0;
      let totalOffers = 0;
      for (const [optionId, n] of Object.entries(biased)) {
        totalOffers += n;
        if (favoured.has(optionId)) favouredOffers += n;
      }
      const share = (favouredOffers / totalOffers) * 100;
      console.log(`${id}: favoured options are ${share.toFixed(1)}% of all offers`);
      expect(share, `${id}: the favoured set must not dominate the pool`).toBeLessThan(45);
    }
  });
});
