/**
 * Ticket 356 (D33): `CADENCE_ALONGSIDE` gates the person's alongside setting on the
 * hosted app. Only the exact value `on` enables it; any other value or no value keeps
 * the pre-356 behavior: planners read only the cached model guess, the model is asked
 * about every Behavior, and nothing reads `behaviors.alongside`. Default: off.
 * With it on, planners also read each Behavior's effective Where (Ticket 357), and the
 * estimate call, Chat, the day context and the coach use their alongside versions
 * (Ticket 359). Turn it on only after all seven alongside migrations are on the hosted
 * database: 20261125140000, 20261125150000, 20261125180000, 20261125190000,
 * 20261126100000, 20261126110000 and 20261126120000. The last one
 * (`account_sync_alongside`) must reach the database before the Ticket 363 code deploys,
 * whatever the flag: account sync contract 10 and configuration history carry the column.
 * See docs/OPERATIONS.md, "Alongside setting operation".
 * Ticket 383's dismissal of a guessed Where while Completion places is off also needs
 * 20261126130000.
 */
export const ALONGSIDE_FLAG = "CADENCE_ALONGSIDE";

export function alongsideEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[ALONGSIDE_FLAG] === "on";
}
