import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Occurrence } from "@/lib/types/database";

// Ticket 356 (D33): the day as the free-slot rule reads it takes each item's alongside
// value from resolveAlongside. With CADENCE_ALONGSIDE off nothing reads
// behaviors.alongside and every stale Behavior is asked about alongside, as before.

const mocks = vi.hoisted(() => ({ occurrences: [] as Occurrence[] }));
vi.mock("@/lib/db/occurrences.repo", () => ({ listOccurrencesBetweenLocalDates: async () => mocks.occurrences }));
vi.mock("@/lib/services/behavior-length.service", async () => ({ readBehaviorLengths: (await import("./helpers/no-tracked-history")).readBehaviorLengthsWithoutHistory }));

import { alongsideEnabled } from "@/lib/services/alongside-flag";
import { behaviorEstimateInputHash, currentEstimateMinutes, readBriefMoveDay } from "@/lib/services/brief-move-day.service";
import { cacheBehaviorEstimates, ensureBehaviorEstimates } from "@/lib/services/brief-moves.service";

const ON = { CADENCE_ALONGSIDE: "on" };
const OFF = {};
const DAY = "2026-11-25";

type BehaviorRow = Readonly<{ id: string; title: string; alongside: boolean | null; where_kind?: string | null; location_text?: string | null }>;
type EstimateRow = Readonly<{ behavior_id: string; input_hash: string; duration_minutes: number | null; alongside: boolean; where_guess?: string | null }>;
type LabelRow = Readonly<{ behavior_id: string; label: string; local_date: string }>;

function behaviorRow(row: BehaviorRow) {
  return {
    id: row.id, title: row.title, description: null, timezone: "America/New_York", default_duration_minutes: 10,
    where_kind: row.where_kind ?? null, location_text: row.location_text ?? null, updated_at: "2026-11-01T00:00:00.000Z",
    parent_behavior_id: null, inherit_parent_schedule: false, sub_behavior_sort_order: 0, alongside: row.alongside,
  };
}

function occurrence(behaviorId: string): Occurrence {
  return {
    id: `o-${behaviorId}`, behavior_id: behaviorId, status: "unresolved", local_date: DAY, schedule_kind: "exact",
    schedule_end_time: null, scheduled_for: "2026-11-25T14:00:00.000Z", updated_at: "2026-11-25T00:00:00.000Z",
  } as unknown as Occurrence;
}

/** A read-only fake: each `from(table)` resolves to that table's rows; `rpc` records its arguments. */
function fakeClient(tables: Readonly<{ behaviors: BehaviorRow[]; estimates: EstimateRow[]; labels?: LabelRow[] }>) {
  const selects: Record<string, string[]> = {};
  const rpcs: Array<Readonly<{ name: string; args: unknown }>> = [];
  const rows = (table: string): unknown[] => {
    if (table === "behaviors") return tables.behaviors.map(behaviorRow);
    if (table === "behavior_advisor_estimates") return tables.estimates;
    if (table === "completion_place_labels") return tables.labels ?? [];
    return [];
  };
  const client = {
    from(table: string) {
      const result = { data: rows(table), error: null };
      const chain = {
        select(columns: string) { (selects[table] ??= []).push(columns); return chain; },
        eq: () => chain, in: () => chain, not: () => chain, order: () => chain, limit: () => chain, gte: () => chain, lte: () => chain,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
    async rpc(name: string, args: unknown) { rpcs.push({ name, args }); return { data: null, error: null }; },
  };
  return { client: client as unknown as AppSupabaseClient, selects, rpcs };
}

/** The hash inputs: title and description only (Ticket 386; Where is not sent to the model). */
const facts = (title: string) => ({ title, description: null });
/** Flag on, estimates come from recipe 1.3 (Ticket 359), whose hash marks the Where guess as asked. */
const WHERE = { whereAsked: true } as const;

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
    const current: EstimateRow = { ...estimates[0]!, input_hash: behaviorEstimateInputHash(facts("Pill"), WHERE) };
    const fake = fakeClient({ behaviors: [{ id: "pill", title: "Pill", alongside: null }, { id: "reading", title: "Reading", alongside: null }], estimates: [current] });
    const day = await readBriefMoveDay(fake.client, "user", DAY, { env: ON });
    expect(day.items.map((item) => [item.behaviorId, item.alongside, item.alongsideSource])).toEqual([
      ["pill", true, "guess"], ["reading", false, "default"],
    ]);
    expect([...day.staleEstimateBehaviorIds]).toEqual(["reading"]);
  });

  it("flag on: a length-only estimate is current while answered and stale once the answer is cleared", async () => {
    const lengthOnly: EstimateRow = { behavior_id: "pill", input_hash: behaviorEstimateInputHash(facts("Pill"), { alongsideAsked: false, ...WHERE }), duration_minutes: 2, alongside: false };
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

describe("readBriefMoveDay effective Where (Ticket 357)", () => {
  const labels = (behaviorId: string, label: string, count: number): LabelRow[] =>
    Array.from({ length: count }, (_, index) => ({ behavior_id: behaviorId, label, local_date: `2026-11-${String(25 - index).padStart(2, "0")}` }));

  it("flag off: no item has a Where and nothing place-related is read", async () => {
    const fake = fakeClient({ behaviors: [{ id: "pill", title: "Pill", alongside: null }], estimates: [], labels: labels("pill", "home", 6) });
    const day = await readBriefMoveDay(fake.client, "user", DAY, { env: OFF });
    expect(day.items.every((item) => !("where" in item))).toBe(true);
    expect(fake.selects.completion_place_labels).toBeUndefined();
    expect(fake.selects.behaviors!.every((columns) => !columns.includes("location_text"))).toBe(true);
    expect(fake.selects.behavior_advisor_estimates!.every((columns) => !columns.includes("where_guess"))).toBe(true);
  });

  it("flag on: the person's Where, then counted labels, then a current guess, then unknown", async () => {
    const fake = fakeClient({
      behaviors: [
        { id: "pill", title: "Pill", alongside: null, where_kind: "home" },
        { id: "reading", title: "Reading", alongside: null },
      ],
      estimates: [{ behavior_id: "reading", input_hash: behaviorEstimateInputHash(facts("Reading"), WHERE), duration_minutes: 30, alongside: false, where_guess: "anywhere" }],
      labels: labels("pill", "elsewhere", 6),
    });
    const day = await readBriefMoveDay(fake.client, "user", DAY, { env: ON });
    expect(day.items.map((item) => [item.behaviorId, item.where])).toEqual([
      ["pill", { kind: "home", source: "person" }],
      ["reading", { kind: "anywhere", source: "guess" }],
    ]);
    expect(fake.selects.behavior_advisor_estimates!.some((columns) => columns.includes("where_guess"))).toBe(true);

    const counted = await readBriefMoveDay(fakeClient({
      behaviors: [{ id: "pill", title: "Pill", alongside: null }, { id: "reading", title: "Reading", alongside: null }],
      // A stale estimate's guess is not read.
      estimates: [{ behavior_id: "reading", input_hash: "0".repeat(64), duration_minutes: 30, alongside: false, where_guess: "home" }],
      labels: labels("pill", "home", 6),
    }).client, "user", DAY, { env: ON });
    expect(counted.items.map((item) => [item.behaviorId, item.where])).toEqual([
      ["pill", { kind: "home", source: "evidence" }],
      ["reading", { kind: "unknown", source: "none" }],
    ]);
  });
});

describe("Where leaves the estimate hash (Ticket 386, D37)", () => {
  // One row made from "Reading" with no Where: a length, an alongside guess and a Where guess.
  const cached: EstimateRow = { behavior_id: "reading", input_hash: behaviorEstimateInputHash(facts("Reading"), WHERE), duration_minutes: 30, alongside: true, where_guess: "anywhere" };
  const read = async (behavior: BehaviorRow, estimates: EstimateRow[] = [cached]) => {
    mocks.occurrences = [occurrence("reading")];
    const fake = fakeClient({ behaviors: [behavior], estimates });
    const day = await readBriefMoveDay(fake.client, "user", DAY, { env: ON });
    const calls: string[][] = [];
    await cacheBehaviorEstimates({ agent: fake.client, userId: "user", localDate: DAY, day, model: "test", env: ON,
      estimate: async (behaviors) => { calls.push(behaviors.map((item) => item.id)); return []; } });
    return { day, calls };
  };

  it("setting or changing Where keeps the cached length and alongside guess and asks nothing", async () => {
    for (const whereKind of ["home", "anywhere"]) {
      const { day, calls } = await read({ id: "reading", title: "Reading", alongside: null, where_kind: whereKind });
      expect(day.staleEstimateBehaviorIds.size).toBe(0);
      expect(calls).toEqual([]);
      expect(day.items[0]).toMatchObject({ alongside: true, alongsideSource: "guess" });
      // While the person's Where is set, the cached Where guess is not read.
      expect(day.items[0]!.where).toEqual({ kind: whereKind, source: "person" });
    }
  });

  it("clearing Where reads the cached Where guess again, with no model call", async () => {
    const { day, calls } = await read({ id: "reading", title: "Reading", alongside: null, where_kind: null });
    expect(calls).toEqual([]);
    expect(day.items[0]!.where).toEqual({ kind: "anywhere", source: "guess" });
  });

  it("the cached length reads the same with Where set, changed or cleared", () => {
    for (const whereKind of [null, "home", "place"]) {
      expect(currentEstimateMinutes(cached, { title: "Reading", description: null, whereKind, alongside: null }, true)).toBe(30);
    }
  });

  it("changing the title still makes the estimate stale and asks once", async () => {
    const { day, calls } = await read({ id: "reading", title: "Reading a novel", alongside: null, where_kind: "home" });
    expect([...day.staleEstimateBehaviorIds]).toEqual(["reading"]);
    expect(calls).toEqual([["reading"]]);
    expect(day.items[0]).toMatchObject({ alongside: false, alongsideSource: "default" });
  });

  it("flag off: a Where change keeps a recipe 1.2 row current too", async () => {
    mocks.occurrences = [occurrence("reading")];
    const row: EstimateRow = { behavior_id: "reading", input_hash: behaviorEstimateInputHash(facts("Reading")), duration_minutes: 30, alongside: true };
    for (const whereKind of [null, "home"]) {
      const day = await readBriefMoveDay(fakeClient({ behaviors: [{ id: "reading", title: "Reading", alongside: null, where_kind: whereKind }], estimates: [row] }).client, "user", DAY, { env: OFF });
      expect(day.staleEstimateBehaviorIds.size).toBe(0);
      expect(day.items[0]).toMatchObject({ alongside: true, alongsideSource: "guess" });
    }
  });
});

describe("cacheBehaviorEstimates alongside", () => {
  type Ask = Readonly<{ ids: string[]; alongside: boolean; where?: boolean }>;
  const run = async (env: Record<string, string>) => {
    const fake = fakeClient({ behaviors: [{ id: "pill", title: "Pill", alongside: null }, { id: "reading", title: "Reading", alongside: false }], estimates: [] });
    const day = await readBriefMoveDay(fake.client, "user", DAY, { env });
    const asks: Ask[] = [];
    await cacheBehaviorEstimates({
      agent: fake.client, userId: "user", localDate: DAY, day, model: "test", env,
      estimate: async (behaviors, ask) => {
        asks.push({ ids: behaviors.map((behavior) => behavior.id), alongside: ask?.alongside ?? true, ...(ask?.where ? { where: true } : {}) });
        return behaviors.map((behavior) => ({ behaviorId: behavior.id, minutes: 7, alongside: true, ...(ask?.where ? { whereGuess: "home" as const } : {}) }));
      },
    });
    const stored = (fake.rpcs[0]?.args as { p_estimates: Array<{ behavior_id: string; input_hash: string; alongside: boolean; where_guess?: string | null }> }).p_estimates;
    return { asks, stored };
  };

  it("flag off: asks about alongside for every stale Behavior in one call", async () => {
    const { asks, stored } = await run(OFF);
    expect(asks).toEqual([{ ids: ["pill", "reading"], alongside: true }]);
    expect(stored.map((row) => [row.behavior_id, row.alongside])).toEqual([["pill", true], ["reading", true]]);
    expect(stored.find((row) => row.behavior_id === "reading")!.input_hash).toBe(behaviorEstimateInputHash(facts("Reading")));
    // Ticket 359: with the flag off the stored rows carry no Where guess key at all.
    expect(stored.every((row) => !("where_guess" in row))).toBe(true);
  });

  it("flag on: asks only unanswered Behaviors about alongside and the rest for length only", async () => {
    const { asks, stored } = await run(ON);
    expect(asks).toEqual([{ ids: ["pill"], alongside: true, where: true }, { ids: ["reading"], alongside: false, where: true }]);
    const reading = stored.find((row) => row.behavior_id === "reading")!;
    expect(reading).toMatchObject({ alongside: false, where_guess: "home", input_hash: behaviorEstimateInputHash(facts("Reading"), { alongsideAsked: false, ...WHERE }) });
    expect(stored.find((row) => row.behavior_id === "pill")).toMatchObject({ alongside: true, where_guess: "home", input_hash: behaviorEstimateInputHash(facts("Pill"), WHERE) });
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
          ...(input.estimateVariant === "alongside" || input.estimateVariant === "alongside_where" ? { alongside: true } : {}),
          ...(input.estimateVariant === "alongside_where" || input.estimateVariant === "where" ? { whereGuess: "anywhere" } : {}) })) };
      }, undefined, { userId: "user" });
      expect(calls).toHaveLength(2);
      // Ticket 359: both calls are estimate recipe 1.3 and also ask for the Where guess.
      expect(calls[0]).toMatchObject({ estimateVariant: "alongside_where" });
      expect(calls[0]!.instructions).toContain("alongside");
      expect(calls[0]!.instructions).toContain("whereGuess");
      expect(calls[1]).toMatchObject({ estimateVariant: "where" });
      expect(calls[1]!.instructions).not.toContain("alongside");
      expect(calls[1]!.instructions).toContain("whereGuess");
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
