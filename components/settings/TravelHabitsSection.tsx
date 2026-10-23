"use client";

import { useEffect, useId, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import type { TravelMode, TravelSettings } from "@cadence/core/types/travel";
import {
  TRAVEL_HABIT_RULES,
  minutesLabel,
  resolveTravelHabits,
  travelHabitMinuteChoices,
  travelModeVerb,
  type TravelHabitChange,
} from "@cadence/core/services/travel-habits";
import { notifyTravelSettingsChanged, type TravelPlaceLabels, type TravelSettingsClient } from "@/lib/ui/travel-settings";

const MODES: readonly TravelMode[] = ["walking", "cycling", "transit", "driving"];
const SELECT = "min-h-11 min-w-0 border-0 border-b border-line bg-background";

/**
 * Ticket 217: learned travel habits in plain words. Each inline choice saves at once
 * with its own revision; there are no separate buffer fields.
 */
export function TravelHabitsSection({ settings, client, onSaved }: Readonly<{
  settings: TravelSettings;
  client: TravelSettingsClient;
  onSaved: (value: TravelSettings) => void;
}>) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [labels, setLabels] = useState<TravelPlaceLabels>({});
  const resolved = resolveTravelHabits(settings.habits);
  const placeModes = settings.habits?.placeModes ?? [];
  const placeKeys = placeModes.map((entry) => entry.placeKey).join(",");
  useEffect(() => {
    let active = true;
    if (!placeKeys || !client.placeLabels) return;
    void client.placeLabels().then((value) => { if (active) setLabels(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [client, placeKeys]);
  const save = async (change: TravelHabitChange) => {
    if (!client.saveHabits) return;
    setPending(true); setMessage("");
    try {
      const saved = await client.saveHabits({ expectedUpdatedAt: settings.habits?.updatedAt ?? null, change });
      onSaved(saved);
      setMessage("Travel habits saved.");
      notifyTravelSettingsChanged();
    } catch {
      setMessage("Travel habits could not save. Reload settings if another device changed them.");
    } finally { setPending(false); }
  };
  const minutesChange = (kind: "preparation" | "arrival_buffer", value: string): TravelHabitChange => {
    const minutes = Number(value);
    const defaultMinutes = kind === "preparation" ? TRAVEL_HABIT_RULES.preparation.defaultMinutes : TRAVEL_HABIT_RULES.arrivalBuffer.defaultMinutes;
    // Choosing the default follows it, so a later rules version can update it.
    return { kind, minutes: minutes === defaultMinutes ? null : minutes };
  };
  const placeLabel = (placeKey: string, chosenAt: string) => labels[placeKey]
    ?? `a Calendar event location (chosen ${Temporal.Instant.from(chosenAt).toLocaleString("en-US", { month: "short", day: "numeric" })})`;
  return <section aria-labelledby={`${id}-title`} className="grid gap-2 border-t border-line pt-4">
    <h3 id={`${id}-title`} className="font-bold">How you travel</h3>
    <p className="text-muted-readable">Cadence learns these only from what you tell it. Get-ready time comes before you leave home or your current position; the arrival buffer is how early you like to arrive.</p>
    <p>You usually need <select aria-label="Get-ready time" className={SELECT} disabled={pending || !client.saveHabits}
      value={resolved.preparationMinutes} onChange={(event) => { void save(minutesChange("preparation", event.target.value)); }}>
      {travelHabitMinuteChoices("preparation").map((value) => <option key={value} value={value}>
        {minutesLabel(value)}{value === TRAVEL_HABIT_RULES.preparation.defaultMinutes ? " (default)" : ""}</option>)}
    </select> to get ready.</p>
    <p>You like to arrive <select aria-label="Arrival buffer" className={SELECT} disabled={pending || !client.saveHabits}
      value={resolved.arrivalBufferMinutes} onChange={(event) => { void save(minutesChange("arrival_buffer", event.target.value)); }}>
      {travelHabitMinuteChoices("arrival_buffer").map((value) => <option key={value} value={value}>
        {minutesLabel(value)}{value === TRAVEL_HABIT_RULES.arrivalBuffer.defaultMinutes ? " (default)" : ""}</option>)}
    </select> early.</p>
    <p className="text-muted-readable">When you say a leave time was too early or too late, Cadence moves this by {TRAVEL_HABIT_RULES.answerMinutes.too_late} minutes, between {TRAVEL_HABIT_RULES.arrivalBuffer.minMinutes} and {TRAVEL_HABIT_RULES.arrivalBuffer.maxMinutes} minutes.</p>
    {placeModes.length ? <ul className="grid gap-1" aria-label="Travel by place">
      {placeModes.map((entry) => <li key={entry.placeKey}>You usually <select aria-label={`Travel to ${placeLabel(entry.placeKey, entry.chosenAt)}`}
        className={SELECT} disabled={pending || !client.saveHabits} value={entry.mode}
        onChange={(event) => { void save({ kind: "place_mode", placeKey: entry.placeKey, mode: event.target.value ? event.target.value as TravelMode : null }); }}>
        {MODES.map((mode) => <option key={mode} value={mode}>{travelModeVerb(mode)}</option>)}
        <option value="">use usual travel</option>
      </select> to <span className="[overflow-wrap:anywhere]">{placeLabel(entry.placeKey, entry.chosenAt)}</span>.</li>)}
    </ul> : <p className="text-muted-readable">No place has its own travel yet. Choose one in Calendar event or Behavior details on the Timeline.</p>}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
