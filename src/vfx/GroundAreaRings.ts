import * as THREE from 'three';
import { LAYER_Y, RENDER_ORDER } from '../core/Constants';
import { IndexPool } from '../core/ObjectPool';

/**
 * Pooled GROUND ZONE renderer for weapon-owned AoE areas (Garlic's aura, Hex
 * Flask's lingering pools).
 *
 * Previously this drew a `RingGeometry(0.78, 1, 10)` - a hollow outline, only
 * 10 radial segments, additively blended in a flat colour. Even though the
 * geometry was already lying correctly on the XZ plane, the result read as a
 * suspended hoop the player stood inside: a hard-edged decagon with nothing
 * in the middle gives the eye no surface to attach to the floor, and the low
 * segment count made the polygon edges visible.
 *
 * It is now a filled disc with everything painted procedurally in one
 * fragment shader:
 *   - a soft radial fill that fades out well before the edge, so there is no
 *     hard boundary anywhere,
 *   - concentric waves crawling outward, which is what actually sells "this
 *     is a surface on the ground" rather than "this is a shape",
 *   - a wide, soft outer falloff instead of a drawn rim line,
 *   - a per-tick pulse that briefly brightens and swells the zone.
 *
 * Cost is unchanged in the ways that matter: one shared quad geometry, one
 * mesh per pooled slot (same as before), no per-frame allocation, no
 * textures. The extra "layers" are all maths inside a single draw, not extra
 * objects.
 *
 * Perspective is free: the quad lies flat on XZ, so the tilted camera already
 * projects the circle into the squashed ellipse the 2.5D read needs. Nothing
 * is manually flattened - doing that would double-apply the projection.
 */

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uPulse;      // 0..1, decays after each damage tick
uniform float uWaveScale;  // wave count scales with radius so big auras don't look stretched
uniform vec2 uCenter;      // world XZ of the zone centre
uniform float uRadius;     // world-unit radius, so noise can be sampled in WORLD space

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;

  // Sample noise in WORLD space, not sprite space. This is what makes the
  // energy look like it is crawling across the terrain: the pattern stays
  // pinned to the ground as the player walks, instead of sliding along with
  // the quad like a decal stuck to the camera.
  vec2 world = uCenter + p * uRadius;

  // Break the ring radius itself with noise so the bands are never perfect
  // circles - concentric maths is exactly what reads as a drawn plate.
  float warp = (valueNoise(world * 0.85 + uTime * 0.06) - 0.5) * 0.20;
  float rn = clamp(r + warp, 0.0, 1.0);

  // Soft outer falloff held out to the rim so the drawn edge matches the
  // damage radius rather than stopping short of it.
  float edge = 1.0 - smoothstep(0.86, 1.0, r);

  // Faint, uneven base wash. Deliberately low so the terrain texture still
  // reads THROUGH the zone - a flat opaque fill is what makes it look like a
  // transparent platform laid on the floor.
  float grain = valueNoise(world * 2.3 - uTime * 0.12);
  float base = mix(0.10, 0.20, smoothstep(0.0, 0.9, rn)) * (0.65 + 0.5 * grain);

  // Waves, broken into incomplete arcs. The angular mask means each band is a
  // few sweeping arcs rather than a closed ring, and it drifts over time.
  float ang = atan(p.y, p.x);
  float arcMask = valueNoise(vec2(ang * 1.7, uTime * 0.22));
  arcMask = smoothstep(0.28, 0.78, arcMask);

  float wave = sin(rn * uWaveScale - uTime * 2.1);
  wave = pow(max(wave, 0.0), 1.5) * 0.22 * arcMask;
  wave *= smoothstep(0.06, 0.45, r);

  // A second, slower, coarser set drifting the other way and masked
  // differently, so the two never line up into a target pattern.
  float arcMask2 = smoothstep(0.2, 0.8, valueNoise(vec2(ang * 1.1 + 3.7, -uTime * 0.17)));
  float slow = sin(rn * (uWaveScale * 0.45) + uTime * 0.9);
  slow = pow(max(slow, 0.0), 2.0) * 0.11 * arcMask2 * smoothstep(0.1, 0.7, r);

  float a = (base + wave + slow) * edge;

  // Damage tick: brief swell in brightness and density.
  a *= 1.0 + uPulse * 0.85;
  vec3 color = uColor * (1.0 + uPulse * 0.5);

  gl_FragColor = vec4(color, a * uOpacity);
}
`;

/** How long a tick pulse takes to decay back to rest. */
const PULSE_DECAY = 0.28;

export class GroundAreaRings {
  private readonly pool: IndexPool;
  private readonly group = new THREE.Group();
  private readonly geometry: THREE.PlaneGeometry;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly materials: THREE.ShaderMaterial[] = [];
  /** Per-slot remaining pulse time, decayed in update(). */
  private readonly pulseTimers: Float32Array;
  private time = 0;

  constructor(capacity: number, name: string) {
    this.pool = new IndexPool(capacity);
    this.group.name = name;
    this.pulseTimers = new Float32Array(capacity);

    // A unit quad laid flat on the ground. The disc is carved out of it in
    // the fragment shader, which gives a perfectly smooth circle at any size -
    // unlike a tessellated RingGeometry, whose segment count was visible.
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.geometry.rotateX(-Math.PI / 2);

    for (let i = 0; i < capacity; i++) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color('#ffffff') },
          uOpacity: { value: 0 },
          uTime: { value: 0 },
          uPulse: { value: 0 },
          uWaveScale: { value: 16 },
          uCenter: { value: new THREE.Vector2() },
          uRadius: { value: 1 },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        // Normal (not additive) blending so the zone reads as something
        // painted onto the world's floor rather than a glow hovering in front
        // of it, and so enemies standing in it are never blown out.
        blending: THREE.NormalBlending,
        depthWrite: false,
        // The ground plane is opaque and this sits a hair above it; skipping
        // the depth test avoids z-fighting at grazing camera angles entirely.
        depthTest: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      // Draw order is the whole point of the grounding read:
      //   ground (0) -> aura (0.5) -> character shadow (1) -> sprites.
      // The aura must sit UNDER the character's contact shadow, otherwise the
      // shadow is veiled and the character stops looking planted on the floor.
      mesh.renderOrder = RENDER_ORDER.groundZone;
      mesh.position.y = LAYER_Y.ground + 0.004;
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

  /** Advance the shared wave animation and decay any per-slot tick pulses. */
  update(dt: number): void {
    this.time += dt;
    for (let i = 0; i < this.pulseTimers.length; i++) {
      if (this.pulseTimers[i] <= 0) continue;
      this.pulseTimers[i] = Math.max(0, this.pulseTimers[i] - dt);
      this.materials[i].uniforms.uPulse.value = this.pulseTimers[i] / PULSE_DECAY;
    }
  }

  /**
   * Fire the "this zone just dealt damage" beat: a short brightness/density
   * swell. Called by the weapon on each damage tick, so the pulse rate
   * automatically communicates the zone's tick rate as it upgrades.
   */
  pulse(index: number): void {
    if (index === -1) return;
    this.pulseTimers[index] = PULSE_DECAY;
    this.materials[index].uniforms.uPulse.value = 1;
  }

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

  /**
   * Update a held slot's position/size/colour for this frame. `radius` is the
   * weapon's REAL damage radius in world units and is applied 1:1 to the
   * disc, so the drawn edge and the hitbox edge are the same circle.
   */
  set(index: number, x: number, z: number, radius: number, color: string, opacity = 0.5): void {
    if (index === -1) return;
    const mesh = this.meshes[index];
    mesh.position.set(x, LAYER_Y.ground + 0.004, z);
    // The quad is 2x2 in local space, so scaling by `radius` makes the disc
    // carved inside it exactly `radius` world units across from the centre.
    mesh.scale.set(radius, radius, radius);
    mesh.visible = true;
    const uniforms = this.materials[index].uniforms;
    uniforms.uColor.value.set(color);
    uniforms.uOpacity.value = opacity;
    uniforms.uTime.value = this.time;
    // Keep the wave spacing roughly constant in WORLD units as the aura grows,
    // so a level-8 aura shows more rings rather than the same rings stretched.
    uniforms.uWaveScale.value = Math.max(9, Math.min(30, radius * 5.5));
    // World-space anchor for the noise, so the pattern crawls over the terrain
    // instead of travelling with the player like a sticker.
    uniforms.uCenter.value.set(x, z);
    uniforms.uRadius.value = radius;
  }

  /** Hide and free every slot (run restart). */
  clear(): void {
    for (const mesh of this.meshes) mesh.visible = false;
    this.pulseTimers.fill(0);
    for (const material of this.materials) material.uniforms.uPulse.value = 0;
    this.pool.reset();
  }

  dispose(): void {
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
