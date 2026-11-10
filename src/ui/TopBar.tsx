import { useRef } from 'react';
import { Columns2, Download, FolderOpen, Maximize, Minus, Plus, Redo2, RotateCcw, SplitSquareHorizontal, Square, Undo2 } from 'lucide-react';
import { useStore } from '../state/store';
import { useView } from './Viewport';
import { cx, IconButton } from './controls';
import { ACCEPT_ATTR } from './load';

export function TopBar({ onOpenFiles }: { onOpenFiles: (files: FileList | File[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const source = useStore((s) => s.source);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const compare = useStore((s) => s.compare);
  const { undo, redo, resetAll, set } = useStore.getState();
  const zoom = useView((s) => s.zoom);
  const view = useView.getState();

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
      <div className="mr-2 flex items-center gap-2 pl-1">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="8" fill="#4f8bff" />
          <g fill="#fff">
            <circle cx="10" cy="10" r="3" />
            <circle cx="22" cy="10" r="2" />
            <circle cx="10" cy="22" r="2" />
            <circle cx="22" cy="22" r="3.5" />
            <circle cx="16" cy="16" r="1.5" />
          </g>
        </svg>
        <span className="text-[13px] font-semibold tracking-tight">Stylo</span>
      </div>

      <IconButton title="Abrir imagen (Ctrl+O)" onClick={() => fileRef.current?.click()} className="gap-1.5 px-2">
        <FolderOpen size={15} />
        <span className="text-[12px]">Abrir</span>
      </IconButton>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onOpenFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {source && <span className="ml-1 max-w-[220px] truncate text-[12px] text-ink-3" title={source.name}>{source.name}</span>}

      <div className="mx-2 h-5 w-px bg-line" />
      <IconButton title="Deshacer (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
        <Undo2 size={15} />
      </IconButton>
      <IconButton title="Rehacer (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>
        <Redo2 size={15} />
      </IconButton>
      <IconButton title="Restablecer todo (vuelve al original)" onClick={resetAll} disabled={!source}>
        <RotateCcw size={15} />
      </IconButton>

      <div className="flex-1" />

      <div className={cx('flex items-center gap-0.5 rounded-md bg-app p-0.5 ring-1 ring-line', !source && 'pointer-events-none opacity-40')}>
        {(
          [
            ['result', Square, 'Solo resultado'],
            ['split', SplitSquareHorizontal, 'Comparar con divisor'],
            ['side', Columns2, 'Lado a lado'],
          ] as const
        ).map(([v, Icon, title]) => (
          <button
            key={v}
            type="button"
            title={title}
            onClick={() => set({ compare: v })}
            className={cx('flex h-6 w-7 items-center justify-center rounded', compare === v ? 'bg-panel-2 text-ink ring-1 ring-line-2' : 'text-ink-3 hover:text-ink')}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>

      <div className="mx-1 flex items-center">
        <IconButton title="Alejar (−)" onClick={() => view.zoomBy(1 / 1.25)} disabled={!source}>
          <Minus size={14} />
        </IconButton>
        <button
          type="button"
          title="Zoom 100% (1)"
          onClick={() => view.zoomTo100()}
          disabled={!source}
          className="h-7 w-12 rounded-md font-mono text-[11px] text-ink-2 hover:bg-panel-2 hover:text-ink disabled:opacity-35"
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton title="Acercar (+)" onClick={() => view.zoomBy(1.25)} disabled={!source}>
          <Plus size={14} />
        </IconButton>
        <IconButton title="Ajustar a pantalla (0)" onClick={() => view.fit()} disabled={!source}>
          <Maximize size={14} />
        </IconButton>
      </div>

      <button
        type="button"
        disabled={!source}
        onClick={() => set({ exportOpen: true })}
        className="ml-1 flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-medium text-white transition-colors hover:bg-accent-2 disabled:opacity-40"
      >
        <Download size={14} /> Exportar
      </button>
    </header>
  );
}
