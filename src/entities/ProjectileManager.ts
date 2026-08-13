import { IndexPool } from '../core/ObjectPool';
import { LAYER_Y, POOL_CAPACITY, RENDER_ORDER, WORLD } from '../core/Constants';
import { InstancedBillboardBatch } from '../render/InstancedBillboardBatch';
import { advanceAnimFrame, spriteAtlas } from '../render/SpriteAtlas';

export interface ProjectileVisual {
  id: number;
  clip: string;
  spriteSize: number;
  tint: [number, number, number];
  spins: boolean;
}

export interface ProjectileSpawnOpts {
  damage: number;
  radius: number;
  pierce: number; // remaining enemies it can hit before despawning
  life: number; // seconds; Infinity for orbiter-style externally-managed projectiles
  crit?: boolean;
  weaponId?: number;
  knockback?: number;
}

/**
 * Pooled, rendered projectiles shared by every weapon type (bolts, orbs,
 * boomerangs, orbiter satellites with life=Infinity and externally driven
 * velocity). Pure movement/lifetime/rendering infra - hit-testing against
 * enemies is owned by the weapons module so this stays weapon-agnostic.
 */
export class ProjectileManager {
  readonly capacity = POOL_CAPACITY.projectiles;
  readonly pool = new IndexPool(this.capacity);
  readonly batch: InstancedBillboardBatch;

  readonly posX = new Float32Array(this.capacity);
  readonly posZ = new Float32Array(this.capacity);
  readonly velX = new Float32Array(this.capacity);
  readonly velZ = new Float32Array(this.capacity);
  readonly life = new Float32Array(this.capacity);
  readonly damage = new Float32Array(this.capacity);
  readonly radius = new Float32Array(this.capacity);
  readonly pierce = new Int16Array(this.capacity);
  readonly crit = new Uint8Array(this.capacity);
  readonly knockback = new Float32Array(this.capacity);
  readonly weaponId = new Int16Array(this.capacity);
  readonly visualId = new Uint16Array(this.capacity);
  readonly alive = new Uint8Array(this.capacity);
  readonly animTimer = new Float32Array(this.capacity);
  readonly spin = new Float32Array(this.capacity);
  /** Per-instance render-size override; -1 (the default) means "use this instance's visual.spriteSize" unscaled.
   * Needed by weapons whose persistent zone/ring visual must track a stat-scaled radius (area passives/arcanas)
   * instead of the fixed size baked into the visual at registerVisual() time - see setSize(). */
  readonly sizeOverride = new Float32Array(this.capacity).fill(-1);
  /** Per-instance HEIGHT override, paired with `sizeOverride` (which acts as the width when this is set).
   * -1 means "square": use sizeOverride/spriteSize for both axes, which is what every round projectile wants.
   * Long thin visuals (the whip lash) need independent width/height or they render as a huge square quad
   * whose feet-anchored top edge ends up above the player's head. See setSizeXY(). */
  readonly heightSizeOverride = new Float32Array(this.capacity).fill(-1);
  /** Per-instance visual-only Y offset added on top of LAYER_Y.projectile - lets a weapon fake a 2.5D parabolic
   * arc (Axe's throw, Hex Flask's lob) purely for rendering while collisions stay flat on X/Z. Reset to 0 on spawn. */
  readonly heightOffset = new Float32Array(this.capacity);
  /** Per-instance horizontal mirror override (+1/-1); 0 (the default) means "derive it from velocity/spin".
   * Needed by zero-velocity visuals like the whip slash, whose side is decided by the weapon, not by motion. */
  readonly facingOverride = new Int8Array(this.capacity);
  /** Per-instance extra spin offset in radians, for weapons that want a specific blade/axe orientation. */
  readonly spinOffset = new Float32Array(this.capacity);
  /** Per-instance spin speed (rad/s); -1 uses the shared default. Lets a thrown axe slow its rotation near the apex. */
  readonly spinRate = new Float32Array(this.capacity).fill(-1);
  /** Per-instance render opacity (1 = opaque). Lets a weapon fade a visual - a toss shadow, an expiring zone - without a second batch. */
  readonly alphaOverride = new Float32Array(this.capacity).fill(1);

  private readonly visuals: ProjectileVisual[] = [];

  constructor() {
    this.batch = new InstancedBillboardBatch(this.capacity, spriteAtlas.texture, 'projectiles', false, RENDER_ORDER.projectile);
  }

  registerVisual(clip: string, spriteSize: number, tint: [number, number, number] = [1, 1, 1], spins = false): number {
    const id = this.visuals.length;
    this.visuals.push({ id, clip, spriteSize, tint, spins });
    return id;
  }

  get activeCount(): number {
    return this.pool.activeCount;
  }

  spawn(visualId: number, x: number, z: number, vx: number, vz: number, opts: ProjectileSpawnOpts): number {
    const index = this.pool.acquire();
    if (index === -1) return -1;
    this.posX[index] = x;
    this.posZ[index] = z;
    this.velX[index] = vx;
    this.velZ[index] = vz;
    this.life[index] = opts.life;
    this.damage[index] = opts.damage;
    this.radius[index] = opts.radius;
    this.pierce[index] = opts.pierce;
    this.crit[index] = opts.crit ? 1 : 0;
    this.knockback[index] = opts.knockback ?? 0;
    this.weaponId[index] = opts.weaponId ?? -1;
    this.visualId[index] = visualId;
    this.alive[index] = 1;
    this.animTimer[index] = 0;
    this.spin[index] = 0;
    this.sizeOverride[index] = -1;
    this.heightSizeOverride[index] = -1;
    this.heightOffset[index] = 0;
    this.facingOverride[index] = 0;
    this.spinOffset[index] = 0;
    this.spinRate[index] = -1;
    this.alphaOverride[index] = 1;
    return index;
  }

  /** Swap this instance's sprite mid-flight - used by Arc Cross to visibly change on the RETURN leg. */
  setVisual(index: number, visualId: number): void {
    this.visualId[index] = visualId;
    this.animTimer[index] = 0;
  }

  /** Force this instance's horizontal mirror (+1 right / -1 left) instead of deriving it from velocity. */
  setFacing(index: number, facing: 1 | -1): void {
    this.facingOverride[index] = facing;
  }

  /** Override this instance's spin speed in rad/s for this frame. */
  setSpinRate(index: number, radPerSec: number): void {
    this.spinRate[index] = radPerSec;
  }

  /** Per-instance render opacity for this frame (1 = opaque). Reset to 1 on spawn; call every frame while fading. */
  setAlpha(index: number, alpha: number): void {
    this.alphaOverride[index] = alpha;
  }

  setVelocity(index: number, vx: number, vz: number): void {
    this.velX[index] = vx;
    this.velZ[index] = vz;
  }

  setPosition(index: number, x: number, z: number): void {
    this.posX[index] = x;
    this.posZ[index] = z;
  }

  /** Override this instance's on-screen size for this frame (world-unit diameter), instead of
   * the fixed size baked into its visual definition. Pass a value >= 0; call every frame the
   * instance is alive, since a fresh spawn() resets the override back to "use the visual default". */
  setSize(index: number, size: number): void {
    this.sizeOverride[index] = size;
    this.heightSizeOverride[index] = -1; // square, unchanged behaviour
  }

  /**
   * Independent width/height for this instance, for visuals that are not
   * square. Without this a 3-unit-long whip lash also became 3 units TALL,
   * and since the quad is feet-anchored that put the drawn lash well above
   * the player's head. `setSize()` keeps its original square meaning.
   */
  setSizeXY(index: number, width: number, height: number): void {
    this.sizeOverride[index] = width;
    this.heightSizeOverride[index] = height;
  }

  /** Visual-only world-unit Y offset for this frame (2.5D arc/lob effect). Does not affect collision, which stays X/Z-only. */
  setHeightOffset(index: number, offset: number): void {
    this.heightOffset[index] = offset;
  }

  /** Consume one pierce charge; despawns and returns true when exhausted. */
  registerHit(index: number): boolean {
    this.pierce[index] -= 1;
    if (this.pierce[index] < 0) {
      this.despawn(index);
      return true;
    }
    return false;
  }

  despawn(index: number): void {
    if (!this.alive[index]) return;
    this.alive[index] = 0;
    this.batch.hide(index);
    this.pool.release(index);
  }

  update(dt: number): void {
    const bound = WORLD.halfExtent + 5;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;

      if (this.life[i] !== Infinity) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) {
          this.despawn(i);
          continue;
        }
      }

      this.posX[i] += this.velX[i] * dt;
      this.posZ[i] += this.velZ[i] * dt;

      if (Math.abs(this.posX[i]) > bound || Math.abs(this.posZ[i]) > bound) {
        this.despawn(i);
        continue;
      }

      const visual = this.visuals[this.visualId[i]];
      this.animTimer[i] += dt;
      let uv;
      if (spriteAtlas.hasClip(visual.clip)) {
        const clip = spriteAtlas.getClip(visual.clip);
        const frame = advanceAnimFrame(clip, this.animTimer[i], 0);
        uv = spriteAtlas.getUV(frame.cellIndex);
      } else {
        uv = spriteAtlas.getUV(0);
      }

      if (visual.spins) this.spin[i] += dt * (this.spinRate[i] >= 0 ? this.spinRate[i] : 12);
      const facing =
        this.facingOverride[i] !== 0
          ? this.facingOverride[i]
          : visual.spins
            ? Math.sign(Math.cos(this.spin[i] + this.spinOffset[i])) || 1
            : this.velX[i] >= 0
              ? 1
              : -1;
      const size = this.sizeOverride[i] >= 0 ? this.sizeOverride[i] : visual.spriteSize;
      const sizeY = this.heightSizeOverride[i] >= 0 ? this.heightSizeOverride[i] : size;

      this.batch.set(
        i,
        this.posX[i],
        LAYER_Y.projectile + this.heightOffset[i],
        this.posZ[i],
        uv,
        size * facing,
        sizeY,
        visual.tint[0],
        visual.tint[1],
        visual.tint[2],
        this.alphaOverride[i],
        0,
      );
    }
    this.batch.commit();
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
