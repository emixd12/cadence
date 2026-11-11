import { describe, expect, it } from "vitest";
import {
  NO_DAILY_BRIEF_SOURCES,
  dailyBriefChoiceFromAllowed,
  dailyBriefSourceAllowed,
  dailyBriefSourcesUsed,
} from "@cadence/core/services/daily-brief-sources";

const ready = { googleCalendar: "ready", outlookCalendar: "ready", icloudCalendar: "ready", hevy: "ready" } as const;

describe("Daily Brief connected sources (Ticket 306)", () => {
  it("uses every ready source the one choice covers, including one connected after the choice", () => {
    const choice = { enabled: true, useConnectedSources: true, excludedSources: NO_DAILY_BRIEF_SOURCES };
    expect(dailyBriefSourcesUsed(choice, { ...ready, icloudCalendar: "not_connected" })).toEqual({
      googleCalendar: true, outlookCalendar: true, icloudCalendar: false, hevy: true,
    });
    // iCloud connects later: nothing about the choice changes.
    expect(dailyBriefSourcesUsed(choice, ready).icloudCalendar).toBe(true);
  });

  it("never uses an excluded source, a calendar with nothing selected, or any source while the choice or Daily Brief is off", () => {
    const excluded = { ...NO_DAILY_BRIEF_SOURCES, hevy: true };
    expect(dailyBriefSourceAllowed({ enabled: true, useConnectedSources: true, excludedSources: excluded }, "hevy")).toBe(false);
    expect(dailyBriefSourcesUsed({ enabled: true, useConnectedSources: true, excludedSources: excluded }, { ...ready, outlookCalendar: "no_calendars" }))
      .toEqual({ googleCalendar: true, outlookCalendar: false, icloudCalendar: true, hevy: false });
    expect(dailyBriefSourcesUsed({ enabled: true, useConnectedSources: false, excludedSources: NO_DAILY_BRIEF_SOURCES }, ready)).toEqual(NO_DAILY_BRIEF_SOURCES);
    expect(dailyBriefSourcesUsed({ enabled: false, useConnectedSources: true, excludedSources: NO_DAILY_BRIEF_SOURCES }, ready)).toEqual(NO_DAILY_BRIEF_SOURCES);
  });

  it("maps per-source allowances so existing accounts keep exactly what they allowed", () => {
    expect(dailyBriefChoiceFromAllowed(true, { ...NO_DAILY_BRIEF_SOURCES, outlookCalendar: true, hevy: true })).toEqual({
      useConnectedSources: true, excludedSources: { googleCalendar: true, outlookCalendar: false, icloudCalendar: true, hevy: false },
    });
    expect(dailyBriefChoiceFromAllowed(true, NO_DAILY_BRIEF_SOURCES)).toEqual({ useConnectedSources: false, excludedSources: NO_DAILY_BRIEF_SOURCES });
    expect(dailyBriefChoiceFromAllowed(false, { ...NO_DAILY_BRIEF_SOURCES, hevy: true })).toEqual({ useConnectedSources: false, excludedSources: NO_DAILY_BRIEF_SOURCES });
  });
});
