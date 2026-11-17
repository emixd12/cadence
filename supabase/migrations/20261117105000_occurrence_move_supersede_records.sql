-- Advisor plan, Phase 2A follow-up: a timezone change writes a supersede record.
--
-- The first version cleared effective time on every moved Occurrence of the Behavior
-- and left devices to infer the same thing from "the record's timezone differs from
-- the Behavior's". Two problems, found in review:
--   1. It also cleared resolved and past Occurrences, so a completed moved item lost
--      the time it actually happened (history must be kept).
--   2. A round trip (New York -> London -> New York) made devices revive a move the
--      server had already cleared, because the timezones matched again.
-- Now the change appends one 'supersede' record to each unresolved moved Occurrence's
-- chain and clears only those rows. Devices read the chain's latest record, as they
-- already do for an Undo, so server and devices agree without comparing timezones.
-- No moves exist in production when this runs, so no backfill is needed.

begin;

alter table public.occurrence_moves
  drop constraint occurrence_moves_kind_check,
  add constraint occurrence_moves_kind_check check (kind in ('move', 'revert', 'supersede')),
  drop constraint occurrence_moves_source_check,
  add constraint occurrence_moves_source_check
    check (source in ('daily_brief', 'coach', 'chat', 'mcp', 'person', 'system')),
  drop constraint occurrence_moves_kind_shape_check,
  add constraint occurrence_moves_kind_shape_check check (
    (kind = 'move' and not to_planned and to_end_at >= to_start_at)
    or (kind = 'revert' and revises_move_id is not null and chain_position > 1)
    or (kind = 'supersede' and to_planned and source = 'system'
      and revises_move_id is not null and chain_position > 1)
  );

create or replace function cadence_private.supersede_moves_on_timezone_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.timezone is distinct from old.timezone then
    perform set_config('cadence.occurrence_move_write', 'on', true);

    -- Only unresolved Occurrences that a move currently places away from the plan.
    -- Resolved and past rows keep their effective time as history.
    insert into public.occurrence_moves (
      user_id, occurrence_id, behavior_id, local_date, weekday, timezone, kind,
      from_start_at, from_end_at, from_planned, to_start_at, to_end_at, to_planned,
      duration_source, revises_move_id, chain_root_id, chain_position, reason, source
    )
    select
      occurrence.user_id, occurrence.id, occurrence.behavior_id, occurrence.local_date,
      latest.weekday, new.timezone, 'supersede',
      occurrence.effective_start_at, occurrence.effective_end_at, false,
      occurrence.scheduled_for, occurrence.scheduled_for, true,
      'restored', latest.id, latest.chain_root_id, latest.chain_position + 1,
      'timezone_change', 'system'
    from public.occurrences as occurrence
    cross join lateral (
      select move.id, move.chain_root_id, move.chain_position, move.weekday
      from public.occurrence_moves as move
      where move.user_id = occurrence.user_id and move.occurrence_id = occurrence.id
      order by move.chain_position desc
      limit 1
    ) as latest
    where occurrence.user_id = new.user_id
      and occurrence.behavior_id = new.id
      and occurrence.status = 'unresolved'
      and occurrence.effective_start_at is not null;

    update public.occurrences as occurrence
    set effective_start_at = null, effective_end_at = null
    where occurrence.user_id = new.user_id
      and occurrence.behavior_id = new.id
      and occurrence.status = 'unresolved'
      and occurrence.effective_start_at is not null;

    perform set_config('cadence.occurrence_move_write', '', true);
  end if;
  return new;
end $$;

revoke all on function cadence_private.supersede_moves_on_timezone_change() from public, anon, authenticated, service_role;

commit;
