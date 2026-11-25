import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTravelEventRevisionFingerprint } from "@cadence/core/resolvers/travel-horizon.resolver";
import type { AdvisorDayContext, AdvisorOpaqueRef } from "@cadence/core/types/advisor-day-context";
import type { AdvisorTravelContext } from "@cadence/core/types/briefing-travel";
import type { TravelRouteEstimate, TravelRouteRequest } from "@cadence/core/types/travel";
import {
  capGoogleCalendarLoadExpiresAt,
  listDailyCalendarLoad,
  upsertDailyCalendarLoad,
} from "@/lib/db/dailyCalendarLoad.repo";
import { persistCalendarLoadFromSnapshot } from "@/lib/services/daily-calendar-load.service";
import {
  issueTravelConclusionsToken,
  verifyTravelConclusionsToken,
  type TravelConclusionsSecrets,
} from "@/lib/services/travel-conclusions-token";
import {
  issueTravelTimesToken,
  verifyTravelTimesToken,
} from "@/lib/services/travel-times-token";
import { briefMoveCalendar, briefMoveTravel } from "@/lib/services/brief-moves.service";
import { withSuppliedConclusions } from "@/lib/services/briefing-account-context.service";
import {
  getCachedTravelRouteEstimate,
  resetTravelRouteEstimateCacheForTests,
  routeTravelLegsWithReuseCache,
  setCachedTravelRouteEstimate,
  travelRouteEstimateCacheKey,
} from "@/lib/services/travel-route-refresh.service";
import {
  createCalendarAuthorization,
  GOOGLE_CALENDAR_AI_MCP_STATE_PREFIX,
  readCalendarOAuthConfig,
} from "@/lib/services/google-calendar-oauth";
import {
  GOOGLE_CALENDAR_AI_MCP_PURPOSE_PARAM,
  resolveCalendarPurposeWireParam,
} from "@/lib/types/google-calendar";
import { resetGoogleCalendarMcpCacheForTests } from "@/lib/services/google-calendar-mcp-cache";

const SECRET = "s".repeat(48);
const SECRETS: TravelConclusionsSecrets = { current: SECRET, previous: null };
const NOW = Temporal.Instant.from("2026-11-25T15:00:00Z");

describe("WS-2B Google Calendar Agent MCP isolation & leak closures", () => {
  beforeEach(() => {
    resetTravelRouteEstimateCacheForTests();
    resetGoogleCalendarMcpCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps versioned ?purpose=ai_mcp to agent while keeping legacy ?purpose=agent retired", () => {
    expect(resolveCalendarPurposeWireParam(undefined)).toBe("standard");
    expect(resolveCalendarPurposeWireParam("standard")).toBe("standard");
    expect(resolveCalendarPurposeWireParam(GOOGLE_CALENDAR_AI_MCP_PURPOSE_PARAM)).toBe("agent");
    expect(resolveCalendarPurposeWireParam("agent")).toBe("retired_agent");
    expect(resolveCalendarPurposeWireParam("unknown")).toBeNull();
  });

  it("prefixes AI MCP OAuth states with m_ distinct from retired a_ states", () => {
    const config = readCalendarOAuthConfig({
      GOOGLE_CALENDAR_PROJECT_ID: "cadence-calendar-498717",
      GOOGLE_CALENDAR_CLIENT_ID: "std-client",
      GOOGLE_CALENDAR_AGENT_PROJECT_ID: "cadence-calendar-agent-prod",
      GOOGLE_CALENDAR_AGENT_CLIENT_ID: "agent-client",
      GOOGLE_CALENDAR_AGENT_CLIENT_SECRET: "agent-secret",
      GOOGLE_CALENDAR_CALLBACK_URL: "https://cadence.app/auth/google-calendar/callback",
      GOOGLE_CALENDAR_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      GOOGLE_CALENDAR_KEY_ID: "k1",
    }, undefined, "agent");
    expect(config).not.toBeNull();
    const auth = createCalendarAuthorization(config!, "sub-123");
    expect(auth.state.startsWith(GOOGLE_CALENDAR_AI_MCP_STATE_PREFIX)).toBe(true);
    expect(auth.state.length).toBe(45);
  });

  describe("Q2 daily_calendar_load isolation", () => {
    it("refuses standard REST writes for google_calendar and caps agent_mcp writes to <=30 days", async () => {
      const upsert = vi.fn().mockResolvedValue({ error: null });
      const client = { from: vi.fn(() => ({ upsert })) } as unknown as Parameters<typeof upsertDailyCalendarLoad>[0];
      const entries = [{
        localDate: "2026-11-25",
        busyMinutes: 60,
        eventCount: 1,
        earliestStartMinute: 540,
        latestEndMinute: 600,
        hasAllDayBusy: false,
      }];

      // Standard REST write for Google Calendar is refused (no-op).
      const stdCount = await upsertDailyCalendarLoad(client, "user-1", "google_calendar", 1, entries, NOW.toString(), {
        grantPurpose: "standard",
      });
      expect(stdCount).toBe(0);
      expect(upsert).not.toHaveBeenCalled();

      // Persisting via service with standard grantPurpose also refuses.
      const svcStd = await persistCalendarLoadFromSnapshot(client, "user-1", "google_calendar", 1, {
        completeness: "complete",
        requestedRange: { startLocalDate: "2026-11-25", endLocalDate: "2026-11-25", timezone: "America/New_York" },
        events: [],
      }, NOW.toString(), { grantPurpose: "standard" });
      expect(svcStd).toBe(0);

      // Agent MCP write succeeds and caps expires_at to <= 30 days.
      const farFuture = NOW.add({ seconds: 90 * 86_400 }).toString();
      const mcpCount = await upsertDailyCalendarLoad(client, "user-1", "google_calendar", 2, entries, NOW.toString(), {
        grantPurpose: "agent_mcp",
        expiresAt: farFuture,
      });
      expect(mcpCount).toBe(1);
      expect(upsert).toHaveBeenCalledTimes(1);
      const writtenRow = upsert.mock.calls[0]![0][0];
      expect(writtenRow.grant_purpose).toBe("agent_mcp");
      expect(writtenRow.expires_at).toBe(capGoogleCalendarLoadExpiresAt(NOW.toString(), farFuture));
      expect(Temporal.Instant.from(writtenRow.expires_at).epochMilliseconds)
        .toBeLessThanOrEqual(NOW.add({ seconds: 30 * 86_400 }).epochMilliseconds);

      // Outlook keeps grant_purpose = "standard" and expires_at = null.
      await upsertDailyCalendarLoad(client, "user-1", "outlook_calendar", 1, entries, NOW.toString());
      const outlookRow = upsert.mock.calls[1]![0][0];
      expect(outlookRow.grant_purpose).toBe("standard");
      expect(outlookRow.expires_at).toBeNull();
    });

    it("filters out expired rows and non-agent_mcp google_calendar rows on listDailyCalendarLoad", async () => {
      const rows = [
        {
          user_id: "user-1", source: "google_calendar", local_date: "2026-11-25",
          busy_minutes: 60, event_count: 1, earliest_start_minute: 540, latest_end_minute: 600,
          has_all_day_busy: false, connection_generation: 2, synced_at: NOW.toString(),
          grant_purpose: "agent_mcp", expires_at: NOW.add({ seconds: 3600 }).toString(),
        },
        {
          user_id: "user-1", source: "google_calendar", local_date: "2026-11-24",
          busy_minutes: 30, event_count: 1, earliest_start_minute: 540, latest_end_minute: 570,
          has_all_day_busy: false, connection_generation: 2, synced_at: NOW.toString(),
          grant_purpose: "agent_mcp", expires_at: NOW.subtract({ seconds: 1 }).toString(),
        },
        {
          user_id: "user-1", source: "google_calendar", local_date: "2026-11-23",
          busy_minutes: 45, event_count: 1, earliest_start_minute: 540, latest_end_minute: 585,
          has_all_day_busy: false, connection_generation: 1, synced_at: NOW.toString(),
          grant_purpose: "standard", expires_at: null,
        },
      ];
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
      };
      const client = { from: vi.fn(() => query) } as unknown as Parameters<typeof listDailyCalendarLoad>[0];
      const result = await listDailyCalendarLoad(client, "user-1", "2026-11-20", "2026-11-26", { now: NOW });
      expect(result).toHaveLength(1);
      expect(result[0]!.local_date).toBe("2026-11-25");
    });
  });

  describe("Path 3: Travel conclusions & travel times tokens + etag-free fingerprint matching", () => {
    const makeOpaqueRef: AdvisorOpaqueRef = (kind, value) => `${kind}_${value}`;

    const baseTravel: AdvisorTravelContext = {
      version: "1.0",
      routing: "on",
      usualMode: "driving",
      behaviors: [],
      route: { state: "unavailable", reason: "not_supplied" },
    };

    const baseContext = (events: AdvisorDayContext["connectors"]): AdvisorDayContext => ({
      version: "1.1",
      snapshotId: "snap_1",
      accountRef: "acct_1",
      localDate: "2026-11-25",
      timezone: "America/New_York",
      dayStartAt: "2026-11-25T05:00:00Z",
      dayEndAt: "2026-11-26T05:00:00Z",
      capturedAt: NOW.toString(),
      expiresAt: NOW.add({ minutes: 5 }).toString(),
      status: "complete",
      authority: "read_only",
      grantGeneration: 1,
      cadence: {
        observedAt: NOW.toString(),
        revision: "rev_1",
        coverage: "complete",
        occurrences: [],
        history: {
          startLocalDate: "2026-11-01",
          endLocalDateExclusive: "2026-11-25",
          lookbackDays: 24,
          completeness: "complete",
          reason: null,
          behaviors: [],
        },
      },
      connectors: events,
    });

    it("rejects Timeline-REST (googleSource: 'standard') travel conclusions and travel times tokens", () => {
      const stdToken = issueTravelConclusionsToken({
        sub: "user-1",
        date: "2026-11-25",
        src: "src-1",
        iat: NOW.toString(),
        exp: NOW.add({ minutes: 10 }).toString(),
        googleSource: "standard",
        conclusions: {
          version: "1.0",
          trips: [],
          fits: [],
          unknowns: [],
        } as unknown as Parameters<typeof issueTravelConclusionsToken>[0]["conclusions"],
        weather: null,
        events: {},
        stops: { outlook_calendar: false, icloud_calendar: false },
      }, SECRET);
      const verified = verifyTravelConclusionsToken(stdToken, {
        secrets: SECRETS,
        userId: "user-1",
        localDate: "2026-11-25",
        now: NOW,
      });
      expect(verified).not.toBeNull();
      expect(() => withSuppliedConclusions(
        baseContext([]),
        baseTravel,
        { ...verified!, takingPart: [] },
        makeOpaqueRef,
      )).toThrow(/Timeline-REST/);

      const stdTimesToken = issueTravelTimesToken({
        sub: "user-1",
        date: "2026-11-25",
        iat: NOW.toString(),
        exp: NOW.add({ minutes: 10 }).toString(),
        googleSource: "standard",
        spans: [],
        stops: {},
        unknown: [],
      }, SECRET);
      expect(verifyTravelTimesToken(stdTimesToken, {
        secrets: SECRETS,
        userId: "user-1",
        localDate: "2026-11-25",
        now: NOW,
      })?.googleSource).toBe("standard");
      expect(briefMoveTravel(stdTimesToken, {
        secrets: SECRETS,
        userId: "user-1",
        localDate: "2026-11-25",
        now: NOW,
      })).toBeNull();
    });

    it("matches Google MCP + Outlook + iCloud conclusions without etag via buildTravelEventRevisionFingerprint", () => {
      const gcalFp = buildTravelEventRevisionFingerprint({
        source: "google_calendar",
        calendarId: "primary",
        eventId: "evt-1",
        startAt: "2026-11-25T16:00:00Z",
        endAt: "2026-11-25T17:00:00Z",
        status: "confirmed",
        availability: "busy",
      });
      const outlookFp = buildTravelEventRevisionFingerprint({
        source: "outlook_calendar",
        calendarId: "work",
        eventId: "out-1",
        startAt: "2026-11-25T18:00:00Z",
        endAt: "2026-11-25T19:00:00Z",
        status: "confirmed",
        availability: "busy",
      });
      const mcpToken = issueTravelConclusionsToken({
        sub: "user-1",
        date: "2026-11-25",
        src: "src-1",
        iat: NOW.toString(),
        exp: NOW.add({ minutes: 10 }).toString(),
        googleSource: "agent_mcp",
        conclusions: {
          version: "1.0",
          trips: [],
          fits: [],
          unknowns: [],
        } as unknown as Parameters<typeof issueTravelConclusionsToken>[0]["conclusions"],
        weather: null,
        events: {
          "event:primary\0evt-1": gcalFp,
          "event:outlook_calendar\0work\0out-1": outlookFp,
        },
        stops: { outlook_calendar: true, icloud_calendar: false },
      }, SECRET);
      const verified = verifyTravelConclusionsToken(mcpToken, {
        secrets: SECRETS,
        userId: "user-1",
        localDate: "2026-11-25",
        now: NOW,
      })!;

      const ctx = baseContext([
        {
          source: "google_calendar",
          state: "current",
          complete: true,
          fetchedAt: NOW.toString(),
          connectionGeneration: 2,
          selectionRevision: 1,
          events: [{
            ref: makeOpaqueRef("event", "primary\0evt-1"),
            calendarRef: makeOpaqueRef("calendar", "primary"),
            revision: "different-etag-or-none",
            state: "confirmed",
            availability: "busy",
            currentUserResponse: "accepted",
            interval: { kind: "timed", startAt: "2026-11-25T16:00:00Z", endAt: "2026-11-25T17:00:00Z" },
          }],
        } as unknown as AdvisorDayContext["connectors"][number],
        {
          source: "outlook_calendar",
          state: "current",
          complete: true,
          fetchedAt: NOW.toString(),
          connectionGeneration: 1,
          selectionRevision: 1,
          events: [{
            ref: makeOpaqueRef("event", "outlook_calendar\0work\0out-1"),
            calendarRef: makeOpaqueRef("calendar", "outlook_calendar\0work"),
            revision: "outlook-rev",
            state: "confirmed",
            availability: "busy",
            currentUserResponse: "accepted",
            interval: { kind: "timed", startAt: "2026-11-25T18:00:00Z", endAt: "2026-11-25T19:00:00Z" },
          }],
        } as unknown as AdvisorDayContext["connectors"][number],
      ]);

      const merged = withSuppliedConclusions(
        ctx,
        baseTravel,
        { ...verified, takingPart: ["google_calendar", "outlook_calendar"] },
        makeOpaqueRef,
      );
      expect(merged.route.state).toBe("available");
    });
  });

  describe("Path 4: Client calendarBusy ignored on AI endpoints", () => {
    it("ignores client-supplied calendarBusy and uses only server-side context connectors", () => {
      const result = briefMoveCalendar(null, [
        { startAt: "2026-11-25T16:00:00Z", endAt: "2026-11-25T17:00:00Z", title: "Leaked REST event" },
      ]);
      expect(result.busy).toEqual([]);
      expect(result.state).toBe("none");
    });
  });

  describe("Provenance-safe Routes estimate reuse cache", () => {
    it("reuses cached route estimates by (origin, destination, mode, departure bucket) without storing event metadata", async () => {
      const request: TravelRouteRequest = {
        mode: "driving",
        origin: { kind: "place_id", placeId: "place-home" },
        destination: { kind: "place_id", placeId: "place-office" },
        readyAt: "2026-11-25T15:32:00Z",
        timing: { kind: "arrive_by", at: "2026-11-25T16:00:00Z" },
      };
      const estimate: TravelRouteEstimate = {
        durationSeconds: 1200,
        departureAt: "2026-11-25T15:40:00Z",
        arrivalAt: "2026-11-25T16:00:00Z",
        warnings: [],
        fallback: false,
        attribution: "Google Maps",
        observedAt: NOW.toString(),
        expiresAt: NOW.add({ minutes: 15 }).toString(),
      };
      const key = travelRouteEstimateCacheKey(request);
      expect(key).not.toContain("title");
      setCachedTravelRouteEstimate(request, estimate, NOW.epochMilliseconds);

      // Same 5-minute bucket hits cache without calling provider or reserve.
      const sameBucketRequest: TravelRouteRequest = {
        ...request,
        readyAt: "2026-11-25T15:34:30Z",
      };
      expect(getCachedTravelRouteEstimate(sameBucketRequest, NOW.epochMilliseconds)).toEqual(estimate);

      const reserve = vi.fn();
      const routed = await routeTravelLegsWithReuseCache({
        routes: [{ id: "leg-1", request: sameBucketRequest }],
        provider: { mode: "disabled" } as unknown as Parameters<typeof routeTravelLegsWithReuseCache>[0]["provider"],
        reserve,
        now: NOW,
      });
      expect(reserve).not.toHaveBeenCalled();
      expect(routed).toEqual([{ id: "leg-1", estimate, failure: null }]);
    });
  });
});
