"use client";

import { useMemo } from "react";
import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";
import { OccurrenceMovesProvider, type OccurrenceMoveActions } from "@/components/timeline/OccurrenceMoves";
import type { DailyBriefing } from "@cadence/core/types/daily-brief";
import { BRIEF_MOVE_FIXTURE, BRIEF_MOVE_FIXTURE_BRIEFING, BRIEF_MOVE_FIXTURE_LINES, fixtureBriefMoveClient } from "./brief-move-fixtures";

// Advisor plan Phase 3B. The brief's move lines with synthetic data and no account:
// every answer applies in memory, except that Gym's Yes is refused so the alert state
// shows. Yes opens the shared bottom drawer with Undo. The "rechecked" state opens with
// Gym's 5:30 taken since the brief was written, so it arrives re-planned. No model call.

const TODAY = BRIEF_MOVE_FIXTURE.localDate;
const TZ = BRIEF_MOVE_FIXTURE.timezone;

const ANSWERED: DailyBriefing = {
  ...BRIEF_MOVE_FIXTURE_BRIEFING,
  text: "Two items moved; your calendar could not be read just now.",
  moves: {
    ...BRIEF_MOVE_FIXTURE,
    calendar: "stale",
    acceptAll: false,
    undoAllBatchId: "batch-bench",
    conflicts: [],
    lines: [
      { ...BRIEF_MOVE_FIXTURE_LINES[0]!, status: "accepted", moveId: "move-walk" },
      { ...BRIEF_MOVE_FIXTURE_LINES[1]!, status: "declined" },
      { ...BRIEF_MOVE_FIXTURE_LINES[2]!, status: "already_done" },
    ],
  },
};

export function DailyBriefMovesBench() {
  const client = useMemo(() => fixtureBriefMoveClient({ refuse: ["gym"], delayMs: 150 }), []);
  const answeredClient = useMemo(() => fixtureBriefMoveClient(), []);
  const recheckedClient = useMemo(() => fixtureBriefMoveClient({ stale: ["gym"] }), []);
  const actions = useMemo<OccurrenceMoveActions>(() => ({
    async suggest() { return []; },
    async move(input) { return { status: "moved", occurrenceId: input.occurrenceId, moveId: "bench", effectiveStartAt: null, revision: "r2" }; },
    async revert(input) { return { status: "undone", occurrenceId: input.occurrenceId, moveId: "bench", effectiveStartAt: null, revision: "r3" }; },
    async reason(input) { return { status: "saved", reason: input.reason }; },
    async keep() { return { status: "kept" }; },
  }), []);
  const moves = { client, planningContext: () => ({ calendarBusy: [] }) };
  return (
    <OccurrenceMovesProvider actions={actions} timezone={TZ} todayLocalDate={TODAY} hasMovedBefore={false}>
      <div className="grid gap-12 bg-background px-3 pb-16 pt-10 sm:px-6">
        <div data-bench-state="morning">
          <DailyBriefBubble state="ready" briefing={BRIEF_MOVE_FIXTURE_BRIEFING} moves={moves} onDismiss={() => undefined}
            refresh={{ onRefresh: () => undefined, pending: false, available: true, error: null }} />
        </div>
        <div data-bench-state="rechecked">
          <DailyBriefBubble state="ready" briefing={BRIEF_MOVE_FIXTURE_BRIEFING} moves={{ client: recheckedClient, planningContext: () => ({ calendarBusy: [] }) }} onDismiss={() => undefined}
            refresh={{ onRefresh: () => undefined, pending: false, available: true, error: null }} />
        </div>
        <div data-bench-state="answered">
          <DailyBriefBubble state="ready" briefing={ANSWERED} moves={{ client: answeredClient, planningContext: () => ({ calendarBusy: [] }) }} onDismiss={() => undefined}
            refresh={{ onRefresh: () => undefined, pending: false, available: true, error: "You’ve used today’s refreshes. This brief stays, and every line still works." }} />
        </div>
      </div>
    </OccurrenceMovesProvider>
  );
}
