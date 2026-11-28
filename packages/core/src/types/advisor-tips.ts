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
 *   GET  /api/advisor/tips/recent    -> AdvisorTipsRecentResponse (4E: the panel's "Earlier")
 *
 * Showing rules (server-side, so every client gets them):
 * - At most one new tip per app open, and at least `minimumSpacingMinutes` (120) after the
 *   previous new tip. Inside the spacing, `next` returns the tip already shown, with
 *   `fresh: false`, so a reload shows the same line.
 * - Nothing holds tips back: they show while brief move lines or Needs decision items wait
 *   (review decision D5). Facts never count an unmarked day or an undecided item.
 * - Tips off in Settings: `state: "none"`, reason `tips_off`. Nothing is shown.
 *
 * Old installed Macs never call these routes, so they show nothing new. Web sends its
 * session cookie and the Mac its Bearer token, as for the Daily Brief.
 */

export const ADVISOR_TIP_ROUTES = Object.freeze({
  next: "/api/advisor/tips/next",
  reaction: "/api/advisor/tips/reaction",
  recent: "/api/advisor/tips/recent",
});

/** 4E: how far back the advisor panel's "Earlier" list reaches, and how many tips it holds. */
export const ADVISOR_RECENT_TIPS = Object.freeze({ days: 7, limit: 10 });

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

/**
 * What a tip's link opens ("Tips with one-tap changes"): a Behavior's editor on one field
 * (time, length, where, description, alongside, or the whole editor), Needs decision
 * (unmarked), or the Behaviors list. `alongside` (Ticket 385) needs migration
 * 20261126240000 on the database: the stored `coach_tips.link_target` check lists every value.
 */
export const ADVISOR_TIP_LINK_TARGETS = ["time", "length", "where", "description", "behavior", "unmarked", "behaviors", "alongside"] as const;
export type AdvisorTipLinkTarget = (typeof ADVISOR_TIP_LINK_TARGETS)[number];

export type AdvisorTipLink = Readonly<{
  target: AdvisorTipLinkTarget;
  /** The Behavior whose editor opens; null for Needs decision and the list. */
  behaviorId: string | null;
  /** The link's words, built by Cadence: "Set a length", "Open Needs decision". */
  label: string;
}>;

const LINK_LABELS: Readonly<Record<AdvisorTipLinkTarget, string>> = {
  time: "Change the set time",
  length: "Set a length",
  where: "Add when and where",
  description: "Write it in the description",
  behavior: "Edit the Behavior",
  unmarked: "Open Needs decision",
  behaviors: "Open Behaviors",
  alongside: "Say if it can be done alongside",
};

export function advisorTipLink(target: AdvisorTipLinkTarget, behaviorId: string | null): AdvisorTipLink {
  // A Behavior editor link with no Behavior opens the list instead.
  const needsBehavior = target !== "unmarked" && target !== "behaviors";
  if (needsBehavior && !behaviorId) return { target: "behaviors", behaviorId: null, label: LINK_LABELS.behaviors };
  return { target, behaviorId: needsBehavior ? behaviorId : null, label: LINK_LABELS[target] };
}

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
  /**
   * The schedule question this tip carries ("Set Gym to 6:30 PM every day?"), shown with
   * its answers in place of the tip while it is open. Absent from servers before Nov 20.
   */
  proposalId?: string | null;
  /** Where the tip's link goes, when it has one and no question. */
  link?: AdvisorTipLink | null;
}>;

export type AdvisorTipsNoneReason =
  /** Advisor tips are off in Settings. */
  | "tips_off"
  /** Nothing true and new today (no filler, D1), or the nightly visit has not run yet. */
  | "no_tips_today"
  /** Every tip for today has been shown or reacted to. */
  | "all_shown"
  /** The last tip was answered with "not now" or "don't suggest"; another may come at `nextAt`. */
  | "later";

export type AdvisorTipsNextResponse =
  | Readonly<{
    state: "tip";
    tip: AdvisorTip;
    /** True when this call showed the tip for the first time. */
    fresh: boolean;
    /** Earliest time another new tip may appear today (ISO instant), or null if none is left. */
    nextAt: string | null;
  }>
  | Readonly<{ state: "none"; reason: AdvisorTipsNoneReason; nextAt: string | null }>;

export type AdvisorTipReactionRequest = Readonly<{
  tipId: string;
  reaction: AdvisorTipReaction;
}>;

export type AdvisorTipReactionResponse = Readonly<{
  tip: AdvisorTip;
}>;

/** Tips shown before today (newest first), for the panel's "Earlier" list. Empty when tips are off. */
export type AdvisorTipsRecentResponse = Readonly<{ tips: readonly AdvisorTip[] }>;

/** Error body from the tip routes: `{ error: AdvisorTipsErrorCode }`, as the brief move routes. */
export type AdvisorTipsErrorCode =
  | "unauthenticated" // 401
  | "invalid_request" // 400
  | "tip_not_found" // 404
  | "advisor_unavailable"; // 503
