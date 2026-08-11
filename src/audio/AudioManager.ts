import { gameEvents, type GameEvents } from '../core/EventBus';
import { playTone, playNoise } from './SynthVoice';
import { getWhiteNoiseBuffer } from './NoiseBuffers';
import { MusicEngine } from './MusicEngine';

interface UpdateContext {
  elapsed: number;
  enemyCount: number;
  playerHealthFrac: number;
  phase: string;
}

/** Minimum time between audible weaponFired ticks, ms (event fires constantly). */
const WEAPON_FIRED_THROTTLE_MS = 150;
/** Gem pickups within this window ramp the ping pitch up for a satisfying combo feel. */
const GEM_COMBO_WINDOW_MS = 900;

/**
 * Procedural audio subsystem. Everything is synthesized at runtime with the
 * Web Audio API — no audio files, no libraries. Self-subscribes to
 * `gameEvents` in the constructor (registering listeners is safe pre-init);
 * the AudioContext itself is only created/resumed inside `init()`, which
 * must be called from a real user-gesture handler per browser autoplay
 * policy.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicEngine: MusicEngine | null = null;

  private _muted = false;
  private musicStarted = false;
  private readonly unsubscribers: Array<() => void> = [];

  private lastWeaponFiredAtMs = -Infinity;
  private lastGemAtMs = -Infinity;
  private gemComboStep = 0;

  constructor() {
    this.subscribeToEvents();
  }

  /**
   * Must be called from a user-gesture handler. Safe to call more than once.
   * Audio is a non-essential enhancement: if the browser/environment has no
   * usable AudioContext (headless test runners, restrictive embeds, etc.),
   * this fails soft so the game keeps running silently instead of crashing
   * the run-start flow.
   */
  init(): void {
    if (!this.ctx) {
      try {
        const AudioContextCtor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) {
          console.warn('[AudioManager] No AudioContext available; running without audio.');
          return;
        }
        const ctx = new AudioContextCtor();
        this.ctx = ctx;

        const masterGain = ctx.createGain();
        masterGain.gain.value = this._muted ? 0 : 1;
        masterGain.connect(ctx.destination);
        this.masterGain = masterGain;

        const sfxGain = ctx.createGain();
        sfxGain.gain.value = 0.9;
        sfxGain.connect(masterGain);
        this.sfxGain = sfxGain;

        const musicGain = ctx.createGain();
        musicGain.gain.value = 0.18;
        musicGain.connect(masterGain);

        this.musicEngine = new MusicEngine(ctx, musicGain);
      } catch (err) {
        console.warn('[AudioManager] Failed to initialize audio; running without audio.', err);
        this.ctx = null;
        return;
      }
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    if (!this.musicStarted) {
      this.musicEngine?.start();
      this.musicStarted = true;
    }
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.linearRampToValueAtTime(muted ? 0 : 1, now + 0.05);
    }
  }

  get muted(): boolean {
    return this._muted;
  }

  /** Optional per-frame hook: drives music intensity from live game state. */
  update(_dt: number, context: UpdateContext): void {
    if (!this.musicEngine) return;
    const enemyPressure = Math.min(context.enemyCount / 60, 1);
    const timePressure = Math.min(context.elapsed / 480, 1);
    const lowHealthPressure = context.playerHealthFrac < 0.3 ? 0.25 : 0;
    const intensity = Math.min(
      1,
      enemyPressure * 0.55 + timePressure * 0.35 + lowHealthPressure
    );
    this.musicEngine.setIntensity(intensity);
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
    this.musicEngine?.dispose();
    this.musicEngine = null;
    if (this.ctx) {
      void this.ctx.close();
    }
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.musicStarted = false;
  }

  // ---------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------

  private subscribeToEvents(): void {
    const on = <K extends keyof GameEvents>(event: K, handler: (payload: GameEvents[K]) => void): void => {
      this.unsubscribers.push(gameEvents.on(event, handler));
    };

    on('playerHit', () => this.playPlayerHit());
    on('playerDeath', () => this.playPlayerDeath());
    on('enemyHit', (p) => this.playEnemyHit(p.crit));
    on('enemyKilled', (p) => this.playEnemyKilled(p.isElite, p.isBoss));
    on('gemCollected', () => this.playGemCollected());
    on('levelUp', () => this.playLevelUp());
    on('upgradeChosen', () => this.playConfirmTick());
    on('passiveGained', () => this.playConfirmTick());
    on('weaponFired', (p) => this.playWeaponFired(p.weaponId));
    on('weaponEvolved', () => this.playWeaponEvolved());
    on('bossSpawned', () => this.playBossSpawned());
    on('bossKilled', () => this.playBossKilled());
    on('runOver', (p) => this.playRunOver(p.victory));
    on('runPaused', (p) => this.playPauseBlip(p.paused));
  }

  // ---------------------------------------------------------------------
  // SFX
  // ---------------------------------------------------------------------

  private playEnemyHit(crit: boolean): void {
    const ctx = this.ctx;
    const dest = this.sfxGain;
    if (!ctx || !dest) return;

    playTone(ctx, {
      destination: dest,
      type: crit ? 'square' : 'triangle',
      frequency: crit ? 620 : 170,
      endFrequency: crit ? 420 : 110,
      filter: { type: 'lowpass', frequency: crit ? 3200 : 1400 },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.03, peak: crit ? 0.5 : 0.4 },
    });
  }

  private playEnemyKilled(isElite: boolean, isBoss: boolean): void {
    const ctx = this.ctx;
    const dest = this.sfxGain;
    if (!ctx || !dest) return;

    const baseFreq = isBoss ? 180 : isElite ? 320 : 420;
    const peak = isBoss ? 0.65 : isElite ? 0.55 : 0.45;
    const decay = isBoss ? 0.35 : isElite ? 0.25 : 0.16;

    playTone(ctx, {
      destination: dest,
      type: 'sine',
      frequency: baseFreq,
      endFrequency: baseFreq * (isBoss ? 0.35 : 0.55),
      envelope: { attack: 0.002, decay, sustain: 0, release: 0.08, peak },
    });
    playNoise(ctx, {
      destination: dest,
      buffer: getWhiteNoiseBuffer(ctx),
      filter: { type: 'bandpass', frequency: isBoss ? 500 : 1200, Q: 0.8 },
      envelope: { attack: 0.001, decay: decay * 0.6, sustain: 0, release: 0.04, peak: peak * 0.35 },
    });
  }

  private playPlayerHit(): void {
    const ctx = this.ctx;
    const dest = this.sfxGain;
    if (!ctx || !dest) return;

    playTone(ctx, {
      destination: dest,
      type: 'sine',
      frequency: 95,
      endFrequency: 55,
      envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.08, peak: 0.6 },
    });
    playNoise(ctx, {
      destination: dest,
      buffer: getWhiteNoiseBuffer(ctx),
      filter: { type: 'bandpass', frequency: 900, Q: 1.2 },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03, peak: 0.4 },
    });
  }

  private playPlayerDeath(): void {
    const ctx = this.ctx;
    const dest = this.sfxGain;
    if (!ctx || !dest) return;

    playTone(ctx, {
      destination: dest,
      type: 'sawtooth',
      frequency: 380,
      endFrequency: 45,
      glideTime: 1.1,
      filter: { type: 'lowpass', frequency: 1200, frequencyEnd: 200 },
      envelope: { attack: 0.01, decay: 0.9, sustain: 0.15, sustainTime: 0.2, release: 0.4, peak: 0.55 },
    });
  }

  private playGemCollected(): void {
    const ctx = this.ctx;
    const dest = this.sfxGain;
    if (!ctx || !dest) return;

    const now = performance.now();
    if (now - this.lastGemAtMs < GEM_COMBO_WINDOW_MS) {
      this.gemComboStep = Math.min(this.gemComboStep + 1, 8);
    } else {
      this.gemComboStep = 0;
    }
    this.lastGemAtMs = now;

    const frequency = 1100 + this.gemComboStep * 45;
    playTone(ctx, {
      destination: dest,
      type: 'sine',
      frequency,
      endFrequency: frequency * 1.35,
      glideTime: 0.06,
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.04, peak: 0.3 },
    });
  }

  private playLevelUp(): void {
    const ctx = this.ctx;
    const dest = this.sfxGain;
    if (!ctx || !dest) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      playTone(ctx, {
        destination: dest,
        type: 'triangle',
        frequency: freq,
        envelope: { attack: 0.003, decay: 0.18, sustain: 0, release: 0.08, peak: 0.35 },
        when: now + i * 0.08,
      });
    });
  }

  private playWeaponFired(weaponId: string): void {
    const ctx = this.ctx;
    const dest = this.sfxGain;
    if (!ctx || !dest) return;

    const now = performance.now();
    if (now - this.lastWeaponFiredAtMs < WEAPON_FIRED_THROTTLE_MS) return;
    this.lastWeaponFiredAtMs = now;

    // Cheap deterministic-ish variation per weapon id so different weapons
    // read as subtly different without a lookup table.
    let hash = 0;
    for (let i = 0; i < weaponId.length; i++) hash = (hash * 31 + weaponId.charCodeAt(i)) | 0;
    const freq = 700 + (Math.abs(hash) % 300);

    playTone(ctx, {
      destination: dest,
      type: 'square',
      frequency: freq,
      filter: { type: 'lowpass', frequency: 2500 },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.015, peak: 0.12 },
    });
  }

  private playWeaponEvolved(): void {
    const ctx = this.ctx;
    const dest = this.sfxGain;
    if (!ctx || !dest) return;

    const now = ctx.currentTime;
    const notes = [392.0, 523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      playTone(ctx, {
        destination: dest,
        type: 'sawtooth',
        frequency: freq,
        filter: { type: 'lowpass', frequency: 3500 },
        envelope: { attack: 0.004, decay: 0.22, sustain: 0.1, sustainTime: 0.04, release: 0.14, peak: 0.4 },
        when: now + i * 0.075,
      });
      playTone(ctx, {
        destination: dest,
        type: 'sine',
        frequency: freq * 2,
        envelope: { attack: 0.004, decay: 0.16, sustain: 0, release: 0.1, peak: 0.15 },
        when: now + i * 0.075,
      });
    });
    // Sustained chord tail for a triumphant finish.
    [523.25, 659.25, 783.99].forEach((freq) => {
      playTone(ctx, {
        destination: dest,
        type: 'triangle',
        frequency: freq,
        envelope: { attack: 0.02, decay: 0.3, sustain: 0.3, sustainTime: 0.25, release: 0.4, peak: 0.22 },
        when: now + notes.length * 0.075,
      });
    });
  }

  private playConfirmTick(): void {
    const ctx = this.ctx;
    const dest = this.sfxGain;
    if (!ctx || !dest) return;

    const now = ctx.currentTime;
    playTone(ctx, {
      destination: dest,
      type: 'sine',
      frequency: 700,
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03, peak: 0.22 },
      when: now,
    });
    playTone(ctx, {
      destination: dest,
      type: 'sine',
      frequency: 950,
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.03, peak: 0.2 },
      when: now + 0.055,
    });
  }

  private playBossSpawned(): void {
    const ctx = this.ctx;
    const dest = this.sfxGain;
    if (!ctx || !dest) return;

    const now = ctx.currentTime;
    // Low rumble swell.
    playTone(ctx, {
      destination: dest,
      type: 'sawtooth',
      frequency: 60,
      endFrequency: 42,
      glideTime: 0.9,
      filter: { type: 'lowpass', frequency: 300 },
      envelope: { attack: 0.15, decay: 0.4, sustain: 0.5, sustainTime: 0.3, release: 0.35, peak: 0.5 },
      when: now,
    });
    // Filtered noise roar.
    playNoise(ctx, {
      destination: dest,
      buffer: getWhiteNoiseBuffer(ctx),
      filter: { type: 'bandpass', frequency: 250, frequencyEnd: 700, Q: 0.6 },
      envelope: { attack: 0.05, decay: 0.5, sustain: 0.2, sustainTime: 0.2, release: 0.4, peak: 0.45 },
      when: now,
    });
    // Sharp low sting on top.
    playTone(ctx, {
      destination: dest,
      type: 'square',
      frequency: 110,
      endFrequency: 70,
      envelope: { attack: 0.01, decay: 0.25, sustain: 0, release: 0.15, peak: 0.3 },
      when: now + 0.1,
    });
  }

  private playBossKilled(): void {
    const ctx = this.ctx;
    const dest = this.sfxGain;
    if (!ctx || !dest) return;

    const now = ctx.currentTime;
    playTone(ctx, {
      destination: dest,
      type: 'sine',
      frequency: 160,
      endFrequency: 55,
      envelope: { attack: 0.005, decay: 0.5, sustain: 0, release: 0.2, peak: 0.7 },
      when: now,
    });
    playNoise(ctx, {
      destination: dest,
      buffer: getWhiteNoiseBuffer(ctx),
      filter: { type: 'bandpass', frequency: 400, Q: 0.7 },
      envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.15, peak: 0.4 },
      when: now,
    });
    // Bright triumphant flourish on top.
    [659.25, 783.99, 987.77].forEach((freq, i) => {
      playTone(ctx, {
        destination: dest,
        type: 'triangle',
        frequency: freq,
        envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.1, peak: 0.28 },
        when: now + 0.15 + i * 0.09,
      });
    });
  }

  private playRunOver(victory: boolean): void {
    const ctx = this.ctx;
    const dest = this.sfxGain;
    if (!ctx || !dest) return;

    const now = ctx.currentTime;
    if (victory) {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach((freq, i) => {
        playTone(ctx, {
          destination: dest,
          type: 'triangle',
          frequency: freq,
          envelope: { attack: 0.01, decay: 0.35, sustain: 0.2, sustainTime: 0.15, release: 0.3, peak: 0.4 },
          when: now + i * 0.16,
        });
      });
    } else {
      const notes = [392.0, 349.23, 293.66, 220.0];
      notes.forEach((freq, i) => {
        playTone(ctx, {
          destination: dest,
          type: 'sawtooth',
          frequency: freq,
          filter: { type: 'lowpass', frequency: 1000, frequencyEnd: 300 },
          envelope: { attack: 0.02, decay: 0.5, sustain: 0.1, sustainTime: 0.1, release: 0.4, peak: 0.4 },
          when: now + i * 0.28,
        });
      });
    }
  }

  private playPauseBlip(paused: boolean): void {
    const ctx = this.ctx;
    const dest = this.sfxGain;
    if (!ctx || !dest) return;

    playTone(ctx, {
      destination: dest,
      type: 'sine',
      frequency: paused ? 500 : 650,
      envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02, peak: 0.12 },
    });
  }
}
