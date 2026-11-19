import { randomUUID } from "node:crypto";
import type { ChatOutcome, ChatRefusal } from "@cadence/core/types/chat";
import {
  describeOutcome, factsFrom, factsReadFor, moveRefusal, outcomeKind, outcomeTargets, undoPlanFor, withRevision,
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
}>): Promise<ChatConfirmRun> {
  const newId = input.newId ?? randomUUID;
  const facts: ChatWriteFacts[] = [];
  for (const write of input.writes) {
    const read = factsReadFor(write.call);
    const current = factsFrom(write.call, read ? await input.executor(read.name, read.args, { idempotencyKey: null }) : null);
    if (write.guard && revisionOf(current) !== write.guard.revision) return { state: "expired", writes: [], refusals: [] };
    facts.push(current);
  }
  const writes: Array<ChatConfirmRun["writes"][number]> = [];
  const refusals: ChatRefusal[] = [];
  for (const [index, write] of input.writes.entries()) {
    // Facts read before the first write: re-read for later writes on the same record.
    let current = facts[index]!;
    if (index > 0 && sameRecordAsEarlier(input.writes, index)) {
      const read = factsReadFor(write.call);
      current = factsFrom(write.call, read ? await input.executor(read.name, read.args, { idempotencyKey: null }) : null);
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

function revisionOf(facts: ChatWriteFacts): string | null {
  const record = (facts.occurrence ?? facts.behavior) as Record<string, unknown> | null | undefined;
  return record && typeof record.revision === "string" ? record.revision : null;
}

export type ChatUndoRun = Readonly<{ ok: true; text: string } | { ok: false; reason: "changed" | "failed" }>;

/**
 * Undoes one write. Moves read the item's current revision first (the move functions
 * check it); note and status Undo carry the state right after the write, so they
 * refuse when the person changed the record since (T11).
 */
export async function runChatUndo(input: Readonly<{
  outcome: ChatOutcome; plan: ChatUndoPlan; executor: ChatToolExecutor; idempotencyKey: string;
}>): Promise<ChatUndoRun> {
  let call = input.plan.call;
  if (input.plan.refreshRevision) {
    const read = await input.executor("get_occurrence", { occurrence_id: input.plan.refreshRevision.occurrenceId }, { idempotencyKey: null });
    if (!read.ok) return { ok: false, reason: "failed" };
    call = withRevision({ ...call, args: Object.fromEntries(Object.entries(call.args).filter(([key]) => key !== "expected_revision")) }, factsFrom(call, read));
  }
  const done = await input.executor(call.name, call.args, { idempotencyKey: input.idempotencyKey });
  if (!done.ok) return { ok: false, reason: done.error.code === "conflict" || done.error.code === "invalid_state" ? "changed" : "failed" };
  if (moveRefusal(done.result)) return { ok: false, reason: "changed" };
  return { ok: true, text: `Undid: ${input.outcome.text}` };
}
