import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { firstLinkIncludesTravel, hasRecognizedLocalData, preparePrivateFirstLinkImport } from "@cadence/core/services/first-account-link";
import { DEFAULT_CATEGORY_NAMES } from "@cadence/core/types/database";
import { accountSyncFingerprint, type AccountSyncEntity, type AccountSyncSnapshot } from "@cadence/core/resolvers/account-sync.resolver";
import type { PortabilitySnapshot } from "@cadence/core/types/portability-rows";
import { FirstAccountLinkChoice } from "../apps/desktop/src/account/account-panel";
import { portabilityEntities } from "../apps/desktop/src/account/account-sync";
import { canonicalJson } from "../apps/desktop/src/account/canonical-json";
import { applyVerifiedFirstLinkPlan, assertFirstLinkLocalUnchanged, commitFirstLink, completedFirstLinkState, existingRecordsFromHostedEnvelope, finishReviewedFirstAccountLink, firstLinkAccountSyncBaseline, firstLinkFailureBackupPath, firstLinkLocalFingerprint, localChangedSinceFirstLinkAttempt, planFirstLinkReconciliation, reconcileLocalFromHosted, recoverRejectedFirstLinkReview, stabilizeFirstLinkAttempt } from "../apps/desktop/src/account/first-link";

function snapshot(): PortabilitySnapshot {
  const profile = { id: "local", timezone: "America/New_York", email: "", display_name: null, created_at: "now", updated_at: "now" };
  return { revision: 0, profile, categories: DEFAULT_CATEGORY_NAMES.map((name, sort_order) => ({ id: `c${sort_order}`, user_id: profile.id, name, sort_order, created_at: "now", updated_at: "now" })), graphs: [], definitionEvents: [], configurationEvents: [], occurrences: [], statusEvents: [], timeSessions: [], importRuns: [], mappings: [], importedNotes: [], importedInterventions: [] };
}

const graph = (entities: readonly AccountSyncEntity[] = []): AccountSyncSnapshot => ({
  entities: [{ kind: "profile" as const, id: "profile", value: { timezone: "America/New_York" } }, ...entities],
});

describe("first desktop account link", () => {
  it("does not mistake untouched seed rows for recognized local data", () => {
    expect(hasRecognizedLocalData(snapshot())).toBe(false);
  });

  it("offers the first-link choice for each saved travel preference", () => {
    const defaults = { enabled: false, baseLocationText: null, mode: null, navigationPreference: null,
      routingConsentAt: null, onboardingCompletedAt: null, updatedAt: "2026-09-22T00:00:00Z" } as const;
    expect(hasRecognizedLocalData({ ...snapshot(), travelSettings: defaults })).toBe(false);
    for (const preference of [{ enabled: true }, { baseLocationText: "Private base" }, { mode: "walking" as const },
      { navigationPreference: "apple_maps" as const }, { routingConsentAt: defaults.updatedAt }, { onboardingCompletedAt: defaults.updatedAt }]) {
      const local = { ...snapshot(), travelSettings: { ...defaults, ...preference } };
      expect(hasRecognizedLocalData(local)).toBe(true);
      expect(firstLinkIncludesTravel({ entities: portabilityEntities(local) })).toBe(true);
    }
  });

  it("preserves private travel fields and history while matching existing category identities", () => {
    const category = (id: string, created_at: string) => ({ kind: "category" as const, id,
      value: { id, name: "Health", description: null, sort_order: 0, created_at, updated_at: created_at } });
    const local: AccountSyncSnapshot = { entities: [
      { kind: "profile", id: "profile", value: { timezone: "America/New_York", base_location_text: "Private base", travel_mode: "walking" } },
      category("local-category", "2026-09-20T00:00:00Z"),
      { kind: "behavior", id: "behavior", value: { id: "behavior", title: "Walk", category_id: "local-category", location_text: "Private destination", current_configuration_event_id: "history" } },
      { kind: "configuration_event", id: "history", value: { id: "history", behavior_id: "behavior", event_kind: "baseline", previous_configuration: null,
        next_configuration: { categoryId: "local-category", locationText: "Private destination", scheduleGraph: [], browserReminderEnabled: true,
          emailReminderEnabled: false, reminderOffsetMinutes: 0, active: true, timezone: "America/New_York" } } },
    ] };
    const hosted = graph([category("hosted-category", "2026-09-21T00:00:00Z")]);
    const prepared = preparePrivateFirstLinkImport(local, hosted);
    const { plan } = planFirstLinkReconciliation({ ...prepared, hosted, accountLinkId: "hosted", choice: "import", localUnchanged: true, outboxHighWater: 0 });
    expect(plan.conflicts).toEqual([]);
    expect(plan.mergedEntities.filter(({ kind }) => kind === "category")).toHaveLength(1);
    expect(plan.mergedEntities.find(({ kind }) => kind === "profile")?.value).toMatchObject({ base_location_text: "Private base", travel_mode: "walking" });
    expect(plan.mergedEntities.find(({ kind }) => kind === "behavior")?.value).toMatchObject({ location_text: "Private destination", category_id: "hosted-category" });
    expect(plan.mergedEntities.find(({ kind }) => kind === "configuration_event")?.value).toMatchObject({ next_configuration: { location_text: "Private destination", category_id: "hosted-category" } });
    const retry = preparePrivateFirstLinkImport(local, { entities: plan.mergedEntities });
    const retried = planFirstLinkReconciliation({ ...retry, hosted: { entities: plan.mergedEntities }, accountLinkId: "hosted", choice: "import", localUnchanged: true, outboxHighWater: 0 }).plan;
    expect(retried.conflicts).toEqual([]);
    expect(retried.hostedWrites).toEqual([]);
  });

  it("reviews conflicting account travel preferences without picking a winner", () => {
    const profile = (base: string): AccountSyncSnapshot => ({ entities: [{ kind: "profile", id: "profile", value: { timezone: "America/New_York", base_location_text: base } }] });
    const hosted = profile("Account base");
    const prepared = preparePrivateFirstLinkImport(profile("Local base"), hosted);
    const { plan } = planFirstLinkReconciliation({ ...prepared, hosted, accountLinkId: "hosted", choice: "import", localUnchanged: true, outboxHighWater: 0 });
    expect(plan.conflicts).toMatchObject([{ kind: "profile", reason: "concurrent_update" }]);
    expect(plan.hostedWrites).toEqual([]);
    const historyOnly = graph([{ kind: "configuration_event", id: "old-location", value: { previous_configuration: { location_text: "Removed address" }, next_configuration: { location_text: null } } }]);
    expect(firstLinkIncludesTravel(historyOnly)).toBe(true);
  });

  it("offers the first-link choice when only a global shortcut preference exists", () => {
    expect(hasRecognizedLocalData({ ...snapshot(), noteShortcutStates: [] })).toBe(false);
    expect(hasRecognizedLocalData({ ...snapshot(), noteShortcutStates: [{ id: "global", enabled: true }] })).toBe(true);
  });

  it("offers the first-link choice when only day notes exist", () => {
    const dayNote = { id: "day-note-1", user_id: "local", local_date: "2026-11-10", note: "Slept badly", revision: 1,
      created_at: "2026-11-10T12:00:00Z", updated_at: "2026-11-10T12:00:00Z" };
    expect(hasRecognizedLocalData({ ...snapshot(), dayNotes: [] })).toBe(false);
    expect(hasRecognizedLocalData({ ...snapshot(), dayNotes: [dayNote] })).toBe(true);
    expect(hasRecognizedLocalData({ ...snapshot(), dayNotes: [{ ...dayNote, note: null, revision: 2 }] })).toBe(true);
  });

  it("reuses the pending attempt and pre-commit fingerprints after a hosted-success retry", async () => {
    let saved: { attemptId: string; localFingerprint: string; hostedFingerprint: string; preAttemptBaselineJson: string } | null = null;
    const begin = async (proposed: typeof saved & {}) => saved ??= proposed;
    const first = await stabilizeFirstLinkAttempt({ attemptId: "first", localFingerprint: "local-before", hostedFingerprint: "hosted-before", preAttemptBaselineJson: '{"entities":[]}' }, begin);
    const retry = await stabilizeFirstLinkAttempt({ attemptId: "second", localFingerprint: "local-before", hostedFingerprint: "hosted-after-import", preAttemptBaselineJson: '{"entities":["changed"]}' }, begin);
    expect(retry).toEqual(first);
  });

  it("uploads local shortcut state after BehaviorLog first-link import", () => {
    const shortcut = { kind: "note_shortcut_state" as const, id: "global", value: { id: "global", enabled: true } };
    const baseline = { entities: [shortcut] };
    expect(firstLinkAccountSyncBaseline(baseline, "import").entities).toEqual([]);
    expect(firstLinkAccountSyncBaseline(baseline, "ignore").entities).toEqual([shortcut]);
  });

  it("rejects a restarted pending Import before uploading post-choice local edits", async () => {
    const pending = await stabilizeFirstLinkAttempt({ attemptId: "restart", localFingerprint: "before", hostedFingerprint: "hosted", preAttemptBaselineJson: '{"entities":[]}' }, async (value) => value);
    expect(() => assertFirstLinkLocalUnchanged("after-edit", pending.localFingerprint)).toThrow("before uploading data");
  });

  it("detects product, profile, category, history, and provenance changes", () => {
    const cases: PortabilitySnapshot[] = [];
    const timezone = snapshot(); timezone.profile.timezone = "Europe/Rome"; cases.push(timezone);
    const category = snapshot(); category.categories[0]!.name = "Health"; cases.push(category);
    const graph = snapshot(); graph.graphs.push({} as never); cases.push(graph);
    const history = snapshot(); history.statusEvents.push({} as never); cases.push(history);
    const provenance = snapshot(); provenance.importedNotes.push({} as never); cases.push(provenance);
    expect(cases.every(hasRecognizedLocalData)).toBe(true);
    expect(hasRecognizedLocalData({ ...snapshot(), reminderDeliveries: [{}] })).toBe(true);
  });

  it("renders one explicit import, ignore, or cancel choice", () => {
    const html = renderToStaticMarkup(<FirstAccountLinkChoice busy={false} backupPath="/Backups/cadence.sqlite3" onImport={() => {}} onIgnore={() => {}} onCancel={() => {}} />);
    expect(html).toContain("Import local data into the account");
    expect(html).toContain("Ignore local data and use account data");
    expect(html).toContain("Cancel account link");
    expect(html).toContain("/Backups/cadence.sqlite3");
  });

  it.each([
    ["import", ["hosted", "read", "local", "baseline"]],
    ["ignore", ["backup", "read", "local", "baseline"]],
    ["hydrate", ["read", "local", "baseline"]],
  ] as const)("orders the %s two-commit path before its baseline", async (choice, expected) => {
    const calls: string[] = [];
    const result = await commitFirstLink(choice, {
      importHosted: async () => { calls.push("hosted"); return { conflictCount: 0 }; },
      backupLocal: async () => { calls.push("backup"); return "/protected.sqlite3"; },
      readHosted: async () => { calls.push("read"); return { rows: 1 }; },
      applyLocal: async () => { calls.push("local"); },
      saveBaseline: async () => { calls.push("baseline"); },
    });
    expect(calls).toEqual(expected);
    expect(result.status).toBe("complete");
  });

  it("routes conflicts without writing either the local copy or baseline", async () => {
    const calls: string[] = [];
    const result = await commitFirstLink("import", {
      importHosted: async () => ({ conflictCount: 2 }), backupLocal: async () => "unused",
      readHosted: async () => { calls.push("read"); return {}; }, applyLocal: async () => { calls.push("local"); },
      saveBaseline: async () => { calls.push("baseline"); },
    });
    expect(result).toEqual({ status: "conflict", count: 2 });
    expect(calls).toEqual([]);
  });

  it.each(["hosted", "backup", "local"] as const)("does not advance the baseline after an injected %s failure", async (failure) => {
    const calls: string[] = [];
    const reject = (name: string) => { calls.push(name); throw new Error(`${name} failed`); };
    await expect(commitFirstLink(failure === "backup" ? "ignore" : "import", {
      importHosted: async () => failure === "hosted" ? reject("hosted") : { conflictCount: 0 },
      backupLocal: async () => failure === "backup" ? reject("backup") : "/protected.sqlite3",
      readHosted: async () => ({}), applyLocal: async () => { if (failure === "local") reject("local"); },
      saveBaseline: async () => { calls.push("baseline"); },
    })).rejects.toThrow(`${failure} failed`);
    expect(calls).not.toContain("baseline");
  });

  it("finishes a hosted-success retry from the reconciled snapshot and saves the baseline last", async () => {
    const calls: string[] = [];
    const result = await commitFirstLink("import", {
      importHosted: async () => { calls.push("hosted-idempotent"); return { conflictCount: 0 }; },
      backupLocal: async () => "unused",
      readHosted: async () => { calls.push("read-hosted"); return { version: "after-import" }; },
      applyLocal: async () => { calls.push("reconcile-local"); return { baseline: { version: "after-reconcile" } }; },
      saveBaseline: async (baseline) => { calls.push(`baseline:${(baseline as { version: string }).version}`); },
    });
    expect(result.status).toBe("complete");
    expect(calls).toEqual(["hosted-idempotent", "read-hosted", "reconcile-local", "baseline:after-reconcile"]);
  });

  it("routes divergent recovery into whole-plan conflict review without advancing the baseline", async () => {
    const calls: string[] = [];
    const inputs = { accountLinkId: "hosted", baseline: { entities: [] }, local: { entities: [] }, hosted: { entities: [] }, baselineFingerprint: "b", hostedFingerprint: "h", outboxHighWater: 1 };
    const conflict = { kind: "behavior", id: "shared", reason: "concurrent_update", baseline: null, local: { title: "Mac" }, hosted: { title: "Account" } } as const;
    const result = await commitFirstLink("import", {
      importHosted: async () => ({ conflictCount: 0 }), backupLocal: async () => "unused", readHosted: async () => ({}),
      applyLocal: async () => ({ inputs, conflicts: [conflict], attempt: { attemptId: "attempt", localFingerprint: "l", hostedFingerprint: "h", preAttemptBaselineJson: '{"entities":[]}', choice: "import" } }),
      saveBaseline: async () => { calls.push("baseline"); },
    });
    expect(result).toMatchObject({ status: "conflict", count: 1, inputs, conflicts: [conflict] });
    expect(calls).toEqual([]);
  });

  it("plans divergent first-link rows as reviewable whole-plan conflicts", () => {
    const value = (title: string) => graph([{ kind: "behavior", id: "shared", value: { id: "shared", title } }]);
    const { inputs, plan } = planFirstLinkReconciliation({ accountLinkId: "hosted", local: value("Mac"), hosted: value("Account"), choice: "import", localUnchanged: false, outboxHighWater: 4 });
    expect(inputs.baseline.entities).toEqual([]);
    expect(plan.conflicts).toMatchObject([{ kind: "behavior", id: "shared", reason: "append_id_collision" }]);
    expect(plan.localWrites).toEqual([]);
    expect(plan.hostedWrites).toEqual([]);
  });

  it("replaces untouched local seed IDs with hosted seed IDs through account sync", () => {
    const category = (id: string) => ({ kind: "category" as const, id, value: { id, user_id: "owner", name: "Medical", sort_order: 0 } });
    const local = graph([category("local-seed")]);
    const hosted = graph([category("hosted-seed")]);
    const { plan } = planFirstLinkReconciliation({ accountLinkId: "hosted", baseline: local, local, hosted, choice: "hydrate", localUnchanged: true, outboxHighWater: 1 });
    expect(plan.conflicts).toEqual([]);
    expect(plan.hostedWrites).toEqual([]);
    expect(plan.localWrites).toMatchObject([
      { kind: "category", id: "hosted-seed", operation: "upsert" },
      { kind: "category", id: "local-seed", operation: "delete" },
    ]);
  });

  it("hydrates untouched local data from same-status hosted history branches", () => {
    const event = (id: string) => ({ kind: "status_event" as const, id, value: { id, behavior_id: "behavior", occurrence_id: "occurrence", revises_event_id: null, status: "completed" } });
    const local = graph();
    const hosted = graph([
      { kind: "behavior", id: "behavior", value: { id: "behavior", title: "Behavior" } },
      { kind: "occurrence", id: "occurrence", value: { id: "occurrence", behavior_id: "behavior", status: "completed" } },
      event("first"), event("second"),
    ]);
    const { plan } = planFirstLinkReconciliation({ accountLinkId: "hosted", baseline: local, local, hosted, choice: "hydrate", localUnchanged: false, outboxHighWater: 1 });
    expect(plan.conflicts).toEqual([]);
    expect(plan.hostedWrites).toEqual([]);
    expect(plan.localWrites.filter(({ kind }) => kind === "status_event")).toMatchObject([{ id: "first", operation: "upsert" }, { id: "second", operation: "upsert" }]);
  });

  it("uploads a post-attempt local edit when the hosted row still matches the baseline", () => {
    const entity = (title: string) => ({ kind: "behavior" as const, id: "shared", value: { id: "shared", title } });
    const baseline = graph([entity("Before")]);
    const local = graph([entity("Edited on this Mac")]);
    const hosted = graph([entity("Before")]);
    const { plan } = planFirstLinkReconciliation({ accountLinkId: "hosted", baseline, local, hosted, choice: "import", localUnchanged: false, outboxHighWater: 2 });
    expect(plan.conflicts).toEqual([]);
    expect(plan.hostedWrites).toMatchObject([{ kind: "behavior", id: "shared", operation: "upsert", value: { title: "Edited on this Mac" } }]);
    expect(plan.localWrites).toEqual([]);
  });

  it("pauses for review when both copies changed after the first-link attempt", () => {
    const entity = (title: string) => ({ kind: "behavior" as const, id: "shared", value: { id: "shared", title } });
    const baseline = graph([entity("Before")]);
    const local = graph([entity("Edited on this Mac")]);
    const hosted = graph([entity("Edited in the account")]);
    const { plan } = planFirstLinkReconciliation({ accountLinkId: "hosted", baseline, local, hosted, choice: "import", localUnchanged: false, outboxHighWater: 2 });
    expect(plan.conflicts).toMatchObject([{ kind: "behavior", id: "shared", reason: "concurrent_update" }]);
    expect(plan.hostedWrites).toEqual([]);
    expect(plan.localWrites).toEqual([]);
  });

  it("applies a post-attempt local deletion through the returned plan", () => {
    const entity = { kind: "category" as const, id: "shared", value: { id: "shared", name: "Before" } };
    const baseline = graph([entity]);
    const { plan } = planFirstLinkReconciliation({ accountLinkId: "hosted", baseline, local: graph(), hosted: baseline,
      choice: "import", localUnchanged: false, outboxHighWater: 2 });
    expect(plan.conflicts).toEqual([]);
    expect(plan.hostedWrites).toMatchObject([{ kind: "category", id: "shared", operation: "delete" }]);
  });

  it("preserves an Ignore backup through conflict review and exits first-link state after review", async () => {
    const inputs = { accountLinkId: "hosted", baseline: { entities: [] }, local: { entities: [] }, hosted: { entities: [] }, baselineFingerprint: "b", hostedFingerprint: "h", outboxHighWater: 1 };
    const conflict = { kind: "behavior", id: "shared", reason: "concurrent_update", baseline: null, local: { title: "Mac" }, hosted: { title: "Account" } } as const;
    const result = await commitFirstLink("ignore", {
      importHosted: async () => ({ conflictCount: 0 }), backupLocal: async () => "/protected.sqlite3", readHosted: async () => ({}),
      applyLocal: async () => ({ inputs, conflicts: [conflict], attempt: { attemptId: "attempt", localFingerprint: "l", hostedFingerprint: "h", preAttemptBaselineJson: '{"entities":[]}', choice: "ignore" } }),
      saveBaseline: async () => { throw new Error("baseline must wait"); },
    });
    expect(result).toMatchObject({ status: "conflict", backupPath: "/protected.sqlite3" });
    expect(completedFirstLinkState({ status: "complete", backupPath: result.backupPath ?? null })).toEqual({
      firstLink: { recognized: false, complete: true, backupPath: "/protected.sqlite3" }, syncReady: true,
    });
  });

  it("rejects changed local Ignore data instead of planning hosted writes", () => {
    const value = (title: string) => graph([{ kind: "behavior", id: "shared", value: { id: "shared", title } }]);
    expect(() => planFirstLinkReconciliation({ accountLinkId: "hosted", local: value("Edited after choice"), hosted: value("Account"), choice: "ignore", localUnchanged: false, outboxHighWater: 5 }))
      .toThrow("before replacing local data");
  });

  it("aborts Ignore after a post-choice local mutation before invoking the hosted provider", async () => {
    const original = snapshot();
    const changed = { ...snapshot(), revision: 1, profile: { ...snapshot().profile, timezone: "Europe/Rome" } };
    const hostedEntities = portabilityEntities(original);
    const hostedFingerprint = accountSyncFingerprint({ entities: hostedEntities });
    let hostedProviderInvoked = false;
    const client = new Proxy({}, { get: () => { hostedProviderInvoked = true; throw new Error("Hosted provider must not be invoked."); } });
    await expect(reconcileLocalFromHosted(client as never, original.profile.id, "hosted", {
      schemaVersion: 1, userId: "hosted", fingerprint: hostedFingerprint, entities: hostedEntities,
    }, changed, "ignore", "attempt", firstLinkLocalFingerprint(original), hostedFingerprint, "/protected.sqlite3",
    canonicalJson({ entities: hostedEntities }))).rejects.toThrow("before replacing local data");
    expect(hostedProviderInvoked).toBe(false);
  });

  it("plans unchanged Ignore as a local-only hosted replacement", () => {
    const local = graph([{ kind: "behavior", id: "local", value: { id: "local", title: "Mac" } }]);
    const hosted = graph([{ kind: "behavior", id: "hosted", value: { id: "hosted", title: "Account" } }]);
    const { plan } = planFirstLinkReconciliation({ accountLinkId: "hosted", local, hosted, choice: "ignore", localUnchanged: true, outboxHighWater: 5 });
    expect(plan.conflicts).toEqual([]);
    expect(plan.hostedWrites).toEqual([]);
    expect(plan.localWrites).toMatchObject([
      { kind: "behavior", id: "hosted", operation: "upsert" },
      { kind: "behavior", id: "local", operation: "delete" },
    ]);
  });

  it("rejects legacy reviewed Ignore before invoking the hosted provider", async () => {
    let hostedProviderInvoked = false;
    const client = new Proxy({}, { get: () => { hostedProviderInvoked = true; throw new Error("Hosted provider must not be invoked."); } });
    await expect(finishReviewedFirstAccountLink({ client: client as never, profileId: "local", reviewed: {
      inputs: { accountLinkId: "hosted", baseline: graph(), local: graph(), hosted: graph(), baselineFingerprint: "b", hostedFingerprint: "h", outboxHighWater: 1 },
      conflicts: [], attempt: { attemptId: "attempt", localFingerprint: "l", hostedFingerprint: "h", preAttemptBaselineJson: '{"entities":[]}', choice: "ignore" },
      backupPath: "/protected.sqlite3",
    }, decisions: [] })).rejects.toThrow("Cancel the account link and start it again");
    expect(hostedProviderInvoked).toBe(false);
  });

  it("returns actionable typed review inputs for import-preview conflicts", async () => {
    const inputs = { accountLinkId: "hosted", baseline: { entities: [] }, local: { entities: [] }, hosted: { entities: [] }, baselineFingerprint: "b", hostedFingerprint: "h", outboxHighWater: 1 };
    const conflict = { kind: "behavior", id: "shared", reason: "append_id_collision", baseline: null, local: { title: "Mac" }, hosted: { title: "Account" } } as const;
    const result = await commitFirstLink("import", {
      importHosted: async () => ({ conflictCount: 1, conflict: { inputs, conflicts: [conflict], attempt: { attemptId: "attempt", localFingerprint: "l", hostedFingerprint: "h", preAttemptBaselineJson: '{"entities":[]}', choice: "import" } } }),
      backupLocal: async () => "unused", readHosted: async () => { throw new Error("must not read"); }, applyLocal: async () => { throw new Error("must not apply"); }, saveBaseline: async () => { throw new Error("must not save"); },
    });
    expect(result).toMatchObject({ status: "conflict", count: 1, inputs, conflicts: [conflict], attempt: { attemptId: "attempt" } });
  });

  it("recovers a rejected reviewed plan by returning to the first-link choice", () => {
    const reviewed = { inputs: { accountLinkId: "hosted", baseline: { entities: [] }, local: { entities: [] }, hosted: { entities: [] }, baselineFingerprint: "b", hostedFingerprint: "h", outboxHighWater: 1 },
      conflicts: [], attempt: { attemptId: "attempt", localFingerprint: "l", hostedFingerprint: "h", preAttemptBaselineJson: '{"entities":[]}', choice: "ignore" as const }, backupPath: "/protected.sqlite3" };
    expect(recoverRejectedFirstLinkReview(reviewed, "The plan is stale.")).toEqual({ recognized: true, backupPath: "/protected.sqlite3",
      error: "The account data changed before those decisions were applied. Choose the data path again. The plan is stale." });
  });

  it("adapts the hosted envelope only for import-preview existing records", () => {
    const envelope = { schemaVersion: 1, userId: "hosted", fingerprint: "0".repeat(64), entities: [
      { kind: "mapping" as const, id: "mapping", value: { import_run_id: "run", record_type: "behavior", external_id: "external", local_id: "local", created_at: "2026-09-01T12:00:00Z" } },
    ] };
    expect(existingRecordsFromHostedEnvelope(envelope).mappings).toEqual([{ recordType: "behavior", externalId: "external", localId: "local" }]);
  });

  it("detects replacement-domain changes but ignores native reminder bookkeeping", () => {
    const original = snapshot();
    const originalFingerprint = firstLinkLocalFingerprint(original);
    expect(localChangedSinceFirstLinkAttempt({ ...original, revision: original.revision + 1,
      nativeReminders: [{ id: "native-only" }] } as typeof original, originalFingerprint)).toBe(false);
    expect(localChangedSinceFirstLinkAttempt({ ...original,
      profile: { ...original.profile, timezone: "Europe/Rome" } }, originalFingerprint)).toBe(true);
  });

  it.each(["read", "apply"] as const)("preserves the Ignore backup path after a %s failure", async (failure) => {
    let caught: unknown;
    try {
      await commitFirstLink("ignore", {
        importHosted: async () => ({ conflictCount: 0 }), backupLocal: async () => "/protected.sqlite3",
        readHosted: async () => { if (failure === "read") throw new Error("read failed"); return {}; },
        applyLocal: async () => { if (failure === "apply") throw new Error("apply failed"); }, saveBaseline: async () => undefined,
      });
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(`${failure} failed`);
    expect(firstLinkFailureBackupPath(caught)).toBe("/protected.sqlite3");
  });

  it("rejects an invalid hosted fingerprint before mutating local data", async () => {
    const calls: string[] = [];
    await expect(applyVerifiedFirstLinkPlan("expected", async () => { calls.push("hosted"); return { fingerprint: "invalid" }; }, async () => { calls.push("local"); }))
      .rejects.toThrow("fingerprint is invalid");
    expect(calls).toEqual(["hosted"]);
  });

});
