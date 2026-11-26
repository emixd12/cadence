import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BriefMoveDayItem } from "@cadence/core/resolvers/brief-move.resolver";
import type { EffectiveWhere } from "@cadence/core/resolvers/effective-where.resolver";

// Ticket 361 (D33): Chat can propose a pairing and, on the person's Yes, apply the same
// ordinary move. With CADENCE_ALONGSIDE off the tool is neither offered nor run.

const mocks = vi.hoisted(() => ({ readDay: vi.fn() }));
vi.mock("@/lib/services/brief-move-day.service", async (original) => ({
  ...(await original<typeof import("@/lib/services/brief-move-day.service")>()),
  readBriefMoveDay: mocks.readDay,
}));
vi.mock("@/lib/services/model-armor.service", () => ({
  screenExternalCalendarTextWithModelArmor: async ({ text }: { text: string }) => ({ text, blocked: false }),
}));

import { buildChatToolDefinitions, CHAT_PAIRING_TOOL, CHAT_TOOL_SUBJECT, isChatWrite } from "@/lib/services/chat/chat-tools";
import { createLiveChatExecutor } from "@/lib/services/chat/chat-executor";
import { planChatPairings } from "@/lib/services/alongside-pairing.service";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { CHAT_ALONGSIDE_PAIRING_RULE } from "@/lib/services/chat/chat-prompt";

const TZ = "America/New_York";
const DAY = "2026-11-25";
const local = (time: string) => Temporal.PlainDateTime.from(`${DAY}T${time}`).toZonedDateTime(TZ).toInstant();
const HOME: EffectiveWhere = { kind: "home", source: "person" };
const ALL_ON = { notes: true, googleCalendar: true, outlookCalendar: true, icloudCalendar: true, hevy: true };

function item(id: string, start: string, minutes: number, extra: Partial<BriefMoveDayItem> = {}): BriefMoveDayItem {
  const begin = local(start);
  return {
    occurrenceId: id, behaviorId: `b-${id}`, title: id, status: "unresolved", localDate: DAY, scheduleKind: "exact",
    start: begin, end: begin.add({ minutes }), length: { minutes, source: "behavior_duration", assumed: false },
    alongside: false, alongsideSource: "default", where: HOME, revision: `rev-${id}`, behaviorRevision: `brev-${id}`, ...extra,
  };
}
const DAY_ITEMS = [item("helmet", "14:00", 10, { alongside: true, alongsideSource: "guess", title: "Red light helmet" }), item("reading", "20:00", 45, { title: "Reading" })];
const day = (items: readonly BriefMoveDayItem[], neverMove: readonly string[] = []) => ({ items, behaviors: new Map(), occurrences: new Map(),
  neverMoveBehaviorIds: new Set(neverMove), staleEstimateBehaviorIds: new Set() });
const noEvidence = async () => ({ doneTogether: [], crowdedHours: [] });

beforeEach(() => { vi.resetAllMocks(); mocks.readDay.mockResolvedValue(day(DAY_ITEMS)); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("Chat's pairing tool", () => {
  it("is offered only with CADENCE_ALONGSIDE on, last, as a read", () => {
    const off = buildChatToolDefinitions(ALL_ON).map((tool) => tool.name);
    expect(off).not.toContain(CHAT_PAIRING_TOOL);
    expect(buildChatToolDefinitions(ALL_ON, { alongside: false }).map((tool) => tool.name)).toEqual(off);
    const on = buildChatToolDefinitions(ALL_ON, { alongside: true }).map((tool) => tool.name);
    expect(on).toEqual([...off, CHAT_PAIRING_TOOL]);
    expect(isChatWrite(CHAT_PAIRING_TOOL)).toBe(false);
    expect(CHAT_TOOL_SUBJECT[CHAT_PAIRING_TOOL]).toBe("timeline");
    expect(CHAT_ALONGSIDE_PAIRING_RULE).toMatch(/move_occurrence_for_day/);
  });

  it("plans only pairings that help, unless the person asked about one item", async () => {
    const base = { supabase: {} as never, userId: "u", localDate: DAY, timezone: TZ, now: local("08:00"), calendarBusy: [], readEvidence: noEvidence };
    expect(await planChatPairings(base)).toEqual({ pairings: [] });
    const asked = await planChatPairings({ ...base, occurrenceId: "helmet" });
    expect(asked.pairings).toEqual([{
      occurrence_id: "helmet", title: "Red light helmet", expected_revision: "rev-helmet", current_start_at: local("14:00").toString(),
      start_at: local("20:00").toString(), start_time: "20:00",
      host: { occurrence_id: "reading", title: "Reading", start_at: local("20:00").toString() }, helps: [],
    }]);
    // "Don't suggest moving this" stops Chat's own suggestions, not one the person asked for.
    mocks.readDay.mockResolvedValue(day(DAY_ITEMS, ["b-helmet"]));
    const evidence = async () => ({ doneTogether: [{ behaviorId: "b-helmet", otherBehaviorId: "b-reading" }], crowdedHours: [] });
    expect(await planChatPairings({ ...base, readEvidence: evidence })).toEqual({ pairings: [] });
    expect((await planChatPairings({ ...base, readEvidence: evidence, occurrenceId: "helmet" })).pairings).toHaveLength(1);
  });

  it("runs from the executor only with the flag on, checking today's calendar", async () => {
    const calendarEvents = vi.fn(async () => ({ events: [], sources: [] }));
    const executor = createLiveChatExecutor({
      context: { userId: "u", supabase: {}, now: new Date(local("08:00").epochMilliseconds) } as unknown as IntegrationContext,
      sources: ALL_ON, reads: { calendarEvents, workouts: async () => ({ workouts: [], sources: [] }) } as never,
      today: () => DAY, timezone: TZ,
    });
    expect(await executor(CHAT_PAIRING_TOOL, { occurrence_id: "helmet" }, { idempotencyKey: null })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(calendarEvents).not.toHaveBeenCalled();
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    const result = await executor(CHAT_PAIRING_TOOL, { occurrence_id: "helmet" }, { idempotencyKey: null });
    expect(result).toMatchObject({ ok: true, result: { pairings: [{ occurrence_id: "helmet", start_time: "20:00", host: { title: "Reading" } }] } });
    expect(calendarEvents).toHaveBeenCalledWith(DAY, DAY);
  });
});
