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
import { alongsideHistoryRows } from "./helpers/alongside-history-fixture";

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

// sha256 of the unanswered history fixture's export (Full JSON, JSONL, CSV, BehaviorLog
// files), computed with origin/main's packages/core before Ticket 363's history change.
const PRE_363_HISTORY_EXPORT_SHA256 = "7c9dc6fccb66a1a8b1b9991ceeb88c89034baf6ac1b0bf1e6429997e0b739913";

function historyInput(answered: boolean, includeAlongside: boolean): ExportAssemblyInput {
  const rows = alongsideHistoryRows(answered);
  return input(undefined, {
    behaviors: [rows.behavior], behaviorConfigurationEvents: rows.configurationEvents, occurrences: rows.occurrences,
    ...(includeAlongside ? { includeAlongside: true } : {}),
  } as Partial<ExportAssemblyInput>);
}

type HistoryEvent = { id: string; changed_fields: string[]; previous_configuration: Row | null; next_configuration: Row };

describe("alongside configuration history in exports (Ticket 363, defect D1)", () => {
  it("exports an unanswered account's history with the bytes it had before Ticket 363", () => {
    const off = bytes(assembleExportBundle(historyInput(false, false)));
    expect(createHash("sha256").update(off).digest("hex")).toBe(PRE_363_HISTORY_EXPORT_SHA256);
    expect(off).not.toContain("alongside");
  });

  it("with alongside off, names the answer nowhere and leaves out the answer-only revision", () => {
    const bundle = assembleExportBundle(historyInput(true, false));
    // Byte for byte the export of the same account had it never answered.
    expect(bytes(bundle)).toBe(bytes(assembleExportBundle(historyInput(false, false))));
    expect(bytes(bundle)).not.toContain("alongside");
    const events = bundle.jsonBackup.behavior_configuration_events as HistoryEvent[];
    expect(events.map((event) => event.id)).toEqual(["configuration-1", "configuration-2"]);
    // The answer-only revision's Occurrence belongs to the revision before it, and the chain holds.
    expect(bundle.jsonBackup.occurrences.map((row) => row.behavior_configuration_event_id))
      .toEqual(["configuration-1", "configuration-1", "configuration-2"]);
    expect(events[1]!.previous_configuration).toEqual(events[0]!.next_configuration);
  });

  it("with alongside on, carries the answer in every snapshot of an event that names it", () => {
    const bundle = assembleExportBundle(historyInput(true, true));
    const events = bundle.jsonBackup.behavior_configuration_events as HistoryEvent[];
    expect(events.map((event) => [event.id, event.changed_fields])).toEqual([
      ["configuration-1", expect.not.arrayContaining(["alongside"])],
      ["configuration-a", ["alongside"]],
      ["configuration-2", ["reminder_offset_minutes"]],
    ]);
    expect(events[0]!.next_configuration).not.toHaveProperty("alongside");
    expect([events[1]!.previous_configuration!.alongside, events[1]!.next_configuration.alongside]).toEqual([null, true]);
    expect(events[1]!.previous_configuration).not.toEqual(events[1]!.next_configuration);
    expect([events[2]!.previous_configuration!.alongside, events[2]!.next_configuration.alongside]).toEqual([true, true]);
    expect(bundle.jsonBackup.occurrences.map((row) => row.behavior_configuration_event_id))
      .toEqual(["configuration-1", "configuration-a", "configuration-2"]);
    // BehaviorLog: the raw Cadence history keeps the answer, and the portable history keeps
    // it in the snapshot extension the transformation note points to.
    const raw = jsonl(bundle.behaviorLog.files, "raw/cadence/behavior_configuration_events.jsonl");
    const answer = raw.find((row) => row.id === "configuration-a")!;
    expect([(answer.previous_configuration as Row).alongside, (answer.next_configuration as Row).alongside]).toEqual([null, true]);
    const portable = jsonl(bundle.behaviorLog.files, "data/behavior_configuration_events.jsonl")
      .find((row) => row.event_id === "configuration-a")!;
    expect(portable.changed_fields).toEqual([]);
    expect([cadence(portable.previous as Row).alongside, cadence(portable.next as Row).alongside]).toEqual([null, true]);
  });

  it("stays a valid BehaviorLog bundle with alongside on and off", async () => {
    for (const includeAlongside of [true, false]) {
      const files = assembleExportBundle(historyInput(true, includeAlongside)).behaviorLog.files;
      const root = await mkdtemp(path.join(tmpdir(), "cadence-alongside-history-"));
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
    }
  });

  it("imports and restores the answered account's bundle with alongside on and off", () => {
    for (const read of [true, false]) {
      const files = assembleExportBundle(historyInput(true, read)).behaviorLog.files;
      const importPreview = resolveBehaviorLogImportPreview({ files, ...(read ? { readAlongside: true } : {}) });
      expect(importPreview.valid, JSON.stringify(importPreview.errors)).toBe(true);
      if (read) expect(importPreview.plan.behaviors[0]).toHaveProperty("cadenceAlongside", true);
      else expect(importPreview.plan.behaviors[0]).not.toHaveProperty("cadenceAlongside");
      expect(resolveBehaviorLogImportMergePreview({ files, ...(read ? { readAlongside: true } : {}) }).errors).toEqual([]);
      const rows = alongsideHistoryRows(true);
      const records = assembleBehaviorLogExistingRecords({
        behaviors: [{ ...rows.behavior, category: null } as never], occurrences: rows.occurrences as never[],
        statusEvents: [], definitionEvents: [], timeSessions: [], mappings: [], importedNotes: [],
        importedInterventions: [], configurationEvents: rows.configurationEvents as never[], includeAlongside: read,
      });
      const preview = resolveBehaviorLogRestorePreview({ importPreview, existing: records });
      expect(preview.errors ?? [], JSON.stringify(preview.errors)).toEqual([]);
      // Restoring the account's own bundle changes no Behavior, flag on or off.
      expect(preview.actions.behaviors.map((action) => action.action)).toEqual(["keep"]);
      const { payload } = buildRestorePayload({ userId: USER_ID, importRunId: portabilityApplyRun().id, now: PORTABILITY_NOW,
        importPreview, preview, existing: records });
      expect(JSON.stringify(payload.behavior_configuration_events)).not.toContain("configuration-a");
    }
  });
});
