import { describe, expect, it } from "vitest";

import { readTravelSetupPresence } from "@/lib/db/travelSettings.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import {
  FIRST_RUN_TRAVEL_DESCRIPTION,
  resolveFirstRunOnboardingModel,
} from "@/lib/services/onboarding-model";
import {
  createFirstRunOnboardingState,
  readFirstRunTravelSetup,
} from "@/lib/services/onboarding.service";
import type {
  FirstRunOnboardingClientSnapshot,
  FirstRunOnboardingState,
} from "@/lib/types/onboarding";

const BASE_STATE = {
  hasAnyBehavior: false,
  hasImportRuns: false,
  timezone: "America/New_York",
  vapidPublicKey: "public-key",
  travel: { hasHome: false, hasMode: false },
} satisfies FirstRunOnboardingState;

const BASE_CLIENT = {
  dismissed: false,
  notificationPermission: "default",
  notificationSupported: true,
  notificationSubscriptionStatus: "missing",
  browserTimezone: "America/New_York",
  travelRoutingConfigured: null,
} satisfies FirstRunOnboardingClientSnapshot;

describe("resolveFirstRunOnboardingModel", () => {
  it("shows setup while required first-run items remain incomplete", () => {
    const model = resolveFirstRunOnboardingModel(BASE_STATE, BASE_CLIENT);

    expect(model.shouldRender).toBe(true);
    expect(model.requiredComplete).toBe(false);
    expect(model.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "behavior",
          complete: false,
          statusLabel: "Start here",
          href: "/behaviors#create-behavior",
        }),
        expect.objectContaining({
          key: "notifications",
          complete: false,
          statusLabel: "Not enabled",
          href: "/settings#notifications",
        }),
        expect.objectContaining({
          key: "timezone",
          complete: true,
          statusLabel: "Confirmed",
          href: "/settings#timezone",
        }),
        expect.objectContaining({
          key: "import",
          complete: false,
          optional: true,
          statusLabel: "Optional",
          href: "/export#behaviorlog-import",
        }),
      ]),
    );
  });

  it("hides setup after required items are complete even when import is unused", () => {
    const model = resolveFirstRunOnboardingModel(
      {
        ...BASE_STATE,
        hasAnyBehavior: true,
      },
      {
        ...BASE_CLIENT,
        notificationPermission: "granted",
        notificationSubscriptionStatus: "saved",
      },
    );

    expect(model.requiredComplete).toBe(true);
    expect(model.shouldRender).toBe(false);
  });

  it("keeps setup visible on a new device without a saved subscription", () => {
    const model = resolveFirstRunOnboardingModel(
      {
        ...BASE_STATE,
        hasAnyBehavior: true,
      },
      {
        ...BASE_CLIENT,
        notificationPermission: "granted",
        notificationSubscriptionStatus: "missing",
      },
    );
    const notifications = model.items.find(
      (item) => item.key === "notifications",
    );

    expect(notifications).toMatchObject({
      complete: false,
      statusLabel: "Not enabled",
    });
    expect(model.requiredComplete).toBe(false);
    expect(model.shouldRender).toBe(true);
  });

  it("treats unavailable browser push as non-blocking", () => {
    const model = resolveFirstRunOnboardingModel(BASE_STATE, {
      ...BASE_CLIENT,
      notificationPermission: "unavailable",
      notificationSupported: false,
    });
    const notifications = model.items.find(
      (item) => item.key === "notifications",
    );

    expect(notifications).toMatchObject({
      complete: true,
      statusLabel: "Unavailable",
    });
  });

  it("treats blocked browser permission as a completed onboarding decision", () => {
    const model = resolveFirstRunOnboardingModel(
      {
        ...BASE_STATE,
        hasAnyBehavior: true,
      },
      {
        ...BASE_CLIENT,
        notificationPermission: "denied",
      },
    );
    const notifications = model.items.find(
      (item) => item.key === "notifications",
    );

    expect(notifications).toMatchObject({
      complete: true,
      statusLabel: "Blocked",
    });
    expect(model.requiredComplete).toBe(true);
    expect(model.shouldRender).toBe(false);
  });

  it("asks for timezone review when browser and saved timezones differ", () => {
    const model = resolveFirstRunOnboardingModel(BASE_STATE, {
      ...BASE_CLIENT,
      browserTimezone: "America/Los_Angeles",
    });
    const timezone = model.items.find((item) => item.key === "timezone");

    expect(timezone).toMatchObject({
      complete: false,
      statusLabel: "Review",
    });
  });

  it("respects local dismissal", () => {
    const model = resolveFirstRunOnboardingModel(BASE_STATE, {
      ...BASE_CLIENT,
      dismissed: true,
    });

    expect(model.shouldRender).toBe(false);
  });
});

describe("Home and travel setup item (Ticket 212)", () => {
  const ROUTING = { ...BASE_CLIENT, travelRoutingConfigured: true };

  it("is optional, routes to the Travel settings anchor and states its purpose", () => {
    const model = resolveFirstRunOnboardingModel(BASE_STATE, ROUTING);
    const travel = model.items.find((item) => item.key === "travel");

    expect(travel).toEqual({
      key: "travel",
      label: "Home and travel",
      statusLabel: "Optional",
      href: "/settings#travel",
      actionLabel: "Open travel",
      complete: false,
      optional: true,
      description: FIRST_RUN_TRAVEL_DESCRIPTION,
    });
    expect(FIRST_RUN_TRAVEL_DESCRIPTION).toBe(
      "Cadence uses these to estimate travel time to and from located Behaviors and Calendar events.",
    );
    expect(model.items.at(-1)?.key).toBe("travel");
  });

  it.each([
    ["routing is not configured", BASE_STATE, { ...BASE_CLIENT, travelRoutingConfigured: false }],
    ["the routing report is unknown", BASE_STATE, BASE_CLIENT],
    ["travel presence could not be read", { ...BASE_STATE, travel: null }, ROUTING],
  ])("is hidden when %s", (_case, state, client) => {
    const model = resolveFirstRunOnboardingModel(state, client);

    expect(model.items.map((item) => item.key)).toEqual([
      "behavior",
      "notifications",
      "timezone",
      "import",
    ]);
  });

  it.each([
    [false, false, false, "Optional"],
    [true, false, false, "Optional"],
    [false, true, false, "Optional"],
    [true, true, true, "Saved"],
  ])("with Home %s and usual travel %s is complete only when both exist", (hasHome, hasMode, complete, statusLabel) => {
    const model = resolveFirstRunOnboardingModel(
      { ...BASE_STATE, travel: { hasHome, hasMode } },
      ROUTING,
    );

    expect(model.items.find((item) => item.key === "travel")).toMatchObject({
      complete,
      statusLabel,
    });
  });

  it("never blocks setup completion", () => {
    const model = resolveFirstRunOnboardingModel(
      { ...BASE_STATE, hasAnyBehavior: true },
      {
        ...ROUTING,
        notificationPermission: "granted",
        notificationSubscriptionStatus: "saved",
      },
    );

    expect(model.items.find((item) => item.key === "travel")?.complete).toBe(false);
    expect(model.requiredComplete).toBe(true);
    expect(model.shouldRender).toBe(false);
  });

  it("keeps the import hint on the import row only", () => {
    const model = resolveFirstRunOnboardingModel(BASE_STATE, ROUTING);

    expect(model.items.map((item) => [item.key, item.description])).toEqual([
      ["behavior", null],
      ["notifications", null],
      ["timezone", null],
      ["import", "Use this only if you already have a BehaviorLog bundle."],
      ["travel", FIRST_RUN_TRAVEL_DESCRIPTION],
    ]);
  });
});

describe("travel presence in the onboarding state read (Ticket 212)", () => {
  const ADDRESS = "1 Example Street, Springfield";

  function travelSettingsClient(
    result: { data: unknown; error: unknown },
    selected: string[] = [],
  ): AppSupabaseClient {
    const query = {
      select: (columns: string) => {
        selected.push(columns);
        return query;
      },
      eq: () => query,
      maybeSingle: async () => result,
    };
    return { from: () => query } as unknown as AppSupabaseClient;
  }

  it("reports presence flags without returning the Home text", async () => {
    const selected: string[] = [];
    const presence = await readTravelSetupPresence(
      travelSettingsClient(
        { data: { base_location_text: ADDRESS, mode: "transit" }, error: null },
        selected,
      ),
      "user-1",
    );

    expect(selected).toEqual(["base_location_text,mode"]);
    expect(presence).toEqual({ hasHome: true, hasMode: true });
    expect(JSON.stringify(presence)).not.toContain("Example");
  });

  it("treats a blank Home and a missing mode as absent", async () => {
    await expect(
      readTravelSetupPresence(
        travelSettingsClient({ data: { base_location_text: "  ", mode: null }, error: null }),
        "user-1",
      ),
    ).resolves.toEqual({ hasHome: false, hasMode: false });
  });

  it("hides the item instead of failing Timeline when the read fails", async () => {
    await expect(
      readFirstRunTravelSetup(
        travelSettingsClient({ data: null, error: new Error("unavailable") }),
        "user-1",
      ),
    ).resolves.toBeNull();
  });

  it("copies only the presence flags into onboarding state", () => {
    const state = createFirstRunOnboardingState({
      hasAnyBehavior: false,
      hasImportRuns: false,
      timezone: null,
      travel: { hasHome: true, hasMode: false, baseLocationText: ADDRESS } as never,
    });

    expect(state.travel).toEqual({ hasHome: true, hasMode: false });
    expect(JSON.stringify(state)).not.toContain("Example");
  });
});
