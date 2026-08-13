import { test, expect, type Page } from '@playwright/test';

/**
 * SCREEN CONTRACT
 *
 * Round 8 asks that Main Menu, Character Select, Stage Select, Level Up,
 * Pause and Results read as one finished game. Most of that is a visual
 * judgement made from screenshots (scripts/inspect-screens.mjs), but the
 * parts that CAN be asserted are asserted here, because they are exactly the
 * parts that regress silently: HUD chrome leaking onto menus, a screen losing
 * its confirm step, the pause build losing its stats, results losing the one
 * highlight that makes it readable, and animations ignoring the user's
 * reduced-motion preference.
 */

async function bootMenu(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.waitForTimeout(700);
}

async function intoStageSelect(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(Jugar|Play)$/ }).first().click();
  await page.waitForTimeout(500);
  await page.locator('.cs-confirm-btn').click();
  await page.waitForTimeout(500);
}

test.describe('screen contract', () => {
  test('no HUD chrome is visible before a run starts', async ({ page }) => {
    await bootMenu(page);

    // The run clock and kill counter are honest numbers, but a 00:00 ticking
    // over the main menu reads as a bug - and it was one.
    const visible = async (selector: string) =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return Number(getComputedStyle(el).opacity);
      }, selector);

    expect(await visible('#hud-top-right'), 'run clock/kills on the main menu').toBe(0);
    expect(await visible('#hud-portrait-frame'), 'portrait on the main menu').toBe(0);
    expect(await visible('#hud-power-slots'), 'power slots on the main menu').toBe(0);

    await intoStageSelect(page);
    expect(await visible('#hud-top-right'), 'run clock on stage select').toBe(0);

    await page.locator('.stagesel-confirm').click();
    await page.waitForTimeout(900);
    expect(await visible('#hud-top-right'), 'run clock during a run').toBe(1);
    expect(await visible('#hud-portrait-frame'), 'portrait during a run').toBe(1);
  });

  test('stage select shows a real preview, a difficulty and a terrain note per stage', async ({ page }) => {
    await bootMenu(page);
    await intoStageSelect(page);

    const cards = page.locator('.stagesel-card');
    await expect(cards).toHaveCount(3);

    for (let i = 0; i < 3; i++) {
      const card = cards.nth(i);
      await expect(card.locator('.stagesel-diff'), `stage ${i} difficulty pill`).toHaveCount(1);
      await expect(card.locator('.stagesel-feature'), `stage ${i} terrain note`).toHaveCount(1);
      await expect(card.locator('.stagesel-feature')).not.toHaveText('');

      // The preview must be a drawn scene, not a flat fill: sample the canvas
      // and require a real spread of distinct colours. A swatch of one base
      // colour plus flecks cannot pass this.
      const distinct = await card.locator('.stagesel-preview').evaluate((el) => {
        const canvas = el as HTMLCanvasElement;
        const ctx = canvas.getContext('2d')!;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const seen = new Set<number>();
        for (let p = 0; p < data.length; p += 4) {
          seen.add((data[p] << 16) | (data[p + 1] << 8) | data[p + 2]);
        }
        return seen.size;
      });
      expect(distinct, `stage ${i} preview must be a drawn scene`).toBeGreaterThan(60);
    }

    // Each stage's preview must differ from the others - three stages drawn
    // from one prop set would look identical, which is the bug this replaced.
    const signatures = await cards.evaluateAll((els) =>
      els.map((el) => (el.querySelector('.stagesel-preview') as HTMLCanvasElement).toDataURL().slice(-2000)),
    );
    expect(new Set(signatures).size, 'every stage preview must be distinct').toBe(3);
  });

  test('stage select requires a confirm press instead of launching on the first click', async ({ page }) => {
    await bootMenu(page);
    await intoStageSelect(page);

    await page.locator('.stagesel-card').nth(1).click();
    await page.waitForTimeout(300);
    // Still on the stage screen: a single card click selects, it does not run.
    await expect(page.locator('.stagesel-overlay')).toBeVisible();
    await expect(page.locator('.stagesel-card').nth(1)).toHaveClass(/is-selected/);

    await page.locator('.stagesel-confirm').click();
    await page.waitForTimeout(800);
    await expect(page.locator('.stagesel-overlay')).toBeHidden();
  });

  test('pause shows the derived stats, not just the picks', async ({ page }) => {
    await bootMenu(page);
    await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__!;
      h.setState('active-play');
      h.setGodMode(true);
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__!;
      h.addWeapon('axe_throw');
      h.grantPassive('passive_damage');
      h.setState('paused');
    });
    await page.waitForTimeout(500);

    const chips = page.locator('.ui-build-stat');
    expect(await chips.count(), 'the pause build must summarise the run stats').toBeGreaterThanOrEqual(8);
    // And the numbers must be the live ones, not placeholders.
    const health = await page.locator('.ui-build-stat', { hasText: /VIDA|HEALTH/i }).first().innerText();
    expect(health).toMatch(/\d+\/\d+/);

    // The picks are still there too.
    await expect(page.locator('.ui-build-col')).toHaveCount(2);
  });

  test('results rank damage and mark the top weapon', async ({ page }) => {
    await bootMenu(page);
    await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__!;
      h.setState('active-play');
      h.setGodMode(true);
      h.addWeapon('axe_throw');
      h.addWeapon('garlic_aura');
      h.spawnEnemies(150);
    });
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('gameover'));
    await page.waitForTimeout(700);

    const rows = page.locator('#ui-gameover .ui-damage-row, .ui-damage-row');
    expect(await rows.count(), 'the run must have recorded damage per weapon').toBeGreaterThan(1);

    // Exactly one row is marked, and it is the first (highest) one.
    await expect(page.locator('.ui-damage-row--top')).toHaveCount(1);
    await expect(rows.first()).toHaveClass(/ui-damage-row--top/);

    // Ranked descending.
    const percents = await page.locator('.ui-damage-pct').allInnerTexts();
    const values = percents.map((p) => Number(p.replace('%', '')));
    for (let i = 1; i < values.length; i++) {
      expect(values[i], 'damage rows must be ranked descending').toBeLessThanOrEqual(values[i - 1]);
    }

    // The pause panel must not be left stacked behind the results.
    await expect(page.locator('#ui-pause')).toBeHidden();
  });

  test('every screen honours prefers-reduced-motion', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await bootMenu(page);

    const animated = async (selector: string) =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return 'missing';
        return getComputedStyle(el).animationName;
      }, selector);

    expect(await animated('.ui-overlay--menu .ui-title'), 'menu title').toBe('none');
    expect(await animated('.ui-overlay--menu .ui-btn'), 'menu buttons').toBe('none');

    await page.getByRole('button', { name: /^(Jugar|Play)$/ }).first().click();
    await page.waitForTimeout(400);
    expect(await animated('#character-select-overlay'), 'character select screen').toBe('none');
    expect(await animated('.cs-panel'), 'character select panel').toBe('none');

    await page.locator('.cs-confirm-btn').click();
    await page.waitForTimeout(400);
    expect(await animated('.stagesel-overlay'), 'stage select screen').toBe('none');
    expect(await animated('.stagesel-panel'), 'stage select panel').toBe('none');
    expect(await animated('.stagesel-card'), 'stage cards').toBe('none');

    await context.close();
  });
});
