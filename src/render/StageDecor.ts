import { LAYER_Y, WORLD } from '../core/Constants';
import { InstancedBillboardBatch } from './InstancedBillboardBatch';
import { spriteAtlas } from './SpriteAtlas';
import type { StageDef } from '../game/Stages';

// Room for a healthy scatter of props while staying a single draw call -
// see InstancedBillboardBatch. Mirrors the "own a capacity, own a batch"
// shape used throughout src/entities (GemManager, etc).
const CAPACITY = 220;

// Which registerDecorSprites() clip names (see SpriteLibrary.ts) belong to
// each stage, keyed by StageDef.id. Hardcoded here rather than added to
// StageDef itself since this mapping is purely a rendering concern.
const DECOR_CLIPS_BY_STAGE: Record<string, string[]> = {
  moonlit_graveyard: ['decor_graveyard_tombstone_0', 'decor_graveyard_tombstone_1', 'decor_graveyard_tombstone_2'],
  cursed_forest: ['decor_forest_tree_0', 'decor_forest_tree_1', 'decor_forest_tree_2'],
  ruined_library: ['decor_library_shelf_0', 'decor_library_shelf_1', 'decor_library_scrolls_0'],
};

// Scatter across most of the world but stop a bit short of the very edge
// (rarely fought over) so prop density reads highest where the player
// actually spends time.
const SCATTER_RADIUS = WORLD.halfExtent * 0.92;

/**
 * Static, purely-decorative pixel-art props scattered across the ground per
 * stage (tombstones / twisted trees / bookshelves - see
 * `registerDecorSprites()` in SpriteLibrary.ts). Non-interactive, no
 * collision: this exists solely so each stage's ground-color swap
 * (Stages.ts / WorldGround.ts) reads as its own place instead of just a
 * tint change.
 *
 * Mirrors the shape of GemManager/etc (own a capacity, own an
 * InstancedBillboardBatch constructed early with spriteAtlas.texture as a
 * placeholder, expose `.batch.mesh` for the scene and `.batch` so its
 * texture can be rebound later). Unlike those managers, decor never moves
 * or animates once placed, so there is deliberately no per-frame update() -
 * populate() lays out the whole scatter once and commits it.
 */
export class StageDecor {
  readonly batch: InstancedBillboardBatch;
  private activeCount = 0;

  constructor() {
    this.batch = new InstancedBillboardBatch(CAPACITY, spriteAtlas.texture, 'stageDecor');
  }

  /** Clears any previous scatter and lays out a fresh deterministic scatter of decor props for this stage. */
  populate(stage: StageDef, rng: () => number): void {
    this.clear();

    const clipNames = DECOR_CLIPS_BY_STAGE[stage.id];
    if (!clipNames || clipNames.length === 0) return;

    // ~150-220 props per stage - dense enough to read as scenery, well
    // under the InstancedBillboardBatch capacity.
    const propCount = Math.min(CAPACITY, 150 + Math.floor(rng() * 70));

    for (let i = 0; i < propCount; i++) {
      // Uniform-area disc sampling (sqrt on the radius term) so props don't
      // bunch up near the center the way naive polar sampling would.
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(rng()) * SCATTER_RADIUS;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const clipName = clipNames[Math.floor(rng() * clipNames.length)];
      const clip = spriteAtlas.getClip(clipName);
      const uv = spriteAtlas.getUV(clip.cells[0]);

      // Gentle per-instance scale variety so the scatter doesn't look stamped.
      const size = 1.3 + rng() * 0.9;

      this.batch.set(i, x, LAYER_Y.decor, z, uv, size, size);
    }

    this.activeCount = propCount;
    this.batch.commit();
  }

  clear(): void {
    for (let i = 0; i < this.activeCount; i++) this.batch.hide(i);
    this.activeCount = 0;
    this.batch.commit();
  }

  dispose(): void {
    this.batch.dispose();
  }
}
