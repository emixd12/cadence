"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TravelSettings } from "@cadence/core/types/travel";
import type { TravelHabitChange, TravelLeaveCandidate } from "@cadence/core/services/travel-habits";
import { notifyTravelSettingsChanged, type TravelSettingsClient } from "./travel-settings";

export type TravelHabitsState = Readonly<{
  settings: TravelSettings | null;
  /** Saves one change; rejects when it fails so the caller can say so. */
  save: ((change: TravelHabitChange) => Promise<TravelSettings>) | null;
}>;

/**
 * Ticket 217: the account's learned habits for Timeline controls. Reloads when
 * travel settings change in this or another tab. Saving a change that moves a
 * routing input announces it, so estimates refresh once.
 */
export function useTravelHabits(client: TravelSettingsClient | null, enabled: boolean): TravelHabitsState {
  const [settings, setSettings] = useState<TravelSettings | null>(null);
  const sequence = useRef(0);
  const current = useRef<TravelSettings | null>(null);
  useEffect(() => {
    if (!enabled || !client) return;
    let active = true;
    // A newer load or a save supersedes an older load's result.
    const load = () => {
      const run = ++sequence.current;
      void client.load().then((value) => {
        if (active && run === sequence.current) { current.current = value; setSettings(value); }
      }).catch(() => undefined);
    };
    load();
    const channel = typeof window.BroadcastChannel === "function" ? new BroadcastChannel("cadence-travel") : null;
    if (channel) channel.onmessage = load;
    window.addEventListener("cadence:travel-changed", load);
    return () => {
      active = false;
      channel?.close();
      window.removeEventListener("cadence:travel-changed", load);
    };
  }, [client, enabled]);
  const saveHabits = client?.saveHabits;
  const save = useCallback(async (change: TravelHabitChange) => {
    if (!saveHabits) throw new Error("Travel habits cannot be saved here.");
    const loaded = current.current ?? await client!.load();
    const saved = await saveHabits({ expectedUpdatedAt: loaded.habits?.updatedAt ?? null, change });
    sequence.current++;
    current.current = saved;
    setSettings(saved);
    // An "about right" answer changes no routing input, so it requests nothing.
    if (!(change.kind === "leave_feedback" && change.answer === "about_right")) notifyTravelSettingsChanged();
    return saved;
  }, [client, saveHabits]);
  return enabled && client ? { settings, save: saveHabits ? save : null } : { settings: null, save: null };
}

const CANDIDATE_DAYS = 8;
const CANDIDATES_PER_DAY = 32;
/** Page-session memory only: journeys that showed a routed outbound leg today. Never persisted. */
const leaveCandidates = new Map<string, Map<string, TravelLeaveCandidate>>();
/** Page-session memory only: dismissing the question records nothing with the account. */
const dismissedLeave = new Set<string>();

export function rememberTravelLeaveCandidates(accountKey: string, localDate: string, candidates: readonly TravelLeaveCandidate[]): void {
  if (!candidates.length) return;
  const key = JSON.stringify([accountKey, localDate]);
  const day = leaveCandidates.get(key) ?? new Map<string, TravelLeaveCandidate>();
  for (const candidate of candidates) {
    day.delete(candidate.ref);
    day.set(candidate.ref, candidate);
  }
  while (day.size > CANDIDATES_PER_DAY) day.delete(day.keys().next().value!);
  leaveCandidates.delete(key);
  leaveCandidates.set(key, day);
  while (leaveCandidates.size > CANDIDATE_DAYS) leaveCandidates.delete(leaveCandidates.keys().next().value!);
}

export function travelLeaveCandidates(accountKey: string, localDate: string): TravelLeaveCandidate[] {
  return [...(leaveCandidates.get(JSON.stringify([accountKey, localDate]))?.values() ?? [])];
}

export function dismissTravelLeaveQuestion(accountKey: string, localDate: string): void {
  dismissedLeave.add(JSON.stringify([accountKey, localDate]));
}

export function travelLeaveQuestionDismissed(accountKey: string, localDate: string): boolean {
  return dismissedLeave.has(JSON.stringify([accountKey, localDate]));
}

/** Test-only reset of page-session leave-time memory. */
export function resetTravelHabitMemoryForTest(): void {
  leaveCandidates.clear();
  dismissedLeave.clear();
}
