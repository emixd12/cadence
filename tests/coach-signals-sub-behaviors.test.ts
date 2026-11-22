import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  COACH_SIGNAL_KINDS,
  resolveCoachSignals,
  type CoachSignalBehavior,
  type CoachSignalKind,
  type CoachSignalOccurrence,
  type ResolveCoachSignalsInput,
} from "@cadence/core/resolvers/coach-signals.resolver";
import { matchAdviceCards } from "@cadence/core/resolvers/advice-matcher.resolver";
import { ADVICE_CARDS } from "@cadence/core/services/advice-library";
import { advisorTipLink } from "@cadence/core/types/advisor-tips";
import { checkTipText, seedTipText, tipItems } from "@/lib/services/advisor-tips-writer";
import { tipTitles, withOffers } from "@/lib/services/advisor-tips-job.service";
import { advisorLinkAction, behaviorEditHref } from "@/lib/ui/advisor";
import { searchAdviceCards } from "@/lib/services/chat/chat-advice";

// Coach signals version 3 and Advisor Tips for routines (sub-behaviors). Every expected
// number is counted by hand from the fixture. Today is Thursday 2026-11-19; the 28-day
// window is Oct 22 .. Nov 18.

const TODAY = "2026-11-19";
const ZONE = "America/New_York";
const OLD = "2026-08-01T12:00:00Z";
const SKIN = "10000000-0000-4000-8000-000000000001";
const RETINOL = "10000000-0000-4000-8000-000000000004";
const behavior = (id: string, extra: Partial<CoachSignalBehavior> = {}): CoachSignalBehavior =>
  ({ id, createdAt: OLD, timezone: ZONE, active: true, ...extra });
const stepOf = (id: string) => behavior(id, { parentBehaviorId: SKIN, inheritParentSchedule: true });
const PARENT = behavior(SKIN);
const CERAVE = stepOf("b-cerave");
const FACEWASH = stepOf("b-facewash");
const RETINOL_STEP = stepOf(RETINOL);

const c = "completed" as const;
const n = "not_completed" as const;
const u = "unresolved" as const;
type Status = CoachSignalOccurrence["status"];

let serial = 0;
function run(behaviorId: string, from: number, statuses: readonly Status[], startTime = "07:00:00"): CoachSignalOccurrence[] {
  return statuses.map((status, index) => {
    serial += 1;
    return { id: `o${serial}`, behaviorId, localDate: Temporal.PlainDate.from(TODAY).add({ days: from + index }).toString(), status, scheduleKind: "exact", startTime };
  });
}
const repeat = <T,>(value: T, times: number): T[] => Array(times).fill(value);

function input(overrides: Partial<ResolveCoachSignalsInput>): ResolveCoachSignalsInput {
  return { today: TODAY, behaviors: [PARENT, CERAVE, FACEWASH, RETINOL_STEP], occurrences: [], decisions: [], moves: [], answers: [], ...overrides };
}
const only = (kind: CoachSignalKind, value: ResolveCoachSignalsInput) => resolveCoachSignals(value).filter((signal) => signal.kind === kind);

/** 10 mornings: Cerave and Facewash done 9 of 10, Retinol 3 of 10 marked plus 4 left unmarked. */
function routineRows() {
  return [
    ...run(CERAVE.id, -10, [...repeat(c, 9), n]),
    ...run(FACEWASH.id, -10, [...repeat(c, 9), n]),
    ...run(RETINOL, -10, [c, c, c, n, n, n, n, n, n, n]),
    ...run(RETINOL, -14, [u, u, u, u]),
  ];
}

describe("sub_behavior_dropoff", () => {
  it("finds one step done much less than the rest of its routine, on its own days", () => {
    expect(COACH_SIGNAL_KINDS).toContain("sub_behavior_dropoff");
    // Retinol: 3 of 10 = 0.3. Others on Retinol's 10 marked days: 18 of 20 = 0.9. Gap 0.6.
    expect(only("sub_behavior_dropoff", input({ occurrences: routineRows() }))).toEqual([{
      kind: "sub_behavior_dropoff",
      behaviorId: RETINOL,
      facts: {
        window_days: 28, parent_behavior_id: SKIN, step_rate: 0.3, step_completed: 3, step_resolved: 10,
        sibling_rate: 0.9, sibling_resolved: 20, other_steps: 2, gap: 0.6,
      },
    }]);
  });

  it("never counts an unmarked step as a miss", () => {
    // Retinol has 3 done and 1 not done; 10 more left unmarked. 3 of 4 = 0.75 is not a drop-off,
    // and 4 marks are below the 6-mark floor anyway.
    const rows = [
      ...run(CERAVE.id, -14, repeat(c, 14)),
      ...run(FACEWASH.id, -14, repeat(c, 14)),
      ...run(RETINOL, -14, [c, c, c, n, ...repeat(u, 10)]),
    ];
    expect(only("sub_behavior_dropoff", input({ occurrences: rows }))).toEqual([]);
  });

  it("stays quiet when the other steps are not steady either", () => {
    const rows = [
      ...run(CERAVE.id, -10, [...repeat(c, 5), ...repeat(n, 5)]),
      ...run(FACEWASH.id, -10, [...repeat(c, 6), ...repeat(n, 4)]),
      ...run(RETINOL, -10, [c, ...repeat(n, 9)]),
    ];
    expect(only("sub_behavior_dropoff", input({ occurrences: rows }))).toEqual([]);
  });

  it("does not compare Behaviors that are not steps of one routine", () => {
    const loose = [behavior("b-a"), behavior("b-b"), behavior("b-c")];
    const rows = [...run("b-a", -10, repeat(c, 10)), ...run("b-b", -10, repeat(c, 10)), ...run("b-c", -10, repeat(n, 10))];
    expect(only("sub_behavior_dropoff", input({ behaviors: loose, occurrences: rows }))).toEqual([]);
  });
});

describe("routines in crowded_hour and done_together", () => {
  it("counts a routine's steps at one time as one item, so the hour is not crowded", () => {
    // 07:00: three steps every day (one routine), 5 of 12 done. 18:00: Walk, 11 of 12 done.
    // Three separate Behaviors there would be crowded (see coach-signals-v2.resolver.test.ts).
    const walk = behavior("b-walk");
    const rows = [
      ...[CERAVE, FACEWASH, RETINOL_STEP].flatMap((step) => run(step.id, -4, [c, n, c, n], "07:15:00")),
      ...run(walk.id, -12, [...repeat(c, 11), n], "18:00:00"),
    ];
    expect(only("crowded_hour", input({ behaviors: [PARENT, CERAVE, FACEWASH, RETINOL_STEP, walk], occurrences: rows }))).toEqual([]);
  });

  it("does not report a routine's own steps as done together", () => {
    const rows = [CERAVE, FACEWASH].flatMap((step) => run(step.id, -12, [...repeat(c, 9), n, n, n]));
    expect(only("done_together", input({ behaviors: [PARENT, CERAVE, FACEWASH], occurrences: rows }))).toEqual([]);
  });
});

describe("Advisor Tips for a dropped routine step", () => {
  const card = ADVICE_CARDS.find((item) => item.id === "smaller-step-in-the-routine")!;
  const signal = { id: "41", ...only("sub_behavior_dropoff", input({ occurrences: routineRows() }))[0]! };
  const account = {
    account_age_days: 60, active_behaviors: 4, behaviors_with_window: 0, behaviors_with_set_time: 3, behaviors_without_length: 0,
    behaviors_without_place: 0, morning_items: 3, afternoon_items: 0, evening_items: 0, max_items_same_hour: 3, behaviors_created_last_14_days: 0,
  };

  it("is reviewed and active, so Tips and search_advice can reach it", () => {
    expect(card).toMatchObject({ status: "active", reviewer: "Emi", reviewed_at: "2026-11-21", offer: { kind: "open", target: "behavior" } });
    expect(matchAdviceCards({ cards: [card], signals: [signal], account, today: TODAY }).map((m) => m.card.id)).toEqual([card.id]);
    expect(matchAdviceCards({ cards: [{ ...card, status: "draft" }], signals: [signal], account, today: TODAY })).toEqual([]);
    expect(searchAdviceCards("a smaller step in my routine", [card]).cards.map((c) => c.id)).toEqual([card.id]);
  });

  it("names the step with its routine, states counted facts, and links to that step's editor", async () => {
    const [match] = matchAdviceCards({ cards: [card], signals: [signal], account, today: TODAY });
    expect(match).toMatchObject({ behaviorId: RETINOL, card: { id: card.id } });
    const titles = tipTitles([
      { id: SKIN, title: "Skin routine", parent_behavior_id: null },
      { id: RETINOL, title: "Retinol", parent_behavior_id: SKIN },
    ]);
    expect(titles.get(RETINOL)).toBe("Retinol in Skin routine");
    expect(titles.get(SKIN)).toBe("Skin routine");

    const [item] = tipItems([match!], titles);
    const text = seedTipText(match!, item!.behaviorTitle);
    expect(text).toBe("Retinol in Skin routine got done 3 of 10 times; the other steps got done 90% on those days. A smaller version may fit better.");
    expect(checkTipText(text!, match!, item!.behaviorTitle)).toEqual({ ok: true });
    expect(checkTipText("Retinol in Skin routine got done 4 of 10 times.", match!, item!.behaviorTitle)).toEqual({ ok: false, reason: "unknown_number" });

    const [tip] = await withOffers({}, {
      runId: "run-1", localDate: TODAY, matches: [match!], cards: [card],
      setup: { behaviors: [PARENT, RETINOL_STEP], occurrences: [], titles },
      tips: [{ text: text!, cardId: card.id, cardRevision: card.revision, behaviorId: RETINOL, factIds: match!.factIds, factValues: {}, source: "seed" }],
    });
    expect(tip).toMatchObject({ linkTarget: "behavior", linkBehaviorId: RETINOL, proposalId: null });
    const action = advisorLinkAction(advisorTipLink("behavior", RETINOL));
    expect(action).toEqual({ kind: "behavior", target: { behaviorId: RETINOL, field: null } });
    expect(behaviorEditHref(action.kind === "behavior" ? action.target : null)).toBe(`/behaviors?edit=${RETINOL}`);
  });
});
