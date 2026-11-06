import { useCallback, useEffect, useMemo, useRef } from "react";
import type { DepartureSnapshot } from "@/components/timeline/DayProgressTimeline";
import type { LeaveReminderClient } from "@/lib/ui/leave-reminders";
import { reconcileLeaveReminders } from "./local-leave-reminder.service";
import { readLocalTravelSettings } from "./local-travel-settings.service";

/**
 * Ticket 280: reconciles the Mac's leave reminders on launch, account change, resume, local day
 * change and each travel update, and after the switch saves. No background helper: macOS fires
 * what was last scheduled, with Cadence quit.
 */
export function useDesktopLeaveReminders(input: Readonly<{
  native: boolean;
  /** False until the saved session has been read, so a launch never clears what is scheduled. */
  accountKnown: boolean;
  accountId: string | null;
  timezone: string;
  client: LeaveReminderClient | null;
}>) {
  const { native, accountKnown, accountId, timezone, client } = input;
  const snapshot = useRef<DepartureSnapshot | null>(null);
  const snapshotKey = useRef("");
  const reconcile = useCallback(() => {
    if (!native || !accountKnown) return;
    const departure = snapshot.current;
    // Travel estimates off means no reminders, whatever the account switch says.
    const loadEnabled = client ? async () => (await readLocalTravelSettings()).enabled && (await client.load()).enabled : null;
    void reconcileLeaveReminders({ accountId, timezone, loadEnabled,
      departure: departure?.trips ? { localDate: departure.localDate, timezone, preparationSeconds: departure.preparationSeconds,
        trips: departure.trips, stops: departure.stops } : null }).catch(() => {
      // macOS or the hosted switch was unavailable. The next launch, resume or travel update tries again.
    });
  }, [native, accountKnown, accountId, timezone, client]);
  useEffect(() => { reconcile(); }, [reconcile]);
  const onDeparture = useCallback((next: DepartureSnapshot) => {
    snapshot.current = next;
    const nowMs = Date.now();
    // The model changes every minute; only a new estimate, trip, stop or day needs a reconcile.
    const key = JSON.stringify([next.localDate, next.preparationSeconds, next.trips === null,
      (next.trips ?? []).filter((trip) => trip.role !== "return" && trip.leaveAt && Date.parse(trip.leaveAt) > nowMs)
        .map((trip) => [trip.destinationRef, trip.originRef, trip.fromHome, trip.mode, trip.leaveAt, trip.arriveAt, trip.checkedAt]),
      next.stops.map((stop) => [stop.ref, stop.startAt, stop.label])]);
    if (key === snapshotKey.current) return;
    snapshotKey.current = key;
    reconcile();
  }, [reconcile]);
  const settingsClient = useMemo((): LeaveReminderClient | null => client ? {
    load: client.load,
    save: async (enabled) => {
      const saved = await client.save(enabled);
      reconcile();
      return saved;
    },
  } : null, [client, reconcile]);
  return { onDeparture, reconcile, settingsClient };
}
