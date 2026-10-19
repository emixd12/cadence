import { combineExternalEventFreshness } from "@cadence/core/services/external-event-projection";
import type { ExternalEventFreshness } from "@cadence/core/types/day-progress";
import type { ExternalEventSnapshotV1 } from "@cadence/core/types/external-event";
import type { ConnectorTimelineState, OutlookTimelineState } from "@/lib/ui/connectors";

// Ticket 238 review fix: desktop Timeline freshness and status lines follow the
// web semantics in DayProgressTimeline. Google contributes freshness only when
// it has a snapshot; an unused Google connection never weakens Outlook context
// or adds its "not connected" line while Outlook is active.

/** Desktop Google labels that mean Google is simply not in use (web: disconnected or not configured). */
export const DESKTOP_GOOGLE_UNUSED_LABELS: ReadonlySet<string> = new Set([
  "Google Calendar is not connected.",
  "Calendar is unavailable in this build.",
  "Calendar requires a linked account.",
]);

/** Desktop Google labels for a connected source that cannot read (web: reconnect, unavailable, or error). */
export const DESKTOP_GOOGLE_FAILING_LABELS: ReadonlySet<string> = new Set([
  "Reconnect Google Calendar.",
  "Calendar data is unavailable.",
  "Calendar cache is unavailable.",
]);

const OUTLOOK_ACTIVE: ReadonlySet<ConnectorTimelineState> = new Set(["reconnect_required", "empty", "ready", "stale", "incomplete", "error"]);

export type DesktopGoogleTimelineInput = Readonly<{ snapshot: ExternalEventSnapshotV1 | null; stale: boolean; label: string; error?: string | null }>;

export function desktopTimelineFreshness(google: DesktopGoogleTimelineInput, outlook: OutlookTimelineState, icloud?: OutlookTimelineState): Readonly<{
  freshness: ExternalEventFreshness;
  sourceMessages: string[];
}> {
  const icloudActive = icloud !== undefined && OUTLOOK_ACTIVE.has(icloud.state);
  const outlookActive = OUTLOOK_ACTIVE.has(outlook.state);
  const googleFreshness: ExternalEventFreshness | null = google.snapshot
    ? { ...google.snapshot.freshness, label: google.label, ...(google.stale ? { state: "stale" as const, canAssertNoOverlap: false } : {}) }
    : null;
  const outlookFreshness: ExternalEventFreshness | null = !outlookActive ? null
    : outlook.snapshot && (outlook.state === "ready" || outlook.state === "empty") ? outlook.snapshot.freshness
      : { state: outlook.state === "incomplete" ? "incomplete" : outlook.snapshot ? "stale" : "unavailable",
        refreshedAt: outlook.snapshot?.fetchedAt ?? null, label: "Outlook Calendar context may be out of date", canAssertNoOverlap: false };
  const icloudFreshness: ExternalEventFreshness | null = !icloudActive ? null
    : icloud!.snapshot && (icloud!.state === "ready" || icloud!.state === "empty") ? icloud!.snapshot.freshness
      : { state: icloud!.state === "incomplete" ? "incomplete" : icloud!.snapshot ? "stale" : "unavailable",
        refreshedAt: icloud!.snapshot?.fetchedAt ?? null, label: "iCloud Calendar context may be out of date", canAssertNoOverlap: false };
  const unavailable: ExternalEventFreshness = { state: "unavailable", refreshedAt: null, label: google.label, canAssertNoOverlap: false };
  // A connected Google source that cannot read still blocks no-overlap claims; an unused one does not.
  const googleFailing = !google.snapshot && (Boolean(google.error) || DESKTOP_GOOGLE_FAILING_LABELS.has(google.label));
  const freshness = combineExternalEventFreshness([...(googleFreshness ? [googleFreshness] : googleFailing ? [unavailable] : []),
    ...(outlookFreshness ? [outlookFreshness] : []), ...(icloudFreshness ? [icloudFreshness] : [])])
    // Neither source is active: keep the existing Google-only label and unavailable state.
    ?? unavailable;
  const messages = [...(outlookActive ? calendarMessages(outlook.state, outlook.error, "Outlook Calendar") : []),
    ...(icloudActive ? calendarMessages(icloud.state, icloud.error, "iCloud Calendar") : [])];
  // Without a Google snapshot, Google's own state still speaks unless Google is simply unused.
  if ((outlookActive || icloudActive) && !google.snapshot && !googleFailing && !DESKTOP_GOOGLE_UNUSED_LABELS.has(google.label)) messages.unshift(google.label);
  return { freshness, sourceMessages: messages };
}

function calendarMessages(state: ConnectorTimelineState, error: string | null, name: string): string[] {
  if (state === "stale") return [`Saved ${name} context may be out of date.`];
  if (state === "incomplete") return [`${name} context is incomplete; some events may be missing.`];
  if (state === "error") return [`${name} context could not refresh: ${error ?? "unavailable"}.`];
  if (state === "reconnect_required") return [`${name} needs reconnection in Settings.`];
  return [];
}
