import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BEHAVIOR_ID = "22222222-2222-4222-8222-222222222222";
const SCHEDULE_ID = "33333333-3333-4333-8333-333333333333";
const SCHEDULE_SLOT_ID = "44444444-4444-4444-8444-444444444444";
const ARCHIVE_NOTE_ID = "55555555-5555-4555-8555-555555555555";
const SUPABASE = { kind: "supabase" } as never;

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireCurrentUserId: vi.fn(),
  getBehaviorById: vi.fn(),
  listUserBehaviors: vi.fn(),
  readCachedProfileTimezone: vi.fn(),
  syncUserOccurrencesAndReminders: vi.fn(),
  reportMonitoringError: vi.fn(),
  updateBehaviorWithAtomicScheduleGraph: vi.fn(),
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
    listUserBehaviors: mocks.listUserBehaviors,
  };
});

vi.mock("@/lib/db/behaviorDefinitionEvents.repo", async (importOriginal) => {
  const original = await importOriginal<object>();

  return {
    ...original,
    updateBehaviorWithAtomicScheduleGraph:
      mocks.updateBehaviorWithAtomicScheduleGraph,
  };
});

vi.mock("@/lib/cache/stable-user-data.cache", async (importOriginal) => {
  const original = await importOriginal<object>();

  return {
    ...original,
    readCachedProfileTimezone: mocks.readCachedProfileTimezone,
  };
});

vi.mock("@/lib/services/occurrence.service", () => ({
  syncUserOccurrencesAndReminders: mocks.syncUserOccurrencesAndReminders,
}));

vi.mock("@/lib/monitoring/privacy-safe-events", () => ({
  reportMonitoringError: mocks.reportMonitoringError,
}));

describe("behavior lifecycle reminder synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(SUPABASE);
    mocks.requireCurrentUserId.mockResolvedValue(USER_ID);
    mocks.getBehaviorById.mockResolvedValue(storedBehavior());
    mocks.readCachedProfileTimezone.mockResolvedValue("America/New_York");
    mocks.syncUserOccurrencesAndReminders.mockResolvedValue([]);
  });

  it("cancels pending reminder coverage immediately after archiving", async () => {
    const archivedBehavior = storedBehavior({
      active: false,
      archived_at: "2026-07-22T12:00:00Z",
    });
    mocks.updateBehaviorWithAtomicScheduleGraph.mockResolvedValue(
      archivedBehavior,
    );
    mocks.listUserBehaviors.mockResolvedValue([archivedBehavior]);
    const { archiveBehaviorFromFormData } = await import(
      "@/lib/services/behavior.service"
    );

    await archiveBehaviorFromFormData(behaviorForm());

    expect(mocks.syncUserOccurrencesAndReminders).toHaveBeenCalledWith(
      SUPABASE,
      USER_ID,
      {
        behaviors: [archivedBehavior],
        timezone: "America/New_York",
      },
    );
  });

  it("replans reminder coverage immediately after restoring", async () => {
    const restoredBehavior = storedBehavior({ active: true, archived_at: null });
    mocks.updateBehaviorWithAtomicScheduleGraph.mockResolvedValue(
      restoredBehavior,
    );
    mocks.listUserBehaviors.mockResolvedValue([restoredBehavior]);
    const { restoreBehaviorFromFormData } = await import(
      "@/lib/services/behavior.service"
    );

    await restoreBehaviorFromFormData(behaviorForm());

    expect(mocks.syncUserOccurrencesAndReminders).toHaveBeenCalledWith(
      SUPABASE,
      USER_ID,
      {
        behaviors: [restoredBehavior],
        timezone: "America/New_York",
      },
    );
  });

  it.each([
    ["archive", "archiveBehaviorFromFormData"],
    ["restore", "restoreBehaviorFromFormData"],
  ] as const)(
    "rolls back the %s lifecycle transaction when the atomic write fails",
    async (_operation, methodName) => {
      mocks.updateBehaviorWithAtomicScheduleGraph.mockRejectedValueOnce(
        new Error("Atomic behavior and stale-marker write failed."),
      );
      const behaviorService = await import("@/lib/services/behavior.service");

      await expect(
        behaviorService[methodName](behaviorForm()),
      ).rejects.toThrow("Atomic behavior and stale-marker write failed.");
      // One read before the write finds sub-behaviors; no post-write read follows a failure.
      expect(mocks.listUserBehaviors).toHaveBeenCalledTimes(1);
      expect(mocks.syncUserOccurrencesAndReminders).not.toHaveBeenCalled();
    },
  );

  it("does not commit when stale marking and immediate repair are both unavailable", async () => {
    const transactionFailure = new Error(
      "Atomic behavior and stale-marker write failed.",
    );
    mocks.updateBehaviorWithAtomicScheduleGraph.mockRejectedValueOnce(
      transactionFailure,
    );
    mocks.syncUserOccurrencesAndReminders.mockRejectedValueOnce(
      new Error("Immediate repair failed."),
    );
    const { archiveBehaviorFromFormData } = await import(
      "@/lib/services/behavior.service"
    );

    await expect(
      archiveBehaviorFromFormData(behaviorForm()),
    ).rejects.toBe(transactionFailure);
    expect(mocks.updateBehaviorWithAtomicScheduleGraph).toHaveBeenCalledOnce();
    expect(mocks.syncUserOccurrencesAndReminders).not.toHaveBeenCalled();
  });

  it("preserves the behavior graph while atomically archiving and marking stale", async () => {
    const existingBehavior = storedBehavior();
    const archivedBehavior = storedBehavior({
      active: false,
      archived_at: "2026-07-22T12:00:00Z",
    });
    mocks.getBehaviorById.mockResolvedValue(existingBehavior);
    mocks.updateBehaviorWithAtomicScheduleGraph.mockResolvedValue(
      archivedBehavior,
    );
    mocks.listUserBehaviors.mockResolvedValue([archivedBehavior]);
    const { archiveBehaviorFromFormData } = await import(
      "@/lib/services/behavior.service"
    );

    await archiveBehaviorFromFormData(behaviorForm());

    expect(mocks.updateBehaviorWithAtomicScheduleGraph).toHaveBeenCalledWith(
      SUPABASE,
      expect.objectContaining({
        behaviorId: BEHAVIOR_ID,
        behavior: expect.objectContaining({
          title: "Drink water",
          active: false,
          archived_at: expect.any(String),
        }),
        expectedDefinition: {
          title: "Drink water",
          description: null,
        },
        expectedNormalizedDefinition: {
          title: "Drink water",
          description: null,
        },
        expectedScheduleGraph: storedScheduleGraphMutation(),
        expectedUpdatedAt: "2026-07-01T12:00:00Z",
        definitionEventPlan: null,
        schedules: storedScheduleGraphMutation(),
      }),
    );
  });

  it("uses the authoritative profile timezone when it differs from the behavior timezone", async () => {
    const archivedBehavior = storedBehavior({
      active: false,
      archived_at: "2026-07-22T12:00:00Z",
      timezone: "America/Los_Angeles",
    });
    mocks.updateBehaviorWithAtomicScheduleGraph.mockResolvedValue(
      archivedBehavior,
    );
    mocks.listUserBehaviors.mockResolvedValue([archivedBehavior]);
    mocks.readCachedProfileTimezone.mockResolvedValue("Europe/Paris");
    const { archiveBehaviorFromFormData } = await import(
      "@/lib/services/behavior.service"
    );

    await archiveBehaviorFromFormData(behaviorForm());

    expect(mocks.syncUserOccurrencesAndReminders).toHaveBeenCalledWith(
      SUPABASE,
      USER_ID,
      {
        behaviors: [archivedBehavior],
        timezone: "Europe/Paris",
      },
    );
  });

  it("leaves the atomic stale marker for background repair when the profile timezone is absent", async () => {
    const restoredBehavior = storedBehavior({
      timezone: "America/Los_Angeles",
    });
    mocks.getBehaviorById.mockResolvedValue(
      storedBehavior({ timezone: "America/Los_Angeles" }),
    );
    mocks.updateBehaviorWithAtomicScheduleGraph.mockResolvedValue(
      restoredBehavior,
    );
    mocks.listUserBehaviors.mockResolvedValue([restoredBehavior]);
    mocks.readCachedProfileTimezone.mockResolvedValue(null);
    const { restoreBehaviorFromFormData } = await import(
      "@/lib/services/behavior.service"
    );

    await restoreBehaviorFromFormData(behaviorForm());

    expect(mocks.updateBehaviorWithAtomicScheduleGraph).toHaveBeenCalledOnce();
    expect(mocks.listUserBehaviors).toHaveBeenCalledTimes(1);
    expect(mocks.syncUserOccurrencesAndReminders).not.toHaveBeenCalled();
    expect(mocks.reportMonitoringError).toHaveBeenCalledWith(
      "behavior_graph_profile_timezone_missing",
      expect.any(Error),
      { operation: "restore" },
    );
  });

  it("leaves the atomic stale marker for background repair when the profile timezone read fails", async () => {
    const failure = new Error("Profile lookup failed.");
    const archivedBehavior = storedBehavior({
      active: false,
      archived_at: "2026-07-22T12:00:00Z",
      timezone: "America/Los_Angeles",
    });
    mocks.updateBehaviorWithAtomicScheduleGraph.mockResolvedValue(
      archivedBehavior,
    );
    mocks.readCachedProfileTimezone.mockRejectedValueOnce(failure);
    const { archiveBehaviorFromFormData } = await import(
      "@/lib/services/behavior.service"
    );

    await expect(
      archiveBehaviorFromFormData(behaviorForm()),
    ).resolves.toBeUndefined();

    expect(mocks.updateBehaviorWithAtomicScheduleGraph).toHaveBeenCalledOnce();
    expect(mocks.listUserBehaviors).toHaveBeenCalledTimes(1);
    expect(mocks.syncUserOccurrencesAndReminders).not.toHaveBeenCalled();
    expect(mocks.reportMonitoringError).toHaveBeenCalledWith(
      "behavior_graph_profile_timezone_read_failed",
      failure,
      { operation: "archive" },
    );
  });

  it.each([
    ["archive", "archiveBehaviorFromFormData", false],
    ["restore", "restoreBehaviorFromFormData", true],
  ] as const)(
    "keeps a committed %s successful when post-write graph repair fails",
    async (operation, methodName, active) => {
      const failure = new Error("reminder repair failed");
      mocks.updateBehaviorWithAtomicScheduleGraph.mockResolvedValue(
        storedBehavior({
          active,
          archived_at: active ? null : "2026-07-22T12:00:00Z",
        }),
      );
      mocks.listUserBehaviors.mockResolvedValue([storedBehavior({ active })]);
      mocks.syncUserOccurrencesAndReminders.mockRejectedValueOnce(failure);
      const behaviorService = await import("@/lib/services/behavior.service");

      await expect(
        behaviorService[methodName](behaviorForm()),
      ).resolves.toBeUndefined();
      expect(
        mocks.updateBehaviorWithAtomicScheduleGraph.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mocks.syncUserOccurrencesAndReminders.mock.invocationCallOrder[0]!,
      );
      expect(mocks.reportMonitoringError).toHaveBeenCalledWith(
        "behavior_graph_post_write_sync_failed",
        failure,
        { operation },
      );
    },
  );

  it("does not let monitoring failure overturn a committed archive", async () => {
    const archivedBehavior = storedBehavior({
      active: false,
      archived_at: "2026-07-22T12:00:00Z",
    });
    mocks.updateBehaviorWithAtomicScheduleGraph.mockResolvedValue(
      archivedBehavior,
    );
    mocks.listUserBehaviors.mockResolvedValue([archivedBehavior]);
    mocks.syncUserOccurrencesAndReminders.mockRejectedValueOnce(
      new Error("Immediate repair failed."),
    );
    mocks.reportMonitoringError.mockImplementationOnce(() => {
      throw new Error("Monitoring transport failed.");
    });
    const { archiveBehaviorFromFormData } = await import(
      "@/lib/services/behavior.service"
    );

    await expect(
      archiveBehaviorFromFormData(behaviorForm()),
    ).resolves.toBeUndefined();
    expect(mocks.updateBehaviorWithAtomicScheduleGraph).toHaveBeenCalledOnce();
  });

  it("updates one archived note atomically without replanning occurrences", async () => {
    const archived = storedBehavior({
      active: false,
      archived_at: "2026-06-30T12:00:00Z",
      archive_notes: [{ id: ARCHIVE_NOTE_ID, archived_at: "2026-06-30T12:00:00Z",
        note: "Old", updated_at: "2026-06-30T12:00:00Z" }],
    });
    mocks.getBehaviorById.mockResolvedValue(archived);
    mocks.updateBehaviorWithAtomicScheduleGraph.mockResolvedValue(archived);
    const form = behaviorForm();
    form.set("archive_note_id", ARCHIVE_NOTE_ID);
    form.set("archive_note", "  Updated  ");
    const { updateBehaviorArchiveNoteFromFormData } = await import("@/lib/services/behavior.service");
    await updateBehaviorArchiveNoteFromFormData(form);
    expect(mocks.updateBehaviorWithAtomicScheduleGraph).toHaveBeenCalledWith(SUPABASE, expect.objectContaining({
      behaviorId: BEHAVIOR_ID,
      expectedUpdatedAt: "2026-07-01T12:00:00Z",
      definitionEventPlan: null,
      configurationEventPlan: null,
      behavior: expect.objectContaining({ archive_notes: [expect.objectContaining({ id: ARCHIVE_NOTE_ID, note: "Updated" })] }),
    }));
    expect(mocks.syncUserOccurrencesAndReminders).not.toHaveBeenCalled();
  });
});

function behaviorForm(): FormData {
  const formData = new FormData();
  formData.set("behavior_id", BEHAVIOR_ID);
  formData.set("expected_updated_at", "2026-07-01T12:00:00Z");
  formData.set("archive_note", "");
  return formData;
}

function storedBehavior(overrides: Record<string, unknown> = {}) {
  const scheduleSlot = {
    id: SCHEDULE_SLOT_ID,
    user_id: USER_ID,
    behavior_id: BEHAVIOR_ID,
    behavior_schedule_id: SCHEDULE_ID,
    kind: "exact",
    preset: null,
    start_time: "09:00:00",
    end_time: null,
    sort_order: 0,
    created_at: "2026-07-01T12:00:00Z",
    updated_at: "2026-07-01T12:00:00Z",
  };

  return {
    id: BEHAVIOR_ID,
    user_id: USER_ID,
    category_id: null,
    title: "Drink water",
    description: null,
    recurrence_rule: { frequency: "daily", interval: 1 },
    scheduled_time: "09:00:00",
    timezone: "America/New_York",
    browser_reminder_enabled: true,
    email_reminder_enabled: false,
    reminder_offset_minutes: 0,
    active: true,
    archived_at: null,
    archive_notes: [],
    created_at: "2026-07-01T12:00:00Z",
    updated_at: "2026-07-01T12:00:00Z",
    category: null,
    schedules: [
      {
        id: SCHEDULE_ID,
        user_id: USER_ID,
        behavior_id: BEHAVIOR_ID,
        recurrence_rule: { frequency: "daily", interval: 1 },
        sort_order: 0,
        created_at: "2026-07-01T12:00:00Z",
        updated_at: "2026-07-01T12:00:00Z",
        schedule_slots: [scheduleSlot],
      },
    ],
    schedule_slots: [scheduleSlot],
    ...overrides,
  };
}

function storedScheduleGraphMutation() {
  return [
    {
      id: SCHEDULE_ID,
      recurrence_rule: { frequency: "daily", interval: 1 },
      sort_order: 0,
      slots: [
        {
          id: SCHEDULE_SLOT_ID,
          kind: "exact",
          preset: null,
          start_time: "09:00:00",
          end_time: null,
          sort_order: 0,
        },
      ],
    },
  ];
}
