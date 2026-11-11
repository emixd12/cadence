import { Temporal } from "@js-temporal/polyfill";
import { resolveGenerationWindow } from "@cadence/core/resolvers/occurrence.resolver";
import { resolvePersistedTimeline } from "@cadence/core/services/timeline.service";
import { localCommand } from "./local-store";
import { ensureLocalOccurrencesFresh, toLocalBehaviorGraphRecord } from "./local-generation.service";
import { toTimeSession } from "./local-occurrence.service";
import { attachTimelineDayNotes, timelineDayNoteRange } from "@cadence/core/resolvers/day-note.resolver";
import { attachTimelineSourceEvidence, resolveTimelineSourceEvidence } from "@cadence/core/services/timeline-source-evidence";

export async function loadLocalTimeline(futureDays = 7, now = Temporal.Now.instant()) {
  const profile = await localCommand("readProfile", {});
  await ensureLocalOccurrencesFresh(profile, now);
  const profileId = profile.id;
  const window = resolveGenerationWindow({ now, timezone: profile.timezone, horizonDays: 30 });
  const priorDate = Temporal.PlainDate.from(window.startLocalDate).subtract({ days: 1 }).toString();
  const [graphs, categories, visibleOccurrences, priorUnresolved] = await Promise.all([
    localCommand("readBehaviorGraphs", { profileId }),
    localCommand("readCategories", { profileId }),
    localCommand("readOccurrences", { profileId, startLocalDate: window.startLocalDate, endLocalDate: window.endLocalDate }),
    localCommand("readOccurrences", { profileId, startLocalDate: "0001-01-01", endLocalDate: priorDate, status: "unresolved" }),
  ]);
  const occurrences = [...priorUnresolved, ...visibleOccurrences];
  const history = await localCommand("readOccurrenceHistory", { profileId, occurrenceIds: occurrences.map(({ id }) => id) });
  const historyOccurrences = await localCommand("readOccurrences", { profileId,
    startLocalDate: Temporal.PlainDate.from(window.startLocalDate).subtract({ days: 90 }).toString(), endLocalDate: priorDate });
  const durationHistory = await localCommand("readOccurrenceHistory", { profileId,
    occurrenceIds: historyOccurrences.map(({ id }) => id) });
  const behaviors = graphs.map((graph) => toLocalBehaviorGraphRecord(graph, categories));
  const view = resolvePersistedTimeline({ durationHistory: { occurrences: historyOccurrences, timeSessions: durationHistory.timeSessions.map(toTimeSession) }, behaviors, occurrences, timeSessions: history.timeSessions.map(toTimeSession),
    now, timezone: profile.timezone, futureDays });
  const dayNoteRange = timelineDayNoteRange(view);
  const dayNotes = dayNoteRange ? await localCommand("readDayNotes", { profileId, startLocalDate: dayNoteRange.from, endLocalDate: dayNoteRange.to }) : [];
  // Ticket 319: the Mac labels a connector completion from the synced status event's
  // provenance.
  const latestEvents = new Map<string, { statusSemantics: string; sourceCaptureMethod: string; reasonCode: string | null }>();
  for (const event of [...history.statusEvents].sort((left, right) => Temporal.Instant.compare(left.recorded_at, right.recorded_at)
    || Temporal.Instant.compare(left.created_at, right.created_at) || left.id.localeCompare(right.id))) {
    latestEvents.set(event.occurrence_id, { statusSemantics: event.status_semantics, sourceCaptureMethod: event.source_capture_method, reasonCode: event.reason_code });
  }
  // Ticket 320: a linked Mac also lists the synced workout times.
  const matches = (history.sourceMatches ?? []).map((match) => ({ occurrenceId: match.occurrence_id, source: match.source, state: match.state,
    activityStartAt: match.activity_start_at, activityEndAt: match.activity_end_at }));
  const evidence = resolveTimelineSourceEvidence({ timezone: profile.timezone, occurrences, latestEvents, matches });
  return { profile, behaviors, categories, timeline: attachTimelineSourceEvidence(attachTimelineDayNotes(view, dayNotes), evidence) };
}
