import type { LanguageModel } from "ai";
import type { ChatEvent, ChatMessage, ChatPart } from "@cadence/core/types/chat";
import { agentModelSetting, type AgentModelSetting, type AgentModelUsage } from "../agent-model";
import { modelPrice, usageMicrodollars } from "../agent-model-pricing";
import { createFakeExecutor, type ChatToolExecutor } from "./fake-tools";
import { runChatConfirm, runChatTurn, runChatUndo, type PendingWrite, type UndoPlan } from "./provisional-turn";
import { checkChatRules, textOf, type ChatRuleBreak, type PhasedCall, type TurnRecord } from "./rules";
import { CHAT_SCENARIOS, type ChatScenario, type FinalState } from "./scenarios";
import { behavior, chatEvalWorld, clockLabel, cloneWorld, effectiveTime, occurrence, type ChatWorld } from "./world";

/**
 * Phase 5 (5D) chat eval harness. Plays each scenario against a fresh synthetic world
 * through the chat turn, then records layer 1 breaks, the scenario's own checks, cost,
 * and time to the first visible line (the first tool line or text, T19). Transcripts
 * stay in the returned result; nothing is logged.
 */

export type ChatEvalCandidate = Readonly<{ label: string; setting: AgentModelSetting; model?: LanguageModel }>;

export type ChatTurnMetrics = Readonly<{
  turn: number;
  user: string;
  parts: readonly ChatPart[];
  /** Milliseconds from sending to the first tool line or text. Null when nothing showed. */
  firstVisibleMs: number | null;
  /** The same, if a tool line showed as soon as the model starts a lookup instead of when it finishes. */
  firstVisibleEarlyMs?: number | null;
  totalMs: number;
  modelCalls: number;
  toolCalls: number;
  usage: AgentModelUsage | null;
  costMicrodollars: number | null;
  error: string | null;
}>;

export type ChatCheck = Readonly<{ id: string; passed: boolean; detail?: string }>;

export type ChatScenarioResult = Readonly<{
  scenario: string;
  label: string;
  model: string;
  turns: readonly ChatTurnMetrics[];
  breaks: readonly ChatRuleBreak[];
  checks: readonly ChatCheck[];
  /** Passed checks over all checks, 0 to 1. */
  score: number;
  costMicrodollars: number | null;
  /** Shown to graders: what the person saw, in order. */
  transcript: string;
}>;

export async function runChatEval(input: Readonly<{
  candidate: ChatEvalCandidate;
  scenarios?: readonly ChatScenario[];
  concurrency?: number;
  signal?: AbortSignal;
  clock?: () => number;
  env?: Readonly<Record<string, string | undefined>>;
}>): Promise<ChatScenarioResult[]> {
  const scenarios = input.scenarios ?? CHAT_SCENARIOS;
  const results: ChatScenarioResult[] = new Array(scenarios.length);
  let next = 0;
  const worker = async () => {
    while (next < scenarios.length) {
      const index = next++;
      results[index] = await runScenario(scenarios[index], input.candidate, input.signal ?? new AbortController().signal, input.clock ?? Date.now, input.env);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, input.concurrency ?? 1) }, worker));
  return results;
}

export async function runScenario(scenario: ChatScenario, candidate: ChatEvalCandidate, signal: AbortSignal, clock: () => number,
  env?: Readonly<Record<string, string | undefined>>): Promise<ChatScenarioResult> {
  const world = cloneWorld(chatEvalWorld(scenario.world));
  const start = cloneWorld(world);
  const fake = createFakeExecutor(world);
  const calls: PhasedCall[] = [];
  let turnIndex = 0;
  let phase: PhasedCall["phase"] = "setup";
  const executor: ChatToolExecutor = async (name, args, meta) => {
    const outcome = await fake.execute(name, args, meta);
    const record = fake.calls.at(-1)!;
    calls.push({ ...record, turn: turnIndex, phase });
    return outcome;
  };

  const timelineText = await buildTimelineText(executor, world);
  const history: ChatMessage[] = [];
  const turns: ChatTurnMetrics[] = [];
  const records: TurnRecord[] = [];
  const undoPlans: { turn: number; plan: UndoPlan; before: ChatWorld }[] = [];
  let pending: readonly PendingWrite[] | null = null;
  const setting = candidate.setting;

  for (const step of scenario.steps) {
    turnIndex += 1;
    if ("answer" in step) {
      phase = "confirm";
      const parts: ChatPart[] = [];
      if (!pending) parts.push({ type: "alert", alert: { code: "failed", text: "There was no question to answer." } });
      else if (step.answer === "yes") {
        const done = await runChatConfirm(pending, executor);
        for (const outcome of done.outcomes) parts.push({ type: "outcome", outcome });
        for (const refusal of done.refusals) parts.push({ type: "refusal", refusal });
      }
      pending = null;
      const user = step.answer === "yes" ? "[Yes]" : "[No]";
      turns.push({ turn: turnIndex, user, parts, firstVisibleMs: 0, totalMs: 0, modelCalls: 0, toolCalls: 0, usage: null, costMicrodollars: 0, error: null });
      records.push({ turn: turnIndex, user, parts });
      continue;
    }
    phase = "turn";
    pending = null;
    const before = cloneWorld(world);
    const started = clock();
    let firstVisible: number | null = null;
    let firstToolStart: number | null = null;
    const usages: AgentModelUsage[] = [];
    let parts: ChatPart[] = [];
    let error: string | null = null;
    let toolCalls = 0;
    try {
      const result = await runChatTurn({
        setting, ...(candidate.model ? { model: candidate.model } : {}), history, userMessage: step.say,
        context: { timezone: world.timezone, today: world.today, now: world.now, timelineText }, tools: executor, signal,
        idempotencyPrefix: `${scenario.id}:${turnIndex}`, ...(env ? { env } : {}),
        onUsage: (usage) => usages.push(usage),
        onToolStart: () => { if (firstToolStart === null) firstToolStart = clock() - started; },
        onEvent: (event: ChatEvent) => { if (firstVisible === null && (event.type === "text" || event.type === "tool")) firstVisible = clock() - started; },
      });
      parts = result.parts;
      pending = result.pendingConfirm;
      toolCalls = result.toolCalls;
      for (const plan of result.undo) undoPlans.push({ turn: turnIndex, plan, before });
    } catch (caught) {
      error = caught instanceof Error ? `${caught.name}: ${caught.message}`.slice(0, 300) : "turn_error";
      parts = [{ type: "alert", alert: { code: "model_unavailable", text: "Chat could not answer just now." } }];
    }
    const usage = usages.length ? sumUsage(usages) : null;
    const early = [firstVisible as number | null, firstToolStart as number | null].filter((item): item is number => item !== null);
    turns.push({ turn: turnIndex, user: step.say, parts, firstVisibleMs: firstVisible, firstVisibleEarlyMs: early.length ? Math.min(...early) : null, totalMs: clock() - started, modelCalls: usages.length,
      toolCalls, usage, costMicrodollars: usage ? cost(setting.model, usage) : null, error });
    records.push({ turn: turnIndex, user: step.say, parts });
    history.push({ id: `u${turnIndex}`, role: "user", createdAt: "2026-11-18T13:40:00Z", parts: [{ type: "text", text: step.say }] });
    history.push({ id: `a${turnIndex}`, role: "assistant", createdAt: "2026-11-18T13:40:01Z", parts });
  }

  const finalChecks = (scenario.expect.final ?? []).map((state) => checkFinal(state, world, start));
  // Undo every immediate write, newest first, and check each record is back as it was.
  phase = "undo";
  const undoResults: { turn: number; outcomeId: string; restored: boolean; detail: string }[] = [];
  for (const { turn, plan, before } of [...undoPlans].reverse()) {
    const ran = await runChatUndo(plan, executor);
    const restored = ran && sameRecord(world, before, plan);
    undoResults.push({ turn, outcomeId: plan.outcomeId, restored, detail: ran ? `${plan.tool} did not restore the record` : `${plan.tool} undo refused` });
  }

  const breaks = checkChatRules({ scenario, world: start, turns: records, calls, undoResults });
  const checks = [...finalChecks, ...expectationChecks(scenario, turns, calls, start)];
  checks.push({ id: "no_errors", passed: turns.every((item) => item.error === null), ...(turns.some((item) => item.error) ? { detail: turns.find((item) => item.error)!.error! } : {}) });
  const costs = turns.map((item) => item.costMicrodollars);
  return {
    scenario: scenario.id, label: candidate.label, model: setting.model, turns, breaks, checks,
    score: checks.length ? checks.filter((item) => item.passed).length / checks.length : 1,
    costMicrodollars: costs.reduce<number>((sum, item) => sum + (item ?? 0), 0),
    transcript: transcriptOf(turns),
  };
}

async function buildTimelineText(executor: ChatToolExecutor, world: ChatWorld): Promise<string> {
  const read = await executor("get_timeline", {}, {});
  if (!read.ok) return "Could not read the Timeline.";
  const result = read.result as { days: { occurrences: Record<string, unknown>[]; day_note?: string | null }[]; needs_decision: { occurrences: Record<string, unknown>[] } | null };
  const line = (item: Record<string, unknown>) => {
    const at = new Date(String(item.effective_start_at));
    const local = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: world.timezone });
    return `- ${local} ${JSON.stringify(item.behavior_title)} ${item.status_label}${item.move ? " (moved today)" : ""} [id ${item.id}, revision ${item.revision}]`;
  };
  const today = result.days[0];
  const needs = result.needs_decision?.occurrences ?? [];
  return [`Today (${world.today}):`, ...today.occurrences.map(line), ...(today.day_note ? [`Day note: ${JSON.stringify(today.day_note)}`] : []),
    `Needs decision (unmarked from earlier days): ${needs.length ? "" : "none"}`, ...needs.map((item) => `${line(item)} on ${item.local_date}`)].join("\n");
}

function resolveDate(world: ChatWorld, date: string): string {
  return date === "today" ? world.today : date;
}

function checkFinal(state: FinalState, world: ChatWorld, start: ChatWorld): ChatCheck {
  try {
    switch (state.kind) {
      case "status": {
        const item = occurrence(world, state.behavior, resolveDate(world, state.date));
        return { id: `final:${state.behavior}:${state.status}`, passed: item.status === state.status, ...(item.status !== state.status ? { detail: item.status } : {}) };
      }
      case "moved_to": {
        const item = occurrence(world, state.behavior, world.today);
        const at = item.moves.at(-1) ?? null;
        return { id: `final:${state.behavior}:moved_to:${state.time ?? "none"}`, passed: at === state.time, ...(at !== state.time ? { detail: String(at) } : {}) };
      }
      case "note_contains": {
        const note = occurrence(world, state.behavior, resolveDate(world, state.date)).note ?? "";
        return { id: `final:${state.behavior}:note`, passed: note.toLowerCase().includes(state.text.toLowerCase()), detail: note.slice(0, 80) };
      }
      case "day_note_contains": {
        const note = world.dayNotes.get(resolveDate(world, state.date))?.note ?? "";
        return { id: "final:day_note", passed: note.toLowerCase().includes(state.text.toLowerCase()), detail: note.slice(0, 80) };
      }
      case "behavior_time": {
        const item = behavior(world, state.behavior);
        const kept = JSON.stringify(item.weekdays) === JSON.stringify(behavior(start, state.behavior).weekdays);
        return { id: `final:${state.behavior}:time`, passed: item.time === state.time && kept, detail: `${item.time} ${JSON.stringify(item.weekdays)}` };
      }
      case "unchanged": {
        const same = JSON.stringify([world.behaviors, world.occurrences, [...world.dayNotes]]) === JSON.stringify([start.behaviors, start.occurrences, [...start.dayNotes]]);
        return { id: "final:unchanged", passed: same };
      }
    }
  } catch (error) {
    return { id: `final:${state.kind}`, passed: false, detail: error instanceof Error ? error.message : "error" };
  }
}

function sameRecord(world: ChatWorld, before: ChatWorld, plan: UndoPlan): boolean {
  const args = plan.args as { occurrence_id?: string; local_date?: string };
  if (args.occurrence_id) {
    const now = world.occurrences.find((item) => item.id === args.occurrence_id);
    const then = before.occurrences.find((item) => item.id === args.occurrence_id);
    return !!now && !!then && now.status === then.status && now.note === then.note && effectiveTime(now) === effectiveTime(then);
  }
  if (args.local_date) return (world.dayNotes.get(args.local_date)?.note ?? null) === (before.dayNotes.get(args.local_date)?.note ?? null);
  return false;
}

function expectationChecks(scenario: ChatScenario, turns: readonly ChatTurnMetrics[], calls: readonly PhasedCall[], world: ChatWorld): ChatCheck[] {
  const checks: ChatCheck[] = [];
  const text = turns.map((item) => textOf(item.parts)).join("\n").toLowerCase();
  for (const mention of scenario.expect.mentions ?? []) {
    const options = mention.split("|");
    checks.push({ id: `mentions:${options[0]}`, passed: options.some((option) => text.includes(option.toLowerCase())) });
  }
  for (const phrase of scenario.expect.never ?? []) checks.push({ id: `never:${phrase}`, passed: !text.includes(phrase.toLowerCase()) });
  const parts = turns.flatMap((item) => item.parts);
  if (scenario.expect.confirm) checks.push({ id: "confirm_shown", passed: parts.some((part) => part.type === "confirm") });
  if (scenario.expect.refusalWithAlternatives) {
    const refusal = parts.find((part) => part.type === "refusal" && part.refusal.alternatives.length > 0);
    const times = refusal && refusal.type === "refusal" ? refusal.refusal.alternatives.map((item) => item.startTime) : [];
    checks.push({ id: "refusal_with_alternatives", passed: !!refusal });
    checks.push({ id: "names_an_alternative", passed: times.some((time) => timeWritten(text, time)), detail: times.join(",") });
  }
  if (scenario.expect.unrelated) {
    const first = turns[0];
    checks.push({ id: "unrelated_no_tools", passed: first.toolCalls === 0 });
    checks.push({ id: "unrelated_under_1_cent", passed: first.costMicrodollars !== null && first.costMicrodollars < 10_000, detail: String(first.costMicrodollars) });
  }
  const costliest = Math.max(0, ...turns.map((item) => item.costMicrodollars ?? 0));
  checks.push({ id: "under_question_ceiling", passed: costliest < CHAT_QUESTION_CEILING_MICRODOLLARS, detail: String(costliest) });
  if (scenario.expect.research) checks.push({ id: "used_advice_card", passed: calls.some((call) => call.name === "search_advice") });
  void world;
  return checks;
}

/** `19:30` written as 7:30 PM, 7:30pm, 7:30 p.m. or 19:30. */
function timeWritten(text: string, time: string): boolean {
  const label = clockLabel(time).toLowerCase();
  const [clock, half] = label.split(" ");
  const short = clock.endsWith(":00") ? clock.slice(0, -3) : null;
  const variants = [label, `${clock}${half}`, `${clock} ${half[0]}.m.`, time, ...(short ? [`${short} ${half}`, `${short}${half}`] : [])];
  return variants.some((item) => text.includes(item));
}

function transcriptOf(turns: readonly ChatTurnMetrics[]): string {
  return turns.map((turn) => {
    const lines = [`PERSON: ${turn.user}`];
    for (const part of turn.parts) {
      if (part.type === "text") lines.push(`CHAT: ${part.text.trim()}`);
      else if (part.type === "tool") lines.push(`  (${part.tool.text})`);
      else if (part.type === "outcome") lines.push(`  [Done by Cadence: ${part.outcome.text}${part.outcome.undo === "available" ? " Undo" : ""}]`);
      else if (part.type === "confirm") lines.push(`  [Cadence asks: ${part.confirm.question} ${part.confirm.items.map((item) => item.text).join("; ")}. Yes · No]`);
      else if (part.type === "refusal") lines.push(`  [Refused by Cadence: ${part.refusal.text}${part.refusal.alternatives.length ? ` Other times: ${part.refusal.alternatives.map((item) => clockLabel(item.startTime)).join(", ")}` : ""}]`);
      else if (part.type === "notice") lines.push(`  [Note under the reply: ${part.notice.text}]`);
      else if (part.type === "alert") lines.push(`  [Alert: ${part.alert.text}]`);
    }
    return lines.join("\n");
  }).join("\n\n");
}

function cost(model: string, usage: AgentModelUsage): number | null {
  const price = modelPrice(model);
  return price ? usageMicrodollars(price, usage) : null;
}

function sumUsage(items: readonly AgentModelUsage[]): AgentModelUsage {
  const total = (pick: (item: AgentModelUsage) => number | null | undefined) =>
    items.reduce<number | null>((sum, item) => { const value = pick(item); return value === null || value === undefined ? sum : (sum ?? 0) + value; }, null);
  return { inputTokens: total((item) => item.inputTokens), cachedInputTokens: total((item) => item.cachedInputTokens),
    cacheWriteTokens: total((item) => item.cacheWriteTokens), outputTokens: total((item) => item.outputTokens), reasoningTokens: total((item) => item.reasoningTokens) };
}

// ----------------------------------------------------------------- report

export const CHAT_MONTHLY_SHARE_MICRODOLLARS = 3_500_000;
/** T21: spending ceiling for one question. */
export const CHAT_QUESTION_CEILING_MICRODOLLARS = 250_000;
export const COACH_MONTHLY_SHARE_MICRODOLLARS = 1_000_000;

export type ChatEvalSummary = Readonly<{
  label: string;
  model: string;
  scenarios: number;
  ruleBreaks: number;
  meanScore: number;
  errors: number;
  /** Cost of the typical 6-message conversation. */
  typicalConversationMicrodollars: number | null;
  /** Typical conversations a month within the chat share (US$3.50), and with the coach share added (US$4.50). */
  conversationsPerMonth: number | null;
  conversationsPerMonthWithCoachShare: number | null;
  totalCostMicrodollars: number;
  firstVisibleP50Ms: number | null;
  firstVisibleP95Ms: number | null;
  /** p95 if tool lines showed when a lookup starts (5A option). */
  firstVisibleEarlyP95Ms: number | null;
  /** Most expensive single question in the run. */
  maxQuestionMicrodollars: number | null;
}>;

export function summarizeChatEval(results: readonly ChatScenarioResult[], typicalId = "typical_day"): ChatEvalSummary {
  const typical = results.find((item) => item.scenario === typicalId)?.costMicrodollars ?? null;
  const firsts = results.flatMap((item) => item.turns.filter((turn) => turn.modelCalls > 0 && turn.firstVisibleMs !== null).map((turn) => turn.firstVisibleMs!)).sort((a, b) => a - b);
  const pct = (p: number, values = firsts) => values.length ? values[Math.min(values.length - 1, Math.ceil(p * values.length) - 1)] : null;
  const early = results.flatMap((item) => item.turns.filter((turn) => turn.modelCalls > 0 && turn.firstVisibleEarlyMs != null).map((turn) => turn.firstVisibleEarlyMs!)).sort((a, b) => a - b);
  const questions = results.flatMap((item) => item.turns.map((turn) => turn.costMicrodollars ?? 0));
  return {
    label: results[0]?.label ?? "", model: results[0]?.model ?? "", scenarios: results.length,
    ruleBreaks: results.reduce((sum, item) => sum + item.breaks.length, 0),
    meanScore: results.reduce((sum, item) => sum + item.score, 0) / (results.length || 1),
    errors: results.reduce((sum, item) => sum + item.turns.filter((turn) => turn.error).length, 0),
    typicalConversationMicrodollars: typical,
    conversationsPerMonth: typical ? Math.floor(CHAT_MONTHLY_SHARE_MICRODOLLARS / typical) : null,
    conversationsPerMonthWithCoachShare: typical ? Math.floor((CHAT_MONTHLY_SHARE_MICRODOLLARS + COACH_MONTHLY_SHARE_MICRODOLLARS) / typical) : null,
    totalCostMicrodollars: results.reduce((sum, item) => sum + (item.costMicrodollars ?? 0), 0),
    firstVisibleP50Ms: pct(0.5), firstVisibleP95Ms: pct(0.95), firstVisibleEarlyP95Ms: pct(0.95, early),
    maxQuestionMicrodollars: questions.length ? Math.max(...questions) : null,
  };
}

export function chatEvalSetting(model: string, override: Partial<AgentModelSetting> = {}): AgentModelSetting {
  return agentModelSetting("chat", { model, ...override });
}
