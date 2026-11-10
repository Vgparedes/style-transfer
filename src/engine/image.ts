import type { RGBAImage } from './types';

/** Mapa escalar de un canal (luminancia, oscuridad, etc.), valores en [0,1]. */
export interface FloatMap {
  width: number;
  height: number;
  data: Float32Array;
}

export function createImage(width: number, height: number): RGBAImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneImage(img: RGBAImage): RGBAImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

/**
 * Luminancia en [0,1] componiendo sobre blanco: los píxeles transparentes
 * cuentan como papel. Así un PNG de líneas con fondo transparente se analiza
 * igual que un escaneo.
 */
export function luminance(img: RGBAImage): FloatMap {
  const { width, height, data } = img;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = data[p + 3] / 255;
    const l = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255;
    out[i] = l * a + (1 - a);
  }
  return { width, height, data: out };
}

/** Oscuridad (1 - luminancia), con contraste y gamma opcionales. */
export function darkness(img: RGBAImage, contrast = 0, gamma = 1): FloatMap {
  const lum = luminance(img);
  const d = lum.data;
  const c = contrastFactor(contrast);
  for (let i = 0; i < d.length; i++) {
    let v = 1 - d[i];
    v = (v - 0.5) * c + 0.5;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    if (gamma !== 1) v = Math.pow(v, gamma);
    d[i] = v;
  }
  return lum;
}

/** contrast ∈ [-1,1] → multiplicador. */
export function contrastFactor(contrast: number): number {
  return contrast >= 0 ? 1 + contrast * 4 : 1 + contrast;
}

export interface Adjustments {
  brightness: number; // -1..1
  contrast: number; // -1..1
  grayscale: boolean;
  invert: boolean;
  threshold: boolean;
  thresholdValue: number; // 0..1
}

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 0,
  grayscale: false,
  invert: false,
  threshold: false,
  thresholdValue: 0.5,
};

export function isIdentityAdjustments(a: Adjustments): boolean {
  return a.brightness === 0 && a.contrast === 0 && !a.grayscale && !a.invert && !a.threshold;
}

/** Ajustes globales previos al efecto. Devuelve una imagen nueva. */
export function applyAdjustments(src: RGBAImage, a: Adjustments): RGBAImage {
  if (isIdentityAdjustments(a)) return src;
  const out = cloneImage(src);
  const d = out.data;
  const c = contrastFactor(a.contrast);
  const b = a.brightness * 255;
  const t = a.thresholdValue * 255;
  for (let p = 0; p < d.length; p += 4) {
    let r = d[p], g = d[p + 1], bl = d[p + 2];
    if (b !== 0 || c !== 1) {
      r = (r - 128) * c + 128 + b;
      g = (g - 128) * c + 128 + b;
      bl = (bl - 128) * c + 128 + b;
    }
    if (a.grayscale || a.threshold) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      r = g = bl = l;
    }
    if (a.threshold) {
      const v = r >= t ? 255 : 0;
      r = g = bl = v;
    }
    if (a.invert) {
      r = 255 - r;
      g = 255 - g;
      bl = 255 - bl;
    }
    d[p] = r;
    d[p + 1] = g;
    d[p + 2] = bl;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Desenfoques
// ---------------------------------------------------------------------------

/** Desenfoque de caja separable, O(n) independiente del radio. */
function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + clampi(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * inv;
      acc += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[clampi(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * inv;
      acc += src[Math.min(y + r + 1, h - 1) * w + x] - src[Math.max(y - r, 0) * w + x];
    }
  }
}

/** Aproximación gaussiana con 3 pasadas de caja. sigma en px. */
export function gaussianBlur(map: FloatMap, sigma: number): FloatMap {
  const { width: w, height: h } = map;
  if (sigma < 0.3) return { width: w, height: h, data: new Float32Array(map.data) };
  const sizes = boxesForGauss(sigma, 3);
  let a = new Float32Array(map.data);
  let b = new Float32Array(a.length);
  for (const s of sizes) {
    const r = (s - 1) >> 1;
    boxBlurH(a, b, w, h, r);
    boxBlurV(b, a, w, h, r);
  }
  b = a;
  return { width: w, height: h, data: b };
}

function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

/** Tabla de áreas sumadas para promedios rectangulares en O(1). */
export class SummedArea {
  readonly w: number;
  readonly h: number;
  private readonly t: Float64Array;
  constructor(map: FloatMap) {
    const { width: w, height: h, data } = map;
    this.w = w;
    this.h = h;
    const t = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += data[y * w + x];
        t[(y + 1) * (w + 1) + x + 1] = t[y * (w + 1) + x + 1] + row;
      }
    }
    this.t = t;
  }
  /** Promedio en el rectángulo [x0,x1)×[y0,y1), recortado a la imagen. */
  mean(x0: number, y0: number, x1: number, y1: number): number {
    x0 = clampi(Math.floor(x0), 0, this.w);
    y0 = clampi(Math.floor(y0), 0, this.h);
    x1 = clampi(Math.ceil(x1), 0, this.w);
    y1 = clampi(Math.ceil(y1), 0, this.h);
    const area = (x1 - x0) * (y1 - y0);
    if (area <= 0) return 0;
    const W = this.w + 1;
    const t = this.t;
    return (t[y1 * W + x1] - t[y0 * W + x1] - t[y1 * W + x0] + t[y0 * W + x0]) / area;
  }
}

/** Muestreo bilineal de un FloatMap (fuera de rango → borde). */
export function sampleBilinear(map: FloatMap, x: number, y: number): number {
  const { width: w, height: h, data } = map;
  x = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const a = data[y0 * w + x0];
  const b = data[y0 * w + x1];
  const c = data[y1 * w + x0];
  const d = data[y1 * w + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Color RGB (0xRRGGBB) del píxel más cercano. */
export function samplePixel(img: RGBAImage, x: number, y: number): number {
  const xi = clampi(Math.round(x), 0, img.width - 1);
  const yi = clampi(Math.round(y), 0, img.height - 1);
  const p = (yi * img.width + xi) * 4;
  return (img.data[p] << 16) | (img.data[p + 1] << 8) | img.data[p + 2];
}

export function clampi(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Convierte "#rrggbb" en componentes [0..255]. */
export function parseHex(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(rgb: number): string {
  return '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');
}

/**
 * Compone una capa de "tinta" sobre el fondo a partir de un mapa de
 * cobertura (0 = papel, 1 = tinta). Si el fondo es null queda transparente.
 */
export function inkToImage(
  coverage: FloatMap,
  ink: string,
  background: string | null,
  opacity = 1,
): RGBAImage {
  const { width, height, data } = coverage;
  const out = createImage(width, height);
  const o = out.data;
  const [ir, ig, ib] = parseHex(ink);
  if (background) {
    const [br, bg, bb] = parseHex(background);
    for (let i = 0, p = 0; i < data.length; i++, p += 4) {
      const a = clamp01(data[i]) * opacity;
      o[p] = br + (ir - br) * a;
      o[p + 1] = bg + (ig - bg) * a;
      o[p + 2] = bb + (ib - bb) * a;
      o[p + 3] = 255;
    }
  } else {
    for (let i = 0, p = 0; i < data.length; i++, p += 4) {
      o[p] = ir;
      o[p + 1] = ig;
      o[p + 2] = ib;
      o[p + 3] = clamp01(data[i]) * opacity * 255;
    }
  }
  return out;
}
