/**
 * Convierte un esqueleto de 1 px en una lista de polilíneas.
 *
 * Los píxeles con 1 vecino son extremos, con ≥3 son bifurcaciones ("nodos").
 * Se recorren las ramas entre nodos/extremos y luego los lazos cerrados.
 */

export interface Polyline {
  /** Coordenadas [x0,y0,x1,y1,...] en el centro del píxel. */
  pts: number[];
  closed: boolean;
  /** Grado (vecinos) del píxel inicial y final: 1 = extremo libre, ≥3 = bifurcación. */
  startDeg: number;
  endDeg: number;
}

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

export function traceSkeleton(skel: Uint8Array, w: number, h: number): Polyline[] {
  const deg = new Uint8Array(skel.length);
  const offs = DX.map((dx, k) => DY[k] * w + dx);
  const pixels: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!skel[i]) continue;
      let n = 0;
      for (let k = 0; k < 8; k++) if (skel[i + offs[k]]) n++;
      deg[i] = n;
      pixels.push(i);
    }
  }
  const isNode = (i: number) => deg[i] !== 2;
  // Visitado por "arista": marcamos píxeles no-nodo al pasar por ellos y
  // los pares nodo-nodo adyacentes por separado.
  const visited = new Uint8Array(skel.length);
  const nodePairs = new Set<number>();
  const lines: Polyline[] = [];

  const walk = (start: number, first: number): Polyline => {
    const pts = [start % w + 0.5, ((start / w) | 0) + 0.5];
    let prev = start;
    let cur = first;
    for (;;) {
      pts.push((cur % w) + 0.5, ((cur / w) | 0) + 0.5);
      if (isNode(cur)) break;
      visited[cur] = 1;
      // Siguiente vecino: preferimos 4-conexos (evita atajos diagonales).
      let next = -1;
      for (const pass of [0, 1]) {
        for (let k = pass; k < 8; k += 2) {
          const j = cur + offs[k];
          if (!skel[j] || j === prev) continue;
          if (isNode(j)) {
            if (j === start && pts.length <= 4) continue;
            next = j;
            break;
          }
          if (!visited[j]) {
            next = j;
            break;
          }
        }
        if (next >= 0) break;
      }
      if (next < 0) break;
      prev = cur;
      cur = next;
    }
    return { pts, closed: false, startDeg: deg[start], endDeg: deg[cur] };
  };

  // 1) Ramas que parten de extremos y bifurcaciones.
  for (const i of pixels) {
    if (!isNode(i)) continue;
    if (deg[i] === 0) {
      lines.push({ pts: [(i % w) + 0.5, ((i / w) | 0) + 0.5], closed: false, startDeg: 0, endDeg: 0 });
      continue;
    }
    for (let k = 0; k < 8; k++) {
      const j = i + offs[k];
      if (!skel[j]) continue;
      if (isNode(j)) {
        const a = Math.min(i, j), b = Math.max(i, j);
        const pk = a * 4194304 + (b - a);
        if (nodePairs.has(pk)) continue;
        nodePairs.add(pk);
        lines.push({
          pts: [(i % w) + 0.5, ((i / w) | 0) + 0.5, (j % w) + 0.5, ((j / w) | 0) + 0.5],
          closed: false,
          startDeg: deg[i],
          endDeg: deg[j],
        });
        continue;
      }
      if (visited[j]) continue;
      lines.push(walk(i, j));
    }
  }
  // 2) Lazos cerrados (todos sus píxeles tienen grado 2).
  for (const i of pixels) {
    if (visited[i] || isNode(i)) continue;
    visited[i] = 1;
    let first = -1;
    for (let k = 0; k < 8; k++) {
      const j = i + offs[k];
      if (skel[j] && !visited[j]) {
        first = j;
        break;
      }
    }
    if (first < 0) continue;
    // Recorremos tratando el inicio como nodo temporal.
    deg[i] = 99;
    const pl = walk(i, first);
    deg[i] = 2;
    pl.closed = true;
    lines.push(pl);
  }
  return lines;
}

/** Longitud de una polilínea en px. */
export function polylineLength(pts: number[]): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) {
    len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  }
  return len;
}

/** Suavizado por media móvil (conserva extremos). */
export function smoothPolyline(pts: number[], radius: number, closed: boolean, iterations = 1): number[] {
  const n = pts.length / 2;
  if (n < 3 || radius < 1) return pts;
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const out = new Array<number>(cur.length);
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) {
        out[2 * i] = cur[2 * i];
        out[2 * i + 1] = cur[2 * i + 1];
        continue;
      }
      // Radio efectivo reducido cerca de los extremos de líneas abiertas.
      const r = closed ? radius : Math.min(radius, i, n - 1 - i);
      let sx = 0, sy = 0, c = 0;
      for (let k = -r; k <= r; k++) {
        let j = i + k;
        if (closed) j = (j + n) % n;
        sx += cur[2 * j];
        sy += cur[2 * j + 1];
        c++;
      }
      out[2 * i] = sx / c;
      out[2 * i + 1] = sy / c;
    }
    cur = out;
  }
  return cur;
}

/** Simplificación Douglas–Peucker con tolerancia `eps` (px). */
export function simplifyPolyline(pts: number[], eps: number): number[] {
  const n = pts.length / 2;
  if (n <= 2 || eps <= 0) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const eps2 = eps * eps;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[2 * a], ay = pts[2 * a + 1];
    const bx = pts[2 * b], by = pts[2 * b + 1];
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1e-9;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[2 * i] - ax, py = pts[2 * i + 1] - ay;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / L2));
      const ex = px - t * dx, ey = py - t * dy;
      const d2 = ex * ex + ey * ey;
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > eps2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

/** Suavizado de Chaikin (esquinas → curvas). */
export function chaikin(pts: number[], iterations: number, closed: boolean): number[] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const n = cur.length / 2;
    if (n < 3) return cur;
    const out: number[] = [];
    if (!closed) out.push(cur[0], cur[1]);
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n;
      const x0 = cur[2 * i], y0 = cur[2 * i + 1];
      const x1 = cur[2 * j], y1 = cur[2 * j + 1];
      out.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1);
      out.push(0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
    }
    if (!closed) out.push(cur[2 * (n - 1)], cur[2 * (n - 1) + 1]);
    cur = out;
  }
  return cur;
}

/**
 * Muestrea puntos a distancia de arco constante `step` a lo largo de la
 * polilínea. El primer punto se desplaza `offset` desde el inicio.
 * Devuelve [x,y,t...] donde t es el índice fraccionario del segmento (útil
 * para interpolar atributos).
 */
export function resampleByArc(pts: number[], step: number, closed: boolean, offset = 0): number[] {
  const n = pts.length / 2;
  const out: number[] = [];
  if (n === 0) return out;
  if (n === 1) return [pts[0], pts[1]];
  const segs = closed ? n : n - 1;
  let total = 0;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    total += Math.hypot(pts[2 * j] - pts[2 * i], pts[2 * j + 1] - pts[2 * i + 1]);
  }
  if (total < step * 0.5) {
    // Trazo muy corto: un punto en el centro.
    let acc = 0;
    const half = total / 2;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      const L = Math.hypot(pts[2 * j] - pts[2 * i], pts[2 * j + 1] - pts[2 * i + 1]);
      if (acc + L >= half) {
        const t = L > 0 ? (half - acc) / L : 0;
        return [pts[2 * i] + (pts[2 * j] - pts[2 * i]) * t, pts[2 * i + 1] + (pts[2 * j + 1] - pts[2 * i + 1]) * t];
      }
      acc += L;
    }
    return [pts[0], pts[1]];
  }
  // Ajusta el paso para que entre un número entero de intervalos: los puntos
  // quedan simétricos y los extremos del trazo siempre tienen punto.
  const count = Math.max(1, Math.round((total - offset) / step));
  const realStep = closed ? total / Math.max(1, Math.round(total / step)) : (total - offset) / count;
  let target = closed ? 0 : offset;
  let acc = 0;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const x0 = pts[2 * i], y0 = pts[2 * i + 1];
    const x1 = pts[2 * j], y1 = pts[2 * j + 1];
    const L = Math.hypot(x1 - x0, y1 - y0);
    while (target <= acc + L + 1e-6) {
      const t = L > 0 ? (target - acc) / L : 0;
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      target += realStep;
      if (closed && out.length / 2 >= Math.round(total / step)) return out;
    }
    acc += L;
  }
  return out;
}
