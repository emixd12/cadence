\set ON_ERROR_STOP on

-- Ticket 314: connector completion tables and database functions. Synthetic local
-- fixtures only; every change rolls back. Covers the cases in plan Task 5.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('31400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'connector-a@example.invalid', '{}', '{}'),
  ('31400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'connector-b@example.invalid', '{}', '{}');
insert into public.profiles (id, email, timezone) values
  ('31400000-0000-4000-8000-000000000001', 'connector-a@example.invalid', 'America/New_York'),
  ('31400000-0000-4000-8000-000000000002', 'connector-b@example.invalid', 'America/New_York')
on conflict (id) do update set timezone = excluded.timezone;

-- A: Leg day (routine link), Gym (any-workout link), Extra (for refusals). B: Other.
insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone) values
  ('31410000-0000-4000-8000-000000000001', '31400000-0000-4000-8000-000000000001', 'Leg day', '{"type":"daily"}', '18:00', 'America/New_York'),
  ('31410000-0000-4000-8000-000000000002', '31400000-0000-4000-8000-000000000001', 'Gym', '{"type":"daily"}', '18:00', 'America/New_York'),
  ('31410000-0000-4000-8000-000000000003', '31400000-0000-4000-8000-000000000001', 'Extra', '{"type":"daily"}', '18:00', 'America/New_York'),
  ('31410000-0000-4000-8000-000000000009', '31400000-0000-4000-8000-000000000002', 'Other', '{"type":"daily"}', '18:00', 'America/New_York');

-- The fixture's day 0 is yesterday in New York, so its afternoon activities have ended
-- whatever time the rehearsal runs. Day offsets stay inside the 30-day window.
create function pg_temp.fixture_today() returns date language sql as $$
  select (now() at time zone 'America/New_York')::date - 1;
$$;

create function pg_temp.at_local(days_back integer, hour integer) returns timestamptz language sql as $$
  select (pg_temp.fixture_today() - days_back + make_interval(hours => hour)) at time zone 'America/New_York';
$$;

-- Occurrences at 18:00 local. O1, O2 today; O3 yesterday (Leg day); O4 two days back
-- (Gym, Not Completed); O5 40 days back (Leg day); O9 today for B.
insert into public.occurrences (id, user_id, behavior_id, scheduled_for, local_date, schedule_kind, schedule_start_time, status, status_marked_at) values
  ('31420000-0000-4000-8000-000000000001', '31400000-0000-4000-8000-000000000001', '31410000-0000-4000-8000-000000000001', pg_temp.at_local(0, 18), pg_temp.fixture_today(), 'exact', '18:00', 'unresolved', null),
  ('31420000-0000-4000-8000-000000000002', '31400000-0000-4000-8000-000000000001', '31410000-0000-4000-8000-000000000002', pg_temp.at_local(0, 18), pg_temp.fixture_today(), 'exact', '18:00', 'unresolved', null),
  ('31420000-0000-4000-8000-000000000003', '31400000-0000-4000-8000-000000000001', '31410000-0000-4000-8000-000000000001', pg_temp.at_local(1, 18), pg_temp.fixture_today() - 1, 'exact', '18:00', 'unresolved', null),
  ('31420000-0000-4000-8000-000000000004', '31400000-0000-4000-8000-000000000001', '31410000-0000-4000-8000-000000000002', pg_temp.at_local(2, 18), pg_temp.fixture_today() - 2, 'exact', '18:00', 'not_completed', now() - interval '1 day'),
  ('31420000-0000-4000-8000-000000000005', '31400000-0000-4000-8000-000000000001', '31410000-0000-4000-8000-000000000001', pg_temp.at_local(40, 18), pg_temp.fixture_today() - 40, 'exact', '18:00', 'unresolved', null),
  ('31420000-0000-4000-8000-000000000009', '31400000-0000-4000-8000-000000000002', '31410000-0000-4000-8000-000000000009', pg_temp.at_local(0, 18), pg_temp.fixture_today(), 'exact', '18:00', 'unresolved', null);

insert into public.reminder_deliveries (user_id, occurrence_id, channel, scheduled_send_at, status) values
  ('31400000-0000-4000-8000-000000000001', '31420000-0000-4000-8000-000000000001', 'browser_push', pg_temp.at_local(0, 18), 'pending'),
  ('31400000-0000-4000-8000-000000000001', '31420000-0000-4000-8000-000000000002', 'browser_push', pg_temp.at_local(0, 18), 'pending');

insert into public.connector_connections (user_id, provider, account_digest, generation, status) values
  ('31400000-0000-4000-8000-000000000001', 'hevy', repeat('d', 64), 1, 'connected'),
  ('31400000-0000-4000-8000-000000000002', 'hevy', repeat('e', 64), 1, 'connected');

create function pg_temp.act_as(owner uuid, channel text default null) returns void language sql as $$
  select set_config('request.jwt.claims', (case when channel is null
    then json_build_object('sub', owner, 'role', 'authenticated')
    else json_build_object('sub', owner, 'role', 'authenticated', 'cadence_channel', channel) end)::text, true);
$$;
grant execute on function pg_temp.act_as(uuid, text) to authenticated;
grant execute on function pg_temp.at_local(integer, integer) to authenticated;

-- Privileges: no anon or service_role access to tables or writers.
do $$
begin
  if has_table_privilege('anon', 'public.behavior_source_links', 'SELECT')
    or has_table_privilege('service_role', 'public.occurrence_source_matches', 'SELECT')
    or has_table_privilege('service_role', 'public.connector_completion_state', 'SELECT')
    or has_table_privilege('authenticated', 'public.occurrence_source_matches', 'INSERT')
    or has_table_privilege('authenticated', 'public.occurrence_source_matches', 'UPDATE') then
    raise exception 'Unexpected table privilege';
  end if;
  if has_function_privilege('anon', 'public.apply_connector_completion(uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,timestamptz)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.remove_source_match(uuid,timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'cadence_private.connector_match_precondition(uuid,public.behavior_source_links,public.occurrences,timestamptz,timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'Unexpected function privilege';
  end if;
end $$;

set local role authenticated;
select pg_temp.act_as('31400000-0000-4000-8000-000000000001');

do $$
declare
  leg uuid; gym uuid;
  result jsonb;
  occurrence_row public.occurrences;
  event_row public.occurrence_status_events;
  match_count integer;
  pending integer;
  x text := 'hevy/' || repeat('1', 64);
  y text := 'hevy/' || repeat('2', 64);
  z text := 'hevy/' || repeat('3', 64);
begin
  -- Links: the trigger binds the account digest; the client cannot choose it.
  insert into public.behavior_source_links (behavior_id, source, selector_kind, selector_keys)
  values ('31410000-0000-4000-8000-000000000001', 'hevy', 'provider_keys', array[repeat('a', 64)]) returning id into leg;
  insert into public.behavior_source_links (behavior_id, source, selector_kind)
  values ('31410000-0000-4000-8000-000000000002', 'hevy', 'any') returning id into gym;
  if (select account_digest from public.behavior_source_links where id = leg) <> repeat('d', 64) then
    raise exception 'Link not bound to the connected account';
  end if;
  perform set_config('cadence_test.leg', leg::text, true);
  perform set_config('cadence_test.gym', gym::text, true);

  -- D28.4 save-time limits: a second any-workout link and a routine already linked.
  begin
    insert into public.behavior_source_links (behavior_id, source, selector_kind)
    values ('31410000-0000-4000-8000-000000000003', 'hevy', 'any');
    raise exception 'Second any-workout link accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.behavior_source_links (behavior_id, source, selector_kind, selector_keys)
    values ('31410000-0000-4000-8000-000000000003', 'hevy', 'provider_keys', array[repeat('b', 64), repeat('a', 64)]);
    raise exception 'Routine linked twice';
  exception when unique_violation then null;
  end;
  begin
    insert into public.behavior_source_links (behavior_id, source, selector_kind, selector_keys)
    values ('31410000-0000-4000-8000-000000000003', 'hevy', 'provider_keys', array['not-a-digest']);
    raise exception 'Non-digest selector accepted';
  exception when check_violation then null;
  end;

  -- Complete O1 (Leg day) from X: one transaction writes everything.
  result := public.apply_connector_completion(leg, '31420000-0000-4000-8000-000000000001', x,
    pg_temp.at_local(0, 17), pg_temp.at_local(0, 17) + interval '45 minutes', now() - interval '1 minute', null, now());
  if result ->> 'reason' <> 'applied' then raise exception 'Completion not applied: %', result; end if;
  select * into occurrence_row from public.occurrences where id = '31420000-0000-4000-8000-000000000001';
  select * into event_row from public.occurrence_status_events where id = (result ->> 'status_event_id')::uuid;
  if occurrence_row.status <> 'completed' or occurrence_row.completed_at <> pg_temp.at_local(0, 17) + interval '45 minutes'
    or event_row.status_semantics <> 'system_rule_declared' or event_row.source_capture_method <> 'derived'
    or event_row.source_confidence <> 'high' or event_row.reason_code <> 'connector:hevy'
    or event_row.effective_at <> occurrence_row.completed_at or event_row.recorded_at <> occurrence_row.status_marked_at then
    raise exception 'Connector completion provenance wrong: % %', row_to_json(occurrence_row), row_to_json(event_row);
  end if;
  select count(*) into pending from public.reminder_deliveries
  where occurrence_id = '31420000-0000-4000-8000-000000000001' and status = 'pending';
  if pending <> 0 then raise exception 'Pending reminder not cancelled'; end if;

  -- A second call for the same activity and Behavior writes nothing.
  result := public.apply_connector_completion(leg, '31420000-0000-4000-8000-000000000001', x,
    pg_temp.at_local(0, 17), pg_temp.at_local(0, 17) + interval '45 minutes', null, (result ->> 'status_event_id')::uuid, now());
  if (result ->> 'applied')::boolean then raise exception 'Duplicate completion applied'; end if;

  -- D28.4: the same activity completes the any-workout Behavior (O2).
  result := public.apply_connector_completion(gym, '31420000-0000-4000-8000-000000000002', x,
    pg_temp.at_local(0, 17), pg_temp.at_local(0, 17) + interval '45 minutes', null, null, now());
  if result ->> 'reason' <> 'applied' then raise exception 'Second Behavior not completed: %', result; end if;

  -- Attach on a Not Completed Occurrence is refused.
  result := public.attach_source_activity(gym, '31420000-0000-4000-8000-000000000004', y,
    pg_temp.at_local(2, 17), pg_temp.at_local(2, 18), null, now());
  if result ->> 'reason' <> 'not_completed' then raise exception 'Attach on Not Completed: %', result; end if;
  -- Attach on an Unresolved Occurrence is refused.
  result := public.attach_source_activity(leg, '31420000-0000-4000-8000-000000000003', y,
    pg_temp.at_local(1, 17), pg_temp.at_local(1, 18), null, now());
  if result ->> 'reason' <> 'not_completed' then raise exception 'Attach on Unresolved: %', result; end if;

  -- Attach Y to O2: no Occurrence column, status event or reminder changes.
  select * into occurrence_row from public.occurrences where id = '31420000-0000-4000-8000-000000000002';
  select count(*) into match_count from public.occurrence_status_events where occurrence_id = occurrence_row.id;
  result := public.attach_source_activity(gym, occurrence_row.id, y,
    pg_temp.at_local(0, 12), pg_temp.at_local(0, 13), now() - interval '2 minutes', now());
  if result ->> 'reason' <> 'attached' then raise exception 'Attach failed: %', result; end if;
  if (select row_to_json(o)::text from public.occurrences o where o.id = occurrence_row.id) <> row_to_json(occurrence_row)::text
    or (select count(*) from public.occurrence_status_events where occurrence_id = occurrence_row.id) <> match_count then
    raise exception 'Attach changed the Occurrence or its history';
  end if;
  -- A newer revision refreshes timing; an older one does not.
  result := public.attach_source_activity(gym, occurrence_row.id, y,
    pg_temp.at_local(0, 12) + interval '5 minutes', pg_temp.at_local(0, 13), now() - interval '3 minutes', now());
  if result ->> 'reason' <> 'revision_not_newer' then raise exception 'Older revision refreshed: %', result; end if;
  result := public.attach_source_activity(gym, occurrence_row.id, y,
    pg_temp.at_local(0, 12) + interval '5 minutes', pg_temp.at_local(0, 13), now() - interval '1 minute', now());
  if result ->> 'reason' <> 'timing_refreshed' then raise exception 'Timing not refreshed: %', result; end if;

  -- Removing one of two active matches keeps the status.
  result := public.remove_source_match((select id from public.occurrence_source_matches where activity_ref = y), now());
  if (result ->> 'reverted')::boolean or (select status from public.occurrences where id = occurrence_row.id) <> 'completed' then
    raise exception 'Removing one of two matches reverted: %', result;
  end if;
  -- Removing the last one reverts it.
  result := public.remove_source_match((select id from public.occurrence_source_matches
    where activity_ref = x and behavior_id = '31410000-0000-4000-8000-000000000002'), now());
  if not (result ->> 'reverted')::boolean then raise exception 'Last removal did not revert: %', result; end if;
  select * into occurrence_row from public.occurrences where id = occurrence_row.id;
  select * into event_row from public.occurrence_status_events where id = (result ->> 'status_event_id')::uuid;
  if occurrence_row.status <> 'unresolved' or occurrence_row.completed_at is not null or occurrence_row.status_marked_at is not null
    or event_row.status <> 'unresolved' or event_row.reason_code <> 'connector:hevy' or event_row.revises_event_id is null then
    raise exception 'Revert wrong: % %', row_to_json(occurrence_row), row_to_json(event_row);
  end if;
  if (select reverted_event_id from public.occurrence_source_matches where activity_ref = x
      and behavior_id = '31410000-0000-4000-8000-000000000002') <> event_row.id then
    raise exception 'Revert not recorded on the completion match';
  end if;
end $$;

-- The user clears the connector completion on O1 through the manual path.
do $$
declare
  latest uuid := (select id from public.occurrence_status_events where occurrence_id = '31420000-0000-4000-8000-000000000001'
    order by recorded_at desc, created_at desc, id desc limit 1);
  result jsonb;
begin
  perform public.apply_occurrence_status_transition('31420000-0000-4000-8000-000000000001', 'completed', latest,
    'unresolved', null, null, 'explicit_user_correction', now(), null, 'manual_tap', 'high', false);
  -- After the user clears it, another activity cannot complete that Occurrence.
  result := public.apply_connector_completion(current_setting('cadence_test.leg')::uuid, '31420000-0000-4000-8000-000000000001',
    'hevy/' || repeat('4', 64), pg_temp.at_local(0, 18), pg_temp.at_local(0, 19), null,
    (select id from public.occurrence_status_events where occurrence_id = '31420000-0000-4000-8000-000000000001'
      order by recorded_at desc, created_at desc, id desc limit 1), now());
  if result ->> 'reason' <> 'completion_stands' then raise exception 'Cleared completion re-completed: %', result; end if;
  -- The manual function still rejects connector provenance.
  begin
    perform public.apply_occurrence_status_transition('31420000-0000-4000-8000-000000000003', 'unresolved', null,
      'completed', now(), now(), 'explicit_user_mark', now(), now(), 'derived', 'high', true);
    raise exception 'Manual function accepted derived';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Removing the last match after a user correction changes no status (O3).
do $$
declare
  result jsonb;
  completion_event uuid;
  m text := 'hevy/' || repeat('5', 64);
begin
  result := public.apply_connector_completion(current_setting('cadence_test.leg')::uuid, '31420000-0000-4000-8000-000000000003', m,
    pg_temp.at_local(1, 18), pg_temp.at_local(1, 19), null, null, now());
  if result ->> 'reason' <> 'applied' then raise exception 'O3 completion: %', result; end if;
  completion_event := (result ->> 'status_event_id')::uuid;
  perform public.apply_occurrence_status_transition('31420000-0000-4000-8000-000000000003', 'completed', completion_event,
    'not_completed', null, now(), 'explicit_user_correction', now(), now(), 'manual_tap', 'high', true);
  result := public.remove_source_match((select id from public.occurrence_source_matches where activity_ref = m), now());
  if (result ->> 'reverted')::boolean or (select status from public.occurrences where id = '31420000-0000-4000-8000-000000000003') <> 'not_completed' then
    raise exception 'Removal overrode the user: %', result;
  end if;

  -- History outside the 30-day window never changes.
  result := public.apply_connector_completion(current_setting('cadence_test.leg')::uuid, '31420000-0000-4000-8000-000000000005',
    'hevy/' || repeat('6', 64), pg_temp.at_local(40, 18), pg_temp.at_local(40, 19), null, null, now());
  if result ->> 'reason' <> 'outside_window' then raise exception 'Old Occurrence completed: %', result; end if;

  -- An unfinished activity and a back-dated recorded instant are refused.
  result := public.apply_connector_completion(current_setting('cadence_test.gym')::uuid, '31420000-0000-4000-8000-000000000002',
    'hevy/' || repeat('7', 64), now() - interval '10 minutes', now() + interval '10 minutes', null,
    (select id from public.occurrence_status_events where occurrence_id = '31420000-0000-4000-8000-000000000002'
      order by recorded_at desc, created_at desc, id desc limit 1), now());
  if result ->> 'reason' <> 'activity_unfinished' then raise exception 'Unfinished activity: %', result; end if;
  begin
    perform public.apply_connector_completion(current_setting('cadence_test.gym')::uuid, '31420000-0000-4000-8000-000000000002',
      'hevy/' || repeat('7', 64), now() - interval '2 hours', now() - interval '1 hour', null, null, now() - interval '1 hour');
    raise exception 'Back-dated recorded instant accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Another channel cannot write; another account sees nothing and writes nothing.
select pg_temp.act_as('31400000-0000-4000-8000-000000000001', 'mcp');
do $$
begin
  perform public.remove_source_match((select id from public.occurrence_source_matches limit 1), now());
  raise exception 'MCP channel wrote a connector change';
exception when insufficient_privilege then null;
end $$;

select pg_temp.act_as('31400000-0000-4000-8000-000000000002');
do $$
declare
  result jsonb;
begin
  if exists (select 1 from public.behavior_source_links) or exists (select 1 from public.occurrence_source_matches) then
    raise exception 'Cross-account rows visible';
  end if;
  result := public.apply_connector_completion(current_setting('cadence_test.leg')::uuid, '31420000-0000-4000-8000-000000000009',
    'hevy/' || repeat('8', 64), pg_temp.at_local(0, 17), pg_temp.at_local(0, 18), null, null, now());
  if result ->> 'reason' <> 'link_unavailable' then raise exception 'Cross-account link used: %', result; end if;
  update public.behavior_source_links set enabled = false;
  delete from public.behavior_source_links;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.behavior_source_links where user_id = '31400000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'Another account changed links';
  end if;
end $$;

-- A disconnected source, or a reconnect with another account, fences the link.
update public.connector_connections set status = 'disconnected'
where user_id = '31400000-0000-4000-8000-000000000001' and provider = 'hevy';
set local role authenticated;
select pg_temp.act_as('31400000-0000-4000-8000-000000000001');
do $$
declare result jsonb;
begin
  result := public.apply_connector_completion(current_setting('cadence_test.gym')::uuid, '31420000-0000-4000-8000-000000000002',
    'hevy/' || repeat('9', 64), pg_temp.at_local(0, 9), pg_temp.at_local(0, 10), null,
    (select id from public.occurrence_status_events where occurrence_id = '31420000-0000-4000-8000-000000000002'
      order by recorded_at desc, created_at desc, id desc limit 1), now());
  if result ->> 'reason' <> 'source_not_connected' then raise exception 'Disconnected source wrote: %', result; end if;
  -- Turning a link off needs no connection.
  update public.behavior_source_links set enabled = false where id = current_setting('cadence_test.gym')::uuid;
  update public.behavior_source_links set enabled = true where id = current_setting('cadence_test.gym')::uuid;
  raise exception 'Enabling a link while disconnected was accepted';
exception when invalid_parameter_value then null;
end $$;
reset role;
update public.connector_connections set status = 'connected', account_digest = repeat('f', 64)
where user_id = '31400000-0000-4000-8000-000000000001' and provider = 'hevy';
set local role authenticated;
select pg_temp.act_as('31400000-0000-4000-8000-000000000001');
do $$
declare result jsonb;
begin
  result := public.apply_connector_completion(current_setting('cadence_test.leg')::uuid, '31420000-0000-4000-8000-000000000003',
    'hevy/' || repeat('9', 64), pg_temp.at_local(1, 9), pg_temp.at_local(1, 10), null, null, now());
  if result ->> 'reason' not in ('account_changed', 'not_unresolved') then raise exception 'Other account wrote: %', result; end if;
  result := public.attach_source_activity(current_setting('cadence_test.leg')::uuid, '31420000-0000-4000-8000-000000000003',
    'hevy/' || repeat('9', 64), pg_temp.at_local(1, 9), pg_temp.at_local(1, 10), null, now());
  if result ->> 'reason' <> 'account_changed' then raise exception 'Other account attached: %', result; end if;
end $$;
reset role;

rollback;
