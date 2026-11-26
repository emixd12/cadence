-- Ticket 373 (D35): add a Period unless the account already has the same one.
--
-- BehaviorLog import and restore save Periods after their main transaction commits.
-- They match a Period in a file by its natural key: label, first day and last day,
-- where ongoing matches only ongoing. Two apply requests for the same bundle can
-- overlap: both read the account before either saves, and create_period would then
-- store the same Period twice. This function looks for the Period and inserts it
-- under one per-user lock, so the second request finds the first one's row.
--
-- It takes the same advisory transaction lock key as the cap trigger
-- cadence_private.periods_enforce_account_cap (20261126130000_periods.sql). The lock
-- is re-entrant inside a transaction, so the trigger still passes on insert, and
-- the cap of 500 still holds.
--
-- "Same" agrees with periodNaturalKey in packages/core/src/resolvers/period.resolver.ts:
-- the label is compared exactly (case and accents matter), the first day must be
-- equal, and the last day must be equal or null on both sides. The note is not part
-- of the key. A match is returned unchanged, with created = false; when several
-- stored Periods match, the oldest is returned. Additive: nothing existing changes.
begin;

create function public.create_period_if_absent(
  p_label text,
  p_start_on date,
  p_end_on date,
  p_note text
)
returns table (
  id uuid,
  user_id uuid,
  label text,
  start_on date,
  end_on date,
  note text,
  revision integer,
  created_at timestamptz,
  updated_at timestamptz,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  owner_id uuid := (select auth.uid());
  problem text;
  stored public.periods;
  inserted boolean := false;
begin
  if owner_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  problem := cadence_private.period_input_error(p_label, p_start_on, p_end_on, p_note);
  if problem is not null then
    raise exception '%', problem using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(owner_id::text || ':periods', 0)
  );

  -- "C" collation: byte equality, whatever the database default collation is.
  select period.* into stored
  from public.periods period
  where period.user_id = owner_id
    and period.label collate "C" = p_label collate "C"
    and period.start_on = p_start_on
    and period.end_on is not distinct from p_end_on
  order by period.created_at, period.id
  limit 1;

  if not found then
    insert into public.periods (user_id, label, start_on, end_on, note)
    values (owner_id, p_label, p_start_on, p_end_on, p_note)
    returning * into stored;
    inserted := true;
  end if;

  return query select
    stored.id, stored.user_id, stored.label, stored.start_on, stored.end_on,
    stored.note, stored.revision, stored.created_at, stored.updated_at, inserted;
end;
$$;

revoke all on function public.create_period_if_absent(text, date, date, text)
  from public, anon, service_role;
grant execute on function public.create_period_if_absent(text, date, date, text) to authenticated;

commit;
