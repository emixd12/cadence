\set ON_ERROR_STOP on

-- Ticket 368: Periods. Owner-only reads, no direct writes, compare-and-set edits
-- and deletes on revision, input validation, no cross-account access, and the cap
-- of 500 Periods per account for every writer. Synthetic local fixtures only; all
-- changes roll back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('36800000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'periods-a@example.invalid', '{}', '{}'),
  ('36800000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'periods-b@example.invalid', '{}', '{}');

create function pg_temp.act_as(owner uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
$$;

create temporary table period_fixture (name text primary key, id uuid not null, revision integer not null)
  on commit drop;
grant all on period_fixture to authenticated;

set local role authenticated;
select pg_temp.act_as('36800000-0000-4000-8000-000000000001');

do $$
declare
  created public.periods;
  again public.periods;
  other public.periods;
  rows integer;
  before_updated_at timestamptz;
begin
  -- Create: an ongoing Period, a finished one, a future one and an overlap.
  select * into created from public.create_period('Sick', '2026-11-03', null, null);
  if created.label <> 'Sick' or created.start_on <> '2026-11-03' or created.end_on is not null
    or created.note is not null or created.revision <> 1
    or created.user_id <> '36800000-0000-4000-8000-000000000001' then
    raise exception 'Create failed: %', row_to_json(created);
  end if;
  select * into other from public.create_period('Travel', '2026-11-05', '2026-11-05', 'Conference');
  if other.end_on <> '2026-11-05' or other.note <> 'Conference' then
    raise exception 'Single-day overlapping create failed: %', row_to_json(other);
  end if;
  perform public.create_period('Exams', '2027-05-01', '2027-05-20', null);
  -- The same label and dates may be stored twice: Periods have no uniqueness rule.
  perform public.create_period('Sick', '2026-11-03', null, null);

  -- A stale revision returns no row and changes nothing.
  select count(*) into rows from public.update_period(created.id, 2, 'Flu', '2026-11-03', null, null);
  if rows <> 0 then raise exception 'Stale edit was accepted'; end if;
  if (select label from public.periods where id = created.id) <> 'Sick' then
    raise exception 'Stale edit changed the row';
  end if;

  -- A missing Period returns no row.
  select count(*) into rows
  from public.update_period('36800000-0000-4000-8000-0000000000ff', 1, 'Flu', '2026-11-03', null, null);
  if rows <> 0 then raise exception 'Edit of a missing Period returned a row'; end if;

  -- An edit raises the revision and refreshes updated_at.
  select * into again from public.update_period(created.id, 1, 'Flu', '2026-11-02', '2026-11-09', 'Fever from Monday');
  if again.id <> created.id or again.revision <> 2 or again.label <> 'Flu'
    or again.start_on <> '2026-11-02' or again.end_on <> '2026-11-09' or again.note <> 'Fever from Monday'
    or again.created_at <> created.created_at then
    raise exception 'Edit failed: %', row_to_json(again);
  end if;

  -- An unchanged write returns the row without a new revision or timestamp.
  before_updated_at := again.updated_at;
  select * into again from public.update_period(created.id, 2, 'Flu', '2026-11-02', '2026-11-09', 'Fever from Monday');
  if again.revision <> 2 or again.updated_at <> before_updated_at then
    raise exception 'Unchanged write changed the row: %', row_to_json(again);
  end if;

  -- Making it ongoing again and clearing the note are ordinary edits.
  select * into again from public.update_period(created.id, 2, 'Flu', '2026-11-02', null, null);
  if again.revision <> 3 or again.end_on is not null or again.note is not null then
    raise exception 'Reopen failed: %', row_to_json(again);
  end if;

  -- Invalid input is refused with 22023.
  begin
    perform public.create_period('', '2026-11-03', null, null);
    raise exception 'Empty label was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.create_period(' Sick', '2026-11-03', null, null);
    raise exception 'Untrimmed label was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.create_period(E'Sick\u00a0', '2026-11-03', null, null);
    raise exception 'Label ending in a no-break space was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.create_period(E'Sick\nagain', '2026-11-03', null, null);
    raise exception 'Two-line label was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.create_period(repeat('a', 61), '2026-11-03', null, null);
    raise exception 'Over-limit label was accepted';
  exception when sqlstate '22023' then null;
  end;
  perform public.create_period(repeat('a', 60), '2026-11-03', null, null);
  begin
    perform public.create_period(null, '2026-11-03', null, null);
    raise exception 'Null label was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.create_period('Sick', null, null, null);
    raise exception 'Null start was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.create_period('Sick', '2026-11-03', '2026-11-02', null);
    raise exception 'End before start was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.create_period('Sick', '2026-11-03', null, '   ');
    raise exception 'Blank note was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.create_period('Sick', '2026-11-03', null, repeat('a', 2001));
    raise exception 'Over-limit note was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.update_period(created.id, 3, 'Flu', '2026-11-10', '2026-11-09', null);
    raise exception 'Edit to an end before the start was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.update_period(created.id, null, 'Flu', '2026-11-02', null, null);
    raise exception 'Edit without a revision was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.delete_period(created.id, null);
    raise exception 'Delete without a revision was accepted';
  exception when sqlstate '22023' then null;
  end;

  -- Direct writes are revoked.
  begin
    insert into public.periods (user_id, label, start_on)
    values ('36800000-0000-4000-8000-000000000001', 'Direct', '2026-11-13');
    raise exception 'Direct insert was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.periods set label = 'Direct' where id = created.id;
    raise exception 'Direct update was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.periods where id = created.id;
    raise exception 'Direct delete was allowed';
  exception when insufficient_privilege then null;
  end;

  -- Delete: a stale revision removes nothing; the current one returns the id.
  select count(*) into rows from public.delete_period(other.id, 7);
  if rows <> 0 then raise exception 'Stale delete was accepted'; end if;
  if not exists (select 1 from public.periods where id = other.id) then
    raise exception 'Stale delete removed the row';
  end if;
  if (select deleted from public.delete_period(other.id, 1) as deleted) is distinct from other.id then
    raise exception 'Delete did not return the deleted id';
  end if;
  if exists (select 1 from public.periods where id = other.id) then
    raise exception 'Delete kept the row';
  end if;
  select count(*) into rows from public.delete_period(other.id, 1);
  if rows <> 0 then raise exception 'Deleting a removed Period returned a row'; end if;

  insert into period_fixture values ('a_flu', created.id, 3);
end $$;

-- Account B sees none of A's Periods and cannot change or remove them by id.
select pg_temp.act_as('36800000-0000-4000-8000-000000000002');
do $$
declare
  target uuid := (select id from period_fixture where name = 'a_flu');
  rows integer;
begin
  select count(*) into rows from public.periods;
  if rows <> 0 then raise exception 'Account B can read account A Periods'; end if;
  select count(*) into rows from public.update_period(target, 3, 'Hijacked', '2026-11-02', null, null);
  if rows <> 0 then raise exception 'Account B edited account A''s Period'; end if;
  select count(*) into rows from public.delete_period(target, 3);
  if rows <> 0 then raise exception 'Account B deleted account A''s Period'; end if;
  perform public.create_period('B''s own', '2026-11-03', null, null);
  select count(*) into rows from public.periods;
  if rows <> 1 then raise exception 'Account B should see exactly its own Period'; end if;
end $$;

-- Anonymous callers cannot read or write.
reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.periods;
    raise exception 'anon could read periods';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_period('anon', '2026-11-03', null, null);
    raise exception 'anon could create a Period';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.update_period('36800000-0000-4000-8000-0000000000ff', 1, 'anon', '2026-11-03', null, null);
    raise exception 'anon could edit a Period';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.delete_period('36800000-0000-4000-8000-0000000000ff', 1);
    raise exception 'anon could delete a Period';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The service role has no grant on the table or the functions.
reset role;
set local role service_role;
do $$
begin
  begin
    perform 1 from public.periods;
    raise exception 'service_role could read periods';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_period('service', '2026-11-03', null, null);
    raise exception 'service_role could create a Period';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$
declare
  stored public.periods;
begin
  select * into stored from public.periods where id = (select id from period_fixture where name = 'a_flu');
  if stored.label <> 'Flu' or stored.revision <> 3 then
    raise exception 'Account A Period changed: %', row_to_json(stored);
  end if;
end $$;

-- The cap. Account A holds 4 Periods here; fill it to 499 through the user function.
set local role authenticated;
select pg_temp.act_as('36800000-0000-4000-8000-000000000001');
do $$
declare
  rows integer;
  kept uuid;
begin
  select count(*) into rows from public.periods;
  if rows <> 4 then raise exception 'Expected 4 Periods before the cap check, found %', rows; end if;
  for n in 1..495 loop
    perform public.create_period('Fill ' || n, '2026-01-01', null, null);
  end loop;

  -- Two creates at 499: the first makes 500, the second is refused.
  select id into kept from public.create_period('The 500th', '2026-12-01', null, null);
  begin
    perform public.create_period('The 501st', '2026-12-02', null, null);
    raise exception 'The 501st Period was accepted';
  exception when sqlstate '54000' then null;
  end;
  select count(*) into rows from public.periods;
  if rows <> 500 then raise exception 'Expected 500 Periods at the cap, found %', rows; end if;

  -- Edits still work at the cap, and a delete frees one place.
  perform public.update_period(kept, 1, 'Still editable', '2026-12-01', null, null);
  if (select revision from public.periods where id = kept) <> 2 then
    raise exception 'Edit at the cap failed';
  end if;
  perform public.delete_period(kept, 2);
  perform public.create_period('Fits again', '2026-12-03', null, null);
  begin
    perform public.create_period('Over again', '2026-12-04', null, null);
    raise exception 'A Period past the cap was accepted after a delete';
  exception when sqlstate '54000' then null;
  end;
end $$;

-- The cap is a trigger, so it also holds for a writer that inserts directly, as a
-- later security definer function will. Another account is not affected.
reset role;
do $$
begin
  begin
    insert into public.periods (user_id, label, start_on)
    values ('36800000-0000-4000-8000-000000000001', 'Direct at the cap', '2026-12-05');
    raise exception 'A direct insert passed the cap';
  exception when sqlstate '54000' then null;
  end;
  insert into public.periods (user_id, label, start_on)
  values ('36800000-0000-4000-8000-000000000002', 'B is under the cap', '2026-12-05');

  -- The table check still refuses what the functions refuse.
  begin
    insert into public.periods (user_id, label, start_on, end_on)
    values ('36800000-0000-4000-8000-000000000002', 'Backwards', '2026-12-05', '2026-12-04');
    raise exception 'A direct insert with an end before the start was accepted';
  exception when check_violation then null;
  end;

  -- Account deletion removes its Periods.
  delete from auth.users where id = '36800000-0000-4000-8000-000000000001';
  if exists (select 1 from public.periods where user_id = '36800000-0000-4000-8000-000000000001') then
    raise exception 'Periods survived account deletion';
  end if;
end $$;

select 'periods fixture passed' as result;
rollback;
