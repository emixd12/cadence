import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { resolveBehaviorLogImportMergePreview, resolveBehaviorLogImportPreview } from "@cadence/core/resolvers/behaviorlog-import.resolver";
import { resolveBehaviorLogRestorePreview } from "@cadence/core/resolvers/behaviorlog-restore.resolver";
import { assembleExportBundle, type ExportAssemblyInput } from "@cadence/core/services/export-assembly";
import { buildRestorePayload } from "@cadence/core/services/behaviorlog-restore-plan";
import { assembleBehaviorLogExistingRecords } from "@cadence/core/services/behaviorlog-existing";
import { sha256 } from "@cadence/core/hash";
import type { BehaviorLogExistingRecords } from "@cadence/core/types/behaviorlog-import";
import { USER_ID, storedBehavior, storedConfigurationEvent, storedExportOccurrence } from "./helpers/export-row-fixture";
import { portabilityApplyRun, PORTABILITY_NOW } from "./helpers/portability-fixture";

/**
 * Ticket 364 (D33): Full JSON, JSONL, CSV and BehaviorLog carry the person's alongside
 * answer; import and restore read it. Off, the export bytes are what they were.
 */

// sha256 of this export (Full JSON, JSONL, CSV, BehaviorLog files) before Ticket 364.
const PRE_364_EXPORT_SHA256 = "cd039fd59aa7e11827eb0bb8ff000686fac3cc703d6e3f7c081187462fcc30cf";

type Row = Record<string, unknown>;
type Files = { path: string; content: string }[];

function input(alongside: boolean | null | undefined, extra: Partial<ExportAssemblyInput> = {}): ExportAssemblyInput {
  const behavior = { ...storedBehavior(), ...(alongside === undefined ? {} : { alongside }) };
  return {
    userId: USER_ID, timezone: "America/New_York", now: Temporal.Instant.from(PORTABILITY_NOW), range: "all",
    includeNotes: true, includeTimeTracking: true,
    categories: [], behaviors: [behavior], behaviorDefinitionEvents: [], behaviorConfigurationEvents: [storedConfigurationEvent()],
    occurrences: [storedExportOccurrence()], statusEvents: [], reminderDeliveries: [], timeSessions: [], ...extra,
  } as unknown as ExportAssemblyInput;
}

function bytes(bundle: ReturnType<typeof assembleExportBundle>): string {
  return JSON.stringify([bundle.json, bundle.jsonl, bundle.csv, bundle.behaviorLog.files.map((file) => [file.path, file.content])]);
}

function jsonl(files: Files, file: string): Row[] {
  const text = files.find((entry) => entry.path === file)?.content.trim();
  return text ? text.split("\n").map((line) => JSON.parse(line) as Row) : [];
}

const cadence = (row: Row) => (row.extensions as Record<string, Row>)["app.cadence"]!;
/** A bundle written before Ticket 364: no alongside key. */
const withoutKey = (extension: Row): Row => Object.fromEntries(Object.entries(extension).filter(([key]) => key !== "alongside"));

/** Rewrites the Cadence extension of every Behavior and fixes the manifest digest. */
function rewriteAlongside(files: Files, edit: (extension: Row) => Row): Files {
  const copy = files.map((file) => ({ ...file }));
  const behaviors = copy.find((file) => file.path === "data/behaviors.jsonl")!;
  behaviors.content = behaviors.content.trim().split("\n").map((line) => {
    const row = JSON.parse(line) as Row;
    return JSON.stringify({ ...row, extensions: { ...(row.extensions as Row), "app.cadence": edit({ ...cadence(row) }) } });
  }).join("\n") + "\n";
  const manifestFile = copy.find((file) => file.path === "manifest.json")!;
  const manifest = JSON.parse(manifestFile.content) as { files: { path: string; sha256: string }[] };
  manifest.files.find((file) => file.path === behaviors.path)!.sha256 = sha256(behaviors.content);
  manifestFile.content = JSON.stringify(manifest);
  return copy;
}

function existing(alongside: boolean | null | undefined, includeAlongside: boolean): BehaviorLogExistingRecords {
  return assembleBehaviorLogExistingRecords({
    behaviors: [{ ...storedBehavior(), ...(alongside === undefined ? {} : { alongside }), category: null } as never],
    occurrences: [], statusEvents: [], definitionEvents: [], timeSessions: [], mappings: [], importedNotes: [],
    importedInterventions: [], configurationEvents: [storedConfigurationEvent() as never], includeAlongside,
  });
}

describe("alongside export (Ticket 364)", () => {
  it("writes the same bytes as before Ticket 364 when alongside is not included", () => {
    expect(createHash("sha256").update(bytes(assembleExportBundle(input(true)))).digest("hex")).toBe(PRE_364_EXPORT_SHA256);
    expect(bytes(assembleExportBundle(input(true, { includeAlongside: false })))).toBe(bytes(assembleExportBundle(input(true))));
    expect(bytes(assembleExportBundle(input(true)))).not.toContain("alongside");
  });

  it("carries the answer in Full JSON, JSONL, CSV and the BehaviorLog extension", () => {
    const bundle = assembleExportBundle(input(true, { includeAlongside: true }));
    const behavior = bundle.jsonBackup.behaviors[0]!;
    expect(behavior.alongside).toBe(true);
    // Beside the other Behavior settings, right before the schedules.
    expect(Object.keys(behavior).indexOf("alongside")).toBe(Object.keys(behavior).indexOf("schedules") - 1);
    const line = JSON.parse(bundle.jsonl.split("\n").find((entry) => entry.includes("\"type\":\"behavior\""))!) as Row;
    expect(line.alongside).toBe(true);
    const [header, row] = bundle.csv.split("\n");
    expect(header!.split(",").at(-1)).toBe("alongside");
    expect(header!.split(",").slice(0, -1)).toEqual(assembleExportBundle(input(true)).csv.split("\n")[0]!.split(","));
    expect(row!.split(",").at(-1)).toBe("true");
    expect(cadence(jsonl(bundle.behaviorLog.files, "data/behaviors.jsonl")[0]!).alongside).toBe(true);
    // Configuration history does not carry it until Ticket 363.
    expect(JSON.stringify(bundle.jsonBackup.behavior_configuration_events)).not.toContain("alongside");
  });

  it("exports an unanswered Behavior as null, and an empty CSV cell", () => {
    for (const setting of [null, undefined]) {
      const bundle = assembleExportBundle(input(setting, { includeAlongside: true, includeTimeTracking: false }));
      expect(bundle.jsonBackup.behaviors[0]!.alongside).toBeNull();
      expect(cadence(jsonl(bundle.behaviorLog.files, "data/behaviors.jsonl")[0]!)).toHaveProperty("alongside", null);
      const [header, row] = bundle.csv.split("\n");
      expect(header).toBe("local_date,scheduled_for,schedule,behavior_title,category,status,status_marked_at,note,alongside");
      expect(row!.endsWith(",")).toBe(true);
    }
  });

  it("never exports the model's guess", () => {
    const text = bytes(assembleExportBundle(input(null, { includeAlongside: true })));
    expect(text).not.toMatch(/guess|advisor_estimate|alongside_source/);
  });

  it("stays a valid BehaviorLog bundle for the vendored reference validator", async () => {
    const files = assembleExportBundle(input(false, { includeAlongside: true })).behaviorLog.files;
    const root = await mkdtemp(path.join(tmpdir(), "cadence-alongside-"));
    const bundlePath = path.join(root, "cadence.behaviorlog");
    try {
      for (const file of files) {
        await mkdir(path.dirname(path.join(bundlePath, file.path)), { recursive: true });
        await writeFile(path.join(bundlePath, file.path), file.content, "utf8");
      }
      const result = spawnSync(process.execPath, ["scripts/behaviorlog-conformance.mjs", bundlePath], { cwd: process.cwd(), encoding: "utf8" });
      expect(result.status, result.stderr || result.stdout).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("alongside import (Ticket 364)", () => {
  const files = (setting: boolean | null) => assembleExportBundle(input(setting, { includeAlongside: true })).behaviorLog.files;

  it("reads true, false and null when asked to, and ignores the key otherwise", () => {
    for (const setting of [true, false, null]) {
      const preview = resolveBehaviorLogImportPreview({ files: files(setting), readAlongside: true });
      expect(preview.valid, JSON.stringify(preview.errors)).toBe(true);
      expect(preview.plan.behaviors[0]).toHaveProperty("cadenceAlongside", setting);
      const merge = resolveBehaviorLogImportMergePreview({ files: files(setting), readAlongside: true });
      expect(merge.plan.behaviors[0]).toHaveProperty("cadenceAlongside", setting);
    }
    const off = resolveBehaviorLogImportPreview({ files: files(true) });
    expect(off.plan.behaviors[0]).not.toHaveProperty("cadenceAlongside");
    expect(off.valid).toBe(true);
  });

  it("leaves a bundle without the key unanswered", () => {
    const legacy = rewriteAlongside(files(true), withoutKey);
    const preview = resolveBehaviorLogImportPreview({ files: legacy, readAlongside: true });
    expect(preview.valid).toBe(true);
    expect(preview.plan.behaviors[0]).not.toHaveProperty("cadenceAlongside");
  });

  it("rejects any value other than true, false or null", () => {
    const invalid = rewriteAlongside(files(true), (extension) => ({ ...extension, alongside: "yes" }));
    expect(resolveBehaviorLogImportPreview({ files: invalid, readAlongside: true }).errors.map((issue) => issue.code))
      .toContain("cadence_alongside_invalid");
    expect(resolveBehaviorLogImportPreview({ files: invalid }).valid).toBe(true);
  });
});

describe("alongside restore (Ticket 364)", () => {
  const restore = (bundleSetting: boolean | null | "absent", local: boolean | null, read = true) => {
    const exported = assembleExportBundle(input(bundleSetting === "absent" ? true : bundleSetting, { includeAlongside: true })).behaviorLog.files;
    const files = bundleSetting === "absent" ? rewriteAlongside(exported, withoutKey) : exported;
    const importPreview = resolveBehaviorLogImportPreview({ files, ...(read ? { readAlongside: true } : {}) });
    const records = existing(local, read);
    const preview = resolveBehaviorLogRestorePreview({ importPreview, existing: records });
    const { payload } = buildRestorePayload({ userId: USER_ID, importRunId: portabilityApplyRun().id, now: PORTABILITY_NOW,
      importPreview, preview, existing: records });
    return { action: preview.actions.behaviors[0]?.action, payload: payload.behaviors as Row[] };
  };

  it("replaces a Behavior whose answer differs and writes the bundle's answer", () => {
    const changed = restore(true, false);
    expect(changed.action).toBe("replace");
    expect(changed.payload[0]).toHaveProperty("alongside", true);
    expect(restore(null, true).payload[0]).toHaveProperty("alongside", null);
  });

  it("keeps a Behavior whose answer matches", () => {
    expect(restore(false, false).action).toBe("keep");
  });

  it("keeps the stored answer for a bundle without the key, and when alongside is not read", () => {
    const legacy = restore("absent", true);
    expect(legacy.action).toBe("keep");
    const off = restore(true, false, false);
    expect(off.action).toBe("keep");
    for (const row of [...legacy.payload, ...off.payload]) expect(row).not.toHaveProperty("alongside");
  });
});
