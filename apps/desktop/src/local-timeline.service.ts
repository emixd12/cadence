import { Temporal } from "@js-temporal/polyfill";
import { resolveGenerationWindow } from "@cadence/core/resolvers/occurrence.resolver";
import { resolvePersistedTimeline } from "@cadence/core/services/timeline.service";
import { localCommand } from "./local-store";
import { ensureLocalOccurrencesFresh, toLocalBehaviorGraphRecord } from "./local-generation.service";
import { toTimeSession } from "./local-occurrence.service";
import { withLocalMoves } from "./local-moves.service";
import { attachTimelineDayNotes, timelineDayNoteRange } from "@cadence/core/resolvers/day-note.resolver";
import { attachTimelineSourceEvidence, resolveTimelineSourceEvidence } from "@cadence/core/services/timeline-source-evidence";
import { attachTimelineAlongside } from "@cadence/core/services/timeline-alongside";
import {
  alongsideFormViews, alongsideQuestionBehaviorIds, alongsideRowViews, buildAlongsideBehaviorFacts,
} from "@cadence/core/services/alongside-facts";
import { EFFECTIVE_WHERE_EVIDENCE_PERIOD_DAYS, type EffectiveWhereLabel } from "@cadence/core/resolvers/effective-where.resolver";
import type { AlongsideFormView } from "@cadence/core/resolvers/alongside.resolver";
import type { DesktopAlongsideContext } from "./alongside";
import type { LocalPlaceLabelRows } from "./local-place-labels.service";

/**
 * `alongside` (Ticket 363): the Mac's alongside context, or null when no alongside surface
 * shows. With it, rows carry the label and the row question as on the web, built from the
 * local answer, local completion place labels and the linked account's guesses.
 */
export async function loadLocalTimeline(futureDays = 7, now = Temporal.Now.instant(), alongside: DesktopAlongsideContext | null = null) {
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
  // Advisor Phase 2B: a moved Occurrence sits at its moved time; the planned time stays on the row.
  const occurrences = await withLocalMoves(profileId, [...priorUnresolved, ...visibleOccurrences]);
  const history = await localCommand("readOccurrenceHistory", { profileId, occurrenceIds: occurrences.map(({ id }) => id) });
  const historyOccurrences = await localCommand("readOccurrences", { profileId,
    startLocalDate: "0001-01-01", endLocalDate: priorDate });
  const durationHistory = await localCommand("readOccurrenceHistory", { profileId,
    occurrenceIds: historyOccurrences.map(({ id }) => id) });
  const behaviors = graphs.map((graph) => toLocalBehaviorGraphRecord(graph, categories));
  // Behaviors of Opportunity: the same Remove facts the web reads, from the local history.
  const removalFacts = {
    statusHistoryOccurrenceIds: new Set(history.statusEvents.map((event) => event.occurrence_id)),
    activeSourceMatchOccurrenceIds: new Set((history.sourceMatches ?? [])
      .filter((match) => match.state === "active").map((match) => match.occurrence_id)),
  };
  const view = resolvePersistedTimeline({ removalFacts, durationHistory: { occurrences: historyOccurrences, timeSessions: durationHistory.timeSessions.map(toTimeSession) }, behaviors, occurrences, timeSessions: history.timeSessions.map(toTimeSession),
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
  const timeline = attachTimelineSourceEvidence(attachTimelineDayNotes(view, dayNotes), evidence);
  if (!alongside) return { profile, behaviors, categories, timeline, alongsideViews: null };
  const facts = buildAlongsideBehaviorFacts({
    behaviors: behaviors.map((behavior) => ({ id: behavior.id, alongside: behavior.alongside,
      whereKind: behavior.where_kind ?? null, locationText: behavior.location_text ?? null })),
    guesses: alongside.guesses, labels: await readLocalAlongsideLabels(profileId, view.todayLocalDate), localDate: view.todayLocalDate,
  });
  const alongsideViews: Readonly<Record<string, AlongsideFormView>> = alongsideFormViews(facts) ?? {};
  return { profile, behaviors, categories, alongsideViews,
    timeline: attachTimelineAlongside(timeline, alongsideRowViews(facts), alongsideQuestionBehaviorIds(facts)) };
}

/** Completion place labels inside the evidence period, by Behavior (labels only, never positions). */
async function readLocalAlongsideLabels(profileId: string, localDate: string): Promise<ReadonlyMap<string, EffectiveWhereLabel[]>> {
  const first = Temporal.PlainDate.from(localDate).subtract({ days: EFFECTIVE_WHERE_EVIDENCE_PERIOD_DAYS - 1 }).toString();
  const rows = await localCommand("readPlaceLabels", { profileId }) as LocalPlaceLabelRows;
  const labels = new Map<string, EffectiveWhereLabel[]>();
  for (const row of rows.labels) {
    if (row.local_date < first || row.local_date > localDate) continue;
    labels.set(row.behavior_id, [...(labels.get(row.behavior_id) ?? []), { label: row.label, localDate: row.local_date }]);
  }
  return labels;
}
