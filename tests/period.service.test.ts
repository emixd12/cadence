import { describe, expect, it } from "vitest";

import type { PeriodDataStore } from "@cadence/core/data-store";
import { PERIOD_MESSAGES, type PeriodRecord } from "@cadence/core/resolvers/period.resolver";
import {
  PERIOD_CONFLICT_MESSAGE,
  PERIOD_LIMIT_MESSAGE,
  createPeriod,
  deletePeriod,
  endPeriod,
  listPeriods,
  updatePeriod,
} from "@cadence/core/services/period.service";

// Behaves like the hosted functions: compare-and-set on revision, an unchanged
// write keeps the revision, and the 500 cap refuses a create.
function fakeStore(seed: PeriodRecord[] = [], cap = 500) {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));
  const calls: string[] = [];
  let created = 0;
  const store: PeriodDataStore = {
    async listPeriods(range) {
      calls.push(range ? `list:${range.from}:${range.to}` : "list");
      return [...rows.values()].map((row) => ({ ...row })).reverse();
    },
    async getPeriod(id) {
      calls.push("get");
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async createPeriod(input) {
      calls.push("create");
      if (rows.size >= cap) throw new Error(PERIOD_LIMIT_MESSAGE);
      created += 1;
      const row: PeriodRecord = {
        id: `created-${created}`, user_id: "user-1", label: input.label, start_on: input.startOn, end_on: input.endOn,
        note: input.note, revision: 1, created_at: "2026-11-25T10:00:00Z", updated_at: "2026-11-25T10:00:00Z",
      };
      rows.set(row.id, row);
      return { ...row };
    },
    async updatePeriod(input) {
      calls.push("update");
      const row = rows.get(input.id);
      if (!row || row.revision !== input.expectedRevision) return null;
      const next = {
        ...row, label: input.label, start_on: input.startOn, end_on: input.endOn, note: input.note,
        revision: row.revision + 1, updated_at: "2026-11-25T11:00:00Z",
      };
      rows.set(row.id, next);
      return { ...next };
    },
    async deletePeriod(input) {
      calls.push("delete");
      const row = rows.get(input.id);
      if (!row || row.revision !== input.expectedRevision) return null;
      rows.delete(row.id);
      return row.id;
    },
  };
  return { store, rows, calls };
}

function record(overrides: Partial<PeriodRecord> = {}): PeriodRecord {
  return {
    id: "period-1", user_id: "user-1", label: "Sick", start_on: "2026-11-03", end_on: null, note: null,
    revision: 1, created_at: "2026-11-03T12:00:00Z", updated_at: "2026-11-03T12:00:00Z", ...overrides,
  };
}

describe("createPeriod", () => {
  it("stores the normalized fields", async () => {
    const { store, rows } = fakeStore();
    const result = await createPeriod(store, { label: "  Sick ", startOn: "2026-11-03", endOn: "", note: " Flu\r\nRest " });
    expect(result.changed).toBe(true);
    expect(result.period).toMatchObject({ label: "Sick", start_on: "2026-11-03", end_on: null, note: "Flu\nRest", revision: 1 });
    expect(rows.size).toBe(1);
  });

  it("does not reach the store with invalid input", async () => {
    const { store, calls } = fakeStore();
    await expect(createPeriod(store, { label: " ", startOn: "2026-11-03" })).rejects.toThrow(PERIOD_MESSAGES.labelRequired);
    await expect(createPeriod(store, { label: "Sick", startOn: "2026-11-03", endOn: "2026-11-01" }))
      .rejects.toThrow(PERIOD_MESSAGES.endBeforeStart);
    expect(calls).toEqual([]);
  });

  it("passes on the store's refusal at the cap", async () => {
    const { store } = fakeStore([record()], 1);
    await expect(createPeriod(store, { label: "Travel", startOn: "2026-11-05" })).rejects.toThrow(PERIOD_LIMIT_MESSAGE);
    expect(PERIOD_LIMIT_MESSAGE).toContain("500");
  });
});

describe("updatePeriod", () => {
  it("changes only the fields that were sent and raises the revision", async () => {
    const { store } = fakeStore([record({ note: "Flu" })]);
    const result = await updatePeriod(store, { id: "period-1", expectedRevision: 1, endOn: "2026-11-09" });
    expect(result).toMatchObject({ changed: true, period: { label: "Sick", end_on: "2026-11-09", note: "Flu", revision: 2 } });
  });

  it("accepts the revision as digits from a form field", async () => {
    const { store } = fakeStore([record()]);
    expect((await updatePeriod(store, { id: "period-1", expectedRevision: "1", label: "Flu" })).period.label).toBe("Flu");
  });

  it("returns the stored Period without a write when nothing changes", async () => {
    const { store, calls } = fakeStore([record({ end_on: "2026-11-09", note: "Flu" })]);
    const result = await updatePeriod(store, {
      id: "period-1", expectedRevision: 1, label: " Sick ", startOn: "2026-11-03", endOn: "2026-11-09", note: "Flu",
    });
    expect(result).toMatchObject({ changed: false, period: { revision: 1 } });
    expect(calls).toEqual(["get"]);
  });

  it("turns a stale revision or a missing Period into the conflict message", async () => {
    const { store, calls } = fakeStore([record({ revision: 3 })]);
    await expect(updatePeriod(store, { id: "period-1", expectedRevision: 2, label: "Flu" })).rejects.toThrow(PERIOD_CONFLICT_MESSAGE);
    await expect(updatePeriod(store, { id: "gone", expectedRevision: 1, label: "Flu" })).rejects.toThrow(PERIOD_CONFLICT_MESSAGE);
    expect(calls).toEqual(["get", "get"]);
  });

  it("turns a null store result into the conflict message", async () => {
    const { store } = fakeStore([record()]);
    const racing: PeriodDataStore = { ...store, updatePeriod: async () => null };
    await expect(updatePeriod(racing, { id: "period-1", expectedRevision: 1, label: "Flu" })).rejects.toThrow(PERIOD_CONFLICT_MESSAGE);
  });

  it("validates before reading or writing", async () => {
    const { store, calls } = fakeStore([record({ end_on: "2026-11-09" })]);
    await expect(updatePeriod(store, { id: "period-1", expectedRevision: null, label: "Flu" })).rejects.toThrow(PERIOD_MESSAGES.revisionInvalid);
    await expect(updatePeriod(store, { id: null, expectedRevision: 1, label: "Flu" })).rejects.toThrow(PERIOD_MESSAGES.revisionInvalid);
    expect(calls).toEqual([]);
    await expect(updatePeriod(store, { id: "period-1", expectedRevision: 1, startOn: "2026-11-10" }))
      .rejects.toThrow(PERIOD_MESSAGES.endBeforeStart);
    expect(calls).toEqual(["get"]);
  });
});

describe("endPeriod", () => {
  it("sets the last day to the injected today", async () => {
    const { store } = fakeStore([record({ note: "Flu" })]);
    const result = await endPeriod(store, { id: "period-1", expectedRevision: 1, today: "2026-11-10" });
    expect(result).toMatchObject({ changed: true, period: { end_on: "2026-11-10", note: "Flu", label: "Sick", revision: 2 } });
  });

  it("refuses a Period that has not started or has already ended, without a write", async () => {
    const { store, calls } = fakeStore([
      record({ id: "future", start_on: "2026-11-11" }),
      record({ id: "ended", end_on: "2026-11-09" }),
      record({ id: "ends-today", end_on: "2026-11-10" }),
    ]);
    await expect(endPeriod(store, { id: "future", expectedRevision: 1, today: "2026-11-10" })).rejects.toThrow(PERIOD_MESSAGES.endNotStarted);
    await expect(endPeriod(store, { id: "ended", expectedRevision: 1, today: "2026-11-10" })).rejects.toThrow(PERIOD_MESSAGES.endAlreadyEnded);
    await expect(endPeriod(store, { id: "ends-today", expectedRevision: 1, today: "2026-11-10" })).rejects.toThrow(PERIOD_MESSAGES.endAlreadyEnded);
    expect(calls).not.toContain("update");
  });

  it("reports a conflict for a stale revision, a missing Period or a lost race", async () => {
    const { store } = fakeStore([record({ revision: 2 })]);
    await expect(endPeriod(store, { id: "period-1", expectedRevision: 1, today: "2026-11-10" })).rejects.toThrow(PERIOD_CONFLICT_MESSAGE);
    await expect(endPeriod(store, { id: "gone", expectedRevision: 1, today: "2026-11-10" })).rejects.toThrow(PERIOD_CONFLICT_MESSAGE);
    const racing: PeriodDataStore = { ...store, updatePeriod: async () => null };
    await expect(endPeriod(racing, { id: "period-1", expectedRevision: 2, today: "2026-11-10" })).rejects.toThrow(PERIOD_CONFLICT_MESSAGE);
  });

  it("needs a valid today", async () => {
    const { store, calls } = fakeStore([record()]);
    await expect(endPeriod(store, { id: "period-1", expectedRevision: 1, today: "today" })).rejects.toThrow(PERIOD_MESSAGES.dateInvalid);
    expect(calls).toEqual([]);
  });
});

describe("deletePeriod", () => {
  it("removes the Period and returns its id", async () => {
    const { store, rows } = fakeStore([record()]);
    await expect(deletePeriod(store, { id: "period-1", expectedRevision: "1" })).resolves.toEqual({ id: "period-1" });
    expect(rows.size).toBe(0);
  });

  it("turns a stale revision or a missing Period into the conflict message", async () => {
    const { store, rows } = fakeStore([record({ revision: 2 })]);
    await expect(deletePeriod(store, { id: "period-1", expectedRevision: 1 })).rejects.toThrow(PERIOD_CONFLICT_MESSAGE);
    await expect(deletePeriod(store, { id: "gone", expectedRevision: 1 })).rejects.toThrow(PERIOD_CONFLICT_MESSAGE);
    expect(rows.size).toBe(1);
    await expect(deletePeriod(store, { id: "period-1", expectedRevision: undefined })).rejects.toThrow(PERIOD_MESSAGES.revisionInvalid);
  });
});

describe("listPeriods", () => {
  const seed = [
    record({ id: "a", start_on: "2026-10-01", end_on: "2026-10-05" }),
    record({ id: "b", start_on: "2026-11-03", end_on: null }),
    record({ id: "c", start_on: "2026-11-03", end_on: "2026-11-04" }),
    record({ id: "d", start_on: "2026-12-01", end_on: null }),
  ];

  it("returns every Period in display order when no range is given", async () => {
    const { store, calls } = fakeStore(seed);
    expect((await listPeriods(store)).map((row) => row.id)).toEqual(["a", "c", "b", "d"]);
    expect(calls).toEqual(["list"]);
  });

  it("filters to the range even when the store returns more", async () => {
    const { store, calls } = fakeStore(seed);
    expect((await listPeriods(store, { from: "2026-11-01", to: "2026-11-30" })).map((row) => row.id)).toEqual(["c", "b"]);
    expect(calls).toEqual(["list:2026-11-01:2026-11-30"]);
  });

  it("limits a range to 366 days unless the caller lifts the limit", async () => {
    const { store, calls } = fakeStore(seed);
    await expect(listPeriods(store, { from: "2025-01-01", to: "2026-12-31" })).rejects.toThrow(PERIOD_MESSAGES.rangeTooLong);
    expect(calls).toEqual([]);
    expect(await listPeriods(store, { from: "2025-01-01", to: "2026-12-31" }, { maxDays: null })).toHaveLength(4);
  });
});
