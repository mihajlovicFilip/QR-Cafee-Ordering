/** The waiter app — the dashboard, behind the staff sign-in (/prijava). */

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { backend, type StaffSession } from '../../api';
import { useI18n } from '../../i18n';
import { Spinner } from '../../components/ui';
import { ToastProvider } from '../../components/Toast';
import { Dashboard } from './Dashboard';

export default function WaiterApp() {
  const { t } = useI18n();
  const [session, setSession] = useState<StaffSession | null | undefined>(undefined);

  useEffect(() => {
    backend.staffSession().then(setSession).catch(() => setSession(null));
  }, []);

  if (session === undefined) return <Spinner label={t('common.loading')} />;
  if (!session) return <Navigate to="/prijava?next=/waiter" replace />;
  return (
    <ToastProvider>
      <Dashboard
        session={session}
        onSignOut={async () => {
          await backend.signOut();
          setSession(null);
        }}
      />
    </ToastProvider>
  );
}
