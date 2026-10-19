import { describe, expect, it, vi } from "vitest";
import { readIntegrationOccurrences, readIntegrationCategories } from "@/lib/db/integration-read.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

function clientWithRows(count: number) {
  const rows = Array.from({ length: count }, (_, id) => ({ id: String(id) }));
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    range: vi.fn(async (from: number, through: number) => ({ data: rows.slice(from, through + 1), error: null })),
  };
  return { query, client: { from: vi.fn(() => query) } as unknown as AppSupabaseClient };
}

describe("integration read repository", () => {
  it("reads beyond PostgREST's page cap with owner and range filters on every page", async () => {
    const { client, query } = clientWithRows(1001);
    expect(await readIntegrationOccurrences(client, "user-a", { startLocalDate: "2026-03-01", endLocalDate: "2026-03-31" })).toHaveLength(1001);
    expect(query.eq.mock.calls).toEqual([["user_id", "user-a"], ["user_id", "user-a"]]);
    expect(query.gte.mock.calls).toEqual([["local_date", "2026-03-01"], ["local_date", "2026-03-01"]]);
    expect(query.lte.mock.calls).toEqual([["local_date", "2026-03-31"], ["local_date", "2026-03-31"]]);
    expect(query.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    expect(query.order).toHaveBeenCalledWith("id");
  });
  it("does not silently cap categories and propagates read failures", async () => {
    const { client, query } = clientWithRows(1001);
    expect(await readIntegrationCategories(client, "user-a")).toHaveLength(1001);
    expect(query.eq).toHaveBeenCalledWith("user_id", "user-a");
    query.range.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(readIntegrationCategories(client, "user-a")).rejects.toThrow("database unavailable");
  });
});
