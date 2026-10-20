-- Link a staff login to the café.
--
-- 1. Supabase → Authentication → Users → "Add user" → enter the waiter's email and a password,
--    and tick "Auto Confirm User".
-- 2. Replace the email and name below, then run this in the SQL Editor.
--    Roles: 'waiter', 'barista', 'manager', 'owner'.

insert into public.staff (user_id, cafe_id, display_name, role)
select id, '00000000-0000-4000-8000-000000000001', 'Ana Petrović', 'waiter'
from auth.users
where email = 'ana@example.com';
