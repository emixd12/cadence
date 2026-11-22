\set ON_ERROR_STOP on

-- Sub-behaviors: connector completion through a parent's link, and archived routines in
-- imports and restores. Synthetic local fixtures only; every change rolls back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('32100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'routine-a@example.invalid', '{}', '{}');
insert into public.profiles (id, email, timezone) values
  ('32100000-0000-4000-8000-000000000001', 'routine-a@example.invalid', 'America/New_York')
on conflict (id) do update set timezone = excluded.timezone;

-- Gym routine (parent) with Lift and Stretch; Solo stands alone.
insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone) values
  ('32110000-0000-4000-8000-000000000001', '32100000-0000-4000-8000-000000000001', 'Gym routine', '{"type":"daily"}', '18:00', 'America/New_York'),
  ('32110000-0000-4000-8000-000000000004', '32100000-0000-4000-8000-000000000001', 'Solo', '{"type":"daily"}', '18:00', 'America/New_York');
insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone, parent_behavior_id, sub_behavior_sort_order, inherit_parent_schedule) values
  ('32110000-0000-4000-8000-000000000002', '32100000-0000-4000-8000-000000000001', 'Lift', '{"type":"daily"}', '18:00', 'America/New_York', '32110000-0000-4000-8000-000000000001', 0, true),
  ('32110000-0000-4000-8000-000000000003', '32100000-0000-4000-8000-000000000001', 'Stretch', '{"type":"daily"}', '18:00', 'America/New_York', '32110000-0000-4000-8000-000000000001', 1, true);

create function pg_temp.fixture_today() returns date language sql as $$
  select (now() at time zone 'America/New_York')::date - 1;
$$;
create function pg_temp.at_local(hour integer) returns timestamptz language sql as $$
  select (pg_temp.fixture_today() + make_interval(hours => hour)) at time zone 'America/New_York';
$$;

insert into public.occurrences (id, user_id, behavior_id, scheduled_for, local_date, schedule_kind, schedule_start_time, status) values
  ('32120000-0000-4000-8000-000000000002', '32100000-0000-4000-8000-000000000001', '32110000-0000-4000-8000-000000000002', pg_temp.at_local(18), pg_temp.fixture_today(), 'exact', '18:00', 'unresolved'),
  ('32120000-0000-4000-8000-000000000003', '32100000-0000-4000-8000-000000000001', '32110000-0000-4000-8000-000000000003', pg_temp.at_local(18), pg_temp.fixture_today(), 'exact', '18:00', 'unresolved'),
  ('32120000-0000-4000-8000-000000000004', '32100000-0000-4000-8000-000000000001', '32110000-0000-4000-8000-000000000004', pg_temp.at_local(18), pg_temp.fixture_today(), 'exact', '18:00', 'unresolved');

insert into public.connector_connections (user_id, provider, account_digest, generation, status) values
  ('32100000-0000-4000-8000-000000000001', 'hevy', repeat('d', 64), 1, 'connected');

create function pg_temp.act_as(owner uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;
grant execute on function pg_temp.at_local(integer) to authenticated;
grant execute on function pg_temp.fixture_today() to authenticated;

set local role authenticated;
select pg_temp.act_as('32100000-0000-4000-8000-000000000001');

do $$
declare
  routine_link uuid;
  result jsonb;
  x text := 'hevy/' || repeat('1', 64);
  start_at timestamptz := pg_temp.at_local(17);
  end_at timestamptz := pg_temp.at_local(17) + interval '45 minutes';
begin
  insert into public.behavior_source_links (behavior_id, source, selector_kind)
  values ('32110000-0000-4000-8000-000000000001', 'hevy', 'any') returning id into routine_link;

  -- The parent's link completes each sub-behavior Occurrence once.
  result := public.apply_connector_completion(routine_link, '32120000-0000-4000-8000-000000000002', x,
    start_at, end_at, null, null, now());
  if result ->> 'reason' <> 'applied' then raise exception 'Lift not completed: %', result; end if;
  result := public.apply_connector_completion(routine_link, '32120000-0000-4000-8000-000000000003', x,
    start_at, end_at, null, null, now());
  if result ->> 'reason' <> 'applied' then raise exception 'Stretch not completed: %', result; end if;
  if (select count(*) from public.occurrence_source_matches
      where activity_ref = x and link_id = routine_link and role = 'completion') <> 2
    or exists (select 1 from public.occurrence_source_matches match
      join public.occurrences occurrence on occurrence.id = match.occurrence_id
      where match.activity_ref = x and match.behavior_id <> occurrence.behavior_id) then
    raise exception 'Routine matches must name each sub-behavior';
  end if;

  -- Rule 4: the same activity never completes a sub-behavior twice.
  result := public.attach_source_activity(routine_link, '32120000-0000-4000-8000-000000000002', x,
    start_at, end_at, null, now());
  if result ->> 'attached' <> 'false' or result ->> 'reason' <> 'revision_not_newer' then
    raise exception 'Repeat attachment accepted: %', result;
  end if;

  -- A Behavior outside the routine is not reached by the parent's link.
  result := public.apply_connector_completion(routine_link, '32120000-0000-4000-8000-000000000004', x,
    start_at, end_at, null, null, now());
  if result ->> 'reason' <> 'link_unavailable' then raise exception 'Unrelated Behavior reached: %', result; end if;

  -- Removing the workout reverts the connector's completion of a sub-behavior.
  result := public.remove_source_match((select id from public.occurrence_source_matches
    where activity_ref = x and occurrence_id = '32120000-0000-4000-8000-000000000003'), now());
  if result ->> 'reason' <> 'reverted' then raise exception 'Sub-behavior completion not reverted: %', result; end if;
  if (select status from public.occurrences where id = '32120000-0000-4000-8000-000000000003') <> 'unresolved' then
    raise exception 'Stretch should be Unresolved again';
  end if;
end $$;

reset role;

-- An archived routine can come back as one group (import or restore); an active
-- Behavior still cannot take a new link to an archived parent.
do $$
begin
  insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone, active, archived_at) values
    ('32110000-0000-4000-8000-000000000011', '32100000-0000-4000-8000-000000000001', 'Old routine', '{"type":"daily"}', '08:00', 'America/New_York', false, now());
  insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone, active, archived_at, parent_behavior_id) values
    ('32110000-0000-4000-8000-000000000012', '32100000-0000-4000-8000-000000000001', 'Old step', '{"type":"daily"}', '08:00', 'America/New_York', false, now(), '32110000-0000-4000-8000-000000000011');
  set constraints all immediate;
  set constraints all deferred;
  begin
    insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone, parent_behavior_id) values
      ('32110000-0000-4000-8000-000000000013', '32100000-0000-4000-8000-000000000001', 'Active step', '{"type":"daily"}', '08:00', 'America/New_York', '32110000-0000-4000-8000-000000000011');
    set constraints all immediate;
    raise exception 'Active link to an archived parent accepted';
  exception when check_violation then null;
  end;
end $$;

\echo sub-behavior portability and connector smoke passed
rollback;
