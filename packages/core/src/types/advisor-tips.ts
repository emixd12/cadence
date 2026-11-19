/**
 * Advisor tips ("quips") API types (advisor plan Phase 4, workstream 4B).
 *
 * The advisor (the horse; "coach" is the internal name) shows one to three short lines a
 * day. Each states one counted fact from the person's own records and one action, and
 * comes from one reviewed advice card (`./advice-cards.ts`, workstream 4A). The nightly
 * coach visit writes the day's tips; opening the app never calls a model.
 *
 * Routes (web and Mac, signed-in person; the Mac sends its hosted bearer token):
 *   GET  /api/advisor/tips/next      -> AdvisorTipsNextResponse
 *   POST /api/advisor/tips/reaction  AdvisorTipReactionRequest -> AdvisorTipReactionResponse
 *
 * Showing rules (server-side, so every client gets them):
 * - At most one new tip per app open, and at least `minimumSpacingMinutes` (120) after the
 *   previous new tip. Inside the spacing, `next` returns the tip already shown, with
 *   `fresh: false`, so a reload shows the same line.
 * - The only hold: today's Daily Brief has move lines that wait for an answer. Needs
 *   decision items never hold tips (review decision D5).
 * - Tips off in Settings: `state: "none"`, reason `tips_off`. Nothing is shown.
 *
 * Old installed Macs never call these routes, so they show nothing new. Web sends its
 * session cookie and the Mac its Bearer token, as for the Daily Brief.
 */

export const ADVISOR_TIP_ROUTES = Object.freeze({
  next: "/api/advisor/tips/next",
  reaction: "/api/advisor/tips/reaction",
});

export const ADVISOR_TIP_MINIMUM_SPACING_MINUTES = 120;

export const ADVISOR_TIP_REACTIONS = ["helpful", "not_now", "dont_suggest"] as const;
/**
 * helpful: kept for evals and analytics.
 * not_now: hides this tip today; the card may come back after its 14-day rest.
 * dont_suggest: this card is never matched again for this account (on every device).
 */
export type AdvisorTipReaction = (typeof ADVISOR_TIP_REACTIONS)[number];

/** The "Why this?" research card, built from the advice card that produced the tip. */
export type AdvisorTipResearch = Readonly<{
  cardId: string;
  cardRevision: number;
  /** The advice in one plain sentence. */
  advice: string;
  /** One concrete step in Cadence. */
  action: string;
  /** What the source found, in plain words. */
  claim: string;
  source: Readonly<{
    citation: string;
    url: string;
    /** meta_analysis, systematic_review, randomized_trial, cohort_study, theory_review, guidance, editorial_guidance */
    kind: string;
  }>;
  /** strong, moderate, limited or product_rule. */
  strength: string;
  /** any_account, first_two_weeks or history_needed. */
  audience: string;
  /** Who the advice may not fit, or what the source does not show. */
  limitation: string;
}>;

export type AdvisorTip = Readonly<{
  id: string;
  /** The account's local date the tip belongs to. */
  localDate: string;
  /** One or two short sentences: one counted fact and one action. Plain text, no Markdown. */
  text: string;
  /** Behavior the tip is about, or null for an account-wide tip. */
  behaviorId: string | null;
  /** When it was first shown (ISO instant). */
  shownAt: string;
  reaction: AdvisorTipReaction | null;
  research: AdvisorTipResearch;
}>;

export type AdvisorTipsHoldReason = "brief_lines_waiting";

export type AdvisorTipsNoneReason =
  /** Advisor tips are off in Settings. */
  | "tips_off"
  /** Nothing true and new today (no filler, D1), or the nightly visit has not run yet. */
  | "no_tips_today"
  /** Every tip for today has been shown or reacted to. */
  | "all_shown";

export type AdvisorTipsNextResponse =
  | Readonly<{
    state: "tip";
    tip: AdvisorTip;
    /** True when this call showed the tip for the first time. */
    fresh: boolean;
    /** Earliest time another new tip may appear today (ISO instant), or null if none is left. */
    nextAt: string | null;
  }>
  | Readonly<{ state: "hold"; reason: AdvisorTipsHoldReason }>
  | Readonly<{ state: "none"; reason: AdvisorTipsNoneReason }>;

export type AdvisorTipReactionRequest = Readonly<{
  tipId: string;
  reaction: AdvisorTipReaction;
}>;

export type AdvisorTipReactionResponse = Readonly<{
  tip: AdvisorTip;
}>;

/** Error body from both routes: `{ error: AdvisorTipsErrorCode }`, as the brief move routes. */
export type AdvisorTipsErrorCode =
  | "unauthenticated" // 401
  | "invalid_request" // 400
  | "tip_not_found" // 404
  | "advisor_unavailable"; // 503
