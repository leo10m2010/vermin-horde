#!/usr/bin/env node
/**
 * Pickup art + grounding inspection.
 *
 * Drops are only useful if the player can tell, in a crowded frame and in half
 * a second, that something worth walking to just appeared - and which of the
 * six it is. That is a visual judgement, so this captures the frames it has to
 * be made on: the whole set laid out, each one alone, and the set buried in a
 * live horde.
 *
 * Usage: node scripts/inspect-pickups.mjs [--url URL] [--out DIR]
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const KINDS = ['gold', 'ration', 'freeze', 'vacuum', 'purge', 'fortune'];

function parseArgs(argv) {
  const args = { url: 'http://127.0.0.1:5188', out: 'artifacts/pickups' };
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('page error:', m.text());
  });

  await page.goto(args.url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.seed(90210);
    h.setState('active-play');
    h.setGodMode(true);
    h.hideDebugUi();
  });
  await page.waitForTimeout(600);

  // 1. The whole set in a ring around the player, at the distance a real drop
  //    lands: far enough not to magnetise, close enough to compare.
  await page.evaluate((kinds) => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.clearEnemies();
    kinds.forEach((kind, i) => {
      const a = (i / kinds.length) * Math.PI * 2;
      h.spawnPickup(kind, Math.cos(a) * 5.2, Math.sin(a) * 4.2);
    });
  }, KINDS);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'set-ring.png') });

  // 2. Each pickup alone, so its silhouette and grounding can be judged
  //    without a neighbour to compare against.
  for (const kind of KINDS) {
    await page.evaluate(
      ({ kind }) => {
        const h = window.__THREE_GAME_TEST_HOOKS__;
        h.setState('active-play');
        h.spawnPickup(kind, 4.6, 0);
      },
      { kind },
    );
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, `single-${kind}.png`) });
    // Let it magnetise in and be collected before the next one, so frames
    // never contain two subjects.
    await page.waitForTimeout(1400);
  }

  // 3. The readability test that actually matters: a drop inside a live horde.
  await page.evaluate((kinds) => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.spawnEnemies(140);
    kinds.forEach((kind, i) => {
      const a = (i / kinds.length) * Math.PI * 2 + 0.4;
      h.spawnPickup(kind, Math.cos(a) * 5.6, Math.sin(a) * 4.4);
    });
  }, KINDS);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, 'in-horde.png') });

  // 4. Breakables actually dropping them in situ, which is how they will be met.
  const broke = await page.evaluate(async () => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.clearEnemies();
    const dropped = [];
    for (let i = 0; i < 10; i++) {
      const r = h.breakNearestProp();
      if (!r.broke) break;
      await new Promise((res) => setTimeout(res, 120));
    }
    for (const p of h.listPickups()) dropped.push(p.kind);
    return dropped;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'from-breakables.png') });

  // 5. Freeze, mid-effect: the horde must visibly read as iced, not stalled.
  await page.evaluate(async () => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.spawnEnemies(160);
    await new Promise((res) => setTimeout(res, 400));
    h.spawnPickup('freeze', 0.5, 0);
  });
  await page.waitForTimeout(1400);
  const frozen = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getFrozenCount());
  await page.screenshot({ path: path.join(outDir, 'freeze-active.png') });

  console.log(`drops from breakables: ${broke.join(', ') || '(none)'}`);
  console.log(`frozen enemies in freeze-active.png: ${frozen}`);
  console.log(`captured to ${outDir}`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
