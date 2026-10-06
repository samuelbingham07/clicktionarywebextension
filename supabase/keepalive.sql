-- Heartbeat for the GitHub Actions keep-alive (.github/workflows/supabase-keepalive.yml).
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- The anon key can only call keepalive(), which bumps a single timestamp.
-- The table itself stays locked down by RLS with no policies.

create table if not exists public.keepalive (
  id int primary key,
  pinged_at timestamptz not null default now()
);

insert into public.keepalive (id) values (1) on conflict (id) do nothing;

alter table public.keepalive enable row level security;

create or replace function public.keepalive()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  update public.keepalive set pinged_at = now() where id = 1 returning pinged_at;
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon;
