"use client";

import { allDayRangeLabel } from "@cadence/core/services/departure-phrases";
import { Temporal } from "@js-temporal/polyfill";
import { CalendarDays, ExternalLink, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  forwardRef,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { OccurrenceRow } from "@/components/timeline/OccurrenceRow";
import { TimelineGroup } from "@/components/timeline/TimelineGroup";
import styles from "./day-progress-bench.module.css";
import { resolveDayProgressLayout } from "@cadence/core/resolvers/day-progress.resolver";
import { resolveTimelineOccurrenceContext } from "@cadence/core/resolvers/timeline-context.resolver";
import { resolveTimeline } from "@cadence/core/resolvers/timeline.resolver";
import type {
  OccurrenceFormAction,
  TimeTrackingFormAction,
  TimelineOccurrenceInput,
  TimelineOccurrenceView,
} from "@/lib/types/timeline";

type LayoutInput = Parameters<typeof resolveDayProgressLayout>[0];
type BenchEvent = NonNullable<LayoutInput["events"]>[number];
type MeasuredDay = LayoutInput["days"][number];

type DayProgressBenchProps = Readonly<{
  statusAction: OccurrenceFormAction;
  noteAction: OccurrenceFormAction;
  startTimeTrackingAction: TimeTrackingFormAction;
  stopTimeTrackingAction: TimeTrackingFormAction;
  resetTimeTrackingAction: TimeTrackingFormAction;
}>;

const TIMEZONE = "America/New_York";
const MIN_ICON_SPACING = 44;

function eventMetadata(id: string) {
  return {
    providerEventId: id,
    logicalInstanceId: id,
    sourceTimezone: TIMEZONE,
    sourceTimezoneFallback: "request",
    state: "confirmed",
    availability: "busy",
    currentUserResponse: null,
    revision: { availability: "unavailable", providerUpdatedAt: null, providerEtag: null },
    fieldAvailability: {},
    detailCompleteness: {},
    organizer: null,
    attendees: null,
    attendeesOmitted: false,
    conference: null,
    recurrence: null,
    attachments: null,
  } as const;
}

const timelineFixture = resolveTimeline({
  timezone: TIMEZONE,
  now: Temporal.Instant.from("2026-06-08T17:20:00Z"),
  futureDays: 2,
  occurrences: [
    occurrenceInput("morning-water", "behavior-water", "Drink water", "2026-06-08T12:00:00Z", "2026-06-08", "8:00 AM", "unresolved", "2026-06-08T11:52:00Z"),
    occurrenceInput("morning-journal", "behavior-journal", "Morning journal", "2026-06-08T12:00:00Z", "2026-06-08", "8:00 AM", "completed"),
    occurrenceInput("morning-stretch", "behavior-stretch", "Mobility reset", "2026-06-08T12:10:00Z", "2026-06-08", "8:10 AM", "unresolved", "2026-06-08T12:02:00Z"),
    occurrenceInput("midday-walk", "behavior-walk", "Walk outside", "2026-06-08T17:00:00Z", "2026-06-08", "1:00 PM", "completed"),
    occurrenceInput("evening-water", "behavior-water", "Drink water", "2026-06-09T01:30:00Z", "2026-06-08", "9:30 PM"),
    occurrenceInput("early-plan", "behavior-plan", "Plan the day", "2026-06-10T10:00:00Z", "2026-06-10", "6:00 AM"),
    occurrenceInput("late-reset", "behavior-reset", "Evening reset", "2026-06-11T02:30:00Z", "2026-06-10", "10:30 PM", "not_completed"),
  ],
});

const currentSection = requiredSection(0);
const emptySection = requiredSection(1);
const longGapSection = requiredSection(2);

const baseCalendarEvents: BenchEvent[] = [
  {
    kind: "all_day",
    id: "event-school-holiday",
    ...eventMetadata("event-school-holiday"),
    calendarId: "calendar-family",
    source: "google_calendar",
    calendarName: "Family",
    title: "School holiday",
    description: "Synthetic second all-day event for independent dismissal and restoration.",
    location: "",
    sourceUrl: "https://calendar.google.com/",
    startLocalDate: "2026-06-09",
    endLocalDate: "2026-06-10",
    duration: { kind: "calendar_days", days: 1 },
  },
  {
    kind: "all_day",
    id: "event-offsite",
    ...eventMetadata("event-offsite"),
    calendarId: "calendar-work",
    source: "google_calendar",
    calendarName: "Work",
    title: "Design offsite",
    description: "Synthetic all-day context used only by this review bench.",
    location: "Studio 4",
    sourceUrl: "https://calendar.google.com/",
    startLocalDate: "2026-06-08",
    endLocalDate: "2026-06-10",
    duration: { kind: "calendar_days", days: 2 },
  },
  {
    kind: "timed",
    id: "event-school-run",
    ...eventMetadata("event-school-run"),
    calendarId: "calendar-family",
    source: "google_calendar",
    calendarName: "Family",
    title: "School run",
    description: "Synthetic close event before the first Behavior.",
    location: "West entrance",
    sourceUrl: "https://calendar.google.com/",
    startAt: "2026-06-08T11:50:00Z",
    endAt: "2026-06-08T12:40:00Z",
    endUnspecified: false,
    duration: { kind: "known", seconds: 3_000 },
  },
  {
    kind: "timed",
    id: "event-standup",
    ...eventMetadata("event-standup"),
    calendarId: "calendar-work",
    source: "google_calendar",
    calendarName: "Work",
    title: "Team stand-up",
    description: "A synthetic event colliding with two Behavior rows.",
    location: "Video call",
    sourceUrl: "https://calendar.google.com/",
    startAt: "2026-06-08T12:00:00Z",
    endAt: "2026-06-08T12:20:00Z",
    endUnspecified: false,
    duration: { kind: "known", seconds: 1_200 },
  },
  {
    kind: "timed",
    id: "event-delivery",
    ...eventMetadata("event-delivery"),
    fieldAvailability: { attendees: "restricted" },
    detailCompleteness: { attendees: "restricted" },
    calendarId: "calendar-home",
    source: "google_calendar",
    calendarName: "Home",
    title: "Delivery window",
    description: "A nearby start stays separate from the eight o’clock events.",
    location: "Home",
    sourceUrl: "https://calendar.google.com/",
    startAt: "2026-06-08T12:05:00Z",
    endAt: "2026-06-08T12:55:00Z",
    endUnspecified: false,
    duration: { kind: "known", seconds: 3_000 },
  },
  {
    kind: "timed",
    id: "event-lunch",
    ...eventMetadata("event-lunch"),
    organizer: { displayName: "Priya Shah", email: "priya@example.com", self: false },
    attendees: [
      { displayName: "Emi", email: "emi@example.com", responseStatus: "accepted", optional: false, organizer: false, self: true },
      { displayName: "Priya Shah", email: "priya@example.com", responseStatus: "accepted", optional: false, organizer: true, self: false },
    ],
    detailCompleteness: { attendees: "complete", conference_entry_points: "complete", attachments: "complete" },
    conference: {
      name: "Meet",
      entryPoints: [{ type: "video", uri: "https://meet.google.com/example", label: "Join video call" }],
      notes: null,
    },
    attachments: [{ title: "Menu", mimeType: "text/html", url: "https://example.com/menu" }],
    calendarId: "calendar-personal",
    source: "google_calendar",
    calendarName: "Personal",
    title: "Lunch with Priya",
    description: "Synthetic event with permitted detail and a source link.",
    location: "Market café",
    sourceUrl: "https://calendar.google.com/",
    startAt: "2026-06-08T16:45:00Z",
    endAt: "2026-06-08T18:00:00Z",
    endUnspecified: false,
    duration: { kind: "known", seconds: 4_500 },
  },
  {
    kind: "timed",
    id: "event-overnight",
    ...eventMetadata("event-overnight"),
    calendarId: "calendar-travel",
    source: "google_calendar",
    calendarName: "Travel",
    title: "Overnight train",
    description: "Synthetic event crossing the local day boundary.",
    location: "Penn Station",
    sourceUrl: "https://calendar.google.com/",
    startAt: "2026-06-09T03:30:00Z",
    endAt: "2026-06-09T06:15:00Z",
    endUnspecified: false,
    duration: { kind: "known", seconds: 9_900 },
  },
];

// Synthetic same-start groups exercise the selected Calendar badge treatment.
const calendarEvents: BenchEvent[] = [
  ...baseCalendarEvents,
  ...[
    { sourceId: "event-standup", id: "event-check-in", title: "Project check-in" },
    { sourceId: "event-lunch", id: "event-focus", title: "Focus time" },
    { sourceId: "event-lunch", id: "event-maintenance", title: "Building maintenance" },
  ].map(({ sourceId, id, title }) => ({
    ...baseCalendarEvents.find((event) => event.id === sourceId)!,
    ...eventMetadata(id), id, title, description: "Synthetic event with an identical start time.",
  })),
];

export function DayProgressBench({
  statusAction,
  noteAction,
  startTimeTrackingAction,
  stopTimeTrackingAction,
  resetTimeTrackingAction,
}: DayProgressBenchProps) {
  const [narrow, setNarrow] = useState(false);
  const [showAllDay, setShowAllDay] = useState(true);
  const [longTitle, setLongTitle] = useState(false);
  const [withDuration, setWithDuration] = useState(false);
  const [activeCalendar, setActiveCalendar] = useState<{ day: string; ids: string[] } | null>(null);
  const highlightEvents = useCallback((day: string, ids: string[]) => {
    setActiveCalendar((active) => ids.length ? { day, ids } : active?.day === day ? null : active);
  }, []);
  const previewOccurrences = useMemo(() => currentSection.occurrences.map((item) =>
    longTitle && item.id === "morning-water" ? { ...item, title: "Drink water before the morning planning and stretching routine" } : item), [longTitle]);
  const [dismissedAllDayIds, setDismissedAllDayIds] = useState<string[]>([]);
  const [clockMinutes, setClockMinutes] = useState(13 * 60 + 20);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const benchRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogLauncherRef = useRef<HTMLElement | null>(null);

  const now = useMemo(
    () =>
      Temporal.ZonedDateTime.from({
        timeZone: TIMEZONE,
        year: 2026,
        month: 6,
        day: 8,
        hour: 0,
      })
        .add({ minutes: clockMinutes })
        .toInstant(),
    [clockMinutes],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || selectedEventIds.length === 0) return;
    dialog.showModal();
  }, [selectedEventIds]);

  useLayoutEffect(() => {
    const bench = benchRef.current;
    const drawer = selectedEventIds.length ? dialogRef.current : bench?.querySelector<HTMLElement>('[data-calendar-drawer="preview"]');
    if (!bench || !drawer) return;
    const measure = () => bench.style.setProperty("--drawer-height", `${drawer.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(drawer);
    measure();
    return () => observer.disconnect();
  }, [activeCalendar, selectedEventIds]);

  const closeDialog = useCallback(() => dialogRef.current?.close(), []);
  const openEvents = useCallback((eventIds: string[], launcher: HTMLElement) => {
    dialogLauncherRef.current = launcher;
    setSelectedEventIds(eventIds);
  }, []);
  const finishDialogClose = useCallback(() => {
    setSelectedEventIds([]);
    dialogLauncherRef.current?.focus();
    setActiveCalendar(null);
  }, []);

  return (
    <main ref={benchRef} className={`${styles.bench} bg-neutral-100 py-6 text-neutral-950`} data-drawer-open={activeCalendar || selectedEventIds.length ? "true" : undefined}>
      <div className={styles.benchScroll} data-bench-scroll>
      <div className="mx-auto grid max-w-6xl min-w-0 grid-cols-[minmax(0,1fr)] gap-5 px-4 sm:px-6">
        <header className="min-w-0 border border-neutral-300 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Ticket 132 · synthetic review evidence
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Day-progress layout comparison</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
            The first frame renders the current grouped TimelineGroup. The second frame reuses
            OccurrenceRow with compact, responsive spacing beside the proposed line.
            No provider or product data is loaded.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-neutral-200 pt-4 text-sm">
            <fieldset>
              <legend className="mb-1 font-semibold">Comparison width</legend>
              <div className="flex gap-2">
                <button className={benchButton(!narrow)} onClick={() => setNarrow(false)} type="button">Desktop</button>
                <button className={benchButton(narrow)} onClick={() => setNarrow(true)} type="button">390 px</button>
              </div>
            </fieldset>
            <label className="grid min-w-64 gap-1 font-semibold">
              Fixture clock · {formatClock(clockMinutes)}
              <input
                aria-label="Fixture clock"
                type="range"
                min={0}
                max={1439}
                step={10}
                value={clockMinutes}
                onChange={(event) => setClockMinutes(Number(event.target.value))}
              />
            </label>
            <label className="flex min-h-10 items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={showAllDay}
                onChange={(event) => setShowAllDay(event.target.checked)}
              />
              Show all-day context
            </label>
            <label className="flex min-h-10 items-center gap-2 font-semibold">
              <input type="checkbox" checked={longTitle} onChange={(event) => setLongTitle(event.target.checked)} />
              Long Behavior title
            </label>
            <label className="flex min-h-10 items-center gap-2 font-semibold">
              <input type="checkbox" checked={withDuration} onChange={(event) => setWithDuration(event.target.checked)} />
              Evening Behavior duration · 3 hours
            </label>
          </div>
        </header>

        <section aria-labelledby="comparison-heading" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
          <div>
            <h2 id="comparison-heading" className="text-xl font-semibold">More room for the timeline</h2>
            <p className="mt-1 text-sm text-neutral-600">
              The ledger stays on the right. Calendar markers stay on the left, with a clear gap.
              All Day Events sits beside the date. Desktop action labels yield only when the title needs space; mobile uses check and X.
            </p>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
            <ComparisonFrame label="Current · grouped by Behavior" narrow={narrow}>
              <TimelineGroup
                section={currentSection}
                statusAction={statusAction}
                noteAction={noteAction}
                startTimeTrackingAction={startTimeTrackingAction}
                stopTimeTrackingAction={stopTimeTrackingAction}
                resetTimeTrackingAction={resetTimeTrackingAction}
              />
            </ComparisonFrame>

            <ComparisonFrame label="Proposed · one continuous timeline" narrow={narrow} withLine>
              {[
                { localDate: "2026-06-08", relativeLabel: "Today", label: "Monday, June 8", section: currentSection },
                { localDate: "2026-06-09", relativeLabel: "Tomorrow", label: "Tuesday, June 9", section: emptySection },
                { localDate: "2026-06-10", relativeLabel: "In two days", label: "Wednesday, June 10", section: longGapSection },
              ].map((day) => (
                <MeasuredDayProgress key={day.localDate}
                  localDate={day.localDate} relativeLabel={day.relativeLabel} label={day.label}
                  occurrences={day.localDate === "2026-06-08" ? previewOccurrences : day.section.occurrences} events={calendarEvents} now={now}
                  showAllDay={showAllDay} withDuration={withDuration} previewActive={activeCalendar?.day === day.localDate}
                  activeEventIds={activeCalendar?.ids ?? []} onHighlightEvents={highlightEvents}
                  dismissedAllDayIds={dismissedAllDayIds}
                  onRestoreAllDay={() => setDismissedAllDayIds([])} onOpenEvents={openEvents}
                  statusAction={statusAction} noteAction={noteAction}
                  startTimeTrackingAction={startTimeTrackingAction}
                  stopTimeTrackingAction={stopTimeTrackingAction}
                  resetTimeTrackingAction={resetTimeTrackingAction} />
              ))}
            </ComparisonFrame>
          </div>
        </section>

        <aside className="border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <strong>Reading the line:</strong> ×2 and ×3 collect events with exactly the same start time.
          Nearby starts stay separate; crowded markers shift to keep each control reachable.
          The blue dot shows only the current time. Rows keep their original colors.
          Hover or focus a Calendar marker to reveal its duration on the line and outline overlapping Behaviors.
          Hover, focus, or tap opens the same persistent preview. Each event has its own View details action.
          Duration highlights start at the displayed stem and continue through day headings.
          Spacing follows rows, not a uniform hourly scale.
        </aside>
      </div>

      </div>
      <EventDialog
        ref={dialogRef}
        eventIds={selectedEventIds}
        onClose={finishDialogClose}
        closeDialog={closeDialog}
        onDismissAllDay={(id) => { setDismissedAllDayIds((ids) => [...ids, id]); closeDialog(); }}
      />
    </main>
  );
}

function ComparisonFrame({ label, narrow, withLine = false, children }: Readonly<{ label: string; narrow: boolean; withLine?: boolean; children: React.ReactNode }>) {
  return (
    <article className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <h3 className="text-sm font-semibold text-neutral-700">{label}</h3>
      <div
        className={[
          "bg-white outline outline-1 outline-neutral-300",
          narrow
            ? "relative left-1/2 w-[390px] max-w-[100vw] -translate-x-1/2"
            : "mx-auto w-full max-w-[880px]",
        ].join(" ")}
        data-bench-viewport={narrow ? "390" : "desktop"}
      >
        <div className={`bg-background py-4 text-foreground ${withLine ? `${styles.proposed} px-4` : narrow ? "px-4" : "pl-14 pr-4"}`}>
          {withLine ? <div className={styles.spine} data-timeline-spine aria-hidden="true" /> : null}
          {children}
        </div>
      </div>
    </article>
  );
}

type MeasuredDayProgressProps = DayProgressBenchProps & Readonly<{
  localDate: string;
  relativeLabel: string;
  label: string;
  occurrences: TimelineOccurrenceView[];
  events: BenchEvent[];
  now: NonNullable<LayoutInput["now"]>;
  showAllDay: boolean;
  previewActive: boolean;
  withDuration: boolean;
  activeEventIds: string[];
  onHighlightEvents: (day: string, ids: string[]) => void;
  dismissedAllDayIds: string[];
  onRestoreAllDay: () => void;
  onOpenEvents: (eventIds: string[], launcher: HTMLElement) => void;
}>;

type PreviewTarget = { eventIds: string[]; anchor: HTMLElement };
type RowGeometry = { iconsOnly: boolean; statusWidth: number; statusInset: number };

function MeasuredDayProgress({
  localDate, relativeLabel, label, occurrences, events, now,
  showAllDay, previewActive, withDuration, activeEventIds, onHighlightEvents, dismissedAllDayIds, onRestoreAllDay,
  onOpenEvents, ...actions
}: MeasuredDayProgressProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const rowElements = useRef(new Map<string, HTMLElement>());
  const [geometry, setGeometry] = useState<{ day: MeasuredDay; iconX: number; axisX: number; sectionTop: number; sectionBottom: number; rows: Record<string, RowGeometry> } | null>(null);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const previewId = `${localDate}-calendar-preview`;
  const previewEvents = useMemo(() => (preview?.eventIds ?? []).flatMap((id) => {
    const event = events.find((item) => item.id === id);
    return event ? [event] : [];
  }), [events, preview]);

  const dismissPreview = useCallback(() => {
    setPreview(null);
    onHighlightEvents(localDate, []);
  }, [localDate, onHighlightEvents]);
  const showPreview = useCallback((eventIds: string[], anchor: HTMLElement) => {
    setPreview({ eventIds, anchor });
    onHighlightEvents(localDate, eventIds);
  }, [localDate, onHighlightEvents]);
  const openEvents = useCallback((ids: string[], launcher: HTMLElement) => {
    dismissPreview();
    onOpenEvents(ids, launcher);
  }, [dismissPreview, onOpenEvents]);

  useEffect(() => {
    if (!preview || !previewActive) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.getElementById(previewId)?.contains(document.activeElement)) preview.anchor.focus();
      dismissPreview();
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
    };
  }, [dismissPreview, preview, previewActive, previewId]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const rootRect = root.getBoundingClientRect();
      const sectionRect = sectionRef.current!.getBoundingClientRect();
      const rowGeometry: Record<string, RowGeometry> = {};
      const rows = occurrences.flatMap((item) => {
        const row = rowElements.current.get(item.id);
        const time = row?.querySelector("time");
        if (!time) return [];
        const rect = time.getBoundingClientRect();
        const summary = row!.querySelector<HTMLElement>("summary")!;
        const bounds = summary.getBoundingClientRect();
        const title = row!.querySelector<HTMLElement>(".timeline-occurrence-title")!;
        const main = row!.querySelector<HTMLElement>(".timeline-occurrence-main")!;
        const actionLabels = [...row!.querySelectorAll("[data-status-region='actions'] button span")];
        // Measure the full text even when the current presentation clips or hides it.
        const textWidth = (element: Element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return range.getBoundingClientRect().width;
        };
        const statusWidth = actionLabels.reduce((width, label) => width + Math.max(44, textWidth(label) + 22), 8);
        const status = row!.querySelector<HTMLElement>(".timeline-occurrence-status");
        const statusInset = (status ? Number.parseFloat(getComputedStyle(status).marginRight) || 0 : 0) + 12;
        const required = Number.parseFloat(getComputedStyle(summary).paddingLeft) + rect.width
          + Number.parseFloat(getComputedStyle(main).columnGap) + textWidth(title) + statusWidth + statusInset;
        rowGeometry[item.id] = {
          statusWidth, statusInset,
          iconsOnly: getComputedStyle(root).getPropertyValue("--status-icons-only").trim() === "1" || required > bounds.width,
        };
        return [{ occurrenceId: item.id, scheduledFor: item.scheduledFor, center: rect.top - rootRect.top + rect.height / 2 }];
      });
      setGeometry({
        day: { localDate, top: 0, bottom: Math.max(rootRect.height, 96), rows },
        rows: rowGeometry,
        sectionTop: sectionRect.top - rootRect.top,
        sectionBottom: sectionRect.bottom - rootRect.top,
        axisX: -Number.parseFloat(getComputedStyle(root).getPropertyValue("--timeline-gap")),
        iconX: Number.parseFloat(getComputedStyle(root).getPropertyValue("--calendar-node-x")),
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(sectionRef.current!);
    for (const row of rowElements.current.values()) observer.observe(row);
    measure();
    let active = true;
    document.fonts?.ready.then(() => { if (active) measure(); });
    return () => { active = false; observer.disconnect(); };
  }, [localDate, occurrences]);

  const dayLayout = useMemo(() => {
    if (!geometry || geometry.day.rows.length !== occurrences.length) return null;
    return resolveDayProgressLayout({
      timezone: TIMEZONE, days: [geometry.day], firstVisibleDate: "2026-06-08", events, now,
      minIconSpacing: MIN_ICON_SPACING, maxIconLanes: 1,
    }).days[0] ?? null;
  }, [events, geometry, now, occurrences.length]);
  const contexts = useMemo(() => new Map(occurrences.map((item) => [item.id,
    resolveTimelineOccurrenceContext({
      occurrenceId: item.id, scheduledFor: item.scheduledFor, runningStartedAt: null,
      estimate: withDuration && item.id === "evening-water"
        ? { kind: "known", seconds: 10800, durationLabel: "3h", sampleCount: 3, lookbackDays: 90, provenance: "completed_stopped_occurrence_mean" }
        : { kind: "unknown", reason: "insufficient_samples", sampleCount: 0, requiredSampleCount: 3, lookbackDays: 90 },
      events, now,
      freshness: { state: "current", refreshedAt: now.toString(), label: "Synthetic Calendar", canAssertNoOverlap: true },
    }),
  ])), [events, now, occurrences, withDuration]);
  const allDay = (dayLayout?.allDayEventIds ?? []).flatMap((id) => {
    const event = events.find((item) => item.id === id);
    return event ? [event] : [];
  });
  const visibleAllDay = allDay.filter((event) => !dismissedAllDayIds.includes(event.id));
  const hiddenCount = allDay.length - visibleAllDay.length;
  const allDayLabel = visibleAllDay.length
    ? `All day: ${visibleAllDay[0].title}${visibleAllDay.length > 1 ? ` +${visibleAllDay.length - 1} more` : ""}`
    : "Restore All Day Events";

  return (
    <section ref={sectionRef} aria-labelledby={`${localDate}-proposed-title`} className={styles.day}>
      <div className={styles.dayHeader}>
        <header className="mb-3 border-b border-line pb-3">
          <p className="text-sm font-bold text-muted-readable">{relativeLabel}</p>
          <div className={styles.dateTitle}>
            <h2 id={`${localDate}-proposed-title`} className="text-2xl font-bold leading-tight">
              <time dateTime={localDate}>{label}</time>
            </h2>
            {showAllDay && allDay.length > 0 ? (
              <aside className={styles.allDay} aria-label={`All day · ${label}`}>
                <button type="button" data-all-day-control
                  title={visibleAllDay.map((event) => event.title).join(", ")}
                  aria-describedby={previewActive && preview?.anchor.hasAttribute("data-all-day-control") ? previewId : undefined}
                  onPointerEnter={(pointer) => { if (pointer.pointerType !== "touch" && visibleAllDay.length) showPreview(visibleAllDay.map((event) => event.id), pointer.currentTarget); }}
                  onFocus={(focus) => { if (visibleAllDay.length) showPreview(visibleAllDay.map((event) => event.id), focus.currentTarget); }}
                  onClick={(click) => { if (hiddenCount === allDay.length) onRestoreAllDay(); else showPreview(visibleAllDay.map((event) => event.id), click.currentTarget); }}
                  className={styles.allDayCount}>
                  <span>{allDayLabel}</span>
                </button>
                {hiddenCount > 0 && hiddenCount < allDay.length ? <button type="button" className="min-h-11 text-xs underline" onClick={() => onRestoreAllDay()}>Restore ({hiddenCount})</button> : null}
              </aside>
            ) : null}
          </div>
        </header>
      </div>
      <div className={styles.feed}>
        <div ref={rootRef} className="relative min-h-24 py-4" data-day-progress-date={localDate}
          style={{ minHeight: Math.max(96, dayLayout?.requiredIconHeight ?? 0) }}>
          {dayLayout && geometry ? (
            <DayOverlay layout={dayLayout} events={events} iconX={geometry.iconX} axisX={geometry.axisX}
              previewId={previewActive ? previewId : undefined} onPreview={showPreview}
              activeEventIds={activeEventIds} sectionTop={geometry.sectionTop} sectionBottom={geometry.sectionBottom} />
          ) : null}
          {occurrences.length === 0 ? (
            <p className="bg-surface p-3 text-sm leading-6 text-muted-readable">No behaviors on this day.</p>
          ) : (
            <div className="grid gap-1">
              {occurrences.map((item) => {
                const row = geometry?.rows[item.id];
                const overlapping = contexts.get(item.id)?.overlappingEventIds ?? [];
                const highlighted = overlapping.some((id) => activeEventIds.includes(id));
                return <div key={item.id} ref={(node) => {
                  if (node) rowElements.current.set(item.id, node);
                  else rowElements.current.delete(item.id);
                }} data-bench-occurrence={item.id}
                  data-event-highlight={highlighted ? "true" : undefined}
                  data-status-icons-only={row?.iconsOnly ? "true" : "false"}
                  style={{ "--bench-status-reserve": `${(row?.statusWidth ?? 240) + (row?.statusInset ?? 28)}px` } as CSSProperties}>
                  <OccurrenceRow occurrence={item} statusIconsOnly={row?.iconsOnly ?? false} {...actions} />
                </div>;
              })}
            </div>
          )}
        </div>
      </div>
      {previewActive && preview && previewEvents.length > 0 ? (
        <EventPreviewDrawer id={previewId} events={previewEvents} anchor={preview.anchor}
          onDismiss={dismissPreview}
          onOpen={(eventId) => openEvents([eventId], preview.anchor)} />
      ) : null}
    </section>
  );
}

function DayOverlay({ layout, events, axisX, iconX, previewId, activeEventIds, sectionTop, sectionBottom, onPreview }: Readonly<{
  layout: ReturnType<typeof resolveDayProgressLayout>["days"][number];
  events: BenchEvent[];
  axisX: number;
  iconX: number;
  previewId?: string;
  activeEventIds: string[];
  sectionTop: number;
  sectionBottom: number;
  onPreview: (eventIds: string[], anchor: HTMLElement) => void;
}>) {
  const controls = [
    ...layout.timedEventSpans.filter((span) => span.iconLane !== null && !span.overflowGroupId).map((span) => ({
      id: span.eventId, position: span.iconPosition, eventIds: [span.eventId], count: 1,
    })),
    ...layout.iconOverflowGroups,
  ].sort((left, right) => left.position - right.position);
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden={false}>
      <svg className="absolute inset-0 h-full w-full overflow-visible text-muted-readable" aria-hidden="true">
        {controls.map((control) => (
          <line key={control.id} data-calendar-stem={control.id} x1={iconX} x2={axisX}
            y1={control.position} y2={control.position} stroke="currentColor" />
        ))}
        {/* Use the displayed stem, with adjoining section edges for uninterrupted overnight spans. */}
        {layout.timedEventSpans.filter((span) => activeEventIds.includes(span.eventId) && span.endPosition !== null).map((span) => (
          <line key={span.eventId} data-event-duration={span.eventId} x1={axisX} x2={axisX}
            y1={span.continuesBefore && span.iconLane === null && !span.overflowGroupId ? sectionTop : span.iconPosition}
            y2={span.continuesAfter ? sectionBottom : Math.min(layout.bottom, span.iconPosition + Math.max(2, span.endPosition! - span.startPosition))} stroke="var(--calendar-overlap)" strokeWidth={6} strokeOpacity={0.65} />
        ))}
        {layout.movingDot ? <circle data-current-time-marker cx={axisX} cy={layout.movingDot.displayPosition} r={5} fill="var(--primary)" stroke="var(--background)" strokeWidth={2} /> : null}
      </svg>
      {controls.map((control) => {
        const event = events.find((item) => item.id === control.eventIds[0]);
        if (!event) return null;
        return (
          <button key={control.id} type="button" data-calendar-node={control.id}
            className="pointer-events-auto absolute z-20 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center"
            style={{ left: iconX, top: control.position }}
            aria-label={control.count > 1 ? `Preview ${control.count} Calendar events starting at the same time` : `Preview Calendar event: ${event.title}`}
            aria-describedby={control.eventIds.some((id) => activeEventIds.includes(id)) ? previewId : undefined}
            onPointerEnter={(pointer) => { if (pointer.pointerType !== "touch") onPreview([...control.eventIds], pointer.currentTarget); }}
            onFocus={(focus) => onPreview([...control.eventIds], focus.currentTarget)}
            onClick={(click) => onPreview([...control.eventIds], click.currentTarget)}>
            <span className={styles.eventMarker} data-group-variant={control.count > 1 ? "badge" : undefined} aria-hidden="true">
              {control.count > 1 ? <><CalendarDays size={18} /><span className={styles.countBadge}>×{control.count}</span></>
                : <CalendarDays size={14} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EventPreviewDrawer({ id, events, anchor, onDismiss, onOpen }: Readonly<{
  id: string; events: BenchEvent[]; anchor: HTMLElement;
  onDismiss: () => void; onOpen: (eventId: string) => void;
}>) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { ref.current?.showPopover(); }, []);
  return (
    <div ref={ref} id={id} popover="manual" role="dialog" aria-label={events.every((event) => event.kind === "all_day") ? "All Day Events preview" : `Calendar preview: ${events[0].title}`}
      className={`${styles.drawer} bg-background text-sm text-foreground`} data-calendar-drawer="preview">
      <div className={`${styles.drawerContent} mx-auto flex max-w-6xl gap-4 px-4 py-4 sm:px-6`}>
        <div className={styles.drawerEvents}>
          {events.map((event) => <article key={event.id} className="min-w-0">
            <h3 className="break-words font-bold">{event.title}</h3>
            <p className="mt-1 text-xs text-muted-readable">{event.calendarName} · {eventTimeLabel(event)}</p>
            {event.location ? <p className="mt-2 break-words text-xs">{event.location}</p> : null}
            <button type="button" onClick={() => onOpen(event.id)} aria-label={`View details: ${event.title}`}
              className="min-h-11 font-bold underline underline-offset-4">View details</button>
          </article>)}
        </div>
        <button type="button" onClick={() => { anchor.focus(); onDismiss(); }} aria-label="Dismiss Calendar preview"
          className="grid h-11 w-11 shrink-0 place-items-center"><X size={16} aria-hidden="true" /></button>
      </div>
    </div>
  );
}

const EventDialog = forwardRef<HTMLDialogElement, Readonly<{
  eventIds: string[];
  onClose: () => void;
  closeDialog: () => void;
  onDismissAllDay: (id: string) => void;
}>>(function EventDialog({ eventIds, onClose, closeDialog, onDismissAllDay }, ref) {
  const selected = eventIds.flatMap((id) => {
    const event = calendarEvents.find((item) => item.id === id);
    return event ? [event] : [];
  });

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="calendar-dialog-title" className={`${styles.drawer} bg-background text-foreground backdrop:bg-black/20`} data-calendar-drawer="details">
      <div className="flex items-start justify-between border-b border-neutral-200 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Synthetic Calendar details</p>
          <h2 id="calendar-dialog-title" className="mt-1 text-xl font-semibold">{selected.length > 1 ? `${selected.length} Calendar events` : selected[0]?.title ?? "Calendar event"}</h2>
        </div>
        <button type="button" onClick={closeDialog} className="grid h-11 w-11 place-items-center" aria-label="Close Calendar details"><X aria-hidden="true" /></button>
      </div>
      <div className="grid gap-4 p-4">
        {selected.map((event) => (
          <article key={event.id} className="grid min-w-0 gap-2 border border-neutral-200 p-3 text-sm leading-6">
            <h3 className="break-words font-semibold">{event.title}</h3>
            <p className="break-words">{event.description || availabilityLabel(event, "description")}</p>
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3">
              <dt className="font-semibold">Calendar</dt><dd>{event.calendarName}</dd>
              <dt className="font-semibold">Time</dt><dd>{eventTimeLabel(event)}</dd>
              <dt className="font-semibold">Location</dt><dd className="break-words">{event.location || availabilityLabel(event, "location")}</dd>
              <dt className="font-semibold">Organizer</dt><dd className="break-words">{event.organizer?.displayName ?? availabilityLabel(event, "organizer")}</dd>
              <dt className="font-semibold">Attendees</dt><dd className="break-words">{event.attendees?.map((attendee) => attendee.displayName ?? attendee.email ?? "Unnamed attendee").join(", ") || availabilityLabel(event, "attendees")}</dd>
              <dt className="font-semibold">Conference</dt><dd className="break-words">{event.conference?.name ?? availabilityLabel(event, "conference")}</dd>
              <dt className="font-semibold">Attachments</dt><dd className="break-words">{event.attachments?.map((attachment) => attachment.title ?? "Untitled attachment").join(", ") || availabilityLabel(event, "attachments")}</dd>
            </dl>
            {event.kind === "all_day" ? <button type="button" className="min-h-11 text-left font-semibold underline underline-offset-4" aria-label={`Dismiss all-day event: ${event.title}`} onClick={() => onDismissAllDay(event.id)}>Dismiss from timeline</button> : null}
            {event.sourceUrl ? (
              <a href={event.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline underline-offset-4">
                Open source event <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : null}
          </article>
        ))}
      </div>
    </dialog>
  );
});

function occurrenceInput(
  id: string,
  behaviorId: string,
  title: string,
  scheduledFor: string,
  localDate: string,
  scheduledTimeLabel: string,
  status: "unresolved" | "completed" | "not_completed" = "unresolved",
  runningStartedAt: string | null = null,
): TimelineOccurrenceInput {
  return {
    id,
    behaviorId,
    title,
    scheduledFor,
    scheduledTimeLabel,
    localDate,
    status,
    statusMarkedAt: { unresolved: null, completed: scheduledFor, not_completed: scheduledFor }[status],
    description: "Synthetic Behavior used to compare layout without changing the production timeline.",
    categoryName: "Review fixture",
    scheduleSummary: `Scheduled at ${scheduledTimeLabel}`,
    note: { unresolved: "", completed: "Synthetic note.", not_completed: "Synthetic note." }[status],
    timeTracking: {
      recordedSeconds: { unresolved: 0, completed: 840, not_completed: 0 }[status],
      runningStartedAt,
    },
    canStartTimeTracking: true,
  };
}

function requiredSection(index: number) {
  const section = timelineFixture.daySections[index];
  if (!section) throw new Error(`Missing day-progress fixture section ${index}.`);
  return section;
}

function eventTimeLabel(event: BenchEvent) {
  if (event.kind === "all_day") {
    return allDayRangeLabel(event.startLocalDate, event.endLocalDate);
  }
  const start = Temporal.Instant.from(event.startAt).toZonedDateTimeISO(TIMEZONE);
  const end = Temporal.Instant.from(event.endAt).toZonedDateTimeISO(TIMEZONE);
  const timeOptions = { hour: "numeric", minute: "2-digit" } as const;
  const options = start.toPlainDate().equals(end.toPlainDate())
    ? timeOptions : { ...timeOptions, month: "short", day: "numeric" } as const;
  return `${start.toLocaleString("en-US", options)}–${end.toLocaleString("en-US", options)}`;
}

function availabilityLabel(
  event: BenchEvent,
  field: "description" | "location" | "organizer" | "attendees" | "conference" | "attachments",
) {
  const reason = event.fieldAvailability[field];
  if (reason === "restricted") return "Restricted by the source.";
  if (reason === "provider_omitted") return "The source omitted this detail.";
  if (reason === "not_provided") return "Not provided.";
  return "No detail available.";
}

function formatClock(totalMinutes: number) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function benchButton(active: boolean) {
  return `min-h-10 border px-3 font-semibold ${active ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-300 bg-white text-neutral-900"}`;
}
