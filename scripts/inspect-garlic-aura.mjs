#!/usr/bin/env node
/**
 * Garlic Aura grounding inspection.
 *
 * The whole point of this pass is a visual read ("does it sit on the floor or
 * float?"), which no numeric assertion can answer - so this captures the real
 * rendered frames the judgement has to be made on: the aura at several radii,
 * standing still vs. moving, with enemies inside it, and evolved.
 *
 * Usage: node scripts/inspect-garlic-aura.mjs [--url URL] [--out DIR]
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = { url: 'http://127.0.0.1:5188', out: 'artifacts/garlic-aura' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') args.url = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
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
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(args.url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 15000 });
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__.seed(77);
    window.__THREE_GAME_TEST_HOOKS__.setState('active-play');
    window.__THREE_GAME_TEST_HOOKS__.setGodMode(true);
  });
  await page.waitForTimeout(400);

  const report = { shots: [], errors: [] };

  const shot = async (name, note) => {
    const file = path.join(outDir, `${name}.png`);
    // Dismiss any level-up picker that opened from collected XP, then freeze
    // the simulation, so the frame shows the arena rather than a modal.
    await page.evaluate(() => {
      const card = document.querySelector('.ui-upgrade-card');
      if (card) card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(120);
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
    await page.screenshot({ path: file });
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false));
    const radii = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getGroundRingRadii());
    const effect = await page.evaluate(() => {
      const owned = window.__THREE_GAME_TEST_HOOKS__.getProjectileCensus('garlic_aura');
      void owned;
      return null;
    });
    void effect;
    const diag = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
    report.shots.push({ name, note, drawnRadii: radii, fps: diag.fps, drawCalls: diag.renderer.calls });
    console.log(`${name.padEnd(26)} radii=${JSON.stringify(radii.map((r) => +r.toFixed(2)))} fps=${diag.fps} calls=${diag.renderer.calls}`);
  };

  // --- radius progression, isolated (no other weapon clutter) --------------
  for (const level of [1, 4, 8]) {
    const info = await page.evaluate((l) => window.__THREE_GAME_TEST_HOOKS__.powerShowcase('garlic_aura', l), level);
    await page.waitForTimeout(900);
    await shot(`garlic-lv${level}`, `stat radius ${info.effect.radius}`);
  }

  // --- evolved -------------------------------------------------------------
  const evo = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.powerShowcase('garlic_aura', 'evolved'));
  await page.waitForTimeout(900);
  await shot('garlic-evolved', `stat radius ${evo.effect.radius}`);

  // --- real gameplay: enemies walking in and out, player moving ------------
  await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.exitEnemyShowcase();
    h.setState('active-play');
    h.setGodMode(true);
    h.addWeapon('garlic_aura');
    for (let i = 0; i < 5; i++) h.levelUpWeapon('garlic_aura');
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.spawnEnemies(70));
  await page.waitForTimeout(1400);
  await shot('garlic-crowd-still', 'enemies inside the zone, player stationary');

  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(900);
  await shot('garlic-moving', 'player moving right, zone must track the feet');
  await page.keyboard.up('ArrowRight');

  // --- Hex Flask uses the same ground-zone renderer ------------------------
  await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.powerShowcase('hex_flask', 6);
  });
  await page.waitForTimeout(2200);
  await shot('hexflask-zone', 'same ground-zone renderer, lingering pools');

  report.errors = errors;
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(errors.length ? `\n${errors.length} console error(s):\n  ${errors.slice(0, 6).join('\n  ')}` : '\nno console errors');
  await browser.close();
  process.exitCode = errors.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
