import { Check, ChevronLeft, Clock, ConciergeBell, Coffee, Hourglass, Plus, X } from 'lucide-react';
import type { Order, TableMenu } from '../../api/types';
import { useI18n } from '../../i18n';
import { displayStatus, itemCount, itemOptions, mmss, placeKey, progress, STEPS, stepIndex, type DisplayStatus } from '../../lib/orderView';
import { Button, IconButton, LangSwitch, StatusBadge } from '../../components/ui';

const RING = 2 * Math.PI * 84;

interface Props {
  menu: TableMenu;
  order: Order;
  orders: Order[];
  now: number;
  canOrderMore: boolean;
  onBack: () => void;
  onSelect: (orderId: string) => void;
  onCallWaiter: () => void;
}

export function TrackScreen({ menu, order, orders, now, canOrderMore, onBack, onSelect, onCallWaiter }: Props) {
  const { t, tp, loc, money, time } = useI18n();
  const status = displayStatus(order, now);
  const step = stepIndex(status);
  const earlier = orders.filter((o) => o.id !== order.id);

  return (
    <div className="flex min-h-dvh animate-rise flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-ivory px-4 pt-5 pb-3">
        <IconButton label={t('guest.backToMenu')} onClick={onBack}>
          <ChevronLeft size={22} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[21px] leading-tight font-medium">{t('common.orderNo', { n: order.number })}</h1>
          <p className="text-[13px] text-stone">{t(placeKey(order.tableKind), { n: order.tableNumber })} · {time(order.createdAt)}</p>
        </div>
        <LangSwitch />
      </header>

      <main className="flex flex-col gap-3.5 px-5 pt-1 pb-32">
        <section className="card flex flex-col items-center gap-3 px-5.5 pt-6.5 pb-6 text-center" aria-live="polite">
          <Hero order={order} status={status} now={now} />
        </section>

        {step >= 0 ? (
          <ol className="card flex items-start px-2.5 pt-4.5 pb-4" aria-label={t(`status.${status}`)}>
            {STEPS.map((key, i) => {
              const done = i < step || (step === 4 && i === 4);
              const current = i === step && !done;
              return (
                <li key={key} className="relative flex flex-1 flex-col items-center gap-2 text-center" aria-current={current ? 'step' : undefined}>
                  {i > 0 ? <span className={`absolute top-[11px] right-1/2 left-[-50%] h-0.5 ${i <= step ? 'bg-(--ac)' : 'bg-[#e3d9cb]'}`} aria-hidden /> : null}
                  <span
                    className={`relative z-[1] flex size-6 items-center justify-center rounded-full border-2 ${
                      done ? 'border-(--ac) bg-(--ac) text-white' : current ? 'border-(--ac) bg-paper shadow-[0_0_0_4px_color-mix(in_srgb,var(--ac)_16%,transparent)]' : 'border-line-strong bg-paper'
                    }`}
                    aria-hidden
                  >
                    {done ? <Check size={13} strokeWidth={3} /> : current ? <span className="size-2 rounded-full bg-(--ac)" /> : null}
                  </span>
                  <span className={`px-0.5 text-[11px] leading-tight ${current ? 'font-semibold text-ink' : 'text-stone'}`}>{t(`status.${key}`)}</span>
                </li>
              );
            })}
          </ol>
        ) : null}

        <section className="card flex flex-col gap-2.5 px-4.5 py-4">
          <div className="flex items-baseline justify-between">
            <h2 className="label">{t('guest.items')}</h2>
            <span className="text-[13px] text-stone">{tp('common.items', itemCount(order))}</span>
          </div>
          <ul className="flex flex-col gap-2">
            {order.items.map((it) => {
              const opts = itemOptions(it, loc);
              return (
                <li key={it.id} className="flex items-baseline gap-2.5 text-sm">
                  <span className="tabular w-[26px] shrink-0 font-bold text-copper-ink">{it.qty}×</span>
                  <span className="flex-1">
                    {loc(it.name)}
                    {opts ? <span className="text-stone"> · {opts}</span> : null}
                    {it.note ? <span className="block text-xs text-copper-ink italic">„{it.note}“</span> : null}
                  </span>
                  <span className="tabular">{money(it.unitPrice * it.qty)}</span>
                </li>
              );
            })}
          </ul>
          {order.note ? <p className="rounded-xl bg-[#f6ecd1] px-3 py-2.5 text-[13px] leading-snug text-[#5c4208]">{order.note}</p> : null}
          <div className="flex justify-between border-t border-hair pt-2.5 font-bold">
            <span>{t('common.total')}</span>
            <span className="tabular">{money(order.total)}</span>
          </div>
        </section>

        {earlier.length ? (
          <section className="flex flex-col gap-2">
            <h2 className="label">{menu.table.kind === 'room' ? t('guest.earlierOrdersRoom') : t('guest.earlierOrders')}</h2>
            {earlier.map((o) => (
              <button key={o.id} type="button" onClick={() => onSelect(o.id)} className="card flex min-h-12 items-center gap-2.5 rounded-[14px] px-3.5 py-3 text-left">
                <span className="text-sm font-semibold">{t('common.orderNo', { n: o.number })}</span>
                <StatusBadge status={displayStatus(o, now)} />
                <span className="tabular ml-auto text-sm">{money(o.total)}</span>
              </button>
            ))}
          </section>
        ) : null}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20">
        <div className="mx-auto flex max-w-[480px] gap-2.5 border-t border-[#e8e0d4] bg-ivory px-4 pt-3 pb-[max(22px,env(safe-area-inset-bottom))]">
          {menu.cafe.callButton && menu.table.kind !== 'room' ? (
            <Button variant="ghost" size="lg" className="min-w-0 flex-1 px-2.5 text-sm" onClick={onCallWaiter}>
              <ConciergeBell size={20} aria-hidden />
              {t('guest.callWaiter')}
            </Button>
          ) : null}
          {canOrderMore ? (
            <Button variant="accent" size="lg" className="min-w-0 flex-1 px-2.5 text-sm" onClick={onBack}>
              <Plus size={20} aria-hidden />
              {t('guest.orderMore')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Hero({ order, status, now }: { order: Order; status: DisplayStatus; now: number }) {
  const { t } = useI18n();
  const title = 'font-serif text-[25px] leading-tight font-medium';
  const body = 'max-w-[300px] text-sm leading-relaxed text-stone';
  const estimate = order.prepMinutes ? t('guest.estimateLine', { m: order.prepMinutes, name: (order.waiterName ?? '').split(' ')[0] }) : '';
  const updated = order.estimateUpdatedAt && now - order.estimateUpdatedAt < 15_000;

  switch (status) {
    case 'pending':
      return (
        <>
          <div className="relative flex size-[132px] items-center justify-center" aria-hidden>
            {[0, 0.9, 1.8].map((d) => (
              <span key={d} className="absolute inset-6 animate-ping-soft rounded-full border-[1.5px] border-(--ac) opacity-0" style={{ animationDelay: `${d}s` }} />
            ))}
            <div className="relative flex size-[84px] items-center justify-center rounded-full bg-tint text-(--ac)">
              <Hourglass size={34} strokeWidth={1.4} />
            </div>
          </div>
          <StatusBadge status="pending" />
          <h2 className={title}>{t('guest.awaitTitle')}</h2>
          <p className={body}>{t('guest.awaitBody')}</p>
          <div className="flex gap-1.5" aria-hidden>
            {[0, 0.15, 0.3].map((d) => (
              <span key={d} className="size-1.5 animate-bob rounded-full bg-(--ac)" style={{ animationDelay: `${d}s` }} />
            ))}
          </div>
        </>
      );
    case 'accepted':
    case 'preparing':
      return (
        <>
          <div className="relative size-[196px]">
            <svg width="196" height="196" viewBox="0 0 200 200" aria-hidden>
              <circle cx="100" cy="100" r="84" fill="none" stroke="#ede4d8" strokeWidth="10" />
              <circle
                cx="100" cy="100" r="84" fill="none" strokeWidth="10" strokeLinecap="round"
                stroke="var(--ac)" strokeDasharray={RING} strokeDashoffset={RING * (1 - progress(order, now))}
                transform="rotate(-90 100 100)" style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
              <span className="tabular font-serif text-[46px] leading-none font-medium" role="timer">{mmss((order.deadline ?? now) - now)}</span>
              <span className="text-xs tracking-wide text-stone">{t('guest.remaining')}</span>
            </div>
          </div>
          <StatusBadge status={status} />
          <h2 className={title}>{status === 'accepted' ? t('guest.acceptedTitle') : t('guest.preparingTitle')}</h2>
          <p className="text-sm text-stone">{estimate}</p>
          {updated ? (
            <p role="status" className="flex animate-rise items-center gap-2 rounded-xl bg-[#e2ebf4] px-3.5 py-2.5 text-[13px] font-semibold text-[#2a5279]">
              <Clock size={16} aria-hidden />
              {t('guest.estimateUpdated')}
            </p>
          ) : null}
        </>
      );
    case 'late':
      return (
        <>
          <div className="relative size-[196px]" aria-hidden>
            <svg width="196" height="196" viewBox="0 0 200 200">
              <circle cx="100" cy="100" r="84" fill="none" stroke="#c77a45" strokeWidth="10" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-[#8a3a12]">
              <Clock size={48} strokeWidth={1.3} />
            </div>
          </div>
          <StatusBadge status="late" />
          <h2 className={title}>{t('guest.delayTitle')}</h2>
          <p className={body}>{t('guest.delayBody')}</p>
        </>
      );
    case 'ready':
      return (
        <>
          <div className="flex size-[84px] animate-pop items-center justify-center rounded-full bg-[#dfede3] text-success" aria-hidden>
            <Check size={40} strokeWidth={2} />
          </div>
          <StatusBadge status="ready" />
          <h2 className={title}>{t('guest.readyTitle')}</h2>
          <p className={body}>{order.tableKind === 'room' ? t('guest.readyBodyRoom') : t('guest.readyBody')}</p>
        </>
      );
    case 'served':
      return (
        <>
          <div className="flex size-[84px] animate-pop items-center justify-center rounded-full bg-espresso text-tint" aria-hidden>
            <Coffee size={38} strokeWidth={1.4} />
          </div>
          <StatusBadge status="served" />
          <h2 className={title}>{t('guest.servedTitle')}</h2>
          <p className={body}>{t('guest.servedBody')}</p>
        </>
      );
    case 'rejected':
      return (
        <>
          <div className="flex size-[84px] animate-pop items-center justify-center rounded-full bg-[#f5deda] text-danger" aria-hidden>
            <X size={36} strokeWidth={2} />
          </div>
          <StatusBadge status="rejected" />
          <h2 className={title}>{t('guest.rejectedTitle')}</h2>
          <p className={body}>{t('guest.rejectedBody')}</p>
          {order.rejectReason ? (
            <p className="w-full rounded-xl border border-[#f0d3cd] bg-[#fbf0ee] px-3.5 py-2.5 text-left text-[13px] text-[#7a2419]">
              <b>{t('guest.reason')}:</b> {t(`reasons.${order.rejectReason}`)}
            </p>
          ) : null}
        </>
      );
  }
}
