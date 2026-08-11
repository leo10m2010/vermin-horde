import * as THREE from 'three';
import { LAYER_Y, POOL_CAPACITY } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import { IndexPool } from '../core/ObjectPool';
import { InstancedBillboardBatch } from '../render/InstancedBillboardBatch';
import type { UVRect } from '../render/SpriteAtlas';
import { spriteAtlas } from '../render/SpriteAtlas';
import type { ProjectileManager } from '../entities/ProjectileManager';

const CAPACITY = 400;
const TRAIL_THROTTLE = 0.045; // seconds between trail dots per live projectile slot
const TRAIL_MIN_SPEED_SQ = 4; // ~2 units/s; stationary visuals (garlic ring, hex zone, whip slash) never trail
const TRAIL_LIFE_MIN = 0.15;
const TRAIL_LIFE_MAX = 0.3;
const TRAIL_BACKDRIFT = -0.12; // fraction of projectile velocity kept as opposite drift, so dots trail behind rather than sit still

const DEFAULT_TRAIL_TINT: [number, number, number] = [1, 1, 1];
// Indexed by WEAPON_ROSTER order (see WeaponRegistry.ts) - the numeric weaponId
// ProjectileManager.spawn stamps onto every projectile - so each weapon's
// trail reads with a distinct hue without this module needing to reach into
// ProjectileManager's private per-visual tint/clip data. Weapons whose
// visuals never move fast enough to qualify (garlic_aura's ring, whip_strike's
// decorative slash) are omitted; they fall back to DEFAULT_TRAIL_TINT but
// never actually trigger a trail since their velocity is always ~0.
const WEAPON_TRAIL_TINT: Record<number, [number, number, number]> = {
  0: [1, 0.95, 0.6], // magic_wand
  1: [0.85, 0.72, 0.55], // axe_throw
  2: [1, 1, 1], // knife_throw
  3: [1, 0.55, 0.2], // fireball
  5: [0.55, 0.9, 1], // orbiter_blades
  7: [0.75, 0.55, 1], // arc_cross
  8: [1, 0.4, 0.2], // ember_wand
  9: [0.55, 0.85, 1], // rune_shard
  10: [0.55, 0.95, 0.55], // hex_flask
};

/**
 * Complementary VFX layer to ParticleSystem: short fading motion-trail dots
 * sampled directly off ProjectileManager's live typed arrays every frame
 * (there is no per-projectile "still flying" event to subscribe to), plus a
 * small sharp radial impact flash on `enemyHit` - deliberately smaller/
 * sharper than ParticleSystem's scatter-spark burst so the two layer
 * together instead of duplicating each other.
 *
 * Own small pooled InstancedBillboardBatch, same pattern as ParticleSystem:
 * construct once, add `object3D` to the scene, call `update(dt, projectiles)`
 * every frame, and rebind `batch.setTexture(spriteAtlas.texture)` once
 * `spriteAtlas.build()` has run (this batch is constructed before the atlas
 * canvas has real pixels, same as every other InstancedBillboardBatch here).
 */
export class ProjectileTrails {
  readonly batch: InstancedBillboardBatch;
  private readonly pool = new IndexPool(CAPACITY);

  private readonly alive = new Uint8Array(CAPACITY);
  private readonly posX = new Float32Array(CAPACITY);
  private readonly posY = new Float32Array(CAPACITY);
  private readonly posZ = new Float32Array(CAPACITY);
  private readonly velX = new Float32Array(CAPACITY);
  private readonly velZ = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  private readonly maxLife = new Float32Array(CAPACITY);
  private readonly size = new Float32Array(CAPACITY);
  private readonly tintR = new Float32Array(CAPACITY).fill(1);
  private readonly tintG = new Float32Array(CAPACITY).fill(1);
  private readonly tintB = new Float32Array(CAPACITY).fill(1);
  private readonly uv: UVRect[] = new Array(CAPACITY).fill([0, 0, 1, 1]);

  // One small per-projectile-slot cooldown clock (sized to the shared
  // projectile pool capacity) so a screen full of fast-firing weapons
  // samples each live projectile at most once every TRAIL_THROTTLE seconds,
  // instead of spawning a trail dot every single frame per projectile.
  private readonly nextTrailAt = new Float32Array(POOL_CAPACITY.projectiles);
  private clock = 0;

  private readonly unsubscribers: Array<() => void> = [];

  constructor() {
    this.batch = new InstancedBillboardBatch(CAPACITY, spriteAtlas.texture, 'projectile-trails');
    this.unsubscribers.push(
      gameEvents.on('enemyHit', (e) => this.spawnImpactFlash(e.x, e.z, e.crit)),
    );
  }

  get object3D(): THREE.Object3D {
    return this.batch.mesh;
  }

  /** Director calls this every frame, passing the live ProjectileManager so current positions/velocities can be sampled directly. */
  update(dt: number, projectiles: ProjectileManager): void {
    this.clock += dt;
    this.sampleTrails(projectiles);
    this.stepParticles(dt);
    this.batch.commit();
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
    this.batch.dispose();
  }

  private sampleTrails(projectiles: ProjectileManager): void {
    const uv = this.resolveUV('fx_trail_dot');
    const cap = Math.min(projectiles.capacity, this.nextTrailAt.length);
    for (let i = 0; i < cap; i++) {
      if (!projectiles.alive[i]) continue;
      const vx = projectiles.velX[i];
      const vz = projectiles.velZ[i];
      const speedSq = vx * vx + vz * vz;
      if (speedSq < TRAIL_MIN_SPEED_SQ) continue;
      if (this.clock < this.nextTrailAt[i]) continue;
      this.nextTrailAt[i] = this.clock + TRAIL_THROTTLE;

      const index = this.pool.acquire();
      if (index === -1) continue; // pool exhausted this tick; drop the dot rather than stall

      const tint = WEAPON_TRAIL_TINT[projectiles.weaponId[i]] ?? DEFAULT_TRAIL_TINT;
      const life = TRAIL_LIFE_MIN + Math.random() * (TRAIL_LIFE_MAX - TRAIL_LIFE_MIN);
      this.alive[index] = 1;
      this.posX[index] = projectiles.posX[i];
      this.posY[index] = LAYER_Y.projectile;
      this.posZ[index] = projectiles.posZ[i];
      this.velX[index] = vx * TRAIL_BACKDRIFT;
      this.velZ[index] = vz * TRAIL_BACKDRIFT;
      this.life[index] = life;
      this.maxLife[index] = life;
      this.size[index] = 0.22 + Math.random() * 0.08;
      this.tintR[index] = tint[0];
      this.tintG[index] = tint[1];
      this.tintB[index] = tint[2];
      this.uv[index] = uv;
    }
  }

  private spawnImpactFlash(x: number, z: number, crit: boolean): void {
    const index = this.pool.acquire();
    if (index === -1) return; // pool exhausted; skip this flash rather than stall/steal a trail slot
    const life = crit ? 0.22 : 0.16;
    const tint: [number, number, number] = crit ? [1, 0.85, 0.45] : [1, 1, 1];
    this.alive[index] = 1;
    this.posX[index] = x;
    this.posY[index] = LAYER_Y.projectile + 0.05;
    this.posZ[index] = z;
    this.velX[index] = 0;
    this.velZ[index] = 0;
    this.life[index] = life;
    this.maxLife[index] = life;
    this.size[index] = crit ? 0.85 : 0.6;
    this.tintR[index] = tint[0];
    this.tintG[index] = tint[1];
    this.tintB[index] = tint[2];
    this.uv[index] = this.resolveUV(crit ? 'fx_impact_fire' : 'fx_impact_generic');
  }

  private stepParticles(dt: number): void {
    for (let i = 0; i < CAPACITY; i++) {
      if (!this.alive[i]) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive[i] = 0;
        this.batch.hide(i);
        this.pool.release(i);
        continue;
      }
      this.posX[i] += this.velX[i] * dt;
      this.posZ[i] += this.velZ[i] * dt;

      const lifeFrac = this.life[i] / this.maxLife[i];
      const alpha = lifeFrac; // linear fade reads as a crisp streak/flash rather than a lingering particle pop
      const scale = 0.5 + 0.5 * lifeFrac;
      const size = this.size[i] * scale;

      this.batch.set(i, this.posX[i], this.posY[i], this.posZ[i], this.uv[i], size, size, this.tintR[i], this.tintG[i], this.tintB[i], alpha, 0);
    }
  }

  private resolveUV(clipName: string): UVRect {
    if (spriteAtlas.hasClip(clipName)) {
      const clip = spriteAtlas.getClip(clipName);
      return spriteAtlas.getUV(clip.cells[0]);
    }
    // Sprite registration ordering issue (shouldn't happen once wired
    // correctly) - fall back to atlas cell 0 so trails never crash the frame.
    return spriteAtlas.getUV(0);
  }
}
