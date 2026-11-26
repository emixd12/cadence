import { describe, expect, it } from "vitest";
import { behaviorEstimateInputHash, currentEstimate, currentEstimateMinutes } from "@/lib/services/brief-move-day.service";
import { readValidBehaviorAdvisorEstimates } from "@/lib/services/timeline.service";
import { validAdvisorDurationEstimates } from "@/lib/services/travel-route-refresh.service";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

// Audit fix 1: every reader of a cached estimate uses one validity rule, so a recipe-1.3
// row written with CADENCE_ALONGSIDE on is current for the Timeline and travel refresh too.

const ON = { CADENCE_ALONGSIDE: "on" };
const OFF = {};
const behavior = { id: "b1", title: "Read", description: null, where_kind: null, alongside: null, active: true };
const facts = { title: "Read", description: null, whereKind: null, alongside: null };
const answered = { ...behavior, alongside: false };

function fakeSupabase(rows: readonly Record<string, unknown>[]): AppSupabaseClient {
  const query = { select: () => query, eq: () => query, in: () => Promise.resolve({ data: rows, error: null }) };
  return { from: () => query } as unknown as AppSupabaseClient;
}

const recipe13 = behaviorEstimateInputHash(facts, { alongsideAsked: true, whereAsked: true });
const recipe13LengthOnly = behaviorEstimateInputHash(facts, { alongsideAsked: false, whereAsked: true });
const recipe12 = behaviorEstimateInputHash(facts);

describe("cached estimate validity (audit fix 1)", () => {
  it("the Timeline reads a recipe-1.3 length with the flag on", async () => {
    const supabase = fakeSupabase([{ behavior_id: "b1", input_hash: recipe13, duration_minutes: 25 }]);
    await expect(readValidBehaviorAdvisorEstimates(supabase, "u", [behavior], ON)).resolves.toEqual({ b1: 25 });
    await expect(readValidBehaviorAdvisorEstimates(supabase, "u", [behavior], OFF)).resolves.toEqual({});
  });

  it("the Timeline reads a length-only row only while the person's answer is set", async () => {
    const supabase = fakeSupabase([{ behavior_id: "b1", input_hash: recipe13LengthOnly, duration_minutes: 40 }]);
    await expect(readValidBehaviorAdvisorEstimates(supabase, "u", [answered], ON)).resolves.toEqual({ b1: 40 });
    await expect(readValidBehaviorAdvisorEstimates(supabase, "u", [behavior], ON)).resolves.toEqual({});
  });

  it("the flag off keeps recipe 1.2 rows only", async () => {
    const supabase = fakeSupabase([{ behavior_id: "b1", input_hash: recipe12, duration_minutes: 15 }]);
    await expect(readValidBehaviorAdvisorEstimates(supabase, "u", [behavior], OFF)).resolves.toEqual({ b1: 15 });
    await expect(readValidBehaviorAdvisorEstimates(supabase, "u", [behavior], ON)).resolves.toEqual({});
  });

  it("travel refresh reads the same lengths and nothing else", () => {
    const behaviors = [behavior] as unknown as Parameters<typeof validAdvisorDurationEstimates>[0];
    const rows = [{ behavior_id: "b1", input_hash: recipe13, duration_minutes: 25 }];
    expect(validAdvisorDurationEstimates(behaviors, rows, ON)).toEqual({ b1: 25 });
    expect(validAdvisorDurationEstimates(behaviors, rows, OFF)).toEqual({});
  });

  it("agrees with the Daily Brief's currentEstimate for every row kind", () => {
    for (const hash of [recipe12, recipe13, recipe13LengthOnly, "stale"]) {
      for (const personSetting of [false, true]) {
        for (const alongside of [null, true, false]) {
          const row = { input_hash: hash, duration_minutes: 20, alongside: true, where_guess: "home" };
          const b = { ...facts, alongside: personSetting ? alongside : undefined };
          expect(currentEstimateMinutes(row, b, personSetting)).toBe(currentEstimate(row, b, personSetting)?.minutes);
        }
      }
    }
  });
});
