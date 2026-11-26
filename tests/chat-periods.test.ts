import { beforeEach, describe, expect, it, vi } from "vitest";
import { periodsOverlappingRange, type PeriodRecord } from "@cadence/core/resolvers/period.resolver";

/**
 * Ticket 370: Periods in Chat. Chat reads Periods and does not write them yet (the
 * writes are the follow-up on branch feat/370-chat-period-writes). The executor under test is the live one, running the
 * real MCP read and write handlers over an in-memory account, so what reaches the
 * model is what production serializes. Only the database and its neighbors are faked.
 */

const mocks = vi.hoisted(() => ({ periods: vi.fn(), period: vi.fn(), today: vi.fn(), activity: vi.fn(), begin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/services/oauth/server", () => ({
  consumeAgentRateLimit: async () => ({ allowed: true }), consumeMcpRateLimit: async () => ({ allowed: true }),
}));
vi.mock("@/lib/db/integration.repo", () => ({
  recordIntegrationActivity: mocks.activity, beginIdempotentWrite: mocks.begin, completeIdempotentWrite: vi.fn(),
  releaseIdempotentWrite: vi.fn(), listExternalReferences: async () => new Map(), findExternalReference: vi.fn(), linkExternalReference: vi.fn(),
}));
vi.mock("@/lib/services/period.service", () => ({ listPeriodsForUser: mocks.periods, periodTodayForUser: mocks.today }));
vi.mock("@/lib/db/periods.repo", () => ({ getPeriod: mocks.period }));
vi.mock("@/lib/db/dayNotes.repo", () => ({ listDayNotesInRange: async () => [], listAllDayNotes: async () => [] }));
vi.mock("@/lib/db/integration-read.repo", () => ({
  readIntegrationOccurrences: async () => [], readIntegrationCategories: async () => [], readIntegrationDayNote: async () => null,
}));
vi.mock("@/lib/services/occurrence-sync-state.service", () => ({ readOccurrenceSyncState: async () => null }));
vi.mock("@/lib/services/behavior.service", async (original) => ({
  ...await original<typeof import("@/lib/services/behavior.service")>(),
  getBehaviorReadDataForUser: async () => ({ behaviors: [], profileTimezone: "America/New_York" }),
}));
vi.mock("@/lib/services/occurrence.service", async (original) => ({
  ...await original<typeof import("@/lib/services/occurrence.service")>(), ensureUserOccurrencesFresh: async () => ({ synced: true }),
}));

import {
  CHAT_CONFIRM_WRITES, CHAT_IMMEDIATE_WRITES, CHAT_OUTCOME_KIND, CHAT_TOOL_SUBJECT, buildChatToolDefinitions, chatToolLineText, isChatWrite,
  type ChatSourceFlags,
} from "@/lib/services/chat/chat-tools";
import { createLiveChatExecutor } from "@/lib/services/chat/chat-executor";
import { compactTimeline } from "@/lib/services/chat/chat.service";
import type { ChatToolExecutor, ChatToolResult } from "@/lib/services/chat/chat-writes";
import type { IntegrationContext } from "@/lib/integrations/request-context";

const NOTES_ON: ChatSourceFlags = { notes: true, googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false };
const NOTES_OFF: ChatSourceFlags = { ...NOTES_ON, notes: false };
const USER = "00000000-1111-4111-8111-000000000001";
const SICK = "00000000-1111-4111-8111-000000000070";
const TODAY = "2026-11-19";
/** Text that exists only in a Period note. It must never reach the model with Notes off. */
const SECRET = "migraine with aura";

let periods: PeriodRecord[];
let clock: number;
let rpcCalls: Array<Record<string, unknown>>;

const instant = (value: string) => value.replace("+00:00", "Z");
const tick = () => `2026-11-19T15:00:${String(++clock).padStart(2, "0")}+00:00`;

/** What `integration_apply_period_write` does, over the in-memory rows. */
async function rpc(name: string, args: Record<string, unknown>) {
  if (name !== "integration_apply_period_write") return { data: null, error: { message: `unexpected rpc ${name}` } };
  rpcCalls.push(args);
  const fields = { label: args.p_label as string, start_on: args.p_start_on as string, end_on: args.p_end_on as string | null, note: args.p_note as string | null };
  let row: PeriodRecord;
  let changed = true;
  if (args.p_operation === "create_period") {
    row = { id: `00000000-1111-4111-8111-${String(periods.length + 100).padStart(12, "0")}`, user_id: USER, ...fields, revision: 1, created_at: tick(), updated_at: tick() };
    periods.push(row);
  } else {
    const current = periods.find((item) => item.id === args.p_period_id);
    if (!current) return { data: null, error: { message: "integration_not_found" } };
    if (instant(current.updated_at) !== args.p_expected_revision) return { data: null, error: { message: "integration_conflict" } };
    changed = JSON.stringify([current.label, current.start_on, current.end_on, current.note]) !== JSON.stringify(Object.values(fields));
    row = changed ? Object.assign(current, fields, { revision: current.revision + 1, updated_at: tick() }) : current;
  }
  const period = { id: row.id, label: row.label, start_local_date: row.start_on, end_local_date: row.end_on, ongoing: row.end_on === null, note: row.note,
    revision: instant(row.updated_at), updated_at: instant(row.updated_at) };
  return { data: { receipt: { version: 2, output_json: JSON.stringify(args.p_operation === "create_period" ? { period } : { period, changed }) } }, error: null };
}

const context = {
  supabase: { rpc }, userId: USER, now: new Date("2026-11-19T15:00:00Z"), tokenExpiresAt: new Date("2026-11-19T15:05:00Z"),
  actor: { channel: "chat", clientId: "cadence-chat", clientLabel: "Chat", grantId: "00000000-1111-4111-8111-000000000002",
    grantedScopes: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"] },
} as unknown as IntegrationContext;

/** The live executor, recording every result chat received. */
function liveExecutor(sources: ChatSourceFlags) {
  const run = createLiveChatExecutor({ context, sources, reads: {} as never, today: () => TODAY, timezone: "America/New_York" });
  const results: Array<{ name: string; args: Readonly<Record<string, unknown>>; result: ChatToolResult }> = [];
  const executor: ChatToolExecutor = async (name, args, options) => {
    const result = await run(name, args, options);
    results.push({ name, args, result });
    return result;
  };
  return { executor, results };
}

beforeEach(() => {
  vi.clearAllMocks();
  clock = 0;
  rpcCalls = [];
  periods = [{ id: SICK, user_id: USER, label: "Sick", start_on: "2026-11-17", end_on: null, note: SECRET,
    revision: 1, created_at: "2026-11-17T09:00:00+00:00", updated_at: "2026-11-17T09:00:00+00:00" }];
  mocks.periods.mockImplementation(async (_client, _user, range?: { from: string; to: string }) =>
    range ? periodsOverlappingRange(periods, range.from, range.to) : [...periods]);
  mocks.period.mockImplementation(async (_client, _user, id) => periods.find((row) => row.id === id) ?? null);
  mocks.today.mockResolvedValue(TODAY);
  mocks.begin.mockResolvedValue({ state: "started" });
});

describe("Period tools in Chat (Ticket 370)", () => {
  const WRITES = ["create_period", "update_period", "end_period"] as const;

  it("offers list_periods and none of the three Period writes, whatever the Notes setting", () => {
    for (const sources of [NOTES_ON, NOTES_OFF]) {
      const names = buildChatToolDefinitions(sources).map((tool) => tool.name as string);
      expect(names).toContain("list_periods");
      for (const name of ["get_account_context", "get_timeline", "get_adherence_summary", "search", "fetch"]) expect(names).toContain(name);
      for (const name of [...WRITES, "delete_period", "remove_period"]) expect(names).not.toContain(name);
    }
    // The note tools still go with Notes off; list_periods is not one of them.
    expect(buildChatToolDefinitions(NOTES_OFF).map((tool) => tool.name as string)).not.toContain("list_day_notes");
    expect(CHAT_TOOL_SUBJECT.list_periods).toBe("periods");
    expect(chatToolLineText("periods", "done")).toBe("Looked at your periods");
  });

  it("has no write path for a Period: not a chat write, no outcome kind, and the executor refuses a call", async () => {
    for (const name of WRITES) {
      expect(isChatWrite(name)).toBe(false);
      expect([...CHAT_IMMEDIATE_WRITES, ...CHAT_CONFIRM_WRITES] as readonly string[]).not.toContain(name);
      expect(CHAT_OUTCOME_KIND).not.toHaveProperty(name);
    }
    expect(Object.values(CHAT_OUTCOME_KIND)).not.toContain("period");
    for (const sources of [NOTES_ON, NOTES_OFF]) {
      const live = liveExecutor(sources);
      expect(await live.executor("create_period", { label: "Travel", start_local_date: "2026-11-20" }, { idempotencyKey: "chat:c1:0" }))
        .toEqual({ ok: false, error: { code: "not_found", message: "No tool named create_period." } });
      expect(await live.executor("update_period", { period_id: SICK, expected_revision: "2026-11-17T09:00:00Z", label: "Flu" }, { idempotencyKey: "chat:c1:1" }))
        .toMatchObject({ ok: false, error: { code: "not_found" } });
      expect(await live.executor("end_period", { period_id: SICK, expected_revision: "2026-11-17T09:00:00Z" }, { idempotencyKey: "chat:c1:2" }))
        .toMatchObject({ ok: false, error: { code: "not_found" } });
    }
    expect(rpcCalls).toEqual([]);
    expect(periods).toEqual([expect.objectContaining({ id: SICK, label: "Sick", end_on: null, note: SECRET })]);
  });
});

describe("a Period note with Notes off (Ticket 370)", () => {
  const leaked = (value: unknown) => JSON.stringify(value).includes(SECRET);
  const noteKeys = (value: unknown): number => Array.isArray(value) ? value.reduce((sum: number, item) => sum + noteKeys(item), 0)
    : value && typeof value === "object" ? Object.entries(value).reduce((sum, [key, child]) => sum + (key === "note" ? 1 : 0) + noteKeys(child), 0) : 0;

  it("list_periods returns labels and dates, never the note", async () => {
    const off = liveExecutor(NOTES_OFF);
    const read = await off.executor("list_periods", { start_local_date: "2026-11-01", end_local_date: "2026-11-30" }, { idempotencyKey: null });
    expect(read).toMatchObject({ ok: true, result: { periods: [{ id: SICK, label: "Sick", start_local_date: "2026-11-17", end_local_date: null, ongoing: true, revision: "2026-11-17T09:00:00Z" }] } });
    expect(leaked(read)).toBe(false);
    expect(noteKeys(read)).toBe(0);
    // With Notes on the same read carries it: the difference is the setting, not the data.
    const on = await liveExecutor(NOTES_ON).executor("list_periods", { start_local_date: "2026-11-01", end_local_date: "2026-11-30" }, { idempotencyKey: null });
    expect(on).toMatchObject({ ok: true, result: { periods: [{ note: SECRET }] } });
  });

  it("search finds nothing for text that appears only in a Period note", async () => {
    const off = liveExecutor(NOTES_OFF);
    expect(await off.executor("search", { query: "aura" }, { idempotencyKey: null })).toEqual({ ok: true, result: { results: [] } });
    expect(await off.executor("search", { query: SECRET }, { idempotencyKey: null })).toEqual({ ok: true, result: { results: [] } });
    // The label still matches, and the result carries no note.
    const byLabel = await off.executor("search", { query: "sick" }, { idempotencyKey: null });
    expect(byLabel).toMatchObject({ ok: true, result: { results: [{ id: `period:${SICK}`, title: "Period: Sick (from 2026-11-17, ongoing)" }] } });
    expect(leaked(byLabel)).toBe(false);
    // Search is label-only whatever the setting.
    expect(await liveExecutor(NOTES_ON).executor("search", { query: "aura" }, { idempotencyKey: null })).toEqual({ ok: true, result: { results: [] } });
  });

  it("fetch of a Period returns its label and dates with no note text", async () => {
    for (const sources of [NOTES_OFF, NOTES_ON]) {
      const fetched = await liveExecutor(sources).executor("fetch", { id: `period:${SICK}` }, { idempotencyKey: null });
      expect(fetched).toMatchObject({ ok: true, result: { title: "Period: Sick (from 2026-11-17, ongoing)", metadata: { kind: "period" } } });
      expect(leaked(fetched)).toBe(false);
      if (fetched.ok) expect(Object.keys(JSON.parse((fetched.result as { text: string }).text))).toEqual(["id", "label", "start_local_date", "end_local_date", "ongoing", "revision", "updated_at"]);
    }
  });

  it("the embedded Period lists carry no note in either setting", async () => {
    for (const sources of [NOTES_OFF, NOTES_ON]) {
      const live = liveExecutor(sources);
      for (const [name, args] of [["get_account_context", {}], ["get_timeline", {}],
        ["get_adherence_summary", { start_local_date: "2026-11-01", end_local_date: "2026-11-30" }]] as const) {
        const read = await live.executor(name, args, { idempotencyKey: null });
        expect(read.ok, name).toBe(true);
        expect(JSON.stringify(read), name).toContain("\"Sick\"");
        expect(leaked(read), name).toBe(false);
      }
    }
  });
});

describe("the first-turn Timeline (Ticket 370)", () => {
  it("carries the day's Periods only when there are any", () => {
    const day = { local_date: TODAY, is_today: true, day_note: null, occurrences: [], periods: [], more_periods: false };
    expect(compactTimeline({ timezone: "America/New_York", today_local_date: TODAY, days: [day], needs_decision: null })).not.toHaveProperty("periods");
    const summary = { id: SICK, label: "Sick", start_local_date: "2026-11-17", end_local_date: null, ongoing: true };
    expect(compactTimeline({ timezone: "America/New_York", today_local_date: TODAY, days: [{ ...day, periods: [summary] }], needs_decision: null }))
      .toMatchObject({ periods: [summary] });
  });
});
