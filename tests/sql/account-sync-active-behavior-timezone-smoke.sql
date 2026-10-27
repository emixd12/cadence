-- Local-only: psql "postgresql://postgres:postgres@127.0.0.1:<db-port>/postgres" -X -v ON_ERROR_STOP=1 -f tests/sql/account-sync-active-behavior-timezone-smoke.sql
-- A synced profile timezone change moves only active Behaviors. Archived Behaviors
-- keep their historical timezone (docs/DATETIME_STRATEGY.md). Each accepted plan is
-- the exact hosted diff of the web Settings RPC, which moves only active Behaviors,
-- applied through the real RPC as contract 1 (published 0.1.5) and contract 2.
-- Before 20261027221625 the server required a write for archived Behaviors too and
-- rejected these plans (0.1.6 release known issue F1). Everything rolls back.
\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
select ('f1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'sync-timezone-' || i || '@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
from generate_series(1, 6) i;

create table pg_temp.ids (name text primary key, id uuid not null);
create table pg_temp.cases (
  ordinal integer primary key,
  name text not null,
  owner uuid not null,
  request jsonb not null,
  merged_fingerprint text not null,
  expected_error text
);
grant select on pg_temp.cases to authenticated;

create function pg_temp.user_id(i integer)
returns uuid language sql immutable as $$
  select ('f1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid
$$;

create function pg_temp.id(fixture_name text)
returns uuid language sql stable as $$
  select id from pg_temp.ids where name = fixture_name
$$;

create function pg_temp.create_behavior(owner uuid, title text, zone text)
returns uuid
language plpgsql
as $$
declare
  recorded_at timestamptz := clock_timestamp();
  graph jsonb := jsonb_build_array(jsonb_build_object(
    'id', null, 'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1), 'sort_order', 0,
    'time_entries', jsonb_build_array(jsonb_build_object('id', null, 'kind', 'exact', 'preset', null,
      'start_time', '09:00:00', 'end_time', null, 'sort_order', 0))));
  snapshot jsonb := jsonb_build_object('category_id', null, 'location_text', null, 'where_kind', 'home',
    'schedule_graph', graph #- '{0,id}' #- '{0,time_entries,0,id}', 'browser_reminder_enabled', true,
    'email_reminder_enabled', false, 'reminder_offset_minutes', 0, 'active', true, 'timezone', zone);
begin
  perform set_config('request.jwt.claim.sub', owner::text, true);
  return (public.create_behavior_with_schedule_graph(
    jsonb_build_object('category_id', null, 'title', title, 'description', null,
      'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
      'scheduled_time', '09:00:00', 'timezone', zone, 'browser_reminder_enabled', true,
      'email_reminder_enabled', false, 'reminder_offset_minutes', 0, 'active', true, 'archived_at', null,
      'archive_notes', '[]'::jsonb, 'default_duration_minutes', null, 'end_date', null,
      'auto_archived_at', null, 'location_text', null, 'where_kind', 'home', 'created_at', recorded_at),
    jsonb_build_object('previous_title', null, 'next_title', title, 'previous_description', null,
      'next_description', null, 'changed_fields', jsonb_build_array('title'),
      'recorded_at', recorded_at, 'source', 'manual', 'reason', null),
    jsonb_build_object('event_kind', 'baseline', 'previous_configuration', null, 'next_configuration', snapshot,
      'changed_fields', '["category_id","location_text","where_kind","schedule_graph","browser_reminder_enabled","email_reminder_enabled","reminder_offset_minutes","active","timezone"]'::jsonb,
      'recorded_at', recorded_at, 'effective_at', recorded_at,
      'effective_local_date', (recorded_at at time zone zone)::date,
      'timezone', zone, 'source', 'manual', 'reason_code', 'behavior_created'),
    graph) ->> 'id')::uuid;
end;
$$;

create function pg_temp.configuration_plan(previous jsonb, next jsonb, recorded_at timestamptz, reason text)
returns jsonb language sql stable as $$
  select jsonb_build_object('event_kind', 'revision', 'previous_configuration', previous,
    'next_configuration', next,
    'changed_fields', to_jsonb(cadence_private.behavior_configuration_changed_fields(previous, next)),
    'recorded_at', recorded_at, 'effective_at', recorded_at,
    'effective_local_date', (recorded_at at time zone (next ->> 'timezone'))::date,
    'timezone', next ->> 'timezone', 'source', 'manual', 'reason_code', reason)
$$;

-- The same Behavior row and configuration-history writes as a manual archive.
create function pg_temp.archive_behavior(owner uuid, behavior uuid)
returns void
language plpgsql
as $$
declare
  recorded_at timestamptz := clock_timestamp();
  previous jsonb;
begin
  perform set_config('request.jwt.claim.sub', owner::text, true);
  previous := cadence_private.current_behavior_configuration_snapshot(owner, behavior);
  update public.behaviors set active = false, archived_at = recorded_at
  where user_id = owner and id = behavior;
  perform cadence_private.insert_behavior_configuration_event(owner, behavior, previous,
    cadence_private.current_behavior_configuration_snapshot(owner, behavior),
    pg_temp.configuration_plan(previous,
      cadence_private.current_behavior_configuration_snapshot(owner, behavior), recorded_at, 'behavior_archived'));
end;
$$;

-- Settings timezone change through the web RPC: every active Behavior, no others.
create function pg_temp.change_timezone(owner uuid, target text)
returns void
language plpgsql
as $$
declare
  recorded_at timestamptz := clock_timestamp();
  changes jsonb;
begin
  perform set_config('request.jwt.claim.sub', owner::text, true);
  select coalesce(jsonb_agg(jsonb_build_object(
      'behavior_id', behavior.id,
      'expected_updated_at', behavior.updated_at,
      'configuration_event_plan', case when behavior.timezone = target then null
        else pg_temp.configuration_plan(current.snapshot,
          jsonb_set(current.snapshot, '{timezone}', to_jsonb(target)), recorded_at, 'timezone_changed') end
    )), '[]'::jsonb)
  into changes
  from public.behaviors behavior
  cross join lateral (
    select cadence_private.current_behavior_configuration_snapshot(owner, behavior.id) as snapshot
  ) current
  where behavior.user_id = owner and behavior.active;
  perform public.update_profile_and_behavior_timezones_with_config_events(
    target, (select timezone from public.profiles where id = owner), changes);
end;
$$;

-- Published 0.1.5 reads without a contract; contract 2 uses the integer reader.
create function pg_temp.read_snapshot(contract integer)
returns jsonb language sql stable as $$
  select case when contract is null then public.read_account_sync_snapshot()
    else public.read_account_sync_snapshot(contract) end
$$;

create function pg_temp.sync_request(before_snapshot jsonb, writes jsonb, merged_fingerprint text, key text, contract integer)
returns jsonb language sql immutable as $$
  with plan as (
    select jsonb_build_object('writes', writes, 'mergedFingerprint', merged_fingerprint, 'conflicts', '[]'::jsonb) value
  )
  select jsonb_build_object(
    'schemaVersion', 1, 'idempotencyKey', key,
    'baselineFingerprint', before_snapshot ->> 'fingerprint', 'localFingerprint', before_snapshot ->> 'fingerprint',
    'hostedFingerprint', before_snapshot ->> 'fingerprint',
    'planFingerprint', encode(extensions.digest(convert_to(cadence_private.canonical_account_sync_json(plan.value), 'UTF8'), 'sha256'), 'hex'),
    'plan', plan.value, 'attemptedAt', '2026-10-27T12:00:00.000000Z'
  ) || case when contract is null then '{}'::jsonb else jsonb_build_object('contract', contract) end
  from plan
$$;

-- Runs the client change in a rolled-back subtransaction and records the hosted
-- diff as the sync plan, so every write is one a real client would send.
create function pg_temp.prepare_case(
  ordinal integer, case_name text, owner uuid, contract integer, target text,
  archive_in_plan uuid default null, profile_only boolean default false, expected_error text default null
)
returns void
language plpgsql
as $$
declare
  before_snapshot jsonb;
  after_snapshot jsonb;
  writes jsonb;
begin
  perform set_config('request.jwt.claim.sub', owner::text, true);
  before_snapshot := pg_temp.read_snapshot(contract);
  begin
    if archive_in_plan is not null then
      perform pg_temp.archive_behavior(owner, archive_in_plan);
    end if;
    perform pg_temp.change_timezone(owner, target);
    after_snapshot := pg_temp.read_snapshot(contract);
    raise exception using errcode = 'CS001', message = 'Roll back the client change.';
  exception when sqlstate 'CS001' then null;
  end;
  if (select timezone from public.profiles where id = owner) = target then
    raise exception 'Case "%" did not roll back its client change', case_name;
  end if;
  if exists (
    select 1 from jsonb_array_elements(before_snapshot -> 'entities') b(entity)
    where not exists (
      select 1 from jsonb_array_elements(after_snapshot -> 'entities') a(entity)
      where a.entity ->> 'kind' = b.entity ->> 'kind' and a.entity ->> 'id' = b.entity ->> 'id'
    )
  ) then
    raise exception 'Case "%" removed a hosted row', case_name;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', a.entity ->> 'kind', 'id', a.entity ->> 'id', 'operation', 'upsert',
      'expected', coalesce(b.entity -> 'value', 'null'::jsonb), 'value', a.entity -> 'value'
    ) order by a.entity ->> 'kind', a.entity ->> 'id'), '[]'::jsonb)
  into writes
  from jsonb_array_elements(after_snapshot -> 'entities') a(entity)
  left join jsonb_array_elements(before_snapshot -> 'entities') b(entity)
    on b.entity ->> 'kind' = a.entity ->> 'kind' and b.entity ->> 'id' = a.entity ->> 'id'
  where (not profile_only or a.entity ->> 'kind' = 'profile')
    and b.entity -> 'value' is distinct from a.entity -> 'value';
  insert into pg_temp.cases values (
    ordinal, case_name, owner,
    pg_temp.sync_request(before_snapshot, writes, after_snapshot ->> 'fingerprint', repeat(ordinal::text, 64), contract),
    after_snapshot ->> 'fingerprint', expected_error
  );
end;
$$;

do $$
declare
  owner uuid;
  i integer;
begin
  for i in 1..6 loop
    owner := pg_temp.user_id(i);
    insert into pg_temp.ids values ('active_' || i, pg_temp.create_behavior(owner, 'Active', 'America/New_York'));
    if i in (1, 2, 5, 6) then
      insert into pg_temp.ids values ('archived_' || i, pg_temp.create_behavior(owner, 'Archived', 'America/New_York'));
      perform pg_temp.archive_behavior(owner, pg_temp.id('archived_' || i));
    end if;
  end loop;
  insert into pg_temp.ids values ('archive_in_plan_3',
    pg_temp.create_behavior(pg_temp.user_id(3), 'Archived with the change', 'America/New_York'));
  -- A Behavior created under an earlier profile timezone that already matches the target.
  update public.profiles set timezone = 'Europe/London' where id = pg_temp.user_id(4);
  insert into pg_temp.ids values ('already_moved_4',
    pg_temp.create_behavior(pg_temp.user_id(4), 'Already in London', 'Europe/London'));
  update public.profiles set timezone = 'America/New_York' where id = pg_temp.user_id(4);

  perform pg_temp.prepare_case(1, 'contract 1: an archived Behavior keeps its timezone',
    pg_temp.user_id(1), null, 'Europe/London');
  perform pg_temp.prepare_case(2, 'contract 2: an archived Behavior keeps its timezone',
    pg_temp.user_id(2), 2, 'Europe/London');
  perform pg_temp.prepare_case(3, 'contract 2: archive and timezone change in one plan',
    pg_temp.user_id(3), 2, 'Europe/London', archive_in_plan => pg_temp.id('archive_in_plan_3'));
  perform pg_temp.prepare_case(4, 'contract 2: an active Behavior already in the new timezone',
    pg_temp.user_id(4), 2, 'Europe/London');
  perform pg_temp.prepare_case(5, 'contract 1: an active Behavior without a timezone write',
    pg_temp.user_id(5), null, 'Europe/London', profile_only => true,
    expected_error => 'A profile timezone change requires a timezone write for every active Behavior.');
  perform pg_temp.prepare_case(6, 'contract 2: an active Behavior without a timezone write',
    pg_temp.user_id(6), 2, 'Europe/London', profile_only => true,
    expected_error => 'A profile timezone change requires a timezone write for every active Behavior.');

  if exists (
    select 1
    from pg_temp.cases sync_case
    cross join lateral jsonb_array_elements(sync_case.request #> '{plan,writes}') write
    join pg_temp.ids fixture on fixture.id::text = write ->> 'id'
    where fixture.name like 'archived\_%' or fixture.name = 'already_moved_4'
  ) then
    raise exception 'A client plan wrote a Behavior that Settings leaves unchanged';
  end if;
  if not exists (
    select 1 from pg_temp.cases sync_case
    cross join lateral jsonb_array_elements(sync_case.request #> '{plan,writes}') write
    where sync_case.ordinal = 3 and write ->> 'id' = pg_temp.id('archive_in_plan_3')::text
      and write #> '{value,active}' = 'false'::jsonb
      and write #>> '{value,timezone}' = 'America/New_York'
  ) then
    raise exception 'The archive-in-plan case lacks its archived Behavior write';
  end if;
end;
$$;

set local role authenticated;
do $$
declare
  sync_case record;
  applied jsonb;
begin
  for sync_case in select * from pg_temp.cases order by ordinal loop
    perform set_config('request.jwt.claim.sub', sync_case.owner::text, true);
    if sync_case.expected_error is null then
      begin
        applied := public.apply_account_sync_plan(sync_case.request);
      exception when others then
        raise exception 'Case "%" was rejected: %', sync_case.name, sqlerrm;
      end;
      if applied ->> 'status' <> 'applied' or applied ->> 'fingerprint' <> sync_case.merged_fingerprint then
        raise exception 'Case "%" returned the wrong result', sync_case.name;
      end if;
    else
      begin
        perform public.apply_account_sync_plan(sync_case.request);
        raise exception 'Case "%" was accepted', sync_case.name;
      exception when raise_exception then
        if sqlerrm <> sync_case.expected_error then raise; end if;
      end;
    end if;
  end loop;
end;
$$;
reset role;

do $$
begin
  if exists (
    select 1 from public.profiles
    where id in (pg_temp.user_id(1), pg_temp.user_id(2), pg_temp.user_id(3), pg_temp.user_id(4))
      and timezone <> 'Europe/London'
  ) or exists (
    select 1 from public.profiles
    where id in (pg_temp.user_id(5), pg_temp.user_id(6)) and timezone <> 'America/New_York'
  ) then
    raise exception 'A profile timezone differs from its case result';
  end if;
  if exists (
    select 1 from public.behaviors
    where id in (pg_temp.id('active_1'), pg_temp.id('active_2'), pg_temp.id('active_3'),
        pg_temp.id('active_4'), pg_temp.id('already_moved_4'))
      and (not active or timezone <> 'Europe/London')
  ) then
    raise exception 'An active Behavior did not move to the new timezone';
  end if;
  if exists (
    select 1 from public.behaviors
    where id in (pg_temp.id('archived_1'), pg_temp.id('archived_2'), pg_temp.id('archive_in_plan_3'))
      and (active or timezone <> 'America/New_York')
  ) then
    raise exception 'An archived Behavior lost its historical timezone';
  end if;
  if (select count(*) from public.behavior_configuration_events where behavior_id = pg_temp.id('already_moved_4')) <> 1 then
    raise exception 'A Behavior already in the new timezone received a revision';
  end if;
end;
$$;

rollback;
