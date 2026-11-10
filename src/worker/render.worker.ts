/// <reference lib="webworker" />
/**
 * Worker de procesamiento: geometría → ajustes → efecto → rasterizado.
 * Todo el trabajo pesado ocurre aquí para que la interfaz no se congele.
 */
import { EFFECTS_BY_ID } from '../effects';
import { applyAdjustments } from '../engine/image';
import { drawTransformed, outputSize } from '../engine/geometry';
import { drawScene, sceneToSVG } from '../engine/scene';
import type { EffectResult, RGBAImage } from '../engine/types';
import type { RenderRecipe, WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let source: { id: number; bitmap: ImageBitmap } | null = null;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

/** Lado máximo de procesamiento para exportar SVG (las coordenadas escalan sin pérdida). */
const SVG_PROCESS_MAX = 4000;
const RASTER_EXPORT_MAX = 12000;

function prepare(recipe: RenderRecipe, k: number) {
  const bmp = source!.bitmap;
  const out = outputSize(bmp.width, bmp.height, recipe.transform);
  const w = Math.max(1, Math.round(out.w * k));
  const h = Math.max(1, Math.round(out.h * k));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  drawTransformed(ctx, bmp, recipe.transform, w / out.w);
  const id = ctx.getImageData(0, 0, w, h);
  const original: RGBAImage = { width: w, height: h, data: id.data };
  return { canvas, original, w, h, out };
}

function runEffect(recipe: RenderRecipe, original: RGBAImage, k: number): EffectResult {
  const effect = EFFECTS_BY_ID[recipe.effectId] ?? EFFECTS_BY_ID.none;
  const input = applyAdjustments(original, recipe.adjustments);
  const params = { ...effect.defaults, ...recipe.params };
  return effect.render(input, params, { scale: k, background: recipe.background, original });
}

function rasterize(res: EffectResult, w: number, h: number, sceneScale = 1): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  if (res.scene) {
    drawScene(ctx, res.scene, sceneScale);
  } else if (res.raster) {
    const img = new ImageData(new Uint8ClampedArray(res.raster.data), res.raster.width, res.raster.height);
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'source') {
    source?.bitmap.close();
    source = { id: msg.sourceId, bitmap: msg.bitmap };
    return;
  }
  const t0 = performance.now();
  try {
    if (!source || source.id !== msg.sourceId) throw new Error('Imagen no disponible');
    const bmp = source.bitmap;
    const out = outputSize(bmp.width, bmp.height, msg.recipe.transform);

    if (msg.type === 'render') {
      const k = Math.min(1, msg.maxSide / Math.max(out.w, out.h));
      const prep = prepare(msg.recipe, k);
      const res = runEffect(msg.recipe, prep.original, prep.w / out.w);
      const canvas = rasterize(res, prep.w, prep.h);
      const bitmap = canvas.transferToImageBitmap();
      const transfer: Transferable[] = [bitmap];
      let original: ImageBitmap | undefined;
      if (msg.wantOriginal) {
        original = prep.canvas.transferToImageBitmap();
        transfer.push(original);
      }
      post({ type: 'rendered', jobId: msg.jobId, bitmap, original, k: prep.w / out.w, info: res.info, ms: performance.now() - t0 }, transfer);
      return;
    }

    if (msg.type === 'export') {
      const { format, width, height } = msg;
      if (format === 'svg') {
        const k = Math.min(1, SVG_PROCESS_MAX / Math.max(out.w, out.h));
        const prep = prepare(msg.recipe, k);
        const res = runEffect(msg.recipe, prep.original, prep.w / out.w);
        if (!res.scene) throw new Error('Este efecto no tiene representación vectorial');
        const svg = sceneToSVG(res.scene, width, height);
        post({ type: 'exported', jobId: msg.jobId, blob: new Blob([svg], { type: 'image/svg+xml' }), info: res.info, ms: performance.now() - t0 });
        return;
      }
      const k = width / out.w;
      if (Math.max(width, height) > RASTER_EXPORT_MAX) throw new Error(`El tamaño máximo es ${RASTER_EXPORT_MAX}px por lado`);
      const prep = prepare(msg.recipe, k);
      const res = runEffect(msg.recipe, prep.original, prep.w / out.w);
      let canvas = rasterize(res, prep.w, prep.h);
      if (format === 'jpg' && !msg.recipe.background) {
        // JPG no admite transparencia: se compone sobre blanco.
        const c2 = new OffscreenCanvas(prep.w, prep.h);
        const cx = c2.getContext('2d')!;
        cx.fillStyle = '#ffffff';
        cx.fillRect(0, 0, prep.w, prep.h);
        cx.drawImage(canvas, 0, 0);
        canvas = c2;
      }
      const type = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      const blob = await canvas.convertToBlob({ type, quality: msg.quality });
      post({ type: 'exported', jobId: msg.jobId, blob, info: res.info, ms: performance.now() - t0 });
    }
  } catch (e) {
    post({ type: 'error', jobId: msg.jobId, message: e instanceof Error ? e.message : String(e) });
  }
};
