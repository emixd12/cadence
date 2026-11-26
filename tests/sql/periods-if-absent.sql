\set ON_ERROR_STOP on

-- Ticket 373: public.create_period_if_absent. It adds a Period unless the account
-- already has one with the same label, first day and last day, and says which
-- happened. Synthetic local fixtures only; all changes roll back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('37300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'periods-absent-a@example.invalid', '{}', '{}'),
  ('37300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'periods-absent-b@example.invalid', '{}', '{}');

create function pg_temp.act_as(owner uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
$$;

-- Account B already has the Period account A is about to add.
set local role authenticated;
select pg_temp.act_as('37300000-0000-4000-8000-000000000002');
select public.create_period('Sick', '2026-11-03', '2026-11-09', 'B''s own words');

select pg_temp.act_as('37300000-0000-4000-8000-000000000001');
do $$
declare
  first record;
  again record;
  other record;
  rows integer;
begin
  -- Create: another account's identical Period does not match.
  select * into first from public.create_period_if_absent('Sick', '2026-11-03', '2026-11-09', 'Flu');
  if not first.created or first.user_id <> '37300000-0000-4000-8000-000000000001'
    or first.label <> 'Sick' or first.start_on <> '2026-11-03' or first.end_on <> '2026-11-09'
    or first.note <> 'Flu' or first.revision <> 1 then
    raise exception 'Create failed: %', row_to_json(first);
  end if;

  -- Repeat: the stored row comes back unchanged, whatever note the caller sends.
  select * into again from public.create_period_if_absent('Sick', '2026-11-03', '2026-11-09', 'Another note');
  if again.created or again.id <> first.id or again.note <> 'Flu' or again.revision <> 1
    or again.updated_at <> first.updated_at then
    raise exception 'Repeat changed or duplicated the Period: %', row_to_json(again);
  end if;
  select * into again from public.create_period_if_absent('Sick', '2026-11-03', '2026-11-09', null);
  if again.created or again.id <> first.id or again.note <> 'Flu' then
    raise exception 'Repeat with a null note changed the Period: %', row_to_json(again);
  end if;
  select count(*) into rows from public.periods;
  if rows <> 1 then raise exception 'Expected 1 Period after the repeats, found %', rows; end if;

  -- Ongoing matches only ongoing.
  select * into other from public.create_period_if_absent('Sick', '2026-11-03', null, null);
  if not other.created or other.id = first.id or other.end_on is not null then
    raise exception 'An ongoing Period matched a finished one: %', row_to_json(other);
  end if;
  select * into again from public.create_period_if_absent('Sick', '2026-11-03', null, 'Later note');
  if again.created or again.id <> other.id or again.note is not null then
    raise exception 'A null end did not match a null end: %', row_to_json(again);
  end if;

  -- The label is compared exactly, like periodNaturalKey: case and accents differ.
  select * into again from public.create_period_if_absent('sick', '2026-11-03', '2026-11-09', null);
  if not again.created then raise exception 'A label in another case matched'; end if;
  select * into again from public.create_period_if_absent(E'Café', '2026-11-03', '2026-11-09', null);
  if not again.created then raise exception 'First accented label was not created'; end if;
  select * into again from public.create_period_if_absent(E'Café', '2026-11-03', '2026-11-09', null);
  if not again.created then raise exception 'A differently composed label matched'; end if;

  -- Another first day or last day is another Period.
  select * into again from public.create_period_if_absent('Sick', '2026-11-04', '2026-11-09', null);
  if not again.created then raise exception 'Another first day matched'; end if;
  select * into again from public.create_period_if_absent('Sick', '2026-11-03', '2026-11-10', null);
  if not again.created then raise exception 'Another last day matched'; end if;

  -- With two stored Periods of one key (create_period allows it), one of them comes
  -- back and no third is added. Both rows here share one statement timestamp, so
  -- which is "oldest" is decided by id and not asserted.
  perform public.create_period('Sick', '2026-11-03', '2026-11-09', 'Second copy');
  select count(*) into rows from public.periods;
  select * into again from public.create_period_if_absent('Sick', '2026-11-03', '2026-11-09', null);
  if again.created or again.note not in ('Flu', 'Second copy')
    or rows <> (select count(*) from public.periods) then
    raise exception 'A duplicated key did not return a stored Period: %', row_to_json(again);
  end if;

  -- Invalid input is refused with 22023, like create_period.
  begin
    perform public.create_period_if_absent(' Sick', '2026-11-03', null, null);
    raise exception 'Untrimmed label was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.create_period_if_absent('Sick', '2026-11-03', '2026-11-02', null);
    raise exception 'End before start was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.create_period_if_absent('Sick', '2026-11-03', null, '   ');
    raise exception 'Blank note was accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- Account B's Period is untouched.
select pg_temp.act_as('37300000-0000-4000-8000-000000000002');
do $$
declare
  rows integer;
  kept record;
begin
  select count(*) into rows from public.periods;
  if rows <> 1 then raise exception 'Account B sees % Periods, expected 1', rows; end if;
  select * into kept from public.create_period_if_absent('Sick', '2026-11-03', '2026-11-09', null);
  if kept.created or kept.note <> 'B''s own words' then
    raise exception 'Account B did not get its own Period back: %', row_to_json(kept);
  end if;
end $$;

-- Without a signed-in user, and for anon and the service role, there is no access.
reset role;
set local role anon;
do $$
begin
  begin
    perform public.create_period_if_absent('anon', '2026-11-03', null, null);
    raise exception 'anon could add a Period';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role service_role;
do $$
begin
  begin
    perform public.create_period_if_absent('service', '2026-11-03', null, null);
    raise exception 'service_role could add a Period';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
do $$
begin
  begin
    perform public.create_period_if_absent('Nobody', '2026-11-03', null, null);
    raise exception 'A caller with no user id could add a Period';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- The cap. Fill account A to 500, then: a new Period is refused, an existing one
-- still comes back.
select pg_temp.act_as('37300000-0000-4000-8000-000000000001');
do $$
declare
  rows integer;
  kept record;
begin
  select count(*) into rows from public.periods;
  for n in 1..(500 - rows) loop
    perform public.create_period_if_absent('Fill ' || n, '2026-01-01', null, null);
  end loop;
  select count(*) into rows from public.periods;
  if rows <> 500 then raise exception 'Expected 500 Periods at the cap, found %', rows; end if;

  begin
    perform public.create_period_if_absent('The 501st', '2026-12-02', null, null);
    raise exception 'The 501st Period was accepted';
  exception when sqlstate '54000' then null;
  end;
  select * into kept from public.create_period_if_absent('Fill 1', '2026-01-01', null, 'Ignored');
  if kept.created or kept.note is not null then
    raise exception 'An existing Period was not returned at the cap: %', row_to_json(kept);
  end if;
  select count(*) into rows from public.periods;
  if rows <> 500 then raise exception 'The cap moved: % Periods', rows; end if;
end $$;

select 'periods-if-absent fixture passed' as result;
rollback;
