import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Check, Loader2, X } from 'lucide-react';
import { useStore } from '../state/store';
import { drawTransformed, rotatedFrame, type CropRect } from '../engine/geometry';
import { cx } from './controls';

// ---------------------------------------------------------------------------
// Estado de la vista (zoom/desplazamiento): no forma parte del historial.
// ---------------------------------------------------------------------------

interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
  /** Incrementar para pedir "ajustar a pantalla". */
  fitTick: number;
  zoomTick: { factor: number; n: number } | null;
  set(p: Partial<ViewState>): void;
  fit(): void;
  zoomBy(factor: number): void;
  zoomTo100(): void;
}

export const useView = create<ViewState>((set, get) => ({
  zoom: 1,
  panX: 0,
  panY: 0,
  fitTick: 0,
  zoomTick: null,
  set: (p) => set(p),
  fit: () => set({ fitTick: get().fitTick + 1 }),
  zoomBy: (factor) => set({ zoomTick: { factor, n: (get().zoomTick?.n ?? 0) + 1 } }),
  zoomTo100: () => set({ zoomTick: { factor: 1 / get().zoom, n: (get().zoomTick?.n ?? 0) + 1 } }),
}));

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 32;
const PADDING = 48;
const SIDE_GAP = 24; // px de pantalla entre imágenes en "lado a lado"

type Rect = { x: number; y: number; w: number; h: number };
type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'new';

const ASPECTS: { value: string; label: string; r: number | null }[] = [
  { value: 'free', label: 'Libre', r: null },
  { value: 'orig', label: 'Original', r: -1 },
  { value: '1:1', label: '1:1', r: 1 },
  { value: '4:3', label: '4:3', r: 4 / 3 },
  { value: '3:4', label: '3:4', r: 3 / 4 },
  { value: '16:9', label: '16:9', r: 16 / 9 },
  { value: '9:16', label: '9:16', r: 9 / 16 },
];

let checkerPattern: CanvasPattern | null = null;
function checker(ctx: CanvasRenderingContext2D) {
  if (checkerPattern) return checkerPattern;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#d9d9de';
  g.fillRect(0, 0, 8, 8);
  g.fillRect(8, 8, 8, 8);
  checkerPattern = ctx.createPattern(c, 'repeat');
  return checkerPattern!;
}

export function Viewport() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const source = useStore((s) => s.source);
  const preview = useStore((s) => s.preview);
  const busy = useStore((s) => s.busy);
  const compare = useStore((s) => s.compare);
  const split = useStore((s) => s.split);
  const holdOriginal = useStore((s) => s.holdOriginal);
  const transform = useStore((s) => s.doc.transform);
  const transparent = useStore((s) => s.doc.background.transparent);
  const tool = useStore((s) => s.tool);
  const effectId = useStore((s) => s.doc.effectId);
  const { zoom, panX, panY, fitTick, zoomTick } = useView();

  // Recorte en edición (normalizado al marco rotado).
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 1, h: 1 });
  const [aspect, setAspect] = useState('free');
  const cropping = tool === 'crop' && !!source;

  // Dimensiones lógicas de lo que se muestra (px de salida).
  const frame = source ? rotatedFrame(source.width, source.height, transform) : null;
  const display = cropping && frame
    ? { w: frame.w * transform.scale, h: frame.h * transform.scale }
    : preview
      ? { w: preview.bitmap.width / preview.k, h: preview.bitmap.height / preview.k }
      : null;
  const side = compare === 'side' && !cropping && !!preview?.original;

  // Tamaño del contenedor.
  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fitZoom = useCallback(() => {
    if (!display || !size.w) return 1;
    const totalW = side ? display.w * 2 : display.w;
    const availW = size.w - PADDING * 2 - (side ? SIDE_GAP : 0);
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(availW / totalW, (size.h - PADDING * 2) / display.h)));
  }, [display?.w, display?.h, size.w, size.h, side]);

  // Ajustar al cargar imagen, al pedirlo y al entrar/salir del recorte.
  const lastFitKey = useRef('');
  useEffect(() => {
    if (!display || !size.w) return;
    const key = `${source?.bitmap ? source.name + source.width : ''}|${fitTick}|${cropping}|${side}|${Math.round((display.w / display.h) * 100)}`;
    if (key === lastFitKey.current) return;
    lastFitKey.current = key;
    useView.getState().set({ zoom: fitZoom(), panX: 0, panY: 0 });
  }, [display, size.w, fitTick, cropping, side, fitZoom, source]);

  // Zoom con botones (centrado).
  useEffect(() => {
    if (!zoomTick) return;
    const v = useView.getState();
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * zoomTick.factor));
    const f = z / v.zoom;
    v.set({ zoom: z, panX: v.panX * f, panY: v.panY * f });
  }, [zoomTick]);

  // Al entrar al modo recorte, inicializar con el recorte actual.
  useEffect(() => {
    if (cropping) {
      setCrop(transform.crop ?? { x: 0, y: 0, w: 1, h: 1 });
      setAspect('free');
    }
  }, [cropping]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rectángulos en pantalla.
  const rects = (): { a: Rect; b?: Rect } | null => {
    if (!display) return null;
    const w = display.w * zoom;
    const h = display.h * zoom;
    const cxs = size.w / 2 + panX;
    const cys = size.h / 2 + panY;
    if (side) {
      const total = w * 2 + SIDE_GAP;
      const x0 = cxs - total / 2;
      return { a: { x: x0, y: cys - h / 2, w, h }, b: { x: x0 + w + SIDE_GAP, y: cys - h / 2, w, h } };
    }
    return { a: { x: cxs - w / 2, y: cys - h / 2, w, h } };
  };

  // ------------------------------------------------------------------ dibujo
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const r = rects();
    if (!r) return;
    const { a, b } = r;

    const shadow = (rc: Rect) => {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = '#000';
      ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
      ctx.restore();
    };

    if (cropping && source && frame) {
      shadow(a);
      ctx.fillStyle = checker(ctx);
      ctx.fillRect(a.x, a.y, a.w, a.h);
      ctx.save();
      ctx.translate(a.x, a.y);
      drawTransformed(ctx, source.bitmap, transform, zoom, true);
      ctx.restore();
      // Oscurecer fuera del recorte.
      const c = { x: a.x + crop.x * a.w, y: a.y + crop.y * a.h, w: crop.w * a.w, h: crop.h * a.h };
      ctx.fillStyle = 'rgba(8,8,10,0.62)';
      ctx.beginPath();
      ctx.rect(a.x, a.y, a.w, a.h);
      ctx.rect(c.x, c.y, c.w, c.h);
      ctx.fill('evenodd');
      // Regla de tercios.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const t of [1 / 3, 2 / 3]) {
        ctx.moveTo(c.x + c.w * t, c.y);
        ctx.lineTo(c.x + c.w * t, c.y + c.h);
        ctx.moveTo(c.x, c.y + c.h * t);
        ctx.lineTo(c.x + c.w, c.y + c.h * t);
      }
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(c.x, c.y, c.w, c.h);
      ctx.fillStyle = '#fff';
      for (const [hx, hy] of [
        [0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1],
      ]) {
        ctx.fillRect(c.x + c.w * hx - 4, c.y + c.h * hy - 4, 8, 8);
      }
      return;
    }

    if (!preview) return;
    const showOriginal = holdOriginal && preview.original;
    const smoothFor = (bmp: ImageBitmap, rc: Rect) => {
      // Al ampliar más allá de la resolución de la vista previa, píxeles nítidos
      // (más fiel para pixel art y para inspeccionar puntos).
      const mag = rc.w / bmp.width;
      ctx.imageSmoothingEnabled = mag < 1.5 && effectId !== 'pixelart';
      ctx.imageSmoothingQuality = 'high';
    };
    const paint = (bmp: ImageBitmap, rc: Rect, withChecker: boolean) => {
      if (withChecker) {
        ctx.fillStyle = checker(ctx);
        ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
      }
      smoothFor(bmp, rc);
      ctx.drawImage(bmp, rc.x, rc.y, rc.w, rc.h);
    };

    shadow(a);
    if (b) shadow(b);

    if (showOriginal) {
      paint(preview.original!, a, true);
    } else if (side && b) {
      paint(preview.original!, a, true);
      paint(preview.bitmap, b, transparent);
    } else if (compare === 'split' && preview.original) {
      paint(preview.original, a, true);
      const sx = a.x + a.w * split;
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, a.y, a.x + a.w - sx, a.h);
      ctx.clip();
      ctx.fillStyle = '#fff';
      if (!transparent) ctx.fillRect(sx, a.y, a.x + a.w - sx, a.h);
      paint(preview.bitmap, a, transparent);
      ctx.restore();
      // Divisor.
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx - 0.75, a.y, 1.5, a.h);
      const my = Math.min(Math.max(a.y + a.h / 2, 30), size.h - 30);
      ctx.beginPath();
      ctx.arc(sx, my, 13, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#18181b';
      ctx.beginPath();
      ctx.moveTo(sx - 7, my);
      ctx.lineTo(sx - 3, my - 4);
      ctx.lineTo(sx - 3, my + 4);
      ctx.moveTo(sx + 7, my);
      ctx.lineTo(sx + 3, my - 4);
      ctx.lineTo(sx + 3, my + 4);
      ctx.fill();
      // Etiquetas.
      label(ctx, 'Original', a.x + 10, a.y + 10, sx - a.x > 90);
      label(ctx, 'Resultado', a.x + a.w - 10, a.y + 10, a.x + a.w - sx > 90, true);
    } else {
      paint(preview.bitmap, a, transparent);
    }
    if (side && b) {
      label(ctx, 'Original', a.x + 10, a.y + 10, true);
      label(ctx, 'Resultado', b.x + 10, b.y + 10, true);
    }
  }, [size, preview, compare, split, holdOriginal, zoom, panX, panY, transparent, cropping, crop, source, transform, side, effectId, display?.w, display?.h]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    draw();
  }, [draw]);

  // ------------------------------------------------------------ interacción
  const drag = useRef<
    | { kind: 'pan'; x: number; y: number; px: number; py: number }
    | { kind: 'split' }
    | { kind: 'crop'; handle: CropHandle; x: number; y: number; start: CropRect }
    | null
  >(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const cropHit = (x: number, y: number): CropHandle | null => {
    const r = rects();
    if (!r) return null;
    const a = r.a;
    const c = { x: a.x + crop.x * a.w, y: a.y + crop.y * a.h, w: crop.w * a.w, h: crop.h * a.h };
    const T = 9;
    const nearL = Math.abs(x - c.x) < T, nearR = Math.abs(x - (c.x + c.w)) < T;
    const nearT = Math.abs(y - c.y) < T, nearB = Math.abs(y - (c.y + c.h)) < T;
    const inX = x > c.x - T && x < c.x + c.w + T, inY = y > c.y - T && y < c.y + c.h + T;
    if (nearT && nearL) return 'nw';
    if (nearT && nearR) return 'ne';
    if (nearB && nearL) return 'sw';
    if (nearB && nearR) return 'se';
    if (nearT && inX) return 'n';
    if (nearB && inX) return 's';
    if (nearL && inY) return 'w';
    if (nearR && inY) return 'e';
    if (x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h) return 'move';
    if (x > a.x && x < a.x + a.w && y > a.y && y < a.y + a.h) return 'new';
    return null;
  };

  const aspectRatio = (): number | null => {
    const a = ASPECTS.find((x) => x.value === aspect)?.r ?? null;
    if (a === -1 && source) return source.width / source.height;
    return a;
  };

  const constrain = (c: CropRect, handle: CropHandle): CropRect => {
    let { x, y, w, h } = c;
    const min = 0.02;
    w = Math.max(min, w);
    h = Math.max(min, h);
    const ar = aspectRatio();
    if (ar && frame && handle !== 'move') {
      // ar en px → en coordenadas normalizadas.
      const arN = (ar * frame.h) / frame.w;
      if (['n', 's'].includes(handle)) w = h * arN;
      else h = w / arN;
      if (w > 1) { w = 1; h = w / arN; }
      if (h > 1) { h = 1; w = h * arN; }
      if (handle.includes('w')) x = c.x + c.w - w;
      if (handle.includes('n')) y = c.y + c.h - h;
    }
    x = Math.min(Math.max(0, x), 1 - w);
    y = Math.min(Math.max(0, y), 1 - h);
    w = Math.min(w, 1 - x);
    h = Math.min(h, 1 - y);
    return { x, y, w, h };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const p = local(e);
    (e.target as Element).setPointerCapture(e.pointerId);
    const r = rects();
    if (cropping && e.button === 0 && r) {
      const handle = cropHit(p.x, p.y);
      if (handle) {
        const nx = (p.x - r.a.x) / r.a.w, ny = (p.y - r.a.y) / r.a.h;
        const start = handle === 'new' ? { x: nx, y: ny, w: 0, h: 0 } : crop;
        drag.current = { kind: 'crop', handle: handle === 'new' ? 'se' : handle, x: p.x, y: p.y, start };
        return;
      }
    }
    if (!cropping && compare === 'split' && preview?.original && r && e.button === 0) {
      const sx = r.a.x + r.a.w * split;
      if (Math.abs(p.x - sx) < 14 && p.y > r.a.y && p.y < r.a.y + r.a.h) {
        drag.current = { kind: 'split' };
        return;
      }
    }
    drag.current = { kind: 'pan', x: p.x, y: p.y, px: panX, py: panY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    const d = drag.current;
    const canvas = canvasRef.current!;
    if (!d) {
      // Cursor según lo que hay debajo.
      let cur = 'grab';
      if (cropping) {
        const h = cropHit(p.x, p.y);
        cur = h === 'move' ? 'move' : h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'ne' || h === 'sw' ? 'nesw-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : h === 'new' ? 'crosshair' : 'grab';
      } else if (compare === 'split' && preview?.original) {
        const r = rects();
        if (r && Math.abs(p.x - (r.a.x + r.a.w * split)) < 14) cur = 'ew-resize';
      }
      canvas.style.cursor = cur;
      return;
    }
    const r = rects();
    if (d.kind === 'pan') {
      canvas.style.cursor = 'grabbing';
      useView.getState().set({ panX: d.px + p.x - d.x, panY: d.py + p.y - d.y });
    } else if (d.kind === 'split' && r) {
      useStore.getState().set({ split: Math.min(1, Math.max(0, (p.x - r.a.x) / r.a.w)) });
    } else if (d.kind === 'crop' && r) {
      const dx = (p.x - d.x) / r.a.w, dy = (p.y - d.y) / r.a.h;
      const s = d.start;
      let c: CropRect = { ...s };
      switch (d.handle) {
        case 'move': c = { ...s, x: s.x + dx, y: s.y + dy }; break;
        case 'n': c = { ...s, y: s.y + dy, h: s.h - dy }; break;
        case 's': c = { ...s, h: s.h + dy }; break;
        case 'w': c = { ...s, x: s.x + dx, w: s.w - dx }; break;
        case 'e': c = { ...s, w: s.w + dx }; break;
        case 'nw': c = { x: s.x + dx, y: s.y + dy, w: s.w - dx, h: s.h - dy }; break;
        case 'ne': c = { ...s, y: s.y + dy, w: s.w + dx, h: s.h - dy }; break;
        case 'sw': c = { ...s, x: s.x + dx, w: s.w - dx, h: s.h + dy }; break;
        case 'se': c = { ...s, w: s.w + dx, h: s.h + dy }; break;
      }
      // Normaliza rectángulos "dados vuelta".
      if (c.w < 0) { c.x += c.w; c.w = -c.w; }
      if (c.h < 0) { c.y += c.h; c.h = -c.h; }
      setCrop(constrain(c, d.handle));
    }
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  // Zoom con rueda (centrado en el cursor). Rueda de mouse = zoom;
  // desplazamiento de trackpad = paneo; pellizco (ctrl) = zoom.
  useEffect(() => {
    const el = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = useView.getState();
      const isMouseWheel = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey || isMouseWheel) {
        const r = el.getBoundingClientRect();
        const mx = e.clientX - r.left - el.clientWidth / 2;
        const my = e.clientY - r.top - el.clientHeight / 2;
        const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        const factor = Math.exp(-dy * (e.ctrlKey && !isMouseWheel ? 0.01 : 0.0018));
        const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor));
        const f = z / v.zoom;
        v.set({ zoom: z, panX: mx - (mx - v.panX) * f, panY: my - (my - v.panY) * f });
      } else {
        v.set({ panX: v.panX - e.deltaX, panY: v.panY - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const applyCrop = () => {
    const full = crop.x < 0.001 && crop.y < 0.001 && crop.w > 0.999 && crop.h > 0.999;
    useStore.getState().update(`crop:${performance.now()}`, (d) => ({ ...d, transform: { ...d.transform, crop: full ? null : crop } }));
    useStore.getState().set({ tool: 'none' });
  };
  const cancelCrop = () => useStore.getState().set({ tool: 'none' });

  // Atajos del recorte.
  useEffect(() => {
    if (!cropping) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') applyCrop();
      if (e.key === 'Escape') cancelCrop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1 overflow-hidden bg-app" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => !cropping && useView.getState().fit()}
      />
      {busy && !cropping && (
        <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-panel/90 px-2.5 py-1 text-[11px] text-ink-2 ring-1 ring-line backdrop-blur">
          <Loader2 size={12} className="animate-spin" /> Procesando
        </div>
      )}
      {!preview && source && !cropping && (
        <div className="absolute inset-0 flex items-center justify-center text-ink-3">
          <Loader2 className="animate-spin" />
        </div>
      )}
      {cropping && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-panel/95 p-1.5 shadow-xl ring-1 ring-line backdrop-blur">
          <div className="flex gap-0.5">
            {ASPECTS.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => {
                  setAspect(a.value);
                  if (a.r) setTimeout(() => setCrop((c) => constrain(c, 'se')), 0);
                }}
                className={cx('h-7 rounded-md px-2 text-[11px] font-medium', aspect === a.value ? 'bg-panel-2 text-ink ring-1 ring-line-2' : 'text-ink-3 hover:text-ink')}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="h-5 w-px bg-line" />
          <button type="button" onClick={cancelCrop} className="flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-ink-2 hover:bg-panel-2 hover:text-ink">
            <X size={13} /> Cancelar
          </button>
          <button type="button" onClick={applyCrop} className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-[11.5px] font-medium text-white hover:bg-accent-2">
            <Check size={13} /> Aplicar
          </button>
        </div>
      )}
    </div>
  );
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, show: boolean, right = false) {
  if (!show) return;
  ctx.font = '500 11px Inter, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 14;
  const bx = right ? x - w : x;
  ctx.fillStyle = 'rgba(12,12,14,0.72)';
  ctx.beginPath();
  ctx.roundRect(bx, y, w, 20, 5);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, bx + 7, y + 14);
}
