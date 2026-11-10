\set ON_ERROR_STOP on

-- Ticket 292: day notes. Owner-only reads, no direct writes, compare-and-set saves,
-- clearing keeps the row, and no cross-account access. Synthetic local fixtures
-- only; all changes roll back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('25700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'day-notes-a@example.invalid', '{}', '{}'),
  ('25700000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'day-notes-b@example.invalid', '{}', '{}');

create function pg_temp.act_as(owner uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('25700000-0000-4000-8000-000000000001');

do $$
declare
  saved public.day_notes;
  again public.day_notes;
  rows integer;
begin
  -- First save expects no note.
  select * into saved from public.save_day_note('2026-11-10', null, 'Travel day');
  if saved.note is distinct from 'Travel day' or saved.revision <> 1 then
    raise exception 'First save failed: %', row_to_json(saved);
  end if;

  -- A stale expected note returns no row and changes nothing.
  select count(*) into rows from public.save_day_note('2026-11-10', 'Something else', 'Overwrite');
  if rows <> 0 then raise exception 'Stale save was accepted'; end if;
  select count(*) into rows from public.save_day_note('2026-11-10', null, 'Overwrite');
  if rows <> 0 then raise exception 'Save expecting no note overwrote an existing note'; end if;

  -- Edit bumps the revision.
  select * into again from public.save_day_note('2026-11-10', 'Travel day', 'Travel day, slept badly');
  if again.id <> saved.id or again.revision <> 2 or again.note <> 'Travel day, slept badly' then
    raise exception 'Edit failed: %', row_to_json(again);
  end if;

  -- An unchanged save returns the row without a new revision.
  select * into again from public.save_day_note('2026-11-10', 'Travel day, slept badly', 'Travel day, slept badly');
  if again.revision <> 2 then raise exception 'Unchanged save bumped the revision'; end if;

  -- Clearing keeps the row with a null note.
  select * into again from public.save_day_note('2026-11-10', 'Travel day, slept badly', null);
  if again.id <> saved.id or again.note is not null or again.revision <> 3 then
    raise exception 'Clear failed: %', row_to_json(again);
  end if;
  select count(*) into rows from public.day_notes where local_date = '2026-11-10';
  if rows <> 1 then raise exception 'Clearing removed the row'; end if;

  -- Clearing a day with no row writes nothing.
  select count(*) into rows from public.save_day_note('2026-11-11', null, null);
  if rows <> 0 then raise exception 'Clearing an empty day created a row'; end if;

  -- Invalid notes are rejected.
  begin
    perform public.save_day_note('2026-11-12', null, '   ');
    raise exception 'Blank note was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.save_day_note('2026-11-12', null, repeat('a', 2001));
    raise exception 'Over-limit note was accepted';
  exception when sqlstate '22023' then null;
  end;

  -- Future days are allowed.
  perform public.save_day_note('2027-01-01', null, 'Plan: rest day');

  -- Direct writes are revoked.
  begin
    insert into public.day_notes (user_id, local_date, note)
    values ('25700000-0000-4000-8000-000000000001', '2026-11-13', 'Direct');
    raise exception 'Direct insert was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.day_notes set note = 'Direct' where local_date = '2027-01-01';
    raise exception 'Direct update was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Account B sees none of A's notes and cannot change them.
select pg_temp.act_as('25700000-0000-4000-8000-000000000002');
do $$
declare rows integer;
begin
  select count(*) into rows from public.day_notes;
  if rows <> 0 then raise exception 'Account B can read account A day notes'; end if;
  select count(*) into rows from public.save_day_note('2027-01-01', 'Plan: rest day', 'Hijacked');
  if rows <> 0 then raise exception 'Account B matched account A''s note'; end if;
  perform public.save_day_note('2027-01-01', null, 'B''s own note');
  select count(*) into rows from public.day_notes;
  if rows <> 1 then raise exception 'Account B should see exactly its own note'; end if;
end $$;

-- Anonymous callers cannot read or save.
reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.day_notes;
    raise exception 'anon could read day_notes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_day_note('2026-11-10', null, 'anon');
    raise exception 'anon could save a day note';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$
begin
  if (select note from public.day_notes where user_id = '25700000-0000-4000-8000-000000000001' and local_date = '2027-01-01') <> 'Plan: rest day' then
    raise exception 'Account A note changed';
  end if;
end $$;

select 'ticket-292 day notes fixture passed' as result;
rollback;
