/**
 * Small helpers for drawing chunky, readable pixel-art into an atlas cell.
 * Every sprite is authored as a low-res grid (typically 16x16) then scaled
 * up to the cell's full pixel size with imageSmoothingEnabled=false already
 * set by SpriteAtlas, so edges stay crisp.
 */

/**
 * grid rows top-to-bottom, each a string where each char maps to a palette
 * color; '.' = transparent. Pass `outlineColor` to stamp a 1-cell dark halo
 * around the silhouette first (drawn into every transparent cell orthogonally
 * adjacent to a filled one) before painting the real colors on top - the
 * crisp dark contour real pixel-art character sprites (Vampire Survivors
 * included) almost always have, and which a flat-fill-only sprite reads as
 * "flat icon" rather than "character" without.
 */
export function drawPixelGrid(
  ctx: CanvasRenderingContext2D,
  cellSize: number,
  grid: string[],
  palette: Record<string, string>,
  outlineColor?: string,
): void {
  const rows = grid.length;
  const cols = Math.max(...grid.map((r) => r.length));
  const px = cellSize / Math.max(rows, cols);
  const offsetX = (cellSize - cols * px) / 2;
  const offsetY = (cellSize - rows * px) / 2;
  const isFilled = (x: number, y: number): boolean => {
    const ch = grid[y]?.[x];
    return ch !== undefined && ch !== '.' && ch !== ' ';
  };

  if (outlineColor) {
    ctx.fillStyle = outlineColor;
    for (let y = 0; y < rows; y++) {
      const row = grid[y];
      for (let x = 0; x < row.length; x++) {
        if (!isFilled(x, y)) continue;
        if (!isFilled(x, y - 1)) ctx.fillRect(Math.round(offsetX + x * px), Math.round(offsetY + (y - 1) * px), Math.ceil(px), Math.ceil(px));
        if (!isFilled(x, y + 1)) ctx.fillRect(Math.round(offsetX + x * px), Math.round(offsetY + (y + 1) * px), Math.ceil(px), Math.ceil(px));
        if (!isFilled(x - 1, y)) ctx.fillRect(Math.round(offsetX + (x - 1) * px), Math.round(offsetY + y * px), Math.ceil(px), Math.ceil(px));
        if (!isFilled(x + 1, y)) ctx.fillRect(Math.round(offsetX + (x + 1) * px), Math.round(offsetY + y * px), Math.ceil(px), Math.ceil(px));
      }
    }
  }

  for (let y = 0; y < rows; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const color = palette[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(offsetX + x * px), Math.round(offsetY + y * px), Math.ceil(px), Math.ceil(px));
    }
  }
}

export function drawSoftCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, alpha = 1): void {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawOutlinedCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, outline: string, lineWidth = 2): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = outline;
  ctx.stroke();
}

// --- coordinate-based grid authoring helpers, shared by every sprite module
// so pixel art is built as safe fillRect() coordinates instead of hand-
// aligned multiline strings. ---

export function makeGrid(w: number, h: number): string[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => '.'));
}

export function fillRect(g: string[][], x0: number, y0: number, x1: number, y1: number, ch: string): void {
  for (let y = y0; y <= y1; y++) {
    if (!g[y]) continue;
    for (let x = x0; x <= x1; x++) {
      if (g[y][x] === undefined) continue;
      g[y][x] = ch;
    }
  }
}

export function toRows(g: string[][]): string[] {
  return g.map((row) => row.join(''));
}

/**
 * Fills a rect with `base`, then stamps a 1px `highlight` strip along its
 * top+left edge and a 1px `shadow` strip along its bottom+right edge (light
 * source implicitly top-left, matching every other shaded block so a whole
 * character reads as lit consistently). This is the cheap, repeatable way to
 * turn a flat single-tone block into something that reads as having volume -
 * use it for every major body part (torso, limbs, armor plates, weapon
 * heads) instead of a flat fillRect, and reserve plain fillRect for genuinely
 * flat/thin details (outlines, eye dots, straps) where a bevel would just be
 * noise. Safe to call with a rect only 1-2px wide/tall - the edge stamps
 * simply overlap the base fill in that case, which still reads fine.
 */
export function fillRectShaded(
  g: string[][],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  base: string,
  highlight: string,
  shadow: string,
): void {
  fillRect(g, x0, y0, x1, y1, base);
  fillRect(g, x0, y0, x1, y0, highlight);
  fillRect(g, x0, y0, x0, y1, highlight);
  fillRect(g, x0, y1, x1, y1, shadow);
  fillRect(g, x1, y0, x1, y1, shadow);
}
