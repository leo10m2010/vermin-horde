import * as THREE from 'three';

export type UVRect = [number, number, number, number]; // u0, v0, u1, v1

export interface AnimClip {
  cells: number[]; // atlas cell indices, one per frame
  fps: number;
  loop: boolean;
}

type DrawFn = (ctx: CanvasRenderingContext2D, size: number) => void;

/**
 * Single master texture atlas shared by every InstancedBillboardBatch
 * (enemies, projectiles, gems, particles, player, boss). Every content
 * subsystem registers its procedurally-drawn frames here during init; call
 * build() once, after all registrations, to rasterize the final texture.
 *
 * Swapping to real spritesheet PNGs later only means changing what draw()
 * does per cell (or bypassing registerCell to blit an Image) - the rect
 * lookup / animation contract stays the same.
 */
export class SpriteAtlas {
  private readonly draws: DrawFn[] = [];
  private readonly keyToIndex = new Map<string, number>();
  private readonly clips = new Map<string, AnimClip>();
  private built = false;
  private cols = 1;
  private rows = 1;
  texture!: THREE.CanvasTexture;

  constructor(
    private readonly cellPx = 64,
  ) {}

  registerCell(key: string, draw: DrawFn): number {
    if (this.built) throw new Error('SpriteAtlas already built; register cells before build().');
    const existing = this.keyToIndex.get(key);
    if (existing !== undefined) return existing;
    const index = this.draws.length;
    this.draws.push(draw);
    this.keyToIndex.set(key, index);
    return index;
  }

  registerClip(name: string, fps: number, loop: boolean, frames: Array<{ key: string; draw: DrawFn }>): AnimClip {
    const cells = frames.map((f) => this.registerCell(f.key, f.draw));
    const clip: AnimClip = { cells, fps, loop };
    this.clips.set(name, clip);
    return clip;
  }

  hasClip(name: string): boolean {
    return this.clips.has(name);
  }

  getClip(name: string): AnimClip {
    const clip = this.clips.get(name);
    if (!clip) throw new Error(`Unknown animation clip: ${name}`);
    return clip;
  }

  cellIndexOf(key: string): number {
    const index = this.keyToIndex.get(key);
    if (index === undefined) throw new Error(`Unknown sprite cell: ${key}`);
    return index;
  }

  getUV(cellIndex: number): UVRect {
    const col = cellIndex % this.cols;
    const row = Math.floor(cellIndex / this.cols);
    const halfTexel = 0.5 / (this.cols * this.cellPx);
    const u0 = col / this.cols + halfTexel;
    const u1 = (col + 1) / this.cols - halfTexel;
    // Canvas rows are drawn top-down; flip so cell row 0 samples correctly
    // once the texture is uploaded with the default flipY behaviour.
    const v1 = 1 - row / this.rows - halfTexel;
    const v0 = 1 - (row + 1) / this.rows + halfTexel;
    return [u0, v0, u1, v1];
  }

  build(): THREE.CanvasTexture {
    if (this.built) return this.texture;
    const count = Math.max(1, this.draws.length);
    const side = Math.max(1, Math.ceil(Math.sqrt(count)));
    this.cols = side;
    this.rows = side;
    const cell = this.cellPx;
    const canvas = document.createElement('canvas');
    canvas.width = side * cell;
    canvas.height = side * cell;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not acquire 2D context for sprite atlas.');
    ctx.imageSmoothingEnabled = false;

    this.draws.forEach((draw, index) => {
      const col = index % this.cols;
      const row = Math.floor(index / this.cols);
      ctx.save();
      ctx.translate(col * cell, row * cell);
      draw(ctx, cell);
      ctx.restore();
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.texture = texture;
    this.built = true;
    return texture;
  }

  get debugCellCount(): number {
    return this.draws.length;
  }
}

// Shared singleton every content module (enemies, weapons, vfx, ui icons)
// registers into. Game bootstrap calls spriteAtlas.build() once, after all
// registration modules have run, before the render loop starts.
export const spriteAtlas = new SpriteAtlas(64);

/** Pure helper: advance an animation timer, return the active frame's cell index. */
export function advanceAnimFrame(clip: AnimClip, timer: number, dt: number): { timer: number; cellIndex: number; finished: boolean } {
  const frameDuration = 1 / clip.fps;
  let t = timer + dt;
  const totalFrames = clip.cells.length;
  let finished = false;
  if (clip.loop) {
    t %= frameDuration * totalFrames;
  } else if (t >= frameDuration * totalFrames) {
    t = frameDuration * totalFrames - 0.0001;
    finished = true;
  }
  const frame = Math.min(totalFrames - 1, Math.floor(t / frameDuration));
  return { timer: t, cellIndex: clip.cells[frame], finished };
}
