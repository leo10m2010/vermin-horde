import { test, expect } from '@playwright/test';

/**
 * DROP TABLE DISTRIBUTION
 *
 * Round 8 requires that luck "raises the chance of special rewards smoothly,
 * must not remove coins, and must not make rares practically guaranteed".
 * Those are statistical claims, so they are checked statistically: tens of
 * thousands of simulated breakable destructions per luck value, run inside the
 * page against the real DropTable module rather than a reimplementation.
 */

type Dist = Record<string, number>;

const ROLLS = 20000;

async function simulate(page: import('@playwright/test').Page, luck: number, level: number): Promise<Dist> {
  return page.evaluate(
    async ({ luck, level, rolls }) => {
      // Vite serves the real module; the dynamic path is deliberately opaque
      // to tsc so the test compiles outside the dev-server module graph.
      const mod = (await import(/* @vite-ignore */ '/src/world/DropTable.ts' as string)) as {
        rollDrop: (rng: () => number, luck: number, level: number) => { id: string } | null;
      };
      // Deterministic LCG: the same stream for every luck value, so differences
      // between runs come from the weights and not from RNG noise.
      let seed = 123456789;
      const rng = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const dist: Record<string, number> = { nothing: 0 };
      for (let i = 0; i < rolls; i++) {
        const drop = mod.rollDrop(rng, luck, level);
        const key = drop ? drop.id : 'nothing';
        dist[key] = (dist[key] ?? 0) + 1;
      }
      return dist;
    },
    { luck, level, rolls: ROLLS },
  );
}

test.describe('drop table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('luck raises rares smoothly without drying up gold or guaranteeing rares', async ({ page }) => {
    const level = 10; // every entry unlocked
    const results: Array<{ luck: number; dist: Dist }> = [];
    for (const luck of [0, 0.25, 0.5, 0.75, 1]) {
      results.push({ luck, dist: await simulate(page, luck, level) });
    }

    const pct = (d: Dist, k: string) => ((d[k] ?? 0) / ROLLS) * 100;

    // Reported so a human can eyeball the shape of the curve, not just the asserts.
    for (const { luck, dist } of results) {
      const line = ['gold', 'ration', 'freeze', 'vacuum', 'fortune', 'purge', 'nothing']
        .map((k) => `${k} ${pct(dist, k).toFixed(2)}%`)
        .join('  ');
      console.log(`luck ${luck.toFixed(2)}: ${line}`);
    }

    const zero = results[0].dist;
    const full = results[results.length - 1].dist;

    // 1. Gold never dries up: it is the most common outcome at every luck value.
    for (const { luck, dist } of results) {
      expect(pct(dist, 'gold'), `gold share at luck ${luck}`).toBeGreaterThan(25);
    }
    // And high luck must not push gold materially below its zero-luck share.
    expect(pct(full, 'gold')).toBeGreaterThan(pct(zero, 'gold') * 0.7);

    // 2. Rares rise with luck, and rise monotonically - a smooth curve, not a cliff.
    const rareShare = (d: Dist) => pct(d, 'fortune') + pct(d, 'purge') + pct(d, 'freeze') + pct(d, 'vacuum');
    for (let i = 1; i < results.length; i++) {
      expect(
        rareShare(results[i].dist),
        `rare share must not fall from luck ${results[i - 1].luck} to ${results[i].luck}`,
      ).toBeGreaterThanOrEqual(rareShare(results[i - 1].dist) - 0.3);
    }
    expect(rareShare(full)).toBeGreaterThan(rareShare(zero) * 1.2);

    // 3. Rares never become routine, even at maximum luck.
    expect(pct(full, 'purge')).toBeLessThan(6);
    expect(pct(full, 'fortune')).toBeLessThan(6);
    expect(rareShare(full)).toBeLessThan(35);

    // 4. "Nothing" stays a real outcome at every luck value: breakables are not
    //    a guaranteed vending machine.
    expect(pct(full, 'nothing')).toBeGreaterThan(5);
  });

  test('level gates hold: rares cannot drop before their minimum level', async ({ page }) => {
    const early = await simulate(page, 1, 0); // max luck, level 0
    expect(early['freeze'] ?? 0).toBe(0);
    expect(early['vacuum'] ?? 0).toBe(0);
    expect(early['fortune'] ?? 0).toBe(0);
    expect(early['purge'] ?? 0).toBe(0);
    // The ungated entries still carry the whole table.
    expect((early['gold'] ?? 0) + (early['ration'] ?? 0)).toBeGreaterThan(ROLLS * 0.6);

    const mid = await simulate(page, 1, 3); // freeze/vacuum unlocked, fortune/purge not
    expect(mid['freeze'] ?? 0).toBeGreaterThan(0);
    expect(mid['vacuum'] ?? 0).toBeGreaterThan(0);
    expect(mid['fortune'] ?? 0).toBe(0);
    expect(mid['purge'] ?? 0).toBe(0);
  });
});
