-- Decision D19 (owner, November 6, 2026), Tickets 275 and 277. A get-ready change
-- brings the account's next leave reminder job visit forward, so a moved web
-- reminder goes out within about 5 minutes of its new reminder time.
--
-- Before this, the job moved a pending check only at its next visit to the account,
-- which could be up to 30 minutes away. When preparation_minutes changes, this
-- trigger sets travel_leave_reminder_settings.next_check_at to now for an account
-- with reminders on, so the next 5-minute run visits it. The visit moves pending
-- checks without a route (planned_preparation_minutes), so no estimate is added:
-- the route cap per trip and the D16 update pause stay as they were.
--
-- Only a real get-ready change counts, as for preparation_changed_at. Accounts with
-- reminders off keep no visit time. A visit time already due stays. A visit that
-- is running holds a lease time in next_check_at; moving it to now makes that
-- visit's release miss, so the next run visits again with the new get-ready time.
-- Each reminder record keeps its own claim, so an overlapping visit cannot route
-- or send one reminder twice.
--
-- The function runs as the writer. Users and account sync write travel_settings
-- as the user, so owner RLS limits the update to that account's own settings row;
-- the service role has no write grant on travel_settings. It changes only
-- next_check_at.
begin;

create function cadence_private.bring_leave_reminder_visit_forward()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.preparation_minutes is not distinct from old.preparation_minutes then
    return null;
  end if;
  update public.travel_leave_reminder_settings settings
  set next_check_at = statement_timestamp()
  where settings.user_id = new.user_id
    and settings.enabled
    and settings.next_check_at > statement_timestamp();
  return null;
end;
$$;

revoke all on function cadence_private.bring_leave_reminder_visit_forward() from public, anon, authenticated;

create trigger bring_leave_reminder_visit_forward
after insert or update of preparation_minutes on public.travel_settings
for each row execute function cadence_private.bring_leave_reminder_visit_forward();

commit;
