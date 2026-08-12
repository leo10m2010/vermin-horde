#!/usr/bin/env node
/**
 * Enemy art inspection capture.
 *
 * Drives the `enemyShowcase` test hook (see Game.ts) to park one frozen
 * instance of every enemy AND boss type in a grid with the player standing
 * among them, then screenshots that lineup once per animation pose so
 * silhouette, scale, shading, shadows and every pose can be compared side by
 * side in real rendered frames - not inferred from code.
 *
 * Also captures a horde frame afterwards to confirm the extra pose art and
 * the animation state machine did not cost draw calls or frame rate.
 *
 * Usage: node scripts/inspect-enemy-showcase.mjs [--url URL] [--out DIR]
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const POSES = ['idle', 'walk', 'attack', 'hit', 'special', 'death'];

function parseArgs(argv) {
  const args = {
    url: 'http://127.0.0.1:5188',
    out: 'artifacts/enemy-showcase',
    wait: 900,
    // Grid framing. The defaults produce the whole-roster overview; the
    // `--row` preset re-frames everything into one tight row instead, which
    // is what you want when judging pixel detail rather than relative scale.
    columns: 5,
    spacing: 5.5,
    view: 0,
    height: 720,
    scale: 2,
    prefix: 'showcase',
    horde: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === '--url') args.url = argv[++i];
    else if (v === '--out') args.out = argv[++i];
    else if (v === '--wait') args.wait = Number(argv[++i]);
    else if (v === '--columns') args.columns = Number(argv[++i]);
    else if (v === '--spacing') args.spacing = Number(argv[++i]);
    else if (v === '--view') args.view = Number(argv[++i]);
    else if (v === '--prefix') args.prefix = argv[++i];
    else if (v === '--no-horde') args.horde = false;
    else if (v === '--only') args.only = argv[++i].split(',');
    else if (v === '--row') {
      // close-up preset: two tight rows, camera pulled right in so individual
      // pixels, outlines and shading are judgeable rather than just silhouettes
      args.columns = 7;
      args.spacing = 3.4;
      args.view = 13;
      args.height = 560;
      args.scale = 3;
      args.prefix = 'zoom-row';
      args.horde = false;
    } else if (v === '-h' || v === '--help') {
      console.log('Usage: inspect-enemy-showcase.mjs [--url URL] [--out DIR] [--row] [--columns N] [--spacing N] [--view N] [--prefix P] [--no-horde]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${v}`);
  }
  return args;
}

// Playwright's default headless is chromium_headless_shell: no GPU backend, so
// it silently falls back to SwiftShader and any FPS number is fiction.
// channel:'chromium' runs the real Chromium build against the real GPU.
async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chromium' });
  } catch {
    console.error('warning: channel:"chromium" unavailable; falling back to the headless shell (software rendering, FPS invalid).');
    return chromium.launch();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.out);
  await mkdir(outDir, { recursive: true });

  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: args.height }, deviceScaleFactor: args.scale });

  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(args.url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 15000 });

  // Deterministic seed + no idle drift, so every capture is reproducible.
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__.seed(1234);
    window.__THREE_GAME_TEST_HOOKS__.setState('active-play');
  });
  await page.waitForTimeout(400);

  const layout = await page.evaluate(
    (o) => window.__THREE_GAME_TEST_HOOKS__.enemyShowcase({ columns: o.columns, spacing: o.spacing, viewHeight: o.view || undefined, only: o.only }),
    { columns: args.columns, spacing: args.spacing, view: args.view, only: args.only },
  );
  await page.waitForTimeout(args.wait);

  const report = { layout, poses: {}, consoleErrors: [] };

  for (const pose of POSES) {
    await page.evaluate((p) => window.__THREE_GAME_TEST_HOOKS__.setEnemyPose(p), pose);
    await page.waitForTimeout(450);
    const file = path.join(outDir, `${args.prefix}-${pose}.png`);
    await page.screenshot({ path: file });
    const diag = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
    report.poses[pose] = {
      file: path.relative(process.cwd(), file),
      fps: diag.fps,
      drawCalls: diag.renderer.calls,
      atlasCells: diag.atlasCells,
      enemyCount: diag.enemyCount,
    };
    console.log(`captured ${pose.padEnd(8)} fps=${diag.fps} calls=${diag.renderer.calls} enemies=${diag.enemyCount}`);
  }

  // --- horde regression frame: the pose art must not cost perf ---
  if (!args.horde) {
    report.consoleErrors = consoleErrors;
    await writeFile(path.join(outDir, `${args.prefix}-report.json`), JSON.stringify(report, null, 2), 'utf8');
    console.log(consoleErrors.length ? `\n${consoleErrors.length} console error(s)` : '\nno console errors');
    await browser.close();
    process.exitCode = consoleErrors.length ? 1 : 0;
    return;
  }
  // A MIX of every type, not 900 identical grunts: this frame doubles as the
  // "does the new art hold up in actual combat" check - real weapon fire, real
  // deaths, real telegraphs, every silhouette overlapping every other.
  await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    hooks.exitEnemyShowcase();
    hooks.setGodMode(true);
    const types = ['grunt', 'bat', 'skeleton', 'slime', 'wolf', 'ghost', 'brute', 'spitter', 'ghoul', 'gargoyle'];
    for (const t of types) hooks.spawnEnemies(90, t);
    hooks.forceBoss();
  });
  // Short window on purpose: long enough for the horde to close in and the
  // weapons to start killing, short enough that accumulated XP has not yet
  // popped the level-up modal over the frame we want to look at.
  await page.waitForTimeout(1500);
  const hordeFile = path.join(outDir, 'horde-stress.png');
  await page.screenshot({ path: hordeFile });
  const hordeDiag = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  report.horde = {
    file: path.relative(process.cwd(), hordeFile),
    fps: hordeDiag.fps,
    drawCalls: hordeDiag.renderer.calls,
    enemyCount: hordeDiag.enemyCount,
    atlasCells: hordeDiag.atlasCells,
    textures: hordeDiag.renderer.textures,
  };
  console.log(`captured horde    fps=${hordeDiag.fps} calls=${hordeDiag.renderer.calls} enemies=${hordeDiag.enemyCount}`);

  report.consoleErrors = consoleErrors;
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  if (consoleErrors.length) {
    console.error(`\n${consoleErrors.length} console error(s):`);
    for (const e of consoleErrors.slice(0, 10)) console.error(`  ${e}`);
  } else {
    console.log('\nno console errors');
  }

  await browser.close();
  process.exitCode = consoleErrors.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
