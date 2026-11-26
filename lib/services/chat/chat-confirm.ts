import { randomUUID } from "node:crypto";
import type { ChatOutcome, ChatRefusal } from "@cadence/core/types/chat";
import {
  describeOutcome, moveRefusal, outcomeKind, outcomeTargets, readWriteFacts, undoPlanFor, withRevision,
  type ChatPendingWrite, type ChatToolExecutor, type ChatUndoPlan, type ChatWriteCall, type ChatWriteFacts,
} from "./chat-writes";

/**
 * Advisor plan Phase 5 (5A): a Yes on a confirm, and Undo. Neither calls a model.
 * Shared by the routes and the eval harness.
 */

export type ChatConfirmRun = Readonly<{
  state: "accepted" | "expired";
  writes: readonly Readonly<{ outcome: ChatOutcome; call: ChatWriteCall; undo: ChatUndoPlan | null; facts: ChatWriteFacts }>[];
  refusals: readonly ChatRefusal[];
}>;

/**
 * Runs every pending write in order after a Yes. Before any write runs, each listed
 * record is read again: when one changed since the confirm was shown, nothing runs
 * and the confirm expires (T13). Keys come from the confirm's id and position (T14),
 * so a repeated Yes replays instead of writing twice.
 */
export async function runChatConfirm(input: Readonly<{
  confirmId: string;
  writes: readonly ChatPendingWrite[];
  executor: ChatToolExecutor;
  newId?: () => string;
  /** A Yes resumed after a failed one: earlier writes may have run, so the guards are not checked again. */
  resumed?: boolean;
}>): Promise<ChatConfirmRun> {
  const newId = input.newId ?? randomUUID;
  const read = (name: Parameters<ChatToolExecutor>[0], args: Readonly<Record<string, unknown>>) => input.executor(name, args, { idempotencyKey: null });
  const facts: ChatWriteFacts[] = [];
  for (const write of input.writes) {
    const current = await readWriteFacts(write.call, read);
    if (!input.resumed && write.guard && revisionOf(current, write.guard.kind) !== write.guard.revision) return { state: "expired", writes: [], refusals: [] };
    facts.push(current);
  }
  const writes: Array<ChatConfirmRun["writes"][number]> = [];
  const refusals: ChatRefusal[] = [];
  for (const [index, write] of input.writes.entries()) {
    // Facts read before the first write: re-read for later writes on the same record.
    let current = facts[index]!;
    if (index > 0 && sameRecordAsEarlier(input.writes, index)) {
      current = await readWriteFacts(write.call, read);
    }
    const call = withRevision(write.call, current);
    const done = await input.executor(call.name, call.args, { idempotencyKey: `chat:${input.confirmId}:${index}` });
    const refused = done.ok ? moveRefusal(done.result) : null;
    if (!done.ok || refused) {
      const occurrenceId = typeof call.args.occurrence_id === "string" ? call.args.occurrence_id : undefined;
      refusals.push({
        id: newId(), kind: outcomeKind(call.name), reason: refused?.reason ?? (!done.ok ? done.error.code : "failed"),
        text: refused?.message ?? "Cadence could not make that change.", ...(occurrenceId ? { occurrenceId } : {}),
        alternatives: (refused?.alternatives ?? []).map((item) => ({ startAt: item.start_at, startTime: item.start_time })),
      });
      continue;
    }
    const undo = undoPlanFor(call, done.result, current);
    writes.push({ call, undo, facts: current, outcome: {
      id: newId(), kind: outcomeKind(call.name), text: describeOutcome(call, done.result, current), confirmed: true,
      undo: undo ? "available" : "unavailable", ...outcomeTargets(call, done.result),
    } });
  }
  return { state: "accepted", writes, refusals };
}

function sameRecordAsEarlier(writes: readonly ChatPendingWrite[], index: number): boolean {
  const target = writes[index]!.guard?.id;
  return !!target && writes.slice(0, index).some((write) => write.guard?.id === target);
}

function revisionOf(facts: ChatWriteFacts, kind: NonNullable<ChatPendingWrite["guard"]>["kind"]): string | null {
  if (kind === "day_note") return facts.dayNote === undefined ? null : facts.dayNoteRevision ?? "none";
  if (kind === "period") {
    const period = facts.period as Record<string, unknown> | null | undefined;
    return period && typeof period.revision === "string" ? period.revision : null;
  }
  const record = (facts.occurrence ?? facts.behavior) as Record<string, unknown> | null | undefined;
  return record && typeof record.revision === "string" ? record.revision : null;
}

export type ChatUndoRun = Readonly<{ ok: true; text: string } | { ok: false; reason: "changed" | "failed" }>;

/**
 * Undoes one write. Every Undo carries the state right after the write (a move's
 * revision, a note's revision, a status), so it refuses when the record changed since (T11).
 */
export async function runChatUndo(input: Readonly<{
  outcome: ChatOutcome; plan: ChatUndoPlan; executor: ChatToolExecutor; idempotencyKey: string;
}>): Promise<ChatUndoRun> {
  const calls = input.plan.calls?.length ? input.plan.calls : [input.plan.call];
  if (calls.length > 1 && !(await stepsUnchanged(calls, input.executor))) return { ok: false, reason: "changed" };
  for (const [index, call] of calls.entries()) {
    const key = calls.length > 1 ? `${input.idempotencyKey}:${index}` : input.idempotencyKey;
    const done = await input.executor(call.name, call.args, { idempotencyKey: key });
    if (!done.ok) return { ok: false, reason: done.error.code === "conflict" || done.error.code === "invalid_state" ? "changed" : "failed" };
    if (moveRefusal(done.result)) return { ok: false, reason: "changed" };
  }
  return { ok: true, text: `Undid: ${input.outcome.text}` };
}

/**
 * A routine Undo sets several steps back. Every step is read first, and when any one
 * changed since the mark, none is set back, so Undo never leaves the routine half undone.
 */
async function stepsUnchanged(calls: readonly ChatWriteCall[], executor: ChatToolExecutor): Promise<boolean> {
  for (const call of calls) {
    const expected = call.args.expected_status;
    if (call.name !== "set_occurrence_status" || typeof expected !== "string") continue;
    const read = await executor("get_occurrence", { occurrence_id: call.args.occurrence_id }, { idempotencyKey: null });
    const status = read.ok ? (read.result as { occurrence?: { status?: unknown } } | null)?.occurrence?.status : null;
    if (status !== expected) return false;
  }
  return true;
}
