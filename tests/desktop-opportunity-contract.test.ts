import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAccountSync, type AccountSyncEntity } from "@cadence/core/resolvers/account-sync.resolver";
import { portabilityEntities } from "../apps/desktop/src/account/account-sync";
import { createLocalBehaviorActions, createLocalOccurrenceActions } from "../apps/desktop/src/local-actions";
import { localCommand } from "../apps/desktop/src/local-store";
import { loadLocalTimeline } from "../apps/desktop/src/local-timeline.service";

// Behaviors of Opportunity on Cadence for Mac (Task 8), end to end: the Mac's own
// actions run against the real SQLite store (schema 27) through the contract harness.
// Ways this could fail, each checked below:
//  - the Behaviors form cannot save an opportunity with no schedule;
//  - the basket is empty, or generation creates or removes added rows;
//  - an add, Done now or Remove does not reach SQLite, or a refusal still writes;
//  - Remove is offered for an item that has a status or a Note;
//  - the account sync plan drops origin or added_by, or a hosted added item does not land.
const transport = vi.hoisted(() => ({ send: (_request: unknown): Promise<unknown> => { void _request; return Promise.reject(new Error("SQLite runner is not started.")); } }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: (command: string, args: { request: unknown }) => {
  if (command !== "local_store") throw new Error(`Unexpected native command: ${command}`);
  return transport.send(args.request);
} }));

// Noon in New York on Aug 30, 2026.
const NOW = new Date("2026-08-30T16:00:00Z");
const TODAY = "2026-08-30";

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const item of [value].flat()) data.append(key, item);
  return data;
}

describe.skipIf(!process.env.CADENCE_SQLITE_CONTRACT)("Behaviors of Opportunity against real SQLite", () => {
  let directory: string;
  let child: ChildProcessWithoutNullStreams;
  let stopped: Promise<void>;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    directory = await mkdtemp(path.join(tmpdir(), "cadence-opportunity-sqlite-"));
    child = spawn(path.resolve("apps/desktop/src-tauri/target/debug/local-store-contract"), [path.join(directory, "contract.sqlite3")]);
    const pending: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => {
      const waiter = pending.shift();
      const response = JSON.parse(line);
      if (response.error) waiter?.reject(new Error(response.error)); else waiter?.resolve(response.result);
    });
    stopped = new Promise((resolve) => child.on("close", () => resolve()));
    transport.send = (request) => new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
      child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  });
  afterEach(async () => {
    vi.useRealTimers();
    child.stdin.end();
    await stopped;
    await rm(directory, { recursive: true, force: true });
  });

  it("creates an unscheduled opportunity, adds, logs and removes items, and syncs contract 8 rows", async () => {
    const profile = await localCommand("readProfile", {});
    const refresh = vi.fn();
    const behaviors = createLocalBehaviorActions(profile, refresh);
    const occurrences = createLocalOccurrenceActions(profile.id, refresh);

    // The shared form: the flag on and no schedule.
    const created = await behaviors.createAction({ status: "idle", message: "" },
      form({ title: "Stretch", is_opportunity: ["false", "true"], behavior_schedule_count: "0", reminder_offset: "0" }));
    expect(created).toMatchObject({ status: "success" });
    const refused = await behaviors.createAction({ status: "idle", message: "" },
      form({ title: "Read", is_opportunity: "false", behavior_schedule_count: "0", reminder_offset: "0" }));
    expect(refused.status).toBe("error");
    const [graph] = await localCommand("readBehaviorGraphs", { profileId: profile.id });
    expect(graph).toMatchObject({ behavior: { title: "Stretch", is_opportunity: true, recurrence_rule: null, scheduled_time: null }, schedules: [], slots: [] });
    const behaviorId = graph!.behavior.id;

    let timeline = (await loadLocalTimeline(7)).timeline;
    expect(timeline.opportunityPool).toEqual([expect.objectContaining({ behaviorId, title: "Stretch", onToday: false })]);
    expect(timeline.daySections.flatMap((day) => day.occurrences)).toEqual([]);

    // Add at an exact time, Done now, and a refused time that writes nothing.
    const added = await occurrences.addOpportunityAction({ status: "idle" },
      form({ behavior_id: behaviorId, placement: "exact", start_time: "15:00", client_occurrence_id: crypto.randomUUID() }));
    expect(added).toMatchObject({ status: "added", noticeId: "opportunity.added", noticeParams: { title: "Stretch", time: "3:00 PM" } });
    const logged = await occurrences.addOpportunityAction({ status: "idle" },
      form({ behavior_id: behaviorId, placement: "done_now", client_occurrence_id: crypto.randomUUID() }));
    expect(logged).toMatchObject({ status: "logged", noticeId: "opportunity.logged" });
    const badTime = await occurrences.addOpportunityAction({ status: "idle" },
      form({ behavior_id: behaviorId, placement: "range", start_time: "15:00", end_time: "15:00" }));
    expect(badTime).toMatchObject({ status: "refused", reason: "invalid_time" });
    expect(refresh).toHaveBeenCalledTimes(3);

    // Generation leaves added rows alone; Remove is offered only for the clean one.
    await loadLocalTimeline(7);
    timeline = (await loadLocalTimeline(7)).timeline;
    const today = timeline.daySections.find((day) => day.localDate === TODAY)!.occurrences;
    expect(today.map((row) => [row.status, row.origin, row.addedBy, row.canRemove])).toEqual([
      ["completed", "opportunity", "user", false],
      ["unresolved", "opportunity", "user", true],
    ]);
    const addedId = added.status === "added" ? added.occurrenceId : "";
    const loggedId = logged.status === "logged" ? logged.occurrenceId : "";
    expect(await occurrences.removeOpportunityAction({ status: "idle" }, form({ occurrence_id: loggedId, title: "Stretch" })))
      .toMatchObject({ status: "refused", reason: "marked", noticeId: "opportunity.remove-refused.marked" });

    // Account sync: the plan carries the new fields both ways.
    const synced = portabilityEntities(await localCommand("readImportSnapshot", { profileId: profile.id }));
    const entity = (id: string) => synced.find((row) => row.id === id)!;
    expect(entity(behaviorId).value).toMatchObject({ is_opportunity: true, recurrence_rule: null, scheduled_time: null });
    expect(entity(addedId).value).toMatchObject({ origin: "opportunity", added_by: "user", status: "unresolved" });
    expect(await occurrences.removeOpportunityAction({ status: "idle" }, form({ occurrence_id: addedId, title: "Stretch" })))
      .toMatchObject({ status: "removed", noticeId: "opportunity.removed", noticeParams: { title: "Stretch" } });
    const local = portabilityEntities(await localCommand("readImportSnapshot", { profileId: profile.id }));
    const briefId = crypto.randomUUID();
    const fromBrief = { kind: "occurrence", id: briefId, value: {
      ...(entity(addedId).value as Record<string, unknown>), id: briefId, added_by: "daily_brief", schedule_start_time: "17:00:00",
      scheduled_for: "2026-08-30T21:00:00Z" } } as AccountSyncEntity;
    const plan = resolveAccountSync({ baseline: { entities: synced }, local: { entities: local }, hosted: { entities: [...synced, fromBrief] } });
    expect(plan.conflicts).toEqual([]);
    expect(plan.hostedWrites).toEqual([expect.objectContaining({ kind: "occurrence", id: addedId, operation: "delete",
      expected: expect.objectContaining({ origin: "opportunity", added_by: "user" }) })]);
    expect(plan.localWrites).toEqual([expect.objectContaining({ kind: "occurrence", id: fromBrief.id, operation: "upsert" })]);
    await localCommand("applyAccountSync", { profileId: profile.id, writes: [...plan.localWrites] });
    timeline = (await loadLocalTimeline(7)).timeline;
    expect(timeline.daySections.find((day) => day.localDate === TODAY)!.occurrences
      .map((row) => [row.id, row.addedBy, row.canRemove])).toEqual([[loggedId, "user", false], [fromBrief.id, "daily_brief", true]]);
  }, 20_000);
});
