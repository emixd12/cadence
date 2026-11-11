import { Temporal } from "@js-temporal/polyfill";
import {
  RECORDED_ACTIVITY_MIN_MATCH_SECONDS,
  type RecordedActivitySourceV1_1,
  type RecordedActivityV1_1,
} from "@cadence/core/types/recorded-activity";

import { ConnectorError } from "@/lib/types/connectors";
import type { ConnectorCaller } from "./connector-credentials";
import { listHevyRoutinesForCaller, readHevyMatchEvidenceForCaller, type HevyServiceOptions } from "./hevy.service";

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
  readEvidence(caller: ConnectorCaller, options: Readonly<{ deadlineMs?: number; signal?: AbortSignal }>): Promise<CompletionSourceEvidence>;
  listSelectors(caller: ConnectorCaller): Promise<CompletionSourceSelectors>;
}>;

export const hevyCompletionSource: CompletionSourcePort = {
  source: "hevy",
  minimumDurationSeconds: RECORDED_ACTIVITY_MIN_MATCH_SECONDS.hevy,
  async readEvidence(caller, options) {
    const read = await readHevyMatchEvidenceForCaller(caller, options as HevyServiceOptions);
    const snapshot = read.snapshot;
    // An incomplete read still counts as evidence for what it saw (rule 5), but a
    // provider failure other than incomplete pagination writes nothing.
    const failure = snapshot.failures.find((entry) => entry.code !== "incomplete_pagination");
    if (failure) throw new ConnectorError(failure.code);
    const range = snapshot.requestedRange;
    return {
      activities: snapshot.activities,
      complete: snapshot.completeness === "complete",
      coverageStartAt: Temporal.PlainDate.from(range.startLocalDate).toZonedDateTime({ timeZone: range.timezone }).toInstant().toString(),
      coverageEndAt: Temporal.PlainDate.from(range.endLocalDate).add({ days: 1 }).toZonedDateTime({ timeZone: range.timezone }).toInstant().toString(),
      // Strategy A (an events cursor) would supply deletions; Ticket 311 decides it.
      deletedActivityRefs: [],
      accountDigest: read.accountDigest,
      connectionGeneration: read.connectionGeneration,
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

export const COMPLETION_SOURCES: Readonly<Record<RecordedActivitySourceV1_1, CompletionSourcePort>> = Object.freeze({
  hevy: hevyCompletionSource,
});

export function completionSource(source: unknown): CompletionSourcePort {
  if (typeof source !== "string" || !Object.hasOwn(COMPLETION_SOURCES, source)) throw new ConnectorError("invalid_request");
  return COMPLETION_SOURCES[source as RecordedActivitySourceV1_1];
}
