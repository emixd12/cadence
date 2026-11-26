-- Ticket 368 (D35): Periods.
--
-- A Period is a labeled range of local calendar dates the person declares for the
-- whole account, for example "Sick", November 3 to 9. It is annotation only: it has
-- no Behavior and no Occurrence, and it never changes a status, adherence, a reminder
-- or a schedule. Periods may overlap and may lie in the future. A null end_on means
-- the Period is ongoing. Removing a Period deletes its row. Ownership is bound to
-- auth.uid(); clients cannot write the table directly.
begin;

create table public.periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  start_on date not null,
  end_on date,
  note text,
  revision integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint periods_user_id_key unique (user_id, id),
  constraint periods_label_valid check (
    label = btrim(label) and char_length(label) between 1 and 60 and label !~ '[\r\n]'
  ),
  constraint periods_range_valid check (end_on is null or end_on >= start_on),
  constraint periods_note_valid check (
    note is null or (btrim(note) <> '' and char_length(note) <= 2000)
  ),
  constraint periods_revision_valid check (revision between 1 and 2147483647)
);

create index periods_user_start_idx on public.periods (user_id, start_on);

alter table public.periods enable row level security;
create policy periods_select_own
  on public.periods for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.periods from public, anon, authenticated, service_role;
grant select on table public.periods to authenticated;

-- The cap of 500 Periods per account, held for every writer: the user functions
-- below and any later function that inserts directly (integration writes, import,
-- the account sync apply path). The per-user advisory lock serializes concurrent
-- inserts for one account, so two transactions cannot both pass the count at 499.
create function cadence_private.periods_enforce_account_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text || ':periods', 0)
  );
  select count(*) into owned
  from public.periods period
  where period.user_id = new.user_id;
  if owned >= 500 then
    raise exception 'An account can hold at most 500 periods.' using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke all on function cadence_private.periods_enforce_account_cap()
  from public, anon, authenticated, service_role;

create trigger periods_enforce_account_cap
  before insert on public.periods
  for each row execute function cadence_private.periods_enforce_account_cap();

-- Input rules shared by create_period and update_period. Returns null when the
-- input is valid, or the message to raise. The label rule is stricter than the
-- table check: it also refuses Unicode whitespace at either end and Unicode line
-- breaks, like the resolver (packages/core/src/resolvers/period.resolver.ts).
create function cadence_private.period_input_error(
  p_label text,
  p_start_on date,
  p_end_on date,
  p_note text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_label is null
      or char_length(p_label) not between 1 and 60
      or p_label ~ '^[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'
      or p_label ~ '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$'
      or p_label ~ '[\n\r\v\f\u0085\u2028\u2029]'
      then 'The period label is invalid.'
    when p_start_on is null then 'Choose a valid first day for this period.'
    when p_end_on is not null and p_end_on < p_start_on
      then 'The last day must be on or after the first day.'
    when p_note is not null and (btrim(p_note) = '' or char_length(p_note) > 2000)
      then 'The period note is invalid.'
    else null
  end;
$$;

revoke all on function cadence_private.period_input_error(text, date, date, text)
  from public, anon, authenticated, service_role;

create function public.create_period(
  p_label text,
  p_start_on date,
  p_end_on date,
  p_note text
)
returns setof public.periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  problem text;
  stored public.periods;
begin
  if owner_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  problem := cadence_private.period_input_error(p_label, p_start_on, p_end_on, p_note);
  if problem is not null then
    raise exception '%', problem using errcode = '22023';
  end if;

  insert into public.periods (user_id, label, start_on, end_on, note)
  values (owner_id, p_label, p_start_on, p_end_on, p_note)
  returning * into stored;
  return next stored;
end;
$$;

-- Compare-and-set on revision. Returns no row when the Period is gone, belongs to
-- another account, or its revision differs from p_expected_revision. An unchanged
-- write returns the row without raising the revision.
create function public.update_period(
  p_id uuid,
  p_expected_revision integer,
  p_label text,
  p_start_on date,
  p_end_on date,
  p_note text
)
returns setof public.periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  problem text;
  stored public.periods;
begin
  if owner_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_id is null or p_expected_revision is null then
    raise exception 'Refresh this period before saving it.' using errcode = '22023';
  end if;
  problem := cadence_private.period_input_error(p_label, p_start_on, p_end_on, p_note);
  if problem is not null then
    raise exception '%', problem using errcode = '22023';
  end if;

  select * into stored
  from public.periods period
  where period.user_id = owner_id and period.id = p_id
  for update;

  if not found or stored.revision <> p_expected_revision then
    return;
  end if;
  if stored.label = p_label
    and stored.start_on = p_start_on
    and stored.end_on is not distinct from p_end_on
    and stored.note is not distinct from p_note then
    return next stored;
    return;
  end if;

  update public.periods period set
    label = p_label,
    start_on = p_start_on,
    end_on = p_end_on,
    note = p_note,
    revision = period.revision + 1,
    updated_at = statement_timestamp()
  where period.user_id = owner_id and period.id = stored.id
  returning * into stored;
  return next stored;
end;
$$;

-- Hard delete with the same compare-and-set. Returns the deleted id, or no row.
create function public.delete_period(
  p_id uuid,
  p_expected_revision integer
)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  deleted_id uuid;
begin
  if owner_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_id is null or p_expected_revision is null then
    raise exception 'Refresh this period before removing it.' using errcode = '22023';
  end if;

  delete from public.periods period
  where period.user_id = owner_id
    and period.id = p_id
    and period.revision = p_expected_revision
  returning period.id into deleted_id;

  if deleted_id is null then
    return;
  end if;
  return next deleted_id;
end;
$$;

revoke all on function public.create_period(text, date, date, text)
  from public, anon, service_role;
grant execute on function public.create_period(text, date, date, text) to authenticated;

revoke all on function public.update_period(uuid, integer, text, date, date, text)
  from public, anon, service_role;
grant execute on function public.update_period(uuid, integer, text, date, date, text) to authenticated;

revoke all on function public.delete_period(uuid, integer)
  from public, anon, service_role;
grant execute on function public.delete_period(uuid, integer) to authenticated;

commit;
