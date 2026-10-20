import { useMemo, useState } from 'react';
import { ChevronRight, ConciergeBell, Plus, Search, X } from 'lucide-react';
import type { Order, TableMenu } from '../../api/types';
import { defaultChoices } from '../../api/pricing';
import { useI18n } from '../../i18n';
import { displayStatus, mmss, placeKey } from '../../lib/orderView';
import { Button, IconButton, LangSwitch, ProductTile, StatusBadge } from '../../components/ui';
import { useToast } from '../../components/Toast';
import type { Cart } from './useCart';

/** Case- and diacritic-insensitive: "cokolad" finds "Čokoladni", "djumbir" finds "đumbir". */
const normalize = (s: string) => s.toLowerCase().replace(/đ/g, 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '');

interface Props {
  menu: TableMenu;
  cart: Cart;
  now: number;
  activeOrder?: Order;
  onOpen: (productId: string) => void;
  onCart: () => void;
  onTrack: () => void;
  onCallWaiter: () => void;
}

export function MenuScreen({ menu, cart, now, activeOrder, onOpen, onCart, onTrack, onCallWaiter }: Props) {
  const { t, loc, money } = useI18n();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const sections = useMemo(() => {
    const q = normalize(query.trim());
    const matches = menu.products.filter((p) => {
      if (category !== 'all' && p.categoryId !== category) return false;
      if (!q) return true;
      // Search every language, so a guest can type either "kafa" or "coffee".
      return normalize([...Object.values(p.name), ...Object.values(p.description)].join(' ')).includes(q);
    });
    return menu.categories
      .filter((c) => category === 'all' || c.id === category)
      .map((c) => ({ category: c, products: matches.filter((p) => p.categoryId === c.id) }))
      .filter((s) => s.products.length > 0);
  }, [menu, query, category]);

  const room = menu.table.kind === 'room';
  const activeStatus = activeOrder ? displayStatus(activeOrder, now) : null;
  const showTimer = activeOrder && (activeStatus === 'accepted' || activeStatus === 'preparing') && activeOrder.deadline;

  return (
    <div className="pb-44">
      <header className="sticky top-0 z-10 bg-ivory">
        <div className="flex flex-col gap-3.5 px-5 pt-6 pb-2.5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-(--ac) font-serif text-2xl font-semibold text-white" aria-hidden>
              {menu.cafe.name.replace(/^kafe\S*\s+/i, '').charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-serif text-[19px] leading-tight font-semibold">{menu.cafe.name}</h1>
              <p className="mt-0.5 text-[13px] text-stone">
                <span className="font-semibold text-ink">{t(placeKey(menu.table.kind), { n: menu.table.number })}</span>
                <span aria-hidden> · </span>
                {room ? t('guest.roomService') : t('guest.openNow')}
              </p>
            </div>
            <LangSwitch />
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-3.5 left-3.5 size-5 text-stone" aria-hidden />
            <input
              type="search"
              className="field h-12 bg-paper pr-11 pl-11"
              placeholder={t('guest.searchPlaceholder')}
              aria-label={t('guest.searchLabel')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              enterKeyHint="search"
            />
            {query ? (
              <IconButton label={t('guest.clearSearch')} onClick={() => setQuery('')} className="absolute top-0.5 right-0.5 size-11">
                <X size={18} />
              </IconButton>
            ) : null}
          </div>
        </div>
        <nav className="no-scrollbar flex gap-2 overflow-x-auto px-5 pt-0.5 pb-3" aria-label={t('guest.searchLabel')}>
          {[{ id: 'all', label: t('guest.all') }, ...menu.categories.map((c) => ({ id: c.id, label: loc(c.name) }))].map((c) => (
            <button key={c.id} type="button" className="chip" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
              {c.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex flex-col gap-6 px-5 pt-1">
        {sections.map(({ category: c, products }) => (
          <section key={c.id} className="flex flex-col gap-2.5" aria-labelledby={`cat-${c.id}`}>
            <h2 id={`cat-${c.id}`} className="font-serif text-xl font-medium">{loc(c.name)}</h2>
            {products.map((p) => {
              const name = loc(p.name);
              const inCart = cart.qtyOf(p.id);
              return (
                <article
                  key={p.id}
                  className={`flex animate-rise items-center rounded-[18px] border border-line bg-paper p-2.5 transition hover:shadow-[0_10px_24px_-16px_rgba(43,29,22,.35)] ${p.available ? '' : 'opacity-60'}`}
                >
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3.5 rounded-xl text-left disabled:cursor-default" onClick={() => onOpen(p.id)} disabled={!p.available}>
                    <ProductTile icon={c.icon} imageUrl={p.imageUrl} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-[15px] font-semibold">{name}</span>
                      <span className="clamp-2 text-[13px] leading-snug text-stone">{loc(p.description)}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="tabular text-sm font-semibold">{money(p.price)}</span>
                        {!p.available ? <span className="rounded-full bg-[#ece6de] px-2 py-0.5 text-[11px] font-semibold text-[#584f47]">{t('guest.unavailable')}</span> : null}
                        {inCart ? <span className="rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold text-copper-ink">{t('guest.inCart', { n: inCart })}</span> : null}
                      </span>
                    </span>
                  </button>
                  {p.available ? (
                    <button
                      type="button"
                      aria-label={t('guest.addToCartAria', { name })}
                      onClick={() => {
                        cart.add(p.id, 1, defaultChoices(p), '');
                        toast(t('guest.addedToCart', { name }));
                      }}
                      className="ml-2 flex size-11 shrink-0 items-center justify-center self-end rounded-[14px] bg-(--ac) text-white transition active:scale-90"
                    >
                      <Plus size={20} />
                    </button>
                  ) : null}
                </article>
              );
            })}
          </section>
        ))}

        {sections.length === 0 ? (
          <div className="flex animate-rise flex-col items-center gap-2.5 px-4 py-10 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-sand text-stone">
              <Search size={28} aria-hidden />
            </div>
            <p className="font-serif text-xl font-medium">{query ? t('guest.noResults', { q: query }) : t('guest.emptyMenu')}</p>
            {query ? (
              <>
                <p className="text-sm leading-relaxed text-stone">{t('guest.noResultsHint')}</p>
                <Button variant="ghost" size="sm" onClick={() => { setQuery(''); setCategory('all'); }}>
                  {t('guest.clearSearch')}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20">
        <div className="mx-auto flex max-w-[480px] flex-col gap-2.5 border-t border-[#e8e0d4] bg-ivory px-4 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]">
          {activeOrder && activeStatus ? (
            <button
              type="button"
              onClick={onTrack}
              className="flex h-[46px] animate-rise items-center gap-2.5 rounded-[14px] border border-line bg-paper pr-3 pl-2.5 text-left"
            >
              <StatusBadge status={activeStatus} />
              <span className="flex-1 truncate text-[13px] font-semibold">{t('common.orderNo', { n: activeOrder.number })}</span>
              {showTimer ? <span className="tabular text-sm font-bold">{mmss(activeOrder.deadline! - now)}</span> : null}
              <ChevronRight size={16} aria-hidden />
            </button>
          ) : null}
          <div className="flex gap-2.5">
            {menu.cafe.callButton && !room ? (
              <IconButton label={t('guest.callWaiter')} onClick={onCallWaiter} className="size-[52px] border border-line-strong bg-paper">
                <ConciergeBell size={20} />
              </IconButton>
            ) : null}
            <Button variant="accent" size="lg" className="flex-1 justify-between px-4" onClick={onCart} disabled={cart.count === 0}>
              <span className="flex items-center gap-2.5">
                <span className="tabular inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full bg-white/20 px-1.5 text-[13px] font-bold">{cart.count}</span>
                {cart.count ? t('guest.viewCart') : t('guest.cartEmptyShort')}
              </span>
              <span className="tabular ml-auto">{money(cart.total)}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
