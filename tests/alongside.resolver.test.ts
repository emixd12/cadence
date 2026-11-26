import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import {
  alongsideFormView,
  alongsideGuessWanted,
  alongsideQuestionOpen,
  pickBriefAlongsideQuestion,
  alongsideRowView,
  alongsideMayOverlap,
  calendarEventPlace,
  parseCalendarEventPlace,
  planningPlaceCatalog,
  resolveAlongside,
  resolveRoutineBlockAlongside,
} from "@cadence/core/resolvers/alongside.resolver";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
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
    expect(alongsideFormView({ setting: true, guess: false })).toEqual({ answer: "yes", guess: null, questionOpen: false });
    expect(alongsideFormView({ setting: false, guess: true })).toEqual({ answer: "no", guess: null, questionOpen: false });
  });

  it("offers the current guess only while unanswered", () => {
    expect(alongsideFormView({ setting: null, guess: true })).toEqual({ answer: "unanswered", guess: true, questionOpen: true });
    expect(alongsideFormView({ setting: undefined, guess: false })).toEqual({ answer: "unanswered", guess: false, questionOpen: false });
    expect(alongsideFormView({ setting: null, guess: null })).toEqual({ answer: "unanswered", guess: null, questionOpen: false });
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

// Ticket 360 (D33): one rule for when any surface may ask, and the brief's one question.
describe("alongsideQuestionOpen", () => {
  it("is open only while unanswered and the guess is yes", () => {
    expect(alongsideQuestionOpen({ alongside: null }, true)).toBe(true);
    expect(alongsideQuestionOpen({ alongside: undefined }, true)).toBe(true);
    expect(alongsideQuestionOpen({ alongside: null }, false)).toBe(false);
    expect(alongsideQuestionOpen({ alongside: null }, null)).toBe(false);
    expect(alongsideQuestionOpen({ alongside: null }, undefined)).toBe(false);
  });

  it("closes once the person answers either way", () => {
    expect(alongsideQuestionOpen({ alongside: true }, true)).toBe(false);
    expect(alongsideQuestionOpen({ alongside: false }, true)).toBe(false);
  });

  it("matches a guessed alongside row exactly", () => {
    for (const setting of [true, false, null] as const) {
      for (const guess of [true, false, null] as const) {
        const row = alongsideRowView(resolveAlongside({ setting, guess }));
        expect(alongsideQuestionOpen({ alongside: setting }, guess)).toBe(row?.source === "guess");
      }
    }
  });
});

describe("pickBriefAlongsideQuestion", () => {
  const item = (behaviorId: string, startAt: string, questionOpen = true, title = behaviorId) => ({ behaviorId, title, startAt, questionOpen });

  it("asks about the earliest open item only", () => {
    expect(pickBriefAlongsideQuestion({ items: [
      item("reading", "2026-11-25T23:00:00Z"),
      item("gym", "2026-11-25T12:00:00Z", false),
      item("helmet", "2026-11-25T14:00:00Z", true, "Red light helmet"),
    ] })).toEqual({ behaviorId: "helmet", title: "Red light helmet" });
  });

  it("compares instants, not text", () => {
    expect(pickBriefAlongsideQuestion({ items: [item("later", "2026-11-25T14:00:00.5Z"), item("sooner", "2026-11-25T14:00:00Z")] })?.behaviorId).toBe("sooner");
  });

  it("skips Behaviors already asked and returns null with nothing open", () => {
    const items = [item("helmet", "2026-11-25T14:00:00Z"), item("pill", "2026-11-25T15:00:00Z")];
    expect(pickBriefAlongsideQuestion({ items, askedBehaviorIds: new Set(["helmet"]) })?.behaviorId).toBe("pill");
    expect(pickBriefAlongsideQuestion({ items, askedBehaviorIds: new Set(["helmet", "pill"]) })).toBeNull();
    expect(pickBriefAlongsideQuestion({ items: [item("gym", "2026-11-25T12:00:00Z", false)] })).toBeNull();
    expect(pickBriefAlongsideQuestion({ items: [] })).toBeNull();
  });

  it("breaks a tie by title, then id, so a day always asks the same question", () => {
    const at = "2026-11-25T14:00:00Z";
    expect(pickBriefAlongsideQuestion({ items: [item("b", at, true, "Pill"), item("a", at, true, "Helmet")] })?.behaviorId).toBe("a");
    expect(pickBriefAlongsideQuestion({ items: [item("b", at, true, "Pill"), item("a", at, true, "Pill")] })?.behaviorId).toBe("a");
  });
});

// Audit fix 11 (D33): a pairing that rests on a guess is labelled as one.
describe("alongside pairing guesses", () => {
  it("names the guessed inputs and nothing when none is a guess", async () => {
    const { alongsidePairingGuesses, alongsidePairingGuessNote } = await import("@cadence/core/resolvers/alongside.resolver");
    expect(alongsidePairingGuesses({ alongsideSource: "person", where: { source: "person" } }, { where: { source: "evidence" } })).toBeNull();
    expect(alongsidePairingGuesses({ alongsideSource: "guess", where: { source: "person" } }, { where: { source: "guess" } }))
      .toEqual({ alongside: true, guestWhere: false, hostWhere: true });
    expect(alongsidePairingGuessNote(null)).toBeNull();
    expect(alongsidePairingGuessNote({ alongside: true, guestWhere: false, hostWhere: false })).toBe("alongside");
    expect(alongsidePairingGuessNote({ alongside: false, guestWhere: false, hostWhere: true })).toBe("where");
    expect(alongsidePairingGuessNote({ alongside: true, guestWhere: true, hostWhere: false })).toBe("both");
  });
});

// Ticket 384 (D37): a calendar event's coarse place, from its location text and the place-key rule.
describe("calendar event places", () => {
  const catalog = planningPlaceCatalog({ homeText: "12 Elm Street", placeTexts: ["Acme Office, 5th floor", null, "  ", "12 elm street", "Acme Office, 5th Floor"] });

  it("keys Home and the saved places, dropping blanks, duplicates and a saved place equal to Home", () => {
    expect(catalog).toEqual({ homePlaceKey: travelPlaceKey("12 Elm Street"), placeKeys: [travelPlaceKey("Acme Office, 5th floor")] });
    expect(planningPlaceCatalog({ homeText: null, placeTexts: [] })).toEqual({ homePlaceKey: null, placeKeys: [] });
  });

  it("labels Home, a saved place, or nothing", () => {
    expect(calendarEventPlace("  12 ELM   street ", catalog)).toEqual({ kind: "home" });
    expect(calendarEventPlace("acme office, 5th floor", catalog)).toEqual({ kind: "place", placeKey: travelPlaceKey("Acme Office, 5th floor") });
    // Another text for the same building is a different key: unknown, so behavior is unchanged.
    expect(calendarEventPlace("Acme Office", catalog)).toBeNull();
    expect(calendarEventPlace("https://meet.example/abc", catalog)).toBeNull();
    expect(calendarEventPlace("", catalog)).toBeNull();
    expect(calendarEventPlace(null, catalog)).toBeNull();
    expect(calendarEventPlace("12 Elm Street", null)).toBeNull();
    expect(calendarEventPlace("12 Elm Street", { homePlaceKey: null, placeKeys: [] })).toBeNull();
  });

  it("reads a request's place strictly", () => {
    const key = "a".repeat(43);
    expect(parseCalendarEventPlace({ kind: "home" })).toEqual({ kind: "home" });
    expect(parseCalendarEventPlace({ kind: "place", placeKey: key })).toEqual({ kind: "place", placeKey: key });
    for (const bad of [null, undefined, "home", [], { kind: "home", placeKey: key }, { kind: "place" }, { kind: "place", placeKey: "short" },
      { kind: "place", placeKey: key, text: "Office" }, { kind: "elsewhere" }, { kind: "unknown" }]) {
      expect(parseCalendarEventPlace(bad)).toBeNull();
    }
  });

  it("lets the same-place rule refuse an alongside item during an event somewhere else", () => {
    const office = { kind: "place" as const, placeKey: "o".repeat(43) };
    expect(alongsideMayOverlap({ where: { kind: "home" } }, { kind: "calendar", where: office })).toBe(false);
    expect(alongsideMayOverlap({ where: { kind: "elsewhere" } }, { kind: "calendar", where: { kind: "home" } })).toBe(false);
    expect(alongsideMayOverlap({ where: { kind: "home" } }, { kind: "calendar", where: { kind: "home" } })).toBe(true);
    expect(alongsideMayOverlap({ where: office }, { kind: "calendar", where: office })).toBe(true);
    expect(alongsideMayOverlap({ where: { kind: "home" } }, { kind: "calendar" })).toBe(true);
    expect(alongsideMayOverlap({ where: { kind: "anywhere" } }, { kind: "calendar", where: office })).toBe(true);
  });
});
