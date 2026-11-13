import { Temporal } from "@js-temporal/polyfill";
import { linkAccepts } from "@cadence/core/resolvers/activity-match.resolver";
import { RECORDED_ACTIVITY_MIN_MATCH_SECONDS, type RecordedActivitySourceV1_1, type RecordedActivityV1_1 } from "@cadence/core/types/recorded-activity";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { getOccurrenceWithBehaviorTimezoneById } from "@/lib/db/occurrences.repo";
import { listSourceLinks, toActivityMatchLink, type SourceLinkRow } from "@/lib/db/sourceLinks.repo";
import { attachUnlinkedSourceActivity } from "@/lib/db/sourceMatches.repo";
import { ConnectorError } from "@/lib/types/connectors";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";
import { connectorCompletionEnabled } from "./connector-completion.service";
import type { ConnectorCaller } from "./connector-credentials";
import { readHevyMatchEvidenceForCaller } from "./hevy.service";
import { applyOccurrenceStatusTransition } from "./occurrence.service";

// Ticket 324: the user counts a logged workout that no link accepted. The service
// checks the workout on the server, records the user's own Completed mark through the
// manual status path, then attaches the workout for timing with no link. It never
// trusts workout times from the client. Results carry stable codes only.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ACTIVITY_REF = /^[a-z][a-z0-9_]*\/[a-f0-9]{64}$/u;

export type CountWorkoutRequest = Readonly<{ occurrenceId: string; source: RecordedActivitySourceV1_1; activityRef: string }>;

export type CountWorkoutRefusal =
  | "occurrence_unavailable"
  | "not_unresolved"
  | "not_today"
  | "linked"
  | "not_connected"
  | "activity_unavailable"
  | "below_minimum"
  | "activity_unfinished"
  | "matched_by_link";

export type CountWorkoutResult =
  | Readonly<{ counted: true; attached: boolean; reason: string }>
  | Readonly<{ counted: false; reason: CountWorkoutRefusal }>;

/** Everything the count reads or writes, so tests run without a database or Hevy. */
export type CountWorkoutDeps = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Temporal.Instant;
  readOccurrence(occurrenceId: string): Promise<Readonly<{ id: string; behaviorId: string; status: string; localDate: string; timezone: string }> | null>;
  listLinks(source: RecordedActivitySourceV1_1): Promise<SourceLinkRow[]>;
  readDay(localDate: string): Promise<Readonly<{ connected: boolean; activities: readonly RecordedActivityV1_1[]; accountDigest: string | null }>>;
  markCompleted(occurrenceId: string, now: Temporal.Instant): Promise<void>;
  attach(input: Readonly<{ occurrenceId: string; source: string; activity: RecordedActivityV1_1; recordedAt: string }>): Promise<Readonly<{ attached: boolean; reason: string }>>;
}>;

/** `POST /api/connectors/completions/count` accepts exactly `{ occurrenceId, source, activityRef }`. */
export function parseCountWorkoutBody(body: unknown): CountWorkoutRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ConnectorError("invalid_request");
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== "activityRef,occurrenceId,source") throw new ConnectorError("invalid_request");
  const { occurrenceId, source, activityRef } = record;
  if (typeof occurrenceId !== "string" || !UUID.test(occurrenceId)) throw new ConnectorError("invalid_request");
  if (source !== "hevy") throw new ConnectorError("invalid_request");
  if (typeof activityRef !== "string" || !ACTIVITY_REF.test(activityRef) || !activityRef.startsWith(`${source}/`)) {
    throw new ConnectorError("invalid_request");
  }
  return { occurrenceId, source, activityRef };
}

export async function countUnlinkedWorkout(caller: ConnectorCaller, body: unknown, deps?: CountWorkoutDeps): Promise<CountWorkoutResult> {
  const store = deps ?? createCountWorkoutDeps(caller);
  if (!connectorCompletionEnabled(store.env)) throw new ConnectorError("not_configured");
  const request = parseCountWorkoutBody(body);
  const now = (store.now ?? (() => Temporal.Now.instant()))();
  const refuse = (reason: CountWorkoutRefusal): CountWorkoutResult => ({ counted: false, reason });

  const occurrence = await store.readOccurrence(request.occurrenceId);
  if (!occurrence) return refuse("occurrence_unavailable");
  if (occurrence.status !== "unresolved") return refuse("not_unresolved");
  const today = now.toZonedDateTimeISO(occurrence.timezone).toPlainDate().toString();
  if (occurrence.localDate !== today) return refuse("not_today");

  const links = (await store.listLinks(request.source)).filter((link) => link.enabled);
  if (links.some((link) => link.behavior_id === occurrence.behaviorId)) return refuse("linked");

  const day = await store.readDay(today);
  if (!day.connected) return refuse("not_connected");
  const activity = day.activities.find((entry) => entry.id === request.activityRef);
  if (!activity) return refuse("activity_unavailable");
  if (activity.duration.seconds < RECORDED_ACTIVITY_MIN_MATCH_SECONDS[request.source]) return refuse("below_minimum");
  if (Temporal.Instant.compare(Temporal.Instant.from(activity.endAt), now) > 0) return refuse("activity_unfinished");
  // A workout a link accepts belongs to that link's Behavior.
  if (links.some((link) => link.account_digest === day.accountDigest && linkAccepts(toActivityMatchLink(link), activity))) {
    return refuse("matched_by_link");
  }

  await store.markCompleted(occurrence.id, now);
  const attached = await store.attach({ occurrenceId: occurrence.id, source: request.source, activity, recordedAt: now.toString() });
  return { counted: true, attached: attached.attached, reason: attached.reason };
}

export function createCountWorkoutDeps(caller: ConnectorCaller, client: AppSupabaseClient = caller.client): CountWorkoutDeps {
  const userId = caller.user.id;
  return {
    async readOccurrence(occurrenceId) {
      const occurrence = await getOccurrenceWithBehaviorTimezoneById(client, userId, occurrenceId);
      return occurrence ? {
        id: occurrence.id,
        behaviorId: occurrence.behavior_id,
        status: occurrence.status,
        localDate: occurrence.local_date,
        timezone: occurrence.behavior?.timezone ?? DEFAULT_TIMEZONE,
      } : null;
    },
    listLinks: (source) => listSourceLinks(client, userId, source),
    async readDay(localDate) {
      try {
        const evidence = await readHevyMatchEvidenceForCaller(caller, { localDate });
        return { connected: true, activities: evidence.snapshot.activities, accountDigest: evidence.accountDigest };
      } catch (error) {
        if (error instanceof ConnectorError && (error.code === "not_connected" || error.code === "reconnect_required")) {
          return { connected: false, activities: [], accountDigest: null };
        }
        throw error;
      }
    },
    async markCompleted(occurrenceId, now) {
      await applyOccurrenceStatusTransition(client, userId, { occurrenceId, expectedStatus: "unresolved", nextStatus: "completed", now });
    },
    async attach(input) {
      const outcome = await attachUnlinkedSourceActivity(client, {
        occurrenceId: input.occurrenceId,
        source: input.source,
        activityRef: input.activity.id,
        activityStartAt: input.activity.startAt,
        activityEndAt: input.activity.endAt,
        activityRevision: input.activity.revision.providerUpdatedAt,
        recordedAt: input.recordedAt,
      });
      return { attached: outcome.ok, reason: outcome.reason };
    },
  };
}
