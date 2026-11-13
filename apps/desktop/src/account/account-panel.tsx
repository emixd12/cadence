import type { DesktopAccountState } from "./auth";
import { GOOGLE_ONLY_SIGN_IN, type DesktopSignInMethods } from "./sign-in-methods";
import type { SyncStatus } from "../sync-engine";
import { useState } from "react";
import { SettingsPartHeading, SettingsSectionHeading } from "@/components/settings/settings-heading";
import { canKeepBothAccountSyncConflict, type AccountSyncConflict, type AccountSyncConflictDecision } from "@cadence/core/resolvers/account-sync.resolver";

export function AccountPanel({ state, configured, connected, busy, methods = GOOGLE_ONLY_SIGN_IN, onSignIn, onEmail = () => undefined,
  onCode = () => undefined, onResend = () => undefined, onCancel }: Readonly<{
  state: DesktopAccountState; configured: boolean; connected: boolean; busy: boolean; methods?: DesktopSignInMethods;
  onSignIn: (method: "google" | "apple") => void; onEmail?: (email: string) => void; onCode?: (code: string) => void;
  onResend?: () => void; onCancel: () => void;
}>) {
  const signedIn = state.status === "linked" && state.email ? `Signed in as ${state.email}.` : "Signed in.";
  const flow = state.status === "code" ? <EmailCodeEntry state={state} codeLength={methods.emailCodeLength} busy={busy}
    onCode={onCode} onResend={onResend} onCancel={onCancel} />
    : state.status === "waiting" ? <>
      <p role="status" className="mt-3 text-sm leading-6">Finish signing in in your browser.</p>
      <button type="button" disabled={busy} onClick={onCancel} className="product-action product-action-secondary mt-4 min-h-11 py-2 text-sm">Cancel sign in</button>
    </> : <MethodChoice methods={methods} busy={busy || !configured} onSignIn={onSignIn} onEmail={onEmail} />;
  return <section id="account" aria-busy={busy} className="bg-background py-4">
    <SettingsSectionHeading>Account</SettingsSectionHeading>
    {connected ? <>
      <p className="mt-4 max-w-2xl text-sm leading-6">{state.status === "linked" ? signedIn : "This Mac is linked to your Cadence account."}</p>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">SQLite is this Mac’s offline working copy. Account changes synchronize while Cadence runs with connectivity.</p>
      {state.status === "linked" && state.notice ? <p role="status" className="mt-3 text-sm leading-6">{state.notice}</p> : null}
      {state.status === "error" ? <p role="alert" className="mt-3 text-sm leading-6 text-accent">{state.message}</p> : null}
      {state.status === "linked" ? null : flow}
    </> : state.status === "linked" ? <>
      <p className="mt-4 max-w-2xl text-sm leading-6">{signedIn}</p>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">Your local data has not been uploaded or replaced. Choose how to link it in the next step.</p>
      {state.notice ? <p role="status" className="mt-3 text-sm leading-6">{state.notice}</p> : null}
    </> : <>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-readable">Sign in to your Cadence account to sync this Mac. Tracking works without an account.</p>
      {!configured ? <p role="status" className="mt-3 text-sm leading-6 text-muted-readable">This version of Cadence cannot sign in to an account.</p> : null}
      {state.status === "error" ? <p role="alert" className="mt-3 text-sm leading-6 text-accent">{state.message}</p> : null}
      {flow}
    </>}
  </section>;
}

// Ticket 336 (D31.2): the same methods, labels and order as the web login page.
function MethodChoice({ methods, busy, onSignIn, onEmail }: Readonly<{
  methods: DesktopSignInMethods; busy: boolean; onSignIn: (method: "google" | "apple") => void; onEmail: (email: string) => void;
}>) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  return <div className="mt-4 grid max-w-sm gap-3">
    {methods.methods.map((method) => method.id === "email"
      ? emailOpen ? <form key="email" className="grid gap-2" onSubmit={(event) => { event.preventDefault(); onEmail(email); }}>
          <label htmlFor="account-sign-in-email" className="text-sm leading-6">Email</label>
          <input id="account-sign-in-email" type="email" required autoFocus autoComplete="email" maxLength={254} value={email}
            onChange={(event) => setEmail(event.target.value)} className="block min-h-11 w-full border border-line bg-background px-3 py-2 text-sm" />
          <p className="text-sm leading-6 text-muted-readable">Your browser opens to send a {methods.emailCodeLength}-digit code. A new address starts a new account.</p>
          <button type="submit" disabled={busy} className="product-action product-action-primary min-h-11 justify-self-start py-2 text-sm">Send code</button>
        </form>
        : <button key="email" type="button" disabled={busy} onClick={() => setEmailOpen(true)} className="product-action product-action-primary min-h-11 justify-self-start py-2 text-sm">{method.label}</button>
      : <button key={method.id} type="button" disabled={busy} onClick={() => onSignIn(method.id as "google" | "apple")} className="product-action product-action-primary min-h-11 justify-self-start py-2 text-sm">{method.label}</button>)}
  </div>;
}

function EmailCodeEntry({ state, codeLength, busy, onCode, onResend, onCancel }: Readonly<{
  state: Extract<DesktopAccountState, { status: "code" }>; codeLength: number; busy: boolean;
  onCode: (code: string) => void; onResend: () => void; onCancel: () => void;
}>) {
  const [code, setCode] = useState("");
  return <form className="mt-4 grid max-w-sm gap-2" onSubmit={(event) => { event.preventDefault(); onCode(code); }}>
    <p role="status" className="text-sm leading-6">Cadence is sending a {codeLength}-digit code to <span className="break-all font-bold">{state.email}</span>. Finish in your browser, then type the code here.</p>
    {state.notice ? <p role="status" className="text-sm leading-6">{state.notice}</p> : null}
    {state.error ? <p role="alert" className="text-sm leading-6 text-accent">{state.error}</p> : null}
    <label htmlFor="account-sign-in-code" className="mt-2 text-sm leading-6">Code</label>
    <input id="account-sign-in-code" required autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={codeLength + 3} value={code}
      onChange={(event) => setCode(event.target.value)} className="block min-h-11 w-full border border-line bg-background px-3 py-2 font-mono text-lg tracking-[0.3em]" />
    <div className="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap">
      <button type="submit" disabled={busy} className="product-action product-action-primary min-h-11 py-2 text-sm">Sign in</button>
      <button type="button" disabled={busy} onClick={onResend} className="product-action product-action-secondary min-h-11 py-2 text-sm">Send a new code</button>
      <button type="button" disabled={busy} onClick={onCancel} className="product-action product-action-secondary min-h-11 py-2 text-sm">Cancel sign in</button>
    </div>
  </form>;
}

export function AccountSyncPanel({ status, busy, onSync, onReconnect, onUpdate }: Readonly<{ status: SyncStatus; busy: boolean; onSync: () => void; onReconnect: () => void; onUpdate?: () => void }>) {
  const message = status.state === "offline" ? "Offline. Changes on this Mac sync when Cadence is back online."
    : status.state === "syncing" ? "Syncing…"
    : status.state === "current" ? "Account data is current."
    : status.state === "conflict" ? `${status.count} sync ${status.count === 1 ? "conflict" : "conflicts"} to review.`
    : status.state === "revoked" ? "You were signed out of your Cadence account. Reconnect, or disconnect this Mac."
    : status.message;
  return <section id="account-sync" aria-busy={busy} className="bg-background py-4">
    <SettingsPartHeading className="text-lg leading-tight">Sync</SettingsPartHeading>
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
    <SettingsPartHeading className="text-lg leading-tight">Review conflicts ({conflicts.length})</SettingsPartHeading>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">Sync stays paused until you choose a version for every conflict.</p>
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
    }))} className="product-action product-action-primary mt-4 min-h-11 py-2 text-sm">Apply choices</button>
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
  if (result) return <section id="account-disconnect" className="bg-background py-4"><SettingsPartHeading className="text-lg leading-tight">Account disconnected</SettingsPartHeading><p role="status" className="mt-3 break-all text-sm leading-6">{result}</p></section>;
  return <section id="account-disconnect" aria-busy={busy} className="bg-background py-4">
    <SettingsPartHeading className="text-lg leading-tight">Disconnect account</SettingsPartHeading>
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
    <SettingsPartHeading className="text-lg leading-tight">{complete ? "Account linked" : recognized ? "Choose which data to use" : "Linking your account"}</SettingsPartHeading>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">{complete ? "This Mac and your account now have the same data." : recognized ? "Cadence found tracking data on this Mac. Choose what to do with it before linking." : "This Mac had no tracking data, so it uses your account’s data."}</p>
    <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap">
      {recognized && !complete ? <button type="button" disabled={busy} onClick={onImport} className="product-action product-action-primary min-h-11 py-2 text-sm">Import local data into the account</button> : null}
      {recognized && !complete ? <button type="button" disabled={busy} onClick={onIgnore} className="product-action product-action-secondary min-h-11 py-2 text-sm">Ignore local data and use account data</button> : null}
      {!complete ? <button type="button" disabled={busy} onClick={onCancel} className="product-action product-action-secondary min-h-11 py-2 text-sm">Cancel account link</button> : null}
    </div>
    {backupPath ? <p role="status" className="mt-3 break-all text-sm leading-6 text-muted-readable">Protected backup: {backupPath}</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm leading-6 text-accent">{error}</p> : null}
  </section>;
}
