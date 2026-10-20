import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { backend, type StaffSession } from '../api';
import { useI18n } from '../i18n';
import { describeError } from '../lib/errors';
import { Button, LangSwitch } from './ui';

/** Staff sign-in shared by the waiter panel and the admin panel. */
export function StaffLogin({ onSignedIn, variant = 'waiter', roles }: {
  onSignedIn: (s: StaffSession) => void;
  variant?: 'waiter' | 'admin';
  /** Demo mode only: which demo accounts to offer. */
  roles?: string[];
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const demo = backend.mode === 'demo';
  const copy = variant === 'admin'
    ? { title: t('admin.login.title'), subtitle: t('admin.login.subtitle'), demoTitle: t('admin.login.demoTitle'), demoSubtitle: t('admin.login.demoSubtitle') }
    : { title: t('login.title'), subtitle: t('login.subtitle'), demoTitle: t('login.demoTitle'), demoSubtitle: t('login.demoSubtitle') };

  async function run(id: string, fn: () => Promise<StaffSession>) {
    setBusy(id);
    setError(null);
    try {
      onSignedIn(await fn());
    } catch (e) {
      setError(describeError(t, e));
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run('form', () => backend.signIn(email.trim(), password));
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2.5 rounded-lg no-underline">
          <span className="flex size-9 items-center justify-center rounded-[10px] bg-espresso font-serif text-xl font-semibold text-tint">S</span>
          <span className="font-serif text-lg font-semibold text-ink">Stolić</span>
        </Link>
        <LangSwitch />
      </header>
      <main className="flex flex-1 items-center justify-center px-5 pb-16">
        <div className="card flex w-full max-w-[400px] animate-rise flex-col gap-5 p-7">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-serif text-[28px] leading-tight font-medium">{demo ? copy.demoTitle : copy.title}</h1>
            <p className="text-sm leading-relaxed text-stone">{demo ? copy.demoSubtitle : copy.subtitle}</p>
          </div>
          {demo ? (
            <div className="flex flex-col gap-2.5">
              {backend
                .demoStaff()
                .filter((s) => !roles || roles.includes(s.role))
                .map((s) => (
                  <Button key={s.id} variant="ghost" className="justify-start gap-3 px-3" busy={busy === s.id} disabled={!!busy} onClick={() => run(s.id, () => backend.demoSignIn(s.id))}>
                    <span className="flex size-8 items-center justify-center rounded-full bg-espresso text-xs font-bold text-paper" aria-hidden>
                      {s.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                    </span>
                    <span className="flex flex-col items-start leading-tight">
                      <span>{s.name}</span>
                      <span className="text-xs font-medium text-stone">{t(`waiter.roles.${s.role}`)}</span>
                    </span>
                  </Button>
                ))}
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <label className="flex flex-col gap-2">
                <span className="label">{t('login.email')}</span>
                <input className="field" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="flex flex-col gap-2">
                <span className="label">{t('login.password')}</span>
                <input className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <Button type="submit" busy={busy === 'form'}>{t('login.submit')}</Button>
            </form>
          )}
          {error ? (
            <p role="alert" className="rounded-xl bg-[#f5deda] px-3.5 py-2.5 text-[13px] font-semibold text-danger">{error}</p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
