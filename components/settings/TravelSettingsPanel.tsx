"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { TravelMode, TravelSettings } from "@cadence/core/types/travel";
import { SettingsPanel } from "./SettingsPanels";
import { readBrowserForegroundLocation, type ForegroundLocation } from "@/lib/ui/foreground-location";
import { notifyTravelSettingsChanged, webTravelSettingsClient, type TravelSettingsClient } from "@/lib/ui/travel-settings";
import { TravelHabitsSection } from "./TravelHabitsSection";

const TRAVEL_MODES: ReadonlyArray<{ value: TravelMode; label: string }> = [
  { value: "walking", label: "Walking" },
  { value: "cycling", label: "Cycling" },
  { value: "transit", label: "Transit" },
  { value: "driving", label: "Driving" },
];

/**
 * Ticket 215: three inputs. The toggle records routing consent and asks for
 * foreground location in the same click; Home and usual travel save together.
 */
export function TravelSettingsPanel({ client = webTravelSettingsClient, readLocation = readBrowserForegroundLocation, openLocationSettings, desktop = false }: Readonly<{
  client?: TravelSettingsClient;
  readLocation?: (requestPermission: boolean) => Promise<ForegroundLocation>;
  /** Desktop only: opens System Settings › Privacy & Security › Location Services. */
  openLocationSettings?: () => Promise<void>;
  desktop?: boolean;
}>) {
  const id = useId();
  const [settings, setSettings] = useState<TravelSettings | null>(null);
  const [home, setHome] = useState("");
  const [mode, setMode] = useState<TravelMode | "">("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [location, setLocation] = useState<ForegroundLocation["state"] | null>(null);
  const [locating, setLocating] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [permission, setPermission] = useState<DeviceLocationPermission | null>(null);
  const sequence = useRef(0);
  const [locationReason, setLocationReason] = useState<string | null>(null);
  const locationSequence = useRef(0);
  const permissionSequence = useRef(0);
  const refreshPermission = () => {
    const current = ++permissionSequence.current;
    void queryDeviceLocationPermission(desktop, readLocation).then((value) => {
      if (current === permissionSequence.current) setPermission(value);
    });
  };
  const adopt = (value: TravelSettings) => {
    setSettings(value); setHome(value.baseLocationText ?? ""); setMode(value.mode ?? "");
  };
  useEffect(() => {
    refreshPermission();
    // Mount-only query; later queries follow each save. Cleanup invalidates pending results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { permissionSequence.current++; locationSequence.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const current = ++sequence.current;
    void client.load().then((value) => {
      if (current === sequence.current) adopt(value);
    }).catch(() => { if (current === sequence.current) setMessage("Travel settings could not load."); });
    // The cleanup deliberately invalidates every pending load/save/location result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { sequence.current++; };
  }, [client]);
  const save = async (enabled: boolean) => {
    if (!settings) return;
    // Ask for location inside the click, before any await, so the browser keeps the user gesture.
    if (enabled && !settings.enabled) void locate();
    const current = ++sequence.current;
    setPending(true); setMessage("");
    try {
      // The map-app preference is no longer shown; the stored value passes through unchanged.
      const saved = await client.save({ enabled, baseLocationText: home.trim() || null, mode: mode || null,
        navigationPreference: settings.navigationPreference, expectedUpdatedAt: settings.updatedAt,
        acceptRoutingDisclosure: enabled });
      if (current !== sequence.current) return;
      adopt(saved);
      setMessage("Travel settings saved.");
      notifyTravelSettingsChanged();
    } catch { if (current === sequence.current) setMessage("Travel settings could not save. Reload settings if another device changed them."); }
    finally { if (current === sequence.current) { setPending(false); refreshPermission(); } }
  };
  const locate = async () => {
    const current = ++locationSequence.current;
    let request: Promise<ForegroundLocation>;
    try { request = readLocation(true); } catch { request = Promise.resolve({ state: "unavailable" }); }
    setLocating(true);
    try {
      const result = await request;
      if (current === locationSequence.current) { setLocation(result.state); setLocationReason("reason" in result && result.reason ? result.reason : null); }
    } catch { if (current === locationSequence.current) { setLocation("unavailable"); setLocationReason(null); } }
    finally { if (current === locationSequence.current) { setLocating(false); refreshPermission(); } }
  };
  const retry = async () => {
    setRetrying(true);
    try { await locate(); } finally { setRetrying(false); }
  };
  const openSettings = async () => {
    try { await openLocationSettings?.(); } catch { setMessage("System Settings could not open. Open it from the Apple menu."); }
  };
  // Ticket 165: macOS may not show its prompt, so travel that is on explains the manual path.
  // The toggle's own first request hides this until it answers; a retry keeps it in place.
  const locationDenied = permission === "blocked" || location === "denied";
  const locationTimedOut = location === "unavailable" && locationReason === "timeout";
  const locationHelp = Boolean(settings?.enabled) && location !== "available" && (!locating || retrying)
    && (permission === "not yet allowed" || locationDenied || locationTimedOut);
  const permissionHint = permission && !locationHelp ? deviceLocationHint(permission, desktop) : null;
  const changed = settings ? (home.trim() || null) !== settings.baseLocationText || (mode || null) !== settings.mode : false;
  return <SettingsPanel id="travel" title="Travel" description="Estimate travel time to located Calendar events and Behaviors. Travel never changes a schedule or status.">
    <div className="grid max-w-2xl gap-4 text-sm leading-6">
      {settings ? <fieldset disabled={pending} className="grid min-w-0 gap-4">
        <div className="grid gap-1">
          <label className="flex min-h-11 items-center gap-2 font-bold"><input type="checkbox" checked={settings.enabled}
            disabled={!settings.enabled && !mode} aria-describedby={`${id}-disclosure`}
            onChange={(event) => { void save(event.target.checked); }} />Travel estimates</label>
          <p id={`${id}-disclosure`} className="text-muted-readable">While this is on, Cadence sends trip start and end points, your usual travel and times to Google Maps as you use the app. Trip points can be your current position, Home, Behavior places and Calendar event locations. Google processes requests under its own terms. Turning this on asks for device location.</p>
          {!settings.enabled && !mode ? <p className="text-muted-readable">Choose your usual travel to turn on estimates.</p> : null}
        </div>
        <div className="grid gap-1"><label htmlFor={`${id}-home`}>Home (optional)</label><input id={`${id}-home`} maxLength={500} value={home} onChange={(event) => setHome(event.target.value)} className="min-h-11 min-w-0 border-0 border-b border-line bg-background" autoComplete="off" /><p className="text-muted-readable">Use a full address. Trips home and Behaviors set to Home use it. Without Home, the trip back stays unknown.</p></div>
        <div className="grid gap-1 sm:max-w-xs"><label htmlFor={`${id}-mode`}>Usual travel</label><select id={`${id}-mode`} value={mode} onChange={(event) => setMode(event.target.value as TravelMode | "")} className="min-h-11 min-w-0 border-0 border-b border-line bg-background">{mode ? null : <option value="">Choose</option>}{TRAVEL_MODES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
        <button type="button" onClick={() => { void save(settings.enabled); }} disabled={!changed} className="product-action product-action-primary min-h-11 w-fit">{pending ? "Saving…" : "Save travel settings"}</button>
        {client.saveHabits ? <TravelHabitsSection settings={settings} client={client} onSaved={setSettings} /> : null}
        <p className="text-muted-readable">Cadence saves only the places you enter and the travel habits you tell it. Device positions and route results stay temporary and never enter exports or synced backups. Travel places and route results are not sent to the Daily Brief model.</p>
        {desktop ? <p className="text-muted-readable">Saved places work offline. Route estimates need a linked account, a synchronized working copy and an internet connection.</p> : null}
        {permission ? <p className="text-muted-readable">Device location: {permission}.{permissionHint ? ` ${permissionHint}` : ""}</p> : null}
        {locationHelp ? <div className="grid gap-2">
          <p className="text-muted-readable">{deviceLocationGuidance(permission, locationDenied, desktop)}</p>
          <p className="text-muted-readable">Saved places and Calendar trips keep working without device location.</p>
          <div className="flex flex-wrap gap-2">
            {desktop && openLocationSettings ? <button type="button" onClick={() => { void openSettings(); }} className="product-action product-action-secondary min-h-11 w-fit px-3 py-2 text-sm font-bold">Open Location Services</button> : null}
            <button type="button" onClick={() => { void retry(); }} disabled={locating} className="product-action product-action-secondary min-h-11 w-fit px-3 py-2 text-sm font-bold">Check again</button>
          </div>
        </div> : null}
      </fieldset> : <p>Loading travel settings…</p>}
      {locating ? <p role="status">Checking device location…</p> : location ? <p role="status">{location === "available" ? "A current position is available. Cadence did not save it." : `Location ${location}. Estimates start from Home or your previous stop instead.${locationReason && (location === "unavailable" || location === "denied") ? ` Diagnostic: ${locationReason}.` : ""}`}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  </SettingsPanel>;
}

type DeviceLocationPermission = "allowed" | "not yet allowed" | "blocked";

async function queryDeviceLocationPermission(desktop: boolean, readLocation: (requestPermission: boolean) => Promise<ForegroundLocation>): Promise<DeviceLocationPermission | null> {
  try {
    if (desktop) {
      const { state } = await readLocation(false);
      return state === "available" ? "allowed" : state === "prompt" ? "not yet allowed" : state === "denied" ? "blocked" : null;
    }
    if (typeof navigator === "undefined" || typeof navigator.permissions?.query !== "function") return null;
    const { state } = await navigator.permissions.query({ name: "geolocation" });
    return state === "granted" ? "allowed" : state === "prompt" ? "not yet allowed" : state === "denied" ? "blocked" : null;
  } catch { return null; }
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const agent = navigator.userAgent;
  return /iP(hone|ad|od)/.test(agent) && /Safari/.test(agent) && !/CriOS|FxiOS|EdgiOS/.test(agent);
}

function deviceLocationHint(permission: DeviceLocationPermission, desktop: boolean): string | null {
  if (permission === "not yet allowed") return !desktop && isIosSafari() ? "To stop Safari asking, tap AA, then Website Settings, then Location, then Allow." : null;
  if (permission !== "blocked") return null;
  if (desktop) return "Allow it in System Settings › Privacy & Security › Location Services › Cadence.";
  if (isIosSafari()) return "Allow it in Settings › Privacy & Security › Location Services › Safari Websites.";
  return "Allow location for this site in your browser’s site settings.";
}

function deviceLocationGuidance(permission: DeviceLocationPermission | null, denied: boolean, desktop: boolean): string {
  if (desktop) return "To use your current position, turn on Cadence in System Settings › Privacy & Security › Location Services, then choose Check again.";
  const safari = isIosSafari();
  if (denied) return safari
    ? "Allow location in Settings › Privacy & Security › Location Services › Safari Websites, then choose Check again."
    : "Allow location for this site in your browser’s site settings, then choose Check again.";
  if (permission === "not yet allowed") return safari
    ? "Choose Check again and allow location. To stop Safari asking, tap AA, then Website Settings, then Location, then Allow."
    : "Choose Check again and allow location when your browser asks.";
  return "Your device did not return a position in time. Choose Check again.";
}
