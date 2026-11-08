// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_TRAVEL_HABITS } from "@cadence/core/services/travel-habits";
import type { TravelSettings } from "@cadence/core/types/travel";
import type { DepartureSnapshot } from "@/components/timeline/DayProgressTimeline";
import { notifyTravelSettingsChanged } from "@/lib/ui/travel-settings";
import { reconcileLeaveReminders, type LeaveReminderReconcileInput } from "../apps/desktop/src/local-leave-reminder.service";
import { readLocalTravelSettings } from "../apps/desktop/src/local-travel-settings.service";
import { useDesktopLeaveReminders } from "../apps/desktop/src/use-leave-reminders";

vi.mock("../apps/desktop/src/local-leave-reminder.service", () => ({ reconcileLeaveReminders: vi.fn(async () => undefined) }));
vi.mock("../apps/desktop/src/local-travel-settings.service", () => ({ readLocalTravelSettings: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settings = (overrides: Partial<TravelSettings> = {}): TravelSettings => ({
  enabled: true, baseLocationText: "10 Home Road", mode: "walking", navigationPreference: null,
  routingConsentAt: "2026-11-01T12:00:00Z", onboardingCompletedAt: null, updatedAt: "2026-11-01T12:00:00Z",
  habits: { ...EMPTY_TRAVEL_HABITS, preparationMinutes: 10 }, ...overrides,
});
const snapshot: DepartureSnapshot = { localDate: "2026-11-10", preparationSeconds: 600, trips: [], stops: [] };
const client = { load: vi.fn(async () => ({ enabled: true })), save: vi.fn() };
const refreshSources = vi.fn();

let root: Root;
const probe: { onDeparture: ((next: DepartureSnapshot) => void) | null } = { onDeparture: null };

function Probe() {
  const hook = useDesktopLeaveReminders({ native: true, accountKnown: true, accountId: "acct", timezone: "America/New_York",
    client: client as never, refreshSources });
  useEffect(() => { probe.onDeparture = hook.onDeparture; }, [hook.onDeparture]);
  return null;
}

const lastInput = () => vi.mocked(reconcileLeaveReminders).mock.calls.at(-1)![0] as LeaveReminderReconcileInput;

describe("Mac leave reminders follow saved travel settings (Codex review, Ticket 280)", () => {
  beforeEach(async () => {
    vi.mocked(reconcileLeaveReminders).mockClear();
    vi.mocked(readLocalTravelSettings).mockResolvedValue(settings());
    root = createRoot(document.createElement("div"));
    await act(async () => { root.render(<Probe />); });
    await act(async () => { probe.onDeparture!(snapshot); });
  });
  afterEach(() => { act(() => root.unmount()); });

  it("reconciles at once when Travel estimates is turned off in Settings, with the Timeline closed", async () => {
    const before = vi.mocked(reconcileLeaveReminders).mock.calls.length;
    vi.mocked(readLocalTravelSettings).mockResolvedValue(settings({ enabled: false }));
    await act(async () => { notifyTravelSettingsChanged(); });
    expect(vi.mocked(reconcileLeaveReminders).mock.calls.length).toBe(before + 1);
    await expect(lastInput().loadEnabled!()).resolves.toBe(false);
  });

  it("uses the saved get-ready time, so a change in Settings moves the fire time", async () => {
    vi.mocked(readLocalTravelSettings).mockResolvedValue(settings({ habits: { ...EMPTY_TRAVEL_HABITS, preparationMinutes: 60 } }));
    await act(async () => { notifyTravelSettingsChanged(); });
    expect(lastInput().departure?.preparationSeconds).toBe(3600);
  });

  it("stops listening once unmounted", async () => {
    act(() => root.unmount());
    const before = vi.mocked(reconcileLeaveReminders).mock.calls.length;
    await act(async () => { notifyTravelSettingsChanged(); });
    expect(vi.mocked(reconcileLeaveReminders).mock.calls.length).toBe(before);
    root = createRoot(document.createElement("div"));
  });
});

describe("a routed trip to an event this Mac does not list yet (follow-up after 0.1.9)", () => {
  const future = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  const trip = (destinationRef: string) => ({ key: `outbound|${destinationRef}`, legId: "leg", role: "outbound", originRef: null, destinationRef,
    mode: "walking", fromHome: true, state: "upcoming", lateBasis: null, freshness: "current", checkedAt: future(-1), leaveAt: future(30),
    arriveAt: future(45), getReadyAt: future(20), minutesUntilLeave: 30, appearsAt: null, timeUnknownCause: null, blockingRef: null,
    blockingLabel: null, action: null, phrase: "", linePhrase: "" }) as NonNullable<DepartureSnapshot["trips"]>[number];
  const stop = { ref: "event-known", label: "Known", startAt: future(60), endAt: future(90) };
  beforeEach(async () => {
    refreshSources.mockClear();
    vi.mocked(readLocalTravelSettings).mockResolvedValue(settings());
    root = createRoot(document.createElement("div"));
    await act(async () => { root.render(<Probe />); });
  });
  afterEach(() => { act(() => root.unmount()); });

  it("refreshes the Calendar lists once, so the reminder is planned when the event arrives", async () => {
    const missing = { ...snapshot, trips: [trip("event-known"), trip("event-new")], stops: [stop] };
    await act(async () => { probe.onDeparture!(missing); });
    expect(refreshSources).toHaveBeenCalledTimes(1);
    // The same gap, seen again each minute, asks nothing more.
    await act(async () => { probe.onDeparture!({ ...missing, stops: [{ ...stop }] }); });
    expect(refreshSources).toHaveBeenCalledTimes(1);
    // The list caught up: the trip's stop is known and the reminder plans from it.
    const caught = { ...missing, stops: [stop, { ...stop, ref: "event-new", label: "New" }] };
    await act(async () => { probe.onDeparture!(caught); });
    expect(refreshSources).toHaveBeenCalledTimes(1);
    expect(lastInput().departure?.stops.map((item) => item.ref)).toEqual(["event-known", "event-new"]);
  });

  it("asks nothing when every routed trip's stop is listed", async () => {
    await act(async () => { probe.onDeparture!({ ...snapshot, trips: [trip("event-known")], stops: [stop] }); });
    expect(refreshSources).not.toHaveBeenCalled();
  });
});
