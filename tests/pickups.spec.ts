import { test, expect, type Page } from '@playwright/test';

/**
 * PICKUPS IN REAL GAMEPLAY
 *
 * The drop-table spec proves the maths. This one proves the game: a live run,
 * real props, real enemies, real collection. Each effect is asserted through
 * observable state (health, frozen count, magnetised gems, live enemies),
 * never by checking that a function was called.
 */

async function startRun(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__!.seed(4242);
    window.__THREE_GAME_TEST_HOOKS__!.setState('active-play');
    window.__THREE_GAME_TEST_HOOKS__!.setGodMode(true);
  });
  await page.waitForTimeout(400);
}

/**
 * Walks the player to the nearest pickup with real key input. Pickups only
 * magnetise from ~4 world units, and breakables spawn well outside that, so
 * reaching one is a genuine act of movement - which is exactly what this
 * asserts. Returns true once the pickup count drops.
 */
async function walkToNearestPickup(page: Page, timeoutMs = 9000): Promise<boolean> {
  const start = Date.now();
  const held = new Set<string>();
  const press = async (keys: string[]) => {
    for (const k of [...held]) {
      if (!keys.includes(k)) {
        await page.keyboard.up(k);
        held.delete(k);
      }
    }
    for (const k of keys) {
      if (!held.has(k)) {
        await page.keyboard.down(k);
        held.add(k);
      }
    }
  };

  try {
    const initial = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.listPickups().length);
    while (Date.now() - start < timeoutMs) {
      const nav = await page.evaluate(() => {
        const hooks = window.__THREE_GAME_TEST_HOOKS__!;
        const list = hooks.listPickups();
        const p = window.__THREE_GAME_DIAGNOSTICS__!.player.position;
        if (list.length === 0) return { count: 0, dx: 0, dz: 0 };
        let best = list[0];
        let bestD = Infinity;
        for (const q of list) {
          const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = q;
          }
        }
        return { count: list.length, dx: best.x - p.x, dz: best.z - p.z };
      });
      if (nav.count < initial) return true;

      const keys: string[] = [];
      if (nav.dx > 0.3) keys.push('KeyD');
      else if (nav.dx < -0.3) keys.push('KeyA');
      if (nav.dz > 0.3) keys.push('KeyS');
      else if (nav.dz < -0.3) keys.push('KeyW');
      await press(keys);
      await page.waitForTimeout(120);
    }
    return false;
  } finally {
    for (const k of held) await page.keyboard.up(k);
  }
}

test.describe('pickups', () => {
  test('a destroyed breakable can drop a pickup, and pickups are collectable', async ({ page }) => {
    await startRun(page);

    // Break breakables until the table yields something. With ~76% non-empty
    // odds, 12 attempts failing would be a real bug, not bad luck.
    const result = await page.evaluate(async () => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      let broke = 0;
      for (let i = 0; i < 12; i++) {
        const r = hooks.breakNearestProp();
        if (!r.broke) break;
        broke++;
        if (hooks.listPickups().length > 0) break;
        await new Promise((res) => setTimeout(res, 60));
      }
      return { broke, pickups: hooks.listPickups().length };
    });

    expect(result.broke, 'the stage must contain breakables to destroy').toBeGreaterThan(0);
    expect(result.pickups, 'breakables must be able to drop pickups').toBeGreaterThan(0);

    // And walking to one must collect it. Deliberately NOT a wait: pickups
    // magnetise from ~4 units, so a dropped relic across the field has to be
    // fetched, and this proves the whole loop rather than just the timer.
    const collected = await walkToNearestPickup(page);
    expect(collected, 'walking onto a dropped pickup must collect it').toBe(true);
  });

  test('Hunter\'s Ration heals, and never past max HP', async ({ page }) => {
    await startRun(page);

    const healed = await page.evaluate(async () => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      const diag = () => window.__THREE_GAME_DIAGNOSTICS__!;
      // Hurt the player first so there is room to heal. Diagnostics are a
      // once-per-frame snapshot, so read the "before" value only after the
      // damage has actually been published to a frame.
      hooks.damagePlayer(60, true);
      await new Promise((res) => setTimeout(res, 200));
      const before = diag().health;
      hooks.spawnPickup('ration', 0.4, 0);
      await new Promise((res) => setTimeout(res, 900));
      return { before, after: diag().health, max: diag().maxHealth };
    });

    expect(healed.before, 'the player must actually be wounded first').toBeLessThan(healed.max);
    expect(healed.after, 'the ration must heal').toBeGreaterThan(healed.before);
    expect(healed.after).toBeLessThanOrEqual(healed.max);

    // At full health it must clamp rather than overheal.
    const clamped = await page.evaluate(async () => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      const diag = () => window.__THREE_GAME_DIAGNOSTICS__!;
      for (let i = 0; i < 4; i++) {
        hooks.spawnPickup('ration', 0.4, 0);
        await new Promise((res) => setTimeout(res, 500));
      }
      return { health: diag().health, max: diag().maxHealth };
    });
    expect(clamped.health, 'repeated rations must top out at max HP, never above').toBe(clamped.max);
  });

  test('Sepulchral Frost stops the horde, then releases it', async ({ page }) => {
    await startRun(page);

    const frozen = await page.evaluate(async () => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.spawnEnemies(40);
      await new Promise((res) => setTimeout(res, 300));
      hooks.spawnPickup('freeze', 0.4, 0);
      await new Promise((res) => setTimeout(res, 800));
      const during = hooks.getFrozenCount();
      // Sample twice a second apart to confirm the freeze is a timer, not permanent.
      await new Promise((res) => setTimeout(res, 3600));
      return { during, after: hooks.getFrozenCount() };
    });

    expect(frozen.during, 'the frost must freeze the live horde').toBeGreaterThan(10);
    expect(frozen.after, 'the freeze must expire').toBe(0);
  });

  test('Soul Call magnetises every loose gem', async ({ page }) => {
    await startRun(page);

    const pulled = await page.evaluate(async () => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      // Spawn a horde far enough out that their gems land outside magnet range.
      hooks.spawnEnemies(60);
      await new Promise((res) => setTimeout(res, 200));
      hooks.killAllEnemies();
      await new Promise((res) => setTimeout(res, 150));
      const before = hooks.getMagnetizedGemCount();
      const gems = window.__THREE_GAME_DIAGNOSTICS__!.gemCount;
      hooks.spawnPickup('vacuum', 0.4, 0);
      await new Promise((res) => setTimeout(res, 700));
      return { before, gems, after: hooks.getMagnetizedGemCount() };
    });

    expect(pulled.gems, 'kills must have left gems on the ground').toBeGreaterThan(5);
    expect(pulled.after, 'the soul call must magnetise gems that were not already inbound').toBeGreaterThan(pulled.before);
  });

  test('Purge Bell clears the screen through the normal death path, crediting kills and gems', async ({ page }) => {
    await startRun(page);

    const purge = await page.evaluate(async () => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      const diag = () => window.__THREE_GAME_DIAGNOSTICS__!;
      hooks.spawnEnemies(80);
      await new Promise((res) => setTimeout(res, 300));
      const before = { enemies: diag().enemyCount, kills: diag().kills, gems: diag().gemCount };
      hooks.spawnPickup('purge', 0.4, 0);
      await new Promise((res) => setTimeout(res, 900));
      const after = { enemies: diag().enemyCount, kills: diag().kills, gems: diag().gemCount };
      return { before, after };
    });

    expect(purge.before.enemies).toBeGreaterThan(40);
    expect(purge.after.enemies, 'the bell must clear the regular horde').toBeLessThan(purge.before.enemies * 0.2);
    // The whole point of routing through damage() instead of wiping arrays:
    // these deaths must count and must drop XP like any other kill.
    expect(purge.after.kills, 'purged enemies must count as kills').toBeGreaterThan(purge.before.kills + 40);
    expect(purge.after.gems, 'purged enemies must still drop gems').toBeGreaterThan(purge.before.gems);
  });

  test('Fortune Coin raises luck without exceeding the cap', async ({ page }) => {
    await startRun(page);

    const luck = await page.evaluate(async () => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      const diag = () => window.__THREE_GAME_DIAGNOSTICS__!;
      const before = diag().luck;
      hooks.spawnPickup('fortune', 0.4, 0);
      await new Promise((res) => setTimeout(res, 800));
      const after = diag().luck;
      // Hammer it well past the cap to prove the clamp.
      for (let i = 0; i < 30; i++) {
        hooks.spawnPickup('fortune', 0.4, 0);
        await new Promise((res) => setTimeout(res, 90));
      }
      await new Promise((res) => setTimeout(res, 600));
      return { before, after, capped: diag().luck };
    });

    expect(luck.after, 'the coin must raise luck').toBeGreaterThan(luck.before);
    expect(luck.capped, 'luck must stay clamped to its 0..1 range').toBeLessThanOrEqual(1);
  });

  test('collecting gold credits meta gold', async ({ page }) => {
    await startRun(page);

    const gold = await page.evaluate(async () => {
      const diag = () => window.__THREE_GAME_DIAGNOSTICS__!;
      const before = diag().gold;
      window.__THREE_GAME_TEST_HOOKS__!.spawnPickup('gold', 0.4, 0);
      await new Promise((res) => setTimeout(res, 800));
      return { before, after: diag().gold };
    });

    expect(gold.after).toBeGreaterThan(gold.before);
  });
});
