import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import {
  currentInstant,
  effectiveStartAt,
  effectiveStartInstant,
  fixedClock,
  isOnLocalDate,
  localDateAt,
  localDayBounds,
  todayIn,
  zonedInstant,
} from "@cadence/core/resolvers/time.resolver";
import { systemClock } from "@/lib/services/clock";

const NEW_YORK = "America/New_York";
const TOKYO = "Asia/Tokyo";

describe("time helper: now and today", () => {
  it("returns the injected instant from a fixed clock", () => {
    const clock = fixedClock("2026-11-16T12:00:00Z");
    expect(currentInstant(clock).toString()).toBe("2026-11-16T12:00:00Z");
    expect(currentInstant(clock).equals(currentInstant(clock))).toBe(true);
  });

  it("gives today's date in the requested timezone, not the server's", () => {
    // 03:30 UTC is still the previous evening in New York and already morning in Tokyo.
    const clock = fixedClock("2026-11-17T03:30:00Z");
    expect(todayIn(clock, NEW_YORK)).toBe("2026-11-16");
    expect(todayIn(clock, TOKYO)).toBe("2026-11-17");
    expect(todayIn(clock, "UTC")).toBe("2026-11-17");
  });

  it("turns over at local midnight", () => {
    expect(localDateAt("2026-11-17T04:59:59Z", NEW_YORK)).toBe("2026-11-16");
    expect(localDateAt("2026-11-17T05:00:00Z", NEW_YORK)).toBe("2026-11-17");
  });

  it("reads the system clock only through the web runtime's clock", () => {
    const before = Temporal.Now.instant();
    const now = currentInstant(systemClock);
    expect(Temporal.Instant.compare(now, before)).toBeGreaterThanOrEqual(0);
  });
});

describe("time helper: local day bounds", () => {
  it("spans 24 hours on an ordinary day", () => {
    const { start, end } = localDayBounds("2026-11-16", NEW_YORK);
    expect(start.toString()).toBe("2026-11-16T05:00:00Z");
    expect(end.toString()).toBe("2026-11-17T05:00:00Z");
  });

  it("spans 23 hours on the spring-forward day", () => {
    const { start, end } = localDayBounds("2026-03-08", NEW_YORK);
    expect(start.until(end).total({ unit: "hours" })).toBe(23);
  });

  it("spans 25 hours on the fall-back day", () => {
    const { start, end } = localDayBounds("2026-11-01", NEW_YORK);
    expect(start.until(end).total({ unit: "hours" })).toBe(25);
  });

  it("treats the day as half-open", () => {
    const { start, end } = localDayBounds("2026-11-16", NEW_YORK);
    expect(isOnLocalDate(start, "2026-11-16", NEW_YORK)).toBe(true);
    expect(isOnLocalDate(end, "2026-11-16", NEW_YORK)).toBe(false);
    expect(isOnLocalDate(end, "2026-11-17", NEW_YORK)).toBe(true);
  });
});

describe("time helper: wall-clock times use the compatible DST rule", () => {
  it("moves a skipped spring-forward time to the next valid time", () => {
    // 02:30 does not exist in New York on 2026-03-08; it becomes 03:30 EDT.
    expect(zonedInstant("2026-03-08", "02:30", NEW_YORK).toString()).toBe("2026-03-08T07:30:00Z");
  });

  it("takes the earlier instant for a repeated fall-back time", () => {
    // 01:30 happens twice in New York on 2026-11-01; the first is EDT (UTC-4).
    expect(zonedInstant("2026-11-01", "01:30", NEW_YORK).toString()).toBe("2026-11-01T05:30:00Z");
  });

  it("places an ordinary time in the zone", () => {
    expect(zonedInstant("2026-11-16", "09:00", TOKYO).toString()).toBe("2026-11-16T00:00:00Z");
  });
});

describe("time helper: effective time", () => {
  it("is the planned time until moves exist", () => {
    const occurrence = { scheduled_for: "2026-11-16T14:00:00.000Z" };
    expect(effectiveStartAt(occurrence)).toBe("2026-11-16T14:00:00.000Z");
    expect(effectiveStartInstant(occurrence).toString()).toBe("2026-11-16T14:00:00Z");
  });
});
