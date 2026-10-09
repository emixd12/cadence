import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { parseBriefingConfig } from "@cadence/core/services/briefing-config";
import { BRIEFING_ANALYSIS_LANES } from "@cadence/core/resolvers/briefing-analysis.resolver";
import type { BriefingAnalysisLaneId } from "@cadence/core/types/briefing-analysis";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import type { DailyBriefing } from "@cadence/core/types/daily-brief";
import { readDailyBriefPreferences } from "@/lib/db/daily-brief.repo";
import { briefingAccountRef } from "./briefing-account-context.service";
import { briefingBenchBudget, type BriefingBenchBudgetSnapshot, type BriefingBenchReservation } from "./briefing-bench-budget";
import { benchPartition, createBriefingBenchStore, isBenchId, BRIEFING_BENCH_SCHEMA_VERSION, type BenchCaseDetail, type BenchRun, type BriefingBenchStore } from "./briefing-bench-store";
import { briefingFixture, type BriefingFixtureId } from "./briefing-fixtures";
import { briefingAnalysisFixture, type BriefingAnalysisFixtureId } from "./briefing-analysis-fixtures";
import { prepareBriefing, type BriefingAnalysisInput } from "./briefing-pipeline";
import { DAILY_BRIEF_MODEL } from "./daily-brief-openai";
import { DAILY_BRIEF_PROMPT_REVISION, DailyBriefError, type DailyBriefGenerator } from "./daily-brief-consumer";
import { runDailyBriefRequest } from "./daily-brief-request";
import type { CalendarCaller } from "./google-calendar.service";
import { assertSavedCaseAuthorized, benchCaseFingerprint, guard, json, parseReview, readComparisonBody, replaySavedCase, runBriefingComparison, type ReviewCandidateInput } from "./briefing-workbench.service";

export type BriefingSequenceHistory = Readonly<{ fingerprint: string; lastShownLocalDate: string }>;
export type BriefingSequenceResult = Readonly<{
  caseId: string; localDate: string; side: 0 | 1; candidateId: string; laneId: BriefingAnalysisLaneId | null;
  state: "ready" | "error" | "cancelled"; briefing?: DailyBriefing; inspector: ReturnType<typeof prepareBriefing>;
  error?: string; validation: string; latencyMs: number; runId: string | null; saved: boolean; retainedFingerprints: readonly string[];
}>;
export type BriefingSequencePlan = Readonly<{
  caseIds: readonly string[]; mode: "daily" | "diagnostic"; plannedCalls: number; callBudget: number;
  warmup: readonly BriefingSequenceHistory[];
  spacing: "one_tip_per_day_skip_different_tip_next_day";
  assumption: "Selected tips are assumed delivered in this no-model simulation; generation records only retained successful tips.";
  days: readonly Readonly<{ caseId: string; localDate: string; evidenceType: BenchCaseDetail["case"]["evidenceType"];
    selections: readonly Readonly<{ side: 0 | 1; candidateId: string; tipId: string | null; fingerprint: string | null;
      decisions: readonly Readonly<{ findingId: string; decision: string }>[]; eligibleLanes: readonly BriefingAnalysisLaneId[]; cooldownDays: number }>[] }> [];
  budget: BriefingBenchBudgetSnapshot;
}>;
export type BriefingSequenceStatus = Readonly<{
  id: string; state: "queued" | "running" | "ready" | "partial" | "cancelled" | "error";
  plan: BriefingSequencePlan; results: readonly BriefingSequenceResult[]; dispatchedCalls: number;
  error?: string; usage: "unavailable"; budget: BriefingBenchBudgetSnapshot;
}>;

type SequenceInput = { action: "simulate" | "start"; accountRef: string | null; caseIds: string[]; configs: BriefingConfig[];
  candidates: readonly ReviewCandidateInput[]; mode: "daily" | "diagnostic"; warmup: BriefingSequenceHistory[]; callBudget: number };
type Task = { detail: BenchCaseDetail; side: 0 | 1; candidate: ReviewCandidateInput; config: BriefingConfig; laneId: BriefingAnalysisLaneId | null };
type Job = { id: string; accountRef: string | null; createdAt: number; controller: AbortController; state: BriefingSequenceStatus["state"];
  plan: BriefingSequencePlan; results: BriefingSequenceResult[]; error?: string; reservation: BriefingBenchReservation; details: BenchCaseDetail[]; tasks: Task[] };
// ponytail: one-hour process memory retains unsaved outputs after cancellation; persisted runs remain the durable review record.
const jobs = new Map<string, Job>();

function view(job: Job): BriefingSequenceStatus {
  return { id: job.id, state: job.state, plan: job.plan, results: job.results, dispatchedCalls: job.reservation.used,
    ...(job.error ? { error: job.error } : {}), usage: "unavailable", budget: briefingBenchBudget().snapshot() };
}
function parseInput(value: unknown): SequenceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DailyBriefError("invalid_request");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !["action", "accountRef", "caseIds", "configs", "candidates", "mode", "warmup", "callBudget"].includes(key)) ||
      !["simulate", "start"].includes(String(item.action)) || !["daily", "diagnostic"].includes(String(item.mode)) ||
      !(item.accountRef === null || typeof item.accountRef === "string") || !Array.isArray(item.caseIds) || item.caseIds.length < 1 || item.caseIds.length > 14 ||
      !item.caseIds.every(isBenchId) || new Set(item.caseIds).size !== item.caseIds.length || !Array.isArray(item.configs) || item.configs.length !== 2 || !Array.isArray(item.warmup) || item.warmup.length > 256) throw new DailyBriefError("invalid_request");
  benchPartition(item.accountRef as string | null);
  const configs = item.configs.map(parseBriefingConfig);
  const candidates = parseReview({ caseId: item.caseIds[0], candidates: item.candidates }, 2).candidates;
  const warmup = item.warmup.map(value => {
    const entry = value as Record<string, unknown>;
    if (!entry || typeof entry !== "object" || Object.keys(entry).sort().join() !== "fingerprint,lastShownLocalDate" ||
        typeof entry.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(entry.fingerprint) || typeof entry.lastShownLocalDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.lastShownLocalDate)) throw new DailyBriefError("invalid_request");
    Temporal.PlainDate.from(entry.lastShownLocalDate);
    return entry as BriefingSequenceHistory;
  });
  const callBudget = item.callBudget ?? briefingBenchBudget().snapshot().limit;
  if (!Number.isSafeInteger(callBudget) || Number(callBudget) < 1 || Number(callBudget) > briefingBenchBudget().snapshot().limit) throw new DailyBriefError("invalid_request");
  return { ...item, configs, candidates, warmup, callBudget } as SequenceInput;
}
function inputs(detail: BenchCaseDetail, config: BriefingConfig) {
  const saved = detail.case;
  const replay = replaySavedCase(saved, [config]);
  const context = replay?.contexts[0] ?? briefingFixture((saved.source.mode === "synthetic" ? saved.source.fixtureId : "sparse") as BriefingFixtureId, config);
  const effective = replay?.configs[0] ?? config;
  const analysis: BriefingAnalysisInput = { source: replay ? replay.analysisSource : saved.source.mode === "synthetic" && saved.source.analysisFixtureId
    ? briefingAnalysisFixture(saved.source.analysisFixtureId as BriefingAnalysisFixtureId, context) : null, fingerprintOf: benchCaseFingerprint(saved),
    ...(saved.evidenceType === "retrospective" ? { cadenceComplete: false } : {}) };
  return { context, config: effective, analysis };
}
async function authorize(caller: CalendarCaller | undefined, accountRef: string | null, details: readonly BenchCaseDetail[], signal: AbortSignal) {
  if (!caller) { if (accountRef !== null || details.some(detail => detail.case.source.mode !== "synthetic")) throw new DailyBriefError("access_denied"); return; }
  if (briefingAccountRef(caller.user.id) !== accountRef) throw new DailyBriefError("access_denied");
  const preferences = await readDailyBriefPreferences(caller.client, signal);
  if (!preferences.enabled) throw new DailyBriefError("access_denied");
  for (const detail of details) await assertSavedCaseAuthorized(caller, preferences, detail.case, signal);
}
function planSequence(input: SequenceInput, details: BenchCaseDetail[]) {
  const histories: BriefingSequenceHistory[][] = [input.warmup.slice(), input.warmup.slice()];
  const tasks: Task[] = [];
  const days = details.map(detail => {
    const selections = input.configs.map((config, index) => {
      const side = index as 0 | 1;
      const replay = inputs(detail, config);
      const prepared = prepareBriefing(replay.context, replay.config, replay.context.capturedAt, { ...replay.analysis, shown: histories[index] });
      const eligibleLanes = BRIEFING_ANALYSIS_LANES.filter(contract => config.analysis.lanes.includes(contract.id)).flatMap(contract => {
        const diagnostic = parseBriefingConfig({ ...replay.config, analysis: { ...replay.config.analysis, lanes: [contract.id], maxTips: 1 } });
        return prepareBriefing(replay.context, diagnostic, replay.context.capturedAt, replay.analysis).analysis?.tip ? [contract.id] : [];
      });
      if (prepared.analysis?.tip) for (const fingerprint of prepared.analysis.recordFingerprints) histories[index].push({ fingerprint, lastShownLocalDate: detail.case.localDate });
      if (input.mode === "daily") tasks.push({ detail, side, candidate: input.candidates[index]!, config, laneId: null });
      else for (const laneId of eligibleLanes) tasks.push({ detail, side, candidate: { ...input.candidates[index]!, id: randomUUID(),
        label: `${input.candidates[index]!.label.slice(0, 45)} · ${laneId}`, parentCandidateId: detail.candidates.some(candidate => candidate.id === input.candidates[index]!.id) ? input.candidates[index]!.id : null },
        config: parseBriefingConfig({ ...config, analysis: { ...config.analysis, lanes: [laneId], maxTips: 1 } }), laneId });
      return { side, candidateId: input.candidates[index]!.id, tipId: prepared.analysis?.selection.tipId ?? null,
        fingerprint: prepared.analysis?.fingerprint ?? null, decisions: prepared.analysis?.selection.decisions ?? [], eligibleLanes, cooldownDays: config.analysis.cooldownDays };
    });
    return { caseId: detail.case.id, localDate: detail.case.localDate, evidenceType: detail.case.evidenceType, selections };
  });
  const plan: BriefingSequencePlan = { caseIds: details.map(detail => detail.case.id), mode: input.mode, plannedCalls: tasks.length, callBudget: input.callBudget,
    warmup: input.warmup, spacing: "one_tip_per_day_skip_different_tip_next_day",
    assumption: "Selected tips are assumed delivered in this no-model simulation; generation records only retained successful tips.", days, budget: briefingBenchBudget().snapshot() };
  return { plan, tasks };
}

/** Simulation never invokes a provider. Start returns immediately; GET retains partial results after DELETE. */
export async function startBriefingSequence(request: Request, generate?: DailyBriefGenerator, store: BriefingBenchStore = createBriefingBenchStore()): Promise<Response> {
  const denied = guard(request); if (denied) return denied;
  try {
    const input = parseInput(await readComparisonBody(request));
    const run = async (caller?: CalendarCaller) => {
      if (caller && briefingAccountRef(caller.user.id) !== input.accountRef) throw new DailyBriefError("access_denied");
      for (const [id, job] of jobs) if (Date.now() - job.createdAt > 3_600_000 && !["running", "queued"].includes(job.state)) jobs.delete(id);
      const details = await Promise.all(input.caseIds.map(id => store.readCase(benchPartition(input.accountRef), id)));
      details.sort((a, b) => Temporal.Instant.compare(Temporal.Instant.from(a.case.capturedAt), Temporal.Instant.from(b.case.capturedAt)));
      if (new Set(details.map(detail => detail.case.timezone)).size > 1 || new Set(details.map(detail => detail.case.localDate)).size !== details.length ||
          input.warmup.some(entry => entry.lastShownLocalDate > details[0]!.case.localDate)) throw new DailyBriefError("invalid_request");
      await authorize(caller, input.accountRef, details, request.signal);
      const { plan, tasks } = planSequence(input, details);
      if (input.action === "simulate") return plan;
      let rejection: string | undefined;
      if (!generate && !process.env.OPENAI_API_KEY) rejection = "not_configured";
      if (plan.plannedCalls > input.callBudget || plan.plannedCalls > briefingBenchBudget().snapshot().available) rejection = "comparison_limit";
      const reservation = briefingBenchBudget().reserve(rejection ? 0 : plan.plannedCalls);
      const job: Job = { id: randomUUID(), accountRef: input.accountRef, createdAt: Date.now(), controller: new AbortController(), state: "queued", plan,
        results: [], reservation, details, tasks };
      jobs.set(job.id, job);
      if (rejection) {
        job.error = rejection; job.state = "error";
        for (const task of tasks) job.results.push(await skipped(task, job, rejection, store));
        reservation.close();
        return view(job);
      }
      void execute(job, input, request, generate, store);
      return view(job);
    };
    if (input.accountRef !== null) {
      const response = await runDailyBriefRequest(request, caller => run(caller));
      if (!response.ok || input.action !== "start") return response;
      const body = await response.json();
      return json(body, body.error === "comparison_limit" ? 429 : body.error === "not_configured" ? 503 : 202);
    }
    const body = await run();
    return json(body, input.action !== "start" ? 200 : "error" in body && body.error === "comparison_limit" ? 429 : "error" in body && body.error === "not_configured" ? 503 : 202);
  } catch (error) { return sequenceError(error); }
}

async function execute(job: Job, input: SequenceInput, request: Request, generate: DailyBriefGenerator | undefined, store: BriefingBenchStore) {
  job.state = "running";
  const histories = [input.warmup.slice(), input.warmup.slice()];
  try {
    for (const task of job.tasks) {
      if (job.controller.signal.aborted) { job.results.push(await skipped(task, job, "cancelled", store)); continue; }
      const comparison = new Request(request.url, { method: "POST", headers: request.headers, signal: job.controller.signal,
        body: JSON.stringify({ mode: "saved", accountRef: job.accountRef, configs: [task.config], review: { caseId: task.detail.case.id, candidates: [task.candidate] } }) });
      const response = await runBriefingComparison(comparison, generate, store, { reservation: job.reservation, sequenceId: job.id,
        shown: [histories[task.side]], ...(task.laneId ? { diagnosticLane: task.laneId } : {}),
        onRetainedTip: (_, fingerprints, localDate) => { for (const fingerprint of fingerprints) histories[task.side].push({ fingerprint, lastShownLocalDate: localDate }); } });
      const body = await response.json();
      if (!response.ok) {
        job.results.push(await skipped(task, job, typeof body.error === "string" ? body.error : "generation_failed", store));
        if (["unauthenticated", "access_denied", "context_changed"].includes(body.error)) { job.error = body.error; job.controller.abort(); }
        continue;
      }
      for (const result of body.results) job.results.push({ ...result, caseId: task.detail.case.id, localDate: task.detail.case.localDate,
        side: task.side, candidateId: task.candidate.id, laneId: task.laneId });
    }
    job.state = job.error ? "error" : job.controller.signal.aborted ? "cancelled" : job.results.every(result => result.state === "ready") ? "ready" : "partial";
  } catch { job.error = "generation_failed"; job.state = "error"; }
  finally { job.reservation.close(); }
}
async function skipped(task: Task, job: Job, error: string, store: BriefingBenchStore): Promise<BriefingSequenceResult> {
  const partition = benchPartition(job.accountRef);
  // A comparison may already have saved its rejected attempt before withholding the response.
  const existing = await store.readCase(partition, task.detail.case.id).catch(() => null);
  const recorded = existing?.runs.findLast(run => run.evaluation?.sequenceId === job.id && run.candidateId === task.candidate.id);
  if (recorded) return { caseId: task.detail.case.id, localDate: task.detail.case.localDate, side: task.side, candidateId: task.candidate.id, laneId: task.laneId,
    state: recorded.state, ...(recorded.briefing ? { briefing: recorded.briefing } : {}), ...(recorded.error ? { error: recorded.error } : {}), validation: recorded.validation,
    latencyMs: recorded.latencyMs, inspector: recorded.inspector as ReturnType<typeof prepareBriefing>, saved: true, runId: recorded.id, retainedFingerprints: recorded.evaluation?.retainedFingerprints ?? [] };
  const replay = inputs(task.detail, task.config);
  const inspector = prepareBriefing(replay.context, replay.config, replay.context.capturedAt, replay.analysis);
  const state = error === "cancelled" ? "cancelled" as const : "error" as const;
  const id = randomUUID(), createdAt = new Date().toISOString();
  let saved = true;
  const run: BenchRun = { schemaVersion: BRIEFING_BENCH_SCHEMA_VERSION, kind: "run", id, caseId: task.detail.case.id, candidateId: task.candidate.id,
    attemptId: randomUUID(), createdAt, state, error, validation: "not_completed", latencyMs: 0, model: DAILY_BRIEF_MODEL,
    promptRevision: DAILY_BRIEF_PROMPT_REVISION, configurationRevision: inspector.configurationRevision, pipelineVersion: inspector.pipelineVersion, inspector,
    evaluation: { sequenceId: job.id, mode: task.laneId ? "diagnostic" : "daily", ...(task.laneId ? { laneId: task.laneId } : {}), retainedFingerprints: [] } };
  try {
    if (!existing?.candidates.some(candidate => candidate.id === task.candidate.id)) {
      await store.append(partition, task.detail.case.id, "candidates", { schemaVersion: BRIEFING_BENCH_SCHEMA_VERSION, kind: "candidate", ...task.candidate,
        label: task.candidate.label.trim(), rationale: task.candidate.rationale.trim(), caseId: task.detail.case.id, createdAt, config: task.config, configurationRevision: inspector.configurationRevision });
    }
    await store.append(partition, task.detail.case.id, "runs", run);
  } catch { saved = false; }
  return { caseId: task.detail.case.id, localDate: task.detail.case.localDate, side: task.side, candidateId: task.candidate.id, laneId: task.laneId,
    state, error, validation: "not_completed", latencyMs: 0, inspector, saved, runId: saved ? id : null, retainedFingerprints: [] };
}
function sequenceError(error: unknown) {
  const code = error instanceof DailyBriefError ? error.code : "invalid_request";
  return json({ error: code, budget: briefingBenchBudget().snapshot() }, code === "comparison_limit" ? 429 : code === "sequence_not_found" ? 404 : code === "not_configured" ? 503 : 400);
}
async function accessJob(request: Request, id: unknown, accountRef: unknown, mutate: boolean) {
  if (!isBenchId(id) || !(accountRef === null || typeof accountRef === "string")) throw new DailyBriefError("invalid_request");
  const job = jobs.get(id);
  if (!job || job.accountRef !== accountRef || Date.now() - job.createdAt > 3_600_000) throw new DailyBriefError("sequence_not_found");
  const run = async (caller?: CalendarCaller) => {
    await authorize(caller, job.accountRef, job.details, request.signal);
    if (mutate) { job.controller.abort(); job.reservation.close(); }
    return view(job);
  };
  return accountRef === null ? json(await run()) : runDailyBriefRequest(request, caller => run(caller));
}
export async function readBriefingSequence(request: Request): Promise<Response> {
  const denied = guard(request); if (denied) return denied;
  try { const params = new URL(request.url).searchParams; return await accessJob(request, params.get("id"), params.get("accountRef"), false); }
  catch (error) { return sequenceError(error); }
}
export async function cancelBriefingSequence(request: Request): Promise<Response> {
  const denied = guard(request); if (denied) return denied;
  try {
    const value = await readComparisonBody(request);
    if (!value || typeof value !== "object" || Object.keys(value).sort().join() !== "accountRef,id") throw new DailyBriefError("invalid_request");
    return await accessJob(request, value.id, value.accountRef, true);
  } catch (error) { return sequenceError(error); }
}
