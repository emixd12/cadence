import { Temporal } from "@js-temporal/polyfill";

import type { PeriodDataStore } from "@cadence/core/data-store";
import { PERIOD_LIMITS, periodNaturalKey, type PeriodRecord } from "@cadence/core/resolvers/period.resolver";
import { assembleExportBundle, type ExportAssemblyInput } from "@cadence/core/services/export-assembly";
import { PERIOD_LIMIT_MESSAGE } from "@cadence/core/services/period.service";

import { USER_ID, storedBehavior, storedConfigurationEvent, storedExportOccurrence } from "./export-row-fixture";
import { PORTABILITY_NOW } from "./portability-fixture";

export type Row = Record<string, unknown>;
export type Files = { path: string; content: string }[];

/** PORTABILITY_NOW is June 8, 2026 in America/New_York. */
export const EXPORT_TODAY = "2026-06-08";

export function period(overrides: Partial<PeriodRecord> = {}): PeriodRecord {
  return {
    id: "70000000-0000-4000-8000-000000000001", user_id: USER_ID, label: "Sick", start_on: "2026-06-01", end_on: "2026-06-03",
    note: null, revision: 1, created_at: "2026-06-01T12:00:00Z", updated_at: "2026-06-01T12:00:00Z", ...overrides,
  };
}

export function exportInput(periods: PeriodRecord[] | undefined, extra: Partial<ExportAssemblyInput> = {}): ExportAssemblyInput {
  return {
    userId: USER_ID, timezone: "America/New_York", now: Temporal.Instant.from(PORTABILITY_NOW), range: "all",
    includeNotes: true, includeTimeTracking: true,
    categories: [], behaviors: [storedBehavior()], behaviorDefinitionEvents: [], behaviorConfigurationEvents: [storedConfigurationEvent()],
    occurrences: [storedExportOccurrence()], statusEvents: [], reminderDeliveries: [], timeSessions: [],
    ...(periods === undefined ? {} : { periods }), ...extra,
  } as unknown as ExportAssemblyInput;
}

export function exportBundle(periods: PeriodRecord[] | undefined, extra: Partial<ExportAssemblyInput> = {}) {
  return assembleExportBundle(exportInput(periods, extra));
}

/** Every exported byte: Full JSON, JSONL, CSV, Markdown and the BehaviorLog files. */
export function exportBytes(bundle: ReturnType<typeof assembleExportBundle>): string {
  return JSON.stringify([bundle.json, bundle.jsonl, bundle.csv, bundle.markdownSummary, bundle.behaviorLog.files.map((file) => [file.path, file.content])]);
}

export function reviews(files: Files): Row[] {
  const text = files.find((entry) => entry.path === "data/reviews.jsonl")?.content.trim();
  return text ? text.split("\n").map((line) => JSON.parse(line) as Row) : [];
}

export const cadenceExtension = (row: Row) => (row.extensions as Record<string, Row>)["app.cadence"]!;

/** A `data/reviews.jsonl` file built from plain records. */
export function reviewFiles(records: Row[]): Files {
  return [{ path: "data/reviews.jsonl", content: records.map((record) => JSON.stringify(record)).join("\n") + "\n" }];
}

export function periodReview(overrides: Row = {}, extension: Row = {}): Row {
  return {
    record_type: "review", review_id: "file-review-1", period_start_local_date: "2026-06-01", period_end_local_date: "2026-06-03",
    timezone: "America/New_York", created_at_utc: "2026-06-01T12:00:00Z", review_role: "user", summary_markdown: "Sick",
    extensions: { "app.cadence": { period: true, label: "Sick", ongoing: false, updated_at_utc: "2026-06-01T12:00:00Z", ...extension } },
    ...overrides,
  };
}

/**
 * An in-memory account. `createPeriod` refuses at the cap like the hosted trigger.
 * With `ifAbsent`, the store also has `createPeriodIfAbsent`, which looks and
 * inserts in one synchronous step like `public.create_period_if_absent`.
 */
export function memoryPeriodStore(initial: PeriodRecord[] = [], options: { limit?: number; ifAbsent?: boolean } = {}) {
  const rows = initial.map((row) => ({ ...row }));
  const limit = options.limit ?? PERIOD_LIMITS.perAccount;
  let next = 1;
  const calls = { create: 0, update: 0, createIfAbsent: 0 };
  const insert = (input: Parameters<PeriodDataStore["createPeriod"]>[0]): PeriodRecord => {
    if (rows.length >= limit) throw new Error(PERIOD_LIMIT_MESSAGE);
    const row = period({
      id: `local-${String(next++).padStart(4, "0")}`, label: input.label, start_on: input.startOn, end_on: input.endOn, note: input.note,
      created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z",
    });
    rows.push(row);
    return { ...row };
  };
  const store: PeriodDataStore = {
    async listPeriods() { return rows.map((row) => ({ ...row })); },
    async getPeriod(id) { return rows.find((row) => row.id === id) ?? null; },
    async createPeriod(input) {
      calls.create++;
      return insert(input);
    },
    ...(options.ifAbsent ? {
      async createPeriodIfAbsent(input: Parameters<PeriodDataStore["createPeriod"]>[0]) {
        calls.createIfAbsent++;
        const key = periodNaturalKey({ label: input.label, start_on: input.startOn, end_on: input.endOn });
        const match = rows.find((row) => periodNaturalKey(row) === key);
        return match ? { period: { ...match }, created: false } : { period: insert(input), created: true };
      },
    } : {}),
    async updatePeriod(input) {
      calls.update++;
      const row = rows.find((entry) => entry.id === input.id);
      if (!row || row.revision !== input.expectedRevision) return null;
      Object.assign(row, { label: input.label, start_on: input.startOn, end_on: input.endOn, note: input.note, revision: row.revision + 1 });
      return { ...row };
    },
    async deletePeriod() { throw new Error("Import and restore never remove a Period."); },
  };
  return { store, rows, calls };
}
