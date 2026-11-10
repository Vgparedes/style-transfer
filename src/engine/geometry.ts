/**
 * Transformaciones geométricas no destructivas. La imagen fuente nunca se
 * modifica: el documento guarda solo la receta (rotación, volteo, recorte,
 * escala) y cada render la aplica desde el original.
 */

export interface CropRect {
  /** Normalizado (0..1) respecto del marco rotado. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Transform {
  /** Rotación en pasos de 90°. */
  rotation: 0 | 90 | 180 | 270;
  /** Rotación fina en grados (enderezar). */
  angle: number;
  flipH: boolean;
  flipV: boolean;
  crop: CropRect | null;
  /** Escala de salida (1 = tamaño original). */
  scale: number;
}

export const DEFAULT_TRANSFORM: Transform = { rotation: 0, angle: 0, flipH: false, flipV: false, crop: null, scale: 1 };

/** Tamaño del marco rotado (caja envolvente) antes del recorte. */
export function rotatedFrame(sw: number, sh: number, t: Transform): { w: number; h: number; rad: number } {
  const rad = ((t.rotation + t.angle) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
  // Redondeo para evitar 1 px extra por error numérico en rotaciones de 90°.
  const w = Math.round((sw * c + sh * s) * 1000) / 1000;
  const h = Math.round((sw * s + sh * c) * 1000) / 1000;
  return { w, h, rad };
}

/** Tamaño final de salida (después de recorte y escala), en px. */
export function outputSize(sw: number, sh: number, t: Transform): { w: number; h: number } {
  const f = rotatedFrame(sw, sh, t);
  const c = t.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  return {
    w: Math.max(1, Math.round(f.w * c.w * t.scale)),
    h: Math.max(1, Math.round(f.h * c.h * t.scale)),
  };
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Dibuja la fuente transformada. `k` es el factor sobre el tamaño de salida
 * (k=1 → tamaño de salida exacto). Si `ignoreCrop`, dibuja el marco rotado
 * completo (usado por la herramienta de recorte).
 */
export function drawTransformed(
  ctx: Ctx2D,
  src: CanvasImageSource & { width: number; height: number },
  t: Transform,
  k: number,
  ignoreCrop = false,
): void {
  const sw = src.width, sh = src.height;
  const f = rotatedFrame(sw, sh, t);
  const c = ignoreCrop || !t.crop ? { x: 0, y: 0, w: 1, h: 1 } : t.crop;
  const s = t.scale * k;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(s, s);
  ctx.translate(-c.x * f.w, -c.y * f.h);
  ctx.translate(f.w / 2, f.h / 2);
  ctx.rotate(f.rad);
  ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
  ctx.drawImage(src, -sw / 2, -sh / 2);
  ctx.restore();
}
