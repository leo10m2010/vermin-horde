import { IndexPool } from '../core/ObjectPool';
import { SpatialHash } from '../core/SpatialHash';
import { LAYER_Y, POOL_CAPACITY, SPATIAL_HASH_CELL } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import { InstancedBillboardBatch } from '../render/InstancedBillboardBatch';
import { ShadowBatch } from '../render/ShadowBatch';
import { advanceAnimFrame, spriteAtlas } from '../render/SpriteAtlas';

export type EnemyBehavior = (index: number, dt: number, mgr: EnemyManager, playerX: number, playerZ: number) => void;

/**
 * The six animation states every creature authors art for (see
 * SpriteLibraryEnemyArt.ts). Ordered by index so the per-instance state can
 * live in a Uint8Array alongside the rest of the struct-of-arrays pool
 * instead of costing an object per enemy.
 */
export const ENEMY_POSES = ['idle', 'walk', 'attack', 'hit', 'special', 'death'] as const;
export type EnemyPose = (typeof ENEMY_POSES)[number];
export const POSE_NONE = 255;

/**
 * Which pose wins when two are requested in the same window. A deliberate
 * action (attack, then its charge/telegraph) outranks a flinch: getting shot
 * mid-swing must not cancel the swing pose, because the telegraph is what the
 * player reads to dodge. The white hit-flash (aFlash) still fires on every
 * hit regardless, so damage feedback is never lost.
 */
const POSE_PRIORITY: Record<number, number> = { 2: 3, 4: 2, 3: 1 };

export interface EnemyTypeDef {
  id: number;
  name: string;
  /**
   * Atlas clip-name prefix; the six pose clips are `${clipPrefix}_${pose}`.
   * Resolved once at registerType() (clips are registered before enemy types
   * - see Game's constructor order) into `resolvedClips`, so the render loop
   * never does string concatenation or map lookups per enemy per frame.
   */
  clipPrefix: string;
  hp: number;
  speed: number;
  contactDamage: number;
  radius: number;
  spriteSize: number;
  xpValue: number;
  contactCooldown: number;
  tint: [number, number, number];
  /** Death-animation length. Bosses get a longer, readable collapse; trash stays brief so hordes don't clutter. */
  deathDuration?: number;
  behavior?: EnemyBehavior;
  /** Called once when an instance of this type spawns (e.g. custom init). */
  onSpawn?: (index: number, mgr: EnemyManager) => void;
  /** Filled in by registerType: pose index -> clip name, or null when unregistered. */
  resolvedClips?: Array<string | null>;
}

// Brief animated tail after death instead of an instant pop, and a brief
// fade/pop-in on spawn instead of appearing at full opacity abruptly. Both
// are short enough to read as "juice" rather than delaying gameplay (the
// enemy stops being targetable/damageable/counted the instant kill() fires -
// only the rendering lingers).
const DEATH_DURATION = 0.22;
const SPAWN_FADE_DURATION = 0.18;
/** How long the flinch pose holds after a hit. Short on purpose: enemies in a horde are hit constantly. */
const HIT_POSE_DURATION = 0.16;
/** Below this speed (squared) an enemy plays idle instead of walk. */
const IDLE_SPEED_SQ = 0.04;

const defaultChase: EnemyBehavior = (i, _dt, mgr, px, pz) => {
  const dx = px - mgr.posX[i];
  const dz = pz - mgr.posZ[i];
  const distSq = dx * dx + dz * dz;
  const dist = Math.sqrt(distSq) || 1;
  const speed = mgr.speed[i];
  mgr.velX[i] = (dx / dist) * speed;
  mgr.velZ[i] = (dz / dist) * speed;
};

/**
 * Struct-of-arrays enemy pool: up to POOL_CAPACITY.enemies alive at once,
 * rendered through one InstancedBillboardBatch draw call. Type-specific
 * stats/behavior live in registered EnemyTypeDef entries so this class stays
 * pure infrastructure (pooling, spatial separation, damage, rendering) while
 * `src/enemies/*` owns content (which types exist, when they spawn).
 */
export class EnemyManager {
  readonly capacity = POOL_CAPACITY.enemies;
  readonly pool = new IndexPool(this.capacity);
  readonly batch: InstancedBillboardBatch;
  /** One flat ground-shadow decal per enemy slot, same index as `batch` - a single extra draw call covers up to `capacity` shadows. */
  readonly shadowBatch: ShadowBatch;
  readonly spatialHash = new SpatialHash(SPATIAL_HASH_CELL);

  readonly posX = new Float32Array(this.capacity);
  readonly posZ = new Float32Array(this.capacity);
  readonly velX = new Float32Array(this.capacity);
  readonly velZ = new Float32Array(this.capacity);
  readonly hp = new Float32Array(this.capacity);
  readonly maxHp = new Float32Array(this.capacity);
  readonly typeId = new Uint16Array(this.capacity);
  readonly alive = new Uint8Array(this.capacity);
  readonly isElite = new Uint8Array(this.capacity);
  readonly isBoss = new Uint8Array(this.capacity);
  readonly speed = new Float32Array(this.capacity);
  readonly radius = new Float32Array(this.capacity);
  readonly spriteSize = new Float32Array(this.capacity);
  readonly animTimer = new Float32Array(this.capacity);
  readonly flashTimer = new Float32Array(this.capacity);
  readonly contactTimer = new Float32Array(this.capacity);
  readonly facing = new Int8Array(this.capacity).fill(1);
  readonly slowTimer = new Float32Array(this.capacity);
  readonly slowFactor = new Float32Array(this.capacity).fill(1);
  /** 1 while a death-fade tail is playing; `alive[i]` is already 0 by then, so
   * this is a separate bookkeeping path for rendering only (not targeting). */
  readonly dying = new Uint8Array(this.capacity);
  readonly dyingTimer = new Float32Array(this.capacity);
  /** Counts down from SPAWN_FADE_DURATION right after spawn(); drives the
   * fade/pop-in ramp in the render step below. */
  readonly spawnTimer = new Float32Array(this.capacity);

  // --- one-shot pose state (attack / hit / special) ---
  // `animTimer` above stays a free-running clock: several behaviors read it as
  // a per-instance phase source (makeWobbleChase, makeGhostBehavior), so
  // resetting it on a state change would visibly jolt their movement. One-shot
  // poses therefore get their own playhead here instead.
  /** Active one-shot pose index, or POSE_NONE. */
  readonly poseKind = new Uint8Array(this.capacity).fill(POSE_NONE);
  /** Seconds left of the active one-shot pose. */
  readonly poseRemaining = new Float32Array(this.capacity);
  /** Total length of the active one-shot pose, so the playhead is (duration - remaining). */
  readonly poseDuration = new Float32Array(this.capacity);
  /**
   * Inspection-only override (see the `enemyShowcase` test hook): when >= 0
   * this pose is rendered permanently, ignoring gameplay state, so every
   * creature can be compared side by side in the same pose. Never set during
   * normal play.
   */
  readonly forcedPose = new Int8Array(this.capacity).fill(-1);
  /**
   * Inspection-only (see the `enemyShowcase` test hook): skips behavior,
   * separation, movement integration and contact damage for this slot, while
   * still animating and rendering it. Needed because several behaviors add
   * perpendicular wobble that is independent of `speed` (makeWobbleChase,
   * makeGhostBehavior), so simply zeroing speed would not hold a comparison
   * lineup in place. Never set during normal play.
   */
  readonly frozen = new Uint8Array(this.capacity);

  private readonly types: EnemyTypeDef[] = [];

  constructor() {
    this.batch = new InstancedBillboardBatch(this.capacity, spriteAtlas.texture, 'enemies');
    this.shadowBatch = new ShadowBatch(this.capacity, 'enemy-shadows');
  }

  registerType(def: Omit<EnemyTypeDef, 'id'>): number {
    const id = this.types.length;
    // Resolve every pose clip once, here, rather than per enemy per frame.
    // Unregistered poses resolve to null and fall back at render time, so a
    // creature that only ships a walk cycle still renders correctly.
    const resolvedClips = ENEMY_POSES.map((pose) => {
      const name = `${def.clipPrefix}_${pose}`;
      return spriteAtlas.hasClip(name) ? name : null;
    });
    this.types.push({ ...def, id, resolvedClips });
    return id;
  }

  /**
   * Ask an enemy to play a one-shot pose (attack / hit / special) for
   * `duration` seconds. Behaviors call this to make their tells visible - a
   * spitter inflating its throat sac, a ghoul coiling before a dash, a boss
   * hauling its weapon overhead. Refuses to downgrade an in-flight
   * higher-priority pose (see POSE_PRIORITY), and re-requesting the SAME pose
   * simply extends it, which is how behaviors hold a charge tell across the
   * whole windup by calling this every frame.
   */
  requestPose(index: number, pose: EnemyPose, duration: number): void {
    if (!this.alive[index]) return;
    const kind = ENEMY_POSES.indexOf(pose);
    const current = this.poseKind[index];
    if (current !== POSE_NONE && this.poseRemaining[index] > 0) {
      if (current === kind) {
        // same tell, held: keep the longest remaining window, don't restart it
        this.poseRemaining[index] = Math.max(this.poseRemaining[index], duration);
        this.poseDuration[index] = Math.max(this.poseDuration[index], duration);
        return;
      }
      if ((POSE_PRIORITY[kind] ?? 0) < (POSE_PRIORITY[current] ?? 0)) return;
    }
    this.poseKind[index] = kind;
    this.poseRemaining[index] = duration;
    this.poseDuration[index] = duration;
  }

  /** Resolve the clip for a pose, falling back walk -> idle so a partial art set never renders nothing. */
  private clipFor(def: EnemyTypeDef, poseIndex: number): string | null {
    const clips = def.resolvedClips;
    if (!clips) return null;
    return clips[poseIndex] ?? clips[1] ?? clips[0] ?? null;
  }

  /**
   * Advances one live enemy's animation state and pushes its instance to the
   * sprite + shadow batches. Shared by the normal update path and the frozen
   * inspection path (which skips movement but must still animate).
   */
  private renderEnemy(i: number, def: EnemyTypeDef, dt: number, slow: number): void {
    // `animTimer` stays free-running (behaviors read it as a phase source);
    // one-shot poses run on their own playhead so they always start at frame
    // 0 and clamp on the last frame instead of joining a loop mid-cycle.
    this.animTimer[i] += dt * slow;
    if (this.poseRemaining[i] > 0) {
      this.poseRemaining[i] -= dt;
      if (this.poseRemaining[i] <= 0) this.poseKind[i] = POSE_NONE;
    }

    let poseIndex: number;
    let playhead: number;
    const forced = this.forcedPose[i];
    if (forced >= 0) {
      // Inspection override: hold one pose indefinitely. The playhead is
      // wrapped to the clip's own length below, so even the one-shot clips
      // (attack/death) REPLAY instead of freezing on their last frame - the
      // point of the showcase is reviewing the animation, not its end state.
      poseIndex = forced;
      playhead = this.animTimer[i];
    } else if (this.poseKind[i] !== POSE_NONE) {
      poseIndex = this.poseKind[i];
      playhead = this.poseDuration[i] - this.poseRemaining[i];
    } else {
      const movingSq = this.velX[i] * this.velX[i] + this.velZ[i] * this.velZ[i];
      poseIndex = movingSq > IDLE_SPEED_SQ ? 1 : 0;
      playhead = this.animTimer[i];
    }

    // Fall back to atlas cell 0 for unregistered clips so a naming mismatch
    // between enemy configs and sprite registrations never crashes the loop.
    const clipName = this.clipFor(def, poseIndex);
    let uv;
    if (clipName) {
      const clip = spriteAtlas.getClip(clipName);
      if (forced >= 0 && !clip.loop) playhead %= clip.cells.length / clip.fps;
      const frame = advanceAnimFrame(clip, playhead, 0);
      uv = spriteAtlas.getUV(frame.cellIndex);
    } else {
      uv = spriteAtlas.getUV(0);
    }
    const tint = def.tint;
    const flash = this.flashTimer[i] > 0 ? 1 : 0;

    // Spawn-in fade/pop: fresh spawns ramp alpha 0.2->1 and scale 0.7->1
    // over SPAWN_FADE_DURATION instead of snapping to full size/opacity,
    // most noticeable for the frequent trash-mob spawns at the view edge.
    let spawnAlpha = 1;
    let spawnScale = 1;
    if (this.spawnTimer[i] > 0) {
      this.spawnTimer[i] = Math.max(0, this.spawnTimer[i] - dt);
      const t = this.spawnTimer[i] / SPAWN_FADE_DURATION; // 1 -> 0
      spawnAlpha = 0.2 + 0.8 * (1 - t);
      spawnScale = 0.7 + 0.3 * (1 - t);
    }

    const size = this.spriteSize[i] * spawnScale;
    this.batch.set(
      i,
      this.posX[i],
      this.isBoss[i] ? LAYER_Y.boss : this.isElite[i] ? LAYER_Y.elite : LAYER_Y.enemy,
      this.posZ[i],
      uv,
      size * this.facing[i],
      size,
      tint[0],
      tint[1],
      tint[2],
      spawnAlpha,
      flash,
    );
    this.shadowBatch.set(i, this.posX[i], this.posZ[i], size * 0.36);
  }

  getType(id: number): EnemyTypeDef {
    return this.types[id];
  }

  get activeCount(): number {
    return this.pool.activeCount;
  }

  spawn(typeId: number, x: number, z: number, opts: { elite?: boolean; boss?: boolean; hpMult?: number; speedMult?: number; scaleMult?: number } = {}): number {
    const index = this.pool.acquire();
    if (index === -1) return -1;
    const def = this.types[typeId];
    const hpMult = opts.hpMult ?? 1;
    const speedMult = opts.speedMult ?? 1;
    const scaleMult = opts.scaleMult ?? 1;

    this.posX[index] = x;
    this.posZ[index] = z;
    this.velX[index] = 0;
    this.velZ[index] = 0;
    this.maxHp[index] = def.hp * hpMult;
    this.hp[index] = this.maxHp[index];
    this.typeId[index] = typeId;
    this.alive[index] = 1;
    this.isElite[index] = opts.elite ? 1 : 0;
    this.isBoss[index] = opts.boss ? 1 : 0;
    this.speed[index] = def.speed * speedMult;
    this.radius[index] = def.radius * scaleMult;
    this.spriteSize[index] = def.spriteSize * scaleMult;
    this.animTimer[index] = Math.random() * 10;
    this.flashTimer[index] = 0;
    this.contactTimer[index] = 0;
    this.slowTimer[index] = 0;
    this.slowFactor[index] = 1;
    this.dying[index] = 0;
    this.dyingTimer[index] = 0;
    this.spawnTimer[index] = SPAWN_FADE_DURATION;
    this.poseKind[index] = POSE_NONE;
    this.poseRemaining[index] = 0;
    this.poseDuration[index] = 0;
    this.forcedPose[index] = -1;
    this.frozen[index] = 0;

    def.onSpawn?.(index, this);
    return index;
  }

  /** Apply damage; returns true if this hit killed the enemy. */
  damage(index: number, amount: number, crit = false): boolean {
    if (!this.alive[index]) return false;
    this.hp[index] -= amount;
    this.flashTimer[index] = 0.09;
    // Visible flinch on top of the white flash - the flash alone reads as
    // "something happened to that pixel", the recoil pose reads as "that
    // creature was hurt".
    this.requestPose(index, 'hit', HIT_POSE_DURATION);
    gameEvents.emit('enemyHit', { x: this.posX[index], z: this.posZ[index], damage: amount, crit, enemyIndex: index });
    if (this.hp[index] <= 0) {
      this.kill(index);
      return true;
    }
    return false;
  }

  applySlow(index: number, factor: number, duration: number): void {
    this.slowFactor[index] = Math.min(this.slowFactor[index], factor);
    this.slowTimer[index] = Math.max(this.slowTimer[index], duration);
  }

  kill(index: number): void {
    // `alive[index]` is cleared right here, immediately - every other system
    // that gates on it (contact damage, queryRadius/queryNearest, the spatial
    // hash, further damage() calls) treats this enemy as gone from this
    // frame forward, even though it keeps rendering a brief death-fade tail
    // below. Only the pool slot itself stays reserved (`dying[index] = 1`)
    // until the tail finishes, at which point `update()` does the hide/release
    // that used to happen instantly here.
    if (!this.alive[index]) return;
    this.alive[index] = 0;
    this.dying[index] = 1;
    const def = this.types[this.typeId[index]];
    // Bosses hold their collapse noticeably longer than trash - a boss death
    // is an event, a grunt death is one of thousands.
    this.dyingTimer[index] = def.deathDuration ?? DEATH_DURATION;
    this.poseKind[index] = POSE_NONE;
    this.poseRemaining[index] = 0;
    gameEvents.emit('enemyKilled', {
      x: this.posX[index],
      z: this.posZ[index],
      typeId: this.typeId[index],
      isElite: this.isElite[index] === 1,
      isBoss: this.isBoss[index] === 1,
      xpValue: def.xpValue,
    });
  }

  /** Fills `out` with alive enemy indices within `radius` of (x,z); returns count written. */
  queryRadius(x: number, z: number, radius: number, out: number[]): number {
    let count = 0;
    const r2 = radius * radius;
    const cellRadius = Math.max(1, Math.ceil(radius / SPATIAL_HASH_CELL));
    this.spatialHash.forEachNear(x, z, cellRadius, (i) => {
      if (!this.alive[i]) return;
      const dx = this.posX[i] - x;
      const dz = this.posZ[i] - z;
      if (dx * dx + dz * dz <= r2) {
        out[count] = i;
        count++;
      }
    });
    return count;
  }

  queryNearest(x: number, z: number, maxRadius: number): number {
    let best = -1;
    let bestDistSq = maxRadius * maxRadius;
    const cellRadius = Math.max(1, Math.ceil(maxRadius / SPATIAL_HASH_CELL));
    this.spatialHash.forEachNear(x, z, cellRadius, (i) => {
      if (!this.alive[i]) return;
      const dx = this.posX[i] - x;
      const dz = this.posZ[i] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        best = i;
      }
    });
    return best;
  }

  update(dt: number, playerX: number, playerZ: number): { contactDamage: number } {
    this.spatialHash.clear();
    let contactDamage = 0;

    // Rebuild spatial hash first so behaviors/separation can query this frame's positions.
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      this.spatialHash.insert(i, this.posX[i], this.posZ[i]);
    }

    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      const def = this.types[this.typeId[i]];

      if (this.slowTimer[i] > 0) {
        this.slowTimer[i] -= dt;
        if (this.slowTimer[i] <= 0) this.slowFactor[i] = 1;
      }

      if (this.frozen[i]) {
        // Inspection lineup: hold position exactly, but keep animating below.
        this.velX[i] = 0;
        this.velZ[i] = 0;
        if (this.flashTimer[i] > 0) this.flashTimer[i] = Math.max(0, this.flashTimer[i] - dt);
        this.renderEnemy(i, def, dt, 1);
        continue;
      }

      (def.behavior ?? defaultChase)(i, dt, this, playerX, playerZ);

      // Local separation so hordes don't visually merge into one blob. Uses
      // each sprite's visual footprint (not just its tiny hit radius) so
      // packed crowds stay readable as individual monsters instead of a
      // solid mass hiding the player underneath.
      let sepX = 0;
      let sepZ = 0;
      this.spatialHash.forEachNear(this.posX[i], this.posZ[i], 1, (j) => {
        if (j === i || !this.alive[j]) return;
        const dx = this.posX[i] - this.posX[j];
        const dz = this.posZ[i] - this.posZ[j];
        const d2 = dx * dx + dz * dz;
        const minDist = (this.spriteSize[i] + this.spriteSize[j]) * 0.46;
        if (d2 > 0 && d2 < minDist * minDist) {
          const d = Math.sqrt(d2);
          sepX += (dx / d) * (minDist - d);
          sepZ += (dz / d) * (minDist - d);
        }
      });

      // Also keep a small clearing around the player so the whole horde can
      // never fully stack on top of (and hide) the player sprite.
      const dxPlayer = this.posX[i] - playerX;
      const dzPlayer = this.posZ[i] - playerZ;
      const d2Player = dxPlayer * dxPlayer + dzPlayer * dzPlayer;
      const clearRadius = this.radius[i] + 0.55;
      if (d2Player > 0 && d2Player < clearRadius * clearRadius) {
        const dPlayer = Math.sqrt(d2Player);
        sepX += (dxPlayer / dPlayer) * (clearRadius - dPlayer) * 1.5;
        sepZ += (dzPlayer / dPlayer) * (clearRadius - dPlayer) * 1.5;
      }

      const slow = this.slowFactor[i];
      this.posX[i] += (this.velX[i] * slow + sepX * 22) * dt;
      this.posZ[i] += (this.velZ[i] * slow + sepZ * 22) * dt;

      if (Math.abs(this.velX[i]) > 0.05) this.facing[i] = this.velX[i] > 0 ? 1 : -1;

      // Contact damage against the player, throttled per-enemy.
      const dxp = playerX - this.posX[i];
      const dzp = playerZ - this.posZ[i];
      const contactRange = this.radius[i] + 0.5;
      if (dxp * dxp + dzp * dzp < contactRange * contactRange) {
        this.contactTimer[i] -= dt;
        if (this.contactTimer[i] <= 0) {
          contactDamage += def.contactDamage;
          this.contactTimer[i] = def.contactCooldown;
          // Every melee creature swings when it actually connects, without
          // each one needing its own behavior function - contact damage is
          // already centralized here, so the strike pose is too. Ranged types
          // (spitter/gargoyle) drive their own attack pose from their
          // behavior instead, where the shot is fired.
          this.requestPose(i, 'attack', Math.min(0.34, def.contactCooldown * 0.6));
        }
      }

      if (this.flashTimer[i] > 0) this.flashTimer[i] = Math.max(0, this.flashTimer[i] - dt);

      this.renderEnemy(i, def, dt, slow);
    }

    // Death-fade pass: dying enemies stopped being alive/targetable the
    // instant kill() fired (see kill()'s comment), but still render for a
    // brief tail - shrinking and fading to 0 - so death reads as a flourish
    // instead of an instant pop. This is a SEPARATE pass that does not gate
    // on `alive[i]` (dying enemies have alive[i] === 0 by design). Scanning
    // the full capacity here is cheap - the rest of this file already does
    // full-capacity scans every frame, and only a handful of enemies are
    // ever mid-death-animation at once.
    for (let i = 0; i < this.capacity; i++) {
      if (!this.dying[i]) continue;
      this.dyingTimer[i] -= dt;
      if (this.dyingTimer[i] <= 0) {
        this.dying[i] = 0;
        this.batch.hide(i);
        this.shadowBatch.hide(i);
        this.pool.release(i);
        continue;
      }

      const def = this.types[this.typeId[i]];
      const duration = def.deathDuration ?? DEATH_DURATION;
      const t = this.dyingTimer[i] / duration; // 1 -> 0
      // Play the creature's authored death clip, scrubbed across the whole
      // tail so all four collapse stages are seen regardless of how long that
      // creature's death lasts.
      let uv;
      const clipName = this.clipFor(def, 5);
      if (clipName) {
        const clip = spriteAtlas.getClip(clipName);
        // Map the tail's 1->0 progress onto the clip's own 0->length playhead
        // so every collapse stage is shown no matter how the two durations
        // compare (trash: 0.22s over 4 frames; bosses: ~0.9s over 4 frames).
        const clipLength = clip.cells.length / clip.fps;
        const frame = advanceAnimFrame(clip, (1 - t) * clipLength, 0);
        uv = spriteAtlas.getUV(frame.cellIndex);
      } else {
        uv = spriteAtlas.getUV(0);
      }
      const tint = def.tint;
      // Barely shrink now that there is a real collapse animation to read -
      // the old 0.6x shrink was doing the work a death pose does properly,
      // and would visibly fight it. Alpha holds full until the last third so
      // the animation plays out before the sprite fades off.
      const shrink = 0.92 + 0.08 * t;
      const alpha = Math.min(1, t / 0.35);
      const size = this.spriteSize[i] * shrink;
      this.batch.set(
        i,
        this.posX[i],
        this.isBoss[i] ? LAYER_Y.boss : this.isElite[i] ? LAYER_Y.elite : LAYER_Y.enemy,
        this.posZ[i],
        uv,
        size * this.facing[i],
        size,
        tint[0],
        tint[1],
        tint[2],
        alpha,
        0,
      );
      this.shadowBatch.set(i, this.posX[i], this.posZ[i], size * 0.36 * alpha);
    }

    this.batch.commit();
    this.shadowBatch.commit();
    return { contactDamage };
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i] || this.dying[i]) {
        this.batch.hide(i);
        this.shadowBatch.hide(i);
      }
      this.alive[i] = 0;
      this.dying[i] = 0;
      this.dyingTimer[i] = 0;
      this.spawnTimer[i] = 0;
      this.poseKind[i] = POSE_NONE;
      this.poseRemaining[i] = 0;
      this.poseDuration[i] = 0;
      this.forcedPose[i] = -1;
      this.frozen[i] = 0;
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
