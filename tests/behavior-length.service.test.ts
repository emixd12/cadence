import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listTimeSessionHistory = vi.fn();
const listOccurrencesByIds = vi.fn();
vi.mock("@/lib/db/timeSessions.repo", () => ({ listTimeSessionHistory: (...args: unknown[]) => listTimeSessionHistory(...args) }));
vi.mock("@/lib/db/occurrences.repo", () => ({ listOccurrencesByIds: (...args: unknown[]) => listOccurrencesByIds(...args) }));

import { briefMoveLengthFromEstimate } from "@cadence/core/resolvers/brief-move.resolver";
import { readBehaviorLengths } from "@/lib/services/behavior-length.service";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

const NOW = Temporal.Instant.from("2026-11-25T17:00:00Z");
const supabase = {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { timezone: "America/New_York" }, error: null }) }) }) }),
} as unknown as AppSupabaseClient;

function session(id: string, occurrenceId: string, behaviorId: string, day: string, minutes: number) {
  const start = Temporal.Instant.from(`${day}T15:00:00Z`);
  return { id, user_id: "u", occurrence_id: occurrenceId, behavior_id: behaviorId, started_at: start.toString(), stopped_at: start.add({ minutes }).toString() };
}
const occurrence = (id: string, behaviorId: string, day: string, status = "completed") =>
  ({ id, behavior_id: behaviorId, local_date: day, status });

describe("readBehaviorLengths (Ticket 366)", () => {
  beforeEach(() => { listTimeSessionHistory.mockReset(); listOccurrencesByIds.mockReset(); });

  it("counts one sample per Completed Occurrence before today, with its sessions added together", async () => {
    listTimeSessionHistory.mockResolvedValue([
      // Two sessions on one Occurrence are one 30-minute sample, not two.
      session("s1", "o1", "gym", "2026-11-20", 10), session("s2", "o1", "gym", "2026-11-20", 20),
      session("s3", "o2", "gym", "2026-11-21", 40),
      session("s4", "o3", "gym", "2026-11-22", 50),
      // Not Completed: no sample.
      session("s5", "o4", "gym", "2026-11-23", 500),
    ]);
    listOccurrencesByIds.mockResolvedValue([
      occurrence("o1", "gym", "2026-11-20"), occurrence("o2", "gym", "2026-11-21"),
      occurrence("o3", "gym", "2026-11-22"), occurrence("o4", "gym", "2026-11-23", "not_completed"),
    ]);

    const lengths = await readBehaviorLengths(supabase, { userId: "u", now: NOW, behaviors: [
      { id: "gym", defaultDurationMinutes: 60, estimateMinutes: 15 },
      { id: "read", defaultDurationMinutes: 20, estimateMinutes: 15 },
      { id: "stretch", defaultDurationMinutes: null, estimateMinutes: 15 },
      { id: "nap", defaultDurationMinutes: null },
    ] });

    expect(listTimeSessionHistory).toHaveBeenCalledWith(supabase, expect.objectContaining({ endLocalDate: "2026-11-24", startLocalDate: null }));
    // Three tracked completions outrank the 60-minute intended duration: median of 30, 40, 50.
    expect(lengths.get("gym")).toMatchObject({ seconds: 2400, sampleCount: 3, provenance: "completed_stopped_occurrence_mean", intendedSeconds: 3600 });
    expect(briefMoveLengthFromEstimate(lengths.get("gym"))).toEqual({ minutes: 40, source: "logged_average", assumed: false });
    expect(briefMoveLengthFromEstimate(lengths.get("read"))).toEqual({ minutes: 20, source: "behavior_duration", assumed: false });
    expect(briefMoveLengthFromEstimate(lengths.get("stretch"))).toEqual({ minutes: 15, source: "model_estimate", assumed: true });
    expect(briefMoveLengthFromEstimate(lengths.get("nap"))).toEqual({ minutes: 30, source: "fallback", assumed: true });
  });

  it("keeps the intended duration ahead of 2 tracked completions", async () => {
    listTimeSessionHistory.mockResolvedValue([session("s1", "o1", "gym", "2026-11-20", 30), session("s2", "o2", "gym", "2026-11-21", 40)]);
    listOccurrencesByIds.mockResolvedValue([occurrence("o1", "gym", "2026-11-20"), occurrence("o2", "gym", "2026-11-21")]);
    const lengths = await readBehaviorLengths(supabase, { userId: "u", now: NOW, behaviors: [{ id: "gym", defaultDurationMinutes: 60 }] });
    expect(briefMoveLengthFromEstimate(lengths.get("gym"))).toEqual({ minutes: 60, source: "behavior_duration", assumed: false });
  });

  it("reads nothing when no Behavior is asked for", async () => {
    expect((await readBehaviorLengths(supabase, { userId: "u", behaviors: [] })).size).toBe(0);
    expect(listTimeSessionHistory).not.toHaveBeenCalled();
  });
});
