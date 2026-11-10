import { CircleDot, Contrast, Grid2x2, Grid3x3, ImageIcon, PenLine, Pencil, Waves, type LucideIcon } from 'lucide-react';
import { EFFECTS } from '../effects';
import { useStore } from '../state/store';
import { cx } from './controls';

const ICONS: Record<string, LucideIcon> = {
  none: ImageIcon,
  dotwork: CircleDot,
  halftone: Grid3x3,
  lineart: PenLine,
  sketch: Pencil,
  engraving: Waves,
  pixelart: Grid2x2,
  silhouette: Contrast,
};

export function EffectsPanel() {
  const effectId = useStore((s) => s.doc.effectId);
  const update = useStore((s) => s.update);
  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex h-9 items-center px-3 text-[11px] font-semibold tracking-wide text-ink-2">Estilos</div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {EFFECTS.map((e) => {
          const Icon = ICONS[e.id] ?? ImageIcon;
          const active = e.id === effectId;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => update(`effect:${performance.now()}`, (d) => (d.effectId === e.id ? d : { ...d, effectId: e.id }))}
              className={cx(
                'group flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                active ? 'bg-accent/15 ring-1 ring-accent/40' : 'hover:bg-panel-2',
              )}
            >
              <span
                className={cx(
                  'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                  active ? 'bg-accent text-white' : 'bg-panel-2 text-ink-2 ring-1 ring-line group-hover:text-ink',
                )}
              >
                <Icon size={15} strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className={cx('flex items-center gap-1.5 text-[12.5px] font-medium', active ? 'text-ink' : 'text-ink')}>
                  {e.name}
                  {e.vector && <span className="rounded bg-panel-2 px-1 py-px text-[9px] font-semibold tracking-wide text-ink-3 ring-1 ring-line">SVG</span>}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{e.description}</span>
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
