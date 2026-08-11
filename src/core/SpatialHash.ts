/**
 * Uniform grid spatial hash over the XZ plane. Used for enemy-vs-enemy soft
 * separation, weapon hit queries, and nearest-enemy targeting so none of
 * those stay O(n^2) as enemy counts climb into the hundreds/thousands.
 *
 * Cells store raw entity indices (not objects) to avoid per-frame GC churn.
 * Call clear() once per frame, insert() every active entity, then query
 * neighboring cells for anything that needs proximity checks.
 */
export class SpatialHash {
  private readonly cells = new Map<number, number[]>();
  private readonly cellPool: number[][] = [];

  constructor(private readonly cellSize: number) {}

  private key(cx: number, cz: number): number {
    // Pack two 20-bit signed-ish coords into one number key.
    return ((cx + 1_000_000) << 21) | (cz + 1_000_000);
  }

  private cellCoord(v: number): number {
    return Math.floor(v / this.cellSize);
  }

  clear(): void {
    for (const arr of this.cells.values()) {
      arr.length = 0;
      this.cellPool.push(arr);
    }
    this.cells.clear();
  }

  insert(index: number, x: number, z: number): void {
    const key = this.key(this.cellCoord(x), this.cellCoord(z));
    let arr = this.cells.get(key);
    if (!arr) {
      arr = this.cellPool.pop() ?? [];
      this.cells.set(key, arr);
    }
    arr.push(index);
  }

  /** Invoke `visitor` for every index within `radius` cells of (x, z). */
  forEachNear(x: number, z: number, radiusCells: number, visitor: (index: number) => void): void {
    const cx = this.cellCoord(x);
    const cz = this.cellCoord(z);
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      for (let dz = -radiusCells; dz <= radiusCells; dz++) {
        const arr = this.cells.get(this.key(cx + dx, cz + dz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) visitor(arr[i]);
      }
    }
  }
}
