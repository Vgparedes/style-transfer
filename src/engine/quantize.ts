/** Cuantización de color: median cut + refinamiento k-means corto. */

export type RGB = [number, number, number];

export function medianCut(pixels: Float32Array, count: number, k: number): RGB[] {
  // pixels = [r,g,b,...] en 0..255 (count colores)
  type Box = { idx: Uint32Array };
  const all = new Uint32Array(count);
  for (let i = 0; i < count; i++) all[i] = i;
  const boxes: Box[] = [{ idx: all }];
  const range = (b: Box) => {
    let best = 0, ch = 0;
    for (let c = 0; c < 3; c++) {
      let lo = 255, hi = 0;
      for (const i of b.idx) {
        const v = pixels[i * 3 + c];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > best) {
        best = hi - lo;
        ch = c;
      }
    }
    return { best, ch };
  };
  while (boxes.length < k) {
    let bi = -1, br = -1, bc = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].idx.length < 2) continue;
      const r = range(boxes[i]);
      const score = r.best * Math.sqrt(boxes[i].idx.length);
      if (score > br) {
        br = score;
        bi = i;
        bc = r.ch;
      }
    }
    if (bi < 0 || br <= 0) break;
    const b = boxes[bi];
    const sorted = Array.from(b.idx).sort((a, c) => pixels[a * 3 + bc] - pixels[c * 3 + bc]);
    const mid = sorted.length >> 1;
    boxes.splice(bi, 1, { idx: Uint32Array.from(sorted.slice(0, mid)) }, { idx: Uint32Array.from(sorted.slice(mid)) });
  }
  const pal: RGB[] = boxes.map((b) => {
    let r = 0, g = 0, bl = 0;
    for (const i of b.idx) {
      r += pixels[i * 3];
      g += pixels[i * 3 + 1];
      bl += pixels[i * 3 + 2];
    }
    const n = b.idx.length || 1;
    return [r / n, g / n, bl / n];
  });
  // Unas iteraciones de k-means mejoran mucho la paleta.
  for (let it = 0; it < 4; it++) {
    const sums = pal.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < count; i++) {
      const j = nearest(pal, pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2]);
      const s = sums[j];
      s[0] += pixels[i * 3];
      s[1] += pixels[i * 3 + 1];
      s[2] += pixels[i * 3 + 2];
      s[3]++;
    }
    for (let j = 0; j < pal.length; j++) if (sums[j][3]) pal[j] = [sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]];
  }
  return pal.map((c) => c.map(Math.round) as RGB);
}

export function nearest(pal: RGB[], r: number, g: number, b: number): number {
  let best = 0, bd = Infinity;
  for (let j = 0; j < pal.length; j++) {
    const c = pal[j];
    // Distancia ponderada (aprox. perceptual).
    const dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
    const rm = (c[0] + r) / 2;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bd) {
      bd = d;
      best = j;
    }
  }
  return best;
}
