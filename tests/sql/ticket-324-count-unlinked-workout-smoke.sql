\set ON_ERROR_STOP on

-- Ticket 324: attach a workout counted by hand to an Occurrence the user marked
-- Completed. Synthetic local fixtures only; every change rolls back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('32400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'count-a@example.invalid', '{}', '{}');
insert into public.profiles (id, email, timezone) values
  ('32400000-0000-4000-8000-000000000001', 'count-a@example.invalid', 'America/New_York')
on conflict (id) do update set timezone = excluded.timezone;

-- Walk: no link. Gym: an any-workout link. Unmarked: no link, left Unresolved.
insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone) values
  ('32410000-0000-4000-8000-000000000001', '32400000-0000-4000-8000-000000000001', 'Walk', '{"type":"daily"}', '18:00', 'America/New_York'),
  ('32410000-0000-4000-8000-000000000002', '32400000-0000-4000-8000-000000000001', 'Gym', '{"type":"daily"}', '18:00', 'America/New_York'),
  ('32410000-0000-4000-8000-000000000003', '32400000-0000-4000-8000-000000000001', 'Unmarked', '{"type":"daily"}', '18:00', 'America/New_York');

-- Day 0 is yesterday in New York, so its afternoon workouts have ended.
create function pg_temp.fixture_today() returns date language sql as $$
  select (now() at time zone 'America/New_York')::date - 1;
$$;
create function pg_temp.at_local(days_back integer, hour integer) returns timestamptz language sql as $$
  select (pg_temp.fixture_today() - days_back + make_interval(hours => hour)) at time zone 'America/New_York';
$$;

insert into public.occurrences (id, user_id, behavior_id, scheduled_for, local_date, schedule_kind, schedule_start_time, status, status_marked_at, completed_at) values
  ('32420000-0000-4000-8000-000000000001', '32400000-0000-4000-8000-000000000001', '32410000-0000-4000-8000-000000000001', pg_temp.at_local(0, 18), pg_temp.fixture_today(), 'exact', '18:00', 'completed', now(), now()),
  ('32420000-0000-4000-8000-000000000002', '32400000-0000-4000-8000-000000000001', '32410000-0000-4000-8000-000000000002', pg_temp.at_local(0, 18), pg_temp.fixture_today(), 'exact', '18:00', 'completed', now(), now()),
  ('32420000-0000-4000-8000-000000000003', '32400000-0000-4000-8000-000000000001', '32410000-0000-4000-8000-000000000003', pg_temp.at_local(0, 18), pg_temp.fixture_today(), 'exact', '18:00', 'unresolved', null, null);

-- The user's own Completed marks.
insert into public.occurrence_status_events (user_id, occurrence_id, behavior_id, previous_status, status, status_semantics,
  recorded_at, effective_at, local_date, timezone, source_capture_method, source_confidence) values
  ('32400000-0000-4000-8000-000000000001', '32420000-0000-4000-8000-000000000001', '32410000-0000-4000-8000-000000000001', 'unresolved', 'completed', 'explicit_user_mark',
   now(), now(), pg_temp.fixture_today(), 'America/New_York', 'manual_tap', 'high'),
  ('32400000-0000-4000-8000-000000000001', '32420000-0000-4000-8000-000000000002', '32410000-0000-4000-8000-000000000002', 'unresolved', 'completed', 'explicit_user_mark',
   now(), now(), pg_temp.fixture_today(), 'America/New_York', 'manual_tap', 'high');

insert into public.connector_connections (user_id, provider, account_digest, generation, status) values
  ('32400000-0000-4000-8000-000000000001', 'hevy', repeat('d', 64), 1, 'connected');

create function pg_temp.act_as(owner uuid, channel text default null) returns void language sql as $$
  select set_config('request.jwt.claims', (case when channel is null
    then json_build_object('sub', owner, 'role', 'authenticated')
    else json_build_object('sub', owner, 'role', 'authenticated', 'cadence_channel', channel) end)::text, true);
$$;
grant execute on function pg_temp.act_as(uuid, text) to authenticated;
grant execute on function pg_temp.at_local(integer, integer) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.attach_unlinked_source_activity(uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.attach_unlinked_source_activity(uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.attach_unlinked_source_activity(uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'Unexpected function privilege';
  end if;
end $$;

set local role authenticated;
select pg_temp.act_as('32400000-0000-4000-8000-000000000001');

do $$
declare
  result jsonb;
  match_row public.occurrence_source_matches;
  occurrence_row public.occurrences;
  x text := 'hevy/' || repeat('1', 64);
  y text := 'hevy/' || repeat('2', 64);
begin
  insert into public.behavior_source_links (behavior_id, source, selector_kind)
  values ('32410000-0000-4000-8000-000000000002', 'hevy', 'any');

  -- Walk, marked Completed by the user, no link: attaches with no link.
  result := public.attach_unlinked_source_activity('32420000-0000-4000-8000-000000000001', 'hevy', x,
    pg_temp.at_local(0, 17), pg_temp.at_local(0, 17) + interval '30 minutes', now() - interval '1 minute', now());
  if result ->> 'reason' <> 'attached' then raise exception 'Not attached: %', result; end if;
  select * into match_row from public.occurrence_source_matches where id = (result ->> 'match_id')::uuid;
  select * into occurrence_row from public.occurrences where id = '32420000-0000-4000-8000-000000000001';
  if match_row.link_id is not null or match_row.role <> 'attached' or match_row.state <> 'active'
    or match_row.applied_event_id is not null or occurrence_row.status <> 'completed' then
    raise exception 'Hand-counted match has the wrong shape: %', row_to_json(match_row);
  end if;
  if (select count(*) from public.occurrence_status_events where occurrence_id = '32420000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Attaching wrote a status event';
  end if;

  -- The same workout again for the same Behavior.
  result := public.attach_unlinked_source_activity('32420000-0000-4000-8000-000000000001', 'hevy', x,
    pg_temp.at_local(0, 17), pg_temp.at_local(0, 17) + interval '30 minutes', null, now());
  if result ->> 'reason' <> 'already_matched' then raise exception 'Duplicate accepted: %', result; end if;

  -- A linked Behavior.
  result := public.attach_unlinked_source_activity('32420000-0000-4000-8000-000000000002', 'hevy', y,
    pg_temp.at_local(0, 17), pg_temp.at_local(0, 17) + interval '30 minutes', null, now());
  if result ->> 'reason' <> 'linked' then raise exception 'Linked Behavior accepted: %', result; end if;

  -- Not marked Completed by the user.
  result := public.attach_unlinked_source_activity('32420000-0000-4000-8000-000000000003', 'hevy', y,
    pg_temp.at_local(0, 17), pg_temp.at_local(0, 17) + interval '30 minutes', null, now());
  if result ->> 'reason' <> 'not_completed' then raise exception 'Unresolved accepted: %', result; end if;

  -- A workout on another day.
  result := public.attach_unlinked_source_activity('32420000-0000-4000-8000-000000000001', 'hevy', y,
    pg_temp.at_local(1, 17), pg_temp.at_local(1, 17) + interval '30 minutes', null, now());
  if result ->> 'reason' <> 'outside_day' then raise exception 'Other day accepted: %', result; end if;

  -- A workout still running.
  result := public.attach_unlinked_source_activity('32420000-0000-4000-8000-000000000001', 'hevy', y,
    now() - interval '10 minutes', now() + interval '10 minutes', null, now());
  if result ->> 'reason' not in ('activity_unfinished', 'outside_day') then raise exception 'Unfinished accepted: %', result; end if;

  -- An activity from another source shape.
  begin
    perform public.attach_unlinked_source_activity('32420000-0000-4000-8000-000000000001', 'hevy', 'strava/' || repeat('3', 64),
      pg_temp.at_local(0, 17), pg_temp.at_local(0, 17) + interval '30 minutes', null, now());
    raise exception 'Foreign activity accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- The connector completion job's channel cannot count by hand.
select pg_temp.act_as('32400000-0000-4000-8000-000000000001', 'connector_completion');
do $$
begin
  perform public.attach_unlinked_source_activity('32420000-0000-4000-8000-000000000001', 'hevy', 'hevy/' || repeat('4', 64),
    pg_temp.at_local(0, 17), pg_temp.at_local(0, 17) + interval '30 minutes', null, now());
  raise exception 'Job channel counted by hand';
exception when insufficient_privilege then null;
end $$;

-- A connector's Completed mark is not the user's: nothing attaches.
reset role;
insert into public.occurrence_status_events (user_id, occurrence_id, behavior_id, previous_status, status, status_semantics,
  recorded_at, effective_at, local_date, timezone, source_capture_method, source_confidence, reason_code) values
  ('32400000-0000-4000-8000-000000000001', '32420000-0000-4000-8000-000000000001', '32410000-0000-4000-8000-000000000001', 'completed', 'completed', 'system_rule_declared',
   now() + interval '1 second', now(), pg_temp.fixture_today(), 'America/New_York', 'derived', 'high', 'connector:hevy');
set local role authenticated;
select pg_temp.act_as('32400000-0000-4000-8000-000000000001');
do $$
declare result jsonb;
begin
  result := public.attach_unlinked_source_activity('32420000-0000-4000-8000-000000000001', 'hevy', 'hevy/' || repeat('5', 64),
    pg_temp.at_local(0, 16), pg_temp.at_local(0, 16) + interval '30 minutes', null, now());
  if result ->> 'reason' <> 'not_completed' then raise exception 'Connector mark accepted: %', result; end if;
end $$;
reset role;

rollback;
