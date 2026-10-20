import { BedDouble } from 'lucide-react';
import type { DiningTable, Order, PlaceKind } from '../../api/types';
import { useI18n } from '../../i18n';
import { useStoredState } from '../../lib/hooks';
import { displayStatus, floorLabel, mmss, placeKey, tableState, type TableState } from '../../lib/orderView';
import { StatusBadge } from '../../components/ui';

export function DoneList({ orders }: { orders: Order[] }) {
  const { t, loc, money, time } = useI18n();
  const cols = 'grid-cols-[72px_64px_minmax(0,1fr)_90px] md:grid-cols-[80px_70px_minmax(0,1fr)_110px_60px_100px_124px]';
  return (
    <div className="card overflow-hidden">
      <div className={`grid ${cols} items-center gap-3 px-5 py-3 text-[11px] font-semibold tracking-[.08em] text-stone uppercase`}>
        <span>{t('waiter.colTable')}</span>
        <span>#</span>
        <span>{t('waiter.colItems')}</span>
        <span className="hidden md:block">{t('waiter.colWaiter')}</span>
        <span className="hidden md:block">{t('waiter.colTime')}</span>
        <span className="hidden md:block">{t('waiter.colTotal')}</span>
        <span>{t('waiter.colStatus')}</span>
      </div>
      <ul>
        {orders.map((o) => (
          <li key={o.id} className={`grid ${cols} items-center gap-3 border-t border-hair px-5 py-3 text-sm`}>
            <span className="font-semibold">{t(placeKey(o.tableKind), { n: o.tableNumber })}</span>
            <span className="text-stone">{o.number}</span>
            <span className="truncate">{o.items.map((i) => `${i.qty}× ${loc(i.name)}`).join(', ')}</span>
            <span className="hidden md:block">{(o.waiterName ?? '—').split(' ')[0]}</span>
            <span className="tabular hidden text-stone md:block">{time(o.servedAt ?? o.rejectedAt ?? o.createdAt)}</span>
            <span className="tabular hidden font-semibold md:block">{money(o.total)}</span>
            <span><StatusBadge status={o.status} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TILE: Record<TableState, string> = {
  free: 'bg-paper border-[1.5px] border-dashed border-[#d6cbbb]',
  occupied: 'bg-[#efe8dd] border border-[#e1d6c6]',
  new: 'bg-[#f7e6d6] border border-[#e0b994]',
  preparing: 'bg-[#e4ecf4] border border-[#c6d6e6]',
};
const LABEL: Record<TableState, string> = { free: 'waiter.tableFree', occupied: 'waiter.tableOccupied', new: 'waiter.tableNew', preparing: 'waiter.tablePreparing' };

export function TablesView({ tables, orders, now }: { tables: DiningTable[]; orders: Order[]; now: number }) {
  const { t } = useI18n();
  const [kind, setKind] = useStoredState<PlaceKind>('stolic.waiter.places', 'table');
  const [onlyActive, setOnlyActive] = useStoredState('stolic.waiter.roomsActive', true);
  const hasRooms = tables.some((tb) => tb.kind === 'room');
  const shown: PlaceKind = hasRooms ? kind : 'table';
  const rows = tables
    .filter((tb) => (tb.kind ?? 'table') === shown)
    .map((tb) => {
      const own = orders.filter((o) => o.tableId === tb.id);
      const state = tableState(own, now);
      const live = own.find((o) => o.status === 'pending' || o.status === 'preparing' || o.status === 'ready');
      return { tb, state, live };
    });
  const room = shown === 'room';
  // 90 rooms are too many to scan: by default only rooms with something going on.
  const visible = room && onlyActive ? rows.filter((r) => r.state !== 'free') : rows;
  const states: TableState[] = room ? ['new', 'preparing', 'occupied'] : ['free', 'occupied', 'new', 'preparing'];
  const label = (s: TableState) => (room && s === 'occupied' ? 'waiter.delivered' : LABEL[s]);

  return (
    <div className="flex flex-col gap-4">
      {hasRooms ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('waiter.tabTables')}>
          {(['table', 'room'] as const).map((k) => (
            <button key={k} type="button" className="chip chip-sm" aria-pressed={shown === k} onClick={() => setKind(k)}>
              {k === 'room' ? <BedDouble size={15} aria-hidden /> : null}
              {t(k === 'room' ? 'waiter.kindRooms' : 'waiter.kindTables')}
              <span className="tabular opacity-70">{tables.filter((tb) => (tb.kind ?? 'table') === k).length}</span>
            </button>
          ))}
          {room ? (
            <label className="ml-auto inline-flex items-center gap-2 text-sm text-stone-dark">
              <input type="checkbox" className="size-4 accent-(--ac)" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
              {t('waiter.onlyActiveRooms')}
            </label>
          ) : null}
        </div>
      ) : null}
      <ul className="flex flex-wrap gap-2" aria-label={t(room ? 'waiter.kindRooms' : 'waiter.kindTables')}>
        {states.map((s) => (
          <li key={s} className="inline-flex h-[34px] items-center gap-2 rounded-full border border-line bg-paper px-3 text-[13px]">
            <span className={`inline-block size-3.5 rounded-[5px] ${TILE[s]}`} aria-hidden />
            {t(label(s))}
            <b className="tabular">{rows.filter((r) => r.state === s).length}</b>
          </li>
        ))}
      </ul>
      {visible.length ? (
        <ul className={`grid gap-3.5 ${room ? 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6'}`}>
          {visible.map(({ tb, state, live }) => (
            <li key={tb.id} className={`relative flex flex-col gap-1.5 rounded-[18px] ${room ? 'min-h-[96px] p-3.5' : 'min-h-[128px] p-4'} ${TILE[state]}`}>
              {state === 'new' ? <span className="absolute top-4 right-4 size-2.5 animate-throb rounded-full bg-(--ac)" aria-hidden /> : null}
              <span className={`font-serif leading-none font-semibold ${room ? 'text-[26px]' : 'text-[34px]'}`}>{tb.number}</span>
              <span className="text-xs text-stone">
                {room
                  ? floorLabel(t, tb.floor) ?? t('waiter.roomService')
                  : `${t(`waiter.zone.${tb.zone}`)} · ${t('waiter.seats', { n: tb.seats })}`}
              </span>
              {room && state === 'free' ? null : <span className="mt-auto text-[13px] font-semibold">{t(label(state))}</span>}
              {live ? <LiveLine order={live} now={now} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-12 text-center text-sm text-stone">{t('waiter.noActiveRooms')}</p>
      )}
    </div>
  );
}

function LiveLine({ order, now }: { order: Order; now: number }) {
  const { t, money } = useI18n();
  return (
    <span className="tabular text-xs text-stone-dark">
      #{order.number} ·{' '}
      {order.status === 'pending' ? money(order.total) : displayStatus(order, now) === 'late' ? t('status.late') : order.status === 'ready' ? t('status.ready') : mmss((order.deadline ?? now) - now)}
    </span>
  );
}
