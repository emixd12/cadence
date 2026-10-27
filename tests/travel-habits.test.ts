import { describe, expect, it } from "vitest";

import {
  EMPTY_TRAVEL_HABITS,
  TRAVEL_HABIT_RULES,
  TravelHabitConflictError,
  describeTravelHabits,
  parseTravelHabitSaveInput,
  planTravelHabitChange,
  rememberedTravelMode,
  resolveTravelHabits,
  resolveTravelLeavePrompt,
  routedOutboundCandidates,
  travelEventRef,
  travelHabitBuffers,
  travelHabitMinuteChoices,
  travelHabitPlaceKey,
  travelHabitsFromSyncValue,
  travelHabitsToSyncValue,
  travelLeaveSubjects,
  travelPlaceLabels,
  type TravelHabitChange,
} from "../packages/core/src/services/travel-habits";
import { travelPlaceKey } from "../packages/core/src/services/travel-place-key";
import type { TravelEvidenceResult, TravelHabits } from "../packages/core/src/types/travel";

const T1 = "2026-10-22T15:00:00.000000Z";
const T2 = "2026-10-22T16:00:00.000000Z";
const T3 = "2026-10-23T16:00:00.000000Z";
const EVENT = travelEventRef("calendar", "dentist");
const GYM = travelPlaceKey("1 Gym Street");

function change(current: TravelHabits | null, value: TravelHabitChange, now: string): TravelHabits {
  return planTravelHabitChange(current, { expectedUpdatedAt: current?.updatedAt ?? null, change: value }, now);
}

describe("travel-habit rules", () => {
  it("keeps the owner-confirmed defaults and steps in one versioned constant", () => {
    expect(TRAVEL_HABIT_RULES).toMatchObject({
      version: "travel-habit-defaults@1",
      confirmedOn: "2026-10-22",
      preparation: { defaultMinutes: 10 },
      arrivalBuffer: { defaultMinutes: 5, minMinutes: 0, maxMinutes: 30, stepMinutes: 5 },
      answerMinutes: { too_early: -5, about_right: 0, too_late: 5 },
      answersPerLocalDay: 1,
      exitSeconds: 0,
      settlingSeconds: 0,
    });
    expect(travelHabitMinuteChoices("arrival_buffer")).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(travelHabitMinuteChoices("preparation").at(-1)).toBe(60);
  });

  it("uses the defaults until the user says otherwise", () => {
    expect(resolveTravelHabits(null)).toMatchObject({ preparationMinutes: 10, preparationSource: "default",
      arrivalBufferMinutes: 5, arrivalBufferSource: "default" });
    expect(travelHabitBuffers(undefined)).toEqual({ arrivalSeconds: 300, exitSeconds: 0, settlingSeconds: 0, preparationSeconds: 600 });
    expect(describeTravelHabits(null)).toEqual({
      preparation: "You usually need 10 minutes to get ready.",
      arrivalBuffer: "You like to arrive 5 minutes early.",
    });
  });

  it("edits get-ready time and the arrival buffer in steps, and null restores the default", () => {
    const prepared = change(null, { kind: "preparation", minutes: 15 }, T1);
    expect(prepared).toMatchObject({ preparationMinutes: 15, updatedAt: T1 });
    expect(describeTravelHabits(prepared).preparation).toBe("You usually need 15 minutes to get ready.");
    const reset = change(prepared, { kind: "preparation", minutes: null }, T2);
    expect(resolveTravelHabits(reset).preparationSource).toBe("default");
    expect(() => change(null, { kind: "preparation", minutes: 7 }, T1)).toThrow("5-minute steps");
    expect(() => change(null, { kind: "arrival_buffer", minutes: 35 }, T1)).toThrow("from 0 to 30 minutes");
    expect(change(null, { kind: "arrival_buffer", minutes: 0 }, T1).arrivalBufferMinutes).toBe(0);
  });

  it("rejects a change planned from stale habits", () => {
    const saved = change(null, { kind: "preparation", minutes: 20 }, T1);
    expect(() => planTravelHabitChange(saved, { expectedUpdatedAt: null, change: { kind: "preparation", minutes: 5 } }, T2))
      .toThrow(TravelHabitConflictError);
  });
});

describe("leave-time answers", () => {
  it("moves the arrival buffer by five minutes within 0–30 and keeps the answer", () => {
    const late = change(null, { kind: "leave_feedback", eventRef: EVENT, localDate: "2026-10-22", answer: "too_late" }, T1);
    expect(late.arrivalBufferMinutes).toBe(10);
    expect(late.leaveFeedback).toEqual([{ eventRef: EVENT, localDate: "2026-10-22", answer: "too_late", answeredAt: T1,
      rulesVersion: "travel-habit-defaults@1" }]);
    const early = change({ ...EMPTY_TRAVEL_HABITS, arrivalBufferMinutes: 0, updatedAt: T1 },
      { kind: "leave_feedback", eventRef: EVENT, localDate: "2026-10-22", answer: "too_early" }, T2);
    expect(early.arrivalBufferMinutes).toBe(0);
    const capped = change({ ...EMPTY_TRAVEL_HABITS, arrivalBufferMinutes: 30, updatedAt: T1 },
      { kind: "leave_feedback", eventRef: EVENT, localDate: "2026-10-22", answer: "too_late" }, T2);
    expect(capped.arrivalBufferMinutes).toBe(30);
    const right = change(null, { kind: "leave_feedback", eventRef: EVENT, localDate: "2026-10-22", answer: "about_right" }, T1);
    expect(right.arrivalBufferMinutes).toBeNull();
    expect(resolveTravelHabits(right).arrivalBufferMinutes).toBe(5);
  });

  it("accepts one answer per local day and keeps the newest thirty", () => {
    const first = change(null, { kind: "leave_feedback", eventRef: EVENT, localDate: "2026-10-22", answer: "too_late" }, T1);
    expect(() => change(first, { kind: "leave_feedback", eventRef: EVENT, localDate: "2026-10-22", answer: "too_early" }, T2))
      .toThrow("already answered");
    let habits: TravelHabits | null = null;
    for (let day = 1; day <= 31; day++) {
      const localDate = `2026-08-${String(day).padStart(2, "0")}`;
      habits = change(habits, { kind: "leave_feedback", eventRef: EVENT, localDate, answer: "about_right" },
        `${localDate}T12:00:00.000000Z`);
    }
    expect(habits!.leaveFeedback).toHaveLength(30);
    expect(habits!.leaveFeedback[0]!.localDate).toBe("2026-08-02");
  });
});

describe("travel mode per place", () => {
  it("remembers the last choice per place, forgets it, and falls back to usual travel", () => {
    const transit = change(null, { kind: "place_mode", placeKey: GYM, mode: "transit" }, T1);
    expect(rememberedTravelMode(transit, GYM)).toBe("transit");
    const cycled = change(transit, { kind: "place_mode", placeKey: GYM, mode: "cycling" }, T2);
    expect(cycled.placeModes).toEqual([{ placeKey: GYM, mode: "cycling", chosenAt: T2 }]);
    const forgotten = change(cycled, { kind: "place_mode", placeKey: GYM, mode: null }, T3);
    expect(rememberedTravelMode(forgotten, GYM)).toBeNull();
    expect(rememberedTravelMode(transit, travelPlaceKey("Elsewhere"))).toBeNull();
    expect(() => change(null, { kind: "place_mode", placeKey: "1 Gym Street", mode: "walking" }, T1)).toThrow("Choose a travel place.");
  });

  it("uses the Ticket 216 place key so differently typed text names one place", () => {
    expect(travelHabitPlaceKey(" 1  GYM street ")).toBe(GYM);
    expect(travelHabitPlaceKey("   ")).toBeNull();
    expect(travelHabitPlaceKey(null)).toBeNull();
    expect(GYM).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("keeps at most one hundred places, dropping the oldest choice", () => {
    let habits: TravelHabits | null = null;
    for (let index = 0; index < 101; index++) {
      habits = change(habits, { kind: "place_mode", placeKey: travelPlaceKey(`Place ${index}`), mode: "walking" },
        `2026-10-22T10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000000Z`);
    }
    expect(habits!.placeModes).toHaveLength(100);
    expect(rememberedTravelMode(habits, travelPlaceKey("Place 0"))).toBeNull();
    expect(rememberedTravelMode(habits, travelPlaceKey("Place 100"))).toBe("walking");
  });

  it("names remembered places from Home and Behavior places only", () => {
    const home = travelPlaceKey("10 Home Road");
    expect(travelPlaceLabels({ homeText: "10 Home Road", placeKeys: [home, GYM, travelPlaceKey("Calendar only")],
      behaviors: [{ whereKind: "place", locationText: "1 Gym Street" }, { whereKind: "anywhere", locationText: null }] }))
      .toEqual({ [home]: "Home", [GYM]: "1 Gym Street" });
  });
});

describe("stored and synchronized shape", () => {
  it("round-trips canonical snake_case values and reads pre-Ticket 217 rows as nothing learned", () => {
    const habits = change(change(null, { kind: "place_mode", placeKey: GYM, mode: "driving" }, T1),
      { kind: "leave_feedback", eventRef: EVENT, localDate: "2026-10-22", answer: "too_late" }, T2);
    const value = travelHabitsToSyncValue(habits);
    expect(value).toEqual({
      travel_preparation_minutes: null,
      travel_arrival_buffer_minutes: 10,
      travel_place_modes: [{ place_key: GYM, mode: "driving", chosen_at: T1 }],
      travel_leave_feedback: [{ event_ref: EVENT, local_date: "2026-10-22", answer: "too_late", answered_at: T2,
        rules_version: "travel-habit-defaults@1" }],
      travel_habits_updated_at: T2,
    });
    expect(travelHabitsFromSyncValue(value)).toEqual(habits);
    expect(travelHabitsFromSyncValue({ timezone: "America/New_York" })).toEqual(EMPTY_TRAVEL_HABITS);
  });

  it("rejects unordered, oversized or location-bearing entries", () => {
    const two = [travelPlaceKey("b place"), travelPlaceKey("a place")].sort().reverse();
    expect(() => travelHabitsFromSyncValue({ travel_place_modes: two.map((place_key) => ({ place_key, mode: "walking", chosen_at: T1 })),
      travel_habits_updated_at: T1 })).toThrow("canonical order");
    expect(() => travelHabitsFromSyncValue({ travel_place_modes: [{ place_key: GYM, mode: "walking", chosen_at: T1, text: "1 Gym Street" }],
      travel_habits_updated_at: T1 })).toThrow();
    expect(() => travelHabitsFromSyncValue({ travel_arrival_buffer_minutes: 45, travel_habits_updated_at: T1 })).toThrow();
    expect(() => travelHabitsFromSyncValue({ travel_leave_feedback: [{ event_ref: EVENT, local_date: "2026-10-22", answer: "too_late",
      answered_at: "2026-10-22T16:00:00Z", rules_version: "travel-habit-defaults@1" }], travel_habits_updated_at: T1 })).toThrow();
  });

  it("parses only the four supported change requests", () => {
    expect(parseTravelHabitSaveInput({ expectedUpdatedAt: null, change: { kind: "preparation", minutes: 15 } }))
      .toEqual({ expectedUpdatedAt: null, change: { kind: "preparation", minutes: 15 } });
    expect(() => parseTravelHabitSaveInput({ expectedUpdatedAt: null, change: { kind: "preparation", minutes: 15, userId: "x" } })).toThrow();
    expect(() => parseTravelHabitSaveInput({ expectedUpdatedAt: null, change: { kind: "place_mode", placeKey: GYM, mode: "flying" } })).toThrow();
    expect(() => parseTravelHabitSaveInput({ expectedUpdatedAt: null, change: { kind: "leave_feedback", eventRef: EVENT,
      localDate: "2026-10-22", answer: "late", latitude: 1 } })).toThrow();
    expect(() => parseTravelHabitSaveInput({ change: { kind: "preparation", minutes: 15 } })).toThrow();
  });
});

describe("leave-time question", () => {
  const evidence = {
    legs: [
      { leg: { id: "leg-out", role: "outbound", destinationCommitmentRef: "dentist" }, state: "current", estimate: {}, reason: null },
      { leg: { id: "leg-on", role: "onward", destinationCommitmentRef: "gym" }, state: "current", estimate: {}, reason: null },
      { leg: { id: "leg-later", role: "outbound", destinationCommitmentRef: "late" }, state: "unavailable", estimate: null, reason: "x" },
    ],
    segments: [{ id: "commitment:dentist", kind: "commitment", startAt: "2026-10-22T14:00:00Z", endAt: "2026-10-22T15:00:00Z",
      sourceRefs: ["dentist"], legId: null }],
  } as unknown as TravelEvidenceResult;
  const subjects = travelLeaveSubjects({ localDate: "2026-10-22", evidence,
    events: [{ id: "dentist", title: "Dentist", kind: "timed", startAt: "2026-10-22T14:00:00Z", endAt: "2026-10-22T15:00:00Z" },
      { id: "late", title: "Late", kind: "timed", startAt: "2026-10-22T20:00:00Z", endAt: "2026-10-22T21:00:00Z" }],
    occurrences: [{ id: "gym", title: "Gym", scheduledFor: "2026-10-22T16:00:00Z", localDate: "2026-10-22" }] });
  const candidates = routedOutboundCandidates(evidence, subjects);

  it("asks only about journeys with a current, routed outbound leg", () => {
    expect(candidates).toEqual([{ kind: "calendar", ref: "dentist", title: "Dentist", localDate: "2026-10-22", endsAt: "2026-10-22T15:00:00Z" }]);
  });

  it("waits for the event to end, then asks once that day", () => {
    const ask = (now: string, habits: TravelHabits | null = null, dismissed = false) =>
      resolveTravelLeavePrompt({ now, localDate: "2026-10-22", habits, candidates, dismissed });
    expect(ask("2026-10-22T14:30:00Z")).toBeNull();
    expect(ask("2026-10-22T15:00:00Z")).toMatchObject({ ref: "dentist", title: "Dentist", eventRef: travelEventRef("calendar", "dentist") });
    expect(ask("2026-10-22T15:00:00Z", null, true)).toBeNull();
    const answered = change(null, { kind: "leave_feedback", eventRef: EVENT, localDate: "2026-10-22", answer: "about_right" }, T1);
    expect(ask("2026-10-22T18:00:00Z", answered)).toBeNull();
    expect(resolveTravelLeavePrompt({ now: "2026-10-23T09:00:00Z", localDate: "2026-10-23", habits: answered, candidates, dismissed: false })).toBeNull();
  });

  it("keeps event references free of titles, times and places", () => {
    expect(EVENT).toMatch(/^[a-f0-9]{64}$/);
    expect(EVENT).not.toContain("dentist");
  });
});
