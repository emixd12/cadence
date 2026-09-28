"use client";

import { useCallback, useState } from "react";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import type { DailyBriefing } from "@cadence/core/types/daily-brief";
import type { BriefingAnalysisLaneId, BriefingAnalysisLaneState, BriefingAnalysisUnavailableReason } from "@cadence/core/types/briefing-analysis";
import type { BriefingTipDecision } from "@cadence/core/resolvers/briefing-analysis.resolver";
import {
  BRIEFING_LANE_LABELS, BRIEFING_LANE_REASON_LABELS, BRIEFING_LANE_STATE_LABELS, BRIEFING_TIP_DECISION_LABELS,
  diffBriefingConfigs, reviewBriefingReading,
} from "@cadence/core/services/briefing-review";
import type { BenchCaseSummary, BenchDisposition, BenchFeedback, BenchPreference, BenchProposal } from "@/lib/services/briefing-bench-store";
import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";

/** One output shown in a reading column, from a saved run or an unsaved response. */
export type ViewRun = Readonly<{
  id: string | null;
  candidateId: string | null;
  label: string;
  state: "ready" | "error" | "cancelled";
  briefing?: DailyBriefing;
  error?: string;
  validation: string;
  latencyMs: number;
  inspector: unknown;
  model?: string;
  promptRevision?: string;
  createdAt?: string;
  config?: BriefingConfig;
}>;

export type FeedbackDraft = Readonly<{
  preference: BenchPreference | null;
  comment: string;
  quote: Readonly<{ runId: string; text: string }> | null;
  replacement: string;
}>;

export const EMPTY_FEEDBACK: FeedbackDraft = { preference: null, comment: "", quote: null, replacement: "" };

export const PREFERENCE_LABELS: Readonly<Record<BenchPreference, string>> = {
  prefer_a: "Prefer A", prefer_b: "Prefer B", both_work: "Both work", neither_works: "Neither works",
};

type Finding = { id: string; laneId: BriefingAnalysisLaneId; behaviorRef: string | null };
type InspectorAnalysis = {
  result?: { lanes?: { laneId: BriefingAnalysisLaneId; state: BriefingAnalysisLaneState; reason: BriefingAnalysisUnavailableReason | null }[]; findings?: Finding[] };
  selection?: { tipId: string | null; decisions?: { findingId: string; decision: BriefingTipDecision }[] };
} | null;

/** Behavior titles by opaque ref, read from the facts the run used. */
export function behaviorTitles(inspector: unknown): Map<string, string> {
  const facts = inspector && typeof inspector === "object" ? (inspector as { facts?: { cadence?: { occurrences?: { behaviorRef?: string; title?: string }[] } } }).facts : null;
  return new Map((facts?.cadence?.occurrences ?? []).flatMap((item) => item.behaviorRef && item.title ? [[item.behaviorRef, item.title] as const] : []));
}

/** Plain-language lane states and tip decisions beside an output (Ticket 175). */
export function AnalysisSummary({ inspector }: { inspector: unknown }) {
  const analysis = (inspector && typeof inspector === "object" ? (inspector as { analysis?: InspectorAnalysis }).analysis : null) ?? null;
  if (!analysis?.result) return <p className="text-sm">No pattern analysis in this configuration.</p>;
  const titles = behaviorTitles(inspector);
  const findings = new Map((analysis.result.findings ?? []).map((finding) => [finding.id, finding]));
  const name = (finding: Finding | undefined, fallback: string) => finding
    ? `${BRIEFING_LANE_LABELS[finding.laneId] ?? finding.laneId}${finding.behaviorRef ? ` · ${titles.get(finding.behaviorRef) ?? "a Behavior not scheduled today"}` : ""}`
    : fallback;
  return <div className="space-y-1 text-sm" aria-label="Analysis findings and selection">
    <p className="font-bold">Why this observation</p>
    <p>Tip: {analysis.selection?.tipId ? name(findings.get(analysis.selection.tipId), analysis.selection.tipId) : "none offered"}</p>
    {analysis.selection?.decisions?.length ? <ul>{analysis.selection.decisions.map((item) => <li key={item.findingId}>{name(findings.get(item.findingId), item.findingId)}: {BRIEFING_TIP_DECISION_LABELS[item.decision] ?? item.decision}</li>)}</ul> : null}
    <ul>{(analysis.result.lanes ?? []).filter((lane) => lane.state !== "not_selected").map((lane) => <li key={lane.laneId}>
      {BRIEFING_LANE_LABELS[lane.laneId] ?? lane.laneId}: {BRIEFING_LANE_STATE_LABELS[lane.state] ?? lane.state}{lane.reason ? ` (${BRIEFING_LANE_REASON_LABELS[lane.reason] ?? lane.reason})` : ""}
    </li>)}</ul>
  </div>;
}

/** Visible words in the rendered bubble, excluding its close control. */
function visibleWords(element: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node instanceof HTMLButtonElement) return;
    if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? "");
    node.childNodes.forEach(walk);
  };
  walk(element);
  return parts.join(" ");
}

function ReadingReview({ run, text }: { run: ViewRun; text: string }) {
  if (!run.briefing) return null;
  const review = reviewBriefingReading({
    visibleText: text,
    behaviorTitles: [...behaviorTitles(run.inspector).values()],
    segments: [
      { label: "overview", text: run.briefing.text },
      ...(run.briefing.suggestions ?? []).map((item, index) => ({ label: `suggestion ${index + 1}`, text: item.text })),
      ...(run.briefing.tip ? [{ label: "tip", text: run.briefing.tip.text }] : []),
    ],
  });
  return <div className="space-y-1 text-sm" aria-label="Reading review">
    <p>{review.visibleWords} visible words · target {review.target.minWords}–{review.target.maxWords}{review.position === "within" ? "" : review.position === "above" ? " · longer than target" : " · shorter than target"}</p>
    {review.repeated.map((item) => <p key={item.between.join()}>Repeats “{item.phrase}” in {item.between[0]} and {item.between[1]}.</p>)}
    {review.mechanicsTerms.length ? <p>Internal terms: {review.mechanicsTerms.join(", ")}.</p> : null}
  </div>;
}

export function ReadingColumn({ side, title, run, runs, onSelectRun, draftChanged }: {
  side: "A" | "B";
  title: string;
  run: ViewRun | null;
  runs?: readonly ViewRun[];
  onSelectRun?: (id: string) => void;
  draftChanged: boolean;
}) {
  const [visibleText, setVisibleText] = useState("");
  // The wrapper remounts per run (keyed below), so this measures each rendered output once.
  const measure = useCallback((element: HTMLDivElement | null) => {
    const section = element?.querySelector('[aria-label="Cadence Daily Brief"]');
    if (element) setVisibleText(section ? visibleWords(section) : "");
  }, []);
  return <section aria-label={`Output ${side}`} data-review-side={side} className="min-w-0 space-y-3">
    <h2 className="text-xl">{side} · {title}</h2>
    {runs && runs.length > 1 && onSelectRun ? <label className="block text-sm">Candidate run<select aria-label="Candidate run" className="ml-2 min-h-11 max-w-full border p-2" value={run?.id ?? ""} onChange={(event) => onSelectRun(event.target.value)}>
      {runs.map((item) => <option key={item.id} value={item.id ?? ""}>{item.label}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</option>)}
    </select></label> : null}
    {!run ? <p className="text-sm">No output yet.</p> : <>
      <p className="text-sm">{run.label} · {run.state === "cancelled" ? "cancelled before completion" : `${run.validation}; ${run.latencyMs} ms`}{draftChanged ? " · the draft has changed since this run" : ""}</p>
      <div key={run.id ?? `${run.label}-${run.latencyMs}-${run.briefing?.generatedAt ?? run.error}`} ref={measure} className="bg-background pt-10 font-sans">
        {run.state === "cancelled" ? <p className="text-sm">No output. The request was cancelled.</p>
          : <DailyBriefBubble state={run.state === "ready" ? "ready" : "error"} briefing={run.briefing} message={run.error} onDismiss={() => undefined} />}
      </div>
      <ReadingReview run={run} text={visibleText} />
      <details><summary className="min-h-11 cursor-pointer py-2">Evidence and selection</summary><AnalysisSummary inspector={run.inspector} /></details>
      <details><summary className="min-h-11 cursor-pointer py-2">Inputs, duration sources, versions and planner inspector</summary>
        <p className="text-sm">Input decisions show exclusions, source selection and sample coverage. Excluded raw values stay absent. Catalog ID validity does not prove support.</p>
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(run.inspector, null, 2)}</pre>
      </details>
    </>}
  </section>;
}

export function RunDifferences({ a, b }: { a: ViewRun | null; b: ViewRun | null }) {
  if (!a?.config || !b?.config) return null;
  const differences = diffBriefingConfigs(a.config, b.config);
  const versions = ([["Model", a.model, b.model], ["Prompt revision", a.promptRevision, b.promptRevision]] as const).filter(([, left, right]) => left !== right);
  return <details><summary className="min-h-11 cursor-pointer py-2">Differences between A and B ({differences.length + versions.length})</summary>
    <ul className="text-sm">
      {differences.map((item) => <li key={item.path} className="break-words"><code>{item.path}</code>: {JSON.stringify(item.before)} → {JSON.stringify(item.after)}</li>)}
      {versions.map(([label, left, right]) => <li key={label}>{label}: {left ?? "unknown"} → {right ?? "unknown"}</li>)}
      {!differences.length && !versions.length ? <li>Same configuration, model and prompt. Wording can still vary between runs.</li> : null}
    </ul>
  </details>;
}

export function FeedbackForm({ draft, onChange, onQuote, onSave, disabled, saving }: {
  draft: FeedbackDraft;
  onChange: (draft: FeedbackDraft) => void;
  onQuote: () => void;
  onSave: () => void;
  disabled: boolean;
  saving: boolean;
}) {
  return <section aria-label="Feedback" className="space-y-3 border-t pt-4">
    <h2 className="text-xl">Feedback</h2>
    <fieldset className="flex flex-wrap gap-x-4"><legend className="text-sm">Judgment (optional)</legend>
      {(Object.keys(PREFERENCE_LABELS) as BenchPreference[]).map((value) => <label key={value} className="inline-flex min-h-11 items-center gap-2">
        <input type="radio" name="briefing-preference" checked={draft.preference === value} onChange={() => onChange({ ...draft, preference: value })} />{PREFERENCE_LABELS[value]}
      </label>)}
    </fieldset>
    <label className="block">What worked, and what did not?<textarea aria-label="Feedback comment" className="mt-2 min-h-24 w-full border p-3" value={draft.comment} onChange={(event) => onChange({ ...draft, comment: event.target.value })} /></label>
    <div className="space-y-1 text-sm">
      {draft.quote ? <p>Quoting: “{draft.quote.text}” <button type="button" className="min-h-11 underline" onClick={() => onChange({ ...draft, quote: null })}>Remove quote</button></p>
        : <button type="button" className="min-h-11 underline" onClick={onQuote}>Quote selected text</button>}
    </div>
    <label className="block">Replacement wording (optional)<textarea aria-label="Replacement wording" className="mt-2 min-h-16 w-full border p-3" value={draft.replacement} onChange={(event) => onChange({ ...draft, replacement: event.target.value })} /></label>
    <button type="button" className="min-h-11 border px-4 disabled:opacity-50" disabled={disabled || saving || !draft.comment.trim()} onClick={onSave}>{saving ? "Saving feedback…" : "Save feedback"}</button>
  </section>;
}

export function FeedbackList({ feedback, labelOf }: { feedback: readonly BenchFeedback[]; labelOf: (candidateId: string | null) => string }) {
  if (!feedback.length) return null;
  return <section aria-label="Saved feedback" className="space-y-2">
    <h3 className="font-bold">Saved feedback</h3>
    <ul className="space-y-3">{[...feedback].reverse().map((item) => <li key={item.id} className="border-l pl-3 text-sm">
      <p>{item.preference ? PREFERENCE_LABELS[item.preference] : "No judgment"} · A: {labelOf(item.candidateIds[0])} · B: {labelOf(item.candidateIds[1])} · {new Date(item.createdAt).toLocaleString()}</p>
      <p className="whitespace-pre-wrap">{item.comment}</p>
      {item.quote ? <p>Quoted: “{item.quote.text}”</p> : null}
      {item.replacement ? <p>Replacement: {item.replacement}</p> : null}
    </li>)}</ul>
  </section>;
}

export function ProposalPanel({ proposals, invalid, dispositions, packetPath, onWritePacket, onRefresh, onLoad, onDecide, busy }: {
  proposals: readonly BenchProposal[];
  invalid: readonly string[];
  dispositions: readonly BenchDisposition[];
  packetPath: string | null;
  onWritePacket: () => void;
  onRefresh: () => void;
  onLoad: (proposal: BenchProposal) => void;
  onDecide: (proposal: BenchProposal, decision: BenchDisposition["decision"], comment: string) => void;
  busy: boolean;
}) {
  const [comments, setComments] = useState<Record<string, string>>({});
  return <details><summary className="min-h-11 cursor-pointer py-2">Turn feedback into a candidate ({proposals.length} proposals)</summary>
    <div className="space-y-3 text-sm">
      <p>Write a review packet, then ask a coding agent to read it and write one proposal. Proposals never change production; promotion is a separate repository change.</p>
      <div className="flex flex-wrap gap-4">
        <button type="button" className="min-h-11 underline disabled:opacity-50" disabled={busy} onClick={onWritePacket}>Write review packet</button>
        <button type="button" className="min-h-11 underline disabled:opacity-50" disabled={busy} onClick={onRefresh}>Check for proposals</button>
      </div>
      {packetPath ? <p role="status">Packet written to <code className="break-all">{packetPath}</code>. Ask your coding agent: “Read {packetPath} and write a proposal.”</p> : null}
      {invalid.length ? <p>Ignored malformed proposal files: {invalid.join(", ")}.</p> : null}
      <ul className="space-y-4">{proposals.map((proposal) => {
        const decisions = dispositions.filter((item) => item.proposalId === proposal.id);
        return <li key={proposal.id} className="space-y-1 border-l pl-3">
          <p className="font-bold">{proposal.change.kind === "configuration" ? proposal.change.label : "Repository change"} · owner: {proposal.owner}</p>
          <p>Problem: {proposal.interpretedProblem}</p>
          <p>Expected effect: {proposal.expectedEffect}</p>
          <p>Possible regression: {proposal.possibleRegression}</p>
          {proposal.change.kind === "repository" ? <p>Change: {proposal.change.summary} ({proposal.change.files.join(", ")}). Rerun the candidate after the change lands.</p>
            : <button type="button" className="min-h-11 underline" onClick={() => onLoad(proposal)}>Load into candidate B</button>}
          {decisions.map((item) => <p key={item.id}>Decision: {item.decision.replaceAll("_", " ")}{item.comment ? ` — ${item.comment}` : ""}</p>)}
          <label className="block">Decision note<input aria-label={`Decision note ${proposal.id}`} className="ml-2 min-h-11 border p-2" value={comments[proposal.id] ?? ""} onChange={(event) => setComments({ ...comments, [proposal.id]: event.target.value })} /></label>
          <div className="flex flex-wrap gap-4">{([["accepted", "Accept"], ["needs_correction", "Needs correction"], ["rejected", "Reject"]] as const).map(([decision, label]) =>
            <button key={decision} type="button" className="min-h-11 underline disabled:opacity-50" disabled={busy || (decision === "needs_correction" && !comments[proposal.id]?.trim())}
              onClick={() => onDecide(proposal, decision, comments[proposal.id] ?? "")}>{label}</button>)}</div>
        </li>;
      })}</ul>
    </div>
  </details>;
}

export function SavedReviews({ cases, retentionDays, loading, error, onOpen, onDelete, onRefresh }: {
  cases: readonly BenchCaseSummary[];
  retentionDays: number | null;
  loading: boolean;
  error: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return <section aria-label="Saved reviews" className="space-y-3">
    <p className="text-sm">Saved on this computer under <code>.local/briefing-bench/</code>{retentionDays ? `. Cases are deleted after ${retentionDays} days` : ""}. Account cases include the captured inputs, so they can be rerun exactly.</p>
    <button type="button" className="min-h-11 underline" onClick={onRefresh}>Refresh list</button>
    {loading ? <p role="status">Loading saved reviews…</p> : null}
    {error ? <p role="alert">Saved reviews unavailable: {error}</p> : null}
    {!loading && !error && !cases.length ? <p>No saved reviews yet. Run a comparison in Compare to save one.</p> : null}
    <ul className="space-y-3">{cases.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-x-4 border-t pt-3 text-sm">
      <span className="min-w-0 grow break-words">{item.source.mode === "synthetic" ? `Synthetic · ${item.source.fixtureId.replaceAll("_", " ")}${item.source.analysisFixtureId ? ` · ${item.source.analysisFixtureId.replaceAll("_", " ")}` : ""}` : "My account · captured"} · {item.localDate} · saved {new Date(item.createdAt).toLocaleString()} · {item.runs} runs · {item.feedback} feedback{item.proposals ? ` · ${item.proposals} proposals` : ""}{item.rerunnable ? "" : " · Review only"}</span>
      <button type="button" className="min-h-11 underline" onClick={() => onOpen(item.id)}>Open</button>
      {confirming === item.id ? <button type="button" className="min-h-11 underline" onClick={() => { setConfirming(null); onDelete(item.id); }}>Confirm delete</button>
        : <button type="button" className="min-h-11 underline" onClick={() => setConfirming(item.id)}>Delete</button>}
    </li>)}</ul>
  </section>;
}
