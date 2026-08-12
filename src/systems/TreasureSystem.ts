import { IndexPool } from '../core/ObjectPool';
import { LAYER_Y, POOL_CAPACITY } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import type { PlayerStats } from '../game/GameState';
import { InstancedBillboardBatch } from '../render/InstancedBillboardBatch';
import { advanceAnimFrame, spriteAtlas } from '../render/SpriteAtlas';
import { luckScaledChance } from '../utils/luck';
import type { UpgradeSystem } from './UpgradeSystem';

const SPAWN_POP_DURATION = 0.3;
const SPAWN_POP_OVERSHOOT = 1.3;
const SIZE = 1.5;

// Base (zero-luck) odds an elite drops a cache at all, then - once one drops -
// the odds it rolls the 5-pick or 3-pick tier instead of the 1-pick default.
// Mirrors VS: Luck scales both "does a reward happen" and "how big is it".
const ELITE_DROP_CHANCE = 0.16;
const BOSS_DROP_CHANCE = 1; // a boss kill always drops one - it's the run's biggest moment
const TIER5_CHANCE = 0.06;
const TIER3_CHANCE = 0.28;

/**
 * Gilded Cache: a rare pickup that drops from elite/boss kills and, when
 * collected, instantly grants several free upgrade picks (reusing
 * UpgradeSystem's weighted pool) instead of one. Luck scales three
 * independent rolls here - whether it drops, how many picks it grants, and
 * (via UpgradeSystem itself) which picks are more likely - the same
 * "TotalLuck multiplies chance" pattern documented for VS's Luck stat.
 * Struct-of-arrays + one InstancedBillboardBatch, same shape as GemManager.
 */
export class TreasureSystem {
  readonly capacity = POOL_CAPACITY.treasures;
  readonly pool = new IndexPool(this.capacity);
  readonly batch: InstancedBillboardBatch;

  private readonly posX = new Float32Array(this.capacity);
  private readonly posZ = new Float32Array(this.capacity);
  private readonly alive = new Uint8Array(this.capacity);
  private readonly animTimer = new Float32Array(this.capacity);
  private readonly spawnTimer = new Float32Array(this.capacity);

  /** Latest per-frame luck, refreshed via setLuck() before enemyKilled can fire this frame. */
  private cachedLuck = 0;

  constructor(
    private readonly upgrades: UpgradeSystem,
    private readonly rng: () => number,
  ) {
    this.batch = new InstancedBillboardBatch(this.capacity, spriteAtlas.texture, 'treasures');
    gameEvents.on('enemyKilled', (e) => {
      if (e.isBoss) {
        if (this.rng() < BOSS_DROP_CHANCE) this.spawn(e.x, e.z);
      } else if (e.isElite) {
        if (this.rng() < luckScaledChance(ELITE_DROP_CHANCE, this.cachedLuck, 0.6)) this.spawn(e.x, e.z);
      }
    });
  }

  /** Call once per frame, before enemies.update(), so a same-frame elite/boss kill rolls against current luck. */
  setLuck(luck: number): void {
    this.cachedLuck = luck;
  }

  private spawn(x: number, z: number): void {
    const index = this.pool.acquire();
    if (index === -1) return;
    this.posX[index] = x;
    this.posZ[index] = z;
    this.alive[index] = 1;
    this.animTimer[index] = Math.random() * 4;
    this.spawnTimer[index] = SPAWN_POP_DURATION;
    gameEvents.emit('treasureSpawned', { x, z });
  }

  private despawn(index: number): void {
    this.alive[index] = 0;
    this.batch.hide(index);
    this.pool.release(index);
  }

  update(
    dt: number,
    playerX: number,
    playerZ: number,
    magnetRadius: number,
    collectRadius: number,
    ownedPassives: Map<string, number>,
    stats: PlayerStats,
  ): void {
    const hasClip = spriteAtlas.hasClip('treasure_cache');
    const clip = hasClip ? spriteAtlas.getClip('treasure_cache') : null;

    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      const dx = playerX - this.posX[i];
      const dz = playerZ - this.posZ[i];
      const distSq = dx * dx + dz * dz;

      if (distSq < collectRadius * collectRadius) {
        this.resolveChest(this.posX[i], this.posZ[i], ownedPassives, stats);
        this.despawn(i);
        continue;
      }

      this.animTimer[i] += dt;
      if (this.spawnTimer[i] > 0) this.spawnTimer[i] = Math.max(0, this.spawnTimer[i] - dt);

      if (distSq < magnetRadius * magnetRadius) {
        const dist = Math.sqrt(distSq) || 1;
        const pull = Math.min(20, 4 + (magnetRadius - dist) * 0.5);
        this.posX[i] += (dx / dist) * pull * dt;
        this.posZ[i] += (dz / dist) * pull * dt;
      }

      const t = this.spawnTimer[i] / SPAWN_POP_DURATION;
      const pop = this.spawnTimer[i] <= 0 ? 1 : t > 0.6 ? ((1 - t) / 0.4) * (1 - SPAWN_POP_OVERSHOOT) + SPAWN_POP_OVERSHOOT : (1 - t / 0.6) * SPAWN_POP_OVERSHOOT;
      const bob = Math.sin(this.animTimer[i] * 2.2) * 0.05;
      const glow = 1 + Math.sin(this.animTimer[i] * 3) * 0.15;

      const uv = clip ? spriteAtlas.getUV(advanceAnimFrame(clip, this.animTimer[i], 0).cellIndex) : spriteAtlas.getUV(0);
      const size = SIZE * pop;
      this.batch.set(i, this.posX[i], LAYER_Y.gem + bob, this.posZ[i], uv, size, size, glow, glow * 0.92, glow * 0.6, 1, 0);
    }

    this.batch.commit();
  }

  private resolveChest(x: number, z: number, ownedPassives: Map<string, number>, stats: PlayerStats): void {
    const luck = this.cachedLuck;
    const tier = this.rollTier(luck);
    const options = this.upgrades.rollChoices(this.rng, ownedPassives, tier, luck, false);
    const rewardNames: string[] = [];
    for (const option of options) {
      this.upgrades.apply(option, stats, ownedPassives);
      rewardNames.push(option.name);
    }
    const bonusGold = Math.round((20 + tier * 15) * (1 + luck));
    gameEvents.emit('treasureOpened', { x, z, tier: options.length, rewardNames, bonusGold });
  }

  private rollTier(luck: number): number {
    if (this.rng() < luckScaledChance(TIER5_CHANCE, luck, 0.5)) return 5;
    if (this.rng() < luckScaledChance(TIER3_CHANCE, luck, 0.75)) return 3;
    return 1;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i]) this.batch.hide(i);
      this.alive[i] = 0;
      this.spawnTimer[i] = 0;
    }
    this.pool.reset();
    this.batch.commit();
  }

  dispose(): void {
    this.batch.dispose();
  }
}
