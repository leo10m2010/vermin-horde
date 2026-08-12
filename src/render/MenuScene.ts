import * as THREE from 'three';
import { InstancedBillboardBatch } from './InstancedBillboardBatch';
import { ShadowBatch } from './ShadowBatch';
import { advanceAnimFrame, spriteAtlas, type UVRect } from './SpriteAtlas';

/**
 * Self-contained 2.5D backdrop for the main menu: a gothic graveyard vignette
 * (moon, tombstone/ruin silhouettes, drifting fog, rising embers) with the
 * default character (`thornguard`) doing its idle loop front-and-center.
 *
 * Deliberately independent from `Game.ts`'s single WebGLRenderer/scene/loop -
 * this class owns its own `THREE.Scene` + `THREE.OrthographicCamera` and is
 * meant to be swapped into the existing renderer by the caller
 * (`renderer.render(menuScene.scene, menuScene.camera)`) whenever
 * `phase === 'menu'`. It never creates a renderer of its own.
 *
 * Composition (camera-space depth, matching `CameraRig`'s convention where
 * larger world Z is closer to the camera):
 *   - z ~ -9..-14: moon glow, tombstone row, ruined columns, a small distant
 *     monster silhouette (background).
 *   - z = 0: the player-character billboard, front and center (midground).
 *   - z ~ +6..+7.2: a broken pillar stump + dead branch cluster, partially
 *     framing the shot (foreground).
 *   - drifting fog + rising embers scattered through the whole depth range.
 *
 * Performance: every per-frame update (`update()`) is pure struct-of-arrays
 * math over pre-sized `Float32Array`s and mutates pre-allocated THREE
 * objects (`Color`, `Object3D` dummies inside the batches, camera position) -
 * no `new THREE.Vector3()`/material/geometry allocation happens outside the
 * constructor. No real shadow maps; the character's ground contact shadow
 * reuses the game's existing cheap `ShadowBatch` decal technique. Only the
 * hand-built decor (ground/tombstones/columns/foreground props) uses real
 * `THREE.Light`s (`MeshStandardMaterial`) - the character billboard samples
 * `spriteAtlas`'s shared unlit billboard shader (see
 * `InstancedBillboardBatch.ts`), so its mood is controlled purely through the
 * `fadeAlpha` intro ramp rather than scene lighting.
 */

// ---------------------------------------------------------------------------
// Palette - mirrors the CSS theme tokens (--gh-black/--gh-red/--gh-gold in
// src/styles.css) so the WebGL backdrop and the DOM title/buttons read as one
// consistent surface.
// ---------------------------------------------------------------------------
const GH_BLACK = 0x0b0705;
const GH_GOLD_BRIGHT = 0xe8c468;

const STONE_DARK = 0x1c1e26;
const STONE_NEAR_BLACK = 0x070605;
const MONSTER_BODY = 0x0c0a09;
const MONSTER_EYE = 0xd9403a;

// Camera - same "tilted 2.5D" language as core/Constants.ts's CAMERA, tuned
// for a tighter portrait framing than the gameplay camera (a menu backdrop
// wants a closer, more composed shot than a top-down arena view).
const MENU_CAMERA = {
  elevationDeg: 55,
  distance: 15,
  // Tall enough that the background row (tombstones/columns/moon, z ~ -9..-14)
  // actually falls inside the frustum instead of being clipped above the top
  // edge - orthographic framing doesn't shrink distant content the way a
  // perspective camera would, so the vertical extent has to be sized for the
  // full depth range up front, not just the character standing at z=0.
  viewHeight: 21,
  near: 0.1,
  far: 70,
};

const CHAR_SPRITE_KEY = 'thornguard';
const CHAR_SIZE = 5.6;

const EMBER_COUNT = 40;
const FOG_COUNT = 12;
const FULL_UV: UVRect = [0, 0, 1, 1];

// Intro timeline (seconds, real elapsed time - see playIntro()/update()).
const INTRO_FADE_DURATION = 0.6;
const INTRO_LIGHT_START = 0.15;
const INTRO_LIGHT_DURATION = 0.45;
const INTRO_DOLLY_START = 0.35;
const INTRO_DOLLY_DURATION = 0.5;
const INTRO_DOLLY_EXTRA_DISTANCE = 3.2;
const INTRO_DOLLY_EXTRA_HEIGHT = 1.0;
const INTRO_TOTAL_DURATION = 1.0;

interface FadeTarget {
  material: THREE.Material;
  opacity: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function easeOutCubic(t: number): number {
  const p = 1 - t;
  return 1 - p * p * p;
}

/** Eased 0->1 progress of `t` through the window [start, start+duration]; 0 before, 1 after. */
function segmentProgress(t: number, start: number, duration: number): number {
  if (duration <= 0) return t >= start ? 1 : 0;
  return easeOutCubic(clamp01((t - start) / duration));
}

/** Positive-result modulo (JS `%` keeps the sign of the dividend). */
function wrapMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

export class MenuScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;

  private readonly characterBatch: InstancedBillboardBatch;
  private readonly shadowBatch: ShadowBatch;
  private readonly emberBatch: InstancedBillboardBatch;
  private readonly fogBatch: InstancedBillboardBatch;

  private readonly emberTexture: THREE.CanvasTexture;
  private readonly fogTexture: THREE.CanvasTexture;
  private readonly groundTexture: THREE.CanvasTexture;
  private readonly moonTexture: THREE.CanvasTexture;

  private readonly silhouetteFarMat: THREE.MeshStandardMaterial;
  private readonly silhouetteNearMat: THREE.MeshBasicMaterial;
  private readonly monsterMat: THREE.MeshBasicMaterial;
  private readonly eyeMat: THREE.MeshBasicMaterial;
  private readonly groundMat: THREE.MeshStandardMaterial;
  private readonly moonMat: THREE.MeshBasicMaterial;

  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private readonly fadeTargets: FadeTarget[] = [];

  private readonly hemiLight: THREE.HemisphereLight;
  private readonly emberLight: THREE.PointLight;
  private readonly hemiBaseIntensity = 1.15;
  private readonly emberLightBaseIntensity = 3.6;

  private readonly cameraTarget = new THREE.Vector3(0, 1.5, 0);
  private readonly baseElevationRad: number;
  private readonly bgColor = new THREE.Color();
  private readonly bgBaseR: number;
  private readonly bgBaseG: number;
  private readonly bgBaseB: number;

  // Ember per-instance seeds (struct-of-arrays; position each frame is pure
  // math over these + simTime, so update() never mutates per-particle state).
  private readonly emberBaseX = new Float32Array(EMBER_COUNT);
  private readonly emberBaseZ = new Float32Array(EMBER_COUNT);
  private readonly emberRiseSeed = new Float32Array(EMBER_COUNT);
  private readonly emberRiseSpeed = new Float32Array(EMBER_COUNT);
  private readonly emberRiseRange = new Float32Array(EMBER_COUNT);
  private readonly emberSwayAmp = new Float32Array(EMBER_COUNT);
  private readonly emberSwayFreq = new Float32Array(EMBER_COUNT);
  private readonly emberSwayPhase = new Float32Array(EMBER_COUNT);
  private readonly emberSize = new Float32Array(EMBER_COUNT);
  private readonly emberTintIsGold = new Uint8Array(EMBER_COUNT);

  private readonly fogRangeWidth = 30;
  private readonly fogBaseX = new Float32Array(FOG_COUNT);
  private readonly fogBaseZ = new Float32Array(FOG_COUNT);
  private readonly fogDriftSpeed = new Float32Array(FOG_COUNT);
  private readonly fogSize = new Float32Array(FOG_COUNT);
  private readonly fogAlpha = new Float32Array(FOG_COUNT);
  private readonly fogPhase = new Float32Array(FOG_COUNT);

  private animTimer = 0;
  private simTime = 0;
  private reducedMotion = false;

  private introPending = false;
  private introActive = false;
  private introStartElapsed = 0;
  private introT = 0;
  private fadeAlpha = 1;
  private lightRamp = 1;

  constructor() {
    this.scene.background = this.bgColor;
    const baseBg = new THREE.Color(GH_BLACK);
    this.bgBaseR = baseBg.r;
    this.bgBaseG = baseBg.g;
    this.bgBaseB = baseBg.b;
    this.bgColor.copy(baseBg);

    this.baseElevationRad = THREE.MathUtils.degToRad(MENU_CAMERA.elevationDeg);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, MENU_CAMERA.near, MENU_CAMERA.far);
    this.applyCameraFrame(0, 0);

    // ---- lights ---------------------------------------------------------
    // Two cheap lights, no shadow maps: a dim hemisphere fill so the
    // MeshStandardMaterial silhouettes never go fully flat-black, and a warm
    // point light near the character standing in for candle/moon rim light.
    // Both are scaled by lightRamp/flicker in updateLights(), never rebuilt.
    this.hemiLight = new THREE.HemisphereLight(0x3a4a66, 0x05050a, this.hemiBaseIntensity);
    this.scene.add(this.hemiLight);
    // decay=0: a stylized, distance-independent glow rather than physically
    // correct falloff - predictable brightness without per-scene light tuning.
    this.emberLight = new THREE.PointLight(GH_GOLD_BRIGHT, this.emberLightBaseIntensity, 11, 0);
    this.emberLight.position.set(0.6, 2.6, 1.6);
    this.scene.add(this.emberLight);

    // ---- shared decor materials (created once, reused across many meshes) ----
    this.silhouetteFarMat = new THREE.MeshStandardMaterial({ color: STONE_DARK, roughness: 1, metalness: 0, transparent: true, opacity: 1 });
    this.silhouetteNearMat = new THREE.MeshBasicMaterial({ color: STONE_NEAR_BLACK, transparent: true, opacity: 0.94 });
    this.monsterMat = new THREE.MeshBasicMaterial({ color: MONSTER_BODY, transparent: true, opacity: 1 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: MONSTER_EYE, transparent: true, opacity: 1 });
    this.groundTexture = this.buildGroundTexture();
    this.groundMat = new THREE.MeshStandardMaterial({ map: this.groundTexture, roughness: 1, metalness: 0, transparent: true, opacity: 1 });
    this.moonTexture = this.buildMoonTexture();
    this.moonMat = new THREE.MeshBasicMaterial({ map: this.moonTexture, transparent: true, opacity: 0.9, depthWrite: false });

    this.ownedMaterials.push(this.silhouetteFarMat, this.silhouetteNearMat, this.monsterMat, this.eyeMat, this.groundMat, this.moonMat);
    this.fadeTargets.push(
      { material: this.silhouetteFarMat, opacity: 1 },
      { material: this.silhouetteNearMat, opacity: 0.94 },
      { material: this.monsterMat, opacity: 1 },
      { material: this.eyeMat, opacity: 1 },
      { material: this.groundMat, opacity: 1 },
      { material: this.moonMat, opacity: 0.9 },
    );

    // ---- ground -----------------------------------------------------------
    const groundGeo = new THREE.PlaneGeometry(24, 30, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(groundGeo, this.groundMat);
    this.scene.add(ground);
    this.ownedGeometries.push(groundGeo);

    // ---- moon (billboarded once toward the near-static menu camera) -------
    const moonGeo = new THREE.PlaneGeometry(4.4, 4.4);
    const moon = new THREE.Mesh(moonGeo, this.moonMat);
    moon.position.set(5.6, 3.1, -8.4);
    moon.quaternion.copy(this.camera.quaternion);
    this.scene.add(moon);
    this.ownedGeometries.push(moonGeo);

    this.buildBackgroundSilhouettes();
    this.buildForegroundSilhouettes();
    this.buildDistantMonster();

    // ---- character ----------------------------------------------------
    // alwaysOnTop=true keeps the character readable in front of the decor,
    // matching Player.ts's own convention for the same reason.
    this.characterBatch = new InstancedBillboardBatch(1, spriteAtlas.texture, 'menu-character', true);
    this.scene.add(this.characterBatch.mesh);

    this.shadowBatch = new ShadowBatch(1, 'menu-character-shadow');
    this.shadowBatch.set(0, 0, 0, 1.15);
    this.shadowBatch.commit();
    this.scene.add(this.shadowBatch.mesh);

    // ---- embers / fog ---------------------------------------------------
    this.emberTexture = this.buildEmberTexture();
    this.emberBatch = new InstancedBillboardBatch(EMBER_COUNT, this.emberTexture, 'menu-embers');
    this.scene.add(this.emberBatch.mesh);
    this.seedEmbers();

    this.fogTexture = this.buildFogTexture();
    this.fogBatch = new InstancedBillboardBatch(FOG_COUNT, this.fogTexture, 'menu-fog');
    this.scene.add(this.fogBatch.mesh);
    this.seedFog();

    // Default state (no playIntro() call): already idle from frame one.
    this.updateFadeMaterials();
    this.updateLights();
  }

  /**
   * Advance the idle loop by `delta` seconds (real per-frame delta, already
   * 0 upstream if the caller wants a fully static frame) and drive the intro
   * timeline, if active, using `elapsed` (the same monotonically-increasing
   * real clock `Loop`/`Game.ts` pass to their own update()) as the timestamp
   * reference so the intro survives frame-rate variance.
   */
  update(delta: number, elapsed: number): void {
    if (this.introPending) {
      this.introStartElapsed = elapsed;
      this.introPending = false;
    }
    if (this.introActive) {
      this.introT = elapsed - this.introStartElapsed;
      this.fadeAlpha = segmentProgress(this.introT, 0, INTRO_FADE_DURATION);
      this.lightRamp = segmentProgress(this.introT, INTRO_LIGHT_START, INTRO_LIGHT_DURATION);
      if (this.introT >= INTRO_TOTAL_DURATION) {
        this.introActive = false;
        this.fadeAlpha = 1;
        this.lightRamp = 1;
      }
    }

    this.simTime += this.reducedMotion ? 0 : delta;

    const dollyProgress = this.introActive ? segmentProgress(this.introT, INTRO_DOLLY_START, INTRO_DOLLY_DURATION) : 1;
    const dollyRemaining = 1 - dollyProgress;
    this.applyCameraFrame(dollyRemaining * INTRO_DOLLY_EXTRA_DISTANCE, dollyRemaining * INTRO_DOLLY_EXTRA_HEIGHT);

    this.bgColor.setRGB(this.bgBaseR * this.fadeAlpha, this.bgBaseG * this.fadeAlpha, this.bgBaseB * this.fadeAlpha);
    this.updateFadeMaterials();
    this.updateLights();
    this.updateCharacter(delta);
    this.updateEmbers();
    this.updateFog();
  }

  /** Starts the entry sequence described in the class doc's timeline. No-op timeline if reduced motion is already on - jumps straight to the idle end-state instead of animating. */
  playIntro(): void {
    if (this.reducedMotion) {
      this.introActive = false;
      this.introPending = false;
      this.fadeAlpha = 1;
      this.lightRamp = 1;
      return;
    }
    this.introActive = true;
    this.introPending = true;
    this.introT = 0;
    this.fadeAlpha = 0;
    this.lightRamp = 0;
  }

  /** Mirrors Game.ts's `reducedMotion` flag: freezes camera drift, particle motion and light flicker on a static frame. Finishes any in-progress intro immediately rather than leaving it stuck mid-fade. */
  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
    if (enabled && this.introActive) {
      this.introActive = false;
      this.introPending = false;
      this.fadeAlpha = 1;
      this.lightRamp = 1;
    }
  }

  /** Releases every geometry/material/texture this scene created. Does NOT dispose `spriteAtlas.texture` - that atlas is shared/owned by the rest of the game. */
  dispose(): void {
    this.characterBatch.dispose();
    this.shadowBatch.dispose();
    this.emberBatch.dispose();
    this.fogBatch.dispose();
    for (const geo of this.ownedGeometries) geo.dispose();
    for (const mat of this.ownedMaterials) mat.dispose();
    this.emberTexture.dispose();
    this.fogTexture.dispose();
    this.groundTexture.dispose();
    this.moonTexture.dispose();
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  private applyCameraFrame(dollyExtraDistance: number, dollyExtraHeight: number): void {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const halfH = MENU_CAMERA.viewHeight / 2;
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();

    const distance = MENU_CAMERA.distance + dollyExtraDistance;
    const offsetY = Math.sin(this.baseElevationRad) * distance + dollyExtraHeight;
    const offsetZ = Math.cos(this.baseElevationRad) * distance;

    // Very subtle idle drift, disabled entirely under reduced motion since
    // simTime itself stops advancing in that mode.
    const driftX = Math.sin(this.simTime * 0.17) * 0.1;
    const driftY = Math.sin(this.simTime * 0.12 + 1.4) * 0.045;

    this.camera.position.set(this.cameraTarget.x + driftX, this.cameraTarget.y + offsetY + driftY, this.cameraTarget.z + offsetZ);
    this.camera.lookAt(this.cameraTarget);
  }

  // -------------------------------------------------------------------------
  // Per-frame subsystem updates
  // -------------------------------------------------------------------------

  private updateFadeMaterials(): void {
    for (const target of this.fadeTargets) target.material.opacity = target.opacity * this.fadeAlpha;
  }

  private updateLights(): void {
    const flicker = this.reducedMotion ? 1 : 1 + Math.sin(this.simTime * 2.1) * 0.1 + Math.sin(this.simTime * 5.3 + 1.7) * 0.045;
    this.hemiLight.intensity = this.hemiBaseIntensity * this.lightRamp;
    this.emberLight.intensity = this.emberLightBaseIntensity * this.lightRamp * flicker;
  }

  private updateCharacter(delta: number): void {
    const clipName = `${CHAR_SPRITE_KEY}_idle`;
    if (!spriteAtlas.hasClip(clipName)) {
      // Defensive fallback: atlas not built yet (shouldn't happen once the
      // caller only shows this scene after Game.ts's constructor has run
      // registerCharacterSprites()+spriteAtlas.build()) - just skip the
      // billboard this frame instead of throwing.
      this.characterBatch.hide(0);
      this.characterBatch.commit();
      return;
    }
    const clip = spriteAtlas.getClip(clipName);
    const dt = this.reducedMotion ? 0 : delta;
    const frame = advanceAnimFrame(clip, this.animTimer, dt);
    this.animTimer = frame.timer;
    const uv = spriteAtlas.getUV(frame.cellIndex);
    this.characterBatch.set(0, 0, 0, 0, uv, CHAR_SIZE, CHAR_SIZE, 1, 1, 1, this.fadeAlpha, 0);
    this.characterBatch.commit();
  }

  private updateEmbers(): void {
    const t = this.simTime;
    for (let i = 0; i < EMBER_COUNT; i++) {
      const range = this.emberRiseRange[i];
      const rawY = wrapMod(t * this.emberRiseSpeed[i] + this.emberRiseSeed[i], range);
      const lifeFrac = rawY / range;
      const envelope = Math.sin(Math.PI * lifeFrac); // 0 at spawn/despawn, peak mid-rise
      const x = this.emberBaseX[i] + Math.sin(t * this.emberSwayFreq[i] + this.emberSwayPhase[i]) * this.emberSwayAmp[i];
      const y = 0.12 + rawY;
      const z = this.emberBaseZ[i];
      const isGold = this.emberTintIsGold[i] !== 0;
      const tintR = isGold ? 0.93 : 0.86;
      const tintG = isGold ? 0.72 : 0.27;
      const tintB = isGold ? 0.37 : 0.19;
      const alpha = envelope * 0.85 * this.fadeAlpha;
      const size = this.emberSize[i];
      this.emberBatch.set(i, x, y, z, FULL_UV, size, size, tintR, tintG, tintB, alpha, 0);
    }
    this.emberBatch.commit();
  }

  private updateFog(): void {
    const t = this.simTime;
    for (let i = 0; i < FOG_COUNT; i++) {
      const x = wrapMod(this.fogBaseX[i] + t * this.fogDriftSpeed[i] + this.fogRangeWidth / 2, this.fogRangeWidth) - this.fogRangeWidth / 2;
      const pulse = 0.75 + 0.25 * Math.sin(t * 0.35 + this.fogPhase[i]);
      const alpha = this.fogAlpha[i] * pulse * this.fadeAlpha;
      const size = this.fogSize[i];
      this.fogBatch.set(i, x, 0.02, this.fogBaseZ[i], FULL_UV, size * 1.7, size, 1, 1, 1, alpha, 0);
    }
    this.fogBatch.commit();
  }

  // -------------------------------------------------------------------------
  // One-time construction helpers
  // -------------------------------------------------------------------------

  private seedEmbers(): void {
    const rng = mulberry32(4242);
    for (let i = 0; i < EMBER_COUNT; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = 1.1 + rng() * 5.8;
      this.emberBaseX[i] = Math.cos(angle) * radius;
      this.emberBaseZ[i] = -3.5 + rng() * 9.5;
      this.emberRiseSeed[i] = rng() * 6;
      this.emberRiseSpeed[i] = 0.5 + rng() * 0.6;
      this.emberRiseRange[i] = 3.2 + rng() * 2.4;
      this.emberSwayAmp[i] = 0.15 + rng() * 0.25;
      this.emberSwayFreq[i] = 0.4 + rng() * 0.5;
      this.emberSwayPhase[i] = rng() * Math.PI * 2;
      this.emberSize[i] = 0.09 + rng() * 0.1;
      this.emberTintIsGold[i] = rng() > 0.4 ? 1 : 0;
    }
  }

  private seedFog(): void {
    const rng = mulberry32(777);
    for (let i = 0; i < FOG_COUNT; i++) {
      this.fogBaseX[i] = (rng() - 0.5) * this.fogRangeWidth;
      this.fogBaseZ[i] = -9 + rng() * 15.5;
      this.fogDriftSpeed[i] = 0.22 + rng() * 0.32;
      this.fogSize[i] = 3.0 + rng() * 2.6;
      this.fogAlpha[i] = 0.2 + rng() * 0.2;
      this.fogPhase[i] = rng() * Math.PI * 2;
    }
  }

  private buildGroundTexture(): THREE.CanvasTexture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#100f0c';
    ctx.fillRect(0, 0, size, size);
    const rng = mulberry32(11);
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(rng() * size);
      const y = Math.floor(rng() * size);
      ctx.fillStyle = rng() > 0.5 ? '#1a1a14' : '#080806';
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.strokeRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.repeat.set(8, 10);
    texture.needsUpdate = true;
    return texture;
  }

  private buildMoonTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const c = size / 2;
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(232,196,104,0.95)');
    grad.addColorStop(0.32, 'rgba(232,196,104,0.55)');
    grad.addColorStop(1, 'rgba(232,196,104,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return this.finishSoftTexture(canvas);
  }

  private buildEmberTexture(): THREE.CanvasTexture {
    const size = 16;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const c = size / 2;
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return this.finishSoftTexture(canvas);
  }

  private buildFogTexture(): THREE.CanvasTexture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const c = size / 2;
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(178,188,200,0.55)');
    grad.addColorStop(0.5, 'rgba(138,148,164,0.26)');
    grad.addColorStop(1, 'rgba(138,148,164,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return this.finishSoftTexture(canvas);
  }

  private finishSoftTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  private buildBackgroundSilhouettes(): void {
    const rng = mulberry32(2026);
    const tombstones: Array<{ x: number; h: number; w: number }> = [
      { x: -8.6, h: 1.6, w: 0.75 },
      { x: -5.4, h: 2.1, w: 0.9 },
      { x: -2.3, h: 1.4, w: 0.65 },
      { x: 1.8, h: 1.9, w: 0.8 },
      { x: 4.6, h: 1.5, w: 0.7 },
      { x: 7.8, h: 2.2, w: 0.95 },
    ];
    for (const s of tombstones) {
      const z = -9.2 - rng() * 3.4;
      const jitter = (rng() - 0.5) * 0.14;
      this.addTombstone(s.x, z, s.h, s.w, jitter);
    }

    this.addColumn(-9.6, -12.4, 3.6, 0.5, 0.03);
    this.addColumn(-8.3, -12.9, 2.0, 0.42, -0.08);
    this.addColumn(9.3, -12.0, 3.1, 0.48, -0.02);
  }

  private buildForegroundSilhouettes(): void {
    const nearZ = 6.6;

    const pillarGeo = new THREE.CylinderGeometry(0.55, 0.7, 3.0, 7);
    const pillar = new THREE.Mesh(pillarGeo, this.silhouetteNearMat);
    pillar.position.set(-4.8, 1.5, nearZ);
    pillar.rotation.z = 0.08;
    this.scene.add(pillar);
    this.ownedGeometries.push(pillarGeo);

    const branchGroup = new THREE.Group();
    branchGroup.position.set(5.0, 0, nearZ + 0.4);
    for (let i = 0; i < 4; i++) {
      const height = 2.1 - i * 0.28;
      const branchGeo = new THREE.ConeGeometry(0.14, height, 5);
      const branch = new THREE.Mesh(branchGeo, this.silhouetteNearMat);
      branch.position.set(i * 0.22, height / 2, i * -0.1);
      branch.rotation.z = -0.5 + i * 0.22;
      branchGroup.add(branch);
      this.ownedGeometries.push(branchGeo);
    }
    this.scene.add(branchGroup);
  }

  private buildDistantMonster(): void {
    const bodyGeo = new THREE.SphereGeometry(0.5, 8, 6);
    bodyGeo.scale(1, 1.15, 0.7);
    const body = new THREE.Mesh(bodyGeo, this.monsterMat);
    body.position.set(-3.4, 0.5, -11.3);
    this.scene.add(body);
    this.ownedGeometries.push(bodyGeo);

    const eyeGeo = new THREE.SphereGeometry(0.045, 5, 4);
    const eyeL = new THREE.Mesh(eyeGeo, this.eyeMat);
    eyeL.position.set(-3.56, 0.58, -10.86);
    const eyeR = new THREE.Mesh(eyeGeo, this.eyeMat);
    eyeR.position.set(-3.24, 0.58, -10.86);
    this.scene.add(eyeL);
    this.scene.add(eyeR);
    this.ownedGeometries.push(eyeGeo);
  }

  private addTombstone(x: number, z: number, height: number, width: number, rotJitter: number): void {
    const bodyGeo = new THREE.BoxGeometry(width, height, width * 0.34);
    const body = new THREE.Mesh(bodyGeo, this.silhouetteFarMat);
    body.position.set(x, height / 2, z);
    body.rotation.y = rotJitter;
    this.scene.add(body);
    this.ownedGeometries.push(bodyGeo);

    const capGeo = new THREE.SphereGeometry(width / 2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const cap = new THREE.Mesh(capGeo, this.silhouetteFarMat);
    cap.position.set(x, height, z);
    cap.rotation.y = rotJitter;
    this.scene.add(cap);
    this.ownedGeometries.push(capGeo);
  }

  private addColumn(x: number, z: number, height: number, radius: number, tiltJitter: number): void {
    const geo = new THREE.CylinderGeometry(radius, radius * 1.15, height, 8);
    const mesh = new THREE.Mesh(geo, this.silhouetteFarMat);
    mesh.position.set(x, height / 2, z);
    mesh.rotation.z = tiltJitter;
    this.scene.add(mesh);
    this.ownedGeometries.push(geo);
  }
}
