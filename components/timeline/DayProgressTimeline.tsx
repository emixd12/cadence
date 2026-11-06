"use client";

import { combineExternalEventFreshness, projectExternalEventSchedulingEvent } from "@cadence/core/services/external-event-projection";
import { CalendarDays } from "lucide-react";
import type { TravelEvidenceResult, TravelLeaveAnswer, TravelMode, TravelNavigationPreference } from "@cadence/core/types/travel";
import { Temporal } from "@js-temporal/polyfill";
import { useDevelopmentBuild, useRefresh } from "@cadence/ui/runtime";
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
import { resolveTravelAfterDecisions } from "@cadence/core/resolvers/travel.resolver";
import { resolveDepartureModel, resolveTomorrowFirstTrip } from "@cadence/core/resolvers/departure.resolver";
import { departureStops, firstLocatedStopAhead } from "@cadence/core/services/departure-stops";
import type { DepartureModel, DepartureStop } from "@cadence/core/types/departure";
import { DEPARTURE_REFRESH_LABEL, departureMarkerRailLines } from "@cadence/core/services/departure-phrases";
import { nextTripCrowdsBehavior, resolveDayProgressLayout, resolveNextTripMarkInput } from "@cadence/core/resolvers/day-progress.resolver";
import { resolveTimelineOccurrenceContext } from "@cadence/core/resolvers/timeline-context.resolver";
import type {
  BehaviorDurationEstimate,
  ExternalEventFreshness,
  NormalizedExternalEvent,
  DayProgressNextTripInput,
  TimelineOccurrenceContext,
} from "@cadence/core/types/day-progress";

import { ExternalEventDetails, ExternalEventPreview, TravelNavigationLink, externalEventSourceName, renderTravelTiming, type TravelRefreshAction } from "./ExternalEventDetails";
import { travelWeatherStateText } from "./TravelWeather";
import { RecordedActivityList } from "./RecordedActivityList";
import { TravelLeaveQuestion } from "./TravelLeaveQuestion";
import { TravelModeChoice } from "./TravelModeChoice";
import { TravelOffOffer, TravelStepText, dismissTravelOffer, isTravelStep, travelOfferDismissed, type TravelLinkTarget, type TravelStepActions } from "./TravelNextStep";
import { OccurrenceRow } from "./OccurrenceRow";
import { useDayProgressClock } from "./day-progress-clock";
import { leaveReminderLinkTarget } from "@/lib/ui/leave-reminder-link";
import styles from "./day-progress-timeline.module.css";
import { useWebGoogleCalendarTimeline } from "@/lib/ui/google-calendar";
import { useWebHevyActivityTimeline, useWebIcloudCalendarTimeline, useWebOutlookCalendarTimeline, type ConnectorTimelineState, type HevyTimelineState, type OutlookTimelineState } from "@/lib/ui/connectors";
import { publishBriefTravel } from "@/lib/ui/brief-travel";
import { briefTravelSubjects, projectBriefTravelGuidance } from "@cadence/core/services/brief-travel-guidance";
import { TRAVEL_CLEARANCE_MESSAGE, TRAVEL_UNAVAILABLE_MESSAGE, travelSourceKey as buildTravelSourceKey, travelStopRevisions, travelTomorrowStopKey, useTravelContext, type TravelCorrection, type TravelState } from "@/lib/ui/travel";
import { webTravelSettingsClient, type TravelSettingsClient } from "@/lib/ui/travel-settings";
import {
  dismissTravelLeaveQuestion,
  rememberTravelLeaveCandidates,
  travelLeaveCandidates,
  travelLeaveQuestionDismissed,
  useTravelHabits,
  type TravelHabitsState,
} from "@/lib/ui/travel-habits";
import {
  resolveTravelHabits,
  resolveTravelLeavePrompt,
  restoreTravelLeaveCandidates,
  routedOutboundCandidates,
  travelArrivalPhrase,
  travelLeaveSubjects,
} from "@cadence/core/services/travel-habits";
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
  /** Ticket 217: saves learned habits (desktop: SQLite, then account synchronization). */
  travelSettingsClient?: TravelSettingsClient | null;
  /** Ticket 238: today's recorded Hevy workouts, shown apart from Calendar markers. */
  recordedActivity?: HevyTimelineState | null;
  /** Ticket 238: status lines for calendar sources other than Google. */
  sourceMessages?: readonly string[];
  /** Ticket 273 (Mac): opens Travel settings. Without it no step links there and Travel estimates are not offered. */
  openTravelSettings?: () => void;
  /** Ticket 273 (Mac): opens the Behaviors screen, where a Behavior's place is changed. */
  openBehavior?: (behaviorId: string) => void;
  /**
   * Ticket 280 (Mac): today's departure model for native leave reminders, each time it changes.
   * `trips` is null while no travel evidence is known.
   */
  onDeparture?: (departure: DepartureSnapshot) => void;
  /** Ticket 280 (Mac): opens this Calendar event's drawer once for each request key. */
  openEvent?: Readonly<{ eventId: string; requestKey: number }> | null;
}>;

/** Ticket 280: what the departure model says about today, for the Mac's leave reminders. */
export type DepartureSnapshot = Readonly<{
  localDate: string;
  preparationSeconds: number;
  trips: DepartureModel["trips"] | null;
  stops: readonly DepartureStop[];
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
  /** Ticket 278: the trip digest from a web leave reminder's link. */
  leaveReminderDigest?: string | null;
}>;

/**
 * Ticket 270 (D13, D14): a short magenta leader runs from the top of the next trip's span, at the
 * leave time, perpendicular to the axis into the left rail. Its label sits at the leader's end:
 * one line ("Leave 1:15") on wide layouts, one short word group per line on phones (D14).
 */
const LEADER_LENGTH = 14;
const LEADER_LABEL_GAP = 2;
/** The stacked label's column. A one-line label takes its own width. */
const LEADER_LABEL_WIDTH = 32;
const LEADER_LABEL_LINE = 16;
/** A one-line label's width per character at 11px, rounded up, used only to decide whether it meets the Calendar markers. */
const LEADER_LABEL_CHAR_WIDTH = 6;
/** The current-time dot's radius plus its stroke and 1px of air: the leader starts here when the dot sits on it. */
const CURRENT_TIME_CLEARANCE = 8;
/** The most room the leader and its gap take from the axis, when the dot sits on the leave point. */
const LEADER_REACH = CURRENT_TIME_CLEARANCE + LEADER_LENGTH + LEADER_LABEL_GAP;

type MeasuredDay = Parameters<typeof resolveDayProgressLayout>[0]["days"][number] & Readonly<{
  axisX: number;
  iconX: number;
  /** D14: the phone layout stacks the next trip's label, one word group per line. */
  stackLabel: boolean;
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
const OUTLOOK_ACTIVE: ReadonlySet<ConnectorTimelineState> = new Set(["reconnect_required", "empty", "ready", "stale", "incomplete", "error"]);

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
  leaveReminderDigest = null,
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
  const liveConnectors = liveCalendar && !context;
  const outlook = useWebOutlookCalendarTimeline({ enabled: liveConnectors, todayLocalDate: timeline.todayLocalDate,
    lastLocalDate: visibleSections.at(-1)?.localDate, timezone: timeline.timezone });
  const icloud = useWebIcloudCalendarTimeline({ enabled: liveConnectors, todayLocalDate: timeline.todayLocalDate,
    lastLocalDate: visibleSections.at(-1)?.localDate, timezone: timeline.timezone });
  const icloudActive = liveConnectors && OUTLOOK_ACTIVE.has(icloud.state);
  const hevy = useWebHevyActivityTimeline({ enabled: liveConnectors, todayLocalDate: timeline.todayLocalDate, timezone: timeline.timezone });
  const outlookActive = liveConnectors && OUTLOOK_ACTIVE.has(outlook.state);
  const googleEvents = useMemo(() => live.snapshot?.events.filter((event) =>
    !live.hiddenCalendarIds.includes(event.calendarId) && (live.showAllDay || event.kind !== "all_day"),
  ) ?? EMPTY_EVENTS, [live.hiddenCalendarIds, live.showAllDay, live.snapshot]);
  const outlookEvents = useMemo(() => outlookActive ? outlook.snapshot?.events.filter((event) =>
    !outlook.hiddenCalendarIds.includes(event.calendarId) && (outlook.showAllDay || event.kind !== "all_day"),
  ) ?? EMPTY_EVENTS : EMPTY_EVENTS, [outlook.hiddenCalendarIds, outlook.showAllDay, outlook.snapshot, outlookActive]);
  const icloudEvents = useMemo(() => icloudActive ? icloud.snapshot?.events.filter((event) =>
    !icloud.hiddenCalendarIds.includes(event.calendarId) && (icloud.showAllDay || event.kind !== "all_day"),
  ) ?? EMPTY_EVENTS : EMPTY_EVENTS, [icloud.hiddenCalendarIds, icloud.showAllDay, icloud.snapshot, icloudActive]);
  const contextEvents = context?.events;
  const events = useMemo(() => contextEvents ?? (outlookEvents.length || icloudEvents.length ? [...googleEvents, ...outlookEvents, ...icloudEvents] : googleEvents),
    [contextEvents, googleEvents, outlookEvents, icloudEvents]);
  // Travel estimates and their brief guidance stay Google-only (Ticket 238 adds no new routing disclosure).
  const travelEvents = useMemo(() => events.some((event) => event.source !== "google_calendar") ? events.filter((event) => event.source === "google_calendar") : events, [events]);
  const travelSourceKey = buildTravelSourceKey(travelEvents, timeline);
  const stopRevisions = useMemo(() => travelStopRevisions(travelEvents, timeline), [travelEvents, timeline]);
  const tomorrowStopKey = useMemo(() => travelTomorrowStopKey(travelEvents, timeline), [travelEvents, timeline]);
  const currentCorrections = useMemo(() => corrections.filter((correction) => travelEvents.some((event) => event.id === correction.eventId && (event.revision.providerEtag ?? event.revision.providerUpdatedAt) === correction.revision)), [corrections, travelEvents]);
  const liveTravel = useTravelContext({ enabled: liveCalendar && !context, accountId: travelAccountId,
    localDate: timeline.todayLocalDate, sourceKey: travelSourceKey, corrections: currentCorrections, timezone: timeline.timezone,
    // Ticket 268: automatic travel requests wait for the Google Calendar read that feeds travel to settle.
    sourceReady: live.state !== "not_loaded", stopRevisions, tomorrowStopKey });
  const routeEvidence = context?.travel ?? liveTravel.view?.evidence;
  const durations = context?.durationEstimates ?? timeline.durationEstimates;
  const travel = useMemo(() => routeEvidence ? resolveTravelAfterDecisions(routeEvidence,
    timeline.daySections.flatMap(section => section.occurrences), durations,
  ) : routeEvidence, [routeEvidence, timeline.daySections, durations]);
  const travelStatus = context ? context.travelStatus ?? null : liveTravel;
  const invalidTravelMessage = routeEvidence && !travel ? "Travel changed. Refresh travel to update estimates." : null;
  const displayedTravelStatus = invalidTravelMessage && travelStatus
    ? { ...travelStatus, view: null, message: invalidTravelMessage, stale: true } : travelStatus;

  // Ticket 217: learned habits, the journey mode choice and the once-a-day leave-time question.
  const habitsClient = context ? context.travelSettingsClient ?? null : liveCalendar ? webTravelSettingsClient : null;
  // Ticket 273: with no travel evidence, a located event ahead today loads settings to learn whether estimates are off.
  const offerStop = useMemo(() => {
    const today = timeline.daySections.find((section) => section.localDate === timeline.todayLocalDate);
    return firstLocatedStopAhead({ events: travelEvents, occurrences: today?.occurrences ?? [], now,
      localDate: timeline.todayLocalDate, timezone: timeline.timezone });
  }, [travelEvents, timeline.daySections, timeline.todayLocalDate, timeline.timezone, now]);
  const [offerDismissed, setOfferDismissed] = useState(() => typeof window !== "undefined" && travelOfferDismissed());
  const offerTarget: TravelLinkTarget | null = context ? context.openTravelSettings ? { onOpen: context.openTravelSettings } : null : { href: "/settings#travel" };
  const offerWanted = !!offerStop && !!offerTarget && !offerDismissed && !routeEvidence;
  const travelHabits = useTravelHabits(habitsClient, Boolean(routeEvidence) || offerWanted);
  const travelOffer = offerWanted && travelHabits.settings?.enabled === false ? offerStop : null;
  const usualTravelMode = context?.travelMode ?? liveTravel.view?.mode ?? null;
  // Ticket 261: one departure model for every travel line. Components only show its phrases.
  const habitsForModel = travelHabits.settings?.habits ?? null;
  const todayStops = useMemo(() => {
    const today = timeline.daySections.find((section) => section.localDate === timeline.todayLocalDate);
    return departureStops({ events: travelEvents, occurrences: today?.occurrences ?? [], durationEstimates: durations, timezone: timeline.timezone });
  }, [timeline.daySections, timeline.todayLocalDate, timeline.timezone, travelEvents, durations]);
  const preparationSeconds = resolveTravelHabits(habitsForModel).buffers.preparationSeconds;
  const departure = useMemo((): DepartureModel => {
    const buffers = resolveTravelHabits(habitsForModel).buffers;
    return resolveDepartureModel({ evidence: travel ?? null, now, timezone: timeline.timezone,
      stops: todayStops,
      arrivalBufferSeconds: buffers.arrivalSeconds, preparationSeconds: buffers.preparationSeconds,
      pausedUntil: travelStatus?.resumesAt ?? null });
  }, [travel, now, timeline.timezone, todayStops, habitsForModel, travelStatus?.resumesAt]);
  // Ticket 282: tomorrow's first trip, from its own response. It never enters `departure`, so the
  // Daily Brief, leave reminders and today's marker never see it. The line shows it once today has no trip left.
  const tomorrowView = travelStatus?.tomorrow ?? null;
  const tomorrowTrip = useMemo(() => {
    const tomorrowLocalDate = Temporal.PlainDate.from(timeline.todayLocalDate).add({ days: 1 }).toString();
    if (!tomorrowView?.view.evidence || tomorrowView.localDate !== tomorrowLocalDate) return null;
    const section = timeline.daySections.find((day) => day.localDate === tomorrowLocalDate);
    const buffers = resolveTravelHabits(habitsForModel).buffers;
    return resolveTomorrowFirstTrip({ evidence: tomorrowView.view.evidence, now, timezone: timeline.timezone, tomorrowLocalDate,
      stops: departureStops({ events: travelEvents, occurrences: section?.occurrences ?? [], durationEstimates: durations, timezone: timeline.timezone }),
      arrivalBufferSeconds: buffers.arrivalSeconds, preparationSeconds: buffers.preparationSeconds });
  }, [tomorrowView, now, timeline.todayLocalDate, timeline.daySections, timeline.timezone, travelEvents, durations, habitsForModel]);
  const onDeparture = context?.onDeparture;
  useEffect(() => {
    onDeparture?.({ localDate: timeline.todayLocalDate, preparationSeconds, trips: travel ? departure.trips : null, stops: todayStops });
  }, [onDeparture, timeline.todayLocalDate, preparationSeconds, travel, departure.trips, todayStops]);
  // Ticket 272: the bubble reads the same departure model, so it keeps last estimates and late trips.
  // Ticket 214 requests the day when a brief is generated.
  const briefTravel = useMemo(() => {
    const today = timeline.daySections.find((section) => section.localDate === timeline.todayLocalDate);
    return projectBriefTravelGuidance({
      evidence: travel, departure, localDate: timeline.todayLocalDate, now, timezone: timeline.timezone,
      ...briefTravelSubjects(today?.occurrences ?? [], travelEvents),
    });
  }, [travel, departure, travelEvents, now, timeline.daySections, timeline.todayLocalDate, timeline.timezone]);
  useEffect(() => { publishBriefTravel(briefTravel); }, [briefTravel]);
  useEffect(() => () => publishBriefTravel(null), []);
  const refreshTravel: TravelRefreshAction | null = travelStatus && !travelStatus.resumesAt
    ? { onRefresh: travelStatus.refresh, pending: travelStatus.pending } : null;
  const travelLabels = useMemo(() => new Map(departure.trips.length ? [...travelEvents.map((event) => [event.id, event.title || "Untitled event"] as const),
    ...timeline.daySections.flatMap((section) => section.occurrences.map((occurrence) => [occurrence.id, occurrence.title] as const))] : []),
  [departure.trips.length, travelEvents, timeline.daySections]);
  const travelAccountKey = travelStatus?.view?.accountId ?? travelAccountId;
  // Ticket 273: one action for each missing estimate. Corrections apply to this trip only, as INT-TRAVEL-003 does.
  const travelCorrection = context?.onTravelCorrection ?? (liveTravel.view ? (correction: TravelCorrection) => {
    setCorrections((previous) => [...previous.filter((item) => item.eventId !== correction.eventId).slice(-7), correction]);
  } : undefined);
  const [correctionRequest, setCorrectionRequest] = useState<Readonly<{ eventId: string; count: number }>>({ eventId: "", count: 0 });
  const stepActions: TravelStepActions = (() => {
    const correctable = (ref: string) => {
      const event = travelEvents.find((item) => item.id === ref);
      return travelCorrection && event?.kind === "timed" && (event.revision.providerEtag || event.revision.providerUpdatedAt) ? event : null;
    };
    const occurrences = timeline.daySections.flatMap((section) => section.occurrences);
    return {
      correction: (ref) => {
        const event = correctable(ref);
        return event ? () => {
          if (!detailEvent) drawerLauncher.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setPreview(null);
          setDetailEvent(event);
          setCorrectionRequest((previous) => ({ eventId: event.id, count: previous.count + 1 }));
        } : null;
      },
      behavior: (ref) => {
        const behaviorId = occurrences.find((occurrence) => occurrence.id === ref)?.behaviorId;
        if (!behaviorId) return null;
        if (!context) return { href: `/behaviors?behavior=${encodeURIComponent(behaviorId)}` };
        const open = context.openBehavior;
        return open ? { onOpen: () => open(behaviorId) } : null;
      },
      settings: offerTarget,
    };
  })();
  const [, setLeaveDismissals] = useState(0);
  const [leaveConfirmation, setLeaveConfirmation] = useState<string | null>(null);
  // Ticket 274: today's Calendar events and Behaviors as the current read; kept candidates take their titles from it.
  const leaveSubjects = useMemo(() => {
    const today = timeline.daySections.find((section) => section.localDate === timeline.todayLocalDate);
    return travelLeaveSubjects({ localDate: timeline.todayLocalDate, evidence: travel, events: travelEvents, occurrences: today?.occurrences ?? [] });
  }, [travel, travelEvents, timeline.daySections, timeline.todayLocalDate]);
  useEffect(() => {
    if (!travelAccountKey || !travel) return;
    rememberTravelLeaveCandidates(travelAccountKey, timeline.todayLocalDate, routedOutboundCandidates(travel, leaveSubjects));
  }, [travel, travelAccountKey, leaveSubjects, timeline.todayLocalDate]);
  const leavePrompt = travelAccountKey && travelHabits.save && travelHabits.settings ? resolveTravelLeavePrompt({
    now, localDate: timeline.todayLocalDate, habits: travelHabits.settings.habits,
    candidates: restoreTravelLeaveCandidates(travelLeaveCandidates(travelAccountKey, timeline.todayLocalDate), leaveSubjects),
    dismissed: travelLeaveQuestionDismissed(travelAccountKey, timeline.todayLocalDate),
  }) : null;
  const answerLeaveTime = async (answer: TravelLeaveAnswer) => {
    if (!leavePrompt || !travelHabits.save) throw new Error("The leave-time question is unavailable.");
    const saved = await travelHabits.save({ kind: "leave_feedback", eventRef: leavePrompt.eventRef, localDate: leavePrompt.localDate, answer });
    const arrival = travelArrivalPhrase(resolveTravelHabits(saved.habits).arrivalBufferMinutes);
    const confirmation = answer === "about_right" ? `Saved. Cadence keeps planning to arrive ${arrival}.` : `Saved. Cadence now plans to arrive ${arrival}.`;
    setLeaveConfirmation(confirmation);
    return confirmation;
  };

  // Ticket 270 (D2, D13): the next trip alone gets a span, a leader and a label without hovering.
  const nextTrip = useMemo(() => resolveNextTripMarkInput(departure.next), [departure.next]);
  const nextTripWords = useMemo(() => nextTrip && departure.next ? departureMarkerRailLines(departure.next, timeline.timezone) : null,
    [nextTrip, departure.next, timeline.timezone]);
  // D14: one line on wide layouts, the stack on phones. A one-line label that would cross the
  // Timeline's left edge also stacks, so it is never clipped.
  const [overflowingLabel, setOverflowingLabel] = useState<string | null>(null);
  const railDay = visibleSections.map((section) => measured[section.localDate]).find(Boolean);
  const nextTripLine = nextTripWords?.join(" ") ?? null;
  const nextTripLabel = useMemo(() => !nextTripWords ? null
    : railDay?.stackLabel || overflowingLabel === nextTripLine ? nextTripWords : [nextTripLine!],
  [nextTripWords, nextTripLine, railDay?.stackLabel, overflowingLabel]);
  const nextTripLabelHeight = (nextTripLabel?.length ?? 2) * LEADER_LABEL_LINE;
  const nextTripLabelWidth = nextTripLabel?.length === 1 ? nextTripLabel[0]!.length * LEADER_LABEL_CHAR_WIDTH : LEADER_LABEL_WIDTH;
  const layout = useMemo(() => {
    const days = visibleSections.flatMap((section) => measured[section.localDate] ? [measured[section.localDate]!] : []);
    if (days.length !== visibleSections.length) return null;
    const first = days[0];
    return resolveDayProgressLayout({
      timezone: timeline.timezone,
      firstVisibleDate: visibleSections[0]?.localDate,
      days,
      events: [...events],
      travelSegments: travel?.segments,
      now: Temporal.Instant.from(now),
      minIconSpacing: 44,
      maxIconLanes: 1,
      nextTrip,
      // The label clears the Calendar markers when both sit in the same part of the rail (narrow layouts).
      nextTripLabel: { height: nextTripLabelHeight,
        avoidIcons: !!first && first.axisX - LEADER_REACH - nextTripLabelWidth < first.iconX + 22 },
    });
  }, [travel, events, measured, now, timeline.timezone, visibleSections, nextTrip, nextTripLabelHeight, nextTripLabelWidth]);

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
  // Ticket 280: a leave reminder opens its event's drawer once, as soon as the event is on the Timeline.
  const openEvent = context?.openEvent;
  const [openedEventRequest, setOpenedEventRequest] = useState<number | null>(null);
  if (openEvent && openedEventRequest !== openEvent.requestKey) {
    const event = events.find((item) => item.id === openEvent.eventId);
    if (event) {
      setOpenedEventRequest(openEvent.requestKey);
      setPreview(null);
      setDetailEvent(event);
    }
  }
  // Ticket 278: a web leave reminder opens its event's drawer once, as soon as the Calendar read has
  // the event at the same start. A Behavior destination scrolls to its Occurrence. A moved or removed
  // trip matches nothing and leaves the Timeline as it is.
  const leaveTarget = useMemo(() => leaveReminderDigest
    ? leaveReminderLinkTarget(leaveReminderDigest, { events, occurrences: visibleSections.flatMap((section) => section.occurrences) })
    : null, [leaveReminderDigest, events, visibleSections]);
  const [openedLeaveDigest, setOpenedLeaveDigest] = useState<string | null>(null);
  if (leaveTarget && leaveReminderDigest && openedLeaveDigest !== leaveReminderDigest) {
    setOpenedLeaveDigest(leaveReminderDigest);
    if (leaveTarget.kind === "event") {
      setPreview(null);
      setDetailEvent(leaveTarget.event);
    }
  }
  const leaveOccurrenceId = leaveTarget?.kind === "occurrence" ? leaveTarget.occurrenceId : null;
  useEffect(() => {
    if (!leaveOccurrenceId) return;
    const row = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-occurrence-id]") ?? [])]
      .find((element) => element.dataset.occurrenceId === leaveOccurrenceId);
    if (typeof row?.scrollIntoView === "function") row.scrollIntoView({ block: "center" });
  }, [leaveOccurrenceId]);
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
  // A connected Google source that cannot read (reconnect, provider unavailable, or a failed read
  // without saved events) still blocks no-overlap claims; an unused Google source does not.
  const googleFailing = !live.snapshot && (live.state === "error"
    || (live.state === "disconnected" && (live.connectionStatus === "reconnect_required" || live.connectionStatus === "unavailable")));
  const fresh = context?.freshness ?? combineExternalEventFreshness([
    ...(live.snapshot ? [live.snapshot.freshness] : googleFailing ? [UNAVAILABLE] : []),
    ...(outlookActive ? [outlookFreshness(outlook)] : []),
    ...(icloudActive ? [outlookFreshness(icloud)] : []),
  ]) ?? UNAVAILABLE;
  const googleUnused = (outlookActive || icloudActive) && !googleFailing && (live.state === "disconnected" || live.state === "not_configured");
  const calendarState = context?.freshness
    ? calendarFreshnessLabel(context.freshness, timeline.timezone)
    : liveCalendar && !googleUnused
      ? calendarStateLabel(live.state, live.error, live.snapshot?.freshness, timeline.timezone)
      : null;
  const sourceMessages = context ? context.sourceMessages ?? [] : [
    ...(outlookActive ? [outlookStateLabel(outlook, timeline.timezone, "Outlook Calendar")] : []),
    ...(icloudActive ? [outlookStateLabel(icloud, timeline.timezone, "iCloud Calendar")] : []),
  ].filter(Boolean);
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
      {sourceMessages.map((message) => <p key={message} className={styles.calendarState} data-source-state>{message}</p>)}
      <TravelStatusLine departure={departure} status={displayedTravelStatus} message={invalidTravelMessage ?? context?.travelMessage ?? null} hasEvidence={!!travel}
        steps={stepActions} tomorrow={tomorrowTrip?.phrase ?? null} />
      {travelOffer && offerTarget ? <TravelOffOffer label={travelOffer.label} target={offerTarget} className={styles.calendarState}
        onDismiss={() => { dismissTravelOffer(); setOfferDismissed(true); }} /> : null}
      {leavePrompt ? <TravelLeaveQuestion key={leavePrompt.eventRef} title={leavePrompt.title} className={styles.calendarState} onAnswer={answerLeaveTime}
        onDismiss={() => { if (travelAccountKey) dismissTravelLeaveQuestion(travelAccountKey, timeline.todayLocalDate); setLeaveDismissals((count) => count + 1); }} />
        : leaveConfirmation ? <p className={styles.calendarState} role="status">{leaveConfirmation}</p> : null}
      {layout && firstMeasured ? <DayOverlay
        layout={layout}
        measured={measured}
        events={events}
        activeIds={activeIds}
        previewId={preview ? "calendar-preview" : undefined}
        onPreview={openPreview}
        nextTripLabel={nextTripLabel}
        onLabelOverflow={setOverflowingLabel}
      /> : null}
      {visibleSections.map((section) => <DayProgressDay
        key={section.key}
        root={rootRef}
        section={section}
        layout={layoutsByDate.get(section.localDate)}
        events={events}
        dismissedAllDay={dismissedAllDay}
        activeIds={activeIds}
        activity={section.localDate === timeline.todayLocalDate ? (context ? context.recordedActivity ?? null : hevy) : null}
        travel={travel}
        departure={departure}
        refresh={refreshTravel}
        steps={stepActions}
        now={now}
        travelHabits={travelHabits}
        usualTravelMode={usualTravelMode}
        navigationPreference={context?.navigationPreference}
        timezone={timeline.timezone}
        onOpenExternal={onOpenExternal}
        contexts={resolveContexts(section, events, fresh, now, context?.durationEstimates ?? timeline.durationEstimates, travel, travelLabels, timeline.timezone, departure)}
        nextTrip={nextTrip}
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
        departure={departure}
        refresh={refreshTravel}
        now={now}
        navigationPreference={context?.navigationPreference}
        travelMode={usualTravelMode}
        onOpenExternal={onOpenExternal}
        steps={stepActions}
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
        navigationPreference={context?.navigationPreference}
        travelMode={context?.travelMode ?? liveTravel.view?.mode}
        onTravelCorrection={travelCorrection}
        travelHabits={travelHabits}
        departure={departure}
        refresh={refreshTravel}
        now={now}
        steps={stepActions}
        correctionRequest={correctionRequest.eventId === detailEvent?.id ? correctionRequest.count : 0}
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
  activity: HevyTimelineState | null;
  contexts: ReadonlyMap<string, TimelineOccurrenceContext>;
  travel?: Omit<TravelEvidenceResult, "modelProjection"> | null;
  departure: DepartureModel;
  refresh: TravelRefreshAction | null;
  steps: TravelStepActions;
  now: string;
  travelHabits?: TravelHabitsState | null;
  usualTravelMode?: TravelMode | null;
  navigationPreference?: TravelNavigationPreference | null;
  timezone: string;
  onMeasure: () => void;
  registerMeasurement: (date: string, measure: () => MeasuredDay) => () => void;
  onPreview: (ids: string[], launcher: HTMLElement) => void;
  onRestoreAllDay: () => void;
  nextTrip: DayProgressNextTripInput | null;
}>;

function DayProgressDay({
  root,
  section,
  layout,
  events,
  dismissedAllDay,
  activeIds,
  activity,
  contexts,
  travel,
  departure,
  refresh,
  steps,
  now,
  travelHabits,
  usualTravelMode,
  navigationPreference,
  timezone,
  onOpenExternal,
  onMeasure,
  registerMeasurement,
  onPreview,
  onRestoreAllDay,
  nextTrip,
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
        stackLabel: style.getPropertyValue("--next-trip-label-stack").trim() === "1",
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
          <RecordedActivityList activity={activity} timezone={timezone} label={section.label} />
        </div>
      </header>
      <div className={styles.feed}>
        <div ref={bodyRef} className="relative min-h-24 py-4" data-day-progress-date={section.localDate}>
          {section.occurrences.length === 0 ? <p className="bg-surface p-3 text-base leading-7 text-muted-readable">{section.emptyMessage}</p> : <div className="grid gap-1">
            {section.occurrences.map((occurrence) => {
              const highlighted = contexts.get(occurrence.id)?.overlappingEventIds.some((id) => activeIds.includes(id));
              const context = contexts.get(occurrence.id);
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
                  context={context}
                  travelDetails={travelDetails({ occurrenceId: occurrence.id, placeText: occurrence.placeText, travel, departure, now, timezone, habits: travelHabits, usualMode: usualTravelMode, navigationPreference, onOpenExternal, refresh, steps })}
                  statusAction={statusAction}
                  noteAction={noteAction}
                  startTimeTrackingAction={startTimeTrackingAction}
                  stopTimeTrackingAction={stopTimeTrackingAction}
                  resetTimeTrackingAction={resetTimeTrackingAction}
                  shortcuts={shortcutsByBehavior?.[occurrence.behaviorId]}
                  statusIconsOnly={iconsOnly[occurrence.id] ?? false}
                  crowdedLine={context && nextTripCrowdsBehavior(context, nextTrip) ? context.overlapLabel : null}
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
  nextTripLabel,
  onLabelOverflow,
}: Readonly<{
  layout: ReturnType<typeof resolveDayProgressLayout>;
  measured: Readonly<Record<string, MeasuredDay>>;
  events: readonly NormalizedExternalEvent[];
  activeIds: readonly string[];
  previewId?: string;
  onPreview: (ids: string[], launcher: HTMLElement) => void;
  nextTripLabel: readonly string[] | null;
  /** D14: a one-line label that crosses the Timeline's left edge reports its text, so it stacks instead. */
  onLabelOverflow: (line: string) => void;
}>) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const label = labelRef.current;
    const overlay = overlayRef.current;
    if (!label || !overlay || nextTripLabel?.length !== 1) return;
    if (label.getBoundingClientRect().left < overlay.getBoundingClientRect().left - 0.5) onLabelOverflow(nextTripLabel[0]!);
  });
  const controls = layout.days.flatMap((day) => [
    ...day.timedEventSpans.filter((span) => span.iconLane !== null && !span.overflowGroupId).map((span) => ({ id: span.eventId, position: span.iconPosition, eventIds: [span.eventId], count: 1, iconX: 0, axisX: 0 })),
    ...day.iconOverflowGroups.map((group) => ({ id: group.id, position: group.position, eventIds: group.eventIds, count: group.count, iconX: 0, axisX: 0 })),
  ].map((control) => ({ ...control, iconX: measured[day.localDate]!.iconX, axisX: measured[day.localDate]!.axisX })));
  return (
    <div ref={overlayRef} className="pointer-events-none absolute inset-0" aria-hidden={false}>
      <svg className="absolute inset-0 h-full w-full overflow-visible text-muted-readable" aria-hidden="true">
        {controls.map((control) => <line key={control.id} data-calendar-stem={control.id} x1={control.iconX} x2={control.axisX} y1={control.position} y2={control.position} stroke="currentColor" />)}
        {layout.days.flatMap((day) => day.timedEventSpans.filter((span) => activeIds.includes(span.eventId) && span.endPosition !== null).map((span) => <line key={`${day.localDate}-${span.eventId}`} data-event-duration={span.eventId} x1={measured[day.localDate]!.axisX + 0.5} x2={measured[day.localDate]!.axisX + 0.5} y1={span.continuesBefore && span.iconLane === null && !span.overflowGroupId ? day.top : span.iconPosition} y2={span.continuesAfter ? day.bottom : Math.min(day.bottom, span.iconPosition + Math.max(2, span.endPosition! - span.startPosition))} stroke="var(--calendar-overlap)" strokeWidth={1} />))}
        {layout.days.flatMap((day) => day.travelSpans.filter((span) => span.sourceRefs.some((ref) => activeIds.includes(ref))).map((span) => <line key={`${day.localDate}-${span.segmentId}`} data-travel-duration={span.segmentId} x1={measured[day.localDate]!.axisX + 0.5} x2={measured[day.localDate]!.axisX + 0.5} y1={span.startPosition} y2={span.endPosition} stroke="var(--calendar-overlap)" strokeWidth={1} />))}
        {/* Ticket 270 (D2, D13): the next trip's span, from the leave time, and its leader show without hovering, under the current-time dot. */}
        {layout.days.flatMap((day) => day.nextTrip ? [<line key={`next-trip-${day.localDate}`} data-next-trip-span={day.nextTrip.key} x1={measured[day.localDate]!.axisX + 0.5} x2={measured[day.localDate]!.axisX + 0.5} y1={day.nextTrip.startPosition} y2={day.nextTrip.endPosition} stroke="var(--calendar-overlap)" strokeWidth={1} />] : [])}
        {nextTripLabel ? layout.days.flatMap((day) => day.nextTrip?.leavePosition != null && day.nextTrip.labelPosition != null
          ? [<path key={`next-trip-leader-${day.localDate}`} data-next-trip-leader={day.nextTrip.key} fill="none" stroke="var(--calendar-overlap)" strokeWidth={1}
            d={leaderPath(measured[day.localDate]!.axisX, day.nextTrip.leavePosition, day.nextTrip.labelPosition, nextTripLabel.length * LEADER_LABEL_LINE, day.movingDot?.displayPosition ?? null)} />] : []) : null}
        {layout.days.flatMap((day) => day.movingDot ? [<circle key={day.localDate} className={styles.currentTime} data-current-time-marker cx={measured[day.localDate]!.axisX} cy={day.movingDot.displayPosition} r={5} fill="var(--primary)" stroke="var(--background)" strokeWidth={2} />] : [])}
      </svg>
      {controls.map((control) => {
        const event = events.find((item) => item.id === control.eventIds[0]);
        if (!event) return null;
        const sources = new Set(control.eventIds.map((id) => events.find((item) => item.id === id)?.source ?? event.source));
        const groupName = sources.size === 1 ? externalEventSourceName(event.source) : "Calendar";
        return <button key={control.id} type="button" data-calendar-node={control.id} data-event-source={sources.size === 1 ? event.source : "mixed"} className="pointer-events-auto absolute z-20 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center" style={{ left: control.iconX, top: control.position }} aria-label={control.count > 1 ? `Preview ${control.count} ${groupName} events starting at the same time` : `Preview ${externalEventSourceName(event.source)} event: ${event.title || "Untitled event"}`} aria-describedby={control.eventIds.some((id) => activeIds.includes(id)) ? previewId : undefined} onPointerEnter={(pointer) => { if (pointer.pointerType !== "touch") onPreview([...control.eventIds], pointer.currentTarget); }} onFocus={(focus) => onPreview([...control.eventIds], focus.currentTarget)} onClick={(click) => onPreview([...control.eventIds], click.currentTarget)}><span className={styles.eventMarker} data-group-variant={control.count > 1 ? "badge" : undefined} aria-hidden="true">{/* Provider artwork stays bundled for offline desktop use. */}
          {sources.size === 1 && event.source === "google_calendar"
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src="/brand/google-calendar.svg" alt="" width={18} height={18} />
            : <CalendarDays size={16} aria-hidden="true" />}
          {control.count > 1 ? <span className={styles.countBadge}>×{control.count}</span> : null}</span></button>;
      })}
      {/* Ticket 270 (D13, D14): the leader's label. Decorative: the next-departure line already says it. */}
      {nextTripLabel ? layout.days.flatMap((day) => day.nextTrip?.leavePosition != null && day.nextTrip.labelPosition != null ? [<span key={`next-trip-label-${day.localDate}`} ref={labelRef} aria-hidden="true" data-next-trip-label={day.nextTrip.key}
        data-label-lines={nextTripLabel.length}
        className={styles.leaderLabel} style={{ right: `calc(100% - ${leaderEnd(measured[day.localDate]!.axisX, day.nextTrip.leavePosition, day.movingDot?.displayPosition ?? null) - LEADER_LABEL_GAP}px)`, top: day.nextTrip.labelPosition, width: nextTripLabel.length > 1 ? LEADER_LABEL_WIDTH : undefined, height: nextTripLabel.length * LEADER_LABEL_LINE }}>
        {nextTripLabel.map((words, index) => <span key={index} className="block">{index ? ` ${words}` : words}</span>)}</span>] : []) : null}
    </div>
  );
}

/** The leader's start: the axis, or clear of the current-time dot when the dot sits on the leave point. */
function leaderStart(axisX: number, leave: number, dot: number | null): number {
  return dot !== null && Math.abs(dot - leave) < CURRENT_TIME_CLEARANCE ? axisX - CURRENT_TIME_CLEARANCE : axisX;
}

/** D14: the leader keeps its full length past the dot, so it never reads as a hyphen. */
function leaderEnd(axisX: number, leave: number, dot: number | null): number {
  return leaderStart(axisX, leave, dot) - LEADER_LENGTH;
}

/**
 * Ticket 270 (D13, D14): the leader, perpendicular to the axis at the leave time. It starts clear
 * of the current-time dot when the dot sits on it and keeps its full length. When a Calendar
 * marker pushed the label off the leader's line, a short vertical segment at the leader's end
 * reaches the label's nearest edge.
 */
function leaderPath(axisX: number, leave: number, label: number, labelHeight: number, dot: number | null): string {
  const start = leaderStart(axisX, leave, dot);
  const end = leaderEnd(axisX, leave, dot);
  const reach = labelHeight / 2 - 4;
  const elbow = Math.abs(label - leave) <= reach ? "" : ` V ${label + (label < leave ? reach : -reach)}`;
  return `M ${start} ${leave} H ${end}${elbow}`;
}

function resolveContexts(
  section: TimelineDaySection,
  events: readonly NormalizedExternalEvent[],
  freshness: ExternalEventFreshness,
  now: string,
  estimates: Readonly<Record<string, BehaviorDurationEstimate>> | undefined,
  travel?: Omit<TravelEvidenceResult, "modelProjection"> | null,
  travelLabels?: ReadonlyMap<string, string>,
  timezone?: string,
  departure?: DepartureModel,
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
    travelLabels,
    timezone,
    departure,
    // A timing mutation can arrive between minute ticks. Its timestamp is the
    // earliest instant at which the returned running state can be assessed.
    now: occurrence.timeTracking.runningStartedAt && Temporal.Instant.compare(Temporal.Instant.from(occurrence.timeTracking.runningStartedAt), instant) > 0
      ? Temporal.Instant.from(occurrence.timeTracking.runningStartedAt) : instant,
  })]));
}

function sameDay(left: MeasuredDay | undefined, right: MeasuredDay): boolean {
  return !!left && left.top === right.top && left.bottom === right.bottom && left.axisX === right.axisX && left.iconX === right.iconX && left.stackLabel === right.stackLabel && left.rows.length === right.rows.length && left.rows.every((row, index) => row.occurrenceId === right.rows[index]?.occurrenceId && row.center === right.rows[index]?.center && row.scheduledFor === right.rows[index]?.scheduledFor);
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

function outlookFreshness(outlook: OutlookTimelineState): ExternalEventFreshness {
  const snapshot = outlook.snapshot;
  if (!snapshot) return UNAVAILABLE;
  if (outlook.state === "incomplete" || outlook.state === "error" || outlook.state === "stale") {
    return { ...snapshot.freshness, state: outlook.state === "incomplete" ? "incomplete" : "stale", canAssertNoOverlap: false };
  }
  return snapshot.freshness;
}

function outlookStateLabel(outlook: OutlookTimelineState, timezone: string, name: string): string {
  const refreshed = outlook.snapshot ? lastRefreshed(outlook.snapshot.fetchedAt, timezone) : "";
  if (outlook.state === "empty") return `No ${name} events in the displayed days.`;
  if (outlook.state === "stale") return `${name} context may be out of date.${refreshed}`;
  if (outlook.state === "incomplete") return `${name} context is incomplete; some events may be missing.${refreshed}`;
  if (outlook.state === "error") return `${name} context could not refresh: ${outlook.error ?? "unavailable"}.${outlook.snapshot ? ` Showing the last complete read.${refreshed}` : ""}`;
  if (outlook.state === "reconnect_required") return `${name} needs reconnection in Settings.`;
  return "";
}

function lastRefreshed(instant: string, timezone: string): string {
  try {
    return ` Last refreshed ${Temporal.Instant.from(instant).toZonedDateTimeISO(timezone).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`;
  } catch { return ""; }
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

/**
 * A located Behavior's travel timing, its Maps link (Ticket 271) and, for a journey to a place, its
 * mode choice (Ticket 217). The link carries only the Behavior's own place text.
 */
function travelDetails({ occurrenceId, placeText, travel, departure, now, timezone, habits, usualMode, navigationPreference, onOpenExternal, refresh, steps }: Readonly<{
  occurrenceId: string; placeText: string | undefined; travel: Omit<TravelEvidenceResult, "modelProjection"> | null | undefined; departure: DepartureModel; now: string;
  timezone: string; habits: TravelHabitsState | null | undefined; usualMode: TravelMode | null | undefined;
  navigationPreference: TravelNavigationPreference | null | undefined;
  onOpenExternal?: (url: string) => void | Promise<void>; refresh: TravelRefreshAction | null; steps: TravelStepActions;
}>) {
  const timing = renderTravelTiming({ eventId: occurrenceId, travel, departure, now, timezone, onOpenExternal, refresh, steps });
  if (!timing) return null;
  return <>{timing}
    <TravelNavigationLink locationText={placeText} preference={navigationPreference} usualMode={usualMode}
      travel={travel} stopRef={occurrenceId} source="behavior" onOpenExternal={onOpenExternal} />
    <TravelModeChoice eventId={occurrenceId} travel={travel} habits={habits} usualMode={usualMode} /></>;
}

/**
 * Ticket 269: the next-departure line. It answers "when do I leave next?" with the departure
 * model's line phrase for the next trip, and replaces "Travel as of". Below it, at most one short
 * status note: unavailable, development-only provider review, or the weather state. A day with
 * no trips shows nothing. Web and Mac share this component.
 */
export type TravelStatusLines = Readonly<{
  /** The next trip's line phrase, with the paused phrase beside a known time. Null: no line. */
  line: string | null;
  /** "lead": the phrase starts with Refresh travel and those words are the button (R1). "end": a button after the line. */
  lineRefresh: "lead" | "end" | null;
  /** One status message or the weather state. Null: none. */
  note: string | null;
  noteRefresh: boolean;
  /**
   * Changes only when the next trip's state, key, freshness or action, the pause or the note
   * changes. Never on a countdown minute.
   */
  signature: string;
}>;

const NO_STATUS_LINES: TravelStatusLines = { line: null, lineRefresh: null, note: null, noteRefresh: false, signature: "none" };

export function travelStatusLines({ departure, status, message = null, hasEvidence, developmentBuild, tomorrow = null }: Readonly<{
  departure: DepartureModel; status: TravelState | null; message?: string | null; hasEvidence: boolean; developmentBuild: boolean;
  /** Ticket 282: tomorrow's first trip, shown only while today has nothing to say. */
  tomorrow?: string | null;
}>): TravelStatusLines {
  if (tomorrow && departure.state === "none") {
    const raw = status ? status.message : message;
    const note = !developmentBuild && raw === TRAVEL_CLEARANCE_MESSAGE ? TRAVEL_UNAVAILABLE_MESSAGE : raw;
    const noteRefresh = !!note && !!status && !status.resumesAt && raw !== TRAVEL_CLEARANCE_MESSAGE;
    return { line: tomorrow, lineRefresh: null, note, noteRefresh, signature: ["tomorrow", tomorrow, note ?? ""].join("|") };
  }
  // Evidence with no trips: nothing to time, so nothing to say (G9).
  if (!departure.phrase && hasEvidence) return NO_STATUS_LINES;
  const next = departure.next;
  // D11: the paused line appears beside a known time only when the budget is used up.
  const line = departure.phrase && next && next.state !== "paused" && departure.pausedPhrase
    ? `${departure.phrase} ${departure.pausedPhrase}` : departure.phrase;
  const canRefresh = !!status && !status.resumesAt;
  const lineRefresh = !line || !canRefresh ? null
    : line.startsWith(DEPARTURE_REFRESH_LABEL) ? "lead" : next?.action === "refresh" ? "end" : null;
  // The provider-review text is for development builds. Swap it before the note is composed.
  const raw = status ? status.message : message;
  const shown = !developmentBuild && raw === TRAVEL_CLEARANCE_MESSAGE ? TRAVEL_UNAVAILABLE_MESSAGE : raw;
  // Ticket 218: say plainly when no weather margin could be added. A message comes first.
  const note = shown ?? (line ? travelWeatherStateText(status?.view?.evidence?.weather?.state) : null);
  const noteRefresh = !!shown && canRefresh && raw !== TRAVEL_CLEARANCE_MESSAGE && lineRefresh === null;
  // Freshness and action change once per expiry or refresh, so a refreshed "Last estimate" line is spoken.
  const signature = [next?.state ?? departure.state, next?.key ?? "", next?.freshness ?? "", next?.action ?? "",
    departure.resumesAt ?? "", note ?? ""].join("|");
  return { line, lineRefresh, note, noteRefresh, signature };
}

const TIMED_DEPARTURE_STATES: ReadonlySet<string> = new Set(["upcoming", "soon", "leave_now", "late", "head_home"]);

export function TravelStatusLine({ departure, status, message = null, hasEvidence, steps = null, tomorrow = null }: Readonly<{
  departure: DepartureModel; status: TravelState | null; message?: string | null; hasEvidence: boolean;
  /** Ticket 273: the one action for a missing estimate. */
  steps?: TravelStepActions | null;
  /** Ticket 282: tomorrow's first trip, for when today has no trip left. */
  tomorrow?: string | null;
}>) {
  const developmentBuild = useDevelopmentBuild();
  const lines = travelStatusLines({ departure, status, message, hasEvidence, developmentBuild, tomorrow });
  const announcement = [lines.line, lines.note].filter(Boolean).join(" ");
  // The polite region speaks only when the signature changes, so a countdown minute is silent.
  const [announced, setAnnounced] = useState({ signature: lines.signature, text: "" });
  if (announced.signature !== lines.signature) setAnnounced({ signature: lines.signature, text: announcement });
  // A refresh that removes its own button would drop keyboard focus to the page. Keep it on the line.
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const refreshedFromButton = useRef(false);
  const hasButton = !!status && (lines.lineRefresh !== null || lines.noteRefresh);
  const pending = status?.pending ?? false;
  useEffect(() => {
    if (!refreshedFromButton.current) return;
    if (hasButton) { if (!pending) refreshedFromButton.current = false; return; }
    refreshedFromButton.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || !containerRef.current?.contains(active)) lineRef.current?.focus();
  }, [hasButton, pending]);
  const refreshButton = (label: string) => status
    ? <button type="button" className="text-link" disabled={status.pending} onClick={() => { refreshedFromButton.current = true; status.refresh(); }}>{label}</button> : label;
  const nextState = lines.signature.startsWith("tomorrow|") ? "tomorrow" : departure.next?.state ?? departure.state;
  return (
    <div ref={containerRef} className={styles.travelStatus} data-travel-status data-travel-focus tabIndex={-1}>
      {lines.line ? <p ref={lineRef} tabIndex={-1} className={styles.departureLine} data-departure-line={nextState}
        data-departure-timed={TIMED_DEPARTURE_STATES.has(nextState) ? "true" : undefined}>
        {lines.lineRefresh === "lead"
          ? <>{refreshButton(DEPARTURE_REFRESH_LABEL)}{lines.line.slice(DEPARTURE_REFRESH_LABEL.length)}</>
          : steps && departure.next && isTravelStep(departure.next)
            ? <TravelStepText key={`${departure.next.key}|${departure.next.state}`} trip={departure.next} text={lines.line} actions={steps} />
            : lines.line}
        {lines.lineRefresh === "end" ? <>{" "}{refreshButton(DEPARTURE_REFRESH_LABEL)}</> : null}
      </p> : null}
      {lines.note ? <p className={styles.calendarState} data-travel-note>
        {lines.note}
        {lines.noteRefresh ? <>{" "}{refreshButton(DEPARTURE_REFRESH_LABEL)}</> : null}
      </p> : null}
      <span className="sr-only" role="status" aria-live="polite" data-departure-announcement>{announced.text}</span>
    </div>
  );
}
