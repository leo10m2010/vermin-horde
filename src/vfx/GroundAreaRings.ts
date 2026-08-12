import * as THREE from 'three';
import { LAYER_Y } from '../core/Constants';
import { IndexPool } from '../core/ObjectPool';

const RING_INNER_FRACTION = 0.78;

/**
 * Generic pooled flat ground-ring renderer for weapon-owned AoE indicators
 * (Garlic's permanent aura, Hex Flask's lingering zones). Uses the same flat
 * `RingGeometry` laid on the XZ ground plane as EliteAura/BossTelegraphRings,
 * instead of a camera-facing billboard sprite - a billboard "ring" stands up
 * like a wall facing the camera, so the player's feet-anchored sprite ends up
 * visually buried near its base instead of standing inside a ring that reads
 * as flat ground around them. Low segment count matches the chunky pixel-art
 * house style (see EliteAura's comment for the full rationale).
 *
 * Fully caller-driven lifetime (acquire once, `set()` every frame while
 * active, `release()` when done) - unlike BossTelegraphRings' self-expiring
 * slots, since callers here (weapon `update()` methods) already track their
 * own duration/removal logic.
 */
export class GroundAreaRings {
  private readonly pool: IndexPool;
  private readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly materials: THREE.MeshBasicMaterial[] = [];

  constructor(capacity: number, name: string) {
    this.pool = new IndexPool(capacity);
    this.group.name = name;
    this.geometry = new THREE.RingGeometry(RING_INNER_FRACTION, 1, 10);
    this.geometry.rotateX(-Math.PI / 2);

    for (let i = 0; i < capacity; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.position.y = LAYER_Y.ground + 0.02;
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.materials.push(material);
    }
  }

  get object3D(): THREE.Object3D {
    return this.group;
  }

  /** Reserve a slot; returns -1 if the pool is exhausted (caller should skip the visual, never block gameplay on it). */
  acquire(): number {
    return this.pool.acquire();
  }

  release(index: number): void {
    if (index === -1) return;
    this.meshes[index].visible = false;
    this.pool.release(index);
  }

  /** Update a held slot's position/size/color for this frame. Call every frame the slot is active - there is no built-in fade or lifetime. */
  /**
   * QA/inspection: the world-unit radius each visible ring is currently drawn
   * at. Lets a test assert that a weapon's DRAWN area is the same number as
   * its DAMAGING area, instead of trusting that the two code paths agree.
   */
  activeRadii(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      if (mesh.visible) out.push(mesh.scale.x);
    }
    return out;
  }

  set(index: number, x: number, z: number, radius: number, color: string, opacity = 0.5): void {
    if (index === -1) return;
    const mesh = this.meshes[index];
    mesh.position.set(x, LAYER_Y.ground + 0.02, z);
    mesh.scale.set(radius, radius, radius);
    mesh.visible = true;
    this.materials[index].color.set(color);
    this.materials[index].opacity = opacity;
  }

  /** Hide and free every slot (run restart). */
  clear(): void {
    for (const mesh of this.meshes) mesh.visible = false;
    this.pool.reset();
  }

  dispose(): void {
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
