\set ON_ERROR_STOP on

-- Ticket 239: separate Daily Brief disclosure for Outlook Calendar, iCloud
-- Calendar, and Hevy. Synthetic users only; everything rolls back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('22600000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ticket-239@example.invalid', '{}', '{}');
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

-- Tickets 306 and 307 supersede the per-source disclosure: the seven-key save now
-- stores the one connected-sources choice, and every source it leaves off is excluded.
do $$
declare
  preference jsonb;
  decision jsonb;
  lease uuid;
begin
  preference := public.read_daily_brief_preferences();
  if (preference ->> 'use_connected_sources')::boolean or (preference ->> 'include_outlook_calendar')::boolean
    or (preference ->> 'include_hevy')::boolean then
    raise exception 'Sources must default off: %', preference;
  end if;

  -- Disabled Daily Brief cannot keep a source; a stale revision is refused.
  perform pg_temp.expect_error($q$select public.save_daily_brief_preferences_v3(false, false, false, false, false, false, true, 0)$q$, '22023');
  perform pg_temp.expect_error($q$select public.save_daily_brief_preferences_v3(true, false, false, false, false, false, false, 7)$q$, '55000');

  preference := public.save_daily_brief_preferences_v3(true, false, false, false, true, false, true, 0);
  if preference ->> 'revision' <> '1' or not (preference ->> 'use_connected_sources')::boolean
    or preference -> 'excluded_sources' <> '{"google_calendar": true, "outlook_calendar": false, "icloud_calendar": true, "hevy": false}'::jsonb
    or (preference ->> 'include_outlook_calendar')::boolean or preference ->> 'outlook_connection_generation' is not null
  then
    raise exception 'The seven-key save did not map to the one choice: %', preference;
  end if;

  decision := public.begin_daily_brief('22600000-0000-4000-8000-000000000101', false, 1);
  if decision ->> 'state' <> 'acquired' then raise exception 'Current choice was not admitted: %', decision; end if;
  lease := (decision ->> 'lease_token')::uuid;
  if not public.finish_daily_brief('22600000-0000-4000-8000-000000000101', lease, false, 1) then
    raise exception 'Failed attempt was not recorded.';
  end if;
end;
$$;

-- A covered source follows its current connection: a changed selection or a
-- reconnect no longer fences admission. The service fences each run.
update public.connector_preferences set selected_source_ids = array['calendar-1', 'calendar-2']
where user_id = '22600000-0000-4000-8000-000000000001' and provider = 'outlook_calendar';
reset role;
update public.connector_connections set generation = generation + 1
where user_id = '22600000-0000-4000-8000-000000000001' and provider = 'hevy';
set local role authenticated;

do $$
declare
  preference jsonb;
  decision jsonb;
begin
  decision := public.begin_daily_brief('22600000-0000-4000-8000-000000000102', false, 1);
  if decision ->> 'state' <> 'acquired' then raise exception 'A changed covered source was refused: %', decision; end if;
  if not public.finish_daily_brief('22600000-0000-4000-8000-000000000102', (decision ->> 'lease_token')::uuid, true, 1) then
    raise exception 'The stored revision alone no longer matched.';
  end if;

  -- Older two-key and original saves exclude every source they leave off.
  preference := public.save_daily_brief_preferences_v2(true, false, false, false, 1);
  if (preference ->> 'use_connected_sources')::boolean then
    raise exception 'An older save kept a source: %', preference;
  end if;
  preference := public.save_daily_brief_preferences(true, false, 2);
  if (preference ->> 'use_connected_sources')::boolean or preference ->> 'revision' <> '3' then
    raise exception 'The original save kept a source: %', preference;
  end if;
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
