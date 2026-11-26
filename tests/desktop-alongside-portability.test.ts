import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { resolveBehaviorLogImportMergePreview, resolveBehaviorLogImportPreview } from "@cadence/core/resolvers/behaviorlog-import.resolver";
import { resolveBehaviorLogRestorePreview } from "@cadence/core/resolvers/behaviorlog-restore.resolver";
import { assembleExportBundle, type ExportAssemblyInput } from "@cadence/core/services/export-assembly";
import { planBehaviorLogImportWrite } from "@cadence/core/services/behaviorlog-import-plan";
import { existingRecords, planBehaviorLogRestoreWrite } from "@cadence/core/services/behaviorlog-write-plan";
import type { PortabilitySnapshot } from "@cadence/core/types/portability-rows";
import { USER_ID, storedBehavior, storedConfigurationEvent } from "./helpers/export-row-fixture";
import { emptyPortabilitySnapshot, fixtureIds, portabilityApplyRun, PORTABILITY_NOW } from "./helpers/portability-fixture";

// Ticket 363 (D33): the Mac's BehaviorLog import and restore write the stored alongside
// answer only with its alongside switch on (includeAlongside), as the web does with the flag.
const HELMET = "a3630000-0000-4000-8000-000000000001";
const PILL = "a3630000-0000-4000-8000-000000000002";

function exportInput(): ExportAssemblyInput {
  const behavior = (id: string, title: string, alongside: boolean | null) => ({
    ...storedBehavior(), id, title, description: null, current_configuration_event_id: `configuration-${id}`, alongside,
  });
  const configuration = (id: string) => ({ ...storedConfigurationEvent(), id: `configuration-${id}`, behavior_id: id });
  return {
    userId: USER_ID, timezone: "America/New_York", now: Temporal.Instant.from(PORTABILITY_NOW), range: "all",
    categories: [], behaviors: [behavior(HELMET, "Red light helmet", true), behavior(PILL, "Pill", null)],
    behaviorDefinitionEvents: [], behaviorConfigurationEvents: [configuration(HELMET), configuration(PILL)],
    occurrences: [], statusEvents: [], reminderDeliveries: [], timeSessions: [], includeAlongside: true,
  } as unknown as ExportAssemblyInput;
}

const context = (snapshot: PortabilitySnapshot = emptyPortabilitySnapshot()) =>
  ({ snapshot, applyRun: portabilityApplyRun(), newId: fixtureIds(), now: PORTABILITY_NOW });

function imported(includeAlongside: boolean) {
  const files = assembleExportBundle(exportInput()).behaviorLog.files;
  const preview = resolveBehaviorLogImportMergePreview({ files, ...(includeAlongside ? { readAlongside: true } : {}) });
  expect(preview.errors).toEqual([]);
  const input = context();
  const plan = planBehaviorLogImportWrite({ ...input, preview, mode: "create_missing_only", interventionRulesPresent: true,
    ...(includeAlongside ? { includeAlongside: true } : {}) });
  const snapshot: PortabilitySnapshot = { ...input.snapshot, graphs: plan.graphWrites.map(({ graph }) => ({ ...graph, revision: 1 })),
    configurationEvents: plan.graphWrites.flatMap((write) => write.configurationEvents), mappings: plan.mappings,
    importRuns: [{ ...plan.applyRun, status: "applied" }] };
  return { plan, snapshot };
}

describe("Mac BehaviorLog import of the alongside answer", () => {
  it("creates Behaviors with the bundle's answer and records it in the configuration baseline", () => {
    const { plan } = imported(true);
    const graphs = new Map(plan.graphWrites.map((write) => [write.graph.behavior.title, write]));
    expect(graphs.get("Red light helmet")!.graph.behavior.alongside).toBe(true);
    expect(graphs.get("Pill")!.graph.behavior.alongside).toBeNull();
    expect(graphs.get("Red light helmet")!.configurationEvents[0]!.next_configuration).toMatchObject({ alongside: true });
  });

  it("writes no answer with the switch off", () => {
    const { plan } = imported(false);
    expect(plan.graphWrites.every(({ graph }) => !("alongside" in graph.behavior))).toBe(true);
  });
});

describe("Mac BehaviorLog restore of the alongside answer", () => {
  it("restores the bundle's answer over a changed local one with the switch on, and keeps it with the switch off", () => {
    const { snapshot } = imported(true);
    const changed: PortabilitySnapshot = { ...snapshot, graphs: snapshot.graphs.map((graph) =>
      graph.behavior.title === "Red light helmet" ? { ...graph, behavior: { ...graph.behavior, alongside: false } } : graph) };
    const helmetId = changed.graphs.find(({ behavior }) => behavior.title === "Red light helmet")!.behavior.id;
    const exported = assembleExportBundle({ ...exportInput(),
      behaviors: snapshot.graphs.map(({ behavior }) => ({ ...behavior, category: null, schedules: [], schedule_slots: [] })),
      behaviorConfigurationEvents: snapshot.configurationEvents } as unknown as ExportAssemblyInput).behaviorLog.files;

    const importPreview = resolveBehaviorLogImportPreview({ files: exported, readAlongside: true });
    const preview = resolveBehaviorLogRestorePreview({ importPreview, existing: existingRecords(changed, { includeAlongside: true }) });
    expect(preview.errors).toEqual([]);
    const plan = planBehaviorLogRestoreWrite({ ...context(changed), importPreview, preview, includeAlongside: true });
    expect(plan.graphWrites.find(({ graph }) => graph.behavior.id === helmetId)?.graph.behavior.alongside).toBe(true);

    const offImport = resolveBehaviorLogImportPreview({ files: exported });
    const offPreview = resolveBehaviorLogRestorePreview({ importPreview: offImport, existing: existingRecords(changed) });
    const offPlan = planBehaviorLogRestoreWrite({ ...context(changed), importPreview: offImport, preview: offPreview });
    const helmet = offPlan.graphWrites.find(({ graph }) => graph.behavior.id === helmetId)?.graph.behavior;
    expect(helmet === undefined || helmet.alongside === false).toBe(true);
  });
});
