-- Local-only: psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -X -v ON_ERROR_STOP=1 -f tests/sql/ticket-275-leave-reminders-smoke.sql
-- Ticket 275: leave reminder setting and reminder records.
-- Covers off by default, turning on and off (which deletes the account's
-- reminders), one reminder per trip, the three-route cap with the third only
-- after sending (D15), at most one update, final sent and failed
-- rows, the no-text error code, owner isolation, the service role's column
-- limit, account sync exclusion and account deletion. Everything rolls back.
\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('27500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'leave-smoke@example.invalid', '{}', '{}'),
  ('27500000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'leave-other@example.invalid', '{}', '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"27500000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  saved public.travel_leave_reminder_settings%rowtype;
  reminder public.travel_leave_reminders%rowtype;
  trip constant text := repeat('a', 64);
begin
  -- Off by default: no row, and no pending reminder can exist.
  if exists (select 1 from public.travel_leave_reminder_settings) then
    raise exception 'Leave reminders were on by default.';
  end if;
  begin
    insert into public.travel_leave_reminders (user_id, trip_digest, local_date, next_check_at)
    values ('27500000-0000-4000-8000-000000000001', trip, '2026-11-06', '2026-11-06T14:00:00Z');
    raise exception 'A reminder was stored while reminders were off.';
  exception when check_violation then
    if sqlerrm <> 'Leave reminders are off.' then raise; end if;
  end;

  insert into public.travel_leave_reminder_settings (user_id, enabled)
  values ('27500000-0000-4000-8000-000000000001', false)
  returning * into saved;
  if saved.enabled or saved.enabled_at is not null or saved.next_check_at is not null then
    raise exception 'An off setting kept a time.';
  end if;

  -- Turning on records the time and asks for a visit now.
  update public.travel_leave_reminder_settings set enabled = true returning * into saved;
  if saved.enabled_at is null or saved.next_check_at is null then
    raise exception 'Turning reminders on did not record the time and the next check.';
  end if;
  update public.travel_leave_reminder_settings
  set enabled_at = '2020-01-01T00:00:00Z', next_check_at = '2026-11-06T13:30:00Z'
  returning * into saved;
  if saved.enabled_at = '2020-01-01T00:00:00Z' or saved.next_check_at <> '2026-11-06T13:30:00Z' then
    raise exception 'The enabled time changed, or the next check did not.';
  end if;

  insert into public.travel_leave_reminders (user_id, trip_digest, local_date, next_check_at, route_count)
  values ('27500000-0000-4000-8000-000000000001', trip, '2026-11-06', '2026-11-06T14:00:00Z', 1)
  returning * into reminder;
  if reminder.status <> 'pending' then raise exception 'A new reminder was not pending.'; end if;

  -- One reminder per trip and local date.
  begin
    insert into public.travel_leave_reminders (user_id, trip_digest, local_date, next_check_at)
    values ('27500000-0000-4000-8000-000000000001', trip, '2026-11-06', '2026-11-06T15:00:00Z');
    raise exception 'A second reminder for one trip was accepted.';
  exception when unique_violation then null;
  end;

  -- Only a digest, a short error code and at most two routes.
  begin
    insert into public.travel_leave_reminders (user_id, trip_digest, local_date, next_check_at)
    values ('27500000-0000-4000-8000-000000000001', 'Dentist', '2026-11-06', '2026-11-06T15:00:00Z');
    raise exception 'A title was accepted as a trip digest.';
  exception when check_violation then null;
  end;
  begin
    update public.travel_leave_reminders set route_count = 3 where id = reminder.id;
    raise exception 'A third route was accepted before sending.';
  exception when check_violation then null;
  end;
  begin
    update public.travel_leave_reminders set route_count = 0 where id = reminder.id;
    raise exception 'The route count went down.';
  exception when check_violation then
    if sqlerrm <> 'A leave reminder route count cannot go down.' then raise; end if;
  end;
  begin
    update public.travel_leave_reminders
    set status = 'failed', next_check_at = null, error = 'Dentist at 1 Main St' where id = reminder.id;
    raise exception 'Free text was accepted as an error.';
  exception when check_violation then null;
  end;
  begin
    update public.travel_leave_reminders set trip_digest = repeat('b', 64) where id = reminder.id;
    raise exception 'A reminder changed its trip.';
  exception when check_violation then
    if sqlerrm <> 'A leave reminder keeps its trip.' then raise; end if;
  end;

  -- Claim, second route, send, keeping one check for the post-send route (D15).
  update public.travel_leave_reminders set processing_started_at = statement_timestamp() where id = reminder.id;
  update public.travel_leave_reminders
  set status = 'sent', route_count = 2, next_check_at = '2026-11-06T14:10:00Z', processing_started_at = null,
    sent_at = '2026-11-06T14:00:05Z'
  where id = reminder.id;
  begin
    update public.travel_leave_reminders
    set update_sent_at = '2026-11-06T14:10:05Z' where id = reminder.id;
    raise exception 'An update was recorded while its check was still open.';
  exception when check_violation then null;
  end;
  -- Claim the post-send check, route a third time and send the one update.
  update public.travel_leave_reminders set processing_started_at = statement_timestamp() where id = reminder.id;
  update public.travel_leave_reminders
  set route_count = 3, next_check_at = null, processing_started_at = null, update_sent_at = '2026-11-06T14:10:05Z'
  where id = reminder.id;
  begin
    update public.travel_leave_reminders set route_count = 4 where id = reminder.id;
    raise exception 'A fourth route was accepted.';
  exception when check_violation then null;
  end;
  begin
    update public.travel_leave_reminders set update_sent_at = '2026-11-06T14:20:00Z' where id = reminder.id;
    raise exception 'A second update was accepted.';
  exception when check_violation then
    if sqlerrm <> 'A leave reminder sends at most one update.' then raise; end if;
  end;
  begin
    update public.travel_leave_reminders set next_check_at = '2026-11-06T14:20:00Z' where id = reminder.id;
    raise exception 'A sent reminder reopened its check.';
  exception when check_violation then
    if sqlerrm <> 'A sent leave reminder gets one check after sending.' then raise; end if;
  end;
  -- A sent reminder is final.
  begin
    update public.travel_leave_reminders
    set status = 'pending', next_check_at = '2026-11-06T14:30:00Z', sent_at = null where id = reminder.id;
    raise exception 'A sent reminder returned to pending.';
  exception when check_violation then null;
  end;
  begin
    update public.travel_leave_reminders set sent_at = '2026-11-06T14:10:00Z' where id = reminder.id;
    raise exception 'A sent reminder changed its send time.';
  exception when check_violation then
    if sqlerrm <> 'A sent or failed leave reminder is final.' then raise; end if;
  end;

  -- A failed reminder keeps a code and is final.
  insert into public.travel_leave_reminders (user_id, trip_digest, local_date, next_check_at)
  values ('27500000-0000-4000-8000-000000000001', repeat('c', 64), '2026-11-06', '2026-11-06T16:00:00Z')
  returning * into reminder;
  begin
    update public.travel_leave_reminders
    set status = 'failed', next_check_at = null, error = 'budget_refused', update_sent_at = statement_timestamp()
    where id = reminder.id;
    raise exception 'A failed reminder recorded an update.';
  exception when check_violation then null;
  end;
  update public.travel_leave_reminders
  set status = 'failed', next_check_at = null, error = 'budget_refused' where id = reminder.id;
  begin
    update public.travel_leave_reminders
    set status = 'pending', next_check_at = '2026-11-06T16:30:00Z', error = null where id = reminder.id;
    raise exception 'A failed reminder returned to pending.';
  exception when check_violation then null;
  end;

  -- A cancelled reminder can come back while reminders are on.
  insert into public.travel_leave_reminders (user_id, trip_digest, local_date, next_check_at)
  values ('27500000-0000-4000-8000-000000000001', repeat('d', 64), '2026-11-06', '2026-11-06T17:00:00Z')
  returning * into reminder;
  update public.travel_leave_reminders set status = 'cancelled', next_check_at = null where id = reminder.id;
  update public.travel_leave_reminders set status = 'pending', next_check_at = '2026-11-06T17:00:00Z' where id = reminder.id;

  -- Turning off deletes every reminder of the account and clears the times.
  update public.travel_leave_reminder_settings set enabled = false returning * into saved;
  if saved.enabled_at is not null or saved.next_check_at is not null then
    raise exception 'Turning reminders off kept a check time.';
  end if;
  if exists (select 1 from public.travel_leave_reminders) then
    raise exception 'Turning reminders off kept reminder records.';
  end if;
  begin
    insert into public.travel_leave_reminders (user_id, trip_digest, local_date, next_check_at)
    values ('27500000-0000-4000-8000-000000000001', trip, '2026-11-06', '2026-11-06T14:00:00Z');
    raise exception 'A reminder was stored after reminders were turned off.';
  exception when check_violation then
    if sqlerrm <> 'Leave reminders are off.' then raise; end if;
  end;

  -- Account sync never carries these rows.
  if exists (select 1 from jsonb_array_elements(public.read_account_sync_snapshot(2) -> 'entities') entity
      where entity ->> 'kind' like '%leave_reminder%') then
    raise exception 'The account snapshot included leave reminder rows.';
  end if;
  if public.read_account_sync_snapshot()::text like '%leave_reminder%' then
    raise exception 'The contract 1 snapshot included leave reminder rows.';
  end if;

  update public.travel_leave_reminder_settings set enabled = true;
end;
$$;

-- Owner isolation: the other account sees nothing and cannot write the first account's rows.
select set_config('request.jwt.claims', '{"sub":"27500000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare
  changed integer;
begin
  if exists (select 1 from public.travel_leave_reminder_settings)
    or exists (select 1 from public.travel_leave_reminders) then
    raise exception 'Another account read leave reminder rows.';
  end if;
  update public.travel_leave_reminder_settings set enabled = false
  where user_id = '27500000-0000-4000-8000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Another account changed a reminder setting.'; end if;
  update public.travel_leave_reminders set status = 'cancelled', next_check_at = null
  where user_id = '27500000-0000-4000-8000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Another account changed a reminder.'; end if;
  delete from public.travel_leave_reminders where user_id = '27500000-0000-4000-8000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Another account deleted a reminder.'; end if;
  begin
    insert into public.travel_leave_reminder_settings (user_id, enabled)
    values ('27500000-0000-4000-8000-000000000001', true);
    raise exception 'Another account wrote a foreign reminder setting.';
  exception when insufficient_privilege or unique_violation then null;
  end;
  begin
    insert into public.travel_leave_reminders (user_id, trip_digest, local_date, next_check_at)
    values ('27500000-0000-4000-8000-000000000001', repeat('e', 64), '2026-11-06', '2026-11-06T18:00:00Z');
    raise exception 'Another account wrote a foreign reminder.';
  exception
    -- The guard cannot see the foreign setting, so it refuses before RLS does.
    when insufficient_privilege then null;
    when check_violation then
      if sqlerrm <> 'Leave reminders are off.' then raise; end if;
  end;
  -- Its own setting works and needs no other account.
  insert into public.travel_leave_reminder_settings (user_id, enabled)
  values ('27500000-0000-4000-8000-000000000002', true);
  insert into public.travel_leave_reminders (user_id, trip_digest, local_date, next_check_at)
  values ('27500000-0000-4000-8000-000000000002', repeat('a', 64), '2026-11-06', '2026-11-06T18:00:00Z');
end;
$$;

reset role;

-- Anonymous callers see nothing.
set local role anon;
do $$
begin
  begin
    perform 1 from public.travel_leave_reminders;
    raise exception 'An anonymous caller read leave reminders.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.travel_leave_reminder_settings;
    raise exception 'An anonymous caller read leave reminder settings.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- The cross-account selection (service role) sees account IDs and next check
-- times of enabled accounts, and nothing else.
set local role service_role;
do $$
begin
  if (select count(*) from public.travel_leave_reminder_settings where enabled and next_check_at is not null) <> 2 then
    raise exception 'The service role did not see both enabled accounts.';
  end if;
  begin
    perform enabled_at from public.travel_leave_reminder_settings;
    raise exception 'The service role read a column beyond the selection.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.travel_leave_reminders;
    raise exception 'The service role read reminder records.';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.travel_leave_reminder_settings set next_check_at = null;
    raise exception 'The service role changed a reminder setting.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Account deletion removes both tables' rows.
delete from auth.users where id = '27500000-0000-4000-8000-000000000001';
do $$
begin
  if exists (select 1 from public.travel_leave_reminder_settings where user_id = '27500000-0000-4000-8000-000000000001')
    or exists (select 1 from public.travel_leave_reminders where user_id = '27500000-0000-4000-8000-000000000001') then
    raise exception 'Account deletion left leave reminder rows.';
  end if;
end;
$$;

select 'ticket-275 leave reminders smoke passed' as result;

rollback;
