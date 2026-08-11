import * as THREE from 'three';
import { CAMERA } from '../core/Constants';

/**
 * Orthographic camera held at a fixed elevation angle above the ground plane
 * and smoothly following the player on X/Z. The elevation keeps billboarded
 * pixel-art sprites readable (they always face this camera) while the
 * overall framing still reads as top-down.
 */
export class CameraRig {
  private readonly followTarget = new THREE.Vector3();
  private readonly shakeOffset = new THREE.Vector2();
  private shakeTime = 0;
  private shakeDuration = 0;
  private shakeIntensity = 0;
  private readonly rng = () => Math.random();

  private readonly offset: THREE.Vector3;

  constructor(private readonly camera: THREE.OrthographicCamera) {
    const rad = THREE.MathUtils.degToRad(CAMERA.elevationDeg);
    this.offset = new THREE.Vector3(0, Math.sin(rad) * CAMERA.distance, Math.cos(rad) * CAMERA.distance);
  }

  snapTo(target: THREE.Vector3): void {
    this.followTarget.copy(target);
    this.applyPosition(1);
  }

  update(delta: number, target: THREE.Vector3): void {
    const factor = 1 - Math.exp(-delta / Math.max(0.001, CAMERA.followLag));
    this.followTarget.lerp(target, factor);
    this.applyPosition(1);

    if (this.shakeDuration > 0) {
      this.shakeTime += delta;
      const t = this.shakeTime / this.shakeDuration;
      if (t >= 1) {
        this.shakeDuration = 0;
        this.shakeOffset.set(0, 0);
      } else {
        const falloff = 1 - t;
        const mag = this.shakeIntensity * falloff;
        this.shakeOffset.set((this.rng() * 2 - 1) * mag, (this.rng() * 2 - 1) * mag);
      }
      this.camera.position.x += this.shakeOffset.x;
      this.camera.position.y += this.shakeOffset.y;
    }
  }

  shake(intensity: number, duration: number): void {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeDuration = Math.max(this.shakeDuration, duration);
    this.shakeTime = 0;
  }

  private applyPosition(_factor: number): void {
    this.camera.position.set(
      this.followTarget.x + this.offset.x,
      this.followTarget.y + this.offset.y,
      this.followTarget.z + this.offset.z,
    );
    this.camera.lookAt(this.followTarget.x, this.followTarget.y, this.followTarget.z);
  }

  get target(): THREE.Vector3 {
    return this.followTarget;
  }
}
