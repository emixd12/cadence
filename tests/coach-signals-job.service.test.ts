import { describe, expect, it, vi } from "vitest";

import {
  coachSignalsEnabled,
  processCoachSignals,
  visitCoachAccount,
  type CoachVisitPort,
  type DueCoachAccount,
} from "@/lib/services/coach-signals-job.service";
import { createCoachSignalReads } from "@/lib/db/coach-signals.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { Temporal } from "@js-temporal/polyfill";

// Advisor plan Phase 3, workstream 3D: the hourly coach signal job.

function accounts(count: number, start = 0): DueCoachAccount[] {
  return Array.from({ length: count }, (_, index) => ({
    userId: `00000000-0000-4000-8000-${String(start + index).padStart(12, "0")}`, localDate: "2026-11-19",
  }));
}

describe("processCoachSignals", () => {
  it("is on unless the switch is exactly off", () => {
    expect(coachSignalsEnabled({})).toBe(true);
    expect(coachSignalsEnabled({ CADENCE_COACH_SIGNALS: "on" })).toBe(true);
    expect(coachSignalsEnabled({ CADENCE_COACH_SIGNALS: " off " })).toBe(false);
  });

  it("does nothing when switched off", async () => {
    const selectDue = vi.fn();
    const result = await processCoachSignals({ env: { CADENCE_COACH_SIGNALS: "off" }, selectDue, visit: vi.fn() });
    expect(result.enabled).toBe(false);
    expect(selectDue).not.toHaveBeenCalled();
  });

  it("walks due accounts a page at a time by cursor, and one failure never stops the batch", async () => {
    const all = accounts(5);
    const selectDue = vi.fn(async ({ after, limit }: { after: string | null; limit: number }) =>
      all.filter((account) => after === null || account.userId > after).slice(0, limit));
    const visit = vi.fn(async (account: DueCoachAccount) => {
      if (account.userId === all[1]!.userId) throw new Error("boom");
      return { signals: 2, answersSource: "proposals" as const };
    });
    const result = await processCoachSignals({ env: {}, pageSize: 2, selectDue, visit });
    expect(selectDue.mock.calls.map(([input]) => input.after)).toEqual([null, all[1]!.userId, all[3]!.userId]);
    expect(result).toEqual({ enabled: true, pages: 3, selected: 5, visited: 4, skipped: 0, failed: 1, signals: 8 });
  });

  it("stops visiting when the run budget is spent and leaves the rest for the next hour", async () => {
    let now = 0;
    const visit = vi.fn(async () => { now += 30; return { signals: 0, answersSource: "answers" as const }; });
    const result = await processCoachSignals({
      env: {}, now: () => now, runBudgetMs: 50, pageSize: 10, selectDue: async () => accounts(10), visit,
    });
    // Each visit takes 30 ms of the 50 ms budget: two start in time, the rest are skipped.
    expect(result.visited).toBe(2);
    expect(result.skipped).toBe(8);
    expect(result.pages).toBe(1);
  });
});

describe("visitCoachAccount", () => {
  function port(overrides: Partial<CoachVisitPort> = {}): CoachVisitPort & { finishRun: ReturnType<typeof vi.fn>; record: ReturnType<typeof vi.fn> } {
    return {
      startRun: vi.fn(async () => ({ runId: "run-1", localDate: "2026-11-19" })),
      reads: {
        behaviors: vi.fn(async () => [{ id: "b1", createdAt: "2026-11-05T14:00:00Z", timezone: "America/New_York", active: true }]),
        occurrences: vi.fn(async () => []),
        decisions: vi.fn(async () => []),
        moves: vi.fn(async () => []),
        answers: vi.fn(async () => ({ source: "proposals" as const, rows: [] })),
        reminders: vi.fn(async () => []),
        sessions: vi.fn(async () => []),
      },
      record: vi.fn(async (_runId, signals) => signals.length),
      finishRun: vi.fn(async () => undefined),
      ...overrides,
    } as never;
  }

  it("reads bounded windows ending today, stores the signals and finishes the run with no model call", async () => {
    const visit = port();
    await expect(visitCoachAccount(visit)).resolves.toEqual({ signals: 1, answersSource: "proposals" });
    expect(visit.reads.occurrences).toHaveBeenCalledWith("2026-09-24", "2026-11-20");
    expect(visit.reads.decisions).toHaveBeenCalledWith("2026-10-22", "2026-11-19");
    expect(visit.reads.moves).toHaveBeenCalledWith("2026-10-15");
    expect(visit.reads.answers).toHaveBeenCalledWith("2026-10-22");
    expect(visit.record).toHaveBeenCalledWith("run-1", [expect.objectContaining({ kind: "new_behavior_settled", behaviorId: "b1" })]);
    expect(visit.finishRun).toHaveBeenCalledWith("run-1", "success", null);
  });

  it("Ticket 372: reads Periods over the Occurrence window and passes only their covered dates to the resolver", async () => {
    // Reading drops over the last two weeks; a Period covers November 10 to 16 and another began before the window.
    const statuses = (from: string, values: readonly string[]) => values.map((status, index) => ({
      behaviorId: "b1", status, localDate: Temporal.PlainDate.from(from).add({ days: index }).toString() }));
    const occurrences = [
      ...statuses("2026-10-08", [...Array(10).fill("completed"), "not_completed", "not_completed"]),
      ...statuses("2026-11-05", ["completed", "completed", "completed", "not_completed", "not_completed", "not_completed"]),
    ];
    const reads = (periods?: () => Promise<unknown[]>) => ({
      ...port().reads,
      behaviors: vi.fn(async () => [{ id: "b1", createdAt: "2026-08-01T14:00:00Z", timezone: "America/New_York", active: true }]),
      occurrences: vi.fn(async () => occurrences),
      ...(periods ? { periods: vi.fn(periods) } : {}),
    });
    const drop = (visit: ReturnType<typeof port>) => (visit.record.mock.calls[0]![1] as Array<{ kind: string; facts: Record<string, unknown> }>)
      .find((signal) => signal.kind === "completion_drop");

    const withPeriods = port({ reads: reads(async () => [
      { start_on: "2026-11-10", end_on: "2026-11-16", label: "Sick", note: "Flu" },
      { start_on: "2026-11-14", end_on: "2026-11-15" }, // overlaps: each date counts once
      { start_on: "2026-07-01", end_on: "2026-10-10" }, // 3 days of the baseline (October 8 to 10)
    ]) as never });
    await visitCoachAccount(withPeriods);
    expect((withPeriods.reads as unknown as { periods: ReturnType<typeof vi.fn> }).periods).toHaveBeenCalledWith("2026-09-24", "2026-11-19");
    expect(drop(withPeriods)?.facts).toMatchObject({ recent_period_days: 7, baseline_period_days: 3 });
    expect(JSON.stringify(withPeriods.record.mock.calls[0]![1])).not.toMatch(/Sick|Flu/);

    // A port without the read (written before Periods) still works and counts none.
    const without = port({ reads: reads() as never });
    await visitCoachAccount(without);
    expect(drop(without)?.facts).toMatchObject({ recent_period_days: 0, baseline_period_days: 0 });
    // The Period changed nothing else: same signals, same other facts.
    const strip = (visit: ReturnType<typeof port>) => (visit.record.mock.calls[0]![1] as Array<{ kind: string; facts: Record<string, unknown> }>)
      .map((signal) => ({ ...signal, facts: Object.fromEntries(Object.entries(signal.facts).filter(([name]) => !name.endsWith("_period_days"))) }));
    expect(strip(withPeriods)).toEqual(strip(without));
  });

  it("finishes a failed visit as an error and rethrows", async () => {
    const visit = port({ record: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(visitCoachAccount(visit)).rejects.toThrow("db down");
    expect(visit.finishRun).toHaveBeenCalledWith("run-1", "error", "visit_failed");
  });
});

describe("createCoachSignalReads periods (Ticket 372)", () => {
  function fakeClient(result: { data: unknown[] | null; error: unknown }) {
    const calls: [string, ...unknown[]][] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "lte", "or", "order"]) builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder; };
    builder.range = () => Promise.resolve(result);
    const client = { from(table: string) { calls.push(["from", table]); return builder; } };
    return { client: client as unknown as AppSupabaseClient, calls };
  }

  it("selects the dates of the caller's Periods that have a day in the range, never the label or the note", async () => {
    const { client, calls } = fakeClient({ data: [
      { id: "p1", start_on: "2026-11-10", end_on: "2026-11-16" }, { id: "p2", start_on: "2026-11-01", end_on: null },
    ], error: null });
    await expect(createCoachSignalReads(client, "u1").periods!("2026-09-24", "2026-11-19")).resolves.toEqual([
      { start_on: "2026-11-10", end_on: "2026-11-16" }, { start_on: "2026-11-01", end_on: null },
    ]);
    expect(calls).toEqual([
      ["from", "periods"], ["select", "id,start_on,end_on"], ["eq", "user_id", "u1"],
      ["lte", "start_on", "2026-11-19"], ["or", "end_on.is.null,end_on.gte.2026-09-24"], ["order", "id"],
    ]);
  });

  it("counts no Period while the periods table is not on the database, and fails the visit on any other error", async () => {
    const missing = fakeClient({ data: null, error: { code: "PGRST205", message: "Could not find the table" } });
    await expect(createCoachSignalReads(missing.client, "u1").periods!("2026-09-24", "2026-11-19")).resolves.toEqual([]);
    const denied = fakeClient({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(createCoachSignalReads(denied.client, "u1").periods!("2026-09-24", "2026-11-19")).rejects.toMatchObject({ code: "read_periods_failed" });
  });
});

describe("createCoachSignalReads answers", () => {
  // A chainable stand-in for the Supabase query builder: records the table, resolves with `result(table)`.
  function fakeClient(result: (table: string) => { data: unknown[] | null; error: unknown }) {
    const tables: string[] = [];
    const client = {
      from(table: string) {
        tables.push(table);
        const builder: Record<string, unknown> = {};
        for (const method of ["select", "eq", "in", "or", "gte", "lt", "order"]) builder[method] = () => builder;
        builder.range = () => Promise.resolve(result(table));
        return builder;
      },
    };
    return { client: client as unknown as AppSupabaseClient, tables };
  }

  it("reads 3A1's answer records, leaving out refused answers", async () => {
    const { client, tables } = fakeClient(() => ({ data: [
      { id: "a1", behavior_id: "b1", local_date: "2026-11-18", kind: "accept_all", outcome: "applied" },
      { id: "a2", behavior_id: "b1", local_date: "2026-11-18", kind: "yes", outcome: "refused" },
      { id: "a3", behavior_id: "b1", local_date: "2026-11-18", kind: "undo_all", outcome: "applied" },
    ], error: null }));
    await expect(createCoachSignalReads(client, "u1").answers("2026-10-22")).resolves.toEqual({
      source: "answers",
      rows: [
        { behaviorId: "b1", localDate: "2026-11-18", kind: "yes" },
        { behaviorId: "b1", localDate: "2026-11-18", kind: "undo" },
      ],
    });
    expect(tables).toEqual(["move_proposal_answers"]);
  });

  it("falls back to each proposal's final status while the answers table does not exist", async () => {
    const { client, tables } = fakeClient((table) => table === "move_proposal_answers"
      ? { data: null, error: { code: "PGRST205", message: "Could not find the table" } }
      : { data: [
        { id: "p1", behavior_id: "b1", local_date: "2026-11-18", status: "declined" },
        { id: "p2", behavior_id: "b1", local_date: "2026-11-18", status: "proposed" },
        { id: "p3", behavior_id: "b2", local_date: "2026-11-17", status: "accepted" },
      ], error: null });
    await expect(createCoachSignalReads(client, "u1").answers("2026-10-22")).resolves.toEqual({
      source: "proposals",
      rows: [
        { behaviorId: "b1", localDate: "2026-11-18", kind: "no" },
        { behaviorId: "b2", localDate: "2026-11-17", kind: "yes" },
      ],
    });
    expect(tables).toEqual(["move_proposal_answers", "move_proposals"]);
  });

  it("fails the visit on any other read error", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { code: "42501", message: "permission denied" } }));
    await expect(createCoachSignalReads(client, "u1").answers("2026-10-22")).rejects.toMatchObject({ code: "read_answers_failed" });
  });
});
