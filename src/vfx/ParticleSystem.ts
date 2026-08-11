import * as THREE from 'three';
import { LAYER_Y, POOL_CAPACITY } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import { IndexPool } from '../core/ObjectPool';
import { InstancedBillboardBatch } from '../render/InstancedBillboardBatch';
import type { UVRect } from '../render/SpriteAtlas';
import { spriteAtlas } from '../render/SpriteAtlas';

export interface ParticleBurstOptions {
  count?: number;
  colorHex?: string;
  speed?: number;
  life?: number;
  clip?: string;
  sizeBase?: number;
}

const DRAG = 2.6; // 1/s exponential decay applied to horizontal velocity
const GRAVITY = 7.5; // world units/s^2 pulling the initial upward "pop" back down
const GROUND_Y = LAYER_Y.particle * 0.25;
const FADE_FRACTION = 0.35; // final portion of life over which alpha ramps to 0

function hexToUnitRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const value = parseInt(full, 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/**
 * Pooled, InstancedMesh-rendered burst particles (impact sparks, kill
 * bursts, pickup sparkle, level-up radiance). Reuses the
 * InstancedBillboardBatch primitive so the whole pool draws in a single
 * call. Subscribes to gameplay events internally so the director only needs
 * to add `object3D` to the scene, call `update(dt)` every frame, and (like
 * the other batches in Game.ts) rebind `batch.setTexture(spriteAtlas.texture)`
 * once `spriteAtlas.build()` has run.
 */
export class ParticleSystem {
  private readonly capacity = POOL_CAPACITY.particles;
  private readonly pool = new IndexPool(this.capacity);
  readonly batch: InstancedBillboardBatch;

  private readonly alive = new Uint8Array(this.capacity);
  private readonly posX = new Float32Array(this.capacity);
  private readonly posY = new Float32Array(this.capacity);
  private readonly posZ = new Float32Array(this.capacity);
  private readonly velX = new Float32Array(this.capacity);
  private readonly velY = new Float32Array(this.capacity);
  private readonly velZ = new Float32Array(this.capacity);
  private readonly life = new Float32Array(this.capacity);
  private readonly maxLife = new Float32Array(this.capacity);
  private readonly size = new Float32Array(this.capacity);
  private readonly tintR = new Float32Array(this.capacity).fill(1);
  private readonly tintG = new Float32Array(this.capacity).fill(1);
  private readonly tintB = new Float32Array(this.capacity).fill(1);
  private readonly uv: UVRect[] = new Array(this.capacity).fill([0, 0, 1, 1]);

  // Best-effort last-known player position, inferred from the last hit/pickup
  // event. `levelUp` carries no x/z (see final report note), so this is the
  // fallback used to place its radiant burst.
  private lastKnownX = 0;
  private lastKnownZ = 0;

  private readonly unsubscribers: Array<() => void> = [];

  constructor() {
    this.batch = new InstancedBillboardBatch(this.capacity, spriteAtlas.texture, 'vfx-particles');
    this.bindEvents();
  }

  get object3D(): THREE.Object3D {
    return this.batch.mesh;
  }

  spawnBurst(x: number, z: number, opts: ParticleBurstOptions = {}): void {
    const count = Math.max(0, Math.round(opts.count ?? 10));
    const speed = opts.speed ?? 4;
    const life = opts.life ?? 0.5;
    const sizeBase = opts.sizeBase ?? 0.4;
    const tint = opts.colorHex ? hexToUnitRgb(opts.colorHex) : ([1, 1, 1] as [number, number, number]);
    const uv = this.resolveUV(opts.clip);

    for (let n = 0; n < count; n++) {
      const index = this.pool.acquire();
      if (index === -1) return; // pool exhausted this burst; drop the remainder rather than stall

      const angle = Math.random() * Math.PI * 2;
      const spd = speed * (0.55 + Math.random() * 0.75);
      this.posX[index] = x;
      this.posY[index] = LAYER_Y.particle;
      this.posZ[index] = z;
      this.velX[index] = Math.cos(angle) * spd;
      this.velZ[index] = Math.sin(angle) * spd;
      this.velY[index] = 2 + Math.random() * 2.5;
      const l = life * (0.75 + Math.random() * 0.5);
      this.life[index] = l;
      this.maxLife[index] = l;
      this.size[index] = sizeBase * (0.7 + Math.random() * 0.6);
      this.tintR[index] = tint[0];
      this.tintG[index] = tint[1];
      this.tintB[index] = tint[2];
      this.uv[index] = uv;
      this.alive[index] = 1;
    }
  }

  update(dt: number): void {
    const dragFactor = Math.exp(-DRAG * dt);
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive[i] = 0;
        this.batch.hide(i);
        this.pool.release(i);
        continue;
      }

      this.velX[i] *= dragFactor;
      this.velZ[i] *= dragFactor;
      this.velY[i] -= GRAVITY * dt;
      this.posX[i] += this.velX[i] * dt;
      this.posZ[i] += this.velZ[i] * dt;
      this.posY[i] += this.velY[i] * dt;
      if (this.posY[i] < GROUND_Y) {
        this.posY[i] = GROUND_Y;
        this.velY[i] = 0;
      }

      const lifeFrac = this.life[i] / this.maxLife[i];
      const alpha = lifeFrac < FADE_FRACTION ? lifeFrac / FADE_FRACTION : 1;
      const scale = 0.6 + 0.4 * lifeFrac;
      const size = this.size[i] * scale;

      this.batch.set(
        i,
        this.posX[i],
        this.posY[i],
        this.posZ[i],
        this.uv[i],
        size,
        size,
        this.tintR[i],
        this.tintG[i],
        this.tintB[i],
        alpha,
        0,
      );
    }
    this.batch.commit();
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
    this.batch.dispose();
  }

  private resolveUV(clipName?: string): UVRect {
    if (clipName && spriteAtlas.hasClip(clipName)) {
      const clip = spriteAtlas.getClip(clipName);
      return spriteAtlas.getUV(clip.cells[0]);
    }
    // No matching VFX clip registered yet (art may still be landing from a
    // sibling agent) - fall back to atlas cell 0 so bursts never crash.
    return spriteAtlas.getUV(0);
  }

  private bindEvents(): void {
    this.unsubscribers.push(
      gameEvents.on('enemyHit', (e) => {
        this.spawnBurst(e.x, e.z, {
          count: e.crit ? 9 : 5,
          speed: e.crit ? 6.5 : 3.5,
          life: 0.3,
          sizeBase: e.crit ? 0.5 : 0.34,
          colorHex: e.crit ? '#ffe066' : '#f2f0e6',
          clip: 'vfx_spark',
        });
      }),
      gameEvents.on('enemyKilled', (e) => {
        const scale = e.isBoss ? 3.2 : e.isElite ? 1.9 : 1;
        this.spawnBurst(e.x, e.z, {
          count: e.isBoss ? 48 : e.isElite ? 26 : 13,
          speed: 5 * scale,
          life: 0.55,
          sizeBase: 0.4 * scale,
          colorHex: e.isBoss ? '#ff8a3d' : e.isElite ? '#b06dff' : '#d9403a',
          clip: 'vfx_hit_burst',
        });
      }),
      gameEvents.on('gemCollected', (e) => {
        this.lastKnownX = e.x;
        this.lastKnownZ = e.z;
        this.spawnBurst(e.x, e.z, {
          count: 6,
          speed: 2.5,
          life: 0.4,
          sizeBase: 0.3,
          colorHex: '#59e0ff',
          clip: 'vfx_spark',
        });
      }),
      gameEvents.on('levelUp', () => {
        this.spawnBurst(this.lastKnownX, this.lastKnownZ, {
          count: 46,
          speed: 6.5,
          life: 0.75,
          sizeBase: 0.55,
          colorHex: '#b06dff',
          clip: 'vfx_levelup_burst',
        });
        this.spawnBurst(this.lastKnownX, this.lastKnownZ, {
          count: 26,
          speed: 3.2,
          life: 0.95,
          sizeBase: 0.42,
          colorHex: '#59e0ff',
          clip: 'vfx_levelup_burst',
        });
      }),
      gameEvents.on('playerHit', (e) => {
        this.lastKnownX = e.x;
        this.lastKnownZ = e.z;
        this.spawnBurst(e.x, e.z, {
          count: 10,
          speed: 4.2,
          life: 0.35,
          sizeBase: 0.4,
          colorHex: '#ff5a4d',
          clip: 'vfx_spark',
        });
      }),
    );
  }
}
