import { Temporal } from "@js-temporal/polyfill";
import type { ChatConfirmItem, ChatOutcomeKind } from "@cadence/core/types/chat";
import { CHAT_OUTCOME_KIND, type ChatToolName, type ChatWriteName } from "./chat-tools";

/**
 * Advisor plan Phase 5 (5A): what a chat write says and how it is undone. Every
 * sentence here is Cadence's own text built from record fields, never model text.
 */

export type ChatToolError = Readonly<{
  code: string;
  message: string;
  alternatives?: readonly Readonly<{ start_at: string; start_time: string }>[];
}>;
export type ChatToolResult = Readonly<{ ok: true; result: unknown }> | Readonly<{ ok: false; error: ChatToolError }>;

/**
 * Runs one tool as the person, through chat's grant. It only executes: chat-turn.ts
 * decides whether a write may run, and sets every idempotency key.
 */
export type ChatToolExecutor = (
  name: ChatToolName, args: Readonly<Record<string, unknown>>, options: Readonly<{ idempotencyKey: string | null }>,
) => Promise<ChatToolResult>;

/** A write that can be run again later (Undo) or after a Yes (confirm). */
export type ChatWriteCall = Readonly<{ name: ChatWriteName; args: Readonly<Record<string, unknown>> }>;

/** How to undo a write that ran. `check` is the record state right after it, so Undo refuses once it changed. */
export type ChatUndoPlan = Readonly<{ call: ChatWriteCall }>;

/** One write waiting for a Yes, with the record state it was described from. */
export type ChatPendingWrite = Readonly<{
  call: ChatWriteCall;
  item: ChatConfirmItem;
  /** The record and revision the confirm was shown against; a change expires the confirm (T13). */
  /** `day_note` uses the local date as id and "none" as the revision of a day with no note. */
  guard: Readonly<{ kind: "occurrence" | "behavior" | "day_note"; id: string; revision: string }> | null;
}>;

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** "6:30 pm" in the item's timezone. */
export function chatClockText(instant: string, timezone: string): string {
  try {
    const time = Temporal.Instant.from(instant).toZonedDateTimeISO(timezone);
    return chatClockFromLocal(`${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`);
  } catch { return instant; }
}

/** "18:30" → "6:30 pm". */
export function chatClockFromLocal(hhmm: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(hhmm);
  if (!match) return hhmm;
  const hour = Number(match[1]), minute = match[2];
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute === "00" ? `${twelve} ${suffix}` : `${twelve}:${minute} ${suffix}`;
}

/** "Thu Nov 20" for a local date. */
export function chatDateText(localDate: string): string {
  try {
    const date = Temporal.PlainDate.from(localDate);
    const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][date.dayOfWeek - 1];
    const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.month - 1];
    return `${day} ${month} ${date.day}`;
  } catch { return localDate; }
}

const STATUS_DONE: Readonly<Record<string, string>> = { completed: "done", not_completed: "not done", unresolved: "open" };

/** Facts a description needs, read before the write (titles, old note text). */
export type ChatWriteFacts = Readonly<{
  occurrence?: Json | null;
  behavior?: Json | null;
  dayNote?: string | null;
  /** The day note's revision when the day has a note. */
  dayNoteRevision?: string | null;
}>;

export function outcomeKind(name: ChatWriteName): ChatOutcomeKind { return CHAT_OUTCOME_KIND[name]; }

/** The confirm line, in the imperative: "Mark Walk done". */
export function describePendingWrite(call: ChatWriteCall, facts: ChatWriteFacts): string {
  const args = call.args;
  const title = str(obj(facts.occurrence).behavior_title) ?? str(obj(facts.behavior).title) ?? "this item";
  switch (call.name) {
    case "set_occurrence_status": {
      const status = str(args.status) ?? "";
      return status === "unresolved" ? `Set ${title} back to open` : `Mark ${title} ${STATUS_DONE[status] ?? status}`;
    }
    case "update_occurrence_note": return str(args.note) ? `Save a note on ${title}` : `Clear the note on ${title}`;
    case "update_day_note": {
      const date = chatDateText(str(args.local_date) ?? "");
      return str(args.note) ? `Save your note for ${date}` : `Clear your note for ${date}`;
    }
    case "move_occurrence_for_day": return `Move ${title} to ${chatClockFromLocal(str(args.start_time) ?? "")} today`;
    case "revert_occurrence_move": return `Move ${title} back to where it was`;
    case "add_opportunity_occurrence": return `Add ${title} to today${placementText(args)}`;
    case "remove_opportunity_occurrence": return `Take ${title} off today`;
    case "create_behavior": return `Create a new Behavior, ${str(args.title) ?? "untitled"}`;
    case "update_behavior": return `Change ${title}${changedFields(args)}`;
    case "archive_behavior": return `Archive ${title}`;
    case "restore_behavior": return `Restore ${title}`;
  }
}

function changedFields(args: Readonly<Record<string, unknown>>): string {
  const labels: Readonly<Record<string, string>> = {
    title: "name", description: "description", location_text: "place", category_id: "category", schedules: "schedule",
    reminders: "reminders", default_duration_minutes: "length", end_date: "end date", is_opportunity: "opportunity",
  };
  const changed = Object.keys(labels).filter((key) => key in args).map((key) => labels[key]);
  return changed.length ? ` (${changed.join(", ")})` : "";
}

/** The outcome line, in the past tense: "Marked Walk done." Built from the write's own result. */
export function describeOutcome(call: ChatWriteCall, result: unknown, facts: ChatWriteFacts): string {
  const out = obj(result);
  const occurrence = obj(out.occurrence);
  const behavior = obj(out.behavior);
  const title = str(occurrence.behavior_title) ?? str(behavior.title) ?? str(obj(facts.occurrence).behavior_title) ?? "the item";
  const timezone = str(occurrence.timezone) ?? "UTC";
  switch (call.name) {
    case "set_occurrence_status": {
      const status = str(occurrence.status) ?? str(call.args.status) ?? "";
      return status === "unresolved" ? `Set ${title} back to open.` : `Marked ${title} ${STATUS_DONE[status] ?? status}.`;
    }
    case "update_occurrence_note": return str(call.args.note) ? `Saved a note on ${title}.` : `Cleared the note on ${title}.`;
    case "update_day_note": {
      const date = chatDateText(str(call.args.local_date) ?? "");
      return str(call.args.note) ? `Saved your note for ${date}.` : `Cleared your note for ${date}.`;
    }
    case "move_occurrence_for_day": return `Moved ${title} to ${chatClockText(str(occurrence.effective_start_at) ?? "", timezone)} today.`;
    case "revert_occurrence_move": return `Moved ${title} back to ${chatClockText(str(occurrence.effective_start_at) ?? "", timezone)}.`;
    case "add_opportunity_occurrence": return out.outcome === "logged"
      ? `Marked ${title} done at ${chatClockText(str(occurrence.effective_start_at) ?? "", timezone)}.`
      : `Added ${title} to today${placementText(call.args)}.`;
    case "remove_opportunity_occurrence": return `Took ${title} off today.`;
    case "create_behavior": return `Created ${title}.`;
    case "update_behavior": return `Changed ${title}.`;
    case "archive_behavior": return `Archived ${title}.`;
    case "restore_behavior": return `Restored ${title}.`;
  }
}

const PRESET_TEXT: Readonly<Record<string, string>> = { morning: "this morning", afternoon: "this afternoon", evening: "this evening", night: "tonight" };

/** " at 3 pm", " from 3 pm to 4 pm", " this evening" or "" for Done now. */
function placementText(args: Readonly<Record<string, unknown>>): string {
  if (args.mark_completed === true) return ", marked done now";
  const preset = str(args.preset);
  if (preset) return ` ${PRESET_TEXT[preset] ?? preset}`;
  const start = str(args.start_time), end = str(args.end_time);
  if (start && end) return ` from ${chatClockFromLocal(start)} to ${chatClockFromLocal(end)}`;
  return start ? ` at ${chatClockFromLocal(start)}` : "";
}

/** A move refusal from the result, when the rule stopped it. */
export function moveRefusal(result: unknown): Readonly<{ reason: string; message: string; alternatives: readonly Readonly<{ start_at: string; start_time: string }>[] }> | null {
  const out = obj(result);
  if (out.outcome !== "refused") return null;
  const refusal = obj(out.refusal);
  const alternatives = Array.isArray(refusal.alternatives)
    ? refusal.alternatives.map(obj).flatMap((item) => (str(item.start_at) && str(item.start_time) ? [{ start_at: item.start_at as string, start_time: item.start_time as string }] : []))
    : [];
  return { reason: str(refusal.reason) ?? "refused", message: str(refusal.message) ?? "Cadence could not make that change.", alternatives };
}

/**
 * The Undo for a write that ran, or null when it has none. Note edits restore the old
 * text chat read before writing (T11); status changes set the previous status back.
 */
export function undoPlanFor(call: ChatWriteCall, result: unknown, facts: ChatWriteFacts): ChatUndoPlan | null {
  const out = obj(result);
  const occurrence = obj(out.occurrence);
  const occurrenceId = str(occurrence.id) ?? str(call.args.occurrence_id);
  switch (call.name) {
    case "set_occurrence_status": {
      const previous = str(out.previous_status);
      if (!occurrenceId || !previous || out.changed === false) return null;
      return { call: { name: "set_occurrence_status", args: { occurrence_id: occurrenceId, status: previous, expected_status: occurrence.status } } };
    }
    case "update_occurrence_note": {
      if (!occurrenceId || out.changed === false || !facts.occurrence) return null;
      return { call: { name: "update_occurrence_note", args: {
        occurrence_id: occurrenceId, note: str(obj(facts.occurrence).note) ?? "", expected_revision: occurrence.revision,
      } } };
    }
    case "update_day_note": {
      const dayNote = obj(out.day_note);
      if (out.changed === false || facts.dayNote === undefined) return null;
      return { call: { name: "update_day_note", args: {
        local_date: call.args.local_date, note: facts.dayNote ?? "", ...(str(dayNote.revision) ? { expected_revision: dayNote.revision } : {}),
      } } };
    }
    // Move Undo carries the revision right after this move, so it refuses once anyone
    // moves or changes the item again; revert would otherwise undo that newer move.
    case "move_occurrence_for_day": {
      const revision = str(occurrence.revision);
      if (!occurrenceId || out.outcome !== "moved" || !revision) return null;
      return { call: { name: "revert_occurrence_move", args: { occurrence_id: occurrenceId, expected_revision: revision } } };
    }
    case "revert_occurrence_move": {
      const before = str(obj(facts.occurrence).effective_start_at);
      const timezone = str(occurrence.timezone);
      const revision = str(occurrence.revision);
      if (!occurrenceId || out.outcome !== "undone" || !before || !timezone || !revision) return null;
      const local = Temporal.Instant.from(before).toZonedDateTimeISO(timezone);
      const startTime = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
      return { call: { name: "move_occurrence_for_day", args: { occurrence_id: occurrenceId, start_time: startTime, expected_revision: revision } } };
    }
    // Undo takes an added item back off today, and refuses once it changed. Done now has
    // no Undo: its mark is kept in status history, so the item can no longer be removed.
    case "add_opportunity_occurrence": {
      const revision = str(occurrence.revision);
      if (!occurrenceId || out.outcome !== "added" || !revision) return null;
      return { call: { name: "remove_opportunity_occurrence", args: { occurrence_id: occurrenceId, expected_revision: revision } } };
    }
    // Undo of a Remove adds the same Behavior back at the same time today.
    case "remove_opportunity_occurrence": {
      const removed = obj(facts.occurrence);
      const schedule = obj(removed.schedule);
      const behaviorId = str(removed.behavior_id);
      if (out.outcome !== "removed" || !behaviorId) return null;
      const preset = str(schedule.preset), start = str(schedule.start_time), end = str(schedule.end_time);
      const placement = preset ? { preset } : start && end ? { start_time: start, end_time: end } : start ? { start_time: start } : null;
      return placement ? { call: { name: "add_opportunity_occurrence", args: { behavior_id: behaviorId, ...placement } } } : null;
    }
    case "create_behavior": {
      const id = str(obj(out.behavior).id);
      return id ? { call: { name: "archive_behavior", args: { behavior_id: id } } } : null;
    }
    case "archive_behavior": {
      const id = str(obj(out.behavior).id);
      return id && out.changed !== false ? { call: { name: "restore_behavior", args: { behavior_id: id } } } : null;
    }
    case "restore_behavior": {
      const id = str(obj(out.behavior).id);
      return id && out.changed !== false ? { call: { name: "archive_behavior", args: { behavior_id: id } } } : null;
    }
    case "update_behavior": return null;
  }
}

/** Ids a client can refresh after the write. */
export function outcomeTargets(call: ChatWriteCall, result: unknown): Readonly<{ occurrenceId?: string; behaviorId?: string; localDate?: string }> {
  const out = obj(result);
  const occurrenceId = str(obj(out.occurrence).id) ?? str(call.args.occurrence_id);
  const behaviorId = str(obj(out.behavior).id) ?? str(obj(out.occurrence).behavior_id) ?? str(call.args.behavior_id);
  const localDate = str(obj(out.occurrence).local_date) ?? str(call.args.local_date);
  return { ...(occurrenceId ? { occurrenceId } : {}), ...(behaviorId ? { behaviorId } : {}), ...(localDate ? { localDate } : {}) };
}

/** What chat reads before a write, so the outcome and Undo have their facts. */
export function factsReadFor(call: ChatWriteCall): Readonly<{ name: ChatToolName; args: Json }> | null {
  const occurrenceId = str(call.args.occurrence_id);
  const behaviorId = str(call.args.behavior_id);
  if (occurrenceId) return { name: "get_occurrence", args: { occurrence_id: occurrenceId } };
  if (behaviorId) return { name: "get_behavior", args: { behavior_id: behaviorId } };
  if (call.name === "update_day_note" && str(call.args.local_date)) {
    return { name: "list_day_notes", args: { start_local_date: call.args.local_date, end_local_date: call.args.local_date } };
  }
  return null;
}

/** Facts from that read's result. */
export function factsFrom(call: ChatWriteCall, read: ChatToolResult | null): ChatWriteFacts {
  if (!read || !read.ok) return call.name === "update_day_note" ? {} : {};
  const out = obj(read.result);
  if (call.name === "update_day_note") {
    const notes = Array.isArray(out.day_notes) ? out.day_notes.map(obj) : [];
    const match = notes.find((note) => note.local_date === call.args.local_date);
    return { dayNote: match ? str(match.note) : null, dayNoteRevision: match ? str(match.revision) : null };
  }
  if (out.occurrence) return { occurrence: obj(out.occurrence) };
  if (out.behavior) return { behavior: obj(out.behavior) };
  return {};
}

/** The record a confirm item depends on, for expiry when it changes (T13). */
export function guardFrom(facts: ChatWriteFacts, call?: ChatWriteCall): ChatPendingWrite["guard"] {
  if (call?.name === "update_day_note" && facts.dayNote !== undefined && str(call.args.local_date)) {
    return { kind: "day_note", id: call.args.local_date as string, revision: facts.dayNoteRevision ?? "none" };
  }
  const occurrence = facts.occurrence ? obj(facts.occurrence) : null;
  if (occurrence && str(occurrence.id) && str(occurrence.revision)) return { kind: "occurrence", id: occurrence.id as string, revision: occurrence.revision as string };
  const behavior = facts.behavior ? obj(facts.behavior) : null;
  if (behavior && str(behavior.id) && str(behavior.revision)) return { kind: "behavior", id: behavior.id as string, revision: behavior.revision as string };
  return null;
}

/** Fills the record's current revision into a write that needs one, read at run time. */
export function withRevision(call: ChatWriteCall, facts: ChatWriteFacts): ChatWriteCall {
  const occurrence = facts.occurrence ? obj(facts.occurrence) : null;
  const revision = occurrence ? str(occurrence.revision) : null;
  if (revision && (call.name === "move_occurrence_for_day" || call.name === "revert_occurrence_move" || call.name === "remove_opportunity_occurrence")
    && !str(call.args.expected_revision)) {
    return { ...call, args: { ...call.args, expected_revision: revision } };
  }
  if (call.name === "update_day_note" && facts.dayNoteRevision && !str(call.args.expected_revision)) {
    return { ...call, args: { ...call.args, expected_revision: facts.dayNoteRevision } };
  }
  return call;
}
