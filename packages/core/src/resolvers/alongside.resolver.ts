/**
 * Ticket 356 (docs/DECISIONS.md, 2026-11-25, D33): the one rule for whether a Behavior
 * is alongside, meaning it can happen during other things (a pill, a red-light helmet).
 *
 * The person's answer (`behaviors.alongside`) wins. While it is unanswered (null), the
 * cached model guess from the estimate call applies. With neither, the Behavior is not
 * alongside. Every planner reads the value through `resolveAlongside`, and the source
 * travels with it so a surface can label a guess as a guess.
 *
 * Pure: no database, environment, clock or browser access. The caller decides whether
 * the person's setting is in force (`CADENCE_ALONGSIDE`) and passes `setting: null` when
 * it is not.
 */

import { Temporal } from "@js-temporal/polyfill";
import type { EffectiveWhere } from "./effective-where.resolver";
import type { AlongsidePairingGuesses } from "../types/brief-moves";

export const ALONGSIDE_SOURCES = ["person", "guess", "default"] as const;
export type AlongsideSource = (typeof ALONGSIDE_SOURCES)[number];

export type ResolvedAlongside = Readonly<{ value: boolean; source: AlongsideSource }>;

export type AlongsideInput = Readonly<{
  /** The person's answer. Null or undefined: unanswered. */
  setting: boolean | null | undefined;
  /** The cached model guess, only while its estimate inputs are unchanged. Null or undefined: none. */
  guess: boolean | null | undefined;
}>;

const NOT_ALONGSIDE: ResolvedAlongside = Object.freeze({ value: false, source: "default" });

export function resolveAlongside(input: AlongsideInput): ResolvedAlongside {
  if (typeof input.setting === "boolean") return { value: input.setting, source: "person" };
  if (typeof input.guess === "boolean") return { value: input.guess, source: "guess" };
  return NOT_ALONGSIDE;
}

/**
 * Whether the estimate call should still ask the model about `alongside` for a
 * Behavior. Once the person has answered, it is not asked again. The length estimate
 * does not depend on this.
 */
export function alongsideGuessWanted(setting: boolean | null | undefined): boolean {
  return typeof setting !== "boolean";
}

export type AlongsideMember = Readonly<{ alongside: boolean; alongsideSource?: AlongsideSource }>;

/**
 * A routine block (the steps that follow a routine's time) is alongside only when every
 * step is. The source is the reason: for an alongside block, "guess" when any step's
 * value is a guess, otherwise "person"; for a block that is not, the first step that
 * is not alongside. Steps built without a source count as "default" when not alongside
 * and "guess" when alongside, the only way they were alongside before Ticket 356.
 */
export function resolveRoutineBlockAlongside(members: readonly AlongsideMember[]): ResolvedAlongside {
  const blocking = members.find((member) => !member.alongside);
  if (blocking) return { value: false, source: blocking.alongsideSource ?? "default" };
  const guessed = members.some((member) => (member.alongsideSource ?? "guess") === "guess");
  return { value: true, source: guessed ? "guess" : "person" };
}

/** One side's place for the same-place rule: an effective Where, or nothing known. */
export type OverlapPlace = Pick<EffectiveWhere, "kind" | "placeKey"> | null | undefined;

export type AlongsideOverlapOther = Readonly<{
  kind: "item" | "calendar" | "travel";
  /** A Cadence item's effective Where. Calendar events carry none yet: their place is unknown. */
  where?: OverlapPlace;
}>;

/**
 * Ticket 357 (D33): may `alongsideItem` (an alongside item) overlap `other`?
 *
 *   - Never travel: the person is on the way somewhere.
 *   - Yes when either place is unknown or Anywhere.
 *   - Yes at the same place: both Home, or both the same saved place (same place key).
 *   - No at a different place: Home against a place away from home.
 *
 * `elsewhere` is a place away from home whose identity is unknown, and a `place` with
 * no key is the same. Against another place away from home either counts as unknown,
 * so the overlap is allowed; against Home it is refused.
 */
export function alongsideMayOverlap(alongsideItem: Readonly<{ where?: OverlapPlace }>, other: AlongsideOverlapOther): boolean {
  if (other.kind === "travel") return false;
  const left = alongsideItem.where, right = other.where;
  if (!left || !right || open(left) || open(right)) return true;
  if (left.kind === "home" || right.kind === "home") return left.kind === right.kind;
  // Both are away from home. Two known place keys decide; anything less is unknown.
  if (left.kind === "place" && right.kind === "place" && left.placeKey && right.placeKey) return left.placeKey === right.placeKey;
  return true;
}

function open(where: NonNullable<OverlapPlace>): boolean {
  return where.kind === "unknown" || where.kind === "anywhere";
}

/**
 * Ticket 358 (D33): what the Behavior form shows for the setting. `answer` is the
 * person's answer; `guess` is set only while it is unanswered and a current model guess
 * exists, so the form can offer it as a guess to accept.
 */
export type AlongsideAnswer = "yes" | "no" | "unanswered";
/**
 * Ticket 360: `questionOpen` is `alongsideQuestionOpen` for the stored values, so the form
 * asks exactly when every other surface may ask. Absent from views built before it.
 */
export type AlongsideFormView = Readonly<{ answer: AlongsideAnswer; guess: boolean | null; questionOpen?: boolean }>;

export function alongsideFormView(input: AlongsideInput): AlongsideFormView {
  const questionOpen = alongsideQuestionOpen({ alongside: input.setting }, input.guess);
  if (typeof input.setting === "boolean") return { answer: input.setting ? "yes" : "no", guess: null, questionOpen };
  return { answer: "unanswered", guess: typeof input.guess === "boolean" ? input.guess : null, questionOpen };
}

/**
 * Ticket 358 (D33): the Timeline row's alongside facts. Null unless the effective value
 * is alongside. `source` says whether the row's label names a guess; `where` is the
 * item's effective Where for the same-place overlap rule (`alongsideMayOverlap`).
 */
export type AlongsideRowView = Readonly<{ source: "person" | "guess"; where?: OverlapPlace }>;

export function alongsideRowView(resolved: ResolvedAlongside, where?: OverlapPlace): AlongsideRowView | null {
  if (!resolved.value || resolved.source === "default") return null;
  return where ? { source: resolved.source, where: { kind: where.kind, ...(where.placeKey ? { placeKey: where.placeKey } : {}) } } : { source: resolved.source };
}

/**
 * Ticket 360 (D33): whether Cadence may ask the person "Can this be done alongside other
 * things?" about a Behavior. Open while the person has not answered (`alongside` is null)
 * and the current model guess is yes. Every surface asks only while this is true: the
 * Behavior form, the Timeline row after a Completed mark, the Daily Brief, the advisor's
 * `setup_gaps` fact and Chat. Any answer writes `behaviors.alongside`, which closes the
 * question on every surface. A guess of no is never asked about: planning already
 * treats the Behavior as blocking, the same as the default.
 */
export function alongsideQuestionOpen(
  behavior: Readonly<{ alongside: boolean | null | undefined }>,
  guess: boolean | null | undefined,
): boolean {
  return typeof behavior.alongside !== "boolean" && guess === true;
}

/** One of today's items the Daily Brief could ask about. */
export type BriefAlongsideQuestionCandidate = Readonly<{
  behaviorId: string;
  title: string;
  /** The item's start, a UTC instant (ISO 8601). Orders the candidates. */
  startAt: string;
  /** `alongsideQuestionOpen` for the item's Behavior. */
  questionOpen: boolean;
}>;

/**
 * Ticket 360 (D33): the Behavior the Daily Brief asks about, or null. At most one
 * question per brief: the earliest of today's items whose question is open, skipping
 * any Behavior in `askedBehaviorIds` (already asked in an earlier brief). Ties go to
 * the title, then the id, so the same day always gives the same question.
 */
export function pickBriefAlongsideQuestion(input: Readonly<{
  items: readonly BriefAlongsideQuestionCandidate[];
  askedBehaviorIds?: ReadonlySet<string>;
}>): Readonly<{ behaviorId: string; title: string }> | null {
  const asked = input.askedBehaviorIds ?? new Set<string>();
  const open = input.items.filter((item) => item.questionOpen && !asked.has(item.behaviorId));
  if (!open.length) return null;
  const [first] = [...open].sort((left, right) => Temporal.Instant.compare(Temporal.Instant.from(left.startAt), Temporal.Instant.from(right.startAt))
    || left.title.localeCompare(right.title) || left.behaviorId.localeCompare(right.behaviorId));
  return { behaviorId: first!.behaviorId, title: first!.title };
}

/**
 * Audit fix 11 (D33): which inputs of a pairing are Cadence's model guesses: the guest's
 * alongside value (`source: "guess"`) and either side's effective Where (`source:
 * "guess"`). Counted completion places are the person's own record, not a guess. Null
 * when none is, so a pairing with no guess carries nothing new.
 */
export function alongsidePairingGuesses(guest: Readonly<{ alongsideSource?: AlongsideSource; where?: Pick<EffectiveWhere, "source"> | null }>,
  host: Readonly<{ where?: Pick<EffectiveWhere, "source"> | null }>): AlongsidePairingGuesses | null {
  const guesses = { alongside: guest.alongsideSource === "guess", guestWhere: guest.where?.source === "guess", hostWhere: host.where?.source === "guess" };
  return guesses.alongside || guesses.guestWhere || guesses.hostWhere ? guesses : null;
}

/** What the one quiet guess note says: `alongside`, `where`, `both`, or null for no note. */
export function alongsidePairingGuessNote(guesses: AlongsidePairingGuesses | null | undefined): "alongside" | "where" | "both" | null {
  if (!guesses) return null;
  const where = guesses.guestWhere || guesses.hostWhere;
  return guesses.alongside && where ? "both" : guesses.alongside ? "alongside" : where ? "where" : null;
}
