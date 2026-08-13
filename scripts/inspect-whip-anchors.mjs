#!/usr/bin/env node
/**
 * Whip anchor check across the whole roster.
 *
 * HAND_HEIGHT is a single constant on the weapon, but the six character
 * sprites have different proportions and different grid heights, so "arm
 * level" is not automatically the same world Y for all of them. This captures
 * the lash mid-snap next to each character AND reports, in world units, where
 * the cord sits relative to that character's own sprite - so the judgement is
 * a measurement, not a vibe.
 *
 * Usage: node scripts/inspect-whip-anchors.mjs [--url URL] [--out DIR]
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CHARACTERS = ['thornguard', 'redline', 'warden', 'cinderborn', 'fortune', 'steadyhand'];

function parseArgs(argv) {
  const args = { url: 'http://127.0.0.1:5188', out: 'artifacts/whip-anchors' };
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
    return chromium.launch();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.out);
  await mkdir(outDir, { recursive: true });

  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 720, height: 460 }, deviceScaleFactor: 3 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(args.url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 15000 });

  const report = { characters: [], errors: [] };

  for (const id of CHARACTERS) {
    await page.evaluate((c) => {
      const h = window.__THREE_GAME_TEST_HOOKS__;
      h.seed(5);
      h.selectCharacter(c);
      h.setState('active-play');
      h.setGodMode(true);
    }, id);
    await page.waitForTimeout(350);

    // Isolate the whip at a mid level so the cord has real length, and pull
    // the camera in tight enough to judge where it leaves the body.
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.powerShowcase('whip_strike', 5));
    await page.waitForTimeout(500);

    // Wait for a live lash, then hold to land on the SNAP frame.
    for (let a = 0; a < 60; a += 1) {
      const live = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getProjectileCensus('whip_strike').length);
      if (live > 0) break;
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(105);

    const measured = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getWhipAnchorDebug());
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
    const file = path.join(outDir, `whip-${id}.png`);
    await page.screenshot({ path: file });
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false));

    report.characters.push({ id, ...measured, file: path.relative(process.cwd(), file) });
    console.log(
      `${id.padEnd(12)} spriteTop=${measured.spriteTopY.toFixed(2)} cordY=${measured.cordY.toFixed(2)} ` +
        `frac=${(measured.cordFractionOfHeight * 100).toFixed(0)}% of body height`,
    );
  }

  report.errors = errors;
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(errors.length ? `\n${errors.length} console error(s)` : '\nno console errors');
  await browser.close();
  process.exitCode = errors.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
