/**
 * Generates and caches reusable white-noise AudioBuffers. Buffers are keyed
 * per AudioContext so a fresh context (after dispose/re-init) gets its own.
 */

const whiteNoiseCache = new WeakMap<AudioContext, AudioBuffer>();

/** A couple of seconds is plenty to cover any noise-based SFX we schedule. */
const NOISE_BUFFER_SECONDS = 2;

export function getWhiteNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const cached = whiteNoiseCache.get(ctx);
  if (cached) return cached;

  const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

  whiteNoiseCache.set(ctx, buffer);
  return buffer;
}
