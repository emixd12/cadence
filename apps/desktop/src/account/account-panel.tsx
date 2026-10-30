import type { DesktopAccountState } from "./auth";
import type { SyncStatus } from "../sync-engine";
import { useState } from "react";
import { canKeepBothAccountSyncConflict, type AccountSyncConflict, type AccountSyncConflictDecision } from "@cadence/core/resolvers/account-sync.resolver";

export function AccountPanel({ state, configured, connected, busy, onSignIn, onCancel }: Readonly<{
  state: DesktopAccountState; configured: boolean; connected: boolean; busy: boolean;
  onSignIn: () => void; onCancel: () => void;
}>) {
  return <section id="account" aria-busy={busy} className="bg-background py-4">
    <h2 className="text-xl leading-tight">Account</h2>
    {connected ? <>
      <p className="mt-4 max-w-2xl text-sm leading-6">{state.status === "linked" ? `Signed in${state.email ? ` as ${state.email}` : " with Google"}.` : "This Mac remains connected to its Cadence account."}</p>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">SQLite is this Mac’s offline working copy. Account changes synchronize while Cadence runs with connectivity.</p>
      {state.status === "linked" && state.notice ? <p role="status" className="mt-3 text-sm leading-6">{state.notice}</p> : null}
      {state.status === "error" ? <p role="alert" className="mt-3 text-sm leading-6 text-accent">{state.message}</p> : null}
      {state.status === "waiting" ? <><p role="status" className="mt-3 text-sm leading-6">Complete account reconnection in your browser.</p>
        <button type="button" disabled={busy} onClick={onCancel} className="product-action product-action-secondary mt-4 min-h-11 py-2 text-sm">Cancel reconnect</button></> : null}
    </> : state.status === "linked" ? <>
      <p className="mt-4 max-w-2xl text-sm leading-6">Signed in{state.email ? ` as ${state.email}` : " with Google"}.</p>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">Your local data has not been uploaded or replaced. Choose how to link it in the next step.</p>
      {state.notice ? <p role="status" className="mt-3 text-sm leading-6">{state.notice}</p> : null}
    </> : <>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-readable">Sign in with the Google account you use for Cadence. Local tracking remains available without an account.</p>
      {!configured ? <p role="status" className="mt-3 text-sm leading-6 text-muted-readable">Account sign-in is not configured in this build.</p> : null}
      {state.status === "error" ? <p role="alert" className="mt-3 text-sm leading-6 text-accent">{state.message}</p> : null}
      {state.status === "waiting" ? <>
        <p role="status" className="mt-3 text-sm leading-6">Complete Google sign-in in your browser.</p>
        <button type="button" disabled={busy} onClick={onCancel} className="product-action product-action-secondary mt-4 min-h-11 py-2 text-sm">Cancel sign in</button>
      </> : <button type="button" disabled={busy || !configured} onClick={onSignIn} className="product-action product-action-primary mt-4 min-h-11 py-2 text-sm">Sign in with Google</button>}
    </>}
  </section>;
}

export function AccountSyncPanel({ status, busy, onSync, onReconnect, onUpdate }: Readonly<{ status: SyncStatus; busy: boolean; onSync: () => void; onReconnect: () => void; onUpdate?: () => void }>) {
  const message = status.state === "offline" ? "Offline. Local changes will synchronize when Cadence reconnects."
    : status.state === "syncing" ? "Synchronizing account data…"
    : status.state === "current" ? "Account data is current."
    : status.state === "conflict" ? `${status.count} synchronization conflict${status.count === 1 ? " requires" : "s require"} review.`
    : status.state === "revoked" ? "The account session expired or was revoked. Reconnect or disconnect the account."
    : status.message;
  return <section id="account-sync" aria-busy={busy} className="bg-background py-4">
    <h3 className="text-lg leading-tight">Account synchronization</h3>
    <p role={status.state === "failed" || status.state === "revoked" ? "alert" : "status"} aria-live="polite" className={`mt-3 max-w-2xl text-sm leading-6 ${status.state === "failed" || status.state === "conflict" || status.state === "revoked" ? "text-accent" : "text-muted-readable"}`}>{message}</p>
    <button type="button" disabled={busy} onClick={status.state === "update_required" ? onUpdate : status.state === "revoked" ? onReconnect : onSync} className="product-action product-action-secondary mt-4 min-h-11 py-2 text-sm">{status.state === "update_required" ? "Review update" : status.state === "revoked" ? "Reconnect account" : "Sync now"}</button>
  </section>;
}

export function AccountConflictReview({ conflicts, busy, error, onResolve }: Readonly<{
  conflicts: readonly AccountSyncConflict[]; busy: boolean; error?: string;
  onResolve: (decisions: readonly AccountSyncConflictDecision[]) => void;
}>) {
  const [choices, setChoices] = useState<Record<string, AccountSyncConflictDecision["choice"]>>({});
  const complete = conflicts.every((conflict) => choices[`${conflict.kind}:${conflict.id}`]);
  return <section id="account-conflicts" aria-busy={busy} className="scroll-mt-20 bg-background py-4">
    <h3 className="text-lg leading-tight">Review conflicts ({conflicts.length})</h3>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">Synchronization stays paused until every conflict has a valid decision.</p>
    <div className="mt-4 divide-y divide-line">{conflicts.map((conflict) => {
      const key = `${conflict.kind}:${conflict.id}`;
      return <fieldset key={`${key}:${conflict.reason}`} className="py-4 first:pt-0 last:pb-0">
        <legend className="text-sm leading-6">{conflict.kind.replaceAll("_", " ")} · {conflict.reason.replaceAll("_", " ")}</legend>
        <dl className="mt-3 grid gap-3 text-sm leading-6 sm:grid-cols-2">
          <div><dt>This Mac</dt><dd className="mt-1 break-words text-muted-readable">{display(conflict.local)}</dd></div>
          <div><dt>Account</dt><dd className="mt-1 break-words text-muted-readable">{display(conflict.hosted)}</dd></div>
        </dl>
        <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap">
          <Choice name={`conflict-${key}`} checked={choices[key] === "hosted"} label="Use account version" onChange={() => setChoices((value) => ({ ...value, [key]: "hosted" }))} />
          <Choice name={`conflict-${key}`} checked={choices[key] === "local"} label="Use this Mac version" onChange={() => setChoices((value) => ({ ...value, [key]: "local" }))} />
          {canKeepBothAccountSyncConflict(conflict) ? <Choice name={`conflict-${key}`} checked={choices[key] === "both"} label="Keep both" onChange={() => setChoices((value) => ({ ...value, [key]: "both" }))} /> : null}
        </div>
      </fieldset>;
    })}</div>
    <button type="button" disabled={busy || !complete} onClick={() => onResolve(conflicts.map((conflict) => {
      const choice = choices[`${conflict.kind}:${conflict.id}`]!;
      return { kind: conflict.kind, id: conflict.id, choice, ...(choice === "both" ? { duplicateId: crypto.randomUUID() } : {}) };
    }))} className="product-action product-action-primary mt-4 min-h-11 py-2 text-sm">Apply conflict decisions</button>
    {error ? <p role="alert" className="mt-3 text-sm leading-6 text-accent">{error}</p> : null}
  </section>;
}

function Choice({ name, checked, label, onChange }: Readonly<{ name: string; checked: boolean; label: string; onChange: () => void }>) {
  return <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name={name} checked={checked} onChange={onChange} />{label}</label>;
}
function display(value: unknown): string { return value === null ? "Deleted" : JSON.stringify(value); }

export function AccountDisconnectPanel({ busy, result, error, onDisconnect }: Readonly<{
  busy: boolean; result?: string; error?: string; onDisconnect: (mode: "keep" | "remove") => void;
}>) {
  const [confirmation, setConfirmation] = useState("");
  if (result) return <section id="account-disconnect" className="bg-background py-4"><h3 className="text-lg leading-tight">Account disconnected</h3><p role="status" className="mt-3 break-all text-sm leading-6">{result}</p></section>;
  return <section id="account-disconnect" aria-busy={busy} className="bg-background py-4">
    <h3 className="text-lg leading-tight">Disconnect account</h3>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">Disconnecting does not delete hosted account data.</p>
    <button type="button" disabled={busy} onClick={() => onDisconnect("keep")} className="product-action product-action-secondary mt-4 min-h-11 py-2 text-sm">Keep a local copy</button>
    <div className="mt-4 max-w-md border-t border-line pt-4">
      <label htmlFor="disconnect-remove-confirmation" className="text-sm leading-6">Type REMOVE to remove account data from this Mac</label>
      <input id="disconnect-remove-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className="mt-2 block min-h-11 w-full border border-line bg-background px-3 py-2 text-sm" />
      <button type="button" disabled={busy || confirmation !== "REMOVE"} onClick={() => onDisconnect("remove")} className="product-action product-action-danger mt-3 min-h-11 py-2 text-sm">Remove account data</button>
    </div>
    {error ? <p role="alert" className="mt-3 text-sm leading-6 text-accent">{error}</p> : null}
  </section>;
}

export function FirstAccountLinkChoice({ recognized = true, complete = false, busy, backupPath, error, onImport, onIgnore, onCancel }: Readonly<{
  recognized?: boolean; complete?: boolean; busy: boolean; backupPath?: string; error?: string;
  onImport: () => void; onIgnore: () => void; onCancel: () => void;
}>) {
  return <section id="account-link-choice" aria-busy={busy} className="bg-background py-4">
    <h3 className="text-lg leading-tight">{complete ? "Account data connected" : recognized ? "Choose which data to use" : "Connecting account data"}</h3>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">{complete ? "The hosted and local copies now share one saved baseline." : recognized ? "Cadence found tracking data on this Mac. Choose one path before connecting the account." : "This untouched local profile is using the account data automatically."}</p>
    <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap">
      {recognized && !complete ? <button type="button" disabled={busy} onClick={onImport} className="product-action product-action-primary min-h-11 py-2 text-sm">Import local data into the account</button> : null}
      {recognized && !complete ? <button type="button" disabled={busy} onClick={onIgnore} className="product-action product-action-secondary min-h-11 py-2 text-sm">Ignore local data and use account data</button> : null}
      {!complete ? <button type="button" disabled={busy} onClick={onCancel} className="product-action product-action-secondary min-h-11 py-2 text-sm">Cancel account link</button> : null}
    </div>
    {backupPath ? <p role="status" className="mt-3 break-all text-sm leading-6 text-muted-readable">Protected backup: {backupPath}</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm leading-6 text-accent">{error}</p> : null}
  </section>;
}
