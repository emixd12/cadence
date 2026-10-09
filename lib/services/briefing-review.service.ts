import { randomUUID } from "node:crypto";
import path from "node:path";
import { BRIEFING_LANE_LABELS, BRIEFING_LANE_REASON_LABELS, BRIEFING_LANE_STATE_LABELS, BRIEFING_READING_TARGET, BRIEFING_TIP_DECISION_LABELS, diffBriefingConfigs, reviewBriefingReading } from "@cadence/core/services/briefing-review";
import type { BriefingAnalysisLaneId, BriefingAnalysisLaneState, BriefingAnalysisUnavailableReason } from "@cadence/core/types/briefing-analysis";
import type { BriefingTipDecision } from "@cadence/core/resolvers/briefing-analysis.resolver";
import type { DailyBriefing } from "@cadence/core/types/daily-brief";
import { visibleDailyBriefText } from "@cadence/core/services/daily-brief-presentation";
import { briefingAccountRef } from "./briefing-account-context.service";
import {
  benchPartition, BRIEFING_BENCH_RETENTION_DAYS, BRIEFING_BENCH_SCHEMA_VERSION, createBriefingBenchStore, isBriefingBenchStoreError, isBenchId,
  type BenchCaseDetail, type BenchDisposition, type BenchFeedback, type BenchPartition, type BenchPreference, type BenchRun, type BriefingBenchStore,
} from "./briefing-bench-store";
import { DailyBriefError, raceBriefAbort } from "./daily-brief-consumer";
import { runDailyBriefRequest } from "./daily-brief-request";
import { guard, json, readComparisonBody } from "./briefing-workbench.service";
import type { CalendarCaller } from "./google-calendar.service";

const PREFERENCES: readonly BenchPreference[] = ["prefer_a", "prefer_b", "both_work", "neither_works"];
const DECISIONS: readonly BenchDisposition["decision"][] = ["accepted", "needs_correction", "rejected"];

/** Account partitions need the signed-in owner; synthetic cases need only the loopback guard. */
async function withPartition(request: Request, source: unknown, run: (partition: BenchPartition, caller: CalendarCaller | null) => Promise<unknown>): Promise<Response> {
  if (source === "synthetic") {
    try { return json(await run("synthetic", null)); } catch (error) { return failure(error); }
  }
  if (source !== "account") return json({ error: "invalid_request" }, 400);
  return runDailyBriefRequest(request, async (caller) => {
    try { return await run(benchPartition(briefingAccountRef(caller.user.id)), caller); } catch (error) {
      if (isBriefingBenchStoreError(error)) throw new DailyBriefError(error.code === "not_found" ? "case_not_found" : "invalid_request");
      throw error;
    }
  });
}

function failure(error: unknown): Response {
  const code = isBriefingBenchStoreError(error) ? (error.code === "not_found" ? "case_not_found" : error.code === "write_failed" ? "not_saved" : "invalid_request")
    : error instanceof DailyBriefError ? error.code : error instanceof SyntaxError ? "invalid_request" : "not_saved";
  return json({ error: code }, code === "case_not_found" ? 404 : code === "not_saved" ? 500 : 400);
}

/** Saved cases without captured inputs. Inputs stay on disk for reruns and never return to the browser. */
function publicDetail(detail: BenchCaseDetail) {
  const { inputs, ...record } = detail.case;
  return { ...detail, case: { ...record, rerunnable: record.source.mode === "synthetic" || !!inputs } };
}

export async function readBriefingReviews(request: Request, store: BriefingBenchStore = createBriefingBenchStore()): Promise<Response> {
  const denied = guard(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const caseId = url.searchParams.get("caseId");
  if (caseId !== null && !isBenchId(caseId)) return json({ error: "invalid_request" }, 400);
  return withPartition(request, url.searchParams.get("source"), async (partition) => {
    await store.pruneExpired(partition, new Date());
    if (caseId) return { detail: publicDetail(await store.readCase(partition, caseId)) };
    return { cases: await store.listCases(partition), retentionDays: BRIEFING_BENCH_RETENTION_DAYS };
  });
}

export async function writeBriefingReview(request: Request, store: BriefingBenchStore = createBriefingBenchStore()): Promise<Response> {
  const denied = guard(request);
  if (denied) return denied;
  let value: Record<string, unknown>;
  try {
    const body = await raceBriefAbort(readComparisonBody(request), AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]));
    if (!body || typeof body !== "object" || Array.isArray(body) || !isBenchId(body.caseId)) return json({ error: "invalid_request" }, 400);
    value = body;
  } catch { return json({ error: "invalid_request" }, 400); }
  const caseId = value.caseId as string;
  return withPartition(request, value.source, async (partition) => {
    switch (value.action) {
      case "feedback": return { feedback: await saveFeedback(store, partition, caseId, value) };
      case "disposition": return { disposition: await saveDisposition(store, partition, caseId, value) };
      case "packet": return writeReviewPacket(store, partition, caseId);
      case "sequence_report": {
        if (!Array.isArray(value.caseIds) || !value.caseIds.length || value.caseIds.length > 14 ||
            !value.caseIds.every(isBenchId) || new Set(value.caseIds).size !== value.caseIds.length || value.caseIds[0] !== caseId) invalid();
        return writeSequenceReport(store, partition, value.caseIds as string[]);
      }
      case "delete": await store.deleteCase(partition, caseId); return { deleted: caseId };
      default: throw new DailyBriefError("invalid_request");
    }
  });
}

const optionalText = (value: unknown, max: number): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > max) throw new DailyBriefError("invalid_request");
  return value.trim() || null;
};

export function visibleBriefingText(briefing: DailyBriefing | undefined): string {
  return briefing ? visibleDailyBriefText(briefing) : "";
}

async function saveFeedback(store: BriefingBenchStore, partition: BenchPartition, caseId: string, value: Record<string, unknown>): Promise<BenchFeedback> {
  const allowed = "action,caseId,comment,preference,quote,replacement,runIds,source";
  if (Object.keys(value).sort().join() !== allowed) throw new DailyBriefError("invalid_request");
  const detail = await store.readCase(partition, caseId);
  const comment = optionalText(value.comment, 4000);
  if (!comment || !(value.preference === null || PREFERENCES.includes(value.preference as BenchPreference))) throw new DailyBriefError("invalid_request");
  const runs = value.runIds;
  if (!Array.isArray(runs) || runs.length !== 2 || runs.every((id) => id === null)) throw new DailyBriefError("invalid_request");
  const linked = runs.map((id) => id === null ? null : detail.runs.find((run) => run.id === id) ?? invalid()) as [BenchRun | null, BenchRun | null];
  let quote: BenchFeedback["quote"] = null;
  if (value.quote !== null) {
    const item = value.quote as Record<string, unknown>;
    const run = linked.find((entry) => entry?.id === item?.runId);
    const text = optionalText(item?.text, 1000);
    // A quotation must come from the output it annotates.
    if (!item || typeof item !== "object" || Object.keys(item).sort().join() !== "runId,text" || !run || !text ||
        !normalizeSpace(visibleBriefingText(run.briefing)).includes(normalizeSpace(text))) throw new DailyBriefError("invalid_request");
    quote = { runId: run.id, text };
  }
  const record: BenchFeedback = {
    schemaVersion: BRIEFING_BENCH_SCHEMA_VERSION, kind: "feedback", id: randomUUID(), caseId, createdAt: new Date().toISOString(),
    runIds: [linked[0]?.id ?? null, linked[1]?.id ?? null], candidateIds: [linked[0]?.candidateId ?? null, linked[1]?.candidateId ?? null],
    preference: value.preference as BenchPreference, comment, quote, replacement: optionalText(value.replacement, 2000),
  };
  await store.append(partition, caseId, "feedback", record);
  return record;
}

async function saveDisposition(store: BriefingBenchStore, partition: BenchPartition, caseId: string, value: Record<string, unknown>): Promise<BenchDisposition> {
  if (Object.keys(value).sort().join() !== "action,caseId,comment,decision,proposalId,source") throw new DailyBriefError("invalid_request");
  const detail = await store.readCase(partition, caseId);
  const comment = optionalText(value.comment, 2000) ?? "";
  if (!detail.proposals.some((proposal) => proposal.id === value.proposalId) || !DECISIONS.includes(value.decision as BenchDisposition["decision"]) ||
      (value.decision === "needs_correction" && !comment)) throw new DailyBriefError("invalid_request");
  const record: BenchDisposition = { schemaVersion: BRIEFING_BENCH_SCHEMA_VERSION, kind: "disposition", id: randomUUID(), caseId,
    proposalId: value.proposalId as string, createdAt: new Date().toISOString(), decision: value.decision as BenchDisposition["decision"], comment };
  await store.append(partition, caseId, "dispositions", record);
  return record;
}

function invalid(): never { throw new DailyBriefError("invalid_request"); }
function normalizeSpace(value: string): string { return value.replace(/\s+/gu, " ").trim().toLowerCase(); }

type InspectorAnalysis = { result?: { lanes?: { laneId: BriefingAnalysisLaneId; state: BriefingAnalysisLaneState; reason: BriefingAnalysisUnavailableReason | null }[] };
  selection?: { tipId: string | null; decisions?: { findingId: string; decision: BriefingTipDecision }[] } } | null;

/**
 * Writes a Markdown packet a coding agent can read to turn feedback into one
 * proposal (Ticket 177). The packet is the whole interface; no agent runs here.
 */
export async function writeReviewPacket(store: BriefingBenchStore, partition: BenchPartition, caseId: string): Promise<{ path: string; proposalDirectory: string }> {
  const detail = await store.readCase(partition, caseId);
  const record = detail.case;
  const candidate = (id: string | null) => detail.candidates.find((item) => item.id === id);
  const titles = record.behaviorTitles.map((item) => item.title);
  const lines: string[] = [
    `# Briefing review packet: case ${record.id}`,
    "",
    "You are turning the owner's prose feedback into one reviewable proposal for Cadence's Daily Brief.",
    "Read everything below before proposing. Do not edit other files under `.local/briefing-bench/`.",
    "",
    "## What to produce",
    "",
    `Write one JSON file to \`proposals/<proposal-id>.json\` beside this packet. Use a lowercase ID of 8–64 characters (letters, digits, hyphens).`,
    "The file must match this shape exactly:",
    "",
    "```json",
    JSON.stringify({
      schemaVersion: BRIEFING_BENCH_SCHEMA_VERSION, kind: "proposal", id: "proposal-id", caseId: record.id, createdAt: "ISO-8601 instant",
      feedbackIds: ["feedback IDs this answers"], interpretedProblem: "What the owner is objecting to, in one or two sentences",
      owner: "configuration | prompt | resolver | presentation | evidence",
      change: { kind: "configuration", label: "Short candidate name", config: "a complete BriefingConfig object", parentCandidateId: "candidate ID or null" },
      expectedEffect: "What should change in the rerun", possibleRegression: "What could get worse", rerunCaseIds: [record.id],
    }, null, 2),
    "```",
    "",
    "For prompt, resolver or presentation changes, use `change: { \"kind\": \"repository\", \"summary\": \"...\", \"files\": [\"path\"] }` and make the smallest repository change on a branch. The owner reruns the same case afterward; each run records its prompt revision.",
    "",
    "Rules:",
    "- Make the smallest change that answers the feedback. State what you are not changing.",
    "- If the evidence itself is wrong, the owner is `resolver` or `evidence`. Prompt wording cannot repair incorrect calculations.",
    "- Feedback never becomes a production rule by itself. Promotion is a separate reviewed repository change.",
    "- Marks describe logging time, not when a Behavior happened. Suggestions stay read-only.",
    `- Target reading length: about ${BRIEFING_READING_TARGET.minWords}–${BRIEFING_READING_TARGET.maxWords} visible words. Do not hide material uncertainty to meet it.`,
    "",
    "## Case",
    "",
    `- Source: ${record.source.mode === "synthetic" ? `synthetic fixture ${record.source.fixtureId} (${record.source.fixtureVersion}); analysis ${record.source.analysisFixtureId ?? "none"}` : "saved account context"}`,
    `- Evidence type: ${record.evidenceType}`,
    ...(record.history ? ["- Historical source coverage:", "```json", JSON.stringify(record.history, null, 2), "```"] : []),
    `- Logical clock: ${record.capturedAt} (${record.timezone}), local date ${record.localDate}`,
    `- Exact rerun: ${record.source.mode === "synthetic" || record.inputs ? "available" : "not available (Review only)"}`,
    "",
    "## Candidates",
    "",
    ...detail.candidates.flatMap((item) => [
      `### ${item.label} (${item.role}, \`${item.id}\`)`,
      "",
      `- Parent: ${item.parentCandidateId ?? "none"}; proposal: ${item.proposalId ?? "none"}; configuration revision \`${item.configurationRevision.slice(0, 12)}\``,
      item.rationale ? `- Rationale: ${item.rationale}` : "- Rationale: none given",
      "",
      "```json", JSON.stringify(item.config, null, 2), "```", "",
    ]),
  ];
  const baseline = detail.candidates.find((item) => item.role === "baseline");
  for (const other of detail.candidates.filter((item) => item.role === "candidate")) {
    if (!baseline) break;
    const differences = diffBriefingConfigs(baseline.config, other.config);
    lines.push(`## Differences: ${baseline.label} → ${other.label}`, "", ...(differences.length
      ? differences.map((item) => `- \`${item.path}\`: ${JSON.stringify(item.before)} → ${JSON.stringify(item.after)}`) : ["- No configuration differences."]), "");
  }
  lines.push("## Runs", "");
  for (const run of detail.runs) {
    const owner = candidate(run.candidateId);
    lines.push(`### Run \`${run.id}\` — ${owner?.label ?? run.candidateId}`, "",
      `- State: ${run.state}${run.error ? ` (${run.error})` : ""}; validation ${run.validation}; ${run.latencyMs} ms`,
      `- Model ${run.model}; prompt revision \`${run.promptRevision}\`; pipeline ${run.pipelineVersion}; attempt \`${run.attemptId}\``);
    if (run.briefing) {
      const review = reviewBriefingReading({ visibleText: visibleBriefingText(run.briefing), behaviorTitles: titles, segments: [
        { label: "overview", text: run.briefing.text },
        ...(run.briefing.suggestions ?? []).map((item, index) => ({ label: `suggestion ${index + 1}`, text: item.text })),
        ...(run.briefing.tip ? [{ label: "tip", text: run.briefing.tip.text }] : []),
      ] });
      lines.push(`- Reading: ${review.visibleWords} visible words in the workbench bubble, ${review.position} the target${review.repeated.length ? `; repeated: ${review.repeated.map((item) => `${item.between.join(" / ")} "${item.phrase}"`).join("; ")}` : ""}${review.mechanicsTerms.length ? `; internal terms: ${review.mechanicsTerms.join(", ")}` : ""}`,
        "", "Rendered brief (including supporting lines):", "", ...quote(visibleBriefingText(run.briefing)));
      if (run.briefing.tip) lines.push("", `Observation lane: ${BRIEFING_LANE_LABELS[run.briefing.tip.laneId as BriefingAnalysisLaneId] ?? run.briefing.tip.laneId}. Evidence and limitation are deterministic.`);
    }
    const analysis = (run.inspector && typeof run.inspector === "object" ? (run.inspector as { analysis?: InspectorAnalysis }).analysis : null) ?? null;
    const lanes = (analysis?.result?.lanes ?? []).filter((lane) => lane.state !== "not_selected");
    if (lanes.length) lines.push("", "Analysis:", "", ...lanes.map((lane) => `- ${BRIEFING_LANE_LABELS[lane.laneId] ?? lane.laneId}: ${BRIEFING_LANE_STATE_LABELS[lane.state] ?? lane.state}${lane.reason ? ` (${BRIEFING_LANE_REASON_LABELS[lane.reason] ?? lane.reason})` : ""}`),
      ...(analysis?.selection?.decisions ?? []).map((item) => `- Tip decision for \`${item.findingId}\`: ${BRIEFING_TIP_DECISION_LABELS[item.decision] ?? item.decision}`));
    lines.push("");
  }
  lines.push("## Owner feedback", "");
  if (!detail.feedback.length) lines.push("No feedback saved yet.", "");
  for (const item of detail.feedback) {
    const [left, right] = item.candidateIds.map((id) => candidate(id)?.label ?? "none");
    lines.push(`### Feedback \`${item.id}\` (${item.createdAt})`, "", `- Compared: A = ${left} (run ${item.runIds[0] ?? "none"}), B = ${right} (run ${item.runIds[1] ?? "none"})`,
      `- Judgment: ${item.preference ? item.preference.replaceAll("_", " ") : "none given"}`, "", "Comment (exact):", "", ...quote(item.comment));
    if (item.quote) lines.push("", `Quoted from run ${item.quote.runId}:`, "", ...quote(item.quote.text));
    if (item.replacement) lines.push("", "Suggested replacement:", "", ...quote(item.replacement));
    lines.push("");
  }
  if (detail.proposals.length) {
    lines.push("## Earlier proposals", "");
    for (const proposal of detail.proposals) {
      const decisions = detail.dispositions.filter((item) => item.proposalId === proposal.id);
      lines.push(`- \`${proposal.id}\` (${proposal.owner}): ${proposal.interpretedProblem}${decisions.length ? ` — ${decisions.map((item) => `${item.decision.replaceAll("_", " ")}${item.comment ? `: ${item.comment}` : ""}`).join("; ")}` : " — not reviewed"}`);
    }
    lines.push("");
  }
  const file = await store.writeText(partition, caseId, "review-packet.md", `${lines.join("\n")}\n`);
  return { path: path.relative(process.cwd(), file), proposalDirectory: path.relative(process.cwd(), path.join(path.dirname(file), "proposals")) };
}

function quote(text: string): string[] {
  return text.split("\n").map((line) => `> ${line}`);
}

/** Local report preserves complete text and exact feedback; it never grades or promotes a candidate. */
export async function writeSequenceReport(store: BriefingBenchStore, partition: BenchPartition, caseIds: readonly string[]) {
  const cases = (await Promise.all(caseIds.map(id => store.readCase(partition, id))))
    .sort((a, b) => a.case.localDate.localeCompare(b.case.localDate) || a.case.id.localeCompare(b.case.id));
  const judgments = { prefer_a: 0, prefer_b: 0, both_work: 0, neither_works: 0, unreviewed: 0 };
  const themes = new Map<string, Set<string>>();
  let words = 0, ready = 0, failed = 0, cancelled = 0;
  const lines = ['# Consecutive-day briefing review', '',
    `${cases.length} cases. Reading counts include supporting lines. Retries and diagnostics remain separate attempts.`,
    'Owner judgments apply to exact run pairs. Factual, privacy and delivery failures remain release blockers.',
    'Lane previews do not establish complete Daily Brief quality. No promotion or acceptance is inferred.', ''];
  for (const detail of cases) {
    const record = detail.case;
    lines.push(`## ${record.localDate} · ${record.evidenceType} · ${record.id}`, '',
      `Clock: ${record.capturedAt} (${record.timezone}).`,
      ...(record.history ? ['Coverage:', '```json', JSON.stringify(record.history, null, 2), '```'] : ['Coverage: original case capture; no reconstructed history claim.']), '');
    if (!detail.feedback.length) judgments.unreviewed++;
    for (const feedback of detail.feedback) if (feedback.preference) judgments[feedback.preference]++;
    for (const run of detail.runs) {
      const candidate = detail.candidates.find(item => item.id === run.candidateId);
      lines.push(`### ${candidate?.role ?? 'unknown'} · ${candidate?.label ?? run.candidateId} · run ${run.id}`, '',
        `State: ${run.state}; validation: ${run.validation}${run.error ? `; error: ${run.error}` : ''}.`,
        `Attempt: ${run.attemptId}; model: ${run.model}; prompt: ${run.promptRevision}; pipeline: ${run.pipelineVersion}; configuration: ${run.configurationRevision}.`,
        ...(run.evaluation ? [`Evaluation: ${JSON.stringify(run.evaluation)}`] : []));
      if (run.state === 'ready' && run.briefing) {
        ready++;
        const text = visibleBriefingText(run.briefing);
        const reading = reviewBriefingReading({ visibleText: text, behaviorTitles: record.behaviorTitles.map(item => item.title), segments: [] });
        words += reading.visibleWords;
        lines.push(`Visible words: ${reading.visibleWords}.`, '', ...quote(text), '');
        if (run.briefing.tip) {
          const theme = run.briefing.tip.laneId;
          const dates = themes.get(theme) ?? new Set<string>(); dates.add(record.localDate); themes.set(theme, dates);
        }
      } else if (run.state === 'cancelled') cancelled++;
      else failed++;
    }
    lines.push('### Exact feedback and unresolved concerns', '');
    if (!detail.feedback.length) lines.push('Owner review pending.', '');
    for (const feedback of detail.feedback) lines.push(`Runs ${feedback.runIds.join(' / ')}: ${feedback.preference ?? 'no preference'}`, '', ...quote(feedback.comment),
      ...(feedback.quote ? ['', `Quoted from ${feedback.quote.runId}:`, ...quote(feedback.quote.text)] : []),
      ...(feedback.replacement ? ['', 'Replacement:', ...quote(feedback.replacement)] : []), '');
  }
  lines.splice(6, 0, `Ready attempts: ${ready}; failed/withheld: ${failed}; cancelled: ${cancelled}; total visible words across all attempts: ${words}.`,
    `Exact feedback counts (not independent case votes): ${JSON.stringify(judgments)}.`,
    `Repeated observation lanes (theme signal, not a semantic repetition verdict): ${[...themes].filter(([, days]) => days.size > 1).map(([lane, days]) => `${BRIEFING_LANE_LABELS[lane as BriefingAnalysisLaneId] ?? lane}: ${days.size} days`).join('; ') || 'none in retained outputs'}.`,
    'Tokens and monetary cost: unavailable. Review missing inputs, rejected outputs, and owner concerns before any acceptance.', '');
  const file = await store.writeText(partition, caseIds[0]!, 'sequence-report.md', `${lines.join('\n')}\n`);
  return { path: path.relative(process.cwd(), file) };
}
