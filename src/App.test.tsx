// Smoke tests of the real screens in demo mode, in both languages, including failures.
import { render, screen } from '@testing-library/react';
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

  it('the owner sees the overview', async () => {
    sessionStorage.setItem('stolic.demo.staff', 'jelena');
    open('/admin', 'en');
    expect(await find('Active orders')).toBeTruthy();
  });
});
