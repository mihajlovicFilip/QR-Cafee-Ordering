import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ClipboardList, Hourglass, ReceiptText, Timer } from 'lucide-react';
import { backend, type Order, type StaffSession } from '../../api';
import { useI18n } from '../../i18n';
import { useLive, useNow } from '../../lib/hooks';
import { displayStatus, minutesSince, placeKey } from '../../lib/orderView';
import { describeError } from '../../lib/errors';
import { Button, Spinner, StatusBadge } from '../../components/ui';
import { PageHeader, useAdminTitle } from './parts';

const startOfToday = () => new Date().setHours(0, 0, 0, 0);

export function Overview({ session }: { session: StaffSession }) {
  const { t, tp, loc, money, time } = useI18n();
  const now = useNow(30_000);
  const cafeId = session.cafe.id;
  useAdminTitle(t('admin.nav.overview'), session.cafe.name);

  const live = useLive(() => backend.adminOrders(cafeId, startOfToday()), (cb) => backend.subscribeCafe(cafeId, cb), [cafeId], 30_000);
  const orders = useMemo(() => live.data ?? [], [live.data]);
  const stats = useMemo(() => summarize(orders, now), [orders, now]);

  const date = new Intl.DateTimeFormat(t('meta.locale'), { weekday: 'long', day: 'numeric', month: 'long' }).format(now);

  if (!live.data) {
    if (live.error) {
      return (
        <div className="flex flex-col items-start gap-3">
          <PageHeader title={t('admin.nav.overview')} />
          <p className="text-sm text-danger">{describeError(t, live.error)}</p>
          <Button variant="ghost" size="sm" onClick={() => void live.refresh()}>{t('common.retry')}</Button>
        </div>
      );
    }
    return <Spinner label={t('common.loading')} />;
  }

  const oldestPending = stats.pending.length ? minutesSince(Math.min(...stats.pending.map((o) => o.createdAt)), now) : null;

  return (
    <div className="flex animate-rise flex-col gap-7">
      <PageHeader
        title={t('admin.overview.title', { name: session.name.split(' ')[0] })}
        subtitle={t('admin.overview.subtitle', { date })}
        actions={
          <Link to="/waiter" className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line-strong bg-paper px-3.5 text-[13px] font-semibold text-espresso no-underline transition hover:bg-[#f5efe6]">
            {t('admin.overview.openWaiter')}
            <ArrowRight size={14} aria-hidden />
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={<ClipboardList size={18} />}
          label={t('admin.overview.kpiActive')}
          value={String(stats.active.length)}
          sub={tp('admin.overview.kpiActiveSub', stats.ready)}
        />
        <Kpi
          icon={<ReceiptText size={18} />}
          label={t('admin.overview.kpiToday')}
          value={String(stats.accepted.length)}
          sub={[t('admin.overview.kpiTodaySub', { amount: money(stats.revenue) }), stats.roomOrders ? t('admin.overview.roomServiceCount', { n: stats.roomOrders }) : ''].filter(Boolean).join(' · ')}
        />
        <Kpi
          icon={<Hourglass size={18} />}
          label={t('admin.overview.kpiPending')}
          value={String(stats.pending.length)}
          sub={oldestPending === null ? t('admin.overview.kpiPendingNone') : t('admin.overview.kpiPendingSub', { n: oldestPending })}
          tone={stats.pending.length ? 'warn' : undefined}
        />
        <Kpi
          icon={<Timer size={18} />}
          label={t('admin.overview.kpiPrep')}
          value={stats.avgPrep === null ? '—' : stats.avgPrep.toLocaleString(t('meta.locale'), { maximumFractionDigits: 1 })}
          unit={stats.avgPrep === null ? undefined : t('admin.overview.minUnit')}
          sub={stats.prepCount ? tp('admin.overview.kpiPrepSub', stats.prepCount) : t('admin.overview.kpiPrepNone')}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="card flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="by-hour">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="by-hour" className="font-serif text-xl font-medium">{t('admin.overview.byHour')}</h2>
            <span className="text-[13px] text-stone">{tp('admin.overview.ordersCount', stats.accepted.length + stats.rejected)}</span>
          </div>
          <HourBars buckets={stats.byHour} currentHour={new Date(now).getHours()} />
        </section>

        <section className="card flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="top-sellers">
          <h2 id="top-sellers" className="font-serif text-xl font-medium">{t('admin.overview.topSellers')}</h2>
          {stats.top.length ? (
            <ol className="flex flex-col gap-3">
              {stats.top.map((p, i) => (
                <li key={p.key} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline gap-2.5 text-sm">
                    <span className="tabular w-4 text-stone">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{loc(p.name)}</span>
                    <span className="tabular text-stone">{t('admin.overview.qty', { n: p.qty })}</span>
                    <span className="tabular w-[92px] text-right font-semibold">{money(p.revenue)}</span>
                  </div>
                  <div className="ml-6.5 h-1.5 overflow-hidden rounded-full bg-sand" aria-hidden>
                    <div className="h-full rounded-full bg-(--ac)" style={{ width: `${Math.max(4, (p.qty / stats.top[0].qty) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-6 text-center text-sm text-stone">{t('admin.overview.noData')}</p>
          )}
        </section>
      </div>

      <section className="card overflow-hidden" aria-labelledby="recent">
        <div className="flex items-baseline justify-between gap-3 px-5 pt-5 pb-3 sm:px-6">
          <h2 id="recent" className="font-serif text-xl font-medium">{t('admin.overview.recent')}</h2>
        </div>
        {orders.length ? (
          <ul>
            {orders.slice(0, 8).map((o) => (
              <li key={o.id} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 border-t border-hair px-5 py-3 text-sm sm:grid-cols-[56px_64px_70px_minmax(0,1fr)_100px_180px] sm:px-6">
                <span className="tabular text-stone">{time(o.createdAt)}</span>
                <span className="tabular hidden text-stone sm:block">#{o.number}</span>
                <span className="hidden font-semibold sm:block">{t(placeKey(o.tableKind), { n: o.tableNumber })}</span>
                <span className="truncate">
                  <span className="font-semibold sm:hidden">{t(placeKey(o.tableKind), { n: o.tableNumber })} · </span>
                  {o.items.map((i) => `${i.qty}× ${loc(i.name)}`).join(', ')}
                </span>
                <span className="tabular hidden text-right font-semibold sm:block">{money(o.total)}</span>
                <span className="justify-self-end"><StatusBadge status={displayStatus(o, now)} /></span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-hair px-6 py-10 text-center text-sm text-stone">{t('admin.overview.noData')}</p>
        )}
      </section>
    </div>
  );
}

function Kpi({ icon, label, value, unit, sub, tone }: { icon: ReactNode; label: string; value: string; unit?: string; sub: string; tone?: 'warn' }) {
  return (
    <div className="card flex flex-col gap-2.5 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-stone">{label}</span>
        <span className={`flex size-9 items-center justify-center rounded-[10px] ${tone === 'warn' ? 'bg-[#f6ecd1] text-[#76540a]' : 'bg-tint text-copper-ink'}`} aria-hidden>{icon}</span>
      </div>
      <p className="tabular font-serif text-[40px] leading-none font-medium">
        {value}
        {unit ? <span className="ml-1.5 text-xl text-stone">{unit}</span> : null}
      </p>
      <p className="text-[13px] text-stone">{sub}</p>
    </div>
  );
}

function HourBars({ buckets, currentHour }: { buckets: { hour: number; count: number }[]; currentHour: number }) {
  const { t, tp } = useI18n();
  const max = Math.max(1, ...buckets.map((b) => b.count));
  if (!buckets.some((b) => b.count)) return <p className="py-14 text-center text-sm text-stone">{t('admin.overview.noData')}</p>;
  return (
    <ul className="flex h-[200px] items-stretch gap-1.5 pt-2 sm:gap-2" aria-label={t('admin.overview.byHour')}>
      {buckets.map((b) => {
        const label = `${String(b.hour).padStart(2, '0')}:00 — ${tp('admin.overview.ordersCount', b.count)}`;
        return (
          <li key={b.hour} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" aria-label={label} title={label}>
            <div className="flex w-full flex-1 flex-col justify-end">
              {b.count ? <span className="tabular mb-1 block text-center text-[11px] font-semibold text-stone-dark" aria-hidden>{b.count}</span> : null}
              <div
                className={`w-full rounded-t-[5px] rounded-b-[2px] ${b.hour === currentHour ? 'bg-(--ac)' : 'bg-[#e3d6c4]'}`}
                style={{ height: `${b.count ? Math.max(4, (b.count / max) * 100) : 0}%`, minHeight: b.count ? 6 : 2 }}
                aria-hidden
              />
            </div>
            <span className="tabular text-[11px] text-stone" aria-hidden>{String(b.hour).padStart(2, '0')}</span>
          </li>
        );
      })}
    </ul>
  );
}

interface Seller {
  key: string;
  name: Record<string, string>;
  qty: number;
  revenue: number;
}

function summarize(orders: Order[], now: number) {
  const accepted = orders.filter((o) => o.status !== 'rejected');
  const pending = orders.filter((o) => o.status === 'pending');
  const active = orders.filter((o) => o.status === 'preparing' || o.status === 'ready');
  const ready = orders.filter((o) => o.status === 'ready').length;
  const revenue = accepted.filter((o) => o.status !== 'pending').reduce((a, o) => a + o.total, 0);

  // Real preparation time: from the waiter's "accept" to "ready".
  const prepped = orders.filter((o) => o.acceptedAt && o.readyAt && o.readyAt > o.acceptedAt);
  const avgPrep = prepped.length ? prepped.reduce((a, o) => a + (o.readyAt! - o.acceptedAt!), 0) / prepped.length / 60_000 : null;

  const sellers = new Map<string, Seller>();
  for (const o of accepted) {
    for (const i of o.items) {
      const key = i.productId ?? JSON.stringify(i.name);
      const s = sellers.get(key) ?? { key, name: i.name, qty: 0, revenue: 0 };
      s.qty += i.qty;
      s.revenue += i.qty * i.unitPrice;
      sellers.set(key, s);
    }
  }
  const top = [...sellers.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 5);

  // From opening (or the first order) to now, at least 07–current hour.
  const hours = orders.map((o) => new Date(o.createdAt).getHours());
  const currentHour = new Date(now).getHours();
  const first = Math.min(7, currentHour, ...hours);
  const last = Math.max(currentHour, ...hours);
  const byHour = Array.from({ length: last - first + 1 }, (_, i) => ({ hour: first + i, count: 0 }));
  for (const h of hours) byHour[h - first].count++;

  return {
    accepted, pending, active, ready, revenue, top, byHour,
    rejected: orders.length - accepted.length,
    roomOrders: accepted.filter((o) => o.tableKind === 'room').length,
    avgPrep: avgPrep === null ? null : Math.round(avgPrep * 10) / 10,
    prepCount: prepped.length,
  };
}
