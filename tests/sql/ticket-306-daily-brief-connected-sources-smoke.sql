\set ON_ERROR_STOP on

-- Ticket 306: one Daily Brief choice for every connected source. Covers the
-- mapping for existing accounts, the v4 save, withdrawal on disable, and a
-- source connected after the choice. Synthetic users only; everything rolls back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('30600000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ticket-306-new@example.invalid', '{}', '{}'),
  ('30600000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ticket-306-allowed@example.invalid', '{}', '{}'),
  ('30600000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'ticket-306-none@example.invalid', '{}', '{}');
insert into auth.sessions (id, user_id)
values
  ('30600000-0000-4000-8000-000000000011', '30600000-0000-4000-8000-000000000001'),
  ('30600000-0000-4000-8000-000000000012', '30600000-0000-4000-8000-000000000002'),
  ('30600000-0000-4000-8000-000000000013', '30600000-0000-4000-8000-000000000003');

-- Existing accounts as stored before the migration: one allowed Outlook and
-- Hevy, one turned Daily Brief on without allowing a source.
insert into public.connector_connections (user_id, provider, account_digest, generation, status)
values
  ('30600000-0000-4000-8000-000000000002', 'outlook_calendar', repeat('a', 64), 2, 'connected'),
  ('30600000-0000-4000-8000-000000000002', 'hevy', repeat('b', 64), 1, 'connected');
insert into public.connector_preferences (user_id, provider, selected_source_ids)
values ('30600000-0000-4000-8000-000000000002', 'outlook_calendar', array['calendar-1']);
insert into cadence_advisor_private.daily_brief_preferences (
  user_id, enabled, include_calendar, revision, include_outlook_calendar, outlook_connection_generation, outlook_selection_revision,
  include_hevy, hevy_connection_generation, include_notes
) values
  ('30600000-0000-4000-8000-000000000002', true, false, 5, true, 2, 0, true, 1, true),
  ('30600000-0000-4000-8000-000000000003', true, false, 2, false, null, null, false, null, false);

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

-- A new account: the choice is off and nothing is excluded.
select set_config('request.jwt.claims',
  '{"sub":"30600000-0000-4000-8000-000000000001","role":"authenticated","session_id":"30600000-0000-4000-8000-000000000011"}', true);
do $$
declare
  preference jsonb := public.read_daily_brief_preferences();
begin
  if (preference ->> 'use_connected_sources')::boolean
    or preference -> 'excluded_sources' <> '{"google_calendar": false, "outlook_calendar": false, "icloud_calendar": false, "hevy": false}'::jsonb
  then
    raise exception 'A new account must start with the choice off and nothing excluded: %', preference;
  end if;

  perform pg_temp.expect_error($q$select public.save_daily_brief_preferences_v4(false, true, false, false, false, false, false, false, 0)$q$, '22023');
  perform pg_temp.expect_error($q$select public.save_daily_brief_preferences_v4(false, false, true, false, false, false, false, false, 0)$q$, '22023');
  perform pg_temp.expect_error($q$select public.save_daily_brief_preferences_v4(false, false, false, false, false, false, false, true, 0)$q$, '22023');
  perform pg_temp.expect_error($q$select public.save_daily_brief_preferences_v4(true, null, false, false, false, false, false, false, 0)$q$, '22023');
  perform pg_temp.expect_error($q$select public.save_daily_brief_preferences_v4(true, true, false, false, false, false, false, false, 4)$q$, '55000');

  -- The choice is saved with nothing connected; a source connected later is covered.
  preference := public.save_daily_brief_preferences_v4(true, true, false, false, false, true, false, false, 0);
  if preference ->> 'revision' <> '1' or not (preference ->> 'use_connected_sources')::boolean
    or preference -> 'excluded_sources' <> '{"google_calendar": false, "outlook_calendar": false, "icloud_calendar": false, "hevy": true}'::jsonb
  then
    raise exception 'The choice was not stored: %', preference;
  end if;
end;
$$;

reset role;
insert into public.connector_connections (user_id, provider, account_digest, generation, status)
values ('30600000-0000-4000-8000-000000000001', 'icloud_calendar', repeat('c', 64), 1, 'connected');
insert into public.connector_preferences (user_id, provider, selected_source_ids)
values ('30600000-0000-4000-8000-000000000001', 'icloud_calendar', array['ic-home']);
set local role authenticated;

do $$
declare
  preference jsonb := public.read_daily_brief_preferences();
  decision jsonb;
begin
  if (preference -> 'excluded_sources' ->> 'icloud_calendar')::boolean then
    raise exception 'A source connected after the choice was excluded: %', preference;
  end if;
  -- No per-source allowance or bound generation is needed for admission.
  decision := public.begin_daily_brief('30600000-0000-4000-8000-000000000101', false, 1);
  if decision ->> 'state' <> 'acquired' then raise exception 'A later-connected source blocked admission: %', decision; end if;

  -- Excluding a source changes the revision, so the attempt in flight cannot deliver.
  preference := public.save_daily_brief_preferences_v4(true, true, false, false, true, true, false, false, 1);
  if public.finish_daily_brief('30600000-0000-4000-8000-000000000101', (decision ->> 'lease_token')::uuid, true, 1) then
    raise exception 'An attempt delivered after a source was excluded.';
  end if;

  -- Turning Daily Brief off withdraws every source choice.
  preference := public.save_daily_brief_preferences_v4(false, false, false, false, false, false, false, false, 2);
  if (preference ->> 'enabled')::boolean or (preference ->> 'use_connected_sources')::boolean
    or preference -> 'excluded_sources' <> '{"google_calendar": false, "outlook_calendar": false, "icloud_calendar": false, "hevy": false}'::jsonb
  then
    raise exception 'Disabling kept a source choice: %', preference;
  end if;
end;
$$;

-- An existing account keeps exactly what it allowed: the choice is on, and every
-- source it did not allow starts excluded.
select set_config('request.jwt.claims',
  '{"sub":"30600000-0000-4000-8000-000000000002","role":"authenticated","session_id":"30600000-0000-4000-8000-000000000012"}', true);
do $$
declare
  preference jsonb := public.read_daily_brief_preferences();
begin
  if not (preference ->> 'use_connected_sources')::boolean
    or preference -> 'excluded_sources' <> '{"google_calendar": true, "outlook_calendar": false, "icloud_calendar": true, "hevy": false}'::jsonb
    or not (preference ->> 'include_notes')::boolean or preference ->> 'revision' <> '5'
  then
    raise exception 'Existing allowances did not map to the one choice: %', preference;
  end if;

  -- The first v4 save stores the choice and clears the per-source allowances and fences.
  preference := public.save_daily_brief_preferences_v4(true, true, true, false, true, false, false, true, 5);
  if (preference ->> 'include_outlook_calendar')::boolean or (preference ->> 'include_hevy')::boolean
    or preference ->> 'outlook_connection_generation' is not null or preference ->> 'hevy_connection_generation' is not null
    or preference ->> 'revision' <> '6'
  then
    raise exception 'The v4 save kept per-source allowances: %', preference;
  end if;
end;
$$;

-- An account that allowed no source keeps the choice off with nothing excluded.
select set_config('request.jwt.claims',
  '{"sub":"30600000-0000-4000-8000-000000000003","role":"authenticated","session_id":"30600000-0000-4000-8000-000000000013"}', true);
do $$
declare
  preference jsonb := public.read_daily_brief_preferences();
begin
  if (preference ->> 'use_connected_sources')::boolean or (preference ->> 'enabled')::boolean is not true
    or preference -> 'excluded_sources' <> '{"google_calendar": false, "outlook_calendar": false, "icloud_calendar": false, "hevy": false}'::jsonb
  then
    raise exception 'An account that allowed nothing gained a choice: %', preference;
  end if;
end;
$$;

reset role;
do $$
begin
  -- Mapping is read-time only: the migration rewrote no stored row.
  if exists (select 1 from cadence_advisor_private.daily_brief_preferences
    where user_id = '30600000-0000-4000-8000-000000000003' and use_connected_sources is not null) then
    raise exception 'The migration stored a choice for an existing row.';
  end if;
  perform pg_temp.expect_error($q$update cadence_advisor_private.daily_brief_preferences set enabled = false, include_notes = false where user_id = '30600000-0000-4000-8000-000000000002'$q$, '23514');
  perform pg_temp.expect_error($q$update cadence_advisor_private.daily_brief_preferences set exclude_hevy = null where user_id = '30600000-0000-4000-8000-000000000002'$q$, '23514');
  if has_function_privilege('anon', 'public.save_daily_brief_preferences_v4(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint)', 'EXECUTE')
    or has_function_privilege('service_role', 'cadence_advisor_private.save_daily_brief_preferences_v4(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.save_daily_brief_preferences_v4(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint)', 'EXECUTE')
  then
    raise exception 'v4 save privileges changed.';
  end if;
end;
$$;

rollback;
