\set ON_ERROR_STOP on

begin;

do $$
begin
  if cadence_private.behavior_end_date_boundary(
    '2026-11-01',
    'America/Havana'
  ) is distinct from '2026-11-01T04:00:00Z'::timestamptz then
    raise exception 'Ambiguous local midnight did not use the earlier instant.';
  end if;
end;
$$;

insert into auth.users (
  id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data
)
values
  (
    '13900000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'scheduled-archive-one@example.invalid',
    '{}',
    '{}'
  ),
  (
    '13900000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'scheduled-archive-two@example.invalid',
    '{}',
    '{}'
  );

create function pg_temp.create_end_date_behavior(behavior_title text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  recorded_at timestamptz := clock_timestamp();
  schedule_graph jsonb := jsonb_build_array(jsonb_build_object(
    'id', null,
    'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
    'sort_order', 0,
    'time_entries', jsonb_build_array(jsonb_build_object(
      'id', null,
      'kind', 'exact',
      'preset', null,
      'start_time', '09:00:00',
      'end_time', null,
      'sort_order', 0
    ))
  ));
  configuration jsonb;
  created jsonb;
begin
  configuration := jsonb_build_object(
    'category_id', null,
    'location_text', null,
    'schedule_graph', schedule_graph #- '{0,id}' #- '{0,time_entries,0,id}',
    'browser_reminder_enabled', true,
    'email_reminder_enabled', false,
    'reminder_offset_minutes', 0,
    'active', true,
    'timezone', 'America/New_York'
  );

  created := public.create_behavior_with_schedule_graph(
    jsonb_build_object(
      'category_id', null,
      'title', behavior_title,
      'description', null,
      'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
      'scheduled_time', '09:00:00',
      'timezone', 'America/New_York',
      'browser_reminder_enabled', true,
      'email_reminder_enabled', false,
      'reminder_offset_minutes', 0,
      'active', true,
      'archived_at', null,
      'archive_notes', jsonb_build_array(),
      'default_duration_minutes', null,
      'end_date', '2000-01-01',
      'auto_archived_at', null,
      'created_at', recorded_at
    ),
    jsonb_build_object(
      'previous_title', null,
      'next_title', behavior_title,
      'previous_description', null,
      'next_description', null,
      'changed_fields', jsonb_build_array('title'),
      'recorded_at', recorded_at,
      'source', 'manual',
      'reason', null
    ),
    jsonb_build_object(
      'event_kind', 'baseline',
      'previous_configuration', null,
      'next_configuration', configuration,
      'changed_fields', jsonb_build_array(
        'category_id',
        'location_text',
        'schedule_graph',
        'browser_reminder_enabled',
        'email_reminder_enabled',
        'reminder_offset_minutes',
        'active',
        'timezone'
      ),
      'recorded_at', recorded_at,
      'effective_at', recorded_at,
      'effective_local_date', (recorded_at at time zone 'America/New_York')::date,
      'timezone', 'America/New_York',
      'source', 'manual',
      'reason_code', 'behavior_created'
    ),
    schedule_graph
  );

  return (created ->> 'id')::uuid;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"13900000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select pg_temp.create_end_date_behavior('Owner archive contract');

-- Seed generated rows with the database owner; authenticated users use RPCs.
reset role;

insert into public.occurrences (
  user_id,
  behavior_id,
  behavior_configuration_event_id,
  scheduled_for,
  local_date,
  status,
  schedule_kind,
  schedule_start_time
)
select
  behavior.user_id,
  behavior.id,
  behavior.current_configuration_event_id,
  '2000-01-01T14:00:00Z',
  '2000-01-01',
  'unresolved',
  'exact',
  '09:00:00'
from public.behaviors as behavior
where behavior.title = 'Owner archive contract';

insert into public.reminder_deliveries (
  user_id,
  occurrence_id,
  channel,
  scheduled_send_at,
  status
)
select
  occurrence.user_id,
  occurrence.id,
  'browser_push',
  '2000-01-01T13:45:00Z',
  'pending'
from public.occurrences as occurrence
join public.behaviors as behavior on behavior.id = occurrence.behavior_id
where behavior.title = 'Owner archive contract';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"13900000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
select pg_temp.create_end_date_behavior('Service archive contract');

select set_config(
  'request.jwt.claims',
  '{"sub":"13900000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

-- Planning metadata does not change legacy configuration lineage. A writer must
-- reject an excluded insert even when the submitted lineage still matches.
do $$
declare behavior record; rejected boolean := false;
begin
  select * into behavior from public.behaviors where title = 'Owner archive contract';
  begin
    perform public.apply_occurrence_generation_plan(
      behavior.user_id, behavior.id, behavior.current_configuration_event_id,
      clock_timestamp(), jsonb_build_array(jsonb_build_object(
        'scheduled_for', '2000-01-02T14:00:00Z', 'local_date', '2000-01-02',
        'behavior_configuration_event_id', behavior.current_configuration_event_id,
        'schedule_kind', 'exact', 'schedule_start_time', '09:00:00'
      )), '[]'::jsonb, '[]'::jsonb
    );
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Behavior end date changed after occurrence planning.' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'A stale generation insert crossed the live end date.'; end if;
end;
$$;

do $$
declare
  archived_count integer;
  service_call_rejected boolean := false;
begin
  select count(*) into archived_count
  from public.archive_my_due_behaviors(100);

  if archived_count <> 1 then
    raise exception 'Owner reconciliation archived % Behaviors instead of one.', archived_count;
  end if;

  if not exists (
    select 1
    from public.behaviors
    where title = 'Owner archive contract'
      and not active
      and archived_at is not null
      and auto_archived_at = archived_at
      and end_date = '2000-01-01'
      and archive_notes @> '[{"note":"Automatically archived on the end date."}]'
  ) then
    raise exception 'Owner reconciliation did not persist the automatic archive marker and note.';
  end if;

  if not exists (
    select 1
    from public.behavior_configuration_events as event
    join public.behaviors as behavior on behavior.id = event.behavior_id
    where behavior.title = 'Owner archive contract'
      and event.reason_code = 'behavior_end_date_reached'
      and event.source = 'system'
      and event.changed_fields = array['active']::text[]
      and event.effective_at = '2000-01-01T05:00:00Z'
      and event.recorded_at > event.effective_at
  ) then
    raise exception 'Automatic archive history lost its delayed effective boundary.';
  end if;

  if exists (
    select 1
    from public.reminder_deliveries
    where status = 'pending'
  ) then
    raise exception 'Automatic archive left a pending reminder.';
  end if;

  perform public.apply_occurrence_generation_plan(
    behavior.user_id, behavior.id, behavior.current_configuration_event_id,
    clock_timestamp(), '[]'::jsonb, '[]'::jsonb,
    (select jsonb_agg(to_jsonb(occurrence)) from public.occurrences occurrence
      where occurrence.behavior_id = behavior.id)
  ) from public.behaviors behavior where behavior.title = 'Owner archive contract';
  if exists (select 1 from public.occurrences) then
    raise exception 'Delayed archive retained a bare generated occurrence after its end date.';
  end if;

  begin
    perform public.archive_due_behaviors('2026-09-20T12:00:00Z', 100);
  exception
    when insufficient_privilege then service_call_rejected := true;
  end;

  if not service_call_rejected then
    raise exception 'Authenticated caller reached the service-role archive batch.';
  end if;
end;
$$;

reset role;
do $$
begin
  if not exists (
    select 1
    from public.behaviors
    where title = 'Service archive contract'
      and active
  ) then
    raise exception 'Owner reconciliation changed another account.';
  end if;

end;
$$;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare archived_count integer;
begin
  select count(*) into archived_count
  from public.archive_due_behaviors('2026-09-20T12:00:00Z', 100);

  if archived_count <> 1 then
    raise exception 'Service reconciliation archived % Behaviors instead of one.', archived_count;
  end if;

  if not exists (
    select 1
    from public.behaviors
    where title = 'Service archive contract'
      and not active
      and auto_archived_at = '2026-09-20T12:00:00Z'
  ) then
    raise exception 'Service reconciliation did not archive the remaining due Behavior.';
  end if;
end;
$$;

reset role;
rollback;
