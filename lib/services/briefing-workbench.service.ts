import { BRIEFING_ANALYSIS_FIXTURE_IDS, BRIEFING_ANALYSIS_FIXTURE_VERSION, briefingAnalysisFixture, type BriefingAnalysisFixtureId } from "./briefing-analysis-fixtures";
import { Temporal } from "@js-temporal/polyfill";
import { BriefingConfigValidationError, parseBriefingConfig } from "@cadence/core/services/briefing-config";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import { authRequestUrl } from "@/lib/auth/redirects";
import { listBriefingWorkbenchBehaviors, readDailyBriefPreferences } from "@/lib/db/daily-brief.repo";
import { briefingFixture, BRIEFING_FIXTURE_IDS, BRIEFING_FIXTURE_VERSION, type BriefingFixtureId } from "./briefing-fixtures";
import { briefingConfigurationRevision, prepareBriefing } from "./briefing-pipeline";
import { generateDailyBrief, DailyBriefError, raceBriefAbort, type DailyBriefGenerator } from "./daily-brief-consumer";
import { DAILY_BRIEF_MODEL, generateOpenAIDailyBrief } from "./daily-brief-openai";
import { runDailyBriefRequest } from "./daily-brief-request";
import { getDailyBriefSettings } from "./daily-brief.service";
import { briefingAccountRef, prepareAccountBriefingContexts, workbenchBehaviorRef } from "./briefing-account-context.service";
import type { CalendarCaller } from "./google-calendar.service";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: {
  "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
} });
function guard(request: Request): Response | null {
  if (process.env.NODE_ENV !== "development") return json({ error: "not_found" }, 404);
  const url = authRequestUrl(request), origin = request.headers.get("origin");
  if (!/^https?:$/.test(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !/^43(?:2[1-9]|30)$/.test(url.port) || request.headers.get("sec-fetch-site") !== "same-origin" ||
      (request.method === "POST" ? origin !== url.origin || request.headers.get("content-type") !== "application/json" : origin !== null && origin !== url.origin)) {
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

// ponytail: process-local budget for a loopback-only development tool; use shared admission if hosted tooling is ever authorized.
let inFlight = false;
let starts: number[] = [];
export async function runBriefingComparison(request: Request, generate?: DailyBriefGenerator): Promise<Response> {
  const denied = guard(request);
  if (denied) return denied;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
  try {
    const value = await raceBriefAbort(readComparisonBody(request), signal);
    const accountMode = value?.mode === "account";
    const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort().join() : "";
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        (accountMode ? keys !== "accountRef,configs,mode,preferenceRevision" : keys !== "configs,fixtureId" && keys !== "analysisFixtureId,configs,fixtureId") ||
        (!accountMode && !BRIEFING_FIXTURE_IDS.includes(value.fixtureId)) ||
        (!accountMode && value.analysisFixtureId !== undefined && !BRIEFING_ANALYSIS_FIXTURE_IDS.includes(value.analysisFixtureId)) ||
        (accountMode && (typeof value.accountRef !== "string" || value.accountRef.length > 128 || !Number.isSafeInteger(value.preferenceRevision) || value.preferenceRevision < 0)) ||
        !Array.isArray(value.configs) || value.configs.length !== 2) throw new DailyBriefError("invalid_request");
    const configs = value.configs.map(parseBriefingConfig) as BriefingConfig[];
    if (!generate && !process.env.OPENAI_API_KEY) return json({ error: "not_configured" }, 503);
    const compare = async (caller?: CalendarCaller) => {
      signal.throwIfAborted();
      if (caller && briefingAccountRef(caller.user.id) !== value.accountRef) throw new DailyBriefError("context_changed");
      const preferences = caller ? await readDailyBriefPreferences(caller.client, signal) : undefined;
      if (preferences && (!preferences.enabled || preferences.revision !== value.preferenceRevision)) throw new DailyBriefError("access_denied");
      const startedAt = Date.now();
      starts = starts.filter((start) => startedAt - start < 60 * 60 * 1000);
      if (inFlight) throw new DailyBriefError(caller ? "rate_limited" : "comparison_in_progress", 1);
      if (starts.length >= 6) throw new DailyBriefError(caller ? "rate_limited" : "comparison_limit", 3600);
      inFlight = true; starts.push(startedAt);
      try {
        const account = caller ? await raceBriefAbort(prepareAccountBriefingContexts(caller, {
          historyDays: configs.map(config => config.scope.historyDays), includeCalendar: configs.some(config => config.scope.includeCalendar), signal, preferences,
          includeRecordedElapsedDurations: configs.some(config => config.context.includeRecordedElapsedDurations),
          includeHistoricalCompletionTimes: configs.some(config => config.context.includeHistoricalCompletionTimes),
          ...(configs.some(config => config.analysis.lanes.length) ? { analysis: {
            includeReminders: configs.some(config => config.analysis.lanes.includes("reminder-effectiveness")),
            includeNotes: configs.some(config => config.analysis.lanes.includes("notes-failure-themes")),
          } } : {}),
        }), signal) : null;
        const contexts = account?.contexts ?? configs.map(config => briefingFixture(value.fixtureId as BriefingFixtureId, config));
        const effectiveConfigs = account ? configs.map(config => accountConfig(config, account.configurationRefs, account.preferences.includeCalendar)) : configs;
        const revisions = effectiveConfigs.map(briefingConfigurationRevision);
        const results = [];
        for (const [index, config] of effectiveConfigs.entries()) {
          signal.throwIfAborted();
          if (account) await raceBriefAbort(account.assertCurrent(), signal);
          const context = contexts[index], captured = Temporal.Instant.from(context.capturedAt);
          // Workbench runs never read or record tip history, so comparisons share the same frozen facts.
          const analysis = { source: account ? account.analysisSource : value.analysisFixtureId ? briefingAnalysisFixture(value.analysisFixtureId as BriefingAnalysisFixtureId, context) : null };
          const prepared = prepareBriefing(context, config, context.capturedAt, analysis);
          const start = Date.now();
          try {
            const modelSignal = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
            const briefing = await generateDailyBrief(context, { config, signal: modelSignal, analysis,
              planningNow: context.capturedAt, now: account ? () => Temporal.Now.instant() : () => captured,
              generate: generate ?? ((input) => generateOpenAIDailyBrief(input, { apiKey: process.env.OPENAI_API_KEY! })) });
            results.push({ state: "ready", briefing, inspector: prepared, latencyMs: Date.now() - start, validation: "passed" });
          } catch (error) {
            signal.throwIfAborted();
            results.push({ state: "error", error: error instanceof DailyBriefError ? error.code : "generation_failed", inspector: prepared, latencyMs: Date.now() - start, validation: "withheld" });
          }
          signal.throwIfAborted();
          if (account) await raceBriefAbort(account.assertCurrent(), signal);
        }
        if (effectiveConfigs.some((config, index) => briefingConfigurationRevision(config) !== revisions[index])) throw new DailyBriefError("context_changed");
        if (account) await raceBriefAbort(account.assertCurrent(), signal);
        signal.throwIfAborted();
        return { mode: accountMode ? "account" : "synthetic", accountRef: caller ? briefingAccountRef(caller.user.id) : null,
          preferenceRevision: preferences?.revision ?? null, capturedAt: contexts[0].capturedAt, expiresAt: contexts[0].expiresAt,
          fixtureId: accountMode ? null : value.fixtureId, fixtureVersion: accountMode ? null : BRIEFING_FIXTURE_VERSION,
          analysisFixtureId: accountMode ? null : value.analysisFixtureId ?? null, analysisFixtureVersion: accountMode ? null : BRIEFING_ANALYSIS_FIXTURE_VERSION,
          model: DAILY_BRIEF_MODEL, usage: "unavailable", results };
      } finally { inFlight = false; }
    };
    return accountMode ? await runDailyBriefRequest(request, caller => raceBriefAbort(compare(caller), signal)) : json(await compare());
  } catch (error) {
    const code = error instanceof BriefingConfigValidationError || error instanceof SyntaxError ? "invalid_request" : error instanceof DailyBriefError ? error.code : "invalid_or_cancelled_request";
    return json({ error: code }, code === "comparison_limit" || code === "comparison_in_progress" ? 429 : 400);
  }
}

function accountConfig(config: BriefingConfig, refs: Record<string, string>, calendarDisclosed: boolean): BriefingConfig {
  const mapRef = (ref: string) => { if (!refs[ref]) throw new DailyBriefError("invalid_request"); return refs[ref]; };
  return parseBriefingConfig({ ...config, scope: { ...config.scope, includeCalendar: config.scope.includeCalendar && calendarDisclosed,
    behaviorRefs: config.scope.behaviorRefs === "all" ? "all" : config.scope.behaviorRefs.map(mapRef) },
    planner: { ...config.planner, movableBehaviorRefs: config.planner.movableBehaviorRefs.map(mapRef) } });
}

async function readComparisonBody(request: Request) {
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
