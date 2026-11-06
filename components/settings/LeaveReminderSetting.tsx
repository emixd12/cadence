"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  LEAVE_REMINDER_HOME_MISSING,
  LEAVE_REMINDER_HOME_SAVED,
  LEAVE_REMINDER_LOAD_FAILED,
  LEAVE_REMINDER_NOTIFICATIONS_STEP,
  LEAVE_REMINDER_SAVED,
  LEAVE_REMINDER_SAVE_FAILED,
  LEAVE_REMINDER_SOURCES,
  LEAVE_REMINDER_START_MAC,
  LEAVE_REMINDER_START_WEB,
  LEAVE_REMINDER_SWITCH,
  LEAVE_REMINDER_TRAVEL_OFF,
  leaveReminderNotificationsPhrase,
  type LeaveReminderDeviceNotifications,
} from "@cadence/core/services/departure-phrases";
import type { LeaveReminderClient } from "@/lib/ui/leave-reminders";

/**
 * Ticket 279 (decision D3): one account-wide switch and what it still needs on this device.
 * The switch saves at once. Turning it off deletes the account's reminder records on the server.
 */
export function LeaveReminderSetting({ client, readDeviceNotifications, homeSaved, travelEnabled, desktop = false }: Readonly<{
  client: LeaveReminderClient;
  readDeviceNotifications: () => Promise<LeaveReminderDeviceNotifications | null>;
  homeSaved: boolean;
  travelEnabled: boolean;
  desktop?: boolean;
}>) {
  const id = useId();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [notifications, setNotifications] = useState<LeaveReminderDeviceNotifications | null>(null);
  const sequence = useRef(0);
  const notificationSequence = useRef(0);
  const refreshNotifications = () => {
    const current = ++notificationSequence.current;
    void readDeviceNotifications().then((value) => { if (current === notificationSequence.current) setNotifications(value); })
      .catch(() => { if (current === notificationSequence.current) setNotifications(null); });
  };
  useEffect(() => {
    refreshNotifications();
    // The cleanup deliberately invalidates a pending read. A new reader (a changed macOS permission) reads again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { notificationSequence.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readDeviceNotifications]);
  useEffect(() => {
    const current = ++sequence.current;
    void client.load().then((value) => { if (current === sequence.current) setEnabled(value.enabled); })
      .catch(() => { if (current === sequence.current) setMessage(LEAVE_REMINDER_LOAD_FAILED); });
    // The cleanup deliberately invalidates every pending load and save result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { sequence.current++; };
  }, [client]);
  const save = async (next: boolean) => {
    const current = ++sequence.current;
    setPending(true); setMessage("");
    try {
      const saved = await client.save(next);
      if (current !== sequence.current) return;
      setEnabled(saved.enabled);
      setMessage(LEAVE_REMINDER_SAVED);
    } catch { if (current === sequence.current) setMessage(LEAVE_REMINDER_SAVE_FAILED); }
    finally { if (current === sequence.current) { setPending(false); refreshNotifications(); } }
  };
  // Reminders route, so they cannot turn on while Travel estimates is off. They can always turn off.
  const unavailable = enabled === null || pending || (!enabled && !travelEnabled);
  return <div className="grid gap-1" data-leave-reminder-setting>
    <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={enabled === true} disabled={unavailable}
      aria-describedby={`${id}-readiness`} onChange={(event) => { void save(event.target.checked); }} /><span>{LEAVE_REMINDER_SWITCH}</span></label>
    <div id={`${id}-readiness`} className="grid max-w-2xl gap-1 pl-7 text-muted-readable">
      <ul className="grid gap-1" aria-label="What reminders need">
        {travelEnabled ? null : <li>{LEAVE_REMINDER_TRAVEL_OFF}</li>}
        {notifications ? <li>{leaveReminderNotificationsPhrase(notifications, desktop)}
          {notifications === "not_enabled" || notifications === "blocked" ? <> <a href="#notifications" className="text-link">{LEAVE_REMINDER_NOTIFICATIONS_STEP}</a></> : null}</li> : null}
        <li>{homeSaved ? LEAVE_REMINDER_HOME_SAVED : LEAVE_REMINDER_HOME_MISSING}</li>
        <li>{desktop ? LEAVE_REMINDER_START_MAC : LEAVE_REMINDER_START_WEB}</li>
      </ul>
      <p>{LEAVE_REMINDER_SOURCES}</p>
    </div>
    {message ? <p role="status" className="pl-7">{message}</p> : null}
  </div>;
}
