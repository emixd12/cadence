"use client";

import { Temporal } from "@js-temporal/polyfill";
import { useMemo } from "react";

import { AdvisorTimelineFrame } from "@/components/advisor/AdvisorTimelineFrame";
import { DailyBriefLauncher } from "@/components/briefing/DailyBriefLauncher";
import { AppShell } from "@/components/layout/AppShell";
import { CadencePageBanner } from "@/components/layout/ScreenFrame";
import { WebRuntimeProvider } from "@/components/layout/WebRuntimeProvider";
import { OccurrenceMovesProvider, type OccurrenceMoveActions } from "@/components/timeline/OccurrenceMoves";
import { Timeline } from "@/components/timeline/Timeline";
import { resolveTimeline } from "@cadence/core/resolvers/timeline.resolver";
import type { DailyBriefClient } from "@/lib/ui/daily-brief";
import type { OccurrenceFormAction, TimeTrackingFormAction, TimelineOccurrenceInput } from "@/lib/types/timeline";
import { BRIEF_MOVE_FIXTURE_BRIEFING, fixtureBriefMoveClient } from "./brief-move-fixtures";
import {
  ADVISOR_FIXTURE_CHECK_IN,
  ADVISOR_FIXTURE_PROPOSAL,
  ADVISOR_FIXTURE_LINK_TIP,
  ADVISOR_FIXTURE_QUESTION_TIP,
  ADVISOR_FIXTURE_TIP,
  ADVISOR_FIXTURE_TIP_QUESTION,
  ADVISOR_FIXTURE_TRIAL,
  fixtureAdvisorClient,
  type AdvisorFixtureOptions,
} from "./advisor-fixtures";

/**
 * Advisor plan Phase 4 (4E): the built advisor (placement K) on the real Timeline, with
 * synthetic data. /design-system?preview=advisor&state=tip|brief|proposal|tipquestion|tiplink|checkin|trial|refused|none
 * The horse opens the panel; nothing is saved.
 */
export type AdvisorBenchState = "tip" | "brief" | "proposal" | "tipquestion" | "tiplink" | "checkin" | "trial" | "refused" | "none";

const TIMEZONE = "America/New_York";

function occurrence(id: string, title: string, at: string, localDate: string, label: string,
  status: TimelineOccurrenceInput["status"] = "unresolved"): TimelineOccurrenceInput {
  return {
    id, behaviorId: `behavior-${id}`, title, scheduledFor: at, scheduledTimeLabel: label, localDate, status,
    statusMarkedAt: { unresolved: null, completed: at, not_completed: at }[status],
    description: "", categoryName: "Bench", scheduleSummary: `Every day at ${label}`, note: "",
    timeTracking: { recordedSeconds: 0, runningStartedAt: null }, canStartTimeTracking: false,
  };
}

const TIMELINE = resolveTimeline({
  timezone: TIMEZONE,
  now: Temporal.Instant.from("2026-11-19T20:20:00Z"),
  futureDays: 0,
  occurrences: [
    occurrence("journal", "Morning journal", "2026-11-19T13:00:00Z", "2026-11-19", "8:00 AM", "completed"),
    occurrence("walk", "Walk outside", "2026-11-19T17:30:00Z", "2026-11-19", "12:30 PM", "completed"),
    occurrence("piano", "Piano practice", "2026-11-19T22:30:00Z", "2026-11-19", "5:30 PM"),
    occurrence("gym", "Gym", "2026-11-19T23:30:00Z", "2026-11-19", "6:30 PM"),
    occurrence("read", "Read", "2026-11-20T02:30:00Z", "2026-11-19", "9:30 PM"),
  ],
});

const NO_MOVES: OccurrenceMoveActions = {
  async suggest() { return []; },
  async move(input) { return { status: "moved", occurrenceId: input.occurrenceId, moveId: "bench", effectiveStartAt: null, revision: "r2" }; },
  async revert(input) { return { status: "undone", occurrenceId: input.occurrenceId, moveId: "bench", effectiveStartAt: null, revision: "r3" }; },
  async reason(input) { return { status: "saved", reason: input.reason }; },
  async keep() { return { status: "kept" }; },
};

const OPTIONS: Readonly<Record<AdvisorBenchState, AdvisorFixtureOptions>> = {
  tip: { tip: ADVISOR_FIXTURE_TIP },
  brief: { tip: ADVISOR_FIXTURE_TIP, proposal: ADVISOR_FIXTURE_TRIAL },
  proposal: { tip: ADVISOR_FIXTURE_TIP, proposal: ADVISOR_FIXTURE_PROPOSAL },
  tipquestion: { tip: ADVISOR_FIXTURE_QUESTION_TIP, proposal: ADVISOR_FIXTURE_TIP_QUESTION },
  tiplink: { tip: ADVISOR_FIXTURE_LINK_TIP },
  checkin: { tip: ADVISOR_FIXTURE_TIP, proposal: ADVISOR_FIXTURE_CHECK_IN },
  trial: { tip: ADVISOR_FIXTURE_TIP, proposal: ADVISOR_FIXTURE_TRIAL },
  refused: { tip: ADVISOR_FIXTURE_TIP, proposal: ADVISOR_FIXTURE_PROPOSAL, refuseWith: "schedule_changed" },
  none: { tip: null, recent: [] },
};

function benchBriefClient(state: AdvisorBenchState): DailyBriefClient {
  // A fresh account ref per load, so the bench's brief is never "already shown" from an earlier visit.
  const accountRef = `advisor-bench-${crypto.randomUUID()}`;
  return {
    preferences: async () => ({ accountRef, available: true, enabled: state === "brief", revision: 1, localDate: "2026-11-19",
      timezone: TIMEZONE, includeCalendar: false }),
    updatePreferences: async () => { throw new Error("Bench only."); },
    requestBrief: async () => ({ state: "ready", briefing: BRIEF_MOVE_FIXTURE_BRIEFING }),
    moves: fixtureBriefMoveClient(),
    advisor: fixtureAdvisorClient(OPTIONS[state]),
  };
}

export function AdvisorBench({ state, statusAction, timeAction }: Readonly<{
  state: AdvisorBenchState; statusAction: OccurrenceFormAction; timeAction: TimeTrackingFormAction;
}>) {
  const client = useMemo(() => benchBriefClient(state), [state]);
  return (
    <WebRuntimeProvider>
      <AppShell user={{ name: "Emi" }}>
        <AdvisorTimelineFrame client={client.advisor} onOpenLink={() => undefined} banner={<><h1 className="sr-only">Timeline</h1><CadencePageBanner /></>}>
          <div className="mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-10">
            <OccurrenceMovesProvider actions={NO_MOVES} timezone={TIMEZONE} todayLocalDate="2026-11-19" hasMovedBefore>
              <DailyBriefLauncher client={client} sessionKey="bench" />
              <Timeline timeline={TIMELINE} statusAction={statusAction} noteAction={statusAction}
                startTimeTrackingAction={timeAction} stopTimeTrackingAction={timeAction} resetTimeTrackingAction={timeAction} />
            </OccurrenceMovesProvider>
          </div>
        </AdvisorTimelineFrame>
      </AppShell>
    </WebRuntimeProvider>
  );
}
