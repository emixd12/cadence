import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { desktopUpdater } from "./native-updater";
import type { DesktopUpdateState } from "./desktop-updater";

type RestartActions = Readonly<{ onRestart?: () => void; onDiscardAndRestart?: () => void; onCancelRestart?: () => void; restartBlocked?: boolean; restartError?: string }>;

export function DesktopUpdatePanel(props: RestartActions) {
  const state = useSyncExternalStore(desktopUpdater.subscribe, desktopUpdater.getSnapshot, desktopUpdater.getSnapshot);
  useEffect(() => { void desktopUpdater.initialize(); }, []);
  return <DesktopUpdateSection {...props} state={state} onCheck={() => void desktopUpdater.check()}
    onAutomaticDownloads={(enabled) => desktopUpdater.setAutomaticDownloads(enabled)}
    onDownload={() => void desktopUpdater.download()} onInstall={() => void desktopUpdater.install()}
    onRetry={() => void desktopUpdater.retry()} />;
}

export function DesktopUpdateSection({ state, onCheck, onAutomaticDownloads, onDownload, onInstall, onRetry,
  onRestart, onDiscardAndRestart, onCancelRestart, restartBlocked, restartError }: RestartActions & Readonly<{
  state: DesktopUpdateState; onCheck: () => void; onAutomaticDownloads: (enabled: boolean) => void;
  onDownload: () => void; onInstall: () => void; onRetry: () => void;
}>) {
  const titleId = useId();
  const busy = ["checking", "downloading", "installing"].includes(state.phase);
  const canCheck = !["loading", "unavailable", "installed", "installing"].includes(state.phase);
  const percent = state.totalBytes && state.totalBytes > 0
    ? Math.min(100, Math.floor((state.downloadedBytes ?? 0) / state.totalBytes * 100)) : undefined;
  return <section className="bg-background py-4" aria-busy={busy} aria-labelledby={titleId}>
    <h2 id={titleId} className="text-xl leading-tight">App updates</h2>
    <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-readable">
      {state.currentVersion ? `Cadence ${state.currentVersion}. ` : ""}
      Cadence checks for updates daily while open. Installation and restart always require your action.
    </p>
    {state.phase !== "unavailable" && state.phase !== "loading" ? <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
      <input type="checkbox" checked={state.automaticDownloads} onChange={(event) => onAutomaticDownloads(event.currentTarget.checked)} />
      Download updates automatically
    </label> : null}
    <p className="mt-3 text-sm leading-6 text-muted-readable" role="status" aria-live="polite">
      {state.phase === "loading" && "Reading update configuration…"}
      {state.phase === "unavailable" && "Signed updates are not configured for this build."}
      {state.phase === "checking" && "Checking for updates…"}
      {state.phase === "current" && "No newer version is available."}
      {state.phase === "available" && `Cadence ${state.version} is available to download.`}
      {state.phase === "downloading" && `Downloading Cadence ${state.version}${percent === undefined ? "…" : `: ${percent}%`}`}
      {state.phase === "downloaded" && `Cadence ${state.version} is ready to install.`}
      {state.phase === "installing" && "Installing the signed update. Keep Cadence open."}
      {state.phase === "installed" && "The update is installed. Restart Cadence to use it."}
    </p>
    {state.phase === "downloading" ? <progress aria-label="Update download progress" value={percent} max={100} className="mt-3 w-full max-w-md" /> : null}
    {state.notes ? <div className="mt-4 max-w-2xl"><h3 className="text-sm">Release notes</h3>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-readable">{state.notes}</p></div> : null}
    {state.error ? <p role="alert" className="mt-3 text-sm leading-6 text-accent">{state.error}</p> : null}
    <div className="mt-4 flex flex-wrap gap-3">
      {canCheck ? <button type="button" disabled={busy} onClick={onCheck} className="product-action product-action-secondary min-h-11 py-2 text-sm">Check for updates</button> : null}
      {state.phase === "available" ? <button type="button" onClick={onDownload} className="product-action product-action-primary min-h-11 py-2 text-sm">Download update</button> : null}
      {state.phase === "downloaded" ? <button type="button" onClick={onInstall} className="product-action product-action-primary min-h-11 py-2 text-sm">Install update</button> : null}
      {state.phase === "error" ? <button type="button" onClick={onRetry} className="product-action product-action-primary min-h-11 py-2 text-sm">Retry update</button> : null}
      {state.phase === "installed" ? <button type="button" onClick={onRestart} disabled={!onRestart} className="product-action product-action-primary min-h-11 py-2 text-sm">Restart Cadence</button> : null}
    </div>
    {state.phase === "installed" && restartError ? <p role="alert" className="mt-3 max-w-2xl text-sm leading-6 text-accent">{restartError}</p> : null}
    {restartBlocked ? <div role="status" className="mt-4 border-t border-line pt-4 text-sm leading-6">
      <p>Save your changes before restarting, or explicitly discard your unsaved drafts.</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <button type="button" onClick={onCancelRestart} className="product-action product-action-secondary min-h-11 py-2">Keep editing</button>
        <button type="button" onClick={onDiscardAndRestart} className="product-action product-action-danger min-h-11 py-2">Discard drafts and restart</button>
      </div>
    </div> : null}
  </section>;
}

export function DesktopUpdateNotice({ required, ...restart }: RestartActions & Readonly<{ required: boolean }>) {
  const state = useSyncExternalStore(desktopUpdater.subscribe, desktopUpdater.getSnapshot, desktopUpdater.getSnapshot);
  const [reviewing, setReviewing] = useState(false);
  if (!required && !reviewing && (state.phase !== "downloaded" || state.snoozed)) return null;
  return <aside aria-label="Cadence update" className="border-b border-line bg-background px-4 py-3 sm:px-6 lg:px-10">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <p role="status">{required ? "Update required to synchronize. Local tracking remains available." : state.phase === "installed" ? "The update is installed. Restart Cadence to use it." : state.version ? `Cadence ${state.version} update` : "Cadence updates"}</p>
      <button type="button" onClick={() => setReviewing((value) => !value)} aria-expanded={reviewing} className="product-action product-action-primary min-h-11 py-2">{reviewing ? "Close update review" : "Review update"}</button>
      {!required ? <button type="button" onClick={() => { desktopUpdater.later(); setReviewing(false); }} className="product-action product-action-secondary min-h-11 py-2">Later</button> : null}
    </div>
    {reviewing ? <DesktopUpdatePanel {...restart} /> : null}
  </aside>;
}
