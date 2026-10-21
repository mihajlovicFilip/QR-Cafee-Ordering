/**
 * Overview — today at a glance, the last 7 or 30 days, or one chosen day.
 *
 * Two kinds of numbers share the screen: what is happening now (active and waiting orders, always
 * today, live) and totals for the chosen view (admin_order_stats, computed in the database so a
 * busy month is not cut at the API's row limit). Fetched results carry the view they belong to,
 * so switching never flashes the previous view's numbers.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, ClipboardList, Hourglass, ReceiptText, Timer } from 'lucide-react';
import { backend, type Order, type OrderStats, type StaffSession } from '../../api';
import { useI18n } from '../../i18n';
import { useLive, useNow, useStoredState } from '../../lib/hooks';
import { displayStatus, minutesSince, placeKey } from '../../lib/orderView';
import { describeError } from '../../lib/errors';
import { dayKey } from '../../api/stats';
import { isHotel } from '../../lib/edition';
import { Button, IconButton, Spinner, StatusBadge } from '../../components/ui';
import { PageHeader, useAdminTitle } from './parts';

type Period = 1 | 7 | 30;
const PERIODS: Period[] = [1, 7, 30];

/** Local midnight `daysBack` days ago (0 = today). */
const dayStart = (daysBack = 0) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.getTime();
};
/** Local midnight of a YYYY-MM-DD day, and of the day after it. */
const parseDay = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};
const shiftDay = (key: string, by: number) => {
  const d = new Date(parseDay(key));
  d.setDate(d.getDate() + by);
  return dayKey(d.getTime());
};
/** How far back a single day can be picked: the same 30 days as the longest period. */
const OLDEST_DAY_BACK = 29;
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

export function Overview({ session }: { session: StaffSession }) {
  const { t, tp, loc, money } = useI18n();
  const now = useNow(30_000);
  const cafeId = session.cafe.id;
  const locale = t('meta.locale');
  useAdminTitle(t('admin.nav.overview'), session.cafe.name);

  const [period, setPeriod] = useStoredState<Period>('stolic.admin.period', 1);
  // A single earlier day picked from the calendar or the chart (YYYY-MM-DD); null = the period above.
  const [day, setDay] = useState<string | null>(null);
  const today = dayKey(now);
  const oldest = dayKey(dayStart(OLDEST_DAY_BACK));
  const since = day ? parseDay(day) : dayStart(period - 1);
  const until = day ? parseDay(shiftDay(day, 1)) : null;

  function pickDay(key: string | null) {
    if (!key || key >= today) {
      setDay(null);
      if (key) setPeriod(1); // today is the "Today" view
    } else if (key >= oldest) {
      setDay(key);
    }
  }

  // What is happening right now (always today), the totals for the chosen period or day,
  // and the orders of a chosen earlier day.
  // Results carry the view they belong to, so switching never shows the previous view's numbers.
  const view = day ?? `last-${period}`;
  const live = useLive(() => backend.adminOrders(cafeId, dayStart()), (cb) => backend.subscribeCafe(cafeId, cb), [cafeId], 30_000);
  const stats = useLive(
    async () => ({ view, data: await backend.orderStats(cafeId, since, until, TIME_ZONE) }),
    (cb) => backend.subscribeCafe(cafeId, cb),
    [cafeId, view],
    60_000,
  );
  const dayOrders = useLive(
    async () => ({ view, data: day ? await backend.adminOrders(cafeId, parseDay(day), parseDay(shiftDay(day, 1))) : [] }),
    () => () => {},
    [cafeId, view],
    300_000,
  );
  const dayList = dayOrders.data?.view === view ? dayOrders.data.data : undefined;

  const orders = useMemo(() => live.data ?? [], [live.data]);
  const pending = orders.filter((o) => o.status === 'pending');
  const active = orders.filter((o) => o.status === 'preparing' || o.status === 'ready');
  const ready = active.filter((o) => o.status === 'ready').length;
  const s = stats.data?.view === view ? stats.data.data : undefined;

  const fmtDay = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' });
  const fmtFull = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const subtitle = day
    ? capitalize(fmtFull.format(parseDay(day)))
    : period === 1
      ? capitalize(fmtFull.format(now))
      : `${fmtDay.format(since)} – ${fmtDay.format(now)}`;
  const oneDay = day !== null || period === 1;

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

  const oldestPending = pending.length ? minutesSince(Math.min(...pending.map((o) => o.createdAt)), now) : null;
  const ordersSub = s
    ? [
        t('admin.overview.kpiTodaySub', { amount: money(s.revenue) }),
        !oneDay ? t('admin.overview.perDay', { n: Math.round(s.orders / period) }) : '',
        isHotel(session.cafe) && s.roomOrders ? t('admin.overview.roomServiceCount', { n: s.roomOrders }) : '',
      ].filter(Boolean).join(' · ')
    : t('common.loading');

  return (
    <div className="flex animate-rise flex-col gap-7">
      <PageHeader
        title={t('admin.overview.title')}
        subtitle={subtitle}
        actions={
          <>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('admin.overview.period')}>
              {PERIODS.map((p) => (
                <button key={p} type="button" className="chip chip-sm" aria-pressed={!day && period === p} onClick={() => { setDay(null); setPeriod(p); }}>
                  {p === 1 ? t('admin.overview.periodToday') : t('admin.overview.periodDays', { n: p })}
                </button>
              ))}
              <DayPicker value={day} min={oldest} max={today} onChange={pickDay} />
            </div>
            <Link to="/waiter" className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line-strong bg-paper px-3.5 text-[13px] font-semibold text-espresso no-underline transition hover:bg-[#f5efe6]">
              {t('admin.overview.openWaiter')}
              <ArrowRight size={14} aria-hidden />
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<ClipboardList size={18} />} label={t('admin.overview.kpiActive')} value={String(active.length)} sub={tp('admin.overview.kpiActiveSub', ready)} />
        <Kpi
          icon={<ReceiptText size={18} />}
          label={day ? t('admin.overview.kpiDay') : period === 1 ? t('admin.overview.kpiToday') : t('admin.overview.kpiPeriod', { n: period })}
          value={s ? String(s.orders) : '…'}
          sub={ordersSub}
        />
        <Kpi
          icon={<Hourglass size={18} />}
          label={t('admin.overview.kpiPending')}
          value={String(pending.length)}
          sub={oldestPending === null ? t('admin.overview.kpiPendingNone') : t('admin.overview.kpiPendingSub', { n: oldestPending })}
          tone={pending.length ? 'warn' : undefined}
        />
        <Kpi
          icon={<Timer size={18} />}
          label={t('admin.overview.kpiPrep')}
          value={!s ? '…' : s.prepMinutes === null ? '—' : s.prepMinutes.toLocaleString(locale, { maximumFractionDigits: 1 })}
          unit={s && s.prepMinutes !== null ? t('admin.overview.minUnit') : undefined}
          sub={!s ? t('common.loading') : s.prepCount ? tp('admin.overview.kpiPrepSub', s.prepCount) : t('admin.overview.kpiPrepNone')}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="card flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="chart-title">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="chart-title" className="font-serif text-xl font-medium">{oneDay ? t('admin.overview.byHour') : t('admin.overview.byDay')}</h2>
            {s ? <span className="text-[13px] text-stone">{tp('admin.overview.ordersCount', s.orders + s.rejected)}</span> : null}
          </div>
          {!s ? (
            <StatsPending error={stats.error} onRetry={() => void stats.refresh()} />
          ) : oneDay ? (
            <HourBars stats={s} currentHour={day ? null : new Date(now).getHours()} empty={day ? t('admin.overview.noDataDay') : t('admin.overview.noData')} />
          ) : (
            <>
              <DayBars stats={s} today={today} oldest={oldest} onPick={pickDay} />
              <p className="text-xs text-stone">{t('admin.overview.barHint')}</p>
            </>
          )}
        </section>

        <section className="card flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="top-sellers">
          <h2 id="top-sellers" className="font-serif text-xl font-medium">
            {day ? t('admin.overview.topSellersDay') : period === 1 ? t('admin.overview.topSellers') : t('admin.overview.topSellersPeriod', { n: period })}
          </h2>
          {!s ? (
            <StatsPending error={stats.error} onRetry={() => void stats.refresh()} />
          ) : s.top.length ? (
            <ol className="flex flex-col gap-3">
              {s.top.map((p, i) => (
                <li key={p.key} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline gap-2.5 text-sm">
                    <span className="tabular w-4 text-stone">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{loc(p.name)}</span>
                    <span className="tabular text-stone">{t('admin.overview.qty', { n: p.qty })}</span>
                    <span className="tabular w-[92px] text-right font-semibold">{money(p.revenue)}</span>
                  </div>
                  <div className="ml-6.5 h-1.5 overflow-hidden rounded-full bg-sand" aria-hidden>
                    <div className="h-full rounded-full bg-(--ac)" style={{ width: `${Math.max(4, (p.qty / s.top[0].qty) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-6 text-center text-sm text-stone">{day ? t('admin.overview.noDataDay') : period === 1 ? t('admin.overview.noData') : t('admin.overview.noDataPeriod')}</p>
          )}
        </section>
      </div>

      {day ? (
        <OrderList
          key={day}
          title={dayList ? t('admin.overview.dayOrders', { n: dayList.length }) : t('admin.overview.dayOrdersTitle')}
          orders={dayList}
          now={now}
          empty={t('admin.overview.noDataDay')}
          initial={10}
        />
      ) : (
        <OrderList title={t('admin.overview.recent')} orders={orders} now={now} empty={t('admin.overview.noData')} initial={8} />
      )}
    </div>
  );
}

/** A list of orders: the latest ones of today, or all orders of a chosen day ("show all" past `initial`). */
function OrderList({ title, orders, now, empty, initial }: { title: string; orders: Order[] | undefined; now: number; empty: string; initial: number }) {
  const { t, loc, money, time } = useI18n();
  const [all, setAll] = useState(false);
  const shown = orders ? (all ? orders : orders.slice(0, initial)) : [];
  return (
    <section className="card overflow-hidden" aria-labelledby="recent">
      <div className="flex items-baseline justify-between gap-3 px-5 pt-5 pb-3 sm:px-6">
        <h2 id="recent" className="font-serif text-xl font-medium">{title}</h2>
      </div>
      {!orders ? (
        <p className="border-t border-hair px-6 py-10 text-center text-sm text-stone" role="status">{t('common.loading')}</p>
      ) : orders.length ? (
        <>
          <ul>
            {shown.map((o) => (
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
          {orders.length > shown.length ? (
            <div className="border-t border-hair px-5 py-3 sm:px-6">
              <Button variant="ghost" size="sm" onClick={() => setAll(true)}>{t('admin.overview.showAll', { n: orders.length })}</Button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="border-t border-hair px-6 py-10 text-center text-sm text-stone">{empty}</p>
      )}
    </section>
  );
}

/** A day within the last 30, with arrows to step one day back or forward. */
function DayPicker({ value, min, max, onChange }: { value: string | null; min: string; max: string; onChange: (day: string | null) => void }) {
  const { t } = useI18n();
  const current = value ?? max;
  const on = value !== null;
  const arrow = `size-7 rounded-full ${on ? 'text-paper hover:bg-white/15' : 'hover:bg-sand'}`;
  return (
    <span className={`inline-flex h-9 items-center gap-0.5 rounded-full border px-1 ${on ? 'border-espresso bg-espresso text-paper' : 'border-line-strong bg-paper text-ink'}`}>
      <IconButton label={t('admin.overview.prevDay')} disabled={current <= min} onClick={() => onChange(shiftDay(current, -1))} className={arrow}>
        <ChevronLeft size={15} />
      </IconButton>
      <label className="flex items-center px-1">
        <input
          type="date"
          className={`h-7 bg-transparent text-[13px] font-medium outline-none ${on ? '[color-scheme:dark]' : ''}`}
          aria-label={t('admin.overview.pickDate')}
          min={min}
          max={max}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      </label>
      <IconButton label={t('admin.overview.nextDay')} disabled={!on} onClick={() => onChange(shiftDay(current, 1))} className={arrow}>
        <ChevronRight size={15} />
      </IconButton>
    </span>
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

function StatsPending({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  if (!error) return <p className="py-14 text-center text-sm text-stone" role="status">{t('common.loading')}</p>;
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <p className="text-sm text-danger">{describeError(t, error)}</p>
      <Button variant="ghost" size="sm" onClick={onRetry}>{t('common.retry')}</Button>
    </div>
  );
}

/** One day: every hour from opening (or the first order) to now, or to closing for an earlier day. */
function HourBars({ stats, currentHour, empty }: { stats: OrderStats; currentHour: number | null; empty: string }) {
  const { t, tp } = useI18n();
  const counts = new Map(stats.byHour.map((h) => [h.hour, h.orders]));
  const hours = [...counts.keys()];
  const first = Math.min(7, currentHour ?? 7, ...hours);
  const last = Math.max(currentHour ?? 22, ...hours);
  const buckets = Array.from({ length: last - first + 1 }, (_, i) => ({ hour: first + i, count: counts.get(first + i) ?? 0 }));
  const max = Math.max(1, ...buckets.map((b) => b.count));
  if (!stats.byHour.length) return <p className="py-14 text-center text-sm text-stone">{empty}</p>;
  return (
    <ul className="flex h-[200px] items-stretch gap-1 pt-2 sm:gap-1.5" aria-label={t('admin.overview.byHour')}>
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

/** Last 7 or 30 days: one bar per day, today highlighted; a bar opens that day. */
function DayBars({ stats, today, oldest, onPick }: { stats: OrderStats; today: string; oldest: string; onPick: (day: string) => void }) {
  const { t, tp, money } = useI18n();
  const locale = t('meta.locale');
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const max = Math.max(1, ...stats.byDay.map((d) => d.orders));
  const many = stats.byDay.length > 14;
  if (!stats.byDay.some((d) => d.orders)) return <p className="py-14 text-center text-sm text-stone">{t('admin.overview.noDataPeriod')}</p>;
  return (
    <ul className={`flex h-[200px] items-stretch pt-2 ${many ? 'gap-[3px]' : 'gap-1.5 sm:gap-2'}`} aria-label={t('admin.overview.byDay')}>
      {stats.byDay.map((d, i) => {
        const [y, m, day] = d.day.split('-').map(Number);
        const date = new Date(y, m - 1, day);
        const label = `${fmt.format(date)} — ${tp('admin.overview.ordersCount', d.orders)} · ${money(d.revenue)}`;
        // With 30 bars, label every fifth day and today so the axis stays readable.
        const showLabel = !many || d.day === today || (stats.byDay.length - 1 - i) % 5 === 0;
        return (
          <li key={d.day} className="flex min-w-0 flex-1">
            <button
              type="button"
              aria-label={label}
              title={label}
              disabled={d.day < oldest}
              onClick={() => onPick(d.day)}
              className="group flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-md disabled:cursor-default"
            >
              <span className="flex w-full flex-1 flex-col justify-end">
                {!many && d.orders ? <span className="tabular mb-1 block text-center text-[11px] font-semibold text-stone-dark" aria-hidden>{d.orders}</span> : null}
                <span
                  className={`block w-full rounded-t-[4px] rounded-b-[2px] transition-colors ${d.day === today ? 'bg-(--ac)' : 'bg-[#e3d6c4] group-hover:bg-[#cdb89c] group-focus-visible:bg-[#cdb89c]'}`}
                  style={{ height: `${d.orders ? Math.max(4, (d.orders / max) * 100) : 0}%`, minHeight: d.orders ? 4 : 2 }}
                  aria-hidden
                />
              </span>
              <span className={`tabular text-[11px] text-stone ${showLabel ? '' : 'invisible'}`} aria-hidden>{day}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
