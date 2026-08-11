/**
 * Generic index-based pool for struct-of-arrays managers (enemies,
 * projectiles, gems, particles). Never allocate/destroy per-frame; instead
 * acquire a slot index, write into typed arrays at that index, and release it
 * back with swap-free O(1) bookkeeping via a free stack.
 */
export class IndexPool {
  private readonly freeStack: number[];
  private nextFresh = 0;

  constructor(public readonly capacity: number) {
    this.freeStack = [];
  }

  acquire(): number {
    if (this.freeStack.length > 0) return this.freeStack.pop()!;
    if (this.nextFresh < this.capacity) return this.nextFresh++;
    return -1; // pool exhausted; caller decides fallback (skip spawn, recycle oldest, etc.)
  }

  release(index: number): void {
    this.freeStack.push(index);
  }

  get activeCount(): number {
    return this.nextFresh - this.freeStack.length;
  }

  reset(): void {
    this.freeStack.length = 0;
    this.nextFresh = 0;
  }
}
