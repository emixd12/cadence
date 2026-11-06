import { readLeaveReminderEnabled, writeLeaveReminderEnabled } from "@/lib/db/leave-reminder-settings.repo";
import type { CalendarCaller } from "./google-calendar.service";
import { getTravelSettings } from "./travel-settings.service";

/** Ticket 279: the one account-wide leave reminder switch. */
export type LeaveReminderSetting = Readonly<{ enabled: boolean }>;

export class LeaveReminderSettingError extends Error {
  constructor(readonly code: "invalid_request" | "travel_off", message: string) {
    super(message);
    this.name = "LeaveReminderSettingError";
  }
}

export async function getLeaveReminderSetting(caller: CalendarCaller): Promise<LeaveReminderSetting> {
  return { enabled: await readLeaveReminderEnabled(caller.client, caller.user.id) };
}

/**
 * Turning reminders on needs Travel estimates on, because every reminder routes. Turning them
 * off always saves; the database then deletes the account's reminder rows (decision D15).
 */
export async function saveLeaveReminderSetting(caller: CalendarCaller, value: unknown): Promise<LeaveReminderSetting> {
  const enabled = parseEnabled(value);
  if (enabled && !(await getTravelSettings(caller)).enabled) {
    throw new LeaveReminderSettingError("travel_off", "Leave reminders need Travel estimates on.");
  }
  return { enabled: await writeLeaveReminderEnabled(caller.client, caller.user.id, enabled) };
}

function parseEnabled(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid();
  const keys = Object.keys(value);
  const enabled = (value as { enabled?: unknown }).enabled;
  if (keys.length !== 1 || keys[0] !== "enabled" || typeof enabled !== "boolean") throw invalid();
  return enabled;
}

function invalid(): LeaveReminderSettingError {
  return new LeaveReminderSettingError("invalid_request", "The leave reminder setting is invalid.");
}
