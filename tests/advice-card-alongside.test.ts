import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { matchAdviceCards } from "@cadence/core/resolvers/advice-matcher.resolver";
import { ADVICE_CARDS, ADVICE_SOURCES, fillQuipSeed, parseAdviceLibrary, quipSeedsFor } from "@cadence/core/services/advice-library";
import document from "@/packages/core/src/data/advice-library.json";
import type { AdviceAccountFacts, AdviceCard, AdviceSignalInput } from "@cadence/core/types/advice-cards";
import { advisorTipLink } from "@cadence/core/types/advisor-tips";
import type { TipHistory, TipToWrite } from "@/lib/db/advisor-tips.repo";
import { chooseTipMatches, visitAdvisorTips, withOffers, type TipSetup, type TipVisitPort } from "@/lib/services/advisor-tips-job.service";
import { advisorLinkAction, behaviorEditHref, parseBehaviorEditTarget } from "@/lib/ui/advisor";

// Ticket 385 (D37): the alongside advice card ships as a draft. It shows no tip until the
// owner reviews it, and its link target needs migration 20261126240000 on the database
// first, so no code path may write link_target 'alongside' while the card is a draft.

const CARD_ID = "do-it-during-something-else";
const TODAY = "2026-11-25";
const shipped = ADVICE_CARDS.find((card) => card.id === CARD_ID)!;
const reviewed: AdviceCard = { ...shipped, status: "active", reviewer: "Test reviewer", reviewed_at: "2026-11-25" };

const ACCOUNT: AdviceAccountFacts = {
  account_age_days: 60, active_behaviors: 2, behaviors_with_window: 0, behaviors_with_set_time: 2,
  behaviors_without_length: 0, behaviors_without_place: 0, morning_items: 2, afternoon_items: 0, evening_items: 0,
  max_items_same_hour: 1, behaviors_created_last_14_days: 0,
};

// The rows coach-signals version 4 writes (coach-signals-v2.resolver.ts, setupGaps).
const OPEN: AdviceSignalInput = { id: "11", kind: "setup_gaps", behaviorId: "b-stretch", facts: { missing_length: false, missing_place: false, alongside_unanswered: true } };
const ANSWERED: AdviceSignalInput = { id: "12", kind: "setup_gaps", behaviorId: "b-gym", facts: { missing_length: true, missing_place: false, alongside_unanswered: false } };
const VERSION_3: AdviceSignalInput = { id: "13", kind: "setup_gaps", behaviorId: "b-read", facts: { missing_length: true, missing_place: true } };
const ACCOUNT_ROW: AdviceSignalInput = { id: "14", kind: "setup_gaps", behaviorId: null, facts: { active_behaviors: 3, without_length: 0, without_place: 0, without_alongside_answer: 1 } };

const SETUP: TipSetup = {
  behaviors: [
    { id: "b-gym", createdAt: "2026-08-01T10:00:00Z", timezone: "UTC", active: true, hasLength: true, hasPlace: true, alongsideQuestionOpen: false },
    { id: "b-stretch", createdAt: "2026-08-01T10:00:00Z", timezone: "UTC", active: true, hasLength: true, hasPlace: true, alongsideQuestionOpen: true },
  ],
  occurrences: [],
  titles: new Map([["b-gym", "Gym"], ["b-stretch", "Stretch"]]),
};
const NO_HISTORY: TipHistory = { tips: [], suppressedCardIds: [] };
const SETTING = { model: "openai/gpt-5.6-luna", reasoning: "low", maxOutputTokens: 1000, timeoutMs: 20_000 } as const;

/** A tip run with no model budget, so the cards' own lines are written. */
function tipPort(): { port: TipVisitPort; written: TipToWrite[] } {
  const written: TipToWrite[] = [];
  const port: TipVisitPort = {
    startRun: async () => ({ runId: "run-1", localDate: TODAY }),
    settings: async () => ({ tipsOn: true, notesAllowed: false, reminderHistoryAllowed: true }),
    signals: async () => [OPEN, ACCOUNT_ROW],
    setup: async () => SETUP,
    history: async () => NO_HISTORY,
    notes: async () => [],
    reserve: async () => ({ allowed: false }),
    settle: async () => undefined,
    generate: async () => ({ tips: [] }),
    async write(_runId, tips) { written.push(...tips); return tips.length; },
    storeContent: async () => undefined,
    finishRun: async () => undefined,
  };
  return { port, written };
}

describe("the alongside advice card as shipped", () => {
  it("is a valid draft with no review recorded", () => {
    expect(parseAdviceLibrary(document).cards.find((card) => card.id === CARD_ID)).toEqual(shipped);
    expect(shipped).toMatchObject({ status: "draft", reviewer: null, reviewed_at: null, revision: 1, audience: "any_account" });
    expect(shipped.offer).toEqual({ kind: "open", target: "alongside" });
    expect(shipped.applies_when).toEqual([{ signal: "setup_gaps", scope: "behavior", facts: [{ fact: "alongside_unanswered", op: "eq", value: true }] }]);
  });

  it("rests on Milkman, Minson and Volpp (2014) with the ticket's quote, word for word", () => {
    const source = ADVICE_SOURCES.find((entry) => entry.id === shipped.evidence.source_id)!;
    expect(source).toMatchObject({ doi: "10.1287/mnsc.2013.1784", url: "https://doi.org/10.1287/mnsc.2013.1784", year: 2014, kind: "randomized_trial" });
    expect(shipped.evidence).toMatchObject({ kind: "randomized_trial", strength: "limited", locator: "Abstract" });
    const ticket = fs.readFileSync(path.resolve(__dirname, "../docs/TICKETS.md"), "utf8");
    const section = ticket.slice(ticket.indexOf("## Ticket 385:"), ticket.indexOf("## Ticket 386:"));
    expect(section).toContain(`verbatim: "${shipped.evidence.quote}"`);
  });

  it("cannot be marked active without a reviewer and a review date", () => {
    const raw = structuredClone(document) as { cards: Record<string, unknown>[] };
    const card = raw.cards.find((entry) => entry.id === CARD_ID)!;
    card.status = "active";
    expect(() => parseAdviceLibrary(raw)).toThrow(`card ${CARD_ID} is active without a review`);
  });

  it("never matches while it is a draft", () => {
    const matches = matchAdviceCards({ cards: ADVICE_CARDS, signals: [OPEN, ACCOUNT_ROW], account: ACCOUNT, today: TODAY });
    expect(matches.map((match) => match.card.id)).not.toContain(CARD_ID);
  });

  it("produces no tip row, so nothing writes link_target 'alongside' before migration 20261126240000", async () => {
    // The shipped library and the default statuses, as the scheduled run uses them.
    const draftRun = tipPort();
    await visitAdvisorTips(draftRun.port, { setting: SETTING, maxPerDay: 3 });
    expect(draftRun.written.map((tip) => tip.cardId)).not.toContain(CARD_ID);
    expect(draftRun.written.map((tip) => tip.linkTarget)).not.toContain("alongside");
    // The same run with the card reviewed writes that tip, so the check above is not vacuous.
    const reviewedRun = tipPort();
    await visitAdvisorTips(reviewedRun.port, { setting: SETTING, maxPerDay: 3, cards: ADVICE_CARDS.map((card) => card.id === CARD_ID ? reviewed : card) });
    expect(reviewedRun.written.find((tip) => tip.cardId === CARD_ID)).toMatchObject({ behaviorId: "b-stretch", linkTarget: "alongside", linkBehaviorId: "b-stretch" });
  });
});

describe("the alongside advice card once reviewed (a copy marked active)", () => {
  it("matches only a Behavior whose alongside question is open", () => {
    const matches = matchAdviceCards({ cards: [reviewed], signals: [OPEN, ANSWERED, VERSION_3, ACCOUNT_ROW], account: ACCOUNT, today: TODAY });
    expect(matches.map((match) => [match.card.id, match.behaviorId])).toEqual([[CARD_ID, "b-stretch"]]);
    expect(matches[0]!.factIds).toEqual(["setup_gaps:b-stretch:alongside_unanswered"]);
    expect(matchAdviceCards({ cards: [reviewed], signals: [ANSWERED, VERSION_3, ACCOUNT_ROW], account: ACCOUNT, today: TODAY })).toEqual([]);
  });

  it("fills its lines with the Behavior's title", () => {
    for (const seed of quipSeedsFor(reviewed, "b-stretch")) {
      expect(fillQuipSeed(seed, { behavior: "Stretch", facts: OPEN.facts })).toMatch(/^.*Stretch.*\.$/);
    }
  });

  it("links to the Behavior's alongside control", async () => {
    const { chosen } = chooseTipMatches({ localDate: TODAY, signals: [OPEN], setup: SETUP, history: NO_HISTORY, cards: [reviewed], statuses: ["active"], maxPerDay: 3 });
    const tip: TipToWrite = { text: "A line.", cardId: CARD_ID, cardRevision: 1, behaviorId: "b-stretch", factIds: [], factValues: {}, source: "seed" };
    const [withLink] = await withOffers({}, { runId: "r", localDate: TODAY, tips: [tip], matches: chosen, setup: SETUP, cards: [reviewed] });
    expect(withLink).toMatchObject({ proposalId: null, linkTarget: "alongside", linkBehaviorId: "b-stretch" });
    // An account-wide tip with this target picks the Behavior whose question is open.
    const [accountWide] = await withOffers({}, { runId: "r", localDate: TODAY, tips: [{ ...tip, behaviorId: null }], matches: [], setup: SETUP, cards: [reviewed] });
    expect(accountWide).toMatchObject({ linkTarget: "alongside", linkBehaviorId: "b-stretch" });

    const link = advisorTipLink("alongside", "0e385000-0000-4000-8000-000000000010");
    const action = advisorLinkAction(link);
    expect(action).toEqual({ kind: "behavior", target: { behaviorId: "0e385000-0000-4000-8000-000000000010", field: "alongside" } });
    const href = behaviorEditHref(action.kind === "behavior" ? action.target : null);
    expect(href).toBe("/behaviors?edit=0e385000-0000-4000-8000-000000000010&field=alongside");
    expect(parseBehaviorEditTarget("0e385000-0000-4000-8000-000000000010", "alongside")).toEqual({ behaviorId: "0e385000-0000-4000-8000-000000000010", field: "alongside" });
  });
});
