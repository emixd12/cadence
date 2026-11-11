import { describe, expect, it } from "vitest";

import type { DailyBriefSettings } from "@cadence/core/types/daily-brief";
import type { TravelSettings } from "@cadence/core/types/travel";
import type { ConnectorConnectionView } from "@/lib/types/connectors";
import type { CalendarConnectionView } from "@/lib/types/google-calendar";
import {
  SETTINGS_SECTION_CHECKING,
  SETTINGS_SECTION_UNAVAILABLE,
  categoriesSectionState,
  connectorSectionState,
  dailyBriefSectionState,
  googleCalendarSectionState,
  isSettingsSectionChecking,
  settingsSectionLoad,
  travelSectionState,
} from "@/lib/ui/settings-sections";

const loaded = <T,>(value: T) => ({ phase: "loaded" as const, value });
const loading = { phase: "loading" as const };
const failed = { phase: "failed" as const };

const google = (status: CalendarConnectionView["status"], selected: string[] = []): CalendarConnectionView => ({
  accountId: "account-1", status, generation: 1, selectionRevision: 1,
  preferences: { selectedCalendarIds: selected, hiddenCalendarIds: [], visible: true, showAllDay: true },
});
const connector = (provider: ConnectorConnectionView["provider"], status: ConnectorConnectionView["status"], selected: string[] = []): ConnectorConnectionView => ({
  accountId: "account-1", provider, status, generation: 1, selectionRevision: 1,
  preferences: { selectedSourceIds: selected, hiddenSourceIds: [], visible: true, showAllDay: true },
});
const travel = (overrides: Partial<TravelSettings> = {}): TravelSettings => ({
  enabled: false, baseLocationText: null, mode: null, navigationPreference: null, routingConsentAt: null, onboardingCompletedAt: null,
  updatedAt: "2026-11-01T12:00:00Z", ...overrides,
});
const brief = (overrides: Partial<DailyBriefSettings> = {}): DailyBriefSettings => ({
  accountRef: "account-1", available: true, enabled: false, includeCalendar: false, revision: 1, localDate: "2026-11-10",
  timezone: "America/New_York", ...overrides,
});

describe("settingsSectionLoad", () => {
  it("is loading until a value or a failure arrives", () => {
    expect(settingsSectionLoad(null, false)).toEqual(loading);
    expect(settingsSectionLoad(undefined, true)).toEqual(failed);
    expect(settingsSectionLoad({ a: 1 }, true)).toEqual(loaded({ a: 1 }));
  });
});

describe("every section state function", () => {
  const functions = [
    ["Google Calendar", googleCalendarSectionState],
    ["connectors", connectorSectionState],
    ["Travel", travelSectionState],
    ["Daily Brief", dailyBriefSectionState],
  ] as const;
  it.each(functions)("%s says Checking… while loading and Status unavailable, needing action, on a failed read", (_name, fn) => {
    expect(fn(loading)).toEqual({ text: "Checking…", attention: false, on: false });
    expect(fn(failed)).toEqual({ text: "Status unavailable", attention: true, on: false });
    expect(isSettingsSectionChecking(fn(loading))).toBe(true);
    expect(isSettingsSectionChecking(fn(failed))).toBe(false);
  });
});

describe("googleCalendarSectionState", () => {
  it("counts selected calendars and asks for a choice when none is selected", () => {
    expect(googleCalendarSectionState(loaded(google("connected", ["a", "b", "c"])))).toEqual({ text: "Connected · 3 calendars", attention: false, on: true });
    expect(googleCalendarSectionState(loaded(google("connected", ["a"])))).toEqual({ text: "Connected · 1 calendar", attention: false, on: true });
    expect(googleCalendarSectionState(loaded(google("connected")))).toEqual({ text: "Connected · No calendars chosen", attention: true, on: true });
  });
  it("maps the other connection states", () => {
    expect(googleCalendarSectionState(loaded(google("disconnected")))).toEqual({ text: "Not connected", attention: false, on: false });
    expect(googleCalendarSectionState(loaded(google("reconnect_required")))).toEqual({ text: "Needs reconnection", attention: true, on: true });
    expect(googleCalendarSectionState(loaded(google("not_configured")))).toEqual({ text: "Not available here", attention: false, on: false });
    expect(googleCalendarSectionState(loaded(google("unavailable")))).toBe(SETTINGS_SECTION_UNAVAILABLE);
  });
});

describe("connectorSectionState", () => {
  it("counts Outlook and iCloud calendars", () => {
    expect(connectorSectionState(loaded(connector("outlook_calendar", "connected", ["a"])))).toEqual({ text: "Connected · 1 calendar", attention: false, on: true });
    expect(connectorSectionState(loaded(connector("icloud_calendar", "connected", ["a", "b"])))).toEqual({ text: "Connected · 2 calendars", attention: false, on: true });
    expect(connectorSectionState(loaded(connector("icloud_calendar", "connected"))).attention).toBe(true);
  });
  it("shows Hevy as connected without a calendar count", () => {
    expect(connectorSectionState(loaded(connector("hevy", "connected")))).toEqual({ text: "Connected", attention: false, on: true });
  });
  it("needs action only for reconnection", () => {
    expect(connectorSectionState(loaded(connector("outlook_calendar", "reconnect_required")))).toEqual({ text: "Needs reconnection", attention: true, on: true });
    expect(connectorSectionState(loaded(connector("hevy", "disconnected")))).toEqual({ text: "Not connected", attention: false, on: false });
    expect(connectorSectionState(loaded(connector("hevy", "not_configured")))).toEqual({ text: "Not available here", attention: false, on: false });
  });
});

describe("travelSectionState", () => {
  it("is Off until estimates are on", () => {
    expect(travelSectionState(loaded(travel({ mode: "walking" })))).toEqual({ text: "Off", attention: false, on: false });
  });
  it("names the usual travel and Home when on", () => {
    expect(travelSectionState(loaded(travel({ enabled: true, mode: "transit", baseLocationText: "10 Example Road" }))))
      .toEqual({ text: "On · Transit from Home", attention: false, on: true });
    expect(travelSectionState(loaded(travel({ enabled: true, mode: "cycling" })))).toEqual({ text: "On · Cycling", attention: false, on: true });
  });
});

describe("dailyBriefSectionState", () => {
  it("is Off, On or Unavailable", () => {
    expect(dailyBriefSectionState(loaded(brief()))).toEqual({ text: "Off", attention: false, on: false });
    expect(dailyBriefSectionState(loaded(brief({ enabled: true })))).toEqual({ text: "On", attention: false, on: true });
    expect(dailyBriefSectionState(loaded(brief({ available: false, enabled: true })))).toEqual({ text: "Unavailable", attention: false, on: false });
  });
  it("needs action when an allowed source cannot be used", () => {
    const reported = brief({ enabled: true, includeHevy: true, connectorSources: { outlookCalendar: false, icloudCalendar: false, hevy: true },
      connectorAttention: { outlookCalendar: null, icloudCalendar: null, hevy: "changed" } });
    expect(dailyBriefSectionState(loaded(reported))).toEqual({ text: "On · A source needs your choice", attention: true, on: true });
    // An older server reports no reason: an allowed source it no longer offers needs action.
    const older = brief({ enabled: true, includeOutlookCalendar: true, connectorSources: { outlookCalendar: false, icloudCalendar: false, hevy: false } });
    expect(dailyBriefSectionState(loaded(older)).attention).toBe(true);
  });
  it("counts the sources one choice covers and never needs a new choice (Ticket 306)", () => {
    const status = { googleCalendar: "ready", outlookCalendar: "no_calendars", icloudCalendar: "ready", hevy: "ready" } as const;
    const none = { googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false };
    expect(dailyBriefSectionState(loaded(brief({ enabled: true, useConnectedSources: true, excludedSources: { ...none, hevy: true }, sourceStatus: status }))))
      .toEqual({ text: "On · Plans around 2 sources", attention: false, on: true });
    expect(dailyBriefSectionState(loaded(brief({ enabled: true, useConnectedSources: false, excludedSources: none, sourceStatus: status }))))
      .toEqual({ text: "On", attention: false, on: true });
    expect(dailyBriefSectionState(loaded(brief({ enabled: false, useConnectedSources: true, excludedSources: none, sourceStatus: status }))))
      .toEqual({ text: "Off", attention: false, on: false });
  });
  it("ignores attention on a source that is not allowed", () => {
    const settings = brief({ enabled: true, includeHevy: false, connectorSources: { outlookCalendar: false, icloudCalendar: false, hevy: true },
      connectorAttention: { outlookCalendar: null, icloudCalendar: null, hevy: "changed" } });
    expect(dailyBriefSectionState(loaded(settings))).toEqual({ text: "On", attention: false, on: true });
  });
});

describe("categoriesSectionState", () => {
  it("counts categories", () => {
    expect(categoriesSectionState(0)).toEqual({ text: "No categories", attention: false, on: false });
    expect(categoriesSectionState(1)).toEqual({ text: "1 category", attention: false, on: true });
    expect(categoriesSectionState(8)).toEqual({ text: "8 categories", attention: false, on: true });
  });
  it("keeps the checking state distinct", () => {
    expect(SETTINGS_SECTION_CHECKING.text).toBe("Checking…");
  });
});
