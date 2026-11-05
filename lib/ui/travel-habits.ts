"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TravelSettings } from "@cadence/core/types/travel";
import { storedTravelLeaveCandidate, type StoredTravelLeaveCandidate, type TravelHabitChange, type TravelLeaveCandidate } from "@cadence/core/services/travel-habits";
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
        if (active && run === sequence.current) {
          // Ticket 274: travel turned off removes today's leave-time candidates.
          if (!value.enabled) clearTravelLeaveMemory();
          current.current = value; setSettings(value);
        }
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
    // Ticket 274: other tabs reload habits, so an answered question never returns there that day.
    else announceHabitsSaved();
    return saved;
  }, [client, saveHabits]);
  return enabled && client ? { settings, save: saveHabits ? save : null } : { settings: null, save: null };
}

/** Tells other tabs to reload habits without invalidating travel estimates. */
function announceHabitsSaved(): void {
  if (typeof window.BroadcastChannel !== "function") return;
  const channel = new BroadcastChannel("cadence-travel");
  channel.postMessage("habits");
  channel.close();
}

const CANDIDATES_PER_DAY = 32;
const LEAVE_SESSION_KEY = "cadence:travel-leave-question";
const EVENT_REF = /^[0-9a-f]{64}$/;

/**
 * Ticket 274: today's leave-time candidates and the "Not now" choice, for one account and
 * one local date. Candidates hold only an event digest and an end time; the title is rebuilt
 * from the current Calendar or Behavior read. The record lives in sessionStorage, like the
 * Ticket 268 travel session: it survives a reload in this tab and ends with the tab. The Mac
 * webview keeps it in memory for the app session; it never reaches SQLite. A different
 * account or date replaces it, and sign-out and travel turned off remove it.
 */
type TravelLeaveRecord = Readonly<{
  version: 1; accountId: string; localDate: string;
  candidates: readonly StoredTravelLeaveCandidate[]; dismissed: boolean;
}>;
/** Used when the browser blocks sessionStorage, so the question still works for the page. */
let leaveMemory: TravelLeaveRecord | null = null;

function leaveStorage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

function validLeaveRecord(value: unknown): value is TravelLeaveRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<TravelLeaveRecord>;
  return record.version === 1 && typeof record.accountId === "string" && typeof record.localDate === "string"
    && typeof record.dismissed === "boolean" && Array.isArray(record.candidates)
    && record.candidates.every((entry) => entry && typeof entry.eventRef === "string" && EVENT_REF.test(entry.eventRef)
      && typeof entry.endsAt === "string" && Number.isFinite(Date.parse(entry.endsAt)));
}

function readLeaveRecord(): TravelLeaveRecord | null {
  const storage = leaveStorage();
  if (!storage) return leaveMemory;
  try {
    const value: unknown = JSON.parse(storage.getItem(LEAVE_SESSION_KEY) ?? "null");
    if (value === null) return leaveMemory;
    return validLeaveRecord(value) ? value : null;
  } catch { return leaveMemory; }
}

function writeLeaveRecord(record: TravelLeaveRecord): void {
  leaveMemory = record;
  const storage = leaveStorage();
  try { storage?.setItem(LEAVE_SESSION_KEY, JSON.stringify(record)); }
  catch {
    // A full or blocked store keeps memory only; an older stored record must not come back.
    try { storage?.removeItem(LEAVE_SESSION_KEY); } catch { /* Nothing to remove. */ }
  }
}

/** The record for this account and date. Another account's or another day's record is removed. */
function leaveRecordFor(accountKey: string, localDate: string): TravelLeaveRecord | null {
  const record = readLeaveRecord();
  if (!record) return null;
  if (record.accountId === accountKey && record.localDate === localDate) return record;
  clearTravelLeaveMemory();
  return null;
}

export function rememberTravelLeaveCandidates(accountKey: string, localDate: string, candidates: readonly TravelLeaveCandidate[]): void {
  const fresh = candidates.filter((candidate) => candidate.localDate === localDate).map(storedTravelLeaveCandidate);
  if (!fresh.length) return;
  const record = leaveRecordFor(accountKey, localDate);
  const kept = new Map((record?.candidates ?? []).map((entry) => [entry.eventRef, entry] as const));
  let changed = false;
  for (const entry of fresh) {
    const previous = kept.get(entry.eventRef);
    if (previous?.endsAt === entry.endsAt) continue;
    kept.delete(entry.eventRef);
    kept.set(entry.eventRef, entry);
    changed = true;
  }
  if (!changed) return;
  while (kept.size > CANDIDATES_PER_DAY) kept.delete(kept.keys().next().value!);
  writeLeaveRecord({ version: 1, accountId: accountKey, localDate, candidates: [...kept.values()], dismissed: record?.dismissed ?? false });
}

/** Today's kept candidates as digests and end times. Match them to the current read with `restoreTravelLeaveCandidates`. */
export function travelLeaveCandidates(accountKey: string, localDate: string): StoredTravelLeaveCandidate[] {
  return [...(leaveRecordFor(accountKey, localDate)?.candidates ?? [])];
}

/** Not now: records nothing with the account and hides the question for this visit, reloads included. */
export function dismissTravelLeaveQuestion(accountKey: string, localDate: string): void {
  const record = leaveRecordFor(accountKey, localDate);
  writeLeaveRecord({ version: 1, accountId: accountKey, localDate, candidates: record?.candidates ?? [], dismissed: true });
}

export function travelLeaveQuestionDismissed(accountKey: string, localDate: string): boolean {
  return leaveRecordFor(accountKey, localDate)?.dismissed ?? false;
}

/** Ticket 274: removes today's leave-time candidates. Sign-out and travel turned off call it on web and Mac. */
export function clearTravelLeaveMemory(): void {
  leaveMemory = null;
  try { leaveStorage()?.removeItem(LEAVE_SESSION_KEY); } catch { /* Nothing to remove. */ }
}

/** Test-only reset of leave-time memory. `keepSession` simulates a page reload. */
export function resetTravelHabitMemoryForTest(options: Readonly<{ keepSession?: boolean }> = {}): void {
  leaveMemory = null;
  if (!options.keepSession) clearTravelLeaveMemory();
}
