import { spriteAtlas } from './SpriteAtlas';
import { drawPixelGrid, makeGrid, fillRect, fillRectShaded, toRows } from './PixelDraw';

/**
 * WORLD PROP ART - the solid obstacles and breakable objects that make up the
 * gameplay layer of a stage (see WorldProps.ts). StageDecor keeps its own
 * cheap scatter sprites; these are separate because they are things the
 * player and the horde actually collide with or destroy.
 *
 * Same authoring contract as the character/enemy/power modules: 1px dark
 * outline, `fillRectShaded` volume under a top-left light, square grid whose
 * bottom row is the ground contact.
 *
 * SOLID props read as heavy and rooted - wide bases, strong verticals, muted
 * stone/wood palettes that sit back into the scene.
 * BREAKABLE props read as lighter and "touchable" - smaller silhouettes with
 * a warm emissive element (a flame, a glow, a crystal facet). That warm spot
 * is the whole tell; no cartoon outline is needed to say "hit me".
 */

// --- shared helpers --------------------------------------------------------

/** Chunky masonry block with a lit top face and a shadowed side. */
function stoneBlock(g: string[][], x0: number, y0: number, x1: number, y1: number): void {
  fillRectShaded(g, x0, y0, x1, y1, 's', 'l', 'd');
  // A couple of mortar lines so it does not read as one flat slab.
  const mid = Math.floor((y0 + y1) / 2);
  fillRect(g, x0 + 1, mid, x1 - 1, mid, 'd');
}

/** Small warm flame used by every breakable light source. */
function flame(g: string[][], cx: number, y: number): void {
  fillRect(g, cx, y - 3, cx + 1, y - 3, 'F');
  fillRect(g, cx - 1, y - 2, cx + 2, y - 1, 'f');
  fillRect(g, cx, y - 2, cx + 1, y - 2, 'F');
  fillRect(g, cx - 1, y, cx + 2, y, 'e');
}

const STONE: Record<string, string> = {
  s: '#7b8189', l: '#a2a8b1', d: '#464c55',
  m: '#5a6068', k: '#2c3138',
  g: '#4f7a4a', // moss
  F: '#fff3c2', f: '#ffb648', e: '#e0761f',
  w: '#5c3d22', x: '#7d5730', y: '#2e1c0f',
  c: '#c9a227',
};

const WOOD: Record<string, string> = {
  s: '#5c4327', l: '#7d5f38', d: '#2f2114',
  m: '#3f2d1a', k: '#1c1309',
  g: '#4a7a3a',
  F: '#fff3c2', f: '#ffb648', e: '#e0761f',
  w: '#6b8f3a', x: '#8fb356', y: '#2c4a1c',
  c: '#b06fe0',
};

const ARCANE: Record<string, string> = {
  s: '#6b5a8a', l: '#8f7ab0', d: '#3a2f4f',
  m: '#4a3d63', k: '#221a30',
  g: '#8a6a3a',
  F: '#e8d0ff', f: '#b98aff', e: '#7a4fc4',
  w: '#8a2f2f', x: '#b04a4a', y: '#4a1616',
  c: '#c9a227',
};

// ===========================================================================
// MOONLIT GRAVEYARD
// ===========================================================================

/** Mausoleum: the biggest graveyard blocker - a squat crypt with a doorway. */
function mausoleumGrid(): string[][] {
  const g = makeGrid(30, 30);
  fillRectShaded(g, 3, 6, 26, 10, 's', 'l', 'd'); // roof slab
  fillRect(g, 2, 10, 27, 11, 'd'); // roof lip shadow
  stoneBlock(g, 4, 11, 25, 28);
  fillRectShaded(g, 11, 17, 18, 28, 'k', 'm', 'k'); // dark doorway
  fillRect(g, 11, 16, 18, 17, 'd'); // lintel
  fillRect(g, 6, 13, 9, 15, 'm'); // small windows
  fillRect(g, 20, 13, 23, 15, 'm');
  fillRect(g, 4, 26, 8, 28, 'g'); // moss at the base
  fillRect(g, 2, 28, 27, 29, 'd'); // ground footing
  return g;
}

/** Broken wall fragment - a low funnel piece, good for shaping routes. */
function wallFragmentGrid(): string[][] {
  const g = makeGrid(30, 30);
  stoneBlock(g, 2, 14, 27, 27);
  // Ragged broken top.
  fillRect(g, 2, 12, 8, 14, 's');
  fillRect(g, 12, 10, 19, 14, 's');
  fillRect(g, 23, 13, 27, 14, 's');
  fillRect(g, 12, 10, 19, 10, 'l');
  fillRect(g, 9, 18, 10, 24, 'd'); // crack
  fillRect(g, 18, 20, 19, 27, 'd');
  fillRect(g, 2, 25, 7, 27, 'g');
  fillRect(g, 1, 27, 28, 29, 'd');
  return g;
}

/** Weeping statue on a plinth - tall vertical landmark. */
function statueGrid(): string[][] {
  const g = makeGrid(26, 30);
  fillRectShaded(g, 4, 24, 21, 29, 's', 'l', 'd'); // plinth
  fillRect(g, 3, 26, 22, 27, 'd');
  fillRectShaded(g, 9, 8, 16, 24, 's', 'l', 'd'); // robed body
  fillRect(g, 12, 12, 13, 23, 'd'); // robe fold
  fillRectShaded(g, 10, 3, 15, 8, 's', 'l', 'd'); // head/hood
  fillRect(g, 11, 5, 14, 7, 'd'); // shadowed face
  fillRectShaded(g, 5, 10, 9, 20, 's', 'l', 'd'); // wings/arms
  fillRectShaded(g, 16, 10, 20, 20, 's', 'l', 'd');
  fillRect(g, 4, 27, 8, 29, 'g');
  return g;
}

/** Graveyard lantern - breakable, warm flame is the tell. */
function lanternGrid(): string[][] {
  const g = makeGrid(18, 22);
  fillRectShaded(g, 7, 14, 10, 20, 'm', 's', 'k'); // post
  fillRect(g, 5, 20, 12, 21, 'k'); // base
  fillRectShaded(g, 5, 4, 12, 14, 'm', 's', 'k'); // housing
  fillRect(g, 6, 6, 11, 12, 'k'); // glass cavity
  flame(g, 8, 11);
  fillRect(g, 4, 3, 13, 4, 'd'); // cap
  fillRect(g, 8, 0, 9, 3, 'm'); // hook
  return g;
}

/** Funerary urn - breakable, no flame so it reads as pottery not a light. */
function urnGrid(): string[][] {
  const g = makeGrid(18, 20);
  fillRectShaded(g, 5, 6, 12, 17, 'w', 'x', 'y'); // body
  fillRect(g, 4, 9, 13, 13, 'x'); // wide belly
  fillRectShaded(g, 6, 3, 11, 6, 'w', 'x', 'y'); // neck
  fillRect(g, 4, 2, 13, 3, 'x'); // rim
  fillRect(g, 6, 11, 11, 12, 'c'); // gilt band
  fillRect(g, 4, 17, 13, 19, 'y'); // foot
  return g;
}

// ===========================================================================
// CURSED FOREST
// ===========================================================================

function boulderGrid(): string[][] {
  const g = makeGrid(28, 24);
  fillRectShaded(g, 4, 8, 24, 21, 's', 'l', 'd');
  fillRectShaded(g, 7, 4, 20, 9, 's', 'l', 'd');
  fillRect(g, 9, 6, 14, 8, 'l'); // lit crown
  fillRect(g, 6, 14, 8, 20, 'd'); // fissures
  fillRect(g, 16, 12, 17, 19, 'd');
  fillRect(g, 4, 18, 10, 21, 'g'); // moss
  fillRect(g, 3, 21, 25, 23, 'd');
  return g;
}

function fallenLogGrid(): string[][] {
  const g = makeGrid(30, 18);
  fillRectShaded(g, 1, 6, 28, 15, 's', 'l', 'd'); // trunk
  fillRect(g, 1, 9, 28, 10, 'l'); // lit upper flank
  fillRect(g, 1, 6, 6, 15, 'm'); // cut end
  fillRect(g, 2, 8, 5, 13, 'k'); // rings
  fillRect(g, 12, 4, 15, 6, 'm'); // broken branch stub
  fillRect(g, 20, 13, 27, 16, 'g'); // moss
  fillRect(g, 0, 15, 29, 17, 'd');
  return g;
}

function thickTreeGrid(): string[][] {
  const g = makeGrid(26, 30);
  fillRectShaded(g, 9, 6, 17, 27, 's', 'l', 'd'); // trunk
  fillRect(g, 11, 9, 12, 26, 'd'); // bark grooves
  fillRect(g, 15, 12, 16, 25, 'd');
  fillRectShaded(g, 5, 22, 9, 28, 's', 'l', 'd'); // roots
  fillRectShaded(g, 17, 22, 21, 28, 's', 'l', 'd');
  fillRect(g, 3, 27, 23, 29, 'd');
  fillRectShaded(g, 4, 2, 22, 8, 'w', 'x', 'y'); // dark canopy mass
  fillRect(g, 7, 1, 19, 3, 'x');
  return g;
}

function corruptCrystalGrid(): string[][] {
  const g = makeGrid(18, 22);
  fillRectShaded(g, 6, 16, 12, 20, 's', 'l', 'd'); // rock base
  fillRectShaded(g, 7, 5, 11, 17, 'f', 'F', 'e'); // main shard
  fillRect(g, 8, 7, 9, 14, 'F'); // inner glow
  fillRectShaded(g, 4, 11, 6, 18, 'f', 'F', 'e'); // side shards
  fillRectShaded(g, 12, 9, 14, 18, 'f', 'F', 'e');
  fillRect(g, 8, 3, 10, 5, 'F'); // tip flare
  fillRect(g, 5, 20, 13, 21, 'd');
  return g;
}

function totemGrid(): string[][] {
  const g = makeGrid(18, 24);
  fillRectShaded(g, 6, 4, 12, 21, 'w', 'x', 'y'); // carved post
  fillRect(g, 4, 21, 14, 23, 'y'); // base
  fillRect(g, 7, 7, 11, 8, 'y'); // carved bands
  fillRect(g, 7, 13, 11, 14, 'y');
  fillRect(g, 8, 9, 8, 11, 'F'); // glowing eyes
  fillRect(g, 10, 9, 10, 11, 'F');
  fillRectShaded(g, 4, 2, 14, 5, 'w', 'x', 'y'); // headpiece
  return g;
}

// ===========================================================================
// RUINED LIBRARY
// ===========================================================================

function bigShelfGrid(): string[][] {
  const g = makeGrid(28, 30);
  fillRectShaded(g, 3, 2, 24, 28, 's', 'l', 'd'); // case
  fillRect(g, 2, 28, 25, 29, 'd'); // footing
  for (let r = 0; r < 4; r++) {
    const y0 = 5 + r * 6;
    fillRect(g, 5, y0, 22, y0 + 4, 'k'); // shelf cavity
    // Book spines in alternating jewel tones.
    for (let b = 0; b < 6; b++) {
      const x = 6 + b * 3;
      fillRect(g, x, y0 + 1, x + 1, y0 + 4, (r + b) % 2 === 0 ? 'w' : 'c');
    }
    fillRect(g, 5, y0 + 5, 22, y0 + 5, 'd'); // shelf board
  }
  return g;
}

function columnGrid(): string[][] {
  const g = makeGrid(22, 30);
  fillRectShaded(g, 3, 25, 18, 29, 's', 'l', 'd'); // base
  fillRectShaded(g, 6, 4, 15, 25, 's', 'l', 'd'); // shaft
  for (let f = 0; f < 3; f++) fillRect(g, 8 + f * 3, 5, 8 + f * 3, 24, 'd'); // fluting
  fillRectShaded(g, 3, 0, 18, 4, 's', 'l', 'd'); // capital
  fillRect(g, 2, 3, 19, 4, 'd');
  return g;
}

function heavyTableGrid(): string[][] {
  const g = makeGrid(30, 20);
  fillRectShaded(g, 1, 5, 28, 9, 's', 'l', 'd'); // top
  fillRect(g, 1, 9, 28, 10, 'd');
  fillRectShaded(g, 4, 10, 8, 18, 's', 'l', 'd'); // legs
  fillRectShaded(g, 21, 10, 25, 18, 's', 'l', 'd');
  fillRect(g, 8, 13, 21, 15, 'm'); // cross brace
  fillRect(g, 10, 2, 14, 5, 'w'); // a book left on top
  fillRect(g, 10, 2, 14, 2, 'c');
  fillRect(g, 0, 18, 29, 19, 'd');
  return g;
}

function magicLampGrid(): string[][] {
  const g = makeGrid(18, 22);
  fillRectShaded(g, 6, 15, 11, 19, 'm', 's', 'k'); // stand
  fillRect(g, 4, 19, 13, 21, 'k');
  fillRectShaded(g, 5, 6, 12, 15, 'f', 'F', 'e'); // glass globe
  fillRect(g, 7, 8, 10, 13, 'F'); // burning core
  fillRect(g, 5, 4, 12, 6, 'm'); // collar
  fillRect(g, 8, 1, 9, 4, 'm'); // hook
  return g;
}

function vaseGrid(): string[][] {
  const g = makeGrid(18, 20);
  fillRectShaded(g, 4, 7, 13, 16, 'w', 'x', 'y'); // bulbous body
  fillRectShaded(g, 6, 2, 11, 7, 'w', 'x', 'y'); // narrow neck
  fillRect(g, 4, 1, 13, 2, 'x'); // flared rim
  fillRect(g, 5, 10, 12, 11, 'c'); // painted band
  fillRect(g, 6, 12, 7, 14, 'y'); // shading
  fillRect(g, 5, 16, 12, 18, 'y'); // foot
  return g;
}

// ---------------------------------------------------------------------------


// ===========================================================================
// PICKUPS - small, high-contrast, readable at a glance in a crowded frame.
// Each has a distinct SILHOUETTE, not just a distinct colour, so they stay
// separable when a dozen enemies overlap them.
// ===========================================================================
const PICKUP: Record<string, string> = {
  g: '#e8c246', h: '#fff3b0', d: '#8a6a12', // gold
  m: '#c0483a', n: '#e87a5c', k: '#6b1f16', // meat
  b: '#8fd6ff', c: '#e8faff', e: '#2f6f96', // ice
  v: '#b98aff', w: '#e8d0ff', y: '#5f2199', // soul
  s: '#c9ccd4', l: '#ffffff', t: '#5a5f68', // silver
  f: '#ff8a3d',
};

/**
 * Rows-as-art helper. Rectangles are fine for masonry and crates, but coins,
 * meat and gems need round or organic silhouettes, and at 14-16px the fastest
 * way to control every pixel is to draw the thing literally. '.' is empty.
 */
function gridFromRows(rows: string[]): string[][] {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const g = makeGrid(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch !== '.') g[y][x] = ch;
    }
  }
  return g;
}

/**
 * Coin pile - the common drop. Round overlapping coins rather than a stepped
 * block: at this size the silhouette is the whole message, and a rectangle
 * reads as a crate no matter what colour it is.
 */
function goldGrid(): string[][] {
  return gridFromRows([
    '..............',
    '..............',
    '.....hhhh.....',
    '....hggggh....',
    '....gggggg....',
    '.....dddd.....',
    '...hhhh.hhhh..',
    '..hgggghggggh.',
    '..gggggggggg..',
    '...dddd.dddd..',
    '.hhhhhhhhhhhh.',
    'hggggggggggggh',
    'gggggggggggggg',
    '.dddddddddddd.',
  ]);
}

/**
 * Hunter's Ration - a roast drumstick. The bone stub is what makes it read as
 * food instead of a red box, so it gets real pixels rather than a token line.
 */
function rationGrid(): string[][] {
  return gridFromRows([
    '..............',
    '..........ll..',
    '.........lssl.',
    '.........lssl.',
    '........lssl..',
    '.......lssl...',
    '....kknnsl....',
    '...knnnnnk....',
    '..knnnnnnnk...',
    '..kmnnnnnnk...',
    '..kmnnnnnnk...',
    '...kmmnnnk....',
    '....kkkkk.....',
    '..............',
  ]);
}

/**
 * Sepulchral Frost - an angular shard cluster. Kept spiky on purpose: it is
 * the only cold-coloured drop, and the jagged outline separates it from the
 * round gold ones even before colour registers.
 */
function freezeGrid(): string[][] {
  return gridFromRows([
    '.......c......',
    '......cbc.....',
    '......cbbc....',
    '.....ccbbbc...',
    '..c..cbbbbe...',
    '.cbc.cbbbbe.c.',
    '.cbbccbbbbe.cb',
    '.cbbbcbbbbecbb',
    '.ebbbcbbbbecbb',
    '..ebbcbbbbecb.',
    '...ebcbbbbeeb.',
    '....ecbbbbee..',
    '.....ebbbbe...',
    '......eeee....',
  ]);
}

/**
 * Soul Call - an inward spiral around a bright core. The shape has to say
 * "pull" on its own, because the effect (dragging every gem in) happens off
 * to the sides of wherever the player is looking.
 */
function vacuumGrid(): string[][] {
  return gridFromRows([
    '....vvvvvv....',
    '..vvyyyyyyvv..',
    '.vyy......yyv.',
    '.vy...ww...yv.',
    'vy..wwllww..yv',
    'vy.wl....lw.yv',
    'vy.wl.wl.lw.yv',
    'vy.wl.lw.lw.yv',
    'vy.wl....lw.yv',
    'vy..wwllww..yv',
    '.vy...ww...yv.',
    '.vyy......yy..',
    '..vvyyyyyyv...',
    '....vvvv......',
  ]);
}

/**
 * Purge Bell - the rarest drop, so it gets the loudest silhouette: nothing
 * else in the set has a flared skirt and a hanging yoke.
 */
function purgeGrid(): string[][] {
  return gridFromRows([
    '......tt......',
    '.....tsst.....',
    '.....slls.....',
    '....tsllst....',
    '....sllsst....',
    '...tsllssst...',
    '...sllsssst...',
    '...sllsssst...',
    '..tsllssssst..',
    '..sllsssssst..',
    '.tsllssssssst.',
    'llllllllllllll',
    'tttttttttttttt',
    '......gg......',
  ]);
}

/**
 * Fortune Coin - a single struck coin, face-on, with a clover die. Round and
 * marked so it never gets confused with the coin pile at a glance.
 */
function fortuneGrid(): string[][] {
  return gridFromRows([
    '.....hhhh.....',
    '...hhggggh h..',
    '..hgggggggh...',
    '.hggg.ff.gggh.',
    '.hgg.ffff.ggh.',
    'hgg.f.ff.f.ggh',
    'hgg.ffffff.ggh',
    'hgg..f.f.f.ggh',
    'hggd..ff..dggh',
    '.hgd..ff..dgh.',
    '.hggd....dggh.',
    '..dgggggggd...',
    '...ddggggdd...',
    '.....dddd.....',
  ]);
}

function reg(clip: string, grid: string[][], palette: Record<string, string>, outline: string): void {
  spriteAtlas.registerClip(clip, 1, true, [
    { key: clip, draw: (ctx, s) => drawPixelGrid(ctx, s, toRows(grid), palette, outline) },
  ]);
}

export function registerPropSprites(): void {
  const stoneOutline = '#14171b';
  const woodOutline = '#12100a';
  const arcaneOutline = '#120e1c';

  // Graveyard
  reg('prop_grave_mausoleum', mausoleumGrid(), STONE, stoneOutline);
  reg('prop_grave_wall', wallFragmentGrid(), STONE, stoneOutline);
  reg('prop_grave_statue', statueGrid(), STONE, stoneOutline);
  reg('prop_grave_lantern', lanternGrid(), STONE, stoneOutline);
  reg('prop_grave_urn', urnGrid(), STONE, stoneOutline);

  // Forest
  reg('prop_forest_boulder', boulderGrid(), STONE, stoneOutline);
  reg('prop_forest_log', fallenLogGrid(), WOOD, woodOutline);
  reg('prop_forest_tree', thickTreeGrid(), WOOD, woodOutline);
  reg('prop_forest_crystal', corruptCrystalGrid(), ARCANE, arcaneOutline);
  reg('prop_forest_totem', totemGrid(), WOOD, woodOutline);

  // Pickups
  const pickOutline = '#161213';
  reg('pickup_gold', goldGrid(), PICKUP, pickOutline);
  reg('pickup_ration', rationGrid(), PICKUP, pickOutline);
  reg('pickup_freeze', freezeGrid(), PICKUP, pickOutline);
  reg('pickup_vacuum', vacuumGrid(), PICKUP, pickOutline);
  reg('pickup_purge', purgeGrid(), PICKUP, pickOutline);
  reg('pickup_fortune', fortuneGrid(), PICKUP, pickOutline);

  // Library
  reg('prop_lib_shelf', bigShelfGrid(), WOOD, woodOutline);
  reg('prop_lib_column', columnGrid(), STONE, stoneOutline);
  reg('prop_lib_table', heavyTableGrid(), WOOD, woodOutline);
  reg('prop_lib_lamp', magicLampGrid(), ARCANE, arcaneOutline);
  reg('prop_lib_vase', vaseGrid(), ARCANE, arcaneOutline);
}
