\set ON_ERROR_STOP on

-- Ticket 305: Note shortcuts are on by default. The guarded commit treats an absent
-- global state as on, ignores the per-Behavior flag, and still honours a stored global
-- off switch. The once-only data flip turns stored off switches on without changing
-- revision or updated_at. Synthetic local fixtures only; all changes roll back.
begin;

insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('30500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ticket-305-owner@example.invalid', '{}', '{}'),
  ('30500000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ticket-305-off@example.invalid', '{}', '{}');

insert into public.behaviors(id, user_id, title, recurrence_rule, scheduled_time, active)
values
  ('30500000-0000-4000-8000-000000000011', '30500000-0000-4000-8000-000000000001', 'Stretch', '{"frequency":"daily","interval":1}', '07:00', true),
  ('30500000-0000-4000-8000-000000000012', '30500000-0000-4000-8000-000000000001', 'Archived walk', '{"frequency":"daily","interval":1}', '08:00', false),
  ('30500000-0000-4000-8000-000000000021', '30500000-0000-4000-8000-000000000002', 'Read', '{"frequency":"daily","interval":1}', '21:00', true);

-- An account that turned shortcuts off before Ticket 305, and a stored per-Behavior off flag.
insert into public.note_shortcut_states(user_id, id, behavior_id, enabled, entries, excluded_occurrence_ids, revision, updated_at)
values
  ('30500000-0000-4000-8000-000000000002', 'global', null, false, '[]', '[]', 4, '2026-10-01T12:00:00Z'),
  ('30500000-0000-4000-8000-000000000002', '30500000-0000-4000-8000-000000000021', '30500000-0000-4000-8000-000000000021', false, '[]', '[]', 2, '2026-10-01T12:00:00Z');

set local role authenticated;
set local request.jwt.claim.sub = '30500000-0000-4000-8000-000000000001';

do $$
declare
  context_value jsonb;
  next_value jsonb;
  result_value jsonb;
begin
  -- No global or Behavior state: matching may commit (absent means on).
  context_value := public.read_note_shortcut_context('30500000-0000-4000-8000-000000000011');
  assert context_value -> 'globalState' = 'null'::jsonb and context_value -> 'state' = 'null'::jsonb,
    'Fixture must start without shortcut state';
  next_value := jsonb_build_object(
    'id', '30500000-0000-4000-8000-000000000011', 'user_id', auth.uid(),
    'behavior_id', '30500000-0000-4000-8000-000000000011', 'enabled', true,
    'entries', '[]'::jsonb, 'excluded_occurrence_ids', '[]'::jsonb,
    'revision', 1, 'updated_at', '2026-11-10T12:00:00Z'
  );
  result_value := public.commit_note_shortcut_state(context_value, next_value, true);
  assert result_value ->> 'revision' = '1', 'Default-on matching commit failed';

  -- A per-Behavior off flag no longer gates matching.
  context_value := public.read_note_shortcut_context('30500000-0000-4000-8000-000000000011');
  next_value := jsonb_set(jsonb_set(context_value -> 'state', '{enabled}', 'false'::jsonb), '{revision}', '2'::jsonb);
  perform public.commit_note_shortcut_state(context_value, next_value, false);
  context_value := public.read_note_shortcut_context('30500000-0000-4000-8000-000000000011');
  next_value := jsonb_set(context_value -> 'state', '{revision}', '3'::jsonb);
  result_value := public.commit_note_shortcut_state(context_value, next_value, true);
  assert result_value ->> 'revision' = '3', 'Per-Behavior flag still gated matching';

  -- Archived Behaviors still reject matching and acceptance.
  context_value := public.read_note_shortcut_context('30500000-0000-4000-8000-000000000012');
  next_value := jsonb_build_object(
    'id', '30500000-0000-4000-8000-000000000012', 'user_id', auth.uid(),
    'behavior_id', '30500000-0000-4000-8000-000000000012', 'enabled', true,
    'entries', '[]'::jsonb, 'excluded_occurrence_ids', '[]'::jsonb,
    'revision', 1, 'updated_at', '2026-11-10T12:00:00Z'
  );
  begin
    perform public.commit_note_shortcut_state(context_value, next_value, true);
    raise exception 'Archived Behavior accepted matching';
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'Note shortcuts are available for active Behaviors only.', sqlerrm;
  end;

  -- The retained global switch: a stored off value rejects matching but not removal.
  context_value := public.read_note_shortcut_context(null);
  next_value := jsonb_build_object(
    'id', 'global', 'user_id', auth.uid(), 'behavior_id', null, 'enabled', false,
    'entries', '[]'::jsonb, 'excluded_occurrence_ids', '[]'::jsonb,
    'revision', 1, 'updated_at', '2026-11-10T12:00:00Z'
  );
  perform public.commit_note_shortcut_state(context_value, next_value, false);
  context_value := public.read_note_shortcut_context('30500000-0000-4000-8000-000000000011');
  next_value := jsonb_set(context_value -> 'state', '{revision}', '4'::jsonb);
  begin
    perform public.commit_note_shortcut_state(context_value, next_value, true);
    raise exception 'Stored global off switch did not gate matching';
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'Note shortcuts are turned off for this account.', sqlerrm;
  end;
  result_value := public.commit_note_shortcut_state(context_value, next_value, false);
  assert result_value ->> 'revision' = '4', 'Removal path was blocked by the off switch';
end
$$;

reset role;

-- Mirrors supabase/migrations/20261110153051_turn_on_note_shortcuts_once.sql
-- (tests/note-shortcut-migration.test.ts pins that file to this statement).
update public.note_shortcut_states
set enabled = true
where id = 'global' and enabled = false;

do $$
begin
  assert (select enabled and revision = 4 and updated_at = '2026-10-01T12:00:00Z'
    from public.note_shortcut_states
    where user_id = '30500000-0000-4000-8000-000000000002' and id = 'global'),
    'The once-only flip must turn the switch on without changing revision or updated_at';
  assert (select not enabled and revision = 2
    from public.note_shortcut_states
    where user_id = '30500000-0000-4000-8000-000000000002' and id = '30500000-0000-4000-8000-000000000021'),
    'The flip must leave per-Behavior rows unchanged';
end
$$;

rollback;
