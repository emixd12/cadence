import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  behaviorEndInstant, behaviorPauseInterval, behaviorRunNotice, behaviorRunState, earliestStoppedLocalDate,
  isStoppedByRunFields, normalizeRunTime, plannedRangeEnd, reexpressPastStops, runFieldsFromStored,
  type BehaviorRunFields,
} from "../packages/core/src/resolvers/behavior-run.resolver";

const NY = "America/New_York";
const at = (value: string) => Temporal.Instant.from(value);
const fields = (overrides: Partial<BehaviorRunFields> = {}): BehaviorRunFields => ({
  active: true, timezone: NY, endOn: null, endTime: null,
  pauseFromOn: null, pauseFromTime: null, pauseBackOn: null, ...overrides,
});

describe("behaviorRunState", () => {
  it("stops at the end of the last day, or at its end time", () => {
    const allDay = fields({ endOn: "2026-11-20" });
    expect(behaviorEndInstant(allDay)?.toString()).toBe("2026-11-21T05:00:00Z");
    expect(behaviorRunState(allDay, at("2026-11-21T04:59:00Z")).state).toBe("running");
    expect(behaviorRunState(allDay, at("2026-11-21T05:00:00Z")).state).toBe("ended");
    const timed = fields({ endOn: "2026-11-20", endTime: "20:00:00" });
    expect(behaviorRunState(timed, at("2026-11-21T00:59:00Z")).state).toBe("running");
    expect(behaviorRunState(timed, at("2026-11-21T01:00:00Z"))).toMatchObject({ state: "ended", endsAt: "2026-11-21T01:00:00Z" });
  });

  it("pauses from the start until the back-on day and reports the pause ahead", () => {
    const paused = fields({ pauseFromOn: "2026-11-21", pauseFromTime: "18:30:00", pauseBackOn: "2026-11-24" });
    expect(behaviorRunState(paused, at("2026-11-21T23:00:00Z"))).toMatchObject({
      state: "running", pauseStartsAt: "2026-11-21T23:30:00Z", backOn: "2026-11-24",
    });
    expect(behaviorRunState(paused, at("2026-11-21T23:30:00Z")).state).toBe("paused");
    expect(behaviorRunState(paused, at("2026-11-24T05:00:00Z"))).toMatchObject({ state: "running", pauseStartsAt: null, backOn: null });
  });

  it("archive wins, and an end that has passed wins over a pause", () => {
    const both = fields({ endOn: "2026-11-20", pauseFromOn: "2026-11-19", pauseBackOn: "2026-11-25" });
    expect(behaviorRunState(both, at("2026-11-22T12:00:00Z")).state).toBe("ended");
    expect(behaviorRunState({ ...both, active: false }, at("2026-11-22T12:00:00Z")).state).toBe("archived");
  });

  it("uses the compatible rule for a repeated or skipped local time", () => {
    expect(behaviorEndInstant(fields({ endOn: "2026-11-01", endTime: "01:30:00" }))?.toString()).toBe("2026-11-01T05:30:00Z");
    expect(behaviorEndInstant(fields({ endOn: "2026-03-08", endTime: "02:30:00" }))?.toString()).toBe("2026-03-08T07:30:00Z");
    expect(behaviorPauseInterval(fields({ timezone: "America/Havana", pauseFromOn: "2026-03-08", pauseBackOn: "2026-03-09" }))?.start.toString())
      .toBe("2026-03-08T05:00:00Z");
  });
});

describe("isStoppedByRunFields (rule T4)", () => {
  const end = fields({ endOn: "2026-11-20", endTime: "20:00:00" });
  it("stops an exact time at or after the end and a window still open at it", () => {
    expect(isStoppedByRunFields(end, { startsAt: at("2026-11-21T01:00:00Z"), endsAt: null })).toBe(true);
    expect(isStoppedByRunFields(end, { startsAt: at("2026-11-21T00:59:00Z"), endsAt: null })).toBe(false);
    const evening = plannedRangeEnd("2026-11-20", "17:00", "21:00", NY);
    expect(isStoppedByRunFields(end, { startsAt: at("2026-11-20T22:00:00Z"), endsAt: evening })).toBe(true);
    const afternoon = plannedRangeEnd("2026-11-20", "12:00", "17:00", NY);
    expect(isStoppedByRunFields(end, { startsAt: at("2026-11-20T17:00:00Z"), endsAt: afternoon })).toBe(false);
  });

  it("stops times inside the pause and a window overlapping its start", () => {
    const pause = fields({ pauseFromOn: "2026-11-21", pauseFromTime: "18:00:00", pauseBackOn: "2026-11-24" });
    expect(isStoppedByRunFields(pause, { startsAt: at("2026-11-22T14:00:00Z"), endsAt: null })).toBe(true);
    expect(isStoppedByRunFields(pause, { startsAt: at("2026-11-24T14:00:00Z"), endsAt: null })).toBe(false);
    expect(isStoppedByRunFields(pause, { startsAt: at("2026-11-21T22:00:00Z"), endsAt: plannedRangeEnd("2026-11-21", "17:00", "21:00", NY) })).toBe(true);
    expect(isStoppedByRunFields(pause, { startsAt: at("2026-11-21T17:00:00Z"), endsAt: plannedRangeEnd("2026-11-21", "12:00", "17:00", NY) })).toBe(false);
  });

  it("ends an overnight window on the next day", () => {
    expect(plannedRangeEnd("2026-11-20", "22:00", "02:00", NY).toString()).toBe("2026-11-21T07:00:00Z");
  });
});

describe("timezone changes (rule T1)", () => {
  it("re-expresses an end and a pause start that already happened, and keeps ones ahead", () => {
    const now = at("2026-11-22T12:00:00Z");
    const past = fields({ endOn: "2026-11-20", endTime: "20:00:00", pauseFromOn: "2026-11-21", pauseBackOn: "2026-11-30" });
    expect(reexpressPastStops(past, "America/Los_Angeles", now)).toEqual({
      endOn: "2026-11-20", endTime: "17:00:00", pauseFromOn: "2026-11-20", pauseFromTime: "21:00:00",
    });
    const ahead = fields({ endOn: "2026-12-20", endTime: "20:00:00" });
    expect(reexpressPastStops(ahead, "America/Los_Angeles", now)).toMatchObject({ endOn: "2026-12-20", endTime: "20:00:00" });
  });

  it("reads a past stop at local midnight as the end of the previous day", () => {
    const now = at("2026-11-22T12:00:00Z");
    const past = fields({ endOn: "2026-11-20", endTime: "21:00:00" });
    expect(reexpressPastStops(past, "Europe/London", now)).toMatchObject({ endOn: "2026-11-21", endTime: "02:00:00" });
    expect(reexpressPastStops(fields({ endOn: "2026-11-20", endTime: "19:00:00" }), "Europe/London", now))
      .toMatchObject({ endOn: "2026-11-20", endTime: null });
  });
});

describe("behaviorRunNotice (rule T7)", () => {
  it("shows ended on the day the end arrives, paused on the first paused day, and back on the back-on day", () => {
    const ended = fields({ endOn: "2026-11-20", endTime: "20:00:00" });
    expect(behaviorRunNotice(ended, at("2026-11-21T02:00:00Z"))).toEqual({ kind: "ended", backOn: null });
    expect(behaviorRunNotice(ended, at("2026-11-21T12:00:00Z"))).toBeNull();
    const pause = fields({ pauseFromOn: "2026-11-21", pauseBackOn: "2026-11-24" });
    expect(behaviorRunNotice(pause, at("2026-11-21T15:00:00Z"))).toEqual({ kind: "paused", backOn: "2026-11-24" });
    expect(behaviorRunNotice(pause, at("2026-11-22T15:00:00Z"))).toBeNull();
    expect(behaviorRunNotice(pause, at("2026-11-24T15:00:00Z"))).toEqual({ kind: "back", backOn: "2026-11-24" });
    expect(behaviorRunNotice({ ...pause, active: false }, at("2026-11-21T15:00:00Z"))).toBeNull();
  });
});

describe("stored fields", () => {
  it("normalizes stored times and finds the earliest day a stop may remove rows", () => {
    expect(runFieldsFromStored({ active: true, timezone: NY, end_on: "2026-11-20", end_time: "20:00", pause_from_on: "2026-11-18", pause_back_on: "2026-11-19" }))
      .toMatchObject({ endTime: "20:00:00", pauseFromOn: "2026-11-18" });
    expect(earliestStoppedLocalDate(fields({ endOn: "2026-11-20", pauseFromOn: "2026-11-18", pauseBackOn: "2026-11-19" }))).toBe("2026-11-18");
    expect(earliestStoppedLocalDate(fields())).toBeNull();
    expect(normalizeRunTime("07:05")).toBe("07:05:00");
    expect(() => normalizeRunTime("25:00")).toThrow();
  });
});
