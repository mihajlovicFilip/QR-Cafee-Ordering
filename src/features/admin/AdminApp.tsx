/**
 * Administration — access gate, sidebar and the admin routes.
 *
 * Without a session it sends people to the staff sign-in (/prijava), which brings them back to the
 * same page, and at the end of the working day it signs them out the same way. Only active owners
 * and managers get in; a waiter who reaches it sees a "no access" screen. The waiter dashboard is
 * one tap away, at the top on phones and in the sidebar on wide screens. The
 * database applies the same rule to every admin call (is_manager), so this gate is a courtesy,
 * not the protection. The sidebar names the establishment's edition, and its tables entry follows
 * it: tables for Stočić Café, tables and rooms for Stočić Hotel.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ConciergeBell, LayoutDashboard, Lock, LogOut, QrCode, Settings, UsersRound, UtensilsCrossed } from 'lucide-react';
import { backend, MANAGER_ROLES, type StaffSession } from '../../api';
import { useI18n } from '../../i18n';
import { Button, CenterState, IconButton, LangSwitch, Spinner } from '../../components/ui';
import { ToastProvider } from '../../components/Toast';
import { editionName, isHotel } from '../../lib/edition';
import { useSignInEnd } from '../../lib/hooks';
import { initials } from './parts';
import { Overview } from './Overview';
import { MenuPage } from './MenuPage';
import { TablesPage } from './TablesPage';
import { StaffPage } from './StaffPage';
import { SettingsPage } from './SettingsPage';

export default function AdminApp() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState<StaffSession | null | undefined>(undefined);

  useEffect(() => {
    backend.staffSession().then(setSession).catch(() => setSession(null));
  }, []);

  const signOut = useCallback(async () => {
    await backend.signOut();
    setSession(null);
  }, []);

  const dayEnded = useCallback(async () => {
    await backend.signOut();
    navigate(`/prijava?next=${encodeURIComponent(pathname)}`, { replace: true, state: { dayEnded: true } });
  }, [navigate, pathname]);

  if (session === undefined) return <Spinner label={t('common.loading')} />;
  if (!session) return <Navigate to={`/prijava?next=${encodeURIComponent(pathname)}`} replace />;
  if (!MANAGER_ROLES.includes(session.role)) {
    return (
      <CenterState
        icon={<Lock size={32} strokeWidth={1.5} />}
        title={t('admin.noAccessTitle')}
        body={t('admin.noAccessBody')}
        action={
          <div className="flex flex-wrap justify-center gap-2.5">
            <Link to="/waiter" className="inline-flex h-12 items-center rounded-[14px] bg-espresso px-5 text-[15px] font-semibold text-paper no-underline">{t('admin.toWaiter')}</Link>
            <Button variant="ghost" onClick={signOut}>{t('admin.switchAccount')}</Button>
          </div>
        }
      />
    );
  }
  return (
    <ToastProvider>
      <AdminShell session={session} onSession={setSession} onSignOut={signOut} onDayEnded={dayEnded} />
    </ToastProvider>
  );
}

const NAV = [
  { to: '/admin', end: true, key: 'overview', icon: LayoutDashboard },
  { to: '/admin/menu', key: 'menu', icon: UtensilsCrossed },
  { to: '/admin/tables', key: 'tables', icon: QrCode },
  { to: '/admin/staff', key: 'staff', icon: UsersRound },
  { to: '/admin/settings', key: 'settings', icon: Settings },
] as const;

function AdminShell({ session, onSession, onSignOut, onDayEnded }: {
  session: StaffSession;
  onSession: (s: StaffSession) => void;
  onSignOut: () => void;
  onDayEnded: () => void;
}) {
  const { t } = useI18n();
  const cafe = session.cafe;
  useSignInEnd(session.until, onDayEnded);

  // After the settings page saves, pick up the new name and colour everywhere.
  const refreshSession = useCallback(() => {
    void backend.staffSession().then((s) => s && onSession(s));
  }, [onSession]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_minmax(0,1fr)]" style={{ '--ac': cafe.accent } as CSSProperties}>
      <aside className="z-20 flex flex-col gap-4 border-b border-line bg-paper px-4 py-4 lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0 lg:px-4 lg:py-6">
        <div className="flex items-center gap-3 px-1">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--ac) font-serif text-[22px] font-semibold text-white" aria-hidden>
            {cafe.name.replace(/^kafe\S*\s+/i, '').charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-serif text-[17px] leading-tight font-semibold">{cafe.name}</p>
            <p className="text-[13px] text-stone">
              {t('admin.title')} · <span className="whitespace-nowrap">{editionName(cafe.edition)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 lg:hidden">
            <Link
              to="/waiter"
              aria-label={t('admin.toWaiter')}
              title={t('admin.toWaiter')}
              className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line-strong bg-paper px-3 text-[13px] font-semibold text-espresso no-underline transition hover:bg-[#f5efe6]"
            >
              <ConciergeBell size={16} aria-hidden />
              <span className="hidden sm:inline">{t('admin.toWaiter')}</span>
            </Link>
            <LangSwitch />
          </div>
        </div>

        <nav aria-label={t('admin.title')} className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 lg:mx-0 lg:mt-2 lg:flex-col lg:overflow-visible lg:px-0">
          {NAV.map(({ to, key, icon: Icon, ...rest }) => (
            <NavLink
              key={key}
              to={to}
              end={'end' in rest}
              className={({ isActive }) =>
                `flex h-11 shrink-0 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold no-underline transition ${
                  isActive ? 'bg-espresso text-paper' : 'text-stone-dark hover:bg-sand hover:text-ink'
                }`
              }
            >
              <Icon size={18} aria-hidden />
              {t(key === 'tables' && isHotel(cafe) ? 'admin.nav.tablesHotel' : `admin.nav.${key}`)}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto hidden flex-col gap-3 lg:flex">
          <Link to="/waiter" className="flex h-11 items-center gap-3 rounded-xl border border-line-strong px-3 text-sm font-semibold text-ink no-underline transition hover:bg-sand">
            <ConciergeBell size={17} aria-hidden />
            {t('admin.toWaiter')}
          </Link>
          {backend.mode === 'demo' ? <span className="self-start rounded-full bg-tint px-2.5 py-1 text-xs font-semibold text-copper-ink">{t('common.demoBadge')}</span> : null}
          <div className="flex items-center justify-between gap-2">
            <LangSwitch />
          </div>
          <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-ivory py-1.5 pr-1 pl-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-espresso text-xs font-bold text-paper" aria-hidden>{initials(session.name)}</span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-[13px] font-semibold">{session.name}</span>
              <span className="text-[11px] text-stone">{t(`waiter.roles.${session.role}`)}</span>
            </span>
            <IconButton label={t('admin.signOut')} onClick={onSignOut} className="size-9 rounded-full">
              <LogOut size={16} />
            </IconButton>
          </div>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-[1240px] px-4 pt-6 pb-16 sm:px-8 lg:pt-9">
        <Routes>
          <Route index element={<Overview session={session} />} />
          <Route path="menu" element={<MenuPage session={session} />} />
          <Route path="tables" element={<TablesPage session={session} />} />
          <Route path="staff" element={<StaffPage session={session} />} />
          <Route path="settings" element={<SettingsPage session={session} onSaved={refreshSession} />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
        <div className="mt-12 flex items-center justify-between gap-3 border-t border-line pt-4 lg:hidden">
          <Link to="/waiter" className="text-sm font-semibold text-copper-ink">{t('admin.toWaiter')}</Link>
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            <LogOut size={14} aria-hidden />
            {t('admin.signOut')}
          </Button>
        </div>
      </main>
    </div>
  );
}
