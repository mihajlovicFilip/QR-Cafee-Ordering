import { useState } from 'react';
import { ChevronLeft, ConciergeBell, ShoppingBag, Trash } from 'lucide-react';
import type { TableMenu } from '../../api/types';
import { useI18n } from '../../i18n';
import { placeKey } from '../../lib/orderView';
import { Button, Dialog, IconButton, LangSwitch, ProductTile, QtyStepper } from '../../components/ui';
import type { Cart } from './useCart';

interface Props {
  menu: TableMenu;
  cart: Cart;
  submitting: boolean;
  onBack: () => void;
  onSubmit: (note: string) => Promise<boolean>;
}

export function CartScreen({ menu, cart, submitting, onBack, onSubmit }: Props) {
  const { t, tp, loc, money } = useI18n();
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const iconFor = (categoryId: string | null) => menu.categories.find((c) => c.id === categoryId)?.icon ?? 'coffee';
  const tableLabel = t(placeKey(menu.table.kind), { n: menu.table.number });

  return (
    <div className="flex min-h-dvh animate-rise flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-ivory px-4 pt-5 pb-3">
        <IconButton label={t('guest.backToMenu')} onClick={onBack}>
          <ChevronLeft size={22} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[22px] leading-tight font-medium">{t('guest.yourCart')}</h1>
          <p className="truncate text-[13px] text-stone">{menu.cafe.name} · {tableLabel}</p>
        </div>
        <LangSwitch />
      </header>

      {cart.count === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 pb-24 text-center">
          <div className="flex size-[88px] items-center justify-center rounded-full bg-tint text-copper-ink">
            <ShoppingBag size={36} strokeWidth={1.4} aria-hidden />
          </div>
          <h2 className="font-serif text-2xl font-medium">{t('guest.emptyCart')}</h2>
          <p className="text-sm leading-relaxed text-stone">{t('guest.emptyCartHint')}</p>
          <Button variant="accent" className="mt-2" onClick={onBack}>{t('guest.backToMenu')}</Button>
        </div>
      ) : (
        <>
          <main className="flex flex-col gap-4.5 px-5 pt-1 pb-32">
            {cart.hasDropped ? (
              <p role="status" className="rounded-xl bg-[#f6ecd1] px-3.5 py-2.5 text-[13px] text-[#5c4208]">
                {t('guest.cartItemGone')}
              </p>
            ) : null}
            <ul className="card divide-y divide-hair px-4">
              {cart.lines.map((l) => {
                const name = loc(l.product.name);
                const opts = l.product.options
                  .map((g) => g.choices.find((c) => c.id === l.choices[g.id]))
                  .filter((c) => c && !c.quiet)
                  .map((c) => loc(c!.name))
                  .join(' · ');
                return (
                  <li key={l.key} className="flex gap-3 py-4">
                    <ProductTile icon={iconFor(l.product.categoryId)} imageUrl={l.product.imageUrl} size={56} className="rounded-xl" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex justify-between gap-2">
                        <span className="text-[15px] font-semibold">{name}</span>
                        <span className="tabular text-sm font-semibold whitespace-nowrap">{money(l.total)}</span>
                      </div>
                      {opts ? <span className="text-[13px] text-stone">{opts}</span> : null}
                      {l.note ? <span className="text-[13px] text-copper-ink italic">„{l.note}“</span> : null}
                      <div className="mt-2 flex items-center justify-between">
                        <QtyStepper
                          small
                          value={l.qty}
                          min={1}
                          onChange={(v) => cart.setQty(l.key, v)}
                          decLabel={t('guest.qtyDecreaseFor', { name })}
                          incLabel={t('guest.qtyIncreaseFor', { name })}
                        />
                        <button type="button" onClick={() => cart.remove(l.key)} className="flex h-10 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-semibold text-danger hover:bg-[#fbf0ee]">
                          <Trash size={16} aria-hidden />
                          {t('guest.remove')}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <label className="flex flex-col gap-2">
              <span className="label">{t('guest.orderNote')}</span>
              <textarea className="field" rows={2} maxLength={300} placeholder={t('guest.orderNotePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="card flex flex-col gap-2 px-4.5 py-4">
              <div className="flex justify-between text-sm text-stone">
                <span>{tp('common.items', cart.count)}</span>
                <span>{tableLabel}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{t('common.total')}</span>
                <span className="tabular font-serif text-[26px] font-medium">{money(cart.total)}</span>
              </div>
              <p className="text-xs text-stone">{menu.table.kind === 'room' ? t('guest.payInRoom') : t('guest.payAtTable')}</p>
            </div>
          </main>
          <div className="fixed inset-x-0 bottom-0 z-20">
            <div className="mx-auto max-w-[480px] border-t border-[#e8e0d4] bg-ivory px-4 pt-3 pb-[max(22px,env(safe-area-inset-bottom))]">
              <Button variant="accent" className="h-[54px] w-full text-base" onClick={() => setConfirming(true)}>
                {t('guest.placeOrder')} · {money(cart.total)}
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={confirming} onClose={() => !submitting && setConfirming(false)} title={t('guest.confirmTitle')}>
        <div className="flex size-[52px] items-center justify-center rounded-full bg-tint text-copper-ink">
          <ConciergeBell size={24} aria-hidden />
        </div>
        <h2 className="font-serif text-2xl font-medium">{t('guest.confirmTitle')}</h2>
        <p className="text-sm leading-relaxed text-stone">{t('guest.confirmBody')}</p>
        <div className="flex items-baseline justify-between rounded-xl bg-ivory px-3.5 py-3">
          <span className="text-sm text-stone-dark">{tp('common.items', cart.count)} · {tableLabel}</span>
          <span className="tabular font-bold">{money(cart.total)}</span>
        </div>
        <Button
          variant="accent"
          size="lg"
          busy={submitting}
          data-autofocus
          onClick={async () => {
            if (await onSubmit(note.trim())) setConfirming(false);
          }}
        >
          {submitting ? t('guest.sending') : t('guest.confirmSend')}
        </Button>
        <Button variant="ghost" disabled={submitting} onClick={() => setConfirming(false)}>
          {t('common.cancel')}
        </Button>
      </Dialog>
    </div>
  );
}
