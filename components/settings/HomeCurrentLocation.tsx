"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ForegroundLocation } from "@/lib/ui/foreground-location";
import type { HomeLookupClient, HomeLookupResult } from "@/lib/ui/home-lookup";

export const HOME_LOOKUP_LABEL = "Use my current location";
export const HOME_LOOKUP_TRAVEL_FIRST = "To use your current location, turn on Travel estimates first.";

/** One plain message per outcome. Typing an address always works. */
export const HOME_LOOKUP_MESSAGES = {
  filled: "Address filled from your current location. Check it, then save. Cadence did not keep your position.",
  denied: "Location access is off. Type your address instead.",
  unavailable: "Your device did not share a position. Try again, or type your address.",
  inaccurate: "Your position is not precise enough for an address. Type your address instead.",
  no_result: "No street address was found for your position. Type your address instead.",
  rate_limited: "Too many lookups for now. Type your address, or try again later.",
  lookup_unavailable: "The address lookup is not available right now. Type your address instead.",
  offline: "Connect to the internet to use your current location.",
} as const;

/**
 * Ticket 308: the Home field's row with **Use my current location**. It reads the device
 * position once, asks the hosted lookup for an address and fills the field for the person to
 * check and save. The position lives only in this click's local variables. A null client (a
 * Mac in local mode) keeps typing only.
 */
export function HomeCurrentLocation({ children, client, travelOn, readLocation, onAddress, onLocationRead }: Readonly<{
  children: ReactNode;
  client: HomeLookupClient | null;
  travelOn: boolean;
  readLocation: (requestPermission: boolean) => Promise<ForegroundLocation>;
  onAddress: (address: string) => void;
  /** Called after the device answers, so the permission line can refresh. */
  onLocationRead?: () => void;
}>) {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; }, []);
  const lookup = async () => {
    const current = ++sequence.current;
    setMessage("");
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setMessage(HOME_LOOKUP_MESSAGES.offline); return; }
    setWorking(true);
    try {
      // Ask inside the click, before any other await, so the browser keeps the user gesture.
      let position: ForegroundLocation;
      try { position = await readLocation(true); } catch { position = { state: "unavailable" }; }
      if (current !== sequence.current) return;
      onLocationRead?.();
      if (position.state !== "available") { setMessage(positionMessage(position.state)); return; }
      const result = await client!.lookup({ latitude: position.latitude, longitude: position.longitude, accuracyMeters: position.accuracyMeters });
      if (current !== sequence.current) return;
      if (result.kind === "address") onAddress(result.address);
      setMessage(lookupMessage(result));
    } finally { if (current === sequence.current) setWorking(false); }
  };
  return <>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {children}
      {client && travelOn ? <button type="button" onClick={() => { void lookup(); }} disabled={working}
        className="product-action product-action-secondary min-h-11 w-fit px-3 py-2 text-sm font-bold">
        {working ? "Finding your address…" : HOME_LOOKUP_LABEL}
      </button> : null}
    </div>
    {client && !travelOn ? <p className="text-muted-readable">{HOME_LOOKUP_TRAVEL_FIRST}</p> : null}
    {client && travelOn && message ? <p role="status">{message}</p> : null}
  </>;
}

function positionMessage(state: Exclude<ForegroundLocation["state"], "available">): string {
  if (state === "denied") return HOME_LOOKUP_MESSAGES.denied;
  if (state === "inaccurate") return HOME_LOOKUP_MESSAGES.inaccurate;
  return HOME_LOOKUP_MESSAGES.unavailable;
}

function lookupMessage(result: HomeLookupResult): string {
  if (result.kind === "address") return HOME_LOOKUP_MESSAGES.filled;
  if (result.kind === "no_result") return HOME_LOOKUP_MESSAGES.no_result;
  if (result.kind === "inaccurate") return HOME_LOOKUP_MESSAGES.inaccurate;
  if (result.kind === "rate_limited") return HOME_LOOKUP_MESSAGES.rate_limited;
  if (result.kind === "travel_off") return HOME_LOOKUP_TRAVEL_FIRST;
  return HOME_LOOKUP_MESSAGES.lookup_unavailable;
}
