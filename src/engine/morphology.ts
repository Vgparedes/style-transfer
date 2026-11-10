/**
 * Morfología binaria: transformada de distancia y esqueletización.
 *
 * Son la base del modo "Estructura" del Dotwork: el esqueleto da la línea
 * central de cada trazo y la transformada de distancia da su grosor local.
 */

const INF = 1e20;

/** Transformada de distancia 1D (Felzenszwalb & Huttenlocher), distancia al cuadrado. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * Distancia euclidiana exacta desde cada píxel con `mask=1` al píxel más
 * cercano con `mask=0`. Los píxeles fuera de la máscara valen 0.
 * Por defecto se asume que fuera de la imagen hay fondo (mask=0); con
 * `outsideIsBackground=false` el borde no cuenta como fondo.
 */
export function distanceTransform(
  mask: Uint8Array,
  w: number,
  h: number,
  outsideIsBackground = true,
): Float32Array {
  const O = outsideIsBackground ? 0 : INF;
  const n = Math.max(w, h) + 2;
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i++) grid[i] = mask[i] ? INF : 0;

  // Columnas (con borde virtual de fondo en ambos extremos).
  for (let x = 0; x < w; x++) {
    f[0] = O;
    for (let y = 0; y < h; y++) f[y + 1] = grid[y * w + x];
    f[h + 1] = O;
    edt1d(f, h + 2, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y + 1];
  }
  // Filas.
  for (let y = 0; y < h; y++) {
    f[0] = O;
    for (let x = 0; x < w; x++) f[x + 1] = grid[y * w + x];
    f[w + 1] = O;
    edt1d(f, w + 2, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x + 1];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = grid[i] >= INF * 0.5 ? 1e9 : Math.sqrt(grid[i]);
  return out;
}

/**
 * Esqueletización de Zhang–Suen. Modifica una copia de la máscara y devuelve
 * el esqueleto de 1 px de ancho (8-conexo). Solo recorre los píxeles activos,
 * así que el costo depende del área de tinta, no del tamaño de la imagen.
 */
export function thin(mask: Uint8Array, w: number, h: number, maxIter = 1000): Uint8Array {
  const m = new Uint8Array(mask);
  // Limpia el borde para no tener que comprobar límites.
  for (let x = 0; x < w; x++) {
    m[x] = 0;
    m[(h - 1) * w + x] = 0;
  }
  for (let y = 0; y < h; y++) {
    m[y * w] = 0;
    m[y * w + w - 1] = 0;
  }
  let active: number[] = [];
  for (let i = 0; i < m.length; i++) if (m[i]) active.push(i);

  const toDelete: number[] = [];
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let step = 0; step < 2; step++) {
      toDelete.length = 0;
      for (let k = 0; k < active.length; k++) {
        const i = active[k];
        if (!m[i]) continue;
        const p2 = m[i - w], p3 = m[i - w + 1], p4 = m[i + 1], p5 = m[i + w + 1];
        const p6 = m[i + w], p7 = m[i + w - 1], p8 = m[i - 1], p9 = m[i - w - 1];
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a =
          (+(!p2 && p3)) + (+(!p3 && p4)) + (+(!p4 && p5)) + (+(!p5 && p6)) +
          (+(!p6 && p7)) + (+(!p7 && p8)) + (+(!p8 && p9)) + (+(!p9 && p2));
        if (a !== 1) continue;
        if (step === 0) {
          if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
        } else {
          if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
        }
        toDelete.push(i);
      }
      if (toDelete.length) {
        changed = true;
        for (const i of toDelete) m[i] = 0;
      }
    }
    if (!changed) break;
    // Compacta la lista de activos.
    const next: number[] = [];
    for (const i of active) if (m[i]) next.push(i);
    active = next;
  }

  // Elimina píxeles redundantes en esquinas en "L" (escalones de 2 px), que
  // generan falsas bifurcaciones al trazar.
  for (const i of active) {
    if (!m[i]) continue;
    const n = m[i - w], s = m[i + w], e = m[i + 1], wv = m[i - 1];
    const ne = m[i - w + 1], nw = m[i - w - 1], se = m[i + w + 1], sw = m[i + w - 1];
    if (
      (n && e && !s && !wv && !sw) ||
      (n && wv && !s && !e && !se) ||
      (s && e && !n && !wv && !nw) ||
      (s && wv && !n && !e && !ne)
    ) {
      m[i] = 0;
    }
  }
  return m;
}

/** Elimina componentes 8-conexas con menos de `minSize` píxeles. */
export function removeSmallComponents(mask: Uint8Array, w: number, h: number, minSize: number): Uint8Array {
  if (minSize <= 1) return mask;
  const out = new Uint8Array(mask);
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const comp: number[] = [];
  for (let s = 0; s < out.length; s++) {
    if (!out[s] || seen[s]) continue;
    stack.length = 0;
    comp.length = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (out[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    if (comp.length < minSize) for (const i of comp) out[i] = 0;
  }
  return out;
}

/** Píxeles de borde de la máscara (con algún vecino 4-conexo fuera). */
export function boundary(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (
        x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
        !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]
      ) {
        out[i] = 1;
      }
    }
  }
  return out;
}
