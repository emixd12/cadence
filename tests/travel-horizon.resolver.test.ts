import { describe, expect, it } from "vitest";
import {
  buildTravelEventRevisionFingerprint,
  matchTravelConclusionsToEvents,
  resolveChatTravelHorizon,
} from "@cadence/core/resolvers/travel-horizon.resolver";

describe("travel-horizon.resolver", () => {
  it("enforces L-001 separation: modelSummary contains zero route durations, leave-by times, or addresses while uiCards carry exact timing", () => {
    const result = resolveChatTravelHorizon({
      now: "2026-11-25T13:00:00Z",
      timezone: "America/New_York",
      horizonDays: 7,
      trips: [
        {
          localDate: "2026-11-25",
          tripLabel: "Dentist appointment",
          destinationLabel: "742 Evergreen Terrace, Suite 4B",
          mode: "driving",
          departureAt: "2026-11-25T18:17:00Z", // 13:17 EST
          arrivalAt: "2026-11-25T18:54:00Z", // 13:54 EST
          durationSeconds: 37 * 60,
          bufferMinutes: 10,
        },
      ],
      occurrences: [
        {
          occurrenceRef: "occ-run-today",
          behaviorId: "beh-run",
          localDate: "2026-11-25",
          startAt: "2026-11-25T18:30:00Z", // 13:30 EST — overlaps travel
          endAt: "2026-11-25T19:00:00Z",
          durationMinutes: 30,
          flexible: true,
        },
        {
          occurrenceRef: "occ-read-today",
          behaviorId: "beh-read",
          localDate: "2026-11-25",
          startAt: "2026-11-25T23:00:00Z", // 18:00 EST — fits
          endAt: "2026-11-25T23:30:00Z",
          durationMinutes: 30,
          flexible: false,
        },
      ],
    });

    expect(result.horizonDays).toBe(7);
    expect(result.modelSummary.days).toHaveLength(7);

    // UI card carries exact leave-by time, duration, arrival, and destination label.
    expect(result.uiCards).toHaveLength(1);
    expect(result.uiCards[0]).toEqual({
      localDate: "2026-11-25",
      tripLabel: "Dentist appointment",
      destinationLabel: "742 Evergreen Terrace, Suite 4B",
      mode: "driving",
      leaveByLocalTime: "13:17",
      durationMinutes: 37,
      arrivalLocalTime: "13:54",
      bufferMinutes: 10,
      conflictSummary: "Overlaps 1 scheduled Behavior.",
    });

    // Strict L-001 leakage assertion on serialized modelSummary.
    const serialized = JSON.stringify(result.modelSummary);
    expect(serialized).not.toContain("13:17");
    expect(serialized).not.toContain("13:54");
    expect(serialized).not.toContain("18:17");
    expect(serialized).not.toContain("18:54");
    expect(serialized).not.toContain("37");
    expect(serialized).not.toContain("Evergreen");
    expect(serialized).not.toContain("Dentist");
    expect(serialized).not.toContain("durationMinutes");
    expect(serialized).not.toContain("leaveByLocalTime");
    expect(serialized).not.toContain("arrivalLocalTime");
    expect(serialized).not.toContain("destinationLabel");
  });

  it("detects cross-day shift candidates for flexible Behaviors across a 7-day horizon", () => {
    const result = resolveChatTravelHorizon({
      now: "2026-11-25T13:00:00Z",
      timezone: "America/New_York",
      horizonDays: 7,
      trips: [
        {
          localDate: "2026-11-25",
          tripLabel: "Client onsite",
          destinationLabel: "Downtown",
          mode: "transit",
          departureAt: "2026-11-25T14:00:00Z",
          arrivalAt: "2026-11-25T15:00:00Z",
          durationSeconds: 3600,
          bufferMinutes: 15,
        },
        {
          localDate: "2026-11-26",
          tripLabel: "Airport leg 1",
          destinationLabel: "Airport",
          mode: "driving",
          departureAt: "2026-11-26T14:00:00Z",
          arrivalAt: "2026-11-26T15:00:00Z",
          durationSeconds: 3600,
          bufferMinutes: 15,
        },
        {
          localDate: "2026-11-26",
          tripLabel: "Airport leg 2",
          destinationLabel: "Hotel",
          mode: "driving",
          departureAt: "2026-11-26T19:00:00Z",
          arrivalAt: "2026-11-26T20:00:00Z",
          durationSeconds: 3600,
          bufferMinutes: 15,
        },
      ],
      occurrences: [
        {
          occurrenceRef: "occ-gym-1",
          behaviorId: "beh-gym",
          localDate: "2026-11-25",
          startAt: "2026-11-25T14:30:00Z",
          endAt: "2026-11-25T15:15:00Z",
          durationMinutes: 45,
          flexible: true,
        },
      ],
    });

    const today = result.modelSummary.days[0];
    expect(today.heavyTravelDay).toBe(true);
    expect(today.behaviorFits[0].status).toBe("does_not_fit");
    // 2026-11-26 is also a heavy travel day (2 trips), so candidate skips to 2026-11-27.
    expect(result.modelSummary.crossDayCandidates).toHaveLength(1);
    expect(result.modelSummary.crossDayCandidates[0]).toEqual({
      occurrenceRef: "occ-gym-1",
      behaviorId: "beh-gym",
      fromLocalDate: "2026-11-25",
      suggestedLocalDate: "2026-11-27",
      suggestedBucket: "early_morning",
      reason: "travel_conflict",
      requiresConfirmation: true,
    });
  });

  it("matches travel conclusions across Google MCP, Outlook, and iCloud without requiring etag", () => {
    const googleRestEvent = {
      source: "google_calendar",
      calendarId: "primary",
      eventId: "evt-google-1",
      startAt: "2026-11-25T15:00:00Z",
      endAt: "2026-11-25T16:00:00Z",
      location: "  123 Main St  ",
      status: "confirmed",
      availability: "busy",
    };
    const googleMcpEvent = {
      ref: "opaque-google-1",
      source: "google_calendar",
      calendarId: "primary",
      eventId: "evt-google-1",
      startAt: "2026-11-25T10:00:00-05:00", // Same instant, different offset format
      endAt: "2026-11-25T11:00:00-05:00",
      location: "123   main st", // Normalized whitespace & case
      status: "CONFIRMED",
      availability: "BUSY",
    };
    const outlookEvent = {
      ref: "opaque-outlook-1",
      source: "outlook_calendar",
      calendarId: "cal-work",
      eventId: "evt-outlook-1",
      startAt: "2026-11-25T18:00:00Z",
      endAt: "2026-11-25T19:00:00Z",
      location: "Office HQ",
      status: "confirmed",
      availability: "busy",
    };
    const icloudEvent = {
      ref: "opaque-icloud-1",
      source: "icloud_calendar",
      calendarId: "home",
      eventId: "evt-icloud-1",
      startAt: "2026-11-25T21:00:00Z",
      endAt: "2026-11-25T22:00:00Z",
      location: "Community Center",
      status: "confirmed",
      availability: "busy",
    };

    const googleFp = buildTravelEventRevisionFingerprint(googleRestEvent);
    const outlookFp = buildTravelEventRevisionFingerprint(outlookEvent);
    const icloudFp = buildTravelEventRevisionFingerprint(icloudEvent);

    expect(googleFp).toBe(buildTravelEventRevisionFingerprint(googleMcpEvent));

    const match = matchTravelConclusionsToEvents(
      [
        {
          eventKey: "event:google_calendar\0evt-google-1",
          source: "google_calendar",
          calendarId: "primary",
          eventId: "evt-google-1",
          fingerprint: googleFp,
        },
        {
          eventKey: "event:outlook_calendar\0evt-outlook-1",
          source: "outlook_calendar",
          calendarId: "cal-work",
          eventId: "evt-outlook-1",
          fingerprint: outlookFp,
        },
        {
          eventKey: "event:icloud_calendar\0evt-icloud-1",
          source: "icloud_calendar",
          calendarId: "home",
          eventId: "evt-icloud-1",
          fingerprint: icloudFp,
        },
      ],
      [googleMcpEvent, outlookEvent, icloudEvent],
    );

    expect(match.matched).toBe(true);
    expect(match.matchedCount).toBe(3);
    expect(match.unmatchedKeys).toEqual([]);
    expect(match.changedKeys).toEqual([]);
    expect(match.matchedRefs).toEqual({
      "event:google_calendar\0evt-google-1": "opaque-google-1",
      "event:outlook_calendar\0evt-outlook-1": "opaque-outlook-1",
      "event:icloud_calendar\0evt-icloud-1": "opaque-icloud-1",
    });

    // Mutating location invalidates the fingerprint deterministically.
    const changedMatch = matchTravelConclusionsToEvents(
      [
        {
          eventKey: "event:google_calendar\0evt-google-1",
          source: "google_calendar",
          calendarId: "primary",
          eventId: "evt-google-1",
          fingerprint: googleFp,
        },
      ],
      [{ ...googleMcpEvent, location: "456 Oak Ave" }],
    );
    expect(changedMatch.matched).toBe(false);
    expect(changedMatch.changedKeys).toEqual(["event:google_calendar\0evt-google-1"]);
  });
});
