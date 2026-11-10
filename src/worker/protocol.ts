import type { Adjustments } from '../engine/image';
import type { Transform } from '../engine/geometry';
import type { EffectParams } from '../engine/types';

/** Receta completa para renderizar: todo lo que define el resultado. */
export interface RenderRecipe {
  effectId: string;
  params: EffectParams;
  adjustments: Adjustments;
  transform: Transform;
  /** Color de fondo CSS o null (transparente). */
  background: string | null;
}

export type ExportFormat = 'png' | 'jpg' | 'webp' | 'svg';

export type WorkerRequest =
  | { type: 'source'; sourceId: number; bitmap: ImageBitmap }
  | {
      type: 'render';
      jobId: number;
      sourceId: number;
      recipe: RenderRecipe;
      /** Lado mayor máximo de la vista previa en px. */
      maxSide: number;
      /** Enviar también la imagen original transformada (para comparar). */
      wantOriginal: boolean;
    }
  | {
      type: 'export';
      jobId: number;
      sourceId: number;
      recipe: RenderRecipe;
      format: ExportFormat;
      /** Tamaño final en px. */
      width: number;
      height: number;
      quality: number;
    };

export type WorkerResponse =
  | {
      type: 'rendered';
      jobId: number;
      bitmap: ImageBitmap;
      original?: ImageBitmap;
      /** Factor entre la vista previa y el tamaño de salida. */
      k: number;
      info?: string;
      ms: number;
    }
  | { type: 'exported'; jobId: number; blob: Blob; info?: string; ms: number }
  | { type: 'error'; jobId: number; message: string };
