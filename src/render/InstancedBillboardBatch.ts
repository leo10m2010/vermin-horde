import * as THREE from 'three';
import type { UVRect } from './SpriteAtlas';

const VERTEX_SHADER = /* glsl */ `
attribute vec4 aUvRect;
attribute vec3 aTint;
attribute vec2 aSize;
attribute float aAlpha;
attribute float aFlash;

varying vec2 vUv;
varying vec3 vTint;
varying float vAlpha;
varying float vFlash;

void main() {
  vUv = mix(aUvRect.xy, aUvRect.zw, uv);
  vTint = aTint;
  vAlpha = aAlpha;
  vFlash = aFlash;

  vec4 worldPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);

  vec3 camRight = vec3(viewMatrix[0].x, viewMatrix[1].x, viewMatrix[2].x);
  vec3 camUp = vec3(viewMatrix[0].y, viewMatrix[1].y, viewMatrix[2].y);

  vec3 vertexWorld = worldPos.xyz
      + camRight * position.x * aSize.x
      + camUp * position.y * aSize.y;

  gl_Position = projectionMatrix * viewMatrix * vec4(vertexWorld, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec3 vTint;
varying float vAlpha;
varying float vFlash;

void main() {
  vec4 tex = texture2D(map, vUv);
  if (tex.a * vAlpha < 0.06) discard;
  vec3 color = mix(tex.rgb * vTint, vec3(1.0, 1.0, 1.0), vFlash);
  gl_FragColor = vec4(color, tex.a * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const HIDDEN_Y = -5000;

/**
 * A pool of camera-facing billboard sprites rendered as a single
 * InstancedMesh draw call, all sampling one shared texture atlas. Position
 * is stored in the per-instance matrix (translation only); size, atlas UV
 * rect, tint, alpha and hit-flash are instanced attributes so thousands of
 * sprites can be pushed to the GPU without per-entity Object3D overhead.
 */
export class InstancedBillboardBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  private readonly uvRectAttr: THREE.InstancedBufferAttribute;
  private readonly tintAttr: THREE.InstancedBufferAttribute;
  private readonly sizeAttr: THREE.InstancedBufferAttribute;
  private readonly alphaAttr: THREE.InstancedBufferAttribute;
  private readonly flashAttr: THREE.InstancedBufferAttribute;
  private readonly dummy = new THREE.Object3D();
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(capacity: number, texture: THREE.Texture, name: string, alwaysOnTop = false, renderOrder = 0) {
    this.capacity = capacity;

    this.geometry = new THREE.BufferGeometry();
    // Feet-anchored quad: x spans [-0.5, 0.5], y spans [0, 1] so aSize scales
    // the sprite upward from its ground position instead of from its center.
    this.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3),
    );
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    this.geometry.setIndex([0, 1, 2, 2, 1, 3]);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: true,
      // `alwaysOnTop` (used for the player) skips the depth test entirely so
      // the player sprite is never buried under an overlapping pile of
      // enemies - readability trumps physical depth correctness here.
      depthTest: !alwaysOnTop,
      // Facing flips (player/enemies/projectiles all mirror left-facing
      // sprites by negating aSize.x - see Player.ts/EnemyManager.ts/
      // ProjectileManager.ts) reverse the quad's screen-space winding order.
      // With the default FrontSide, WebGL's backface culling then discarded
      // the whole sprite any time it faced left - DoubleSide keeps both
      // winding orders visible so mirrored billboards still render.
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.name = name;
    this.mesh.frustumCulled = false; // instances move independently; whole-mesh bounds would cull the batch prematurely
    this.mesh.count = capacity;
    // Ground decals and contact shadows must paint UNDER whatever stands on
    // them. Now that every ground-contact layer shares nearly the same world
    // Y (see LAYER_Y), the depth buffer can no longer be relied on to order
    // them, so batches declare their order explicitly.
    this.mesh.renderOrder = alwaysOnTop ? 50 : renderOrder;

    this.uvRectAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    this.sizeAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2).fill(1), 2);
    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
    this.flashAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    for (const attr of [this.uvRectAttr, this.tintAttr, this.sizeAttr, this.alphaAttr, this.flashAttr]) {
      attr.setUsage(THREE.DynamicDrawUsage);
    }
    this.geometry.setAttribute('aUvRect', this.uvRectAttr);
    this.geometry.setAttribute('aTint', this.tintAttr);
    this.geometry.setAttribute('aSize', this.sizeAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setAttribute('aFlash', this.flashAttr);

    for (let i = 0; i < capacity; i++) this.hide(i);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  set(
    index: number,
    x: number,
    y: number,
    z: number,
    uv: UVRect,
    sizeX: number,
    sizeY: number,
    tintR = 1,
    tintG = 1,
    tintB = 1,
    alpha = 1,
    flash = 0,
  ): void {
    this.dummy.position.set(x, y, z);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
    this.uvRectAttr.setXYZW(index, uv[0], uv[1], uv[2], uv[3]);
    this.sizeAttr.setXY(index, sizeX, sizeY);
    this.tintAttr.setXYZ(index, tintR, tintG, tintB);
    this.alphaAttr.setX(index, alpha);
    this.flashAttr.setX(index, flash);
  }

  hide(index: number): void {
    this.dummy.position.set(0, HIDDEN_Y, 0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
    this.alphaAttr.setX(index, 0);
  }

  /** Call once per frame after all set()/hide() calls for this batch. */
  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.uvRectAttr.needsUpdate = true;
    this.tintAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.flashAttr.needsUpdate = true;
  }

  /** Swap the sampled atlas texture (e.g. once SpriteAtlas.build() has rasterized real pixels). */
  setTexture(texture: THREE.Texture): void {
    this.material.uniforms.map.value = texture;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
