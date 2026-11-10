import { gaussianBlur, type FloatMap } from './image';

/**
 * Detector de bordes de Canny: gradiente de Sobel, supresión de no-máximos
 * (bordes de 1 px) e histéresis con dos umbrales. Devuelve una máscara.
 */
export function canny(lum: FloatMap, sigma: number, low: number, high: number): Uint8Array {
  const { width: w, height: h } = lum;
  const g = gaussianBlur(lum, sigma).data;
  const mag = new Float32Array(w * h);
  const dir = new Uint8Array(w * h);
  let maxMag = 1e-6;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy =
        -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > maxMag) maxMag = m;
      let a = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (a < 0) a += 180;
      dir[i] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
    }
  }
  // Normaliza para que los umbrales sean relativos al contraste de la imagen.
  const nms = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      let a: number, b: number;
      switch (dir[i]) {
        case 0: a = mag[i - 1]; b = mag[i + 1]; break;
        case 1: a = mag[i - w - 1]; b = mag[i + w + 1]; break;
        case 2: a = mag[i - w]; b = mag[i + w]; break;
        default: a = mag[i - w + 1]; b = mag[i + w - 1]; break;
      }
      nms[i] = m >= a && m >= b ? m / maxMag : 0;
    }
  }
  const out = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < nms.length; i++) {
    if (nms[i] >= high && !out[i]) {
      out[i] = 1;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop()!;
        const x = j % w, y = (j / w) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const k = yy * w + xx;
            if (!out[k] && nms[k] >= low) {
              out[k] = 1;
              stack.push(k);
            }
          }
        }
      }
    }
  }
  return out;
}
