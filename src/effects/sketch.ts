import type { EffectDefinition } from '../engine/types';
import { clamp01, gaussianBlur, inkToImage, luminance, sampleBilinear, type FloatMap } from '../engine/image';
import { fbm, hash2 } from '../engine/random';

/**
 * SKETCH / HAND DRAWN
 * 1. Líneas de lápiz por "color dodge": gris / (1 - desenfoque(invertido)).
 *    Resalta bordes con un trazo suave cuyo grosor depende del radio.
 * 2. Sombreado con textura de grafito: ruido desenfocado en una dirección
 *    (rayado) que aparece solo en las zonas oscuras.
 * 3. Irregularidad: desplaza el muestreo con ruido fractal para que las
 *    líneas "tiemblen" como hechas a mano.
 */
export const sketch: EffectDefinition = {
  id: 'sketch',
  name: 'Sketch',
  description: 'Aspecto de dibujo a lápiz hecho a mano.',
  vector: false,
  params: [
    { key: 'intensity', type: 'range', label: 'Intensidad del trazo', min: 0, max: 1, step: 0.01 },
    { key: 'thickness', type: 'range', label: 'Grosor', min: 0.5, max: 12, step: 0.1, unit: 'px', pixels: true },
    { key: 'detail', type: 'range', label: 'Nivel de detalle', min: 0, max: 1, step: 0.01 },
    { key: 'irregularity', type: 'range', label: 'Irregularidad', min: 0, max: 1, step: 0.01 },
    { key: 'texture', type: 'range', label: 'Textura (sombreado)', min: 0, max: 1, step: 0.01, group: 'Sombreado' },
    { key: 'hatchAngle', type: 'range', label: 'Dirección del rayado', min: 0, max: 180, step: 1, unit: '°', group: 'Sombreado' },
    { key: 'color', type: 'color', label: 'Color del lápiz', group: 'Color' },
    { key: 'seed', type: 'seed', label: 'Variante', group: 'Color' },
  ],
  defaults: { intensity: 0.55, thickness: 3, detail: 0.6, irregularity: 0.3, texture: 0.45, hatchAngle: 35, color: '#222222', seed: 1 },
  presets: [
    { id: 'pencil', name: 'Lápiz suave', params: { intensity: 0.45, thickness: 3, texture: 0.4, irregularity: 0.25 } },
    { id: 'charcoal', name: 'Carbonilla', params: { intensity: 0.85, thickness: 6, texture: 0.8, irregularity: 0.4, detail: 0.4 } },
    { id: 'ink', name: 'Tinta rápida', params: { intensity: 1, thickness: 1.6, texture: 0.1, irregularity: 0.55, detail: 0.75 } },
  ],
  render(input, p, ctx) {
    const { width: w, height: h } = input;
    const s = ctx.scale;
    const seed = p.seed as number;
    const detail = p.detail as number;
    let lum = luminance(input);
    lum = gaussianBlur(lum, (1 - detail) * 2.5 * s);

    // Irregularidad: deformación suave del muestreo.
    const amp = (p.irregularity as number) * 5 * s;
    if (amp > 0.05) {
      const freq = 1 / (40 * s);
      const src = lum;
      const warped = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = (fbm(x * freq, y * freq, seed) - 0.5) * 2 * amp;
          const dy = (fbm(x * freq + 31.7, y * freq + 11.3, seed + 7) - 0.5) * 2 * amp;
          warped[y * w + x] = sampleBilinear(src, x + dx, y + dy);
        }
      }
      lum = { width: w, height: h, data: warped };
    }

    // Color dodge.
    const inv: FloatMap = { width: w, height: h, data: lum.data.map((v) => 1 - v) };
    const blur = gaussianBlur(inv, (p.thickness as number) * s);
    const gamma = 1 + (p.intensity as number) * 6;
    const lines = new Float32Array(w * h);
    for (let i = 0; i < lines.length; i++) {
      const d = 1 - blur.data[i];
      const v = d <= 0.0001 ? 1 : Math.min(1, lum.data[i] / d);
      lines[i] = 1 - Math.pow(v, gamma); // cobertura de grafito
    }

    // Rayado: ruido estirado en la dirección elegida.
    const tex = p.texture as number;
    const cov = new Float32Array(w * h);
    if (tex > 0) {
      const a = ((p.hatchAngle as number) * Math.PI) / 180;
      const ca = Math.cos(a), sa = Math.sin(a);
      const fAlong = 1 / (25 * s), fAcross = 1 / (1.6 * s);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const u = (x * ca + y * sa) * fAlong;
          const v = (-x * sa + y * ca) * fAcross;
          const n = fbm(u, v, seed + 3, 2) * 0.8 + hash2(x, y, seed) * 0.2;
          const shade = Math.pow(1 - lum.data[i], 1.3);
          const hatch = clamp01((shade * 1.6 - n * 0.9) * 1.4) * tex;
          cov[i] = clamp01(Math.max(lines[i], hatch * 0.85));
        }
      }
    } else {
      cov.set(lines);
    }
    // Grano de papel sutil.
    for (let i = 0; i < cov.length; i++) {
      if (cov[i] > 0) cov[i] *= 0.88 + 0.12 * hash2(i % w, (i / w) | 0, seed + 99);
    }
    return { raster: inkToImage({ width: w, height: h, data: cov }, p.color as string, ctx.background) };
  },
};
