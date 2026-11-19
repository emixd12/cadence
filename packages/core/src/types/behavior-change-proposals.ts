/**
 * Advisor Phase 4C: what the schedule-proposal route returns and accepts
 * (GET and POST /api/advisor/coach/schedule-proposal). Web and the Mac (4E) draw from
 * this. Every sentence is built by Cadence; the reason is validated model text or the
 * code's own.
 */

export const SCHEDULE_PROPOSAL_ROUTE = "/api/advisor/coach/schedule-proposal";

export type ScheduleProposalAnswer = "try" | "for_good" | "no" | "keep" | "go_back";

export type ScheduleProposalView =
  /** Nothing to show. */
  | Readonly<{ kind: "none" }>
  /**
   * A proposal or check-in exists but waits: answering today would move one of today's
   * items, because today is a weekday the change touches. Show nothing.
   */
  | Readonly<{ kind: "hold"; proposalId: string; reason: "affected_weekday_today" }>
  /** "Change your schedule: Gym at 6:30 PM every Tuesday from Tuesday, Nov 24 (now 7:00 AM)." */
  | Readonly<{
      kind: "proposal";
      proposalId: string;
      behaviorId: string;
      line: string;
      reason: string;
      /** One line per schedule, before and after the change. */
      before: readonly string[];
      after: readonly string[];
      firstAffectedDate: string;
      answers: readonly ["try", "for_good", "no"];
    }>
  /** A trial in progress, before its check-in day. Optional for the UI to show. */
  | Readonly<{ kind: "trial"; proposalId: string; behaviorId: string; line: string; checkInDate: string }>
  /** "Keep Gym at 6:30 PM every Tuesday?" */
  | Readonly<{
      kind: "check_in";
      proposalId: string;
      behaviorId: string;
      question: string;
      answers: readonly ["keep", "go_back"];
    }>
  /** A one-time line: a trial kept without an answer, or edited by the person during the trial. */
  | Readonly<{ kind: "notice"; proposalId: string; behaviorId: string; text: string }>;

export type ScheduleProposalAnswerRequest = Readonly<{
  proposalId: string;
  answer: ScheduleProposalAnswer;
}>;

export type ScheduleProposalAnswerResult = Readonly<{
  /** True when the schedule edit ran (Try, Change for good, Go back). */
  applied: boolean;
  /** True when this answer had already been recorded. */
  replayed: boolean;
  /** What to show next in place of the line, built by Cadence. */
  view: ScheduleProposalView;
  /** One short line confirming the answer, for example "Gym is at 6:30 PM every Tuesday for two weeks." */
  message: string;
}>;

export type ScheduleProposalErrorCode =
  | "unauthenticated"
  | "invalid_request"
  | "proposal_not_found"
  | "proposal_closed"
  /** Today is a weekday the change touches; the line is not offered today. */
  | "held_today"
  /** The schedule changed after the line was written; the proposal is closed. */
  | "schedule_changed"
  | "revision_changed"
  | "advisor_unavailable";
