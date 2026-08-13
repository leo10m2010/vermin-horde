#!/usr/bin/env node
/**
 * Full-screen UI/UX inspection.
 *
 * Round 8 asks that Main Menu, Character Select, Stage Select, Level Up,
 * Pause and Results read as parts of the SAME finished game. That is a
 * judgement about a set of screens seen together, so this captures all of
 * them in one pass at one resolution, in the order a player meets them.
 *
 * Usage: node scripts/inspect-screens.mjs [--url URL] [--out DIR] [--width N] [--height N]
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = { url: 'http://127.0.0.1:5188', out: 'artifacts/screens', width: 1440, height: 900 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') args.url = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--width') args.width = Number(argv[++i]);
    else if (argv[i] === '--height') args.height = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chromium' });
  } catch {
    console.error('warning: channel:"chromium" unavailable; falling back to the headless shell (software rendering).');
    return chromium.launch();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.out);
  await mkdir(outDir, { recursive: true });

  const browser = await launchBrowser();
  const page = await browser.newPage({
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  const shot = async (name) => {
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
    console.log(`captured ${name}`);
  };

  await page.goto(args.url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.waitForTimeout(1600); // let the menu intro finish

  await shot('01-main-menu');

  await page.getByRole('button', { name: /^(Jugar|Play)$/ }).first().click();
  await page.waitForTimeout(900);
  await shot('02-character-select');

  // A second character, so the preview swap can be judged too.
  await page.locator('.cs-roster-item').nth(3).click();
  await page.waitForTimeout(600);
  await shot('03-character-select-alt');

  await page.locator('.cs-confirm-btn').click();
  await page.waitForTimeout(900);
  await shot('04-stage-select');

  // Into the run.
  const stageCard = page.locator('.stagesel-card').first();
  if (await stageCard.count()) {
    await stageCard.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '04b-stage-select-selected.png') });
    await page.locator('.stagesel-confirm').click();
  }
  await page.waitForTimeout(1500);
  await shot('05-hud-early');

  await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.setGodMode(true);
    h.spawnEnemies(320);
  });
  await page.waitForTimeout(1200);
  await shot('06-hud-horde');

  // Level-up card.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('levelup'));
  await page.waitForTimeout(900);
  await shot('07-level-up');

  // Take a pick so the build has something to show, then pause.
  const firstCard = page.locator('.ui-upgrade-card').first();
  if (await firstCard.count()) await firstCard.click();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.addWeapon('axe_throw');
    h.addWeapon('garlic_aura');
    h.levelUpWeapon('axe_throw');
    h.levelUpWeapon('axe_throw');
    h.grantPassive('passive_damage');
    h.grantPassive('passive_damage');
    h.grantPassive('passive_area');
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('paused'));
  await page.waitForTimeout(800);
  await shot('08-pause-build');

  // Results.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('gameover'));
  await page.waitForTimeout(1200);
  await shot('09-results');

  console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
  console.log(`captured to ${outDir}`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
