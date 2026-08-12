import * as THREE from 'three';
import { LAYER_Y } from '../core/Constants';
import type { EnemyManager } from '../entities/EnemyManager';

// Elites otherwise only differ from trash mobs by being ~1.4x bigger
// (`scaleMult`) - no color/glow cue. This adds a lightweight pulsing ground
// ring under every currently-alive elite so "elite nearby" reads instantly,
// without touching EnemyManager's per-type tint. Deep violet is deliberately
// distinct from BossTelegraphRings' orange/red so players never confuse
// "elite nearby" with "incoming boss attack".
const MAX_AURA_SLOTS = 32;
const AURA_COLOR = '#8a2be2';
const RING_INNER_FRACTION = 0.72;
const PULSE_HZ = 2.2;

/**
 * Pooled, scan-driven ground-ring glow for elite enemies. Unlike
 * BossTelegraphRings (event-spawned, individually timed), this reads
 * `EnemyManager`'s live arrays every frame and assigns up to
 * MAX_AURA_SLOTS pooled ring meshes to whichever elites are currently alive
 * - no acquire/release bookkeeping needed since ring identity doesn't need
 * to persist across frames, only its position/visibility. Elites are rare
 * even late-game, so if more than MAX_AURA_SLOTS are alive at once the
 * overflow simply goes without an aura rather than growing the pool.
 */
export class EliteAura {
  private readonly capacity = MAX_AURA_SLOTS;
  private readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly materials: THREE.MeshBasicMaterial[] = [];
  private clock = 0;

  constructor() {
    this.group.name = 'vfx-elite-auras';
    // Low segment count on purpose: the rest of the game is chunky
    // hard-edged pixel art (see PixelDraw.ts), so a near-perfectly-smooth
    // THREE.RingGeometry circle reads as a stray modern-UI element rather
    // than an intentional effect. A faceted low-poly decagon still clearly
    // reads as "ring" while matching that retro, low-fidelity house style.
    this.geometry = new THREE.RingGeometry(RING_INNER_FRACTION, 1, 10);
    this.geometry.rotateX(-Math.PI / 2);

    for (let i = 0; i < this.capacity; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: AURA_COLOR,
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

  /** Director calls this every frame, passing the live EnemyManager so this
   * can scan its public isElite/posX/posZ/alive/radius arrays directly. */
  update(dt: number, enemies: EnemyManager): void {
    this.clock += dt;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * Math.PI * PULSE_HZ);

    let slot = 0;
    for (let i = 0; i < enemies.capacity && slot < this.capacity; i++) {
      if (!enemies.alive[i] || !enemies.isElite[i]) continue;

      const mesh = this.meshes[slot];
      const material = this.materials[slot];
      const ringRadius = enemies.radius[i] * 1.8 + 0.15;
      mesh.position.set(enemies.posX[i], LAYER_Y.ground + 0.02, enemies.posZ[i]);
      mesh.scale.set(ringRadius, ringRadius, ringRadius);
      mesh.visible = true;
      material.opacity = 0.32 + 0.38 * pulse;
      slot++;
    }

    // Hide any leftover slots from a frame where more elites were alive.
    for (; slot < this.capacity; slot++) {
      this.meshes[slot].visible = false;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
