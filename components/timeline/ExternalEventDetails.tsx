"use client";

import { Temporal } from "@js-temporal/polyfill";
import { ExternalLink, X } from "lucide-react";
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useDevelopmentBuild } from "@cadence/ui/runtime";

import type { ExternalEventSource, NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { TravelEvidenceResult, TravelMode, TravelNavigationPreference } from "@cadence/core/types/travel";
import { buildTravelNavigationLink } from "@cadence/core/services/travel-navigation";
import { DEPARTURE_REFRESH_LABEL, allDayRangeLabel, departureCheckedPhrase, departureFreeAgainPhrase, departurePhraseContext, eventStateWord, type DeparturePhraseContext } from "@cadence/core/services/departure-phrases";
import type { DepartureModel, DepartureTrip } from "@cadence/core/types/departure";
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
  departure?: DepartureModel | null;
  refresh?: TravelRefreshAction | null;
  /** When the departure model was resolved. Required with `departure`. */
  now?: string;
}>;

export function ExternalEventPreview({
  id,
  events,
  timezone,
  onDismiss,
  onOpen,
  travel,
  departure,
  refresh,
  now,
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
              {now ? renderTravelTiming({ eventId: event.id, travel, departure, now, timezone, refresh }) : null}
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
  departure?: DepartureModel | null;
  refresh?: TravelRefreshAction | null;
  /** When the departure model was resolved. Required with `departure`. */
  now?: string;
}>;

export const ExternalEventDetails = forwardRef<HTMLDialogElement, ExternalEventDetailsProps>(
  function ExternalEventDetails({ event, timezone, onClose, onDismissAllDay, onOpenExternal, travel, navigationPreference, travelMode, onTravelCorrection, travelHabits, departure, refresh, now }, ref) {
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
              <DetailRow label="Time" value={[eventTimeLabel(event, timezone), eventStateWord(event.state)].filter(hasText).join(" · ")} />
              <DetailRow label="Duration" value={durationOnlyWhenEndUnknown(event)} />
              <DetailRow label="Location" value={event.location} />
            </dl>
            {now ? renderTravelTiming({ eventId: event.id, travel, departure, now, timezone, onOpenExternal, refresh }) : null}
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
              <p className="text-muted-readable">{TRAVEL_CORRECTION_NOTE} Calendar and saved locations stay unchanged.</p>
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

/** Ticket 261 wording, approved by the owner on November 5, 2026. The bench lists it (Ticket 266). */
export const TRAVEL_CORRECTION_NOTE = "Applies to this event until you close the Timeline.";

type TravelTimingEvidence = Omit<TravelEvidenceResult, "modelProjection">;

/** Ticket 261: the shared "Refresh travel" action (INT-TRAVEL-004), offered in a line that needs it. */
export type TravelRefreshAction = Readonly<{ onRefresh: () => void; pending: boolean }>;

/** The trips this event's views talk about. Steps that need a place or attendance wait for Ticket 273. */
function eventTrips(departure: DepartureModel | null | undefined, eventId: string): DepartureTrip[] {
  return (departure?.trips ?? []).filter((trip) => trip.legId !== null
    ? trip.originRef === eventId || trip.destinationRef === eventId
    : (trip.state === "time_unknown" || trip.state === "trip_changed") &&
      (trip.role === "return" ? trip.originRef === eventId : trip.destinationRef === eventId));
}

export function renderTravelTiming({ eventId, travel, departure, now, timezone, onOpenExternal, refresh }: Readonly<{
  eventId: string; travel?: TravelTimingEvidence | null; departure?: DepartureModel | null;
  /** The instant the departure model was resolved at, so every line dates times the same way. */
  now: string; timezone: string;
  onOpenExternal?: (url: string) => void | Promise<void>;
  refresh?: TravelRefreshAction | null;
}>) {
  const trips = eventTrips(departure, eventId);
  if (!trips.length) return null;
  return <TravelTiming eventId={eventId} trips={trips} travel={travel} context={departurePhraseContext(now, timezone)} onOpenExternal={onOpenExternal} refresh={refresh ?? null} />;
}

function TravelTiming({ eventId, trips, travel, context, onOpenExternal, refresh }: Readonly<{
  eventId: string; trips: readonly DepartureTrip[]; travel?: TravelTimingEvidence | null; context: DeparturePhraseContext;
  onOpenExternal?: (url: string) => void | Promise<void>; refresh: TravelRefreshAction | null;
}>) {
  const developmentBuild = useDevelopmentBuild();
  const legIds = new Set(trips.flatMap((trip) => trip.legId ? [trip.legId] : []));
  const legs = travel?.legs.filter((item) => legIds.has(item.leg.id)) ?? [];
  // The margin once per event. The leave time already includes it.
  const weather = legs.find((item) => item.weather?.state === "margin")?.weather;
  const margin = weather ? travelWeatherMarginText({ marginMinutes: weather.marginSeconds / 60, conditions: weather.conditions, suggestion: weather.suggestion }, { developmentBuild }) : "";
  // Production shows no route warning text. Released Mac 0.1.8 still prints the same strings.
  const developmentWarnings = developmentBuild ? [...new Set(legs.flatMap((item) => item.estimate?.warnings ?? []))] : [];
  const checked = trips.find((trip) => trip.checkedAt);
  const attribution = legs.find((item) => item.estimate?.attribution)?.estimate?.attribution;
  // A trip leaving this stop names where it goes. The trip arriving here does not need to.
  const text = (trip: DepartureTrip) => trip.originRef === eventId ? trip.linePhrase : trip.phrase;
  // The same sentence once per view, such as the pause shared by every trip (Ticket 266).
  const shown = trips.filter((trip, index) => trips.findIndex((other) => text(other) === text(trip)) === index);
  // A line that starts with "Refresh travel" carries the button as its own first words, so the
  // words never repeat (owner change R1). Every such line has one, and all run the same refresh.
  // Lines that only need a refresh share one trailing button, and only when no line leads with it.
  const needsRefresh = (trip: DepartureTrip) => trips.some((other) => text(other) === text(trip) && other.action === "refresh");
  const leadsWithRefresh = (trip: DepartureTrip) => text(trip).startsWith(`${DEPARTURE_REFRESH_LABEL} `);
  const anyLeads = shown.some(leadsWithRefresh);
  const trailingKey = anyLeads ? null : shown.find(needsRefresh)?.key ?? null;
  const refreshButton = (label: string) => refresh
    ? <button type="button" className="text-link" disabled={refresh.pending} onClick={refresh.onRefresh}>{label}</button> : label;
  return <div className="grid gap-1 text-xs leading-5" aria-label="Travel timing">
    {shown.map((trip) => <p key={trip.key} data-departure-state={trip.state}>
      {leadsWithRefresh(trip)
        ? <>{refreshButton(DEPARTURE_REFRESH_LABEL)}{text(trip).slice(DEPARTURE_REFRESH_LABEL.length)}</>
        : text(trip)}
      {trip.key === trailingKey && refresh ? <>{" "}{refreshButton(DEPARTURE_REFRESH_LABEL)}</> : null}
    </p>)}
    {margin ? <p>{margin}</p> : null}
    {travel?.completeTrip && travel.finalAvailabilityAt ? <p>{departureFreeAgainPhrase(travel.finalAvailabilityAt, context)}</p> : null}
    {developmentWarnings.length ? <div data-travel-development-warnings><p className="font-bold text-muted-readable">Development</p>
      {developmentWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
    {checked?.checkedAt && attribution ? <p>{departureCheckedPhrase(attribution, checked.checkedAt, context)}</p> : null}
    {travel?.weather?.attribution && weather ? <TravelWeatherCredit attribution={travel.weather.attribution} onOpenExternal={onOpenExternal} /> : null}
  </div>;
}

export function eventTimeLabel(event: NormalizedExternalEvent, timezone: string): string {
  if (event.kind === "all_day") return allDayRangeLabel(event.startLocalDate, event.endLocalDate);
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
