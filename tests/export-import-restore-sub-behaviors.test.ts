import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { resolveBehaviorLogImportMergePreview, resolveBehaviorLogImportPreview } from "@cadence/core/resolvers/behaviorlog-import.resolver";
import { resolveBehaviorLogRestorePreview } from "@cadence/core/resolvers/behaviorlog-restore.resolver";
import { assembleExportBundle, type ExportAssemblyInput } from "@cadence/core/services/export-assembly";
import { planBehaviorLogImportWrite } from "@cadence/core/services/behaviorlog-import-plan";
import { existingRecords, planBehaviorLogRestoreWrite } from "@cadence/core/services/behaviorlog-write-plan";
import { buildRestorePayload } from "@cadence/core/services/behaviorlog-restore-plan";
import type { PortabilitySnapshot } from "@cadence/core/types/portability-rows";
import { sha256 } from "@cadence/core/hash";
import { USER_ID, storedBehavior, storedConfigurationEvent, storedExportOccurrence } from "./helpers/export-row-fixture";
import { emptyPortabilitySnapshot, fixtureIds, portabilityApplyRun, PORTABILITY_NOW } from "./helpers/portability-fixture";

const PARENT = "a0000000-0000-4000-8000-000000000001";
const CERAVE = "a0000000-0000-4000-8000-000000000002";
const RETINOL = "a0000000-0000-4000-8000-000000000003";
const SOLO = "a0000000-0000-4000-8000-000000000004";

type Link = { parent: string | null; order?: number; inherit?: boolean };

function behavior(id: string, title: string, link: Link | null) {
  return {
    ...storedBehavior(), id, title, description: null, current_configuration_event_id: `configuration-${id}`,
    ...(link ? {
      parent_behavior_id: link.parent,
      sub_behavior_sort_order: link.order ?? 0,
      inherit_parent_schedule: link.inherit ?? false,
    } : {}),
  };
}

function configuration(id: string, link: Link | null) {
  const event = storedConfigurationEvent();
  return {
    ...event, id: `configuration-${id}`, behavior_id: id,
    next_configuration: {
      ...event.next_configuration,
      ...(link ? { parent_behavior_id: link.parent, inherit_parent_schedule: link.inherit ?? false } : {}),
    },
  };
}

function occurrence(id: string, behaviorId: string, status: "completed" | "not_completed" | "unresolved") {
  return {
    ...storedExportOccurrence(), id, behavior_id: behaviorId, behavior_configuration_event_id: `configuration-${behaviorId}`, status,
    ...(status === "unresolved" ? {} : { status_marked_at: "2026-05-02T01:00:00Z" }),
    ...(status === "completed" ? { completed_at: "2026-05-02T01:00:00Z" } : {}),
  };
}

const LINKS: Record<string, Link> = {
  [PARENT]: { parent: null },
  [CERAVE]: { parent: PARENT, order: 0, inherit: true },
  [RETINOL]: { parent: PARENT, order: 1, inherit: false },
  [SOLO]: { parent: null },
};
const TITLES: Record<string, string> = { [PARENT]: "Skin routine", [CERAVE]: "Cerave", [RETINOL]: "Retinol", [SOLO]: "Brush teeth" };

function exportInput(links: Record<string, Link> | null = LINKS): ExportAssemblyInput {
  // Sub-behaviors first, so the import must order parents itself.
  const ids = [RETINOL, CERAVE, PARENT, SOLO];
  return {
    userId: USER_ID, timezone: "America/New_York", now: Temporal.Instant.from(PORTABILITY_NOW), range: "all",
    categories: [],
    behaviors: ids.map((id) => behavior(id, TITLES[id], links?.[id] ?? null)),
    behaviorDefinitionEvents: [],
    behaviorConfigurationEvents: ids.map((id) => configuration(id, links?.[id] ?? null)),
    occurrences: [
      // A parent's own row on a day its sub-behaviors cover is not counted twice.
      occurrence("b0000000-0000-4000-8000-000000000001", PARENT, "completed"),
      occurrence("b0000000-0000-4000-8000-000000000002", CERAVE, "completed"),
      occurrence("b0000000-0000-4000-8000-000000000003", RETINOL, "not_completed"),
      occurrence("b0000000-0000-4000-8000-000000000004", SOLO, "completed"),
    ],
    statusEvents: [], reminderDeliveries: [], timeSessions: [],
  } as unknown as ExportAssemblyInput;
}

function jsonl(files: { path: string; content: string }[], path: string): Record<string, unknown>[] {
  const text = files.find((file) => file.path === path)?.content.trim();
  return text ? text.split("\n").map((line) => JSON.parse(line)) : [];
}

type Row = Record<string, unknown>;

function rewriteBehaviors(files: { path: string; content: string }[], edit: (row: Row) => Row) {
  const copy = files.map((file) => ({ ...file }));
  const behaviors = copy.find((file) => file.path === "data/behaviors.jsonl")!;
  behaviors.content = behaviors.content.trim().split("\n").map((line) => JSON.stringify(edit(JSON.parse(line)))).join("\n") + "\n";
  const manifestFile = copy.find((file) => file.path === "manifest.json")!;
  const manifest = JSON.parse(manifestFile.content);
  manifest.files.find((file: { path: string }) => file.path === behaviors.path).sha256 = sha256(behaviors.content);
  manifestFile.content = JSON.stringify(manifest);
  return copy;
}

function cadence(row: Row): Row {
  return (row.extensions as Record<string, Row>)["app.cadence"];
}

/** A bundle written before sub-behaviors: no link fields at all. */
function withoutLink(row: Row): Row {
  const extension = { ...cadence(row) };
  delete extension.parent_behavior_id;
  delete extension.sub_behavior_sort_order;
  delete extension.inherit_parent_schedule;
  return { ...row, extensions: { ...(row.extensions as Row), "app.cadence": extension } };
}

function context(snapshot: PortabilitySnapshot = emptyPortabilitySnapshot()) {
  return { snapshot, applyRun: portabilityApplyRun(), newId: fixtureIds(), now: PORTABILITY_NOW };
}

function importedSnapshot(files: { path: string; content: string }[]) {
  const input = context();
  const preview = resolveBehaviorLogImportMergePreview({ files });
  expect(preview.errors).toEqual([]);
  const plan = planBehaviorLogImportWrite({ ...input, preview, mode: "create_missing_only", interventionRulesPresent: true });
  const snapshot: PortabilitySnapshot = {
    ...input.snapshot,
    graphs: plan.graphWrites.map(({ graph }) => ({ ...graph, revision: 1 })),
    configurationEvents: plan.graphWrites.flatMap((write) => write.configurationEvents),
    occurrences: plan.occurrenceWrites.map(({ next }) => next),
    mappings: plan.mappings,
    importRuns: [{ ...plan.applyRun, status: "applied" }],
  };
  return { plan, snapshot };
}

function byTitle(snapshot: PortabilitySnapshot) {
  return new Map(snapshot.graphs.map(({ behavior }) => [behavior.title, behavior]));
}

describe("sub-behavior export", () => {
  it("emits the link in Full JSON, BehaviorLog and configuration history, and groups routines in Markdown", () => {
    const bundle = assembleExportBundle(exportInput());
    const json = new Map(bundle.jsonBackup.behaviors.map((row) => [row.id, row]));
    expect(json.get(CERAVE)).toMatchObject({ parent_behavior_id: PARENT, sub_behavior_sort_order: 0, inherit_parent_schedule: true });
    expect(json.get(RETINOL)).toMatchObject({ parent_behavior_id: PARENT, sub_behavior_sort_order: 1, inherit_parent_schedule: false });
    expect(json.get(PARENT)).toMatchObject({ parent_behavior_id: null, sub_behavior_sort_order: 0, inherit_parent_schedule: false });
    expect(bundle.jsonBackup.behavior_configuration_events.find((event) => event.behavior_id === CERAVE)?.next_configuration)
      .toMatchObject({ parent_behavior_id: PARENT, inherit_parent_schedule: true });

    const behaviorLog = new Map(jsonl(bundle.behaviorLog.files, "data/behaviors.jsonl").map((row) => [row.behavior_id, row]));
    expect(cadence(behaviorLog.get(RETINOL)!)).toMatchObject({ parent_behavior_id: PARENT, sub_behavior_sort_order: 1, inherit_parent_schedule: false });
    expect(cadence(behaviorLog.get(SOLO)!)).toMatchObject({ parent_behavior_id: null });
    const configurationEvent = jsonl(bundle.behaviorLog.files, "data/behavior_configuration_events.jsonl")
      .find((row) => row.behavior_id === CERAVE) as { next: { extensions: Record<string, Row> } };
    expect(configurationEvent.next.extensions["app.cadence"]).toMatchObject({ parent_behavior_id: PARENT, inherit_parent_schedule: true });

    // Leaf counting: Cerave completed, Retinol not completed, Brush teeth completed. The
    // parent's own row on the routine's day is left out.
    expect(bundle.overallCounts).toMatchObject({ completedCount: 2, notCompletedCount: 1, unresolvedCount: 0 });
    const summary = bundle.markdownSummary;
    expect(summary).toContain("- Skin routine (routine, 2 sub-behaviors): 1 completed, 1 not completed, 0 unresolved");
    expect(summary.indexOf("  - Cerave:")).toBeGreaterThan(summary.indexOf("- Skin routine"));
    expect(summary.indexOf("  - Retinol:")).toBeGreaterThan(summary.indexOf("  - Cerave:"));
    expect(summary).toContain("- Brush teeth: 1 completed, 0 not completed, 0 unresolved");
    expect(summary).toContain("A routine's totals count each sub-behavior Occurrence once.");
  });

  it("keeps JSONL and CSV snapshots and a legacy export unchanged", () => {
    const linked = assembleExportBundle(exportInput());
    const legacy = assembleExportBundle(exportInput(null));
    expect(Object.keys(JSON.parse(linked.jsonl.split("\n").find((line) => line.includes("\"behavior\""))!))).toEqual(
      Object.keys(JSON.parse(legacy.jsonl.split("\n").find((line) => line.includes("\"behavior\""))!)));
    expect(linked.csv.split("\n")[0]).toBe(legacy.csv.split("\n")[0]);
    // Rows read without the columns (older hosted rows) export as standalone.
    expect(legacy.jsonBackup.behaviors.every((row) => row.parent_behavior_id === null && row.inherit_parent_schedule === false)).toBe(true);
    expect(legacy.markdownSummary).not.toContain("(routine");
  });
});

describe("sub-behavior import", () => {
  it("round-trips the hierarchy, mapping bundle parent IDs to new local IDs", () => {
    const files = assembleExportBundle(exportInput()).behaviorLog.files;
    const preview = resolveBehaviorLogImportPreview({ files });
    expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
    const order = preview.plan.behaviors.map((row) => row.externalId);
    expect(order.indexOf(PARENT)).toBeLessThan(order.indexOf(CERAVE));
    expect(order.indexOf(PARENT)).toBeLessThan(order.indexOf(RETINOL));

    const { snapshot } = importedSnapshot(files);
    const rows = byTitle(snapshot);
    const parent = rows.get("Skin routine")!;
    expect(parent.id).not.toBe(PARENT);
    expect(parent).toMatchObject({ parent_behavior_id: null, sub_behavior_sort_order: 0, inherit_parent_schedule: false });
    expect(rows.get("Cerave")).toMatchObject({ parent_behavior_id: parent.id, sub_behavior_sort_order: 0, inherit_parent_schedule: true });
    expect(rows.get("Retinol")).toMatchObject({ parent_behavior_id: parent.id, sub_behavior_sort_order: 1, inherit_parent_schedule: false });
    expect(rows.get("Brush teeth")).toMatchObject({ parent_behavior_id: null });

    // Export again from the imported account: the same hierarchy, with local IDs.
    const again = assembleExportBundle({
      ...exportInput(), behaviors: snapshot.graphs.map(({ behavior }) => ({ ...behavior, category: null, schedules: [], schedule_slots: [] })),
      behaviorConfigurationEvents: snapshot.configurationEvents, occurrences: [],
    } as unknown as ExportAssemblyInput);
    const exported = new Map(again.jsonBackup.behaviors.map((row) => [row.title, row]));
    expect(exported.get("Retinol")).toMatchObject({ parent_behavior_id: parent.id, sub_behavior_sort_order: 1, inherit_parent_schedule: false });
  });

  it("imports a legacy bundle without link fields as standalone Behaviors", () => {
    const files = rewriteBehaviors(assembleExportBundle(exportInput()).behaviorLog.files, withoutLink);
    const preview = resolveBehaviorLogImportPreview({ files });
    expect(preview.valid).toBe(true);
    expect(preview.plan.behaviors.every((row) => row.cadenceParentBehaviorExternalId === undefined)).toBe(true);
    const { snapshot } = importedSnapshot(files);
    expect(snapshot.graphs.map(({ behavior }) => [behavior.parent_behavior_id, behavior.sub_behavior_sort_order, behavior.inherit_parent_schedule]))
      .toEqual(snapshot.graphs.map(() => [null, 0, false]));
  });

  it("rejects grandchildren, cycles and self links, and imports an orphan on its own", () => {
    const linked = assembleExportBundle(exportInput()).behaviorLog.files;
    const withParent = (edits: Record<string, string | null>) => rewriteBehaviors(linked, (row) =>
      String(row.behavior_id) in edits
        ? { ...row, extensions: { ...(row.extensions as Row), "app.cadence": { ...cadence(row), parent_behavior_id: edits[String(row.behavior_id)] } } }
        : row);
    const codes = (files: { path: string; content: string }[]) => resolveBehaviorLogImportPreview({ files }).errors.map((issue) => issue.code);

    expect(codes(withParent({ [SOLO]: CERAVE }))).toContain("cadence_sub_behavior_depth");
    expect(codes(withParent({ [PARENT]: SOLO, [SOLO]: PARENT }))).toContain("cadence_sub_behavior_depth");
    expect(codes(withParent({ [SOLO]: SOLO }))).toContain("cadence_sub_behavior_self_parent");

    const orphan = resolveBehaviorLogImportPreview({ files: withParent({ [SOLO]: "not-in-bundle" }) });
    expect(orphan.valid).toBe(true);
    expect(orphan.warnings.map((issue) => issue.code)).toContain("cadence_sub_behavior_parent_missing");
    expect(orphan.plan.behaviors.find((row) => row.externalId === SOLO)).toMatchObject({
      cadenceParentBehaviorExternalId: null, cadenceSubBehaviorSortOrder: 0, cadenceInheritParentSchedule: false,
    });
  });
});

describe("sub-behavior restore", () => {
  it("restores the hierarchy with the restored parent IDs", () => {
    const files = assembleExportBundle(exportInput()).behaviorLog.files;
    const importPreview = resolveBehaviorLogImportPreview({ files });
    const preview = resolveBehaviorLogRestorePreview({ importPreview, existing: existingRecords(emptyPortabilitySnapshot()) });
    expect(preview.errors).toEqual([]);
    const { payload } = buildRestorePayload({ userId: USER_ID, importRunId: portabilityApplyRun().id, now: PORTABILITY_NOW,
      importPreview, preview, existing: existingRecords(emptyPortabilitySnapshot()) });
    const restored = new Map((payload.behaviors as Row[]).map((row) => [row.title, row]));
    expect(restored.get("Cerave")).toMatchObject({ parent_behavior_id: restored.get("Skin routine")!.id, sub_behavior_sort_order: 0, inherit_parent_schedule: true });
    expect(restored.get("Retinol")).toMatchObject({ parent_behavior_id: restored.get("Skin routine")!.id, inherit_parent_schedule: false });

    const plan = planBehaviorLogRestoreWrite({ ...context(), preview, importPreview });
    const graphs = new Map(plan.graphWrites.map(({ graph }) => [graph.behavior.title, graph.behavior]));
    expect(graphs.get("Retinol")).toMatchObject({ parent_behavior_id: graphs.get("Skin routine")!.id, sub_behavior_sort_order: 1 });
  });

  it("replaces a Behavior whose link changed, and keeps the local link for a legacy bundle", () => {
    const { snapshot } = importedSnapshot(assembleExportBundle(exportInput()).behaviorLog.files);
    const local = byTitle(snapshot);
    const restoreFrom = (links: Record<string, Link> | null) => {
      const ids = new Map([[PARENT, local.get("Skin routine")!.id], [CERAVE, local.get("Cerave")!.id], [RETINOL, local.get("Retinol")!.id], [SOLO, local.get("Brush teeth")!.id]]);
      const remapped = Object.fromEntries(Object.entries(links ?? LINKS).map(([id, link]) =>
        [ids.get(id)!, { ...link, parent: link.parent ? ids.get(link.parent)! : null }]));
      const exported = assembleExportBundle({
        ...exportInput(),
        behaviors: snapshot.graphs.map(({ behavior }) => ({ ...behavior,
          parent_behavior_id: remapped[behavior.id].parent, sub_behavior_sort_order: remapped[behavior.id].order ?? 0,
          inherit_parent_schedule: remapped[behavior.id].inherit ?? false,
          category: null, schedules: [], schedule_slots: [] })),
        behaviorConfigurationEvents: snapshot.configurationEvents, occurrences: [],
      } as unknown as ExportAssemblyInput).behaviorLog.files;
      // A legacy bundle carries no link fields at all.
      const files = links ? exported : rewriteBehaviors(exported, withoutLink);
      const importPreview = resolveBehaviorLogImportPreview({ files });
      return { importPreview, preview: resolveBehaviorLogRestorePreview({ importPreview, existing: existingRecords(snapshot) }) };
    };
    const action = (preview: ReturnType<typeof restoreFrom>["preview"], id: string) =>
      preview.actions.behaviors.find((entry) => entry.localId === id)?.action;

    const detached = restoreFrom({ ...LINKS, [RETINOL]: { parent: null } });
    expect(detached.preview.errors).toEqual([]);
    expect(action(detached.preview, local.get("Retinol")!.id)).toBe("replace");
    expect(action(detached.preview, local.get("Cerave")!.id)).toBe("keep");

    const grandchild = restoreFrom({ ...LINKS, [SOLO]: { parent: CERAVE } });
    expect(grandchild.importPreview.errors.map((issue) => issue.code)).toContain("cadence_sub_behavior_depth");
    expect(grandchild.preview.valid).toBe(false);

    // The bundle turns the parent into a sub-behavior while its local children stay.
    const parentUnderSolo = restoreFrom({ [PARENT]: { parent: SOLO, inherit: true }, [CERAVE]: { parent: null }, [RETINOL]: { parent: null }, [SOLO]: { parent: null } });
    expect(parentUnderSolo.preview.errors).toEqual([]);
    const localChildren = {
      ...snapshot,
      graphs: snapshot.graphs.filter(({ behavior }) => behavior.title !== "Cerave" && behavior.title !== "Retinol")
        .concat(snapshot.graphs.filter(({ behavior }) => behavior.title === "Cerave").map((graph) => ({ ...graph, behavior: { ...graph.behavior, id: "c0000000-0000-4000-8000-000000000009" } }))),
    };
    const conflicting = resolveBehaviorLogRestorePreview({ importPreview: parentUnderSolo.importPreview, existing: existingRecords(localChildren) });
    expect(conflicting.errors.map((issue) => issue.code)).toContain("restore_sub_behavior_parent_is_sub_behavior");
    expect(conflicting.valid).toBe(false);

    const legacy = restoreFrom(null);
    expect(legacy.importPreview.plan.behaviors.every((row) => row.cadenceParentBehaviorExternalId === undefined)).toBe(true);
    expect(action(legacy.preview, local.get("Retinol")!.id)).not.toBe("create");
    const { payload } = buildRestorePayload({ userId: USER_ID, importRunId: portabilityApplyRun().id, now: PORTABILITY_NOW,
      importPreview: legacy.importPreview, preview: legacy.preview, existing: existingRecords(snapshot) });
    expect((payload.behaviors as Record<string, unknown>[]).every((row) => !("parent_behavior_id" in row))).toBe(true);
  });
});
