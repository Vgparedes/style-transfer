import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Dices } from 'lucide-react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line">
      <div className="flex h-9 items-center px-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-2 hover:text-ink"
        >
          <ChevronDown size={12} className={cx('transition-transform', !open && '-rotate-90')} />
          {title}
        </button>
        {right}
      </div>
      {open && <div className="space-y-3 px-3 pb-3.5">{children}</div>}
    </section>
  );
}

function decimals(step: number) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const fill = ((value - min) / (max - min)) * 100;
  const d = decimals(step);
  const commitText = () => {
    if (text === null) return;
    const v = parseFloat(text.replace(',', '.'));
    if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
    setText(null);
  };
  return (
    <div title={hint}>
      <div className="mb-0.5 flex items-center justify-between">
        <label className="text-ink-2">{label}</label>
        <div className="flex items-center gap-0.5 font-mono text-[11px] text-ink">
          <input
            type="number"
            className="w-12 rounded bg-transparent px-1 py-0.5 text-right outline-none hover:bg-panel-2 focus:bg-panel-2 focus:ring-1 focus:ring-accent"
            value={text ?? value.toFixed(d)}
            step={step}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setText(null);
            }}
          />
          {unit && <span className="text-ink-3">{unit}</span>}
        </div>
      </div>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label?: string;
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  return (
    <div>
      {label && <div className="mb-1 text-ink-2">{label}</div>}
      <div className="flex rounded-md bg-app p-0.5 ring-1 ring-line">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex h-6 flex-1 items-center justify-center gap-1 rounded px-1.5 text-[11px] font-medium transition-colors',
              value === o.value ? 'bg-panel-2 text-ink shadow-sm ring-1 ring-line-2' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-[11px] leading-snug text-ink-3">{hint}</p>}
    </div>
  );
}

export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-ink-2">{label}</div>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-full appearance-none rounded-md bg-app pr-7 pl-2 text-[12px] text-ink ring-1 ring-line outline-none hover:ring-line-2 focus:ring-accent"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={12} className="pointer-events-none absolute top-2 right-2 text-ink-3" />
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2" title={hint}>
      <span className="text-ink-2">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx('relative h-[18px] w-8 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-2')}
      >
        <span
          className={cx(
            'absolute top-[2px] left-0 h-[14px] w-[14px] rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[16px]' : 'translate-x-[2px]',
          )}
        />
      </button>
    </label>
  );
}

const SWATCHES = ['#111111', '#ffffff', '#1d2b53', '#7a1f1f', '#2f5d3a', '#b0663a', '#e8c547', '#4f8bff'];

export function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = (v: string) => {
    const m = v.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      onChange('#' + h.toLowerCase());
    } else setText(value);
  };
  return (
    <div>
      <div className="mb-1 text-ink-2">{label}</div>
      <div className="flex items-center gap-2">
        <input type="color" className="swatch shrink-0" value={value} onChange={(e) => onChange(e.target.value)} />
        <input
          className="h-6 w-[74px] rounded bg-app px-1.5 font-mono text-[11px] uppercase ring-1 ring-line outline-none focus:ring-accent"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="flex flex-wrap gap-1">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => onChange(c)}
              className={cx('h-3.5 w-3.5 rounded-sm ring-1 ring-white/15', value === c && 'ring-2 ring-accent')}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SeedInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-2">{label}</span>
      <button
        type="button"
        onClick={() => onChange(((value * 7919 + 104729) % 99991) + 1)}
        className="flex h-6 items-center gap-1.5 rounded-md bg-app px-2 font-mono text-[11px] ring-1 ring-line hover:ring-line-2"
      >
        <Dices size={13} /> #{value}
      </button>
    </div>
  );
}

export function IconButton({
  children,
  title,
  onClick,
  disabled,
  active,
  className,
}: {
  children: ReactNode;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-ink-2 transition-colors hover:bg-panel-2 hover:text-ink disabled:pointer-events-none disabled:opacity-35',
        active && 'bg-panel-2 text-ink ring-1 ring-line-2',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Ejecuta `fn` cuando cambia `deps`, como mucho una vez por frame. */
export function useRafCallback<T extends unknown[]>(fn: (...args: T) => void) {
  const ref = useRef<number | null>(null);
  const args = useRef<T | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return (...a: T) => {
    args.current = a;
    if (ref.current !== null) return;
    ref.current = requestAnimationFrame(() => {
      ref.current = null;
      if (args.current) fnRef.current(...args.current);
    });
  };
}
