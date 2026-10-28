// Synthetic replica of the captured graph. No hosted rows or session material are loaded.
export function partialGraph({ PARTIAL_ROWS, PARTIAL_STATUSES, PARTIAL_IDS }) {
  const tables = ['categories', 'behaviors', 'behavior_schedules', 'behavior_schedule_slots', 'occurrences', 'occurrence_status_events', 'behavior_definition_events', 'behavior_configuration_events', 'occurrence_time_sessions'];
  const graph = Object.fromEntries(tables.map(table => [table, PARTIAL_ROWS.filter(r => r.table === table).map(({ table: _, ...r }) => ({ ...r }))]));
  const b = graph.behaviors[0], schedule = graph.behavior_schedules[0];
  Object.assign(graph.categories[0], { name: 'Review examples', updated_at: graph.categories[0].created_at });
  Object.assign(b, { title: 'Review walk', category_id: PARTIAL_IDS.a.category, timezone: 'America/New_York', active: true, archived_at: null, description: null, browser_reminder_enabled: false, email_reminder_enabled: false });
  Object.assign(schedule, { behavior_id: b.id, sort_order: 0, recurrence_rule: { frequency: 'daily', interval: 1 } });
  Object.assign(graph.behavior_schedule_slots[0], { behavior_id: b.id, behavior_schedule_id: schedule.id, kind: 'exact', start_time: '09:00:00', end_time: null, preset: null, sort_order: 0 });
  for (const o of graph.occurrences) {
    Object.assign(o, PARTIAL_STATUSES.find(s => s.id === o.id));
    Object.assign(o, { scheduled_for: `${o.local_date}T13:00:00+00:00`, schedule_kind: 'exact', schedule_start_time: '09:00:00', note: o.local_date === '2026-10-27' ? 'Review sample note' : null,
      completed_at: o.status === 'completed' ? `${o.local_date}T13:00:00+00:00` : null, status_marked_at: o.status === 'completed' ? '2026-10-28T18:11:34.8+00:00' : null });
  }
  Object.assign(b, { recurrence_rule: { frequency: 'daily', interval: 1 }, scheduled_time: '09:00:00', reminder_offset_minutes: 0, location_text: null, where_kind: null, default_duration_minutes: null, end_date: null, auto_archived_at: null, archive_notes: [] });
  Object.assign(graph.behavior_definition_events[0], { behavior_id: b.id, previous_title: null, next_title: 'Review walk', previous_description: null, next_description: null, source: 'manual', reason: null, changed_fields: ['title'] });
  Object.assign(graph.behavior_configuration_events[0], { behavior_id: b.id, event_kind: 'baseline', previous_configuration: null, source: 'manual', reason_code: 'behavior_created', timezone: 'America/New_York', effective_local_date: '2026-10-28', next_configuration: {
    category_id: PARTIAL_IDS.a.category, location_text: null, where_kind: null,
    schedule_graph: [{ recurrence_rule: { frequency: 'daily', interval: 1 }, sort_order: 0, time_entries: [{ kind: 'exact', preset: null, start_time: '09:00:00', end_time: null, sort_order: 0 }] }],
    browser_reminder_enabled: false, email_reminder_enabled: false, reminder_offset_minutes: 0, active: true, timezone: 'America/New_York',
  } });
  const completed = graph.occurrences.find(o => o.status === 'completed');
  Object.assign(graph.occurrence_status_events[0], { behavior_id: b.id, occurrence_id: completed.id, previous_status: 'unresolved', status: 'completed', status_semantics: 'explicit_user_mark', source_capture_method: 'manual_tap', source_confidence: 'high', recorded_at: completed.status_marked_at, effective_at: completed.completed_at });
  return graph;
}
