"use client";

import { projectExternalEventSchedulingEvent } from "@cadence/core/services/external-event-projection";
import type { TravelEvidenceResult, TravelMode, TravelNavigationPreference } from "@cadence/core/types/travel";
import { Temporal } from "@js-temporal/polyfill";
import { useRefresh } from "@cadence/ui/runtime";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";
import { resolveDayProgressLayout } from "@cadence/core/resolvers/day-progress.resolver";
import { resolveTimelineOccurrenceContext } from "@cadence/core/resolvers/timeline-context.resolver";
import type {
  BehaviorDurationEstimate,
  ExternalEventFreshness,
  NormalizedExternalEvent,
  TimelineOccurrenceContext,
} from "@cadence/core/types/day-progress";

import { ExternalEventDetails, ExternalEventPreview, renderTravelTiming } from "./ExternalEventDetails";
import { OccurrenceRow } from "./OccurrenceRow";
import { useDayProgressClock } from "./day-progress-clock";
import styles from "./day-progress-timeline.module.css";
import { useWebGoogleCalendarTimeline } from "@/lib/ui/google-calendar";
import { publishBriefTravel } from "@/lib/ui/brief-travel";
import { briefTravelSubjects, projectBriefTravelGuidance } from "@cadence/core/services/brief-travel-guidance";
import { TRAVEL_CLEARANCE_MESSAGE, travelSourceKey as buildTravelSourceKey, useTravelContext, type TravelCorrection, type TravelState } from "@/lib/ui/travel";
import type {
  OccurrenceFormAction,
  TimeTrackingFormAction,
  TimelineDaySection,
  TimelineView,
} from "@/lib/types/timeline";

export type DayProgressContext = Readonly<{
  events?: readonly NormalizedExternalEvent[];
  freshness?: ExternalEventFreshness;
  now?: string;
  durationEstimates?: Readonly<Record<string, BehaviorDurationEstimate>>;
  travel?: Omit<TravelEvidenceResult, "modelProjection"> | null;
  travelMessage?: string | null;
  travelStatus?: TravelState | null;
  travelMode?: TravelMode | null;
  navigationPreference?: TravelNavigationPreference | null;
  onTravelCorrection?: (correction: TravelCorrection) => void;
}>;

type DayProgressTimelineProps = Readonly<{
  timeline: TimelineView;
  context?: DayProgressContext;
  statusAction: OccurrenceFormAction;
  noteAction: OccurrenceFormAction;
  startTimeTrackingAction: TimeTrackingFormAction;
  stopTimeTrackingAction: TimeTrackingFormAction;
  resetTimeTrackingAction: TimeTrackingFormAction;
  shortcutsByBehavior?: Record<string, NoteShortcut[]>;
  onDayChange?: () => void;
  onOpenExternal?: (url: string) => void | Promise<void>;
  liveCalendar?: boolean;
  travelAccountId?: string | null;
}>;

type MeasuredDay = Parameters<typeof resolveDayProgressLayout>[0]["days"][number] & Readonly<{
  axisX: number;
  iconX: number;
}>;

type Preview = Readonly<{ ids: string[]; launcher: HTMLElement }>;

const NO_ESTIMATE: BehaviorDurationEstimate = {
  kind: "unknown",
  reason: "insufficient_samples",
  sampleCount: 0,
  requiredSampleCount: 3,
  lookbackDays: 90,
};

const UNAVAILABLE: ExternalEventFreshness = {
  state: "unavailable",
  refreshedAt: null,
  label: "Calendar unavailable",
  canAssertNoOverlap: false,
};
const EMPTY_EVENTS: readonly NormalizedExternalEvent[] = [];
const EMPTY_IDS: readonly string[] = [];

export function DayProgressTimeline({
  timeline,
  context,
  statusAction,
  noteAction,
  startTimeTrackingAction,
  stopTimeTrackingAction,
  resetTimeTrackingAction,
  shortcutsByBehavior = {},
  onDayChange,
  onOpenExternal,
  liveCalendar = false,
  travelAccountId = null,
}: DayProgressTimelineProps) {
  const runtimeRefresh = useRefresh();
  const rootRef = useRef<HTMLDivElement>(null);
  const drawerLauncher = useRef<HTMLElement | null>(null);
  const restoringFocus = useRef(false);
  const [measured, setMeasured] = useState<Record<string, MeasuredDay>>({});
  const measurements = useRef(new Map<string, () => MeasuredDay>());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [detailEvent, setDetailEvent] = useState<NormalizedExternalEvent | null>(null);
  const [dismissedAllDay, setDismissedAllDay] = useState<string[]>([]);
  const [corrections, setCorrections] = useState<readonly TravelCorrection[]>([]);
  const now = useDayProgressClock(context?.now, timeline.timezone, onDayChange ?? runtimeRefresh);
  const visibleSections = timeline.daySections;
  const live = useWebGoogleCalendarTimeline({ enabled: liveCalendar && !context, localDates: visibleSections.map((section) => section.localDate), timezone: timeline.timezone });
  const events = context?.events ?? live.snapshot?.events.filter((event) =>
    !live.hiddenCalendarIds.includes(event.calendarId) && (live.showAllDay || event.kind !== "all_day"),
  ) ?? EMPTY_EVENTS;
  const travelSourceKey = buildTravelSourceKey(events, timeline);
  const currentCorrections = useMemo(() => corrections.filter((correction) => events.some((event) => event.id === correction.eventId && (event.revision.providerEtag ?? event.revision.providerUpdatedAt) === correction.revision)), [corrections, events]);
  const liveTravel = useTravelContext({ enabled: liveCalendar && !context, accountId: travelAccountId,
    localDate: timeline.todayLocalDate, sourceKey: travelSourceKey, corrections: currentCorrections });
  const travel = context?.travel ?? liveTravel.view?.evidence;
  // Ticket 170: the Daily Brief bubble shows this deterministic projection; no extra route request.
  const briefTravel = useMemo(() => {
    const today = timeline.daySections.find((section) => section.localDate === timeline.todayLocalDate);
    return projectBriefTravelGuidance({
      evidence: travel, localDate: timeline.todayLocalDate, now,
      ...briefTravelSubjects(today?.occurrences ?? [], events),
    });
  }, [travel, events, now, timeline.daySections, timeline.todayLocalDate]);
  useEffect(() => { publishBriefTravel(briefTravel); }, [briefTravel]);
  useEffect(() => () => publishBriefTravel(null), []);

  const layout = useMemo(() => {
    const days = visibleSections.flatMap((section) => measured[section.localDate] ? [measured[section.localDate]!] : []);
    if (days.length !== visibleSections.length) return null;
    return resolveDayProgressLayout({
      timezone: timeline.timezone,
      firstVisibleDate: visibleSections[0]?.localDate,
      days,
      events: [...events],
      travelSegments: travel?.segments,
      now: Temporal.Instant.from(now),
      minIconSpacing: 44,
      maxIconLanes: 1,
    });
  }, [travel, events, measured, now, timeline.timezone, visibleSections]);

  const activeIds = preview?.ids ?? EMPTY_IDS;
  const previewEvents = useMemo(() => activeIds.flatMap((id) => {
    const event = events.find((item) => item.id === id);
    return event ? [event] : [];
  }), [activeIds, events]);
  const measureDays = useCallback(() => {
    // Read the whole range together: a resized day also moves every later day.
    const next = Object.fromEntries([...measurements.current].map(([date, measure]) => [date, measure()]));
    setMeasured((previous) => Object.keys(previous).length === Object.keys(next).length
      && Object.entries(next).every(([date, day]) => sameDay(previous[date], day)) ? previous : next);
  }, []);
  const registerMeasurement = useCallback((date: string, measure: () => MeasuredDay) => {
    measurements.current.set(date, measure);
    return () => { measurements.current.delete(date); };
  }, []);
  const dismissPreview = useCallback((restoreFocus = false) => {
    if (restoreFocus) preview?.launcher.focus();
    setPreview(null);
  }, [preview]);
  const openPreview = useCallback((ids: string[], launcher: HTMLElement) => {
    if (!restoringFocus.current) setPreview({ ids, launcher });
  }, []);
  const openDetails = useCallback((event: NormalizedExternalEvent) => {
    drawerLauncher.current = preview?.launcher ?? null;
    setPreview(null);
    setDetailEvent(event);
  }, [preview]);
  const closeDetails = useCallback(() => {
    setDetailEvent(null);
    restoringFocus.current = true;
    drawerLauncher.current?.focus();
    restoringFocus.current = false;
    drawerLauncher.current = null;
  }, []);

  useEffect(() => {
    if (!preview) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissPreview(true);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [dismissPreview, preview]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const drawer = root?.querySelector<HTMLElement>('[data-calendar-drawer="preview"]');
    if (!root || !drawer) return;
    const measure = () => root.style.setProperty("--drawer-height", `${drawer.getBoundingClientRect().height}px`);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(drawer);
    measure();
    return () => observer.disconnect();
  }, [preview]);

  const layoutsByDate = new Map(layout?.days.map((day) => [day.localDate, day]) ?? []);
  const firstMeasured = visibleSections.map((section) => measured[section.localDate]).find(Boolean);
  const fresh = context?.freshness ?? live.snapshot?.freshness ?? UNAVAILABLE;
  const calendarState = context?.freshness
    ? calendarFreshnessLabel(context.freshness, timeline.timezone)
    : liveCalendar
      ? calendarStateLabel(live.state, live.error, live.snapshot?.freshness, timeline.timezone)
      : null;
  const dayProgressStyle = firstMeasured ? { "--day-progress-axis-left": `${firstMeasured.axisX}px` } as CSSProperties : undefined;

  return (
    <div
      ref={rootRef}
      className={styles.timeline}
      style={dayProgressStyle}
      data-drawer-open={preview ? "true" : undefined}
    >
      {firstMeasured ? <div className={styles.spine} style={{ left: firstMeasured.axisX }} aria-hidden="true" /> : null}
      {calendarState ? <p className={styles.calendarState} data-calendar-state={liveCalendar && !context ? live.state : fresh.state}>{calendarState}</p> : null}
      <TravelStatusLine status={context ? context.travelStatus ?? null : liveTravel} message={context?.travelMessage ?? null} timezone={timeline.timezone} />
      {layout && firstMeasured ? <DayOverlay
        layout={layout}
        measured={measured}
        events={events}
        activeIds={activeIds}
        previewId={preview ? "calendar-preview" : undefined}
        onPreview={openPreview}
      /> : null}
      {visibleSections.map((section) => <DayProgressDay
        key={section.key}
        root={rootRef}
        section={section}
        layout={layoutsByDate.get(section.localDate)}
        events={events}
        dismissedAllDay={dismissedAllDay}
        activeIds={activeIds}
        travel={travel}
        timezone={timeline.timezone}
        contexts={resolveContexts(section, events, fresh, now, context?.durationEstimates ?? timeline.durationEstimates, travel)}
        shortcutsByBehavior={shortcutsByBehavior}
        onMeasure={measureDays}
        registerMeasurement={registerMeasurement}
        onPreview={openPreview}
        onRestoreAllDay={() => setDismissedAllDay([])}
        statusAction={statusAction}
        noteAction={noteAction}
        startTimeTrackingAction={startTimeTrackingAction}
        stopTimeTrackingAction={stopTimeTrackingAction}
        resetTimeTrackingAction={resetTimeTrackingAction}
      />)}
      {preview && previewEvents.length ? <ExternalEventPreview
        id="calendar-preview"
        events={previewEvents}
        timezone={timeline.timezone}
        onDismiss={() => dismissPreview(true)}
        onOpen={openDetails}
        travel={travel}
      /> : null}
      <ExternalEventDetails
        event={detailEvent}
        timezone={timeline.timezone}
        onClose={closeDetails}
        onDismissAllDay={(id) => {
          setDismissedAllDay((ids) => ids.includes(id) ? ids : [...ids, id]);
          closeDetails();
        }}
        onOpenExternal={onOpenExternal}
        travel={travel}
        navigationPreference={context?.navigationPreference ?? liveTravel.view?.navigationPreference}
        travelMode={context?.travelMode ?? liveTravel.view?.mode}
        onTravelCorrection={context?.onTravelCorrection ?? (liveTravel.view ? (correction) => {
          setCorrections((previous) => [...previous.filter((item) => item.eventId !== correction.eventId).slice(-7), correction]);
        } : undefined)}
      />
      {layout?.days.some((day) => day.movingDot) ? <p className="sr-only">Current time position updates while this timeline is visible.</p> : null}
    </div>
  );
}

type DayProgressDayProps = Omit<DayProgressTimelineProps, "timeline" | "context" | "onDayChange"> & Readonly<{
  root: React.RefObject<HTMLDivElement | null>;
  section: TimelineDaySection;
  layout: ReturnType<typeof resolveDayProgressLayout>["days"][number] | undefined;
  events: readonly NormalizedExternalEvent[];
  dismissedAllDay: readonly string[];
  activeIds: readonly string[];
  contexts: ReadonlyMap<string, TimelineOccurrenceContext>;
  travel?: Omit<TravelEvidenceResult, "modelProjection"> | null;
  timezone: string;
  onMeasure: () => void;
  registerMeasurement: (date: string, measure: () => MeasuredDay) => () => void;
  onPreview: (ids: string[], launcher: HTMLElement) => void;
  onRestoreAllDay: () => void;
}>;

function DayProgressDay({
  root,
  section,
  layout,
  events,
  dismissedAllDay,
  activeIds,
  contexts,
  travel,
  timezone,
  onMeasure,
  registerMeasurement,
  onPreview,
  onRestoreAllDay,
  statusAction,
  noteAction,
  startTimeTrackingAction,
  stopTimeTrackingAction,
  resetTimeTrackingAction,
  shortcutsByBehavior,
}: DayProgressDayProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const [iconsOnly, setIconsOnly] = useState<Record<string, boolean>>({});
  const allDay = (layout?.allDayEventIds ?? []).flatMap((id) => {
    const event = events.find((item) => item.id === id);
    return event ? [event] : [];
  });
  const visibleAllDay = allDay.filter((event) => !dismissedAllDay.includes(event.id));
  const allDayLabel = visibleAllDay.length
    ? `All day: ${visibleAllDay[0]!.title || "Untitled event"}${visibleAllDay.length > 1 ? ` +${visibleAllDay.length - 1} more` : ""}`
    : "Restore All Day Events";

  useLayoutEffect(() => {
    const sectionElement = sectionRef.current;
    const body = bodyRef.current;
    const parent = root.current ?? sectionElement?.parentElement;
    if (!parent || !sectionElement || !body) return;
    const measure = () => {
      const parentRect = parent.getBoundingClientRect();
      const sectionRect = sectionElement.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const nextSection = sectionElement.nextElementSibling;
      const style = getComputedStyle(parent);
      const axisX = bodyRect.left - parentRect.left + Number.parseFloat(style.getPropertyValue("--timeline-axis-x"));
      const iconX = bodyRect.left - parentRect.left + Number.parseFloat(style.getPropertyValue("--calendar-node-x"));
      const nextIconsOnly: Record<string, boolean> = {};
      const measuredRows = section.occurrences.flatMap((occurrence) => {
        const row = rows.current.get(occurrence.id);
        if (!row) return [];
        const time = row.querySelector("time");
        if (!time) return [];
        const rect = time.getBoundingClientRect();
        const summary = row.querySelector<HTMLElement>("summary");
        const title = row.querySelector<HTMLElement>(".timeline-occurrence-title");
        const main = row.querySelector<HTMLElement>(".timeline-occurrence-main");
        const labels = [...row.querySelectorAll<HTMLElement>("[data-status-region='actions'] button span")];
        const actionWidth = labels.reduce((total, label) => total + Math.max(44, label.textContent!.length * 8 + 22), 8);
        const required = rect.width + (title?.textContent?.length ?? 0) * 8 + actionWidth
          + (main ? Number.parseFloat(getComputedStyle(main).columnGap) || 8 : 8) + 40;
        nextIconsOnly[occurrence.id] = parentRect.width < 576 || (!!summary && required > summary.getBoundingClientRect().width);
        return [{ occurrenceId: occurrence.id, scheduledFor: occurrence.scheduledFor, center: rect.top - parentRect.top + rect.height / 2 }];
      });
      setIconsOnly((previous) => sameIconState(previous, nextIconsOnly) ? previous : nextIconsOnly);
      return {
        localDate: section.localDate,
        top: sectionRect.top - parentRect.top,
        // Adjacent DOMRect bottom/top can differ fractionally under browser zoom.
        // Use the next section's top as their single shared boundary.
        bottom: (nextSection?.matches("section") ? nextSection.getBoundingClientRect().top : sectionRect.bottom) - parentRect.top,
        rows: measuredRows,
        axisX,
        iconX,
      };
    };
    if (typeof ResizeObserver === "undefined") return;
    const unregister = registerMeasurement(section.localDate, measure);
    const observer = new ResizeObserver(onMeasure);
    observer.observe(parent);
    observer.observe(sectionElement);
    for (const row of rows.current.values()) observer.observe(row);
    onMeasure();
    document.fonts?.ready.then(onMeasure);
    return () => { observer.disconnect(); unregister(); };
  }, [onMeasure, registerMeasurement, root, section]);

  return (
    <section ref={sectionRef} className={styles.day} aria-labelledby={`${section.key}-title`}>
      <header className={styles.dayHeader}>
        <div className="border-b border-line pb-3">
          <p className="text-sm font-bold text-muted-readable">{section.relativeLabel}</p>
          <div className={styles.dateTitle}>
            <h2 id={`${section.key}-title`} className={section.kind === "today" ? "text-3xl font-bold leading-tight" : "text-2xl font-bold leading-tight"}>
              <time dateTime={section.localDate}>{section.label}</time>
            </h2>
            {allDay.length ? <aside className={styles.allDay} aria-label={`All day · ${section.label}`}>
              <button
                type="button"
                data-all-day-control
                title={visibleAllDay.map((event) => event.title || "Untitled event").join(", ")}
                aria-describedby={activeIds.some((id) => allDay.some((event) => event.id === id)) ? "calendar-preview" : undefined}
                className={styles.allDayButton}
                onPointerEnter={(event) => {
                  if (event.pointerType !== "touch" && visibleAllDay.length) onPreview(visibleAllDay.map((item) => item.id), event.currentTarget);
                }}
                onFocus={(event) => { if (visibleAllDay.length) onPreview(visibleAllDay.map((item) => item.id), event.currentTarget); }}
                onClick={(event) => {
                  if (visibleAllDay.length) onPreview(visibleAllDay.map((item) => item.id), event.currentTarget);
                  else onRestoreAllDay();
                }}
              ><span>{allDayLabel}</span></button>
              {visibleAllDay.length && visibleAllDay.length < allDay.length ? <button type="button" className="min-h-11 text-xs underline" onClick={onRestoreAllDay}>Restore ({allDay.length - visibleAllDay.length})</button> : null}
            </aside> : null}
          </div>
        </div>
      </header>
      <div className={styles.feed}>
        <div ref={bodyRef} className="relative min-h-24 py-4" data-day-progress-date={section.localDate}>
          {section.occurrences.length === 0 ? <p className="bg-surface p-3 text-base leading-7 text-muted-readable">{section.emptyMessage}</p> : <div className="grid gap-1">
            {section.occurrences.map((occurrence) => {
              const highlighted = contexts.get(occurrence.id)?.overlappingEventIds.some((id) => activeIds.includes(id));
              return <div
                key={occurrence.id}
                ref={(node) => { if (node) rows.current.set(occurrence.id, node); else rows.current.delete(occurrence.id); }}
                className={styles.row}
                onFocus={(event) => { if (travel?.legs.some((item) => item.leg.destinationCommitmentRef === occurrence.id || item.leg.originCommitmentRef === occurrence.id)) onPreview([occurrence.id], event.target as HTMLElement); }}
                data-event-highlight={highlighted ? "true" : undefined}
                data-status-icons-only={iconsOnly[occurrence.id] ? "true" : "false"}
              >
                <OccurrenceRow
                  occurrence={occurrence}
                  context={contexts.get(occurrence.id)}
                  travelDetails={renderTravelTiming({ eventId: occurrence.id, travel, timezone })}
                  statusAction={statusAction}
                  noteAction={noteAction}
                  startTimeTrackingAction={startTimeTrackingAction}
                  stopTimeTrackingAction={stopTimeTrackingAction}
                  resetTimeTrackingAction={resetTimeTrackingAction}
                  shortcuts={shortcutsByBehavior?.[occurrence.behaviorId]}
                  statusIconsOnly={iconsOnly[occurrence.id] ?? false}
                />
              </div>;
            })}
          </div>}
        </div>
      </div>
    </section>
  );
}

function DayOverlay({
  layout,
  measured,
  events,
  activeIds,
  previewId,
  onPreview,
}: Readonly<{
  layout: ReturnType<typeof resolveDayProgressLayout>;
  measured: Readonly<Record<string, MeasuredDay>>;
  events: readonly NormalizedExternalEvent[];
  activeIds: readonly string[];
  previewId?: string;
  onPreview: (ids: string[], launcher: HTMLElement) => void;
}>) {
  const controls = layout.days.flatMap((day) => [
    ...day.timedEventSpans.filter((span) => span.iconLane !== null && !span.overflowGroupId).map((span) => ({ id: span.eventId, position: span.iconPosition, eventIds: [span.eventId], count: 1, iconX: 0, axisX: 0 })),
    ...day.iconOverflowGroups.map((group) => ({ id: group.id, position: group.position, eventIds: group.eventIds, count: group.count, iconX: 0, axisX: 0 })),
  ].map((control) => ({ ...control, iconX: measured[day.localDate]!.iconX, axisX: measured[day.localDate]!.axisX })));
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden={false}>
      <svg className="absolute inset-0 h-full w-full overflow-visible text-muted-readable" aria-hidden="true">
        {controls.map((control) => <line key={control.id} data-calendar-stem={control.id} x1={control.iconX} x2={control.axisX} y1={control.position} y2={control.position} stroke="currentColor" />)}
        {layout.days.flatMap((day) => day.timedEventSpans.filter((span) => activeIds.includes(span.eventId) && span.endPosition !== null).map((span) => <line key={`${day.localDate}-${span.eventId}`} data-event-duration={span.eventId} x1={measured[day.localDate]!.axisX + 0.5} x2={measured[day.localDate]!.axisX + 0.5} y1={span.continuesBefore && span.iconLane === null && !span.overflowGroupId ? day.top : span.iconPosition} y2={span.continuesAfter ? day.bottom : Math.min(day.bottom, span.iconPosition + Math.max(2, span.endPosition! - span.startPosition))} stroke="var(--calendar-overlap)" strokeWidth={1} />))}
        {layout.days.flatMap((day) => day.travelSpans.filter((span) => span.sourceRefs.some((ref) => activeIds.includes(ref))).map((span) => <line key={`${day.localDate}-${span.segmentId}`} data-travel-duration={span.segmentId} x1={measured[day.localDate]!.axisX + 0.5} x2={measured[day.localDate]!.axisX + 0.5} y1={span.startPosition} y2={span.endPosition} stroke="var(--calendar-overlap)" strokeWidth={1} />))}
        {layout.days.flatMap((day) => day.movingDot ? [<circle key={day.localDate} className={styles.currentTime} data-current-time-marker cx={measured[day.localDate]!.axisX} cy={day.movingDot.displayPosition} r={5} fill="var(--primary)" stroke="var(--background)" strokeWidth={2} />] : [])}
      </svg>
      {controls.map((control) => {
        const event = events.find((item) => item.id === control.eventIds[0]);
        if (!event) return null;
        return <button key={control.id} type="button" data-calendar-node={control.id} className="pointer-events-auto absolute z-20 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center" style={{ left: control.iconX, top: control.position }} aria-label={control.count > 1 ? `Preview ${control.count} Google Calendar events starting at the same time` : `Preview Google Calendar event: ${event.title || "Untitled event"}`} aria-describedby={control.eventIds.some((id) => activeIds.includes(id)) ? previewId : undefined} onPointerEnter={(pointer) => { if (pointer.pointerType !== "touch") onPreview([...control.eventIds], pointer.currentTarget); }} onFocus={(focus) => onPreview([...control.eventIds], focus.currentTarget)} onClick={(click) => onPreview([...control.eventIds], click.currentTarget)}><span className={styles.eventMarker} data-group-variant={control.count > 1 ? "badge" : undefined} aria-hidden="true">{/* Provider artwork stays bundled for offline desktop use. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/google-calendar.svg" alt="" width={18} height={18} />
          {control.count > 1 ? <span className={styles.countBadge}>×{control.count}</span> : null}</span></button>;
      })}
    </div>
  );
}

function resolveContexts(
  section: TimelineDaySection,
  events: readonly NormalizedExternalEvent[],
  freshness: ExternalEventFreshness,
  now: string,
  estimates: Readonly<Record<string, BehaviorDurationEstimate>> | undefined,
  travel?: Omit<TravelEvidenceResult, "modelProjection"> | null,
): ReadonlyMap<string, TimelineOccurrenceContext> {
  const instant = Temporal.Instant.from(now);
  return new Map(section.occurrences.map((occurrence) => [occurrence.id, resolveTimelineOccurrenceContext({
    occurrenceId: occurrence.id,
    occurrenceStatus: occurrence.status,
    scheduledFor: occurrence.scheduledFor,
    runningStartedAt: occurrence.timeTracking.runningStartedAt,
    estimate: estimates?.[occurrence.behaviorId] ?? NO_ESTIMATE,
    events: events.map(projectExternalEventSchedulingEvent),
    freshness,
    travel,
    // A timing mutation can arrive between minute ticks. Its timestamp is the
    // earliest instant at which the returned running state can be assessed.
    now: occurrence.timeTracking.runningStartedAt && Temporal.Instant.compare(Temporal.Instant.from(occurrence.timeTracking.runningStartedAt), instant) > 0
      ? Temporal.Instant.from(occurrence.timeTracking.runningStartedAt) : instant,
  })]));
}

function sameDay(left: MeasuredDay | undefined, right: MeasuredDay): boolean {
  return !!left && left.top === right.top && left.bottom === right.bottom && left.axisX === right.axisX && left.iconX === right.iconX && left.rows.length === right.rows.length && left.rows.every((row, index) => row.occurrenceId === right.rows[index]?.occurrenceId && row.center === right.rows[index]?.center && row.scheduledFor === right.rows[index]?.scheduledFor);
}

function sameIconState(left: Record<string, boolean>, right: Record<string, boolean>): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function calendarStateLabel(
  state: ReturnType<typeof useWebGoogleCalendarTimeline>["state"],
  error: string | null,
  freshness: ExternalEventFreshness | undefined,
  timezone: string,
): string {
  if (state === "ready") return "";
  if (state === "empty") return "No Calendar events in the displayed days.";
  if (state === "stale") return freshness ? calendarFreshnessLabel(freshness, timezone) : "Calendar context may be out of date.";
  if (state === "error") return `Calendar context could not refresh: ${error ?? "unavailable"}.${freshness ? ` ${calendarFreshnessLabel(freshness, timezone)}` : ""}`;
  if (state === "no_selected_calendars") return "No Calendar is selected for the Timeline.";
  if (state === "not_configured") return "Calendar connection is not configured.";
  if (state === "disconnected") return "Calendar is not connected.";
  return "Loading Calendar context.";
}

function calendarFreshnessLabel(freshness: ExternalEventFreshness, timezone: string): string {
  if (freshness.state === "current") return "";
  if (freshness.state !== "stale" && freshness.state !== "incomplete") return freshness.label;
  if (!freshness.refreshedAt) return freshness.label;
  try {
    const refreshed = Temporal.Instant.from(freshness.refreshedAt).toZonedDateTimeISO(timezone);
    return `${freshness.label}. Last refreshed ${refreshed.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`;
  } catch {
    return freshness.label;
  }
}

/** One status line for travel: observation time or failure copy, plus a manual refresh link. */
export function TravelStatusLine({ status, message, timezone }: Readonly<{ status: TravelState | null; message?: string | null; timezone: string }>) {
  const text = travelStatusText(status, message ?? null, timezone);
  if (!text) return null;
  const showRefresh = !!status && (!!status.view?.evidence || (!!status.message && status.message !== TRAVEL_CLEARANCE_MESSAGE));
  return (
    <p className={styles.calendarState} role="status">
      {text}
      {showRefresh ? <>{" "}<button type="button" className="text-link" disabled={status.pending} onClick={status.refresh}>Refresh travel</button></> : null}
    </p>
  );
}

export function travelStatusText(status: TravelState | null, fallbackMessage: string | null, timezone: string): string | null {
  if (!status) return fallbackMessage;
  if (status.view?.evidence && status.observedAt) {
    const time = Temporal.Instant.from(status.observedAt).toZonedDateTimeISO(timezone).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
    const prefix = status.stale ? `Travel estimates from ${time} may be stale.` : `Travel as of ${time}`;
    return status.message ? `${prefix} ${status.message}` : prefix;
  }
  return status.message;
}
