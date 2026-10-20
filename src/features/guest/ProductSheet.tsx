import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { CategoryIcon, Product } from '../../api/types';
import { defaultChoices, unitPrice } from '../../api/pricing';
import { useI18n } from '../../i18n';
import { Button, IconButton, ProductTile, QtyStepper } from '../../components/ui';
import { useToast } from '../../components/Toast';

interface Props {
  product: Product;
  icon: CategoryIcon;
  onClose: () => void;
  onAdd: (qty: number, choices: Record<string, string>, note: string) => void;
}

export function ProductSheet({ product, icon, onClose, onAdd }: Props) {
  const { t, loc, money } = useI18n();
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [choices, setChoices] = useState(() => defaultChoices(product));
  const [note, setNote] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const name = loc(product.name);

  useEffect(() => {
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-30 flex flex-col justify-end"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <button type="button" tabIndex={-1} aria-label={t('common.close')} onClick={onClose} className="absolute inset-0 animate-fade cursor-default bg-[rgba(31,24,20,.45)]" />
      <div role="dialog" aria-modal="true" aria-label={name} className="relative mx-auto flex max-h-[90dvh] w-full max-w-[480px] animate-sheet flex-col overflow-hidden rounded-t-[28px] bg-paper">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative h-[210px]">
            <ProductTile icon={icon} imageUrl={product.imageUrl} size="fill" className="rounded-none" />
            <IconButton ref={closeRef} label={t('common.close')} onClick={onClose} className="absolute top-3.5 right-3.5 rounded-full bg-paper hover:bg-paper">
              <X size={20} />
            </IconButton>
          </div>
          <div className="flex flex-col gap-5 px-5 pt-5 pb-2">
            <div className="flex flex-col gap-1.5">
              <h2 className="font-serif text-[26px] leading-tight font-medium">{name}</h2>
              <p className="text-sm leading-relaxed text-stone">{loc(product.description)}</p>
              <span className="tabular mt-0.5 text-base font-semibold">{money(product.price)}</span>
            </div>
            {product.options.map((g) => (
              <fieldset key={g.id} className="flex flex-col gap-2.5">
                <legend className="label mb-2.5">{loc(g.name)}</legend>
                <div className="flex flex-wrap gap-2">
                  {g.choices.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="chip"
                      aria-pressed={choices[g.id] === c.id}
                      onClick={() => setChoices((cur) => ({ ...cur, [g.id]: c.id }))}
                    >
                      {loc(c.name)}
                      {c.price ? <span className="text-xs opacity-70">+{money(c.price)}</span> : null}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
            <label className="flex flex-col gap-2">
              <span className="label">{t('guest.specialRequests')}</span>
              <textarea className="field" rows={2} maxLength={200} placeholder={t('guest.specialPlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 pt-3.5 pb-[max(22px,env(safe-area-inset-bottom))]">
          <QtyStepper value={qty} onChange={setQty} decLabel={t('guest.qtyDecrease')} incLabel={t('guest.qtyIncrease')} />
          <Button
            variant="accent"
            className="h-[50px] flex-1 px-3.5"
            onClick={() => {
              onAdd(qty, choices, note.trim());
              toast(t('guest.addedToCart', { name }));
            }}
          >
            {t('guest.addToCart')} · {money(unitPrice(product, choices) * qty)}
          </Button>
        </div>
      </div>
    </div>
  );
}
