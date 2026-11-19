import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json } from "@/lib/db/database.types";
import type {
  ChatConfirm, ChatConversationSummary, ChatMessage, ChatOutcome, ChatPart,
} from "@cadence/core/types/chat";

// Advisor plan Phase 5 (5A). Every call runs on the chat agent client
// (lib/integrations/agent-caller.ts, channel "chat"); the table policies refuse
// every other token (migration 20261119220000).

export class ChatStorageError extends Error {
  constructor(public readonly code: "not_found" | "database_error", options?: ErrorOptions) {
    super(`Chat storage failed: ${code}.`, options);
    this.name = "ChatStorageError";
  }
}

type Row<T> = T & Record<string, unknown>;
const fail = (error: unknown): never => { throw new ChatStorageError("database_error", { cause: error }); };

/** The stored reply of a question, when this send was seen before. */
export type ChatQuestionStart =
  | Readonly<{ kind: "new"; conversation: ChatConversationSummary; userMessageId: string; replyId: string; firstTurn: boolean }>
  | Readonly<{ kind: "replay"; conversation: ChatConversationSummary; userMessageId: string; reply: ChatMessage }>
  | Readonly<{ kind: "in_progress"; conversation: ChatConversationSummary; userMessageId: string; replyId: string; startedAt: string }>;

function summary(row: Row<{ id: string; title: string; created_at: string; updated_at: string }>): ChatConversationSummary {
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

function message(row: Row<{ id: string; role: string; created_at: string; parts: unknown }>): ChatMessage {
  return { id: row.id, role: row.role === "user" ? "user" : "assistant", createdAt: row.created_at, parts: (Array.isArray(row.parts) ? row.parts : []) as ChatPart[] };
}

/** First words of the first message, for the past-conversations list. */
export function chatConversationTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "Conversation";
  return flat.length <= 60 ? flat : `${flat.slice(0, 57).replace(/\s+\S*$/, "")}...`;
}

/**
 * Stores the person's message and opens the reply. A newer message expires the
 * conversation's pending confirms (T13). A send seen before returns its stored reply.
 */
export async function startChatQuestion(client: AppSupabaseClient, input: Readonly<{
  userId: string; conversationId: string | null; clientMessageId: string; text: string;
}>): Promise<ChatQuestionStart> {
  let conversation: ChatConversationSummary;
  let firstTurn = false;
  if (input.conversationId) {
    const { data, error } = await client.from("chat_conversations").select("id, title, created_at, updated_at")
      .eq("id", input.conversationId).maybeSingle();
    if (error) fail(error);
    if (!data) throw new ChatStorageError("not_found");
    conversation = summary(data);
  } else {
    const existing = await findQuestion(client, input.clientMessageId);
    if (existing) return existing;
    const { data, error } = await client.from("chat_conversations")
      .insert({ user_id: input.userId, title: chatConversationTitle(input.text) }).select("id, title, created_at, updated_at").single();
    if (error || !data) return fail(error);
    conversation = summary(data);
    firstTurn = true;
  }
  const { data: inserted, error: insertError } = await client.from("chat_messages").insert({
    user_id: input.userId, conversation_id: conversation.id, role: "user", client_message_id: input.clientMessageId,
    parts: [{ type: "text", text: input.text }] as unknown as Json,
  }).select("id").single();
  if (insertError?.code === "23505") {
    const existing = await findQuestion(client, input.clientMessageId);
    if (existing) return existing;
  }
  if (insertError || !inserted) return fail(insertError);
  await client.from("chat_confirms").update({ state: "expired", answered_at: new Date().toISOString() })
    .eq("conversation_id", conversation.id).eq("state", "pending").then(({ error }) => { if (error) fail(error); });
  const { data: reply, error: replyError } = await client.from("chat_messages").insert({
    user_id: input.userId, conversation_id: conversation.id, role: "assistant", reply_to: inserted.id, state: "streaming", parts: [] as unknown as Json,
  }).select("id").single();
  if (replyError || !reply) return fail(replyError);
  if (!firstTurn) {
    const { count } = await client.from("chat_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversation.id);
    firstTurn = (count ?? 0) <= 2;
  }
  return { kind: "new", conversation, userMessageId: inserted.id, replyId: reply.id, firstTurn };
}

async function findQuestion(client: AppSupabaseClient, clientMessageId: string): Promise<ChatQuestionStart | null> {
  const { data: question, error } = await client.from("chat_messages").select("id, conversation_id")
    .eq("client_message_id", clientMessageId).maybeSingle();
  if (error) fail(error);
  if (!question) return null;
  const [{ data: conversation, error: conversationError }, { data: reply, error: replyError }] = await Promise.all([
    client.from("chat_conversations").select("id, title, created_at, updated_at").eq("id", question.conversation_id).single(),
    client.from("chat_messages").select("id, role, created_at, parts, state").eq("reply_to", question.id).maybeSingle(),
  ]);
  if (conversationError || replyError || !conversation || !reply) return fail(conversationError ?? replyError);
  if (reply.state === "complete") return { kind: "replay", conversation: summary(conversation), userMessageId: question.id, reply: message(reply) };
  return { kind: "in_progress", conversation: summary(conversation), userMessageId: question.id, replyId: reply.id, startedAt: reply.created_at };
}

/** Finished messages, oldest first, without the given reply. */
export async function readChatHistory(client: AppSupabaseClient, conversationId: string, exceptId?: string): Promise<Readonly<{
  messages: ChatMessage[]; summary: string | null;
}>> {
  const [{ data: rows, error }, { data: conversation, error: conversationError }] = await Promise.all([
    client.from("chat_messages").select("id, role, created_at, parts, state").eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(500),
    client.from("chat_conversations").select("summary").eq("id", conversationId).single(),
  ]);
  if (error || conversationError) return fail(error ?? conversationError);
  const { data: confirms, error: confirmsError } = await client.from("chat_confirms").select("id, state").eq("conversation_id", conversationId);
  if (confirmsError) fail(confirmsError);
  const messages = (rows ?? []).filter((row) => row.id !== exceptId && row.state === "complete").map(message);
  return { messages: withCurrentConfirmStates(messages, confirms ?? []), summary: conversation?.summary ?? null };
}

export async function finishChatReply(client: AppSupabaseClient, input: Readonly<{
  conversationId: string; replyId: string; parts: readonly ChatPart[]; agentRunId: string | null; summary?: string | null;
}>): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client.from("chat_messages").update({
    parts: input.parts as unknown as Json, state: "complete", agent_run_id: input.agentRunId,
  }).eq("id", input.replyId);
  if (error) fail(error);
  const { error: touchError } = await client.from("chat_conversations")
    .update({ updated_at: now, ...(input.summary !== undefined ? { summary: input.summary } : {}) }).eq("id", input.conversationId);
  if (touchError) fail(touchError);
}

export type ChatActionRecord = Readonly<{
  outcome: ChatOutcome; operation: string; undoPlan: unknown | null;
}>;

export async function saveChatActions(client: AppSupabaseClient, input: Readonly<{
  userId: string; conversationId: string; messageId: string; actions: readonly ChatActionRecord[];
}>): Promise<void> {
  if (!input.actions.length) return;
  const { error } = await client.from("chat_actions").insert(input.actions.map((action) => ({
    id: action.outcome.id, user_id: input.userId, conversation_id: input.conversationId, message_id: input.messageId,
    operation: action.operation, kind: action.outcome.kind, confirmed: action.outcome.confirmed,
    outcome: action.outcome as unknown as Json, undo_plan: (action.undoPlan ?? null) as Json,
    undo_state: action.outcome.undo === "available" ? "available" : "unavailable",
  })));
  if (error) fail(error);
}

export async function saveChatConfirm(client: AppSupabaseClient, input: Readonly<{
  userId: string; conversationId: string; messageId: string; confirm: ChatConfirm; writes: unknown;
}>): Promise<void> {
  const { error } = await client.from("chat_confirms").insert({
    id: input.confirm.id, user_id: input.userId, conversation_id: input.conversationId, message_id: input.messageId,
    confirm: input.confirm as unknown as Json, writes: input.writes as Json, expires_at: input.confirm.expiresAt,
  });
  if (error) fail(error);
}

export type ChatConfirmRow = Readonly<{
  id: string; conversationId: string; messageId: string; confirm: ChatConfirm; writes: unknown; state: string; expiresAt: string;
}>;

/**
 * Claims a pending, unexpired confirm for answering. Returns the row and whether this
 * call claimed it; an expired one is marked expired here.
 */
export async function claimChatConfirm(client: AppSupabaseClient, confirmId: string, now = new Date()): Promise<Readonly<{
  row: ChatConfirmRow; claimed: boolean;
}>> {
  const { data: claimed, error } = await client.from("chat_confirms").update({ state: "answering" })
    .eq("id", confirmId).eq("state", "pending").gt("expires_at", now.toISOString())
    .select("id, conversation_id, message_id, confirm, writes, state, expires_at").maybeSingle();
  if (error) fail(error);
  if (claimed) return { row: confirmRow(claimed), claimed: true };
  const { data: current, error: readError } = await client.from("chat_confirms")
    .select("id, conversation_id, message_id, confirm, writes, state, expires_at").eq("id", confirmId).maybeSingle();
  if (readError) fail(readError);
  if (!current) throw new ChatStorageError("not_found");
  if (current.state === "pending") {
    await client.from("chat_confirms").update({ state: "expired", answered_at: now.toISOString() }).eq("id", confirmId).eq("state", "pending");
    return { row: { ...confirmRow(current), state: "expired" }, claimed: false };
  }
  return { row: confirmRow(current), claimed: false };
}

function confirmRow(row: Row<{ id: string; conversation_id: string; message_id: string; confirm: unknown; writes: unknown; state: string; expires_at: string }>): ChatConfirmRow {
  return { id: row.id, conversationId: row.conversation_id, messageId: row.message_id, confirm: row.confirm as ChatConfirm,
    writes: row.writes, state: row.state, expiresAt: row.expires_at };
}

export async function finishChatConfirm(client: AppSupabaseClient, confirmId: string, state: "accepted" | "declined" | "expired"): Promise<void> {
  const { error } = await client.from("chat_confirms").update({ state, answered_at: new Date().toISOString() }).eq("id", confirmId);
  if (error) fail(error);
}

export type ChatActionRow = Readonly<{
  id: string; conversationId: string; messageId: string; operation: string; outcome: ChatOutcome; undoPlan: unknown; undoState: string;
}>;

/** Claims an action's Undo so two taps never undo twice. Null when there is nothing to undo. */
export async function claimChatUndo(client: AppSupabaseClient, outcomeId: string): Promise<Readonly<{ row: ChatActionRow; claimed: boolean }>> {
  const select = "id, conversation_id, message_id, operation, outcome, undo_plan, undo_state";
  const { data: claimed, error } = await client.from("chat_actions").update({ undo_state: "undoing" })
    .eq("id", outcomeId).eq("undo_state", "available").select(select).maybeSingle();
  if (error) fail(error);
  if (claimed) return { row: actionRow(claimed), claimed: true };
  const { data: current, error: readError } = await client.from("chat_actions").select(select).eq("id", outcomeId).maybeSingle();
  if (readError) fail(readError);
  if (!current) throw new ChatStorageError("not_found");
  return { row: actionRow(current), claimed: false };
}

function actionRow(row: Row<{ id: string; conversation_id: string; message_id: string; operation: string; outcome: unknown; undo_plan: unknown; undo_state: string }>): ChatActionRow {
  return { id: row.id, conversationId: row.conversation_id, messageId: row.message_id, operation: row.operation,
    outcome: row.outcome as ChatOutcome, undoPlan: row.undo_plan, undoState: row.undo_state };
}

export async function finishChatUndo(client: AppSupabaseClient, outcomeId: string, outcome: ChatOutcome): Promise<void> {
  const done = outcome.undo === "done";
  const { error } = await client.from("chat_actions").update({
    undo_state: outcome.undo === "done" ? "done" : outcome.undo === "available" ? "available" : "unavailable",
    undone_at: done ? new Date().toISOString() : null, outcome: outcome as unknown as Json,
  }).eq("id", outcomeId);
  if (error) fail(error);
}

/** Rewrites one stored reply's parts (a confirm answered, outcomes added, an Undo done). */
export async function updateChatMessageParts(client: AppSupabaseClient, messageId: string,
  change: (parts: readonly ChatPart[]) => readonly ChatPart[]): Promise<void> {
  const { data, error } = await client.from("chat_messages").select("parts").eq("id", messageId).single();
  if (error || !data) return fail(error);
  const parts = change((Array.isArray(data.parts) ? data.parts : []) as ChatPart[]);
  const { error: updateError } = await client.from("chat_messages").update({ parts: parts as unknown as Json }).eq("id", messageId);
  if (updateError) fail(updateError);
}

export async function listChatConversations(client: AppSupabaseClient, input: Readonly<{ before: string | null; limit: number }>): Promise<Readonly<{
  conversations: ChatConversationSummary[]; nextBefore: string | null;
}>> {
  let query = client.from("chat_conversations").select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false }).limit(input.limit + 1);
  if (input.before) query = query.lt("updated_at", input.before);
  const { data, error } = await query;
  if (error) fail(error);
  const rows = (data ?? []).map(summary);
  const page = rows.slice(0, input.limit);
  return { conversations: page, nextBefore: rows.length > input.limit ? page.at(-1)!.updatedAt : null };
}

export async function readChatConversation(client: AppSupabaseClient, conversationId: string): Promise<Readonly<{
  conversation: ChatConversationSummary; messages: ChatMessage[];
}>> {
  const { data, error } = await client.from("chat_conversations").select("id, title, created_at, updated_at").eq("id", conversationId).maybeSingle();
  if (error) fail(error);
  if (!data) throw new ChatStorageError("not_found");
  const { data: rows, error: rowsError } = await client.from("chat_messages").select("id, role, created_at, parts, state")
    .eq("conversation_id", conversationId).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(500);
  if (rowsError) fail(rowsError);
  const { data: confirms, error: confirmsError } = await client.from("chat_confirms").select("id, state").eq("conversation_id", conversationId);
  if (confirmsError) fail(confirmsError);
  return { conversation: summary(data), messages: withCurrentConfirmStates((rows ?? []).map(message), confirms ?? []) };
}

/** Confirms carry their current state: answered, or expired by time or by a newer message. */
export function withCurrentConfirmStates(messages: readonly ChatMessage[], confirms: readonly Readonly<{ id: string; state: string }>[], now = Date.now()): ChatMessage[] {
  const states = new Map(confirms.map((row) => [row.id, row.state]));
  return messages.map((item) => ({ ...item, parts: item.parts.map((part) => {
    if (part.type !== "confirm") return part;
    const stored = states.get(part.confirm.id);
    const state: ChatConfirm["state"] = stored === "accepted" || stored === "declined" || stored === "expired" ? stored
      : part.confirm.state === "pending" && Date.parse(part.confirm.expiresAt) <= now ? "expired" : part.confirm.state;
    return state === part.confirm.state ? part : { type: "confirm" as const, confirm: { ...part.confirm, state } };
  }) }));
}
