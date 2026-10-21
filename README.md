# Stočić — QR ordering for cafés and hotels

A guest scans the QR code on a table (or in a hotel room) and orders from their phone, with no
sign-up. A waiter accepts or rejects the order and picks a preparation time; the guest follows the
countdown and the status live. The interface is in Serbian (Latin script) and English.

## Editions

One codebase, two products. Every establishment has exactly one edition, stored in the database
(`cafes.edition`):

| | Stočić Café | Stočić Hotel |
|---|---|---|
| For | cafés, bars, restaurants | hotels and other accommodation |
| QR ordering from tables, menu, cart, live tracking | ✓ | ✓ |
| Waiter dashboard, preparation times, waiter calls | ✓ | ✓ |
| Administration: overview, menu, tables and QR codes, staff, settings | ✓ | ✓ |
| QR ordering from rooms (room service), room and floor management | — | ✓ |

The edition decides only whether rooms exist; every other feature is shared. The database
enforces it (`20261021120000_editions.sql`): for a Stočić Café a room QR code behaves like an
inactive code, a room-service order is refused, and creating or managing rooms fails with
`hotel_only` — even through direct API calls. The interface follows the same rule: a café sees
tables only and no hotel wording; a hotel gets the tables / rooms switch, floors and the
"room service" labels.

The edition is set by the operator in the database, not in the admin panel:

```sql
update public.cafes set edition = 'hotel' where id = '<café id>';  -- or 'cafe'
```

Switching a hotel back to café keeps its rooms in the database, inert; switching to hotel again
brings them back, QR codes included.

## Features

- **Guests:** menu by QR code, search, product options, cart, order notes, live tracking with a
  countdown, earlier orders, "Call waiter" (tables only).
- **Waiters:** new / active / finished orders, accept with a preparation time or reject with a
  reason, extend, ready, served; the tables view (and rooms for Stočić Hotel); waiter calls; sound.
- **Administration** at `/admin`, for owners and managers only:
  - overview for today, the last 7 or 30 days, or one chosen day of the last 30 (orders, sales,
    preparation time, a chart by hour or by day, best sellers, that day's orders);
  - menu (categories, products in both languages, prices, availability, options, photos);
  - tables and QR codes (a PNG card per place, a print-ready PDF with four cards per A4 page, new
    codes);
  - staff (roles, access, invitations) and the establishment's settings.
- **Rooms (Stočić Hotel):** rooms have their own QR codes. A guest in a room orders exactly as at
  a table (without "Call waiter"), and the waiter sees a "Room service" label. Rooms are added in
  the admin panel by number range (e.g. 101–130) with a floor (0 = ground floor; suggested from
  the number, 401 → 4th floor, but editable).

## Running

```bash
npm install
npm run dev
```

Open http://localhost:5173.

Without any configuration the app runs in **demo mode**: data stays in the browser, and tabs of
the same browser exchange orders live. Open a guest (`/t/demo-sto-7`, or the room
`/t/demo-soba-214`) and the waiter (`/waiter`) in two tabs side by side. Administration is at
`/admin` (in the demo, pick the owner Jelena or the manager Nikola); guests see menu changes as
soon as they reload the menu.

The demo starts as Stočić Hotel, with 12 tables and 90 rooms (101–130, 201–230, 301–330). The
home page switches it to Stočić Café and back.

> If `npm install` fails with `EACCES` on `~/.npm`, the cache contains files owned by root. Fix:
> `sudo chown -R $(id -u):$(id -g) ~/.npm`, or once: `npm install --cache /tmp/npm-cache`.

## Connecting Supabase

1. Create a project at [supabase.com](https://supabase.com) (the free plan is enough).
2. **SQL Editor** → paste and run every file in `supabase/migrations/`, in this order:

   | Migration | Adds |
   |---|---|
   | `20261020000000_init.sql` | schema, RLS, guest and waiter functions, realtime |
   | `20261020120000_admin.sql` | administration functions, product photo storage |
   | `20261020130000_rooms.sql` | rooms next to tables |
   | `20261020140000_room_floor.sql` | a floor for every room |
   | `20261020150000_hardening.sql` | protection against simultaneous requests and surplus privileges |
   | `20261021090000_order_stats.sql` | statistics for the overview |
   | `20261021120000_editions.sql` | Stočić Café / Stočić Hotel |

3. **SQL Editor** → run `supabase/seed.sql` (the demo establishment *Kafeterija Lipa*: a menu in
   both languages, 12 tables and 90 rooms, Stočić Hotel). The seed must run after all migrations.
4. **Authentication → Sign In / Providers** → turn on **Allow anonymous sign-ins** (guests do not
   register, but get an anonymous session so they see only their own orders).
5. **Authentication → Users → Add user** for every waiter (with *Auto Confirm User*), then link
   them to the establishment with `supabase/link_staff.sql`.
6. Copy `.env.example` to `.env` and enter the **Project URL** and the **anon** (or
   **publishable**) key from *Project Settings → API*. Never put the `service_role` key there.
7. Restart `npm run dev`. Guest: `http://localhost:5173/t/demo-sto-7`, waiter:
   `http://localhost:5173/waiter`.

### Administration

8. The migration `20261020120000_admin.sql` from step 2 adds the `admin_*` functions (each checks
   through `is_manager` that the caller is an active owner or manager of that establishment), the
   Storage bucket `product-images` for product photos, and rules that let managers upload only
   into their own establishment's folder.
9. Link the owner with `supabase/link_staff.sql` and the role `'owner'`, then sign in at `/admin`
   with the same account as at `/waiter`.
10. **Adding staff from the admin panel** needs the `service_role` key, so it runs in an Edge
    Function (the key never reaches the browser):

    ```bash
    supabase functions deploy invite-staff
    ```

    The function creates a login with a temporary password (or links an existing account with
    that email). Without it, "Add member" reports that the function is not set up — add staff by
    hand as in step 5 instead.

### Upgrading an existing database

Run, in order, the migrations the database does not have yet. None of them deletes data.
`20261021120000_editions.sql` makes every establishment that has rooms (or past room-service
orders) Stočić Hotel and every other one Stočić Café; QR codes, orders and guest sessions are
untouched, and the app keeps showing rooms until the migration has run. Check the result before
going live:

```sql
select name, edition from public.cafes;
```

### Before going live

Replace the readable demo QR tokens with random ones:

```sql
update public.dining_tables set qr_token = replace(gen_random_uuid()::text, '-', '');
```

Also turn on CAPTCHA for anonymous sign-ins (*Authentication → Attack Protection*) and a limit on
anonymous sign-ins per IP address (*Authentication → Rate Limits*). The "one order per 5 seconds"
limit applies per guest; without these two settings, someone who keeps creating anonymous
accounts can send fake orders.

## Publishing on GitHub Pages

The workflow `.github/workflows/deploy-pages.yml` builds the app on every push to `main` and
publishes it at `https://<user>.github.io/<repository>/`.

1. Once: on GitHub, **Settings → Pages → Build and deployment → Source** → **GitHub Actions**.
2. From then on every `git push` to `main` publishes a new version (the **Actions** tab shows the
   progress).

Without Supabase keys the published site runs in demo mode, so every device has its own data. For
orders from a phone to reach a waiter on another device, add `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` under **Settings → Secrets and variables → Actions** and pass them to the
*Build* step of the workflow.

## How it is protected

- Every change goes through functions in the database (`place_order`, `accept_order`,
  `reject_order`, `extend_order`, `mark_order_ready`, `mark_order_served`, `call_waiter`,
  `resolve_call`, and `admin_*` for administration). Writing to tables directly is not allowed.
- Administration: active owners and managers of the establishment only; only an owner assigns or
  changes the owner role; nobody changes their own role or access. A removed table or room with
  order history is hidden (its QR code stops working); one without history is deleted.
- **The server computes prices** from the products table; whatever amount the phone sends is
  ignored.
- **Accepting is atomic:** if two waiters press "Accept" at the same moment, only the first
  succeeds; the second is told the order was already taken.
- RLS: a guest sees only their own orders; staff see only their own establishment's data (ready
  for many establishments on one database).
- Limits: at most 40 lines and 50 pieces per line, one order per 5 seconds per guest, repeated
  waiter calls within 20 s are ignored. All three hold when several requests arrive at the same
  moment (a database lock per guest, or per table).
- The browser (roles `anon` and `authenticated`) has no right to insert, update, delete or
  truncate any table; `anon` may call only `guest_table` and `server_now`.
- Editions: every room operation requires Stočić Hotel (`hotel_only`). The check runs after the
  manager check, so anyone who is not a manager still gets the same `forbidden` as before.

## Tests

```bash
npm run check
```

runs everything in order: type checks (app, tests, Edge Function), ESLint, all tests and the
production build. One by one:

| Command | What it checks |
|---|---|
| `npm run typecheck` | TypeScript for the app, the tests and `supabase/functions` |
| `npm run lint` | ESLint (TypeScript and the React hook rules) |
| `npm test` | Unit tests (Vitest, simulated browser): demo backend, prices, statuses, translations, screens in both languages and both editions, network failures |
| `npm run test:db` | Database tests on a **real PostgreSQL 17** with every migration and the seed: prices, validation, the 5-second limit under simultaneous requests, two waiters accepting at once, status transitions, RLS between establishments, privileges, Storage rules, tables and rooms, editions (including the editions migration over existing data) |

`npm run test:db` starts a temporary PostgreSQL (the `embedded-postgres` package, no Docker) and
removes it at the end. The Supabase parts the database expects (`auth.uid()`, the roles
`anon` / `authenticated` / `service_role`, `storage`) are replaced by minimal stand-ins from
`tests/db/supabase-stubs.sql`. These tests therefore prove what the database itself enforces
(functions, RLS, privileges, locking) — **not** the behaviour of the Supabase services
(PostgREST, Auth, Realtime, the Storage API, the Edge Function). That needs a real Supabase
project.

GitHub Actions (`.github/workflows/ci.yml`) runs all of this on every push and pull request, and
the GitHub Pages deployment stops if the unit tests fail.

## Structure

```
src/
  api/           types.ts (the contract), supabase.ts, demo.ts, seedData.ts, pricing.ts, stats.ts
  i18n/          sr.json, en.json, index.tsx (translations, plurals, formats)
  features/
    guest/       menu, product details, cart, order tracking
    waiter/      sign-in, dashboard, order cards, tables, rejecting
    admin/       overview, menu, tables and rooms with QR codes, staff, settings
    home/        home page (and the demo's edition switch)
  components/    buttons, badges, dialog, switch, toasts, staff sign-in
  lib/           live data, clock, statuses, editions, sound, QR cards and PDF, image resizing
supabase/
  migrations/    schema, RLS, functions, realtime — see the table above
  functions/     invite-staff (adding staff, uses service_role)
  seed.sql       demo establishment (12 tables, 90 rooms, Stočić Hotel)
  link_staff.sql template for linking a staff login to an establishment
tests/db/        database tests (real PostgreSQL), schema loading and the Supabase stand-ins
.github/         CI checks and the GitHub Pages deployment
```

## Code conventions

- **The interface is in Serbian and English; everything in the code — comments, documentation,
  names — is in English.** Product names (Stočić Café, Stočić Hotel) are never translated.
- Every source file starts with a header: `Name — what it is.`, then why it exists or the
  decisions behind it. Sections inside a file are marked `// === Name ===…` (`-- === Name ===…`
  in SQL); CSS uses `/*===…===*/` blocks. Comments explain why, not what.
- `src/api/types.ts` is the contract. A new backend method goes into it, into `supabase.ts` and
  into `demo.ts`; the demo mirrors the SQL rules, and the tests check both.
- Every write goes through a SECURITY DEFINER function, added in a new migration file. RLS and
  the grants are never loosened to make something work.
- Tailwind looks for classes in `src` only, so words in this README, the SQL or the tests never
  turn into CSS.

## Languages

All interface text is in `src/i18n/sr.json` and `src/i18n/en.json` (the same keys). A new
language: add `<code>.json` and register it in `src/i18n/index.tsx`. Product names and
descriptions are stored in the database as `{"sr": "...", "en": "..."}`; when a translation is
missing, Serbian is shown. The chosen language is remembered in the browser; until a guest picks
one, the establishment's default language applies. Prices are always in RSD.
