import { MathUtils } from 'three';
import { DIFFICULTY, WORLD } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import type { EnemyManager } from '../entities/EnemyManager';
import type { EnemyTypeIds } from './EnemyTypes';
import { pendingTelegraphs } from './EnemyTypes';

interface TrashEntry {
  typeId: number;
  weight: number;
  unlockAt: number;
}

interface BossState {
  typeId: number;
  name: string;
  attackTimer: number;
}

const ELITE_OPTS = { elite: true, hpMult: 6, speedMult: 1.15, scaleMult: 1.4 } as const;

// Reserve some capacity headroom so a big spawn burst never starves other
// systems (gems/projectiles share the same frame budget) or hard-fails mid loop.
const SPAWN_CAPACITY_RESERVE = 20;
const MAX_SPAWNS_PER_FRAME = 60;

const ROT_KING_ATTACK_INTERVAL = 3.5;
const BONE_COLOSSUS_ATTACK_INTERVAL = 4.0;

/**
 * Drives trash-mob spawning (budget + elite rolls + type-mix ramp), boss
 * auto-spawn scheduling, and boss attack telegraph/resolution. Trash and
 * boss enemies are both spawned through the shared EnemyManager pool; boss
 * attack damage flows out via `enemyAttackRequest` (director wires that to
 * the player), never touching player health directly.
 */
export class WaveDirector {
  private readonly trashRoster: TrashEntry[];
  private readonly bossNameByTypeId: Map<number, string>;

  private budget = 0;
  private spawnedBossCount = 0;
  private readonly bossStates = new Map<number, BossState>();
  private lastPlayerX = 0;
  private lastPlayerZ = 0;
  /** Minute markers already announced via `waveEscalated`, so each fires exactly once per run. */
  private lastAnnouncedMinute = 0;

  constructor(
    private readonly enemies: EnemyManager,
    private readonly types: EnemyTypeIds,
    private readonly rng: () => number,
  ) {
    this.trashRoster = [
      { typeId: types.grunt, weight: 30, unlockAt: 0 },
      { typeId: types.bat, weight: 20, unlockAt: 0 },
      { typeId: types.skeleton, weight: 15, unlockAt: 60 },
      { typeId: types.wolf, weight: 15, unlockAt: 90 },
      { typeId: types.slime, weight: 10, unlockAt: 150 },
      { typeId: types.ghost, weight: 10, unlockAt: 210 },
      { typeId: types.spitter, weight: 8, unlockAt: 270 },
      { typeId: types.brute, weight: 5, unlockAt: 300 },
    ];

    this.bossNameByTypeId = new Map([
      [types.rotKing, 'Rot King'],
      [types.boneColossus, 'Bone Colossus'],
    ]);

    gameEvents.on('enemyKilled', (e) => {
      if (!e.isBoss) return;
      let deadIndex = -1;
      for (const [index, state] of this.bossStates) {
        if (state.typeId === e.typeId) {
          deadIndex = index;
          break;
        }
      }
      const name = deadIndex !== -1 ? this.bossStates.get(deadIndex)!.name : this.bossNameByTypeId.get(e.typeId) ?? 'Boss';
      if (deadIndex !== -1) this.bossStates.delete(deadIndex);
      gameEvents.emit('bossKilled', { name, x: e.x, z: e.z });
    });
  }

  update(dt: number, elapsedSeconds: number, playerX: number, playerZ: number): void {
    this.lastPlayerX = playerX;
    this.lastPlayerZ = playerZ;

    this.updateTrashSpawning(dt, elapsedSeconds, playerX, playerZ);
    this.updateBossSchedule(elapsedSeconds, playerX, playerZ);
    this.updateBossAttacks(dt, playerX, playerZ);
    this.drainPendingTelegraphs(dt, playerX, playerZ);
    this.updateEscalationAnnouncements(elapsedSeconds);
  }

  /** Announce each new survived minute once, so difficulty ramp-up is legible instead of silent. */
  private updateEscalationAnnouncements(elapsedSeconds: number): void {
    const minute = Math.floor(elapsedSeconds / 60);
    if (minute > this.lastAnnouncedMinute) {
      this.lastAnnouncedMinute = minute;
      if (minute > 0) gameEvents.emit('waveEscalated', { minute });
    }
  }

  forceBoss(): void {
    this.spawnNextBoss(this.lastPlayerX, this.lastPlayerZ);
  }

  reset(): void {
    this.budget = 0;
    this.spawnedBossCount = 0;
    this.bossStates.clear();
    this.lastPlayerX = 0;
    this.lastPlayerZ = 0;
    this.lastAnnouncedMinute = 0;
    pendingTelegraphs.length = 0;
  }

  // --- trash mobs ---

  private updateTrashSpawning(dt: number, elapsedSeconds: number, playerX: number, playerZ: number): void {
    const rampT = MathUtils.clamp(elapsedSeconds / DIFFICULTY.rampSeconds, 0, 1);
    const rate = MathUtils.lerp(DIFFICULTY.spawnBudgetStart, DIFFICULTY.spawnBudgetEnd, rampT);
    const eliteChance = MathUtils.lerp(DIFFICULTY.eliteChanceStart, DIFFICULTY.eliteChanceEnd, rampT);
    this.budget += rate * dt;

    let guard = 0;
    while (guard < MAX_SPAWNS_PER_FRAME && this.budget >= 1 && this.enemies.activeCount < this.enemies.capacity - SPAWN_CAPACITY_RESERVE) {
      guard++;
      const typeId = this.pickTrashType(elapsedSeconds);
      const cost = this.enemies.getType(typeId).xpValue;
      if (cost > this.budget) continue;
      this.budget -= cost;

      const { x, z } = this.spawnPositionAround(playerX, playerZ);
      const elite = this.rng() < eliteChance;
      this.enemies.spawn(typeId, x, z, elite ? ELITE_OPTS : undefined);
    }
  }

  private pickTrashType(elapsedSeconds: number): number {
    let totalWeight = 0;
    for (const entry of this.trashRoster) {
      if (elapsedSeconds >= entry.unlockAt) totalWeight += entry.weight;
    }
    if (totalWeight <= 0) return this.trashRoster[0].typeId;

    let roll = this.rng() * totalWeight;
    for (const entry of this.trashRoster) {
      if (elapsedSeconds < entry.unlockAt) continue;
      roll -= entry.weight;
      if (roll <= 0) return entry.typeId;
    }
    return this.trashRoster[0].typeId;
  }

  private spawnPositionAround(playerX: number, playerZ: number): { x: number; z: number } {
    const angle = this.rng() * Math.PI * 2;
    const dist = 13 + this.rng() * 4; // 13-17 units, matches the temp spawner's ring
    const x = MathUtils.clamp(playerX + Math.cos(angle) * dist, -WORLD.halfExtent, WORLD.halfExtent);
    const z = MathUtils.clamp(playerZ + Math.sin(angle) * dist, -WORLD.halfExtent, WORLD.halfExtent);
    return { x, z };
  }

  // --- bosses ---

  private updateBossSchedule(elapsedSeconds: number, playerX: number, playerZ: number): void {
    const times = DIFFICULTY.bossTimesSeconds;
    while (this.spawnedBossCount < times.length && elapsedSeconds >= times[this.spawnedBossCount]) {
      this.spawnNextBoss(playerX, playerZ);
    }
  }

  private spawnNextBoss(playerX: number, playerZ: number): void {
    const i = this.spawnedBossCount;
    const isRotKing = i % 2 === 0;
    const repeatTier = Math.floor(i / 2);
    const typeId = isRotKing ? this.types.rotKing : this.types.boneColossus;
    const name = isRotKing ? 'Rot King' : 'Bone Colossus';
    // Every second lap through the two boss types, scale them up so repeat
    // encounters (we only have 2 boss types but 4 scheduled boss waves)
    // still read as an escalation rather than a rerun.
    const hpMult = 1 + repeatTier * 0.6;
    const speedMult = 1 + repeatTier * 0.08;

    const angle = this.rng() * Math.PI * 2;
    const dist = 10;
    const x = MathUtils.clamp(playerX + Math.cos(angle) * dist, -WORLD.halfExtent, WORLD.halfExtent);
    const z = MathUtils.clamp(playerZ + Math.sin(angle) * dist, -WORLD.halfExtent, WORLD.halfExtent);

    const index = this.enemies.spawn(typeId, x, z, { boss: true, hpMult, speedMult });
    this.spawnedBossCount++;
    if (index === -1) return; // pool exhausted; skip this wave rather than spin forever

    this.bossStates.set(index, {
      typeId,
      name,
      attackTimer: isRotKing ? ROT_KING_ATTACK_INTERVAL : BONE_COLOSSUS_ATTACK_INTERVAL,
    });
    gameEvents.emit('bossSpawned', { name, x, z });
  }

  private updateBossAttacks(dt: number, playerX: number, playerZ: number): void {
    for (const [index, state] of this.bossStates) {
      if (!this.enemies.alive[index]) {
        this.bossStates.delete(index);
        continue;
      }
      state.attackTimer -= dt;
      if (state.attackTimer <= 0) {
        if (state.typeId === this.types.rotKing) {
          state.attackTimer = ROT_KING_ATTACK_INTERVAL;
          this.triggerRotKingAttack(index, playerX, playerZ);
        } else {
          state.attackTimer = BONE_COLOSSUS_ATTACK_INTERVAL;
          this.triggerBoneColossusAttack(playerX, playerZ);
        }
      }
    }
  }

  private triggerRotKingAttack(index: number, playerX: number, playerZ: number): void {
    if (this.rng() < 0.5) {
      // Ground slam, centered on the boss itself.
      this.queueTelegraph(this.enemies.posX[index], this.enemies.posZ[index], 4, 1.0, 26, '#ff6a3d');
    } else {
      // Telegraphed circle centered on the player's current position.
      this.queueTelegraph(playerX, playerZ, 2.5, 0.9, 20, '#ff3d6a');
    }
  }

  private triggerBoneColossusAttack(playerX: number, playerZ: number): void {
    for (let k = 0; k < 3; k++) {
      const angle = this.rng() * Math.PI * 2;
      const dist = this.rng() * 6;
      const x = playerX + Math.cos(angle) * dist;
      const z = playerZ + Math.sin(angle) * dist;
      const delay = 0.8 + k * 0.15;
      this.queueTelegraph(x, z, 2, delay, 18, '#c9c2a8');
    }
  }

  private queueTelegraph(x: number, z: number, radius: number, delaySeconds: number, damage: number, color: string): void {
    gameEvents.emit('bossTelegraph', { x, z, radius, delaySeconds, color });
    pendingTelegraphs.push({ x, z, radius, damage, remaining: delaySeconds });
  }

  // --- shared telegraph resolution (boss + spitter attacks both land here) ---

  private drainPendingTelegraphs(dt: number, playerX: number, playerZ: number): void {
    for (let i = pendingTelegraphs.length - 1; i >= 0; i--) {
      const t = pendingTelegraphs[i];
      t.remaining -= dt;
      if (t.remaining <= 0) {
        const dx = playerX - t.x;
        const dz = playerZ - t.z;
        if (dx * dx + dz * dz <= t.radius * t.radius) {
          gameEvents.emit('enemyAttackRequest', { damage: t.damage, x: t.x, z: t.z });
        }
        pendingTelegraphs.splice(i, 1);
      }
    }
  }
}
