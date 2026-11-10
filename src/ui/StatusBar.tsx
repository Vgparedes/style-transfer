import { useStore, type PreviewQuality } from '../state/store';
import { outputSize } from '../engine/geometry';
import { cx } from './controls';

export function StatusBar() {
  const source = useStore((s) => s.source);
  const preview = useStore((s) => s.preview);
  const error = useStore((s) => s.error);
  const quality = useStore((s) => s.quality);
  const transform = useStore((s) => s.doc.transform);
  const set = useStore((s) => s.set);
  const out = source ? outputSize(source.width, source.height, transform) : null;
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[11px] text-ink-3">
      {source ? (
        <>
          <span>
            Original <span className="font-mono text-ink-2">{source.width}×{source.height}</span>
            {source.kind === 'svg' && <span className="ml-1 text-ink-3">(SVG rasterizado)</span>}
          </span>
          {out && (
            <span>
              Salida <span className="font-mono text-ink-2">{out.w}×{out.h}</span>
            </span>
          )}
          {preview && (
            <span>
              Vista previa <span className="font-mono text-ink-2">{Math.round(preview.k * 100)}%</span> · {Math.round(preview.ms)} ms
            </span>
          )}
          {preview?.info && <span className="text-ink-2">{preview.info}</span>}
        </>
      ) : (
        <span>Procesamiento 100 % local: tus imágenes no salen del navegador.</span>
      )}
      {error && <span className="text-danger">{error}</span>}
      <div className="flex-1" />
      <span>Calidad de vista previa</span>
      <div className="flex rounded bg-app p-0.5 ring-1 ring-line">
        {(
          [
            ['fast', 'Rápida'],
            ['normal', 'Normal'],
            ['high', 'Alta'],
          ] as [PreviewQuality, string][]
        ).map(([v, l]) => (
          <button key={v} type="button" onClick={() => set({ quality: v })} className={cx('h-4 rounded-sm px-1.5 text-[10.5px]', quality === v ? 'bg-panel-2 text-ink' : 'hover:text-ink-2')}>
            {l}
          </button>
        ))}
      </div>
    </footer>
  );
}
