import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Lock, X } from 'lucide-react';
import { EFFECTS_BY_ID } from '../effects';
import { outputSize } from '../engine/geometry';
import { recipeOf, useStore } from '../state/store';
import type { ExportFormat } from '../worker/protocol';
import type { RenderClient } from '../worker/client';
import { cx, Segmented, Slider, Toggle } from './controls';

export function ExportDialog({ client }: { client: RenderClient }) {
  const open = useStore((s) => s.exportOpen);
  const source = useStore((s) => s.source);
  const doc = useStore((s) => s.doc);
  const set = useStore((s) => s.set);
  const effect = EFFECTS_BY_ID[doc.effectId];
  const vector = !!effect?.vector;
  const canSvg = vector || !!effect?.svgExport;
  const out = source ? outputSize(source.width, source.height, doc.transform) : { w: 1, h: 1 };

  const [format, setFormat] = useState<ExportFormat>(vector ? 'svg' : 'png');
  const [width, setWidth] = useState(out.w);
  const [transparent, setTransparent] = useState(doc.background.transparent);
  const [quality, setQuality] = useState(0.92);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Para efectos de puntos se prioriza SVG.
    setFormat(vector ? 'svg' : 'png');
    setWidth(out.w);
    setTransparent(doc.background.transparent);
    setError(null);
    setDone(null);
    const base = source?.name.replace(/\.[^.]+$/, '') ?? 'imagen';
    setName(`${base}-${effect?.id ?? 'stylo'}`);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const height = Math.max(1, Math.round((width * out.h) / out.w));
  const canTransparent = format !== 'jpg';
  const sizeOk = width >= 1 && Math.max(width, height) <= 12000;

  const estimate = useMemo(() => {
    const mp = (width * height) / 1e6;
    return mp > 40 ? 'Puede tardar varios segundos' : null;
  }, [width, height]);

  if (!open || !source) return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const recipe = recipeOf(doc);
      recipe.background = transparent && canTransparent ? null : doc.background.transparent ? '#ffffff' : doc.background.color;
      const res = await client.export(recipe, format, width, height, quality);
      const ext = format === 'jpg' ? 'jpg' : format;
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name || 'imagen'}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setDone(`${(res.blob.size / 1024 / 1024).toFixed(2)} MB · ${Math.round(res.ms)} ms`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const scales = [0.5, 1, 2, 4];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && !busy && set({ exportOpen: false })}>
      <div className="w-[380px] rounded-xl bg-panel shadow-2xl ring-1 ring-line">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold">Exportar</h2>
          <button type="button" onClick={() => set({ exportOpen: false })} className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Cerrar">
            <X size={15} />
          </button>
        </div>
        <div className="space-y-4 p-4">
          <Segmented
            label="Formato"
            value={format}
            onChange={setFormat}
            options={[
              { value: 'svg', label: 'SVG', title: 'Vectorial: escala sin pérdida' },
              { value: 'png', label: 'PNG' },
              { value: 'jpg', label: 'JPG' },
              { value: 'webp', label: 'WEBP' },
            ].filter((o) => o.value !== 'svg' || canSvg) as { value: ExportFormat; label: string; title?: string }[]}
            hint={
              format === 'svg'
                ? vector
                  ? 'Vector real: cada punto/trazo es un elemento SVG. Ideal para web, escala sin perder calidad.'
                  : 'Vectorizado: las formas se convierten en contornos SVG. Escala sin perder calidad.'
                : !canSvg
                  ? `"${effect?.name}" es un estilo raster: SVG no disponible.`
                  : undefined
            }
          />

          <div>
            <div className="mb-1 flex items-center justify-between text-ink-2">
              <span>Dimensiones</span>
              <span className="flex gap-1">
                {scales.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setWidth(Math.round(out.w * s))}
                    className={cx('h-5 rounded px-1.5 font-mono text-[10.5px] ring-1', width === Math.round(out.w * s) ? 'bg-accent/15 text-ink ring-accent/60' : 'text-ink-3 ring-line hover:text-ink')}
                  >
                    {s}×
                  </button>
                ))}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex flex-1 items-center rounded-md bg-app px-2 ring-1 ring-line focus-within:ring-accent">
                <span className="text-ink-3">W</span>
                <input type="number" min={1} value={width} onChange={(e) => setWidth(Math.max(1, Math.round(+e.target.value || 1)))} className="h-7 w-full bg-transparent px-2 text-right font-mono outline-none" />
              </label>
              <Lock size={12} className="text-ink-3" />
              <label className="flex flex-1 items-center rounded-md bg-app px-2 ring-1 ring-line focus-within:ring-accent">
                <span className="text-ink-3">H</span>
                <input
                  type="number"
                  min={1}
                  value={height}
                  onChange={(e) => setWidth(Math.max(1, Math.round(((+e.target.value || 1) * out.w) / out.h)))}
                  className="h-7 w-full bg-transparent px-2 text-right font-mono outline-none"
                />
              </label>
              <span className="text-ink-3">px</span>
            </div>
            {!sizeOk && <p className="mt-1 text-[11px] text-danger">Máximo 12000 px por lado.</p>}
            {estimate && sizeOk && <p className="mt-1 text-[11px] text-ink-3">{estimate}</p>}
          </div>

          {canTransparent ? (
            <Toggle label="Fondo transparente" checked={transparent} onChange={setTransparent} />
          ) : (
            <p className="text-[11px] text-ink-3">JPG no admite transparencia: se usa el color de fondo{doc.background.transparent ? ' blanco' : ''}.</p>
          )}
          {(format === 'jpg' || format === 'webp') && <Slider label="Calidad" value={quality} min={0.5} max={1} step={0.01} onChange={setQuality} />}

          <div>
            <div className="mb-1 text-ink-2">Nombre de archivo</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="h-7 w-full rounded-md bg-app px-2 ring-1 ring-line outline-none focus:ring-accent" />
          </div>
          {error && <p className="text-[11.5px] text-danger">{error}</p>}
          {done && <p className="text-[11.5px] text-emerald-400">Listo: {done}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={() => set({ exportOpen: false })} className="h-8 rounded-md px-3 text-ink-2 hover:bg-panel-2 hover:text-ink">
            Cerrar
          </button>
          <button
            type="button"
            disabled={busy || !sizeOk}
            onClick={run}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 font-medium text-white hover:bg-accent-2 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {busy ? 'Exportando…' : `Exportar ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
