import { expect, it } from "vitest";
import { listSourceMatchesForOccurrences, OCCURRENCE_ID_FILTER_BATCH_SIZE } from "@/lib/db/sourceMatches.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

// Ticket 323 finding: the Timeline reads matches for every Occurrence in view. One
// `in` filter with 200 IDs exceeded the API gateway's URL limit ("URI too long"), so
// no "From Hevy" label showed. Each request now carries at most 100 IDs.
it("reads matches for many Occurrences in batches of at most 100 IDs", async () => {
  const batches: number[] = [];
  const query = (ids: string[]) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: (_column: string, values: string[]) => { ids.push(...values); batches.push(values.length); return chain; },
      order: () => chain,
      range: () => Promise.resolve({ data: [], error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return chain;
  };
  const seen: string[] = [];
  const supabase = { from: () => query(seen) } as unknown as AppSupabaseClient;
  const ids = Array.from({ length: 250 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);

  await listSourceMatchesForOccurrences(supabase, "user", ids);

  expect(OCCURRENCE_ID_FILTER_BATCH_SIZE).toBe(100);
  expect(Math.max(...batches)).toBeLessThanOrEqual(100);
  expect(new Set(seen)).toEqual(new Set(ids));
});
