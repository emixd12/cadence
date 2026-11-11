import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it, vi } from "vitest";

import type { DayNoteRecord } from "@cadence/core/resolvers/day-note.resolver";
import { applyBehaviorLogDayNotes } from "@cadence/core/services/behaviorlog-day-note.service";
import { resolveExportBundle } from "../lib/resolvers/export.resolver";

type Request = { operation: string; profileId: string; [key: string]: unknown };
const native = vi.hoisted(() => ({ requests: [] as Request[], rows: new Map<string, DayNoteRecord>() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async (command: string, args: { request: Request }) => {
    if (command !== "local_store") throw new Error(`Unexpected native command: ${command}`);
    const request = args.request;
    native.requests.push(request);
    if (request.operation === "readDayNotes") {
      return [...native.rows.values()].filter((row) => row.local_date >= String(request.startLocalDate) && row.local_date <= String(request.endLocalDate));
    }
    if (request.operation === "saveDayNote") {
      const stored = native.rows.get(String(request.localDate));
      if ((stored?.note ?? null) !== request.expectedNote) return null;
      const row: DayNoteRecord = {
        id: stored?.id ?? String(request.newId), user_id: request.profileId, local_date: String(request.localDate),
        note: request.note as string | null, revision: (stored?.revision ?? 0) + 1,
        created_at: stored?.created_at ?? String(request.now), updated_at: String(request.now),
      };
      native.rows.set(row.local_date, row);
      return row;
    }
    throw new Error(`Unexpected operation: ${request.operation}`);
  },
}));

import { createLocalDayNoteStore } from "../apps/desktop/src/local-day-note.service";

const NOW = Temporal.Instant.from("2026-06-10T16:00:00Z");

describe("Mac app day-note restore through the local store", () => {
  it("restores exported day notes with compare-and-set native saves", async () => {
    const bundle = resolveExportBundle({
      profile: { timezone: "America/New_York", subjectId: "subject_test", producerName: "Cadence for Mac", producerVersion: "0.1.0" },
      categories: [], behaviors: [], occurrences: [], now: NOW, timezone: "America/New_York", range: "all", includeNotes: true,
      dayNotes: [
        { id: "60000000-0000-4000-8000-000000000001", localDate: "2026-06-07", note: "Sick", createdAt: "2026-06-07T12:00:00Z", updatedAt: "2026-06-07T12:00:00Z" },
        { id: "60000000-0000-4000-8000-000000000002", localDate: "2026-06-08", note: "Travel day", createdAt: "2026-06-08T12:00:00Z", updatedAt: "2026-06-08T12:00:00Z" },
      ],
    });
    native.rows.set("2026-06-07", { id: "local-1", user_id: "profile-1", local_date: "2026-06-07", note: "Changed", revision: 1, created_at: NOW.toString(), updated_at: NOW.toString() });

    const outcome = await applyBehaviorLogDayNotes(createLocalDayNoteStore("profile-1", NOW), bundle.behaviorLog.files, "restore");

    expect(outcome).toMatchObject({ saved: { create: 1, replace: 1 }, conflictDates: [], failedDates: [] });
    expect(Object.fromEntries([...native.rows.values()].map((row) => [row.local_date, row.note]))).toEqual({ "2026-06-07": "Sick", "2026-06-08": "Travel day" });
    expect(native.requests[0]).toMatchObject({ operation: "readDayNotes", profileId: "profile-1", startLocalDate: "2026-06-07", endLocalDate: "2026-06-08" });
    expect(native.requests.slice(1)).toEqual([
      expect.objectContaining({ operation: "saveDayNote", localDate: "2026-06-07", expectedNote: "Changed", note: "Sick", now: NOW.toString() }),
      expect.objectContaining({ operation: "saveDayNote", localDate: "2026-06-08", expectedNote: null, note: "Travel day" }),
    ]);
  });
});
