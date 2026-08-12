import { test, expect } from '@playwright/test';

/**
 * Mechanics tests for the power pass. These drive the REAL running game and
 * assert on what it actually does - projectile counts, launch directions,
 * damaged-vs-drawn radii - rather than on whether a constant exists in a
 * source file.
 */

type Page = import('@playwright/test').Page;

async function startRun(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__!.seed(4242);
    window.__THREE_GAME_TEST_HOOKS__!.setState('active-play');
    window.__THREE_GAME_TEST_HOOKS__!.setGodMode(true);
  });
  await page.waitForTimeout(300);
}

/** Isolate one weapon at a level with dummy targets around the player. */
async function showcase(page: Page, id: string, level: number | 'evolved') {
  const info = await page.evaluate(
    ([w, l]) => window.__THREE_GAME_TEST_HOOKS__!.powerShowcase(w as string, l as number | 'evolved'),
    [id, level] as const,
  );
  await page.waitForTimeout(250);
  return info;
}

test.describe('power mechanics', () => {
  // -------------------------------------------------------------------------
  // WHIP: a FIXED horizontal side that movement must never change.
  // -------------------------------------------------------------------------
  test('whip Lv1 strikes only one fixed side, in every movement direction', async ({ page }) => {
    await startRun(page);
    await showcase(page, 'whip_strike', 1);

    const e = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.getWeaponEffect('whip_strike', 1));
    expect(e.sides).toBe(1);

    // Sample which side the slash sprite appears on while walking each way.
    // The slash is spawned at playerX + side*reach*0.5, so its sign relative
    // to the player is the side that was struck.
    const dirs: Array<[string, string]> = [
      ['ArrowUp', 'up'],
      ['ArrowDown', 'down'],
      ['ArrowLeft', 'left'],
      ['ArrowRight', 'right'],
    ];
    const sidesSeen = new Set<string>();
    for (const [key] of dirs) {
      await page.keyboard.down(key);
      for (let i = 0; i < 14; i++) {
        await page.waitForTimeout(80);
        const sides = await page.evaluate(() => {
          const hooks = window.__THREE_GAME_TEST_HOOKS__!;
          const p = hooks.getProjectileCensus('whip_strike');
          const diag = window.__THREE_GAME_DIAGNOSTICS__!;
          return p.map((q) => (q.x - diag.player.position.x > 0 ? 'right' : 'left'));
        });
        for (const s of sides) sidesSeen.add(s);
      }
      await page.keyboard.up(key);
      await page.waitForTimeout(120);
    }
    // Diagonals too.
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowLeft');
    for (let i = 0; i < 14; i++) {
      await page.waitForTimeout(80);
      const sides = await page.evaluate(() => {
        const hooks = window.__THREE_GAME_TEST_HOOKS__!;
        const p = hooks.getProjectileCensus('whip_strike');
        const diag = window.__THREE_GAME_DIAGNOSTICS__!;
        return p.map((q) => (q.x - diag.player.position.x > 0 ? 'right' : 'left'));
      });
      for (const s of sides) sidesSeen.add(s);
    }
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('ArrowUp');

    expect(sidesSeen.size).toBeGreaterThan(0); // it actually swung
    expect(Array.from(sidesSeen)).toEqual(['right']); // and only ever to the right
  });

  test('whip Lv2 strikes both sides', async ({ page }) => {
    await startRun(page);
    await showcase(page, 'whip_strike', 2);
    const e = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.getWeaponEffect('whip_strike', 2));
    expect(e.sides).toBe(2);

    const sidesSeen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(60);
      const sides = await page.evaluate(() => {
        const p = window.__THREE_GAME_TEST_HOOKS__!.getProjectileCensus('whip_strike');
        const diag = window.__THREE_GAME_DIAGNOSTICS__!;
        return p.map((q) => (q.x - diag.player.position.x > 0 ? 'right' : 'left'));
      });
      for (const s of sides) sidesSeen.add(s);
    }
    expect(sidesSeen.has('right')).toBe(true);
    expect(sidesSeen.has('left')).toBe(true);
  });

  test('whip never strikes vertically: the band stays horizontal', async ({ page }) => {
    await startRun(page);
    await showcase(page, 'whip_strike', 2);
    // Every slash instance must sit on the player's own Z line (the band only
    // ever extends along X), no matter which way the player is walking.
    // Sampled across the whole hold: a lash is only on screen for a fraction
    // of each cooldown, so a single snapshot can legitimately catch none.
    await page.keyboard.down('ArrowUp');
    const offsets: number[] = [];
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(50);
      const dz = await page.evaluate(() => {
        const p = window.__THREE_GAME_TEST_HOOKS__!.getProjectileCensus('whip_strike');
        const diag = window.__THREE_GAME_DIAGNOSTICS__!;
        return p.map((q) => Math.abs(q.z - diag.player.position.z));
      });
      offsets.push(...dz);
    }
    await page.keyboard.up('ArrowUp');

    expect(offsets.length).toBeGreaterThan(0); // it actually lashed while moving up
    for (const dz of offsets) expect(dz).toBeLessThan(0.001);
  });

  // -------------------------------------------------------------------------
  // AXE: fixed upward arc, count 1 / 2 / 3 at Lv1 / Lv2 / Lv5.
  // -------------------------------------------------------------------------
  for (const [level, expected] of [
    [1, 1],
    [2, 2],
    [5, 3],
  ] as Array<[number, number]>) {
    test(`axe throws ${expected} axe(s) at Lv${level}`, async ({ page }) => {
      await startRun(page);
      const info = await showcase(page, 'axe_throw', level);
      expect(info.effect.projectiles).toBe(expected);

      // Count how many axes are in the air right after a volley. Sampling the
      // peak avoids catching a half-expired previous volley.
      let peak = 0;
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(50);
        const n = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.getProjectileCensus('axe_throw').length);
        peak = Math.max(peak, n);
      }
      expect(peak).toBeGreaterThanOrEqual(expected);
    });
  }

  test('axe trajectory stays upward regardless of movement direction', async ({ page }) => {
    await startRun(page);
    await showcase(page, 'axe_throw', 1);
    for (const key of ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp']) {
      await page.keyboard.down(key);
      await page.waitForTimeout(400);
      const vels = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.getProjectileCensus('axe_throw'));
      await page.keyboard.up(key);
      for (const v of vels) {
        // -Z is "up the screen". Every axe must be travelling that way.
        expect(v.vz).toBeLessThan(0);
        // and essentially straight up: |vx| must be small next to |vz|.
        expect(Math.abs(v.vx)).toBeLessThan(Math.abs(v.vz));
      }
    }
  });

  // -------------------------------------------------------------------------
  // KNIFE: the one weapon that DOES follow movement.
  // -------------------------------------------------------------------------
  test('knife follows the movement direction', async ({ page }) => {
    await startRun(page);
    await showcase(page, 'knife_throw', 1);

    // Sample DURING the hold: Lv1 knives have no pierce, so each one dies on
    // the first showcase dummy it reaches and a single sample at the end can
    // legitimately catch an empty field.
    const sample = async (key: string, ms: number): Promise<number[]> => {
      const seen: number[] = [];
      await page.keyboard.down(key);
      const end = Date.now() + ms;
      while (Date.now() < end) {
        await page.waitForTimeout(50);
        const vx = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.getProjectileCensus('knife_throw').map((k) => k.vx));
        seen.push(...vx);
      }
      await page.keyboard.up(key);
      return seen;
    };

    const right = await sample('ArrowRight', 900);
    expect(right.length).toBeGreaterThan(0);
    expect(right.some((vx) => vx > 1)).toBe(true);

    await page.waitForTimeout(500);
    const left = await sample('ArrowLeft', 900);
    expect(left.length).toBeGreaterThan(0);
    expect(left.some((vx) => vx < -1)).toBe(true);
  });

  test('knife count steps 1 / 2 / 3 / 4 at Lv1 / 2 / 4 / 7', async ({ page }) => {
    await startRun(page);
    for (const [level, expected] of [
      [1, 1],
      [2, 2],
      [4, 3],
      [7, 4],
    ] as Array<[number, number]>) {
      const info = await showcase(page, 'knife_throw', level);
      expect(info.effect.projectiles).toBe(expected);
    }
  });

  // -------------------------------------------------------------------------
  // HOLY BLADES: 1 / 2 / 3 / 4 / 5 blades, countable on screen.
  // -------------------------------------------------------------------------
  test('holy blades orbit 1 / 2 / 3 / 4 / 5 at Lv1 / 2 / 4 / 6 / 8', async ({ page }) => {
    await startRun(page);
    for (const [level, expected] of [
      [1, 1],
      [2, 2],
      [4, 3],
      [6, 4],
      [8, 5],
    ] as Array<[number, number]>) {
      const info = await showcase(page, 'orbiter_blades', level);
      expect(info.effect.blades).toBe(expected);
      await page.waitForTimeout(300);
      const live = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.getProjectileCensus('orbiter_blades').length);
      expect(live).toBe(expected);
    }
  });

  // -------------------------------------------------------------------------
  // GARLIC: the drawn aura must be the damaging aura.
  // -------------------------------------------------------------------------
  test('garlic visual radius equals its damage radius, and grows with level', async ({ page }) => {
    await startRun(page);
    const radii: number[] = [];
    for (const level of [1, 2, 4, 7]) {
      const info = await showcase(page, 'garlic_aura', level);
      await page.waitForTimeout(200);
      const drawn = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.getGroundRingRadii());
      // Exactly one ring belongs to the aura, and it matches the stat radius.
      expect(drawn.length).toBeGreaterThan(0);
      expect(drawn[0]).toBeCloseTo(info.effect.radius as number, 3);
      radii.push(info.effect.radius as number);
    }
    // and it visibly grows across those milestones
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
  });

  // -------------------------------------------------------------------------
  // SINGLE SOURCE OF TRUTH: the card text is derived from the real table.
  // -------------------------------------------------------------------------
  test('level-up card claims match the simulation numbers', async ({ page }) => {
    await startRun(page);
    const checks = await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__!;
      return {
        whip12: h.getLevelDiff('whip_strike', 1, 2),
        axe12: h.getLevelDiff('axe_throw', 1, 2),
        axe45: h.getLevelDiff('axe_throw', 4, 5),
        orbiter34: h.getLevelDiff('orbiter_blades', 3, 4),
        axeEffect1: h.getWeaponEffect('axe_throw', 1),
        axeEffect2: h.getWeaponEffect('axe_throw', 2),
      };
    });

    // Whip 1->2 must headline the new opposite-side attack, not a damage bump.
    expect(checks.whip12[0].field).toBe('sides');
    expect(checks.whip12[0].detail).toContain('ambos lados');

    // Axe 1->2 must headline +1 projectile, and the numbers must be real.
    expect(checks.axe12[0].field).toBe('projectiles');
    expect(checks.axe12[0].detail).toBe('1 → 2 proyectiles');
    expect(checks.axeEffect1.projectiles).toBe(1);
    expect(checks.axeEffect2.projectiles).toBe(2);

    // Axe 4->5 is the second count milestone.
    expect(checks.axe45[0].field).toBe('projectiles');
    expect(checks.axe45[0].detail).toBe('2 → 3 proyectiles');

    // Orbiter 3->4 adds a blade.
    expect(checks.orbiter34[0].field).toBe('blades');
    expect(checks.orbiter34[0].detail).toBe('2 → 3 hojas');
  });

  test('every weapon has a perceptible change at least every 3 levels', async ({ page }) => {
    await startRun(page);
    const ids = [
      'magic_wand',
      'knife_throw',
      'axe_throw',
      'fireball',
      'garlic_aura',
      'orbiter_blades',
      'whip_strike',
      'arc_cross',
      'ember_wand',
      'rune_shard',
      'hex_flask',
    ];
    const report = await page.evaluate((list) => {
      const h = window.__THREE_GAME_TEST_HOOKS__!;
      // A "perceptible" change is a countable/spatial one, not just a damage tick.
      const PERCEPTIBLE = ['sides', 'projectiles', 'blades', 'pierce', 'radius', 'halfWidth', 'turns', 'duration'];
      return list.map((id) => {
        let longestGap = 0;
        let gap = 0;
        for (let lv = 2; lv <= 8; lv++) {
          const changes = h.getLevelDiff(id, lv - 1, lv);
          if (changes.some((c) => PERCEPTIBLE.includes(c.field))) gap = 0;
          else gap += 1;
          longestGap = Math.max(longestGap, gap);
        }
        return { id, longestGap };
      });
    }, ids);

    for (const row of report) {
      expect(row.longestGap, `${row.id} went ${row.longestGap} levels with no perceptible change`).toBeLessThanOrEqual(2);
    }
  });
});
