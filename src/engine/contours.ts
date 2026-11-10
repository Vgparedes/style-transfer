/**
 * Contornos de iso-nivel por "marching squares" con interpolación lineal:
 * convierte una región {v < iso} de un mapa escalar en polígonos cerrados
 * con precisión sub-píxel (bordes suaves, no escalonados).
 *
 * Los lazos externos y los huecos quedan con orientación opuesta, y además
 * se dibujan con regla par-impar, así los huecos se respetan siempre.
 */
import type { FloatMap } from './image';

export function isoContours(map: FloatMap, iso: number): number[][] {
  const { width: w, height: h, data } = map;
  // Grilla con borde de 1 muestra "afuera" para que todo contorno cierre.
  const W = w + 2, H = h + 2;
  const val = (gi: number, gj: number) =>
    gi <= 0 || gj <= 0 || gi > w || gj > h ? 2 : data[(gj - 1) * w + (gi - 1)];

  // Arista horizontal (gi,gj)-(gi+1,gj): id par; vertical (gi,gj)-(gi,gj+1): id impar.
  const hId = (gi: number, gj: number) => (gj * W + gi) * 2;
  const vId = (gi: number, gj: number) => (gj * W + gi) * 2 + 1;

  const next = new Map<number, number>();
  const pts = new Map<number, [number, number]>();
  // Coordenadas de imagen: la muestra (gi,gj) está en el centro del píxel (gi-1, gj-1).
  const cx = (gi: number) => Math.min(w, Math.max(0, gi - 0.5));
  const cy = (gj: number) => Math.min(h, Math.max(0, gj - 0.5));
  const point = (id: number, a: number, b: number, gi: number, gj: number, vertical: boolean) => {
    if (pts.has(id)) return;
    const t = a === b ? 0.5 : Math.min(1, Math.max(0, (iso - a) / (b - a)));
    pts.set(id, vertical ? [cx(gi), cy(gj + t)] : [cx(gi + t), cy(gj)]);
  };

  for (let gj = 0; gj < H - 1; gj++) {
    for (let gi = 0; gi < W - 1; gi++) {
      const tl = val(gi, gj), tr = val(gi + 1, gj), br = val(gi + 1, gj + 1), bl = val(gi, gj + 1);
      const c = (tl < iso ? 8 : 0) | (tr < iso ? 4 : 0) | (br < iso ? 2 : 0) | (bl < iso ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const T = hId(gi, gj), B = hId(gi, gj + 1), L = vId(gi, gj), R = vId(gi + 1, gj);
      const need = (e: number) => {
        if (e === T) point(T, tl, tr, gi, gj, false);
        else if (e === B) point(B, bl, br, gi, gj + 1, false);
        else if (e === L) point(L, tl, bl, gi, gj, true);
        else point(R, tr, br, gi + 1, gj, true);
      };
      const seg = (a: number, b: number) => {
        need(a);
        need(b);
        next.set(a, b);
      };
      // Segmentos orientados con el interior a la derecha (coordenadas y-abajo).
      switch (c) {
        case 1: seg(L, B); break;
        case 2: seg(B, R); break;
        case 3: seg(L, R); break;
        case 4: seg(R, T); break;
        case 5: {
          const center = (tl + tr + br + bl) / 4 < iso;
          if (center) { seg(L, T); seg(R, B); } else { seg(L, B); seg(R, T); }
          break;
        }
        case 6: seg(B, T); break;
        case 7: seg(L, T); break;
        case 8: seg(T, L); break;
        case 9: seg(T, B); break;
        case 10: {
          const center = (tl + tr + br + bl) / 4 < iso;
          if (center) { seg(T, R); seg(B, L); } else { seg(T, L); seg(B, R); }
          break;
        }
        case 11: seg(T, R); break;
        case 12: seg(R, L); break;
        case 13: seg(R, B); break;
        case 14: seg(B, L); break;
      }
    }
  }

  // Encadena segmentos en lazos cerrados.
  const loops: number[][] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let e: number | undefined = start;
    while (e !== undefined && !seen.has(e)) {
      seen.add(e);
      const p = pts.get(e)!;
      loop.push(p[0], p[1]);
      e = next.get(e);
    }
    if (loop.length >= 6) loops.push(loop);
  }
  return loops;
}

/** Área con signo de un polígono cerrado (para descartar motas). */
export function polygonArea(pts: number[]): number {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += pts[2 * j] * pts[2 * i + 1] - pts[2 * i] * pts[2 * j + 1];
  return a / 2;
}
