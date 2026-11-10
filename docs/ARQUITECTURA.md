# Arquitectura y decisiones técnicas

## Visión general

```
┌──────────── Hilo principal (React) ────────────┐        ┌────────── Web Worker ──────────┐
│                                                │        │                                │
│  Archivo ─► load.ts ─► ImageBitmap (original)  │──────► │  ImageBitmap (copia)           │
│                                                │        │     │                          │
│  Store (zustand)                               │        │     ▼ geometry.drawTransformed │
│   doc = receta no destructiva ─────────────────┼──────► │  RGBA (recorte/rotación/escala)│
│   (efecto, params, ajustes, geometría, fondo)  │ render │     ▼ applyAdjustments         │
│   past/future = historial                      │        │  RGBA ajustada                 │
│                                                │        │     ▼ effect.render()          │
│  Viewport (canvas) ◄── ImageBitmap preview ────┼─────── │  VectorScene | RGBA            │
│  ExportDialog ◄─────── Blob (SVG/PNG/JPG/WEBP) ┼─────── │     ▼ drawScene / sceneToSVG   │
└────────────────────────────────────────────────┘        └────────────────────────────────┘
```

- **Todo el procesamiento es local**, en el navegador. No hay servidor ni APIs de IA.
- **No destructivo:** la imagen original (`ImageBitmap`) nunca se modifica. El
  documento guarda solo la *receta*; cada render la aplica desde cero.
- **Deshacer/rehacer:** el historial son snapshots inmutables del documento.
  Los cambios consecutivos del mismo control (arrastrar un slider) se agrupan
  en un solo paso (`COALESCE_MS`).

## Estructura

| Carpeta | Contenido |
|---|---|
| `src/engine/` | Motor puro (sin React ni DOM): tipos, utilidades de imagen, morfología, trazado, muestreo, bordes, cuantización, escena vectorial y geometría. |
| `src/effects/` | Un módulo por estilo + `index.ts` (registro). |
| `src/worker/` | Protocolo, worker de render y cliente con política “el último gana”. |
| `src/state/` | Store: documento, historial, presets propios (localStorage). |
| `src/ui/` | Componentes: paneles, viewport (zoom/pan/comparar/recorte), exportación. |
| `scripts/make_samples.py` | Genera las imágenes de ejemplo de `public/samples/`. |

## Sistema modular de efectos

Un efecto es un objeto `EffectDefinition` (`src/engine/types.ts`):

```ts
{
  id, name, description,
  vector: boolean,          // ¿ofrece exportación SVG?
  params: ParamSpec[],      // la UI se genera sola a partir de esto
  defaults, presets,
  render(input, params, ctx) → { scene?: VectorScene, raster?: RGBAImage, info? }
}
```

Para agregar un estilo nuevo: crear `src/effects/miEfecto.ts` y sumarlo a
`EFFECTS` en `src/effects/index.ts`. Los controles, presets, vista previa y
exportación funcionan sin tocar nada más. Un efecto opcional basado en IA
podría implementarse igual (con un modelo local, p. ej. ONNX en el worker)
sin que el resto de la app dependa de él.

### Escena vectorial

Los efectos vectoriales devuelven una `VectorScene` con capas tipadas
(`circles`, `squares`, `polylines`, `polygons`) en *typed arrays*. La misma
escena se usa para:

- rasterizar la vista previa en un `OffscreenCanvas` dentro del worker, y
- serializar un **SVG real** (cada punto es un `<circle>`, cada trazo un `<path>`).

### Unidades y resolución

Los parámetros en píxeles (`pixels: true`) están expresados en **px de la
imagen de salida**. La vista previa se procesa a una resolución menor
(Rápida 1000 / Normal 1800 / Alta 3000 px de lado mayor) y cada efecto
multiplica sus medidas por `ctx.scale`, así que la vista previa es una
versión reducida fiel del resultado final. La exportación raster reprocesa
a la resolución pedida; la SVG procesa hasta 4000 px y declara el tamaño
pedido (el `viewBox` escala sin pérdida).

## Dotwork: por qué dos motores

Convertir una foto en puntos y convertir un dibujo lineal en puntos son
problemas distintos. Un filtro de semitonos o un stippling por tono sobre un
dibujo de líneas finas produce puntos dispersos sobre los bordes
antialiasados y **pierde la estructura**. Por eso:

### Motor “Estructura” (dibujos, line art, logos)

1. **Máscara de tinta** por umbral (con un desenfoque mínimo de 0,5 px para
   estabilizar bordes antialiasados) y limpieza de motas por área.
2. **Transformada de distancia euclidiana** exacta (Felzenszwalb): da el
   grosor local de cada trazo.
3. **Separación trazo fino / forma ancha:** los píxeles con radio mayor que
   “grosor máx. de línea / 2” forman un núcleo que se dilata; lo que queda
   fuera son trazos finos.
4. **Trazos finos → esqueleto** (Zhang–Suen, recorriendo solo píxeles
   activos) → **grafo de polilíneas** (extremos, bifurcaciones y lazos) →
   poda de espolones → suavizado → **puntos equiespaciados por longitud de
   arco** sobre la línea central. El espaciado se ajusta para que cada trazo
   tenga un número entero de intervalos, así los extremos siempre tienen punto.
5. **Formas anchas →** puntos sobre el **contorno desplazado hacia adentro
   el radio del punto** (la silueta resultante coincide con la original) +
   **relleno con ruido azul** que respeta los degradés internos.
6. Una grilla espacial evita puntos superpuestos donde se cruzan trazos.
7. En tamaño “variable”, el diámetro de cada punto sigue el **grosor real del
   trazo** en ese lugar (relativo a la mediana del dibujo), preservando el peso
   de línea del original.

Resultado: las líneas de los girasoles se reconstruyen como hileras limpias
de puntos con la misma forma, orientación y posición; los centros rellenos
quedan con contorno nítido y relleno punteado.

### Motor “Tono” (fotos, sombreados)

Stippling por **muestreo de disco de Poisson de radio variable**: el radio de
exclusión es `separación · tono^-k`, así la cantidad de puntos por área es
proporcional a la oscuridad. Es ruido azul: irregular pero sin
aglomeraciones (a diferencia del ruido aleatorio) y sin el patrón mecánico de
una trama. La distribución “Regular” usa una grilla hexagonal con tramado
ordenado (puntos uniformes) o modulación de tamaño (puntos variables).

### Auto

Elige el motor por histograma: mucho “papel” claro y pocos medios tonos
planos (los medios tonos de un dibujo están en bordes, con gradiente alto) ⇒
dibujo ⇒ Estructura; si no, Tono.

## Otros estilos

| Estilo | Técnica | Salida |
|---|---|---|
| Halftone | Trama rotada; área del punto ∝ tono promedio de la celda (tabla de áreas sumadas). CMYK con ángulos 15/75/0/45 y fusión *multiply*. | SVG |
| Line Art | Canny (Sobel + supresión de no-máximos + histéresis) o esqueleto de trazos → polilíneas → Douglas–Peucker + Chaikin. | SVG |
| Sketch | *Color dodge* (lápiz), rayado con ruido anisotrópico en sombras, deformación con ruido fractal. | Raster |
| Grabado | Cintas de ancho ∝ tono a lo largo de líneas rectas, onduladas, en relieve (desplazadas por la luz) o concéntricas; tramado cruzado en sombras. | SVG |
| Pixel Art | Promedio por bloque, paleta por median cut + k-means o predefinida, dithering Bayer o Floyd–Steinberg. | Raster |
| Silueta | Posterización en N bandas con bordes antialiasados. | Raster |

## Rendimiento

- Worker dedicado para la vista previa y otro para exportar (exportar no
  bloquea la edición).
- Política “el último gana”: mientras se procesa un render, los pedidos nuevos
  reemplazan al pendiente; nunca se acumula trabajo atrasado.
- Algoritmos O(n) o casi: desenfoque por cajas, EDT separable, tabla de áreas
  sumadas, grilla espacial para Poisson; el esqueleto recorre solo píxeles de
  tinta.
- Referencia (1920×2400, dibujo de girasoles): ~300–450 ms de vista previa,
  ~3 s para exportar PNG a 3840×4800.

## Posibles extensiones

- Vectorizar Silueta/Pixel Art (marching squares / rectángulos fusionados).
- Relajación de Lloyd ponderada (Secord) como opción de máxima calidad del Tono.
- Efecto opcional con IA local (ONNX Runtime Web) para estilos “pictóricos”.
