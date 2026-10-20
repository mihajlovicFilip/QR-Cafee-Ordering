import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ComponentPropsWithRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Cake, CakeSlice, Citrus, Coffee, Egg, Leaf, LoaderCircle, Minus, Plus, Wine } from 'lucide-react';
import type { CategoryIcon } from '../api/types';
import type { DisplayStatus } from '../lib/orderView';
import { useI18n } from '../i18n';

// ───────────────────────────────────────────── Button

type Variant = 'primary' | 'accent' | 'ghost' | 'danger' | 'dangerSolid';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-espresso text-paper hover:bg-[#3f2b20]',
  accent: 'bg-(--ac) text-white hover:brightness-[.93]',
  ghost: 'bg-paper text-espresso border border-line-strong hover:bg-[#f5efe6]',
  danger: 'bg-paper text-danger border border-[#e8c9c2] hover:bg-[#fbf0ee]',
  dangerSolid: 'bg-danger text-white hover:bg-[#82261b]',
};
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[13px] rounded-[10px]',
  md: 'h-12 px-5 text-[15px] rounded-[14px]',
  lg: 'h-[52px] px-5 text-base rounded-[14px]',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
}

export function Button({ variant = 'primary', size = 'md', busy = false, className = '', children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition active:scale-[.98] disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function IconButton({ label, className = '', children, ...rest }: ComponentPropsWithRef<'button'> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-[14px] transition hover:bg-sand disabled:opacity-45 ${className}`}
    >
      {children}
    </button>
  );
}

// ───────────────────────────────────────────── Language switch

export function LangSwitch({ dark = false }: { dark?: boolean }) {
  const { lang, languages, setLang, t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t('common.language')}
      className={`inline-flex shrink-0 rounded-full border p-[3px] ${dark ? 'border-white/15 bg-white/8' : 'border-[#e3d9cb] bg-sand'}`}
    >
      {languages.map((l) => {
        const on = l === lang;
        return (
          <button
            key={l}
            type="button"
            lang={l}
            aria-pressed={on}
            onClick={() => setLang(l)}
            className={`h-[30px] min-w-10 rounded-full px-2.5 text-xs font-bold tracking-[.06em] transition ${
              on
                ? dark ? 'bg-ivory text-espresso' : 'bg-paper text-espresso shadow-[0_1px_3px_rgba(43,29,22,.16)]'
                : dark ? 'text-[#d9cdbf] hover:text-white' : 'text-stone hover:text-ink'
            }`}
          >
            {l.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────── Status badge

const STATUS_TONES: Record<DisplayStatus, string> = {
  pending: 'bg-[#f6ecd1] text-[#76540a]',
  accepted: 'bg-[#e2ebf4] text-[#2a5279]',
  preparing: 'bg-[#f4e4d6] text-[#8a4520]',
  late: 'bg-[#f8e0cf] text-[#8a3a12]',
  ready: 'bg-[#dfede3] text-[#2a6142]',
  served: 'bg-[#ece6de] text-[#584f47]',
  rejected: 'bg-[#f5deda] text-[#972f22]',
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap ${STATUS_TONES[status]}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t(`status.${status}`)}
    </span>
  );
}

// ───────────────────────────────────────────── Product tile (photo, or a tonal illustration until one is uploaded)

const ICONS: Record<CategoryIcon, typeof Coffee> = { coffee: Coffee, tea: Leaf, juice: Citrus, breakfast: Egg, dessert: CakeSlice, bar: Wine };
const TONES: Record<CategoryIcon, [bg: string, fg: string, plate: string]> = {
  coffee: ['#e8daca', '#7a5a43', '#f2e8dc'],
  tea: ['#dce2d1', '#4f5e45', '#e8ede0'],
  juice: ['#f1dec2', '#94622a', '#f7ead6'],
  breakfast: ['#eee4cc', '#7c6838', '#f5eedd'],
  dessert: ['#ead7d1', '#86503f', '#f3e6e1'],
  bar: ['#dad4e2', '#57496a', '#e7e2ee'],
};

export function ProductTile({ icon, imageUrl, size = 84, className = 'rounded-[14px]' }: { icon: CategoryIcon; imageUrl?: string | null; size?: number | 'fill'; className?: string }) {
  const style = size === 'fill' ? undefined : { width: size, height: size };
  if (imageUrl) {
    return <img src={imageUrl} alt="" style={style} className={`shrink-0 object-cover ${size === 'fill' ? 'size-full' : ''} ${className}`} />;
  }
  const Icon = ICONS[icon] ?? Cake;
  const [bg, fg, plate] = TONES[icon] ?? TONES.coffee;
  const iconSize = size === 'fill' ? 72 : Math.round(size * 0.4);
  return (
    <div style={{ ...style, background: bg, color: fg }} className={`relative flex shrink-0 items-center justify-center overflow-hidden ${size === 'fill' ? 'size-full' : ''} ${className}`} aria-hidden>
      <div className="absolute aspect-square w-[64%] max-w-[160px] rounded-full" style={{ background: plate }} />
      <Icon className="relative" size={iconSize} strokeWidth={size === 'fill' ? 1.1 : 1.3} />
    </div>
  );
}

// ───────────────────────────────────────────── Quantity stepper

export function QtyStepper({ value, onChange, min = 1, max = 50, small = false, decLabel, incLabel }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; small?: boolean; decLabel: string; incLabel: string;
}) {
  const btn = `flex items-center justify-center bg-tint text-espresso transition hover:bg-[#ecdccb] disabled:opacity-40 ${small ? 'size-[34px] rounded-[9px]' : 'size-10 rounded-[11px]'}`;
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-[14px] border border-line-strong bg-paper p-[3px]">
      <button type="button" className={btn} aria-label={decLabel} disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus size={16} />
      </button>
      <span className="tabular min-w-[30px] text-center font-semibold" aria-live="polite">{value}</span>
      <button type="button" className={btn} aria-label={incLabel} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus size={16} />
      </button>
    </div>
  );
}

// ───────────────────────────────────────────── Dialog

/**
 * Overlays are portalled to <body>, outside the screen that sets the café's `--ac` colour.
 * Render `anchor` in place; `style` carries that colour over to the portal.
 */
export function useInheritedAccent(open: boolean) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [accent, setAccent] = useState('');
  useLayoutEffect(() => {
    if (open && anchor.current) setAccent(getComputedStyle(anchor.current).getPropertyValue('--ac').trim());
  }, [open]);
  return { anchor, style: (accent ? { '--ac': accent } : undefined) as CSSProperties | undefined };
}

export function Dialog({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const { anchor, style } = useInheritedAccent(open);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus], button')?.focus();
    return () => prev?.focus?.();
  }, [open]);
  const overlay = open ? (
    <div
      style={style}
      className="fixed inset-0 z-40 flex items-end justify-center p-4 sm:items-center"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation(); // a dialog opened from a drawer closes alone
          onClose();
        }
      }}
    >
      <button type="button" tabIndex={-1} aria-label={t('common.close')} onClick={onClose} className="absolute inset-0 animate-fade cursor-default bg-[rgba(31,24,20,.45)]" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-[calc(100dvh-32px)] w-full animate-pop flex-col gap-3.5 overflow-y-auto rounded-[22px] bg-paper p-6 shadow-[0_30px_70px_-24px_rgba(31,24,20,.5)] ${wide ? 'max-w-[560px]' : 'max-w-[420px]'}`}
      >
        {children}
      </div>
    </div>
  ) : null;
  // Portal: an animated ancestor (transform) would otherwise become the containing block of `fixed`.
  return (
    <>
      <span ref={anchor} hidden />
      {overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}

// ───────────────────────────────────────────── Switch

export function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${checked ? 'bg-success' : 'bg-[#cfc4b5]'}`}
    >
      <span className={`absolute left-1 size-5 rounded-full bg-white shadow-[0_1px_3px_rgba(31,24,20,.3)] transition-transform ${checked ? 'translate-x-5' : ''}`} aria-hidden />
    </button>
  );
}

// ───────────────────────────────────────────── Full-screen states

export function CenterState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-[60dvh] animate-rise flex-col items-center justify-center gap-3 px-8 py-16 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-tint text-copper-ink">{icon}</div>
      <h2 className="font-serif text-2xl font-medium">{title}</h2>
      {body ? <p className="max-w-sm text-[15px] leading-relaxed text-stone">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-stone" role="status">
      <LoaderCircle className="size-7 animate-spin text-copper" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}
