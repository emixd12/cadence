import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import fixture from "./fixtures/advisor-day-context.valid.json";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import { issueTravelConclusionsToken, travelConclusionsSourceKey, type TravelConclusionsPayload, type TravelConclusionsSecrets } from "@/lib/services/travel-conclusions-token";

const mocks = vi.hoisted(() => ({
  preferences: vi.fn(),
  ids: vi.fn(),
  revision: vi.fn(),
  timezone: vi.fn(),
  contexts: vi.fn(),
  opaque: vi.fn(),
  calendar: vi.fn(),
  analysis: vi.fn(),
  analysisRevision: vi.fn(),
  outlook: vi.fn(),
  connector: vi.fn(),
  travelSettings: vi.fn(),
  whereKinds: vi.fn(),
  labelSettings: vi.fn(),
  labels: vi.fn(),
  routeSource: vi.fn(),
  dayOccurrences: vi.fn(),
}));
vi.mock("@/lib/services/travel-settings.service", () => ({ readTravelRouteSource: mocks.routeSource }));
vi.mock("@/lib/db/occurrences.repo", () => ({ listOccurrencesBetweenLocalDates: mocks.dayOccurrences }));
vi.mock("@/lib/db/travelSettings.repo", () => ({ readTravelSettingsRow: mocks.travelSettings, readTravelBehaviorLocations: mocks.whereKinds }));
vi.mock("@/lib/db/placeLabels.repo", () => ({ readPlaceLabelSettingsRow: mocks.labelSettings, readCompletionPlaceLabelRows: mocks.labels }));
vi.mock("@/lib/services/outlook-calendar.service", () => ({ getOutlookCalendarConnection: mocks.outlook }));
vi.mock("@/lib/services/connector-credentials", () => ({ getConnectorConnection: mocks.connector }));
vi.mock("@/lib/db/advisor-analysis.repo", async (original) => ({
  ...await original<typeof import("@/lib/db/advisor-analysis.repo")>(),
  readAdvisorAnalysisSnapshot: mocks.analysis,
  readAdvisorAnalysisRevision: mocks.analysisRevision,
}));

vi.mock("@/lib/db/daily-brief.repo", () => ({
  readDailyBriefPreferences: mocks.preferences,
  listDailyBriefBehaviorIds: mocks.ids,
}));
vi.mock("@/lib/db/advisor-context.repo", () => ({
  readAdvisorCadenceRevision: mocks.revision,
  readAdvisorProfileTimezone: mocks.timezone,
}));
vi.mock("@/lib/services/advisor-day-context.service", () => ({
  readAdvisorDayContexts: mocks.contexts,
  createAdvisorOpaqueRef: mocks.opaque,
}));
vi.mock("@/lib/services/google-calendar.service", () => ({ getCalendarConnection: mocks.calendar }));

import {
  briefingAccountRef,
  prepareAccountBriefingContexts,
  workbenchBehaviorRef,
} from "@/lib/services/briefing-account-context.service";

const preferences = {
  includeReminderHistory: false,
  includeNotes: false,
  enabled: true,
  includeCalendar: false,
  revision: 3,
  calendarConnectionGeneration: null,
  calendarSelectionRevision: null,
  includeOutlookCalendar: false,
  outlookConnectionGeneration: null,
  outlookSelectionRevision: null,
  includeIcloudCalendar: false,
  icloudConnectionGeneration: null,
  icloudSelectionRevision: null,
  includeHevy: false,
  hevyConnectionGeneration: null,
};
const caller = { client: {}, user: { id: "owner-1" } } as CalendarCaller;
const signal = new AbortController().signal;
const now = () => Temporal.Instant.from("2026-11-01T12:00:01Z");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.preferences.mockResolvedValue(preferences);
  mocks.ids.mockResolvedValue(["behavior-1"]);
  mocks.revision.mockResolvedValue("raw-revision");
  mocks.timezone.mockResolvedValue(fixture.timezone);
  mocks.opaque.mockReturnValue((kind: string, value: string) => kind === "revision" ? (value === "raw-revision" ? "revision_cadence" : `revision_${value}`) : `${kind}_${value}`);
  mocks.contexts.mockImplementation(async ({ historyDays }) => historyDays.map((lookbackDays: number) => ({
    ...fixture,
    cadence: { ...fixture.cadence, history: { ...fixture.cadence.history, lookbackDays,
      startLocalDate: Temporal.PlainDate.from(fixture.localDate).subtract({ days: lookbackDays }).toString() } },
  })));
  mocks.travelSettings.mockResolvedValue(null);
  mocks.whereKinds.mockResolvedValue([]);
  mocks.labelSettings.mockResolvedValue(null);
  mocks.labels.mockResolvedValue([]);
  mocks.routeSource.mockResolvedValue(null);
  mocks.dayOccurrences.mockResolvedValue([]);
});

describe("stored travel facts (Ticket 219)", () => {
  const travelSettings = { enabled: true, routing_consent_at: "2026-10-01T00:00:00Z", mode: "transit", base_location_text: "1 Main Street",
    navigation_preference: null, onboarding_completed_at: null, updated_at: "2026-10-01T00:00:00Z" };

  it("adds Where and usual travel for authorized Behaviors in the context, without place text", async () => {
    mocks.ids.mockResolvedValue(["fixture", "other"]);
    mocks.travelSettings.mockResolvedValue(travelSettings);
    mocks.whereKinds.mockResolvedValue([{ id: "fixture", where_kind: "home" }, { id: "other", where_kind: "anywhere" }, { id: "foreign", where_kind: "place" }]);
    const prepared = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now });

    expect(prepared.contexts[0].travel).toEqual({
      version: "1.0", routing: "on", usualMode: "transit",
      behaviors: [{ behaviorRef: "behavior_fixture", where: "home" }],
      route: { state: "unavailable", reason: "not_supplied" },
      // Stage 2: default habits; weather needs supplied evidence, which this path never has.
      habits: { rulesVersion: "travel-habit-defaults@1", getReadyMinutes: 10, getReadySource: "default", placeModes: [] },
      weather: { source: "open_meteo", tableVersion: "weather-margin@1", state: "not_supplied", calendarEvents: false, trips: [] },
    });
    expect(JSON.stringify(prepared.contexts)).not.toContain("Main Street");
    await expect(prepared.assertCurrent()).resolves.toBeUndefined();

    mocks.whereKinds.mockResolvedValue([{ id: "fixture", where_kind: null }, { id: "other", where_kind: "anywhere" }]);
    await expect(prepared.assertCurrent()).rejects.toMatchObject({ code: "context_changed" });
  });

  it("adds learned habits and label counts by Behavior, never place text or keys (stage 2)", async () => {
    const homeKey = travelPlaceKey("1 Main Street"), gymKey = travelPlaceKey("2 Gym Road");
    mocks.ids.mockResolvedValue(["fixture", "gym"]);
    mocks.travelSettings.mockResolvedValue({ ...travelSettings, preparation_minutes: 20, arrival_buffer_minutes: null, leave_feedback: [],
      place_modes: [{ place_key: homeKey, mode: "walking", chosen_at: "2026-10-20T12:00:00.000000Z" }, { place_key: gymKey, mode: "driving", chosen_at: "2026-10-20T12:00:00.000000Z" }]
        .sort((left, right) => left.place_key < right.place_key ? -1 : 1),
      habits_updated_at: "2026-10-20T12:00:00.000000Z" });
    mocks.whereKinds.mockResolvedValue([{ id: "fixture", where_kind: "home", location_text: null }, { id: "gym", where_kind: "place", location_text: "2 Gym Road" }]);
    mocks.labelSettings.mockResolvedValue({ enabled: true, retention: "90_days" });
    const label = (day: number, value: string) => ({ id: `o${day}`, behavior_id: "fixture", local_date: Temporal.PlainDate.from(fixture.localDate).subtract({ days: day }).toString(),
      label: value, rule_version: "place-label-rules@1", recorded_at: "2026-10-20T12:00:00.000000Z" });
    mocks.labels.mockResolvedValue([...Array.from({ length: 9 }, (_, day) => label(day + 1, "home")), label(12, "elsewhere"), label(61, "elsewhere"),
      { ...label(2, "home"), id: "gym-o", behavior_id: "gym" }]);
    const prepared = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now });
    expect(prepared.contexts[0].travel).toMatchObject({
      habits: { getReadyMinutes: 20, getReadySource: "learned", placeModes: [{ behaviorRef: "behavior_fixture", mode: "walking" }] },
      // Only Behaviors in this context; the label older than the 60-day window is not counted.
      placeLabels: { rulesVersion: "where-suggestion-rules@1", periodDays: 60,
        behaviors: [{ behaviorRef: "behavior_fixture", total: 10, home: 9, wherePlace: 0, otherSavedPlace: 0, elsewhere: 1 }],
        // All kept history under 90-day retention also counts the 61-day-old label.
        retained: { retention: "90_days", behaviors: [{ behaviorRef: "behavior_fixture", total: 11, home: 9, wherePlace: 0, otherSavedPlace: 0, elsewhere: 2 }] } },
    });
    const serialized = JSON.stringify(prepared.contexts);
    for (const leaked of ["Main Street", "Gym Road", homeKey, gymKey, "saved_place"]) expect(serialized).not.toContain(leaked);
    await expect(prepared.assertCurrent()).resolves.toBeUndefined();
    // A new label or a habit change before delivery fences the brief.
    mocks.labels.mockResolvedValue([label(3, "elsewhere")]);
    await expect(prepared.assertCurrent()).rejects.toMatchObject({ code: "context_changed" });
    mocks.labelSettings.mockResolvedValue({ enabled: false, retention: "90_days" });
    mocks.labels.mockResolvedValue([]);
    const off = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now });
    expect(off.contexts[0].travel).not.toHaveProperty("placeLabels");
    // One read to prepare and one per fence check; labels that are off are never read.
    expect(mocks.labels).toHaveBeenCalledTimes(3);
  });

  it("reports routing off and location not set without a travel settings row", async () => {
    mocks.ids.mockResolvedValue(["fixture"]);
    mocks.whereKinds.mockResolvedValue([{ id: "fixture", where_kind: null }]);
    const prepared = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now });
    expect(prepared.contexts[0].travel).toEqual({
      version: "1.0", routing: "off", usualMode: null,
      behaviors: [{ behaviorRef: "behavior_fixture", where: "not_set" }],
      route: { state: "unavailable", reason: "routing_off" },
    });

    mocks.travelSettings.mockResolvedValue({ ...travelSettings, enabled: false });
    await expect(prepared.assertCurrent()).resolves.toBeUndefined();
    mocks.travelSettings.mockResolvedValue(travelSettings);
    await expect(prepared.assertCurrent()).rejects.toMatchObject({ code: "context_changed" });
  });
});

describe("signed travel conclusions (Ticket 219 Option A)", () => {
  const SECRET = "test-only-conclusions-secret-0123456789";
  const secrets = { current: SECRET, previous: null };
  const routing = { enabled: true, routing_consent_at: "2026-10-01T00:00:00Z", mode: "transit", base_location_text: "1 Main Street",
    navigation_preference: null, onboarding_completed_at: null, updated_at: "2026-10-01T00:00:00Z" };
  const routeSource = { settings: { enabled: true, mode: "transit", routingConsentAt: "2026-10-01T00:00:00.000000Z" },
    settingsRevision: "2026-10-01T00:00:00.000000Z", habitsRevision: null,
    behaviors: [{ id: "fixture", whereKind: "home", locationText: null, updatedAt: "2026-10-01T00:00:00.000000Z" }] };
  const calendar = { status: "connected", generation: 1, selectionRevision: 1 };
  const dayOccurrence = { id: "fixture", behavior_id: "fixture", scheduled_for: fixture.cadence.occurrences[0]!.scheduledFor, local_date: fixture.localDate,
    schedule_kind: "exact", schedule_end_time: null, status: "unresolved", updated_at: "2026-10-01T00:00:00Z" };
  const sourceKey = () => travelConclusionsSourceKey({ settingsRevision: routeSource.settingsRevision, habitsRevision: null, enabled: true, mode: "transit",
    routingConsentAt: routeSource.settings.routingConsentAt, calendar, behaviors: routeSource.behaviors, occurrences: [dayOccurrence] });
  const payload = (overrides: Partial<Omit<TravelConclusionsPayload, "v">> = {}): Omit<TravelConclusionsPayload, "v"> => ({
    sub: "owner-1", date: fixture.localDate, src: sourceKey(), iat: "2026-11-01T11:58:00Z", exp: "2026-11-01T12:03:00Z",
    conclusions: { version: "2.0", travelDay: "yes", calendarEvents: true,
      trips: [{ destinationRef: "event:fixture", role: "outbound", mode: "transit", estimate: "current" },
        { destinationRef: null, role: "return", mode: "transit", estimate: "current" }],
      fits: [{ ref: "occurrence:fixture", conclusion: "fits", basis: "travel_known", trip: { destinationRef: "event:fixture", role: "outbound" }, position: "after" }] },
    weather: { source: "open_meteo", tableVersion: "weather-margin@1", state: "applied", calendarEvents: true, trips: [
      { destinationRef: "event:fixture", role: "outbound", mode: "transit", state: "margin", conditions: ["rain"], marginMinutes: 10, suggestion: null }] },
    events: { "event:fixture": "event" },
    ...overrides,
  });
  const prepare = (token: unknown, tokenSecrets: { current: string | null; previous: string | null } = secrets, clock = now) =>
    prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock, travelConclusions: { token, secrets: tokenSecrets } });
  const notSupplied = { route: { state: "unavailable", reason: "not_supplied" },
    weather: { source: "open_meteo", tableVersion: "weather-margin@1", state: "not_supplied", calendarEvents: false, trips: [] } };

  beforeEach(() => {
    mocks.ids.mockResolvedValue(["fixture"]);
    mocks.travelSettings.mockResolvedValue(routing);
    mocks.whereKinds.mockResolvedValue([{ id: "fixture", where_kind: "home", location_text: null }]);
    mocks.routeSource.mockResolvedValue(routeSource);
    mocks.calendar.mockResolvedValue(calendar);
    mocks.dayOccurrences.mockResolvedValue([dayOccurrence]);
  });

  it("fills route and weather conclusions from a verified token, mapped to this context's refs", async () => {
    let at = now();
    const prepared = await prepare(issueTravelConclusionsToken(payload(), SECRET), secrets, () => at);
    expect(prepared.contexts[0]!.travel).toMatchObject({
      route: { state: "available", conclusions: { travelDay: "yes", calendarEvents: true,
        trips: [{ destinationRef: "event_fixture", role: "outbound" }, { destinationRef: null, role: "return" }],
        fits: [{ ref: "occurrence_fixture", conclusion: "fits", trip: { destinationRef: "event_fixture" } }] } },
      weather: { state: "applied", trips: [{ destinationRef: "event_fixture", marginMinutes: 10 }] },
    });
    expect(mocks.dayOccurrences).toHaveBeenCalledWith(caller.client, "owner-1", fixture.localDate, fixture.localDate);
    const serialized = JSON.stringify(prepared.contexts);
    for (const leaked of ["event:fixture", "occurrence:fixture", "Main Street"]) expect(serialized).not.toContain(leaked);
    // The delivery fence compares stored facts only: a token that expires during generation never fails the brief.
    at = Temporal.Instant.from("2026-11-01T12:03:30Z");
    await expect(prepared.assertCurrent()).resolves.toBeUndefined();
  });

  it("leaves route and weather not_supplied for every failed check, without failing the brief", async () => {
    const valid = issueTravelConclusionsToken(payload(), SECRET);
    const [body, signature] = valid.split(".") as [string, string];
    const cases: [string, unknown, (() => void)?, TravelConclusionsSecrets?][] = [
      ["tampered", `${Buffer.from(JSON.stringify({ v: 1, ...payload({ src: "other" }) })).toString("base64url")}.${signature}`],
      ["other user", issueTravelConclusionsToken(payload({ sub: "owner-2" }), SECRET)],
      ["other day", issueTravelConclusionsToken(payload({ date: "2026-10-31" }), SECRET)],
      ["expired", issueTravelConclusionsToken(payload({ exp: "2026-11-01T12:00:00Z" }), SECRET)],
      ["stale source", valid, () => mocks.dayOccurrences.mockResolvedValue([{ ...dayOccurrence, status: "completed" }])],
      ["changed settings", valid, () => mocks.routeSource.mockResolvedValue({ ...routeSource, settingsRevision: "2026-10-02T00:00:00.000000Z" })],
      ["malformed", `${body}.not-a-signature`],
      ["not a string", 7],
      ["secret not configured", valid, undefined, { current: null, previous: null }],
      ["changed Calendar event", issueTravelConclusionsToken(payload({ events: { "event:fixture": "older" } }), SECRET)],
      ["commitment outside this context", issueTravelConclusionsToken(payload({ conclusions: { ...payload().conclusions,
        fits: [{ ...payload().conclusions.fits[0]!, ref: "occurrence:other" }] } }), SECRET)],
      ["unknown ref kind", issueTravelConclusionsToken(payload({ conclusions: { ...payload().conclusions,
        trips: [{ destinationRef: "place:1 Main Street", role: "outbound", mode: "transit", estimate: "current" }] } }), SECRET)],
    ];
    for (const [label, token, arrange, tokenSecrets] of cases) {
      mocks.dayOccurrences.mockResolvedValue([dayOccurrence]);
      mocks.routeSource.mockResolvedValue(routeSource);
      arrange?.();
      const prepared = await prepare(token, tokenSecrets);
      expect(prepared.contexts[0]!.travel, label).toMatchObject(notSupplied);
    }
  });

  it("behaves exactly as before without a token, and never verifies while routing is off", async () => {
    const without = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now });
    const empty = await prepare(null);
    expect(empty.contexts[0]!.travel).toEqual(without.contexts[0]!.travel);
    expect(without.contexts[0]!.travel).toMatchObject(notSupplied);
    expect(mocks.routeSource).not.toHaveBeenCalled();
    mocks.travelSettings.mockResolvedValue({ ...routing, enabled: false });
    const off = await prepare(issueTravelConclusionsToken(payload(), SECRET));
    expect(off.contexts[0]!.travel?.route).toEqual({ state: "unavailable", reason: "routing_off" });
    expect(mocks.routeSource).not.toHaveBeenCalled();
  });
});

describe("account briefing context", () => {
  it("prepares one shared capture for two windows and maps stable handles to capture refs", async () => {
    const result = await prepareAccountBriefingContexts(caller, {
      historyDays: [90, 30], includeCalendar: false, signal, clock: now,
    });

    expect(result.contexts.map((context) => context.cadence.history.lookbackDays)).toEqual([90, 30]);
    expect(mocks.contexts).toHaveBeenCalledOnce();
    expect(mocks.contexts).toHaveBeenCalledWith(expect.objectContaining({
      historyDays: [90, 30],
      includeGoogleCalendar: false,
      signal,
    }));
    expect(result.configurationRefs).toEqual({
      [workbenchBehaviorRef("owner-1", "behavior-1")]: "behavior_behavior-1",
    });
    expect(result.preferences).toEqual(preferences);
    expect(briefingAccountRef("owner-1")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("uses a fresh opaque-reference key for every capture", async () => {
    await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now });
    await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now });
    const first = mocks.contexts.mock.calls[0][0].opaqueRefKey as Uint8Array;
    const second = mocks.contexts.mock.calls[1][0].opaqueRefKey as Uint8Array;
    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
  });

  it("requires enabled preferences and an active caller signal", async () => {
    mocks.preferences.mockResolvedValue({ ...preferences, enabled: false });
    await expect(prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now }))
      .rejects.toMatchObject({ code: "access_denied" });
    const controller = new AbortController();
    controller.abort();
    await expect(prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal: controller.signal, clock: now }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.contexts).not.toHaveBeenCalled();

    mocks.preferences.mockResolvedValue(preferences);
    const later = new AbortController();
    const prepared = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal: later.signal, clock: now });
    later.abort();
    await expect(prepared.assertCurrent()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reads Calendar only when requested and separately disclosed", async () => {
    await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: true, signal, clock: now });
    expect(mocks.contexts).toHaveBeenCalledWith(expect.objectContaining({ includeGoogleCalendar: false }));
    expect(mocks.calendar).not.toHaveBeenCalled();

    const disclosed = { ...preferences, includeCalendar: true, calendarConnectionGeneration: 4, calendarSelectionRevision: 5 };
    mocks.preferences.mockResolvedValue(disclosed);
    mocks.calendar.mockResolvedValue({
      status: "connected", generation: 4, selectionRevision: 5,
      preferences: { selectedCalendarIds: ["calendar-1"] },
    });
    await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: true, signal, clock: now });
    expect(mocks.contexts).toHaveBeenLastCalledWith(expect.objectContaining({ includeGoogleCalendar: true }));
  });

  it("rechecks preferences, owner scope, source revision, timezone, Calendar selection, and expiry", async () => {
    const assertFailure = async (change: () => void) => {
      const prepared = await prepareAccountBriefingContexts(caller, {
        historyDays: [90], includeCalendar: false, signal, preferences, clock: now,
      });
      change();
      await expect(prepared.assertCurrent()).rejects.toMatchObject({ code: expect.stringMatching(/context_(changed|expired)/) });
      vi.clearAllMocks();
      mocks.preferences.mockResolvedValue(preferences);
      mocks.ids.mockResolvedValue(["behavior-1"]);
      mocks.revision.mockResolvedValue("raw-revision");
      mocks.timezone.mockResolvedValue(fixture.timezone);
      mocks.opaque.mockReturnValue((kind: string, value: string) => kind === "revision" ? (value === "raw-revision" ? "revision_cadence" : `revision_${value}`) : `${kind}_${value}`);
      mocks.contexts.mockResolvedValue([fixture]);
    };

    await assertFailure(() => mocks.preferences.mockResolvedValue({ ...preferences, revision: 4 }));
    await assertFailure(() => mocks.ids.mockResolvedValue(["behavior-2"]));
    await assertFailure(() => mocks.revision.mockResolvedValue("changed"));
    await assertFailure(() => mocks.timezone.mockResolvedValue("Europe/London"));

    const ownerCaller = { client: {}, user: { id: "owner-1" } } as CalendarCaller;
    const ownerPrepared = await prepareAccountBriefingContexts(ownerCaller, {
      historyDays: [90], includeCalendar: false, signal, preferences, clock: now,
    });
    ownerCaller.user.id = "owner-2";
    await expect(ownerPrepared.assertCurrent()).rejects.toMatchObject({ code: "context_changed" });
    ownerCaller.user.id = "owner-1";

    const disclosed = { ...preferences, includeCalendar: true, calendarConnectionGeneration: 4, calendarSelectionRevision: 5 };
    mocks.preferences.mockResolvedValue(disclosed);
    mocks.calendar.mockResolvedValue({ status: "connected", generation: 4, selectionRevision: 5, preferences: { selectedCalendarIds: ["calendar-1"] } });
    const calendarPrepared = await prepareAccountBriefingContexts(caller, {
      historyDays: [90], includeCalendar: true, signal, preferences: disclosed, clock: now,
    });
    mocks.calendar.mockResolvedValue({ status: "connected", generation: 4, selectionRevision: 6, preferences: { selectedCalendarIds: ["calendar-1"] } });
    await expect(calendarPrepared.assertCurrent()).rejects.toMatchObject({ code: "context_changed" });

    mocks.preferences.mockResolvedValue(preferences);
    let instant = Temporal.Instant.from("2026-11-01T12:00:01Z");
    const prepared = await prepareAccountBriefingContexts(caller, {
      historyDays: [90], includeCalendar: false, signal, preferences, clock: () => instant,
    });
    instant = Temporal.Instant.from(fixture.expiresAt);
    await expect(prepared.assertCurrent()).rejects.toMatchObject({ code: "context_expired" });
  });
});

describe("analysis source reads (Ticket 169)", () => {
  const snapshot = (overrides: Record<string, unknown> = {}) => ({
    timezone: fixture.timezone, observedAt: "2026-11-01T12:00:00Z", revision: "analysis-raw",
    occurrences: [{ id: "occ-1", behaviorId: "behavior-1", localDate: "2026-10-30", scheduledFor: "2026-10-30T16:30:00Z",
      scheduleKind: "exact", scheduleStartTime: "12:30:00", scheduleEndTime: null, status: "not_completed", statusMarkedAt: null, configurationEventId: null }],
    statusEvents: [], configurationEvents: [
      { id: "cfg-1", behaviorId: "behavior-1", eventKind: "baseline", effectiveAt: "2026-08-15T00:00:00Z", effectiveLocalDate: "2026-08-15", changedFields: ["schedule_graph"], source: "system", reasonCode: "history_capture_started", browserReminderEnabled: true, emailReminderEnabled: false },
      { id: "cfg-2", behaviorId: "behavior-1", eventKind: "revision", effectiveAt: "2026-09-01T00:00:00Z", effectiveLocalDate: "2026-09-01", changedFields: ["browser_reminder_enabled"], source: "manual", reasonCode: "edit", browserReminderEnabled: false, emailReminderEnabled: false },
      { id: "cfg-3", behaviorId: "behavior-1", eventKind: "revision", effectiveAt: "2026-09-10T00:00:00Z", effectiveLocalDate: "2026-09-10", changedFields: ["schedule_graph"], source: "manual", reasonCode: "edit", browserReminderEnabled: false, emailReminderEnabled: false },
    ],
    reminders: "not_requested", notes: "not_requested", ...overrides,
  });
  beforeEach(() => {
    mocks.analysis.mockResolvedValue(snapshot());
    mocks.analysisRevision.mockResolvedValue("analysis-raw");
  });

  it("reads nothing without selected lanes and never requests undisclosed optional sources", async () => {
    const plain = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now });
    expect(plain.analysisSource).toBeNull();
    expect(mocks.analysis).not.toHaveBeenCalled();
    const requested = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now, analysis: { includeReminders: true, includeNotes: true } });
    expect(mocks.analysis).toHaveBeenCalledWith(caller.client, expect.objectContaining({ includeReminders: false, includeNotes: false, behaviorIds: ["behavior-1"], historyStartLocalDate: "2026-08-03" }));
    expect(requested.analysisSource).toMatchObject({ reminders: { state: "not_requested" }, notes: { state: "not_requested" }, completeness: "complete" });
  });

  it("requests disclosed sources and projects opaque, schedule-segmented records", async () => {
    mocks.preferences.mockResolvedValue({ ...preferences, includeReminderHistory: true, includeNotes: true });
    mocks.analysis.mockResolvedValue(snapshot({ reminders: [], notes: [{ occurrenceId: "occ-1", behaviorId: "behavior-1", localDate: "2026-10-30", text: "  Rain  " }] }));
    const prepared = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now, analysis: { includeReminders: true, includeNotes: true } });
    expect(mocks.analysis).toHaveBeenCalledWith(caller.client, expect.objectContaining({ includeReminders: true, includeNotes: true }));
    const source = prepared.analysisSource!;
    expect(source.occurrences[0]).toMatchObject({ ref: "occurrence_occ-1", behaviorRef: "behavior_behavior-1", startTime: "12:30" });
    expect(source.configurationPeriods).toEqual({ state: "available", records: [
      expect.objectContaining({ ref: "configuration_cfg-1", startsSchedulePeriod: false }),
      expect.objectContaining({ ref: "configuration_cfg-2", startsSchedulePeriod: false }),
      expect.objectContaining({ ref: "configuration_cfg-3", startsSchedulePeriod: true }),
    ] });
    expect(source.notes).toEqual({ state: "available", records: [{ ref: "note_occ-1", occurrenceRef: "occurrence_occ-1", behaviorRef: "behavior_behavior-1", localDate: "2026-10-30", text: "Rain" }] });
    expect(JSON.stringify(source)).not.toMatch(/"occ-1"|"behavior-1"|"cfg-/);
  });

  it("marks capped sources and fences the analysis revision before delivery", async () => {
    mocks.analysis.mockResolvedValue(snapshot({ statusEvents: Array.from({ length: 20_001 }, (_, index) => ({ id: `e${index}`, occurrenceId: "occ-1", previousStatus: null, status: "completed", semantics: "explicit_user_mark", recordedAt: "2026-10-30T17:00:00Z", revisesEventId: null })) }));
    const prepared = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now, analysis: { includeReminders: false, includeNotes: false } });
    expect(prepared.analysisSource?.statusEvents).toEqual({ state: "capped" });
    await expect(prepared.assertCurrent()).resolves.toBeUndefined();
    mocks.analysisRevision.mockResolvedValue("analysis-changed");
    await expect(prepared.assertCurrent()).rejects.toMatchObject({ code: "context_changed" });
  });

  it("rejects a timezone race and derives stable per-owner tip fingerprints", async () => {
    mocks.analysis.mockResolvedValueOnce(snapshot({ timezone: "Europe/Paris" }));
    await expect(prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now, analysis: { includeReminders: false, includeNotes: false } }))
      .rejects.toMatchObject({ code: "context_changed" });
    const finding = { laneId: "decision-debt", behaviorRef: "behavior_behavior-1", key: "unresolved", evidenceBand: "share:4" } as never;
    const first = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now, analysis: { includeReminders: false, includeNotes: false } });
    const second = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now, analysis: { includeReminders: false, includeNotes: false } });
    expect(first.tipFingerprint(finding)).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tipFingerprint(finding)).toBe(second.tipFingerprint(finding));
    const other = await prepareAccountBriefingContexts({ ...caller, user: { id: "owner-2" } } as CalendarCaller, { historyDays: [90], includeCalendar: false, signal, clock: now, analysis: { includeReminders: false, includeNotes: false } });
    expect(other.tipFingerprint(finding)).not.toBe(first.tipFingerprint(finding));
  });
});

describe("separately disclosed connector fences (Ticket 239)", () => {
  const disclosed = { ...preferences, includeOutlookCalendar: true, outlookConnectionGeneration: 2, outlookSelectionRevision: 3, includeHevy: true, hevyConnectionGeneration: 5 };
  const sources = { calendars: true, recordedActivity: true, deadlineAt: Date.now() + 50_000 };
  beforeEach(() => {
    mocks.preferences.mockResolvedValue(disclosed);
    mocks.outlook.mockResolvedValue({ status: "connected", generation: 2, selectionRevision: 3, preferences: { selectedSourceIds: ["b", "a"] } });
    mocks.connector.mockResolvedValue({ status: "connected", generation: 5, selectionRevision: 0, preferences: { selectedSourceIds: [] } });
  });

  it("never reads or requests new sources for callers that omit them, even when disclosed", async () => {
    await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: true, signal, clock: now });
    expect(mocks.outlook).not.toHaveBeenCalled();
    expect(mocks.connector).not.toHaveBeenCalled();
    const call = mocks.contexts.mock.calls[0][0];
    expect(call).not.toHaveProperty("connectorSources");
    expect(call.authorization).not.toHaveProperty("outlookCalendar");
  });

  it("binds each disclosed source to its granted generation and selection", async () => {
    await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: true, signal, clock: now, connectorSources: sources });
    const call = mocks.contexts.mock.calls[0][0];
    expect(call.connectorSources).toEqual({ outlookCalendar: true, icloudCalendar: false, hevy: true, deadlineAt: sources.deadlineAt });
    expect(call.authorization).toMatchObject({
      outlookCalendar: { calendarIds: ["a", "b"], connectionGeneration: 2, selectionRevision: 3 },
      icloudCalendar: null,
      hevy: { connectionGeneration: 5 },
    });
  });

  it("drops calendar sources when the configuration excludes Calendar and leaves undisclosed sources unread", async () => {
    await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: false, signal, clock: now, connectorSources: { ...sources, calendars: false } });
    expect(mocks.outlook).not.toHaveBeenCalled();
    expect(mocks.contexts.mock.calls[0][0].connectorSources).toMatchObject({ outlookCalendar: false, hevy: true });
    mocks.preferences.mockResolvedValue(preferences);
    mocks.connector.mockClear();
    await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: true, signal, clock: now, connectorSources: sources });
    expect(mocks.contexts.mock.calls[1][0].connectorSources).toEqual({ outlookCalendar: false, icloudCalendar: false, hevy: false, deadlineAt: sources.deadlineAt });
    expect(mocks.connector).not.toHaveBeenCalled();
  });

  it.each([
    ["Outlook reconnect", () => mocks.outlook.mockResolvedValue({ status: "connected", generation: 3, selectionRevision: 3, preferences: { selectedSourceIds: ["a"] } })],
    ["Outlook selection change", () => mocks.outlook.mockResolvedValue({ status: "connected", generation: 2, selectionRevision: 4, preferences: { selectedSourceIds: ["a"] } })],
    ["Hevy disconnect", () => mocks.connector.mockResolvedValue({ status: "disconnected", generation: 6, selectionRevision: 0, preferences: { selectedSourceIds: [] } })],
  ])("refuses a stale disclosure before reading context: %s", async (_label, change) => {
    change();
    await expect(prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: true, signal, clock: now, connectorSources: sources }))
      .rejects.toMatchObject({ code: "context_changed" });
    expect(mocks.contexts).not.toHaveBeenCalled();
  });

  it("rejects prepared output when a disclosure is withdrawn or a source changes before delivery", async () => {
    const prepared = await prepareAccountBriefingContexts(caller, { historyDays: [90], includeCalendar: true, signal, clock: now, connectorSources: sources });
    mocks.preferences.mockResolvedValue({ ...disclosed, includeHevy: false, hevyConnectionGeneration: null, revision: 4 });
    await expect(prepared.assertCurrent()).rejects.toMatchObject({ code: "context_changed" });
    mocks.preferences.mockResolvedValue(disclosed);
    mocks.connector.mockResolvedValue({ status: "connected", generation: 7, selectionRevision: 0, preferences: { selectedSourceIds: [] } });
    await expect(prepared.assertCurrent()).rejects.toMatchObject({ code: "context_changed" });
  });
});
