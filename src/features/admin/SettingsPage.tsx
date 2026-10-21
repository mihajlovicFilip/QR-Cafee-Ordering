/**
 * Café settings — name, brand colour, contact, opening hours and guest rules.
 *
 * The edition is not among them: it decides what the establishment may do, so the operator sets
 * it in the database (see README).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { backend, type CafeSettingsInput, type OpeningHours, type StaffSession } from '../../api';
import { useI18n } from '../../i18n';
import { describeError } from '../../lib/errors';
import { Button, Spinner, Switch } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { ErrorNote, Field, PageHeader, useAdminTitle } from './parts';

const SWATCHES = ['#a45a2e', '#8e3b46', '#2f5d50', '#2a5279', '#5b4a7a', '#2b1d16'];
const DAYS: (keyof OpeningHours)[] = ['weekdays', 'saturday', 'sunday'];

/** "07:00–23:00" ⇄ { open, close }; an empty string means closed that day. */
function splitHours(value: string): { open: string; close: string } | null {
  const m = /^(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})$/.exec(value.trim());
  return m ? { open: m[1].padStart(5, '0'), close: m[2] === '24:00' ? '00:00' : m[2].padStart(5, '0') } : null;
}
const joinHours = (open: string, close: string) => `${open}–${close === '00:00' ? '24:00' : close}`;

/** WCAG contrast of white text on the colour. Buttons in the guest menu are white on the accent. */
function contrastWithWhite(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return 1.05 / (lum + 0.05);
}

export function SettingsPage({ session, onSaved }: { session: StaffSession; onSaved: () => void }) {
  const { t, languages } = useI18n();
  const toast = useToast();
  const cafeId = session.cafe.id;
  useAdminTitle(t('admin.nav.settings'), session.cafe.name);

  const [initial, setInitial] = useState<CafeSettingsInput | null>(null);
  const [form, setForm] = useState<CafeSettingsInput | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend
      .cafeSettings(cafeId)
      .then(({ id: _id, slug: _slug, edition: _edition, ...rest }) => {
        setInitial(rest);
        setForm(rest);
      })
      .catch(setLoadError);
  }, [cafeId]);

  if (!form || !initial) return loadError ? <ErrorNote text={describeError(t, loadError)} /> : <Spinner label={t('common.loading')} />;

  const set = <K extends keyof CafeSettingsInput>(key: K, value: CafeSettingsInput[K]) => setForm({ ...form, [key]: value });
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const validColor = /^#[0-9a-f]{6}$/i.test(form.accent);
  const lowContrast = validColor && contrastWithWhite(form.accent) < 4.5;

  async function save() {
    setError(null);
    if (!form!.name.trim()) return setError(t('errors.name_required'));
    if (!validColor) return setError(t('errors.invalid_color'));
    setSaving(true);
    try {
      await backend.updateCafe(cafeId, form!);
      const next = { ...form!, accent: form!.accent.toLowerCase(), name: form!.name.trim() };
      setInitial(next);
      setForm(next);
      toast(t('admin.settings.saved'));
      onSaved();
    } catch (e) {
      setError(describeError(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex animate-rise flex-col gap-6 pb-24"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <PageHeader title={t('admin.settings.title')} subtitle={t('admin.settings.subtitle')} />

      <Section title={t('admin.settings.sectionCafe')}>
        <Field label={t('admin.settings.name')}>
          <input className="field" maxLength={80} required value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="flex flex-col gap-2">
          <span className="label" id="accent-label">{t('admin.settings.accent')}</span>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-2" role="group" aria-labelledby="accent-label">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={form.accent.toLowerCase() === c}
                  onClick={() => set('accent', c)}
                  className={`size-9 rounded-full transition ${form.accent.toLowerCase() === c ? 'ring-2 ring-espresso ring-offset-2 ring-offset-paper' : 'hover:scale-105'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
            <label className="flex items-center gap-2">
              <input type="color" className="size-10 cursor-pointer rounded-lg border border-line-strong bg-white p-1" aria-label={t('admin.settings.accentPicker')} value={validColor ? form.accent.toLowerCase() : '#a45a2e'} onChange={(e) => set('accent', e.target.value)} />
              <input className="field tabular h-10 w-[120px] font-mono text-sm uppercase" aria-label={t('admin.settings.accentHex')} maxLength={7} value={form.accent} onChange={(e) => set('accent', e.target.value)} />
            </label>
            <span className="inline-flex h-10 items-center rounded-[12px] px-4 text-sm font-semibold text-white" style={{ background: validColor ? form.accent : '#a45a2e' }} aria-hidden>
              {t('admin.settings.previewButton')}
            </span>
          </div>
          <span className="text-[13px] text-stone">{t('admin.settings.accentHint')}</span>
          {lowContrast ? (
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[#76540a]">
              <CircleAlert size={14} aria-hidden />
              {t('admin.settings.accentLowContrast')}
            </span>
          ) : null}
        </div>
      </Section>

      <Section title={t('admin.settings.sectionContact')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('admin.settings.phone')}>
            <input className="field" type="tel" maxLength={40} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label={t('admin.settings.email')}>
            <input className="field" type="email" maxLength={120} value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
        </div>
        <Field label={t('admin.settings.address')}>
          <input className="field" maxLength={160} value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
      </Section>

      <Section title={t('admin.settings.sectionHours')}>
        <div className="flex flex-col divide-y divide-hair">
          {DAYS.map((day) => {
            const value = form.openingHours[day];
            const parsed = splitHours(value);
            const closed = !value.trim();
            const setDay = (v: string) => set('openingHours', { ...form.openingHours, [day]: v });
            return (
              <div key={day} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="w-[140px] text-[15px] font-semibold">{t(`admin.settings.${day}`)}</span>
                {closed ? (
                  <span className="min-w-[230px] flex-1 text-sm text-stone">{t('admin.settings.closed')}</span>
                ) : parsed ? (
                  <span className="flex min-w-[230px] flex-1 items-center gap-2">
                    <input type="time" className="field h-10 w-[120px] text-sm" aria-label={`${t(`admin.settings.${day}`)} — ${t('admin.settings.from')}`} value={parsed.open} onChange={(e) => setDay(joinHours(e.target.value, parsed.close))} />
                    <span className="text-stone" aria-hidden>–</span>
                    <input type="time" className="field h-10 w-[120px] text-sm" aria-label={`${t(`admin.settings.${day}`)} — ${t('admin.settings.to')}`} value={parsed.close} onChange={(e) => setDay(joinHours(parsed.open, e.target.value))} />
                  </span>
                ) : (
                  <input className="field h-10 min-w-[230px] flex-1 text-sm" aria-label={t(`admin.settings.${day}`)} maxLength={40} value={value} onChange={(e) => setDay(e.target.value)} />
                )}
                <label className="inline-flex items-center gap-2 text-sm text-stone-dark">
                  <input type="checkbox" className="size-4 accent-(--ac)" checked={closed} onChange={(e) => setDay(e.target.checked ? '' : '08:00–22:00')} />
                  {t('admin.settings.closed')}
                </label>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={t('admin.settings.sectionGuests')}>
        <div className="flex flex-col gap-2">
          <span className="label" id="lang-label">{t('admin.settings.defaultLang')}</span>
          <div className="flex gap-2" role="group" aria-labelledby="lang-label">
            {languages.map((l) => (
              <button key={l} type="button" lang={l} className="chip chip-sm" aria-pressed={form.defaultLang === l} onClick={() => set('defaultLang', l)}>
                {t(`admin.settings.languages.${l}`)}
              </button>
            ))}
          </div>
          <span className="text-[13px] text-stone">{t('admin.settings.defaultLangHint')}</span>
        </div>
        <Toggle label={t('admin.settings.allowRepeat')} hint={t('admin.settings.allowRepeatHint')} checked={form.allowRepeat} onChange={(v) => set('allowRepeat', v)} />
        <Toggle label={t('admin.settings.callButton')} hint={t('admin.settings.callButtonHint')} checked={form.callButton} onChange={(v) => set('callButton', v)} />
      </Section>

      <ErrorNote text={error} />

      <div className={`sticky bottom-4 z-10 flex items-center gap-3 rounded-2xl border px-4 py-3 transition ${dirty ? 'border-espresso bg-espresso text-paper shadow-[0_18px_40px_-18px_rgba(31,24,20,.6)]' : 'border-line bg-paper text-stone'}`}>
        <span className="flex-1 text-sm font-medium">{dirty ? t('admin.unsaved') : t('admin.settings.upToDate')}</span>
        {dirty ? (
          <Button variant="ghost" size="sm" className="border-white/25 bg-transparent text-paper hover:bg-white/10" onClick={() => { setForm(initial); setError(null); }}>
            {t('admin.discard')}
          </Button>
        ) : null}
        <Button type="submit" size="sm" variant={dirty ? 'accent' : 'ghost'} busy={saving} disabled={!dirty}>{t('admin.save')}</Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card grid grid-cols-1 gap-5 p-5 sm:p-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <h2 className="font-serif text-xl font-medium">{title}</h2>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </section>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{label}</span>
        <span className="text-[13px] leading-snug text-stone">{hint}</span>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}
