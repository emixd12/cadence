import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INTEGRATION_FORBIDDEN_OUTPUT_FIELD_FRAGMENTS, validateOperationOutput } from "@cadence/core/integration";
import { readOperationHandlers, type ReadOperationName } from "@/lib/integrations/operations/read";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import type { BehaviorWithCategory } from "@/lib/db/behaviors.repo";
import type { Occurrence } from "@/lib/types/database";

const mocks = vi.hoisted(() => ({
  account: vi.fn(), occurrences: vi.fn(), categories: vi.fn(), occurrence: vi.fn(),
  events: vi.fn(), sessions: vi.fn(), references: vi.fn(), fresh: vi.fn(), sync: vi.fn(),
}));
vi.mock("@/lib/services/behavior.service", () => ({ getBehaviorReadDataForUser: mocks.account }));
vi.mock("@/lib/services/occurrence.service", () => ({ ensureUserOccurrencesFresh: mocks.fresh }));
vi.mock("@/lib/services/occurrence-sync-state.service", () => ({ readOccurrenceSyncState: mocks.sync }));
vi.mock("@/lib/db/integration-read.repo", () => ({ readIntegrationOccurrences: mocks.occurrences, readIntegrationCategories: mocks.categories }));
vi.mock("@/lib/db/occurrences.repo", () => ({ getOccurrenceById: mocks.occurrence }));
vi.mock("@/lib/db/occurrenceStatusEvents.repo", () => ({ listOccurrenceStatusEventsByOccurrenceIds: mocks.events }));
vi.mock("@/lib/db/timeSessions.repo", () => ({ listTimeSessionsForOccurrence: mocks.sessions }));
vi.mock("@/lib/db/integration.repo", () => ({ listExternalReferences: mocks.references }));

const id = (n: number) => `00000000-1111-4111-8111-${n.toString().padStart(12, "0")}`;
const at = "2026-03-08T07:30:00Z";
const context: IntegrationContext = {
  supabase: {} as IntegrationContext["supabase"], userId: id(1), now: new Date(at),
  tokenExpiresAt: new Date("2026-03-08T07:35:00Z"),
  actor: { channel: "mcp", clientId: "test-client", clientLabel: "Test", grantId: id(2), grantedScopes: ["cadence.read"] },
};
function behavior(overrides: Partial<BehaviorWithCategory> = {}): BehaviorWithCategory {
  const slot = { id: id(12), user_id: id(1), behavior_id: id(10), behavior_schedule_id: id(11), kind: "exact", preset: null,
    start_time: "09:00:00", end_time: null, sort_order: 0, created_at: at, updated_at: at };
  return { id: id(10), user_id: id(1), category_id: id(20), category: { id: id(20), name: "Health" }, title: "Walk",
    description: "Outside", location_text: "Park", recurrence_rule: { frequency: "daily", interval: 1 },
    scheduled_time: "09:00:00", timezone: "America/New_York", browser_reminder_enabled: true,
    email_reminder_enabled: false, reminder_offset_minutes: 0, active: true, archived_at: null,
    auto_archived_at: null, end_date: null, default_duration_minutes: 20, archive_notes: [],
    current_configuration_event_id: id(13), created_at: at, updated_at: "2026-03-08T07:30:00.123456+00:00",
    schedule_slots: [slot], schedules: [{ id: id(11), user_id: id(1), behavior_id: id(10), recurrence_rule: { frequency: "daily", interval: 1 }, sort_order: 0,
      created_at: at, updated_at: at, schedule_slots: [slot] }], ...overrides };
}
function occurrence(n: number, overrides: Partial<Occurrence> = {}): Occurrence {
  return { id: id(n), user_id: id(1), behavior_id: id(10), behavior_configuration_event_id: id(13),
    behavior_schedule_slot_id: id(12), completed_at: null, created_at: at, local_date: "2026-03-08", note: "Fresh air",
    schedule_end_time: null, schedule_kind: "exact", schedule_preset: null, schedule_range_identity: null,
    schedule_start_time: "09:00:00", scheduled_for: "2026-03-08T13:00:00Z", status: "unresolved", status_marked_at: null, updated_at: at, ...overrides };
}
let behaviors: BehaviorWithCategory[];
let occurrences: Occurrence[];
const range = { start_local_date: "2026-03-01", end_local_date: "2026-03-10" };

beforeEach(() => {
  vi.clearAllMocks(); behaviors = [behavior()]; occurrences = [occurrence(30)];
  mocks.account.mockImplementation(async () => ({ behaviors, profileTimezone: "America/New_York" }));
  mocks.occurrences.mockImplementation(async (_client, _user, range) => occurrences.filter((row) => !range || (row.local_date >= range.startLocalDate && row.local_date <= range.endLocalDate)));
  mocks.occurrence.mockImplementation(async (_client, _user, id) => occurrences.find((row) => row.id === id) ?? null);
  mocks.categories.mockResolvedValue([{ id: id(20), user_id: id(1), name: "Health", description: null, sort_order: 1, created_at: at, updated_at: at }]);
  mocks.references.mockResolvedValue(new Map([[id(10), "external-walk"]]));
  mocks.events.mockResolvedValue([{ id: id(40), user_id: id(1), previous_status: null, status: "unresolved", status_semantics: "system_rule_declared",
    source_capture_method: "system_generated", recorded_at: at, effective_at: null, local_date: "2026-03-08", timezone: "America/New_York" }]);
  mocks.sessions.mockResolvedValue([{ id: id(50), user_id: id(1), started_at: "2026-03-08T07:00:00Z", stopped_at: "2026-03-08T07:10:00Z" }]);
  mocks.fresh.mockResolvedValue({ synced: true });
  mocks.sync.mockResolvedValue({ stale: false, timezone: "America/New_York", last_synced_local_date: "2026-03-08", synced_through_local_date: "2026-04-07" });
});

const inputs: Record<ReadOperationName, unknown> = {
  get_account_context: {}, list_behaviors: {}, get_behavior: { behavior_id: id(10) }, list_categories: {},
  get_timeline: {}, list_occurrences: range, get_occurrence: { occurrence_id: id(30) }, get_adherence_summary: range,
  search: { query: "air" }, fetch: { id: `occurrence:${id(30)}` },
};
function assertAllowed(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(assertAllowed); return; }
  if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
    for (const forbidden of INTEGRATION_FORBIDDEN_OUTPUT_FIELD_FRAGMENTS) expect(key).not.toContain(forbidden);
    assertAllowed(child);
  }
}

describe("integration read handlers", () => {
  for (const name of Object.keys(inputs) as ReadOperationName[]) {
    it(`${name} returns a contract-valid allowlisted result`, async () => {
      // Excluded nested data cannot pass through even if a repository accidentally returns it.
      Object.assign(behaviors[0], { email_address: "private@example.test", calendar_events: [{ title: "private" }], travel_settings: { latitude: 1 }, daily_brief: "private", import_run_id: id(90) });
      Object.assign(occurrences[0], { push_subscriptions: ["private"], access_token: "private" });
      const result = await readOperationHandlers[name](context, inputs[name]);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      expect(validateOperationOutput(name, result.value).ok).toBe(true);
      assertAllowed(result.value);
      if (name === "fetch") assertAllowed(JSON.parse((result.value as { text: string }).text));
      expect(JSON.stringify(result.value)).not.toContain("private");
      expect(JSON.stringify(result.value)).not.toContain(context.userId);
    });
    it(`${name} checks read scope before accessing data`, async () => {
      const result = await readOperationHandlers[name]({ ...context, actor: { ...context.actor, grantedScopes: ["cadence.behaviors.write"] } }, inputs[name]);
      expect(result).toMatchObject({ ok: false, error: { code: "insufficient_scope" } });
      expect(mocks.account).not.toHaveBeenCalled(); expect(mocks.categories).not.toHaveBeenCalled();
    });
  }

  it.each([
    ["2026-03-08T04:59:59Z", "2026-03-07", "23:59"],
    ["2026-03-08T05:00:00Z", "2026-03-08", "00:00"],
    ["2026-03-08T06:59:59Z", "2026-03-08", "01:59"],
    ["2026-03-08T07:00:00Z", "2026-03-08", "03:00"],
    ["2026-11-01T05:30:00Z", "2026-11-01", "01:30"],
    ["2026-11-01T06:30:00Z", "2026-11-01", "01:30"],
  ])("uses account midnight and DST for %s", async (instant, today, time) => {
    expect(await readOperationHandlers.get_account_context({ ...context, now: new Date(instant) }, {})).toMatchObject({ ok: true, value: { today_local_date: today, local_time: time } });
  });

  it("derives Needs decision and retains today's decisions like the web Timeline", async () => {
    occurrences = [occurrence(31, { local_date: "2026-03-07" }), occurrence(32, { local_date: "2026-03-06", status: "completed", status_marked_at: "2026-03-08T06:00:00Z" }), occurrence(33, { local_date: "2026-03-05", status: "completed", status_marked_at: "2026-03-07T06:00:00Z" }), occurrence(30)];
    const result = await readOperationHandlers.get_timeline(context, { start_local_date: "2026-03-07", days: 2 });
    expect(result).toMatchObject({ ok: true, value: { needs_decision: { occurrences: [
      { id: id(31), needs_decision: true }, { id: id(32), needs_decision: false },
    ], total_count: 2, truncated: false }, days: [{ local_date: "2026-03-07", is_today: false }, { local_date: "2026-03-08", is_today: true }] } });
  });

  it("keeps archived definitions and history readable but hides them from Timeline", async () => {
    behaviors[0].active = false; behaviors[0].archived_at = at;
    behaviors[0].archive_notes = [{ id: id(55), archived_at: at, note: "Season over", updated_at: at }];
    expect(await readOperationHandlers.get_behavior(context, inputs.get_behavior)).toMatchObject({ ok: true, value: { behavior: { state: "archived", revision: "2026-03-08T07:30:00.123456Z", external_ref: "external-walk" } } });
    expect(await readOperationHandlers.list_behaviors(context, { state: "active" })).toMatchObject({ ok: true, value: { behaviors: [] } });
    expect(await readOperationHandlers.list_occurrences(context, range)).toMatchObject({ ok: true, value: { occurrences: [{ id: id(30) }] } });
    expect(await readOperationHandlers.get_timeline(context, {})).toMatchObject({ ok: true, value: { days: [{ occurrences: [] }] } });
  });

  it("uses stable keyset pagination after a row disappears or an earlier row is inserted", async () => {
    occurrences = [occurrence(33), occurrence(31), occurrence(32)];
    const first = await readOperationHandlers.list_occurrences(context, { ...range, page_size: 1 });
    expect(first.ok).toBe(true); if (!first.ok) return;
    expect(first.value.occurrences.map((row) => row.id)).toEqual([id(31)]);
    occurrences = [occurrence(30), occurrence(33), occurrence(32)];
    const second = await readOperationHandlers.list_occurrences(context, { ...range, page_size: 2, cursor: first.value.next_cursor });
    expect(second).toMatchObject({ ok: true, value: { occurrences: [{ id: id(32) }, { id: id(33) }], next_cursor: null } });
    expect(await readOperationHandlers.list_occurrences(context, { ...range, statuses: ["completed"], cursor: first.value.next_cursor })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await readOperationHandlers.list_occurrences({ ...context, userId: id(99) }, { ...range, cursor: first.value.next_cursor })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("supports inclusive changed-since reads and intersecting filters", async () => {
    occurrences = [occurrence(30, { local_date: "2026-03-07" }), occurrence(31, { updated_at: "2026-03-07T00:00:00Z" }), occurrence(32, { status: "completed" })];
    expect(await readOperationHandlers.list_occurrences(context, { ...range, updated_since: at, needs_decision_only: true, statuses: ["unresolved"], behavior_ids: [id(10)] })).toMatchObject({ ok: true, value: { occurrences: [{ id: id(30) }] } });
  });

  it("applies the midnight Needs decision boundary to Occurrences", async () => {
    occurrences = [occurrence(30, { local_date: "2026-03-07" })];
    expect(await readOperationHandlers.get_occurrence({ ...context, now: new Date("2026-03-08T04:59:59Z") }, inputs.get_occurrence))
      .toMatchObject({ ok: true, value: { occurrence: { needs_decision: false } } });
    expect(await readOperationHandlers.get_occurrence({ ...context, now: new Date("2026-03-08T05:00:00Z") }, inputs.get_occurrence))
      .toMatchObject({ ok: true, value: { occurrence: { needs_decision: true } } });
  });

  it("paginates categories and Behaviors and rejects cross-operation cursors", async () => {
    behaviors = [behavior({ id: id(11) }), behavior({ id: id(10) })];
    const first = await readOperationHandlers.list_behaviors(context, { page_size: 1 });
    expect(first).toMatchObject({ ok: true, value: { behaviors: [{ id: id(10) }] } });
    if (!first.ok) return;
    expect(await readOperationHandlers.list_behaviors(context, { page_size: 1, cursor: first.value.next_cursor }))
      .toMatchObject({ ok: true, value: { behaviors: [{ id: id(11) }], next_cursor: null } });
    expect(await readOperationHandlers.list_categories(context, { cursor: first.value.next_cursor }))
      .toMatchObject({ ok: false, error: { code: "invalid_input" } });
    mocks.categories.mockResolvedValue([2, 1].map((n) => ({ id: id(20 + n), name: `Category ${n}`, description: null, sort_order: n, created_at: at, updated_at: at })));
    const categories = await readOperationHandlers.list_categories(context, { page_size: 1 });
    expect(categories).toMatchObject({ ok: true, value: { categories: [{ id: id(21) }] } });
    if (!categories.ok) return;
    expect(await readOperationHandlers.list_categories(context, { cursor: categories.value.next_cursor }))
      .toMatchObject({ ok: true, value: { categories: [{ id: id(22) }], next_cursor: null } });
  });

  it("runs only occurrence freshness maintenance and reports concurrent stale coverage honestly", async () => {
    mocks.sync.mockResolvedValue({ stale: true });
    const result = await readOperationHandlers.get_account_context(context, {});
    expect(result).toMatchObject({ ok: true, value: { freshness: { occurrences_generated_through: null } } });
    expect(mocks.fresh).toHaveBeenCalledWith(context.supabase, context.userId, {
      now: Temporal.Instant.from(at), timezone: "America/New_York", behaviors,
      horizonDays: 30, planReminderDeliveries: false,
    });
  });

  it("returns a stable account identity per client, independent of grant", async () => {
    const a = await readOperationHandlers.get_account_context(context, {});
    const b = await readOperationHandlers.get_account_context({ ...context, actor: { ...context.actor, grantId: id(99) } }, {});
    const c = await readOperationHandlers.get_account_context({ ...context, actor: { ...context.actor, clientId: "other" } }, {});
    expect(a).toEqual(b); expect(c).not.toEqual(a);
  });

  it("counts the selected range, including archived Behaviors, excluding Unresolved from adherence", async () => {
    behaviors[0].active = false;
    occurrences = [occurrence(30, { status: "completed" }), occurrence(31, { status: "not_completed" }), occurrence(32), occurrence(33, { local_date: "2026-03-07" })];
    const result = await readOperationHandlers.get_adherence_summary(context, range);
    expect(result).toMatchObject({ ok: true, value: { overall: { completed: 1, not_completed: 1, unresolved: 2, needs_decision: 1, adherence_rate: 0.5 }, behaviors: [{ state: "archived", adherence_rate: 0.5 }] } });
    occurrences = [occurrence(30)];
    expect(await readOperationHandlers.get_adherence_summary(context, range)).toMatchObject({ ok: true, value: { overall: { adherence_rate: null } } });
  });

  it("rejects invalid input and every result cap instead of truncating", async () => {
    expect(await readOperationHandlers.list_behaviors(context, { page_size: 101 })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await readOperationHandlers.get_timeline(context, { days: 15 })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await readOperationHandlers.list_occurrences(context, { start_local_date: "2026-01-01", end_local_date: "2026-12-31" })).toMatchObject({ ok: false, error: { code: "limit_exceeded" } });
    occurrences = Array.from({ length: 101 }, (_, i) => occurrence(100 + i, { local_date: "2026-03-07" }));
    expect(await readOperationHandlers.get_timeline(context, {})).toMatchObject({ ok: false, error: { code: "limit_exceeded" } });
    expect(await readOperationHandlers.search(context, { query: "air" })).toMatchObject({ ok: false, error: { code: "limit_exceeded" } });
    occurrences = [occurrence(30, { note: "x".repeat(100_000) })];
    expect(await readOperationHandlers.get_occurrence(context, inputs.get_occurrence)).toMatchObject({ ok: false, error: { code: "limit_exceeded" } });
  });

  it("keeps existing long notes unchanged and exposes full detail with seconds", async () => {
    occurrences[0].note = "n".repeat(3000);
    expect(await readOperationHandlers.get_occurrence(context, inputs.get_occurrence)).toMatchObject({ ok: true, value: { occurrence: { note: occurrences[0].note, status_history: [{ id: id(40) }], time_sessions: [{ duration_seconds: 600 }] } } });
  });

  it("returns not_found without exposing another account's record or error details", async () => {
    expect(await readOperationHandlers.get_behavior(context, { behavior_id: id(99) })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await readOperationHandlers.get_occurrence(context, { occurrence_id: id(99) })).toMatchObject({ ok: false, error: { code: "not_found" } });
    mocks.account.mockRejectedValue(new Error("secret database details"));
    expect(JSON.stringify(await readOperationHandlers.get_account_context(context, {}))).not.toContain("secret");
  });

  it("searches archive notes and fetches Behavior definitions as quoted data with absolute links", async () => {
    behaviors[0].archive_notes = [{ id: id(55), archived_at: at, note: "Winter rest", updated_at: at }];
    const search = await readOperationHandlers.search(context, { query: "Winter" });
    expect(search).toMatchObject({ ok: true, value: { results: [{ id: `behavior:${id(10)}`, url: `https://app.cadence-me.com/behaviors?behavior=${id(10)}` }] } });
    const fetched = await readOperationHandlers.fetch(context, { id: `behavior:${id(10)}` });
    expect(fetched.ok).toBe(true);
    if (fetched.ok) expect(JSON.parse(fetched.value.text)).toMatchObject({ title: "Walk", location_text: "Park", archive_notes: [{ note: "Winter rest" }] });
  });
});
