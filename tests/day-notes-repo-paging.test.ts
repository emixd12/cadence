import { describe, expect, it } from "vitest";

import type { AppSupabaseClient } from "../lib/db/behaviors.repo";
import { listDayNotesInRange } from "../lib/db/dayNotes.repo";

type Row = { id: string; user_id: string; local_date: string; note: string | null; revision: number; created_at: string; updated_at: string };

/** Fake PostgREST client that applies the date filters and caps every response at 1,000 rows, like hosted max_rows. */
function pagedClient(rows: Row[]) {
  let from = "";
  let to = "";
  const ranges: [number, number][] = [];
  const query = {
    select: () => query,
    eq: () => query,
    gte: (_column: string, value: string) => { from = value; return query; },
    lte: (_column: string, value: string) => { to = value; return query; },
    order: () => query,
    range: async (start: number, end: number) => {
      ranges.push([start, end]);
      const matching = rows.filter((row) => row.local_date >= from && row.local_date <= to);
      return { data: matching.slice(start, Math.min(end + 1, start + 1_000)), error: null };
    },
  };
  return { client: { from: () => query } as unknown as AppSupabaseClient, ranges };
}

describe("day-note range read", () => {
  it("keeps the newest dates of a Timeline range that holds more than 1,000 saved notes", async () => {
    const rows: Row[] = Array.from({ length: 1_400 }, (_, index) => ({
      id: `note-${String(index).padStart(5, "0")}`, user_id: "user-1",
      local_date: new Date(Date.UTC(2023, 0, 1 + index)).toISOString().slice(0, 10),
      note: `Note ${index}`, revision: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    }));
    const today = rows.at(-1)!.local_date;
    const { client, ranges } = pagedClient(rows);

    const listed = await listDayNotesInRange(client, "user-1", { from: "2023-01-01", to: today });

    expect(listed).toHaveLength(1_400);
    expect(listed.at(-1)).toMatchObject({ local_date: today, note: "Note 1399" });
    expect(ranges.length).toBeGreaterThan(1);
  });
});
