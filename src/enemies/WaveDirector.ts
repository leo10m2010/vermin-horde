import { MathUtils } from 'three';
import { DIFFICULTY, WORLD } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import type { EnemyManager } from '../entities/EnemyManager';
import { luckScaledChance } from '../utils/luck';
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
  /**
   * Seconds left of the current attack's wind-up. While > 0 the boss holds
   * its `special` charge pose; when it hits 0 it snaps to its `attack` pose.
   * This is purely presentational - it spans the SAME telegraph delay the
   * attack already used, so nothing about damage, radius or timing changes.
   */
  windup: number;
  /** Length of the strike pose once the wind-up resolves. */
  strikeDuration: number;
}

const ELITE_OPTS = { elite: true, hpMult: 6, speedMult: 1.15, scaleMult: 1.4 } as const;

// Reserve some capacity headroom so a big spawn burst never starves other
// systems (gems/projectiles share the same frame budget) or hard-fails mid loop.
const SPAWN_CAPACITY_RESERVE = 20;
const MAX_SPAWNS_PER_FRAME = 60;

const ROT_KING_ATTACK_INTERVAL = 3.5;
const BONE_COLOSSUS_ATTACK_INTERVAL = 4.0;
const DUSKFANG_ATTACK_INTERVAL = 2.6;

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
      { typeId: types.ghoul, weight: 12, unlockAt: 120 },
      { typeId: types.gargoyle, weight: 7, unlockAt: 240 },
    ];

    this.bossNameByTypeId = new Map([
      [types.rotKing, 'Rot King'],
      [types.boneColossus, 'Bone Colossus'],
      [types.duskfang, 'Duskfang'],
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

  update(dt: number, elapsedSeconds: number, playerX: number, playerZ: number, luck = 0): void {
    this.lastPlayerX = playerX;
    this.lastPlayerZ = playerZ;

    this.updateTrashSpawning(dt, elapsedSeconds, playerX, playerZ, luck);
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

  private updateTrashSpawning(dt: number, elapsedSeconds: number, playerX: number, playerZ: number, luck: number): void {
    const rampT = MathUtils.clamp(elapsedSeconds / DIFFICULTY.rampSeconds, 0, 1);
    const rate = MathUtils.lerp(DIFFICULTY.spawnBudgetStart, DIFFICULTY.spawnBudgetEnd, rampT);
    const baseEliteChance = MathUtils.lerp(DIFFICULTY.eliteChanceStart, DIFFICULTY.eliteChanceEnd, rampT);
    // Luck scales elite odds the same way it scales rare-drop weight in VS
    // (chance x TotalLuck) - a lucky build meets tougher, more rewarding
    // fights more often instead of luck being a purely passive stat.
    const eliteChance = luckScaledChance(baseEliteChance, luck, 0.6);
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
    const slot = i % 3; // 0 = Rot King, 1 = Bone Colossus, 2 = Duskfang
    const repeatTier = Math.floor(i / 3);
    const typeId = slot === 0 ? this.types.rotKing : slot === 1 ? this.types.boneColossus : this.types.duskfang;
    const name = slot === 0 ? 'Rot King' : slot === 1 ? 'Bone Colossus' : 'Duskfang';
    const attackInterval = slot === 0 ? ROT_KING_ATTACK_INTERVAL : slot === 1 ? BONE_COLOSSUS_ATTACK_INTERVAL : DUSKFANG_ATTACK_INTERVAL;
    // Every lap through the three boss types, scale them up so repeat
    // encounters (we only have 3 boss types but 4 scheduled boss waves)
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
      attackTimer: attackInterval,
      windup: 0,
      strikeDuration: 0,
    });
    gameEvents.emit('bossSpawned', { name, x, z });
  }

  private updateBossAttacks(dt: number, playerX: number, playerZ: number): void {
    for (const [index, state] of this.bossStates) {
      if (!this.enemies.alive[index]) {
        this.bossStates.delete(index);
        continue;
      }

      // Hold the charge pose for the whole wind-up, then snap to the strike.
      // A boss that reads as a boss has to visibly commit to its attack -
      // before this pass the telegraph ring appeared on the ground while the
      // boss itself just kept walking, which is what made bosses look like
      // oversized trash mobs.
      if (state.windup > 0) {
        state.windup -= dt;
        if (state.windup <= 0) this.enemies.requestPose(index, 'attack', state.strikeDuration);
        else this.enemies.requestPose(index, 'special', 0.2);
      }

      state.attackTimer -= dt;
      if (state.attackTimer <= 0) {
        if (state.typeId === this.types.rotKing) {
          state.attackTimer = ROT_KING_ATTACK_INTERVAL;
          this.triggerRotKingAttack(index, state, playerX, playerZ);
        } else if (state.typeId === this.types.boneColossus) {
          state.attackTimer = BONE_COLOSSUS_ATTACK_INTERVAL;
          this.triggerBoneColossusAttack(state, playerX, playerZ);
        } else {
          state.attackTimer = DUSKFANG_ATTACK_INTERVAL;
          this.triggerDuskfangAttack(index, state, playerX, playerZ);
        }
      }
    }
  }

  private triggerRotKingAttack(index: number, state: BossState, playerX: number, playerZ: number): void {
    if (this.rng() < 0.5) {
      // Ground slam, centered on the boss itself.
      this.queueTelegraph(this.enemies.posX[index], this.enemies.posZ[index], 4, 1.0, 26, '#ff6a3d');
      // Scepter goes overhead for the full 1.0s ring, then drives into the ground.
      state.windup = 1.0;
    } else {
      // Telegraphed circle centered on the player's current position.
      this.queueTelegraph(playerX, playerZ, 2.5, 0.9, 20, '#ff3d6a');
      state.windup = 0.9;
    }
    state.strikeDuration = 0.5;
  }

  private triggerBoneColossusAttack(state: BossState, playerX: number, playerZ: number): void {
    for (let k = 0; k < 3; k++) {
      const angle = this.rng() * Math.PI * 2;
      const dist = this.rng() * 6;
      const x = playerX + Math.cos(angle) * dist;
      const z = playerZ + Math.sin(angle) * dist;
      const delay = 0.8 + k * 0.15;
      this.queueTelegraph(x, z, 2, delay, 18, '#c9c2a8');
    }
    // Arms stay raised summoning for the first ring's delay, then slam wide as
    // the shards start landing.
    state.windup = 0.8;
    state.strikeDuration = 0.6;
  }

  /**
   * Pounce Combo: three quick telegraphs advancing in a line from Duskfang's
   * current position out through (and past) the player's current position,
   * with a shrinking delay per step. Reads as a predator accelerating into a
   * bite chain - a sweeping line of hits rather than one big circle (Rot
   * King) or a scatter of circles (Bone Colossus). Individually small and
   * dodgeable, but punishes standing still since all three converge on the
   * same line.
   */
  private triggerDuskfangAttack(index: number, state: BossState, playerX: number, playerZ: number): void {
    // windup -> pounce -> landing. The 0.85s wind-up spans the first
    // telegraph's delay (the hound coils, haunches up, chest to the floor),
    // then the attack clip carries the pounce and its landing across the two
    // faster follow-up steps of the combo.
    state.windup = 0.85;
    state.strikeDuration = 0.85;
    const bx = this.enemies.posX[index];
    const bz = this.enemies.posZ[index];
    const dx = playerX - bx;
    const dz = playerZ - bz;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const delays = [0.85, 0.55, 0.3];
    for (let k = 0; k < 3; k++) {
      const stepDist = 2.5 + k * 2.5; // steps out from the boss, through and past the player
      const x = bx + dirX * stepDist;
      const z = bz + dirZ * stepDist;
      this.queueTelegraph(x, z, 1.6, delays[k], 13, '#7ef7ff');
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
