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
  ghoul: number;
  gargoyle: number;
  rotKing: number;
  boneColossus: number;
  duskfang: number;
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

/**
 * `charge[i] > 0` means the spitter has already committed a shot and is
 * winding it up. That window is deliberately the SAME
 * SPITTER_TELEGRAPH_DELAY the ground ring already used, so damage timing and
 * dodge windows are byte-for-byte unchanged - the only new thing is that the
 * creature itself now shows the tell (throat sac inflating, body reared back,
 * planted instead of strafing) for exactly as long as the ring is on the
 * ground. Before this, the ring appeared but the spitter kept casually
 * strafing, so nothing on the creature said "this one is shooting at you".
 */
function makeSpitterBehavior(cooldown: Float32Array, charge: Float32Array): EnemyBehavior {
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

    if (charge[i] > 0) {
      charge[i] -= dt;
      // Plant while charging so the wind-up is legible as a stance change,
      // then snap to the spit pose the instant the shot lands.
      mgr.velX[i] *= 0.12;
      mgr.velZ[i] *= 0.12;
      if (charge[i] <= 0) mgr.requestPose(i, 'attack', 0.3);
      else mgr.requestPose(i, 'special', 0.15); // refreshed every frame = held
      return;
    }

    if (dist <= SPITTER_MAX_RANGE) {
      cooldown[i] -= dt;
      if (cooldown[i] <= 0) {
        cooldown[i] = SPITTER_ATTACK_INTERVAL;
        charge[i] = SPITTER_TELEGRAPH_DELAY;
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

// Ghoul: a charger/dasher. Shambles slowly until the player enters trigger
// range, then commits to a fast straight-line dash for a short burst before
// recovering back to its normal slow pace. `state` doubles as a signed
// phase timer (matches makeSpitterBehavior's single-Float32Array-per-instance
// pattern, just overloaded: >0 = mid-dash countdown, <0 = post-dash recovery
// countdown, ===0 = idle/ready) so only two extra arrays are needed to lock
// in the dash direction for the burst's duration - re-steering mid-dash would
// turn the "commits to a straight line" archetype back into a normal chaser.
const GHOUL_TRIGGER_RANGE = 5.5;
const GHOUL_DASH_DURATION = 0.4;
const GHOUL_DASH_SPEED = 11;
const GHOUL_RECOVERY_DURATION = 1.6;
/**
 * Wind-up held before the dash actually launches. Previously the ghoul went
 * from a 1.4-speed shamble to an 11-speed dash on a single frame with no tell
 * at all, which is unreadable and unfair; it now coils in place (crystals
 * flaring, body braced back) for this long first. The dash direction is still
 * locked at the moment of COMMIT - the ghoul aims where the player was when
 * the wind-up started, so dodging the telegraph works.
 */
const GHOUL_WINDUP_DURATION = 0.34;

function makeGhoulBehavior(
  state: Float32Array,
  dashDirX: Float32Array,
  dashDirZ: Float32Array,
  windup: Float32Array,
): EnemyBehavior {
  return (i, dt, mgr, px, pz) => {
    if (windup[i] > 0) {
      // Coiled and braced: nearly rooted, holding the dash telegraph pose.
      windup[i] -= dt;
      mgr.velX[i] = dashDirX[i] * -0.6; // slight rock backwards as it loads
      mgr.velZ[i] = dashDirZ[i] * -0.6;
      if (windup[i] <= 0) {
        state[i] = GHOUL_DASH_DURATION;
      } else {
        mgr.requestPose(i, 'special', 0.15); // refreshed every frame = held
        return;
      }
    }

    if (state[i] > 0) {
      // Mid-dash: committed to the direction locked at dash start.
      state[i] -= dt;
      mgr.velX[i] = dashDirX[i] * GHOUL_DASH_SPEED;
      mgr.velZ[i] = dashDirZ[i] * GHOUL_DASH_SPEED;
      mgr.requestPose(i, 'attack', 0.15);
      if (state[i] <= 0) state[i] = -GHOUL_RECOVERY_DURATION;
      return;
    }

    const dx = px - mgr.posX[i];
    const dz = pz - mgr.posZ[i];
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const dirX = dx / dist;
    const dirZ = dz / dist;

    if (state[i] < 0) {
      // Recovering: shamble at normal (slow) speed, can't dash again yet.
      state[i] = Math.min(0, state[i] + dt);
      mgr.velX[i] = dirX * mgr.speed[i];
      mgr.velZ[i] = dirZ * mgr.speed[i];
      return;
    }

    // Idle/ready: shamble toward the player; commit to a dash once close enough.
    if (dist <= GHOUL_TRIGGER_RANGE) {
      windup[i] = GHOUL_WINDUP_DURATION;
      dashDirX[i] = dirX;
      dashDirZ[i] = dirZ;
      mgr.requestPose(i, 'special', 0.15);
      return;
    }
    mgr.velX[i] = dirX * mgr.speed[i];
    mgr.velZ[i] = dirZ * mgr.speed[i];
  };
}

// Gargoyle: a stationary turret-style ranged attacker. Unlike the spitter
// (which actively kites to hold a mid-range band), this one just closes
// distance until it's within firing range, then plants - only a token drift
// toward the player - and fires a slow, telegraphed aimed shot on a fixed
// interval regardless of exact distance within range. Forces the player to
// either dodge the (large, slow) telegraph or push in to melee it down.
const GARGOYLE_ENGAGE_RANGE = 9;
const GARGOYLE_ATTACK_INTERVAL = 3.0;
const GARGOYLE_TELEGRAPH_RADIUS = 2.0;
const GARGOYLE_TELEGRAPH_DELAY = 1.1;
const GARGOYLE_ATTACK_DAMAGE = 13;

/**
 * `charge[i] > 0` mirrors the spitter's wind-up: it spans exactly the
 * existing GARGOYLE_TELEGRAPH_DELAY, so the shot's damage and dodge window
 * are unchanged, but the statue now visibly powers up (wings hauled back,
 * eyes and the fractures through its stone lighting violet) for the whole
 * time its ring is on the ground.
 */
function makeGargoyleBehavior(cooldown: Float32Array, charge: Float32Array): EnemyBehavior {
  return (i, dt, mgr, px, pz) => {
    const dx = px - mgr.posX[i];
    const dz = pz - mgr.posZ[i];
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const speed = mgr.speed[i];

    if (dist > GARGOYLE_ENGAGE_RANGE) {
      // Not yet in range: drift toward the player instead of camping forever out of reach.
      mgr.velX[i] = dirX * speed;
      mgr.velZ[i] = dirZ * speed;
    } else {
      // Planted: barely creep, just enough to not look frozen solid.
      mgr.velX[i] = dirX * speed * 0.05;
      mgr.velZ[i] = dirZ * speed * 0.05;
    }

    if (charge[i] > 0) {
      charge[i] -= dt;
      mgr.velX[i] = 0; // a firing turret is fully rooted
      mgr.velZ[i] = 0;
      if (charge[i] <= 0) mgr.requestPose(i, 'attack', 0.35);
      else mgr.requestPose(i, 'special', 0.15); // refreshed every frame = held
      return;
    }

    if (dist <= GARGOYLE_ENGAGE_RANGE) {
      cooldown[i] -= dt;
      if (cooldown[i] <= 0) {
        cooldown[i] = GARGOYLE_ATTACK_INTERVAL;
        charge[i] = GARGOYLE_TELEGRAPH_DELAY;
        gameEvents.emit('bossTelegraph', {
          x: px,
          z: pz,
          radius: GARGOYLE_TELEGRAPH_RADIUS,
          delaySeconds: GARGOYLE_TELEGRAPH_DELAY,
          color: '#b98aff',
        });
        pendingTelegraphs.push({
          x: px,
          z: pz,
          radius: GARGOYLE_TELEGRAPH_RADIUS,
          damage: GARGOYLE_ATTACK_DAMAGE,
          remaining: GARGOYLE_TELEGRAPH_DELAY,
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
  const spitterCharge = new Float32Array(capacity);
  const ghoulState = new Float32Array(capacity);
  const ghoulDashDirX = new Float32Array(capacity);
  const ghoulDashDirZ = new Float32Array(capacity);
  const ghoulWindup = new Float32Array(capacity);
  const gargoyleCooldown = new Float32Array(capacity);
  const gargoyleCharge = new Float32Array(capacity);

  const grunt = enemies.registerType({
    name: 'grunt',
    clipPrefix: 'enemy_grunt',
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
    clipPrefix: 'enemy_bat',
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
    clipPrefix: 'enemy_skeleton',
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
    clipPrefix: 'enemy_slime',
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
    clipPrefix: 'enemy_wolf',
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
    clipPrefix: 'enemy_ghost',
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
    clipPrefix: 'enemy_brute',
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
    clipPrefix: 'enemy_spitter',
    hp: 20,
    speed: 2.4,
    contactDamage: 4,
    radius: 0.45,
    spriteSize: 1.2,
    xpValue: 2,
    contactCooldown: 0.6,
    tint: [1, 1, 1],
    behavior: makeSpitterBehavior(spitterCooldown, spitterCharge),
    onSpawn: (index) => {
      // Stagger initial cooldowns so a pack of spitters doesn't all fire on
      // the same frame the moment they come into range.
      spitterCooldown[index] = (index % 10) * 0.22;
      spitterCharge[index] = 0;
    },
  });

  const ghoul = enemies.registerType({
    name: 'ghoul',
    clipPrefix: 'enemy_ghoul',
    hp: 26,
    speed: 1.4,
    contactDamage: 14,
    radius: 0.5,
    spriteSize: 1.3,
    xpValue: 2,
    contactCooldown: 0.6,
    tint: [1, 1, 1],
    behavior: makeGhoulBehavior(ghoulState, ghoulDashDirX, ghoulDashDirZ, ghoulWindup),
    onSpawn: (index) => {
      // Pool slots are recycled, so per-instance dash state MUST be cleared
      // here - otherwise a fresh ghoul can inherit the previous occupant's
      // mid-dash/mid-windup phase and launch itself the frame it spawns.
      ghoulState[index] = 0;
      ghoulWindup[index] = 0;
      ghoulDashDirX[index] = 0;
      ghoulDashDirZ[index] = 0;
    },
  });

  const gargoyle = enemies.registerType({
    name: 'gargoyle',
    clipPrefix: 'enemy_gargoyle',
    hp: 45,
    speed: 0.6,
    contactDamage: 6,
    radius: 0.55,
    spriteSize: 1.5,
    xpValue: 3,
    contactCooldown: 0.7,
    tint: [1, 1, 1],
    behavior: makeGargoyleBehavior(gargoyleCooldown, gargoyleCharge),
    onSpawn: (index) => {
      // Stagger initial cooldowns so a pack of gargoyles doesn't volley in lockstep.
      gargoyleCooldown[index] = (index % 10) * 0.3;
      gargoyleCharge[index] = 0;
    },
  });

  const rotKing = enemies.registerType({
    name: 'Rot King',
    clipPrefix: 'boss_rotking',
    deathDuration: 1.1,
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
    clipPrefix: 'boss_bonecolossus',
    deathDuration: 1.25,
    hp: 4200,
    speed: 1.6,
    contactDamage: 28,
    radius: 1.6,
    spriteSize: 3.6,
    xpValue: 80,
    contactCooldown: 1.0,
    tint: [1, 1, 1],
  });

  // Duskfang - a fast, low-slung spectral hound. Unlike Rot King/Bone
  // Colossus (both tall, plodding melee brutes), it's smaller, noticeably
  // quicker, and reads as a hunting predator rather than a lumbering giant.
  // Its threat comes from mobility + a rapid pounce-combo (see
  // WaveDirector.triggerDuskfangAttack) rather than raw HP, so it sits
  // between the other two on hp/contactDamage but well above them on speed.
  const duskfang = enemies.registerType({
    name: 'Duskfang',
    clipPrefix: 'boss_duskfang',
    deathDuration: 0.95,
    hp: 3400,
    speed: 3.0,
    contactDamage: 24,
    radius: 1.15,
    spriteSize: 2.6,
    xpValue: 65,
    contactCooldown: 0.8,
    tint: [1, 1, 1],
  });

  return { grunt, bat, skeleton, slime, wolf, ghost, brute, spitter, ghoul, gargoyle, rotKing, boneColossus, duskfang };
}
