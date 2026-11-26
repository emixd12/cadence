import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ALONGSIDE_GUESSES_ROUTE,
  parseAlongsideGuessesResponse,
  type AlongsideGuess,
} from "@cadence/core/services/alongside-facts";
import { createDesktopCalendarBroker, type DesktopCalendarBroker } from "./calendar/google-calendar";

/**
 * Ticket 363 (D33): the alongside setting on Cadence for Mac.
 *
 * The web gates every alongside surface on the server flag `CADENCE_ALONGSIDE`. A shipped
 * Mac binary cannot read a server environment variable, so the Mac has two gates:
 *
 * 1. A build switch, `VITE_CADENCE_ALONGSIDE=1`, inlined by Vite at build time. Without it
 *    the Mac renders exactly as before: no form field, no label, no row question and no
 *    brief question opt-in. Release and preview builds force it empty
 *    (`apps/desktop/scripts/release-config.mjs`), so a published build stays dark until
 *    the owner turns the feature on (Ticket 365).
 * 2. On a linked Mac, the server's answer. `GET /api/behaviors/alongside` returns
 *    `enabled: false` while `CADENCE_ALONGSIDE` is off, and the Mac then hides every
 *    alongside surface for that account. Until the first read answers (offline at launch),
 *    the build switch decides and no guesses apply.
 *
 * A local-only Mac has no model guesses: an unanswered Behavior reads as not alongside;
 * the person's answer and completion place labels still apply. A linked Mac keeps the
 * last guesses it read in memory only: never in SQLite, backups or exports.
 */
declare global {
  interface ImportMetaEnv {
    readonly VITE_CADENCE_ALONGSIDE?: string;
  }
}

export const ALONGSIDE_SWITCH_ENV = "VITE_CADENCE_ALONGSIDE";

export function alongsideSwitchOn(value: string | undefined = import.meta.env.VITE_CADENCE_ALONGSIDE): boolean {
  return value === "1";
}

/** What the Mac's alongside surfaces use on one refresh. Null: no alongside surface at all. */
export type DesktopAlongsideContext = Readonly<{ guesses: ReadonlyMap<string, AlongsideGuess> }>;

/** The last hosted read for one account, in memory only. */
export type AlongsideHostedRead = Readonly<{ accountId: string; enabled: boolean; guesses: ReadonlyMap<string, AlongsideGuess> }>;

const NO_GUESSES: ReadonlyMap<string, AlongsideGuess> = new Map();

/**
 * The context for this refresh. `accountId` is the linked account (null in local mode);
 * `read` is the last hosted read, if any.
 */
export function desktopAlongsideContext(input: Readonly<{ switchOn: boolean; accountId: string | null; read: AlongsideHostedRead | null }>): DesktopAlongsideContext | null {
  if (!input.switchOn) return null;
  if (!input.accountId) return { guesses: NO_GUESSES };
  const read = input.read?.accountId === input.accountId ? input.read : null;
  if (!read) return { guesses: NO_GUESSES };
  return read.enabled ? { guesses: read.guesses } : null;
}

export type DesktopAlongsideGuessClient = Readonly<{
  /** The account's current guesses, or null when the read failed (offline, signed out). */
  read: (accountId: string) => Promise<AlongsideHostedRead | null>;
}>;

/** Reads the guesses over the existing authenticated broker transport (HTTPS origin, bearer session). */
export function createDesktopAlongsideGuessClient(client: SupabaseClient | null,
  broker: Pick<DesktopCalendarBroker, "request"> | null = client ? createDesktopCalendarBroker(client) : null): DesktopAlongsideGuessClient | null {
  if (!broker) return null;
  return {
    read: async (accountId) => {
      try {
        const response = parseAlongsideGuessesResponse(await broker.request<unknown>(ALONGSIDE_GUESSES_ROUTE));
        if (!response) return null;
        return { accountId, enabled: response.enabled,
          guesses: new Map(response.guesses.map(({ behaviorId, alongside, whereGuess }) => [behaviorId, { alongside, whereGuess }] as const)) };
      } catch { return null; }
    },
  };
}

/** The context's current Where guesses by Behavior id, for the Where suggestion line. */
export function alongsideWhereGuessMap(context: DesktopAlongsideContext | null): ReadonlyMap<string, string> | null {
  if (!context) return null;
  return new Map([...context.guesses].flatMap(([id, guess]) => guess.whereGuess ? [[id, guess.whereGuess] as const] : []));
}

/**
 * Ticket 363 (D33): with the Mac's alongside switch on, BehaviorLog import reads and
 * compares the person's answer (the bundle's Cadence extension), as the web does with
 * `CADENCE_ALONGSIDE` on. Off, previews and writes are unchanged.
 */
export function alongsideOption(): { includeAlongside?: true } {
  return alongsideSwitchOn() ? { includeAlongside: true } : {};
}
export function readAlongsideOption(): { readAlongside?: true } {
  return alongsideSwitchOn() ? { readAlongside: true } : {};
}
