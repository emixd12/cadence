-- Ticket 354 (decision 2026-11-24): persisted derived daily calendar busy-load
-- rollup per connected calendar source. Hosted-only, owner RLS, cascades on
-- account deletion, excluded from account_sync and BehaviorLog exports. Stores
-- zero event titles, descriptions, locations, or attendees. Hard-deleted on
-- disconnect or calendar selection change.
begin;

create table public.daily_calendar_load (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source text not null check (source in ('google_calendar', 'outlook_calendar', 'icloud_calendar')),
  local_date date not null,
  busy_minutes integer not null check (busy_minutes between 0 and 1440),
  event_count integer not null check (event_count >= 0),
  earliest_start_minute integer check (earliest_start_minute is null or earliest_start_minute between 0 and 1439),
  latest_end_minute integer check (latest_end_minute is null or latest_end_minute between 1 and 1440),
  has_all_day_busy boolean not null default false,
  connection_generation integer not null check (connection_generation >= 1),
  synced_at timestamptz not null default statement_timestamp(),
  primary key (user_id, source, local_date),
  constraint daily_calendar_load_bounds check (
    (event_count = 0 and earliest_start_minute is null and latest_end_minute is null)
    or (event_count > 0 and earliest_start_minute is not null and latest_end_minute is not null
      and latest_end_minute > earliest_start_minute)
  )
);

create index daily_calendar_load_user_date_idx
  on public.daily_calendar_load (user_id, local_date);

alter table public.daily_calendar_load enable row level security;

revoke all on table public.daily_calendar_load from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.daily_calendar_load to authenticated;

create policy daily_calendar_load_select_own on public.daily_calendar_load
  for select to authenticated using ((select auth.uid()) = user_id);
create policy daily_calendar_load_insert_own on public.daily_calendar_load
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy daily_calendar_load_update_own on public.daily_calendar_load
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy daily_calendar_load_delete_own on public.daily_calendar_load
  for delete to authenticated using ((select auth.uid()) = user_id);

commit;
