/**
 * Reusable procedural synthesis primitives shared by every sound in the audio
 * subsystem: a tone voice (oscillator -> optional filter -> gain envelope)
 * and a noise voice (buffer source -> optional filter -> gain envelope).
 * Both auto-stop and disconnect themselves once their envelope finishes so
 * no nodes are left dangling.
 */

export interface FilterOpts {
  type: BiquadFilterType;
  /** Starting cutoff/center frequency in Hz. */
  frequency: number;
  /** Optional end frequency to sweep the filter to over the voice's life. */
  frequencyEnd?: number;
  Q?: number;
}

export interface EnvelopeOpts {
  /** Time to ramp from silence to peak, seconds. */
  attack?: number;
  /** Time to decay from peak down to the sustain level, seconds. */
  decay?: number;
  /** Level held after decay, as a fraction of peak (0 = fully percussive). */
  sustain?: number;
  /** How long to hold the sustain level before releasing, seconds. */
  sustainTime?: number;
  /** Time to fade from sustain down to silence, seconds. */
  release?: number;
  /** Peak gain, 0..1. */
  peak?: number;
}

const MIN_GAIN = 0.0001;

/** Total wall-clock duration an envelope occupies. */
export function envelopeDuration(env: EnvelopeOpts): number {
  const attack = env.attack ?? 0.005;
  const decay = env.decay ?? 0.1;
  const sustainTime = env.sustainTime ?? 0;
  const release = env.release ?? 0.08;
  return attack + decay + sustainTime + release;
}

/** Schedules gain automation on `gain` starting at `startTime`. Returns total duration. */
function scheduleEnvelope(gain: GainNode, startTime: number, env: EnvelopeOpts): number {
  const attack = env.attack ?? 0.005;
  const decay = env.decay ?? 0.1;
  const sustain = env.sustain ?? 0;
  const sustainTime = env.sustainTime ?? 0;
  const release = env.release ?? 0.08;
  const peak = env.peak ?? 1;

  const attackEnd = startTime + attack;
  const decayEnd = attackEnd + decay;
  const sustainEnd = decayEnd + sustainTime;
  const releaseEnd = sustainEnd + release;
  const sustainLevel = Math.max(peak * sustain, MIN_GAIN);

  const p = gain.gain;
  p.cancelScheduledValues(startTime);
  p.setValueAtTime(MIN_GAIN, startTime);
  p.linearRampToValueAtTime(Math.max(peak, MIN_GAIN), attackEnd);
  p.exponentialRampToValueAtTime(sustainLevel, decayEnd);
  if (sustainTime > 0) p.setValueAtTime(sustainLevel, sustainEnd);
  p.exponentialRampToValueAtTime(MIN_GAIN, releaseEnd);
  p.setValueAtTime(0, releaseEnd + 0.001);

  return releaseEnd - startTime;
}

export interface ToneOpts {
  destination: AudioNode;
  type?: OscillatorType;
  frequency: number;
  /** Optional pitch glide target. */
  endFrequency?: number;
  /** Time to reach endFrequency; defaults to the full envelope duration. */
  glideTime?: number;
  detune?: number;
  filter?: FilterOpts;
  envelope?: EnvelopeOpts;
  /** AudioContext-relative start time; defaults to ctx.currentTime (now). */
  when?: number;
}

/** Plays a single oscillator voice with an envelope. Fire-and-forget. */
export function playTone(ctx: AudioContext, opts: ToneOpts): number {
  const startTime = opts.when ?? ctx.currentTime;
  const env = opts.envelope ?? {};
  const duration = envelopeDuration(env);

  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.frequency, startTime);
  if (opts.endFrequency !== undefined) {
    const glideTime = opts.glideTime ?? duration;
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(opts.endFrequency, 1),
      startTime + Math.max(glideTime, 0.001)
    );
  }
  if (opts.detune !== undefined) osc.detune.setValueAtTime(opts.detune, startTime);

  const gain = ctx.createGain();
  scheduleEnvelope(gain, startTime, env);

  let filter: BiquadFilterNode | null = null;
  if (opts.filter) {
    filter = ctx.createBiquadFilter();
    filter.type = opts.filter.type;
    filter.frequency.setValueAtTime(opts.filter.frequency, startTime);
    if (opts.filter.Q !== undefined) filter.Q.setValueAtTime(opts.filter.Q, startTime);
    if (opts.filter.frequencyEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(opts.filter.frequencyEnd, 1),
        startTime + duration
      );
    }
    osc.connect(filter);
    filter.connect(gain);
  } else {
    osc.connect(gain);
  }
  gain.connect(opts.destination);

  const stopTime = startTime + duration + 0.05;
  osc.start(startTime);
  osc.stop(stopTime);
  osc.onended = () => {
    osc.disconnect();
    filter?.disconnect();
    gain.disconnect();
  };

  return duration;
}

export interface NoiseOpts {
  destination: AudioNode;
  buffer: AudioBuffer;
  filter?: FilterOpts;
  envelope?: EnvelopeOpts;
  playbackRate?: number;
  when?: number;
  /** How much of the buffer to play, seconds; defaults to envelope duration. */
  duration?: number;
}

/** Plays a noise-buffer voice (for hits, roars, transients) with an envelope. */
export function playNoise(ctx: AudioContext, opts: NoiseOpts): number {
  const startTime = opts.when ?? ctx.currentTime;
  const env = opts.envelope ?? {};
  const envDuration = envelopeDuration(env);
  const playDuration = opts.duration ?? envDuration;

  const source = ctx.createBufferSource();
  source.buffer = opts.buffer;
  source.playbackRate.value = opts.playbackRate ?? 1;

  const gain = ctx.createGain();
  scheduleEnvelope(gain, startTime, env);

  let filter: BiquadFilterNode | null = null;
  if (opts.filter) {
    filter = ctx.createBiquadFilter();
    filter.type = opts.filter.type;
    filter.frequency.setValueAtTime(opts.filter.frequency, startTime);
    if (opts.filter.Q !== undefined) filter.Q.setValueAtTime(opts.filter.Q, startTime);
    if (opts.filter.frequencyEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(opts.filter.frequencyEnd, 1),
        startTime + envDuration
      );
    }
    source.connect(filter);
    filter.connect(gain);
  } else {
    source.connect(gain);
  }
  gain.connect(opts.destination);

  const stopTime = startTime + Math.max(playDuration, envDuration) + 0.05;
  source.start(startTime);
  source.stop(stopTime);
  source.onended = () => {
    source.disconnect();
    filter?.disconnect();
    gain.disconnect();
  };

  return Math.max(playDuration, envDuration);
}
