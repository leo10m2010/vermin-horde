#!/usr/bin/env node
/**
 * Power art / progression inspection capture.
 *
 * Drives the `powerShowcase` test hook: isolates one weapon at a level (or
 * evolved) with a ring of frozen dummy targets, then screenshots it. Captures
 * the milestone levels of every weapon so the Lv1 -> Lv2 -> Lv5 -> Lv8 ->
 * evolved progression can be compared as real rendered frames.
 *
 * Usage:
 *   node scripts/inspect-power-showcase.mjs                 # all weapons, milestone levels
 *   node scripts/inspect-power-showcase.mjs --only whip_strike,axe_throw
 *   node scripts/inspect-power-showcase.mjs --levels 1,2,8,evolved
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ALL = [
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

function parseArgs(argv) {
  const args = { url: 'http://127.0.0.1:5188', out: 'artifacts/power-showcase', only: ALL, levels: [1, 2, 5, 8, 'evolved'], settle: 900 };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === '--url') args.url = argv[++i];
    else if (v === '--out') args.out = argv[++i];
    else if (v === '--only') args.only = argv[++i].split(',');
    else if (v === '--settle') args.settle = Number(argv[++i]);
    else if (v === '--levels') args.levels = argv[++i].split(',').map((x) => (x === 'evolved' ? 'evolved' : Number(x)));
    else if (v === '-h' || v === '--help') {
      console.log('Usage: inspect-power-showcase.mjs [--url URL] [--out DIR] [--only id,id] [--levels 1,2,8,evolved] [--settle MS]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${v}`);
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
  const page = await browser.newPage({ viewport: { width: 1000, height: 620 }, deviceScaleFactor: 2 });
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(args.url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 15000 });
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__.seed(2024);
    window.__THREE_GAME_TEST_HOOKS__.setState('active-play');
    window.__THREE_GAME_TEST_HOOKS__.setGodMode(true);
  });
  await page.waitForTimeout(400);

  const report = { shots: [], consoleErrors: [] };

  for (const id of args.only) {
    for (const level of args.levels) {
      const info = await page.evaluate(
        ([w, l]) => window.__THREE_GAME_TEST_HOOKS__.powerShowcase(w, l),
        [id, level],
      );
      // Let the weapon warm up, then WAIT FOR IT TO ACTUALLY BE FIRING before
      // capturing. A whip lash is only on screen ~0.2s of every 1s cycle, so a
      // fixed sleep reliably produced empty arenas that showed nothing about
      // the weapon. Poll for live projectiles and shoot the frame that has
      // them; freeze the sim first so the screenshot lands on that same frame.
      await page.waitForTimeout(Math.min(args.settle, 500));
      let live = 0;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        live = await page.evaluate((w) => window.__THREE_GAME_TEST_HOOKS__.getProjectileCensus(w).length, id);
        if (live > 0) break;
        await page.waitForTimeout(40);
      }
      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
      const file = path.join(outDir, `${id}-lv${level}.png`);
      await page.screenshot({ path: file });
      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false));
      const diag = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
      report.shots.push({
        id,
        level,
        file: path.relative(process.cwd(), file),
        effect: info.effect,
        liveProjectiles: live,
        fps: diag.fps,
        drawCalls: diag.renderer.calls,
      });
      console.log(`${id.padEnd(16)} lv${String(level).padEnd(8)} live=${String(live).padStart(2)} fps=${diag.fps} calls=${diag.renderer.calls}`);
    }
  }

  report.consoleErrors = consoleErrors;
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(consoleErrors.length ? `\n${consoleErrors.length} console error(s):\n  ${consoleErrors.slice(0, 8).join('\n  ')}` : '\nno console errors');
  await browser.close();
  process.exitCode = consoleErrors.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
