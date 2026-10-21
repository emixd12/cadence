import type { BehaviorOutput, IntegrationOperationInput } from "@cadence/core/integration";
import { parseBehaviorFormData } from "@/lib/services/behavior-form";

// Feed structured input through the web form validator, including duplicate times and normalization.
export function integrationBehaviorInput(
  input: IntegrationOperationInput<"create_behavior"> | IntegrationOperationInput<"update_behavior">,
  current?: BehaviorOutput,
) {
  const form = new FormData();
  const set = (key: string, value: unknown) => form.set(key, value == null ? "" : String(value));
  const fields = { ...current, ...input };
  for (const name of ["title", "description", "location_text", "default_duration_minutes", "end_date"] as const) {
    set(name, fields[name]);
  }
  set("category_id", input.category_id === undefined ? current?.category?.id : input.category_id);
  set("behavior_id", current?.id);
  set("active", current?.state === "archived" ? "false" : "true");
  const reminders = { browser_enabled: true, email_enabled: false, offset_minutes: 0, ...current?.reminders, ...input.reminders };
  set("browser_reminder", reminders.browser_enabled);
  set("email_reminder", reminders.email_enabled);
  set("reminder_offset", reminders.offset_minutes);
  const schedules = input.schedules ?? current?.schedules ?? [];
  set("behavior_schedule_count", schedules.length);
  schedules.forEach((schedule, i) => {
    set(`behavior_schedule_id_${i}`, schedule.id);
    const rule = schedule.recurrence;
    const prefix = `schedule_${i}`;
    set(`${prefix}_recurrence_kind`, rule.frequency === "interval_days" ? "every_days" : rule.frequency);
    if (rule.frequency === "interval_days") set(`${prefix}_every_days`, rule.interval_days);
    else set(`${prefix}_${rule.frequency}_interval`, rule.interval);
    if (rule.frequency === "weekly") rule.days_of_week.forEach(day => form.append(`${prefix}_weekly_days`, day));
    if (rule.frequency === "monthly") set(`${prefix}_monthly_day`, rule.day_of_month);
    set(`${prefix}_time_entry_count`, schedule.time_entries.length);
    schedule.time_entries.forEach((entry, j) => {
      set(`${prefix}_time_entry_id_${j}`, entry.id);
      set(`${prefix}_time_entry_kind_${j}`, entry.kind);
      if (entry.kind === "exact") set(`${prefix}_time_entry_exact_time_${j}`, entry.start_time);
      else {
        set(`${prefix}_time_entry_range_preset_${j}`, "preset" in entry ? entry.preset : null);
        set(`${prefix}_time_entry_range_start_${j}`, "start_time" in entry ? entry.start_time : null);
        set(`${prefix}_time_entry_range_end_${j}`, "end_time" in entry ? entry.end_time : null);
      }
    });
  });
  return parseBehaviorFormData(form, { mode: current ? "update" : "create" });
}
