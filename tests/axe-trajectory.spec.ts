import { test, expect } from '@playwright/test';

/**
 * AXE TRAJECTORY — screen-space regression guard.
 *
 * The axe previously "arced" only in world Y while carrying a constant
 * velZ = -9. With the camera at 58 degrees, screen-up is (0, 0.530, -0.848):
 * world -Z climbs the screen at ~7.63 units/s while the steepest world-Y
 * descent gives back only ~2.81, so the axe was still RISING at ~4.8 units/s
 * during its supposed fall. It looked like a hammer thrown into the sky.
 *
 * A world-space assertion cannot catch that — the Y parabola was perfectly
 * valid maths in an axis the camera barely uses. So this test samples the
 * PROJECTED SCREEN POSITION across the whole flight and demands that the
 * vertical direction genuinely reverses.
 */

type Page = import('@playwright/test').Page;

/**
 * Screen-space samples of ONE axe across its flight, ordered in time.
 *
 * The cooldown (1.0s) is shorter than the flight (1.6s), so a second axe
 * launches while the first is still airborne and the census briefly holds
 * two. Indexing `[0]` would then silently hop between throws and scramble the
 * sequence, so this tracks a single axe by continuity: each step follows the
 * projectile nearest to where the tracked one was last seen.
 */
async function sampleFlight(page: Page): Promise<Array<{ screenY: number; z: number }>> {
  // Follow ONE projectile by its pool index. Pool indices are stable for a
  // projectile's whole life, so this is exact - unlike matching by position,
  // which quietly hops between throws once the 1.0s cooldown starts
  // overlapping the 1.6s flight and two axes are airborne at once.
  //
  // Lock on only while the axe is still RISING (z decreasing): the parabola
  // passes back through its early z values on the way down, so "z near the
  // launch point" alone also matches a landing axe.
  let tracked = -1;
  for (let attempt = 0; attempt < 40 && tracked === -1; attempt += 1) {
    const a = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.getProjectileScreenPositions('axe_throw'));
    const cand = a.find((p) => p.z > -1.5);
    if (!cand) {
      await page.waitForTimeout(40);
      continue;
    }
    await page.waitForTimeout(70);
    const b = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.getProjectileScreenPositions('axe_throw'));
    const same = b.find((p) => p.index === cand.index);
    if (same && same.z < cand.z - 0.2) tracked = cand.index;
  }
  if (tracked === -1) return [];

  const samples: Array<{ screenY: number; z: number }> = [];
  for (let i = 0; i < 30; i += 1) {
    const live = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.getProjectileScreenPositions('axe_throw'));
    const hit = live.find((p) => p.index === tracked);
    if (!hit) break; // that axe has landed and despawned
    samples.push({ screenY: hit.screenY, z: hit.z });
    await page.waitForTimeout(70);
  }
  return samples;
}

test.describe('axe trajectory', () => {
  test('reverses its screen-space vertical direction: rises, apexes, then falls', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'needs real frame pacing to sample a 1.6s flight densely enough',
    );

    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
    await page.evaluate(() => {
      window.__THREE_GAME_TEST_HOOKS__!.seed(31);
      window.__THREE_GAME_TEST_HOOKS__!.setState('active-play');
      window.__THREE_GAME_TEST_HOOKS__!.setGodMode(true);
      // One axe, no other weapon cluttering the census.
      window.__THREE_GAME_TEST_HOOKS__!.powerShowcase('axe_throw', 1);
      // Empty the arena. The showcase rings the player with dummy targets,
      // and an axe that exhausts its pierce on them despawns about 3/4 of the
      // way through the arc - which truncates the descent this test measures.
      window.__THREE_GAME_TEST_HOOKS__!.clearEnemies();
    });
    await page.waitForTimeout(400);

    const samples = await sampleFlight(page);
    expect(samples.length, 'no axe was ever in flight').toBeGreaterThan(8);

    // Lowest screenY = highest point on screen (y is measured downward).
    let apexIndex = 0;
    for (let i = 1; i < samples.length; i += 1) {
      if (samples[i].screenY < samples[apexIndex].screenY) apexIndex = i;
    }

    // There must be real flight on BOTH sides of the apex - an apex at either
    // end of the sample window means the axe never turned around.
    expect(apexIndex, 'apex is at the very start: the axe never rose').toBeGreaterThan(1);
    expect(apexIndex, 'apex is at the very end: the axe never fell').toBeLessThan(samples.length - 2);

    const startY = samples[0].screenY;
    const apexY = samples[apexIndex].screenY;
    const endY = samples[samples.length - 1].screenY;

    // Rise and fall must both be substantial, not one-pixel sampling noise.
    const rise = startY - apexY; // positive = went up the screen
    const fall = endY - apexY; // positive = came back down
    expect(rise, 'axe did not visibly rise on screen').toBeGreaterThan(40);
    expect(fall, 'axe did not visibly fall on screen after the apex').toBeGreaterThan(40);

    // Direction must genuinely reverse: several consecutive descending steps.
    let descending = 0;
    for (let i = apexIndex + 1; i < samples.length; i += 1) {
      if (samples[i].screenY > samples[i - 1].screenY) descending += 1;
    }
    expect(descending, 'no sustained descent after the apex').toBeGreaterThanOrEqual(3);

    // And the underlying cause must be right: world Z has to reverse too.
    // (A Y-only bob would leave Z monotonically decreasing forever.)
    const zAtApex = samples[apexIndex].z;
    const zAtEnd = samples[samples.length - 1].z;
    expect(zAtEnd, 'world Z never turned around - the arc is still faked in Y').toBeGreaterThan(zAtApex + 1);
  });

  test('the arc reads without the shadow: axe alone still rises and falls', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'needs real frame pacing');
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
    await page.evaluate(() => {
      window.__THREE_GAME_TEST_HOOKS__!.seed(77);
      window.__THREE_GAME_TEST_HOOKS__!.setState('active-play');
      window.__THREE_GAME_TEST_HOOKS__!.setGodMode(true);
      window.__THREE_GAME_TEST_HOOKS__!.powerShowcase('axe_throw', 1);
      window.__THREE_GAME_TEST_HOOKS__!.clearEnemies();
    });
    await page.waitForTimeout(400);

    // getProjectileScreenPositions filters by weaponId, and the toss shadow is
    // spawned with weaponId -1 - so these samples are the AXE only. If the arc
    // reverses here, it reverses without the shadow selling it.
    const samples = await sampleFlight(page);
    expect(samples.length).toBeGreaterThan(8);
    const minY = Math.min(...samples.map((s) => s.screenY));
    const lastY = samples[samples.length - 1].screenY;
    expect(lastY - minY, 'axe alone shows no descent').toBeGreaterThan(40);
  });

  test('axe count stays 1 / 2 / 3 at Lv1 / Lv2 / Lv5 after the trajectory rewrite', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
    await page.evaluate(() => {
      window.__THREE_GAME_TEST_HOOKS__!.seed(9);
      window.__THREE_GAME_TEST_HOOKS__!.setState('active-play');
      window.__THREE_GAME_TEST_HOOKS__!.setGodMode(true);
    });
    for (const [level, expected] of [
      [1, 1],
      [2, 2],
      [5, 3],
    ] as Array<[number, number]>) {
      const info = await page.evaluate((l) => window.__THREE_GAME_TEST_HOOKS__!.powerShowcase('axe_throw', l), level);
      expect(info.effect.projectiles).toBe(expected);
    }
  });
});
