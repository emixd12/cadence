// D33 configuration history on the real write path (Tickets 363 and 364, defect D1 of the
// 2026-11-26 local acceptance). The shared Behavior service builds each plan, the web
// repository builds each RPC payload, and the local database's own functions store the
// events. Reads go through account sync contracts 9, 10 and the current one.
//
// It needs a local database with every migration applied and runs only when
// CADENCE_LOCAL_DB_CONTAINER names its Docker container, for example:
//   CADENCE_LOCAL_DB_CONTAINER=supabase_db_habit-tracking-app npm run test -- tests/alongside-history.local-integration.test.ts
// Each run uses a fresh account and removes it afterwards.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppSupabaseClient } from "../lib/db/behaviors.repo";
import {
  createBehaviorWithAtomicScheduleGraph,
  updateBehaviorWithAtomicScheduleGraph,
} from "../lib/db/behaviorDefinitionEvents.repo";
import type { BehaviorDataStore, BehaviorGraphRecord, BehaviorInput } from "../packages/core/src/behavior-store";
import {
  answerBehaviorAlongsideQuestion, createBehavior, updateBehavior,
} from "../packages/core/src/services/behavior.service";

const container = process.env.CADENCE_LOCAL_DB_CONTAINER;
const suite = container ? describe : describe.skip;

type StoredEvent = {
  behavior_id: string;
  event_kind: string;
  changed_fields: string[];
  previous_configuration: Record<string, unknown> | null;
  next_configuration: Record<string, unknown>;
  reason_code: string;
};

function psql(sql: string): string {
  return execFileSync("docker", ["exec", "-i", container!, "psql", "-U", "postgres", "-At", "-q", "-v", "ON_ERROR_STOP=1"], {
    input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function literal(value: string): string {
  return `$cadence_literal$${value}$cadence_literal$`;
}

function asUser(userId: string, query: string): unknown {
  const output = psql(`begin;
set local role authenticated;
select set_config('request.jwt.claims', ${literal(JSON.stringify({ sub: userId, role: "authenticated" }))}, true);
select set_config('request.jwt.claim.sub', ${literal(userId)}, true);
\\o /dev/null
select 1;
\\o
select coalesce((${query})::text, 'null');
commit;`);
  const lines = output.split("\n").filter((line) => line.length > 0);
  return JSON.parse(lines.at(-1)!);
}

const argumentTypes = new Map<string, Map<string, string>>();

function rpcArgumentTypes(name: string): Map<string, string> {
  const known = argumentTypes.get(name);
  if (known) return known;
  const row = psql(`select jsonb_object_agg(arg.name, format_type(arg.type, null))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
  unnest(p.proargnames, p.proargtypes::oid[]) as arg(name, type)
where n.nspname = 'public' and p.proname = ${literal(name)};`);
  const types = new Map(Object.entries(JSON.parse(row) as Record<string, string>));
  argumentTypes.set(name, types);
  return types;
}

/** Just enough of a Supabase client for the two Behavior graph RPCs, as one user. */
function rpcClient(userId: string): AppSupabaseClient {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      const types = rpcArgumentTypes(name);
      const list = Object.entries(args).map(([key, value]) => {
        const type = types.get(key);
        if (!type) throw new Error(`Unknown argument ${key} for ${name}.`);
        const text = value === null || value === undefined ? "null"
          : type === "jsonb" ? literal(JSON.stringify(value)) : literal(String(value));
        return `${key} => ${text}::${type}`;
      });
      try {
        return { data: asUser(userId, `select to_jsonb(public.${name}(${list.join(", ")}))`), error: null };
      } catch (error) {
        const message = error instanceof Error && "stderr" in error ? String((error as { stderr: unknown }).stderr) : String(error);
        return { data: null, error: new Error(message) };
      }
    },
  } as unknown as AppSupabaseClient;
}

function readBehavior(userId: string, behaviorId: string): BehaviorGraphRecord | null {
  return asUser(userId, `select to_jsonb(b) || jsonb_build_object(
  'category', null,
  'schedules', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('schedule_slots', coalesce((
      select jsonb_agg(to_jsonb(slot) order by slot.sort_order) from public.behavior_schedule_slots slot
      where slot.behavior_schedule_id = s.id), '[]'::jsonb)) order by s.sort_order)
    from public.behavior_schedules s where s.behavior_id = b.id), '[]'::jsonb),
  'schedule_slots', coalesce((select jsonb_agg(to_jsonb(slot) order by slot.sort_order)
    from public.behavior_schedule_slots slot where slot.behavior_id = b.id), '[]'::jsonb))
from public.behaviors b where b.id = ${literal(behaviorId)}::uuid`) as BehaviorGraphRecord | null;
}

function store(userId: string): BehaviorDataStore {
  const client = rpcClient(userId);
  return {
    getBehaviorById: async (id) => readBehavior(userId, id),
    createBehaviorWithAtomicScheduleGraph: (input) => createBehaviorWithAtomicScheduleGraph(client, input),
    updateBehaviorWithAtomicScheduleGraph: (input) => updateBehaviorWithAtomicScheduleGraph(client, input),
  };
}

function events(userId: string, behaviorId: string): StoredEvent[] {
  return (asUser(userId, `select coalesce(jsonb_agg(jsonb_build_object(
    'behavior_id', behavior_id, 'event_kind', event_kind, 'changed_fields', to_jsonb(changed_fields),
    'previous_configuration', previous_configuration, 'next_configuration', next_configuration,
    'reason_code', reason_code) order by recorded_at, created_at), '[]'::jsonb)
  from public.behavior_configuration_events where behavior_id = ${literal(behaviorId)}::uuid`) as StoredEvent[]);
}

function syncEntities(userId: string, contract: number, kind: string): Array<{ id: string; value: Record<string, unknown> }> {
  return asUser(userId, `select coalesce(jsonb_agg(entity), '[]'::jsonb)
  from jsonb_array_elements(public.read_account_sync_snapshot(${contract}) -> 'entities') entity
  where entity ->> 'kind' = ${literal(kind)}`) as Array<{ id: string; value: Record<string, unknown> }>;
}

function mentionsAlongside(event: { changed_fields: string[]; previous_configuration: unknown; next_configuration: unknown }) {
  return event.changed_fields.includes("alongside")
    || JSON.stringify(event.previous_configuration ?? {}).includes("\"alongside\"")
    || JSON.stringify(event.next_configuration).includes("\"alongside\"");
}

const baseValues: BehaviorInput = {
  title: "History check", description: null, categoryId: null,
  recurrenceRule: { frequency: "daily", interval: 1 }, scheduledTime: "09:00",
  browserReminderEnabled: true, emailReminderEnabled: false, reminderOffsetMinutes: 0, active: true,
  schedules: [{
    recurrenceRule: { frequency: "daily", interval: 1 }, sortOrder: 0,
    timeEntries: [{ kind: "exact", preset: null, startTime: "09:00", endTime: null, sortOrder: 0 }],
  }],
};

suite("alongside configuration history on the local database", () => {
  const userId = randomUUID();
  let clock = Date.parse("2026-11-25T15:00:00.000Z");
  const tick = () => new Date((clock += 60_000)).toISOString();

  beforeAll(() => {
    psql(`insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values (${literal(userId)}::uuid, 'authenticated', 'authenticated', ${literal(`history-${userId}@example.invalid`)}, '{}', '{}');`);
  });

  afterAll(() => {
    psql(`delete from auth.users where id = ${literal(userId)}::uuid;`);
  });

  async function create(values: BehaviorInput) {
    return createBehavior(store(userId), { values, userId, timezone: "America/New_York", recordedAt: tick() });
  }

  async function edit(behavior: BehaviorGraphRecord, values: BehaviorInput) {
    const current = readBehavior(userId, behavior.id)!;
    const schedules = current.schedules!.map((schedule) => ({
      id: schedule.id, recurrenceRule: schedule.recurrence_rule as BehaviorInput["recurrenceRule"], sortOrder: schedule.sort_order,
      timeEntries: schedule.schedule_slots.map((slot) => ({
        id: slot.id, kind: slot.kind as "exact", preset: null, startTime: slot.start_time.slice(0, 5),
        endTime: slot.end_time, sortOrder: slot.sort_order,
      })),
    }));
    await updateBehavior(store(userId), {
      behaviorId: behavior.id, expectedUpdatedAt: current.updated_at, recordedAt: tick(),
      newArchiveNoteId: randomUUID(), values: { ...values, schedules },
    });
  }

  it("flag off: creating and editing leaves no trace of alongside", async () => {
    const behavior = await create({ ...baseValues, title: "Flag off" });
    await edit(behavior, { ...baseValues, title: "Flag off", reminderOffsetMinutes: 15 });
    const stored = events(userId, behavior.id);
    expect(stored.map((event) => event.event_kind)).toEqual(["baseline", "revision"]);
    expect(stored[1]!.changed_fields).toEqual(["reminder_offset_minutes"]);
    expect(stored.filter(mentionsAlongside)).toEqual([]);
  });

  it("flag on with no answer: creating and editing leaves no trace of alongside", async () => {
    const behavior = await create({ ...baseValues, title: "Flag on unanswered", alongside: null });
    await edit(behavior, { ...baseValues, title: "Flag on unanswered", reminderOffsetMinutes: 60, alongside: null });
    const stored = events(userId, behavior.id);
    expect(stored.map((event) => event.event_kind)).toEqual(["baseline", "revision"]);
    expect(stored[1]!.changed_fields).toEqual(["reminder_offset_minutes"]);
    expect(stored.filter(mentionsAlongside)).toEqual([]);
  });

  it("an answer change writes exactly one event naming alongside, with differing snapshots", async () => {
    const behavior = await create({ ...baseValues, title: "Answered later", alongside: null });
    await answerBehaviorAlongsideQuestion(store(userId), { behaviorId: behavior.id, alongside: true, recordedAt: tick() });
    // An edit that keeps the answer names other fields only, and carries the answer.
    await edit(behavior, { ...baseValues, title: "Answered later", reminderOffsetMinutes: 15, alongside: true });
    await edit(behavior, { ...baseValues, title: "Answered later", reminderOffsetMinutes: 15, alongside: false });
    await edit(behavior, { ...baseValues, title: "Answered later", reminderOffsetMinutes: 15, alongside: null });
    const stored = events(userId, behavior.id);
    expect(stored.map((event) => [event.event_kind, event.changed_fields, event.reason_code])).toEqual([
      ["baseline", expect.not.arrayContaining(["alongside"]), "behavior_created"],
      ["revision", ["alongside"], "alongside_answered"],
      ["revision", ["reminder_offset_minutes"], "behavior_edited"],
      ["revision", ["alongside"], "behavior_edited"],
      ["revision", ["alongside"], "behavior_edited"],
    ]);
    expect(mentionsAlongside(stored[0]!)).toBe(false);
    expect([stored[1]!.previous_configuration!.alongside, stored[1]!.next_configuration.alongside]).toEqual([null, true]);
    expect([stored[2]!.previous_configuration!.alongside, stored[2]!.next_configuration.alongside]).toEqual([true, true]);
    expect([stored[3]!.previous_configuration!.alongside, stored[3]!.next_configuration.alongside]).toEqual([true, false]);
    expect([stored[4]!.previous_configuration!.alongside, stored[4]!.next_configuration.alongside]).toEqual([false, null]);
  });

  it("a Behavior created with an answer names it in its baseline", async () => {
    const behavior = await create({ ...baseValues, title: "Answered at create", alongside: true });
    const [baseline] = events(userId, behavior.id);
    expect(baseline!.changed_fields).toContain("alongside");
    expect(baseline!.next_configuration.alongside).toBe(true);
  });

  it("account sync contract 9 never sees alongside in a configuration event", () => {
    const legacy = syncEntities(userId, 9, "configuration_event");
    const current = syncEntities(userId, 10, "configuration_event");
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy.filter((entity) => mentionsAlongside({
      changed_fields: entity.value.changed_fields as string[],
      previous_configuration: entity.value.previous_configuration,
      next_configuration: entity.value.next_configuration,
    }))).toEqual([]);
    expect(current.some((entity) => (entity.value.changed_fields as string[]).includes("alongside"))).toBe(true);
  });
});
