import {
  alongsideFormView,
  alongsideQuestionOpen,
  alongsideRowView,
  resolveAlongside,
  type AlongsideFormView,
  type AlongsideRowView,
} from "../resolvers/alongside.resolver";
import {
  isWhereGuess,
  resolveEffectiveWhere,
  type EffectiveWhereLabel,
  type WhereGuess,
} from "../resolvers/effective-where.resolver";

/**
 * Ticket 358 (D33), shared since Ticket 363: the alongside facts the Behavior form, the
 * Timeline rows and the Where suggestion show, built from one Behavior's stored answer,
 * its current model guesses and its completion place labels. The web reads the guesses
 * from `behavior_advisor_estimates`; Cadence for Mac gets them from the hosted
 * `/api/behaviors/alongside` route while linked, and has none in local mode.
 */
export type AlongsideBehaviorFacts = Readonly<{
  form: AlongsideFormView;
  /** Null unless the effective value is alongside. */
  row: AlongsideRowView | null;
  /** The current Where guess while Where is Not set; null otherwise. */
  whereGuess: WhereGuess | null;
  /** Ticket 360: `alongsideQuestionOpen`, so every surface asks under the same rule. */
  questionOpen: boolean;
}>;

/** One Behavior's current model guesses. Null fields: no current guess. */
export type AlongsideGuess = Readonly<{ alongside: boolean | null; whereGuess: WhereGuess | null }>;

export type AlongsideFactsBehavior = Readonly<{
  id: string;
  alongside: boolean | null | undefined;
  whereKind: string | null | undefined;
  locationText: string | null | undefined;
}>;

export function buildAlongsideBehaviorFacts(input: Readonly<{
  behaviors: readonly AlongsideFactsBehavior[];
  /** By Behavior id. A Behavior without an entry has no guess (always so in local mode). */
  guesses: ReadonlyMap<string, AlongsideGuess>;
  /** Completion place labels by Behavior id, inside the evidence period. */
  labels: ReadonlyMap<string, readonly EffectiveWhereLabel[]>;
  localDate: string;
}>): ReadonlyMap<string, AlongsideBehaviorFacts> {
  return new Map(input.behaviors.map((behavior) => {
    const setting = typeof behavior.alongside === "boolean" ? behavior.alongside : null;
    const guess = input.guesses.get(behavior.id);
    const alongsideGuess = typeof guess?.alongside === "boolean" ? guess.alongside : null;
    const whereKind = behavior.whereKind ?? null;
    const candidate = whereKind === null && isWhereGuess(guess?.whereGuess) ? guess.whereGuess : null;
    const where = resolveEffectiveWhere({ whereKind, locationText: behavior.locationText ?? null,
      labels: [...(input.labels.get(behavior.id) ?? [])], guess: candidate, localDate: input.localDate });
    return [behavior.id, {
      form: alongsideFormView({ setting, guess: alongsideGuess }),
      row: alongsideRowView(resolveAlongside({ setting, guess: alongsideGuess }), where),
      whereGuess: candidate,
      questionOpen: alongsideQuestionOpen({ alongside: setting }, alongsideGuess),
    }] as const;
  }));
}

/** The Behavior form's view per Behavior, or null while the setting is off. */
export function alongsideFormViews(facts: ReadonlyMap<string, AlongsideBehaviorFacts> | null): Readonly<Record<string, AlongsideFormView>> | null {
  return facts ? Object.fromEntries([...facts].map(([id, value]) => [id, value.form])) : null;
}

/** The Timeline row facts for alongside Behaviors only. Empty while the setting is off. */
export function alongsideRowViews(facts: ReadonlyMap<string, AlongsideBehaviorFacts> | null): Readonly<Record<string, AlongsideRowView>> {
  return facts ? Object.fromEntries([...facts].flatMap(([id, value]) => value.row ? [[id, value.row] as const] : [])) : {};
}

/** Ticket 360: Behaviors whose alongside question is open. Empty while the setting is off. */
export function alongsideQuestionBehaviorIds(facts: ReadonlyMap<string, AlongsideBehaviorFacts> | null): ReadonlySet<string> {
  return new Set(facts ? [...facts].flatMap(([id, value]) => value.questionOpen ? [id] : []) : []);
}

/** Current Where guesses for Behaviors with Where Not set. Empty while the setting is off. */
export function alongsideWhereGuesses(facts: ReadonlyMap<string, AlongsideBehaviorFacts> | null): ReadonlyMap<string, WhereGuess> {
  return new Map(facts ? [...facts].flatMap(([id, value]) => value.whereGuess ? [[id, value.whereGuess] as const] : []) : []);
}

/**
 * Ticket 363: the hosted guesses response a linked Mac reads (`GET /api/behaviors/alongside`).
 * `enabled` is the server's `CADENCE_ALONGSIDE`; while it is false the response carries no
 * guesses and the Mac shows no alongside UI for that account.
 */
export type AlongsideGuessesResponse = Readonly<{
  enabled: boolean;
  guesses: readonly (AlongsideGuess & Readonly<{ behaviorId: string }>)[];
}>;

export const ALONGSIDE_GUESSES_ROUTE = "/api/behaviors/alongside";

/** Checks a guesses response strictly; anything else reads as no response. */
export function parseAlongsideGuessesResponse(value: unknown): AlongsideGuessesResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.enabled !== "boolean" || !Array.isArray(record.guesses) || record.guesses.length > 10_000) return null;
  const guesses: (AlongsideGuess & { behaviorId: string })[] = [];
  for (const item of record.guesses) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    if (typeof entry.behaviorId !== "string" || entry.behaviorId.length < 1 || entry.behaviorId.length > 64) return null;
    if (!(entry.alongside === null || typeof entry.alongside === "boolean")) return null;
    if (!(entry.whereGuess === null || isWhereGuess(entry.whereGuess))) return null;
    guesses.push({ behaviorId: entry.behaviorId, alongside: entry.alongside, whereGuess: entry.whereGuess });
  }
  return { enabled: record.enabled, guesses: record.enabled ? guesses : [] };
}
