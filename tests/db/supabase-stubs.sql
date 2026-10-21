-- Minimal stand-ins for what a Supabase project provides, so the real migrations can run on a
-- plain PostgreSQL server in tests. Only what the migrations and the tests touch is emulated:
--
--   * roles anon / authenticated / service_role, with Supabase's default privileges on public
--     (new tables and functions are granted to all three — the migrations must revoke what they
--     do not want exposed, exactly like on Supabase);
--   * auth.users and auth.uid(), where the "logged-in user" is the request.jwt.claim.sub setting;
--   * storage.buckets / storage.objects with RLS enabled, so the Storage policies can be checked.
--
-- This is NOT Supabase: PostgREST, GoTrue and Realtime are not involved. Tests built on it prove
-- what the database itself enforces (functions, RLS, grants, locking), nothing more.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id           uuid primary key default gen_random_uuid(),
  email        text unique,
  is_anonymous boolean not null default false
);

create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name      text not null,
  owner     uuid default auth.uid()
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to anon, authenticated;
