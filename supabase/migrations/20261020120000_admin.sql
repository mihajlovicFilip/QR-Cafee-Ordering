-- Stočić — phase 2: administrator panel (menu, tables and QR codes, staff, café settings).
--
-- Same model as phase 1: the browser never writes tables directly. Every admin change goes
-- through a SECURITY DEFINER function that first checks that the caller is an active owner or
-- manager of that café. Guest and waiter rules from the first migration are unchanged.
--
-- Run after 20261020000000_init.sql (Supabase → SQL Editor → paste → Run).

-- === Schema changes =============================================

-- A removed table keeps its row (orders point at it) but must not block its number,
-- so the number only has to be unique among active tables.
alter table public.dining_tables drop constraint if exists dining_tables_cafe_id_number_key;
create unique index if not exists dining_tables_active_number_idx
  on public.dining_tables (cafe_id, number) where active;

-- === Helpers =============================================

create or replace function public.is_manager(p_cafe uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff s
    where s.cafe_id = p_cafe and s.user_id = auth.uid() and s.active and s.role in ('owner', 'manager')
  );
$$;

-- The manager's staff row, or raises 'forbidden'. p_actor is only passed by the
-- service-role functions used by the invite-staff Edge Function; otherwise auth.uid() is used.
create or replace function public._require_manager(p_cafe uuid, p_actor uuid default null)
returns public.staff
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_staff public.staff;
begin
  select * into v_staff from public.staff
  where cafe_id = p_cafe and user_id = coalesce(p_actor, auth.uid()) and active and role in ('owner', 'manager');
  if not found then
    raise exception 'forbidden';
  end if;
  return v_staff;
end;
$$;

-- {"sr": " Kafa ", "en": "", "x": 1} → {"sr": "Kafa"}: trimmed, length-capped strings under two-letter keys.
create or replace function public._clean_localized(p jsonb, p_max int)
returns jsonb
language sql immutable set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(key, left(btrim(value #>> '{}'), p_max)), '{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end)
  where key ~ '^[a-z]{2}$' and jsonb_typeof(value) = 'string' and btrim(value #>> '{}') <> '';
$$;

-- Validates option groups and keeps only known keys. Same shape place_order() reads:
-- [{"id","name":{..},"choices":[{"id","name":{..},"price":int,"quiet":bool}]}]
create or replace function public._clean_options(p jsonb)
returns jsonb
language plpgsql immutable set search_path = public, pg_temp
as $$
declare
  v_out      jsonb := '[]'::jsonb;
  v_group    jsonb;
  v_choice   jsonb;
  v_choices  jsonb;
  v_gids     text[] := '{}';
  v_cids     text[];
  v_gid      text;
  v_cid      text;
  v_name     jsonb;
  v_price    int;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 10 then
    raise exception 'invalid_input';
  end if;

  for v_group in select value from jsonb_array_elements(p) loop
    v_gid := left(btrim(coalesce(v_group ->> 'id', '')), 40);
    if v_gid = '' or v_gid = any (v_gids) then
      raise exception 'invalid_input';
    end if;
    v_gids := v_gids || v_gid;

    v_name := public._clean_localized(v_group -> 'name', 60);
    if coalesce(v_name ->> 'sr', '') = '' then
      raise exception 'name_required';
    end if;
    if coalesce(jsonb_typeof(v_group -> 'choices'), '') <> 'array'
       or jsonb_array_length(v_group -> 'choices') not between 1 and 20 then
      raise exception 'invalid_input';
    end if;

    v_choices := '[]'::jsonb;
    v_cids := '{}';
    for v_choice in select value from jsonb_array_elements(v_group -> 'choices') loop
      v_cid := left(btrim(coalesce(v_choice ->> 'id', '')), 40);
      if v_cid = '' or v_cid = any (v_cids) then
        raise exception 'invalid_input';
      end if;
      v_cids := v_cids || v_cid;
      if coalesce(public._clean_localized(v_choice -> 'name', 60) ->> 'sr', '') = '' then
        raise exception 'name_required';
      end if;
      if coalesce(jsonb_typeof(v_choice -> 'price'), 'null') not in ('number', 'null') then
        raise exception 'invalid_price';
      end if;
      v_price := coalesce(round((v_choice ->> 'price')::numeric), 0);
      if v_price < 0 or v_price > 100000 then
        raise exception 'invalid_price';
      end if;
      v_choices := v_choices || jsonb_build_array(jsonb_build_object(
        'id', v_cid,
        'name', public._clean_localized(v_choice -> 'name', 60),
        'price', v_price,
        'quiet', coalesce((v_choice ->> 'quiet')::boolean, false)
      ));
    end loop;

    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_gid, 'name', v_name, 'choices', v_choices));
  end loop;
  return v_out;
end;
$$;

-- Storage paths look like "<cafe uuid>/<file>". Null for anything else.
create or replace function public.cafe_from_storage_path(p_name text)
returns uuid
language sql immutable set search_path = public, pg_temp
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- === Café settings =============================================

-- p_settings: {"name","accent","defaultLang","allowRepeat","callButton","phone","email","address",
--              "openingHours":{"weekdays","saturday","sunday"}}
create or replace function public.admin_update_cafe(p_cafe uuid, p_settings jsonb)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_name   text := left(btrim(coalesce(p_settings ->> 'name', '')), 80);
  v_accent text := lower(btrim(coalesce(p_settings ->> 'accent', '')));
  v_lang   text := coalesce(p_settings ->> 'defaultLang', '');
  v_hours  jsonb;
begin
  perform public._require_manager(p_cafe);
  if v_name = '' then
    raise exception 'name_required';
  end if;
  if v_accent !~ '^#[0-9a-f]{6}$' then
    raise exception 'invalid_color';
  end if;
  if v_lang not in ('sr', 'en') then
    raise exception 'invalid_input';
  end if;

  select coalesce(jsonb_object_agg(key, left(btrim(value #>> '{}'), 40)), '{}'::jsonb) into v_hours
  from jsonb_each(case when jsonb_typeof(p_settings -> 'openingHours') = 'object' then p_settings -> 'openingHours' else '{}'::jsonb end)
  where key in ('weekdays', 'saturday', 'sunday') and jsonb_typeof(value) = 'string';

  update public.cafes set
    name          = v_name,
    accent        = v_accent,
    default_lang  = v_lang,
    allow_repeat  = coalesce((p_settings ->> 'allowRepeat')::boolean, allow_repeat),
    call_button   = coalesce((p_settings ->> 'callButton')::boolean, call_button),
    phone         = nullif(left(btrim(coalesce(p_settings ->> 'phone', '')), 40), ''),
    email         = nullif(left(btrim(coalesce(p_settings ->> 'email', '')), 120), ''),
    address       = nullif(left(btrim(coalesce(p_settings ->> 'address', '')), 160), ''),
    opening_hours = v_hours
  where id = p_cafe;
end;
$$;

-- === Menu =============================================

-- p_category: {"id"?: uuid, "name": {"sr","en"}, "icon"}. Returns the category id.
create or replace function public.admin_save_category(p_cafe uuid, p_category jsonb)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_id   uuid := nullif(p_category ->> 'id', '')::uuid;
  v_name jsonb := public._clean_localized(p_category -> 'name', 60);
  v_icon text := coalesce(p_category ->> 'icon', 'coffee');
begin
  perform public._require_manager(p_cafe);
  if coalesce(v_name ->> 'sr', '') = '' then
    raise exception 'name_required';
  end if;
  if v_icon not in ('coffee', 'tea', 'juice', 'breakfast', 'dessert', 'bar') then
    raise exception 'invalid_input';
  end if;

  if v_id is null then
    insert into public.categories (cafe_id, name, icon, sort)
    values (p_cafe, v_name, v_icon, (select coalesce(max(sort), 0) + 1 from public.categories where cafe_id = p_cafe))
    returning id into v_id;
  else
    update public.categories set name = v_name, icon = v_icon where id = v_id and cafe_id = p_cafe;
    if not found then
      raise exception 'gone';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_delete_category(p_category uuid)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_cafe uuid;
begin
  select cafe_id into v_cafe from public.categories where id = p_category;
  if not found then
    raise exception 'gone';
  end if;
  perform public._require_manager(v_cafe);
  -- Products without a category are invisible to guests, so never orphan them silently.
  if exists (select 1 from public.products where category_id = p_category) then
    raise exception 'category_not_empty';
  end if;
  delete from public.categories where id = p_category;
end;
$$;

-- p_ids: every category id of the café, in the new order.
create or replace function public.admin_reorder_categories(p_cafe uuid, p_ids uuid[])
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
  perform public._require_manager(p_cafe);
  update public.categories c set sort = x.ord
  from unnest(p_ids) with ordinality as x(id, ord)
  where c.id = x.id and c.cafe_id = p_cafe;
end;
$$;

-- p_product: {"id"?, "categoryId", "name", "description", "price", "available", "options", "imageUrl"}.
-- Returns the product id. Prices are whole dinars.
create or replace function public.admin_save_product(p_cafe uuid, p_product jsonb)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_id        uuid := nullif(p_product ->> 'id', '')::uuid;
  v_category  uuid := nullif(p_product ->> 'categoryId', '')::uuid;
  v_name      jsonb := public._clean_localized(p_product -> 'name', 80);
  v_desc      jsonb := public._clean_localized(p_product -> 'description', 400);
  v_image     text := nullif(btrim(coalesce(p_product ->> 'imageUrl', '')), '');
  v_available boolean := coalesce((p_product ->> 'available')::boolean, true);
  v_options   jsonb;
  v_price     int;
begin
  perform public._require_manager(p_cafe);
  if coalesce(v_name ->> 'sr', '') = '' then
    raise exception 'name_required';
  end if;
  if coalesce(jsonb_typeof(p_product -> 'price'), '') <> 'number' then
    raise exception 'invalid_price';
  end if;
  v_price := round((p_product ->> 'price')::numeric);
  if v_price < 0 or v_price > 1000000 then
    raise exception 'invalid_price';
  end if;
  if v_category is not null and not exists (select 1 from public.categories where id = v_category and cafe_id = p_cafe) then
    raise exception 'invalid_input';
  end if;
  if v_image is not null and (length(v_image) > 1000 or v_image !~ '^https?://') then
    raise exception 'invalid_input';
  end if;
  v_options := public._clean_options(p_product -> 'options');

  if v_id is null then
    insert into public.products (cafe_id, category_id, name, description, price, available, options, image_url, sort)
    values (p_cafe, v_category, v_name, v_desc, v_price, v_available, v_options, v_image,
            (select coalesce(max(sort), 0) + 1 from public.products where cafe_id = p_cafe))
    returning id into v_id;
  else
    update public.products set
      category_id = v_category, name = v_name, description = v_desc, price = v_price,
      available = v_available, options = v_options, image_url = v_image
    where id = v_id and cafe_id = p_cafe;
    if not found then
      raise exception 'gone';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_set_product_available(p_product uuid, p_available boolean)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_cafe uuid;
begin
  select cafe_id into v_cafe from public.products where id = p_product;
  if not found then
    raise exception 'gone';
  end if;
  perform public._require_manager(v_cafe);
  update public.products set available = coalesce(p_available, true) where id = p_product;
end;
$$;

-- Old orders keep their own snapshot of the name and price (order_items.product_id becomes null).
create or replace function public.admin_delete_product(p_product uuid)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_cafe uuid;
begin
  select cafe_id into v_cafe from public.products where id = p_product;
  if not found then
    raise exception 'gone';
  end if;
  perform public._require_manager(v_cafe);
  delete from public.products where id = p_product;
end;
$$;

-- === Tables and QR codes =============================================

-- p_table: {"id"?, "number", "seats", "zone"}. A new table gets a random 32-character QR token.
create or replace function public.admin_save_table(p_cafe uuid, p_table jsonb)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_id     uuid := nullif(p_table ->> 'id', '')::uuid;
  v_number int;
  v_seats  int;
  v_zone   text := coalesce(nullif(btrim(p_table ->> 'zone'), ''), 'hall');
begin
  perform public._require_manager(p_cafe);
  if coalesce(jsonb_typeof(p_table -> 'number'), '') <> 'number' then
    raise exception 'invalid_number';
  end if;
  v_number := round((p_table ->> 'number')::numeric);
  v_seats := coalesce(round((p_table ->> 'seats')::numeric), 2);
  if v_number < 1 or v_number > 9999 then
    raise exception 'invalid_number';
  end if;
  if v_seats < 1 or v_seats > 50 or v_zone not in ('hall', 'garden', 'terrace', 'bar') then
    raise exception 'invalid_input';
  end if;
  if exists (
    select 1 from public.dining_tables
    where cafe_id = p_cafe and number = v_number and active and id is distinct from v_id
  ) then
    raise exception 'duplicate_number';
  end if;

  if v_id is null then
    insert into public.dining_tables (cafe_id, number, seats, zone)
    values (p_cafe, v_number, v_seats, v_zone)
    returning id into v_id;
  else
    update public.dining_tables set number = v_number, seats = v_seats, zone = v_zone
    where id = v_id and cafe_id = p_cafe and active;
    if not found then
      raise exception 'gone';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_delete_table(p_table uuid)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_cafe uuid;
begin
  select cafe_id into v_cafe from public.dining_tables where id = p_table and active;
  if not found then
    raise exception 'gone';
  end if;
  perform public._require_manager(v_cafe);
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

-- A new token makes the printed QR code useless (e.g. after a code was photographed and shared).
create or replace function public.admin_regenerate_table_token(p_table uuid)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_cafe  uuid;
  v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  select cafe_id into v_cafe from public.dining_tables where id = p_table and active;
  if not found then
    raise exception 'gone';
  end if;
  perform public._require_manager(v_cafe);
  update public.dining_tables set qr_token = v_token where id = p_table;
  return v_token;
end;
$$;

-- === Staff =============================================

-- The team with login emails (auth.users is not readable from the browser).
create or replace function public.admin_staff(p_cafe uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public._require_manager(p_cafe);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.display_name, 'role', s.role, 'active', s.active, 'email', u.email
    ) order by s.active desc, array_position(array['owner', 'manager', 'waiter', 'barista'], s.role), s.display_name)
    from public.staff s
    left join auth.users u on u.id = s.user_id
    where s.cafe_id = p_cafe
  ), '[]'::jsonb);
end;
$$;

-- Managers run the floor; only owners can create, change or demote owners.
-- Nobody changes their own role or access, so a café always keeps at least one owner.
create or replace function public.admin_update_staff(p_staff uuid, p_role text, p_active boolean)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_target public.staff;
  v_me     public.staff;
begin
  select * into v_target from public.staff where id = p_staff;
  if not found then
    raise exception 'gone';
  end if;
  v_me := public._require_manager(v_target.cafe_id);
  if v_target.id = v_me.id then
    raise exception 'cannot_change_self';
  end if;
  if coalesce(p_role, '') not in ('owner', 'manager', 'waiter', 'barista') then
    raise exception 'invalid_input';
  end if;
  if (v_target.role = 'owner' or p_role = 'owner') and v_me.role <> 'owner' then
    raise exception 'owner_required';
  end if;
  update public.staff set role = p_role, active = coalesce(p_active, active) where id = p_staff;
end;
$$;

-- Used by the invite-staff Edge Function (service_role) before it creates a login,
-- so a waiter can never make the function create accounts.
create or replace function public.staff_invite_check(p_actor uuid, p_cafe uuid, p_role text)
returns public.staff
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_me public.staff;
begin
  if p_actor is null then
    raise exception 'not_authenticated';
  end if;
  v_me := public._require_manager(p_cafe, p_actor);
  if coalesce(p_role, '') not in ('owner', 'manager', 'waiter', 'barista') then
    raise exception 'invalid_input';
  end if;
  if p_role = 'owner' and v_me.role <> 'owner' then
    raise exception 'owner_required';
  end if;
  return v_me;
end;
$$;

create or replace function public.staff_user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select id from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
$$;

-- Links a login to the café (or re-activates it). Returns the staff id.
create or replace function public.staff_link_user(p_actor uuid, p_cafe uuid, p_user uuid, p_name text, p_role text)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_me       public.staff := public.staff_invite_check(p_actor, p_cafe, p_role);
  v_name     text := left(btrim(coalesce(p_name, '')), 60);
  v_existing public.staff;
  v_id       uuid;
begin
  if v_name = '' then
    raise exception 'name_required';
  end if;
  select * into v_existing from public.staff where cafe_id = p_cafe and user_id = p_user;
  if found then
    if v_existing.id = v_me.id then
      raise exception 'cannot_change_self';
    end if;
    if v_existing.active then
      raise exception 'already_staff';
    end if;
    if v_existing.role = 'owner' and v_me.role <> 'owner' then
      raise exception 'owner_required';
    end if;
    update public.staff set active = true, role = p_role, display_name = v_name where id = v_existing.id;
    return v_existing.id;
  end if;
  insert into public.staff (user_id, cafe_id, display_name, role)
  values (p_user, p_cafe, v_name, p_role)
  returning id into v_id;
  return v_id;
end;
$$;

-- === Product photos (Storage) =============================================

-- Public bucket: anyone can view a photo by URL (guests need that), only managers can upload,
-- and only into their own café's folder ("<cafe id>/<file>").
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "managers read product images" on storage.objects;
drop policy if exists "managers upload product images" on storage.objects;
drop policy if exists "managers update product images" on storage.objects;
drop policy if exists "managers delete product images" on storage.objects;

create policy "managers read product images" on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and public.is_manager(public.cafe_from_storage_path(name)));

create policy "managers upload product images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_manager(public.cafe_from_storage_path(name)));

create policy "managers update product images" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_manager(public.cafe_from_storage_path(name)))
  with check (bucket_id = 'product-images' and public.is_manager(public.cafe_from_storage_path(name)));

create policy "managers delete product images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_manager(public.cafe_from_storage_path(name)));

-- === Grants =============================================

revoke all on function public.is_manager(uuid)                               from public, anon;
revoke all on function public._require_manager(uuid, uuid)                   from public, anon, authenticated;
revoke all on function public._clean_localized(jsonb, int)                   from public, anon, authenticated;
revoke all on function public._clean_options(jsonb)                          from public, anon, authenticated;
revoke all on function public.cafe_from_storage_path(text)                   from public, anon;
revoke all on function public.admin_update_cafe(uuid, jsonb)                 from public, anon;
revoke all on function public.admin_save_category(uuid, jsonb)               from public, anon;
revoke all on function public.admin_delete_category(uuid)                    from public, anon;
revoke all on function public.admin_reorder_categories(uuid, uuid[])         from public, anon;
revoke all on function public.admin_save_product(uuid, jsonb)                from public, anon;
revoke all on function public.admin_set_product_available(uuid, boolean)     from public, anon;
revoke all on function public.admin_delete_product(uuid)                     from public, anon;
revoke all on function public.admin_save_table(uuid, jsonb)                  from public, anon;
revoke all on function public.admin_delete_table(uuid)                       from public, anon;
revoke all on function public.admin_regenerate_table_token(uuid)             from public, anon;
revoke all on function public.admin_staff(uuid)                              from public, anon;
revoke all on function public.admin_update_staff(uuid, text, boolean)        from public, anon;
revoke all on function public.staff_invite_check(uuid, uuid, text)           from public, anon, authenticated;
revoke all on function public.staff_user_id_by_email(text)                   from public, anon, authenticated;
revoke all on function public.staff_link_user(uuid, uuid, uuid, text, text)  from public, anon, authenticated;

grant execute on function public.is_manager(uuid)                            to authenticated;
grant execute on function public.cafe_from_storage_path(text)                to authenticated;
grant execute on function public.admin_update_cafe(uuid, jsonb)              to authenticated;
grant execute on function public.admin_save_category(uuid, jsonb)            to authenticated;
grant execute on function public.admin_delete_category(uuid)                 to authenticated;
grant execute on function public.admin_reorder_categories(uuid, uuid[])      to authenticated;
grant execute on function public.admin_save_product(uuid, jsonb)             to authenticated;
grant execute on function public.admin_set_product_available(uuid, boolean)  to authenticated;
grant execute on function public.admin_delete_product(uuid)                  to authenticated;
grant execute on function public.admin_save_table(uuid, jsonb)               to authenticated;
grant execute on function public.admin_delete_table(uuid)                    to authenticated;
grant execute on function public.admin_regenerate_table_token(uuid)          to authenticated;
grant execute on function public.admin_staff(uuid)                           to authenticated;
grant execute on function public.admin_update_staff(uuid, text, boolean)     to authenticated;
grant execute on function public.staff_invite_check(uuid, uuid, text)        to service_role;
grant execute on function public.staff_user_id_by_email(text)                to service_role;
grant execute on function public.staff_link_user(uuid, uuid, uuid, text, text) to service_role;
