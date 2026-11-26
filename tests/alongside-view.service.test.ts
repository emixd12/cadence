import { describe, expect, it, vi } from "vitest";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

// Ticket 358 (D33): one read for the form, the Timeline label and the Where guess line.
// With CADENCE_ALONGSIDE off it reads nothing, so no surface changes.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUserId: vi.fn() }));

import {
  alongsideFormViews,
  alongsideRowViews,
  alongsideWhereGuesses,
  readAlongsideBehaviorFacts,
} from "@/lib/services/alongside-view.service";
import { behaviorEstimateInputHash } from "@/lib/services/brief-move-day.service";

const ON = { CADENCE_ALONGSIDE: "on" };
const DAY = "2026-11-25";

type Row = Readonly<{ id: string; title: string; alongside: boolean | null; where_kind?: string | null }>;

function fakeClient(tables: Readonly<{ behaviors: Row[]; estimates: unknown[]; labels?: unknown[] }>) {
  const tablesRead: string[] = [];
  const rows = (table: string): unknown[] => {
    if (table === "behaviors") return tables.behaviors.map((row) => ({
      id: row.id, title: row.title, description: null, timezone: "America/New_York", where_kind: row.where_kind ?? null,
      location_text: null, updated_at: "2026-11-01T00:00:00.000Z", alongside: row.alongside,
    }));
    if (table === "behavior_advisor_estimates") return tables.estimates;
    if (table === "completion_place_labels") return tables.labels ?? [];
    return [];
  };
  const client = {
    from(table: string) {
      tablesRead.push(table);
      const result = { data: rows(table), error: null };
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, gte: () => chain, lte: () => chain,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  };
  return { client: client as unknown as AppSupabaseClient, tablesRead };
}

// With the flag on only recipe 1.3 rows are current (Ticket 359).
const hash = (title: string, whereKind: string | null = null) => behaviorEstimateInputHash({ title, description: null, whereKind }, { whereAsked: true });

describe("readAlongsideBehaviorFacts", () => {
  it("reads nothing and returns null while the flag is off", async () => {
    const fake = fakeClient({ behaviors: [{ id: "pill", title: "Pill", alongside: true }], estimates: [] });
    expect(await readAlongsideBehaviorFacts(fake.client, "user-1", { localDate: DAY, env: {} })).toBeNull();
    expect(fake.tablesRead).toEqual([]);
    expect(alongsideFormViews(null)).toBeNull();
    expect(alongsideRowViews(null)).toEqual({});
    expect(alongsideWhereGuesses(null).size).toBe(0);
  });

  it("builds the form view, the row label and the Where guess from current estimates only", async () => {
    const fake = fakeClient({
      behaviors: [
        { id: "pill", title: "Pill", alongside: true },
        { id: "helmet", title: "Red light helmet", alongside: null },
        { id: "reading", title: "Reading", alongside: null, where_kind: "home" },
        { id: "stale", title: "Stretch", alongside: null },
      ],
      estimates: [
        { behavior_id: "helmet", input_hash: hash("Red light helmet"), duration_minutes: 10, alongside: true, where_guess: "home" },
        { behavior_id: "reading", input_hash: hash("Reading", "home"), duration_minutes: 30, alongside: false, where_guess: "anywhere" },
        { behavior_id: "stale", input_hash: "old", duration_minutes: 5, alongside: true, where_guess: "home" },
      ],
    });
    const facts = await readAlongsideBehaviorFacts(fake.client, "user-1", { localDate: DAY, env: ON });
    expect(alongsideFormViews(facts)).toEqual({
      pill: { answer: "yes", guess: null, questionOpen: false },
      helmet: { answer: "unanswered", guess: true, questionOpen: true },
      reading: { answer: "unanswered", guess: false, questionOpen: false },
      stale: { answer: "unanswered", guess: null, questionOpen: false },
    });
    expect(alongsideRowViews(facts)).toEqual({
      pill: { source: "person", where: { kind: "unknown" } },
      helmet: { source: "guess", where: { kind: "home" } },
    });
    // A set Where is never replaced by a guess; a stale estimate offers nothing.
    expect([...alongsideWhereGuesses(facts)]).toEqual([["helmet", "home"]]);
  });
});
