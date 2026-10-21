# Stočić — QR poručivanje za kafiće

Gost skenira QR kod na stolu i poruči sa telefona, bez registracije. Konobar porudžbinu prihvati ili odbije i izabere vreme pripreme, a gost uživo vidi odbrojavanje i status. Interfejs je na srpskom (latinica) i engleskom.

**Faza 1:** ceo tok porudžbine — meni za gosta, korpa, slanje, praćenje uživo, konobarski panel (nove / aktivne / završene porudžbine, stolovi, pozivi konobara).
**Faza 2:** administratorski panel na `/admin` (samo vlasnik i menadžeri): pregled za danas, poslednjih 7 ili 30 dana ili jedan izabrani dan iz poslednjih 30 (porudžbine, promet, vreme pripreme, grafikon po satu ili po danu, najprodavanije, spisak porudžbina tog dana), meni (kategorije, proizvodi na dva jezika, cene, dostupnost, opcije, fotografije), stolovi i QR kodovi (PNG po stolu, PDF za štampu sa 4 kartice po A4 strani, novi kod), osoblje (uloge, pristup, dodavanje) i podešavanja lokala.
**Sobe (room service):** pored stolova postoje i sobe sa svojim QR kodovima. Gost u sobi poručuje isto kao za stolom (bez dugmeta „Pozovi konobara“), konobar vidi oznaku „Sobna usluga“, a u adminu se sobe dodaju opsegom brojeva (npr. 101–130) sa spratom (0 = prizemlje; predlaže se iz broja, 401 → 4. sprat, ali može da se promeni). Demo ima 90 soba: 101–130, 201–230, 301–330.

## Pokretanje

```bash
npm install
npm run dev
```

Otvorite http://localhost:5173.

Bez podešavanja aplikacija radi u **demo režimu**: podaci se čuvaju u pregledaču, a tabovi istog pregledača razmenjuju porudžbine uživo. Otvorite gosta (`/t/demo-sto-7`, ili sobu `/t/demo-soba-214`) i konobara (`/waiter`) u dva taba jedan pored drugog. Administracija je na `/admin` (u demou izaberite vlasnicu Jelenu ili menadžera Nikolu); izmene menija gost vidi čim ponovo učita meni.

> Ako `npm install` javi `EACCES` za `~/.npm`, keš sadrži fajlove u vlasništvu root-a. Popravka: `sudo chown -R $(id -u):$(id -g) ~/.npm`, ili jednokratno: `npm install --cache /tmp/npm-cache`.

## Povezivanje sa Supabase

1. Napravite projekat na [supabase.com](https://supabase.com) (besplatan plan je dovoljan).
2. **SQL Editor** → nalepite i pokrenite, ovim redom, sve fajlove iz `supabase/migrations/`:
   `20261020000000_init.sql` (šema, porudžbine), `20261020120000_admin.sql` (administracija, fotografije), `20261020130000_rooms.sql` (sobe), `20261020140000_room_floor.sql` (sprat sobe), `20261020150000_hardening.sql` (zaštita od istovremenih zahteva i suvišnih privilegija), `20261021090000_order_stats.sql` (statistika za pregled).
3. **SQL Editor** → pokrenite `supabase/seed.sql` (demo kafić *Kafeterija Lipa*, meni na dva jezika, 12 stolova i 90 soba). Seed mora posle svih migracija.
4. **Authentication → Sign In / Providers** → uključite **Allow anonymous sign-ins** (gosti se ne registruju, ali dobijaju anonimnu sesiju da bi videli samo svoje porudžbine).
5. **Authentication → Users → Add user** za svakog konobara (uz *Auto Confirm User*), pa ga povežite sa kafićem preko `supabase/link_staff.sql`.
6. Kopirajte `.env.example` u `.env` i upišite **Project URL** i **anon** (ili **publishable**) ključ iz *Project Settings → API*. Nikada ne upisujte `service_role` ključ.
7. Ponovo pokrenite `npm run dev`. Gost: `http://localhost:5173/t/demo-sto-7`, konobar: `http://localhost:5173/waiter`.

### Administracija (faza 2)

8. Migracija `20261020120000_admin.sql` iz koraka 2 dodaje funkcije `admin_*` (sve proveravaju da je pozivalac aktivan vlasnik ili menadžer tog kafića preko `is_manager`), Storage bucket `product-images` za fotografije proizvoda i pravila da menadžeri otpremaju samo u fasciklu svog kafića. Ako ste bazu podesili ranije, pokrenite redom one migracije koje još niste (sve su bez gubitka podataka; poslednja je `20261021090000_order_stats.sql`).
9. Vlasnika povežite preko `supabase/link_staff.sql` sa ulogom `'owner'` i prijavite se na `/admin` istim nalogom kao na `/waiter`.
10. **Dodavanje osoblja iz panela** traži `service_role` ključ, pa radi kroz Edge funkciju (ključ nikad ne ide u pregledač):
    ```bash
    supabase functions deploy invite-staff
    ```
    Funkcija pravi nalog sa privremenom lozinkom (ili povezuje postojeći nalog sa tom e-poštom). Bez nje dugme „Dodaj člana“ javlja da funkcija nije podešena — tada osoblje dodajte ručno kao u koraku 5.

Pre puštanja pravim gostima zamenite čitljive demo QR tokene nasumičnim:

```sql
update public.dining_tables set qr_token = replace(gen_random_uuid()::text, '-', '');
```

Za produkciju preporučujemo i CAPTCHA za anonimnu prijavu (*Authentication → Attack Protection*) i ograničenje broja anonimnih prijava po IP adresi (*Authentication → Rate Limits*). Ograničenje „jedna porudžbina na 5 s“ važi po gostu; bez ova dva podešavanja neko ko pravi nove anonimne naloge može da šalje lažne porudžbine.

## Objava na GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` na svaki push na `main` napravi build i objavi ga na `https://<korisnik>.github.io/<repozitorijum>/`.

1. Jednom: na GitHub-u **Settings → Pages → Build and deployment → Source** izaberite **GitHub Actions**.
2. Svaki `git push` na `main` posle toga sam objavljuje novu verziju (tab **Actions** pokazuje napredak).

Bez Supabase ključeva objavljena verzija radi u demo režimu, pa svaki uređaj ima svoje podatke. Da bi porudžbine sa telefona stizale konobaru na drugom uređaju, u **Settings → Secrets and variables → Actions** dodajte `VITE_SUPABASE_URL` i `VITE_SUPABASE_ANON_KEY` i prosledite ih koraku *Build* u workflow-u.

## Kako je zaštićeno

- Svaka izmena ide kroz funkcije u bazi (`place_order`, `accept_order`, `reject_order`, `extend_order`, `mark_order_ready`, `mark_order_served`, `call_waiter`, `resolve_call`, i za administraciju `admin_*`). Direktan upis u tabele je zabranjen.
- Administracija: samo aktivni vlasnik ili menadžer kafića; samo vlasnik dodeljuje ili menja ulogu vlasnika; niko ne menja svoju ulogu i pristup. Uklonjen sto sa istorijom porudžbina se skriva (QR kod prestaje da radi), a bez istorije se briše.
- **Cene računa server** iz tabele proizvoda — iznos koji pošalje telefon se ignoriše.
- **Prihvatanje je atomsko:** ako dva konobara pritisnu „Prihvati“ istovremeno, uspeva samo prvi; drugi dobija poruku da je porudžbina već preuzeta.
- RLS: gost vidi samo svoje porudžbine; osoblje vidi samo podatke svog kafića (spremno za više kafića na jednoj bazi).
- Ograničenja: najviše 40 stavki i 50 komada po stavci, jedna porudžbina na 5 sekundi po gostu, ponovljeni pozivi konobara u roku od 20 s se ignorišu. Sva tri pravila važe i kad stigne više zahteva u istom trenutku (zaključavanje u bazi po gostu, odnosno po stolu).
- Pregledač (uloge `anon` i `authenticated`) nema nikakvo pravo upisa, brisanja ni pražnjenja tabela; `anon` sme da pozove samo `guest_table` i `server_now`.

## Testovi

```bash
npm run check
```

pokreće sve redom: proveru tipova (aplikacija, testovi, Edge funkcija), ESLint, testove i produkcioni build. Pojedinačno:

| Komanda | Šta proverava |
|---|---|
| `npm run typecheck` | TypeScript za aplikaciju, testove i `supabase/functions` |
| `npm run lint` | ESLint (TypeScript i pravila React hook-ova) |
| `npm test` | Unit testovi (Vitest, simulirani pregledač): demo backend, cene, statusi, prevodi, ekrani na oba jezika, greške mreže |
| `npm run test:db` | Testovi baze na **pravom PostgreSQL 17** sa svim migracijama i seed-om: cene, validacija, granica od 5 s pod istovremenim zahtevima, prihvatanje porudžbine kad dva konobara kliknu istovremeno, prelazi statusa, RLS između kafića, privilegije, Storage pravila, stolovi i sobe |

`npm run test:db` sam pokreće privremeni PostgreSQL (paket `embedded-postgres`, bez Docker-a) i briše ga na kraju. Supabase delovi koje baza očekuje (`auth.uid()`, uloge `anon`/`authenticated`/`service_role`, `storage`) zamenjeni su minimalnim verzijama iz `tests/db/supabase-stubs.sql`. Ovi testovi zato dokazuju ono što sprovodi sama baza (funkcije, RLS, privilegije, zaključavanje), a **ne** ponašanje Supabase servisa (PostgREST, Auth, Realtime, Storage API, Edge funkcija). Za to je potreban pravi Supabase projekat.

GitHub Actions (`.github/workflows/ci.yml`) pokreće sve ovo na svaki push i pull request, a objava na GitHub Pages ne prolazi ako unit testovi padnu.

## Struktura

```
src/
  api/           types.ts (ugovor), supabase.ts, demo.ts, seedData.ts, pricing.ts
  i18n/          sr.json, en.json, index.tsx (prevodi, množina, formati)
  features/
    guest/       meni, detalj proizvoda, korpa, praćenje porudžbine
    waiter/      prijava, panel, kartice porudžbina, stolovi, odbijanje
    admin/       pregled, meni, stolovi i QR, osoblje, podešavanja
    home/        početna strana
  components/    dugmad, bedževi, dijalog, prekidač, obaveštenja, prijava osoblja
  lib/           osvežavanje uživo, sat, statusi, zvuk, QR kartice i PDF, smanjivanje slika
supabase/
  migrations/    šema, RLS, funkcije, realtime; _admin.sql za administraciju; _rooms.sql i _room_floor.sql za sobe; _hardening.sql; _order_stats.sql
  functions/     invite-staff (dodavanje osoblja, koristi service_role)
  seed.sql       demo kafić (12 stolova, 90 soba)
  link_staff.sql šablon za povezivanje konobara
tests/db/        testovi baze (pravi PostgreSQL) i zamene za Supabase delove
.github/         CI provere i objava na GitHub Pages
```

## Jezici

Sav tekst interfejsa je u `src/i18n/sr.json` i `src/i18n/en.json` (isti ključevi). Novi jezik: dodajte `<kod>.json` i registrujte ga u `src/i18n/index.tsx`. Nazivi i opisi proizvoda su u bazi kao `{"sr": "...", "en": "..."}`; ako prevod nedostaje, prikazuje se srpski. Izbor jezika se pamti u pregledaču; dok gost ne izabere, važi podrazumevani jezik kafića. Cene su uvek u RSD.
