-- Stočić — the end of the working day: every staff sign-in ends on its own at this time.
--
-- Waiters sign in once and stay signed in until the working day ends; then the app signs them
-- out. Each establishment sets the time in Settings (admin panel). A bar that works past midnight
-- picks a time after closing; the default, 03:00, suits most.
--
-- The app keeps the sign-in times on the device and does the signing out; the database only
-- stores the setting, so nothing here touches sessions, staff or orders.
--
-- Run after 20261021120000_editions.sql.
-- Rollback: alter table public.cafes drop column workday_end; then re-run admin_update_cafe
-- from 20261020120000_admin.sql.

-- === Schema =============================================

alter table public.cafes
  add column if not exists workday_end time not null default '03:00';

-- === Settings =============================================

-- As in 20261020120000_admin.sql, plus "workdayEnd" ("HH:MM"). Leaving it out keeps the current
-- time, so an older app that does not send it changes nothing.
create or replace function public.admin_update_cafe(p_cafe uuid, p_settings jsonb)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_name   text := left(btrim(coalesce(p_settings ->> 'name', '')), 80);
  v_accent text := lower(btrim(coalesce(p_settings ->> 'accent', '')));
  v_lang   text := coalesce(p_settings ->> 'defaultLang', '');
  v_end    text := nullif(btrim(coalesce(p_settings ->> 'workdayEnd', '')), '');
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
  if v_end is not null and v_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'invalid_workday_end';
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
    opening_hours = v_hours,
    workday_end   = coalesce(v_end::time, workday_end)
  where id = p_cafe;
end;
$$;
