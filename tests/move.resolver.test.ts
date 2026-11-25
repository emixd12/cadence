import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { MOVE_REFUSAL_REASON_VALUES } from "@cadence/core/integration";
import {
  DEFAULT_MOVE_SECONDS,
  MOVE_REFUSAL_MESSAGES,
  MOVE_REFUSAL_REASONS,
  checkMoveSlot,
  findMoveConflicts,
  loggedAverageSeconds,
  moveAlternatives,
  resolveLoggedLength,
  resolveMoveDuration,
} from "@cadence/core/resolvers/move.resolver";

const at = (value: string) => Temporal.Instant.from(value);
const span = (start: string, end: string) => ({ start: at(start), end: at(end) });

describe("resolveMoveDuration", () => {
  it("prefers the Behavior's duration, then the logged average, then the planned length", () => {
    expect(resolveMoveDuration({ behaviorDefaultMinutes: 45, loggedAverageSeconds: 600, plannedSeconds: 900 }))
      .toEqual({ seconds: 2700, source: "behavior_duration" });
    expect(resolveMoveDuration({ behaviorDefaultMinutes: null, loggedAverageSeconds: 600.4, plannedSeconds: 900 }))
      .toEqual({ seconds: 600, source: "logged_average" });
    expect(resolveMoveDuration({ behaviorDefaultMinutes: null, loggedAverageSeconds: null, plannedSeconds: 900 }))
      .toEqual({ seconds: 900, source: "planned_length" });
    expect(resolveMoveDuration({ behaviorDefaultMinutes: 0, loggedAverageSeconds: 30, plannedSeconds: null }))
      .toEqual({ seconds: DEFAULT_MOVE_SECONDS, source: "planned_length" });
  });

  it("caps a logged average at one day", () => {
    expect(resolveMoveDuration({ behaviorDefaultMinutes: null, loggedAverageSeconds: 200_000, plannedSeconds: null }).seconds).toBe(86_400);
  });
});

describe("loggedAverageSeconds", () => {
  it("takes the median of finished sessions between one minute and one day", () => {
    const sessions = [
      { started_at: "2026-11-16T10:00:00Z", stopped_at: "2026-11-16T10:20:00Z" },
      { started_at: "2026-11-15T10:00:00Z", stopped_at: "2026-11-15T10:40:00Z" },
      { started_at: "2026-11-14T10:00:00Z", stopped_at: "2026-11-14T10:00:30Z" },
      { started_at: "2026-11-13T10:00:00Z", stopped_at: null },
    ];
    expect(loggedAverageSeconds(sessions)).toBe(1800);
    expect(loggedAverageSeconds(sessions.slice(0, 1))).toBe(1200);
    expect(loggedAverageSeconds(sessions.slice(2))).toBeNull();
  });

  it("uses the 10 most recent sessions, whatever order they arrive in, so one long session does not move the figure", () => {
    const day = (index: number, minutes: number) => ({
      started_at: `2026-11-${String(index).padStart(2, "0")}T10:00:00Z`,
      stopped_at: `2026-11-${String(index).padStart(2, "0")}T${String(10 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00Z`,
    });
    // Days 1 and 2 are older than the 10 most recent and are left out.
    const sessions = [day(1, 5), day(2, 5), ...Array.from({ length: 9 }, (_, index) => day(index + 3, 20)), day(12, 600)];
    expect(resolveLoggedLength([...sessions].reverse())).toEqual({ seconds: 1200, sampleCount: 10 });
    expect(resolveLoggedLength(sessions)).toEqual({ seconds: 1200, sampleCount: 10 });
  });
});

describe("resolveMoveDuration with a sample count (Ticket 366)", () => {
  it("lets the logged figure outrank the intended duration from 3 samples only", () => {
    const input = { behaviorDefaultMinutes: 45, loggedAverageSeconds: 600, plannedSeconds: 900 };
    expect(resolveMoveDuration({ ...input, loggedSampleCount: 2 })).toEqual({ seconds: 2700, source: "behavior_duration" });
    expect(resolveMoveDuration({ ...input, loggedSampleCount: 3 })).toEqual({ seconds: 600, source: "logged_average" });
    expect(resolveMoveDuration({ ...input, loggedAverageSeconds: 30, loggedSampleCount: 5 })).toEqual({ seconds: 2700, source: "behavior_duration" });
  });
});

describe("checkMoveSlot", () => {
  const interval = span("2026-11-16T15:00:00Z", "2026-11-16T15:30:00Z");

  it("refuses a slot another Occurrence holds, ignoring the moved one itself", () => {
    const others = [
      { occurrenceId: "self", ...span("2026-11-16T15:00:00Z", "2026-11-16T15:30:00Z") },
      { occurrenceId: "other", ...span("2026-11-16T15:20:00Z", "2026-11-16T16:00:00Z") },
    ];
    expect(checkMoveSlot({ occurrenceId: "self", interval, others })).toEqual({ ok: false, reason: "slot_taken", occurrenceId: "other" });
  });

  it("treats an item without a length as its start instant", () => {
    const inside = [{ occurrenceId: "pill", ...span("2026-11-16T15:10:00Z", "2026-11-16T15:10:00Z") }];
    const atEnd = [{ occurrenceId: "pill", ...span("2026-11-16T15:30:00Z", "2026-11-16T15:30:00Z") }];
    expect(checkMoveSlot({ occurrenceId: "self", interval, others: inside }).ok).toBe(false);
    expect(checkMoveSlot({ occurrenceId: "self", interval, others: atEnd }).ok).toBe(true);
  });

  it("checks calendar events only when the caller has them", () => {
    const calendarBusy = [{ ...span("2026-11-16T14:45:00Z", "2026-11-16T15:05:00Z"), ref: "event-1" }];
    expect(checkMoveSlot({ occurrenceId: "self", interval, others: [], calendarBusy })).toEqual({ ok: false, reason: "calendar_busy", ref: "event-1" });
    expect(checkMoveSlot({ occurrenceId: "self", interval, others: [] })).toEqual({ ok: true });
  });

  it("lets back-to-back items touch", () => {
    const others = [{ occurrenceId: "before", ...span("2026-11-16T14:30:00Z", "2026-11-16T15:00:00Z") }];
    expect(checkMoveSlot({ occurrenceId: "self", interval, others })).toEqual({ ok: true });
  });
});

describe("findMoveConflicts", () => {
  it("reports each moved, Unresolved Occurrence that now overlaps another, earliest collision first", () => {
    const conflicts = findMoveConflicts([
      { id: "moved", status: "unresolved", moved: true, interval: span("2026-11-16T15:00:00Z", "2026-11-16T16:00:00Z") },
      { id: "late", status: "unresolved", moved: false, interval: span("2026-11-16T15:30:00Z", "2026-11-16T15:45:00Z") },
      { id: "early", status: "unresolved", moved: false, interval: span("2026-11-16T15:10:00Z", "2026-11-16T15:20:00Z") },
      { id: "done", status: "completed", moved: false, interval: span("2026-11-16T15:00:00Z", "2026-11-16T15:05:00Z") },
      { id: "moved-free", status: "unresolved", moved: true, interval: span("2026-11-16T18:00:00Z", "2026-11-16T18:30:00Z") },
    ]);
    expect(conflicts).toEqual([{ occurrence_id: "moved", conflicting_occurrence_id: "early" }]);
  });
});

describe("moveAlternatives", () => {
  const base = {
    localDate: "2026-11-16",
    timezone: "America/New_York",
    durationSeconds: 1800,
  };

  it("offers up to three free starts today, nearest the request, one per free gap", () => {
    const options = moveAlternatives({
      ...base,
      requestedStart: at("2026-11-16T15:00:00Z"), // 10:00 local
      now: at("2026-11-16T13:02:00Z"),
      blocks: [
        span("2026-11-16T14:00:00Z", "2026-11-16T16:00:00Z"), // 9:00-11:00 busy
        span("2026-11-16T16:30:00Z", "2026-11-16T17:00:00Z"), // 11:30-12:00 busy
      ],
    });
    expect(options.map((value) => value.toString())).toEqual([
      "2026-11-16T13:30:00Z", // 8:30, the last start that fits before 9:00
      "2026-11-16T16:00:00Z", // 11:00, the gap between the blocks
      "2026-11-16T17:00:00Z", // 12:00
    ]);
  });

  it("never offers a time before now, and rounds up to five minutes", () => {
    const options = moveAlternatives({
      ...base, requestedStart: at("2026-11-16T13:00:00Z"), now: at("2026-11-16T13:02:00Z"), blocks: [], limit: 1,
    });
    expect(options.map((value) => value.toString())).toEqual(["2026-11-16T13:05:00Z"]);
  });

  it("offers nothing when the day has no room left", () => {
    expect(moveAlternatives({
      ...base, requestedStart: at("2026-11-17T04:50:00Z"), now: at("2026-11-17T04:59:00Z"),
      blocks: [span("2026-11-17T04:59:00Z", "2026-11-17T06:00:00Z")],
    })).toEqual([]);
  });

  it("uses the local day's real length across a daylight-saving change", () => {
    const options = moveAlternatives({
      ...base, localDate: "2026-11-01", durationSeconds: 300,
      requestedStart: at("2026-11-02T05:30:00Z"), now: at("2026-11-02T04:50:00Z"), blocks: [],
    });
    // 23:55 local (EST) is the last start of the 25-hour day; a 24-hour day would end at 04:00Z.
    expect(options.at(-1)?.toString()).toBe("2026-11-02T04:55:00Z");
  });
});

describe("refusal wording", () => {
  it("has plain text for every reason, and the MCP contract lists the same reasons", () => {
    for (const reason of MOVE_REFUSAL_REASONS) expect(MOVE_REFUSAL_MESSAGES[reason].length).toBeGreaterThan(10);
    expect([...MOVE_REFUSAL_REASON_VALUES].sort())
      .toEqual(MOVE_REFUSAL_REASONS.filter((reason) => reason !== "occurrence_not_found").sort());
  });
});
