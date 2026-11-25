import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import {
  alongsideFormView,
  alongsideGuessWanted,
  alongsideRowView,
  resolveAlongside,
  resolveRoutineBlockAlongside,
} from "@cadence/core/resolvers/alongside.resolver";
import * as compatibility from "@/lib/resolvers/alongside.resolver";
import { collapseBriefMoveRoutines, type BriefMoveDayItem } from "@cadence/core/resolvers/brief-move.resolver";

// Ticket 356 (D33): the person's answer wins, then the cached guess, then false.

describe("resolveAlongside", () => {
  it("uses the person's answer over any guess", () => {
    expect(resolveAlongside({ setting: true, guess: false })).toEqual({ value: true, source: "person" });
    expect(resolveAlongside({ setting: false, guess: true })).toEqual({ value: false, source: "person" });
    expect(resolveAlongside({ setting: false, guess: null })).toEqual({ value: false, source: "person" });
  });

  it("uses the cached guess while the answer is missing", () => {
    expect(resolveAlongside({ setting: null, guess: true })).toEqual({ value: true, source: "guess" });
    expect(resolveAlongside({ setting: undefined, guess: false })).toEqual({ value: false, source: "guess" });
  });

  it("is false by default with neither", () => {
    expect(resolveAlongside({ setting: null, guess: null })).toEqual({ value: false, source: "default" });
    expect(resolveAlongside({ setting: undefined, guess: undefined })).toEqual({ value: false, source: "default" });
  });

  it("is re-exported from lib/resolvers", () => {
    expect(compatibility.resolveAlongside).toBe(resolveAlongside);
  });
});

describe("alongsideGuessWanted", () => {
  it("asks the model only while the person has not answered", () => {
    expect(alongsideGuessWanted(null)).toBe(true);
    expect(alongsideGuessWanted(undefined)).toBe(true);
    expect(alongsideGuessWanted(true)).toBe(false);
    expect(alongsideGuessWanted(false)).toBe(false);
  });
});

describe("resolveRoutineBlockAlongside", () => {
  it("is alongside only when every step is", () => {
    expect(resolveRoutineBlockAlongside([
      { alongside: true, alongsideSource: "person" }, { alongside: true, alongsideSource: "person" },
    ])).toEqual({ value: true, source: "person" });
    expect(resolveRoutineBlockAlongside([
      { alongside: true, alongsideSource: "person" }, { alongside: false, alongsideSource: "default" },
    ])).toEqual({ value: false, source: "default" });
  });

  it("labels an alongside block a guess when any step's value is a guess", () => {
    expect(resolveRoutineBlockAlongside([
      { alongside: true, alongsideSource: "person" }, { alongside: true, alongsideSource: "guess" },
    ])).toEqual({ value: true, source: "guess" });
  });

  it("names the first step that blocks as the reason", () => {
    expect(resolveRoutineBlockAlongside([
      { alongside: true, alongsideSource: "guess" }, { alongside: false, alongsideSource: "person" }, { alongside: false, alongsideSource: "guess" },
    ])).toEqual({ value: false, source: "person" });
  });

  it("reads steps without a source as before Ticket 356", () => {
    expect(resolveRoutineBlockAlongside([{ alongside: true }, { alongside: true }])).toEqual({ value: true, source: "guess" });
    expect(resolveRoutineBlockAlongside([{ alongside: true }, { alongside: false }])).toEqual({ value: false, source: "default" });
  });
});

describe("collapseBriefMoveRoutines reads the block rule", () => {
  const TZ = "America/New_York";
  const DAY = "2026-11-25";
  const at = Temporal.PlainDateTime.from(`${DAY}T09:00`).toZonedDateTime(TZ).toInstant();
  const step = (id: string, order: number, extra: Partial<BriefMoveDayItem>): BriefMoveDayItem => ({
    occurrenceId: id, behaviorId: `b-${id}`, title: id, status: "unresolved", localDate: DAY, scheduleKind: "exact",
    start: at, end: at.add({ minutes: 10 }), length: { minutes: 10, source: "behavior_duration", assumed: false },
    alongside: false, revision: "r", behaviorRevision: "br",
    routine: { parentBehaviorId: "skin", parentTitle: "Skin routine", inheritParentSchedule: true, stepOrder: order }, ...extra,
  });

  it("keeps the block's source when its steps carry one", () => {
    const [block] = collapseBriefMoveRoutines([
      step("serum", 0, { alongside: true, alongsideSource: "person" }), step("helmet", 1, { alongside: true, alongsideSource: "guess" }),
    ]);
    expect(block).toMatchObject({ alongside: true, alongsideSource: "guess" });
  });

  it("adds no source to a block whose steps have none", () => {
    const [block] = collapseBriefMoveRoutines([step("serum", 0, { alongside: true }), step("wash", 1, {})]);
    expect(block!.alongside).toBe(false);
    expect(block).not.toHaveProperty("alongsideSource");
  });
});

// Ticket 358 (D33): the form's three states and the Timeline row's label facts.
describe("alongsideFormView", () => {
  it("shows the person's answer and no guess once answered", () => {
    expect(alongsideFormView({ setting: true, guess: false })).toEqual({ answer: "yes", guess: null });
    expect(alongsideFormView({ setting: false, guess: true })).toEqual({ answer: "no", guess: null });
  });

  it("offers the current guess only while unanswered", () => {
    expect(alongsideFormView({ setting: null, guess: true })).toEqual({ answer: "unanswered", guess: true });
    expect(alongsideFormView({ setting: undefined, guess: false })).toEqual({ answer: "unanswered", guess: false });
    expect(alongsideFormView({ setting: null, guess: null })).toEqual({ answer: "unanswered", guess: null });
  });
});

describe("alongsideRowView", () => {
  it("labels only alongside values and says when the value is a guess", () => {
    expect(alongsideRowView(resolveAlongside({ setting: true, guess: null }))).toEqual({ source: "person" });
    expect(alongsideRowView(resolveAlongside({ setting: null, guess: true }))).toEqual({ source: "guess" });
    expect(alongsideRowView(resolveAlongside({ setting: false, guess: true }))).toBeNull();
    expect(alongsideRowView(resolveAlongside({ setting: null, guess: false }))).toBeNull();
    expect(alongsideRowView(resolveAlongside({ setting: null, guess: null }))).toBeNull();
  });

  it("carries the effective Where kind and place key, never its source", () => {
    expect(alongsideRowView({ value: true, source: "person" }, { kind: "place", placeKey: "k".repeat(43), source: "evidence" } as never))
      .toEqual({ source: "person", where: { kind: "place", placeKey: "k".repeat(43) } });
    expect(alongsideRowView({ value: true, source: "guess" }, { kind: "home" }))
      .toEqual({ source: "guess", where: { kind: "home" } });
  });
});
