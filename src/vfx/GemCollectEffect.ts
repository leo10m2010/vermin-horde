import * as THREE from 'three';
import { LAYER_Y } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import { IndexPool } from '../core/ObjectPool';
import { GEM_TIERS, tierFor } from '../entities/GemManager';

// Pooled ground-ring bursts fired on gem pickup. Distinct from
// ParticleSystem's small pickup sparkle (read-only, untouched): this is a
// bigger, tier-colored expanding ring of light so a big gold gem visibly
// reads as more exciting to collect than a small blue one.
const MAX_CONCURRENT_BURSTS = 12;
const BURST_LIFE = 0.3; // seconds - matches the "fading over ~0.3s" spec
const RING_INNER_FRACTION = 0.5; // inner radius as a fraction of the outer (unit) ring geometry
const RING_SEGMENTS = 28;

function tintToHex(tint: [number, number, number]): string {
  const channel = (v: number) => Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  return `#${channel(tint[0])}${channel(tint[1])}${channel(tint[2])}`;
}

/**
 * Pooled expanding-ring collection burst, triggered by `gameEvents.on('gemCollected', ...)`.
 * Reuses the BossTelegraphRings technique (one shared unit RingGeometry,
 * scaled per-frame instead of rebuilt) so up to MAX_CONCURRENT_BURSTS
 * simultaneous pickups - common during heavy combat - cost almost nothing.
 * Radius, brightness and instance count scale with the gem's value tier
 * (mirrors GEM_TIERS from GemManager so colors match the gem that popped).
 */
export class GemCollectEffect {
  private readonly capacity = MAX_CONCURRENT_BURSTS;
  private readonly pool = new IndexPool(this.capacity);
  private readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly materials: THREE.MeshBasicMaterial[] = [];

  private readonly alive = new Uint8Array(this.capacity);
  private readonly life = new Float32Array(this.capacity);
  private readonly maxLife = new Float32Array(this.capacity);
  private readonly endRadius = new Float32Array(this.capacity);
  private readonly peakOpacity = new Float32Array(this.capacity);

  private readonly unsubscribe: () => void;

  constructor() {
    this.group.name = 'vfx-gem-collect-bursts';
    this.geometry = new THREE.RingGeometry(RING_INNER_FRACTION, 1, RING_SEGMENTS);
    this.geometry.rotateX(-Math.PI / 2);

    for (let i = 0; i < this.capacity; i++) {
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
      mesh.position.y = LAYER_Y.gem + 0.05;
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.materials.push(material);
    }

    this.unsubscribe = gameEvents.on('gemCollected', (e) => this.trigger(e.x, e.z, e.value));
  }

  get object3D(): THREE.Object3D {
    return this.group;
  }

  private trigger(x: number, z: number, value: number): void {
    const tier = tierFor(value);
    const tierInfo = GEM_TIERS[tier];
    const color = tintToHex(tierInfo.tint);
    const baseRadius = 0.9 + tier * 0.45; // bigger burst for higher-value gems
    const baseOpacity = 0.55 + tier * 0.12; // brighter for higher-value gems

    this.spawnRing(x, z, baseRadius, baseOpacity, color);
    // Top two tiers (pink/gold, value>=25) get a second, larger/dimmer ring
    // riding along for extra visual weight - cheap way to scale "particle
    // count" with value without a second effect system.
    if (tier >= 2) this.spawnRing(x, z, baseRadius * 1.55, baseOpacity * 0.6, color);
  }

  private spawnRing(x: number, z: number, endRadius: number, peakOpacity: number, color: string): void {
    const index = this.pool.acquire();
    if (index === -1) return; // pool exhausted; drop, this is a cosmetic flourish

    const mesh = this.meshes[index];
    const material = this.materials[index];
    material.color.set(color);
    mesh.position.set(x, LAYER_Y.gem + 0.05, z);
    mesh.scale.set(0.001, 0.001, 0.001);
    mesh.visible = true;

    this.endRadius[index] = endRadius;
    this.peakOpacity[index] = peakOpacity;
    this.life[index] = BURST_LIFE;
    this.maxLife[index] = BURST_LIFE;
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

      const t = 1 - this.life[i] / this.maxLife[i]; // 0 -> 1 over the burst's life
      const eased = 1 - (1 - t) * (1 - t); // ease-out: fast expansion, settles near the end
      const r = Math.max(0.001, this.endRadius[i] * eased);
      this.meshes[i].scale.set(r, r, r);
      this.materials[i].opacity = this.peakOpacity[i] * (1 - t);
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
