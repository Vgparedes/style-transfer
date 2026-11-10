import type { SourceImage } from '../state/store';

export const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
export const ACCEPT_ATTR = '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml';

/** Resolución mínima del lado mayor al rasterizar un SVG. */
const SVG_MIN_SIDE = 2400;
const SVG_MAX_SIDE = 4096;

function isSvg(file: File) {
  return file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
}

/** Tamaño intrínseco de un SVG (width/height o viewBox). */
function svgSize(text: string): { w: number; h: number } | null {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;
  const num = (v: string | null) => (v && !v.trim().endsWith('%') ? parseFloat(v) : NaN);
  let w = num(svg.getAttribute('width'));
  let h = num(svg.getAttribute('height'));
  const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4) {
    if (!(w > 0) && !(h > 0)) {
      w = vb[2];
      h = vb[3];
    } else if (!(w > 0)) w = (h * vb[2]) / vb[3];
    else if (!(h > 0)) h = (w * vb[3]) / vb[2];
  }
  if (!(w > 0) || !(h > 0)) return null;
  return { w, h };
}

async function loadSvg(file: File): Promise<SourceImage> {
  const text = await file.text();
  const size = svgSize(text) ?? { w: 1024, h: 1024 };
  // Los vectores se rasterizan a buena resolución para que el análisis de
  // trazos tenga detalle suficiente.
  const long = Math.max(size.w, size.h);
  const scale = Math.min(SVG_MAX_SIDE / long, Math.max(1, SVG_MIN_SIDE / long));
  const w = Math.round(size.w * scale);
  const h = Math.round(size.h * scale);
  // Fijamos width/height explícitos para que el navegador lo rasterice a ese tamaño.
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  const blob = new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const bitmap = await createImageBitmap(canvas);
    return { name: file.name, kind: 'svg', bitmap, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadFile(file: File): Promise<SourceImage> {
  if (isSvg(file)) return loadSvg(file);
  if (!ACCEPTED.includes(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
    throw new Error('Formato no soportado. Usá PNG, JPG, WEBP o SVG.');
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return { name: file.name, kind: 'raster', bitmap, width: bitmap.width, height: bitmap.height };
}

export async function loadUrl(url: string, name: string): Promise<SourceImage> {
  const res = await fetch(url);
  const blob = await res.blob();
  return loadFile(new File([blob], name, { type: blob.type }));
}
