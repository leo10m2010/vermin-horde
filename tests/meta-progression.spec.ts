import { test, expect, type Page } from '@playwright/test';

/**
 * META-PROGRESSION: THE CORE LOOP
 *
 *   RUN -> EARN GOLD -> BUY PERMANENT POWER -> BE STRONGER NEXT RUN
 *
 * The bar for every test in this file is the one thing that actually matters:
 * THE PLAYER RECEIVES IN GAMEPLAY WHAT THEY PAID FOR. Asserting
 * `stats.foo === value` is explicitly NOT enough - `stats.foo` was already
 * correct for Second Wind while the upgrade did nothing at all. So each
 * upgrade is measured by its effect: distance actually walked, HP actually
 * lost to a hit, HP actually regenerated, gold actually banked, projectiles
 * actually flying faster, a death actually survived.
 *
 * Purchases go through the REAL shop: the real gold balance, the real
 * `buyUpgrade`, the real persisted profile, the real Buy button in the DOM.
 * Nothing here writes to `state.stats` to fake a purchase.
 *
 * Every comparison is same-seed, same-character, same-stage, so the only
 * difference between the "before" and "after" measurement is the purchase.
 */

const SEED = 20260813;
const CHARACTER = 'thornguard';

/**
 * Boots the app on a clean profile: no gold, no upgrades, nothing persisted.
 * Playwright gives every test its own browser context, so localStorage starts
 * empty on its own - which is also what makes the reload test below meaningful.
 */
async function bootClean(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  const level = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.getUpgradeLevel('ancestral_vigor'));
  expect(level, 'each test must start from an empty shop profile').toBe(0);
}

/** Starts a run under fixed conditions so two measurements are comparable. */
async function startRun(page: Page, opts: { god?: boolean; character?: string } = {}): Promise<void> {
  await page.evaluate(
    ([seed, character, god]) => {
      const h = window.__THREE_GAME_TEST_HOOKS__!;
      h.seed(seed as number);
      h.selectCharacter(character as string);
      h.setState('active-play');
      h.setGodMode(Boolean(god));
    },
    [SEED, opts.character ?? CHARACTER, opts.god ?? false] as const,
  );
  await page.waitForTimeout(500);
}

/**
 * Buys `levels` of an upgrade through the real shop UI: opens it, credits
 * enough gold to afford the card, and clicks the actual Buy button.
 */
async function buyInShop(page: Page, upgradeId: string, levels = 1): Promise<void> {
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.grantGold(500000));
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('menu'));
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^(Mejoras|Upgrades)$/ }).first().click();
  await expect(page.locator('.shop-panel'), 'the real shop must open').toBeVisible();

  const card = page.locator(`.shop-card[data-upgrade-id="${upgradeId}"]`);
  await expect(card, `shop must offer ${upgradeId}`).toHaveCount(1);
  for (let i = 0; i < levels; i++) {
    await card.locator('.shop-buy-btn').click();
    await page.waitForTimeout(120);
  }

  const owned = await page.evaluate((id) => window.__THREE_GAME_TEST_HOOKS__!.getUpgradeLevel(id), upgradeId);
  expect(owned, `${upgradeId} must actually be owned after buying`).toBe(levels);

  await page.locator('.shop-close-btn').click();
  await page.waitForTimeout(300);
}

const diag = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!);

/**
 * Resolves any open level-up picker until the run is actually simulating.
 * Necessary before measuring damage: `applyPlayerDamage` early-returns unless
 * the phase is 'playing', so a queued level-up silently swallows the hit.
 */
async function settleToPlaying(page: Page): Promise<void> {
  for (let i = 0; i < 12; i++) {
    if ((await diag(page)).phase === 'playing') return;
    const card = page.locator('.ui-upgrade-card').first();
    if (await card.count()) await card.click();
    await page.waitForTimeout(350);
  }
  expect((await diag(page)).phase, 'the run must be simulating before we measure it').toBe('playing');
}

/** Holds a key for a while and reports how far the player actually travelled. */
async function walkDistance(page: Page, key: string, ms: number): Promise<number> {
  const from = (await diag(page)).player.position;
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  const to = (await diag(page)).player.position;
  return Math.hypot(to.x - from.x, to.z - from.z);
}

/** HP actually lost to one raw hit, measured through the real damage path. */
async function hpLostToHit(page: Page, raw: number): Promise<number> {
  await page.waitForTimeout(700); // clear any i-frames
  const before = (await diag(page)).health;
  await page.evaluate((amount) => window.__THREE_GAME_TEST_HOOKS__!.damagePlayer(amount), raw);
  await page.waitForTimeout(200);
  const after = (await diag(page)).health;
  return before - after;
}

test.describe('meta-progression: the player gets what they paid for', () => {
  test.slow();

  test('Second Wind: a lethal hit is survived, and the SAME run continues', async ({ page }) => {
    await bootClean(page);

    // BEFORE: no charge, a lethal hit ends the run.
    await startRun(page);
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.damagePlayer(99999, true));
    await page.waitForTimeout(500);
    expect((await diag(page)).phase, 'without the upgrade, a lethal hit is fatal').toBe('gameover');

    // BUY through the real shop.
    await buyInShop(page, 'second_wind');

    // AFTER: same seed, same character. Build a run worth preserving first.
    await startRun(page, { god: true });
    await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__!;
      h.addWeapon('axe_throw');
      h.grantPassive('passive_damage');
      h.grantLevels(3);
      h.spawnEnemies(200);
    });
    await page.waitForTimeout(1500);
    await settleToPlaying(page);

    const before = await diag(page);
    expect(before.reviveCharges, 'the run must start holding the purchased charge').toBe(1);
    const weaponsBefore = await page.evaluate(() => document.querySelectorAll('.hud-power-slot--filled').length);

    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setGodMode(false));
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.damagePlayer(99999, true));
    await page.waitForTimeout(600);
    const after = await diag(page);

    // A RESURRECTION, not a restart.
    expect(after.phase, 'the lethal hit must be survived').toBe('playing');
    expect(after.reviveCharges, 'exactly one charge is consumed').toBe(0);
    // 75% of max, give or take whatever regeneration ticked during the
    // measurement window (the level-up above can hand out a regen passive).
    const revivedTo = Math.round(after.maxHealth * 0.75);
    expect(after.health, 'HP is restored to 75% of max').toBeGreaterThanOrEqual(revivedTo);
    expect(after.health, 'and not to full - it is a revive, not a heal').toBeLessThan(revivedTo + 3);
    expect(after.elapsed, 'the run clock must not restart').toBeGreaterThanOrEqual(before.elapsed);
    expect(after.level, 'the level must be kept').toBe(before.level);
    expect(after.kills, 'the kill count must be kept').toBeGreaterThanOrEqual(before.kills);
    expect(after.enemyCount, 'the horde must still be there').toBeGreaterThan(0);
    const weaponsAfter = await page.evaluate(() => document.querySelectorAll('.hud-power-slot--filled').length);
    expect(weaponsAfter, 'the build must be kept').toBe(weaponsBefore);

    // The charge is spent: the NEXT lethal hit is fatal. Clear the horde
    // first so the death is unambiguously caused by the hit below.
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.clearEnemies());
    await page.waitForTimeout(2800); // outlast the revive i-frames
    await settleToPlaying(page);
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.damagePlayer(99999, true));
    await page.waitForTimeout(600);
    expect((await diag(page)).phase, 'a spent charge does not revive twice').toBe('gameover');
  });

  test('Ancestral Vigor: a bigger real HP pool that survives more punishment', async ({ page }) => {
    await bootClean(page);

    // Warden on purpose: Thornguard/Redline/Steadyhand all MULTIPLY max HP in
    // their trait, which would turn "+36 flat" into +50.4 and hide whether the
    // flat amount itself is right. Warden's trait leaves max HP alone, so the
    // number here is the upgrade's own contribution and nothing else.
    const HERO = 'warden';
    await startRun(page, { character: HERO });
    const base = await diag(page);

    await buyInShop(page, 'ancestral_vigor', 3); // +36 max HP
    await startRun(page, { character: HERO });
    const upgraded = await diag(page);

    expect(upgraded.maxHealth - base.maxHealth, '3 levels must add exactly 3 x 12 HP').toBe(36);
    expect(upgraded.health, 'the run must START at the new full pool').toBe(upgraded.maxHealth);
    const hudText = await page.locator('#health-text').innerText();
    expect(hudText, 'the HUD must show the upgraded pool').toBe(
      `${Math.ceil(upgraded.health)}/${Math.ceil(upgraded.maxHealth)}`,
    );

    // Behavioural: damage that is fatal on the base pool is survivable now.
    const lethalForBase = Math.ceil(base.maxHealth) + 5;
    await page.evaluate((d) => window.__THREE_GAME_TEST_HOOKS__!.damagePlayer(d, true), lethalForBase);
    await page.waitForTimeout(500);
    expect((await diag(page)).phase, 'the extra HP must actually absorb a would-be lethal hit').toBe('playing');
  });

  test('Wardstone: each level really removes 1 point from every hit taken', async ({ page }) => {
    await bootClean(page);

    await startRun(page, { god: false });
    const baseLoss = await hpLostToHit(page, 40);

    await buyInShop(page, 'wardstone', 4); // +4 armor
    await startRun(page, { god: false });
    const armouredLoss = await hpLostToHit(page, 40);

    expect(baseLoss, 'baseline hit must land').toBeGreaterThan(0);
    expect(baseLoss - armouredLoss, '4 levels of armor must absorb 4 more damage per hit').toBe(4);
  });

  test('Grave Boots: the player physically covers more ground per second', async ({ page }) => {
    await bootClean(page);

    await startRun(page, { god: true });
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.clearEnemies());
    const baseDistance = await walkDistance(page, 'KeyD', 1200);

    await buyInShop(page, 'grave_boots', 8); // +0.96 move speed
    await startRun(page, { god: true });
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.clearEnemies());
    const fastDistance = await walkDistance(page, 'KeyD', 1200);

    expect(baseDistance, 'the player must actually move in the baseline').toBeGreaterThan(1);
    expect(fastDistance, 'the same 1.2s walk must cover more ground').toBeGreaterThan(baseDistance * 1.1);
  });

  test('Spirit Regen: HP genuinely ticks back up over time', async ({ page }) => {
    await bootClean(page);

    await startRun(page, { god: true });
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.clearEnemies());
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.damagePlayer(60, true));
    await page.waitForTimeout(200);
    const baseStart = (await diag(page)).health;
    await page.waitForTimeout(4000);
    const baseEnd = (await diag(page)).health;
    expect(baseEnd - baseStart, 'with no upgrade there is no regeneration at all').toBeLessThan(0.5);

    await buyInShop(page, 'spirit_regen', 6); // +0.9 HP/s
    await startRun(page, { god: true });
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.clearEnemies());
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.damagePlayer(60, true));
    await page.waitForTimeout(200);
    const regenStart = (await diag(page)).health;
    await page.waitForTimeout(4000);
    const regenEnd = (await diag(page)).health;

    const healed = regenEnd - regenStart;
    // 0.9 HP/s over ~4s ≈ 3.6; allow for frame timing either side.
    expect(healed, 'the player must actually heal').toBeGreaterThan(2.5);
    expect(healed, 'and heal at roughly the advertised rate, not faster').toBeLessThan(5.5);
  });

  test('Fleet Step: projectiles in flight are measurably faster', async ({ page }) => {
    await bootClean(page);

    const measureSpeed = async (): Promise<number> => {
      const added = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.addWeapon('knife_throw'));
      expect(added, 'the knife must actually be equipped').toBe(true);

      // Sampled in a poll rather than one shot: knives are short-lived, and
      // every level-up the run earns freezes the simulation until the picker
      // is answered - so a single fixed wait can easily land on a paused frame
      // with nothing in the air.
      const speeds: number[] = [];
      for (let i = 0; i < 25 && speeds.length < 8; i++) {
        await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.spawnEnemies(60));
        await settleToPlaying(page);
        await page.waitForTimeout(220);
        const sample = await page.evaluate(() =>
          window.__THREE_GAME_TEST_HOOKS__!
            .getProjectileVelocities('knife_throw')
            .map((v) => Math.hypot(v.vx, v.vz)),
        );
        speeds.push(...sample);
      }
      expect(speeds.length, 'knives must actually be in flight').toBeGreaterThan(0);
      return Math.max(...speeds);
    };

    await startRun(page, { god: true });
    const baseSpeed = await measureSpeed();

    await buyInShop(page, 'fleet_step', 6); // +30%
    await startRun(page, { god: true });
    const fastSpeed = await measureSpeed();

    expect(fastSpeed / baseSpeed, '6 levels must speed projectiles up by ~30%').toBeGreaterThan(1.2);
  });

  test('Ember Heart: more damage lands on a controlled dummy', async ({ page }) => {
    await bootClean(page);

    // One weapon, one stationary dummy, one fixed window - so the only
    // variable between the two measurements is the damage multiplier.
    const damageToDummy = async (): Promise<number> => {
      await page.evaluate(() => {
        const h = window.__THREE_GAME_TEST_HOOKS__!;
        h.clearEnemies();
        h.addWeapon('garlic_aura');
      });
      await page.waitForTimeout(300);
      const index = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.spawnEnemyAt(0.6, 0, 'brute'));
      expect(index, 'the dummy must spawn').toBeGreaterThanOrEqual(0);
      const start = await page.evaluate((i) => window.__THREE_GAME_TEST_HOOKS__!.getEnemyHp(i), index);
      await page.waitForTimeout(2600);
      const end = await page.evaluate((i) => window.__THREE_GAME_TEST_HOOKS__!.getEnemyHp(i), index);
      return end.alive ? start.hp - end.hp : start.hp;
    };

    await startRun(page, { god: true });
    const baseDamage = await damageToDummy();

    await buyInShop(page, 'ember_heart', 8); // +24%
    await startRun(page, { god: true });
    const boostedDamage = await damageToDummy();

    expect(baseDamage, 'the baseline must actually hurt the dummy').toBeGreaterThan(0);
    expect(boostedDamage, '8 levels must put visibly more damage on the same dummy').toBeGreaterThan(
      baseDamage * 1.1,
    );
  });

  test("Hunter's Eye: crits actually happen more often in real combat", async ({ page }) => {
    await bootClean(page);

    // Read off the run's own hit/crit tally, which is incremented by the real
    // `enemyHit` event - so this is the crit rate the simulation actually
    // produced, not a re-derivation of the stat that was supposed to cause it.
    const critRate = async (): Promise<number> => {
      await page.evaluate(() => {
        const h = window.__THREE_GAME_TEST_HOOKS__!;
        h.addWeapon('garlic_aura');
        for (let i = 0; i < 5; i++) h.levelUpWeapon('garlic_aura');
      });
      // Sampled in chunks: the aura kills fast, and every level-up it earns
      // pauses the simulation until the picker is answered. Left unattended
      // that starves the sample (the first attempt at this collected 84 hits
      // in six seconds, all of them before the first level-up froze the run).
      let d = await diag(page);
      for (let i = 0; i < 25 && d.hitTally < 2000; i++) {
        await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.spawnEnemies(300));
        await page.waitForTimeout(900);
        await settleToPlaying(page);
        d = await diag(page);
      }
      expect(d.hitTally, 'the sample must be big enough to mean anything').toBeGreaterThan(2000);
      return d.critTally / d.hitTally;
    };

    await startRun(page, { god: true });
    const baseRate = await critRate();

    await buyInShop(page, 'hunters_eye', 8); // +12% -> 4% becomes 16%
    await startRun(page, { god: true });
    const boostedRate = await critRate();

    expect(baseRate, 'baseline crit rate should sit near the 4% base').toBeLessThan(0.09);
    expect(boostedRate, 'the purchased crit chance must show up in real hits').toBeGreaterThan(0.11);
    expect(boostedRate, 'and not overshoot the advertised 16%').toBeLessThan(0.22);
  });

  test('Bone Charm: luck rises AND the drop roll consumer receives it', async ({ page }) => {
    await bootClean(page);

    await startRun(page, { god: true });
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.grantLevels(6)); // clear the drop level gates
    await page.waitForTimeout(400);
    const baseLuck = (await diag(page)).luck;
    const baseRolls = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.simulateDropRolls(20000));

    await buyInShop(page, 'bone_charm', 10); // +20% luck
    await startRun(page, { god: true });
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.grantLevels(6));
    await page.waitForTimeout(400);
    const luckyLuck = (await diag(page)).luck;
    const luckyRolls = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.simulateDropRolls(20000));

    expect(luckyLuck - baseLuck, '10 levels must add 20% luck').toBeCloseTo(0.2, 5);

    // The consumer test: the drop table is rolled with the LIVE run luck, so a
    // luck bonus that never reaches it would leave this histogram unchanged.
    const rareShare = (h: Record<string, number>) => {
      const total = Object.values(h).reduce((a, b) => a + b, 0);
      const rare = (h.freeze ?? 0) + (h.vacuum ?? 0) + (h.purge ?? 0) + (h.fortune ?? 0);
      return rare / total;
    };
    const baseShare = rareShare(baseRolls);
    const luckyShare = rareShare(luckyRolls);
    // eslint-disable-next-line no-console
    console.log(`rare drop share: base ${(baseShare * 100).toFixed(2)}% -> lucky ${(luckyShare * 100).toFixed(2)}%`);
    expect(baseShare, 'rares must be possible at baseline').toBeGreaterThan(0);
    expect(luckyShare, 'luck must measurably shift the real drop distribution').toBeGreaterThan(baseShare * 1.05);
  });

  test('Old Coin Purse: the same kills bank more gold', async ({ page }) => {
    await bootClean(page);

    // Same seed, same enemy count, killed through the normal death path, so
    // the only difference in gold earned is the multiplier.
    const goldFromKills = async (): Promise<number> => {
      await page.evaluate(() => {
        const h = window.__THREE_GAME_TEST_HOOKS__!;
        h.clearEnemies();
        // Brutes, not grunts: gold per kill is round(xpValue * 0.6), so a
        // grunt pays exactly 1 and a +50% multiplier rounds to 2 - a 2.0x
        // ratio produced entirely by integer rounding. A 5-xp enemy pays 3,
        // which leaves room for the multiplier to show its real size.
        h.spawnEnemies(300, 'brute');
      });
      await page.waitForTimeout(700);
      const before = (await diag(page)).gold;
      const killed = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.killAllEnemies());
      expect(killed, 'the kills must actually happen').toBeGreaterThan(250);
      await page.waitForTimeout(400);
      return ((await diag(page)).gold - before) / killed;
    };

    await startRun(page, { god: true });
    const basePerKill = await goldFromKills();

    await buyInShop(page, 'old_coin_purse', 5); // +50%
    await startRun(page, { god: true });
    const boostedPerKill = await goldFromKills();

    expect(basePerKill, 'kills must pay something at baseline').toBeGreaterThan(0);
    const ratio = boostedPerKill / basePerKill;
    // eslint-disable-next-line no-console
    console.log(
      `gold per identical kill: ${basePerKill.toFixed(2)} -> ${boostedPerKill.toFixed(2)} (x${ratio.toFixed(2)})`,
    );
    expect(ratio, '5 levels must pay at least the advertised 1.5x').toBeGreaterThan(1.4);
    // Rounds UP per kill (round(3 * 1.5) = 5, i.e. 1.67x here) but must not be
    // compounding - applying the multiplier twice would land near 2.3x.
    expect(ratio, 'and must not be applied more than once').toBeLessThan(1.8);
  });

  test('purchases survive a reload and re-apply to the next run', async ({ page }) => {
    await bootClean(page);
    await startRun(page);
    const base = await diag(page);

    await buyInShop(page, 'ancestral_vigor', 2);
    await buyInShop(page, 'wardstone', 2);

    // Hard reload: the profile has to come back out of storage on its own.
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
    expect(
      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.getUpgradeLevel('ancestral_vigor')),
      'the purchase must persist across a reload',
    ).toBe(2);

    await startRun(page);
    const after = await diag(page);
    // At least the flat amount bought. Not exactly it: permanent upgrades are
    // applied BEFORE the character trait, and Thornguard's trait multiplies
    // max HP, so 2 x 12 flat arrives as 33.6 on this character. That ordering
    // is deliberate (the trait scales the whole base, upgrades included) and
    // is asserted on its own below.
    expect(after.maxHealth - base.maxHealth, 'and still be applied to the new run').toBeGreaterThanOrEqual(24);
    expect(after.armor - base.armor, 'for every purchased upgrade').toBeGreaterThanOrEqual(2);

    // And it keeps applying, run after run - not just the first one.
    await startRun(page);
    const third = await diag(page);
    expect(third.maxHealth, 'a third run must be just as strong').toBe(after.maxHealth);
    expect(third.armor).toBe(after.armor);
  });

  test('permanent upgrades stack UNDER the character trait, not instead of it', async ({ page }) => {
    await bootClean(page);

    // Thornguard's trait scales max HP, so this is where a wrong ordering
    // between applyToStats() and applyTrait() would show up.
    await startRun(page);
    const base = (await diag(page)).maxHealth;

    await buyInShop(page, 'ancestral_vigor', 5); // +60 flat, before the trait
    await startRun(page);
    const withUpgrade = (await diag(page)).maxHealth;

    expect(withUpgrade, 'the upgrade must survive the trait pass').toBeGreaterThan(base);
    // The trait multiplies, so the gain is at least the flat amount bought.
    expect(withUpgrade - base, 'and must not be silently overwritten by it').toBeGreaterThanOrEqual(60);
  });

  test('GameState.reset() keeps its documented object identity across runs', async ({ page }) => {
    await bootClean(page);
    await startRun(page);

    // The class comment promises consumers may hold these references. Assert
    // it, so the promise cannot quietly become false again.
    const same = await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__!;
      const first = h.getStateIdentity();
      h.setState('active-play'); // a whole new run
      const second = h.getStateIdentity();
      return {
        stats: first.stats === second.stats,
        run: first.run === second.run,
        passives: first.ownedPassives === second.ownedPassives,
      };
    });

    expect(same.stats, 'stats must be mutated in place, not replaced').toBe(true);
    expect(same.run, 'run must be mutated in place, not replaced').toBe(true);
    expect(same.passives, 'ownedPassives must be cleared in place, not replaced').toBe(true);

    // ...and still actually be reset.
    const fresh = await diag(page);
    expect(fresh.kills, 'a new run still starts from zero kills').toBe(0);
    expect(fresh.level, 'and from level 1').toBe(1);
  });
});
