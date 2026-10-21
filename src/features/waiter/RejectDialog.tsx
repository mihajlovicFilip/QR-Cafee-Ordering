/** Rejecting an order — the guest sees the chosen reason right away. */

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Order } from '../../api/types';
import { useI18n } from '../../i18n';
import { placeKey } from '../../lib/orderView';
import { Button, Dialog } from '../../components/ui';

const REASONS = ['unavailable', 'kitchen_closing', 'duplicate'] as const;

export function RejectDialog({ order, onClose, onConfirm }: { order: Order | null; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const { t } = useI18n();
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (order) setReason(REASONS[0]);
  }, [order]);

  return (
    <Dialog open={!!order} onClose={() => !busy && onClose()} title={t('waiter.rejectTitle')}>
      <div className="flex size-12 items-center justify-center rounded-full bg-[#f5deda] text-danger">
        <X size={22} aria-hidden />
      </div>
      <div>
        <h2 className="font-serif text-2xl font-medium">{t('waiter.rejectTitle')}</h2>
        {order ? <p className="mt-1 text-sm text-stone">{t(placeKey(order.tableKind), { n: order.tableNumber })} · #{order.number}</p> : null}
      </div>
      <p className="text-sm leading-relaxed text-stone-dark">{t('waiter.rejectBody')}</p>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('guest.reason')}>
        {REASONS.map((r) => {
          const on = reason === r;
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setReason(r)}
              className={`flex items-center gap-3 rounded-[14px] border bg-paper p-3.5 text-left text-sm font-medium transition ${on ? 'border-espresso shadow-[0_0_0_1px_#2b1d16]' : 'border-line-strong'}`}
            >
              <span className={`flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-espresso' : 'border-[#c9bcaa]'}`} aria-hidden>
                {on ? <span className="size-2 rounded-full bg-espresso" /> : null}
              </span>
              {t(`reasons.${r}`)}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex gap-2.5">
        <Button variant="ghost" className="flex-1" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="dangerSolid"
          className="flex-[1.4]"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm(reason);
            setBusy(false);
          }}
        >
          {t('waiter.rejectConfirm')}
        </Button>
      </div>
    </Dialog>
  );
}
