import * as THREE from 'three';
import { LAYER_Y, POOL_CAPACITY } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import { IndexPool } from '../core/ObjectPool';

export interface DamageNumberOptions {
  crit?: boolean;
  colorHex?: string;
}

interface DamageNumberSlot {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

const CANVAS_W = 96;
const CANVAS_H = 48;
const RISE_SPEED = 1.8; // world units/sec initial upward drift
const RISE_DRAG = 1.4; // 1/s decay of the drift speed
const FADE_FRACTION = 0.4; // final portion of life over which alpha ramps to 0

/**
 * Pooled floating damage-number popups. Uses a fixed-size pool of
 * pre-created THREE.Sprite + CanvasTexture triples (capacity from
 * POOL_CAPACITY.damageNumbers) so steady-state play never allocates a new
 * canvas or sprite - reassigning a pooled slot just redraws its canvas.
 */
export class DamageNumbers {
  private readonly capacity = POOL_CAPACITY.damageNumbers;
  private readonly pool = new IndexPool(this.capacity);
  private readonly group = new THREE.Group();
  private readonly slots: DamageNumberSlot[] = [];

  private readonly alive = new Uint8Array(this.capacity);
  private readonly posX = new Float32Array(this.capacity);
  private readonly posY = new Float32Array(this.capacity);
  private readonly posZ = new Float32Array(this.capacity);
  private readonly velX = new Float32Array(this.capacity);
  private readonly velY = new Float32Array(this.capacity);
  private readonly life = new Float32Array(this.capacity);
  private readonly maxLife = new Float32Array(this.capacity);

  private readonly unsubscribers: Array<() => void> = [];

  constructor() {
    this.group.name = 'vfx-damage-numbers';
    for (let i = 0; i < this.capacity; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not acquire 2D context for damage number canvas.');
      ctx.imageSmoothingEnabled = false;

      const texture = new THREE.CanvasTexture(canvas);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;

      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.scale.set(1.2, 0.6, 1);

      this.group.add(sprite);
      this.slots.push({ sprite, material, canvas, ctx, texture });
    }
    this.bindEvents();
  }

  get object3D(): THREE.Object3D {
    return this.group;
  }

  spawn(x: number, z: number, amount: number, opts: DamageNumberOptions = {}): void {
    const index = this.pool.acquire();
    if (index === -1) return; // pool exhausted; drop silently, matches particle-burst behavior

    const crit = opts.crit ?? false;
    const slot = this.slots[index];
    this.paint(slot, amount, crit, opts.colorHex);

    this.posX[index] = x + (Math.random() * 0.6 - 0.3);
    this.posY[index] = LAYER_Y.damageNumber;
    this.posZ[index] = z;
    this.velX[index] = Math.random() * 0.6 - 0.3;
    this.velY[index] = RISE_SPEED * (crit ? 1.3 : 1);
    const life = crit ? 0.85 : 0.65;
    this.life[index] = life;
    this.maxLife[index] = life;
    this.alive[index] = 1;

    slot.sprite.visible = true;
    slot.sprite.scale.set(crit ? 1.9 : 1.25, crit ? 0.95 : 0.62, 1);
    slot.sprite.position.set(this.posX[index], this.posY[index], this.posZ[index]);
    slot.material.opacity = 1;
  }

  update(dt: number): void {
    const dragFactor = Math.exp(-RISE_DRAG * dt);
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      this.life[i] -= dt;
      const slot = this.slots[i];
      if (this.life[i] <= 0) {
        this.alive[i] = 0;
        slot.sprite.visible = false;
        this.pool.release(i);
        continue;
      }

      this.velY[i] *= dragFactor;
      this.posX[i] += this.velX[i] * dt;
      this.posY[i] += this.velY[i] * dt;
      slot.sprite.position.set(this.posX[i], this.posY[i], this.posZ[i]);

      const lifeFrac = this.life[i] / this.maxLife[i];
      slot.material.opacity = lifeFrac < FADE_FRACTION ? lifeFrac / FADE_FRACTION : 1;
    }
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
    for (const slot of this.slots) {
      slot.material.dispose();
      slot.texture.dispose();
    }
  }

  private paint(slot: DamageNumberSlot, amount: number, crit: boolean, colorHex?: string): void {
    const { ctx, canvas } = slot;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const text = Math.round(amount).toString();
    const fontSize = crit ? 30 : 22;
    ctx.font = `${crit ? '900' : '700'} ${fontSize}px 'Segoe UI', Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = crit ? 5 : 4;
    ctx.strokeStyle = 'rgba(12, 15, 10, 0.9)';
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = colorHex ?? (crit ? '#ffe066' : '#f2f0e6');
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    slot.texture.needsUpdate = true;
  }

  private bindEvents(): void {
    this.unsubscribers.push(
      gameEvents.on('enemyHit', (e) => {
        this.spawn(e.x, e.z, e.damage, { crit: e.crit });
      }),
      gameEvents.on('playerHit', (e) => {
        this.spawn(e.x, e.z, e.damage, { crit: false, colorHex: '#ff5a4d' });
      }),
    );
  }
}
