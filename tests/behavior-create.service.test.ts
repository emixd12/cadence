import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearUserReadCache } from "../lib/cache/user-read-cache";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BEHAVIOR_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";
const SCHEDULE_SLOT_ID = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireCurrentUserId: vi.fn(),
  createBehaviorWithAtomicScheduleGraph: vi.fn(),
  getBehaviorById: vi.fn(),
  getProfileTimezone: vi.fn(),
  listUserBehaviors: vi.fn(),
  syncUserOccurrencesAndReminders: vi.fn(),
  reportMonitoringError: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUserId: mocks.requireCurrentUserId,
}));

vi.mock("@/lib/db/behaviors.repo", async (importOriginal) => {
  const original = await importOriginal<object>();

  return {
    ...original,
    getBehaviorById: mocks.getBehaviorById,
    getProfileTimezone: mocks.getProfileTimezone,
    listUserBehaviors: mocks.listUserBehaviors,
  };
});

vi.mock("@/lib/services/occurrence.service", () => ({
  syncUserOccurrencesAndReminders: mocks.syncUserOccurrencesAndReminders,
}));

vi.mock("@/lib/monitoring/privacy-safe-events", () => ({
  reportMonitoringError: mocks.reportMonitoringError,
}));

vi.mock("@/lib/db/behaviorDefinitionEvents.repo", () => ({
  createBehaviorWithAtomicScheduleGraph:
    mocks.createBehaviorWithAtomicScheduleGraph,
  updateBehaviorWithAtomicScheduleGraph: vi.fn(),
  createBehaviorWithDefinitionEvent: vi.fn(),
  updateBehaviorWithDefinitionEvent: vi.fn(),
}));

describe("createBehaviorFromFormData", () => {
  beforeEach(() => {
    clearUserReadCache();
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({ from: vi.fn() });
    mocks.requireCurrentUserId.mockResolvedValue(USER_ID);
    mocks.getProfileTimezone.mockResolvedValue("America/New_York");
    mocks.createBehaviorWithAtomicScheduleGraph.mockResolvedValue({
      ...storedBehavior(),
    });
    mocks.getBehaviorById.mockResolvedValue(storedBehavior());
    mocks.listUserBehaviors.mockResolvedValue([storedBehavior()]);
    mocks.syncUserOccurrencesAndReminders.mockResolvedValue([]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-26T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a server-confirmed behavior view after creating the behavior", async () => {
    const { createBehaviorFromFormData } = await import(
      "../lib/services/behavior.service"
    );
    const result = await createBehaviorFromFormData(createFormData());

    expect(result).toMatchObject({
      id: BEHAVIOR_ID,
      title: "Brush teeth",
      categoryId: CATEGORY_ID,
      categoryName: "Grooming",
      scheduleSummary: "7:30 AM",
      active: true,
    });
    expect(result.scheduleSlots).toEqual([
      expect.objectContaining({
        id: SCHEDULE_SLOT_ID,
        kind: "exact",
        startTime: "07:30",
        label: "7:30 AM",
      }),
    ]);
    expect(mocks.createBehaviorWithAtomicScheduleGraph).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        behavior: expect.objectContaining({
          user_id: USER_ID,
          title: "Brush teeth",
          location_text: null,
          category_id: CATEGORY_ID,
          scheduled_time: "07:30",
          timezone: "America/New_York",
        }),
        definitionEventPlan: {
          previousTitle: null,
          nextTitle: "Brush teeth",
          previousDescription: null,
          nextDescription: "Evening routine",
          changedFields: ["title", "description"],
          recordedAt: "2026-06-26T12:00:00.000Z",
          source: "manual",
          reason: null,
        },
        configurationEventPlan: expect.objectContaining({
          eventKind: "baseline",
          changedFields: [
            "category_id",
            "location_text",
            "where_kind",
            "schedule_graph",
            "browser_reminder_enabled",
            "email_reminder_enabled",
            "reminder_offset_minutes",
            "active",
            "timezone",
          ],
          reasonCode: "behavior_created",
          source: "manual",
        }),
        schedules: [
          expect.objectContaining({
            recurrence_rule: {
              frequency: "daily",
              interval: 1,
            },
            sort_order: 0,
            slots: [
              expect.objectContaining({
                start_time: "07:30",
                sort_order: 0,
              }),
            ],
          }),
        ],
      }),
    );
    expect(mocks.getBehaviorById).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      BEHAVIOR_ID,
    );
    expect(mocks.syncUserOccurrencesAndReminders).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      {
        behaviors: [storedBehavior()],
        timezone: "America/New_York",
      },
    );
  });

  it("ignores an old tab timezone and reads the current profile without the cache", async () => {
    const { readCachedProfileTimezone } = await import("../lib/cache/stable-user-data.cache");
    await readCachedProfileTimezone({} as never, USER_ID);
    mocks.getProfileTimezone.mockResolvedValue("America/Los_Angeles");
    const { createBehaviorFromFormData } = await import("../lib/services/behavior.service");
    await createBehaviorFromFormData(createFormData());
    expect(mocks.createBehaviorWithAtomicScheduleGraph).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({
        behavior: expect.objectContaining({ timezone: "America/Los_Angeles" }),
      }),
    );
  });

  it("returns the committed behavior when post-write graph repair fails", async () => {
    const failure = new Error("reminder repair failed");
    mocks.syncUserOccurrencesAndReminders.mockRejectedValueOnce(failure);
    const { createBehaviorFromFormData } = await import(
      "../lib/services/behavior.service"
    );

    await expect(
      createBehaviorFromFormData(createFormData()),
    ).resolves.toMatchObject({ id: BEHAVIOR_ID, title: "Brush teeth" });
    expect(mocks.reportMonitoringError).toHaveBeenCalledWith(
      "behavior_graph_post_write_sync_failed",
      failure,
      { operation: "create" },
    );
  });

  it("returns a resavable fallback schedule row when the confirmed behavior has no slot rows", async () => {
    const { createBehaviorFromFormData } = await import(
      "../lib/services/behavior.service"
    );
    mocks.getBehaviorById.mockResolvedValue(
      storedBehavior({ schedule_slots: [] }),
    );

    const result = await createBehaviorFromFormData(createFormData());

    expect(result.scheduleSlots).toEqual([
      expect.objectContaining({
        id: "",
        kind: "exact",
        startTime: "07:30",
        label: "7:30 AM",
      }),
    ]);
  });

  it("does not run follow-on writes when the atomic behavior graph create fails", async () => {
    const { createBehaviorFromFormData } = await import(
      "../lib/services/behavior.service"
    );
    mocks.createBehaviorWithAtomicScheduleGraph.mockRejectedValueOnce(
      new Error("Schedule slot insert failed."),
    );

    await expect(createBehaviorFromFormData(createFormData())).rejects.toThrow(
      "Schedule slot insert failed.",
    );

    expect(mocks.getBehaviorById).not.toHaveBeenCalled();
    expect(mocks.syncUserOccurrencesAndReminders).not.toHaveBeenCalled();
  });
});

function createFormData(): FormData {
  const formData = new FormData();

  formData.set("title", "Brush teeth");
  formData.set("description", "Evening routine");
  formData.set("category_id", CATEGORY_ID);
  formData.set("timezone", "America/New_York");
  formData.set("schedule_slot_count", "1");
  formData.set("schedule_kind_0", "exact");
  formData.set("schedule_exact_time_0", "07:30");
  formData.set("recurrence_kind", "daily");
  formData.set("daily_interval", "1");
  formData.set("reminder_offset", "0");
  formData.set("browser_reminder", "on");

  return formData;
}

function storedBehavior(
  overrides: Partial<ReturnType<typeof baseStoredBehavior>> = {},
) {
  return {
    ...baseStoredBehavior(),
    ...overrides,
  };
}

function baseStoredBehavior() {
  return {
    id: BEHAVIOR_ID,
    user_id: USER_ID,
    category_id: CATEGORY_ID,
    title: "Brush teeth",
    description: "Evening routine",
    recurrence_rule: { frequency: "daily", interval: 1 },
    scheduled_time: "07:30",
    timezone: "America/New_York",
    browser_reminder_enabled: true,
    email_reminder_enabled: false,
    reminder_offset_minutes: 0,
    active: true,
    archived_at: null,
    created_at: "2026-06-26T12:00:00Z",
    updated_at: "2026-06-26T12:00:00Z",
    category: {
      id: CATEGORY_ID,
      name: "Grooming",
    },
    schedule_slots: [
      {
        id: SCHEDULE_SLOT_ID,
        user_id: USER_ID,
        behavior_id: BEHAVIOR_ID,
        kind: "exact",
        preset: null,
        start_time: "07:30",
        end_time: null,
        sort_order: 0,
        created_at: "2026-06-26T12:00:00Z",
        updated_at: "2026-06-26T12:00:00Z",
      },
    ],
  };
}
