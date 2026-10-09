import { BRIEFING_ANALYSIS_LANES } from "../resolvers/briefing-analysis.resolver";
import type {
  BriefingAnalysisLimitation,
  BriefingAnalysisSource,
  BriefingFinding,
} from "../types/briefing-analysis";

/** The only analysis shape a model receives: one selected finding, without internal record refs. */
export type BriefingModelTipFinding = Readonly<{
  id: "tip";
  laneId: BriefingFinding["laneId"];
  question: string;
  behaviorRef: string | null;
  subject: string;
  proposal: BriefingFinding["proposal"];
  evidence: Readonly<{
    days: number;
    counts: BriefingFinding["counts"];
    rates: BriefingFinding["rates"];
    coverage: BriefingFinding["coverage"];
  }>;
  limitations: readonly BriefingAnalysisLimitation[];
  /** Notes lane only: the bounded Notes the theme may cite. */
  notes?: readonly Readonly<{ ref: string; text: string }>[];
}>;

export function projectBriefingTipForModel(finding: BriefingFinding, source: BriefingAnalysisSource | null): BriefingModelTipFinding {
  const contract = BRIEFING_ANALYSIS_LANES.find((lane) => lane.id === finding.laneId)!;
  const notes = finding.laneId === "notes-failure-themes" && source?.notes.state === "available"
    ? source.notes.records.filter((note) => finding.evidenceRefs.includes(note.ref)).map((note) => ({ ref: note.ref, text: note.text }))
    : undefined;
  return {
    id: "tip",
    laneId: finding.laneId,
    question: contract.question,
    behaviorRef: finding.behaviorRef,
    subject: finding.key,
    proposal: finding.proposal,
    evidence: { days: finding.scope.days, counts: finding.counts, rates: finding.rates, coverage: finding.coverage },
    limitations: finding.limitations,
    ...(notes ? { notes } : {}),
  };
}

/**
 * Deterministic evidence line shown beside a tip. It states the counts that
 * support the tip so the reader does not depend on the model's wording.
 */
export function describeBriefingFinding(finding: BriefingFinding, input: Readonly<{ title?: string | null; citedNotes?: number }> = {}): string {
  const c = finding.counts;
  const lead = input.title ? `${input.title}: ` : "";
  const unresolved = (count: number | undefined) => count ? ` (${count} Unresolved not counted)` : "";
  switch (finding.laneId) {
    case "weekday-time-dips":
      return finding.key.startsWith("slot:")
        ? `${lead}${finding.key.slice(5)} slot completed ${c.slotCompleted} of ${c.slotResolved} resolved times; other slots ${c.baselineCompleted} of ${c.baselineResolved}${unresolved(c.slotUnresolved)}.`
        : `${lead}${String(finding.proposal.detail.weekday)}s completed ${c.weekdayCompleted} of ${c.weekdayResolved} resolved times; other days ${c.baselineCompleted} of ${c.baselineResolved}${unresolved(c.weekdayUnresolved)}.`;
    case "realistic-timing":
    {
      const detail = finding.proposal.detail;
      const slot = detail.scheduledEndTime
        ? `${formatClock(String(detail.scheduledTime))}–${formatClock(String(detail.scheduledEndTime))}`
        : formatClock(String(detail.scheduledTime));
      return `${lead}Completed usually marked around ${formatClock(String(detail.typicalMarkedTime))} for a ${slot} slot (${c.samples} same-day marks).`;
    }
    case "schedule-load":
      return `Days with ${c.heavyThreshold}+ scheduled completed ${c.heavyCompleted} of ${c.heavyResolved} resolved; lighter days on the same weekdays ${c.lightCompleted} of ${c.lightResolved}.`;
    case "decision-debt":
      return `${lead}${c.unresolved} of ${c.total} past occurrences are still Unresolved; the oldest is ${c.oldestAgeDays} days old.`;
    case "logging-chronology":
      return `${lead}${c.lateDecisions} of ${c.decisions} decisions were recorded on a later day${c.batchedDecisions ? `, ${c.batchedDecisions} of them in batches` : ""}.`;
    case "correction-patterns":
      return `${lead}${c.corrected} of ${c.resolved} recorded decisions were changed later.`;
    case "reminder-effectiveness": {
      const channel = finding.proposal.detail.channel === "email" ? "email" : "browser";
      return `${lead}With ${channel} reminders on, completed ${c.remindedCompleted} of ${c.remindedResolved} resolved; while they were off, ${c.offCompleted} of ${c.offResolved}.`;
    }
    case "notes-failure-themes":
      return `${lead}Based on ${input.citedNotes ?? c.notes} of your Notes on Not Completed occurrences.`;
    case "cross-source-context":
      return lead.trim();
  }
}

/** One plain limitation for display, most important first. */
export function describeBriefingLimitation(limitations: readonly BriefingAnalysisLimitation[]): string | null {
  if (limitations.includes("marking_time_not_performance_time")) return "Marks show when you logged a decision, not when you did it.";
  if (limitations.includes("user_written_notes")) return "Drawn from your own Notes.";
  if (limitations.includes("association_not_cause")) return "A pattern, not proof of a cause.";
  return null;
}

function formatClock(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return value;
  const suffix = hour! < 12 ? "AM" : "PM";
  const display = hour! % 12 === 0 ? 12 : hour! % 12;
  return `${display}:${String(minute).padStart(2, "0")} ${suffix}`;
}
