"use client";

import { useEffect, useId, useState, type FormEvent } from "react";

import { SettingsPanel } from "@/components/settings/SettingsPanels";
import type { ConnectorConnectionView } from "@/lib/types/connectors";
import { CONNECTOR_REVOCATION_COPY, connectorErrorCode, type HevyCoordinator } from "@/lib/ui/connectors";

type HevyPanelProps = Readonly<{
  coordinator: HevyCoordinator;
  localDate: string;
  timezone: string;
  refreshVersion?: number;
}>;

// Ticket 238. Hevy is recorded activity, not a calendar: it reports when a
// workout happened and how long it lasted. The API key is held in component
// state only until submit, then cleared before the request resolves.
export function HevyPanel({ coordinator, localDate, timezone, refreshVersion = 0 }: HevyPanelProps) {
  const keyId = useId();
  const [connection, setConnection] = useState<ConnectorConnectionView | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState<"connect" | "refresh" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void coordinator.getConnection().then((view) => { if (active) { setConnection(view); setMessage(null); } })
      .catch(() => { if (active) setMessage("Hevy status is unavailable. Other sources and tracking are unaffected."); });
    return () => { active = false; };
  }, [coordinator, refreshVersion]);
  useEffect(() => () => setApiKey(""), []);

  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitted = apiKey.trim();
    setApiKey("");
    if (!submitted) { setMessage("Enter your Hevy API key."); return; }
    setPending("connect"); setMessage(null);
    try {
      const view = await coordinator.connect(submitted);
      setConnection(view);
      setMessage("Hevy connected. Recorded workouts from today appear on the Timeline.");
    } catch (error) { setMessage(hevyErrorMessage(connectorErrorCode(error), "Hevy could not connect. Try again.")); }
    finally { setPending(null); }
  };
  const refresh = async () => {
    setPending("refresh"); setMessage(null);
    try {
      const result = await coordinator.refreshActivities(localDate, timezone, { force: true });
      const failure = result.refreshFailures[0]?.code;
      if (failure) setMessage(hevyErrorMessage(failure, "Hevy refresh was incomplete. Saved workouts stay on the Timeline."));
      else if (result.snapshot.completeness !== "complete") setMessage("Hevy refresh was incomplete. Some workouts may be missing.");
      else setMessage(`Hevy refreshed. ${result.snapshot.activities.length === 1 ? "1 recorded workout" : `${result.snapshot.activities.length} recorded workouts`} today.`);
    } catch (error) {
      setMessage(hevyErrorMessage(connectorErrorCode(error), "Hevy refresh did not finish. Try again; other sources and tracking are unchanged."));
    } finally { setPending(null); }
  };
  const disconnect = async () => {
    setPending("disconnect"); setMessage(null);
    try {
      const result = await coordinator.disconnect();
      setConnection(result.view);
      setMessage(`Hevy disconnected. Cadence deleted its saved API key. ${CONNECTOR_REVOCATION_COPY[result.revocation]}`);
    } catch (error) { setMessage(hevyErrorMessage(connectorErrorCode(error), "Hevy disconnect could not finish.")); }
    finally { setPending(null); }
  };

  const status = connection?.status ?? "loading";
  const needsKey = status === "disconnected" || status === "reconnect_required";

  return (
    <SettingsPanel id="connector-hevy" headingLevel={3} title="Hevy"
      description="Recorded activity. Cadence reads when each workout started and how long it lasted. Provider responses can contain exercises, titles, notes, sets and weights; Cadence discards these details. A workout never completes a Behavior.">
      <div className="grid max-w-2xl gap-4 text-sm leading-6">
        <p role={message ? "status" : undefined} className="text-muted-readable">{message ?? hevyStatusLabel(status)}</p>
        {status === "not_configured" ? <p className="text-muted-readable">Hevy connection is not configured for this Cadence deployment.</p> : null}
        {needsKey ? <form onSubmit={connect} className="grid gap-3 border-t border-line pt-4">
          <p className="text-muted-readable">Hevy API access requires Hevy Pro. Create a key in Hevy settings and enter it once. Cadence stores it encrypted on its server, never on this device, and scans at most 500 workouts across your full history, even for today. A larger history shows as incomplete. A complete read means no change was detected during the scan, not an atomic snapshot.</p>
          <label htmlFor={keyId} className="font-bold text-foreground">Hevy API key</label>
          <input id={keyId} type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" value={apiKey}
            onChange={(event) => setApiKey(event.target.value)} disabled={pending !== null}
            className="min-h-11 min-w-0 w-full max-w-md border border-line bg-background px-3 py-2" />
          <button type="submit" disabled={pending !== null} className="product-action product-action-primary min-h-11 w-fit px-3 py-2 text-sm font-bold">
            {pending === "connect" ? "Connecting Hevy…" : status === "reconnect_required" ? "Reconnect Hevy" : "Connect Hevy"}
          </button>
        </form> : null}
        {status === "connected" ? <>
          <p className="text-muted-readable">Disconnecting deletes Cadence&apos;s saved key. Hevy keeps the key active until you remove or regenerate it there.</p>
          <div className="flex flex-wrap gap-3 border-t border-line pt-4">
            <button type="button" onClick={refresh} disabled={pending !== null} className="product-action product-action-secondary min-h-11 px-3 py-2 text-sm font-bold">{pending === "refresh" ? "Refreshing Hevy…" : "Refresh Hevy"}</button>
            <button type="button" onClick={disconnect} disabled={pending !== null} className="product-action product-action-secondary min-h-11 px-3 py-2 text-sm font-bold">{pending === "disconnect" ? "Disconnecting Hevy…" : "Disconnect Hevy"}</button>
          </div>
        </> : null}
      </div>
    </SettingsPanel>
  );
}

function hevyStatusLabel(status: ConnectorConnectionView["status"] | "loading"): string {
  if (status === "loading") return "Loading Hevy connection.";
  if (status === "connected") return "Hevy connected.";
  if (status === "reconnect_required") return "Hevy needs a current API key.";
  if (status === "disconnected") return "Hevy is not connected.";
  return "Hevy connection is not configured.";
}

export function hevyErrorMessage(code: string, fallback: string): string {
  if (code === "permission_denied") return "Hevy API access requires Hevy Pro. This key's account does not have it.";
  if (code === "reconnect_required") return "Hevy did not accept this key. Check it in Hevy settings and enter it again.";
  if (code === "wrong_account") return "This key belongs to a different Hevy account. Disconnect Hevy first, then connect the other account.";
  if (code === "invalid_request") return "Enter a valid Hevy API key.";
  if (code === "incomplete_pagination") return "Hevy could not verify a complete list. The scan is limited to 500 workouts; changes during the scan can also make it incomplete.";
  if (code === "timeout") return "Hevy did not respond in time. Try again; other sources and tracking are unchanged.";
  if (code === "rate_limited") return "Hevy asked Cadence to wait before reading again. Try again later.";
  if (code === "not_configured") return "Hevy connection is not configured for this Cadence deployment.";
  if (code === "unauthenticated") return "Sign in to Cadence again to manage Hevy.";
  return fallback;
}
