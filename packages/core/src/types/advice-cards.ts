/**
 * Advice library card types (advisor plan, Phase 4 workstream 4A).
 *
 * A card is one reviewed piece of advice: one plain sentence, the rule over coach signals
 * that makes it relevant, the evidence behind it, and 2 to 3 quip seeds that code can fill
 * with counted facts. Cards live in `packages/core/src/data/advice-library.json`; adding a
 * card is a content change with no code change. Only `active` cards reach people, and a card
 * becomes active only after the owner's review (`reviewer` and `reviewed_at` set).
 *
 * `ADVICE_SIGNAL_FACTS` is the contract between the cards and the coach signals resolver
 * (4B): the fact names a card rule or quip seed may use, per signal kind. The validator
 * rejects any other name, so a renamed fact fails tests instead of silently never matching.
 */

/** Signal kinds from `coach-signals-1` (live since Nov 18). */
export const ADVICE_SIGNAL_KINDS_V1 = [
  "completion_drop",
  "repeated_move",
  "late_marking",
  "new_behavior_settled",
  "brief_answers",
] as const;

/** Signal kinds added by `coach-signals-2` (4B step 1). */
export const ADVICE_SIGNAL_KINDS_V2 = [
  "weekly_numbers",
  "weekday_gap",
  "time_of_day_gap",
  "timing_mode_gap",
  "steady_behavior",
  "never_done",
  "dip_recovery",
  "day_shape",
  "unmarked_items",
  "marking_time",
  "done_together",
  "crowded_hour",
  "setup_gaps",
  "reminder_response",
  "session_length",
  "moved_vs_unmoved",
] as const;

/**
 * `account` is not a stored signal. It stands for the account's setup facts
 * (`AdviceAccountFacts`), which the matcher always has, so first-two-weeks cards can
 * match from setup alone.
 */
export const ADVICE_SIGNAL_KINDS = [...ADVICE_SIGNAL_KINDS_V1, ...ADVICE_SIGNAL_KINDS_V2, "account"] as const;
export type AdviceSignalKind = (typeof ADVICE_SIGNAL_KINDS)[number];

/** Setup facts for one account, computed by code on each coach visit and at sign-up. */
export type AdviceAccountFacts = Readonly<{
  /** Days since the account's first Behavior was created; 0 on the first day. */
  account_age_days: number;
  active_behaviors: number;
  /** Active Behaviors scheduled with a time window rather than a set time. */
  behaviors_with_window: number;
  behaviors_with_set_time: number;
  /** Active Behaviors with no expected length. */
  behaviors_without_length: number;
  /** Active Behaviors with no place. */
  behaviors_without_place: number;
  /** Scheduled items per part of day on a typical week (set or window start time). */
  morning_items: number;
  afternoon_items: number;
  evening_items: number;
  /** Most items set for the same clock hour on any one day of a typical week. */
  max_items_same_hour: number;
  behaviors_created_last_14_days: number;
}>;

export const ADVICE_ACCOUNT_FACT_NAMES = [
  "account_age_days",
  "active_behaviors",
  "behaviors_with_window",
  "behaviors_with_set_time",
  "behaviors_without_length",
  "behaviors_without_place",
  "morning_items",
  "afternoon_items",
  "evening_items",
  "max_items_same_hour",
  "behaviors_created_last_14_days",
] as const satisfies readonly (keyof AdviceAccountFacts)[];

/** Every kind may also carry its counting period. */
export const ADVICE_COMMON_FACTS = ["window_days"] as const;

/**
 * Fact names a card may use, per signal kind (plus `ADVICE_COMMON_FACTS`). Rates are 0 to 1 and count only Completed and
 * Not Completed marks: no fact counts an unmarked day (Phase 4 decision D5).
 */
export const ADVICE_SIGNAL_FACTS: Readonly<Record<AdviceSignalKind, readonly string[]>> = Object.freeze({
  completion_drop: ["recent_days", "recent_completed", "recent_resolved", "recent_rate", "baseline_days", "baseline_completed", "baseline_resolved", "baseline_rate", "drop"],
  repeated_move: ["window_days", "moved_days", "same_direction_days", "direction", "median_shift_minutes", "median_target_time", "target_spread_minutes", "weekdays", "last_moved_date", "weekday_matching", "weekday_later", "weekday_earlier"],
  late_marking: ["window_days", "decisions", "later_day", "late_share", "median_lag_days"],
  new_behavior_settled: ["age_days", "first_days", "completed", "not_completed", "completion_rate"],
  brief_answers: ["window_days", "answers", "answered_days", "declined_days", "last_answer_date"],
  weekly_numbers: ["week_completed", "week_not_completed", "week_rate", "prior_weeks", "prior_rate", "change"],
  weekday_gap: ["weekday", "weekday_rate", "other_rate", "gap", "weekday_resolved", "other_resolved"],
  time_of_day_gap: ["part_of_day", "part_rate", "other_rate", "gap", "part_resolved", "other_resolved"],
  timing_mode_gap: ["weaker_mode", "window_rate", "set_time_rate", "gap", "window_resolved", "set_time_resolved"],
  steady_behavior: ["weeks", "rate", "completed", "resolved"],
  never_done: ["weeks", "rate", "completed", "resolved"],
  dip_recovery: ["dip_weeks", "dip_rate", "usual_rate", "recovered", "recent_rate"],
  day_shape: ["pattern", "bad_days", "missed_total", "miss_share_on_bad_days"],
  unmarked_items: ["unmarked", "oldest_days"],
  marking_time: ["decisions", "median_lag_hours", "median_mark_time", "same_day_share"],
  done_together: ["other_behavior_id", "pattern", "together_days", "either_days"],
  crowded_hour: ["hour", "items_in_hour", "hour_rate", "other_rate", "hour_resolved"],
  setup_gaps: ["missing_length", "missing_place", "without_length", "without_place", "active_behaviors"],
  reminder_response: ["reminded_marked", "within_30_min", "later", "quick_share", "median_minutes_after"],
  session_length: ["sessions", "planned_minutes", "median_minutes", "shorter", "longer", "on_target", "pattern"],
  moved_vs_unmoved: ["moved_rate", "moved_resolved", "unmoved_rate", "unmoved_resolved", "gap", "pattern"],
  account: ADVICE_ACCOUNT_FACT_NAMES,
});

export type AdviceFactValue = string | number | boolean | null | readonly number[];

export type AdviceFactCondition = Readonly<{
  fact: string;
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in";
  value: string | number | boolean | readonly (string | number)[];
}>;

/**
 * One condition: a signal of this kind is present (for one Behavior, for the whole account,
 * or either), and all its fact conditions hold.
 */
export type AdviceRule = Readonly<{
  signal: AdviceSignalKind;
  scope: "behavior" | "account" | "either";
  facts: readonly AdviceFactCondition[];
}>;

export const ADVICE_EVIDENCE_KINDS = [
  "meta_analysis",
  "systematic_review",
  "randomized_trial",
  "experiment",
  "observational_study",
  "theory_review",
  "guidance",
  "editorial_guidance",
] as const;
export type AdviceEvidenceKind = (typeof ADVICE_EVIDENCE_KINDS)[number];

/**
 * How much the evidence supports the card's advice for a person like this, not the
 * source's prestige. `product_rule` is for Cadence's own editorial rules.
 */
export const ADVICE_EVIDENCE_STRENGTHS = ["strong", "moderate", "limited", "product_rule"] as const;
export type AdviceEvidenceStrength = (typeof ADVICE_EVIDENCE_STRENGTHS)[number];

export type AdviceSource = Readonly<{
  id: string;
  /** Short citation: authors, year, title. */
  citation: string;
  /** Working link: the DOI link when there is one. */
  url: string;
  doi: string | null;
  year: number | null;
  kind: AdviceEvidenceKind;
  /** When a person last opened the link and matched the claim to the text. */
  checked_at: string;
}>;

export type AdviceEvidence = Readonly<{
  source_id: string;
  kind: AdviceEvidenceKind;
  strength: AdviceEvidenceStrength;
  /** What the source found, in plain words. Shown on the "Why this?" card. */
  claim: string;
  /** The one sentence from the source the card relies on, verbatim. Shown on the review page. */
  quote: string;
  /** Where the sentence is: abstract, a section, or a page. */
  locator: string;
}>;

export const ADVICE_AUDIENCES = ["any_account", "first_two_weeks", "history_needed"] as const;
export type AdviceAudience = (typeof ADVICE_AUDIENCES)[number];

export type AdviceCardStatus = "draft" | "active" | "withdrawn";

/** Where an `open` offer's link goes (see `ADVISOR_TIP_LINK_TARGETS` in ./advisor-tips). */
export const ADVICE_OFFER_LINK_TARGETS = ["time", "length", "where", "description", "behavior", "unmarked", "behaviors"] as const;
export type AdviceOfferLinkTarget = (typeof ADVICE_OFFER_LINK_TARGETS)[number];

/**
 * What a tip from this card lets the person do ("Tips with one-tap changes", Nov 20):
 * - set_time: a one-tap new set time, computed by code from the Behavior's moves
 *   (repeated_move cards only);
 * - set_length: a one-tap new length, the usual session time (session_length cards only);
 * - open: a link to the right editor or list;
 * - null: no action (the advice is to keep things as they are, or to keep marking).
 * The question and the link's words are written by code, never by the card or the model.
 */
export type AdviceOffer =
  | Readonly<{ kind: "set_time" }>
  | Readonly<{ kind: "set_length" }>
  | Readonly<{ kind: "open"; target: AdviceOfferLinkTarget }>;

export type AdviceCard = Readonly<{
  id: string;
  revision: number;
  status: AdviceCardStatus;
  /** One plain sentence. */
  advice: string;
  /** The card applies when any rule holds. */
  applies_when: readonly AdviceRule[];
  /** The card never applies while any of these holds, for the same Behavior or the account. */
  does_not_apply_when: readonly AdviceRule[];
  /** One concrete step in Cadence the person can take. */
  action: string;
  evidence: AdviceEvidence;
  /** Who the advice may not fit, or what the source does not show. */
  limitation: string;
  /**
   * 2 to 3 short lines with `{behavior}` and `{fact_name}` placeholders. A fact
   * placeholder takes a fact from the matched signal; `{fact_name_pct}` shows a rate as a
   * whole percent; `{weekday_name}` and `{hour_label}` format those facts.
   */
  quip_seeds: readonly string[];
  audience: AdviceAudience;
  /** The tip's one action, or null. */
  offer: AdviceOffer | null;
  reviewed_at: string | null;
  reviewer: string | null;
}>;

export type AdviceLibrary = Readonly<{
  version: string;
  sources: readonly AdviceSource[];
  cards: readonly AdviceCard[];
}>;

/** One signal as the matcher reads it: a stored coach signal, or a test fixture. */
export type AdviceSignalInput = Readonly<{
  /** Stored signal id, when there is one; used for fact ids. */
  id?: string | null;
  kind: AdviceSignalKind;
  behaviorId: string | null;
  facts: Readonly<Record<string, unknown>>;
}>;

export type AdviceCardShown = Readonly<{
  cardId: string;
  /** Local date the card was last shown to this account. */
  localDate: string;
  behaviorId?: string | null;
}>;

export type AdviceMatch = Readonly<{
  card: AdviceCard;
  /** The signal that matched, or the account pseudo-signal. */
  signal: AdviceSignalInput;
  behaviorId: string | null;
  /** Fact names the matched rule tested; a quip about this match should state one of these. */
  factNames: readonly string[];
  /** `<kind>:<behaviorId or "account">:<fact>` for each name in `factNames` (4B's quip fact ids). */
  factIds: readonly string[];
  /** 1 for a kind-only match, plus 1 per fact condition, plus 1 for a Behavior-scoped match. */
  matchStrength: number;
  evidenceStrength: AdviceEvidenceStrength;
  /** Days since this card was last shown to the account, or null if never. */
  daysSinceShown: number | null;
  score: number;
}>;
