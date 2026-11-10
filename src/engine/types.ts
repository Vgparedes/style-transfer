/**
 * Tipos centrales del motor de procesamiento.
 *
 * Un efecto recibe una imagen ya preparada (recortada, rotada, escalada y con
 * los ajustes globales aplicados) y devuelve un resultado que puede ser:
 *  - una escena vectorial (puntos, líneas, polígonos) → exportable a SVG real,
 *  - una imagen raster (ImageData),
 *  - o ambas.
 */

/** Imagen RGBA plana, compatible con ImageData pero usable en Workers. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

// ---------------------------------------------------------------------------
// Escena vectorial
// ---------------------------------------------------------------------------

export type BlendMode = 'normal' | 'multiply';

/** Capa de círculos. Radios en px de la escena. */
export interface CirclesLayer {
  kind: 'circles';
  xs: Float32Array;
  ys: Float32Array;
  rs: Float32Array;
  /** Color de relleno CSS cuando no hay colores por punto. */
  fill: string;
  /** Colores por punto (0xRRGGBB). Opcional. */
  colors?: Uint32Array;
  opacity: number;
  blend?: BlendMode;
}

/** Capa de cuadrados centrados en (x,y), con lado `sizes[i]` y rotación común. */
export interface SquaresLayer {
  kind: 'squares';
  xs: Float32Array;
  ys: Float32Array;
  sizes: Float32Array;
  /** Rotación en radianes. */
  angle: number;
  fill: string;
  colors?: Uint32Array;
  opacity: number;
  blend?: BlendMode;
}

/**
 * Capa de polilíneas con trazo de ancho fijo.
 * `points` = [x0,y0,x1,y1,...]; `offsets[i]` es el índice (en puntos, no en
 * floats) donde comienza la polilínea i; la última termina en points.length/2.
 */
export interface PolylinesLayer {
  kind: 'polylines';
  points: Float32Array;
  offsets: Uint32Array;
  stroke: string;
  width: number;
  opacity: number;
  closed?: Uint8Array;
  blend?: BlendMode;
}

/** Capa de polígonos rellenos (misma codificación que PolylinesLayer). */
export interface PolygonsLayer {
  kind: 'polygons';
  points: Float32Array;
  offsets: Uint32Array;
  fill: string;
  colors?: Uint32Array;
  opacity: number;
  blend?: BlendMode;
}

export type SceneLayer = CirclesLayer | SquaresLayer | PolylinesLayer | PolygonsLayer;

export interface VectorScene {
  width: number;
  height: number;
  /** Color de fondo CSS o null para transparente. */
  background: string | null;
  layers: SceneLayer[];
}

// ---------------------------------------------------------------------------
// Efectos
// ---------------------------------------------------------------------------

export interface EffectResult {
  scene?: VectorScene;
  raster?: RGBAImage;
  /** Estadísticas o información para mostrar en la barra de estado. */
  info?: string;
}

export interface EffectContext {
  /**
   * Factor entre la resolución de procesamiento y la resolución de salida.
   * Los parámetros en píxeles están expresados en px de la salida, así que
   * cada efecto debe multiplicarlos por `scale`.
   */
  scale: number;
  /** Fondo global: color CSS o null si es transparente. */
  background: string | null;
  /**
   * Imagen fuente sin ajustes de color (solo geometría), por si un efecto
   * necesita los colores originales.
   */
  original: RGBAImage;
}

export type ParamValue = number | string | boolean;
export type EffectParams = Record<string, ParamValue>;

interface ParamBase {
  key: string;
  label: string;
  hint?: string;
  /** Sección del panel donde se agrupa el control. */
  group?: string;
  /** Mostrar el control solo si se cumple la condición. */
  visibleIf?: (p: EffectParams) => boolean;
}

export interface RangeParam extends ParamBase {
  type: 'range';
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Si es true, el valor se multiplica por `scale` (px de salida). */
  pixels?: boolean;
}

export interface SelectParam extends ParamBase {
  type: 'select' | 'segmented';
  options: { value: string; label: string }[];
}

export interface ColorParam extends ParamBase {
  type: 'color';
}

export interface ToggleParam extends ParamBase {
  type: 'toggle';
}

export interface SeedParam extends ParamBase {
  type: 'seed';
}

export type ParamSpec = RangeParam | SelectParam | ColorParam | ToggleParam | SeedParam;

export interface Preset {
  id: string;
  name: string;
  params: EffectParams;
}

export interface EffectDefinition {
  id: string;
  name: string;
  description: string;
  /** Indica si el resultado es vectorial (se ofrece exportar SVG). */
  vector: boolean;
  params: ParamSpec[];
  defaults: EffectParams;
  presets: Preset[];
  render(input: RGBAImage, params: EffectParams, ctx: EffectContext): EffectResult;
}
