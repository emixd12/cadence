-- Effective Where guess column (migration 20261125150000, Ticket 357). Local-only
-- rollback fixture. Covers: the column exists, is nullable with no default, accepts only
-- the four coarse values, keeps the owner-only read, gives authenticated no write, and the
-- unchanged upsert leaves it null.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('35700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'where-guess-a@example.invalid', '{}', '{}'),
  ('35700000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'where-guess-b@example.invalid', '{}', '{}');

create function pg_temp.configuration(offset_minutes integer)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'category_id', null, 'location_text', null, 'where_kind', null, 'schedule_graph', '[]'::jsonb,
    'browser_reminder_enabled', true, 'email_reminder_enabled', false, 'reminder_offset_minutes', offset_minutes,
    'active', true, 'timezone', 'America/New_York', 'end', null, 'pause', null, 'is_opportunity', true);
$$;

create function pg_temp.plan(kind text, previous jsonb, next jsonb, fields text[], reason text)
returns jsonb
language sql
as $$
  select jsonb_build_object('event_kind', kind, 'previous_configuration', previous, 'next_configuration', next,
    'changed_fields', to_jsonb(fields), 'recorded_at', clock_timestamp(), 'effective_at', clock_timestamp(),
    'effective_local_date', (clock_timestamp() at time zone 'America/New_York')::date,
    'timezone', 'America/New_York', 'source', 'manual', 'reason_code', reason);
$$;

-- An unscheduled opportunity Behavior keeps the fixture free of schedule graphs.
create function pg_temp.behavior_payload(title text, offset_minutes integer)
returns jsonb
language sql
as $$
  select jsonb_build_object('category_id', null, 'title', title, 'description', null,
    'recurrence_rule', 'null'::jsonb, 'scheduled_time', null,
    'timezone', 'America/New_York', 'browser_reminder_enabled', true, 'email_reminder_enabled', false,
    'reminder_offset_minutes', offset_minutes, 'active', true, 'archived_at', null, 'archive_notes', '[]'::jsonb,
    'default_duration_minutes', null, 'auto_archived_at', null, 'is_opportunity', true,
    'created_at', '2026-11-01T12:00:00Z');
$$;

create function pg_temp.definition_plan(title text)
returns jsonb
language sql
as $$
  select jsonb_build_object('previous_title', null, 'next_title', title, 'previous_description', null,
    'next_description', null, 'changed_fields', jsonb_build_array('title'), 'recorded_at', '2026-11-01T12:00:00Z',
    'source', 'manual', 'reason', null);
$$;

create function pg_temp.create_behavior(title text, extra jsonb)
returns uuid
language sql
as $$
  select (public.create_behavior_with_schedule_graph(
    pg_temp.behavior_payload(title, 0) || extra,
    pg_temp.definition_plan(title),
    pg_temp.plan('baseline', null, pg_temp.configuration(0),
      array['category_id', 'location_text', 'where_kind', 'schedule_graph', 'browser_reminder_enabled',
        'email_reminder_enabled', 'reminder_offset_minutes', 'active', 'timezone', 'end', 'pause', 'is_opportunity'],
      'behavior_created'),
    '[]'::jsonb) ->> 'id')::uuid;
$$;

grant execute on function pg_temp.configuration(integer) to authenticated;
grant execute on function pg_temp.plan(text, jsonb, jsonb, text[], text) to authenticated;
grant execute on function pg_temp.behavior_payload(text, integer) to authenticated;
grant execute on function pg_temp.definition_plan(text) to authenticated;
grant execute on function pg_temp.create_behavior(text, jsonb) to authenticated;

create temporary table where_guess_fixture (behavior_id uuid) on commit drop;
grant select, insert on where_guess_fixture to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'behavior_advisor_estimates' and column_name = 'where_guess'
      and is_nullable = 'YES' and column_default is null and data_type = 'text') then
    raise exception 'where_guess is missing, not nullable, typed wrongly or has a default.';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"35700000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '35700000-0000-4000-8000-000000000001', true);
insert into where_guess_fixture select pg_temp.create_behavior('Red light helmet', '{}');

-- authenticated may read its own rows but never write the column directly.
do $$
begin
  begin
    insert into public.behavior_advisor_estimates (user_id, behavior_id, input_hash, where_guess)
    select '35700000-0000-4000-8000-000000000001', behavior_id, repeat('a', 64), 'home' from where_guess_fixture;
    raise exception 'authenticated wrote an estimate row directly.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

-- The check accepts the four coarse values and null, and nothing else.
do $$
declare
  value text;
begin
  foreach value in array array['home', 'anywhere', 'elsewhere', 'unknown', null] loop
    delete from public.behavior_advisor_estimates where user_id = '35700000-0000-4000-8000-000000000001';
    insert into public.behavior_advisor_estimates (user_id, behavior_id, input_hash, where_guess)
    select '35700000-0000-4000-8000-000000000001', behavior_id, repeat('a', 64), value from where_guess_fixture;
  end loop;
  foreach value in array array['place', 'Home', 'the gym', 'saved_place:' || repeat('k', 43), '40.7,-74.0', ''] loop
    begin
      update public.behavior_advisor_estimates set where_guess = value where user_id = '35700000-0000-4000-8000-000000000001';
      raise exception 'where_guess accepted %.', value;
    exception when check_violation then null;
    end;
  end loop;
  update public.behavior_advisor_estimates set where_guess = 'home' where user_id = '35700000-0000-4000-8000-000000000001';
end;
$$;

-- Owner-only read.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"35700000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '35700000-0000-4000-8000-000000000002', true);
do $$
begin
  if exists (select 1 from public.behavior_advisor_estimates) then
    raise exception 'Another account read an estimate row.';
  end if;
end;
$$;
select set_config('request.jwt.claims', '{"sub":"35700000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '35700000-0000-4000-8000-000000000001', true);
do $$
begin
  if (select where_guess from public.behavior_advisor_estimates) is distinct from 'home' then
    raise exception 'The owner could not read its guess.';
  end if;
end;
$$;
reset role;

-- A row written without a guess has none, and the estimate upsert does not name the column yet.
do $$
begin
  delete from public.behavior_advisor_estimates where user_id = '35700000-0000-4000-8000-000000000001';
  insert into public.behavior_advisor_estimates (user_id, behavior_id, input_hash, duration_minutes, alongside)
  select '35700000-0000-4000-8000-000000000001', behavior_id, repeat('b', 64), 10, true from where_guess_fixture;
  if (select where_guess from public.behavior_advisor_estimates where user_id = '35700000-0000-4000-8000-000000000001') is not null then
    raise exception 'A row written without a guess has one.';
  end if;
  if position('where_guess' in pg_get_functiondef('public.upsert_behavior_advisor_estimates(jsonb)'::regprocedure)) > 0 then
    raise exception 'The estimate upsert writes where_guess before Ticket 359.';
  end if;
end;
$$;

rollback;
