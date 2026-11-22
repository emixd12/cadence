import type { BehaviorOutput, IntegrationOperationInput, ScheduleInput } from "@cadence/core/integration";
import { parseBehaviorFormData } from "@/lib/services/behavior-form";

type BehaviorWriteInput = Omit<IntegrationOperationInput<"create_behavior">, "sub_behaviors"> | IntegrationOperationInput<"update_behavior">;

/**
 * Feed structured input through the web form validator, including duplicate times and normalization.
 * `scheduleFallback` stands in for omitted schedules of a sub-behavior that follows its parent:
 * the service stores the parent's schedule over it. `sub_behavior_sort_order` on an update is
 * applied as a sibling reorder, not here.
 */
export function integrationBehaviorInput(
  input: BehaviorWriteInput,
  current?: BehaviorOutput,
  scheduleFallback: readonly (ScheduleInput | BehaviorOutput["schedules"][number])[] = [],
) {
  const form = new FormData();
  const set = (key: string, value: unknown) => form.set(key, value == null ? "" : String(value));
  const fields = { ...current, ...input };
  for (const name of ["title", "description", "location_text", "default_duration_minutes"] as const) {
    set(name, fields[name]);
  }
  // end_date is the deprecated alias (the first day without the Behavior); end_on wins.
  if (input.end_on !== undefined || input.end_time !== undefined || input.end_date === undefined) {
    set("end_on", input.end_on !== undefined ? input.end_on : current?.end_on);
    set("end_time", input.end_time !== undefined ? input.end_time : input.end_on !== undefined ? null : current?.end_time);
  } else {
    set("end_date", input.end_date);
  }
  set("category_id", input.category_id === undefined ? current?.category?.id : input.category_id);
  set("behavior_id", current?.id);
  set("active", current?.state === "archived" ? "false" : "true");
  const parentId = input.parent_behavior_id !== undefined ? input.parent_behavior_id : current?.parent_behavior_id ?? null;
  const linkChanged = parentId !== (current?.parent_behavior_id ?? null);
  if (input.parent_behavior_id !== undefined || current) {
    set("parent_behavior_id", parentId);
    const inherit = input.inherit_parent_schedule ?? (current && !linkChanged ? current.inherit_parent_schedule : undefined);
    if (parentId && inherit !== undefined) set("inherit_parent_schedule", inherit);
    if (parentId && !current && "sub_behavior_sort_order" in input && input.sub_behavior_sort_order !== undefined) {
      set("sub_behavior_sort_order", input.sub_behavior_sort_order);
    }
  }
  const reminders = { browser_enabled: true, email_enabled: false, offset_minutes: 0, ...current?.reminders, ...input.reminders };
  set("browser_reminder", reminders.browser_enabled);
  set("email_reminder", reminders.email_enabled);
  set("reminder_offset", reminders.offset_minutes);
  // Empty schedules are valid only with the flag on, so an update always sends the flag it keeps.
  const isOpportunity = input.is_opportunity ?? current?.is_opportunity;
  if (isOpportunity !== undefined) set("is_opportunity", isOpportunity);
  const withoutId = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "id"));
  const schedules = input.schedules ?? current?.schedules ?? scheduleFallback.map((schedule) => ({
    recurrence: schedule.recurrence, time_entries: schedule.time_entries.map(withoutId),
  })) as unknown as readonly ScheduleInput[];
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
