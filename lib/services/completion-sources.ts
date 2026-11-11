import { Temporal } from "@js-temporal/polyfill";
import {
  RECORDED_ACTIVITY_MIN_MATCH_SECONDS,
  type RecordedActivitySourceV1_1,
  type RecordedActivityV1_1,
} from "@cadence/core/types/recorded-activity";

import { ConnectorError } from "@/lib/types/connectors";
import type { ConnectorCaller } from "./connector-credentials";
import {
  listHevyRoutinesForCaller,
  readHevyMatchChangesForCaller,
  readHevyMatchEvidenceForCaller,
  type HevyServiceOptions,
} from "./hevy.service";

// Ticket 316 (D28.2): the completion-source port. Each completion source supplies
// only its reader. The match resolver, the database functions, the reconcile
// service, sync, the Timeline label, analytics and export do not change for a new
// source. One entry today: Hevy.

export type CompletionSourceEvidence = Readonly<{
  activities: readonly RecordedActivityV1_1[];
  /** Only a complete read may remove a match for an absent activity. */
  complete: boolean;
  coverageStartAt: string;
  coverageEndAt: string;
  deletedActivityRefs: readonly string[];
  accountDigest: string;
  connectionGeneration: number;
  /** The read cursor to store after a successful apply, or null to read in full next time. */
  nextCursor: string | null;
}>;

export type CompletionSourceReadOptions = Readonly<{
  deadlineMs?: number;
  signal?: AbortSignal;
  /** The stored cursor. Null, malformed or from another connection reads in full. */
  cursor?: string | null;
}>;

export type CompletionSourceSelector = Readonly<{ key: string; label: string }>;
export type CompletionSourceSelectors = Readonly<{
  selectors: readonly CompletionSourceSelector[];
  /** False when the provider list was cut off; the form then shows no stale count. */
  complete: boolean;
  accountDigest: string;
}>;

export type CompletionSourcePort = Readonly<{
  source: RecordedActivitySourceV1_1;
  minimumDurationSeconds: number;
  /** Reads evidence on the server. Throws `ConnectorError` on a provider failure. */
  readEvidence(caller: ConnectorCaller, options: CompletionSourceReadOptions): Promise<CompletionSourceEvidence>;
  listSelectors(caller: ConnectorCaller): Promise<CompletionSourceSelectors>;
}>;

export const hevyCompletionSource: CompletionSourcePort = {
  source: "hevy",
  minimumDurationSeconds: RECORDED_ACTIVITY_MIN_MATCH_SECONDS.hevy,
  async readEvidence(caller, options) {
    const read = { deadlineMs: options.deadlineMs, signal: options.signal } as HevyServiceOptions;
    const cursor = parseCompletionCursor(options.cursor ?? null);
    if (cursor) {
      const changes = await readHevyMatchChangesForCaller(caller, cursor.since, read);
      // A cursor from an earlier connection says nothing about this one: read in full.
      if (changes.complete && changes.connectionGeneration === cursor.generation) {
        return {
          activities: changes.activities,
          // A change read never proves absence; only `deleted` events remove matches.
          complete: false,
          coverageStartAt: changes.coverageStartAt,
          coverageEndAt: changes.coverageEndAt,
          deletedActivityRefs: changes.deletedActivityRefs,
          accountDigest: changes.accountDigest,
          connectionGeneration: changes.connectionGeneration,
          // Every change up to the read was returned, so the cursor moves to the read time less
          // the clock margin, never backwards. A quiet account still advances.
          nextCursor: formatCompletionCursor(changes.connectionGeneration, latest(cursor.since, beforeMargin(changes.fetchedAt))),
        };
      }
    }
    const full = await readHevyMatchEvidenceForCaller(caller, read);
    const snapshot = full.snapshot;
    // An incomplete read still counts as evidence for what it saw (rule 5), but a
    // provider failure other than incomplete pagination writes nothing.
    const failure = snapshot.failures.find((entry) => entry.code !== "incomplete_pagination");
    if (failure) throw new ConnectorError(failure.code);
    const range = snapshot.requestedRange;
    const complete = snapshot.completeness === "complete";
    return {
      activities: snapshot.activities,
      complete,
      coverageStartAt: Temporal.PlainDate.from(range.startLocalDate).toZonedDateTime({ timeZone: range.timezone }).toInstant().toString(),
      coverageEndAt: Temporal.PlainDate.from(range.endLocalDate).add({ days: 1 }).toZonedDateTime({ timeZone: range.timezone }).toInstant().toString(),
      deletedActivityRefs: [],
      accountDigest: full.accountDigest,
      connectionGeneration: full.connectionGeneration,
      // Start the cursor a margin before the read, since Hevy's `updated_at` uses its own clock.
      nextCursor: complete
        ? formatCompletionCursor(full.connectionGeneration, beforeMargin(snapshot.fetchedAt))
        : null,
    };
  },
  async listSelectors(caller) {
    const list = await listHevyRoutinesForCaller(caller);
    return {
      selectors: list.routines.map((routine) => ({ key: routine.selectorKey, label: routine.title })),
      complete: list.complete,
      accountDigest: list.accountDigest,
    };
  },
};

const CURSOR_MARGIN_MINUTES = 5;
const CURSOR = /^g([1-9]\d{0,9})\|(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z)$/u;

function beforeMargin(instant: string): string {
  return Temporal.Instant.from(instant).subtract({ minutes: CURSOR_MARGIN_MINUTES }).toString();
}

function latest(left: string, right: string): string {
  return Temporal.Instant.compare(Temporal.Instant.from(left), Temporal.Instant.from(right)) >= 0 ? left : right;
}

/** A stored cursor: the connection generation and the inclusive `since` instant. */
export function formatCompletionCursor(generation: number, since: string): string {
  return `g${generation}|${Temporal.Instant.from(since).toString()}`;
}

export function parseCompletionCursor(value: string | null): Readonly<{ generation: number; since: string }> | null {
  const match = value === null ? null : CURSOR.exec(value);
  return match ? { generation: Number(match[1]), since: match[2] } : null;
}

export const COMPLETION_SOURCES: Readonly<Record<RecordedActivitySourceV1_1, CompletionSourcePort>> = Object.freeze({
  hevy: hevyCompletionSource,
});

export function completionSource(source: unknown): CompletionSourcePort {
  if (typeof source !== "string" || !Object.hasOwn(COMPLETION_SOURCES, source)) throw new ConnectorError("invalid_request");
  return COMPLETION_SOURCES[source as RecordedActivitySourceV1_1];
}
