import { useState } from 'react';
import { Crop, FlipHorizontal2, FlipVertical2, Plus, RotateCcw, RotateCcwSquare, RotateCwSquare, Trash2, X } from 'lucide-react';
import { EFFECTS_BY_ID } from '../effects';
import type { EffectParams, ParamSpec } from '../engine/types';
import { effectParams, useStore } from '../state/store';
import { outputSize } from '../engine/geometry';
import { ColorInput, cx, IconButton, Section, SeedInput, Segmented, Select, Slider, Toggle } from './controls';

function ParamControl({ spec, params, onChange }: { spec: ParamSpec; params: EffectParams; onChange: (k: string, v: EffectParams[string]) => void }) {
  const v = params[spec.key];
  switch (spec.type) {
    case 'range':
      return <Slider label={spec.label} hint={spec.hint} value={v as number} min={spec.min} max={spec.max} step={spec.step} unit={spec.unit} onChange={(x) => onChange(spec.key, x)} />;
    case 'segmented':
      return <Segmented label={spec.label} hint={spec.hint} value={v as string} options={spec.options} onChange={(x) => onChange(spec.key, x)} />;
    case 'select':
      return <Select label={spec.label} value={v as string} options={spec.options} onChange={(x) => onChange(spec.key, x)} />;
    case 'color':
      return <ColorInput label={spec.label} value={v as string} onChange={(x) => onChange(spec.key, x)} />;
    case 'toggle':
      return <Toggle label={spec.label} hint={spec.hint} checked={!!v} onChange={(x) => onChange(spec.key, x)} />;
    case 'seed':
      return <SeedInput label={spec.label} value={v as number} onChange={(x) => onChange(spec.key, x)} />;
  }
}

function presetMatches(params: EffectParams, preset: EffectParams) {
  return Object.entries(preset).every(([k, v]) => params[k] === v);
}

function Presets() {
  const doc = useStore((s) => s.doc);
  const custom = useStore((s) => s.customPresets[s.doc.effectId]) ?? [];
  const { applyPreset, saveCustomPreset, deleteCustomPreset } = useStore.getState();
  const effect = EFFECTS_BY_ID[doc.effectId];
  const params = effectParams(doc);
  const [naming, setNaming] = useState<string | null>(null);
  if (!effect || effect.id === 'none') return null;
  const all = [...effect.presets.map((p) => ({ ...p, custom: false })), ...custom.map((p) => ({ ...p, custom: true }))];
  return (
    <Section
      title="Presets"
      right={
        <IconButton title="Guardar configuración actual como preset" onClick={() => setNaming('')}>
          <Plus size={14} />
        </IconButton>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {all.map((p) => {
          const active = presetMatches(params, p.params);
          return (
            <span key={p.id} className="group relative">
              <button
                type="button"
                onClick={() => applyPreset(p)}
                className={cx(
                  'h-7 rounded-md px-2.5 text-[11.5px] font-medium ring-1 transition-colors',
                  active ? 'bg-accent/15 text-ink ring-accent/60' : 'bg-app text-ink-2 ring-line hover:text-ink hover:ring-line-2',
                  p.custom && 'pr-6',
                )}
              >
                {p.name}
              </button>
              {p.custom && (
                <button
                  type="button"
                  title="Eliminar preset"
                  onClick={() => deleteCustomPreset(p.id)}
                  className="absolute top-1.5 right-1 rounded p-0.5 text-ink-3 hover:text-danger"
                >
                  <X size={11} />
                </button>
              )}
            </span>
          );
        })}
      </div>
      {naming !== null && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (naming.trim()) saveCustomPreset(naming.trim());
            setNaming(null);
          }}
        >
          <input
            autoFocus
            placeholder="Nombre del preset"
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(null)}
            className="h-7 flex-1 rounded-md bg-app px-2 ring-1 ring-line outline-none focus:ring-accent"
          />
          <button type="submit" className="h-7 rounded-md bg-accent px-2.5 font-medium text-white hover:bg-accent-2">
            Guardar
          </button>
        </form>
      )}
      <p className="text-[11px] leading-snug text-ink-3">Al aplicar un preset podés seguir ajustando cada control.</p>
    </Section>
  );
}

function EffectControls() {
  const doc = useStore((s) => s.doc);
  const setParam = useStore((s) => s.setParam);
  const resetEffect = useStore((s) => s.resetEffect);
  const effect = EFFECTS_BY_ID[doc.effectId];
  if (!effect || !effect.params.length) return null;
  const params = effectParams(doc);
  const visible = effect.params.filter((p) => !p.visibleIf || p.visibleIf(params));
  const groups = new Map<string, ParamSpec[]>();
  for (const p of visible) {
    const g = p.group ?? effect.name;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  return (
    <>
      {[...groups.entries()].map(([g, specs], i) => (
        <Section
          key={g}
          title={g}
          right={
            i === 0 ? (
              <IconButton title="Restablecer valores del estilo" onClick={resetEffect}>
                <RotateCcw size={13} />
              </IconButton>
            ) : undefined
          }
        >
          {specs.map((s) => (
            <ParamControl key={s.key} spec={s} params={params} onChange={setParam} />
          ))}
        </Section>
      ))}
    </>
  );
}

function Background() {
  const bg = useStore((s) => s.doc.background);
  const update = useStore((s) => s.update);
  return (
    <Section title="Fondo">
      <Toggle
        label="Fondo transparente"
        checked={bg.transparent}
        onChange={(v) => update('bg:transparent', (d) => ({ ...d, background: { ...d.background, transparent: v } }))}
      />
      {!bg.transparent && (
        <ColorInput label="Color de fondo" value={bg.color} onChange={(v) => update('bg:color', (d) => ({ ...d, background: { ...d.background, color: v } }))} />
      )}
    </Section>
  );
}

function Adjustments() {
  const a = useStore((s) => s.doc.adjustments);
  const update = useStore((s) => s.update);
  const set = <K extends keyof typeof a>(k: K, v: (typeof a)[K]) => update(`adj:${k}`, (d) => ({ ...d, adjustments: { ...d.adjustments, [k]: v } }));
  return (
    <Section
      title="Ajustes de imagen"
      right={
        <IconButton
          title="Restablecer ajustes"
          onClick={() => update(`adj:reset:${performance.now()}`, (d) => ({ ...d, adjustments: { brightness: 0, contrast: 0, grayscale: false, invert: false, threshold: false, thresholdValue: 0.5 } }))}
        >
          <RotateCcw size={13} />
        </IconButton>
      }
    >
      <Slider label="Brillo" value={a.brightness} min={-1} max={1} step={0.01} onChange={(v) => set('brightness', v)} />
      <Slider label="Contraste" value={a.contrast} min={-1} max={1} step={0.01} onChange={(v) => set('contrast', v)} />
      <Toggle label="Escala de grises" checked={a.grayscale} onChange={(v) => set('grayscale', v)} />
      <Toggle label="Invertir colores" checked={a.invert} onChange={(v) => set('invert', v)} />
      <Toggle label="Umbral blanco y negro" checked={a.threshold} onChange={(v) => set('threshold', v)} />
      {a.threshold && <Slider label="Nivel de umbral" value={a.thresholdValue} min={0} max={1} step={0.01} onChange={(v) => set('thresholdValue', v)} />}
      <p className="text-[11px] leading-snug text-ink-3">Se aplican antes del estilo. El original nunca se modifica.</p>
    </Section>
  );
}

function TransformTools() {
  const t = useStore((s) => s.doc.transform);
  const source = useStore((s) => s.source);
  const update = useStore((s) => s.update);
  const setStore = useStore((s) => s.set);
  const tool = useStore((s) => s.tool);
  const upd = (key: string, fn: (x: typeof t) => typeof t) => update(key, (d) => ({ ...d, transform: fn(d.transform) }));
  const out = source ? outputSize(source.width, source.height, t) : null;
  const rot = (delta: number) =>
    upd(`tf:rot:${performance.now()}`, (x) => ({ ...x, rotation: ((((x.rotation + delta) % 360) + 360) % 360) as 0 | 90 | 180 | 270, crop: null }));
  return (
    <Section title="Transformar">
      <div className="flex flex-wrap gap-1">
        <IconButton title="Recortar (C)" active={tool === 'crop'} onClick={() => setStore({ tool: tool === 'crop' ? 'none' : 'crop' })} className="gap-1.5 bg-app ring-1 ring-line">
          <Crop size={14} /> <span className="text-[11px]">Recortar</span>
        </IconButton>
        <IconButton title="Rotar 90° a la izquierda" onClick={() => rot(-90)} className="bg-app ring-1 ring-line">
          <RotateCcwSquare size={14} />
        </IconButton>
        <IconButton title="Rotar 90° a la derecha" onClick={() => rot(90)} className="bg-app ring-1 ring-line">
          <RotateCwSquare size={14} />
        </IconButton>
        <IconButton title="Voltear horizontal" active={t.flipH} onClick={() => upd(`tf:fh:${performance.now()}`, (x) => ({ ...x, flipH: !x.flipH }))} className="bg-app ring-1 ring-line">
          <FlipHorizontal2 size={14} />
        </IconButton>
        <IconButton title="Voltear vertical" active={t.flipV} onClick={() => upd(`tf:fv:${performance.now()}`, (x) => ({ ...x, flipV: !x.flipV }))} className="bg-app ring-1 ring-line">
          <FlipVertical2 size={14} />
        </IconButton>
      </div>
      <Slider label="Enderezar" value={t.angle} min={-45} max={45} step={0.1} unit="°" onChange={(v) => upd('tf:angle', (x) => ({ ...x, angle: v, crop: null }))} />
      <Slider label="Escala" value={Math.round(t.scale * 100)} min={10} max={400} step={1} unit="%" onChange={(v) => upd('tf:scale', (x) => ({ ...x, scale: v / 100 }))} />
      {out && (
        <div className="flex items-center justify-between text-[11px] text-ink-3">
          <span>Tamaño de salida</span>
          <span className="font-mono text-ink-2">
            {out.w} × {out.h} px
          </span>
        </div>
      )}
      {t.crop && (
        <button type="button" onClick={() => upd(`tf:uncrop:${performance.now()}`, (x) => ({ ...x, crop: null }))} className="flex items-center gap-1 text-[11px] text-ink-3 hover:text-danger">
          <Trash2 size={12} /> Quitar recorte
        </button>
      )}
    </Section>
  );
}

export function PropertiesPanel() {
  const [tab, setTab] = useState<'style' | 'image'>('style');
  return (
    <aside className="flex w-[288px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="border-b border-line p-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'style', label: 'Estilo' },
            { value: 'image', label: 'Imagen' },
          ]}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'style' ? (
          <>
            <Presets />
            <EffectControls />
            <Background />
          </>
        ) : (
          <>
            <TransformTools />
            <Adjustments />
            <Background />
          </>
        )}
      </div>
    </aside>
  );
}
