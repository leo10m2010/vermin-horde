import { LAYER_Y, RENDER_ORDER, WORLD } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import { InstancedBillboardBatch } from '../render/InstancedBillboardBatch';
import { ShadowBatch } from '../render/ShadowBatch';
import { spriteAtlas } from '../render/SpriteAtlas';

/**
 * WORLD PROPS - the gameplay layer of a stage, kept deliberately separate
 * from StageDecor.
 *
 * StageDecor scatters 150-220 cheap sprites purely for texture and is left
 * exactly as it was: none of it collides, none of it can be destroyed.
 * This module owns the far smaller set of objects the player and the horde
 * actually interact with:
 *
 *   SOLID     - blocks movement, cannot be destroyed. A handful per stage,
 *               placed to create funnels and micro-routes, never a maze.
 *   BREAKABLE - low HP, destroyed by whatever weapon happens to reach it,
 *               drops a pickup. The player never has to aim at one.
 *
 * COLLISION IS BROAD-PHASED. Props never move, so their spatial grid is built
 * once at populate() and only read afterwards. A query touches the handful of
 * cells around the entity, so 900 enemies cost ~900 small lookups per frame
 * rather than 900 x every prop.
 */

export const PROP_SOLID = 0;
export const PROP_BREAKABLE = 1;

export interface PropDef {
  clip: string;
  category: typeof PROP_SOLID | typeof PROP_BREAKABLE;
  /** Rendered sprite size in world units. */
  size: number;
  /** Collider half-extents on X and Z. AABB rather than a circle so walls and
   * shelves actually feel like walls instead of pushing you around a disc. */
  halfW: number;
  halfD: number;
  /** Breakables only. Low on purpose - see the module comment. */
  hp?: number;
  /** Fragment tint when destroyed. */
  fragmentColor?: string;
}

/** Per-stage prop catalogue, keyed by StageDef.id. */
export const STAGE_PROPS: Record<string, PropDef[]> = {
  graveyard: [
    { clip: 'prop_grave_mausoleum', category: PROP_SOLID, size: 4.2, halfW: 1.7, halfD: 1.0 },
    { clip: 'prop_grave_wall', category: PROP_SOLID, size: 3.8, halfW: 1.8, halfD: 0.6 },
    { clip: 'prop_grave_statue', category: PROP_SOLID, size: 3.2, halfW: 0.8, halfD: 0.7 },
    { clip: 'prop_grave_lantern', category: PROP_BREAKABLE, size: 1.7, halfW: 0.4, halfD: 0.4, hp: 12, fragmentColor: '#ffb648' },
    { clip: 'prop_grave_urn', category: PROP_BREAKABLE, size: 1.5, halfW: 0.45, halfD: 0.45, hp: 10, fragmentColor: '#b08a5a' },
  ],
  forest: [
    { clip: 'prop_forest_boulder', category: PROP_SOLID, size: 3.6, halfW: 1.5, halfD: 1.0 },
    { clip: 'prop_forest_log', category: PROP_SOLID, size: 3.9, halfW: 1.9, halfD: 0.55 },
    { clip: 'prop_forest_tree', category: PROP_SOLID, size: 4.0, halfW: 0.9, halfD: 0.8 },
    { clip: 'prop_forest_crystal', category: PROP_BREAKABLE, size: 1.8, halfW: 0.45, halfD: 0.45, hp: 12, fragmentColor: '#b98aff' },
    { clip: 'prop_forest_totem', category: PROP_BREAKABLE, size: 1.9, halfW: 0.4, halfD: 0.4, hp: 14, fragmentColor: '#8fb356' },
  ],
  library: [
    { clip: 'prop_lib_shelf', category: PROP_SOLID, size: 4.0, halfW: 1.6, halfD: 0.6 },
    { clip: 'prop_lib_column', category: PROP_SOLID, size: 3.6, halfW: 0.8, halfD: 0.8 },
    { clip: 'prop_lib_table', category: PROP_SOLID, size: 3.4, halfW: 1.6, halfD: 0.7 },
    { clip: 'prop_lib_lamp', category: PROP_BREAKABLE, size: 1.7, halfW: 0.4, halfD: 0.4, hp: 12, fragmentColor: '#b98aff' },
    { clip: 'prop_lib_vase', category: PROP_BREAKABLE, size: 1.5, halfW: 0.45, halfD: 0.45, hp: 10, fragmentColor: '#c9a227' },
  ],
};

const CAPACITY = 96;
/** Cell size for the static broad-phase grid, in world units. */
const CELL = 6;
/** Nothing spawns inside this radius of the run's start, so the player is never boxed in at spawn. */
const SPAWN_CLEARANCE = 7;
/**
 * Props further than this from the player are recycled to a fresh spot ahead
 * of them. The arena is 280x280 but the camera only shows ~35x20 units, so
 * scattering a few dozen props over the whole map means the player would
 * essentially never meet one. Keeping a fixed, small population orbiting the
 * player is what delivers "8-16 interactive objects around the playable area"
 * without ever filling the map with hundreds of colliders.
 */
const RECYCLE_DISTANCE = 48;
/** Recycled props land in this annulus around the player - never on top of them, never off-camera-forever. */
const RECYCLE_MIN = 16;
const RECYCLE_MAX = 34;
/** Seconds between recycle sweeps. Props are static, so this need not be per-frame. */
const RECYCLE_INTERVAL = 0.5;

export class WorldProps {
  readonly batch: InstancedBillboardBatch;
  readonly shadowBatch: ShadowBatch;

  readonly posX = new Float32Array(CAPACITY);
  readonly posZ = new Float32Array(CAPACITY);
  readonly halfW = new Float32Array(CAPACITY);
  readonly halfD = new Float32Array(CAPACITY);
  readonly hp = new Float32Array(CAPACITY);
  readonly alive = new Uint8Array(CAPACITY);
  readonly category = new Uint8Array(CAPACITY);
  readonly flashTimer = new Float32Array(CAPACITY);

  private readonly defIndex = new Int16Array(CAPACITY);
  private defs: PropDef[] = [];
  private count = 0;

  /** Static broad-phase grid: cell key -> prop indices. Built once in populate(). */
  private readonly grid = new Map<number, number[]>();
  /** Scratch, reused so queries never allocate. */
  private readonly queryBuffer: number[] = [];
  private recycleTimer = 0;

  constructor() {
    this.batch = new InstancedBillboardBatch(CAPACITY, spriteAtlas.texture, 'world-props', false, RENDER_ORDER.enemy - 1);
    this.shadowBatch = new ShadowBatch(CAPACITY, 'world-prop-shadows');
  }

  /**
   * Lay out one stage's props. Solids are spread thinly so the arena stays
   * open; breakables are kept to a small active count so finding one still
   * feels like finding something.
   */
  populate(propSet: string, rng: () => number, solidCount = 14, breakableCount = 12): void {
    this.clear();
    // Loud fallback: a silent one is exactly how every stage ended up
    // furnished with graveyard props when the caller passed a stage id and
    // this table was keyed by short names.
    if (!STAGE_PROPS[propSet]) console.warn(`Unknown prop set "${propSet}"; falling back to graveyard.`);
    const catalogue = STAGE_PROPS[propSet] ?? STAGE_PROPS.graveyard;
    this.defs = catalogue;
    const solids = catalogue.filter((d) => d.category === PROP_SOLID);
    const breakables = catalogue.filter((d) => d.category === PROP_BREAKABLE);
    if (solids.length === 0 && breakables.length === 0) return;

    const place = (def: PropDef): void => {
      if (this.count >= CAPACITY) return;
      // Rejection-sample a spot that is clear of the spawn point and not
      // overlapping an existing prop - overlapping colliders are what create
      // the "stuck in geometry" feel.
      for (let attempt = 0; attempt < 24; attempt++) {
        // Seeded around the run's start, not across the whole 280x280 arena -
        // update() takes over and keeps them near the player from then on.
        const angle = rng() * Math.PI * 2;
        const dist = SPAWN_CLEARANCE + rng() * (RECYCLE_MAX - SPAWN_CLEARANCE);
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist;
        let clear = true;
        for (let i = 0; i < this.count; i++) {
          const minGap = this.halfW[i] + def.halfW + 2.2;
          if (Math.abs(this.posX[i] - x) < minGap && Math.abs(this.posZ[i] - z) < this.halfD[i] + def.halfD + 2.2) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        const index = this.count++;
        this.posX[index] = x;
        this.posZ[index] = z;
        this.halfW[index] = def.halfW;
        this.halfD[index] = def.halfD;
        this.hp[index] = def.hp ?? Infinity;
        this.alive[index] = 1;
        this.category[index] = def.category;
        this.flashTimer[index] = 0;
        this.defIndex[index] = catalogue.indexOf(def);
        return;
      }
    };

    for (let i = 0; i < solidCount; i++) place(solids[Math.floor(rng() * solids.length) % solids.length]);
    for (let i = 0; i < breakableCount; i++) place(breakables[Math.floor(rng() * breakables.length) % breakables.length]);

    this.rebuildGrid();
    this.renderAll();
  }

  /** Props are static, so this runs once per stage rather than per frame. */
  private rebuildGrid(): void {
    this.grid.clear();
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      // Register in every cell the collider touches, so a single-cell query
      // can never miss a prop that straddles a boundary.
      const minCX = Math.floor((this.posX[i] - this.halfW[i]) / CELL);
      const maxCX = Math.floor((this.posX[i] + this.halfW[i]) / CELL);
      const minCZ = Math.floor((this.posZ[i] - this.halfD[i]) / CELL);
      const maxCZ = Math.floor((this.posZ[i] + this.halfD[i]) / CELL);
      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cz = minCZ; cz <= maxCZ; cz++) {
          const key = (cx + 512) * 4096 + (cz + 512);
          let bucket = this.grid.get(key);
          if (!bucket) {
            bucket = [];
            this.grid.set(key, bucket);
          }
          bucket.push(i);
        }
      }
    }
  }

  /** Fills `out` with prop indices whose cell neighbourhood covers (x,z). Returns the count. */
  queryNear(x: number, z: number, out: number[]): number {
    let n = 0;
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.grid.get((cx + dx + 512) * 4096 + (cz + dz + 512));
        if (!bucket) continue;
        for (const i of bucket) {
          if (!this.alive[i] || this.category[i] !== PROP_SOLID) continue;
          // Cheap dedupe: a prop spanning several cells can appear twice.
          let seen = false;
          for (let k = 0; k < n; k++) {
            if (out[k] === i) {
              seen = true;
              break;
            }
          }
          if (!seen) out[n++] = i;
        }
      }
    }
    return n;
  }

  /**
   * Push a circle of `radius` at (x,z) out of any solid prop it overlaps, and
   * write the corrected position into `out`.
   *
   * Resolution is minimum-translation against the AABB, which gives natural
   * SLIDING: moving diagonally into a wall keeps the tangential component and
   * only cancels the normal one. Stopping the entity outright, or snapping it
   * to the surface, are what produce the sticking and jitter this must avoid.
   */
  resolve(x: number, z: number, radius: number, out: { x: number; z: number }): boolean {
    out.x = x;
    out.z = z;
    const n = this.queryNear(x, z, this.queryBuffer);
    let hit = false;
    for (let k = 0; k < n; k++) {
      const i = this.queryBuffer[k];
      const minX = this.posX[i] - this.halfW[i];
      const maxX = this.posX[i] + this.halfW[i];
      const minZ = this.posZ[i] - this.halfD[i];
      const maxZ = this.posZ[i] + this.halfD[i];

      const closestX = Math.max(minX, Math.min(out.x, maxX));
      const closestZ = Math.max(minZ, Math.min(out.z, maxZ));
      const dx = out.x - closestX;
      const dz = out.z - closestZ;
      const d2 = dx * dx + dz * dz;

      if (d2 > radius * radius) continue;

      if (d2 > 1e-8) {
        // Outside the box: push straight out along the surface normal.
        const d = Math.sqrt(d2);
        const push = radius - d;
        out.x += (dx / d) * push;
        out.z += (dz / d) * push;
      } else {
        // Centre is inside the box: eject along the shallowest axis so the
        // entity pops out the nearest face instead of being flung across.
        const toLeft = out.x - minX;
        const toRight = maxX - out.x;
        const toTop = out.z - minZ;
        const toBottom = maxZ - out.z;
        const minPen = Math.min(toLeft, toRight, toTop, toBottom);
        if (minPen === toLeft) out.x = minX - radius;
        else if (minPen === toRight) out.x = maxX + radius;
        else if (minPen === toTop) out.z = minZ - radius;
        else out.z = maxZ + radius;
      }
      hit = true;
    }
    return hit;
  }

  /**
   * Damage every BREAKABLE overlapping a circle. This is how weapons destroy
   * props: they never target one, they just happen to reach it, which is what
   * keeps an auto-battler feeling automatic.
   * Returns how many props were destroyed by this call.
   */
  damageArea(x: number, z: number, radius: number, amount: number): number {
    let destroyed = 0;
    const r2 = (radius + 1.2) * (radius + 1.2);
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i] || this.category[i] !== PROP_BREAKABLE) continue;
      const dx = this.posX[i] - x;
      const dz = this.posZ[i] - z;
      if (dx * dx + dz * dz > r2) continue;
      this.hp[i] -= amount;
      this.flashTimer[i] = 0.08;
      if (this.hp[i] <= 0) {
        this.destroy(i);
        destroyed++;
      }
    }
    return destroyed;
  }

  private destroy(index: number): void {
    this.alive[index] = 0;
    this.batch.hide(index);
    this.shadowBatch.hide(index);
    const def = this.defs[this.defIndex[index]];
    gameEvents.emit('propDestroyed', {
      x: this.posX[index],
      z: this.posZ[index],
      color: def?.fragmentColor ?? '#c9b7a0',
    });
  }

  /**
   * Per-frame work is only the hit-flash decay. Repositioning happens on a
   * slow timer (props are static between sweeps), and destroyed breakables are
   * recycled back in so the player keeps meeting a steady trickle rather than
   * clearing the map once and never seeing another.
   */
  update(dt: number, playerX: number, playerZ: number, rng: () => number): void {
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i] || this.flashTimer[i] <= 0) continue;
      this.flashTimer[i] = Math.max(0, this.flashTimer[i] - dt);
      dirty = true;
    }

    this.recycleTimer -= dt;
    if (this.recycleTimer <= 0) {
      this.recycleTimer = RECYCLE_INTERVAL;
      if (this.recycleFarProps(playerX, playerZ, rng)) {
        this.rebuildGrid();
        dirty = true;
      }
    }

    if (dirty) this.renderAll();
  }

  /** Moves left-behind (and destroyed) props into the annulus around the player. Returns true if anything moved. */
  private recycleFarProps(playerX: number, playerZ: number, rng: () => number): boolean {
    let moved = false;
    for (let i = 0; i < this.count; i++) {
      const dx = this.posX[i] - playerX;
      const dz = this.posZ[i] - playerZ;
      const far = dx * dx + dz * dz > RECYCLE_DISTANCE * RECYCLE_DISTANCE;
      if (this.alive[i] && !far) continue;
      // Destroyed props come back too, so breakables keep trickling in.
      for (let attempt = 0; attempt < 12; attempt++) {
        const angle = rng() * Math.PI * 2;
        const dist = RECYCLE_MIN + rng() * (RECYCLE_MAX - RECYCLE_MIN);
        const x = Math.max(-WORLD.halfExtent + 6, Math.min(WORLD.halfExtent - 6, playerX + Math.cos(angle) * dist));
        const z = Math.max(-WORLD.halfExtent + 6, Math.min(WORLD.halfExtent - 6, playerZ + Math.sin(angle) * dist));
        let clear = true;
        for (let j = 0; j < this.count; j++) {
          if (j === i || !this.alive[j]) continue;
          const gapX = this.halfW[j] + this.halfW[i] + 2.4;
          const gapZ = this.halfD[j] + this.halfD[i] + 2.4;
          if (Math.abs(this.posX[j] - x) < gapX && Math.abs(this.posZ[j] - z) < gapZ) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        this.posX[i] = x;
        this.posZ[i] = z;
        const def = this.defs[this.defIndex[i]];
        this.hp[i] = def?.hp ?? Infinity;
        this.alive[i] = 1;
        this.flashTimer[i] = 0;
        moved = true;
        break;
      }
    }
    return moved;
  }

  private renderAll(): void {
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) {
        this.batch.hide(i);
        this.shadowBatch.hide(i);
        continue;
      }
      const def = this.defs[this.defIndex[i]];
      const uv = spriteAtlas.hasClip(def.clip) ? spriteAtlas.getUV(spriteAtlas.getClip(def.clip).cells[0]) : spriteAtlas.getUV(0);
      this.batch.set(i, this.posX[i], LAYER_Y.enemy - 0.002, this.posZ[i], uv, def.size, def.size, 1, 1, 1, 1, this.flashTimer[i] > 0 ? 1 : 0);
      this.shadowBatch.set(i, this.posX[i], this.posZ[i], Math.max(this.halfW[i], this.halfD[i]) * 1.15);
    }
    this.batch.commit();
    this.shadowBatch.commit();
  }

  get activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.alive[i]) n++;
    return n;
  }

  /** QA helper: every live prop, for tests and inspection. */
  list(): Array<{ index: number; x: number; z: number; category: number; hp: number; halfW: number; halfD: number }> {
    const out = [];
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      out.push({ index: i, x: this.posX[i], z: this.posZ[i], category: this.category[i], hp: this.hp[i], halfW: this.halfW[i], halfD: this.halfD[i] });
    }
    return out;
  }

  clear(): void {
    for (let i = 0; i < CAPACITY; i++) {
      this.alive[i] = 0;
      this.batch.hide(i);
      this.shadowBatch.hide(i);
    }
    this.count = 0;
    this.grid.clear();
    this.batch.commit();
    this.shadowBatch.commit();
  }

  dispose(): void {
    this.batch.dispose();
    this.shadowBatch.dispose();
  }
}
