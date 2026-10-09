import { Temporal } from "@js-temporal/polyfill";
import {
  BRIEFING_ANALYSIS_LANE_IDS,
  BRIEFING_ANALYSIS_VERSION,
  type BriefingAnalysisConfigurationPeriod,
  type BriefingAnalysisLaneContract,
  type BriefingAnalysisLaneId,
  type BriefingAnalysisLaneResult,
  type BriefingAnalysisLimitation,
  type BriefingAnalysisOccurrence,
  type BriefingAnalysisResult,
  type BriefingAnalysisSource,
  type BriefingAnalysisStatusEvent,
  type BriefingAnalysisUnavailableReason,
  type BriefingFinding,
} from "../types/briefing-analysis";

/**
 * Sufficiency and materiality thresholds. Tests derive expected findings from
 * hand-checked fixtures against these values, never from the implementation.
 */
export const BRIEFING_ANALYSIS_THRESHOLDS = Object.freeze({
  weekday: { minResolved: 4, minDistinctWeeks: 4, minBaselineResolved: 8, maxUnresolvedShare: 0.5, minGap: 0.3 },
  slot: { minResolved: 6, minBaselineResolved: 6, maxUnresolvedShare: 0.5, minGap: 0.3 },
  timing: { minSamples: 5, minDistinctDates: 5, minMedianLagMinutes: 90, consistentLagMinutes: 45, minConsistentShare: 0.7 },
  load: { minStableDays: 28, heavyAboveMedian: 2, minStrata: 2, minDaysPerSide: 2, minResolvedPerSide: 3, minHeavyResolved: 12, minWeightedGap: 0.2, minConsistentStrataShare: 2 / 3 },
  decisionDebt: { minUnresolved: 5, minUnresolvedShare: 0.3 },
  chronology: { minDecisions: 10, minLateShare: 0.4, batchMinutes: 10, batchSize: 3 },
  corrections: { minCorrected: 4, minCorrectedShare: 0.15 },
  reminders: { minResolvedPerGroup: 8, minTotalPerGroup: 10, minGap: 0.2 },
  notes: { minNotes: 3, minDistinctDates: 2, maxEvidence: 12 },
  maxEvidenceRefs: 20,
});

const T = BRIEFING_ANALYSIS_THRESHOLDS;

export const BRIEFING_ANALYSIS_LANES: readonly BriefingAnalysisLaneContract[] = Object.freeze([
  {
    id: "weekday-time-dips",
    question: "Does a Behavior have a weekday or schedule slot with a materially lower completion rate than its other days or slots?",
    requiredInputs: ["history_occurrences", "schedule_slots", "configuration_periods"],
    optionalSource: null,
    lookback: { minDays: 28, maxDays: 90 },
    sufficiency: `Weekday: ≥${T.weekday.minResolved} resolved on ≥${T.weekday.minDistinctWeeks} weeks, baseline ≥${T.weekday.minBaselineResolved} resolved, Unresolved ≤${T.weekday.maxUnresolvedShare * 100}%, gap ≥${T.weekday.minGap * 100} points. Slot: ≥${T.slot.minResolved} resolved per side, gap ≥${T.slot.minGap * 100} points. Current schedule period only.`,
    permittedProposals: ["timing_experiment"],
    unsupportedInput: "unavailable",
  },
  {
    id: "realistic-timing",
    question: "Are completion marks consistently recorded well after or before the scheduled slot on the same day?",
    requiredInputs: ["history_occurrences", "schedule_slots", "configuration_periods"],
    optionalSource: null,
    lookback: { minDays: 14, maxDays: 90 },
    sufficiency: `≥${T.timing.minSamples} same-day Completed marks on ≥${T.timing.minDistinctDates} dates, median offset ≥${T.timing.minMedianLagMinutes} minutes, ≥${T.timing.minConsistentShare * 100}% of marks offset ≥${T.timing.consistentLagMinutes} minutes the same way. Marks are logging times, not performance times.`,
    permittedProposals: ["timing_experiment"],
    unsupportedInput: "unavailable",
  },
  {
    id: "schedule-load",
    question: "Within the same weekday, are completion rates lower on days with more scheduled Behaviors?",
    requiredInputs: ["history_occurrences", "configuration_periods"],
    optionalSource: null,
    lookback: { minDays: 28, maxDays: 90 },
    sufficiency: `≥${T.load.minStableDays} days since the latest schedule change; heavy = median load + ${T.load.heavyAboveMedian}; ≥${T.load.minStrata} weekday strata with ≥${T.load.minDaysPerSide} days and ≥${T.load.minResolvedPerSide} resolved per side; ≥${T.load.minHeavyResolved} heavy-day resolved; weighted gap ≥${T.load.minWeightedGap * 100} points, same direction in ≥2/3 of strata.`,
    permittedProposals: ["load_experiment"],
    unsupportedInput: "unavailable",
  },
  {
    id: "cross-source-context",
    question: "Do past adherence dips coincide with Calendar-heavy days?",
    requiredInputs: ["history_occurrences", "historical_calendar"],
    optionalSource: null,
    lookback: { minDays: 28, maxDays: 90 },
    sufficiency: "Requires authorized historical Calendar coverage for every compared date. Today's agenda cannot explain past outcomes.",
    permittedProposals: ["timing_experiment"],
    unsupportedInput: "unavailable",
  },
  {
    id: "decision-debt",
    question: "Where do Unresolved occurrences accumulate?",
    requiredInputs: ["history_occurrences"],
    optionalSource: null,
    lookback: { minDays: 14, maxDays: 90 },
    sufficiency: `≥${T.decisionDebt.minUnresolved} prior-day Unresolved occurrences that are ≥${T.decisionDebt.minUnresolvedShare * 100}% of the Behavior's past occurrences. Unresolved is missing decision data, not failure.`,
    permittedProposals: ["decision_moment"],
    unsupportedInput: "unavailable",
  },
  {
    id: "logging-chronology",
    question: "Are decisions usually recorded on a later day, or in batches?",
    requiredInputs: ["history_occurrences", "status_events"],
    optionalSource: null,
    lookback: { minDays: 14, maxDays: 90 },
    sufficiency: `≥${T.chronology.minDecisions} first decisions with explicit status events; ≥${T.chronology.minLateShare * 100}% recorded on a later local day. A batch is ≥${T.chronology.batchSize} late decisions within ${T.chronology.batchMinutes} minutes.`,
    permittedProposals: ["decision_moment"],
    unsupportedInput: "unavailable",
  },
  {
    id: "correction-patterns",
    question: "Are recorded decisions often corrected later?",
    requiredInputs: ["history_occurrences", "status_events"],
    optionalSource: null,
    lookback: { minDays: 14, maxDays: 90 },
    sufficiency: `≥${T.corrections.minCorrected} corrected occurrences that are ≥${T.corrections.minCorrectedShare * 100}% of resolved occurrences, from resolved revision chains.`,
    permittedProposals: ["decision_moment"],
    unsupportedInput: "unavailable",
  },
  {
    id: "reminder-effectiveness",
    question: "Within one schedule period, do occurrences with a planned reminder differ from occurrences while that channel was off?",
    requiredInputs: ["history_occurrences", "configuration_periods", "reminder_deliveries"],
    optionalSource: "reminders",
    lookback: { minDays: 28, maxDays: 90 },
    sufficiency: `Each group ≥${T.reminders.minTotalPerGroup} occurrences and ≥${T.reminders.minResolvedPerGroup} resolved; completion-rate gap ≥${T.reminders.minGap * 100} points. Planned reminders include those cancelled because the occurrence was resolved first; enabled occurrences without a sent or cancelled record are unknown and excluded.`,
    permittedProposals: ["reminder_adjustment"],
    unsupportedInput: "unavailable",
  },
  {
    id: "notes-failure-themes",
    question: "Do Notes on Not Completed occurrences name a recurring obstacle?",
    requiredInputs: ["history_occurrences", "not_completed_notes"],
    optionalSource: "notes",
    lookback: { minDays: 14, maxDays: 90 },
    sufficiency: `A content term shared by ≥${T.notes.minNotes} nonempty Notes on Not Completed occurrences across ≥${T.notes.minDistinctDates} dates. Only that group reaches the model, and a theme must cite ≥${T.notes.minNotes} of them.`,
    permittedProposals: ["obstacle_plan"],
    unsupportedInput: "unavailable",
  },
] satisfies BriefingAnalysisLaneContract[]);

export type ResolveBriefingAnalysisInput = Readonly<{
  source: BriefingAnalysisSource;
  lanes: readonly BriefingAnalysisLaneId[];
  historyDays: number;
  behaviorRefs: "all" | readonly string[];
  /** The owning day context expiry; findings expire with it. */
  expiresAt: string;
}>;

type LaneOutput = Readonly<{
  state?: "unavailable";
  reason?: BriefingAnalysisUnavailableReason;
  candidates: number;
  findings: BriefingFinding[];
}>;

type Lookback = Readonly<{ start: string; end: string; days: number }>;

export function resolveBriefingAnalysis(input: ResolveBriefingAnalysisInput): BriefingAnalysisResult {
  const { source } = input;
  const selectedLanes = new Set(input.lanes);
  const behaviors = input.behaviorRefs === "all" ? null : new Set(input.behaviorRefs);
  const today = Temporal.PlainDate.from(source.localDate);
  const lookback: Lookback = {
    start: today.subtract({ days: input.historyDays }).toString(),
    end: source.localDate,
    days: input.historyDays,
  };
  // Apply the selected lookback and Behavior scope before any aggregation.
  const occurrences = source.occurrences.filter((occurrence) =>
    occurrence.localDate >= lookback.start && occurrence.localDate < lookback.end &&
    (!behaviors || behaviors.has(occurrence.behaviorRef)));
  const scopedToday = {
    scheduledCount: behaviors && source.today.scheduledBehaviorRefs
      ? source.today.scheduledBehaviorRefs.filter((ref) => behaviors.has(ref)).length
      : source.today.scheduledCount,
    unresolved: source.today.unresolved.filter((item) => !behaviors || behaviors.has(item.behaviorRef)),
  };
  const context: LaneContext = { input, lookback, occurrences, today: scopedToday, periods: schedulePeriods(source, lookback, behaviors) };

  const lanes: BriefingAnalysisLaneResult[] = [];
  const findings: BriefingFinding[] = [];
  for (const laneId of BRIEFING_ANALYSIS_LANE_IDS) {
    if (!selectedLanes.has(laneId)) {
      lanes.push({ laneId, state: "not_selected", reason: null, candidateCount: 0 });
      continue;
    }
    const contract = BRIEFING_ANALYSIS_LANES.find((lane) => lane.id === laneId)!;
    const output: LaneOutput = source.completeness === "capped"
      ? { state: "unavailable", reason: "source_capped", candidates: 0, findings: [] }
      : input.historyDays < contract.lookback.minDays
        ? { state: "unavailable", reason: "insufficient_window", candidates: 0, findings: [] }
        : LANE_RESOLVERS[laneId](context);
    lanes.push({
      laneId,
      state: output.state ?? (output.findings.length ? "finding" : "no_finding"),
      reason: output.reason ?? null,
      candidateCount: output.candidates,
    });
    findings.push(...output.findings);
  }
  const laneOrder = new Map(BRIEFING_ANALYSIS_LANE_IDS.map((id, index) => [id, index]));
  findings.sort((left, right) =>
    Number(right.relevantToday) - Number(left.relevantToday) ||
    strength(right) - strength(left) ||
    laneOrder.get(left.laneId)! - laneOrder.get(right.laneId)! ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return { version: BRIEFING_ANALYSIS_VERSION, lanes, findings };
}

/** Materiality divided by the lane's own threshold, so hours and rate points compare fairly. */
const MATERIALITY_SCALE: Record<BriefingAnalysisLaneId, number> = {
  "weekday-time-dips": T.weekday.minGap,
  "realistic-timing": T.timing.minMedianLagMinutes / 60,
  "schedule-load": T.load.minWeightedGap,
  "cross-source-context": 1,
  "decision-debt": T.decisionDebt.minUnresolvedShare,
  "logging-chronology": T.chronology.minLateShare,
  "correction-patterns": T.corrections.minCorrectedShare,
  "reminder-effectiveness": T.reminders.minGap,
  "notes-failure-themes": 0.5,
};
function strength(finding: BriefingFinding): number {
  return finding.materiality / MATERIALITY_SCALE[finding.laneId];
}

type LaneContext = Readonly<{
  input: ResolveBriefingAnalysisInput;
  lookback: Lookback;
  occurrences: readonly BriefingAnalysisOccurrence[];
  today: BriefingAnalysisSource["today"];
  /** Per-Behavior start of the current schedule period, or null when periods are unavailable. */
  periods: ReadonlyMap<string, string> | null;
}>;

const LANE_RESOLVERS: Record<BriefingAnalysisLaneId, (context: LaneContext) => LaneOutput> = {
  "weekday-time-dips": weekdayTimeDips,
  "realistic-timing": realisticTiming,
  "schedule-load": scheduleLoad,
  "cross-source-context": () => ({ state: "unavailable", reason: "historical_calendar_not_read", candidates: 0, findings: [] }),
  "decision-debt": decisionDebt,
  "logging-chronology": loggingChronology,
  "correction-patterns": correctionPatterns,
  "reminder-effectiveness": reminderEffectiveness,
  "notes-failure-themes": notesFailureThemes,
};

function weekdayTimeDips(context: LaneContext): LaneOutput {
  if (!context.periods) return unavailable(context.input.source.configurationPeriods);
  const findings: BriefingFinding[] = [];
  let candidates = 0;
  for (const [behaviorRef, all] of byBehavior(context.occurrences)) {
    const periodStart = context.periods.get(behaviorRef) ?? context.lookback.start;
    const rows = all.filter((row) => row.localDate >= periodStart);
    const segmented = periodStart > context.lookback.start;
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const target = rows.filter((row) => dayOfWeek(row.localDate) === weekday);
      const baseline = rows.filter((row) => dayOfWeek(row.localDate) !== weekday);
      const t = tally(target), b = tally(baseline);
      if (t.resolved < T.weekday.minResolved || b.resolved < T.weekday.minBaselineResolved) continue;
      candidates += 1;
      const weeks = new Set(target.filter(isResolved).map((row) => isoWeek(row.localDate))).size;
      const gap = rate(b) - rate(t);
      if (weeks < T.weekday.minDistinctWeeks || t.unresolved / t.total > T.weekday.maxUnresolvedShare || gap < T.weekday.minGap) continue;
      findings.push(finding(context, {
        laneId: "weekday-time-dips", behaviorRef, key: `weekday:${weekday}`, evidenceBand: `gap:${Math.floor(gap * 10)}`,
        startLocalDate: periodStart,
        counts: { weekdayCompleted: t.completed, weekdayResolved: t.resolved, weekdayUnresolved: t.unresolved, baselineCompleted: b.completed, baselineResolved: b.resolved, baselineUnresolved: b.unresolved },
        rates: { weekday: round(rate(t)), baseline: round(rate(b)) },
        coverage: { resolved: t.resolved + b.resolved, unresolved: t.unresolved + b.unresolved, total: t.total + b.total },
        rule: "weekday", materiality: round(gap),
        relevantToday: dayOfWeek(context.input.source.localDate) === weekday && context.today.unresolved.some((item) => item.behaviorRef === behaviorRef),
        proposal: { kind: "timing_experiment", detail: { weekday: WEEKDAYS[weekday - 1]! } },
        limitations: ["association_not_cause", "unresolved_excluded_from_rates", ...(segmented ? ["schedule_period_segmented" as const] : [])],
        evidenceRefs: target.map((row) => row.ref),
      }));
    }
    const slots = [...new Set(rows.map((row) => row.startTime))].sort();
    if (slots.length < 2) continue;
    for (const slot of slots) {
      const target = rows.filter((row) => row.startTime === slot);
      const baseline = rows.filter((row) => row.startTime !== slot);
      const t = tally(target), b = tally(baseline);
      if (t.resolved < T.slot.minResolved || b.resolved < T.slot.minBaselineResolved) continue;
      candidates += 1;
      const gap = rate(b) - rate(t);
      if (t.unresolved / t.total > T.slot.maxUnresolvedShare || gap < T.slot.minGap) continue;
      findings.push(finding(context, {
        laneId: "weekday-time-dips", behaviorRef, key: `slot:${slot}`, evidenceBand: `gap:${Math.floor(gap * 10)}`,
        startLocalDate: periodStart,
        counts: { slotCompleted: t.completed, slotResolved: t.resolved, slotUnresolved: t.unresolved, baselineCompleted: b.completed, baselineResolved: b.resolved, baselineUnresolved: b.unresolved },
        rates: { slot: round(rate(t)), baseline: round(rate(b)) },
        coverage: { resolved: t.resolved + b.resolved, unresolved: t.unresolved + b.unresolved, total: t.total + b.total },
        rule: "slot", materiality: round(gap),
        relevantToday: context.today.unresolved.some((item) => item.behaviorRef === behaviorRef && item.startTime === slot),
        proposal: { kind: "timing_experiment", detail: { slot } },
        limitations: ["association_not_cause", "unresolved_excluded_from_rates", ...(segmented ? ["schedule_period_segmented" as const] : [])],
        evidenceRefs: target.map((row) => row.ref),
      }));
    }
  }
  return { candidates, findings };
}

function realisticTiming(context: LaneContext): LaneOutput {
  if (!context.periods) return unavailable(context.input.source.configurationPeriods);
  const timezone = context.input.source.timezone;
  const findings: BriefingFinding[] = [];
  let candidates = 0;
  for (const [behaviorRef, all] of byBehavior(context.occurrences)) {
    const periodStart = context.periods.get(behaviorRef) ?? context.lookback.start;
    const samples = all.flatMap((row) => {
      if (row.localDate < periodStart || row.status !== "completed" || !row.statusMarkedAt) return [];
      const marked = Temporal.Instant.from(row.statusMarkedAt).toZonedDateTimeISO(timezone);
      // A mark on a later day measures logging delay, which logging-chronology covers.
      if (marked.toPlainDate().toString() !== row.localDate) return [];
      const markedMinute = marked.hour * 60 + marked.minute;
      const start = minutes(row.startTime);
      const end = row.scheduleKind === "range" && row.endTime ? minutes(row.endTime) : start;
      // A mark inside a reserved range is on time; outside, measure from the nearer bound.
      const lag = markedMinute < start ? markedMinute - start : markedMinute > end ? markedMinute - end : 0;
      return [{ row, lag, markedMinute }];
    });
    if (samples.length < T.timing.minSamples || new Set(samples.map(({ row }) => row.localDate)).size < T.timing.minDistinctDates) continue;
    candidates += 1;
    const lag = median(samples.map((sample) => sample.lag));
    if (Math.abs(lag) < T.timing.minMedianLagMinutes) continue;
    const sameWay = samples.filter((sample) => lag > 0 ? sample.lag >= T.timing.consistentLagMinutes : sample.lag <= -T.timing.consistentLagMinutes).length;
    if (sameWay / samples.length < T.timing.minConsistentShare) continue;
    const scheduled = mode(samples.map(({ row }) => `${row.startTime}|${row.scheduleKind === "range" && row.endTime ? row.endTime : ""}`));
    const [scheduledStart, scheduledEnd] = scheduled.split("|") as [string, string];
    findings.push(finding(context, {
      laneId: "realistic-timing", behaviorRef, key: `mark:${lag > 0 ? "later" : "earlier"}`,
      evidenceBand: `hours:${Math.floor(Math.abs(lag) / 60)}`,
      startLocalDate: periodStart,
      counts: { samples: samples.length, consistentSamples: sameWay, medianOffsetMinutes: Math.round(lag) },
      rates: { consistentShare: round(sameWay / samples.length) },
      coverage: tallyCoverage(all.filter((row) => row.localDate >= periodStart)),
      rule: "timing", materiality: round(Math.abs(lag) / 60),
      relevantToday: context.today.unresolved.some((item) => item.behaviorRef === behaviorRef),
      proposal: { kind: "timing_experiment", detail: {
        direction: lag > 0 ? "later" : "earlier",
        typicalMarkedTime: clock(median(samples.map((sample) => sample.markedMinute))),
        scheduledTime: scheduledStart.slice(0, 5),
        ...(scheduledEnd ? { scheduledEndTime: scheduledEnd.slice(0, 5) } : {}),
      } },
      limitations: ["marking_time_not_performance_time"],
      evidenceRefs: samples.map(({ row }) => row.ref),
    }));
  }
  return { candidates, findings };
}

function scheduleLoad(context: LaneContext): LaneOutput {
  if (!context.periods) return unavailable(context.input.source.configurationPeriods);
  const stableStart = [...context.periods.values()].reduce((latest, start) => start > latest ? start : latest, context.lookback.start);
  const rows = context.occurrences.filter((row) => row.localDate >= stableStart);
  const days = new Map<string, BriefingAnalysisOccurrence[]>();
  for (const row of rows) days.set(row.localDate, [...(days.get(row.localDate) ?? []), row]);
  const stableDays = Temporal.PlainDate.from(stableStart).until(Temporal.PlainDate.from(context.lookback.end)).days;
  if (stableDays < T.load.minStableDays) return { state: "unavailable", reason: "insufficient_stable_period", candidates: 0, findings: [] };
  const loads = [...days.values()].map((items) => items.length);
  if (loads.length === 0) return { candidates: 0, findings: [] };
  const threshold = median(loads) + T.load.heavyAboveMedian;
  let weighted = 0, weights = 0, strata = 0, positive = 0, heavyResolved = 0;
  const counts = { heavyCompleted: 0, heavyResolved: 0, heavyUnresolved: 0, lightCompleted: 0, lightResolved: 0, lightUnresolved: 0, heavyDays: 0, lightDays: 0 };
  const evidence: string[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const stratum = [...days.entries()].filter(([date]) => dayOfWeek(date) === weekday);
    const heavy = stratum.filter(([, items]) => items.length >= threshold);
    const light = stratum.filter(([, items]) => items.length < threshold);
    const h = tally(heavy.flatMap(([, items]) => items)), l = tally(light.flatMap(([, items]) => items));
    if (heavy.length < T.load.minDaysPerSide || light.length < T.load.minDaysPerSide ||
        h.resolved < T.load.minResolvedPerSide || l.resolved < T.load.minResolvedPerSide) continue;
    strata += 1;
    const gap = rate(l) - rate(h);
    const weight = (2 * h.resolved * l.resolved) / (h.resolved + l.resolved);
    weighted += gap * weight; weights += weight;
    if (gap > 0) positive += 1;
    heavyResolved += h.resolved;
    counts.heavyCompleted += h.completed; counts.heavyResolved += h.resolved; counts.heavyUnresolved += h.unresolved;
    counts.lightCompleted += l.completed; counts.lightResolved += l.resolved; counts.lightUnresolved += l.unresolved;
    counts.heavyDays += heavy.length; counts.lightDays += light.length;
    evidence.push(...heavy.flatMap(([, items]) => items.map((item) => item.ref)));
  }
  if (strata < T.load.minStrata) return { candidates: 0, findings: [] };
  const gap = weights ? weighted / weights : 0;
  if (heavyResolved < T.load.minHeavyResolved || gap < T.load.minWeightedGap || positive / strata < T.load.minConsistentStrataShare) {
    return { candidates: 1, findings: [] };
  }
  const coverage = tallyCoverage(rows);
  return { candidates: 1, findings: [finding(context, {
    laneId: "schedule-load", behaviorRef: null, key: `load:${threshold}`, evidenceBand: `gap:${Math.floor(gap * 10)}`,
    startLocalDate: stableStart,
    counts: { ...counts, heavyThreshold: threshold, strata },
    rates: { heavy: round(counts.heavyCompleted / counts.heavyResolved), light: round(counts.lightCompleted / counts.lightResolved), weightedGap: round(gap) },
    coverage, rule: "load", materiality: round(gap),
    relevantToday: context.today.scheduledCount >= threshold,
    proposal: { kind: "load_experiment", detail: { heavyThreshold: threshold, todayScheduled: context.today.scheduledCount } },
    limitations: ["association_not_cause", "unresolved_excluded_from_rates", ...(stableStart > context.lookback.start ? ["schedule_period_segmented" as const] : [])],
    evidenceRefs: evidence,
  })] };
}

function decisionDebt(context: LaneContext): LaneOutput {
  const findings: BriefingFinding[] = [];
  let candidates = 0;
  const today = Temporal.PlainDate.from(context.lookback.end);
  for (const [behaviorRef, rows] of byBehavior(context.occurrences)) {
    candidates += 1;
    const unresolved = rows.filter((row) => row.status === "unresolved");
    const share = unresolved.length / rows.length;
    if (unresolved.length < T.decisionDebt.minUnresolved || share < T.decisionDebt.minUnresolvedShare) continue;
    const oldest = unresolved.reduce((earliest, row) => row.localDate < earliest ? row.localDate : earliest, unresolved[0]!.localDate);
    findings.push(finding(context, {
      laneId: "decision-debt", behaviorRef, key: "unresolved", evidenceBand: `share:${Math.floor(share * 10)}`,
      startLocalDate: context.lookback.start,
      counts: { unresolved: unresolved.length, total: rows.length, oldestAgeDays: Temporal.PlainDate.from(oldest).until(today).days },
      rates: { unresolvedShare: round(share) },
      coverage: tallyCoverage(rows), rule: "decisionDebt", materiality: round(share),
      relevantToday: context.today.unresolved.some((item) => item.behaviorRef === behaviorRef),
      proposal: { kind: "decision_moment", detail: { unresolved: unresolved.length } },
      limitations: [],
      evidenceRefs: unresolved.map((row) => row.ref),
    }));
  }
  return { candidates, findings };
}

function loggingChronology(context: LaneContext): LaneOutput {
  const events = context.input.source.statusEvents;
  if (events.state !== "available") return unavailable(events);
  const timezone = context.input.source.timezone;
  const firstDecision = firstDecisions(events.records);
  const findings: BriefingFinding[] = [];
  let candidates = 0;
  for (const [behaviorRef, rows] of byBehavior(context.occurrences)) {
    const decisions = rows.flatMap((row) => {
      const event = firstDecision.get(row.ref);
      if (!event || event.semantics !== "explicit_user_mark") return [];
      const recorded = Temporal.Instant.from(event.recordedAt).toZonedDateTimeISO(timezone);
      return [{ row, recorded, late: recorded.toPlainDate().toString() > row.localDate }];
    });
    if (decisions.length < T.chronology.minDecisions) continue;
    candidates += 1;
    const late = decisions.filter((decision) => decision.late);
    const share = late.length / decisions.length;
    if (share < T.chronology.minLateShare) continue;
    findings.push(finding(context, {
      laneId: "logging-chronology", behaviorRef, key: "late", evidenceBand: `share:${Math.floor(share * 10)}`,
      startLocalDate: context.lookback.start,
      counts: { decisions: decisions.length, lateDecisions: late.length, batchedDecisions: batched(late.map((decision) => decision.recorded)) },
      rates: { lateShare: round(share) },
      coverage: tallyCoverage(rows), rule: "chronology", materiality: round(share),
      relevantToday: context.today.unresolved.some((item) => item.behaviorRef === behaviorRef),
      proposal: { kind: "decision_moment", detail: { lateShare: round(share) } },
      limitations: ["marking_time_not_performance_time"],
      evidenceRefs: late.map((decision) => decision.row.ref),
    }));
  }
  return { candidates, findings };
}

function correctionPatterns(context: LaneContext): LaneOutput {
  const events = context.input.source.statusEvents;
  if (events.state !== "available") return unavailable(events);
  const timezone = context.input.source.timezone;
  const chains = new Map<string, BriefingAnalysisStatusEvent[]>();
  for (const event of events.records) chains.set(event.occurrenceRef, [...(chains.get(event.occurrenceRef) ?? []), event]);
  const findings: BriefingFinding[] = [];
  let candidates = 0;
  for (const [behaviorRef, rows] of byBehavior(context.occurrences)) {
    const resolved = rows.filter(isResolved);
    if (resolved.length === 0) continue;
    candidates += 1;
    let corrected = 0, toNotCompleted = 0, toCompleted = 0, delayed = 0;
    const evidence: string[] = [];
    for (const row of resolved) {
      const chain = orderChain(chains.get(row.ref) ?? []);
      const corrections = chain.filter((event) => event.semantics === "explicit_user_correction");
      if (!corrections.length) continue;
      corrected += 1; evidence.push(row.ref);
      const first = chain[0]!, last = corrections[corrections.length - 1]!;
      if (last.status === "not_completed") toNotCompleted += 1;
      if (last.status === "completed") toCompleted += 1;
      const firstDay = Temporal.Instant.from(first.recordedAt).toZonedDateTimeISO(timezone).toPlainDate().toString();
      const lastDay = Temporal.Instant.from(last.recordedAt).toZonedDateTimeISO(timezone).toPlainDate().toString();
      if (lastDay > firstDay) delayed += 1;
    }
    const share = corrected / resolved.length;
    if (corrected < T.corrections.minCorrected || share < T.corrections.minCorrectedShare) continue;
    findings.push(finding(context, {
      laneId: "correction-patterns", behaviorRef, key: "corrected", evidenceBand: `share:${Math.floor(share * 10)}`,
      startLocalDate: context.lookback.start,
      counts: { corrected, resolved: resolved.length, correctedToNotCompleted: toNotCompleted, correctedToCompleted: toCompleted, correctedOnLaterDay: delayed },
      rates: { correctedShare: round(share) },
      coverage: tallyCoverage(rows), rule: "corrections", materiality: round(share),
      relevantToday: context.today.unresolved.some((item) => item.behaviorRef === behaviorRef),
      proposal: { kind: "decision_moment", detail: { corrected } },
      limitations: [],
      evidenceRefs: evidence,
    }));
  }
  return { candidates, findings };
}

function reminderEffectiveness(context: LaneContext): LaneOutput {
  const { reminders, configurationPeriods } = context.input.source;
  if (reminders.state !== "available") return unavailable(reminders);
  if (configurationPeriods.state !== "available" || !context.periods) return unavailable(configurationPeriods);
  // A cancelled delivery means the reminder was planned and the occurrence was resolved
  // before it sent. Counting it keeps early completions in the reminded group, which
  // would otherwise bias the comparison against reminders.
  const planned = new Set(reminders.records.filter((item) => item.status === "sent" || item.status === "cancelled").map((item) => `${item.occurrenceRef}\0${item.channel}`));
  const findings: BriefingFinding[] = [];
  let candidates = 0;
  for (const [behaviorRef, all] of byBehavior(context.occurrences)) {
    const periodStart = context.periods.get(behaviorRef) ?? context.lookback.start;
    const rows = all.filter((row) => row.localDate >= periodStart);
    const settings = configurationPeriods.records.filter((period) => period.behaviorRef === behaviorRef)
      .sort((left, right) => left.effectiveAt < right.effectiveAt ? -1 : left.effectiveAt > right.effectiveAt ? 1 : 0);
    for (const channel of ["browser_push", "email"] as const) {
      const reminded: BriefingAnalysisOccurrence[] = [], off: BriefingAnalysisOccurrence[] = [];
      let unknown = 0;
      for (const row of rows) {
        const setting = [...settings].reverse().find((period) => period.effectiveAt <= row.scheduledFor);
        if (!setting) { unknown += 1; continue; }
        const enabled = channel === "browser_push" ? setting.browserReminderEnabled : setting.emailReminderEnabled;
        if (enabled && planned.has(`${row.ref}\0${channel}`)) reminded.push(row);
        else if (!enabled) off.push(row);
        // Enabled without a sent or cancelled record: delivery unknown or failed; excluded.
        else unknown += 1;
      }
      const r = tally(reminded), o = tally(off);
      if (r.total < T.reminders.minTotalPerGroup || o.total < T.reminders.minTotalPerGroup ||
          r.resolved < T.reminders.minResolvedPerGroup || o.resolved < T.reminders.minResolvedPerGroup) continue;
      candidates += 1;
      const gap = rate(r) - rate(o);
      if (Math.abs(gap) < T.reminders.minGap) continue;
      findings.push(finding(context, {
        laneId: "reminder-effectiveness", behaviorRef, key: `channel:${channel}`, evidenceBand: `gap:${Math.sign(gap) * Math.floor(Math.abs(gap) * 10)}`,
        startLocalDate: periodStart,
        counts: { remindedCompleted: r.completed, remindedResolved: r.resolved, remindedTotal: r.total, offCompleted: o.completed, offResolved: o.resolved, offTotal: o.total, unknownDelivery: unknown },
        rates: { reminded: round(rate(r)), off: round(rate(o)), remindedDecisionRate: round(r.resolved / r.total), offDecisionRate: round(o.resolved / o.total) },
        coverage: tallyCoverage(rows), rule: "reminders", materiality: round(Math.abs(gap)),
        relevantToday: context.today.unresolved.some((item) => item.behaviorRef === behaviorRef),
        proposal: { kind: "reminder_adjustment", detail: { channel, direction: gap > 0 ? "reminded_higher" : "reminded_lower" } },
        limitations: ["association_not_cause", "delivery_records_only", "unresolved_excluded_from_rates", ...(periodStart > context.lookback.start ? ["schedule_period_segmented" as const] : [])],
        evidenceRefs: [...reminded, ...off].map((row) => row.ref),
      }));
    }
  }
  return { candidates, findings };
}

function notesFailureThemes(context: LaneContext): LaneOutput {
  const notes = context.input.source.notes;
  if (notes.state !== "available") return unavailable(notes);
  const eligible = new Map(context.occurrences.filter((row) => row.status === "not_completed").map((row) => [row.ref, row]));
  const byRef = new Map<string, typeof notes.records[number][]>();
  for (const note of notes.records) {
    const occurrence = eligible.get(note.occurrenceRef);
    if (!occurrence || occurrence.behaviorRef !== note.behaviorRef || !note.text.trim()) continue;
    byRef.set(note.behaviorRef, [...(byRef.get(note.behaviorRef) ?? []), note]);
  }
  const findings: BriefingFinding[] = [];
  let candidates = 0;
  for (const [behaviorRef, items] of [...byRef.entries()].sort(([left], [right]) => left < right ? -1 : 1)) {
    candidates += 1;
    // The theme is a shared term found deterministically; the model only names the obstacle.
    const theme = sharedNoteTerm(items);
    if (!theme) continue;
    const notCompleted = [...eligible.values()].filter((row) => row.behaviorRef === behaviorRef).length;
    const group = theme.notes;
    const recent = [...group].sort((left, right) => left.localDate > right.localDate ? -1 : left.localDate < right.localDate ? 1 : 0).slice(0, T.notes.maxEvidence);
    findings.push(finding(context, {
      laneId: "notes-failure-themes", behaviorRef, key: `notes:${theme.stem}`, evidenceBand: `notes:${Math.min(3, Math.floor(group.length / 3))}`,
      startLocalDate: context.lookback.start,
      counts: { notes: group.length, notesWithText: items.length, notCompleted, dates: new Set(group.map((note) => note.localDate)).size },
      rates: { notedShare: round(group.length / notCompleted) },
      coverage: tallyCoverage(context.occurrences.filter((row) => row.behaviorRef === behaviorRef)),
      rule: "notes", materiality: round(group.length / notCompleted),
      relevantToday: context.today.unresolved.some((item) => item.behaviorRef === behaviorRef),
      proposal: { kind: "obstacle_plan", detail: { notes: group.length, sharedTerm: theme.word } },
      limitations: ["user_written_notes", "association_not_cause"],
      evidenceRefs: recent.map((note) => note.ref),
    }));
  }
  return { candidates, findings };
}

const NOTE_STOPWORDS = new Set(("the and but for not was were with too very just again then than this that from into onto over after before about " +
  "had has have did does got get its it's i'm ive i've you your they them our out off all any can cant can't didnt didn't dont don't wont won't " +
  "would could should because also really still more less some much many what when where which who why how day today time").split(" "));

function noteStem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * The most widely shared content term across a Behavior's Notes, when at least
 * the minimum number of Notes on distinct dates contain it. Ties break alphabetically.
 */
function sharedNoteTerm<T extends Readonly<{ text: string; localDate: string }>>(items: readonly T[]): Readonly<{ stem: string; word: string; notes: T[] }> | null {
  const byStem = new Map<string, { word: string; notes: T[] }>();
  for (const note of items) {
    const words = note.text.toLowerCase().normalize("NFKC").split(/[^\p{L}']+/u).map((word) => word.replace(/^'+|'+$/g, ""))
      .filter((word) => word.length >= 3 && !NOTE_STOPWORDS.has(word));
    for (const word of new Set(words)) {
      const stem = noteStem(word);
      const entry = byStem.get(stem) ?? { word, notes: [] };
      if (!entry.notes.includes(note)) entry.notes.push(note);
      byStem.set(stem, entry);
    }
  }
  const candidates = [...byStem.entries()].filter(([, entry]) =>
    entry.notes.length >= T.notes.minNotes && new Set(entry.notes.map((note) => note.localDate)).size >= T.notes.minDistinctDates);
  candidates.sort(([leftStem, left], [rightStem, right]) => right.notes.length - left.notes.length || (leftStem < rightStem ? -1 : 1));
  const best = candidates[0];
  return best ? { stem: best[0], word: best[1].word, notes: best[1].notes } : null;
}

type FindingDraft = Readonly<{
  laneId: BriefingAnalysisLaneId;
  behaviorRef: string | null;
  key: string;
  evidenceBand: string;
  startLocalDate: string;
  counts: Record<string, number>;
  rates: Record<string, number>;
  coverage: BriefingFinding["coverage"];
  rule: keyof typeof T;
  materiality: number;
  relevantToday: boolean;
  proposal: BriefingFinding["proposal"];
  limitations: readonly BriefingAnalysisLimitation[];
  evidenceRefs: readonly string[];
}>;

function finding(context: LaneContext, draft: FindingDraft): BriefingFinding {
  const contract = BRIEFING_ANALYSIS_LANES.find((lane) => lane.id === draft.laneId)!;
  const start = draft.startLocalDate > context.lookback.start ? draft.startLocalDate : context.lookback.start;
  return {
    id: `${draft.laneId}:${draft.behaviorRef ?? "all"}:${draft.key}`,
    laneId: draft.laneId,
    behaviorRef: draft.behaviorRef,
    key: draft.key,
    evidenceBand: draft.evidenceBand,
    scope: { startLocalDate: start, endLocalDateExclusive: context.lookback.end, days: Temporal.PlainDate.from(start).until(Temporal.PlainDate.from(context.lookback.end)).days },
    counts: draft.counts,
    rates: draft.rates,
    coverage: draft.coverage,
    sufficiency: { rule: contract.sufficiency, met: true },
    materiality: draft.materiality,
    relevantToday: draft.relevantToday,
    proposal: draft.proposal,
    limitations: [...new Set(draft.limitations)],
    evidenceRefs: [...new Set(draft.evidenceRefs)].slice(0, T.maxEvidenceRefs),
    observedAt: context.input.source.observedAt,
    revision: context.input.source.revision,
    expiresAt: context.input.expiresAt,
  };
}

/** Current schedule-period start per Behavior; reminder/category-only revisions never split periods. */
function schedulePeriods(source: BriefingAnalysisSource, lookback: Lookback, behaviors: ReadonlySet<string> | null): ReadonlyMap<string, string> | null {
  if (source.configurationPeriods.state !== "available") return null;
  const starts = new Map<string, string>();
  for (const period of source.configurationPeriods.records as readonly BriefingAnalysisConfigurationPeriod[]) {
    // An unselected Behavior's schedule change cannot shorten a scoped analysis.
    if (!period.startsSchedulePeriod || period.effectiveLocalDate > lookback.end || (behaviors && !behaviors.has(period.behaviorRef))) continue;
    const current = starts.get(period.behaviorRef);
    if (!current || period.effectiveLocalDate > current) starts.set(period.behaviorRef, period.effectiveLocalDate);
  }
  return new Map([...starts].map(([behaviorRef, start]) => [behaviorRef, start > lookback.start ? start : lookback.start]));
}

function unavailable(records: Readonly<{ state: "available" | "not_permitted" | "capped" | "not_requested" }>): LaneOutput {
  const reason: BriefingAnalysisUnavailableReason = records.state === "not_permitted" ? "source_not_permitted"
    : records.state === "capped" ? "source_capped" : "source_not_requested";
  return { state: "unavailable", reason, candidates: 0, findings: [] };
}

function firstDecisions(events: readonly BriefingAnalysisStatusEvent[]): Map<string, BriefingAnalysisStatusEvent> {
  const chains = new Map<string, BriefingAnalysisStatusEvent[]>();
  for (const event of events) chains.set(event.occurrenceRef, [...(chains.get(event.occurrenceRef) ?? []), event]);
  const first = new Map<string, BriefingAnalysisStatusEvent>();
  for (const [ref, chain] of chains) {
    const decision = orderChain(chain).find((event) => event.status !== "unresolved");
    if (decision) first.set(ref, decision);
  }
  return first;
}

/** Orders a revision chain by `revisesRef` links, falling back to recorded time. */
function orderChain(chain: readonly BriefingAnalysisStatusEvent[]): BriefingAnalysisStatusEvent[] {
  return [...chain].sort((left, right) =>
    left.revisesRef === right.ref ? 1 : right.revisesRef === left.ref ? -1 :
      left.recordedAt < right.recordedAt ? -1 : left.recordedAt > right.recordedAt ? 1 : left.ref < right.ref ? -1 : 1);
}

function batched(times: readonly Temporal.ZonedDateTime[]): number {
  const sorted = [...times].sort(Temporal.ZonedDateTime.compare);
  let count = 0, start = 0;
  for (let index = 1; index <= sorted.length; index += 1) {
    const breaks = index === sorted.length ||
      sorted[index]!.toPlainDate().toString() !== sorted[index - 1]!.toPlainDate().toString() ||
      sorted[index - 1]!.until(sorted[index]!).total("minutes") > T.chronology.batchMinutes;
    if (!breaks) continue;
    if (index - start >= T.chronology.batchSize) count += index - start;
    start = index;
  }
  return count;
}

function byBehavior(rows: readonly BriefingAnalysisOccurrence[]): Map<string, BriefingAnalysisOccurrence[]> {
  const groups = new Map<string, BriefingAnalysisOccurrence[]>();
  for (const row of rows) groups.set(row.behaviorRef, [...(groups.get(row.behaviorRef) ?? []), row]);
  return new Map([...groups].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

type Tally = Readonly<{ completed: number; resolved: number; unresolved: number; total: number }>;
function tally(rows: readonly BriefingAnalysisOccurrence[]): Tally {
  const completed = rows.filter((row) => row.status === "completed").length;
  const resolved = rows.filter(isResolved).length;
  return { completed, resolved, unresolved: rows.length - resolved, total: rows.length };
}
function tallyCoverage(rows: readonly BriefingAnalysisOccurrence[]): BriefingFinding["coverage"] {
  const { resolved, unresolved, total } = tally(rows);
  return { resolved, unresolved, total };
}
/** Completed ÷ resolved. Unresolved is missing decision data and never counts as failure. */
function rate(value: Tally): number { return value.resolved ? value.completed / value.resolved : 0; }
function isResolved(row: BriefingAnalysisOccurrence): boolean { return row.status === "completed" || row.status === "not_completed"; }
function dayOfWeek(date: string): number { return Temporal.PlainDate.from(date).dayOfWeek; }
function isoWeek(date: string): string {
  const value = Temporal.PlainDate.from(date);
  return `${value.yearOfWeek}-${value.weekOfYear}`;
}
function minutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour! * 60 + minute!;
}
function clock(value: number): string {
  const rounded = Math.round(value);
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}
function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function mode(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([leftValue, left], [rightValue, right]) => right - left || (leftValue < rightValue ? -1 : 1))[0]![0];
}
function round(value: number): number { return Math.round(value * 100) / 100; }

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export type BriefingTipDecision = "selected" | "not_relevant" | "cooldown" | "spacing" | "not_ranked" | "disabled";

export type BriefingTipSelection = Readonly<{
  tip: BriefingFinding | null;
  fingerprint: string | null;
  /**
   * Fingerprints to record when the tip is shown: its own band and the adjacent
   * bands. Evidence hovering at a band edge therefore stays in cooldown; only a
   * change of two or more bands counts as changed evidence.
   */
  recordFingerprints: readonly string[];
  decisions: readonly Readonly<{ findingId: string; decision: BriefingTipDecision }>[];
}>;

/**
 * Chooses at most one occasional pattern tip. A tip must bear on today, its
 * fingerprint must be outside the cooldown, and no different tip may have been
 * shown on the previous local day. A tip already shown today may be shown again,
 * so a deliberate retry or refresh keeps the same advice. Findings arrive ranked.
 */
export function selectBriefingTip(input: Readonly<{
  findings: readonly BriefingFinding[];
  maxTips: 0 | 1;
  cooldownDays: number;
  localDate: string;
  shown: readonly Readonly<{ fingerprint: string; lastShownLocalDate: string }>[];
  fingerprintOf: (finding: BriefingFinding) => string;
}>): BriefingTipSelection {
  if (input.maxTips === 0) {
    return { tip: null, fingerprint: null, recordFingerprints: [], decisions: input.findings.map((finding) => ({ findingId: finding.id, decision: "disabled" as const })) };
  }
  const today = Temporal.PlainDate.from(input.localDate);
  const age = (date: string) => Temporal.PlainDate.from(date).until(today).days;
  const shown = new Map(input.shown.map((item) => [item.fingerprint, item.lastShownLocalDate]));
  const shownToday = new Set(input.shown.filter((item) => age(item.lastShownLocalDate) === 0).map((item) => item.fingerprint));
  const shownYesterday = input.shown.filter((item) => age(item.lastShownLocalDate) === 1).map((item) => item.fingerprint);
  const fingerprints = new Map(input.findings.map((finding) => [finding.id, input.fingerprintOf(finding)]));
  const eligible = (finding: BriefingFinding): BriefingTipDecision | null => {
    const fingerprint = fingerprints.get(finding.id)!;
    if (!finding.relevantToday) return "not_relevant";
    if (shownToday.has(fingerprint)) return null;
    const last = shown.get(fingerprint);
    if (last && age(last) > 0 && age(last) < input.cooldownDays) return "cooldown";
    if (shownToday.size > 0 || shownYesterday.some((other) => other !== fingerprint)) return "spacing";
    return null;
  };
  // Prefer the tip already shown today so retries stay consistent.
  const ordered = [...input.findings].sort((left, right) =>
    Number(shownToday.has(fingerprints.get(right.id)!)) - Number(shownToday.has(fingerprints.get(left.id)!)));
  let tip: BriefingFinding | null = null;
  const decisions = ordered.map((finding) => {
    const blocked = eligible(finding);
    if (blocked) return { findingId: finding.id, decision: blocked };
    if (tip) return { findingId: finding.id, decision: "not_ranked" as const };
    tip = finding;
    return { findingId: finding.id, decision: "selected" as const };
  });
  const selected = tip as BriefingFinding | null;
  return {
    tip: selected,
    fingerprint: selected ? fingerprints.get(selected.id)! : null,
    recordFingerprints: selected ? [...new Set(adjacentBands(selected.evidenceBand).map((evidenceBand) => input.fingerprintOf({ ...selected, evidenceBand })))] : [],
    decisions,
  };
}

/** A band `name:n` and its neighbors `name:n-1` and `name:n+1`. */
export function adjacentBands(band: string): string[] {
  const match = /^(.*):(-?\d+)$/.exec(band);
  if (!match) return [band];
  const step = Number(match[2]);
  return [step - 1, step, step + 1].map((value) => `${match[1]}:${value}`);
}
