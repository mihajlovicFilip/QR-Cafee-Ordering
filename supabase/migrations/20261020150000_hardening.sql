-- Stočić — concurrency and privilege hardening.
--
-- Fixes, each demonstrated by a failing test in tests/db before this migration:
--
--   1. place_order: the five-second limit and the "one open order" rule were checked before any
--      lock, so simultaneous requests from one guest all passed (10 out of 10 in the test).
--      Now every request of a guest takes a per-guest transaction lock first; a second request
--      waits until the first commits and then sees it.
--   2. place_order: an order whose total exceeded the int range failed with
--      "integer out of range"; it is now reported as too_many_items.
--   3. call_waiter: simultaneous taps could open several calls for one table. A per-table lock
--      makes "find the open call, else insert" atomic.
--   4. anon and authenticated still held TRUNCATE, REFERENCES and TRIGGER on every table
--      (Supabase grants ALL by default; the first migration revoked only INSERT/UPDATE/DELETE).
--      TRUNCATE ignores RLS. PostgREST does not expose it, but nothing in the browser needs it.
--
-- No data is changed. Function signatures and behaviour for normal use are unchanged.
-- Run after 20261020140000_room_floor.sql.
--
-- Rollback (not recommended): re-run the place_order and call_waiter definitions from
-- 20261020130000_rooms.sql, and
--   grant truncate, references, trigger on all tables in schema public to anon, authenticated;

-- ─────────────────────────────────────────────────────────────── privileges

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- ─────────────────────────────────────────────────────────────── place_order

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

-- ─────────────────────────────────────────────────────────────── call_waiter

-- Tables only (rooms have no "call waiter" button). One open call per table, even when several
-- guests tap at the same moment.
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

  perform pg_advisory_xact_lock(hashtextextended('stocic:call_waiter:' || v_table.id::text, 0));

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
