import type { EffectDefinition } from '../engine/types';
import { darkness, gaussianBlur, luminance } from '../engine/image';
import { canny } from '../engine/edges';
import { removeSmallComponents, thin } from '../engine/morphology';
import { chaikin, polylineLength, simplifyPolyline, smoothPolyline, traceSkeleton } from '../engine/trace';
import { PathBuilder } from '../engine/scene';

/**
 * LINE ART
 * - "Bordes" (fotos): Canny → bordes de 1 px → polilíneas vectoriales.
 * - "Trazos" (dibujos): esqueleto de la tinta → línea central limpia y
 *   uniforme (útil para "re-entintar" un boceto o escaneo).
 * Las polilíneas se simplifican (Douglas–Peucker) y suavizan (Chaikin), por
 * lo que el resultado es un SVG real con trazos, no un bitmap.
 */
export const lineart: EffectDefinition = {
  id: 'lineart',
  name: 'Line Art',
  description: 'Convierte la imagen en trazos vectoriales limpios.',
  vector: true,
  params: [
    {
      key: 'source',
      type: 'segmented',
      label: 'Detectar',
      options: [
        { value: 'edges', label: 'Bordes' },
        { value: 'centerline', label: 'Trazos' },
      ],
      hint: 'Bordes para fotos; Trazos para redibujar líneas de un dibujo.',
    },
    { key: 'width', type: 'range', label: 'Grosor de línea', min: 0.3, max: 12, step: 0.1, unit: 'px', pixels: true, group: 'Línea' },
    { key: 'color', type: 'color', label: 'Color de línea', group: 'Línea' },
    { key: 'opacity', type: 'range', label: 'Opacidad', min: 0.05, max: 1, step: 0.01, group: 'Línea' },
    { key: 'detail', type: 'range', label: 'Nivel de detalle', min: 0, max: 1, step: 0.01, group: 'Detección' },
    { key: 'threshold', type: 'range', label: 'Umbral de tinta', min: 0.05, max: 0.95, step: 0.01, group: 'Detección', visibleIf: (p) => p.source === 'centerline' },
    { key: 'smoothing', type: 'range', label: 'Suavizado', min: 0, max: 1, step: 0.01, group: 'Forma' },
    { key: 'simplify', type: 'range', label: 'Simplificación', min: 0, max: 1, step: 0.01, group: 'Forma' },
    { key: 'minLength', type: 'range', label: 'Longitud mínima', min: 0, max: 80, step: 1, unit: 'px', pixels: true, group: 'Forma' },
  ],
  defaults: { source: 'edges', width: 1.6, color: '#111111', opacity: 1, detail: 0.55, threshold: 0.45, smoothing: 0.5, simplify: 0.3, minLength: 10 },
  presets: [
    { id: 'clean', name: 'Clean Line Art', params: { source: 'edges', width: 1.6, detail: 0.5, smoothing: 0.6, simplify: 0.35, minLength: 14 } },
    { id: 'detailed', name: 'Detallado', params: { source: 'edges', width: 1, detail: 0.85, smoothing: 0.3, simplify: 0.15, minLength: 4 } },
    { id: 'bold', name: 'Trazo grueso', params: { source: 'edges', width: 3.5, detail: 0.35, smoothing: 0.8, simplify: 0.5, minLength: 20 } },
    { id: 'reink', name: 'Re-entintado', params: { source: 'centerline', width: 2, smoothing: 0.6, simplify: 0.25, minLength: 3 } },
  ],
  render(input, p, ctx) {
    const { width: w, height: h } = input;
    const s = ctx.scale;
    const detail = p.detail as number;
    let mask: Uint8Array;
    if (p.source === 'centerline') {
      const dark = gaussianBlur(darkness(input), 0.6);
      mask = new Uint8Array(w * h);
      for (let i = 0; i < mask.length; i++) mask[i] = dark.data[i] > (p.threshold as number) ? 1 : 0;
      mask = removeSmallComponents(mask, w, h, Math.round((1 - detail) * 30 * s) + 2);
      mask = thin(mask, w, h);
    } else {
      const lum = luminance(input);
      const sigma = (0.6 + (1 - detail) * 3.4) * Math.max(0.5, s);
      const high = 0.04 + (1 - detail) * 0.3;
      mask = canny(lum, sigma, high * 0.45, high);
      mask = thin(mask, w, h);
    }
    const minLen = (p.minLength as number) * s;
    const smoothR = Math.round((p.smoothing as number) * 4 * Math.max(1, s));
    const eps = (p.simplify as number) * 2.5 * Math.max(0.5, s);
    const pb = new PathBuilder();
    for (const l of traceSkeleton(mask, w, h)) {
      if (polylineLength(l.pts) < minLen) continue;
      let pts = smoothPolyline(l.pts, smoothR, l.closed, 2);
      pts = simplifyPolyline(pts, eps);
      if ((p.smoothing as number) > 0.2) pts = chaikin(pts, 2, l.closed);
      pb.add(pts, l.closed);
    }
    const b = pb.build();
    return {
      scene: {
        width: w,
        height: h,
        background: ctx.background,
        layers: [{ kind: 'polylines', points: b.points, offsets: b.offsets, closed: b.closed, stroke: p.color as string, width: Math.max(0.2, (p.width as number) * s), opacity: p.opacity as number }],
      },
      info: `${pb.size.toLocaleString('es-AR')} trazos`,
    };
  },
};
