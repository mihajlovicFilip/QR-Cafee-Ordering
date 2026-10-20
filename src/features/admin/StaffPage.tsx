import { useState } from 'react';
import { Info, UserPlus } from 'lucide-react';
import { backend, STAFF_ROLES, type StaffMember, type StaffRole, type StaffSession } from '../../api';
import { useI18n } from '../../i18n';
import { useLive } from '../../lib/hooks';
import { describeError } from '../../lib/errors';
import { Button, Dialog, Spinner, Switch } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { ErrorNote, Field, initials, PageHeader, useAdminTitle } from './parts';

/** 12 characters without look-alikes (0/O, 1/l/I), easy to read out loud or type on a phone. */
function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function StaffPage({ session }: { session: StaffSession }) {
  const { t } = useI18n();
  const toast = useToast();
  const cafeId = session.cafe.id;
  const isOwner = session.role === 'owner';
  useAdminTitle(t('admin.nav.staff'), session.cafe.name);

  const staff = useLive(() => backend.cafeStaff(cafeId), () => () => {}, [cafeId], 60_000);
  const [inviting, setInviting] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  async function update(m: StaffMember, role: StaffRole, active: boolean, success: string) {
    setPending(m.id);
    try {
      await backend.updateStaff(m.id, role, active);
      toast(success);
    } catch (e) {
      toast(describeError(t, e), 'error');
    } finally {
      setPending(null);
      void staff.refresh();
    }
  }

  if (!staff.data) return staff.error ? <ErrorNote text={describeError(t, staff.error)} /> : <Spinner label={t('common.loading')} />;

  return (
    <div className="flex animate-rise flex-col gap-7">
      <PageHeader
        title={t('admin.staff.title')}
        subtitle={t('admin.staff.subtitle')}
        actions={
          <Button variant="accent" size="sm" onClick={() => setInviting(true)}>
            <UserPlus size={16} aria-hidden />
            {t('admin.staff.invite')}
          </Button>
        }
      />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="text-[11px] font-semibold tracking-[.08em] text-stone uppercase">
              <th scope="col" className="px-5 py-3 font-semibold">{t('admin.staff.colName')}</th>
              <th scope="col" className="px-3 py-3 font-semibold">{t('admin.staff.colEmail')}</th>
              <th scope="col" className="px-3 py-3 font-semibold">{t('admin.staff.colRole')}</th>
              <th scope="col" className="px-5 py-3 text-right font-semibold">{t('admin.staff.colActive')}</th>
            </tr>
          </thead>
          <tbody>
            {staff.data.map((m) => {
              const self = m.id === session.staffId;
              const locked = self || (m.role === 'owner' && !isOwner);
              const lockReason = self ? t('admin.staff.selfLocked') : locked ? t('admin.staff.ownerOnly') : undefined;
              return (
                <tr key={m.id} className={`border-t border-hair ${m.active ? '' : 'bg-[#faf6f0]'}`}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${m.active ? 'bg-espresso text-paper' : 'bg-[#ddd3c5] text-stone-dark'}`} aria-hidden>
                        {initials(m.name)}
                      </span>
                      <span className="flex flex-col leading-tight">
                        <span className={`font-semibold ${m.active ? '' : 'text-stone-dark'}`}>
                          {m.name}
                          {self ? <span className="ml-2 rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold text-copper-ink">{t('admin.staff.you')}</span> : null}
                        </span>
                        {!m.active ? <span className="text-xs text-stone">{t('admin.staff.inactive')}</span> : null}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-stone-dark">{m.email ?? '—'}</td>
                  <td className="px-3 py-3">
                    <select
                      className="field h-10 w-[150px] text-sm"
                      aria-label={t('admin.staff.roleFor', { name: m.name })}
                      title={lockReason}
                      value={m.role}
                      disabled={locked || pending === m.id}
                      onChange={(e) => {
                        const role = e.target.value as StaffRole;
                        void update(m, role, m.active, t('admin.staff.roleChanged', { name: m.name, role: t(`waiter.roles.${role}`) }));
                      }}
                    >
                      {STAFF_ROLES.filter((r) => isOwner || r !== 'owner' || m.role === 'owner').map((r) => (
                        <option key={r} value={r}>{t(`waiter.roles.${r}`)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end" title={lockReason}>
                      <Switch
                        checked={m.active}
                        disabled={locked || pending === m.id}
                        label={t('admin.staff.activeFor', { name: m.name })}
                        onChange={(next) => update(m, m.role, next, t(next ? 'admin.staff.activated' : 'admin.staff.deactivated', { name: m.name }))}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('admin.staff.colRole')}>
        {STAFF_ROLES.map((r) => (
          <div key={r} className="rounded-2xl border border-line px-4 py-3">
            <p className="text-sm font-semibold">{t(`waiter.roles.${r}`)}</p>
            <p className="text-[13px] leading-snug text-stone">{t(`admin.staff.roleHints.${r}`)}</p>
          </div>
        ))}
      </section>

      <InviteDialog
        key={inviting ? 'open' : 'closed'}
        open={inviting}
        isOwner={isOwner}
        onClose={() => setInviting(false)}
        onInvite={async (input) => {
          const res = await backend.inviteStaff(cafeId, input);
          toast(res.created ? t('admin.staff.invitedNew', { name: input.name }) : t('admin.staff.invitedExisting', { email: input.email }));
          setInviting(false);
          void staff.refresh();
        }}
      />
    </div>
  );
}

function InviteDialog({ open, isOwner, onClose, onInvite }: {
  open: boolean;
  isOwner: boolean;
  onClose: () => void;
  onInvite: (input: { name: string; email: string; role: StaffRole; password: string }) => Promise<void>;
}) {
  const { t } = useI18n();
  const demo = backend.mode === 'demo';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('waiter');
  const [password, setPassword] = useState(generatePassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onClose={onClose} title={t('admin.staff.inviteTitle')} wide>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!demo && password.length < 8) return setError(t('errors.weak_password'));
          setBusy(true);
          setError(null);
          try {
            await onInvite({ name: name.trim(), email: email.trim(), role, password });
          } catch (err) {
            setError(describeError(t, err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="font-serif text-2xl font-medium">{t('admin.staff.inviteTitle')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('admin.staff.name')}>
            <input className="field" data-autofocus autoComplete="off" maxLength={60} required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('admin.staff.email')}>
            <input className="field" type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field label={t('admin.staff.role')} hint={t(`admin.staff.roleHints.${role}`)}>
          <select className="field" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            {STAFF_ROLES.filter((r) => isOwner || r !== 'owner').map((r) => (
              <option key={r} value={r}>{t(`waiter.roles.${r}`)}</option>
            ))}
          </select>
        </Field>
        {demo ? (
          <p className="flex gap-2 rounded-xl bg-tint px-3.5 py-2.5 text-[13px] leading-snug text-copper-ink">
            <Info size={16} className="mt-px shrink-0" aria-hidden />
            {t('admin.staff.demoNote')}
          </p>
        ) : (
          <Field label={t('admin.staff.password')} hint={t('admin.staff.passwordHint')}>
            <span className="flex gap-2">
              <input className="field tabular flex-1 font-mono" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button variant="ghost" onClick={() => setPassword(generatePassword())}>{t('admin.staff.generate')}</Button>
            </span>
          </Field>
        )}
        <ErrorNote text={error} />
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" busy={busy}>{t('admin.staff.inviteSubmit')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
