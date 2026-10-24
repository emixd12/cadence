import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it, vi } from "vitest";

import { resolveWhereSuggestion, WHERE_SUGGESTION_RULES_V1 } from "@cadence/core/resolvers/place-label.resolver";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import {
  readCompletionPlaceLabelRows,
  readPlaceLabelBehaviorRows,
  readPlaceMarkerRows,
  readWhereSuggestionDismissalRows,
} from "@/lib/db/placeLabels.repo";

const USER_ID = "owner";

function cappedClient(rows: readonly unknown[], laterError: Error | null = null) {
  const queries: Array<{
    table: string;
    filters: Array<[string, string]>;
    orders: string[];
    range: [number, number] | null;
  }> = [];
  const client = {
    from: vi.fn((table: string) => {
      const request = { table, filters: [] as Array<[string, string]>, orders: [] as string[], range: null as [number, number] | null };
      queries.push(request);
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((column: string, value: string) => {
          request.filters.push([column, value]);
          return query;
        }),
        order: vi.fn((column: string) => {
          request.orders.push(column);
          return query;
        }),
        range: vi.fn(async (from: number, to: number) => {
          request.range = [from, to];
          return from > 0 && laterError
            ? { data: null, error: laterError }
            : { data: rows.slice(from, Math.min(to + 1, from + 1_000)), error: null };
        }),
        // Unpaginated reads receive the same 1,000-row cap as PostgREST.
        then: (resolve: (value: { data: readonly unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: rows.slice(0, 1_000), error: null }).then(resolve),
      };
      return query;
    }),
  };
  return { client: client as unknown as AppSupabaseClient, queries };
}

describe("place-label repository pagination", () => {
  it.each([
    ["place_markers", readPlaceMarkerRows, ["id"]],
    ["completion_place_labels", readCompletionPlaceLabelRows, ["local_date", "id"]],
    ["where_suggestion_dismissals", readWhereSuggestionDismissalRows, ["id"]],
    ["behaviors", readPlaceLabelBehaviorRows, ["created_at", "id"]],
  ] as const)("reads every %s row with stable owner-scoped pages", async (table, read, orders) => {
    const rows = Array.from({ length: 1_001 }, (_, index) => ({ id: String(index) }));
    const { client, queries } = cappedClient(rows);

    await expect(read(client, USER_ID)).resolves.toEqual(rows);
    expect(queries).toEqual([
      { table, filters: [["user_id", USER_ID]], orders: [...orders], range: [0, 999] },
      { table, filters: [["user_id", USER_ID]], orders: [...orders], range: [1_000, 1_999] },
    ]);
  });

  it("finds a recent Where suggestion after 1,000 older retained labels", async () => {
    const stored = Array.from({ length: 1_006 }, (_, index) => ({
      id: String(index),
      behavior_id: "behavior",
      local_date: index < 1_000 ? "2025-01-01" : "2026-10-20",
      label: "home",
      rule_version: "place-label-rules@1",
      recorded_at: index < 1_000 ? "2025-01-01T12:00:00Z" : "2026-10-20T12:00:00Z",
    }));
    const { client } = cappedClient(stored);
    const rows = await readCompletionPlaceLabelRows(client, USER_ID);
    const suggestion = resolveWhereSuggestion({
      where: { whereKind: null, placeRef: null },
      labels: rows.map((row) => ({
        label: "home" as const,
        localDate: row.local_date,
        recordedAt: row.recorded_at,
      })),
      dismissal: null,
      markedPlaces: new Set(["home"]),
      today: Temporal.PlainDate.from("2026-10-22"),
      rules: WHERE_SUGGESTION_RULES_V1,
    });

    expect(rows).toHaveLength(1_006);
    expect(suggestion).toMatchObject({ kind: "home", labelCount: 6, supportingCount: 6 });
  });

  it("rejects a failed later page rather than returning incomplete history", async () => {
    const error = new Error("later page failed");
    const rows = Array.from({ length: 1_001 }, (_, index) => ({ id: String(index) }));
    const { client } = cappedClient(rows, error);

    await expect(readCompletionPlaceLabelRows(client, USER_ID)).rejects.toBe(error);
  });
});

