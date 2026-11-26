/**
 * Ticket 356 (D33): `CADENCE_ALONGSIDE` gates the person's alongside setting on the
 * hosted app. Only the exact value `on` enables it; any other value or no value keeps
 * the pre-356 behavior: planners read only the cached model guess, the model is asked
 * about every Behavior, and nothing reads `behaviors.alongside`. Default: off.
 * With it on, planners also read each Behavior's effective Where (Ticket 357), and the
 * estimate call, Chat, the day context and the coach use their alongside versions
 * (Ticket 359). Turn it on only after the alongside migrations are on the hosted
 * database: 20261125140000, 20261125150000, 20261125180000, 20261125190000,
 * 20261126200000, 20261126210000 and 20261126220000. The last one
 * (`account_sync_alongside`) must reach the database before the Ticket 363 code deploys,
 * whatever the flag: account sync contract 10 and configuration history carry the column.
 * See docs/OPERATIONS.md, "Alongside setting operation".
 * Ticket 383's dismissal of a guessed Where while Completion places is off also needs
 * 20261126230000, and 20261126250000 no later than it: account sync contract 11 hides
 * such a dismissal from Cadence for Mac builds on contracts 8 to 10, which would
 * otherwise delete it or fail to apply it.
 * Ticket 385's advice card `do-it-during-something-else` needs 20261126240000 (the
 * `alongside` tip link target) on the database before the card is activated; the flag
 * itself does not.
 */
export const ALONGSIDE_FLAG = "CADENCE_ALONGSIDE";

export function alongsideEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[ALONGSIDE_FLAG] === "on";
}
