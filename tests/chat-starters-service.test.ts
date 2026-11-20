import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/operations/execute", () => ({ executeMcpOperation: execute }));

import { readChatStarterFacts, readChatStarters } from "@/lib/services/chat/chat-starters";
import { CHAT_STARTER_FALLBACK } from "@cadence/core/resolvers/chat-starters.resolver";
import type { IntegrationContext } from "@/lib/integrations/request-context";

// Advisor plan Phase 5B: the starters route reads today and four weeks of marks, then picks in code.

const context = {} as IntegrationContext;
const item = (status: string, title: string, move: unknown = null) => ({ status, behavior_title: title, move });
const counts = (completed: number, notCompleted: number) => ({ completed, not_completed: notCompleted, unresolved: 0, needs_decision: 0, adherence_rate: null });

beforeEach(() => {
  execute.mockReset();
  execute.mockImplementation(async (name: string, _context: unknown, input: { start_local_date?: string }) => {
    if (name === "get_timeline") {
      return { ok: true, value: { today_local_date: "2026-11-20", days: [{ occurrences: [item("completed", "Meds"), item("unresolved", "Run", { start_at: "x" })] }], needs_decision: { total_count: 2 } } };
    }
    const month = input.start_local_date === "2026-10-24";
    return { ok: true, value: {
      overall: month ? counts(40, 10) : counts(9, 3),
      behaviors: [
        { behavior_title: "Piano practice", state: "active", ...(month ? counts(2, 8) : counts(0, 2)) },
        { behavior_title: "Old thing", state: "archived", ...counts(0, 9) },
      ],
    } };
  });
});

describe("chat starters service", () => {
  it("turns today and four weeks of marks into starter facts", async () => {
    const facts = await readChatStarterFacts(context);
    expect(execute).toHaveBeenCalledWith("get_adherence_summary", context, { start_local_date: "2026-10-24", end_local_date: "2026-11-20" });
    expect(execute).toHaveBeenCalledWith("get_adherence_summary", context, { start_local_date: "2026-11-14", end_local_date: "2026-11-20" });
    expect(facts).toMatchObject({
      today: "2026-11-20", todayTotal: 2, todayDone: 1, todayOpen: 1, movedToday: "Run", unmarked: 2,
      week: { decided: 12, rate: 0.75 }, month: { decided: 50, rate: 0.8 },
      behaviors: [{ title: "Piano practice", decided: 10, rate: 0.2 }],
    });
  });

  it("names the person's own Behaviors in the questions", async () => {
    const { starters } = await readChatStarters({ context } as never);
    expect(starters.map((starter) => starter.text).join(" ")).toMatch(/Run|Piano practice/);
    expect(starters).toHaveLength(3);
  });

  it("falls back to the general three when a read fails", async () => {
    execute.mockResolvedValueOnce({ ok: false, error: { code: "rate_limited" } });
    expect(await readChatStarters({ context } as never)).toEqual({ starters: CHAT_STARTER_FALLBACK });
    execute.mockRejectedValueOnce(new Error("down"));
    expect(await readChatStarters({ context } as never)).toEqual({ starters: CHAT_STARTER_FALLBACK });
  });
});
