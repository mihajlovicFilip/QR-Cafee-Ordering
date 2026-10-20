import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { QrCode, WifiOff } from 'lucide-react';
import { backend, type Order, type TableMenu } from '../../api';
import { useI18n } from '../../i18n';
import { useLive, useNow } from '../../lib/hooks';
import { isOpen, placeKey } from '../../lib/orderView';
import { describeError } from '../../lib/errors';
import { Button, CenterState, Spinner } from '../../components/ui';
import { ToastProvider, useToast } from '../../components/Toast';
import { useCart } from './useCart';
import { MenuScreen } from './MenuScreen';
import { ProductSheet } from './ProductSheet';
import { CartScreen } from './CartScreen';
import { TrackScreen } from './TrackScreen';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'invalid' } | { state: 'ready'; menu: TableMenu };

export default function GuestApp() {
  const { token = '' } = useParams();
  const { t, setFallbackLang } = useI18n();
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  const fetchMenu = useCallback(() => {
    setLoad({ state: 'loading' });
    backend
      .loadTable(token)
      .then((menu) => {
        if (!menu) return setLoad({ state: 'invalid' });
        setFallbackLang(menu.cafe.defaultLang);
        setLoad({ state: 'ready', menu });
      })
      .catch(() => setLoad({ state: 'error' }));
  }, [token, setFallbackLang]);

  useEffect(fetchMenu, [fetchMenu]);

  if (load.state === 'loading') return <Spinner label={t('common.loading')} />;
  if (load.state === 'invalid') {
    return <CenterState icon={<QrCode size={34} strokeWidth={1.5} />} title={t('guest.invalidTitle')} body={t('guest.invalidBody')} />;
  }
  if (load.state === 'error') {
    return (
      <CenterState
        icon={<WifiOff size={34} strokeWidth={1.5} />}
        title={t('guest.loadErrorTitle')}
        body={t('guest.loadErrorBody')}
        action={<Button variant="primary" onClick={fetchMenu}>{t('common.retry')}</Button>}
      />
    );
  }
  return (
    <ToastProvider offset={128}>
      <GuestSession menu={load.menu} token={token} />
    </ToastProvider>
  );
}

type Screen = 'menu' | 'cart' | 'track';

function GuestSession({ menu, token }: { menu: TableMenu; token: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const now = useNow();
  const cart = useCart(token, menu.products);
  const [screen, setScreen] = useState<Screen>('menu');
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const live = useLive(() => backend.myOrders(token), (cb) => backend.subscribeMyOrders(token, cb), [token], 15_000);
  const orders = live.data ?? [];
  const activeOrder = orders.find(isOpen);

  useEffect(() => {
    document.title = `${menu.cafe.name} · ${t(placeKey(menu.table.kind), { n: menu.table.number })}`;
  }, [menu, t]);

  // Tell the guest about changes even when they are looking at the menu.
  const seen = useRef<Map<string, Order['status']> | null>(null);
  useEffect(() => {
    if (!live.data) return;
    const prev = seen.current;
    seen.current = new Map(live.data.map((o) => [o.id, o.status]));
    if (!prev) return;
    for (const o of live.data) {
      const before = prev.get(o.id);
      if (!before || before === o.status) continue;
      if (o.status === 'preparing') toast(t('guest.toastAccepted', { n: o.number }));
      if (o.status === 'ready') {
        toast(t('guest.toastReady'));
        navigator.vibrate?.([120, 80, 120]);
      }
      if (o.status === 'rejected') toast(t('guest.toastRejected', { n: o.number }), 'error');
    }
  }, [live.data, t, toast]);

  async function submit(note: string) {
    setSubmitting(true);
    try {
      const id = await backend.placeOrder(
        token,
        cart.lines.map(({ productId, qty, choices, note: n }) => ({ productId, qty, choices, note: n })),
        note,
      );
      cart.clear();
      setTrackId(id);
      setScreen('track');
      toast(t('guest.orderSent'));
      await live.refresh();
      return true;
    } catch (e) {
      toast(describeError(t, e), 'error');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function callWaiter() {
    try {
      await backend.callWaiter(token);
      toast(t('guest.waiterCalled'));
    } catch (e) {
      toast(describeError(t, e), 'error');
    }
  }

  const sheetProduct = sheetId ? menu.products.find((p) => p.id === sheetId) : undefined;
  const tracked = orders.find((o) => o.id === trackId) ?? orders[0];
  const canOrderMore = menu.cafe.allowRepeat || !activeOrder;

  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-ivory" style={{ '--ac': menu.cafe.accent } as CSSProperties}>
      {screen === 'menu' || (screen === 'track' && !tracked) ? (
        <MenuScreen
          menu={menu}
          cart={cart}
          now={now}
          activeOrder={activeOrder}
          onOpen={(id) => setSheetId(id)}
          onCart={() => setScreen('cart')}
          onTrack={() => {
            setTrackId(activeOrder?.id ?? null);
            setScreen('track');
          }}
          onCallWaiter={callWaiter}
        />
      ) : null}
      {screen === 'cart' ? (
        <CartScreen menu={menu} cart={cart} submitting={submitting} onBack={() => setScreen('menu')} onSubmit={submit} />
      ) : null}
      {screen === 'track' && tracked ? (
        <TrackScreen
          menu={menu}
          order={tracked}
          orders={orders}
          now={now}
          canOrderMore={canOrderMore}
          onBack={() => setScreen('menu')}
          onSelect={(id) => setTrackId(id)}
          onCallWaiter={callWaiter}
        />
      ) : null}
      {sheetProduct ? (
        <ProductSheet
          product={sheetProduct}
          icon={menu.categories.find((c) => c.id === sheetProduct.categoryId)?.icon ?? 'coffee'}
          onClose={() => setSheetId(null)}
          onAdd={(qty, choices, note) => {
            cart.add(sheetProduct.id, qty, choices, note);
            setSheetId(null);
          }}
        />
      ) : null}
    </div>
  );
}
