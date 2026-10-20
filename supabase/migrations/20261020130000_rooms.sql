-- Stočić — hotel rooms (room service) next to tables.
--
-- A room is a dining_tables row with kind = 'room': it has its own QR code, guests order
-- exactly like at a table, and the waiter delivers to the room. Rooms have no "call waiter"
-- button. Every order remembers whether it came from a table or a room (orders.table_kind).
--
-- Run after 20261020120000_admin.sql.

-- ─────────────────────────────────────────────────────────────── schema changes

alter table public.dining_tables
  add column if not exists kind text not null default 'table' check (kind in ('table', 'room'));

alter table public.orders
  add column if not exists table_kind text not null default 'table' check (table_kind in ('table', 'room'));

-- Table 7 and room 7 may both exist; numbers are unique per kind among active places.
drop index if exists public.dining_tables_active_number_idx;
create unique index if not exists dining_tables_active_kind_number_idx
  on public.dining_tables (cafe_id, kind, number) where active;

-- ─────────────────────────────────────────────────────────────── guest functions (same rules, plus the kind)

create or replace function public.guest_table(p_token text)
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'cafe', jsonb_build_object(
      'id', c.id, 'slug', c.slug, 'name', c.name, 'accent', c.accent,
      'defaultLang', c.default_lang, 'allowRepeat', c.allow_repeat, 'callButton', c.call_button
    ),
    'table', jsonb_build_object('id', t.id, 'number', t.number, 'kind', t.kind),
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

-- Unchanged from the first migration except that the order stores table_kind.
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

  insert into public.orders (number, cafe_id, table_id, table_number, table_kind, guest_id, note)
  values (v_number, v_cafe.id, v_table.id, v_table.number, v_table.kind, v_uid, left(coalesce(p_note, ''), 300))
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

-- Tables only: rooms have no "call waiter" button.
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
  select * into v_table from public.dining_tables where qr_token = p_token and active and kind = 'table';
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

-- ─────────────────────────────────────────────────────────────── admin

-- p_table: {"id"?, "kind", "number", "seats", "zone"}. The kind is fixed once the place exists.
create or replace function public.admin_save_table(p_cafe uuid, p_table jsonb)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_id     uuid := nullif(p_table ->> 'id', '')::uuid;
  v_kind   text := coalesce(nullif(p_table ->> 'kind', ''), 'table');
  v_number int;
  v_seats  int;
  v_zone   text := coalesce(nullif(btrim(p_table ->> 'zone'), ''), 'hall');
begin
  perform public._require_manager(p_cafe);
  if v_id is not null then
    select kind into v_kind from public.dining_tables where id = v_id and cafe_id = p_cafe and active;
    if not found then
      raise exception 'gone';
    end if;
  end if;
  if v_kind not in ('table', 'room') then
    raise exception 'invalid_input';
  end if;
  if coalesce(jsonb_typeof(p_table -> 'number'), '') <> 'number' then
    raise exception 'invalid_number';
  end if;
  v_number := round((p_table ->> 'number')::numeric);
  v_seats := coalesce(round((p_table ->> 'seats')::numeric), 2);
  if v_kind = 'room' then
    v_zone := 'room';
  end if;
  if v_number < 1 or v_number > 9999 then
    raise exception 'invalid_number';
  end if;
  if v_seats < 1 or v_seats > 50 or (v_kind = 'table' and v_zone not in ('hall', 'garden', 'terrace', 'bar')) then
    raise exception 'invalid_input';
  end if;
  if exists (
    select 1 from public.dining_tables
    where cafe_id = p_cafe and kind = v_kind and number = v_number and active and id is distinct from v_id
  ) then
    raise exception 'duplicate_number';
  end if;

  if v_id is null then
    insert into public.dining_tables (cafe_id, kind, number, seats, zone)
    values (p_cafe, v_kind, v_number, v_seats, v_zone)
    returning id into v_id;
  else
    update public.dining_tables set number = v_number, seats = v_seats, zone = v_zone
    where id = v_id and cafe_id = p_cafe and active;
  end if;
  return v_id;
end;
$$;

-- Adds rooms p_from..p_to (at most 300 at once), skipping numbers that already exist.
-- Each new room gets a random QR token. Returns how many rooms were added.
create or replace function public.admin_add_rooms(p_cafe uuid, p_from int, p_to int)
returns int
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  perform public._require_manager(p_cafe);
  if p_from is null or p_to is null or p_from < 1 or p_to > 9999 or p_to < p_from or p_to - p_from >= 300 then
    raise exception 'invalid_range';
  end if;
  insert into public.dining_tables (cafe_id, kind, number, seats, zone)
  select p_cafe, 'room', n, 2, 'room'
  from generate_series(p_from, p_to) as n
  where not exists (
    select 1 from public.dining_tables d
    where d.cafe_id = p_cafe and d.kind = 'room' and d.number = n and d.active
  );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.admin_add_rooms(uuid, int, int) from public, anon;
grant execute on function public.admin_add_rooms(uuid, int, int) to authenticated;
