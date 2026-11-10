import type { EffectDefinition, SceneLayer } from '../engine/types';
import { clamp01, contrastFactor, luminance, SummedArea, type FloatMap } from '../engine/image';
import { PathBuilder } from '../engine/scene';

/**
 * HALFTONE
 * Trama periódica rotada: cada celda toma el promedio de tono de su área
 * (tabla de áreas sumadas) y dibuja un punto/cuadrado cuya superficie es
 * proporcional a ese tono, o una línea de ancho variable.
 * Multicolor = separación CMYK con ángulos de trama clásicos y fusión
 * "multiply", como en imprenta.
 */

type Shape = 'circle' | 'square' | 'line';

function channelMaps(input: { width: number; height: number; data: Uint8ClampedArray }, mode: string, contrast: number, gamma: number) {
  const { width: w, height: h, data } = input;
  const n = w * h;
  const c = contrastFactor(contrast);
  const adj = (v: number) => {
    v = (v - 0.5) * c + 0.5;
    v = clamp01(v);
    return gamma !== 1 ? Math.pow(v, gamma) : v;
  };
  if (mode === 'cmyk') {
    const C = new Float32Array(n), M = new Float32Array(n), Y = new Float32Array(n), K = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const a = data[p + 3] / 255;
      const r = (data[p] / 255) * a + (1 - a);
      const g = (data[p + 1] / 255) * a + (1 - a);
      const b = (data[p + 2] / 255) * a + (1 - a);
      const k = 1 - Math.max(r, g, b);
      const d = 1 - k || 1;
      C[i] = adj((1 - r - k) / d);
      M[i] = adj((1 - g - k) / d);
      Y[i] = adj((1 - b - k) / d);
      K[i] = adj(k);
    }
    const mk = (d: Float32Array): FloatMap => ({ width: w, height: h, data: d });
    return [
      { map: mk(C), color: '#00a6e0', angle: 15 },
      { map: mk(M), color: '#e6007e', angle: 75 },
      { map: mk(Y), color: '#ffe600', angle: 0 },
      { map: mk(K), color: '#1a1a1a', angle: 45 },
    ];
  }
  const lum = luminance(input);
  for (let i = 0; i < n; i++) lum.data[i] = adj(1 - lum.data[i]);
  return [{ map: lum, color: '', angle: 0 }];
}

export const halftone: EffectDefinition = {
  id: 'halftone',
  name: 'Halftone',
  description: 'Trama de semitonos de imprenta: puntos, cuadrados o líneas.',
  vector: true,
  params: [
    {
      key: 'shape',
      type: 'segmented',
      label: 'Forma',
      options: [
        { value: 'circle', label: 'Círculos' },
        { value: 'square', label: 'Cuadrados' },
        { value: 'line', label: 'Líneas' },
      ],
    },
    { key: 'cell', type: 'range', label: 'Frecuencia (tamaño de celda)', min: 2, max: 60, step: 0.5, unit: 'px', pixels: true, group: 'Trama' },
    { key: 'dotScale', type: 'range', label: 'Tamaño de trama', min: 0.2, max: 1.6, step: 0.01, group: 'Trama', hint: 'Escala del punto respecto de la celda.' },
    { key: 'angle', type: 'range', label: 'Ángulo', min: 0, max: 90, step: 1, unit: '°', group: 'Trama' },
    { key: 'contrast', type: 'range', label: 'Contraste', min: -1, max: 1, step: 0.01, group: 'Tono' },
    { key: 'gamma', type: 'range', label: 'Gamma', min: 0.3, max: 3, step: 0.01, group: 'Tono' },
    {
      key: 'colorMode',
      type: 'segmented',
      label: 'Color',
      group: 'Color',
      options: [
        { value: 'mono', label: 'Mono' },
        { value: 'source', label: 'Original' },
        { value: 'cmyk', label: 'CMYK' },
      ],
    },
    { key: 'color', type: 'color', label: 'Color de tinta', group: 'Color', visibleIf: (p) => p.colorMode === 'mono' },
    { key: 'opacity', type: 'range', label: 'Opacidad', min: 0.05, max: 1, step: 0.01, group: 'Color' },
  ],
  defaults: { shape: 'circle', cell: 8, dotScale: 1, angle: 45, contrast: 0, gamma: 1, colorMode: 'mono', color: '#111111', opacity: 1 },
  presets: [
    { id: 'minimal', name: 'Minimal Halftone', params: { shape: 'circle', cell: 10, dotScale: 0.9, angle: 45, colorMode: 'mono', contrast: 0.2 } },
    { id: 'newsprint', name: 'Periódico', params: { shape: 'circle', cell: 5, dotScale: 1, angle: 45, colorMode: 'mono', gamma: 0.9 } },
    { id: 'pop', name: 'Pop CMYK', params: { shape: 'circle', cell: 9, dotScale: 1.1, colorMode: 'cmyk', contrast: 0.15 } },
    { id: 'lines', name: 'Líneas', params: { shape: 'line', cell: 7, angle: 30, colorMode: 'mono', dotScale: 1 } },
    { id: 'pixels', name: 'Cuadros de color', params: { shape: 'square', cell: 12, angle: 0, colorMode: 'source', dotScale: 1 } },
  ],
  render(input, p, ctx) {
    const { width: w, height: h } = input;
    const cell = Math.max(1.5, (p.cell as number) * ctx.scale);
    const shape = p.shape as Shape;
    const scaleK = p.dotScale as number;
    const mode = p.colorMode as string;
    const channels = channelMaps(input, mode, p.contrast as number, p.gamma as number);
    const layers: SceneLayer[] = [];
    let count = 0;
    // Promedios de color por celda para el modo "Original".
    const rgbSAT =
      mode === 'source'
        ? [0, 1, 2].map((c) => {
            const d = new Float32Array(w * h);
            for (let i = 0; i < d.length; i++) {
              const a = input.data[i * 4 + 3] / 255;
              d[i] = (input.data[i * 4 + c] / 255) * a + (1 - a);
            }
            return new SummedArea({ width: w, height: h, data: d });
          })
        : null;

    for (const ch of channels) {
      const sat = new SummedArea(ch.map);
      const ang = (((p.angle as number) + ch.angle) * Math.PI) / 180;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      const cx = w / 2, cy = h / 2;
      const R = Math.hypot(w, h) / 2 + cell;
      const nCells = Math.ceil(R / cell);
      const fill = mode === 'mono' ? (p.color as string) : ch.color || '#111111';
      const blend = mode === 'cmyk' ? 'multiply' : 'normal';

      if (shape === 'line') {
        // Una línea por fila de la trama, con ancho ∝ tono, muestreada a lo largo.
        const pb = new PathBuilder();
        const step = Math.max(0.75, cell / 4);
        for (let j = -nCells; j <= nCells; j++) {
          let upper: number[] = [], lower: number[] = [];
          const flush = () => {
            if (upper.length >= 4) {
              const poly = upper.slice();
              for (let k = lower.length - 2; k >= 0; k -= 2) poly.push(lower[k], lower[k + 1]);
              pb.add(poly, true);
            }
            upper = [];
            lower = [];
          };
          for (let t = -R; t <= R; t += step) {
            const x = cx + t * cos - j * cell * sin;
            const y = cy + t * sin + j * cell * cos;
            if (x < -cell || y < -cell || x > w + cell || y > h + cell) {
              flush();
              continue;
            }
            const v = sat.mean(x - step, y - cell / 2, x + step, y + cell / 2);
            const half = Math.min(cell * 0.62, (v * cell * scaleK) / 2);
            if (half < 0.08) {
              flush();
              continue;
            }
            upper.push(x + half * sin, y - half * cos);
            lower.push(x - half * sin, y + half * cos);
          }
          flush();
        }
        const b = pb.build();
        count += pb.size;
        layers.push({ kind: 'polygons', points: b.points, offsets: b.offsets, fill, opacity: p.opacity as number, blend });
        continue;
      }

      const xs: number[] = [], ys: number[] = [], ss: number[] = [], cols: number[] = [];
      for (let j = -nCells; j <= nCells; j++) {
        for (let i = -nCells; i <= nCells; i++) {
          const x = cx + i * cell * cos - j * cell * sin;
          const y = cy + i * cell * sin + j * cell * cos;
          if (x < -cell / 2 || y < -cell / 2 || x > w + cell / 2 || y > h + cell / 2) continue;
          const hc = cell / 2;
          const v = sat.mean(x - hc, y - hc, x + hc, y + hc);
          if (v <= 0.01) continue;
          // Área del punto proporcional al tono.
          const size =
            shape === 'circle'
              ? cell * Math.sqrt(v / Math.PI) * scaleK
              : cell * Math.sqrt(v) * scaleK;
          if (size < 0.1) continue;
          xs.push(x);
          ys.push(y);
          ss.push(size);
          if (rgbSAT) {
            const r = Math.round(rgbSAT[0].mean(x - hc, y - hc, x + hc, y + hc) * 255);
            const g = Math.round(rgbSAT[1].mean(x - hc, y - hc, x + hc, y + hc) * 255);
            const bb = Math.round(rgbSAT[2].mean(x - hc, y - hc, x + hc, y + hc) * 255);
            cols.push((r << 16) | (g << 8) | bb);
          }
        }
      }
      count += xs.length;
      const colors = rgbSAT ? new Uint32Array(cols) : undefined;
      if (shape === 'circle') {
        layers.push({ kind: 'circles', xs: new Float32Array(xs), ys: new Float32Array(ys), rs: new Float32Array(ss), fill, colors, opacity: p.opacity as number, blend });
      } else {
        layers.push({ kind: 'squares', xs: new Float32Array(xs), ys: new Float32Array(ys), sizes: new Float32Array(ss), angle: ang, fill, colors, opacity: p.opacity as number, blend });
      }
    }
    return {
      scene: { width: w, height: h, background: ctx.background, layers },
      info: `${count.toLocaleString('es-AR')} ${shape === 'line' ? 'líneas' : 'puntos'}`,
    };
  },
};
