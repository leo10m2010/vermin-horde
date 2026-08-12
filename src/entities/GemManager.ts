import { IndexPool } from '../core/ObjectPool';
import { LAYER_Y, POOL_CAPACITY } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import { InstancedBillboardBatch } from '../render/InstancedBillboardBatch';
import { spriteAtlas } from '../render/SpriteAtlas';

// Exported so sibling VFX (GemCollectEffect) can mirror the exact same
// value -> tier -> color mapping without duplicating the table.
//
// Thresholds are tuned against this roster's actual xpValue spread (trash
// mobs: 1-5, bosses: 50-80 - see src/enemies/EnemyTypes.ts), not arbitrary
// round numbers. The old thresholds (1/5/25/100) left the top gold tier
// completely unreachable (no enemy hits 100) and collapsed every trash mob
// except brute AND every boss into the same two tiers, so a grunt's gem
// looked identical to a ghost's, and Rot King/Duskfang/Bone Colossus all
// looked identical to EACH OTHER despite giving very different XP. Real
// Vampire Survivors keeps only 3 gem colors for the same reason: a tier is
// meant to read as "this kill's weight class," not a unique value per
// source - but every weight class in OUR roster should actually be reachable.
export const GEM_TIERS: Array<{ value: number; tint: [number, number, number]; size: number }> = [
  { value: 1, tint: [0.5, 0.85, 1], size: 0.55 }, // lightest chaff: grunt, bat
  { value: 2, tint: [0.55, 1, 0.6], size: 0.7 }, // mid trash: skeleton, wolf, ghost, spitter, ghoul, slime, gargoyle
  { value: 5, tint: [1, 0.55, 0.95], size: 0.85 }, // heaviest trash: brute
  { value: 40, tint: [1, 0.8, 0.3], size: 1.15 }, // any boss - always the top tier, distinctly bigger than the rest
];

export function tierFor(value: number): number {
  let tier = 0;
  for (let i = 0; i < GEM_TIERS.length; i++) if (value >= GEM_TIERS[i].value) tier = i;
  return tier;
}

// Spawn-pop tuning: gems scale in from nothing, overshoot past full size,
// then settle - reads as a little "pop" rather than an instant appearance.
const SPAWN_POP_DURATION = 0.22; // seconds
const SPAWN_POP_OVERSHOOT = 1.25; // peak scale multiplier mid-pop

/** 0 (just spawned) -> settled(1.0), via a two-segment lerp overshoot: 0 -> 1.25 -> 1.0. */
function spawnPopScale(remaining: number): number {
  if (remaining <= 0) return 1;
  const t = 1 - remaining / SPAWN_POP_DURATION;
  if (t < 0.6) return (t / 0.6) * SPAWN_POP_OVERSHOOT;
  const t2 = (t - 0.6) / 0.4;
  return SPAWN_POP_OVERSHOOT + (1 - SPAWN_POP_OVERSHOOT) * t2;
}

/** Pooled XP gems: spawn on enemy death, drift toward the player once inside magnet range, collected on contact. */
export class GemManager {
  readonly capacity = POOL_CAPACITY.gems;
  readonly pool = new IndexPool(this.capacity);
  readonly batch: InstancedBillboardBatch;

  readonly posX = new Float32Array(this.capacity);
  readonly posZ = new Float32Array(this.capacity);
  readonly value = new Float32Array(this.capacity);
  readonly alive = new Uint8Array(this.capacity);
  readonly bobPhase = new Float32Array(this.capacity);
  readonly magnetized = new Uint8Array(this.capacity);
  /** Counts down from SPAWN_POP_DURATION to 0; drives the spawn scale-in pop. */
  readonly spawnTimer = new Float32Array(this.capacity);

  constructor() {
    this.batch = new InstancedBillboardBatch(this.capacity, spriteAtlas.texture, 'gems');
    gameEvents.on('enemyKilled', (e) => this.spawn(e.x, e.z, e.xpValue));
  }

  spawn(x: number, z: number, value: number): number {
    const index = this.pool.acquire();
    if (index === -1) return -1;
    this.posX[index] = x + (Math.random() - 0.5) * 0.6;
    this.posZ[index] = z + (Math.random() - 0.5) * 0.6;
    this.value[index] = value;
    this.alive[index] = 1;
    this.bobPhase[index] = Math.random() * 10;
    this.magnetized[index] = 0;
    this.spawnTimer[index] = SPAWN_POP_DURATION;
    return index;
  }

  private despawn(index: number): void {
    this.alive[index] = 0;
    this.batch.hide(index);
    this.pool.release(index);
  }

  update(dt: number, _elapsed: number, playerX: number, playerZ: number, magnetRadius: number, collectRadius: number): number {
    let xpCollected = 0;
    const uv = spriteAtlas.hasClip('gem_basic') ? spriteAtlas.getUV(spriteAtlas.getClip('gem_basic').cells[0]) : spriteAtlas.getUV(0);

    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      const dx = playerX - this.posX[i];
      const dz = playerZ - this.posZ[i];
      const distSq = dx * dx + dz * dz;

      if (distSq < collectRadius * collectRadius) {
        xpCollected += this.value[i];
        gameEvents.emit('gemCollected', { x: this.posX[i], z: this.posZ[i], value: this.value[i] });
        this.despawn(i);
        continue;
      }

      if (!this.magnetized[i] && distSq < magnetRadius * magnetRadius) this.magnetized[i] = 1;

      // Advance the idle bob phase continuously (even while magnetized) so
      // the sparkle pulse below keeps animating instead of freezing mid-flight.
      this.bobPhase[i] += dt;

      if (this.magnetized[i]) {
        const dist = Math.sqrt(distSq) || 1;
        const pull = Math.min(22, 4 + (magnetRadius - dist) * 0.6 + (1 / Math.max(dist, 0.4)) * 6);
        this.posX[i] += (dx / dist) * pull * dt;
        this.posZ[i] += (dz / dist) * pull * dt;
      }

      if (this.spawnTimer[i] > 0) this.spawnTimer[i] = Math.max(0, this.spawnTimer[i] - dt);

      const tier = GEM_TIERS[tierFor(this.value[i])];
      const bob = Math.sin(this.bobPhase[i] * 3) * 0.06;

      // Idle sparkle: a gentle brightness pulse so unclaimed gems read as
      // "alive" rather than static props. While magnetized and inbound, the
      // pulse speeds up and brightens slightly as a "coming in hot" cue.
      const magnetHot = this.magnetized[i];
      const pulseFreq = magnetHot ? 11 : 5;
      const pulseAmp = magnetHot ? 0.25 : 0.15;
      let pulse = 1 + pulseAmp * Math.sin(this.bobPhase[i] * pulseFreq) + (magnetHot ? 0.08 : 0);
      pulse = Math.min(1.4, Math.max(0.7, pulse));

      const scale = tier.size * spawnPopScale(this.spawnTimer[i]);

      this.batch.set(
        i,
        this.posX[i],
        LAYER_Y.gem + bob,
        this.posZ[i],
        uv,
        scale,
        scale,
        tier.tint[0] * pulse,
        tier.tint[1] * pulse,
        tier.tint[2] * pulse,
        1,
        0,
      );
    }

    this.batch.commit();
    return xpCollected;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i]) this.batch.hide(i);
      this.alive[i] = 0;
    }
    this.pool.reset();
    this.batch.commit();
  }

  dispose(): void {
    this.batch.dispose();
  }
}
