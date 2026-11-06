-- Ticket 277 follow-up (decision D15, coordinator option (a), November 6, 2026).
-- The hosted leave reminder job closes a sent reminder's update check, without a
-- route, when the get-ready time changed after the reminder was sent. Comparing
-- habits_updated_at with the send time is not enough: a Mac writes that value
-- from its own clock, and an offline Mac change reaches the hosted row only when
-- it syncs, possibly after the reminder was sent. Either could let a later
-- get-ready time shift the named leave time and send a false update.
--
-- preparation_changed_at is the database's own time of the last hosted change to
-- preparation_minutes. The trigger sets it on every insert and update, so a
-- client value is never kept. It holds no place, position, duration or leave
-- time, and stays out of the synced profile: the sync functions name their keys.
begin;

alter table public.travel_settings
  add column preparation_changed_at timestamptz;

comment on column public.travel_settings.preparation_changed_at is
  'Ticket 277: database time of the last hosted change to preparation_minutes. Set only by a trigger; not synced.';

create function cadence_private.stamp_travel_preparation_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.preparation_changed_at := case when new.preparation_minutes is null then null else statement_timestamp() end;
  elsif new.preparation_minutes is distinct from old.preparation_minutes then
    new.preparation_changed_at := statement_timestamp();
  else
    new.preparation_changed_at := old.preparation_changed_at;
  end if;
  return new;
end;
$$;

revoke all on function cadence_private.stamp_travel_preparation_change() from public, anon, authenticated;

create trigger stamp_travel_preparation_change
before insert or update on public.travel_settings
for each row execute function cadence_private.stamp_travel_preparation_change();

commit;
