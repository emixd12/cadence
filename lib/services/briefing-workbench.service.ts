import { BRIEFING_ANALYSIS_FIXTURE_IDS, BRIEFING_ANALYSIS_FIXTURE_VERSION, briefingAnalysisFixture, type BriefingAnalysisFixtureId } from "./briefing-analysis-fixtures";
import { Temporal } from "@js-temporal/polyfill";
import { BriefingConfigValidationError, parseBriefingConfig } from "@cadence/core/services/briefing-config";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import { authRequestUrl } from "@/lib/auth/redirects";
import { listBriefingWorkbenchBehaviors, listDailyBriefBehaviorIds, readDailyBriefPreferences, type DailyBriefPreferences } from "@/lib/db/daily-brief.repo";
import { briefingFixture, BRIEFING_FIXTURE_IDS, BRIEFING_FIXTURE_VERSION, type BriefingFixtureId } from "./briefing-fixtures";
import { BRIEFING_PIPELINE_VERSION, briefingConfigurationRevision, prepareBriefing } from "./briefing-pipeline";
import { DAILY_BRIEF_PROMPT_REVISION, generateDailyBrief, DailyBriefError, raceBriefAbort, type DailyBriefGenerator } from "./daily-brief-consumer";
import { DAILY_BRIEF_MODEL, generateOpenAIDailyBrief } from "./daily-brief-openai";
import { runDailyBriefRequest } from "./daily-brief-request";
import { getDailyBriefSettings } from "./daily-brief.service";
import { briefingAccountRef, prepareAccountBriefingContexts, workbenchBehaviorRef } from "./briefing-account-context.service";
import { getCalendarConnection, type CalendarCaller } from "./google-calendar.service";
import { createHash, randomUUID } from "node:crypto";
import { briefingBenchBudget, type BriefingBenchReservation } from "./briefing-bench-budget";
import type { BriefingAnalysisLaneId, BriefingFinding } from "@cadence/core/types/briefing-analysis";
import type { AdvisorDayContextV1 } from "@cadence/core/types/advisor-day-context";
import type { DailyBriefing } from "@cadence/core/types/daily-brief";
import {
  benchPartition, BRIEFING_BENCH_MAX_INPUT_BYTES, BRIEFING_BENCH_SCHEMA_VERSION, createBriefingBenchStore, isBriefingBenchStoreError, isBenchId,
  type BenchCandidate, type BenchCase, type BenchPartition, type BenchRun, type BriefingBenchStore,
} from "./briefing-bench-store";

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: {
  "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
} });
export function guard(request: Request): Response | null {
  if (process.env.NODE_ENV !== "development") return json({ error: "not_found" }, 404);
  const url = authRequestUrl(request), origin = request.headers.get("origin");
  if (["127.0.0.1", "localhost"].includes(url.hostname) && !/^43(?:2[1-9]|30)$/.test(url.port)) {
    return json({ error: "access_denied", recovery: "Open this development workbench on localhost port 4321–4330." }, 403);
  }
  if (!/^https?:$/.test(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !/^43(?:2[1-9]|30)$/.test(url.port) || request.headers.get("sec-fetch-site") !== "same-origin" ||
      (["POST", "DELETE"].includes(request.method) ? origin !== url.origin || request.headers.get("content-type") !== "application/json" : origin !== null && origin !== url.origin)) {
    return json({ error: "access_denied" }, 403);
  }
  return null;
}

/** Only account metadata and authorized labels; no context capture or generation. */
export async function readBriefingWorkbenchAccount(request: Request): Promise<Response> {
  const denied = guard(request);
  if (denied) return denied;
  return runDailyBriefRequest(request, async (caller) => {
    const settings = await getDailyBriefSettings(caller);
    const behaviors = settings.enabled ? await listBriefingWorkbenchBehaviors(caller.client, caller.user.id) : [];
    const current = await getDailyBriefSettings(caller);
    if (JSON.stringify(settings) !== JSON.stringify(current)) throw new DailyBriefError("context_changed");
    return { settings, behaviors: behaviors.map(({ id, title }) => ({ ref: workbenchBehaviorRef(caller.user.id, id), title })) };
  });
}

export type BriefingComparisonOptions = Readonly<{
  reservation?: BriefingBenchReservation;
  shown?: readonly (readonly Readonly<{ fingerprint: string; lastShownLocalDate: string }>[] )[];
  sequenceId?: string;
  diagnosticLane?: BriefingAnalysisLaneId;
  onRetainedTip?: (index: number, fingerprints: readonly string[], localDate: string) => void;
}>;

export type ReviewCandidateInput = Readonly<{ id: string; label: string; role: "baseline" | "candidate"; parentCandidateId: string | null; proposalId: string | null; rationale: string }>;
type ReviewInput = Readonly<{ caseId: string; candidates: readonly ReviewCandidateInput[] }>;

/**
 * Runs two configurations against one frozen snapshot. With `review`, the case,
 * candidates and every run (including failures and cancellations) are saved
 * locally (Ticket 176). `mode: "saved"` reruns a saved case on its original
 * logical clock after current authorization checks (Ticket 177).
 */
export async function runBriefingComparison(request: Request, generate?: DailyBriefGenerator, store: BriefingBenchStore = createBriefingBenchStore(), options: BriefingComparisonOptions = {}): Promise<Response> {
  const denied = guard(request);
  if (denied) return denied;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
  try {
    const value = await raceBriefAbort(readComparisonBody(request), signal);
    const isObject = !!value && typeof value === "object" && !Array.isArray(value);
    const accountMode = isObject && value.mode === "account";
    const savedMode = isObject && value.mode === "saved";
    const keys = isObject ? Object.keys(value).filter((key) => key !== "review").sort().join() : "";
    if (!isObject ||
        (savedMode ? keys !== "accountRef,configs,mode" : accountMode ? keys !== "accountRef,configs,mode,preferenceRevision" : keys !== "configs,fixtureId" && keys !== "analysisFixtureId,configs,fixtureId") ||
        (!accountMode && !savedMode && !BRIEFING_FIXTURE_IDS.includes(value.fixtureId)) ||
        (!accountMode && !savedMode && value.analysisFixtureId !== undefined && !BRIEFING_ANALYSIS_FIXTURE_IDS.includes(value.analysisFixtureId)) ||
        (accountMode && (typeof value.accountRef !== "string" || value.accountRef.length > 128 || !Number.isSafeInteger(value.preferenceRevision) || value.preferenceRevision < 0)) ||
        (savedMode && value.accountRef !== null && (typeof value.accountRef !== "string" || value.accountRef.length > 128)) ||
        !Array.isArray(value.configs) || (savedMode ? value.configs.length < 1 || value.configs.length > 2 : value.configs.length !== 2) ||
        (savedMode && value.review === undefined)) throw new DailyBriefError("invalid_request");
    const configs = value.configs.map(parseBriefingConfig) as BriefingConfig[];
    const review = value.review === undefined ? null : parseReview(value.review, configs.length);
    if (!generate && !process.env.OPENAI_API_KEY) return json({ error: "not_configured" }, 503);
    const compare = async (caller?: CalendarCaller) => {
      signal.throwIfAborted();
      const ownerRef = caller ? briefingAccountRef(caller.user.id) : null;
      if (caller && ownerRef !== value.accountRef) throw new DailyBriefError("context_changed");
      // Only saved reviews need a storage partition.
      const partition: BenchPartition = review ? benchPartition(ownerRef) : "synthetic";
      const saved = savedMode ? await store.readCase(partition, review!.caseId).catch((error) => {
        if (isBriefingBenchStoreError(error) && error.code === "not_found") throw new DailyBriefError("case_not_found");
        throw error;
      }) : null;
      const preferences = caller ? await readDailyBriefPreferences(caller.client, signal) : undefined;
      if (preferences && !preferences.enabled) throw new DailyBriefError("access_denied");
      if (preferences && accountMode && preferences.revision !== value.preferenceRevision) throw new DailyBriefError("access_denied");
      if (saved && caller && preferences) await assertSavedCaseAuthorized(caller, preferences, saved.case, signal);
      let reservation: BriefingBenchReservation;
      try { reservation = options.reservation ?? briefingBenchBudget().reserve(configs.length); }
      catch (error) { if (caller) throw new DailyBriefError("rate_limited", 3600); throw error; }
      try {
        const account = caller && !saved ? await raceBriefAbort(prepareAccountBriefingContexts(caller, {
          historyDays: configs.map(config => config.scope.historyDays), includeCalendar: configs.some(config => config.scope.includeCalendar), signal, preferences,
          includeRecordedElapsedDurations: configs.some(config => config.context.includeRecordedElapsedDurations),
          includeHistoricalCompletionTimes: configs.some(config => config.context.includeHistoricalCompletionTimes),
          ...(configs.some(config => config.analysis.lanes.length) ? { analysis: {
            includeReminders: configs.some(config => config.analysis.lanes.includes("reminder-effectiveness")),
            includeNotes: configs.some(config => config.analysis.lanes.includes("notes-failure-themes")),
          } } : {}),
        }), signal) : null;
        const replay = saved ? replaySavedCase(saved.case, configs) : null;
        const fixtureId = (saved?.case.source.mode === "synthetic" ? saved.case.source.fixtureId : value.fixtureId) as BriefingFixtureId;
        const analysisFixtureId = (saved?.case.source.mode === "synthetic" ? saved.case.source.analysisFixtureId ?? undefined : value.analysisFixtureId) as BriefingAnalysisFixtureId | undefined;
        const contexts = replay?.contexts ?? account?.contexts ?? configs.map(config => briefingFixture(fixtureId, config));
        const effectiveConfigs = replay?.configs ?? (account ? configs.map(config => accountConfig(config, account.configurationRefs, account.preferences.includeCalendar)) : configs);
        const analysisSource = replay ? replay.analysisSource : account ? account.analysisSource : undefined;
        const revisions = effectiveConfigs.map(briefingConfigurationRevision);
        const frozenClock = !account;
        let persisted = review ? await startReview(store, partition, review, {
          saved: saved?.case ?? null, configs, revisions, contexts,
          source: account ? { mode: "account", accountRef: ownerRef!, preferenceRevision: preferences!.revision }
            : { mode: "synthetic", fixtureId, fixtureVersion: BRIEFING_FIXTURE_VERSION, analysisFixtureId: analysisFixtureId ?? null, analysisFixtureVersion: BRIEFING_ANALYSIS_FIXTURE_VERSION },
          capture: account ? {
            historyDays: [...new Set(configs.map(config => config.scope.historyDays))],
            includeCalendar: configs.some(config => config.scope.includeCalendar) && account.preferences.includeCalendar,
            calendarDisclosed: account.preferences.includeCalendar,
            includeRecordedElapsedDurations: configs.some(config => config.context.includeRecordedElapsedDurations),
            includeHistoricalCompletionTimes: configs.some(config => config.context.includeHistoricalCompletionTimes),
            analysis: configs.some(config => config.analysis.lanes.length > 0),
            includeReminders: configs.some(config => config.analysis.lanes.includes("reminder-effectiveness")) && account.preferences.includeReminderHistory,
            remindersDisclosed: account.preferences.includeReminderHistory,
            includeNotes: configs.some(config => config.analysis.lanes.includes("notes-failure-themes")) && account.preferences.includeNotes,
            notesDisclosed: account.preferences.includeNotes,
          } : null,
          inputs: account ? { contexts: account.contexts, analysisSource: account.analysisSource, configurationRefs: account.configurationRefs } : null,
        }) : null;
        const attemptId = randomUUID();
        const runIds: string[] = [];
        const results = [];
        for (const [index, config] of effectiveConfigs.entries()) {
          const context = contexts[index], captured = Temporal.Instant.from(context.capturedAt);
          // Evaluation history stays separate from production; ordinary Compare uses no history.
          const analysis = { source: analysisSource !== undefined ? analysisSource : analysisFixtureId ? briefingAnalysisFixture(analysisFixtureId, context) : null,
            shown: options.diagnosticLane ? [] : options.shown?.[index] ?? [], fingerprintOf: benchCaseFingerprint(saved?.case),
            ...(saved?.case.evidenceType === "retrospective" ? { cadenceComplete: false } : {}) };
          const prepared = prepareBriefing(context, config, context.capturedAt, analysis);
          const start = Date.now();
          let retainedFingerprints: readonly string[] = [];
          const record = async (entry: { state: "ready" | "error" | "cancelled"; briefing?: DailyBriefing; error?: string; validation: string }) => {
            if (!persisted || !review) return null;
            const id = randomUUID();
            const run: BenchRun = { schemaVersion: BRIEFING_BENCH_SCHEMA_VERSION, kind: "run", id, caseId: review.caseId, candidateId: review.candidates[index]!.id, attemptId,
              createdAt: new Date().toISOString(), ...entry, latencyMs: Date.now() - start, model: DAILY_BRIEF_MODEL, promptRevision: DAILY_BRIEF_PROMPT_REVISION,
              configurationRevision: revisions[index]!, pipelineVersion: BRIEFING_PIPELINE_VERSION, inspector: prepared,
              ...(options.sequenceId ? { evaluation: { sequenceId: options.sequenceId, mode: options.diagnosticLane ? "diagnostic" as const : "daily" as const,
                ...(options.diagnosticLane ? { laneId: options.diagnosticLane, label: "Diagnostic preview: bypasses cross-lane ranking and cooldown. Evidence and validation still apply." } : {}), retainedFingerprints } } : {}) };
            try { await store.append(partition, review.caseId, "runs", run); runIds.push(id); return id; } catch { persisted = false; return null; }
          };
          try {
            signal.throwIfAborted();
            if (account) await raceBriefAbort(account.assertCurrent(), signal);
            if (saved && caller && preferences) await raceBriefAbort(assertSavedCaseAuthorized(caller, preferences, saved.case, signal), signal);
            const modelSignal = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
            const briefing = await generateDailyBrief(context, { config, signal: modelSignal, analysis,
              // Saved and synthetic cases replay on their captured clock; production keeps live freshness checks.
              planningNow: context.capturedAt, now: frozenClock ? () => captured : () => Temporal.Now.instant(),
              generate: (input) => reservation.dispatch(input.signal, () => (generate ?? ((payload) => generateOpenAIDailyBrief(payload, { apiKey: process.env.OPENAI_API_KEY! })))(input), async () => {
                // Authorization may change while another tab holds both provider permits.
                if (!generate && !process.env.OPENAI_API_KEY) throw new DailyBriefError("not_configured");
                if (account) await raceBriefAbort(account.assertCurrent(), input.signal);
                if (saved && caller && preferences) await raceBriefAbort(assertSavedCaseAuthorized(caller, preferences, saved.case, input.signal), input.signal);
              }) });
            if (account) await raceBriefAbort(account.assertCurrent(), signal);
            if (saved && caller && preferences) await raceBriefAbort(assertSavedCaseAuthorized(caller, preferences, saved.case, signal), signal);
            retainedFingerprints = briefing.tip ? prepared.analysis?.recordFingerprints ?? [] : [];
            if (!options.diagnosticLane) options.onRetainedTip?.(index, retainedFingerprints, context.localDate);
            const runId = await record({ state: "ready", briefing, validation: "passed" });
            results.push({ state: "ready", briefing, inspector: prepared, latencyMs: Date.now() - start, validation: "passed", runId, saved: !!runId, retainedFingerprints });
          } catch (error) {
            const cancelled = signal.aborted;
            const code = cancelled ? "cancelled" : error instanceof DailyBriefError ? error.code : "generation_failed";
            const state = cancelled ? "cancelled" as const : "error" as const;
            const validation = cancelled ? "not_completed" : "withheld";
            const runId = await record({ state, error: code, validation });
            results.push({ state, error: code, inspector: prepared, latencyMs: Date.now() - start, validation, runId, saved: !!runId, retainedFingerprints: [] });
            if (code === "access_denied" || code === "context_changed") throw error;
          }
        }
        if (effectiveConfigs.some((config, index) => briefingConfigurationRevision(config) !== revisions[index])) throw new DailyBriefError("context_changed");
        if (!signal.aborted) {
          if (account) await raceBriefAbort(account.assertCurrent(), signal);
          if (saved && caller && preferences) await assertSavedCaseAuthorized(caller, preferences, saved.case, signal);
        }
        const source = saved?.case.source;
        if (!options.reservation) reservation.close();
        return { mode: saved ? "saved" : accountMode ? "account" : "synthetic", accountRef: ownerRef,
          preferenceRevision: preferences?.revision ?? null, capturedAt: contexts[0].capturedAt, expiresAt: contexts[0].expiresAt,
          fixtureId: source?.mode === "account" || accountMode ? null : fixtureId, fixtureVersion: source?.mode === "account" || accountMode ? null : BRIEFING_FIXTURE_VERSION,
          analysisFixtureId: source?.mode === "account" || accountMode ? null : analysisFixtureId ?? null, analysisFixtureVersion: source?.mode === "account" || accountMode ? null : BRIEFING_ANALYSIS_FIXTURE_VERSION,
          model: DAILY_BRIEF_MODEL, promptRevision: DAILY_BRIEF_PROMPT_REVISION, usage: "unavailable", results,
          cancelled: signal.aborted, dispatchedCalls: reservation.used, budget: briefingBenchBudget().snapshot(),
          ...(review ? { review: { caseId: review.caseId, saved: persisted === true && runIds.length === results.length, runIds, candidateIds: review.candidates.map((candidate) => candidate.id) } } : {}) };
      } finally { if (!options.reservation) reservation.close(); }
    };
    const needsAccount = accountMode || (savedMode && value.accountRef !== null);
    return needsAccount ? await runDailyBriefRequest(request, caller => compare(caller)) : json(await compare());
  } catch (error) {
    const code = error instanceof BriefingConfigValidationError || error instanceof SyntaxError ? "invalid_request" : error instanceof DailyBriefError ? error.code : "invalid_or_cancelled_request";
    return json({ error: code, ...(RECOVERY[code] ? { recovery: RECOVERY[code] } : {}) }, code === "comparison_limit" || code === "comparison_in_progress" ? 429 : code === "case_not_found" ? 404 : 400);
  }
}

const RECOVERY: Record<string, string> = {
  review_only: "This case saved no inputs. Run a new comparison to compare again.",
  input_not_captured: "This case did not capture every input this configuration needs. Run a new comparison instead.",
  fixture_changed: "The synthetic fixture changed since this case was saved. Run a new comparison instead.",
  case_not_found: "The saved case is gone. It may have expired or been deleted.",
};

export function parseReview(value: unknown, count: number): ReviewInput {
  const text = (item: unknown, max: number, empty = false) => typeof item === "string" && item.length <= max && (empty || item.trim().length > 0);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DailyBriefError("invalid_request");
  const review = value as Record<string, unknown>;
  if (Object.keys(review).sort().join() !== "candidates,caseId" || !isBenchId(review.caseId) || !Array.isArray(review.candidates) || review.candidates.length !== count) throw new DailyBriefError("invalid_request");
  const candidates = review.candidates.map((item: unknown) => {
    const candidate = item as Record<string, unknown>;
    if (!candidate || typeof candidate !== "object" || Object.keys(candidate).sort().join() !== "id,label,parentCandidateId,proposalId,rationale,role" ||
        !isBenchId(candidate.id) || !text(candidate.label, 80) || (candidate.role !== "baseline" && candidate.role !== "candidate") ||
        !(candidate.parentCandidateId === null || isBenchId(candidate.parentCandidateId)) || !(candidate.proposalId === null || isBenchId(candidate.proposalId)) ||
        !text(candidate.rationale, 2000, true)) throw new DailyBriefError("invalid_request");
    return candidate as ReviewCandidateInput;
  });
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) throw new DailyBriefError("invalid_request");
  return { caseId: review.caseId as string, candidates };
}

type ReviewStart = Readonly<{
  saved: BenchCase | null;
  configs: readonly BriefingConfig[];
  revisions: readonly string[];
  contexts: readonly AdvisorDayContextV1[];
  source: BenchCase["source"];
  capture: BenchCase["capture"] | null;
  inputs: BenchCase["inputs"] | null;
}>;

/** Saves the case (new comparisons) and any new candidates. A storage failure leaves results visible and unsaved. */
async function startReview(store: BriefingBenchStore, partition: BenchPartition, review: ReviewInput, input: ReviewStart): Promise<boolean> {
  const createdAt = new Date().toISOString();
  try {
    if (!input.saved) {
      const first = input.contexts[0]!;
      const titles = new Map<string, string>();
      for (const context of input.contexts) for (const item of context.cadence.occurrences) titles.set(item.behaviorRef, item.title);
      const inputs = input.inputs && Buffer.byteLength(JSON.stringify(input.inputs), "utf8") <= BRIEFING_BENCH_MAX_INPUT_BYTES ? input.inputs : undefined;
      await store.createCase(partition, {
        schemaVersion: BRIEFING_BENCH_SCHEMA_VERSION, kind: "case", id: review.caseId, createdAt, source: input.source,
        evidenceType: input.source.mode === "account" ? "captured" : "synthetic",
        localDate: first.localDate, timezone: first.timezone, capturedAt: first.capturedAt, expiresAt: first.expiresAt,
        capture: input.capture ?? { historyDays: [], includeCalendar: false, calendarDisclosed: false, includeRecordedElapsedDurations: false, includeHistoricalCompletionTimes: false,
          analysis: false, includeReminders: false, remindersDisclosed: false, includeNotes: false, notesDisclosed: false },
        ...(inputs ? { inputs } : {}),
        behaviorTitles: [...titles].map(([ref, title]) => ({ ref, title })),
      });
    }
    const existing = input.saved ? (await store.readCase(partition, review.caseId)).candidates : [];
    for (const [index, candidate] of review.candidates.entries()) {
      const previous = existing.find((item) => item.id === candidate.id);
      if (previous && (previous.configurationRevision !== input.revisions[index] || previous.label !== candidate.label.trim() ||
          previous.role !== candidate.role || previous.parentCandidateId !== candidate.parentCandidateId ||
          previous.proposalId !== candidate.proposalId || previous.rationale !== candidate.rationale.trim())) throw new DailyBriefError("invalid_request");
      if (previous) continue;
      const record: BenchCandidate = { schemaVersion: BRIEFING_BENCH_SCHEMA_VERSION, kind: "candidate", id: candidate.id, caseId: review.caseId, createdAt,
        label: candidate.label.trim(), role: candidate.role, parentCandidateId: candidate.parentCandidateId, proposalId: candidate.proposalId,
        rationale: candidate.rationale.trim(), config: input.configs[index]!, configurationRevision: input.revisions[index]! };
      await store.append(partition, review.caseId, "candidates", record);
    }
    return true;
  } catch (error) {
    if (error instanceof DailyBriefError) throw error;
    return false;
  }
}

/** Saved inputs support a configuration only when the capture read everything it needs. */
export function replaySavedCase(saved: BenchCase, configs: readonly BriefingConfig[]) {
  if (saved.source.mode === "synthetic" && !saved.inputs) {
    if (saved.source.fixtureVersion !== BRIEFING_FIXTURE_VERSION || saved.source.analysisFixtureVersion !== BRIEFING_ANALYSIS_FIXTURE_VERSION) throw new DailyBriefError("fixture_changed");
    return null;
  }
  if (!saved.inputs) throw new DailyBriefError("review_only");
  const capture = saved.capture;
  const inputs = saved.inputs;
  const contexts = configs.map((config) => {
    const context = inputs.contexts.find((item) => item.cadence.history.lookbackDays === config.scope.historyDays);
    const lanes = config.analysis.lanes;
    if (!context || (!saved.history && ((config.context.includeRecordedElapsedDurations && !capture.includeRecordedElapsedDurations) ||
        (config.context.includeHistoricalCompletionTimes && !capture.includeHistoricalCompletionTimes) ||
        (config.scope.includeCalendar && capture.calendarDisclosed && !capture.includeCalendar) ||
        (lanes.length > 0 && !capture.analysis) ||
        (lanes.includes("reminder-effectiveness") && capture.remindersDisclosed && !capture.includeReminders) ||
        (lanes.includes("notes-failure-themes") && capture.notesDisclosed && !capture.includeNotes)))) throw new DailyBriefError("input_not_captured");
    return context;
  });
  return {
    contexts,
    analysisSource: inputs.analysisSource,
    configs: saved.source.mode === "synthetic" ? configs : configs.map((config) => accountConfig(config, inputs.configurationRefs, saved.history ? capture.calendarDisclosed : capture.includeCalendar)),
  };
}

/** A frozen case still needs today's consent: same owner, enabled briefing, its disclosed sources, and its Behaviors. */
export async function assertSavedCaseAuthorized(caller: CalendarCaller, preferences: DailyBriefPreferences, saved: BenchCase, signal: AbortSignal): Promise<void> {
  if (saved.source.mode !== "account" || saved.source.accountRef !== briefingAccountRef(caller.user.id)) throw new DailyBriefError("access_denied");
  const current = await readDailyBriefPreferences(caller.client, signal);
  if (!current.enabled || current.revision !== preferences.revision ||
      (saved.capture.includeCalendar && !current.includeCalendar) ||
      (saved.capture.includeReminders && !current.includeReminderHistory) ||
      (saved.capture.includeNotes && !current.includeNotes)) throw new DailyBriefError("access_denied");
  if (saved.capture.includeCalendar) {
    const connection = await getCalendarConnection(caller);
    if (connection.status !== "connected" || connection.generation !== current.calendarConnectionGeneration ||
        connection.selectionRevision !== current.calendarSelectionRevision) throw new DailyBriefError("access_denied");
    const contexts = saved.inputs?.contexts;
    if (!contexts?.length || contexts.some(context => !context.connectors.some(connector =>
      connector.source === "google_calendar" && connector.state !== "not_requested" &&
      connector.connectionGeneration === connection.generation && connector.selectionRevision === connection.selectionRevision))) {
      throw new DailyBriefError("context_changed");
    }
  }
  const behaviors = new Set((await listDailyBriefBehaviorIds(caller.client, caller.user.id, signal)).map((id) => workbenchBehaviorRef(caller.user.id, id)));
  // A Behavior deleted or archived since capture withdraws the case from reruns.
  if (Object.keys(saved.inputs?.configurationRefs ?? {}).some((ref) => !behaviors.has(ref))) throw new DailyBriefError("context_changed");
}

function accountConfig(config: BriefingConfig, refs: Record<string, string>, calendarDisclosed: boolean): BriefingConfig {
  const mapRef = (ref: string) => { if (!refs[ref]) throw new DailyBriefError("invalid_request"); return refs[ref]; };
  return parseBriefingConfig({ ...config, scope: { ...config.scope, includeCalendar: config.scope.includeCalendar && calendarDisclosed,
    behaviorRefs: config.scope.behaviorRefs === "all" ? "all" : config.scope.behaviorRefs.map(mapRef) },
    planner: { ...config.planner, movableBehaviorRefs: config.planner.movableBehaviorRefs.map(mapRef) } });
}

export async function readComparisonBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new DailyBriefError("invalid_request");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try { for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 32_768) throw new DailyBriefError("invalid_request");
    chunks.push(chunk.value);
  } } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Stable local fingerprints across evaluation days; never reads production tip history. */
export function benchTipFingerprint(finding: BriefingFinding): string {
  return createHash("sha256").update(JSON.stringify([finding.laneId, finding.behaviorRef, finding.key, finding.evidenceBand])).digest("hex");
}

/** Normalize capture-specific references to the stable local Behavior reference. */
export function benchCaseFingerprint(saved?: BenchCase) {
  const refs = new Map(Object.entries(saved?.inputs?.configurationRefs ?? {}).map(([stable, captured]) => [captured, stable]));
  return (finding: BriefingFinding) => benchTipFingerprint({ ...finding, behaviorRef: finding.behaviorRef ? refs.get(finding.behaviorRef) ?? finding.behaviorRef : null });
}
