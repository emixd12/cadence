"use client";

import { useSyncExternalStore } from "react";
import type { BriefTravelGuidance } from "@cadence/core/services/brief-travel-guidance";

/**
 * Page-session channel from the Timeline, which already holds travel evidence,
 * to the Daily Brief bubble. No request, storage or model input is involved.
 */
let current: BriefTravelGuidance | null = null;
const listeners = new Set<() => void>();

export function publishBriefTravel(value: BriefTravelGuidance | null) {
  if (JSON.stringify(value) === JSON.stringify(current)) return;
  current = value;
  for (const listener of listeners) listener();
}

export function useBriefTravel(): BriefTravelGuidance | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function snapshot() { return current; }
function serverSnapshot() { return null; }
