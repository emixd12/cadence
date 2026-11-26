import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import type { ChatEvent } from "@cadence/core/types/chat";
import { periodsOverlappingRange, type PeriodRecord } from "@cadence/core/resolvers/period.resolver";

/**
 * Ticket 370: Periods in Chat. The executor under test is the live one, running the
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

import { agentModelSetting } from "@/lib/services/agent-model";
import { buildChatSystemPrompt } from "@/lib/services/chat/chat-prompt";
import {
  CHAT_CONFIRM_WRITES, CHAT_IMMEDIATE_WRITES, CHAT_OUTCOME_KIND, CHAT_TOOL_SUBJECT, buildChatToolDefinitions, chatToolLineText, isImmediateWrite,
  type ChatSourceFlags,
} from "@/lib/services/chat/chat-tools";
import { runChatTurn } from "@/lib/services/chat/chat-turn";
import { runChatConfirm } from "@/lib/services/chat/chat-confirm";
import { createLiveChatExecutor } from "@/lib/services/chat/chat-executor";
import { compactTimeline } from "@/lib/services/chat/chat.service";
import { describeOutcome, describePendingWrite, undoPlanFor, type ChatToolExecutor, type ChatToolResult } from "@/lib/services/chat/chat-writes";
import type { IntegrationContext } from "@/lib/integrations/request-context";

const NOTES_ON: ChatSourceFlags = { notes: true, googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false };
const NOTES_OFF: ChatSourceFlags = { ...NOTES_ON, notes: false };
const USER = "00000000-1111-4111-8111-000000000001";
const SICK = "00000000-1111-4111-8111-000000000070";
const TODAY = "2026-11-19";
/** Text that exists only in a Period note. It must never reach the model with Notes off. */
const SECRET = "migraine with aura";
const usage = { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 50, text: 50, reasoning: 0 } };

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

type Step = { text?: string; calls?: Array<{ name: string; input: Record<string, unknown> }> };
function scriptedModel(steps: Step[], seen: unknown[] = []) {
  let index = 0, callId = 0;
  return new MockLanguageModelV4({
    doStream: async (options) => {
      seen.push(options.prompt);
      let step = steps[Math.min(index++, steps.length - 1)]!;
      if (options.toolChoice?.type === "none") step = { text: step.text ?? "" };
      const chunks: unknown[] = [{ type: "stream-start", warnings: [] }];
      if (step.text) chunks.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: step.text }, { type: "text-end", id: "t" });
      for (const call of step.calls ?? []) {
        chunks.push({ type: "tool-input-start", id: `call-${callId}`, toolName: call.name }, { type: "tool-input-end", id: `call-${callId}` });
        chunks.push({ type: "tool-call", toolCallId: `call-${callId++}`, toolName: call.name, input: JSON.stringify(call.input) });
      }
      chunks.push({ type: "finish", usage, finishReason: { unified: step.calls?.length ? "tool-calls" : "stop", raw: undefined } });
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  });
}

async function turn(steps: Step[], sources: ChatSourceFlags) {
  const live = liveExecutor(sources);
  const events: ChatEvent[] = [];
  const prompts: unknown[] = [];
  let id = 0;
  const result = await runChatTurn({
    setting: agentModelSetting("chat"), model: scriptedModel(steps, prompts),
    instructions: buildChatSystemPrompt({ timezone: "America/New_York", today: TODAY, localTime: "10:00", weekday: "Thursday", sourcesOff: [] }),
    tools: buildChatToolDefinitions(sources), history: [], userMessage: "hi", executor: live.executor, replyId: "reply-1",
    signal: AbortSignal.timeout(5_000), onEvent: (event) => events.push(event), newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  });
  return { result, events, live, prompts };
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
  it("offers the Period tools from the registry, and never runs a Period write without a Yes", () => {
    const names = buildChatToolDefinitions(NOTES_ON).map((tool) => tool.name);
    for (const name of ["list_periods", "create_period", "update_period", "end_period"]) expect(names).toContain(name);
    expect(names).not.toContain("delete_period");
    expect(names).not.toContain("remove_period");
    for (const name of ["create_period", "update_period", "end_period"] as const) {
      expect(CHAT_CONFIRM_WRITES).toContain(name);
      expect(CHAT_IMMEDIATE_WRITES as readonly string[]).not.toContain(name);
      expect(isImmediateWrite(name)).toBe(false);
      expect(CHAT_OUTCOME_KIND[name]).toBe("period");
    }
    expect(CHAT_TOOL_SUBJECT.list_periods).toBe("periods");
    expect(chatToolLineText("periods", "done")).toBe("Looked at your periods");
  });

  it("keeps the Period tools with Notes off, without a note to send", () => {
    const tools = new Map(buildChatToolDefinitions(NOTES_OFF).map((tool) => [tool.name, tool]));
    // A label is not a note: Period tools stay. The note tools go, as before.
    for (const name of ["list_periods", "create_period", "update_period", "end_period", "search", "fetch"]) expect(tools.has(name as never)).toBe(true);
    for (const name of ["list_day_notes", "update_day_note", "update_occurrence_note"]) expect(tools.has(name as never)).toBe(false);
    for (const name of ["create_period", "update_period"] as const) {
      expect(Object.keys(tools.get(name)!.inputSchema.properties as object)).not.toContain("note");
      expect(Object.keys(new Map(buildChatToolDefinitions(NOTES_ON).map((tool) => [tool.name, tool])).get(name)!.inputSchema.properties as object)).toContain("note");
    }
  });

  it("describes each write in Cadence's words, naming a note without quoting it", () => {
    const sick = { id: SICK, label: "Sick", start_local_date: "2026-11-17", end_local_date: null, ongoing: true, revision: "r1" };
    expect(describePendingWrite({ name: "create_period", args: { label: "Sick", start_local_date: "2026-11-17", end_local_date: "2026-11-20", note: SECRET } }, {}))
      .toBe("Add the period \"Sick\" from Tue Nov 17 to Fri Nov 20, with a note");
    expect(describePendingWrite({ name: "create_period", args: { label: "Travel", start_local_date: "2026-11-19" } }, {}))
      .toBe("Add the period \"Travel\" from Thu Nov 19, with no last day");
    expect(describePendingWrite({ name: "create_period", args: { label: "Off", start_local_date: "2026-11-19", end_local_date: "2026-11-19" } }, {}))
      .toBe("Add the period \"Off\" on Thu Nov 19");
    expect(describePendingWrite({ name: "update_period", args: { period_id: SICK, label: "Flu", end_local_date: "2026-11-21", note: SECRET } }, { period: sick }))
      .toBe("Change the period \"Sick\": label \"Flu\", last day Sat Nov 21, a new note");
    expect(describePendingWrite({ name: "update_period", args: { period_id: SICK, end_local_date: null, note: null } }, { period: sick }))
      .toBe("Change the period \"Sick\": no last day, no note");
    expect(describePendingWrite({ name: "end_period", args: { period_id: SICK } }, { period: sick })).toBe("End the period \"Sick\" today");
    expect(describePendingWrite({ name: "end_period", args: { period_id: SICK } }, {})).toBe("End this period today");
    const ended = { period: { ...sick, end_local_date: TODAY, ongoing: false, note: SECRET }, changed: true };
    expect(describeOutcome({ name: "end_period", args: { period_id: SICK } }, ended, { period: sick })).toBe("Ended the period \"Sick\" today.");
    expect(describeOutcome({ name: "update_period", args: { period_id: SICK, label: "Flu" } }, { period: { ...sick, label: "Flu" }, changed: true }, { period: sick }))
      .toBe("Changed the period \"Flu\".");
    expect(describeOutcome({ name: "update_period", args: { period_id: SICK, label: "Sick" } }, { period: sick, changed: false }, { period: sick }))
      .toBe("The period \"Sick\" already had those details.");
    expect(describeOutcome({ name: "create_period", args: { label: "Sick", start_local_date: "2026-11-17", note: SECRET } }, { period: { ...sick, note: SECRET } }, {}))
      .toBe("Added the period \"Sick\" from Tue Nov 17, with no last day.");
  });

  it("offers no Undo for any Period write", () => {
    const period = { id: SICK, label: "Sick", start_local_date: "2026-11-17", end_local_date: TODAY, ongoing: false, note: null, revision: "r2" };
    const facts = { period: { id: SICK, label: "Sick", start_local_date: "2026-11-17", end_local_date: null, revision: "r1" } };
    expect(undoPlanFor({ name: "create_period", args: { label: "Sick", start_local_date: "2026-11-17" } }, { period }, {})).toBeNull();
    expect(undoPlanFor({ name: "update_period", args: { period_id: SICK, label: "Flu" } }, { period, changed: true }, facts)).toBeNull();
    expect(undoPlanFor({ name: "end_period", args: { period_id: SICK } }, { period, changed: true }, facts)).toBeNull();
  });

  it("asks before creating a Period even as the first write, then writes it on Yes with no Undo", async () => {
    const { result, live } = await turn([
      { calls: [{ name: "create_period", input: { label: "Travel", start_local_date: "2026-11-20", end_local_date: "2026-11-23", note: "Lisbon trip" } }] },
      { text: "Shall I add it?" },
    ], NOTES_ON);
    expect(rpcCalls).toEqual([]);
    expect(result.writes).toEqual([]);
    expect(result.pending?.confirm.items).toEqual([{ kind: "period", text: "Add the period \"Travel\" from Fri Nov 20 to Mon Nov 23, with a note" }]);
    expect(JSON.stringify(result.pending?.confirm)).not.toContain("Lisbon");
    const run = await runChatConfirm({ confirmId: "c1", writes: result.pending!.writes, executor: live.executor });
    expect(run.state).toBe("accepted");
    expect(run.refusals).toEqual([]);
    expect(run.writes).toHaveLength(1);
    expect(run.writes[0]!.outcome).toMatchObject({ kind: "period", confirmed: true, undo: "unavailable", text: "Added the period \"Travel\" from Fri Nov 20 to Mon Nov 23." });
    expect(run.writes[0]!.undo).toBeNull();
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({ p_operation: "create_period", p_key: "chat:c1:0", p_label: "Travel", p_note: "Lisbon trip" });
    expect(periods).toHaveLength(2);
  });

  it("ends a Period on Yes, reading its label and revision first, and expires the Yes when it changed", async () => {
    const steps: Step[] = [{ calls: [{ name: "end_period", input: { period_id: SICK, expected_revision: "2026-11-17T09:00:00Z" } }] }, { text: "End it?" }];
    const first = await turn(steps, NOTES_ON);
    expect(first.result.pending?.confirm.items).toEqual([{ kind: "period", text: "End the period \"Sick\" today" }]);
    expect(first.result.pending!.writes[0]!.guard).toEqual({ kind: "period", id: SICK, revision: "2026-11-17T09:00:00Z" });
    // The person edits the Period in the app before answering: the Yes does nothing.
    periods[0] = { ...periods[0]!, label: "Flu", updated_at: "2026-11-19T14:59:00+00:00" };
    expect(await runChatConfirm({ confirmId: "c1", writes: first.result.pending!.writes, executor: first.live.executor })).toEqual({ state: "expired", writes: [], refusals: [] });
    expect(rpcCalls).toEqual([]);

    const second = await turn([{ calls: [{ name: "end_period", input: { period_id: SICK, expected_revision: "2026-11-19T14:59:00Z" } }] }, { text: "End it?" }], NOTES_ON);
    const run = await runChatConfirm({ confirmId: "c2", writes: second.result.pending!.writes, executor: second.live.executor });
    expect(run.writes[0]!.outcome).toMatchObject({ kind: "period", undo: "unavailable", text: "Ended the period \"Flu\" today." });
    expect(rpcCalls[0]).toMatchObject({ p_operation: "end_period", p_period_id: SICK, p_end_on: TODAY, p_label: "Flu", p_note: SECRET });
    expect(periods[0]!.end_on).toBe(TODAY);
  });

  it("shows a refusal when a rule stops the write after a Yes", async () => {
    periods[0] = { ...periods[0]!, end_on: "2026-11-18" };
    const { result, live } = await turn([{ calls: [{ name: "end_period", input: { period_id: SICK, expected_revision: "2026-11-17T09:00:00Z" } }] }, { text: "End it?" }], NOTES_ON);
    const run = await runChatConfirm({ confirmId: "c1", writes: result.pending!.writes, executor: live.executor });
    expect(run.writes).toEqual([]);
    expect(run.refusals).toEqual([expect.objectContaining({ kind: "period", reason: "invalid_state" })]);
    expect(rpcCalls).toEqual([]);
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

  it("a confirmed write shows, sends and returns no note", async () => {
    // The model sends a note although the tool offered none. It is dropped before anything is described or stored.
    const { result, live, prompts } = await turn([
      { calls: [{ name: "update_period", input: { period_id: SICK, expected_revision: "2026-11-17T09:00:00Z", label: "Flu", note: "model-written note" } }] },
      { text: "Change it?" },
    ], NOTES_OFF);
    expect(result.pending?.confirm.items).toEqual([{ kind: "period", text: "Change the period \"Sick\": label \"Flu\"" }]);
    expect(result.pending!.writes[0]!.call.args).not.toHaveProperty("note");
    expect(JSON.stringify(result.pending)).not.toContain("model-written note");
    expect(leaked(result)).toBe(false);

    const run = await runChatConfirm({ confirmId: "c1", writes: result.pending!.writes, executor: live.executor });
    expect(run.state).toBe("accepted");
    expect(run.writes[0]!.outcome).toMatchObject({ kind: "period", undo: "unavailable", text: "Changed the period \"Flu\"." });
    // The stored note is kept, not cleared and not replaced: chat sent none.
    expect(rpcCalls).toEqual([expect.objectContaining({ p_operation: "update_period", p_label: "Flu", p_note: SECRET })]);
    expect(periods[0]).toMatchObject({ label: "Flu", note: SECRET });
    // Nothing chat received, stored or showed holds the note: not the facts read, not the write result.
    expect(leaked(live.results)).toBe(false);
    expect(noteKeys(live.results.map((entry) => entry.result))).toBe(0);
    expect(leaked(run)).toBe(false);
    expect(leaked(prompts)).toBe(false);
    const written = live.results.find((entry) => entry.name === "update_period")!;
    expect(written.result).toMatchObject({ ok: true, result: { changed: true, period: { id: SICK, label: "Flu" } } });
  });

  it("creates a Period without the note the model tried to add", async () => {
    const { result, live } = await turn([
      { calls: [{ name: "create_period", input: { label: "Travel", start_local_date: "2026-11-20", note: "model-written note" } }] }, { text: "Add it?" },
    ], NOTES_OFF);
    expect(result.pending?.confirm.items).toEqual([{ kind: "period", text: "Add the period \"Travel\" from Fri Nov 20, with no last day" }]);
    await runChatConfirm({ confirmId: "c1", writes: result.pending!.writes, executor: live.executor });
    expect(rpcCalls).toEqual([expect.objectContaining({ p_operation: "create_period", p_label: "Travel", p_note: null })]);
    expect(JSON.stringify(live.results)).not.toContain("model-written note");
  });

  it("answers that Notes are off when an edit names only the note, and asks for nothing", async () => {
    const { result, live } = await turn([
      { calls: [{ name: "update_period", input: { period_id: SICK, expected_revision: "2026-11-17T09:00:00Z", note: null } }] }, { text: "Notes are off." },
    ], NOTES_OFF);
    expect(result.pending).toBeNull();
    expect(live.results).toEqual([]);
    // The executor refuses the same call on its own, for a Yes that outlived the setting.
    expect(await live.executor("update_period", { period_id: SICK, expected_revision: "2026-11-17T09:00:00Z", note: null }, { idempotencyKey: "chat:late:0" }))
      .toEqual({ ok: false, error: { code: "source_off", message: "Notes are off in Settings." } });
    expect(rpcCalls).toEqual([]);
    expect(periods[0]!.note).toBe(SECRET);
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
