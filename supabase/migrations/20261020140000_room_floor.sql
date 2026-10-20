-- Stočić — a floor for every room.
--
-- Rooms get an explicit floor (0 = ground floor, null = not set), entered when rooms are added
-- or edited, so numbering that does not follow "402 = floor 4" still shows the right floor.
--
-- Run after 20261020130000_rooms.sql.

alter table public.dining_tables
  add column if not exists floor int check (floor between 0 and 200);

-- Existing rooms: the usual hotel convention (room 402 is on floor 4).
update public.dining_tables set floor = number / 100
where kind = 'room' and floor is null and number >= 100;

-- p_table: {"id"?, "kind", "number", "seats", "zone", "floor"}. The kind is fixed once the place exists;
-- floor is for rooms only (0 = ground floor, null = not set).
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

-- Adds rooms p_from..p_to (at most 300 at once) on floor p_floor, skipping numbers that already exist.
-- Each new room gets a random QR token. Returns how many rooms were added.
drop function if exists public.admin_add_rooms(uuid, int, int);

create or replace function public.admin_add_rooms(p_cafe uuid, p_from int, p_to int, p_floor int default null)
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

revoke all on function public.admin_add_rooms(uuid, int, int, int) from public, anon;
grant execute on function public.admin_add_rooms(uuid, int, int, int) to authenticated;
