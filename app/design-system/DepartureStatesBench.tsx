"use client";

import { Temporal } from "@js-temporal/polyfill";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DevelopmentBuildProvider } from "@cadence/ui/runtime";
import { resolveDepartureModel } from "@cadence/core/resolvers/departure.resolver";
import { resolveTimeline } from "@cadence/core/resolvers/timeline.resolver";
import { resolveTravelAfterDecisions, resolveTravelEvidence, resolveTravelPlan } from "@cadence/core/resolvers/travel.resolver";
import { departureStops } from "@cadence/core/services/departure-stops";
import { departureTimeLabel, departurePhraseContext } from "@cadence/core/services/departure-phrases";
import { resolveTravelHabits } from "@cadence/core/services/travel-habits";
import { TRAVEL_ESTIMATE_LIFETIME_SECONDS, TRAVEL_LEG_OUTSIDE_WINDOW, partitionTravelLegsByWindow } from "@cadence/core/services/travel-refresh-policy";
import type { BehaviorDurationEstimate, NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { DepartureModel, DepartureState } from "@cadence/core/types/departure";
import type { TravelCommitment, TravelEndpoint, TravelEvidenceResult, TravelPlannedLeg, TravelRouteEstimate } from "@cadence/core/types/travel";
import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";
import { DayProgressTimeline } from "@/components/timeline/DayProgressTimeline";
import { ExternalEventDetails, ExternalEventPreview } from "@/components/timeline/ExternalEventDetails";
import { useBriefTravel } from "@/lib/ui/brief-travel";
import type { TravelState } from "@/lib/ui/travel";
import { DepartureWordingReview } from "./DepartureWordingReview";
import styles from "./departure-states-bench.module.css";

/**
 * Ticket 266: one day with a located Behavior (Gym, 10–11 AM) and a located Calendar event
 * (Dentist, 2–3 PM), with Home saved. A state preset sets the bench clock and the time routes
 * were last checked; the slider then moves the clock. Estimates expire 5 minutes after a check
 * and legs outside the 3-hour window wait, as the hosted route does. No provider call runs.
 */

const TIMEZONE = "America/New_York";
const DATE = "2026-11-10";
const DAY_START_MINUTES = 6 * 60;
const DAY_END_MINUTES = 18 * 60;
const GYM_ID = "bench-gym";
const DENTIST_ID = "google_calendar/bench/dentist";
/** Walking minutes to each destination. The provider is synthetic; the timing rules are real. */
const WALK_MINUTES: Readonly<Record<string, number>> = { [GYM_ID]: 20, [DENTIST_ID]: 35, home: 30 };
const BUFFERS = resolveTravelHabits(null).buffers;
const RESUMES_AT = "2026-12-01T05:00:00Z";

type DentistVariant = "located" | "no_place" | "attendance_unknown" | "remote";
type GymVariant = "located" | "no_place" | "not_located";

export type DepartureBenchState = Readonly<{
  id: string;
  label: string;
  /** What the owner should look for, in plain words. */
  description: string;
  clock: string;
  checked: string;
  dentist: DentistVariant;
  gym: GymVariant;
  /** Gym was marked Completed at this local time, after the routes were checked. */
  gymCompletedAt?: string;
  paused?: boolean;
  /** The model state this preset produces. Tests walk every preset. */
  expected: DepartureState;
}>;

export const DEPARTURE_BENCH_STATES: readonly DepartureBenchState[] = [
  { id: "fresh", label: "Fresh estimate", clock: "07:00", checked: "07:00", dentist: "located", gym: "located", expected: "upcoming",
    description: "Routes were checked just now. The trip to Gym has a leave time. The trips to Dentist and home can leave only after Gym, more than 3 hours away, so their estimates wait." },
  { id: "expired", label: "Expired: last estimate", clock: "07:10", checked: "07:00", dentist: "located", gym: "located", expected: "upcoming",
    description: "Ten minutes after the check. Estimates expire after 5 minutes, so the leave time is shown as the last estimate with its check time." },
  { id: "appears-later", label: "Appears later", clock: "10:15", checked: "10:15", dentist: "located", gym: "not_located", expected: "appears_later",
    description: "Gym has no place, so the trip to Dentist starts from Home. It is outside the 3-hour window, so it says when its leave time appears." },
  { id: "soon", label: "Soon", clock: "09:10", checked: "09:10", dentist: "located", gym: "located", expected: "soon",
    description: "Less than 30 minutes before leaving for Gym: a countdown." },
  { id: "leave-now", label: "Leave now", clock: "09:36", checked: "09:35", dentist: "located", gym: "located", expected: "leave_now",
    description: "The leave time has come, and less than 5 minutes have passed." },
  { id: "late-evidence", label: "Late: the route says so", clock: "09:45", checked: "09:45", dentist: "located", gym: "located", expected: "late",
    description: "Routes checked after the leave time. The route arrives after the planned arrival, so Cadence gives the late arrival." },
  { id: "late-clock", label: "Late: clock only", clock: "09:45", checked: "09:00", dentist: "located", gym: "located", expected: "late",
    description: "The route was on time, but the clock is 10 minutes past the leave time. Cadence cannot tell whether you left, so it says when you would arrive. The estimate is also old." },
  { id: "head-home", label: "During the event: head home", clock: "14:15", checked: "14:15", dentist: "located", gym: "located", expected: "head_home",
    description: "Dentist is under way. The next trip is the trip home." },
  { id: "trip-changed", label: "Trip changed after resolving a stop", clock: "10:58", checked: "10:56", gymCompletedAt: "10:57", dentist: "located", gym: "located", expected: "trip_changed",
    description: "Gym was marked Completed after the check, so the trip from Gym to Dentist no longer holds. Refresh travel routes it again from Home." },
  { id: "needs-place", label: "Needs a place", clock: "10:15", checked: "10:15", dentist: "no_place", gym: "located", expected: "needs_place",
    description: "Dentist has no location, so no route can be found." },
  { id: "needs-attendance", label: "Needs attendance", clock: "10:15", checked: "10:15", dentist: "attendance_unknown", gym: "located", expected: "needs_attendance",
    description: "Dentist has a location and a video link, so Cadence cannot tell whether it is in person." },
  { id: "needs-origin", label: "Needs a start", clock: "10:05", checked: "09:50", dentist: "located", gym: "no_place", expected: "needs_origin",
    description: "Gym has no place this time, so the trip to Dentist has no known start. Checked before Gym began; Refresh travel would route it from Home." },
  { id: "no-trips", label: "No trips", clock: "07:00", checked: "07:00", dentist: "remote", gym: "not_located", expected: "none",
    description: "Dentist is remote and Gym has no place. No travel text appears." },
  { id: "paused", label: "Paused", clock: "10:15", checked: "07:00", paused: true, dentist: "located", gym: "located", expected: "paused",
    description: "The monthly travel budget is used up. The last plan stays, and trips waiting for an estimate say when estimates resume." },
];

const MODEL_STATE_WORDS: Readonly<Record<DepartureState, string>> = {
  upcoming: "Upcoming", soon: "Soon", leave_now: "Leave now", late: "Late", head_home: "Head home",
  appears_later: "Appears later", needs_place: "Needs a place", needs_attendance: "Needs attendance",
  needs_origin: "Needs a start", time_unknown: "Time unknown", no_route: "No route", trip_changed: "Trip changed",
  estimate_expired: "Estimate expired", paused: "Paused", none: "No trips",
};

function instantAt(localTime: string): string {
  return Temporal.PlainDate.from(DATE).toZonedDateTime({ timeZone: TIMEZONE, plainTime: Temporal.PlainTime.from(localTime) }).toInstant().toString();
}
function minutesOf(localTime: string): number {
  const [hour, minute] = localTime.split(":").map(Number);
  return hour! * 60 + minute!;
}
function localTimeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

const point = (placeId: string) => ({ kind: "place_id" as const, placeId });
const HOME: TravelEndpoint = { ref: "base", point: point("bench-home"), source: "saved_base", sourceRevision: "bench" };

function benchEvent(variant: DentistVariant): NormalizedExternalEvent {
  return {
    kind: "timed", id: DENTIST_ID, providerEventId: "dentist", logicalInstanceId: DENTIST_ID, calendarId: "bench", source: "google_calendar",
    calendarName: "Personal", sourceTimezone: TIMEZONE, sourceTimezoneFallback: "none", state: "confirmed", availability: "busy",
    currentUserResponse: "accepted", revision: { availability: "available", providerUpdatedAt: "2026-11-09T12:00:00Z", providerEtag: `bench-${variant}` },
    title: "Dentist", description: "", location: variant === "no_place" ? "" : "Synthetic dental office", sourceUrl: "https://calendar.google.com/",
    fieldAvailability: {}, detailCompleteness: {}, organizer: null, attendees: null, attendeesOmitted: false,
    conference: variant === "attendance_unknown" || variant === "remote"
      ? { name: "Synthetic Meet", notes: null, entryPoints: [{ type: "video", uri: "https://meet.example.com/bench", label: "Join video" }] } : null,
    recurrence: null, attachments: null,
    startAt: instantAt("14:00"), endAt: instantAt("15:00"), endUnspecified: false, duration: { kind: "known", seconds: 3600 },
  };
}

const DURATIONS: Readonly<Record<string, BehaviorDurationEstimate>> = {};

function benchTimeline(gymStatus: "unresolved" | "completed", gym: GymVariant) {
  return resolveTimeline({ timezone: TIMEZONE, now: Temporal.Instant.from(instantAt("06:00")), futureDays: 0,
    occurrences: [{ id: GYM_ID, behaviorId: "bench-gym-behavior", title: "Gym", description: "Synthetic located Behavior.", categoryName: "Health",
      scheduleSummary: "Weekdays", scheduledFor: instantAt("10:00"), scheduledTimeLabel: "10:00 AM", scheduleKind: "range", scheduleEndTime: "11:00",
      ...(gym === "located" ? { placeText: "Synthetic gym" } : {}),
      localDate: DATE, status: gymStatus, statusMarkedAt: gymStatus === "completed" ? instantAt("10:57") : null, note: "", canStartTimeTracking: false,
      timeTracking: { recordedSeconds: 0, runningStartedAt: null } }] });
}

/** The provider rule for walking as shipped: arrive-by legs count back from the target, depart-at legs forward. */
function walkingEstimate(leg: TravelPlannedLeg, checkedAt: Temporal.Instant): TravelRouteEstimate {
  const seconds = (WALK_MINUTES[leg.destinationCommitmentRef ?? "home"] ?? 30) * 60;
  const at = Temporal.Instant.from(leg.request.timing.at);
  const departure = leg.request.timing.kind === "arrive_by" ? at.subtract({ seconds }) : at;
  return { durationSeconds: seconds, departureAt: departure.toString(), arrivalAt: departure.add({ seconds }).toString(), warnings: [],
    fallback: false, attribution: "Google Maps", observedAt: checkedAt.toString(), expiresAt: checkedAt.add({ seconds: TRAVEL_ESTIMATE_LIFETIME_SECONDS }).toString() };
}

type Scenario = Readonly<{ dentist: DentistVariant; gym: GymVariant; gymCompletedAt: string | null }>;

/**
 * What the hosted route returns for a `timeline` check at `checked`: plan, window and 5-minute
 * expiry. Ticket 267: an onward trip falls due 3 hours before it can leave.
 */
function benchEvidence(scenario: Scenario, checked: string): Omit<TravelEvidenceResult, "modelProjection"> {
  const checkedAt = Temporal.Instant.from(instantAt(checked));
  const gymResolvedBeforeCheck = scenario.gymCompletedAt !== null && minutesOf(scenario.gymCompletedAt) <= minutesOf(checked);
  const commitments: TravelCommitment[] = [];
  // The hosted route plans only Unresolved Behaviors with a place.
  if (scenario.gym !== "not_located" && !gymResolvedBeforeCheck) commitments.push({ ref: GYM_ID, revision: "bench", kind: "behavior", attendance: "physical",
    startAt: instantAt("10:00"), endAt: instantAt("11:00"), mode: null,
    endpoint: scenario.gym === "located" ? { ref: GYM_ID, point: point("bench-gym"), source: "behavior", sourceRevision: "bench" } : null });
  commitments.push({ ref: DENTIST_ID, revision: "bench", kind: "calendar",
    attendance: scenario.dentist === "remote" ? "remote" : scenario.dentist === "attendance_unknown" ? "unknown" : "physical",
    startAt: instantAt("14:00"), endAt: instantAt("15:00"), mode: null,
    endpoint: scenario.dentist === "no_place" ? null : { ref: DENTIST_ID, point: point("bench-dentist"), source: "calendar", sourceRevision: "bench" } });
  const plan = resolveTravelPlan({ journeyRef: DATE, journeyRevision: "bench", grantRevision: "bench", now: checkedAt.toString(), defaultMode: "walking",
    base: HOME, device: null, predictedOrigin: null, corrections: [], buffers: BUFFERS, commitments });
  const { due, later } = partitionTravelLegsByWindow(plan.legs, checkedAt);
  const results = [
    ...due.map((leg) => ({ legId: leg.id, provenance: leg.provenance, estimate: walkingEstimate(leg, checkedAt) })),
    ...later.map((leg) => ({ legId: leg.id, provenance: leg.provenance, estimate: null, unavailableReason: TRAVEL_LEG_OUTSIDE_WINDOW })),
  ];
  const { modelProjection: _projection, ...evidence } = resolveTravelEvidence({ plan, results, buffers: BUFFERS, now: checkedAt.toString(),
    expectedJourneyRevision: "bench", expectedGrantRevision: "bench", modelProjection: "disabled", collisionCandidates: [], weather: null });
  void _projection;
  return evidence;
}

/** Puts the drawer popover and the details dialog in the page flow. Bench only: the product keeps them in the top layer. */
function InlineSurface({ children, label }: Readonly<{ children: ReactNode; label: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>("[popover]").forEach((element) => {
      try { if (element.matches(":popover-open")) element.hidePopover(); } catch { /* No popover support: already in flow. */ }
    });
  });
  useEffect(() => {
    ref.current?.querySelectorAll("dialog").forEach((dialog) => {
      let modal = false;
      try { modal = dialog.matches(":modal"); } catch { /* No :modal support. */ }
      // A closed dialog stays rendered; the bench stylesheet shows it in the page flow.
      if (modal) dialog.close();
      // Closing a modal leaves focus on its close button; the bench is read, not operated.
      if (modal && document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)) document.activeElement.blur();
    });
  });
  return <section aria-label={label} className="grid min-w-0 content-start gap-2">
    <h3 className="text-sm font-bold">{label}</h3>
    <div ref={ref} className={styles.inline}>{children}</div>
  </section>;
}

const idleAction = async () => ({ status: "idle" as const, message: "Bench only. Nothing is saved." });

export function DepartureStatesBench({ initialStateId }: Readonly<{ initialStateId?: string }>) {
  const initial = DEPARTURE_BENCH_STATES.find((state) => state.id === initialStateId) ?? DEPARTURE_BENCH_STATES[0]!;
  const [stateId, setStateId] = useState(initial.id);
  const [clock, setClock] = useState(initial.clock);
  const [checked, setChecked] = useState(initial.checked);
  const [development, setDevelopment] = useState(false);
  const preset = DEPARTURE_BENCH_STATES.find((state) => state.id === stateId) ?? initial;
  const choose = (id: string) => {
    const next = DEPARTURE_BENCH_STATES.find((state) => state.id === id) ?? initial;
    setStateId(next.id);
    setClock(next.clock);
    setChecked(next.checked);
  };
  // Moving the clock before the last check re-checks routes at the new time.
  const moveClock = (minutes: number) => {
    const next = localTimeOf(minutes);
    setClock(next);
    if (minutes < minutesOf(checked)) setChecked(next);
  };

  const scenario: Scenario = useMemo(() => ({ dentist: preset.dentist, gym: preset.gym, gymCompletedAt: preset.gymCompletedAt ?? null }),
    [preset.dentist, preset.gym, preset.gymCompletedAt]);
  const gymStatus = scenario.gymCompletedAt && minutesOf(clock) >= minutesOf(scenario.gymCompletedAt) ? "completed" as const : "unresolved" as const;
  const timeline = useMemo(() => benchTimeline(gymStatus, scenario.gym), [gymStatus, scenario.gym]);
  const event = useMemo(() => benchEvent(scenario.dentist), [scenario.dentist]);
  const events = useMemo(() => [event], [event]);
  const evidence = useMemo(() => benchEvidence(scenario, checked), [scenario, checked]);
  const now = instantAt(clock);
  const checkedAt = instantAt(checked);
  const expiresAt = evidence.legs.reduce<string | null>((earliest, leg) => !leg.estimate ? earliest
    : !earliest || Temporal.Instant.compare(Temporal.Instant.from(leg.estimate.expiresAt), Temporal.Instant.from(earliest)) < 0 ? leg.estimate.expiresAt : earliest, null)
    ?? Temporal.Instant.from(checkedAt).add({ seconds: TRAVEL_ESTIMATE_LIFETIME_SECONDS }).toString();
  const stale = Temporal.Instant.compare(Temporal.Instant.from(now), Temporal.Instant.from(expiresAt)) >= 0;
  const resumesAt = preset.paused ? RESUMES_AT : null;
  const status: TravelState = { view: { accountId: "bench", mode: "walking", navigationPreference: null, settingsRevision: "bench", expiresAt, evidence },
    message: null, stale: stale || !!resumesAt, pending: false, observedAt: checkedAt, resumesAt,
    // Refresh travel re-checks routes at the bench clock. No provider call.
    refresh: () => { if (!resumesAt) setChecked(clock); } };

  // The same model the Timeline builds (DayProgressTimeline), for the drawer and dialog shown beside it.
  const occurrences = timeline.daySections.flatMap((section) => section.occurrences);
  const travel = resolveTravelAfterDecisions(evidence, occurrences, DURATIONS);
  const departure: DepartureModel = resolveDepartureModel({ evidence: travel ?? null, now, timezone: TIMEZONE,
    stops: departureStops({ events, occurrences: timeline.daySections.find((section) => section.localDate === timeline.todayLocalDate)?.occurrences ?? [],
      durationEstimates: DURATIONS, timezone: TIMEZONE }),
    arrivalBufferSeconds: BUFFERS.arrivalSeconds, preparationSeconds: BUFFERS.preparationSeconds, pausedUntil: resumesAt });
  const refresh = resumesAt ? null : { onRefresh: status.refresh, pending: false };
  const context = departurePhraseContext(now, TIMEZONE);
  const briefTravel = useBriefTravel();
  const briefing = { text: "Gym this morning, Dentist at 2 PM.", localDate: DATE, timezone: TIMEZONE, generatedAt: instantAt("06:00"),
    expiresAt: Temporal.PlainDate.from(DATE).add({ days: 1 }).toZonedDateTime({ timeZone: TIMEZONE }).toInstant().toString(),
    coverage: "complete" as const, warnings: [] };
  const gymRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    gymRow.current?.querySelectorAll<HTMLDetailsElement>(`[data-occurrence-id="${GYM_ID}"] details`).forEach((details) => { details.open = true; });
  });

  const lateBasis = departure.next?.state === "late" ? departure.next.lateBasis === "evidence" ? " (from the route)" : " (clock only)" : "";
  const freshness = departure.next?.freshness === "last_estimate" ? ", last estimate" : "";

  return <div className="grid gap-8" data-departure-states-bench>
    <section aria-labelledby="departure-states-title" className="grid gap-4">
      <div className="grid gap-2">
        <h2 id="departure-states-title" className="text-xl font-bold">Travel timing states</h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-readable">
          One day on {Temporal.PlainDate.from(DATE).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" })}, with Home saved,
          Gym (a Behavior with a place) from 10 to 11 AM and Dentist (a Calendar event with a location) from 2 to 3 PM. Every travel line below
          comes from the real shared components. Routes are synthetic walking times; no provider is called.
        </p>
        <p className="max-w-3xl text-sm leading-6 text-muted-readable" data-frozen-time-note>
          Time stands still here on purpose: the clock moves only when you move it. Estimates expire 5 minutes after they are checked, and a trip more
          than 3 hours away waits for its estimate, as in the product. Moving the clock before the last check re-checks routes at the new time.
        </p>
      </div>
      <div className="grid gap-4 border border-line bg-surface p-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-bold">State
          <select className="min-h-11 border border-line bg-background font-normal" value={stateId} onChange={(change) => choose(change.target.value)}>
            {DEPARTURE_BENCH_STATES.map((state) => <option key={state.id} value={state.id}>{state.label}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-bold">Build
          <select className="min-h-11 border border-line bg-background font-normal" value={development ? "development" : "production"} onChange={(change) => setDevelopment(change.target.value === "development")}>
            <option value="production">Production</option>
            <option value="development">Development (shows text production never shows)</option>
          </select>
        </label>
        <div className="grid gap-2 sm:col-span-2">
          <label htmlFor="departure-bench-clock" className="text-sm font-bold">Bench clock</label>
          <div className="flex flex-wrap items-center gap-3">
            <input id="departure-bench-clock" type="range" className="min-h-11 min-w-0 flex-1" min={DAY_START_MINUTES} max={DAY_END_MINUTES} step={1}
              value={minutesOf(clock)} onChange={(change) => moveClock(Number(change.target.value))} />
            <output htmlFor="departure-bench-clock" className={`${styles.clock} text-2xl font-bold`} data-bench-clock>{departureTimeLabel(now, context)}</output>
          </div>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:col-span-2 sm:grid-cols-[max-content_minmax(0,1fr)]">
          <dt className="font-bold">Routes checked</dt>
          <dd data-bench-checked>{departureTimeLabel(checkedAt, context)}{stale ? `, expired at ${departureTimeLabel(expiresAt, context)}` : `, expires at ${departureTimeLabel(expiresAt, context)}`}</dd>
          <dt className="font-bold">Next trip</dt>
          <dd data-departure-model-state={departure.state}>{MODEL_STATE_WORDS[departure.state]}{lateBasis}{freshness}</dd>
          <dt className="font-bold">Next-departure line</dt>
          <dd data-bench-model-line>{departure.phrase ?? "None: no travel text."}
            <span className="block text-xs leading-5 text-muted-readable">From the departure model. The Timeline shows it at the top, with the paused phrase beside a known time (Ticket 269). Place, attendance and start steps get their actions in Ticket 273.</span></dd>
          <dt className="font-bold">This state</dt>
          <dd>{preset.description}</dd>
        </dl>
      </div>
    </section>

    <DevelopmentBuildProvider value={development}>
      <p className="text-sm font-bold" data-bench-build={development ? "development" : "production"}>{development ? "Development build" : "Production build"}</p>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Timeline" className="grid min-w-0 content-start gap-2">
          <h3 className="text-sm font-bold">Timeline: next-departure line, markers and the expanded Gym row</h3>
          <div ref={gymRow} className="min-w-0 border border-line bg-background">
            <DayProgressTimeline timeline={timeline}
              context={{ events, freshness: { state: "current", refreshedAt: checkedAt, label: "Calendar current", canAssertNoOverlap: true },
                now, durationEstimates: DURATIONS, travel: evidence, travelStatus: status, travelMode: "walking" }}
              statusAction={idleAction} noteAction={idleAction} startTimeTrackingAction={idleAction} stopTimeTrackingAction={idleAction} resetTimeTrackingAction={idleAction} />
          </div>
        </section>
        <div className="grid min-w-0 content-start gap-8">
          <InlineSurface label="Dentist drawer">
            <ExternalEventPreview key={`${stateId}-${scenario.dentist}`} id="departure-bench-drawer" events={events} timezone={TIMEZONE}
              onDismiss={() => undefined} onOpen={() => undefined} travel={travel} departure={departure} refresh={refresh} now={now} travelMode="walking" />
          </InlineSurface>
          <InlineSurface label="Dentist Calendar details">
            <ExternalEventDetails event={event} timezone={TIMEZONE} onClose={() => undefined} onDismissAllDay={() => undefined} onTravelCorrection={() => undefined}
              travel={travel} departure={departure} refresh={refresh} now={now} travelMode="walking" />
          </InlineSurface>
          <section aria-label="Daily Brief" className="grid min-w-0 content-start gap-2">
            <h3 className="text-sm font-bold">Daily Brief</h3>
            {briefTravel ? null : <p className="text-xs leading-5 text-muted-readable" data-bench-brief-note>No travel block: the brief shows travel only while an estimate is current.</p>}
            <div className="pt-8"><DailyBriefBubble state="ready" briefing={briefing} travel={briefTravel} onDismiss={() => undefined} /></div>
          </section>
        </div>
      </div>
    </DevelopmentBuildProvider>

    <DepartureWordingReview />
  </div>;
}
