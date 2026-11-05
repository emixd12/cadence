"use client";

import { Temporal } from "@js-temporal/polyfill";
import { ExternalLink, X } from "lucide-react";
import { Fragment, forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useDevelopmentBuild } from "@cadence/ui/runtime";

import type { ExternalEventSource, NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { TravelEvidenceResult, TravelMode, TravelNavigationPreference } from "@cadence/core/types/travel";
import { buildTravelNavigationLink } from "@cadence/core/services/travel-navigation";
import { TRAVEL_LEG_OUTSIDE_WINDOW } from "@cadence/core/services/travel-refresh-policy";
import type { TravelCorrection } from "@/lib/ui/travel";
import type { TravelHabitsState } from "@/lib/ui/travel-habits";
import { TravelModeChoice } from "./TravelModeChoice";
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
  /** Ticket 217: remembered travel per place for this journey's mode choice. */
  travelHabits?: TravelHabitsState | null;
}>;

export const ExternalEventDetails = forwardRef<HTMLDialogElement, ExternalEventDetailsProps>(
  function ExternalEventDetails({ event, timezone, onClose, onDismissAllDay, onOpenExternal, travel, navigationPreference, travelMode, onTravelCorrection, travelHabits }, ref) {
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
            <dl className={DETAIL_ROWS}>
              <DetailRow label="Time" value={eventTimeLabel(event, timezone)} />
              <DetailRow label="Duration" value={durationOnlyWhenEndUnknown(event)} />
              <DetailRow label="Location" value={event.location} />
            </dl>
            {renderTravelTiming({ eventId: event.id, travel, timezone, onOpenExternal })}
            {navigation ? <><a href={navigation.href} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline" onClick={onOpenExternal ? (click) => { click.preventDefault(); openExternal(navigation.href); } : undefined}>{navigation.label}</a>{navigation.modeNotice ? <p>{navigation.modeNotice}</p> : null}</> : null}
            <TravelModeChoice eventId={event.id} travel={travel} habits={travelHabits} usualMode={travelMode} />
            <dl className={DETAIL_ROWS}>
              <DetailRow label="Calendar" value={[externalEventSourceName(event.source), event.calendarName].filter(hasText).join(" · ")} />
              <DetailRow label="Attendees" value={event.attendees?.map((item) => `${item.displayName ?? item.email ?? "Unnamed attendee"} (${item.responseStatus.replaceAll("_", " ")})`).join(", ")} />
              <DetailRow label="Organizer" value={event.organizer ? [event.organizer.displayName, event.organizer.email].filter(hasText).join(" · ") : null} />
              <DetailRow label="Conference" value={event.conference?.name} />
              <DetailRow label="Attachments" value={event.attachments?.map((item) => item.title ?? "Untitled attachment").join(", ")} />
            </dl>
            {hasText(event.description) ? <p className="break-words">{event.description}</p> : null}
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
            {event.conference?.notes ? <p className="break-words">{event.conference.notes}</p> : null}
            {event.conference?.entryPoints.map((entry, index) => safeHref(entry.uri) ? <a key={index} href={safeHref(entry.uri)!} onClick={onOpenExternal ? (event) => { event.preventDefault(); openExternal(safeHref(entry.uri)!); } : undefined} target="_blank" rel="noreferrer" className="min-h-11 underline">{entry.label ?? entry.type}</a> : <p key={index} className="break-words">{entry.label ?? entry.type}: {entry.uri}</p>)}
            {event.attachments?.map((attachment, index) => safeHref(attachment.url) ? <a key={index} href={safeHref(attachment.url)!} onClick={onOpenExternal ? (event) => { event.preventDefault(); openExternal(safeHref(attachment.url)!); } : undefined} target="_blank" rel="noreferrer" className="min-h-11 underline">{attachment.title ?? "Open attachment"}</a> : null)}
            {event.kind === "all_day" ? <button type="button" onClick={() => onDismissAllDay(event.id)} className="min-h-11 text-left font-bold underline underline-offset-4" aria-label={`Dismiss all-day event: ${event.title || "Untitled event"}`}>Dismiss from timeline</button> : null}
            {safeHref(event.sourceUrl) ? <a href={safeHref(event.sourceUrl)!} onClick={onOpenExternal ? (click) => { click.preventDefault(); openExternal(safeHref(event.sourceUrl)!); } : undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold underline underline-offset-4">Open source event <ExternalLink size={14} aria-hidden="true" /></a> : null}
            <CalendarDevelopmentDetails event={event} timezone={timezone} />
          </article>
        </div> : null}
      </dialog>
    );
  },
);

type TravelTimingEvidence = Omit<TravelEvidenceResult, "modelProjection">;

export function renderTravelTiming({ eventId, travel, timezone, compact = false, onOpenExternal }: Readonly<{
  eventId: string; travel?: TravelTimingEvidence | null; timezone: string; compact?: boolean;
  onOpenExternal?: (url: string) => void | Promise<void>;
}>) {
  const legs = travel?.legs.filter((item) => item.leg.originCommitmentRef === eventId || item.leg.destinationCommitmentRef === eventId) ?? [];
  if (!legs.length) return null;
  return <TravelTiming legs={legs} travel={travel} timezone={timezone} compact={compact} onOpenExternal={onOpenExternal} />;
}

function TravelTiming({ legs, travel, timezone, compact, onOpenExternal }: Readonly<{
  legs: TravelTimingEvidence["legs"]; travel?: TravelTimingEvidence | null; timezone: string; compact: boolean;
  onOpenExternal?: (url: string) => void | Promise<void>;
}>) {
  const developmentBuild = useDevelopmentBuild();
  const zoned = (value: string) => Temporal.Instant.from(value).toZonedDateTimeISO(timezone);
  const label = (value: string) => zoned(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  // The date appears only when the trip ends on a later day than the leave time printed above it.
  const lateArrival = (departureAt: string, arrivalAt: string) => zoned(departureAt).toPlainDate().equals(zoned(arrivalAt).toPlainDate())
    ? zoned(arrivalAt).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }) : label(arrivalAt);
  const originLabels = { device: "current device position", saved_base: "Home", planned_stop: "planned prior stop", correction: "journey correction", calendar: "Calendar location", behavior: "Behavior location" };
  // Production shows no route warning text. Released Mac 0.1.8 still prints the same strings.
  const developmentWarnings = developmentBuild ? [...new Set(legs.flatMap((item) => item.estimate?.warnings ?? []))] : [];
  return <div className="grid gap-1 text-xs leading-5" aria-label="Travel timing">
    {legs.map(({ leg, state, estimate, reason, weather, late }) => <Fragment key={leg.id}><p>
      {leg.role === "outbound" ? "Outbound" : leg.role === "return" ? "Return home" : "Onward"} · {leg.mode}: {state === "current" && estimate ? `leave ${label(weather?.departureAt ?? estimate.departureAt)}, arrive ${label(weather?.arrivalAt ?? estimate.arrivalAt)}` : reason === TRAVEL_LEG_OUTSIDE_WINDOW ? "estimated within 3 hours of departure" : "timing unavailable"}.
      {weather?.state === "margin" ? ` ${travelWeatherMarginText({ marginMinutes: weather.marginSeconds / 60, conditions: weather.conditions, suggestion: weather.suggestion }, { developmentBuild })}` : ""}
      {!compact ? ` Origin: ${(leg.originCommitmentRef ? "planned prior stop" : originLabels[leg.provenance.originSource])}.` : ""}
    </p>
    {state === "current" && late && estimate ? <p>You may arrive late: arrive {lateArrival(weather?.departureAt ?? estimate.departureAt, weather?.arrivalAt ?? estimate.arrivalAt)}.</p> : null}
    </Fragment>)}
    {!travel?.completeTrip ? <p>Full-trip availability is unknown. Known travel spans still apply.</p> : travel.finalAvailabilityAt ? <p>Available again {label(travel.finalAvailabilityAt)}.</p> : null}
    {developmentWarnings.length ? <div data-travel-development-warnings><p className="font-bold text-muted-readable">Development</p>
      {developmentWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
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

// A fixed label column keeps the rows above and below the travel lines aligned.
const DETAIL_ROWS = "grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3";

function hasText(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

/** A row with no value renders nothing, so the grid closes up with no gap. */
function DetailRow({ label, value }: Readonly<{ label: string; value: string | null | undefined }>) {
  if (!hasText(value)) return null;
  return <><dt className="font-bold">{label}</dt><dd className="break-words">{value}</dd></>;
}

/** The time row already shows any known span, so Duration appears only for an unspecified end. */
function durationOnlyWhenEndUnknown(event: NormalizedExternalEvent): string | null {
  if (event.kind !== "timed" || !event.endUnspecified) return null;
  return event.duration.kind === "known" ? `${event.duration.seconds / 60} minutes` : "Unknown";
}

function instantLabel(value: string, timezone: string): string {
  return Temporal.Instant.from(value).toZonedDateTimeISO(timezone).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function recurrenceLabel(recurrence: NonNullable<NormalizedExternalEvent["recurrence"]>, timezone: string): string {
  const start = recurrence.originalStart;
  const label = start.kind === "timed" ? instantLabel(start.startAt, timezone)
    : Temporal.PlainDate.from(start.startLocalDate).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric" });
  return `${recurrence.seriesId} · ${label}`;
}

/** Technical event fields for development builds. Production shows none of them. */
function CalendarDevelopmentDetails({ event, timezone }: Readonly<{ event: NormalizedExternalEvent; timezone: string }>) {
  const developmentBuild = useDevelopmentBuild();
  if (!developmentBuild) return null;
  const updatedAt = event.revision.providerUpdatedAt;
  return <div className="grid gap-1 text-xs leading-5" data-calendar-development-details>
    <p className="font-bold text-muted-readable">Development</p>
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3">
      <DetailRow label="State" value={`${event.state} · ${event.availability}`} />
      <DetailRow label="Source timezone" value={event.sourceTimezone} />
      <DetailRow label="Recurrence" value={event.recurrence ? recurrenceLabel(event.recurrence, timezone) : null} />
      <DetailRow label="Updated" value={updatedAt ? instantLabel(updatedAt, timezone) : null} />
    </dl>
    {Object.entries(event.detailCompleteness).filter(([, state]) => state !== "complete").map(([field, state]) => <p key={field} className="text-muted-readable">{field.replaceAll("_", " ")}: {state?.replaceAll("_", " ")}</p>)}
  </div>;
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
