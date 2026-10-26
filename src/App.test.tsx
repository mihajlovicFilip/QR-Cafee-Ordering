/**
 * Screen tests — the real screens in demo mode, in both languages and both editions, including failures.
 */

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

/** Types a username and PIN into the sign-in form and submits it. */
function signIn(username: string, pin: string, submit = 'Prijavi se') {
  fireEvent.change(screen.getByLabelText(/Korisničko ime|Username/), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('PIN'), { target: { value: pin } });
  fireEvent.click(screen.getByRole('button', { name: submit }));
}

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

  it('/waiter without a session goes to the sign-in, where a demo account fills the form', async () => {
    open('/waiter');
    expect(await find('Prijava za osoblje')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('next')).toBe('/waiter');
    fireEvent.click(screen.getByRole('button', { name: /Ana Petrović/ }));
    expect((screen.getByLabelText('Korisničko ime') as HTMLInputElement).value).toBe('ana');
    expect((screen.getByLabelText('PIN') as HTMLInputElement).value).toBe('641735');
    fireEvent.click(screen.getByRole('button', { name: 'Prijavi se' }));
    expect(await find('Sto 3')).toBeTruthy();
    expect(window.location.pathname).toBe('/waiter');
  });

  it('a manager goes back to the admin page they asked for', async () => {
    open('/admin/menu', 'en');
    expect(await find('Staff sign-in')).toBeTruthy();
    signIn('Nikola', '573024', 'Sign in');
    expect(await find('Cappuccino')).toBeTruthy();
    expect(window.location.pathname).toBe('/admin/menu');
  });

  it('a waiter sent from /admin lands on the waiter dashboard instead', async () => {
    open('/prijava?next=/admin');
    await find('Prijava za osoblje');
    signIn('marko', '752846');
    expect(await find('Sto 3')).toBeTruthy();
    expect(window.location.pathname).toBe('/waiter');
  });

  it('a wrong PIN is refused and has to be typed again; an inactive account cannot sign in', async () => {
    open('/prijava');
    await find('Prijava za osoblje');
    signIn('ana', '000000');
    expect(await find('Pogrešno korisničko ime ili PIN.')).toBeTruthy();
    expect((screen.getByLabelText('PIN') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('Stefan Ristić')).toBeNull();
  });

  it('someone already signed in skips the form', async () => {
    sessionStorage.setItem('stolic.demo.staff', 'jelena');
    open('/prijava');
    expect(await find('Porudžbine po satu')).toBeTruthy();
    expect(window.location.pathname).toBe('/admin');
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

  it('Stočić Café: tables only in admin and in the waiter panel, no room service', async () => {
    backend.setDemoEdition('cafe');
    sessionStorage.setItem('stolic.demo.staff', 'jelena');
    let view = open('/admin/tables');
    expect(await find('Stolovi i QR kodovi')).toBeTruthy();
    expect(screen.getByText('Stočić Café').parentElement!.textContent).toMatch(/^Administracija · Stočić Café$/);
    expect(screen.queryByRole('button', { name: /Sobe/ })).toBeNull();
    expect(screen.queryByText('Dodaj sobe')).toBeNull();
    expect(screen.queryByText(/Soba \d+/)).toBeNull();
    view.unmount();

    view = open('/waiter');
    expect(await find('Sto 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stolovi' })).toBeTruthy();
    view.unmount();

    open('/t/demo-soba-214');
    expect(await find('Ovaj QR kod nije aktivan')).toBeTruthy();
  });

  it('Stočić Hotel: tables and rooms side by side', async () => {
    sessionStorage.setItem('stolic.demo.staff', 'jelena');
    open('/admin/tables');
    expect(await find('Stolovi, sobe i QR kodovi')).toBeTruthy();
    expect(screen.getByText('Stočić Hotel').parentElement!.textContent).toMatch(/^Administracija · Stočić Hotel$/);
    screen.getByRole('button', { name: /Sobe/ }).click();
    expect(await find('Dodaj sobe')).toBeTruthy();
    expect(await find('Soba 214')).toBeTruthy();
  });

  it('the demo edition is switched on the home page', async () => {
    open('/');
    expect(await find('Sobe — sobna usluga')).toBeTruthy();
    screen.getByRole('button', { name: 'Stočić Café' }).click();
    expect(await find('Demo je sada Stočić Café')).toBeTruthy();
    expect(screen.queryByText('Sobe — sobna usluga')).toBeNull();
    expect(backend.demoEdition()).toBe('cafe');
  });

  it('the owner sees the overview', async () => {
    sessionStorage.setItem('stolic.demo.staff', 'jelena');
    open('/admin', 'en');
    expect(await find('Active orders')).toBeTruthy();
  });
});
