-- Ticket 217: learned travel habits, stored with the account.
-- Every value comes from the user: an edit in Travel Settings, a travel mode
-- chosen for a place, or a leave-time answer. No device position, route
-- duration or provider result belongs here.
--
-- Null minutes follow the versioned core defaults (travel-habit-defaults@1).
-- place_modes keys are the Ticket 216 place keys (unpadded base64url SHA-256 of
-- normalized place text, the place-cache text_key); leave_feedback event
-- references are hex SHA-256 digests of an event identity. Neither keeps
-- place text, titles or times. habits_updated_at is null until the first habit
-- change and is the compare-and-set revision for habit writes, separate from
-- updated_at, so a habit change never conflicts with a Settings save.
begin;

create function cadence_private.travel_canonical_instant_valid(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  return jsonb_typeof(value) = 'string'
    and (value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
    and to_char((value #>> '{}')::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') = value #>> '{}';
exception when others then
  return false;
end;
$$;

-- At most 100 places, ordered by key, one mode each.
create function cadence_private.travel_place_modes_valid(entries jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  entry jsonb;
  previous_key text := null;
begin
  if entries is null or jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) > 100 then
    return false;
  end if;
  for entry in select value from jsonb_array_elements(entries) with ordinality item(value, position) order by position loop
    if jsonb_typeof(entry) <> 'object'
      or (select count(*) from jsonb_object_keys(entry)) <> 3
      or not (entry ?& array['place_key', 'mode', 'chosen_at'])
      or jsonb_typeof(entry -> 'place_key') <> 'string'
      or (entry ->> 'place_key') !~ '^[A-Za-z0-9_-]{43}$'
      or jsonb_typeof(entry -> 'mode') <> 'string'
      or (entry ->> 'mode') not in ('walking', 'cycling', 'transit', 'driving')
      or not cadence_private.travel_canonical_instant_valid(entry -> 'chosen_at')
      or (previous_key is not null and (entry ->> 'place_key') collate "C" <= previous_key collate "C")
    then
      return false;
    end if;
    previous_key := entry ->> 'place_key';
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

-- The newest 30 answers, at most one per local date, ordered by date.
create function cadence_private.travel_leave_feedback_valid(entries jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  entry jsonb;
  previous_date text := null;
begin
  if entries is null or jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) > 30 then
    return false;
  end if;
  for entry in select value from jsonb_array_elements(entries) with ordinality item(value, position) order by position loop
    if jsonb_typeof(entry) <> 'object'
      or (select count(*) from jsonb_object_keys(entry)) <> 5
      or not (entry ?& array['event_ref', 'local_date', 'answer', 'answered_at', 'rules_version'])
      or jsonb_typeof(entry -> 'event_ref') <> 'string'
      or (entry ->> 'event_ref') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(entry -> 'local_date') <> 'string'
      or (entry ->> 'local_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char((entry ->> 'local_date')::date, 'YYYY-MM-DD') <> entry ->> 'local_date'
      or jsonb_typeof(entry -> 'answer') <> 'string'
      or (entry ->> 'answer') not in ('too_early', 'about_right', 'too_late')
      or not cadence_private.travel_canonical_instant_valid(entry -> 'answered_at')
      or jsonb_typeof(entry -> 'rules_version') <> 'string'
      or (entry ->> 'rules_version') !~ '^travel-habit-defaults@[1-9][0-9]*$'
      or (previous_date is not null and (entry ->> 'local_date') collate "C" <= previous_date collate "C")
    then
      return false;
    end if;
    previous_date := entry ->> 'local_date';
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

-- Owners update travel_settings directly under RLS, so the column checks run
-- as authenticated. The validators read no data.
revoke all on function cadence_private.travel_canonical_instant_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function cadence_private.travel_place_modes_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function cadence_private.travel_leave_feedback_valid(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function cadence_private.travel_canonical_instant_valid(jsonb) to authenticated;
grant execute on function cadence_private.travel_place_modes_valid(jsonb) to authenticated;
grant execute on function cadence_private.travel_leave_feedback_valid(jsonb) to authenticated;

-- Existing rows read as nothing learned. The table keeps its owner-only RLS
-- policies and grants from 20260922010000_add_travel_settings.sql.
alter table public.travel_settings
  add column preparation_minutes integer,
  add column arrival_buffer_minutes integer,
  add column place_modes jsonb not null default '[]'::jsonb,
  add column leave_feedback jsonb not null default '[]'::jsonb,
  add column habits_updated_at timestamptz,
  add constraint travel_settings_preparation_valid check (
    preparation_minutes is null or preparation_minutes between 0 and 60
  ),
  add constraint travel_settings_arrival_buffer_valid check (
    arrival_buffer_minutes is null or arrival_buffer_minutes between 0 and 30
  ),
  add constraint travel_settings_place_modes_valid check (
    cadence_private.travel_place_modes_valid(place_modes)
  ),
  add constraint travel_settings_leave_feedback_valid check (
    cadence_private.travel_leave_feedback_valid(leave_feedback)
  ),
  add constraint travel_settings_habits_revision_valid check (
    habits_updated_at is not null or (
      preparation_minutes is null and arrival_buffer_minutes is null
      and place_modes = '[]'::jsonb and leave_feedback = '[]'::jsonb
    )
  );

comment on column public.travel_settings.preparation_minutes is
  'Ticket 217 get-ready time the user set; null follows the travel-habit default.';
comment on column public.travel_settings.arrival_buffer_minutes is
  'Ticket 217 arrival buffer from the user''s edits and leave-time answers; null follows the default.';
comment on column public.travel_settings.place_modes is
  'Ticket 217 remembered travel mode per place: place key (digest of normalized place text), mode and choice time. No place text.';
comment on column public.travel_settings.leave_feedback is
  'Ticket 217 leave-time answers: event identity digest, local date, answer, time and rules version. No location.';
comment on column public.travel_settings.habits_updated_at is
  'Ticket 217 revision for habit writes. Null until the first habit change.';
comment on table public.travel_settings is
  'Owner-authored travel preferences, consent and learned habits only. No device position, provider geocode, route result, route duration, or Calendar/model grant belongs here.';

-- Learned habits join the singleton profile sync entity beside the Ticket 162
-- travel preferences, so the profile value grows from 8 to 13 keys. Desktop builds
-- that predate Ticket 217 reject the 13-key profile and fail closed instead of
-- clearing habits; this write validator refuses their 8-key profile writes.
do $migration$
declare
  definition text;
  anchor text;
begin
  select pg_get_functiondef('public.read_account_sync_snapshot()'::regprocedure) into definition;
  anchor := $a$      'onboarding_completed_at', settings.onboarding_completed_at,
      'updated_at', settings.updated_at
    ))
    from public.profiles p$a$;
  if position(anchor in definition) = 0 then raise exception 'Account snapshot profile changed unexpectedly.'; end if;
  execute replace(definition, anchor, $patch$      'onboarding_completed_at', settings.onboarding_completed_at,
      'updated_at', settings.updated_at,
      'travel_preparation_minutes', settings.preparation_minutes,
      'travel_arrival_buffer_minutes', settings.arrival_buffer_minutes,
      'travel_place_modes', settings.place_modes,
      'travel_leave_feedback', settings.leave_feedback,
      'travel_habits_updated_at', settings.habits_updated_at
    ))
    from public.profiles p$patch$);

  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;

  anchor := $a$        or (select count(*) from jsonb_object_keys(write -> 'value')) <> 8
        or not ((write -> 'value') ?& array[
          'timezone', 'travel_enabled', 'base_location_text', 'travel_mode',
          'navigation_preference', 'routing_consent_at',
          'onboarding_completed_at', 'updated_at'
        ])$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync profile validation changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$        or (select count(*) from jsonb_object_keys(write -> 'value')) <> 13
        or not ((write -> 'value') ?& array[
          'timezone', 'travel_enabled', 'base_location_text', 'travel_mode',
          'navigation_preference', 'routing_consent_at',
          'onboarding_completed_at', 'updated_at',
          'travel_preparation_minutes', 'travel_arrival_buffer_minutes',
          'travel_place_modes', 'travel_leave_feedback', 'travel_habits_updated_at'
        ])
        or jsonb_typeof(write #> '{value,travel_preparation_minutes}') not in ('null', 'number')
        or (jsonb_typeof(write #> '{value,travel_preparation_minutes}') = 'number' and (
          (write #>> '{value,travel_preparation_minutes}')::numeric <> trunc((write #>> '{value,travel_preparation_minutes}')::numeric)
          or (write #>> '{value,travel_preparation_minutes}')::numeric not between 0 and 60
        ))
        or jsonb_typeof(write #> '{value,travel_arrival_buffer_minutes}') not in ('null', 'number')
        or (jsonb_typeof(write #> '{value,travel_arrival_buffer_minutes}') = 'number' and (
          (write #>> '{value,travel_arrival_buffer_minutes}')::numeric <> trunc((write #>> '{value,travel_arrival_buffer_minutes}')::numeric)
          or (write #>> '{value,travel_arrival_buffer_minutes}')::numeric not between 0 and 30
        ))
        or not cadence_private.travel_place_modes_valid(write #> '{value,travel_place_modes}')
        or not cadence_private.travel_leave_feedback_valid(write #> '{value,travel_leave_feedback}')
        or jsonb_typeof(write #> '{value,travel_habits_updated_at}') not in ('null', 'string')$patch$);

  anchor := $a$        'onboarding_completed_at', settings.onboarding_completed_at,
        'updated_at', settings.updated_at
      )) into stored_value$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync stored profile read changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$        'onboarding_completed_at', settings.onboarding_completed_at,
        'updated_at', settings.updated_at,
        'travel_preparation_minutes', settings.preparation_minutes,
        'travel_arrival_buffer_minutes', settings.arrival_buffer_minutes,
        'travel_place_modes', settings.place_modes,
        'travel_leave_feedback', settings.leave_feedback,
        'travel_habits_updated_at', settings.habits_updated_at
      )) into stored_value$patch$);

  anchor := $a$        onboarding_completed_at = nullif(write #>> '{value,onboarding_completed_at}', '')::timestamptz,
        updated_at = (write #>> '{value,updated_at}')::timestamptz
      where user_id = current_user_id;$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync profile apply changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$        onboarding_completed_at = nullif(write #>> '{value,onboarding_completed_at}', '')::timestamptz,
        updated_at = (write #>> '{value,updated_at}')::timestamptz,
        preparation_minutes = (write #>> '{value,travel_preparation_minutes}')::integer,
        arrival_buffer_minutes = (write #>> '{value,travel_arrival_buffer_minutes}')::integer,
        place_modes = write #> '{value,travel_place_modes}',
        leave_feedback = write #> '{value,travel_leave_feedback}',
        habits_updated_at = nullif(write #>> '{value,travel_habits_updated_at}', '')::timestamptz
      where user_id = current_user_id;$patch$);

  execute definition;
end
$migration$;

commit;
