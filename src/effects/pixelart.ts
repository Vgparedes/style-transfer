import type { EffectDefinition, SceneLayer } from '../engine/types';
import { createImage, parseHex, toHex } from '../engine/image';
import { medianCut, nearest, type RGB } from '../engine/quantize';

/**
 * PIXEL ART
 * Reduce la imagen a una grilla de bloques (promedio por área), cuantiza a
 * una paleta (automática por median cut + k-means, o predefinida) y aplica
 * dithering opcional (Bayer ordenado o Floyd–Steinberg).
 */

const hexes = (s: string) => s.split(' ').map((h) => parseHex(h) as RGB);

const PALETTES: Record<string, RGB[]> = {
  bw: hexes('#000000 #ffffff'),
  gray4: hexes('#111111 #555555 #aaaaaa #f2f2f2'),
  green4: hexes('#0f380f #306230 #8bac0f #9bbc0f'),
  retro16: hexes(
    '#000000 #1d2b53 #7e2553 #008751 #ab5236 #5f574f #c2c3c7 #fff1e8 #ff004d #ffa300 #ffec27 #00e436 #29adff #83769c #ff77a8 #ffccaa',
  ),
  sepia: hexes('#2b1d0e #5c3d1e #8f6a3e #c9a66b #f3e3c3'),
  pastel: hexes('#2e2a36 #6c5a7c #c58fa8 #f2b5a0 #f9e2ae #a8d8c9 #7fb2d6 #fdf8f0'),
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const pixelart: EffectDefinition = {
  id: 'pixelart',
  name: 'Pixel Art',
  description: 'Gráficos pixelados con paleta limitada y dithering.',
  vector: false,
  svgExport: true,
  params: [
    { key: 'pixelSize', type: 'range', label: 'Tamaño del píxel', min: 2, max: 64, step: 1, unit: 'px', pixels: true },
    {
      key: 'palette',
      type: 'select',
      label: 'Paleta',
      options: [
        { value: 'auto', label: 'Automática (de la imagen)' },
        { value: 'retro16', label: 'Retro 16 colores' },
        { value: 'green4', label: 'Consola portátil (4 verdes)' },
        { value: 'gray4', label: 'Grises (4)' },
        { value: 'bw', label: '1-bit (blanco y negro)' },
        { value: 'sepia', label: 'Sepia' },
        { value: 'pastel', label: 'Pastel' },
      ],
    },
    { key: 'colors', type: 'range', label: 'Cantidad de colores', min: 2, max: 64, step: 1, visibleIf: (p) => p.palette === 'auto' },
    {
      key: 'dither',
      type: 'segmented',
      label: 'Dithering',
      options: [
        { value: 'none', label: 'No' },
        { value: 'bayer', label: 'Ordenado' },
        { value: 'fs', label: 'Difusión' },
      ],
    },
    { key: 'ditherStrength', type: 'range', label: 'Intensidad del dithering', min: 0, max: 1, step: 0.01, visibleIf: (p) => p.dither !== 'none' },
    { key: 'removeBg', type: 'toggle', label: 'Reemplazar fondo de la imagen', group: 'Fondo de la imagen', hint: 'Detecta el fondo liso de la imagen (p. ej. blanco) y lo reemplaza por el color de fondo elegido o por transparencia.' },
    {
      key: 'bgScope',
      type: 'segmented',
      label: 'Zonas a reemplazar',
      group: 'Fondo de la imagen',
      visibleIf: (p) => !!p.removeBg,
      options: [
        { value: 'connected', label: 'Desde el borde' },
        { value: 'all', label: 'Todas' },
      ],
      hint: 'Todas: también los huecos encerrados del mismo color (útil en dibujos).',
    },
    { key: 'bgTolerance', type: 'range', label: 'Tolerancia del fondo', min: 0.05, max: 1, step: 0.01, group: 'Fondo de la imagen', visibleIf: (p) => !!p.removeBg },
  ],
  defaults: { pixelSize: 8, palette: 'auto', colors: 16, dither: 'bayer', ditherStrength: 0.5, removeBg: true, bgScope: 'connected', bgTolerance: 0.3 },
  presets: [
    { id: '8bit', name: '8 bits', params: { pixelSize: 8, palette: 'retro16', dither: 'bayer', ditherStrength: 0.4 } },
    { id: 'handheld', name: 'Portátil', params: { pixelSize: 6, palette: 'green4', dither: 'bayer', ditherStrength: 0.6 } },
    { id: '1bit', name: '1-bit', params: { pixelSize: 4, palette: 'bw', dither: 'fs', ditherStrength: 0.9 } },
    { id: 'chunky', name: 'Bloques', params: { pixelSize: 20, palette: 'auto', colors: 8, dither: 'none' } },
  ],
  render(input, p, ctx) {
    const { width: w, height: h, data } = input;
    const ps = Math.max(1, Math.round((p.pixelSize as number) * ctx.scale));
    const gw = Math.ceil(w / ps), gh = Math.ceil(h / ps);
    // 1) Promedio por bloque (con alfa).
    const cells = new Float32Array(gw * gh * 3);
    const alpha = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let y = gy * ps; y < Math.min(h, (gy + 1) * ps); y++) {
          for (let x = gx * ps; x < Math.min(w, (gx + 1) * ps); x++) {
            const k = (y * w + x) * 4;
            const al = data[k + 3] / 255;
            r += data[k] * al;
            g += data[k + 1] * al;
            b += data[k + 2] * al;
            a += al;
            n++;
          }
        }
        const c = gy * gw + gx;
        const inv = a > 0 ? 1 / a : 0;
        cells[c * 3] = r * inv;
        cells[c * 3 + 1] = g * inv;
        cells[c * 3 + 2] = b * inv;
        alpha[c] = n ? a / n : 0;
      }
    }
    // 1b) Fondo de la imagen: en imágenes opacas (foto sobre papel blanco,
    //     etc.) el fondo es un color más. Se detecta el color dominante del
    //     borde y se marca como transparente la zona conectada a él, así el
    //     color de fondo elegido (o la transparencia) se aplica también acá.
    if (p.removeBg) removeBackground(cells, alpha, gw, gh, (p.bgTolerance as number) * 120, p.bgScope === 'all');
    // 2) Paleta.
    let pal: RGB[];
    if (p.palette === 'auto') {
      // Muestra hasta ~40k celdas para estimar la paleta.
      const stride = Math.max(1, Math.floor((gw * gh) / 40000));
      const sample: number[] = [];
      for (let c = 0; c < gw * gh; c += stride) if (alpha[c] > 0.5) sample.push(cells[c * 3], cells[c * 3 + 1], cells[c * 3 + 2]);
      pal = sample.length ? medianCut(new Float32Array(sample), sample.length / 3, p.colors as number) : [[0, 0, 0]];
    } else {
      pal = PALETTES[p.palette as string] ?? PALETTES.bw;
    }
    // 3) Cuantización + dithering.
    const strength = p.dither === 'none' ? 0 : (p.ditherStrength as number);
    const spread = 255 / Math.max(2, Math.cbrt(pal.length) * 1.4);
    const idx = new Uint16Array(gw * gh);
    const work = new Float32Array(cells);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const c = gy * gw + gx;
        let r = work[c * 3], g = work[c * 3 + 1], b = work[c * 3 + 2];
        if (p.dither === 'bayer' && strength > 0) {
          const t = ((BAYER[(gy & 3) * 4 + (gx & 3)] + 0.5) / 16 - 0.5) * spread * strength * 1.6;
          r += t;
          g += t;
          b += t;
        }
        const j = nearest(pal, r, g, b);
        idx[c] = j;
        if (p.dither === 'fs' && strength > 0) {
          const er = (r - pal[j][0]) * strength, eg = (g - pal[j][1]) * strength, eb = (b - pal[j][2]) * strength;
          const push = (x: number, y: number, f: number) => {
            if (x < 0 || x >= gw || y >= gh) return;
            const k = (y * gw + x) * 3;
            work[k] += er * f;
            work[k + 1] += eg * f;
            work[k + 2] += eb * f;
          };
          push(gx + 1, gy, 7 / 16);
          push(gx - 1, gy + 1, 3 / 16);
          push(gx, gy + 1, 5 / 16);
          push(gx + 1, gy + 1, 1 / 16);
        }
      }
    }
    // 4) Escalado a bloques nítidos.
    const out = createImage(w, h);
    const o = out.data;
    const bg = ctx.background ? parseHex(ctx.background) : null;
    for (let y = 0; y < h; y++) {
      const gy = (y / ps) | 0;
      for (let x = 0; x < w; x++) {
        const c = gy * gw + ((x / ps) | 0);
        const col = pal[idx[c]];
        const a = alpha[c] > 0.5 ? 1 : 0;
        const k = (y * w + x) * 4;
        if (a || !bg) {
          o[k] = col[0];
          o[k + 1] = col[1];
          o[k + 2] = col[2];
          o[k + 3] = a * 255;
        } else {
          o[k] = bg[0];
          o[k + 1] = bg[1];
          o[k + 2] = bg[2];
          o[k + 3] = 255;
        }
      }
    }
    const info = `${gw}×${gh} píxeles · ${pal.length} colores`;
    if (!ctx.wantVector) return { raster: out, info };

    // SVG: tiras horizontales de bloques del mismo color, agrupadas por
    // color de la paleta (un <path> por color → archivo liviano). Se solapan
    // un poco para que los visores no muestren líneas finas entre bloques.
    const ov = Math.min(0.5, ps * 0.04);
    const byColor: number[][] = pal.map(() => []);
    for (let gy = 0; gy < gh; gy++) {
      let gx = 0;
      while (gx < gw) {
        const c = gy * gw + gx;
        if (alpha[c] <= 0.5) {
          gx++;
          continue;
        }
        const j = idx[c];
        let end = gx + 1;
        while (end < gw && alpha[gy * gw + end] > 0.5 && idx[gy * gw + end] === j) end++;
        const x0 = gx * ps, y0 = gy * ps;
        const x1 = Math.min(w, end * ps + (end < gw ? ov : 0));
        const y1 = Math.min(h, (gy + 1) * ps + (gy + 1 < gh ? ov : 0));
        byColor[j].push(x0, y0, x1, y0, x1, y1, x0, y1);
        gx = end;
      }
    }
    const layers: SceneLayer[] = [];
    pal.forEach((col, j) => {
      const flat = byColor[j];
      if (!flat.length) return;
      const n = flat.length / 8;
      const offsets = new Uint32Array(n);
      for (let k = 0; k < n; k++) offsets[k] = k * 4;
      layers.push({ kind: 'polygons', points: new Float32Array(flat), offsets, fill: toHex((col[0] << 16) | (col[1] << 8) | col[2]), opacity: 1 });
    });
    return { raster: out, scene: { width: w, height: h, background: ctx.background, layers }, info };
  },
};

/**
 * Marca como transparentes (alpha = 0) las celdas del fondo: el color más
 * frecuente del borde, y solo la zona conectada al borde (un blanco en el
 * interior del motivo se conserva). Si el borde no tiene un color dominante
 * (foto sin fondo liso), no hace nada.
 */
function removeBackground(cells: Float32Array, alpha: Float32Array, gw: number, gh: number, tol: number, everywhere: boolean) {
  const border: number[] = [];
  for (let x = 0; x < gw; x++) border.push(x, (gh - 1) * gw + x);
  for (let y = 1; y < gh - 1; y++) border.push(y * gw, y * gw + gw - 1);
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (const c of border) {
    if (alpha[c] <= 0.5) continue;
    const r = cells[c * 3], g = cells[c * 3 + 1], b = cells[c * 3 + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(key, e);
    total++;
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  if (!best || best.n < total * 0.3) return;
  const br = best.r / best.n, bg = best.g / best.n, bb = best.b / best.n;
  const tol2 = tol * tol;
  const isBg = (c: number) => {
    if (alpha[c] <= 0.5) return true;
    const dr = cells[c * 3] - br, dg = cells[c * 3 + 1] - bg, db = cells[c * 3 + 2] - bb;
    return dr * dr + dg * dg + db * db <= tol2;
  };
  if (everywhere) {
    for (let c = 0; c < gw * gh; c++) if (isBg(c)) alpha[c] = 0;
    return;
  }
  const seen = new Uint8Array(gw * gh);
  const stack: number[] = [];
  for (const c of border) if (!seen[c] && isBg(c)) { seen[c] = 1; stack.push(c); }
  while (stack.length) {
    const c = stack.pop()!;
    alpha[c] = 0;
    const x = c % gw, y = (c / gw) | 0;
    const nb = [x > 0 ? c - 1 : -1, x < gw - 1 ? c + 1 : -1, y > 0 ? c - gw : -1, y < gh - 1 ? c + gw : -1];
    for (const d of nb) if (d >= 0 && !seen[d] && isBg(d)) { seen[d] = 1; stack.push(d); }
  }
}
