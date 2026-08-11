import { spriteAtlas } from './SpriteAtlas';
import { drawPixelGrid, makeGrid, fillRect, toRows } from './PixelDraw';

// Same overall proportions as the base player sprite (SpriteLibrary.ts
// humanoidGrid) so character variants read consistently at the game's
// sprite scale: 16 wide x 18 tall.
const GW = 16;
const GH = 18;

type AccessoryFn = (g: string[][]) => void;

/**
 * Shared humanoid silhouette builder, mirroring
 * SpriteLibrary.ts::humanoidGrid but generalized so each roster character
 * can layer on a distinguishing accessory (spikes, cape, orbit dots, flame
 * tuft, pouch, belt) on top of the same base proportions.
 */
function humanoidBase(legOffset: number, armUp: boolean, accessory?: AccessoryFn): string[][] {
  const g = makeGrid(GW, GH);
  // hood/head
  fillRect(g, 6, 1, 9, 4, 'h');
  fillRect(g, 7, 2, 8, 3, 'e');
  // torso
  fillRect(g, 5, 5, 10, 11, 'b');
  fillRect(g, 6, 6, 9, 8, 'a'); // accent chest stripe
  // arms
  fillRect(g, 3, 6, 4, 10 + (armUp ? -2 : 0), 'b');
  fillRect(g, 11, 6, 12, 10, 'b');
  // legs (offset animates the stride)
  fillRect(g, 6, 12, 7, 16 + legOffset, 'p');
  fillRect(g, 8, 12, 9, 16 - legOffset, 'p');
  // feet
  fillRect(g, 5, 16 + legOffset, 7, 17 + legOffset, 'o');
  fillRect(g, 8, 16 - legOffset, 10, 17 - legOffset, 'o');
  if (accessory) accessory(g);
  return g;
}

interface CharacterArt {
  palette: Record<string, string>;
  accessory?: AccessoryFn;
}

// One palette (+ optional silhouette accessory) per roster character, keyed
// by CharacterDef.spriteKey. Distinct hues so cards/portraits stay
// recognizable at a glance, both on the select screen and in-game.
const CHARACTER_ART: Record<string, CharacterArt> = {
  // Brakka Thornguard - The Rampart: heavy armored bruiser, spiked pauldrons.
  thornguard: {
    palette: { h: '#8a8f96', e: '#1a1c1f', b: '#5b6470', a: '#c94b3b', p: '#33383f', o: '#131518', s: '#e6e2d8' },
    accessory: (g) => {
      fillRect(g, 3, 5, 4, 6, 's');
      fillRect(g, 11, 5, 12, 6, 's');
    },
  },
  // Vex Redline - The Redline Runner: slim speedster with a trailing scarf.
  redline: {
    palette: { h: '#f2c88f', e: '#20241f', b: '#d9403a', a: '#ffb84d', p: '#7a1f1f', o: '#171a17', s: '#ff8a3d' },
    accessory: (g) => {
      fillRect(g, 10, 5, 12, 7, 's');
    },
  },
  // Orin Warden - The Circling Warden: orbiter specialist, small floating blade dots.
  warden: {
    palette: { h: '#c9e8ff', e: '#141a1f', b: '#2c6e8f', a: '#59e0ff', p: '#1d3d4f', o: '#0f1518', s: '#b0f2ff' },
    accessory: (g) => {
      fillRect(g, 1, 4, 1, 4, 's');
      fillRect(g, 14, 4, 14, 4, 's');
      fillRect(g, 1, 9, 1, 9, 's');
      fillRect(g, 14, 9, 14, 9, 's');
    },
  },
  // Pyra Cinderborn - The Cinderborn: pyromancer, flame-tufted hood.
  cinderborn: {
    palette: { h: '#3a2620', e: '#0f0a08', b: '#7a2f1f', a: '#ff8a3d', p: '#4a1f14', o: '#120a08', s: '#ffd23d' },
    accessory: (g) => {
      fillRect(g, 6, 0, 7, 0, 's');
      fillRect(g, 8, 0, 9, 0, 's');
    },
  },
  // Lucca Fortune - Fortune's Hand: lucky scavenger, small coin pouch at the hip.
  fortune: {
    palette: { h: '#f2c88f', e: '#20241f', b: '#3a6b3a', a: '#d9b23a', p: '#26401f', o: '#171a17', s: '#e8c94a' },
    accessory: (g) => {
      fillRect(g, 10, 9, 11, 10, 's');
    },
  },
  // Dess Steadyhand - The Steady Hand: balanced generalist, plain robe with a belt accent.
  steadyhand: {
    palette: { h: '#e0c9a8', e: '#20241f', b: '#6a5a8a', a: '#b0a0d8', p: '#3f3560', o: '#171a17', s: '#d8c94a' },
    accessory: (g) => {
      fillRect(g, 5, 9, 10, 9, 's');
    },
  },
};

export function registerCharacterSprites(): void {
  for (const [spriteKey, art] of Object.entries(CHARACTER_ART)) {
    const idleA = humanoidBase(0, false, art.accessory);
    const idleB = humanoidBase(0, true, art.accessory);
    const walkA = humanoidBase(2, false, art.accessory);
    const walkB = humanoidBase(-2, true, art.accessory);

    spriteAtlas.registerClip(`${spriteKey}_idle`, 2.4, true, [
      { key: `${spriteKey}_idle_0`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(idleA), art.palette) },
      { key: `${spriteKey}_idle_1`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(idleB), art.palette) },
    ]);
    spriteAtlas.registerClip(`${spriteKey}_walk`, 8, true, [
      { key: `${spriteKey}_walk_0`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(walkA), art.palette) },
      { key: `${spriteKey}_idle_0b`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(idleA), art.palette) },
      { key: `${spriteKey}_walk_1`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(walkB), art.palette) },
      { key: `${spriteKey}_idle_0c`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(idleA), art.palette) },
    ]);
  }
}

/**
 * Draws a static idle-pose portrait for the given character's spriteKey
 * directly onto a caller-provided 2D canvas context - independent of the
 * WebGL sprite atlas, for use in DOM UI (e.g. CharacterSelect cards).
 * Falls back to the first registered character's art if spriteKey is
 * unrecognized, so a portrait always renders even for a not-yet-wired id.
 */
export function drawCharacterPortrait(ctx: CanvasRenderingContext2D, size: number, spriteKey: string): void {
  const art = CHARACTER_ART[spriteKey] ?? Object.values(CHARACTER_ART)[0];
  const grid = humanoidBase(0, false, art.accessory);
  drawPixelGrid(ctx, size, toRows(grid), art.palette);
}
