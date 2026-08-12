import { drawPixelGrid, fillRect, makeGrid, toRows } from '../render/PixelDraw';

/**
 * Purely decorative atmosphere layer for the main menu overlay: drifting fog
 * blobs, rising embers, and a couple of pixel-art bat silhouettes on a
 * wandering flight path. Everything here is driven by CSS animations (see
 * the `.menu-*` rules in `styles.css`), so there is no requestAnimationFrame
 * loop to manage - the DOM subtree is built once and appended behind the
 * menu panel.
 *
 * This costs nothing while the menu is hidden: `UiRoot` toggles the overlay
 * with the `hidden` attribute, which the existing `.ui-overlay[hidden] {
 * display: none }` rule turns into a full removal from the render tree, and
 * browsers don't run CSS animations on elements that aren't rendered. When
 * the overlay is shown again the animations simply restart.
 *
 * Entirely self-contained HTML/CSS/Canvas2D - never touches the Three.js
 * canvas, scene, or renderer.
 */
export function createMenuBackdrop(): HTMLElement {
  const backdrop = document.createElement('div');
  backdrop.className = 'menu-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  backdrop.append(
    buildFogLayer(),
    buildEmberLayer(),
    buildBatFlight('menu-bat-flight--1', 22, 0),
    buildBatFlight('menu-bat-flight--2', 29, -11),
  );

  return backdrop;
}

function buildFogLayer(): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'menu-fog-layer';
  for (const variant of ['menu-fog--a', 'menu-fog--b', 'menu-fog--c']) {
    const blob = document.createElement('div');
    blob.className = `menu-fog ${variant}`;
    layer.append(blob);
  }
  return layer;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

const EMBER_COUNT = 16;

function buildEmberLayer(): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'menu-embers';
  for (let i = 0; i < EMBER_COUNT; i++) {
    const ember = document.createElement('span');
    ember.className = 'menu-ember';
    const duration = rand(7, 13);
    // Negative delay starts each ember mid-flight so the very first paint
    // already looks like an ongoing drift instead of every ember spawning
    // in lockstep at the bottom edge.
    const delay = -rand(0, duration);
    const size = rand(2, 4);
    ember.style.left = `${rand(2, 98)}%`;
    ember.style.setProperty('--drift', `${rand(-36, 36)}px`);
    ember.style.width = `${size}px`;
    ember.style.height = `${size}px`;
    ember.style.animationDuration = `${duration}s`;
    ember.style.animationDelay = `${delay}s`;
    layer.append(ember);
  }
  return layer;
}

// --- bat silhouette, authored the same coordinate-based way as
// registerBatSprites() in SpriteLibrary.ts, just monochrome and simplified
// since it only ever renders as a small drifting background silhouette. ---
const BAT_SILHOUETTE_PALETTE: Record<string, string> = { b: 'rgba(18, 10, 26, 0.85)' };

function batSilhouetteGrid(wingsUp: boolean): string[][] {
  const g = makeGrid(16, 16);
  fillRect(g, 6, 4, 9, 8, 'b');
  fillRect(g, 6, 3, 7, 3, 'b');
  fillRect(g, 8, 3, 9, 3, 'b');
  const wy0 = wingsUp ? 1 : 4;
  const wy1 = wingsUp ? 5 : 8;
  fillRect(g, 0, wy0, 5, wy0 + 1, 'b');
  fillRect(g, 1, wy0 + 2, 5, wy1, 'b');
  fillRect(g, 10, wy0, 15, wy0 + 1, 'b');
  fillRect(g, 10, wy0 + 2, 14, wy1, 'b');
  fillRect(g, 7, 9, 8, 10, 'b');
  return g;
}

function buildBatFrame(wingsUp: boolean, extraClass: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = `menu-bat-frame ${extraClass}`;
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    drawPixelGrid(ctx, 32, toRows(batSilhouetteGrid(wingsUp)), BAT_SILHOUETTE_PALETTE);
  }
  return canvas;
}

/**
 * One "flight unit": a positioned wrapper whose CSS animation carries it
 * across the menu on a wandering path, containing two stacked pixel-art
 * frames (wings up / wings down) whose opacity is flipped on a fast CSS
 * cycle to fake a flapping animation without any JS per-frame work.
 */
function buildBatFlight(extraClass: string, durationSeconds: number, delaySeconds: number): HTMLElement {
  const flight = document.createElement('div');
  flight.className = `menu-bat-flight ${extraClass}`;
  flight.style.animationDuration = `${durationSeconds}s`;
  flight.style.animationDelay = `${delaySeconds}s`;
  flight.append(buildBatFrame(true, 'menu-bat-frame--up'), buildBatFrame(false, 'menu-bat-frame--down'));
  return flight;
}
