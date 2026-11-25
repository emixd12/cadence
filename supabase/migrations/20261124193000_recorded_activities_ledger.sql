-- Ticket 352 (decision 2026-11-24): persisted minimized recorded-activity ledger.
-- Hosted-only, owner RLS, cascades on account deletion, excluded from account_sync
-- and BehaviorLog exports. Kept until the connector is disconnected or the account
-- is deleted. Stores only timing and opaque digests (no titles, exercises, sets,
-- weights, notes, or raw provider IDs).
begin;

create table public.recorded_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source text not null check (source in ('hevy')),
  activity_ref text not null check (activity_ref ~ '^[a-z][a-z0-9_]*/[a-f0-9]{64}$'),
  kind text not null check (kind in ('workout')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  local_start_date date not null,
  duration_seconds integer not null check (duration_seconds > 0),
  selector_digest text check (selector_digest is null or selector_digest ~ '^[a-f0-9]{64}$'),
  provider_updated_at timestamptz,
  state text not null default 'active' check (state in ('active', 'removed')),
  account_digest text not null check (account_digest ~ '^[a-f0-9]{64}$'),
  connection_generation integer not null check (connection_generation >= 1),
  synced_at timestamptz not null default statement_timestamp(),
  constraint recorded_activities_interval check (end_at > start_at),
  constraint recorded_activities_unique_ref unique (user_id, source, activity_ref)
);

create index recorded_activities_active_date_idx
  on public.recorded_activities (user_id, source, local_start_date)
  where state = 'active';

alter table public.recorded_activities enable row level security;

revoke all on table public.recorded_activities from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.recorded_activities to authenticated;

create policy recorded_activities_select_own on public.recorded_activities
  for select to authenticated using ((select auth.uid()) = user_id);
create policy recorded_activities_insert_own on public.recorded_activities
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy recorded_activities_update_own on public.recorded_activities
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy recorded_activities_delete_own on public.recorded_activities
  for delete to authenticated using ((select auth.uid()) = user_id);

commit;
