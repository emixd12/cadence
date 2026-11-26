import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlongsideRowView } from "@cadence/core/resolvers/alongside.resolver";
import { parseAlongsideGuessesResponse } from "@cadence/core/services/alongside-facts";
import {
  alongsideReadDue, alongsideSurfacesOn, alongsideSwitchOn, alongsideWhereGuessMap, createDesktopAlongsideGuessClient, desktopAlongsideContext,
  reportAlongsideContext,
} from "../apps/desktop/src/alongside";
import { loadLocalTimeline } from "../apps/desktop/src/local-timeline.service";
import { createLocalOccurrenceActions } from "../apps/desktop/src/local-actions";
import { createDesktopDailyBriefClient } from "../apps/desktop/src/daily-brief";
import { stored } from "./helpers/behavior-graph-fixture";

// Ticket 363 (D33): alongside on Cadence for Mac.
const mocks = vi.hoisted(() => ({ command: vi.fn(), fresh: vi.fn(), attach: vi.fn() }));
vi.mock("../apps/desktop/src/local-store", () => ({
  localCommand: mocks.command,
  localMutation: (profileId: string, now: string) => ({ profileId, now, mutationId: "mutation" }),
}));
vi.mock("../apps/desktop/src/local-generation.service", async (original) => ({
  ...await original<typeof import("../apps/desktop/src/local-generation.service")>(),
  ensureLocalOccurrencesFresh: mocks.fresh,
}));
vi.mock("@cadence/core/services/timeline-alongside", async (original) => {
  const actual = await original<typeof import("@cadence/core/services/timeline-alongside")>();
  return { attachTimelineAlongside: (...args: Parameters<typeof actual.attachTimelineAlongside>) => { mocks.attach(...args); return actual.attachTimelineAlongside(...args); } };
});

const NOW = Temporal.Instant.from("2026-11-25T16:00:00Z");
const { category: _category, schedules, schedule_slots: slots, ...storedBehavior } = stored;
void _category;
const graph = (id: string, extra: Record<string, unknown>) => ({
  behavior: { ...storedBehavior, id, ...extra },
  schedules: schedules!.map(({ schedule_slots: _slots, ...schedule }) => { void _slots; return { ...schedule, behavior_id: id }; }),
  slots: slots.map((slot) => ({ ...slot, behavior_id: id })),
  revision: 1,
});
const label = (behaviorId: string, day: number) => ({ id: `${behaviorId}-${day}`, user_id: "owner", behavior_id: behaviorId,
  local_date: `2026-11-${String(day).padStart(2, "0")}`, label: "home", rule_version: "1", recorded_at: "2026-11-01T00:00:00Z" });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.command.mockImplementation(async (operation: string) => {
    if (operation === "readProfile") return { id: "owner", timezone: "America/New_York" };
    if (operation === "readBehaviorGraphs") return [graph("helmet", { title: "Red light helmet", alongside: true }), graph("pill", { title: "Pill", alongside: null })];
    if (operation === "readCategories" || operation === "readOccurrences" || operation === "readDayNotes") return [];
    if (operation === "readOccurrenceHistory") return { statusEvents: [], timeSessions: [] };
    if (operation === "readPlaceLabels") return { settings: null, markers: [], dismissals: [],
      labels: [18, 19, 20, 21, 22, 23, 24].map((day) => label("helmet", day)) };
    throw new Error(operation);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the Mac's alongside gates", () => {
  it("is off unless the build sets the switch", () => {
    expect(alongsideSwitchOn(undefined)).toBe(false);
    expect(alongsideSwitchOn("")).toBe(false);
    expect(alongsideSwitchOn("true")).toBe(false);
    expect(alongsideSwitchOn("1")).toBe(true);
  });

  it("shows nothing without the switch, and follows the server once a linked Mac has read it", () => {
    const guesses = new Map([["pill", { alongside: true, whereGuess: "home" as const }]]);
    expect(desktopAlongsideContext({ switchOn: false, accountId: "a", read: { accountId: "a", enabled: true, guesses } })).toBeNull();
    // Local mode: no guesses at all.
    expect(desktopAlongsideContext({ switchOn: true, accountId: null, read: { accountId: "a", enabled: true, guesses } })?.guesses.size).toBe(0);
    // Linked, not read yet (offline at launch): the switch decides and no guesses apply.
    expect(desktopAlongsideContext({ switchOn: true, accountId: "a", read: null })?.guesses.size).toBe(0);
    expect(desktopAlongsideContext({ switchOn: true, accountId: "a", read: { accountId: "b", enabled: true, guesses } })?.guesses.size).toBe(0);
    // The server's flag is off: no alongside surface for this account.
    expect(desktopAlongsideContext({ switchOn: true, accountId: "a", read: { accountId: "a", enabled: false, guesses: new Map() } })).toBeNull();
    const linked = desktopAlongsideContext({ switchOn: true, accountId: "a", read: { accountId: "a", enabled: true, guesses } });
    expect(linked?.guesses).toBe(guesses);
    expect(alongsideWhereGuessMap(linked)).toEqual(new Map([["pill", "home"]]));
    expect(alongsideWhereGuessMap(null)).toBeNull();
  });
});

describe("the Mac's alongside read timing and data gates (audit fix 9)", () => {
  const due = (extra: Partial<Parameters<typeof alongsideReadDue>[0]>) => alongsideReadDue({
    nowMs: 100_000, lastReadMs: 90_000, readAccountId: "a", accountId: "a", syncCompletedAt: "s1", lastReadSyncCompletedAt: "s1", ...extra,
  });

  it("a new synchronization reads again inside the minute; nothing new waits a minute", () => {
    expect(due({})).toBe(false);
    expect(due({ syncCompletedAt: "s2" })).toBe(true);
    expect(due({ syncCompletedAt: null })).toBe(false);
    expect(due({ nowMs: 150_000 })).toBe(true);
    expect(due({ readAccountId: "b" })).toBe(true);
    expect(due({ readAccountId: null })).toBe(true);
  });

  it("export, import and restore follow the server's answer like the screens", () => {
    expect(alongsideSurfacesOn(false)).toBe(false);
    reportAlongsideContext({ guesses: new Map() });
    expect(alongsideSurfacesOn(true)).toBe(true);
    // A linked Mac whose server says enabled: false.
    reportAlongsideContext(desktopAlongsideContext({ switchOn: true, accountId: "a", read: { accountId: "a", enabled: false, guesses: new Map() } }));
    expect(alongsideSurfacesOn(true)).toBe(false);
    reportAlongsideContext(desktopAlongsideContext({ switchOn: true, accountId: null, read: null }));
    expect(alongsideSurfacesOn(true)).toBe(true);
  });
});

describe("the hosted guesses read", () => {
  it("reads the account's guesses over the broker and keeps nothing it cannot check", async () => {
    const request = vi.fn().mockResolvedValueOnce({ enabled: true, guesses: [{ behaviorId: "pill", alongside: true, whereGuess: null }] })
      .mockResolvedValueOnce({ enabled: true, guesses: [{ behaviorId: "pill", alongside: "yes", whereGuess: null }] })
      .mockRejectedValueOnce(new Error("offline"));
    const client = createDesktopAlongsideGuessClient(null, { request })!;
    expect(await client.read("a")).toEqual({ accountId: "a", enabled: true, guesses: new Map([["pill", { alongside: true, whereGuess: null }]]) });
    expect(request).toHaveBeenCalledWith("/api/behaviors/alongside");
    expect(await client.read("a")).toBeNull();
    expect(await client.read("a")).toBeNull();
    expect(createDesktopAlongsideGuessClient(null, null)).toBeNull();
  });

  it("drops guesses from a response whose flag is off", () => {
    expect(parseAlongsideGuessesResponse({ enabled: false, guesses: [{ behaviorId: "pill", alongside: true, whereGuess: null }] }))
      .toEqual({ enabled: false, guesses: [] });
    expect(parseAlongsideGuessesResponse({ enabled: true, guesses: [{ behaviorId: "pill", alongside: null, whereGuess: "somewhere" }] })).toBeNull();
    expect(parseAlongsideGuessesResponse(null)).toBeNull();
  });
});

describe("the local Timeline's alongside rows", () => {
  it("reads no place labels and attaches nothing while no alongside surface shows", async () => {
    const result = await loadLocalTimeline(7, NOW, null);
    expect(result.alongsideViews).toBeNull();
    expect(mocks.command).not.toHaveBeenCalledWith("readPlaceLabels", expect.anything());
    expect(mocks.attach).not.toHaveBeenCalled();
  });

  it("labels the person's answer with local Where evidence and asks nothing in local mode", async () => {
    const result = await loadLocalTimeline(7, NOW, { guesses: new Map() });
    expect(result.alongsideViews).toEqual({
      helmet: { answer: "yes", guess: null, questionOpen: false },
      pill: { answer: "unanswered", guess: null, questionOpen: false },
    });
    const [, rows, questions] = mocks.attach.mock.calls[0]! as [unknown, Record<string, AlongsideRowView>, ReadonlySet<string>];
    expect(rows).toEqual({ helmet: { source: "person", where: { kind: "home" } } });
    expect([...questions]).toEqual([]);
  });

  it("uses a linked Mac's guesses: a guessed row label and the open question", async () => {
    const result = await loadLocalTimeline(7, NOW, { guesses: new Map([["pill", { alongside: true, whereGuess: "anywhere" as const }]]) });
    expect(result.alongsideViews?.pill).toEqual({ answer: "unanswered", guess: true, questionOpen: true });
    const [, rows, questions] = mocks.attach.mock.calls[0]! as [unknown, Record<string, AlongsideRowView>, ReadonlySet<string>];
    expect(rows.pill).toEqual({ source: "guess", where: { kind: "anywhere" } });
    expect([...questions]).toEqual(["pill"]);
  });
});

describe("the Timeline row question on the Mac", () => {
  it("is offered only with the alongside switch, and writes the answer through the local store", async () => {
    expect(createLocalOccurrenceActions("owner", () => undefined).markDetailActions.alongside).toBeUndefined();
    const refresh = vi.fn();
    const answer = createLocalOccurrenceActions("owner", refresh, { alongside: true }).markDetailActions.alongside!;
    let written: { graph: { behavior: { alongside: boolean | null } }; configurationEvent: { changed_fields: string[]; reason_code: string } } | null = null;
    mocks.command.mockImplementation(async (operation: string, input: never) => {
      if (operation === "readBehaviorGraphs") return [graph("pill", { title: "Pill", alongside: null })];
      if (operation === "readCategories") return [];
      if (operation === "updateBehaviorGraph") { written = input; return { ...(input as { graph: object }).graph, revision: 2 }; }
      throw new Error(operation);
    });
    expect(await answer({ occurrenceId: "o1", behaviorId: "pill", alongside: true })).toEqual({ status: "saved" });
    expect(written!.graph.behavior.alongside).toBe(true);
    expect(written!.configurationEvent).toMatchObject({ changed_fields: ["alongside"], reason_code: "alongside_answered" });
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("the Mac's Daily Brief alongside question", () => {
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "synthetic-session" } } }) } } as unknown as SupabaseClient;

  it("asks for the line only with the switch, and answers on the hosted route with the Mac's session", async () => {
    expect(createDesktopDailyBriefClient(client, "https://cadence.invalid")!.alongside).toBeUndefined();
    const onWrite = vi.fn();
    const adapter = createDesktopDailyBriefClient(client, "https://cadence.invalid", null, onWrite, { alongside: true })!;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ behaviorId: "pill", alongside: false, changed: true }));
    vi.stubGlobal("fetch", fetcher);
    expect(await adapter.alongside!.answer({ behaviorId: "pill", alongside: false })).toEqual({ behaviorId: "pill", alongside: false, changed: true });
    expect(fetcher.mock.calls[0]![0]).toBe("https://cadence.invalid/api/advisor/brief/alongside");
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "POST", body: JSON.stringify({ behaviorId: "pill", alongside: false }),
      headers: expect.objectContaining({ Authorization: "Bearer synthetic-session" }) });
    // The answer changed a hosted Behavior: the Mac pulls it through account sync.
    expect(onWrite).toHaveBeenCalledOnce();
  });
});
