\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data
)
values
  ('14700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ticket-147-one@example.invalid', '{}', '{}'),
  ('14700000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ticket-147-two@example.invalid', '{}', '{}');

insert into auth.sessions (id, user_id)
values
  ('14700000-0000-4000-8000-000000000011', '14700000-0000-4000-8000-000000000001'),
  ('14700000-0000-4000-8000-000000000012', '14700000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"14700000-0000-4000-8000-000000000001","role":"authenticated","session_id":"14700000-0000-4000-8000-000000000011"}',
  true
);

do $$
declare
  preference jsonb;
  decision jsonb;
  lease uuid;
begin
  preference := public.read_daily_brief_preferences();
  if preference <> '{"enabled":false,"include_calendar":false,"include_reminder_history":false,"include_notes":false,"revision":0,"calendar_connection_generation":null,"calendar_selection_revision":null}'::jsonb then
    raise exception 'Daily Brief defaults changed: %', preference;
  end if;

  preference := public.save_daily_brief_preferences(true, false, 0);
  if preference ->> 'revision' <> '1' then
    raise exception 'Daily Brief revision did not advance.';
  end if;

  decision := public.begin_daily_brief(
    '14700000-0000-4000-8000-000000000101',
    false,
    1
  );
  if decision ->> 'state' <> 'acquired' then
    raise exception 'Initial Daily Brief attempt was not acquired: %', decision;
  end if;
  lease := (decision ->> 'lease_token')::uuid;

  decision := public.begin_daily_brief(
    '14700000-0000-4000-8000-000000000101',
    false,
    1
  );
  if decision ->> 'state' <> 'pending' then
    raise exception 'Duplicate in-flight attempt was not pending: %', decision;
  end if;

  decision := public.begin_daily_brief(
    '14700000-0000-4000-8000-000000000102',
    false,
    1
  );
  if decision ->> 'state' <> 'pending' then
    raise exception 'Account-wide in-flight attempt was not blocked: %', decision;
  end if;

  if not public.finish_daily_brief(
    '14700000-0000-4000-8000-000000000101',
    lease,
    false,
    1
  ) then
    raise exception 'Failed Daily Brief attempt was not recorded.';
  end if;

  decision := public.begin_daily_brief(
    '14700000-0000-4000-8000-000000000101',
    false,
    1
  );
  if decision ->> 'state' <> 'already_attempted' then
    raise exception 'Automatic retry loop was allowed: %', decision;
  end if;

  decision := public.begin_daily_brief(
    '14700000-0000-4000-8000-000000000101',
    true,
    1
  );
  if decision ->> 'state' <> 'acquired' then
    raise exception 'Explicit retry was not acquired: %', decision;
  end if;
  lease := (decision ->> 'lease_token')::uuid;

  if not public.finish_daily_brief(
    '14700000-0000-4000-8000-000000000101',
    lease,
    true,
    1
  ) then
    raise exception 'Successful Daily Brief attempt was not recorded.';
  end if;

  decision := public.begin_daily_brief(
    '14700000-0000-4000-8000-000000000101',
    false,
    1
  );
  if decision ->> 'state' <> 'already_attempted' then
    raise exception 'Completed Daily Brief attempt retried automatically: %', decision;
  end if;

  if not public.finish_daily_brief(
    '14700000-0000-4000-8000-000000000101',
    lease,
    false,
    1
  ) then
    raise exception 'Final fence failure could not downgrade the completed attempt.';
  end if;

  decision := public.begin_daily_brief(
    '14700000-0000-4000-8000-000000000101',
    false,
    1
  );
  if decision ->> 'state' <> 'already_attempted' then
    raise exception 'Downgraded attempt caused an automatic retry: %', decision;
  end if;

  decision := public.begin_daily_brief(
    '14700000-0000-4000-8000-000000000101',
    true,
    1
  );
  if decision ->> 'state' <> 'acquired' then
    raise exception 'Downgraded attempt did not allow explicit retry: %', decision;
  end if;
  lease := (decision ->> 'lease_token')::uuid;
  if not public.finish_daily_brief(
    '14700000-0000-4000-8000-000000000101',
    lease,
    true,
    1
  ) then
    raise exception 'Retried Daily Brief attempt did not finish.';
  end if;

  -- Completed but undelivered attempts can retry, within four admissions.
  decision := public.begin_daily_brief('14700000-0000-4000-8000-000000000101', true, 1);
  if decision ->> 'state' <> 'acquired' then
    raise exception 'Fourth admission was denied: %', decision;
  end if;
  perform public.finish_daily_brief('14700000-0000-4000-8000-000000000101',
    (decision ->> 'lease_token')::uuid, true, 1);
  decision := public.begin_daily_brief('14700000-0000-4000-8000-000000000101', true, 1);
  if decision ->> 'state' <> 'retry_exhausted' then
    raise exception 'Fifth admission was allowed: %', decision;
  end if;

  begin
    perform public.save_daily_brief_preferences(true, false, 0);
    raise exception 'Stale Daily Brief revision was accepted.';
  exception when sqlstate '40001' then
    null;
  end;

  begin
    perform public.save_daily_brief_preferences(false, true, 1);
    raise exception 'Calendar disclosure remained enabled while Daily Brief was disabled.';
  exception when sqlstate '22023' then
    null;
  end;

  perform public.save_daily_brief_preferences(true, false, 1);
end;
$$;

reset role;

insert into public.google_calendar_connections (
  user_id, google_subject, generation, status
)
values (
  '14700000-0000-4000-8000-000000000001', 'ticket-147-calendar', 7, 'connected'
);
insert into public.google_calendar_preferences (user_id)
values ('14700000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"14700000-0000-4000-8000-000000000001","role":"authenticated","session_id":"14700000-0000-4000-8000-000000000011"}',
  true
);

do $$
declare
  preference jsonb;
begin
  preference := public.save_daily_brief_preferences(true, true, 2);
  if preference ->> 'calendar_connection_generation' <> '7'
    or preference ->> 'calendar_selection_revision' <> '0' then
    raise exception 'Calendar disclosure fence was not captured: %', preference;
  end if;
end;
$$;

update public.google_calendar_preferences
set selected_calendar_ids = array['changed-selection']
where user_id = '14700000-0000-4000-8000-000000000001';

do $$
begin
  begin
    perform public.begin_daily_brief(
      '14700000-0000-4000-8000-000000000201',
      false,
      3
    );
    raise exception 'Stale Calendar disclosure fence was accepted.';
  exception when sqlstate '40001' then
    null;
  end;
  perform public.save_daily_brief_preferences(true, false, 3);
end;
$$;

reset role;
delete from cadence_advisor_private.daily_brief_runs
where user_id = '14700000-0000-4000-8000-000000000001';
delete from cadence_advisor_private.daily_brief_rate_limits
where user_id = '14700000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"14700000-0000-4000-8000-000000000001","role":"authenticated","session_id":"14700000-0000-4000-8000-000000000011"}',
  true
);

do $$
declare
  client_number integer;
  installation uuid;
  decision jsonb;
begin
  for client_number in 1..6 loop
    installation := ('14710000-0000-4000-8000-' || lpad(client_number::text, 12, '0'))::uuid;
    decision := public.begin_daily_brief(installation, false, 4);
    if decision ->> 'state' <> 'acquired' then
      raise exception 'Allowed start % was denied: %', client_number, decision;
    end if;
    if not public.finish_daily_brief(
      installation,
      (decision ->> 'lease_token')::uuid,
      false,
      4
    ) then
      raise exception 'Allowed start % could not finish.', client_number;
    end if;
  end loop;

  decision := public.begin_daily_brief(
    '14710000-0000-4000-8000-000000000007',
    false,
    4
  );
  if decision ->> 'state' <> 'rate_limited'
    or (decision ->> 'retry_after_seconds')::integer not between 1 and 60 then
    raise exception 'Account-wide six-start limit failed: %', decision;
  end if;
end;
$$;

reset role;
delete from cadence_advisor_private.daily_brief_runs
where user_id = '14700000-0000-4000-8000-000000000001';
delete from cadence_advisor_private.daily_brief_rate_limits
where user_id = '14700000-0000-4000-8000-000000000001';
insert into cadence_advisor_private.daily_brief_runs (
  user_id,
  installation_id,
  local_date,
  timezone,
  preference_revision,
  status,
  lease_token,
  started_at,
  finished_at
)
select
  '14700000-0000-4000-8000-000000000001',
  ('14720000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid,
  current_date,
  'America/New_York',
  4,
  'completed',
  gen_random_uuid(),
  statement_timestamp() - make_interval(mins => 20 - item),
  statement_timestamp() - make_interval(mins => 19 - item)
from generate_series(1, 8) as item;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"14700000-0000-4000-8000-000000000001","role":"authenticated","session_id":"14700000-0000-4000-8000-000000000011"}',
  true
);

do $$
declare
  decision jsonb;
begin
  decision := public.begin_daily_brief(
    '14720000-0000-4000-8000-000000000009',
    true,
    4
  );
  if decision ->> 'state' <> 'acquired' then
    raise exception 'Ninth installation was not acquired after bounded eviction: %', decision;
  end if;
end;
$$;

reset role;
do $$
begin
  if (
    select count(*)
    from cadence_advisor_private.daily_brief_runs
    where user_id = '14700000-0000-4000-8000-000000000001'
  ) <> 8 then
    raise exception 'Daily Brief installation metadata exceeded eight rows.';
  end if;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"14700000-0000-4000-8000-000000000001","role":"authenticated","session_id":"14700000-0000-4000-8000-000000000011"}',
  true
);
select public.save_daily_brief_preferences(false, false, 4);

reset role;
do $$
begin
  if exists (
    select 1
    from cadence_advisor_private.daily_brief_runs
    where user_id = '14700000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Disablement retained Daily Brief attempts.';
  end if;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"14700000-0000-4000-8000-000000000002","role":"authenticated","session_id":"14700000-0000-4000-8000-000000000012"}',
  true
);

do $$
declare
  preference jsonb;
begin
  preference := public.read_daily_brief_preferences();
  if preference ->> 'revision' <> '0' or (preference ->> 'enabled')::boolean then
    raise exception 'Second owner inherited first-owner preferences: %', preference;
  end if;
  if has_table_privilege('authenticated', 'cadence_advisor_private.daily_brief_runs', 'SELECT')
    or has_table_privilege('authenticated', 'cadence_advisor_private.daily_brief_preferences', 'UPDATE')
    or has_function_privilege('anon', 'public.begin_daily_brief(uuid,boolean,bigint)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.begin_daily_brief(uuid,boolean,bigint)', 'EXECUTE') then
    raise exception 'Daily Brief privileges are broader than intended.';
  end if;
end;
$$;

-- Optional disclosures, revision fencing and lease-bound tip metadata.
do $$
declare
  payload jsonb;
  revision jsonb;
  decision jsonb;
  today date := (statement_timestamp() at time zone 'America/New_York')::date;
  installation uuid := '14700000-0000-4000-8000-000000000301';
begin
  payload := public.read_advisor_analysis_snapshot(today, today - 90, '{}'::uuid[], true, true, false);
  if payload ->> 'notes' <> 'not_permitted' or payload ->> 'reminders' <> 'not_permitted' then
    raise exception 'Undisclosed sources were allowed.';
  end if;
  perform public.save_daily_brief_preferences_v2(true, false, true, true, 0);
  payload := public.read_advisor_analysis_snapshot(today, today - 90, '{}'::uuid[], true, true, false);
  revision := public.read_advisor_analysis_snapshot(today, today - 90, '{}'::uuid[], true, true, true);
  if payload -> 'notes' <> '[]'::jsonb or payload -> 'reminders' <> '[]'::jsonb
    or payload ->> 'revision' <> revision ->> 'revision' then
    raise exception 'Disclosed snapshot or revision failed.';
  end if;
  decision := public.begin_daily_brief(installation, false, 1);
  if public.record_daily_brief_tip(installation, (decision ->> 'lease_token')::uuid, 1, repeat('a', 64)) then
    raise exception 'Pending attempt recorded a tip.';
  end if;
  perform public.finish_daily_brief(installation, (decision ->> 'lease_token')::uuid, true, 1);
  if not public.record_daily_brief_tip(installation, (decision ->> 'lease_token')::uuid, 1, repeat('a', 64))
    or jsonb_array_length(public.read_daily_brief_tip_history()) <> 1 then
    raise exception 'Completed attempt did not record its tip.';
  end if;
  payload := public.save_daily_brief_preferences(true, false, 1);
  if (payload ->> 'include_notes')::boolean or (payload ->> 'include_reminder_history')::boolean then
    raise exception 'Older client retained optional disclosure.';
  end if;
  perform public.save_daily_brief_preferences(false, false, 2);
  if public.read_daily_brief_tip_history() <> '[]'::jsonb then
    raise exception 'Disablement retained tip metadata.';
  end if;
  if has_table_privilege('authenticated', 'cadence_advisor_private.daily_brief_tip_deliveries', 'SELECT')
    or has_function_privilege('anon', 'public.read_daily_brief_tip_history()', 'EXECUTE') then
    raise exception 'Tip metadata privileges are too broad.';
  end if;
end;
$$;

reset role;
delete from auth.sessions
where id = '14700000-0000-4000-8000-000000000012';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"14700000-0000-4000-8000-000000000002","role":"authenticated","session_id":"14700000-0000-4000-8000-000000000012"}',
  true
);

do $$
begin
  begin
    perform public.read_daily_brief_preferences();
    raise exception 'Revoked session retained Daily Brief access.';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;

reset role;
update auth.sessions set not_after = clock_timestamp() - interval '1 second'
where id = '14700000-0000-4000-8000-000000000011';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14700000-0000-4000-8000-000000000001","role":"authenticated","session_id":"14700000-0000-4000-8000-000000000011"}', true);
do $$
begin
  begin
    perform public.read_daily_brief_preferences();
    raise exception 'Expired session retained Daily Brief access.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
