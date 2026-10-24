"use client";

import type { ReactNode } from "react";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import type { PlaceLabelState } from "@cadence/core/types/place-labels";
import { BehaviorPlaceAssist, CompletionPlacesPanel, PlaceLabelProvider, PlaceMarkerControl } from "@/components/travel/PlaceLabels";
import type { PlaceLabelClient } from "@/lib/ui/place-labels";

// Synthetic Ticket 216 state. The bench never reads a position or calls a route.
const state: PlaceLabelState = {
  settings: { enabled: true, retention: "90_days", enabledAt: "2026-10-01T12:00:00Z", markerPromptDismissedAt: null, updatedAt: "2026-10-01T12:00:00Z" },
  homePlaceKey: travelPlaceKey("1 Example Lane"),
  homeMarker: null,
  placeMarkers: [{ placeKey: travelPlaceKey("2 Example Gym"), recordedAt: "2026-10-02T12:00:00Z" }],
  labelCount: 14,
  behaviors: [
    { behaviorId: "bench-suggestion", suggestedPlaceText: null, markerPrompt: null,
      suggestion: { ruleVersion: "where-suggestion-rules@1", kind: "home", key: "home", placeKey: null, labelCount: 8, supportingCount: 7 } },
    { behaviorId: "bench-prompt", suggestion: null, suggestedPlaceText: null, markerPrompt: "home" },
  ],
};
const unavailable = async () => { throw new Error("Bench previews make no requests."); };
const client: PlaceLabelClient = {
  load: async () => state,
  saveSettings: unavailable,
  recordMarker: unavailable,
  removeMarkers: unavailable,
  deleteLabels: unavailable,
  dismissSuggestion: unavailable,
  capturePlan: async () => null,
  recordLabel: async () => undefined,
  locationAllowed: async () => false,
  readLocation: async () => ({ state: "denied" as const }),
};

function Bench({ children }: Readonly<{ children: ReactNode }>) {
  return <PlaceLabelProvider client={client}>{children}</PlaceLabelProvider>;
}

export function CompletionPlacesPanelBench() {
  return <Bench><CompletionPlacesPanel /></Bench>;
}

export function PlaceMarkerControlBench() {
  return <Bench><div className="grid gap-4">
    <PlaceMarkerControl place={{ kind: "home" }} />
    <PlaceMarkerControl place={{ kind: "saved_place", text: "2 Example Gym" }} />
  </div></Bench>;
}

export function BehaviorPlaceAssistBench() {
  return <Bench><div className="grid gap-4">
    <BehaviorPlaceAssist behaviorId="bench-suggestion" placeText={null} onReview={() => undefined} />
    <BehaviorPlaceAssist behaviorId="bench-prompt" placeText={null} onReview={() => undefined} />
  </div></Bench>;
}
