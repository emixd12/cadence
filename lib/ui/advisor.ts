import {
  ADVISOR_TIP_ROUTES,
  type AdvisorTip,
  type AdvisorTipLink,
  type AdvisorTipReaction,
  type AdvisorTipReactionResponse,
  type AdvisorTipsNextResponse,
  type AdvisorTipsRecentResponse,
} from "@cadence/core/types/advisor-tips";
import {
  SCHEDULE_PROPOSAL_ROUTE,
  type ScheduleProposalAnswer,
  type ScheduleProposalAnswerResult,
  type ScheduleProposalErrorCode,
  type ScheduleProposalView,
} from "@cadence/core/types/behavior-change-proposals";

/**
 * Advisor plan Phase 4, workstream 4E: the advisor's tips and schedule questions, one
 * transport for the web and Cadence for Mac. Each platform only supplies how a request
 * reaches the hosted API (web: session cookie; Mac: its bearer token), as for the brief's
 * move answers (`./daily-brief-moves.ts`). Errors surface as `DailyBriefRequestError`
 * with the route's `{ error }` code.
 *
 * After an answer that changed a schedule, `onScheduleChanged` runs: the Mac pulls the
 * new schedule through account sync; the web redraws through the runtime refresh.
 */
export type AdvisorClient = Readonly<{
  nextTip: (signal?: AbortSignal) => Promise<AdvisorTipsNextResponse>;
  react: (tipId: string, reaction: AdvisorTipReaction, signal?: AbortSignal) => Promise<AdvisorTip>;
  recentTips: (signal?: AbortSignal) => Promise<readonly AdvisorTip[]>;
  scheduleProposal: (signal?: AbortSignal) => Promise<ScheduleProposalView>;
  answerProposal: (proposalId: string, answer: ScheduleProposalAnswer, signal?: AbortSignal) => Promise<ScheduleProposalAnswerResult>;
}>;

/** Every advisor call is one short database read or write; the ceiling only bounds a stalled network. */
export const ADVISOR_REQUEST_DEADLINE_MS = 15_000;

type AdvisorRequest = <T>(path: string, init: RequestInit, signal?: AbortSignal) => Promise<T>;

export function createAdvisorClient(request: AdvisorRequest, onScheduleChanged: () => void = () => undefined): AdvisorClient {
  return {
    nextTip: (signal) => request<AdvisorTipsNextResponse>(ADVISOR_TIP_ROUTES.next, {}, signal),
    react: async (tipId, reaction, signal) => (await request<AdvisorTipReactionResponse>(ADVISOR_TIP_ROUTES.reaction, {
      method: "POST", body: JSON.stringify({ tipId, reaction }),
    }, signal)).tip,
    recentTips: async (signal) => (await request<AdvisorTipsRecentResponse>(ADVISOR_TIP_ROUTES.recent, {}, signal)).tips ?? [],
    scheduleProposal: (signal) => request<ScheduleProposalView>(SCHEDULE_PROPOSAL_ROUTE, {}, signal),
    answerProposal: async (proposalId, answer, signal) => {
      const result = await request<ScheduleProposalAnswerResult>(SCHEDULE_PROPOSAL_ROUTE, {
        method: "POST", body: JSON.stringify({ proposalId, answer }),
      }, signal);
      if (result.applied) onScheduleChanged();
      return result;
    },
  };
}

// ---------------------------------------------------------------- what the advisor shows

/** The brief, as the advisor's line and panel need it. The launcher publishes this. */
export type AdvisorBriefSummary =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "loading" }>
  /** `key` names the account and day; `openMoves` counts move lines still waiting for an answer. */
  | Readonly<{ kind: "ready"; key: string; openMoves: number }>
  /** Delivered earlier and not on screen now (for example after a reload); `reopen` shows it again with no model call. */
  | Readonly<{ kind: "closed"; key: string; reopen: () => void }>
  | Readonly<{ kind: "notice" }>;

/**
 * The one line under today's date shows the most pressing item, in this order:
 * the brief (until it is opened), a schedule question, a trial check-in, then the tip.
 * Nothing pressing means no line, and the horse's label reads just "Advisor".
 */
export type AdvisorLineItem =
  | Readonly<{ kind: "brief"; openMoves: number }>
  | Readonly<{ kind: "proposal"; view: Extract<ScheduleProposalView, { kind: "proposal" }> }>
  | Readonly<{ kind: "check_in"; view: Extract<ScheduleProposalView, { kind: "check_in" }> }>
  | Readonly<{ kind: "notice"; view: Extract<ScheduleProposalView, { kind: "notice" }> }>
  | Readonly<{ kind: "tip"; tip: AdvisorTip }>;

export type AdvisorLineInput = Readonly<{
  brief: AdvisorBriefSummary;
  /** The brief was opened from the advisor today on this device. */
  briefSeen: boolean;
  /** As loaded; an answer given on this screen keeps the question (with its outcome) until the next load. */
  proposal: ScheduleProposalView | null;
  tip: AdvisorTip | null;
  /** The tip was answered on this screen, so its outcome stays in place until the next load. */
  tipAnsweredHere: boolean;
}>;

export function advisorLineItem(input: AdvisorLineInput): AdvisorLineItem | null {
  if (input.brief.kind === "ready" && !input.briefSeen) return { kind: "brief", openMoves: input.brief.openMoves };
  if (input.brief.kind === "closed" && !input.briefSeen) return { kind: "brief", openMoves: 0 };
  const proposal = input.proposal;
  if (proposal?.kind === "proposal") return { kind: "proposal", view: proposal };
  if (proposal?.kind === "check_in") return { kind: "check_in", view: proposal };
  if (proposal?.kind === "notice") return { kind: "notice", view: proposal };
  const tip = input.tip;
  if (tip && (tip.reaction === null || tip.reaction === "helpful" || input.tipAnsweredHere)) return { kind: "tip", tip };
  return null;
}

/** "New" means something waits for the person: an unopened brief, an unanswered question, an unanswered tip. */
export function advisorHasNew(item: AdvisorLineItem | null, answeredHere: boolean): boolean {
  if (!item || answeredHere) return false;
  if (item.kind === "tip") return item.tip.reaction === null;
  return true;
}

/** The brief line: "2 moves suggested for today." or "Today’s brief is ready." */
export function briefLineText(openMoves: number): string {
  if (openMoves === 1) return "1 move suggested for today.";
  if (openMoves > 1) return `${openMoves} moves suggested for today.`;
  return "Today’s brief is ready.";
}

/** First sentence of a tip or notice, keeping ?/! and dropping a trailing period for the speech pill. */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^(.+?[.!?])(?:\s+|$)/.exec(trimmed);
  const sentence = match ? match[1] : trimmed;
  return sentence.endsWith(".") ? sentence.slice(0, -1) : sentence;
}

/** Short teaser shown in the advisor's speech pill when something waits in the panel. */
export function advisorBubbleTeaser(item: AdvisorLineItem): string {
  if (item.kind === "brief") return briefLineText(item.openMoves).replace(/\.$/, "");
  if (item.kind === "proposal") return proposalShortLine(item.view);
  if (item.kind === "check_in") return item.view.question;
  if (item.kind === "notice") return firstSentence(item.view.text);
  return firstSentence(item.tip.text);
}

export const TIP_REACTION_OUTCOME: Readonly<Record<AdvisorTipReaction, string>> = {
  helpful: "Saved as helpful.",
  not_now: "Hidden for today.",
  dont_suggest: "This tip won’t come back.",
};

const EVIDENCE_KIND: Readonly<Record<string, string>> = {
  meta_analysis: "Meta-analysis",
  systematic_review: "Systematic review",
  randomized_trial: "Randomized trial",
  cohort_study: "Cohort study",
  observational_study: "Observational study",
  experiment: "Experiment",
  theory_review: "Theory review",
  guidance: "Published guidance",
  editorial_guidance: "Editorial guidance",
};

const STRENGTH: Readonly<Record<string, string>> = {
  strong: "Strong evidence",
  moderate: "Moderate evidence",
  limited: "Limited evidence",
  product_rule: "Cadence rule",
};

const AUDIENCE: Readonly<Record<string, string>> = {
  any_account: "Anyone tracking a routine.",
  first_two_weeks: "People in their first two weeks with Cadence.",
  history_needed: "People with a few weeks of history.",
};

export function evidenceKindLabel(kind: string): string {
  return EVIDENCE_KIND[kind] ?? "Source";
}

export function evidenceStrengthLabel(strength: string): string {
  return STRENGTH[strength] ?? "Evidence";
}

export function audienceLabel(audience: string): string {
  return AUDIENCE[audience] ?? "";
}

/** One short line for a schedule question on the line under the date; the full choice is in the panel. */
export function proposalShortLine(view: Extract<ScheduleProposalView, { kind: "proposal" }>): string {
  // A question that came from a tip already is one short line: "Set Gym to 6:30 PM every day?"
  if (view.tip?.question) return view.tip.question;
  // "Change your schedule: Gym at 6:30 PM every Tuesday from Tuesday, Nov 24 (now 7:00 AM)."
  // becomes "Try Gym at 6:30 PM every Tuesday?"
  const match = /^Change your schedule:\s*(.+?)\s+from\s+[^()]+\(now [^)]*\)\.?$/i.exec(view.line);
  return match ? `Try ${match[1]}?` : view.line;
}

const PROPOSAL_ERRORS: Readonly<Partial<Record<ScheduleProposalErrorCode | "offline", string>>> = {
  proposal_closed: "This question was already answered.",
  proposal_not_found: "This question is no longer open.",
  held_today: "It would move one of today’s items, so it waits until tomorrow.",
  schedule_changed: "The schedule changed since this was suggested.",
  revision_changed: "The schedule changed since this was suggested.",
  offline: "You appear to be offline.",
};

/** Errors are one red line: "Not changed." (the alert's label) followed by this sentence. */
export function advisorErrorText(code: string | undefined): string {
  return PROPOSAL_ERRORS[code as ScheduleProposalErrorCode | "offline"] ?? "Cadence couldn’t reach the advisor. Try again.";
}

/** Whether the person opened today's brief from the advisor, per account and day (this device). */
const BRIEF_SEEN_KEY = "cadence.advisor.brief-seen.v1";

export function readBriefSeen(storage: Pick<Storage, "getItem"> | null, key: string): boolean {
  try { return storage?.getItem(BRIEF_SEEN_KEY) === key; } catch { return false; }
}

export function writeBriefSeen(storage: Pick<Storage, "setItem"> | null, key: string) {
  try { storage?.setItem(BRIEF_SEEN_KEY, key); } catch { /* storage unavailable: lasts for this page only */ }
}

// ---------------------------------------------------------------- tip links (one-tap changes)

/** The editor field a tip's link opens on the Behaviors page. */
export type BehaviorEditField = "time" | "length" | "where" | "description";
export const BEHAVIOR_EDIT_FIELDS: readonly BehaviorEditField[] = ["time", "length", "where", "description"];

/** Open this Behavior's Details and Settings, with the field focused when one is named. */
export type BehaviorEditTarget = Readonly<{ behaviorId: string; field: BehaviorEditField | null }>;

export type AdvisorLinkAction =
  | Readonly<{ kind: "behavior"; target: BehaviorEditTarget }>
  | Readonly<{ kind: "behaviors" }>
  | Readonly<{ kind: "needs_decision" }>;

/** Needs decision opens on this window event (the Timeline's dialog listens for it). */
export const OPEN_NEEDS_DECISION_EVENT = "cadence:open-needs-decision";

export function advisorLinkAction(link: AdvisorTipLink): AdvisorLinkAction {
  if (link.target === "unmarked") return { kind: "needs_decision" };
  if (link.target === "behaviors" || !link.behaviorId) return { kind: "behaviors" };
  const field = link.target === "behavior" ? null : link.target;
  return { kind: "behavior", target: { behaviorId: link.behaviorId, field } };
}

/** The web address for a link to the Behaviors page: "/behaviors?edit=<id>&field=length". */
export function behaviorEditHref(target: BehaviorEditTarget | null): string {
  if (!target) return "/behaviors";
  const query = new URLSearchParams({ edit: target.behaviorId });
  if (target.field) query.set("field", target.field);
  return `/behaviors?${query.toString()}`;
}

const EDIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads `?edit=<id>&field=<field>`; anything else is no target. */
export function parseBehaviorEditTarget(edit: string | undefined, field: string | undefined): BehaviorEditTarget | null {
  if (!edit || !EDIT_ID.test(edit)) return null;
  return { behaviorId: edit, field: BEHAVIOR_EDIT_FIELDS.includes(field as BehaviorEditField) ? field as BehaviorEditField : null };
}

/** The web's way to follow a link: Needs decision opens in place, the rest go to Behaviors. */
export function followAdvisorLinkOnWeb(link: AdvisorTipLink) {
  const action = advisorLinkAction(link);
  if (action.kind === "needs_decision") {
    window.dispatchEvent(new CustomEvent(OPEN_NEEDS_DECISION_EVENT));
    return;
  }
  window.location.assign(behaviorEditHref(action.kind === "behavior" ? action.target : null));
}
