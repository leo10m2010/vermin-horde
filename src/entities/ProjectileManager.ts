import { IndexPool } from '../core/ObjectPool';
import { LAYER_Y, POOL_CAPACITY, WORLD } from '../core/Constants';
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

  private readonly visuals: ProjectileVisual[] = [];

  constructor() {
    this.batch = new InstancedBillboardBatch(this.capacity, spriteAtlas.texture, 'projectiles');
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
    return index;
  }

  setVelocity(index: number, vx: number, vz: number): void {
    this.velX[index] = vx;
    this.velZ[index] = vz;
  }

  setPosition(index: number, x: number, z: number): void {
    this.posX[index] = x;
    this.posZ[index] = z;
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

      if (visual.spins) this.spin[i] += dt * 12;
      const facing = visual.spins ? Math.sign(Math.cos(this.spin[i])) || 1 : this.velX[i] >= 0 ? 1 : -1;

      this.batch.set(
        i,
        this.posX[i],
        LAYER_Y.projectile,
        this.posZ[i],
        uv,
        visual.spriteSize * facing,
        visual.spriteSize,
        visual.tint[0],
        visual.tint[1],
        visual.tint[2],
        1,
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
