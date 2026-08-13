import * as THREE from 'three';
import { LAYER_Y, RENDER_ORDER } from '../core/Constants';

const HIDDEN_Y = -5000;
const TEXTURE_SIZE = 64;

/** Soft radial-gradient blob, generated once and shared by every ShadowBatch instance (player + enemies both call this once at construction). */
function createShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d')!;
  const r = TEXTURE_SIZE / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.6, 'rgba(0,0,0,0.4)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/**
 * Flat (not billboarded) soft-shadow decal instanced batch: one draw call for
 * up to `capacity` blob shadows lying on the XZ ground plane, so characters
 * and enemies never look like they're floating over the arena (reference:
 * section 15/22 of the visual-pass brief - fake/instanced shadows, never a
 * real shadowMap per entity). No custom shader needed - standard
 * InstancedMesh + MeshBasicMaterial, position/scale driven entirely through
 * the per-instance matrix so it costs nothing extra to update alongside each
 * manager's existing struct-of-arrays loop.
 */
export class ShadowBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  private readonly dummy = new THREE.Object3D();
  private readonly texture: THREE.CanvasTexture;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(capacity: number, name: string) {
    this.capacity = capacity;
    this.texture = createShadowTexture();

    // PlaneGeometry lies in the XY plane by default; rotate flat onto XZ so
    // it reads as a ground decal under the fixed-elevation ortho camera
    // instead of a vertical billboard card.
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.count = capacity;
    this.mesh.renderOrder = RENDER_ORDER.shadow; // above the ground plane and weapon ground zones, below every sprite batch

    for (let i = 0; i < capacity; i++) this.hide(i);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** `radiusZ` defaults to a flatter ellipse than `radiusX` - reads as a shadow cast on a top-down-ish camera instead of a perfect circle. */
  set(index: number, x: number, z: number, radiusX: number, radiusZ = radiusX * 0.62): void {
    this.dummy.position.set(x, LAYER_Y.decor, z);
    this.dummy.scale.set(radiusX, 1, radiusZ);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
  }

  hide(index: number): void {
    this.dummy.position.set(0, HIDDEN_Y, 0);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
  }

  /** Call once per frame after all set()/hide() calls for this batch. */
  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
