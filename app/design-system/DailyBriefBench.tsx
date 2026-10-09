"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import { DAILY_BRIEF_POLICY_VERSION, type DailyBriefing, type DailyBriefSettings } from "@cadence/core/types/daily-brief";
import { BRIEFING_PRESETS, DEFAULT_BRIEFING_CONFIG, parseBriefingConfig } from "@cadence/core/services/briefing-config";
import { BRIEFING_REFERENCES } from "@cadence/core/services/briefing-references";
import { BRIEFING_FIXTURE_IDS, BRIEFING_FIXTURE_VERSION, type BriefingFixtureId } from "@/lib/services/briefing-fixtures";
import { BRIEFING_ANALYSIS_FIXTURE_IDS, BRIEFING_ANALYSIS_FIXTURE_VERSION, type BriefingAnalysisFixtureId } from "@/lib/services/briefing-analysis-fixtures";
import { BRIEFING_ANALYSIS_LANES } from "@cadence/core/resolvers/briefing-analysis.resolver";
type Account = { settings: DailyBriefSettings; behaviors: { ref: string; title: string }[] };
type Comparison = { mode?: 'account' | 'synthetic'; accountRef?: string; preferenceRevision?: number; capturedAt?: string; expiresAt?: string; model: string; fixtureVersion: string | null; usage: string; results: { state: 'ready' | 'error'; briefing?: DailyBriefing; error?: string; inspector: unknown; latencyMs: number; validation: string }[] };

async function fetchAccount(signal: AbortSignal): Promise<Account> {
  const response = await fetch('/api/dev/briefing-comparison', { signal, cache: 'no-store', credentials: 'same-origin' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'account_unavailable');
  return body;
}

import type { DailyBriefClient } from "@/lib/ui/daily-brief";
import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";
import { DailyBriefSettingsPanel } from "@/components/briefing/DailyBriefSettingsPanel";
import { BriefingWorkbenchGuide } from "./BriefingWorkbenchGuide";

const client: DailyBriefClient = {
  preferences: async () => ({ accountRef: "bench-account", available: true, enabled: true, includeCalendar: false, revision: 1, localDate: "2026-09-20", timezone: "America/New_York" }),
  updatePreferences: async (input) => ({ accountRef: "bench-account", available: true, revision: 2, localDate: "2026-09-20", timezone: "America/New_York", ...input }),
  requestBrief: async () => ({ state: "already_attempted" }),
};

export function DailyBriefBubbleBench() {
  return <div className="bg-background"><div className="aspect-[1423/367] w-full overflow-hidden bg-background sm:aspect-[2041/239]"><picture className="block h-full w-full"><source media="(max-width: 639px)" srcSet="/brand/cadence-timeline-horse-lines-dots-mobile-right-18.png" /><img src="/brand/cadence-timeline-horse-lines-dots-clear-background.png" width={2041} height={239} alt="" aria-hidden="true" className="block h-full w-full object-fill" /></picture></div><div className="relative mx-auto w-full max-w-6xl px-3 sm:px-6 lg:px-10"><DailyBriefBubble state="ready" onDismiss={() => undefined} briefing={{
    text: `Your midday walk overlaps a fixed commitment. ${"schedule".repeat(260)}`, localDate: "2026-09-20", timezone: "America/New_York",
    generatedAt: "2026-09-20T12:00:00Z", expiresAt: "2999-09-20T16:00:00Z", coverage: "partial", warnings: ["Suggestions only. No changes were applied."],
  }} /></div><div className="mx-auto grid max-w-6xl gap-10 px-3 pt-10 sm:px-6 lg:px-10"><DailyBriefBubble state="error" message="Your Timeline changed after this brief was prepared." retryLabel="Refresh brief" onRetry={() => undefined} onDismiss={() => undefined} /><DailyBriefBubble state="error" message="Daily Brief is busy. Try again in about 30 seconds." onRetry={() => undefined} retryDisabled onDismiss={() => undefined} /></div><div className="mx-auto max-w-6xl px-3 py-8 sm:px-6 lg:px-10"><button type="button" className="product-action product-action-primary min-h-11 py-2 text-sm">Completed</button><button type="button" className="product-action product-action-secondary ml-3 min-h-11 py-2 text-sm">Not Completed</button></div></div>;
}

type InspectorAnalysis = { result?: { lanes?: { laneId: string; state: string; reason: string | null }[]; findings?: { id: string; relevantToday: boolean; materiality: number }[] }; selection?: { tipId: string | null; decisions?: { findingId: string; decision: string }[] } } | null;

/** Readable lane states and tip selection reasons beside each candidate output. */
function AnalysisSummary({ inspector }: { inspector: unknown }) {
  const analysis = (inspector && typeof inspector === 'object' ? (inspector as { analysis?: InspectorAnalysis }).analysis : null) ?? null;
  if (!analysis?.result) return <p className="text-sm">Analysis: no lanes selected.</p>;
  return <div className="text-sm" aria-label="Analysis findings and selection">
    <p className="font-bold">Analysis</p>
    <ul>{(analysis.result.lanes ?? []).filter((lane) => lane.state !== 'not_selected').map((lane) => <li key={lane.laneId}>{lane.laneId}: {lane.state.replaceAll('_', ' ')}{lane.reason ? ` (${lane.reason.replaceAll('_', ' ')})` : ''}</li>)}</ul>
    <p>Tip: {analysis.selection?.tipId ?? 'none offered'}</p>
    {analysis.selection?.decisions?.length ? <ul>{analysis.selection.decisions.map((item) => <li key={item.findingId}>{item.findingId}: {item.decision.replaceAll('_', ' ')}</li>)}</ul> : null}
  </div>;
}

export function DailyBriefSettingsBench() {
  return <DailyBriefSettingsPanel client={client} />;
}

/** Internal controls only; drafts and review notes never activate the hosted preset. */
export function DailyBriefWorkbench({ repositoryRoot = "" }: { repositoryRoot?: string }) {
  const [configs, setConfigs] = useState<BriefingConfig[]>([DEFAULT_BRIEFING_CONFIG, BRIEFING_PRESETS[1]?.config ?? DEFAULT_BRIEFING_CONFIG]);
  const [fixtureId, setFixtureId] = useState<BriefingFixtureId>("sparse");
  const [analysisFixtureId, setAnalysisFixtureId] = useState<BriefingAnalysisFixtureId>("none");
  const [mode, setMode] = useState<'synthetic' | 'account'>('synthetic');
  const [account, setAccount] = useState<Account | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accessVersion, setAccessVersion] = useState(0);
  const [result, setResult] = useState<Comparison | null>(null);
  const [snapshotExpired, setSnapshotExpired] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<BriefingConfig | null>(null);
  const [jsonDraft, setJsonDraft] = useState("");
  const [notes, setNotes] = useState("");
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => () => request.current?.abort(), []);
  const invalidate = useCallback(() => {
    generation.current++;
    request.current?.abort();
    setRunning(false); setResult(null); setSnapshotExpired(false); setError(""); setNotes("");
  }, []);
  useEffect(() => {
    if (mode !== 'account') return;
    let active = true;
    let controller: AbortController | null = null;
    let previous: Account | null = null;
    const clear = () => {
      controller?.abort(); previous = null; invalidate(); setAccount(null); setJsonDraft('');
      setConfigs(current => current.map(config => ({ ...config, scope: { ...config.scope, behaviorRefs: 'all' }, planner: { ...config.planner, movableBehaviorRefs: [] } })));
    };
    const refresh = async () => {
      controller?.abort(); setAccountLoading(true); controller = new AbortController();
      const current = controller;
      try {
        const value = await fetchAccount(current.signal);
        if (active && !current.signal.aborted) {
          if (previous && JSON.stringify(previous.settings) !== JSON.stringify(value.settings)) clear();
          previous = value; setAccount(value);
        }
      } catch (failure) {
        if (active && !current.signal.aborted) { clear(); setError(failure instanceof Error ? failure.message : 'account_unavailable'); }
      } finally { if (active && controller === current) setAccountLoading(false); }
    };
    const visibility = () => { if (document.hidden) clear(); else void refresh(); };
    const focus = () => { void refresh(); };
    void refresh();
    window.addEventListener('focus', focus);
    window.addEventListener('pagehide', clear); document.addEventListener('visibilitychange', visibility);
    return () => { active = false; controller?.abort(); invalidate();
      window.removeEventListener('focus', focus);
      window.removeEventListener('pagehide', clear); document.removeEventListener('visibilitychange', visibility); };
  }, [mode, accessVersion, invalidate]);
  useEffect(() => {
    if (result?.mode !== 'account' || !result.expiresAt) return;
    const timer = setTimeout(() => setSnapshotExpired(true), Math.max(0, Date.parse(result.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [result]);
  function switchMode(value: 'synthetic' | 'account') {
    invalidate(); setAccount(null); setJsonDraft(''); setSaved(null);
    setConfigs(current => current.map(config => ({ ...config, scope: { ...config.scope, behaviorRefs: 'all' }, planner: { ...config.planner, movableBehaviorRefs: [] } })));
    setMode(value);
  }
  function change(index: number, config: BriefingConfig) {
    invalidate();
    try { const validated = parseBriefingConfig(config); setConfigs((current) => current.map((entry, i) => i === index ? validated : entry)); }
    catch { setError("Configuration is invalid. Check the bounds and selected behaviors."); }
  }
  async function run() {
    if (mode === 'account' && (!account?.settings.enabled || !account.settings.available)) return;
    invalidate();
    const version = generation.current;
    const controller = new AbortController(); request.current = controller; setRunning(true);
    try {
      const response = await fetch("/api/dev/briefing-comparison", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === 'account' ? { mode, configs, accountRef: account!.settings.accountRef, preferenceRevision: account!.settings.revision } : { fixtureId, configs, ...(analysisFixtureId === 'none' ? {} : { analysisFixtureId }) }), signal: controller.signal, cache: "no-store", credentials: 'same-origin' });
      const body = await response.json();
      if (version !== generation.current) return;
      if (!response.ok) throw new Error(`${body.error ?? "comparison_failed"}${typeof body.recovery === 'string' ? `. ${body.recovery}` : ''}`);
      if (mode === 'account') {
        const current = await fetchAccount(controller.signal);
        if (version !== generation.current) return;
        if (body.mode !== 'account' || current.settings.accountRef !== body.accountRef || current.settings.accountRef !== account?.settings.accountRef ||
            !current.settings.enabled || current.settings.revision !== body.preferenceRevision || current.settings.revision !== account?.settings.revision ||
            current.settings.localDate !== account?.settings.localDate || current.settings.timezone !== account?.settings.timezone ||
            !body.expiresAt || Date.parse(body.expiresAt) <= Date.now()) throw new Error('context_changed');
      }
      setResult(body);
    } catch (failure) { if (version === generation.current) {
      if (mode === 'account') { setAccount(null); setJsonDraft(''); setConfigs(current => current.map(config => ({ ...config, scope: { ...config.scope, behaviorRefs: 'all' }, planner: { ...config.planner, movableBehaviorRefs: [] } }))); }
      setError(failure instanceof Error ? failure.message : "comparison_failed");
    } }
    finally { if (version === generation.current) setRunning(false); }
  }
  function save(index: number) {
    if (mode === 'account') return;
    try { const config = parseBriefingConfig(configs[index]); localStorage.setItem("cadence.briefing-workbench.config.v1", JSON.stringify(config)); setSaved(config); setError(""); }
    catch { setError("The configuration draft could not be saved."); }
  }
  function loadSaved(index: number) {
    try { change(index, parseBriefingConfig(JSON.parse(localStorage.getItem("cadence.briefing-workbench.config.v1") ?? "null"))); }
    catch { setError("No valid saved configuration is available."); }
  }
  function exportConfig(index: number) {
    if (mode === 'account') return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(parseBriefingConfig(configs[index]), null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "cadence-briefing-config.json"; link.click(); URL.revokeObjectURL(url);
  }
  return <main className="mx-auto min-h-dvh max-w-7xl space-y-6 px-4 py-8 text-neutral-950" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
    <header className="space-y-2"><a href="/design-system" className="underline">Design system</a><h1 className="text-2xl">Briefing workbench</h1>
      <p><a className="underline" href="#briefing-term-config.recipe">Recipe: Daily Brief</a> · {configs[0].recipe.version} · Policy {DAILY_BRIEF_POLICY_VERSION}</p>
      <p>Practical day constraints and supported opportunities. Completion inputs never authorize ledger recaps.</p>
      <p>Compare configurations against one frozen snapshot. Saving a draft never activates it.</p>
      <p className="text-sm">Two sequential attempts per comparison; six comparisons per server hour. Comparisons do not use the daily briefing allowance.</p>
    </header>
    <BriefingWorkbenchGuide repositoryRoot={repositoryRoot} />
    <label className="block">Context source<select aria-label="Context source" className="ml-3 min-h-11 border p-2" value={mode} onChange={event => switchMode(event.target.value as 'synthetic' | 'account')}><option value="synthetic">Synthetic</option><option value="account">My account</option></select></label>
    {mode === 'synthetic' ? <><label className="block">Synthetic snapshot<select className="ml-3 min-h-11 border p-2" value={fixtureId} onChange={(event) => { invalidate(); setFixtureId(event.target.value as BriefingFixtureId); }}>{BRIEFING_FIXTURE_IDS.map((id) => <option key={id} value={id}>{id.replaceAll("_", " ")}</option>)}</select></label>
      <label className="block">Analysis scenario<select aria-label="Analysis scenario" className="ml-3 min-h-11 border p-2" value={analysisFixtureId} onChange={(event) => { invalidate(); setAnalysisFixtureId(event.target.value as BriefingAnalysisFixtureId); }}>{BRIEFING_ANALYSIS_FIXTURE_IDS.map((id) => <option key={id} value={id}>{id.replaceAll("_", " ")}</option>)}</select></label>
      <p className="text-sm">Model runs send only synthetic fixtures to OpenAI. Frozen clock: 2026-11-01 07:00 America/New_York. Fixture {BRIEFING_FIXTURE_VERSION}; analysis {BRIEFING_ANALYSIS_FIXTURE_VERSION}. Comparisons never read or record tip history.</p></> : <div className="space-y-2 text-sm" aria-label="Account comparison access">
      <p>Run comparison sends your authorized hosted Behavior facts and selected references to OpenAI. Calendar timing is sent only when enabled here and in Settings. Provider retention still applies.</p>
      <p>Local-only and unsynced desktop records are absent. Private results and Behavior selections clear when you leave this tab. Save and export are available in Synthetic mode.</p>
      {accountLoading ? <p role="status">Checking account access…</p> : !account ? <a className="mr-4 inline-flex min-h-11 items-center underline" href="/login?next=%2Fdesign-system%3Fpreview%3Dbriefing-workbench">Sign in to My account</a> : <>
        <p>{account.settings.enabled ? `Briefing access enabled · ${account.settings.timezone}` : 'Enable Daily Brief in Settings before comparing account data.'}</p>
        {!account.settings.available ? <p>Model generation is not configured on this server.</p> : null}
        <p>{account.settings.includeCalendar ? 'Calendar model-data permission is enabled. Each configuration can exclude it.' : 'Calendar model-data permission is off. Calendar will be excluded.'}</p>
      </>}
      <a className="inline-flex min-h-11 items-center underline" href="/settings">Open briefing settings</a>
      <button type="button" className="ml-4 min-h-11 underline" onClick={() => setAccessVersion(value => value + 1)}>Refresh account access</button>
    </div>}
    <div className="grid gap-8 lg:grid-cols-2">{configs.map((config, index) => <section key={index} aria-label={`Configuration ${index + 1}`} className="min-w-0 space-y-4 border-t pt-4">
      <h2 className="text-xl">Configuration {index + 1}</h2>
      <p className="text-sm">Daily Brief · Recipe {config.recipe.version}</p>
      <label className="block">Load preset<select aria-label={`Preset ${index + 1}`} className="ml-3 min-h-11 max-w-full border p-2" value="" onChange={(event) => { const preset = BRIEFING_PRESETS.find((entry) => entry.id === event.target.value); if (preset) change(index, preset.config); }}><option value="">Choose preset</option>{BRIEFING_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
      <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-2">Voice</legend>
        {([['tone', ['calm', 'warm', 'matter_of_fact']], ['directness', ['gentle', 'balanced', 'direct']], ['encouragement', ['low', 'moderate', 'high']]] as const).map(([field, values]) => <label key={field} className="grid gap-1">{field}<select aria-label={`${field} ${index + 1}`} className="min-h-11 border p-2" value={config[field]} onChange={(event) => change(index, { ...config, [field]: event.target.value })}>{values.map((value) => <option key={value}>{value}</option>)}</select></label>)}
        <label className="grid gap-1">Maximum words<input aria-label={`Maximum words ${index + 1}`} className="min-h-11 w-full border p-2" type="number" min={40} max={180} value={config.length.maxWords} onChange={(event) => change(index, { ...config, length: { maxWords: Number(event.target.value) } })} /></label>
      </fieldset>
      <fieldset className="space-y-2 border-t pt-3"><legend>Scope</legend>
        <label className="flex min-h-11 items-center gap-2">History days<input aria-label={`History days ${index + 1}`} className="w-20 border p-2" type="number" min={1} max={90} value={config.scope.historyDays} onChange={(event) => change(index, { ...config, scope: { ...config.scope, historyDays: Number(event.target.value) } })} /></label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={mode === 'account' && !account?.settings.includeCalendar} checked={config.scope.includeCalendar && (mode === 'synthetic' || !!account?.settings.includeCalendar)} onChange={(event) => change(index, { ...config, scope: { ...config.scope, includeCalendar: event.target.checked } })} />Include available Calendar context</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={config.scope.behaviorRefs === "all" || (mode === 'synthetic' && config.scope.behaviorRefs.includes("behavior_fixture"))} onChange={(event) => change(index, { ...config, scope: { ...config.scope, behaviorRefs: event.target.checked ? "all" : [] }, planner: { ...config.planner, movableBehaviorRefs: [] } })} />{mode === 'synthetic' ? 'Include synthetic Behavior' : 'All authorized Behaviors'}</label>
        {mode === 'account' && account ? <div className="max-h-48 overflow-auto">{account.behaviors.map(behavior => <label key={behavior.ref} className="flex min-h-11 items-center gap-2 break-words"><input type="checkbox" checked={config.scope.behaviorRefs === 'all' || config.scope.behaviorRefs.includes(behavior.ref)} onChange={event => {
          const selected = config.scope.behaviorRefs === 'all' ? account.behaviors.map(item => item.ref) : config.scope.behaviorRefs;
          change(index, { ...config, scope: { ...config.scope, behaviorRefs: event.target.checked ? [...selected, behavior.ref] : selected.filter(ref => ref !== behavior.ref) }, planner: { ...config.planner, movableBehaviorRefs: config.planner.movableBehaviorRefs.filter(ref => event.target.checked || ref !== behavior.ref) } });
        }} />{behavior.title}</label>)}</div> : null}
      </fieldset>
      <fieldset className="space-y-2 border-t pt-3"><legend>Recipe inputs</legend>
        {([
          ['includeCompletionHistory', 'Completion history', 'config.context.includeCompletionHistory'],
          ['includeHistoricalCompletionTimes', 'Historical completion times', 'config.context.includeHistoricalCompletionTimes'],
          ['includeRecordedElapsedDurations', 'Recorded elapsed durations', 'config.context.includeRecordedElapsedDurations'],
        ] as const).map(([field, label, term]) => <div key={field} className="flex flex-wrap items-center gap-x-3">
          <label className="flex min-h-11 items-center gap-2"><input aria-label={`${label} ${index + 1}`} type="checkbox" checked={config.context[field]} onChange={event => change(index, { ...config, context: { ...config.context, [field]: event.target.checked } })} />{label}</label>
          <a className="inline-flex min-h-11 items-center text-sm underline" href={`#briefing-term-${term}`}>Definition</a>
        </div>)}
        <p className="text-sm">Historical completion times summarize when you marked prior occurrences Completed within History days. Delayed logging limits precision; these are not actual finish times.</p>
        <p className="text-sm">Elapsed inputs are eligible historical totals within History days, not finish times or raw sessions. A selected average can use server-side history even when history and elapsed inputs are excluded.</p>
      </fieldset>
      <fieldset className="space-y-2 border-t pt-3"><legend>Duration sources</legend>
        <p className="text-sm">Only the selected duration reaches the model. Preference and fallback choose among enabled sources.</p>
        {([['includeConfiguredDefault', 'Configured default duration'], ['includeHistoricalAverage', 'Historical average duration']] as const).map(([field, label]) => <div key={field} className="flex flex-wrap items-center gap-x-3">
          <label className="flex min-h-11 items-center gap-2"><input aria-label={`${label} ${index + 1}`} type="checkbox" checked={config.context.duration[field]} onChange={event => change(index, { ...config, context: { ...config.context, duration: { ...config.context.duration, [field]: event.target.checked } } })} />{label}</label>
          <a className="inline-flex min-h-11 items-center text-sm underline" href={`#briefing-term-config.context.duration.${field}`}>Definition</a>
        </div>)}
        <label className="grid gap-1">Preferred duration source<select aria-label={`Preferred duration source ${index + 1}`} className="min-h-11 w-full border p-2" value={config.context.duration.preference} onChange={event => change(index, { ...config, context: { ...config.context, duration: { ...config.context.duration, preference: event.target.value as 'configured_default' | 'historical_average' } } })}><option value="configured_default">Configured default</option><option value="historical_average">Historical average</option></select></label>
        <label className="grid gap-1">If preferred source is unavailable<select aria-label={`Duration fallback ${index + 1}`} className="min-h-11 w-full border p-2" value={config.context.duration.fallback} onChange={event => change(index, { ...config, context: { ...config.context, duration: { ...config.context.duration, fallback: event.target.value as 'other_enabled_source' | 'none' } } })}><option value="other_enabled_source">Use the other enabled source</option><option value="none">Keep duration unknown</option></select></label>
        <p className="text-sm">Historical averages need three eligible Completed Occurrences in the preceding 90 complete local days. Unknown duration cannot prove a fit. <a className="underline" href="#briefing-term-config.context.duration.fallback">Selection and fallback</a></p>
      </fieldset>
      <fieldset className="space-y-2 border-t pt-3"><legend>Analysis lanes</legend>
        <p className="text-sm">Lanes calculate findings; the model only explains one selected tip. Reminder and Note lanes also need their Settings disclosure. <a className="underline" href="#briefing-term-analysis.lane">Lane contract</a></p>
        {BRIEFING_ANALYSIS_LANES.map((lane) => <label key={lane.id} className="flex min-h-11 items-start gap-2"><input className="mt-1" aria-label={`${lane.id} ${index + 1}`} type="checkbox" checked={config.analysis.lanes.includes(lane.id)} onChange={(event) => {
          const lanes = event.target.checked ? [...config.analysis.lanes, lane.id] : config.analysis.lanes.filter((id) => id !== lane.id);
          change(index, { ...config, analysis: { ...config.analysis, lanes, maxTips: lanes.length ? config.analysis.maxTips : 0 } });
        }} /><span>{lane.id}{lane.optionalSource ? ` (needs ${lane.optionalSource} disclosure)` : ""}<small className="block">{lane.question}</small></span></label>)}
        <label className="flex min-h-11 items-center gap-2"><input aria-label={`Allow one pattern tip ${index + 1}`} type="checkbox" disabled={!config.analysis.lanes.length} checked={config.analysis.maxTips === 1} onChange={(event) => change(index, { ...config, analysis: { ...config.analysis, maxTips: event.target.checked ? 1 : 0 } })} />Allow one pattern tip</label>
        <label className="flex min-h-11 items-center gap-2">Tip cooldown days<input aria-label={`Tip cooldown days ${index + 1}`} className="w-20 border p-2" type="number" min={7} max={30} value={config.analysis.cooldownDays} onChange={(event) => change(index, { ...config, analysis: { ...config.analysis, cooldownDays: Number(event.target.value) } })} /></label>
      </fieldset>
      <fieldset className="space-y-2 border-t pt-3"><legend>References</legend>{BRIEFING_REFERENCES.map((source) => <label key={source.id} className="flex min-h-11 items-start gap-2"><input className="mt-1" type="checkbox" checked={config.referenceIds.includes(source.id)} onChange={(event) => change(index, { ...config, referenceIds: event.target.checked ? [...config.referenceIds, source.id] : config.referenceIds.filter((id) => id !== source.id) })} /><span>{source.title}<small className="block">{source.kind.replaceAll("_", " ")}; reviewed {source.reviewedAt}</small></span></label>)}</fieldset>
      <fieldset className="space-y-2 border-t pt-3"><legend>Suggestions and planner</legend>
        <p className="text-sm">The recipe policy takes precedence over these legacy controls. Recap means a concise overview; completion priorities do not permit completion narration.</p>
        {(['recap', 'priority', 'schedule'] as const).map((kind) => <label key={kind} className="mr-4 inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={config.allowedSuggestionTypes.includes(kind)} onChange={(event) => change(index, { ...config, allowedSuggestionTypes: event.target.checked ? [...config.allowedSuggestionTypes, kind] : config.allowedSuggestionTypes.filter((value) => value !== kind) })} />{kind}</label>)}
        <label className="block">First priority<select aria-label={`First priority ${index + 1}`} className="ml-2 min-h-11 border p-2" value={config.priorities[0]} onChange={(event) => change(index, { ...config, priorities: [event.target.value as BriefingConfig['priorities'][number], ...config.priorities.filter((value) => value !== event.target.value)] })}>{(['today_status', 'needs_decision', 'completion_history', 'schedule_fit'] as const).map((priority) => <option key={priority}>{priority}</option>)}</select></label>
        <label className="flex min-h-11 items-center gap-2">Alternatives<input className="w-20 border p-2" type="number" min={1} max={3} value={config.alternatives} onChange={(event) => change(index, { ...config, alternatives: Number(event.target.value) })} /></label>
        <label className="flex min-h-11 items-center gap-2">Buffer minutes<input className="w-20 border p-2" type="number" min={0} max={60} value={config.planner.bufferMinutes} onChange={(event) => change(index, { ...config, planner: { ...config.planner, bufferMinutes: Number(event.target.value) } })} /></label>
        <label className="block">Preference<select className="ml-2 min-h-11 border p-2" value={config.planner.preference} onChange={(event) => change(index, { ...config, planner: { ...config.planner, preference: event.target.value as 'earliest' | 'least_change' } })}><option>earliest</option><option>least_change</option></select></label>
        {mode === 'synthetic' ? <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={config.planner.movableBehaviorRefs.length > 0} onChange={(event) => change(index, { ...config, planner: { ...config.planner, movableBehaviorRefs: event.target.checked ? ['behavior_fixture'] : [] } })} />Allow hypothetical moves for synthetic Behavior</label> : account ? <div className="max-h-48 overflow-auto">{account.behaviors.map(behavior => <label key={behavior.ref} className="flex min-h-11 items-center gap-2 break-words"><input type="checkbox" disabled={config.scope.behaviorRefs !== 'all' && !config.scope.behaviorRefs.includes(behavior.ref)} checked={config.planner.movableBehaviorRefs.includes(behavior.ref)} onChange={event => change(index, { ...config, planner: { ...config.planner, movableBehaviorRefs: event.target.checked ? [...config.planner.movableBehaviorRefs, behavior.ref] : config.planner.movableBehaviorRefs.filter(ref => ref !== behavior.ref) } })} />Allow hypothetical moves: {behavior.title}</label>)}</div> : null}
        <p className="text-sm">Permitted windows: {config.planner.permittedWindows.map((window) => `${window.startMinute}–${window.endMinute}`).join(', ')} local minutes. Edit exact windows in configuration JSON.</p>
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <button className="min-h-11 underline" type="button" onClick={() => change(1 - index, config)}>Duplicate to other side</button>
        <button className="min-h-11 underline disabled:opacity-50" type="button" disabled={mode === 'account'} onClick={() => save(index)}>Save draft</button>
        <button className="min-h-11 underline" type="button" onClick={() => loadSaved(index)}>Load saved draft</button>
        <button className="min-h-11 underline disabled:opacity-50" type="button" disabled={mode === 'account'} onClick={() => exportConfig(index)}>Export configuration</button>
        <button className="min-h-11 underline" type="button" onClick={() => setJsonDraft(JSON.stringify(config, null, 2))}>Edit JSON</button>
      </div>
      <details><summary className="min-h-11 cursor-pointer py-2">Configuration JSON</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(config, null, 2)}</pre></details>
    </section>)}</div>
    <details><summary className="min-h-11 cursor-pointer py-2">Import or edit configuration JSON</summary><label className="block">Configuration only<textarea aria-label="Configuration JSON editor" className="mt-2 h-64 w-full border p-3 font-mono text-xs" value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} /></label>{[0, 1].map((index) => <button key={index} type="button" className="mr-4 min-h-11 underline" onClick={() => { try { change(index, parseBriefingConfig(JSON.parse(jsonDraft))); } catch (failure) { setError(`Invalid configuration JSON. ${failure instanceof Error ? failure.message : 'Unsupported configuration.'}`); } }}>Load into configuration {index + 1}</button>)}</details>
    {saved ? <p role="status">Configuration draft saved locally.</p> : null}
    <div className="flex flex-wrap gap-4 border-t pt-4"><button type="button" disabled={running || (mode === 'account' && (!account?.settings.enabled || !account.settings.available || accountLoading))} className="min-h-11 border px-4 disabled:opacity-50" onClick={run}>{running ? 'Running comparison…' : 'Run comparison'}</button>{running ? <button className="min-h-11 underline" onClick={invalidate}>Cancel comparison</button> : null}</div>
    {error ? <p role="alert">Comparison unavailable: {error}</p> : null}
    {!result ? <details><summary className="min-h-11 cursor-pointer py-2">Static long-text fixture (not model-generated)</summary><DailyBriefBubbleBench /></details> : <>
      <p>Model-generated comparison · {result.model} · {result.mode === 'account' ? `My account · Snapshot ${result.capturedAt}` : result.fixtureVersion} · Usage: {result.usage}. Wording can vary with identical inputs.</p>
      {snapshotExpired ? <p role="status">Snapshot expired. These results remain available for inspection. Run a new comparison for current advice.</p> : null}
      <div className="grid gap-8 lg:grid-cols-2">{result.results.map((entry, index) => <section key={index} className="min-w-0 space-y-4"><h2 className="text-xl">Result {index + 1}</h2><p>{entry.validation}; {entry.latencyMs} ms</p><div className="bg-background pt-10 font-sans"><DailyBriefBubble state={entry.state === 'ready' ? 'ready' : 'error'} briefing={entry.briefing} message={entry.error} onDismiss={() => setResult(null)} /></div><AnalysisSummary inspector={entry.inspector} /><details><summary className="min-h-11 cursor-pointer py-2">Inputs, duration sources, versions and planner inspector</summary><p className="text-sm">Input decisions show exclusions, source selection and sample coverage. Excluded raw values stay absent. Catalog ID validity does not prove support.</p><pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(entry.inspector, null, 2)}</pre></details></section>)}</div>
      <label className="block">Qualitative review notes (memory only)<textarea className="mt-2 min-h-24 w-full border p-3" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    </>}
  </main>;
}
