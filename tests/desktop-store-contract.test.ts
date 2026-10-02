import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BehaviorInput } from "@cadence/core/behavior-store";
import { createBehavior, updateBehavior, setBehaviorActive } from "@cadence/core/services/behavior.service";
import { createLocalBehaviorStore } from "../apps/desktop/src/local-behavior.service";
import { localCommand } from "../apps/desktop/src/local-store";
import { loadLocalTimeline } from "../apps/desktop/src/local-timeline.service";
import { markLocalOccurrence, saveLocalOccurrenceNote, trackLocalOccurrence } from "../apps/desktop/src/local-occurrence.service";
import { getLocalExportDownload, getLocalExportPageData } from "../apps/desktop/src/local-export.service";
import { createLocalCategoryAction } from "../apps/desktop/src/local-category.service";
import { categorySnapshot, categoryAssignmentSnapshot } from "@cadence/core/services/category.service";
import { updateLocalTimezone } from "../apps/desktop/src/local-settings.service";
import { reconcileLocalReminders, retainNativeDeliveryEvents } from "../apps/desktop/src/local-reminder.service";
import { readDesktopZipEntries } from "../apps/desktop/src/archive";
import { toLocalBehaviorGraphRecord } from "../apps/desktop/src/local-generation.service";
import { CONTRACT_NOW, exerciseBehaviorStoreContract } from "./helpers/behavior-store-contract";
import { loadNotificationOccurrence } from "../apps/desktop/src/notification-activation";
import { createLocalNoteShortcutStore } from "../apps/desktop/src/local-note-shortcut.service";
import { getNoteShortcutView, listAcceptedNoteShortcuts, manageNoteShortcuts } from "@cadence/core/services/note-shortcut.service";
import { noteShortcutRevision } from "@cadence/core/resolvers/note-suggestion.resolver";
import { createLocalOccurrenceActions } from "../apps/desktop/src/local-actions";

const transport = vi.hoisted(() => ({ notify: (_request: unknown): Promise<unknown> => { void _request; return Promise.reject(new Error("OS adapter not configured.")); }, send: (_request: unknown): Promise<unknown> => { void _request; return Promise.reject(new Error("SQLite runner is not started.")); } }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: (command: string, args: { request: unknown }) => {
  if (command === "native_notifications") return transport.notify(args.request);
  if (command !== "local_store") throw new Error(`Unexpected native command: ${command}`);
  return transport.send(args.request);
} }));

const NOW = Temporal.Instant.from("2026-08-30T12:00:00Z");
const VALUES: BehaviorInput = {
  title: "Contract walk", description: "Original description", categoryId: null,
  recurrenceRule: { frequency: "daily", interval: 1 }, scheduledTime: "09:00",
  schedules: [{ recurrenceRule: { frequency: "daily", interval: 1 }, sortOrder: 0,
    timeEntries: [{ kind: "exact", preset: null, startTime: "09:00", endTime: null, sortOrder: 0 }] }],
  browserReminderEnabled: true, emailReminderEnabled: false, reminderOffsetMinutes: 0, active: true,
};

describe.skipIf(!process.env.CADENCE_SQLITE_CONTRACT)("TypeScript adapters against real SQLite", () => {
  let directory: string;
  let child: ChildProcessWithoutNullStreams;
  let stopped: Promise<void>;
  async function start() {
    child = spawn(path.resolve("apps/desktop/src-tauri/target/debug/local-store-contract"), [path.join(directory, "contract.sqlite3")]);
    const pending: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    createInterface({ input: child.stdout }).on("line", (line) => {
      const waiter = pending.shift();
      if (!waiter) return;
      try {
        const response = JSON.parse(line);
        if (response.error) waiter.reject(new Error(response.error));
        else waiter.resolve(response.result);
      } catch (error) { waiter.reject(error as Error); }
    });
    child.on("error", (error) => { for (const waiter of pending.splice(0)) waiter.reject(error); });
    stopped = new Promise((resolve) => child.on("close", () => {
      for (const waiter of pending.splice(0)) waiter.reject(new Error(`SQLite runner exited: ${stderr}`));
      resolve();
    }));
    transport.send = (request) => new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
      child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }
  async function stop() { child.stdin.end(); await stopped; }
  beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "cadence-ts-sqlite-")); await start(); });
  afterEach(async () => { vi.restoreAllMocks(); await stop(); await rm(directory, { recursive: true, force: true }); });

  it("persists category descriptions and history-safe removal through the native adapter and restart", async () => {
    const profile = await localCommand("readProfile", {});
    const action = createLocalCategoryAction(() => undefined);
    const edit = async (intent: string, values: Record<string, string>) => {
      const categories = await localCommand("readCategories", { profileId: profile.id });
      const form = new FormData();
      for (const [key, value] of Object.entries({ intent, expected: categorySnapshot(categories), ...values })) form.set(key, value);
      return action({ status: "idle", message: "" }, form);
    };
    expect((await edit("create", { name: "Travel", description: "Routines while away" })).status).toBe("success");
    await stop(); await start();
    const categories = await localCommand("readCategories", { profileId: profile.id });
    const category = categories.find((row) => row.name === "Travel")!;
    expect(category.description).toBe("Routines while away");
    const store = createLocalBehaviorStore(profile.id, NOW);
    const created = await createBehavior(store, { userId: profile.id, timezone: profile.timezone, recordedAt: NOW.toString(), values: { ...VALUES, categoryId: category.id } });
    const graphs = await localCommand("readBehaviorGraphs", { profileId: profile.id });
    const expected = categoryAssignmentSnapshot(graphs.map(({ behavior }) => ({ id: behavior.id, categoryId: behavior.category_id, active: behavior.active, updatedAt: behavior.updated_at })), category.id);
    expect((await edit("delete", { category_id: category.id, confirm_delete: "yes", expected_assignments: "[]" })).status).toBe("error");
    expect((await edit("delete", { category_id: category.id, confirm_delete: "yes", expected_assignments: expected })).status).toBe("success");
    await stop(); await start();
    const saved = await localCommand("readBehaviorGraphs", { profileId: profile.id });
    expect(saved.find((row) => row.behavior.id === created.id)?.behavior.category_id).toBeNull();
    expect((await localCommand("readCategories", { profileId: profile.id })).some((row) => row.id === category.id)).toBe(false);
  });

  it("satisfies the shared BehaviorDataStore transaction and history contract", async () => {
    const profile = await localCommand("readProfile", {});
    await exerciseBehaviorStoreContract({
      userId: profile.id,
      timezone: profile.timezone,
      storeAt: (now) => createLocalBehaviorStore(profile.id, now),
      readSnapshot: async () => {
        const [snapshot, syncState] = await Promise.all([
          localCommand("readExportSnapshot", { profileId: profile.id, startLocalDate: null,
            endLocalDate: "2026-08-30", includeTimeTracking: false, throughStartedAt: CONTRACT_NOW.toString() }),
          localCommand("readSyncState", { profileId: profile.id }),
        ]);
        return {
          graphs: snapshot.graphs.map((graph) => toLocalBehaviorGraphRecord(graph, snapshot.categories)),
          definitions: snapshot.behaviorDefinitionEvents,
          configurations: snapshot.behaviorConfigurationEvents,
          syncState,
        };
      },
    });
  }, 20_000);

  it("preserves a tracking flow through native transactions and a full restart", async () => {
    const profile = await localCommand("readProfile", {});
    expect(await localCommand("readCategories", { profileId: profile.id })).toHaveLength(8);
    const behavior = await createBehavior(createLocalBehaviorStore(profile.id, NOW), {
      userId: profile.id, timezone: profile.timezone, values: VALUES, recordedAt: NOW.toString(),
    });
    const [bundle, concurrentBundle] = await Promise.all([loadLocalTimeline(7, NOW), loadLocalTimeline(7, NOW)]);
    expect(concurrentBundle.timeline).toEqual(bundle.timeline);
    const occurrence = bundle.timeline.daySections[0].occurrences[0];
    expect(occurrence.title).toBe("Contract walk");
    expect(occurrence.status).toBe("unresolved");
    const before = await localCommand("readOccurrences", { profileId: profile.id, startLocalDate: "2026-08-30", endLocalDate: "2026-09-30" });
    await loadLocalTimeline(7, NOW);
    expect(await localCommand("readOccurrences", { profileId: profile.id, startLocalDate: "2026-08-30", endLocalDate: "2026-09-30" })).toEqual(before);

    const updated = await updateBehavior(createLocalBehaviorStore(profile.id, NOW.add({ seconds: 1 })), {
      behaviorId: behavior.id, expectedUpdatedAt: behavior.updated_at,
      values: { ...VALUES, description: null }, recordedAt: NOW.add({ seconds: 1 }).toString(),
    });
    expect(updated.description).toBeNull();
    await expect(updateBehavior(createLocalBehaviorStore(profile.id, NOW.add({ seconds: 2 })), {
      behaviorId: behavior.id, expectedUpdatedAt: behavior.updated_at,
      values: { ...VALUES, title: "Stale title" }, recordedAt: NOW.add({ seconds: 2 }).toString(),
    })).rejects.toThrow("changed");

    await saveLocalOccurrenceNote(profile.id, { occurrenceId: occurrence.id, expectedNote: "", note: "  Private note\r\nline two  " }, NOW.add({ seconds: 3 }));
    await expect(saveLocalOccurrenceNote(profile.id, { occurrenceId: occurrence.id, expectedNote: "", note: "Stale replacement" }, NOW.add({ seconds: 4 }))).rejects.toThrow();
    const marked = await markLocalOccurrence(profile.id, { occurrenceId: occurrence.id, expectedStatus: "unresolved", nextStatus: "completed" }, NOW.add({ seconds: 5 }));
    expect(marked.statusEvent?.status_semantics).toBe("explicit_user_mark");
    const duplicate = await markLocalOccurrence(profile.id, { occurrenceId: occurrence.id, expectedStatus: "completed", nextStatus: "completed" }, NOW.add({ seconds: 6 }));
    expect(duplicate.statusChanged).toBe(false);
    expect((await localCommand("readOccurrenceHistory", { profileId: profile.id, occurrenceIds: [occurrence.id] })).statusEvents).toHaveLength(1);
    await trackLocalOccurrence(profile.id, occurrence.id, "start", NOW.add({ seconds: 10 }));
    await stop(); await start();
    expect(await localCommand("readProfile", {})).toEqual(profile);
    const stoppedTime = await trackLocalOccurrence(profile.id, occurrence.id, "stop", NOW.add({ seconds: 70 }));
    expect(stoppedTime.tracking.recordedSeconds).toBe(60);
    expect((await localCommand("readOccurrence", { profileId: profile.id, occurrenceId: occurrence.id }))?.note).toBe("Private note\nline two");
    const archiveNoteId = crypto.randomUUID();
    await setBehaviorActive(createLocalBehaviorStore(profile.id, NOW.add({ seconds: 80 })), {
      behaviorId: behavior.id, active: false, expectedUpdatedAt: updated.updated_at, newArchiveNoteId: archiveNoteId, archiveNote: "First archive", recordedAt: NOW.add({ seconds: 80 }).toString(),
    });
    const archived = await loadLocalTimeline(7, NOW.add({ seconds: 90 }));
    expect(archived.timeline.daySections.flatMap((day) => day.occurrences)).toHaveLength(0);
    expect(archived.behaviors.find((row) => row.id === behavior.id)!.archive_notes).toEqual([{
      id: archiveNoteId, archived_at: NOW.add({ seconds: 80 }).toString(), note: "First archive", updated_at: NOW.add({ seconds: 80 }).toString(),
    }]);
    expect((await localCommand("readOccurrence", { profileId: profile.id, occurrenceId: occurrence.id }))?.status).toBe("completed");
    const reminderTarget = await loadNotificationOccurrence({ occurrenceId: occurrence.id, profile,
      behaviors: archived.behaviors, now: NOW.add({ hours: 24 * 60 }) });
    expect(reminderTarget).toMatchObject({ id: occurrence.id, status: "completed", note: "Private note\nline two",
      canStartTimeTracking: false, timeTracking: { recordedSeconds: 60, runningStartedAt: null } });
    await expect(localCommand("readCategories", { profileId: crypto.randomUUID() })).rejects.toThrow("profile");
  }, 20_000);

  it("persists Note shortcuts and excludes shortcut-assisted Notes through restart", async () => {
    const profile = await localCommand("readProfile", {});
    const behavior = await createBehavior(createLocalBehaviorStore(profile.id, NOW), {
      userId: profile.id, timezone: profile.timezone, values: VALUES, recordedAt: NOW.toString(),
    });
    const occurrences = (await loadLocalTimeline(7, NOW)).timeline.daySections.flatMap((day) => day.occurrences);
    for (const [index, occurrence] of occurrences.slice(0, 3).entries()) {
      await saveLocalOccurrenceNote(profile.id, { occurrenceId: occurrence.id, expectedNote: "", note: "Wore aligners overnight" }, NOW.add({ seconds: index + 1 }));
    }
    const store = createLocalNoteShortcutStore(profile.id);
    const analysisNow = NOW.add({ hours: 48 });
    let view = await getNoteShortcutView(store, null, analysisNow);
    await manageNoteShortcuts(store, { behaviorId: null, command: { operation: "enable", enabled: true }, expectedRevision: noteShortcutRevision(view.state), now: analysisNow });
    view = await getNoteShortcutView(store, behavior.id, analysisNow);
    await manageNoteShortcuts(store, { behaviorId: behavior.id, command: { operation: "enable", enabled: true }, expectedRevision: noteShortcutRevision(view.state), now: analysisNow });
    view = await getNoteShortcutView(store, behavior.id, analysisNow);
    const analyzed = await manageNoteShortcuts(store, { behaviorId: behavior.id, command: { operation: "analyze" }, expectedRevision: noteShortcutRevision(view.state), now: analysisNow });
    expect(analyzed.entries).toHaveLength(1);
    const accepted = await manageNoteShortcuts(store, { behaviorId: behavior.id,
      command: { operation: "accept", key: analyzed.entries[0].key, text: "Private accepted shortcut" },
      expectedRevision: noteShortcutRevision(analyzed), now: analysisNow.add({ seconds: 1 }) });
    const form = new FormData();
    form.set("occurrence_id", occurrences[3].id);
    form.set("expected_note", "");
    form.set("note", "Edited after shortcut insertion");
    form.set("used_shortcut", "true");
    expect(await createLocalOccurrenceActions(profile.id, () => undefined).noteAction({ status: "idle", message: "" }, form)).toMatchObject({ status: "success" });
    const exported = await getLocalExportPageData(profile, { range: "all", includeNotes: true, now: analysisNow.add({ seconds: 3 }) });
    expect(JSON.stringify(exported)).not.toContain(accepted.entries[0].text!);
    expect(JSON.stringify(exported)).toContain("Edited after shortcut insertion");

    await stop(); await start();
    expect((await listAcceptedNoteShortcuts(createLocalNoteShortcutStore(profile.id)))[behavior.id]).toMatchObject([{ text: "Private accepted shortcut", status: "accepted" }]);
    expect((await localCommand("readNoteShortcutContext", { profileId: profile.id, behaviorId: behavior.id })).state?.excluded_occurrence_ids).toEqual([occurrences[3].id]);
  }, 20_000);

  it("exports real SQLite history in all formats without leaking owner IDs or default-sensitive content", async () => {
    const profile = await localCommand("readProfile", {});
    await createBehavior(createLocalBehaviorStore(profile.id, NOW), {
      userId: profile.id, timezone: profile.timezone, values: VALUES, recordedAt: NOW.toString(),
    });
    const timeline = await loadLocalTimeline(7, NOW);
    const occurrence = timeline.timeline.daySections[0].occurrences[0];
    const state = await localCommand("readNativeReminderState", { profileId: profile.id });
    await localCommand("commitNativeReminderPlan", {
      profileId: profile.id, mutationId: crypto.randomUUID(), now: NOW.toString(), expectedRevision: state.revision, cancelIds: [],
      reminders: [{ id: crypto.randomUUID(), user_id: profile.id, occurrence_id: occurrence.id,
        request_id: `cadence.local.${occurrence.id}`, fire_at: NOW.add({ hours: 1 }).toString(),
        title: "Private notification title", body: "Private notification body", status: "planned", error: null,
        verified_at: null, created_at: NOW.toString(), updated_at: NOW.toString() }],
    });
    await saveLocalOccurrenceNote(profile.id, { occurrenceId: occurrence.id, expectedNote: "", note: "Private export note" }, NOW);
    await trackLocalOccurrence(profile.id, occurrence.id, "start", NOW.add({ seconds: 1 }));
    await trackLocalOccurrence(profile.id, occurrence.id, "stop", NOW.add({ seconds: 61 }));
    const options = { now: NOW.add({ seconds: 90 }), range: "all" };
    const bundle = await getLocalExportPageData(profile, options);
    expect(bundle.jsonBackup.behavior_definition_events).toHaveLength(1);
    expect(bundle.jsonBackup.behavior_configuration_events).toHaveLength(1);
    expect(bundle.jsonBackup.occurrences[0].note).toBeNull();
    expect(bundle.jsonBackup).not.toHaveProperty("time_sessions");
    for (const format of ["jsonl", "csv", "json", "markdown", "behaviorlog"] as const) {
      const payload = await getLocalExportDownload(profile, format, options);
      const content = payload.text ?? readDesktopZipEntries(payload.bytes!).map((entry) => entry.content).join("\n");
      expect(content).not.toContain(profile.id);
      expect(content).not.toContain("Private export note");
      expect(content).not.toContain("Private notification");
      if (format === "behaviorlog") {
        const files = readDesktopZipEntries(payload.bytes!);
        const native = JSON.parse(files.find((file) => file.path === "raw/cadence/native_reminders.jsonl")!.content);
        expect(native).toMatchObject({ occurrence_id: occurrence.id, state: "planned", verified_at_utc: null });
        expect(native).not.toHaveProperty("user_id");
        expect(native).not.toHaveProperty("title");
        expect(native).not.toHaveProperty("body");
      }
    }
    const rich = await getLocalExportPageData(profile, { ...options, includeNotes: true, includeTimeTracking: true });
    expect(rich.jsonBackup.occurrences[0].note).toBe("Private export note");
    expect(rich.jsonBackup.time_sessions?.[0].duration_seconds).toBe(60);
  }, 20_000);
  it("changes timezone atomically and verifies bounded native reminders against actual SQLite", async () => {
    vi.spyOn(Temporal.Now, "instant").mockReturnValue(NOW);
    const profile = await localCommand("readProfile", {});
    const created = await createBehavior(createLocalBehaviorStore(profile.id, NOW), {
      userId: profile.id, timezone: profile.timezone, values: VALUES, recordedAt: NOW.toString(),
    });
    await loadLocalTimeline(7, NOW);
    expect(await updateLocalTimezone("America/Los_Angeles", NOW.add({ seconds: 1 }))).toMatchObject({ changed: true, activeBehaviorCount: 1 });
    const graphs = await localCommand("readBehaviorGraphs", { profileId: profile.id });
    expect(graphs[0].behavior.timezone).toBe("America/Los_Angeles");
    expect(await updateLocalTimezone("America/Los_Angeles", NOW.add({ seconds: 2 }))).toMatchObject({ changed: false });
    const current = await localCommand("readOccurrence", { profileId: profile.id,
      occurrenceId: (await loadLocalTimeline(7, NOW.add({ seconds: 3 }))).timeline.daySections[0].occurrences[0].id });
    expect(current?.scheduled_for).toBe("2026-08-30T16:00:00Z");

    type Request = { id: string; title: string; body: string; fireAt: string };
    const pending = new Map<string, Request>();
    let permission = "authorized";
    let cancellationFails = false;
    transport.notify = async (value) => {
      const request = value as { operation: string; reminders?: Request[]; ids?: string[] };
      if (request.operation === "status") return { authorization: permission };
      if (request.operation === "delivered") return { delivered: [] };
      if (request.operation === "schedule") for (const item of request.reminders ?? []) {
        pending.delete(item.id); pending.set(item.id, item);
        while (pending.size > 3) pending.delete(pending.keys().next().value!);
      }
      if (["cancel", "cancelPending"].includes(request.operation) && !cancellationFails) for (const id of request.ids ?? []) pending.delete(id);
      return { pending: [...pending.values()] };
    };
    const limited = await reconcileLocalReminders(NOW.add({ seconds: 3 }));
    expect(limited.state.coverage).toMatchObject({ status: "limited", expected_count: 30, scheduled_count: 3 });
    expect([...pending.values()].map((row) => row.fireAt)).toEqual([
      "2026-08-30T16:00:00Z", "2026-08-31T16:00:00Z", "2026-09-01T16:00:00Z",
    ]);
    expect(limited.state.coverage?.scheduled_through).toBe("2026-09-01T16:00:00Z");
    await markLocalOccurrence(profile.id, { occurrenceId: current!.id, expectedStatus: "unresolved", nextStatus: "completed" }, NOW.add({ seconds: 4 }));
    expect((await localCommand("readNativeReminderState", { profileId: profile.id })).coverage?.status).toBe("unverified");
    await reconcileLocalReminders(NOW.add({ seconds: 5 }));
    expect(pending.has(`cadence.local.${current!.id}`)).toBe(false);
    permission = "denied";
    cancellationFails = true;
    const failed = await reconcileLocalReminders(NOW.add({ seconds: 6 }));
    expect(failed.state.coverage).toMatchObject({ status: "unverified", verified_at: null });
    expect(failed.state.coverage?.reason).toContain("retained a cancelled reminder");
    cancellationFails = false;
    const denied = await reconcileLocalReminders(NOW.add({ seconds: 7 }));
    expect(denied.state.coverage).toMatchObject({ status: "unverified", scheduled_count: 0 });
    expect(pending.size).toBe(0);
    permission = "authorized";
    await setBehaviorActive(createLocalBehaviorStore(profile.id, NOW.add({ seconds: 8 })), {
      behaviorId: created.id, active: false, expectedUpdatedAt: graphs[0].behavior.updated_at, newArchiveNoteId: crypto.randomUUID(), recordedAt: NOW.add({ seconds: 8 }).toString(),
    });
    expect((await reconcileLocalReminders(NOW.add({ seconds: 9 }))).state.coverage).toMatchObject({ status: "complete", expected_count: 0 });
  }, 20_000);

  it("waits for delayed OS readback over real SQLite and archives delivered-only product requests", async () => {
    vi.spyOn(Temporal.Now, "instant").mockReturnValue(NOW);
    const profile = await localCommand("readProfile", {});
    const created = await createBehavior(createLocalBehaviorStore(profile.id, NOW), {
      userId: profile.id, timezone: profile.timezone, values: VALUES, recordedAt: NOW.toString(),
    });
    const timeline = await loadLocalTimeline(7, NOW);
    const occurrence = timeline.timeline.daySections[0].occurrences[0];
    await markLocalOccurrence(profile.id, { occurrenceId: occurrence.id, expectedStatus: "unresolved", nextStatus: "completed" }, NOW);
    type Request = { id: string; title: string; body: string; fireAt: string };
    const pending = new Map<string, Request>();
    let delivered: { id: string }[] = [];
    let reads = 0;
    let scheduled = false;
    const cancelled: string[] = [];
    transport.notify = async (value) => {
      const request = value as { operation: string; reminders?: Request[]; ids?: string[] };
      if (request.operation === "status") return { authorization: "authorized" };
      if (request.operation === "delivered") return { delivered };
      if (["cancel", "cancelPending"].includes(request.operation)) {
        cancelled.push(...request.ids ?? []);
        for (const id of request.ids ?? []) pending.delete(id);
        if (request.operation === "cancel") delivered = delivered.filter(({ id }) => !request.ids?.includes(id));
      }
      if (request.operation === "schedule") {
        scheduled = true;
        for (const item of request.reminders ?? []) pending.set(item.id, item);
      }
      if (request.operation === "pending" && scheduled && pending.size && reads < 3) return { pending: [...pending.values()].slice(0, [21, 23, 26][reads++]) };
      return { pending: [...pending.values()] };
    };
    const complete = await reconcileLocalReminders(NOW);
    expect(complete.state.coverage).toMatchObject({ status: "complete", expected_count: 29, scheduled_count: 29 });
    expect(pending.size).toBe(29);
    expect(cancelled).toEqual([]);
    const deliveredId = pending.keys().next().value!;
    pending.delete(deliveredId);
    delivered = [{ id: deliveredId }, { id: "unrelated-notification" }];
    await setBehaviorActive(createLocalBehaviorStore(profile.id, NOW.add({ seconds: 1 })), {
      behaviorId: created.id, active: false, expectedUpdatedAt: created.updated_at, newArchiveNoteId: crypto.randomUUID(), recordedAt: NOW.add({ seconds: 1 }).toString(),
    });
    const archived = await reconcileLocalReminders(NOW.add({ seconds: 2 }));
    expect(archived.state.coverage).toMatchObject({ status: "complete", expected_count: 0, scheduled_count: 0 });
    expect(pending.size).toBe(0);
    expect(delivered).toEqual([{ id: "unrelated-notification" }]);
    expect(cancelled).toContain(deliveredId);
  }, 20_000);

  it("persists late activation delivery through empty OS readback, archive, restart, and BehaviorLog export", async () => {
    const clock = vi.spyOn(Temporal.Now, "instant").mockReturnValue(NOW);
    const profile = await localCommand("readProfile", {});
    const behavior = await createBehavior(createLocalBehaviorStore(profile.id, NOW), {
      userId: profile.id, timezone: profile.timezone, values: VALUES, recordedAt: NOW.toString(),
    });
    type Request = { id: string; title: string; body: string; fireAt: string };
    const pending = new Map<string, Request>();
    transport.notify = async (value) => {
      const request = value as { operation: string; reminders?: Request[]; ids?: string[] };
      if (request.operation === "status") return { authorization: "authorized" };
      if (request.operation === "delivered") return { delivered: [] };
      if (request.operation === "schedule") for (const row of request.reminders ?? []) pending.set(row.id, row);
      if (["cancel", "cancelPending"].includes(request.operation)) for (const id of request.ids ?? []) pending.delete(id);
      return { pending: [...pending.values()] };
    };
    await reconcileLocalReminders(NOW);
    const request = [...pending.values()].sort((left, right) => left.fireAt.localeCompare(right.fireAt))[0];
    const afterDelivery = Temporal.Instant.from(request.fireAt).add({ seconds: 2 });
    pending.delete(request.id);
    clock.mockReturnValue(afterDelivery);
    // An ordinary refresh can finish expiry cleanup before the activation drain resolves.
    const cleaned = await reconcileLocalReminders(afterDelivery);
    expect(cleaned.state.reminders.find((row) => row.request_id === request.id)?.status).toBe("cancelled");
    retainNativeDeliveryEvents([{ kind: "notificationActivated", id: request.id, at: afterDelivery.toString(),
      delivery: { requestId: request.id, fireAt: request.fireAt, title: request.title, body: request.body,
        deliveredAt: Temporal.Instant.from(request.fireAt).add({ seconds: 1 }).toString() } }]);
    expect((await reconcileLocalReminders(afterDelivery)).state.reminders.find((row) => row.request_id === request.id)?.status).toBe("delivered");
    const archiveAt = afterDelivery.add({ seconds: 1 }); clock.mockReturnValue(archiveAt);
    await setBehaviorActive(createLocalBehaviorStore(profile.id, archiveAt), { behaviorId: behavior.id, active: false, expectedUpdatedAt: behavior.updated_at, newArchiveNoteId: crypto.randomUUID(), recordedAt: archiveAt.toString() });
    await reconcileLocalReminders(archiveAt);
    expect(pending.size).toBe(0);
    await stop(); await start();
    const saved = await localCommand("readNativeReminderState", { profileId: profile.id });
    const row = saved.reminders.find((row) => row.request_id === request.id)!;
    expect(row.status).toBe("delivered");
    const exported = await getLocalExportPageData(profile, { now: archiveAt, range: "all", includeArchived: true });
    const interventions = exported.behaviorLog.files.find((file) => file.path === "data/interventions.jsonl")!.content
      .trim().split("\n").map((line) => JSON.parse(line));
    const intervention = interventions.find((record) => record.intervention_id === `native_${row.id}`);
    expect(intervention).toMatchObject({ delivery_status: "delivered", channel: "other",
      extensions: { "app.cadence": { native_state: "delivered", user_receipt: "unverified" } } });
    expect(intervention.source.transformation_notes).toContain("user receipt or reading is unverified");
    expect(intervention).not.toHaveProperty("sent_at_utc");
  }, 20_000);

  it("persists native reminder intent and offset across restart, then replans the same requests", async () => {
    vi.spyOn(Temporal.Now, "instant").mockReturnValue(NOW);
    const profile = await localCommand("readProfile", {});
    const created = await createBehavior(createLocalBehaviorStore(profile.id, NOW), {
      userId: profile.id, timezone: profile.timezone, values: VALUES, recordedAt: NOW.toString(),
    });
    type Request = { id: string; title: string; body: string; fireAt: string };
    const pending = new Map<string, Request>();
    const operations: string[] = [];
    transport.notify = async (value) => {
      const request = value as { operation: string; reminders?: Request[]; ids?: string[] };
      operations.push(request.operation);
      if (request.operation === "status") return { authorization: "authorized" };
      if (request.operation === "delivered") return { delivered: [] };
      if (["cancel", "cancelPending"].includes(request.operation)) for (const id of request.ids ?? []) pending.delete(id);
      if (request.operation === "schedule") for (const item of request.reminders ?? []) pending.set(item.id, item);
      return { pending: [...pending.values()] };
    };
    expect((await reconcileLocalReminders(NOW)).state.coverage?.status).toBe("complete");
    const original = new Map(pending);
    expect(original.size).toBe(30);
    const graph = (await localCommand("readBehaviorGraphs", { profileId: profile.id }))[0];
    const schedules = [{ ...VALUES.schedules[0], id: graph.schedules[0].id,
      timeEntries: [{ ...VALUES.schedules[0].timeEntries[0], id: graph.slots[0].id }] }];
    await updateBehavior(createLocalBehaviorStore(profile.id, NOW.add({ seconds: 1 })), {
      behaviorId: created.id, expectedUpdatedAt: graph.behavior.updated_at,
      values: { ...VALUES, schedules, browserReminderEnabled: false, reminderOffsetMinutes: 60 }, recordedAt: NOW.add({ seconds: 1 }).toString(),
    });
    expect((await reconcileLocalReminders(NOW.add({ seconds: 2 }))).state.coverage).toMatchObject({ status: "complete", expected_count: 0 });
    expect(pending.size).toBe(0);
    await stop(); await start();
    const saved = (await localCommand("readBehaviorGraphs", { profileId: profile.id }))[0].behavior;
    expect(saved).toMatchObject({ browser_reminder_enabled: false, reminder_offset_minutes: 60 });
    await updateBehavior(createLocalBehaviorStore(profile.id, NOW.add({ seconds: 3 })), {
      behaviorId: created.id, expectedUpdatedAt: saved.updated_at,
      values: { ...VALUES, schedules, browserReminderEnabled: true, reminderOffsetMinutes: 60 }, recordedAt: NOW.add({ seconds: 3 }).toString(),
    });
    expect((await reconcileLocalReminders(NOW.add({ seconds: 4 }))).state.coverage).toMatchObject({ status: "complete", expected_count: 30 });
    expect(pending.size).toBe(30);
    const occurrences = await localCommand("readOccurrences", { profileId: profile.id, startLocalDate: "2026-08-30", endLocalDate: "2026-10-01" });
    for (const [id, request] of pending) {
      const occurrence = occurrences.find((row) => id === `cadence.local.${row.id}`)!;
      expect(request.fireAt).toBe(Temporal.Instant.from(occurrence.scheduled_for).subtract({ minutes: 60 }).toString());
    }
    // The first offset now lies in the past; one farther generated request fills the 30-day target.
    expect(pending.has(original.keys().next().value!)).toBe(false);
    expect([...pending.keys()].filter((id) => original.has(id))).toHaveLength(29);
    expect(operations).not.toContain("requestPermission");
  }, 20_000);
});
