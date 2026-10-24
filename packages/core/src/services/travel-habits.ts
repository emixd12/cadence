import { Temporal } from "@js-temporal/polyfill";

import { sha256 } from "../hash";
import type {
  TravelBuffers,
  TravelEvidenceResult,
  TravelHabits,
  TravelLeaveAnswer,
  TravelLeaveFeedback,
  TravelMode,
  TravelPlaceMode,
} from "../types/travel";
import { normalizeTravelPlaceText } from "./travel-refresh-policy";
import { TRAVEL_PLACE_KEY_PATTERN, travelPlaceKey } from "./travel-place-key";
import { canonicalTravelInstant } from "./travel-settings";

/**
 * Ticket 217 travel-habit rules. Change a value only by adding a new version, so
 * every stored answer names the rules that applied when it was given.
 *
 * Owner-confirmed on October 22, 2026: get-ready time 10 minutes, arrival buffer
 * 5 minutes, each "too late" or "too early" answer adds or removes 5 minutes
 * within 0–30 minutes, at most one question a day, dismissing records nothing,
 * and exit and settling buffers stay zero.
 *
 * Cadence assumptions, not owner-confirmed: get-ready time is editable from 0 to
 * 60 minutes in 5-minute steps, the newest 30 answers are kept, and at most 100
 * places keep a remembered mode.
 */
export const TRAVEL_HABIT_RULES = {
  version: "travel-habit-defaults@1",
  confirmedOn: "2026-10-22",
  preparation: { defaultMinutes: 10, minMinutes: 0, maxMinutes: 60, stepMinutes: 5 },
  arrivalBuffer: { defaultMinutes: 5, minMinutes: 0, maxMinutes: 30, stepMinutes: 5 },
  answerMinutes: { too_early: -5, about_right: 0, too_late: 5 },
  answersPerLocalDay: 1,
  retainedAnswers: 30,
  exitSeconds: 0,
  settlingSeconds: 0,
  maxRememberedPlaces: 100,
} as const satisfies Readonly<{
  version: string;
  confirmedOn: string;
  preparation: TravelHabitRange;
  arrivalBuffer: TravelHabitRange;
  answerMinutes: Readonly<Record<TravelLeaveAnswer, number>>;
  answersPerLocalDay: number;
  retainedAnswers: number;
  exitSeconds: number;
  settlingSeconds: number;
  maxRememberedPlaces: number;
}>;

type TravelHabitRange = Readonly<{ defaultMinutes: number; minMinutes: number; maxMinutes: number; stepMinutes: number }>;

export const TRAVEL_LEAVE_ANSWERS: readonly TravelLeaveAnswer[] = ["too_early", "about_right", "too_late"];
const TRAVEL_MODES: readonly TravelMode[] = ["walking", "cycling", "transit", "driving"];
const DIGEST = /^[a-f0-9]{64}$/;
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export const EMPTY_TRAVEL_HABITS: TravelHabits = Object.freeze({
  preparationMinutes: null,
  arrivalBufferMinutes: null,
  placeModes: Object.freeze([]) as readonly TravelPlaceMode[],
  leaveFeedback: Object.freeze([]) as readonly TravelLeaveFeedback[],
  updatedAt: null,
});

export type ResolvedTravelHabits = Readonly<{
  rulesVersion: typeof TRAVEL_HABIT_RULES.version;
  preparationMinutes: number;
  preparationSource: "default" | "learned";
  arrivalBufferMinutes: number;
  arrivalBufferSource: "default" | "learned";
  buffers: Required<TravelBuffers>;
}>;

/** Effective values: stored minutes when present, otherwise the versioned defaults. */
export function resolveTravelHabits(habits: TravelHabits | null | undefined): ResolvedTravelHabits {
  const value = habits ?? EMPTY_TRAVEL_HABITS;
  validateTravelHabits(value);
  const preparationMinutes = value.preparationMinutes ?? TRAVEL_HABIT_RULES.preparation.defaultMinutes;
  const arrivalBufferMinutes = value.arrivalBufferMinutes ?? TRAVEL_HABIT_RULES.arrivalBuffer.defaultMinutes;
  return {
    rulesVersion: TRAVEL_HABIT_RULES.version,
    preparationMinutes,
    preparationSource: value.preparationMinutes === null ? "default" : "learned",
    arrivalBufferMinutes,
    arrivalBufferSource: value.arrivalBufferMinutes === null ? "default" : "learned",
    buffers: {
      arrivalSeconds: arrivalBufferMinutes * 60,
      exitSeconds: TRAVEL_HABIT_RULES.exitSeconds,
      settlingSeconds: TRAVEL_HABIT_RULES.settlingSeconds,
      preparationSeconds: preparationMinutes * 60,
    },
  };
}

/** Production buffers for the travel resolver. */
export function travelHabitBuffers(habits: TravelHabits | null | undefined): Required<TravelBuffers> {
  return resolveTravelHabits(habits).buffers;
}

/**
 * The Ticket 216 place key (the place-cache `text_key`) of typed place text, so a
 * remembered mode and a completion label name the same place. Blank text names no place.
 */
export function travelHabitPlaceKey(text: string | null | undefined): string | null {
  return text && normalizeTravelPlaceText(text) ? travelPlaceKey(text) : null;
}

/** A digest of one event's identity. It keeps no title, time or location. */
export function travelEventRef(kind: "calendar" | "behavior", ref: string): string {
  if (!ref.trim()) throw new Error("A travel event reference needs an ID.");
  return sha256(`${kind}:${ref}`);
}

/** The remembered mode for a place, or null to fall back to usual travel. */
export function rememberedTravelMode(habits: TravelHabits | null | undefined, placeKey: string | null | undefined): TravelMode | null {
  if (!placeKey) return null;
  return habits?.placeModes.find((entry) => entry.placeKey === placeKey)?.mode ?? null;
}

export type TravelHabitChange =
  | Readonly<{ kind: "preparation"; minutes: number | null }>
  | Readonly<{ kind: "arrival_buffer"; minutes: number | null }>
  | Readonly<{ kind: "place_mode"; placeKey: string; mode: TravelMode | null }>
  | Readonly<{ kind: "leave_feedback"; eventRef: string; localDate: string; answer: TravelLeaveAnswer }>;

export type TravelHabitSaveInput = Readonly<{
  expectedUpdatedAt: string | null;
  change: TravelHabitChange;
}>;

export class TravelHabitConflictError extends Error {
  constructor() {
    super("Travel habits changed after they were loaded.");
    this.name = "TravelHabitConflictError";
  }
}

/**
 * Applies one user-authored change. Null minutes restore the default; a null mode
 * forgets the place. An answer moves the arrival buffer by the versioned step,
 * within its range, and is accepted once per local day.
 */
export function planTravelHabitChange(current: TravelHabits | null | undefined, input: TravelHabitSaveInput, now: string): TravelHabits {
  const habits = current ?? EMPTY_TRAVEL_HABITS;
  validateTravelHabits(habits);
  if (input.expectedUpdatedAt !== habits.updatedAt) throw new TravelHabitConflictError();
  const at = canonicalInstant(now, "The travel habits timestamp is invalid.");
  const change = input.change;
  let next: TravelHabits;
  switch (change.kind) {
    case "preparation":
      next = { ...habits, preparationMinutes: allowedMinutes(change.minutes, TRAVEL_HABIT_RULES.preparation, "get-ready time") };
      break;
    case "arrival_buffer":
      next = { ...habits, arrivalBufferMinutes: allowedMinutes(change.minutes, TRAVEL_HABIT_RULES.arrivalBuffer, "arrival buffer") };
      break;
    case "place_mode": {
      if (!TRAVEL_PLACE_KEY_PATTERN.test(change.placeKey)) throw new Error("Choose a travel place.");
      if (change.mode !== null && !TRAVEL_MODES.includes(change.mode)) throw new Error("Choose a supported travel mode.");
      const others = habits.placeModes.filter((entry) => entry.placeKey !== change.placeKey);
      const placeModes = change.mode === null ? others : [...others, { placeKey: change.placeKey, mode: change.mode, chosenAt: at }];
      next = { ...habits, placeModes: newest(placeModes, TRAVEL_HABIT_RULES.maxRememberedPlaces, (entry) => entry.chosenAt) };
      break;
    }
    case "leave_feedback": {
      if (!DIGEST.test(change.eventRef)) throw new Error("Choose a travel event.");
      if (!TRAVEL_LEAVE_ANSWERS.includes(change.answer)) throw new Error("Choose a supported answer.");
      localDate(change.localDate);
      const answeredToday = habits.leaveFeedback.filter((entry) => entry.localDate === change.localDate).length;
      if (answeredToday >= TRAVEL_HABIT_RULES.answersPerLocalDay) throw new Error("Today's leave time was already answered.");
      const step = TRAVEL_HABIT_RULES.answerMinutes[change.answer];
      const range = TRAVEL_HABIT_RULES.arrivalBuffer;
      const effective = habits.arrivalBufferMinutes ?? range.defaultMinutes;
      const arrivalBufferMinutes = step === 0 ? habits.arrivalBufferMinutes
        : Math.min(range.maxMinutes, Math.max(range.minMinutes, effective + step));
      const answer: TravelLeaveFeedback = { eventRef: change.eventRef, localDate: change.localDate, answer: change.answer,
        answeredAt: at, rulesVersion: TRAVEL_HABIT_RULES.version };
      next = { ...habits, arrivalBufferMinutes,
        leaveFeedback: newest([...habits.leaveFeedback, answer], TRAVEL_HABIT_RULES.retainedAnswers, (entry) => entry.answeredAt) };
      break;
    }
    default:
      throw new Error("Choose a supported travel habit change.");
  }
  return canonicalTravelHabits({ ...next, updatedAt: at });
}

/** Deterministic order and shape, so every platform stores and compares identical values. */
export function canonicalTravelHabits(habits: TravelHabits): TravelHabits {
  return {
    preparationMinutes: habits.preparationMinutes,
    arrivalBufferMinutes: habits.arrivalBufferMinutes,
    placeModes: [...habits.placeModes]
      .map((entry) => ({ placeKey: entry.placeKey, mode: entry.mode, chosenAt: entry.chosenAt }))
      .sort((left, right) => compareText(left.placeKey, right.placeKey)),
    leaveFeedback: [...habits.leaveFeedback]
      .map((entry) => ({ eventRef: entry.eventRef, localDate: entry.localDate, answer: entry.answer,
        answeredAt: entry.answeredAt, rulesVersion: entry.rulesVersion }))
      .sort((left, right) => compareText(left.localDate, right.localDate) || compareText(left.answeredAt, right.answeredAt)
        || compareText(left.eventRef, right.eventRef)),
    updatedAt: habits.updatedAt,
  };
}

export function validateTravelHabits(habits: TravelHabits): void {
  if (!habits || typeof habits !== "object") throw new Error("Travel habits are invalid.");
  rangeValue(habits.preparationMinutes, TRAVEL_HABIT_RULES.preparation);
  rangeValue(habits.arrivalBufferMinutes, TRAVEL_HABIT_RULES.arrivalBuffer);
  if (habits.updatedAt !== null && !CANONICAL_INSTANT.test(habits.updatedAt)) throw new Error("Travel habits are invalid.");
  if (!Array.isArray(habits.placeModes) || habits.placeModes.length > TRAVEL_HABIT_RULES.maxRememberedPlaces) {
    throw new Error("Travel habits are invalid.");
  }
  const places = new Set<string>();
  for (const entry of habits.placeModes) {
    if (!entry || !TRAVEL_PLACE_KEY_PATTERN.test(entry.placeKey) || places.has(entry.placeKey) || !TRAVEL_MODES.includes(entry.mode)
      || !CANONICAL_INSTANT.test(entry.chosenAt)) throw new Error("Travel habits are invalid.");
    places.add(entry.placeKey);
  }
  if (!Array.isArray(habits.leaveFeedback) || habits.leaveFeedback.length > TRAVEL_HABIT_RULES.retainedAnswers) {
    throw new Error("Travel habits are invalid.");
  }
  const dates = new Map<string, number>();
  for (const entry of habits.leaveFeedback) {
    if (!entry || !DIGEST.test(entry.eventRef) || !TRAVEL_LEAVE_ANSWERS.includes(entry.answer)
      || !CANONICAL_INSTANT.test(entry.answeredAt) || typeof entry.rulesVersion !== "string"
      || !/^travel-habit-defaults@[1-9][0-9]*$/.test(entry.rulesVersion)) throw new Error("Travel habits are invalid.");
    localDate(entry.localDate);
    dates.set(entry.localDate, (dates.get(entry.localDate) ?? 0) + 1);
  }
  if ([...dates.values()].some((count) => count > TRAVEL_HABIT_RULES.answersPerLocalDay)) throw new Error("Travel habits are invalid.");
}

/** Whether today's leave-time question was already answered. Dismissals are never stored. */
export function travelLeaveAnsweredOn(habits: TravelHabits | null | undefined, localDateValue: string): boolean {
  return Boolean(habits?.leaveFeedback.some((entry) => entry.localDate === localDateValue));
}

/** A journey that had a routed outbound leg while the Timeline showed it. */
export type TravelLeaveCandidate = Readonly<{
  kind: "calendar" | "behavior";
  ref: string;
  title: string;
  localDate: string;
  /** The event's end when known, otherwise its start. The question waits until then. */
  endsAt: string;
}>;

export type TravelLeaveSubject = Readonly<{
  kind: "calendar" | "behavior";
  ref: string;
  title: string;
  localDate: string;
  startAt: string;
  endAt: string | null;
}>;

/** Journeys with a current, routed outbound leg in this evidence. */
export function routedOutboundCandidates(
  evidence: Pick<TravelEvidenceResult, "legs"> | null | undefined,
  subjects: readonly TravelLeaveSubject[],
): TravelLeaveCandidate[] {
  if (!evidence) return [];
  const byRef = new Map(subjects.map((subject) => [subject.ref, subject]));
  return evidence.legs.flatMap(({ leg, state, estimate }) => {
    if (leg.role !== "outbound" || state !== "current" || !estimate || !leg.destinationCommitmentRef) return [];
    const subject = byRef.get(leg.destinationCommitmentRef);
    return subject ? [{ kind: subject.kind, ref: subject.ref, title: subject.title, localDate: subject.localDate,
      endsAt: subject.endAt ?? subject.startAt }] : [];
  });
}

export type TravelLeavePrompt = TravelLeaveCandidate & Readonly<{ eventRef: string }>;

/**
 * Ticket 217: after a journey with a routed outbound leg, ask once that day.
 * The most recently finished journey wins. No question when today was answered
 * or dismissed in this session.
 */
export function resolveTravelLeavePrompt(input: Readonly<{
  now: string;
  localDate: string;
  habits: TravelHabits | null | undefined;
  candidates: readonly TravelLeaveCandidate[];
  dismissed: boolean;
}>): TravelLeavePrompt | null {
  const now = Temporal.Instant.from(input.now);
  if (input.dismissed || travelLeaveAnsweredOn(input.habits, input.localDate)) return null;
  const finished = input.candidates.filter((candidate) => {
    if (candidate.localDate !== input.localDate) return false;
    try { return Temporal.Instant.compare(Temporal.Instant.from(candidate.endsAt), now) <= 0; }
    catch { return false; }
  }).sort((left, right) => Temporal.Instant.compare(Temporal.Instant.from(right.endsAt), Temporal.Instant.from(left.endsAt))
    || compareText(left.ref, right.ref));
  const chosen = finished[0];
  return chosen ? { ...chosen, eventRef: travelEventRef(chosen.kind, chosen.ref) } : null;
}

const MODE_VERBS: Readonly<Record<TravelMode, string>> = { walking: "walk", cycling: "cycle", transit: "take transit", driving: "drive" };

/** Plain words for Travel Settings, for example "You usually need 15 minutes to get ready." */
export function describeTravelHabits(habits: TravelHabits | null | undefined): Readonly<{ preparation: string; arrivalBuffer: string }> {
  const resolved = resolveTravelHabits(habits);
  return {
    preparation: `You usually need ${minutesLabel(resolved.preparationMinutes)} to get ready.`,
    arrivalBuffer: `You like to arrive ${travelArrivalPhrase(resolved.arrivalBufferMinutes)}.`,
  };
}

/** "on time" or "5 minutes early". */
export function travelArrivalPhrase(minutes: number): string {
  return minutes === 0 ? "on time" : `${minutesLabel(minutes)} early`;
}

export function travelModeVerb(mode: TravelMode): string {
  return MODE_VERBS[mode];
}

/** Choices for an inline minutes edit, in the rule's steps. */
export function travelHabitMinuteChoices(kind: "preparation" | "arrival_buffer"): readonly number[] {
  const range = kind === "preparation" ? TRAVEL_HABIT_RULES.preparation : TRAVEL_HABIT_RULES.arrivalBuffer;
  const values: number[] = [];
  for (let value = range.minMinutes; value <= range.maxMinutes; value += range.stepMinutes) values.push(value);
  return values;
}

export function minutesLabel(minutes: number): string {
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function allowedMinutes(minutes: number | null, range: TravelHabitRange, label: string): number | null {
  if (minutes === null) return null;
  if (!Number.isInteger(minutes) || minutes < range.minMinutes || minutes > range.maxMinutes || minutes % range.stepMinutes !== 0) {
    throw new Error(`Choose a ${label} from ${range.minMinutes} to ${range.maxMinutes} minutes in ${range.stepMinutes}-minute steps.`);
  }
  return minutes;
}

function rangeValue(minutes: number | null, range: TravelHabitRange): void {
  if (minutes === null) return;
  if (!Number.isInteger(minutes) || minutes < range.minMinutes || minutes > range.maxMinutes) throw new Error("Travel habits are invalid.");
}

function newest<T>(entries: readonly T[], limit: number, at: (entry: T) => string): T[] {
  return [...entries].sort((left, right) => compareText(at(right), at(left))).slice(0, limit);
}

function canonicalInstant(value: string, message: string): string {
  try { return canonicalTravelInstant(value); }
  catch { throw new Error(message); }
}

function localDate(value: string): void {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Temporal.PlainDate.from(value).toString() !== value) throw new Error();
  } catch { throw new Error("The travel answer date is invalid."); }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Ticket 217 keys inside the synchronized `profile` value (Ticket 162 keeps travel preferences there). */
export const TRAVEL_HABIT_SYNC_KEYS = [
  "travel_preparation_minutes",
  "travel_arrival_buffer_minutes",
  "travel_place_modes",
  "travel_leave_feedback",
  "travel_habits_updated_at",
] as const;

type SyncJson = null | boolean | number | string | SyncJson[] | { [key: string]: SyncJson };
export type TravelHabitSyncValue = Readonly<{
  travel_preparation_minutes: number | null;
  travel_arrival_buffer_minutes: number | null;
  travel_place_modes: { place_key: string; mode: TravelMode; chosen_at: string }[];
  travel_leave_feedback: { event_ref: string; local_date: string; answer: TravelLeaveAnswer; answered_at: string; rules_version: string }[];
  travel_habits_updated_at: string | null;
}>;

/** Stored and synchronized shape: snake_case entries in deterministic order. */
export function travelHabitsToSyncValue(habits: TravelHabits | null | undefined): TravelHabitSyncValue {
  const value = canonicalTravelHabits(habits ?? EMPTY_TRAVEL_HABITS);
  validateTravelHabits(value);
  return {
    travel_preparation_minutes: value.preparationMinutes,
    travel_arrival_buffer_minutes: value.arrivalBufferMinutes,
    travel_place_modes: value.placeModes.map((entry) => ({ place_key: entry.placeKey, mode: entry.mode, chosen_at: entry.chosenAt })),
    travel_leave_feedback: value.leaveFeedback.map((entry) => ({ event_ref: entry.eventRef, local_date: entry.localDate,
      answer: entry.answer, answered_at: entry.answeredAt, rules_version: entry.rulesVersion })),
    travel_habits_updated_at: value.updatedAt,
  };
}

/**
 * Reads the stored or synchronized shape. Missing keys come from rows written
 * before Ticket 217 and mean nothing learned. Entry order must already be canonical.
 */
export function travelHabitsFromSyncValue(value: Readonly<Record<string, unknown>>): TravelHabits {
  const placeModes = value.travel_place_modes ?? [];
  const leaveFeedback = value.travel_leave_feedback ?? [];
  if (!Array.isArray(placeModes) || !Array.isArray(leaveFeedback)) throw new Error("Travel habits are invalid.");
  const habits: TravelHabits = {
    preparationMinutes: nullableInteger(value.travel_preparation_minutes),
    arrivalBufferMinutes: nullableInteger(value.travel_arrival_buffer_minutes),
    placeModes: placeModes.map((entry: unknown) => {
      const row = exactRecord(entry, ["place_key", "mode", "chosen_at"]);
      return { placeKey: String(row.place_key), mode: row.mode as TravelMode, chosenAt: String(row.chosen_at) };
    }),
    leaveFeedback: leaveFeedback.map((entry: unknown) => {
      const row = exactRecord(entry, ["event_ref", "local_date", "answer", "answered_at", "rules_version"]);
      return { eventRef: String(row.event_ref), localDate: String(row.local_date), answer: row.answer as TravelLeaveAnswer,
        answeredAt: String(row.answered_at), rulesVersion: String(row.rules_version) };
    }),
    updatedAt: value.travel_habits_updated_at === undefined || value.travel_habits_updated_at === null
      ? null : canonicalInstant(String(value.travel_habits_updated_at), "Travel habits are invalid."),
  };
  validateTravelHabits(habits);
  if (JSON.stringify(canonicalTravelHabits(habits)) !== JSON.stringify(habits)) throw new Error("Travel habits are not in canonical order.");
  return habits;
}

export function travelHabitSyncJson(habits: TravelHabits | null | undefined): { [key: string]: SyncJson } {
  return travelHabitsToSyncValue(habits) as unknown as { [key: string]: SyncJson };
}

function nullableInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error("Travel habits are invalid.");
  return value;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Travel habits are invalid.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => typeof record[key] !== "string")) {
    throw new Error("Travel habits are invalid.");
  }
  return record;
}

/** Strict request shape for a habit change; the planner checks the values. */
export function parseTravelHabitSaveInput(value: unknown): TravelHabitSaveInput {
  const invalid = () => new Error("Travel habits are invalid.");
  if (!plainRecord(value) || Object.keys(value).length !== 2 || !("expectedUpdatedAt" in value) || !plainRecord(value.change)) throw invalid();
  const expectedUpdatedAt = value.expectedUpdatedAt;
  if (expectedUpdatedAt !== null && typeof expectedUpdatedAt !== "string") throw invalid();
  const change = value.change;
  const keys = Object.keys(change).sort().join(",");
  switch (change.kind) {
    case "preparation":
    case "arrival_buffer":
      if (keys !== "kind,minutes" || !(change.minutes === null || typeof change.minutes === "number")) throw invalid();
      return { expectedUpdatedAt, change: { kind: change.kind, minutes: change.minutes } };
    case "place_mode":
      if (keys !== "kind,mode,placeKey" || typeof change.placeKey !== "string"
        || !(change.mode === null || (typeof change.mode === "string" && TRAVEL_MODES.includes(change.mode as TravelMode)))) throw invalid();
      return { expectedUpdatedAt, change: { kind: "place_mode", placeKey: change.placeKey, mode: change.mode as TravelMode | null } };
    case "leave_feedback":
      if (keys !== "answer,eventRef,kind,localDate" || typeof change.eventRef !== "string" || typeof change.localDate !== "string"
        || typeof change.answer !== "string" || !TRAVEL_LEAVE_ANSWERS.includes(change.answer as TravelLeaveAnswer)) throw invalid();
      return { expectedUpdatedAt, change: { kind: "leave_feedback", eventRef: change.eventRef, localDate: change.localDate,
        answer: change.answer as TravelLeaveAnswer } };
    default:
      throw invalid();
  }
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Names for remembered places in Travel Settings: "Home" or the Behavior's own
 * place text. Calendar-only places stay unnamed; Cadence keeps no text for them.
 */
export function travelPlaceLabels(input: Readonly<{
  homeText: string | null;
  behaviors: readonly Readonly<{ whereKind: string | null; locationText: string | null }>[];
  placeKeys: readonly string[];
}>): Record<string, string> {
  const wanted = new Set(input.placeKeys);
  const labels: Record<string, string> = {};
  const home = travelHabitPlaceKey(input.homeText);
  if (home && wanted.has(home)) labels[home] = "Home";
  for (const behavior of input.behaviors) {
    if (behavior.whereKind !== "place") continue;
    const key = travelHabitPlaceKey(behavior.locationText);
    if (key && wanted.has(key) && !labels[key]) labels[key] = behavior.locationText!.trim();
  }
  return labels;
}

/** Today's Calendar events and Behavior occurrences as leave-time subjects; ends come from the evidence when known. */
export function travelLeaveSubjects(input: Readonly<{
  localDate: string;
  evidence: Pick<TravelEvidenceResult, "segments"> | null | undefined;
  events: readonly Readonly<{ id: string; title: string; kind: string; startAt?: string; endAt?: string; endUnspecified?: boolean }>[];
  occurrences: readonly Readonly<{ id: string; title: string; scheduledFor: string; localDate: string }>[];
}>): TravelLeaveSubject[] {
  const ends = new Map((input.evidence?.segments ?? []).filter((segment) => segment.kind === "commitment")
    .map((segment) => [segment.sourceRefs[0], segment.endAt] as const));
  return [
    ...input.events.flatMap((event) => event.kind === "timed" && event.startAt ? [{ kind: "calendar" as const, ref: event.id,
      title: event.title || "Untitled event", localDate: input.localDate, startAt: event.startAt,
      endAt: ends.get(event.id) ?? (event.endUnspecified ? null : event.endAt ?? null) }] : []),
    ...input.occurrences.filter((occurrence) => occurrence.localDate === input.localDate).map((occurrence) => ({
      kind: "behavior" as const, ref: occurrence.id, title: occurrence.title, localDate: occurrence.localDate,
      startAt: occurrence.scheduledFor, endAt: ends.get(occurrence.id) ?? null })),
  ];
}
