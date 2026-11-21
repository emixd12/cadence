import type { BriefOpportunities, BriefOpportunityAnswerResponse, BriefOpportunityLine } from "@cadence/core/types/brief-opportunities";
import type { BriefOpportunityClient } from "@/lib/ui/daily-brief-opportunities";

/**
 * Behaviors of Opportunity (Task 7): static "Add for today" lines for the bench and
 * tests, on 2026-11-18 in New York. None of this is model text.
 */
const TIMEZONE = "America/New_York";
const DATE = "2026-11-18";
const at = (time: string) => new Date(`${DATE}T${time}:00-05:00`).toISOString();

function line(partial: Partial<BriefOpportunityLine> & Pick<BriefOpportunityLine, "proposalId" | "title" | "at">): BriefOpportunityLine {
  return {
    behaviorId: `beh-${partial.proposalId}`, localDate: DATE, timezone: TIMEZONE,
    length: { minutes: 20, source: "behavior_duration", assumed: false }, whereKind: "anywhere", reasonCode: "open_window",
    daysSinceLastCompleted: 4, otherTimes: [at("16:30"), at("19:40")], travel: "not_needed", offerNeverAdd: false,
    status: "proposed", occurrenceId: null, appliedAt: null, ...partial,
  };
}

export const BRIEF_OPPORTUNITY_FIXTURE_LINES: readonly BriefOpportunityLine[] = [
  line({ proposalId: "read", title: "Read a chapter", at: { startAt: at("14:10"), endAt: at("14:30") } }),
  line({ proposalId: "climb", title: "Climbing", whereKind: "place", travel: "not_checked", daysSinceLastCompleted: null, offerNeverAdd: true,
    length: { minutes: 90, source: "logged_average", assumed: false }, at: { startAt: at("18:00"), endAt: at("19:30") }, otherTimes: [] }),
];

export const BRIEF_OPPORTUNITY_FIXTURE: BriefOpportunities = {
  version: "1", localDate: DATE, timezone: TIMEZONE, runId: "run-bench", lines: BRIEF_OPPORTUNITY_FIXTURE_LINES, calendar: "current",
};

/** Applies every answer in memory. Re-check and Re-plan find nothing new. */
export function fixtureBriefOpportunityClient(): BriefOpportunityClient {
  const lines = new Map(BRIEF_OPPORTUNITY_FIXTURE_LINES.map((entry) => [entry.proposalId, entry]));
  return {
    async answer(request): Promise<BriefOpportunityAnswerResponse> {
      const current = lines.get(request.proposalId)!;
      const startAt = request.kind === "other_time" ? request.startAt : current.at.startAt;
      const status = request.kind === "yes" ? "accepted" : request.kind === "other_time" ? "other_time" : request.kind === "undo" ? "undone" : "declined";
      const added = status === "accepted" || status === "other_time";
      const next: BriefOpportunityLine = { ...current, status, occurrenceId: added ? `occ-${request.proposalId}` : current.occurrenceId,
        appliedAt: added ? { startAt, endAt: startAt } : null };
      lines.set(request.proposalId, next);
      return { target: "opportunity", kind: request.kind, proposalId: request.proposalId, outcome: "applied", line: next, refusal: null,
        occurrenceId: added || request.kind === "undo" ? next.occurrenceId : null, replayed: false };
    },
    async replan(request) { return { line: null, replacedProposalId: request.opportunityProposalId }; },
    async recheck() { return { replaced: [] }; },
    async preference(input) { return { behaviorId: input.behaviorId, neverSuggestAdd: input.neverSuggestAdd, updatedAt: null }; },
  };
}
