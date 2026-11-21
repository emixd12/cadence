import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import {
  briefMoveItemBlocks,
  briefMoveRoutineMembers,
  planBriefMoveLinesFromInputs,
  type BriefMoveDayItem,
  type BriefMovePlanInputs,
} from "@cadence/core/resolvers/brief-move.resolver";
import { planBriefing } from "@cadence/core/resolvers/briefing-plan.resolver";
import { validateAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import type { AdvisorCalendarEvent, AdvisorDayContextV1, AdvisorOccurrence } from "@cadence/core/types/advisor-day-context";
import type { BriefingPlanInput } from "@cadence/core/types/briefing-plan";

// A routine's steps that follow its time are one block in the Daily Brief: they never
// collide with each other, they occupy the routine's time for their summed length,
// and one line moves them together.

const TZ = "America/New_York";
const DAY = "2026-11-18";
const local = (time: string) => Temporal.PlainDateTime.from(`${DAY}T${time}`).toZonedDateTime(TZ).toInstant();

function item(id: string, start: string, minutes: number, extra: Partial<BriefMoveDayItem> = {}): BriefMoveDayItem {
  const begin = local(start);
  return {
    occurrenceId: id, behaviorId: `b-${id}`, title: id, status: "unresolved", localDate: DAY, scheduleKind: "exact",
    start: begin, end: begin.add({ minutes }), length: { minutes, source: "behavior_duration", assumed: false },
    alongside: false, revision: `rev-${id}`, behaviorRevision: `brev-${id}`, ...extra,
  };
}

const step = (id: string, order: number, extra: Partial<BriefMoveDayItem> = {}) => item(id, "09:00", 10, {
  routine: { parentBehaviorId: "skin", parentTitle: "Skin routine", inheritParentSchedule: true, stepOrder: order }, ...extra,
});
const routine = () => [step("retinol", 2), step("cerave", 0), step("facewash", 1)];

function plan(overrides: Partial<BriefMovePlanInputs>) {
  return planBriefMoveLinesFromInputs({
    localDate: DAY, timezone: TZ, now: local("08:00"), items: [], calendarBusy: [], calendar: "current", travel: null,
    declinedToday: new Set(), neverMoveBehaviorIds: new Set(), ...overrides,
  });
}

describe("brief move lines for routines", () => {
  it("never reads a routine's own steps as overlapping each other", () => {
    expect(plan({ items: routine() }).candidates).toEqual([]);
  });

  it("offers one line that moves every step, past a calendar event, for the summed length", () => {
    const meeting = { ref: "cal-1", title: "Standup", start: local("09:00"), end: local("09:30") };
    const { candidates } = plan({ items: routine(), calendarBusy: [meeting] });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      occurrenceId: "cerave", title: "Skin routine", reasonCode: "calendar_overlap",
      length: { minutes: 30 }, routine: { parentBehaviorId: "skin", title: "Skin routine", occurrenceIds: ["cerave", "facewash", "retinol"] },
    });
    const to = Temporal.Instant.from(candidates[0]!.to.startAt);
    // The whole 30 minutes keeps the 10-minute gap from the meeting, before or after it.
    const end = to.add({ minutes: 30 });
    expect(Temporal.Instant.compare(end, local("08:50")) <= 0 || Temporal.Instant.compare(to, local("09:40")) >= 0).toBe(true);
    expect(candidates[0]!.to.endAt).toBe(to.add({ minutes: 30 }).toString());
  });

  it("holds the routine when the person said No to one of its steps today", () => {
    const meeting = { ref: "cal-1", start: local("09:00"), end: local("09:30") };
    expect(plan({ items: routine(), calendarBusy: [meeting], declinedToday: new Set(["retinol"]) }).candidates).toEqual([]);
  });

  it("still reads a step with its own schedule as a separate item", () => {
    const own = step("retinol", 2, { routine: { parentBehaviorId: "skin", parentTitle: "Skin routine", inheritParentSchedule: false, stepOrder: 2 } });
    const { candidates } = plan({ items: [step("cerave", 0), step("facewash", 1), own] });
    expect(candidates.map((candidate) => [candidate.occurrenceId, candidate.reasonCode, candidate.routine ?? null])).toEqual([["retinol", "item_overlap", null]]);
  });

  it("blocks other items for the routine's summed length and never blocks a step's own move", () => {
    const items = [...routine(), item("walk", "11:00", 30)];
    const forWalk = briefMoveItemBlocks(items, "walk");
    expect(forWalk).toEqual([expect.objectContaining({ ref: "cerave", title: "Skin routine", start: local("09:00"), end: local("09:30") })]);
    expect(briefMoveItemBlocks(items, "facewash").map((block) => block.ref)).toEqual(["walk"]);
    expect(briefMoveRoutineMembers(items, "retinol").map((member) => member.occurrenceId)).toEqual(["cerave", "facewash", "retinol"]);
    expect(briefMoveRoutineMembers(items, "walk").map((member) => member.occurrenceId)).toEqual(["walk"]);
  });

  it("leaves a step that was done or moved on its own out of the block", () => {
    const items = [step("cerave", 0), step("facewash", 1, { status: "completed" }), step("retinol", 2, { start: local("21:00"), end: local("21:10") })];
    expect(briefMoveRoutineMembers(items, "cerave").map((member) => member.occurrenceId)).toEqual(["cerave"]);
  });
});

describe("Daily Brief planner and day context for routines", () => {
  const at = "2026-09-20T09:00:00Z";
  const occurrence = (ref: string, order: number, scheduledFor = at): AdvisorOccurrence => ({
    ref, behaviorRef: `behavior-${ref}`, title: ref, status: "unresolved", localDate: "2026-09-20", scheduledFor,
    schedule: { kind: "exact", startTime: "09:00:00", endTime: null },
    duration: { kind: "known", seconds: 600, source: "behavior_default", sampleCount: 0, lookbackDays: 90 },
    routine: { parentBehaviorRef: "behavior-skin", parentTitle: "Skin routine", inheritParentSchedule: true, stepOrder: order },
  });
  const steps = [occurrence("cerave", 0), occurrence("facewash", 1), occurrence("retinol", 2)];

  function context(occurrences: AdvisorOccurrence[], events: AdvisorCalendarEvent[] = []): AdvisorDayContextV1 {
    return {
      version: "1.0", snapshotId: "snapshot-1", accountRef: "account-1", localDate: "2026-09-20", timezone: "UTC",
      dayStartAt: "2026-09-20T00:00:00Z", dayEndAt: "2026-09-21T00:00:00Z", capturedAt: "2026-09-20T08:00:00Z", expiresAt: "2026-09-20T08:04:00Z",
      status: "complete", authority: "read_only", grantGeneration: 1,
      cadence: {
        observedAt: "2026-09-20T08:00:00Z", revision: "cadence-1", coverage: "complete", occurrences,
        history: {
          lookbackDays: 90, startLocalDate: "2026-06-22", endLocalDateExclusive: "2026-09-20", completeness: "complete", reason: null,
          behaviors: occurrences.map((row) => ({ behaviorRef: row.behaviorRef, completedCount: 0, notCompletedCount: 0, unresolvedCount: 0 })),
        },
      },
      connectors: [{
        source: "google_calendar", state: "current", complete: true, fetchedAt: "2026-09-20T08:00:00Z", connectionGeneration: 1, selectionRevision: 1,
        schemaVersion: "1.0.0", adapterVersion: "google-calendar-v1",
        coverage: [{ calendarRef: "calendar-1", startLocalDate: "2026-09-20", endLocalDate: "2026-09-20", paginationComplete: true }],
        failure: null, events,
      }],
    };
  }

  function input(ctx: AdvisorDayContextV1, movable: readonly string[]): BriefingPlanInput {
    const window = { kind: "timed" as const, startAt: "2026-09-20T08:30:00Z", endAt: "2026-09-20T12:00:00Z", duration: { kind: "known" as const, seconds: 12_600 } };
    return {
      context: ctx, now: "2026-09-20T08:01:00Z", configurationRevision: "config-1", alternatives: 3,
      allowedSuggestionTypes: ["recap", "priority", "schedule"], fixedCommitmentsComplete: true, permittedWindows: [window],
      movableOccurrences: movable.map((occurrenceRef) => ({ occurrenceRef, permittedWindows: [window] })),
      policy: { bufferMinutes: 0, preference: "earliest" },
    };
  }

  it("finds no overlap between a routine's steps at one time", () => {
    const plan = planBriefing(input(context(steps), []));
    expect(plan.dayEvidence.findings.filter((finding) => finding.kind === "known_overlap")).toEqual([]);
  });

  it("plans the routine once, from its first step, for the summed length", () => {
    const meeting = {
      ref: "standup", calendarRef: "calendar-1", logicalInstanceRef: "instance-standup", revision: "rev-standup",
      interval: { kind: "timed" as const, startAt: "2026-09-20T09:00:00Z", endAt: "2026-09-20T09:30:00Z", duration: { kind: "known" as const, seconds: 1_800 } },
      sourceTimezone: "UTC", sourceTimezoneFallback: "none" as const, state: "confirmed" as const, availability: "busy" as const,
      currentUserResponse: "accepted" as const, recurrence: null,
    };
    const plan = planBriefing(input(context(steps, [meeting]), ["cerave", "facewash", "retinol"]));
    expect(new Set(plan.options.map((option) => option.occurrenceRef))).toEqual(new Set(["cerave"]));
    expect(plan.options[0]!.intervals.proposed.duration).toEqual({ kind: "known", seconds: 1_800 });
    expect(plan.options[0]!.constraints.fixedOccurrenceRefs).toEqual([]);
    expect(plan.rejections.filter((rejection) => rejection.code === "routine_moves_together").map((rejection) => rejection.occurrenceRef))
      .toEqual(["facewash", "retinol"]);
  });

  it("accepts a routine on an occurrence and refuses unknown routine keys", () => {
    expect(validateAdvisorDayContext(context(steps)).cadence.occurrences[0]!.routine).toEqual(steps[0]!.routine);
    const extra = context([{ ...steps[0]!, routine: { ...steps[0]!.routine!, parentId: "raw-id" } as never }]);
    expect(() => validateAdvisorDayContext(extra)).toThrow(/routine/);
  });
});
