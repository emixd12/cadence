import { readFileSync } from "node:fs";
import vm from "node:vm";

import * as webPush from "web-push";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { leaveReminderTripDigest } from "@cadence/core/services/leave-reminder-plan";
import { getProfileTimezone } from "@/lib/db/behaviors.repo";
import { deactivatePushSubscriptionById, listActivePushSubscriptionsForUser } from "@/lib/db/pushSubscriptions.repo";
import type { LeaveReminderCaller } from "@/lib/integrations/leave-reminder-caller";
import { createLeaveReminderDelivery, type LeaveReminderMessage } from "@/lib/services/leave-reminder-delivery";
import { createLeaveReminderWebPushDelivery, leaveReminderPushPayload } from "@/lib/services/leave-reminder-web-push";
import { BrowserPushSubscriptionExpiredError, createWebPushReminderSender } from "@/lib/services/web-push.service";
import { leaveReminderLinkTarget, leaveReminderTimelineUrl, parseLeaveReminderDigest } from "@/lib/ui/leave-reminder-link";
import type { PushSubscription } from "@/lib/types/database";

vi.mock("web-push", () => ({
  sendNotification: vi.fn(),
  WebPushError: class WebPushError extends Error {},
}));
vi.mock("@/lib/db/pushSubscriptions.repo", () => ({
  listActivePushSubscriptionsForUser: vi.fn(),
  deactivatePushSubscriptionById: vi.fn(),
}));
vi.mock("@/lib/db/behaviors.repo", () => ({ getProfileTimezone: vi.fn() }));

const NOW = new Date("2026-11-10T17:50:00Z");
const DIGEST = leaveReminderTripDigest("calendar", "event-dentist", "2026-11-10T19:30:00Z");
const caller = { client: {} as LeaveReminderCaller["client"], userId: "user-1", tokenExpiresAt: new Date("2026-11-10T17:55:00Z") };

function message(overrides: Partial<LeaveReminderMessage> = {}): LeaveReminderMessage {
  return {
    kind: "reminder", tripDigest: DIGEST, localDate: "2026-11-10",
    // 1:15 PM to 2:20 PM in New York.
    leaveAt: "2026-11-10T18:15:00Z", arriveAt: "2026-11-10T19:20:00Z", startAt: "2026-11-10T19:30:00Z", expiresAt: "2026-11-10T18:15:00Z",
    mode: "walking", travelMinutes: 65, origin: { kind: "home" }, title: "Dentist", ...overrides,
  };
}

function subscription(id: string): PushSubscription {
  return { id, user_id: "user-1", endpoint: `https://push.example/${id}`, p256dh: "p", auth: "a", active: true, user_agent: null,
    created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" } as PushSubscription;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProfileTimezone).mockResolvedValue("America/New_York");
  vi.mocked(listActivePushSubscriptionsForUser).mockResolvedValue([subscription("one"), subscription("two")]);
  vi.mocked(deactivatePushSubscriptionById).mockResolvedValue();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("leave reminder notification text and link", () => {
  it("names the leave time, the event, the mode, the route time, the start and the arrival", () => {
    const payload = leaveReminderPushPayload(message(), "America/New_York", undefined);
    expect(payload.title).toBe("Leave by 1:15 PM for Dentist");
    expect(payload.body).toBe("Walking, 65 min from Home. Arrive 2:20 PM.");
    expect(payload.tag).toBe(`cadence-leave-${DIGEST}`);
    expect(payload.renotify).toBeUndefined();
    expect(leaveReminderPushPayload(message({ origin: { kind: "previous_stop", title: "Gym" }, mode: "transit", travelMinutes: 20 }), "America/New_York", undefined).body)
      .toBe("Transit, 20 min from Gym. Arrive 2:20 PM.");
  });

  it("names the new, earlier leave time in the one update, which replaces the first and alerts again", () => {
    const payload = leaveReminderPushPayload(message({ kind: "update", leaveAt: "2026-11-10T18:00:00Z" }), "America/New_York", undefined);
    expect(payload.title).toBe("Leave earlier: by 1:00 PM for Dentist");
    expect(payload.tag).toBe(`cadence-leave-${DIGEST}`);
    expect(payload.renotify).toBe(true);
  });

  it("puts the digest in the link, never a title or place", () => {
    const payload = leaveReminderPushPayload(message({ title: "Dentist at Main St", origin: { kind: "previous_stop", title: "Gym" } }),
      "America/New_York", "https://cadence.example");
    expect(payload.url).toBe(`https://cadence.example/timeline?leave=${DIGEST}`);
    expect(payload.url).not.toMatch(/Dentist|Main|Gym/);
    expect(leaveReminderTimelineUrl(DIGEST, undefined)).toBe(`/timeline?leave=${DIGEST}`);
    expect(() => leaveReminderTimelineUrl("Dentist", undefined)).toThrow();
  });

  it("reads only a well-formed digest from the Timeline link and matches it to the event at the same start", () => {
    expect(parseLeaveReminderDigest(DIGEST)).toBe(DIGEST);
    expect(parseLeaveReminderDigest([DIGEST, "other"])).toBe(DIGEST);
    expect(parseLeaveReminderDigest("Dentist")).toBeNull();
    expect(parseLeaveReminderDigest(DIGEST.toUpperCase())).toBeNull();
    const event = { id: "event-dentist", kind: "timed", startAt: "2026-11-10T19:30:00Z" };
    const occurrences = [{ id: "occurrence-1", scheduledFor: "2026-11-10T15:00:00Z" }];
    expect(leaveReminderLinkTarget(DIGEST, { events: [event], occurrences })).toEqual({ kind: "event", event });
    expect(leaveReminderLinkTarget(DIGEST, { events: [{ ...event, startAt: "2026-11-10T20:00:00Z" }], occurrences })).toBeNull();
    expect(leaveReminderLinkTarget(leaveReminderTripDigest("behavior", "occurrence-1", "2026-11-10T15:00:00Z"), { events: [event], occurrences }))
      .toEqual({ kind: "occurrence", occurrenceId: "occurrence-1" });
  });
});

describe("leave reminder web push delivery", () => {
  it("sends at high urgency and expires when the trip starts", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const deliver = createLeaveReminderWebPushDelivery({ sendBrowserPush: send, now: () => NOW });
    await expect(deliver(caller, message())).resolves.toEqual({ status: "sent" });
    expect(listActivePushSubscriptionsForUser).toHaveBeenCalledWith(caller.client, "user-1");
    expect(send).toHaveBeenCalledTimes(2);
    // 17:50 to 18:15 is 25 minutes.
    expect(send.mock.calls[0]?.[1]).toMatchObject({ ttlSeconds: 1500, urgency: "high" });
    expect(send.mock.calls[0]?.[0].payload.title).toBe("Leave by 1:15 PM for Dentist");
  });

  it("fails with no_subscription when the account has no active subscription", async () => {
    vi.mocked(listActivePushSubscriptionsForUser).mockResolvedValue([]);
    const send = vi.fn();
    const deliver = createLeaveReminderWebPushDelivery({ sendBrowserPush: send, now: () => NOW });
    await expect(deliver(caller, message())).resolves.toEqual({ status: "failed", error: "no_subscription" });
    expect(send).not.toHaveBeenCalled();
  });

  it("counts a send to any device and deactivates a subscription the push service reports gone", async () => {
    const send = vi.fn().mockRejectedValueOnce(new BrowserPushSubscriptionExpiredError("gone")).mockResolvedValueOnce(undefined);
    const deliver = createLeaveReminderWebPushDelivery({ sendBrowserPush: send, now: () => NOW });
    await expect(deliver(caller, message())).resolves.toEqual({ status: "sent" });
    expect(deactivatePushSubscriptionById).toHaveBeenCalledWith(caller.client, { userId: "user-1", subscriptionId: "one" });
  });

  it("fails with delivery_failed when every send fails, without logging the message", async () => {
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    vi.mocked(deactivatePushSubscriptionById).mockRejectedValue(new Error("offline"));
    const send = vi.fn().mockRejectedValueOnce(new BrowserPushSubscriptionExpiredError("gone")).mockRejectedValueOnce(new Error("503"));
    const deliver = createLeaveReminderWebPushDelivery({ sendBrowserPush: send, now: () => NOW });
    await expect(deliver(caller, message())).resolves.toEqual({ status: "failed", error: "delivery_failed" });
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => spy.mockRestore());
  });

  it("sends nothing once the trip has started", async () => {
    const send = vi.fn();
    const deliver = createLeaveReminderWebPushDelivery({ sendBrowserPush: send, now: () => new Date("2026-11-10T18:15:00Z") });
    await expect(deliver(caller, message())).resolves.toEqual({ status: "failed", error: "delivery_failed" });
    expect(send).not.toHaveBeenCalled();
    expect(listActivePushSubscriptionsForUser).not.toHaveBeenCalled();
  });

  it("is unavailable until browser push sending is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(createLeaveReminderDelivery()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private");
    expect(createLeaveReminderDelivery()).toBeTypeOf("function");
  });
});

describe("web push sender options", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private");
    vi.mocked(webPush.sendNotification).mockResolvedValue({} as never);
  });

  const input = { endpoint: "https://push.example/one", p256dh: "p", auth: "a", payload: { title: "T", body: "B", tag: "t", url: "/timeline" } };

  it("keeps Behavior reminders at a 24-hour lifetime and normal urgency", async () => {
    await createWebPushReminderSender()(input);
    expect(vi.mocked(webPush.sendNotification).mock.calls[0]?.[2]).toMatchObject({ TTL: 86_400, urgency: "normal" });
  });

  it("passes a leave reminder's lifetime and urgency", async () => {
    await createWebPushReminderSender()(input, { ttlSeconds: 1500, urgency: "high" });
    expect(vi.mocked(webPush.sendNotification).mock.calls[0]?.[2]).toMatchObject({ TTL: 1500, urgency: "high" });
  });
});

describe("push service worker, leave reminders", () => {
  function showNotification(payload: Record<string, unknown>) {
    const listeners = new Map<string, (event: unknown) => void>();
    const show = vi.fn().mockResolvedValue(undefined);
    vm.runInNewContext(readFileSync("public/push-service-worker.js", "utf8"), {
      self: { addEventListener: (name: string, handler: (event: unknown) => void) => listeners.set(name, handler),
        registration: { showNotification: show }, location: { origin: "https://cadence.example" }, clients: {} },
      URL,
    });
    listeners.get("push")?.({ data: { json: () => payload, text: () => "" }, waitUntil: vi.fn() });
    return show.mock.calls[0] as [string, Record<string, unknown>];
  }

  it("alerts again only for a leave reminder's update", () => {
    const [title, options] = showNotification({ title: "Leave earlier: by 1:00 PM for Dentist", body: "B", tag: `cadence-leave-${DIGEST}`,
      url: `/timeline?leave=${DIGEST}`, renotify: true });
    expect(title).toBe("Leave earlier: by 1:00 PM for Dentist");
    expect(options).toMatchObject({ tag: `cadence-leave-${DIGEST}`, renotify: true, data: { url: `/timeline?leave=${DIGEST}` } });
  });

  async function click(tabUrl: string, url: string) {
    const listeners = new Map<string, (event: unknown) => void>();
    const navigate = vi.fn().mockResolvedValue(null);
    const focus = vi.fn();
    vm.runInNewContext(readFileSync("public/push-service-worker.js", "utf8"), {
      self: { addEventListener: (name: string, handler: (event: unknown) => void) => listeners.set(name, handler),
        registration: { showNotification: vi.fn() }, location: { origin: "https://cadence.example" },
        clients: { matchAll: vi.fn().mockResolvedValue([{ url: tabUrl, navigate, focus }]), openWindow: vi.fn() } },
      URL,
    });
    const waitUntil = vi.fn();
    listeners.get("notificationclick")?.({ notification: { close: vi.fn(), data: { url } }, waitUntil });
    await waitUntil.mock.calls[0]?.[0];
    return { navigate, focus };
  }

  it("reloads a tab already at the same leave link, so the drawer opens again", async () => {
    const link = `https://cadence.example/timeline?leave=${DIGEST}`;
    const { navigate, focus } = await click(link, `/timeline?leave=${DIGEST}`);
    expect(navigate).toHaveBeenCalledWith(link);
    expect(focus).toHaveBeenCalledTimes(1);
    const behavior = await click("https://cadence.example/timeline", "/timeline");
    expect(behavior.navigate).not.toHaveBeenCalled();
    expect(behavior.focus).toHaveBeenCalledTimes(1);
  });

  it("leaves Behavior reminder options unchanged", () => {
    const [, options] = showNotification({ title: "Morning walk", body: "Scheduled for 9:00 AM.", tag: "cadence-reminder-1", url: "/timeline" });
    expect(options).not.toHaveProperty("renotify");
    expect(Object.keys(options).sort()).toEqual(["badge", "body", "data", "icon", "tag"]);
  });
});
