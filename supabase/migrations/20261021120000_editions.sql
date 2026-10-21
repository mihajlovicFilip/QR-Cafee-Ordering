-- Stočić — product editions: Stočić Café (tables) and Stočić Hotel (tables and rooms).
--
-- Every establishment has exactly one edition, stored on public.cafes. Both editions share the
-- whole schema and every function; the edition only decides whether rooms exist for the
-- establishment. The rules are enforced here, not just hidden in the browser:
--
--   * guest_table   a room QR code of a café is treated like an inactive code (returns null);
--   * place_order   a café cannot receive a room-service order, even by a direct API call;
--   * admin_*       creating, renumbering, re-keying or removing a room requires Stočić Hotel
--                   ('hotel_only'). Tables are untouched in both editions.
--
-- Existing data keeps working: an establishment that already has rooms, or room-service orders,
-- becomes Stočić Hotel; every other one becomes Stočić Café (it never used rooms, so nothing it
-- did changes). QR tokens, ids, orders and customers are not touched.
--
-- The edition is changed by the operator, not in the admin panel:
--   update public.cafes set edition = 'hotel' where id = '<café id>';
--
-- Run after 20261021090000_order_stats.sql.
-- Rollback: alter table public.cafes drop column edition; then re-run guest_table and
-- place_order from 20261020150000_hardening.sql / 20261020130000_rooms.sql, admin_save_table and
-- admin_add_rooms from 20261020140000_room_floor.sql, admin_delete_table and
-- admin_regenerate_table_token from 20261020120000_admin.sql; drop function public._require_hotel(uuid).

-- === Schema =============================================

alter table public.cafes
  add column if not exists edition text not null default 'cafe' check (edition in ('cafe', 'hotel'));

-- Establishments that already use rooms keep them.
update public.cafes c set edition = 'hotel'
where c.edition <> 'hotel'
  and (
    exists (select 1 from public.dining_tables t where t.cafe_id = c.id and t.kind = 'room')
    or exists (select 1 from public.orders o where o.cafe_id = c.id and o.table_kind = 'room')
  );

-- === Helpers =============================================

-- Raises 'hotel_only' unless the establishment is Stočić Hotel. Called after the caller has been
-- checked as a manager, so the edition is never revealed to anyone else.
create or replace function public._require_hotel(p_cafe uuid)
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.cafes where id = p_cafe and edition = 'hotel') then
    raise exception 'hotel_only';
  end if;
end;
$$;

-- === Guest functions =============================================

create or replace function public.guest_table(p_token text)
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'cafe', jsonb_build_object(
      'id', c.id, 'slug', c.slug, 'name', c.name, 'accent', c.accent,
      'defaultLang', c.default_lang, 'allowRepeat', c.allow_repeat, 'callButton', c.call_button,
      'edition', c.edition
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
  -- A room QR code only works for a Stočić Hotel establishment.
  where t.qr_token = p_token and t.active and (t.kind = 'table' or c.edition = 'hotel');
$$;

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
  v_total    bigint := 0;
  v_item     jsonb;
  v_product  public.products;
  v_group    jsonb;
  v_choice   jsonb;
  v_selected text;
  v_unit     bigint;
  v_qty      int;
  v_choices  jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- One request per guest at a time. A second request from the same guest waits here until the
  -- first one commits, so the checks below always see it (rate limit and "order in progress").
  -- Lock order is always guest → café, so the two locks cannot deadlock.
  perform pg_advisory_xact_lock(hashtextextended('stocic:place_order:' || v_uid::text, 0));

  select * into v_table from public.dining_tables where qr_token = p_token and active;
  if not found then
    raise exception 'invalid_table';
  end if;
  select * into v_cafe from public.cafes where id = v_table.cafe_id;
  -- Room service is a Stočić Hotel feature: for a café a room code is not an active QR code.
  if v_table.kind = 'room' and v_cafe.edition <> 'hotel' then
    raise exception 'invalid_table';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order';
  end if;
  if jsonb_array_length(p_items) > 40 then
    raise exception 'too_many_items';
  end if;
  -- clock_timestamp(): a request that waited on the lock still compares with the real time.
  if exists (select 1 from public.orders where guest_id = v_uid and created_at > clock_timestamp() - interval '5 seconds') then
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

  insert into public.orders (number, cafe_id, table_id, table_number, table_kind, guest_id, note, created_at)
  values (v_number, v_cafe.id, v_table.id, v_table.number, v_table.kind, v_uid, left(coalesce(p_note, ''), 300), clock_timestamp())
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

    v_total := v_total + v_unit * v_qty;
    if v_unit > 2147483647 or v_total > 2147483647 then
      raise exception 'too_many_items';
    end if;
    insert into public.order_items (order_id, product_id, name, qty, unit_price, choices, note)
    values (v_order, v_product.id, v_product.name, v_qty, v_unit, v_choices, left(coalesce(v_item ->> 'note', ''), 200));
  end loop;

  update public.orders set total = v_total where id = v_order;
  return v_order;
end;
$$;

-- === Tables and rooms (admin) =============================================

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
  v_floor  int;
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
  if v_kind = 'room' then
    perform public._require_hotel(p_cafe);
  end if;
  if coalesce(jsonb_typeof(p_table -> 'number'), '') <> 'number' then
    raise exception 'invalid_number';
  end if;
  v_number := round((p_table ->> 'number')::numeric);
  v_seats := coalesce(round((p_table ->> 'seats')::numeric), 2);
  if v_kind = 'room' then
    v_zone := 'room';
    if coalesce(jsonb_typeof(p_table -> 'floor'), 'null') not in ('number', 'null') then
      raise exception 'invalid_floor';
    end if;
    v_floor := round((p_table ->> 'floor')::numeric);
    if v_floor < 0 or v_floor > 200 then
      raise exception 'invalid_floor';
    end if;
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
    insert into public.dining_tables (cafe_id, kind, number, seats, zone, floor)
    values (p_cafe, v_kind, v_number, v_seats, v_zone, v_floor)
    returning id into v_id;
  else
    update public.dining_tables set number = v_number, seats = v_seats, zone = v_zone, floor = v_floor
    where id = v_id and cafe_id = p_cafe and active;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_add_rooms(p_cafe uuid, p_from int, p_to int, p_floor int default null)
returns int
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  perform public._require_manager(p_cafe);
  perform public._require_hotel(p_cafe);
  if p_from is null or p_to is null or p_from < 1 or p_to > 9999 or p_to < p_from or p_to - p_from >= 300 then
    raise exception 'invalid_range';
  end if;
  if p_floor < 0 or p_floor > 200 then
    raise exception 'invalid_floor';
  end if;
  insert into public.dining_tables (cafe_id, kind, number, seats, zone, floor)
  select p_cafe, 'room', n, 2, 'room', p_floor
  from generate_series(p_from, p_to) as n
  where not exists (
    select 1 from public.dining_tables d
    where d.cafe_id = p_cafe and d.kind = 'room' and d.number = n and d.active
  );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.admin_delete_table(p_table uuid)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_cafe uuid;
  v_kind text;
begin
  select cafe_id, kind into v_cafe, v_kind from public.dining_tables where id = p_table and active;
  if not found then
    raise exception 'gone';
  end if;
  perform public._require_manager(v_cafe);
  if v_kind = 'room' then
    perform public._require_hotel(v_cafe);
  end if;
  if exists (select 1 from public.orders where table_id = p_table) then
    -- Orders point at the table: hide it instead. Its QR code stops working right away
    -- (guest_table and place_order only accept active tables).
    update public.dining_tables set active = false where id = p_table;
    update public.waiter_calls set resolved_at = now() where table_id = p_table and resolved_at is null;
  else
    delete from public.dining_tables where id = p_table;
  end if;
end;
$$;

create or replace function public.admin_regenerate_table_token(p_table uuid)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_cafe  uuid;
  v_kind  text;
  v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  select cafe_id, kind into v_cafe, v_kind from public.dining_tables where id = p_table and active;
  if not found then
    raise exception 'gone';
  end if;
  perform public._require_manager(v_cafe);
  if v_kind = 'room' then
    perform public._require_hotel(v_cafe);
  end if;
  update public.dining_tables set qr_token = v_token where id = p_table;
  return v_token;
end;
$$;

-- === Grants =============================================

-- Re-created functions keep their grants; only the new helper needs revoking.
revoke all on function public._require_hotel(uuid) from public, anon, authenticated;
