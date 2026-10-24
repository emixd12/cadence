import { describe, expect, it, vi } from "vitest";
import { planTravelSettingsSave } from "@cadence/core/services/travel-settings";
import { readTravelRouteSource } from "@/lib/services/travel-settings.service";

import { saveLocalTravelSettings } from "../apps/desktop/src/local-travel-settings.service";
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
        routingConsentAt: "2026-09-22T01:00:00.000000Z", onboardingCompletedAt: "2026-09-22T01:00:00.000000Z", updatedAt: "2026-09-22T01:00:00.000000Z" },
      settingsRevision: "2026-09-22T01:00:00.000000Z",
      behaviors: [
        { id: "behavior", whereKind: "place", locationText: "Library", updatedAt: "2026-09-22T01:02:00.000000Z" },
        { id: "home-behavior", whereKind: "home", locationText: null, updatedAt: "2026-09-22T01:02:00.000000Z" },
      ],
    });
  });
});
