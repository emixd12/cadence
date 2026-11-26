import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Occurrence } from "@/lib/types/database";

// Ticket 359 (D33): the estimate call also returns the coarse Where guess (estimate
// recipe 1.3) while CADENCE_ALONGSIDE is on. With the flag off the request is recipe 1.2,
// byte for byte, and stored rows carry no guess. The model input is title and
// description only: never a Where, a place key, a place label, a coordinate or
// location text.

const mocks = vi.hoisted(() => ({ occurrences: [] as Occurrence[] }));
vi.mock("@/lib/db/occurrences.repo", () => ({ listOccurrencesBetweenLocalDates: async () => mocks.occurrences }));
vi.mock("@/lib/services/behavior-length.service", async () => ({ readBehaviorLengths: (await import("./helpers/no-tracked-history")).readBehaviorLengthsWithoutHistory }));

import { behaviorEstimateInputHash, readBehaviorPlanningFacts } from "@/lib/services/brief-move-day.service";
import { ensureBehaviorEstimates } from "@/lib/services/brief-moves.service";
import { DURATION_ESTIMATE_INSTRUCTIONS, DURATION_ESTIMATE_V1_2_INSTRUCTIONS } from "@/lib/services/daily-brief-instructions";
import { generateDurationEstimatesWithModel } from "@/lib/services/daily-brief-model";
import type { DailyBriefGenerator } from "@/lib/services/daily-brief-consumer";
import { parseDescriptionEstimates } from "@cadence/core/services/description-duration";
import { OPENAI_ENV, responsesReply } from "./helpers/model-responses";

const DAY = "2026-11-25";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** Recipe 1.2 as it was before Ticket 359 (computed on the base branch). */
const RECIPE_1_2_INSTRUCTIONS_SHA256 = "53f36ec38eaa4cc8478a3b484cf0bc526dbcbd44da70487a9e16fc0599794c6a";
const RECIPE_1_2_FORMAT_SHA256 = "db0fb9a671909e0a1d54bf0f6ad5d7476380566975613f91f8ed6092aa82f2c0";
const TICKET_188_FORMAT_SHA256 = "45f8154a351f009dfc8a3ca6039ad31b03bffc94965430cb3af1873a3d447839";

type BehaviorRow = Readonly<{
  id: string; title: string; description?: string | null; alongside: boolean | null; where_kind?: string | null; location_text?: string | null;
}>;

const GYM_ADDRESS = "Lift Club, 40.7128,-74.0060";
const SECRET_LABEL = `saved_place:${"k".repeat(43)}`;

function behaviorRow(row: BehaviorRow) {
  return {
    id: row.id, title: row.title, description: row.description ?? null, timezone: "America/New_York", default_duration_minutes: null,
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

function fakeClient(tables: Readonly<{ behaviors: BehaviorRow[]; estimates?: unknown[]; labels?: unknown[] }>) {
  const rpcs: Array<Readonly<{ name: string; args: unknown }>> = [];
  const rows = (table: string): unknown[] => table === "behaviors" ? tables.behaviors.map(behaviorRow)
    : table === "behavior_advisor_estimates" ? tables.estimates ?? [] : table === "completion_place_labels" ? tables.labels ?? [] : [];
  const client = {
    from(table: string) {
      const result = { data: rows(table), error: null };
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, not: () => chain, order: () => chain, limit: () => chain, gte: () => chain, lte: () => chain,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
    async rpc(name: string, args: unknown) { rpcs.push({ name, args }); return { data: null, error: null }; },
  };
  return { client: client as unknown as AppSupabaseClient, rpcs };
}

type Call = Parameters<DailyBriefGenerator>[0];
const answer = (where: string) => async (input: Call) => {
  const items = (JSON.parse(input.facts) as { items: Array<{ behaviorRef: string }> }).items;
  const alongside = input.estimateVariant === "alongside" || input.estimateVariant === "alongside_where";
  const withWhere = input.estimateVariant === "alongside_where" || input.estimateVariant === "where";
  return { estimates: items.map((item) => ({ behaviorRef: item.behaviorRef, minutes: 10, basis: "inferred",
    ...(alongside ? { alongside: true } : {}), ...(withWhere ? { whereGuess: where } : {}) })) };
};

const stored = (rpcs: ReturnType<typeof fakeClient>["rpcs"]) =>
  (rpcs[0]!.args as { p_estimates: Array<Record<string, unknown>> }).p_estimates;

const gym: BehaviorRow = { id: "gym", title: "Gym session", description: "Leg day", alongside: null, where_kind: "place", location_text: GYM_ADDRESS };
const helmet: BehaviorRow = { id: "helmet", title: "Red light helmet", alongside: null };
const pill: BehaviorRow = { id: "pill", title: "Vitamin D", alongside: true };

beforeEach(() => { mocks.occurrences = [occurrence("helmet"), occurrence("pill"), occurrence("gym")]; });
afterEach(() => { vi.unstubAllEnvs(); });

describe("estimate call, flag off", () => {
  it("sends recipe 1.2 exactly as before and stores no Where guess", async () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "");
    const fake = fakeClient({ behaviors: [helmet, pill, gym] });
    const calls: Call[] = [];
    await ensureBehaviorEstimates(fake.client, { localDate: DAY }, async (input) => { calls.push(input); return answer("home")(input); }, undefined, { userId: "user" });
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]!).sort()).toEqual(["estimateVariant", "facts", "instructions", "signal"]);
    expect(calls[0]!.estimateVariant).toBe("alongside");
    expect(sha(calls[0]!.instructions)).toBe(RECIPE_1_2_INSTRUCTIONS_SHA256);
    expect(calls[0]!.instructions).toBe(`${DURATION_ESTIMATE_INSTRUCTIONS}\n${DURATION_ESTIMATE_V1_2_INSTRUCTIONS}`);
    for (const row of stored(fake.rpcs)) expect(Object.keys(row).sort()).toEqual(["alongside", "behavior_id", "duration_minutes", "input_hash", "model"]);
  });

  it("keeps the adapter's recipe 1.2 and Ticket 188 schemas unchanged", async () => {
    const bodies: string[] = [];
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { bodies.push(init!.body as string); return Response.json(responsesReply({ estimates: [] })); }) as typeof fetch;
    const input = { instructions: "I", facts: "F", signal: new AbortController().signal };
    await generateDurationEstimatesWithModel({ ...input, estimateVariant: "alongside" }, { env: OPENAI_ENV, fetch: fetcher });
    await generateDurationEstimatesWithModel(input, { env: OPENAI_ENV, fetch: fetcher });
    await generateDurationEstimatesWithModel({ ...input, estimateVariant: "alongside_where" }, { env: OPENAI_ENV, fetch: fetcher });
    await generateDurationEstimatesWithModel({ ...input, estimateVariant: "where" }, { env: OPENAI_ENV, fetch: fetcher });
    const formats = bodies.map((body) => JSON.parse(body).text.format as { name: string; schema: { properties: { estimates: { items: { required: string[] } } } } });
    expect(sha(JSON.stringify(formats[0]))).toBe(RECIPE_1_2_FORMAT_SHA256);
    expect(sha(JSON.stringify(formats[1]))).toBe(TICKET_188_FORMAT_SHA256);
    expect(formats[2]!.name).toBe("cadence_duration_estimates_v1_3");
    expect(formats[2]!.schema.properties.estimates.items.required).toEqual(["behaviorRef", "minutes", "basis", "alongside", "whereGuess"]);
    expect(formats[3]!.name).toBe("cadence_duration_estimates_v1_3_length");
    expect(formats[3]!.schema.properties.estimates.items.required).toEqual(["behaviorRef", "minutes", "basis", "whereGuess"]);
  });
});

describe("estimate call, flag on (recipe 1.3)", () => {
  it("sends only title and description: no Where, place key, label, coordinate or location text", async () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    const labels = Array.from({ length: 8 }, (_, index) => ({ behavior_id: "gym", label: SECRET_LABEL, local_date: `2026-11-${String(10 + index)}` }));
    const fake = fakeClient({ behaviors: [helmet, pill, gym], labels });
    const calls: Call[] = [];
    await ensureBehaviorEstimates(fake.client, { localDate: DAY }, async (input) => { calls.push(input); return answer("elsewhere")(input); }, undefined, { userId: "user" });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const items = (JSON.parse(call.facts) as { items: Array<Record<string, unknown>> }).items;
      for (const item of items) expect(Object.keys(item).sort()).toEqual(["behaviorRef", "description", "title"]);
      for (const secret of [GYM_ADDRESS, "40.7128", "-74.0060", "Lift Club", SECRET_LABEL, "saved_place", "where_kind", "place"]) {
        expect(call.facts).not.toContain(secret);
      }
    }
    expect(JSON.parse(calls[0]!.facts)).toEqual({ items: [
      { behaviorRef: "b1", title: "Red light helmet", description: "" }, { behaviorRef: "b2", title: "Gym session", description: "Leg day" },
    ] });
  });

  it("stores the guess, and none for a Behavior whose Where the person set", async () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    const fake = fakeClient({ behaviors: [helmet, pill, gym] });
    await ensureBehaviorEstimates(fake.client, { localDate: DAY }, answer("home"), undefined, { userId: "user" });
    const rows = stored(fake.rpcs);
    expect(rows.map((row) => [row.behavior_id, row.where_guess])).toEqual([["helmet", "home"], ["gym", null], ["pill", "home"]]);
    expect(rows.find((row) => row.behavior_id === "helmet")!.input_hash).toBe(behaviorEstimateInputHash({ title: "Red light helmet", description: null, whereKind: null }, { whereAsked: true }));
  });

  it("drops a reply whose guess is not one of the four values", () => {
    const items = [{ behaviorRef: "b1", title: "Gym", description: "" }];
    expect(parseDescriptionEstimates({ estimates: [{ behaviorRef: "b1", minutes: 60, basis: "inferred", whereGuess: "the gym" }] }, items, { whereGuess: true })).toEqual([]);
    expect(parseDescriptionEstimates({ estimates: [{ behaviorRef: "b1", minutes: 60, basis: "inferred" }] }, items, { whereGuess: true })).toEqual([]);
    expect(parseDescriptionEstimates({ estimates: [{ behaviorRef: "b1", minutes: 60, basis: "inferred", whereGuess: "elsewhere" }] }, items, { whereGuess: true }))
      .toEqual([{ behaviorRef: "b1", minutes: 60, basis: "inferred", whereGuess: "elsewhere" }]);
  });
});

describe("readBehaviorPlanningFacts", () => {
  const hash = (row: BehaviorRow, options: Readonly<{ alongsideAsked?: boolean }> = {}) =>
    behaviorEstimateInputHash({ title: row.title, description: row.description ?? null, whereKind: row.where_kind ?? null }, { ...options, whereAsked: true });

  it("flag off: reads nothing", async () => {
    const fake = fakeClient({ behaviors: [helmet] });
    expect((await readBehaviorPlanningFacts(fake.client, "user", ["helmet"], DAY, { env: {} })).size).toBe(0);
  });

  it("flag on: the helmet, pill and gym cases", async () => {
    const fake = fakeClient({
      behaviors: [helmet, pill, { ...gym, location_text: null, where_kind: null }],
      estimates: [
        { behavior_id: "helmet", input_hash: hash(helmet), duration_minutes: 10, alongside: true, where_guess: "home" },
        { behavior_id: "pill", input_hash: hash(pill, { alongsideAsked: false }), duration_minutes: 1, alongside: false, where_guess: "anywhere" },
        { behavior_id: "gym", input_hash: hash({ ...gym, where_kind: null }), duration_minutes: 60, alongside: false, where_guess: "elsewhere" },
      ],
    });
    const facts = await readBehaviorPlanningFacts(fake.client, "user", ["helmet", "pill", "gym"], DAY, { env: { CADENCE_ALONGSIDE: "on" } });
    expect(Object.fromEntries(facts)).toEqual({
      // Ticket 360: only the helmet's question is open (unanswered, guessed yes).
      helmet: { alongside: { value: true, source: "guess" }, where: { kind: "home", source: "guess" }, questionOpen: true },
      pill: { alongside: { value: true, source: "person" }, where: { kind: "anywhere", source: "guess" }, questionOpen: false },
      gym: { alongside: { value: false, source: "guess" }, where: { kind: "elsewhere", source: "guess" }, questionOpen: false },
    });
  });
});
