import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getBehaviorById } from "@/lib/db/behaviors.repo";
import {
  getOccurrenceById,
  listBehaviorOccurrencesFrom,
} from "@/lib/db/occurrences.repo";
import { getProfileSettings } from "@/lib/db/profiles.repo";
import {
  cancelPendingReminderDeliveriesForOccurrence,
  cancelUnclaimedPendingReminderDeliveriesById,
  cancelPendingReminderDeliveryById,
  claimPendingBrowserPushReminderDelivery,
  claimPendingEmailReminderDelivery,
  createMissingReminderDeliveries,
  listReminderDeliveriesByOccurrenceIds,
  listDuePendingBrowserPushReminderDeliveries,
  listDuePendingEmailReminderDeliveries,
  markReminderDeliveryFailed,
  markReminderDeliverySent,
  reactivateCancelledReminderDeliveriesById,
} from "@/lib/db/reminderDeliveries.repo";
import {
  deactivatePushSubscriptionById,
  listActivePushSubscriptionsForUser,
} from "@/lib/db/pushSubscriptions.repo";
import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import {
  cancelReminderDeliveriesForResolvedOccurrence,
  processDueBrowserPushReminders,
  processDueEmailReminders,
  processDueReminders,
  syncReminderDeliveriesForBehaviors,
  syncReminderDeliveriesForBehavior,
} from "@/lib/services/reminder.service";
import { BrowserPushSubscriptionExpiredError } from "@/lib/services/web-push.service";
import type {
  Behavior,
  Occurrence,
  PushSubscription,
  ReminderDelivery,
} from "@/lib/types/database";

vi.mock("@/lib/db/behaviors.repo", () => ({
  getBehaviorById: vi.fn(),
}));

vi.mock("@/lib/db/occurrences.repo", () => ({
  getOccurrenceById: vi.fn(),
  listBehaviorOccurrencesFrom: vi.fn(),
}));

vi.mock("@/lib/db/profiles.repo", () => ({
  getProfileSettings: vi.fn(),
}));

vi.mock("@/lib/db/reminderDeliveries.repo", () => ({
  cancelPendingReminderDeliveryById: vi.fn(),
  cancelPendingReminderDeliveriesForOccurrence: vi.fn(),
  cancelUnclaimedPendingReminderDeliveriesById: vi.fn(),
  claimPendingBrowserPushReminderDelivery: vi.fn(),
  claimPendingEmailReminderDelivery: vi.fn(),
  createMissingReminderDeliveries: vi.fn(),
  listReminderDeliveriesByOccurrenceIds: vi.fn(),
  listDuePendingBrowserPushReminderDeliveries: vi.fn(),
  listDuePendingEmailReminderDeliveries: vi.fn(),
  markReminderDeliveryFailed: vi.fn(),
  markReminderDeliverySent: vi.fn(),
  reactivateCancelledReminderDeliveriesById: vi.fn(),
}));

vi.mock("@/lib/db/pushSubscriptions.repo", () => ({
  deactivatePushSubscriptionById: vi.fn(),
  listActivePushSubscriptionsForUser: vi.fn(),
}));

vi.mock("@/lib/monitoring/privacy-safe-events", () => ({
  reportMonitoringEvent: vi.fn(),
}));

const NOW = Temporal.Instant.from("2026-06-08T14:00:00Z");
const NOW_STRING = NOW.toString();
const RECLAIM_BEFORE_STRING = NOW.subtract({ minutes: 15 }).toString();
const PLANNING_NOW = Temporal.Instant.from("2026-06-08T11:00:00Z");
const SUPABASE = { kind: "supabase" } as never;

const BASE_DELIVERY: ReminderDelivery = {
  id: "delivery-1",
  user_id: "user-1",
  occurrence_id: "occurrence-1",
  channel: "email",
  scheduled_send_at: "2026-06-08T14:00:00Z",
  sent_at: null,
  processing_started_at: null,
  import_run_id: null,
  imported_intervention_id: null,
  status: "pending",
  error: null,
  created_at: "2026-06-08T00:00:00Z",
  updated_at: "2026-06-08T00:00:00Z",
};

const BASE_BROWSER_DELIVERY: ReminderDelivery = {
  ...BASE_DELIVERY,
  id: "browser-delivery-1",
  channel: "browser_push",
};

const BASE_PUSH_SUBSCRIPTION: PushSubscription = {
  id: "push-subscription-1",
  user_id: "user-1",
  endpoint: "https://push.example.com/subscription/1",
  p256dh: "p256dh-key",
  auth: "auth-key",
  user_agent: "Test Browser",
  active: true,
  created_at: "2026-06-08T00:00:00Z",
  updated_at: "2026-06-08T00:00:00Z",
};

const BASE_OCCURRENCE: Occurrence = {
  id: "occurrence-1",
  user_id: "user-1",
  behavior_id: "behavior-1",
  behavior_schedule_slot_id: null,
  behavior_configuration_event_id: null,
  scheduled_for: "2026-06-08T14:00:00Z",
  schedule_kind: "exact",
  schedule_preset: null,
  schedule_range_identity: -1,
  schedule_start_time: "10:00:00",
  schedule_end_time: null,
  local_date: "2026-06-08",
  status: "unresolved",
  completed_at: null,
  status_marked_at: null,
  note: null,
  created_at: "2026-06-08T00:00:00Z",
  updated_at: "2026-06-08T00:00:00Z",
};

const BASE_BEHAVIOR: Behavior = {
  id: "behavior-1",
  user_id: "user-1",
  category_id: null,
  title: "Drink water",
  description: "Morning glass",
  recurrence_rule: { type: "daily", interval: 1 },
  scheduled_time: "10:00:00",
  timezone: "America/New_York",
  browser_reminder_enabled: true,
  email_reminder_enabled: true,
  reminder_offset_minutes: 0,
  active: true,
  archive_notes: [],
  archived_at: null,
  current_configuration_event_id: "configuration-event-1",
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

describe("syncReminderDeliveriesForBehavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listReminderDeliveriesByOccurrenceIds).mockResolvedValue([]);
  });

  it("uses provided occurrences instead of re-reading them", async () => {
    await syncReminderDeliveriesForBehavior(SUPABASE, "user-1", BASE_BEHAVIOR, {
      scheduledFrom: "2026-06-08T00:00:00Z",
      occurrences: [BASE_OCCURRENCE],
      now: PLANNING_NOW,
    });

    expect(listBehaviorOccurrencesFrom).not.toHaveBeenCalled();
    expect(listReminderDeliveriesByOccurrenceIds).toHaveBeenCalledWith(
      SUPABASE,
      "user-1",
      ["occurrence-1"],
    );
    expect(createMissingReminderDeliveries).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(createMissingReminderDeliveries)
        .mock.calls[0]?.[1].map((delivery) => delivery.channel),
    ).toEqual(["browser_push", "email"]);
  });

  it("batches active reminder creation and inactive cancellation", async () => {
    const inactiveBehavior: Behavior = {
      ...BASE_BEHAVIOR,
      id: "behavior-2",
      active: false,
    };
    const inactiveOccurrence: Occurrence = {
      ...BASE_OCCURRENCE,
      id: "occurrence-2",
      behavior_id: inactiveBehavior.id,
    };
    vi.mocked(listReminderDeliveriesByOccurrenceIds).mockResolvedValue([
      {
        ...BASE_BROWSER_DELIVERY,
        id: "inactive-delivery",
        occurrence_id: inactiveOccurrence.id,
      },
    ]);

    await syncReminderDeliveriesForBehaviors(
      SUPABASE,
      "user-1",
      [
        {
          behavior: BASE_BEHAVIOR,
          occurrences: [BASE_OCCURRENCE],
        },
        {
          behavior: inactiveBehavior,
          occurrences: [inactiveOccurrence],
        },
      ],
      { now: PLANNING_NOW },
    );

    expect(createMissingReminderDeliveries).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(createMissingReminderDeliveries)
        .mock.calls[0]?.[1].map((delivery) => delivery.channel),
    ).toEqual(["browser_push", "email"]);
    expect(cancelUnclaimedPendingReminderDeliveriesById).toHaveBeenCalledWith(
      SUPABASE,
      "user-1",
      ["inactive-delivery"],
    );
  });

  it("revives a cancelled delivery when restore makes it expected again", async () => {
    vi.mocked(listReminderDeliveriesByOccurrenceIds).mockResolvedValue([
      {
        ...BASE_BROWSER_DELIVERY,
        id: "cancelled-browser",
        status: "cancelled",
      },
      {
        ...BASE_DELIVERY,
        id: "cancelled-email",
        status: "cancelled",
      },
    ]);

    await syncReminderDeliveriesForBehavior(SUPABASE, "user-1", BASE_BEHAVIOR, {
      scheduledFrom: "2026-06-08T00:00:00Z",
      occurrences: [BASE_OCCURRENCE],
      now: PLANNING_NOW,
    });

    expect(reactivateCancelledReminderDeliveriesById).toHaveBeenCalledWith(
      SUPABASE,
      "user-1",
      ["cancelled-browser", "cancelled-email"],
    );
    expect(createMissingReminderDeliveries).toHaveBeenCalledWith(SUPABASE, []);
  });

  it("cancels an obsolete offset and creates the current expected delivery", async () => {
    vi.mocked(listReminderDeliveriesByOccurrenceIds).mockResolvedValue([
      {
        ...BASE_DELIVERY,
        id: "old-email-offset",
        scheduled_send_at: "2026-06-08T12:00:00Z",
      },
    ]);

    await syncReminderDeliveriesForBehavior(
      SUPABASE,
      "user-1",
      {
        ...BASE_BEHAVIOR,
        browser_reminder_enabled: false,
        reminder_offset_minutes: 60,
      },
      {
        scheduledFrom: "2026-06-08T00:00:00Z",
        occurrences: [BASE_OCCURRENCE],
        now: PLANNING_NOW,
      },
    );

    expect(cancelUnclaimedPendingReminderDeliveriesById).toHaveBeenCalledWith(
      SUPABASE,
      "user-1",
      ["old-email-offset"],
    );
    expect(createMissingReminderDeliveries).toHaveBeenCalledWith(SUPABASE, [
      expect.objectContaining({
        occurrence_id: "occurrence-1",
        channel: "email",
        scheduled_send_at: "2026-06-08T13:00:00Z",
      }),
    ]);
  });

  it("does not recreate past coverage or cancel a due pending row", async () => {
    vi.mocked(listReminderDeliveriesByOccurrenceIds).mockResolvedValue([
      {
        ...BASE_BROWSER_DELIVERY,
        id: "past-cancelled-browser",
        status: "cancelled",
      },
      {
        ...BASE_DELIVERY,
        id: "due-obsolete-email",
        scheduled_send_at: "2026-06-08T13:30:00Z",
      },
    ]);

    await syncReminderDeliveriesForBehavior(
      SUPABASE,
      "user-1",
      {
        ...BASE_BEHAVIOR,
        email_reminder_enabled: true,
      },
      {
        scheduledFrom: "2026-06-08T00:00:00Z",
        occurrences: [BASE_OCCURRENCE],
        now: NOW,
      },
    );

    expect(reactivateCancelledReminderDeliveriesById).toHaveBeenCalledWith(
      SUPABASE,
      "user-1",
      [],
    );
    expect(cancelUnclaimedPendingReminderDeliveriesById).toHaveBeenCalledWith(
      SUPABASE,
      "user-1",
      [],
    );
    expect(createMissingReminderDeliveries).toHaveBeenCalledWith(SUPABASE, []);
  });
});

describe("cancelReminderDeliveriesForResolvedOccurrence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels pending reminder deliveries when an occurrence is resolved", async () => {
    await cancelReminderDeliveriesForResolvedOccurrence(
      SUPABASE,
      "user-1",
      {
        ...BASE_OCCURRENCE,
        status: "completed",
        completed_at: NOW_STRING,
        status_marked_at: NOW_STRING,
      },
    );

    expect(cancelPendingReminderDeliveriesForOccurrence).toHaveBeenCalledWith(
      SUPABASE,
      "user-1",
      "occurrence-1",
    );
  });

  it("leaves pending reminder deliveries alone for unresolved occurrences", async () => {
    await cancelReminderDeliveriesForResolvedOccurrence(
      SUPABASE,
      "user-1",
      BASE_OCCURRENCE,
    );

    expect(cancelPendingReminderDeliveriesForOccurrence).not.toHaveBeenCalled();
  });
});

describe("processDueEmailReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(markReminderDeliverySent).mockResolvedValue(true);

    vi.mocked(listDuePendingEmailReminderDeliveries).mockResolvedValue([
      BASE_DELIVERY,
    ]);
    vi.mocked(listDuePendingBrowserPushReminderDeliveries).mockResolvedValue([
      BASE_BROWSER_DELIVERY,
    ]);
    vi.mocked(claimPendingEmailReminderDelivery).mockResolvedValue({
      ...BASE_DELIVERY,
      processing_started_at: NOW_STRING,
    });
    vi.mocked(claimPendingBrowserPushReminderDelivery).mockResolvedValue({
      ...BASE_BROWSER_DELIVERY,
      processing_started_at: NOW_STRING,
    });
    vi.mocked(getOccurrenceById).mockResolvedValue(BASE_OCCURRENCE);
    vi.mocked(getBehaviorById).mockResolvedValue({
      ...BASE_BEHAVIOR,
      category: null,
      schedule_slots: [],
    });
    vi.mocked(getProfileSettings).mockResolvedValue({
      email: "user@example.com",
      timezone: "America/New_York",
    });
    vi.mocked(listActivePushSubscriptionsForUser).mockResolvedValue([
      BASE_PUSH_SUBSCRIPTION,
    ]);
  });

  it("cancels both channels when an active Behavior has ended", async () => {
    vi.mocked(getBehaviorById).mockResolvedValue({ ...BASE_BEHAVIOR, end_on: "2026-06-07", category: null, schedule_slots: [] });
    const sendEmail = vi.fn();
    const sendBrowserPush = vi.fn();
    await expect(processDueEmailReminders({ supabase: SUPABASE, now: NOW, limit: 1, sendEmail }))
      .resolves.toMatchObject({ cancelled: 1, sent: 0 });
    await expect(processDueBrowserPushReminders({ supabase: SUPABASE, now: NOW, limit: 1, sendBrowserPush }))
      .resolves.toMatchObject({ cancelled: 1, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendBrowserPush).not.toHaveBeenCalled();
  });

  it("claims a due email reminder before sending and marks it sent", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ jobId: "job-1" });

    await expect(
      processDueEmailReminders({
        supabase: SUPABASE,
        now: NOW,
        limit: 2,
        sendEmail,
      }),
    ).resolves.toEqual({
      checked: 1,
      claimed: 1,
      skipped: 0,
      sent: 1,
      failed: 0,
      cancelled: 0,
    });

    expect(listDuePendingEmailReminderDeliveries).toHaveBeenCalledWith(SUPABASE, {
      dueAt: NOW_STRING,
      reclaimBefore: RECLAIM_BEFORE_STRING,
      limit: 2,
    });
    expect(claimPendingEmailReminderDelivery).toHaveBeenCalledWith(SUPABASE, {
      id: "delivery-1",
      userId: "user-1",
      dueAt: NOW_STRING,
      reclaimBefore: RECLAIM_BEFORE_STRING,
      processingStartedAt: NOW_STRING,
    });
    expect(sendEmail).toHaveBeenCalledWith(
      {
        to: "user@example.com",
        subscriberExternalId: "user-1",
        variables: expect.objectContaining({
          BEHAVIOR_TITLE: "Drink water",
          OCCURRENCE_ID: "occurrence-1",
          REMINDER_SCHEDULED_SEND_AT: "2026-06-08T14:00:00Z",
          SCHEDULED_TIME: "10:00 AM",
        }),
      },
      { signal: expect.anything() },
    );
    expect(markReminderDeliverySent).toHaveBeenCalledWith(SUPABASE, {
      id: "delivery-1",
      userId: "user-1",
      sentAt: NOW_STRING,
    });
    expect(markReminderDeliveryFailed).not.toHaveBeenCalled();
  });

  it("leaves due email rows unclaimed when email sends are disabled", async () => {
    const sendEmail = vi.fn();

    await expect(
      processDueEmailReminders({
        supabase: SUPABASE,
        now: NOW,
        sendEmail,
        circuitBreakerEnvironment: {
          CADENCE_DISABLE_EMAIL_SENDS: "1",
          CADENCE_LAUNCH_BREAKER_REASON_CODE: "provider_incident",
        },
      }),
    ).resolves.toEqual({
      checked: 0,
      claimed: 0,
      skipped: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
    });

    expect(listDuePendingEmailReminderDeliveries).not.toHaveBeenCalled();
    expect(claimPendingEmailReminderDelivery).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("treats Supabase +00:00 timestamps as the current expected email delivery", async () => {
    vi.mocked(listDuePendingEmailReminderDeliveries).mockResolvedValue([
      {
        ...BASE_DELIVERY,
        scheduled_send_at: "2026-06-08T14:00:00+00:00",
      },
    ]);
    vi.mocked(claimPendingEmailReminderDelivery).mockResolvedValue({
      ...BASE_DELIVERY,
      scheduled_send_at: "2026-06-08T14:00:00+00:00",
      processing_started_at: NOW_STRING,
    });
    const sendEmail = vi.fn().mockResolvedValue({ jobId: "job-1" });

    await expect(
      processDueEmailReminders({
        supabase: SUPABASE,
        now: NOW,
        sendEmail,
      }),
    ).resolves.toMatchObject({
      sent: 1,
      cancelled: 0,
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(cancelPendingReminderDeliveryById).not.toHaveBeenCalled();
  });

  it("uses the occurrence range label in email variables", async () => {
    vi.mocked(getOccurrenceById).mockResolvedValue({
      ...BASE_OCCURRENCE,
      scheduled_for: "2026-06-08T10:00:00Z",
      schedule_kind: "range",
      schedule_preset: "morning",
      schedule_start_time: "06:00:00",
      schedule_end_time: "12:00:00",
    });
    vi.mocked(listDuePendingEmailReminderDeliveries).mockResolvedValue([
      {
        ...BASE_DELIVERY,
        scheduled_send_at: "2026-06-08T10:00:00Z",
      },
    ]);
    vi.mocked(claimPendingEmailReminderDelivery).mockResolvedValue({
      ...BASE_DELIVERY,
      scheduled_send_at: "2026-06-08T10:00:00Z",
      processing_started_at: NOW_STRING,
    });
    const sendEmail = vi.fn().mockResolvedValue({ jobId: "job-1" });

    await processDueEmailReminders({
      supabase: SUPABASE,
      now: NOW,
      sendEmail,
    });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          SCHEDULED_TIME: "Morning (6:00 AM-Noon)",
        }),
      }),
      { signal: expect.anything() },
    );
  });

  it("skips a delivery already claimed by another process", async () => {
    vi.mocked(claimPendingEmailReminderDelivery).mockResolvedValue(null);
    const sendEmail = vi.fn();

    await expect(
      processDueEmailReminders({
        supabase: SUPABASE,
        now: NOW,
        sendEmail,
      }),
    ).resolves.toMatchObject({
      checked: 1,
      claimed: 0,
      skipped: 1,
      sent: 0,
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(markReminderDeliverySent).not.toHaveBeenCalled();
  });

  it("cancels stale pending email deliveries when email is disabled", async () => {
    vi.mocked(getBehaviorById).mockResolvedValue({
      ...BASE_BEHAVIOR,
      email_reminder_enabled: false,
      category: null,
      schedule_slots: [],
    });
    const sendEmail = vi.fn();

    await expect(
      processDueEmailReminders({
        supabase: SUPABASE,
        now: NOW,
        sendEmail,
      }),
    ).resolves.toMatchObject({
      sent: 0,
      failed: 0,
      cancelled: 1,
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(cancelPendingReminderDeliveryById).toHaveBeenCalledWith(SUPABASE, {
      id: "delivery-1",
      userId: "user-1",
    });
  });

  it("cancels stale pending email deliveries when the offset no longer matches", async () => {
    vi.mocked(getBehaviorById).mockResolvedValue({
      ...BASE_BEHAVIOR,
      reminder_offset_minutes: 60,
      category: null,
      schedule_slots: [],
    });
    const sendEmail = vi.fn();

    await expect(
      processDueEmailReminders({
        supabase: SUPABASE,
        now: NOW,
        sendEmail,
      }),
    ).resolves.toMatchObject({
      sent: 0,
      failed: 0,
      cancelled: 1,
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(cancelPendingReminderDeliveryById).toHaveBeenCalledWith(SUPABASE, {
      id: "delivery-1",
      userId: "user-1",
    });
  });

  it("logs provider failures on the delivery", async () => {
    const sendEmail = vi.fn().mockRejectedValue(new Error("Template disabled"));

    await expect(
      processDueEmailReminders({
        supabase: SUPABASE,
        now: NOW,
        sendEmail,
      }),
    ).resolves.toMatchObject({
      sent: 0,
      failed: 1,
      cancelled: 0,
    });

    expect(markReminderDeliveryFailed).toHaveBeenCalledWith(SUPABASE, {
      id: "delivery-1",
      userId: "user-1",
      error: "Template disabled",
    });
    expect(markReminderDeliverySent).not.toHaveBeenCalled();
  });

  it("reclaims one stale claim exactly once across concurrent workers", async () => {
    const staleDelivery = {
      ...BASE_DELIVERY,
      processing_started_at: "2026-06-08T13:44:59Z",
    };
    vi.mocked(listDuePendingEmailReminderDeliveries).mockResolvedValue([
      staleDelivery,
    ]);
    let claimWon = false;
    vi.mocked(claimPendingEmailReminderDelivery).mockImplementation(async () => {
      if (claimWon) {
        return null;
      }

      claimWon = true;
      return {
        ...staleDelivery,
        processing_started_at: NOW_STRING,
      };
    });
    const sendEmail = vi.fn().mockResolvedValue({ jobId: "job-1" });

    const results = await Promise.all([
      processDueEmailReminders({ supabase: SUPABASE, now: NOW, sendEmail }),
      processDueEmailReminders({ supabase: SUPABASE, now: NOW, sendEmail }),
    ]);

    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.skipped, 0)).toBe(1);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(reportMonitoringEvent).toHaveBeenCalledWith({
      name: "reminder_delivery_claim_reclaimed",
      severity: "warning",
      context: {
        channel: "email",
        retry: true,
      },
    });
  });

  it("leaves a mid-send cancellation cancelled instead of marking it sent", async () => {
    vi.mocked(markReminderDeliverySent).mockResolvedValue(false);
    const sendEmail = vi.fn().mockResolvedValue({ jobId: "job-1" });

    await expect(
      processDueEmailReminders({ supabase: SUPABASE, now: NOW, sendEmail }),
    ).resolves.toMatchObject({
      sent: 0,
      failed: 0,
      cancelled: 1,
    });

    expect(markReminderDeliveryFailed).not.toHaveBeenCalled();
    expect(reportMonitoringEvent).toHaveBeenCalledWith({
      name: "reminder_delivery_cancelled_mid_send",
      severity: "warning",
      context: { channel: "email" },
    });
  });

  it("fails a hung email provider call through the delivery failure path", async () => {
    const sendEmail = vi.fn(
      () => new Promise<never>(() => undefined),
    );

    await expect(
      processDueEmailReminders({
        supabase: SUPABASE,
        now: NOW,
        sendEmail,
        providerTimeoutMs: 5,
      }),
    ).resolves.toMatchObject({
      sent: 0,
      failed: 1,
      cancelled: 0,
    });

    expect(markReminderDeliveryFailed).toHaveBeenCalledWith(
      SUPABASE,
      expect.objectContaining({
        id: "delivery-1",
        error: expect.stringMatching(/timed out/i),
      }),
    );
  });
});

describe("processDueBrowserPushReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(markReminderDeliverySent).mockResolvedValue(true);

    vi.mocked(listDuePendingBrowserPushReminderDeliveries).mockResolvedValue([
      BASE_BROWSER_DELIVERY,
    ]);
    vi.mocked(claimPendingBrowserPushReminderDelivery).mockResolvedValue({
      ...BASE_BROWSER_DELIVERY,
      processing_started_at: NOW_STRING,
    });
    vi.mocked(getOccurrenceById).mockResolvedValue(BASE_OCCURRENCE);
    vi.mocked(getBehaviorById).mockResolvedValue({
      ...BASE_BEHAVIOR,
      category: null,
      schedule_slots: [],
    });
    vi.mocked(listActivePushSubscriptionsForUser).mockResolvedValue([
      BASE_PUSH_SUBSCRIPTION,
    ]);
  });

  it("claims a due browser push reminder before sending and marks it sent", async () => {
    const sendBrowserPush = vi.fn().mockResolvedValue(undefined);

    await expect(
      processDueBrowserPushReminders({
        supabase: SUPABASE,
        now: NOW,
        limit: 2,
        sendBrowserPush,
      }),
    ).resolves.toEqual({
      checked: 1,
      claimed: 1,
      skipped: 0,
      sent: 1,
      failed: 0,
      cancelled: 0,
    });

    expect(listDuePendingBrowserPushReminderDeliveries).toHaveBeenCalledWith(
      SUPABASE,
      {
        dueAt: NOW_STRING,
        reclaimBefore: RECLAIM_BEFORE_STRING,
        limit: 2,
      },
    );
    expect(claimPendingBrowserPushReminderDelivery).toHaveBeenCalledWith(
      SUPABASE,
      {
        id: "browser-delivery-1",
        userId: "user-1",
        dueAt: NOW_STRING,
        reclaimBefore: RECLAIM_BEFORE_STRING,
        processingStartedAt: NOW_STRING,
      },
    );
    expect(sendBrowserPush).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example.com/subscription/1",
        p256dh: "p256dh-key",
        auth: "auth-key",
        payload: {
          title: "Drink water",
          body: "Scheduled for 10:00 AM.",
          tag: "cadence-reminder-occurrence-1",
          url: "/timeline",
          icon: "/icons/cadence-notification-icon.png",
          badge: "/icons/cadence-notification-badge.png",
        },
      },
      { signal: expect.anything() },
    );
    expect(markReminderDeliverySent).toHaveBeenCalledWith(SUPABASE, {
      id: "browser-delivery-1",
      userId: "user-1",
      sentAt: NOW_STRING,
    });
    expect(markReminderDeliveryFailed).not.toHaveBeenCalled();
  });

  it("sends to at most 20 subscriptions with four concurrent provider calls", async () => {
    vi.mocked(listActivePushSubscriptionsForUser).mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => ({
        ...BASE_PUSH_SUBSCRIPTION,
        id: `push-subscription-${index + 1}`,
        endpoint: `https://push.example.com/subscription/${index + 1}`,
      })),
    );
    let activeCalls = 0;
    let maximumActiveCalls = 0;
    let releaseCalls!: () => void;
    const callGate = new Promise<void>((resolve) => {
      releaseCalls = resolve;
    });
    const sendBrowserPush = vi.fn(async () => {
      activeCalls += 1;
      maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
      await callGate;
      activeCalls -= 1;
    });

    const processing = processDueBrowserPushReminders({
      supabase: SUPABASE,
      now: NOW,
      sendBrowserPush,
    });

    await vi.waitFor(() => {
      expect(sendBrowserPush).toHaveBeenCalledTimes(4);
    });
    expect(maximumActiveCalls).toBe(4);

    releaseCalls();

    await expect(processing).resolves.toMatchObject({
      sent: 1,
      failed: 0,
    });
    expect(sendBrowserPush).toHaveBeenCalledTimes(20);
    expect(maximumActiveCalls).toBe(4);
  });

  it("leaves due push rows unclaimed when browser push sends are disabled", async () => {
    const sendBrowserPush = vi.fn();

    await expect(
      processDueBrowserPushReminders({
        supabase: SUPABASE,
        now: NOW,
        sendBrowserPush,
        circuitBreakerEnvironment: {
          CADENCE_DISABLE_BROWSER_PUSH_SENDS: "1",
          CADENCE_LAUNCH_BREAKER_REASON_CODE: "cost_surge",
        },
      }),
    ).resolves.toEqual({
      checked: 0,
      claimed: 0,
      skipped: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
    });

    expect(listDuePendingBrowserPushReminderDeliveries).not.toHaveBeenCalled();
    expect(claimPendingBrowserPushReminderDelivery).not.toHaveBeenCalled();
    expect(sendBrowserPush).not.toHaveBeenCalled();
  });

  it("treats Supabase +00:00 timestamps as the current expected browser push delivery", async () => {
    vi.mocked(listDuePendingBrowserPushReminderDeliveries).mockResolvedValue([
      {
        ...BASE_BROWSER_DELIVERY,
        scheduled_send_at: "2026-06-08T14:00:00+00:00",
      },
    ]);
    vi.mocked(claimPendingBrowserPushReminderDelivery).mockResolvedValue({
      ...BASE_BROWSER_DELIVERY,
      scheduled_send_at: "2026-06-08T14:00:00+00:00",
      processing_started_at: NOW_STRING,
    });
    const sendBrowserPush = vi.fn().mockResolvedValue(undefined);

    await expect(
      processDueBrowserPushReminders({
        supabase: SUPABASE,
        now: NOW,
        sendBrowserPush,
      }),
    ).resolves.toMatchObject({
      sent: 1,
      cancelled: 0,
    });

    expect(sendBrowserPush).toHaveBeenCalledTimes(1);
    expect(cancelPendingReminderDeliveryById).not.toHaveBeenCalled();
  });

  it("fails a browser push reminder when there is no active subscription", async () => {
    vi.mocked(listActivePushSubscriptionsForUser).mockResolvedValue([]);
    const sendBrowserPush = vi.fn();

    await expect(
      processDueBrowserPushReminders({
        supabase: SUPABASE,
        now: NOW,
        sendBrowserPush,
      }),
    ).resolves.toMatchObject({
      sent: 0,
      failed: 1,
      cancelled: 0,
    });

    expect(sendBrowserPush).not.toHaveBeenCalled();
    expect(markReminderDeliveryFailed).toHaveBeenCalledWith(SUPABASE, {
      id: "browser-delivery-1",
      userId: "user-1",
      error: "No active browser push subscription is available.",
    });
  });

  it("deactivates expired browser push subscriptions", async () => {
    const sendBrowserPush = vi
      .fn()
      .mockRejectedValue(new BrowserPushSubscriptionExpiredError("Gone"));

    await expect(
      processDueBrowserPushReminders({
        supabase: SUPABASE,
        now: NOW,
        sendBrowserPush,
      }),
    ).resolves.toMatchObject({
      sent: 0,
      failed: 1,
      cancelled: 0,
    });

    expect(deactivatePushSubscriptionById).toHaveBeenCalledWith(SUPABASE, {
      userId: "user-1",
      subscriptionId: "push-subscription-1",
    });
    expect(markReminderDeliveryFailed).toHaveBeenCalledWith(SUPABASE, {
      id: "browser-delivery-1",
      userId: "user-1",
      error: "Gone",
    });
  });

  it("cancels stale browser push deliveries when browser reminders are disabled", async () => {
    vi.mocked(getBehaviorById).mockResolvedValue({
      ...BASE_BEHAVIOR,
      browser_reminder_enabled: false,
      category: null,
      schedule_slots: [],
    });
    const sendBrowserPush = vi.fn();

    await expect(
      processDueBrowserPushReminders({
        supabase: SUPABASE,
        now: NOW,
        sendBrowserPush,
      }),
    ).resolves.toMatchObject({
      sent: 0,
      failed: 0,
      cancelled: 1,
    });

    expect(sendBrowserPush).not.toHaveBeenCalled();
    expect(cancelPendingReminderDeliveryById).toHaveBeenCalledWith(SUPABASE, {
      id: "browser-delivery-1",
      userId: "user-1",
    });
  });

  it("logs missing VAPID configuration on claimed browser push deliveries", async () => {
    const originalPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const originalPrivateKey = process.env.VAPID_PRIVATE_KEY;

    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    try {
      await expect(
        processDueBrowserPushReminders({
          supabase: SUPABASE,
          now: NOW,
        }),
      ).resolves.toMatchObject({
        checked: 1,
        claimed: 1,
        skipped: 0,
        failed: 1,
      });
    } finally {
      restoreEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", originalPublicKey);
      restoreEnv("VAPID_PRIVATE_KEY", originalPrivateKey);
    }

    expect(markReminderDeliveryFailed).toHaveBeenCalledWith(SUPABASE, {
      id: "browser-delivery-1",
      userId: "user-1",
      error: "Browser push sending is not configured.",
    });
  });

  it("fails a hung browser push call through the delivery failure path", async () => {
    const sendBrowserPush = vi.fn(
      () => new Promise<never>(() => undefined),
    );

    await expect(
      processDueBrowserPushReminders({
        supabase: SUPABASE,
        now: NOW,
        sendBrowserPush,
        providerTimeoutMs: 5,
      }),
    ).resolves.toMatchObject({
      sent: 0,
      failed: 1,
      cancelled: 0,
    });

    expect(markReminderDeliveryFailed).toHaveBeenCalledWith(
      SUPABASE,
      expect.objectContaining({
        id: "browser-delivery-1",
        error: expect.stringMatching(/timed out/i),
      }),
    );
  });
});

describe("processDueReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(markReminderDeliverySent).mockResolvedValue(true);

    vi.mocked(listDuePendingEmailReminderDeliveries).mockResolvedValue([
      BASE_DELIVERY,
    ]);
    vi.mocked(listDuePendingBrowserPushReminderDeliveries).mockResolvedValue([
      BASE_BROWSER_DELIVERY,
    ]);
    vi.mocked(claimPendingEmailReminderDelivery).mockResolvedValue({
      ...BASE_DELIVERY,
      processing_started_at: NOW_STRING,
    });
    vi.mocked(claimPendingBrowserPushReminderDelivery).mockResolvedValue({
      ...BASE_BROWSER_DELIVERY,
      processing_started_at: NOW_STRING,
    });
    vi.mocked(getOccurrenceById).mockResolvedValue(BASE_OCCURRENCE);
    vi.mocked(getBehaviorById).mockResolvedValue({
      ...BASE_BEHAVIOR,
      category: null,
      schedule_slots: [],
    });
    vi.mocked(getProfileSettings).mockResolvedValue({
      email: "user@example.com",
      timezone: "America/New_York",
    });
    vi.mocked(listActivePushSubscriptionsForUser).mockResolvedValue([
      BASE_PUSH_SUBSCRIPTION,
    ]);
  });

  it("processes due email and browser push deliveries in one run", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ jobId: "job-1" });
    const sendBrowserPush = vi.fn().mockResolvedValue(undefined);

    await expect(
      processDueReminders({
        supabase: SUPABASE,
        now: NOW,
        sendEmail,
        sendBrowserPush,
      }),
    ).resolves.toEqual({
      checked: 2,
      claimed: 2,
      skipped: 0,
      sent: 2,
      failed: 0,
      cancelled: 0,
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendBrowserPush).toHaveBeenCalledTimes(1);
    expect(markReminderDeliverySent).toHaveBeenCalledTimes(2);
  });

  it("processes browser push without Sequenzy configuration when no email is due", async () => {
    vi.mocked(listDuePendingEmailReminderDeliveries).mockResolvedValue([]);
    const originalApiKey = process.env.SEQUENZY_API_KEY;
    const originalTemplateSlug = process.env.SEQUENZY_REMINDER_TEMPLATE_SLUG;
    delete process.env.SEQUENZY_API_KEY;
    delete process.env.SEQUENZY_REMINDER_TEMPLATE_SLUG;
    const sendBrowserPush = vi.fn().mockResolvedValue(undefined);

    try {
      await expect(
        processDueReminders({
          supabase: SUPABASE,
          now: NOW,
          sendBrowserPush,
        }),
      ).resolves.toMatchObject({
        checked: 1,
        claimed: 1,
        sent: 1,
        failed: 0,
      });
    } finally {
      restoreEnv("SEQUENZY_API_KEY", originalApiKey);
      restoreEnv("SEQUENZY_REMINDER_TEMPLATE_SLUG", originalTemplateSlug);
    }

    expect(sendBrowserPush).toHaveBeenCalledOnce();
    expect(markReminderDeliveryFailed).not.toHaveBeenCalled();
  });

  it("fails due email configuration while browser push continues", async () => {
    const originalApiKey = process.env.SEQUENZY_API_KEY;
    const originalTemplateSlug = process.env.SEQUENZY_REMINDER_TEMPLATE_SLUG;
    delete process.env.SEQUENZY_API_KEY;
    delete process.env.SEQUENZY_REMINDER_TEMPLATE_SLUG;
    const sendBrowserPush = vi.fn().mockResolvedValue(undefined);

    try {
      await expect(
        processDueReminders({
          supabase: SUPABASE,
          now: NOW,
          sendBrowserPush,
        }),
      ).resolves.toMatchObject({
        checked: 2,
        claimed: 2,
        sent: 1,
        failed: 1,
      });
    } finally {
      restoreEnv("SEQUENZY_API_KEY", originalApiKey);
      restoreEnv("SEQUENZY_REMINDER_TEMPLATE_SLUG", originalTemplateSlug);
    }

    expect(sendBrowserPush).toHaveBeenCalledOnce();
    expect(markReminderDeliveryFailed).toHaveBeenCalledWith(
      SUPABASE,
      expect.objectContaining({
        id: "delivery-1",
        error: "Missing SEQUENZY_API_KEY for email reminder sending.",
      }),
    );
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
