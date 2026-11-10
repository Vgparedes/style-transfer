import type { EffectDefinition } from '../engine/types';
import { cloneImage } from '../engine/image';
import { dotwork } from './dotwork';
import { halftone } from './halftone';
import { lineart } from './lineart';
import { sketch } from './sketch';
import { engraving } from './engraving';
import { pixelart } from './pixelart';
import { silhouette } from './silhouette';

/** Sin efecto: solo herramientas (ajustes, recorte, rotación...). */
const none: EffectDefinition = {
  id: 'none',
  name: 'Original',
  description: 'Sin efecto: solo ajustes y herramientas.',
  vector: false,
  params: [],
  defaults: {},
  presets: [],
  render(input, _p, ctx) {
    const out = cloneImage(input);
    if (ctx.background) {
      // Compone sobre el fondo elegido.
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(ctx.background!.slice(i, i + 2), 16));
      const d = out.data;
      for (let k = 0; k < d.length; k += 4) {
        const a = d[k + 3] / 255;
        d[k] = d[k] * a + r * (1 - a);
        d[k + 1] = d[k + 1] * a + g * (1 - a);
        d[k + 2] = d[k + 2] * a + b * (1 - a);
        d[k + 3] = 255;
      }
    }
    return { raster: out };
  },
};

/**
 * Registro de efectos. Para agregar un estilo nuevo alcanza con crear un
 * módulo que exporte un `EffectDefinition` y sumarlo a esta lista: la UI
 * (controles, presets) y la exportación se generan solas.
 */
export const EFFECTS: EffectDefinition[] = [none, dotwork, halftone, lineart, sketch, engraving, pixelart, silhouette];

export const EFFECTS_BY_ID: Record<string, EffectDefinition> = Object.fromEntries(EFFECTS.map((e) => [e.id, e]));
