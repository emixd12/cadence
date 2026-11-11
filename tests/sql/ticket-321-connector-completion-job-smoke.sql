\set ON_ERROR_STOP on

-- Ticket 321: the background job's account selection and token channel. The service
-- role reads only user_id, source and next_check_at. The job's own channel may write
-- connector completions; the leave reminder and MCP channels may not. Synthetic local
-- fixtures only; every change rolls back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('32100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'job-a@example.invalid', '{}', '{}');
insert into public.profiles (id, email, timezone) values
  ('32100000-0000-4000-8000-000000000001', 'job-a@example.invalid', 'America/New_York')
on conflict (id) do update set timezone = excluded.timezone;
insert into public.connector_completion_state (user_id, source, next_check_at, read_cursor, consecutive_failures) values
  ('32100000-0000-4000-8000-000000000001', 'hevy', now() - interval '1 minute', 'cursor', 2);

do $$
begin
  if not has_column_privilege('service_role', 'public.connector_completion_state', 'next_check_at', 'SELECT')
    or not has_column_privilege('service_role', 'public.connector_completion_state', 'user_id', 'SELECT')
    or has_column_privilege('service_role', 'public.connector_completion_state', 'read_cursor', 'SELECT')
    or has_column_privilege('service_role', 'public.connector_completion_state', 'consecutive_failures', 'SELECT')
    or has_table_privilege('service_role', 'public.connector_completion_state', 'UPDATE')
    or has_table_privilege('service_role', 'public.occurrence_source_matches', 'SELECT')
    or has_table_privilege('service_role', 'public.behavior_source_links', 'SELECT') then
    raise exception 'Service-role privileges are wider than the account selection';
  end if;
end $$;

set local role service_role;
do $$
declare due integer;
begin
  select count(*) into due from public.connector_completion_state where next_check_at <= now();
  if due < 1 then raise exception 'Due account not selected'; end if;
  begin
    perform read_cursor from public.connector_completion_state limit 1;
    raise exception 'Service role read the cursor';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
-- The job's channel passes the connector caller check.
select set_config('request.jwt.claims', json_build_object('sub', '32100000-0000-4000-8000-000000000001', 'role', 'authenticated',
  'cadence_channel', 'connector_completion')::text, true);
do $$
declare result jsonb;
begin
  result := public.remove_source_match('32100000-0000-4000-8000-0000000000ff', now());
  if result ->> 'reason' <> 'match_unavailable' then raise exception 'Job channel refused: %', result; end if;
  update public.connector_completion_state set next_check_at = now() + interval '1 hour', check_count = 1,
    check_count_date = (now() at time zone 'America/New_York')::date;
end $$;
-- The leave reminder channel does not.
select set_config('request.jwt.claims', json_build_object('sub', '32100000-0000-4000-8000-000000000001', 'role', 'authenticated',
  'cadence_channel', 'leave_reminder')::text, true);
do $$
begin
  perform public.remove_source_match('32100000-0000-4000-8000-0000000000ff', now());
  raise exception 'Leave reminder channel wrote a connector change';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
