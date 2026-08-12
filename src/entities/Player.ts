import * as THREE from 'three';
import type { InputController } from '../core/InputController';
import { LAYER_Y, PLAYER, WORLD } from '../core/Constants';
import type { PlayerStats } from '../game/GameState';
import { gameEvents } from '../core/EventBus';
import { InstancedBillboardBatch } from '../render/InstancedBillboardBatch';
import { ShadowBatch } from '../render/ShadowBatch';
import { advanceAnimFrame, spriteAtlas } from '../render/SpriteAtlas';

export type AnimState = 'idle' | 'walk' | 'hit' | 'death' | 'cast';

const SPRITE_WORLD_SIZE = 1.5;

export class Player {
  readonly position = new THREE.Vector3(0, LAYER_Y.player, 0);
  readonly velocity = new THREE.Vector3();
  facing: 1 | -1 = 1;
  invulnTimer = 0;
  animState: AnimState = 'idle';
  isDead = false;
  private animTimer = 0;
  private flashTimer = 0;
  private hitPoseTimer = 0;
  private castPoseTimer = 0;
  private spriteKeyPrefix: string | null = null;
  readonly batch: InstancedBillboardBatch;
  readonly shadowBatch = new ShadowBatch(1, 'player-shadow');

  private readonly move = new THREE.Vector2();
  private readonly targetVelocity = new THREE.Vector3();

  constructor() {
    // alwaysOnTop=true: the player must never disappear under a pile of enemies.
    this.batch = new InstancedBillboardBatch(1, spriteAtlas.texture, 'player', true);
    // Brief attack flourish pose whenever any weapon fires - purely cosmetic,
    // decoupled from weapon logic via the event bus.
    gameEvents.on('weaponFired', () => {
      this.castPoseTimer = 0.18;
    });
  }

  /** Switch to a selected character's `${key}_idle`/`${key}_walk` clips if registered; pass null to reset to the default adventurer sprite. */
  setSpriteKey(key: string | null): void {
    this.spriteKeyPrefix = key;
  }

  hitFlash(): void {
    this.flashTimer = 0.12;
    if (!this.isDead) this.hitPoseTimer = 0.28;
  }

  die(): void {
    this.isDead = true;
    this.animState = 'death';
    this.animTimer = 0;
  }

  revive(): void {
    this.isDead = false;
    this.animState = 'idle';
    this.animTimer = 0;
    this.hitPoseTimer = 0;
    this.castPoseTimer = 0;
    this.flashTimer = 0;
  }

  update(delta: number, input: InputController, stats: PlayerStats, paused: boolean): void {
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - delta);
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - delta);
    if (this.hitPoseTimer > 0) this.hitPoseTimer = Math.max(0, this.hitPoseTimer - delta);
    if (this.castPoseTimer > 0) this.castPoseTimer = Math.max(0, this.castPoseTimer - delta);

    if (!paused && !this.isDead) {
      input.readMovement(this.move);
      this.targetVelocity.set(this.move.x, 0, this.move.y).multiplyScalar(stats.moveSpeed);
      const smoothing = 1 - Math.exp(-PLAYER.acceleration * delta);
      this.velocity.lerp(this.targetVelocity, smoothing);
      this.position.addScaledVector(this.velocity, delta);

      const bound = WORLD.halfExtent - 1;
      this.position.x = THREE.MathUtils.clamp(this.position.x, -bound, bound);
      this.position.z = THREE.MathUtils.clamp(this.position.z, -bound, bound);

      if (Math.abs(this.velocity.x) > 0.15) this.facing = this.velocity.x > 0 ? 1 : -1;

      const moving = this.velocity.lengthSq() > 0.05;
      this.animState = this.hitPoseTimer > 0 ? 'hit' : this.castPoseTimer > 0 ? 'cast' : moving ? 'walk' : 'idle';
    }

    this.animTimer += delta;
    const prefix = this.spriteKeyPrefix;
    // Only hit/cast/death clips are ever authored per-character today (see
    // SpriteLibraryCharacters.ts) - walk/idle. Falling straight through to the
    // shared generic `player_hit`/`player_cast`/`player_death` clips whenever
    // a character-specific one is missing used to swap the visible sprite to
    // the default adventurer mid-hit, making the selected character appear to
    // "become someone else" for a frame. Fall back to that SAME character's
    // own idle/walk clip instead - never the generic adventurer - so the
    // sprite identity never changes; the white hit-flash shader tint already
    // sells the "took damage" cue on its own.
    let clipName: string;
    if (this.animState === 'death') {
      clipName = this.resolveClip(prefix, 'death') ?? this.resolveClip(prefix, 'idle') ?? 'player_death';
    } else if (this.animState === 'hit') {
      clipName = this.resolveClip(prefix, 'hit') ?? this.resolveClip(prefix, 'idle') ?? 'player_hit';
    } else if (this.animState === 'cast') {
      clipName = this.resolveClip(prefix, 'cast') ?? this.resolveClip(prefix, 'walk') ?? this.resolveClip(prefix, 'idle') ?? 'player_cast';
    } else if (this.animState === 'walk') {
      clipName = this.resolveClip(prefix, 'walk') ?? (spriteAtlas.hasClip('player_walk') ? 'player_walk' : 'player_idle');
    } else {
      clipName = this.resolveClip(prefix, 'idle') ?? 'player_idle';
    }
    const clip = spriteAtlas.getClip(clipName);
    const frame = advanceAnimFrame(clip, this.animTimer, 0);
    this.animTimer = frame.timer;
    const uv = spriteAtlas.getUV(frame.cellIndex);

    const blinking = !this.isDead && this.invulnTimer > 0 && Math.floor(this.invulnTimer * 20) % 2 === 0;
    const alpha = blinking ? 0.35 : 1;
    const flash = this.flashTimer > 0 ? 1 : 0;

    this.batch.set(
      0,
      this.position.x,
      this.position.y,
      this.position.z,
      uv,
      SPRITE_WORLD_SIZE * this.facing,
      SPRITE_WORLD_SIZE,
      1,
      1,
      1,
      alpha,
      flash,
    );
    this.batch.commit();
    this.shadowBatch.set(0, this.position.x, this.position.z, SPRITE_WORLD_SIZE * 0.3);
    this.shadowBatch.commit();
  }

  /** `${prefix}_${suffix}` if a character is selected and that clip is registered, else null (caller falls back further). */
  private resolveClip(prefix: string | null, suffix: string): string | null {
    if (!prefix) return null;
    const name = `${prefix}_${suffix}`;
    return spriteAtlas.hasClip(name) ? name : null;
  }

  dispose(): void {
    this.batch.dispose();
    this.shadowBatch.dispose();
  }
}
