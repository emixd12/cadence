import { Temporal } from "@js-temporal/polyfill";
import {
  ADHERENCE_DEFINITION, INTEGRATION_CONTRACT_VERSION, INTEGRATION_SCOPE_LIST, isIntegrationOperationName,
  validateOperationInput, validateOperationOutput, type IntegrationOperationName,
} from "@cadence/core/integration";
import {
  clockLabel, effectiveTime, minutesOf, timeOf, toInstant,
  type ChatWorld, type WorldBehavior, type WorldOccurrence, type Weekday,
} from "./world";

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

export type ChatToolExecutor = (name: string, args: unknown, meta: Readonly<{ idempotencyKey?: string }>) => Promise<ChatToolResult>;

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

export const CHAT_ONLY_TOOLS = ["list_calendar_events", "list_workouts", "search_advice"] as const;

export const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  "set_occurrence_status", "update_occurrence_note", "move_occurrence_for_day", "revert_occurrence_move", "update_day_note",
  "create_behavior", "update_behavior", "archive_behavior", "restore_behavior",
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
    const outcome = run(world, name, args);
    const changed = before !== null && outcome.ok && snapshot(world) !== before;
    if (replayKey && WRITE_OPERATIONS.has(name)) replays.set(replayKey, outcome);
    calls.push({ name, args, idempotencyKey: key, outcome, changed, replayed: false });
    return outcome;
  };
  return { execute, calls, world };
}

function snapshot(world: ChatWorld): string {
  return JSON.stringify([world.behaviors, world.occurrences, [...world.dayNotes]]);
}

function run(world: ChatWorld, name: string, args: unknown): ChatToolResult {
  if (name === "list_calendar_events") return calendarEvents(world, args);
  if (name === "list_workouts") return workouts(world, args);
  if (name === "search_advice") return searchAdvice(world, args);
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
    state: item.state, archived_at: item.state === "archived" ? nowInstant(world) : null, auto_archived_at: null, end_date: null,
    default_duration_minutes: item.durationMinutes, timezone: world.timezone,
    schedules: [{ id: derivedId(item.id, "00000001"), recurrence, recurrence_summary: recurrenceSummary,
      time_entries: [{ id: derivedId(item.id, "00000002"), kind: "exact", preset: null, start_time: item.time, end_time: null, label: clockLabel(item.time) }],
      time_summary: clockLabel(item.time) }],
    schedule_summary: `${recurrenceSummary} at ${clockLabel(item.time)}`,
    reminders: { browser_enabled: true, email_enabled: false, offset_minutes: 0, summary: "Browser reminder at the scheduled time" },
    archive_notes: item.archiveNote ? [{ id: derivedId(item.id, "00000003"), archived_at: nowInstant(world), note: item.archiveNote, updated_at: nowInstant(world) }] : [],
    external_ref: null, created_at: created, updated_at: created, revision: `r${item.revision}`,
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
    schedule: { kind: "exact", preset: null, start_time: item.time, end_time: null, label: clockLabel(item.time) },
    status: item.status, status_label: item.status === "completed" ? "Completed" : item.status === "not_completed" ? "Not Completed" : "Unresolved",
    needs_decision: item.status === "unresolved" && item.localDate < world.today,
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
    return ok({ behaviors: world.behaviors.filter((item) => state === "all" || item.state === state).map((item) => behaviorOutput(world, item)), next_cursor: null });
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
    return ok({ timezone: world.timezone, occurrences: items.map((item) => occurrenceOutput(world, item)), next_cursor: null, freshness: freshness(world) });
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
    const counts = (items: readonly WorldOccurrence[]) => {
      const completed = items.filter((item) => item.status === "completed").length;
      const notCompleted = items.filter((item) => item.status === "not_completed").length;
      return { completed, not_completed: notCompleted, unresolved: items.filter((item) => item.status === "unresolved").length,
        needs_decision: items.filter((item) => item.status === "unresolved" && item.localDate < world.today).length,
        adherence_rate: completed + notCompleted ? completed / (completed + notCompleted) : null };
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
    const schedule = (input.schedules as Record<string, unknown>[])[0];
    const entry = (schedule.time_entries as Record<string, unknown>[])[0];
    const recurrence = schedule.recurrence as Record<string, unknown>;
    const item: WorldBehavior = { id: newId(world),
      title: input.title as string, description: (input.description as string | undefined) ?? null, category: null, state: "active",
      weekdays: recurrence.frequency === "weekly" ? recurrence.days_of_week as Weekday[] : null,
      time: (entry.start_time as string | undefined) ?? "09:00", durationMinutes: (input.default_duration_minutes as number | undefined) ?? null, revision: 1, archiveNote: null };
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
    if (Array.isArray(input.schedules)) {
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
};

function moveRecord(world: ChatWorld, item: WorldOccurrence, from: string, kind: "move" | "revert") {
  const behavior = findBehavior(world, item.behaviorId)!;
  const to = effectiveTime(item);
  return { id: derivedId(item.id, `0000${String(10 + item.moves.length).padStart(4, "0")}`), kind,
    from_start_at: toInstant(world, item.localDate, from), to_start_at: toInstant(world, item.localDate, to),
    to_end_at: toInstant(world, item.localDate, timeOf(Math.min(minutesOf(to) + (behavior.durationMinutes ?? 0), 1439))),
    to_planned: to === item.time, chain_position: item.moves.length + (kind === "revert" ? 1 : 0), source: "chat", created_at: nowInstant(world) };
}

/** Busy minutes today: calendar events (when calendars are on) and other timed Cadence items. */
function busyIntervals(world: ChatWorld, except: WorldOccurrence): { start: number; end: number; kind: "calendar_busy" | "slot_taken"; label: string }[] {
  const events = world.sourcesOff.has("calendar") ? [] : world.events.filter((item) => item.localDate === world.today)
    .map((item) => ({ start: minutesOf(item.start), end: minutesOf(item.end), kind: "calendar_busy" as const, label: item.title }));
  const items = world.occurrences.filter((item) => item.localDate === world.today && item.id !== except.id && item.status === "unresolved").flatMap((item) => {
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

// ----------------------------------------------------------------- chat-only tools (5A step 3)

function rangeInput(args: unknown): { start: string; end: string } | null {
  if (!isRecord(args)) return null;
  const start = args.start_local_date;
  const end = args.end_local_date ?? start;
  const valid = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  return valid(start) && valid(end) && start <= end ? { start, end } : null;
}

function calendarEvents(world: ChatWorld, args: unknown): ChatToolResult {
  const range = rangeInput(args);
  if (!range) return fail("invalid_input", "Send start_local_date and end_local_date as YYYY-MM-DD.");
  if (world.sourcesOff.has("calendar")) return ok({ status: "off", message: "The person turned off calendar reading for chat in Settings.", events: [] });
  return ok({ status: "ok", timezone: world.timezone, events: world.events.filter((item) => item.localDate >= range.start && item.localDate <= range.end)
    .map((item) => ({ title: item.title, calendar: item.calendar, local_date: item.localDate, start_time: item.start, end_time: item.end, location: item.location })) });
}

function workouts(world: ChatWorld, args: unknown): ChatToolResult {
  const range = rangeInput(args);
  if (!range) return fail("invalid_input", "Send start_local_date and end_local_date as YYYY-MM-DD.");
  if (world.sourcesOff.has("workouts")) return ok({ status: "off", message: "The person turned off Hevy reading for chat in Settings.", workouts: [] });
  if (world.id === "new_user") return ok({ status: "not_connected", message: "Hevy is not connected.", workouts: [] });
  return ok({ status: "ok", workouts: world.workouts.filter((item) => item.localDate >= range.start && item.localDate <= range.end)
    .map((item) => ({ title: item.title, local_date: item.localDate, start_time: item.start, duration_minutes: item.minutes, exercise_count: item.exercises })) });
}

function searchAdvice(world: ChatWorld, args: unknown): ChatToolResult {
  const query = isRecord(args) && typeof args.query === "string" ? args.query.toLowerCase() : "";
  if (!query.trim()) return fail("invalid_input", "Send a query.");
  const words = query.split(/\W+/).filter((word) => word.length > 2);
  const cards = world.adviceCards.filter((card) => card.topics.some((topic) => words.some((word) => word.startsWith(topic) || topic.startsWith(word))));
  return ok({ cards: cards.map(({ topics: _topics, ...card }) => card) });
}

/** Ids for records made during a run, distinct from the world's own ids. */
function newId(world: ChatWorld): string {
  const used = world.behaviors.length + world.dayNotes.size + world.occurrences.length;
  return `00000000-0000-4000-9000-${String(used).padStart(12, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
