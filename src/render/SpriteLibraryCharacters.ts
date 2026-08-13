import { spriteAtlas } from './SpriteAtlas';
import { drawPixelGrid, makeGrid, fillRect, fillRectShaded, toRows } from './PixelDraw';

/**
 * Unlike the shared `humanoidGrid` base sprite (SpriteLibrary.ts - the
 * default/fallback adventurer), every roster character below gets its own
 * hand-authored silhouette function: its own grid dimensions, its own
 * proportions, its own accessory shapes, and a full pose set (idle, walk,
 * hit, cast, death).
 *
 * Every character shares one non-negotiable readability skeleton, closer to
 * how actual Vampire Survivors sprites read at a glance:
 *   - a head with TWO separate single-pixel-wide eyes (never one solid
 *     visor slit) with a real gap between them, each eye topped with a
 *     bright single-pixel gleam so the face reads as alive, not a blank slit
 *   - arms drawn in their own shade, distinct from the torso, so the
 *     silhouette doesn't fuse into one blob at small render scale
 *   - two legs with a real transparent gap between them (never touching),
 *     each ending in a darker foot/boot
 *   - a held-weapon prop poking out of the active hand, with a visible
 *     hand/grip patch where it meets the arm
 *   - a 1px dark outline stamped around the whole silhouette (via
 *     `drawPixelGrid`'s `outlineColor` param)
 *   - EVERY major block (helm, torso, accent panel, arms, legs, weapon
 *     head, signature accessory) is painted with `fillRectShaded` instead of
 *     a flat fill, so it reads as having volume under a top-left light
 *     source instead of "flat color icon with a border". Plain `fillRect`
 *     is reserved for genuinely thin/flat details (eyes, rivets, straps,
 *     grip patches) where a bevel would just be noise.
 * Each character's gimmick (pauldrons, scarf, hood point, flame crown, hat +
 * satchel, cape) is layered ON TOP of that skeleton, never replacing it.
 *
 * Shared per-character palette-key convention (same letter = same "slot" in
 * every character's own `palette` Record, even though the actual hex color
 * differs per character - keeps the coordinate code below readable):
 *   h/i/j = head or helm base/highlight/shadow      e/g = eye pupil/gleam
 *   b/c/d = torso base/highlight/shadow             a/f/k = chest accent
 *   m/l/q = arm base/highlight/shadow               n = hand/glove (flat)
 *   p/r/u = leg base/highlight/shadow               o = boot/foot (flat)
 *   w/x/y = weapon head base/highlight/shadow        v = weapon grip (flat)
 *   s/t/z = signature accessory base/highlight/shadow
 *   digits '1'..'4' = small flat one-off details (rivets, gems, straps)
 *
 * hit/cast poses mirror the structure of SpriteLibrary.ts's default
 * playerHitGrid/playerCastGrid (lean-away recoil; 3-stage windup/peak/
 * release flourish) but built from each character's OWN proportions,
 * palette, and signature accessory, so getting hit or attacking never swaps
 * who's on screen. death reuses one shared collapse-stage generator
 * (genericDeathGrid) parametrized per character, since that pose is brief
 * (covered by the game-over overlay within a few frames).
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

/** Stamps a pair of small, alive-looking eyes: a 1-wide x 2-tall pupil
 * column ('e') topped by a single bright gleam pixel ('g'), at columns
 * `lx`/`rx` starting at row `y`. Used by every character so faces read as
 * more than a blank visor slit even at 64px. */
function stampEyes(g: string[][], lx: number, rx: number, y: number): void {
  fillRect(g, lx, y, lx, y + 1, 'e');
  fillRect(g, rx, y, rx, y + 1, 'e');
  fillRect(g, lx, y, lx, y, 'g');
  fillRect(g, rx, y, rx, y, 'g');
}

/**
 * Shared collapse-stage generator for the brief death pose: head drops,
 * torso squashes, arms splay outward, and everything settles into a flat
 * heap on the last stage. Takes each character's own grid size and head/
 * torso column anchors (pulled straight from their idle grid) so the
 * silhouette width still matches that character instead of a generic body.
 * Uses `fillRectShaded` on the head/torso so even the death heap keeps some
 * volume instead of going flat right when the character falls.
 */
function genericDeathGrid(w: number, h: number, headX0: number, headX1: number, torsoX0: number, torsoX1: number, stage: number): string[][] {
  const g = makeGrid(w, h);
  const drop = stage * 2;
  const headY = Math.min(h - 8, 2 + drop);
  fillRectShaded(g, headX0, headY, headX1, headY + 3, 'h', 'i', 'j');
  stampEyes(g, headX0 + 1, headX1 - 1, headY + 1);
  const torsoTop = headY + 4;
  const torsoBottom = Math.min(h - 3, torsoTop + (9 - stage));
  fillRectShaded(g, torsoX0, torsoTop, torsoX1, torsoBottom, 'b', 'c', 'd');
  fillRect(g, torsoX0 + 1, torsoTop + 1, torsoX1 - 1, torsoTop + 3, 'a');
  fillRectShaded(
    g,
    Math.max(0, torsoX0 - 3 - stage),
    torsoTop,
    Math.max(0, torsoX0 - 1 - stage),
    torsoTop + 3,
    'm',
    'l',
    'q',
  );
  fillRectShaded(
    g,
    Math.min(w - 3, torsoX1 + 1 + stage),
    torsoTop,
    Math.min(w - 1, torsoX1 + 3 + stage),
    torsoTop + 3,
    'm',
    'l',
    'q',
  );
  const legY = Math.min(h - 3, torsoBottom + 1);
  fillRectShaded(g, torsoX0, legY, torsoX1, Math.min(h - 1, legY + 2), 'p', 'r', 'u');
  return g;
}

// ============================================================================
// Brakka Thornguard - The Rampart: heavy armored bruiser. Layered plate
// armor with a closed greathelm (two separate glowing eye-slits either side
// of a raised nose-ridge crest, never one blank visor bar), oversized riveted
// pauldrons, a dark-red tabard over the chestplate, and a two-handed warhammer
// with a distinct, detailed head. Grid: 26x30.
// ============================================================================
const TG = {
  headX0: 9, headX1: 16, headY0: 2, headY1: 8,
  torsoX0: 9, torsoX1: 16, torsoY0: 10, torsoY1: 19,
  tabardX0: 11, tabardX1: 14,
  hipY: 20, legY1: 26, bootY1: 29,
};

/**
 * Brakka's HEAVY WHIP prop: a short reinforced haft with a thick coiled
 * cord/chain looped off it.
 *
 * He previously carried a two-handed WARHAMMER while his starting weapon is
 * Whip Strike - the single clearest character/weapon contradiction on the
 * roster. This keeps his silhouette heavy and armoured (it is a brutal
 * siege-whip, not a tamer's cord): the haft is chunky and metal-banded, and
 * the coil is drawn thick with a visible loop so it still reads as mass in
 * his hand rather than turning him into an agile duellist.
 *
 * Palette slots w/x/y are the cord, v the leather haft, '2' the metal bands -
 * the same slots the hammer used, so no palette entry is orphaned.
 */
function paintHeavyWhip(g: string[][], gripX: number, gripY: number, coiled: boolean): void {
  // Reinforced haft, banded in metal.
  fillRectShaded(g, gripX, gripY, gripX + 2, gripY + 6, 'v', 'x', 'y');
  fillRect(g, gripX, gripY + 1, gripX + 2, gripY + 1, '2');
  fillRect(g, gripX, gripY + 5, gripX + 2, gripY + 5, '2');
  fillRect(g, gripX - 1, gripY + 6, gripX + 3, gripY + 7, '2'); // pommel ring

  if (coiled) {
    // Thick cord looped and hanging - reads as stored weight at rest.
    fillRectShaded(g, gripX - 1, gripY + 8, gripX + 3, gripY + 9, 'w', 'x', 'y');
    fillRectShaded(g, gripX - 3, gripY + 9, gripX - 1, gripY + 13, 'w', 'x', 'y');
    fillRectShaded(g, gripX + 3, gripY + 9, gripX + 5, gripY + 12, 'w', 'x', 'y');
    fillRectShaded(g, gripX - 2, gripY + 13, gripX + 4, gripY + 14, 'w', 'x', 'y');
    fillRect(g, gripX, gripY + 11, gripX + 2, gripY + 12, 'y'); // hollow of the loop
  } else {
    // Cord paid out, trailing behind the haft.
    fillRectShaded(g, gripX + 3, gripY + 2, gripX + 7, gripY + 3, 'w', 'x', 'y');
    fillRectShaded(g, gripX + 7, gripY + 3, gripX + 11, gripY + 5, 'w', 'x', 'y');
    fillRect(g, gripX + 11, gripY + 5, gripX + 13, gripY + 5, 'x');
  }
}

function thornguardGrid(legOffset: number, armUp: boolean): string[][] {
  const g = makeGrid(26, 30);
  const lo = Math.round(legOffset / 2);
  // crest above the helm
  fillRectShaded(g, 11, 0, 14, 1, 's', 't', 'z');
  // closed greathelm with nose-ridge crest and two separate eye-slits
  fillRectShaded(g, TG.headX0, TG.headY0, TG.headX1, TG.headY1, 'h', 'i', 'j');
  fillRect(g, 12, TG.headY0 + 1, 13, TG.headY1 - 1, 'j');
  stampEyes(g, 11, 14, 6);
  fillRect(g, 9, 9, 16, 9, 'j'); // gorget
  // pauldrons with a rivet each
  fillRectShaded(g, 1, 9, 7, 14, 'h', 'i', 'j');
  fillRectShaded(g, 18, 9, 24, 14, 'h', 'i', 'j');
  fillRect(g, 3, 11, 3, 11, 'n');
  fillRect(g, 21, 11, 21, 11, 'n');
  // chestplate + tabard accent
  fillRectShaded(g, TG.torsoX0, TG.torsoY0, TG.torsoX1, TG.torsoY1, 'b', 'c', 'd');
  fillRectShaded(g, TG.tabardX0, TG.torsoY0 + 1, TG.tabardX1, TG.torsoY1 - 2, 'a', 'f', 'k');
  fillRect(g, 12, TG.torsoY0 + 2, 13, TG.torsoY0 + 2, '1');
  // arms
  const armTop = 11;
  const leftArmBottom = 20;
  const rightArmBottom = armUp ? 16 : 20;
  fillRectShaded(g, 4, armTop, 8, leftArmBottom, 'm', 'l', 'q');
  fillRectShaded(g, 17, armTop, 21, rightArmBottom, 'm', 'l', 'q');
  // HEAVY WHIP in the right hand (his real starting weapon), with a visible
  // grip patch where it meets the gauntlet.
  fillRect(g, 17, rightArmBottom - 2, 21, rightArmBottom - 1, 'n');
  if (armUp) {
    // Haft lifted, coil swinging clear of the body.
    paintHeavyWhip(g, 19, rightArmBottom - 8, true);
  } else {
    // At rest: coil hanging beside the hip.
    paintHeavyWhip(g, 20, rightArmBottom - 6, true);
  }
  // belt + legs + boots
  fillRect(g, 9, 19, 16, 19, 'j');
  fillRectShaded(g, 9, TG.hipY, 11, TG.legY1 + lo, 'p', 'r', 'u');
  fillRectShaded(g, 14, TG.hipY, 16, TG.legY1 - lo, 'p', 'r', 'u');
  fillRect(g, 8, TG.legY1 + lo, 12, TG.bootY1 + lo, 'o');
  fillRect(g, 13, TG.legY1 - lo, 17, TG.bootY1 - lo, 'o');
  return g;
}

function thornguardHitGrid(settled: boolean): string[][] {
  const g = makeGrid(26, 30);
  const lean = settled ? 0 : 2;
  fillRectShaded(g, TG.headX0 + lean, TG.headY0, TG.headX1 + lean, TG.headY1, 'h', 'i', 'j');
  fillRect(g, 12 + lean, TG.headY0 + 1, 13 + lean, TG.headY1 - 1, 'j');
  stampEyes(g, 11 + lean, 14 + lean, 6);
  fillRect(g, 9 + lean, 9, 16 + lean, 9, 'j');
  fillRectShaded(g, 1, 9, 7, 14, 'h', 'i', 'j');
  fillRectShaded(g, 18, 9, 24, 14, 'h', 'i', 'j');
  fillRectShaded(g, TG.torsoX0 + lean, TG.torsoY0, TG.torsoX1 + lean, TG.torsoY1, 'b', 'c', 'd');
  fillRectShaded(g, TG.tabardX0 + lean, TG.torsoY0 + 1, TG.tabardX1 + lean, TG.torsoY1 - 2, 'a', 'f', 'k');
  const armY1 = settled ? 15 : 12;
  fillRectShaded(g, 1, 8, 5, armY1, 'm', 'l', 'q');
  fillRectShaded(g, 20, 8, 24, armY1, 'm', 'l', 'q');
  fillRectShaded(g, 9, TG.hipY, 11, 26, 'p', 'r', 'u');
  fillRectShaded(g, 14, TG.hipY, 16, 26, 'p', 'r', 'u');
  fillRect(g, 8, 26, 12, 29, 'o');
  fillRect(g, 13, 26, 17, 29, 'o');
  return g;
}

function thornguardCastGrid(stage: number): string[][] {
  const g = makeGrid(26, 30);
  const lean = stage === 2 ? 2 : 0;
  fillRectShaded(g, 11 + lean, 0, 14 + lean, 1, 's', 't', 'z');
  fillRectShaded(g, TG.headX0 + lean, TG.headY0, TG.headX1 + lean, TG.headY1, 'h', 'i', 'j');
  fillRect(g, 12 + lean, TG.headY0 + 1, 13 + lean, TG.headY1 - 1, 'j');
  stampEyes(g, 11 + lean, 14 + lean, 6);
  fillRect(g, 9 + lean, 9, 16 + lean, 9, 'j');
  fillRectShaded(g, 1, 9, 7, 14, 'h', 'i', 'j');
  fillRectShaded(g, 18, 9, 24, 14, 'h', 'i', 'j');
  fillRectShaded(g, TG.torsoX0 + lean, TG.torsoY0, TG.torsoX1 + lean, TG.torsoY1, 'b', 'c', 'd');
  fillRectShaded(g, TG.tabardX0 + lean, TG.torsoY0 + 1, TG.tabardX1 + lean, TG.torsoY1 - 2, 'a', 'f', 'k');
  fillRectShaded(g, 3, 11, 7, 20, 'm', 'l', 'q');
  if (stage === 0) {
    // windup: haft drawn back low, coil still loaded
    fillRectShaded(g, 18, 15, 22, 22, 'm', 'l', 'q');
    fillRect(g, 18, 20, 22, 21, 'n');
    paintHeavyWhip(g, 20, 17, true);
  } else if (stage === 1) {
    // peak: arm up, cord starting to pay out overhead
    fillRectShaded(g, 17, 2, 21, 12, 'm', 'l', 'q');
    fillRect(g, 17, 8, 21, 9, 'n');
    paintHeavyWhip(g, 18, 3, false);
  } else {
    // release: arm thrust forward, cord cracking out to the side
    fillRectShaded(g, 18, 14, 24, 19, 'm', 'l', 'q');
    fillRect(g, 18, 16, 22, 17, 'n');
    paintHeavyWhip(g, 21, 14, false);
  }
  fillRect(g, 9, 19, 16, 19, 'j');
  fillRectShaded(g, 9, TG.hipY, 11, 26, 'p', 'r', 'u');
  fillRectShaded(g, 14, TG.hipY, 16, 26, 'p', 'r', 'u');
  fillRect(g, 8, 26, 12, 29, 'o');
  fillRect(g, 13, 26, 17, 29, 'o');
  return g;
}

// ============================================================================
// Vex Redline - The Redline Runner: slim, forward-leaning speedster. Narrow
// silhouette, a long scarf streaming off the back opposite the stride
// direction, a slim antifaz/goggle band across the eyes, a chrome-buckled
// belt with sheathed knives at the hip, and a thrown dagger held ready.
// Grid: 24x32.
// ============================================================================
const RL = {
  headX0: 9, headX1: 14, headY0: 2, headY1: 7,
  torsoX0: 8, torsoX1: 15, torsoY0: 8, torsoY1: 15,
  hipY: 16, legY1: 24, bootY1: 28,
};

function redlineGrid(legOffset: number, armUp: boolean): string[][] {
  const g = makeGrid(24, 32);
  const flutter = legOffset > 0 ? 2 : legOffset < 0 ? -2 : 0;
  const away = Math.abs(flutter);
  // scarf streaming out behind on the LEFT (opposite the dagger arm, so the
  // weapon prop never paints over it), drawn first so the body silhouette
  // overlaps its base
  fillRectShaded(g, 5, 2, 8, 4, 's', 't', 'z');
  fillRectShaded(g, 1 - away, 4 + away, 5 - away, 6 + away, 's', 't', 'z');
  fillRectShaded(g, -3 - away, 7 + away, 1 - away, 9 + away, 's', 't', 'z');
  // head with goggle band across the eyes
  fillRectShaded(g, RL.headX0, RL.headY0, RL.headX1, RL.headY1, 'h', 'i', 'j');
  fillRect(g, RL.headX0, 4, RL.headX1, 5, '1');
  stampEyes(g, 10, 13, 4);
  // slim torso, jacket accent stripe
  fillRectShaded(g, RL.torsoX0, RL.torsoY0, RL.torsoX1, RL.torsoY1, 'b', 'c', 'd');
  fillRect(g, 10, RL.torsoY0 + 1, 13, RL.torsoY0 + 1, 'a');
  // chrome belt with sheathed knives
  fillRect(g, RL.torsoX0, 14, RL.torsoX1, 14, '2');
  fillRect(g, 6, 15, 7, 17, 'w');
  fillRect(g, 16, 15, 17, 17, 'w');
  // arms - left trails back, right holds the thrown dagger
  fillRectShaded(g, 4, 8, 7, armUp ? 12 : 15, 'm', 'l', 'q');
  fillRectShaded(g, 16, 8, 19, 15, 'm', 'l', 'q');
  fillRect(g, 17, 7, 19, 8, 'n');
  // slim thrown dagger: narrow blade + small crossguard, not a chunky block
  fillRect(g, 17, 6, 21, 6, 'y');
  fillRectShaded(g, 19, 3, 20, 6, 'w', 'x', 'y');
  fillRect(g, 19, 1, 20, 2, 'x');
  // legs, mid-stride lean
  fillRectShaded(g, 9, 16, 11, 24 + legOffset, 'p', 'r', 'u');
  fillRectShaded(g, 13, 16, 15, 24 - legOffset, 'p', 'r', 'u');
  fillRect(g, 8, 24 + legOffset, 12, 27 + legOffset, 'o');
  fillRect(g, 12, 24 - legOffset, 16, 27 - legOffset, 'o');
  return g;
}

function redlineHitGrid(settled: boolean): string[][] {
  const g = makeGrid(24, 32);
  const lean = settled ? 0 : 2;
  fillRectShaded(g, 6, 3, 9, 5, 's', 't', 'z');
  fillRectShaded(g, RL.headX0 + lean, RL.headY0, RL.headX1 + lean, RL.headY1, 'h', 'i', 'j');
  fillRect(g, RL.headX0 + lean, 4, RL.headX1 + lean, 5, '1');
  stampEyes(g, 10 + lean, 13 + lean, 4);
  fillRectShaded(g, RL.torsoX0 + lean, RL.torsoY0, RL.torsoX1 + lean, RL.torsoY1, 'b', 'c', 'd');
  fillRect(g, 10 + lean, RL.torsoY0 + 1, 13 + lean, RL.torsoY0 + 1, 'a');
  fillRect(g, RL.torsoX0 + lean, 14, RL.torsoX1 + lean, 14, '2');
  const armY1 = settled ? 13 : 10;
  fillRectShaded(g, 1, 7, 4, armY1, 'm', 'l', 'q');
  fillRectShaded(g, 19, 7, 22, armY1, 'm', 'l', 'q');
  fillRectShaded(g, 9, 16, 11, 23, 'p', 'r', 'u');
  fillRectShaded(g, 13, 16, 15, 23, 'p', 'r', 'u');
  fillRect(g, 8, 23, 12, 26, 'o');
  fillRect(g, 12, 23, 16, 26, 'o');
  return g;
}

function redlineCastGrid(stage: number): string[][] {
  const g = makeGrid(24, 32);
  const lean = stage === 2 ? 2 : 0;
  fillRectShaded(g, 6, 3, 9, 5, 's', 't', 'z');
  fillRectShaded(g, RL.headX0 + lean, RL.headY0, RL.headX1 + lean, RL.headY1, 'h', 'i', 'j');
  fillRect(g, RL.headX0 + lean, 4, RL.headX1 + lean, 5, '1');
  stampEyes(g, 10 + lean, 13 + lean, 4);
  fillRectShaded(g, RL.torsoX0 + lean, RL.torsoY0, RL.torsoX1 + lean, RL.torsoY1, 'b', 'c', 'd');
  fillRect(g, 10 + lean, RL.torsoY0 + 1, 13 + lean, RL.torsoY0 + 1, 'a');
  fillRect(g, RL.torsoX0 + lean, 14, RL.torsoX1 + lean, 14, '2');
  fillRectShaded(g, 4, 8, 7, 14, 'm', 'l', 'q');
  if (stage === 0) {
    // windup: dagger drawn back low-right
    fillRectShaded(g, 16, 10, 19, 15, 'm', 'l', 'q');
    fillRect(g, 17, 13, 19, 14, 'n');
    fillRect(g, 18, 17, 21, 17, 'y');
    fillRectShaded(g, 19, 18, 20, 21, 'w', 'x', 'y');
    fillRect(g, 19, 22, 20, 23, 'x');
  } else if (stage === 1) {
    // peak: dagger raised high, ready to throw
    fillRectShaded(g, 16, 1, 19, 9, 'm', 'l', 'q');
    fillRect(g, 17, 7, 19, 8, 'n');
    fillRect(g, 17, 5, 20, 5, 'y');
    fillRectShaded(g, 18, 1, 19, 4, 'w', 'x', 'y');
    fillRect(g, 18, -1, 19, 0, 'x');
  } else {
    // release: dagger thrown forward, arm extended
    fillRectShaded(g, 18, 6, 22, 10, 'm', 'l', 'q');
    fillRect(g, 19, 8, 21, 9, 'n');
    fillRect(g, 21, 7, 21, 10, 'y');
    fillRectShaded(g, 22, 6, 25, 7, 'w', 'x', 'y');
    fillRect(g, 25, 5, 26, 6, 'x');
  }
  fillRectShaded(g, 9, 16, 11, 23, 'p', 'r', 'u');
  fillRectShaded(g, 13, 16, 15, 23, 'p', 'r', 'u');
  fillRect(g, 8, 23, 12, 26, 'o');
  fillRect(g, 12, 23, 16, 26, 'o');
  return g;
}

// ============================================================================
// Orin Warden - The Circling Warden: mystic guardian. Tall high-collared
// hooded robe, two eyes visible beneath the shadowed hood, a chest amulet
// gem that glows cyan (mirrors the orbiter blades), wide bell sleeves, and
// no held weapon in hand - palms open with a small cyan glow instead, since
// the blades orbit on their own. Grid: 26x34.
// ============================================================================
const WD = {
  headX0: 9, headX1: 16, headY0: 2, headY1: 8,
  torsoX0: 7, torsoX1: 18, torsoY0: 9, torsoY1: 20,
  robeY1: 24, hipY: 25, legY1: 30, bootY1: 33,
};

function wardenGrid(legOffset: number, armUp: boolean): string[][] {
  const g = makeGrid(26, 34);
  const sway = Math.round(legOffset / 2);
  // pointed hood, high collar shadowing the face
  fillRectShaded(g, 11, 0, 14, 1, 'h', 'i', 'j');
  fillRectShaded(g, 9, 1, 16, 3, 'h', 'i', 'j');
  fillRectShaded(g, WD.headX0, WD.headY0 + 2, WD.headX1, WD.headY1, 'h', 'i', 'j');
  fillRect(g, 9, 6, 16, 8, 'j');
  stampEyes(g, 11, 14, 6);
  // robe torso with amulet gem
  fillRectShaded(g, WD.torsoX0, WD.torsoY0, WD.torsoX1, WD.torsoY1, 'b', 'c', 'd');
  fillRect(g, 11, WD.torsoY0 + 2, 14, WD.torsoY0 + 6, 'a');
  fillRect(g, 12, WD.torsoY0 + 3, 13, WD.torsoY0 + 4, 'g');
  // wide bell sleeves
  fillRectShaded(g, 3, 10, 7, armUp ? 15 : 18, 'm', 'l', 'q');
  fillRectShaded(g, 18, 10, 22, 18, 'm', 'l', 'q');
  // open palms with a small cyan glow (no held weapon - blades orbit free)
  fillRect(g, 4, armUp ? 13 : 17, 6, armUp ? 14 : 18, 'n');
  fillRect(g, 19, 17, 21, 18, 'n');
  fillRect(g, 4, armUp ? 11 : 15, 6, armUp ? 12 : 16, 'g');
  fillRect(g, 19, 15, 21, 16, 'g');
  // long robe skirt hiding the hip, hem split for the legs
  fillRectShaded(g, 5, WD.torsoY1, 20, WD.robeY1, 'b', 'c', 'd');
  fillRect(g, 5, WD.robeY1 - 1, 20, WD.robeY1 - 1, 'a');
  fillRectShaded(g, 8 + sway, WD.hipY, 11 + sway, WD.legY1, 'p', 'r', 'u');
  fillRectShaded(g, 14 + sway, WD.hipY, 17 + sway, WD.legY1 - 2 * sway, 'p', 'r', 'u');
  fillRect(g, 7 + sway, WD.legY1, 12 + sway, WD.bootY1, 'o');
  fillRect(g, 13 + sway, WD.legY1 - 2 * sway, 18 + sway, WD.bootY1 - 2 * sway, 'o');
  // four small orbiter-blade motes drifting around the body
  fillRect(g, 0, 9 + sway, 1, 10 + sway, 's');
  fillRect(g, 24, 9 - sway, 25, 10 - sway, 's');
  fillRect(g, 1, 3 - sway, 2, 4 - sway, 's');
  fillRect(g, 23, 3 + sway, 24, 4 + sway, 's');
  return g;
}

function wardenHitGrid(settled: boolean): string[][] {
  const g = makeGrid(26, 34);
  const lean = settled ? 0 : 2;
  fillRectShaded(g, 11 + lean, 0, 14 + lean, 1, 'h', 'i', 'j');
  fillRectShaded(g, 9 + lean, 1, 16 + lean, 3, 'h', 'i', 'j');
  fillRectShaded(g, WD.headX0 + lean, WD.headY0 + 2, WD.headX1 + lean, WD.headY1, 'h', 'i', 'j');
  fillRect(g, 9 + lean, 6, 16 + lean, 8, 'j');
  stampEyes(g, 11 + lean, 14 + lean, 6);
  fillRectShaded(g, WD.torsoX0 + lean, WD.torsoY0, WD.torsoX1 + lean, WD.torsoY1, 'b', 'c', 'd');
  fillRect(g, 11 + lean, WD.torsoY0 + 2, 14 + lean, WD.torsoY0 + 6, 'a');
  fillRect(g, 12 + lean, WD.torsoY0 + 3, 13 + lean, WD.torsoY0 + 4, 'g');
  const armY1 = settled ? 17 : 14;
  fillRectShaded(g, 0, 9, 4, armY1, 'm', 'l', 'q');
  fillRectShaded(g, 21, 9, 25, armY1, 'm', 'l', 'q');
  fillRectShaded(g, 5, WD.torsoY1, 20, WD.robeY1, 'b', 'c', 'd');
  fillRect(g, 5, WD.robeY1 - 1, 20, WD.robeY1 - 1, 'a');
  fillRectShaded(g, 8, WD.hipY, 11, WD.legY1, 'p', 'r', 'u');
  fillRectShaded(g, 14, WD.hipY, 17, WD.legY1, 'p', 'r', 'u');
  fillRect(g, 7, WD.legY1, 12, WD.bootY1, 'o');
  fillRect(g, 13, WD.legY1, 18, WD.bootY1, 'o');
  return g;
}

function wardenCastGrid(stage: number): string[][] {
  const g = makeGrid(26, 34);
  const lean = stage === 2 ? 2 : 0;
  fillRectShaded(g, 11 + lean, 0, 14 + lean, 1, 'h', 'i', 'j');
  fillRectShaded(g, 9 + lean, 1, 16 + lean, 3, 'h', 'i', 'j');
  fillRectShaded(g, WD.headX0 + lean, WD.headY0 + 2, WD.headX1 + lean, WD.headY1, 'h', 'i', 'j');
  fillRect(g, 9 + lean, 6, 16 + lean, 8, 'j');
  stampEyes(g, 11 + lean, 14 + lean, 6);
  fillRectShaded(g, WD.torsoX0 + lean, WD.torsoY0, WD.torsoX1 + lean, WD.torsoY1, 'b', 'c', 'd');
  fillRect(g, 11 + lean, WD.torsoY0 + 2, 14 + lean, WD.torsoY0 + 6, 'a');
  fillRect(g, 12 + lean, WD.torsoY0 + 3, 13 + lean, WD.torsoY0 + 4, 'g');
  fillRectShaded(g, 4, 10, 8, 17, 'm', 'l', 'q');
  fillRect(g, 5, 15, 7, 16, 'n');
  if (stage === 0) {
    fillRectShaded(g, 17, 12, 21, 19, 'm', 'l', 'q');
    fillRect(g, 18, 16, 20, 17, 'n');
    fillRect(g, 18, 18, 20, 19, 'g');
  } else if (stage === 1) {
    fillRectShaded(g, 17, 3, 21, 11, 'm', 'l', 'q');
    fillRect(g, 18, 8, 20, 9, 'n');
    fillRect(g, 17, 1, 21, 3, 'g');
  } else {
    fillRectShaded(g, 18, 8, 22, 13, 'm', 'l', 'q');
    fillRect(g, 19, 11, 21, 12, 'n');
    fillRect(g, 21, 6, 25, 9, 'g');
  }
  fillRectShaded(g, 5, WD.torsoY1, 20, WD.robeY1, 'b', 'c', 'd');
  fillRect(g, 5, WD.robeY1 - 1, 20, WD.robeY1 - 1, 'a');
  fillRectShaded(g, 8, WD.hipY, 11, WD.legY1, 'p', 'r', 'u');
  fillRectShaded(g, 14, WD.hipY, 17, WD.legY1, 'p', 'r', 'u');
  fillRect(g, 7, WD.legY1, 12, WD.bootY1, 'o');
  fillRect(g, 13, WD.legY1, 18, WD.bootY1, 'o');
  return g;
}

// ============================================================================
// Pyra Cinderborn - The Cinderborn: fire-touched sorceress. A jagged
// three-pronged flame crown, a charred cloak with glowing ember cracks down
// the back, and an ember wand that lifts overhead with a bright tip on the
// "arm up" frames. Grid: 25x32.
// ============================================================================
const CB = {
  headX0: 8, headX1: 15, headY0: 3, headY1: 9,
  torsoX0: 6, torsoX1: 17, torsoY0: 10, torsoY1: 20,
  hipY: 21, legY1: 27, bootY1: 31,
};

/**
 * Three tapered flame tongues (gold-hot tips over a red-orange body, darker
 * base band) instead of three flat rectangular corner blocks - reads as
 * "fire" rather than "blocky crown" at both HUD-portrait and gameplay scale.
 * `lean` shifts the whole crown horizontally to match the head's own lean
 * on the hit/cast poses.
 */
function paintFlameCrown(g: string[][], lean: number): void {
  fillRect(g, 10 + lean, 0, 11 + lean, 0, 't');
  fillRect(g, 9 + lean, 1, 12 + lean, 1, 's');
  fillRect(g, 6 + lean, 1, 7 + lean, 1, 't');
  fillRect(g, 15 + lean, 1, 16 + lean, 1, 't');
  fillRect(g, 6 + lean, 2, 8 + lean, 2, 's');
  fillRect(g, 14 + lean, 2, 16 + lean, 2, 's');
  fillRect(g, 9 + lean, 2, 12 + lean, 2, 'z');
  fillRectShaded(g, 6 + lean, 3, 16 + lean, 4, 'z', 's', 'q');
}

function cinderbornGrid(legOffset: number, armUp: boolean): string[][] {
  const g = makeGrid(25, 32);
  paintFlameCrown(g, 0);
  // charred cloak flanking the torso, glowing crack down the back
  fillRectShaded(g, 3, 8, 6, 21, 'm', 'l', 'q');
  fillRectShaded(g, 17, 8, 20, 21, 'm', 'l', 'q');
  fillRect(g, 4, 11, 4, 18, '1');
  fillRect(g, 19, 11, 19, 18, '1');
  fillRectShaded(g, CB.headX0, CB.headY0, CB.headX1, CB.headY1, 'h', 'i', 'j');
  stampEyes(g, 10, 13, 6);
  fillRectShaded(g, CB.torsoX0, CB.torsoY0, CB.torsoX1, CB.torsoY1, 'b', 'c', 'd');
  fillRect(g, 9, CB.torsoY0 + 1, 14, CB.torsoY0 + 5, 'a');
  fillRect(g, 10, CB.torsoY0 + 6, 13, CB.torsoY0 + 6, '1');
  // arms - left steady, right raises the ember wand
  fillRectShaded(g, 4, 11, 7, 20, 'm', 'l', 'q');
  fillRectShaded(g, 16, 11, 19, armUp ? 15 : 20, 'm', 'l', 'q');
  if (armUp) {
    fillRect(g, 17, 12, 18, 13, 'n');
    fillRect(g, 17, 3, 18, 12, 'v');
    fillRectShaded(g, 15, 0, 20, 3, 'w', 'x', 'y');
    fillRect(g, 20, 0, 21, 1, 'g');
  } else {
    fillRect(g, 17, 17, 18, 18, 'n');
    fillRect(g, 18, 17, 19, 20, 'v');
    fillRectShaded(g, 17, 20, 22, 23, 'w', 'x', 'y');
    fillRect(g, 22, 20, 23, 21, 'g');
  }
  fillRectShaded(g, 9, CB.hipY, 11, CB.legY1 + legOffset, 'p', 'r', 'u');
  fillRectShaded(g, 13, CB.hipY, 15, CB.legY1 - legOffset, 'p', 'r', 'u');
  fillRect(g, 8, CB.legY1 + legOffset, 12, CB.bootY1 + legOffset, 'o');
  fillRect(g, 12, CB.legY1 - legOffset, 16, CB.bootY1 - legOffset, 'o');
  return g;
}

function cinderbornHitGrid(settled: boolean): string[][] {
  const g = makeGrid(25, 32);
  const lean = settled ? 0 : 2;
  paintFlameCrown(g, lean);
  fillRectShaded(g, 3, 8, 6, 20, 'm', 'l', 'q');
  fillRectShaded(g, 17, 8, 20, 20, 'm', 'l', 'q');
  fillRectShaded(g, CB.headX0 + lean, CB.headY0, CB.headX1 + lean, CB.headY1, 'h', 'i', 'j');
  stampEyes(g, 10 + lean, 13 + lean, 6);
  fillRectShaded(g, CB.torsoX0 + lean, CB.torsoY0, CB.torsoX1 + lean, CB.torsoY1, 'b', 'c', 'd');
  fillRect(g, 9 + lean, CB.torsoY0 + 1, 14 + lean, CB.torsoY0 + 5, 'a');
  const armY1 = settled ? 17 : 14;
  fillRectShaded(g, 0, 10, 3, armY1, 'm', 'l', 'q');
  fillRectShaded(g, 20, 10, 23, armY1, 'm', 'l', 'q');
  fillRectShaded(g, 9, CB.hipY, 11, CB.legY1, 'p', 'r', 'u');
  fillRectShaded(g, 13, CB.hipY, 15, CB.legY1, 'p', 'r', 'u');
  fillRect(g, 8, CB.legY1, 12, CB.bootY1, 'o');
  fillRect(g, 12, CB.legY1, 16, CB.bootY1, 'o');
  return g;
}

function cinderbornCastGrid(stage: number): string[][] {
  const g = makeGrid(25, 32);
  const lean = stage === 2 ? 2 : 0;
  paintFlameCrown(g, lean);
  fillRectShaded(g, 3, 8, 6, 20, 'm', 'l', 'q');
  fillRectShaded(g, 17, 8, 20, 20, 'm', 'l', 'q');
  fillRectShaded(g, CB.headX0 + lean, CB.headY0, CB.headX1 + lean, CB.headY1, 'h', 'i', 'j');
  stampEyes(g, 10 + lean, 13 + lean, 6);
  fillRectShaded(g, CB.torsoX0 + lean, CB.torsoY0, CB.torsoX1 + lean, CB.torsoY1, 'b', 'c', 'd');
  fillRect(g, 9 + lean, CB.torsoY0 + 1, 14 + lean, CB.torsoY0 + 5, 'a');
  fillRectShaded(g, 4, 11, 7, 19, 'm', 'l', 'q');
  if (stage === 0) {
    fillRectShaded(g, 16, 13, 19, 20, 'm', 'l', 'q');
    fillRect(g, 17, 17, 18, 18, 'n');
    fillRect(g, 18, 18, 19, 21, 'v');
    fillRectShaded(g, 17, 21, 22, 24, 'w', 'x', 'y');
  } else if (stage === 1) {
    fillRectShaded(g, 16, 2, 19, 13, 'm', 'l', 'q');
    fillRect(g, 17, 9, 18, 10, 'n');
    fillRect(g, 17, 2, 18, 9, 'v');
    fillRectShaded(g, 15, -1, 20, 2, 'w', 'x', 'y');
    fillRect(g, 20, -1, 21, 0, 'g');
  } else {
    fillRectShaded(g, 17, 8, 21, 14, 'm', 'l', 'q');
    fillRect(g, 18, 11, 19, 12, 'n');
    fillRect(g, 19, 6, 20, 11, 'v');
    fillRectShaded(g, 20, 2, 25, 6, 'w', 'x', 'y');
    fillRect(g, 25, 2, 26, 3, 'g');
  }
  fillRectShaded(g, 9, CB.hipY, 11, CB.legY1, 'p', 'r', 'u');
  fillRectShaded(g, 13, CB.hipY, 15, CB.legY1, 'p', 'r', 'u');
  fillRect(g, 8, CB.legY1, 12, CB.bootY1, 'o');
  fillRect(g, 12, CB.legY1, 16, CB.bootY1, 'o');
  return g;
}

// ============================================================================
// Lucca Fortune - Fortune's Hand: lucky scavenger. A wide-brim hat shadowing
// the face, a fitted vest with a small four-leaf clover pin, a coin-satchel
// slung on a hip strap, and a wand tipped with a glowing lucky gem. Grid:
// 26x30.
// ============================================================================
const FT = {
  headX0: 9, headX1: 14, headY0: 3, headY1: 8,
  torsoX0: 8, torsoX1: 15, torsoY0: 9, torsoY1: 17,
  hipY: 18, legY1: 24, bootY1: 27,
};

function fortuneGrid(legOffset: number, armUp: boolean): string[][] {
  const g = makeGrid(26, 30);
  // wide-brim hat casting shadow over the eyes
  fillRectShaded(g, 9, 0, 14, 1, 's', 't', 'z');
  fillRectShaded(g, 4, 2, 19, 3, 's', 't', 'z');
  fillRect(g, 5, 4, 18, 4, 'z');
  fillRectShaded(g, FT.headX0, FT.headY0 + 2, FT.headX1, FT.headY1, 'h', 'i', 'j');
  stampEyes(g, 10, 13, 6);
  // fitted vest with clover pin
  fillRectShaded(g, FT.torsoX0, FT.torsoY0, FT.torsoX1, FT.torsoY1, 'b', 'c', 'd');
  fillRect(g, 9, FT.torsoY0 + 1, 14, FT.torsoY0 + 1, 'a');
  fillRect(g, 10, FT.torsoY0 + 3, 11, FT.torsoY0 + 4, '1');
  // coin satchel on a hip strap
  fillRect(g, 15, 10, 20, 11, '2');
  fillRectShaded(g, 17, 13, 22, 17, 'w', 'x', 'y');
  fillRect(g, 19, 14, 20, 15, '1');
  // arms - left steady, right holds the wand
  fillRectShaded(g, 3, 9, 6, armUp ? 13 : 16, 'm', 'l', 'q');
  fillRectShaded(g, 16, 9, 19, 15, 'm', 'l', 'q');
  fillRect(g, 17, 9, 18, 10, 'n');
  fillRectShaded(g, 18, 4, 19, 9, 'w', 'x', 'y');
  fillRect(g, 17, 3, 20, 4, 'g');
  fillRectShaded(g, 9, FT.hipY, 11, FT.legY1 + legOffset, 'p', 'r', 'u');
  fillRectShaded(g, 13, FT.hipY, 15, FT.legY1 - legOffset, 'p', 'r', 'u');
  fillRect(g, 8, FT.legY1 + legOffset, 12, FT.bootY1 + legOffset, 'o');
  fillRect(g, 12, FT.legY1 - legOffset, 16, FT.bootY1 - legOffset, 'o');
  return g;
}

function fortuneHitGrid(settled: boolean): string[][] {
  const g = makeGrid(26, 30);
  const lean = settled ? 0 : 2;
  fillRectShaded(g, 9 + lean, 0, 14 + lean, 1, 's', 't', 'z');
  fillRectShaded(g, 4 + lean, 2, 19 + lean, 3, 's', 't', 'z');
  fillRect(g, 5 + lean, 4, 18 + lean, 4, 'z');
  fillRectShaded(g, FT.headX0 + lean, FT.headY0 + 2, FT.headX1 + lean, FT.headY1, 'h', 'i', 'j');
  stampEyes(g, 10 + lean, 13 + lean, 6);
  fillRectShaded(g, FT.torsoX0 + lean, FT.torsoY0, FT.torsoX1 + lean, FT.torsoY1, 'b', 'c', 'd');
  fillRect(g, 9 + lean, FT.torsoY0 + 1, 14 + lean, FT.torsoY0 + 1, 'a');
  fillRectShaded(g, 17, 13, 22, 17, 'w', 'x', 'y');
  const armY1 = settled ? 12 : 9;
  fillRectShaded(g, 0, 7, 3, armY1, 'm', 'l', 'q');
  fillRectShaded(g, 19, 7, 22, armY1, 'm', 'l', 'q');
  fillRectShaded(g, 9, FT.hipY, 11, FT.legY1, 'p', 'r', 'u');
  fillRectShaded(g, 13, FT.hipY, 15, FT.legY1, 'p', 'r', 'u');
  fillRect(g, 8, FT.legY1, 12, FT.bootY1, 'o');
  fillRect(g, 12, FT.legY1, 16, FT.bootY1, 'o');
  return g;
}

function fortuneCastGrid(stage: number): string[][] {
  const g = makeGrid(26, 30);
  const lean = stage === 2 ? 2 : 0;
  fillRectShaded(g, 9 + lean, 0, 14 + lean, 1, 's', 't', 'z');
  fillRectShaded(g, 4 + lean, 2, 19 + lean, 3, 's', 't', 'z');
  fillRect(g, 5 + lean, 4, 18 + lean, 4, 'z');
  fillRectShaded(g, FT.headX0 + lean, FT.headY0 + 2, FT.headX1 + lean, FT.headY1, 'h', 'i', 'j');
  stampEyes(g, 10 + lean, 13 + lean, 6);
  fillRectShaded(g, FT.torsoX0 + lean, FT.torsoY0, FT.torsoX1 + lean, FT.torsoY1, 'b', 'c', 'd');
  fillRect(g, 9 + lean, FT.torsoY0 + 1, 14 + lean, FT.torsoY0 + 1, 'a');
  fillRectShaded(g, 17, 13, 22, 17, 'w', 'x', 'y');
  fillRectShaded(g, 3, 9, 6, 15, 'm', 'l', 'q');
  if (stage === 0) {
    fillRectShaded(g, 16, 11, 19, 17, 'm', 'l', 'q');
    fillRect(g, 17, 15, 18, 16, 'n');
    fillRectShaded(g, 18, 16, 19, 20, 'w', 'x', 'y');
    fillRect(g, 17, 20, 20, 21, 'g');
  } else if (stage === 1) {
    fillRectShaded(g, 16, 1, 19, 10, 'm', 'l', 'q');
    fillRect(g, 17, 7, 18, 8, 'n');
    fillRectShaded(g, 18, 1, 19, 7, 'w', 'x', 'y');
    fillRect(g, 17, -1, 20, 1, 'g');
  } else {
    fillRectShaded(g, 18, 6, 21, 10, 'm', 'l', 'q');
    fillRect(g, 19, 8, 20, 9, 'n');
    fillRectShaded(g, 21, 5, 22, 9, 'w', 'x', 'y');
    fillRect(g, 20, 3, 23, 4, 'g');
  }
  fillRectShaded(g, 9, FT.hipY, 11, FT.legY1, 'p', 'r', 'u');
  fillRectShaded(g, 13, FT.hipY, 15, FT.legY1, 'p', 'r', 'u');
  fillRect(g, 8, FT.legY1, 12, FT.bootY1, 'o');
  fillRect(g, 12, FT.legY1, 16, FT.bootY1, 'o');
  return g;
}

// ============================================================================
// Dess Steadyhand - The Steady Hand: balanced herbolarian guardian.
// Deliberately the plainest silhouette on the roster (matching a trait with
// no gimmick and no malus) with a calm hooded traveler's cape that flanks the
// torso WITHOUT smothering the leg gap, a small satchel of dried garlic
// bulbs at the hip, and a hand-held lantern amulet with a faint cyan glow.
// Grid: 24x30.
// ============================================================================
const SH = {
  headX0: 9, headX1: 14, headY0: 2, headY1: 7,
  torsoX0: 7, torsoX1: 16, torsoY0: 8, torsoY1: 16,
  hipY: 17, legY1: 23, bootY1: 27,
};

function steadyhandGrid(legOffset: number, armUp: boolean): string[][] {
  const g = makeGrid(24, 30);
  // hooded cape flanking the torso
  fillRectShaded(g, 3, 6, 6, 22, 's', 't', 'z');
  fillRectShaded(g, 17, 6, 20, 22, 's', 't', 'z');
  fillRectShaded(g, 8, 0, 15, 2, 's', 't', 'z');
  fillRectShaded(g, SH.headX0, SH.headY0 + 1, SH.headX1, SH.headY1, 'h', 'i', 'j');
  stampEyes(g, 10, 13, 4);
  fillRectShaded(g, SH.torsoX0, SH.torsoY0, SH.torsoX1, SH.torsoY1, 'b', 'c', 'd');
  fillRect(g, 8, SH.torsoY0 + 1, 15, SH.torsoY0 + 1, 'a');
  fillRect(g, 7, SH.torsoY1 - 3, 16, SH.torsoY1 - 3, '1');
  // garlic-bulb satchel at the hip
  fillRectShaded(g, 15, 14, 19, 18, 's', 't', 'z');
  fillRect(g, 16, 15, 18, 15, 'g');
  // arms - left steady, right holds the lantern amulet
  fillRectShaded(g, 4, 8, 7, armUp ? 12 : 15, 'm', 'l', 'q');
  fillRectShaded(g, 15, 8, 18, 14, 'm', 'l', 'q');
  fillRect(g, 16, 13, 17, 14, 'n');
  fillRectShaded(g, 15, 15, 18, 17, 'w', 'x', 'y');
  fillRect(g, 16, 16, 17, 16, 'g');
  fillRectShaded(g, 8, SH.hipY, 10, SH.legY1 + legOffset, 'p', 'r', 'u');
  fillRectShaded(g, 13, SH.hipY, 15, SH.legY1 - legOffset, 'p', 'r', 'u');
  fillRect(g, 7, SH.legY1 + legOffset, 11, SH.bootY1 + legOffset, 'o');
  fillRect(g, 12, SH.legY1 - legOffset, 16, SH.bootY1 - legOffset, 'o');
  return g;
}

function steadyhandHitGrid(settled: boolean): string[][] {
  const g = makeGrid(24, 30);
  const lean = settled ? 0 : 2;
  fillRectShaded(g, 3, 6, 6, 21, 's', 't', 'z');
  fillRectShaded(g, 17, 6, 20, 21, 's', 't', 'z');
  fillRectShaded(g, SH.headX0 + lean, SH.headY0 + 1, SH.headX1 + lean, SH.headY1, 'h', 'i', 'j');
  stampEyes(g, 10 + lean, 13 + lean, 4);
  fillRectShaded(g, SH.torsoX0 + lean, SH.torsoY0, SH.torsoX1 + lean, SH.torsoY1, 'b', 'c', 'd');
  fillRect(g, 8 + lean, SH.torsoY0 + 1, 15 + lean, SH.torsoY0 + 1, 'a');
  const armY1 = settled ? 12 : 9;
  fillRectShaded(g, 1, 6, 4, armY1, 'm', 'l', 'q');
  fillRectShaded(g, 19, 6, 22, armY1, 'm', 'l', 'q');
  fillRectShaded(g, 8, SH.hipY, 10, SH.legY1, 'p', 'r', 'u');
  fillRectShaded(g, 13, SH.hipY, 15, SH.legY1, 'p', 'r', 'u');
  fillRect(g, 7, SH.legY1, 11, SH.bootY1, 'o');
  fillRect(g, 12, SH.legY1, 16, SH.bootY1, 'o');
  return g;
}

function steadyhandCastGrid(stage: number): string[][] {
  const g = makeGrid(24, 30);
  const lean = stage === 2 ? 2 : 0;
  fillRectShaded(g, 3, 6, 6, 21, 's', 't', 'z');
  fillRectShaded(g, 17, 6, 20, 21, 's', 't', 'z');
  fillRectShaded(g, SH.headX0 + lean, SH.headY0 + 1, SH.headX1 + lean, SH.headY1, 'h', 'i', 'j');
  stampEyes(g, 10 + lean, 13 + lean, 4);
  fillRectShaded(g, SH.torsoX0 + lean, SH.torsoY0, SH.torsoX1 + lean, SH.torsoY1, 'b', 'c', 'd');
  fillRect(g, 8 + lean, SH.torsoY0 + 1, 15 + lean, SH.torsoY0 + 1, 'a');
  fillRectShaded(g, 4, 8, 7, 14, 'm', 'l', 'q');
  if (stage === 0) {
    fillRectShaded(g, 15, 10, 18, 16, 'm', 'l', 'q');
    fillRect(g, 16, 14, 17, 15, 'n');
    fillRectShaded(g, 14, 16, 17, 18, 'w', 'x', 'y');
    fillRect(g, 15, 17, 16, 17, 'g');
  } else if (stage === 1) {
    fillRectShaded(g, 15, 1, 18, 9, 'm', 'l', 'q');
    fillRect(g, 16, 7, 17, 8, 'n');
    fillRectShaded(g, 14, -1, 17, 1, 'w', 'x', 'y');
    fillRect(g, 15, 0, 16, 0, 'g');
  } else {
    fillRectShaded(g, 17, 6, 20, 10, 'm', 'l', 'q');
    fillRect(g, 18, 8, 19, 9, 'n');
    fillRectShaded(g, 20, 4, 23, 6, 'w', 'x', 'y');
    fillRect(g, 21, 5, 22, 5, 'g');
  }
  fillRectShaded(g, 8, SH.hipY, 10, SH.legY1, 'p', 'r', 'u');
  fillRectShaded(g, 13, SH.hipY, 15, SH.legY1, 'p', 'r', 'u');
  fillRect(g, 7, SH.legY1, 11, SH.bootY1, 'o');
  fillRect(g, 12, SH.legY1, 16, SH.bootY1, 'o');
  return g;
}

// One palette + grid/pose builder set per roster character, keyed by
// CharacterDef.spriteKey. Distinct hues AND distinct shapes, so cards/
// portraits and in-game sprites stay recognizable at a glance from each
// other and from the default adventurer sprite. See the palette-key
// convention documented at the top of this file (h/i/j head, b/c/d torso,
// a/f/k chest accent, m/l/q arms, n hand, p/r/u legs, o boots, w/x/y weapon
// head, v weapon grip, s/t/z signature accessory, e/g eyes, digits = small
// flat one-off details).
const CHARACTER_ART: Record<string, CharacterArt> = {
  thornguard: {
    palette: {
      h: '#7d838c', i: '#a8afb8', j: '#4a505a',
      e: '#ff3b3b', g: '#ffd2c8',
      b: '#5b6470', c: '#7c8794', d: '#333a43',
      a: '#8f2e24', f: '#b8493a', k: '#571c15',
      m: '#454c56', l: '#636b76', q: '#262b32',
      n: '#d8b48a',
      p: '#33383f', r: '#4a515a', u: '#191c20',
      o: '#131518',
      // Heavy whip: braided dark cord (w/x/y) on a leather haft (v), banded
      // with the same gold as his other metal fittings ('2').
      w: '#6b5334', x: '#96754a', y: '#332616',
      v: '#4a3a24',
      s: '#7a2018', t: '#a8382a', z: '#3c0f0a',
      '1': '#e6c86a', '2': '#e6c86a',
    },
    outline: '#0c0d10',
    grid: thornguardGrid,
    hitGrid: thornguardHitGrid,
    castGrid: thornguardCastGrid,
    deathGrid: (stage) => genericDeathGrid(26, 30, 9, 16, 9, 16, stage),
  },
  redline: {
    palette: {
      h: '#f2c88f', i: '#ffe0b3', j: '#c99a5f',
      e: '#20241f', g: '#ffffff',
      b: '#d9403a', c: '#ff6a55', d: '#8a1f1a',
      a: '#ffb84d',
      m: '#a82f2a', l: '#cf4a3c', q: '#5c1512',
      n: '#f2c88f',
      p: '#7a1f1f', r: '#9c342f', u: '#3f0e0e',
      o: '#171a17',
      w: '#e8e2d8', x: '#ffffff', y: '#a89a86',
      s: '#ff8a3d', t: '#ffb463', z: '#a8451a',
      '1': '#20241f', '2': '#c9cdd3',
    },
    outline: '#160808',
    grid: redlineGrid,
    hitGrid: redlineHitGrid,
    castGrid: redlineCastGrid,
    deathGrid: (stage) => genericDeathGrid(24, 32, 9, 14, 8, 15, stage),
  },
  warden: {
    palette: {
      h: '#2c6e8f', i: '#4a94b8', j: '#123244',
      e: '#0d1114', g: '#d8fbff',
      b: '#2c6e8f', c: '#4a94b8', d: '#123244',
      a: '#0f2e3d',
      m: '#1f4f68', l: '#37728f', q: '#0c2330',
      n: '#c9e8ff',
      p: '#1d3d4f', r: '#2f5a70', u: '#0a1f28',
      o: '#0f1518',
      w: '#e8f8ff', x: '#ffffff', y: '#8fd6ee',
      s: '#59e0ff', t: '#b0f2ff', z: '#1c8caf',
      '1': '#59e0ff',
    },
    outline: '#081014',
    grid: wardenGrid,
    hitGrid: wardenHitGrid,
    castGrid: wardenCastGrid,
    deathGrid: (stage) => genericDeathGrid(26, 34, 9, 16, 7, 18, stage),
  },
  cinderborn: {
    palette: {
      h: '#3a2620', i: '#5c3d2f', j: '#1c1210',
      e: '#ffd23d', g: '#fff3c2',
      b: '#7a2f1f', c: '#a8492f', d: '#3d1610',
      a: '#ff8a3d',
      m: '#5c2216', l: '#823a24', q: '#26100a',
      n: '#e8b06a',
      p: '#4a1f14', r: '#6b3320', u: '#210c07',
      o: '#120a08',
      w: '#ffb84d', x: '#ffe28a', y: '#b8560f',
      v: '#3a2620',
      s: '#ff5a1f', t: '#ffd23d', z: '#8a230f',
      '1': '#ffd23d',
    },
    outline: '#0e0604',
    grid: cinderbornGrid,
    hitGrid: cinderbornHitGrid,
    castGrid: cinderbornCastGrid,
    deathGrid: (stage) => genericDeathGrid(25, 32, 8, 15, 6, 17, stage),
  },
  fortune: {
    palette: {
      h: '#f2c88f', i: '#ffe0b3', j: '#c99a5f',
      e: '#20241f', g: '#ffffff',
      b: '#3a6b3a', c: '#5c9450', d: '#1a331a',
      a: '#d9b23a',
      m: '#2c4f2c', l: '#487248', q: '#12220f',
      n: '#f2c88f',
      p: '#26401f', r: '#3f5c33', u: '#0f1c0c',
      o: '#171a17',
      w: '#c9a86a', x: '#e8d29a', y: '#8a6f3f',
      s: '#2c4f2c', t: '#487248', z: '#12220f',
      '1': '#e8c94a', '2': '#8a6f3f',
    },
    outline: '#0c1408',
    grid: fortuneGrid,
    hitGrid: fortuneHitGrid,
    castGrid: fortuneCastGrid,
    deathGrid: (stage) => genericDeathGrid(26, 30, 9, 14, 8, 15, stage),
  },
  steadyhand: {
    palette: {
      h: '#e0c9a8', i: '#f2e0c2', j: '#b89a72',
      e: '#20241f', g: '#b0f2ff',
      b: '#6a5a8a', c: '#8a78ad', d: '#332a4a',
      a: '#b0a0d8',
      m: '#4f4270', l: '#6d5e94', q: '#251f3d',
      n: '#e0c9a8',
      p: '#3f3560', o: '#171a17', r: '#584a80', u: '#1a1530',
      w: '#8a6a3f', x: '#c9a86a', y: '#4a3520',
      s: '#3f3560', t: '#584a80', z: '#1a1530',
      '1': '#d8c94a',
    },
    outline: '#0e0a18',
    grid: steadyhandGrid,
    hitGrid: steadyhandHitGrid,
    castGrid: steadyhandCastGrid,
    deathGrid: (stage) => genericDeathGrid(24, 30, 9, 14, 7, 16, stage),
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
