import { Temporal } from "@js-temporal/polyfill";
import type { ChatConfirmItem, ChatOutcomeKind } from "@cadence/core/types/chat";
import type { ChatTravelUiCard } from "@cadence/core/types/chat-travel";
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
export type ChatToolResult =
  | Readonly<{ ok: true; result: unknown; uiTravelCards?: readonly ChatTravelUiCard[] }>
  | Readonly<{ ok: false; error: ChatToolError }>;

/**
 * Runs one tool as the person, through chat's grant. It only executes: chat-turn.ts
 * decides whether a write may run, and sets every idempotency key.
 */
export type ChatToolExecutor = (
  name: ChatToolName, args: Readonly<Record<string, unknown>>, options: Readonly<{ idempotencyKey: string | null }>,
) => Promise<ChatToolResult>;

/** A write that can be run again later (Undo) or after a Yes (confirm). */
export type ChatWriteCall = Readonly<{ name: ChatWriteName; args: Readonly<Record<string, unknown>> }>;

/**
 * How to undo a write that ran. Each call carries the record state right after the
 * write, so Undo refuses once it changed. A routine mark sets every step it changed
 * back with its own call, listed in `calls` (`call` is the first, for older plans).
 */
export type ChatUndoPlan = Readonly<{ call: ChatWriteCall; calls?: readonly ChatWriteCall[] }>;

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
  /** The routine a sub-behavior write names: the new parent, or the one it leaves. */
  parent?: Json | null;
  /** A routine mark: the slot's step Occurrences as read before the write, with their statuses. */
  slot?: readonly Json[] | null;
}>;

export function outcomeKind(name: ChatWriteName): ChatOutcomeKind { return CHAT_OUTCOME_KIND[name]; }

const GROUPING_KEYS = ["parent_behavior_id", "inherit_parent_schedule", "sub_behavior_sort_order"] as const;

function parentTitleOf(facts: ChatWriteFacts, fallback = "the routine"): string {
  return str(obj(facts.parent).title) ?? fallback;
}

/** "Cerave, Facewash and Retinol". */
function joinTitles(titles: readonly string[]): string {
  if (titles.length <= 1) return titles.join("");
  return `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
}

function stepTitles(value: unknown): string[] {
  return Array.isArray(value) ? value.map(obj).flatMap((item) => (str(item.title) ? [item.title as string] : [])) : [];
}

function stepsText(titles: readonly string[]): string {
  return `${titles.length} ${titles.length === 1 ? "step" : "steps"}: ${titles.join(", ")}`;
}

/** " in Skin routine" for a step of a routine. */
function inRoutine(occurrence: Json): string {
  const parent = str(occurrence.parent_title);
  return parent ? ` in ${parent}` : "";
}

/** A routine mark's title: the routine's own name. */
function routineTitle(result: unknown, facts: ChatWriteFacts): string {
  const out = obj(result);
  const group = Array.isArray(out.parent_groups) ? obj(out.parent_groups[0]) : {};
  const first = Array.isArray(out.occurrences) ? obj(out.occurrences[0]) : {};
  return str(group.title) ?? str(first.parent_title) ?? parentTitleOf(facts, "your routine");
}

/**
 * The sentence for a grouping change (into or out of a routine, its schedule, its
 * order), or null when the write changes none of them.
 */
function groupingText(args: Readonly<Record<string, unknown>>, title: string, facts: ChatWriteFacts, tense: "pending" | "done"): string | null {
  const parent = parentTitleOf(facts);
  const pending = tense === "pending";
  if (typeof args.parent_behavior_id === "string") {
    const schedule = args.inherit_parent_schedule === false ? ", with its own schedule"
      : args.inherit_parent_schedule === true ? `, following ${parent}'s schedule` : "";
    return `${pending ? "Move" : "Moved"} ${title} into ${parent}${schedule}`;
  }
  if ("parent_behavior_id" in args && args.parent_behavior_id === null) {
    return `${pending ? "Take" : "Took"} ${title} out of ${parent}, as its own Behavior`;
  }
  if (args.inherit_parent_schedule === true) return pending ? `Have ${title} follow ${parent}'s schedule` : `${title} now follows ${parent}'s schedule`;
  if (args.inherit_parent_schedule === false) return pending ? `Give ${title} its own schedule` : `${title} now has its own schedule`;
  if ("sub_behavior_sort_order" in args) return `${pending ? "Change" : "Changed"} where ${title} sits in ${parent}`;
  return null;
}

/** The confirm line, in the imperative: "Mark Walk done". */
export function describePendingWrite(call: ChatWriteCall, facts: ChatWriteFacts): string {
  const args = call.args;
  const title = str(obj(facts.occurrence).behavior_title) ?? str(obj(facts.behavior).title) ?? "this item";
  switch (call.name) {
    case "set_occurrence_status": {
      const status = str(args.status) ?? "";
      const where = inRoutine(obj(facts.occurrence));
      return status === "unresolved" ? `Set ${title}${where} back to open` : `Mark ${title}${where} ${STATUS_DONE[status] ?? status}`;
    }
    case "set_parent_occurrence_status": {
      const status = str(args.status) ?? "";
      const steps = facts.slot?.length ?? 0;
      const count = steps > 1 ? ` (${steps} steps)` : "";
      return `Mark ${parentTitleOf(facts, "this routine")} ${STATUS_DONE[status] ?? status}${count}`;
    }
    case "update_occurrence_note": return str(args.note) ? `Save a note on ${title}` : `Clear the note on ${title}`;
    case "update_day_note": {
      const date = chatDateText(str(args.local_date) ?? "");
      return str(args.note) ? `Save your note for ${date}` : `Clear your note for ${date}`;
    }
    case "move_occurrence_for_day": return `Move ${title} to ${chatClockFromLocal(str(args.start_time) ?? "")} today`;
    case "move_occurrence_to_date": {
      const time = str(args.start_time) ?? str(args.target_start_time);
      const timePart = time ? ` at ${chatClockFromLocal(time)}` : "";
      return `Move ${title} to ${chatDateText(str(args.target_local_date) ?? "")}${timePart}`;
    }
    case "revert_occurrence_move": return `Move ${title} back to where it was`;
    case "add_opportunity_occurrence": return `Add ${title} to today${placementText(args)}`;
    case "remove_opportunity_occurrence": return `Take ${title} off today`;
    case "create_behavior": {
      const name = str(args.title) ?? "untitled";
      const steps = stepTitles(args.sub_behaviors);
      if (steps.length) return `Create ${name} with ${stepsText(steps)}`;
      if (str(args.parent_behavior_id)) {
        return `Add ${name} to ${parentTitleOf(facts)}${args.inherit_parent_schedule === false ? ", with its own schedule" : ""}`;
      }
      return `Create a new Behavior, ${name}`;
    }
    case "update_behavior": {
      const grouping = groupingText(args, title, facts, "pending");
      // A step given its own schedule sends that schedule: the line already says so.
      const rest = changedFields(args, args.inherit_parent_schedule === false ? ["schedules"] : []);
      return grouping ? `${grouping}${rest ? `, and change ${rest.slice(2, -1)}` : ""}` : `Change ${title}${rest}`;
    }
    case "archive_behavior": return `Archive ${title}`;
    case "restore_behavior": return `Restore ${title}`;
  }
}

function changedFields(args: Readonly<Record<string, unknown>>, skip: readonly string[] = []): string {
  const labels: Readonly<Record<string, string>> = {
    title: "name", description: "description", location_text: "place", category_id: "category", schedules: "schedule",
    reminders: "reminders", default_duration_minutes: "length", end_date: "end date", is_opportunity: "opportunity",
    // Ticket 360: the answer to "Can this be done alongside other things?" (contract 1.9.0, flag on only).
    alongside: "alongside",
  };
  const changed = Object.keys(labels).filter((key) => key in args && !skip.includes(key)).map((key) => labels[key]);
  return changed.length ? ` (${changed.join(", ")})` : "";
}

/** The outcome line, in the past tense: "Marked Walk done." Built from the write's own result. */
export function describeOutcome(call: ChatWriteCall, result: unknown, facts: ChatWriteFacts): string {
  const out = obj(result);
  const occurrence = obj(out.occurrence);
  const behavior = obj(out.behavior);
  const title = str(occurrence.behavior_title) ?? str(behavior.title) ?? str(obj(facts.occurrence).behavior_title) ?? str(obj(facts.behavior).title) ?? "the item";
  const timezone = str(occurrence.timezone) ?? "UTC";
  switch (call.name) {
    case "set_occurrence_status": {
      const status = str(occurrence.status) ?? str(call.args.status) ?? "";
      const where = inRoutine(Object.keys(occurrence).length ? occurrence : obj(facts.occurrence));
      return status === "unresolved" ? `Set ${title}${where} back to open.` : `Marked ${title}${where} ${STATUS_DONE[status] ?? status}.`;
    }
    case "set_parent_occurrence_status": {
      const status = STATUS_DONE[str(out.status) ?? str(call.args.status) ?? ""] ?? "";
      const routine = routineTitle(result, facts);
      if (out.changed === false) return `${routine} was already marked ${status}.`;
      const steps = stepTitles((Array.isArray(out.occurrences) ? out.occurrences : []).map((item) => ({ title: obj(item).behavior_title })));
      return steps.length > 1 ? `Marked ${routine} ${status}: ${joinTitles(steps)}.` : `Marked ${routine} ${status}.`;
    }
    case "update_occurrence_note": return str(call.args.note) ? `Saved a note on ${title}.` : `Cleared the note on ${title}.`;
    case "update_day_note": {
      const date = chatDateText(str(call.args.local_date) ?? "");
      return str(call.args.note) ? `Saved your note for ${date}.` : `Cleared your note for ${date}.`;
    }
    case "move_occurrence_for_day": return `Moved ${title} to ${chatClockText(str(occurrence.effective_start_at) ?? "", timezone)} today.`;
    case "move_occurrence_to_date": {
      const time = str(call.args.start_time) ?? str(call.args.target_start_time);
      const timePart = time ? ` at ${chatClockFromLocal(time)}` : "";
      return `Moved ${title} to ${chatDateText(str(call.args.target_local_date) ?? "")}${timePart}.`;
    }
    case "revert_occurrence_move": return `Moved ${title} back to ${chatClockText(str(occurrence.effective_start_at) ?? "", timezone)}.`;
    case "add_opportunity_occurrence": return out.outcome === "logged"
      ? `Marked ${title} done at ${chatClockText(str(occurrence.effective_start_at) ?? "", timezone)}.`
      : `Added ${title} to today${placementText(call.args)}.`;
    case "remove_opportunity_occurrence": return `Took ${title} off today.`;
    case "create_behavior": {
      const steps = stepTitles(out.sub_behaviors).length ? stepTitles(out.sub_behaviors) : stepTitles(call.args.sub_behaviors);
      if (steps.length) return `Created ${title} with ${stepsText(steps)}.`;
      if (str(behavior.parent_behavior_id) ?? str(call.args.parent_behavior_id)) return `Added ${title} to ${parentTitleOf(facts)}.`;
      return `Created ${title}.`;
    }
    case "update_behavior": {
      const grouping = groupingText(call.args, title, facts, "done");
      return grouping ? `${grouping}.` : `Changed ${title}.`;
    }
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
    // A routine mark is undone step by step: each changed step goes back to the status
    // chat read before the write, and refuses once anyone changed that step since.
    case "set_parent_occurrence_status": {
      const changedIds = Array.isArray(out.changed_occurrence_ids) ? out.changed_occurrence_ids.filter((id): id is string => typeof id === "string") : [];
      if (out.changed === false || changedIds.length === 0 || !facts.slot) return null;
      const before = new Map(facts.slot.map((item) => [str(item.id), str(item.status)]));
      const after = new Map((Array.isArray(out.occurrences) ? out.occurrences : []).map(obj).map((item) => [str(item.id), str(item.status)]));
      const calls: ChatWriteCall[] = [];
      for (const id of changedIds) {
        const previous = before.get(id);
        const now = after.get(id) ?? str(out.status);
        if (!previous || !now || previous === now) return null;
        calls.push({ name: "set_occurrence_status", args: { occurrence_id: id, status: previous, expected_status: now } });
      }
      return { call: calls[0]!, calls };
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
    case "move_occurrence_to_date": {
      const revision = str(occurrence.revision) ?? str(occurrence.updated_at);
      const previous = obj(out.previous);
      const prevLocalDate = str(previous.local_date) ?? str(obj(facts.occurrence).local_date);
      const prevStartAt = str(previous.effective_start_at) ?? str(previous.scheduled_for) ?? str(obj(facts.occurrence).effective_start_at);
      if (!occurrenceId || out.outcome !== "moved" || !revision || !prevLocalDate) return null;
      const timezone = str(occurrence.timezone) ?? str(obj(facts.occurrence).timezone);
      let prevStartTime: string | null = null;
      if (prevStartAt && timezone) {
        try {
          const local = Temporal.Instant.from(prevStartAt).toZonedDateTimeISO(timezone);
          prevStartTime = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
        } catch {
          prevStartTime = null;
        }
      }
      return {
        call: {
          name: "move_occurrence_to_date",
          args: {
            occurrence_id: occurrenceId,
            target_local_date: prevLocalDate,
            ...(prevStartTime ? { start_time: prevStartTime } : {}),
            ...(prevStartAt ? { target_start_at: prevStartAt } : {}),
            expected_revision: revision,
          },
        },
      };
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
  const first = Array.isArray(out.occurrences) ? obj(out.occurrences[0]) : {};
  const behaviorId = str(obj(out.behavior).id) ?? str(obj(out.occurrence).behavior_id) ?? str(call.args.behavior_id)
    ?? str(out.parent_behavior_id) ?? str(call.args.parent_behavior_id);
  const localDate = str(obj(out.occurrence).local_date) ?? str(first.local_date) ?? str(call.args.local_date);
  return { ...(occurrenceId ? { occurrenceId } : {}), ...(behaviorId ? { behaviorId } : {}), ...(localDate ? { localDate } : {}) };
}

/** What chat reads before a write, so the outcome and Undo have their facts. */
export function factsReadFor(call: ChatWriteCall): Readonly<{ name: ChatToolName; args: Json }> | null {
  // A routine mark reads the day's Timeline (and Needs decision) for each step's status.
  if (call.name === "set_parent_occurrence_status") {
    return { name: "get_timeline", args: { ...(str(call.args.local_date) ? { start_local_date: call.args.local_date } : {}), days: 1 } };
  }
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
  if (!read || !read.ok) return {};
  const out = obj(read.result);
  if (call.name === "set_parent_occurrence_status") return { slot: slotFrom(call.args, out) };
  if (call.name === "update_day_note") {
    const notes = Array.isArray(out.day_notes) ? out.day_notes.map(obj) : [];
    const match = notes.find((note) => note.local_date === call.args.local_date);
    return { dayNote: match ? str(match.note) : null, dayNoteRevision: match ? str(match.revision) : null };
  }
  if (out.occurrence) return { occurrence: obj(out.occurrence) };
  if (out.behavior) return { behavior: obj(out.behavior) };
  return {};
}

/** The parent a write names, read so its lines can say the routine's name. */
function parentIdFor(call: ChatWriteCall, facts: ChatWriteFacts): string | null {
  const args = call.args;
  if (call.name === "set_parent_occurrence_status" || call.name === "create_behavior") return str(args.parent_behavior_id);
  if (call.name !== "update_behavior") return null;
  if (typeof args.parent_behavior_id === "string") return args.parent_behavior_id;
  return GROUPING_KEYS.some((key) => key in args) ? str(obj(facts.behavior).parent_behavior_id) : null;
}

/**
 * Every fact a write needs: its record, and for routine writes the routine itself.
 * Shared by the turn loop and a Yes, so both describe and undo a write the same way.
 */
export async function readWriteFacts(
  call: ChatWriteCall, read: (name: ChatToolName, args: Json) => Promise<ChatToolResult>,
): Promise<ChatWriteFacts> {
  const first = factsReadFor(call);
  const facts = factsFrom(call, first ? await read(first.name, first.args) : null);
  const parentId = parentIdFor(call, facts);
  if (!parentId) return facts;
  const parent = await read("get_behavior", { behavior_id: parentId });
  return { ...facts, parent: parent.ok ? obj(obj(parent.result).behavior) : null };
}

/** The step Occurrences a routine mark targets, from a get_timeline result. */
function slotFrom(args: Readonly<Record<string, unknown>>, timeline: Json): Json[] | null {
  const days = Array.isArray(timeline.days) ? timeline.days.map(obj) : [];
  const needs = obj(timeline.needs_decision);
  const occurrences = [...days.flatMap((day) => (Array.isArray(day.occurrences) ? day.occurrences.map(obj) : [])),
    ...(Array.isArray(needs.occurrences) ? needs.occurrences.map(obj) : [])];
  const byId = new Map(occurrences.map((item) => [str(item.id), item]));
  let ids: string[];
  if (Array.isArray(args.occurrence_ids)) ids = args.occurrence_ids.filter((id): id is string => typeof id === "string");
  else {
    const groups = [...days.flatMap((day) => (Array.isArray(day.parent_groups) ? day.parent_groups.map(obj) : [])),
      ...(Array.isArray(needs.parent_groups) ? needs.parent_groups.map(obj) : [])]
      .filter((group) => group.parent_behavior_id === args.parent_behavior_id && group.local_date === args.local_date)
      .filter((group) => !str(args.slot_key) || sameInstant(str(group.slot_key), args.slot_key as string));
    const unique = new Map(groups.map((group) => [str(group.slot_key), group]));
    if (unique.size !== 1) return null;
    const group = [...unique.values()][0]!;
    ids = Array.isArray(group.occurrence_ids) ? group.occurrence_ids.filter((id): id is string => typeof id === "string") : [];
  }
  const slot = ids.map((id) => byId.get(id));
  return ids.length && slot.every(Boolean) ? slot as Json[] : null;
}

function sameInstant(left: string | null, right: string): boolean {
  if (!left) return false;
  try { return Temporal.Instant.compare(Temporal.Instant.from(left), Temporal.Instant.from(right)) === 0; } catch { return left === right; }
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
  if (revision && (call.name === "move_occurrence_for_day" || call.name === "move_occurrence_to_date" || call.name === "revert_occurrence_move" || call.name === "remove_opportunity_occurrence")
    && !str(call.args.expected_revision)) {
    return { ...call, args: { ...call.args, expected_revision: revision } };
  }
  if (call.name === "update_day_note" && facts.dayNoteRevision && !str(call.args.expected_revision)) {
    return { ...call, args: { ...call.args, expected_revision: facts.dayNoteRevision } };
  }
  return call;
}
