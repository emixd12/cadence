import type {
  CompletionCapturePlan,
  CompletionLabelInput,
  PlaceLabelSettingsInput,
  PlaceLabelState,
  PlaceMarkerInput,
  PlaceRef,
  WhereSuggestionDismissInput,
} from "@cadence/core/types/place-labels";
import { readBrowserForegroundLocation, type ForegroundLocation } from "@/lib/ui/foreground-location";

/**
 * Ticket 216 client. Web calls the hosted route; desktop implements the same
 * interface over the local store. No method returns a completion position.
 */
export type PlaceLabelClient = Readonly<{
  load: () => Promise<PlaceLabelState>;
  saveSettings: (input: PlaceLabelSettingsInput) => Promise<PlaceLabelState>;
  recordMarker: (input: PlaceMarkerInput) => Promise<PlaceLabelState>;
  removeMarkers: (ref: PlaceRef | null) => Promise<PlaceLabelState>;
  deleteLabels: () => Promise<PlaceLabelState>;
  dismissSuggestion: (input: WhereSuggestionDismissInput) => Promise<PlaceLabelState>;
  capturePlan: (occurrenceId: string) => Promise<CompletionCapturePlan | null>;
  recordLabel: (input: CompletionLabelInput) => Promise<void>;
  /** True only when a position can be read without any prompt. */
  locationAllowed: () => Promise<boolean>;
  readLocation: (requestPermission: boolean) => Promise<ForegroundLocation>;
}>;

export const PLACE_LABELS_CHANGED_EVENT = "cadence:place-labels-changed";

async function request<T>(init: RequestInit & { query?: string } = {}): Promise<T> {
  const { query, ...rest } = init;
  const response = await fetch(`/api/travel/place-labels${query ?? ""}`, { ...rest, cache: "no-store", redirect: "error",
    signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" } });
  if (!response.ok) throw new PlaceLabelRequestError(response.status);
  return response.json() as Promise<T>;
}

export class PlaceLabelRequestError extends Error {
  constructor(readonly status: number) {
    super(status === 409 ? "Completion place settings changed on another device. Reload and try again." : "Completion places are unavailable.");
    this.name = "PlaceLabelRequestError";
  }
}

const post = <T>(body: Record<string, unknown>) => request<T>({ method: "POST", body: JSON.stringify(body) });

export const webPlaceLabelClient: PlaceLabelClient = {
  load: () => request(),
  saveSettings: (input) => request({ method: "PUT", body: JSON.stringify(input) }),
  recordMarker: (input) => post({ action: "record_marker", ...input }),
  removeMarkers: (ref) => post({ action: "remove_markers", ref }),
  deleteLabels: () => post({ action: "delete_labels" }),
  dismissSuggestion: (input) => post({ action: "dismiss_suggestion", ...input }),
  capturePlan: (occurrenceId) => request({ query: `?occurrence=${encodeURIComponent(occurrenceId)}` }),
  recordLabel: async (input) => { await post({ action: "record_label", ...input }); },
  locationAllowed: async () => {
    if (typeof navigator === "undefined" || typeof navigator.permissions?.query !== "function") return false;
    try { return (await navigator.permissions.query({ name: "geolocation" })).state === "granted"; }
    catch { return false; }
  },
  readLocation: readBrowserForegroundLocation,
};

/** Tells every mounted control, and other tabs, to reload. Carries no data. */
export function notifyPlaceLabelsChanged(): void {
  window.dispatchEvent(new Event(PLACE_LABELS_CHANGED_EVENT));
  if (typeof window.BroadcastChannel === "function") {
    const channel = new BroadcastChannel("cadence-place-labels");
    channel.postMessage("changed");
    channel.close();
  }
}
