# Stylo — transformación de estilo de imágenes

Aplicación web para transformar fotografías, ilustraciones, dibujos y SVG en
distintos estilos visuales (**dotwork/stippling, halftone, line art, sketch,
grabado, pixel art y silueta**) conservando la composición original.

Todo se procesa **localmente en el navegador** (Canvas + Web Workers): las
imágenes no se suben a ningún servidor y no depende de APIs de IA.

## Puntos destacados

- **Dotwork que preserva dibujos:** el motor *Estructura* reconstruye cada
  trazo con puntos sobre su línea central, respeta el grosor de línea y
  delinea las formas rellenas. Es distinto de aplicar semitonos a una foto,
  que resuelve el motor *Tono* (stippling con ruido azul).
- **Exportación SVG real** para los estilos vectoriales (Dotwork, Halftone,
  Line Art, Grabado): cada punto o trazo es un elemento SVG, ideal para web.
- **No destructivo:** el original nunca se modifica; deshacer/rehacer ilimitado.
- Vista previa en tiempo real, comparación original/resultado (divisor o lado a
  lado), zoom y desplazamiento, recorte, rotación, volteo, escala, ajustes de
  brillo, contraste, grises, inversión y umbral.
- Presets por estilo, editables, y presets propios guardados en el navegador.

## Uso

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # compila a dist/
```

### Atajos

| Tecla | Acción |
|---|---|
| Ctrl+O | Abrir imagen (también arrastrar y soltar o Ctrl+V) |
| Ctrl+Z / Ctrl+Shift+Z | Deshacer / rehacer |
| Ctrl+E | Exportar |
| C | Recortar (Enter aplica, Esc cancela) |
| O o \\ (mantener) | Ver el original |
| 0 / 1 / + / − | Ajustar · 100 % · acercar · alejar |
| Rueda / arrastrar / doble clic | Zoom · desplazar · ajustar |

## Stack

React 18 · TypeScript · Vite · Tailwind CSS 4 · zustand · lucide-react.

La arquitectura y los algoritmos están documentados en
[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md). Para agregar un estilo nuevo
alcanza con crear un módulo en `src/effects/` y registrarlo en
`src/effects/index.ts`.

Las imágenes de ejemplo de `public/samples/` se generan con
`python3 scripts/make_samples.py public/samples` (requiere Pillow).
