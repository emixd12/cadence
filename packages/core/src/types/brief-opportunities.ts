import type { BriefMoveLength, BriefMoveSpan, BriefMoveTravel, BriefPlanningContext } from "./brief-moves";

/**
 * Behaviors of Opportunity (Task 7): the Daily Brief's "Add for today" lines. A line
 * offers to place one opportunity Behavior in a real free window today. The planner
 * (packages/core/src/resolvers/brief-opportunity.resolver.ts) uses the one free-slot
 * rule of the move lines, so an offered time is never refused at Yes on the same data.
 *
 * Rules (docs/DATETIME_STRATEGY.md, "Brief opportunity lines"):
 *   - At most `BRIEF_OPPORTUNITY_MAX_LINES` lines per brief, and never more than
 *     `BRIEF_MOVE_MAX_LINES` lines with the move lines together.
 *   - Yes and Other time add an Unresolved Occurrence (origin opportunity, added by
 *     daily_brief). Cadence never marks it Completed. Undo removes that Occurrence while
 *     it is still clean.
 *   - No and Undo mean "no more suggestions to add this Behavior today".
 *   - "Don't suggest adding this" is stored per Behavior.
 *   - A stale calendar offers no line.
 */

export const BRIEF_OPPORTUNITIES_VERSION = "1" as const;

/** The brief request's opt-in. Clients that do not send it get no opportunity lines and no new fields. */
export const BRIEF_OPPORTUNITY_LINES_FEATURE = "opportunity_lines_v1" as const;

export const BRIEF_OPPORTUNITY_MAX_LINES = 2;

/** After this many declines of one Behavior on different days, the line offers "Don't suggest adding this". */
export const BRIEF_OPPORTUNITY_NEVER_OFFER_AFTER_DECLINES = 4;

export const BRIEF_OPPORTUNITY_PROPOSAL_STATUSES = [
  "proposed", "accepted", "declined", "other_time", "superseded", "withdrawn", "undone",
] as const;
export type BriefOpportunityProposalStatus = (typeof BRIEF_OPPORTUNITY_PROPOSAL_STATUSES)[number];

/** Stock reason codes. Opportunity lines carry no model text. */
export type BriefOpportunityReasonCode = "open_window";

export type BriefOpportunityWhere = "anywhere" | "home" | "place" | null;

/** One "Add for today" line, as stored with its proposal. */
export type BriefOpportunityLine = Readonly<{
  proposalId: string;
  behaviorId: string;
  /** The Behavior's title, from Cadence's records. */
  title: string;
  localDate: string;
  timezone: string;
  /** Where the line would place the item (UTC instants). */
  at: BriefMoveSpan;
  length: BriefMoveLength;
  whereKind: BriefOpportunityWhere;
  reasonCode: BriefOpportunityReasonCode;
  /** Whole days since the Behavior was last Completed; null when never. */
  daysSinceLastCompleted: number | null;
  /** Other free starts for Other time (UTC instants, ascending, at most 3). */
  otherTimes: readonly string[];
  travel: BriefMoveTravel;
  /** Declined on enough different days: also offer "Don't suggest adding this". */
  offerNeverAdd: boolean;
  status: BriefOpportunityProposalStatus;
  /** The Occurrence that Yes or Other time added, for Undo. Null otherwise. */
  occurrenceId: string | null;
  /** Where the added item sits while it stands. Null when nothing stands. */
  appliedAt: BriefMoveSpan | null;
}>;

/** The opportunity part of a brief. Absent from responses to clients that did not opt in. */
export type BriefOpportunities = Readonly<{
  version: typeof BRIEF_OPPORTUNITIES_VERSION;
  localDate: string;
  timezone: string;
  runId: string | null;
  lines: readonly BriefOpportunityLine[];
  calendar: "current" | "stale" | "none";
}>;

// ---------------------------------------------------------------- answers

type AnswerBase = Readonly<{ target: "opportunity"; idempotencyKey: string; proposalId: string }>;

/** Sent to BRIEF_MOVE_ROUTES.answer with `target: "opportunity"`. */
export type BriefOpportunityAnswerRequest =
  | (AnswerBase & Readonly<{ kind: "yes"; context: BriefPlanningContext }>)
  | (AnswerBase & Readonly<{ kind: "other_time"; startAt: string; context: BriefPlanningContext }>)
  | (AnswerBase & Readonly<{ kind: "no" }>)
  | (AnswerBase & Readonly<{ kind: "undo" }>)
  | (AnswerBase & Readonly<{ kind: "never_add" }>);

export type BriefOpportunityAnswerKind = BriefOpportunityAnswerRequest["kind"];

export type BriefOpportunityRefusal = Readonly<{
  reason: string;
  /** Plain text from the notices library. */
  message: string;
  /** Free starts the person can pick instead, when the refusal was about the time. */
  alternatives: readonly string[];
}>;

export type BriefOpportunityAnswerResponse = Readonly<{
  target: "opportunity";
  kind: BriefOpportunityAnswerKind;
  proposalId: string;
  outcome: "applied" | "refused";
  line: BriefOpportunityLine | null;
  refusal: BriefOpportunityRefusal | null;
  /** The Occurrence added (Yes, Other time) or removed (Undo). */
  occurrenceId: string | null;
  replayed: boolean;
}>;

/** BRIEF_MOVE_ROUTES.replan with `opportunityProposalId`: the next free time, no model call. */
export type BriefOpportunityReplanRequest = Readonly<{ opportunityProposalId: string; context: BriefPlanningContext }>;
export type BriefOpportunityReplanResponse = Readonly<{ line: BriefOpportunityLine | null; replacedProposalId: string }>;

/**
 * BRIEF_MOVE_ROUTES.recheck with `opportunityProposalIds`: each undecided line the screen
 * shows is checked against the day as it is now. A line whose time is taken comes back
 * re-planned; `line: null` hides it. The response adds `opportunities` only for a request
 * that sent `opportunityProposalIds`.
 */
export type BriefOpportunityRecheckResponse = Readonly<{ replaced: readonly Readonly<{ proposalId: string; line: BriefOpportunityLine | null }>[] }>;

/** BRIEF_MOVE_ROUTES.preference with `neverSuggestAdd` (PUT) or `?kind=opportunity` (GET). */
export type BehaviorOpportunityPreference = Readonly<{ behaviorId: string; neverSuggestAdd: boolean; updatedAt: string | null }>;
