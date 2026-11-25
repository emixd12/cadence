/**
 * Ticket 356 (D33): `CADENCE_ALONGSIDE` gates the person's alongside setting on the
 * hosted app. Only the exact value `on` enables it; any other value or no value keeps
 * the pre-356 behavior: planners read only the cached model guess, the model is asked
 * about every Behavior, and nothing reads `behaviors.alongside`. Default: off.
 * With it on, planners also read each Behavior's effective Where (Ticket 357).
 * Turn it on only after migrations 20261125140000 and 20261125150000 are on the hosted
 * database.
 */
export const ALONGSIDE_FLAG = "CADENCE_ALONGSIDE";

export function alongsideEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[ALONGSIDE_FLAG] === "on";
}
