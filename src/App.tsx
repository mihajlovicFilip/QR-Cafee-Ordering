import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { useI18n } from './i18n';
import { CenterState, Spinner } from './components/ui';
import { ToastProvider } from './components/Toast';

const Home = lazy(() => import('./features/home/Home'));
const GuestApp = lazy(() => import('./features/guest/GuestApp'));
const WaiterApp = lazy(() => import('./features/waiter/WaiterApp'));
const AdminApp = lazy(() => import('./features/admin/AdminApp'));

export default function App() {
  const { t } = useI18n();
  return (
    <BrowserRouter>
      <Suspense fallback={<Spinner label={t('common.loading')} />}>
        <Routes>
          <Route path="/" element={<ToastProvider><Home /></ToastProvider>} />
          <Route path="/t/:token" element={<GuestApp />} />
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
