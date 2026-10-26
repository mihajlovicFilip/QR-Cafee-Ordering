/**
 * The waiter dashboard — new, active and finished orders, tables, and waiter calls.
 *
 * New orders and calls chime (when sound is on) and show in the tab title. Accepting is atomic on
 * the server: when two waiters press it together, one gets the order and the other is told it was
 * taken. The header shows whose shift it is and until when; with PIN sign-in, "Switch waiter"
 * hands the screen to a colleague without signing anyone out. Owners and managers also get a way
 * back to administration.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, Bell, LayoutDashboard, LogOut, Volume2, VolumeX } from 'lucide-react';
import { backend, MANAGER_ROLES, type Order, type StaffSession } from '../../api';
import { useI18n } from '../../i18n';
import { useLive, useNow, useSignInEnd, useStoredState } from '../../lib/hooks';
import { chime } from '../../lib/sound';
import { describeError } from '../../lib/errors';
import { minutesSince, placeKey } from '../../lib/orderView';
import { isHotel } from '../../lib/edition';
import { Button, IconButton, LangSwitch, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { ActiveOrderCard, NewOrderCard } from './OrderCards';
import { DoneList, TablesView } from './Views';
import { RejectDialog } from './RejectDialog';

type Tab = 'new' | 'active' | 'done' | 'tables';

export function Dashboard({ session, onSignOut, onStepAway, onDayEnded }: {
  session: StaffSession;
  onSignOut: () => void;
  /** Leaves the dashboard but stays signed in (PIN sign-in only). */
  onStepAway: () => void;
  onDayEnded: () => void;
}) {
  const { t, time } = useI18n();
  useSignInEnd(session.until, onDayEnded);
  const toast = useToast();
  const now = useNow();
  const cafeId = session.cafe.id;
  const hotel = isHotel(session.cafe);
  const [tab, setTab] = useStoredState<Tab>('stolic.waiter.tab', 'new');
  const [sound, setSound] = useStoredState('stolic.waiter.sound', true);
  const [rejecting, setRejecting] = useState<Order | null>(null);

  const orders = useLive(() => backend.cafeOrders(cafeId), (cb) => backend.subscribeCafe(cafeId, cb), [cafeId]);
  const calls = useLive(() => backend.cafeCalls(cafeId), (cb) => backend.subscribeCafe(cafeId, cb), [cafeId]);
  const tables = useLive(() => backend.cafeTables(cafeId), () => () => {}, [cafeId], 120_000);

  const all = useMemo(() => orders.data ?? [], [orders.data]);
  const pending = useMemo(() => all.filter((o) => o.status === 'pending').sort((a, b) => a.createdAt - b.createdAt), [all]);
  const active = useMemo(
    () =>
      all
        .filter((o) => o.status === 'preparing' || o.status === 'ready')
        // Ready-to-serve first, then whatever is due soonest.
        .sort((a, b) => (a.status === 'ready' ? 0 : 1) - (b.status === 'ready' ? 0 : 1) || (a.deadline ?? 0) - (b.deadline ?? 0)),
    [all],
  );
  const done = useMemo(
    () => all.filter((o) => o.status === 'served' || o.status === 'rejected').sort((a, b) => (b.servedAt ?? b.rejectedAt ?? 0) - (a.servedAt ?? a.rejectedAt ?? 0)),
    [all],
  );

  // Alerts for anything new since the last refresh (not on first load).
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!orders.data) return;
    const ids = new Set(pending.map((o) => o.id));
    if (known.current) {
      const fresh = pending.filter((o) => !known.current!.has(o.id));
      if (fresh.length) {
        if (sound) chime();
        const last = fresh[fresh.length - 1];
        toast(t('waiter.newOrderToast', { table: t(placeKey(last.tableKind), { n: last.tableNumber }) }));
      }
    }
    known.current = ids;
  }, [orders.data, pending, sound, t, toast]);

  const knownCalls = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!calls.data) return;
    const ids = new Set(calls.data.map((c) => c.id));
    if (knownCalls.current && calls.data.some((c) => !knownCalls.current!.has(c.id)) && sound) chime();
    knownCalls.current = ids;
  }, [calls.data, sound]);

  useEffect(() => {
    document.title = pending.length ? `${t('waiter.newOrdersTitle', { n: pending.length })} · ${session.cafe.name}` : `${t('waiter.panel')} · ${session.cafe.name}`;
  }, [pending.length, session.cafe.name, t]);

  async function act(fn: () => Promise<unknown>, success?: string) {
    try {
      await fn();
      if (success) toast(success);
    } catch (e) {
      toast(describeError(t, e), 'error');
    } finally {
      void orders.refresh();
    }
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'new', label: t('waiter.tabNew'), count: pending.length },
    { id: 'active', label: t('waiter.tabActive'), count: active.length },
    { id: 'done', label: t('waiter.tabDone'), count: done.length },
    { id: 'tables', label: hotel && tables.data?.some((tb) => tb.kind === 'room') ? t('waiter.tabPlaces') : t('waiter.tabTables') },
  ];
  const offline = !!orders.error;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1280px] flex-col" style={{ '--ac': session.cafe.accent } as CSSProperties}>
      <header className="sticky top-0 z-20 bg-ivory px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--ac) font-serif text-[22px] font-semibold text-white" aria-hidden>
            {session.cafe.name.replace(/^kafe\S*\s+/i, '').charAt(0)}
          </div>
          <div className="min-w-[9rem] flex-1">
            <h1 className="truncate font-serif text-[19px] leading-tight font-semibold">{session.cafe.name}</h1>
            <p className="text-[13px] text-stone">{t('waiter.panel')}</p>
          </div>
          {/* On phones the buttons take a row of their own, under the name and the language switch. */}
          <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto">
            {MANAGER_ROLES.includes(session.role) ? (
              <Link
                to="/admin"
                aria-label={t('admin.title')}
                title={t('admin.title')}
                className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line-strong bg-paper px-3.5 text-[13px] font-semibold text-espresso no-underline transition hover:bg-[#f5efe6]"
              >
                <LayoutDashboard size={16} aria-hidden />
                <span className="hidden sm:inline">{t('admin.title')}</span>
              </Link>
            ) : null}
            <Button variant="ghost" size="sm" aria-pressed={sound} title={t('waiter.soundHint')} onClick={() => { setSound(!sound); if (!sound) chime(); }}>
              {sound ? <Volume2 size={16} aria-hidden /> : <VolumeX size={16} aria-hidden />}
              <span className="hidden sm:inline">{sound ? t('waiter.soundOn') : t('waiter.soundOff')}</span>
            </Button>
            <div className="flex h-11 items-center gap-1.5 rounded-full border border-line-strong bg-paper pr-1 pl-1.5">
              <span className="flex size-8 items-center justify-center rounded-full bg-espresso text-xs font-bold text-paper" aria-hidden>
                {session.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
              </span>
              <span className="ml-1 hidden flex-col leading-tight sm:flex">
                <span className="text-[13px] font-semibold">{session.name}</span>
                <span className="text-[11px] font-semibold text-success">{t('waiter.onShiftUntil', { time: time(session.until) })}</span>
              </span>
              {backend.staffSignIn === 'pin' ? (
                <IconButton label={t('waiter.switchStaff')} onClick={onStepAway} className="size-9 rounded-full">
                  <ArrowLeftRight size={16} />
                </IconButton>
              ) : null}
              <IconButton label={t('waiter.signOut')} onClick={onSignOut} className="size-9 rounded-full">
                <LogOut size={16} />
              </IconButton>
            </div>
          </div>
          <LangSwitch />
        </div>
        <nav className="no-scrollbar mt-3 flex gap-1 overflow-x-auto border-b border-[#e3d9cb]" aria-label={t('waiter.panel')}>
          {tabs.map((x) => {
            const on = tab === x.id;
            const hot = x.id === 'new' && !!x.count && !on;
            return (
              <button
                key={x.id}
                type="button"
                aria-pressed={on}
                onClick={() => setTab(x.id)}
                className={`-mb-px inline-flex h-[46px] shrink-0 items-center gap-2 border-b-2 px-3.5 text-[15px] font-semibold transition ${on ? 'border-espresso text-ink' : 'border-transparent text-stone hover:text-ink'}`}
              >
                {x.label}
                {x.count !== undefined ? (
                  <span className={`tabular inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-xs font-bold ${hot ? 'animate-throb bg-(--ac) text-white' : 'bg-[#e6ded2] text-stone-dark'}`}>
                    {x.count}
                  </span>
                ) : null}
              </button>
            );
          })}
          <span className={`ml-auto hidden items-center gap-1.5 self-center text-xs font-semibold whitespace-nowrap sm:inline-flex ${offline ? 'text-danger' : 'text-success'}`} role="status">
            <span className={`size-2 rounded-full ${offline ? 'bg-danger' : 'animate-throb bg-[#3e9a62]'}`} aria-hidden />
            {offline ? t('waiter.offline') : `${t('waiter.live')} · ${time(now)}`}
          </span>
        </nav>
      </header>

      {calls.data?.length ? (
        <div className="flex flex-col gap-2 px-4 pt-3.5 sm:px-6">
          {calls.data.map((c) => (
            <div key={c.id} role="alert" className="flex animate-rise items-center gap-3 rounded-[14px] border border-[#e6c9ae] bg-tint py-2 pr-2 pl-4 text-sm font-semibold text-[#5e3418]">
              <Bell size={18} aria-hidden />
              <span className="flex-1">{t('waiter.calling', { table: t('common.table', { n: c.tableNumber }) })}</span>
              <span className="text-xs font-medium opacity-80">{minutesSince(c.createdAt, now) < 1 ? t('common.justNow') : t('common.minAgo', { n: minutesSince(c.createdAt, now) })}</span>
              <Button size="sm" onClick={() => act(() => backend.resolveCall(c.id)).then(() => calls.refresh())}>{t('waiter.gotIt')}</Button>
            </div>
          ))}
        </div>
      ) : null}

      <main className="flex-1 px-4 pt-4.5 pb-10 sm:px-6">
        {!orders.data && !orders.error ? (
          <Spinner label={t('common.loading')} />
        ) : tab === 'new' ? (
          pending.length ? (
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {pending.map((o) => (
                <NewOrderCard
                  key={o.id}
                  order={o}
                  now={now}
                  onAccept={async (minutes) => {
                    try {
                      const res = await backend.acceptOrder(o.id, minutes);
                      toast(res === 'ok' ? t('waiter.accepted', { n: o.number, m: minutes }) : t('waiter.taken'), res === 'ok' ? 'success' : 'error');
                    } catch (e) {
                      toast(describeError(t, e), 'error');
                    } finally {
                      void orders.refresh();
                    }
                  }}
                  onReject={() => setRejecting(o)}
                />
              ))}
            </div>
          ) : (
            <Empty title={t('waiter.emptyNew')} body={t('waiter.emptyNewHint')} />
          )
        ) : tab === 'active' ? (
          active.length ? (
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {active.map((o) => (
                <ActiveOrderCard
                  key={o.id}
                  order={o}
                  now={now}
                  mine={o.waiterId === session.staffId}
                  onExtend={(m) => act(() => backend.extendOrder(o.id, m), t('waiter.timeUpdated'))}
                  onReady={() => act(() => backend.markReady(o.id), t('waiter.readyDone'))}
                  onServed={() => act(() => backend.markServed(o.id), t('waiter.servedDone', { n: o.number }))}
                />
              ))}
            </div>
          ) : (
            <Empty title={t('waiter.emptyActive')} body={t('waiter.emptyActiveHint')} />
          )
        ) : tab === 'done' ? (
          done.length ? <DoneList orders={done} /> : <Empty title={t('waiter.emptyDone')} />
        ) : (
          <TablesView tables={tables.data ?? []} orders={all} now={now} hotel={hotel} />
        )}
      </main>

      <RejectDialog
        order={rejecting}
        onClose={() => setRejecting(null)}
        onConfirm={async (reason) => {
          const o = rejecting!;
          try {
            const res = await backend.rejectOrder(o.id, reason);
            toast(res === 'ok' ? t('waiter.rejected', { n: o.number }) : t('waiter.taken'), res === 'ok' ? 'success' : 'error');
            setRejecting(null);
          } catch (e) {
            toast(describeError(t, e), 'error');
          } finally {
            void orders.refresh();
          }
        }}
      />
    </div>
  );
}

function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex animate-rise flex-col items-center gap-2.5 px-5 py-20 text-center">
      <div className="flex size-[76px] items-center justify-center rounded-full bg-[#dfede3] text-success">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <h2 className="font-serif text-2xl font-medium">{title}</h2>
      {body ? <p className="max-w-[360px] text-sm leading-relaxed text-stone">{body}</p> : null}
    </div>
  );
}
