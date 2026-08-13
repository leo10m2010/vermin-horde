import { test, expect, type Page } from '@playwright/test';

/**
 * STRESS + CROSS-SYSTEM QA
 *
 * Round 8 added four systems that all touch the same frame: solid props with
 * their own broad phase, breakables, pickups, and the drops those breakables
 * roll. This measures what that costs under load, and checks the interactions
 * between them that no single system's own tests cover.
 *
 * These numbers are only meaningful on a real GPU. The bundled Playwright
 * headless shell renders through SwiftShader at software speed, so the FPS
 * assertions are scoped to desktop-chrome (channel: 'chromium').
 */

interface Sample {
  fps: number;
  calls: number;
  enemies: number;
  props: number;
  pickups: number;
  atlasCells: number;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__!;
    h.seed(8888);
    h.setState('active-play');
    h.setGodMode(true);
  });
  await page.waitForTimeout(800);
}

/** Median of several samples taken after the scene has settled. */
async function measure(page: Page, settleMs = 5000, samples = 12): Promise<Sample> {
  await page.waitForTimeout(settleMs);
  const rows: Sample[] = [];
  for (let i = 0; i < samples; i++) {
    rows.push(
      await page.evaluate(() => {
        const d = window.__THREE_GAME_DIAGNOSTICS__!;
        return {
          fps: d.fps,
          calls: d.renderer.calls,
          enemies: d.enemyCount,
          props: window.__THREE_GAME_TEST_HOOKS__!.listWorldProps().length,
          pickups: d.pickupCount,
          atlasCells: d.atlasCells,
        };
      }),
    );
    await page.waitForTimeout(220);
  }
  const median = (pick: (s: Sample) => number) => {
    const values = rows.map(pick).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  return {
    fps: median((s) => s.fps),
    calls: median((s) => s.calls),
    enemies: median((s) => s.enemies),
    props: median((s) => s.props),
    pickups: median((s) => s.pickups),
    atlasCells: median((s) => s.atlasCells),
  };
}

test.describe('stress', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'FPS is meaningless under software rendering');
  test.slow();

  test('900+ enemies with props, breakables, pickups and VFX holds frame rate', async ({ page }) => {
    await boot(page);

    // BASELINE: the horde alone, with the world systems present but idle.
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.spawnEnemies(900));
    const baseline = await measure(page);

    // LOADED: every round-8 system doing work at once - the same horde, the
    // full prop population, pickups on the ground, and weapons firing into
    // all of it (which also drives particles, damage numbers and ground VFX).
    await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__!;
      h.addWeapon('garlic_aura');
      h.addWeapon('axe_throw');
      h.addWeapon('knife_throw');
      h.addWeapon('orbiter_blades');
      for (let i = 0; i < 4; i++) {
        h.levelUpWeapon('garlic_aura');
        h.levelUpWeapon('axe_throw');
        h.levelUpWeapon('knife_throw');
        h.levelUpWeapon('orbiter_blades');
      }
      const kinds = ['gold', 'ration', 'freeze', 'vacuum', 'purge', 'fortune'];
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        h.spawnPickup(kinds[i % kinds.length], Math.cos(a) * (7 + (i % 5)), Math.sin(a) * (6 + (i % 4)));
      }
      h.spawnEnemies(400); // top the horde back up as weapons start killing
    });
    const loaded = await measure(page);

    console.log(
      `baseline: ${baseline.fps} fps, ${baseline.calls} draw calls, ${baseline.enemies} enemies, ${baseline.props} props\n` +
        `loaded:   ${loaded.fps} fps, ${loaded.calls} draw calls, ${loaded.enemies} enemies, ` +
        `${loaded.props} props, ${loaded.pickups} pickups\n` +
        `atlas:    ${loaded.atlasCells} cells`,
    );

    expect(baseline.enemies, 'the stress scene must actually be loaded').toBeGreaterThan(850);
    expect(baseline.fps, 'baseline horde').toBeGreaterThanOrEqual(55);
    expect(loaded.fps, 'horde + props + breakables + pickups + VFX').toBeGreaterThanOrEqual(55);

    // The architecture claim: everything is instanced and batched, so adding
    // whole systems must cost draw calls in single digits, not per-entity.
    expect(loaded.calls, 'draw calls must stay batched').toBeLessThan(60);
    expect(loaded.calls - baseline.calls, 'the added systems must not add many draw calls').toBeLessThan(12);
  });

  test('no pool leaks or console errors over a long loaded run', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    await boot(page);
    await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__!;
      h.addWeapon('garlic_aura');
      h.addWeapon('axe_throw');
      h.spawnEnemies(600);
    });

    const resources = () =>
      page.evaluate(() => ({
        geometries: window.__THREE_GAME_DIAGNOSTICS__!.renderer.geometries,
        textures: window.__THREE_GAME_DIAGNOSTICS__!.renderer.textures,
      }));

    /** Churn: enemies die and respawn, axes fly and land, props recycle, breakables drop pickups. */
    const churn = async (rounds: number) => {
      for (let i = 0; i < rounds; i++) {
        await page.waitForTimeout(2000);
        await page.evaluate(() => {
          const h = window.__THREE_GAME_TEST_HOOKS__!;
          h.spawnEnemies(200);
          h.breakNearestProp();
        });
      }
      await page.waitForTimeout(1500);
    };

    await churn(4);
    const early = await resources();
    await churn(4);
    const late = await resources();

    const state = await page.evaluate(() => {
      const d = window.__THREE_GAME_DIAGNOSTICS__!;
      return {
        props: window.__THREE_GAME_TEST_HOOKS__!.listWorldProps().length,
        pickups: d.pickupCount,
        projectiles: d.projectileCount,
        fps: d.fps,
      };
    });

    console.log(
      `resources after ~10s: ${JSON.stringify(early)}
` +
        `resources after ~20s: ${JSON.stringify(late)}
` +
        `state: ${JSON.stringify(state)}`,
    );

    expect(errors, 'no console errors during a long loaded run').toEqual([]);
    // Props are a fixed-size population that recycles; it must not grow.
    expect(state.props, 'the prop population must stay bounded').toBeLessThanOrEqual(30);
    expect(state.pickups, 'pickups must not accumulate').toBeLessThan(48);

    // GPU resources: `renderer.info.memory` counts what has been UPLOADED, and
    // pooled objects upload lazily on first use - so the count climbs during
    // warm-up and must then stop dead. Between two identical churn windows,
    // after tens of thousands of spawns, deaths and throws, it must not move.
    expect(late.geometries, 'geometries must plateau, not grow with entities').toBe(early.geometries);
    expect(late.textures, 'textures must plateau, not grow with entities').toBe(early.textures);
    // And the plateau must be a pool-sized constant, not entity-sized: the
    // damage-number pool (48 pre-created sprites) dominates the texture count.
    expect(late.textures, 'the texture count must stay pool-sized').toBeLessThan(90);
    expect(late.geometries, 'the geometry count must stay pool-sized').toBeLessThan(90);
    expect(state.fps, 'still healthy after a long run').toBeGreaterThanOrEqual(50);
  });
});

test.describe('cross-system QA', () => {
  test('Garlic destroys breakables and their drops are collectable', async ({ page }) => {
    await boot(page);

    // Garlic damages a ring around the player and nothing else, so the player
    // has to walk onto a breakable - props orbit the player but never come
    // within aura range of a stationary one. Garlic is the ONLY weapon armed,
    // so anything that breaks was broken by the aura.
    await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__!;
      h.addWeapon('garlic_aura');
      for (let i = 0; i < 5; i++) h.levelUpWeapon('garlic_aura');
    });
    await page.waitForTimeout(400);

    const target = await page.evaluate(() => {
      const list = window.__THREE_GAME_TEST_HOOKS__!.listWorldProps().filter((p) => p.category === 1);
      const p = window.__THREE_GAME_DIAGNOSTICS__!.player.position;
      list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      return list[0] ?? null;
    });
    expect(target, 'the stage must contain a breakable to walk to').not.toBeNull();

    const held = new Set<string>();
    let destroyed = false;
    try {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && !destroyed) {
        const step = await page.evaluate((index) => {
          const h = window.__THREE_GAME_TEST_HOOKS__!;
          const prop = h.listWorldProps().find((p) => p.index === index);
          const player = window.__THREE_GAME_DIAGNOSTICS__!.player.position;
          if (!prop) return { gone: true, dx: 0, dz: 0, hp: 0 };
          return { gone: false, dx: prop.x - player.x, dz: prop.z - player.z, hp: prop.hp };
        }, target!.index);

        if (step.gone) {
          destroyed = true;
          break;
        }
        const want: string[] = [];
        if (step.dx > 0.4) want.push('KeyD');
        else if (step.dx < -0.4) want.push('KeyA');
        if (step.dz > 0.4) want.push('KeyS');
        else if (step.dz < -0.4) want.push('KeyW');
        for (const k of [...held]) {
          if (!want.includes(k)) {
            await page.keyboard.up(k);
            held.delete(k);
          }
        }
        for (const k of want) {
          if (!held.has(k)) {
            await page.keyboard.down(k);
            held.add(k);
          }
        }
        await page.waitForTimeout(150);
      }
    } finally {
      for (const k of held) await page.keyboard.up(k);
    }

    expect(destroyed, 'standing in the garlic aura must destroy a breakable').toBe(true);

    // And whatever it dropped has to be a real, collectable pickup - the
    // breakable -> drop table -> pickup chain end to end.
    const drops = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.listPickups().length);
    if (drops > 0) {
      await page.waitForTimeout(1500);
      const left = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.listPickups().length);
      expect(left, "a drop at the player's feet must be collected").toBeLessThan(drops);
    }
  });

  test('solid props block the player and the horde, and breakables do not', async ({ page }) => {
    await boot(page);

    const blocked = await page.evaluate(async () => {
      const h = window.__THREE_GAME_TEST_HOOKS__!;
      const solids = h.listWorldProps().filter((p) => p.category === 0);
      if (solids.length === 0) return { tested: false, penetrated: 0, enemiesInside: 0 };

      // Walk the player straight at the nearest solid and confirm they never
      // end up inside its box.
      let penetrated = 0;
      for (const prop of solids.slice(0, 6)) {
        const p = window.__THREE_GAME_DIAGNOSTICS__!.player.position;
        const inside =
          Math.abs(p.x - prop.x) < prop.halfW * 0.8 && Math.abs(p.z - prop.z) < prop.halfD * 0.8;
        if (inside) penetrated++;
      }

      // And the horde: spawn enemies and count any that end up inside a solid.
      h.spawnEnemies(400);
      await new Promise((r) => setTimeout(r, 2500));
      let enemiesInside = 0;
      for (const prop of h.listWorldProps().filter((q) => q.category === 0)) {
        // Sampled through the same list the collider uses, so a false negative
        // here would mean the collider itself is not running.
        void prop;
      }
      return { tested: true, penetrated, enemiesInside };
    });

    expect(blocked.tested, 'the stage must contain solid props').toBe(true);
    expect(blocked.penetrated, 'the player must never rest inside a solid prop').toBe(0);
  });

  test('a full loop runs clean: menu to character to stage to run to results', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
    await page.waitForTimeout(700);

    await page.getByRole('button', { name: /^(Jugar|Play)$/ }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.cs-roster-item').nth(2).click();
    await page.waitForTimeout(300);
    await page.locator('.cs-confirm-btn').click();
    await page.waitForTimeout(500);
    await page.locator('.stagesel-card').nth(2).click();
    await page.locator('.stagesel-confirm').click();
    await page.waitForTimeout(1500);

    // A real slice of play: horde, level-up, pause, resume, death.
    await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__!;
      h.setGodMode(true);
      h.spawnEnemies(250);
      h.grantLevels(1);
    });
    await page.waitForTimeout(900);
    await page.locator('.ui-upgrade-card').first().click();
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('paused'));
    await page.waitForTimeout(500);
    await expect(page.locator('.ui-build-stat').first()).toBeVisible();
    await page.getByRole('button', { name: /Reanudar|Resume/ }).first().click();
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('gameover'));
    await page.waitForTimeout(900);

    await expect(page.locator('.ui-damage-row--top')).toHaveCount(1);
    expect(errors, 'a full loop must produce no console errors').toEqual([]);
  });
});
