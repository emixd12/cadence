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
type Comparison = { mode?: 'account' | 'synthetic' | 'saved'; accountRef?: string; preferenceRevision?: number; capturedAt?: string; expiresAt?: string; model: string; promptRevision?: string; fixtureVersion: string | null; usage: string; results: { state: 'ready' | 'error' | 'cancelled'; briefing?: DailyBriefing; error?: string; inspector: unknown; latencyMs: number; validation: string }[] };

async function fetchAccount(signal: AbortSignal): Promise<Account> {
  const response = await fetch('/api/dev/briefing-comparison', { signal, cache: 'no-store', credentials: 'same-origin' });
  const body = await response.json();
  if (!response.ok) throw new Error(`${body.error ?? 'account_unavailable'}${typeof body.recovery === 'string' ? `. ${body.recovery}` : ''}`);
  return body;
}

import type { DailyBriefClient } from "@/lib/ui/daily-brief";
import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";
import { DailyBriefSettingsPanel } from "@/components/briefing/DailyBriefSettingsPanel";
import { BriefingWorkbenchGuide } from "./BriefingWorkbenchGuide";
import { EMPTY_FEEDBACK, FeedbackForm, FeedbackList, ProposalPanel, ReadingColumn, RunDifferences, SavedReviews, type FeedbackDraft, type ViewRun } from "./BriefingReview";
import { BriefingDays } from "./BriefingDays";
import type { BenchCaseDetail, BenchCaseSummary, BenchProposal } from "@/lib/services/briefing-bench-store";

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

export function DailyBriefSettingsBench() {
  return <DailyBriefSettingsPanel client={client} />;
}

type Side = { label: string; rationale: string; parentCandidateId: string | null; proposalId: string | null };
type PublicCase = Omit<BenchCaseDetail["case"], "inputs"> & { rerunnable: boolean };
type CaseDetail = Omit<BenchCaseDetail, "case"> & { case: PublicCase };
type ReviewResponse = { caseId: string; saved: boolean; runIds: string[]; candidateIds: string[] };

const REVIEWS = "/api/dev/briefing-reviews";
const newId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`.toLowerCase();
const clearScopes = (configs: BriefingConfig[]) => configs.map(config => ({ ...config, scope: { ...config.scope, behaviorRefs: 'all' as const }, planner: { ...config.planner, movableBehaviorRefs: [] } }));

async function reviewRequest<T>(input: { method?: 'POST'; query?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const response = await fetch(`${REVIEWS}${input.query ?? ''}`, { method: input.method, cache: 'no-store', credentials: 'same-origin', signal: input.signal,
    ...(input.body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.body) } : {}) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${body.error ?? 'review_unavailable'}${typeof body.recovery === 'string' ? `. ${body.recovery}` : ''}`);
  return body as T;
}

/** Saved runs of one role, newest last, with their candidate labels and configurations. */
function savedRuns(detail: CaseDetail, role: 'baseline' | 'candidate'): ViewRun[] {
  return detail.runs.flatMap((run) => {
    const candidate = detail.candidates.find((item) => item.id === run.candidateId);
    return candidate?.role === role && run.evaluation?.mode !== 'diagnostic' ? [{ ...run, label: candidate.label, config: candidate.config }] : [];
  });
}

/**
 * Development-only review workbench (Tickets 174–177). Compare reads two outputs
 * side by side; runs and prose feedback are saved locally. Drafts and feedback
 * never activate the hosted preset.
 */
export function DailyBriefWorkbench({ repositoryRoot = "" }: { repositoryRoot?: string }) {
  const [view, setView] = useState<'compare' | 'days' | 'saved'>('compare');
  const [configs, setConfigs] = useState<BriefingConfig[]>([DEFAULT_BRIEFING_CONFIG, BRIEFING_PRESETS[1]?.config ?? DEFAULT_BRIEFING_CONFIG]);
  const [sides, setSides] = useState<[Side, Side]>([
    { label: 'Baseline', rationale: '', parentCandidateId: null, proposalId: null },
    { label: 'Candidate', rationale: '', parentCandidateId: null, proposalId: null },
  ]);
  const [fixtureId, setFixtureId] = useState<BriefingFixtureId>("sparse");
  const [analysisFixtureId, setAnalysisFixtureId] = useState<BriefingAnalysisFixtureId>("none");
  const [mode, setMode] = useState<'synthetic' | 'account'>('synthetic');
  const [account, setAccount] = useState<Account | null>(null);
  const [accountError, setAccountError] = useState("");
  const [accountLoading, setAccountLoading] = useState(false);
  const [accessVersion, setAccessVersion] = useState(0);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [unsaved, setUnsaved] = useState<{ runs: [ViewRun, ViewRun]; capturedAt?: string; expiresAt?: string; mode: 'synthetic' | 'account' } | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<BriefingConfig | null>(null);
  const [jsonDraft, setJsonDraft] = useState("");
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, FeedbackDraft>>({});
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [packetPath, setPacketPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cases, setCases] = useState<BenchCaseSummary[]>([]);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [casesLoading, setCasesLoading] = useState(false);
  const [casesError, setCasesError] = useState("");
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const pendingCase = useRef<string | null>(null);
  const columns = useRef<HTMLDivElement>(null);
  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);
  const source = mode;
  const accountRef = mode === 'account' ? account?.settings.accountRef ?? null : null;

  /** Withdraws pending work. Saved results stay on disk; `clearCase` also closes the open case. */
  const invalidate = useCallback((clearCase = false) => {
    generation.current++;
    request.current?.abort();
    setRunning(false); setSavingFeedback(false); setBusy(false); setError("");
    if (clearCase) { setDetail(null); setUnsaved(null); setSelectedRunId(null); setPacketPath(null); setNotice(""); }
  }, []);
  const clearAccountFailure = useCallback((failure: unknown, from = mode) => {
    if (from !== 'account' || !(failure instanceof Error) || !/^(context_changed|access_denied|unauthenticated)(?:\.|$)/.test(failure.message)) return;
    invalidate(true); pendingCase.current = null; setAccount(null); setJsonDraft(''); setConfigs(clearScopes); setFeedbackDrafts({});
    setCases([]); setCasesError(''); setCasesLoading(false); setAccountLoading(false); setAccountError(failure.message);
    setSides([{ label: 'Baseline', rationale: '', parentCandidateId: null, proposalId: null }, { label: 'Candidate', rationale: '', parentCandidateId: null, proposalId: null }]);
  }, [invalidate, mode]);
  useEffect(() => {
    if (mode !== 'account') return;
    let active = true;
    let controller: AbortController | null = null;
    let previous: Account | null = null;
    const clear = () => {
      controller?.abort(); previous = null; invalidate(true); setAccount(null); setJsonDraft('');
      setConfigs(clearScopes); setFeedbackDrafts({}); setCases([]); setCasesError(''); setCasesLoading(false);
      setSides([{ label: 'Baseline', rationale: '', parentCandidateId: null, proposalId: null }, { label: 'Candidate', rationale: '', parentCandidateId: null, proposalId: null }]);
    };
    const refresh = async () => {
      controller?.abort(); setAccountLoading(true); setAccountError(""); controller = new AbortController();
      const current = controller;
      const version = generation.current;
      try {
        const value = await fetchAccount(current.signal);
        if (active && !current.signal.aborted && version === generation.current) {
          if (previous && JSON.stringify(previous.settings) !== JSON.stringify(value.settings)) clear();
          previous = value; setAccount(value);
        }
      } catch (failure) {
        if (active && !current.signal.aborted && version === generation.current) { clear(); setAccountError(failure instanceof Error ? failure.message : 'account_unavailable'); }
      } finally { if (active && controller === current) setAccountLoading(false); }
    };
    const focus = () => { void refresh(); };
    void refresh();
    window.addEventListener('focus', focus);
    return () => { active = false; controller?.abort(); window.removeEventListener('focus', focus); };
  }, [mode, accessVersion, invalidate]);

  const loadCase = useCallback(async (caseId: string, signal?: AbortSignal, selectLatest = false) => {
    const version = generation.current;
    try {
      const body = await reviewRequest<{ detail: CaseDetail }>({ query: `?source=${source}&caseId=${caseId}`, signal });
      if (version !== generation.current || signal?.aborted) return null;
      setDetail(body.detail);
      if (selectLatest) setUnsaved(null);
      const runs = savedRuns(body.detail, 'candidate');
      setSelectedRunId((current) => !selectLatest && runs.some(run => run.id === current) ? current : runs.at(-1)?.id ?? null);
      return body.detail;
    } catch (failure) { if (version === generation.current && !signal?.aborted) { clearAccountFailure(failure); throw failure; } return null; }
  }, [source, clearAccountFailure]);
  const loadCasesFor = useCallback(async (from: 'synthetic' | 'account') => {
    const version = generation.current;
    setCasesLoading(true); setCasesError("");
    try {
      const body = await reviewRequest<{ cases: BenchCaseSummary[]; retentionDays: number }>({ query: `?source=${from}` });
      if (version !== generation.current) return;
      setCases(body.cases); setRetentionDays(body.retentionDays);
    } catch (failure) { if (version === generation.current) { clearAccountFailure(failure, from); setCases([]); setCasesError(failure instanceof Error ? failure.message : 'review_unavailable'); } }
    finally { if (version === generation.current) setCasesLoading(false); }
  }, [clearAccountFailure]);
  const loadCases = useCallback(() => loadCasesFor(source), [loadCasesFor, source]);

  function switchMode(value: 'synthetic' | 'account') {
    invalidate(true); setAccount(null); setAccountError(''); setJsonDraft(''); setSaved(null); setCases([]);
    setConfigs(clearScopes); setFeedbackDrafts({}); setCasesError(''); setCasesLoading(false); setRetentionDays(null);
    setSides([{ label: 'Baseline', rationale: '', parentCandidateId: null, proposalId: null }, { label: 'Candidate', rationale: '', parentCandidateId: null, proposalId: null }]);
    setMode(value);
    if (view === 'saved') void loadCasesFor(value);
  }
  function change(index: number, config: BriefingConfig) {
    try { const validated = parseBriefingConfig(config); setConfigs((current) => current.map((entry, i) => i === index ? validated : entry)); setError(""); }
    catch { setError("Configuration is invalid. Check the bounds and selected behaviors."); }
  }
  const accountBlocked = mode === 'account' && (!account?.settings.enabled || !account.settings.available || accountLoading);
  const canRerun = !!detail?.case.rerunnable && !running && !accountBlocked;

  const baselineRuns = unsaved ? [unsaved.runs[0]] : detail ? savedRuns(detail, 'baseline') : [];
  const candidateRuns = unsaved ? [unsaved.runs[1]] : detail ? savedRuns(detail, 'candidate') : [];
  const runA = baselineRuns.at(-1) ?? null;
  const runB = candidateRuns.find((item) => item.id === selectedRunId) ?? candidateRuns.at(-1) ?? null;
  const labelOf = (candidateId: string | null) => detail?.candidates.find((item) => item.id === candidateId)?.label ?? 'none';
  const feedbackKey = JSON.stringify([detail?.case.id, runA?.id, runB?.id]);
  const feedback = feedbackDrafts[feedbackKey] ?? EMPTY_FEEDBACK;
  const setFeedback = (draft: FeedbackDraft) => setFeedbackDrafts(current => ({ ...current, [feedbackKey]: draft }));

  /** Runs A and B on a new snapshot, or only B on the open case's frozen inputs. */
  async function run(kind: 'new' | 'rerun' | 'pair') {
    if (mode === 'account' && (!account?.settings.enabled || !account.settings.available)) return;
    if (kind !== 'new' && !detail) return;
    invalidate();
    const version = generation.current;
    const controller = new AbortController(); request.current = controller; setRunning(true); setNotice("");
    if (kind === 'new') setSides(current => current.map(side => ({ ...side, parentCandidateId: null, proposalId: null })) as [Side, Side]);
    const caseId = kind === 'new' ? newId('case') : detail!.case.id;
    const previous = kind === 'rerun' ? detail!.candidates.filter((item) => item.role === 'candidate') : [];
    const reuse = previous.find((item) => JSON.stringify(item.config) === JSON.stringify(configs[1]) && item.label === sides[1].label.trim() &&
      item.rationale === sides[1].rationale.trim() && item.parentCandidateId === sides[1].parentCandidateId && item.proposalId === sides[1].proposalId);
    const indexes = kind === 'rerun' ? [1] : [0, 1];
    const candidates = indexes.map((index) => ({ id: index === 1 && reuse ? reuse.id : newId('cand'), label: sides[index].label.trim() || (index ? 'Candidate' : 'Baseline'),
      role: index ? 'candidate' as const : 'baseline' as const, parentCandidateId: kind === 'new' ? null : sides[index].parentCandidateId,
      proposalId: kind === 'new' ? null : sides[index].proposalId, rationale: sides[index].rationale }));
    const runConfigs = indexes.map((index) => configs[index]);
    const review = { caseId, candidates };
    pendingCase.current = caseId;
    try {
      const body = kind !== 'new' ? { mode: 'saved', accountRef, configs: runConfigs, review }
        : mode === 'account' ? { mode, configs: runConfigs, accountRef: account!.settings.accountRef, preferenceRevision: account!.settings.revision, review }
          : { fixtureId, configs: runConfigs, ...(analysisFixtureId === 'none' ? {} : { analysisFixtureId }), review };
      const response = await fetch("/api/dev/briefing-comparison", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: controller.signal, cache: "no-store", credentials: 'same-origin' });
      const result = await response.json() as Comparison & { review?: ReviewResponse };
      if (version !== generation.current) return;
      if (!response.ok) throw new Error(`${(result as { error?: string }).error ?? "comparison_failed"}${typeof (result as { recovery?: string }).recovery === 'string' ? `. ${(result as { recovery?: string }).recovery}` : ''}`);
      if (mode === 'account' && kind === 'new') {
        const current = await fetchAccount(controller.signal);
        if (version !== generation.current) return;
        if (result.mode !== 'account' || current.settings.accountRef !== result.accountRef || current.settings.accountRef !== account?.settings.accountRef ||
            !current.settings.enabled || current.settings.revision !== result.preferenceRevision || current.settings.revision !== account?.settings.revision ||
            current.settings.localDate !== account?.settings.localDate || current.settings.timezone !== account?.settings.timezone ||
            // eslint-disable-next-line react-hooks/purity -- Runs after the response in an explicit click handler, never during render.
            !result.expiresAt || Date.parse(result.expiresAt) <= Date.now()) throw new Error('context_changed');
      }
      if (result.review?.saved) {
        await loadCase(caseId, controller.signal, true);
        if (version !== generation.current) return;
      } else if (kind !== 'rerun') {
        const toView = (index: number): ViewRun => ({ id: null, candidateId: null, label: candidates[index]!.label, config: runConfigs[index], model: result.model,
          promptRevision: result.promptRevision, ...result.results[index]! });
        setDetail(null); setUnsaved({ runs: [toView(0), toView(1)], capturedAt: result.capturedAt, expiresAt: result.expiresAt, mode: result.mode === 'account' ? 'account' : 'synthetic' });
        setNotice(result.review ? 'Not saved. These results stay visible until you leave or run again.' : '');
      } else {
        if (runA) setUnsaved({ runs: [runA, { id: null, candidateId: null, label: candidates[0]!.label, config: runConfigs[0],
          model: result.model, promptRevision: result.promptRevision, ...result.results[0]! }], mode });
        setNotice('Not saved. These results stay visible until you leave or run again.');
      }
    } catch (failure) { if (version === generation.current) {
      clearAccountFailure(failure);
      setError(failure instanceof Error ? failure.message : "comparison_failed");
    } }
    finally { if (version === generation.current) { setRunning(false); pendingCase.current = null; } }
  }
  /** Stops the pending request. Runs that finished before cancellation remain saved and are reloaded. */
  async function cancel() {
    const caseId = pendingCase.current;
    invalidate(); pendingCase.current = null;
    if (!caseId) return;
    try { if (await loadCase(caseId, undefined, true)) setNotice('Cancelled. Completed results were kept.'); } catch { /* Nothing was saved before cancellation. */ }
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
  function quoteSelection() {
    const selection = window.getSelection();
    const text = selection?.toString().replace(/\s+/gu, ' ').trim() ?? '';
    const node = selection?.anchorNode ?? null;
    const side = node ? (node instanceof Element ? node : node.parentElement)?.closest('[data-review-side]')?.getAttribute('data-review-side') : null;
    const target = side === 'A' ? runA : side === 'B' ? runB : null;
    if (!text || !target?.id) { setError('Select text inside output A or B first.'); return; }
    setError(''); setFeedback({ ...feedback, quote: { runId: target.id, text: text.slice(0, 1000) } });
  }
  async function saveFeedback() {
    if (!detail || unsaved) return;
    const version = generation.current;
    setSavingFeedback(true); setError('');
    try {
      await reviewRequest({ method: 'POST', body: { source, action: 'feedback', caseId: detail.case.id, runIds: [runA?.id ?? null, runB?.id ?? null],
        preference: feedback.preference, comment: feedback.comment, quote: feedback.quote, replacement: feedback.replacement || null } });
      if (version !== generation.current) return;
      setFeedbackDrafts(current => current[feedbackKey] === feedback ? { ...current, [feedbackKey]: EMPTY_FEEDBACK } : current);
      await loadCase(detail.case.id);
    } catch (failure) { if (version === generation.current) { clearAccountFailure(failure); setError(`Feedback not saved. ${failure instanceof Error ? failure.message : 'review_unavailable'}`); } }
    finally { if (version === generation.current) setSavingFeedback(false); }
  }
  async function caseAction(body: Record<string, unknown>, after?: (value: Record<string, unknown>) => void) {
    if (!detail) return;
    const version = generation.current;
    setBusy(true); setError('');
    try { const value = await reviewRequest<Record<string, unknown>>({ method: 'POST', body: { source, caseId: detail.case.id, ...body } });
      if (version !== generation.current) return;
      after?.(value); await loadCase(detail.case.id); }
    catch (failure) { if (version === generation.current) { clearAccountFailure(failure); setError(failure instanceof Error ? failure.message : 'review_unavailable'); } }
    finally { if (version === generation.current) setBusy(false); }
  }
  function loadProposal(proposal: BenchProposal) {
    if (proposal.change.kind !== 'configuration') return;
    try {
      const config = parseBriefingConfig(proposal.change.config);
      setConfigs((current) => [current[0], config]);
      setSides((current) => [current[0], { label: proposal.change.kind === 'configuration' ? proposal.change.label : 'Candidate', rationale: proposal.interpretedProblem,
        parentCandidateId: proposal.change.kind === 'configuration' ? proposal.change.parentCandidateId : null, proposalId: proposal.id }]);
      setNotice(`Loaded “${proposal.change.label}” into candidate B. Rerun the candidate to compare it on this case.`);
    } catch (failure) { setError(`The proposal configuration is invalid. ${failure instanceof Error ? failure.message : ''}`); }
  }
  /** Opens a saved case and continues from its configurations; the next rerun records the latest candidate as its parent. */
  async function openCase(id: string, preserveDrafts = false) {
    invalidate(true);
    try {
      const opened = await loadCase(id, undefined, true);
      if (!opened) return;
      const baseline = opened.candidates.find((item) => item.role === 'baseline');
      const latest = opened.candidates.filter((item) => item.role === 'candidate').at(-1);
      try {
        if (!preserveDrafts) setConfigs((current) => [baseline ? parseBriefingConfig(baseline.config) : current[0], latest ? parseBriefingConfig(latest.config) : current[1]]);
        if (!preserveDrafts) setSides((current) => [baseline ? { label: baseline.label, rationale: '', parentCandidateId: null, proposalId: null } : current[0],
          latest ? { label: latest.label, rationale: '', parentCandidateId: latest.id, proposalId: null } : current[1]]);
      } catch { setNotice('This case was saved with a configuration version the workbench no longer reads. Drafts were kept.'); }
      if (!preserveDrafts) setView('compare');
    } catch (failure) { setCasesError(failure instanceof Error ? failure.message : 'review_unavailable'); }
  }
  async function deleteCase(id: string) {
    const version = generation.current;
    try {
      await reviewRequest({ method: 'POST', body: { source, action: 'delete', caseId: id } });
      if (version !== generation.current) return;
      if (detail?.case.id === id) invalidate(true);
      await loadCases();
    } catch (failure) { if (version === generation.current) { clearAccountFailure(failure); setCasesError(failure instanceof Error ? failure.message : 'review_unavailable'); } }
  }

  const editor = (index: number) => { const config = configs[index]; return <section aria-label={`Configuration ${index + 1}`} className="min-w-0 space-y-4 pt-2">
      <p className="text-sm">Daily Brief · Recipe {config.recipe.version}</p>
      <label className="block">Load preset<select aria-label={`Preset ${index + 1}`} className="ml-3 min-h-11 max-w-full border p-2" value={BRIEFING_PRESETS.find((preset) => JSON.stringify(preset.config) === JSON.stringify(config))?.id ?? ""} onChange={(event) => { const preset = BRIEFING_PRESETS.find((entry) => entry.id === event.target.value); if (preset) change(index, preset.config); }}><option value="">Choose preset</option>{BRIEFING_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
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
    </section>; };
  const caseLine = unsaved ? `${unsaved.mode === 'account' ? `My account · Snapshot ${unsaved.capturedAt ?? detail?.case.capturedAt ?? 'captured'}` : 'Synthetic'} · not saved`
    : detail ? `${detail.case.source.mode === 'synthetic' ? `Synthetic · ${detail.case.source.fixtureId.replaceAll('_', ' ')}${detail.case.source.analysisFixtureId ? ` · analysis ${detail.case.source.analysisFixtureId.replaceAll('_', ' ')}` : ''}` : `My account · ${detail.case.evidenceType}`} · clock ${detail.case.capturedAt} (${detail.case.timezone}) · saved${detail.case.rerunnable ? '' : ' · Review only: inputs were not kept, so this case cannot be rerun'}` : null;

  return <main className="mx-auto min-h-dvh max-w-7xl space-y-6 px-4 py-8 text-neutral-950" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
    <header className="space-y-2"><a href="/design-system" className="underline">Design system</a><h1 className="text-2xl">Briefing workbench</h1>
      <p><a className="underline" href="#briefing-term-config.recipe">Recipe: Daily Brief</a> · {configs[0].recipe.version} · Policy {DAILY_BRIEF_POLICY_VERSION}</p>
      <p>Read two Daily Briefs side by side and say which works. Aim for a 45-second read: one or two planning points, and at most one observation when the evidence supports it.</p>
      <p className="text-sm">Up to two provider calls at once across workbench tabs. Default budget: 100 calls per server hour. Comparisons do not use the daily briefing allowance. Saving a draft never activates it.</p>
    </header>
    <nav aria-label="Workbench views" className="flex gap-4 border-b">
      {([['compare', 'Compare'], ['days', 'Days'], ['saved', 'Saved reviews']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={view === value}
        className={`min-h-11 px-1 ${view === value ? 'border-b-2 border-neutral-950 font-bold' : 'underline'}`} onClick={() => { setView(value); if (value !== 'compare') void loadCases(); }}>{label}</button>)}
    </nav>
    <label className="block">Context source<select aria-label="Context source" className="ml-3 min-h-11 border p-2" value={mode} onChange={event => switchMode(event.target.value as 'synthetic' | 'account')}><option value="synthetic">Synthetic</option><option value="account">My account</option></select></label>
    {mode === 'synthetic' ? <div className="flex flex-wrap gap-x-6"><label className="block">Synthetic snapshot<select className="ml-3 min-h-11 border p-2" value={fixtureId} onChange={(event) => setFixtureId(event.target.value as BriefingFixtureId)}>{BRIEFING_FIXTURE_IDS.map((id) => <option key={id} value={id}>{id.replaceAll("_", " ")}</option>)}</select></label>
      <label className="block">Analysis scenario<select aria-label="Analysis scenario" className="ml-3 min-h-11 border p-2" value={analysisFixtureId} onChange={(event) => setAnalysisFixtureId(event.target.value as BriefingAnalysisFixtureId)}>{BRIEFING_ANALYSIS_FIXTURE_IDS.map((id) => <option key={id} value={id}>{id.replaceAll("_", " ")}</option>)}</select></label>
      <p className="w-full text-sm">Model runs send only synthetic fixtures to OpenAI. Frozen clock: 2026-11-01 07:00 America/New_York. Fixture {BRIEFING_FIXTURE_VERSION}; analysis {BRIEFING_ANALYSIS_FIXTURE_VERSION}. Sequences use isolated evaluation history; production tip history stays untouched.</p></div> : <div className="space-y-2 text-sm" aria-label="Account comparison access">
      <p>Run new comparison sends your authorized hosted Behavior facts and selected references to OpenAI. Calendar timing is sent only when enabled here and in Settings. Provider retention still applies.</p>
      <p>Local-only and unsynced desktop records are absent. Each comparison saves the captured inputs, outputs and your feedback on this computer, so you can reread and rerun it. Reruns check your current Settings first. Save and export of configuration drafts stay in Synthetic mode.</p>
      {accountLoading ? <p role="status">Checking account access…</p> : !account ? accountError && !accountError.startsWith('unauthenticated') ? <p role="alert">Account access unavailable: {accountError}</p> : <a className="mr-4 inline-flex min-h-11 items-center underline" href="/login?next=%2Fdesign-system%3Fpreview%3Dbriefing-workbench">Sign in to My account</a> : <>
        <p>{account.settings.enabled ? `Briefing access enabled · ${account.settings.timezone}` : 'Enable Daily Brief in Settings before comparing account data.'}</p>
        {!account.settings.available ? <p>Model generation is not configured on this server.</p> : null}
        <p>{account.settings.includeCalendar ? 'Calendar model-data permission is enabled. Each configuration can exclude it.' : 'Calendar model-data permission is off. Calendar will be excluded.'}</p>
      </>}
      <a className="inline-flex min-h-11 items-center underline" href="/settings">Open briefing settings</a>
      <button type="button" className="ml-4 min-h-11 underline" onClick={() => { invalidate(true); setFeedbackDrafts({}); setCases([]); setAccessVersion(value => value + 1); }}>Refresh account access</button>
    </div>}
    <BriefingDays key={`${mode}:${accountRef}:${account?.settings.revision ?? 0}`} view={view} mode={mode} accountRef={accountRef}
      preferenceRevision={account?.settings.revision} timezone={account?.settings.timezone}
      blocked={running || (mode === 'account' && (!account?.settings.enabled || accountLoading))} configs={configs}
      labels={sides.map(side => side.label)} fixtureId={fixtureId} analysisFixtureId={analysisFixtureId} cases={cases}
      onRefresh={() => void loadCases()} onOpen={id => void openCase(id, true).then(() => loadCases())} onAccountFailure={clearAccountFailure} />
    {view === 'saved' ? <SavedReviews cases={cases} retentionDays={retentionDays} loading={casesLoading} error={casesError} onOpen={(id) => void openCase(id)} onDelete={(id) => void deleteCase(id)} onRefresh={() => void loadCases()} /> : <>
      <div className="flex flex-wrap gap-4 border-t pt-4">
        <button type="button" disabled={running || accountBlocked} className="min-h-11 border px-4 disabled:opacity-50" onClick={() => void run('new')}>{running ? 'Running comparison…' : 'Run new comparison'}</button>
        {detail ? <button type="button" disabled={!canRerun} className="min-h-11 border px-4 disabled:opacity-50" onClick={() => void run('pair')}>Generate daily brief A and B on this day</button> : null}
        <button type="button" disabled={!canRerun} className="min-h-11 border px-4 disabled:opacity-50" onClick={() => void run('rerun')}>Rerun candidate on this case</button>
        {running ? <button type="button" className="min-h-11 underline" onClick={() => void cancel()}>Cancel comparison</button> : null}
      </div>
      {caseLine ? <p className="text-sm">{caseLine}{runB?.model ? ` · ${runB.model}` : ''}. Wording can vary with identical inputs. A saved case reruns on its captured clock; it is not current advice.</p> : null}
      {detail?.case.history ? <details><summary className="min-h-11 cursor-pointer py-2">Saved historical evidence limits</summary><p className="text-sm">{detail.case.evidenceType} · observed {detail.case.history.observedAt}. Evaluation clock {detail.case.capturedAt}.</p><ul className="space-y-2 text-sm">{detail.case.history.coverage.map((item, index) => <li key={index}>{item.source.replaceAll('_', ' ')}: {item.state.replaceAll('_', ' ')}. {item.limitations.join(' ')}</li>)}</ul></details> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">Comparison unavailable: {error}</p> : null}
      <div ref={columns} className="grid gap-8 lg:grid-cols-2">
        <ReadingColumn side="A" title="Baseline" run={runA} draftChanged={!!runA?.config && JSON.stringify(runA.config) !== JSON.stringify(configs[0])} />
        <ReadingColumn side="B" title="Candidate" run={runB} runs={candidateRuns} onSelectRun={setSelectedRunId} draftChanged={!!runB?.config && JSON.stringify(runB.config) !== JSON.stringify(configs[1])} />
      </div>
      <RunDifferences a={runA} b={runB} />
      {detail && !unsaved ? <FeedbackForm draft={feedback} onChange={setFeedback} onQuote={quoteSelection} onSave={() => void saveFeedback()} disabled={!runA && !runB} saving={savingFeedback} />
        : unsaved ? <p className="text-sm">Feedback needs a saved comparison. Run again to save.</p> : null}
      {detail ? <FeedbackList feedback={detail.feedback} labelOf={labelOf} /> : null}
      {detail ? <ProposalPanel proposals={detail.proposals} invalid={detail.invalidProposals} dispositions={detail.dispositions} packetPath={packetPath} busy={busy}
        onWritePacket={() => void caseAction({ action: 'packet' }, (value) => setPacketPath(typeof value.path === 'string' ? value.path : null))}
        onRefresh={() => void loadCase(detail.case.id).catch((failure) => setError(failure instanceof Error ? failure.message : 'review_unavailable'))}
        onLoad={loadProposal} onDecide={(proposal, decision, comment) => void caseAction({ action: 'disposition', proposalId: proposal.id, decision, comment })} /> : null}
      <BriefingWorkbenchGuide repositoryRoot={repositoryRoot} />
      <details><summary className="min-h-11 cursor-pointer py-2 text-xl">Configure A · Baseline</summary>
        <p className="text-sm">Changes apply to the next new comparison. The open case keeps its baseline output.</p>
        {editor(0)}
      </details>
      <details><summary className="min-h-11 cursor-pointer py-2 text-xl">Configure B · Candidate</summary>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">Candidate name<input aria-label="Candidate name" maxLength={80} className="min-h-11 border p-2" value={sides[1].label} onChange={(event) => setSides((current) => [current[0], { ...current[1], label: event.target.value }])} /></label>
          <label className="grid gap-1">What changed and why<input aria-label="Candidate rationale" maxLength={2000} className="min-h-11 border p-2" value={sides[1].rationale} onChange={(event) => setSides((current) => [current[0], { ...current[1], rationale: event.target.value }])} /></label>
        </div>
        {editor(1)}
      </details>
      <details><summary className="min-h-11 cursor-pointer py-2">Import or edit configuration JSON</summary><label className="block">Configuration only<textarea aria-label="Configuration JSON editor" className="mt-2 h-64 w-full border p-3 font-mono text-xs" value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} /></label>{[0, 1].map((index) => <button key={index} type="button" className="mr-4 min-h-11 underline" onClick={() => { try { change(index, parseBriefingConfig(JSON.parse(jsonDraft))); } catch (failure) { setError(`Invalid configuration JSON. ${failure instanceof Error ? failure.message : 'Unsupported configuration.'}`); } }}>Load into configuration {index + 1}</button>)}</details>
      {saved ? <p role="status">Configuration draft saved locally.</p> : null}
      {!runA && !runB ? <details><summary className="min-h-11 cursor-pointer py-2">Static long-text fixture (not model-generated)</summary><DailyBriefBubbleBench /></details> : null}
    </>}
  </main>;
}
