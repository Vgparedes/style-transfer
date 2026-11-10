import type { SceneLayer, VectorScene } from './types';
import { toHex } from './image';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Dibuja la escena vectorial en un canvas. `scale` permite rasterizar a otra
 * resolución que la de la escena (exportación en alta resolución).
 */
export function drawScene(ctx: Ctx2D, scene: VectorScene, scale = 1, drawBackground = true): void {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (drawBackground && scene.background) {
    ctx.fillStyle = scene.background;
    ctx.fillRect(0, 0, scene.width, scene.height);
  }
  for (const layer of scene.layers) drawLayer(ctx, layer, scale);
  ctx.restore();
}

function drawLayer(ctx: Ctx2D, layer: SceneLayer, scale: number) {
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.blend === 'multiply' ? 'multiply' : 'source-over';
  switch (layer.kind) {
    case 'circles': {
      const { xs, ys, rs, colors } = layer;
      // Puntos menores a ~0,35 px de pantalla se dibujan como cuadrados: es
      // visualmente equivalente y mucho más rápido.
      const tiny = 0.35 / scale;
      if (!colors) {
        ctx.fillStyle = layer.fill;
        ctx.beginPath();
        for (let i = 0; i < xs.length; i++) {
          const r = rs[i];
          if (r < tiny) continue;
          ctx.moveTo(xs[i] + r, ys[i]);
          ctx.arc(xs[i], ys[i], r, 0, Math.PI * 2);
        }
        ctx.fill();
        for (let i = 0; i < xs.length; i++) {
          const r = rs[i];
          if (r >= tiny) continue;
          ctx.fillRect(xs[i] - r, ys[i] - r, 2 * r, 2 * r);
        }
      } else {
        // Agrupa por color para minimizar cambios de estado.
        const groups = groupByColor(colors);
        for (const [c, idx] of groups) {
          ctx.fillStyle = toHex(c);
          ctx.beginPath();
          for (const i of idx) {
            const r = rs[i];
            ctx.moveTo(xs[i] + r, ys[i]);
            ctx.arc(xs[i], ys[i], r, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      }
      break;
    }
    case 'squares': {
      const { xs, ys, sizes, angle, colors } = layer;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const path = (i: number) => {
        const h = sizes[i] / 2;
        const ax = h * cos, ay = h * sin;
        const bx = -h * sin, by = h * cos;
        const x = xs[i], y = ys[i];
        ctx.moveTo(x - ax - bx, y - ay - by);
        ctx.lineTo(x + ax - bx, y + ay - by);
        ctx.lineTo(x + ax + bx, y + ay + by);
        ctx.lineTo(x - ax + bx, y - ay + by);
        ctx.closePath();
      };
      if (!colors) {
        ctx.fillStyle = layer.fill;
        ctx.beginPath();
        for (let i = 0; i < xs.length; i++) path(i);
        ctx.fill();
      } else {
        for (const [c, idx] of groupByColor(colors)) {
          ctx.fillStyle = toHex(c);
          ctx.beginPath();
          for (const i of idx) path(i);
          ctx.fill();
        }
      }
      break;
    }
    case 'polylines': {
      ctx.strokeStyle = layer.stroke;
      ctx.lineWidth = layer.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      forEachPath(layer.points, layer.offsets, (s, e, k) => {
        const p = layer.points;
        ctx.moveTo(p[2 * s], p[2 * s + 1]);
        for (let i = s + 1; i < e; i++) ctx.lineTo(p[2 * i], p[2 * i + 1]);
        if (e - s === 1) ctx.lineTo(p[2 * s] + 0.01, p[2 * s + 1]);
        if (layer.closed?.[k]) ctx.closePath();
      });
      ctx.stroke();
      break;
    }
    case 'polygons': {
      const p = layer.points;
      const fillPath = (s: number, e: number) => {
        ctx.moveTo(p[2 * s], p[2 * s + 1]);
        for (let i = s + 1; i < e; i++) ctx.lineTo(p[2 * i], p[2 * i + 1]);
        ctx.closePath();
      };
      if (!layer.colors) {
        ctx.fillStyle = layer.fill;
        ctx.beginPath();
        forEachPath(p, layer.offsets, fillPath);
        ctx.fill();
      } else {
        const colors = layer.colors;
        forEachPath(p, layer.offsets, (s, e, k) => {
          ctx.fillStyle = toHex(colors[k]);
          ctx.beginPath();
          fillPath(s, e);
          ctx.fill();
        });
      }
      break;
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function forEachPath(points: Float32Array, offsets: Uint32Array, fn: (s: number, e: number, k: number) => void) {
  const total = points.length / 2;
  for (let k = 0; k < offsets.length; k++) {
    const s = offsets[k];
    const e = k + 1 < offsets.length ? offsets[k + 1] : total;
    if (e > s) fn(s, e, k);
  }
}

function groupByColor(colors: Uint32Array): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (let i = 0; i < colors.length; i++) {
    let arr = m.get(colors[i]);
    if (!arr) m.set(colors[i], (arr = []));
    arr.push(i);
  }
  return m;
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

const f = (v: number) => {
  // 2 decimales alcanzan y reducen mucho el tamaño del archivo.
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, '');
};

/**
 * Serializa la escena como SVG. `outWidth/outHeight` fijan el tamaño
 * declarado; el viewBox conserva las coordenadas de la escena, así que el
 * resultado escala sin pérdida.
 */
export function sceneToSVG(scene: VectorScene, outWidth = scene.width, outHeight = scene.height): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(outWidth)}" height="${f(outHeight)}" viewBox="0 0 ${f(scene.width)} ${f(scene.height)}">`,
  );
  if (scene.background) {
    parts.push(`<rect width="100%" height="100%" fill="${scene.background}"/>`);
  }
  for (const layer of scene.layers) parts.push(layerToSVG(layer));
  parts.push('</svg>');
  return parts.join('\n');
}

function groupAttrs(layer: SceneLayer, extra = ''): string {
  let a = extra;
  if (layer.opacity < 1) a += ` opacity="${f(layer.opacity)}"`;
  if (layer.blend === 'multiply') a += ` style="mix-blend-mode:multiply"`;
  return a;
}

function layerToSVG(layer: SceneLayer): string {
  const out: string[] = [];
  switch (layer.kind) {
    case 'circles': {
      const { xs, ys, rs, colors } = layer;
      if (!colors) {
        out.push(`<g${groupAttrs(layer, ` fill="${layer.fill}"`)}>`);
        for (let i = 0; i < xs.length; i++) {
          out.push(`<circle cx="${f(xs[i])}" cy="${f(ys[i])}" r="${f(rs[i])}"/>`);
        }
      } else {
        out.push(`<g${groupAttrs(layer)}>`);
        for (const [c, idx] of groupByColor(colors)) {
          out.push(`<g fill="${toHex(c)}">`);
          for (const i of idx) out.push(`<circle cx="${f(xs[i])}" cy="${f(ys[i])}" r="${f(rs[i])}"/>`);
          out.push('</g>');
        }
      }
      out.push('</g>');
      break;
    }
    case 'squares': {
      const { xs, ys, sizes, angle, colors } = layer;
      const deg = (angle * 180) / Math.PI;
      const rect = (i: number) => {
        const s = sizes[i];
        const rot = deg ? ` transform="rotate(${f(deg)} ${f(xs[i])} ${f(ys[i])})"` : '';
        return `<rect x="${f(xs[i] - s / 2)}" y="${f(ys[i] - s / 2)}" width="${f(s)}" height="${f(s)}"${rot}/>`;
      };
      if (!colors) {
        out.push(`<g${groupAttrs(layer, ` fill="${layer.fill}"`)}>`);
        for (let i = 0; i < xs.length; i++) out.push(rect(i));
      } else {
        out.push(`<g${groupAttrs(layer)}>`);
        for (const [c, idx] of groupByColor(colors)) {
          out.push(`<g fill="${toHex(c)}">`);
          for (const i of idx) out.push(rect(i));
          out.push('</g>');
        }
      }
      out.push('</g>');
      break;
    }
    case 'polylines': {
      out.push(
        `<g${groupAttrs(layer, ` fill="none" stroke="${layer.stroke}" stroke-width="${f(layer.width)}" stroke-linecap="round" stroke-linejoin="round"`)}>`,
      );
      const p = layer.points;
      forEachPath(p, layer.offsets, (s, e, k) => {
        let d = `M${f(p[2 * s])} ${f(p[2 * s + 1])}`;
        for (let i = s + 1; i < e; i++) d += `L${f(p[2 * i])} ${f(p[2 * i + 1])}`;
        if (e - s === 1) d += 'h0.01';
        if (layer.closed?.[k]) d += 'Z';
        out.push(`<path d="${d}"/>`);
      });
      out.push('</g>');
      break;
    }
    case 'polygons': {
      const p = layer.points;
      const pathD = (s: number, e: number) => {
        let d = `M${f(p[2 * s])} ${f(p[2 * s + 1])}`;
        for (let i = s + 1; i < e; i++) d += `L${f(p[2 * i])} ${f(p[2 * i + 1])}`;
        return d + 'Z';
      };
      if (!layer.colors) {
        // Un único path con todos los subcaminos: archivo más liviano.
        out.push(`<g${groupAttrs(layer, ` fill="${layer.fill}"`)}>`);
        const ds: string[] = [];
        forEachPath(p, layer.offsets, (s, e) => ds.push(pathD(s, e)));
        for (let i = 0; i < ds.length; i += 500) out.push(`<path d="${ds.slice(i, i + 500).join('')}"/>`);
      } else {
        out.push(`<g${groupAttrs(layer)}>`);
        const colors = layer.colors;
        forEachPath(p, layer.offsets, (s, e, k) => out.push(`<path fill="${toHex(colors[k])}" d="${pathD(s, e)}"/>`));
      }
      out.push('</g>');
      break;
    }
  }
  return out.join('\n');
}

/** Cuenta primitivas de la escena (para la barra de estado). */
export function sceneStats(scene: VectorScene): number {
  let n = 0;
  for (const l of scene.layers) {
    if (l.kind === 'circles' || l.kind === 'squares') n += l.xs.length;
    else n += l.offsets.length;
  }
  return n;
}

/** Helper para construir capas de polilíneas/polígonos. */
export class PathBuilder {
  private pts: number[] = [];
  private offs: number[] = [];
  private closedFlags: number[] = [];
  private cols: number[] = [];
  add(points: ArrayLike<number>, closed = false, color?: number) {
    if (points.length < 2) return;
    this.offs.push(this.pts.length / 2);
    for (let i = 0; i < points.length; i++) this.pts.push(points[i]);
    this.closedFlags.push(closed ? 1 : 0);
    if (color !== undefined) this.cols.push(color);
  }
  get size() {
    return this.offs.length;
  }
  build() {
    return {
      points: new Float32Array(this.pts),
      offsets: new Uint32Array(this.offs),
      closed: new Uint8Array(this.closedFlags),
      colors: this.cols.length === this.offs.length && this.cols.length ? new Uint32Array(this.cols) : undefined,
    };
  }
}
