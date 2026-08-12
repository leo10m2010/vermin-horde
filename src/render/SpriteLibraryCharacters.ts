import { spriteAtlas } from './SpriteAtlas';
import { drawPixelGrid, makeGrid, fillRect, toRows } from './PixelDraw';

/**
 * Unlike the shared `humanoidGrid` base sprite (SpriteLibrary.ts - the
 * default/fallback adventurer), every roster character below gets its own
 * hand-authored silhouette function: its own grid dimensions, its own
 * proportions, its own accessory shapes, and now its own full pose set
 * (idle, walk, hit, cast, death) - a first pass only covered idle/walk and
 * silently fell back to the generic adventurer for the rest, which is what
 * made hit/cast/death briefly show a "different person" (see Player.ts's
 * resolveClip comment for the full story).
 *
 * Every character shares one non-negotiable readability skeleton, closer to
 * how actual Vampire Survivors sprites read at a glance, learned the hard
 * way after an earlier pass drew each character as one undifferentiated
 * color blob (a solid red teardrop, a blue cone with no legs, a purple
 * bottle) that didn't read as a person at all:
 *   - a head with TWO separate single-pixel eyes (never one solid visor
 *     slit) with a real gap between them
 *   - arms drawn in their own shade ('m'), distinct from the torso ('b'),
 *     so the silhouette doesn't fuse into one blob at small render scale
 *   - two legs with a real transparent gap between them (never touching),
 *     each ending in a darker foot/boot ('o')
 *   - a small held-weapon prop ('w') poking out of the active hand, with a
 *     visible hand/grip patch ('n') where it meets the arm, because every
 *     real VS character is drawn visibly holding their starting weapon
 *   - a 1px dark outline stamped around the whole silhouette (via
 *     `drawPixelGrid`'s `outlineColor` param) - the single biggest thing
 *     separating "flat color blob" from "actual pixel-art character"
 * Each character's gimmick (pauldrons, scarf, hood point, flame crown, hat +
 * satchel, cape) is layered ON TOP of that skeleton, never replacing it.
 *
 * hit/cast poses mirror the structure of SpriteLibrary.ts's default
 * playerHitGrid/playerCastGrid (lean-away recoil; 3-stage windup/peak/
 * release flourish) but built from each character's OWN proportions,
 * palette, and one signature accessory, so getting hit or attacking never
 * swaps who's on screen. death reuses one shared collapse-stage generator
 * (genericDeathGrid) parametrized per character, since that pose is brief
 * (covered by the game-over overlay within a few frames) and a fully
 * bespoke collapse animation per character would be a lot of authoring for
 * something the player barely sees.
 *
 * Idle/walk grid functions still take (legOffset, armUp) so
 * registerCharacterSprites can build the same 2-frame idle / 4-frame walk
 * cycle it always has; hit takes a `settled` stage flag and cast/death take
 * a numeric stage, mirroring the default adventurer's own signatures.
 */

interface CharacterArt {
  palette: Record<string, string>;
  outline: string;
  grid: (legOffset: number, armUp: boolean) => string[][];
  hitGrid: (settled: boolean) => string[][];
  castGrid: (stage: number) => string[][];
  deathGrid: (stage: number) => string[][];
}

/**
 * Shared collapse-stage generator for the brief death pose: head drops,
 * torso squashes, arms splay outward, and everything settles into a flat
 * heap on the last stage. Takes each character's own grid size and head/
 * torso column anchors (pulled straight from their idle grid) so the
 * silhouette width still matches that character instead of a generic body.
 */
function genericDeathGrid(w: number, h: number, headX0: number, headX1: number, torsoX0: number, torsoX1: number, stage: number): string[][] {
  const g = makeGrid(w, h);
  const drop = stage * 2;
  const headY = Math.min(h - 7, 1 + drop);
  fillRect(g, headX0, headY, headX1, headY + 3, 'h');
  fillRect(g, headX0 + 1, headY + 1, headX0 + 1, headY + 1, 'e');
  fillRect(g, headX1 - 1, headY + 1, headX1 - 1, headY + 1, 'e');
  const torsoTop = headY + 4;
  const torsoBottom = Math.min(h - 2, torsoTop + (8 - stage));
  fillRect(g, torsoX0, torsoTop, torsoX1, torsoBottom, 'b');
  fillRect(g, torsoX0 + 1, torsoTop + 1, torsoX1 - 1, torsoTop + 3, 'a');
  fillRect(g, Math.max(0, torsoX0 - 2 - stage), torsoTop, Math.max(0, torsoX0 - 1 - stage), torsoTop + 3, 'm');
  fillRect(g, Math.min(w - 2, torsoX1 + 1 + stage), torsoTop, Math.min(w - 1, torsoX1 + 2 + stage), torsoTop + 3, 'm');
  const legY = Math.min(h - 2, torsoBottom + 1);
  fillRect(g, torsoX0, legY, torsoX1, Math.min(h - 1, legY + 1), 'p');
  return g;
}

// --- Brakka Thornguard - The Rampart: heavy armored bruiser. Wide, squat
// silhouette with a helm, two small glowing eye-slits (not one blank visor
// bar), oversized spiked pauldrons, and a warhammer held overhead-ready. ---
function thornguardGrid(legOffset: number, armUp: boolean): string[][] {
  const g = makeGrid(18, 20);
  const lo = Math.round(legOffset / 2);
  fillRect(g, 6, 0, 11, 3, 'h');
  fillRect(g, 7, 2, 7, 2, 'e');
  fillRect(g, 10, 2, 10, 2, 'e');
  fillRect(g, 4, 4, 13, 12, 'b');
  fillRect(g, 5, 5, 12, 9, 'a');
  fillRect(g, 0, 4, 2, 9, 's');
  fillRect(g, 0, 2, 1, 3, 's');
  fillRect(g, 15, 4, 17, 9, 's');
  fillRect(g, 16, 2, 17, 3, 's');
  fillRect(g, 2, 8, 3, 13, 'm');
  fillRect(g, 14, 8, 15, 13 - (armUp ? 3 : 0), 'm');
  fillRect(g, 14, armUp ? 7 : 8, 15, armUp ? 8 : 9, 'n'); // gauntlet grip
  fillRect(g, 14, armUp ? 1 : 5, 15, armUp ? 8 : 8, 'w');
  fillRect(g, 13, armUp ? 0 : 4, 16, armUp ? 2 : 6, 'w');
  fillRect(g, 5, 13, 7, 17 + lo, 'p');
  fillRect(g, 10, 13, 12, 17 - lo, 'p');
  fillRect(g, 4, 17 + lo, 7, 19 + lo, 'o');
  fillRect(g, 10, 17 - lo, 13, 19 - lo, 'o');
  return g;
}

function thornguardHitGrid(settled: boolean): string[][] {
  const g = makeGrid(18, 20);
  const lean = settled ? 0 : 1;
  fillRect(g, 6 + lean, 0, 11 + lean, 3, 'h');
  fillRect(g, 7 + lean, 2, 7 + lean, 2, 'e');
  fillRect(g, 10 + lean, 2, 10 + lean, 2, 'e');
  fillRect(g, 4 + lean, 4, 13 + lean, 12, 'b');
  fillRect(g, 5 + lean, 5, 12 + lean, 9, 'a');
  fillRect(g, 0, 3, 2, 8, 's');
  fillRect(g, 15, 3, 17, 8, 's');
  const armY1 = settled ? 6 : 4;
  fillRect(g, 0, 2, 2, armY1, 'm');
  fillRect(g, 15, 2, 17, armY1, 'm');
  fillRect(g, 5, 13, 8, 18, 'p');
  fillRect(g, 10, 13, 13, 18, 'p');
  fillRect(g, 4, 18, 8, 19, 'o');
  fillRect(g, 10, 18, 14, 19, 'o');
  return g;
}

function thornguardCastGrid(stage: number): string[][] {
  const g = makeGrid(18, 20);
  const lean = stage === 2 ? 1 : 0;
  fillRect(g, 6 + lean, 0, 11 + lean, 3, 'h');
  fillRect(g, 7 + lean, 2, 7 + lean, 2, 'e');
  fillRect(g, 10 + lean, 2, 10 + lean, 2, 'e');
  fillRect(g, 4 + lean, 4, 13 + lean, 12, 'b');
  fillRect(g, 5 + lean, 5, 12 + lean, 9, 'a');
  fillRect(g, 0, 4, 2, 9, 's');
  fillRect(g, 15, 4, 17, 9, 's');
  fillRect(g, 2, 9, 3, 13, 'm');
  if (stage === 0) {
    fillRect(g, 14, 9, 15, 13, 'm');
    fillRect(g, 13, 10, 16, 12, 'w');
  } else if (stage === 1) {
    fillRect(g, 14, 1, 15, 9, 'm');
    fillRect(g, 12, 0, 17, 2, 'w');
  } else {
    fillRect(g, 15, 7, 17, 10, 'm');
    fillRect(g, 15, 4, 17, 6, 'w');
  }
  fillRect(g, 5, 13, 7, 17, 'p');
  fillRect(g, 10, 13, 12, 17, 'p');
  fillRect(g, 4, 17, 7, 19, 'o');
  fillRect(g, 10, 17, 13, 19, 'o');
  return g;
}

// --- Vex Redline - The Redline Runner: slim speedster. Narrow, tall
// silhouette with a long scarf streaming off the back opposite the stride
// direction, a bare face with two clear eyes, and a thrown dagger held
// ready. ---
function redlineGrid(legOffset: number, armUp: boolean): string[][] {
  const g = makeGrid(15, 22);
  const flutter = legOffset > 0 ? 1 : legOffset < 0 ? -1 : 0;
  fillRect(g, 5, 0, 9, 3, 'h');
  fillRect(g, 6, 2, 6, 2, 'e');
  fillRect(g, 8, 2, 8, 2, 'e');
  fillRect(g, 5, 4, 9, 10, 'b');
  fillRect(g, 6, 5, 8, 7, 'a');
  fillRect(g, 1, 2, 4, 4, 's');
  fillRect(g, 0, 5 + flutter, 3, 6 + flutter, 's');
  fillRect(g, 0, 7 + flutter, 2, 8 + flutter, 's');
  fillRect(g, 3, 5, 4, 9 - (armUp ? 2 : 0), 'm');
  fillRect(g, 10, 5, 11, 9, 'm');
  fillRect(g, 10, 4, 11, 5, 'n'); // hand grip
  fillRect(g, 11, 4, 13, 5, 'w');
  fillRect(g, 5, 11, 6, 17 + legOffset, 'p');
  fillRect(g, 8, 11, 9, 17 - legOffset, 'p');
  fillRect(g, 4, 17 + legOffset, 6, 19 + legOffset, 'o');
  fillRect(g, 8, 17 - legOffset, 10, 19 - legOffset, 'o');
  return g;
}

function redlineHitGrid(settled: boolean): string[][] {
  const g = makeGrid(15, 22);
  const lean = settled ? 0 : 1;
  fillRect(g, 5 + lean, 0, 9 + lean, 3, 'h');
  fillRect(g, 6 + lean, 2, 6 + lean, 2, 'e');
  fillRect(g, 8 + lean, 2, 8 + lean, 2, 'e');
  fillRect(g, 5 + lean, 4, 9 + lean, 10, 'b');
  fillRect(g, 6 + lean, 5, 8 + lean, 7, 'a');
  fillRect(g, 1, 3, 4, 5, 's');
  const armY1 = settled ? 6 : 4;
  fillRect(g, 0, 3, 1, armY1, 'm');
  fillRect(g, 11, 3, 12, armY1, 'm');
  fillRect(g, 5, 11, 6, 16, 'p');
  fillRect(g, 8, 11, 9, 16, 'p');
  fillRect(g, 4, 16, 6, 18, 'o');
  fillRect(g, 8, 16, 10, 18, 'o');
  return g;
}

function redlineCastGrid(stage: number): string[][] {
  const g = makeGrid(15, 22);
  const lean = stage === 2 ? 1 : 0;
  fillRect(g, 5 + lean, 0, 9 + lean, 3, 'h');
  fillRect(g, 6 + lean, 2, 6 + lean, 2, 'e');
  fillRect(g, 8 + lean, 2, 8 + lean, 2, 'e');
  fillRect(g, 5 + lean, 4, 9 + lean, 10, 'b');
  fillRect(g, 6 + lean, 5, 8 + lean, 7, 'a');
  fillRect(g, 1, 2, 4, 4, 's');
  fillRect(g, 3, 5, 4, 8, 'm');
  if (stage === 0) {
    fillRect(g, 10, 6, 11, 9, 'm');
    fillRect(g, 10, 8, 12, 9, 'w');
  } else if (stage === 1) {
    fillRect(g, 10, 1, 11, 6, 'm');
    fillRect(g, 10, 0, 12, 1, 'w');
  } else {
    fillRect(g, 11, 4, 12, 6, 'm');
    fillRect(g, 12, 3, 14, 5, 'w');
  }
  fillRect(g, 5, 11, 6, 16, 'p');
  fillRect(g, 8, 11, 9, 16, 'p');
  fillRect(g, 4, 16, 6, 18, 'o');
  fillRect(g, 8, 16, 10, 18, 'o');
  return g;
}

// --- Orin Warden - The Circling Warden: orbiter mage. Tall pointed hood,
// two eyes visible beneath it, a staff planted in the free hand, and two
// clearly split legs peeking out below the robe hem, plus four small
// blade-motes drifting around the body as a nod to the orbiter-blade
// starting weapon. ---
function wardenGrid(legOffset: number, armUp: boolean): string[][] {
  const g = makeGrid(17, 22);
  const sway = Math.round(legOffset / 2);
  fillRect(g, 7, 0, 9, 0, 'h');
  fillRect(g, 6, 1, 10, 1, 'h');
  fillRect(g, 5, 2, 11, 5, 'h');
  fillRect(g, 6, 4, 6, 4, 'e');
  fillRect(g, 10, 4, 10, 4, 'e');
  fillRect(g, 5, 6, 11, 13, 'b');
  fillRect(g, 6, 7, 10, 9, 'a');
  fillRect(g, 3, 7, 4, 11 - (armUp ? 2 : 0), 'm');
  fillRect(g, 12, 7, 13, 11, 'm');
  fillRect(g, 12, 6, 13, 7, 'n'); // hand grip
  fillRect(g, 12, 2, 13, 7, 'w');
  fillRect(g, 11, 1, 14, 2, 'w');
  fillRect(g, 4, 14, 12, 16, 'b');
  fillRect(g, 5 + sway, 17, 7 + sway, 20, 'p');
  fillRect(g, 9 + sway, 17, 11 + sway, 20, 'p');
  fillRect(g, 4 + sway, 20, 7 + sway, 21, 'o');
  fillRect(g, 9 + sway, 20, 12 + sway, 21, 'o');
  fillRect(g, 0, 8 + sway, 1, 9 + sway, 's');
  fillRect(g, 15, 8 - sway, 16, 9 - sway, 's');
  fillRect(g, 1, 3 - sway, 2, 4 - sway, 's');
  fillRect(g, 14, 3 + sway, 15, 4 + sway, 's');
  return g;
}

function wardenHitGrid(settled: boolean): string[][] {
  const g = makeGrid(17, 22);
  const lean = settled ? 0 : 1;
  fillRect(g, 5 + lean, 2, 11 + lean, 5, 'h');
  fillRect(g, 6 + lean, 4, 6 + lean, 4, 'e');
  fillRect(g, 10 + lean, 4, 10 + lean, 4, 'e');
  fillRect(g, 5 + lean, 6, 11 + lean, 13, 'b');
  fillRect(g, 6 + lean, 7, 10 + lean, 9, 'a');
  const armY1 = settled ? 9 : 7;
  fillRect(g, 1, 6, 2, armY1, 'm');
  fillRect(g, 14, 6, 15, armY1, 'm');
  fillRect(g, 4, 14, 12, 16, 'b');
  fillRect(g, 5, 17, 7, 20, 'p');
  fillRect(g, 9, 17, 11, 20, 'p');
  fillRect(g, 4, 20, 7, 21, 'o');
  fillRect(g, 9, 20, 12, 21, 'o');
  return g;
}

function wardenCastGrid(stage: number): string[][] {
  const g = makeGrid(17, 22);
  const lean = stage === 2 ? 1 : 0;
  fillRect(g, 5 + lean, 2, 11 + lean, 5, 'h');
  fillRect(g, 6 + lean, 4, 6 + lean, 4, 'e');
  fillRect(g, 10 + lean, 4, 10 + lean, 4, 'e');
  fillRect(g, 5 + lean, 6, 11 + lean, 13, 'b');
  fillRect(g, 6 + lean, 7, 10 + lean, 9, 'a');
  fillRect(g, 3, 7, 4, 11, 'm');
  if (stage === 0) {
    fillRect(g, 12, 8, 13, 12, 'm');
    fillRect(g, 12, 10, 14, 12, 'w');
  } else if (stage === 1) {
    fillRect(g, 12, 1, 13, 8, 'm');
    fillRect(g, 11, 0, 14, 1, 'w');
  } else {
    fillRect(g, 13, 6, 14, 9, 'm');
    fillRect(g, 14, 4, 16, 7, 'w');
  }
  fillRect(g, 4, 14, 12, 16, 'b');
  fillRect(g, 5, 17, 7, 20, 'p');
  fillRect(g, 9, 17, 11, 20, 'p');
  fillRect(g, 4, 20, 7, 21, 'o');
  fillRect(g, 9, 20, 12, 21, 'o');
  return g;
}

// --- Pyra Cinderborn - The Cinderborn: pyromancer. A jagged 3-pronged
// flame crown above the hood, two eyes visible beneath it, and a lit ember
// in the cast hand that lifts overhead on the "arm up" frames. ---
function cinderbornGrid(legOffset: number, armUp: boolean): string[][] {
  const g = makeGrid(16, 22);
  fillRect(g, 6, 0, 8, 0, 's');
  fillRect(g, 4, 1, 5, 1, 's');
  fillRect(g, 9, 1, 10, 1, 's');
  fillRect(g, 5, 2, 9, 2, 's');
  fillRect(g, 5, 3, 10, 6, 'h');
  fillRect(g, 6, 5, 6, 5, 'e');
  fillRect(g, 9, 5, 9, 5, 'e');
  fillRect(g, 4, 7, 11, 14, 'b');
  fillRect(g, 5, 8, 10, 11, 'a');
  fillRect(g, 2, 8, 3, 13, 'm');
  fillRect(g, 12, 8, 13, 13 - (armUp ? 3 : 0), 'm');
  if (armUp) {
    fillRect(g, 12, 9, 13, 10, 'n'); // hand grip
    fillRect(g, 13, 2, 14, 8, 'w');
    fillRect(g, 12, 1, 15, 2, 's');
  } else {
    fillRect(g, 12, 12, 13, 13, 'n');
    fillRect(g, 13, 12, 14, 14, 'w');
    fillRect(g, 12, 14, 15, 15, 's');
  }
  fillRect(g, 6, 15, 7, 19 + legOffset, 'p');
  fillRect(g, 9, 15, 10, 19 - legOffset, 'p');
  fillRect(g, 5, 19 + legOffset, 7, 21 + legOffset, 'o');
  fillRect(g, 9, 19 - legOffset, 11, 21 - legOffset, 'o');
  return g;
}

function cinderbornHitGrid(settled: boolean): string[][] {
  const g = makeGrid(16, 22);
  const lean = settled ? 0 : 1;
  fillRect(g, 6 + lean, 0, 8 + lean, 2, 's');
  fillRect(g, 5 + lean, 3, 10 + lean, 6, 'h');
  fillRect(g, 6 + lean, 5, 6 + lean, 5, 'e');
  fillRect(g, 9 + lean, 5, 9 + lean, 5, 'e');
  fillRect(g, 4 + lean, 7, 11 + lean, 14, 'b');
  fillRect(g, 5 + lean, 8, 10 + lean, 11, 'a');
  const armY1 = settled ? 11 : 9;
  fillRect(g, 0, 7, 1, armY1, 'm');
  fillRect(g, 14, 7, 15, armY1, 'm');
  fillRect(g, 6, 15, 7, 19, 'p');
  fillRect(g, 9, 15, 10, 19, 'p');
  fillRect(g, 5, 19, 7, 21, 'o');
  fillRect(g, 9, 19, 11, 21, 'o');
  return g;
}

function cinderbornCastGrid(stage: number): string[][] {
  const g = makeGrid(16, 22);
  const lean = stage === 2 ? 1 : 0;
  fillRect(g, 6 + lean, 0, 8 + lean, 2, 's');
  fillRect(g, 5 + lean, 3, 10 + lean, 6, 'h');
  fillRect(g, 6 + lean, 5, 6 + lean, 5, 'e');
  fillRect(g, 9 + lean, 5, 9 + lean, 5, 'e');
  fillRect(g, 4 + lean, 7, 11 + lean, 14, 'b');
  fillRect(g, 5 + lean, 8, 10 + lean, 11, 'a');
  fillRect(g, 2, 8, 3, 13, 'm');
  if (stage === 0) {
    fillRect(g, 12, 9, 13, 13, 'm');
    fillRect(g, 12, 12, 14, 14, 'w');
  } else if (stage === 1) {
    fillRect(g, 12, 2, 13, 9, 'm');
    fillRect(g, 11, 1, 14, 2, 's');
  } else {
    fillRect(g, 13, 6, 14, 9, 'm');
    fillRect(g, 14, 4, 15, 7, 'w');
  }
  fillRect(g, 6, 15, 7, 19, 'p');
  fillRect(g, 9, 15, 10, 19, 'p');
  fillRect(g, 5, 19, 7, 21, 'o');
  fillRect(g, 9, 19, 11, 21, 'o');
  return g;
}

// --- Lucca Fortune - Fortune's Hand: lucky scavenger. A wide-brim hat with
// the face (and two eyes) visible beneath its shadow, a magic wand held
// ready, and a bulging coin satchel slung on a shoulder strap at the hip. ---
function fortuneGrid(legOffset: number, armUp: boolean): string[][] {
  const g = makeGrid(18, 20);
  fillRect(g, 6, 0, 9, 0, 'h');
  fillRect(g, 3, 1, 12, 2, 'h');
  fillRect(g, 6, 3, 9, 4, 'h');
  fillRect(g, 6, 4, 6, 4, 'e');
  fillRect(g, 9, 4, 9, 4, 'e');
  fillRect(g, 5, 5, 10, 11, 'b');
  fillRect(g, 6, 6, 9, 8, 'a');
  fillRect(g, 3, 6, 4, 10 - (armUp ? 2 : 0), 'm');
  fillRect(g, 11, 6, 12, 10, 'm');
  fillRect(g, 11, 6, 12, 7, 'n'); // hand grip
  fillRect(g, 12, 3, 13, 7, 'w');
  fillRect(g, 10, 5, 11, 6, 'a');
  fillRect(g, 11, 7, 12, 8, 'a');
  fillRect(g, 13, 9, 16, 12, 's');
  fillRect(g, 6, 12, 7, 16 + legOffset, 'p');
  fillRect(g, 9, 12, 10, 16 - legOffset, 'p');
  fillRect(g, 5, 16 + legOffset, 7, 18 + legOffset, 'o');
  fillRect(g, 9, 16 - legOffset, 11, 18 - legOffset, 'o');
  return g;
}

function fortuneHitGrid(settled: boolean): string[][] {
  const g = makeGrid(18, 20);
  const lean = settled ? 0 : 1;
  fillRect(g, 3 + lean, 0, 12 + lean, 2, 'h');
  fillRect(g, 6 + lean, 3, 9 + lean, 4, 'h');
  fillRect(g, 6 + lean, 4, 6 + lean, 4, 'e');
  fillRect(g, 9 + lean, 4, 9 + lean, 4, 'e');
  fillRect(g, 5 + lean, 5, 10 + lean, 11, 'b');
  fillRect(g, 6 + lean, 6, 9 + lean, 8, 'a');
  const armY1 = settled ? 7 : 5;
  fillRect(g, 1, 4, 2, armY1, 'm');
  fillRect(g, 13, 4, 14, armY1, 'm');
  fillRect(g, 6, 12, 7, 16, 'p');
  fillRect(g, 9, 12, 10, 16, 'p');
  fillRect(g, 5, 16, 7, 18, 'o');
  fillRect(g, 9, 16, 11, 18, 'o');
  return g;
}

function fortuneCastGrid(stage: number): string[][] {
  const g = makeGrid(18, 20);
  const lean = stage === 2 ? 1 : 0;
  fillRect(g, 3 + lean, 0, 12 + lean, 2, 'h');
  fillRect(g, 6 + lean, 3, 9 + lean, 4, 'h');
  fillRect(g, 6 + lean, 4, 6 + lean, 4, 'e');
  fillRect(g, 9 + lean, 4, 9 + lean, 4, 'e');
  fillRect(g, 5 + lean, 5, 10 + lean, 11, 'b');
  fillRect(g, 6 + lean, 6, 9 + lean, 8, 'a');
  fillRect(g, 3, 6, 4, 10, 'm');
  if (stage === 0) {
    fillRect(g, 11, 7, 12, 11, 'm');
    fillRect(g, 12, 9, 14, 10, 'w');
  } else if (stage === 1) {
    fillRect(g, 11, 1, 12, 7, 'm');
    fillRect(g, 11, 0, 13, 1, 'w');
  } else {
    fillRect(g, 12, 5, 13, 8, 'm');
    fillRect(g, 13, 3, 15, 5, 'w');
  }
  fillRect(g, 6, 12, 7, 16, 'p');
  fillRect(g, 9, 12, 10, 16, 'p');
  fillRect(g, 5, 16, 7, 18, 'o');
  fillRect(g, 9, 16, 11, 18, 'o');
  return g;
}

// --- Dess Steadyhand - The Steady Hand: balanced generalist. Deliberately
// the plainest silhouette on the roster (closest to the base humanoid
// proportions, matching a trait with no gimmick and no malus) with a
// traveler's cape that flanks the torso WITHOUT smothering the leg gap, a
// belt band, and a small glowing garlic-aura charm held at the hip. ---
function steadyhandGrid(legOffset: number, armUp: boolean): string[][] {
  const g = makeGrid(16, 20);
  fillRect(g, 3, 6, 4, 15, 'c');
  fillRect(g, 11, 6, 12, 15, 'c');
  fillRect(g, 6, 1, 9, 4, 'h');
  fillRect(g, 6, 3, 6, 3, 'e');
  fillRect(g, 9, 3, 9, 3, 'e');
  fillRect(g, 5, 5, 10, 11, 'b');
  fillRect(g, 6, 6, 9, 8, 'a');
  fillRect(g, 5, 9, 10, 9, 's');
  fillRect(g, 3, 6, 4, 10 - (armUp ? 2 : 0), 'm');
  fillRect(g, 11, 6, 12, 10, 'm');
  fillRect(g, 11, 9, 12, 10, 'n'); // hand grip
  fillRect(g, 11, 10, 12, 11, 'w');
  fillRect(g, 6, 12, 7, 16 + legOffset, 'p');
  fillRect(g, 9, 12, 10, 16 - legOffset, 'p');
  fillRect(g, 5, 16 + legOffset, 7, 18 + legOffset, 'o');
  fillRect(g, 9, 16 - legOffset, 11, 18 - legOffset, 'o');
  return g;
}

function steadyhandHitGrid(settled: boolean): string[][] {
  const g = makeGrid(16, 20);
  const lean = settled ? 0 : 1;
  fillRect(g, 3, 6, 4, 14, 'c');
  fillRect(g, 11, 6, 12, 14, 'c');
  fillRect(g, 6 + lean, 1, 9 + lean, 4, 'h');
  fillRect(g, 6 + lean, 3, 6 + lean, 3, 'e');
  fillRect(g, 9 + lean, 3, 9 + lean, 3, 'e');
  fillRect(g, 5 + lean, 5, 10 + lean, 11, 'b');
  fillRect(g, 6 + lean, 6, 9 + lean, 8, 'a');
  const armY1 = settled ? 7 : 5;
  fillRect(g, 1, 4, 2, armY1, 'm');
  fillRect(g, 13, 4, 14, armY1, 'm');
  fillRect(g, 6, 12, 7, 16, 'p');
  fillRect(g, 9, 12, 10, 16, 'p');
  fillRect(g, 5, 16, 7, 18, 'o');
  fillRect(g, 9, 16, 11, 18, 'o');
  return g;
}

function steadyhandCastGrid(stage: number): string[][] {
  const g = makeGrid(16, 20);
  const lean = stage === 2 ? 1 : 0;
  fillRect(g, 3, 6, 4, 14, 'c');
  fillRect(g, 11, 6, 12, 14, 'c');
  fillRect(g, 6 + lean, 1, 9 + lean, 4, 'h');
  fillRect(g, 6 + lean, 3, 6 + lean, 3, 'e');
  fillRect(g, 9 + lean, 3, 9 + lean, 3, 'e');
  fillRect(g, 5 + lean, 5, 10 + lean, 11, 'b');
  fillRect(g, 6 + lean, 6, 9 + lean, 8, 'a');
  fillRect(g, 3, 6, 4, 10, 'm');
  if (stage === 0) {
    fillRect(g, 11, 7, 12, 11, 'm');
    fillRect(g, 11, 9, 13, 10, 'w');
  } else if (stage === 1) {
    fillRect(g, 11, 1, 12, 7, 'm');
    fillRect(g, 11, 0, 13, 1, 'w');
  } else {
    fillRect(g, 12, 5, 13, 8, 'm');
    fillRect(g, 13, 3, 14, 5, 'w');
  }
  fillRect(g, 6, 12, 7, 16, 'p');
  fillRect(g, 9, 12, 10, 16, 'p');
  fillRect(g, 5, 16, 7, 18, 'o');
  fillRect(g, 9, 16, 11, 18, 'o');
  return g;
}

// One palette + grid/pose builder set per roster character, keyed by
// CharacterDef.spriteKey. Distinct hues AND distinct shapes, so cards/
// portraits and in-game sprites stay recognizable at a glance from each
// other and from the default adventurer sprite. Every palette shares the
// same role legend: h=head/hood, e=eyes, b=torso base, a=torso accent,
// m=arms/sleeves (always a distinct shade from b), n=hand/grip, p=legs,
// o=feet/boots, w=held weapon, s=character-specific gimmick accent,
// c=cape (Dess only).
const CHARACTER_ART: Record<string, CharacterArt> = {
  thornguard: {
    palette: {
      h: '#8a8f96', e: '#ff3b3b', b: '#5b6470', a: '#c94b3b', m: '#454c56',
      n: '#d8b48a', p: '#33383f', o: '#131518', s: '#e6e2d8', w: '#c7cdd6',
    },
    outline: '#0c0d10',
    grid: thornguardGrid,
    hitGrid: thornguardHitGrid,
    castGrid: thornguardCastGrid,
    deathGrid: (stage) => genericDeathGrid(18, 20, 6, 11, 4, 13, stage),
  },
  redline: {
    palette: {
      h: '#f2c88f', e: '#20241f', b: '#d9403a', a: '#ffb84d', m: '#a82f2a',
      n: '#f2c88f', p: '#7a1f1f', o: '#171a17', s: '#ff8a3d', w: '#e8e2d8',
    },
    outline: '#160808',
    grid: redlineGrid,
    hitGrid: redlineHitGrid,
    castGrid: redlineCastGrid,
    deathGrid: (stage) => genericDeathGrid(15, 22, 5, 9, 5, 9, stage),
  },
  warden: {
    palette: {
      h: '#c9e8ff', e: '#0d1114', b: '#2c6e8f', a: '#59e0ff', m: '#1f4f68',
      n: '#c9e8ff', p: '#1d3d4f', o: '#0f1518', s: '#b0f2ff', w: '#e8f8ff',
    },
    outline: '#081014',
    grid: wardenGrid,
    hitGrid: wardenHitGrid,
    castGrid: wardenCastGrid,
    deathGrid: (stage) => genericDeathGrid(17, 22, 5, 11, 5, 11, stage),
  },
  cinderborn: {
    palette: {
      h: '#3a2620', e: '#ffd23d', b: '#7a2f1f', a: '#ff8a3d', m: '#5c2216',
      n: '#e8b06a', p: '#4a1f14', o: '#120a08', s: '#ffd23d', w: '#ffb84d',
    },
    outline: '#0e0604',
    grid: cinderbornGrid,
    hitGrid: cinderbornHitGrid,
    castGrid: cinderbornCastGrid,
    deathGrid: (stage) => genericDeathGrid(16, 22, 5, 10, 4, 11, stage),
  },
  fortune: {
    palette: {
      h: '#f2c88f', e: '#20241f', b: '#3a6b3a', a: '#d9b23a', m: '#2c4f2c',
      n: '#f2c88f', p: '#26401f', o: '#171a17', s: '#e8c94a', w: '#c9a86a',
    },
    outline: '#0c1408',
    grid: fortuneGrid,
    hitGrid: fortuneHitGrid,
    castGrid: fortuneCastGrid,
    deathGrid: (stage) => genericDeathGrid(18, 20, 6, 9, 5, 10, stage),
  },
  steadyhand: {
    palette: {
      h: '#e0c9a8', e: '#20241f', b: '#6a5a8a', a: '#b0a0d8', m: '#4f4270',
      n: '#e0c9a8', p: '#3f3560', o: '#171a17', s: '#d8c94a', c: '#251f3d', w: '#b0f2ff',
    },
    outline: '#0e0a18',
    grid: steadyhandGrid,
    hitGrid: steadyhandHitGrid,
    castGrid: steadyhandCastGrid,
    deathGrid: (stage) => genericDeathGrid(16, 20, 6, 9, 5, 10, stage),
  },
};

export function registerCharacterSprites(): void {
  for (const [spriteKey, art] of Object.entries(CHARACTER_ART)) {
    const idleA = art.grid(0, false);
    const idleB = art.grid(0, true);
    const walkA = art.grid(2, false);
    const walkB = art.grid(-2, true);

    spriteAtlas.registerClip(`${spriteKey}_idle`, 2.4, true, [
      { key: `${spriteKey}_idle_0`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(idleA), art.palette, art.outline) },
      { key: `${spriteKey}_idle_1`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(idleB), art.palette, art.outline) },
    ]);
    spriteAtlas.registerClip(`${spriteKey}_walk`, 8, true, [
      { key: `${spriteKey}_walk_0`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(walkA), art.palette, art.outline) },
      { key: `${spriteKey}_idle_0b`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(idleA), art.palette, art.outline) },
      { key: `${spriteKey}_walk_1`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(walkB), art.palette, art.outline) },
      { key: `${spriteKey}_idle_0c`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(idleA), art.palette, art.outline) },
    ]);

    // flinch/recoil pose - matches the default adventurer's player_hit contract.
    const hitA = art.hitGrid(false);
    const hitB = art.hitGrid(true);
    spriteAtlas.registerClip(`${spriteKey}_hit`, 10, false, [
      { key: `${spriteKey}_hit_0`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(hitA), art.palette, art.outline) },
      { key: `${spriteKey}_hit_1`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(hitB), art.palette, art.outline) },
    ]);

    // attack flourish - windup / peak / release, matches player_cast's contract.
    const castA = art.castGrid(0);
    const castB = art.castGrid(1);
    const castC = art.castGrid(2);
    spriteAtlas.registerClip(`${spriteKey}_cast`, 16, false, [
      { key: `${spriteKey}_cast_0`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(castA), art.palette, art.outline) },
      { key: `${spriteKey}_cast_1`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(castB), art.palette, art.outline) },
      { key: `${spriteKey}_cast_2`, draw: (ctx, size) => drawPixelGrid(ctx, size, toRows(castC), art.palette, art.outline) },
    ]);

    // collapsing sequence - matches player_death's contract.
    const deathFrames = [0, 1, 2, 3].map((stage) => art.deathGrid(stage));
    spriteAtlas.registerClip(
      `${spriteKey}_death`,
      4,
      false,
      deathFrames.map((g, i) => ({
        key: `${spriteKey}_death_${i}`,
        draw: (ctx: CanvasRenderingContext2D, size: number) => drawPixelGrid(ctx, size, toRows(g), art.palette, art.outline),
      })),
    );
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
  const grid = art.grid(0, false);
  drawPixelGrid(ctx, size, toRows(grid), art.palette, art.outline);
}
