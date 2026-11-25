import { Temporal } from "@js-temporal/polyfill";

import type { BehaviorWhereKind } from "../types/behavior";
import { isPlaceLabelValue, placeRefForWhere, savedPlaceKey } from "./place-label.resolver";

/**
 * Ticket 357 (docs/DECISIONS.md, 2026-11-25, D33): the place planning assumes for a
 * Behavior, its effective Where, with the reason it is known.
 *
 * Order:
 *   1. The person's Where (`behaviors.where_kind`): `person`.
 *   2. Counted completion place labels (`completion_place_labels`) inside the evidence
 *      period, when at least `EFFECTIVE_WHERE_EVIDENCE_MINIMUM_LABELS` exist and one
 *      label holds at least `EFFECTIVE_WHERE_EVIDENCE_MAJORITY_PERCENT` of them:
 *      `evidence`.
 *   3. The cached model guess (`behavior_advisor_estimates.where_guess`), one of
 *      `home`, `anywhere` or `elsewhere`: `guess`. A guess of `unknown` is no guess.
 *   4. Otherwise `unknown`: `none`.
 *
 * Planning only. A Where from evidence or a guess never requests a route, a departure
 * line or a leave reminder: travel code reads `behaviors.where_kind` alone
 * (`tests/effective-where.boundary.test.ts`). The model never sees a place key.
 *
 * Pure: no database, environment, clock or browser access. The caller passes the day
 * the labels are counted for and decides whether the feature is on (`CADENCE_ALONGSIDE`).
 */

export const EFFECTIVE_WHERE_KINDS = ["home", "anywhere", "elsewhere", "place", "unknown"] as const;
export type EffectiveWhereKind = (typeof EFFECTIVE_WHERE_KINDS)[number];

export const EFFECTIVE_WHERE_SOURCES = ["person", "evidence", "guess", "none"] as const;
export type EffectiveWhereSource = (typeof EFFECTIVE_WHERE_SOURCES)[number];

/** The values `behavior_advisor_estimates.where_guess` may hold. Never a place name or key. */
export const WHERE_GUESSES = ["home", "anywhere", "elsewhere", "unknown"] as const;
export type WhereGuess = (typeof WHERE_GUESSES)[number];

export type EffectiveWhere = Readonly<{
  kind: EffectiveWhereKind;
  /** Only for `place`: the one-way place key (`travelPlaceKey`). Planning compares it; it is never sent to a model. */
  placeKey?: string;
  source: EffectiveWhereSource;
}>;

/**
 * Evidence thresholds. They match the Where suggestion rules
 * (`WHERE_SUGGESTION_RULES_V1`: 60 days, 6 labels, 80 percent), so the place planning
 * assumes is the one the Where suggestion would offer the person. A pinned test keeps
 * them equal; changing either is a decision, not a refactor.
 */
export const EFFECTIVE_WHERE_EVIDENCE_PERIOD_DAYS = 60;
export const EFFECTIVE_WHERE_EVIDENCE_MINIMUM_LABELS = 6;
export const EFFECTIVE_WHERE_EVIDENCE_MAJORITY_PERCENT = 80;

export type EffectiveWhereLabel = Readonly<{ label: string; localDate: string }>;

export type EffectiveWhereInput = Readonly<{
  /** `behaviors.where_kind`. Null or undefined: Not set. */
  whereKind: BehaviorWhereKind | string | null | undefined;
  /** `behaviors.location_text`, used only to key a `place` Where. */
  locationText?: string | null;
  /** This Behavior's completion place labels. Others' labels must not be passed. */
  labels: readonly EffectiveWhereLabel[];
  /** The cached guess, only while its estimate inputs are unchanged. */
  guess: WhereGuess | string | null | undefined;
  /** The local date the labels are counted for (the planned day). */
  localDate: string;
}>;

const UNKNOWN: EffectiveWhere = Object.freeze({ kind: "unknown", source: "none" });

export function isWhereGuess(value: unknown): value is WhereGuess {
  return typeof value === "string" && (WHERE_GUESSES as readonly string[]).includes(value);
}

export function resolveEffectiveWhere(input: EffectiveWhereInput): EffectiveWhere {
  const person = personWhere(input.whereKind, input.locationText ?? null);
  if (person) return person;
  const evidence = evidenceWhere(input.labels, input.localDate);
  if (evidence) return evidence;
  if (isWhereGuess(input.guess) && input.guess !== "unknown") return { kind: input.guess, source: "guess" };
  return UNKNOWN;
}

function personWhere(whereKind: EffectiveWhereInput["whereKind"], locationText: string | null): EffectiveWhere | null {
  if (whereKind === "home" || whereKind === "anywhere") return { kind: whereKind, source: "person" };
  if (whereKind !== "place") return null;
  const ref = placeRefForWhere({ whereKind: "place", locationText });
  const placeKey = ref ? savedPlaceKey(ref) : null;
  return placeKey ? { kind: "place", placeKey, source: "person" } : { kind: "place", source: "person" };
}

/** A clear majority among the period's labels, or null. */
function evidenceWhere(labels: readonly EffectiveWhereLabel[], localDate: string): EffectiveWhere | null {
  const last = Temporal.PlainDate.from(localDate);
  const first = last.subtract({ days: EFFECTIVE_WHERE_EVIDENCE_PERIOD_DAYS - 1 }).toString();
  const recent = labels.filter((label) => isPlaceLabelValue(label.label) && label.localDate >= first && label.localDate <= last.toString());
  if (recent.length < EFFECTIVE_WHERE_EVIDENCE_MINIMUM_LABELS) return null;
  const counts = new Map<string, number>();
  for (const label of recent) counts.set(label.label, (counts.get(label.label) ?? 0) + 1);
  const [top, count] = [...counts].sort(([leftLabel, left], [rightLabel, right]) => right - left || (leftLabel < rightLabel ? -1 : 1))[0]!;
  if (count * 100 < recent.length * EFFECTIVE_WHERE_EVIDENCE_MAJORITY_PERCENT) return null;
  if (top === "home") return { kind: "home", source: "evidence" };
  if (top === "elsewhere") return { kind: "elsewhere", source: "evidence" };
  const placeKey = savedPlaceKey(top as `saved_place:${string}`);
  return placeKey ? { kind: "place", placeKey, source: "evidence" } : null;
}
