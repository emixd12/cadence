"use client";

import { useState } from "react";
import type { TravelEvidenceResult, TravelMode } from "@cadence/core/types/travel";
import { rememberedTravelMode } from "@cadence/core/services/travel-habits";
import type { TravelHabitsState } from "@/lib/ui/travel-habits";

const MODE_LABELS: Readonly<Record<TravelMode, string>> = { walking: "Walking", cycling: "Cycling", transit: "Transit", driving: "Driving" };

/**
 * Ticket 217: choose travel for the journey to this event or Behavior. Cadence
 * remembers the choice for the place; "Usual travel" forgets it.
 */
export function TravelModeChoice({ eventId, travel, habits, usualMode }: Readonly<{
  eventId: string;
  travel?: Omit<TravelEvidenceResult, "modelProjection"> | null;
  habits?: TravelHabitsState | null;
  usualMode?: TravelMode | null;
}>) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const leg = travel?.legs.find((item) => item.leg.destinationCommitmentRef === eventId && item.leg.destinationPlaceKey)?.leg;
  const save = habits?.save;
  if (!leg?.destinationPlaceKey || !save || !habits?.settings) return null;
  const placeKey = leg.destinationPlaceKey;
  const remembered = rememberedTravelMode(habits.settings.habits, placeKey);
  const usual = habits.settings.mode ?? usualMode ?? null;
  const choose = async (value: string) => {
    setPending(true); setMessage("");
    try {
      await save({ kind: "place_mode", placeKey, mode: value ? value as TravelMode : null });
      setMessage(value ? "Saved for this place. Estimates refresh." : "This place uses your usual travel again.");
    } catch { setMessage("Travel could not save. Try again."); }
    finally { setPending(false); }
  };
  return <div className="grid gap-1 text-xs leading-5">
    <label className="grid gap-1 sm:max-w-xs">Travel by
      <select value={remembered ?? ""} disabled={pending} onChange={(event) => { void choose(event.target.value); }}
        className="min-h-11 min-w-0 border-b border-line bg-background">
        <option value="">Usual travel{usual ? ` (${MODE_LABELS[usual]})` : ""}</option>
        {(Object.keys(MODE_LABELS) as TravelMode[]).map((mode) => <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>)}
      </select>
    </label>
    <p className="text-muted-readable">Cadence remembers this for the place.</p>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
