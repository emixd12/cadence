import { ADVICE_CARDS, adviceSourceFor } from "@cadence/core/services/advice-library";
import type { AdvisorTip, AdvisorTipReaction, AdvisorTipResearch } from "@cadence/core/types/advisor-tips";
import type { ScheduleProposalAnswerResult, ScheduleProposalView } from "@cadence/core/types/behavior-change-proposals";

import type { AdvisorClient } from "@/lib/ui/advisor";
import { DailyBriefRequestError } from "@/lib/ui/daily-brief";

// Advisor plan Phase 4 (4E): synthetic advisor data for the bench and the UI tests. Nothing is saved.

function research(cardId: string): AdvisorTipResearch {
  const card = ADVICE_CARDS.find((entry) => entry.id === cardId);
  if (!card) throw new Error(`Unknown advice card ${cardId}`);
  const source = adviceSourceFor(card);
  return {
    cardId: card.id, cardRevision: card.revision, advice: card.advice, action: card.action, claim: card.evidence.claim,
    source: { citation: source?.citation ?? "", url: source?.url ?? "", kind: card.evidence.kind },
    strength: card.evidence.strength, audience: card.audience, limitation: card.limitation,
  };
}

export const ADVISOR_FIXTURE_TIP: AdvisorTip = {
  id: "11111111-1111-4111-8111-111111111111",
  localDate: "2026-11-19",
  text: "Morning journal was done 11 days running, then missed Tuesday and Wednesday. A missed day doesn’t undo a routine; keep tomorrow’s 8:00 AM.",
  behaviorId: "behavior-journal",
  shownAt: "2026-11-19T14:00:00Z",
  reaction: null,
  research: research("one-miss-is-fine"),
};

export const ADVISOR_FIXTURE_EARLIER: readonly AdvisorTip[] = [
  {
    id: "22222222-2222-4222-8222-222222222222", localDate: "2026-11-17", behaviorId: "behavior-gym", shownAt: "2026-11-17T14:00:00Z",
    text: "Gym moved to 6:30 PM three Tuesdays running. One steady time makes it easier to keep.", reaction: "helpful",
    research: research("plan-when-and-where-after-a-drop"),
  },
  {
    id: "33333333-3333-4333-8333-333333333333", localDate: "2026-11-16", behaviorId: "behavior-read", shownAt: "2026-11-16T14:00:00Z",
    text: "Read was done on 5 of the last 7 nights it came before 10:00 PM.", reaction: null,
    research: research("weeks-not-days"),
  },
];

export const ADVISOR_FIXTURE_PROPOSAL: Extract<ScheduleProposalView, { kind: "proposal" }> = {
  kind: "proposal",
  proposalId: "44444444-4444-4444-8444-444444444444",
  behaviorId: "behavior-gym",
  line: "Change your schedule: Gym at 6:30 PM every Tuesday from Tuesday, Nov 24 (now 7:00 AM).",
  reason: "You moved it to about 6:30 PM on 4 of the last 5 Tuesdays.",
  before: ["Every Tuesday and Thursday at 7:00 AM"],
  after: ["Every Tuesday at 6:30 PM", "Every Thursday at 7:00 AM"],
  firstAffectedDate: "2026-11-24",
  answers: ["try", "for_good", "no"],
};

export const ADVISOR_FIXTURE_CHECK_IN: Extract<ScheduleProposalView, { kind: "check_in" }> = {
  kind: "check_in",
  proposalId: "44444444-4444-4444-8444-444444444444",
  behaviorId: "behavior-gym",
  question: "Keep Gym at 6:30 PM every Tuesday?",
  answers: ["keep", "go_back"],
};

export const ADVISOR_FIXTURE_TRIAL: Extract<ScheduleProposalView, { kind: "trial" }> = {
  kind: "trial",
  proposalId: "55555555-5555-4555-8555-555555555555",
  behaviorId: "behavior-read",
  line: "Read at 9:00 PM every day",
  checkInDate: "2026-12-01",
};

const ANSWER_MESSAGES: Readonly<Record<string, string>> = {
  try: "Gym is at 6:30 PM every Tuesday for two weeks.",
  for_good: "Gym is at 6:30 PM every Tuesday from now on.",
  no: "Gym stays at 7:00 AM.",
  keep: "Gym stays at 6:30 PM every Tuesday.",
  go_back: "Gym is back at 7:00 AM every Tuesday.",
};

export type AdvisorFixtureOptions = Readonly<{
  tip?: AdvisorTip | null;
  proposal?: ScheduleProposalView | null;
  recent?: readonly AdvisorTip[];
  /** Answers and reactions fail with this error code (the red "Not changed." line). */
  refuseWith?: string;
}>;

/** A client that answers at once from the fixtures above. */
export function fixtureAdvisorClient(options: AdvisorFixtureOptions = {}): AdvisorClient {
  let tip = options.tip === undefined ? ADVISOR_FIXTURE_TIP : options.tip;
  return {
    nextTip: async () => tip ? { state: "tip", tip, fresh: true, nextAt: null } : { state: "none", reason: "no_tips_today", nextAt: null },
    react: async (tipId: string, reaction: AdvisorTipReaction) => {
      if (options.refuseWith) throw new DailyBriefRequestError(options.refuseWith);
      if (!tip || tip.id !== tipId) throw new DailyBriefRequestError("tip_not_found");
      tip = { ...tip, reaction };
      return tip;
    },
    recentTips: async () => options.recent ?? ADVISOR_FIXTURE_EARLIER,
    scheduleProposal: async () => options.proposal ?? { kind: "none" },
    answerProposal: async (_proposalId, answer): Promise<ScheduleProposalAnswerResult> => {
      if (options.refuseWith) throw new DailyBriefRequestError(options.refuseWith);
      return { applied: answer !== "no" && answer !== "keep", replayed: false, view: { kind: "none" }, message: ANSWER_MESSAGES[answer] ?? "Saved." };
    },
  };
}
