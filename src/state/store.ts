import { create } from 'zustand';
import { EFFECTS_BY_ID } from '../effects';
import { DEFAULT_ADJUSTMENTS, type Adjustments } from '../engine/image';
import { DEFAULT_TRANSFORM, type Transform } from '../engine/geometry';
import type { EffectParams, Preset } from '../engine/types';
import type { RenderRecipe } from '../worker/protocol';

/**
 * El "documento" es la receta no destructiva: qué efecto, con qué
 * parámetros, qué ajustes y qué geometría. La imagen fuente nunca cambia.
 * Deshacer/rehacer = moverse entre snapshots inmutables del documento.
 */
export interface Doc {
  effectId: string;
  /** Parámetros por efecto: cambiar de estilo no pierde lo configurado. */
  params: Record<string, EffectParams>;
  adjustments: Adjustments;
  transform: Transform;
  background: { transparent: boolean; color: string };
}

export interface SourceImage {
  name: string;
  kind: 'raster' | 'svg';
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export type CompareMode = 'result' | 'split' | 'side';
export type PreviewQuality = 'fast' | 'normal' | 'high';
export const QUALITY_MAX_SIDE: Record<PreviewQuality, number> = { fast: 1000, normal: 1800, high: 3000 };

export interface PreviewState {
  bitmap: ImageBitmap;
  original: ImageBitmap | null;
  k: number;
  info?: string;
  ms: number;
}

export function defaultDoc(effectId = 'dotwork'): Doc {
  return {
    effectId,
    params: {},
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    transform: { ...DEFAULT_TRANSFORM },
    background: { transparent: false, color: '#ffffff' },
  };
}

export function effectParams(doc: Doc, effectId = doc.effectId): EffectParams {
  const e = EFFECTS_BY_ID[effectId];
  return { ...(e?.defaults ?? {}), ...(doc.params[effectId] ?? {}) };
}

export function recipeOf(doc: Doc): RenderRecipe {
  return {
    effectId: doc.effectId,
    params: effectParams(doc),
    adjustments: doc.adjustments,
    transform: doc.transform,
    background: doc.background.transparent ? null : doc.background.color,
  };
}

const HISTORY_LIMIT = 200;
const COALESCE_MS = 900;
const PRESETS_KEY = 'stylo.customPresets.v1';

function loadPresets(): Record<string, Preset[]> {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}');
  } catch {
    return {};
  }
}
function savePresets(p: Record<string, Preset[]>) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(p));
  } catch {
    /* almacenamiento no disponible */
  }
}

interface Store {
  source: SourceImage | null;
  doc: Doc;
  past: Doc[];
  future: Doc[];
  lastKey: string | null;
  lastTime: number;

  preview: PreviewState | null;
  busy: boolean;
  error: string | null;

  compare: CompareMode;
  split: number;
  quality: PreviewQuality;
  holdOriginal: boolean;
  tool: 'none' | 'crop';
  exportOpen: boolean;
  customPresets: Record<string, Preset[]>;

  setSource(src: SourceImage): void;
  /**
   * Modifica el documento. Cambios consecutivos con la misma `key` en menos
   * de COALESCE_MS se agrupan en un solo paso de historial (p. ej. arrastrar
   * un slider).
   */
  update(key: string, fn: (d: Doc) => Doc): void;
  setParam(name: string, value: EffectParams[string]): void;
  applyPreset(preset: Preset): void;
  resetEffect(): void;
  resetAll(): void;
  undo(): void;
  redo(): void;
  setPreview(p: PreviewState): void;
  set(partial: Partial<Store>): void;
  saveCustomPreset(name: string): void;
  deleteCustomPreset(id: string): void;
}

export const useStore = create<Store>((set, get) => ({
  source: null,
  doc: defaultDoc(),
  past: [],
  future: [],
  lastKey: null,
  lastTime: 0,
  preview: null,
  busy: false,
  error: null,
  compare: 'result',
  split: 0.5,
  quality: 'normal',
  holdOriginal: false,
  tool: 'none',
  exportOpen: false,
  customPresets: loadPresets(),

  setSource(src) {
    const prev = get().source;
    if (prev && prev.bitmap !== src.bitmap) prev.bitmap.close();
    const old = get().preview;
    old?.bitmap.close();
    old?.original?.close();
    // Nueva imagen: geometría y ajustes vuelven a cero; el estilo elegido se mantiene.
    const doc = get().doc;
    set({
      source: src,
      doc: { ...doc, transform: { ...DEFAULT_TRANSFORM }, adjustments: { ...DEFAULT_ADJUSTMENTS } },
      past: [],
      future: [],
      lastKey: null,
      preview: null,
      error: null,
      tool: 'none',
    });
  },

  update(key, fn) {
    const { doc, past, lastKey, lastTime } = get();
    const next = fn(doc);
    if (next === doc) return;
    const now = performance.now();
    const coalesce = key === lastKey && now - lastTime < COALESCE_MS;
    set({
      doc: next,
      past: coalesce ? past : [...past, doc].slice(-HISTORY_LIMIT),
      future: [],
      lastKey: key,
      lastTime: now,
    });
  },

  setParam(name, value) {
    const id = get().doc.effectId;
    get().update(`param:${id}:${name}`, (d) => ({
      ...d,
      params: { ...d.params, [id]: { ...effectParams(d, id), [name]: value } },
    }));
  },

  applyPreset(preset) {
    const id = get().doc.effectId;
    const defaults = EFFECTS_BY_ID[id]?.defaults ?? {};
    // Un preset parte de los valores por defecto (más el color elegido por
    // el usuario, que suele querer conservarse) y luego es editable.
    const current = effectParams(get().doc, id);
    const keep: EffectParams = {};
    for (const k of ['color', 'opacity'] as const) if (k in current && !(k in preset.params)) keep[k] = current[k];
    get().update(`preset:${id}:${preset.id}:${performance.now()}`, (d) => ({
      ...d,
      params: { ...d.params, [id]: { ...defaults, ...keep, ...preset.params } },
    }));
  },

  resetEffect() {
    const id = get().doc.effectId;
    get().update(`reset:${performance.now()}`, (d) => {
      const params = { ...d.params };
      delete params[id];
      return { ...d, params };
    });
  },

  resetAll() {
    get().update(`resetAll:${performance.now()}`, (d) => ({ ...defaultDoc(d.effectId) }));
  },

  undo() {
    const { past, doc, future } = get();
    if (!past.length) return;
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], lastKey: null });
  },

  redo() {
    const { past, doc, future } = get();
    if (!future.length) return;
    set({ doc: future[0], future: future.slice(1), past: [...past, doc], lastKey: null });
  },

  setPreview(p) {
    const old = get().preview;
    if (old && old.bitmap !== p.bitmap) old.bitmap.close();
    // Si el worker no reenvió el original (la geometría no cambió), se conserva el anterior.
    const original = p.original ?? old?.original ?? null;
    if (old?.original && p.original && old.original !== p.original) old.original.close();
    set({ preview: { ...p, original }, error: null });
  },

  set(partial) {
    set(partial);
  },

  saveCustomPreset(name) {
    const { doc, customPresets } = get();
    const id = doc.effectId;
    const list = customPresets[id] ?? [];
    const preset: Preset = { id: `custom-${Date.now()}`, name, params: effectParams(doc, id) };
    const next = { ...customPresets, [id]: [...list, preset] };
    savePresets(next);
    set({ customPresets: next });
  },

  deleteCustomPreset(pid) {
    const { doc, customPresets } = get();
    const id = doc.effectId;
    const next = { ...customPresets, [id]: (customPresets[id] ?? []).filter((p) => p.id !== pid) };
    savePresets(next);
    set({ customPresets: next });
  },
}));
