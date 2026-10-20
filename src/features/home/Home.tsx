import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BedDouble, ChevronRight, ConciergeBell, LayoutDashboard, LayoutGrid, RefreshCw, Smartphone } from 'lucide-react';
import { backend, type DiningTable } from '../../api';
import { DEMO_CAFE, DEMO_TABLES } from '../../api/seedData';
import { useI18n } from '../../i18n';
import { Button, LangSwitch } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function Home() {
  const { t } = useI18n();
  const toast = useToast();
  const demo = backend.mode === 'demo';
  // In the demo the admin can add, remove or re-key tables, so list what is there now.
  const [tables, setTables] = useState<DiningTable[]>(DEMO_TABLES);
  const refreshTables = () => {
    if (demo) void backend.cafeTables(DEMO_CAFE.id).then(setTables);
  };

  useEffect(() => {
    document.title = 'Stočić';
    refreshTables();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onlyTables = tables.filter((tb) => tb.kind !== 'room');
  // With 90 rooms, list only the first room of each floor; the admin panel has them all.
  const rooms = tables.filter((tb) => tb.kind === 'room');
  const roomSamples = rooms.filter((r, i) => i === 0 || Math.floor(r.number / 100) !== Math.floor(rooms[i - 1].number / 100)).slice(0, 8);
  const guestToken = onlyTables.find((tb) => tb.number === 7)?.token ?? onlyTables[0]?.token;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[960px] flex-col px-5 sm:px-8">
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-espresso font-serif text-[22px] font-semibold text-tint" aria-hidden>S</span>
          <span className="font-serif text-xl font-semibold">Stočić</span>
          {demo ? <span className="ml-1 rounded-full bg-tint px-2.5 py-1 text-xs font-semibold text-copper-ink">{t('common.demoBadge')}</span> : null}
        </div>
        <LangSwitch />
      </header>

      <main className="flex flex-1 flex-col gap-10 pt-6 pb-16 sm:pt-12">
        <div className="flex max-w-[640px] flex-col gap-4">
          <h1 className="font-serif text-[40px] leading-[1.05] font-medium tracking-[-0.02em] sm:text-[56px]">
            {demo ? t('home.title') : t('home.supabaseTitle')}
          </h1>
          <p className="text-lg leading-relaxed text-stone-dark">{demo ? t('home.lede') : t('home.supabaseLede')}</p>
        </div>

        <div className={`grid gap-4 sm:grid-cols-2 ${demo ? 'lg:grid-cols-3' : ''}`}>
          {demo && guestToken ? (
            <HomeCard to={`/t/${guestToken}`} icon={<Smartphone size={22} />} title={t('home.guestCard')} hint={t('home.guestCardHint')} />
          ) : null}
          <HomeCard to="/waiter" icon={<ConciergeBell size={22} />} title={t('home.waiterCard')} hint={t('home.waiterCardHint')} />
          <HomeCard to="/admin" icon={<LayoutDashboard size={22} />} title={t('home.adminCard')} hint={t('home.adminCardHint')} />
        </div>

        {demo ? (
          <>
            <p className="text-sm text-stone">{t('home.tip')}</p>
            <section className="flex flex-col gap-3">
              <h2 className="label flex items-center gap-2"><LayoutGrid size={14} aria-hidden />{t('home.allTables')}</h2>
              <ul className="flex flex-wrap gap-2">
                {onlyTables.map((tb) => (
                  <li key={tb.id}>
                    <Link to={`/t/${tb.token}`} className="chip no-underline text-ink">{t('common.table', { n: tb.number })}</Link>
                  </li>
                ))}
              </ul>
            </section>
            {roomSamples.length ? (
              <section className="flex flex-col gap-3">
                <h2 className="label flex items-center gap-2"><BedDouble size={14} aria-hidden />{t('home.rooms')}</h2>
                <ul className="flex flex-wrap gap-2">
                  {roomSamples.map((r) => (
                    <li key={r.id}>
                      <Link to={`/t/${r.token}`} className="chip no-underline text-ink">{t('common.room', { n: r.number })}</Link>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-stone">{t('home.roomsHint')}</p>
              </section>
            ) : null}
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  backend.resetDemo();
                  refreshTables();
                  try {
                    Object.keys(sessionStorage).filter((k) => k.startsWith('stolic.cart.')).forEach((k) => sessionStorage.removeItem(k));
                  } catch {
                    /* ignore */
                  }
                  toast(t('home.resetDone'));
                }}
              >
                <RefreshCw size={14} aria-hidden />
                {t('home.resetDemo')}
              </Button>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function HomeCard({ to, icon, title, hint }: { to: string; icon: ReactNode; title: string; hint: string }) {
  return (
    <Link to={to} className="card group flex items-center gap-4 p-5 text-ink no-underline transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-22px_rgba(43,29,22,.45)]">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-tint text-copper-ink" aria-hidden>{icon}</span>
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-base font-semibold">{title}</span>
        <span className="text-sm text-stone">{hint}</span>
      </span>
      <ChevronRight className="text-stone transition group-hover:translate-x-0.5" size={20} aria-hidden />
    </Link>
  );
}
