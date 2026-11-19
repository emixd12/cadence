import { randomUUID } from "node:crypto";
import { streamText, type LanguageModel, type ModelMessage } from "ai";
import {
  CHAT_MEDICAL_NOTICE, type ChatAlert, type ChatConfirm, type ChatEvent, type ChatMessage, type ChatOutcome, type ChatPart,
  type ChatRefusal, type ChatToolSubject,
} from "@cadence/core/types/chat";
import { estimateCallMicrodollars, modelPrice, usageMicrodollars } from "@/lib/services/agent-model-pricing";
import {
  AgentModelError, agentModelFailure, modelTransport, parseUsage, resolveAgentModel,
  type AgentModelSetting, type AgentModelUsage,
} from "@/lib/services/agent-model";
import { chatSummaryPreamble, chatTimelinePreamble } from "./chat-prompt";
import {
  CHAT_TOOL_SUBJECT, buildChatTools, chatToolLineText, isChatWrite, isImmediateWrite, trimToolResult,
  type ChatToolDefinition, type ChatToolName, type ChatWriteName,
} from "./chat-tools";
import {
  describeOutcome, describePendingWrite, factsFrom, factsReadFor, guardFrom, moveRefusal, outcomeKind, outcomeTargets,
  undoPlanFor, withRevision, type ChatPendingWrite, type ChatToolExecutor, type ChatToolResult, type ChatUndoPlan,
  type ChatWriteCall, type ChatWriteFacts,
} from "./chat-writes";

/**
 * Advisor plan Phase 5 (5A): one chat turn (one question), with no route, storage or
 * auth, so the eval harness (5D) runs exactly this code with a fake executor.
 *
 * The loop calls the model, runs the tool calls it asks for, and repeats until the
 * model answers without tools. Rules decided here in code, never by the model:
 *   - T12: the first single-record write of the question runs at once and gets an
 *     Undo. Behavior changes and every further write wait for one Yes.
 *   - T14: every tool call has a fixed idempotency key from the reply's id and the
 *     call's position, so a retried reply never writes twice.
 *   - T21: tool results are cut to 12 KB, at most 8 tool calls run, each model call
 *     reserves spend first, and the question stops at its spending ceiling.
 *   - D6: `medical_notice` shows Cadence's fixed disclaimer; the model only decides when.
 */

/** T21 defaults. 5D tunes these. */
export const CHAT_LIMITS = Object.freeze({
  maxToolCalls: 8,
  /** Model calls in one question: one per tool round, plus the answer. */
  maxModelCalls: 10,
  /** US$0.25 per question. */
  questionCeilingMicrodollars: 250_000,
  /** Messages resent to the model; older ones become the summary. */
  historyMessages: 20,
});

export type ChatLimits = Readonly<{ [K in keyof typeof CHAT_LIMITS]: number }>;

/** Reserves spend before one model call; `settle` records what it cost. */
export type ChatSpendGate = (estimateMicrodollars: number) => Promise<
  | Readonly<{ ok: true; settle: (actualMicrodollars: number | null) => Promise<void> }>
  | Readonly<{ ok: false; retryAt: string | null }>
>;

export type ChatTurnInput = Readonly<{
  setting: AgentModelSetting;
  /** Tests and evals may pass a model; otherwise the setting's model on this deployment's transport. */
  model?: LanguageModel;
  instructions: string;
  tools: readonly ChatToolDefinition[];
  /** Earlier messages of the conversation, oldest first, without this question. */
  history: readonly ChatMessage[];
  /** Kept by the server: a summary of messages older than the history cap. */
  summary?: string | null;
  /** First turn of a conversation: today's Timeline as JSON. */
  timelineJson?: string | null;
  userMessage: string;
  executor: ChatToolExecutor;
  /** The reply's message id; every idempotency key starts with it. */
  replyId: string;
  signal: AbortSignal;
  onEvent: (event: ChatEvent) => void;
  onUsage?: (usage: AgentModelUsage) => void;
  spend?: ChatSpendGate;
  limits?: Partial<ChatLimits>;
  /** Tests: deterministic ids for parts. */
  newId?: () => string;
}>;

export type ChatTurnResult = Readonly<{
  parts: readonly ChatPart[];
  /** Writes that ran, with how to undo each, in order. */
  writes: readonly Readonly<{ outcome: ChatOutcome; call: ChatWriteCall; undo: ChatUndoPlan | null; facts: ChatWriteFacts }>[];
  /** Set when writes wait for a Yes. The caller stores it with the confirm. */
  pending: Readonly<{ confirm: ChatConfirm; writes: readonly ChatPendingWrite[] }> | null;
  toolCalls: readonly string[];
  modelCalls: number;
  usage: readonly AgentModelUsage[];
  /** Why the turn stopped early, for the run log. */
  stop: "answered" | "tool_limit" | "ceiling" | "budget_reached" | "model_error";
  errorReason?: string;
}>;

export const MEDICAL_NOTICE_TOOL: ChatToolDefinition = {
  name: "medical_notice" as ChatToolName,
  description: "Call this once, with no input, whenever you decline to give medical advice. Cadence then shows its short disclaimer under your reply.",
  inputSchema: { type: "object", additionalProperties: false, properties: {} } as ChatToolDefinition["inputSchema"],
};

const CONFIRM_TTL_MS = 15 * 60 * 1000;
const WAITING = { status: "waiting_for_confirmation", message: "Cadence will ask the person to confirm this with Yes or No under your reply. Say briefly what is waiting; do not ask again in words." };

export async function runChatTurn(input: ChatTurnInput): Promise<ChatTurnResult> {
  const limits = { ...CHAT_LIMITS, ...input.limits };
  const newId = input.newId ?? randomUUID;
  const parts: ChatPart[] = [];
  const writes: Array<ChatTurnResult["writes"][number]> = [];
  const pending: ChatPendingWrite[] = [];
  const toolCalls: string[] = [];
  const usage: AgentModelUsage[] = [];
  const subjectsShown = new Map<ChatToolSubject, "done" | "failed" | "off">();
  let writeAttempted = false;
  let medicalShown = false;
  let position = 0;
  let modelCalls = 0;
  let spent = 0;
  let stop: ChatTurnResult["stop"] = "answered";
  let errorReason: string | undefined;

  const emit = (event: ChatEvent) => {
    input.onEvent(event);
    switch (event.type) {
      case "text": {
        const last = parts.at(-1);
        if (last?.type === "text") parts[parts.length - 1] = { type: "text", text: last.text + event.delta };
        else parts.push({ type: "text", text: event.delta });
        break;
      }
      case "tool": parts.push({ type: "tool", tool: event.tool }); break;
      case "outcome": parts.push({ type: "outcome", outcome: event.outcome }); break;
      case "confirm": parts.push({ type: "confirm", confirm: event.confirm }); break;
      case "refusal": parts.push({ type: "refusal", refusal: event.refusal }); break;
      case "notice": parts.push({ type: "notice", notice: event.notice }); break;
      case "alert": parts.push({ type: "alert", alert: event.alert }); break;
      default: break;
    }
  };
  const alert = (value: ChatAlert) => emit({ type: "alert", alert: value });
  const toolLine = (subject: ChatToolSubject | undefined, state: "done" | "failed" | "off") => {
    if (!subject) return;
    const shown = subjectsShown.get(subject);
    // One line per subject per question; a failure after a success still shows.
    if (shown === state || (shown && state === "done")) return;
    subjectsShown.set(subject, state);
    emit({ type: "tool", tool: { id: newId(), subject, text: chatToolLineText(subject, state), state } });
  };
  const key = () => `chat:${input.replyId}:${position++}`;
  const run = (name: ChatToolName, args: Readonly<Record<string, unknown>>, withKey: boolean) =>
    input.executor(name, args, { idempotencyKey: withKey ? key() : null });

  const model = input.model ?? resolveAgentModel(input.setting.model);
  const tools = buildChatTools([...input.tools, MEDICAL_NOTICE_TOOL]);
  const price = modelPrice(input.setting.model);
  const messages: ModelMessage[] = buildHistoryMessages(input, limits.historyMessages);

  for (;;) {
    input.signal.throwIfAborted();
    if (modelCalls >= limits.maxModelCalls) { stop = "tool_limit"; break; }
    const toolsAllowed = toolCalls.length < limits.maxToolCalls;
    // Spend: reserve before the call; refuse past the question's ceiling.
    const requestCharacters = input.instructions.length + JSON.stringify(messages).length
      + (toolsAllowed ? JSON.stringify(input.tools).length : 0);
    const estimate = price ? estimateCallMicrodollars(price, { requestCharacters, maxOutputTokens: input.setting.maxOutputTokens }) : 0;
    if (!price && !input.model) throw new AgentModelError("not_configured", "model_price_unknown");
    if (spent + estimate > limits.questionCeilingMicrodollars && modelCalls > 0) {
      stop = "ceiling";
      alert({ code: "tool_limit", text: "That question needs more than chat can do in one go. Try asking about one part of it." });
      break;
    }
    let settle: ((actual: number | null) => Promise<void>) | null = null;
    if (input.spend) {
      const decision = await input.spend(estimate);
      if (!decision.ok) {
        stop = "budget_reached";
        alert({ code: "budget_reached", text: budgetText(decision.retryAt), ...(decision.retryAt ? { retryAt: decision.retryAt } : {}) });
        break;
      }
      settle = decision.settle;
    }
    modelCalls += 1;
    let callUsage: AgentModelUsage | null = null;
    const calls: Array<{ toolCallId: string; toolName: string; input: unknown }> = [];
    let responseMessages: ModelMessage[] = [];
    try {
      const result = streamText({
        model,
        instructions: { role: "system", content: input.instructions, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
        messages,
        tools,
        toolChoice: toolsAllowed ? "auto" : "none",
        reasoning: input.setting.reasoning,
        maxOutputTokens: input.setting.maxOutputTokens,
        maxRetries: 0,
        abortSignal: AbortSignal.any([input.signal, AbortSignal.timeout(input.setting.timeoutMs)]),
        providerOptions: {
          openai: { store: false, reasoningSummary: null, parallelToolCalls: true },
          ...(modelTransport() === "gateway" ? { gateway: { tags: ["agent:chat"] } } : {}),
        },
      });
      for await (const part of result.fullStream) {
        if (part.type === "text-delta" && part.text) emit({ type: "text", delta: part.text });
        // The muted line shows as soon as the model starts a lookup, not after it finishes,
        // so the first visible line comes early (5D's 2-second bar). A failed read adds its own line.
        else if (part.type === "tool-input-start" && toolsAllowed && !isChatWrite(part.toolName)
          && input.tools.some((tool) => tool.name === part.toolName) && toolCalls.length < limits.maxToolCalls) {
          toolLine(CHAT_TOOL_SUBJECT[part.toolName], "done");
        }
        else if (part.type === "tool-call") calls.push({ toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
        else if (part.type === "error") throw part.error;
      }
      callUsage = parseUsage(await result.usage);
      responseMessages = (await result.responseMessages) as ModelMessage[];
    } catch (error) {
      const actual = callUsage && price ? usageMicrodollars(price, callUsage) : null;
      await settle?.(actual ?? estimate).catch(() => undefined);
      if (input.signal.aborted) throw error;
      const mapped = agentModelFailure(error, input.signal);
      stop = "model_error";
      errorReason = mapped instanceof AgentModelError ? mapped.reason : "provider_shape";
      alert({ code: "model_unavailable", text: "Chat could not answer just now. Try again in a moment." });
      break;
    }
    if (callUsage) { usage.push(callUsage); input.onUsage?.(callUsage); }
    const actual = callUsage && price ? usageMicrodollars(price, callUsage) : null;
    spent += actual ?? estimate;
    await settle?.(actual ?? estimate).catch(() => undefined);

    if (calls.length === 0) break;
    // The medical notice alone ends the turn: the answer is already written (5D finding).
    if (calls.every((call) => call.toolName === MEDICAL_NOTICE_TOOL.name)) {
      if (!medicalShown) { medicalShown = true; emit({ type: "notice", notice: CHAT_MEDICAL_NOTICE }); }
      break;
    }
    messages.push(...responseMessages);

    const results: Array<{ toolCallId: string; toolName: string; value: string }> = [];
    for (const call of calls) {
      const answer = (value: unknown) => results.push({ toolCallId: call.toolCallId, toolName: call.toolName, value: trimToolResult(value) });
      const args = call.input && typeof call.input === "object" && !Array.isArray(call.input) ? stripServerKeys(call.input as Record<string, unknown>) : {};
      if (call.toolName === MEDICAL_NOTICE_TOOL.name) {
        if (!medicalShown) { medicalShown = true; emit({ type: "notice", notice: CHAT_MEDICAL_NOTICE }); }
        answer({ shown: true, note: "Cadence shows the disclaimer. Do not repeat your answer." });
        continue;
      }
      if (!input.tools.some((tool) => tool.name === call.toolName)) { answer({ error: "unknown_tool" }); continue; }
      if (toolCalls.length >= limits.maxToolCalls) { answer({ error: "tool_limit", message: "No more lookups in this question. Answer with what you have." }); continue; }
      toolCalls.push(call.toolName);
      const name = call.toolName as ChatToolName;

      if (!isChatWrite(name)) {
        const read = await run(name, args, false);
        if (read.ok) toolLine(CHAT_TOOL_SUBJECT[name], sourceState(read.result));
        else toolLine(CHAT_TOOL_SUBJECT[name], read.error.code === "source_off" ? "off" : "failed");
        answer(read.ok ? read.result : { error: read.error.code, message: read.error.message });
        continue;
      }

      // A write. Read its record first: the outcome, the confirm line and Undo need it.
      const write: ChatWriteCall = { name: name as ChatWriteName, args };
      // Claim the one immediate slot before any await, so parallel calls never both run (T12).
      const runNow = isImmediateWrite(name) && !writeAttempted && pending.length === 0;
      if (runNow) writeAttempted = true;
      const factsRead = factsReadFor(write);
      const facts = factsFrom(write, factsRead ? await run(factsRead.name, factsRead.args, false) : null);
      if (!runNow) {
        pending.push({ call: write, item: { text: describePendingWrite(write, facts), kind: outcomeKind(write.name) }, guard: guardFrom(facts) });
        answer(WAITING);
        continue;
      }
      const prepared = withRevision(write, facts);
      const done = await run(prepared.name, prepared.args, true);
      answer(done.ok ? done.result : { error: done.error.code, message: done.error.message });
      const refused = done.ok ? moveRefusal(done.result) : null;
      if (!done.ok || refused) {
        emit({ type: "refusal", refusal: refusalPart(newId(), prepared, done, refused) });
        continue;
      }
      const undo = undoPlanFor(prepared, done.result, facts);
      const outcome: ChatOutcome = {
        id: newId(), kind: outcomeKind(prepared.name), text: describeOutcome(prepared, done.result, facts), confirmed: false,
        undo: undo ? "available" : "unavailable", ...outcomeTargets(prepared, done.result),
      };
      writes.push({ outcome, call: prepared, undo, facts });
      emit({ type: "outcome", outcome });
    }
    messages.push({ role: "tool", content: results.map((result) => ({
      type: "tool-result" as const, toolCallId: result.toolCallId, toolName: result.toolName, output: { type: "text" as const, value: result.value },
    })) });
    if (toolCalls.length >= limits.maxToolCalls) stop = "tool_limit";
  }

  let confirm: ChatConfirm | null = null;
  if (pending.length) {
    confirm = {
      id: newId(),
      question: pending.length === 1 ? "Make this change?" : `Make these ${pending.length} changes?`,
      items: pending.map((write) => write.item),
      expiresAt: new Date(Date.now() + CONFIRM_TTL_MS).toISOString(),
      state: "pending",
    };
    emit({ type: "confirm", confirm });
  }
  if (stop === "tool_limit" && !parts.some((part) => part.type === "text")) {
    alert({ code: "tool_limit", text: "That question needs more than chat can do in one go. Try asking about one part of it." });
  }
  return {
    parts, writes, pending: confirm ? { confirm, writes: pending } : null, toolCalls, modelCalls, usage,
    stop: stop === "tool_limit" && parts.some((part) => part.type === "text") ? "answered" : stop, ...(errorReason ? { errorReason } : {}),
  };
}

/** Writes made by chat never take keys the model invented. */
function stripServerKeys(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([key]) => key !== "idempotency_key" && key !== "external_ref"));
}

/** A connector read reports which sources it could read. */
function sourceState(result: unknown): "done" | "failed" | "off" {
  const sources = result && typeof result === "object" && Array.isArray((result as { sources?: unknown }).sources)
    ? (result as { sources: Array<{ state?: string }> }).sources : null;
  if (!sources || sources.length === 0) return "done";
  if (sources.some((source) => source.state === "read" || source.state === "partial")) return "done";
  if (sources.every((source) => source.state === "off")) return "off";
  return "failed";
}

function refusalPart(id: string, call: ChatWriteCall, done: ChatToolResult, refused: ReturnType<typeof moveRefusal>): ChatRefusal {
  const occurrenceId = typeof call.args.occurrence_id === "string" ? call.args.occurrence_id : undefined;
  if (refused) {
    return { id, kind: outcomeKind(call.name), text: refused.message, reason: refused.reason, ...(occurrenceId ? { occurrenceId } : {}),
      alternatives: refused.alternatives.map((item) => ({ startAt: item.start_at, startTime: item.start_time })) };
  }
  const error = !done.ok ? done.error : { code: "failed", message: "Cadence could not make that change." };
  return { id, kind: outcomeKind(call.name), text: plainError(error.code, error.message), reason: error.code, ...(occurrenceId ? { occurrenceId } : {}),
    alternatives: (error.alternatives ?? []).map((item) => ({ startAt: item.start_at, startTime: item.start_time })) };
}

function plainError(code: string, message: string): string {
  if (code === "conflict") return "That item changed since chat read it. Ask again to use the latest.";
  if (code === "not_found") return "Chat could not find that item.";
  if (code === "rate_limited") return "Too many changes at once. Try again in a minute.";
  if (code === "calendar_busy") return message;
  return "Cadence could not make that change.";
}

export function budgetText(retryAt: string | null): string {
  if (!retryAt) return "Chat has used its budget for now.";
  const date = new Date(retryAt);
  const label = date.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  return `Chat has used this month's budget. It is back on ${label}.`;
}

/**
 * The messages sent to the model: the summary of older messages, the last
 * `cap` messages as plain text, today's Timeline on a conversation's first turn,
 * and this question. Cadence's own parts (outcomes, confirms, refusals) are
 * resent as short bracketed notes so the model knows what already happened.
 */
export function buildHistoryMessages(input: Pick<ChatTurnInput, "history" | "summary" | "timelineJson" | "userMessage">, cap: number): ModelMessage[] {
  const recent = input.history.slice(-cap);
  const messages: ModelMessage[] = [];
  const preamble = [
    input.summary ? chatSummaryPreamble(input.summary) : null,
    input.timelineJson ? chatTimelinePreamble(input.timelineJson) : null,
  ].filter((item): item is string => !!item);
  for (const message of recent) {
    const text = messageText(message);
    if (!text) continue;
    messages.push(message.role === "user" ? { role: "user", content: text } : { role: "assistant", content: text });
  }
  const question = preamble.length ? `${preamble.join("\n\n")}\n\nThe person asks:\n${input.userMessage}` : input.userMessage;
  messages.push({ role: "user", content: question });
  return messages;
}

/** A stored message as text for the model. Tool lines stay, so the model knows what it read; notices are left out. */
export function messageText(message: ChatMessage): string {
  return message.parts.map((part) => {
    switch (part.type) {
      case "text": return part.text;
      case "tool": return `[Cadence: ${part.tool.text}]`;
      case "outcome": return `[Cadence: ${part.outcome.text}${part.outcome.undo === "done" ? " Then undone." : ""}]`;
      case "confirm": return `[Cadence asked: ${part.confirm.question} ${part.confirm.items.map((item) => item.text).join("; ")}. Answer: ${part.confirm.state}]`;
      case "refusal": return `[Cadence: ${part.refusal.text}]`;
      case "alert": return `[Cadence: ${part.alert.text}]`;
      default: return "";
    }
  }).filter(Boolean).join("\n").trim();
}

/**
 * The summary of messages older than the cap, written by code (no model call): the
 * person's earlier questions and what Cadence did, each cut short.
 */
export function summarizeOlderMessages(history: readonly ChatMessage[], cap: number, maxChars = 2_000): string | null {
  const older = history.slice(0, Math.max(0, history.length - cap));
  if (!older.length) return null;
  const lines = older.map((message) => {
    const text = messageText(message).replace(/\s+/g, " ");
    return `${message.role === "user" ? "Person" : "Chat"}: ${text.length > 160 ? `${text.slice(0, 157)}...` : text}`;
  });
  let summary = lines.join("\n");
  if (summary.length > maxChars) summary = `...${summary.slice(summary.length - maxChars)}`;
  return summary;
}
