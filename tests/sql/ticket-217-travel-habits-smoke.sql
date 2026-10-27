-- Local-only: psql -X -v ON_ERROR_STOP=1 against a disposable local stack < tests/sql/ticket-217-travel-habits-smoke.sql
-- Ticket 217: learned travel habits keep owner RLS, bounded canonical entries and a separate habit revision.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
select ('21700000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'travel-habits-' || i || '@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
from generate_series(1, 2) i;

do $$ begin
  if exists (select 1 from public.travel_settings
      where user_id = '21700000-0000-4000-8000-000000000001'
        and (habits_updated_at is not null or place_modes <> '[]'::jsonb or leave_feedback <> '[]'::jsonb
          or preparation_minutes is not null or arrival_buffer_minutes is not null)) then
    raise exception 'A new profile started with learned habits';
  end if;
end $$;

set local role authenticated;
do $$
declare
  place text := repeat('A', 43);
  changed integer;
  updated timestamptz;
begin
  perform set_config('request.jwt.claim.sub', '21700000-0000-4000-8000-000000000001', true);
  select updated_at into updated from public.travel_settings;
  update public.travel_settings set
    preparation_minutes = 15,
    arrival_buffer_minutes = 10,
    place_modes = jsonb_build_array(jsonb_build_object('place_key', place, 'mode', 'transit', 'chosen_at', '2026-10-22T15:00:00.000000Z')),
    leave_feedback = jsonb_build_array(jsonb_build_object('event_ref', repeat('a', 64), 'local_date', '2026-10-22',
      'answer', 'too_late', 'answered_at', '2026-10-22T15:00:00.000000Z', 'rules_version', 'travel-habit-defaults@1')),
    habits_updated_at = '2026-10-22T15:00:00.000000Z'
  where habits_updated_at is null;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'The owner could not save learned habits'; end if;
  if (select updated_at from public.travel_settings) <> updated then
    raise exception 'A habit write changed the settings revision';
  end if;

  -- Each invalid value fails its own check and leaves the row unchanged.
  begin
    update public.travel_settings set place_modes = jsonb_build_array(jsonb_build_object('place_key', '1 Gym Street', 'mode', 'walking', 'chosen_at', '2026-10-22T15:00:00.000000Z'));
    raise exception 'Place text was accepted as a place key';
  exception when check_violation then null;
  end;
  begin
    update public.travel_settings set place_modes = jsonb_build_array(
      jsonb_build_object('place_key', repeat('B', 43), 'mode', 'walking', 'chosen_at', '2026-10-22T15:00:00.000000Z'),
      jsonb_build_object('place_key', place, 'mode', 'walking', 'chosen_at', '2026-10-22T15:00:00.000000Z'));
    raise exception 'Unordered places were accepted';
  exception when check_violation then null;
  end;
  begin
    update public.travel_settings set place_modes = jsonb_build_array(jsonb_build_object('place_key', place, 'mode', 'walking',
      'chosen_at', '2026-10-22T15:00:00.000000Z', 'location_text', '1 Gym Street'));
    raise exception 'A place entry with location text was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.travel_settings set leave_feedback = leave_feedback || jsonb_build_array(jsonb_build_object('event_ref', repeat('b', 64),
      'local_date', '2026-10-22', 'answer', 'too_early', 'answered_at', '2026-10-22T16:00:00.000000Z', 'rules_version', 'travel-habit-defaults@1'));
    raise exception 'A second answer on one local date was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.travel_settings set leave_feedback = (select jsonb_agg(jsonb_build_object('event_ref', repeat('c', 64),
      'local_date', to_char(date '2026-01-01' + day, 'YYYY-MM-DD'), 'answer', 'about_right',
      'answered_at', '2026-10-22T15:00:00.000000Z', 'rules_version', 'travel-habit-defaults@1') order by day) from generate_series(0, 30) day);
    raise exception 'More than thirty answers were accepted';
  exception when check_violation then null;
  end;
  begin
    update public.travel_settings set leave_feedback = jsonb_build_array(jsonb_build_object('event_ref', repeat('a', 64),
      'local_date', '2026-10-22', 'answer', 'too_late', 'answered_at', '2026-10-22T15:00:00Z', 'rules_version', 'travel-habit-defaults@1'));
    raise exception 'A non-canonical answer time was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.travel_settings set arrival_buffer_minutes = 35;
    raise exception 'An arrival buffer above 30 minutes was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.travel_settings set preparation_minutes = 61;
    raise exception 'A get-ready time above 60 minutes was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.travel_settings set habits_updated_at = null;
    raise exception 'Learned habits were accepted without a revision';
  exception when check_violation then null;
  end;

  -- The synchronized profile carries the habits as five additional keys.
  if (select count(*) from jsonb_object_keys((select entity -> 'value' from jsonb_array_elements(public.read_account_sync_snapshot(2) -> 'entities') entity
      where entity ->> 'kind' = 'profile'))) <> 13 then
    raise exception 'The synchronized profile does not have 13 keys';
  end if;
  if (select entity #> '{value,travel_place_modes,0,mode}' from jsonb_array_elements(public.read_account_sync_snapshot(2) -> 'entities') entity
      where entity ->> 'kind' = 'profile') <> '"transit"'::jsonb then
    raise exception 'The synchronized profile lost the remembered mode';
  end if;

  -- Another account can neither read nor change these habits.
  perform set_config('request.jwt.claim.sub', '21700000-0000-4000-8000-000000000002', true);
  if exists (select 1 from public.travel_settings where user_id = '21700000-0000-4000-8000-000000000001') then
    raise exception 'Another account read learned habits';
  end if;
  update public.travel_settings set preparation_minutes = 0, habits_updated_at = statement_timestamp()
  where user_id = '21700000-0000-4000-8000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Another account changed learned habits'; end if;
end $$;
reset role;

do $$ begin
  if (select preparation_minutes from public.travel_settings where user_id = '21700000-0000-4000-8000-000000000001') <> 15 then
    raise exception 'The owner habit row changed unexpectedly';
  end if;
end $$;

rollback;
