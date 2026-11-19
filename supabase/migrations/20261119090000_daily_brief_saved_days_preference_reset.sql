-- Advisor plan Phase 3 (3A2). A saved brief must not outlive the source choices it was
-- built under. Every Daily Brief preference write raises the revision and already drops
-- daily_brief_runs; this also clears the saved text in daily_brief_days, so the next open
-- builds a new morning brief under the new choice. The refresh count stays, so changing a
-- setting never grants extra refreshes.
begin;

create function cadence_advisor_private.clear_saved_daily_brief_on_preference_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.revision is distinct from old.revision then
    update cadence_advisor_private.daily_brief_days as day
    set briefing = null, with_moves = false
    where day.user_id = new.user_id
      and day.briefing is not null;
  end if;
  return null;
end;
$$;

revoke all on function cadence_advisor_private.clear_saved_daily_brief_on_preference_change() from public, anon, authenticated, service_role;

create trigger daily_brief_preferences_clear_saved_brief
  after insert or update on cadence_advisor_private.daily_brief_preferences
  for each row
  execute function cadence_advisor_private.clear_saved_daily_brief_on_preference_change();

commit;
