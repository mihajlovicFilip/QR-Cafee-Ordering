import { useMemo, useState } from 'react';
import { BedDouble, Copy, Download, ExternalLink, FileDown, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { backend, TABLE_ZONES, type DiningTable, type PlaceKind, type StaffSession } from '../../api';
import { translateIn, useI18n } from '../../i18n';
import { useLive, useNow, useStoredState } from '../../lib/hooks';
import { describeError } from '../../lib/errors';
import { floorFromNumber, floorLabel, MAX_FLOOR, placeKey, tableState, type TableState } from '../../lib/orderView';
import { cardPng, cardsPdf, downloadBlob, qrMatrix, qrPath, type QrCard } from '../../lib/qr';
import { Button, Dialog, IconButton, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { ConfirmDialog, ErrorNote, Field, PageHeader, useAdminTitle } from './parts';

const STATE_TONE: Record<TableState, string> = {
  free: 'bg-[#ece6de] text-[#584f47]',
  occupied: 'bg-[#efe3d2] text-[#6b4a2b]',
  new: 'bg-[#f7e0cc] text-[#8a3a12]',
  preparing: 'bg-[#e2ebf4] text-[#2a5279]',
};
const STATE_LABEL: Record<TableState, string> = { free: 'waiter.tableFree', occupied: 'waiter.tableOccupied', new: 'waiter.tableNew', preparing: 'waiter.tablePreparing' };

const placeUrl = (token: string) => `${window.location.origin}/t/${token}`;

/** Empty → no floor; otherwise a whole number 0..MAX_FLOOR, or undefined when invalid. */
function parseFloor(raw: string): number | null | undefined {
  const v = raw.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_FLOOR ? n : undefined;
}

/** First room of the next floor: after 330 comes 401. Without rooms, 101. */
function nextFloor(numbers: number[]): number {
  if (!numbers.length) return 101;
  const max = Math.max(...numbers);
  return max >= 100 ? (Math.floor(max / 100) + 1) * 100 + 1 : max + 1;
}

export function TablesPage({ session }: { session: StaffSession }) {
  const { t, tp } = useI18n();
  const toast = useToast();
  const now = useNow(15_000);
  const cafe = session.cafe;
  useAdminTitle(t('admin.nav.tables'), cafe.name);

  const places = useLive(() => backend.cafeTables(cafe.id), () => () => {}, [cafe.id], 60_000);
  const orders = useLive(() => backend.cafeOrders(cafe.id), (cb) => backend.subscribeCafe(cafe.id, cb), [cafe.id]);
  const [kind, setKind] = useStoredState<PlaceKind>('stolic.admin.places', 'table');
  const [query, setQuery] = useState('');
  const [floorFilter, setFloorFilter] = useState('all');
  const [editing, setEditing] = useState<DiningTable | 'new' | null>(null);
  const [addingRooms, setAddingRooms] = useState(false);
  const [regenerating, setRegenerating] = useState<DiningTable | null>(null);
  const [removing, setRemoving] = useState<DiningTable | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const all = useMemo(() => places.data ?? [], [places.data]);
  const ofKind = useMemo(() => all.filter((p) => (p.kind ?? 'table') === kind), [all, kind]);
  const list = useMemo(() => {
    const q = query.trim();
    if (kind !== 'room') return ofKind;
    return ofKind.filter(
      (p) =>
        (!q || String(p.number).startsWith(q)) &&
        (floorFilter === 'all' || (floorFilter === 'none' ? p.floor === null : p.floor === Number(floorFilter))),
    );
  }, [ofKind, kind, query, floorFilter]);
  const floors = useMemo(() => [...new Set(ofKind.map((p) => p.floor))].sort((a, b) => (a ?? -1) - (b ?? -1)), [ofKind]);
  const states = useMemo(() => {
    const os = orders.data ?? [];
    return new Map(all.map((p) => [p.id, tableState(os.filter((o) => o.tableId === p.id), now)]));
  }, [all, orders.data, now]);

  const room = kind === 'room';
  const nameOf = (p: Pick<DiningTable, 'kind' | 'number'>) => t(placeKey(p.kind), { n: p.number });
  const other = cafe.defaultLang === 'sr' ? 'en' : 'sr';
  const card = (p: DiningTable): QrCard => {
    const r = p.kind === 'room';
    return {
      url: placeUrl(p.token),
      cafeName: cafe.name,
      tableNumber: p.number,
      tableLabel: `${translateIn(cafe.defaultLang, r ? 'admin.qr.room' : 'admin.qr.table')} · ${translateIn(other, r ? 'admin.qr.room' : 'admin.qr.table')}`,
      lines: [translateIn(cafe.defaultLang, r ? 'admin.qr.scanRoom' : 'admin.qr.scan'), translateIn(other, r ? 'admin.qr.scanRoom' : 'admin.qr.scan')],
      accent: cafe.accent,
    };
  };

  async function act(fn: () => Promise<unknown>, success: string) {
    try {
      await fn();
      toast(success);
      return true;
    } catch (e) {
      toast(describeError(t, e), 'error');
      return false;
    } finally {
      void places.refresh();
    }
  }

  async function printAll() {
    setPdfBusy(true);
    try {
      downloadBlob(await cardsPdf(list.map(card)), `qr-${cafe.slug || 'lokal'}-${room ? 'sobe' : 'stolovi'}.pdf`);
      toast(t('admin.tables.pdfReady'));
    } catch (e) {
      toast(describeError(t, e), 'error');
    } finally {
      setPdfBusy(false);
    }
  }

  if (!places.data) return places.error ? <ErrorNote text={describeError(t, places.error)} /> : <Spinner label={t('common.loading')} />;

  const tableCount = all.filter((p) => (p.kind ?? 'table') === 'table').length;
  const roomCount = all.length - tableCount;
  const seats = ofKind.reduce((a, p) => a + p.seats, 0);

  return (
    <div className="flex animate-rise flex-col gap-6">
      <PageHeader
        title={t('admin.tables.title')}
        subtitle={t('admin.tables.subtitle')}
        actions={
          <>
            <Button variant="ghost" size="sm" busy={pdfBusy} disabled={!list.length} onClick={printAll}>
              {pdfBusy ? null : <FileDown size={15} aria-hidden />}
              {pdfBusy ? t('admin.tables.printing') : t('admin.tables.printAll')}
            </Button>
            <Button variant="accent" size="sm" onClick={() => (room ? setAddingRooms(true) : setEditing('new'))}>
              <Plus size={16} aria-hidden />
              {room ? t('admin.tables.addRooms') : t('admin.tables.add')}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2" role="group" aria-label={t('admin.nav.tables')}>
          <button type="button" className="chip chip-sm" aria-pressed={!room} onClick={() => setKind('table')}>
            {t('admin.tables.kindTables')}
            <span className="tabular opacity-70">{tableCount}</span>
          </button>
          <button type="button" className="chip chip-sm" aria-pressed={room} onClick={() => setKind('room')}>
            <BedDouble size={15} aria-hidden />
            {t('admin.tables.kindRooms')}
            <span className="tabular opacity-70">{roomCount}</span>
          </button>
        </div>
        <span className="text-sm text-stone">
          {room ? tp('admin.tables.roomsSummary', ofKind.length) : `${tp('admin.tables.summary', ofKind.length)} · ${tp('admin.tables.seatsTotal', seats)}`}
        </span>
        {room && floors.length > 1 ? (
          <select className="field h-10 w-auto bg-paper text-sm sm:ml-auto" aria-label={t('admin.tables.floorField')} value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)}>
            <option value="all">{t('admin.tables.allFloors')}</option>
            {floors.map((f) => (
              <option key={f ?? 'none'} value={f ?? 'none'}>{floorLabel(t, f) ?? t('admin.tables.noFloor')}</option>
            ))}
          </select>
        ) : null}
        {room && ofKind.length ? (
          <div className={`relative w-full sm:w-[220px] ${floors.length > 1 ? '' : 'sm:ml-auto'}`}>
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-stone" aria-hidden />
            <input
              type="search"
              inputMode="numeric"
              className="field h-10 bg-paper pl-9 text-sm"
              placeholder={t('admin.tables.findRoom')}
              aria-label={t('admin.tables.findRoom')}
              value={query}
              onChange={(e) => setQuery(e.target.value.replace(/\D/g, ''))}
            />
          </div>
        ) : null}
      </div>

      {list.length ? (
        <ul className={`grid grid-cols-1 gap-4 ${room ? 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
          {list.map((p) => (
            <PlaceCard
              key={p.id}
              place={p}
              state={states.get(p.id) ?? 'free'}
              onCopied={() => toast(t('admin.tables.linkCopied'))}
              onPng={async () => downloadBlob(await cardPng(card(p)), `qr-${cafe.slug || 'lokal'}-${p.kind === 'room' ? 'soba' : 'sto'}-${p.number}.png`)}
              onEdit={() => setEditing(p)}
              onRegenerate={() => setRegenerating(p)}
              onRemove={() => setRemoving(p)}
            />
          ))}
        </ul>
      ) : room && query ? (
        <p className="py-12 text-center text-sm text-stone">{t('admin.tables.noRoomMatch', { q: query })}</p>
      ) : (
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p className="font-serif text-2xl font-medium">{room ? t('admin.tables.emptyRooms') : t('admin.tables.empty')}</p>
          <p className="max-w-sm text-sm text-stone">{room ? t('admin.tables.emptyRoomsHint') : t('admin.tables.emptyHint')}</p>
          <Button variant="accent" size="sm" onClick={() => (room ? setAddingRooms(true) : setEditing('new'))}>
            <Plus size={16} aria-hidden />
            {room ? t('admin.tables.addRooms') : t('admin.tables.add')}
          </Button>
        </div>
      )}

      <PlaceDialog
        key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id}
        place={editing}
        suggestedNumber={ofKind.reduce((m, p) => Math.max(m, p.number), 0) + 1}
        onClose={() => setEditing(null)}
        onSave={async (input) => {
          const existing = editing && editing !== 'new' ? editing : null;
          const placeKind = existing?.kind ?? 'table';
          await backend.saveTable(cafe.id, { id: existing?.id, kind: placeKind, ...input });
          toast(t('admin.tables.saved', { table: nameOf({ kind: placeKind, number: input.number }) }));
          setEditing(null);
          void places.refresh();
        }}
      />

      <RoomsDialog
        key={addingRooms ? 'open' : 'closed'}
        open={addingRooms}
        suggestedFrom={nextFloor(ofKind.map((p) => p.number))}
        onClose={() => setAddingRooms(false)}
        onAdd={async (from, to, floor) => {
          const added = await backend.addRooms(cafe.id, from, to, floor);
          toast(added ? tp('admin.tables.roomsAdded', added) : t('admin.tables.roomsNone'), added ? 'success' : 'error');
          setAddingRooms(false);
          void places.refresh();
        }}
      />

      <ConfirmDialog
        open={!!regenerating}
        title={t('admin.tables.regenerateTitle', { table: regenerating ? nameOf(regenerating) : '' })}
        body={t('admin.tables.regenerateBody')}
        confirmLabel={t('admin.tables.regenerateConfirm')}
        onClose={() => setRegenerating(null)}
        onConfirm={async () => {
          await act(() => backend.regenerateTableToken(regenerating!.id), t('admin.tables.regenerated'));
          setRegenerating(null);
        }}
      />

      <ConfirmDialog
        open={!!removing}
        title={t('admin.tables.removeTitle', { table: removing ? nameOf(removing) : '' })}
        body={t('admin.tables.removeBody')}
        confirmLabel={t('admin.remove')}
        danger
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          const p = removing!;
          await act(() => backend.deleteTable(p.id), t('admin.tables.removed', { table: nameOf(p) }));
          setRemoving(null);
        }}
      />
    </div>
  );
}

function PlaceCard({ place, state, onCopied, onPng, onEdit, onRegenerate, onRemove }: {
  place: DiningTable;
  state: TableState;
  onCopied: () => void;
  onPng: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const room = place.kind === 'room';
  const name = t(placeKey(place.kind), { n: place.number });
  const url = placeUrl(place.token);
  const detail = room
    ? floorLabel(t, place.floor) ?? t('admin.tables.roomService')
    : `${t(`waiter.zone.${place.zone}`)} · ${t('waiter.seats', { n: place.seats })}`;
  const showState = !room || state !== 'free';

  return (
    <li className={`card flex flex-col ${room ? 'gap-3 p-4' : 'gap-4 p-5'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className={`font-serif leading-none font-semibold ${room ? 'text-[24px]' : 'text-[30px]'}`}>{name}</span>
          <span className="text-[13px] text-stone">{detail}</span>
        </div>
        {showState ? (
          <span className={`inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${STATE_TONE[state]}`}>
            <span className={`size-1.5 rounded-full bg-current ${state === 'new' ? 'animate-throb' : ''}`} aria-hidden />
            {t(room && state === 'occupied' ? 'admin.tables.delivered' : STATE_LABEL[state])}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        <QrSvg value={url} size={room ? 96 : 124} label={t('admin.tables.qrFor', { table: name })} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 truncate text-[13px] font-medium text-copper-ink" title={t('admin.tables.openLink')}>
            <ExternalLink size={13} className="shrink-0" aria-hidden />
            <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
          </a>
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                onCopied();
              } catch {
                /* clipboard blocked — the link is still visible above */
              }
            }}
          >
            <Copy size={14} aria-hidden />
            {t('admin.tables.copyLink')}
          </Button>
          <Button variant="ghost" size="sm" className="self-start" aria-label={t('admin.tables.downloadPngFor', { table: name })} onClick={onPng}>
            <Download size={14} aria-hidden />
            {t('admin.tables.downloadPng')}
          </Button>
        </div>
      </div>

      <div className="-mx-1 mt-auto flex items-center gap-1 border-t border-hair pt-3">
        <Button variant="ghost" size="sm" className="border-transparent" onClick={onEdit}>
          <Pencil size={14} aria-hidden />
          {t('admin.edit')}
        </Button>
        <Button variant="ghost" size="sm" className="border-transparent" onClick={onRegenerate}>
          <RefreshCw size={14} aria-hidden />
          {t('admin.tables.regenerate')}
        </Button>
        <span className="flex-1" />
        <IconButton label={t('admin.tables.removeNamed', { table: name })} onClick={onRemove} className="size-9 rounded-[10px] text-danger hover:bg-[#fbf0ee]">
          <Trash2 size={16} />
        </IconButton>
      </div>
    </li>
  );
}

function QrSvg({ value, size, label }: { value: string; size: number; label: string }) {
  const { n, d } = useMemo(() => {
    const m = qrMatrix(value);
    return { n: m.size, d: qrPath(m) };
  }, [value]);
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label={label} shapeRendering="crispEdges" className="shrink-0 rounded-[12px] border border-line bg-white">
      <path d={d} fill="#1f1b18" />
    </svg>
  );
}

/** Edit a table or a room, or add a single table. Rooms are added in bulk with RoomsDialog. */
function PlaceDialog({ place, suggestedNumber, onClose, onSave }: {
  place: DiningTable | 'new' | null;
  suggestedNumber: number;
  onClose: () => void;
  onSave: (input: { number: number; seats: number; zone: string; floor: number | null }) => Promise<void>;
}) {
  const { t } = useI18n();
  const existing = place && place !== 'new' ? place : null;
  const room = existing?.kind === 'room';
  const [number, setNumber] = useState(String(existing?.number ?? suggestedNumber));
  const [seats, setSeats] = useState(String(existing?.seats ?? 2));
  const [zone, setZone] = useState(existing?.zone ?? 'hall');
  const [floor, setFloor] = useState(existing?.floor === null || existing?.floor === undefined ? '' : String(existing.floor));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = existing ? t('admin.tables.edit', { table: t(placeKey(existing.kind), { n: existing.number }) }) : t('admin.tables.add');

  return (
    <Dialog open={!!place} onClose={onClose} title={title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const n = Number(number);
          const s = Number(seats);
          if (!Number.isInteger(n) || n < 1 || n > 9999) return setError(t('errors.invalid_number'));
          if (!room && (!Number.isInteger(s) || s < 1 || s > 50)) return setError(t('admin.tables.invalidSeats'));
          const f = room ? parseFloor(floor) : null;
          if (f === undefined) return setError(t('errors.invalid_floor'));
          setBusy(true);
          setError(null);
          try {
            await onSave({ number: n, seats: room ? existing!.seats : s, zone: room ? 'room' : zone, floor: f });
          } catch (err) {
            setError(describeError(t, err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="font-serif text-2xl font-medium">{title}</h2>
        {room ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('admin.tables.roomNumber')}>
              <input className="field tabular" inputMode="numeric" data-autofocus value={number} onChange={(e) => setNumber(e.target.value)} required />
            </Field>
            <Field label={t('admin.tables.floorField')}>
              <input className="field tabular" inputMode="numeric" placeholder="—" value={floor} onChange={(e) => setFloor(e.target.value)} />
            </Field>
            <p className="col-span-2 text-[13px] text-stone">{t('admin.tables.floorHint')}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('admin.tables.number')}>
                <input className="field tabular" inputMode="numeric" data-autofocus value={number} onChange={(e) => setNumber(e.target.value)} required />
              </Field>
              <Field label={t('admin.tables.seats')}>
                <input className="field tabular" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} required />
              </Field>
            </div>
            <Field label={t('admin.tables.zone')}>
              <select className="field" value={zone} onChange={(e) => setZone(e.target.value)}>
                {TABLE_ZONES.map((z) => (
                  <option key={z} value={z}>{t(`waiter.zone.${z}`)}</option>
                ))}
              </select>
            </Field>
          </>
        )}
        <ErrorNote text={error} />
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" busy={busy}>{t('admin.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function RoomsDialog({ open, suggestedFrom, onClose, onAdd }: {
  open: boolean;
  suggestedFrom: number;
  onClose: () => void;
  onAdd: (from: number, to: number, floor: number | null) => Promise<void>;
}) {
  const { t, tp } = useI18n();
  const [from, setFrom] = useState(String(suggestedFrom));
  const [to, setTo] = useState(String(suggestedFrom + 29));
  // Suggested from the first number (401 → 4) until the manager types a floor of their own.
  const [floor, setFloor] = useState(String(floorFromNumber(suggestedFrom) ?? ''));
  const [floorTouched, setFloorTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = Number(from);
  const b = Number(to);
  const valid = Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b <= 9999 && b >= a && b - a < 300;

  return (
    <Dialog open={open} onClose={onClose} title={t('admin.tables.addRooms')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return setError(t('errors.invalid_range'));
          const f = parseFloor(floor);
          if (f === undefined) return setError(t('errors.invalid_floor'));
          setBusy(true);
          setError(null);
          try {
            await onAdd(a, b, f);
          } catch (err) {
            setError(describeError(t, err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="font-serif text-2xl font-medium">{t('admin.tables.addRooms')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('admin.tables.from')}>
            <input
              className="field tabular"
              inputMode="numeric"
              data-autofocus
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (!floorTouched) setFloor(String(floorFromNumber(Number(e.target.value)) ?? ''));
              }}
              required
            />
          </Field>
          <Field label={t('admin.tables.to')}>
            <input className="field tabular" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} required />
          </Field>
        </div>
        <Field label={t('admin.tables.floorField')} hint={t('admin.tables.floorHint')}>
          <input
            className="field tabular w-[140px]"
            inputMode="numeric"
            placeholder="—"
            value={floor}
            onChange={(e) => {
              setFloor(e.target.value);
              setFloorTouched(true);
            }}
          />
        </Field>
        <p className="text-[13px] leading-snug text-stone">{t('admin.tables.roomsHint')}</p>
        {valid ? <p className="text-sm font-semibold">{tp('admin.tables.roomsSummary', b - a + 1)}</p> : null}
        <ErrorNote text={error} />
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" busy={busy} disabled={!valid}>{t('admin.tables.addRooms')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
