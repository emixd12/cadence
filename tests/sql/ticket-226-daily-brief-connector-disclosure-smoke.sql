\set ON_ERROR_STOP on

-- Ticket 226: separate Daily Brief disclosure for Outlook Calendar, iCloud
-- Calendar, and Hevy. Synthetic users only; everything rolls back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('22600000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ticket-226@example.invalid', '{}', '{}');
insert into auth.sessions (id, user_id)
values ('22600000-0000-4000-8000-000000000011', '22600000-0000-4000-8000-000000000001');

-- Connected synthetic sources, installed as the service would through its RPCs.
insert into public.connector_connections (user_id, provider, account_digest, generation, status)
values
  ('22600000-0000-4000-8000-000000000001', 'outlook_calendar', repeat('a', 64), 2, 'connected'),
  ('22600000-0000-4000-8000-000000000001', 'hevy', repeat('b', 64), 1, 'connected');
insert into public.connector_preferences (user_id, provider, selected_source_ids)
values
  ('22600000-0000-4000-8000-000000000001', 'outlook_calendar', array['calendar-1']),
  ('22600000-0000-4000-8000-000000000001', 'hevy', '{}');

create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'Expected SQLSTATE % from: %', expected, statement;
exception when others then
  if sqlstate <> expected then raise exception 'Expected SQLSTATE %, got % from: %', expected, sqlstate, statement; end if;
end;
$$;
grant execute on function pg_temp.expect_error(text, text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22600000-0000-4000-8000-000000000001","role":"authenticated","session_id":"22600000-0000-4000-8000-000000000011"}', true);

do $$
declare
  preference jsonb;
  decision jsonb;
  lease uuid;
begin
  preference := public.read_daily_brief_preferences();
  if (preference ->> 'include_outlook_calendar')::boolean or (preference ->> 'include_icloud_calendar')::boolean or (preference ->> 'include_hevy')::boolean then
    raise exception 'New disclosures must default off: %', preference;
  end if;

  -- Disabled Daily Brief cannot keep a disclosure; a missing source cannot be disclosed.
  perform pg_temp.expect_error($q$select public.save_daily_brief_preferences_v3(false, false, false, false, false, false, true, 0)$q$, '22023');
  perform pg_temp.expect_error($q$select public.save_daily_brief_preferences_v3(true, false, false, false, false, true, false, 0)$q$, '55000');
  perform pg_temp.expect_error($q$select public.save_daily_brief_preferences_v3(true, false, false, false, false, false, false, 7)$q$, '55000');

  preference := public.save_daily_brief_preferences_v3(true, false, false, false, true, false, true, 0);
  if preference ->> 'revision' <> '1' or preference ->> 'outlook_connection_generation' <> '2'
    or preference ->> 'outlook_selection_revision' <> '0' or preference ->> 'hevy_connection_generation' <> '1'
    or (preference ->> 'include_calendar')::boolean
  then
    raise exception 'Disclosures did not bind their fences: %', preference;
  end if;

  decision := public.begin_daily_brief('22600000-0000-4000-8000-000000000101', false, 1);
  if decision ->> 'state' <> 'acquired' then raise exception 'Current disclosure was not admitted: %', decision; end if;
  lease := (decision ->> 'lease_token')::uuid;
  if not public.finish_daily_brief('22600000-0000-4000-8000-000000000101', lease, false, 1) then
    raise exception 'Failed attempt was not recorded.';
  end if;
end;
$$;

-- Changing the Outlook selection advances its revision and fences new attempts.
update public.connector_preferences set selected_source_ids = array['calendar-1', 'calendar-2']
where user_id = '22600000-0000-4000-8000-000000000001' and provider = 'outlook_calendar';

do $$
begin
  perform pg_temp.expect_error($q$select public.begin_daily_brief('22600000-0000-4000-8000-000000000102', false, 1)$q$, '55000');
end;
$$;

-- A fresh grant at the new selection is admitted; a Hevy reconnect then blocks delivery.
do $$
declare
  preference jsonb;
  decision jsonb;
begin
  preference := public.save_daily_brief_preferences_v3(true, false, false, false, true, false, true, 1);
  if preference ->> 'outlook_selection_revision' <> '1' then raise exception 'Selection fence did not advance: %', preference; end if;
  decision := public.begin_daily_brief('22600000-0000-4000-8000-000000000103', false, 2);
  if decision ->> 'state' <> 'acquired' then raise exception 'Fresh disclosure was not admitted: %', decision; end if;
  perform set_config('ticket226.lease', decision ->> 'lease_token', true);
end;
$$;

reset role;
update public.connector_connections set generation = generation + 1
where user_id = '22600000-0000-4000-8000-000000000001' and provider = 'hevy';
set local role authenticated;

do $$
declare
  preference jsonb;
begin
  if public.finish_daily_brief('22600000-0000-4000-8000-000000000103', current_setting('ticket226.lease')::uuid, true, 2) then
    raise exception 'A completed attempt was delivered after the Hevy generation changed.';
  end if;

  -- The stale Hevy fence keeps refusing admission until the user allows Hevy again.
  perform pg_temp.expect_error($q$select public.begin_daily_brief('22600000-0000-4000-8000-000000000104', true, 2)$q$, '55000');
  preference := public.save_daily_brief_preferences_v3(true, false, false, false, true, false, true, 2);
  if preference ->> 'hevy_connection_generation' <> '2' or preference ->> 'revision' <> '3' then
    raise exception 'Allowing Hevy again did not rebind its fence: %', preference;
  end if;
  if public.begin_daily_brief('22600000-0000-4000-8000-000000000104', false, 3) ->> 'state' <> 'acquired' then
    raise exception 'A renewed disclosure was not admitted.';
  end if;

  -- An older two- or four-key client revokes every new disclosure.
  preference := public.save_daily_brief_preferences_v2(true, false, false, false, 3);
  if (preference ->> 'include_outlook_calendar')::boolean or (preference ->> 'include_hevy')::boolean
    or preference ->> 'outlook_connection_generation' is not null or preference ->> 'hevy_connection_generation' is not null
  then
    raise exception 'An older save kept a new disclosure: %', preference;
  end if;
  preference := public.save_daily_brief_preferences_v3(true, false, false, false, false, false, true, 4);
  preference := public.save_daily_brief_preferences(true, false, 5);
  if (preference ->> 'include_hevy')::boolean then raise exception 'The original save kept Hevy disclosure: %', preference; end if;
end;
$$;

do $$
begin
  perform cadence_advisor_private.daily_brief_connector_fence_is_current('22600000-0000-4000-8000-000000000001');
  raise exception 'The private connector fence must not be callable by clients.';
exception when insufficient_privilege then null;
end;
$$;

reset role;
do $$
begin
  perform pg_temp.expect_error($q$update cadence_advisor_private.daily_brief_preferences set enabled = false, include_calendar = false, include_hevy = true, hevy_connection_generation = 1 where user_id = '22600000-0000-4000-8000-000000000001'$q$, '23514');
  perform pg_temp.expect_error($q$update cadence_advisor_private.daily_brief_preferences set include_hevy = true, hevy_connection_generation = null where user_id = '22600000-0000-4000-8000-000000000001'$q$, '23514');
  perform pg_temp.expect_error($q$update cadence_advisor_private.daily_brief_preferences set include_outlook_calendar = true, outlook_connection_generation = 1, outlook_selection_revision = null where user_id = '22600000-0000-4000-8000-000000000001'$q$, '23514');
end;
$$;

rollback;
