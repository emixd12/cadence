"use client";

import { Temporal } from "@js-temporal/polyfill";
import { ExternalLink, X } from "lucide-react";
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ExternalEventSource, NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { TravelEvidenceResult, TravelMode, TravelNavigationPreference } from "@cadence/core/types/travel";
import { buildTravelNavigationLink } from "@cadence/core/services/travel-navigation";
import { TRAVEL_LEG_OUTSIDE_WINDOW } from "@cadence/core/services/travel-refresh-policy";
import type { TravelCorrection } from "@/lib/ui/travel";
import { platformNavigationPreference } from "@/lib/ui/navigation-platform";
import { TravelWeatherCredit, travelWeatherMarginText } from "./TravelWeather";

import styles from "./day-progress-timeline.module.css";

const SOURCE_NAMES: Readonly<Record<ExternalEventSource, string>> = {
  google_calendar: "Google Calendar",
  outlook_calendar: "Outlook Calendar",
  icloud_calendar: "iCloud Calendar",
};

/** Ticket 238 source label for scheduled calendar events. */
export function externalEventSourceName(source: ExternalEventSource): string {
  return SOURCE_NAMES[source] ?? "Calendar";
}

type ExternalEventPreviewProps = Readonly<{
  id: string;
  events: readonly NormalizedExternalEvent[];
  timezone: string;
  onDismiss: () => void;
  onOpen: (event: NormalizedExternalEvent) => void;
  travel?: Omit<TravelEvidenceResult, "modelProjection"> | null;
}>;

export function ExternalEventPreview({
  id,
  events,
  timezone,
  onDismiss,
  onOpen,
  travel,
}: ExternalEventPreviewProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    ref.current?.showPopover?.();
  }, []);

  if (events.length === 0) return null;
  const allDay = events.every((event) => event.kind === "all_day");
  return (
    <div
      ref={ref}
      id={id}
      popover="manual"
      role="dialog"
      aria-label={allDay ? "All Day Events preview" : `Calendar preview: ${events[0]!.title || "Untitled event"}`}
      className={styles.drawer}
      data-calendar-drawer="preview"
    >
      <div className={styles.drawerContent}>
        <div className={styles.drawerEvents}>
          {events.map((event) => (
            <article key={event.id} className="min-w-0">
              <h3 className="break-words font-bold">{event.title || "Untitled event"}</h3>
              <p className="mt-1 text-xs text-muted-readable">
                {event.calendarName} · {eventTimeLabel(event, timezone)}
              </p>
              {event.location ? <p className="mt-2 break-words text-xs">{event.location}</p> : null}
              {renderTravelTiming({ eventId: event.id, travel, timezone, compact: true })}
              <button
                type="button"
                onClick={() => onOpen(event)}
                aria-label={`View details: ${event.title || "Untitled event"}`}
                className="min-h-11 font-bold underline underline-offset-4"
              >
                View details
              </button>
            </article>
          ))}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss Calendar preview"
          className={`${styles.previewClose} grid h-11 w-11 shrink-0 place-items-center`}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

type ExternalEventDetailsProps = Readonly<{
  event: NormalizedExternalEvent | null;
  timezone: string;
  onClose: () => void;
  onDismissAllDay: (eventId: string) => void;
  onOpenExternal?: (url: string) => void | Promise<void>;
  travel?: Omit<TravelEvidenceResult, "modelProjection"> | null;
  navigationPreference?: TravelNavigationPreference | null;
  travelMode?: TravelMode | null;
  onTravelCorrection?: (correction: TravelCorrection) => void;
}>;

export const ExternalEventDetails = forwardRef<HTMLDialogElement, ExternalEventDetailsProps>(
  function ExternalEventDetails({ event, timezone, onClose, onDismissAllDay, onOpenExternal, travel, navigationPreference, travelMode, onTravelCorrection }, ref) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [linkError, setLinkError] = useState(false);
    const openExternal = (url: string) => {
      setLinkError(false);
      void Promise.resolve().then(() => onOpenExternal?.(url)).catch(() => setLinkError(true));
    };

    useEffect(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (!event) { if (dialog.open) dialog.close(); return; }
      dialog.showModal();
    }, [event]);

    const setRef = (node: HTMLDialogElement | null) => {
      dialogRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    };
    const close = () => dialogRef.current?.close();
    const navigation = event ? buildTravelNavigationLink({ locationText: event.location,
      preference: navigationPreference ?? platformNavigationPreference(), mode: travelMode,
      resolved: travel?.legs.some((item) => item.state === "current" && item.leg.destinationCommitmentRef === event.id && item.leg.provenance.destinationSource === "calendar") }) : null;

    return (
      <dialog
        ref={setRef}
        onClose={onClose}
        aria-labelledby="calendar-details-title"
        className={styles.details}
        data-calendar-drawer="details"
      >
        <div className="flex items-start justify-between border-b border-line p-4">
          <div className="min-w-0">
            <p className="text-xs font-bold text-muted-readable">Calendar details</p>
            <h2 id="calendar-details-title" className="mt-1 text-xl font-bold">
              {event?.title || "Untitled event"}
            </h2>
          </div>
          <button type="button" onClick={close} className="grid h-11 w-11 shrink-0 place-items-center" aria-label="Close Calendar details">
            <X aria-hidden="true" />
          </button>
        </div>
        {event ? <div className="grid gap-4 p-4">
          {linkError ? <p role="alert">The link could not open. Try again.</p> : null}
          <article className="grid min-w-0 gap-2 text-sm leading-6">
            <p className="break-words">{event.description || unavailable(event, "description")}</p>
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3">
              <dt className="font-bold">Source</dt><dd>{externalEventSourceName(event.source)}</dd>
              <dt className="font-bold">Calendar</dt><dd>{event.calendarName}</dd>
              <dt className="font-bold">Time</dt><dd>{eventTimeLabel(event, timezone)}</dd>
              <dt className="font-bold">Duration</dt><dd>{event.duration.kind === "known" ? `${event.duration.seconds / 60} minutes` : event.duration.kind === "calendar_days" ? `${event.duration.days} calendar days` : "Unknown"}</dd>
              <dt className="font-bold">Location</dt><dd className="break-words">{event.location || unavailable(event, "location")}</dd>
              <dt className="font-bold">Organizer</dt><dd className="break-words">{event.organizer ? [event.organizer.displayName, event.organizer.email].filter(Boolean).join(" · ") : unavailable(event, "organizer")}</dd>
              <dt className="font-bold">Attendees</dt><dd className="break-words">{event.attendees?.map((item) => `${item.displayName ?? item.email ?? "Unnamed attendee"} (${item.responseStatus.replaceAll("_", " ")})`).join(", ") || unavailable(event, "attendees")}</dd>
              <dt className="font-bold">Conference</dt><dd className="break-words">{event.conference?.name ?? unavailable(event, "conference")}</dd>
              <dt className="font-bold">Attachments</dt><dd className="break-words">{event.attachments?.map((item) => item.title ?? "Untitled attachment").join(", ") || unavailable(event, "attachments")}</dd>
              <dt>State</dt><dd>{event.state} · {event.availability}</dd>
              <dt>Source timezone</dt><dd>{event.sourceTimezone}</dd>
              <dt>Recurrence</dt><dd className="break-words">{event.recurrence ? `${event.recurrence.seriesId} · ${event.recurrence.originalStart.kind === "timed" ? event.recurrence.originalStart.startAt : event.recurrence.originalStart.startLocalDate}` : "Not recurring or unavailable"}</dd>
              <dt>Updated</dt><dd>{event.revision.providerUpdatedAt ?? "Not provided"}</dd>
            </dl>
            {navigation ? <><a href={navigation.href} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline" onClick={onOpenExternal ? (click) => { click.preventDefault(); openExternal(navigation.href); } : undefined}>{navigation.label}</a>{navigation.modeNotice ? <p>{navigation.modeNotice}</p> : null}</> : null}
            {renderTravelTiming({ eventId: event.id, travel, timezone, onOpenExternal })}
            {onTravelCorrection && event.kind === "timed" && (event.revision.providerEtag || event.revision.providerUpdatedAt) ? <form key={`${event.id}-${event.revision.providerEtag ?? event.revision.providerUpdatedAt}`} className="grid gap-2 border-t border-line pt-3" onSubmit={(submit) => {
              submit.preventDefault();
              const data = new FormData(submit.currentTarget);
              const attendance = data.get("travel_attendance");
              if (attendance !== "physical" && attendance !== "remote") return;
              onTravelCorrection({ eventId: event.id, revision: event.revision.providerEtag ?? event.revision.providerUpdatedAt!, attendance,
                locationText: String(data.get("travel_location") ?? "").trim() || null });
            }}>
              <p className="font-bold">Travel for this event</p>
              <label className="grid gap-1">Attendance<select name="travel_attendance" required defaultValue="" className="min-h-11 min-w-0 border-b border-line bg-background"><option value="">Choose attendance</option><option value="physical">In person</option><option value="remote">Remote, no travel</option></select></label>
              <label className="grid gap-1">Destination for this journey<input name="travel_location" maxLength={500} defaultValue={event.location} className="min-h-11 min-w-0 border-b border-line bg-background" /></label>
              <p className="text-muted-readable">Applies only to this event revision while the Timeline is open. Calendar and saved locations stay unchanged.</p>
              <button type="submit" className="product-action product-action-secondary min-h-11 w-fit">Use for this journey</button>
            </form> : null}
            {Object.entries(event.detailCompleteness).filter(([, state]) => state !== "complete").map(([field, state]) => <p key={field} className="text-muted-readable">{field.replaceAll("_", " ")}: {state?.replaceAll("_", " ")}</p>)}
            {event.conference?.notes ? <p className="break-words">{event.conference.notes}</p> : null}
            {event.conference?.entryPoints.map((entry, index) => safeHref(entry.uri) ? <a key={index} href={safeHref(entry.uri)!} onClick={onOpenExternal ? (event) => { event.preventDefault(); openExternal(safeHref(entry.uri)!); } : undefined} target="_blank" rel="noreferrer" className="min-h-11 underline">{entry.label ?? entry.type}</a> : <p key={index} className="break-words">{entry.label ?? entry.type}: {entry.uri}</p>)}
            {event.attachments?.map((attachment, index) => safeHref(attachment.url) ? <a key={index} href={safeHref(attachment.url)!} onClick={onOpenExternal ? (event) => { event.preventDefault(); openExternal(safeHref(attachment.url)!); } : undefined} target="_blank" rel="noreferrer" className="min-h-11 underline">{attachment.title ?? "Open attachment"}</a> : null)}
            {event.kind === "all_day" ? <button type="button" onClick={() => onDismissAllDay(event.id)} className="min-h-11 text-left font-bold underline underline-offset-4" aria-label={`Dismiss all-day event: ${event.title || "Untitled event"}`}>Dismiss from timeline</button> : null}
            {safeHref(event.sourceUrl) ? <a href={safeHref(event.sourceUrl)!} onClick={onOpenExternal ? (click) => { click.preventDefault(); openExternal(safeHref(event.sourceUrl)!); } : undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold underline underline-offset-4">Open source event <ExternalLink size={14} aria-hidden="true" /></a> : null}
          </article>
        </div> : null}
      </dialog>
    );
  },
);

export function renderTravelTiming({ eventId, travel, timezone, compact = false, onOpenExternal }: Readonly<{
  eventId: string; travel?: Omit<TravelEvidenceResult, "modelProjection"> | null; timezone: string; compact?: boolean;
  onOpenExternal?: (url: string) => void | Promise<void>;
}>) {
  const legs = travel?.legs.filter((item) => item.leg.originCommitmentRef === eventId || item.leg.destinationCommitmentRef === eventId) ?? [];
  if (!legs.length) return null;
  const label = (value: string) => Temporal.Instant.from(value).toZonedDateTimeISO(timezone).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const originLabels = { device: "current device position", saved_base: "Home", planned_stop: "planned prior stop", correction: "journey correction", calendar: "Calendar location", behavior: "Behavior location" };
  return <div className="grid gap-1 text-xs leading-5" aria-label="Travel timing">
    {legs.map(({ leg, state, estimate, reason, weather }) => <p key={leg.id}>
      {leg.role === "outbound" ? "Outbound" : leg.role === "return" ? "Return home" : "Onward"} · {leg.mode}: {state === "current" && estimate ? `leave ${label(weather?.departureAt ?? estimate.departureAt)}, arrive ${label(weather?.arrivalAt ?? estimate.arrivalAt)}` : reason === TRAVEL_LEG_OUTSIDE_WINDOW ? "estimated within 3 hours of departure" : "timing unavailable"}.
      {weather?.state === "margin" ? ` ${travelWeatherMarginText({ marginMinutes: weather.marginSeconds / 60, conditions: weather.conditions, suggestion: weather.suggestion })}` : ""}
      {!compact ? ` Origin: ${(leg.originCommitmentRef ? "planned prior stop" : originLabels[leg.provenance.originSource])}.` : ""}
    </p>)}
    {!travel?.completeTrip ? <p>Full-trip availability is unknown. Known travel spans still apply.</p> : travel.finalAvailabilityAt ? <p>Available again {label(travel.finalAvailabilityAt)}.</p> : null}
    {!compact ? <>{legs.flatMap((item) => item.estimate?.warnings ?? []).filter((warning, index, all) => all.indexOf(warning) === index).map((warning) => <p key={warning}>{warning}</p>)}
      </> : null}
      {legs.some((item) => item.estimate) ? <p>Google Maps · {legs.find((item) => item.estimate)?.estimate?.observedAt ? `Checked ${label(legs.find((item) => item.estimate)!.estimate!.observedAt)}. ` : ""}Estimates depend on attendance and current conditions.</p> : null}
      {travel?.weather?.attribution && legs.some((item) => item.weather?.state === "margin") ? <TravelWeatherCredit attribution={travel.weather.attribution} onOpenExternal={onOpenExternal} /> : null}
  </div>;
}

export function eventTimeLabel(event: NormalizedExternalEvent, timezone: string): string {
  if (event.kind === "all_day") return `${event.startLocalDate} through ${event.endLocalDate} (exclusive)`;
  const start = Temporal.Instant.from(event.startAt).toZonedDateTimeISO(timezone);
  const end = Temporal.Instant.from(event.endAt).toZonedDateTimeISO(timezone);
  const zone = start.offset !== end.offset ? { timeZoneName: "short" as const } : {};
  const options = start.toPlainDate().equals(end.toPlainDate())
    ? { hour: "numeric", minute: "2-digit", ...zone } as const
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...zone } as const;
  if (event.endUnspecified) return `${start.toLocaleString("en-US", options)} · End unknown`;
  return `${start.toLocaleString("en-US", options)}–${end.toLocaleString("en-US", options)}`;
}

function unavailable(event: NormalizedExternalEvent, field: "description" | "location" | "organizer" | "attendees" | "conference" | "attachments"): string {
  const reason = event.fieldAvailability[field];
  if (reason === "restricted") return "Restricted by the source.";
  if (reason === "provider_omitted") return "The source omitted this detail.";
  if (reason === "not_provided") return "Not provided.";
  return "No detail available.";
}

function safeHref(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}
