-- Stočić — order statistics for the admin overview (today, last 7 or 30 days, or one chosen day).
--
-- Totals are computed in the database instead of downloading every order: the API returns at
-- most 1000 rows per request, which a busy café exceeds within a month. Days are counted in the
-- time zone the browser sends (e.g. Europe/Belgrade), so "today" matches the café's calendar.
--
-- Run after 20261020150000_hardening.sql. Rollback: drop function public.admin_order_stats(uuid, timestamptz, timestamptz, text);

-- Orders created in [p_since, p_until); p_until null = up to now.
create or replace function public.admin_order_stats(p_cafe uuid, p_since timestamptz, p_until timestamptz default null, p_tz text default 'Europe/Belgrade')
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_tz    text := coalesce(nullif(btrim(p_tz), ''), 'Europe/Belgrade');
  -- At most a little over a year, so one call can never scan the whole history.
  v_since timestamptz := greatest(coalesce(p_since, now() - interval '1 day'), now() - interval '400 days');
  v_until timestamptz := least(coalesce(p_until, now()), now());
begin
  perform public._require_manager(p_cafe);
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'Europe/Belgrade';
  end if;

  return (
    with o as (
      select * from public.orders
      where cafe_id = p_cafe and created_at >= v_since and (p_until is null or created_at < p_until)
    ),
    kept as (
      select * from o where status <> 'rejected'
    ),
    days as (
      select d::date as day
      from generate_series((v_since at time zone v_tz)::date, ((v_until - interval '1 microsecond') at time zone v_tz)::date, interval '1 day') as d
    ),
    per_day as (
      select (created_at at time zone v_tz)::date as day,
             count(*)::int as orders,
             coalesce(sum(total) filter (where status <> 'pending'), 0)::bigint as revenue
      from kept group by 1
    ),
    per_hour as (
      select extract(hour from created_at at time zone v_tz)::int as hour, count(*)::int as orders
      from o group by 1
    ),
    sellers as (
      select coalesce(i.product_id::text, i.name::text) as key,
             (array_agg(i.name order by k.created_at desc))[1] as name,
             sum(i.qty)::int as qty,
             sum(i.qty::bigint * i.unit_price)::bigint as revenue
      from kept k join public.order_items i on i.order_id = k.id
      group by 1
      order by qty desc, revenue desc
      limit 5
    ),
    prepped as (
      select extract(epoch from ready_at - accepted_at) / 60 as minutes
      from o where accepted_at is not null and ready_at > accepted_at
    )
    select jsonb_build_object(
      'orders',      (select count(*) from kept),
      'rejected',    (select count(*) from o where status = 'rejected'),
      'revenue',     (select coalesce(sum(total) filter (where status <> 'pending'), 0) from kept),
      'roomOrders',  (select count(*) from kept where table_kind = 'room'),
      'prepCount',   (select count(*) from prepped),
      'prepMinutes', (select round(avg(minutes)::numeric, 1) from prepped),
      'byDay',       (select coalesce(jsonb_agg(jsonb_build_object(
                        'day', to_char(days.day, 'YYYY-MM-DD'),
                        'orders', coalesce(per_day.orders, 0),
                        'revenue', coalesce(per_day.revenue, 0)) order by days.day), '[]'::jsonb)
                      from days left join per_day using (day)),
      'byHour',      (select coalesce(jsonb_agg(jsonb_build_object('hour', hour, 'orders', orders) order by hour), '[]'::jsonb) from per_hour),
      'top',         (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'name', name, 'qty', qty, 'revenue', revenue)
                        order by qty desc, revenue desc), '[]'::jsonb) from sellers)
    )
  );
end;
$$;

revoke all on function public.admin_order_stats(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_order_stats(uuid, timestamptz, timestamptz, text) to authenticated;
