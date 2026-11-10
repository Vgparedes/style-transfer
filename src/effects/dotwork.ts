import type { EffectContext, EffectDefinition, EffectParams, RGBAImage } from '../engine/types';
import { clamp01, darkness, gaussianBlur, samplePixel, type FloatMap } from '../engine/image';
import { boundary, distanceTransform, removeSmallComponents, thin } from '../engine/morphology';
import { resampleByArc, smoothPolyline, traceSkeleton, polylineLength } from '../engine/trace';
import { PointGrid, poissonVariable } from '../engine/sampling';
import { createRng } from '../engine/random';

/**
 * DOTWORK / STIPPLING
 * ===================
 *
 * Dos motores distintos, porque "puntear una foto" y "puntear un dibujo" son
 * problemas diferentes:
 *
 * 1. ESTRUCTURA (dibujos, line art, logos)
 *    Reconstruye la geometría del dibujo en vez de muestrear tonos:
 *    - Umbraliza la tinta y calcula la transformada de distancia (grosor local).
 *    - Separa trazos finos de formas anchas (grosor > "grosor máx. de línea").
 *    - Trazos finos → esqueleto de 1 px → polilíneas → puntos equiespaciados
 *      sobre la línea central. Así una línea de 1–2 px se convierte en una
 *      hilera limpia de puntos con la misma forma, orientación y posición.
 *    - Formas anchas → puntos sobre el contorno (silueta nítida) + relleno
 *      con ruido azul en el interior.
 *    - En modo "variable" el tamaño de cada punto sigue el grosor real del
 *      trazo, preservando el peso de línea del original.
 *
 * 2. TONO (fotografías, sombreados)
 *    Stippling clásico: la cantidad de puntos por área es proporcional a la
 *    oscuridad. Se usa muestreo de Poisson de radio variable (ruido azul), que
 *    evita las aglomeraciones del ruido aleatorio y el aspecto mecánico de la
 *    trama de semitonos.
 *
 * AUTO elige uno de los dos según el histograma (papel claro + pocos
 * medios tonos planos ⇒ dibujo).
 */

const MAX_DOTS = 2_000_000;

interface Dots {
  xs: number[];
  ys: number[];
  rs: number[];
}

function params(p: EffectParams, ctx: EffectContext) {
  const s = ctx.scale;
  return {
    mode: p.mode as 'auto' | 'structure' | 'tone',
    dotR: Math.max(0.05, ((p.dotSize as number) * s) / 2),
    spacing: Math.max(0.6, (p.spacing as number) * s),
    density: p.density as number,
    variable: p.sizeMode === 'variable',
    variation: p.sizeVariation as number,
    organic: p.distribution === 'organic',
    jitter: p.distribution === 'organic' ? (p.jitter as number) : 0,
    contrast: p.contrast as number,
    threshold: p.threshold as number,
    lineMax: Math.max(1, (p.lineWidthMax as number) * s),
    outline: p.outline as boolean,
    smoothing: p.smoothing as number,
    cleanup: (p.cleanup as number) * s,
    seed: p.seed as number,
  };
}

type P = ReturnType<typeof params>;

/** ¿La imagen parece un dibujo (papel + tinta) más que una foto? */
export function looksLikeDrawing(dark: FloatMap): boolean {
  const { width: w, height: h, data } = dark;
  let paper = 0, ink = 0, flatMid = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 250_000)));
  let total = 0;
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const i = y * w + x;
      const v = data[i];
      total++;
      if (v < 0.12) {
        paper++;
        continue;
      }
      ink++;
      if (v > 0.15 && v < 0.85) {
        const gx = data[i + 1] - data[i - 1];
        const gy = data[i + w] - data[i - w];
        if (gx * gx + gy * gy < 0.0064) flatMid++;
      }
    }
  }
  if (total === 0) return true;
  const paperFrac = paper / total;
  const flatFrac = ink ? flatMid / ink : 0;
  return paperFrac > 0.35 && flatFrac < 0.3;
}

function dotRadius(base: number, p: P, t: number, rng: () => number): number {
  let r = base;
  if (p.variable) r = base * (1 - p.variation + p.variation * t);
  if (p.jitter > 0) r *= 1 + (rng() - 0.5) * p.jitter * 0.5;
  return Math.max(0.05, r);
}

// ---------------------------------------------------------------------------
// Motor ESTRUCTURA
// ---------------------------------------------------------------------------

function renderStructure(dark: FloatMap, p: P): Dots {
  const { width: w, height: h } = dark;
  const n = w * h;
  const rng = createRng(p.seed);
  const out: Dots = { xs: [], ys: [], rs: [] };

  // 1) Máscara de tinta. Un desenfoque mínimo estabiliza el umbral en bordes
  //    antialiasados sin engrosar los trazos.
  const smooth = gaussianBlur(dark, 0.5);
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = smooth.data[i] > p.threshold ? 1 : 0;
  if (p.cleanup > 0) {
    const minArea = Math.max(2, Math.round((Math.PI * p.cleanup * p.cleanup) / 4));
    mask = removeSmallComponents(mask, w, h, minArea) as Uint8Array<ArrayBuffer>;
  }

  // 2) Grosor local de la tinta.
  const dt = distanceTransform(mask, w, h);

  // 3) Separar formas anchas (núcleo con radio > lineMax/2, dilatado) de trazos finos.
  const half = p.lineMax / 2 + 0.5;
  const core = new Uint8Array(n);
  let hasWide = false;
  for (let i = 0; i < n; i++) {
    if (dt[i] > half) {
      core[i] = 1;
      hasWide = true;
    }
  }
  const wide = new Uint8Array(n);
  if (hasWide) {
    const notCore = new Uint8Array(n);
    for (let i = 0; i < n; i++) notCore[i] = core[i] ? 0 : 1;
    const toCore = distanceTransform(notCore, w, h, false);
    for (let i = 0; i < n; i++) if (mask[i] && toCore[i] <= half + 1) wide[i] = 1;
  }
  const thinMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) thinMask[i] = mask[i] && !wide[i] ? 1 : 0;

  // Rejilla para evitar puntos superpuestos entre trazos que se cruzan.
  const grid = new PointGrid(w, h, p.spacing, 4096);
  const minGap = p.spacing * 0.6;

  // Grosor de referencia = mediana del grosor sobre el esqueleto.
  const skel = thin(thinMask, w, h);
  const widths: number[] = [];
  for (let i = 0; i < n; i += 1) if (skel[i]) widths.push(dt[i]);
  widths.sort((a, b) => a - b);
  const refHalf = widths.length ? Math.max(0.75, widths[widths.length >> 1]) : 1;

  const smoothR = Math.round(p.smoothing * 3 * Math.max(1, p.spacing / 4));

  const placeAlong = (pts: number[], closed: boolean, tAt: (x: number, y: number) => number) => {
    const samples = resampleByArc(pts, p.spacing, closed);
    for (let k = 0; k < samples.length; k += 2) {
      let x = samples[k], y = samples[k + 1];
      if (p.jitter > 0) {
        x += (rng() - 0.5) * p.jitter * p.spacing * 0.5;
        y += (rng() - 0.5) * p.jitter * p.spacing * 0.5;
      }
      if (grid.conflicts(x, y, minGap)) continue;
      const r = dotRadius(p.dotR, p, tAt(x, y), rng);
      grid.add(x, y, Math.max(r, minGap));
      out.xs.push(x);
      out.ys.push(y);
      out.rs.push(r);
    }
  };

  const dtAt = (x: number, y: number) => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x - 0.5)));
    const yi = Math.min(h - 1, Math.max(0, Math.round(y - 0.5)));
    return dt[yi * w + xi];
  };

  // 4) Trazos finos → línea central.
  {
    const lines = traceSkeleton(skel, w, h);
    const items = lines
      .map((l) => ({ l, len: polylineLength(l.pts) }))
      .filter(({ l, len }) => {
        // Poda de "espolones": ramitas cortas con un extremo libre que el
        // esqueleto genera en esquinas y trazos gruesos.
        const freeA = l.startDeg <= 1, freeB = l.endDeg <= 1;
        if (freeA !== freeB && len < refHalf * 2.5) return false;
        if (freeA && freeB && p.cleanup > 0 && len < p.cleanup) return false;
        return true;
      })
      .sort((a, b) => b.len - a.len);
    for (const { l } of items) {
      const pts = smoothPolyline(l.pts, smoothR, l.closed, 2);
      placeAlong(pts, l.closed, (x, y) => {
        // t ≈ grosor local relativo al grosor típico del dibujo.
        return Math.min(2.2, Math.max(0.35, dtAt(x, y) / refHalf));
      });
    }
  }

  // 5) Formas anchas → contorno + relleno.
  if (hasWide) {
    // Contorno desplazado hacia adentro el radio del punto, para que la
    // silueta resultante coincida con la original.
    const inset = Math.min(p.dotR, half);
    const inner = new Uint8Array(n);
    for (let i = 0; i < n; i++) inner[i] = wide[i] && dt[i] > inset ? 1 : 0;
    if (p.outline) {
      const edge = thin(boundary(inner, w, h), w, h);
      const contours = traceSkeleton(edge, w, h)
        .map((l) => ({ l, len: polylineLength(l.pts) }))
        .sort((a, b) => b.len - a.len);
      for (const { l, len } of contours) {
        if (len < p.spacing * 0.5 && contours.length > 1) continue;
        const pts = smoothPolyline(l.pts, Math.max(1, smoothR), l.closed, 2);
        placeAlong(pts, l.closed, () => 1);
      }
    }
    if (p.density > 0) {
      const fillSpacing = p.spacing / (0.12 + 0.88 * p.density);
      const thr = p.threshold;
      const tone = (i: number) => clamp01((dark.data[i] - thr) / Math.max(0.05, 1 - thr));
      const fillMask = new Uint8Array(n);
      const inset2 = p.outline ? inset + p.spacing * 0.5 : inset;
      for (let i = 0; i < n; i++) fillMask[i] = wide[i] && dt[i] > inset2 ? 1 : 0;
      if (p.organic) {
        poissonVariable(
          grid,
          w,
          h,
          (i) => {
            if (!fillMask[i]) return 0;
            const t = tone(i);
            // Dentro de las formas también se respeta el tono (degradés).
            return fillSpacing / Math.sqrt(Math.max(0.08, t));
          },
          p.seed + 17,
          (x, y, _r, i) => {
            if (out.xs.length >= MAX_DOTS) return;
            const r = dotRadius(p.dotR, p, 0.5 + tone(i), rng);
            out.xs.push(x);
            out.ys.push(y);
            out.rs.push(r);
          },
        );
      } else {
        hexGrid(w, h, fillSpacing, (x, y, row, col) => {
          const i = Math.min(h - 1, y | 0) * w + Math.min(w - 1, x | 0);
          if (!fillMask[i]) return;
          const t = tone(i);
          if (t < bayer(row, col) * 0.9) return;
          if (grid.conflicts(x, y, minGap)) return;
          out.xs.push(x);
          out.ys.push(y);
          out.rs.push(dotRadius(p.dotR, p, 0.5 + t, rng));
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Motor TONO
// ---------------------------------------------------------------------------

function renderTone(dark: FloatMap, p: P): Dots {
  const { width: w, height: h } = dark;
  const rng = createRng(p.seed);
  const out: Dots = { xs: [], ys: [], rs: [] };
  // Suavizar la densidad a escala del espaciado evita que el grano de la
  // imagen se traduzca en ruido de puntos.
  const tone = gaussianBlur(dark, p.spacing * 0.35);
  const td = tone.data;
  const cutoff = 0.02 + (1 - p.density) * 0.3;
  const k = 0.5 + (1 - p.density) * 0.35;
  const norm = (v: number) => (v - cutoff) / (1 - cutoff);
  const maxR = p.spacing * 7;

  // Estimación de cantidad de puntos para no colgar el navegador.
  let est = 0;
  for (let i = 0; i < td.length; i += 7) {
    const v = norm(td[i]);
    if (v > 0) est += 7 / (Math.PI * 0.25 * (p.spacing * Math.pow(v, -k)) ** 2);
  }
  const reduce = est > MAX_DOTS ? Math.sqrt(est / MAX_DOTS) : 1;
  const spacing = p.spacing * reduce;

  if (p.organic) {
    const grid = new PointGrid(w, h, spacing, 4096);
    poissonVariable(
      grid,
      w,
      h,
      (i) => {
        const v = norm(td[i]);
        if (v <= 0) return 0;
        return Math.min(maxR, spacing * Math.pow(v, -k));
      },
      p.seed,
      (x, y, _r, i) => {
        const v = clamp01(norm(td[i]));
        out.xs.push(x);
        out.ys.push(y);
        out.rs.push(dotRadius(p.dotR, p, 0.4 + v * 1.2, rng));
      },
    );
  } else {
    hexGrid(w, h, spacing, (x, y, row, col) => {
      const i = Math.min(h - 1, y | 0) * w + Math.min(w - 1, x | 0);
      const v = clamp01(norm(td[i]));
      if (v <= 0) return;
      if (p.variable) {
        // Tamaño según tono (con variación 1 es casi un semitono orgánico).
        const r = p.dotR * (1 - p.variation + p.variation * Math.sqrt(v) * 1.5);
        if (v < bayer(row, col) * (1 - p.variation)) return;
        if (r < 0.08) return;
        out.xs.push(x);
        out.ys.push(y);
        out.rs.push(r);
      } else {
        // Puntos uniformes: el tono se expresa con la cantidad (tramado ordenado).
        if (v < bayer(row, col)) return;
        out.xs.push(x);
        out.ys.push(y);
        out.rs.push(p.dotR);
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function bayer(row: number, col: number): number {
  return (BAYER4[(row & 3) * 4 + (col & 3)] + 0.5) / 16;
}

function hexGrid(w: number, h: number, s: number, fn: (x: number, y: number, row: number, col: number) => void) {
  const dy = s * Math.sqrt(3) / 2;
  let row = 0;
  for (let y = dy / 2; y < h; y += dy, row++) {
    const off = row & 1 ? s / 2 : 0;
    let col = 0;
    for (let x = s / 2 + off; x < w; x += s, col++) fn(x, y, row, col);
  }
}

// ---------------------------------------------------------------------------
// Definición del efecto
// ---------------------------------------------------------------------------

const isStructure = (p: EffectParams) => p.mode !== 'tone';
const isOrganic = (p: EffectParams) => p.distribution === 'organic';

export const dotwork: EffectDefinition = {
  id: 'dotwork',
  name: 'Dotwork',
  description: 'Reconstruye la imagen solo con puntos. Conserva los trazos de los dibujos.',
  vector: true,
  params: [
    {
      key: 'mode',
      type: 'segmented',
      label: 'Motor',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'structure', label: 'Estructura' },
        { value: 'tone', label: 'Tono' },
      ],
      hint: 'Estructura: reconstruye líneas y siluetas. Tono: stippling por sombreado (fotos).',
    },
    { key: 'dotSize', type: 'range', label: 'Tamaño de punto', min: 0.3, max: 20, step: 0.1, unit: 'px', pixels: true, group: 'Puntos' },
    { key: 'spacing', type: 'range', label: 'Separación', min: 1, max: 40, step: 0.1, unit: 'px', pixels: true, group: 'Puntos' },
    { key: 'density', type: 'range', label: 'Densidad', min: 0, max: 1, step: 0.01, group: 'Puntos', hint: 'En Estructura controla el relleno de las formas anchas.' },
    {
      key: 'sizeMode',
      type: 'segmented',
      label: 'Tamaño',
      group: 'Puntos',
      options: [
        { value: 'uniform', label: 'Uniforme' },
        { value: 'variable', label: 'Variable' },
      ],
    },
    {
      key: 'sizeVariation',
      type: 'range',
      label: 'Variación de tamaño',
      min: 0,
      max: 1,
      step: 0.01,
      group: 'Puntos',
      visibleIf: (p) => p.sizeMode === 'variable',
    },
    {
      key: 'distribution',
      type: 'segmented',
      label: 'Distribución',
      group: 'Puntos',
      options: [
        { value: 'organic', label: 'Orgánica' },
        { value: 'regular', label: 'Regular' },
      ],
    },
    { key: 'jitter', type: 'range', label: 'Irregularidad', min: 0, max: 1, step: 0.01, group: 'Puntos', visibleIf: isOrganic },
    { key: 'contrast', type: 'range', label: 'Contraste', min: -1, max: 1, step: 0.01, group: 'Lectura de la imagen' },
    { key: 'threshold', type: 'range', label: 'Umbral de tinta', min: 0.05, max: 0.95, step: 0.01, group: 'Lectura de la imagen', visibleIf: isStructure, hint: 'Qué tan oscuro debe ser un píxel para considerarse trazo.' },
    { key: 'lineWidthMax', type: 'range', label: 'Grosor máx. de línea', min: 1, max: 60, step: 0.5, unit: 'px', pixels: true, group: 'Lectura de la imagen', visibleIf: isStructure, hint: 'Trazos más gruesos se tratan como formas: contorno + relleno.' },
    { key: 'outline', type: 'toggle', label: 'Contorno en formas', group: 'Lectura de la imagen', visibleIf: isStructure },
    { key: 'smoothing', type: 'range', label: 'Suavizado de trazo', min: 0, max: 1, step: 0.01, group: 'Lectura de la imagen', visibleIf: isStructure },
    { key: 'cleanup', type: 'range', label: 'Limpieza de motas', min: 0, max: 20, step: 0.5, unit: 'px', pixels: true, group: 'Lectura de la imagen', visibleIf: isStructure },
    { key: 'color', type: 'color', label: 'Color de puntos', group: 'Color' },
    { key: 'useSourceColors', type: 'toggle', label: 'Usar colores de la imagen', group: 'Color' },
    { key: 'opacity', type: 'range', label: 'Opacidad', min: 0.05, max: 1, step: 0.01, group: 'Color' },
    { key: 'seed', type: 'seed', label: 'Variante aleatoria', group: 'Color', visibleIf: isOrganic },
  ],
  defaults: {
    mode: 'auto',
    dotSize: 2.2,
    spacing: 3.2,
    density: 0.6,
    sizeMode: 'variable',
    sizeVariation: 0.5,
    distribution: 'organic',
    jitter: 0.15,
    contrast: 0,
    threshold: 0.4,
    lineWidthMax: 8,
    outline: true,
    smoothing: 0.5,
    cleanup: 1,
    color: '#111111',
    useSourceColors: false,
    opacity: 1,
    seed: 1,
  },
  presets: [
    { id: 'fine-dots', name: 'Fine Dots', params: { dotSize: 1.4, spacing: 2.2, sizeMode: 'variable', sizeVariation: 0.4, jitter: 0.1, distribution: 'organic', density: 0.6 } },
    { id: 'dense-stippling', name: 'Dense Stippling', params: { mode: 'tone', dotSize: 1.8, spacing: 2, density: 0.85, sizeMode: 'uniform', distribution: 'organic', jitter: 0.2 } },
    { id: 'organic-dots', name: 'Organic Dots', params: { dotSize: 3, spacing: 4.5, sizeMode: 'variable', sizeVariation: 0.8, distribution: 'organic', jitter: 0.6, density: 0.45 } },
    { id: 'bold-dots', name: 'Bold Dots', params: { dotSize: 5, spacing: 7, sizeMode: 'variable', sizeVariation: 0.6, distribution: 'organic', jitter: 0.1, density: 0.5 } },
    { id: 'regular-grid', name: 'Regular Grid', params: { dotSize: 2.5, spacing: 4, sizeMode: 'uniform', distribution: 'regular', density: 0.7 } },
    { id: 'outline-only', name: 'Solo contornos', params: { mode: 'structure', density: 0, outline: true, dotSize: 2, spacing: 3, sizeMode: 'uniform' } },
  ],
  render(input: RGBAImage, raw: EffectParams, ctx: EffectContext) {
    const p = params(raw, ctx);
    const dark = darkness(input, p.contrast);
    let mode = p.mode;
    if (mode === 'auto') mode = looksLikeDrawing(dark) ? 'structure' : 'tone';
    const dots = mode === 'structure' ? renderStructure(dark, p) : renderTone(dark, p);
    const n = dots.xs.length;
    const xs = new Float32Array(dots.xs);
    const ys = new Float32Array(dots.ys);
    const rs = new Float32Array(dots.rs);
    let colors: Uint32Array | undefined;
    if (raw.useSourceColors) {
      colors = new Uint32Array(n);
      for (let i = 0; i < n; i++) colors[i] = samplePixel(input, xs[i], ys[i]);
    }
    const label = mode === 'structure' ? 'Estructura' : 'Tono';
    return {
      scene: {
        width: input.width,
        height: input.height,
        background: ctx.background,
        layers: [{ kind: 'circles', xs, ys, rs, colors, fill: raw.color as string, opacity: raw.opacity as number }],
      },
      info: `${n.toLocaleString('es-AR')} puntos · motor ${label}${p.mode === 'auto' ? ' (auto)' : ''}`,
    };
  },
};
