import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  planBriefing,
  validateBriefingPlanOptionIds,
} from "../packages/core/src/resolvers/briefing-plan.resolver";
import type {
  AdvisorCalendarEvent,
  AdvisorDayContextV1,
  AdvisorOccurrence,
} from "../packages/core/src/types/advisor-day-context";
import type {
  BriefingPlanInput,
  BriefingPlanInterval,
} from "../packages/core/src/types/briefing-plan";

describe("planBriefing", () => {
  it("honors disabled recap policy when no enabled suggestion is supported", () => {
    const empty = { ...input(dayContext({ occurrences: [] })), movableOccurrences: [] };
    for (const allowedSuggestionTypes of [["schedule"], ["priority"], ["priority", "schedule"]] as const) {
      expect(planBriefing({ ...empty, allowedSuggestionTypes })).toMatchObject({
        route: "insufficient_context", outcome: "no_feasible_option", options: [],
        rejections: [{ code: "no_allowed_suggestion" }],
      });
    }
    expect(planBriefing({ ...empty, allowedSuggestionTypes: ["recap"] }).route).toBe("recap");
    const unresolved = { ...empty, context: dayContext({ occurrences: [occurrence("target", "2026-09-20T09:00:00Z", 1_800)] }) };
    expect(planBriefing({ ...unresolved, allowedSuggestionTypes: ["schedule"] }).route).toBe("insufficient_context");
    expect(planBriefing({ ...unresolved, allowedSuggestionTypes: ["priority"] }).route).toBe("priority_suggestions");
  });

  it("keeps exact schedules fixed, applies buffers, and ranks options deterministically", () => {
    const target = occurrence("target", "2026-09-20T09:00:00Z", 1_800);
    const fixed = occurrence("fixed", "2026-09-20T09:30:00Z", 1_800);
    const event = timedEvent("calendar", "2026-09-20T10:00:00Z", "2026-09-20T11:00:00Z");
    const first = input(dayContext({ occurrences: [target, fixed], events: [event] }), {
      policy: { bufferMinutes: 15, preference: "earliest" },
      permittedWindows: [permittedRange("2026-09-20T08:30:00Z", "2026-09-20T12:00:00Z")],
    });
    const reordered = input(dayContext({ occurrences: [fixed, target], events: [event] }), {
      policy: { bufferMinutes: 15, preference: "earliest" },
      permittedWindows: [permittedRange("2026-09-20T08:30:00Z", "2026-09-20T12:00:00Z")],
    });

    const plan = planBriefing(first);
    expect(plan).toMatchObject({ route: "scheduling_options", outcome: "options" });
    expect(plan.options.map((option) => option.intervals.proposed.startAt)).toEqual([
      "2026-09-20T08:45:00Z",
      "2026-09-20T11:15:00Z",
    ]);
    expect(plan.options[0]?.constraints).toMatchObject({
      bufferBeforeSeconds: 900,
      bufferAfterSeconds: 900,
      calendarEventRefs: ["calendar"],
      fixedOccurrenceRefs: ["fixed"],
    });
    expect(planBriefing(reordered)).toEqual(plan);
  });

  it("uses the bounded least-change preference without changing validity", () => {
    const context = dayContext({
      occurrences: [occurrence("target", "2026-09-20T10:30:00Z", 1_800)],
      events: [timedEvent("conflict", "2026-09-20T10:00:00Z", "2026-09-20T11:00:00Z")],
    });
    const earliest = planBriefing(input(context));
    const leastChange = planBriefing(input(context, { policy: { bufferMinutes: 0, preference: "least_change" } }));

    expect(earliest.options[0]?.intervals.proposed.startAt).toBe("2026-09-20T08:30:00Z");
    expect(leastChange.options[0]?.intervals.proposed.startAt).toBe("2026-09-20T11:00:00Z");
  });

  it("conservatively treats a non-movable range occurrence as a fixed commitment", () => {
    const ranged = {
      ...occurrence("ranged", "2026-09-20T09:00:00Z", 1_800),
      schedule: { kind: "range" as const, startTime: "09:00:00", endTime: "11:00:00" },
    };
    const context = dayContext({
      occurrences: [occurrence("target", "2026-09-20T09:30:00Z", 1_800), ranged],
    });
    const plan = planBriefing(input(context));

    expect(plan.options[0]?.intervals.proposed.startAt).toBe("2026-09-20T08:30:00Z");
    expect(plan.options[0]?.constraints.fixedOccurrenceRefs).toEqual(["ranged"]);
  });

  it("preserves transparent, declined, tentative, and all-day Calendar meanings", () => {
    const target = occurrence("target", "2026-09-20T09:00:00Z", 1_800);
    const transparent = { ...timedEvent("free", "2026-09-20T08:00:00Z", "2026-09-20T12:00:00Z"), availability: "free" as const };
    const declined = { ...timedEvent("declined", "2026-09-20T08:00:00Z", "2026-09-20T12:00:00Z"), currentUserResponse: "declined" as const };
    const tentative = { ...timedEvent("tentative", "2026-09-20T09:00:00Z", "2026-09-20T10:00:00Z"), state: "tentative" as const };
    const plan = planBriefing(input(dayContext({ occurrences: [target], events: [transparent, declined, tentative] })));

    expect(plan.options[0]?.intervals.proposed.startAt).toBe("2026-09-20T08:30:00Z");
    expect(plan.options[0]?.constraints.calendarEventRefs).toEqual(["tentative"]);

    const allDay = allDayEvent("all-day", "2026-09-20", "2026-09-21");
    const blocked = planBriefing(input(dayContext({ occurrences: [target], events: [allDay] })));
    expect(blocked).toMatchObject({ route: "scheduling_options", outcome: "no_feasible_option", options: [] });
    expect(blocked.rejections).toContainEqual(expect.objectContaining({ code: "no_feasible_window" }));
  });

  it("withholds scheduling for partial, stale, or missing Calendar coverage", () => {
    const target = occurrence("target", "2026-09-20T09:00:00Z", 1_800);
    const partial = dayContext({ occurrences: [target], status: "partial", connectorState: "incomplete" });
    const stale = dayContext({ occurrences: [target], connectorState: "stale" });
    const missing = dayContext({ occurrences: [target], connectorState: "not_requested" });

    expect(planBriefing(input(partial))).toMatchObject({ route: "priority_suggestions", outcome: "no_feasible_option", options: [] });
    expect(planBriefing(input(stale)).rejections[0]?.code).toBe("calendar_not_current");
    expect(planBriefing(input(missing)).rejections[0]?.code).toBe("calendar_missing");
  });

  it("requires complete fixed commitments and current same-day Calendar facts", () => {
    const target = occurrence("target", "2026-09-20T09:00:00Z", 1_800);
    const context = dayContext({ occurrences: [target] });
    const narrowed = planBriefing({ ...input(context), fixedCommitmentsComplete: false });
    expect(narrowed.rejections[0]?.code).toBe("fixed_commitments_incomplete");

    const futureCalendar = dayContext({ occurrences: [target], connectorFetchedAt: "2026-09-20T08:02:00Z" });
    expect(planBriefing(input(futureCalendar)).rejections[0]?.code).toBe("calendar_not_current");

    const wrongDay = dayContext({ occurrences: [target], coverageLocalDate: "2026-09-19" });
    expect(planBriefing(input(wrongDay)).rejections[0]?.code).toBe("calendar_not_current");
  });

  it("requires a duration and records an explicit duration assumption", () => {
    const target = occurrence("target", "2026-09-20T09:00:00Z", null);
    const context = dayContext({
      occurrences: [target],
      events: [timedEvent("conflict", "2026-09-20T09:00:00Z", "2026-09-20T10:00:00Z")],
    });
    const unknown = planBriefing(input(context));
    expect(unknown).toMatchObject({ outcome: "no_feasible_option", options: [] });
    expect(unknown.rejections[0]?.code).toBe("duration_unknown");

    const assumed = planBriefing(input(context, { durationAssumption: { seconds: 1_200, reason: "workbench fixture" } }));
    expect(assumed.options[0]?.assumptions).toEqual([{
      kind: "duration",
      source: "explicit_input",
      seconds: 1_200,
      reason: "workbench fixture",
    }]);
  });

  it("uses true DST boundaries and clips overnight commitments", () => {
    const context = dayContext({
      localDate: "2026-11-01",
      timezone: "America/New_York",
      dayStartAt: "2026-11-01T04:00:00Z",
      dayEndAt: "2026-11-02T05:00:00Z",
      capturedAt: "2026-11-01T04:00:00Z",
      expiresAt: "2026-11-01T04:04:00Z",
      occurrences: [occurrence("target", "2026-11-01T05:30:00Z", 1_800, "2026-11-01")],
      events: [timedEvent("overnight", "2026-11-01T03:00:00Z", "2026-11-01T06:00:00Z")],
    });
    const plan = planBriefing(input(context, {
      now: "2026-11-01T04:01:00Z",
      permittedWindows: [permittedRange("2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z")],
    }));

    expect(Temporal.Instant.from(context.dayStartAt).until(context.dayEndAt).total({ unit: "hours" })).toBe(25);
    expect(plan.options[0]?.intervals.proposed.startAt).toBe("2026-11-01T06:00:00Z");
    expect(() => planBriefing(input(context, {
      now: "2026-11-01T04:01:00Z",
      permittedWindows: [permittedRange("2026-11-01T03:00:00Z", "2026-11-02T05:00:00Z")],
    }))).toThrow("captured local day");
  });

  it("returns explicit no-change and status results without mutating input", () => {
    const unresolved = occurrence("target", "2026-09-20T09:00:00Z", 1_800);
    const source = input(dayContext({ occurrences: [unresolved] }));
    const before = JSON.stringify(source);
    const unchanged = planBriefing(source);
    expect(unchanged).toMatchObject({ route: "scheduling_options", outcome: "no_change", options: [] });
    expect(unchanged.rejections[0]?.code).toBe("no_change_needed");
    expect(JSON.stringify(source)).toBe(before);

    const completed = { ...unresolved, status: "completed" as const };
    const resolved = planBriefing(input(dayContext({ occurrences: [completed] })));
    expect(resolved).toMatchObject({ outcome: "no_feasible_option", options: [] });
    expect(resolved.rejections[0]?.code).toBe("occurrence_not_unresolved");

    const noMovable = planBriefing({ ...source, movableOccurrences: [] });
    expect(noMovable).toMatchObject({ route: "priority_suggestions", outcome: "no_change" });
  });

  it("preserves source revisions and expiry, then rejects an expired snapshot", () => {
    const source = input(dayContext({
      occurrences: [occurrence("target", "2026-09-20T09:00:00Z", 1_800)],
      events: [timedEvent("conflict", "2026-09-20T09:00:00Z", "2026-09-20T10:00:00Z")],
    }));
    const plan = planBriefing(source);
    expect(plan).toMatchObject({
      generatedAt: "2026-09-20T08:01:00Z",
      expiresAt: "2026-09-20T08:04:00Z",
      revisions: {
        configuration: "config-1",
        snapshot: "snapshot-1",
        cadence: "cadence-1",
        grantGeneration: 1,
        calendar: { connectionGeneration: 1, selectionRevision: 1 },
      },
    });
    const expired = planBriefing({ ...source, now: source.context.expiresAt });
    expect(expired).toMatchObject({ route: "insufficient_context", outcome: "no_feasible_option", options: [] });
    expect(expired.rejections[0]?.code).toBe("context_expired");
  });

  it("accepts only supplied option ids from downstream structured output", () => {
    const context = dayContext({
      occurrences: [occurrence("target", "2026-09-20T09:00:00Z", 1_800)],
      events: [timedEvent("conflict", "2026-09-20T09:00:00Z", "2026-09-20T10:00:00Z")],
    });
    const plan = planBriefing(input(context));
    expect(validateBriefingPlanOptionIds(plan, ["option_1"])).toEqual([plan.options[0]]);
    expect(validateBriefingPlanOptionIds(plan, ["invented"])).toBeNull();
    expect(validateBriefingPlanOptionIds(plan, ["option_1", "option_1"])).toBeNull();
  });

  it("reports ranked overlaps without schedule permission or movable selections", () => {
    const plan = planBriefing({
      ...input(dayContext({
        occurrences: [occurrence("behavior", "2026-09-20T09:00:00Z", 1_800)],
        events: [
          timedEvent("calendar-a", "2026-09-20T09:10:00Z", "2026-09-20T09:40:00Z"),
          timedEvent("calendar-b", "2026-09-20T09:20:00Z", "2026-09-20T09:50:00Z"),
        ],
      })),
      allowedSuggestionTypes: ["recap"],
      movableOccurrences: [],
    });

    expect(plan).toMatchObject({ route: "recap", outcome: "not_requested", options: [] });
    expect(plan.dayEvidence.findings.slice(0, 3).map((finding) => finding.kind)).toEqual([
      "known_overlap", "known_overlap", "known_overlap",
    ]);
    expect(plan.dayEvidence.findings.map((finding) => finding.rank)).toEqual([1, 2, 3, 4]);
    expect(plan.dayEvidence.findings).toContainEqual(expect.objectContaining({
      kind: "known_overlap",
      refs: { occurrenceRefs: [], calendarEventRefs: ["calendar-a", "calendar-b"] },
    }));
  });

  it("gives one move per occurrence, overlaps first, without colliding chosen times", () => {
    // Event 10:00–11:00. "overlapping" (10:00–10:20) sits inside it; "tight" (11:00–11:20) starts as it ends.
    const window = permittedRange("2026-09-20T08:30:00Z", "2026-09-20T12:00:00Z");
    const base = input(dayContext({
      occurrences: [occurrence("tight", "2026-09-20T11:00:00Z", 1_200), occurrence("overlapping", "2026-09-20T10:00:00Z", 1_200)],
      events: [timedEvent("meeting", "2026-09-20T10:00:00Z", "2026-09-20T11:00:00Z")],
    }), { policy: { bufferMinutes: 10, preference: "least_change" } });
    const movable = ["tight", "overlapping"].map((occurrenceRef) => ({ occurrenceRef, permittedWindows: [window] }));
    const pooled = planBriefing({ ...base, alternatives: 1, movableOccurrences: movable });
    expect(pooled.options.map((option) => option.occurrenceRef)).toEqual(["tight"]);

    const plan = planBriefing({ ...base, alternatives: 3, movableOccurrences: movable, policy: { ...base.policy, onePerOccurrence: true } });
    expect(plan.options.map((option) => option.occurrenceRef)).toEqual(["overlapping", "tight"]);
    const [first, second] = plan.options.map((option) => [Date.parse(option.intervals.proposed.startAt), Date.parse(option.intervals.proposed.endAt)] as const);
    // Chosen moves keep the 10-minute buffer from each other.
    expect(second![0] >= first![1] + 600_000 || first![0] >= second![1] + 600_000).toBe(true);
    expect(planBriefing({ ...base, alternatives: 1, movableOccurrences: movable, policy: { ...base.policy, onePerOccurrence: true } }).options.map((option) => option.occurrenceRef)).toEqual(["overlapping"]);
  });

  it("with flexible schedules, an unknown length blocks nothing and a range forms no overlap", () => {
    // "unknown" starts 9:00 with no length; "target" (45 min, 10:00) overlaps a 10:00–10:30 event.
    const context = dayContext({
      occurrences: [occurrence("target", "2026-09-20T10:00:00Z", 2_700), occurrence("unknown", "2026-09-20T09:00:00Z", null)],
      events: [timedEvent("meeting", "2026-09-20T10:00:00Z", "2026-09-20T10:30:00Z")],
    });
    const strict = planBriefing(input(context));
    expect(strict.options).toEqual([]);
    const flexible = planBriefing({ ...input(context), policy: { bufferMinutes: 0, preference: "earliest", flexibleSchedules: true } });
    expect([flexible.options[0]!.occurrenceRef, flexible.options[0]!.intervals.proposed.startAt]).toEqual(["target", "2026-09-20T08:30:00Z"]);

    const ranged = { ...occurrence("window", "2026-09-20T09:00:00Z", 1_800), schedule: { kind: "range" as const, startTime: "09:00:00", endTime: "11:00:00" } };
    const rangeContext = dayContext({ occurrences: [ranged, occurrence("inside", "2026-09-20T10:00:00Z", 600)] });
    const overlapsOf = (plan: ReturnType<typeof planBriefing>) => plan.dayEvidence.findings.filter((item) => item.kind === "known_overlap").length;
    expect(overlapsOf(planBriefing(input(rangeContext)))).toBe(1);
    expect(overlapsOf(planBriefing({ ...input(rangeContext), policy: { bufferMinutes: 0, preference: "earliest", flexibleSchedules: true } }))).toBe(0);
  });

  it("with flexible schedules, a range holds only its length, packed at its earliest free time", () => {
    // "window" may happen 9:00–11:00 and takes 30 minutes; it is packed at 9:00–9:30.
    // "target" (45 min) overlaps a 10:00–10:30 event; 8:30–9:00 and 9:30–10:00 are too short, so 10:30.
    const ranged = { ...occurrence("window", "2026-09-20T09:00:00Z", 1_800), schedule: { kind: "range" as const, startTime: "09:00:00", endTime: "11:00:00" } };
    const context = dayContext({
      occurrences: [occurrence("target", "2026-09-20T10:00:00Z", 2_700), ranged],
      events: [timedEvent("meeting", "2026-09-20T10:00:00Z", "2026-09-20T10:30:00Z")],
    });
    const plan = planBriefing({ ...input(context), policy: { bufferMinutes: 0, preference: "earliest", flexibleSchedules: true } });
    expect(plan.options[0]!.intervals.proposed.startAt).toBe("2026-09-20T10:30:00Z");
    const strict = planBriefing(input(context));
    // Without flexible schedules the range reserves its whole span.
    expect(strict.options.every((option) => Date.parse(option.intervals.proposed.startAt) >= Date.parse("2026-09-20T11:00:00Z") || Date.parse(option.intervals.proposed.endAt) <= Date.parse("2026-09-20T09:00:00Z"))).toBe(true);
  });

  it("with flexible schedules, a range is never packed into the slot of the Behavior being moved", () => {
    const ranged = { ...occurrence("window", "2026-09-20T09:00:00Z", 1_800), schedule: { kind: "range" as const, startTime: "09:00:00", endTime: "11:00:00" } };
    const context = dayContext({ occurrences: [occurrence("target", "2026-09-20T09:00:00Z", 600), ranged] });
    const plan = planBriefing({ ...input(context), policy: { bufferMinutes: 0, preference: "earliest", flexibleSchedules: true } });
    expect(plan.options).toEqual([]);
    expect(plan.rejections).toContainEqual(expect.objectContaining({ occurrenceRef: "target", code: "no_change_needed" }));
  });

  it("slides a colliding move later within its free range instead of jumping to a later gap", () => {
    // Both overlap a 9:00–10:00 event; the 10:00–12:00 gap takes "first" at 10:00, then "second" at 10:30.
    const context = dayContext({
      occurrences: [occurrence("first", "2026-09-20T09:00:00Z", 1_800), occurrence("second", "2026-09-20T09:30:00Z", 1_800)],
      events: [timedEvent("meeting", "2026-09-20T08:30:00Z", "2026-09-20T10:00:00Z")],
    });
    const window = permittedRange("2026-09-20T08:30:00Z", "2026-09-20T12:00:00Z");
    const plan = planBriefing({ ...input(context), alternatives: 3, policy: { bufferMinutes: 0, preference: "least_change", onePerOccurrence: true, flexibleSchedules: true },
      movableOccurrences: ["first", "second"].map((occurrenceRef) => ({ occurrenceRef, permittedWindows: [window] })) });
    expect(plan.options.map((option) => [option.occurrenceRef, option.intervals.proposed.startAt])).toEqual([
      ["first", "2026-09-20T10:00:00Z"], ["second", "2026-09-20T10:30:00Z"],
    ]);
  });

  it("says which part of each side an overlap covers", () => {
    // Behavior 9:00–9:30. Event a (9:10–9:40) takes its end; event b (9:05–9:15) sits inside it.
    const plan = planBriefing({
      ...input(dayContext({
        occurrences: [occurrence("behavior", "2026-09-20T09:00:00Z", 1_800)],
        events: [
          timedEvent("calendar-a", "2026-09-20T09:10:00Z", "2026-09-20T09:40:00Z"),
          timedEvent("calendar-b", "2026-09-20T09:05:00Z", "2026-09-20T09:15:00Z"),
        ],
      })),
      allowedSuggestionTypes: ["recap"],
      movableOccurrences: [],
    });
    const parts = (eventRef: string) => {
      const finding = plan.dayEvidence.findings.find((item) => item.kind === "known_overlap" && item.refs.occurrenceRefs.includes("behavior") && item.refs.calendarEventRefs.includes(eventRef));
      return finding?.kind === "known_overlap" ? finding.participants.map((item) => [item.ref, item.source, item.part]) : null;
    };
    expect(parts("calendar-a")).toEqual([["behavior", "occurrence", "end"], ["calendar-a", "calendar_event", "start"]]);
    expect(parts("calendar-b")).toEqual([["behavior", "occurrence", "middle"], ["calendar-b", "calendar_event", "all"]]);
  });

  it("reports tight transitions from the configured buffer", () => {
    const plan = planBriefing(input(dayContext({
      occurrences: [occurrence("target", "2026-09-20T09:00:00Z", 1_800)],
      events: [timedEvent("next", "2026-09-20T09:40:00Z", "2026-09-20T10:00:00Z")],
    }), { policy: { bufferMinutes: 15, preference: "earliest" } }));
    const finding = plan.dayEvidence.findings.find((item) => item.kind === "tight_transition");

    expect(finding).toMatchObject({
      availableSeconds: 600,
      requiredBufferSeconds: 900,
      refs: { occurrenceRefs: ["target"], calendarEventRefs: ["next"] },
      assumptions: expect.arrayContaining([{ kind: "buffer", seconds: 900 }]),
    });
  });

  it("excludes resolved and off-day occurrences from evidence and constraints", () => {
    const completed = { ...occurrence("completed", "2026-09-20T09:00:00Z", 3_600), status: "completed" as const };
    const notCompleted = { ...occurrence("not-completed", "2026-09-20T09:00:00Z", 3_600), status: "not_completed" as const };
    const prior = occurrence("prior", "2026-09-19T09:00:00Z", 3_600, "2026-09-19");
    const plan = planBriefing(input(dayContext({
      occurrences: [occurrence("target", "2026-09-20T09:30:00Z", 1_800), completed, notCompleted, prior],
    })));
    const serialized = JSON.stringify(plan.dayEvidence);

    expect(serialized).not.toContain("completed");
    expect(serialized).not.toContain("not-completed");
    expect(serialized).not.toContain("prior");
    expect(plan.dayEvidence.findings.find((item) => item.kind === "feasible_opportunity")?.refs.occurrenceRefs).toEqual(["target"]);
  });

  it("keeps unknown durations and unknown blocker ends out of fit and overlap claims", () => {
    const unknownTarget = occurrence("unknown", "2026-09-20T09:00:00Z", null);
    const unknownDurationPlan = planBriefing(input(dayContext({ occurrences: [unknownTarget] }), {
      commonPermittedWindows: [permittedRange("2026-09-20T09:00:00Z", "2026-09-20T11:00:00Z")],
    }));
    expect(unknownDurationPlan.dayEvidence.findings).toContainEqual(expect.objectContaining({
      kind: "unknown_feasibility", occurrenceRef: "unknown", reasons: ["duration_unknown"],
    }));

    const unknownBlockerPlan = planBriefing(input(dayContext({
      occurrences: [occurrence("target", "2026-09-20T10:00:00Z", 2_100)],
      events: [unknownEndEvent("unknown-end", "2026-09-20T09:30:00Z")],
    }), { commonPermittedWindows: [permittedRange("2026-09-20T09:00:00Z", "2026-09-20T11:00:00Z")] }));
    expect(unknownBlockerPlan.dayEvidence.findings).not.toContainEqual(expect.objectContaining({ kind: "known_overlap" }));
    expect(unknownBlockerPlan.dayEvidence.findings).not.toContainEqual(expect.objectContaining({ kind: "feasible_opportunity" }));
    expect(unknownBlockerPlan.dayEvidence.findings).toContainEqual(expect.objectContaining({
      kind: "unknown_feasibility", occurrenceRef: "target", reasons: ["unknown_blocker_end"],
      refs: { occurrenceRefs: ["target"], calendarEventRefs: ["unknown-end"] },
    }));
  });

  it("uses fresh partial observations but never stale or missing Calendar events", () => {
    const target = occurrence("target", "2026-09-20T09:00:00Z", 1_800);
    const event = timedEvent("observed", "2026-09-20T09:10:00Z", "2026-09-20T09:20:00Z");
    const partial = planBriefing(input(dayContext({
      occurrences: [target], events: [event], status: "partial", connectorState: "incomplete",
    })));
    expect(partial.dayEvidence).toMatchObject({ coverage: { calendar: "current_partial", canClaimFeasibleOpportunities: false } });
    expect(partial.dayEvidence.findings).toContainEqual(expect.objectContaining({ kind: "known_overlap" }));
    expect(partial.dayEvidence.findings).toContainEqual(expect.objectContaining({
      kind: "unknown_feasibility", reasons: ["calendar_incomplete"],
    }));

    for (const connectorState of ["stale", "not_requested"] as const) {
      const plan = planBriefing(input(dayContext({ occurrences: [target], events: [event], connectorState })));
      expect(plan.dayEvidence.findings).not.toContainEqual(expect.objectContaining({ kind: "known_overlap" }));
      expect(plan.dayEvidence.findings).toContainEqual(expect.objectContaining({
        kind: "unknown_feasibility",
        reasons: [connectorState === "stale" ? "calendar_stale" : "calendar_missing"],
      }));
    }
  });

  it("lets all-day reservations block fits without inventing timed overlaps", () => {
    const plan = planBriefing({
      ...input(dayContext({
        occurrences: [occurrence("target", "2026-09-20T09:00:00Z", 1_800)],
        events: [allDayEvent("reserved", "2026-09-20", "2026-09-21")],
      })),
      movableOccurrences: [],
    });

    expect(plan.dayEvidence.findings).not.toContainEqual(expect.objectContaining({ kind: "known_overlap" }));
    expect(plan.dayEvidence.findings).not.toContainEqual(expect.objectContaining({ kind: "unknown_feasibility" }));
    expect(plan.dayEvidence.findings).not.toContainEqual(expect.objectContaining({ kind: "feasible_opportunity" }));
    expect(plan.rejections).toContainEqual(expect.objectContaining({ occurrenceRef: "target", code: "no_feasible_window" }));
  });

  it("uses real DST day bounds and omits conflicts that ended before capture", () => {
    const context = dayContext({
      localDate: "2026-11-01", timezone: "America/New_York",
      dayStartAt: "2026-11-01T04:00:00Z", dayEndAt: "2026-11-02T05:00:00Z",
      capturedAt: "2026-11-01T04:00:00Z", expiresAt: "2026-11-01T04:04:00Z",
      occurrences: [occurrence("target", "2026-11-01T05:30:00Z", 1_800, "2026-11-01")],
      events: [
        timedEvent("past", "2026-11-01T03:00:00Z", "2026-11-01T04:00:30Z"),
        timedEvent("overnight", "2026-11-01T03:00:00Z", "2026-11-01T06:00:00Z"),
      ],
    });
    const plan = planBriefing(input(context, {
      now: "2026-11-01T04:01:00Z",
      commonPermittedWindows: [permittedRange("2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z")],
      permittedWindows: [permittedRange("2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z")],
    }));

    expect(plan.dayEvidence.findings).toContainEqual(expect.objectContaining({
      kind: "known_overlap", interval: expect.objectContaining({ startAt: "2026-11-01T05:30:00Z", endAt: "2026-11-01T06:00:00Z" }),
    }));
    expect(JSON.stringify(plan.dayEvidence)).not.toContain("past");
  });

  it("reports missing windows and preserves provenance without mutating input", () => {
    const source = input(dayContext({ occurrences: [occurrence("target", "2026-09-20T09:00:00Z", 1_800)] }), {
      commonPermittedWindows: [],
    });
    const before = JSON.stringify(source);
    const plan = planBriefing(source);
    const unknown = plan.dayEvidence.findings.find((item) => item.kind === "unknown_feasibility");

    expect(unknown).toMatchObject({
      occurrenceRef: "target", reasons: ["no_permitted_window"],
      refs: { occurrenceRefs: ["target"], calendarEventRefs: [] },
      freshness: "current_complete",
    });
    expect(plan.dayEvidence.freshness).toEqual({
      capturedAt: "2026-09-20T08:00:00Z", expiresAt: "2026-09-20T08:04:00Z", calendarFetchedAt: "2026-09-20T08:00:00Z",
    });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("supports a 35-minute fit and rejects a known 34-minute window", () => {
    const target = occurrence("target", "2026-09-20T10:00:00Z", 2_100);
    const fitting = planBriefing({
      ...input(dayContext({ occurrences: [target] }), {
        commonPermittedWindows: [permittedRange("2026-09-20T08:30:00Z", "2026-09-20T09:05:00Z")],
      }),
      movableOccurrences: [],
    });
    expect(fitting.dayEvidence.findings).toContainEqual(expect.objectContaining({
      kind: "feasible_opportunity", occurrenceRef: "target", hypotheticalMoveRequired: true,
      interval: expect.objectContaining({ startAt: "2026-09-20T08:30:00Z", endAt: "2026-09-20T09:05:00Z" }),
      assumptions: expect.arrayContaining([expect.objectContaining({ kind: "duration", seconds: 2_100 })]),
    }));

    const tooSmall = planBriefing({
      ...input(dayContext({ occurrences: [target] }), {
        commonPermittedWindows: [permittedRange("2026-09-20T08:30:00Z", "2026-09-20T09:04:00Z")],
      }),
      movableOccurrences: [],
    });
    expect(tooSmall.dayEvidence.findings).not.toContainEqual(expect.objectContaining({ kind: "feasible_opportunity" }));
    expect(tooSmall.dayEvidence.findings).not.toContainEqual(expect.objectContaining({ kind: "unknown_feasibility" }));
    expect(tooSmall.rejections).toContainEqual(expect.objectContaining({ occurrenceRef: "target", code: "no_feasible_window" }));

    const fractionalTooLarge = planBriefing({
      ...input(dayContext({ occurrences: [occurrence("target", "2026-09-20T10:00:00Z", 2_100.0004)] }), {
        commonPermittedWindows: [permittedRange("2026-09-20T08:30:00Z", "2026-09-20T09:05:00Z")],
      }),
      movableOccurrences: [],
    });
    expect(fractionalTooLarge.dayEvidence.findings).not.toContainEqual(expect.objectContaining({ kind: "feasible_opportunity" }));
  });

  it("uses reserved ranges consistently for overlaps and tight transitions", () => {
    const ranged = { ...occurrence("ranged", "2026-09-20T09:00:00Z", 900),
      schedule: { kind: "range" as const, startTime: "09:00:00", endTime: "11:00:00" } };
    const plan = planBriefing({ ...input(dayContext({
      occurrences: [ranged, occurrence("target", "2026-09-20T10:00:00Z", 900)],
      events: [timedEvent("inside-range", "2026-09-20T09:20:00Z", "2026-09-20T09:30:00Z"),
        timedEvent("after-range", "2026-09-20T11:10:00Z", "2026-09-20T11:30:00Z")],
    }), { policy: { bufferMinutes: 15, preference: "earliest" } }),
    allowedSuggestionTypes: ["recap"], movableOccurrences: [] });
    const findings = plan.dayEvidence.findings;
    expect(findings).toContainEqual(expect.objectContaining({
      kind: "known_overlap", refs: { occurrenceRefs: ["ranged", "target"], calendarEventRefs: [] },
      interval: expect.objectContaining({ startAt: "2026-09-20T10:00:00Z", endAt: "2026-09-20T10:15:00Z" }),
      assumptions: expect.arrayContaining([{ kind: "reserved_range", occurrenceRef: "ranged",
        interval: permittedRange("2026-09-20T09:00:00Z", "2026-09-20T11:00:00Z") }]),
    }));
    expect(findings).toContainEqual(expect.objectContaining({
      kind: "known_overlap", refs: { occurrenceRefs: ["ranged"], calendarEventRefs: ["inside-range"] },
    }));
    expect(findings).not.toContainEqual(expect.objectContaining({
      kind: "tight_transition", refs: { occurrenceRefs: ["ranged"], calendarEventRefs: ["inside-range"] },
    }));
    expect(findings).toContainEqual(expect.objectContaining({
      kind: "tight_transition", availableSeconds: 600,
      refs: { occurrenceRefs: ["ranged"], calendarEventRefs: ["after-range"] },
    }));
  });

  it("preserves duration and uncertainty beyond a ranged commitment's end", () => {
    const target = occurrence("target", "2026-09-20T09:30:00Z", 1_800);
    const window = permittedRange("2026-09-20T09:15:00Z", "2026-09-20T11:00:00Z");
    for (const seconds of [3_600, null]) {
      const ranged = { ...occurrence("ranged", "2026-09-20T09:00:00Z", seconds),
        schedule: { kind: "range" as const, startTime: "09:00:00", endTime: "09:15:00" } };
      const plan = planBriefing(input(dayContext({ occurrences: [target, ranged] }), { permittedWindows: [window] }));
      const fit = plan.dayEvidence.findings.find(item => item.kind === "feasible_opportunity" && item.occurrenceRef === "target");
      if (seconds !== null) {
        expect(fit).toMatchObject({ interval: { startAt: "2026-09-20T10:00:00Z" } });
        expect(plan.options[0]?.intervals.proposed.startAt).toBe("2026-09-20T10:00:00Z");
      } else {
        expect(fit).toBeUndefined();
        expect(plan.options).toEqual([]);
        expect(plan.dayEvidence.findings).toContainEqual(expect.objectContaining({
          kind: "unknown_feasibility", occurrenceRef: "target", reasons: ["unknown_blocker_end"],
        }));
      }
    }
  });

  it("preserves the buffer after a commitment that ended before now", () => {
    const context = dayContext({ capturedAt: "2026-09-20T09:09:00Z", expiresAt: "2026-09-20T09:13:00Z",
      occurrences: [occurrence("target", "2026-09-20T09:10:00Z", 900)],
      events: [timedEvent("recent", "2026-09-20T09:00:00Z", "2026-09-20T09:05:00Z")],
    });
    const plan = planBriefing(input(context, { now: "2026-09-20T09:10:00Z",
      policy: { bufferMinutes: 15, preference: "earliest" },
      permittedWindows: [permittedRange("2026-09-20T08:00:00Z", "2026-09-20T11:00:00Z")],
    }));
    expect(plan.dayEvidence.findings).toContainEqual(expect.objectContaining({
      kind: "feasible_opportunity", interval: expect.objectContaining({ startAt: "2026-09-20T09:20:00Z" }),
      refs: { occurrenceRefs: ["target"], calendarEventRefs: ["recent"] },
    }));
    expect(plan.options[0]?.intervals.proposed.startAt).toBe("2026-09-20T09:20:00Z");
  });

  it("bounds ranked evidence and withholds stale Cadence observations", () => {
    const events = Array.from({ length: 10 }, (_, index) =>
      timedEvent(`event-${index}`, "2026-09-20T09:00:00Z", "2026-09-20T10:00:00Z"));
    const bounded = planBriefing({
      ...input(dayContext({ events, occurrences: [] })),
      allowedSuggestionTypes: ["recap"],
      movableOccurrences: [],
    });
    expect(bounded.dayEvidence.findings).toHaveLength(32);
    expect(bounded.dayEvidence.omittedFindingCount).toBe(13);

    const staleCadence = planBriefing(input(dayContext({
      cadenceObservedAt: "2026-09-20T07:00:00Z",
      occurrences: [occurrence("target", "2026-09-20T09:00:00Z", 1_800)],
      events: [timedEvent("event", "2026-09-20T09:00:00Z", "2026-09-20T10:00:00Z")],
    })));
    expect(staleCadence.dayEvidence).toMatchObject({ coverage: { cadence: "partial" }, findings: [] });
  });
});

function input(
  context: AdvisorDayContextV1,
  overrides: Partial<Pick<BriefingPlanInput, "now" | "policy">> & Readonly<{
    permittedWindows?: readonly BriefingPlanInterval[];
    commonPermittedWindows?: readonly BriefingPlanInterval[];
    durationAssumption?: { seconds: number; reason: string };
  }> = {},
): BriefingPlanInput {
  const permittedWindows = overrides.permittedWindows ?? [permittedRange("2026-09-20T08:30:00Z", "2026-09-20T12:00:00Z")];
  return {
    context,
    now: overrides.now ?? "2026-09-20T08:01:00Z",
    configurationRevision: "config-1",
    alternatives: 3,
    allowedSuggestionTypes: ["recap", "priority", "schedule"],
    fixedCommitmentsComplete: true,
    permittedWindows: overrides.commonPermittedWindows ?? permittedWindows,
    movableOccurrences: [{
      occurrenceRef: "target",
      permittedWindows,
      ...(overrides.durationAssumption ? { durationAssumption: overrides.durationAssumption } : {}),
    }],
    policy: overrides.policy ?? { bufferMinutes: 0, preference: "earliest" },
  };
}

function dayContext(overrides: Readonly<{
  localDate?: string;
  timezone?: string;
  dayStartAt?: string;
  dayEndAt?: string;
  capturedAt?: string;
  expiresAt?: string;
  status?: "complete" | "partial";
  connectorState?: "current" | "stale" | "incomplete" | "not_requested";
  connectorFetchedAt?: string;
  cadenceObservedAt?: string;
  coverageLocalDate?: string;
  occurrences?: AdvisorOccurrence[];
  events?: AdvisorCalendarEvent[];
}> = {}): AdvisorDayContextV1 {
  const localDate = overrides.localDate ?? "2026-09-20";
  const connectorState = overrides.connectorState ?? "current";
  return {
    version: "1.0",
    snapshotId: "snapshot-1",
    accountRef: "account-1",
    localDate,
    timezone: overrides.timezone ?? "UTC",
    dayStartAt: overrides.dayStartAt ?? "2026-09-20T00:00:00Z",
    dayEndAt: overrides.dayEndAt ?? "2026-09-21T00:00:00Z",
    capturedAt: overrides.capturedAt ?? "2026-09-20T08:00:00Z",
    expiresAt: overrides.expiresAt ?? "2026-09-20T08:04:00Z",
    status: overrides.status ?? "complete",
    authority: "read_only",
    grantGeneration: 1,
    cadence: {
      observedAt: overrides.cadenceObservedAt ?? overrides.capturedAt ?? "2026-09-20T08:00:00Z",
      revision: "cadence-1",
      coverage: "complete",
      occurrences: overrides.occurrences ?? [],
      history: {
        lookbackDays: 90,
        startLocalDate: Temporal.PlainDate.from(localDate).subtract({ days: 90 }).toString(),
        endLocalDateExclusive: localDate,
        completeness: "complete",
        reason: null,
        behaviors: [],
      },
    },
    connectors: connectorState === "not_requested" ? [{ source: "google_calendar", state: "not_requested" }] : [{
      source: "google_calendar",
      state: connectorState,
      complete: connectorState === "current",
      fetchedAt: overrides.connectorFetchedAt ?? overrides.capturedAt ?? "2026-09-20T08:00:00Z",
      connectionGeneration: 1,
      selectionRevision: 1,
      schemaVersion: "1.0.0",
      adapterVersion: "google-calendar-v1",
      coverage: connectorState === "current" || connectorState === "incomplete"
        ? [{ calendarRef: "calendar-1", startLocalDate: overrides.coverageLocalDate ?? localDate, endLocalDate: overrides.coverageLocalDate ?? localDate, paginationComplete: connectorState === "current" }]
        : [],
      failure: connectorState === "current" ? null : { code: "provider_unavailable", retryable: true, retryAfterSeconds: null },
      events: overrides.events ?? [],
    }],
  };
}

function occurrence(
  ref: string,
  scheduledFor: string,
  durationSeconds: number | null,
  localDate = "2026-09-20",
): AdvisorOccurrence {
  return {
    ref,
    behaviorRef: `behavior-${ref}`,
    title: ref,
    status: "unresolved",
    localDate,
    scheduledFor,
    schedule: { kind: "exact", startTime: "09:00:00", endTime: null },
    duration: durationSeconds === null
      ? { kind: "unknown", reason: "insufficient_samples", sampleCount: 0, lookbackDays: 90 }
      : { kind: "known", seconds: durationSeconds, source: "behavior_default", sampleCount: 0, lookbackDays: 90 },
  };
}

function timedEvent(ref: string, startAt: string, endAt: string): AdvisorCalendarEvent {
  return {
    ref,
    calendarRef: "calendar-1",
    logicalInstanceRef: `instance-${ref}`,
    revision: `revision-${ref}`,
    interval: {
      kind: "timed",
      startAt,
      endAt,
      duration: { kind: "known", seconds: Temporal.Instant.from(startAt).until(endAt).total({ unit: "seconds" }) },
    },
    sourceTimezone: "UTC",
    sourceTimezoneFallback: "none",
    state: "confirmed",
    availability: "busy",
    currentUserResponse: "accepted",
    recurrence: null,
  };
}

function unknownEndEvent(ref: string, startAt: string): AdvisorCalendarEvent {
  return {
    ...timedEvent(ref, startAt, Temporal.Instant.from(startAt).add({ minutes: 1 }).toString()),
    interval: {
      kind: "timed",
      startAt,
      endAt: startAt,
      duration: { kind: "unknown", reason: "end_unspecified" },
    },
  };
}

function allDayEvent(ref: string, startLocalDate: string, endLocalDate: string): AdvisorCalendarEvent {
  return {
    ref,
    calendarRef: "calendar-1",
    logicalInstanceRef: `instance-${ref}`,
    revision: `revision-${ref}`,
    interval: {
      kind: "all_day",
      startLocalDate,
      endLocalDate,
      duration: { kind: "calendar_days", days: Temporal.PlainDate.from(startLocalDate).until(endLocalDate).days },
    },
    sourceTimezone: "UTC",
    sourceTimezoneFallback: "none",
    state: "confirmed",
    availability: "busy",
    currentUserResponse: "accepted",
    recurrence: null,
  };
}

function permittedRange(startAt: string, endAt: string): BriefingPlanInterval {
  return {
    kind: "timed",
    startAt,
    endAt,
    duration: { kind: "known", seconds: Temporal.Instant.from(startAt).until(endAt).total({ unit: "seconds" }) },
  };
}
