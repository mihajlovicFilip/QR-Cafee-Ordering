/**
 * Staff sign-in — one page (/prijava) for everyone who works in the establishment.
 *
 * Waiters and baristas go on to the waiter dashboard, owners and managers to administration. A
 * `next` path brings people back to where they were sent from, but only to /waiter or /admin, and
 * to /admin only for managers. Staff sign in with a username and a PIN; on a Supabase database,
 * which has no PINs yet, with email and password.
 *
 * A sign-in lasts until the end of the working day. Waiters already signed in on this device are
 * listed first and come back with one tap; "Waiter sign-in" below the list is for those who have
 * not signed in yet, and a waiter who goes home early ends their shift from the list. Owners and
 * managers are never listed and type their username and PIN every time. The demo lists its
 * accounts under the form: a click fills in a waiter (or lets one already signed in straight
 * back), while the owner and managers have to be typed.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, LogOut, UserPlus } from 'lucide-react';
import { backend, MANAGER_ROLES, PIN_MAX_LENGTH, PIN_MIN_LENGTH, type DemoStaff, type ShiftMember, type StaffSession } from '../../api';
import { useI18n } from '../../i18n';
import { describeError } from '../../lib/errors';
import { Button, IconButton, LangSwitch, Spinner } from '../../components/ui';

/** Where a signed-in person goes: back to `next` when they may open it, otherwise their own panel. */
function landing(role: string, next: string | null): string {
  const manager = MANAGER_ROLES.includes(role);
  if (next && /^\/waiter(?:[/?#]|$)/.test(next)) return next;
  if (next && manager && /^\/admin(?:[/?#]|$)/.test(next)) return next;
  return manager ? '/admin' : '/waiter';
}

export default function LoginPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const { state } = useLocation();
  const [session, setSession] = useState<StaffSession | null | undefined>(undefined);
  const [shift, setShift] = useState<ShiftMember[]>([]);

  useEffect(() => {
    Promise.all([backend.staffSession(), backend.shiftStaff()])
      .then(([current, list]) => {
        setShift(list);
        setSession(current);
      })
      .catch(() => setSession(null));
  }, []);

  if (session === undefined) return <Spinner label={t('common.loading')} />;
  if (session) return <Navigate to={landing(session.role, params.get('next'))} replace />;
  const dayEnded = !!(state as { dayEnded?: boolean } | null)?.dayEnded;
  return <SignIn shift={shift} dayEnded={dayEnded} onSignedIn={setSession} />;
}

function SignIn({ shift, dayEnded, onSignedIn }: { shift: ShiftMember[]; dayEnded: boolean; onSignedIn: (s: StaffSession) => void }) {
  const { t, time } = useI18n();
  const pin = backend.staffSignIn === 'pin';
  const pinHint = t('login.pinHint', { min: PIN_MIN_LENGTH, max: PIN_MAX_LENGTH });
  const [accounts] = useState(() => (backend.mode === 'demo' ? backend.demoStaff() : []));
  const [list, setList] = useState(shift);
  // With nobody signed in yet there is nothing to pick from: straight to the form.
  const [adding, setAdding] = useState(shift.length === 0);
  const [user, setUser] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const userField = useRef<HTMLInputElement>(null);
  const secretField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = `${t('login.title')} · Stočić`;
  }, [t]);

  async function run(id: string, fn: () => Promise<StaffSession>) {
    setBusy(id);
    setError(null);
    try {
      onSignedIn(await fn());
    } catch (err) {
      setError(describeError(t, err));
      // A wrong PIN is typed again from scratch, as on a card terminal.
      if (id === 'form' && pin) {
        setSecret('');
        secretField.current?.focus();
      }
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run('form', () => (pin ? backend.signInWithPin(user, secret) : backend.signIn(user.trim(), secret)));
  }

  function showForm(open: boolean) {
    setAdding(open);
    setError(null);
    if (open) setTimeout(() => userField.current?.focus());
  }

  async function endShift(member: ShiftMember) {
    await backend.endShift(member.staffId);
    const rest = list.filter((m) => m.staffId !== member.staffId);
    setList(rest);
    if (!rest.length) showForm(true);
  }

  function fill(account: DemoStaff) {
    setUser(account.username);
    setSecret(account.pin);
    setError(null);
    form.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2.5 rounded-lg no-underline">
          <span className="flex size-9 items-center justify-center rounded-[10px] bg-espresso font-serif text-xl font-semibold text-tint">S</span>
          <span className="font-serif text-lg font-semibold text-ink">Stočić</span>
        </Link>
        <LangSwitch />
      </header>
      <main className="flex flex-1 items-center justify-center px-5 pb-16">
        <div className="flex w-full max-w-[400px] animate-rise flex-col gap-4">
          <div className="card flex flex-col gap-5 p-7">
            <div className="flex flex-col gap-1.5">
              <h1 className="font-serif text-[28px] leading-tight font-medium">{t('login.title')}</h1>
              <p className="text-sm leading-relaxed text-stone">
                {!adding ? t('login.shiftHint') : pin ? t('login.subtitle') : t('login.subtitleEmail')}
              </p>
            </div>

            {dayEnded ? (
              <p role="status" className="rounded-xl bg-tint px-3.5 py-2.5 text-[13px] leading-snug font-semibold text-copper-ink">{t('login.dayEnded')}</p>
            ) : null}

            {!adding ? (
              <div className="flex flex-col gap-4">
                <section className="flex flex-col gap-2" aria-labelledby="on-shift">
                  <h2 id="on-shift" className="label">{t('login.onShift')}</h2>
                  <ul className="-mx-2.5 flex flex-col gap-0.5">
                    {list.map((m) => (
                      <li key={m.staffId} className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => run(m.staffId, () => backend.resumeShift(m.staffId))}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-sand disabled:opacity-60"
                        >
                          <Avatar name={m.name} />
                          <span className="flex min-w-0 flex-1 flex-col leading-tight">
                            <span className="truncate text-[15px] font-semibold">{m.name}</span>
                            <span className="text-xs text-stone">{t(`waiter.roles.${m.role}`)}</span>
                          </span>
                          <span className="shrink-0 text-xs font-semibold text-success">
                            {busy === m.staffId ? t('common.loading') : t('login.until', { time: time(m.until) })}
                          </span>
                        </button>
                        <IconButton label={t('login.endShift', { name: m.name })} disabled={!!busy} onClick={() => void endShift(m)} className="size-10 text-stone hover:text-danger">
                          <LogOut size={15} />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                </section>
                <Button onClick={() => showForm(true)} disabled={!!busy}>
                  <UserPlus size={17} aria-hidden />
                  {t('login.waiterSignIn')}
                </Button>
              </div>
            ) : (
              <form ref={form} className="flex flex-col gap-4" onSubmit={submit}>
                <label className="flex flex-col gap-2">
                  <span className="label">{pin ? t('login.username') : t('login.email')}</span>
                  <input
                    ref={userField}
                    className="field"
                    type={pin ? 'text' : 'email'}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                  />
                </label>
                {pin ? (
                  <div className="flex flex-col gap-2">
                    <label className="flex flex-col gap-2">
                      <span className="label">{t('login.pin')}</span>
                      <input
                        ref={secretField}
                        className="field font-mono tracking-[0.5em]"
                        type="password"
                        inputMode="numeric"
                        // A PIN belongs to one person: a shared tablet must not offer to remember it.
                        autoComplete="off"
                        pattern={`\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}`}
                        title={pinHint}
                        maxLength={PIN_MAX_LENGTH}
                        required
                        value={secret}
                        onChange={(e) => setSecret(e.target.value.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH))}
                        aria-describedby="pin-hint"
                      />
                    </label>
                    <span id="pin-hint" className="text-xs text-stone">{pinHint}</span>
                  </div>
                ) : (
                  <label className="flex flex-col gap-2">
                    <span className="label">{t('login.password')}</span>
                    <input className="field" type="password" autoComplete="current-password" required value={secret} onChange={(e) => setSecret(e.target.value)} />
                  </label>
                )}
                <Button type="submit" busy={busy === 'form'}>{t('login.submit')}</Button>
                {list.length ? (
                  <button type="button" onClick={() => showForm(false)} className="inline-flex items-center justify-center gap-1.5 self-center text-sm font-semibold text-copper-ink">
                    <ArrowLeft size={15} aria-hidden />
                    {t('login.onShift')}
                  </button>
                ) : null}
              </form>
            )}

            {error ? (
              <p role="alert" className="rounded-xl bg-[#f5deda] px-3.5 py-2.5 text-[13px] font-semibold text-danger">{error}</p>
            ) : null}
          </div>

          {adding && accounts.length ? (
            <section className="card flex flex-col gap-3 p-5" aria-labelledby="demo-accounts">
              <div className="flex flex-col gap-1">
                <h2 id="demo-accounts" className="label">{t('login.demoTitle')}</h2>
                <p className="text-[13px] leading-relaxed text-stone">{t('login.demoHint')}</p>
              </div>
              <ul className="flex flex-col gap-0.5">
                {accounts.map((a) => {
                  const onShift = list.find((m) => m.staffId === a.id);
                  const body = (
                    <>
                      <Avatar name={a.name} />
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="truncate text-sm font-semibold">{a.name}</span>
                        <span className="text-xs text-stone">{t(`waiter.roles.${a.role}`)}</span>
                      </span>
                      {onShift ? (
                        <span className="shrink-0 text-xs font-semibold text-success">{t('login.until', { time: time(onShift.until) })}</span>
                      ) : (
                        <span className="flex shrink-0 flex-col items-end font-mono text-xs leading-tight text-stone-dark">
                          <span>{a.username}</span>
                          <span>PIN {a.pin}</span>
                        </span>
                      )}
                    </>
                  );
                  return (
                    <li key={a.id}>
                      {MANAGER_ROLES.includes(a.role) ? (
                        // Owners and managers type their username and PIN every time: nothing to click.
                        <div className="flex items-center gap-3 px-2.5 py-2">{body}</div>
                      ) : (
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => (onShift ? run(a.id, () => backend.resumeShift(a.id)) : fill(a))}
                          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-sand disabled:opacity-60"
                        >
                          {body}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-espresso text-xs font-bold text-paper" aria-hidden>
      {name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
    </span>
  );
}
