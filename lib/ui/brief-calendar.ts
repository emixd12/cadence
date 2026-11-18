"use client";

import { useSyncExternalStore } from "react";
import type { BriefCalendarBusy } from "@cadence/core/types/brief-moves";

/**
 * Advisor Phase 3: page-session channel from the Day progress Timeline, which already
 * holds today's calendar events, to the Daily Brief's move answers. The brief sends
 * these busy times with Yes, Other time, Accept all and Re-plan so the server's
 * free-slot check sees what the screen sees. Nothing is stored; titles are not sent.
 */
let current: readonly BriefCalendarBusy[] = [];
const listeners = new Set<() => void>();

export function publishBriefCalendarBusy(value: readonly BriefCalendarBusy[]) {
  if (JSON.stringify(value) === JSON.stringify(current)) return;
  current = value;
  for (const listener of listeners) listener();
}

/** The latest busy times, read at tap time (no re-render needed). */
export function briefCalendarBusy(): readonly BriefCalendarBusy[] {
  return current;
}

export function useBriefCalendarBusy(): readonly BriefCalendarBusy[] {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function snapshot() { return current; }
const EMPTY: readonly BriefCalendarBusy[] = [];
function serverSnapshot() { return EMPTY; }
