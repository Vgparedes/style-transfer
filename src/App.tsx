import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { EffectsPanel } from './ui/EffectsPanel';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { TopBar } from './ui/TopBar';
import { StatusBar } from './ui/StatusBar';
import { Viewport, useView } from './ui/Viewport';
import { ExportDialog } from './ui/ExportDialog';
import { ACCEPT_ATTR, loadFile, loadUrl } from './ui/load';
import { QUALITY_MAX_SIDE, recipeOf, useStore } from './state/store';
import { RenderClient } from './worker/client';
import { cx } from './ui/controls';

const SAMPLES = [
  { url: `${import.meta.env.BASE_URL}samples/girasoles.svg`, name: 'girasoles.svg', label: 'Girasoles (dibujo lineal)' },
  { url: `${import.meta.env.BASE_URL}samples/esfera.png`, name: 'esfera.png', label: 'Esfera (sombreado tonal)' },
];

export default function App() {
  const client = useMemo(() => new RenderClient(), []);
  const source = useStore((s) => s.source);
  const doc = useStore((s) => s.doc);
  const quality = useStore((s) => s.quality);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Conexión worker → estado.
  useEffect(() => {
    client.onPreview = (r) => useStore.getState().setPreview({ ...r, original: r.original ?? null });
    client.onError = (m) => useStore.getState().set({ error: m });
    client.onBusy = (b) => useStore.getState().set({ busy: b });
    // Si el cliente se recrea (p. ej. recarga en caliente) reenviamos la imagen.
    const src = useStore.getState().source;
    if (src) client.setSource(src.bitmap).then(() => client.requestPreview(recipeOf(useStore.getState().doc), QUALITY_MAX_SIDE[useStore.getState().quality], true));
  }, [client]);

  const open = useCallback(
    async (files: FileList | File[]) => {
      const file = Array.from(files)[0];
      if (!file) return;
      try {
        const src = await loadFile(file);
        await client.setSource(src.bitmap);
        useStore.getState().setSource(src);
        useView.getState().fit();
      } catch (e) {
        useStore.getState().set({ error: e instanceof Error ? e.message : String(e) });
      }
    },
    [client],
  );

  const openSample = async (s: (typeof SAMPLES)[number]) => {
    try {
      const src = await loadUrl(s.url, s.name);
      await client.setSource(src.bitmap);
      useStore.getState().setSource(src);
    } catch (e) {
      useStore.getState().set({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  // Vista previa en tiempo real: cada cambio del documento dispara un render
  // (el cliente descarta los pedidos intermedios).
  const geomKey = useRef('');
  useEffect(() => {
    if (!source) return;
    const key = `${source.name}|${source.width}|${JSON.stringify(doc.transform)}|${quality}`;
    const wantOriginal = key !== geomKey.current;
    geomKey.current = key;
    client.requestPreview(recipeOf(doc), QUALITY_MAX_SIDE[quality], wantOriginal);
  }, [doc, source, quality, client]);

  // Atajos de teclado.
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) && (t as HTMLInputElement).type !== 'range';
    };
    const down = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        fileRef.current?.click();
        return;
      }
      if (mod && e.key.toLowerCase() === 'e' && st.source) {
        e.preventDefault();
        st.set({ exportOpen: true });
        return;
      }
      if (isTyping(e)) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod || st.exportOpen || st.tool === 'crop') return;
      const v = useView.getState();
      if (e.key === '0') v.fit();
      else if (e.key === '1') v.zoomTo100();
      else if (e.key === '+' || e.key === '=') v.zoomBy(1.25);
      else if (e.key === '-') v.zoomBy(0.8);
      else if (e.key.toLowerCase() === 'c' && st.source) st.set({ tool: 'crop' });
      else if (e.key === '\\' || e.key.toLowerCase() === 'o') st.set({ holdOriginal: true });
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === '\\' || e.key.toLowerCase() === 'o') useStore.getState().set({ holdOriginal: false });
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Pegar imagen desde el portapapeles.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'));
      if (f) open([f]);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open]);

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) open(e.dataTransfer.files);
      }}
    >
      <TopBar onOpenFiles={open} />
      <div className="flex min-h-0 flex-1">
        <EffectsPanel />
        <main className="relative flex min-w-0 flex-1">
          <Viewport />
          {!source && (
            <div className="absolute inset-0 flex items-center justify-center p-8">
              <div className="w-full max-w-md text-center">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="group flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed border-line-2 bg-panel/60 px-8 py-12 transition-colors hover:border-accent/60 hover:bg-panel"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-panel-2 text-ink-2 ring-1 ring-line group-hover:text-accent">
                    <ImageUp size={22} />
                  </span>
                  <span className="text-[14px] font-medium text-ink">Arrastrá una imagen o hacé clic para abrir</span>
                  <span className="text-[12px] text-ink-3">PNG, JPG, WEBP o SVG · también podés pegar con Ctrl+V</span>
                </button>
                <div className="mt-5 text-[11.5px] text-ink-3">
                  o probá con un ejemplo:
                  <div className="mt-2 flex justify-center gap-2">
                    {SAMPLES.map((s) => (
                      <button key={s.url} type="button" onClick={() => openSample(s)} className="rounded-md bg-panel px-2.5 py-1.5 text-ink-2 ring-1 ring-line hover:text-ink hover:ring-line-2">
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          <div
            className={cx(
              'pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10 text-[14px] font-medium text-ink transition-opacity',
              dragging ? 'opacity-100' : 'opacity-0',
            )}
          >
            Soltá la imagen para abrirla
          </div>
        </main>
        <PropertiesPanel />
      </div>
      <StatusBar />
      <ExportDialog client={client} />
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) open(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
