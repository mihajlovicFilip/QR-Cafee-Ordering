/**
 * Routes — the ways into Stočić.
 *
 *   /           home: demo links, or the staff entry points on a real database
 *   /t/:token   the guest menu behind a table's or a room's QR code
 *   /prijava    staff sign-in; waiters go on to /waiter, owners and managers to /admin
 *   /waiter     the waiter dashboard
 *   /admin/*    administration, owners and managers only
 *
 * Every screen loads on demand, so a guest who scans a code downloads the guest app and nothing
 * of the staff screens. The router's basename follows Vite's base: the same build also runs from
 * a sub-folder (GitHub Pages).
 */

import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { useI18n } from './i18n';
import { CenterState, Spinner } from './components/ui';
import { ToastProvider } from './components/Toast';

const Home = lazy(() => import('./features/home/Home'));
const GuestApp = lazy(() => import('./features/guest/GuestApp'));
const LoginPage = lazy(() => import('./features/login/LoginPage'));
const WaiterApp = lazy(() => import('./features/waiter/WaiterApp'));
const AdminApp = lazy(() => import('./features/admin/AdminApp'));

// '/' locally, '/QR-Cafee-Ordering' on GitHub Pages (see vite.config.ts).
const BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';

export default function App() {
  const { t } = useI18n();
  return (
    <BrowserRouter basename={BASENAME}>
      <Suspense fallback={<Spinner label={t('common.loading')} />}>
        <Routes>
          <Route path="/" element={<ToastProvider><Home /></ToastProvider>} />
          <Route path="/t/:token" element={<GuestApp />} />
          <Route path="/prijava" element={<LoginPage />} />
          <Route path="/waiter" element={<WaiterApp />} />
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

function NotFound() {
  const { t } = useI18n();
  return (
    <CenterState
      icon={<span className="font-serif text-3xl">?</span>}
      title={t('home.notFound')}
      action={<Link to="/" className="font-semibold text-copper-ink">{t('home.goHome')}</Link>}
    />
  );
}
