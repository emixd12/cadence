import { describe, expect, it } from "vitest";

import { resolveAdherenceCounts } from "@cadence/core/resolvers/analytics.resolver";
import {
  BRIEF_PERIOD_LIMITS,
  PERIOD_LIMITS,
  PERIOD_MESSAGES,
  TIP_PERIOD_LIMITS,
  activePeriods,
  briefPeriodRange,
  resolveBriefPeriods,
  resolveTipPeriods,
  tipPeriodRange,
  comparePeriods,
  normalizePeriodLabel,
  normalizePeriodNote,
  parsePeriodLocalDate,
  periodCoveredDates,
  periodCoversDate,
  periodLabelSuggestions,
  periodNaturalKey,
  periodRangeLabel,
  periodsByDate,
  periodsOverlappingRange,
  resolvePeriodCreate,
  resolvePeriodEnd,
  resolvePeriodEndState,
  resolvePeriodRange,
  resolvePeriodRevision,
  resolvePeriodUpdate,
  splitByPeriods,
  type PeriodRecord,
} from "@cadence/core/resolvers/period.resolver";
import * as compatibility from "@/lib/resolvers/period.resolver";

let sequence = 0;
function period(overrides: Partial<PeriodRecord> = {}): PeriodRecord {
  sequence += 1;
  return {
    id: `50000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    user_id: "user-1",
    label: "Sick",
    start_on: "2026-11-03",
    end_on: "2026-11-09",
    note: null,
    revision: 1,
    created_at: "2026-11-03T12:00:00Z",
    updated_at: "2026-11-03T12:00:00Z",
    ...overrides,
  };
}

describe("period limits", () => {
  it("names the four limits and re-exports the resolver for web callers", () => {
    expect(PERIOD_LIMITS).toEqual({ labelCharacters: 60, noteCharacters: 2000, perAccount: 500, rangeDays: 366 });
    expect(compatibility.resolvePeriodCreate).toBe(resolvePeriodCreate);
  });
});

describe("period label", () => {
  it("trims Unicode whitespace from both ends and keeps inner spaces", () => {
    expect(normalizePeriodLabel("  Sick  ")).toBe("Sick");
    expect(normalizePeriodLabel("\u00a0\u2003Work trip\u3000\ufeff\t")).toBe("Work trip");
    expect(normalizePeriodLabel("Exam  week")).toBe("Exam  week");
  });

  it("requires text with at least one character after trimming", () => {
    for (const value of ["", "   ", "\u00a0\u2009", "\n", null, undefined, 7, {}]) {
      expect(() => normalizePeriodLabel(value)).toThrow(PERIOD_MESSAGES.labelRequired);
    }
  });

  it("allows 60 characters, counted as code points, and refuses 61", () => {
    expect(normalizePeriodLabel("a".repeat(60))).toHaveLength(60);
    expect([...normalizePeriodLabel(` ${"🐴".repeat(60)} `)]).toHaveLength(60);
    expect(() => normalizePeriodLabel("a".repeat(61))).toThrow(PERIOD_MESSAGES.labelTooLong);
    expect(PERIOD_MESSAGES.labelTooLong).toContain("60 characters");
  });

  it("refuses a label with a line break inside it", () => {
    for (const value of ["Sick\nagain", "Sick\r\nagain", "Sick\ragain", "Sick\u2028again", "Sick\u2029again", "Sick\u0085again"]) {
      expect(() => normalizePeriodLabel(value)).toThrow(PERIOD_MESSAGES.labelOneLine);
    }
    expect(normalizePeriodLabel("Sick\n")).toBe("Sick");
  });
});

describe("period note", () => {
  it("normalizes like a day note and turns blank text into no note", () => {
    expect(normalizePeriodNote("  Fever\r\nNo run  ")).toBe("Fever\nNo run");
    expect(normalizePeriodNote(" \n ")).toBeNull();
    expect(normalizePeriodNote(null)).toBeNull();
    expect(normalizePeriodNote(undefined)).toBeNull();
  });

  it("enforces 2,000 characters on the normalized text and requires text", () => {
    expect(normalizePeriodNote(` ${"a".repeat(2000)} `)).toHaveLength(2000);
    expect(() => normalizePeriodNote("a".repeat(2001))).toThrow("2,000 characters");
    expect(() => normalizePeriodNote(12)).toThrow(PERIOD_MESSAGES.noteInvalid);
  });
});

describe("resolvePeriodCreate", () => {
  it("returns normalized fields for a finished, a single-day and an ongoing Period", () => {
    expect(resolvePeriodCreate({ label: " Sick ", startOn: "2026-11-03", endOn: "2026-11-09", note: " Flu " })).toEqual({
      label: "Sick", startOn: "2026-11-03", endOn: "2026-11-09", note: "Flu",
    });
    expect(resolvePeriodCreate({ label: "Travel", startOn: "2026-11-05", endOn: "2026-11-05" })).toEqual({
      label: "Travel", startOn: "2026-11-05", endOn: "2026-11-05", note: null,
    });
    for (const endOn of [null, undefined, ""]) {
      expect(resolvePeriodCreate({ label: "Sick", startOn: "2026-11-03", endOn }).endOn).toBeNull();
    }
  });

  it("accepts a start in the future and in the past", () => {
    expect(resolvePeriodCreate({ label: "Exams", startOn: "2027-05-01" }).startOn).toBe("2027-05-01");
    expect(resolvePeriodCreate({ label: "Injury", startOn: "2019-02-28", endOn: "2020-02-29" }).endOn).toBe("2020-02-29");
  });

  it("rejects invalid calendar dates without JavaScript Date parsing", () => {
    for (const startOn of ["2026-02-30", "2026-13-01", "2026-1-01", "2026-11-03T00:00:00Z", "", null, undefined, 20261103]) {
      expect(() => resolvePeriodCreate({ label: "Sick", startOn })).toThrow(PERIOD_MESSAGES.startInvalid);
    }
    for (const endOn of ["2026-02-30", "tomorrow", " ", 5]) {
      expect(() => resolvePeriodCreate({ label: "Sick", startOn: "2026-11-03", endOn })).toThrow(PERIOD_MESSAGES.endInvalid);
    }
  });

  it("rejects a last day before the first day", () => {
    expect(() => resolvePeriodCreate({ label: "Sick", startOn: "2026-11-03", endOn: "2026-11-02" }))
      .toThrow(PERIOD_MESSAGES.endBeforeStart);
  });

  it("reports the label before the dates and the note", () => {
    expect(() => resolvePeriodCreate({ label: "", startOn: "nope", note: 3 })).toThrow(PERIOD_MESSAGES.labelRequired);
    expect(() => resolvePeriodCreate({ label: "Sick", startOn: "2026-11-03", note: 3 })).toThrow(PERIOD_MESSAGES.noteInvalid);
  });
});

describe("resolvePeriodUpdate", () => {
  const stored = period({ id: "period-1", label: "Sick", start_on: "2026-11-03", end_on: "2026-11-09", note: "Flu", revision: 4 });

  it("changes only the keys that are present", () => {
    expect(resolvePeriodUpdate({ period: stored, expectedRevision: 4, changes: { label: " Flu " } })).toEqual({
      id: "period-1", expectedRevision: 4, label: "Flu", startOn: "2026-11-03", endOn: "2026-11-09", note: "Flu", changed: true,
    });
    expect(resolvePeriodUpdate({ period: stored, changes: { startOn: "2026-11-01", label: undefined } })).toMatchObject({
      expectedRevision: 4, label: "Sick", startOn: "2026-11-01", endOn: "2026-11-09", changed: true,
    });
  });

  it("makes the Period ongoing with a null or empty last day, and clears the note with null or blank text", () => {
    expect(resolvePeriodUpdate({ period: stored, changes: { endOn: null } }).endOn).toBeNull();
    expect(resolvePeriodUpdate({ period: stored, changes: { endOn: "" } }).endOn).toBeNull();
    expect(resolvePeriodUpdate({ period: stored, changes: { note: null } }).note).toBeNull();
    expect(resolvePeriodUpdate({ period: stored, changes: { note: "  " } }).note).toBeNull();
  });

  it("reports an unchanged write", () => {
    expect(resolvePeriodUpdate({ period: stored, changes: {} }).changed).toBe(false);
    expect(resolvePeriodUpdate({
      period: stored,
      changes: { label: " Sick ", startOn: "2026-11-03", endOn: "2026-11-09", note: "Flu\r\n" },
    }).changed).toBe(false);
  });

  it("checks the range against the stored date that is not being changed", () => {
    expect(() => resolvePeriodUpdate({ period: stored, changes: { startOn: "2026-11-10" } })).toThrow(PERIOD_MESSAGES.endBeforeStart);
    expect(() => resolvePeriodUpdate({ period: stored, changes: { endOn: "2026-11-02" } })).toThrow(PERIOD_MESSAGES.endBeforeStart);
    expect(resolvePeriodUpdate({ period: stored, changes: { startOn: "2026-11-10", endOn: "2026-11-10" } }).endOn).toBe("2026-11-10");
  });

  it("validates changed fields like a create", () => {
    expect(() => resolvePeriodUpdate({ period: stored, changes: { label: " " } })).toThrow(PERIOD_MESSAGES.labelRequired);
    expect(() => resolvePeriodUpdate({ period: stored, changes: { label: null } })).toThrow(PERIOD_MESSAGES.labelRequired);
    expect(() => resolvePeriodUpdate({ period: stored, changes: { startOn: null } })).toThrow(PERIOD_MESSAGES.startInvalid);
    expect(() => resolvePeriodUpdate({ period: stored, changes: { note: "a".repeat(2001) } })).toThrow(PERIOD_MESSAGES.noteTooLong);
  });

  it("reads the expected revision as a positive integer or its digits", () => {
    expect(resolvePeriodRevision(3)).toBe(3);
    expect(resolvePeriodRevision("12")).toBe(12);
    expect(resolvePeriodUpdate({ period: stored, expectedRevision: "2", changes: {} }).expectedRevision).toBe(2);
    for (const value of [0, -1, 1.5, "1.5", "", "abc", " 3", null, undefined, 2_147_483_648, Number.NaN]) {
      expect(() => resolvePeriodRevision(value)).toThrow(PERIOD_MESSAGES.revisionInvalid);
    }
    expect(() => resolvePeriodUpdate({ period: stored, expectedRevision: null, changes: {} })).toThrow(PERIOD_MESSAGES.revisionInvalid);
  });
});

describe("the End today rule", () => {
  const today = "2026-11-10";
  const end = (dates: { start_on: string; end_on: string | null }) =>
    resolvePeriodEnd({ period: period({ id: "period-1", revision: 2, note: "Kept", ...dates }), today });

  it("ends an ongoing Period that started before today or today", () => {
    expect(end({ start_on: "2026-11-03", end_on: null })).toEqual({
      id: "period-1", expectedRevision: 2, label: "Sick", startOn: "2026-11-03", endOn: today, note: "Kept", changed: true,
    });
    expect(end({ start_on: today, end_on: null })).toMatchObject({ startOn: today, endOn: today });
  });

  it("brings a later last day back to today", () => {
    expect(end({ start_on: "2026-11-03", end_on: "2026-11-20" }).endOn).toBe(today);
    expect(end({ start_on: today, end_on: "2026-11-11" }).endOn).toBe(today);
  });

  it("refuses a Period that has not started, ongoing or not", () => {
    expect(() => end({ start_on: "2026-11-11", end_on: null })).toThrow(PERIOD_MESSAGES.endNotStarted);
    expect(() => end({ start_on: "2026-11-11", end_on: "2026-11-20" })).toThrow(PERIOD_MESSAGES.endNotStarted);
    expect(resolvePeriodEndState({ period: { start_on: "2026-11-11", end_on: null }, today })).toBe("not_started");
  });

  it("never extends a finished Period, and treats one that ends today as ended", () => {
    expect(() => end({ start_on: "2026-11-03", end_on: "2026-11-09" })).toThrow(PERIOD_MESSAGES.endAlreadyEnded);
    expect(() => end({ start_on: "2026-11-03", end_on: today })).toThrow(PERIOD_MESSAGES.endAlreadyEnded);
    expect(() => end({ start_on: today, end_on: today })).toThrow(PERIOD_MESSAGES.endAlreadyEnded);
    expect(resolvePeriodEndState({ period: { start_on: "2026-11-03", end_on: today }, today })).toBe("already_ended");
  });

  it("reports the allowed state and takes the caller's revision", () => {
    expect(resolvePeriodEndState({ period: { start_on: "2026-11-03", end_on: null }, today })).toBe("allowed");
    expect(resolvePeriodEnd({ period: period({ end_on: null, revision: 5 }), today, expectedRevision: "5" }).expectedRevision).toBe(5);
  });

  it("needs a valid injected today", () => {
    expect(() => resolvePeriodEndState({ period: { start_on: "2026-11-03", end_on: null }, today: "2026-11-31" }))
      .toThrow(PERIOD_MESSAGES.dateInvalid);
    expect(parsePeriodLocalDate("2028-02-29")).toBe("2028-02-29");
  });
});

describe("date coverage", () => {
  const sick = { start_on: "2026-11-03", end_on: "2026-11-09" };

  it("includes both endpoints", () => {
    expect(periodCoversDate(sick, "2026-11-02")).toBe(false);
    expect(periodCoversDate(sick, "2026-11-03")).toBe(true);
    expect(periodCoversDate(sick, "2026-11-09")).toBe(true);
    expect(periodCoversDate(sick, "2026-11-10")).toBe(false);
    expect(periodCoversDate({ start_on: "2026-11-05", end_on: "2026-11-05" }, "2026-11-05")).toBe(true);
  });

  it("covers every date from the start of an ongoing Period", () => {
    const ongoing = { start_on: "2026-11-03", end_on: null };
    expect(periodCoversDate(ongoing, "2026-11-02")).toBe(false);
    expect(periodCoversDate(ongoing, "2026-11-03")).toBe(true);
    expect(periodCoversDate(ongoing, "2031-01-01")).toBe(true);
  });

  it("compares across month and year boundaries as calendar dates", () => {
    const newYear = { start_on: "2026-12-30", end_on: "2027-01-02" };
    expect(periodCoversDate(newYear, "2026-12-31")).toBe(true);
    expect(periodCoversDate(newYear, "2027-01-01")).toBe(true);
    expect(periodCoversDate(newYear, "2027-01-03")).toBe(false);
  });
});

describe("ordering", () => {
  it("orders by first day, then last day with ongoing last, then creation time, then id", () => {
    const later = period({ id: "d", start_on: "2026-11-04", end_on: "2026-11-04" });
    const ongoing = period({ id: "c", start_on: "2026-11-03", end_on: null });
    const long = period({ id: "b", start_on: "2026-11-03", end_on: "2026-11-09" });
    const short = period({ id: "a", start_on: "2026-11-03", end_on: "2026-11-05" });
    expect([later, ongoing, long, short].sort(comparePeriods).map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps Periods with equal dates in a stable order", () => {
    const second = period({ id: "b", created_at: "2026-11-03T12:00:01Z" });
    const first = period({ id: "z", created_at: "2026-11-03T12:00:00Z" });
    const tieA = period({ id: "a", created_at: "2026-11-04T00:00:00Z" });
    const tieB = period({ id: "b2", created_at: "2026-11-04T00:00:00Z" });
    for (const input of [[second, first, tieB, tieA], [tieA, tieB, first, second], [tieB, second, tieA, first]]) {
      expect(input.sort(comparePeriods).map((item) => item.id)).toEqual(["z", "b", "a", "b2"]);
    }
    expect(comparePeriods({ start_on: "2026-11-03", end_on: null }, { start_on: "2026-11-03", end_on: null })).toBe(0);
  });
});

describe("range queries", () => {
  const before = period({ id: "before", start_on: "2026-10-01", end_on: "2026-10-31" });
  const touchingStart = period({ id: "touching-start", start_on: "2026-10-20", end_on: "2026-11-01" });
  const inside = period({ id: "inside", start_on: "2026-11-10", end_on: "2026-11-12" });
  const touchingEnd = period({ id: "touching-end", start_on: "2026-11-30", end_on: "2026-12-05" });
  const after = period({ id: "after", start_on: "2026-12-01", end_on: null });
  const ongoing = period({ id: "ongoing", start_on: "2026-09-01", end_on: null });
  const all = [after, touchingEnd, inside, touchingStart, before, ongoing];

  it("returns Periods with at least one day in the inclusive range, in display order", () => {
    expect(periodsOverlappingRange(all, "2026-11-01", "2026-11-30").map((item) => item.id))
      .toEqual(["ongoing", "touching-start", "inside", "touching-end"]);
    expect(periodsOverlappingRange(all, "2026-11-02", "2026-11-29").map((item) => item.id)).toEqual(["ongoing", "inside"]);
    expect(periodsOverlappingRange(all, "2026-11-30", "2026-11-01")).toEqual([]);
    expect(all[0]).toBe(after);
  });

  it("lists the Periods that cover today and leaves out a future start", () => {
    expect(activePeriods(all, "2026-11-11").map((item) => item.id)).toEqual(["ongoing", "inside"]);
    expect(activePeriods(all, "2026-12-01").map((item) => item.id)).toEqual(["ongoing", "touching-end", "after"]);
    expect(activePeriods([after], "2026-11-30")).toEqual([]);
  });

  it("indexes covered dates for day headers and leaves uncovered dates out", () => {
    const byDate = periodsByDate([inside, touchingEnd, after], ["2026-11-09", "2026-11-10", "2026-11-12", "2026-11-13", "2026-12-01"]);
    expect(Object.keys(byDate)).toEqual(["2026-11-10", "2026-11-12", "2026-12-01"]);
    expect(byDate["2026-11-10"]).toEqual([inside]);
    expect(byDate["2026-12-01"]?.map((item) => item.id)).toEqual(["touching-end", "after"]);
    expect(periodsByDate([], ["2026-11-10"])).toEqual({});
  });

  it("validates a query range and limits it to 366 days unless told otherwise", () => {
    expect(resolvePeriodRange({ from: "2026-01-01", to: "2026-01-01" })).toEqual({ from: "2026-01-01", to: "2026-01-01" });
    expect(resolvePeriodRange({ from: "2026-01-01", to: "2027-01-01" })).toEqual({ from: "2026-01-01", to: "2027-01-01" });
    expect(() => resolvePeriodRange({ from: "2026-01-01", to: "2027-01-02" })).toThrow(PERIOD_MESSAGES.rangeTooLong);
    expect(resolvePeriodRange({ from: "2020-01-01", to: "2027-01-02" }, { maxDays: null }).from).toBe("2020-01-01");
    expect(() => resolvePeriodRange({ from: "2026-01-01", to: "2026-01-08" }, { maxDays: 7 })).toThrow("at most 7 days");
    expect(() => resolvePeriodRange({ from: "2026-01-02", to: "2026-01-01" })).toThrow(PERIOD_MESSAGES.rangeBackwards);
    expect(() => resolvePeriodRange({ from: "2026-02-30", to: "2026-03-01" })).toThrow(PERIOD_MESSAGES.dateInvalid);
    expect(() => resolvePeriodRange({ from: "2026-02-01", to: null })).toThrow(PERIOD_MESSAGES.dateInvalid);
  });
});

describe("periodCoveredDates", () => {
  it("returns the union of covered dates and counts an overlap once", () => {
    const covered = periodCoveredDates([
      { start_on: "2026-11-03", end_on: "2026-11-05" },
      { start_on: "2026-11-04", end_on: "2026-11-07" },
      { start_on: "2026-11-04", end_on: "2026-11-04" },
      { start_on: "2026-11-10", end_on: "2026-11-10" },
    ], "2026-11-01", "2026-11-30");
    expect([...covered].sort()).toEqual([
      "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-10",
    ]);
  });

  it("clips to the range, and an ongoing Period covers through the last day", () => {
    const covered = periodCoveredDates([
      { start_on: "2026-10-20", end_on: "2026-11-02" },
      { start_on: "2026-11-28", end_on: null },
      { start_on: "2026-12-01", end_on: "2026-12-05" },
    ], "2026-11-01", "2026-11-30");
    expect([...covered].sort()).toEqual(["2026-11-01", "2026-11-02", "2026-11-28", "2026-11-29", "2026-11-30"]);
  });

  it("walks month ends and leap days as calendar dates", () => {
    expect([...periodCoveredDates([{ start_on: "2028-02-28", end_on: "2028-03-01" }], "2028-01-01", "2028-12-31")])
      .toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });

  it("is empty with no Period in the range or a backwards range", () => {
    expect(periodCoveredDates([{ start_on: "2026-12-01", end_on: null }], "2026-11-01", "2026-11-30").size).toBe(0);
    expect(periodCoveredDates([{ start_on: "2026-11-01", end_on: null }], "2026-11-30", "2026-11-01").size).toBe(0);
    expect(periodCoveredDates([], "2026-11-01", "2026-11-30").size).toBe(0);
  });

  it("matches a day-by-day check for nested and adjacent Periods", () => {
    const periods = [
      { start_on: "2026-11-01", end_on: "2026-11-20" },
      { start_on: "2026-11-05", end_on: "2026-11-06" },
      { start_on: "2026-11-21", end_on: "2026-11-22" },
      { start_on: "2026-11-25", end_on: null },
    ];
    const days = Array.from({ length: 30 }, (_, index) => `2026-11-${String(index + 1).padStart(2, "0")}`);
    const expected = days.filter((day) => periods.some((item) => periodCoversDate(item, day)));
    expect([...periodCoveredDates(periods, "2026-11-01", "2026-11-30")].sort()).toEqual(expected);
  });
});

describe("splitByPeriods", () => {
  const covered = periodCoveredDates([{ start_on: "2026-11-03", end_on: "2026-11-04" }], "2026-11-01", "2026-11-07");
  const rows = [
    { localDate: "2026-11-02", status: "completed" as const },
    { localDate: "2026-11-03", status: "not_completed" as const },
    { localDate: "2026-11-04", status: "completed" as const },
    { localDate: "2026-11-05", status: "unresolved" as const },
  ];

  it("splits rows into covered and other dates and keeps their order", () => {
    const { inside, outside } = splitByPeriods(rows, covered);
    expect(inside.map((row) => row.localDate)).toEqual(["2026-11-03", "2026-11-04"]);
    expect(outside.map((row) => row.localDate)).toEqual(["2026-11-02", "2026-11-05"]);
  });

  it("feeds the existing adherence counts without changing their definition", () => {
    const { inside, outside } = splitByPeriods(rows, covered);
    const whole = resolveAdherenceCounts({ occurrences: rows, todayLocalDate: "2026-11-06" });
    const insideCounts = resolveAdherenceCounts({ occurrences: inside, todayLocalDate: "2026-11-06" });
    const outsideCounts = resolveAdherenceCounts({ occurrences: outside, todayLocalDate: "2026-11-06" });
    expect(insideCounts.needsDecisionCount + outsideCounts.needsDecisionCount).toBe(whole.needsDecisionCount);
    expect(outsideCounts.needsDecisionCount).toBe(1);
    expect(insideCounts).not.toEqual(outsideCounts);
  });

  it("reads the date through an accessor for rows shaped like stored Occurrences", () => {
    const stored = [{ local_date: "2026-11-03" }, { local_date: "2026-11-06" }];
    expect(splitByPeriods(stored, covered, (row) => row.local_date)).toEqual({
      inside: [{ local_date: "2026-11-03" }],
      outside: [{ local_date: "2026-11-06" }],
    });
    expect(splitByPeriods(rows, new Set<string>())).toEqual({ inside: [], outside: rows });
  });
});

describe("periodLabelSuggestions", () => {
  it("returns distinct labels without regard to case, newest first", () => {
    const suggestions = periodLabelSuggestions([
      period({ label: "sick", created_at: "2026-01-01T00:00:00Z" }),
      period({ label: "Travel", created_at: "2026-03-01T00:00:00Z" }),
      period({ label: "Sick", created_at: "2026-05-01T00:00:00Z" }),
      period({ label: "Exams", created_at: "2026-04-01T00:00:00Z" }),
      period({ label: "TRAVEL", created_at: "2026-02-01T00:00:00Z" }),
    ]);
    expect(suggestions).toEqual(["Sick", "Exams", "Travel"]);
  });

  it("stops at the limit, which defaults to 8", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      period({ label: `Label ${index}`, created_at: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z` }));
    expect(periodLabelSuggestions(many)).toHaveLength(8);
    expect(periodLabelSuggestions(many)[0]).toBe("Label 11");
    expect(periodLabelSuggestions(many, 2)).toEqual(["Label 11", "Label 10"]);
    expect(periodLabelSuggestions(many, 0)).toEqual([]);
    expect(periodLabelSuggestions([])).toEqual([]);
  });

  it("breaks equal creation times by the later first day", () => {
    expect(periodLabelSuggestions([
      period({ label: "Older start", start_on: "2026-01-01", end_on: null }),
      period({ label: "Newer start", start_on: "2026-06-01", end_on: null }),
    ])).toEqual(["Newer start", "Older start"]);
  });
});

describe("periodRangeLabel", () => {
  it("formats a range, a single day and an ongoing Period", () => {
    expect(periodRangeLabel({ start_on: "2026-11-03", end_on: "2026-11-09" })).toBe("Nov 3 – Nov 9");
    expect(periodRangeLabel({ start_on: "2026-11-03", end_on: "2026-11-03" })).toBe("Nov 3");
    expect(periodRangeLabel({ start_on: "2026-11-03", end_on: null })).toBe("Since Nov 3");
  });

  it("shows years when the dates span years or fall outside today's year", () => {
    expect(periodRangeLabel({ start_on: "2026-12-30", end_on: "2027-01-02" })).toBe("Dec 30, 2026 – Jan 2, 2027");
    expect(periodRangeLabel({ start_on: "2025-11-03", end_on: "2025-11-09" }, { today: "2026-11-25" })).toBe("Nov 3, 2025 – Nov 9, 2025");
    expect(periodRangeLabel({ start_on: "2025-11-03", end_on: null }, { today: "2026-11-25" })).toBe("Since Nov 3, 2025");
    expect(periodRangeLabel({ start_on: "2026-11-03", end_on: "2026-11-09" }, { today: "2026-11-25" })).toBe("Nov 3 – Nov 9");
  });

  it("says From for an ongoing Period that has not started", () => {
    expect(periodRangeLabel({ start_on: "2026-12-01", end_on: null }, { today: "2026-11-25" })).toBe("From Dec 1");
    expect(periodRangeLabel({ start_on: "2026-11-25", end_on: null }, { today: "2026-11-25" })).toBe("Since Nov 25");
  });
});

describe("periodNaturalKey", () => {
  it("is equal for the same label, first day and last day, whatever the id", () => {
    const a = period({ id: "a", label: "Sick", start_on: "2026-11-03", end_on: "2026-11-09", note: "x" });
    const b = period({ id: "b", label: "Sick", start_on: "2026-11-03", end_on: "2026-11-09", note: null });
    expect(periodNaturalKey(a)).toBe(periodNaturalKey(b));
  });

  it("differs by label case, by either date, and between ongoing and ended", () => {
    const base = { label: "Sick", start_on: "2026-11-03", end_on: "2026-11-09" };
    const keys = [
      base,
      { ...base, label: "sick" },
      { ...base, start_on: "2026-11-04" },
      { ...base, end_on: "2026-11-10" },
      { ...base, end_on: null },
      { label: "Sick 2026-11-03", start_on: "2026-11-03", end_on: null },
    ].map(periodNaturalKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// Ticket 371 (D35): what the Daily Brief's opening and the advisor tips prompt read.
describe("Periods for the Daily Brief", () => {
  const TODAY = "2026-11-10";
  const one = (label: string, start_on: string, end_on: string | null, extra: Partial<PeriodRecord> = {}) =>
    ({ id: label, label, start_on, end_on, note: "private note", created_at: "2026-11-01T00:00:00Z", ...extra });

  it("reads the 7 days before today and today", () => {
    expect(BRIEF_PERIOD_LIMITS).toEqual({ active: 5, recent: 3, recentDays: 7 });
    expect(briefPeriodRange(TODAY)).toEqual({ from: "2026-11-03", to: TODAY });
    expect(briefPeriodRange("2027-01-03")).toEqual({ from: "2026-12-27", to: "2027-01-03" });
    expect(() => briefPeriodRange("2026-02-30")).toThrow(PERIOD_MESSAGES.dateInvalid);
  });

  it("splits Periods covering today from those that ended in the last 7 days, with labels and dates only", () => {
    const result = resolveBriefPeriods({ localDate: TODAY, records: [
      one("Ended yesterday", "2026-11-05", "2026-11-09"),
      one("Sick", "2026-11-08", null),
      one("Ends today", "2026-11-01", TODAY),
      one("Ended 7 days ago", "2026-10-30", "2026-11-03"),
      one("Ended 8 days ago", "2026-10-30", "2026-11-02"),
      one("Starts tomorrow", "2026-11-11", null),
      one("Trip", "2026-11-10", "2026-11-14"),
    ] });
    expect(result).toEqual({
      periods: [
        { label: "Ends today", since: "2026-11-01", until: TODAY },
        { label: "Sick", since: "2026-11-08", until: null },
        { label: "Trip", since: "2026-11-10", until: "2026-11-14" },
      ],
      recentPeriods: [
        { label: "Ended yesterday", since: "2026-11-05", until: "2026-11-09" },
        { label: "Ended 7 days ago", since: "2026-10-30", until: "2026-11-03" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private note");
    expect(resolveBriefPeriods({ localDate: TODAY, records: [] })).toEqual({ periods: [], recentPeriods: [] });
  });

  it("keeps at most 5 covering today in display order, and the 3 most recently ended", () => {
    const active = Array.from({ length: 7 }, (_, index) => one(`A${index}`, `2026-11-0${7 - index}`, null));
    const ended = [
      one("E-3rd", "2026-11-01", "2026-11-05"), one("E-1st", "2026-11-02", "2026-11-09"), one("E-4th", "2026-11-01", "2026-11-04"),
      one("E-2nd-b", "2026-11-03", "2026-11-07"), one("E-2nd-a", "2026-11-02", "2026-11-07"),
    ];
    const result = resolveBriefPeriods({ localDate: TODAY, records: [...active, ...ended] });
    expect(result.periods.map((item) => item.label)).toEqual(["A6", "A5", "A4", "A3", "A2"]);
    expect(result.periods.map((item) => item.label)).toEqual(activePeriods(active, TODAY).slice(0, 5).map((item) => item.label));
    // The same last day: display order breaks the tie.
    expect(result.recentPeriods.map((item) => item.label)).toEqual(["E-1st", "E-2nd-a", "E-2nd-b"]);
  });
});

describe("Periods for advisor tips", () => {
  const TODAY = "2026-11-19";

  it("reads Periods with a day in the 7 days before today or on today, at most 5, with labels and dates only", () => {
    expect(TIP_PERIOD_LIMITS).toEqual({ periods: 5, days: 7 });
    expect(tipPeriodRange(TODAY)).toEqual({ from: "2026-11-12", to: TODAY });
    const records = [
      { id: "1", label: "Sick", start_on: "2026-11-17", end_on: null, note: "private note" },
      { id: "2", label: "Work trip", start_on: "2026-11-05", end_on: "2026-11-12", note: null },
      { id: "3", label: "Too old", start_on: "2026-11-01", end_on: "2026-11-11", note: null },
      { id: "4", label: "Later", start_on: "2026-11-20", end_on: null, note: null },
    ];
    expect(resolveTipPeriods({ localDate: TODAY, records })).toEqual([
      { label: "Work trip", start: "2026-11-05", end: "2026-11-12" },
      { label: "Sick", start: "2026-11-17", end: null },
    ]);
    const many = Array.from({ length: 8 }, (_, index) => ({ id: `${index}`, label: `P${index}`, start_on: `2026-11-1${index}`, end_on: null }));
    expect(resolveTipPeriods({ localDate: TODAY, records: many }).map((item) => item.label)).toEqual(["P0", "P1", "P2", "P3", "P4"]);
  });
});
