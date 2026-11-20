import { describe, expect, it } from "vitest";

import {
  BehaviorValidationError,
  behaviorErrorToActionState,
  normalizeRecurrenceRule,
  parseBehaviorFormData,
  recurrenceDefaultsFromRule,
  summarizeRecurrenceRule,
} from "../lib/services/behavior-form";

const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";
const BEHAVIOR_ID = "22222222-2222-4222-8222-222222222222";
const categories = [{ id: CATEGORY_ID, name: "Grooming" }];

it("presents a behavior edit conflict without losing the browser draft", () => {
  expect(
    behaviorErrorToActionState({
      message: "Behavior schedule graph changed after it was read.",
    }),
  ).toEqual({
    status: "error",
    message:
      "This behavior changed elsewhere. Reload it before saving again. Your draft is still here.",
    conflict: true,
  });
});

function formData(entries: Array<[string, string]>): FormData {
  const form = new FormData();

  for (const [key, value] of entries) {
    form.append(key, value);
  }

  return form;
}

describe("parseBehaviorFormData", () => {
  it("maps create form fields into a behavior mutation with reminder defaults", () => {
    const result = parseBehaviorFormData(
      formData([
        ["title", " Brush teeth "],
        ["description", " Evening routine "],
        ["category_id", CATEGORY_ID],
        ["scheduled_time", "22:00"],
        ["recurrence_kind", "daily"],
        ["daily_interval", "1"],
        ["reminder_offset", "0"],
        ["browser_reminder", "on"],
      ]),
      { mode: "create", categories },
    );

    expect(result).toEqual({
      behaviorId: "",
      defaultDurationMinutes: null,
      title: "Brush teeth",
      description: "Evening routine",
      locationText: null,
      categoryId: CATEGORY_ID,
      recurrenceRule: { frequency: "daily", interval: 1 },
      scheduledTime: "22:00",
      schedules: [
        {
          id: null,
          recurrenceRule: { frequency: "daily", interval: 1 },
          timeEntries: [
            {
              id: null,
              kind: "exact",
              preset: null,
              startTime: "22:00",
              endTime: null,
              sortOrder: 0,
            },
          ],
          sortOrder: 0,
        },
      ],
      scheduleSlots: [
        {
          id: null,
          kind: "exact",
          preset: null,
          startTime: "22:00",
          endTime: null,
          sortOrder: 0,
        },
      ],
      browserReminderEnabled: true,
      emailReminderEnabled: false,
      reminderOffsetMinutes: 0,
      active: true,
    });
  });

  it("maps weekly selections and email reminders", () => {
    const result = parseBehaviorFormData(
      formData([
        ["behavior_id", BEHAVIOR_ID],
        ["title", "Workout"],
        ["category_id", CATEGORY_ID],
        ["scheduled_time", "07:30"],
        ["recurrence_kind", "weekly"],
        ["weekly_interval", "2"],
        ["weekly_days", "monday"],
        ["weekly_days", "friday"],
        ["reminder_offset", "60"],
        ["email_reminder", "on"],
        ["active", "on"],
      ]),
      { mode: "update", categories },
    );

    expect(result.recurrenceRule).toEqual({
      frequency: "weekly",
      interval: 2,
      daysOfWeek: ["monday", "friday"],
    });
    expect(result.emailReminderEnabled).toBe(true);
    expect(result.active).toBe(true);
  });

  it("maps multiple schedule rows with exact times and preset ranges", () => {
    const result = parseBehaviorFormData(
      formData([
        ["title", "Stretch"],
        ["category_id", CATEGORY_ID],
        ["schedule_slot_count", "2"],
        ["schedule_kind_0", "range"],
        ["schedule_range_preset_0", "morning"],
        ["schedule_kind_1", "exact"],
        ["schedule_exact_time_1", "21:30"],
        ["recurrence_kind", "daily"],
        ["daily_interval", "1"],
        ["reminder_offset", "0"],
        ["browser_reminder", "on"],
      ]),
      { mode: "create", categories },
    );

    expect(result.scheduledTime).toBe("06:00");
    expect(result.scheduleSlots).toEqual([
      {
        id: null,
        kind: "range",
        preset: "morning",
        startTime: "06:00",
        endTime: "12:00",
        sortOrder: 0,
      },
      {
        id: null,
        kind: "exact",
        preset: null,
        startTime: "21:30",
        endTime: null,
        sortOrder: 1,
      },
    ]);
  });

  it("maps nested schedules with independent recurrence and time entries", () => {
    const result = parseBehaviorFormData(
      formData([
        ["title", "Clean Invisalign"],
        ["category_id", CATEGORY_ID],
        ["description", "Cleaning the aligners"],
        ["behavior_schedule_count", "2"],
        ["schedule_0_recurrence_kind", "daily"],
        ["schedule_0_daily_interval", "1"],
        ["schedule_0_time_entry_count", "2"],
        ["schedule_0_time_entry_kind_0", "exact"],
        ["schedule_0_time_entry_exact_time_0", "08:00"],
        ["schedule_0_time_entry_kind_1", "exact"],
        ["schedule_0_time_entry_exact_time_1", "23:00"],
        ["schedule_1_recurrence_kind", "every_days"],
        ["schedule_1_every_days", "2"],
        ["schedule_1_time_entry_count", "1"],
        ["schedule_1_time_entry_kind_0", "range"],
        ["schedule_1_time_entry_range_start_0", "23:00"],
        ["schedule_1_time_entry_range_end_0", "23:30"],
        ["reminder_offset", "0"],
        ["browser_reminder", "on"],
      ]),
      { mode: "create", categories },
    );

    expect(result.scheduledTime).toBe("08:00");
    expect(result.recurrenceRule).toEqual({ frequency: "daily", interval: 1 });
    expect(result.schedules).toEqual([
      {
        id: null,
        recurrenceRule: { frequency: "daily", interval: 1 },
        timeEntries: [
          {
            id: null,
            kind: "exact",
            preset: null,
            startTime: "08:00",
            endTime: null,
            sortOrder: 0,
          },
          {
            id: null,
            kind: "exact",
            preset: null,
            startTime: "23:00",
            endTime: null,
            sortOrder: 1,
          },
        ],
        sortOrder: 0,
      },
      {
        id: null,
        recurrenceRule: { frequency: "interval_days", intervalDays: 2 },
        timeEntries: [
          {
            id: null,
            kind: "range",
            preset: null,
            startTime: "23:00",
            endTime: "23:30",
            sortOrder: 0,
          },
        ],
        sortOrder: 1,
      },
    ]);
    expect(result.scheduleSlots).toHaveLength(3);
  });

  it("allows the same time on separate schedules for occurrence dedupe", () => {
    const result = parseBehaviorFormData(
      formData([
        ["title", "Overlap"],
        ["behavior_schedule_count", "2"],
        ["schedule_0_recurrence_kind", "daily"],
        ["schedule_0_daily_interval", "1"],
        ["schedule_0_time_entry_count", "1"],
        ["schedule_0_time_entry_kind_0", "exact"],
        ["schedule_0_time_entry_exact_time_0", "23:00"],
        ["schedule_1_recurrence_kind", "every_days"],
        ["schedule_1_every_days", "2"],
        ["schedule_1_time_entry_count", "1"],
        ["schedule_1_time_entry_kind_0", "exact"],
        ["schedule_1_time_entry_exact_time_0", "23:00"],
        ["reminder_offset", "0"],
      ]),
      { mode: "create", categories },
    );

    expect(result.schedules).toHaveLength(2);
    expect(result.scheduleSlots.map((slot) => slot.startTime)).toEqual([
      "23:00",
      "23:00",
    ]);
  });

  it("rejects duplicate start times inside one schedule", () => {
    expect(() =>
      parseBehaviorFormData(
        formData([
          ["title", "Duplicate nested time"],
          ["behavior_schedule_count", "1"],
          ["schedule_0_recurrence_kind", "daily"],
          ["schedule_0_daily_interval", "1"],
          ["schedule_0_time_entry_count", "2"],
          ["schedule_0_time_entry_kind_0", "exact"],
          ["schedule_0_time_entry_exact_time_0", "23:00"],
          ["schedule_0_time_entry_kind_1", "range"],
          ["schedule_0_time_entry_range_start_1", "23:00"],
          ["schedule_0_time_entry_range_end_1", "23:30"],
          ["reminder_offset", "0"],
        ]),
        { mode: "create", categories },
      ),
    ).toThrow(BehaviorValidationError);
  });

  it("keeps category-only updates valid when a fallback schedule row has no persisted id", () => {
    const result = parseBehaviorFormData(
      formData([
        ["behavior_id", BEHAVIOR_ID],
        ["title", "Laundry"],
        ["category_id", CATEGORY_ID],
        ["schedule_slot_count", "1"],
        ["schedule_slot_id_0", ""],
        ["schedule_kind_0", "exact"],
        ["schedule_exact_time_0", "12:00"],
        ["recurrence_kind", "weekly"],
        ["weekly_interval", "1"],
        ["weekly_days", "wednesday"],
        ["reminder_offset", "0"],
        ["browser_reminder", "on"],
        ["active", "on"],
      ]),
      { mode: "update", categories },
    );

    expect(result.categoryId).toBe(CATEGORY_ID);
    expect(result.scheduleSlots).toEqual([
      {
        id: null,
        kind: "exact",
        preset: null,
        startTime: "12:00",
        endTime: null,
        sortOrder: 0,
      },
    ]);
  });

  it("rejects duplicate schedule start times", () => {
    expect(() =>
      parseBehaviorFormData(
        formData([
          ["title", "Duplicate schedule"],
          ["schedule_slot_count", "2"],
          ["schedule_kind_0", "range"],
          ["schedule_range_preset_0", "morning"],
          ["schedule_kind_1", "exact"],
          ["schedule_exact_time_1", "06:00"],
          ["recurrence_kind", "daily"],
          ["daily_interval", "1"],
          ["reminder_offset", "0"],
        ]),
        { mode: "create", categories },
      ),
    ).toThrow(BehaviorValidationError);
  });

  it("requires a weekday for weekly recurrence", () => {
    expect(() =>
      parseBehaviorFormData(
        formData([
          ["title", "Laundry"],
          ["scheduled_time", "10:00"],
          ["recurrence_kind", "weekly"],
          ["weekly_interval", "1"],
          ["reminder_offset", "0"],
        ]),
        { mode: "create", categories },
      ),
    ).toThrow(BehaviorValidationError);

    try {
      parseBehaviorFormData(
        formData([
          ["title", "Laundry"],
          ["scheduled_time", "10:00"],
          ["recurrence_kind", "weekly"],
          ["weekly_interval", "1"],
          ["reminder_offset", "0"],
        ]),
        { mode: "create", categories },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(BehaviorValidationError);
      expect((error as BehaviorValidationError).fieldErrors.recurrence).toBe(
        "Choose at least one weekday.",
      );
    }
  });

  it("marks an update inactive when the active checkbox is absent", () => {
    const result = parseBehaviorFormData(
      formData([
        ["behavior_id", BEHAVIOR_ID],
        ["title", "Archived behavior"],
        ["scheduled_time", "09:00"],
        ["recurrence_kind", "monthly"],
        ["monthly_interval", "1"],
        ["monthly_day", "31"],
        ["reminder_offset", "1440"],
      ]),
      { mode: "update", categories },
    );

    expect(result.active).toBe(false);
    expect(result.recurrenceRule).toEqual({
      frequency: "monthly",
      interval: 1,
      dayOfMonth: 31,
    });
  });

  it("rejects a category that is not owned by the current user", () => {
    expect(() =>
      parseBehaviorFormData(
        formData([
          ["title", "Matcha"],
          ["category_id", "33333333-3333-4333-8333-333333333333"],
          ["scheduled_time", "11:00"],
          ["recurrence_kind", "daily"],
          ["daily_interval", "1"],
          ["reminder_offset", "0"],
        ]),
        { mode: "create", categories },
      ),
    ).toThrow(BehaviorValidationError);
  });
});

describe("stored recurrence helpers", () => {
  it("normalizes stored monthly rules for form defaults and summaries", () => {
    const recurrenceRule = normalizeRecurrenceRule({
      frequency: "monthly",
      interval: 2,
      dayOfMonth: 31,
    });

    expect(recurrenceDefaultsFromRule(recurrenceRule)).toMatchObject({
      kind: "monthly",
      monthlyInterval: 2,
      monthlyDay: 31,
    });
    expect(summarizeRecurrenceRule(recurrenceRule)).toBe(
      "Every 2 months on day 31",
    );
  });
});

describe("Behavior planning fields", () => {
  function planningForm(duration: string, endDate: string, field = "end_on", extra: [string, string][] = []) {
    return formData([["title", "Walk"], ["scheduled_time", "09:00"], ["recurrence_kind", "daily"],
      ["daily_interval", "1"], ["reminder_offset", "0"], ["default_duration_minutes", duration], [field, endDate], ...extra]);
  }
  it("accepts and clears a default duration and a real calendar end day", () => {
    expect(parseBehaviorFormData(planningForm("45", "2028-02-29"), { mode: "create" }))
      .toMatchObject({ defaultDurationMinutes: 45, endOn: "2028-02-29", endTime: null });
    expect(parseBehaviorFormData(planningForm("45", "2028-02-29", "end_on", [["end_time", "18:30"]]), { mode: "create" }))
      .toMatchObject({ endOn: "2028-02-29", endTime: "18:30" });
    expect(parseBehaviorFormData(planningForm("", ""), { mode: "create" }))
      .toMatchObject({ defaultDurationMinutes: null, endOn: null, endTime: null });
  });
  it("reads a legacy end_date field as the day before", () => {
    expect(parseBehaviorFormData(planningForm("", "2028-03-01", "end_date"), { mode: "create" }))
      .toMatchObject({ endOn: "2028-02-29", endTime: null });
  });
  it("leaves end and pause out when the form has no such fields", () => {
    const result = parseBehaviorFormData(formData([["title", "Walk"], ["scheduled_time", "09:00"], ["recurrence_kind", "daily"],
      ["daily_interval", "1"], ["reminder_offset", "0"]]), { mode: "create" });
    expect(result).not.toHaveProperty("endOn");
    expect(result).not.toHaveProperty("pause");
  });
  it.each(["0", "-1", "1.5", "1441", "Infinity", "abc"])("rejects invalid duration %s", (duration) => {
    expect(() => parseBehaviorFormData(planningForm(duration, ""), { mode: "create" })).toThrow(BehaviorValidationError);
  });
  it.each(["2027-02-29", "2026-13-01", "2026-9-18", "0000-01-01", "2026-09-18T00:00:00Z"])("rejects invalid date %s", (date) => {
    expect(() => parseBehaviorFormData(planningForm("", date), { mode: "create" })).toThrow(BehaviorValidationError);
    expect(() => parseBehaviorFormData(planningForm("", date, "end_date"), { mode: "create" })).toThrow(BehaviorValidationError);
  });
  it("rejects a pause without a back-on day after the first paused day", () => {
    expect(() => parseBehaviorFormData(planningForm("", "", "end_on", [["pause_from_on", "2028-03-02"]]), { mode: "create" }))
      .toThrow(BehaviorValidationError);
    expect(() => parseBehaviorFormData(planningForm("", "", "end_on", [["pause_from_on", "2028-03-02"], ["pause_back_on", "2028-03-02"]]), { mode: "create" }))
      .toThrow(BehaviorValidationError);
  });
});
