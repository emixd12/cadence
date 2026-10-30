import { describe, expect, it, vi } from "vitest";
import { planTravelSettingsSave } from "@cadence/core/services/travel-settings";
import { readTravelRouteSource, saveTravelHabits, TravelSettingsError } from "@/lib/services/travel-settings.service";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";

import { saveLocalTravelHabits, saveLocalTravelSettings } from "../apps/desktop/src/local-travel-settings.service";
import { Temporal } from "@js-temporal/polyfill";
const local = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../apps/desktop/src/local-store", () => ({ localCommand: local.command, localMutation: (profileId: string, now: string) => ({ profileId, now, mutationId: "mutation" }) }));

const current = {
  enabled: false,
  baseLocationText: null,
  mode: null,
  navigationPreference: null,
  routingConsentAt: null,
  onboardingCompletedAt: null,
  updatedAt: "2026-09-22T01:00:00Z",
} as const;

describe("travel settings persistence", () => {
  it("keeps the stored native timestamp for CAS after normalizing display revisions", async () => {
    local.command.mockResolvedValueOnce({ id: "profile" }).mockResolvedValueOnce(current)
      .mockImplementationOnce(async (_operation, input) => input.next);
    await saveLocalTravelSettings({ enabled: false, baseLocationText: null, mode: null, navigationPreference: null,
      expectedUpdatedAt: "2026-09-22T01:00:00.000000Z", acceptRoutingDisclosure: false }, Temporal.Instant.from("2026-09-22T01:01:00Z"));
    expect(local.command).toHaveBeenLastCalledWith("commitTravelSettings", expect.objectContaining({
      expectedUpdatedAt: "2026-09-22T01:00:00Z",
      next: expect.objectContaining({ updatedAt: "2026-09-22T01:01:00.000000Z" }),
    }));
  });
  it("requires explicit consent to enable and clears consent when disabled", () => {
    expect(() => planTravelSettingsSave(current, {
      enabled: true, baseLocationText: "1 Main St", mode: "walking", navigationPreference: "apple_maps",
      expectedUpdatedAt: current.updatedAt, acceptRoutingDisclosure: false,
    }, "2026-09-22T01:01:00Z")).toThrow("Accept the routing disclosure");

    const enabled = planTravelSettingsSave(current, {
      enabled: true, baseLocationText: " 1 Main St ", mode: "walking", navigationPreference: "apple_maps",
      expectedUpdatedAt: current.updatedAt, acceptRoutingDisclosure: true,
    }, "2026-09-22T01:01:00Z");
    expect(enabled).toMatchObject({ enabled: true, baseLocationText: "1 Main St", routingConsentAt: "2026-09-22T01:01:00Z" });

    expect(planTravelSettingsSave(enabled, {
      enabled: false, baseLocationText: "1 Main St", mode: "walking", navigationPreference: "apple_maps",
      expectedUpdatedAt: enabled.updatedAt, acceptRoutingDisclosure: false,
    }, "2026-09-22T01:02:00Z").routingConsentAt).toBeNull();
  });

  it("rejects stale writes and control characters", () => {
    expect(() => planTravelSettingsSave(current, {
      enabled: false, baseLocationText: "Home\nsecret", mode: null, navigationPreference: null,
      expectedUpdatedAt: current.updatedAt, acceptRoutingDisclosure: false,
    }, "2026-09-22T01:01:00Z")).toThrow("control characters");
    expect(() => planTravelSettingsSave(current, {
      enabled: false, baseLocationText: null, mode: null, navigationPreference: null,
      expectedUpdatedAt: "2026-09-22T00:00:00Z", acceptRoutingDisclosure: false,
    }, "2026-09-22T01:01:00Z")).toThrow("changed after");
  });

  it("reads only owner-authored route source fields and revisions", async () => {
    const rows = {
      travel_settings: { data: [{ enabled: true, base_location_text: "Base", mode: "driving", navigation_preference: "google_maps",
        routing_consent_at: "2026-09-22T01:00:00+00:00", onboarding_completed_at: "2026-09-22T01:00:00+00:00", updated_at: "2026-09-22T01:00:00+00:00" }], error: null },
      behaviors: { data: [
        { id: "behavior", where_kind: "place", location_text: "Library", updated_at: "2026-09-22T01:02:00Z" },
        { id: "home-behavior", where_kind: "home", location_text: null, updated_at: "2026-09-22T01:02:00Z" },
      ], error: null },
    };
    const client = { from(table: keyof typeof rows) {
      const result = rows[table];
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, not: () => chain, order: async () => result,
        maybeSingle: async () => ({ data: result.data[0] ?? null, error: result.error }),
      };
      return chain;
    } };
    await expect(readTravelRouteSource(client as never, "owner")).resolves.toEqual({
      settings: { enabled: true, baseLocationText: "Base", mode: "driving", navigationPreference: "google_maps",
        routingConsentAt: "2026-09-22T01:00:00.000000Z", onboardingCompletedAt: "2026-09-22T01:00:00.000000Z", updatedAt: "2026-09-22T01:00:00.000000Z",
        habits: { preparationMinutes: null, arrivalBufferMinutes: null, placeModes: [], leaveFeedback: [], updatedAt: null } },
      settingsRevision: "2026-09-22T01:00:00.000000Z",
      habitsRevision: null,
      behaviors: [
        { id: "behavior", whereKind: "place", locationText: "Library", updatedAt: "2026-09-22T01:02:00.000000Z" },
        { id: "home-behavior", whereKind: "home", locationText: null, updatedAt: "2026-09-22T01:02:00.000000Z" },
      ],
    });
  });

  it("keeps learned habits out of the desktop settings commit and plans habit writes against their own revision", async () => {
    const stored = { ...current, habits: { preparationMinutes: null, arrivalBufferMinutes: null, placeModes: [], leaveFeedback: [], updatedAt: null } };
    local.command.mockReset();
    local.command.mockResolvedValueOnce({ id: "profile" }).mockResolvedValueOnce(stored)
      .mockImplementationOnce(async (_operation, input) => ({ ...stored, ...input.next }));
    await saveLocalTravelSettings({ enabled: false, baseLocationText: "Home", mode: null, navigationPreference: null,
      expectedUpdatedAt: "2026-09-22T01:00:00.000000Z", acceptRoutingDisclosure: false }, Temporal.Instant.from("2026-09-22T01:01:00Z"));
    expect(local.command.mock.calls.at(-1)![1].next).not.toHaveProperty("habits");

    const gym = travelPlaceKey("1 Gym Street");
    local.command.mockResolvedValueOnce({ id: "profile" }).mockResolvedValueOnce(stored)
      .mockImplementationOnce(async (_operation, input) => ({ ...stored, habits: input.next }));
    const saved = await saveLocalTravelHabits({ expectedUpdatedAt: null, change: { kind: "place_mode", placeKey: gym, mode: "transit" } },
      Temporal.Instant.from("2026-09-22T01:02:00Z"));
    expect(local.command).toHaveBeenLastCalledWith("commitTravelHabits", expect.objectContaining({
      expectedUpdatedAt: null,
      next: { preparationMinutes: null, arrivalBufferMinutes: null, leaveFeedback: [], updatedAt: "2026-09-22T01:02:00.000000Z",
        placeModes: [{ placeKey: gym, mode: "transit", chosenAt: "2026-09-22T01:02:00.000000Z" }] },
    }));
    expect(saved.habits?.placeModes).toHaveLength(1);
  });

  it("saves one web habit change with a habit-revision compare and reports conflicts", async () => {
    const row = { enabled: false, base_location_text: null, mode: null, navigation_preference: null, routing_consent_at: null,
      onboarding_completed_at: null, updated_at: "2026-09-22T01:00:00+00:00", preparation_minutes: null, arrival_buffer_minutes: null,
      place_modes: [], leave_feedback: [], habits_updated_at: null };
    const calls: { update?: Record<string, unknown>; filters: string[] } = { filters: [] };
    let updated: Record<string, unknown> | null = null;
    const client = { from() {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (column: string) => { calls.filters.push(`eq:${column}`); return chain; },
        is: (column: string, value: unknown) => { calls.filters.push(`is:${column}:${String(value)}`); return chain; },
        update: (value: Record<string, unknown>) => { calls.update = value; updated = { ...row, ...value }; return chain; },
        maybeSingle: async () => ({ data: calls.update ? updated : row, error: null }),
      };
      return chain;
    } };
    const caller = { client, user: { id: "owner" } } as never;
    const saved = await saveTravelHabits(caller, { expectedUpdatedAt: null, change: { kind: "preparation", minutes: 15 } }, "2026-09-22T01:03:00Z");
    expect(saved.habits).toMatchObject({ preparationMinutes: 15, updatedAt: "2026-09-22T01:03:00.000000Z" });
    expect(calls.update).toEqual({ preparation_minutes: 15, arrival_buffer_minutes: null, place_modes: [], leave_feedback: [],
      habits_updated_at: "2026-09-22T01:03:00.000000Z" });
    expect(calls.filters).toContain("is:habits_updated_at:null");
    expect(calls.update).not.toHaveProperty("updated_at");

    await expect(saveTravelHabits(caller, { expectedUpdatedAt: "2026-09-22T00:00:00.000000Z", change: { kind: "preparation", minutes: 5 } }))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(saveTravelHabits(caller, { expectedUpdatedAt: null, change: { kind: "preparation", minutes: 15 }, userId: "other" }))
      .rejects.toBeInstanceOf(TravelSettingsError);
  });
});
