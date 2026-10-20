import { useState } from 'react';
import { BedDouble, Check, MessageSquare, X } from 'lucide-react';
import type { Order } from '../../api/types';
import { useI18n } from '../../i18n';
import { displayStatus, itemCount, itemOptions, minutesSince, mmss, placeKey, progress } from '../../lib/orderView';
import { Button, StatusBadge } from '../../components/ui';

const QUICK_MINUTES = [3, 5, 10, 15];

function useAgo(ts: number, now: number) {
  const { t } = useI18n();
  const m = minutesSince(ts, now);
  return m < 1 ? t('common.justNow') : t('common.minAgo', { n: m });
}

function CardHeader({ order, now }: { order: Order; now: number }) {
  const { t } = useI18n();
  const ago = useAgo(order.createdAt, now);
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="font-serif text-[26px] leading-none font-semibold">{t(placeKey(order.tableKind), { n: order.tableNumber })}</h2>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-stone">
          #{order.number} · {ago}
          {order.tableKind === 'room' ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold text-copper-ink">
              <BedDouble size={12} aria-hidden />
              {t('waiter.roomService')}
            </span>
          ) : null}
        </p>
      </div>
      <StatusBadge status={displayStatus(order, now)} />
    </div>
  );
}

export function NewOrderCard({ order, now, onAccept, onReject }: {
  order: Order; now: number; onAccept: (minutes: number) => Promise<void>; onReject: () => void;
}) {
  const { t, tp, loc, money } = useI18n();
  const [minutes, setMinutes] = useState(5);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = custom ? Number(custom) : minutes;
  const valid = Number.isInteger(chosen) && chosen >= 1 && chosen <= 180;
  const fresh = now - order.createdAt < 10_000;

  async function accept() {
    if (!valid || busy) return;
    setBusy(true);
    await onAccept(chosen);
    setBusy(false);
  }

  return (
    <article className={`card flex animate-rise flex-col gap-3.5 p-4.5 ${fresh ? 'animate-glow' : ''}`} aria-label={t(placeKey(order.tableKind), { n: order.tableNumber })}>
      <CardHeader order={order} now={now} />
      <ul className="flex flex-col gap-2 text-sm">
        {order.items.map((it) => {
          const opts = itemOptions(it, loc);
          return (
            <li key={it.id} className="flex items-baseline gap-2.5">
              <span className="tabular w-[26px] shrink-0 font-bold text-copper-ink">{it.qty}×</span>
              <span className="flex-1">
                {loc(it.name)}
                {opts ? <span className="text-stone"> · {opts}</span> : null}
                {it.note ? <span className="block text-xs text-copper-ink italic">„{it.note}“</span> : null}
              </span>
              <span className="tabular text-stone-dark">{money(it.unitPrice * it.qty)}</span>
            </li>
          );
        })}
      </ul>
      {order.note ? (
        <p className="flex items-start gap-2 rounded-xl bg-[#f6ecd1] px-3 py-2.5 text-[13px] leading-snug text-[#5c4208]">
          <MessageSquare size={16} className="mt-px shrink-0" aria-hidden />
          {order.note}
        </p>
      ) : null}
      <div className="flex justify-between border-t border-hair pt-3 text-sm">
        <span className="text-stone">{tp('common.items', itemCount(order))}</span>
        <span className="tabular text-base font-bold">{money(order.total)}</span>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-2">{t('waiter.prepTime')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              className="chip chip-sm"
              aria-pressed={!custom && minutes === m}
              onClick={() => {
                setMinutes(m);
                setCustom('');
              }}
            >
              {t('common.minutes', { n: m })}
            </button>
          ))}
          <label className={`inline-flex h-9 items-center gap-1 rounded-full border bg-paper px-3 text-[13px] text-stone focus-within:border-solid focus-within:border-espresso ${custom ? 'border-solid border-espresso' : 'border-dashed border-[#c9bcaa]'}`}>
            <input
              inputMode="numeric"
              maxLength={3}
              placeholder={t('waiter.custom')}
              aria-label={t('waiter.customAria')}
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 3))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void accept();
              }}
              className="w-12 bg-transparent text-[13px] font-semibold text-ink outline-none"
            />
            <span aria-hidden>min</span>
          </label>
        </div>
      </fieldset>
      <div className="flex gap-2.5">
        <Button variant="danger" onClick={onReject} disabled={busy}>
          <X size={16} aria-hidden />
          {t('waiter.reject')}
        </Button>
        <Button className="flex-1" onClick={accept} busy={busy} disabled={!valid}>
          {!busy ? <Check size={16} aria-hidden /> : null}
          {t('waiter.accept', { m: valid ? chosen : '–' })}
        </Button>
      </div>
    </article>
  );
}

export function ActiveOrderCard({ order, now, mine, onExtend, onReady, onServed }: {
  order: Order; now: number; mine: boolean;
  onExtend: (minutes: number) => Promise<void>; onReady: () => Promise<void>; onServed: () => Promise<void>;
}) {
  const { t, loc, time } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const status = displayStatus(order, now);
  const late = status === 'late';
  const preparing = order.status === 'preparing';
  const initials = (order.waiterName ?? '?').split(' ').map((w) => w[0]).join('').slice(0, 2);
  const run = (id: string, fn: () => Promise<void>) => async () => {
    setBusy(id);
    await fn();
    setBusy(null);
  };

  return (
    <article className={`card flex animate-rise flex-col gap-3.5 p-4.5 ${mine ? '' : 'bg-[#faf6f0]'}`}>
      <CardHeader order={order} now={now} />
      <p className="flex items-center gap-2 text-[13px] text-stone-dark">
        <span className={`flex size-[26px] items-center justify-center rounded-full text-[11px] font-bold ${mine ? 'bg-espresso text-paper' : 'bg-[#e2ebf4] text-[#2a5279]'}`} aria-hidden>
          {initials}
        </span>
        {mine ? `${t('waiter.claimMine')} (${(order.waiterName ?? '').split(' ')[0]})` : t('waiter.claimOther', { name: order.waiterName ?? '—' })}
      </p>
      {preparing ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className={late ? 'text-xl font-bold text-[#8a3a12]' : 'tabular font-serif text-[30px] leading-none font-medium'} role="timer">
              {late ? t('waiter.overdue', { n: Math.max(1, Math.ceil((now - (order.deadline ?? now)) / 60_000)) }) : mmss((order.deadline ?? now) - now)}
            </span>
            <span className="text-[13px] text-stone">{t('waiter.ofMinutes', { m: order.prepMinutes ?? 0 })}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#ede4d8]">
            <div className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${late ? 'bg-[#c77a45]' : 'bg-(--ac)'}`} style={{ width: `${Math.round(progress(order, now) * 100)}%` }} />
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm font-semibold text-success">
          <Check size={16} aria-hidden />
          {t('waiter.readySince', { t: time(order.readyAt ?? now) })}
        </p>
      )}
      <p className="text-sm leading-normal text-stone-dark">
        {order.items.map((it) => {
          const opts = itemOptions(it, loc);
          return `${it.qty}× ${loc(it.name)}${opts ? ` (${opts})` : ''}`;
        }).join(', ')}
      </p>
      <div className="flex flex-wrap items-center gap-2 border-t border-hair pt-3">
        {preparing ? (
          <>
            {[2, 5].map((m) => (
              <Button key={m} variant="ghost" size="sm" aria-label={t('waiter.addMinutes', { m })} busy={busy === `+${m}`} disabled={!!busy} onClick={run(`+${m}`, () => onExtend(m))}>
                +{m} min
              </Button>
            ))}
            <Button size="sm" className="ml-auto" busy={busy === 'ready'} disabled={!!busy} onClick={run('ready', onReady)}>
              {busy !== 'ready' ? <Check size={16} aria-hidden /> : null}
              {t('waiter.markReady')}
            </Button>
          </>
        ) : (
          <Button variant="accent" size="sm" className="ml-auto" busy={busy === 'served'} disabled={!!busy} onClick={run('served', onServed)}>
            {busy !== 'served' ? <Check size={16} aria-hidden /> : null}
            {t('waiter.markServed')}
          </Button>
        )}
      </div>
    </article>
  );
}
