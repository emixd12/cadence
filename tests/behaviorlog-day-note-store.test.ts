import { describe, expect, it } from "vitest";

import type { AppSupabaseClient } from "../lib/db/behaviors.repo";
import { createBehaviorLogDayNoteStore } from "../lib/services/behaviorlog-import.service";

type Row = { id: string; user_id: string; local_date: string; note: string | null; revision: number; created_at: string; updated_at: string };

/** Fake PostgREST client that caps every response at 1,000 rows, like hosted max_rows. */
function pagedClient(rows: Row[]) {
  const ranges: [number, number][] = [];
  const query = {
    select: () => query,
    eq: () => query,
    gte: () => query,
    lte: () => query,
    order: () => query,
    range: async (from: number, to: number) => {
      ranges.push([from, to]);
      return { data: rows.slice(from, Math.min(to + 1, from + 1_000)), error: null };
    },
  };
  return { client: { from: () => query } as unknown as AppSupabaseClient, ranges };
}

describe("BehaviorLog day-note store on web", () => {
  it("reads saved day notes past the 1,000-row page limit", async () => {
    const rows: Row[] = Array.from({ length: 1_205 }, (_, index) => {
      const date = new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10);
      return { id: `note-${String(index).padStart(5, "0")}`, user_id: "user-1", local_date: date, note: `Note ${index}`, revision: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
    });
    const { client, ranges } = pagedClient(rows);

    const listed = await createBehaviorLogDayNoteStore(client, "user-1").listDayNotes({ from: "2020-01-01", to: "2099-12-31" });

    expect(listed).toHaveLength(1_205);
    expect(listed.at(-1)?.note).toBe("Note 1204");
    expect(ranges.length).toBeGreaterThan(1);
  });

  it("returns only the requested dates", async () => {
    const { client } = pagedClient([
      { id: "a", user_id: "user-1", local_date: "2026-06-06", note: "Before", revision: 1, created_at: "x", updated_at: "x" },
      { id: "b", user_id: "user-1", local_date: "2026-06-07", note: "Inside", revision: 1, created_at: "x", updated_at: "x" },
      { id: "c", user_id: "user-1", local_date: "2026-06-09", note: "After", revision: 1, created_at: "x", updated_at: "x" },
    ]);
    const listed = await createBehaviorLogDayNoteStore(client, "user-1").listDayNotes({ from: "2026-06-07", to: "2026-06-08" });
    expect(listed.map((row) => row.note)).toEqual(["Inside"]);
  });
});
