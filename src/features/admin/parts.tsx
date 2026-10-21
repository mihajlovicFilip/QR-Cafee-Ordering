/** Building blocks of the admin screens — localized inputs, page header, dialogs and the drawer. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Languages, X } from 'lucide-react';
import type { Localized, Product } from '../../api/types';
import { useI18n } from '../../i18n';
import { Button, Dialog, IconButton, useInheritedAccent } from '../../components/ui';

// === Translations =============================================

/** Languages still empty when at least one other language has text. Empty everywhere = nothing to translate. */
export function missingLangs(field: Localized | null | undefined, languages: string[]): string[] {
  const has = (l: string) => !!field?.[l]?.trim();
  return languages.some(has) ? languages.filter((l) => !has(l)) : [];
}

export function productMissingLangs(p: Pick<Product, 'name' | 'description' | 'options'>, languages: string[]): string[] {
  const fields: (Localized | undefined)[] = [p.name, p.description];
  for (const g of p.options) {
    fields.push(g.name);
    for (const c of g.choices) fields.push(c.name);
  }
  const out = new Set<string>();
  for (const f of fields) missingLangs(f, languages).forEach((l) => out.add(l));
  return languages.filter((l) => out.has(l));
}

export function MissingBadge({ langs }: { langs: string[] }) {
  const { t } = useI18n();
  if (!langs.length) return null;
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full bg-[#f6ecd1] px-2 text-[11px] font-semibold tracking-normal text-[#76540a] normal-case">
      <Languages size={12} aria-hidden />
      {t('admin.missingTranslation', { langs: langs.map((l) => l.toUpperCase()).join(', ') })}
    </span>
  );
}

/** One input per language, side by side, with a warning when a translation is missing. */
export function LocalizedInput({ label, value, onChange, multiline = false, maxLength, required = false, autoFocus = false }: {
  label: string;
  value: Localized;
  onChange: (next: Localized) => void;
  multiline?: boolean;
  maxLength: number;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const { languages, t } = useI18n();
  const missing = missingLangs(value, languages);
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 flex flex-wrap items-center gap-2">
        <span className="label">{label}</span>
        {!required ? <span className="text-[11px] text-stone">{t('admin.optional')}</span> : null}
        <MissingBadge langs={missing} />
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {languages.map((l, i) => {
          const common = {
            lang: l,
            value: value[l] ?? '',
            maxLength,
            'aria-label': `${label} (${l.toUpperCase()})`,
            'data-autofocus': autoFocus && i === 0 ? true : undefined,
            className: `field pl-11 ${missing.includes(l) ? 'border-[#e0c48a] bg-[#fffaf0]' : ''}`,
            onChange: (e: { target: { value: string } }) => onChange({ ...value, [l]: e.target.value }),
          };
          return (
            <label key={l} className="relative block">
              <span className="pointer-events-none absolute top-[14px] left-3.5 text-[11px] font-bold tracking-[.06em] text-stone" aria-hidden>{l.toUpperCase()}</span>
              {multiline ? <textarea rows={3} {...common} /> : <input type="text" {...common} />}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// === Layout =============================================

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="font-serif text-[32px] leading-tight font-medium tracking-[-0.01em]">{title}</h1>
        {subtitle ? <p className="max-w-[640px] text-[15px] leading-relaxed text-stone">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-2 ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="text-[13px] leading-snug text-stone">{hint}</span> : null}
    </label>
  );
}

export function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return <p role="alert" className="rounded-xl bg-[#f5deda] px-3.5 py-2.5 text-[13px] font-semibold text-danger">{text}</p>;
}

// === Dialogs =============================================

export function ConfirmDialog({ open, title, body, confirmLabel, danger = false, onConfirm, onClose }: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <h2 className="font-serif text-2xl leading-tight font-medium">{title}</h2>
      <p className="text-sm leading-relaxed text-stone-dark">{body}</p>
      <div className="mt-2 flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant={danger ? 'dangerSolid' : 'primary'}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

/** Right-hand panel for longer forms (product editor). */
export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const { anchor, style } = useInheritedAccent(open);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus], input, button')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open]);
  const panel = open ? (
    <div style={style} className="fixed inset-0 z-40 flex justify-end" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <button type="button" tabIndex={-1} aria-label={t('common.close')} onClick={onClose} className="absolute inset-0 animate-fade cursor-default bg-[rgba(31,24,20,.4)]" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="relative flex h-full w-full max-w-[680px] animate-rise flex-col bg-ivory shadow-[-30px_0_70px_-30px_rgba(31,24,20,.45)]">
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <h2 className="flex-1 truncate font-serif text-[22px] font-medium">{title}</h2>
          <IconButton label={t('common.close')} onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        <div className="flex flex-wrap items-center gap-2.5 border-t border-line bg-paper px-6 py-4">{footer}</div>
      </div>
    </div>
  ) : null;
  return (
    <>
      <span ref={anchor} hidden />
      {panel ? createPortal(panel, document.body) : null}
    </>
  );
}

/** Sets the browser tab title for an admin page. */
export function useAdminTitle(page: string, cafeName: string) {
  useEffect(() => {
    document.title = `${page} · ${cafeName}`;
  }, [page, cafeName]);
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
