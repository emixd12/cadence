import type { BehaviorInput } from "@cadence/core/behavior-store";
import { noticeText } from "@cadence/core/notices";
import { BehaviorValidationError } from "@cadence/core/services/behavior-values";
import { parseBehaviorFormData } from "@/lib/services/behavior-form";
import type { BehaviorView } from "@/lib/types/behavior";

/**
 * Form fields shared by the Behavior form and the sub-behavior editor (depth 1). Web
 * server actions and the Mac's local actions read the same fields.
 *
 * - `sub_behavior_count`: drafted sub-behaviors in a create form.
 * - `sub_behavior_{i}_title`, `sub_behavior_{i}_description`.
 * - `sub_behavior_{i}_inherit`: "true" follows the parent's schedule.
 * - `sub_behavior_{i}_recurrence_kind` ("daily" | "weekly"), repeated
 *   `sub_behavior_{i}_weekly_days`, `sub_behavior_{i}_time` (HH:MM): a custom schedule.
 */
export const SUB_BEHAVIOR_COUNT_FIELD = "sub_behavior_count";
const SUB_BEHAVIOR_PREFIX = "sub_behavior_";
const MAX_DRAFT_SUB_BEHAVIORS = 50;

export function subBehaviorField(index: number, name: string): string {
  return `${SUB_BEHAVIOR_PREFIX}${index}_${name}`;
}

export function hasDraftSubBehaviors(formData: FormData): boolean {
  return Number(formData.get(SUB_BEHAVIOR_COUNT_FIELD) ?? 0) > 0;
}

/** A create form with drafted sub-behaviors: the parent plus each sub-behavior, in order. */
export function parseBehaviorGroupFormData(formData: FormData, options: Readonly<{ readAlongside?: boolean }> = {}): {
  parent: BehaviorInput;
  subBehaviors: BehaviorInput[];
} {
  const parentForm = withoutSubBehaviorFields(formData);
  parentForm.delete("parent_behavior_id");
  // Ticket 358: the alongside answer is the parent's own; drafted sub-behaviors start unanswered.
  const parent = parseBehaviorFormData(parentForm, { mode: "create", readAlongside: options.readAlongside === true });
  const count = Math.min(Number(formData.get(SUB_BEHAVIOR_COUNT_FIELD) ?? 0), MAX_DRAFT_SUB_BEHAVIORS);
  const subBehaviors: BehaviorInput[] = [];

  for (let index = 0; index < count; index += 1) {
    const childForm = subBehaviorFormData(formData, parentForm, index);
    try {
      const values = parseBehaviorFormData(childForm, { mode: "create" });
      subBehaviors.push({
        ...values,
        parentBehaviorId: null,
        inheritParentSchedule: formData.get(subBehaviorField(index, "inherit")) !== "false",
        subBehaviorSortOrder: index,
      });
    } catch (error) {
      if (!(error instanceof BehaviorValidationError)) throw error;
      const reason = Object.values(error.fieldErrors)[0] ?? error.message;
      throw new BehaviorValidationError(noticeText("sub-behaviors.check-row", { position: index + 1, reason }), {});
    }
  }

  return { parent, subBehaviors };
}

function withoutSubBehaviorFields(formData: FormData): FormData {
  const form = new FormData();
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(SUB_BEHAVIOR_PREFIX)) form.append(name, value);
  }
  return form;
}

/** A sub-behavior takes the parent's other settings (Where, category, reminders) and, when custom, its own schedule. */
function subBehaviorFormData(source: FormData, parentForm: FormData, index: number): FormData {
  const form = new FormData();
  for (const [name, value] of parentForm.entries()) {
    if (name !== "title" && name !== "description") form.append(name, value);
  }
  form.set("title", String(source.get(subBehaviorField(index, "title")) ?? ""));
  form.set("description", String(source.get(subBehaviorField(index, "description")) ?? ""));
  if (source.get(subBehaviorField(index, "inherit")) !== "false") return form;

  for (const name of [...form.keys()]) {
    if (name.startsWith("schedule_") || name.startsWith("behavior_schedule_")) form.delete(name);
  }
  const kind = source.get(subBehaviorField(index, "recurrence_kind")) === "weekly" ? "weekly" : "daily";
  form.set("behavior_schedule_count", "1");
  form.set("behavior_schedule_id_0", "");
  form.set("schedule_0_recurrence_kind", kind);
  if (kind === "weekly") {
    form.set("schedule_0_weekly_interval", "1");
    for (const day of source.getAll(subBehaviorField(index, "weekly_days"))) form.append("schedule_0_weekly_days", day);
  } else {
    form.set("schedule_0_daily_interval", "1");
  }
  form.set("schedule_0_time_entry_count", "1");
  form.set("schedule_0_time_entry_id_0", "");
  form.set("schedule_0_time_entry_kind_0", "exact");
  form.set("schedule_0_time_entry_exact_time_0", String(source.get(subBehaviorField(index, "time")) ?? ""));
  return form;
}

/**
 * The full edit form of a saved Behavior, so a list action (detach, add under a parent)
 * can save one link change through the same update action as the Behavior form.
 */
export function behaviorViewFormData(
  behavior: BehaviorView,
  link: { parentBehaviorId: string | null; inheritParentSchedule?: boolean },
): FormData {
  const form = new FormData();
  const set = (name: string, value: string | number | null | undefined) => form.set(name, value == null ? "" : String(value));
  set("behavior_id", behavior.id);
  set("expected_updated_at", behavior.updatedAt);
  set("title", behavior.title);
  set("description", behavior.description);
  set("category_id", behavior.categoryId);
  set("where_kind", behavior.whereKind ?? "");
  set("location_text", behavior.whereKind === "place" ? behavior.locationText : "");
  set("default_duration_minutes", behavior.defaultDurationMinutes);
  set("end_on", behavior.endOn);
  set("end_time", behavior.endOn ? behavior.endTime?.slice(0, 5) : "");
  if (behavior.browserReminderEnabled) set("browser_reminder", "on");
  if (behavior.emailReminderEnabled) set("email_reminder", "on");
  set("reminder_offset", behavior.reminderOffsetMinutes);
  if (behavior.active) set("active", "on");

  const schedules = behavior.schedules ?? [];
  set("behavior_schedule_count", schedules.length);
  schedules.forEach((schedule, index) => {
    const prefix = `schedule_${index}`;
    const defaults = schedule.recurrenceDefaults;
    set(`behavior_schedule_id_${index}`, schedule.id);
    set(`${prefix}_recurrence_kind`, defaults.kind);
    set(`${prefix}_daily_interval`, defaults.dailyInterval);
    set(`${prefix}_every_days`, defaults.everyDays);
    set(`${prefix}_weekly_interval`, defaults.weeklyInterval);
    for (const day of defaults.weeklyDays) form.append(`${prefix}_weekly_days`, day);
    set(`${prefix}_monthly_interval`, defaults.monthlyInterval);
    set(`${prefix}_monthly_day`, defaults.monthlyDay);
    set(`${prefix}_time_entry_count`, schedule.timeEntries.length);
    schedule.timeEntries.forEach((entry, entryIndex) => {
      const entryPrefix = `${prefix}_time_entry`;
      set(`${entryPrefix}_id_${entryIndex}`, entry.id);
      set(`${entryPrefix}_kind_${entryIndex}`, entry.kind);
      if (entry.kind === "range") {
        set(`${entryPrefix}_range_preset_${entryIndex}`, entry.preset ?? "custom");
        set(`${entryPrefix}_range_start_${entryIndex}`, entry.startTime);
        set(`${entryPrefix}_range_end_${entryIndex}`, entry.endTime);
      } else {
        set(`${entryPrefix}_exact_time_${entryIndex}`, entry.startTime);
      }
    });
  });

  set("parent_behavior_id", link.parentBehaviorId);
  if (link.parentBehaviorId) set("inherit_parent_schedule", String(link.inheritParentSchedule ?? true));
  return form;
}

/** A new sub-behavior under a saved parent: the parent's settings with a new title. */
export function newSubBehaviorFormData(parent: BehaviorView, title: string): FormData {
  const form = behaviorViewFormData(parent, { parentBehaviorId: parent.id, inheritParentSchedule: true });
  for (const name of ["behavior_id", "expected_updated_at", "active", "description"]) form.delete(name);
  for (const name of [...form.keys()]) {
    if (/^behavior_schedule_id_|_time_entry_id_/u.test(name)) form.set(name, "");
  }
  form.set("title", title);
  return form;
}
