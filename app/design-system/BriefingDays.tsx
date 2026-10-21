"use client";

import { useEffect, useRef, useState } from "react";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import type { BenchCaseSummary } from "@/lib/services/briefing-bench-store";
import type { BriefingSequencePlan, BriefingSequenceStatus } from "@/lib/services/briefing-sequence.service";
import { BRIEFING_LANE_LABELS } from "@cadence/core/services/briefing-review";
import { AnalysisSummary, ReadingColumn } from "./BriefingReview";

import type { BriefingHistoryResponse as History } from "@/lib/services/briefing-history.service";
const SOURCE_LABELS: Record<string, string> = { occurrences: 'Occurrences', completion_history: 'Completion history', durations: 'Durations', configuration: 'Schedules and defaults', timezone: 'Timezone', notes: 'Notes', reminders: 'Reminder history', calendar: 'Calendar', analysis: 'Pattern analysis' };
const STATE_LABELS: Record<string, string> = { retained: 'Retained rows only', synthetic: 'Authored fixture', unknown: 'Unknown', unavailable: 'Unavailable', not_requested: 'Not requested', capped: 'Limit reached' };
type Props = {
  view: 'compare' | 'days' | 'saved'; mode: 'synthetic' | 'account'; accountRef: string | null;
  preferenceRevision?: number; timezone?: string; blocked: boolean; configs: BriefingConfig[];
  labels: readonly string[]; fixtureId: string; analysisFixtureId: string; cases: readonly BenchCaseSummary[];
  onRefresh: () => void; onOpen: (id: string) => void; onAccountFailure: (error: unknown) => void;
};

async function request<T>(url: string, body?: unknown, method = 'POST', signal?: AbortSignal, retainRejectedJob = false): Promise<T> {
  const response = await fetch(url, { method, signal, cache: 'no-store', credentials: 'same-origin',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok && !(retainRejectedJob && result.id && Array.isArray(result.results))) throw new Error(result.recovery ? `${result.error}. ${result.recovery}` : result.error ?? 'request_failed');
  return result;
}

/** Mounted across views so day selection, pending output and review drafts survive navigation. */
export function BriefingDays(props: Props) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [logicalTime, setLogicalTime] = useState('07:00');
  const [pastCalendar, setPastCalendar] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const [selectedDay, setSelectedDay] = useState('');
  const [selectedCases, setSelectedCases] = useState<string[]>([]);
  const [callBudget, setCallBudget] = useState(100);
  const [plan, setPlan] = useState<BriefingSequencePlan | null>(null);
  const [plannedInput, setPlannedInput] = useState<Record<string, unknown> | null>(null);
  const [job, setJob] = useState<BriefingSequenceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState('');
  const active = useRef(true);
  const generation = useRef(0);
  const historyRequest = useRef<AbortController | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; historyRequest.current?.abort(); }; }, []);

  const fail = (failure: unknown) => {
    props.onAccountFailure(failure);
    setError(failure instanceof Error ? failure.message : 'request_failed');
  };
  const jobId = job?.id;
  const { accountRef, onAccountFailure } = props;
  const running = job?.state === 'queued' || job?.state === 'running';
  useEffect(() => {
    if (!running || !jobId) return;
    let cancelled = false;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const result = await request<BriefingSequenceStatus>(`/api/dev/briefing-sequence?id=${encodeURIComponent(jobId)}${accountRef ? `&accountRef=${encodeURIComponent(accountRef)}` : ''}`, undefined, 'GET', controller.signal);
        if (!cancelled) setJob(result);
      } catch (failure) { if (!cancelled) { onAccountFailure(failure); setError(failure instanceof Error ? failure.message : 'sequence_unavailable'); } }
    };
    const timer = setInterval(() => void poll(), 1500);
    return () => { cancelled = true; clearInterval(timer); controller.abort(); };
  }, [running, jobId, accountRef, onAccountFailure]);

  async function inspect(saveLocalDate?: string) {
    historyRequest.current?.abort();
    const controller = new AbortController(); historyRequest.current = controller;
    const version = ++generation.current;
    setBusy(true); setError('');
    try {
      const result = await request<History>('/api/dev/briefing-history', {
        mode: props.mode, configs: props.configs, logicalTime, includePastCalendar: pastCalendar,
        ...(start ? { startLocalDate: start } : {}), ...(end ? { endLocalDate: end } : {}),
        ...(saveLocalDate ? { saveLocalDate } : {}),
        ...(props.mode === 'synthetic' ? { fixtureId: props.fixtureId, analysisFixtureId: props.analysisFixtureId }
          : { accountRef: props.accountRef, preferenceRevision: props.preferenceRevision }),
      }, 'POST', controller.signal);
      if (!active.current || generation.current !== version) return;
      setHistory(result); setSelectedDay(current => result.days.some(day => day.localDate === current) ? current : result.days[0]?.localDate ?? '');
      if (result.savedCaseId) {
        setSelectedCases(current => [...new Set([...current, result.savedCaseId!])].slice(-14));
        setPlan(null); setPlannedInput(null); props.onOpen(result.savedCaseId);
      }
    } catch (failure) { if (!controller.signal.aborted && generation.current === version) fail(failure); }
    finally { if (active.current && generation.current === version) setBusy(false); }
  }

  async function simulate(mode: 'daily' | 'diagnostic') {
    setBusy(true); setError(''); setPlan(null); setPlannedInput(null);
    try {
      const input = { accountRef: props.accountRef, caseIds: selectedCases, configs: props.configs, mode, warmup: [], callBudget,
        candidates: props.configs.map((_, index) => ({ id: `cand-${crypto.randomUUID()}`, label: props.labels[index] || (index ? 'Candidate' : 'Baseline'),
          role: index ? 'candidate' : 'baseline', parentCandidateId: null, proposalId: null, rationale: '' })) };
      const value = await request<BriefingSequencePlan>('/api/dev/briefing-sequence', { ...input, action: 'simulate' });
      if (active.current) { setPlan(value); setPlannedInput(input); }
    } catch (failure) { if (active.current) fail(failure); }
    finally { if (active.current) setBusy(false); }
  }

  async function generate() {
    if (!plannedInput) return;
    setBusy(true); setError('');
    try { const value = await request<BriefingSequenceStatus>('/api/dev/briefing-sequence', { ...plannedInput, action: 'start' }, 'POST', undefined, true);
      if (active.current) setJob(value);
    } catch (failure) { if (active.current) fail(failure); }
    finally { if (active.current) setBusy(false); }
  }
  async function cancel() {
    if (!job) return;
    try { const result = await request<BriefingSequenceStatus>('/api/dev/briefing-sequence', { id: job.id, accountRef: props.accountRef }, 'DELETE');
      if (active.current) setJob(result);
    } catch (failure) { if (active.current) fail(failure); }
  }
  async function writeReport() {
    setBusy(true); setError('');
    try { const result = await request<{ path: string }>('/api/dev/briefing-reviews', { source: props.mode, action: 'sequence_report', caseId: selectedCases[0], caseIds: selectedCases });
      if (active.current) setReport(result.path);
    } catch (failure) { if (active.current) fail(failure); }
    finally { if (active.current) setBusy(false); }
  }

  const planCurrent = !!plannedInput && JSON.stringify(plannedInput.configs) === JSON.stringify(props.configs);
  const day = history?.days.find(item => item.localDate === selectedDay);
  return <div hidden={props.view === 'saved'} className="space-y-4">
    <details open={props.view === 'days' ? true : undefined}>
      <summary className="min-h-11 cursor-pointer py-2">Explore historical days without a model</summary>
      <div className="space-y-3 py-3">
        <p className="text-sm">Default: 14 target days. Maximum: 90. Each target needs its own lookback. Missing history stays unknown.</p>
        <div className="flex flex-wrap gap-3">
          <label className="grid gap-1">First day<input type="date" aria-label="First historical day" className="min-h-11 border p-2" value={start} onChange={event => setStart(event.target.value)} /></label>
          <label className="grid gap-1">Last day<input type="date" aria-label="Last historical day" className="min-h-11 border p-2" value={end} onChange={event => setEnd(event.target.value)} /></label>
          <label className="grid gap-1">Evaluation time<input type="time" aria-label="Evaluation time" className="min-h-11 border p-2" value={logicalTime} onChange={event => setLogicalTime(event.target.value)} /></label>
        </div>
        <p className="text-sm">Timezone: {props.timezone ?? 'America/New_York'}. 07:00 is an evaluation default, not a production cutoff.</p>
        {props.mode === 'account' ? <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={pastCalendar} onChange={event => setPastCalendar(event.target.checked)} />Read past Calendar separately using current permission</label> : null}
        <button type="button" disabled={busy || props.blocked || running} className="min-h-11 border px-4 disabled:opacity-50" onClick={() => void inspect()}>{busy ? 'Preparing evidence…' : 'Analyze days without a model'}</button>
        {history ? <>
          <div className="max-h-72 overflow-auto"><table className="w-full text-left text-sm"><caption className="pb-2 text-left">Select one day to inspect its evidence.</caption><thead><tr><th className="p-2">Day</th><th className="p-2">Evidence</th><th className="p-2">Scheduled rows</th><th className="p-2">Retained cases</th></tr></thead><tbody>
            {history.days.map(item => <tr key={item.localDate} className="border-t"><td className="p-2"><button type="button" aria-pressed={selectedDay === item.localDate} className={`min-h-11 underline ${selectedDay === item.localDate ? 'font-bold' : ''}`} onClick={() => setSelectedDay(item.localDate)}>{item.localDate}</button></td><td className="p-2 capitalize">{item.evidenceType}</td><td className="p-2">{item.counts?.scheduled ?? 'Unknown'}</td><td className="p-2">{item.retainedCases.length}</td></tr>)}
          </tbody></table></div>
          {day ? <section className="space-y-3" aria-label="Selected day evidence">
            <p>{day.localDate} · {day.evidenceType} · clock {day.logicalAt}</p>
            <ul className="space-y-2 text-sm">{day.coverage.map((item, index) => <li key={`${item.source}-${index}`}><strong>{SOURCE_LABELS[item.source] ?? item.source}</strong>: {STATE_LABELS[item.state] ?? item.state}. {item.startLocalDate} to {item.endLocalDateExclusive} (exclusive). {item.limitations.join(' ')}</li>)}</ul>
            <div className="grid gap-4 lg:grid-cols-2">{day.inspections.map((inspector, index) => <div key={index}><p className="font-bold">{index ? 'B' : 'A'} · Evidence only</p><AnalysisSummary inspector={inspector} /><details><summary className="min-h-11 cursor-pointer py-2">Planning evidence</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(inspector.plan, null, 2)}</pre></details></div>)}</div>
            <button type="button" disabled={busy || props.blocked || running || day.state !== 'available'} className="min-h-11 border px-4 disabled:opacity-50" onClick={() => void inspect(day.localDate)}>Save day for comparison</button>
            {day.retainedCases.map(capture => <button type="button" key={capture.id} className="ml-4 min-h-11 underline" onClick={() => props.onOpen(capture.id)}>Open {capture.evidenceType} at {capture.logicalAt}</button>)}
          </section> : null}
        </> : null}
      </div>
    </details>
    <section hidden={props.view !== 'days'} aria-label="Consecutive day review" className="space-y-3 border-t pt-4">
      <h2 className="text-xl">Days</h2>
      <p className="text-sm">Choose up to 14 saved days. A and B share each case and clock. Read one pair below, then move forward.</p>
      <button type="button" className="min-h-11 underline" onClick={props.onRefresh}>Refresh saved days</button>
      <ul className="max-h-72 overflow-auto">{[...props.cases].sort((a, b) => a.localDate.localeCompare(b.localDate)).map(item => <li key={item.id} className="flex flex-wrap items-center gap-3 border-t text-sm">
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={!item.rerunnable || running || busy || (!selectedCases.includes(item.id) && selectedCases.length >= 14)} checked={selectedCases.includes(item.id)} onChange={event => { setSelectedCases(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id)); setPlan(null); setPlannedInput(null); }} />{item.localDate} · {item.evidenceType}{item.rerunnable ? '' : ' · Review only'}</label>
        <button type="button" className="min-h-11 underline" onClick={() => props.onOpen(item.id)}>Read this day</button>
      </li>)}</ul>
      <label className="flex min-h-11 items-center gap-2">Call budget for this sequence<input type="number" aria-label="Sequence call budget" min={1} max={100} className="w-24 border p-2" value={callBudget} onChange={event => { setCallBudget(Number(event.target.value)); setPlan(null); setPlannedInput(null); }} /></label>
      <p className="text-sm">Warm-up history starts empty. Simulation assumes selected tips were delivered. Generation retains only successful retained tips. Production tip history stays untouched.</p>
      <div className="flex flex-wrap gap-4">
        <button type="button" disabled={busy || running || props.blocked || !selectedCases.length} className="min-h-11 border px-4 disabled:opacity-50" onClick={() => void simulate('daily')}>Plan daily briefs</button>
        <button type="button" disabled={busy || running || props.blocked || !selectedCases.length} className="min-h-11 border px-4 disabled:opacity-50" onClick={() => void simulate('diagnostic')}>Plan previews for each eligible lane</button>
      </div>
      {plan ? <div className="space-y-2" role="status">
        {!planCurrent ? <p>Configuration changed. Plan again before generating.</p> : null}
        <p>Planned calls: {plan.plannedCalls}. {plan.mode === 'diagnostic' ? 'Diagnostic only: previews bypass ranking and cooldown. Evidence and permission checks still apply.' : 'Complete daily briefs, in chronological order.'}</p>
        <details><summary className="min-h-11 cursor-pointer py-2">Selection simulation</summary><ul className="space-y-2 text-sm">{plan.days.map(day => <li key={day.caseId}><strong>{day.localDate} · {day.evidenceType}</strong><ul>{day.selections.map(side => <li key={side.side}>{side.side ? 'B' : 'A'}: {side.tipId ? 'Observation selected' : 'No observation selected'}; eligible lanes: {side.eligibleLanes.map(lane => BRIEFING_LANE_LABELS[lane]).join(', ') || 'none'}. Cooldown: {side.cooldownDays} days.</li>)}</ul></li>)}</ul></details>
        <button type="button" disabled={busy || running || props.blocked || !plan.plannedCalls || !planCurrent} className="min-h-11 border px-4 disabled:opacity-50" onClick={() => void generate()}>{plan.mode === 'diagnostic' ? 'Preview each lane' : 'Generate daily briefs'}</button>
      </div> : null}
      {job ? <section className="space-y-3" aria-label="Sequence results">
        <p role="status">{job.state} · {job.dispatchedCalls} dispatched calls · Usage and monetary cost unavailable.</p>
        {running ? <button type="button" className="min-h-11 underline" onClick={() => void cancel()}>Cancel queued work</button> : null}
        <p className="text-sm">Cancellation keeps completed output. Dispatched calls still count and may incur provider charges.</p>
        <ul>{job.results.map((result, index) => <li key={index} className="flex flex-wrap items-center gap-3 border-t text-sm">
          <span>{result.localDate} · {result.side ? 'B' : 'A'}{result.laneId ? ` · Diagnostic: ${BRIEFING_LANE_LABELS[result.laneId]}` : ''} · {result.state}{result.saved ? '' : ' · Not saved'}{result.error ? ` · ${result.error}` : ''}</span>
          {result.saved && !result.laneId ? <button type="button" className="min-h-11 underline" onClick={() => props.onOpen(result.caseId)}>Read saved output</button> : <details className="w-full"><summary className="min-h-11 cursor-pointer py-2">{result.laneId ? 'Read diagnostic output' : 'Read unsaved output'}</summary><ReadingColumn side={result.side ? 'B' : 'A'} title={result.laneId ? "Diagnostic only" : "Not saved"} draftChanged={false} run={{ ...result, id: null, label: result.side ? 'Candidate' : 'Baseline' }} /></details>}
        </li>)}</ul>
      </section> : null}
      <button type="button" disabled={busy || running || !selectedCases.length} className="min-h-11 underline disabled:opacity-50" onClick={() => void writeReport()}>Write local review report</button>
      {report ? <p role="status" className="break-all">Report: {report}</p> : null}
    </section>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
