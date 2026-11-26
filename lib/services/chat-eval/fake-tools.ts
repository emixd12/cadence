import { Temporal } from "@js-temporal/polyfill";
import {
  ADHERENCE_DEFINITION, INTEGRATION_CONTRACT_VERSION, INTEGRATION_SCOPE_LIST, isIntegrationOperationName,
  validateOperationInput, validateOperationOutput, type IntegrationOperationName,
} from "@cadence/core/integration";
import {
  clockLabel, effectiveTime, minutesOf, timeOf, toInstant,
  type ChatWorld, type WorldBehavior, type WorldOccurrence, type Weekday,
} from "./world";
import { CHAT_PLANNING_READS, withChatPlanning } from "../chat/chat-planning";
import { alongsideMayOverlap } from "@cadence/core/resolvers/alongside.resolver";
import { NO_ALONGSIDE_PAIRING_EVIDENCE, planAlongsidePairings } from "@cadence/core/resolvers/alongside-pairing.resolver";
import type { BriefMoveDayItem } from "@cadence/core/resolvers/brief-move.resolver";
import { chatPairingProposal } from "../alongside-pairing.service";

/**
 * Phase 5 (5D) chat eval: an in-memory stand-in for the chat route's tool executor.
 * It answers every Cadence operation from a synthetic world in the published output
 * shape (each result is checked against the real output schema), plus the chat-only
 * connector tools and `search_advice`. Inputs are checked against the real input
 * schemas, so a malformed call fails the way it would in production.
 *
 * Like the production executor it only executes: ask-first gating belongs to the turn.
 * It does apply the calendar busy check before a move, as the chat route does (5A step 4).
 */

export type ChatToolResult =
  | Readonly<{ ok: true; result: unknown }>
  | Readonly<{ ok: false; error: Readonly<{ code: string; message: string; alternatives?: readonly unknown[] }> }>;

export type ChatToolExecutor = (name: string, args: unknown, meta: Readonly<{ idempotencyKey?: string | null }>) => Promise<ChatToolResult>;

export type ToolCallRecord = Readonly<{
  name: string;
  args: unknown;
  idempotencyKey: string | null;
  outcome: ChatToolResult;
  /** True for a Cadence write that changed a record. */
  changed: boolean;
  /** True when the same idempotency key returned an earlier result. */
  replayed: boolean;
}>;

export const CHAT_ONLY_TOOLS = ["list_calendar_events", "list_calendar_load", "list_workouts", "search_advice", "plan_alongside_pairings"] as const;

export const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  "set_occurrence_status", "update_occurrence_note", "move_occurrence_for_day", "revert_occurrence_move", "update_day_note",
  "create_behavior", "update_behavior", "archive_behavior", "restore_behavior",
  "add_opportunity_occurrence", "remove_opportunity_occurrence",
]);

export type FakeExecutor = Readonly<{
  execute: ChatToolExecutor;
  calls: ToolCallRecord[];
  world: ChatWorld;
}>;

export function createFakeExecutor(world: ChatWorld): FakeExecutor {
  const calls: ToolCallRecord[] = [];
  const replays = new Map<string, ChatToolResult>();
  const execute: ChatToolExecutor = async (name, args, meta) => {
    const key = meta.idempotencyKey ?? (isRecord(args) && typeof args.idempotency_key === "string" ? args.idempotency_key : null);
    const replayKey = key ? `${name}:${key}` : null;
    if (replayKey && replays.has(replayKey)) {
      const outcome = replays.get(replayKey)!;
      calls.push({ name, args, idempotencyKey: key, outcome, changed: false, replayed: true });
      return outcome;
    }
    const before = WRITE_OPERATIONS.has(name) ? snapshot(world) : null;
    const outcome = withWorldPlanning(world, name, run(world, name, args));
    const changed = before !== null && outcome.ok && snapshot(world) !== before;
    if (replayKey && WRITE_OPERATIONS.has(name)) replays.set(replayKey, outcome);
    calls.push({ name, args, idempotencyKey: key, outcome, changed, replayed: false });
    return outcome;
  };
  return { execute, calls, world };
}

/**
 * Ticket 359: in a world read with CADENCE_ALONGSIDE on, timeline and Behavior reads carry
 * `planning` the way the live executor adds it (after the output schema check).
 */
function withWorldPlanning(world: ChatWorld, name: string, outcome: ChatToolResult): ChatToolResult {
  if (!world.alongside || !outcome.ok || !CHAT_PLANNING_READS.has(name)) return outcome;
  const facts = new Map(world.behaviors.map((item) => {
    const planning = item.planning ?? { alongside: false, alongsideSource: "default" as const, where: "unknown" as const, whereSource: "none" as const };
    return [item.id, { alongside: { value: planning.alongside, source: planning.alongsideSource }, where: { kind: planning.where, source: planning.whereSource } }];
  }));
  return { ok: true, result: withChatPlanning(outcome.result, facts) };
}

function snapshot(world: ChatWorld): string {
  return JSON.stringify([world.behaviors, world.occurrences, [...world.dayNotes]]);
}

function run(world: ChatWorld, name: string, args: unknown): ChatToolResult {
  if (name === "list_calendar_events") return calendarEvents(world, args);
  if (name === "list_calendar_load") return { ok: true, result: { days: [], sources: [], note: null } };
  if (name === "list_workouts") return workouts(world, args);
  if (name === "search_advice") return searchAdvice(world, args);
  if (name === "plan_alongside_pairings") return pairings(world, args);
  if (!isIntegrationOperationName(name)) return fail("not_found", `No tool named ${name}.`);
  const input = validateOperationInput(name, args ?? {});
  if (!input.ok) return fail("invalid_input", `${input.error.message} ${input.issues.slice(0, 3).map((item) => `${item.path} ${item.message}`).join("; ")}`.trim());
  const handler = HANDLERS[name];
  const result = handler(world, input.value as Record<string, unknown>);
  if (!result.ok) return result;
  const output = validateOperationOutput(name, result.result);
  // A mismatch is a bug in this fake, not the model's fault.
  if (!output.ok) throw new Error(`fake ${name} output invalid: ${JSON.stringify(output.issues.slice(0, 3))}`);
  return result;
}

function ok(result: unknown): ChatToolResult {
  return { ok: true, result };
}

function fail(code: string, message: string): ChatToolResult {
  return { ok: false, error: { code, message } };
}

// ----------------------------------------------------------------- output shapes

const APP_URL = "https://app.cadence.test";

function nowInstant(world: ChatWorld): string {
  return toInstant(world, world.today, world.now);
}

function freshness(world: ChatWorld) {
  return { as_of: nowInstant(world), occurrences_generated_through: world.today };
}

function derivedId(id: string, prefix: string): string {
  return `${prefix}${id.slice(8)}`;
}

function behaviorOutput(world: ChatWorld, item: WorldBehavior) {
  const recurrence = item.weekdays ? { frequency: "weekly", interval: 1, days_of_week: item.weekdays } : { frequency: "daily", interval: 1 };
  const recurrenceSummary = item.weekdays ? `Weekly on ${item.weekdays.map(capitalize).join(", ")}` : "Every day";
  const created = toInstant(world, "2026-09-01", "09:00");
  return {
    id: item.id, title: item.title, description: item.description, location_text: null, category: item.category,
    state: item.state, archived_at: item.state === "archived" ? nowInstant(world) : null, auto_archived_at: null,
    run_state: item.state === "archived" ? "archived" : "running", is_opportunity: item.isOpportunity === true, end_on: null, end_time: null, pause: null, end_date: null,
    default_duration_minutes: item.durationMinutes, timezone: world.timezone,
    schedules: item.unscheduled ? [] : [{ id: derivedId(item.id, "00000001"), recurrence, recurrence_summary: recurrenceSummary,
      time_entries: [{ id: derivedId(item.id, "00000002"), kind: "exact", preset: null, start_time: item.time, end_time: null, label: clockLabel(item.time) }],
      time_summary: clockLabel(item.time) }],
    schedule_summary: item.unscheduled ? "" : `${recurrenceSummary} at ${clockLabel(item.time)}`,
    reminders: { browser_enabled: true, email_enabled: false, offset_minutes: 0, summary: "Browser reminder at the scheduled time" },
    archive_notes: item.archiveNote ? [{ id: derivedId(item.id, "00000003"), archived_at: nowInstant(world), note: item.archiveNote, updated_at: nowInstant(world) }] : [],
    external_ref: null, parent_behavior_id: null, sub_behavior_sort_order: 0, inherit_parent_schedule: false, sub_behaviors: [],
    created_at: created, updated_at: created, revision: `r${item.revision}`,
  };
}

function occurrenceOutput(world: ChatWorld, item: WorldOccurrence) {
  const behavior = world.behaviors.find((row) => row.id === item.behaviorId)!;
  const planned = toInstant(world, item.localDate, item.time);
  const at = effectiveTime(item);
  const effective = toInstant(world, item.localDate, at);
  const minutes = behavior.durationMinutes ?? 0;
  return {
    id: item.id, behavior_id: behavior.id, behavior_title: behavior.title, category_name: behavior.category?.name ?? null,
    local_date: item.localDate, timezone: world.timezone, scheduled_for: planned, effective_start_at: effective,
    move: item.moves.length ? { planned_start_at: planned, start_at: effective, end_at: toInstant(world, item.localDate, timeOf(Math.min(minutesOf(at) + minutes, 1439))) } : null,
    schedule: item.rangeEnd
      ? { kind: "range", preset: item.preset ?? null, start_time: item.time, end_time: item.rangeEnd, label: `${clockLabel(item.time)} to ${clockLabel(item.rangeEnd)}` }
      : { kind: "exact", preset: null, start_time: item.time, end_time: null, label: clockLabel(item.time) },
    status: item.status, status_label: item.status === "completed" ? "Completed" : item.status === "not_completed" ? "Not Completed" : "Unresolved",
    needs_decision: item.status === "unresolved" && item.localDate < world.today,
    origin: item.origin ?? "scheduled", added_by: item.origin === "opportunity" ? item.addedBy ?? "chat" : null,
    completed_at: item.status === "completed" && item.markedAt ? toInstant(world, item.localDate, item.markedAt) : null,
    status_marked_at: item.markedAt && item.status !== "unresolved" ? toInstant(world, item.localDate, item.markedAt) : null,
    note: item.note, updated_at: planned, revision: `r${item.revision}`,
  };
}

function occurrenceDetail(world: ChatWorld, item: WorldOccurrence) {
  const base = occurrenceOutput(world, item);
  const history = item.status === "unresolved" || !item.markedAt ? [] : [{
    id: derivedId(item.id, "00000004"), previous_status: "unresolved", status: item.status, semantics: "explicit_user_mark", capture_method: "manual_tap",
    recorded_at: toInstant(world, item.localDate, item.markedAt), effective_at: null, local_date: item.localDate, timezone: world.timezone,
  }];
  return { ...base, status_history: history, time_sessions: [] };
}

function dayNoteOutput(world: ChatWorld, localDate: string) {
  const row = world.dayNotes.get(localDate);
  return row ? { id: row.id, local_date: localDate, note: row.note, revision: `r${row.revision}`, updated_at: toInstant(world, localDate, "12:00") } : null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function sortedOccurrences(items: readonly WorldOccurrence[]): WorldOccurrence[] {
  return [...items].sort((a, b) => a.localDate.localeCompare(b.localDate) || effectiveTime(a).localeCompare(effectiveTime(b)));
}

function findOccurrence(world: ChatWorld, id: unknown): WorldOccurrence | null {
  return world.occurrences.find((item) => item.id === id) ?? null;
}

function findBehavior(world: ChatWorld, id: unknown): WorldBehavior | null {
  return world.behaviors.find((item) => item.id === id) ?? null;
}

function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let day = Temporal.PlainDate.from(start); Temporal.PlainDate.compare(day, Temporal.PlainDate.from(end)) <= 0; day = day.add({ days: 1 })) out.push(day.toString());
  return out;
}

// ----------------------------------------------------------------- Cadence operations

type Handler = (world: ChatWorld, input: Record<string, unknown>) => ChatToolResult;

const HANDLERS: Record<IntegrationOperationName, Handler> = {
  get_account_context: (world) => ok({
    account_ref: "chat_eval_account_ref", timezone: world.timezone, today_local_date: world.today, local_time: world.now,
    now: nowInstant(world), granted_scopes: [...INTEGRATION_SCOPE_LIST], contract_version: INTEGRATION_CONTRACT_VERSION, freshness: freshness(world),
  }),

  list_behaviors: (world, input) => {
    const state = (input.state as string | undefined) ?? "all";
    // The eval world has no end or pause: every active Behavior is running.
    const inState = (item: WorldBehavior) => state === "all" || item.state === (state === "running" ? "active" : state === "not_running" ? "none" : state);
    const opportunity = input.is_opportunity as boolean | undefined;
    return ok({ behaviors: world.behaviors.filter((item) => inState(item) && (opportunity === undefined || (item.isOpportunity === true) === opportunity))
      .map((item) => behaviorOutput(world, item)), next_cursor: null });
  },

  get_behavior: (world, input) => {
    const item = findBehavior(world, input.behavior_id);
    return item ? ok({ behavior: behaviorOutput(world, item) }) : fail("not_found", "No Behavior with this id.");
  },

  list_categories: (world) => ok({ categories: world.categories.map((item, index) => ({ id: item.id, name: item.name, description: null,
    sort_order: index, created_at: toInstant(world, "2026-09-01", "09:00"), updated_at: toInstant(world, "2026-09-01", "09:00") })), next_cursor: null }),

  get_timeline: (world, input) => {
    const start = (input.start_local_date as string | undefined) ?? world.today;
    const days = (input.days as number | undefined) ?? 1;
    const dates = daysBetween(start, Temporal.PlainDate.from(start).add({ days: days - 1 }).toString());
    const needs = sortedOccurrences(world.occurrences.filter((item) => item.status === "unresolved" && item.localDate < world.today));
    return ok({
      timezone: world.timezone, today_local_date: world.today,
      needs_decision: input.include_needs_decision === false ? null : { occurrences: needs.map((item) => occurrenceOutput(world, item)), total_count: needs.length,
        truncated: false, lookback_start_local_date: Temporal.PlainDate.from(world.today).subtract({ days: 90 }).toString() },
      days: dates.map((date) => ({ local_date: date, is_today: date === world.today, day_note: world.dayNotes.get(date)?.note ?? null,
        occurrences: sortedOccurrences(world.occurrences.filter((item) => item.localDate === date)).map((item) => occurrenceOutput(world, item)) })),
      freshness: freshness(world),
    });
  },

  list_occurrences: (world, input) => {
    const statuses = input.statuses as string[] | undefined;
    const behaviorIds = input.behavior_ids as string[] | undefined;
    const items = sortedOccurrences(world.occurrences.filter((item) => item.localDate >= (input.start_local_date as string) && item.localDate <= (input.end_local_date as string)
      && (!statuses || statuses.includes(item.status)) && (!behaviorIds || behaviorIds.includes(item.behaviorId))
      && (!input.needs_decision_only || (item.status === "unresolved" && item.localDate < world.today))));
    // Pages like the server: page_size (default 50, max 100), and an opaque cursor for the next page.
    const size = (input.page_size as number | undefined) ?? 50;
    const offset = typeof input.cursor === "string" && /^p\d+$/.test(input.cursor) ? Number(input.cursor.slice(1)) : 0;
    const page = items.slice(offset, offset + size);
    return ok({ timezone: world.timezone, occurrences: page.map((item) => occurrenceOutput(world, item)),
      next_cursor: offset + size < items.length ? `p${offset + size}` : null, freshness: freshness(world) });
  },

  list_day_notes: (world, input) => ok({ timezone: world.timezone,
    day_notes: daysBetween(input.start_local_date as string, input.end_local_date as string).flatMap((date) => {
      const row = dayNoteOutput(world, date);
      return row && row.note !== null ? [row] : [];
    }) }),

  get_occurrence: (world, input) => {
    const item = findOccurrence(world, input.occurrence_id);
    return item ? ok({ occurrence: occurrenceDetail(world, item) }) : fail("not_found", "No Occurrence with this id.");
  },

  get_adherence_summary: (world, input) => {
    const inRange = world.occurrences.filter((item) => item.localDate >= (input.start_local_date as string) && item.localDate <= (input.end_local_date as string));
    const filter = input.behavior_ids as string[] | undefined;
    const counts = (all: readonly WorldOccurrence[]) => {
      // Adherence covers scheduled items; added opportunities are counted apart.
      const items = all.filter((item) => item.origin !== "opportunity");
      const completed = items.filter((item) => item.status === "completed").length;
      const notCompleted = items.filter((item) => item.status === "not_completed").length;
      return { completed, not_completed: notCompleted, unresolved: items.filter((item) => item.status === "unresolved").length,
        needs_decision: items.filter((item) => item.status === "unresolved" && item.localDate < world.today).length,
        adherence_rate: completed + notCompleted ? completed / (completed + notCompleted) : null,
        opportunity_completed_count: all.filter((item) => item.origin === "opportunity" && item.status === "completed").length };
    };
    const behaviors = world.behaviors.filter((item) => !filter || filter.includes(item.id));
    const scoped = inRange.filter((item) => behaviors.some((row) => row.id === item.behaviorId));
    return ok({ start_local_date: input.start_local_date, end_local_date: input.end_local_date, timezone: world.timezone, adherence_definition: ADHERENCE_DEFINITION,
      overall: counts(scoped), behaviors: behaviors.map((row) => ({ behavior_id: row.id, behavior_title: row.title, state: row.state,
        ...counts(scoped.filter((item) => item.behaviorId === row.id)) })) });
  },

  search: (world, input) => {
    const query = (input.query as string).toLowerCase();
    const hit = (text: string | null) => !!text && text.toLowerCase().includes(query);
    const results = [
      ...world.behaviors.filter((item) => hit(item.title) || hit(item.description)).map((item) => ({ id: `behavior:${item.id}`, title: item.title, url: `${APP_URL}/behaviors/${item.id}` })),
      ...world.occurrences.filter((item) => hit(item.note)).map((item) => ({ id: `occurrence:${item.id}`,
        title: `${findBehavior(world, item.behaviorId)!.title} on ${item.localDate}`, url: `${APP_URL}/timeline?date=${item.localDate}` })),
      ...[...world.dayNotes].filter(([, row]) => hit(row.note)).map(([date, row]) => ({ id: `day_note:${row.id}`, title: `Day note ${date}`, url: `${APP_URL}/timeline?date=${date}` })),
    ].slice(0, 20);
    return ok({ results });
  },

  fetch: (world, input) => {
    const [kind, id] = (input.id as string).split(":");
    if (kind === "behavior") {
      const item = findBehavior(world, id);
      if (!item) return fail("not_found", "Not found.");
      return ok({ id: input.id, title: item.title, url: `${APP_URL}/behaviors/${item.id}`,
        text: `Behavior "${item.title}". Description: ${item.description ? JSON.stringify(item.description) : "none"}.`, metadata: { kind, behavior_id: item.id } });
    }
    if (kind === "occurrence") {
      const item = findOccurrence(world, id);
      if (!item) return fail("not_found", "Not found.");
      const title = findBehavior(world, item.behaviorId)!.title;
      return ok({ id: input.id, title: `${title} on ${item.localDate}`, url: `${APP_URL}/timeline?date=${item.localDate}`,
        text: `Occurrence of "${title}" on ${item.localDate}, status ${item.status}. Note: ${item.note ? JSON.stringify(item.note) : "none"}.`,
        metadata: { kind, behavior_id: item.behaviorId, local_date: item.localDate, status: item.status } });
    }
    const entry = [...world.dayNotes].find(([, row]) => row.id === id);
    if (!entry) return fail("not_found", "Not found.");
    return ok({ id: input.id, title: `Day note ${entry[0]}`, url: `${APP_URL}/timeline?date=${entry[0]}`,
      text: `Day note for ${entry[0]}: ${JSON.stringify(entry[1].note)}`, metadata: { kind: "day_note", local_date: entry[0] } });
  },

  // The eval world has no parent Behaviors yet (contract 1.7.0).
  set_parent_occurrence_status: (world, input) => findBehavior(world, input.parent_behavior_id)
    ? fail("invalid_state", "This Behavior has no sub-behaviors. Use set_occurrence_status.")
    : fail("not_found", "No Behavior with this id."),

  set_occurrence_status: (world, input) => {
    const item = findOccurrence(world, input.occurrence_id);
    if (!item) return fail("not_found", "No Occurrence with this id.");
    if (input.expected_status && input.expected_status !== item.status) return fail("conflict", "The status changed since you read it.");
    const previous = item.status;
    const changed = previous !== input.status;
    if (changed) {
      item.status = input.status as WorldOccurrence["status"];
      item.markedAt = item.status === "unresolved" ? null : world.now;
      item.revision += 1;
    }
    return ok({ occurrence: occurrenceOutput(world, item), previous_status: previous, changed });
  },

  update_occurrence_note: (world, input) => {
    const item = findOccurrence(world, input.occurrence_id);
    if (!item) return fail("not_found", "No Occurrence with this id.");
    if (input.expected_revision && input.expected_revision !== `r${item.revision}`) return fail("conflict", "The Occurrence changed since you read it.");
    const note = (input.note as string) === "" ? null : input.note as string;
    const changed = note !== item.note;
    if (changed) { item.note = note; item.revision += 1; }
    return ok({ occurrence: occurrenceOutput(world, item), changed });
  },

  move_occurrence_for_day: (world, input) => move(world, input),

  add_opportunity_occurrence: (world, input) => addOpportunity(world, input),

  remove_opportunity_occurrence: (world, input) => {
    const item = findOccurrence(world, input.occurrence_id);
    if (!item) return fail("not_found", "No Occurrence with this id.");
    const title = findBehavior(world, item.behaviorId)!.title;
    const refuse = (reason: string, message: string) => ok({ outcome: "refused", occurrence: occurrenceOutput(world, item), refusal: { reason, message } });
    if (item.origin !== "opportunity") return refuse("scheduled", `${title} is on its schedule. Only an added item can be removed.`);
    if (input.expected_revision !== undefined && input.expected_revision !== `r${item.revision}`) return refuse("revision_changed", `${title} changed since it was read.`);
    if (item.status !== "unresolved") return refuse("marked", `${title} is already marked, so it stays.`);
    if (item.note) return refuse("kept", `${title} has a Note, so it stays.`);
    const output = occurrenceOutput(world, item);
    world.occurrences.splice(world.occurrences.indexOf(item), 1);
    return ok({ outcome: "removed", occurrence: output, refusal: null });
  },

  revert_occurrence_move: (world, input) => {
    const item = findOccurrence(world, input.occurrence_id);
    if (!item) return fail("not_found", "No Occurrence with this id.");
    const refuse = (reason: string, message: string) => ok({ outcome: "refused", occurrence: occurrenceOutput(world, item), move: null, refusal: { reason, message, alternatives: [] } });
    if (input.expected_revision !== `r${item.revision}`) return refuse("revision_changed", "This item changed since you read it.");
    if (!item.moves.length) return refuse("nothing_to_undo", "This item has no move to undo.");
    const from = effectiveTime(item);
    item.moves.pop();
    item.revision += 1;
    return ok({ outcome: "undone", occurrence: occurrenceOutput(world, item), move: moveRecord(world, item, from, "revert"), refusal: null });
  },

  update_day_note: (world, input) => {
    const date = input.local_date as string;
    const row = world.dayNotes.get(date);
    if (input.expected_revision && (!row || input.expected_revision !== `r${row.revision}`)) return fail("conflict", "The day note changed since you read it.");
    const note = (input.note as string) === "" ? null : input.note as string;
    if (!row && note === null) return ok({ local_date: date, day_note: null, changed: false });
    const changed = !row || row.note !== note;
    if (!row) world.dayNotes.set(date, { id: newId(world), note, revision: 1 });
    else if (changed) { row.note = note; row.revision += 1; }
    return ok({ local_date: date, day_note: dayNoteOutput(world, date), changed });
  },

  create_behavior: (world, input) => {
    const schedule = (input.schedules as Record<string, unknown>[])[0] as Record<string, unknown> | undefined;
    const entry = schedule ? (schedule.time_entries as Record<string, unknown>[])[0] : undefined;
    const recurrence = (schedule?.recurrence ?? {}) as Record<string, unknown>;
    const item: WorldBehavior = { id: newId(world),
      title: input.title as string, description: (input.description as string | undefined) ?? null, category: null, state: "active",
      weekdays: recurrence.frequency === "weekly" ? recurrence.days_of_week as Weekday[] : null,
      time: (entry?.start_time as string | undefined) ?? "09:00", durationMinutes: (input.default_duration_minutes as number | undefined) ?? null, revision: 1, archiveNote: null,
      isOpportunity: input.is_opportunity === true, unscheduled: !schedule };
    world.behaviors.push(item);
    return ok({ behavior: behaviorOutput(world, item) });
  },

  update_behavior: (world, input) => {
    const item = findBehavior(world, input.behavior_id);
    if (!item) return fail("not_found", "No Behavior with this id.");
    if (input.expected_revision !== `r${item.revision}`) return fail("conflict", "The Behavior changed since you read it.");
    const before = JSON.stringify(item);
    if (typeof input.title === "string") item.title = input.title;
    if ("description" in input) item.description = (input.description as string | null) ?? null;
    if ("default_duration_minutes" in input) item.durationMinutes = (input.default_duration_minutes as number | null) ?? null;
    if (typeof input.is_opportunity === "boolean") item.isOpportunity = input.is_opportunity;
    if (Array.isArray(input.schedules) && input.schedules.length === 0) {
      if (!item.isOpportunity) return fail("invalid_input", "Add at least one schedule.");
      item.unscheduled = true;
    } else if (Array.isArray(input.schedules)) {
      item.unscheduled = false;
      const schedule = input.schedules[0] as Record<string, unknown>;
      const recurrence = schedule.recurrence as Record<string, unknown>;
      const entry = (schedule.time_entries as Record<string, unknown>[])[0];
      item.weekdays = recurrence.frequency === "weekly" ? recurrence.days_of_week as Weekday[] : null;
      if (typeof entry.start_time === "string") item.time = entry.start_time;
    }
    const changed = JSON.stringify(item) !== before;
    if (changed) item.revision += 1;
    return ok({ behavior: behaviorOutput(world, item), changed });
  },

  archive_behavior: (world, input) => {
    const item = findBehavior(world, input.behavior_id);
    if (!item) return fail("not_found", "No Behavior with this id.");
    const changed = item.state !== "archived";
    if (changed) { item.state = "archived"; item.archiveNote = (input.archive_note as string | undefined) ?? null; item.revision += 1; }
    return ok({ behavior: behaviorOutput(world, item), changed });
  },

  restore_behavior: (world, input) => {
    const item = findBehavior(world, input.behavior_id);
    if (!item) return fail("not_found", "No Behavior with this id.");
    const changed = item.state !== "active";
    if (changed) { item.state = "active"; item.revision += 1; }
    return ok({ behavior: behaviorOutput(world, item), changed });
  },

  // The eval world has no end or pause; these answer as for a running Behavior.
  end_behavior: (world, input) => runActionUnsupported(world, input),
  pause_behavior: (world, input) => runActionUnsupported(world, input),
  resume_behavior: (world, input) => {
    const item = findBehavior(world, input.behavior_id);
    return item ? ok({ behavior: behaviorOutput(world, item), changed: false }) : fail("not_found", "No Behavior with this id.");
  },
};

function runActionUnsupported(world: ChatWorld, input: Record<string, unknown>): ChatToolResult {
  const item = findBehavior(world, input.behavior_id);
  if (!item) return fail("not_found", "No Behavior with this id.");
  return fail("invalid_state", "The chat eval world does not model ended or paused Behaviors.");
}

function moveRecord(world: ChatWorld, item: WorldOccurrence, from: string, kind: "move" | "revert") {
  const behavior = findBehavior(world, item.behaviorId)!;
  const to = effectiveTime(item);
  return { id: derivedId(item.id, `0000${String(10 + item.moves.length).padStart(4, "0")}`), kind,
    from_start_at: toInstant(world, item.localDate, from), to_start_at: toInstant(world, item.localDate, to),
    to_end_at: toInstant(world, item.localDate, timeOf(Math.min(minutesOf(to) + (behavior.durationMinutes ?? 0), 1439))),
    to_planned: to === item.time, chain_position: item.moves.length + (kind === "revert" ? 1 : 0), source: "chat", created_at: nowInstant(world) };
}

/**
 * Busy minutes today: calendar events (when calendars are on) and other timed Cadence items.
 * Ticket 361: in a world read with CADENCE_ALONGSIDE on, an alongside item follows the
 * same-place rule, as the live move check does: it may share time with a calendar event or
 * an item where `alongsideMayOverlap` allows it.
 */
function busyIntervals(world: ChatWorld, except: WorldOccurrence | null): { start: number; end: number; kind: "calendar_busy" | "slot_taken"; label: string }[] {
  const planningOf = (item: WorldOccurrence) => world.alongside ? findBehavior(world, item.behaviorId)?.planning : undefined;
  const placeOf = (item: WorldOccurrence) => ({ kind: planningOf(item)?.where ?? "unknown" as const });
  const mover = except ? planningOf(except) : undefined;
  const moverAlongside = mover?.alongside === true;
  const sharesTime = (item: WorldOccurrence) => world.alongside && except !== null
    && ((moverAlongside && alongsideMayOverlap({ where: placeOf(except) }, { kind: "item", where: placeOf(item) }))
      || (planningOf(item)?.alongside === true && alongsideMayOverlap({ where: placeOf(item) }, { kind: "item", where: placeOf(except) })));
  const events = world.sourcesOff.has("calendar") || (world.alongside && moverAlongside) ? [] : world.events.filter((item) => item.localDate === world.today)
    .map((item) => ({ start: minutesOf(item.start), end: minutesOf(item.end), kind: "calendar_busy" as const, label: item.title }));
  const items = world.occurrences.filter((item) => item.localDate === world.today && item.id !== except?.id && item.status === "unresolved" && !sharesTime(item)).flatMap((item) => {
    const minutes = findBehavior(world, item.behaviorId)!.durationMinutes;
    return minutes ? [{ start: minutesOf(effectiveTime(item)), end: minutesOf(effectiveTime(item)) + minutes, kind: "slot_taken" as const,
      label: findBehavior(world, item.behaviorId)!.title }] : [];
  });
  return [...events, ...items];
}

function move(world: ChatWorld, input: Record<string, unknown>): ChatToolResult {
  const item = findOccurrence(world, input.occurrence_id);
  if (!item) return fail("not_found", "No Occurrence with this id.");
  const behavior = findBehavior(world, item.behaviorId)!;
  const length = behavior.durationMinutes ?? 15;
  const target = minutesOf(input.start_time as string);
  const busy = busyIntervals(world, item);
  const clash = (start: number) => busy.find((row) => start < row.end && start + length > row.start) ?? null;
  const alternatives = () => {
    const found: number[] = [];
    const now = minutesOf(world.now);
    for (let step = 15; step <= 24 * 60 && found.length < 3; step += 15) {
      for (const start of [target + step, target - step]) {
        if (found.length < 3 && start > now && start + length <= 24 * 60 && start % 15 === 0 && start !== minutesOf(effectiveTime(item)) && !clash(start)) found.push(start);
      }
    }
    return found.map((start) => ({ start_at: toInstant(world, item.localDate, timeOf(start)), start_time: timeOf(start) }));
  };
  const refuse = (reason: string, message: string, withAlternatives = false) => ok({ outcome: "refused", occurrence: occurrenceOutput(world, item), move: null,
    refusal: { reason, message, alternatives: withAlternatives ? alternatives() : [] } });
  if (item.localDate !== world.today) return refuse("not_today", "Only today's items can be moved.");
  if (item.status !== "unresolved") return refuse("occurrence_resolved", "This item is already marked.");
  if (input.expected_revision !== `r${item.revision}`) return refuse("revision_changed", "This item changed since you read it.");
  if (target <= minutesOf(world.now)) return refuse("time_passed", "That time has already passed today.", true);
  if (minutesOf(effectiveTime(item)) === target) return refuse("no_change", "The item is already at that time.");
  const blocker = clash(target);
  if (blocker) return refuse(blocker.kind, blocker.kind === "calendar_busy" ? `${blocker.label} is on your calendar then.` : `${blocker.label} is already at that time.`, true);
  const from = effectiveTime(item);
  item.moves.push(input.start_time as string);
  item.revision += 1;
  return ok({ outcome: "moved", occurrence: occurrenceOutput(world, item), move: moveRecord(world, item, from, "move"), refusal: null });
}

/** Ticket 361: Chat's pairing tool on the world's today, through the real planner. */
function pairings(world: ChatWorld, args: unknown): ChatToolResult {
  if (!world.alongside) return fail("not_found", "No tool named plan_alongside_pairings.");
  const occurrenceId = isRecord(args) && typeof args.occurrence_id === "string" ? args.occurrence_id : null;
  const items: BriefMoveDayItem[] = world.occurrences.filter((item) => item.localDate === world.today).flatMap((item) => {
    const behavior = findBehavior(world, item.behaviorId);
    if (!behavior) return [];
    const start = Temporal.Instant.from(toInstant(world, item.localDate, effectiveTime(item)));
    const minutes = behavior.durationMinutes ?? 30;
    const planning = behavior.planning;
    return [{
      occurrenceId: item.id, behaviorId: behavior.id, title: behavior.title, status: item.status, localDate: item.localDate,
      scheduleKind: item.rangeEnd ? "range" as const : "exact" as const, start, end: start.add({ minutes }),
      length: { minutes, source: behavior.durationMinutes ? "behavior_duration" as const : "fallback" as const, assumed: !behavior.durationMinutes },
      alongside: planning?.alongside === true, alongsideSource: planning?.alongsideSource ?? "default",
      where: { kind: planning?.where ?? "unknown", source: planning?.whereSource ?? "none" }, revision: `r${item.revision}`, behaviorRevision: `r${behavior.revision}`,
    }];
  });
  const calendarBusy = world.sourcesOff.has("calendar") ? [] : world.events.filter((item) => item.localDate === world.today).map((item) => ({
    ref: item.id, start: Temporal.Instant.from(toInstant(world, item.localDate, item.start)), end: Temporal.Instant.from(toInstant(world, item.localDate, item.end)) }));
  const found = planAlongsidePairings({
    localDate: world.today, timezone: world.timezone, now: Temporal.Instant.from(nowInstant(world)), items, calendarBusy, travel: null,
    evidence: world.pairingEvidence ?? NO_ALONGSIDE_PAIRING_EVIDENCE,
    ...(occurrenceId ? { onlyGuests: new Set([occurrenceId]), requireNeed: false } : {}),
  });
  return ok({ pairings: found.map((pairing) => chatPairingProposal(pairing, world.timezone)) });
}

const PRESET_TIMES: Readonly<Record<string, readonly [string, string]>> = {
  morning: ["06:00", "12:00"], afternoon: ["12:00", "18:00"], evening: ["18:00", "00:00"], night: ["00:00", "06:00"],
};

/** Adds an opportunity Behavior to today; an exact time is checked against the day like a move. */
function addOpportunity(world: ChatWorld, input: Record<string, unknown>): ChatToolResult {
  const behavior = findBehavior(world, input.behavior_id);
  if (!behavior) return fail("not_found", "No Behavior with this id.");
  const refuse = (reason: string, message: string, alternatives: unknown[] = []) => ok({ outcome: "refused", occurrence: null, refusal: { reason, message, alternatives } });
  if (!behavior.isOpportunity || behavior.state !== "active") return refuse("not_available", `${behavior.title} is no longer available as an opportunity.`);
  const preset = typeof input.preset === "string" ? input.preset as NonNullable<WorldOccurrence["preset"]> : null;
  const start = input.mark_completed === true ? world.now : preset ? PRESET_TIMES[preset]![0] : input.start_time as string;
  const end = preset ? PRESET_TIMES[preset]![1] : typeof input.end_time === "string" ? input.end_time : null;
  if (input.mark_completed !== true && !end) {
    const length = behavior.durationMinutes ?? 30;
    const target = minutesOf(start);
    const clash = (at: number) => busyIntervals(world, null).find((row) => at < row.end && at + length > row.start) ?? null;
    const blocker = clash(target);
    if (blocker) {
      const found: { start_at: string; start_time: string }[] = [];
      for (let step = 15; step <= 24 * 60 && found.length < 3; step += 15) {
        for (const at of [target + step, target - step]) {
          if (found.length < 3 && at > minutesOf(world.now) && at + length <= 24 * 60 && !clash(at)) found.push({ start_at: toInstant(world, world.today, timeOf(at)), start_time: timeOf(at) });
        }
      }
      return refuse(blocker.kind, blocker.kind === "calendar_busy" ? `${blocker.label} is on your calendar then.` : `${blocker.label} is already at that time.`, found);
    }
  }
  const item: WorldOccurrence = { id: newId(world), behaviorId: behavior.id, localDate: world.today, time: start, status: input.mark_completed === true ? "completed" : "unresolved",
    moves: [], note: null, markedAt: input.mark_completed === true ? world.now : null, revision: 1, origin: "opportunity", addedBy: "chat", rangeEnd: end, preset };
  world.occurrences.push(item);
  return ok({ outcome: input.mark_completed === true ? "logged" : "added", occurrence: occurrenceOutput(world, item), refusal: null });
}

// ----------------------------------------------------------------- chat-only tools (5A step 3)

function rangeInput(args: unknown): { start: string; end: string } | null {
  if (!isRecord(args)) return null;
  // 5A's connector tools take start_date and end_date.
  const start = args.start_date ?? args.start_local_date;
  const end = args.end_date ?? args.end_local_date ?? start;
  const valid = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  return valid(start) && valid(end) && start <= end ? { start, end } : null;
}

/** 5A's connector result: the rows, which sources were read, and a note for the model. */
function calendarEvents(world: ChatWorld, args: unknown): ChatToolResult {
  const range = rangeInput(args);
  if (!range) return fail("invalid_input", "Send start_date and end_date as YYYY-MM-DD.");
  if (world.sourcesOff.has("calendar")) return ok({ events: [], sources: [{ source: "google_calendar", state: "off" }], note: "Calendars are off in Settings." });
  if (world.id === "calendar_down") return fail("source_unavailable", "Google Calendar could not be read just now.");
  return ok({ events: world.events.filter((item) => item.localDate >= range.start && item.localDate <= range.end)
    .map((item) => ({ title: item.title, start: toInstant(world, item.localDate, item.start), end: toInstant(world, item.localDate, item.end),
      start_local: `${item.localDate} ${item.start}`, end_local: `${item.localDate} ${item.end}`, calendar: item.calendar, location: item.location })),
    sources: [{ source: "google_calendar", state: "read" }], note: null });
}

function workouts(world: ChatWorld, args: unknown): ChatToolResult {
  const range = rangeInput(args);
  if (!range) return fail("invalid_input", "Send start_date and end_date as YYYY-MM-DD.");
  if (world.sourcesOff.has("workouts")) return ok({ workouts: [], sources: [{ source: "hevy", state: "off" }], note: "Hevy is off in Settings." });
  if (world.id === "new_user") return ok({ workouts: [], sources: [], note: "Hevy is not connected." });
  return ok({ workouts: world.workouts.filter((item) => item.localDate >= range.start && item.localDate <= range.end)
    // Same shape as 5A's live read: Hevy titles and exercise counts are not passed to chat.
    .map((item) => ({ start: toInstant(world, item.localDate, item.start),
      end: toInstant(world, item.localDate, timeOf(minutesOf(item.start) + item.minutes)), minutes: item.minutes, date: item.localDate })),
    sources: [{ source: "hevy", state: "read" }], note: null });
}

function searchAdvice(world: ChatWorld, args: unknown): ChatToolResult {
  const query = isRecord(args) && typeof args.query === "string" ? args.query.toLowerCase() : "";
  if (!query.trim()) return fail("invalid_input", "Send a query.");
  const words = query.split(/\W+/).filter((word) => word.length > 2);
  const cards = world.adviceCards.filter((card) => card.topics.some((topic) => words.some((word) => word.startsWith(topic) || topic.startsWith(word))));
  return ok({ cards: cards.map((card) => Object.fromEntries(Object.entries(card).filter(([key]) => key !== "topics"))) });
}

/** Ids for records made during a run, distinct from the world's own ids. */
function newId(world: ChatWorld): string {
  const used = world.behaviors.length + world.dayNotes.size + world.occurrences.length;
  return `00000000-0000-4000-9000-${String(used).padStart(12, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
