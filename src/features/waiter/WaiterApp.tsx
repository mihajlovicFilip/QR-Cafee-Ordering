/** The waiter app — staff sign-in, then the dashboard. */

import { useEffect, useState } from 'react';
import { backend, type StaffSession } from '../../api';
import { useI18n } from '../../i18n';
import { Spinner } from '../../components/ui';
import { StaffLogin } from '../../components/StaffLogin';
import { ToastProvider } from '../../components/Toast';
import { Dashboard } from './Dashboard';

export default function WaiterApp() {
  const { t } = useI18n();
  const [session, setSession] = useState<StaffSession | null | undefined>(undefined);

  useEffect(() => {
    backend.staffSession().then(setSession).catch(() => setSession(null));
  }, []);

  if (session === undefined) return <Spinner label={t('common.loading')} />;
  if (!session) return <StaffLogin onSignedIn={setSession} />;
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
