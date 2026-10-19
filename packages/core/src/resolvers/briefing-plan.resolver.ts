import { Temporal } from "@js-temporal/polyfill";

import {
  ADVISOR_DAY_CONTEXT_LIMITS,
  type AdvisorCalendarEvent,
  type AdvisorOccurrence,
} from "../types/advisor-day-context";
import {
  BRIEFING_PLAN_LIMITS,
  BRIEFING_PLAN_VERSION,
  type BriefingDayEvidence,
  type BriefingDayEvidenceAssumption,
  type BriefingDayEvidenceCalendarFreshness,
  type BriefingDayEvidenceFinding,
  type BriefingPlanInput,
  type BriefingPlanInterval,
  type BriefingPlanOption,
  type BriefingPlanRejection,
  type BriefingPlanResult,
} from "../types/briefing-plan";

type Block = Readonly<{
  start: Temporal.Instant;
  end: Temporal.Instant;
  endKnown: boolean;
  allDay: boolean;
  calendarEventRef?: string;
  occurrenceRef?: string;
}>;

type OmitFindingIdentity<T> = T extends unknown ? Omit<T, "id" | "rank"> : never;

type DayEvidenceDraft = OmitFindingIdentity<BriefingDayEvidenceFinding> & Readonly<{
  sortAt: Temporal.Instant;
}>;

type DayEvidenceResolution = Readonly<{
  evidence: BriefingDayEvidence;
  noFeasibleOccurrenceRefs: readonly string[];
}>;

type Candidate = Readonly<{
  occurrenceRef: string;
  current: BriefingPlanInterval;
  proposed: BriefingPlanInterval;
  permittedWindow: BriefingPlanInterval;
  durationSource: "context_estimate" | "explicit_input";
  durationReason: string;
  calendarEventRefs: readonly string[];
  fixedOccurrenceRefs: readonly string[];
  distanceMilliseconds: number;
}>;

export function planBriefing(input: BriefingPlanInput): BriefingPlanResult {
  const now = instant(input.now, "now");
  validateInput(input);
  const context = input.context;
  const capturedAt = instant(context.capturedAt, "context.capturedAt");
  const expiresAt = instant(context.expiresAt, "context.expiresAt");
  const connector = context.connectors[0];
  const contextIsCurrent = Temporal.Instant.compare(now, capturedAt) >= 0
    && Temporal.Instant.compare(now, expiresAt) < 0;
  const dayEvidence = resolveDayEvidence(input, now, contextIsCurrent);
  const revisions = {
    configuration: input.configurationRevision,
    snapshot: context.snapshotId,
    cadence: context.cadence.revision,
    grantGeneration: context.grantGeneration,
    calendar: connector && connector.state !== "not_requested" ? {
      connectionGeneration: connector.connectionGeneration,
      selectionRevision: connector.selectionRevision,
      schemaVersion: connector.schemaVersion,
      adapterVersion: connector.adapterVersion,
    } : null,
  };
  const base = {
    version: BRIEFING_PLAN_VERSION,
    generatedAt: now.toString(),
    expiresAt: context.expiresAt,
    revisions,
    dayEvidence: dayEvidence.evidence,
  } as const;

  if (Temporal.Instant.compare(now, capturedAt) < 0) {
    return result(base, "insufficient_context", "no_feasible_option", [], [{
      occurrenceRef: null,
      code: "context_not_yet_valid",
      reason: "The planning clock precedes the captured context.",
    }]);
  }
  if (Temporal.Instant.compare(now, expiresAt) >= 0) {
    return result(base, "insufficient_context", "no_feasible_option", [], [{
      occurrenceRef: null,
      code: "context_expired",
      reason: "The captured context has expired.",
    }]);
  }

  const unresolved = context.cadence.occurrences.some((item) => item.status === "unresolved" && item.localDate === context.localDate);
  const allowed = new Set(input.allowedSuggestionTypes);
  if (!allowed.has("schedule") || input.movableOccurrences.length === 0) {
    const route = allowed.has("priority") && unresolved
      ? "priority_suggestions"
      : allowed.has("recap") ? "recap" : "insufficient_context";
    return result(
      base,
      route,
      route === "insufficient_context" ? "no_feasible_option" : allowed.has("schedule") ? "no_change" : "not_requested",
      [],
      route === "insufficient_context"
        ? [{ occurrenceRef: null, code: "no_allowed_suggestion", reason: "The available facts do not support any enabled suggestion type." }, ...dayEvidenceRejections(dayEvidence)]
        : dayEvidenceRejections(dayEvidence),
    );
  }
  if (!input.fixedCommitmentsComplete) {
    return unavailableResult(base, input, unresolved, "fixed_commitments_incomplete", "All fixed Behavior commitments are required for scheduling options.");
  }
  if (context.status !== "complete") {
    return unavailableResult(base, input, unresolved, "context_partial", "The day context is partial.");
  }
  // Every requested Calendar source must be current and complete; one source never proves another's free time.
  const calendars = requestedCalendars(input);
  if (calendars.length === 0) {
    return unavailableResult(base, input, unresolved, "calendar_missing", "Complete Calendar coverage is required for scheduling options.");
  }
  for (const calendarSource of calendars) {
    if (calendarSource.state !== "current" || !calendarSource.complete || calendarSource.coverage.some((row) => !row.paginationComplete)) {
      return unavailableResult(base, input, unresolved, "calendar_not_current", "Calendar coverage is not current and complete.");
    }
    if (calendarSource.coverage.length === 0) {
      return unavailableResult(base, input, unresolved, "calendar_missing", "Complete Calendar coverage is required for scheduling options.");
    }
    const fetchedAt = calendarSource.fetchedAt ? instant(calendarSource.fetchedAt, "connector.fetchedAt") : null;
    if (
      !fetchedAt
      || Temporal.Instant.compare(fetchedAt, now) > 0
      || Temporal.Instant.compare(now, fetchedAt.add({ milliseconds: ADVISOR_DAY_CONTEXT_LIMITS.freshnessMs })) >= 0
      || calendarSource.coverage.some((row) => row.startLocalDate !== context.localDate || row.endLocalDate !== context.localDate)
    ) {
      return unavailableResult(base, input, unresolved, "calendar_not_current", "Calendar freshness or day coverage is invalid.");
    }
  }

  const occurrences = new Map(context.cadence.occurrences.map((item) => [item.ref, item]));
  const calendarBlocks = calendars.flatMap((calendarSource) => calendarSource.events.flatMap((event) => calendarBlock(event, context)));
  const calendarEventRefs = [...new Set(calendarBlocks.flatMap((block) => block.calendarEventRef ?? []))].sort();
  const rejections: BriefingPlanRejection[] = [...dayEvidenceRejections(dayEvidence)];
  const candidates: Candidate[] = [];
  let noChangeCount = 0;
  let noFeasibleCount = 0;

  for (const movable of [...input.movableOccurrences].sort((left, right) => left.occurrenceRef.localeCompare(right.occurrenceRef))) {
    const occurrence = occurrences.get(movable.occurrenceRef);
    if (!occurrence) {
      noFeasibleCount += 1;
      rejections.push(rejection(movable.occurrenceRef, "occurrence_not_found", "The movable occurrence is absent from the captured context."));
      continue;
    }
    if (occurrence.status !== "unresolved") {
      noFeasibleCount += 1;
      rejections.push(rejection(movable.occurrenceRef, "occurrence_not_unresolved", "Only unresolved occurrences can receive scheduling options."));
      continue;
    }
    const duration = occurrence.duration.kind === "known"
      ? { seconds: occurrence.duration.seconds, source: "context_estimate" as const, reason: occurrence.duration.source }
      : movable.durationAssumption
        ? { seconds: movable.durationAssumption.seconds, source: "explicit_input" as const, reason: movable.durationAssumption.reason }
        : null;
    if (!duration) {
      noFeasibleCount += 1;
      rejections.push(rejection(movable.occurrenceRef, "duration_unknown", "The occurrence has no known duration or explicit duration assumption."));
      continue;
    }

    const currentStart = instant(occurrence.scheduledFor, "occurrence.scheduledFor");
    const current = interval(currentStart, duration.seconds);
    const occurrenceBlocks = fixedOccurrenceBlocks(context.cadence.occurrences, movable.occurrenceRef, context);
    const blocks = [...calendarBlocks, ...occurrenceBlocks];
    const fixedOccurrenceRefs = [...new Set(occurrenceBlocks.flatMap((block) => block.occurrenceRef ?? []))].sort();
    const ranges = movable.permittedWindows
      .flatMap((permittedRange) => freeStartRanges(permittedRange, blocks, duration.seconds, input.policy.bufferMinutes * 60, now))
      .sort((left, right) => Temporal.Instant.compare(left.start, right.start) || Temporal.Instant.compare(left.end, right.end));

    if (ranges.some((range) => contains(range.start, range.end, currentStart))) {
      noChangeCount += 1;
      rejections.push(rejection(movable.occurrenceRef, "no_change_needed", "The current interval already satisfies the checked constraints."));
      continue;
    }
    if (ranges.length > BRIEFING_PLAN_LIMITS.candidatesPerOccurrence) {
      noFeasibleCount += 1;
      rejections.push(rejection(movable.occurrenceRef, "candidate_limit_exceeded", "The bounded candidate limit was exceeded."));
      continue;
    }

    const byStart = new Map<string, Candidate>();
    for (const range of ranges) {
      const proposedStart = input.policy.preference === "earliest"
        ? range.start
        : clamp(currentStart, range.start, range.end);
      const key = proposedStart.toString();
      if (byStart.has(key)) continue;
      byStart.set(key, {
        occurrenceRef: movable.occurrenceRef,
        current,
        proposed: interval(proposedStart, duration.seconds),
        permittedWindow: range.permittedRange,
        durationSource: duration.source,
        durationReason: duration.reason,
        calendarEventRefs,
        fixedOccurrenceRefs,
        distanceMilliseconds: Math.abs(currentStart.until(proposedStart).total({ unit: "milliseconds" })),
      });
    }
    if (byStart.size === 0) {
      noFeasibleCount += 1;
      rejections.push(rejection(movable.occurrenceRef, "no_feasible_window", "No permitted range can fit the occurrence, buffers, and fixed commitments."));
    } else {
      candidates.push(...byStart.values());
    }
  }

  candidates.sort((left, right) => compareCandidates(left, right, input.policy.preference));
  const options = candidates.slice(0, input.alternatives).map((candidate, index): BriefingPlanOption => ({
    id: `option_${index + 1}`,
    occurrenceRef: candidate.occurrenceRef,
    intervals: { current: candidate.current, proposed: candidate.proposed },
    assumptions: [{
      kind: "duration",
      source: candidate.durationSource,
      seconds: candidate.proposed.duration.seconds,
      reason: candidate.durationReason,
    }],
    constraints: {
      permittedWindow: candidate.permittedWindow,
      bufferBeforeSeconds: input.policy.bufferMinutes * 60,
      bufferAfterSeconds: input.policy.bufferMinutes * 60,
      calendarEventRefs: candidate.calendarEventRefs,
      fixedOccurrenceRefs: candidate.fixedOccurrenceRefs,
    },
    reasons: [
      "current_interval_conflicts",
      input.policy.preference === "earliest" ? "earliest_feasible" : "least_change_feasible",
    ],
  }));
  const uniqueRejections = [...new Map(rejections.map((item) => [`${item.occurrenceRef ?? ""}:${item.code}`, item])).values()]
    .sort((left, right) => (left.occurrenceRef ?? "").localeCompare(right.occurrenceRef ?? "") || left.code.localeCompare(right.code));

  if (options.length > 0) return result(base, "scheduling_options", "options", options, uniqueRejections);
  return result(
    base,
    "scheduling_options",
    noFeasibleCount > 0 ? "no_feasible_option" : noChangeCount > 0 ? "no_change" : "no_feasible_option",
    [],
    uniqueRejections,
  );
}

function resolveDayEvidence(
  input: BriefingPlanInput,
  now: Temporal.Instant,
  contextIsCurrent: boolean,
): DayEvidenceResolution {
  const context = input.context;
  const calendars = requestedCalendars(input);
  const calendar = calendarFreshness(input, now, contextIsCurrent);
  const fetchedAt = calendars.map((item) => item.fetchedAt).filter((value): value is string => value !== null)
    .sort((left, right) => Temporal.Instant.compare(Temporal.Instant.from(left), Temporal.Instant.from(right)))[0] ?? null;
  const cadenceObservedAt = instant(context.cadence.observedAt, "context.cadence.observedAt");
  const cadenceCurrent = contextIsCurrent
    && Temporal.Instant.compare(cadenceObservedAt, now) <= 0
    && Temporal.Instant.compare(now, cadenceObservedAt.add({ milliseconds: ADVISOR_DAY_CONTEXT_LIMITS.freshnessMs })) < 0;
  const cadenceComplete = cadenceCurrent && input.fixedCommitmentsComplete;
  const canClaimFeasibleOpportunities = cadenceComplete
    && context.status === "complete"
    && calendar === "current_complete";
  const coverage = {
    cadence: cadenceComplete ? "complete" as const : "partial" as const,
    calendar,
    canClaimFeasibleOpportunities,
  };
  const empty = (): DayEvidenceResolution => ({
    evidence: {
      coverage,
      freshness: { capturedAt: context.capturedAt, expiresAt: context.expiresAt, calendarFetchedAt: fetchedAt },
      findings: [],
      omittedFindingCount: 0,
    },
    noFeasibleOccurrenceRefs: [],
  });
  if (!cadenceCurrent) return empty();

  const dayStart = instant(context.dayStartAt, "context.dayStartAt");
  const dayEnd = instant(context.dayEndAt, "context.dayEndAt");
  const remaining = context.cadence.occurrences
    .filter((occurrence) => occurrence.status === "unresolved" && occurrence.localDate === context.localDate)
    .filter((occurrence) => {
      const start = instant(occurrence.scheduledFor, "occurrence.scheduledFor");
      return Temporal.Instant.compare(start, dayStart) >= 0 && Temporal.Instant.compare(start, dayEnd) < 0;
    })
    .sort((left, right) => left.ref.localeCompare(right.ref));
  // Known events from each current source stay observable when another source is missing.
  const observedCalendarBlocks = calendar === "current_complete" || calendar === "current_partial"
    ? calendars.filter((item) => isCurrentFreshness(sourceFreshness(input, item, now, contextIsCurrent)))
      .flatMap((item) => item.events.flatMap((event) => calendarBlock(event, context)))
    : [];
  const drafts: DayEvidenceDraft[] = [];
  const bufferSeconds = input.policy.bufferMinutes * 60;

  // ponytail: Pair scans are bounded by 200 Occurrences and 500 events; use an interval sweep if those caps grow.
  for (let index = 0; index < remaining.length; index += 1) {
    const occurrence = remaining[index]!;
    const known = knownOccurrenceInterval(occurrence, context.timezone);
    if (!known) continue;
    for (let peerIndex = index + 1; peerIndex < remaining.length; peerIndex += 1) {
      const peer = remaining[peerIndex]!;
      const peerKnown = knownOccurrenceInterval(peer, context.timezone);
      if (!peerKnown) continue;
      addPairEvidence(drafts, known, peerKnown, {
        occurrenceRefs: [occurrence.ref, peer.ref].sort(),
        calendarEventRefs: [],
      }, [...known.assumptions, ...peerKnown.assumptions], calendar, bufferSeconds, now, dayEnd);
    }
    for (const block of observedCalendarBlocks) {
      if (block.allDay || !block.endKnown || !block.calendarEventRef) continue;
      addPairEvidence(drafts, known, { start: block.start, end: block.end, assumptions: [] }, {
        occurrenceRefs: [occurrence.ref],
        calendarEventRefs: [block.calendarEventRef],
      }, known.assumptions, calendar, bufferSeconds, now, dayEnd);
    }
  }
  const knownCalendarBlocks = observedCalendarBlocks.filter((block) => !block.allDay && block.endKnown && block.calendarEventRef);
  for (let index = 0; index < knownCalendarBlocks.length; index += 1) {
    const block = knownCalendarBlocks[index]!;
    for (let peerIndex = index + 1; peerIndex < knownCalendarBlocks.length; peerIndex += 1) {
      const peer = knownCalendarBlocks[peerIndex]!;
      addPairEvidence(drafts, { start: block.start, end: block.end, assumptions: [] },
        { start: peer.start, end: peer.end, assumptions: [] }, {
          occurrenceRefs: [],
          calendarEventRefs: [block.calendarEventRef!, peer.calendarEventRef!].sort(),
        }, [], calendar, bufferSeconds, now, dayEnd);
    }
  }

  const noFeasibleOccurrenceRefs: string[] = [];
  const permittedWindows = input.permittedWindows ?? [];
  for (const occurrence of remaining) {
    const duration = occurrence.duration;
    let unknownBlockerOccurrenceRefs: string[] = [];
    let unknownBlockerCalendarRefs: string[] = [];
    const reasons: Array<Extract<BriefingDayEvidenceFinding, { kind: "unknown_feasibility" }>["reasons"][number]> = [];
    const known = knownOccurrenceInterval(occurrence, context.timezone);
    if (!known || duration.kind !== "known") reasons.push("duration_unknown");
    if (calendar === "missing") reasons.push("calendar_missing");
    else if (calendar === "stale") reasons.push("calendar_stale");
    else if (calendar !== "current_complete" || context.status !== "complete") reasons.push("calendar_incomplete");
    if (!input.fixedCommitmentsComplete) reasons.push("fixed_commitments_incomplete");
    if (permittedWindows.length === 0) reasons.push("no_permitted_window");

    if (reasons.length === 0 && canClaimFeasibleOpportunities && duration.kind === "known") {
      const occurrenceBlocks = fixedOccurrenceBlocks(remaining, occurrence.ref, context);
      const blocks = [...observedCalendarBlocks, ...occurrenceBlocks].filter((block) =>
        Temporal.Instant.compare(block.end.add({ seconds: bufferSeconds }), now) > 0
        && permittedWindows.some((permittedWindow) => overlaps(
          instant(permittedWindow.startAt, "permitted range startAt"),
          instant(permittedWindow.endAt, "permitted range endAt"),
          block.start,
          block.end,
        )));
      const ranges = permittedWindows
        .flatMap((permittedWindow) => freeStartRanges(permittedWindow, blocks, duration.seconds, bufferSeconds, now))
        .sort((left, right) => Temporal.Instant.compare(left.start, right.start) || Temporal.Instant.compare(left.end, right.end));
      const first = ranges[0];
      if (first) {
        const proposed = interval(first.start, duration.seconds);
        drafts.push({
          kind: "feasible_opportunity",
          occurrenceRef: occurrence.ref,
          interval: proposed,
          permittedWindow: first.permittedRange,
          hypotheticalMoveRequired: first.start.toString() !== instant(occurrence.scheduledFor, "occurrence.scheduledFor").toString(),
          refs: {
            occurrenceRefs: [...new Set([occurrence.ref, ...blocks.flatMap((block) => block.occurrenceRef ?? [])])].sort(),
            calendarEventRefs: blockCalendarRefs(blocks),
          },
          assumptions: [durationAssumption(occurrence), { kind: "buffer", seconds: bufferSeconds }],
          freshness: calendar,
          sortAt: first.start,
        });
      } else {
        const knownRanges = permittedWindows.flatMap((permittedWindow) =>
          freeStartRanges(permittedWindow, blocks.filter((block) => block.endKnown), duration.seconds, bufferSeconds, now));
        if (knownRanges.length > 0 && blocks.some((block) => !block.endKnown)) {
          reasons.push("unknown_blocker_end");
          unknownBlockerOccurrenceRefs = [...new Set(blocks.filter((block) => !block.endKnown).flatMap((block) => block.occurrenceRef ?? []))].sort();
          unknownBlockerCalendarRefs = [...new Set(blocks.filter((block) => !block.endKnown).flatMap((block) => block.calendarEventRef ?? []))].sort();
        } else {
          noFeasibleOccurrenceRefs.push(occurrence.ref);
        }
      }
    }
    if (reasons.length > 0) {
      drafts.push({
        kind: "unknown_feasibility",
        occurrenceRef: occurrence.ref,
        reasons: [...new Set(reasons)],
        refs: {
          occurrenceRefs: [...new Set([occurrence.ref, ...unknownBlockerOccurrenceRefs])].sort(),
          calendarEventRefs: unknownBlockerCalendarRefs.length > 0 ? unknownBlockerCalendarRefs : observedCalendarBlocks.filter((block) => !block.endKnown
            && Temporal.Instant.compare(block.end, now) > 0
            && permittedWindows.some((permittedWindow) => overlaps(
              instant(permittedWindow.startAt, "permitted range startAt"), instant(permittedWindow.endAt, "permitted range endAt"), block.start, block.end,
            ))).flatMap((block) => block.calendarEventRef ?? []).sort(),
        },
        assumptions: bufferSeconds > 0 ? [{ kind: "buffer", seconds: bufferSeconds }] : [],
        freshness: calendar,
        sortAt: later(now, instant(occurrence.scheduledFor, "occurrence.scheduledFor")),
      });
    }
  }

  drafts.sort(compareDayEvidence);
  const selected = drafts.slice(0, BRIEFING_PLAN_LIMITS.dayEvidenceFindings);
  const findings = selected.map((draft, index): BriefingDayEvidenceFinding => ({
    ...Object.fromEntries(Object.entries(draft).filter(([key]) => key !== "sortAt")),
    id: `evidence_${index + 1}`,
    rank: index + 1,
  } as BriefingDayEvidenceFinding));
  return {
    evidence: {
      coverage,
      freshness: { capturedAt: context.capturedAt, expiresAt: context.expiresAt, calendarFetchedAt: fetchedAt },
      findings,
      omittedFindingCount: drafts.length - findings.length,
    },
    noFeasibleOccurrenceRefs,
  };
}

function addPairEvidence(
  drafts: DayEvidenceDraft[],
  left: Readonly<{ start: Temporal.Instant; end: Temporal.Instant; assumptions: readonly BriefingDayEvidenceAssumption[] }>,
  right: Readonly<{ start: Temporal.Instant; end: Temporal.Instant; assumptions: readonly BriefingDayEvidenceAssumption[] }>,
  refs: BriefingDayEvidenceFinding["refs"],
  assumptions: readonly BriefingDayEvidenceAssumption[],
  freshness: BriefingDayEvidenceCalendarFreshness,
  bufferSeconds: number,
  now: Temporal.Instant,
  dayEnd: Temporal.Instant,
): void {
  const overlapStart = later(now, later(left.start, right.start));
  const overlapEnd = earlier(dayEnd, earlier(left.end, right.end));
  if (Temporal.Instant.compare(overlapStart, overlapEnd) < 0) {
    drafts.push({ kind: "known_overlap", interval: intervalBetween(overlapStart, overlapEnd), refs,
      assumptions: dedupeAssumptions(assumptions), freshness, sortAt: overlapStart });
    return;
  }
  if (bufferSeconds === 0) return;
  const gap = Temporal.Instant.compare(left.end, right.start) <= 0
    ? { start: left.end, end: right.start }
    : Temporal.Instant.compare(right.end, left.start) <= 0
      ? { start: right.end, end: left.start }
      : null;
  if (!gap || Temporal.Instant.compare(gap.end, now) <= 0) return;
  const availableSeconds = gap.start.until(gap.end).total({ unit: "seconds" });
  if (availableSeconds >= bufferSeconds) return;
  const visibleStart = later(now, gap.start);
  drafts.push({
    kind: "tight_transition",
    interval: intervalBetween(visibleStart, gap.end),
    availableSeconds,
    requiredBufferSeconds: bufferSeconds,
    refs,
    assumptions: dedupeAssumptions([...assumptions, { kind: "buffer", seconds: bufferSeconds }]),
    freshness,
    sortAt: visibleStart,
  });
}

function calendarFreshness(
  input: BriefingPlanInput,
  now: Temporal.Instant,
  contextIsCurrent: boolean,
): BriefingDayEvidenceCalendarFreshness {
  const states = requestedCalendars(input).map((item) => sourceFreshness(input, item, now, contextIsCurrent));
  if (states.length === 0 || states.every((state) => state === "missing")) return "missing";
  if (states.length === 1) return states[0]!;
  // Several sources: any stale source makes the combined view stale; any gap makes it partial.
  if (states.includes("stale")) return "stale";
  return states.every((state) => state === "current_complete") ? "current_complete" : "current_partial";
}

type PlannerCalendar = NonNullable<BriefingPlanInput["additionalCalendars"]>[number];

/** Google from the `1.0` view first, then separately disclosed Outlook or iCloud sources (Ticket 226). */
function requestedCalendars(input: BriefingPlanInput): readonly PlannerCalendar[] {
  const google = input.context.connectors[0];
  return [...(google && google.state !== "not_requested" ? [google] : []), ...(input.additionalCalendars ?? [])];
}

function isCurrentFreshness(state: BriefingDayEvidenceCalendarFreshness): boolean {
  return state === "current_complete" || state === "current_partial";
}

function sourceFreshness(
  input: BriefingPlanInput,
  connector: PlannerCalendar,
  now: Temporal.Instant,
  contextIsCurrent: boolean,
): BriefingDayEvidenceCalendarFreshness {
  if (connector.state === "unavailable" || !connector.fetchedAt) return "missing";
  const fetchedAt = instant(connector.fetchedAt, "connector.fetchedAt");
  if (!contextIsCurrent || connector.state === "stale" || Temporal.Instant.compare(fetchedAt, now) > 0
    || Temporal.Instant.compare(now, fetchedAt.add({ milliseconds: ADVISOR_DAY_CONTEXT_LIMITS.freshnessMs })) >= 0) return "stale";
  // The `1.0` view's status reflects Google only; added sources carry their own completeness.
  const statusComplete = connector.source !== "google_calendar" || input.context.status === "complete";
  const complete = statusComplete && connector.state === "current" && connector.complete
    && connector.coverage.length > 0 && connector.coverage.every((row) => row.paginationComplete
      && row.startLocalDate === input.context.localDate && row.endLocalDate === input.context.localDate);
  return complete ? "current_complete" : "current_partial";
}

function knownOccurrenceInterval(
  occurrence: AdvisorOccurrence,
  timezone: string,
): Readonly<{ start: Temporal.Instant; end: Temporal.Instant; assumptions: readonly BriefingDayEvidenceAssumption[] }> | null {
  const start = instant(occurrence.scheduledFor, "occurrence.scheduledFor");
  if (occurrence.duration.kind !== "known") return null;
  durationSeconds(occurrence.duration.seconds, "occurrence.duration.seconds");
  const durationEnd = start.add({ milliseconds: durationMilliseconds(occurrence.duration.seconds) });
  const reservedEnd = occurrence.schedule.kind === "range" ? rangeEnd(occurrence, timezone) : null;
  return {
    start,
    end: reservedEnd ? later(reservedEnd, durationEnd) : durationEnd,
    assumptions: [durationAssumption(occurrence), ...(reservedEnd ? [{
      kind: "reserved_range" as const,
      occurrenceRef: occurrence.ref,
      interval: intervalBetween(start, reservedEnd),
    }] : [])],
  };
}

function durationAssumption(occurrence: AdvisorOccurrence): BriefingDayEvidenceAssumption {
  if (occurrence.duration.kind !== "known") throw new Error("Known duration evidence requires a known duration.");
  return { kind: "duration", occurrenceRef: occurrence.ref, source: "context_estimate", seconds: occurrence.duration.seconds, reason: occurrence.duration.source };
}

function blockCalendarRefs(blocks: readonly Block[]): string[] {
  return [...new Set(blocks.flatMap((block) => block.calendarEventRef ?? []))].sort();
}

function dedupeAssumptions(assumptions: readonly BriefingDayEvidenceAssumption[]): BriefingDayEvidenceAssumption[] {
  return [...new Map(assumptions.map((item) => [JSON.stringify(item), item])).values()];
}

function compareDayEvidence(left: DayEvidenceDraft, right: DayEvidenceDraft): number {
  const priority = { known_overlap: 0, tight_transition: 1, feasible_opportunity: 2, unknown_feasibility: 3 } as const;
  return priority[left.kind] - priority[right.kind]
    || Temporal.Instant.compare(left.sortAt, right.sortAt)
    || left.refs.occurrenceRefs.join("\0").localeCompare(right.refs.occurrenceRefs.join("\0"))
    || left.refs.calendarEventRefs.join("\0").localeCompare(right.refs.calendarEventRefs.join("\0"));
}

function dayEvidenceRejections(resolution: DayEvidenceResolution): BriefingPlanRejection[] {
  return resolution.noFeasibleOccurrenceRefs.map((occurrenceRef) => rejection(
    occurrenceRef,
    "no_feasible_window",
    "No configured range can fit the occurrence, buffers, and known commitments.",
  ));
}

export function validateBriefingPlanOptionIds(
  plan: BriefingPlanResult,
  optionIds: readonly string[],
): readonly BriefingPlanOption[] | null {
  if (optionIds.length > BRIEFING_PLAN_LIMITS.alternatives || new Set(optionIds).size !== optionIds.length) return null;
  const options = new Map(plan.options.map((option) => [option.id, option]));
  const selected = optionIds.map((id) => options.get(id));
  return selected.every((option): option is BriefingPlanOption => option !== undefined) ? selected : null;
}

function unavailableResult(
  base: Pick<BriefingPlanResult, "version" | "generatedAt" | "expiresAt" | "revisions" | "dayEvidence">,
  input: BriefingPlanInput,
  unresolved: boolean,
  code: "calendar_missing" | "calendar_not_current" | "context_partial" | "fixed_commitments_incomplete",
  reason: string,
): BriefingPlanResult {
  const route = input.allowedSuggestionTypes.includes("priority") && unresolved
    ? "priority_suggestions"
    : "insufficient_context";
  return result(base, route, "no_feasible_option", [], [{ occurrenceRef: null, code, reason }]);
}

function result(
  base: Pick<BriefingPlanResult, "version" | "generatedAt" | "expiresAt" | "revisions" | "dayEvidence">,
  route: BriefingPlanResult["route"],
  outcome: BriefingPlanResult["outcome"],
  options: readonly BriefingPlanOption[],
  rejections: readonly BriefingPlanRejection[],
): BriefingPlanResult {
  return { ...base, route, outcome, options, rejections };
}

function rejection(
  occurrenceRef: string,
  code: BriefingPlanRejection["code"],
  reason: string,
): BriefingPlanRejection {
  return { occurrenceRef, code, reason };
}

function fixedOccurrenceBlocks(
  occurrences: readonly AdvisorOccurrence[],
  movingRef: string,
  context: BriefingPlanInput["context"],
): Block[] {
  const dayEnd = instant(context.dayEndAt, "context.dayEndAt");
  return occurrences.flatMap((occurrence): Block[] => {
    if (occurrence.ref === movingRef || occurrence.status !== "unresolved" || occurrence.localDate !== context.localDate) return [];
    const start = instant(occurrence.scheduledFor, "occurrence.scheduledFor");
    const known = knownOccurrenceInterval(occurrence, context.timezone);
    const end = known?.end ?? (occurrence.schedule.kind === "range"
      ? later(rangeEnd(occurrence, context.timezone), dayEnd)
      : dayEnd);
    return Temporal.Instant.compare(end, start) > 0 ? [{
      start,
      end,
      endKnown: occurrence.duration.kind === "known",
      allDay: false,
      occurrenceRef: occurrence.ref,
    }] : [];
  });
}

function rangeEnd(occurrence: AdvisorOccurrence, timezone: string): Temporal.Instant {
  if (!occurrence.schedule.endTime) throw new Error("Range occurrences require an end time.");
  const date = Temporal.PlainDate.from(occurrence.localDate);
  const startTime = Temporal.PlainTime.from(occurrence.schedule.startTime);
  const endTime = Temporal.PlainTime.from(occurrence.schedule.endTime);
  const endDate = Temporal.PlainTime.compare(endTime, startTime) <= 0 ? date.add({ days: 1 }) : date;
  return endDate.toPlainDateTime(endTime).toZonedDateTime(timezone, { disambiguation: "compatible" }).toInstant();
}

function calendarBlock(event: AdvisorCalendarEvent, context: BriefingPlanInput["context"]): Block[] {
  if (event.state === "cancelled" || event.availability === "free" || event.currentUserResponse === "declined") return [];
  if (event.interval.kind === "all_day") {
    const start = Temporal.PlainDate.from(event.interval.startLocalDate).toZonedDateTime(context.timezone).toInstant();
    const end = Temporal.PlainDate.from(event.interval.endLocalDate).toZonedDateTime(context.timezone).toInstant();
    return [{ start, end, endKnown: true, allDay: true, calendarEventRef: event.ref }];
  }
  const start = instant(event.interval.startAt, "calendar event startAt");
  const end = event.interval.duration.kind === "known"
    ? instant(event.interval.endAt, "calendar event endAt")
    : instant(context.dayEndAt, "context.dayEndAt");
  return Temporal.Instant.compare(end, start) > 0 ? [{
    start,
    end,
    endKnown: event.interval.duration.kind === "known",
    allDay: false,
    calendarEventRef: event.ref,
  }] : [];
}

function freeStartRanges(
  permittedRange: BriefingPlanInterval,
  blocks: readonly Block[],
  durationSeconds: number,
  bufferSeconds: number,
  now: Temporal.Instant,
): ReadonlyArray<Readonly<{ start: Temporal.Instant; end: Temporal.Instant; permittedRange: BriefingPlanInterval }>> {
  const rangeStart = instant(permittedRange.startAt, "permitted range startAt");
  const rangeEnd = instant(permittedRange.endAt, "permitted range endAt");
  const relevant = blocks
    .filter((block) => overlaps(rangeStart, rangeEnd, block.start, block.end))
    .sort((left, right) => Temporal.Instant.compare(left.start, right.start) || Temporal.Instant.compare(left.end, right.end));
  const gaps: Array<Readonly<{ start: Temporal.Instant; end: Temporal.Instant }>> = [];
  let cursor = rangeStart;
  for (const block of relevant) {
    const blockStart = later(rangeStart, block.start);
    const blockEnd = earlier(rangeEnd, block.end);
    if (Temporal.Instant.compare(blockStart, cursor) > 0) gaps.push({ start: cursor, end: blockStart });
    cursor = later(cursor, blockEnd);
  }
  if (Temporal.Instant.compare(cursor, rangeEnd) < 0) gaps.push({ start: cursor, end: rangeEnd });

  return gaps.flatMap((gap) => {
    const start = later(now, gap.start.add({ seconds: bufferSeconds }));
    const end = gap.end.subtract({ milliseconds: durationMilliseconds(durationSeconds + bufferSeconds) });
    return Temporal.Instant.compare(start, end) <= 0 ? [{ start, end, permittedRange }] : [];
  });
}

function compareCandidates(left: Candidate, right: Candidate, preference: BriefingPlanInput["policy"]["preference"]): number {
  if (preference === "least_change" && left.distanceMilliseconds !== right.distanceMilliseconds) {
    return left.distanceMilliseconds - right.distanceMilliseconds;
  }
  return Temporal.Instant.compare(instant(left.proposed.startAt, "candidate start"), instant(right.proposed.startAt, "candidate start"))
    || left.occurrenceRef.localeCompare(right.occurrenceRef);
}

function interval(start: Temporal.Instant, seconds: number): BriefingPlanInterval {
  return {
    kind: "timed",
    startAt: start.toString(),
    endAt: start.add({ milliseconds: durationMilliseconds(seconds) }).toString(),
    duration: { kind: "known", seconds },
  };
}

function intervalBetween(start: Temporal.Instant, end: Temporal.Instant): BriefingPlanInterval {
  return {
    kind: "timed",
    startAt: start.toString(),
    endAt: end.toString(),
    duration: { kind: "known", seconds: start.until(end).total({ unit: "seconds" }) },
  };
}

function validateInput(input: BriefingPlanInput): void {
  if (!input.configurationRevision) throw new Error("configurationRevision must be non-empty.");
  if (!Number.isInteger(input.alternatives) || input.alternatives < 1 || input.alternatives > BRIEFING_PLAN_LIMITS.alternatives) {
    throw new Error(`alternatives must be from 1 to ${BRIEFING_PLAN_LIMITS.alternatives}.`);
  }
  const allowed = new Set(input.allowedSuggestionTypes);
  if (allowed.size !== input.allowedSuggestionTypes.length || allowed.size === 0 || [...allowed].some((item) => !["recap", "priority", "schedule"].includes(item))) {
    throw new Error("allowedSuggestionTypes must be non-empty, unique, and supported.");
  }
  if (!Number.isInteger(input.policy.bufferMinutes) || input.policy.bufferMinutes < 0 || input.policy.bufferMinutes > 60) {
    throw new Error("policy.bufferMinutes must be from 0 to 60.");
  }
  if (input.policy.preference !== "earliest" && input.policy.preference !== "least_change") {
    throw new Error("policy.preference is unsupported.");
  }
  if (typeof input.fixedCommitmentsComplete !== "boolean") throw new Error("fixedCommitmentsComplete must be boolean.");
  const added = (input.additionalCalendars ?? []).map((item) => item.source);
  if (added.some((source) => source !== "outlook_calendar" && source !== "icloud_calendar") || new Set(added).size !== added.length) {
    throw new Error("additionalCalendars must list Outlook or iCloud at most once each.");
  }
  if (input.movableOccurrences.length > BRIEFING_PLAN_LIMITS.movableOccurrences) {
    throw new Error("movableOccurrences exceeds its limit.");
  }
  const dayStart = instant(input.context.dayStartAt, "context.dayStartAt");
  const dayEnd = instant(input.context.dayEndAt, "context.dayEndAt");
  const refs = new Set<string>();
  const commonWindows = input.permittedWindows ?? [];
  if (commonWindows.length > BRIEFING_PLAN_LIMITS.windowsPerOccurrence) throw new Error("Common permittedWindows count is invalid.");
  let windowCount = 0;
  for (const permittedRange of commonWindows) validatePermittedWindow(permittedRange, dayStart, dayEnd);
  for (const movable of input.movableOccurrences) {
    if (!movable.occurrenceRef || refs.has(movable.occurrenceRef)) throw new Error("Movable occurrence refs must be non-empty and unique.");
    refs.add(movable.occurrenceRef);
    if (movable.permittedWindows.length > BRIEFING_PLAN_LIMITS.windowsPerOccurrence) {
      throw new Error("permittedWindows count is invalid.");
    }
    windowCount += movable.permittedWindows.length;
    if (movable.durationAssumption) {
      positiveSeconds(movable.durationAssumption.seconds, "durationAssumption.seconds");
      if (!movable.durationAssumption.reason) throw new Error("durationAssumption.reason must be non-empty.");
    }
    for (const permittedRange of movable.permittedWindows) {
      validatePermittedWindow(permittedRange, dayStart, dayEnd);
    }
  }
  if (windowCount > BRIEFING_PLAN_LIMITS.totalWindows) throw new Error("permittedWindows exceeds the total limit.");
}

function validatePermittedWindow(
  permittedRange: BriefingPlanInterval,
  dayStart: Temporal.Instant,
  dayEnd: Temporal.Instant,
): void {
  const start = instant(permittedRange.startAt, "permitted range startAt");
  const end = instant(permittedRange.endAt, "permitted range endAt");
  const seconds = permittedRangeSeconds(permittedRange.duration.seconds);
  if (Temporal.Instant.compare(start, dayStart) < 0 || Temporal.Instant.compare(end, dayEnd) > 0 || Temporal.Instant.compare(end, start) <= 0) {
    throw new Error("Permitted windows must fall within the captured local day.");
  }
  if (Math.abs(start.until(end).total({ unit: "seconds" }) - seconds) > 0.001) {
    throw new Error("Permitted range duration must match its interval.");
  }
}

function durationSeconds(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 86_400) throw new Error(`${label} must be from 0 to 86,400 seconds.`);
  return value;
}

function durationMilliseconds(seconds: number): number {
  const milliseconds = Math.ceil(seconds * 1_000);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error("Duration milliseconds are invalid.");
  return milliseconds;
}

function positiveSeconds(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400) throw new Error(`${label} must be a whole number from 1 to 86,400.`);
  return value;
}

function permittedRangeSeconds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 172_800) {
    throw new Error("permitted range duration.seconds must be a whole number from 1 to 172,800.");
  }
  return value;
}

function instant(value: string, label: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new Error(`${label} is invalid.`);
  }
}

function overlaps(leftStart: Temporal.Instant, leftEnd: Temporal.Instant, rightStart: Temporal.Instant, rightEnd: Temporal.Instant): boolean {
  return Temporal.Instant.compare(leftStart, rightEnd) < 0 && Temporal.Instant.compare(rightStart, leftEnd) < 0;
}

function contains(start: Temporal.Instant, end: Temporal.Instant, value: Temporal.Instant): boolean {
  return Temporal.Instant.compare(start, value) <= 0 && Temporal.Instant.compare(value, end) <= 0;
}

function clamp(value: Temporal.Instant, start: Temporal.Instant, end: Temporal.Instant): Temporal.Instant {
  return later(start, earlier(value, end));
}

function later(left: Temporal.Instant, right: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(left, right) >= 0 ? left : right;
}

function earlier(left: Temporal.Instant, right: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(left, right) <= 0 ? left : right;
}
