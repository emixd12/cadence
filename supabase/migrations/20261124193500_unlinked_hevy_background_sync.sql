-- Ticket 353 (decision 2026-11-24): extend connector_completion_state to support
-- lightweight daily background sync for connected unlinked Hevy accounts,
-- prioritizing linked Behavior-completion accounts (sync_priority = 1) ahead of
-- unlinked daily syncs (sync_priority = 2) and pausing unlinked accounts after
-- 21 days of Cadence inactivity.
--
-- The service_role grant stays strictly limited to account-selection columns
-- (user_id, source, next_check_at, sync_priority, paused_for_inactivity).
begin;

alter table public.connector_completion_state
  add column if not exists sync_priority smallint not null default 1 check (sync_priority in (1, 2)),
  add column if not exists last_user_activity_at timestamptz,
  add column if not exists paused_for_inactivity boolean not null default false,
  add column if not exists last_synced_at timestamptz,
  add column if not exists backfilled_at timestamptz;

create index if not exists connector_completion_state_due_priority_idx
  on public.connector_completion_state (sync_priority, next_check_at)
  where next_check_at is not null and not paused_for_inactivity;

grant insert (sync_priority, last_user_activity_at, paused_for_inactivity, last_synced_at, backfilled_at)
  on table public.connector_completion_state to authenticated;
grant update (sync_priority, last_user_activity_at, paused_for_inactivity, last_synced_at, backfilled_at)
  on table public.connector_completion_state to authenticated;
grant select (sync_priority, paused_for_inactivity)
  on table public.connector_completion_state to service_role;

commit;
