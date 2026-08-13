import { LAYER_Y, RENDER_ORDER } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import { IndexPool } from '../core/ObjectPool';
import { InstancedBillboardBatch } from '../render/InstancedBillboardBatch';
import { ShadowBatch } from '../render/ShadowBatch';
import { spriteAtlas } from '../render/SpriteAtlas';
import { findDrop, type PickupKind } from './DropTable';

/**
 * Pooled world pickups dropped by breakables.
 *
 * Same architecture as every other entity system here: struct-of-arrays, one
 * instanced draw call, no per-pickup objects or materials. Pickups drift
 * toward the player once inside magnet range and are collected on contact,
 * mirroring how XP gems already behave so the two read as one family.
 *
 * The manager owns NO effects. Collecting emits `pickupCollected` and the
 * director applies the outcome, which keeps freeze/purge/vacuum logic next to
 * the systems they actually touch instead of buried in a spawner.
 */

const CAPACITY = 48;
const KINDS: PickupKind[] = ['gold', 'ration', 'vacuum', 'freeze', 'purge', 'fortune'];

export class PickupManager {
  readonly batch: InstancedBillboardBatch;
  readonly shadowBatch: ShadowBatch;
  private readonly pool = new IndexPool(CAPACITY);

  readonly posX = new Float32Array(CAPACITY);
  readonly posZ = new Float32Array(CAPACITY);
  readonly alive = new Uint8Array(CAPACITY);
  /** Index into KINDS. */
  private readonly kind = new Uint8Array(CAPACITY);
  private readonly bobPhase = new Float32Array(CAPACITY);
  private readonly magnetized = new Uint8Array(CAPACITY);
  private time = 0;

  constructor() {
    this.batch = new InstancedBillboardBatch(CAPACITY, spriteAtlas.texture, 'pickups', false, RENDER_ORDER.gem);
    this.shadowBatch = new ShadowBatch(CAPACITY, 'pickup-shadows');
  }

  spawn(x: number, z: number, kind: PickupKind): number {
    const index = this.pool.acquire();
    if (index === -1) return -1;
    this.posX[index] = x;
    this.posZ[index] = z;
    this.alive[index] = 1;
    this.kind[index] = Math.max(0, KINDS.indexOf(kind));
    this.bobPhase[index] = Math.random() * Math.PI * 2;
    this.magnetized[index] = 0;
    return index;
  }

  private despawn(index: number): void {
    if (!this.alive[index]) return;
    this.alive[index] = 0;
    this.batch.hide(index);
    this.shadowBatch.hide(index);
    this.pool.release(index);
  }

  update(dt: number, playerX: number, playerZ: number, magnetRadius: number, collectRadius: number): void {
    this.time += dt;
    for (let i = 0; i < CAPACITY; i++) {
      if (!this.alive[i]) continue;
      const dx = playerX - this.posX[i];
      const dz = playerZ - this.posZ[i];
      const distSq = dx * dx + dz * dz;

      if (distSq < collectRadius * collectRadius) {
        gameEvents.emit('pickupCollected', { x: this.posX[i], z: this.posZ[i], kind: KINDS[this.kind[i]] });
        this.despawn(i);
        continue;
      }

      // Slightly wider magnet than XP gems: a relic sliding to you is part of
      // the reward, and chasing one across a horde is not interesting.
      if (!this.magnetized[i] && distSq < magnetRadius * magnetRadius) this.magnetized[i] = 1;
      if (this.magnetized[i]) {
        const dist = Math.sqrt(distSq) || 1;
        const speed = 7.5;
        this.posX[i] += (dx / dist) * speed * dt;
        this.posZ[i] += (dz / dist) * speed * dt;
      }

      const def = findDrop(KINDS[this.kind[i]]);
      const clip = def?.clip ?? 'pickup_gold';
      const uv = spriteAtlas.hasClip(clip) ? spriteAtlas.getUV(spriteAtlas.getClip(clip).cells[0]) : spriteAtlas.getUV(0);
      // Gentle idle bob so a dropped relic reads as collectable rather than as scenery.
      const bob = Math.sin(this.time * 3 + this.bobPhase[i]) * 0.09;
      const size = 0.95;
      this.batch.set(i, this.posX[i], LAYER_Y.gem + 0.12 + bob, this.posZ[i], uv, size, size);
      this.shadowBatch.set(i, this.posX[i], this.posZ[i], 0.3);
    }
    this.batch.commit();
    this.shadowBatch.commit();
  }

  get activeCount(): number {
    return this.pool.activeCount;
  }

  /** QA helper: live pickups by kind. */
  list(): Array<{ x: number; z: number; kind: PickupKind }> {
    const out: Array<{ x: number; z: number; kind: PickupKind }> = [];
    for (let i = 0; i < CAPACITY; i++) {
      if (this.alive[i]) out.push({ x: this.posX[i], z: this.posZ[i], kind: KINDS[this.kind[i]] });
    }
    return out;
  }

  clear(): void {
    for (let i = 0; i < CAPACITY; i++) {
      if (this.alive[i]) {
        this.batch.hide(i);
        this.shadowBatch.hide(i);
      }
      this.alive[i] = 0;
    }
    this.pool.reset();
    this.batch.commit();
    this.shadowBatch.commit();
  }

  dispose(): void {
    this.batch.dispose();
    this.shadowBatch.dispose();
  }
}
