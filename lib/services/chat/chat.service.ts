import { createHash, randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import {
  CHAT_CONVERSATIONS_PAGE_SIZE, CHAT_MESSAGE_MAX_CHARS, CHAT_PROTOCOL_VERSION,
  type ChatAlert, type ChatConfirmResponse, type ChatConversationList, type ChatConversationView, type ChatEvent,
  type ChatOutcome, type ChatPart, type ChatStopRequest, type ChatStopResponse, type ChatUndoResponse,
} from "@cadence/core/types/chat";
import { finishAgentRun, reserveAgentSpend, settleAgentSpend, startAgentRun } from "@/lib/db/agent-runs.repo";
import {
  ChatStorageError, chatStopRequested, claimChatConfirm, claimChatUndo, releaseChatConfirm, finishChatConfirm, finishChatReply, finishChatUndo, listChatConversations,
  markChatConversationGoogleCalendarTouched, readChatConversation, readChatHistory, saveChatActions, requestChatStop, saveChatConfirm, startChatQuestion, updateChatMessageParts,
} from "@/lib/db/chat.repo";
import { agentCallerConfigured, createAgentContext } from "@/lib/integrations/agent-caller";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { executeMcpOperation } from "@/lib/integrations/operations/execute";
import { agentModelConfigured, agentModelSetting, AgentModelError, type AgentModelUsage } from "@/lib/services/agent-model";
import { modelPrice } from "@/lib/services/agent-model-pricing";
import { authenticateCalendarRequest } from "@/lib/services/google-calendar-request";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import { systemClock } from "@/lib/services/clock";
import { runChatConfirm, runChatUndo } from "./chat-confirm";
import { createLiveChatExecutor, liveChatConnectorReads } from "./chat-executor";
import { CHAT_PROMPT_VERSION, buildChatSystemPrompt } from "./chat-prompt";
import { chatEnabled, chatSources, chatSourcesOff, readChatAiSettings, type ChatAiSettings } from "./chat-settings";
import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import { buildChatToolDefinitions, trimToolResult, withoutNotes } from "./chat-tools";
import { CHAT_LIMITS, budgetText, runChatTurn, summarizeOlderMessages, type ChatSpendGate, type ChatTurnWrite } from "./chat-turn";
import type { ChatPendingWrite, ChatUndoPlan } from "./chat-writes";

/**
 * Advisor plan Phase 5 (5A): the chat routes' work. Each request runs as the
 * signed-in person (web cookie or the Mac's bearer), and every Cadence call and
 * chat row goes through the person's chat agent token (channel "chat").
 */

export class ChatRequestError extends Error {
  constructor(public readonly status: number, public readonly alert: ChatAlert) {
    super(alert.code);
    this.name = "ChatRequestError";
  }
}

/** False until this server instance has run a turn, so the timing log can mark cold starts. */
let warmInstance = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The whole turn, including storage after the model; the route's maxDuration is above it. */
const TURN_DEADLINE_MS = 75_000;
/** A reply still marked streaming after this is treated as abandoned and run again with the same keys. */
const ABANDONED_AFTER_MS = 100_000;
/** How often a running turn checks whether the person pressed Stop. */
const STOP_POLL_MS = 1_000;

/** `settings` is the AI settings read when the session opened, so a turn does not read them again. */
export type ChatSession = Readonly<{ caller: CalendarCaller; context: IntegrationContext; settings?: ChatAiSettings }>;

/** Signs the person in and opens their chat agent context. Refuses when chat is off (4F setting). */
export async function openChatSession(request: Request): Promise<ChatSession> {
  let caller: CalendarCaller;
  try { caller = await authenticateCalendarRequest(request); }
  catch { throw new ChatRequestError(401, { code: "invalid_request", text: "Sign in again to use chat." }); }
  const settings = await readChatAiSettings(caller.client);
  if (!chatEnabled(settings)) throw new ChatRequestError(403, { code: "chat_off", text: "Chat is off. Turn it on in Settings." });
  if (!agentCallerConfigured()) throw new ChatRequestError(503, { code: "model_unavailable", text: "Chat is not available on this server." });
  try {
    return { caller, context: await createAgentContext(caller.user.id, "chat"), settings };
  } catch {
    throw new ChatRequestError(503, { code: "model_unavailable", text: "Chat could not start just now. Try again in a moment." });
  }
}

export type ChatTurnBody = Readonly<{ conversationId: string | null; message: string; clientMessageId: string }>;

export function parseChatTurnBody(value: unknown): ChatTurnBody {
  const body = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const conversationId = body?.conversationId ?? null;
  if (!body || !message || message.length > CHAT_MESSAGE_MAX_CHARS || typeof body.clientMessageId !== "string" || !UUID.test(body.clientMessageId)
    || (conversationId !== null && (typeof conversationId !== "string" || !UUID.test(conversationId)))) {
    throw new ChatRequestError(400, { code: "invalid_request", text: "Chat could not read that message." });
  }
  return { conversationId: conversationId as string | null, message, clientMessageId: body.clientMessageId };
}

function localNow(timezone: string) {
  const now = systemClock.now().toZonedDateTimeISO(timezone);
  const weekday = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][now.dayOfWeek - 1]!;
  return { today: now.toPlainDate().toString(), localTime: now.toPlainTime().toString({ smallestUnit: "minute" }), weekday };
}

async function profileTimezone(caller: CalendarCaller): Promise<string> {
  const { data } = await caller.client.from("profiles").select("timezone").eq("id", caller.user.id).maybeSingle();
  const timezone = typeof data?.timezone === "string" ? data.timezone : "UTC";
  try { Temporal.Now.instant().toZonedDateTimeISO(timezone); return timezone; } catch { return "UTC"; }
}

/**
 * One question. Returns NDJSON events; the turn keeps running and is stored even
 * when the client goes away, so a retry with the same clientMessageId replays it.
 */
export async function streamChatTurn(session: ChatSession, body: ChatTurnBody): Promise<ReadableStream<Uint8Array>> {
  if (!agentModelConfigured()) throw new ChatRequestError(503, { code: "model_unavailable", text: "Chat is not available on this server." });
  const { caller, context } = session;
  const client = context.supabase;
  let started;
  try {
    started = await startChatQuestion(client, { userId: caller.user.id, conversationId: body.conversationId, clientMessageId: body.clientMessageId, text: body.message });
  } catch (error) {
    if (error instanceof ChatStorageError && error.code === "not_found") throw new ChatRequestError(404, { code: "invalid_request", text: "That conversation was not found." });
    throw new ChatRequestError(503, { code: "failed", text: "Chat could not save your message. Try again." });
  }
  const encoder = new TextEncoder();
  const line = (event: ChatEvent) => encoder.encode(`${JSON.stringify(event)}\n`);

  if (started.kind === "replay" || (started.kind === "in_progress" && Date.now() - Date.parse(started.startedAt) < ABANDONED_AFTER_MS)) {
    const events: ChatEvent[] = started.kind === "replay"
      ? [{ type: "start", conversationId: started.conversation.id, userMessageId: started.userMessageId, messageId: started.reply.id, protocol: CHAT_PROTOCOL_VERSION },
        ...started.reply.parts.map(partEvent), { type: "done", messageId: started.reply.id }]
      : [{ type: "start", conversationId: started.conversation.id, userMessageId: started.userMessageId, messageId: started.replyId, protocol: CHAT_PROTOCOL_VERSION },
        { type: "alert", alert: { code: "in_progress", text: "Chat is still answering this. Reopen the conversation in a moment." } },
        { type: "done", messageId: started.replyId }];
    return new ReadableStream({ start(controller) { for (const event of events) controller.enqueue(line(event)); controller.close(); } });
  }

  const conversationId = started.conversation.id;
  const replyId = started.replyId;
  const firstTurn = started.kind === "new" && started.firstTurn;
  const userMessageId = started.userMessageId;

  return new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event: ChatEvent) => {
        if (!open) return;
        try { controller.enqueue(line(event)); } catch { open = false; }
      };
      send({ type: "start", conversationId, userMessageId, messageId: replyId, protocol: CHAT_PROTOCOL_VERSION });
      try {
        await runAndStore({ session, conversationId, replyId, userMessageId, firstTurn, message: body.message, send });
      } finally {
        send({ type: "done", messageId: replyId });
        if (open) { try { controller.close(); } catch { /* client gone */ } }
      }
    },
  });
}

function partEvent(part: ChatPart): ChatEvent {
  switch (part.type) {
    case "text": return { type: "text", delta: part.text };
    case "tool": return { type: "tool", tool: part.tool };
    case "outcome": return { type: "outcome", outcome: part.outcome };
    case "confirm": return { type: "confirm", confirm: part.confirm };
    case "refusal": return { type: "refusal", refusal: part.refusal };
    case "notice": return { type: "notice", notice: part.notice };
    case "alert": return { type: "alert", alert: part.alert };
    case "travel_card": return { type: "travel_card", card: part.card };
  }
}

async function runAndStore(input: Readonly<{
  session: ChatSession; conversationId: string; replyId: string; userMessageId: string; firstTurn: boolean; message: string;
  send: (event: ChatEvent) => void;
}>): Promise<void> {
  const { caller, context } = input.session;
  const client = context.supabase;
  const signal = AbortSignal.timeout(TURN_DEADLINE_MS);
  const setting = agentModelSetting("chat");
  const startedAt = performance.now();
  const coldStart = !warmInstance;
  warmInstance = true;
  const settings = input.session.settings ?? await readChatAiSettings(caller.client);
  const sources = chatSources(settings);
  // Everything before the first model call runs at once: each is a separate database round trip.
  const [timezone, run, history, timelineJson] = await Promise.all([
    profileTimezone(caller),
    startAgentRun(client, { trigger: "chat_turn", model: setting.model, promptVersion: CHAT_PROMPT_VERSION }, signal)
      .then((value) => value.runId, () => undefined),
    readChatHistory(client, input.conversationId, input.replyId),
    input.firstTurn ? firstTurnTimeline(context, sources.notes) : Promise.resolve(null),
  ]);
  const now = localNow(timezone);
  const tools = buildChatToolDefinitions(sources);
  const instructions = buildChatSystemPrompt({ timezone, today: now.today, localTime: now.localTime, weekday: now.weekday, sourcesOff: chatSourcesOff(sources) });
  const onGoogleCalendarRead = async (grantGeneration: number | null) => {
    await markChatConversationGoogleCalendarTouched(client, {
      conversationId: input.conversationId,
      replyId: input.replyId,
      grantGeneration,
    }).catch(() => undefined);
  };
  const reads = liveChatConnectorReads(caller, sources, signal, {
    today: () => localNow(timezone).today,
    timezone,
    onGoogleCalendarRead,
  });
  const executor = createLiveChatExecutor({
    context,
    sources,
    reads,
    today: () => localNow(timezone).today,
    timezone,
    onGoogleCalendarRead,
  });

  let firstTextMs: number | null = null;
  const usage: AgentModelUsage[] = [];
  // What the person has seen so far, kept so a turn that fails later still stores it.
  const sentParts: ChatPart[] = [];
  const send = (event: ChatEvent) => {
    if (firstTextMs === null && event.type === "text") firstTextMs = Math.round(performance.now() - startedAt);
    recordSentPart(sentParts, event); input.send(event);
  };
  const saveWrite = (write: ChatTurnWrite) => saveChatActions(client, { userId: caller.user.id, conversationId: input.conversationId,
    messageId: input.replyId, actions: [{ outcome: write.outcome, operation: write.call.name, undoPlan: write.undo }] });
  if (run === undefined) {
    const alert: ChatAlert = { code: "failed", text: "Chat could not start just now. Try again in a moment." };
    send({ type: "alert", alert });
    await finishChatReply(client, { conversationId: input.conversationId, replyId: input.replyId, parts: [{ type: "alert", alert }], agentRunId: null }).catch(() => undefined);
    return;
  }
  const runId = run;
  const spend: ChatSpendGate = async (estimate) => {
    const decision = await reserveAgentSpend(client, { runId, model: setting.model, estimatedMicrodollars: Math.max(1, estimate) }, signal);
    if (!decision.allowed) return { ok: false, retryAt: decision.resetsAt };
    return { ok: true, settle: async (actual) => { await settleAgentSpend(client, { reservationId: decision.reservationId, actualMicrodollars: actual ?? estimate }); } };
  };

  const earlier = history.messages.filter((message) => message.id !== input.userMessageId);
  const setupMs = Math.round(performance.now() - startedAt);

  let outcome: "success" | "refused_budget" | "model_error" | "timeout" | "error" = "success";
  let errorCode: string | null = null;
  let errorReason: string | null = null;
  let toolCalls: readonly string[] = [];
  let modelCalls = 0;
  let parts: readonly ChatPart[] = sentParts;
  // Stop (CHAT_ROUTES.stop) arrives on another request, so the turn polls its row.
  const stopController = new AbortController();
  const stopPoll = setInterval(() => {
    chatStopRequested(client, input.replyId).then((yes) => { if (yes) stopController.abort(); }, () => undefined);
  }, STOP_POLL_MS);
  try {
    const result = await runChatTurn({
      setting, instructions, tools, history: earlier, summary: summarizeOlderMessages(earlier, CHAT_LIMITS.historyMessages),
      timelineJson, userMessage: input.message, executor, replyId: input.replyId, signal, onEvent: send,
      onUsage: (item) => usage.push(item), spend, stop: stopController.signal, onWrite: saveWrite,
    });
    parts = result.parts;
    toolCalls = result.toolCalls;
    modelCalls = result.modelCalls;
    if (result.stop === "budget_reached") { outcome = "refused_budget"; errorCode = "budget_reached"; }
    else if (result.stop === "stopped") errorCode = "stopped";
    else if (result.stop === "model_error") { outcome = "model_error"; errorCode = "model_unavailable"; errorReason = result.errorReason ?? null; }
    if (result.pending) {
      await saveChatConfirm(client, { userId: caller.user.id, conversationId: input.conversationId, messageId: input.replyId,
        confirm: result.pending.confirm, writes: result.pending.writes });
    }
  } catch (error) {
    const timedOut = signal.aborted;
    outcome = timedOut ? "timeout" : "error";
    errorCode = timedOut ? "timeout" : error instanceof AgentModelError ? "model_unavailable" : "internal_error";
    const alert: ChatAlert = { code: "failed", text: timedOut ? "Chat took too long to answer. Try again." : "Chat could not answer just now. Try again in a moment." };
    send({ type: "alert", alert });
    parts = [...sentParts];
  } finally {
    clearInterval(stopPoll);
  }
  const total = (pick: (item: AgentModelUsage) => number | null) =>
    usage.reduce<number | null>((sum, item) => { const value = pick(item); return value === null ? sum : (sum ?? 0) + value; }, null);
  await finishChatReply(client, { conversationId: input.conversationId, replyId: input.replyId, parts, agentRunId: runId,
    summary: summarizeOlderMessages([...earlier], CHAT_LIMITS.historyMessages) }).catch(() => undefined);
  await finishAgentRun(client, {
    runId, outcome, errorCode, errorReason, inputHash: createHash("sha256").update(`${CHAT_PROMPT_VERSION}\n${input.message}`).digest("hex"),
    modelCalls, inputTokens: total((item) => item.inputTokens), cachedInputTokens: total((item) => item.cachedInputTokens),
    outputTokens: total((item) => item.outputTokens), reasoningTokens: total((item) => item.reasoningTokens), toolCalls,
  }).catch(() => undefined);
  // Timings only, no content: from the saved question to the first model call and to the first reply text.
  reportMonitoringEvent({ name: "chat_turn_timing", context: {
    agent_run_id: runId, setup_ms: setupMs, first_text_ms: firstTextMs, total_ms: Math.round(performance.now() - startedAt),
    model_calls: modelCalls, tool_calls: toolCalls.length, first_turn: input.firstTurn, cold_start: coldStart, outcome,
  } });
}

/** Today's Timeline for the first turn: a compact projection, cut to the tool-result size. */
async function firstTurnTimeline(context: IntegrationContext, notes: boolean): Promise<string | null> {
  try {
    const result = await executeMcpOperation("get_timeline", context, { days: 1, include_needs_decision: true });
    if (!result.ok) return null;
    return trimToolResult(compactTimeline(notes ? result.value : withoutNotes(result.value)));
  } catch { return null; }
}

/** Keeps what answering needs: ids, titles, times, status, revision and notes. */
export function compactTimeline(value: unknown): unknown {
  const out = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const item = (raw: unknown) => {
    const occurrence = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const keep = ["id", "behavior_title", "local_date", "effective_start_at", "status", "revision", "note"];
    const schedule = occurrence.schedule && typeof occurrence.schedule === "object" ? occurrence.schedule as Record<string, unknown> : null;
    return { ...Object.fromEntries(keep.filter((key) => key in occurrence).map((key) => [key, occurrence[key]])),
      ...(occurrence.move ? { moved_today: true } : {}), ...(schedule ? { schedule: schedule.label } : {}) };
  };
  const days = Array.isArray(out.days) ? out.days as Array<Record<string, unknown>> : [];
  const needs = out.needs_decision && typeof out.needs_decision === "object" ? out.needs_decision as Record<string, unknown> : null;
  return {
    timezone: out.timezone, today: out.today_local_date,
    items: days.flatMap((day) => Array.isArray(day.occurrences) ? day.occurrences.map(item) : []),
    ...(days[0] && "day_note" in days[0] ? { day_note: days[0].day_note } : {}),
    needs_decision: needs && Array.isArray(needs.occurrences) ? { items: needs.occurrences.map(item), total: needs.total_count } : null,
  };
}

// ----------------------------------------------------------------- confirm and Undo

export function parseConfirmBody(value: unknown): Readonly<{ confirmId: string; answer: "yes" | "no" }> {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (typeof body.confirmId !== "string" || !UUID.test(body.confirmId) || (body.answer !== "yes" && body.answer !== "no")) {
    throw new ChatRequestError(400, { code: "invalid_request", text: "Chat could not read that answer." });
  }
  return { confirmId: body.confirmId, answer: body.answer };
}

export async function answerChatConfirm(session: ChatSession, body: Readonly<{ confirmId: string; answer: "yes" | "no" }>): Promise<ChatConfirmResponse> {
  const { caller, context } = session;
  const client = context.supabase;
  let claim;
  try { claim = await claimChatConfirm(client, body.confirmId); }
  catch (error) {
    if (error instanceof ChatStorageError && error.code === "not_found") throw new ChatRequestError(404, { code: "invalid_request", text: "That question was not found." });
    throw error;
  }
  const { row } = claim;
  const stateOf = (state: string) => (state === "accepted" || state === "declined" || state === "expired" ? state : "expired") as "accepted" | "declined" | "expired";
  if (!claim.claimed) {
    return { confirm: { ...row.confirm, state: row.state === "answering" ? row.confirm.state : stateOf(row.state) }, outcomes: [], refusals: [],
      ...(row.state === "expired" ? { alert: { code: "failed" as const, text: "That question has expired. Ask again." } } : {}) };
  }
  const setConfirmState = (state: "accepted" | "declined" | "expired", extra: readonly ChatPart[] = []) =>
    updateChatMessageParts(client, row.messageId, (parts) => {
      const updated = parts.map((part) => part.type === "confirm" && part.confirm.id === row.id ? { type: "confirm" as const, confirm: { ...part.confirm, state } } : part);
      return [...updated, ...extra];
    });
  if (body.answer === "no") {
    await finishChatConfirm(client, row.id, "declined");
    await setConfirmState("declined");
    return { confirm: { ...row.confirm, state: "declined" }, outcomes: [], refusals: [] };
  }
  let run;
  try {
    const settings = await readChatAiSettings(caller.client);
    const sources = chatSources(settings);
    const timezone = await profileTimezone(caller);
    const signal = AbortSignal.timeout(TURN_DEADLINE_MS);
    const executor = createLiveChatExecutor({ context, sources, reads: liveChatConnectorReads(caller, sources, signal), today: () => localNow(timezone).today, timezone });
    run = await runChatConfirm({ confirmId: row.id, writes: row.writes as ChatPendingWrite[], executor, resumed: claim.resumed === true });
    if (run.state !== "expired") {
      await saveChatActions(client, { userId: caller.user.id, conversationId: row.conversationId, messageId: row.messageId,
        actions: run.writes.map((write) => ({ outcome: write.outcome, operation: write.call.name, undoPlan: write.undo })) });
    }
  } catch (error) {
    // The next Yes resumes: the write keys replay what already ran, and the rest runs.
    await releaseChatConfirm(client, row.id).catch(() => undefined);
    throw error;
  }
  if (run.state === "expired") {
    await finishChatConfirm(client, row.id, "expired");
    await setConfirmState("expired");
    return { confirm: { ...row.confirm, state: "expired" }, outcomes: [], refusals: [],
      alert: { code: "failed", text: "Something changed since chat asked, so nothing was changed. Ask again." } };
  }
  await finishChatConfirm(client, row.id, "accepted");
  const outcomes = run.writes.map((write) => write.outcome);
  await setConfirmState("accepted", [
    ...outcomes.map((outcome) => ({ type: "outcome" as const, outcome })),
    ...run.refusals.map((refusal) => ({ type: "refusal" as const, refusal })),
  ]);
  return { confirm: { ...row.confirm, state: "accepted" }, outcomes, refusals: run.refusals };
}

export function parseStopBody(value: unknown): ChatStopRequest {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (typeof body.clientMessageId !== "string" || !UUID.test(body.clientMessageId)) {
    throw new ChatRequestError(400, { code: "invalid_request", text: "Chat could not read that request." });
  }
  return { clientMessageId: body.clientMessageId };
}

/** Asks the running turn for this question to stop. No model call. */
export async function stopChatTurn(session: ChatSession, body: ChatStopRequest): Promise<ChatStopResponse> {
  try {
    return { stopped: await requestChatStop(session.context.supabase, body.clientMessageId) };
  } catch {
    throw new ChatRequestError(503, { code: "failed", text: "Chat could not stop just now." });
  }
}

export function parseUndoBody(value: unknown): Readonly<{ outcomeId: string }> {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (typeof body.outcomeId !== "string" || !UUID.test(body.outcomeId)) throw new ChatRequestError(400, { code: "invalid_request", text: "Chat could not read that Undo." });
  return { outcomeId: body.outcomeId };
}

export async function undoChatOutcome(session: ChatSession, body: Readonly<{ outcomeId: string }>): Promise<ChatUndoResponse> {
  const { caller, context } = session;
  const client = context.supabase;
  let claim;
  try { claim = await claimChatUndo(client, body.outcomeId); }
  catch (error) {
    if (error instanceof ChatStorageError && error.code === "not_found") throw new ChatRequestError(404, { code: "invalid_request", text: "That change was not found." });
    throw error;
  }
  if (!claim.claimed) return { outcome: claim.row.outcome };
  const settings = await readChatAiSettings(caller.client);
  const sources = chatSources(settings);
  const timezone = await profileTimezone(caller);
  const signal = AbortSignal.timeout(TURN_DEADLINE_MS);
  const executor = createLiveChatExecutor({ context, sources, reads: liveChatConnectorReads(caller, sources, signal), today: () => localNow(timezone).today });
  const plan = claim.row.undoPlan as ChatUndoPlan | null;
  let outcome: ChatOutcome;
  let alert: ChatAlert | undefined;
  const run = plan ? await runChatUndo({ outcome: claim.row.outcome, plan, executor, idempotencyKey: `chat:undo:${body.outcomeId}` }).catch(() => ({ ok: false as const, reason: "failed" as const }))
    : { ok: false as const, reason: "changed" as const };
  if (run.ok) outcome = { ...claim.row.outcome, undo: "done", text: run.text };
  else if (run.reason === "changed") {
    outcome = { ...claim.row.outcome, undo: "unavailable" };
    alert = { code: "failed", text: "That changed since, so chat cannot undo it." };
  } else {
    outcome = claim.row.outcome;
    alert = { code: "failed", text: "Chat could not undo that just now. Try again." };
  }
  await finishChatUndo(client, body.outcomeId, outcome);
  await updateChatMessageParts(client, claim.row.messageId, (parts) =>
    parts.map((part) => part.type === "outcome" && part.outcome.id === body.outcomeId ? { type: "outcome" as const, outcome } : part));
  return { outcome, ...(alert ? { alert } : {}) };
}

// ----------------------------------------------------------------- history

export async function listConversations(session: ChatSession, url: URL): Promise<ChatConversationList> {
  const before = url.searchParams.get("before");
  if (before !== null && Number.isNaN(Date.parse(before))) throw new ChatRequestError(400, { code: "invalid_request", text: "Chat could not read that page." });
  return listChatConversations(session.context.supabase, { before, limit: CHAT_CONVERSATIONS_PAGE_SIZE });
}

export async function getConversation(session: ChatSession, id: string): Promise<ChatConversationView> {
  if (!UUID.test(id)) throw new ChatRequestError(404, { code: "invalid_request", text: "That conversation was not found." });
  try { return await readChatConversation(session.context.supabase, id); }
  catch (error) {
    if (error instanceof ChatStorageError && error.code === "not_found") throw new ChatRequestError(404, { code: "invalid_request", text: "That conversation was not found." });
    throw error;
  }
}

/** Typical cost check for the run log and evals: the model must have a price. */
export function chatModelPriced(): boolean {
  return modelPrice(agentModelSetting("chat").model) !== null;
}

export { budgetText, randomUUID as newChatId };

/** Adds one streamed event to the parts the person has seen (text deltas join the last text part). */
export function recordSentPart(parts: ChatPart[], event: ChatEvent): void {
  switch (event.type) {
    case "text": {
      const last = parts.at(-1);
      if (last?.type === "text") parts[parts.length - 1] = { type: "text", text: last.text + event.delta };
      else parts.push({ type: "text", text: event.delta });
      return;
    }
    case "tool": parts.push({ type: "tool", tool: event.tool }); return;
    case "outcome": parts.push({ type: "outcome", outcome: event.outcome }); return;
    case "refusal": parts.push({ type: "refusal", refusal: event.refusal }); return;
    case "notice": parts.push({ type: "notice", notice: event.notice }); return;
    case "alert": parts.push({ type: "alert", alert: event.alert }); return;
    case "travel_card": parts.push({ type: "travel_card", card: event.card }); return;
    // A confirm is stored only with its pending writes, so a failed turn leaves it out.
    default: return;
  }
}
