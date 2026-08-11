import { playNoise, playTone } from './SynthVoice';
import { getWhiteNoiseBuffer } from './NoiseBuffers';

/**
 * Generative background music: a looping bassline plus a sparse arpeggiated
 * lead and a hi-hat layer that fade in as `intensity` rises. Uses a
 * lookahead scheduler (currentTime-based, not setInterval alone) so timing
 * stays tight regardless of JS timer jitter — the classic "tale of two
 * clocks" pattern.
 */
export class MusicEngine {
  private readonly ctx: AudioContext;
  private readonly destination: AudioNode;
  private readonly noiseBuffer: AudioBuffer;

  private readonly bpm = 96;
  /** Sixteenth-note step duration in seconds. */
  private readonly stepDuration = 60 / this.bpm / 4;
  private readonly lookaheadMs = 25;
  private readonly scheduleAheadTime = 0.12;

  // A-minor tinged, low + tense: root A2, with E3/C3/G2 movement.
  private readonly bassPattern = [110.0, 110.0, 164.81, 110.0, 130.81, 110.0, 97.99, 146.83];
  // Upper-register notes drawn from A minor pentatonic for the sparse lead.
  private readonly leadScale = [440.0, 523.25, 587.33, 659.25, 783.99, 880.0];

  private running = false;
  private nextStepTime = 0;
  private stepIndex = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private intensity = 0;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.destination = destination;
    this.noiseBuffer = getWhiteNoiseBuffer(ctx);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stepIndex = 0;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.scheduler();
  }

  stop(): void {
    this.running = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /** 0 = calm/sparse, 1 = full intensity with lead + percussion layered in. */
  setIntensity(level: number): void {
    this.intensity = Math.max(0, Math.min(1, level));
  }

  dispose(): void {
    this.stop();
  }

  private scheduler = (): void => {
    if (!this.running) return;
    while (this.nextStepTime < this.ctx.currentTime + this.scheduleAheadTime) {
      this.scheduleStep(this.stepIndex, this.nextStepTime);
      this.nextStepTime += this.stepDuration;
      this.stepIndex++;
    }
    this.timerId = setTimeout(this.scheduler, this.lookaheadMs);
  };

  private scheduleStep(stepIndex: number, time: number): void {
    const barStep = stepIndex % 32; // two-bar loop of sixteenth-note steps

    // Bassline: plays on quarter-note pulses, always audible as the backbone.
    if (barStep % 4 === 0) {
      const note = this.bassPattern[Math.floor(barStep / 4) % this.bassPattern.length];
      playTone(this.ctx, {
        destination: this.destination,
        type: 'triangle',
        frequency: note,
        filter: { type: 'lowpass', frequency: 420, Q: 0.7 },
        envelope: { attack: 0.01, decay: 0.32, sustain: 0, release: 0.12, peak: 0.5 },
        when: time,
      });
    }

    // Sparse lead arpeggio: fades in once intensity climbs, more notes as it grows.
    if (this.intensity > 0.28 && barStep % 4 === 2) {
      const chance = 0.25 + this.intensity * 0.6;
      if (Math.random() < chance) {
        const note = this.leadScale[Math.floor(Math.random() * this.leadScale.length)];
        playTone(this.ctx, {
          destination: this.destination,
          type: 'sine',
          frequency: note,
          envelope: { attack: 0.005, decay: 0.22, sustain: 0, release: 0.08, peak: 0.22 },
          when: time,
        });
      }
    }

    // Hi-hat-like ticks: only once things get hectic.
    if (this.intensity > 0.6 && barStep % 2 === 1) {
      const chance = (this.intensity - 0.6) * 2;
      if (Math.random() < chance) {
        playNoise(this.ctx, {
          destination: this.destination,
          buffer: this.noiseBuffer,
          filter: { type: 'highpass', frequency: 6500 },
          envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02, peak: 0.15 },
          when: time,
        });
      }
    }
  }
}
