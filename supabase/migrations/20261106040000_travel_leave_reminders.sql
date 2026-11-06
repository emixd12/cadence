-- Ticket 275 (decision D3): leave reminder preference and reminder records.
-- Both tables are hosted-only. Account sync never reads them, so the synced
-- profile contract and released Mac builds stay unchanged.
--
-- Rows hold no title, place, position, route duration, leave time or provider
-- result. trip_digest is a hex SHA-256 over the destination's event reference
-- (Ticket 217's travelEventRef) and its start instant, so a moved event is a
-- new trip. error holds a short code, never text from Calendar or a provider.
-- Decision D15: the job routes a trip at most three times, the third only after
-- the reminder sent, and sends at most one update (update_sent_at, set once).
-- docs/NOTIFICATION_SPEC.md, "Leave reminders", has the rules.
begin;

create table public.travel_leave_reminder_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  enabled_at timestamptz,
  -- The job's next visit to this account. Null while reminders are off.
  next_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint travel_leave_reminder_settings_enabled_shape check (
    (enabled and enabled_at is not null)
    or (not enabled and enabled_at is null and next_check_at is null)
  )
);

create table public.travel_leave_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_digest text not null check (trip_digest ~ '^[a-f0-9]{64}$'),
  local_date date not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'cancelled')),
  next_check_at timestamptz,
  route_count smallint not null default 0 check (route_count between 0 and 3),
  processing_started_at timestamptz,
  sent_at timestamptz,
  update_sent_at timestamptz,
  error text check (error ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint travel_leave_reminders_one_per_trip unique (user_id, trip_digest, local_date),
  -- A sent reminder may keep a next check for its one post-send route, and may
  -- be claimed only while that check is open. Once the update sends, or the
  -- check closes, nothing is left to do.
  constraint travel_leave_reminders_status_shape check (
    (status = 'pending' and next_check_at is not null and sent_at is null and update_sent_at is null)
    or (status = 'sent' and sent_at is not null
      and (processing_started_at is null or next_check_at is not null)
      and (update_sent_at is null or (update_sent_at >= sent_at and next_check_at is null
        and processing_started_at is null)))
    or (status = 'failed' and next_check_at is null and sent_at is null and error is not null
      and processing_started_at is null and update_sent_at is null)
    or (status = 'cancelled' and next_check_at is null and sent_at is null and processing_started_at is null
      and update_sent_at is null)
  ),
  -- Two routes before sending (plan, then send); the third only after sending.
  constraint travel_leave_reminders_third_route_after_send check (route_count < 3 or status = 'sent')
);

-- The account selection reads only enabled accounts by next check time.
create index travel_leave_reminder_settings_due_idx
on public.travel_leave_reminder_settings (next_check_at)
where enabled;

create index travel_leave_reminders_due_idx
on public.travel_leave_reminders (user_id, next_check_at)
where status = 'pending';

alter table public.travel_leave_reminder_settings enable row level security;
alter table public.travel_leave_reminders enable row level security;

create policy "Users can read their own leave reminder setting"
on public.travel_leave_reminder_settings
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can add their own leave reminder setting"
on public.travel_leave_reminder_settings
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own leave reminder setting"
on public.travel_leave_reminder_settings
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can read their own leave reminders"
on public.travel_leave_reminders
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can add their own leave reminders"
on public.travel_leave_reminders
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own leave reminders"
on public.travel_leave_reminders
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own leave reminders"
on public.travel_leave_reminders
for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.travel_leave_reminder_settings from public, anon, authenticated;
revoke all on table public.travel_leave_reminders from public, anon, authenticated;
grant select, insert, update on table public.travel_leave_reminder_settings to authenticated;
grant select, insert, update, delete on table public.travel_leave_reminders to authenticated;
revoke all on table public.travel_leave_reminder_settings from service_role;
revoke all on table public.travel_leave_reminders from service_role;
-- Ticket 276: the job's one cross-account read selects due accounts. It sees
-- account IDs and next check times only. Everything else runs as the user.
grant select (user_id, enabled, next_check_at) on table public.travel_leave_reminder_settings to service_role;

create trigger set_travel_leave_reminder_settings_updated_at
before update on public.travel_leave_reminder_settings
for each row execute function public.set_updated_at();

create trigger set_travel_leave_reminders_updated_at
before update on public.travel_leave_reminders
for each row execute function public.set_updated_at();

-- Turning reminders on records the time and asks for a visit now. Turning them
-- off clears the visit and deletes the account's reminders, whichever client
-- saves it, so an account that stays off keeps no reminder records.
create or replace function cadence_private.travel_leave_reminder_setting_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.enabled and (tg_op = 'INSERT' or not old.enabled) then
    new.enabled_at := statement_timestamp();
    new.next_check_at := statement_timestamp();
  elsif not new.enabled then
    new.enabled_at := null;
    new.next_check_at := null;
    if tg_op = 'UPDATE' and old.enabled then
      delete from public.travel_leave_reminders where user_id = new.user_id;
    end if;
  elsif new.enabled_at is distinct from old.enabled_at then
    new.enabled_at := old.enabled_at;
  end if;
  return new;
end;
$$;

revoke all on function cadence_private.travel_leave_reminder_setting_change() from public, anon, authenticated;

create trigger travel_leave_reminder_setting_change
before insert or update on public.travel_leave_reminder_settings
for each row execute function cadence_private.travel_leave_reminder_setting_change();

-- A reminder becomes pending only while its account has reminders on. Sent
-- and failed reminders are final. The route count never goes down, so a trip
-- is routed at most three times. The one update is recorded once and never
-- changes. A cancelled reminder may return to pending when its
-- trip comes back. Identity never changes. The setting read takes a share lock,
-- so a concurrent switch to off either waits for this write and then deletes
-- the row, or commits first and this write sees reminders off.
create or replace function cadence_private.guard_travel_leave_reminder_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending')
    and not exists (
      select 1 from public.travel_leave_reminder_settings settings
      where settings.user_id = new.user_id and settings.enabled
      for share
    )
  then
    raise exception 'Leave reminders are off.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;
  if new.user_id <> old.user_id or new.trip_digest <> old.trip_digest or new.local_date <> old.local_date then
    raise exception 'A leave reminder keeps its trip.' using errcode = 'check_violation';
  end if;
  if new.route_count < old.route_count then
    raise exception 'A leave reminder route count cannot go down.' using errcode = 'check_violation';
  end if;
  if old.status in ('sent', 'failed') and (new.status <> old.status or new.sent_at is distinct from old.sent_at) then
    raise exception 'A sent or failed leave reminder is final.' using errcode = 'check_violation';
  end if;
  if old.update_sent_at is not null and new.update_sent_at is distinct from old.update_sent_at then
    raise exception 'A leave reminder sends at most one update.' using errcode = 'check_violation';
  end if;
  if old.status = 'sent' and old.next_check_at is null and new.next_check_at is not null then
    raise exception 'A sent leave reminder gets one check after sending.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function cadence_private.guard_travel_leave_reminder_write() from public, anon, authenticated;

create trigger guard_travel_leave_reminder_write
before insert or update on public.travel_leave_reminders
for each row execute function cadence_private.guard_travel_leave_reminder_write();

commit;
