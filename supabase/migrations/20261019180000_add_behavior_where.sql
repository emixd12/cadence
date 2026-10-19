-- Ticket 215: optional Behavior Where.
-- null = Not set, 'anywhere', 'home', or 'place'. A place keeps its typed
-- text in the existing location_text column; every other value keeps none.
begin;

alter table public.behaviors
  add column where_kind text,
  add constraint behaviors_where_kind_valid check (
    where_kind is null or where_kind in ('anywhere', 'home', 'place')
  );

-- Existing location text becomes Where = A place with the same text. Place
-- lookups wait for the next travel refresh; this migration calls no provider.
-- The updated_at trigger does not watch where_kind, so revisions stay unchanged.
update public.behaviors
set where_kind = 'place'
where location_text is not null;

alter table public.behaviors
  add constraint behaviors_where_place_text_valid check (
    (where_kind is not distinct from 'place') = (location_text is not null)
  );

comment on column public.behaviors.where_kind is
  'Optional user-authored Where: null (Not set), anywhere, home or place. Only place keeps location_text.';

alter table public.behavior_configuration_events
  drop constraint behavior_configuration_events_changed_fields_check;

alter table public.behavior_configuration_events
  add constraint behavior_configuration_events_changed_fields_check
  check (
    cardinality(changed_fields) > 0
    and changed_fields <@ array[
      'category_id', 'location_text', 'where_kind', 'schedule_graph',
      'browser_reminder_enabled', 'email_reminder_enabled',
      'reminder_offset_minutes', 'active', 'timezone'
    ]::text[]
  );

-- Existing history is not rewritten. Readers treat a snapshot without
-- where_kind as 'place' when it has location text and as Not set otherwise.
create or replace function cadence_private.behavior_configuration_changed_fields(
  previous_configuration jsonb,
  next_configuration jsonb
)
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select case when previous_configuration is null then array[
    'category_id', 'location_text', 'where_kind', 'schedule_graph',
    'browser_reminder_enabled', 'email_reminder_enabled',
    'reminder_offset_minutes', 'active', 'timezone'
  ]::text[] else array_remove(array[
    case when previous_configuration -> 'category_id' is distinct from next_configuration -> 'category_id' then 'category_id' end,
    case when previous_configuration -> 'location_text' is distinct from next_configuration -> 'location_text' then 'location_text' end,
    case when coalesce(previous_configuration -> 'where_kind', case when previous_configuration ->> 'location_text' is null then 'null'::jsonb else '"place"'::jsonb end)
      is distinct from next_configuration -> 'where_kind' then 'where_kind' end,
    case when previous_configuration -> 'schedule_graph' is distinct from next_configuration -> 'schedule_graph' then 'schedule_graph' end,
    case when previous_configuration -> 'browser_reminder_enabled' is distinct from next_configuration -> 'browser_reminder_enabled' then 'browser_reminder_enabled' end,
    case when previous_configuration -> 'email_reminder_enabled' is distinct from next_configuration -> 'email_reminder_enabled' then 'email_reminder_enabled' end,
    case when previous_configuration -> 'reminder_offset_minutes' is distinct from next_configuration -> 'reminder_offset_minutes' then 'reminder_offset_minutes' end,
    case when previous_configuration -> 'active' is distinct from next_configuration -> 'active' then 'active' end,
    case when previous_configuration -> 'timezone' is distinct from next_configuration -> 'timezone' then 'timezone' end
  ]::text[], null) end;
$$;

-- A plan written by a client that predates Where carries snapshots without
-- where_kind. Read them the same way as stored history: location text means
-- 'place', none means Not set.
create function cadence_private.behavior_configuration_with_where(snapshot jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when jsonb_typeof(snapshot) = 'object' and not (snapshot ? 'where_kind') then
      snapshot || jsonb_build_object('where_kind',
        case when snapshot ->> 'location_text' is null then null else 'place' end)
    else snapshot
  end;
$$;

revoke all on function cadence_private.behavior_configuration_with_where(jsonb)
  from public, anon, authenticated, service_role;

-- Extend the snapshot, the plan validator and the graph writers in place,
-- preserving every later change to their bodies. The hosted migration ships
-- before the web deployment, so the writers and the validator also accept
-- payloads and plans from the previous web build, which send no where_kind.
do $migration$
declare
  definition text;
  anchor text;
begin
  select pg_get_functiondef('cadence_private.current_behavior_configuration_snapshot(uuid,uuid)'::regprocedure) into definition;
  anchor := $a$    'location_text', behavior.location_text,$a$;
  if position(anchor in definition) = 0 then raise exception 'Behavior configuration snapshot changed unexpectedly.'; end if;
  execute replace(definition, anchor, $patch$    'location_text', behavior.location_text,
    'where_kind', behavior.where_kind,$patch$);

  select pg_get_functiondef('public.create_behavior_with_schedule_graph(jsonb,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  anchor := $a$    location_text,
    recurrence_rule,$a$;
  if position(anchor in definition) = 0 then raise exception 'Behavior create columns changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$    location_text,
    where_kind,
    recurrence_rule,$patch$);
  anchor := $a$    nullif(behavior_payload ->> 'location_text', ''),
    behavior_payload -> 'recurrence_rule',$a$;
  if position(anchor in definition) = 0 then raise exception 'Behavior create values changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$    nullif(behavior_payload ->> 'location_text', ''),
    case
      when behavior_payload ? 'where_kind' then nullif(behavior_payload ->> 'where_kind', '')
      when nullif(behavior_payload ->> 'location_text', '') is not null then 'place'
    end,
    behavior_payload -> 'recurrence_rule',$patch$);
  execute definition;

  select pg_get_functiondef('public.update_behavior_with_schedule_graph(uuid,jsonb,jsonb,jsonb,timestamp with time zone,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  anchor := $a$    location_text = nullif(behavior_payload ->> 'location_text', ''),$a$;
  if position(anchor in definition) = 0 then raise exception 'Behavior update fields changed unexpectedly.'; end if;
  -- Without where_kind, text means A place and clearing A place means Not set,
  -- matching the rule in the core service for callers that predate Where.
  execute replace(definition, anchor, $patch$    location_text = nullif(behavior_payload ->> 'location_text', ''),
    where_kind = case
      when behavior_payload ? 'where_kind' then nullif(behavior_payload ->> 'where_kind', '')
      when nullif(behavior_payload ->> 'location_text', '') is not null then 'place'
      when current_behavior.where_kind = 'place' then null
      else current_behavior.where_kind
    end,$patch$);

  -- The validator still stores the database snapshots and changed fields. A
  -- pre-Where plan only has to match them with Where read the legacy way.
  select pg_get_functiondef('cadence_private.insert_behavior_configuration_event(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  anchor := $a$    or configuration_event_plan -> 'previous_configuration'
      is distinct from coalesce(previous_configuration, 'null'::jsonb)
    or configuration_event_plan -> 'next_configuration'
      is distinct from next_configuration
    or planned_changed_fields is distinct from expected_changed_fields$a$;
  if position(anchor in definition) = 0 then raise exception 'Configuration event plan validation changed unexpectedly.'; end if;
  execute replace(definition, anchor, $patch$    or cadence_private.behavior_configuration_with_where(configuration_event_plan -> 'previous_configuration')
      is distinct from coalesce(previous_configuration, 'null'::jsonb)
    or cadence_private.behavior_configuration_with_where(configuration_event_plan -> 'next_configuration')
      is distinct from next_configuration
    or planned_changed_fields is distinct from (case
      when (configuration_event_plan -> 'next_configuration') ? 'where_kind' then expected_changed_fields
      else array_remove(expected_changed_fields, 'where_kind')
    end)$patch$);

  -- Behavior sync writes must carry Where; older desktop builds fail closed
  -- with the existing update message instead of clearing it.
  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;
  anchor := $a$      'default_duration_minutes', 'end_date', 'auto_archived_at', 'location_text'
    ])$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync Behavior compatibility guard changed unexpectedly.'; end if;
  execute replace(definition, anchor, $patch$      'default_duration_minutes', 'end_date', 'auto_archived_at', 'location_text', 'where_kind'
    ])$patch$);
end
$migration$;

commit;
