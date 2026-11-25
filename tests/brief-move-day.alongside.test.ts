import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Occurrence } from "@/lib/types/database";

// Ticket 356 (D33): the day as the free-slot rule reads it takes each item's alongside
// value from resolveAlongside. With CADENCE_ALONGSIDE off nothing reads
// behaviors.alongside and every stale Behavior is asked about alongside, as before.

const mocks = vi.hoisted(() => ({ occurrences: [] as Occurrence[] }));
vi.mock("@/lib/db/occurrences.repo", () => ({ listOccurrencesBetweenLocalDates: async () => mocks.occurrences }));

import { alongsideEnabled } from "@/lib/services/alongside-flag";
import { behaviorEstimateInputHash, readBriefMoveDay } from "@/lib/services/brief-move-day.service";
import { cacheBehaviorEstimates, ensureBehaviorEstimates } from "@/lib/services/brief-moves.service";

const ON = { CADENCE_ALONGSIDE: "on" };
const OFF = {};
const DAY = "2026-11-25";

type BehaviorRow = Readonly<{ id: string; title: string; alongside: boolean | null }>;
type EstimateRow = Readonly<{ behavior_id: string; input_hash: string; duration_minutes: number | null; alongside: boolean }>;

function behaviorRow(row: BehaviorRow) {
  return {
    id: row.id, title: row.title, description: null, timezone: "America/New_York", default_duration_minutes: 10,
    where_kind: null, updated_at: "2026-11-01T00:00:00.000Z", parent_behavior_id: null, inherit_parent_schedule: false,
    sub_behavior_sort_order: 0, alongside: row.alongside,
  };
}

function occurrence(behaviorId: string): Occurrence {
  return {
    id: `o-${behaviorId}`, behavior_id: behaviorId, status: "unresolved", local_date: DAY, schedule_kind: "exact",
    schedule_end_time: null, scheduled_for: "2026-11-25T14:00:00.000Z", updated_at: "2026-11-25T00:00:00.000Z",
  } as unknown as Occurrence;
}

/** A read-only fake: each `from(table)` resolves to that table's rows; `rpc` records its arguments. */
function fakeClient(tables: Readonly<{ behaviors: BehaviorRow[]; estimates: EstimateRow[] }>) {
  const selects: Record<string, string[]> = {};
  const rpcs: Array<Readonly<{ name: string; args: unknown }>> = [];
  const rows = (table: string): unknown[] => {
    if (table === "behaviors") return tables.behaviors.map(behaviorRow);
    if (table === "behavior_advisor_estimates") return tables.estimates;
    return [];
  };
  const client = {
    from(table: string) {
      const result = { data: rows(table), error: null };
      const chain = {
        select(columns: string) { (selects[table] ??= []).push(columns); return chain; },
        eq: () => chain, in: () => chain, not: () => chain, order: () => chain, limit: () => chain,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
    async rpc(name: string, args: unknown) { rpcs.push({ name, args }); return { data: null, error: null }; },
  };
  return { client: client as unknown as AppSupabaseClient, selects, rpcs };
}

const facts = (title: string) => ({ title, description: null, whereKind: null });

beforeEach(() => {
  mocks.occurrences = [occurrence("pill"), occurrence("reading")];
});

describe("alongsideEnabled", () => {
  it("is on only for the exact value on", () => {
    expect(alongsideEnabled(ON)).toBe(true);
    for (const env of [{}, { CADENCE_ALONGSIDE: "true" }, { CADENCE_ALONGSIDE: "ON" }, { CADENCE_ALONGSIDE: "" }]) {
      expect(alongsideEnabled(env)).toBe(false);
    }
  });
});

describe("readBriefMoveDay alongside", () => {
  const estimates: EstimateRow[] = [
    { behavior_id: "pill", input_hash: behaviorEstimateInputHash(facts("Pill")), duration_minutes: 2, alongside: true },
    { behavior_id: "reading", input_hash: behaviorEstimateInputHash(facts("Reading")), duration_minutes: 30, alongside: false },
  ];

  it("flag off: reads only the cached guess and never selects behaviors.alongside", async () => {
    const fake = fakeClient({ behaviors: [{ id: "pill", title: "Pill", alongside: false }, { id: "reading", title: "Reading", alongside: true }], estimates });
    const day = await readBriefMoveDay(fake.client, "user", DAY, { env: OFF });
    expect(fake.selects.behaviors!.every((columns) => !columns.includes("alongside"))).toBe(true);
    expect(day.items.map((item) => [item.behaviorId, item.alongside, item.alongsideSource])).toEqual([
      ["pill", true, "guess"], ["reading", false, "guess"],
    ]);
    expect(day.behaviors.get("pill")).not.toHaveProperty("alongside");
    expect(day.staleEstimateBehaviorIds.size).toBe(0);
  });

  it("flag on: the person's answer outranks the guess", async () => {
    const fake = fakeClient({ behaviors: [{ id: "pill", title: "Pill", alongside: false }, { id: "reading", title: "Reading", alongside: true }], estimates });
    const day = await readBriefMoveDay(fake.client, "user", DAY, { env: ON });
    expect(fake.selects.behaviors!.some((columns) => columns.includes("alongside"))).toBe(true);
    expect(day.items.map((item) => [item.behaviorId, item.alongside, item.alongsideSource])).toEqual([
      ["pill", false, "person"], ["reading", true, "person"],
    ]);
  });

  it("flag on: an unanswered Behavior keeps the guess, and one without an estimate is false", async () => {
    const fake = fakeClient({ behaviors: [{ id: "pill", title: "Pill", alongside: null }, { id: "reading", title: "Reading", alongside: null }], estimates: [estimates[0]!] });
    const day = await readBriefMoveDay(fake.client, "user", DAY, { env: ON });
    expect(day.items.map((item) => [item.behaviorId, item.alongside, item.alongsideSource])).toEqual([
      ["pill", true, "guess"], ["reading", false, "default"],
    ]);
    expect([...day.staleEstimateBehaviorIds]).toEqual(["reading"]);
  });

  it("flag on: a length-only estimate is current while answered and stale once the answer is cleared", async () => {
    const lengthOnly: EstimateRow = { behavior_id: "pill", input_hash: behaviorEstimateInputHash(facts("Pill"), { alongsideAsked: false }), duration_minutes: 2, alongside: false };
    const answered = await readBriefMoveDay(fakeClient({ behaviors: [{ id: "pill", title: "Pill", alongside: true }], estimates: [lengthOnly] }).client, "user", DAY, { env: ON });
    expect(answered.staleEstimateBehaviorIds.has("pill")).toBe(false);
    expect(answered.items[0]).toMatchObject({ alongside: true, alongsideSource: "person" });
    const cleared = await readBriefMoveDay(fakeClient({ behaviors: [{ id: "pill", title: "Pill", alongside: null }], estimates: [lengthOnly] }).client, "user", DAY, { env: ON });
    expect(cleared.staleEstimateBehaviorIds.has("pill")).toBe(true);
    expect(cleared.items[0]).toMatchObject({ alongside: false, alongsideSource: "default" });
    const off = await readBriefMoveDay(fakeClient({ behaviors: [{ id: "pill", title: "Pill", alongside: true }], estimates: [lengthOnly] }).client, "user", DAY, { env: OFF });
    expect(off.staleEstimateBehaviorIds.has("pill")).toBe(true);
  });
});

describe("cacheBehaviorEstimates alongside", () => {
  type Ask = Readonly<{ ids: string[]; alongside: boolean }>;
  const run = async (env: Record<string, string>) => {
    const fake = fakeClient({ behaviors: [{ id: "pill", title: "Pill", alongside: null }, { id: "reading", title: "Reading", alongside: false }], estimates: [] });
    const day = await readBriefMoveDay(fake.client, "user", DAY, { env });
    const asks: Ask[] = [];
    await cacheBehaviorEstimates({
      agent: fake.client, userId: "user", localDate: DAY, day, model: "test", env,
      estimate: async (behaviors, ask) => {
        asks.push({ ids: behaviors.map((behavior) => behavior.id), alongside: ask?.alongside ?? true });
        return behaviors.map((behavior) => ({ behaviorId: behavior.id, minutes: 7, alongside: true }));
      },
    });
    const stored = (fake.rpcs[0]?.args as { p_estimates: Array<{ behavior_id: string; input_hash: string; alongside: boolean }> }).p_estimates;
    return { asks, stored };
  };

  it("flag off: asks about alongside for every stale Behavior in one call", async () => {
    const { asks, stored } = await run(OFF);
    expect(asks).toEqual([{ ids: ["pill", "reading"], alongside: true }]);
    expect(stored.map((row) => [row.behavior_id, row.alongside])).toEqual([["pill", true], ["reading", true]]);
    expect(stored.find((row) => row.behavior_id === "reading")!.input_hash).toBe(behaviorEstimateInputHash(facts("Reading")));
  });

  it("flag on: asks only unanswered Behaviors about alongside and the rest for length only", async () => {
    const { asks, stored } = await run(ON);
    expect(asks).toEqual([{ ids: ["pill"], alongside: true }, { ids: ["reading"], alongside: false }]);
    const reading = stored.find((row) => row.behavior_id === "reading")!;
    expect(reading).toMatchObject({ alongside: false, input_hash: behaviorEstimateInputHash(facts("Reading"), { alongsideAsked: false }) });
    expect(stored.find((row) => row.behavior_id === "pill")).toMatchObject({ alongside: true, input_hash: behaviorEstimateInputHash(facts("Pill")) });
  });
});

describe("ensureBehaviorEstimates alongside", () => {
  it("flag on: the length-only call has no alongside schema or instruction", async () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    try {
      const fake = fakeClient({ behaviors: [{ id: "pill", title: "Pill", alongside: null }, { id: "reading", title: "Reading", alongside: false }], estimates: [] });
      const calls: Array<Readonly<{ instructions: string; facts: string; estimateVariant?: string }>> = [];
      await ensureBehaviorEstimates(fake.client, { localDate: DAY }, async (input) => {
        calls.push(input);
        const items = (JSON.parse(input.facts) as { items: Array<{ behaviorRef: string }> }).items;
        return { estimates: items.map((item) => ({ behaviorRef: item.behaviorRef, minutes: 7, basis: "inferred",
          ...(input.estimateVariant === "alongside" ? { alongside: true } : {}) })) };
      }, undefined, { userId: "user" });
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({ estimateVariant: "alongside" });
      expect(calls[0]!.instructions).toContain("alongside");
      expect(calls[1]).not.toHaveProperty("estimateVariant");
      expect(calls[1]!.instructions).not.toContain("alongside");
      expect(JSON.parse(calls[1]!.facts)).toEqual({ items: [{ behaviorRef: "b1", title: "Reading", description: "" }] });
      const stored = (fake.rpcs[0]!.args as { p_estimates: Array<{ behavior_id: string; duration_minutes: number | null }> }).p_estimates;
      expect(stored.map((row) => [row.behavior_id, row.duration_minutes])).toEqual([["pill", 7], ["reading", 7]]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("flag off: one alongside call for every stale Behavior", async () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "");
    try {
      const fake = fakeClient({ behaviors: [{ id: "pill", title: "Pill", alongside: null }, { id: "reading", title: "Reading", alongside: false }], estimates: [] });
      const variants: Array<string | undefined> = [];
      await ensureBehaviorEstimates(fake.client, { localDate: DAY }, async (input) => {
        variants.push(input.estimateVariant);
        return { estimates: [] };
      }, undefined, { userId: "user" });
      expect(variants).toEqual(["alongside"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
