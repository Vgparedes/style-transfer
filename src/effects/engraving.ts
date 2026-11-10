import type { EffectDefinition } from '../engine/types';
import { darkness, gaussianBlur, sampleBilinear } from '../engine/image';
import { PathBuilder } from '../engine/scene';

/**
 * GRABADO / ENGRAVING
 * Líneas paralelas cuyo ancho varía con el tono (como el buril sobre la
 * plancha). Variantes: rectas, onduladas, en relieve (las líneas se
 * desplazan con la luminosidad, siguiendo el volumen) y tramado cruzado en
 * las sombras. Cada línea es un polígono "cinta": 100 % vectorial.
 */
export const engraving: EffectDefinition = {
  id: 'engraving',
  name: 'Grabado',
  description: 'Líneas de buril con grosor variable, tramas y sombreado.',
  vector: true,
  params: [
    {
      key: 'pattern',
      type: 'select',
      label: 'Patrón',
      options: [
        { value: 'straight', label: 'Líneas rectas' },
        { value: 'wave', label: 'Onduladas' },
        { value: 'relief', label: 'Relieve (sigue el volumen)' },
        { value: 'circular', label: 'Concéntricas' },
      ],
    },
    { key: 'spacing', type: 'range', label: 'Densidad (separación)', min: 2, max: 30, step: 0.5, unit: 'px', pixels: true, group: 'Líneas' },
    { key: 'angle', type: 'range', label: 'Dirección del tramado', min: 0, max: 180, step: 1, unit: '°', group: 'Líneas' },
    { key: 'thickness', type: 'range', label: 'Grosor máximo', min: 0.2, max: 1.2, step: 0.01, group: 'Líneas', hint: 'Relativo a la separación.' },
    { key: 'crosshatch', type: 'range', label: 'Tramado cruzado', min: 0, max: 1, step: 0.01, group: 'Líneas', hint: 'Agrega una segunda trama en las sombras.' },
    { key: 'amplitude', type: 'range', label: 'Amplitud de onda/relieve', min: 0, max: 3, step: 0.01, group: 'Líneas', visibleIf: (p) => p.pattern === 'wave' || p.pattern === 'relief' },
    { key: 'contrast', type: 'range', label: 'Contraste', min: -1, max: 1, step: 0.01, group: 'Tono' },
    { key: 'detail', type: 'range', label: 'Nivel de detalle', min: 0, max: 1, step: 0.01, group: 'Tono' },
    { key: 'color', type: 'color', label: 'Color de tinta', group: 'Color' },
  ],
  defaults: { pattern: 'relief', spacing: 6, angle: 20, thickness: 0.85, crosshatch: 0.3, amplitude: 0.8, contrast: 0.15, detail: 0.6, color: '#1a1410' },
  presets: [
    { id: 'vintage', name: 'Vintage Engraving', params: { pattern: 'relief', spacing: 5, angle: 25, thickness: 0.9, crosshatch: 0.45, amplitude: 0.9, contrast: 0.25, color: '#2a1d12' } },
    { id: 'banknote', name: 'Billete', params: { pattern: 'wave', spacing: 4, angle: 0, thickness: 0.8, crosshatch: 0.2, amplitude: 1.2 } },
    { id: 'clean', name: 'Líneas limpias', params: { pattern: 'straight', spacing: 7, angle: 45, thickness: 1, crosshatch: 0 } },
    { id: 'rings', name: 'Anillos', params: { pattern: 'circular', spacing: 6, thickness: 0.9, crosshatch: 0 } },
  ],
  render(input, p, ctx) {
    const { width: w, height: h } = input;
    const s = ctx.scale;
    const spacing = Math.max(1.2, (p.spacing as number) * s);
    const dark = gaussianBlur(darkness(input, p.contrast as number), (1 - (p.detail as number)) * spacing * 0.6 + 0.5);
    const thick = p.thickness as number;
    const pattern = p.pattern as string;
    const amp = (p.amplitude as number) * spacing;
    const pb = new PathBuilder();
    const step = Math.max(0.6, spacing / 4);
    const R = Math.hypot(w, h) / 2 + spacing * 2;
    const cx = w / 2, cy = h / 2;

    const lineSet = (angleDeg: number, toneFrom: number) => {
      const a = (angleDeg * Math.PI) / 180;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rows = Math.ceil(R / spacing);
      for (let j = -rows; j <= rows; j++) {
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
          let off = j * spacing;
          if (pattern === 'wave') off += Math.sin(t / (spacing * 6)) * amp;
          let x = cx + t * ca - off * sa;
          let y = cy + t * sa + off * ca;
          if (pattern === 'relief') {
            // Desplaza la línea en proporción a la luz: crea sensación de volumen.
            const v = sampleBilinear(dark, x, y);
            off += (0.5 - v) * amp;
            x = cx + t * ca - off * sa;
            y = cy + t * sa + off * ca;
          }
          if (x < -spacing || y < -spacing || x > w + spacing || y > h + spacing) {
            flush();
            continue;
          }
          let v = sampleBilinear(dark, x, y);
          if (toneFrom > 0) v = (v - toneFrom) / (1 - toneFrom);
          const half = (v * spacing * thick) / 2;
          if (half < 0.12) {
            flush();
            continue;
          }
          upper.push(x + half * sa, y - half * ca);
          lower.push(x - half * sa, y + half * ca);
        }
        flush();
      }
    };

    if (pattern === 'circular') {
      const maxR = R;
      for (let r = spacing / 2; r < maxR; r += spacing) {
        const n = Math.max(12, Math.ceil((2 * Math.PI * r) / step));
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
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (x < -spacing || y < -spacing || x > w + spacing || y > h + spacing) {
            flush();
            continue;
          }
          const half = (sampleBilinear(dark, x, y) * spacing * thick) / 2;
          if (half < 0.12) {
            flush();
            continue;
          }
          upper.push(cx + Math.cos(a) * (r + half), cy + Math.sin(a) * (r + half));
          lower.push(cx + Math.cos(a) * (r - half), cy + Math.sin(a) * (r - half));
        }
        flush();
      }
    } else {
      lineSet(p.angle as number, 0);
    }
    const ch = p.crosshatch as number;
    if (ch > 0 && pattern !== 'circular') lineSet((p.angle as number) + 90, 1 - ch * 0.6);
    else if (ch > 0) lineSet(45, 1 - ch * 0.6);

    const b = pb.build();
    return {
      scene: {
        width: w,
        height: h,
        background: ctx.background,
        layers: [{ kind: 'polygons', points: b.points, offsets: b.offsets, fill: p.color as string, opacity: 1 }],
      },
      info: `${pb.size.toLocaleString('es-AR')} trazos de buril`,
    };
  },
};
