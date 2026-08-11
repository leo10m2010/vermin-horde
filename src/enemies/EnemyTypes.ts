import { gameEvents } from '../core/EventBus';
import type { EnemyBehavior, EnemyManager } from '../entities/EnemyManager';

/**
 * Type ids returned by registerEnemyTypes(), in stable field order. Director
 * wires spawning/UI/etc. against these ids instead of magic numbers.
 */
export interface EnemyTypeIds {
  grunt: number;
  bat: number;
  skeleton: number;
  slime: number;
  wolf: number;
  ghost: number;
  brute: number;
  spitter: number;
  rotKing: number;
  boneColossus: number;
}

/**
 * A telegraphed attack in flight: shown immediately via `bossTelegraph`, then
 * resolved after `remaining` seconds elapse by checking distance to the
 * player's position AT RESOLUTION TIME. Shared between boss attacks (pushed
 * by WaveDirector) and spitter attacks (pushed by the spitter behavior below)
 * so one drain loop in WaveDirector.update() handles both.
 */
export interface PendingTelegraph {
  x: number;
  z: number;
  radius: number;
  damage: number;
  remaining: number;
}

export const pendingTelegraphs: PendingTelegraph[] = [];

// Deterministic per-instance phase spread (golden-angle stepping) so a horde
// of the same enemy type doesn't wobble in lockstep - avoids needing a seeded
// rng inside per-instance init, which registerEnemyTypes() isn't given.
function goldenPhase(index: number): number {
  return (index * 2.399963) % (Math.PI * 2);
}

function makeWobbleChase(freq: number, amplitude: number, phase: Float32Array): EnemyBehavior {
  return (i, _dt, mgr, px, pz) => {
    const dx = px - mgr.posX[i];
    const dz = pz - mgr.posZ[i];
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const perpX = -dirZ;
    const perpZ = dirX;
    const t = mgr.animTimer[i] + phase[i];
    const wobble = Math.sin(t * freq) * amplitude;
    const speed = mgr.speed[i];
    mgr.velX[i] = dirX * speed + perpX * wobble;
    mgr.velZ[i] = dirZ * speed + perpZ * wobble;
  };
}

function makeGhostBehavior(phase: Float32Array): EnemyBehavior {
  return (i, _dt, mgr, px, pz) => {
    const dx = px - mgr.posX[i];
    const dz = pz - mgr.posZ[i];
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const perpX = -dirZ;
    const perpZ = dirX;
    const t = mgr.animTimer[i] + phase[i];
    const wobble = Math.sin(t * 1.6) * 0.6;
    const speedPulse = 1 + Math.sin(t * 0.9) * 0.2;
    const speed = mgr.speed[i] * speedPulse;
    mgr.velX[i] = dirX * speed + perpX * wobble;
    mgr.velZ[i] = dirZ * speed + perpZ * wobble;
  };
}

const SPITTER_MIN_RANGE = 6;
const SPITTER_MAX_RANGE = 8;
const SPITTER_ATTACK_INTERVAL = 2.2;
const SPITTER_TELEGRAPH_RADIUS = 1.6;
const SPITTER_TELEGRAPH_DELAY = 0.7;
const SPITTER_ATTACK_DAMAGE = 9;

function makeSpitterBehavior(cooldown: Float32Array): EnemyBehavior {
  return (i, dt, mgr, px, pz) => {
    const dx = px - mgr.posX[i];
    const dz = pz - mgr.posZ[i];
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const speed = mgr.speed[i];

    if (dist < SPITTER_MIN_RANGE) {
      // Too close: back off.
      mgr.velX[i] = -dirX * speed;
      mgr.velZ[i] = -dirZ * speed;
    } else if (dist > SPITTER_MAX_RANGE) {
      // Too far: close the gap.
      mgr.velX[i] = dirX * speed;
      mgr.velZ[i] = dirZ * speed;
    } else {
      // In range: strafe perpendicular, direction stable per-instance.
      const perpX = -dirZ;
      const perpZ = dirX;
      const sign = i % 2 === 0 ? 1 : -1;
      mgr.velX[i] = perpX * speed * 0.6 * sign;
      mgr.velZ[i] = perpZ * speed * 0.6 * sign;
    }

    if (dist <= SPITTER_MAX_RANGE) {
      cooldown[i] -= dt;
      if (cooldown[i] <= 0) {
        cooldown[i] = SPITTER_ATTACK_INTERVAL;
        gameEvents.emit('bossTelegraph', {
          x: px,
          z: pz,
          radius: SPITTER_TELEGRAPH_RADIUS,
          delaySeconds: SPITTER_TELEGRAPH_DELAY,
          color: '#8ee06b',
        });
        pendingTelegraphs.push({
          x: px,
          z: pz,
          radius: SPITTER_TELEGRAPH_RADIUS,
          damage: SPITTER_ATTACK_DAMAGE,
          remaining: SPITTER_TELEGRAPH_DELAY,
        });
      }
    }
  };
}

/**
 * Registers every enemy/boss type the roster needs against a fresh
 * EnemyManager and returns the resulting type ids. Call once per Game
 * instance, before any spawning happens (mirrors the old
 * Game.registerTemporaryContent() grunt registration exactly, so existing
 * balance/tests keyed to it keep working).
 */
export function registerEnemyTypes(enemies: EnemyManager): EnemyTypeIds {
  const capacity = enemies.capacity;

  const batPhase = new Float32Array(capacity);
  const ghostPhase = new Float32Array(capacity);
  const spitterCooldown = new Float32Array(capacity);

  const grunt = enemies.registerType({
    name: 'grunt',
    walkClip: 'enemy_grunt_walk',
    hp: 18,
    speed: 2.6,
    contactDamage: 8,
    radius: 0.5,
    spriteSize: 1.3,
    xpValue: 1,
    contactCooldown: 0.6,
    tint: [1, 1, 1],
  });

  const bat = enemies.registerType({
    name: 'bat',
    walkClip: 'enemy_bat_walk',
    hp: 10,
    speed: 4.6,
    contactDamage: 5,
    radius: 0.4,
    spriteSize: 1.0,
    xpValue: 1,
    contactCooldown: 0.5,
    tint: [1, 1, 1],
    behavior: makeWobbleChase(5, 2.5, batPhase),
    onSpawn: (index) => {
      batPhase[index] = goldenPhase(index);
    },
  });

  const skeleton = enemies.registerType({
    name: 'skeleton',
    walkClip: 'enemy_skeleton_walk',
    hp: 40,
    speed: 2.0,
    contactDamage: 12,
    radius: 0.55,
    spriteSize: 1.4,
    xpValue: 2,
    contactCooldown: 0.7,
    tint: [1, 1, 1],
  });

  const slime = enemies.registerType({
    name: 'slime',
    walkClip: 'enemy_slime_walk',
    hp: 70,
    speed: 1.6,
    contactDamage: 10,
    radius: 0.6,
    spriteSize: 1.3,
    xpValue: 3,
    contactCooldown: 0.8,
    tint: [1, 1, 1],
  });

  const wolf = enemies.registerType({
    name: 'wolf',
    walkClip: 'enemy_wolf_walk',
    hp: 22,
    speed: 5.2,
    contactDamage: 9,
    radius: 0.45,
    spriteSize: 1.2,
    xpValue: 2,
    contactCooldown: 0.5,
    tint: [1, 1, 1],
  });

  const ghost = enemies.registerType({
    name: 'ghost',
    walkClip: 'enemy_ghost_walk',
    hp: 16,
    speed: 3.2,
    contactDamage: 7,
    radius: 0.4,
    spriteSize: 1.1,
    xpValue: 2,
    contactCooldown: 0.6,
    tint: [1, 1, 1],
    behavior: makeGhostBehavior(ghostPhase),
    onSpawn: (index) => {
      ghostPhase[index] = goldenPhase(index);
    },
  });

  const brute = enemies.registerType({
    name: 'brute',
    walkClip: 'enemy_brute_walk',
    hp: 130,
    speed: 1.8,
    contactDamage: 18,
    radius: 0.75,
    spriteSize: 1.8,
    xpValue: 5,
    contactCooldown: 0.9,
    tint: [1, 1, 1],
  });

  const spitter = enemies.registerType({
    name: 'spitter',
    walkClip: 'enemy_spitter_walk',
    hp: 20,
    speed: 2.4,
    contactDamage: 4,
    radius: 0.45,
    spriteSize: 1.2,
    xpValue: 2,
    contactCooldown: 0.6,
    tint: [1, 1, 1],
    behavior: makeSpitterBehavior(spitterCooldown),
    onSpawn: (index) => {
      // Stagger initial cooldowns so a pack of spitters doesn't all fire on
      // the same frame the moment they come into range.
      spitterCooldown[index] = (index % 10) * 0.22;
    },
  });

  const rotKing = enemies.registerType({
    name: 'Rot King',
    walkClip: 'boss_rotking_walk',
    hp: 2800,
    speed: 1.9,
    contactDamage: 22,
    radius: 1.4,
    spriteSize: 3.2,
    xpValue: 50,
    contactCooldown: 1.0,
    tint: [1, 1, 1],
  });

  const boneColossus = enemies.registerType({
    name: 'Bone Colossus',
    walkClip: 'boss_bonecolossus_walk',
    hp: 4200,
    speed: 1.6,
    contactDamage: 28,
    radius: 1.6,
    spriteSize: 3.6,
    xpValue: 80,
    contactCooldown: 1.0,
    tint: [1, 1, 1],
  });

  return { grunt, bat, skeleton, slime, wolf, ghost, brute, spitter, rotKing, boneColossus };
}
