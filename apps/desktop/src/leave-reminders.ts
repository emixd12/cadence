import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeaveReminderDeviceNotifications } from "@cadence/core/services/departure-phrases";
import { createLeaveReminderClient, type LeaveReminderClient } from "@/lib/ui/leave-reminders";
import { readDesktopCalendarBrokerOrigin } from "./calendar/google-calendar";
import type { NativeNotificationPermission } from "./settings-screen";

/** Ticket 279: a linked Mac reads and saves the account's switch on the hosted server. Nothing is stored in SQLite. */
export function createDesktopLeaveReminderClient(client: SupabaseClient, origin = readDesktopCalendarBrokerOrigin()): LeaveReminderClient | null {
  if (!origin) return null;
  return createLeaveReminderClient({ origin, accessToken: async () => {
    const session = (await client.auth.getSession()).data.session;
    if (!session) throw new Error("Leave reminder setting needs a signed-in account.");
    return session.access_token;
  } });
}

/** This Mac's notification permission in the readiness list's terms. Null while macOS is still being asked. */
export function nativeLeaveReminderNotifications(permission: NativeNotificationPermission): LeaveReminderDeviceNotifications | null {
  if (permission === "checking") return null;
  if (permission === "authorized" || permission === "provisional") return "enabled";
  if (permission === "denied") return "blocked";
  if (permission === "unavailable") return "unsupported";
  return "not_enabled";
}
