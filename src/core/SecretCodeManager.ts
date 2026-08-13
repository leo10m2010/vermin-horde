/**
 * Hidden key-sequence detector.
 *
 * A small, self-contained listener rather than another branch inside the
 * game's input handling: the sequence it watches for has nothing to do with
 * gameplay input, must keep working while movement keys are being held, and
 * must be trivially removable. Game only supplies the sequence and a callback.
 *
 * Deliberately knows nothing about what the code does when it fires.
 */

/** Ms allowed between two keys before the buffer resets. */
const DEFAULT_KEY_TIMEOUT_MS = 3000;

export interface SecretCodeOptions {
  /** `KeyboardEvent.code` values, in order. */
  sequence: string[];
  onMatch: () => void;
  /** Only feed keys when this returns true (e.g. "a run is in progress"). */
  isActive?: () => boolean;
  keyTimeoutMs?: number;
  target?: Window | HTMLElement;
}

export class SecretCodeManager {
  private readonly sequence: string[];
  private readonly onMatch: () => void;
  private readonly isActive: () => boolean;
  private readonly keyTimeoutMs: number;
  private readonly target: Window | HTMLElement;

  /** How many leading keys of `sequence` have matched so far. */
  private progress = 0;
  private lastKeyAt = 0;

  constructor(options: SecretCodeOptions) {
    this.sequence = options.sequence;
    this.onMatch = options.onMatch;
    this.isActive = options.isActive ?? (() => true);
    this.keyTimeoutMs = options.keyTimeoutMs ?? DEFAULT_KEY_TIMEOUT_MS;
    this.target = options.target ?? window;
    this.target.addEventListener('keydown', this.onKeyDown as EventListener);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown as EventListener);
  }

  /** Exposed for tests; never shown in any UI. */
  get progressLength(): number {
    return this.progress;
  }

  reset(): void {
    this.progress = 0;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return; // holding a key must not advance the sequence
    if (isTypingTarget(event.target)) {
      // Someone typing into a field is writing text, not entering a code.
      this.progress = 0;
      return;
    }
    if (!this.isActive()) {
      this.progress = 0;
      return;
    }

    const now = performance.now();
    if (this.progress > 0 && now - this.lastKeyAt > this.keyTimeoutMs) this.progress = 0;
    this.lastKeyAt = now;

    if (event.code === this.sequence[this.progress]) {
      this.progress++;
      if (this.progress === this.sequence.length) {
        this.progress = 0;
        this.onMatch();
      }
      return;
    }

    // A wrong key restarts the buffer - but if that key is itself a valid
    // start, it counts as the first one, so "up up down..." still works.
    this.progress = event.code === this.sequence[0] ? 1 : 0;
  };
}

/** True while focus is inside anything the user could be typing into. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return el.isContentEditable === true;
}
