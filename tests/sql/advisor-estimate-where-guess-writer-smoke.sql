-- Where guess writer (migration 20261125190000, Ticket 359). Local-only rollback
-- fixture. Covers: the Daily Brief agent stores a coarse guess, an item without one (the
-- flag-off call) stores null and so clears a guess from an earlier input hash, a value
-- outside the four coarse ones stores null, the other columns are written as before, and
-- a person still cannot call the function.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('35900000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'where-guess-writer@example.invalid', '{}', '{}');

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

create temporary table where_guess_writer_fixture (behavior_id uuid) on commit drop;
grant select, insert on where_guess_writer_fixture to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"35900000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '35900000-0000-4000-8000-000000000001', true);
insert into where_guess_writer_fixture select pg_temp.create_behavior('Red light helmet', '{}');

do $$
declare
  behavior uuid := (select behavior_id from where_guess_writer_fixture);
  row_written public.behavior_advisor_estimates;
begin
  -- A person cannot write the cache.
  begin
    perform public.upsert_behavior_advisor_estimates('[]'::jsonb);
    raise exception 'A person wrote the estimate cache.';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', '{"sub":"35900000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"daily_brief"}', true);

  -- Recipe 1.3: the guess is stored with the rest of the estimate.
  if public.upsert_behavior_advisor_estimates(jsonb_build_array(jsonb_build_object(
      'behavior_id', behavior, 'input_hash', repeat('a', 64), 'duration_minutes', 10, 'alongside', true,
      'model', 'daily_brief', 'where_guess', 'home'))) <> 1 then
    raise exception 'The estimate with a guess was not written.';
  end if;
  select * into row_written from public.behavior_advisor_estimates where behavior_id = behavior;
  if row_written.where_guess is distinct from 'home' or row_written.duration_minutes <> 10 or row_written.alongside is not true
      or row_written.input_hash <> repeat('a', 64) or row_written.model <> 'daily_brief' then
    raise exception 'The estimate row is wrong: %', to_jsonb(row_written);
  end if;

  -- Recipe 1.2 (flag off) sends no where_guess key: a new hash clears the old guess.
  perform public.upsert_behavior_advisor_estimates(jsonb_build_array(jsonb_build_object(
    'behavior_id', behavior, 'input_hash', repeat('b', 64), 'duration_minutes', 12, 'alongside', false, 'model', 'daily_brief')));
  select * into row_written from public.behavior_advisor_estimates where behavior_id = behavior;
  if row_written.where_guess is not null or row_written.input_hash <> repeat('b', 64) or row_written.duration_minutes <> 12
      or row_written.alongside is not false then
    raise exception 'A stale guess survived a new input hash: %', to_jsonb(row_written);
  end if;

  -- Each allowed value is stored; anything else stores null rather than a place.
  perform public.upsert_behavior_advisor_estimates(jsonb_build_array(jsonb_build_object(
    'behavior_id', behavior, 'input_hash', repeat('c', 64), 'duration_minutes', null, 'alongside', false, 'where_guess', 'elsewhere')));
  if (select where_guess from public.behavior_advisor_estimates where behavior_id = behavior) is distinct from 'elsewhere' then
    raise exception 'elsewhere was not stored.';
  end if;
  perform public.upsert_behavior_advisor_estimates(jsonb_build_array(jsonb_build_object(
    'behavior_id', behavior, 'input_hash', repeat('d', 64), 'alongside', false, 'where_guess', 'the gym')));
  if (select where_guess from public.behavior_advisor_estimates where behavior_id = behavior) is not null then
    raise exception 'A place name was stored as a guess.';
  end if;
  perform public.upsert_behavior_advisor_estimates(jsonb_build_array(jsonb_build_object(
    'behavior_id', behavior, 'input_hash', repeat('e', 64), 'alongside', false, 'where_guess', null)));
  if (select where_guess from public.behavior_advisor_estimates where behavior_id = behavior) is not null then
    raise exception 'A null guess was not stored as null.';
  end if;
end;
$$;

reset role;

rollback;
