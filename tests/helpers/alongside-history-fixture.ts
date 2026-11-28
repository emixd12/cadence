import { storedBehavior, storedConfigurationEvent, storedExportOccurrence } from "./export-row-fixture";

// D33 configuration history for export tests (Ticket 363, defect D1). One Behavior with a
// baseline and a later reminder edit. The answered account also answered "yes" between
// them: an answer-only revision with one Occurrence of its own, and the reminder edit then
// carries the answer on both sides. The unanswered account never answered; that Occurrence
// belongs to the baseline. The rows are in the shape the database stores.

type Row = Record<string, unknown>;

const baseline = storedConfigurationEvent();
const baseConfiguration = baseline.next_configuration as Row;

function occurrence(id: string, localDate: string, configurationEventId: string) {
  return {
    ...storedExportOccurrence(), id, behavior_configuration_event_id: configurationEventId,
    local_date: localDate, scheduled_for: `${localDate}T22:00:00Z`,
  };
}

function revision(id: string, recordedAt: string, previous: Row, next: Row, changedFields: string[], reasonCode: string) {
  return {
    ...baseline, id, event_kind: "revision", previous_configuration: previous, next_configuration: next,
    changed_fields: changedFields, recorded_at: recordedAt, effective_at: recordedAt,
    effective_local_date: recordedAt.slice(0, 10), source: "manual", reason_code: reasonCode, created_at: recordedAt,
  };
}

export function alongsideHistoryRows(answered: boolean) {
  const withAnswer = (configuration: Row, value: boolean | null): Row => answered ? { ...configuration, alongside: value } : configuration;
  const edited = { ...baseConfiguration, reminder_offset_minutes: 15 };
  const answerRevision = revision("configuration-a", "2026-05-02T12:00:00Z",
    { ...baseConfiguration, alongside: null }, { ...baseConfiguration, alongside: true }, ["alongside"], "alongside_answered");
  const edit = revision("configuration-2", "2026-05-03T12:00:00Z",
    withAnswer(baseConfiguration, true), withAnswer(edited, true), ["reminder_offset_minutes"], "behavior_edited");
  return {
    behavior: {
      ...storedBehavior(), reminder_offset_minutes: 15, current_configuration_event_id: "configuration-2",
      updated_at: "2026-05-03T12:00:00Z", alongside: answered ? true : null,
    },
    configurationEvents: answered ? [baseline, answerRevision, edit] : [baseline, edit],
    occurrences: [
      occurrence("33333333-3333-4333-8333-333333333331", "2026-05-01", "configuration-1"),
      occurrence("33333333-3333-4333-8333-333333333332", "2026-05-02", answered ? "configuration-a" : "configuration-1"),
      occurrence("33333333-3333-4333-8333-333333333333", "2026-05-03", "configuration-2"),
    ],
  };
}
