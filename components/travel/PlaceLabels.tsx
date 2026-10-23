"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import {
  CURRENT_PLACE_LABEL_RULES,
  PLACE_LABEL_RULE_SETS,
  checkDeviceSample,
  placeLabelRetentionShortens,
  positionFromSample,
  resolveCompletionPlaceLabel,
} from "@cadence/core/resolvers/place-label.resolver";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import type { BehaviorWhereKind } from "@cadence/core/types/behavior";
import type { PlaceLabelRetention, PlaceLabelState, PlaceMarkerInput, PlaceRef } from "@cadence/core/types/place-labels";
import { PLACE_LABELS_CHANGED_EVENT, notifyPlaceLabelsChanged, webPlaceLabelClient, type PlaceLabelClient } from "@/lib/ui/place-labels";

/**
 * Ticket 216: completion place labels. Every control here is sparse and hidden
 * while labels are off. A completion position is compared on the device and then
 * discarded; only "I'm here" sends a position, and only the user's own marker.
 */
type PlaceLabelContextValue = Readonly<{
  client: PlaceLabelClient;
  state: PlaceLabelState | null;
  failed: boolean;
  request: () => void;
  reload: () => void;
  adopt: (state: PlaceLabelState) => void;
  captureCompletion: (occurrenceId: string) => void;
  desktop: boolean;
}>;

const PlaceLabelContext = createContext<PlaceLabelContextValue | null>(null);

export function PlaceLabelProvider({ client = webPlaceLabelClient, desktop = false, children }: Readonly<{
  client?: PlaceLabelClient;
  desktop?: boolean;
  children: ReactNode;
}>) {
  const [state, setState] = useState<PlaceLabelState | null>(null);
  const [failed, setFailed] = useState(false);
  const [wanted, setWanted] = useState(false);
  const stateRef = useRef<PlaceLabelState | null>(null);
  const sequence = useRef(0);
  const adopt = useCallback((next: PlaceLabelState) => {
    sequence.current++;
    stateRef.current = next;
    setState(next);
    setFailed(false);
  }, []);
  // Invalidates pending loads; a stale response never replaces newer state.
  const invalidate = useCallback(() => { sequence.current++; }, []);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const next = await client.load();
      if (current === sequence.current) { stateRef.current = next; setState(next); setFailed(false); }
      return next;
    } catch (error) {
      if (current === sequence.current) setFailed(true);
      throw error;
    }
  }, [client]);
  useEffect(() => {
    if (!wanted) return;
    const reload = () => { void load().catch(() => undefined); };
    reload();
    // Where, Home and other tabs change prompts and suggestions; no data rides on these events.
    window.addEventListener(PLACE_LABELS_CHANGED_EVENT, reload);
    window.addEventListener("cadence:travel-changed", reload);
    const channel = typeof window.BroadcastChannel === "function" ? new BroadcastChannel("cadence-place-labels") : null;
    channel?.addEventListener("message", reload);
    return () => {
      invalidate();
      window.removeEventListener(PLACE_LABELS_CHANGED_EVENT, reload);
      window.removeEventListener("cadence:travel-changed", reload);
      channel?.close();
    };
  }, [wanted, load, invalidate]);
  const captureCompletion = useCallback((occurrenceId: string) => {
    void (async () => {
      // Never prompt at completion: without an existing grant, nothing is read or sent.
      if (!(await client.locationAllowed())) return;
      const current = stateRef.current ?? await load();
      if (!current.settings.enabled) return;
      const plan = await client.capturePlan(occurrenceId);
      const rules = plan ? PLACE_LABEL_RULE_SETS[plan.ruleVersion] : undefined;
      if (!plan || !rules) return;
      const sample = await client.readLocation(false);
      if (sample.state !== "available") return;
      const result = resolveCompletionPlaceLabel({ sample, markers: plan.markers, deviceNowMs: Date.now(), rules });
      if (result.kind !== "label") return;
      await client.recordLabel({ occurrenceId, label: result.label, ruleVersion: result.ruleVersion });
      if (stateRef.current) void load().catch(() => undefined);
    })().catch(() => undefined);
  }, [client, load]);
  const request = useCallback(() => setWanted(true), []);
  const reload = useCallback(() => { void load().catch(() => undefined); }, [load]);
  const value = useMemo(() => ({ client, state, failed, request, reload, adopt, captureCompletion, desktop }),
    [client, state, failed, request, reload, adopt, captureCompletion, desktop]);
  return <PlaceLabelContext.Provider value={value}>{children}</PlaceLabelContext.Provider>;
}

/** Null outside a provider (bench previews, tests); controls then render nothing. */
function usePlaceLabels(): PlaceLabelContextValue | null {
  const context = useContext(PlaceLabelContext);
  useEffect(() => { context?.request(); }, [context]);
  return context;
}

/** For StatusButtons: labels a completion this device just marked, silently. */
export function useCompletionPlaceCapture(): ((occurrenceId: string) => void) | null {
  return useContext(PlaceLabelContext)?.captureCompletion ?? null;
}

type MarkerPlace = PlaceMarkerInput["place"];

/** Reads one position after an explicit tap and stores it as the place's marker. */
function useRecordMarker(context: PlaceLabelContextValue | null) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const record = (place: MarkerPlace) => {
    if (!context) return;
    // Ask before any await so the browser keeps the user gesture.
    let reading: ReturnType<PlaceLabelClient["readLocation"]>;
    try { reading = context.client.readLocation(true); } catch { reading = Promise.resolve({ state: "unavailable" }); }
    setBusy(true); setMessage("Reading your position…");
    void (async () => {
      try {
        const result = await reading;
        if (result.state !== "available") { setMessage(locationMessage(result.state, context.desktop)); return; }
        const check = checkDeviceSample(result, Date.now(), CURRENT_PLACE_LABEL_RULES);
        if (!check.usable) { setMessage(locationMessage(check.reason, context.desktop)); return; }
        const next = await context.client.recordMarker({ place, position: positionFromSample(result),
          sampleAgeSeconds: Math.max(0, Math.round((Date.now() - result.sampledAt) / 1000)) });
        context.adopt(next);
        notifyPlaceLabelsChanged();
        setMessage(place.kind === "home" ? "Home marker saved." : "Place marker saved.");
      } catch { setMessage("The marker could not save. Try again."); }
      finally { setBusy(false); }
    })();
  };
  return { busy, message, setMessage, record };
}

function locationMessage(state: string, desktop: boolean): string {
  if (state === "denied") return desktop
    ? "Location is blocked. Allow Cadence in System Settings › Privacy & Security › Location Services, then try again."
    : "Location is blocked. Allow it for this site in your browser settings, then try again.";
  if (state === "stale") return "That position was too old. Try again.";
  if (state === "inaccurate") return "That position was not accurate enough; Cadence needs 100 m or better. Try again.";
  return "Cadence could not read a position. Try again.";
}

function formatRecorded(instant: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(instant));
}

/** "I'm here" beside Home (Travel Settings) and below the Behavior Where field. */
export function PlaceMarkerControl({ place }: Readonly<{ place: MarkerPlace }>) {
  const context = usePlaceLabels();
  const { busy, message, record } = useRecordMarker(context);
  const [removing, setRemoving] = useState(false);
  const state = context?.state;
  if (!context || !state?.settings.enabled) return null;
  let ref: PlaceRef, recordedAt: string | null, label: string;
  if (place.kind === "home") {
    if (!state.homePlaceKey) return null;
    ref = "home";
    recordedAt = state.homeMarker?.current ? state.homeMarker.recordedAt : null;
    label = "Home";
  } else {
    const text = place.text.trim();
    if (!text) return null;
    const key = travelPlaceKey(text);
    ref = `saved_place:${key}`;
    recordedAt = state.placeMarkers.find((marker) => marker.placeKey === key)?.recordedAt ?? null;
    label = "this place";
  }
  const remove = async () => {
    setRemoving(true);
    try { context.adopt(await context.client.removeMarkers(ref)); notifyPlaceLabelsChanged(); }
    catch { /* The state stays as loaded; the next load shows the stored marker. */ }
    finally { setRemoving(false); }
  };
  return <div className="grid gap-1 text-sm leading-6" data-place-marker={ref === "home" ? "home" : "saved_place"}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-muted-readable">{recordedAt
        ? `${place.kind === "home" ? "Home" : "Place"} marker saved ${formatRecorded(recordedAt)}.`
        : place.kind === "home" && state.homeMarker && !state.homeMarker.current
          ? "Home changed. Record its marker again when you are there."
          : `No marker yet. When you are at ${label}, select I'm here.`}</span>
      <button type="button" className="product-action product-action-secondary min-h-11 w-fit" disabled={busy || removing}
        onClick={() => record(place)}>{busy ? "Reading…" : recordedAt ? "Update marker" : "I'm here"}</button>
      {recordedAt ? <button type="button" className="product-action product-action-secondary min-h-11 w-fit" disabled={busy || removing}
        onClick={() => { void remove(); }}>Remove</button> : null}
    </div>
    {message ? <p role="status" className="text-muted-readable">{message}</p> : null}
  </div>;
}

export type WhereDraft = Readonly<{ whereKind: BehaviorWhereKind; locationText: string }>;

/** One sparse line on a Behavior record: a Where suggestion, or the first missing-marker prompt. */
export function BehaviorPlaceAssist({ behaviorId, whereKind = null, placeText, onReview }: Readonly<{
  behaviorId: string;
  whereKind?: BehaviorWhereKind | null;
  /** The Behavior's own A place text, so its marker key matches the stored Where. */
  placeText: string | null;
  onReview: (draft: WhereDraft) => void;
}>) {
  const context = usePlaceLabels();
  // A saved Where changes prompts and suggestions; reload without relying on the form's event.
  const where = `${whereKind ?? ""}:${placeText ?? ""}`;
  const shownWhere = useRef(where);
  const reload = context?.reload;
  useEffect(() => {
    if (shownWhere.current === where) return;
    shownWhere.current = where;
    reload?.();
  }, [where, reload]);
  const { busy, message, record } = useRecordMarker(context);
  const [pending, setPending] = useState(false);
  const entry = context?.state?.behaviors.find((item) => item.behaviorId === behaviorId) ?? null;
  if (!context?.state?.settings.enabled || !entry || (!entry.suggestion && !entry.markerPrompt)) {
    return message ? <p role="status" className="text-sm leading-6 text-muted-readable">{message}</p> : null;
  }
  const { state } = context;
  const run = async (operation: () => Promise<PlaceLabelState>) => {
    setPending(true);
    try { context.adopt(await operation()); notifyPlaceLabelsChanged(); }
    catch { /* Keep the line; a later load reflects the stored state. */ }
    finally { setPending(false); }
  };
  const suggestion = entry.suggestion;
  if (suggestion) {
    const text = suggestion.kind === "home" ? `Usually completed at Home (${suggestion.supportingCount} of ${suggestion.labelCount} recent completions).`
      : suggestion.kind === "saved_place" ? `Usually completed at ${entry.suggestedPlaceText} (${suggestion.supportingCount} of ${suggestion.labelCount} recent completions).`
        : suggestion.kind === "anywhere" ? `Completed in different places (${suggestion.labelCount} recent completions). Anywhere may fit.`
          : `Usually completed away from your saved places (${suggestion.supportingCount} of ${suggestion.labelCount}). Adding that place can help travel estimates.`;
    const draft: WhereDraft = suggestion.kind === "home" ? { whereKind: "home", locationText: "" }
      : suggestion.kind === "saved_place" ? { whereKind: "place", locationText: entry.suggestedPlaceText ?? "" }
        : suggestion.kind === "anywhere" ? { whereKind: "anywhere", locationText: "" } : { whereKind: "place", locationText: "" };
    return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-6" data-where-suggestion={suggestion.kind}
      data-rule-version={suggestion.ruleVersion}>
      <span>{text}</span>
      <button type="button" className="product-action product-action-secondary min-h-11 w-fit" disabled={pending} onClick={() => onReview(draft)}>Review Where</button>
      <button type="button" className="product-action product-action-secondary min-h-11 w-fit" disabled={pending}
        onClick={() => { void run(() => context.client.dismissSuggestion({ behaviorId, suggestion: suggestion.key, ruleVersion: suggestion.ruleVersion })); }}>Dismiss</button>
    </div>;
  }
  const ref = entry.markerPrompt!;
  const markerPlace: MarkerPlace | null = ref === "home" ? { kind: "home" } : placeText ? { kind: "saved_place", text: placeText } : null;
  return <div className="grid gap-1 text-sm leading-6" data-marker-prompt={ref === "home" ? "home" : "saved_place"}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{ref === "home" ? "Home has no marker yet." : "This place has no marker yet."} When you are there, select I&apos;m here so Cadence can label completions.</span>
      {markerPlace ? <button type="button" className="product-action product-action-secondary min-h-11 w-fit" disabled={busy || pending}
        onClick={() => record(markerPlace)}>{busy ? "Reading…" : "I'm here"}</button> : null}
      <button type="button" className="product-action product-action-secondary min-h-11 w-fit" disabled={busy || pending}
        onClick={() => { void run(() => context.client.saveSettings({ enabled: true, retention: state.settings.retention,
          markerPromptDismissed: true, expectedUpdatedAt: state.settings.updatedAt })); }}>Not now</button>
    </div>
    {message ? <p role="status" className="text-muted-readable">{message}</p> : null}
  </div>;
}

const RETENTION_OPTIONS: ReadonlyArray<{ value: PlaceLabelRetention; label: string; detail: string }> = [
  { value: "90_days", label: "90 days", detail: "Keeps the least about where you have been. Enough for suggestions; little history for the advisor to learn from." },
  { value: "1_year", label: "1 year", detail: "Keeps a year of places, so Cadence and the advisor can learn seasonal patterns." },
  { value: "until_deleted", label: "Until I delete them", detail: "Keeps every label until you delete it. The most history and the best insights; the most stored about where you have been." },
];
const RETENTION_LABELS: Readonly<Record<PlaceLabelRetention, string>> = { "90_days": "90 days", "1_year": "1 year", until_deleted: "until you delete them" };

/** Settings › Travel › Completion places: opt-in with retention, counts, and delete controls. */
export function CompletionPlacesSection() {
  const id = useId();
  const context = usePlaceLabels();
  const [setup, setSetup] = useState(false);
  const [retention, setRetention] = useState<PlaceLabelRetention>("90_days");
  const [confirm, setConfirm] = useState<"off" | "shorter" | "labels" | "markers" | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  if (!context) return null;
  const { state } = context;
  const run = async (operation: () => Promise<PlaceLabelState>, done: string) => {
    setPending(true); setMessage("");
    try { context.adopt(await operation()); notifyPlaceLabelsChanged(); setMessage(done); setConfirm(null); setSetup(false); }
    catch (error) { setMessage(error instanceof Error && error.message.includes("another device") ? error.message : "Completion places could not save. Reload and try again."); }
    finally { setPending(false); }
  };
  const save = (enabled: boolean, nextRetention: PlaceLabelRetention, done: string) => state && run(() => context.client.saveSettings({
    enabled, retention: nextRetention, markerPromptDismissed: state.settings.markerPromptDismissedAt !== null,
    expectedUpdatedAt: state.settings.updatedAt }), done);
  const markerCount = state ? state.placeMarkers.length + (state.homeMarker ? 1 : 0) : 0;
  return <section aria-labelledby={`${id}-title`} className="grid gap-2 border-t border-line pt-4" data-completion-places>
    <h3 id={`${id}-title`} className="font-bold">Completion places</h3>
    <p className="text-muted-readable">When you mark a Behavior Completed, Cadence can check your device position once, if location is already allowed, and save only whether you were at Home, a saved place or elsewhere. It never saves that position. Labels suggest each Behavior&apos;s Where and never change a Behavior on their own.</p>
    <div className="grid gap-4">
      {!state ? <p>{context.failed ? "Completion places could not load." : "Loading completion places…"}</p>
        : !state.settings.enabled ? <div className="grid gap-3">
          {!setup ? <button type="button" className="product-action product-action-primary min-h-11 w-fit" onClick={() => { setSetup(true); setRetention("90_days"); }}>Set up completion places</button>
            : <fieldset className="grid gap-3" disabled={pending}>
              <legend className="font-bold">Keep labels for</legend>
              <RetentionChoices name={`${id}-retention`} value={retention} onChange={setRetention} />
              <p className="text-muted-readable">Next, record a marker at Home and at each saved place with I&apos;m here. While the Daily Brief is on, it receives label counts only, never places.</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="product-action product-action-primary min-h-11 w-fit"
                  onClick={() => { void save(true, retention, "Completion places are on."); }}>Save where I complete Behaviors</button>
                <button type="button" className="product-action product-action-secondary min-h-11 w-fit" onClick={() => setSetup(false)}>Cancel</button>
              </div>
            </fieldset>}
        </div>
        : <div className="grid gap-4">
          <p>Saving where you complete Behaviors. {state.labelCount === 1 ? "1 label" : `${state.labelCount} labels`} kept for {RETENTION_LABELS[state.settings.retention]}; {markerCount === 1 ? "1 place marker" : `${markerCount} place markers`}.</p>
          <fieldset className="grid gap-3" disabled={pending}>
            <legend className="font-bold">Keep labels for</legend>
            <RetentionChoices name={`${id}-retention`} value={confirm === "shorter" ? retention : state.settings.retention}
              onChange={(next) => {
                if (next === state.settings.retention) { setConfirm(null); return; }
                if (placeLabelRetentionShortens(state.settings.retention, next)) { setRetention(next); setConfirm("shorter"); return; }
                void save(true, next, "Retention saved.");
              }} />
            {confirm === "shorter" ? <ConfirmLine text={`Switching deletes labels older than ${RETENTION_LABELS[retention]}.`} action="Switch and delete"
              onConfirm={() => { void save(true, retention, "Retention saved. Older labels were deleted."); }} onCancel={() => setConfirm(null)} /> : null}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="product-action product-action-secondary min-h-11 w-fit" disabled={pending || !state.labelCount} onClick={() => setConfirm("labels")}>Delete labels</button>
            <button type="button" className="product-action product-action-secondary min-h-11 w-fit" disabled={pending || !markerCount} onClick={() => setConfirm("markers")}>Delete place markers</button>
            <button type="button" className="product-action product-action-danger min-h-11 w-fit" disabled={pending} onClick={() => setConfirm("off")}>Turn off</button>
          </div>
          {confirm === "labels" ? <ConfirmLine text="Delete every saved label? Suggestions start again from new completions." action="Delete labels"
            onConfirm={() => { void run(() => context.client.deleteLabels(), "Labels deleted."); }} onCancel={() => setConfirm(null)} /> : null}
          {confirm === "markers" ? <ConfirmLine text="Delete every place marker? Labels stop until you record markers again." action="Delete place markers"
            onConfirm={() => { void run(() => context.client.removeMarkers(null), "Place markers deleted."); }} onCancel={() => setConfirm(null)} /> : null}
          {confirm === "off" ? <ConfirmLine text="Turning this off deletes every label, place marker and dismissed suggestion." action="Turn off and delete"
            onConfirm={() => { void save(false, state.settings.retention, "Completion places are off. Labels and markers were deleted."); }} onCancel={() => setConfirm(null)} /> : null}
        </div>}
      {message ? <p role="status">{message}</p> : null}
    </div>
  </section>;
}

function RetentionChoices({ name, value, onChange }: Readonly<{ name: string; value: PlaceLabelRetention; onChange: (value: PlaceLabelRetention) => void }>) {
  return <div className="grid gap-2">
    {RETENTION_OPTIONS.map((option) => <label key={option.value} className="flex items-start gap-2">
      <input type="radio" className="mt-1.5" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
      <span><span className="font-bold">{option.label}.</span> <span className="text-muted-readable">{option.detail}</span></span>
    </label>)}
  </div>;
}

function ConfirmLine({ text, action, onConfirm, onCancel }: Readonly<{ text: string; action: string; onConfirm: () => void; onCancel: () => void }>) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1" role="group" aria-label={action}>
    <span>{text}</span>
    <button type="button" className="product-action product-action-danger min-h-11 w-fit" onClick={onConfirm}>{action}</button>
    <button type="button" className="product-action product-action-secondary min-h-11 w-fit" onClick={onCancel}>Cancel</button>
  </div>;
}
