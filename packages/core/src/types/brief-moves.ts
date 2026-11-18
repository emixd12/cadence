/**
 * Advisor plan Phase 3 (3A1): the Daily Brief's move lines and the answers a person
 * gives them. Shared by the server (lib/services/brief-move-*.ts), the web brief (3B)
 * and Cadence for Mac (3C). The server keeps proposals and answers; clients render
 * lines and send answers. Nothing here is model text except `reason` on a line, which
 * the server validates before it is stored.
 *
 * Rules (docs/DATETIME_STRATEGY.md, "Moves", and "Brief moves"):
 *   - A line offers one move of one of today's Unresolved items. Range Behaviors,
 *     "alongside" Behaviors, Behaviors switched to "Don't suggest moving this", and
 *     starts after the latest hour (default 10 pm local) are never offered.
 *   - A line is valid until it is answered, refused at tap time, or the day ends. The
 *     brief as a whole never expires and is never withdrawn by a Timeline change.
 *   - No, and Undo after Yes, mean "no more suggestions for this item today",
 *     including after a Refresh. Other time is how the person asks for another slot.
 *   - Yes applies exactly the time and length the line showed.
 */

/** Bump when a field's meaning changes. Clients send it in `features` to receive lines. */
export const BRIEF_MOVES_VERSION = "1" as const;

/**
 * The brief request's opt-in. A client that does not send it (installed apps from
 * before Phase 3) receives the opening and travel, and no move lines.
 */
export const BRIEF_MOVE_LINES_FEATURE = "move_lines_v1" as const;

/** Suggested starts after this local minute are not offered (22:00). Adjustable later. */
export const BRIEF_MOVE_DEFAULT_LATEST_START_MINUTE = 22 * 60;

/** After this many declines of one Behavior on different days, the line offers "Don't suggest moving this". */
export const BRIEF_MOVE_NEVER_OFFER_AFTER_DECLINES = 4;

/** Every item has a length; this is the last resort, shown as "assumes 30 min · change". */
export const BRIEF_MOVE_FALLBACK_MINUTES = 30;

/**
 * Where an item's length came from, in the order the server tries them.
 * `model_estimate` and `fallback` are assumptions: the line shows "assumes N min · change".
 */
export const BRIEF_MOVE_LENGTH_SOURCES = ["behavior_duration", "logged_average", "model_estimate", "fallback"] as const;
export type BriefMoveLengthSource = (typeof BRIEF_MOVE_LENGTH_SOURCES)[number];

export type BriefMoveLength = Readonly<{
  minutes: number;
  source: BriefMoveLengthSource;
  /** True for `model_estimate` and `fallback`: show "assumes N min · change". */
  assumed: boolean;
}>;

/**
 * Travel for the line's new time.
 * `checked`: known travel times fit the new time.
 * `not_needed`: the item has no place that needs travel ("anywhere", or travel is off).
 * `not_checked`: the item has a place but no travel time is known for the new slot;
 * the line says "travel not checked".
 */
export type BriefMoveTravel = "checked" | "not_needed" | "not_checked";

/** Stock reason codes. The opening and reason sentences may be model text (3A2); codes never are. */
export const BRIEF_MOVE_REASON_CODES = [
  "calendar_overlap",
  "item_overlap",
  "travel_overlap",
  "tight_transition",
  "time_passed",
  "conflict_after_schedule_edit",
] as const;
export type BriefMoveReasonCode = (typeof BRIEF_MOVE_REASON_CODES)[number];

export const BRIEF_MOVE_PROPOSAL_STATUSES = [
  "proposed", "accepted", "declined", "already_done", "other_time", "superseded", "withdrawn", "undone",
] as const;
export type BriefMoveProposalStatus = (typeof BRIEF_MOVE_PROPOSAL_STATUSES)[number];

/** A time span as UTC instants (ISO 8601). Clients format it in the item's timezone. */
export type BriefMoveSpan = Readonly<{ startAt: string; endAt: string }>;

/** One move line, as stored with its proposal and rebuilt on reopen with no model call. */
export type BriefMoveLine = Readonly<{
  proposalId: string;
  occurrenceId: string;
  behaviorId: string;
  /** The Behavior's title, from Cadence's records, never from model text. */
  title: string;
  localDate: string;
  timezone: string;
  /** The Occurrence's revision (`updated_at`) the line was built from. Send it back with Yes. */
  expectedRevision: string;
  /** Where the item is now ("9:00") and where the line moves it ("11:30"). */
  from: BriefMoveSpan;
  to: BriefMoveSpan;
  length: BriefMoveLength;
  reasonCode: BriefMoveReasonCode;
  /** One plain sentence. Stock text until 3A2's model writes it; never empty. */
  reason: string;
  /** The calendar event or trip the reason names, when one does. Display text only. */
  anchor: Readonly<{ kind: "calendar_event" | "trip" | "item"; title: string }> | null;
  /** Other free starts for Other time, same rule set as `to` (UTC instants, ascending). */
  otherTimes: readonly string[];
  travel: BriefMoveTravel;
  /** The item's time has passed: also offer "Already did it". */
  late: boolean;
  /** Declined on enough different days: also offer "Don't suggest moving this". */
  offerNeverMove: boolean;
  status: BriefMoveProposalStatus;
  /** Set once answered with Yes or Other time: the applied move, for Undo. */
  moveId: string | null;
}>;

/** An open schedule-edit collision (Phase 2 move_conflicts) shown as a line in the brief. */
export type BriefMoveConflictLine = Readonly<{
  conflictId: string;
  occurrenceId: string;
  behaviorId: string;
  title: string;
  expectedRevision: string;
  /** Where the moved item sits now. */
  at: BriefMoveSpan;
  conflictingTitle: string | null;
}>;

/** The move part of a brief. Absent from responses to clients that did not opt in. */
export type BriefMoves = Readonly<{
  version: typeof BRIEF_MOVES_VERSION;
  localDate: string;
  timezone: string;
  /** The agent run the lines came from; a Refresh replaces it. */
  runId: string | null;
  lines: readonly BriefMoveLine[];
  conflicts: readonly BriefMoveConflictLine[];
  /** Show Accept all above two or more undecided lines. */
  acceptAll: boolean;
  /** Set after Accept all: Undo all reverses this batch. */
  undoAllBatchId: string | null;
  /** Calendar freshness behind the lines. `stale`: no time that depends on the calendar is offered. */
  calendar: "current" | "stale" | "none";
}>;

// ---------------------------------------------------------------- request context

/** A calendar event the screen already holds, as UTC instants. Used for one request; never stored. */
export type BriefCalendarBusy = Readonly<{ startAt: string; endAt: string; ref?: string; title?: string }>;

/**
 * What the screen sends with Yes, Other time, Accept all and Re-plan, so the free-slot
 * check sees what the screen sees. The server keeps no calendar copy and never stores
 * or sends travel times to a model (docs/DECISIONS.md, 2026-11-18, "Brief moves see travel").
 */
export type BriefPlanningContext = Readonly<{
  calendarBusy: readonly BriefCalendarBusy[];
  /** Signed travel times from the latest routes response (`travelTimesToken`), passed back unchanged. */
  travelTimes?: string;
}>;

// ---------------------------------------------------------------- answers

/** Every answer carries a fresh idempotency key per tap; a retry of the same tap reuses it. */
type AnswerBase = Readonly<{ idempotencyKey: string }>;

export type BriefMoveAnswerRequest =
  /** Apply the line's time and length. */
  | (AnswerBase & Readonly<{ kind: "yes"; proposalId: string; expectedRevision: string; context: BriefPlanningContext }>)
  /** No more suggestions for this item today. Changes nothing on the Timeline. */
  | (AnswerBase & Readonly<{ kind: "no"; proposalId: string }>)
  /** Move to a time the person picked (from `otherTimes` or the time picker). */
  | (AnswerBase & Readonly<{ kind: "other_time"; proposalId: string; expectedRevision: string; startAt: string; context: BriefPlanningContext }>)
  /** Mark the item Completed as the signed-in person; the proposal is recorded as already done first. */
  | (AnswerBase & Readonly<{ kind: "already_done"; proposalId: string; expectedRevision: string }>)
  /** Undo a Yes or Other time. Counts as a No for the rest of the day. */
  | (AnswerBase & Readonly<{ kind: "undo"; proposalId: string; expectedRevision: string }>)
  /** Each line is checked on its own at tap time; one refusal does not block the rest. */
  | (AnswerBase & Readonly<{ kind: "accept_all"; lines: readonly Readonly<{ proposalId: string; expectedRevision: string }>[]; context: BriefPlanningContext }>)
  /** Reverses every move of that Accept all that is still its item's latest move. */
  | (AnswerBase & Readonly<{ kind: "undo_all"; batchId: string }>)
  /** "Don't suggest moving this": stored per Behavior; the same switch is in Behavior settings. */
  | (AnswerBase & Readonly<{ kind: "never_move"; proposalId: string }>);

export type BriefMoveAnswerKind = BriefMoveAnswerRequest["kind"];

/** Why a single line's answer was not applied. Move refusals reuse Phase 2's reasons and wording. */
export type BriefMoveRefusal = Readonly<{
  reason: string;
  /** Plain text for the existing alert style. */
  message: string;
  /** Free starts the person can pick instead, when the refusal was about the time. */
  alternatives: readonly string[];
  /** The item's current revision, so the screen can redraw it. */
  revision: string | null;
}>;

/** The result for one line. */
export type BriefMoveLineResult = Readonly<{
  proposalId: string;
  outcome: "applied" | "refused";
  /** The line as it stands after the answer (status, moveId). */
  line: BriefMoveLine | null;
  refusal: BriefMoveRefusal | null;
  /** The item's new effective time and revision after a move or Undo, for the Timeline redraw. */
  occurrence: Readonly<{ id: string; effectiveStartAt: string | null; effectiveEndAt: string | null; revision: string; status: string }> | null;
  /** The move written, for the 2C Undo drawer. */
  moveId: string | null;
}>;

export type BriefMoveAnswerResponse = Readonly<{
  kind: BriefMoveAnswerKind;
  results: readonly BriefMoveLineResult[];
  /** Accept all: the batch Undo all reverses. */
  batchId: string | null;
  /** True when the same idempotency key was already answered; nothing new was applied. */
  replayed: boolean;
  /**
   * True when this answer applied the person's first move ever (brief and self-moves
   * both count): show the one-time line "This changes today only. Your schedule stays."
   */
  showFirstMoveLine: boolean;
}>;

// ---------------------------------------------------------------- Re-plan and length

/** Re-plan one line: the planner again on current data, no model call. */
export type BriefMoveReplanRequest = Readonly<{ proposalId: string; context: BriefPlanningContext }>;
/** A fresh line replacing the old one (status `superseded`), or none when nothing fits. */
export type BriefMoveReplanResponse = Readonly<{ line: BriefMoveLine | null; replacedProposalId: string }>;

/**
 * "assumes 30 min · change": the person's correction becomes the Behavior's default
 * length (their own write) and replaces the cached estimate.
 */
export type BriefMoveLengthRequest = Readonly<{ behaviorId: string; minutes: number; expectedBehaviorRevision: string }>;
export type BriefMoveLengthResponse = Readonly<{ behaviorId: string; minutes: number; revision: string }>;

/** Per-Behavior move preferences (server only). */
export type BehaviorMovePreference = Readonly<{ behaviorId: string; neverSuggestMove: boolean; updatedAt: string | null }>;

/** HTTP routes (same auth as /api/advisor/brief: web session or Mac bearer). */
export const BRIEF_MOVE_ROUTES = Object.freeze({
  answer: "/api/advisor/brief/answer",
  replan: "/api/advisor/brief/replan",
  length: "/api/advisor/brief/length",
  /** GET and PUT { behaviorId, neverSuggestMove }. */
  preference: "/api/advisor/brief/move-preference",
});

/** Error codes the brief move routes return as `{ error }`. */
export type BriefMoveErrorCode =
  | "unauthenticated"
  | "invalid_request"
  | "proposal_not_found"
  | "proposal_closed"
  | "idempotency_key_reused"
  | "rate_limited"
  | "advisor_unavailable";
