import { mkdir, readdir, readFile, rename, rm, stat, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { AdvisorDayContextV1 } from "@cadence/core/types/advisor-day-context";
import type { BriefingAnalysisSource } from "@cadence/core/types/briefing-analysis";
import type { BriefingAnalysisLaneId } from "@cadence/core/types/briefing-analysis";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import type { DailyBriefing } from "@cadence/core/types/daily-brief";
import { parseBriefingConfig } from "@cadence/core/services/briefing-config";

/**
 * Local, development-only review records for the briefing workbench
 * (Tickets 176–177). Files live under `.local/briefing-bench/v1/<partition>/`,
 * one directory per case. Directories are owner-only (0700) and files 0600;
 * `.gitignore` only prevents commits. Cases expire after
 * BRIEFING_BENCH_RETENTION_DAYS and can be deleted from the workbench.
 */
export const BRIEFING_BENCH_SCHEMA_VERSION = 1;
export const BRIEFING_BENCH_RETENTION_DAYS = 30;
/** Captured account inputs above this size are not saved; the case becomes Review only. */
export const BRIEFING_BENCH_MAX_INPUT_BYTES = 4 * 1024 * 1024;

const ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
const ACCOUNT_REF = /^[A-Za-z0-9_-]{16,128}$/;

export type BenchPartition = "synthetic" | `account-${string}`;

export function benchPartition(accountRef: string | null): BenchPartition {
  if (accountRef === null) return "synthetic";
  if (!ACCOUNT_REF.test(accountRef)) throw new BriefingBenchStoreError("invalid_partition");
  return `account-${accountRef}`;
}

export function isBenchId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

export class BriefingBenchStoreError extends Error {
  readonly name = "BriefingBenchStoreError";
  constructor(public readonly code: "invalid_partition" | "invalid_id" | "not_found" | "exists" | "write_failed") { super(code); }
}

/** Matches by name so a store injected from another module instance is still recognized. */
export function isBriefingBenchStoreError(error: unknown): error is BriefingBenchStoreError {
  return error instanceof Error && error.name === "BriefingBenchStoreError";
}

export type BenchCaseSource =
  | Readonly<{ mode: "synthetic"; fixtureId: string; fixtureVersion: string; analysisFixtureId: string | null; analysisFixtureVersion: string }>
  | Readonly<{ mode: "account"; accountRef: string; preferenceRevision: number }>;

export type BenchCaseCapture = Readonly<{
  historyDays: readonly number[];
  /** Captured flags record what was read; disclosed flags record Settings at capture time. */
  includeCalendar: boolean;
  calendarDisclosed: boolean;
  includeRecordedElapsedDurations: boolean;
  includeHistoricalCompletionTimes: boolean;
  analysis: boolean;
  includeReminders: boolean;
  remindersDisclosed: boolean;
  includeNotes: boolean;
  notesDisclosed: boolean;
}>;

export type BenchCaseInputs = Readonly<{
  /** One captured context per history window in `capture.historyDays`. */
  contexts: readonly AdvisorDayContextV1[];
  analysisSource: BriefingAnalysisSource | null;
  /** Workbench Behavior refs mapped to this capture's opaque refs. */
  configurationRefs: Readonly<Record<string, string>>;
}>;

export type BenchHistoryCoverage = Readonly<{
  source: "occurrences" | "completion_history" | "durations" | "configuration" | "timezone" | "notes" | "reminders" | "calendar" | "analysis";
  startLocalDate: string;
  endLocalDateExclusive: string;
  state: "retained" | "synthetic" | "unknown" | "unavailable" | "not_requested" | "capped";
  retainedRows: number | null;
  limitations: readonly string[];
}>;

export type BenchCaseHistory = Readonly<{
  version: 1;
  /** Actual request/capture time. Evaluation timestamps never replace this fact. */
  observedAt: string;
  logicalTime: string;
  lookbackDays: readonly number[];
  coverage: readonly BenchHistoryCoverage[];
  cutoff: "local-date half-open lookback; current retained state, no as-of reconstruction" | "authored synthetic evaluation";
}>;

export type BenchCase = Readonly<{
  schemaVersion: typeof BRIEFING_BENCH_SCHEMA_VERSION;
  kind: "case";
  id: string;
  createdAt: string;
  source: BenchCaseSource;
  /** Reconstructed is reserved for verified retained history; current reads are Retrospective. */
  evidenceType: "synthetic" | "captured" | "reconstructed" | "retrospective";
  /** Absent on older cases. Their original evidence label remains readable. */
  history?: BenchCaseHistory;
  localDate: string;
  timezone: string;
  /** The logical clock for every run of this case. */
  capturedAt: string;
  expiresAt: string;
  capture: BenchCaseCapture;
  /** Account inputs for exact reruns. Absent means Review only. */
  inputs?: BenchCaseInputs;
  behaviorTitles: readonly Readonly<{ ref: string; title: string }>[];
}>;

export type BenchCandidate = Readonly<{
  schemaVersion: typeof BRIEFING_BENCH_SCHEMA_VERSION;
  kind: "candidate";
  id: string;
  caseId: string;
  createdAt: string;
  label: string;
  role: "baseline" | "candidate";
  parentCandidateId: string | null;
  proposalId: string | null;
  rationale: string;
  config: BriefingConfig;
  configurationRevision: string;
}>;

export type BenchRun = Readonly<{
  schemaVersion: typeof BRIEFING_BENCH_SCHEMA_VERSION;
  kind: "run";
  id: string;
  caseId: string;
  candidateId: string;
  attemptId: string;
  createdAt: string;
  state: "ready" | "error" | "cancelled";
  briefing?: DailyBriefing;
  error?: string;
  validation: string;
  latencyMs: number;
  model: string;
  promptRevision: string;
  configurationRevision: string;
  pipelineVersion: string;
  inspector: unknown;
  evaluation?: Readonly<{
    sequenceId: string;
    mode: "daily" | "diagnostic";
    laneId?: BriefingAnalysisLaneId;
    label?: string;
    retainedFingerprints: readonly string[];
  }>;
}>;

export type BenchPreference = "prefer_a" | "prefer_b" | "both_work" | "neither_works";

export type BenchFeedback = Readonly<{
  schemaVersion: typeof BRIEFING_BENCH_SCHEMA_VERSION;
  kind: "feedback";
  id: string;
  caseId: string;
  createdAt: string;
  runIds: readonly [string | null, string | null];
  candidateIds: readonly [string | null, string | null];
  preference: BenchPreference | null;
  comment: string;
  quote: Readonly<{ runId: string; text: string }> | null;
  replacement: string | null;
}>;

export type BenchProposalOwner = "configuration" | "prompt" | "resolver" | "presentation" | "evidence";

/** Written by a coding agent from a review packet. The workbench validates, never executes, it. */
export type BenchProposal = Readonly<{
  schemaVersion: typeof BRIEFING_BENCH_SCHEMA_VERSION;
  kind: "proposal";
  id: string;
  caseId: string;
  createdAt: string;
  feedbackIds: readonly string[];
  interpretedProblem: string;
  owner: BenchProposalOwner;
  change: Readonly<{ kind: "configuration"; label: string; config: unknown; parentCandidateId: string | null }>
    | Readonly<{ kind: "repository"; summary: string; files: readonly string[] }>;
  expectedEffect: string;
  possibleRegression: string;
  rerunCaseIds: readonly string[];
}>;

export type BenchDisposition = Readonly<{
  schemaVersion: typeof BRIEFING_BENCH_SCHEMA_VERSION;
  kind: "disposition";
  id: string;
  caseId: string;
  proposalId: string;
  createdAt: string;
  decision: "accepted" | "needs_correction" | "rejected";
  comment: string;
}>;

export type BenchCaseDetail = Readonly<{
  case: BenchCase;
  candidates: readonly BenchCandidate[];
  runs: readonly BenchRun[];
  feedback: readonly BenchFeedback[];
  proposals: readonly BenchProposal[];
  invalidProposals: readonly string[];
  dispositions: readonly BenchDisposition[];
}>;

export type BenchCaseSummary = Readonly<{
  id: string;
  createdAt: string;
  source: BenchCaseSource;
  evidenceType: BenchCase["evidenceType"];
  localDate: string;
  rerunnable: boolean;
  runs: number;
  feedback: number;
  proposals: number;
}>;

type JsonlKind = "candidates" | "runs" | "feedback" | "dispositions";

export function defaultBriefingBenchRoot(): string {
  return path.join(process.cwd(), ".local", "briefing-bench", `v${BRIEFING_BENCH_SCHEMA_VERSION}`);
}

export function createBriefingBenchStore(root: string = defaultBriefingBenchRoot()) {
  const caseDir = (partition: BenchPartition, caseId: string) => {
    if (!isBenchId(caseId)) throw new BriefingBenchStoreError("invalid_id");
    return path.join(root, partition, caseId);
  };
  const ensureDir = (dir: string) => mkdir(dir, { recursive: true, mode: 0o700 });

  async function readCaseRecord(partition: BenchPartition, caseId: string): Promise<BenchCase> {
    const raw = await readFile(path.join(caseDir(partition, caseId), "case.json"), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new BriefingBenchStoreError("not_found");
      throw error;
    });
    const record = JSON.parse(raw) as BenchCase;
    if (!(Date.parse(record.createdAt) > Date.now() - BRIEFING_BENCH_RETENTION_DAYS * 86_400_000)) {
      await deleteCase(partition, caseId);
      throw new BriefingBenchStoreError("not_found");
    }
    return record;
  }

  async function createCase(partition: BenchPartition, record: BenchCase): Promise<void> {
    const dir = caseDir(partition, record.id);
    await ensureDir(path.dirname(dir));
    try { await mkdir(dir, { mode: 0o700 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new BriefingBenchStoreError("exists");
      throw error;
    }
    const temporary = path.join(dir, `.case-${process.pid}.json`);
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" });
    await rename(temporary, path.join(dir, "case.json"));
  }

  async function append(partition: BenchPartition, caseId: string, kind: JsonlKind, record: unknown): Promise<void> {
    const dir = caseDir(partition, caseId);
    await readCaseRecord(partition, caseId);
    await appendFile(path.join(dir, `${kind}.jsonl`), `${JSON.stringify(record)}\n`, { mode: 0o600 });
  }

  async function readCase(partition: BenchPartition, caseId: string): Promise<BenchCaseDetail> {
    const dir = caseDir(partition, caseId);
    const record = await readCaseRecord(partition, caseId);
    const proposals: BenchProposal[] = [], invalidProposals: string[] = [];
    const proposalDir = path.join(dir, "proposals");
    for (const name of (await readDirectory(proposalDir)).filter((entry) => entry.endsWith(".json")).sort()) {
      try {
        const proposal = parseBenchProposal(JSON.parse(await readFile(path.join(proposalDir, name), "utf8")), caseId);
        if (proposal) proposals.push(proposal); else invalidProposals.push(name);
      } catch { invalidProposals.push(name); }
    }
    return {
      case: record,
      candidates: await readJsonl<BenchCandidate>(path.join(dir, "candidates.jsonl")),
      runs: await readJsonl<BenchRun>(path.join(dir, "runs.jsonl")),
      feedback: await readJsonl<BenchFeedback>(path.join(dir, "feedback.jsonl")),
      proposals,
      invalidProposals,
      dispositions: await readJsonl<BenchDisposition>(path.join(dir, "dispositions.jsonl")),
    };
  }

  async function listCases(partition: BenchPartition): Promise<BenchCaseSummary[]> {
    const dir = path.join(root, partition);
    const summaries: BenchCaseSummary[] = [];
    for (const name of await readDirectory(dir)) {
      if (!isBenchId(name)) continue;
      try {
        const detail = await readCase(partition, name);
        summaries.push({
          id: detail.case.id, createdAt: detail.case.createdAt, source: detail.case.source, evidenceType: detail.case.evidenceType,
          localDate: detail.case.localDate, rerunnable: detail.case.source.mode === "synthetic" || !!detail.case.inputs,
          runs: detail.runs.length, feedback: detail.feedback.length, proposals: detail.proposals.length,
        });
      } catch (error) {
        if (!isBriefingBenchStoreError(error) || error.code !== "not_found") throw error;
        // A partially written case stays invisible until retention removes it.
      }
    }
    return summaries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async function deleteCase(partition: BenchPartition, caseId: string): Promise<void> {
    await rm(caseDir(partition, caseId), { recursive: true, force: true });
  }

  /** Deletes cases older than the retention window. Returns the deleted case IDs. */
  async function pruneExpired(partition: BenchPartition, now: Date): Promise<string[]> {
    const dir = path.join(root, partition);
    const cutoff = now.getTime() - BRIEFING_BENCH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const deleted: string[] = [];
    for (const name of await readDirectory(dir)) {
      if (!isBenchId(name)) continue;
      const created = await readFile(path.join(dir, name, "case.json"), "utf8").then((raw) => Date.parse((JSON.parse(raw) as BenchCase).createdAt)).catch(async () =>
        (await stat(path.join(dir, name)).catch(() => null))?.mtimeMs ?? now.getTime());
      if (!(created > cutoff)) { await deleteCase(partition, name); deleted.push(name); }
    }
    return deleted;
  }

  async function writeText(partition: BenchPartition, caseId: string, name: "review-packet.md" | "sequence-report.md", text: string): Promise<string> {
    const dir = caseDir(partition, caseId);
    await readCaseRecord(partition, caseId);
    await ensureDir(path.join(dir, "proposals"));
    const target = path.join(dir, name);
    await writeFile(target, text, { mode: 0o600 });
    return target;
  }

  return { root, caseDir, createCase, append, readCase, listCases, deleteCase, pruneExpired, writeText };
}

export type BriefingBenchStore = ReturnType<typeof createBriefingBenchStore>;

async function readJsonl<T>(file: string): Promise<T[]> {
  const raw = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return raw.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    // A torn final line from an interrupted write is skipped, not fatal.
    try { return [JSON.parse(line) as T]; } catch { return []; }
  });
}

async function readDirectory(dir: string): Promise<string[]> {
  return readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}

const OWNERS: readonly BenchProposalOwner[] = ["configuration", "prompt", "resolver", "presentation", "evidence"];
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 50 && value.every(isBenchId);

/** Validates an agent-written proposal. Returns null when any field is missing or malformed. */
export function parseBenchProposal(value: unknown, caseId: string): BenchProposal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const change = item.change as Record<string, unknown> | undefined;
  if (item.schemaVersion !== BRIEFING_BENCH_SCHEMA_VERSION || item.kind !== "proposal" || !isBenchId(item.id) || item.caseId !== caseId ||
      typeof item.createdAt !== "string" || Number.isNaN(Date.parse(item.createdAt)) || !ids(item.feedbackIds) ||
      !text(item.interpretedProblem, 2000) || !OWNERS.includes(item.owner as BenchProposalOwner) ||
      !text(item.expectedEffect, 2000) || !text(item.possibleRegression, 2000) || !ids(item.rerunCaseIds) ||
      !change || typeof change !== "object") return null;
  if (change.kind === "configuration") {
    if (!text(change.label, 80) || !change.config || typeof change.config !== "object" ||
        !(change.parentCandidateId === null || isBenchId(change.parentCandidateId))) return null;
    try { parseBriefingConfig(change.config); } catch { return null; }
  } else if (change.kind === "repository") {
    if (!text(change.summary, 4000) || !Array.isArray(change.files) || change.files.length > 50 || !change.files.every((file) => text(file, 300))) return null;
  } else return null;
  return value as BenchProposal;
}
