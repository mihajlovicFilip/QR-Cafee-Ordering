// Smoke tests of the real screens in demo mode, in both languages, including failures.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { I18nProvider } from './i18n';
import { backend } from './api';

function open(path: string, lang: 'sr' | 'en' = 'sr') {
  localStorage.setItem('stolic.lang', lang);
  window.history.pushState({}, '', path);
  return render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

const find = (text: string | RegExp) => screen.findByText(text, undefined, { timeout: 4000 });

describe('guest', () => {
  it('opens the menu of the scanned table, in Serbian', async () => {
    open('/t/demo-sto-7');
    expect(await find('Sto 7')).toBeTruthy();
    expect(await find('Kapućino')).toBeTruthy();
    expect(screen.getByLabelText('Pozovi konobara')).toBeTruthy();
  });

  it('and in English', async () => {
    open('/t/demo-sto-7', 'en');
    expect(await find('Table 7')).toBeTruthy();
    expect(await find('Cappuccino')).toBeTruthy();
  });

  it('a room shows room service and no call button', async () => {
    open('/t/demo-soba-214');
    expect(await find('Soba 214')).toBeTruthy();
    expect(screen.getByText('Sobna usluga')).toBeTruthy();
    expect(screen.queryByLabelText('Pozovi konobara')).toBeNull();
  });

  it('an unknown QR code says so', async () => {
    open('/t/nope', 'en');
    expect(await find('This QR code isn’t active')).toBeTruthy();
  });

  it('a network failure shows a retry instead of a blank page', async () => {
    vi.spyOn(backend, 'loadTable').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    open('/t/demo-sto-7');
    expect(await find('Meni trenutno ne može da se učita')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pokušaj ponovo' })).toBeTruthy();
    vi.restoreAllMocks();
  });
});

describe('staff', () => {
  it('the waiter panel shows waiting orders', async () => {
    sessionStorage.setItem('stolic.demo.staff', 'ana');
    open('/waiter');
    expect(await find('Sto 3')).toBeTruthy();
    expect(screen.getAllByText('Čeka potvrdu').length).toBeGreaterThan(0);
  });

  it('the admin sign-in offers only the owner and managers', async () => {
    open('/admin', 'en');
    expect(await find('Jelena Marković')).toBeTruthy();
    expect(screen.getByText('Nikola Jovanović')).toBeTruthy();
    expect(screen.queryByText('Ana Petrović')).toBeNull();
  });

  it('a waiter who reaches /admin is told they have no access', async () => {
    sessionStorage.setItem('stolic.demo.staff', 'ana');
    open('/admin');
    expect(await find('Nemate pristup administraciji')).toBeTruthy();
  });

  it('every admin page renders without React key warnings', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    sessionStorage.setItem('stolic.demo.staff', 'jelena');
    for (const [path, text] of [['/admin/menu', 'Kapućino'], ['/admin/tables', 'Sto 12'], ['/admin/staff', 'Ana Petrović'], ['/admin/settings', 'Radno vreme']]) {
      const view = open(path);
      expect(await find(text)).toBeTruthy();
      view.unmount();
    }
    const keyWarnings = errors.mock.calls.filter((c) => String(c[0]).includes('same key'));
    errors.mockRestore();
    expect(keyWarnings).toEqual([]);
  });

  it('the overview shows today, and the last 30 days on request', async () => {
    sessionStorage.setItem('stolic.demo.staff', 'jelena');
    open('/admin');
    expect(await find('Porudžbine po satu')).toBeTruthy();
    expect(screen.queryByText(/Brojke se osvežavaju/)).toBeNull();
    screen.getByRole('button', { name: '30 dana' }).click();
    expect(await find('Porudžbine po danu')).toBeTruthy();
    expect(await find('Porudžbine, poslednjih 30 dana')).toBeTruthy();
    expect((await screen.findByRole('list', { name: 'Porudžbine po danu' }, { timeout: 4000 })).children).toHaveLength(30);
  });

  it('one earlier day can be picked from the calendar, and stepped through', async () => {
    sessionStorage.setItem('stolic.demo.staff', 'jelena');
    open('/admin');
    await find('Porudžbine po satu');
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    fireEvent.change(screen.getByLabelText('Izaberi datum'), { target: { value: yesterday } });
    expect(await find('Najprodavanije tog dana')).toBeTruthy();
    expect(await find(/^Porudžbine tog dana \(\d+\)$/)).toBeTruthy();
    screen.getByRole('button', { name: 'Sledeći dan' }).click(); // yesterday + 1 = today
    expect(await find('Porudžbine danas')).toBeTruthy();
  });

  it('a day in the 30-day chart opens that day', async () => {
    sessionStorage.setItem('stolic.demo.staff', 'jelena');
    open('/admin');
    await find('Porudžbine po satu');
    screen.getByRole('button', { name: '30 dana' }).click();
    const list = await screen.findByRole('list', { name: 'Porudžbine po danu' }, { timeout: 4000 });
    (list.children[10].querySelector('button') as HTMLButtonElement).click();
    expect(await find('Porudžbine tog dana')).toBeTruthy();
    expect(screen.getByRole('button', { name: '30 dana' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('the owner sees the overview', async () => {
    sessionStorage.setItem('stolic.demo.staff', 'jelena');
    open('/admin', 'en');
    expect(await find('Active orders')).toBeTruthy();
  });
});
