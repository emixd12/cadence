\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'ticket-060-owner@example.invalid',
    '',
    '2026-06-01T00:00:00Z',
    '{"provider":"email","providers":["email"]}',
    '{}',
    '2026-06-01T00:00:00Z',
    '2026-06-01T00:00:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'ticket-060-other@example.invalid',
    '',
    '2026-06-01T00:00:00Z',
    '{"provider":"email","providers":["email"]}',
    '{}',
    '2026-06-01T00:00:00Z',
    '2026-06-01T00:00:00Z'
  );

insert into public.behaviors (
  id,
  user_id,
  title,
  recurrence_rule,
  scheduled_time,
  timezone,
  active,
  archived_at,
  created_at,
  updated_at
)
values
  (
    '11000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000001',
    'Ticket 060 active repair fixture',
    '{"frequency":"weekly","interval":1,"daysOfWeek":["friday"]}',
    '11:30',
    'America/New_York',
    true,
    null,
    '2026-06-26T12:00:00Z',
    '2026-06-26T12:00:00Z'
  ),
  (
    '12000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000001',
    'Ticket 060 archived repair fixture',
    '{"frequency":"daily","interval":1}',
    '09:00',
    'America/New_York',
    false,
    '2026-07-01T00:00:00Z',
    '2026-06-20T12:00:00Z',
    '2026-07-01T00:00:00Z'
  ),
  (
    '13000000-0000-4000-8000-000000000013',
    '10000000-0000-4000-8000-000000000001',
    'Ticket 060 valid graph fixture',
    '{"frequency":"monthly","interval":1,"dayOfMonth":31}',
    '08:00',
    'America/New_York',
    true,
    null,
    '2026-06-01T12:00:00Z',
    '2026-06-01T12:00:00Z'
  ),
  (
    '21000000-0000-4000-8000-000000000021',
    '20000000-0000-4000-8000-000000000002',
    'Ticket 060 cross-owner fixture',
    '{"frequency":"daily","interval":1}',
    '10:00',
    'America/New_York',
    true,
    null,
    '2026-06-01T12:00:00Z',
    '2026-06-01T12:00:00Z'
  );

insert into public.behavior_schedules (
  id,
  user_id,
  behavior_id,
  recurrence_rule,
  sort_order,
  created_at,
  updated_at
)
values
  (
    '11100000-0000-4000-8000-000000000111',
    '10000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000011',
    '{"frequency":"weekly","interval":1,"daysOfWeek":["friday"]}',
    0,
    '2026-06-26T12:00:00Z',
    '2026-06-26T12:00:00Z'
  ),
  (
    '12100000-0000-4000-8000-000000000121',
    '10000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000012',
    '{"frequency":"daily","interval":1}',
    0,
    '2026-06-20T12:00:00Z',
    '2026-06-20T12:00:00Z'
  ),
  (
    '13100000-0000-4000-8000-000000000131',
    '10000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000013',
    '{"frequency":"monthly","interval":1,"dayOfMonth":31}',
    0,
    '2026-06-01T12:00:00Z',
    '2026-06-01T12:00:00Z'
  );

insert into public.behavior_schedule_slots (
  id,
  user_id,
  behavior_id,
  behavior_schedule_id,
  kind,
  preset,
  start_time,
  end_time,
  sort_order,
  created_at,
  updated_at
)
values (
  '13200000-0000-4000-8000-000000000132',
  '10000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000013',
  '13100000-0000-4000-8000-000000000131',
  'exact',
  null,
  '08:00',
  null,
  0,
  '2026-06-01T12:00:00Z',
  '2026-06-01T12:00:00Z'
);

insert into public.occurrences (
  id,
  user_id,
  behavior_id,
  scheduled_for,
  local_date,
  status,
  completed_at,
  status_marked_at,
  schedule_kind,
  schedule_preset,
  schedule_start_time,
  schedule_end_time,
  created_at,
  updated_at
)
values
  (
    '11400000-0000-4000-8000-000000000114',
    '10000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000011',
    '2026-06-26T15:30:00Z',
    '2026-06-26',
    'completed',
    '2026-06-26T16:00:00Z',
    '2026-06-26T16:00:00Z',
    'exact',
    null,
    '11:30',
    null,
    '2026-06-26T12:00:00Z',
    '2026-06-26T16:00:00Z'
  ),
  (
    '11500000-0000-4000-8000-000000000115',
    '10000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000011',
    '2026-07-03T15:30:00Z',
    '2026-07-03',
    'unresolved',
    null,
    null,
    'exact',
    null,
    '11:30',
    null,
    '2026-07-03T15:30:00Z',
    '2026-07-03T15:30:00Z'
  );

-- Retired one-time helpers and legacy RPC signatures remain covered by migration tests.
\if false
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

do $$
declare
  created jsonb;
  created_id uuid;
  created_updated_at timestamptz;
  expected_graph jsonb;
  next_graph jsonb;
  cross_owner_result jsonb;
  failure_seen boolean := false;
begin
  created := public.create_behavior_with_schedule_graph(
    jsonb_build_object(
      'category_id', null,
      'title', 'Ticket 060 atomic create',
      'description', null,
      'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
      'scheduled_time', '09:00',
      'timezone', 'America/New_York',
      'browser_reminder_enabled', true,
      'email_reminder_enabled', false,
      'reminder_offset_minutes', 0,
      'active', true,
      'archived_at', null,
      'created_at', '2026-07-17T16:00:00Z'
    ),
    jsonb_build_object(
      'previous_title', null,
      'next_title', 'Ticket 060 atomic create',
      'previous_description', null,
      'next_description', null,
      'changed_fields', jsonb_build_array('title'),
      'recorded_at', '2026-07-17T16:00:00Z',
      'source', 'manual',
      'reason', null
    ),
    jsonb_build_array(
      jsonb_build_object(
        'id', null,
        'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
        'sort_order', 0,
        'time_entries', jsonb_build_array(
          jsonb_build_object(
            'id', null,
            'kind', 'exact',
            'preset', null,
            'start_time', '09:00',
            'end_time', null,
            'sort_order', 0
          )
        )
      )
    )
  );
  created_id := (created ->> 'id')::uuid;

  assert (
    select count(*) = 1
    from public.behavior_definition_events
    where behavior_id = created_id
  );
  assert (
    select count(*) = 1
    from public.behavior_schedules
    where behavior_id = created_id
  );
  assert (
    select count(*) = 1
    from public.behavior_schedule_slots
    where behavior_id = created_id
      and behavior_schedule_id is not null
  );

  select updated_at
  into created_updated_at
  from public.behaviors
  where id = created_id;
  expected_graph := cadence_private.current_behavior_schedule_graph(
    '10000000-0000-4000-8000-000000000001',
    created_id
  );
  next_graph := jsonb_set(
    expected_graph,
    '{0,time_entries,0,start_time}',
    '"12:00"'::jsonb
  );

  perform public.update_behavior_with_schedule_graph(
    created_id,
    jsonb_build_object(
      'category_id', null,
      'title', 'Ticket 060 atomic create',
      'description', null,
      'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
      'scheduled_time', '12:00',
      'browser_reminder_enabled', true,
      'email_reminder_enabled', false,
      'reminder_offset_minutes', 0,
      'active', true,
      'archived_at', null
    ),
    jsonb_build_object(
      'stored_title', 'Ticket 060 atomic create',
      'stored_description', null,
      'normalized_title', 'Ticket 060 atomic create',
      'normalized_description', null
    ),
    expected_graph,
    created_updated_at,
    null,
    next_graph
  );

  assert (
    select count(*) = 1 and min(start_time) = '12:00'::time
    from public.behavior_schedule_slots
    where behavior_id = created_id
  );
  assert (
    select count(*) = 1
    from public.behavior_definition_events
    where behavior_id = created_id
  );

  begin
    perform public.update_behavior_with_schedule_graph(
      created_id,
      jsonb_build_object(
        'category_id', null,
        'title', 'Stale write must roll back',
        'description', null,
        'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
        'scheduled_time', '12:00',
        'browser_reminder_enabled', true,
        'email_reminder_enabled', false,
        'reminder_offset_minutes', 0,
        'active', true,
        'archived_at', null
      ),
      jsonb_build_object(
        'stored_title', 'Ticket 060 atomic create',
        'stored_description', null,
        'normalized_title', 'Ticket 060 atomic create',
        'normalized_description', null
      ),
      expected_graph,
      created_updated_at,
      null,
      next_graph
    );
  exception when serialization_failure then
    failure_seen := true;
  end;
  assert failure_seen;
  assert (
    select title = 'Ticket 060 atomic create'
    from public.behaviors
    where id = created_id
  );

  select updated_at
  into created_updated_at
  from public.behaviors
  where id = created_id;
  expected_graph := cadence_private.current_behavior_schedule_graph(
    '10000000-0000-4000-8000-000000000001',
    created_id
  );
  next_graph := jsonb_set(
    expected_graph,
    '{0,time_entries,0,id}',
    '"13200000-0000-4000-8000-000000000132"'::jsonb
  );

  failure_seen := false;
  begin
    perform public.update_behavior_with_schedule_graph(
      created_id,
      jsonb_build_object(
        'category_id', null,
        'title', 'Ticket 060 forced update rollback',
        'description', null,
        'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
        'scheduled_time', '12:00',
        'browser_reminder_enabled', true,
        'email_reminder_enabled', false,
        'reminder_offset_minutes', 0,
        'active', true,
        'archived_at', null
      ),
      jsonb_build_object(
        'stored_title', 'Ticket 060 atomic create',
        'stored_description', null,
        'normalized_title', 'Ticket 060 atomic create',
        'normalized_description', null
      ),
      expected_graph,
      created_updated_at,
      jsonb_build_object(
        'previous_title', 'Ticket 060 atomic create',
        'next_title', 'Ticket 060 forced update rollback',
        'previous_description', null,
        'next_description', null,
        'changed_fields', jsonb_build_array('title'),
        'recorded_at', '2026-07-17T16:30:00Z',
        'source', 'manual',
        'reason', null
      ),
      next_graph
    );
  exception when serialization_failure then
    failure_seen := true;
  end;
  assert failure_seen;
  assert (
    select title = 'Ticket 060 atomic create'
    from public.behaviors
    where id = created_id
  );
  assert (
    select count(*) = 1
    from public.behavior_definition_events
    where behavior_id = created_id
  );
  assert (
    select count(*) = 1 and min(start_time) = '12:00'::time
    from public.behavior_schedule_slots
    where behavior_id = created_id
  );

  failure_seen := false;
  begin
    perform public.create_behavior_with_schedule_graph(
      jsonb_build_object(
        'category_id', null,
        'title', 'Ticket 060 forced slot rollback',
        'description', null,
        'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
        'scheduled_time', '09:00',
        'timezone', 'America/New_York',
        'browser_reminder_enabled', true,
        'email_reminder_enabled', false,
        'reminder_offset_minutes', 0,
        'active', true,
        'archived_at', null,
        'created_at', '2026-07-17T17:00:00Z'
      ),
      jsonb_build_object(
        'previous_title', null,
        'next_title', 'Ticket 060 forced slot rollback',
        'previous_description', null,
        'next_description', null,
        'changed_fields', jsonb_build_array('title'),
        'recorded_at', '2026-07-17T17:00:00Z',
        'source', 'manual',
        'reason', null
      ),
      jsonb_build_array(
        jsonb_build_object(
          'id', null,
          'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
          'sort_order', 0,
          'time_entries', jsonb_build_array(
            jsonb_build_object(
              'id', '13200000-0000-4000-8000-000000000132',
              'kind', 'exact',
              'preset', null,
              'start_time', '09:00',
              'end_time', null,
              'sort_order', 0
            )
          )
        )
      )
    );
  exception when serialization_failure then
    failure_seen := true;
  end;
  assert failure_seen;
  assert not exists (
    select 1
    from public.behaviors
    where title = 'Ticket 060 forced slot rollback'
  );
  assert not exists (
    select 1
    from public.behavior_definition_events
    where next_title = 'Ticket 060 forced slot rollback'
  );

  cross_owner_result := public.update_behavior_with_schedule_graph(
    '21000000-0000-4000-8000-000000000021',
    '{}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '2026-06-01T12:00:00Z',
    null,
    jsonb_build_array(
      jsonb_build_object(
        'id', null,
        'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
        'sort_order', 0,
        'time_entries', jsonb_build_array(
          jsonb_build_object(
            'id', null,
            'kind', 'exact',
            'preset', null,
            'start_time', '10:00',
            'end_time', null,
            'sort_order', 0
          )
        )
      )
    )
  );
  assert cross_owner_result is null;
end;
$$;
\endif

insert into public.behaviors (
  id,
  user_id,
  title,
  recurrence_rule,
  scheduled_time,
  timezone,
  active,
  created_at,
  updated_at
)
values (
  '14000000-0000-4000-8000-000000000014',
  '10000000-0000-4000-8000-000000000001',
  'Ticket 085 overlapping occurrence identity',
  '{"frequency":"daily","interval":1}',
  '09:00',
  'America/New_York',
  true,
  '2026-06-01T12:00:00Z',
  '2026-06-01T12:00:00Z'
);

insert into public.behavior_schedules (
  id,
  user_id,
  behavior_id,
  recurrence_rule,
  sort_order,
  created_at,
  updated_at
)
values
  (
    '14100000-0000-4000-8000-000000000141',
    '10000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000014',
    '{"frequency":"daily","interval":1}',
    0,
    '2026-06-01T12:00:00Z',
    '2026-06-01T12:00:00Z'
  ),
  (
    '14200000-0000-4000-8000-000000000142',
    '10000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000014',
    '{"frequency":"weekly","interval":1,"daysOfWeek":["monday"]}',
    1,
    '2026-06-01T12:00:00Z',
    '2026-06-01T12:00:00Z'
  );

insert into public.behavior_schedule_slots (
  id,
  user_id,
  behavior_id,
  behavior_schedule_id,
  kind,
  preset,
  start_time,
  end_time,
  sort_order,
  created_at,
  updated_at
)
values
  (
    '14300000-0000-4000-8000-000000000143',
    '10000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000014',
    '14100000-0000-4000-8000-000000000141',
    'exact',
    null,
    '09:00',
    null,
    0,
    '2026-06-01T12:00:00Z',
    '2026-06-01T12:00:00Z'
  ),
  (
    '14400000-0000-4000-8000-000000000144',
    '10000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000014',
    '14200000-0000-4000-8000-000000000142',
    'range',
    null,
    '09:00',
    '12:00',
    0,
    '2026-06-01T12:00:00Z',
    '2026-06-01T12:00:00Z'
  );

insert into public.occurrences (
  user_id,
  behavior_id,
  behavior_schedule_slot_id,
  scheduled_for,
  local_date,
  schedule_kind,
  schedule_preset,
  schedule_start_time,
  schedule_end_time,
  status
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000014',
    '14300000-0000-4000-8000-000000000143',
    '2026-06-01T13:00:00Z',
    '2026-06-01',
    'exact',
    null,
    '09:00',
    null,
    'unresolved'
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000014',
    '14400000-0000-4000-8000-000000000144',
    '2026-06-01T13:00:00Z',
    '2026-06-01',
    'range',
    null,
    '09:00',
    '12:00',
    'unresolved'
  )
on conflict (
  behavior_id,
  local_date,
  schedule_start_time,
  schedule_range_identity
) where origin = 'scheduled' do nothing;

do $$
begin
  assert (
    select count(*) = 2
      and count(distinct schedule_range_identity) = 2
      and min(schedule_range_identity) = -1
    from public.occurrences
    where behavior_id = '14000000-0000-4000-8000-000000000014'
      and local_date = '2026-06-01'
      and schedule_start_time = '09:00'
  );
end;
$$;

rollback;

\echo 'Ticket 060 rollback-only schedule integrity smoke passed.'
