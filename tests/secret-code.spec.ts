import { test, expect, type Page } from '@playwright/test';

/**
 * HIDDEN CODE
 *
 * The sequence is undocumented on purpose, so the only thing keeping it
 * working is this file. It covers the whole contract: the code toggles
 * immortality, immortality refuses damage rather than healing it back, the
 * offensive side of the game is untouched, partial or slow input does not
 * fire, typing into a field never fires, and nothing survives a reload.
 */

const CODE = ['ArrowUp', 'ArrowDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyH', 'KeyV'];

async function startRun(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__!.seed(77);
    window.__THREE_GAME_TEST_HOOKS__!.setState('active-play');
  });
  await page.waitForTimeout(400);
}

async function type(page: Page, keys: string[], gapMs = 40): Promise<void> {
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(gapMs);
  }
}

const godMode = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.godMode);
const health = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.health);

test.describe('hidden code', () => {
  test('the full sequence toggles on, then off', async ({ page }) => {
    await startRun(page);
    expect(await godMode(page), 'a run must never start with it on').toBe(false);

    await type(page, CODE);
    await page.waitForTimeout(300);
    expect(await godMode(page), 'the sequence must arm it').toBe(true);

    // The same sequence again is the off switch.
    await type(page, CODE);
    await page.waitForTimeout(300);
    expect(await godMode(page), 'the same sequence must disarm it').toBe(false);
  });

  test('while armed, damage is refused before it reaches HP', async ({ page }) => {
    await startRun(page);

    // Baseline: damage lands normally. The QA damage hook deliberately
    // respects god mode AND the post-hit i-frames, so it goes through exactly
    // the same gate real contact damage does - which also means the hits have
    // to be spaced past the 0.5s invulnerability window.
    const max = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.maxHealth);
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.damagePlayer(25));
    await page.waitForTimeout(250);
    const hurt = await health(page);
    expect(hurt, 'damage must work without the code').toBeLessThan(max);

    await type(page, CODE);
    await page.waitForTimeout(300);
    expect(await godMode(page)).toBe(true);

    const before = await health(page);
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.damagePlayer(40));
      await page.waitForTimeout(600); // past the i-frame window every time
    }
    // And the same thing through real gameplay: a horde standing on top of
    // the player, dealing contact damage every frame.
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.spawnEnemies(120));
    await page.waitForTimeout(2500);
    const after = await health(page);
    // Not "healed back to full" - refused. HP must not dip at all, and must
    // not have been topped up either (regen is 0 by default).
    expect(after, 'HP must not move while armed').toBe(before);

    // Disarm and confirm damage lands again.
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.clearEnemies());
    await type(page, CODE);
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.damagePlayer(30));
    await page.waitForTimeout(300);
    expect(await health(page), 'damage must resume once disarmed').toBeLessThan(after);
  });

  test('offensive power is untouched: this is immortality, not a damage cheat', async ({ page }) => {
    await startRun(page);
    const damageOf = () =>
      page.evaluate(() => {
        const e = window.__THREE_GAME_TEST_HOOKS__!.getWeaponEffect('axe_throw', 3);
        return e.damage;
      });
    const before = await damageOf();
    await type(page, CODE);
    await page.waitForTimeout(300);
    expect(await godMode(page)).toBe(true);
    expect(await damageOf(), 'weapon damage must not change').toBe(before);
  });

  test('an incomplete sequence does nothing', async ({ page }) => {
    await startRun(page);
    await type(page, CODE.slice(0, CODE.length - 1));
    await page.waitForTimeout(400);
    expect(await godMode(page)).toBe(false);

    // A wrong final key is also nothing.
    await type(page, [...CODE.slice(0, CODE.length - 1), 'KeyB']);
    await page.waitForTimeout(400);
    expect(await godMode(page)).toBe(false);
  });

  test('a long pause mid-sequence resets it', async ({ page }) => {
    await startRun(page);
    await type(page, CODE.slice(0, 5));
    // Longer than the inter-key timeout.
    await page.waitForTimeout(3400);
    await type(page, CODE.slice(5));
    await page.waitForTimeout(300);
    expect(await godMode(page), 'a timed-out buffer must not complete').toBe(false);

    // And the same keys entered promptly still work, proving the reset was
    // about timing and not about the keys themselves.
    await type(page, CODE);
    await page.waitForTimeout(300);
    expect(await godMode(page)).toBe(true);
  });

  test('typing into a field never triggers it', async ({ page }) => {
    await startRun(page);
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'typing-probe';
      document.body.appendChild(input);
      input.focus();
    });

    await type(page, CODE);
    await page.waitForTimeout(300);
    expect(await godMode(page), 'a focused input must swallow the sequence').toBe(false);

    await page.evaluate(() => document.getElementById('typing-probe')?.remove());
    await page.waitForTimeout(100);
    await type(page, CODE);
    await page.waitForTimeout(300);
    expect(await godMode(page), 'and must work again once the field is gone').toBe(true);
  });

  test('nothing survives a reload or a new run', async ({ page }) => {
    await startRun(page);
    await type(page, CODE);
    await page.waitForTimeout(300);
    expect(await godMode(page)).toBe(true);

    // A fresh run in the same session.
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('active-play'));
    await page.waitForTimeout(400);
    expect(await godMode(page), 'a new run must start clean').toBe(false);

    // And a reload.
    await type(page, CODE);
    await page.waitForTimeout(300);
    expect(await godMode(page)).toBe(true);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('active-play'));
    await page.waitForTimeout(400);
    expect(await godMode(page), 'a reload must start clean').toBe(false);
    // Nor may it be sitting in storage anywhere.
    const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
    expect(stored.toLowerCase()).not.toContain('god');
    expect(stored.toLowerCase()).not.toContain('veil');
  });

  test('the secret stays secret: no permanent indicator, and it is not documented in the UI', async ({ page }) => {
    await startRun(page);
    await type(page, CODE);
    await page.waitForTimeout(300);
    expect(await godMode(page)).toBe(true);

    // The confirmation line appears, says only what it should, and leaves.
    const veilText = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('#hud *')) as HTMLElement[];
      return nodes.map((n) => n.textContent ?? '').filter((s) => s.includes('veil'));
    });
    expect(veilText, 'the confirmation line must be exactly the specified text').toContain(
      'The veil no longer binds you.',
    );

    await page.waitForTimeout(2200);
    const stillVisible = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('#hud *')) as HTMLElement[];
      return nodes.some((n) => (n.textContent ?? '').includes('veil') && Number(getComputedStyle(n).opacity) > 0.05);
    });
    expect(stillVisible, 'the line must fade out, leaving no indicator').toBe(false);

    // Nothing anywhere in the visible UI names the cheat or its keys.
    const uiText = await page.evaluate(() => document.body.innerText.toLowerCase());
    for (const forbidden of ['god mode', 'godmode', 'cheat', 'invincib', 'inmortal', 'truco']) {
      expect(uiText, `the UI must not mention "${forbidden}"`).not.toContain(forbidden);
    }
  });
});
