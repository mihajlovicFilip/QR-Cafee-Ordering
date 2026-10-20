-- Stolić — phase 1 schema: multi-tenant cafés, menu, tables, staff, live orders.
--
-- Security model
--   * Guests never register. The app signs them in with Supabase anonymous auth, so each
--     guest has an auth.uid() and can only ever read their own orders (RLS below).
--   * Staff sign in with email + password and are linked to a café through public.staff.
--   * Nobody writes tables directly. Every change goes through a SECURITY DEFINER function
--     that checks who is calling, recomputes prices on the server and moves orders through
--     allowed status transitions only.

-- ─────────────────────────────────────────────────────────────── tables

create table public.cafes (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  accent        text not null default '#A45A2E',
  default_lang  text not null default 'sr' check (default_lang in ('sr', 'en')),
  currency      text not null default 'RSD',
  allow_repeat  boolean not null default true,
  call_button   boolean not null default true,
  phone         text,
  email         text,
  address       text,
  opening_hours jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create table public.staff (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  cafe_id      uuid not null references public.cafes (id) on delete cascade,
  display_name text not null,
  role         text not null check (role in ('owner', 'manager', 'waiter', 'barista')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (user_id, cafe_id)
);

create table public.dining_tables (
  id       uuid primary key default gen_random_uuid(),
  cafe_id  uuid not null references public.cafes (id) on delete cascade,
  number   int not null check (number > 0),
  seats    int not null default 2 check (seats > 0),
  zone     text not null default 'hall',
  -- The secret part of the QR link (/t/<qr_token>). 32 random hex characters by default.
  qr_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  active   boolean not null default true,
  unique (cafe_id, number)
);

create table public.categories (
  id      uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  name    jsonb not null,                 -- {"sr": "...", "en": "..."}; more languages = more keys
  icon    text not null default 'coffee', -- coffee | tea | juice | breakfast | dessert | bar
  sort    int not null default 0
);

create table public.products (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid not null references public.cafes (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  name        jsonb not null,
  description jsonb not null default '{}'::jsonb,
  price       int not null check (price >= 0), -- whole dinars
  available   boolean not null default true,
  -- [{"id":"milk","name":{...},"choices":[{"id":"oat","name":{...},"price":50,"quiet":false}]}]
  -- The first choice of every group is the default.
  options     jsonb not null default '[]'::jsonb,
  image_url   text,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

create type public.order_status as enum ('pending', 'preparing', 'ready', 'served', 'rejected');

create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  number              int not null,
  cafe_id             uuid not null references public.cafes (id) on delete cascade,
  table_id            uuid not null references public.dining_tables (id),
  table_number        int not null,
  guest_id            uuid not null,
  status              public.order_status not null default 'pending',
  note                text not null default '',
  total               int not null default 0,
  created_at          timestamptz not null default now(),
  accepted_at         timestamptz,
  prep_minutes        int,
  deadline            timestamptz,
  estimate_updated_at timestamptz,
  ready_at            timestamptz,
  served_at           timestamptz,
  rejected_at         timestamptz,
  reject_reason       text,
  waiter_id           uuid references public.staff (id) on delete set null,
  waiter_name         text,
  unique (cafe_id, number)
);

create table public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  name       jsonb not null, -- snapshot, so later menu edits never rewrite old orders
  qty        int not null check (qty between 1 and 50),
  unit_price int not null,
  choices    jsonb not null default '[]'::jsonb,
  note       text not null default ''
);

create table public.waiter_calls (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references public.cafes (id) on delete cascade,
  table_id     uuid not null references public.dining_tables (id) on delete cascade,
  table_number int not null,
  guest_id     uuid,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.staff (id) on delete set null
);

create index orders_cafe_created_idx on public.orders (cafe_id, created_at desc);
create index orders_guest_created_idx on public.orders (guest_id, created_at desc);
create index order_items_order_idx on public.order_items (order_id);
create index products_cafe_idx on public.products (cafe_id, sort);
create index waiter_calls_open_idx on public.waiter_calls (cafe_id) where resolved_at is null;
create index staff_user_idx on public.staff (user_id);

-- ─────────────────────────────────────────────────────────────── helpers

create or replace function public.is_staff(p_cafe uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff s
    where s.cafe_id = p_cafe and s.user_id = auth.uid() and s.active
  );
$$;

-- Returns the caller's staff row for the café that owns the order, or raises.
create or replace function public._staff_for_order(p_order uuid)
returns public.staff
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_staff public.staff;
begin
  select s.* into v_staff
  from public.orders o
  join public.staff s on s.cafe_id = o.cafe_id and s.user_id = auth.uid() and s.active
  where o.id = p_order;
  if not found then
    raise exception 'forbidden';
  end if;
  return v_staff;
end;
$$;

create or replace function public.server_now()
returns timestamptz
language sql volatile
as $$ select now(); $$;

-- ─────────────────────────────────────────────────────────────── row level security

alter table public.cafes         enable row level security;
alter table public.staff         enable row level security;
alter table public.dining_tables enable row level security;
alter table public.categories    enable row level security;
alter table public.products      enable row level security;
alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;
alter table public.waiter_calls  enable row level security;

create policy "staff read own cafe" on public.cafes
  for select to authenticated using (public.is_staff(id));

create policy "staff read team" on public.staff
  for select to authenticated using (user_id = auth.uid() or public.is_staff(cafe_id));

create policy "staff read tables" on public.dining_tables
  for select to authenticated using (public.is_staff(cafe_id));

create policy "staff read categories" on public.categories
  for select to authenticated using (public.is_staff(cafe_id));

create policy "staff read products" on public.products
  for select to authenticated using (public.is_staff(cafe_id));

create policy "guest or staff read orders" on public.orders
  for select to authenticated using (guest_id = auth.uid() or public.is_staff(cafe_id));

create policy "guest or staff read order items" on public.order_items
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and (o.guest_id = auth.uid() or public.is_staff(o.cafe_id))
    )
  );

create policy "staff read calls" on public.waiter_calls
  for select to authenticated using (public.is_staff(cafe_id));

-- Writes only through the functions below.
revoke insert, update, delete on all tables in schema public from anon, authenticated;

-- ─────────────────────────────────────────────────────────────── guest functions

-- Everything a guest needs to render the menu for one QR code. Null for an unknown token.
create or replace function public.guest_table(p_token text)
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'cafe', jsonb_build_object(
      'id', c.id, 'slug', c.slug, 'name', c.name, 'accent', c.accent,
      'defaultLang', c.default_lang, 'allowRepeat', c.allow_repeat, 'callButton', c.call_button
    ),
    'table', jsonb_build_object('id', t.id, 'number', t.number),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'icon', k.icon, 'sort', k.sort) order by k.sort)
      from public.categories k where k.cafe_id = c.id
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoryId', p.category_id, 'name', p.name, 'description', p.description,
        'price', p.price, 'available', p.available, 'options', p.options, 'imageUrl', p.image_url, 'sort', p.sort
      ) order by p.sort)
      from public.products p where p.cafe_id = c.id
    ), '[]'::jsonb)
  )
  from public.dining_tables t
  join public.cafes c on c.id = t.cafe_id
  where t.qr_token = p_token and t.active;
$$;

-- p_items: [{"productId": uuid, "qty": int, "choices": {"<groupId>": "<choiceId>"}, "note": text}]
-- Prices always come from the products table, never from the client.
create or replace function public.place_order(p_token text, p_items jsonb, p_note text default '')
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_table    public.dining_tables;
  v_cafe     public.cafes;
  v_order    uuid;
  v_number   int;
  v_total    int := 0;
  v_item     jsonb;
  v_product  public.products;
  v_group    jsonb;
  v_choice   jsonb;
  v_selected text;
  v_unit     int;
  v_qty      int;
  v_choices  jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_table from public.dining_tables where qr_token = p_token and active;
  if not found then
    raise exception 'invalid_table';
  end if;
  select * into v_cafe from public.cafes where id = v_table.cafe_id;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order';
  end if;
  if jsonb_array_length(p_items) > 40 then
    raise exception 'too_many_items';
  end if;
  if exists (select 1 from public.orders where guest_id = v_uid and created_at > now() - interval '5 seconds') then
    raise exception 'too_fast';
  end if;
  if not v_cafe.allow_repeat and exists (
    select 1 from public.orders
    where guest_id = v_uid and table_id = v_table.id and status in ('pending', 'preparing', 'ready')
  ) then
    raise exception 'order_in_progress';
  end if;

  -- Per-café order numbers without gaps or duplicates under concurrency.
  perform pg_advisory_xact_lock(hashtextextended(v_cafe.id::text, 0));
  select coalesce(max(number), 1000) + 1 into v_number from public.orders where cafe_id = v_cafe.id;

  insert into public.orders (number, cafe_id, table_id, table_number, guest_id, note)
  values (v_number, v_cafe.id, v_table.id, v_table.number, v_uid, left(coalesce(p_note, ''), 300))
  returning id into v_order;

  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_product from public.products
    where id = (v_item ->> 'productId')::uuid and cafe_id = v_cafe.id;
    if not found then
      raise exception 'unknown_product';
    end if;
    if not v_product.available then
      raise exception 'product_unavailable';
    end if;

    v_qty := coalesce((v_item ->> 'qty')::int, 0);
    if v_qty < 1 or v_qty > 50 then
      raise exception 'invalid_quantity';
    end if;

    v_unit := v_product.price;
    v_choices := '[]'::jsonb;
    for v_group in select value from jsonb_array_elements(v_product.options) loop
      v_selected := v_item -> 'choices' ->> (v_group ->> 'id');
      v_choice := null;
      select value into v_choice from jsonb_array_elements(v_group -> 'choices')
      where value ->> 'id' = v_selected limit 1;
      if v_choice is null then
        select value into v_choice from jsonb_array_elements(v_group -> 'choices') limit 1;
      end if;
      continue when v_choice is null;
      v_unit := v_unit + coalesce((v_choice ->> 'price')::int, 0);
      v_choices := v_choices || jsonb_build_array(jsonb_build_object(
        'group', v_group ->> 'id', 'groupName', v_group -> 'name',
        'choice', v_choice ->> 'id', 'choiceName', v_choice -> 'name',
        'quiet', coalesce((v_choice ->> 'quiet')::boolean, false)
      ));
    end loop;

    insert into public.order_items (order_id, product_id, name, qty, unit_price, choices, note)
    values (v_order, v_product.id, v_product.name, v_qty, v_unit, v_choices, left(coalesce(v_item ->> 'note', ''), 200));
    v_total := v_total + v_unit * v_qty;
  end loop;

  update public.orders set total = v_total where id = v_order;
  return v_order;
end;
$$;

create or replace function public.call_waiter(p_token text)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_table public.dining_tables;
  v_open  public.waiter_calls;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_table from public.dining_tables where qr_token = p_token and active;
  if not found then
    raise exception 'invalid_table';
  end if;

  select * into v_open from public.waiter_calls
  where table_id = v_table.id and resolved_at is null
  order by created_at desc limit 1;

  if found then
    -- Repeated taps within 20 s are ignored; later ones refresh the alert.
    if v_open.created_at < now() - interval '20 seconds' then
      update public.waiter_calls set created_at = now() where id = v_open.id;
    end if;
    return;
  end if;

  insert into public.waiter_calls (cafe_id, table_id, table_number, guest_id)
  values (v_table.cafe_id, v_table.id, v_table.number, auth.uid());
end;
$$;

-- ─────────────────────────────────────────────────────────────── staff functions

-- Atomic claim: only one waiter can accept a pending order. Returns 'ok' or 'taken'.
create or replace function public.accept_order(p_order uuid, p_minutes int)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_staff public.staff := public._staff_for_order(p_order);
begin
  if p_minutes is null or p_minutes < 1 or p_minutes > 180 then
    raise exception 'invalid_minutes';
  end if;
  update public.orders
  set status = 'preparing', accepted_at = now(), prep_minutes = p_minutes,
      deadline = now() + make_interval(mins => p_minutes),
      waiter_id = v_staff.id, waiter_name = v_staff.display_name
  where id = p_order and status = 'pending';
  if not found then
    return 'taken';
  end if;
  return 'ok';
end;
$$;

create or replace function public.reject_order(p_order uuid, p_reason text)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_staff public.staff := public._staff_for_order(p_order);
begin
  update public.orders
  set status = 'rejected', rejected_at = now(), reject_reason = left(coalesce(p_reason, ''), 60),
      waiter_id = v_staff.id, waiter_name = v_staff.display_name
  where id = p_order and status = 'pending';
  if not found then
    return 'taken';
  end if;
  return 'ok';
end;
$$;

create or replace function public.extend_order(p_order uuid, p_minutes int)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
  perform public._staff_for_order(p_order);
  if p_minutes is null or p_minutes < 1 or p_minutes > 60 then
    raise exception 'invalid_minutes';
  end if;
  update public.orders
  set deadline = greatest(deadline, now()) + make_interval(mins => p_minutes),
      prep_minutes = ceil(extract(epoch from (greatest(deadline, now()) + make_interval(mins => p_minutes) - accepted_at)) / 60)::int,
      estimate_updated_at = now()
  where id = p_order and status = 'preparing';
  if not found then
    raise exception 'invalid_status';
  end if;
end;
$$;

create or replace function public.mark_order_ready(p_order uuid)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
  perform public._staff_for_order(p_order);
  update public.orders set status = 'ready', ready_at = now()
  where id = p_order and status = 'preparing';
  if not found then
    raise exception 'invalid_status';
  end if;
end;
$$;

create or replace function public.mark_order_served(p_order uuid)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
  perform public._staff_for_order(p_order);
  update public.orders set status = 'served', served_at = now(), ready_at = coalesce(ready_at, now())
  where id = p_order and status in ('preparing', 'ready');
  if not found then
    raise exception 'invalid_status';
  end if;
end;
$$;

create or replace function public.resolve_call(p_call uuid)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_staff public.staff;
begin
  select s.* into v_staff
  from public.waiter_calls c
  join public.staff s on s.cafe_id = c.cafe_id and s.user_id = auth.uid() and s.active
  where c.id = p_call;
  if not found then
    raise exception 'forbidden';
  end if;
  update public.waiter_calls set resolved_at = now(), resolved_by = v_staff.id
  where id = p_call and resolved_at is null;
end;
$$;

-- ─────────────────────────────────────────────────────────────── grants

revoke all on function public.is_staff(uuid)                    from public, anon;
revoke all on function public._staff_for_order(uuid)            from public, anon, authenticated;
revoke all on function public.place_order(text, jsonb, text)    from public, anon;
revoke all on function public.call_waiter(text)                 from public, anon;
revoke all on function public.accept_order(uuid, int)           from public, anon;
revoke all on function public.reject_order(uuid, text)          from public, anon;
revoke all on function public.extend_order(uuid, int)           from public, anon;
revoke all on function public.mark_order_ready(uuid)            from public, anon;
revoke all on function public.mark_order_served(uuid)           from public, anon;
revoke all on function public.resolve_call(uuid)                from public, anon;

grant execute on function public.guest_table(text)              to anon, authenticated;
grant execute on function public.server_now()                   to anon, authenticated;
grant execute on function public.is_staff(uuid)                 to authenticated;
grant execute on function public.place_order(text, jsonb, text) to authenticated;
grant execute on function public.call_waiter(text)              to authenticated;
grant execute on function public.accept_order(uuid, int)        to authenticated;
grant execute on function public.reject_order(uuid, text)       to authenticated;
grant execute on function public.extend_order(uuid, int)        to authenticated;
grant execute on function public.mark_order_ready(uuid)         to authenticated;
grant execute on function public.mark_order_served(uuid)        to authenticated;
grant execute on function public.resolve_call(uuid)             to authenticated;

-- ─────────────────────────────────────────────────────────────── realtime

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders, public.waiter_calls;
  end if;
end;
$$;
