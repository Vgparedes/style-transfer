import type { EffectDefinition } from '../engine/types';
import { createImage, gaussianBlur, luminance, parseHex } from '../engine/image';

/**
 * SILUETA
 * Posteriza la luminancia en N bandas con bordes suavizados (antialias por
 * smoothstep sobre una imagen desenfocada), coloreadas desde la tinta hasta
 * el fondo. Con 2 bandas es una silueta pura.
 */
export const silhouette: EffectDefinition = {
  id: 'silhouette',
  name: 'Silueta',
  description: 'Formas planas simplificadas a partir de un umbral.',
  vector: false,
  params: [
    { key: 'threshold', type: 'range', label: 'Umbral', min: 0.02, max: 0.98, step: 0.01 },
    { key: 'levels', type: 'range', label: 'Cantidad de colores', min: 2, max: 6, step: 1 },
    { key: 'invert', type: 'toggle', label: 'Invertir' },
    { key: 'smoothing', type: 'range', label: 'Suavizado de bordes', min: 0, max: 12, step: 0.1, unit: 'px', pixels: true },
    { key: 'color', type: 'color', label: 'Color de silueta', group: 'Color' },
    { key: 'lightColor', type: 'color', label: 'Color claro (tonos intermedios)', group: 'Color', visibleIf: (p) => (p.levels as number) > 2 },
  ],
  defaults: { threshold: 0.5, levels: 2, invert: false, smoothing: 2, color: '#111111', lightColor: '#d9d4cc' },
  presets: [
    { id: 'pure', name: 'Silueta pura', params: { levels: 2, threshold: 0.5, smoothing: 2.5 } },
    { id: 'poster', name: 'Póster 3 tonos', params: { levels: 3, threshold: 0.5, smoothing: 1.5, color: '#1b2a41', lightColor: '#c9d6df' } },
    { id: 'stencil', name: 'Esténcil', params: { levels: 2, threshold: 0.42, smoothing: 5 } },
  ],
  render(input, p, ctx) {
    const { width: w, height: h } = input;
    const sm = (p.smoothing as number) * ctx.scale;
    const lum = gaussianBlur(luminance(input), sm);
    const levels = Math.round(p.levels as number);
    const thr = p.threshold as number;
    const inv = p.invert as boolean;
    const ink = parseHex(p.color as string);
    const light = parseHex(p.lightColor as string);
    const bg = ctx.background ? parseHex(ctx.background) : null;
    // Límites de banda: el umbral define el corte principal, las bandas
    // intermedias se reparten por encima/abajo de él.
    const cuts: number[] = [];
    for (let k = 1; k < levels; k++) cuts.push((thr * 2 * k) / levels);
    // Banda de transición angosta: el suavizado real de los bordes lo da el
    // desenfoque previo; esto solo antialiasa el corte.
    const soft = 0.012;
    const out = createImage(w, h);
    const o = out.data;
    for (let i = 0; i < lum.data.length; i++) {
      let v = lum.data[i];
      if (inv) v = 1 - v;
      // "Nivel" continuo: suma de escalones suavizados.
      let lvl = 0;
      for (const c of cuts) {
        const t = (v - c) / soft;
        lvl += t <= -1 ? 0 : t >= 1 ? 1 : 0.5 + 0.5 * t;
      }
      // lvl = 0 → tinta; lvl = levels-1 → fondo.
      const f = lvl / (levels - 1);
      const k = i * 4;
      if (levels === 2 || f <= 0) {
        mix(o, k, ink, bg, f);
      } else {
        // Tinta → color claro → fondo.
        const mid = (levels - 2) / (levels - 1);
        if (f < mid) {
          const t = f / mid;
          o[k] = ink[0] + (light[0] - ink[0]) * t;
          o[k + 1] = ink[1] + (light[1] - ink[1]) * t;
          o[k + 2] = ink[2] + (light[2] - ink[2]) * t;
          o[k + 3] = 255;
        } else {
          mix(o, k, light, bg, (f - mid) / (1 - mid));
        }
      }
    }
    return { raster: out };
  },
};

function mix(o: Uint8ClampedArray, k: number, c: number[], bg: number[] | null, t: number) {
  if (bg) {
    o[k] = c[0] + (bg[0] - c[0]) * t;
    o[k + 1] = c[1] + (bg[1] - c[1]) * t;
    o[k + 2] = c[2] + (bg[2] - c[2]) * t;
    o[k + 3] = 255;
  } else {
    o[k] = c[0];
    o[k + 1] = c[1];
    o[k + 2] = c[2];
    o[k + 3] = (1 - t) * 255;
  }
}
