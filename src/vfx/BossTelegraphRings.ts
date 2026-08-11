import * as THREE from 'three';
import { LAYER_Y } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import { IndexPool } from '../core/ObjectPool';

const MAX_CONCURRENT_RINGS = 8;
const RING_INNER_FRACTION = 0.82; // inner radius as a fraction of the outer (unit) ring geometry
const PULSE_HZ = 5.5;

/**
 * Pooled ground warning rings for boss-telegraphed attacks
 * (`gameEvents.on('bossTelegraph', ...)`). Geometry is a single unit ring
 * shared by every slot and scaled per-frame instead of rebuilt, so up to 8
 * concurrent telegraphs cost almost nothing.
 */
export class BossTelegraphRings {
  private readonly capacity = MAX_CONCURRENT_RINGS;
  private readonly pool = new IndexPool(this.capacity);
  private readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly materials: THREE.MeshBasicMaterial[] = [];

  private readonly alive = new Uint8Array(this.capacity);
  private readonly life = new Float32Array(this.capacity);
  private readonly maxLife = new Float32Array(this.capacity);
  private readonly startRadius = new Float32Array(this.capacity);
  private readonly endRadius = new Float32Array(this.capacity);

  private readonly unsubscribe: () => void;

  constructor() {
    this.group.name = 'vfx-boss-telegraphs';
    this.geometry = new THREE.RingGeometry(RING_INNER_FRACTION, 1, 40);
    this.geometry.rotateX(-Math.PI / 2);

    for (let i = 0; i < this.capacity; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: '#ff8a3d',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.position.y = LAYER_Y.ground + 0.03;
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.materials.push(material);
    }

    this.unsubscribe = gameEvents.on('bossTelegraph', (e) => {
      this.spawn(e.x, e.z, e.radius, e.delaySeconds, e.color);
    });
  }

  get object3D(): THREE.Object3D {
    return this.group;
  }

  spawn(x: number, z: number, radius: number, delaySeconds: number, color?: string): void {
    const index = this.pool.acquire();
    if (index === -1) return; // all slots busy - drop, telegraphs are advisory only

    const mesh = this.meshes[index];
    const material = this.materials[index];
    material.color.set(color ?? '#ff8a3d');
    mesh.position.set(x, LAYER_Y.ground + 0.03, z);
    mesh.visible = true;

    this.startRadius[index] = Math.max(0.2, radius * 0.15);
    this.endRadius[index] = Math.max(radius, 0.5);
    const life = Math.max(0.05, delaySeconds);
    this.life[index] = life;
    this.maxLife[index] = life;
    this.alive[index] = 1;
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive[i] = 0;
        this.meshes[i].visible = false;
        this.pool.release(i);
        continue;
      }

      const t = 1 - this.life[i] / this.maxLife[i];
      const r = THREE.MathUtils.lerp(this.startRadius[i], this.endRadius[i], t);
      this.meshes[i].scale.set(r, r, r);

      const pulse = 0.35 + 0.5 * Math.abs(Math.sin(t * Math.PI * PULSE_HZ));
      const fadeIn = Math.min(1, t / 0.1);
      this.materials[i].opacity = pulse * fadeIn * 0.85;
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
