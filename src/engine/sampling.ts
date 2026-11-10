import { createRng, shuffle } from './random';

/**
 * Grilla espacial para consultas de vecindad rápidas entre puntos.
 * Guarda para cada punto su radio de exclusión.
 */
export class PointGrid {
  readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly heads: Int32Array;
  private next: Int32Array;
  xs: Float32Array;
  ys: Float32Array;
  rs: Float32Array;
  count = 0;

  constructor(width: number, height: number, cell: number, capacity = 1024) {
    this.cell = Math.max(1, cell);
    this.cols = Math.ceil(width / this.cell) + 1;
    this.rows = Math.ceil(height / this.cell) + 1;
    this.heads = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(capacity);
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
    this.rs = new Float32Array(capacity);
  }

  private grow() {
    const cap = this.xs.length * 2;
    const g = <T extends Float32Array | Int32Array>(a: T, C: new (n: number) => T): T => {
      const b = new C(cap);
      b.set(a);
      return b;
    };
    this.next = g(this.next, Int32Array);
    this.xs = g(this.xs, Float32Array);
    this.ys = g(this.ys, Float32Array);
    this.rs = g(this.rs, Float32Array);
  }

  add(x: number, y: number, r: number): number {
    if (this.count >= this.xs.length) this.grow();
    const i = this.count++;
    this.xs[i] = x;
    this.ys[i] = y;
    this.rs[i] = r;
    const cx = Math.min(this.cols - 1, Math.max(0, (x / this.cell) | 0));
    const cy = Math.min(this.rows - 1, Math.max(0, (y / this.cell) | 0));
    const c = cy * this.cols + cx;
    this.next[i] = this.heads[c];
    this.heads[c] = i;
    return i;
  }

  /** ¿Hay algún punto a distancia menor que `r` de (x,y)? */
  conflicts(x: number, y: number, r: number): boolean {
    const c0 = Math.max(0, ((x - r) / this.cell) | 0);
    const c1 = Math.min(this.cols - 1, ((x + r) / this.cell) | 0);
    const r0 = Math.max(0, ((y - r) / this.cell) | 0);
    const r1 = Math.min(this.rows - 1, ((y + r) / this.cell) | 0);
    const r2 = r * r;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        for (let i = this.heads[cy * this.cols + cx]; i >= 0; i = this.next[i]) {
          const dx = this.xs[i] - x;
          const dy = this.ys[i] - y;
          if (dx * dx + dy * dy < r2) return true;
        }
      }
    }
    return false;
  }
}

/**
 * Muestreo de disco de Poisson con radio variable por "lanzamiento de
 * dardos" sobre píxeles en orden aleatorio.
 *
 * - `radiusAt(i)` devuelve la distancia mínima deseada alrededor del píxel i
 *   (≤ 0 para descartarlo: sin tinta).
 * - Para que el costo no explote en zonas claras (radios grandes), cada
 *   píxel se prueba con probabilidad ≈ TRIALS / (π r²): unas pocas decenas de
 *   pruebas por disco alcanzan para saturar la distribución.
 *
 * El resultado es ruido azul: puntos irregulares ("orgánicos") pero sin
 * aglomeraciones, que es lo que distingue al stippling del ruido aleatorio.
 * Si la grilla ya tiene puntos (p. ej. contornos), se respetan.
 */
export function poissonVariable(
  grid: PointGrid,
  width: number,
  height: number,
  radiusAt: (i: number) => number,
  seed: number,
  onAccept?: (x: number, y: number, r: number, i: number) => void,
): void {
  const TRIALS = 24;
  const rng = createRng(seed);
  const n = width * height;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  shuffle(order, rng);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const r = radiusAt(i);
    if (!(r > 0)) continue;
    const p = TRIALS / (Math.PI * r * r);
    if (p < 1 && rng() > p) continue;
    const x = (i % width) + rng();
    const y = ((i / width) | 0) + rng();
    if (grid.conflicts(x, y, r)) continue;
    grid.add(x, y, r);
    onAccept?.(x, y, r, i);
  }
}
