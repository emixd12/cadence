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
