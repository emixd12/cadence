import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it, vi } from "vitest";

import type { RecordedActivityV1_1 } from "@cadence/core/types/recorded-activity";
import type { SourceLinkRow } from "@/lib/db/sourceLinks.repo";
import type { CompletionSourceEvidence, CompletionSourcePort } from "@/lib/services/completion-sources";
import {
  RECONCILE_MAX_WRITES,
  parseReconcileBody,
  reconcileConnectorCompletions,
  type ConnectorCompletionStore,
} from "@/lib/services/connector-completion.service";
import type { ConnectorCaller } from "@/lib/services/connector-credentials";
import { getSourceLinkFormState, saveSourceLink } from "@/lib/services/source-links.service";
import { ConnectorError } from "@/lib/types/connectors";
import type { Occurrence } from "@/lib/types/database";

const NOW = Temporal.Instant.from("2026-11-10T23:00:00Z");
const ON = { CADENCE_CONNECTOR_COMPLETION: "on" };
const DIGEST = "d".repeat(64);
const LEGS = "a".repeat(64);
const caller = { client: {} as ConnectorCaller["client"], user: { id: "user-1" } } as ConnectorCaller;
const BEHAVIOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function link(overrides: Partial<SourceLinkRow> = {}): SourceLinkRow {
  return {
    id: "link-1", user_id: "user-1", behavior_id: BEHAVIOR, source: "hevy", selector_kind: "any", selector_keys: [],
    account_digest: DIGEST, enabled: true, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", ...overrides,
  };
}

function occurrence(id: string, localDate: string, scheduledFor: string): Occurrence {
  return {
    id, user_id: "user-1", behavior_id: BEHAVIOR, local_date: localDate, scheduled_for: scheduledFor, status: "unresolved",
    schedule_kind: "exact", schedule_start_time: "18:00:00", schedule_end_time: null,
  } as unknown as Occurrence;
}

function activity(index: number, startAt: string): RecordedActivityV1_1 {
  const start = Temporal.Instant.from(startAt);
  return {
    id: `hevy/${index.toString(16).padStart(64, "0")}`, kind: "workout", startAt: start.toString(), endAt: start.add({ minutes: 45 }).toString(),
    duration: { kind: "known", seconds: 2_700 }, localStartDate: startAt.slice(0, 10),
    revision: { availability: "unavailable", providerUpdatedAt: null },
    fieldAvailability: { location: "unsupported", sourceTimezone: "unsupported" }, selectorKeys: [],
  };
}

function evidence(activities: RecordedActivityV1_1[]): CompletionSourceEvidence {
  return {
    activities, complete: true, coverageStartAt: "2026-10-11T04:00:00Z", coverageEndAt: "2026-11-11T05:00:00Z",
    deletedActivityRefs: [], accountDigest: DIGEST, connectionGeneration: 1,
  };
}

function port(read: () => Promise<CompletionSourceEvidence>): CompletionSourcePort & { calls: number } {
  const value = {
    source: "hevy" as const,
    minimumDurationSeconds: 300,
    calls: 0,
    async readEvidence() { value.calls += 1; return read(); },
    async listSelectors() { return { selectors: [{ key: LEGS, label: "Legs" }], complete: true, accountDigest: DIGEST }; },
  };
  return value;
}

function store(overrides: Partial<ConnectorCompletionStore> & { occurrences?: Occurrence[] } = {}) {
  const writes: string[] = [];
  const connection = { status: "connected", accountDigest: DIGEST, generation: 1 };
  const value: ConnectorCompletionStore = {
    readState: async () => null,
    recordAttempt: async () => { writes.push("attempt"); },
    recordOutcome: async (_source, outcome) => { writes.push(outcome.succeeded ? "success" : "failure"); },
    readConnection: async () => connection,
    listLinks: async () => [link()],
    listBehaviors: async () => [{ id: BEHAVIOR, timezone: "America/New_York" }],
    listOccurrences: async () => overrides.occurrences ?? [],
    latestStatusEventIds: async () => new Map(),
    listMatches: async () => [],
    applyCompletion: async () => { writes.push("complete"); return { ok: true, reason: "applied" }; },
    attach: async () => { writes.push("attach"); return { ok: true, reason: "attached" }; },
    remove: async () => { writes.push("remove"); return { ok: true, reason: "removed" }; },
    repairReminders: async () => { writes.push("repair"); },
    revalidate: () => { writes.push("revalidate"); },
    ...overrides,
  };
  return { value, writes };
}

describe("connector completion reconcile (Ticket 316)", () => {
  it("does nothing while the flag is off, without a provider call", async () => {
    const source = port(async () => evidence([]));
    const { value, writes } = store();
    for (const env of [{}, { CADENCE_CONNECTOR_COMPLETION: "true" }, { CADENCE_CONNECTOR_COMPLETION: "ON" }]) {
      const result = await reconcileConnectorCompletions(caller, "hevy", { env, store: value, port: source, now: () => NOW });
      expect(result.status).toBe("disabled");
    }
    expect(source.calls).toBe(0);
    expect(writes).toEqual([]);
  });

  it("completes an Unresolved Occurrence and revalidates the Timeline", async () => {
    const { value, writes } = store({ occurrences: [occurrence("o1", "2026-11-10", "2026-11-10T23:00:00Z")] });
    const result = await reconcileConnectorCompletions(caller, "hevy", {
      env: ON, store: value, port: port(async () => evidence([activity(1, "2026-11-10T21:00:00Z")])), now: () => NOW,
    });
    expect(result).toMatchObject({ status: "reconciled", counts: { completed: 1, attached: 0, removed: 0 } });
    expect(writes).toEqual(["attempt", "complete", "success", "revalidate"]);
    expect(JSON.stringify(result)).not.toContain("hevy/");
  });

  it("writes nothing but the failure count when the provider fails", async () => {
    const { value, writes } = store({ occurrences: [occurrence("o1", "2026-11-10", "2026-11-10T23:00:00Z")] });
    const result = await reconcileConnectorCompletions(caller, "hevy", {
      env: ON, store: value, port: port(async () => { throw new ConnectorError("provider_unavailable"); }), now: () => NOW,
    });
    expect(result).toMatchObject({ status: "provider_failed", codes: ["provider_unavailable"] });
    expect(writes).toEqual(["attempt", "failure"]);
  });

  it("discards the result when the connection changes during the run", async () => {
    let reads = 0;
    const { value, writes } = store({
      occurrences: [occurrence("o1", "2026-11-10", "2026-11-10T23:00:00Z")],
      readConnection: async () => ({ status: "connected", accountDigest: DIGEST, generation: reads++ === 0 ? 1 : 2 }),
    });
    const result = await reconcileConnectorCompletions(caller, "hevy", {
      env: ON, store: value, port: port(async () => evidence([activity(1, "2026-11-10T21:00:00Z")])), now: () => NOW,
    });
    expect(result.status).toBe("connection_changed");
    expect(writes).toEqual(["attempt"]);
  });

  it("leaves the 101st planned write for the next run", async () => {
    const days = Array.from({ length: 31 }, (_, index) => Temporal.PlainDate.from("2026-11-10").subtract({ days: index }));
    const occurrences = days.map((day, index) => occurrence(`o${index}`, day.toString(), `${day.toString()}T23:00:00Z`));
    // Four workouts a day on 31 days: 31 completions and 93 attachments planned.
    const activities = days.flatMap((day, dayIndex) => [12, 14, 16, 18].map((hour, slot) =>
      activity(dayIndex * 4 + slot + 1, `${day.toString()}T${hour}:00:00Z`)));
    const { value, writes } = store({ occurrences });
    const result = await reconcileConnectorCompletions(caller, "hevy", {
      env: ON, store: value, port: port(async () => evidence(activities)), now: () => NOW,
    });
    expect(result.counts.completed + result.counts.attached).toBe(RECONCILE_MAX_WRITES);
    expect(result.counts.deferred).toBe(124 - RECONCILE_MAX_WRITES);
    expect(writes.filter((write) => write === "complete" || write === "attach")).toHaveLength(RECONCILE_MAX_WRITES);
  });

  it("skips when the last run started under five minutes ago", async () => {
    const source = port(async () => evidence([]));
    const { value } = store({ readState: async () => ({ lastAttemptedAt: NOW.subtract({ minutes: 4 }).toString(), lastReconciledAt: "2026-11-10T22:56:00Z", consecutiveFailures: 0 }) });
    const result = await reconcileConnectorCompletions(caller, "hevy", { env: ON, store: value, port: source, now: () => NOW });
    expect(result).toMatchObject({ status: "throttled", lastReconciledAt: "2026-11-10T22:56:00Z" });
    expect(source.calls).toBe(0);
  });

  it("repairs reminder coverage after a revert", async () => {
    const { value, writes } = store({
      occurrences: [{ ...occurrence("o1", "2026-11-10", "2026-11-10T23:00:00Z"), status: "completed" } as Occurrence],
      latestStatusEventIds: async () => new Map([["o1", "event-1"]]),
      listMatches: async () => [{
        id: "m1", occurrenceId: "o1", behaviorId: BEHAVIOR, linkId: "link-1", activityRef: activity(9, "2026-11-10T21:00:00Z").id,
        activityStartAt: "2026-11-10T21:00:00Z", activityEndAt: "2026-11-10T21:45:00Z", activityRevision: null,
        role: "completion", state: "active", appliedEventId: "event-1", revertedEventId: null,
      }],
      remove: async () => { writes.push("remove"); return { ok: true, reverted: true, reason: "reverted" }; },
    });
    const result = await reconcileConnectorCompletions(caller, "hevy", { env: ON, store: value, port: port(async () => evidence([])), now: () => NOW });
    expect(result.counts).toMatchObject({ removed: 1, reverted: 1 });
    expect(writes).toEqual(["attempt", "remove", "repair", "success", "revalidate"]);
  });

  it("accepts exactly { source } for a known source", () => {
    expect(parseReconcileBody({ source: "hevy" })).toBe("hevy");
    for (const body of [{}, { source: "strava" }, { source: "hevy", evidence: [] }, [], null]) {
      expect(() => parseReconcileBody(body)).toThrow(ConnectorError);
    }
  });
});

describe("source link service (Ticket 316)", () => {
  const titles = async () => new Map([[OTHER, "Gym"]]);

  it("refuses a routine already chosen on another Behavior and names it", async () => {
    const save = vi.fn();
    const result = await saveSourceLink(caller, { behaviorId: BEHAVIOR, source: "hevy", mode: "routines", selectorKeys: [LEGS] }, {
      env: ON, listLinks: async () => [link({ id: "other", behavior_id: OTHER, selector_kind: "provider_keys", selector_keys: [LEGS] })],
      behaviorTitles: titles, save,
    });
    expect(result).toEqual({ saved: false, reason: "selector_already_linked", holder: { behaviorId: OTHER, title: "Gym" } });
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses a second any-workout link for one source", async () => {
    const save = vi.fn();
    const result = await saveSourceLink(caller, { behaviorId: BEHAVIOR, source: "hevy", mode: "any", selectorKeys: [] }, {
      env: ON, listLinks: async () => [link({ id: "other", behavior_id: OTHER })], behaviorTitles: titles, save,
    });
    expect(result).toMatchObject({ saved: false, reason: "any_link_exists", holder: { title: "Gym" } });
    expect(save).not.toHaveBeenCalled();
  });

  it("saves routines, turns a link off, and rejects malformed bodies", async () => {
    const save = vi.fn(async () => link());
    expect(await saveSourceLink(caller, { behaviorId: BEHAVIOR, source: "hevy", mode: "routines", selectorKeys: [LEGS] },
      { env: ON, listLinks: async () => [], save })).toEqual({ saved: true, mode: "routines" });
    expect(save).toHaveBeenCalledWith(caller.client, expect.objectContaining({ selectorKind: "provider_keys", selectorKeys: [LEGS], enabled: true }));
    await saveSourceLink(caller, { behaviorId: BEHAVIOR, source: "hevy", mode: "off", selectorKeys: [] }, { env: ON, listLinks: async () => [link()], save });
    expect(save).toHaveBeenLastCalledWith(caller.client, expect.objectContaining({ enabled: false }));
    for (const body of [
      { behaviorId: BEHAVIOR, source: "hevy", mode: "routines", selectorKeys: [] },
      { behaviorId: BEHAVIOR, source: "hevy", mode: "any", selectorKeys: [LEGS] },
      { behaviorId: BEHAVIOR, source: "hevy", mode: "routines", selectorKeys: ["routine-id"] },
      { behaviorId: "not-a-uuid", source: "hevy", mode: "any", selectorKeys: [] },
      { behaviorId: BEHAVIOR, source: "hevy", mode: "any", selectorKeys: [], accountDigest: DIGEST },
    ]) await expect(saveSourceLink(caller, body, { env: ON, listLinks: async () => [], save })).rejects.toThrow(ConnectorError);
    await expect(saveSourceLink(caller, { behaviorId: BEHAVIOR, source: "hevy", mode: "any", selectorKeys: [] }, { listLinks: async () => [], save }))
      .rejects.toThrow("not_configured");
  });

  it("reports holders, the stale routine count and the fenced state", async () => {
    const source = port(async () => evidence([]));
    const state = await getSourceLinkFormState(caller, { behaviorId: BEHAVIOR, source: "hevy" }, {
      env: ON, port: source, connectionDigest: async () => DIGEST, behaviorTitles: titles,
      listLinks: async () => [
        link({ selector_kind: "provider_keys", selector_keys: [LEGS, "c".repeat(64)] }),
        link({ id: "other", behavior_id: OTHER }),
      ],
    });
    expect(state).toMatchObject({ available: true, connected: true, mode: "routines", fenced: false, staleLinkedCount: 1,
      anyHolder: { behaviorId: OTHER, title: "Gym" }, routinesComplete: true });
    expect(state.routines).toEqual([{ key: LEGS, title: "Legs", holder: null }]);

    const fenced = await getSourceLinkFormState(caller, { behaviorId: BEHAVIOR, source: "hevy" }, {
      env: ON, port: source, connectionDigest: async () => "e".repeat(64), behaviorTitles: titles, listLinks: async () => [link()],
    });
    expect(fenced.fenced).toBe(true);

    const incomplete = await getSourceLinkFormState(caller, { behaviorId: BEHAVIOR, source: "hevy" }, {
      env: ON, port: { ...source, listSelectors: async () => ({ selectors: [], complete: false, accountDigest: DIGEST }) },
      connectionDigest: async () => DIGEST, behaviorTitles: titles,
      listLinks: async () => [link({ selector_kind: "provider_keys", selector_keys: [LEGS] })],
    });
    expect(incomplete.staleLinkedCount).toBeNull();

    expect(await getSourceLinkFormState(caller, { behaviorId: BEHAVIOR, source: "hevy" }, { port: source }))
      .toMatchObject({ available: false, routines: [] });
  });
});
