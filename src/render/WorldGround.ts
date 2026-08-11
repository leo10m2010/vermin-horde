import * as THREE from 'three';
import { WORLD } from '../core/Constants';
import type { StageDef } from '../game/Stages';

/** Default (original) green field palette, used whenever no stage is passed. */
const DEFAULT_GROUND_PALETTE: Pick<StageDef, 'groundBaseColor' | 'groundFleckColorA' | 'groundFleckColorB'> = {
  groundBaseColor: '#233318',
  groundFleckColorA: '#2a3d1d',
  groundFleckColorB: '#1c2814',
};

/**
 * Large tiled ground plane for the open field. Texture is hand-drawn on a
 * canvas at low res and repeated with nearest filtering so it reads as
 * pixel-art from the tilted camera, matching the sprite billboards.
 *
 * Pass a `StageDef` (see `src/game/Stages.ts`) to recolor the ground for a
 * chosen stage; omit it to get the original green-field default so nothing
 * else breaks while stage selection isn't wired in yet.
 */
export function createGroundMesh(stage?: StageDef): THREE.Mesh {
  const palette = stage ?? DEFAULT_GROUND_PALETTE;
  const tile = 64;
  const canvas = document.createElement('canvas');
  canvas.width = tile;
  canvas.height = tile;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = palette.groundBaseColor;
  ctx.fillRect(0, 0, tile, tile);

  // Sparse darker/lighter flecks for texture variety without noise.
  const rng = mulberry32(7);
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rng() * tile);
    const y = Math.floor(rng() * tile);
    const shade = rng() > 0.5 ? palette.groundFleckColorA : palette.groundFleckColorB;
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, 2, 2);
  }
  // Subtle grid seam so scale/motion reads clearly.
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.strokeRect(0, 0, tile, tile);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const repeats = (WORLD.halfExtent * 2) / 6;
  texture.repeat.set(repeats, repeats);

  const geometry = new THREE.PlaneGeometry(WORLD.halfExtent * 2, WORLD.halfExtent * 2, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0;
  return mesh;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
