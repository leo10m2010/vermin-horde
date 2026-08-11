import * as THREE from 'three';
import { LAYER_Y } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import { IndexPool } from '../core/ObjectPool';

const RING_POOL_SIZE = 8;
const RAY_POOL_SIZE = 8;
const RING_INNER_FRACTION = 0.85; // inner radius as a fraction of the outer (unit) ring geometry
const RAYS_PER_FLOURISH = 10; // spokes baked into the single shared ray-fan mesh
const RING_Y = LAYER_Y.ground + 0.05; // just above BossTelegraphRings' 0.03 to avoid z-fighting
const RAY_BASE_Y = LAYER_Y.ground + 0.04;

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

/**
 * Builds one static "starburst crown" shape: `count` thin tapered blades
 * standing vertical around the origin, radiating outward as they rise from
 * y=0 to y=1 (unit height, unit outer radius). Baked once and reused by
 * every pooled ray-flourish slot below - each trigger only scales/rotates/
 * fades an existing mesh via its transform and material.opacity, no
 * per-trigger geometry allocation.
 */
function buildRayFanGeometry(count: number): THREE.BufferGeometry {
  const innerR = 0.25;
  const outerR = 1;
  const baseWidth = 0.16;
  const tipWidth = 0.03;
  const height = 1;

  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const rx = Math.cos(angle);
    const rz = Math.sin(angle);
    const tx = -Math.sin(angle);
    const tz = Math.cos(angle);

    const baseCx = rx * innerR;
    const baseCz = rz * innerR;
    const tipCx = rx * outerR;
    const tipCz = rz * outerR;

    const v0 = positions.length / 3;
    positions.push(baseCx + tx * (baseWidth / 2), 0, baseCz + tz * (baseWidth / 2));
    positions.push(baseCx - tx * (baseWidth / 2), 0, baseCz - tz * (baseWidth / 2));
    positions.push(tipCx - tx * (tipWidth / 2), height, tipCz - tz * (tipWidth / 2));
    positions.push(tipCx + tx * (tipWidth / 2), height, tipCz + tz * (tipWidth / 2));

    indices.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  // Manual bound: local shape spans outerR (1) horizontally and height (1)
  // vertically from the origin, so a radius-2 sphere centered mid-height is
  // a safe superset without paying for computeBoundingSphere() per rebuild.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 2);
  return geometry;
}

interface RingConfig {
  startRadius: number;
  endRadius: number;
  life: number;
  color: string;
  peakOpacity: number;
}

interface RayConfig {
  life: number;
  color: string;
  radialScale: number;
  heightScale: number;
  spinSpeed: number; // radians/sec, applied cumulatively for a "power surge" spin
  startRotation: number;
  peakOpacity: number;
}

/**
 * Level-up / weapon-evolution "power surge" flourish: a bright flash/burst
 * of light radiating from the player the instant either event fires.
 * Built from two pooled-Mesh systems, both reusing a single shared unit
 * geometry per type (same technique as BossTelegraphRings) so a trigger
 * costs at most a handful of draw calls and zero per-trigger allocation:
 *
 *  1. Expanding/fading rings (flat on the ground, RingGeometry scaled
 *     per-frame) - the radial light burst.
 *  2. Rotating vertical "starburst crown" meshes (a fan of tapered blades
 *     baked into one BufferGeometry) - the light-rays flourish.
 *
 * Self-subscribes to `levelUp` / `weaponEvolved`; the director only needs
 * to add `object3D` to the scene, call `update(dt)` every frame, and call
 * `setAnchor(x, z)` every frame with the player's position (neither event
 * carries a position).
 */
export class LevelUpEffects {
  private readonly group = new THREE.Group();

  private readonly ringPool = new IndexPool(RING_POOL_SIZE);
  private readonly ringGeometry: THREE.BufferGeometry;
  private readonly ringMeshes: THREE.Mesh[] = [];
  private readonly ringMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly ringAlive = new Uint8Array(RING_POOL_SIZE);
  private readonly ringLife = new Float32Array(RING_POOL_SIZE);
  private readonly ringMaxLife = new Float32Array(RING_POOL_SIZE);
  private readonly ringStartRadius = new Float32Array(RING_POOL_SIZE);
  private readonly ringEndRadius = new Float32Array(RING_POOL_SIZE);
  private readonly ringPeakOpacity = new Float32Array(RING_POOL_SIZE);

  private readonly rayPool = new IndexPool(RAY_POOL_SIZE);
  private readonly rayGeometry: THREE.BufferGeometry;
  private readonly rayMeshes: THREE.Mesh[] = [];
  private readonly rayMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly rayAlive = new Uint8Array(RAY_POOL_SIZE);
  private readonly rayLife = new Float32Array(RAY_POOL_SIZE);
  private readonly rayMaxLife = new Float32Array(RAY_POOL_SIZE);
  private readonly rayRadialScale = new Float32Array(RAY_POOL_SIZE);
  private readonly rayHeightScale = new Float32Array(RAY_POOL_SIZE);
  private readonly raySpinSpeed = new Float32Array(RAY_POOL_SIZE);
  private readonly rayPeakOpacity = new Float32Array(RAY_POOL_SIZE);

  private anchorX = 0;
  private anchorZ = 0;

  private readonly unsubscribers: Array<() => void> = [];

  constructor() {
    this.group.name = 'vfx-levelup-effects';

    this.ringGeometry = new THREE.RingGeometry(RING_INNER_FRACTION, 1, 40);
    this.ringGeometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < RING_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: '#ffe066',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.ringGeometry, material);
      mesh.visible = false;
      mesh.position.y = RING_Y;
      this.group.add(mesh);
      this.ringMeshes.push(mesh);
      this.ringMaterials.push(material);
    }

    this.rayGeometry = buildRayFanGeometry(RAYS_PER_FLOURISH);
    for (let i = 0; i < RAY_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: '#ffe066',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.rayGeometry, material);
      mesh.visible = false;
      mesh.position.y = RAY_BASE_Y;
      this.group.add(mesh);
      this.rayMeshes.push(mesh);
      this.rayMaterials.push(material);
    }

    this.unsubscribers.push(
      gameEvents.on('levelUp', () => this.triggerLevelUp()),
      gameEvents.on('weaponEvolved', () => this.triggerWeaponEvolved()),
    );
  }

  get object3D(): THREE.Object3D {
    return this.group;
  }

  /** Director calls this every frame with the player's current world position, since `levelUp`/`weaponEvolved` events don't carry a position. */
  setAnchor(x: number, z: number): void {
    this.anchorX = x;
    this.anchorZ = z;
  }

  update(dt: number): void {
    for (let i = 0; i < RING_POOL_SIZE; i++) {
      if (!this.ringAlive[i]) continue;
      this.ringLife[i] -= dt;
      if (this.ringLife[i] <= 0) {
        this.ringAlive[i] = 0;
        this.ringMeshes[i].visible = false;
        this.ringPool.release(i);
        continue;
      }
      const t = 1 - this.ringLife[i] / this.ringMaxLife[i];
      const r = THREE.MathUtils.lerp(this.ringStartRadius[i], this.ringEndRadius[i], easeOutCubic(t));
      this.ringMeshes[i].scale.set(r, r, r);
      // Peaks bright at spawn (the "flash") and fades out - opposite curve
      // from BossTelegraphRings' fade-in warning pulse.
      this.ringMaterials[i].opacity = this.ringPeakOpacity[i] * Math.pow(1 - t, 1.4);
    }

    for (let i = 0; i < RAY_POOL_SIZE; i++) {
      if (!this.rayAlive[i]) continue;
      this.rayLife[i] -= dt;
      if (this.rayLife[i] <= 0) {
        this.rayAlive[i] = 0;
        this.rayMeshes[i].visible = false;
        this.rayPool.release(i);
        continue;
      }
      const t = 1 - this.rayLife[i] / this.rayMaxLife[i];
      const grow = easeOutCubic(Math.min(1, t * 2.2)); // full size by ~45% of life, then holds while fading
      const mesh = this.rayMeshes[i];
      mesh.scale.set(this.rayRadialScale[i] * grow, this.rayHeightScale[i] * grow, this.rayRadialScale[i] * grow);
      mesh.rotation.y += this.raySpinSpeed[i] * dt;
      this.rayMaterials[i].opacity = this.rayPeakOpacity[i] * Math.pow(1 - t, 1.6);
    }
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
    this.ringGeometry.dispose();
    for (const material of this.ringMaterials) material.dispose();
    this.rayGeometry.dispose();
    for (const material of this.rayMaterials) material.dispose();
  }

  private spawnRing(cfg: RingConfig): void {
    const index = this.ringPool.acquire();
    if (index === -1) return; // pool exhausted - drop, this is a flourish, not gameplay-critical
    const mesh = this.ringMeshes[index];
    const material = this.ringMaterials[index];
    material.color.set(cfg.color);
    mesh.position.set(this.anchorX, RING_Y, this.anchorZ);
    mesh.scale.set(cfg.startRadius, cfg.startRadius, cfg.startRadius);
    mesh.visible = true;
    this.ringStartRadius[index] = cfg.startRadius;
    this.ringEndRadius[index] = cfg.endRadius;
    this.ringLife[index] = cfg.life;
    this.ringMaxLife[index] = cfg.life;
    this.ringPeakOpacity[index] = cfg.peakOpacity;
    this.ringAlive[index] = 1;
  }

  private spawnRayFlourish(cfg: RayConfig): void {
    const index = this.rayPool.acquire();
    if (index === -1) return; // pool exhausted - drop
    const mesh = this.rayMeshes[index];
    const material = this.rayMaterials[index];
    material.color.set(cfg.color);
    mesh.position.set(this.anchorX, RAY_BASE_Y, this.anchorZ);
    mesh.rotation.y = cfg.startRotation;
    mesh.scale.set(0.01, 0.01, 0.01);
    mesh.visible = true;
    this.rayRadialScale[index] = cfg.radialScale;
    this.rayHeightScale[index] = cfg.heightScale;
    this.raySpinSpeed[index] = cfg.spinSpeed;
    this.rayLife[index] = cfg.life;
    this.rayMaxLife[index] = cfg.life;
    this.rayPeakOpacity[index] = cfg.peakOpacity;
    this.rayAlive[index] = 1;
  }

  private triggerLevelUp(): void {
    this.spawnRing({ startRadius: 0.3, endRadius: 3.0, life: 0.4, color: '#ffe066', peakOpacity: 0.95 });
    this.spawnRing({ startRadius: 0.6, endRadius: 4.2, life: 0.55, color: '#fff6d8', peakOpacity: 0.6 });
    this.spawnRayFlourish({
      life: 0.4,
      color: '#ffe066',
      radialScale: 1.6,
      heightScale: 1.4,
      spinSpeed: 3.0,
      startRotation: Math.random() * Math.PI * 2,
      peakOpacity: 0.85,
    });
  }

  private triggerWeaponEvolved(): void {
    // Bigger/brighter/longer than a plain level-up: more rings (4 vs 2), a
    // near-white flash ring at full opacity, and two counter-rotating ray
    // flourishes instead of one.
    this.spawnRing({ startRadius: 0.3, endRadius: 3.6, life: 0.5, color: '#fff6d8', peakOpacity: 1.0 });
    this.spawnRing({ startRadius: 0.5, endRadius: 4.8, life: 0.6, color: '#ffe066', peakOpacity: 0.85 });
    this.spawnRing({ startRadius: 0.8, endRadius: 5.6, life: 0.7, color: '#ffe066', peakOpacity: 0.6 });
    this.spawnRing({ startRadius: 1.0, endRadius: 6.4, life: 0.8, color: '#fff6d8', peakOpacity: 0.4 });

    const baseRotation = Math.random() * Math.PI * 2;
    this.spawnRayFlourish({
      life: 0.55,
      color: '#fff6d8',
      radialScale: 2.2,
      heightScale: 2.0,
      spinSpeed: 4.5,
      startRotation: baseRotation,
      peakOpacity: 1.0,
    });
    this.spawnRayFlourish({
      life: 0.6,
      color: '#ffe066',
      radialScale: 2.0,
      heightScale: 1.7,
      spinSpeed: -3.5,
      startRotation: baseRotation + Math.PI / RAYS_PER_FLOURISH,
      peakOpacity: 0.75,
    });
  }
}
