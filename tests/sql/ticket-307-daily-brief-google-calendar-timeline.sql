\set ON_ERROR_STOP on

-- Ticket 307: Daily Brief reads Google Calendar through the Timeline connection.
-- Replaces google-calendar-agent-contract.sql (Ticket 187). Verifies the retired
-- grant (empty, unreachable), the preference mapping, the read marker and the
-- older-client save. Synthetic users only; everything rolls back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('30700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ticket-307-timeline@example.invalid', '{}', '{}'),
  ('30700000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ticket-307-no-timeline@example.invalid', '{}', '{}'),
  ('30700000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'ticket-307-stored@example.invalid', '{}', '{}'),
  ('30700000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'ticket-307-outlook@example.invalid', '{}', '{}');
insert into auth.sessions (id, user_id)
values
  ('30700000-0000-4000-8000-000000000011', '30700000-0000-4000-8000-000000000001'),
  ('30700000-0000-4000-8000-000000000014', '30700000-0000-4000-8000-000000000004');

-- Account 1 allowed Calendar timing and has a connected Timeline connection.
-- Account 2 allowed Calendar timing and Hevy, with no Timeline connection.
-- Account 3 saved the one choice with Google covered and no Timeline connection.
-- Account 4 allowed only Outlook and has a connected Timeline connection.
insert into public.google_calendar_connections (user_id, google_subject, generation, status)
values
  ('30700000-0000-4000-8000-000000000001', 'timeline-one', 2, 'connected'),
  ('30700000-0000-4000-8000-000000000004', 'timeline-four', 1, 'connected');
insert into public.google_calendar_preferences (user_id, selected_calendar_ids)
values
  ('30700000-0000-4000-8000-000000000001', array['work']),
  ('30700000-0000-4000-8000-000000000004', array['home']);
insert into cadence_advisor_private.daily_brief_preferences (
  user_id, enabled, include_calendar, calendar_connection_generation, calendar_selection_revision, revision,
  include_hevy, hevy_connection_generation, include_outlook_calendar, outlook_connection_generation, outlook_selection_revision
) values
  ('30700000-0000-4000-8000-000000000001', true, true, 3, 1, 4, false, null, false, null, null),
  ('30700000-0000-4000-8000-000000000002', true, true, 3, 1, 4, true, 1, false, null, null),
  ('30700000-0000-4000-8000-000000000004', true, false, null, null, 4, false, null, true, 2, 0);
insert into cadence_advisor_private.daily_brief_preferences (
  user_id, enabled, include_calendar, revision, use_connected_sources,
  exclude_google_calendar, exclude_outlook_calendar, exclude_icloud_calendar, exclude_hevy
) values ('30700000-0000-4000-8000-000000000003', true, false, 7, true, false, true, false, false);
insert into cadence_advisor_private.daily_brief_runs (user_id, installation_id, local_date, timezone, preference_revision, status, lease_token, started_at, finished_at)
values ('30700000-0000-4000-8000-000000000001', '30700000-0000-4000-8000-000000000101', current_date, 'America/New_York', 4, 'completed', gen_random_uuid(), now(), now());

do $$
declare
  changed integer := cadence_advisor_private.map_daily_brief_google_calendar_to_timeline();
  row cadence_advisor_private.daily_brief_preferences%rowtype;
begin
  if changed <> 4 then raise exception 'Expected four mapped rows, got %', changed; end if;

  select * into row from cadence_advisor_private.daily_brief_preferences where user_id = '30700000-0000-4000-8000-000000000001';
  if not row.use_connected_sources or row.exclude_google_calendar or not row.exclude_outlook_calendar or not row.exclude_icloud_calendar
    or not row.exclude_hevy or row.include_calendar or row.calendar_connection_generation is not null or row.revision <> 5
  then
    raise exception 'Allowed Calendar with a Timeline connection must stay allowed: %', row;
  end if;
  if exists (select 1 from cadence_advisor_private.daily_brief_runs where user_id = '30700000-0000-4000-8000-000000000001') then
    raise exception 'A mapped account kept an attempt prepared under the old grant.';
  end if;

  select * into row from cadence_advisor_private.daily_brief_preferences where user_id = '30700000-0000-4000-8000-000000000002';
  if not row.use_connected_sources or not row.exclude_google_calendar or row.exclude_hevy or row.include_hevy or row.hevy_connection_generation is not null then
    raise exception 'Allowed Calendar without a Timeline connection must start excluded: %', row;
  end if;

  select * into row from cadence_advisor_private.daily_brief_preferences where user_id = '30700000-0000-4000-8000-000000000003';
  if not row.exclude_google_calendar or not row.exclude_outlook_calendar or row.exclude_hevy or row.revision <> 8 then
    raise exception 'A stored choice covering Google without a Timeline connection must exclude it: %', row;
  end if;

  -- Google was not allowed, so it stays excluded even with a connected Timeline connection.
  select * into row from cadence_advisor_private.daily_brief_preferences where user_id = '30700000-0000-4000-8000-000000000004';
  if not row.use_connected_sources or not row.exclude_google_calendar or row.exclude_outlook_calendar then
    raise exception 'A source that was not allowed must stay excluded: %', row;
  end if;

  -- Mapping again changes nothing.
  if cadence_advisor_private.map_daily_brief_google_calendar_to_timeline() <> 0 then
    raise exception 'The mapping is not idempotent.';
  end if;
end;
$$;

-- The retired grant: no rows, no service-role or client access to its functions.
do $$
begin
  if exists (select 1 from public.google_calendar_agent_connections) or exists (select 1 from public.google_calendar_agent_preferences)
    or exists (select 1 from cadence_calendar_agent_private.credentials) or exists (select 1 from cadence_calendar_agent_private.attempts)
  then
    raise exception 'Daily Brief grant rows remain.';
  end if;
  if has_function_privilege('service_role', 'public.calendar_agent_begin_attempt(uuid,text,text,text,bigint,text,text,text)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.calendar_agent_install_credential(uuid,text,bigint,text,text,text)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.calendar_agent_consume_attempt(text)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.calendar_agent_read_credential(uuid,text,bigint)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.calendar_agent_disconnect(uuid,text,bigint,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.calendar_agent_read_credential(uuid,text,bigint)', 'EXECUTE')
    or has_schema_privilege('authenticated', 'cadence_calendar_agent_private', 'USAGE')
    or has_table_privilege('authenticated', 'public.google_calendar_agent_connections', 'INSERT')
  then
    raise exception 'The retired grant is still reachable.';
  end if;
  if has_function_privilege('authenticated', 'cadence_advisor_private.map_daily_brief_google_calendar_to_timeline()', 'EXECUTE')
    or has_function_privilege('service_role', 'cadence_advisor_private.map_daily_brief_google_calendar_to_timeline()', 'EXECUTE')
  then
    raise exception 'The mapping function is exposed.';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"30700000-0000-4000-8000-000000000001","role":"authenticated","session_id":"30700000-0000-4000-8000-000000000011"}', true);
do $$
declare
  preference jsonb := public.read_daily_brief_preferences();
  decision jsonb;
begin
  if preference ->> 'google_calendar_source' <> 'timeline' or (preference ->> 'include_calendar')::boolean
    or (preference -> 'excluded_sources' ->> 'google_calendar')::boolean
  then
    raise exception 'The read must report Google Calendar through the Timeline connection: %', preference;
  end if;
  -- The stored fence reads no grant; a run starts on the current Timeline connection.
  decision := public.begin_daily_brief('30700000-0000-4000-8000-000000000102', false, 5);
  if decision ->> 'state' <> 'acquired' then raise exception 'Admission failed after mapping: %', decision; end if;
end;
$$;

-- A client built before Ticket 306 saves per-source keys; they map to the one choice
-- and no longer read the retired grant.
select set_config('request.jwt.claims',
  '{"sub":"30700000-0000-4000-8000-000000000004","role":"authenticated","session_id":"30700000-0000-4000-8000-000000000014"}', true);
do $$
declare
  preference jsonb;
begin
  preference := public.save_daily_brief_preferences_v3(true, true, false, false, false, false, false, 5);
  if not (preference ->> 'use_connected_sources')::boolean or (preference -> 'excluded_sources' ->> 'google_calendar')::boolean
    or not (preference -> 'excluded_sources' ->> 'outlook_calendar')::boolean or (preference ->> 'include_calendar')::boolean
    or preference ->> 'revision' <> '6'
  then
    raise exception 'An older save did not map to the one choice: %', preference;
  end if;
  preference := public.save_daily_brief_preferences(false, false, 6);
  if (preference ->> 'use_connected_sources')::boolean or (preference -> 'excluded_sources' ->> 'outlook_calendar')::boolean then
    raise exception 'Disabling through the original save kept a source choice: %', preference;
  end if;
  begin
    perform public.save_daily_brief_preferences_v3(false, true, false, false, false, false, false, 7);
    raise exception 'A disabled older save kept Calendar.';
  exception when sqlstate '22023' then null;
  end;
end;
$$;

reset role;
rollback;
